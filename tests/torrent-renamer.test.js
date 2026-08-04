import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRenamePreview,
  createTorrentRenamerTool,
  filterTorrents,
  splitTorrentPath
} from '../frontend/torrent-renamer.js';
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
const findTorrentButtons = app => findElements(app, element => element.className === 'torrent-item');
const findPreviewCheckboxes = app => findElements(app, element => element.className === 'rename-preview-select');

test('filterTorrents 按名称或 hash 忽略大小写筛选', () => {
  const torrents = [
    { name: 'Show One', hash: 'abc123' },
    { name: 'Movie Two', hash: 'def456' }
  ];

  assert.deepEqual(filterTorrents(torrents, 'SHOW'), [torrents[0]]);
  assert.deepEqual(filterTorrents(torrents, 'F456'), [torrents[1]]);
  assert.deepEqual(filterTorrents(torrents, ''), torrents);
});

test('splitTorrentPath 从最后一个路径分隔符拆分路径', () => {
  assert.deepEqual(splitTorrentPath('目录/子目录/文件.mkv'), {
    directory: '目录/子目录/',
    fileName: '文件.mkv'
  });
  assert.deepEqual(splitTorrentPath('目录\\子目录\\文件.mkv'), {
    directory: '目录\\子目录\\',
    fileName: '文件.mkv'
  });
  assert.deepEqual(splitTorrentPath('根目录文件.mkv'), {
    directory: '',
    fileName: '根目录文件.mkv'
  });
});

test('仅替换最后文件名并保留目录', () => {
  const preview = buildRenamePreview(
    [{ index: 0, name: '目录/S01E01.old.mkv' }],
    { matchRegex: '\\.old', replaceRegex: '', flags: 'g' }
  );

  assert.equal(preview.error, null);
  assert.equal(preview.items[0].index, 0);
  assert.equal(preview.items[0].newPath, '目录/S01E01.mkv');
  assert.equal(preview.items[0].isValid, true);
  assert.equal(preview.items[0].isSelected, true);
});

test('Windows 风格源路径仅替换最后的文件名', () => {
  const preview = buildRenamePreview(
    [{ index: 0, name: '目录\\old.mkv' }],
    { matchRegex: '^old', replaceRegex: 'new', flags: 'g' }
  );

  assert.equal(preview.items[0].newPath, '目录\\new.mkv');
});

test('支持捕获组和忽略大小写', () => {
  const preview = buildRenamePreview(
    [{ index: 0, name: 'SHOW.01.MKV' }],
    { matchRegex: 'show\\.(\\d+)', replaceRegex: 'Episode-$1', flags: 'gi' }
  );

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

  assert.deepEqual(preview.items.map(item => item.newFileName), ['new.first.mkv', 'new.second.mkv']);
});

test('全局正则不会污染后续文件的替换状态', () => {
  const preview = buildRenamePreview(
    [
      { index: 0, name: 'first.old.mkv' },
      { index: 1, name: 'second.old.mkv' }
    ],
    { matchRegex: '\\.old', replaceRegex: '', flags: 'g' }
  );

  assert.deepEqual(preview.items.map(item => item.newFileName), ['first.mkv', 'second.mkv']);
});

test('未匹配正则的文件不可保存', () => {
  const preview = buildRenamePreview(
    [{ index: 0, name: 'episode.mkv' }],
    { matchRegex: '\\.old', replaceRegex: '', flags: 'g' }
  );

  assert.equal(preview.items[0].isValid, false);
  assert.equal(preview.items[0].isSelected, false);
  assert.match(preview.items[0].status, /未匹配/);
});

test('替换后没有变化的文件不可保存', () => {
  const preview = buildRenamePreview(
    [{ index: 0, name: 'episode.mkv' }],
    { matchRegex: 'episode', replaceRegex: 'episode', flags: 'g' }
  );

  assert.equal(preview.items[0].isValid, false);
  assert.equal(preview.items[0].isSelected, false);
  assert.match(preview.items[0].status, /无变化/);
});

for (const invalidName of ['', '.', '..']) {
  test(`替换为无效文件名“${invalidName || '空字符串'}”时不可保存`, () => {
    const preview = buildRenamePreview(
      [{ index: 0, name: 'episode.mkv' }],
      { matchRegex: 'episode\\.mkv', replaceRegex: invalidName, flags: 'g' }
    );

    assert.equal(preview.items[0].isValid, false);
    assert.equal(preview.items[0].isSelected, false);
    assert.match(preview.items[0].status, /无效/);
  });
}

