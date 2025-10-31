import katex from 'katex';

const escapeHtml = (value = '') =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderMath = (expression = '', displayMode = false) => {
  const trimmed = expression.trim();
  if (!trimmed) {
    return '';
  }

  try {
    return katex.renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
    });
  } catch (error) {
    console.warn('Failed to render math expression', error);
    return `<span class="math-error">${escapeHtml(trimmed)}</span>`;
  }
};

const replaceInlineMath = (text = '') => {
  let result = '';
  let buffer = '';
  let inMath = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '\\' && nextChar === '$') {
      result += '$';
      index += 1;
      continue;
    }

    if (char === '$') {
      if (inMath) {
        if (buffer.trim().length === 0) {
          result += `$${buffer}$`;
        } else {
          result += renderMath(buffer, false);
        }
        buffer = '';
        inMath = false;
      } else {
        inMath = true;
        buffer = '';
      }
      continue;
    }

    if (inMath) {
      buffer += char;
    } else {
      result += char;
    }
  }

  if (inMath) {
    result += `$${buffer}`;
  }

  return result;
};

const parseInline = (value = '') => {
  const escaped = escapeHtml(value);
  const withMath = replaceInlineMath(escaped);

  return withMath
    .replace(/\!\[([^\]]*)]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^\*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
};

export const convertMarkdown = (raw = '') => {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let inBullet = false;
  let inOrdered = false;
  let inBlockquote = false;
  let inCode = false;
  let inMathBlock = false;
  let codeLanguage = '';
  let codeBuffer = [];
  let mathBuffer = [];

  const closeLists = () => {
    if (inBullet) {
      output.push('</ul>');
      inBullet = false;
    }
    if (inOrdered) {
      output.push('</ol>');
      inOrdered = false;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      output.push('</blockquote>');
      inBlockquote = false;
    }
  };

  const flushCodeBlock = () => {
    if (!inCode) {
      return;
    }
    const codeHtml = escapeHtml(codeBuffer.join('\n'));
    const className = codeLanguage ? ` class="language-${codeLanguage}"` : '';
    output.push(`<pre><code${className}>${codeHtml}</code></pre>`);
    inCode = false;
    codeLanguage = '';
    codeBuffer = [];
  };

  const flushMathBlock = () => {
    if (!inMathBlock) {
      return;
    }
    const expression = mathBuffer.join('\n').trim();
    if (expression) {
      output.push(renderMath(expression, true));
    }
    inMathBlock = false;
    mathBuffer = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCode) {
        flushCodeBlock();
      } else {
        closeLists();
        closeBlockquote();
        flushMathBlock();
        inCode = true;
        codeLanguage = trimmed.slice(3).trim();
      }
      return;
    }

    if (inCode) {
      codeBuffer.push(line);
      return;
    }

    if (trimmed.startsWith('$$')) {
      closeLists();
      closeBlockquote();
      flushCodeBlock();

      if (inMathBlock) {
        const withoutStart = trimmed.slice(2).replace(/\$\s*$/, '').trim();
        if (withoutStart) {
          mathBuffer.push(withoutStart);
        }
        if (trimmed === '$$' || trimmed.endsWith('$$')) {
          flushMathBlock();
        }
      } else if (trimmed === '$$') {
        inMathBlock = true;
        mathBuffer = [];
      } else if (trimmed.endsWith('$$')) {
        const expression = trimmed.slice(2, -2).trim();
        if (expression) {
          output.push(renderMath(expression, true));
        }
      } else {
        inMathBlock = true;
        const initial = trimmed.slice(2).trim();
        mathBuffer = initial ? [initial] : [];
      }
      return;
    }

    if (inMathBlock) {
      if (trimmed.endsWith('$$')) {
        const withoutEnd = line.replace(/\$\$\s*$/, '').trimEnd();
        if (withoutEnd.trim()) {
          mathBuffer.push(withoutEnd.trimEnd());
        }
        flushMathBlock();
      } else {
        mathBuffer.push(line);
      }
      return;
    }

    if (trimmed === '') {
      closeLists();
      closeBlockquote();
      flushCodeBlock();
      flushMathBlock();
      return;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      closeLists();
      closeBlockquote();
      output.push(`<h${level}>${parseInline(headingMatch[2])}</h${level}>`);
      return;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      closeLists();
      closeBlockquote();
      output.push('<hr />');
      return;
    }

    if (/^>\s?/.test(trimmed)) {
      closeLists();
      const quoteContent = trimmed.replace(/^>\s?/, '');
      if (!inBlockquote) {
        output.push('<blockquote>');
        inBlockquote = true;
      }
      output.push(`<p>${parseInline(quoteContent)}</p>`);
      return;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inOrdered) {
        closeLists();
        closeBlockquote();
        output.push('<ol>');
        inOrdered = true;
      }
      const content = trimmed.replace(/^\d+\.\s+/, '');
      output.push(`<li>${parseInline(content)}</li>`);
      return;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      if (!inBullet) {
        closeLists();
        closeBlockquote();
        output.push('<ul>');
        inBullet = true;
      }
      const content = trimmed.replace(/^[-*+]\s+/, '');
      output.push(`<li>${parseInline(content)}</li>`);
      return;
    }

    closeLists();
    closeBlockquote();
    output.push(`<p>${parseInline(trimmed)}</p>`);
  });

  flushCodeBlock();
  flushMathBlock();
  closeLists();
  closeBlockquote();

  return output.join('\n');
};
