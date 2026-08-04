# qBittorrent Quick Tools 与 Torrent 文件重命名设计

## 1. 目标

将现有 RSS 规则关键词页面重构为通用工具页 `frontend/quick-tools.html`，标题使用 `qBittorrent Quick Tools`，并在同一页面提供：

- RSS 规则关键词维护。
- Torrent 下文件批量重命名。

Torrent 文件重命名功能按添加时间倒序读取 Torrent，支持前端搜索、单选 Torrent、正则批量生成新文件名、逐文件预览和选择，并通过 qBittorrent WebUI API 顺序保存。

## 2. 页面与模块架构

前端继续使用无构建工具的纯静态部署方式，改用浏览器原生 ES Modules：

- `frontend/quick-tools.html`：页面骨架、标题和两个工具标签。
- `frontend/quick-tools.css`：公共布局、表单、列表、表格和登录弹窗样式。
- `frontend/quick-tools.js`：标签切换和工具初始化入口。
- `frontend/auth.js`：登录弹窗、HTTP 403 登录重试、并发登录共享和取消处理。
- `frontend/qbittorrent-api.js`：封装 RSS 规则、Torrent 列表、Torrent 文件列表和文件重命名 API。
- `frontend/rss-rules.js`：RSS 规则领域计算、渲染和保存控制器。
- `frontend/torrent-renamer.js`：Torrent 搜索、文件名替换预览、选择和批量保存控制器。

增加最小 `package.json` 声明 ES Module，并将测试按模块职责拆分。删除被替代的 `frontend/rules.html`、`frontend/rules.js` 和单体 `tests/rules.test.js`，不保留废弃代码或注释块。

## 3. 页面交互

### 3.1 工具标签

- 页面顶部显示 `qBittorrent Quick Tools`。
- 提供“RSS 规则关键词”和“Torrent 文件重命名”两个标签。
- 默认显示 RSS 工具。
- 首次进入某个工具时加载数据；再次切换回来保留已加载数据、输入草稿和错误状态。
- 每个工具提供自己的刷新入口，不因切换标签自动重复请求。

### 3.2 响应式布局

- 桌面端 Torrent 列表与重命名编辑区左右排列。
- 窄屏下改为纵向排列。
- 预览表允许横向滚动，避免长文件名破坏页面宽度。

## 4. 共享鉴权

- RSS 与 Torrent API 请求统一使用 `authenticatedFetch`。
- 未登录或鉴权失效以 HTTP 403 识别。
- 并发 403 请求共享同一个登录弹窗和登录 Promise。
- 登录成功后重放原请求；凭据错误时保留弹窗并允许再次提交。
- 取消登录会拒绝等待中的请求，不继续静默重试。
- 登录凭据只用于当次请求，关闭或失败时清空密码输入。

现有鉴权行为和回归测试全部迁移，不因模块拆分改变语义。

## 5. qBittorrent API

### 5.1 RSS 规则

- `GET /api/v2/rss/rules`
- `POST /api/v2/rss/setRule`

现有字段生成、安全分阶段保存和失败重读行为保持不变。

### 5.2 Torrent 列表

请求：

```text
GET /api/v2/torrents/info?sort=added_on&reverse=true
```

- 接口结果按添加时间倒序展示。
- 搜索在浏览器内执行，匹配 Torrent 名称或 hash，不额外发送搜索请求。
- Torrent 只允许单选。

### 5.3 Torrent 文件列表

请求：

```text
GET /api/v2/torrents/files?hash=<torrent hash>
```

切换 Torrent 时废弃前一个 Torrent 的预览选择，并以新返回的文件列表重新计算预览。

### 5.4 文件重命名

请求：

```text
POST /api/v2/torrents/renameFile
```

请求体使用 `URLSearchParams`，字段为：

- `hash`：当前 Torrent hash。
- `oldPath`：接口返回的原完整相对路径。
- `newPath`：保留原目录，仅替换最后文件名后的完整相对路径。

所有 API 请求设置 `credentials: "include"`，非成功响应转换为包含操作上下文的异常。

## 6. 正则替换语义

页面提供三个输入：

