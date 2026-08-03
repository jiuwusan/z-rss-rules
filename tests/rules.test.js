const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const RULES_SCRIPT_PATH = path.join(__dirname, '..', 'frontend', 'rules.js');
const RULES_HTML_PATH = path.join(__dirname, '..', 'frontend', 'rules.html');

class FakeElement {
  constructor(tagName, ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.className = '';
    this.id = '';
    this.value = '';
    this.disabled = false;
    this.ownTextContent = '';
    this.eventListeners = {};
    this.attributes = {};
    this.isFocused = false;
  }

  get textContent() {
    return this.ownTextContent + this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this.ownTextContent = String(value);
    this.children = [];
  }

  append(...children) {
    children.forEach(child => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this.children.forEach(child => {
      child.parentElement = null;
      child.isFocused = false;
    });
    this.ownTextContent = '';
    this.children = [...children];
    this.children.forEach(child => {
      child.parentElement = this;
    });
  }

  insertBefore(child, referenceChild) {
    const referenceIndex = this.children.indexOf(referenceChild);
    const insertIndex = referenceIndex >= 0 ? referenceIndex : this.children.length;
    child.parentElement = this;
    this.children.splice(insertIndex, 0, child);
  }

  remove() {
    if (!this.parentElement) {
      return;
    }

    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    this.eventListeners[type] = listener;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  focus() {
    if (this.ownerDocument?.activeElement) {
      this.ownerDocument.activeElement.isFocused = false;
    }
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
    this.isFocused = true;
  }

  dispatch(type, properties = {}) {
    const event = {
      target: this,
      defaultPrevented: false,
      ...properties,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    event.listenerResult = this.eventListeners[type]?.(event);
    return event;
  }
}

const createFakeDocument = () => {
  const document = {
    activeElement: null,
    createElement: tagName => new FakeElement(tagName, document),
    getElementById: id => (id === 'app' ? app : null)
  };
  const body = new FakeElement('body', document);
  const app = new FakeElement('main', document);
  app.id = 'app';
  body.append(app);
  document.body = body;
  return {
    app,
    body,
    document
  };
};

const findElements = (root, predicate) => {
  const matches = predicate(root) ? [root] : [];
  return root.children.reduce((result, child) => result.concat(findElements(child, predicate)), matches);
};

const loadRulesScript = (globals = {}) => {
  const script = fs.existsSync(RULES_SCRIPT_PATH) ? fs.readFileSync(RULES_SCRIPT_PATH, 'utf8') : '';
  const context = vm.createContext({
    console: { error() {}, log() {} },
    URLSearchParams,
    ...globals
  });

  vm.runInContext(
    `${script}\nthis.__rules = {
      parseKeywordInput,
      extractKeywords,
      buildOrdinaryMustContain,
      createEditorState,
      createSavePlan,
      authenticatedFetch: typeof authenticatedFetch === 'undefined' ? undefined : authenticatedFetch,
      requestLogin: typeof requestLogin === 'undefined' ? undefined : requestLogin,
      requestRules: typeof requestRules === 'undefined' ? undefined : requestRules,
      setRule: typeof setRule === 'undefined' ? undefined : setRule,
      executeSavePlan: typeof executeSavePlan === 'undefined' ? undefined : executeSavePlan,
      renderEditor: typeof renderEditor === 'undefined' ? undefined : renderEditor,
      saveAll: typeof saveAll === 'undefined' ? undefined : saveAll,
      loadRules: typeof loadRules === 'undefined' ? undefined : loadRules
    };`,
    context
  );

  return { context, rules: context.__rules };
};

const waitForCondition = async predicate => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }

  assert.fail('等待条件未满足');
};

const findLoginElements = body => ({
  overlay: findElements(body, element => element.className === 'login-overlay')[0],
  form: findElements(body, element => element.className === 'login-form')[0],
  usernameInput: findElements(body, element => element.id === 'login-username')[0],
  passwordInput: findElements(body, element => element.id === 'login-password')[0],
  errorElement: findElements(body, element => element.className === 'login-error')[0],
  submitButton: findElements(body, element => element.id === 'login-submit-button')[0],
  cancelButton: findElements(body, element => element.id === 'login-cancel-button')[0]
});

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

test('parseKeywordInput 支持多种分隔符并去重', () => {
  const { rules } = loadRulesScript();

  const keywords = rules.parseKeywordInput(' 九门|非份之罪;九门, 少年张三丰\n侠客行 ');

  assert.deepEqual(Array.from(keywords), ['九门', '非份之罪', '少年张三丰', '侠客行']);
});

test('parseKeywordInput 不拆分中文逗号和顿号', () => {
  const { rules } = loadRulesScript();

  const keywords = rules.parseKeywordInput('九门，非份之罪、少年张三丰');

  assert.deepEqual(Array.from(keywords), ['九门，非份之罪、少年张三丰']);
});

test('buildOrdinaryMustContain 保留返回前缀并为空关键词补位', () => {
  const { rules } = loadRulesScript();

  assert.equal(rules.buildOrdinaryMustContain('H265.*HDSWEB.*(旧关键词)', ['九门']), 'H265.*HDSWEB.*(九门)');
  assert.equal(rules.buildOrdinaryMustContain('H265.*HDSWEB.*(旧关键词)', []), 'H265.*HDSWEB.*(九五三)');
});

test('createEditorState 从 Pure 排除词中扣除普通规则旧关键词', () => {
  const { rules } = loadRulesScript();

  const state = rules.createEditorState(createServerRules());

  assert.deepEqual(Array.from(state.pureFixedKeywords), ['HDR', '60fps', 'HHWEB']);
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门']);
  assert.deepEqual(Array.from(state.drafts.HHWEB), ['侠客行', '旧剧']);
});

test('createEditorState 重新读取过渡状态时沿用可信 Pure 固定排除项', () => {
  const { rules } = loadRulesScript();
  const originalState = rules.createEditorState(createServerRules());
  const partialServerRules = createServerRules();
  partialServerRules['Pure-HDSWEB'].mustNotContain = '(HDR|60fps|HHWEB|九门|少年张三丰|侠客行|旧剧)';

  const reloadedState = rules.createEditorState(partialServerRules, originalState.pureFixedKeywords);

  assert.deepEqual(Array.from(reloadedState.pureFixedKeywords), ['HDR', '60fps', 'HHWEB']);
});

test('createSavePlan 混合增删时先扩大 Pure 排除范围再更新普通规则', () => {
  const { rules } = loadRulesScript();
  const state = rules.createEditorState(createServerRules());
  state.drafts.HDSWEB = ['九门', '少年张三丰'];
  state.drafts.HHWEB = ['侠客行'];

  const plan = rules.createSavePlan(state);

  assert.deepEqual(
    Array.from(plan, operation => operation.phase),
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
  const { rules } = loadRulesScript();
  const state = rules.createEditorState(createServerRules());
  state.drafts.HDSWEB.push('少年张三丰');

  const plan = rules.createSavePlan(state);

  assert.deepEqual(
    Array.from(plan, operation => operation.phase),
    ['pure-safety', 'ordinary']
  );
  assert.equal(plan[0].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九门|少年张三丰|侠客行|旧剧)');
});

test('createSavePlan 纯删除时先更新普通规则再缩小 Pure 排除范围', () => {
  const { rules } = loadRulesScript();
  const state = rules.createEditorState(createServerRules());
  state.drafts.HHWEB = ['侠客行'];

  const plan = rules.createSavePlan(state);

  assert.deepEqual(
    Array.from(plan, operation => operation.phase),
    ['ordinary', 'pure-final']
  );
  assert.equal(plan[1].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九门|侠客行)');
});

test('createSavePlan 没有草稿变化时不生成请求', () => {
  const { rules } = loadRulesScript();
  const state = rules.createEditorState(createServerRules());

  assert.deepEqual(Array.from(rules.createSavePlan(state)), []);
});

test('createSavePlan 普通规则未变化时仍能修复 Pure 动态排除项', () => {
  const { rules } = loadRulesScript();
  const serverRules = createServerRules();
  serverRules.HDSWEB.mustContain = 'H265.*HDSWEB.*(九五三)';
  serverRules['Pure-HDSWEB'].mustNotContain = '(HDR|60fps|HHWEB|侠客行|旧剧)';
  const state = rules.createEditorState(serverRules);

  const plan = rules.createSavePlan(state);

  assert.deepEqual(
    Array.from(plan, operation => operation.phase),
    ['pure-final']
  );
  assert.equal(plan[0].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九五三|侠客行|旧剧)');
});

test('createSavePlan 可清理部分失败后残留的 Pure 安全关键词', () => {
  const { rules } = loadRulesScript();
  const originalState = rules.createEditorState(createServerRules());
  const partialServerRules = createServerRules();
  partialServerRules['Pure-HDSWEB'].mustNotContain = '(HDR|60fps|HHWEB|九门|少年张三丰|侠客行|旧剧)';
  const reloadedState = rules.createEditorState(partialServerRules, originalState.pureFixedKeywords);

  const plan = rules.createSavePlan(reloadedState);

  assert.deepEqual(
    Array.from(plan, operation => operation.phase),
    ['pure-final']
  );
  assert.equal(plan[0].ruleDef.mustNotContain, '(HDR|60fps|HHWEB|九门|侠客行|旧剧)');
});

test('authenticatedFetch 非 403 时直接返回且不显示登录弹窗', async () => {
  const { body, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const fetchImpl = async () => ({ ok: true, status: 200 });

  const response = await rules.authenticatedFetch('/api/v2/rss/rules', { credentials: 'include' }, fetchImpl);

  assert.equal(response.status, 200);
  assert.equal(findElements(body, element => element.className === 'login-overlay').length, 0);
});

test('登录和标签输入框渲染 placeholder', async () => {
  const { app, body, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const fetchImpl = async () => ({ ok: false, status: 403 });

  rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  const { usernameInput, passwordInput } = findLoginElements(body);

  rules.renderEditor(rules.createEditorState(createServerRules()));
  const keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];

  assert.equal(usernameInput.placeholder, '请输入用户名');
  assert.equal(passwordInput.placeholder, '请输入密码');
  assert.equal(keywordInput.placeholder, '输入关键词');
});

test('authenticatedFetch 遇到 403 后登录并重试原请求', async () => {
  const { app, body, document } = createFakeDocument();
  const requests = [];
  let ruleRequestCount = 0;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/v2/auth/login') {
      return { ok: true, status: 200 };
    }

    ruleRequestCount += 1;
    return ruleRequestCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200 };
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const responsePromise = rules.authenticatedFetch('/api/v2/rss/rules', { credentials: 'include' }, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  const { form, usernameInput, passwordInput, overlay } = findLoginElements(body);
  assert.equal(app.inert, true);
  usernameInput.value = 'tester';
  passwordInput.value = 'secret';
  await form.dispatch('submit').listenerResult;

  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(requests[1].url, '/api/v2/auth/login');
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(requests[1].options.credentials, 'include');
  assert.equal(requests[1].options.body.get('username'), 'tester');
  assert.equal(requests[1].options.body.get('password'), 'secret');
  assert.equal(ruleRequestCount, 2);
  assert.equal(overlay.hidden, true);
  assert.equal(app.inert, false);
  assert.equal(passwordInput.value, '');
});

test('登录请求以普通函数方式调用 Fetch 实现', async () => {
  const { body, document } = createFakeDocument();
  const requests = [];
  let ruleRequestCount = 0;
  function fetchImpl(url, options = {}) {
    if (this?.fetchImpl === fetchImpl) {
      throw new TypeError('Illegal invocation');
    }

    requests.push({ url, options });
    if (url === '/api/v2/auth/login') {
      return Promise.resolve({ ok: true, status: 200 });
    }

    ruleRequestCount += 1;
    const response = ruleRequestCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200 };
    return Promise.resolve(response);
  }
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const responsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  const { form, usernameInput, passwordInput } = findLoginElements(body);
  usernameInput.value = 'tester';
  passwordInput.value = 'secret';
  await form.dispatch('submit').listenerResult;

  assert.deepEqual(
    requests.map(request => request.url),
    ['/api/v2/rss/rules', '/api/v2/auth/login', '/api/v2/rss/rules']
  );
  assert.equal((await responsePromise).status, 200);
});

test('登录失败时保留弹窗并允许再次提交', async () => {
  const { body, document } = createFakeDocument();
  let loginRequestCount = 0;
  let ruleRequestCount = 0;
  const fetchImpl = async url => {
    if (url === '/api/v2/auth/login') {
      loginRequestCount += 1;
      return loginRequestCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200 };
    }

    ruleRequestCount += 1;
    return ruleRequestCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200 };
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const responsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  const { form, usernameInput, passwordInput, errorElement, overlay } = findLoginElements(body);
  usernameInput.value = 'tester';
  passwordInput.value = 'wrong';
  await form.dispatch('submit').listenerResult;

  assert.equal(overlay.hidden, false);
  assert.equal(errorElement.textContent, '用户名或密码错误，请重试');
  assert.equal(passwordInput.value, '');
  assert.equal(passwordInput.isFocused, true);

  passwordInput.value = 'secret';
  await form.dispatch('submit').listenerResult;
  assert.equal((await responsePromise).status, 200);
  assert.equal(loginRequestCount, 2);
});

