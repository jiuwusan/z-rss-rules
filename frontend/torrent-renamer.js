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
