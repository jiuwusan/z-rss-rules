# Quick Tools 侧边导航与 Torrent 重命名弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Quick Tools 改为左侧功能导航、右侧功能内容，并让 Torrent 页面优先展示种子列表，通过“重命名”按钮打开弹窗完成文件预览与保存。

**Architecture:** 保留 `quick-tools.js` 现有 tab/tabpanel 切换和懒加载机制，只调整 HTML 容器与 CSS 布局。`torrent-renamer.js` 继续独立管理 Torrent 数据和重命名状态，但把常驻编辑器拆为主列表与按需创建的模态弹窗，并用请求版本号防止关闭或切换后的迟到响应污染状态。

**Tech Stack:** 原生 HTML、CSS、JavaScript ES Modules、Node.js `node:test`、项目 Fake DOM。

## Global Constraints

- 代码注释与文档使用中文。
- 优先最小改动，不修改 qBittorrent API、鉴权、RSS 数据结构和 `buildRenamePreview` 算法。
- 不迁移或恢复旧项目中已注释的代码。
- 桌面端左侧功能导航、右侧完整内容；小于 `760px` 时导航移动到内容上方。
- Torrent 主页面只展示搜索、刷新和种子列表，点击“重命名”按钮后才请求文件。
- 保存成功后弹窗保持打开并刷新文件；保存期间禁止关闭。
- 关闭弹窗必须清理编辑状态、失效旧文件请求，并把焦点还给触发按钮。
- 不引入新依赖，不进行无关格式化和大规模重构，不自动 Push。

---

## 文件职责映射

- `frontend/quick-tools.html`：提供页面标题、左侧功能导航和右侧 tabpanel 内容区域。
- `frontend/quick-tools.css`：负责页面壳层、种子列表、弹窗、表格和移动端响应式布局。
- `frontend/torrent-renamer.js`：负责 Torrent 列表、弹窗生命周期、文件预览、选择、刷新与串行保存。
- `tests/quick-tools.test.js`：验证页面壳层结构、切换语义和关键响应式样式。
- `tests/torrent-renamer.test.js`：验证列表入口、弹窗打开关闭、请求竞态、预览及保存回归。
- `tests/helpers/fake-dom.js`：仅在键盘事件测试确有需要时增加 Document 级事件监听能力，不扩展无关 DOM API。

---

### Task 1: 建立左侧导航、右侧内容的页面壳层

**Files:**
- Modify: `frontend/quick-tools.html`
- Modify: `frontend/quick-tools.css`
- Test: `tests/quick-tools.test.js`

**Interfaces:**
- Consumes: `quick-tools.js` 既有元素 ID：`quick-tools-tabs`、`rss-rules-tab`、`torrent-renamer-tab`、`rss-rules-panel`、`torrent-renamer-panel`。
- Produces: `.quick-tools-layout`、`.tool-tabs`、`.tool-content` 布局类；元素 ID 和 ARIA 关联保持不变。

- [ ] **Step 1: 编写失败的页面结构测试**

在 `tests/quick-tools.test.js` 的 HTML 测试中增加以下断言，并将样式测试改为明确验证壳层：

```js
assert.match(html, /class="quick-tools-layout"/);
assert.match(html, /<nav[^>]*id="quick-tools-tabs"[^>]*class="tool-tabs"/);
assert.match(html, /<div class="tool-content">/);

assert.match(css, /\.quick-tools-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*220px\s+minmax\(0,\s*1fr\);/s);
assert.match(css, /\.tool-tabs\s*\{[^}]*flex-direction:\s*column;/s);
assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.quick-tools-layout\s*\{[^}]*grid-template-columns:\s*1fr;/s);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/quick-tools.test.js`

Expected: FAIL，提示 HTML 缺少 `quick-tools-layout` 或 CSS 未包含 `220px minmax(0, 1fr)`。

- [ ] **Step 3: 修改 HTML 页面壳层**

将 `quick-tools.html` 中现有导航与两个面板包入以下结构，保留所有原 ID、role 和 hidden 状态：

