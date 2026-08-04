import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeDocument } from './helpers/fake-dom.js';

const CURRENT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const QUICK_TOOLS_HTML_PATH = path.join(CURRENT_DIRECTORY, '..', 'frontend', 'quick-tools.html');
const QUICK_TOOLS_CSS_PATH = path.join(CURRENT_DIRECTORY, '..', 'frontend', 'quick-tools.css');

const createPageFixture = () => {
  const { app, document } = createFakeDocument();
  const tabList = document.createElement('div');
  const rssTab = document.createElement('button');
  const torrentTab = document.createElement('button');
  const rssPanel = document.createElement('section');
  const torrentPanel = document.createElement('section');
  const rssRoot = document.createElement('div');
  const torrentRoot = document.createElement('div');

  tabList.id = 'quick-tools-tabs';
  rssTab.id = 'rss-rules-tab';
  torrentTab.id = 'torrent-renamer-tab';
  rssPanel.id = 'rss-rules-panel';
  torrentPanel.id = 'torrent-renamer-panel';
  rssRoot.id = 'rss-rules-tool';
  torrentRoot.id = 'torrent-renamer-tool';
  rssTab.setAttribute('aria-selected', 'true');
  torrentTab.setAttribute('aria-selected', 'false');
  torrentPanel.hidden = true;
  rssPanel.append(rssRoot);
  torrentPanel.append(torrentRoot);
  tabList.append(rssTab, torrentTab);
  app.append(tabList, rssPanel, torrentPanel);

  return { document, rssPanel, rssTab, torrentPanel, torrentTab };
};

test('Quick Tools HTML 提供标题、样式、模块入口和两个工具面板', () => {
  const html = fs.readFileSync(QUICK_TOOLS_HTML_PATH, 'utf8');

  assert.match(html, /<title>qBittorrent Quick Tools<\/title>/);
  assert.match(html, />RSS 规则关键词</);
  assert.match(html, />Torrent 文件重命名</);
  assert.match(html, /<script type="module" src="\.\/quick-tools\.js(?:\?[^\"]+)?"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/quick-tools\.css(?:\?[^\"]+)?"/);
  assert.match(html, /id="rss-rules-tool"/);
  assert.match(html, /id="torrent-renamer-tool"/);
  assert.match(html, /id="rss-rules-tab"[^>]*aria-selected="true"/);
  assert.match(html, /id="torrent-renamer-tab"[^>]*aria-selected="false"/);
  assert.match(html, /id="torrent-renamer-panel"[^>]*hidden/);
});

test('Quick Tools 样式包含双栏、窄屏纵向和登录弹窗样式', () => {
  const css = fs.readFileSync(QUICK_TOOLS_CSS_PATH, 'utf8');

  assert.match(css, /grid-template-columns:\s*minmax\([^;]+\)\s+minmax\([^;]+\)/);
  assert.match(css, /@media\s*\(max-width:\s*\d+px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.match(css, /\.login-overlay\s*\{/);
  assert.match(css, /\.login-dialog\s*\{/);
});

test('initializeQuickTools 只创建一套共享 auth 和 API，默认只初始化 RSS', async () => {
  const { document, rssPanel, rssTab, torrentPanel, torrentTab } = createPageFixture();
  const sharedAuthClient = { authenticatedFetch() {} };
  const sharedApi = { name: 'shared-api' };
  const calls = { auth: 0, api: 0, rssCreate: 0, rssInitialize: 0, torrentCreate: 0, torrentInitialize: 0 };
  let rssApi;
  let torrentApi;
  const { initializeQuickTools } = await import('../frontend/quick-tools.js');

  await initializeQuickTools({
    documentRef: document,
    createAuthClientImpl: dependencies => {
      calls.auth += 1;
      assert.strictEqual(dependencies.documentRef, document);
      return sharedAuthClient;
    },
    createQbittorrentApiImpl: authenticatedFetch => {
      calls.api += 1;
      assert.strictEqual(authenticatedFetch, sharedAuthClient.authenticatedFetch);
      return sharedApi;
    },
    createRssRulesToolImpl: ({ root, api }) => {
      calls.rssCreate += 1;
      assert.strictEqual(root, document.getElementById('rss-rules-tool'));
      rssApi = api;
      return {
        async initialize() {
          calls.rssInitialize += 1;
        }
      };
    },
    createTorrentRenamerToolImpl: ({ root, api }) => {
      calls.torrentCreate += 1;
      assert.strictEqual(root, document.getElementById('torrent-renamer-tool'));
      torrentApi = api;
      return {
        async initialize() {
          calls.torrentInitialize += 1;
        }
      };
    }
  });

  assert.deepEqual(calls, {
    auth: 1,
    api: 1,
    rssCreate: 1,
    rssInitialize: 1,
    torrentCreate: 1,
    torrentInitialize: 0
  });
  assert.strictEqual(rssApi, sharedApi);
  assert.strictEqual(torrentApi, sharedApi);
  assert.equal(rssTab.getAttribute('aria-selected'), 'true');
  assert.equal(torrentTab.getAttribute('aria-selected'), 'false');
  assert.equal(rssPanel.hidden, false);
  assert.equal(torrentPanel.hidden, true);
});

test('首次切换才初始化 Torrent，往返切换不重复初始化并保留面板状态', async () => {
  const { document, rssPanel, rssTab, torrentPanel, torrentTab } = createPageFixture();
  const calls = { rssInitialize: 0, torrentInitialize: 0 };
  const rssState = document.createElement('input');
  const torrentState = document.createElement('input');
  rssState.value = 'RSS 草稿';
  torrentState.value = 'Torrent 草稿';
  const { initializeQuickTools } = await import('../frontend/quick-tools.js');

  await initializeQuickTools({
    documentRef: document,
    createAuthClientImpl: () => ({ authenticatedFetch() {} }),
    createQbittorrentApiImpl: () => ({}),
    createRssRulesToolImpl: ({ root }) => ({
      async initialize() {
        calls.rssInitialize += 1;
        root.append(rssState);
      }
    }),
    createTorrentRenamerToolImpl: ({ root }) => ({
      async initialize() {
        calls.torrentInitialize += 1;
        root.append(torrentState);
      }
    })
  });

  await torrentTab.dispatch('click').listenerResult;
  assert.equal(calls.torrentInitialize, 1);
  assert.equal(rssTab.getAttribute('aria-selected'), 'false');
  assert.equal(torrentTab.getAttribute('aria-selected'), 'true');
  assert.equal(rssPanel.hidden, true);
  assert.equal(torrentPanel.hidden, false);

  await rssTab.dispatch('click').listenerResult;
  await torrentTab.dispatch('click').listenerResult;
  assert.deepEqual(calls, { rssInitialize: 1, torrentInitialize: 1 });
  assert.strictEqual(document.getElementById('rss-rules-tool').children[0], rssState);
  assert.strictEqual(document.getElementById('torrent-renamer-tool').children[0], torrentState);
  assert.equal(rssState.value, 'RSS 草稿');
  assert.equal(torrentState.value, 'Torrent 草稿');
});
