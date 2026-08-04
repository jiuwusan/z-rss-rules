export const filterTorrents = (torrents, query) => {
  const normalizedQuery = String(query ?? '').toLowerCase();
  if (!normalizedQuery) {
    return torrents;
  }

  return torrents.filter(torrent => (
    String(torrent.name ?? '').toLowerCase().includes(normalizedQuery)
    || String(torrent.hash ?? '').toLowerCase().includes(normalizedQuery)
  ));
};

export const splitTorrentPath = path => {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (separatorIndex === -1) {
    return { directory: '', fileName: path };
  }

  return {
    directory: path.slice(0, separatorIndex + 1),
    fileName: path.slice(separatorIndex + 1)
  };
};

export const buildRenamePreview = (files, { matchRegex, replaceRegex, flags }) => {
  if (matchRegex === '') {
    return { error: '匹配正则不能为空', items: [] };
  }

  let regex;
  try {
    regex = new RegExp(matchRegex, flags);
  } catch (error) {
    return { error: error.message, items: [] };
  }

  const createRegex = () => new RegExp(regex.source, regex.flags);
  const items = files.map((file, position) => {
    const oldPath = file.name;
    const { directory, fileName: oldFileName } = splitTorrentPath(oldPath);
    if (oldFileName === '') {
      return {
        index: file.index ?? position,
        oldPath,
        oldFileName,
        newPath: oldPath,
        newFileName: oldFileName,
        status: '无效源文件名',
        isValid: false,
        isSelected: false
      };
    }

    const isMatched = createRegex().test(oldFileName);
    const newFileName = oldFileName.replace(createRegex(), replaceRegex);
    const newPath = `${directory}${newFileName}`;
    const isInvalidFileName = (
      newFileName === ''
      || newFileName === '.'
      || newFileName === '..'
      || /[\\/]/u.test(newFileName)
    );
    const isChanged = newFileName !== oldFileName;
    const isValid = isMatched && isChanged && !isInvalidFileName;
    let status = '可重命名';

    if (!isMatched) {
      status = '未匹配正则';
    } else if (!isChanged) {
      status = '无变化';
    } else if (isInvalidFileName) {
      status = '无效文件名';
    }

    return {
      index: file.index ?? position,
      oldPath,
      oldFileName,
      newPath,
      newFileName,
      status,
      isValid,
      isSelected: isValid
    };
  });

  const targetPathCounts = new Map();
  for (const item of items) {
    targetPathCounts.set(item.newPath, (targetPathCounts.get(item.newPath) ?? 0) + 1);
  }
  const existingPaths = new Set(items.map(item => item.oldPath));

  for (const item of items) {
    if (!item.isValid) {
      continue;
    }

    if (targetPathCounts.get(item.newPath) > 1 || existingPaths.has(item.newPath)) {
      item.status = '目标路径冲突';
      item.isValid = false;
      item.isSelected = false;
    }
  }

  return { error: null, items };
};

/**
 * 创建 Torrent 文件重命名工具。
 * @param {object} dependencies 外部依赖
 * @param {HTMLElement} dependencies.root 工具根节点
 * @param {{requestTorrents: Function, requestTorrentFiles: Function, renameTorrentFile: Function}} dependencies.api qBittorrent API
 * @param {Document} dependencies.documentRef 页面文档
 * @returns {{initialize: Function, refresh: Function}} Torrent 重命名控制器
 */
