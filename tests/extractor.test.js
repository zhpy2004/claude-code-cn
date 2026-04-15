import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extract, filterP0 } from '../src/extractor.js';

// 合成的小型测试代码，覆盖所有 10 种上下文标签
const SYNTHETIC_CODE = `
import { createElement } from 'react';

// ce:componentType — 第1参数
createElement("div", null, "Hello World");

// ce:propValue — 第2参数 ObjectExpression 内
createElement("span", { title: "tooltip text", className: "my-class" }, "Visible");

// ce:childrenDirect — 第3+参数直接字符串
createElement("p", null, "First child", "Second child");

// ce:childrenNested — 第3+参数内嵌套的字符串（如三元表达式）
createElement("div", null, flag ? "nested text" : "alt text");

// comparison
if (x === "compare_val") {}

// switchCase
switch (y) { case "case_val": break; }

// startsWith
z.startsWith("prefix");

// assignment
let a = "assigned_val";

// argument（非 createElement 的 CallExpression）
console.log("log message");

// other — 不在任何特定上下文中
const arr = ["standalone"];
`;

describe('extractor', () => {
  it('extract 应返回非空数组', () => {
    const strings = extract(SYNTHETIC_CODE);
    assert.ok(strings.length > 0);
  });

  it('每个结果应包含 value, start, end, context', () => {
    const strings = extract(SYNTHETIC_CODE);
    for (const s of strings) {
      assert.ok(typeof s.value === 'string');
      assert.ok(typeof s.start === 'number');
      assert.ok(typeof s.end === 'number');
      assert.ok(typeof s.context === 'string');
    }
  });

  it('应正确分类 ce:componentType', () => {
    const strings = extract(SYNTHETIC_CODE);
    const ct = strings.filter(s => s.context === 'ce:componentType');
    const values = ct.map(s => s.value);
    assert.ok(values.includes('div'));
    assert.ok(values.includes('span'));
    assert.ok(values.includes('p'));
  });

  it('应正确分类 ce:propValue', () => {
    const strings = extract(SYNTHETIC_CODE);
    const pv = strings.filter(s => s.context === 'ce:propValue');
    const values = pv.map(s => s.value);
    assert.ok(values.includes('tooltip text'));
    assert.ok(values.includes('my-class'));
  });

  it('应正确分类 ce:childrenDirect', () => {
    const strings = extract(SYNTHETIC_CODE);
    const cd = strings.filter(s => s.context === 'ce:childrenDirect');
    const values = cd.map(s => s.value);
    assert.ok(values.includes('Hello World'));
    assert.ok(values.includes('Visible'));
    assert.ok(values.includes('First child'));
    assert.ok(values.includes('Second child'));
  });

  it('应正确分类 ce:childrenNested', () => {
    const strings = extract(SYNTHETIC_CODE);
    const cn = strings.filter(s => s.context === 'ce:childrenNested');
    const values = cn.map(s => s.value);
    assert.ok(values.includes('nested text'), 'should contain "nested text"');
    assert.ok(values.includes('alt text'), 'should contain "alt text"');
  });

  it('应正确分类 comparison', () => {
    const strings = extract(SYNTHETIC_CODE);
    const cmp = strings.filter(s => s.context === 'comparison');
    const values = cmp.map(s => s.value);
    assert.ok(values.includes('compare_val'));
  });

  it('应正确分类 switchCase', () => {
    const strings = extract(SYNTHETIC_CODE);
    const sc = strings.filter(s => s.context === 'switchCase');
    const values = sc.map(s => s.value);
    assert.ok(values.includes('case_val'));
  });

  it('应正确分类 startsWith', () => {
    const strings = extract(SYNTHETIC_CODE);
    const sw = strings.filter(s => s.context === 'startsWith');
    const values = sw.map(s => s.value);
    assert.ok(values.includes('prefix'));
  });

  it('应正确分类 assignment', () => {
    const strings = extract(SYNTHETIC_CODE);
    const asgn = strings.filter(s => s.context === 'assignment');
    const values = asgn.map(s => s.value);
    assert.ok(values.includes('assigned_val'));
  });

  it('应正确分类 argument', () => {
    const strings = extract(SYNTHETIC_CODE);
    const arg = strings.filter(s => s.context === 'argument');
    const values = arg.map(s => s.value);
    assert.ok(values.includes('log message'));
  });

  it('偏移应精确对应源码位置', () => {
    const strings = extract(SYNTHETIC_CODE);
    for (const s of strings) {
      const raw = SYNTHETIC_CODE.slice(s.start, s.end);
      const q = raw[0];
      assert.ok(q === '"' || q === "'", `偏移 ${s.start} 处应为引号，实际: ${q}`);
      assert.equal(raw[raw.length - 1], q, `偏移 ${s.start} 处引号应闭合`);
    }
  });

  it('应跳过空白字符串', () => {
    const code = 'const x = "";  const y = "   ";';
    const strings = extract(code);
    assert.equal(strings.length, 0);
  });

  it('MemberExpression 形式的 createElement 应同样识别', () => {
    const code = 'React.createElement("span", null, "Member CE");';
    const strings = extract(code);
    const cd = strings.filter(s => s.context === 'ce:childrenDirect');
    assert.ok(cd.some(s => s.value === 'Member CE'));
  });
});

