/**
 * 错误类层次 — 见设计文档 §6.1
 */

export class ClaudeCodeCnError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class DetectError extends ClaudeCodeCnError {}
export class BackupError extends ClaudeCodeCnError {}
export class PatchError extends ClaudeCodeCnError {}
export class ValidateError extends ClaudeCodeCnError {}
