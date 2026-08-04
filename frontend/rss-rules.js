const PURE_RULE_NAME = 'Pure-HDSWEB';
const EMPTY_KEYWORD_PLACEHOLDER = '九五三';
const LOGIN_CANCELLED_MESSAGE = '已取消登录';

/**
 * 清理关键词并按首次出现顺序去重。
 * @param {unknown[]} values 原始关键词
 * @returns {string[]} 清理后的关键词
 */
const uniqueKeywords = values => {
  const seenKeywords = new Set();
  const keywords = [];

  values.forEach(value => {
    const keyword = String(value).trim();
    if (!keyword || seenKeywords.has(keyword)) {
      return;
    }

    seenKeywords.add(keyword);
    keywords.push(keyword);
  });

  return keywords;
};

/**
 * 将输入框内容转换为关键词数组。
 * @param {string} value 输入框内容
 * @returns {string[]} 关键词数组
 */
export const parseKeywordInput = value => uniqueKeywords(String(value).split(/[|;,\n]/));

/**
 * 从规则表达式的首个括号中提取关键词。
 * @param {string} expression 规则表达式
 * @returns {string[]} 关键词数组
 */
export const extractKeywords = expression => {
  const keywordGroup = expression?.match(/\((.*?)\)/)?.[1];
  return keywordGroup ? uniqueKeywords(keywordGroup.split('|')) : [];
};

/**
 * 根据草稿生成普通规则的 mustContain。
 * @param {string} originalMustContain 服务端原值
 * @param {string[]} keywords 草稿关键词
 * @returns {string} 新 mustContain
 */
export const buildOrdinaryMustContain = (originalMustContain, keywords) => {
  const originalExpression = String(originalMustContain ?? '');
  const groupStartIndex = originalExpression.indexOf('(');
  const fixedPrefix = groupStartIndex >= 0 ? originalExpression.slice(0, groupStartIndex) : originalExpression;
  const normalizedKeywords = uniqueKeywords(keywords);
  const effectiveKeywords = normalizedKeywords.length ? normalizedKeywords : [EMPTY_KEYWORD_PLACEHOLDER];
  return `${fixedPrefix}(${effectiveKeywords.join('|')})`;
};

/**
 * 将关键词生成 mustNotContain 表达式。
 * @param {string[]} keywords 排除关键词
 * @returns {string} mustNotContain
 */
const buildMustNotContain = keywords => `(${uniqueKeywords(keywords).join('|')})`;

/**
 * 根据服务端规则建立可编辑状态。
 * @param {Record<string, object>} serverRules 服务端规则
 * @param {string[]} trustedPureFixedKeywords 已确认的 Pure 固定排除项
 * @returns {object} 编辑状态
 */
export const createEditorState = (serverRules, trustedPureFixedKeywords) => {
  const ordinaryRuleNames = Object.keys(serverRules).filter(ruleName => ruleName !== PURE_RULE_NAME);
  const originalKeywords = {};
  const drafts = {};

  ordinaryRuleNames.forEach(ruleName => {
    const keywords = extractKeywords(serverRules[ruleName].mustContain);
    originalKeywords[ruleName] = keywords;
    drafts[ruleName] = [...keywords];
  });

  const oldOrdinaryKeywords = uniqueKeywords(ordinaryRuleNames.flatMap(ruleName => originalKeywords[ruleName]));
  const oldOrdinaryKeywordSet = new Set(oldOrdinaryKeywords);
  const pureRule = serverRules[PURE_RULE_NAME];
  const pureFixedKeywords = Array.isArray(trustedPureFixedKeywords)
    ? uniqueKeywords(trustedPureFixedKeywords)
    : pureRule
      ? extractKeywords(pureRule.mustNotContain).filter(keyword => !oldOrdinaryKeywordSet.has(keyword))
      : [];

  return {
    serverRules,
    ordinaryRuleNames,
    originalKeywords,
    drafts,
    pureFixedKeywords,
    hasPureRule: Boolean(pureRule)
  };
};

