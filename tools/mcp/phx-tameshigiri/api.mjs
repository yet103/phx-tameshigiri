// サーバー API の呼び出し（設計書 2026-10-03 7.1・7.4）。
// - Authorization: Bearer <AI 用キー>。キーと Authorization ヘッダーは結果・エラー・ログのどこにも出さない
// - 15 秒で打ち切る。自動の再試行はしない（書き込みの二重実行を避ける）
// - リダイレクトは追わない（別のホストへキーを送らない）
import { ToolError } from './errors.mjs';

export const TIMEOUT_MS = 15000;

// PHX_BASE_URL の検査。https 必須。http は localhost / 127.0.0.1 / [::1] だけ。user:pass@ は拒否。
// 戻り値: { baseUrl, host }。不正なら Error（文に URL の資格情報は含めない）。
export function parseBaseUrl(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) throw new Error('環境変数 PHX_BASE_URL が設定されていません（例: https://tameshigiri.phx-base.org）');
  let u;
  try { u = new URL(s); } catch (e) { throw new Error('PHX_BASE_URL が URL として読めません'); }
  if (u.username || u.password) {
    throw new Error('PHX_BASE_URL に資格情報（user:pass@）を含めないでください');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new Error('PHX_BASE_URL は https:// にしてください（http:// は localhost / 127.0.0.1 だけ）');
  }
  if (u.search || u.hash) throw new Error('PHX_BASE_URL にクエリや # を含めないでください');
  return { baseUrl: u.origin + u.pathname.replace(/\/+$/, ''), host: u.hostname };
}

const AUTH_REASONS = {
  key_invalid: 'AI 用キーが無効です',
  key_expired: 'AI 用キーの期限が切れています',
  key_revoked: 'AI 用キーは取り消されています',
  auth_required: '認証が必要です（AI 用キーが届いていません）'
};

// サーバーの失敗を日本語の文にする（7.4 の 4）
function describeFailure(status, json) {
  const reason = json && typeof json.reason === 'string' ? json.reason : null;
  const serverMsg = json && typeof json.error === 'string' ? json.error : '';
  if (status === 401) {
    return (AUTH_REASONS[reason] || '認証に失敗しました') +
      '。運営画面（PC）の「AI 用キー」で発行し直し、set-key.ps1 を自分のターミナルで実行してください。';
  }
  if (status === 403 && reason === 'sandbox') {
    return 'サーバーが拒否しました: テスト用の大会ではないので AI は書き込めません（名前が「テスト用」で始まる大会だけ。' +
      '削除は AI が作った大会だけ）。本番の大会の操作は運営画面で行ってください。' + (serverMsg ? '（' + serverMsg + '）' : '');
  }
  if (status === 403 && reason === 'role') {
    return 'サーバーが拒否しました: この操作は AI 用キーでは許されていません。' + (serverMsg ? '（' + serverMsg + '）' : '');
  }
  if (status === 429) {
    const ra = json && Number(json.retryAfter);
    return '回数の上限に達しました（AI 用キーは 1 分 60 回・書き込み 30 回・1 日 2,000 回まで）。' +
      (ra > 0 ? ra + ' 秒ほど待ってから' : 'しばらく待ってから') + 'やり直してください（自動ではやり直しません）。';
  }
  if (status === 409 && reason === 'sandbox_quota') {
    return 'AI が作った大会が上限（20 件）に達しています。不要なテスト用の大会を delete_test_event で消してから作ってください。';
  }
  if (status === 409 && reason === 'stale') {
    return '他の端末が先に書き換えました（版が古い）。get_event で読み直してからやり直してください。' + (serverMsg ? '（' + serverMsg + '）' : '');
  }
  if (status === 409 && reason === 'not_scorable') {
    return '今の大会の状態では、この選手は採点できません。' + (serverMsg ? '（' + serverMsg + '）' : '');
  }
  if (status === 404) return '見つかりません。' + (serverMsg ? '（' + serverMsg + '）' : '');
  return 'サーバーがエラーを返しました（HTTP ' + status + '）' + (serverMsg ? ': ' + serverMsg : '');
}

// 失敗の本文から、エラーに添える値（キーを含みうるものは載せない）
function pickExtra(json) {
  if (!json || typeof json !== 'object') return null;
  const out = {};
  for (const k of ['retryAfter', 'fields', 'limit', 'from', 'to', 'status', 'expiresAt']) {
    if (json[k] !== undefined && k !== 'status') out[k] = json[k];
  }
  if (json.status !== undefined) out.eventStatus = json.status;
  return Object.keys(out).length ? out : null;
}

export function createApi({ baseUrl, keyStore, fetchImpl }) {
  const doFetch = fetchImpl || fetch;

  async function request(method, path, body) {
    const key = await keyStore.getKey();
    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + key };
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    let res;
    try {
      res = await doFetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (e) {
      const code = (e && e.cause && e.cause.code) || (e && e.name === 'TimeoutError' ? 'timeout' : '') || (e && e.name) || 'error';
      throw new ToolError('サーバーに接続できませんでした（' + method + ' ' + path + '、' + code + '）。' +
        '通信が 15 秒で終わらなかったか、接続先 ' + baseUrl + ' に届きません。書き込みの場合、サーバーに届いたかどうかは get_event で確かめてください。',
        { status: null, reason: 'network' });
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* JSON でない応答 */ }
    if (res.status >= 300 && res.status < 400) {
      throw new ToolError('サーバーがリダイレクトを返しました（HTTP ' + res.status + '）。PHX_BASE_URL を確かめてください（追いかけません）。',
        { status: res.status, reason: 'redirect' });
    }
    if (!res.ok) {
      if (res.status === 401) keyStore.forget();   // 次の呼び出しで読み直す（キーを替えたとき）
      const reason = json && typeof json.reason === 'string' ? json.reason : null;
      throw new ToolError(describeFailure(res.status, json), { status: res.status, reason: reason || 'http_' + res.status, extra: pickExtra(json) });
    }
    return json;
  }

  // 接続先からコード（/scoring.js など）は取らない。採点の計算はこのリポジトリの scoring.js（scoring-vm.mjs）。
  return { request, baseUrl };
}
