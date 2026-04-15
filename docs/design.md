# claude-code-cn — 技术设计文档

| 项目 | 值 |
|------|-----|
| 文档版本 | 1.0 |
| 日期 | 2026-04-14 |
| 作者 | zhpy |
| 状态 | 已通过可行性验证（50/50），待实现 |

## 修订记录

| 版本 | 日期 | 变更说明 |
|------|------|----------|
| 0.1 | 2026-04-14 | 初始蓝图 |
| 0.2 | 2026-04-14 | 纳入可行性分析：createElement 边界、偏移替换、上下文字典 |
| 0.3 | 2026-04-14 | 二次验证修订：children 位置区分、分段拼接、转义规则 |
| 1.0 | 2026-04-14 | 转为正式技术设计文档，补充 API 签名、类型定义、错误处理、测试策略 |

---

## 1 引言

### 1.1 目的

本文档是 `claude-code-cn` 项目的技术设计规格说明，作为实现阶段的唯一权威参考。文档定义了系统架构、模块接口、数据结构、算法规格、错误处理策略及测试标准。

### 1.2 范围

`claude-code-cn` 是一个 npm 全局命令行工具，通过 AST 级源码补丁将 Claude Code CLI 的英文界面翻译为中文。

本文档覆盖 v0.1（P0 阶段）的完整设计。P1/P2 阶段的扩展设计不在本文档范围内，但会在相关章节标注扩展点。

### 1.3 术语表

| 术语 | 定义 |
|------|------|
| Claude Code | Anthropic 官方 CLI 工具，npm 包名 `@anthropic-ai/claude-code` |
| cli.js | Claude Code 的主入口文件，单文件 bundle（~13 MB） |
| AST | 抽象语法树（Abstract Syntax Tree） |
| createElement | React 的 DOM 元素创建函数，`createElement(type, props, ...children)` |
| childrenDirect | createElement 第 3+ 参数位置的直接字符串字面量，是 P0 的翻译目标 |
| 分段拼接 | 按偏移升序遍历，将不变片段与翻译片段收集到数组中最后 `join('')` 的替换算法 |
| 上下文标签 | extractor 为每个字符串标注的 AST 位置分类（如 `ce:childrenDirect`、`comparison`） |

### 1.4 参考文档

| 文档 | 路径 |
|------|------|
| 可行性分析报告 v1 | `docs/feasibility-report.md` |
| 可行性验证报告 v2 | `docs/feasibility-report-v2.md` |
| 全量验证脚本（50 项） | `feasibility/v3-final-verify.js` |

---

## 2 需求

### 2.1 功能需求

| ID | 需求 | 优先级 | 验收标准 |
|----|------|--------|----------|
| FR-01 | 一条命令完成中文汉化 | P0 | `claude-code-cn patch` 执行成功后，Claude Code 界面显示中文 |
| FR-02 | 一条命令还原英文 | P0 | `claude-code-cn restore` 执行成功后，Claude Code 恢复英文原版且 SHA-256 与原文件一致 |
| FR-03 | 查看当前汉化状态 | P0 | `claude-code-cn status` 输出版本号、是否已汉化、字典覆盖率 |
| FR-04 | 提取可翻译字符串（面向维护者） | P0 | `claude-code-cn extract` 输出当前版本的全部 childrenDirect 字符串及与字典的 diff |
| FR-05 | Claude Code 更新后重新汉化 | P0 | 用户更新 Claude Code 后再次执行 `patch`，自动适配新版本 |
| FR-06 | 补丁失败自动还原 | P0 | 语法校验失败时自动恢复备份，不留损坏文件 |

### 2.2 非功能需求

| ID | 需求 | 指标 |
|----|------|------|
| NFR-01 | 补丁全流程耗时 | < 10s（核心计算 < 4s） |
| NFR-02 | 运行时性能影响 | 零（静态补丁，不引入运行时代码） |
| NFR-03 | 跨平台支持 | Windows / macOS / Linux |
| NFR-04 | Node.js 兼容性 | >= 18.0.0（Claude Code 自身的最低要求） |
| NFR-05 | 安全性 | 不执行任意代码，不联网，不收集数据 |
| NFR-06 | 补丁后语法正确 | acorn 重新解析通过，零语法错误 |

---

## 3 系统架构

### 3.1 目录结构

