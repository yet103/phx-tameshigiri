// ツールの失敗（設計書 2026-10-03 7.5）。
// 結果は { isError: true, content: [{ type: 'text', text: '<日本語の文>\n' + JSON.stringify({ status, reason, …}) }] }。
// reason はサーバーの値か、クライアントの not_sandbox / confirm_mismatch / no_key / bad_input / network。
export class ToolError extends Error {
  constructor(message, info) {
    super(message);
    this.status = info && info.status !== undefined ? info.status : null;
    this.reason = (info && info.reason) || 'error';
    this.extra = (info && info.extra) || null;
  }
  detail() {
    return Object.assign({ status: this.status, reason: this.reason }, this.extra || {});
  }
}

export function badInput(message, extra) {
  return new ToolError(message, { status: null, reason: 'bad_input', extra });
}
