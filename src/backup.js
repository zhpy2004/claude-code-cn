/**
 * backup 模块 — 见设计文档 §4.3
 *
 * 备份/还原管理，支持元数据和 SHA-256 完整性校验。
 */

import { copyFileSync, readFileSync, writeFileSync, unlinkSync, existsSync, accessSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { BackupError, PatchError } from './errors.js';

function backupPath(info) {
  return info.cliPath + '.backup';
}

function metaPath(info) {
  return info.cliPath + '.backup.meta';
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function checkWritePermission(filePath) {
  try {
    accessSync(path.dirname(filePath), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 备份 cli.js 到同目录下 cli.js.backup，并写入元数据文件。
 *
 * @param {import('./detector.js').DetectResult} info
 * @param {string} [dictVersion='0.1.0']
 * @returns {import('../docs/design.md').BackupMeta}
 */
export function create(info, dictVersion = '0.1.0') {
  if (!checkWritePermission(info.cliPath)) {
    throw new BackupError('NO_PERMISSION', '无写入权限。请使用管理员权限运行，或在 macOS/Linux 下使用 sudo');
  }

  const bp = backupPath(info);
  const mp = metaPath(info);

  if (existsSync(bp) && existsSync(mp)) {
    const meta = JSON.parse(readFileSync(mp, 'utf-8'));
    if (meta.version === info.version) {
      throw new PatchError('ALREADY_PATCHED', '当前版本已汉化。如需重新汉化，请先执行：claude-code-cn restore');
    }
  }

  copyFileSync(info.cliPath, bp);
  const hash = hashFile(bp);

  const meta = {
    version: info.version,
    hash,
    time: new Date().toISOString(),
    cliPath: info.cliPath,
    dictVersion,
  };

  writeFileSync(mp, JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * 从备份还原 cli.js，并删除备份文件和元数据。
 *
 * @param {import('./detector.js').DetectResult} info
 */
export function restore(info) {
  const bp = backupPath(info);
  const mp = metaPath(info);

  if (!existsSync(bp)) {
    throw new BackupError('BACKUP_NOT_FOUND', '未找到备份文件，当前可能已是英文原版');
  }

  if (existsSync(mp)) {
    const meta = JSON.parse(readFileSync(mp, 'utf-8'));
    const currentHash = hashFile(bp);
    if (currentHash !== meta.hash) {
      throw new BackupError('HASH_MISMATCH', '备份文件可能已损坏。建议重新安装 Claude Code');
    }
  }

  copyFileSync(bp, info.cliPath);
  unlinkSync(bp);
  if (existsSync(mp)) unlinkSync(mp);
}

/**
 * 查询当前备份状态。
 *
 * @param {import('./detector.js').DetectResult} info
 * @returns {{exists: boolean, meta: object|null, versionMatch: boolean}}
 */
export function status(info) {
  const bp = backupPath(info);
  const mp = metaPath(info);

  if (!existsSync(bp)) {
    return { exists: false, meta: null, versionMatch: false };
  }

  let meta = null;
  let versionMatch = false;
  if (existsSync(mp)) {
    meta = JSON.parse(readFileSync(mp, 'utf-8'));
    versionMatch = meta.version === info.version;
  }

  return { exists: true, meta, versionMatch };
}