```
claude-code-cn/
├── bin/
│   └── cli.js                 # CLI 入口
├── src/
│   ├── detector.js            # Claude Code 安装检测
│   ├── extractor.js           # AST 字符串提取 + 上下文分类
│   ├── patcher.js             # 分段拼接替换引擎
│   ├── backup.js              # 备份 / 还原管理
│   └── validator.js           # 补丁后语法校验
├── dict/
│   └── zh-CN.json             # 中文翻译字典
├── tests/
│   ├── detector.test.js
│   ├── extractor.test.js
│   ├── patcher.test.js
│   ├── backup.test.js
│   ├── validator.test.js
│   └── e2e.test.js
├── docs/
│   └── design.md              # 本文档
└── package.json
```

### 3.2 模块依赖关系

```
bin/cli.js
  │
  ├── patch 命令 ──→ detector → backup → extractor → patcher → validator
  │
  ├── restore 命令 ──→ detector → backup.restore()
  │
  ├── status 命令 ──→ detector → backup.status()
  │
  └── extract 命令 ──→ detector → extractor → diff(字典)
```

所有模块之间为**单向依赖**，无循环引用。CLI 入口是唯一的编排层。

### 3.3 外部依赖

| 包 | 版本 | 用途 | 大小 |
|----|------|------|------|
| `acorn` | ^8.x | ESM JavaScript 解析器 | ~130 KB |
| `acorn-walk` | ^8.x | AST 遍历工具 | ~10 KB |

不使用其他第三方依赖。CLI 参数解析使用 Node.js 内置 `process.argv` 手动解析（命令简单，无需引入 commander/yargs）。

---

## 4 详细设计

### 4.1 类型定义

以下类型定义使用 JSDoc 注释语法，供各模块共用。

```javascript
/**
 * @typedef {Object} DetectResult
 * @property {string} cliPath     - cli.js 的绝对路径
 * @property {string} pkgPath     - package.json 的绝对路径
 * @property {string} version     - Claude Code 版本号（如 "2.1.107"）
 * @property {string} installDir  - Claude Code 安装目录
 */

/**
 * @typedef {'ce:childrenDirect'|'ce:childrenNested'|'ce:propValue'|'ce:componentType'
 *          |'comparison'|'switchCase'|'startsWith'|'assignment'|'argument'|'other'} ContextTag
 */

/**
 * @typedef {Object} ExtractedString
 * @property {string}     value   - 字符串内容（不含引号）
 * @property {number}     start   - 在源码中的起始偏移（含引号）
 * @property {number}     end     - 在源码中的结束偏移（含引号）
 * @property {ContextTag} context - AST 上下文标签
 */

/**
 * @typedef {Object} DictEntry
 * @property {string}     original    - 英文原文
 * @property {string}     translation - 中文翻译（纯文本，不含引号和转义）
 * @property {ContextTag} context     - 匹配的上下文标签
 */

/**
 * @typedef {Object} Dict
 * @property {string}      version - 字典版本
 * @property {DictEntry[]} entries - 翻译条目
 */

/**
 * @typedef {Object} PatchResult
 * @property {boolean} success     - 是否成功
 * @property {number}  translated  - 已翻译的字符串数量
 * @property {number}  total       - childrenDirect 总数
 * @property {number}  unmatched   - 未匹配（字典中无对应翻译）的数量
 * @property {number}  elapsed     - 全流程耗时（毫秒）
 */

/**
 * @typedef {Object} BackupMeta
 * @property {string} version    - 备份时的 Claude Code 版本
 * @property {string} hash       - 原始 cli.js 的 SHA-256
 * @property {string} time       - 备份时间（ISO 8601）
 * @property {string} cliPath    - cli.js 路径
 * @property {string} dictVersion - 使用的字典版本
 */
```

### 4.2 detector 模块

**职责**：定位 Claude Code 的安装路径和版本号。

```javascript
// src/detector.js

/**
 * 检测 Claude Code 安装信息。
 *
 * 检测策略（按优先级）：
 *   1. npm config get prefix → 拼接 node_modules/@anthropic-ai/claude-code
 *   2. npm root -g → 拼接 @anthropic-ai/claude-code
 *   3. 抛出 DetectError
 *
 * @returns {Promise<DetectResult>}
 * @throws {DetectError} 未找到 Claude Code 安装
 */
export async function detect() {}
```

**算法**：

1. 执行 `npm config get prefix`，获取全局 npm 前缀路径
2. 拼接 `<prefix>/node_modules/@anthropic-ai/claude-code/cli.js`，检查文件存在性
3. 读取同目录下 `package.json`，提取 `version` 字段
4. 如方法 1 失败，回退到 `npm root -g`
5. 全部失败则抛出 `DetectError`

