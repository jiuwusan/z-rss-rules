import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRenamePreview, createTorrentRenamerTool, filterTorrents, splitTorrentPath } from '../frontend/torrent-renamer.js';
import { createFakeDocument, findElements } from './helpers/fake-dom.js';

const createToolFixture = ({ requestTorrents, requestTorrentFiles, renameTorrentFile } = {}) => {
  const { app, document } = createFakeDocument();
  const api = {
    requestTorrents: requestTorrents ?? (async () => []),
    requestTorrentFiles: requestTorrentFiles ?? (async () => []),
    renameTorrentFile: renameTorrentFile ?? (async () => {})
  };
  const tool = createTorrentRenamerTool({ root: app, api, documentRef: document });
  return { app, api, document, tool };
};

const findById = (app, id) => findElements(app, element => element.id === id)[0];
const findTorrentItems = app => findElements(app, element => element.className === 'torrent-item');
const findRenameButtons = app => findElements(app, element => element.className === 'torrent-rename-button');
const findOriginalRows = app => findElements(app, element => element.className === 'rename-original-row');
const findPreviewRows = app => findElements(app, element => element.className === 'rename-preview-row');
const findPreviewCheckboxes = app => findElements(app, element => element.className === 'rename-preview-select');
const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

test('filterTorrents 按名称或 hash 忽略大小写筛选', () => {
  const torrents = [
    { name: 'Show One', hash: 'abc123' },
    { name: 'Movie Two', hash: 'def456' }
  ];

  assert.deepEqual(filterTorrents(torrents, 'SHOW'), [torrents[0]]);
  assert.deepEqual(filterTorrents(torrents, 'F456'), [torrents[1]]);
  assert.deepEqual(filterTorrents(torrents, ''), torrents);
});

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
  assert.equal(document.activeElement.id, 'close-rename-dialog');

  findById(app, 'close-rename-dialog').focus();
  document.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(document.activeElement.id, 'cancel-rename-dialog');

  findById(app, 'close-rename-dialog').focus();
  const headerTabEvent = document.dispatch('keydown', { key: 'Tab' });
  assert.equal(headerTabEvent.defaultPrevented, false);

  findById(app, 'match-regex').value = '\\.old';
  document.dispatch('keydown', { key: 'Escape' });

  assert.equal(findById(app, 'torrent-rename-dialog'), undefined);
  assert.equal(document.activeElement, trigger);

  await trigger.dispatch('click').listenerResult;
  assert.equal(findById(app, 'match-regex').value, '');
  assert.equal(findPreviewRows(app).length, 0);
});

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

