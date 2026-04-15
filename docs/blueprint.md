# Claude Code 汉化工具 — 项目蓝图

> 版本：v0.3（基于二次可行性验证修订）  
> 日期：2026-04-14  
> 作者：zhpy

---

## 1. 项目概述

为 Claude Code CLI（npm 包 `@anthropic-ai/claude-code`）提供中文本地化工具，通过 AST 级源码补丁将英文 UI 翻译为中文。

### 1.1 目标用户

中文母语的 Claude Code 使用者。

### 1.2 核心价值

- 降低中文用户的使用门槛
- 不侵入 Claude Code 源码仓库，作为独立工具分发
- 一条命令完成汉化，一条命令还原

### 1.3 基础数据

| 指标 | 值 |
|------|-----|
| 目标文件 | cli.js（13.04 MB，ES module） |
| 总字符串数 | ~137,230 |
| createElement 内总字符串 | ~6,733（含组件名、属性值、children） |
| P0 安全翻译目标 | ~1,471（createElement childrenDirect，去重过滤后） |
| 明确不可翻译 | ~24,467（逻辑判断中）+ ~3,861（组件名/属性值） |
| Claude Code 发版频率 | 平均 1.4 天/版 |
| 补丁全流程耗时 | ~3.4s（detect + backup + extract + patch + validate） |

---

## 2. 技术方案

### 2.1 方案选型：AST 补丁（路线 B）

| 维度 | A: stdout 代理 | **B: AST 补丁（选定）** | C: 正则替换 |
|------|----------------|------------------------|-------------|
| 翻译覆盖度 | 中（仅 stdout） | 高（源码级） | 低（不安全） |
| 运行时开销 | 有 | 零 | 零 |
| 翻译精度 | 低（纯文本匹配） | 高（有 AST 上下文） | 低（重复字符串） |

**选定理由**：

1. AST 层拥有完整上下文信息，可精确区分 UI 文本与内部标识符
2. 补丁后运行时零开销，不影响 Claude Code 性能
3. 重新补丁耗时仅 ~3.5s，可完全自动化
4. acorn 解析已验证可行（完整解析 13.04 MB cli.js，~1.5s，~450MB 内存）

### 2.2 核心设计原则

> 以下三条原则来自可行性分析中发现的硬约束，是本项目的技术底线。

**原则一：只翻译 `createElement` children 位置的字符串**

cli.js 是大型 bundle，混入了大量第三方库字符串。`createElement(type, props, ...children)` 调用中共有约 6,733 个字符串，但只有第 3+ 参数（children）位置的 2,635 个是真实 UI 文本（去重过滤后约 1,471 个）。第 1 参数（组件名如 "div"、"ink-box"）和第 2 参数（属性值如 "column"、"ansi:red"）绝不可翻译。P0 阶段严格限定在 children 直接文本范围内。

**原则二：分段拼接替换，禁止全局文本替换**

同一英文文本可能在 A 处作为 UI 显示、B 处用于 `===`/`startsWith` 逻辑判断。例如：

```javascript
// A 处：createElement children → 可以翻译
createElement("span", null, "Error: something went wrong")

// B 处：逻辑判断 → 绝对不能翻译
if (T.startsWith("Error: ")) { ... }

// C 处：createElement propValue → 也不能翻译
createElement("div", { flexDirection: "column" }, ...)
```

patcher 使用 AST 解析后的精确 `(start, end)` 偏移，按 start 升序排列，采用**分段拼接**方式一次性生成补丁文件（将不变片段与翻译片段收集到数组中，最后 `join('')`）。经验证，此方式替换 6,000+ 个字符串仅需 8ms，而逐次 slice 方式需 43s。

**原则三：字典按原文 + 上下文匹配，而非按偏移位置**

Claude Code 平均 1.4 天发一个版本，代码重排后偏移必然变化。字典按英文原文 + AST 上下文匹配，只要 UI 文本不变就能命中，版本更新时大部分翻译自动生效。

---

## 3. 翻译范围

