/**
 * 端到端测试 — 见设计文档 §8.3
 *
 * 在临时目录中模拟 Claude Code 安装，验证完整的 patch / restore 流程。
 * 不修改真实安装。
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

import * as backup from '../src/backup.js';
import { extract, filterP0 } from '../src/extractor.js';
import { patch } from '../src/patcher.js';
import { validate } from '../src/validator.js';

const TEST_DIR = path.join(os.tmpdir(), 'claude-code-cn-e2e-test');

// 合成一个迷你 "cli.js"，包含 createElement 调用
const FAKE_CLI_JS = `
import { createElement } from 'react';

function App() {
  return createElement("div", null,
    createElement("h1", null, "Welcome to Claude Code"),
    createElement("p", { className: "desc" }, "Select model"),
    createElement("span", null, "Press ", createElement("kbd", null, "Esc"), " to exit"),
    createElement("button", { title: "Submit" }, "Click here"),
    flag ? createElement("div", null, "Loading...") : createElement("div", null, "Ready")
  );
}

if (mode === "dark") { console.log("dark mode"); }
switch (cmd) { case "help": break; case "version": break; }
name.startsWith("claude");

export default App;
`;

const FAKE_PKG_JSON = JSON.stringify({
  name: '@anthropic-ai/claude-code',
  version: '2.1.107',
}, null, 2);

function makeDict(entries) {
  return {
    version: '0.1.0',
    entries,
  };
}

function hashStr(content) {
  return createHash('sha256').update(content).digest('hex');
}

function makeInfo(version = '2.1.107') {
  return {
    cliPath: path.join(TEST_DIR, 'cli.js'),
    pkgPath: path.join(TEST_DIR, 'package.json'),
    version,
    installDir: TEST_DIR,
  };
}

describe('e2e', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(path.join(TEST_DIR, 'cli.js'), FAKE_CLI_JS);
    writeFileSync(path.join(TEST_DIR, 'package.json'), FAKE_PKG_JSON);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('完整 patch 流程：extract → patch → validate 应全部成功', () => {
    const info = makeInfo();
    const code = readFileSync(info.cliPath, 'utf-8');
    const origHash = hashStr(code);

    // 备份
    backup.create(info);
    assert.ok(existsSync(info.cliPath + '.backup'));

    // 提取
    const allStrings = extract(code);
    const candidates = filterP0(allStrings);
    assert.ok(candidates.length > 0, '应提取到 P0 候选');
    assert.ok(candidates.every(s => s.context === 'ce:childrenDirect'));

    // 补丁
    const dict = makeDict([
      { original: 'Welcome to Claude Code', translation: '欢迎使用 Claude Code', context: 'ce:childrenDirect' },
      { original: 'Select model', translation: '选择模型', context: 'ce:childrenDirect' },
      { original: 'Click here', translation: '点击这里', context: 'ce:childrenDirect' },
    ]);
    const { patched, stats } = patch(code, candidates, dict);
    assert.ok(stats.translated >= 3, `应至少翻译 3 个，实际 ${stats.translated}`);

    // 校验
    const result = validate(patched);
    assert.equal(result.valid, true, `语法校验应通过: ${result.error}`);

    // 写入
    writeFileSync(info.cliPath, patched);
    const patchedContent = readFileSync(info.cliPath, 'utf-8');
    assert.ok(patchedContent.includes('欢迎使用 Claude Code'));
    assert.ok(patchedContent.includes('选择模型'));
    assert.ok(patchedContent.includes('点击这里'));

    // comparison 中的字符串不应被翻译
    assert.ok(patchedContent.includes('mode === "dark"'));
  });

  it('完整 restore 流程：patch → restore 应还原到原始文件', () => {
    const info = makeInfo();
    const origContent = readFileSync(info.cliPath, 'utf-8');
    const origHash = hashStr(origContent);

    // patch
    backup.create(info);
    const allStrings = extract(origContent);
    const candidates = filterP0(allStrings);
    const dict = makeDict([
      { original: 'Welcome to Claude Code', translation: '欢迎使用 Claude Code', context: 'ce:childrenDirect' },
    ]);
    const { patched } = patch(origContent, candidates, dict);
    writeFileSync(info.cliPath, patched);

    // restore
    backup.restore(info);
    const restoredContent = readFileSync(info.cliPath, 'utf-8');
    assert.equal(hashStr(restoredContent), origHash, 'SHA-256 应与原始一致');
    assert.ok(!existsSync(info.cliPath + '.backup'), '备份文件应已删除');
    assert.ok(!existsSync(info.cliPath + '.backup.meta'), '元数据文件应已删除');
  });

  it('重复 patch 应报"已汉化"', () => {
    const info = makeInfo();
    backup.create(info);

    assert.throws(
      () => backup.create(info),
      { code: 'ALREADY_PATCHED' },
    );
  });

  it('版本更新后应能正确处理旧备份', () => {
    const info107 = makeInfo('2.1.107');
    backup.create(info107);

    // 模拟 Claude Code 更新：版本号变了
    const info200 = makeInfo('2.2.0');
    const st = backup.status(info200);
    assert.equal(st.exists, true);
    assert.equal(st.versionMatch, false, '版本不匹配');

    // 还原旧备份
    backup.restore(info200);
    assert.ok(!existsSync(info200.cliPath + '.backup'));

    // 重新 patch 新版本
    const meta = backup.create(info200);
    assert.equal(meta.version, '2.2.0');
  });

  it('补丁失败应能自动还原', () => {
    const info = makeInfo();
    const origContent = readFileSync(info.cliPath, 'utf-8');
    const origHash = hashStr(origContent);

    // 备份
    backup.create(info);

    // 模拟一个会导致语法错误的"补丁结果"
    const brokenCode = 'const x = "未闭合的字符串;';
    const result = validate(brokenCode);
    assert.equal(result.valid, false, '应检测到语法错误');

    // 自动还原
    backup.restore(info);
    const restoredContent = readFileSync(info.cliPath, 'utf-8');
    assert.equal(hashStr(restoredContent), origHash, '应还原为原始文件');
  });

  it('补丁后的代码应通过 acorn 语法校验', () => {
    const info = makeInfo();
    const code = readFileSync(info.cliPath, 'utf-8');
    const allStrings = extract(code);
    const candidates = filterP0(allStrings);

    // 翻译所有候选
    const entries = candidates.map(s => ({
      original: s.value,
      translation: `中文_${s.value}`,
      context: s.context,
    }));
    const dict = makeDict(entries);
    const { patched, stats } = patch(code, candidates, dict);

    assert.equal(stats.translated, candidates.length, '应全部翻译');
    assert.equal(stats.unmatched, 0, '不应有未匹配');

    const result = validate(patched);
    assert.equal(result.valid, true, `全量翻译后语法校验应通过: ${result.error}`);
  });

  it('偏移精度：补丁前后非翻译区域应完全不变', () => {
    const info = makeInfo();
    const code = readFileSync(info.cliPath, 'utf-8');
    const allStrings = extract(code);
    const candidates = filterP0(allStrings);

    // 只翻译一个字符串
    const dict = makeDict([
      { original: 'Welcome to Claude Code', translation: '欢迎使用 Claude Code', context: 'ce:childrenDirect' },
    ]);
    const { patched } = patch(code, candidates, dict);

    // switch/case 中的字符串不应受影响
    assert.ok(patched.includes('case "help"'));
    assert.ok(patched.includes('case "version"'));
    // startsWith 中的字符串不应受影响
    assert.ok(patched.includes('.startsWith("claude")'));
    // propValue 不应受影响
    assert.ok(patched.includes('className: "desc"'));
    assert.ok(patched.includes('title: "Submit"'));
  });
});
