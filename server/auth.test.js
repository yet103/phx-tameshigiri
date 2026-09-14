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

// ── 単体: 静的配信の許可リスト ──
const { classify } = require('./static-policy');

test('classify: 観客用ページとそのアセットは public', () => {
  for (const p of ['/share.html', '/present.html', '/board.html', '/help.html',
                   '/theme.css', '/share.css', '/present.css', '/board.css', '/help.css',
                   '/api.js', '/share.js', '/present.js', '/board.js', '/scoring.js',
                   '/help/img/admin_bulk.png', '/fonts/ShipporiMinchoB1-Bold.woff2']) {
    assert.strictEqual(classify(p, { production: true }), 'public', p);
  }
});

test('classify: 運営用ページとそのアセットは protected', () => {
  for (const p of ['/', '/index.html', '/admin.html', '/ranking.html', '/techniques.html',
                   '/style.css', '/admin.css',
                   '/app.js', '/admin.js', '/admin-events.js', '/admin-players.js', '/admin-round.js',
                   '/admin-results.js', '/courts.js', '/data.js', '/outbox.js', '/route.js',
                   '/storage.js', '/techpicker.js']) {
    assert.strictEqual(classify(p, { production: true }), 'protected', p);
  }
});

test('classify: test.html は開発時だけ protected、本番は配信しない', () => {
  assert.strictEqual(classify('/test.html', { production: false }), 'protected');
  assert.strictEqual(classify('/test.html', { production: true }), null);
});

test('classify: 表にないパスは配信しない', () => {
  for (const p of ['/deploy.sh', '/package.json', '/Dockerfile', '/docker-compose.yml',
                   '/.gitignore', '/.dockerignore', '/.env', '/docs/', '/docs/superpowers/specs/x.md',
                   '/server/index.js', '/server/data/events/abc.json', '/%73erver/data/',
                   '/nonexistent', '/help', '/help/img', '/help/img/', '/fonts', '/fonts/',
                   '/SHARE.HTML', '/share.html/', '/api.js.map']) {
    assert.strictEqual(classify(p, { production: false }), null, p);
  }
});

test('classify: 正規化で迂回できない', () => {
  assert.strictEqual(classify('/help/img/../../deploy.sh', { production: false }), null);
  assert.strictEqual(classify('/fonts/..%2F..%2Fserver/index.js', { production: false }), null);
  assert.strictEqual(classify('//share.html', { production: false }), 'public');
  assert.strictEqual(classify('/a/../share.html', { production: false }), 'public');
  assert.strictEqual(classify('/%zz', { production: false }), null);   // 不正なエンコード
});

// ── 単体: 認証 ──
const { parseBasic, isPublicApi, createAuth } = require('./auth');

test('parseBasic: 最初の ":" で分割し、パスワードに ":" を含められる', () => {
  const h = 'Basic ' + Buffer.from('staff:pa:ss').toString('base64');
  assert.deepStrictEqual(parseBasic(h), { user: 'staff', pass: 'pa:ss' });
  assert.deepStrictEqual(parseBasic('basic ' + Buffer.from('a:b').toString('base64')), { user: 'a', pass: 'b' });
});

test('parseBasic: 無い・形式違い・":" なしは null', () => {
  assert.strictEqual(parseBasic(undefined), null);
  assert.strictEqual(parseBasic('Bearer xyz'), null);
  assert.strictEqual(parseBasic('Basic'), null);
  assert.strictEqual(parseBasic('Basic ' + Buffer.from('nocolon').toString('base64')), null);
});

test('isPublicApi: 共有リンクの GET 3 本だけが公開', () => {
  assert.strictEqual(isPublicApi('GET', '/api/links/abc123'), true);
  assert.strictEqual(isPublicApi('GET', '/api/links/abc123/ranking'), true);
  assert.strictEqual(isPublicApi('GET', '/api/links/abc123/live'), true);
  assert.strictEqual(isPublicApi('POST', '/api/links'), false);
  assert.strictEqual(isPublicApi('GET', '/api/links'), false);
  assert.strictEqual(isPublicApi('GET', '/api/links/'), false);
  assert.strictEqual(isPublicApi('GET', '/api/links/abc/other'), false);
  assert.strictEqual(isPublicApi('DELETE', '/api/links/abc'), false);
  assert.strictEqual(isPublicApi('GET', '/api/events'), false);
  assert.strictEqual(isPublicApi('GET', '/api/events/abc'), false);
  assert.strictEqual(isPublicApi('GET', '/api/techniques'), false);
});

test('createAuth: 資格情報が揃っていれば有効、欠けていれば無効（全て通す）', () => {
  assert.strictEqual(createAuth({ user: 'a', pass: 'b' }).enabled, true);
  assert.strictEqual(createAuth({ user: 'a', pass: '' }).enabled, false);
  assert.strictEqual(createAuth({ user: '', pass: 'b' }).enabled, false);
  assert.strictEqual(createAuth({}).enabled, false);
  assert.strictEqual(createAuth({}).isAuthorized({ headers: {} }), true);
});

test('createAuth.isAuthorized: 正しい組だけ通す', () => {
  const auth = createAuth({ user: USER, pass: PASS });
  const req = h => ({ headers: h ? { authorization: h.Authorization } : {} });
  assert.strictEqual(auth.isAuthorized(req(basic(USER, PASS))), true);
  assert.strictEqual(auth.isAuthorized(req(basic(USER, 'wrong'))), false);
  assert.strictEqual(auth.isAuthorized(req(basic('wrong', PASS))), false);
  assert.strictEqual(auth.isAuthorized(req(basic(USER, PASS + 'x'))), false);
  assert.strictEqual(auth.isAuthorized(req(null)), false);
});

// ── スモーク: 開発・認証なしは従来どおり ──
test('開発・認証なし: / と GET /api/events が無認証で 200', async () => {
  await withServer(NO_AUTH_DEV, async base => {
    assert.strictEqual((await get(base, '/')).status, 200);
    assert.strictEqual((await get(base, '/api/events')).status, 200);
  });
});

main();