export const createTorrentRenamerTool = ({ root, api, documentRef = globalThis.document }) => {
  let torrents = [];
  let searchQuery = '';
  let selectedTorrent = null;
  let files = [];
  let preview = { error: '匹配正则不能为空', items: [] };
  let fileRequestVersion = 0;
  let isSaving = false;
  let searchInput = null;
  let torrentList = null;
  let matchInput = null;
  let replaceInput = null;
  let flagsInput = null;
  let previewBody = null;
  let selectAllButton = null;
  let clearSelectedButton = null;
  let refreshButton = null;
  let saveButton = null;
  let statusElement = null;

  const setStatus = (message, isError = false) => {
    statusElement.textContent = message;
    statusElement.className = isError ? 'status-message status-error' : 'status-message';
  };

  const getSelectedItems = () => preview.items.filter(item => item.isValid && item.isSelected);

  const updateControls = () => {
    searchInput.disabled = isSaving;
    matchInput.disabled = isSaving || !selectedTorrent;
    replaceInput.disabled = isSaving || !selectedTorrent;
    flagsInput.disabled = isSaving || !selectedTorrent;
    refreshButton.disabled = isSaving || !selectedTorrent;
    selectAllButton.disabled = isSaving || !preview.items.some(item => item.isValid);
    clearSelectedButton.disabled = isSaving || !getSelectedItems().length;
    saveButton.disabled = isSaving || Boolean(preview.error) || !getSelectedItems().length;
    saveButton.textContent = isSaving ? '保存中' : '保存重命名';
  };

  const renderTorrentList = () => {
    const items = filterTorrents(torrents, searchQuery).map(torrent => {
      const button = documentRef.createElement('button');
      const name = documentRef.createElement('span');
      const hash = documentRef.createElement('span');
      button.className = 'torrent-item';
      button.type = 'button';
      button.disabled = isSaving;
      button.setAttribute('aria-pressed', String(torrent.hash === selectedTorrent?.hash));
      name.className = 'torrent-name';
      name.textContent = torrent.name ?? '';
      hash.className = 'torrent-hash';
      hash.textContent = torrent.hash ?? '';
      button.append(name, hash);
      button.addEventListener('click', () => selectTorrent(torrent));
      return button;
    });
    torrentList.replaceChildren(...items);
  };

  const renderPreview = () => {
    const rows = preview.items.map(item => {
      const row = documentRef.createElement('tr');
      const selectionCell = documentRef.createElement('td');
      const oldNameCell = documentRef.createElement('td');
      const newNameCell = documentRef.createElement('td');
      const statusCell = documentRef.createElement('td');
      const checkbox = documentRef.createElement('input');
      checkbox.className = 'rename-preview-select';
      checkbox.type = 'checkbox';
      checkbox.checked = item.isSelected;
      checkbox.disabled = isSaving || !item.isValid;
      checkbox.setAttribute('aria-label', `保存 ${item.oldPath}`);
      checkbox.addEventListener('change', () => {
        item.isSelected = item.isValid && checkbox.checked;
        updateControls();
      });
      oldNameCell.textContent = item.oldFileName;
      newNameCell.textContent = item.newFileName;
      statusCell.textContent = item.status;
      selectionCell.append(checkbox);
      row.append(selectionCell, oldNameCell, newNameCell, statusCell);
      return row;
    });
    previewBody.replaceChildren(...rows);
    updateControls();
  };

  const rebuildPreview = () => {
    preview = buildRenamePreview(files, {
      matchRegex: matchInput.value,
      replaceRegex: replaceInput.value,
      flags: flagsInput.value
    });
    renderPreview();
    if (preview.error) {
      setStatus(`预览失败：${preview.error}`, true);
      return;
    }
    setStatus(selectedTorrent ? `已加载 ${files.length} 个文件` : '请选择 Torrent');
  };

  const loadSelectedTorrentFiles = async () => {
    if (!selectedTorrent) {
      return { isCurrent: false, error: null };
    }

    const requestVersion = ++fileRequestVersion;
    const requestedHash = selectedTorrent.hash;
    setStatus('正在加载 Torrent 文件');
    try {
      const serverFiles = await api.requestTorrentFiles(requestedHash);
      if (requestVersion !== fileRequestVersion || requestedHash !== selectedTorrent?.hash) {
        return { isCurrent: false, error: null };
      }
      files = serverFiles;
      rebuildPreview();
      return { isCurrent: true, error: null };
    } catch (error) {
      if (requestVersion !== fileRequestVersion || requestedHash !== selectedTorrent?.hash) {
        return { isCurrent: false, error: null };
      }
      files = [];
      preview = { error: error.message, items: [] };
      renderPreview();
      setStatus(`Torrent 文件加载失败：${error.message}`, true);
      return { isCurrent: true, error };
    }
  };

  const selectTorrent = async torrent => {
    if (isSaving) {
      return;
    }

    selectedTorrent = torrent;
    files = [];
    preview = { error: '匹配正则不能为空', items: [] };
    renderTorrentList();
    renderPreview();
    await loadSelectedTorrentFiles();
  };

  const loadTorrents = async () => {
    setStatus('正在加载 Torrent');
    try {
      torrents = await api.requestTorrents();
      renderTorrentList();
      setStatus(`已加载 ${torrents.length} 个 Torrent`);
    } catch (error) {
      torrents = [];
      renderTorrentList();
      setStatus(`Torrent 加载失败：${error.message}`, true);
    }
  };

  /**
   * 串行保存当前有效勾选项，首个错误后停止并刷新服务端状态。
   * @returns {Promise<void>}
   */
  const saveSelectedItems = async () => {
    if (isSaving || !selectedTorrent) {
      return;
    }

    const itemsToSave = getSelectedItems();
    if (!itemsToSave.length) {
      return;
    }

    const torrentHash = selectedTorrent.hash;
    let successCount = 0;
    let failedItem = null;
    let saveError = null;
    isSaving = true;
    renderTorrentList();
    renderPreview();
    setStatus('正在保存重命名');

    try {
      for (const item of itemsToSave) {
        try {
          await api.renameTorrentFile(torrentHash, item.oldPath, item.newPath);
          successCount += 1;
        } catch (error) {
          failedItem = item;
          saveError = error;
          break;
        }
      }

      const refreshResult = await loadSelectedTorrentFiles();
      const refreshFailureMessage = refreshResult.error ? `；刷新失败：${refreshResult.error.message}` : '';
      if (saveError) {
        setStatus(`成功 ${successCount} 项；失败文件：${failedItem.oldPath}；${saveError.message}${refreshFailureMessage}`, true);
      } else {
        setStatus(`成功 ${successCount} 项${refreshFailureMessage}`, Boolean(refreshResult.error));
      }
    } finally {
      isSaving = false;
      renderTorrentList();
      renderPreview();
    }
  };

  const renderTool = () => {
    const layout = documentRef.createElement('div');
    const torrentPanel = documentRef.createElement('section');
    const editorPanel = documentRef.createElement('section');
    const previewTable = documentRef.createElement('table');
    const previewHead = documentRef.createElement('thead');
    const previewHeaderRow = documentRef.createElement('tr');
    const actions = documentRef.createElement('div');

    searchInput = documentRef.createElement('input');
    torrentList = documentRef.createElement('div');
    matchInput = documentRef.createElement('input');
    replaceInput = documentRef.createElement('input');
    flagsInput = documentRef.createElement('input');
    previewBody = documentRef.createElement('tbody');
    selectAllButton = documentRef.createElement('button');
    clearSelectedButton = documentRef.createElement('button');
    refreshButton = documentRef.createElement('button');
    saveButton = documentRef.createElement('button');
    statusElement = documentRef.createElement('p');

    layout.className = 'torrent-renamer-layout';
    torrentPanel.className = 'torrent-panel';
    editorPanel.className = 'torrent-renamer-editor';
    searchInput.id = 'torrent-search';
    searchInput.type = 'search';
    searchInput.placeholder = '搜索 Torrent 名称或 hash';
    searchInput.setAttribute('aria-label', '搜索 Torrent 名称或 hash');
    torrentList.className = 'torrent-list';
    matchInput.id = 'match-regex';
    matchInput.placeholder = '匹配正则';
    matchInput.setAttribute('aria-label', '匹配正则');
    replaceInput.id = 'replace-regex';
    replaceInput.placeholder = '替换文本';
    replaceInput.setAttribute('aria-label', '替换文本');
    flagsInput.id = 'regex-flags';
    flagsInput.value = 'g';
    flagsInput.placeholder = '正则 flags';
    flagsInput.setAttribute('aria-label', '正则 flags');
    previewTable.className = 'rename-preview-table';
    ['保存', '原文件名', '新文件名', '状态'].forEach(label => {
      const header = documentRef.createElement('th');
      header.textContent = label;
      previewHeaderRow.append(header);
    });
    previewHead.append(previewHeaderRow);
    previewTable.append(previewHead, previewBody);
    actions.className = 'actions';
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
    statusElement.id = 'rename-status';
    statusElement.setAttribute('role', 'status');
    statusElement.setAttribute('aria-live', 'polite');

    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      renderTorrentList();
    });
    [matchInput, replaceInput, flagsInput].forEach(input => input.addEventListener('input', rebuildPreview));
    selectAllButton.addEventListener('click', () => {
      preview.items.forEach(item => {
        item.isSelected = item.isValid;
      });
      renderPreview();
    });
    clearSelectedButton.addEventListener('click', () => {
      preview.items.forEach(item => {
        item.isSelected = false;
      });
      renderPreview();
    });
    refreshButton.addEventListener('click', () => loadSelectedTorrentFiles());
    saveButton.addEventListener('click', () => saveSelectedItems());

    torrentPanel.append(searchInput, torrentList);
    actions.append(selectAllButton, clearSelectedButton, refreshButton, saveButton);
    editorPanel.append(matchInput, replaceInput, flagsInput, previewTable, actions, statusElement);
    layout.append(torrentPanel, editorPanel);
    root.replaceChildren(layout);
    renderTorrentList();
    renderPreview();
    setStatus('请选择 Torrent');
  };

  const initialize = async () => {
    renderTool();
    await loadTorrents();
  };

  return { initialize, refresh: loadTorrents };
};