test('登录请求期间禁用凭据输入和操作按钮', async () => {
  const { body, document } = createFakeDocument();
  let ruleRequestCount = 0;
  let resolveLoginRequest;
  const loginResponsePromise = new Promise(resolve => {
    resolveLoginRequest = resolve;
  });
  const fetchImpl = async url => {
    if (url === '/api/v2/auth/login') {
      return loginResponsePromise;
    }

    ruleRequestCount += 1;
    return ruleRequestCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200 };
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const responsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  const { form, usernameInput, passwordInput, submitButton, cancelButton } = findLoginElements(body);
  usernameInput.value = 'tester';
  passwordInput.value = 'secret';
  const submitPromise = form.dispatch('submit').listenerResult;

  assert.equal(usernameInput.disabled, true);
  assert.equal(passwordInput.disabled, true);
  assert.equal(submitButton.disabled, true);
  assert.equal(cancelButton.disabled, true);
  assert.equal(submitButton.textContent, '登录中');

  resolveLoginRequest({ ok: true, status: 200 });
  await submitPromise;
  assert.equal((await responsePromise).status, 200);
});

test('登录后重试仍为 403 时不自动循环并显示凭据错误', async () => {
  const { body, document } = createFakeDocument();
  let loginRequestCount = 0;
  let ruleRequestCount = 0;
  const fetchImpl = async url => {
    if (url === '/api/v2/auth/login') {
      loginRequestCount += 1;
      return { ok: true, status: 200 };
    }

    ruleRequestCount += 1;
    return ruleRequestCount < 3 ? { ok: false, status: 403 } : { ok: true, status: 200 };
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const responsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  let loginElements = findLoginElements(body);
  loginElements.usernameInput.value = 'tester';
  loginElements.passwordInput.value = 'wrong';
  await loginElements.form.dispatch('submit').listenerResult;
  await waitForCondition(() => findLoginElements(body).errorElement.textContent.includes('用户名或密码错误'));

  assert.equal(loginRequestCount, 1);
  assert.equal(ruleRequestCount, 2);
  loginElements = findLoginElements(body);
  loginElements.passwordInput.value = 'secret';
  await loginElements.form.dispatch('submit').listenerResult;

  assert.equal((await responsePromise).status, 200);
  assert.equal(loginRequestCount, 2);
  assert.equal(ruleRequestCount, 3);
});

test('并发 403 共用一次登录尝试', async () => {
  const { body, document } = createFakeDocument();
  let loginRequestCount = 0;
  let ruleRequestCount = 0;
  const fetchImpl = async url => {
    if (url === '/api/v2/auth/login') {
      loginRequestCount += 1;
      return { ok: true, status: 200 };
    }

    ruleRequestCount += 1;
    return ruleRequestCount <= 2 ? { ok: false, status: 403 } : { ok: true, status: 200 };
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const firstResponsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  const secondResponsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  const { form, usernameInput, passwordInput } = findLoginElements(body);
  usernameInput.value = 'tester';
  passwordInput.value = 'secret';
  await form.dispatch('submit').listenerResult;

  const responses = await Promise.all([firstResponsePromise, secondResponsePromise]);
  assert.deepEqual(
    responses.map(response => response.status),
    [200, 200]
  );
  assert.equal(loginRequestCount, 1);
  assert.equal(findElements(body, element => element.className === 'login-overlay').length, 1);
});

test('登录期间发出的旧请求延迟返回 403 时静默重试', async () => {
  const { body, document } = createFakeDocument();
  let loginRequestCount = 0;
  let ruleRequestCount = 0;
  let resolveDelayedResponse;
  const delayedResponse = new Promise(resolve => {
    resolveDelayedResponse = resolve;
  });
  const fetchImpl = async url => {
    if (url === '/api/v2/auth/login') {
      loginRequestCount += 1;
      return { ok: true, status: 200 };
    }

    ruleRequestCount += 1;
    if (ruleRequestCount === 1) {
      return { ok: false, status: 403 };
    }
    if (ruleRequestCount === 2) {
      return delayedResponse;
    }
    return { ok: true, status: 200 };
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const firstResponsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  const delayedRequestPromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  const { form, usernameInput, passwordInput } = findLoginElements(body);
  usernameInput.value = 'tester';
  passwordInput.value = 'secret';
  await form.dispatch('submit').listenerResult;
  assert.equal((await firstResponsePromise).status, 200);

  resolveDelayedResponse({ ok: false, status: 403 });
  await waitForCondition(() => ruleRequestCount === 4);
  assert.equal((await delayedRequestPromise).status, 200);
  assert.equal(loginRequestCount, 1);
  assert.equal(findLoginElements(body).overlay.hidden, true);
});

test('并发重试部分成功时不关闭另一请求的登录弹窗', async () => {
  const { body, document } = createFakeDocument();
  let ruleRequestCount = 0;
  let resolveDelayedSuccess;
  const delayedSuccess = new Promise(resolve => {
    resolveDelayedSuccess = resolve;
  });
  const fetchImpl = async url => {
    if (url === '/api/v2/auth/login') {
      return { ok: true, status: 200 };
    }

    ruleRequestCount += 1;
    if (ruleRequestCount <= 2) {
      return { ok: false, status: 403 };
    }
    if (ruleRequestCount === 3) {
      return delayedSuccess;
    }
    if (ruleRequestCount === 4) {
      return { ok: false, status: 403 };
    }
    return { ok: true, status: 200 };
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const firstResponsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  const secondResponsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  let loginElements = findLoginElements(body);
  loginElements.usernameInput.value = 'tester';
  loginElements.passwordInput.value = 'first';
  await loginElements.form.dispatch('submit').listenerResult;
  await waitForCondition(() => findLoginElements(body).errorElement.textContent.includes('用户名或密码错误'));

  resolveDelayedSuccess({ ok: true, status: 200 });
  assert.equal((await firstResponsePromise).status, 200);
  assert.equal(findLoginElements(body).overlay.hidden, false);

  loginElements = findLoginElements(body);
  loginElements.passwordInput.value = 'second';
  await loginElements.form.dispatch('submit').listenerResult;
  assert.equal((await secondResponsePromise).status, 200);
  assert.equal(findLoginElements(body).overlay.hidden, true);
});

test('取消第二轮登录后同批迟到 403 不重新打开弹窗', async () => {
  const { body, document } = createFakeDocument();
  let ruleRequestCount = 0;
  let resolveDelayedUnauthorized;
  const delayedUnauthorized = new Promise(resolve => {
    resolveDelayedUnauthorized = resolve;
  });
  const fetchImpl = async url => {
    if (url === '/api/v2/auth/login') {
      return { ok: true, status: 200 };
    }

    ruleRequestCount += 1;
    if (ruleRequestCount <= 2) {
      return { ok: false, status: 403 };
    }
    if (ruleRequestCount === 3) {
      return { ok: false, status: 403 };
    }
    return delayedUnauthorized;
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const firstResponsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  const secondResponsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  let loginElements = findLoginElements(body);
  loginElements.usernameInput.value = 'tester';
  loginElements.passwordInput.value = 'first';
  await loginElements.form.dispatch('submit').listenerResult;
  await waitForCondition(() => findLoginElements(body).errorElement.textContent.includes('用户名或密码错误'));

  loginElements = findLoginElements(body);
  loginElements.cancelButton.dispatch('click');
  await assert.rejects(firstResponsePromise, /已取消登录/);
  assert.equal(loginElements.overlay.hidden, true);

  resolveDelayedUnauthorized({ ok: false, status: 403 });
  await assert.rejects(secondResponsePromise, /已取消登录/);
  assert.equal(findLoginElements(body).overlay.hidden, true);
});

test('取消登录后等待请求失败并关闭弹窗', async () => {
  const { body, document } = createFakeDocument();
  const fetchImpl = async () => ({ ok: false, status: 403 });
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const responsePromise = rules.authenticatedFetch('/api/v2/rss/rules', {}, fetchImpl);
  await waitForCondition(() => findLoginElements(body).cancelButton);
  const { cancelButton, overlay, passwordInput } = findLoginElements(body);
  passwordInput.value = 'secret';
  cancelButton.dispatch('click');

  await assert.rejects(responsePromise, /已取消登录/);
  assert.equal(overlay.hidden, true);
  assert.equal(passwordInput.value, '');
});

test('requestRules 使用凭据读取 RSS 规则', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => createServerRules() };
  };
  const { rules } = loadRulesScript();

  const result = await rules.requestRules(fetchImpl);

  assert.equal(requests[0].url, '/api/v2/rss/rules');
  assert.equal(requests[0].options.credentials, 'include');
  assert.equal(result.HDSWEB.mustContain, 'H265.*HDSWEB.*(九门)');
});

test('requestRules 返回 403 时登录后重新读取规则', async () => {
  const { body, document } = createFakeDocument();
  const requests = [];
  let ruleRequestCount = 0;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/v2/auth/login') {
      return { ok: true, status: 200 };
    }

    ruleRequestCount += 1;
    return ruleRequestCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200, json: async () => createServerRules() };
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });

  const rulesPromise = rules.requestRules(fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  const { form, usernameInput, passwordInput } = findLoginElements(body);
  usernameInput.value = 'tester';
  passwordInput.value = 'secret';
  await form.dispatch('submit').listenerResult;

  const result = await rulesPromise;
  assert.equal(result.HDSWEB.mustContain, 'H265.*HDSWEB.*(九门)');
  assert.deepEqual(
    requests.map(request => request.url),
    ['/api/v2/rss/rules', '/api/v2/auth/login', '/api/v2/rss/rules']
  );
  assert.equal(requests[0].options.credentials, 'include');
  assert.equal(requests[2].options.credentials, 'include');
});

