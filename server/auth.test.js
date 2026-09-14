// 認証と静的配信の許可リストのテスト。
// server/index.js を子プロセスで起動し、環境変数の組み合わせごとに HTTP で検証する。
// 実行: npm test（外部依存なし。Node 18 以上）
const assert = require('assert');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const INDEX = path.join(__dirname, 'index.js');
const USER = 'staff';
const PASS = 'pa:ss-w0rd';   // ':' を含めて、最初の ':' で分割していることを確かめる

// ── ランナー ──
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function main() {
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
  console.log('\nResult: ' + (tests.length - failed) + ' passed, ' + failed + ' failed');
  // process.exit() で即時終了すると、子プロセス停止直後の fetch のハンドル解放と競合して
  // Windows の libuv がクラッシュする（出力は正しいのに終了コードが非 0 になる）。
  // exitCode を立ててイベントループが自然に終わるのを待つ。
  process.exitCode = failed ? 1 : 0;
}

// ── サーバー起動ヘルパー ──
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
// 戻り値: { base, ready, exit, output, stop }
async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [INDEX], {
    env: Object.assign({}, process.env, { PORT: String(port) }, env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
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

// 起動→テスト→停止 をまとめる。fn が投げても必ず止める。
async function withServer(env, fn) {
  const s = await startServer(env);
  try {
    await s.ready;
    await fn(s.base);
  } finally {
    await s.stop();
  }
}

const NO_AUTH_DEV = { NODE_ENV: 'development', AUTH_USER: '', AUTH_PASS: '' };
const AUTH_DEV = { NODE_ENV: 'development', AUTH_USER: USER, AUTH_PASS: PASS };
const AUTH_PROD = { NODE_ENV: 'production', AUTH_USER: USER, AUTH_PASS: PASS };

function basic(user, pass) {
  return { Authorization: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64') };
}

async function get(base, p, headers) {
  return fetch(base + p, { headers: headers || {}, redirect: 'manual' });
}

// ── スモーク: 開発・認証なしは従来どおり ──
test('開発・認証なし: / と GET /api/events が無認証で 200', async () => {
  await withServer(NO_AUTH_DEV, async base => {
    assert.strictEqual((await get(base, '/')).status, 200);
    assert.strictEqual((await get(base, '/api/events')).status, 200);
  });
});

main();
