import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeDocument, findElements, waitForCondition } from './helpers/fake-dom.js';

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

const initializeRealClients = async ({ document, fetchImpl }) => {
  const { initializeQuickTools } = await import('../frontend/quick-tools.js');
  let api;

  await initializeQuickTools({
    documentRef: document,
    fetchImpl,
    createRssRulesToolImpl: dependencies => {
      api = dependencies.api;
      return { async initialize() {} };
    },
    createTorrentRenamerToolImpl: () => ({ async initialize() {} })
  });

  return api;
};

const submitLogin = async document => {
  await waitForCondition(() => document.getElementById('login-username'));
  document.getElementById('login-username').value = 'admin';
  document.getElementById('login-password').value = 'secret';
  const loginForm = findElements(document.body, element => element.className === 'login-form')[0];
  await loginForm.dispatch('submit').listenerResult;
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
  assert.match(html, /class="quick-tools-layout"/);
  assert.match(html, /<nav[^>]*id="quick-tools-tabs"[^>]*class="tool-tabs"/);
  assert.match(html, /<div class="tool-content">/);
});

test('Quick Tools 样式包含侧边导航壳层、窄屏布局和登录弹窗样式', () => {
  const css = fs.readFileSync(QUICK_TOOLS_CSS_PATH, 'utf8');

  assert.match(css, /\.quick-tools-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*220px\s+minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.tool-tabs\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.quick-tools-layout\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /\.login-overlay\s*\{/);
  assert.match(css, /\.login-dialog\s*\{/);
  assert.match(css, /\.login-form\s*\{[^}]*margin:\s*0;/s);
  assert.match(css, /\.rename-preview-select\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*margin:\s*0;/s);
});

test('真实 auth 和 API 组合在 requestRules 403 登录后重放原 GET 请求', async () => {
  const { document } = createPageFixture();
  const fetchCalls = [];
  let ruleRequestCount = 0;
  const expectedRules = { HDSWEB: { mustContain: '(九门)' } };
  const fetchImpl = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === '/api/v2/auth/login') {
      return { ok: true, status: 200 };
    }

    ruleRequestCount += 1;
    return ruleRequestCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200, json: async () => expectedRules };
  };
  const api = await initializeRealClients({ document, fetchImpl });

  const rulesPromise = api.requestRules();
  await submitLogin(document);
  const rules = await rulesPromise;

  assert.deepEqual(rules, expectedRules);
  assert.deepEqual(
    fetchCalls.map(call => call.url),
    ['/api/v2/rss/rules', '/api/v2/auth/login', '/api/v2/rss/rules']
  );
  assert.strictEqual(fetchCalls[0].options, fetchCalls[2].options);
  assert.deepEqual(fetchCalls[0].options, { credentials: 'include' });
});

test('真实 auth 和 API 组合在 setRule 403 登录后重放同一表单请求', async () => {
  const { document } = createPageFixture();
  const fetchCalls = [];
  let setRuleRequestCount = 0;
  const ruleDef = { assignedCategory: 'series', mustContain: '(九门)' };
  const fetchImpl = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === '/api/v2/auth/login') {
      return { ok: true, status: 200 };
    }

    setRuleRequestCount += 1;
    return setRuleRequestCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200 };
  };
  const api = await initializeRealClients({ document, fetchImpl });

  const savePromise = api.setRule('HDSWEB', ruleDef);
  await submitLogin(document);
  await savePromise;

  assert.deepEqual(
    fetchCalls.map(call => call.url),
    ['/api/v2/rss/setRule', '/api/v2/auth/login', '/api/v2/rss/setRule']
  );
  assert.strictEqual(fetchCalls[0].options, fetchCalls[2].options);
  assert.strictEqual(fetchCalls[0].options.body, fetchCalls[2].options.body);
  assert.ok(fetchCalls[0].options.body instanceof URLSearchParams);
  assert.equal(fetchCalls[0].options.body.get('ruleName'), 'HDSWEB');
  assert.equal(fetchCalls[0].options.body.get('ruleDef'), JSON.stringify(ruleDef));
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