test('setRule 以 URL 编码表单提交完整规则定义', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return { ok: true };
  };
  const { rules } = loadRulesScript();
  const ruleDef = {
    mustContain: 'H265.*HDSWEB.*(九门)',
    mustNotContain: '(HDR|60fps|HHWEB)'
  };

  await rules.setRule('HDSWEB', ruleDef, fetchImpl);

  assert.equal(requests[0].url, '/api/v2/rss/setRule');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.credentials, 'include');
  assert.equal(requests[0].options.body.get('ruleName'), 'HDSWEB');
  assert.deepEqual(JSON.parse(requests[0].options.body.get('ruleDef')), ruleDef);
  assert.equal(Object.hasOwn(JSON.parse(requests[0].options.body.get('ruleDef')), 'name'), false);
});

test('setRule 返回 403 时登录后按原表单重新保存', async () => {
  const { body, document } = createFakeDocument();
  const requests = [];
  let saveRequestCount = 0;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/v2/auth/login') {
      return { ok: true, status: 200 };
    }

    saveRequestCount += 1;
    return saveRequestCount === 1 ? { ok: false, status: 403 } : { ok: true, status: 200 };
  };
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const ruleDef = {
    mustContain: 'H265.*HDSWEB.*(九门)',
    mustNotContain: '(HDR|60fps|HHWEB)'
  };

  const savePromise = rules.setRule('HDSWEB', ruleDef, fetchImpl);
  await waitForCondition(() => findLoginElements(body).form);
  const { form, usernameInput, passwordInput } = findLoginElements(body);
  usernameInput.value = 'tester';
  passwordInput.value = 'secret';
  await form.dispatch('submit').listenerResult;
  await savePromise;

  assert.deepEqual(
    requests.map(request => request.url),
    ['/api/v2/rss/setRule', '/api/v2/auth/login', '/api/v2/rss/setRule']
  );
  assert.equal(requests[0].options.method, requests[2].options.method);
  assert.equal(requests[0].options.credentials, requests[2].options.credentials);
  assert.equal(requests[0].options.body.toString(), requests[2].options.body.toString());
});

