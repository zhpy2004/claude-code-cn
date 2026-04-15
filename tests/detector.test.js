import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { detect } from '../src/detector.js';

describe('detector', () => {
  it('应检测到已安装的 Claude Code', async () => {
    const info = await detect();
    assert.ok(info.cliPath, 'cliPath 不应为空');
    assert.ok(info.version, 'version 不应为空');
    assert.ok(info.installDir, 'installDir 不应为空');
    assert.ok(existsSync(info.cliPath), 'cli.js 应存在');
    assert.ok(existsSync(info.pkgPath), 'package.json 应存在');
    assert.match(info.version, /^\d+\.\d+\.\d+/, '版本号格式应为 x.y.z');
  });

  it('返回的路径应指向 @anthropic-ai/claude-code', async () => {
    const info = await detect();
    assert.ok(info.cliPath.includes('claude-code'), '路径应包含 claude-code');
    assert.ok(info.cliPath.endsWith('cli.js'), '路径应以 cli.js 结尾');
  });
});
