# qBittorrent Quick Tools 与 Torrent 文件重命名实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 RSS 单页完整重构为基于原生 ES Modules 的 qBittorrent Quick Tools，并新增可预览、可选择、带冲突校验的 Torrent 文件批量重命名功能。

**Architecture:** `quick-tools.html` 只负责页面容器，`quick-tools.js` 负责工具标签和延迟初始化；鉴权、qBittorrent API、RSS 工具、Torrent 重命名工具分别放在独立模块。所有生产逻辑先由 Node `node:test` 的失败测试驱动，再进行最小实现和回归验证。

**Tech Stack:** 原生 HTML/CSS、浏览器 ES Modules、Fetch、qBittorrent WebUI API v2、Node.js 22 `node:test`。

## Global Constraints

- 页面入口必须是 `frontend/quick-tools.html`，标题必须是 `qBittorrent Quick Tools`。
- 默认显示“RSS 规则关键词”，另一个标签是“Torrent 文件重命名”。
- 正则只修改完整路径最后的文件名，禁止改变目录结构。
- `flags` 使用独立输入框，默认 `g`，替换支持 `$1`、`$2` 等 JavaScript 捕获组语义。
- 重命名前必须显示逐文件预览；有效变化项默认勾选，允许逐项取消、全选和取消全选。
- 保存逐项顺序执行，首个失败立即停止，之后刷新服务端文件列表；不自动回滚。
- 不引入第三方运行时或测试依赖，不连接真实 qBittorrent 执行自动化测试。
- 保留现有 RSS 规则、安全保存、登录弹窗和 HTTP 403 重试行为。
- 不修改 `.gitignore`、`LICENSE`、`frontend/rulesArray.txt`、`frontend/登录.txt`、`frontend/示例.txt` 的现有用户变更。

---

## 文件结构

- Create: `package.json` — 声明 ES Module 和统一测试脚本。
- Create: `frontend/quick-tools.html` — Quick Tools 页面骨架。
- Create: `frontend/quick-tools.css` — 页面公共样式。
- Create: `frontend/quick-tools.js` — 标签切换和延迟初始化。
- Create: `frontend/auth.js` — 登录交互和认证请求重放。
- Create: `frontend/qbittorrent-api.js` — qBittorrent API 封装。
- Create: `frontend/rss-rules.js` — RSS 领域逻辑和页面控制器。
- Create: `frontend/torrent-renamer.js` — Torrent 重命名领域逻辑和页面控制器。
- Create: `tests/helpers/fake-dom.js` — 多模块共享的最小 DOM 替身。
- Create: `tests/auth.test.js` — 鉴权回归测试。
- Create: `tests/qbittorrent-api.test.js` — API 参数测试。
- Create: `tests/rss-rules.test.js` — RSS 规则回归测试。
- Create: `tests/torrent-renamer.test.js` — 重命名纯逻辑与交互测试。
- Create: `tests/quick-tools.test.js` — 页面结构和标签初始化测试。
- Delete: `frontend/rules.html`、`frontend/rules.js`、`tests/rules.test.js` — 被新架构替代。

### Task 1: 建立 ES Module 测试基础并迁移共享 DOM 替身

**Files:**
- Create: `package.json`
- Create: `tests/helpers/fake-dom.js`
- Modify: `tests/rules.test.js`

**Interfaces:**
- Produces: `FakeElement`、`createFakeDocument()`、`findElements(root, predicate)`、`waitForCondition(predicate)`。
- Produces: `npm test`，执行 `node --test tests/*.test.js`。

- [ ] **Step 1: 写测试基础的失败验证**

在 `tests/quick-tools.test.js` 中先导入尚不存在的 helper：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from './helpers/fake-dom.js';