test('executeSavePlan 严格按顺序保存并在失败时停止', async () => {
  const { rules } = loadRulesScript();
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

  await assert.rejects(rules.executeSavePlan(operations, saveRule), /保存失败/);
  assert.deepEqual(savedRuleNames, ['Pure-HDSWEB', 'HDSWEB']);
});

test('renderEditor 渲染关键词标签并支持批量输入', () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({
    document,
    fetch: () => new Promise(() => {})
  });
  const state = rules.createEditorState(createServerRules());

  rules.renderEditor(state);

  const keywordInputs = findElements(app, element => element.className === 'keyword-tag-input');
  const initialTags = findElements(app, element => element.className === 'keyword-tag');
  const saveButton = findElements(app, element => element.id === 'save-all-button')[0];
  assert.equal(keywordInputs.length, 2);
  assert.equal(initialTags.length, 3);
  assert.equal(initialTags[0].children[0].textContent, '九门');
  assert.equal(app.textContent.includes('关键词由其他规则自动维护'), true);
  assert.equal(keywordInputs[0].getAttribute('aria-describedby'), 'keyword-help-0');
  assert.equal(findElements(app, element => element.id === 'save-status')[0].getAttribute('role'), 'status');
  assert.equal(saveButton.disabled, true);

  keywordInputs[0].value = '少年张三丰|非份之罪;少年张三丰';
  keywordInputs[0].dispatch('input');

  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门', '少年张三丰', '非份之罪']);
  const currentSaveButton = findElements(app, element => element.id === 'save-all-button')[0];
  assert.equal(currentSaveButton.disabled, false);
  assert.equal(app.textContent.includes('有未保存修改'), true);
});

