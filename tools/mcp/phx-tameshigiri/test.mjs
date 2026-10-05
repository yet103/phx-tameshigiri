// MCP サーバー（server.mjs）の自動テスト（設計書 2026-10-03 8.1「MCP サーバー」）。依存なし（Node 18 以上）。
//
//   node tools/mcp/phx-tameshigiri/test.mjs [--vault]
//
// - プロジェクトのサーバー（server/index.js）を一時データ（TMG_DATA_DIR）・テスト用の Basic 認証で起動し、
//   Basic で AI 用キーを発行して、PHX_KEY_SOURCE=env で MCP サーバーを子プロセスとして起動し、stdio で JSON-RPC を話す。
// - 予行と同じ流れ（作成 → 男子 10・女子 8 の登録 → 試合開始 → 採点 → 一巡目終了 → 二巡目 → 二巡目終了 → 順位 → 削除）、
//   安全策（本番の大会への書き込みはクライアントで拒否・サーバーでも 403 sandbox、confirmName の不一致、final は force 無しで拒否）、
//   キーが MCP サーバーの標準出力・標準エラーのどこにも出ないこと、を確かめる。
// - --vault: 資格情報マネージャーの経路も確かめる。テスト用のリソース名（phx-tameshigiri-ai-test）に一時キーを保存し、
//   読めることを確かめてから必ず消す。ユーザーの本物のリソース（phx-tameshigiri-ai）には触れない。
//
// 環境変数（任意）: PHX_TEST_PORT（既定は空きポート）/ PHX_TEST_DATA_DIR（既定は os.tmpdir() の tmg-mcp-*。終わったら消す）
// プロジェクトの server/data には触れない。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const SERVER_INDEX = path.join(REPO, 'server', 'index.js');
const MCP_SERVER = path.join(HERE, 'server.mjs');
const USER = 'staff';
const PASS = 'mcp-test:pa55';
const BASIC = 'Basic ' + Buffer.from(USER + ':' + PASS).toString('base64');
const WIDE = { perMinute: 600, writesPerMinute: 300, perDay: 20000 };
const VAULT_TEST_RESOURCE = 'phx-tameshigiri-ai-test';
const WITH_VAULT = process.argv.includes('--vault');

// ───────── 小道具 ─────────
let passed = 0, failed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log('✓ ' + name);
  } catch (e) {
    failed++;
    console.log('✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n    '));
    throw e;
  }
}
// 失敗しても続ける（独立した確認）
async function check(name, fn) {
  try { await step(name, fn); } catch (e) { /* 記録済み */ }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────── プロジェクトのサーバー ─────────
async function startProjectServer(port, dataDir) {
  const child = spawn(process.execPath, [SERVER_INDEX], {
    env: Object.assign({}, process.env, {
      PORT: String(port), TMG_DATA_DIR: dataDir, NODE_ENV: 'development', AUTH_USER: USER, AUTH_PASS: PASS,
      PUBLIC_ORIGIN: '', TRUST_PROXY: '', COOKIE_SECURE: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let out = '';
  const exit = new Promise(r => child.on('exit', code => r(code)));
  await new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; if (out.includes('running at')) resolve(); });
    child.stderr.on('data', d => { out += d; });
    exit.then(code => reject(new Error('サーバーが終了しました（' + code + '）\n' + out)));
    setTimeout(() => reject(new Error('サーバーが 10 秒で起動しませんでした\n' + out)), 10000).unref();
  });
  return { base: 'http://localhost:' + port, output: () => out, stop: () => { child.kill(); return exit; } };
}

async function http(base, method, p, body, auth) {
  const headers = { Accept: 'application/json' };
  if (auth) headers.Authorization = auth;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(10000)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 文字列 */ }
  return { status: res.status, body: json, text };
}

// ───────── MCP のクライアント ─────────
const ALL_MCP_OUTPUT = [];   // 全 MCP プロセスの標準出力・標準エラー（キーの漏れの確認用）

