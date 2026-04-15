import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { patch, escapeForQuote } from '../src/patcher.js';
import { extract } from '../src/extractor.js';

describe('escapeForQuote', () => {
  it('应转义反斜杠', () => {
    assert.equal(escapeForQuote('a\\b', '"'), 'a\\\\b');
  });

  it('应转义双引号（当 quoteChar 为 "）', () => {
    assert.equal(escapeForQuote('say "hi"', '"'), 'say \\"hi\\"');
  });

  it('应转义单引号（当 quoteChar 为 \'）', () => {
    assert.equal(escapeForQuote("it's", "'"), "it\\'s");
  });

  it('双引号模式不应转义单引号', () => {
    assert.equal(escapeForQuote("it's", '"'), "it's");
  });

  it('应转义换行符', () => {
    assert.equal(escapeForQuote('line1\nline2', '"'), 'line1\\nline2');
  });

  it('应转义回车符', () => {
    assert.equal(escapeForQuote('a\rb', '"'), 'a\\rb');
  });

  it('应转义制表符', () => {
    assert.equal(escapeForQuote('a\tb', '"'), 'a\\tb');
  });

  it('应正确处理多种特殊字符组合', () => {
    const result = escapeForQuote('a\\b"c\nd', '"');
    assert.equal(result, 'a\\\\b\\"c\\nd');
  });

  it('中文文本无需转义', () => {
    assert.equal(escapeForQuote('你好世界', '"'), '你好世界');
  });
});

describe('patch', () => {
  const CODE = `
import { createElement } from 'react';
createElement("div", null, "Hello World");
createElement("span", null, "Click here", "Submit");
if (x === "Hello World") {}
`;

  function makeDict(entries) {
    return { version: '0.1.0', entries };
  }

  it('应替换 childrenDirect 中匹配的字符串', () => {
    const strings = extract(CODE);
    const dict = makeDict([
      { original: 'Hello World', translation: '你好世界', context: 'ce:childrenDirect' },
    ]);
    const { patched, stats } = patch(CODE, strings, dict);
    assert.ok(patched.includes('"你好世界"'));
    assert.equal(stats.translated, 1);
  });

  it('不应替换 comparison 中的同名字符串', () => {
    const strings = extract(CODE);
    const dict = makeDict([
      { original: 'Hello World', translation: '你好世界', context: 'ce:childrenDirect' },
    ]);
    const { patched } = patch(CODE, strings, dict);
    // comparison 中的 "Hello World" 应保持不变
    assert.ok(patched.includes('x === "Hello World"'));
  });

  it('应替换多个不同字符串', () => {
    const strings = extract(CODE);
    const dict = makeDict([
      { original: 'Hello World', translation: '你好世界', context: 'ce:childrenDirect' },
      { original: 'Click here', translation: '点击这里', context: 'ce:childrenDirect' },
      { original: 'Submit', translation: '提交', context: 'ce:childrenDirect' },
    ]);
    const { patched, stats } = patch(CODE, strings, dict);
    assert.ok(patched.includes('"你好世界"'));
    assert.ok(patched.includes('"点击这里"'));
    assert.ok(patched.includes('"提交"'));
    assert.equal(stats.translated, 3);
  });

  it('字典为空时应返回原始代码', () => {
    const strings = extract(CODE);
    const dict = makeDict([]);
    const { patched, stats } = patch(CODE, strings, dict);
    assert.equal(patched, CODE);
    assert.equal(stats.translated, 0);
  });

  it('无匹配时 unmatched 应等于 childrenDirect 总数', () => {
    const strings = extract(CODE);
    const dict = makeDict([]);
    const { stats } = patch(CODE, strings, dict);
    const cdCount = strings.filter(s => s.context === 'ce:childrenDirect').length;
    assert.equal(stats.unmatched, cdCount);
  });

  it('应保留原引号类型', () => {
    const code = "createElement('p', null, 'single quoted');";
    const strings = extract(code);
    const dict = makeDict([
      { original: 'single quoted', translation: '单引号', context: 'ce:childrenDirect' },
    ]);
    const { patched } = patch(code, strings, dict);
    assert.ok(patched.includes("'单引号'"));
    assert.ok(!patched.includes('"单引号"'));
  });

  it('翻译含特殊字符时应正确转义', () => {
    const code = 'createElement("div", null, "test");';
    const strings = extract(code);
    const dict = makeDict([
      { original: 'test', translation: '含"引号"和\n换行', context: 'ce:childrenDirect' },
    ]);
    const { patched } = patch(code, strings, dict);
    // 双引号应被转义，换行应被转义
    assert.ok(patched.includes('\\"'));
    assert.ok(patched.includes('\\n'));
    // 补丁结果应是合法 JS
    assert.ok(!patched.includes('\n换行'));
  });

  it('context 不匹配时不应替换', () => {
    const strings = extract(CODE);
    // 字典中 context 为 comparison，不应匹配 childrenDirect
    const dict = makeDict([
      { original: 'Hello World', translation: '你好世界', context: 'comparison' },
    ]);
    const { patched, stats } = patch(CODE, strings, dict);
    assert.ok(!patched.includes('你好世界'));
    assert.equal(stats.translated, 0);
  });
});