test('共享 DOM helper 创建 app 容器', () => {
  const { app } = createFakeDocument();
  assert.equal(app.id, 'app');
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/quick-tools.test.js`

Expected: FAIL，提示无法找到 `tests/helpers/fake-dom.js` 或不能按 ES Module 解析。

- [ ] **Step 3: 添加最小 ES Module 配置和 helper**

`package.json`：

```json
{
  "name": "qbittorrent-quick-tools",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.js"
  }
}
```

将现有 `tests/rules.test.js` 中的 `FakeElement`、`createFakeDocument`、`findElements` 和 `waitForCondition` 原样迁移到 `tests/helpers/fake-dom.js`，改为具名导出；保留事件派发、焦点、属性和父子节点行为。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node --test tests/quick-tools.test.js`

Expected: PASS，1 项测试通过。

- [ ] **Step 5: Commit**

```bash
git add package.json tests/helpers/fake-dom.js tests/quick-tools.test.js
git commit -m "test: 建立 Quick Tools 模块测试基础"
```

### Task 2: 抽离共享鉴权模块并迁移全部鉴权回归

**Files:**
- Create: `frontend/auth.js`
- Create: `tests/auth.test.js`
- Modify: `frontend/rules.js`
- Modify: `tests/rules.test.js`

**Interfaces:**
- Produces: `createAuthClient({ documentRef, fetchImpl })`。
- Produces client methods: `authenticatedFetch(url, options)`、`requestLogin()`。
- `authenticatedFetch` 保留现有 HTTP 403、并发、取消、焦点恢复和请求重放语义。

- [ ] **Step 1: 迁移鉴权测试并改为导入新接口**

把原 `tests/rules.test.js` 中从“authenticatedFetch 非 401/403”到登录并发、取消和竞态的测试迁移至 `tests/auth.test.js`。测试通过：

```js
const authClient = createAuthClient({ documentRef: document, fetchImpl });
const responsePromise = authClient.authenticatedFetch('/api/v2/rss/rules', {
  credentials: 'include'
});
```

保留原有请求顺序、登录表单、错误提示、密码清理、共享 Promise 和取消后的断言。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/auth.test.js`

Expected: FAIL，提示无法找到 `frontend/auth.js` 或 `createAuthClient` 未导出。

- [ ] **Step 3: 实现鉴权模块**

将现有 `rules.js` 的登录状态和函数迁入 `createAuthClient` 闭包，避免模块级状态污染测试：

```js
export const createAuthClient = ({ documentRef = document, fetchImpl = fetch } = {}) => {
  const AUTH_REQUIRED_STATUS = 403;
  let loginAttempt = null;
  let successfulLoginVersion = 0;
  let loginCancellationVersion = 0;

  const authenticatedFetch = async (url, options = {}) => {
    // 迁移现有经过测试的 403 登录、并发共享、取消和重放逻辑。
  };

  return { authenticatedFetch, requestLogin };
};
```

登录弹窗的 DOM 结构和中文文案保持现有测试定义。

- [ ] **Step 4: 运行鉴权测试确认 GREEN**

Run: `node --test tests/auth.test.js`

Expected: 全部鉴权迁移测试通过，无未处理 Promise 拒绝。

- [ ] **Step 5: Commit**

```bash
git add frontend/auth.js tests/auth.test.js
git commit -m "refactor: 抽离共享鉴权模块"
```

### Task 3: 抽离 qBittorrent API 模块

**Files:**
- Create: `frontend/qbittorrent-api.js`
- Create: `tests/qbittorrent-api.test.js`

**Interfaces:**
- Consumes: `{ authenticatedFetch(url, options): Promise<Response> }`。
- Produces: `createQbittorrentApi(authenticatedFetch)`。
- Produces methods: `requestRules()`、`setRule(ruleName, ruleDef)`、`requestTorrents()`、`requestTorrentFiles(hash)`、`renameTorrentFile(hash, oldPath, newPath)`。

- [ ] **Step 1: 写五个 API 方法的失败测试**

核心新断言：

```js
await api.requestTorrents();
assert.equal(requests[0].url, '/api/v2/torrents/info?sort=added_on&reverse=true');

await api.requestTorrentFiles('hash value');
assert.equal(requests[1].url, '/api/v2/torrents/files?hash=hash+value');

await api.renameTorrentFile('abc', '目录/旧.mkv', '目录/新.mkv');
assert.equal(requests[2].url, '/api/v2/torrents/renameFile');
assert.equal(requests[2].options.method, 'POST');
assert.equal(requests[2].options.body.get('hash'), 'abc');
assert.equal(requests[2].options.body.get('oldPath'), '目录/旧.mkv');
assert.equal(requests[2].options.body.get('newPath'), '目录/新.mkv');
```

同时迁移现有 `requestRules` 和 `setRule` 的请求与错误测试。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/qbittorrent-api.test.js`

Expected: FAIL，API 工厂不存在。

- [ ] **Step 3: 实现 API 工厂**

每个方法使用共享 `authenticatedFetch`，GET 设置 `credentials: 'include'`，POST 使用 `URLSearchParams`。非成功响应抛出包含操作名、规则名或路径的中文错误。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node --test tests/qbittorrent-api.test.js`

Expected: RSS 与 Torrent API 测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/qbittorrent-api.js tests/qbittorrent-api.test.js
git commit -m "feat: 封装 qBittorrent Quick Tools API"
```

### Task 4: 迁移 RSS 规则模块且保持现有行为

**Files:**
- Create: `frontend/rss-rules.js`
- Create: `tests/rss-rules.test.js`
- Modify: `frontend/rules.js`
- Modify: `tests/rules.test.js`

**Interfaces:**
- Consumes API methods: `requestRules()`、`setRule(ruleName, ruleDef)`。
- Produces pure functions: `parseKeywordInput`、`extractKeywords`、`buildOrdinaryMustContain`、`createEditorState`、`createSavePlan`、`executeSavePlan`。
- Produces: `createRssRulesTool({ root, api, documentRef })`，返回 `initialize()` 和 `refresh()`。

- [ ] **Step 1: 将 RSS 测试迁移为 ES Module 导入**

把原单体测试中所有 RSS 纯函数、标签编辑、渲染、保存按钮、安全保存顺序、成功刷新和失败重读测试迁移到 `tests/rss-rules.test.js`。调用形式改为直接导入和控制器工厂：

```js
const tool = createRssRulesTool({ root: app, api, documentRef: document });
await tool.initialize();
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/rss-rules.test.js`

Expected: FAIL，`frontend/rss-rules.js` 不存在。

- [ ] **Step 3: 迁移 RSS 生产逻辑**

将原 `rules.js` 中 RSS 纯函数和编辑器状态迁入新模块。把隐式全局 `document` 和 API 函数改为工厂参数；保留所有中文文案、DOM 行为和安全保存顺序。

- [ ] **Step 4: 运行 RSS 测试确认 GREEN**

Run: `node --test tests/rss-rules.test.js`

Expected: 原有 RSS 行为测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/rss-rules.js tests/rss-rules.test.js
git commit -m "refactor: 迁移 RSS 规则工具模块"
```

### Task 5: 以 TDD 实现 Torrent 文件名预览与冲突校验

**Files:**
- Create: `frontend/torrent-renamer.js`
- Create: `tests/torrent-renamer.test.js`

**Interfaces:**
- Produces: `filterTorrents(torrents, query)`。
- Produces: `splitTorrentPath(path): { directory: string, fileName: string }`。
- Produces: `buildRenamePreview(files, { matchRegex, replaceRegex, flags })`，返回 `{ error, items }`。
- Preview item: `{ index, oldPath, oldFileName, newPath, newFileName, status, isValid, isSelected }`。

- [ ] **Step 1: 写搜索、路径和正则替换失败测试**

```js
test('仅替换最后文件名并保留目录', () => {
  const preview = buildRenamePreview(
    [{ index: 0, name: '目录/S01E01.old.mkv' }],
    { matchRegex: '\\.old', replaceRegex: '', flags: 'g' }
  );
  assert.equal(preview.items[0].newPath, '目录/S01E01.mkv');
});

test('支持捕获组和忽略大小写', () => {
  const preview = buildRenamePreview(
    [{ index: 0, name: 'SHOW.01.MKV' }],
    { matchRegex: 'show\\.(\\d+)', replaceRegex: 'Episode-$1', flags: 'gi' }
  );
  assert.equal(preview.items[0].newFileName, 'Episode-01.MKV');
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/torrent-renamer.test.js`

Expected: FAIL，重命名纯函数不存在。

- [ ] **Step 3: 实现最小搜索与预览函数**

搜索使用名称和 hash 的小写包含匹配。预览为每个文件重新使用可靠的正则状态，避免 `g` 或 `y` 的 `lastIndex` 污染；只对 `file.name` 最后一个 `/` 后的部分调用 `replace`。

- [ ] **Step 4: 写校验失败测试**

分别覆盖无匹配、无变化、空名称、`.`、`..`、`/`、`\\`、重复目标和目标已存在。冲突项必须满足：

```js
assert.equal(item.isValid, false);
assert.equal(item.isSelected, false);
assert.match(item.status, /冲突|无效|未匹配|无变化/);
```

- [ ] **Step 5: 运行校验测试确认 RED**

Run: `node --test tests/torrent-renamer.test.js`

Expected: FAIL，至少一个无效或冲突场景仍被标记为有效。

- [ ] **Step 6: 实现完整校验并确认 GREEN**

先生成全部候选路径，再统计目标路径数量并与原路径集合比较；任何占用或重复目标都标为不可保存。有效变化项默认 `isSelected: true`。

Run: `node --test tests/torrent-renamer.test.js`

Expected: 搜索、路径、替换和校验测试全部通过。

- [ ] **Step 7: Commit**

```bash
git add frontend/torrent-renamer.js tests/torrent-renamer.test.js
git commit -m "feat: 添加 Torrent 文件重命名预览"
```

### Task 6: 实现 Torrent 重命名页面控制器与顺序保存

**Files:**
- Modify: `frontend/torrent-renamer.js`
- Modify: `tests/torrent-renamer.test.js`

**Interfaces:**
- Consumes API: `requestTorrents()`、`requestTorrentFiles(hash)`、`renameTorrentFile(hash, oldPath, newPath)`。
- Produces: `createTorrentRenamerTool({ root, api, documentRef })`，返回 `initialize()` 和 `refresh()`。
- Internal save contract: 只保存 `isValid && isSelected` 的预览项，按文件原顺序执行。

- [ ] **Step 1: 写加载、搜索、单选和预览交互失败测试**

构造两个 Torrent 和多个文件，断言初始化请求一次 Torrent 列表、搜索同时匹配名称/hash、选择 Torrent 后请求其文件、输入正则后渲染默认勾选预览。

- [ ] **Step 2: 运行交互测试确认 RED**

Run: `node --test tests/torrent-renamer.test.js`

Expected: FAIL，控制器工厂不存在或未渲染控件。

- [ ] **Step 3: 实现控制器渲染和状态更新**

控制器持有 Torrent 列表、筛选词、当前 Torrent、文件列表、正则草稿、预览选择和忙碌状态。输入改变时重新计算预览；全选只选有效项，取消全选清空选择。

- [ ] **Step 4: 写顺序保存和失败刷新测试**

```js
assert.deepEqual(renameCalls.map(call => call.oldPath), ['a.old.mkv', 'b.old.mkv']);
assert.equal(maxConcurrentRenames, 1);
```

失败场景让第二项抛错，断言第三项未调用、文件列表被重新读取、状态包含“成功 1 项”和失败文件。

- [ ] **Step 5: 运行保存测试确认 RED**

Run: `node --test tests/torrent-renamer.test.js`

Expected: FAIL，保存按钮或顺序停止逻辑尚未实现。

- [ ] **Step 6: 实现保存和刷新**

使用 `for...of` 串行等待。捕获首个错误后保留成功数量和失败项；`finally` 中恢复控件状态，保存完成后调用当前 Torrent 文件刷新并以服务端结果重建预览。

- [ ] **Step 7: 运行测试确认 GREEN**

Run: `node --test tests/torrent-renamer.test.js`

Expected: Torrent 工具全部测试通过。

- [ ] **Step 8: Commit**

```bash
git add frontend/torrent-renamer.js tests/torrent-renamer.test.js
git commit -m "feat: 添加 Torrent 文件批量重命名交互"
```

### Task 7: 建立 Quick Tools 页面并删除旧入口

**Files:**
- Create: `frontend/quick-tools.html`
- Create: `frontend/quick-tools.css`
- Create: `frontend/quick-tools.js`
- Modify: `tests/quick-tools.test.js`
- Delete: `frontend/rules.html`
- Delete: `frontend/rules.js`
- Delete: `tests/rules.test.js`

**Interfaces:**
- Consumes: `createAuthClient`、`createQbittorrentApi`、`createRssRulesTool`、`createTorrentRenamerTool`。
- Produces: `initializeQuickTools({ documentRef })`。

- [ ] **Step 1: 写 HTML 和标签行为失败测试**

断言 HTML 包含：

```js
assert.match(html, /<title>qBittorrent Quick Tools<\/title>/);
assert.match(html, />RSS 规则关键词</);
assert.match(html, />Torrent 文件重命名</);
assert.match(html, /<script type="module" src="\.\/quick-tools\.js(?:\?[^\"]+)?"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\.\/quick-tools\.css(?:\?[^\"]+)?"/);
```

控制器测试断言默认只初始化 RSS，首次切换到 Torrent 时才初始化 Torrent，往返切换不重复初始化。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test tests/quick-tools.test.js`

Expected: FAIL，Quick Tools 文件不存在。

- [ ] **Step 3: 创建页面、样式和入口**

HTML 提供 `#rss-rules-tool` 和 `#torrent-renamer-tool` 容器。入口只创建一次共享 auth/api；使用按钮的 `aria-selected`、面板 `hidden` 和键盘可聚焦结构切换工具。CSS 迁移现有视觉并补充响应式双栏、Torrent 列表和预览表。

- [ ] **Step 4: 删除旧入口并更新所有测试引用**

确认没有代码或测试继续引用 `rules.html`、`rules.js`、`initializeRulesPage` 或旧 VM 加载器，然后删除旧文件。

- [ ] **Step 5: 运行完整测试确认 GREEN**

Run: `npm test`

Expected: 所有 auth、API、RSS、Torrent 和 Quick Tools 测试通过。

- [ ] **Step 6: Commit**

```bash
git add frontend/quick-tools.html frontend/quick-tools.css frontend/quick-tools.js tests/quick-tools.test.js frontend/rules.html frontend/rules.js tests/rules.test.js
git commit -m "refactor: 合并 qBittorrent Quick Tools 页面"
```

### Task 8: 文档、静态检查和最终回归

**Files:**
- Modify: `plans/2026-08-04_torrent-file-rename.md`
- Modify: `sessions/session_2026-08-04.md`

**Interfaces:**
- Produces: 可部署的 `frontend/quick-tools.html` 及完整验证记录。

- [ ] **Step 1: 运行语法检查**

Run:

```bash
node --check frontend/auth.js
node --check frontend/qbittorrent-api.js
node --check frontend/rss-rules.js
node --check frontend/torrent-renamer.js
node --check frontend/quick-tools.js
```

Expected: 全部退出码为 0，无输出。

- [ ] **Step 2: 运行完整测试**

Run: `npm test`

Expected: 全部测试通过，无失败、跳过或未处理拒绝。

- [ ] **Step 3: 运行格式和差异检查**

Run:

```bash
npx prettier --check package.json frontend/quick-tools.html frontend/quick-tools.css frontend/quick-tools.js frontend/auth.js frontend/qbittorrent-api.js frontend/rss-rules.js frontend/torrent-renamer.js tests/helpers/fake-dom.js tests/auth.test.js tests/qbittorrent-api.test.js tests/rss-rules.test.js tests/torrent-renamer.test.js tests/quick-tools.test.js docs/2026-08-04_torrent-file-rename-design.md plans/2026-08-04_torrent-file-rename.md sessions/session_2026-08-04.md
git diff --check
```

Expected: Prettier 报告全部文件格式正确；`git diff --check` 无输出。

- [ ] **Step 4: 检查最小影响范围**

Run:

```bash
git status --short
git diff --stat
rg -n "rules\.html|rules\.js|initializeRulesPage" frontend tests
```

Expected: 本功能只新增/修改设计列出的文件；`rg` 无旧入口引用。已有用户修改仍保持原状态且未被纳入本功能提交。

- [ ] **Step 5: 追加会话记录并提交功能变更**

会话记录必须包含需求确认、改动文件、验证结果和未覆盖的真实 qBittorrent 5.0 联调风险。

```bash
git add package.json frontend tests plans/2026-08-04_torrent-file-rename.md sessions/session_2026-08-04.md
git commit -m "feat: 添加 Torrent 文件批量重命名工具"
```
