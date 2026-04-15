# 蓝图 v0.2 可行性验证报告

> 日期：2026-04-14  
> 基于 Claude Code v2.1.107，cli.js 13.04 MB  
> 目的：对修订后的蓝图逐模块验证，确保设计完全可行

---

## 总评：可行，但需 3 项修订

蓝图 v0.2 的整体架构正确，全流程端到端验证通过。但验证发现了 **3 个必须在实现前修正的问题**：

| # | 问题 | 严重度 | 蓝图原描述 | 验证结果 |
|---|------|--------|-----------|---------|
| 1 | createElement 内字符串并非全是 UI 文本 | **高** | "2,440 个均为真实 UI 文本" | 7,338 个中只有 2,635 个是 children，去重过滤后约 1,515 个 |
| 2 | Patcher 逐次 slice 性能不可接受 | **高** | "从末尾到开头替换" | 6,316 次替换耗时 42.9s，改用分段拼接后仅 8ms |
| 3 | 翻译文本中的特殊字符导致语法错误 | **中** | 未提及 | 换行符 `\n` 未转义导致 Unterminated string |

---

## 一、Extractor 模块验证

### 结论：核心逻辑可行，但翻译范围必须缩窄

### 关键发现：createElement 参数位置分析

蓝图假设 "createElement 内的字符串均为 UI 文本"——这不准确。`createElement(type, props, ...children)` 中的字符串按参数位置分布如下：

| 参数位置 | 数量 | 去重 | 是否 UI 文本 | 应翻译 |
|----------|------|------|-------------|--------|
| 第 1 参数（组件类型名） | 24 | 13 | 否（"div", "ink-box" 等） | 否 |
| 第 2 参数（props 属性值） | 4,137 | 749 | 否（"column", "ansi:red" 等） | 否 |
| 第 3+ 参数（children 直接文本） | 2,635 | 1,654 | **是** | **是** |
| 嵌套 children | 541 | 301 | 部分是 | P1 审核 |
| 无法分类 | 1 | 1 | — | 跳过 |
| **合计** | **7,338** | — | — | — |

**children 直接文本**进一步自动过滤（单字符、纯符号、标识符模式）后，剩余约 **1,515 个**真实 UI 文本。

### children 文本抽样（确认为真实 UI 文本）

```
"Welcome to Claude Code for "
"Press ... again to exit"
"(No resources found)"
"Running…"
"Sent a message to"
"[Image]"
"⧉ open files"
"• Claude has context of "
"• Review Claude Code's changes"
```

### 不应翻译的 propValue 抽样

```
"column"（842次）, "row"（160次）, "ansi:red", "ansi:white",
"hidden", "single", "expand", "space-between", "100%",
"enter", "confirm:no", "Esc", "cancel", "suggestion"
```

这些是 Ink 组件的布局/样式/事件属性，翻译它们会破坏 UI 渲染。

### 修订建议

**P0 翻译范围必须从 "createElement 内所有字符串" 缩窄为 "createElement 第 3+ 参数位置的直接字符串字面量"。**

extractor 需要识别字符串在 createElement 调用中的参数位置：
- 第 1 参数 → 标记为 `componentType`，跳过
- 第 2 参数（ObjectExpression 内） → 标记为 `propValue`，跳过
- 第 3+ 参数（直接字符串） → 标记为 `childrenDirect`，翻译
- 其他嵌套位置 → 标记为 `childrenNested`，P1 审核

### 性能

| 步骤 | 耗时 |
|------|------|
| AST 解析 | 1.60s |
| 遍历 + 分类 | 0.27s |
| 合计 | 1.88s |

---

## 二、Patcher 模块验证

### 结论：核心逻辑可行，但实现方式必须修改

### 问题 1：性能

| 方案 | 耗时（6,316 次替换） | 倍率 |
|------|---------------------|------|
| A: 逐次 slice（蓝图原方案） | 42,867ms | 1x |
| B: 分段拼接（推荐） | **8ms** | **5,701x** |

**原因**：方案 A 每次替换都创建一个新的 13MB 字符串（O(n×m) 复杂度）。方案 B 只遍历一次，将不变片段和翻译片段收集到数组中，最后 `join('')`（O(n+m) 复杂度）。

```javascript
// 方案 B 伪代码
const segments = [];
let lastEnd = 0;
for (const s of sortedByStartAsc) {
  segments.push(code.slice(lastEnd, s.start));  // 不变片段
  segments.push(quoteChar + escaped + quoteChar); // 翻译
  lastEnd = s.end;
}
segments.push(code.slice(lastEnd)); // 尾部
const patched = segments.join('');
```

两种方案的输出**完全一致**，且方案 B 通过了 acorn 语法校验。

### 问题 2：特殊字符转义

测试中将含 `\n` 换行符的翻译直接写入字符串字面量，导致 `Unterminated string constant` 语法错误。

**必须转义的字符**：

| 字符 | 转义为 |
|------|--------|
| `\` | `\\` |
| `"` 或 `'`（匹配原引号） | `\"` 或 `\'` |
| 换行 `\n` | `\\n` |
| 回车 `\r` | `\\r` |
| 制表 `\t` | `\\t` |

### 修订建议

1. patcher 使用**分段拼接**方式，按 start 升序遍历
2. 翻译文本写入前必须经过**完整的转义处理**

