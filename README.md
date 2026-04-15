# claude-code-cn

Claude Code 中文汉化工具 — 一条命令将 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 界面翻译为中文。

## 安装

```bash
npm install -g @zhpy2004/claude-code-cn
```

需要 Node.js >= 18。

## 使用

```bash
# 汉化当前安装的 Claude Code
claude-code-cn patch

# 还原为英文原版
claude-code-cn restore

# 查看汉化状态
claude-code-cn status
```

## 工作原理

1. **检测** — 自动定位全局安装的 `@anthropic-ai/claude-code` 及其版本
2. **备份** — 汉化前自动备份原始文件，支持一键还原
3. **提取** — 使用 [acorn](https://github.com/acornjs/acorn) 解析 AST，精确识别 `createElement` children 位置的 UI 文本
4. **翻译** — 按原文 + AST 上下文匹配中文翻译，分段拼接写入
5. **校验** — 补丁后 acorn 重新解析，语法错误自动回滚

当前翻译覆盖 **1471** 个核心 UI 字符串（P0: `createElement` children 直接文本）。

## Claude Code 版本更新

Claude Code 更新后，只需重新执行 `claude-code-cn patch`。翻译字典按原文匹配而非偏移位置，大部分翻译可自动适配新版本。

## 面向维护者

```bash
# 提取当前版本的可翻译字符串，对比字典覆盖情况
claude-code-cn extract
```

翻译字典位于 `dict/zh-CN.json`，欢迎提交 PR 补充翻译。

## 注意事项

- 汉化会修改全局安装的 Claude Code 文件，`restore` 可随时还原
- 全局 `node_modules` 目录可能需要管理员/sudo 权限
- 当前仅翻译 P0 级别的核心 UI 文本，不涉及逻辑判断中的字符串，不会影响功能

## 许可证

[MIT](LICENSE)