describe('filterP0', () => {
  it('应只保留 ce:childrenDirect', () => {
    const strings = extract(SYNTHETIC_CODE);
    const p0 = filterP0(strings);
    assert.ok(p0.length > 0);
    assert.ok(p0.every(s => s.context === 'ce:childrenDirect'));
  });

  it('应过滤单字符', () => {
    const strings = [
      { value: 'A', start: 0, end: 3, context: 'ce:childrenDirect' },
      { value: 'Hello', start: 4, end: 11, context: 'ce:childrenDirect' },
    ];
    const p0 = filterP0(strings);
    assert.equal(p0.length, 1);
    assert.equal(p0[0].value, 'Hello');
  });

  it('应过滤纯符号', () => {
    const strings = [
      { value: '→', start: 0, end: 3, context: 'ce:childrenDirect' },
      { value: '...', start: 4, end: 9, context: 'ce:childrenDirect' },
      { value: 'OK', start: 10, end: 14, context: 'ce:childrenDirect' },
    ];
    const p0 = filterP0(strings);
    assert.equal(p0.length, 1);
    assert.equal(p0[0].value, 'OK');
  });

  it('应过滤 CSS 类名模式', () => {
    const strings = [
      { value: 'flex-row', start: 0, end: 10, context: 'ce:childrenDirect' },
      { value: 'text_bold', start: 11, end: 22, context: 'ce:childrenDirect' },
      { value: 'Submit', start: 23, end: 31, context: 'ce:childrenDirect' },
    ];
    const p0 = filterP0(strings);
    assert.equal(p0.length, 1);
    assert.equal(p0[0].value, 'Submit');
  });

  it('应过滤 URL', () => {
    const strings = [
      { value: 'https://example.com', start: 0, end: 21, context: 'ce:childrenDirect' },
      { value: 'docs.github.com/api', start: 22, end: 43, context: 'ce:childrenDirect' },
      { value: 'Click here', start: 44, end: 56, context: 'ce:childrenDirect' },
    ];
    const p0 = filterP0(strings);
    assert.equal(p0.length, 1);
    assert.equal(p0[0].value, 'Click here');
  });

  it('应过滤纯小写标识符', () => {
    const strings = [
      { value: 'error', start: 0, end: 7, context: 'ce:childrenDirect' },
      { value: 'status', start: 8, end: 16, context: 'ce:childrenDirect' },
      { value: 'Error occurred', start: 17, end: 33, context: 'ce:childrenDirect' },
    ];
    const p0 = filterP0(strings);
    assert.equal(p0.length, 1);
    assert.equal(p0[0].value, 'Error occurred');
  });

  it('应去重相同 value', () => {
    const strings = [
      { value: 'Hello', start: 0, end: 7, context: 'ce:childrenDirect' },
      { value: 'Hello', start: 10, end: 17, context: 'ce:childrenDirect' },
      { value: 'World', start: 20, end: 27, context: 'ce:childrenDirect' },
    ];
    const p0 = filterP0(strings);
    assert.equal(p0.length, 2);
    const values = p0.map(s => s.value);
    assert.ok(values.includes('Hello'));
    assert.ok(values.includes('World'));
  });
});