---

## 三、Detector 模块验证

### 结论：完全可行

| 检测方法 | 结果 | 推荐度 |
|----------|------|--------|
| `npm config get prefix` → 拼接路径 | ✓ 可靠 | **推荐** |
| `npm root -g` | ✓ 可靠 | 备选 |
| `createRequire` + `require.resolve` | ✓ 可行 | 不推荐（受工作目录影响） |
| `which claude` / `where claude` | ✓ 可用 | 兜底 |

`path.join()` 正确处理 Windows `@` 路径。

---

## 四、Backup/Restore 模块验证

### 结论：完全可行

| 指标 | 结果 |
|------|------|
| 备份耗时 | 4ms |
| 还原耗时 | 4ms |
| SHA-256 完整性校验 | ✓ 一致 |
| 元数据方案（JSON） | ✓ 可行 |
| 磁盘额外占用 | ~13 MB |

### 需要处理的场景

- 重复 patch（已有备份）→ 检测备份 + 版本匹配
- Claude Code 更新后 patch → 旧备份过时，需重新备份

---

## 五、字典匹配策略验证

### 结论：可行，数字需更新

| 指标 | 蓝图原值 | 验证值 |
|------|---------|--------|
| createElement 内总字符串 | 2,440 | 7,338 |
| 真正的 UI 文本（childrenDirect 去重过滤后） | — | ~1,515 |
| 与逻辑判断重叠的文本 | — | 277 |
| 字典预估大小 | — | ~150 KB |

### 重复文本分析

createElement 内同一文本最多出现 842 次（"column"），但这些是 propValue 不需要翻译。childrenDirect 中的重复（如 ":" 出现多次）全部应翻译，按偏移替换可以正确处理。

### 版本容错

字典按 (原文 + 上下文) 匹配的设计正确。版本更新后只要 UI 文本不变就能命中。

---

## 六、端到端全流程验证

### 结论：全流程可行

```
detect(<0.1s) → backup(<0.1s) → extract(1.86s) → patch(0.01s) → validate(1.41s)
总耗时: ~3.4s（使用分段拼接方案）
```

| 步骤 | 耗时 | 结果 |
|------|------|------|
| Detector | <0.1s | ✓ 正确定位 |
| Backup | <0.1s | ✓ 完整备份 |
| Extractor | 1.86s | ✓ 正确提取 |
| Patcher（分段拼接） | ~0.01s | ✓ 正确替换 |
| Validator | 1.41s | ✓ 语法通过 |
| Restore | <0.1s | ✓ 哈希一致 |

---

## 七、风险更新

| 风险 | 蓝图 v0.2 状态 | 验证后状态 |
|------|----------------|-----------|
| 翻译逻辑判断中的字符串 | 已解决 | ✓ 已解决（偏移替换） |
| 误翻译 propValue | **未识别** | **新发现 → 需修订** |
| Patcher 性能 | 未提及 | **新发现 → 已有方案** |
| 翻译特殊字符 | 未提及 | **新发现 → 已有方案** |
| 高频版本更新 | 有方案 | ✓ 方案有效 |
| 写权限不足 | 有方案 | ✓ 方案有效 |
| 语法校验 | 有方案 | ✓ 方案有效 |

---

## 八、对蓝图 v0.2 的修订建议

### 修订 1（高优先级）：缩窄 P0 翻译范围

**原文**：P0 翻译 createElement 调用中的字符串字面量（~2,440 个）

**修订为**：P0 只翻译 createElement **第 3+ 参数（children）位置**的直接字符串字面量（~1,515 个去重后需人工翻译）

extractor 的上下文标签需要从 7 种扩展为包含参数位置信息：

| 上下文标签 | 说明 | P0 处理 |
|-----------|------|---------|
| `ce:componentType` | createElement 第 1 参数 | 跳过 |
| `ce:propValue` | createElement 第 2 参数（props 对象内） | 跳过 |
| `ce:childrenDirect` | createElement 第 3+ 参数直接字符串 | **翻译** |
| `ce:childrenNested` | children 中嵌套的字符串 | 跳过（P1 审核） |
| `comparison` | `===` 等比较 | 跳过 |
| `switchCase` | switch/case | 跳过 |
| `startsWith` | `.startsWith()` 等 | 跳过 |
| `assignment` | 赋值 | 跳过 |
| `argument` | 其他函数参数 | 跳过 |
| `other` | 无法分类 | 跳过 |

### 修订 2（高优先级）：Patcher 实现方式

**原文**：按 (start, end) 偏移从末尾到开头逐个替换

**修订为**：按 start 升序遍历，使用**分段拼接**方式一次性生成补丁文件。性能从 42.9s 降至 8ms。

### 修订 3（中优先级）：翻译文本转义

新增要求：patcher 在写入翻译文本前，必须转义 `\`、引号、`\n`、`\r`、`\t` 等特殊字符，防止语法错误。

### 数据更新

| 指标 | 原值 | 新值 |
|------|------|------|
| createElement 内总字符串 | 2,440 | 7,338 |
| P0 翻译目标（childrenDirect 去重过滤后） | ~2,440 | ~1,515 |
| 全流程耗时 | ~3.5s | ~3.4s（分段拼接后） |
| Claude Code 版本 | 2.1.105 | 2.1.107 |