**错误**：

| 错误 | 触发条件 | 用户提示 |
|------|----------|----------|
| `DetectError: NOT_INSTALLED` | 两种检测方式均未找到 cli.js | "未找到 Claude Code，请先运行 npm install -g @anthropic-ai/claude-code" |
| `DetectError: NO_PACKAGE_JSON` | 找到 cli.js 但无 package.json | "Claude Code 安装可能已损坏，请重新安装" |

### 4.3 backup 模块

**职责**：补丁前备份原始文件，支持还原和状态查询。

```javascript
// src/backup.js

/**
 * 备份 cli.js 到同目录下 cli.js.backup，并写入元数据文件。
 *
 * @param {DetectResult} info - detector 的输出
 * @returns {Promise<BackupMeta>}
 * @throws {BackupError} 写权限不足或磁盘空间不足
 */
export async function create(info) {}

/**
 * 从备份还原 cli.js，并删除备份文件和元数据。
 *
 * @param {DetectResult} info
 * @returns {Promise<void>}
 * @throws {BackupError} 备份文件不存在或哈希校验失败
 */
export async function restore(info) {}

/**
 * 查询当前备份状态。
 *
 * @param {DetectResult} info
 * @returns {Promise<{exists: boolean, meta: BackupMeta|null, versionMatch: boolean}>}
 */
export async function status(info) {}
```

**文件布局**：

```
@anthropic-ai/claude-code/
├── cli.js              # 原始文件或补丁后文件
├── cli.js.backup       # 原始文件的完整备份
└── cli.js.backup.meta  # JSON 格式的备份元数据
```

**备份元数据格式**（`cli.js.backup.meta`）：

```json
{
  "version": "2.1.107",
  "hash": "6f6f6b97ede3d13f...",
  "time": "2026-04-14T07:33:45.592Z",
  "cliPath": "/path/to/cli.js",
  "dictVersion": "0.1.0"
}
```

**状态机**：

```
          patch
[原始] ──────────→ [已补丁]
  ↑                    │
  │      restore       │
  └────────────────────┘
```

**边界场景处理**：

| 场景 | 行为 |
|------|------|
| 已有备份，再次 patch | 检查备份版本 — 版本匹配则提示已汉化，版本不匹配则提示先 restore |
| 备份存在但 cli.js 被外部修改 | 比较当前 cli.js 的 hash 与备份 hash，不一致时警告 |
| 备份文件被手动删除 | status 报告无备份，patch 正常执行 |
| 写入权限不足 | 抛出 BackupError，提示用管理员/sudo 运行 |

### 4.4 extractor 模块

**职责**：AST 解析 cli.js，提取字符串并标注上下文标签。

```javascript
// src/extractor.js

/**
 * 解析 cli.js 并提取所有字符串字面量，标注 AST 上下文。
 *
 * @param {string} code - cli.js 源码内容
 * @returns {ExtractedString[]} 全部字符串（含所有上下文标签）
 */
export function extract(code) {}

/**
 * 从全部字符串中筛选 P0 翻译候选（ce:childrenDirect，排除噪声）。
 *
 * @param {ExtractedString[]} strings - extract() 的输出
 * @returns {ExtractedString[]}
 */
export function filterP0(strings) {}
```

**上下文分类算法**：

使用 `acorn-walk.ancestor()` 遍历 AST。对每个 `Literal`（`typeof value === 'string'`），从最近祖先开始向上查找，按以下优先级命中第一个匹配的上下文：

```
for ancestor in ancestors (从近到远):
  if ancestor 是 createElement 调用:
    if node 在第 1 参数范围内 → ce:componentType
    if node 在第 2 参数（ObjectExpression）范围内 → ce:propValue
    if node 是第 3+ 参数的直接子节点 → ce:childrenDirect
    else → ce:childrenNested
    return

  if ancestor 是 BinaryExpression (===, !==, ==, !=) → comparison; return
  if ancestor 是 SwitchCase → switchCase; return
  if ancestor 是 startsWith/endsWith/includes 调用 → startsWith; return
  if ancestor 是 AssignmentExpression 或 VariableDeclarator → assignment; return
  if ancestor 是 CallExpression（非 createElement） → argument; return

→ other
```

**createElement 参数位置判定规则**：