渐进式策略，以二次可行性验证结论为基础划分优先级：

| 优先级 | 范围 | 筛选标准 | 预估数量 | 阶段 |
|--------|------|----------|----------|------|
| P0 | 核心 UI 文本 | `createElement` 第 3+ 参数（children）中的直接字符串 | ~1,471（去重过滤后） | v0.1 |
| P1 | 扩展 UI 文本 | `createElement` UI prop 值 + children 嵌套文本 + 其他经人工确认的显示文本 | ~289 + ~237 + 待分析 | v0.2 |
| P2 | 模板文本 | 模板字面量中的静态文本片段 | 待分析 | v0.3+ |

### 3.1 P0 范围界定

P0 只处理满足以下全部条件的字符串：

1. 位于 `createElement` 调用的**第 3+ 参数（children）位置**，且为直接字符串字面量
2. 不是 `createElement` 的第 1 参数（组件类型名："div"、"ink-box" 等）
3. 不是 `createElement` 的第 2 参数（props 对象内的属性值："column"、"ansi:red" 等）
4. 内容为人类可读的英文文本（排除单字符、纯符号、CSS 类名模式、URL 等）

**为什么必须区分参数位置**：

```javascript
createElement("ink-text",          // 第1参数：组件名 → 不翻译
  { flexDirection: "column" },     // 第2参数：属性值 → 不翻译
  "Welcome to Claude Code"         // 第3参数：children → 翻译
)
```

验证数据：createElement 内约 6,733 个字符串中，约 3,861 个（57%）是组件名和属性值，翻译它们会直接破坏 UI 渲染。

> **注意**：propValue 中有约 289 个字符串属于 `title`、`subtitle`、`placeholder`、`message` 等用户可见的 prop key，这部分在 P1 阶段按 prop key 白名单翻译。

---

## 4. 分发方式

npm 全局包，与 Claude Code 安装方式保持一致：

```bash
npm install -g claude-code-cn

claude-code-cn patch     # 汉化当前安装的 Claude Code
claude-code-cn restore   # 还原为英文原版
claude-code-cn status    # 查看汉化状态（版本、补丁情况、字典覆盖率）
```

---

## 5. 系统架构

```
claude-code-cn/
├── bin/
│   └── cli.js                 # CLI 入口，命令解析（patch / restore / status）
├── src/
│   ├── detector.js            # 检测 Claude Code 安装路径和版本
│   ├── extractor.js           # AST 解析 cli.js，提取字符串（带上下文标签）
│   ├── patcher.js             # 按 AST 偏移定点替换，写回文件
│   ├── backup.js              # 备份/还原管理
│   └── validator.js           # 补丁后语法校验（acorn 重新解析）
├── dict/
│   └── zh-CN.json             # 翻译字典（带上下文，见 5.3）
├── tests/
├── docs/
│   ├── blueprint.md           # 本文件
│   └── feasibility-report.md  # 可行性分析报告
└── package.json
```

### 5.1 模块职责

| 模块 | 输入 | 输出 | 职责 |
|------|------|------|------|
| `detector` | 无 | `{ path, version }` | 定位 cli.js 路径，读取 package.json 中的版本 |
| `extractor` | cli.js 路径 | 字符串列表（含上下文标签） | acorn 解析，遍历 AST，提取字符串并标注上下文 |
| `patcher` | 字符串列表 + 翻译字典 | 补丁后的 cli.js | 按 start 升序**分段拼接**生成补丁文件 |
| `backup` | cli.js 路径 | 备份文件 | 补丁前备份原文件，支持还原 |
| `validator` | 补丁后的 cli.js | 通过/失败 | acorn 重新解析，确认语法完整 |

### 5.2 核心工作流：patch 命令

