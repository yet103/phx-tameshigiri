#!/usr/bin/env node
// 試し斬り採点システムの MCP サーバー（stdio）。設計書 docs/superpowers/specs/2026-10-03-invite-links-and-ai-key-design.md 7 章。
// 依存なし（Node 18 以上）。改行区切りの JSON-RPC 2.0 を標準入出力で話す。標準出力は JSON-RPC 専用、ログは標準エラーだけ。
//
// MCP の版（2026-10-03 に modelcontextprotocol.io の仕様で確認）:
//   - 新しい版 2026-07-28（modern）: initialize の握手が無く、各リクエストの params._meta に
//     io.modelcontextprotocol/protocolVersion と clientCapabilities を載せる。server/discover が必須。結果に resultType: 'complete'。
//   - 古い版 2025-11-25 以前（legacy）: initialize → notifications/initialized → tools/list・tools/call・ping。
//   両方に答える（dual-era）。initialize が来れば古い版、_meta に版があれば新しい版として答える。
//
// 環境変数: PHX_BASE_URL（必須）/ PHX_KEY_SOURCE（vault|env。Windows の既定 vault）/ PHX_AI_KEY（env のとき）/
//           PHX_VAULT_RESOURCE（既定 phx-tameshigiri-ai）
import { parseBaseUrl, createApi } from './api.mjs';
import { ToolError } from './errors.mjs';
import { createKeyStore, DEFAULT_VAULT_RESOURCE } from './keystore.mjs';
import { TOOL_DEFS, createHandlers } from './tools.mjs';

const SERVER_INFO = { name: 'phx-tameshigiri', title: '試し斬り採点システム（AI 用キー）', version: '1.0.0' };
const MODERN_VERSIONS = ['2026-07-28'];
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
const INSTRUCTIONS = '試し斬り採点システムの API を AI 用キーで操作する。書き込めるのは名前が「テスト用」で始まる大会だけ' +
  '（本番の大会は一覧・詳細・順位を読むだけ。書き込みを頼まれたら断り、運営画面での操作を案内する）。' +
  '大会の削除・final / archived への状態遷移は、実行前に大会名と操作をユーザーに示して承認を得る。' +
  '予行の流れ: create_test_event → add_players → change_status(round1) → auto_score → change_status(round1_done) → ' +
  'change_status(round2) → auto_score → change_status(round2_done) → get_ranking → delete_test_event。';

// 標準出力に誤ってログを書かない（JSON-RPC が壊れる）
console.log = (...a) => console.error(...a);
console.info = console.log;

// ───────── 設定 ─────────
let config;
try {
  const { baseUrl, host } = parseBaseUrl(process.env.PHX_BASE_URL);
  const source = (process.env.PHX_KEY_SOURCE || (process.platform === 'win32' ? 'vault' : 'env')).trim();
  if (source !== 'vault' && source !== 'env') throw new Error('PHX_KEY_SOURCE は vault か env です');
  if (source === 'vault' && process.platform !== 'win32') throw new Error('PHX_KEY_SOURCE=vault は Windows だけです（他の OS は env）');
  config = {
    baseUrl,
    source,
    vaultResource: (process.env.PHX_VAULT_RESOURCE || DEFAULT_VAULT_RESOURCE).trim(),
    vaultUser: host
  };
} catch (e) {
  await new Promise(resolve => process.stderr.write('[phx-tameshigiri] 起動できません: ' + e.message + '\n', resolve));
  process.exit(2);
}

const keyStore = createKeyStore(config);
const api = createApi({ baseUrl: config.baseUrl, keyStore });
const handlers = createHandlers(api);
const redact = s => keyStore.redact(s);
const log = msg => process.stderr.write(redact('[phx-tameshigiri] ' + msg) + '\n');

log('起動しました（接続先 ' + config.baseUrl + '、キーの読み方 ' + config.source +
  (config.source === 'vault' ? '（' + config.vaultResource + ' / ' + config.vaultUser + '）' : '') + '）');

// ───────── 送信 ─────────
function send(msg) {
  // 1 行 1 メッセージ（JSON.stringify は改行を含めない）。念のためキーを伏せる
  process.stdout.write(redact(JSON.stringify(msg)) + '\n');
}
function sendResult(id, result) { send({ jsonrpc: '2.0', id, result }); }
function sendError(id, code, message, data) {
  const error = { code, message: redact(message) };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id: id === undefined ? null : id, error });
}

