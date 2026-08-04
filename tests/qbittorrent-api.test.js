import assert from 'node:assert/strict';
import test from 'node:test';
import { createQbittorrentApi } from '../frontend/qbittorrent-api.js';

const createAuthenticatedFetch = ({ ok = true, status = 200, json = {} } = {}) => {
  const requests = [];
  const authenticatedFetch = async (url, options) => {
    requests.push({ url, options });
    return { ok, status, json: async () => json };
  };

  return { authenticatedFetch, requests };
};

test('requestRules 使用凭据读取 RSS 规则', async () => {
  const serverRules = { HDSWEB: { enabled: true } };
  const { authenticatedFetch, requests } = createAuthenticatedFetch({ json: serverRules });

  const result = await createQbittorrentApi(authenticatedFetch).requestRules();

  assert.equal(requests[0].url, '/api/v2/rss/rules');
  assert.equal(requests[0].options.credentials, 'include');
  assert.deepEqual(result, serverRules);
});

test('requestRules 失败时抛出读取规则中文错误', async () => {
  const { authenticatedFetch } = createAuthenticatedFetch({ ok: false, status: 500 });

  await assert.rejects(createQbittorrentApi(authenticatedFetch).requestRules(), /读取规则失败：HTTP 500/);
});

test('setRule 以 URL 编码表单提交完整规则定义', async () => {
  const { authenticatedFetch, requests } = createAuthenticatedFetch();
  const ruleDef = { enabled: true, mustContain: 'H265.*HDSWEB.*(九门)' };

  await createQbittorrentApi(authenticatedFetch).setRule('HDSWEB', ruleDef);

  assert.equal(requests[0].url, '/api/v2/rss/setRule');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.credentials, 'include');
  assert.equal(requests[0].options.body.get('ruleName'), 'HDSWEB');
  assert.deepEqual(JSON.parse(requests[0].options.body.get('ruleDef')), ruleDef);
});

test('setRule 失败时抛出包含规则名的中文错误', async () => {
  const { authenticatedFetch } = createAuthenticatedFetch({ ok: false, status: 400 });

  await assert.rejects(createQbittorrentApi(authenticatedFetch).setRule('HDSWEB', {}), /保存规则“HDSWEB”失败：HTTP 400/);
});

test('requestTorrents 按添加时间倒序读取种子', async () => {
  const torrents = [{ hash: 'abc' }];
  const { authenticatedFetch, requests } = createAuthenticatedFetch({ json: torrents });

  const result = await createQbittorrentApi(authenticatedFetch).requestTorrents();

  assert.equal(requests[0].url, '/api/v2/torrents/info?sort=added_on&reverse=true');
  assert.equal(requests[0].options.credentials, 'include');
  assert.deepEqual(result, torrents);
});

test('requestTorrents 失败时抛出读取种子中文错误', async () => {
  const { authenticatedFetch } = createAuthenticatedFetch({ ok: false, status: 503 });

  await assert.rejects(createQbittorrentApi(authenticatedFetch).requestTorrents(), /读取种子失败：HTTP 503/);
});

test('requestTorrentFiles 使用 URLSearchParams 编码种子哈希', async () => {
  const files = [{ name: '目录/文件.mkv' }];
  const { authenticatedFetch, requests } = createAuthenticatedFetch({ json: files });

  const result = await createQbittorrentApi(authenticatedFetch).requestTorrentFiles('hash value');

  assert.equal(requests[0].url, '/api/v2/torrents/files?hash=hash+value');
  assert.equal(requests[0].options.credentials, 'include');
  assert.deepEqual(result, files);
});

test('requestTorrentFiles 失败时抛出包含哈希的中文错误', async () => {
  const { authenticatedFetch } = createAuthenticatedFetch({ ok: false, status: 404 });

  await assert.rejects(createQbittorrentApi(authenticatedFetch).requestTorrentFiles('hash value'), /读取种子 hash value 的文件失败：HTTP 404/);
});

test('renameTorrentFile 以 URL 编码表单重命名文件', async () => {
  const { authenticatedFetch, requests } = createAuthenticatedFetch();

  await createQbittorrentApi(authenticatedFetch).renameTorrentFile('abc', '目录/旧.mkv', '目录/新.mkv');

  assert.equal(requests[0].url, '/api/v2/torrents/renameFile');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.credentials, 'include');
  assert.equal(requests[0].options.body.get('hash'), 'abc');
  assert.equal(requests[0].options.body.get('oldPath'), '目录/旧.mkv');
  assert.equal(requests[0].options.body.get('newPath'), '目录/新.mkv');
});

test('renameTorrentFile 失败时抛出包含路径的中文错误', async () => {
  const { authenticatedFetch } = createAuthenticatedFetch({ ok: false, status: 409 });

  await assert.rejects(createQbittorrentApi(authenticatedFetch).renameTorrentFile('abc', '目录/旧.mkv', '目录/新.mkv'), /重命名文件“目录\/旧.mkv”为“目录\/新.mkv”失败：HTTP 409/);
});
