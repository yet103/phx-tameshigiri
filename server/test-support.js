// npm test の結合テストの共通部分（ランナーとサーバーの起動）。
// server/index.js を子プロセスで起動し、HTTP で確かめる。データは TMG_DATA_DIR の一時ディレクトリに置き、
// 開発機の大会（server/data）に触らない。外部依存なし（Node 18 以上）。
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const INDEX = path.join(__dirname, 'index.js');

// ── ランナー ──
function createRunner() {
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }
  async function main(cleanup) {
    let failed = 0;
    for (const t of tests) {
      try {
        await t.fn();
        console.log('✓ ' + t.name);
      } catch (e) {
        failed++;
        console.log('✗ ' + t.name + '\n    ' + (e && e.stack || e).toString().split('\n').join('\n    '));
      }
    }
    if (cleanup) {
      try { cleanup(); } catch (e) { console.log('後片づけに失敗: ' + e.message); }
    }
    console.log('\nResult: ' + (tests.length - failed) + ' passed, ' + failed + ' failed');
    // process.exit() で即時終了すると、子プロセス停止直後の fetch のハンドル解放と競合して
    // Windows の libuv がクラッシュする（出力は正しいのに終了コードが非 0 になる）。
    // exitCode を立ててイベントループが自然に終わるのを待つ。
    process.exitCode = failed ? 1 : 0;
  }
  return { test, main };
}

// 一時データディレクトリ（tmg-<乱数>）。終わったら removeDataDir で消す。
function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tmg-'));
}
function removeDataDir(dir) {
  if (dir && path.basename(dir).startsWith('tmg-')) fs.rmSync(dir, { recursive: true, force: true });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// env は AUTH_USER / AUTH_PASS / NODE_ENV を必ず明示する（親シェルの値を引き継がない）。
// TMG_DATA_DIR は env で渡す（無ければ server/data になるので、呼び出し側が必ず渡す）。
// 戻り値: { base, ready, exit, output, stop }
async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [INDEX], {
    env: Object.assign({}, process.env, { PORT: String(port), PUBLIC_ORIGIN: '', TRUST_PROXY: '', COOKIE_SECURE: '' }, env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.on('error', e => { out += String(e); });
  const exit = new Promise(resolve => child.on('exit', code => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; if (out.includes('running at')) resolve(); });
    child.stderr.on('data', d => { out += d; });
    exit.then(code => reject(new Error('server exited with code ' + code + '\n' + out)));
    setTimeout(() => reject(new Error('server did not start in 10s\n' + out)), 10000).unref();
  });
  // 起動拒否を検証するテストは ready を待たずに exit だけ見る。
  // そのとき ready の拒否が未処理にならないよう、ここで握っておく（await ready は従来どおり拒否される）。
  ready.catch(() => {});
  return {
    base: 'http://127.0.0.1:' + port,
    ready,
    exit,
    output: () => out,
    stop() { child.kill(); return exit; }
  };
}

// 起動→テスト→停止 をまとめる。fn が投げても必ず止める。fn には (base, server) を渡す。
async function withServer(env, fn) {
  const s = await startServer(env);
  try {
    await s.ready;
    await fn(s.base, s);
  } finally {
    await s.stop();
  }
}

function basic(user, pass) {
  return { Authorization: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64') };
}

// 応答が返らないとテスト全体が止まるので、1 リクエストごとに打ち切る
async function get(base, p, headers) {
  return fetch(base + p, {
    headers: headers || {},
    redirect: 'manual',
    signal: AbortSignal.timeout(5000)
  });
}

// JSON の要求。戻り値: { status, headers, body（JSON でなければ文字列）}
async function api(base, method, p, body, headers) {
  const h = Object.assign({}, headers || {});
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + p, {
    method,
    headers: h,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    redirect: 'manual',
    signal: AbortSignal.timeout(5000)
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch (e) { /* 文字列のまま */ }
  return { status: res.status, headers: res.headers, body: parsed };
}

module.exports = { createRunner, makeDataDir, removeDataDir, startServer, withServer, basic, get, api, INDEX };
