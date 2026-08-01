# RSS 关键词编辑与安全保存实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有页面中编辑普通压制组关键词，通过安全分阶段计划生成并保存普通规则 `mustContain` 和 Pure 规则 `mustNotContain`。

**Architecture:** 将内联脚本迁移到 `frontend/rules.js`。脚本分为纯规则函数、API 函数和页面状态/渲染三部分；`frontend/rules.html` 仅保留页面结构、样式和脚本引用。测试使用 Node.js `vm` 执行真实浏览器脚本，并以最小 DOM 和可控 `fetch` 验证行为。

**Tech Stack:** HTML、原生 JavaScript、Fetch API、Node.js 内置 `node:test` 与 `node:vm`。

## 全局约束

- Pure 规则精确名称为 `Pure-HDSWEB`。
- Pure 的 `mustContain` 保持接口返回值，只有 `mustNotContain` 动态生成。
- 普通规则的 `mustNotContain` 保持接口返回值，只有 `mustContain` 动态生成。
- 普通规则空关键词使用 `九五三` 补位。
- 保存使用一个“保存全部”按钮和安全分阶段顺序。
- 不引入第三方依赖，不修改样例文件，不自动提交或 Push。

---

### 任务 1：规则生成和安全保存计划

**文件：**

- 创建：`frontend/rules.js`
- 修改：`tests/rules.test.js`

**接口：**

- `parseKeywordInput(value): string[]`：按中文逗号、英文逗号和换行拆分并去重。
- `extractKeywords(expression): string[]`：读取首个括号内容。
- `buildOrdinaryMustContain(original, keywords): string`：保留首个 `(` 前缀，空数组使用 `九五三`。
- `createEditorState(rules): object`：保存原始规则、普通规则名、草稿和 Pure 固定排除项。
- `createSavePlan(state): operation[]`：生成 `pure-safety`、`ordinary`、`pure-final` 有序操作。

- [x] **步骤 1：先修改测试加载器并编写失败测试**

  测试改为读取 `frontend/rules.js`。新增断言：

  ```js
  assert.deepEqual(parseKeywordInput('九门，非份之罪\n九门'), ['九门', '非份之罪']);
  assert.equal(buildOrdinaryMustContain('H265.*HDSWEB.*(旧)', []), 'H265.*HDSWEB.*(九五三)');
  assert.equal(plan[0].phase, 'pure-safety');
  assert.equal(plan.at(-1).phase, 'pure-final');
  ```

- [x] **步骤 2：运行测试并确认红灯**

  运行：`node --test tests/rules.test.js`

  预期：因 `frontend/rules.js` 或新函数不存在而失败。

- [x] **步骤 3：实现纯规则函数**

  在 `frontend/rules.js` 中定义：

  ```js
  const PURE_RULE_NAME = 'Pure-HDSWEB';
  const EMPTY_KEYWORD_PLACEHOLDER = '九五三';

  const parseKeywordInput = value => uniqueKeywords(String(value).split(/[，,\n]/));
  const buildOrdinaryMustContain = (original, keywords) => {
    const prefix = original.includes('(') ? original.slice(0, original.indexOf('(')) : original;
    const effectiveKeywords = keywords.length ? keywords : [EMPTY_KEYWORD_PLACEHOLDER];
    return `${prefix}(${effectiveKeywords.join('|')})`;
  };
  ```

  `createSavePlan` 按“固定 + 新 + 仅旧 → 普通规则 → 固定 + 新”生成必要操作，每个 `ruleDef` 从原规则浅复制，只覆盖允许动态变化的字段。失败重读沿用保存前的可信固定项，并支持 Pure-only 修复计划。

- [x] **步骤 4：运行测试并确认绿灯**

  运行：`node --test tests/rules.test.js`

  预期：规则生成和保存顺序测试通过。

---

### 任务 2：qBittorrent API 与保存执行

**文件：**

- 修改：`frontend/rules.js`
- 修改：`tests/rules.test.js`

**接口：**

- `requestRules(fetchImpl): Promise<object>`：读取 `/api/v2/rss/rules`。
- `setRule(ruleName, ruleDef, fetchImpl): Promise<void>`：提交 `/api/v2/rss/setRule`。
- `executeSavePlan(operations, saveRule): Promise<void>`：严格按数组顺序等待保存。

