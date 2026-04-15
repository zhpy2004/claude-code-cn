/**
 * patcher 模块 — 见设计文档 §4.5
 *
 * 分段拼接替换引擎：将翻译字典应用到 cli.js 源码。
 */

/**
 * 将翻译文本转义为可安全嵌入 JS 字符串字面量的形式。
 *
 * @param {string} text      - 翻译文本（纯文本）
 * @param {string} quoteChar - 原字符串的引号字符（" 或 '）
 * @returns {string} 转义后的文本
 */
export function escapeForQuote(text, quoteChar) {
  let escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');

  if (quoteChar === "'") {
    escaped = escaped.replace(/'/g, "\\'");
  } else {
    escaped = escaped.replace(/"/g, '\\"');
  }

  return escaped;
}

/**
 * 根据翻译字典生成补丁后的源码。
 *
 * 算法：分段拼接 O(n+m)
 *   1. 构建字典查找表（key = original + '\0' + context）
 *   2. 筛选有翻译的字符串，按偏移升序排列
 *   3. 遍历替换列表，收集不变片段和翻译片段到数组
 *   4. join('') 生成最终结果
 *
 * @param {string}                                      code    - 原始 cli.js 源码
 * @param {import('../docs/design.md').ExtractedString[]} strings - extractor 提取的字符串列表
 * @param {import('../docs/design.md').Dict}             dict    - 翻译字典
 * @returns {{patched: string, stats: {translated: number, unmatched: number}}}
 */
export function patch(code, strings, dict) {
  // 构建查找表：key = original + '\0' + context → translation
  const lookup = new Map();
  for (const entry of dict.entries) {
    const key = entry.original + '\0' + entry.context;
    lookup.set(key, entry.translation);
  }

  // 筛选 ce:childrenDirect 中有翻译的条目
  const replacements = [];
  let unmatched = 0;

  for (const s of strings) {
    if (s.context !== 'ce:childrenDirect') continue;
    const key = s.value + '\0' + s.context;
    const translation = lookup.get(key);
    if (translation !== undefined) {
      replacements.push({ start: s.start, end: s.end, translation });
    } else {
      unmatched++;
    }
  }

  // 按偏移升序排列
  replacements.sort((a, b) => a.start - b.start);

  // 分段拼接
  const segments = [];
  let lastEnd = 0;

  for (const r of replacements) {
    segments.push(code.slice(lastEnd, r.start));
    const quoteChar = code[r.start];
    const escaped = escapeForQuote(r.translation, quoteChar);
    segments.push(quoteChar + escaped + quoteChar);
    lastEnd = r.end;
  }

  segments.push(code.slice(lastEnd));

  return {
    patched: segments.join(''),
    stats: {
      translated: replacements.length,
      unmatched,
    },
  };
}