/**
 * 将草稿值规范化为保存使用的关键词。
 * @param {string[]|string} draft 草稿值
 * @returns {string[]} 有效关键词
 */
const getEffectiveDraftKeywords = draft => {
  const keywords = Array.isArray(draft) ? uniqueKeywords(draft) : parseKeywordInput(draft);
  return keywords.length ? keywords : [EMPTY_KEYWORD_PLACEHOLDER];
};

/**
 * 判断表达式中的关键词是否与目标集合一致，忽略排列顺序。
 * @param {string} expression 规则表达式
 * @param {string[]} expectedKeywords 目标关键词
 * @returns {boolean} 是否为相同集合
 */
const hasSameKeywordSet = (expression, expectedKeywords) => {
  const actualKeywords = extractKeywords(expression);
  const normalizedExpectedKeywords = uniqueKeywords(expectedKeywords);
  const actualKeywordSet = new Set(actualKeywords);
  return actualKeywords.length === normalizedExpectedKeywords.length && normalizedExpectedKeywords.every(keyword => actualKeywordSet.has(keyword));
};

/**
 * 生成避免重复匹配的分阶段保存计划。
 * @param {object} state 编辑状态
 * @returns {object[]} 保存操作
 */
export const createSavePlan = state => {
  if (!state.hasPureRule) {
    throw new Error(`缺少规则：${PURE_RULE_NAME}`);
  }

  const changedOrdinaryOperations = state.ordinaryRuleNames.flatMap(ruleName => {
    const originalRule = state.serverRules[ruleName];
    const nextMustContain = buildOrdinaryMustContain(originalRule.mustContain, getEffectiveDraftKeywords(state.drafts[ruleName]));

    if (nextMustContain === originalRule.mustContain) {
      return [];
    }

    return [
      {
        phase: 'ordinary',
        ruleName,
        ruleDef: { ...originalRule, mustContain: nextMustContain }
      }
    ];
  });

  const oldOrdinaryKeywords = uniqueKeywords(state.ordinaryRuleNames.flatMap(ruleName => state.originalKeywords[ruleName]));
  const newOrdinaryKeywords = uniqueKeywords(state.ordinaryRuleNames.flatMap(ruleName => getEffectiveDraftKeywords(state.drafts[ruleName])));
  const pureRule = state.serverRules[PURE_RULE_NAME];
  const safetyKeywords = uniqueKeywords([...state.pureFixedKeywords, ...newOrdinaryKeywords, ...oldOrdinaryKeywords]);
  const finalKeywords = uniqueKeywords([...state.pureFixedKeywords, ...newOrdinaryKeywords]);
  const safetyMustNotContain = buildMustNotContain(safetyKeywords);
  const finalMustNotContain = buildMustNotContain(finalKeywords);
  const operations = [];

  if (changedOrdinaryOperations.length && !hasSameKeywordSet(pureRule.mustNotContain, safetyKeywords)) {
    operations.push({
      phase: 'pure-safety',
      ruleName: PURE_RULE_NAME,
      ruleDef: { ...pureRule, mustNotContain: safetyMustNotContain }
    });
  }

  operations.push(...changedOrdinaryOperations);

  const pureMustNotContainBeforeFinal = operations[0]?.phase === 'pure-safety' ? safetyMustNotContain : pureRule.mustNotContain;
  if (!hasSameKeywordSet(pureMustNotContainBeforeFinal, finalKeywords)) {
    operations.push({
      phase: 'pure-final',
      ruleName: PURE_RULE_NAME,
      ruleDef: { ...pureRule, mustNotContain: finalMustNotContain }
    });
  }

  return operations;
};

/**
 * 严格按计划顺序保存规则，任一步失败立即停止。
 * @param {object[]} operations 保存操作
 * @param {(ruleName: string, ruleDef: object) => Promise<void>} saveRule 保存函数
 * @returns {Promise<void>}
 */