```html
<div class="quick-tools-layout">
  <nav id="quick-tools-tabs" class="tool-tabs" role="tablist" aria-label="Quick Tools">
    <button id="rss-rules-tab" class="tool-tab" type="button" role="tab" aria-controls="rss-rules-panel" aria-selected="true">RSS 规则关键词</button>
    <button id="torrent-renamer-tab" class="tool-tab" type="button" role="tab" aria-controls="torrent-renamer-panel" aria-selected="false">Torrent 文件重命名</button>
  </nav>

  <div class="tool-content">
    <section id="rss-rules-panel" class="tool-panel" role="tabpanel" aria-labelledby="rss-rules-tab">
      <div id="rss-rules-tool"></div>
    </section>
    <section id="torrent-renamer-panel" class="tool-panel" role="tabpanel" aria-labelledby="torrent-renamer-tab" hidden>
      <div id="torrent-renamer-tool"></div>
    </section>
  </div>
</div>
```

- [ ] **Step 4: 实现桌面端和移动端壳层样式**

在 `frontend/quick-tools.css` 中用以下规则替换横向 tab 样式；保留现有颜色、焦点和选中态：

```css
.quick-tools-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.tool-tabs {
  position: sticky;
  top: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  background: #ffffff;
}

.tool-tab {
  width: 100%;
  color: #374151;
  text-align: left;
  background: transparent;
}

.tool-content {
  min-width: 0;
}

@media (max-width: 760px) {
  .quick-tools-layout {
    grid-template-columns: 1fr;
  }

  .tool-tabs {
    position: static;
  }
}
```

- [ ] **Step 5: 运行壳层测试并确认通过**

Run: `node --test tests/quick-tools.test.js`

Expected: PASS，原有 tab 初始化、懒加载和状态保留测试也继续通过。

- [ ] **Step 6: 提交页面壳层**

```bash
git add frontend/quick-tools.html frontend/quick-tools.css tests/quick-tools.test.js
git commit -m "feat: 调整 Quick Tools 侧边导航布局"
```

---

### Task 2: 将 Torrent 主界面改为种子列表和重命名入口

**Files:**
- Modify: `frontend/torrent-renamer.js`
- Modify: `frontend/quick-tools.css`
- Test: `tests/torrent-renamer.test.js`

**Interfaces:**
- Consumes: `filterTorrents(torrents, query)`、`api.requestTorrents()`。
- Produces: `.torrent-renamer-main`、`.torrent-item`、`.torrent-item-details`、`.torrent-rename-button`；`openRenameDialog(torrent, triggerButton): Promise<void>`。

- [ ] **Step 1: 更新测试查询帮助方法并编写失败测试**

在 `tests/torrent-renamer.test.js` 顶部替换种子按钮帮助方法并增加重命名按钮查询：

```js
const findTorrentItems = app => findElements(app, element => element.className === 'torrent-item');
const findRenameButtons = app => findElements(app, element => element.className === 'torrent-rename-button');
```

增加测试：

```js
test('Torrent 主界面只展示种子列表并通过重命名按钮请求文件', async () => {
  const fileRequestHashes = [];
  const { app, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show One', hash: 'abc123' }],
    requestTorrentFiles: async hash => {
      fileRequestHashes.push(hash);
      return [{ index: 0, name: 'episode.old.mkv' }];
    }
  });

  await tool.initialize();

  assert.equal(findTorrentItems(app).length, 1);
  assert.equal(findRenameButtons(app).length, 1);
  assert.equal(findById(app, 'match-regex'), undefined);
  assert.deepEqual(fileRequestHashes, []);

  await findRenameButtons(app)[0].dispatch('click').listenerResult;

  assert.deepEqual(fileRequestHashes, ['abc123']);
  assert.equal(findById(app, 'match-regex') !== undefined, true);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test --test-name-pattern="Torrent 主界面只展示种子列表" tests/torrent-renamer.test.js`

Expected: FAIL，因为当前 `.torrent-item` 自身是选择按钮，且编辑器常驻页面。

- [ ] **Step 3: 拆分列表项与操作按钮渲染**

在 `createTorrentRenamerTool` 中增加 `dialogElement`、`dialogTriggerButton` 引用，并将 `renderTorrentList` 的单项创建逻辑改为：

