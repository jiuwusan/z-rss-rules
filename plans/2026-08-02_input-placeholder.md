# 输入框 Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为登录用户名、登录密码和关键词标签输入框增加已确认的 placeholder。

**Architecture:** 沿用 `frontend/rules.js` 中现有 DOM 创建逻辑，只为三个 input 设置静态属性。通过现有 Node 测试验证渲染结果，并递增外部脚本缓存版本。

**Tech Stack:** HTML、原生 JavaScript、Node.js `node:test`

## Global Constraints

- 用户名文案固定为 `请输入用户名`。
- 密码文案固定为 `请输入密码`。
- 标签输入文案固定为 `输入关键词`。
- 不改变自动填充、校验、标签解析和保存逻辑。

---

### Task 1: 输入框提示文案

**Files:**

- Modify: `tests/rules.test.js`
- Modify: `frontend/rules.js`
- Modify: `frontend/rules.html`
- Modify: `sessions/session_2026-08-02.md`

**Interfaces:**

- Consumes: `createLoginDialog()` 和 `renderKeywordEditor(ruleName, state, helpTextId)` 创建的 input 元素。
- Produces: 三个 input 元素的 `placeholder` 属性。

- [x] **Step 1: 编写失败测试**

在登录弹窗测试中断言用户名与密码 placeholder；在标签编辑器测试中断言关键词 placeholder。

- [x] **Step 2: 验证测试失败**

Run: `node --test --test-name-pattern='placeholder' tests/rules.test.js`
Expected: FAIL，提示 placeholder 实际值为空。

- [x] **Step 3: 添加最小实现**

在创建对应 input 时设置：

```js
usernameInput.placeholder = '请输入用户名';
passwordInput.placeholder = '请输入密码';
keywordInput.placeholder = '输入关键词';
```

将 `frontend/rules.html` 的 `rules.js` 查询版本递增为 `v=1.0.2`。

- [x] **Step 4: 验证实现**

Run: `node --test tests/rules.test.js`
Expected: 45 项测试全部通过。

Run: `node --check frontend/rules.js`
Expected: exit 0。

Run: `npx prettier --check frontend/rules.html frontend/rules.js tests/rules.test.js docs/2026-08-02_input-placeholder-design.md plans/2026-08-02_input-placeholder.md sessions/session_2026-08-02.md`
Expected: 所有文件符合格式。

Run: `git diff --check -- frontend/rules.html frontend/rules.js tests/rules.test.js docs/2026-08-02_input-placeholder-design.md plans/2026-08-02_input-placeholder.md sessions/session_2026-08-02.md`
Expected: exit 0。
