/**
 * validator 模块 — 见设计文档 §4.6
 *
 * 使用 acorn 重新解析补丁后的代码，确认语法完整。
 */

import { parse } from 'acorn';

/**
 * 验证补丁后的源码语法正确性。
 *
 * @param {string} code - 补丁后的源码
 * @returns {{valid: boolean, error: string|null}}
 */
export function validate(code) {
  try {
    parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
    return { valid: true, error: null };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