```js
const renderTorrentList = () => {
  const items = filterTorrents(torrents, searchQuery).map(torrent => {
    const item = documentRef.createElement('article');
    const details = documentRef.createElement('div');
    const name = documentRef.createElement('strong');
    const hash = documentRef.createElement('span');
    const renameButton = documentRef.createElement('button');

    item.className = 'torrent-item';
    details.className = 'torrent-item-details';
    name.className = 'torrent-name';
    name.textContent = torrent.name ?? '';
    hash.className = 'torrent-hash';
    hash.textContent = torrent.hash ?? '';
    renameButton.className = 'torrent-rename-button';
    renameButton.type = 'button';
    renameButton.textContent = '重命名';
    renameButton.disabled = isLoadingTorrents || isSaving;
    renameButton.setAttribute('aria-label', `重命名 ${torrent.name ?? torrent.hash ?? ''}`);
    renameButton.addEventListener('click', () => openRenameDialog(torrent, renameButton));

    details.append(name, hash);
    item.append(details, renameButton);
    return item;
  });
  torrentList.replaceChildren(...items);
};
```

- [ ] **Step 4: 把 `renderTool` 缩减为主列表骨架**

让 `renderTool` 只创建搜索、刷新、列表和主状态元素：

```js
const renderTool = () => {
  const main = documentRef.createElement('section');
  const torrentControls = documentRef.createElement('div');

  searchInput = documentRef.createElement('input');
  torrentList = documentRef.createElement('div');
  refreshTorrentsButton = documentRef.createElement('button');
  statusElement = documentRef.createElement('p');

  main.className = 'torrent-renamer-main';
  searchInput.id = 'torrent-search';
  searchInput.type = 'search';
  searchInput.placeholder = '搜索 Torrent 名称或 hash';
  searchInput.setAttribute('aria-label', '搜索 Torrent 名称或 hash');
  torrentControls.className = 'torrent-list-controls';
  refreshTorrentsButton.id = 'refresh-torrents';
  refreshTorrentsButton.type = 'button';
  refreshTorrentsButton.textContent = '刷新 Torrent';
  torrentList.className = 'torrent-list';
  statusElement.id = 'torrent-list-status';
  statusElement.setAttribute('role', 'status');
  statusElement.setAttribute('aria-live', 'polite');

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderTorrentList();
  });
  refreshTorrentsButton.addEventListener('click', refreshTorrentList);

  torrentControls.append(searchInput, refreshTorrentsButton);
  main.append(torrentControls, torrentList, statusElement);
  root.replaceChildren(main);
  renderTorrentList();
  setTorrentListStatus('正在加载 Torrent');
};
```

同时把当前 `renderTool` 中创建正则输入、预览表格和操作按钮的代码原样迁入 `renderRenameDialog()`，外层增加 `.torrent-rename-overlay` 与 `#torrent-rename-dialog`。本任务中的 `openRenameDialog` 使用以下完整入口，Task 3 再补充关闭、焦点和键盘生命周期：

```js
const openRenameDialog = async (torrent, triggerButton) => {
  if (isSaving || isLoadingTorrents || dialogElement) {
    return;
  }
  selectedTorrent = torrent;
  dialogTriggerButton = triggerButton;
  files = [];
  preview = { error: '匹配正则不能为空', items: [] };
  fileLoadError = null;
  isLoadingFiles = false;
  renderRenameDialog();
  matchInput.focus();
  await loadSelectedTorrentFiles();
};
```

- [ ] **Step 5: 更新主列表样式**

用以下规则替换旧的双栏 `.torrent-renamer-layout` 和按钮式 `.torrent-item` 样式：

```css
.torrent-renamer-main {
  min-width: 0;
  padding: 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
}

.torrent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
}

.torrent-item-details {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.torrent-rename-button {
  flex: 0 0 auto;
}
```

- [ ] **Step 6: 运行主列表测试**

Run: `node --test --test-name-pattern="Torrent 主界面只展示种子列表|filterTorrents" tests/torrent-renamer.test.js`

Expected: PASS；初始化后不请求文件，点击“重命名”后只请求对应 hash。

- [ ] **Step 7: 提交种子列表入口**

```bash
git add frontend/torrent-renamer.js frontend/quick-tools.css tests/torrent-renamer.test.js
git commit -m "feat: 将 Torrent 重命名改为列表入口"
```

