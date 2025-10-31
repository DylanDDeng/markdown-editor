# 涌现 Emergence

**涌现 (Emergence)** 是一款基于 Electron 的 macOS 原生 Markdown 编辑器，强调即时预览、沉浸写作与可扩展的文件管理体验。本仓库当前处于初始搭建阶段，包含核心窗口管理、编辑/预览界面与开发脚本，便于后续持续迭代。

## 功能亮点（规划中）
- Markdown 实时编辑与预览双栏布局
- 字数统计与预计阅读时长
- 支持多窗口 / 标签、文件管理、导出 PDF/HTML
- 插入图片、主题切换、命令面板与快捷键系统
- 插件扩展机制、自动更新、崩溃恢复等增强功能

## 当前实现
- Electron 主进程窗口管理与 macOS 菜单配置
- 预加载脚本暴露安全的菜单事件通道
- React + Vite 渲染层：Markdown 编辑区、预览区、状态栏统计与单双栏切换
- 编辑/预览分栏支持拖拽调节宽度，双栏与单栏随时切换
- 简易 Markdown 解析器（支持标题、列表、引用、代码块、内联格式）
- 文件打开/保存对话框（Cmd/Ctrl + O / S，或顶部按钮）
- LaTeX 数学公式（内联 `$...$` 与块级 `$$...$$`，基于 KaTeX 渲染）
- 文档侧栏：选择目录后在左侧列出所有 Markdown 文件，一键切换
- 写作热力图：基于每日保存时的字数增量，展示最近 28 周的活跃度
- YAML 标签统计：解析文档 Front Matter 的 `tags` 字段，侧栏列出常用标签

## 快速开始
1. 安装依赖：
   ```bash
   npm install
   ```
2. 启动开发模式（Vite + Electron 热更新）：
   ```bash
   npm run dev
   ```
3. 预览生产包（需先构建渲染层）：
   ```bash
   npm run build
   npm start
   ```

## 项目结构
```
.
├── package.json
├── vite.config.cjs
└── src
    ├── main
    │   └── main.js          # Electron 主进程逻辑
    ├── preload
    │   └── index.js         # 渲染层可用 API
    └── renderer
        ├── App.jsx          # React 主界面
        ├── index.html
        ├── main.jsx         # React 入口
        ├── markdown.js      # Markdown 解析器
        └── styles.css       # 基础样式
```

## 文件操作
- `Cmd/Ctrl + N`：新建空白文档（如当前文档未保存，会询问是否放弃更改）
- `Cmd/Ctrl + O`：打开 Markdown 文件（支持 `.md`/`.markdown`/`.mdx`/`.txt`）
- `Cmd/Ctrl + S`：保存当前文档；对未命名文件会弹出“另存为”对话框
- `Shift + Cmd/Ctrl + S`：另存为新文件
- 顶部按钮也提供“新建”“打开”“保存”快捷入口
- “选择目录”按钮可指定工作目录，并在左侧侧栏列出所有 Markdown 文档，点击即可切换
- 右侧洞察面板展示最近 28 周写作热力图与常用标签
- 文档中若使用 YAML Front Matter 定义 `tags`，保存后会自动计入常用标签统计

## 后续计划
- [ ] 最近文件列表与会话恢复
- [ ] 自动保存、崩溃恢复与草稿机制
- [ ] 更完善的 Markdown 渲染（含表格、脚注、任务列表等）
- [ ] 主题/外观自定义与可插拔样式系统
- [ ] 测试基线（单元、端到端）与持续集成配置

欢迎基于「涌现」的骨架继续扩展理想的 Markdown 写作体验。
