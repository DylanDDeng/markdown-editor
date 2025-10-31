import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertMarkdown } from './markdown.js';

const APP_DISPLAY_NAME = '涌现';
const APP_FULL_TITLE = '涌现 Emergence';
const APP_TAGLINE = 'Emergence Markdown Editor';

const WELCOME_CONTENT = [
  '# 欢迎使用「涌现」',
  '',
  '在左侧书写 Markdown，右侧实时为你渲染。',
  '',
  '- 使用 **Cmd/Ctrl + B** 加粗',
  '- 使用 **Cmd/Ctrl + I** 斜体',
  '- 使用反引号包裹 `代码`',
  '- 输入 `$E=mc^2$` 或 `$$\\int_0^1 x^2 dx$$` 渲染 LaTeX',
  '',
  '> 支持标题、列表、引用、代码块等常见语法。',
  '',
  '```python',
  'def greet() -> None:',
  '    print("Happy writing!")',
  '```',
  '',
  '$$',
  '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}',
  '$$',
  '',
  '---',
  '',
  '继续书写，畅享专注体验。',
].join('\n');

const computeStats = (value) => {
  const characters = value.length;
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const minutes = words / 300;

  return {
    characters,
    words,
    reading: minutes < 1 ? '< 1' : minutes.toFixed(1),
  };
};

const focusEditor = (editor) => {
  if (!editor) return;
  requestAnimationFrame(() => {
    editor.focus();
    const length = editor.value.length;
    editor.setSelectionRange(length, length);
  });
};

const clamp = (value, min = 0.2, max = 0.8) => {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

const METRICS_STORAGE_KEY = 'emergence:metrics';
const HEATMAP_WEEKS = 8;

const loadMetrics = () => {
  try {
    const raw = window.localStorage.getItem(METRICS_STORAGE_KEY);
    if (!raw) {
      return { activity: {}, documents: {} };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { activity: {}, documents: {} };
    }
    if (!parsed.activity && !parsed.documents) {
      return { activity: parsed, documents: {} };
    }
    const activity = parsed.activity && typeof parsed.activity === 'object' ? parsed.activity : {};
    const documents = parsed.documents && typeof parsed.documents === 'object' ? parsed.documents : {};
    return { activity, documents };
  } catch (error) {
    console.warn('Failed to load metrics data', error);
    return { activity: {}, documents: {} };
  }
};

const persistMetrics = (metrics) => {
  try {
    window.localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(metrics));
  } catch (error) {
    console.warn('Failed to persist metrics data', error);
  }
};

const toLocalDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const generateHeatmapDays = () => {
  const days = [];
  const today = new Date();
  const totalDays = HEATMAP_WEEKS * 7;

  for (let index = totalDays - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const iso = toLocalDateKey(date);
    days.push({ date, iso });
  }

  return days;
};

const INITIAL_WORD_COUNT = computeStats(WELCOME_CONTENT).words;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNTITLED_DOCUMENT_KEY = '__untitled__';

const StatusBar = ({ characters, words, reading, documentName, filePath, isDirty }) => {
  const unsaved = isDirty || !filePath;
  const docLabel = unsaved ? `${documentName} (未保存)` : documentName;

  return (
    <footer className="status-bar" aria-live="polite">
      <span className="status-doc" title={filePath || '未命名文档'}>
        {docLabel}
      </span>
      <span>{characters} 字符</span>
      <span>{words} 字</span>
      <span>预计阅读时间 {reading} 分钟</span>
    </footer>
  );
};

const normalizePath = (value) => (value ? value.replace(/\\/g, '/') : '');

const dirname = (value) => {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return normalized || '';
  }
  return normalized.slice(0, index);
};

const getDocumentKey = (filePath) => {
  const normalized = normalizePath(filePath);
  return normalized || UNTITLED_DOCUMENT_KEY;
};

