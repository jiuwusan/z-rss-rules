# RSS 规则关键词单列布局设计

## 1. 目标

RSS 规则关键词功能中的每个规则卡片在所有屏幕宽度下独占一行，以提高关键词编辑区域的横向空间和阅读一致性。

## 2. 布局规则

- `.rules-list` 保持现有 Grid 容器，但列定义固定为 `grid-template-columns: 1fr`。
- 桌面端和移动端使用同一单列规则，不设置双列断点。
- 规则卡片继续占满右侧功能内容区的可用宽度。
- 卡片间距、边框、内边距、关键词标签编辑器、Pure 规则样式和底部操作区保持不变。

## 3. 最小影响范围

- 修改 `frontend/quick-tools.css` 中 `.rules-list` 的列定义。
- 删除 `@media (max-width: 760px)` 中对 `.rules-list` 的重复单列声明，只保留 Torrent 弹窗字段的移动端单列规则。
- 在 `tests/quick-tools.test.js` 增加 CSS 契约断言，验证 `.rules-list` 在基础样式中为单列。

不修改 HTML、JavaScript、qBittorrent API、鉴权、RSS 规则数据结构或保存逻辑。

## 4. 验证范围

- Quick Tools 样式测试确认 `.rules-list` 使用 `grid-template-columns: 1fr`。
- 现有移动端布局、功能切换和 RSS 编辑测试继续通过。
- 执行完整测试，确认 Torrent 重命名与登录功能不受影响。

## 5. 未覆盖风险

- Fake DOM 和 CSS 文本契约测试不验证真实浏览器中超长关键词、超多标签及不同视口下的视觉高度。
- 单列会增加规则较多时的纵向滚动距离，这是本次“一行一个”布局的预期取舍。
