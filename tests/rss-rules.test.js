import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOrdinaryMustContain,
  createEditorState,
  createRssRulesTool,
  createSavePlan,
  executeSavePlan,
  extractKeywords,
  parseKeywordInput
} from '../frontend/rss-rules.js';
import { createFakeDocument, findElements } from './helpers/fake-dom.js';

const createServerRules = () => ({
  HDSWEB: {
    assignedCategory: 'series',
    mustContain: 'H265.*HDSWEB.*(九门)',
    mustNotContain: '(HDR|60fps|HHWEB)'
  },
  HHWEB: {
    assignedCategory: 'series',
    mustContain: 'H265.*HHWEB.*(侠客行|旧剧)',
    mustNotContain: '(HDR|60fps|HDSWEB)'
  },
  'Pure-HDSWEB': {
    assignedCategory: 'series',
    mustContain: 'H265-Pure.HDSWEB',
    mustNotContain: '(HDR|60fps|HHWEB|九门|侠客行|旧剧)'
  }
});

const createToolFixture = ({ requestRules, setRule } = {}) => {
  const { app, document } = createFakeDocument();
  const api = {
    requestRules: requestRules ?? (async () => createServerRules()),
    setRule: setRule ?? (async () => {})
  };
  const tool = createRssRulesTool({ root: app, api, documentRef: document });
  return { app, api, document, tool };
};

const findKeywordInputs = app => findElements(app, element => element.className === 'keyword-tag-input');
const findKeywordTags = app => findElements(app, element => element.className === 'keyword-tag');
const findSaveButton = app => findElements(app, element => element.id === 'save-all-button')[0];
const getTagTexts = app => findKeywordTags(app).map(tag => tag.children[0].textContent);

test('parseKeywordInput 支持多种分隔符并去重', () => {
  assert.deepEqual(parseKeywordInput(' 九门|非份之罪;九门, 少年张三丰\n侠客行 '), ['九门', '非份之罪', '少年张三丰', '侠客行']);
});

test('parseKeywordInput 不拆分中文逗号和顿号', () => {
  assert.deepEqual(parseKeywordInput('九门，非份之罪、少年张三丰'), ['九门，非份之罪、少年张三丰']);
});

test('extractKeywords 提取首个括号内的关键词', () => {
  assert.deepEqual(extractKeywords('H265.*HDSWEB.*(九门|侠客行)'), ['九门', '侠客行']);
});

test('buildOrdinaryMustContain 保留返回前缀并为空关键词补位', () => {
  assert.equal(buildOrdinaryMustContain('H265.*HDSWEB.*(旧关键词)', ['九门']), 'H265.*HDSWEB.*(九门)');
  assert.equal(buildOrdinaryMustContain('H265.*HDSWEB.*(旧关键词)', []), 'H265.*HDSWEB.*(九五三)');
});

test('createEditorState 从 Pure 排除词中扣除普通规则旧关键词', () => {
  const state = createEditorState(createServerRules());
  assert.deepEqual(state.pureFixedKeywords, ['HDR', '60fps', 'HHWEB']);
  assert.deepEqual(state.drafts.HDSWEB, ['九门']);
  assert.deepEqual(state.drafts.HHWEB, ['侠客行', '旧剧']);
});

test('createEditorState 重新读取过渡状态时沿用可信 Pure 固定排除项', () => {
  const originalState = createEditorState(createServerRules());
  const partialServerRules = createServerRules();
  partialServerRules['Pure-HDSWEB'].mustNotContain = '(HDR|60fps|HHWEB|九门|少年张三丰|侠客行|旧剧)';
  const reloadedState = createEditorState(partialServerRules, originalState.pureFixedKeywords);
  assert.deepEqual(reloadedState.pureFixedKeywords, ['HDR', '60fps', 'HHWEB']);
});