class McpClient {
  constructor(env) {
    this.child = spawn(process.execPath, [MCP_SERVER], {
      env: Object.assign({}, process.env, { PHX_AI_KEY: '', PHX_KEY_SOURCE: '', PHX_VAULT_RESOURCE: '' }, env),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.out = '';
    this.err = '';
    this.buf = '';
    this.nextId = 1;
    this.waiters = new Map();
    this.unsolicited = [];
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', d => {
      this.out += d;
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);   // 1 行 1 JSON でなければここで落ちる（それもテスト）
        const w = this.waiters.get(msg.id);
        if (w) { this.waiters.delete(msg.id); w(msg); } else this.unsolicited.push(msg);
      }
    });
    this.child.stderr.on('data', d => { this.err += d; });
    this.exit = new Promise(r => this.child.on('exit', code => {
      ALL_MCP_OUTPUT.push(this.out, this.err);
      r(code);
    }));
  }
  sendRaw(line) { this.child.stdin.write(line + '\n'); }
  request(method, params, timeoutMs) {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method };
    if (params !== undefined) msg.params = params;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiters.delete(id); reject(new Error('応答がありません: ' + method)); }, timeoutMs || 30000);
      this.waiters.set(id, m => { clearTimeout(t); resolve(m); });
      this.sendRaw(JSON.stringify(msg));
    });
  }
  waitAny(timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (this.unsolicited.length) return resolve(this.unsolicited.shift());
        if (Date.now() - start > timeoutMs) return reject(new Error('応答がありません'));
        setTimeout(tick, 20);
      };
      tick();
    });
  }
  notify(method, params) {
    const msg = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    this.sendRaw(JSON.stringify(msg));
  }
  async init() {
    const r = await this.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phx-mcp-test', version: '1' } });
    this.notify('notifications/initialized');
    return r;
  }
  // ツールを呼ぶ。戻り値: { isError, text, value（成功なら JSON）, detail（失敗なら最後の行の JSON）}
  async call(name, args) {
    const r = await this.request('tools/call', { name, arguments: args || {} }, 60000);
    if (r.error) throw new Error('JSON-RPC のエラー: ' + JSON.stringify(r.error));
    const text = r.result.content[0].text;
    assert.equal(r.result.content[0].type, 'text');
    if (r.result.isError) {
      const lines = text.split('\n');
      return { isError: true, text, detail: JSON.parse(lines[lines.length - 1]) };
    }
    return { isError: false, text, value: JSON.parse(text) };
  }
  async ok(name, args) {
    const r = await this.call(name, args);
    if (r.isError) throw new Error(name + ' が失敗しました: ' + r.text);
    return r.value;
  }
  async close() {
    this.child.stdin.end();
    const code = await Promise.race([this.exit, new Promise(r => setTimeout(() => r('timeout'), 5000))]);
    if (code === 'timeout') { this.child.kill(); await this.exit; }
    return code;
  }
}

// 起動を拒否される設定（すぐ終了する）
async function expectStartRefused(env) {
  const c = new McpClient(env);
  const code = await Promise.race([c.exit, new Promise(r => setTimeout(() => r('timeout'), 5000))]);
  if (code === 'timeout') c.child.kill();
  return { code, err: c.err, out: c.out };
}

// ───────── 期待値の独立した計算（予行スクリプトと同じ） ─────────
const ORDER = /^([^-]+)-(男子|女子)-(\d+)-(\d+)$/;
const parseOrder = o => { const m = ORDER.exec(String(o || '')); return m ? { court: m[1], gender: m[2], round: +m[3], number: +m[4] } : null; };
const roundOf = p => { const o = parseOrder(p.order); return o ? o.round : 1; };
function rankOf(list) {
  const e = list.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ja'));
  let cur = 1, prev = null;
  return e.map((x, i) => { if (prev !== null && x.score !== prev) cur = i + 1; prev = x.score; return { rank: cur, name: x.name, score: x.score }; });
}
function sameRanking(actual, exp) {
  if (!Array.isArray(actual) || actual.length !== exp.length) return false;
  const key = l => { const m = new Map(); l.forEach(x => { const k = x.rank + '|' + x.score; m.set(k, (m.get(k) || []).concat(x.name).sort()); }); return JSON.stringify([...m.entries()].sort()); };
  return actual.every((x, i) => x.rank === exp[i].rank && x.score === exp[i].score) && key(actual) === key(exp);
}
function techniqueOptions(techniques, isFemale) {
  const suffix = isFemale ? '(女)' : '(男)';
  const other = isFemale ? '(男)' : '(女)';
  const out = [];
  (techniques || []).forEach(t => {
    const name = (t && typeof t.name === 'string') ? t.name : '';
    if (!name || name.slice(-3) === other) return;
    const shown = name.slice(-3) === suffix ? name.slice(0, -3) : name;
    if (!shown || out.includes(shown)) return;
    out.push(shown);
  });
  return out;
}
function loadLocalScoring() {
  const ctx = vm.createContext({ TECHNIQUES: [] });
  vm.runInContext(fs.readFileSync(path.join(REPO, 'scoring.js'), 'utf8'), ctx);
  return ctx.Scoring;
}

