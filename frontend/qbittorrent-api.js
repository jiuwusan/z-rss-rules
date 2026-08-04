/**
 * 创建 qBittorrent Quick Tools 所需的 API 客户端。
 * @param {(url: string, options?: object) => Promise<Response>} authenticatedFetch 已鉴权请求函数
 * @returns {{requestRules: Function, setRule: Function, requestTorrents: Function, requestTorrentFiles: Function, renameTorrentFile: Function}}
 */
export const createQbittorrentApi = authenticatedFetch => {
  /**
   * 检查 qBittorrent API 响应状态。
   * @param {Response} response 请求响应
   * @param {string} errorMessage 失败时的中文错误说明
   * @returns {void}
   */
  const ensureSuccess = (response, errorMessage) => {
    if (!response.ok) {
      throw new Error(`${errorMessage}：HTTP ${response.status}`);
    }
  };

  /**
   * 读取 RSS 规则。
   * @returns {Promise<Record<string, object>>} 服务端规则
   */
  const requestRules = async () => {
    const response = await authenticatedFetch('/api/v2/rss/rules', { credentials: 'include' });
    ensureSuccess(response, '读取规则失败');
    return response.json();
  };

  /**
   * 保存一条 RSS 规则。
   * @param {string} ruleName 规则名称
   * @param {object} ruleDef 规则定义
   * @returns {Promise<void>}
   */
  const setRule = async (ruleName, ruleDef) => {
    const body = new URLSearchParams({ ruleName, ruleDef: JSON.stringify(ruleDef) });
    const response = await authenticatedFetch('/api/v2/rss/setRule', {
      method: 'POST',
      credentials: 'include',
      body
    });
    ensureSuccess(response, `保存规则“${ruleName}”失败`);
  };

  /**
   * 按添加时间倒序读取种子列表。
   * @returns {Promise<object[]>} 种子列表
   */
  const requestTorrents = async () => {
    const response = await authenticatedFetch('/api/v2/torrents/info?sort=added_on&reverse=true', {
      credentials: 'include'
    });
    ensureSuccess(response, '读取种子失败');
    return response.json();
  };

  /**
   * 读取指定种子的文件列表。
   * @param {string} hash 种子哈希
   * @returns {Promise<object[]>} 文件列表
   */
  const requestTorrentFiles = async hash => {
    const query = new URLSearchParams({ hash });
    const response = await authenticatedFetch(`/api/v2/torrents/files?${query}`, { credentials: 'include' });
    ensureSuccess(response, `读取种子 ${hash} 的文件失败`);
    return response.json();
  };

  /**
   * 重命名种子内的一个文件。
   * @param {string} hash 种子哈希
   * @param {string} oldPath 原路径
   * @param {string} newPath 新路径
   * @returns {Promise<void>}
   */
  const renameTorrentFile = async (hash, oldPath, newPath) => {
    const body = new URLSearchParams({ hash, oldPath, newPath });
    const response = await authenticatedFetch('/api/v2/torrents/renameFile', {
      method: 'POST',
      credentials: 'include',
      body
    });
    ensureSuccess(response, `重命名文件“${oldPath}”为“${newPath}”失败`);
  };

  return { requestRules, setRule, requestTorrents, requestTorrentFiles, renameTorrentFile };
};