test('createSavePlan 混合增删时先扩大 Pure 排除范围再更新普通规则', () => {
  const state = createEditorState(createServerRules());
  state.drafts.HDSWEB = ['九门', '少年张三丰'];
  state.drafts.HHWEB = ['侠客行'];
  const plan = createSavePlan(state);
  assert.deepEqual(
    plan.map(operation => operation.phase),
    ['pure-safety', 'ordinary', 'ordinary', 'pure-final']
  );
  assert.equal(plan[0].ruleDef.mustContain, 'H265-Pure.HDSWEB');
  assert.equal(plan[0].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九门|少年张三丰|侠客行|旧剧)');
  assert.equal(plan[1].ruleName, 'HDSWEB');
  assert.equal(plan[1].ruleDef.mustContain, 'H265.*HDSWEB.*(九门|少年张三丰)');
  assert.equal(plan[1].ruleDef.mustNotContain, '(HDR|60fps|HHWEB)');
  assert.equal(plan[2].ruleName, 'HHWEB');
  assert.equal(plan[2].ruleDef.mustContain, 'H265.*HHWEB.*(侠客行)');
  assert.equal(plan[2].ruleDef.mustNotContain, '(HDR|60fps|HDSWEB)');
  assert.equal(plan[3].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九门|少年张三丰|侠客行)');
});

test('createSavePlan 纯新增时只需先保存最终 Pure 再保存普通规则', () => {
  const state = createEditorState(createServerRules());
  state.drafts.HDSWEB.push('少年张三丰');
  const plan = createSavePlan(state);
  assert.deepEqual(
    plan.map(operation => operation.phase),
    ['pure-safety', 'ordinary']
  );
  assert.equal(plan[0].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九门|少年张三丰|侠客行|旧剧)');
});

test('createSavePlan 纯删除时先更新普通规则再缩小 Pure 排除范围', () => {
  const state = createEditorState(createServerRules());
  state.drafts.HHWEB = ['侠客行'];
  const plan = createSavePlan(state);
  assert.deepEqual(
    plan.map(operation => operation.phase),
    ['ordinary', 'pure-final']
  );
  assert.equal(plan[1].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九门|侠客行)');
});

test('createSavePlan 没有草稿变化时不生成请求', () => {
  assert.deepEqual(createSavePlan(createEditorState(createServerRules())), []);
});

test('createSavePlan 普通规则未变化时仍能修复 Pure 动态排除项', () => {
  const serverRules = createServerRules();
  serverRules.HDSWEB.mustContain = 'H265.*HDSWEB.*(九五三)';
  serverRules['Pure-HDSWEB'].mustNotContain = '(HDR|60fps|HHWEB|侠客行|旧剧)';
  const plan = createSavePlan(createEditorState(serverRules));
  assert.deepEqual(
    plan.map(operation => operation.phase),
    ['pure-final']
  );
  assert.equal(plan[0].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九五三|侠客行|旧剧)');
});

test('createSavePlan 可清理部分失败后残留的 Pure 安全关键词', () => {
  const originalState = createEditorState(createServerRules());
  const partialServerRules = createServerRules();
  partialServerRules['Pure-HDSWEB'].mustNotContain = '(HDR|60fps|HHWEB|九门|少年张三丰|侠客行|旧剧)';
  const plan = createSavePlan(createEditorState(partialServerRules, originalState.pureFixedKeywords));
  assert.deepEqual(
    plan.map(operation => operation.phase),
    ['pure-final']
  );
  assert.equal(plan[0].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九门|侠客行|旧剧)');
});

test('executeSavePlan 严格按顺序保存并在失败时停止', async () => {
  const savedRuleNames = [];
  const operations = [
    { ruleName: 'Pure-HDSWEB', ruleDef: {} },
    { ruleName: 'HDSWEB', ruleDef: {} },
    { ruleName: 'HHWEB', ruleDef: {} }
  ];
  const saveRule = async ruleName => {
    savedRuleNames.push(ruleName);
    if (ruleName === 'HDSWEB') {
      throw new Error('保存失败');
    }
  };
  await assert.rejects(executeSavePlan(operations, saveRule), /保存失败/);
  assert.deepEqual(savedRuleNames, ['Pure-HDSWEB', 'HDSWEB']);
});

