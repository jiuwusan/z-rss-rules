const LOGIN_CANCELLED_MESSAGE = '已取消登录';
const LOGIN_CREDENTIAL_ERROR_MESSAGE = '用户名或密码错误，请重试';
const AUTH_REQUIRED_STATUS = 403;
const AUTH_CLIENTS_BY_DOCUMENT = new WeakMap();

/**
 * 创建隔离登录状态的鉴权客户端。
 * @param {object} dependencies 外部依赖
 * @param {Document} dependencies.documentRef 页面文档
 * @param {typeof fetch} dependencies.fetchImpl Fetch 实现
 * @returns {{authenticatedFetch: Function, requestLogin: Function}} 鉴权客户端
 * @throws {Error} 同一页面重复绑定不同 Fetch 实现时抛出
 */
export const createAuthClient = ({ documentRef = globalThis.document, fetchImpl = globalThis.fetch } = {}) => {
  const canCacheByDocument = documentRef !== null && (typeof documentRef === 'object' || typeof documentRef === 'function');
  const cachedAuthClient = canCacheByDocument ? AUTH_CLIENTS_BY_DOCUMENT.get(documentRef) : null;
  if (cachedAuthClient && cachedAuthClient.fetchImpl !== fetchImpl) {
    throw new Error('同一 documentRef 只能绑定一个 fetchImpl');
  }
  if (cachedAuthClient) {
    return cachedAuthClient.client;
  }

  let loginDialogElements = null;
  let loginAttempt = null;
  let loginReturnFocusElement = null;
  let successfulLoginVersion = 0;
  let loginCancellationVersion = 0;

  /**
   * 更新登录弹窗控件状态。
   * @param {boolean} isBusy 是否正在提交或验证
   * @param {string} submitText 登录按钮文案
   * @returns {void}
   */
  const setLoginControlsBusy = (isBusy, submitText = '登录') => {
    if (!loginDialogElements) {
      return;
    }

    const { usernameInput, passwordInput, submitButton, cancelButton } = loginDialogElements;
    usernameInput.disabled = isBusy;
    passwordInput.disabled = isBusy;
    submitButton.disabled = isBusy;
    cancelButton.disabled = isBusy;
    submitButton.textContent = submitText;
  };

  /**
   * 登录弹窗显示期间禁用页面后方交互。
   * @param {boolean} isInert 是否禁用背景
   * @returns {void}
   */
  const setLoginBackgroundInert = isInert => {
    const app = documentRef?.getElementById('app');
    if (app) {
      app.inert = isInert;
    }
  };

  /**
   * 关闭登录弹窗并清理凭据。
   * @returns {void}
   */
  const closeLoginDialog = () => {
    if (!loginDialogElements) {
      return;
    }

    const { overlay, usernameInput, passwordInput, errorElement } = loginDialogElements;
    overlay.hidden = true;
    usernameInput.value = '';
    passwordInput.value = '';
    errorElement.textContent = '';
    setLoginControlsBusy(false);
    setLoginBackgroundInert(false);

    const focusElement = loginReturnFocusElement;
    loginReturnFocusElement = null;
    if (focusElement?.focus && focusElement.isConnected !== false) {
      focusElement.focus();
    }
  };

  /**
   * 显示登录错误并恢复输入状态。
   * @param {string} message 错误文案
   * @returns {void}
   */
  const showLoginError = message => {
    if (!loginDialogElements) {
      return;
    }

    const { overlay, passwordInput, errorElement } = loginDialogElements;
    overlay.hidden = false;
    errorElement.textContent = message;
    passwordInput.value = '';
    setLoginControlsBusy(false);
    passwordInput.focus();
  };

  /**
   * 取消当前登录尝试。
   * @returns {void}
   */
  const cancelLogin = () => {
    const currentAttempt = loginAttempt;
    if (!currentAttempt) {
      closeLoginDialog();
      return;
    }

    loginAttempt = null;
    loginCancellationVersion += 1;
    closeLoginDialog();
    currentAttempt.reject(new Error(LOGIN_CANCELLED_MESSAGE));
  };

  /**
   * 提交当前登录表单。
   * @returns {Promise<void>}
   */
  const submitLogin = async () => {
    if (!loginAttempt || !loginDialogElements) {
      return;
    }

    const { usernameInput, passwordInput, errorElement } = loginDialogElements;
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      showLoginError('请输入用户名和密码');
      return;
    }

    const currentAttempt = loginAttempt;
    errorElement.textContent = '';
    setLoginControlsBusy(true, '登录中');

    try {
      // Fetch 必须以普通函数方式调用，避免浏览器原生实现因错误的 this 绑定抛出 Illegal invocation。
      const loginFetch = currentAttempt.fetchImpl;
      const response = await loginFetch('/api/v2/auth/login', {
        method: 'POST',
        credentials: 'include',
        body: new URLSearchParams({ username, password })
      });
      if (!response.ok) {
        showLoginError(LOGIN_CREDENTIAL_ERROR_MESSAGE);
        return;
      }

      if (loginAttempt !== currentAttempt) {
        return;
      }

      loginAttempt = null;
      successfulLoginVersion += 1;
      passwordInput.value = '';
      setLoginControlsBusy(true, '正在验证');
      currentAttempt.resolve();
    } catch (error) {
      console.error('登录请求失败', error);
      if (loginAttempt === currentAttempt) {
        showLoginError('登录失败，请重试');
      }
    }
  };

  /**
   * 创建可复用登录弹窗。
   * @returns {object} 登录弹窗元素
   */
  const createLoginDialog = () => {
    const overlay = documentRef.createElement('div');
    const dialog = documentRef.createElement('section');
    const form = documentRef.createElement('form');
    const title = documentRef.createElement('h2');
    const usernameField = documentRef.createElement('label');
    const usernameLabel = documentRef.createElement('span');
    const usernameInput = documentRef.createElement('input');
    const passwordField = documentRef.createElement('label');
    const passwordLabel = documentRef.createElement('span');
    const passwordInput = documentRef.createElement('input');
    const errorElement = documentRef.createElement('p');
    const actions = documentRef.createElement('div');
    const submitButton = documentRef.createElement('button');
    const cancelButton = documentRef.createElement('button');

    overlay.className = 'login-overlay';
    overlay.hidden = true;
    dialog.className = 'login-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'login-dialog-title');
    form.className = 'login-form';
    title.id = 'login-dialog-title';
    title.textContent = '登录';
    usernameField.className = 'login-form-field';
    usernameLabel.textContent = '用户名';
    usernameInput.id = 'login-username';
    usernameInput.type = 'text';
    usernameInput.placeholder = '请输入用户名';
    usernameInput.setAttribute('autocomplete', 'username');
    passwordField.className = 'login-form-field';
    passwordLabel.textContent = '密码';
    passwordInput.id = 'login-password';
    passwordInput.type = 'password';
    passwordInput.placeholder = '请输入密码';
    passwordInput.setAttribute('autocomplete', 'current-password');
    errorElement.className = 'login-error';
    errorElement.setAttribute('role', 'alert');
    actions.className = 'login-dialog-actions';
    submitButton.id = 'login-submit-button';
    submitButton.type = 'submit';
    submitButton.textContent = '登录';
    cancelButton.id = 'login-cancel-button';
    cancelButton.type = 'button';
    cancelButton.textContent = '取消';

    usernameField.append(usernameLabel, usernameInput);
    passwordField.append(passwordLabel, passwordInput);
    actions.append(cancelButton, submitButton);
    form.append(title, usernameField, passwordField, errorElement, actions);
    dialog.append(form);
    overlay.append(dialog);
    form.addEventListener('submit', event => {
      event.preventDefault();
      return submitLogin();
    });
    cancelButton.addEventListener('click', cancelLogin);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !cancelButton.disabled) {
        event.preventDefault();
        cancelLogin();
      }
    });
    documentRef.body.append(overlay);

    return { overlay, form, usernameInput, passwordInput, errorElement, submitButton, cancelButton };
  };

  /**
   * 请求用户完成一次登录尝试；并发调用共享同一个 Promise。
   * @returns {Promise<void>} 登录尝试
   */
  const requestLogin = () => {
    if (loginAttempt) {
      return loginAttempt.promise;
    }

    if (!documentRef?.body) {
      return Promise.reject(new Error('登录需要页面交互'));
    }

    if (!loginDialogElements) {
      loginDialogElements = createLoginDialog();
    }

    let resolveAttempt;
    let rejectAttempt;
    const promise = new Promise((resolve, reject) => {
      resolveAttempt = resolve;
      rejectAttempt = reject;
    });
    loginAttempt = { promise, resolve: resolveAttempt, reject: rejectAttempt, fetchImpl };

    const { overlay, usernameInput, errorElement } = loginDialogElements;
    const wasHidden = overlay.hidden;
    overlay.hidden = false;
    setLoginBackgroundInert(true);
    setLoginControlsBusy(false);
    if (wasHidden) {
      loginReturnFocusElement = documentRef.activeElement;
      errorElement.textContent = '';
      usernameInput.focus();
    }

    return promise;
  };

  /**
   * 执行需要登录态的请求，403 时等待用户登录并按次重试。
   * @param {string} url 请求地址
   * @param {object} options Fetch 参数
   * @returns {Promise<Response>} 最终响应
   */
  const authenticatedFetch = async (url, options = {}) => {
    const requestCancellationVersion = loginCancellationVersion;
    let requestLoginVersion = successfulLoginVersion;
    let response = await fetchImpl(url, options);
    let hasRequestedLogin = false;

    while (response.status === AUTH_REQUIRED_STATUS) {
      if (requestCancellationVersion !== loginCancellationVersion) {
        throw new Error(LOGIN_CANCELLED_MESSAGE);
      }

      if (requestLoginVersion === successfulLoginVersion) {
        hasRequestedLogin = true;
        await requestLogin();
      }

      requestLoginVersion = successfulLoginVersion;
      try {
        response = await fetchImpl(url, options);
      } catch (error) {
        if (!loginAttempt) {
          closeLoginDialog();
        }
        throw error;
      }

      if (requestCancellationVersion !== loginCancellationVersion) {
        throw new Error(LOGIN_CANCELLED_MESSAGE);
      }

      if (response.status === AUTH_REQUIRED_STATUS) {
        showLoginError(LOGIN_CREDENTIAL_ERROR_MESSAGE);
      }
    }

    if (hasRequestedLogin && !loginAttempt) {
      closeLoginDialog();
    }
    return response;
  };

  const client = { authenticatedFetch, requestLogin };
  if (canCacheByDocument) {
    AUTH_CLIENTS_BY_DOCUMENT.set(documentRef, { client, fetchImpl });
  }
  return client;
};