- `matchRegex`：JavaScript 正则表达式正文，不包含 `/` 定界符。
- `replaceRegex`：传给 `String.prototype.replace` 的替换文本，支持 `$1`、`$2` 等捕获组。
- `flags`：JavaScript 正则标志，默认 `g`，允许浏览器支持的 `g`、`i`、`m`、`s`、`u`、`y`、`d`、`v` 组合。

输入变化时即时重新计算预览。正则无法编译时显示错误并禁用保存，不保留上一次有效预览作为可保存状态。

替换只作用于完整路径最后一个 `/` 之后的文件名。原目录部分保持不变；根目录文件直接使用新文件名作为 `newPath`。

## 7. 预览与校验

预览表显示：

- 是否保存。
- 原文件名。
- 新文件名。
- 状态。

有效且发生变化的匹配项默认勾选。用户可以逐项取消，也可以全选或取消全选有效项。

以下项目不可勾选和保存：

- 正则未匹配。
- 替换后文件名没有变化。
- 新文件名为空、`.` 或 `..`。
- 新文件名包含 `/` 或 `\\`，防止改变目录结构。
- 多个文件生成相同 `newPath`。
- `newPath` 已被当前 Torrent 中另一文件占用。

目标路径占用校验以本次读取到的完整文件列表为准。即使占用该路径的文件也计划重命名，本次仍视为冲突，不实现依赖排序或临时文件名交换，避免部分失败导致路径状态难以预测。

保存按钮仅在存在至少一个已勾选有效项、正则有效且页面不忙碌时启用。

## 8. 保存顺序与失败处理

- 按文件列表原顺序逐项调用 `renameFile`。
- 任一请求失败后立即停止后续写入。
- qBittorrent API 不提供批量事务，本功能不宣称原子性，也不自动回滚已经成功的重命名。
- 无论全部成功还是中途失败，保存结束后都重新读取当前 Torrent 文件列表。
- 全部成功时显示成功数量。
- 部分失败时显示已成功数量、失败文件和错误原因；刷新后的服务端状态作为页面真实状态。
- 保存期间禁用 Torrent 选择、正则输入、预览选择、刷新和保存按钮。

## 9. RSS 功能迁移约束

- 普通规则和 `Pure-HDSWEB` 的识别与字段生成逻辑不变。
- Pure 安全排除、普通规则更新和 Pure 最终清理的保存顺序不变。
- 登录、关键词标签输入、占位关键词 `九五三`、失败重读和可信 Pure 固定排除项行为不变。
- 页面级 `rules` 命名改为 `quickTools`；RSS 领域函数和变量继续保留清晰的 `rules` 或 `rss` 语义。

## 10. 测试范围

使用 Node.js 内置 `node:test`，不引入第三方运行时或测试依赖。测试拆分覆盖：

1. 现有 RSS 纯函数、页面交互、安全保存计划和失败恢复完整迁移。
2. 登录弹窗、凭据校验、403 重试、并发共享、取消和竞态。
3. RSS、Torrent 列表、Torrent 文件和 `renameFile` API 的 URL、方法、凭据和表单参数。
4. Torrent 名称/hash 搜索和添加时间倒序展示输入。
5. 路径拆分与重组、正则 flags、全局替换和捕获组替换。
6. 无匹配、无变化、无效文件名、重复目标和已存在目标冲突。
7. 预览默认选择、逐项选择、全选和取消全选。
8. 顺序保存、首项失败停止、成功后刷新和失败后刷新。
9. `quick-tools.html` 标题、工具标签、样式和 ES Module 入口。

测试通过受控 Fetch 和最小 DOM 替身运行，不连接真实 qBittorrent。

## 11. 范围限制与风险

- 不实现目录重命名或跨目录移动。
- 不实现多 Torrent 同时选择或跨 Torrent 批量保存。
- 不实现重命名事务、自动回滚、依赖排序或临时文件名交换。
- 不将正则草稿保存到本地存储。
- 不修改 qBittorrent 自带 WebUI，只维护当前同源独立工具页部署。
- qBittorrent 5.0 WebUI API 的真实服务兼容性无法由单元测试覆盖，需要部署后进行一次人工联调。
- 当前工作区已有 `.gitignore`、`LICENSE` 和若干 `frontend/*.txt` 用户修改，本次不修改或格式化这些文件。