export const executeSavePlan = async (operations, saveRule) => {
  for (const operation of operations) {
    await saveRule(operation.ruleName, operation.ruleDef);
  }
};

/**
 * 创建 RSS 规则编辑工具。
 * @param {object} dependencies 外部依赖
 * @param {HTMLElement} dependencies.root 工具根节点
 * @param {{requestRules: Function, setRule: Function}} dependencies.api qBittorrent API
 * @param {Document} dependencies.documentRef 页面文档
 * @returns {{initialize: Function, refresh: Function}} RSS 工具控制器
 */
export const createRssRulesTool = ({ root, api, documentRef = globalThis.document }) => {
  let editorState = null;
  let isEditorBusy = false;
  let renderedKeywordInputs = [];
  let renderedKeywordDeleteButtons = [];
  let keywordInputsByRuleName = {};
  let keywordDeleteButtonsByRuleName = {};
  let keywordTagRenderersByRuleName = {};
  let contentRoot = null;
  let refreshRulesButton = null;
  let saveAllButton = null;
  let statusElement = null;

  const requestRules = () => api.requestRules();
  const setRule = (ruleName, ruleDef) => api.setRule(ruleName, ruleDef);

  /**
   * 判断当前草稿是否产生保存操作。
   * @returns {boolean} 是否存在未保存修改
   */
  const hasUnsavedChanges = () => {
    if (!editorState?.hasPureRule) {
      return false;
    }

    return createSavePlan(editorState).length > 0;
  };

  /**
   * 判断标签输入框中是否存在尚未提交的关键词。
   * @returns {boolean} 是否存在余留输入
   */
  const hasPendingKeywordInput = () => Object.values(keywordInputsByRuleName).some(input => parseKeywordInput(input.value).length > 0);

  /**
   * 更新页面状态文案。
   * @param {string} message 状态文案
   * @param {boolean} isError 是否错误状态
   * @returns {void}
   */
  const setStatus = (message, isError = false) => {
    if (!statusElement) {
      return;
    }

    statusElement.textContent = message;
    statusElement.className = isError ? 'status-message status-error' : 'status-message';
  };

  /**
   * 根据草稿、余留输入和 Pure 规则状态更新编辑提示。
   * @returns {void}
   */
  const updateDraftStatus = () => {
    if (!editorState?.hasPureRule) {
      setStatus(`缺少规则：${PURE_RULE_NAME}`, true);
      return;
    }

    setStatus(hasUnsavedChanges() || hasPendingKeywordInput() ? '有未保存修改' : '没有未保存修改');
  };

  /**
   * 根据当前状态更新输入框和保存按钮。
   * @returns {void}
   */
  const updateEditorControls = () => {
    renderedKeywordInputs.forEach(input => {
      input.disabled = isEditorBusy;
    });
    renderedKeywordDeleteButtons.forEach(button => {
      button.disabled = isEditorBusy;
    });
    if (refreshRulesButton) {
      refreshRulesButton.disabled = isEditorBusy;
    }

    if (!saveAllButton) {
      return;
    }

    saveAllButton.textContent = isEditorBusy ? '保存中' : '保存全部';
    saveAllButton.disabled = isEditorBusy || !editorState?.hasPureRule || (!hasUnsavedChanges() && !hasPendingKeywordInput());
  };

  /**
   * 草稿变化后只刷新对应规则的标签，保留页面控件和焦点顺序。
   * @param {string} ruleName 规则名称
   * @returns {void}
   */
  const refreshAfterDraftChange = ruleName => {
    keywordTagRenderersByRuleName[ruleName]?.();
    updateDraftStatus();
    updateEditorControls();
  };

  /**
   * 向指定规则草稿追加关键词。
   * @param {string} ruleName 规则名称
   * @param {string} inputValue 输入内容
   * @param {boolean} shouldRefresh 是否立即刷新标签
   * @returns {boolean} 草稿是否变化
   */
  const appendDraftKeywords = (ruleName, inputValue, shouldRefresh = true) => {
    const appendedKeywords = parseKeywordInput(inputValue);
    const currentKeywords = editorState.drafts[ruleName];
    const nextKeywords = uniqueKeywords([...currentKeywords, ...appendedKeywords]);
    if (nextKeywords.length === currentKeywords.length) {
      return false;
    }

    editorState.drafts[ruleName] = nextKeywords;
    if (shouldRefresh) {
      refreshAfterDraftChange(ruleName);
    }
    return true;
  };

  /**
   * 提交所有输入框中的余留关键词。
   * @returns {void}
   */
  const commitPendingKeywordInputs = () => {
    const changedRuleNames = [];

    Object.entries(keywordInputsByRuleName).forEach(([ruleName, keywordInput]) => {
      const inputValue = keywordInput.value;
      keywordInput.value = '';
      if (appendDraftKeywords(ruleName, inputValue, false)) {
        changedRuleNames.push(ruleName);
      }
    });

    changedRuleNames.forEach(ruleName => keywordTagRenderersByRuleName[ruleName]?.());
  };

  /**
   * 删除指定规则的关键词。
   * @param {string} ruleName 规则名称
   * @param {string} keyword 关键词
   * @returns {void}
   */
  const removeDraftKeyword = (ruleName, keyword) => {
    editorState.drafts[ruleName] = editorState.drafts[ruleName].filter(item => item !== keyword);
    refreshAfterDraftChange(ruleName);
  };

  /**
   * 创建普通规则的标签输入组件。
   * @param {string} ruleName 规则名称
   * @param {object} state 编辑状态
   * @param {string} helpTextId 帮助文案元素 ID
   * @returns {HTMLElement} 标签输入容器
   */
  const renderKeywordEditor = (ruleName, state, helpTextId) => {
    const editor = documentRef.createElement('div');
    const tagList = documentRef.createElement('span');
    const keywordInput = documentRef.createElement('input');
    editor.className = 'keyword-tag-editor';
    tagList.className = 'keyword-tag-list';

    const renderTags = () => {
      const tags = [];
      const deleteButtons = [];

      state.drafts[ruleName].forEach(keyword => {
        const tag = documentRef.createElement('span');
        const tagText = documentRef.createElement('span');
        const deleteButton = documentRef.createElement('button');
        tag.className = 'keyword-tag';
        tagText.textContent = keyword;
        deleteButton.className = 'keyword-tag-delete';
        deleteButton.type = 'button';
        deleteButton.textContent = '×';
        deleteButton.setAttribute('aria-label', `删除关键词 ${keyword}`);
        deleteButton.addEventListener('mousedown', event => event.preventDefault());
        deleteButton.addEventListener('click', () => {
          const pendingValue = keywordInput.value;
          keywordInput.value = '';
          appendDraftKeywords(ruleName, pendingValue, false);
          removeDraftKeyword(ruleName, keyword);
        });
        deleteButtons.push(deleteButton);
        tag.append(tagText, deleteButton);
        tags.push(tag);
      });

      keywordDeleteButtonsByRuleName[ruleName] = deleteButtons;
      renderedKeywordDeleteButtons = Object.values(keywordDeleteButtonsByRuleName).flat();
      tagList.replaceChildren(...tags);
    };

    const commitInput = () => {
      const inputValue = keywordInput.value;
      keywordInput.value = '';
      if (!appendDraftKeywords(ruleName, inputValue)) {
        updateDraftStatus();
        updateEditorControls();
      }
    };

    keywordInput.className = 'keyword-tag-input';
    keywordInput.type = 'text';
    keywordInput.placeholder = '输入关键词';
    keywordInput.setAttribute('aria-label', `${ruleName} 关键词`);
    keywordInput.setAttribute('aria-describedby', helpTextId);
    keywordInput.addEventListener('input', event => {
      if (event.isComposing) {
        return;
      }

      if (/[|;,\n]/.test(keywordInput.value)) {
        commitInput();
        return;
      }

      updateDraftStatus();
      updateEditorControls();
    });
    keywordInput.addEventListener('paste', event => {
      const pastedText = event.clipboardData?.getData('text') ?? '';
      if (!/[|;,\r\n]/.test(pastedText)) {
        return;
      }

      event.preventDefault();
      const pendingValue = keywordInput.value;
      keywordInput.value = '';
      appendDraftKeywords(ruleName, pendingValue ? `${pendingValue}|${pastedText}` : pastedText);
    });
    keywordInput.addEventListener('keydown', event => {
      if (event.isComposing) {
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        commitInput();
        return;
      }

      if (event.key === 'Backspace' && !keywordInput.value && state.drafts[ruleName].length) {
        event.preventDefault();
        removeDraftKeyword(ruleName, state.drafts[ruleName].at(-1));
      }
    });
    keywordInput.addEventListener('compositionend', () => {
      if (/[|;,\n]/.test(keywordInput.value)) {
        commitInput();
        return;
      }

      updateDraftStatus();
      updateEditorControls();
    });
    keywordInput.addEventListener('blur', commitInput);
    editor.addEventListener('click', () => keywordInput.focus());
    renderedKeywordInputs.push(keywordInput);
    keywordInputsByRuleName[ruleName] = keywordInput;
    keywordTagRenderersByRuleName[ruleName] = renderTags;
    editor.append(tagList, keywordInput);
    renderTags();
    return editor;
  };

  /**
   * 渲染规则关键词编辑器。
   * @param {object} state 编辑状态
   * @returns {void}
   */
  const renderEditor = state => {
    editorState = state;
    renderedKeywordInputs = [];
    renderedKeywordDeleteButtons = [];
    keywordInputsByRuleName = {};
    keywordDeleteButtonsByRuleName = {};
    keywordTagRenderersByRuleName = {};
    const content = documentRef.createElement('div');
    content.className = 'rules-list';

    state.ordinaryRuleNames.forEach((ruleName, ruleIndex) => {
      const card = documentRef.createElement('section');
      const name = documentRef.createElement('h2');
      const helpText = documentRef.createElement('p');
      const helpTextId = `keyword-help-${ruleIndex}`;
      const keywordEditor = renderKeywordEditor(ruleName, state, helpTextId);

      card.className = 'rule-card';
      name.textContent = ruleName;
      helpText.className = 'help-text';
      helpText.id = helpTextId;
      helpText.textContent = '输入 |、;、英文逗号、换行或 Enter 创建标签';
      card.append(name, helpText, keywordEditor);
      content.append(card);
    });

    const pureCard = documentRef.createElement('section');
    const pureName = documentRef.createElement('h2');
    const pureDescription = documentRef.createElement('p');
    pureCard.className = 'rule-card pure-rule-card';
    pureName.textContent = PURE_RULE_NAME;
    pureDescription.textContent = state.hasPureRule ? '关键词由其他规则自动维护，mustContain 保持服务端返回值。' : `缺少规则：${PURE_RULE_NAME}，当前无法保存。`;
    pureCard.append(pureName, pureDescription);
    content.append(pureCard);

    const actions = documentRef.createElement('div');
    statusElement = documentRef.createElement('p');
    saveAllButton = documentRef.createElement('button');
    actions.className = 'actions';
    statusElement.id = 'save-status';
    statusElement.setAttribute('role', 'status');
    statusElement.setAttribute('aria-live', 'polite');
    saveAllButton.id = 'save-all-button';
    saveAllButton.textContent = '保存全部';
    saveAllButton.addEventListener('click', () => saveAll());
    actions.append(statusElement, saveAllButton);

    contentRoot.replaceChildren(content, actions);
    updateDraftStatus();
    updateEditorControls();
  };

  /**
   * 显示加载状态。
   * @returns {void}
   */
  const renderLoading = () => {
    const message = documentRef.createElement('p');
    message.textContent = '正在加载规则';
    contentRoot.replaceChildren(message);
  };

  /**
   * 显示加载失败状态。
   * @param {string} message 错误文案
   * @returns {void}
   */
  const renderLoadError = (message = '规则加载失败') => {
    const errorMessage = documentRef.createElement('p');
    errorMessage.className = 'status-error';
    errorMessage.textContent = message;
    contentRoot.replaceChildren(errorMessage);
  };

  /**
   * 重新读取服务端规则并渲染编辑器。
   * @param {string[]} trustedPureFixedKeywords 已确认的 Pure 固定排除项
   * @returns {Promise<object>} 最新编辑状态
   */
  const loadRules = async trustedPureFixedKeywords => {
    if (!editorState) {
      renderLoading();
    } else {
      setStatus('正在加载规则');
    }
    const serverRules = await requestRules();
    const state = createEditorState(serverRules, trustedPureFixedKeywords);
    renderEditor(state);
    return state;
  };

  const refreshRules = async () => {
    if (isEditorBusy) {
      return;
    }

    isEditorBusy = true;
    updateEditorControls();
    try {
      await loadRules();
    } catch (error) {
      if (editorState) {
        setStatus(`规则加载失败：${error.message}`, true);
      } else {
        renderLoadError();
      }
    } finally {
      isEditorBusy = false;
      updateEditorControls();
    }
  };

  const renderTool = () => {
    const refreshActions = documentRef.createElement('div');
    contentRoot = documentRef.createElement('div');
    refreshRulesButton = documentRef.createElement('button');
    refreshActions.className = 'tool-refresh-actions';
    refreshRulesButton.id = 'refresh-rss-rules';
    refreshRulesButton.type = 'button';
    refreshRulesButton.textContent = '刷新规则';
    refreshRulesButton.addEventListener('click', refreshRules);
    refreshActions.append(refreshRulesButton);
    root.replaceChildren(refreshActions, contentRoot);
  };

  /**
   * 保存全部草稿并重新读取服务端状态。
   * @returns {Promise<void>}
   */
  const saveAll = async () => {
    if (!editorState || isEditorBusy) {
      return;
    }

    commitPendingKeywordInputs();
    let operations;
    try {
      operations = createSavePlan(editorState);
    } catch (error) {
      setStatus(error.message, true);
      updateEditorControls();
      return;
    }

    if (!operations.length) {
      setStatus('没有未保存修改');
      updateEditorControls();
      return;
    }

    isEditorBusy = true;
    const trustedPureFixedKeywords = [...editorState.pureFixedKeywords];
    setStatus('正在保存规则');
    updateEditorControls();

    try {
      await executeSavePlan(operations, setRule);
      await loadRules();
      setStatus('保存成功');
    } catch (error) {
      if (error.message === LOGIN_CANCELLED_MESSAGE) {
        setStatus(`保存失败：${error.message}`, true);
        return;
      }

      try {
        await loadRules(trustedPureFixedKeywords);
        setStatus(`保存失败：${error.message}`, true);
      } catch (reloadError) {
        console.error(reloadError);
        renderLoadError(`保存失败：${error.message}；重新读取规则失败`);
      }
    } finally {
      isEditorBusy = false;
      updateEditorControls();
    }
  };

  /**
   * 初始化工具并处理首次加载错误。
   * @returns {Promise<void>}
   */
  const initialize = async () => {
    renderTool();
    try {
      await refreshRules();
    } catch (error) {
      console.error(error);
      renderLoadError();
    }
  };

  return { initialize, refresh: refreshRules };
};