```javascript
// createElement(type, props, ...children)
const args = callExpression.arguments;

// 第 1 参数：组件类型
if (args[0] && node.start >= args[0].start && node.end <= args[0].end)
  → ce:componentType

// 第 2 参数：props（仅当为 ObjectExpression 时）
if (args[1]?.type === 'ObjectExpression'
    && node.start >= args[1].start && node.end <= args[1].end)
  → ce:propValue

// 第 3+ 参数：children
for (let j = 2; j < args.length; j++):
  if (args[j] === node) → ce:childrenDirect  // 直接子节点
  if (node 在 args[j] 范围内) → ce:childrenNested  // 嵌套
```

**P0 噪声过滤规则**（`filterP0`）：

| 过滤条件 | 说明 |
|----------|------|
| `value.length <= 1` | 单字符 |
| `/^[^a-zA-Z]*$/.test(value)` | 纯符号（":", "(", "→" 等） |
| `/^[a-z][\w-]*$/.test(value)` 且含 `-` 或 `_` | CSS 类名模式 |
| `/^https?:\/\//.test(value)` | URL |
| `/^[a-z_]+$/.test(value)` | 纯小写标识符 |

**性能基准**：

| 步骤 | 耗时 |
|------|------|
| acorn 解析 | ~1.5s |
| ancestor 遍历 + 分类 | ~0.3s |
| 合计 | ~1.8s |

### 4.5 patcher 模块

**职责**：将翻译字典应用到 cli.js 源码，生成补丁后的文件内容。

```javascript
// src/patcher.js

/**
 * 根据翻译字典生成补丁后的源码。
 *
 * @param {string}            code    - 原始 cli.js 源码
 * @param {ExtractedString[]} strings - extractor 提取的字符串列表
 * @param {Dict}              dict    - 翻译字典
 * @returns {{patched: string, stats: {translated: number, unmatched: number}}}
 */
export function patch(code, strings, dict) {}
```

**算法：分段拼接**

```
输入: code（原始源码）, replacements（按 start 升序排列的 [{start, end, translation}]）
输出: 补丁后的源码

segments = []
lastEnd = 0

for each r in replacements:
    segments.push(code.slice(lastEnd, r.start))    // 不变片段
    quoteChar = code[r.start]                       // 保留原引号类型
    escaped = escape(r.translation, quoteChar)
    segments.push(quoteChar + escaped + quoteChar)  // 翻译片段
    lastEnd = r.end

segments.push(code.slice(lastEnd))                  // 尾部不变片段
return segments.join('')
```

**复杂度**：O(n + m)，n = 替换数量，m = 文件大小。单次遍历，无重复分配。

**字典匹配规则**：

```
对每个 ExtractedString s:
    在 dict.entries 中查找满足以下条件的条目 e:
        e.original === s.value  且  e.context === s.context
    如命中 → 使用 e.translation 替换
    如未命中 → 跳过（保持英文）
```

**转义函数**：

```javascript
/**
 * 将翻译文本转义为可安全嵌入 JS 字符串字面量的形式。
 *
 * @param {string} text      - 翻译文本（纯文本）
 * @param {string} quoteChar - 原字符串的引号字符（" 或 '）
 * @returns {string} 转义后的文本
 */
export function escapeForQuote(text, quoteChar) {
  let escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');

  if (quoteChar === "'") {
    escaped = escaped.replace(/'/g, "\\'");
  } else {
    escaped = escaped.replace(/"/g, '\\"');
  }

  return escaped;
}
```

**性能基准**：

| 替换数量 | 耗时 |
|----------|------|
| 992 | 5.9ms |
| 6,316 | 8ms |

### 4.6 validator 模块

**职责**：验证补丁后的源码语法正确性。

```javascript
// src/validator.js

/**
 * 使用 acorn 重新解析补丁后的代码，确认语法完整。
 *
 * @param {string} code - 补丁后的源码
 * @returns {{valid: boolean, error: string|null}}
 */
export function validate(code) {}
```

**实现**：

```javascript
try {
  parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  return { valid: true, error: null };
} catch (e) {
  return { valid: false, error: e.message };
}
```

**性能基准**：~1.4s

### 4.7 CLI 入口

**职责**：解析命令行参数，编排各模块执行。

```javascript
// bin/cli.js
#!/usr/bin/env node
```

**命令规格**：

```
用法: claude-code-cn <command>

命令:
  patch     汉化当前安装的 Claude Code
  restore   还原为英文原版
  status    查看汉化状态
  extract   提取可翻译字符串（面向维护者）

选项:
  --help    显示帮助信息
  --version 显示版本号
```

**patch 命令编排流程**：