test('initialize 渲染关键词标签并支持批量输入', async () => {
  const { app, tool } = createToolFixture();
  await tool.initialize();
  const keywordInputs = findKeywordInputs(app);
  const initialTags = findKeywordTags(app);
  const saveButton = findSaveButton(app);
  assert.equal(keywordInputs.length, 2);
  assert.equal(initialTags.length, 3);
  assert.equal(initialTags[0].children[0].textContent, '九门');
  assert.equal(app.textContent.includes('关键词由其他规则自动维护'), true);
  assert.equal(keywordInputs[0].placeholder, '输入关键词');
  assert.equal(keywordInputs[0].getAttribute('aria-describedby'), 'keyword-help-0');
  assert.equal(findElements(app, element => element.id === 'save-status')[0].getAttribute('role'), 'status');
  assert.equal(saveButton.disabled, true);
  keywordInputs[0].value = '少年张三丰|非份之罪;少年张三丰';
  keywordInputs[0].dispatch('input');
  assert.deepEqual(getTagTexts(app), ['九门', '少年张三丰', '非份之罪', '侠客行', '旧剧']);
  assert.equal(findSaveButton(app).disabled, false);
  assert.equal(app.textContent.includes('有未保存修改'), true);
});

test('标签输入支持 Enter、blur 和空输入 Backspace', async () => {
  const { app, tool } = createToolFixture();
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  const enterEvent = keywordInput.dispatch('keydown', { key: 'Enter' });
  assert.equal(enterEvent.defaultPrevented, true);
  assert.deepEqual(getTagTexts(app).slice(0, 2), ['九门', '少年张三丰']);
  keywordInput.value = '非份之罪';
  keywordInput.dispatch('blur');
  assert.deepEqual(getTagTexts(app).slice(0, 3), ['九门', '少年张三丰', '非份之罪']);
  keywordInput.value = '';
  keywordInput.dispatch('keydown', { key: 'Backspace' });
  assert.deepEqual(getTagTexts(app).slice(0, 2), ['九门', '少年张三丰']);
});

test('创建或删除标签时保留当前输入框焦点', async () => {
  const { app, tool } = createToolFixture();
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.focus();
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('keydown', { key: 'Enter' });
  assert.equal(findKeywordInputs(app)[0], keywordInput);
  assert.equal(keywordInput.isFocused, true);
  keywordInput.dispatch('keydown', { key: 'Backspace' });
  assert.equal(keywordInput.isFocused, true);
});

test('中文输入法组合期间不提交或删除标签', async () => {
  const { app, tool } = createToolFixture();
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  const enterEvent = keywordInput.dispatch('keydown', { key: 'Enter', isComposing: true });
  assert.equal(enterEvent.defaultPrevented, false);
  assert.deepEqual(getTagTexts(app).slice(0, 1), ['九门']);
  keywordInput.dispatch('compositionend');
  assert.equal(findSaveButton(app).disabled, false);
  assert.deepEqual(getTagTexts(app).slice(0, 1), ['九门']);
  keywordInput.value = '少年张三丰,';
  keywordInput.dispatch('input', { isComposing: true });
  assert.deepEqual(getTagTexts(app).slice(0, 1), ['九门']);
  keywordInput.dispatch('compositionend');
  assert.deepEqual(getTagTexts(app).slice(0, 2), ['九门', '少年张三丰']);
});

test('标签删除按钮删除对应关键词并提供 aria-label', async () => {
  const { app, tool } = createToolFixture();
  await tool.initialize();
  const deleteButton = findElements(app, element => element.getAttribute('aria-label') === '删除关键词 九门')[0];
  assert.ok(deleteButton);
  deleteButton.dispatch('click');
  assert.equal(getTagTexts(app).includes('九门'), false);
  assert.equal(findSaveButton(app).disabled, false);
});

