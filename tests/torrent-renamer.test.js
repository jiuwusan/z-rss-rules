import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRenamePreview,
  filterTorrents,
  splitTorrentPath
} from '../frontend/torrent-renamer.js';

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
