export const filterTorrents = (torrents, query) => {
  const normalizedQuery = String(query ?? '').toLowerCase();
  if (!normalizedQuery) {
    return torrents;
  }

  return torrents.filter(
    torrent =>
      String(torrent.name ?? '')
        .toLowerCase()
        .includes(normalizedQuery) ||
      String(torrent.hash ?? '')
        .toLowerCase()
        .includes(normalizedQuery)
  );
};

export const splitTorrentPath = path => {
  const separatorIndex = path.lastIndexOf('/');
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
    const isInvalidFileName = newFileName === '' || newFileName === '.' || newFileName === '..' || /[\\/]/u.test(newFileName);
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
  let torrentRequestVersion = 0;
  let initializationPromise = null;
  let isLoadingTorrents = false;
  let isLoadingFiles = false;
  let fileLoadError = null;
  let isSaving = false;
  let searchInput = null;
  let torrentList = null;
  let matchInput = null;
  let replaceInput = null;
  let flagsInput = null;
  let previewBody = null;
  let selectAllButton = null;
  let clearSelectedButton = null;
  let refreshTorrentsButton = null;
  let refreshButton = null;
  let saveButton = null;
  let statusElement = null;
  let dialogElement = null;
  let dialogPanelElement = null;
  let dialogTriggerButton = null;
  let dialogTitleElement = null;
  let dialogHashElement = null;
  let dialogStatusElement = null;
  let headerCloseButton = null;
  let footerCloseButton = null;

  const setRenameStatus = (message, isError = false) => {
    if (!dialogStatusElement) {
      return;
    }
    dialogStatusElement.textContent = message;
    dialogStatusElement.className = isError ? 'status-message status-error' : 'status-message';
  };

  const setTorrentListStatus = (message, isError = false) => {
    statusElement.textContent = message;
    statusElement.className = isError ? 'status-message status-error' : 'status-message';
  };

  const updateDialogMetadata = () => {
    if (!dialogTitleElement || !dialogHashElement) {
      return;
    }

    dialogTitleElement.textContent = selectedTorrent?.name ?? 'Torrent 文件重命名';
    dialogHashElement.textContent = selectedTorrent?.hash ?? '';
  };

  const getSelectedItems = () => preview.items.filter(item => item.isValid && item.isSelected);

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
      if (dialogElement && selectedTorrent?.hash === torrent.hash) {
        dialogTriggerButton = renameButton;
      }

      details.append(name, hash);
      item.append(details, renameButton);
      return item;
    });
    torrentList.replaceChildren(...items);
  };

  const createOriginalRow = file => {
    const row = documentRef.createElement('tr');
    const selectionCell = documentRef.createElement('td');
    const typeCell = documentRef.createElement('td');
    const nameCell = documentRef.createElement('td');
    const statusCell = documentRef.createElement('td');
    row.className = 'rename-original-row';
    typeCell.className = 'rename-row-type';
    typeCell.textContent = '原始文件';
    nameCell.textContent = file.name;
    statusCell.textContent = '待输入匹配正则';
    row.append(selectionCell, typeCell, nameCell, statusCell);
    return row;
  };

  const createPreviewRow = item => {
    const row = documentRef.createElement('tr');
    const selectionCell = documentRef.createElement('td');
    const typeCell = documentRef.createElement('td');
    const nameCell = documentRef.createElement('td');
    const statusCell = documentRef.createElement('td');
    const checkbox = documentRef.createElement('input');
    row.className = 'rename-preview-row';
    checkbox.className = 'rename-preview-select';
    checkbox.type = 'checkbox';
    checkbox.checked = item.isSelected;
    checkbox.disabled = isSaving || isLoadingFiles || Boolean(fileLoadError) || !item.isValid;
    checkbox.setAttribute('aria-label', `保存 ${item.oldPath}`);
    checkbox.addEventListener('change', () => {
      item.isSelected = item.isValid && checkbox.checked;
      updateControls();
    });
    typeCell.className = 'rename-row-type';
    typeCell.textContent = '替换预览';
    nameCell.textContent = item.newPath;
    statusCell.textContent = item.status;
    selectionCell.append(checkbox);
    row.append(selectionCell, typeCell, nameCell, statusCell);
    return row;
  };

  const renderPreview = () => {
    if (!dialogElement || !previewBody || !selectedTorrent) {
      return;
    }

    const previewItemsByOldPath = new Map(preview.items.map(item => [item.oldPath, item]));
    const rows = files.flatMap((file, position) => {
      const originalRow = createOriginalRow(file);
      if (!preview.items.length) {
        return [originalRow];
      }

      const previewItem = previewItemsByOldPath.get(file.name) ?? preview.items[position];
      return previewItem ? [originalRow, createPreviewRow(previewItem)] : [originalRow];
    });
    previewBody.replaceChildren(...rows);
    updateControls();
  };

  const rebuildPreview = () => {
    if (isLoadingFiles || fileLoadError) {
      renderPreview();
      return;
    }

    preview = buildRenamePreview(files, {
      matchRegex: matchInput.value,
      replaceRegex: replaceInput.value,
      flags: flagsInput.value
    });
    renderPreview();
    if (preview.error) {
      setRenameStatus(`预览失败：${preview.error}`, true);
      return;
    }
    setRenameStatus(selectedTorrent ? `已加载 ${files.length} 个文件` : '请选择 Torrent');
  };

  const loadSelectedTorrentFiles = async () => {
    if (!selectedTorrent) {
      return { isCurrent: false, error: null };
    }

    const requestVersion = ++fileRequestVersion;
    const requestedHash = selectedTorrent.hash;
    isLoadingFiles = true;
    fileLoadError = null;
    renderPreview();
    setRenameStatus('正在加载 Torrent 文件');
    try {
      const serverFiles = await api.requestTorrentFiles(requestedHash);
      if (requestVersion !== fileRequestVersion || requestedHash !== selectedTorrent?.hash) {
        return { isCurrent: false, error: null };
      }
      files = serverFiles;
      isLoadingFiles = false;
      fileLoadError = null;
      rebuildPreview();
      return { isCurrent: true, error: null };
    } catch (error) {
      if (requestVersion !== fileRequestVersion || requestedHash !== selectedTorrent?.hash) {
        return { isCurrent: false, error: null };
      }
      isLoadingFiles = false;
      fileLoadError = error;
      files = [];
      preview = { error: error.message, items: [] };
      renderPreview();
      setRenameStatus(`Torrent 文件加载失败：${error.message}`, true);
      return { isCurrent: true, error };
    }
  };

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
    dialogPanelElement = null;
    dialogTitleElement = null;
    dialogHashElement = null;
    dialogStatusElement = null;
    headerCloseButton = null;
    footerCloseButton = null;
  };

  const closeRenameDialog = () => {
    if (!dialogElement || isSaving) {
      return;
    }

    const returnFocusElement = [dialogTriggerButton, searchInput, refreshTorrentsButton].find(
      element => element?.isConnected && !element.disabled
    );
    fileRequestVersion += 1;
    documentRef.removeEventListener('keydown', handleDialogKeydown);
    dialogElement.remove();
    dialogElement = null;
    dialogTriggerButton = null;
    resetRenameState();
    returnFocusElement?.focus();
  };

  const handleDialogKeydown = event => {
    if (!['Escape', 'Tab'].includes(event.key)) {
      return;
    }
    if (event.defaultPrevented || documentRef.getElementById('app')?.inert) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeRenameDialog();
      return;
    }

    const focusableElements = [
      headerCloseButton,
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
    if (!firstElement) {
      event.preventDefault();
      dialogPanelElement?.focus();
      return;
    }
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
    isLoadingFiles = false;
    fileLoadError = null;
    renderRenameDialog();
    documentRef.addEventListener('keydown', handleDialogKeydown);
    matchInput.focus();
    await loadSelectedTorrentFiles();
  };

  const loadTorrents = async () => {
    const requestVersion = ++torrentRequestVersion;
    isLoadingTorrents = true;
    updateControls();
    renderTorrentList();
    if (dialogElement) {
      renderPreview();
    }
    setTorrentListStatus('正在加载 Torrent');
    try {
      const serverTorrents = await api.requestTorrents();
      if (requestVersion !== torrentRequestVersion) {
        return { isCurrent: false, error: null };
      }
      isLoadingTorrents = false;
      torrents = serverTorrents;
      let didClearSelection = false;
      if (selectedTorrent) {
        const refreshedSelection = torrents.find(torrent => torrent.hash === selectedTorrent.hash);
        if (refreshedSelection) {
          selectedTorrent = refreshedSelection;
          updateDialogMetadata();
        } else {
          selectedTorrent = null;
          files = [];
          preview = { error: '匹配正则不能为空', items: [] };
          fileRequestVersion += 1;
          isLoadingFiles = false;
          fileLoadError = null;
          previewBody?.replaceChildren();
          didClearSelection = true;
        }
      }
      updateControls();
      renderTorrentList();
      if (dialogElement) {
        renderPreview();
      }
      if (didClearSelection) {
        setTorrentListStatus(`已加载 ${torrents.length} 个 Torrent；当前选择已不存在`);
        if (dialogElement) {
          setRenameStatus('当前选择已不存在', true);
        }
      } else {
        setTorrentListStatus(`已加载 ${torrents.length} 个 Torrent`);
      }
      return { isCurrent: true, error: null };
    } catch (error) {
      if (requestVersion !== torrentRequestVersion) {
        return { isCurrent: false, error: null };
      }
      isLoadingTorrents = false;
      updateControls();
      renderTorrentList();
      if (dialogElement) {
        renderPreview();
      }
      setTorrentListStatus(`Torrent 加载失败：${error.message}`, true);
      return { isCurrent: true, error };
    }
  };

  const refreshTorrentList = () => {
    if (isLoadingTorrents || isSaving) {
      return;
    }

    return loadTorrents();
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
    const isCurrentDialog = () => dialogElement && selectedTorrent?.hash === torrentHash;
    let successCount = 0;
    let failedItem = null;
    let saveError = null;
    isSaving = true;
    renderTorrentList();
    renderPreview();
    dialogPanelElement?.focus();
    setRenameStatus('正在保存重命名');

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

      if (!isCurrentDialog()) {
        return;
      }

      const refreshResult = await loadSelectedTorrentFiles();
      if (!isCurrentDialog()) {
        return;
      }

      const refreshFailureMessage = refreshResult.error ? `；刷新失败：${refreshResult.error.message}` : '';
      if (saveError) {
        setRenameStatus(`成功 ${successCount} 项；失败文件：${failedItem.oldPath}；${saveError.message}${refreshFailureMessage}`, true);
      } else {
        setRenameStatus(`成功 ${successCount} 项${refreshFailureMessage}`, Boolean(refreshResult.error));
      }
    } finally {
      isSaving = false;
      renderTorrentList();
      if (isCurrentDialog()) {
        renderPreview();
      }
    }
  };

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

    matchInput = documentRef.createElement('input');
    replaceInput = documentRef.createElement('input');
    flagsInput = documentRef.createElement('input');
    previewBody = documentRef.createElement('tbody');
    selectAllButton = documentRef.createElement('button');
    clearSelectedButton = documentRef.createElement('button');
    refreshButton = documentRef.createElement('button');
    saveButton = documentRef.createElement('button');
    headerCloseButton = documentRef.createElement('button');
    footerCloseButton = documentRef.createElement('button');
    dialogStatusElement = documentRef.createElement('p');

    overlay.className = 'torrent-rename-overlay';
    dialog.id = 'torrent-rename-dialog';
    dialog.className = 'torrent-rename-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'torrent-rename-dialog-title');
    dialog.setAttribute('tabindex', '-1');
    title.id = 'torrent-rename-dialog-title';
    hash.className = 'torrent-dialog-hash';
    editor.className = 'torrent-rename-fields';
    headerCloseButton.id = 'close-rename-dialog';
    headerCloseButton.type = 'button';
    headerCloseButton.textContent = '关闭';
    headerCloseButton.addEventListener('click', closeRenameDialog);
    footerCloseButton.id = 'cancel-rename-dialog';
    footerCloseButton.type = 'button';
    footerCloseButton.textContent = '关闭';
    footerCloseButton.addEventListener('click', closeRenameDialog);
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
    ['保存', '类型', '文件名称', '状态'].forEach(label => {
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
    dialogStatusElement.id = 'rename-status';
    dialogStatusElement.setAttribute('role', 'status');
    dialogStatusElement.setAttribute('aria-live', 'polite');

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

    titleGroup.append(title, hash);
    header.append(titleGroup, headerCloseButton);
    editor.append(matchInput, replaceInput, flagsInput);
    actions.append(selectAllButton, clearSelectedButton, refreshButton, saveButton, footerCloseButton);
    dialog.append(header, editor, previewTable, actions, dialogStatusElement);
    overlay.append(dialog);
    dialogElement = overlay;
    dialogPanelElement = dialog;
    dialogTitleElement = title;
    dialogHashElement = hash;
    updateDialogMetadata();
    root.append(overlay);
    renderPreview();
  };

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
    updateControls();
    renderTorrentList();
    setTorrentListStatus('正在加载 Torrent');
  };

  const initialize = () => {
    if (!initializationPromise) {
      renderTool();
      initializationPromise = loadTorrents();
    }
    return initializationPromise;
  };

  return { initialize, refresh: loadTorrents };
};