---

### Task 3: 创建可关闭且防竞态的重命名弹窗

**Files:**
- Modify: `frontend/torrent-renamer.js`
- Modify: `frontend/quick-tools.css`
- Modify: `tests/helpers/fake-dom.js`
- Test: `tests/torrent-renamer.test.js`

**Interfaces:**
- Consumes: `loadSelectedTorrentFiles()`、`rebuildPreview()`、`saveSelectedItems()`。
- Produces: `renderRenameDialog()`、`openRenameDialog(torrent, triggerButton)`、`closeRenameDialog()`、`handleDialogKeydown(event)`。

- [ ] **Step 1: 为 Fake DOM 增加 Document 级事件能力**

在 `createFakeDocument` 中加入最小事件实现：

```js
const documentEventListeners = {};
const document = {
  activeElement: null,
  createElement: tagName => new FakeElement(tagName, document),
  getElementById: id => findById(body, id),
  addEventListener(type, listener) {
    documentEventListeners[type] = listener;
  },
  removeEventListener(type, listener) {
    if (documentEventListeners[type] === listener) {
      delete documentEventListeners[type];
    }
  },
  dispatch(type, properties = {}) {
    const event = {
      defaultPrevented: false,
      ...properties,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    event.listenerResult = documentEventListeners[type]?.(event);
    return event;
  }
};
```

- [ ] **Step 2: 编写弹窗生命周期失败测试**

在 `tests/torrent-renamer.test.js` 增加：

```js
test('重命名弹窗提供语义、Escape 关闭、状态清理和焦点恢复', async () => {
  const { app, document, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show', hash: 'show-hash' }],
    requestTorrentFiles: async () => [{ index: 0, name: 'episode.old.mkv' }]
  });
  await tool.initialize();
  const trigger = findRenameButtons(app)[0];

  await trigger.dispatch('click').listenerResult;
  const dialog = findById(app, 'torrent-rename-dialog');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'torrent-rename-dialog-title');
  assert.equal(document.activeElement, findById(app, 'match-regex'));

  findById(app, 'cancel-rename-dialog').focus();
  document.dispatch('keydown', { key: 'Tab' });
  assert.equal(document.activeElement, findById(app, 'match-regex'));

  findById(app, 'match-regex').focus();
  document.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(document.activeElement, findById(app, 'cancel-rename-dialog'));

  findById(app, 'match-regex').value = '\\.old';
  document.dispatch('keydown', { key: 'Escape' });

  assert.equal(findById(app, 'torrent-rename-dialog'), undefined);
  assert.equal(document.activeElement, trigger);

  await trigger.dispatch('click').listenerResult;
  assert.equal(findById(app, 'match-regex').value, '');
  assert.equal(findPreviewRows(app).length, 0);
});
```

增加迟到响应测试：

```js
test('关闭后迟到的文件响应不会写入新弹窗', async () => {
  const firstFiles = createDeferred();
  const { app, tool } = createToolFixture({
    requestTorrents: async () => [
      { name: 'First', hash: 'first-hash' },
      { name: 'Second', hash: 'second-hash' }
    ],
    requestTorrentFiles: hash =>
      hash === 'first-hash'
        ? firstFiles.promise
        : Promise.resolve([{ index: 0, name: 'second.old.mkv' }])
  });
  await tool.initialize();

  const firstOpen = findRenameButtons(app)[0].dispatch('click').listenerResult;
  findById(app, 'close-rename-dialog').dispatch('click');
  await findRenameButtons(app)[1].dispatch('click').listenerResult;
  firstFiles.resolve([{ index: 0, name: 'first.old.mkv' }]);
  await firstOpen;

  assert.equal(findById(app, 'torrent-rename-dialog-title').textContent, 'Second');
  assert.equal(app.textContent.includes('second.old.mkv'), true);
  assert.equal(app.textContent.includes('first.old.mkv'), false);
});
```

- [ ] **Step 3: 运行弹窗测试并确认失败**

Run: `node --test --test-name-pattern="重命名弹窗提供语义|关闭后迟到" tests/torrent-renamer.test.js`

Expected: FAIL，因为当前没有模态弹窗、关闭清理或 Document 键盘监听。