// ───────── ツールの実行 ─────────
async function callTool(params) {
  const name = params && params.name;
  const def = TOOL_DEFS.find(t => t.name === name);
  if (!def) return { protocolError: { code: -32602, message: 'Unknown tool: ' + String(name).slice(0, 100) } };
  const args = (params && params.arguments && typeof params.arguments === 'object') ? params.arguments : {};
  try {
    const value = await handlers[name](args);
    log('tool ' + name + ': ok');
    return { result: { content: [{ type: 'text', text: redact(JSON.stringify(value)) }], isError: false } };
  } catch (e) {
    let te = e;
    if (!(e instanceof ToolError)) {
      te = new ToolError('MCP サーバーの中で失敗しました: ' + (e && e.message ? e.message : String(e)), { status: null, reason: 'internal' });
    }
    log('tool ' + name + ': error ' + te.reason + (te.status ? ' (HTTP ' + te.status + ')' : ''));
    return {
      result: {
        content: [{ type: 'text', text: redact(te.message + '\n' + JSON.stringify(te.detail())) }],
        isError: true
      }
    };
  }
}

// ───────── 受信 ─────────
const pending = new Set();
let inputClosed = false;

function isModern(params) {
  return !!(params && params._meta && typeof params._meta === 'object' && params._meta[META_VERSION] !== undefined);
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // 応答（client → server の result/error）は受け取っても何もしない
    if (msg && typeof msg === 'object' && !Array.isArray(msg) && msg.jsonrpc === '2.0' && msg.method === undefined &&
        (msg.result !== undefined || msg.error !== undefined)) return;
    return sendError(msg && typeof msg === 'object' && !Array.isArray(msg) ? msg.id : null, -32600, 'Invalid Request');
  }
  const isRequest = msg.id !== undefined && msg.id !== null;
  const method = msg.method;
  const params = (msg.params && typeof msg.params === 'object') ? msg.params : {};

  // 通知（応答しない）
  if (!isRequest) return;   // notifications/initialized・notifications/cancelled など

  const modern = isModern(params);
  if (modern) {
    const v = params._meta[META_VERSION];
    if (!MODERN_VERSIONS.includes(v)) {
      return sendError(msg.id, -32022, 'Unsupported protocol version', { supported: MODERN_VERSIONS.concat(LEGACY_VERSIONS), requested: v });
    }
    const caps = params._meta[META_CAPS];
    if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
      return sendError(msg.id, -32602, 'Invalid params: _meta["' + META_CAPS + '"] is required');
    }
  }
  const ok = result => sendResult(msg.id, modern
    ? Object.assign({ resultType: 'complete' }, result, { _meta: { [META_SERVER_INFO]: SERVER_INFO } })
    : result);

  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      const version = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
      return sendResult(msg.id, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      });
    }
    case 'server/discover': {
      if (!modern) {
        return sendError(msg.id, -32602, 'Invalid params: _meta["' + META_VERSION + '"] is required (supported: ' +
          MODERN_VERSIONS.concat(LEGACY_VERSIONS).join(', ') + ')');
      }
      return ok({ supportedVersions: MODERN_VERSIONS.slice(), capabilities: { tools: {} }, instructions: INSTRUCTIONS });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOL_DEFS });
    case 'tools/call': {
      const r = await callTool(params);
      if (r.protocolError) return sendError(msg.id, r.protocolError.code, r.protocolError.message);
      return ok(r.result);
    }
    default:
      return sendError(msg.id, -32601, 'Method not found: ' + method.slice(0, 100));
  }
}

function onLine(line) {
  const s = line.trim();
  if (!s) return;
  let msg;
  try {
    msg = JSON.parse(s);
  } catch (e) {
    return sendError(null, -32700, 'Parse error');
  }
  if (Array.isArray(msg)) return sendError(null, -32600, 'Invalid Request: batch is not supported');
  const p = Promise.resolve().then(() => handle(msg)).catch(e => {
    log('内部エラー: ' + (e && e.message ? e.message : String(e)));
    if (msg && msg.id !== undefined && msg.id !== null) sendError(msg.id, -32603, 'Internal error');
  }).finally(() => {
    pending.delete(p);
    maybeExit();
  });
  pending.add(p);
}

function maybeExit() {
  if (inputClosed && pending.size === 0) {
    // 書き出しが終わってから終了する
    process.stdout.write('', () => process.exit(0));
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    onLine(line);
  }
});
process.stdin.on('end', () => {
  if (buf.trim()) onLine(buf);
  buf = '';
  inputClosed = true;
  maybeExit();
});
