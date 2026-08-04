# Torrent 文件原始与预览双行展示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选中 Torrent 后立即显示原始文件列表，并在输入有效正则后为每个文件追加紧邻的替换预览行。

**Architecture:** 保持 `buildRenamePreview` 纯逻辑不变，在 `createTorrentRenamerTool` 的渲染层组合 `files` 和 `preview.items`。表格以原始文件为主序列：无有效预览时只渲染原始行，有有效正则时按“原始行 + 预览行”成组渲染。

**Tech Stack:** 原生 ES Modules、DOM API、Node.js `node:test`、现有 Fake DOM。

## Global Constraints

- 原始行必须在文件接口返回后立即显示，不依赖正则输入。
- 输入有效正则后，每个文件的原始行与预览行必须相邻。
- 选择框只出现在预览行。
- 文件名称显示完整相对路径 `oldPath` 和 `newPath`。
- 不修改正则生成、冲突校验、串行保存和 API 请求语义。
- 不修改 RSS、鉴权和 API 模块。

---

### Task 1: 以 TDD 实现文件原始行和相邻预览行

**Files:**

- Modify: `frontend/torrent-renamer.js`
- Modify: `tests/torrent-renamer.test.js`
- Modify: `frontend/quick-tools.css`

**Interfaces:**

- Consumes: `files: Array<{index?: number, name: string}>`、`preview.items`。
- Produces DOM classes: `rename-original-row`、`rename-preview-row`、`rename-row-type`。

- [x] **Step 1: 写选中 Torrent 后立即显示原始文件的失败测试**

在现有初始化交互测试中，选择 Torrent 并等待文件请求完成，但不填写正则，断言：

```js
const originalRows = findElements(app, element => element.className === 'rename-original-row');
assert.equal(originalRows.length, 2);
assert.equal(originalRows[0].textContent.includes('season/a.old.mkv'), true);
assert.equal(originalRows[1].textContent.includes('season/readme.txt'), true);
assert.equal(findPreviewCheckboxes(app).length, 0);
```

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test tests/torrent-renamer.test.js`

Expected: FAIL，当前正则为空时表格没有文件行。

- [x] **Step 3: 实现原始文件行渲染**

新增 `createOriginalRow(file)`，使用完整 `file.name`，类型为“原始文件”，状态为“待输入匹配正则”。`renderPreview()` 在 `files` 已加载但 `preview.items` 为空时仍按文件顺序渲染原始行。

- [x] **Step 4: 写相邻双行和选择框位置的失败测试**

输入 `\.old` 后断言表格行顺序：

```js
assert.deepEqual(
  previewBody.children.map(row => row.className),
  ['rename-original-row', 'rename-preview-row', 'rename-original-row', 'rename-preview-row']
);
assert.equal(previewBody.children[0].textContent.includes('season/a.old.mkv'), true);
assert.equal(previewBody.children[1].textContent.includes('season/a.mkv'), true);
assert.equal(findPreviewCheckboxes(app).length, 2);
```

- [x] **Step 5: 运行测试确认 RED**

Run: `node --test tests/torrent-renamer.test.js`

Expected: FAIL，当前每个文件只生成单行左右列预览。

- [x] **Step 6: 实现相邻双行表格**

将表头改为“保存、类型、文件名称、状态”。每个 `preview.items` 按 `oldPath`/文件位置匹配对应文件，依次追加原始行和预览行。预览行使用 `newPath`、现有状态和选择框；原始行不创建复选框。

- [x] **Step 7: 补充无效正则、未匹配和刷新文件测试**

- 无效正则：原始行仍存在，预览行数量为 0，状态显示错误。
- 未匹配：原始行和预览行都存在，预览选择框禁用。
- 刷新文件：旧行被最新服务端文件行替换，不残留旧路径。

- [x] **Step 8: 增加双行视觉样式**

在 `quick-tools.css` 增加原始行、预览行、类型列和分组边框样式；不改现有响应式布局和表格滚动结构。

- [x] **Step 9: 运行完整验证**

Run:

```bash
node --test tests/torrent-renamer.test.js
npm test
node --check frontend/torrent-renamer.js
npx prettier --check frontend/torrent-renamer.js frontend/quick-tools.css tests/torrent-renamer.test.js docs/2026-08-04_torrent-file-paired-preview-design.md plans/2026-08-04_torrent-file-paired-preview.md sessions/session_2026-08-04.md
git diff --check -- frontend/torrent-renamer.js frontend/quick-tools.css tests/torrent-renamer.test.js docs/2026-08-04_torrent-file-paired-preview-design.md plans/2026-08-04_torrent-file-paired-preview.md sessions/session_2026-08-04.md
```

Expected: 定向与全量测试通过，语法、格式和功能范围差异检查无错误。