```javascript
async function commandPatch() {
  const t0 = performance.now();

  // 1. 检测
  const info = await detect();
  log(`检测到 Claude Code v${info.version}`);

  // 2. 备份状态检查
  const backupStatus = await backup.status(info);
  if (backupStatus.exists && backupStatus.versionMatch) {
    error('当前版本已汉化。如需重新汉化，请先执行 restore');
    return;
  }
  if (backupStatus.exists && !backupStatus.versionMatch) {
    log('检测到旧版本备份，正在清理...');
    await backup.restore(info);
  }

  // 3. 备份
  await backup.create(info);
  log('已备份原始文件');

  // 4. 提取
  const code = readFileSync(info.cliPath, 'utf-8');
  const allStrings = extract(code);
  const candidates = filterP0(allStrings);
  log(`提取到 ${candidates.length} 个可翻译字符串`);

  // 5. 补丁
  const dict = loadDict();
  const { patched, stats } = patch(code, candidates, dict);
  log(`已翻译 ${stats.translated} 个，未匹配 ${stats.unmatched} 个`);

  // 6. 校验
  const result = validate(patched);
  if (!result.valid) {
    error(`语法校验失败: ${result.error}`);
    await backup.restore(info);
    error('已自动还原备份');
    return;
  }

  // 7. 写入
  writeFileSync(info.cliPath, patched);
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  log(`汉化完成（${stats.translated}/${candidates.length}，${elapsed}s）`);
}
```

**restore 命令**：

```javascript
async function commandRestore() {
  const info = await detect();
  const st = await backup.status(info);
  if (!st.exists) {
    error('未找到备份，当前可能已是英文原版');
    return;
  }
  await backup.restore(info);
  log('已还原为英文原版');
}
```

**status 命令**：

```javascript
async function commandStatus() {
  const info = await detect();
  const st = await backup.status(info);

  log(`Claude Code 版本: ${info.version}`);
  log(`安装路径: ${info.cliPath}`);
  if (st.exists) {
    log(`汉化状态: 已汉化（字典版本 ${st.meta.dictVersion}）`);
    log(`备份时间: ${st.meta.time}`);
    log(`版本匹配: ${st.versionMatch ? '是' : '否（Claude Code 已更新，建议重新 patch）'}`);
  } else {
    log('汉化状态: 未汉化');
  }
}
```

**退出码**：

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | Claude Code 未安装 |
| 2 | 权限不足 |
| 3 | 补丁语法校验失败（已自动还原） |
| 4 | 备份/还原失败 |

---

## 5 数据结构

### 5.1 翻译字典（zh-CN.json）

```json
{
  "version": "0.1.0",
  "entries": [
    {
      "original": "Welcome to Claude Code for ",
      "translation": "欢迎使用 Claude Code ",
      "context": "ce:childrenDirect"
    },
    {
      "original": "Press ",
      "translation": "按 ",
      "context": "ce:childrenDirect"
    },
    {
      "original": " again to exit",
      "translation": " 再次退出",
      "context": "ce:childrenDirect"
    }
  ]
}
```

**约束**：

- `entries` 中不允许存在 `original + context` 相同的重复条目
- `translation` 中不包含引号和转义序列（由 patcher 负责转义）
- P0 阶段所有 `context` 值均为 `"ce:childrenDirect"`

**字典规模预估**（P0）：

| 指标 | 值 |
|------|-----|
| 条目数 | ~1,471（去重过滤后的 childrenDirect） |
| 文件大小 | ~150 KB |

### 5.2 备份元数据（cli.js.backup.meta）

见 §4.3 BackupMeta 类型定义。

### 5.3 Extractor 上下文标签枚举

| 标签 | 数量 | 含义 | P0 行为 |
|------|------|------|---------|
| `ce:childrenDirect` | ~2,635 | createElement children 直接字符串 | **翻译** |
| `ce:childrenNested` | ~237 | createElement children 嵌套字符串 | 跳过 |
| `ce:propValue` | ~3,837 | createElement props 属性值 | 跳过 |
| `ce:componentType` | ~24 | createElement 组件类型名 | 跳过 |
| `comparison` | ~16,325 | `===`/`!==` 比较 | 跳过 |
| `switchCase` | ~5,980 | switch/case 值 | 跳过 |
| `startsWith` | ~2,162 | `.startsWith()`/`.endsWith()`/`.includes()` | 跳过 |
| `assignment` | ~52,174 | 赋值右值 | 跳过 |
| `argument` | ~43,496 | 其他函数调用参数 | 跳过 |
| `other` | ~5,060 | 无法分类 | 跳过 |

