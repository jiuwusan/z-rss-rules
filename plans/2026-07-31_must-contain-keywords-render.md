# mustContainKeywords 页面渲染实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 qBittorrent 规则名渲染每条规则的 `mustContainKeywords`，空关键词显示“无关键词”。

**Architecture:** 保持单页原生 JavaScript 结构，将数据转换、DOM 渲染和请求编排拆成独立函数。测试通过 Node.js `vm` 执行页面真实脚本，并用最小 DOM 替身验证节点内容。

**Tech Stack:** HTML、原生 JavaScript、Node.js 内置 `node:test`、`node:vm`。

## 全局约束

- 不引入第三方依赖或前端框架。
- 不修改 `frontend/rulesArray.txt` 样例数据。
- 使用 DOM API 和 `textContent` 渲染接口文本。
- 保留现有 `mustNotContainKeywords` 解析与 `GLOBAL_NOT_CONTAIN` 过滤逻辑。

---

### 任务 1：规则转换与页面渲染

**文件：**

- 修改：`frontend/rules.html`
- 新增测试：`tests/rules.test.js`

**接口：**

- `transformRules(rules)`：接收规则对象，返回包含 `name`、`mustContainKeywords` 和 `mustNotContainKeywords` 的规则数组。
- `renderRules(rulesArray)`：将规则名称和关键词写入 `#app`。
- `renderLoadError()`：在 `#app` 显示统一加载失败信息。
- `queryRules()`：读取接口、检查 HTTP 状态、转换并渲染规则。

- [x] **步骤 1：编写失败测试**

  在 `tests/rules.test.js` 中加载页面脚本，断言转换结果包含规则名，并断言渲染后存在规则标题、关键词以及“无关键词”提示。

- [x] **步骤 2：验证测试按预期失败**

  运行：`node --test tests/rules.test.js`

  预期：测试因 `transformRules` 或 `renderRules` 尚不存在而失败。

- [x] **步骤 3：编写最小实现**

  在 `frontend/rules.html` 中：

  1. 为转换结果增加 `name`。
  2. 将无括号的 `mustContain` 转换为 `[]`。
  3. 使用 `section`、`h2`、`ul`、`li` 节点渲染规则。
  4. 无关键词时创建文本为“无关键词”的列表项。
  5. 请求失败时调用 `renderLoadError()`。

- [x] **步骤 4：验证测试通过**

  运行：`node --test tests/rules.test.js`

  预期：全部测试通过，无警告和未处理异常。

- [x] **步骤 5：格式与静态检查**

  运行：`npx prettier --check frontend/rules.html tests/rules.test.js`

  运行：`git diff --check`

  预期：两个命令退出码均为 0。

- [x] **步骤 6：浏览器行为检查**

  使用可控的假接口响应执行页面脚本，确认多关键词和空关键词两种规则均生成预期 DOM 文本，接口失败时显示“规则加载失败”。

## 计划自审

- 设计中的数据转换、DOM 安全渲染、空关键词和错误状态均有对应实施步骤。
- 函数名称在设计、测试和实现步骤中保持一致。
- 计划无待定项，不包含登录、规则编辑或同步等范围外功能。
