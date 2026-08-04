# Task 1 实施报告：Torrent 文件双行预览

## 状态

DONE，无已知阻塞。

## TDD 过程

1. RED：先增加“空正则也显示两条原始文件行”断言，定向测试按预期以 `0 !== 2` 失败。
2. GREEN：新增原始行渲染后，定向测试 30/30 通过。
3. RED：再增加严格的“原始行 + 预览行”相邻顺序断言，旧实现按预期只返回两个无行类型的单行预览。
4. GREEN：拆分原始行与预览行渲染后，定向测试 30/30 通过。
5. 回归覆盖：补充无效正则、未匹配、目标冲突和刷新文件替换旧路径测试，最终定向测试 33/33 通过。

## 改动文件

- `frontend/torrent-renamer.js`
  - 文件加载后始终按服务端顺序渲染完整原始路径。
  - 有效正则时按 `oldPath` 映射、文件位置兜底，渲染严格相邻的原始行和预览行。
  - 选择框只创建在预览行，继续沿用现有有效性、选择和保存语义。
  - 表头调整为“保存、类型、文件名称、状态”。
- `frontend/quick-tools.css`
  - 增加原始行、预览行、类型列和文件分组边框样式。
- `tests/torrent-renamer.test.js`
  - 覆盖空正则、完整路径、相邻双行、选择框位置、无效正则、未匹配、冲突和刷新替换。
- `plans/2026-08-04_torrent-file-paired-preview.md`
  - 完成 Task 1 checklist。

## 验证结果

- `node --test tests/torrent-renamer.test.js`：33/33 通过。
- `npm test`：96/96 通过。
- `node --check frontend/torrent-renamer.js`：通过。
- 计划指定的 `npx prettier --check ...`：通过。
- 计划指定的 `git diff --check ...`：通过。

## 自审结论

- 未修改 `buildRenamePreview`、API、鉴权、RSS、串行保存和异步版本保护语义。
- 预览关联使用一次性 `Map`，渲染复杂度保持线性，避免大量文件时逐行扫描预览数组。
- 未发现 Critical/Important 问题。

## 未覆盖风险

- Fake DOM 不验证真实浏览器中的超长路径换行、横向滚动和双行边框视觉效果。
- 未在真实 qBittorrent 5.0 的大量文件 Torrent 上进行交互与性能验证。