test('标签输入支持 Enter、blur 和空输入 Backspace', () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  rules.renderEditor(state);

  let keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  keywordInput.value = '少年张三丰';
  const enterEvent = keywordInput.dispatch('keydown', { key: 'Enter' });
  assert.equal(enterEvent.defaultPrevented, true);
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门', '少年张三丰']);

  keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  keywordInput.value = '非份之罪';
  keywordInput.dispatch('blur');
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门', '少年张三丰', '非份之罪']);

  keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  keywordInput.value = '';
  keywordInput.dispatch('keydown', { key: 'Backspace' });
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门', '少年张三丰']);
});

test('创建或删除标签时保留当前输入框焦点', () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  rules.renderEditor(state);

  const keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  keywordInput.focus();
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('keydown', { key: 'Enter' });

  assert.equal(findElements(app, element => element.className === 'keyword-tag-input')[0], keywordInput);
  assert.equal(keywordInput.isFocused, true);

  keywordInput.dispatch('keydown', { key: 'Backspace' });
  assert.equal(keywordInput.isFocused, true);
});

test('中文输入法组合期间不提交或删除标签', () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  rules.renderEditor(state);

  const keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  keywordInput.value = '少年张三丰';
  const enterEvent = keywordInput.dispatch('keydown', { key: 'Enter', isComposing: true });
  assert.equal(enterEvent.defaultPrevented, false);
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门']);

  keywordInput.dispatch('compositionend');
  assert.equal(findElements(app, element => element.id === 'save-all-button')[0].disabled, false);
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门']);

  keywordInput.value = '少年张三丰,';
  keywordInput.dispatch('input', { isComposing: true });
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门']);

  keywordInput.dispatch('compositionend');
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门', '少年张三丰']);
});