> 数量基于 Claude Code v2.1.107。数字会随版本变化，使用 `~` 标注为近似值。

---

## 6 错误处理

### 6.1 错误类层次

```javascript
// 基类
class ClaudeCodeCnError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class DetectError extends ClaudeCodeCnError {}   // 检测失败
class BackupError extends ClaudeCodeCnError {}   // 备份/还原失败
class PatchError extends ClaudeCodeCnError {}    // 补丁失败
class ValidateError extends ClaudeCodeCnError {} // 校验失败
```

### 6.2 错误码与用户提示

| 错误码 | 类 | 场景 | 用户提示 |
|--------|-----|------|----------|
| `NOT_INSTALLED` | DetectError | 未找到 Claude Code | "未找到 Claude Code。请先执行：npm install -g @anthropic-ai/claude-code" |
| `NO_PERMISSION` | BackupError | 无写入权限 | "无写入权限。请使用管理员权限运行，或在 macOS/Linux 下使用 sudo" |
| `BACKUP_NOT_FOUND` | BackupError | 还原时无备份 | "未找到备份文件，当前可能已是英文原版" |
| `ALREADY_PATCHED` | PatchError | 重复补丁 | "当前版本已汉化。如需重新汉化，请先执行：claude-code-cn restore" |
| `VALIDATION_FAILED` | ValidateError | 补丁后语法错误 | "补丁后语法校验失败，已自动还原备份。请报告此问题。" |
| `HASH_MISMATCH` | BackupError | 还原时哈希不一致 | "备份文件可能已损坏。建议重新安装 Claude Code" |

### 6.3 致命错误恢复策略

补丁流程中任何步骤失败，执行以下恢复：

```
补丁流程出错
  │
  ├── 如果已创建备份 → 自动还原备份
  ├── 如果尚未创建备份 → 原文件未被修改，无需恢复
  │
  └── 输出错误信息 + 退出码
```

---

## 7 跨平台兼容

### 7.1 路径处理

全部使用 `node:path` 模块的 `path.join()` 拼接路径。不使用硬编码的 `/` 或 `\`。

### 7.2 权限检测

在 `backup.create()` 之前执行写权限预检：

```javascript
import { accessSync, constants } from 'fs';

