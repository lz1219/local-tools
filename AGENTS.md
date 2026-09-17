# AGENTS.md

本文件为 AI 编码助手（Codex / Claude / Cursor 等）提供本仓库的工作约定。

## 项目简介

纯前端的本地小工具集合，无构建步骤、无外部依赖，所有页面可直接以 `file://` 打开。
统一浅色主题，公共样式与工具函数集中在 `assets/`。

## 目录结构

- `index.html` — 工具箱入口，所有工具的导航卡片都在这里维护
- `assets/common.css` / `assets/common.js` — 共享主题与工具函数，各工具页必须引用，不要内联复制
- `json-tools/`、`str/`、`encode/`、`node/`、`diff/`、`time/` — 每个工具一个目录，主文件与该目录同名（如 `diff/diff.html`）
- `test-pages.js` — Node vm + DOM stub 的回归测试，覆盖所有工具页的核心逻辑

## 新工具页规范

1. 在根目录新建目录，主文件与目录同名；`<head>` 中引用 `../assets/common.css`，body 末尾先引 `../assets/common.js` 再写页面脚本
2. 页面结构遵循统一约定：`h1` + `.subtitle`，内容区用 `.panel` 包裹，面板头部用 `.panel-header`
3. 文本编辑器统一用 `.editor-wrap` + `.line-numbers` 结构，通过 `bindEditor(textareaId, gutterId, badgeId?)` 绑定行号与滚动同步；输入框 id 用 `input`，输出用 `output`，行号 gutter 用 `inputLines`/`outputLines`，大小徽章用 `sizeBadge`，状态徽章用 `statusBadge`
4. 按钮语义固定：主操作 `.btn-primary`，成功/复制类 `.btn-success`，次操作 `.btn-outline`，警示 `.btn-warning`，删除/清空 `.btn-danger`（可配 `.btn-sm`）
5. 提示一律用 `showToast(msg)`；页面需包含 `<div id="toast"></div>`
6. 界面文案使用中文；id 与 class 使用英文
7. 完成后在 `index.html` 添加导航卡片，并更新 `README.md` 的工具列表

## 测试要求

- 任何代码修改后必须运行 `node test-pages.js`，全部通过才可提交
- 新工具页需在 `test-pages.js` 中补充核心逻辑的断言（解析/转换类函数做回环验证，UI 渲染做关键标记检查）
- 测试环境无浏览器，DOM 一律使用 stub，不要引入 jsdom 等依赖

## 其他约定

- 质量原则：要么不做，做就做到极致——功能完整、边界情况有处理、交互有反馈、测试有覆盖；不接受半成品或"先这样"式的实现
- 不引入 CDN、npm 依赖或构建工具；确需新能力时优先用浏览器原生 API
- 工具不联网、不收集数据；涉及剪贴板仅用 `navigator.clipboard`
- 提交信息用中文一句话概括改动