function readAudit(dataDir) {
  const f = path.join(dataDir, 'auth', 'audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// ───────── 資格情報マネージャー（--vault のときだけ。テスト用のリソース名だけを触る） ─────────
function ps(script, env, stdinText) {
  return new Promise(resolve => {
    const root = process.env.SystemRoot || 'C:\\Windows';
    const exe = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], {
      env: Object.assign({}, process.env, env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', () => {});
    child.on('close', code => resolve({ code, out: out.trim() }));
    child.stdin.end(stdinText || '');
  });
}
const PS_LOAD = "$ErrorActionPreference='Stop'; [void][Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]; $v = New-Object Windows.Security.Credentials.PasswordVault;";
function assertTestResource(r) {
  if (r !== VAULT_TEST_RESOURCE) throw new Error('テスト用のリソース名以外には触れません: ' + r);
}
async function vaultStore(resource, user, key) {
  assertTestResource(resource);
  // キーは標準入力で渡す（コマンドラインに載せない）
  return ps(PS_LOAD + " $k = [Console]::In.ReadLine(); try { $v.Remove($v.Retrieve($env:R, $env:U)) } catch { }; " +
    '$v.Add((New-Object Windows.Security.Credentials.PasswordCredential($env:R, $env:U, $k))); $k = $null; "stored"',
  { R: resource, U: user }, key + '\n');
}
async function vaultRemoveAll(resource) {
  assertTestResource(resource);
  return ps(PS_LOAD + ' $n = 0; try { foreach ($c in $v.FindAllByResource($env:R)) { $v.Remove($c); $n++ } } catch { }; "removed=$n"',
    { R: resource });
}
async function vaultCount(resource) {
  assertTestResource(resource);
  const r = await ps(PS_LOAD + ' try { @($v.FindAllByResource($env:R)).Count } catch { 0 }', { R: resource });
  return Number(r.out);
}

// ═════════ 本体 ═════════
const port = process.env.PHX_TEST_PORT ? Number(process.env.PHX_TEST_PORT) : await freePort();
const ownDataDir = !process.env.PHX_TEST_DATA_DIR;
const dataDir = ownDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'tmg-mcp-')) : path.resolve(process.env.PHX_TEST_DATA_DIR);
fs.mkdirSync(dataDir, { recursive: true });
if (path.resolve(dataDir).startsWith(path.join(REPO, 'server', 'data'))) throw new Error('プロジェクトの server/data は使いません');

console.log('プロジェクトのサーバー: port ' + port + ' / データ ' + dataDir);
const server = await startProjectServer(port, dataDir);
const base = server.base;
const clients = [];
const secrets = [];   // 出力に出てはいけない文字列
let vaultTouched = false;

try {
  // ── 採点の計算はこのリポジトリのコードだけ（接続先からコードを取って実行しない）──
  await check('scoring-vm: scoring.js と status.js はこのリポジトリから読む。接続先から取らない。vm の文脈にホストの値が無い', async () => {
    const sv = await import('./scoring-vm.mjs');
    const { Scoring, source } = sv.loadScoring();
    assert.equal(source, 'local');
    // 文脈の中で作った TECHNIQUES（技を設定する前の既定）から constructor をたどっても process に届かない
    const inner = Scoring.findTechnique.constructor;   // 文脈の Function
    assert.notEqual(inner, Function);
    assert.equal(inner('return typeof process')(), 'undefined');
    assert.equal(inner('return typeof require')(), 'undefined');
    const techs = inner('return TECHNIQUES')();
    assert.ok(Array.isArray(techs) && techs.length === 0);
    assert.equal(techs.constructor.constructor('return typeof process')(), 'undefined', 'TECHNIQUES がホストの配列');
    const EventStatus = sv.loadStatus();
    assert.equal(typeof EventStatus.isScoringOpen, 'function');
    assert.equal(EventStatus.isScoringOpen.constructor('return typeof process')(), 'undefined');
    // API はコードの取得口を持たない。通信は request（JSON の API）だけ
    const { createApi } = await import('./api.mjs');
    const seen = [];
    const api = createApi({ baseUrl: 'http://127.0.0.1:9', keyStore: { getKey: async () => null, forget() {} }, fetchImpl: async u => { seen.push(u); throw new Error('no'); } });
    assert.equal(api.fetchPublicText, undefined);
    const src = fs.readFileSync(path.join(HERE, 'scoring-vm.mjs'), 'utf8') + fs.readFileSync(path.join(HERE, 'tools.mjs'), 'utf8');
    assert.ok(!/fetchPublicText|['"]\/scoring\.js['"]/.test(src), 'scoring.js を接続先から取るコードが残っている');
    assert.equal(seen.length, 0);
  });

  // ── 準備: キーの発行（Basic）と「本番風」の大会 ──
  const issued = await http(base, 'POST', '/api/ai-keys', { label: 'MCP テスト', limits: WIDE }, BASIC);
  assert.equal(issued.status, 201, issued.text);
  const KEY = issued.body.key;
  secrets.push(KEY, KEY.split('.')[2]);
  const prodCreate = await http(base, 'POST', '/api/events', {
    name: '本番風の大会', date: '2026-10-12', venue: '', settings: { courts: ['A', 'B'] },
    players: [{ id: 'pa1', name: '甲', order: 'A-男子-1-1', tech1: '真' }, { id: 'pb1', name: '乙', order: 'B-男子-1-1', tech1: '真' }]
  }, BASIC);
  assert.equal(prodCreate.status, 200, prodCreate.text);
  const PROD = prodCreate.body.id;
  assert.equal((await http(base, 'POST', '/api/events/' + PROD + '/status', { to: 'round1' }, BASIC)).status, 200);
  const adminSand = (await http(base, 'POST', '/api/events', { name: 'テスト用 運営の大会', settings: { courts: ['A'] } }, BASIC)).body.id;

  const env = { PHX_BASE_URL: base, PHX_KEY_SOURCE: 'env', PHX_AI_KEY: KEY };
  const mcp = new McpClient(env);
  clients.push(mcp);

  // ── プロトコル ──
  await step('initialize（古い版）: 版をそのまま返し、tools の capability と serverInfo', async () => {
    const r = await mcp.init();
    assert.equal(r.result.protocolVersion, '2025-11-25');
    assert.deepEqual(r.result.capabilities, { tools: {} });
    assert.equal(r.result.serverInfo.name, 'phx-tameshigiri');
    assert.ok(r.result.instructions.includes('テスト用'));
    const old = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
    assert.equal(old.result.protocolVersion, '2025-06-18');
    const unknown = await mcp.request('initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
    assert.equal(unknown.result.protocolVersion, '2025-11-25', '知らない版には自分の最新の版を返す');
    const ping = await mcp.request('ping');
    assert.deepEqual(ping.result, {});
  });

  const TOOL_NAMES = ['whoami', 'list_events', 'get_event', 'create_test_event', 'add_players', 'score_player',
    'auto_score', 'change_status', 'get_ranking', 'delete_test_event'];
  await step('tools/list: 10 本、どれも inputSchema が object', async () => {
    const r = await mcp.request('tools/list', {});
    assert.deepEqual(r.result.tools.map(t => t.name), TOOL_NAMES);
    r.result.tools.forEach(t => {
      assert.equal(t.inputSchema.type, 'object', t.name);
      assert.ok(t.description.length > 10, t.name);
    });
  });

  const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'phx-mcp-test', version: '1' } };
  await step('新しい版（2026-07-28）: server/discover・tools/list・tools/call に resultType と serverInfo。知らない版は -32022、_meta 不足は -32602', async () => {
    const d = await mcp.request('server/discover', { _meta: META });
    assert.equal(d.result.resultType, 'complete');
    assert.deepEqual(d.result.supportedVersions, ['2026-07-28']);
    assert.deepEqual(d.result.capabilities, { tools: {} });
    assert.equal(d.result._meta['io.modelcontextprotocol/serverInfo'].name, 'phx-tameshigiri');
    const l = await mcp.request('tools/list', { _meta: META });
    assert.equal(l.result.resultType, 'complete');
    assert.equal(l.result.tools.length, 10);
    const w = await mcp.request('tools/call', { name: 'whoami', arguments: {}, _meta: META });
    assert.equal(w.result.resultType, 'complete');
    assert.equal(w.result.isError, false);
    const bad = await mcp.request('tools/list', { _meta: Object.assign({}, META, { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' }) });
    assert.equal(bad.error.code, -32022);
    assert.ok(bad.error.data.supported.includes('2026-07-28') && bad.error.data.requested === '1900-01-01');
    const noCaps = await mcp.request('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } });
    assert.equal(noCaps.error.code, -32602);
    const legacyDiscover = await mcp.request('server/discover', {});
    assert.equal(legacyDiscover.error.code, -32602);
  });

  await step('JSON-RPC の誤り: 知らないメソッド -32601、知らないツール -32602、壊れた JSON -32700、通知には応答しない', async () => {
    assert.equal((await mcp.request('resources/list', {})).error.code, -32601);
    assert.equal((await mcp.request('tools/call', { name: 'drop_database', arguments: {} })).error.code, -32602);
    mcp.notify('notifications/cancelled', { requestId: 999 });
    mcp.sendRaw('{not json');
    const pe = await mcp.waitAny(5000);
    assert.equal(pe.error.code, -32700);
    assert.equal(pe.id, null);
    // 通知のあとに来る応答は、次の ping の応答だけ
    assert.deepEqual((await mcp.request('ping')).result, {});
    assert.equal(mcp.unsolicited.length, 0);
  });

  // ── 読み ──
  await step('whoami: ラベル・期限・残り・接頭辞（キーは返さない）', async () => {
    const r = await mcp.call('whoami');
    assert.equal(r.isError, false);
    assert.equal(r.value.keyLabel, 'MCP テスト');
    assert.equal(r.value.sandboxPrefix, 'テスト用');
    assert.equal(r.value.baseUrl, base);
    assert.ok(r.value.remaining && r.value.remaining.day > 0);
  });
  await step('list_events: 本番の大会は sandbox: false。includeProduction: false で外れる', async () => {
    const all = await mcp.ok('list_events');
    const prod = all.find(e => e.id === PROD);
    assert.equal(prod.sandbox, false);
    assert.equal(all.find(e => e.id === adminSand).sandbox, true);
    const sand = await mcp.ok('list_events', { includeProduction: false });
    assert.ok(!sand.some(e => e.id === PROD));
  });

  // ── 予行の流れ ──
  let EID, EVENT_NAME, techniques;
  await step('create_test_event: 「テスト用」を先頭に足して作る（test・createdBy ai）', async () => {
    const r = await mcp.ok('create_test_event', { name: 'MCP 予行', date: '2026-10-12', venue: 'テスト（MCP）' });
    assert.equal(r.name, 'テスト用 MCP 予行');
    assert.ok(r.note);
    EID = r.id;
    EVENT_NAME = r.name;
    const file = (await http(base, 'GET', '/api/events/' + EID, undefined, BASIC)).body;
    assert.deepEqual([file.name, file.test, file.createdBy, file.status, file.settings.courts], [EVENT_NAME, true, 'ai', 'draft', ['A', 'B']]);
    const r2 = await mcp.ok('create_test_event', { name: 'テスト用 二つ目', courts: ['東'] });
    assert.equal(r2.name, 'テスト用 二つ目', '既に「テスト用」なら足さない');
    assert.equal(r2.note, undefined);
    assert.equal((await mcp.ok('delete_test_event', { eventId: r2.id, confirmName: 'テスト用 二つ目' })).deleted, true);
  });

  const SEED = 20261001;
  const rnd = mulberry32(SEED);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const NEWFACE = new Set(['予行 男子02', '予行 男子07', '予行 女子03']);
  const pad2 = n => String(n).padStart(2, '0');
  await step('get_event と add_players: 男子 10（A5・B5）・女子 8（A4・B4）、技は技得点表から 3 つ', async () => {
    const ev = await mcp.ok('get_event', { eventId: EID });
    assert.equal(ev.sandbox, true);
    assert.equal(ev.createdByAi, true);
    assert.ok(ev.techniques.length > 10);
    techniques = ev.techniques;
    const specs = [];
    for (let i = 1; i <= 10; i++) specs.push({ name: '予行 男子' + pad2(i), isFemale: false, court: i <= 5 ? 'A' : 'B' });
    for (let i = 1; i <= 8; i++) specs.push({ name: '予行 女子' + pad2(i), isFemale: true, court: i <= 4 ? 'A' : 'B' });
    const players = specs.map(s => {
      const opts = techniqueOptions(techniques, s.isFemale);
      const techs = [];
      while (techs.length < 3) { const t = pick(opts); if (!techs.includes(t)) techs.push(t); }
      return { name: s.name, court: s.court, isFemale: s.isFemale, isNewFace: NEWFACE.has(s.name), tech1: techs[0], tech2: techs[1], tech3: techs[2] };
    });
    const r = await mcp.ok('add_players', { eventId: EID, players });
    assert.equal(r.created, 18);
    assert.equal(r.players.length, 18);
    assert.ok(r.players.every(p => p.id && /^[AB]-(男子|女子)-1-\d+$/.test(p.order)));
  });

  await step('change_status: 試合開始（draft → round1）', async () => {
    const r = await mcp.ok('change_status', { eventId: EID, to: 'round1' });
    assert.deepEqual([r.from, r.status], ['draft', 'round1']);
  });

  const Scoring = loadLocalScoring();
  await step('score_player: 採点画面と同じ計算（独立に計算した得点と一致）。行の数・配点 null の太刀・△ の誤りは拒否', async () => {
    const ev = await mcp.ok('get_event', { eventId: EID, round: 1, court: 'A' });
    const p = ev.players.find(x => !x.isFemale);
    const techs = [p.tech1, p.tech2, p.tech3].filter(Boolean);
    Scoring.setTechniques(techniques);
    const rows = techs.map((name, i) => {
      const t = Scoring.findTechnique(name, false);
      const values = t.strikes.map((s, k) => (s === null ? '' : (k === 0 ? '○' : (i === 1 ? '×' : '○'))));
      return { values, adjust: i === 0 ? 2 : 0 };
    });
    const expected = Scoring.calcTotalScore(rows.map((r, i) => ({ techName: techs[i], values: r.values, adjust: r.adjust })), false, -1);
    const r = await mcp.ok('score_player', { eventId: EID, playerId: p.id, rows, totalAdjust: -1 });
    assert.equal(r.score, expected);
    assert.equal(r.confirmed, true);
    assert.equal(r.rev, 1);
    const file = (await http(base, 'GET', '/api/events/' + EID, undefined, BASIC)).body.players.find(x => x.id === p.id);
    assert.equal(file.result, Scoring.encodeResult(rows));
    assert.deepEqual(file.adjust, [2, 0, 0]);
    // 誤り
    const short = await mcp.call('score_player', { eventId: EID, playerId: p.id, rows: rows.slice(0, 1) });
    assert.deepEqual([short.isError, short.detail.reason], [true, 'bad_input']);
    const t0 = Scoring.findTechnique(techs[0], false);
    const nullIdx = t0.strikes.indexOf(null);
    if (nullIdx !== -1) {
      const bad = rows.map(r => ({ values: r.values.slice() }));
      bad[0].values[nullIdx] = '○';
      const r2 = await mcp.call('score_player', { eventId: EID, playerId: p.id, rows: bad });
      assert.deepEqual([r2.isError, r2.detail.reason], [true, 'bad_input']);
    }
    const tri = rows.map(r => ({ values: r.values.slice() }));
    tri[0].values[0] = '△';
    if (typeof t0.reducedFirst !== 'number') {
      const r3 = await mcp.call('score_player', { eventId: EID, playerId: p.id, rows: tri });
      assert.deepEqual([r3.isError, r3.detail.reason], [true, 'bad_input']);
    }
  });

  await step('auto_score（一巡目）: 確定済みの 1 名を飛ばして 17 名を採点・確定', async () => {
    const r = await mcp.ok('auto_score', { eventId: EID });
    assert.equal(r.status, 'round1');
    assert.equal(r.scored, 17);
    assert.equal(r.skipped, 1);
    const again = await mcp.ok('auto_score', { eventId: EID });
    assert.deepEqual([again.scored, again.skipped], [0, 18], '2 回目は全員確定済みで何もしない');
    const ev = await mcp.ok('get_event', { eventId: EID, round: 1 });
    assert.ok(ev.players.every(p => p.confirmed === true));
  });

  await step('change_status: 一巡目を終了（二巡目を生成）→ 二巡目を開始', async () => {
    const r = await mcp.ok('change_status', { eventId: EID, to: 'round1_done' });
    assert.equal(r.status, 'round1_done');
    assert.equal(r.round2.created, 18);
    assert.ok(!('finalistCount' in r.round2) && !('finalistDiff' in r.round2), '最終組の項目は無い（設計書 2026-10-05）');
    const ev = (await http(base, 'GET', '/api/events/' + EID, undefined, BASIC)).body;
    assert.ok(ev.players.every(p => p.finalist === undefined), 'finalist の印はどの行にも付かない');
    assert.equal((await mcp.ok('change_status', { eventId: EID, to: 'round2' })).status, 'round2');
  });

  await step('change_status: round2_final は今は無い状態なので bad_input（API を呼ばない）', async () => {
    const r = await mcp.call('change_status', { eventId: EID, to: 'round2_final' });
    assert.deepEqual([r.isError, r.detail.reason], [true, 'bad_input'], r.text);
    const ev = (await http(base, 'GET', '/api/events/' + EID, undefined, BASIC)).body;
    assert.equal(ev.status, 'round2', '状態は変わらない');
  });

  await step('auto_score（二巡目）: 18 名全員をコート → 男子・女子 → 番号の順に採点 → 二巡目を終了', async () => {
    const r = await mcp.ok('auto_score', { eventId: EID, seed: 7 });
    assert.equal(r.status, 'round2');
    assert.deepEqual([r.scored, r.skipped], [18, 0]);
    const ev = (await http(base, 'GET', '/api/events/' + EID, undefined, BASIC)).body;
    const r2 = ev.players.filter(p => roundOf(p) === 2).sort((a, b) => {
      const oa = parseOrder(a.order), ob = parseOrder(b.order);
      if (oa.court !== ob.court) return oa.court < ob.court ? -1 : 1;
      if (oa.gender !== ob.gender) return oa.gender === '男子' ? -1 : 1;
      return oa.number - ob.number;
    });
    assert.deepEqual(r.players.map(p => p.id), r2.map(p => p.id), '試技順に採点した');
    assert.ok(r2.every(p => p.confirmed === true));
    assert.equal((await mcp.ok('change_status', { eventId: EID, to: 'round2_done' })).status, 'round2_done');
  });

  await step('get_ranking: 一般男子・一般女子・新人・ベスト4 が期待（独立の計算）と一致。finale は無く event.status は round2_done', async () => {
    const rk = await mcp.ok('get_ranking', { eventId: EID });
    const ev = (await http(base, 'GET', '/api/events/' + EID, undefined, BASIC)).body;
    const r1rows = ev.players.filter(p => roundOf(p) === 1);
    const r1 = new Map(r1rows.map(p => [p.id, p.score]));
    const r2 = new Map(ev.players.filter(p => roundOf(p) === 2).map(p => [p.sourcePlayerId, p.score]));
    assert.ok(ev.players.every(p => p.confirmed === true), '全員確定済み');
    const total = id => r1.get(id) + (r2.get(id) || 0);
    const mk = p => ({ name: p.name, score: total(p.id) });
    assert.ok(sameRanking(rk.rankings.male, rankOf(r1rows.filter(p => !p.isFemale).map(mk))), '一般男子');
    assert.ok(sameRanking(rk.rankings.female, rankOf(r1rows.filter(p => p.isFemale).map(mk))), '一般女子');
    assert.ok(sameRanking(rk.rankings.newFace, rankOf(r1rows.filter(p => p.isNewFace).map(mk))), '新人');
    assert.ok(!('finale' in rk), 'finale は無い（設計書 2026-10-05 D3）');
    assert.equal(rk.event.status, 'round2_done');
    // ベスト4（合計の一般男子上位 4、0 点以下除外、4 位同点は全員）。全員確定済みなので確定（設計書 2026-10-04）
    const totals = rankOf(r1rows.filter(p => !p.isFemale).map(mk)).filter(x => x.score > 0 && x.rank <= 4);
    assert.deepEqual([rk.best4.final, rk.best4.remaining], [true, 0], 'ベスト4 は確定');
    assert.deepEqual(rk.best4.rows.map(r => [r.rank, r.name, r.total]), totals.map(x => [x.rank, x.name, x.score]), 'ベスト4');
  });

  // ── 安全策 ──
  const prodWrites = () => readAudit(dataDir).filter(l => l.actor === 'AI' && l.eventId === PROD && l.method !== 'GET').length;
  await check('本番の大会への書き込みは API を呼ばずに拒否（not_sandbox）。監査ログに書き込みの行が増えない', async () => {
    const before = prodWrites();
    const calls = [
      ['score_player', { eventId: PROD, playerId: 'pa1', rows: [{ values: ['○', '○', '', ''] }] }],
      ['add_players', { eventId: PROD, players: [{ name: 'x', court: 'A' }] }],
      ['auto_score', { eventId: PROD }],
      ['change_status', { eventId: PROD, to: 'round1_done' }],
      ['delete_test_event', { eventId: PROD, confirmName: '本番風の大会' }]
    ];
    for (const [name, args] of calls) {
      const r = await mcp.call(name, args);
      assert.deepEqual([r.isError, r.detail.reason], [true, 'not_sandbox'], name + ': ' + r.text);
      assert.ok(r.text.includes('本番風の大会') && r.text.includes('テスト用の大会ではない'), name);
    }
    assert.equal(prodWrites(), before);
    const ev = (await http(base, 'GET', '/api/events/' + PROD, undefined, BASIC)).body;
    assert.deepEqual([ev.status, ev.players.length, ev.players[0].score || 0], ['round1', 2, 0], '本番の大会は変わっていない');
  });
  await check('サーバー単体でも本番の大会への書き込みは 403 sandbox（Bearer で直接）', async () => {
    const r = await http(base, 'PATCH', '/api/events/' + PROD + '/players/pa1', { score: 1, baseRev: 0 }, 'Bearer ' + KEY);
    assert.deepEqual([r.status, r.body.reason], [403, 'sandbox']);
    const d = await http(base, 'DELETE', '/api/events/' + adminSand, undefined, 'Bearer ' + KEY);
    assert.deepEqual([d.status, d.body.reason], [403, 'sandbox'], '運営が作ったテスト用の大会もサーバーが消させない');
  });
  await check('change_status: final / archived は force 無しで拒否（API を呼ばない）。force: true なら進む', async () => {
    const before = readAudit(dataDir).filter(l => l.actor === 'AI' && l.route === '/api/events/:id/status').length;
    const r = await mcp.call('change_status', { eventId: EID, to: 'final' });
    assert.deepEqual([r.isError, r.detail.reason], [true, 'bad_input']);
    assert.ok(r.text.includes('force'));
    assert.equal(readAudit(dataDir).filter(l => l.actor === 'AI' && l.route === '/api/events/:id/status').length, before);
    assert.equal((await mcp.call('change_status', { eventId: EID, to: 'archived' })).detail.reason, 'bad_input');
    const ok = await mcp.ok('change_status', { eventId: EID, to: 'final', force: true });
    assert.deepEqual([ok.from, ok.status], ['round2_done', 'final']);
    // 状態が違えばサーバーの 409（from を付けているので古い画面と同じ扱い）
    const stale = await mcp.call('change_status', { eventId: EID, to: 'round1' });
    assert.deepEqual([stale.isError, stale.detail.status], [true, 409]);
    assert.equal((await mcp.ok('change_status', { eventId: EID, to: 'round2_done' })).status, 'round2_done');
  });
  await check('delete_test_event: confirmName の不一致は拒否して今の名前を返す。運営が作ったテスト用の大会は消さない', async () => {
    const r = await mcp.call('delete_test_event', { eventId: EID, confirmName: 'テスト用 MCP' });
    assert.deepEqual([r.isError, r.detail.reason, r.detail.name], [true, 'confirm_mismatch', EVENT_NAME]);
    assert.equal((await http(base, 'GET', '/api/events/' + EID, undefined, BASIC)).status, 200, 'まだ残っている');
    const a = await mcp.call('delete_test_event', { eventId: adminSand, confirmName: 'テスト用 運営の大会' });
    assert.deepEqual([a.isError, a.detail.reason], [true, 'not_sandbox']);
    assert.equal((await http(base, 'GET', '/api/events/' + adminSand, undefined, BASIC)).status, 200);
  });
  await check('引数の誤りは bad_input（API を呼ばない）', async () => {
    for (const [name, args] of [
      ['get_event', { eventId: '../etc' }],
      ['get_event', {}],
      ['create_test_event', { name: '  ' }],
      ['create_test_event', { name: 'x', courts: ['A-1'] }],
      ['add_players', { eventId: EID, players: [] }],
      ['score_player', { eventId: EID, playerId: 'x', rows: [{ values: ['○'] }] }],
      ['change_status', { eventId: EID, to: 'nowhere' }]
    ]) {
      const r = await mcp.call(name, args);
      assert.deepEqual([r.isError, r.detail.reason], [true, 'bad_input'], name + ' ' + JSON.stringify(args));
    }
  });

  await step('delete_test_event: 一致すれば消える。そのあと get_event は 404', async () => {
    const r = await mcp.ok('delete_test_event', { eventId: EID, confirmName: EVENT_NAME });
    assert.deepEqual([r.deleted, r.name], [true, EVENT_NAME]);
    const g = await mcp.call('get_event', { eventId: EID });
    assert.deepEqual([g.isError, g.detail.status], [true, 404]);
  });

  // ── 回数の上限（429）──
  await check('回数の上限: auto_score の途中で 429 なら止まり、retryAfter と途中までの数を返す（自動で再試行しない）', async () => {
    const k = await http(base, 'POST', '/api/ai-keys', { label: '上限', limits: { perMinute: 60, writesPerMinute: 4, perDay: 2000 } }, BASIC);
    secrets.push(k.body.key, k.body.key.split('.')[2]);
    const c = new McpClient(Object.assign({}, env, { PHX_AI_KEY: k.body.key }));
    clients.push(c);
    await c.init();
    const ev = await c.ok('create_test_event', { name: 'テスト用 上限', courts: ['A'] });                          // 書き込み 1
    await c.ok('add_players', { eventId: ev.id, players: [1, 2, 3].map(i => ({ name: '上限 ' + i, court: 'A', tech1: '真' })) });   // 2
    await c.ok('change_status', { eventId: ev.id, to: 'round1' });                                                  // 3
    const r = await c.call('auto_score', { eventId: ev.id });                                                       // 4 で 1 名、5 で 429
    assert.equal(r.isError, true, r.text);
    assert.deepEqual([r.detail.status, r.detail.reason, r.detail.scored, r.detail.remaining], [429, 'rate_limited', 1, 2]);
    assert.ok(r.detail.retryAfter > 0);
    assert.ok(r.text.includes('秒'));
    const audit = readAudit(dataDir).filter(l => l.actor === 'AI' && l.eventId === ev.id && l.method === 'PATCH');
    assert.deepEqual(audit.map(l => l.status), [200, 429], '429 のあとに送り直していない');
    await c.close();
    assert.equal((await mcp.ok('delete_test_event', { eventId: ev.id, confirmName: 'テスト用 上限' })).deleted, true);
  });

  // ── キーが無い・違う・接続先が不正 ──
  await check('キーが無い・形が違う → no_key（キーを打たせる案内はしない）', async () => {
    const c = new McpClient({ PHX_BASE_URL: base, PHX_KEY_SOURCE: 'env' });
    clients.push(c);
    await c.init();
    const r = await c.call('whoami');
    assert.deepEqual([r.isError, r.detail.reason], [true, 'no_key']);
    assert.ok(r.text.includes('set-key.ps1'));
    await c.close();
    const c2 = new McpClient({ PHX_BASE_URL: base, PHX_KEY_SOURCE: 'env', PHX_AI_KEY: 'phxai.short' });
    clients.push(c2);
    await c2.init();
    assert.equal((await c2.call('list_events')).detail.reason, 'no_key');
    await c2.close();
  });
  await check('違うキー（形は正しい）→ 401 key_invalid。そのキーは出力に出ない', async () => {
    const wrong = 'phxai.' + KEY.split('.')[1] + '.' + 'Q'.repeat(43);
    secrets.push(wrong, 'Q'.repeat(43));
    const c = new McpClient({ PHX_BASE_URL: base, PHX_KEY_SOURCE: 'env', PHX_AI_KEY: wrong });
    clients.push(c);
    await c.init();
    const r = await c.call('whoami');
    assert.deepEqual([r.isError, r.detail.status, r.detail.reason], [true, 401, 'key_invalid']);
    await c.close();
  });
  await check('接続先が不正なら起動しない（https 以外・user:pass@・未設定・vault 以外の値）', async () => {
    for (const e of [
      { PHX_BASE_URL: 'http://example.com' },
      { PHX_BASE_URL: 'https://user:secretpass@example.com' },
      { PHX_BASE_URL: '' },
      { PHX_BASE_URL: base, PHX_KEY_SOURCE: 'file' }
    ]) {
      const r = await expectStartRefused(Object.assign({ PHX_KEY_SOURCE: 'env', PHX_AI_KEY: KEY }, e));
      assert.equal(r.code, 2, JSON.stringify(e) + ' ' + r.err);
      assert.equal(r.out, '', '標準出力には何も書かない');
      assert.ok(r.err.includes('起動できません'));
      assert.ok(!r.err.includes('secretpass'));
    }
  });
  await check('標準入力を閉じると終了する（終了コード 0）', async () => {
    const c = new McpClient(env);
    clients.push(c);
    await c.init();
    assert.equal(await c.close(), 0);
  });

  // ── 資格情報マネージャー（--vault） ──
  if (WITH_VAULT && process.platform === 'win32') {
    await check('資格情報マネージャー: テスト用のリソースが無ければ no_key、保存すれば読める（読んだら消す）', async () => {
      vaultTouched = true;
      await vaultRemoveAll(VAULT_TEST_RESOURCE);
      const venv = { PHX_BASE_URL: base, PHX_KEY_SOURCE: 'vault', PHX_VAULT_RESOURCE: VAULT_TEST_RESOURCE };
      const c0 = new McpClient(venv);
      clients.push(c0);
      await c0.init();
      assert.equal((await c0.call('whoami')).detail.reason, 'no_key');
      const s = await vaultStore(VAULT_TEST_RESOURCE, 'localhost', KEY);
      assert.equal(s.out, 'stored');
      // 保存したあとは、同じプロセスでも次の呼び出しで読める（失敗は覚えていない）
      const w0 = await c0.call('whoami');
      assert.equal(w0.isError, false, w0.text);
      await c0.close();
      const c = new McpClient(venv);
      clients.push(c);
      await c.init();
      const w = await c.call('whoami');
      assert.equal(w.isError, false, w.text);
      assert.equal(w.value.keyLabel, 'MCP テスト');
      await c.close();
      // ユーザー名（ホスト名）が違えば読めない
      const c2 = new McpClient(Object.assign({}, venv, { PHX_BASE_URL: base.replace('localhost', '127.0.0.1') }));
      clients.push(c2);
      await c2.init();
      assert.equal((await c2.call('whoami')).detail.reason, 'no_key');
      await c2.close();
    });
  }
} finally {
  for (const c of clients) { try { c.child.kill(); await c.exit; } catch (e) { /* 無視 */ } }
  if (vaultTouched) {
    const r = await vaultRemoveAll(VAULT_TEST_RESOURCE);
    const n = await vaultCount(VAULT_TEST_RESOURCE);
    console.log('資格情報マネージャーのテスト用の資格情報を消しました（' + r.out + '、残り ' + n + ' 件）');
    if (n !== 0) { failed++; console.log('✗ テスト用の資格情報が残っています: ' + VAULT_TEST_RESOURCE); }
  }
  // キーが MCP サーバーの標準出力・標準エラーのどこにも出ていない
  const all = ALL_MCP_OUTPUT.join('\n');
  const leaked = secrets.filter(s => s && all.includes(s));
  if (leaked.length) { failed++; console.log('✗ キーが MCP サーバーの出力に出ています（' + leaked.length + ' 件）'); }
  else { passed++; console.log('✓ キー（' + secrets.length + ' 個の文字列）は MCP サーバーの標準出力・標準エラーに一度も出ていない（' + all.length + ' 文字を検索）'); }
  if (/Authorization|Bearer phxai/i.test(all)) { failed++; console.log('✗ Authorization ヘッダーが出力に出ています'); }
  await server.stop();
  if (ownDataDir && path.basename(dataDir).startsWith('tmg-mcp-')) fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('\nResult: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
}
