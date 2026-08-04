import { createAuthClient } from './auth.js';
import { createQbittorrentApi } from './qbittorrent-api.js';
import { createRssRulesTool } from './rss-rules.js';
import { createTorrentRenamerTool } from './torrent-renamer.js';

const QUICK_TOOLS_BY_DOCUMENT = new WeakMap();

/**
 * 初始化 Quick Tools 页面并复用同一套鉴权和 API 客户端。
 * @param {object} dependencies 外部依赖
 * @param {Document} dependencies.documentRef 页面文档
 * @returns {Promise<{selectTool: Function}>} 页面控制器
 */
export const initializeQuickTools = ({
  documentRef = globalThis.document,
  createAuthClientImpl = createAuthClient,
  createQbittorrentApiImpl = createQbittorrentApi,
  createRssRulesToolImpl = createRssRulesTool,
  createTorrentRenamerToolImpl = createTorrentRenamerTool
} = {}) => {
  const existingInitialization = QUICK_TOOLS_BY_DOCUMENT.get(documentRef);
  if (existingInitialization) {
    return existingInitialization;
  }

  const initialization = (async () => {
    const rssTab = documentRef.getElementById('rss-rules-tab');
    const torrentTab = documentRef.getElementById('torrent-renamer-tab');
    const rssPanel = documentRef.getElementById('rss-rules-panel');
    const torrentPanel = documentRef.getElementById('torrent-renamer-panel');
    const rssRoot = documentRef.getElementById('rss-rules-tool');
    const torrentRoot = documentRef.getElementById('torrent-renamer-tool');
    const requiredElements = [rssTab, torrentTab, rssPanel, torrentPanel, rssRoot, torrentRoot];
    if (requiredElements.some(element => !element)) {
      throw new Error('Quick Tools 页面结构不完整');
    }

    const authClient = createAuthClientImpl({ documentRef });
    const api = createQbittorrentApiImpl(authClient.authenticatedFetch);
    const rssTool = createRssRulesToolImpl({ root: rssRoot, api, documentRef });
    const torrentTool = createTorrentRenamerToolImpl({ root: torrentRoot, api, documentRef });
    const initializationPromises = {};

    const initializeToolOnce = toolName => {
      if (!initializationPromises[toolName]) {
        const tool = toolName === 'rss' ? rssTool : torrentTool;
        initializationPromises[toolName] = Promise.resolve().then(() => tool.initialize());
      }
      return initializationPromises[toolName];
    };

    const selectTool = async toolName => {
      const isRssSelected = toolName === 'rss';
      rssTab.setAttribute('aria-selected', String(isRssSelected));
      torrentTab.setAttribute('aria-selected', String(!isRssSelected));
      rssPanel.hidden = !isRssSelected;
      torrentPanel.hidden = isRssSelected;
      await initializeToolOnce(isRssSelected ? 'rss' : 'torrent');
    };

    rssTab.addEventListener('click', () => selectTool('rss'));
    torrentTab.addEventListener('click', () => selectTool('torrent'));
    await selectTool('rss');

    return { selectTool };
  })();

  QUICK_TOOLS_BY_DOCUMENT.set(documentRef, initialization);
  return initialization;
};

if (typeof document !== 'undefined') {
  initializeQuickTools().catch(error => {
    console.error('Quick Tools 初始化失败', error);
  });
}