```
claude-code-cn patch
│
├─ 1. detector
│     定位 cli.js 路径 + 读取版本号
│
├─ 2. backup
│     备份原始 cli.js → cli.js.backup
│     记录版本号和备份时间
│
├─ 3. extractor
│     acorn 解析 cli.js
│     遍历 AST，识别 createElement 调用
│     区分参数位置：componentType / propValue / childrenDirect / childrenNested
│     输出: [{ value, start, end, context }, ...]
│
├─ 4. patcher
│     加载 zh-CN.json 字典
│     按 (原文 + 上下文) 匹配翻译
│     翻译文本转义处理（\ " ' \n \r \t）
│     按 start 升序分段拼接，一次性生成补丁文件
│     写入补丁后的文件
│
├─ 5. validator
│     acorn 重新解析补丁后的文件
│     失败则自动还原备份
│
└─ 6. 输出统计
      已翻译 / 总计 / 未匹配 / 耗时
```

### 5.3 翻译字典格式

字典不是简单的 `{ "english": "中文" }` 映射。每条翻译携带上下文信息，用于精确匹配和版本容错：

```json
{
  "version": "0.1.0",
  "entries": [
    {
      "original": "Select model",
      "translation": "选择模型",
      "context": "ce:childrenDirect"
    },
    {
      "original": "Welcome to Claude Code",
      "translation": "欢迎使用 Claude Code",
      "context": "ce:childrenDirect"
    }
  ]
}
```

**字段说明**：

| 字段 | 用途 |
|------|------|
| `original` | 英文原文，用于匹配提取到的字符串 |
| `translation` | 中文翻译（不含引号和转义，patcher 负责转义处理） |
| `context` | AST 上下文标签（含参数位置），确保只替换指定上下文中的该字符串 |

**匹配规则**：extractor 提取的字符串需要同时满足 `original` 和 `context` 才命中翻译。这保证了同一英文文本在不同 AST 位置不会被错误翻译。

### 5.4 Patcher 转义规则

patcher 在将翻译文本写入源码前，必须对以下字符进行转义：

| 原字符 | 转义为 | 原因 |
|--------|--------|------|
| `\` | `\\` | 反斜杠是转义前缀 |
| `"` 或 `'` | `\"` 或 `\'` | 匹配原字符串的引号类型 |
| 换行 `\n` | `\\n` | 防止 Unterminated string |
| 回车 `\r` | `\\r` | 防止 Unterminated string |
| 制表 `\t` | `\\t` | 保持格式一致 |

此规则已通过验证：含特殊字符的翻译文本替换后，acorn 语法校验通过。

### 5.5 Extractor 上下文标签

extractor 遍历 AST 时为每个字符串标注上下文标签。createElement 内部进一步区分参数位置：

| 上下文标签 | 说明 | 数量 | P0 处理 |
|-----------|------|------|---------|
| `ce:childrenDirect` | createElement 第 3+ 参数的直接字符串 | ~2,635 | **翻译** |
| `ce:childrenNested` | createElement children 中嵌套的字符串 | ~237 | 跳过（P1 审核） |
| `ce:propValue` | createElement 第 2 参数 props 对象内的值 | ~3,837 | 跳过（P1 按 prop key 白名单翻译，见下注） |
| `ce:componentType` | createElement 第 1 参数组件类型名 | ~24 | 跳过 |
| `comparison` | `===`、`!==` 等比较操作中 | ~16,325 | 跳过 |
| `switchCase` | switch/case 的判断值 | ~5,980 | 跳过 |
| `startsWith` | `.startsWith()`/`.endsWith()`/`.includes()` 参数 | ~2,162 | 跳过 |
| `assignment` | 变量赋值右值 | ~52,174 | 跳过（P1 逐个审核） |
| `argument` | 其他函数调用参数 | ~43,496 | 跳过（P1 逐个审核） |
| `other` | 无法分类 | ~5,060 | 跳过 |

> **propValue 中的 UI 文本**：约 289 个 propValue 字符串属于用户可见的 prop key（`title` 108 个、`description` 132 个、`subtitle` 54 个、`placeholder` 22 个、`message` 13 个等）。P1 阶段 extractor 需要进一步识别 prop key 名称，对白名单内的 key 值也进行翻译。

---

## 6. 版本更新策略

