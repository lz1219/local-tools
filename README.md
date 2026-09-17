# 本地工具箱

纯前端实现的本地小工具集合，无需联网、无需构建，双击 `index.html` 即可使用，数据不出本机。

## 工具列表

| 工具 | 路径 | 说明 |
|------|------|------|
| JSON 序列化 | [json-tools/json.html](json-tools/json.html) | 格式化 / 压缩 / 校验 / 转义 / 折叠树形浏览 |
| 字符串替换 | [str/replace.html](str/replace.html) | 多条规则顺序替换，支持增删规则 |
| Base64 / URL 编解码 | [encode/encode.html](encode/encode.html) | Base64 与 URL 双向转换，Unicode 自动处理 |
| 节点链接解析 | [node/node.html](node/node.html) | vmess / trojan / ss / ssr 链接解析编辑与重新生成 |
| 文本对比 Diff | [diff/diff.html](diff/diff.html) | 逐行对比，高亮增删，统计差异 |
| 时间戳转换 | [time/time.html](time/time.html) | 时间戳与日期互转，秒/毫秒自动识别 |
| 图片处理 | [img/img.html](img/img.html) | 本地压缩、缩放、格式转换，支持拖拽与粘贴截图 |
| Markdown 表格 ↔ CSV | [table/table.html](table/table.html) | Markdown 表格与 CSV/TSV 互转，自动识别方向 |

## 使用方式

直接双击打开 `index.html`，或部署到任意静态托管（GitHub Pages 等）。

## 开发

- 公共样式与工具函数在 `assets/common.css`、`assets/common.js`，新工具页引用即可保持统一风格
- 回归测试：`node test-pages.js`（Node vm + DOM stub，无需浏览器）
