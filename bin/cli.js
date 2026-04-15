#!/usr/bin/env node

/**
 * claude-code-cn CLI 入口 — 见设计文档 §4.7
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { detect } from '../src/detector.js';
import * as backup from '../src/backup.js';
import { extract, filterP0 } from '../src/extractor.js';
import { patch } from '../src/patcher.js';
import { validate } from '../src/validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function log(msg) {
  console.log(`  ${msg}`);
}

function error(msg) {
  console.error(`  ✗ ${msg}`);
}

function loadDict() {
  const dictPath = path.join(__dirname, '..', 'dict', 'zh-CN.json');
  return JSON.parse(readFileSync(dictPath, 'utf-8'));
}

function showHelp() {
  console.log(`
claude-code-cn — Claude Code 中文汉化工具

用法: claude-code-cn <command>

命令:
  patch     汉化当前安装的 Claude Code
  restore   还原为英文原版
  status    查看汉化状态
  extract   提取可翻译字符串（面向维护者）

选项:
  --help    显示帮助信息
  --version 显示版本号
`);
}

function showVersion() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  console.log(pkg.version);
}

// ── 命令实现 ──

async function commandPatch() {
  const t0 = performance.now();

  // 1. 检测
  const info = await detect();
  log(`检测到 Claude Code v${info.version}`);

  // 2. 备份状态检查
  const st = backup.status(info);
  if (st.exists && st.versionMatch) {
    error('当前版本已汉化。如需重新汉化，请先执行：claude-code-cn restore');
    process.exit(4);
  }
  if (st.exists && !st.versionMatch) {
    log('检测到旧版本备份，正在清理...');
    backup.restore(info);
  }

  // 3. 备份
  const dict = loadDict();
  backup.create(info, dict.version);
  log('已备份原始文件');

  // 4. 提取
  const code = readFileSync(info.cliPath, 'utf-8');
  const allStrings = extract(code);
  const candidates = filterP0(allStrings);
  log(`提取到 ${candidates.length} 个可翻译字符串`);

  // 5. 补丁
  const { patched, stats } = patch(code, candidates, dict);
  log(`已翻译 ${stats.translated} 个，未匹配 ${stats.unmatched} 个`);

  // 6. 校验
  const result = validate(patched);
  if (!result.valid) {
    error(`语法校验失败: ${result.error}`);
    backup.restore(info);
    error('已自动还原备份');
    process.exit(3);
  }

  // 7. 写入
  writeFileSync(info.cliPath, patched);
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  log(`汉化完成（${stats.translated}/${candidates.length}，${elapsed}s）`);
}

async function commandRestore() {
  const info = await detect();
  const st = backup.status(info);
  if (!st.exists) {
    error('未找到备份，当前可能已是英文原版');
    process.exit(4);
  }
  backup.restore(info);
  log('已还原为英文原版');
}

async function commandStatus() {
  const info = await detect();
  const st = backup.status(info);

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

async function commandExtract() {
  const info = await detect();
  log(`检测到 Claude Code v${info.version}`);

  const code = readFileSync(info.cliPath, 'utf-8');
  const allStrings = extract(code);
  const p0 = filterP0(allStrings);

  log(`总字符串: ${allStrings.length}`);
  log(`childrenDirect: ${allStrings.filter(s => s.context === 'ce:childrenDirect').length}`);
  log(`P0 候选（去重+过滤）: ${p0.length}`);

  // 与字典对比
  const dict = loadDict();
  const dictSet = new Set(dict.entries.map(e => e.original));
  const covered = p0.filter(s => dictSet.has(s.value));
  const missing = p0.filter(s => !dictSet.has(s.value));

  log(`字典覆盖: ${covered.length}/${p0.length}（${(covered.length / p0.length * 100).toFixed(1)}%）`);
  log(`待翻译: ${missing.length}`);

  // 输出未覆盖的字符串到 stdout（JSON 格式，方便后续处理）
  const output = missing.map(s => ({ value: s.value, context: s.context }));
  console.log(JSON.stringify(output, null, 2));
}

// ── 主入口 ──

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (args.includes('--help') || args.includes('-h') || !command) {
    showHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    return;
  }

  try {
    switch (command) {
      case 'patch':
        await commandPatch();
        break;
      case 'restore':
        await commandRestore();
        break;
      case 'status':
        await commandStatus();
        break;
      case 'extract':
        await commandExtract();
        break;
      default:
        error(`未知命令: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (e) {
    if (e.code === 'NOT_INSTALLED') {
      error(e.message);
      process.exit(1);
    }
    if (e.code === 'NO_PERMISSION') {
      error(e.message);
      process.exit(2);
    }
    if (e.code === 'BACKUP_NOT_FOUND' || e.code === 'HASH_MISMATCH' || e.code === 'ALREADY_PATCHED') {
      error(e.message);
      process.exit(4);
    }
    // 未知错误
    error(`意外错误: ${e.message}`);
    process.exit(1);
  }
}

main();