for (const invalidName of ['目录/episode.mkv', '目录\\\\episode.mkv']) {
  test(`替换后文件名含路径分隔符“${invalidName}”时不可保存`, () => {
    const preview = buildRenamePreview(
      [{ index: 0, name: 'episode.mkv' }],
      { matchRegex: 'episode\\.mkv', replaceRegex: invalidName, flags: 'g' }
    );

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
  const preview = buildRenamePreview(
    [{ index: 0, name: 'episode.mkv' }],
    { matchRegex: '[', replaceRegex: '', flags: 'g' }
  );

  assert.equal(preview.items.length, 0);
  assert.match(preview.error, /Invalid regular expression/);
});

test('空正则返回明确错误且不产生可保存预览', () => {
  const preview = buildRenamePreview(
    [{ index: 0, name: 'episode.mkv' }],
    { matchRegex: '', replaceRegex: 'prefix-', flags: 'g' }
  );

  assert.equal(preview.items.length, 0);
  assert.match(preview.error, /不能为空/);
});

test('源路径以分隔符结尾时不允许通过空 basename 创建文件名', () => {
  const preview = buildRenamePreview(
    [{ index: 0, name: '目录/' }],
    { matchRegex: '^$', replaceRegex: 'created.mkv', flags: 'g' }
  );

  assert.equal(preview.items[0].newFileName, '');
  assert.equal(preview.items[0].newPath, '目录/');
  assert.equal(preview.items[0].isValid, false);
  assert.equal(preview.items[0].isSelected, false);
  assert.match(preview.items[0].status, /无效/);
});

test('initialize 加载 Torrent，支持名称和 hash 搜索、单选及即时预览', async () => {
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
  assert.deepEqual(findTorrentButtons(app).map(button => button.textContent), ['Show Oneabc123', 'Movie Twodef456']);
  assert.equal(findById(app, 'regex-flags').value, 'g');

  const searchInput = findById(app, 'torrent-search');
  searchInput.value = 'SHOW';
  searchInput.dispatch('input');
  assert.deepEqual(findTorrentButtons(app).map(button => button.textContent), ['Show Oneabc123']);
  searchInput.value = 'F456';
  searchInput.dispatch('input');
  assert.deepEqual(findTorrentButtons(app).map(button => button.textContent), ['Movie Twodef456']);

  searchInput.value = '';
  searchInput.dispatch('input');
  await findTorrentButtons(app)[0].dispatch('click').listenerResult;
  assert.deepEqual(fileRequestHashes, ['abc123']);
  assert.equal(findTorrentButtons(app)[0].getAttribute('aria-pressed'), 'true');
  assert.equal(findTorrentButtons(app)[1].getAttribute('aria-pressed'), 'false');

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
  const firstPreviewRow = previewTable.children[1].children[0];
  assert.equal(firstPreviewRow.children[1].textContent, 'a.old.mkv');
  assert.equal(firstPreviewRow.children[2].textContent, 'a.mkv');

  previewCheckboxes[0].checked = false;
  previewCheckboxes[0].dispatch('change');
  assert.equal(findById(app, 'save-renames').disabled, true);
  findById(app, 'select-all-renames').dispatch('click');
  previewCheckboxes = findPreviewCheckboxes(app);
  assert.equal(previewCheckboxes[0].checked, true);
  assert.equal(previewCheckboxes[1].checked, false);
  findById(app, 'clear-selected-renames').dispatch('click');
  assert.equal(findPreviewCheckboxes(app).every(checkbox => !checkbox.checked), true);

  await tool.refresh();
  assert.equal(torrentRequestCount, 2);
  assert.equal(findElements(app, element => element.className === 'torrent-renamer-layout').length, 1);
});

test('切换 Torrent 时迟到的文件响应不会覆盖当前选择', async () => {
  let resolveFirstFiles;
  const firstFiles = new Promise(resolve => {
    resolveFirstFiles = resolve;
  });
  const { app, tool } = createToolFixture({
    requestTorrents: async () => [
      { name: 'First', hash: 'first-hash' },
      { name: 'Second', hash: 'second-hash' }
    ],
    requestTorrentFiles: hash => (
      hash === 'first-hash'
        ? firstFiles
        : Promise.resolve([{ index: 0, name: 'second.old.mkv' }])
    )
  });
  await tool.initialize();

  const firstRequest = findTorrentButtons(app)[0].dispatch('click').listenerResult;
  const secondRequest = findTorrentButtons(app)[1].dispatch('click').listenerResult;
  await secondRequest;
  resolveFirstFiles([{ index: 0, name: 'first.old.mkv' }]);
  await firstRequest;

  const matchInput = findById(app, 'match-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');
  assert.equal(app.textContent.includes('second.old.mkv'), true);
  assert.equal(app.textContent.includes('first.old.mkv'), false);
  assert.equal(findTorrentButtons(app)[1].getAttribute('aria-pressed'), 'true');
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
  await findTorrentButtons(app)[0].dispatch('click').listenerResult;
  const matchInput = findById(app, 'match-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');
  const previewCheckboxes = findPreviewCheckboxes(app);
  previewCheckboxes[1].checked = false;
  previewCheckboxes[1].dispatch('change');

  const savePromise = findById(app, 'save-renames').dispatch('click').listenerResult;
  assert.deepEqual(renameCalls.map(call => call.oldPath), ['a.old.mkv']);
  assert.equal(findTorrentButtons(app)[0].disabled, true);
  assert.equal(findById(app, 'torrent-search').disabled, true);
  assert.equal(matchInput.disabled, true);
  assert.equal(findById(app, 'replace-regex').disabled, true);
  assert.equal(findById(app, 'regex-flags').disabled, true);
  assert.equal(findById(app, 'refresh-torrent-files').disabled, true);
  assert.equal(findById(app, 'save-renames').disabled, true);
  assert.equal(findPreviewCheckboxes(app).every(checkbox => checkbox.disabled), true);

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
  await findTorrentButtons(app)[0].dispatch('click').listenerResult;
  const matchInput = findById(app, 'match-regex');
  matchInput.value = '\\.old';
  matchInput.dispatch('input');

  await findById(app, 'save-renames').dispatch('click').listenerResult;

  assert.deepEqual(renameCalls.map(call => call.oldPath), ['a.old.mkv', 'b.old.mkv']);
  assert.equal(fileRequestCount, 2);
  const statusText = findById(app, 'rename-status').textContent;
  assert.equal(statusText.includes('成功 1 项'), true);
  assert.equal(statusText.includes('b.old.mkv'), true);
  assert.equal(statusText.includes('目标已存在'), true);
  assert.equal(findById(app, 'match-regex').disabled, false);
});
