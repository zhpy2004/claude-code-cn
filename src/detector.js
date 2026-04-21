/**
 * detector 模块 — 见设计文档 §4.2
 *
 * 定位 Claude Code 的安装路径和版本号。
 */

import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { DetectError } from './errors.js';

/**
 * @typedef {Object} DetectResult
 * @property {string} cliPath
 * @property {string} pkgPath
 * @property {string} version
 * @property {string} installDir
 */

/**
 * 尝试从给定的 node_modules 根路径查找 Claude Code。
 * @param {string} root - node_modules 目录路径
 * @returns {DetectResult|null}
 */
function tryResolve(root) {
  const installDir = path.join(root, '@anthropic-ai', 'claude-code');
  const pkgPath = path.join(installDir, 'package.json');
  const cliPath = path.join(installDir, 'cli.js');

  if (!existsSync(pkgPath)) return null;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  if (!existsSync(cliPath)) {
    throw new DetectError(
      'UNSUPPORTED_VERSION',
      `检测到 Claude Code v${pkg.version}，但该版本已改为原生二进制架构，不包含可补丁的 JS 源码。\n` +
      '本工具仅支持 <= v2.1.107。请执行：npm install -g @anthropic-ai/claude-code@2.1.107'
    );
  }

  return { cliPath, pkgPath, version: pkg.version, installDir };
}

/**
 * 检测 Claude Code 安装信息。
 *
 * 检测策略（按优先级）：
 *   1. npm config get prefix → 拼接 node_modules/
 *   2. npm root -g
 *   3. 抛出 DetectError
 *
 * @returns {Promise<DetectResult>}
 * @throws {DetectError}
 */
export async function detect() {
  // 策略 1: npm config get prefix
  try {
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const root = path.join(prefix, 'node_modules');
    const result = tryResolve(root);
    if (result) return result;
  } catch { /* 回退到策略 2 */ }

  // 策略 2: npm root -g
  try {
    const root = execSync('npm root -g', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const result = tryResolve(root);
    if (result) return result;
  } catch { /* 全部失败 */ }

  throw new DetectError('NOT_INSTALLED', '未找到 Claude Code。请先执行：npm install -g @anthropic-ai/claude-code');
}