function checkWritePermission(filePath) {
  try {
    accessSync(filePath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
```

### 7.3 平台特殊处理

| 平台 | 问题 | 处理 |
|------|------|------|
| Windows | `@` 在路径中 | `path.join()` 自动处理 |
| Windows | 需要管理员权限 | 检测 `EACCES`/`EPERM` 错误码，提示用管理员运行 |
| macOS/Linux | 需要 sudo | 检测 `EACCES` 错误码，提示使用 sudo |

---

## 8 测试策略

### 8.1 测试框架

使用 Node.js 内置 `node:test` 模块（Node.js >= 18），零外部依赖。

### 8.2 单元测试

#### detector.test.js

| 测试用例 | 输入 | 期望输出 |
|----------|------|----------|
| 正常检测 | 系统已安装 Claude Code | 返回 `{cliPath, version}` |
| 未安装 | 系统未安装 Claude Code | 抛出 `DetectError: NOT_INSTALLED` |

#### extractor.test.js

| 测试用例 | 输入 | 期望输出 |
|----------|------|----------|
| childrenDirect 提取 | `createElement("span", null, "hello")` | `[{value:"hello", context:"ce:childrenDirect"}]` |
| componentType 排除 | `createElement("div", null)` | `[{value:"div", context:"ce:componentType"}]` |
| propValue 排除 | `createElement("div", {x:"col"})` | `[{value:"col", context:"ce:propValue"}]` |
| childrenNested 识别 | `createElement("div", null, createElement("span", null, "hi"))` | "hi" 标记为 `ce:childrenDirect`（因为是内层 createElement 的直接 children） |
| comparison 排除 | `x === "test"` | `[{value:"test", context:"comparison"}]` |
| switchCase 排除 | `case "foo":` | `[{value:"foo", context:"switchCase"}]` |
| startsWith 排除 | `s.startsWith("Error")` | `[{value:"Error", context:"startsWith"}]` |
| P0 过滤：单字符 | `createElement("s", null, "x")` | filterP0 结果不含 "x" |
| P0 过滤：纯符号 | `createElement("s", null, "→")` | filterP0 结果不含 "→" |
| P0 过滤：URL | `createElement("s", null, "https://example.com")` | filterP0 结果不含此 URL |
| 真实 cli.js 解析 | 实际 cli.js 文件 | childrenDirect >= 2000 个，componentType 全为小写标识符 |
| 偏移精度 | 任意 5 个结果 | `code.slice(start+1, end-1) === value` |

#### patcher.test.js

| 测试用例 | 输入 | 期望输出 |
|----------|------|----------|
| 基础替换 | `"hello"` → `"你好"` | 源码中 `"hello"` 变为 `"你好"` |
| 保留引号类型 | 原文用 `'hello'` | 替换后为 `'你好'`（单引号） |
| 转义双引号 | 翻译含 `"` | 源码中为 `\"` |
| 转义单引号 | 翻译含 `'`，原文用单引号 | 源码中为 `\'` |
| 转义反斜杠 | 翻译含 `\` | 源码中为 `\\` |
| 转义换行 | 翻译含 `\n` | 源码中为 `\\n` |
| 转义回车 | 翻译含 `\r` | 源码中为 `\\r` |
| 转义制表 | 翻译含 `\t` | 源码中为 `\\t` |
| 空字典 | 无匹配 | 输出 === 输入 |
| 上下文隔离 | 同一文本在 childrenDirect 和 comparison 中 | 只翻译 childrenDirect 位置 |
| 大批量替换 | 1000 个替换 | 耗时 < 100ms，acorn 校验通过 |
| 无重叠偏移 | 任意替换列表 | 无相邻替换的 start < 前一个的 end |

#### backup.test.js

| 测试用例 | 输入 | 期望输出 |
|----------|------|----------|
| 创建备份 | 正常文件 | 备份文件 + 元数据 存在 |
| SHA-256 一致 | 备份后对比 | hash 完全匹配 |
| 还原 | 已有备份 | 还原后 hash 与原始一致，备份文件被删除 |
| 无备份时还原 | 无备份文件 | 抛出 BackupError |
| 重复备份 | 已有备份 | 抛出 PatchError: ALREADY_PATCHED |
| 版本不匹配 | 备份版本与当前不同 | status 返回 `versionMatch: false` |
| 权限不足 | 只读目录 | 抛出 BackupError: NO_PERMISSION |

#### validator.test.js

| 测试用例 | 输入 | 期望输出 |
|----------|------|----------|
| 合法 JS | `const x = "中文"` | `{valid: true}` |
| 非法 JS | `const x = "未闭合` | `{valid: false, error: "..."}` |
| 真实补丁后文件 | 实际打补丁后的 cli.js | `{valid: true}` |

### 8.3 端到端测试

#### e2e.test.js

在临时目录中操作 cli.js 的副本，不修改真实安装。

| 测试用例 | 步骤 | 验收标准 |
|----------|------|----------|
| 完整 patch 流程 | detect → backup → extract → patch → validate | 全部成功，补丁文件含中文 |
| 完整 restore 流程 | 接上一步 → restore | SHA-256 与原始一致 |
| patch → patch 重复 | 连续执行两次 patch | 第二次报"已汉化" |
| patch → 更新 → patch | 修改 package.json 版本号模拟更新 | 正确处理旧备份 |
| 补丁失败自动还原 | 注入无效翻译导致语法错误 | cli.js 自动恢复为原始 |

### 8.4 测试执行

```bash
# 运行全部测试
node --test tests/

# 运行单个模块测试
node --test tests/extractor.test.js
```

---

## 9 分发

### 9.1 package.json

```json
{
  "name": "claude-code-cn",
  "version": "0.1.0",
  "description": "Claude Code 中文汉化工具",
  "type": "module",
  "bin": {
    "claude-code-cn": "./bin/cli.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "files": [
    "bin/",
    "src/",
    "dict/"
  ],
  "keywords": ["claude-code", "i18n", "chinese", "localization"],
  "license": "MIT",
  "dependencies": {
    "acorn": "^8.14.0",
    "acorn-walk": "^8.3.0"
  }
}
```

### 9.2 安装与使用

```bash
npm install -g claude-code-cn

claude-code-cn patch      # 汉化
claude-code-cn restore    # 还原
claude-code-cn status     # 查看状态
claude-code-cn extract    # 提取字符串（维护者）
```

---

## 10 版本更新维护

### 10.1 Claude Code 版本更新时的用户流程

```
npm update -g @anthropic-ai/claude-code   # 用户更新 Claude Code
claude-code-cn patch                       # 重新汉化（自动适配新版本）
```

### 10.2 字典版本更新时的用户流程

```
npm update -g claude-code-cn              # 获取新版字典
claude-code-cn restore                     # 先还原
claude-code-cn patch                       # 用新字典重新汉化
```

### 10.3 字典维护者工作流

```
claude-code-cn extract > new-strings.txt   # 提取当前版本字符串
# 对比 new-strings.txt 与 zh-CN.json，翻译新增条目
# 提交字典更新，发布新版 npm 包
```

### 10.4 自动容错

字典中未覆盖的字符串保持英文原文，不影响功能。`patch` 输出的统计信息帮助维护者判断是否需要更新字典：

```
汉化完成（1,350/1,471，3.2s）
  已翻译: 1,350
  未匹配: 121（新增字符串，保持英文）
```

---

## 11 风险矩阵

| ID | 风险 | 严重度 | 可能性 | 应对方案 | 状态 |
|----|------|--------|--------|----------|------|
| R1 | 翻译逻辑判断中的字符串 | 高 | 低 | 仅翻译 ce:childrenDirect + 按偏移定点替换 | 已解决 |
| R2 | 误翻译组件名或属性值 | 高 | 低 | extractor 区分参数位置 | 已解决 |
| R3 | 特殊字符导致语法错误 | 高 | 低 | 强制转义 + validator 校验 + 自动还原 | 已解决 |
| R4 | 高频版本更新 | 中 | 高 | 字典按原文匹配，自动适配新偏移 | 有方案 |
| R5 | 写权限不足 | 中 | 中 | 预检权限 + 明确提示 | 有方案 |
| R6 | 第三方库字符串被误翻译 | 中 | 低 | createElement children 过滤天然排除 | 已解决 |
| R7 | 补丁后语法错误 | 高 | 低 | acorn 强制校验 + 失败自动还原 | 有方案 |
| R8 | 终端宽度 UI 错位 | 低 | 低 | Ink string-width 已正确处理全角 | 已解决 |

---

## 12 实施计划

### Phase 1：核心模块（v0.1-alpha）

| 任务 | 预估产出 |
|------|----------|
| 初始化 npm 项目，配置 package.json | 项目骨架 |
| 实现 detector 模块 + 测试 | `src/detector.js`, `tests/detector.test.js` |
| 实现 backup 模块 + 测试 | `src/backup.js`, `tests/backup.test.js` |
| 实现 extractor 模块 + 测试 | `src/extractor.js`, `tests/extractor.test.js` |
| 实现 patcher 模块 + 测试 | `src/patcher.js`, `tests/patcher.test.js` |
| 实现 validator 模块 + 测试 | `src/validator.js`, `tests/validator.test.js` |
| 实现 CLI 入口（patch / restore / status / extract） | `bin/cli.js` |

### Phase 2：翻译与集成（v0.1-beta）

| 任务 | 预估产出 |
|------|----------|
| 提取全部 childrenDirect 字符串 | 原始字符串列表 |
| 建立 zh-CN.json 字典 | `dict/zh-CN.json`（~1,471 条目） |
| 端到端测试 | `tests/e2e.test.js` |
| 边界场景测试（权限、重复 patch、版本不匹配等） | 补充测试用例 |

### Phase 3：发布（v0.1.0）

| 任务 | 预估产出 |
|------|----------|
| npm 包配置最终检查 | 可发布的 package.json |
| README | `README.md` |
| 版本更新验证 | 模拟 Claude Code 升级后重新 patch |
| npm publish | `claude-code-cn@0.1.0` |

---

## 附录 A：P1 扩展点

以下能力不在 v0.1 范围内，但设计已预留扩展：

| 扩展点 | 当前状态 | P1 处理方式 |
|--------|---------|-------------|
| propValue 中的 UI 文本 | 已识别 289 个（title/subtitle/placeholder 等） | extractor 增加 prop key 白名单识别 |
| childrenNested | 已标记 237 个 | 逐个人工审核后加入字典 |
| 模板字面量 | 已识别 13,547 个 | P2 阶段解析模板字面量静态部分 |

## 附录 B：验证数据

全量可行性验证 50/50 通过。验证脚本：`feasibility/v3-final-verify.js`

关键性能指标（Claude Code v2.1.107）：

| 指标 | 值 |
|------|-----|
| acorn 解析 | 1.55s |
| AST 遍历 + 分类 | 0.26s |
| 分段拼接替换（992 个） | 5.9ms |
| acorn 重新校验 | 1.36s |
| SHA-256 校验 | <1s |
| 偏移精度 | 20/20 精确 |
| 特殊字符转义 | 6/6 通过 |