- [ ] **Step 4: 实现弹窗 DOM 骨架**

在 `torrent-renamer.js` 中新增 `dialogElement`、`headerCloseButton`、`footerCloseButton`、`dialogStatusElement`，并实现 `renderRenameDialog`。弹窗内部继续创建现有输入框、预览表格和操作按钮，ID 保持不变：

```js
const renderRenameDialog = () => {
  const overlay = documentRef.createElement('div');
  const dialog = documentRef.createElement('section');
  const header = documentRef.createElement('header');
  const titleGroup = documentRef.createElement('div');
  const title = documentRef.createElement('h2');
  const hash = documentRef.createElement('p');
  const editor = documentRef.createElement('div');
  const previewTable = documentRef.createElement('table');
  const previewHead = documentRef.createElement('thead');
  const previewHeaderRow = documentRef.createElement('tr');
  const actions = documentRef.createElement('div');

  overlay.className = 'torrent-rename-overlay';
  dialog.id = 'torrent-rename-dialog';
  dialog.className = 'torrent-rename-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'torrent-rename-dialog-title');
  title.id = 'torrent-rename-dialog-title';
  title.textContent = selectedTorrent?.name ?? 'Torrent 文件重命名';
  hash.className = 'torrent-dialog-hash';
  hash.textContent = selectedTorrent?.hash ?? '';

  headerCloseButton = documentRef.createElement('button');
  headerCloseButton.id = 'close-rename-dialog';
  headerCloseButton.type = 'button';
  headerCloseButton.textContent = '关闭';
  headerCloseButton.addEventListener('click', closeRenameDialog);
  footerCloseButton = documentRef.createElement('button');
  footerCloseButton.id = 'cancel-rename-dialog';
  footerCloseButton.type = 'button';
  footerCloseButton.textContent = '关闭';
  footerCloseButton.addEventListener('click', closeRenameDialog);

  matchInput = documentRef.createElement('input');
  replaceInput = documentRef.createElement('input');
  flagsInput = documentRef.createElement('input');
  previewBody = documentRef.createElement('tbody');
  selectAllButton = documentRef.createElement('button');
  clearSelectedButton = documentRef.createElement('button');
  refreshButton = documentRef.createElement('button');
  saveButton = documentRef.createElement('button');
  dialogStatusElement = documentRef.createElement('p');

  matchInput.id = 'match-regex';
  matchInput.placeholder = '匹配正则';
  matchInput.setAttribute('aria-label', '匹配正则');
  replaceInput.id = 'replace-regex';
  replaceInput.placeholder = '替换文本';
  replaceInput.setAttribute('aria-label', '替换文本');
  flagsInput.id = 'regex-flags';
  flagsInput.value = 'g';
  flagsInput.setAttribute('aria-label', '正则 flags');

  previewTable.className = 'rename-preview-table';
  ['保存', '类型', '文件名称', '状态'].forEach(label => {
    const cell = documentRef.createElement('th');
    cell.textContent = label;
    previewHeaderRow.append(cell);
  });
  previewHead.append(previewHeaderRow);
  previewTable.append(previewHead, previewBody);

  selectAllButton.id = 'select-all-renames';
  selectAllButton.type = 'button';
  selectAllButton.textContent = '全选有效项';
  clearSelectedButton.id = 'clear-selected-renames';
  clearSelectedButton.type = 'button';
  clearSelectedButton.textContent = '取消全选';
  refreshButton.id = 'refresh-torrent-files';
  refreshButton.type = 'button';
  refreshButton.textContent = '刷新文件';
  saveButton.id = 'save-renames';
  saveButton.type = 'button';
  saveButton.textContent = '保存重命名';
  dialogStatusElement.id = 'rename-status';
  dialogStatusElement.setAttribute('role', 'status');
  dialogStatusElement.setAttribute('aria-live', 'polite');

  [matchInput, replaceInput, flagsInput].forEach(input => input.addEventListener('input', rebuildPreview));
  selectAllButton.addEventListener('click', selectAllValidItems);
  clearSelectedButton.addEventListener('click', clearSelectedItems);
  refreshButton.addEventListener('click', () => loadSelectedTorrentFiles());
  saveButton.addEventListener('click', () => saveSelectedItems());

  titleGroup.append(title, hash);
  header.append(titleGroup, headerCloseButton);
  editor.append(matchInput, replaceInput, flagsInput);
  actions.append(selectAllButton, clearSelectedButton, refreshButton, saveButton, footerCloseButton);
  dialog.append(header, editor, previewTable, actions, dialogStatusElement);
  overlay.append(dialog);
  root.append(overlay);
  dialogElement = overlay;
};
```

