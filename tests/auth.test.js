import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthClient } from '../frontend/auth.js';
import { createFakeDocument, findElements, waitForCondition } from './helpers/fake-dom.js';

const findLoginElements = body => ({
  overlay: findElements(body, element => element.className === 'login-overlay')[0],
  form: findElements(body, element => element.className === 'login-form')[0],
  usernameInput: findElements(body, element => element.id === 'login-username')[0],
  passwordInput: findElements(body, element => element.id === 'login-password')[0],
  errorElement: findElements(body, element => element.className === 'login-error')[0],
  submitButton: findElements(body, element => element.id === 'login-submit-button')[0],
  cancelButton: findElements(body, element => element.id === 'login-cancel-button')[0]
});

test('同一 documentRef 重复创建时复用同一鉴权客户端', async () => {
  const { app, body, document } = createFakeDocument();
  const fetchImpl = async () => ({ ok: false, status: 403 });

  const firstAuthClient = createAuthClient({ documentRef: document, fetchImpl });
  const secondAuthClient = createAuthClient({ documentRef: document, fetchImpl });

  assert.strictEqual(secondAuthClient, firstAuthClient);

  const firstResponsePromise = firstAuthClient.authenticatedFetch('/api/first');
  const secondResponsePromise = secondAuthClient.authenticatedFetch('/api/second');
  await waitForCondition(() => findLoginElements(body).cancelButton);

  assert.equal(findElements(body, element => element.className === 'login-overlay').length, 1);
  assert.equal(app.inert, true);

  findLoginElements(body).cancelButton.dispatch('click');
  const results = await Promise.allSettled([firstResponsePromise, secondResponsePromise]);

  assert.deepEqual(
    results.map(result => result.reason.message),
    ['已取消登录', '已取消登录']
  );
  assert.equal(app.inert, false);
});

test('同一 documentRef 不能绑定不同 fetchImpl', () => {
  const { document } = createFakeDocument();
  const firstFetchImpl = async () => ({ ok: true, status: 200 });
  const secondFetchImpl = async () => ({ ok: true, status: 200 });

  const authClient = createAuthClient({ documentRef: document, fetchImpl: firstFetchImpl });

  assert.throws(
    () => createAuthClient({ documentRef: document, fetchImpl: secondFetchImpl }),
    /同一 documentRef 只能绑定一个 fetchImpl/
  );
  assert.strictEqual(createAuthClient({ documentRef: document, fetchImpl: firstFetchImpl }), authClient);
});

test('authenticatedFetch 非 403 时直接返回且不显示登录弹窗', async () => {
  const { body, document } = createFakeDocument();
  const fetchImpl = async () => ({ ok: true, status: 200 });
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const response = await authClient.authenticatedFetch('/api/v2/rss/rules', { credentials: 'include' });

  assert.equal(response.status, 200);
  assert.equal(findElements(body, element => element.className === 'login-overlay').length, 0);
});

test('登录输入框渲染 placeholder', async () => {
  const { body, document } = createFakeDocument();
  const fetchImpl = async () => ({ ok: false, status: 403 });
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  authClient.authenticatedFetch('/api/v2/rss/rules');
  await waitForCondition(() => findLoginElements(body).form);
  const { usernameInput, passwordInput } = findLoginElements(body);

  assert.equal(usernameInput.placeholder, '请输入用户名');
  assert.equal(passwordInput.placeholder, '请输入密码');
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
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const responsePromise = authClient.authenticatedFetch('/api/v2/rss/rules', { credentials: 'include' });
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
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const responsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
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
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const responsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
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
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const responsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
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
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const responsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
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
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const firstResponsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
  const secondResponsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
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
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const firstResponsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
  const delayedRequestPromise = authClient.authenticatedFetch('/api/v2/rss/rules');
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
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const firstResponsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
  const secondResponsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
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
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const firstResponsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
  const secondResponsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
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

test('取消登录后等待请求失败、清理密码并恢复焦点', async () => {
  const { body, document } = createFakeDocument();
  const returnFocusButton = document.createElement('button');
  body.append(returnFocusButton);
  returnFocusButton.focus();
  const fetchImpl = async () => ({ ok: false, status: 403 });
  const authClient = createAuthClient({ documentRef: document, fetchImpl });

  const responsePromise = authClient.authenticatedFetch('/api/v2/rss/rules');
  await waitForCondition(() => findLoginElements(body).cancelButton);
  const { cancelButton, overlay, passwordInput } = findLoginElements(body);
  passwordInput.value = 'secret';
  cancelButton.dispatch('click');

  await assert.rejects(responsePromise, /已取消登录/);
  assert.equal(overlay.hidden, true);
  assert.equal(passwordInput.value, '');
  assert.equal(returnFocusButton.isFocused, true);
});
