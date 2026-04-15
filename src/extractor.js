/**
 * extractor 模块 — 见设计文档 §4.4
 *
 * AST 解析 cli.js，提取字符串并标注上下文标签。
 */

import { parse } from 'acorn';
import * as walk from 'acorn-walk';

/**
 * 判断节点是否为 createElement 调用。
 * @param {import('acorn').Node} node
 * @returns {boolean}
 */
function isCreateElementCall(node) {
  if (node.type !== 'CallExpression') return false;
  const c = node.callee;
  if (c.type === 'Identifier' && c.name === 'createElement') return true;
  if (c.type === 'MemberExpression' && c.property?.type === 'Identifier' && c.property.name === 'createElement') return true;
  return false;
}

/**
 * 解析 cli.js 并提取所有字符串字面量，标注 AST 上下文。
 *
 * @param {string} code - cli.js 源码内容
 * @returns {import('../docs/design.md').ExtractedString[]}
 */
export function extract(code) {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const results = [];

  function classify(node, ancestors) {
    if (typeof node.value !== 'string') return;
    if (node.value.trim() === '') return;

    const entry = { value: node.value, start: node.start, end: node.end, context: 'other' };

    for (let i = ancestors.length - 2; i >= 0; i--) {
      const parent = ancestors[i];

      // createElement 内部分类
      if (parent.type === 'CallExpression' && isCreateElementCall(parent)) {
        const args = parent.arguments;

        // 第1参数：组件类型
        if (args[0] && node.start >= args[0].start && node.end <= args[0].end) {
          entry.context = 'ce:componentType';
          results.push(entry);
          return;
        }

        // 第2参数：props（仅当为 ObjectExpression 时）
        if (args[1] && args[1].type === 'ObjectExpression' && node.start >= args[1].start && node.end <= args[1].end) {
          entry.context = 'ce:propValue';
          results.push(entry);
          return;
        }

        // 第3+参数：children
        for (let j = 2; j < args.length; j++) {
          if (args[j] === node) {
            entry.context = 'ce:childrenDirect';
            results.push(entry);
            return;
          }
          if (node.start >= args[j].start && node.end <= args[j].end) {
            entry.context = 'ce:childrenNested';
            results.push(entry);
            return;
          }
        }

        // createElement 内但未匹配到具体位置 — 保守归入 nested
        entry.context = 'ce:childrenNested';
        results.push(entry);
        return;
      }

      if (parent.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator)) {
        entry.context = 'comparison';
        results.push(entry);
        return;
      }

      if (parent.type === 'SwitchCase') {
        entry.context = 'switchCase';
        results.push(entry);
        return;
      }

      if (parent.type === 'CallExpression' && parent.callee?.type === 'MemberExpression' &&
          parent.callee.property?.type === 'Identifier' &&
          ['startsWith', 'endsWith', 'includes'].includes(parent.callee.property.name)) {
        entry.context = 'startsWith';
        results.push(entry);
        return;
      }

      if (parent.type === 'AssignmentExpression' || parent.type === 'VariableDeclarator') {
        entry.context = 'assignment';
        results.push(entry);
        return;
      }

      if (parent.type === 'CallExpression') {
        entry.context = 'argument';
        results.push(entry);
        return;
      }
    }

    results.push(entry);
  }

  walk.ancestor(ast, { Literal: classify });
  return results;
}

/**
 * 从全部字符串中筛选 P0 翻译候选（ce:childrenDirect，排除噪声）。
 *
 * 噪声过滤规则：
 *   - 单字符
 *   - 纯符号（无字母）
 *   - CSS 类名模式（纯小写+连字符/下划线）
 *   - URL
 *   - 纯小写标识符
 *
 * @param {import('../docs/design.md').ExtractedString[]} strings - extract() 的输出
 * @returns {import('../docs/design.md').ExtractedString[]}
 */
export function filterP0(strings) {
  const seen = new Set();
  return strings.filter(s => {
    if (s.context !== 'ce:childrenDirect') return false;

    const v = s.value;

    // 单字符
    if (v.length <= 1) return false;

    // 纯符号（无字母）
    if (/^[^a-zA-Z]*$/.test(v)) return false;

    // CSS 类名模式
    if (/^[a-z][\w-]*$/.test(v) && (v.includes('-') || v.includes('_'))) return false;

    // URL
    if (/^https?:\/\//.test(v) || v.includes('.com/')) return false;

    // 纯小写标识符
    if (/^[a-z_]+$/.test(v)) return false;

    // 去重（相同 value 只保留第一个）
    if (seen.has(v)) return false;
    seen.add(v);

    return true;
  });
}