test('标签删除按钮删除对应关键词并提供 aria-label', () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  rules.renderEditor(state);

  const deleteButton = findElements(app, element => element.getAttribute('aria-label') === '删除关键词 九门')[0];
  assert.ok(deleteButton);
  deleteButton.dispatch('click');

  assert.deepEqual(Array.from(state.drafts.HDSWEB), []);
  assert.equal(findElements(app, element => element.id === 'save-all-button')[0].disabled, false);
});

test('删除标签时保留并提交输入框中的余留关键词', () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  rules.renderEditor(state);

  const keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  const deleteButton = findElements(app, element => element.getAttribute('aria-label') === '删除关键词 九门')[0];
  keywordInput.value = '待提交关键词';
  deleteButton.dispatch('mousedown');
  deleteButton.dispatch('click');

  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['待提交关键词']);
  assert.equal(findElements(app, element => element.className === 'keyword-tag-input')[0].value, '');
});

test('多行粘贴在浏览器清理换行前创建标签', () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  rules.renderEditor(state);

  const keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  const pasteEvent = keywordInput.dispatch('paste', {
    clipboardData: { getData: () => '少年张三丰\n非份之罪' }
  });

  assert.equal(pasteEvent.defaultPrevented, true);
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门', '少年张三丰', '非份之罪']);
});