- [ ] **Step 5: 实现打开、关闭、Escape 和请求失效**

```js
const resetRenameState = () => {
  selectedTorrent = null;
  files = [];
  preview = { error: '匹配正则不能为空', items: [] };
  fileLoadError = null;
  isLoadingFiles = false;
  matchInput = null;
  replaceInput = null;
  flagsInput = null;
  previewBody = null;
  selectAllButton = null;
  clearSelectedButton = null;
  refreshButton = null;
  saveButton = null;
  dialogStatusElement = null;
};

const closeRenameDialog = () => {
  if (!dialogElement || isSaving) {
    return;
  }
  const triggerButton = dialogTriggerButton;
  fileRequestVersion += 1;
  documentRef.removeEventListener('keydown', handleDialogKeydown);
  dialogElement.remove();
  dialogElement = null;
  dialogTriggerButton = null;
  resetRenameState();
  triggerButton?.focus();
};

const handleDialogKeydown = event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeRenameDialog();
    return;
  }
  if (event.key !== 'Tab') {
    return;
  }
  const focusableElements = [
    matchInput,
    replaceInput,
    flagsInput,
    selectAllButton,
    clearSelectedButton,
    refreshButton,
    saveButton,
    footerCloseButton
  ].filter(element => element && !element.disabled);
  const firstElement = focusableElements[0];
  const lastElement = focusableElements.at(-1);
  if (event.shiftKey && documentRef.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && documentRef.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
};

const openRenameDialog = async (torrent, triggerButton) => {
  if (isSaving || isLoadingTorrents) {
    return;
  }
  if (dialogElement) {
    closeRenameDialog();
  }
  selectedTorrent = torrent;
  dialogTriggerButton = triggerButton;
  files = [];
  preview = { error: '匹配正则不能为空', items: [] };
  fileLoadError = null;
  isLoadingFiles = false;
  renderRenameDialog();
  documentRef.addEventListener('keydown', handleDialogKeydown);
  matchInput.focus();
  await loadSelectedTorrentFiles();
};
```

将 `setStatus` 拆为 `setTorrentListStatus` 和 `setRenameStatus`，避免主列表刷新消息覆盖弹窗消息。所有文件加载、预览和保存路径使用 `setRenameStatus`，Torrent 列表加载路径使用 `setTorrentListStatus`。

- [ ] **Step 6: 增加弹窗与移动端样式**

```css
.torrent-rename-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(17 24 39 / 55%);
}

.torrent-rename-dialog {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  gap: 16px;
  width: min(1200px, 100%);
  max-height: calc(100vh - 48px);
  padding: 20px;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 20px 45px rgb(17 24 39 / 25%);
}

.torrent-rename-dialog .rename-preview-table {
  overflow: auto;
}

@media (max-width: 760px) {
  .torrent-rename-overlay {
    padding: 8px;
  }

  .torrent-rename-dialog {
    width: 100%;
    max-height: calc(100vh - 16px);
    padding: 14px;
  }
}
```

- [ ] **Step 7: 运行弹窗生命周期测试**

Run: `node --test --test-name-pattern="重命名弹窗提供语义|关闭后迟到|文件加载中或失败" tests/torrent-renamer.test.js`

Expected: PASS；关闭后旧响应不写入新弹窗，Escape 恢复焦点，文件错误保留重试能力。

- [ ] **Step 8: 提交弹窗生命周期**

```bash
git add frontend/torrent-renamer.js frontend/quick-tools.css tests/helpers/fake-dom.js tests/torrent-renamer.test.js
git commit -m "feat: 添加 Torrent 重命名弹窗"
```

---

### Task 4: 迁移预览、刷新和串行保存行为到弹窗

**Files:**
- Modify: `frontend/torrent-renamer.js`
- Modify: `tests/torrent-renamer.test.js`