test('删除标签时保留并提交输入框中的余留关键词', async () => {
  const { app, tool } = createToolFixture();
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  const deleteButton = findElements(app, element => element.getAttribute('aria-label') === '删除关键词 九门')[0];
  keywordInput.value = '待提交关键词';
  deleteButton.dispatch('mousedown');
  deleteButton.dispatch('click');
  assert.deepEqual(getTagTexts(app).slice(0, 1), ['待提交关键词']);
  assert.equal(findKeywordInputs(app)[0].value, '');
});

test('多行粘贴在浏览器清理换行前创建标签', async () => {
  const { app, tool } = createToolFixture();
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  const pasteEvent = keywordInput.dispatch('paste', {
    clipboardData: { getData: () => '少年张三丰\n非份之罪' }
  });
  assert.equal(pasteEvent.defaultPrevented, true);
  assert.deepEqual(getTagTexts(app).slice(0, 3), ['九门', '少年张三丰', '非份之罪']);
});

test('余留输入会启用保存并在保存前主动提交', async () => {
  const savedOperations = [];
  const { app, tool } = createToolFixture({
    setRule: async (ruleName, ruleDef) => savedOperations.push({ ruleName, ruleDef })
  });
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('input');
  assert.equal(findSaveButton(app).disabled, false);
  await findSaveButton(app).dispatch('click').listenerResult;
  assert.equal(savedOperations[1].ruleName, 'HDSWEB');
  assert.equal(savedOperations[1].ruleDef.mustContain, 'H265.*HDSWEB.*(九门|少年张三丰)');
});

test('blur 提交后不强制抢回输入焦点', async () => {
  const { app, tool } = createToolFixture();
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('blur');
  assert.equal(findKeywordInputs(app)[0].isFocused, false);
});

test('保存期间禁用标签输入框和删除按钮', async () => {
  let releaseSave;
  const pendingSave = new Promise(resolve => {
    releaseSave = resolve;
  });
  const { app, tool } = createToolFixture({ setRule: async () => pendingSave });
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('keydown', { key: 'Enter' });
  const savePromise = findSaveButton(app).dispatch('click').listenerResult;
  assert.equal(findKeywordInputs(app).every(input => input.disabled), true);
  assert.equal(findElements(app, element => element.className === 'keyword-tag-delete').every(button => button.disabled), true);
  releaseSave();
  await savePromise;
});

test('缺少 Pure 规则时禁用保存并显示原因', async () => {
  const serverRules = createServerRules();
  delete serverRules['Pure-HDSWEB'];
  const { app, tool } = createToolFixture({ requestRules: async () => serverRules });
  await tool.initialize();
  assert.equal(findSaveButton(app).disabled, true);
  assert.equal(app.textContent.includes('缺少规则：Pure-HDSWEB'), true);
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('input');
  assert.equal(app.textContent.includes('缺少规则：Pure-HDSWEB'), true);
  assert.equal(findElements(app, element => element.id === 'save-status')[0].className.includes('status-error'), true);
});

test('保存成功后重新读取服务端规则', async () => {
  const savedRuleNames = [];
  let reloadCount = 0;
  const { app, tool } = createToolFixture({
    requestRules: async () => {
      reloadCount += 1;
      return createServerRules();
    },
    setRule: async ruleName => savedRuleNames.push(ruleName)
  });
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('keydown', { key: 'Enter' });
  await findSaveButton(app).dispatch('click').listenerResult;
  assert.deepEqual(savedRuleNames, ['Pure-HDSWEB', 'HDSWEB']);
  assert.equal(reloadCount, 2);
  assert.equal(app.textContent.includes('保存成功'), true);
});

