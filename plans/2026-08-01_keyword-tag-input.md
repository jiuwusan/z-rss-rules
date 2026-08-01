# 关键词标签输入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将普通规则的 textarea 替换为支持多分隔符、删除和键盘操作的标签输入组件。

**Architecture:** 保持 `state.drafts[ruleName]` 字符串数组模型，新增纯函数解析标签输入，并由 `renderEditor` 根据草稿重建标签 DOM。标签事件只更新对应草稿和编辑状态，不修改规则生成、API 或保存计划。

**Tech Stack:** 原生 JavaScript、HTML/CSS、Node.js 内置 `node:test` 与现有最小 DOM 替身。

## 全局约束

- 分隔符仅为 `|`、`;`、英文逗号和换行，Enter 也提交标签。
- 中文逗号和顿号属于关键词正文。
- 标签去空、去重并保持首次出现顺序。
- Pure 规则保持只读。
- 不引入第三方依赖，不自动提交或 Push。

---

### 任务 1：标签输入解析与交互

**文件：**

- 修改：`frontend/rules.js`
- 修改：`frontend/rules.html`
- 修改：`tests/rules.test.js`

**接口：**

- `parseKeywordInput(value): string[]`：按 `|`、`;`、英文逗号和换行拆分。
- `appendDraftKeywords(ruleName, inputValue): void`：向草稿追加去重关键词。
- `removeDraftKeyword(ruleName, keyword): void`：删除指定关键词。
- `renderKeywordEditor(ruleName, state): HTMLElement`：生成标签容器和尾部输入框。

- [x] **步骤 1：扩展 DOM 替身并编写失败测试**

  为测试元素增加 `attributes`、`setAttribute`、`focus`、`preventDefault` 和键盘事件支持。新增断言：

  ```js
  assert.deepEqual(parseKeywordInput('九门|非份之罪;少年张三丰,侠客行\n雪中悍刀行'), ['九门', '非份之罪', '少年张三丰', '侠客行', '雪中悍刀行']);
  assert.deepEqual(parseKeywordInput('九门，非份之罪、少年张三丰'), ['九门，非份之罪、少年张三丰']);
  ```

  页面测试断言标签数量、删除按钮、Enter 提交、空输入 Backspace 删除、blur 提交及保存状态更新。

- [x] **步骤 2：运行测试并确认红灯**

  运行：`node --test tests/rules.test.js`

  预期：解析分隔符和标签 DOM 测试因旧 textarea 实现而失败。

- [x] **步骤 3：实现标签输入纯逻辑**

  将解析表达式改为：

  ```js
  const parseKeywordInput = value => uniqueKeywords(String(value).split(/[|;,\n]/));
  ```

  新增草稿追加和删除函数，每次变化后调用统一的编辑状态刷新逻辑。

- [x] **步骤 4：实现标签 DOM 与键盘行为**

  `renderKeywordEditor` 为每个关键词创建文本节点和删除按钮，尾部创建单行输入框。输入中出现分隔符、Enter、blur 时提交；输入为空时 Backspace 删除最后一个标签。每次草稿变化后重新渲染编辑器，并保持可继续输入。

- [x] **步骤 5：更新样式与帮助文案**

  移除 textarea 专属样式，新增标签容器、标签、删除按钮、尾部输入框及焦点样式；帮助文案改为“输入 `|`、`;`、英文逗号、换行或 Enter 创建标签”。

- [x] **步骤 6：运行全部测试并格式检查**

  运行：`node --test tests/rules.test.js`

  运行：`npx prettier --check frontend/rules.html frontend/rules.js tests/rules.test.js docs/2026-08-01_keyword-tag-input-design.md plans/2026-08-01_keyword-tag-input.md sessions/session_2026-08-01.md`

  运行：`git diff --check -- frontend/rules.html frontend/rules.js tests/rules.test.js docs/2026-08-01_keyword-tag-input-design.md plans/2026-08-01_keyword-tag-input.md sessions/session_2026-08-01.md`

  预期：全部退出码为 0。

## 计划自审

- 标签新增、批量拆分、去重、删除、Backspace、blur 和禁用状态均有测试步骤。
- 草稿数据结构及现有保存流程保持不变。
- 接口名称在测试与实现步骤中一致，无占位内容。