Claude Code 平均 1.4 天发布一个版本（374 个历史版本，最短间隔 5 小时）。这是本项目最大的维护挑战。

### 6.1 自动容错机制

```
用户更新 Claude Code 后执行 claude-code-cn patch
│
├─ extractor 重新解析新版 cli.js，提取字符串 + 偏移
│
├─ 字典按 (原文 + 上下文) 匹配
│   ├─ 命中 → 使用新偏移替换（偏移变了但原文没变，自动适配）
│   ├─ 未命中 → 保持英文原文，不影响功能
│   └─ 新增 → 报告"N 个新字符串待翻译"
│
└─ 输出匹配率统计，供维护者判断是否需要更新字典
```

### 6.2 字典维护工具

`claude-code-cn extract` 命令（辅助工具，面向维护者）：

- 提取当前版本的所有 createElement children 字符串
- 与现有字典对比，输出新增/删除/变更列表
- 辅助生成字典更新的 diff

---

## 7. 跨平台兼容

| 平台 | 潜在问题 | 应对 |
|------|----------|------|
| Windows | `@` 在路径中；部分安装位置可能需管理员权限 | `path.join()` 统一路径处理；写入前权限检查 |
| macOS | Homebrew 安装的 Node.js 可能需 `sudo` | 权限不足时给出明确提示 |
| Linux | 全局 node_modules 通常在 `/usr/lib/` 下 | 权限不足时给出明确提示 |

---

## 8. 风险矩阵

| 风险 | 严重度 | 可能性 | 应对方案 | 状态 |
|------|--------|--------|----------|------|
| 翻译逻辑判断中的字符串导致功能异常 | **高** | 低 | P0 仅翻译 ce:childrenDirect，按偏移定点替换 | 已解决 |
| 误翻译 createElement 的组件名或属性值 | **高** | 低 | extractor 区分参数位置，propValue/componentType 标记为跳过 | 已解决 |
| 翻译文本含特殊字符导致语法错误 | **高** | 中 | patcher 强制转义 `\ " ' \n \r \t` | 已解决 |
| 高频版本更新导致补丁失效 | 中 | **高** | 字典按原文+上下文匹配，自动适配新偏移 | 有方案 |
| 全局 node_modules 写权限不足 | 中 | 中 | 写入前权限检查 + 明确提示 | 有方案 |
| bundle 中第三方库字符串被误翻译 | 中 | 低 | createElement children 过滤天然排除第三方代码 | 已解决 |
| 补丁后 cli.js 语法错误 | **高** | 低 | 补丁后 acorn 强制校验，失败自动还原 | 有方案 |
| 终端宽度导致 UI 错位 | 低 | 低 | Ink 的 string-width 已正确处理全角字符 | 已解决 |

---

## 9. 实施计划

### Phase 1：项目骨架（v0.1-alpha）

- [ ] 初始化 npm 项目，配置 package.json / ESLint / 测试框架
- [ ] 实现 `detector` 模块（定位 cli.js + 读取版本）
- [ ] 实现 `backup` 模块（备份/还原）
- [ ] 实现 `extractor` 模块（AST 解析 + createElement 参数位置识别 + 上下文标签）
- [ ] 实现 `patcher` 模块（分段拼接替换 + 特殊字符转义）
- [ ] 实现 `validator` 模块（补丁后语法校验）
- [ ] CLI 入口：patch / restore / status 命令

### Phase 2：翻译与验证（v0.1-beta）

- [ ] 提取当前版本全部 createElement children 字符串
- [ ] 建立 zh-CN.json 字典（P0 核心 UI 翻译）
- [ ] 端到端测试：patch → 运行 Claude Code → 验证中文显示 → restore
- [ ] 边界场景测试：权限不足、版本不匹配、重复 patch 等

### Phase 3：发布（v0.1）

- [ ] npm 包配置与发布
- [ ] README 文档
- [ ] 版本更新测试：模拟 Claude Code 升级后重新 patch

---

> **注意**：本蓝图已转为正式技术设计文档，实现阶段请参考 [`docs/design.md`](design.md)。