test('余留输入会启用保存并在保存前主动提交', async () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  rules.renderEditor(state);
  const keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('input');

  assert.equal(findElements(app, element => element.id === 'save-all-button')[0].disabled, false);

  const savedOperations = [];
  await rules.saveAll({
    saveRule: async (ruleName, ruleDef) => savedOperations.push({ ruleName, ruleDef }),
    requestRulesImpl: async () => createServerRules()
  });

  assert.equal(savedOperations[1].ruleName, 'HDSWEB');
  assert.equal(savedOperations[1].ruleDef.mustContain, 'H265.*HDSWEB.*(九门|少年张三丰)');
});

test('blur 提交后不强制抢回输入焦点', () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  rules.renderEditor(state);

  const keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('blur');

  const currentKeywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  assert.equal(currentKeywordInput.isFocused, false);
});

test('保存期间禁用标签输入框和删除按钮', async () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  state.drafts.HDSWEB = ['九门', '少年张三丰'];
  rules.renderEditor(state);
  let releaseSave;
  const pendingSave = new Promise(resolve => {
    releaseSave = resolve;
  });

  const savePromise = rules.saveAll({
    saveRule: async () => pendingSave,
    requestRulesImpl: async () => createServerRules()
  });

  const keywordInputs = findElements(app, element => element.className === 'keyword-tag-input');
  const deleteButtons = findElements(app, element => element.className === 'keyword-tag-delete');
  assert.equal(
    keywordInputs.every(input => input.disabled),
    true
  );
  assert.equal(
    deleteButtons.every(button => button.disabled),
    true
  );

  releaseSave();
  await savePromise;
});

test('renderEditor 缺少 Pure 规则时禁用保存并显示原因', () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const serverRules = createServerRules();
  delete serverRules['Pure-HDSWEB'];

  rules.renderEditor(rules.createEditorState(serverRules));

  const saveButton = findElements(app, element => element.id === 'save-all-button')[0];
  assert.equal(saveButton.disabled, true);
  assert.equal(app.textContent.includes('缺少规则：Pure-HDSWEB'), true);

  const keywordInput = findElements(app, element => element.className === 'keyword-tag-input')[0];
  keywordInput.value = '少年张三丰';
  keywordInput.dispatch('input');

  assert.equal(app.textContent.includes('缺少规则：Pure-HDSWEB'), true);
  assert.equal(findElements(app, element => element.id === 'save-status')[0].className.includes('status-error'), true);
});

test('saveAll 按计划保存成功后重新读取服务端规则', async () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  state.drafts.HDSWEB = ['九门', '少年张三丰'];
  rules.renderEditor(state);
  const savedRuleNames = [];
  let reloadCount = 0;

  await rules.saveAll({
    saveRule: async ruleName => savedRuleNames.push(ruleName),
    requestRulesImpl: async () => {
      reloadCount += 1;
      return createServerRules();
    }
  });

  assert.deepEqual(savedRuleNames, ['Pure-HDSWEB', 'HDSWEB']);
  assert.equal(reloadCount, 1);
  assert.equal(app.textContent.includes('保存成功'), true);
});