**Interfaces:**
- Consumes: `buildRenamePreview(files, options)`、`api.requestTorrentFiles(hash)`、`api.renameTorrentFile(hash, oldPath, newPath)`。
- Produces: 弹窗内 `renderPreview()`、`rebuildPreview()`、`saveSelectedItems()` 完整回归行为。

- [ ] **Step 1: 将现有交互测试改为通过“重命名”按钮打开弹窗**

对所有原先使用以下代码的测试：

```js
await findTorrentButtons(app)[0].dispatch('click').listenerResult;
```

改为：

```js
await findRenameButtons(app)[0].dispatch('click').listenerResult;
```

删除针对 `.torrent-item[aria-pressed]` 的断言，替换为弹窗标题和 hash 断言：

```js
assert.equal(findById(app, 'torrent-rename-dialog-title').textContent, 'Show One');
assert.equal(app.textContent.includes('abc123'), true);
```

- [ ] **Step 2: 增加保存期间禁止关闭的失败测试**

```js
test('保存期间禁止关闭且成功后弹窗保持打开并刷新文件', async () => {
  const pendingRename = createDeferred();
  let fileRequestCount = 0;
  const { app, document, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show', hash: 'show-hash' }],
    requestTorrentFiles: async () => {
      fileRequestCount += 1;
      return fileRequestCount === 1
        ? [{ index: 0, name: 'episode.old.mkv' }]
        : [{ index: 0, name: 'episode.mkv' }];
    },
    renameTorrentFile: () => pendingRename.promise
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  findById(app, 'match-regex').value = '\\.old';
  findById(app, 'match-regex').dispatch('input');

  const savePromise = findById(app, 'save-renames').dispatch('click').listenerResult;
  findById(app, 'close-rename-dialog').dispatch('click');
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(findById(app, 'torrent-rename-dialog') !== undefined, true);

  pendingRename.resolve();
  await savePromise;

  assert.equal(findById(app, 'torrent-rename-dialog') !== undefined, true);
  assert.equal(fileRequestCount, 2);
  assert.equal(app.textContent.includes('episode.old.mkv'), false);
  assert.equal(app.textContent.includes('成功 1 项'), true);
});
```

- [ ] **Step 3: 运行迁移后的测试并定位失败范围**

Run: `node --test tests/torrent-renamer.test.js`

Expected: FAIL 仅集中在旧的选择态假设、状态元素拆分和弹窗保存关闭逻辑；`buildRenamePreview` 纯函数测试继续 PASS。

- [ ] **Step 4: 调整控件状态更新逻辑**

确保 `updateControls` 分别更新主页面和弹窗：

```js
const updateControls = () => {
  const isListBusy = isLoadingTorrents || isSaving;
  searchInput.disabled = isListBusy;
  refreshTorrentsButton.disabled = isListBusy;
  renderTorrentList();

  if (!dialogElement) {
    return;
  }

  const isDialogBusy = isSaving || isLoadingFiles;
  matchInput.disabled = isDialogBusy;
  replaceInput.disabled = isDialogBusy;
  flagsInput.disabled = isDialogBusy;
  refreshButton.disabled = isDialogBusy;
  selectAllButton.disabled = isDialogBusy || Boolean(fileLoadError) || !preview.items.some(item => item.isValid);
  clearSelectedButton.disabled = isDialogBusy || Boolean(fileLoadError) || !getSelectedItems().length;
  saveButton.disabled = isDialogBusy || Boolean(fileLoadError) || Boolean(preview.error) || !getSelectedItems().length;
  saveButton.textContent = isSaving ? '保存中' : '保存重命名';
  headerCloseButton.disabled = isSaving;
  footerCloseButton.disabled = isSaving;
};
```

`renderPreview()` 只在 `dialogElement`、`previewBody` 和 `selectedTorrent` 都存在时操作 DOM；关闭弹窗后的异步 `finally` 不得访问已清空元素。

- [ ] **Step 5: 保留刷新和串行保存语义**

在 `saveSelectedItems` 中捕获保存开始时的 hash，并在刷新或状态写入前确认弹窗仍指向同一 Torrent：

