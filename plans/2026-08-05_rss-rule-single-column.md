# RSS 规则关键词单列布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 RSS 规则关键词卡片在所有屏幕宽度下保持一行一个的单列布局。

**Architecture:** 保留现有 `.rules-list` Grid 容器，只把基础列定义从双列改为单列，并删除移动端重复覆盖。通过现有 CSS 文本契约测试锁定单列行为，不修改 HTML、JavaScript 或业务状态。

**Tech Stack:** 原生 CSS、Node.js `node:test`。

## Global Constraints

- RSS 规则卡片在所有屏幕宽度下使用 `grid-template-columns: 1fr`。
- 保留卡片间距、边框、内边距、关键词标签、Pure 规则样式和底部操作区。
- 不修改 HTML、JavaScript、qBittorrent API、鉴权、RSS 数据结构或保存逻辑。
- 不引入依赖，不进行无关格式化，不自动 Push。
- 代码注释与文档使用中文。

---

### Task 1: 固定 RSS 规则列表为单列

**Files:**
- Modify: `frontend/quick-tools.css:105-109,470-473`
- Test: `tests/quick-tools.test.js:83-94`

**Interfaces:**
- Consumes: `.rules-list` 现有 Grid 容器和 `@media (max-width: 760px)` 响应式规则。
- Produces: 所有宽度统一的 `.rules-list { grid-template-columns: 1fr; }` CSS 契约。

- [ ] **Step 1: 编写失败的 CSS 契约测试**

在 `tests/quick-tools.test.js` 的样式测试中增加以下断言：

```js
assert.match(css, /\.rules-list\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*1fr;/s);
assert.doesNotMatch(css, /\.rules-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test tests/quick-tools.test.js`

Expected: FAIL，实际基础样式仍为 `repeat(2, minmax(0, 1fr))`，不符合单列断言。

- [ ] **Step 3: 实现最小 CSS 修改**

将 `frontend/quick-tools.css` 的基础规则改为：

```css
.rules-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
```

将移动端联合选择器：

```css
.rules-list,
.torrent-rename-fields {
  grid-template-columns: 1fr;
}
```

收窄为：

```css
.torrent-rename-fields {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `node --test tests/quick-tools.test.js`

Expected: PASS，Quick Tools 的 6 个测试全部通过。

- [ ] **Step 5: 执行完整验证**

Run: `npm test`

Expected: 所有测试文件 PASS，失败数为 `0`。

Run: `git diff --check -- frontend/quick-tools.css tests/quick-tools.test.js`

Expected: 无输出，退出码为 `0`。

Run: `git diff --stat -- frontend/quick-tools.css tests/quick-tools.test.js`

Expected: 只包含上述 CSS 与测试文件，不包含 HTML、JavaScript 或业务数据文件。

- [ ] **Step 6: 提交实现**

```bash
git add frontend/quick-tools.css tests/quick-tools.test.js
git commit -m "style: 调整 RSS 规则为单列布局"
```

最终不执行 `git push`。