test('saveAll 保存失败后停止并重新读取服务端状态', async () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  state.drafts.HDSWEB = ['九门', '少年张三丰'];
  rules.renderEditor(state);
  const savedRuleNames = [];
  const mutableServerRules = JSON.parse(JSON.stringify(createServerRules()));
  let reloadCount = 0;

  await rules.saveAll({
    saveRule: async (ruleName, ruleDef) => {
      savedRuleNames.push(ruleName);
      if (ruleName === 'HDSWEB') {
        throw new Error('模拟保存失败');
      }
      mutableServerRules[ruleName] = ruleDef;
    },
    requestRulesImpl: async () => {
      reloadCount += 1;
      return mutableServerRules;
    }
  });

  const saveButton = findElements(app, element => element.id === 'save-all-button')[0];
  assert.deepEqual(savedRuleNames, ['Pure-HDSWEB', 'HDSWEB']);
  assert.equal(reloadCount, 1);
  assert.equal(app.textContent.includes('保存失败：模拟保存失败'), true);
  assert.equal(saveButton.disabled, false);
});

test('saveAll 登录取消后保留草稿且不再次读取规则', async () => {
  const { app, body, document } = createFakeDocument();
  const fetchImpl = async () => ({ ok: false, status: 403 });
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  state.drafts.HDSWEB = ['九门', '少年张三丰'];
  rules.renderEditor(state);
  let reloadCount = 0;

  const savePromise = rules.saveAll({
    saveRule: (ruleName, ruleDef) => rules.setRule(ruleName, ruleDef, fetchImpl),
    requestRulesImpl: async () => {
      reloadCount += 1;
      return createServerRules();
    }
  });
  await waitForCondition(() => findLoginElements(body).cancelButton);
  findLoginElements(body).cancelButton.dispatch('click');
  await savePromise;

  assert.equal(reloadCount, 0);
  assert.equal(app.textContent.includes('保存失败：已取消登录'), true);
  assert.deepEqual(Array.from(state.drafts.HDSWEB), ['九门', '少年张三丰']);
  assert.equal(findElements(app, element => element.id === 'save-all-button')[0].disabled, false);
});

test('saveAll 在 Pure 最终写入失败后可仅重试 Pure 修复操作', async () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  state.drafts.HHWEB = ['侠客行'];
  rules.renderEditor(state);
  const mutableServerRules = JSON.parse(JSON.stringify(createServerRules()));
  const firstAttemptRuleNames = [];

  await rules.saveAll({
    saveRule: async (ruleName, ruleDef) => {
      firstAttemptRuleNames.push(ruleName);
      if (ruleName === 'Pure-HDSWEB') {
        throw new Error('Pure 最终写入失败');
      }
      mutableServerRules[ruleName] = ruleDef;
    },
    requestRulesImpl: async () => mutableServerRules
  });

  const saveButton = findElements(app, element => element.id === 'save-all-button')[0];
  assert.deepEqual(firstAttemptRuleNames, ['HHWEB', 'Pure-HDSWEB']);
  assert.equal(saveButton.disabled, false);

  const retryRuleNames = [];
  await rules.saveAll({
    saveRule: async (ruleName, ruleDef) => {
      retryRuleNames.push(ruleName);
      mutableServerRules[ruleName] = ruleDef;
    },
    requestRulesImpl: async () => mutableServerRules
  });

  assert.deepEqual(retryRuleNames, ['Pure-HDSWEB']);
  assert.equal(app.textContent.includes('保存成功'), true);
});

test('saveAll 保存和重新读取均失败时显示组合错误', async () => {
  const { app, document } = createFakeDocument();
  const { rules } = loadRulesScript({ document, fetch: () => new Promise(() => {}) });
  const state = rules.createEditorState(createServerRules());
  state.drafts.HDSWEB = ['九门', '少年张三丰'];
  rules.renderEditor(state);

  await rules.saveAll({
    saveRule: async () => {
      throw new Error('写入失败');
    },
    requestRulesImpl: async () => {
      throw new Error('读取失败');
    }
  });

  assert.equal(app.textContent.includes('保存失败：写入失败；重新读取规则失败'), true);
});

test('rules.html 引用外部规则脚本', () => {
  const html = fs.readFileSync(RULES_HTML_PATH, 'utf8');

  assert.match(html, /<script src="\.\/rules\.js(?:\?[^\"]+)?"><\/script>/);
  assert.equal(html.includes('<script type="text/javascript">'), false);
});
