import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { create, restore, status } from '../src/backup.js';

const TEST_DIR = path.join(os.tmpdir(), 'claude-code-cn-backup-test');

function makeInfo(version = '2.1.107') {
  return {
    cliPath: path.join(TEST_DIR, 'cli.js'),
    pkgPath: path.join(TEST_DIR, 'package.json'),
    version,
    installDir: TEST_DIR,
  };
}

function hash(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

describe('backup', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(path.join(TEST_DIR, 'cli.js'), 'console.log("original");');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('create 应创建备份文件和元数据', () => {
    const info = makeInfo();
    const meta = create(info);
    assert.ok(existsSync(info.cliPath + '.backup'));
    assert.ok(existsSync(info.cliPath + '.backup.meta'));
    assert.equal(meta.version, '2.1.107');
    assert.ok(meta.hash);
    assert.ok(meta.time);
  });

  it('备份的 SHA-256 应与原文件一致', () => {
    const info = makeInfo();
    const meta = create(info);
    const origHash = hash(info.cliPath);
    assert.equal(meta.hash, origHash);
  });

  it('restore 应还原文件并删除备份', () => {
    const info = makeInfo();
    const origHash = hash(info.cliPath);
    create(info);
    writeFileSync(info.cliPath, 'console.log("patched");');
    restore(info);
    assert.equal(hash(info.cliPath), origHash);
    assert.ok(!existsSync(info.cliPath + '.backup'));
    assert.ok(!existsSync(info.cliPath + '.backup.meta'));
  });

  it('无备份时 restore 应抛出 BackupError', () => {
    const info = makeInfo();
    assert.throws(() => restore(info), { code: 'BACKUP_NOT_FOUND' });
  });

  it('已有备份时重复 create 应抛出 PatchError', () => {
    const info = makeInfo();
    create(info);
    assert.throws(() => create(info), { code: 'ALREADY_PATCHED' });
  });

  it('版本不匹配时 status 应返回 versionMatch: false', () => {
    const info = makeInfo('2.1.107');
    create(info);
    const newInfo = makeInfo('2.2.0');
    const st = status(newInfo);
    assert.equal(st.exists, true);
    assert.equal(st.versionMatch, false);
  });

  it('无备份时 status 应返回 exists: false', () => {
    const info = makeInfo();
    const st = status(info);
    assert.equal(st.exists, false);
    assert.equal(st.meta, null);
  });
});
