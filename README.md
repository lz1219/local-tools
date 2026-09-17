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
| 正则测试器 | [regex/regex.html](regex/regex.html) | 实时匹配高亮、分组捕获、替换预览、正则速查 |
| 文本工具箱 | [text/text.html](text/text.html) | 字数统计、大小写转换、行处理、全半角互转 |
| 随机生成器 | [gen/gen.html](gen/gen.html) | UUID v4、随机密码（熵强度提示）、随机数字/端口 |
| JWT 解析 | [jwt/jwt.html](jwt/jwt.html) | 解码 Header/Payload，过期时间与剩余有效期提醒 |
| 哈希计算 | [hash/hash.html](hash/hash.html) | MD5 / SHA-1 / SHA-256 / SHA-512，文本与文件 |
| 颜色工具 | [color/color.html](color/color.html) | HEX/RGB/HSL 互转、配色板、WCAG 对比度检测 |
| 电子木鱼 | [fish/fish.html](fish/fish.html) | 连击、自动模式、功德持久化的解压小玩具 |
| 曼德博分形 | [fractal/fractal.html](fractal/fractal.html) | Canvas 渲染，拖拽缩放探索，四种调色板 |
| 幸运转盘 | [wheel/wheel.html](wheel/wheel.html) | 自定义选项抽签转盘，音效与中奖移除 |

## 使用方式

直接双击打开 `index.html`，或部署到任意静态托管（GitHub Pages 等）。

## 开发

- 公共样式与工具函数在 `assets/common.css`、`assets/common.js`，新工具页引用即可保持统一风格
- 回归测试：`node test-pages.js`（Node vm + DOM stub，无需浏览器）