test('保存失败后停止并重新读取服务端状态', async () => {
  const savedRuleNames = [];
  const mutableServerRules = structuredClone(createServerRules());
  let reloadCount = 0;
  const { app, tool } = createToolFixture({
    requestRules: async () => {
      reloadCount += 1;
      return mutableServerRules;
    },
    setRule: async (ruleName, ruleDef) => {
      savedRuleNames.push(ruleName);
      if (ruleName === 'HDSWEB') {
        throw new Error('模拟保存失败');
      }
      mutableServerRules[ruleName] = ruleDef;
    }
  });
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('keydown', { key: 'Enter' });
  await findSaveButton(app).dispatch('click').listenerResult;
  assert.deepEqual(savedRuleNames, ['Pure-HDSWEB', 'HDSWEB']);
  assert.equal(reloadCount, 2);
  assert.equal(app.textContent.includes('保存失败：模拟保存失败'), true);
  assert.equal(findSaveButton(app).disabled, false);
});

test('登录取消后保留草稿且不再次读取规则', async () => {
  let reloadCount = 0;
  const { app, tool } = createToolFixture({
    requestRules: async () => {
      reloadCount += 1;
      return createServerRules();
    },
    setRule: async () => {
      throw new Error('已取消登录');
    }
  });
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('keydown', { key: 'Enter' });
  await findSaveButton(app).dispatch('click').listenerResult;
  assert.equal(reloadCount, 1);
  assert.equal(app.textContent.includes('保存失败：已取消登录'), true);
  assert.deepEqual(getTagTexts(app).slice(0, 2), ['九门', '少年张三丰']);
  assert.equal(findSaveButton(app).disabled, false);
});

test('Pure 最终写入失败后可仅重试 Pure 修复操作', async () => {
  const mutableServerRules = structuredClone(createServerRules());
  const firstAttemptRuleNames = [];
  let shouldFailPure = true;
  const { app, tool } = createToolFixture({
    requestRules: async () => mutableServerRules,
    setRule: async (ruleName, ruleDef) => {
      firstAttemptRuleNames.push(ruleName);
      if (ruleName === 'Pure-HDSWEB' && shouldFailPure) {
        throw new Error('Pure 最终写入失败');
      }
      mutableServerRules[ruleName] = ruleDef;
    }
  });
  await tool.initialize();
  findElements(app, element => element.getAttribute('aria-label') === '删除关键词 旧剧')[0].dispatch('click');
  await findSaveButton(app).dispatch('click').listenerResult;
  assert.deepEqual(firstAttemptRuleNames, ['HHWEB', 'Pure-HDSWEB']);
  assert.equal(findSaveButton(app).disabled, false);
  shouldFailPure = false;
  const previousAttemptCount = firstAttemptRuleNames.length;
  await findSaveButton(app).dispatch('click').listenerResult;
  assert.deepEqual(firstAttemptRuleNames.slice(previousAttemptCount), ['Pure-HDSWEB']);
  assert.equal(app.textContent.includes('保存成功'), true);
});

test('保存和重新读取均失败时显示组合错误', async () => {
  let requestCount = 0;
  const { app, tool } = createToolFixture({
    requestRules: async () => {
      requestCount += 1;
      if (requestCount > 1) {
        throw new Error('读取失败');
      }
      return createServerRules();
    },
    setRule: async () => {
      throw new Error('写入失败');
    }
  });
  await tool.initialize();
  const keywordInput = findKeywordInputs(app)[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('keydown', { key: 'Enter' });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await findSaveButton(app).dispatch('click').listenerResult;
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(app.textContent.includes('保存失败：写入失败；重新读取规则失败'), true);
});

test('refresh 主动重新读取并渲染服务端规则', async () => {
  let requestCount = 0;
  const { app, tool } = createToolFixture({
    requestRules: async () => {
      requestCount += 1;
      const rules = createServerRules();
      if (requestCount === 2) {
        rules.HDSWEB.mustContain = 'H265.*HDSWEB.*(新关键词)';
      }
      return rules;
    }
  });
  await tool.initialize();
  await tool.refresh();
  assert.equal(requestCount, 2);
  assert.equal(getTagTexts(app).includes('新关键词'), true);
});