test('保存期间关闭按钮和 Escape 不会关闭重命名弹窗', async () => {
  const pendingRename = createDeferred();
  const { app, document, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show', hash: 'show-hash' }],
    requestTorrentFiles: async () => [{ index: 0, name: 'episode.old.mkv' }],
    renameTorrentFile: () => pendingRename.promise
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  findById(app, 'match-regex').value = '\\.old';
  findById(app, 'match-regex').dispatch('input');

  const savePromise = findById(app, 'save-renames').dispatch('click').listenerResult;
  findById(app, 'close-rename-dialog').dispatch('click');
  document.dispatch('keydown', { key: 'Escape' });
  assert.notEqual(findById(app, 'torrent-rename-dialog'), undefined);

  pendingRename.resolve();
  await savePromise;
});

test('splitTorrentPath 仅从最后一个正斜杠拆分路径', () => {
  assert.deepEqual(splitTorrentPath('目录/子目录/文件.mkv'), {
    directory: '目录/子目录/',
    fileName: '文件.mkv'
  });
  assert.deepEqual(splitTorrentPath('目录\\子目录\\文件.mkv'), {
    directory: '',
    fileName: '目录\\子目录\\文件.mkv'
  });
  assert.deepEqual(splitTorrentPath('根目录文件.mkv'), {
    directory: '',
    fileName: '根目录文件.mkv'
  });
});

test('仅替换最后文件名并保留目录', () => {
  const preview = buildRenamePreview([{ index: 0, name: '目录/S01E01.old.mkv' }], { matchRegex: '\\.old', replaceRegex: '', flags: 'g' });

  assert.equal(preview.error, null);
  assert.equal(preview.items[0].index, 0);
  assert.equal(preview.items[0].newPath, '目录/S01E01.mkv');
  assert.equal(preview.items[0].isValid, true);
  assert.equal(preview.items[0].isSelected, true);
});

test('反斜杠保留在 basename 中并使替换结果无效', () => {
  const preview = buildRenamePreview([{ index: 0, name: 'dir\\old.mkv' }], { matchRegex: 'old', replaceRegex: 'new', flags: 'g' });

  assert.equal(preview.items[0].oldFileName, 'dir\\old.mkv');
  assert.equal(preview.items[0].newPath, 'dir\\new.mkv');
  assert.equal(preview.items[0].isValid, false);
  assert.equal(preview.items[0].isSelected, false);
  assert.match(preview.items[0].status, /无效/);
});

test('支持捕获组和忽略大小写', () => {
  const preview = buildRenamePreview([{ index: 0, name: 'SHOW.01.MKV' }], { matchRegex: 'show\\.(\\d+)', replaceRegex: 'Episode-$1', flags: 'gi' });

  assert.equal(preview.items[0].newFileName, 'Episode-01.MKV');
});

test('每个文件的替换重新使用正则状态', () => {
  const preview = buildRenamePreview(
    [
      { index: 0, name: 'old.first.mkv' },
      { index: 1, name: 'old.second.mkv' }
    ],
    { matchRegex: '^old', replaceRegex: 'new', flags: 'y' }
  );

  assert.deepEqual(
    preview.items.map(item => item.newFileName),
    ['new.first.mkv', 'new.second.mkv']
  );
});

test('全局正则不会污染后续文件的替换状态', () => {
  const preview = buildRenamePreview(
    [
      { index: 0, name: 'first.old.mkv' },
      { index: 1, name: 'second.old.mkv' }
    ],
    { matchRegex: '\\.old', replaceRegex: '', flags: 'g' }
  );

  assert.deepEqual(
    preview.items.map(item => item.newFileName),
    ['first.mkv', 'second.mkv']
  );
});

test('未匹配正则的文件不可保存', () => {
  const preview = buildRenamePreview([{ index: 0, name: 'episode.mkv' }], { matchRegex: '\\.old', replaceRegex: '', flags: 'g' });

  assert.equal(preview.items[0].isValid, false);
  assert.equal(preview.items[0].isSelected, false);
  assert.match(preview.items[0].status, /未匹配/);
});

test('替换后没有变化的文件不可保存', () => {
  const preview = buildRenamePreview([{ index: 0, name: 'episode.mkv' }], { matchRegex: 'episode', replaceRegex: 'episode', flags: 'g' });

  assert.equal(preview.items[0].isValid, false);
  assert.equal(preview.items[0].isSelected, false);
  assert.match(preview.items[0].status, /无变化/);
});

for (const invalidName of ['', '.', '..']) {
  test(`替换为无效文件名“${invalidName || '空字符串'}”时不可保存`, () => {
    const preview = buildRenamePreview([{ index: 0, name: 'episode.mkv' }], { matchRegex: 'episode\\.mkv', replaceRegex: invalidName, flags: 'g' });

    assert.equal(preview.items[0].isValid, false);
    assert.equal(preview.items[0].isSelected, false);
    assert.match(preview.items[0].status, /无效/);
  });
}

for (const invalidName of ['目录/episode.mkv', '目录\\\\episode.mkv']) {
  test(`替换后文件名含路径分隔符“${invalidName}”时不可保存`, () => {
    const preview = buildRenamePreview([{ index: 0, name: 'episode.mkv' }], { matchRegex: 'episode\\.mkv', replaceRegex: invalidName, flags: 'g' });

    assert.equal(preview.items[0].isValid, false);
    assert.equal(preview.items[0].isSelected, false);
    assert.match(preview.items[0].status, /无效/);
  });
}

test('多个文件生成同一目标路径时全部不可保存', () => {
  const preview = buildRenamePreview(
    [
      { index: 0, name: 'first.mkv' },
      { index: 1, name: 'second.mkv' }
    ],
    { matchRegex: '^(first|second)', replaceRegex: 'same', flags: 'g' }
  );

  for (const item of preview.items) {
    assert.equal(item.isValid, false);
    assert.equal(item.isSelected, false);
    assert.match(item.status, /冲突/);
  }
});

test('目标路径已被当前种子中的另一文件占用时不可保存', () => {
  const preview = buildRenamePreview(
    [
      { index: 0, name: 'old.mkv' },
      { index: 1, name: 'new.mkv' }
    ],
    { matchRegex: '^old', replaceRegex: 'new', flags: 'g' }
  );

  assert.equal(preview.items[0].isValid, false);
  assert.equal(preview.items[0].isSelected, false);
  assert.match(preview.items[0].status, /冲突/);
});

test('无效正则清空预览并返回错误', () => {
  const preview = buildRenamePreview([{ index: 0, name: 'episode.mkv' }], { matchRegex: '[', replaceRegex: '', flags: 'g' });

  assert.equal(preview.items.length, 0);
  assert.match(preview.error, /Invalid regular expression/);
});

test('空正则返回明确错误且不产生可保存预览', () => {
  const preview = buildRenamePreview([{ index: 0, name: 'episode.mkv' }], { matchRegex: '', replaceRegex: 'prefix-', flags: 'g' });

  assert.equal(preview.items.length, 0);
  assert.match(preview.error, /不能为空/);
});

test('源路径以分隔符结尾时不允许通过空 basename 创建文件名', () => {
  const preview = buildRenamePreview([{ index: 0, name: '目录/' }], { matchRegex: '^$', replaceRegex: 'created.mkv', flags: 'g' });

  assert.equal(preview.items[0].newFileName, '');
  assert.equal(preview.items[0].newPath, '目录/');
  assert.equal(preview.items[0].isValid, false);
  assert.equal(preview.items[0].isSelected, false);
  assert.match(preview.items[0].status, /无效/);
});

test('initialize 加载 Torrent，支持名称和 hash 搜索并通过重命名按钮打开预览', async () => {
  let torrentRequestCount = 0;
  const fileRequestHashes = [];
  const torrents = [
    { name: 'Show One', hash: 'abc123' },
    { name: 'Movie Two', hash: 'def456' }
  ];
  const filesByHash = {
    abc123: [
      { index: 0, name: 'season/a.old.mkv' },
      { index: 1, name: 'season/readme.txt' }
    ],
    def456: [{ index: 0, name: 'movie.old.mkv' }]
  };
  const { app, tool } = createToolFixture({
    requestTorrents: async () => {
      torrentRequestCount += 1;
      return torrents;
    },
    requestTorrentFiles: async hash => {
      fileRequestHashes.push(hash);
      return filesByHash[hash];
    }
  });

  await tool.initialize();

  assert.equal(torrentRequestCount, 1);
  assert.deepEqual(
    findTorrentItems(app).map(item => item.textContent),
    ['Show Oneabc123重命名', 'Movie Twodef456重命名']
  );
  assert.equal(findById(app, 'regex-flags'), undefined);
  assert.equal(findById(app, 'refresh-torrents').textContent, '刷新 Torrent');

  const searchInput = findById(app, 'torrent-search');
  searchInput.value = 'SHOW';
  searchInput.dispatch('input');
  assert.deepEqual(
    findTorrentItems(app).map(item => item.textContent),
    ['Show Oneabc123重命名']
  );
  searchInput.value = 'F456';
  searchInput.dispatch('input');
  assert.deepEqual(
    findTorrentItems(app).map(item => item.textContent),
    ['Movie Twodef456重命名']
  );

  searchInput.value = '';
  searchInput.dispatch('input');
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  assert.deepEqual(fileRequestHashes, ['abc123']);
  const originalRows = findOriginalRows(app);
  assert.equal(originalRows.length, 2);
  assert.equal(originalRows[0].textContent.includes('season/a.old.mkv'), true);
  assert.equal(originalRows[1].textContent.includes('season/readme.txt'), true);
  assert.equal(findPreviewCheckboxes(app).length, 0);

  const matchInput = findById(app, 'match-regex');
  const replaceInput = findById(app, 'replace-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');
  replaceInput.value = '';
  replaceInput.dispatch('input');

  let previewCheckboxes = findPreviewCheckboxes(app);
  assert.equal(previewCheckboxes.length, 2);
  assert.equal(previewCheckboxes[0].checked, true);
  assert.equal(previewCheckboxes[0].disabled, false);
  assert.equal(previewCheckboxes[1].checked, false);
  assert.equal(previewCheckboxes[1].disabled, true);
  assert.equal(app.textContent.includes('a.mkv'), true);
  const previewTable = findElements(app, element => element.className === 'rename-preview-table')[0];
  assert.deepEqual(
    previewTable.children[0].children[0].children.map(header => header.textContent),
    ['保存', '类型', '文件名称', '状态']
  );
  const previewBody = previewTable.children[1];
  assert.deepEqual(
    previewBody.children.map(row => row.className),
    ['rename-original-row', 'rename-preview-row', 'rename-original-row', 'rename-preview-row']
  );
  assert.equal(previewBody.children[0].textContent.includes('season/a.old.mkv'), true);
  assert.equal(previewBody.children[1].textContent.includes('season/a.mkv'), true);
  assert.equal(findElements(previewBody.children[0], element => element.className === 'rename-preview-select').length, 0);
  assert.equal(findElements(previewBody.children[1], element => element.className === 'rename-preview-select').length, 1);

  previewCheckboxes[0].checked = false;
  previewCheckboxes[0].dispatch('change');
  assert.equal(findById(app, 'save-renames').disabled, true);
  findById(app, 'select-all-renames').dispatch('click');
  previewCheckboxes = findPreviewCheckboxes(app);
  assert.equal(previewCheckboxes[0].checked, true);
  assert.equal(previewCheckboxes[1].checked, false);
  findById(app, 'clear-selected-renames').dispatch('click');
  assert.equal(
    findPreviewCheckboxes(app).every(checkbox => !checkbox.checked),
    true
  );

  await tool.refresh();
  assert.equal(torrentRequestCount, 2);
  assert.equal(findElements(app, element => element.className === 'torrent-renamer-main').length, 1);
});

test('无效正则保留全部原始文件行且不生成预览行', async () => {
  const { app, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show', hash: 'show-hash' }],
    requestTorrentFiles: async () => [
      { index: 0, name: 'season/episode.old.mkv' },
      { index: 1, name: 'season/readme.txt' }
    ]
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;

  const matchInput = findById(app, 'match-regex');
  matchInput.value = '[';
  matchInput.dispatch('input');

  assert.deepEqual(
    findOriginalRows(app).map(row => row.children[2].textContent),
    ['season/episode.old.mkv', 'season/readme.txt']
  );
  assert.equal(findPreviewRows(app).length, 0);
  assert.equal(findPreviewCheckboxes(app).length, 0);
  assert.equal(findById(app, 'rename-status').textContent.includes('预览失败'), true);
});

test('未匹配和目标冲突文件仍显示禁用的相邻预览行', async () => {
  const { app, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show', hash: 'show-hash' }],
    requestTorrentFiles: async () => [
      { index: 0, name: 'season/old.mkv' },
      { index: 1, name: 'season/new.mkv' },
      { index: 2, name: 'season/readme.txt' }
    ]
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;

  const matchInput = findById(app, 'match-regex');
  matchInput.value = '^old';
  matchInput.dispatch('input');
  const replaceInput = findById(app, 'replace-regex');
  replaceInput.value = 'new';
  replaceInput.dispatch('input');

  assert.equal(findOriginalRows(app).length, 3);
  assert.equal(findPreviewRows(app).length, 3);
  assert.equal(
    findPreviewCheckboxes(app).every(checkbox => checkbox.disabled),
    true
  );
  assert.equal(findPreviewRows(app)[0].textContent.includes('目标路径冲突'), true);
  assert.equal(findPreviewRows(app)[1].textContent.includes('未匹配正则'), true);
  assert.equal(findPreviewRows(app)[2].textContent.includes('未匹配正则'), true);
});

test('刷新文件后用最新原始行和预览行替换旧路径', async () => {
  let fileRequestCount = 0;
  const { app, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show', hash: 'show-hash' }],
    requestTorrentFiles: async () => {
      fileRequestCount += 1;
      return fileRequestCount === 1 ? [{ index: 0, name: 'season/old.old.mkv' }] : [{ index: 0, name: 'updated/new.old.mkv' }];
    }
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  const matchInput = findById(app, 'match-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');

  await findById(app, 'refresh-torrent-files').dispatch('click').listenerResult;

  assert.equal(fileRequestCount, 2);
  assert.deepEqual(
    findOriginalRows(app).map(row => row.children[2].textContent),
    ['updated/new.old.mkv']
  );
  assert.deepEqual(
    findPreviewRows(app).map(row => row.children[2].textContent),
    ['updated/new.mkv']
  );
  assert.equal(app.textContent.includes('season/old.old.mkv'), false);
});

test('首次 Torrent 加载失败后可点击刷新按钮恢复', async () => {
  let requestCount = 0;
  const { app, tool } = createToolFixture({
    requestTorrents: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        throw new Error('已取消登录');
      }
      return [{ name: 'Recovered', hash: 'recovered-hash' }];
    }
  });

  await tool.initialize();
  assert.equal(findById(app, 'torrent-list-status').textContent.includes('已取消登录'), true);
  const refreshTorrentsButton = findById(app, 'refresh-torrents');
  assert.equal(refreshTorrentsButton.disabled, false);

  await refreshTorrentsButton.dispatch('click').listenerResult;

  assert.equal(requestCount, 2);
  assert.deepEqual(
    findTorrentItems(app).map(item => item.textContent),
    ['Recoveredrecovered-hash重命名']
  );
});

test('Torrent 刷新按钮防止重复点击并在刷新期间禁用相关控件', async () => {
  let requestCount = 0;
  const pendingRefresh = createDeferred();
  const { app, tool } = createToolFixture({
    requestTorrents: () => {
      requestCount += 1;
      return requestCount === 1 ? Promise.resolve([{ name: 'Initial', hash: 'initial-hash' }]) : pendingRefresh.promise;
    },
    requestTorrentFiles: async () => [{ index: 0, name: 'episode.old.mkv' }]
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  findById(app, 'match-regex').value = '\\.old';
  findById(app, 'match-regex').dispatch('input');

  const refreshTorrentsButton = findById(app, 'refresh-torrents');
  const refreshPromise = refreshTorrentsButton.dispatch('click').listenerResult;
  refreshTorrentsButton.dispatch('click');

  assert.equal(requestCount, 2);
  assert.equal(refreshTorrentsButton.disabled, true);
  assert.equal(findById(app, 'torrent-search').disabled, true);
  assert.equal(findRenameButtons(app)[0].disabled, true);
  assert.equal(findById(app, 'match-regex').disabled, true);
  assert.equal(findById(app, 'replace-regex').disabled, true);
  assert.equal(findById(app, 'regex-flags').disabled, true);
  assert.equal(findById(app, 'refresh-torrent-files').disabled, true);
  assert.equal(findById(app, 'save-renames').disabled, true);

  pendingRefresh.resolve([{ name: 'Updated', hash: 'initial-hash' }]);
  await refreshPromise;
  assert.equal(refreshTorrentsButton.disabled, false);
});

test('initialize 重复调用复用初始化 Promise 且不重建或清空当前表单', async () => {
  let torrentRequestCount = 0;
  const torrentResponse = createDeferred();
  const { app, tool } = createToolFixture({
    requestTorrents: () => {
      torrentRequestCount += 1;
      return torrentResponse.promise;
    },
    requestTorrentFiles: async () => [{ index: 0, name: 'episode.old.mkv' }]
  });

  const firstInitialize = tool.initialize();
  const secondInitialize = tool.initialize();
  assert.equal(secondInitialize, firstInitialize);
  torrentResponse.resolve([{ name: 'Show', hash: 'show-hash' }]);
  await firstInitialize;
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  const originalMatchInput = findById(app, 'match-regex');
  originalMatchInput.value = '\\.old';
  originalMatchInput.dispatch('input');

  const thirdInitialize = tool.initialize();
  await thirdInitialize;

  assert.equal(thirdInitialize, firstInitialize);
  assert.equal(torrentRequestCount, 1);
  assert.equal(findById(app, 'match-regex'), originalMatchInput);
  assert.equal(findById(app, 'match-regex').value, '\\.old');
  assert.equal(findPreviewCheckboxes(app)[0].checked, true);
  assert.equal(findElements(app, element => element.className === 'torrent-renamer-main').length, 1);
});

test('并发 refresh 逆序完成时迟到响应不会覆盖较新的 Torrent 列表和状态', async () => {
  let torrentRequestCount = 0;
  const olderRefresh = createDeferred();
  const newerRefresh = createDeferred();
  const { app, tool } = createToolFixture({
    requestTorrents: () => {
      torrentRequestCount += 1;
      if (torrentRequestCount === 1) {
        return Promise.resolve([{ name: 'Initial', hash: 'initial-hash' }]);
      }
      return torrentRequestCount === 2 ? olderRefresh.promise : newerRefresh.promise;
    }
  });
  await tool.initialize();

  const olderPromise = tool.refresh();
  const newerPromise = tool.refresh();
  newerRefresh.resolve([{ name: 'Newest', hash: 'newest-hash' }]);
  await newerPromise;
  olderRefresh.resolve([{ name: 'Stale', hash: 'stale-hash' }]);
  await olderPromise;

  assert.deepEqual(
    findTorrentItems(app).map(item => item.textContent),
    ['Newestnewest-hash重命名']
  );
  assert.equal(findById(app, 'torrent-list-status').textContent.includes('已加载 1 个 Torrent'), true);
});

test('refresh 更新仍存在的选中 Torrent，并在其消失时清理文件和预览状态', async () => {
  let torrentRequestCount = 0;
  const torrentResponses = [[{ name: 'Old Name', hash: 'show-hash' }], [{ name: 'New Name', hash: 'show-hash' }], []];
  const { app, tool } = createToolFixture({
    requestTorrents: async () => torrentResponses[torrentRequestCount++],
    requestTorrentFiles: async () => [{ index: 0, name: 'episode.old.mkv' }]
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  const matchInput = findById(app, 'match-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');

  await tool.refresh();
  assert.deepEqual(
    findTorrentItems(app).map(item => item.textContent),
    ['New Nameshow-hash重命名']
  );
  assert.equal(findPreviewCheckboxes(app)[0].checked, true);

  await tool.refresh();
  assert.equal(findTorrentItems(app).length, 0);
  assert.equal(findPreviewCheckboxes(app).length, 0);
  assert.equal(findById(app, 'match-regex').disabled, true);
  assert.equal(findById(app, 'save-renames').disabled, true);
  assert.equal(findById(app, 'rename-status').textContent.includes('当前选择已不存在'), true);
});

test('Torrent 列表刷新失败时保留已有列表、选择、预览和可操作状态，且不覆盖弹窗状态', async () => {
  let torrentRequestCount = 0;
  const { app, tool } = createToolFixture({
    requestTorrents: async () => {
      torrentRequestCount += 1;
      if (torrentRequestCount === 1) {
        return [{ name: 'Stable Show', hash: 'stable-hash' }];
      }
      throw new Error('模拟列表刷新失败');
    },
    requestTorrentFiles: async () => [{ index: 0, name: 'episode.old.mkv' }]
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  const matchInput = findById(app, 'match-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');
  assert.equal(findById(app, 'save-renames').disabled, false);

  await findById(app, 'refresh-torrents').dispatch('click').listenerResult;

  assert.deepEqual(
    findTorrentItems(app).map(item => item.textContent),
    ['Stable Showstable-hash重命名']
  );
  assert.equal(findPreviewCheckboxes(app)[0].checked, true);
  assert.equal(findPreviewCheckboxes(app)[0].disabled, false);
  assert.equal(matchInput.disabled, false);
  assert.equal(findById(app, 'save-renames').disabled, false);
  assert.equal(findById(app, 'refresh-torrents').disabled, false);
  assert.equal(findById(app, 'torrent-list-status').textContent.includes('模拟列表刷新失败'), true);
  assert.equal(findById(app, 'rename-status').textContent.includes('模拟列表刷新失败'), false);
});

test('文件加载中或失败后修改正则不会覆盖加载状态和错误状态', async () => {
  let fileRequestCount = 0;
  const firstFileRequest = createDeferred();
  const { app, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show', hash: 'show-hash' }],
    requestTorrentFiles: () => {
      fileRequestCount += 1;
      if (fileRequestCount === 1) {
        return firstFileRequest.promise;
      }
      return Promise.resolve([{ index: 0, name: 'episode.old.mkv' }]);
    }
  });
  await tool.initialize();

  const firstSelection = findRenameButtons(app)[0].dispatch('click').listenerResult;
  const matchInput = findById(app, 'match-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');
  assert.equal(findById(app, 'rename-status').textContent, '正在加载 Torrent 文件');
  assert.equal(findById(app, 'torrent-search').disabled, true);
  assert.equal(matchInput.disabled, true);
  assert.equal(findById(app, 'replace-regex').disabled, true);
  assert.equal(findById(app, 'regex-flags').disabled, true);
  assert.equal(findById(app, 'refresh-torrents').disabled, true);
  assert.equal(findById(app, 'refresh-torrent-files').disabled, true);
  assert.equal(findById(app, 'select-all-renames').disabled, true);
  assert.equal(findById(app, 'save-renames').disabled, true);

  firstFileRequest.reject(new Error('模拟文件读取失败'));
  await firstSelection;
  const failureStatus = findById(app, 'rename-status').textContent;
  assert.equal(failureStatus.includes('模拟文件读取失败'), true);
  assert.equal(findById(app, 'refresh-torrent-files').disabled, false);
  findById(app, 'replace-regex').value = 'new';
  findById(app, 'replace-regex').dispatch('input');
  findById(app, 'regex-flags').value = 'gi';
  findById(app, 'regex-flags').dispatch('input');
  assert.equal(findById(app, 'rename-status').textContent, failureStatus);
  assert.equal(findById(app, 'save-renames').disabled, true);

  await findById(app, 'refresh-torrent-files').dispatch('click').listenerResult;
  assert.equal(findById(app, 'rename-status').textContent.includes('模拟文件读取失败'), false);
  assert.equal(findPreviewCheckboxes(app)[0].checked, true);
});

test('保存有效勾选项时严格串行执行，忙碌期间禁用控件并在成功后刷新', async () => {
  let fileRequestCount = 0;
  let activeRenames = 0;
  let maxConcurrentRenames = 0;
  let releaseFirstRename;
  const firstRenamePending = new Promise(resolve => {
    releaseFirstRename = resolve;
  });
  const renameCalls = [];
  const initialFiles = [
    { index: 0, name: 'a.old.mkv' },
    { index: 1, name: 'b.old.mkv' },
    { index: 2, name: 'c.old.mkv' },
    { index: 3, name: 'notes.txt' }
  ];
  const refreshedFiles = [
    { index: 0, name: 'a.mkv' },
    { index: 1, name: 'b.mkv' },
    { index: 2, name: 'c.mkv' },
    { index: 3, name: 'notes.txt' }
  ];
  const { app, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show', hash: 'show-hash' }],
    requestTorrentFiles: async () => {
      fileRequestCount += 1;
      return fileRequestCount === 1 ? initialFiles : refreshedFiles;
    },
    renameTorrentFile: async (hash, oldPath, newPath) => {
      activeRenames += 1;
      maxConcurrentRenames = Math.max(maxConcurrentRenames, activeRenames);
      renameCalls.push({ hash, oldPath, newPath });
      if (oldPath === 'a.old.mkv') {
        await firstRenamePending;
      }
      activeRenames -= 1;
    }
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  const matchInput = findById(app, 'match-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');
  const previewCheckboxes = findPreviewCheckboxes(app);
  previewCheckboxes[1].checked = false;
  previewCheckboxes[1].dispatch('change');

  const savePromise = findById(app, 'save-renames').dispatch('click').listenerResult;
  assert.deepEqual(
    renameCalls.map(call => call.oldPath),
    ['a.old.mkv']
  );
  assert.equal(findRenameButtons(app)[0].disabled, true);
  assert.equal(findById(app, 'torrent-search').disabled, true);
  assert.equal(matchInput.disabled, true);
  assert.equal(findById(app, 'replace-regex').disabled, true);
  assert.equal(findById(app, 'regex-flags').disabled, true);
  assert.equal(findById(app, 'refresh-torrent-files').disabled, true);
  assert.equal(findById(app, 'refresh-torrents').disabled, true);
  assert.equal(findById(app, 'save-renames').disabled, true);
  assert.equal(findById(app, 'select-all-renames').disabled, true);
  assert.equal(findById(app, 'clear-selected-renames').disabled, true);
  assert.equal(
    findPreviewCheckboxes(app).every(checkbox => checkbox.disabled),
    true
  );

  releaseFirstRename();
  await savePromise;

  assert.deepEqual(renameCalls, [
    { hash: 'show-hash', oldPath: 'a.old.mkv', newPath: 'a.mkv' },
    { hash: 'show-hash', oldPath: 'c.old.mkv', newPath: 'c.mkv' }
  ]);
  assert.equal(maxConcurrentRenames, 1);
  assert.equal(fileRequestCount, 2);
  assert.equal(app.textContent.includes('成功 2 项'), true);
  assert.equal(app.textContent.includes('a.old.mkv'), false);
});

test('保存遇到首个错误后停止，刷新文件并显示成功数量和失败文件', async () => {
  let fileRequestCount = 0;
  const renameCalls = [];
  const files = [
    { index: 0, name: 'a.old.mkv' },
    { index: 1, name: 'b.old.mkv' },
    { index: 2, name: 'c.old.mkv' }
  ];
  const { app, tool } = createToolFixture({
    requestTorrents: async () => [{ name: 'Show', hash: 'show-hash' }],
    requestTorrentFiles: async () => {
      fileRequestCount += 1;
      return files;
    },
    renameTorrentFile: async (hash, oldPath, newPath) => {
      renameCalls.push({ hash, oldPath, newPath });
      if (oldPath === 'b.old.mkv') {
        throw new Error('目标已存在');
      }
    }
  });
  await tool.initialize();
  await findRenameButtons(app)[0].dispatch('click').listenerResult;
  const matchInput = findById(app, 'match-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');

  await findById(app, 'save-renames').dispatch('click').listenerResult;

  assert.deepEqual(
    renameCalls.map(call => call.oldPath),
    ['a.old.mkv', 'b.old.mkv']
  );
  assert.equal(fileRequestCount, 2);
  const statusText = findById(app, 'rename-status').textContent;
  assert.equal(statusText.includes('成功 1 项'), true);
  assert.equal(statusText.includes('b.old.mkv'), true);
  assert.equal(statusText.includes('目标已存在'), true);
  assert.equal(findById(app, 'match-regex').disabled, false);
});