const extractFrontMatterTags = (content) => {
  if (!content || !content.startsWith('---')) {
    return [];
  }

  const normalized = content.replace(/\r\n?/g, '\n');
  const closingIndex = normalized.indexOf('\n---', 3);
  if (closingIndex === -1) {
    return [];
  }

  const frontMatter = normalized.slice(4, closingIndex).trim();
  if (!frontMatter) {
    return [];
  }

  const lines = frontMatter.split('\n');
  const tags = [];
  let inTagList = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!inTagList) {
      if (/^tags\s*:\s*\[.*\]/i.test(trimmed)) {
        const inner = trimmed.replace(/^tags\s*:\s*\[/i, '').replace(/]$/, '');
        inner
          .split(',')
          .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
          .forEach((item) => tags.push(item));
        return;
      }

      if (/^tags\s*:\s*$/i.test(trimmed)) {
        inTagList = true;
        return;
      }

      const inlineMatch = trimmed.match(/^tags\s*:\s*(.+)$/i);
      if (inlineMatch && inlineMatch[1]) {
        const value = inlineMatch[1].trim().replace(/^['"]|['"]$/g, '');
        if (value) {
          tags.push(value);
        }
      }
      return;
    }

    if (/^[^\s-]/.test(trimmed)) {
      inTagList = false;
      return;
    }

    const listMatch = trimmed.match(/^[-*]\s*(.+)$/);
    if (listMatch && listMatch[1]) {
      const value = listMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (value) {
        tags.push(value);
      }
    }
  });

  const unique = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
  return unique;
};

