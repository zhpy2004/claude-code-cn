import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/validator.js';

describe('validator', () => {
  it('合法 JS 应返回 valid: true', () => {
    const result = validate('const x = 1; console.log(x);');
    assert.equal(result.valid, true);
    assert.equal(result.error, null);
  });

  it('合法 ESM 应返回 valid: true', () => {
    const result = validate('import fs from "fs"; export default fs;');
    assert.equal(result.valid, true);
    assert.equal(result.error, null);
  });

  it('含中文字符串的合法 JS 应返回 valid: true', () => {
    const result = validate('const msg = "你好世界"; console.log(msg);');
    assert.equal(result.valid, true);
    assert.equal(result.error, null);
  });

  it('语法错误应返回 valid: false', () => {
    const result = validate('const x = ;');
    assert.equal(result.valid, false);
    assert.ok(result.error);
    assert.ok(result.error.length > 0);
  });

  it('未闭合字符串应返回 valid: false', () => {
    const result = validate('const x = "unterminated');
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  it('空代码应返回 valid: true', () => {
    const result = validate('');
    assert.equal(result.valid, true);
    assert.equal(result.error, null);
  });
});
