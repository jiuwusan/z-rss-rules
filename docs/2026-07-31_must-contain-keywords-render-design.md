# mustContainKeywords 页面渲染设计

## 目标

读取 qBittorrent RSS 规则后，按接口对象中的规则名展示每条规则的 `mustContainKeywords`。规则没有关键词时仍需展示，并显示“无关键词”。

## 数据处理

- 接口 `GET /api/v2/rss/rules` 返回以规则名为键、规则定义为值的对象。
- 转换数组时新增 `name` 字段，不再丢失对象键中的规则名。
- `mustContainKeywords` 继续从 `mustContain` 首个括号内容中按 `|` 拆分。
- 缺少括号内容时，`mustContainKeywords` 统一为 `[]`，便于渲染层处理。
- 保留现有 `mustNotContainKeywords` 的提取与全局排除词过滤行为。

## 页面结构

- `#app` 中按接口顺序渲染规则区块。
- 每个区块包含规则名称和关键词列表。
- 有关键词时逐项展示；无关键词时展示“无关键词”。
- 使用 `document.createElement` 和 `textContent` 写入接口数据，避免将规则名或关键词直接拼接为 HTML。

## 错误处理

- HTTP 非成功状态视为加载失败。
- 请求或解析失败时清空当前内容并显示“规则加载失败”。
- 详细异常保留在浏览器控制台，页面不展示接口敏感信息。

## 测试

使用 Node.js 内置 `node:test`，不增加依赖。测试直接加载 `rules.html` 中的脚本并提供最小 DOM 替身，覆盖：

1. 转换结果保留 `name` 并正确提取多个关键词。
2. 有关键词规则按规则名展示关键词。
3. 无关键词规则按规则名展示“无关键词”。
4. 加载失败时展示统一错误信息。

## 范围

本次只修改 `frontend/rules.html` 并新增对应测试，不修改样例数据，不扩展规则编辑、同步或登录功能。