const computeTagCounts = (documents) => {
  const counts = {};
  Object.values(documents || {}).forEach((metadata) => {
    if (!metadata || !Array.isArray(metadata.tags)) {
      return;
    }
    const unique = new Set(
      metadata.tags
        .map((tag) => tag.trim())
        .filter(Boolean)
    );
    unique.forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  return counts;
};

const formatTagLabel = (tag) => {
  if (!tag.startsWith('#')) {
    return `#${tag}`;
  }
  return tag;
};

const getHeatLevel = (value, max) => {
  if (!value || value <= 0 || !max) {
    return 0;
  }
  const ratio = value / max;
  if (ratio >= 0.9) return 4;
  if (ratio >= 0.6) return 3;
  if (ratio >= 0.3) return 2;
  return 1;
};

const formatDateLabel = (date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function App() {
  const [content, setContent] = useState(WELCOME_CONTENT);
  const [filePath, setFilePath] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSingleColumn, setIsSingleColumn] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [metrics, setMetrics] = useState(() => loadMetrics());
  const [lastRecordedWords, setLastRecordedWords] = useState(INITIAL_WORD_COUNT);
  const editorRef = useRef(null);
  const workspaceRef = useRef(null);

  const activity = metrics.activity || {};
  const documents = metrics.documents || {};
  const updateDocumentMetadata = useCallback((docKey, metadata) => {
    setMetrics((previous) => {
      const nextDocuments = { ...(previous.documents || {}) };
      const existing = nextDocuments[docKey] || {};
      nextDocuments[docKey] = { ...existing, ...metadata };
      const nextMetrics = { ...previous, documents: nextDocuments };
      persistMetrics(nextMetrics);
      return nextMetrics;
    });
  }, []);

  const removeUntitledMetadata = useCallback(() => {
    setMetrics((previous) => {
      if (!previous.documents || !previous.documents[UNTITLED_DOCUMENT_KEY]) {
        return previous;
      }
      const nextDocuments = { ...(previous.documents || {}) };
      delete nextDocuments[UNTITLED_DOCUMENT_KEY];
      const nextMetrics = { ...previous, documents: nextDocuments };
      persistMetrics(nextMetrics);
      return nextMetrics;
    });
  }, []);

  const confirmDiscardChanges = useCallback(() => {
    if (!isDirty) {
      return true;
    }
    return window.confirm('当前文档尚未保存，是否放弃更改？');
  }, [isDirty]);

  const recordActivity = useCallback(
    (wordsDelta) => {
      const increment = Math.max(0, Math.floor(wordsDelta));
      if (!increment) {
        return;
      }
      const todayKey = toLocalDateKey(new Date());
      setMetrics((previous) => {
        const nextActivity = { ...(previous.activity || {}) };
        nextActivity[todayKey] = (nextActivity[todayKey] || 0) + increment;
        const nextMetrics = { ...previous, activity: nextActivity };
        persistMetrics(nextMetrics);
        return nextMetrics;
      });
    },
    []
  );

  const updateSplitRatioFromClientX = useCallback((clientX) => {
    const container = workspaceRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }
    const ratio = clamp((clientX - rect.left) / rect.width);
    setSplitRatio(ratio);
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [isResizing]);

  const stats = useMemo(() => computeStats(content), [content]);
  const previewHtml = useMemo(() => convertMarkdown(content), [content]);
  const documentName = useMemo(() => {
    if (!filePath) {
      return '未命名.md';
    }
    const segments = filePath.split(/[\\/]/);
    return segments[segments.length - 1] || '未命名.md';
  }, [filePath]);

  const refreshWorkspaceFiles = useCallback(
    async (directory) => {
      const target = directory || workspacePath;
      if (!target || !window.markdownAPI?.listDirectory) {
        setWorkspaceFiles([]);
        return;
      }

      const result = await window.markdownAPI.listDirectory(target);
      if (result && Array.isArray(result.files)) {
        setWorkspaceFiles(result.files);
      }
    },
    [workspacePath]
  );

  const heatmapDays = useMemo(() => generateHeatmapDays(), []);
  const heatmapMax = useMemo(() => {
    const values = Object.values(activity).map((value) => Number(value) || 0);
    if (!values.length) {
      return 0;
    }
    return Math.max(...values);
  }, [activity]);

  const heatmapColumns = useMemo(() => {
    const columns = [];
    for (let columnIndex = 0; columnIndex < HEATMAP_WEEKS; columnIndex += 1) {
      const start = columnIndex * 7;
      columns.push(heatmapDays.slice(start, start + 7));
    }
    return columns;
  }, [heatmapDays]);

  const tagCounts = useMemo(() => {
    const counts = computeTagCounts(documents);
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.tag.localeCompare(b.tag, 'zh-CN');
      });
  }, [documents]);

  const editorPaneStyle = useMemo(() => {
    if (isSingleColumn) {
      return {};
    }
    const percent = Math.round(splitRatio * 1000) / 10;
    return {
      flex: `0 0 ${percent}%`,
      maxWidth: `${percent}%`,
    };
  }, [isSingleColumn, splitRatio]);

  const previewPaneStyle = useMemo(() => {
    if (isSingleColumn) {
      return {};
    }
    const percent = Math.round((1 - splitRatio) * 1000) / 10;
    return {
      flex: `0 0 ${percent}%`,
      maxWidth: `${percent}%`,
    };
  }, [isSingleColumn, splitRatio]);

  useEffect(() => {
    focusEditor(editorRef.current);
  }, []);

  useEffect(() => {
    window.markdownAPI?.setRepresentedFile?.(filePath || '');
  }, [filePath]);

  useEffect(() => {
    const needsIndicator = isDirty || !filePath;
    const title = `${needsIndicator ? '*' : ''}${documentName} — ${APP_FULL_TITLE}`;
    window.markdownAPI?.setWindowTitle?.(title);
  }, [documentName, filePath, isDirty]);

  useEffect(() => {
    if (filePath) {
      const dir = dirname(filePath);
      if (dir && dir !== workspacePath) {
        setWorkspacePath(dir);
        refreshWorkspaceFiles(dir);
      }
    }
  }, [filePath, refreshWorkspaceFiles, workspacePath]);

  useEffect(() => {
    if (!filePath && workspacePath) {
      refreshWorkspaceFiles(workspacePath);
    }
  }, [filePath, workspacePath, refreshWorkspaceFiles]);

  const handleNewDocument = useCallback(() => {
    if (!confirmDiscardChanges()) {
      return;
    }
    setContent('');
    setFilePath(null);
    setIsDirty(false);
    focusEditor(editorRef.current);
    setLastRecordedWords(0);
    updateDocumentMetadata(UNTITLED_DOCUMENT_KEY, { tags: [], lastRecordedWords: 0 });
  }, [confirmDiscardChanges, updateDocumentMetadata]);

  const handleOpenDocument = useCallback(async () => {
    if (!confirmDiscardChanges()) {
      return;
    }
    if (!window.markdownAPI?.openFile) {
      return;
    }

    const result = await window.markdownAPI.openFile();
    if (!result || result.canceled || !result.filePath) {
      return;
    }

    const docKey = getDocumentKey(result.filePath);
    const contentValue = result.content ?? '';
    setContent(contentValue);
    setFilePath(result.filePath);
    setIsDirty(false);
    focusEditor(editorRef.current);
    const currentWords = computeStats(contentValue).words;
    const docMeta = documents[docKey];
    setLastRecordedWords(docMeta?.lastRecordedWords ?? 0);
    const tags = extractFrontMatterTags(contentValue);
    if (!docMeta) {
      updateDocumentMetadata(docKey, { tags, lastRecordedWords: currentWords });
    } else if (tags.length) {
      updateDocumentMetadata(docKey, { tags });
    } else if (docMeta.tags && docMeta.tags.length) {
      updateDocumentMetadata(docKey, { tags: [] });
    }
  }, [confirmDiscardChanges, documents, updateDocumentMetadata]);

  const handleSaveDocument = useCallback(
    async (forceChoosePath = false) => {
      if (!window.markdownAPI?.saveFile) {
        return;
      }

      const needsPath = forceChoosePath || !filePath;
      const result = await window.markdownAPI.saveFile({
        filePath: needsPath ? null : filePath,
        content,
      });

      if (!result || result.canceled || !result.filePath) {
        return;
      }

      setFilePath(result.filePath);
      setIsDirty(false);
      const currentWords = stats.words;
      recordActivity(currentWords - lastRecordedWords);
      setLastRecordedWords(currentWords);
      const docKey = getDocumentKey(result.filePath);
      const tags = extractFrontMatterTags(content);
      updateDocumentMetadata(docKey, { tags, lastRecordedWords: currentWords });
      if (docKey !== UNTITLED_DOCUMENT_KEY) {
        removeUntitledMetadata();
      }
      const directory = dirname(result.filePath);
      if (directory) {
        setWorkspacePath(directory);
        refreshWorkspaceFiles(directory);
      }
    },
    [content, lastRecordedWords, recordActivity, refreshWorkspaceFiles, removeUntitledMetadata, stats.words, updateDocumentMetadata]
  );

  const handleChange = (event) => {
    setContent(event.target.value);
    setIsDirty(true);
  };

  const handleToggleLayout = () => {
    setIsSingleColumn((prev) => !prev);
  };

  const handleChooseWorkspace = useCallback(async () => {
    if (!window.markdownAPI?.selectDirectory) {
      return;
    }

    const result = await window.markdownAPI.selectDirectory();
    if (!result || result.canceled || !result.directory) {
      return;
    }

    setWorkspacePath(result.directory);
    setWorkspaceFiles(result.files || []);
  }, []);

  const handleOpenWorkspaceFile = useCallback(
    async (targetPath) => {
      if (!targetPath || !window.markdownAPI?.openFileByPath) {
        return;
      }

      if (!confirmDiscardChanges()) {
        return;
      }

      const result = await window.markdownAPI.openFileByPath(targetPath);
      if (!result || result.canceled || !result.filePath) {
        return;
      }

      const docKey = getDocumentKey(result.filePath);
      const contentValue = result.content ?? '';
      setContent(contentValue);
      setFilePath(result.filePath);
      setIsDirty(false);
      focusEditor(editorRef.current);
      const currentWords = computeStats(contentValue).words;
      const docMeta = documents[docKey];
      setLastRecordedWords(docMeta?.lastRecordedWords ?? 0);
      const tags = extractFrontMatterTags(contentValue);
      if (!docMeta) {
        updateDocumentMetadata(docKey, { tags, lastRecordedWords: currentWords });
      } else if (tags.length) {
        updateDocumentMetadata(docKey, { tags });
      } else if (docMeta.tags && docMeta.tags.length) {
        updateDocumentMetadata(docKey, { tags: [] });
      }
    },
    [confirmDiscardChanges, documents, updateDocumentMetadata]
  );

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const handleResizeMouseDown = useCallback(
    (event) => {
      if (isSingleColumn) {
        return;
      }
      event.preventDefault();
      setIsResizing(true);
      updateSplitRatioFromClientX(event.clientX);

      const onMove = (moveEvent) => {
        updateSplitRatioFromClientX(moveEvent.clientX);
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        stopResizing();
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [isSingleColumn, stopResizing, updateSplitRatioFromClientX]
  );

  const handleResizeTouchStart = useCallback(
    (event) => {
      if (isSingleColumn) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      setIsResizing(true);
      updateSplitRatioFromClientX(touch.clientX);

      const onMove = (moveEvent) => {
        const activeTouch = moveEvent.touches?.[0];
        if (!activeTouch) {
          return;
        }
        updateSplitRatioFromClientX(activeTouch.clientX);
      };

      const onEnd = () => {
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onEnd);
        stopResizing();
      };

      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
      window.addEventListener('touchcancel', onEnd);
    },
    [isSingleColumn, stopResizing, updateSplitRatioFromClientX]
  );

  const handleResetSplit = useCallback(() => {
    setSplitRatio(0.5);
  }, []);

  useEffect(() => {
    const disposers = [];

    if (window.markdownAPI?.onNewFile) {
      disposers.push(window.markdownAPI.onNewFile(handleNewDocument));
    }
    if (window.markdownAPI?.onOpenCommand) {
      disposers.push(window.markdownAPI.onOpenCommand(handleOpenDocument));
    }
    if (window.markdownAPI?.onSaveCommand) {
      disposers.push(window.markdownAPI.onSaveCommand(() => handleSaveDocument(false)));
    }
    if (window.markdownAPI?.onSaveAsCommand) {
      disposers.push(window.markdownAPI.onSaveAsCommand(() => handleSaveDocument(true)));
    }

    return () => {
      disposers.forEach((dispose) => {
        if (typeof dispose === 'function') {
          dispose();
        }
      });
    };
  }, [handleNewDocument, handleOpenDocument, handleSaveDocument]);

  const workspaceClass = `workspace ${isSingleColumn ? 'single' : 'split'}`;
  const layoutToggleLabel = isSingleColumn ? '双栏模式' : '单栏模式';
  const headerDocumentLabel = (isDirty || !filePath) ? `${documentName} (未保存)` : documentName;
  const resizerClassName = `split-resizer${isResizing ? ' active' : ''}`;
  const [heatmapTooltip, setHeatmapTooltip] = useState({ visible: false, label: '', x: 0, y: 0 });

  const showHeatmapTooltip = useCallback((event, label) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHeatmapTooltip({
      visible: true,
      label,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  const hideHeatmapTooltip = useCallback(() => {
    setHeatmapTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="title-group">
          <h1 className="app-title">{APP_DISPLAY_NAME}</h1>
          <p className="app-subtitle">{APP_TAGLINE}</p>
          <p className="document-name" title={filePath || '未命名文档'}>
            {headerDocumentLabel}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" onClick={handleNewDocument} className="ghost">
            新建文档
          </button>
          <button type="button" onClick={handleOpenDocument} className="ghost">
            打开…
          </button>
          <button type="button" onClick={() => handleSaveDocument(false)} className="primary">
            保存
          </button>
          <button type="button" onClick={handleToggleLayout} className="ghost">
            {layoutToggleLabel}
          </button>
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar" aria-label="Markdown 文档列表">
          <div className="sidebar-header">
            <div className="sidebar-title">文档</div>
            <button type="button" className="ghost" onClick={handleChooseWorkspace}>
              选择目录
            </button>
          </div>
          <div className="sidebar-path" title={workspacePath || '未选择目录'}>
            {workspacePath || '未选择目录'}
          </div>
          <div className="sidebar-list">
            {workspaceFiles.length === 0 ? (
              <div className="sidebar-empty">暂无 Markdown 文件</div>
            ) : (
              workspaceFiles.map((file) => {
                const isActive = normalizePath(file.path) === normalizePath(filePath || '');
                return (
                  <button
                    key={file.path}
                    type="button"
                    className={`sidebar-item${isActive ? ' active' : ''}`}
                    onClick={() => handleOpenWorkspaceFile(file.path)}
                  >
                    {file.name}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className={workspaceClass} ref={workspaceRef}>
          <section className="editor-pane" aria-label="Markdown 编辑器" style={editorPaneStyle}>
            <textarea
              ref={editorRef}
              spellCheck
              className="editor-input"
              value={content}
              onChange={handleChange}
              placeholder="# 欢迎使用「涌现」\n\n在左侧书写，在右侧即时预览。"
            />
          </section>

          {!isSingleColumn && (
            <div
              className={resizerClassName}
              role="separator"
              aria-orientation="vertical"
              aria-label="调整编辑与预览区域宽度"
              onMouseDown={handleResizeMouseDown}
              onTouchStart={handleResizeTouchStart}
              onDoubleClick={handleResetSplit}
            />
          )}

          <section className="preview-pane" aria-label="Markdown 预览" style={previewPaneStyle}>
            <div className="preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </section>
        </main>

        <aside className="insight-panel" aria-label="写作统计">
          <div className="insight-card">
            <div className="insight-header">
              <span className="insight-title">写作热力图</span>
              <span className="insight-subtitle">近 8 周</span>
            </div>
            <div className="insight-heatmap">
              <div className="heatmap-weekdays">
                {WEEKDAY_LABELS.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className="heatmap-columns">
                {heatmapColumns.map((column, columnIndex) => (
                  <div key={`column-${columnIndex}`} className="heatmap-column">
                    {column.map(({ date, iso }) => {
                      const value = Number(activity[iso]) || 0;
                      const level = getHeatLevel(value, heatmapMax);
                      const tooltip = `${formatDateLabel(date)}：${value} 字`;
                      return (
                        <span
                          key={iso}
                          className={`heatmap-dot level-${level}`}
                          title={tooltip}
                          aria-label={tooltip}
                          onMouseEnter={(event) => showHeatmapTooltip(event, tooltip)}
                          onMouseLeave={hideHeatmapTooltip}
                          onFocus={(event) => showHeatmapTooltip(event, tooltip)}
                          onBlur={hideHeatmapTooltip}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="insight-card">
            <div className="insight-header">
              <span className="insight-title">常用标签</span>
              <span className="insight-subtitle">Front Matter</span>
            </div>
            {tagCounts.length === 0 ? (
              <div className="insight-empty">暂无标签</div>
            ) : (
              <ul className="insight-tag-list">
                {tagCounts.slice(0, 12).map(({ tag, count }) => (
                  <li key={tag}>
                    <span className="tag-name">{formatTagLabel(tag)}</span>
                    <span className="tag-count">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <StatusBar
        characters={stats.characters}
        words={stats.words}
        reading={stats.reading}
        documentName={documentName}
        filePath={filePath}
        isDirty={isDirty}
      />

      {heatmapTooltip.visible && (
        <div
          className="heatmap-tooltip"
          style={{ top: `${heatmapTooltip.y - 8}px`, left: `${heatmapTooltip.x}px` }}
        >
          {heatmapTooltip.label}
        </div>
      )}

    </div>
  );
}

export default App;