- [x] **步骤 1：编写 API 失败测试**

  使用记录请求的假 `fetch`，断言：

  ```js
  assert.equal(url, '/api/v2/rss/setRule');
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'include');
  assert.equal(options.body.get('ruleName'), 'HDSWEB');
  assert.equal(JSON.parse(options.body.get('ruleDef')).mustContain, 'H265.*HDSWEB.*(九门)');
  ```

  另断言第二个操作失败后第三个操作不会执行。

- [x] **步骤 2：运行测试并确认红灯**

  运行：`node --test tests/rules.test.js`

  预期：因 API 函数不存在而失败。

- [x] **步骤 3：实现 API 函数**

  `setRule` 使用：

  ```js
  const body = new URLSearchParams({ ruleName, ruleDef: JSON.stringify(ruleDef) });
  await fetchImpl('/api/v2/rss/setRule', {
    method: 'POST',
    credentials: 'include',
    body
  });
  ```

  每个请求检查 `response.ok`，失败时抛出带规则名的异常；`executeSavePlan` 使用 `for...of` 和 `await` 保证顺序。

- [x] **步骤 4：运行测试并确认绿灯**

  运行：`node --test tests/rules.test.js`

  预期：API 请求契约、顺序和失败中止测试通过。

---

### 任务 3：关键词编辑页面与保存全部

**文件：**

- 修改：`frontend/rules.html`
- 修改：`frontend/rules.js`
- 修改：`tests/rules.test.js`

**接口：**

- `renderEditor(state): void`：渲染普通规则输入框、Pure 只读卡片、状态和保存按钮。
- `updateDraft(ruleName, input): void`：更新草稿并刷新未保存状态。
- `saveAll(): Promise<void>`：创建计划、禁用页面、执行保存并重新读取。
- `loadRules(): Promise<void>`：读取服务端规则、创建状态并渲染。

- [x] **步骤 1：编写页面失败测试**

  扩展最小 DOM 替身以支持 `value`、`disabled`、`addEventListener`。断言：

  ```js
  assert.equal(textarea.value, '九门、非份之罪');
  assert.equal(pureCard.textContent.includes('自动维护'), true);
  assert.equal(saveButton.disabled, true);
  textarea.dispatch('input');
  assert.equal(saveButton.disabled, false);
  ```

  保存成功测试断言执行计划后再次读取规则；失败测试断言停止保存、重新读取并显示失败状态。

- [x] **步骤 2：运行测试并确认红灯**

  运行：`node --test tests/rules.test.js`

  预期：因编辑页面和保存编排尚未实现而失败。

- [x] **步骤 3：实现页面**

  `frontend/rules.html` 保留标题、`#app` 和样式，将内联脚本替换为：

  ```html
  <script src="./rules.js"></script>
  ```

  `renderEditor` 为普通规则创建 `textarea`，为 Pure 创建只读说明，并创建状态区与“保存全部”按钮。输入事件更新 `state.drafts[ruleName]`；保存期间统一禁用控件。

- [x] **步骤 4：实现保存编排**

  `saveAll` 创建计划并调用 `executeSavePlan`。成功后调用 `loadRules` 并显示“保存成功”；失败时记录错误、停止后续保存、尝试 `loadRules`，最终显示具体失败信息。

- [x] **步骤 5：运行全部测试**

  运行：`node --test tests/rules.test.js`

  预期：所有测试通过，无未处理异常。

- [x] **步骤 6：格式和差异检查**

  运行：`npx prettier --check frontend/rules.html frontend/rules.js tests/rules.test.js docs/2026-07-31_rss-keyword-editor-save-design.md plans/2026-07-31_rss-keyword-editor-save.md sessions/session_2026-07-31.md`

  运行：`git diff --check -- frontend/rules.html frontend/rules.js tests/rules.test.js docs/2026-07-31_rss-keyword-editor-save-design.md plans/2026-07-31_rss-keyword-editor-save.md sessions/session_2026-07-31.md`

  预期：两个命令退出码均为 0。

## 计划自审

- 三个任务覆盖纯规则生成、API 请求、DOM 编辑和保存失败恢复。
- Pure 与普通规则允许变化的字段在所有任务中一致。
- 安全保存计划明确覆盖新增、删除和混合关键词变化。
- 所有接口名称在任务之间保持一致，无占位内容。