```js
const torrentHash = selectedTorrent.hash;
const isCurrentDialog = () => dialogElement && selectedTorrent?.hash === torrentHash;
```

保存期间关闭已被禁用，因此正常路径下 `isCurrentDialog()` 应为真；该判断用于防御异常 DOM 生命周期。保存成功或失败后继续调用 `loadSelectedTorrentFiles()`，并只用 `setRenameStatus` 更新弹窗状态。

- [ ] **Step 6: 运行 Torrent 完整测试**

Run: `node --test tests/torrent-renamer.test.js`

Expected: PASS；覆盖搜索、刷新、打开弹窗、原始/预览双行、无效正则、竞态、串行保存、失败停止和成功刷新。

- [ ] **Step 7: 提交弹窗业务回归**

```bash
git add frontend/torrent-renamer.js tests/torrent-renamer.test.js
git commit -m "test: 完善 Torrent 弹窗重命名流程"
```

---

### Task 5: 完成样式收口、全量验证和会话记录

**Files:**
- Modify: `frontend/quick-tools.css`
- Modify: `tests/quick-tools.test.js`
- Modify: `tests/torrent-renamer.test.js`
- Modify: `sessions/session_2026-08-05.md`

**Interfaces:**
- Consumes: Task 1 至 Task 4 的页面类名和 DOM ID。
- Produces: 最终桌面端、窄屏样式和完整验证记录。

- [ ] **Step 1: 增加最终样式契约测试**

在 `tests/quick-tools.test.js` 样式测试中增加：

```js
assert.match(css, /\.torrent-rename-overlay\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s);
assert.match(css, /\.torrent-rename-dialog\s*\{[^}]*max-height:\s*calc\(100vh\s*-\s*48px\);/s);
assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.torrent-rename-dialog\s*\{[^}]*width:\s*100%;/s);
```

- [ ] **Step 2: 删除失效样式并检查最小影响范围**

从 `frontend/quick-tools.css` 删除不再使用的 `.torrent-renamer-layout`、`.torrent-panel` 和常驻 `.torrent-renamer-editor` 布局规则。保留预览表格、复选框、状态、登录弹窗和 RSS 规则样式，不重排无关选择器。

Run: `rg -n "torrent-renamer-layout|torrent-panel|torrent-renamer-editor" frontend tests`

Expected: 无输出；新实现和测试不再引用旧布局类。

- [ ] **Step 3: 执行语法与定向验证**

Run: `node --check frontend/quick-tools.js && node --check frontend/torrent-renamer.js`

Expected: 两个命令退出码均为 `0`，无输出。

Run: `node --test tests/quick-tools.test.js tests/torrent-renamer.test.js`

Expected: PASS，失败数为 `0`。

- [ ] **Step 4: 执行完整测试和差异检查**

Run: `npm test`

Expected: 所有测试 PASS，失败数为 `0`。

Run: `git diff --check`

Expected: 无输出，退出码为 `0`。

Run: `git status --short`

Expected: 只显示本任务修改及用户原有未提交文件；不得出现调试文件、临时报告或依赖目录。

- [ ] **Step 5: 进行真实浏览器人工检查**

启动现有页面后检查：

1. 桌面端左侧功能导航固定，右侧 RSS/Torrent 内容切换正常。
2. Torrent 页面初始不请求文件，搜索和刷新可用。
3. 每个种子的“重命名”按钮打开正确标题和 hash 的弹窗。
4. 原始行、预览行、长路径横向滚动及保存状态可读。
5. Escape 和两个关闭入口均可关闭，焦点返回原按钮。
6. 保存期间无法关闭，保存后弹窗保持打开并显示最新文件。
7. 小于 `760px` 时导航在上、弹窗接近全屏且按钮可换行。

- [ ] **Step 6: 追加会话记录**

在 `sessions/session_2026-08-05.md` 追加本轮用户请求、改动文件、验证结果和未覆盖风险。不得覆盖同日已有记录。

- [ ] **Step 7: 提交最终样式与验证记录**

```bash
git add frontend/quick-tools.css tests/quick-tools.test.js tests/torrent-renamer.test.js sessions/session_2026-08-05.md
git commit -m "feat: 完成 Quick Tools 布局优化"
```

最终不执行 `git push`。
