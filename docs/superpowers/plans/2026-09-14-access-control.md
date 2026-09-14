# アクセス制御（Basic 認証）と静的配信の許可リスト 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公開インターネットに出ている phx-tameshigiri を、運営スタッフだけが書き込め、観客は共有リンク経由でしか読めない状態にし、リポジトリのファイルが静的配信で漏れないようにする。

**Architecture:** 認証の判定は `server/auth.js`（Basic ヘッダの解析・資格情報の比較・公開 API の判定）、静的配信の判定は `server/static-policy.js`（配信パスの許可リスト。`'public' | 'protected' | null` を返す純関数）に分け、`server/index.js` はそれらを配線するだけにする。検証は `server/auth.test.js` が `index.js` を **子プロセスで起動** して HTTP で確認する（`index.js` の構造を変えず、環境変数の組み合わせを変えて何度でも起動できる）。設計書は `docs/superpowers/specs/2026-09-14-access-control-design.md`。

**Tech Stack:** Node 18+（本番は node:18-alpine、`fetch` はグローバル）、Express 5、`node:assert` / `node:child_process` / `node:net`（テストは外部依存なし）、test.html（ブラウザで動く既存ランナー。`assert(desc, actual, expected)` は JSON.stringify 比較）

---

## 全タスク共通のルール

- **書き込み系ハンドラとミドルウェアは同期のまま。** `await` も非同期 I/O も足さない（`server/index.js` 冒頭の不変条件）。
- **既存の `/server` 実パス除外ミドルウェアは削除しない**（[server/index.js:1309-1322](../../../server/index.js#L1309-L1322)）。
- コミットは `git add <明示ファイル>` のみ。`git add -A` / `git add .` は使わない（`.env` を巻き込まないため、また並行セッションの変更を巻き込まないため）。
- `npm test` は `node server/auth.test.js`。各タスクの最後に必ず通す。
- 本番（`tameshigiri.phx-base.org`）には触らない。配備はユーザーが行う（設計書 §E）。

---

### Task 1: テストランナーの骨組みと現状のスモークテスト

`server/auth.test.js` に「サーバーを子プロセスで起動して HTTP で叩く」ヘルパーと、今の挙動を固定するスモークテストを置く。以降のタスクはこのファイルにテストを足していく。

**Files:**
- Create: `server/auth.test.js`
- Modify: `package.json`（`scripts.test`）

- [ ] **Step 1: テストランナーを書く**

`server/auth.test.js` を以下の内容で作成:

```js
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
  process.exit(failed ? 1 : 0);
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
```

- [ ] **Step 2: `package.json` に test スクリプトを足す**

`package.json` の `scripts` を次にする:

```json
  "scripts": {
    "start": "node server/index.js",
    "dev": "node server/index.js",
    "test": "node server/auth.test.js"
  },
```

- [ ] **Step 3: 実行して通ることを確認**

Run: `npm test`
Expected: `✓ 開発・認証なし: / と GET /api/events が無認証で 200` と `Result: 1 passed, 0 failed`

- [ ] **Step 4: コミット**

```bash
git add server/auth.test.js package.json
git commit -m "test: 認証テスト用にサーバーを子プロセスで起動するランナーを追加"
```

---

### Task 2: 静的配信の許可リスト（`server/static-policy.js`）

配信パスを `'public'`（無認証）/ `'protected'`（認証必須）/ `null`（配信しない）に分類する純関数。ファイルシステムには触らない。

**Files:**
- Create: `server/static-policy.js`
- Modify: `server/auth.test.js`（単体テストを追加）

- [ ] **Step 1: 失敗するテストを書く**

`server/auth.test.js` の `// ── スモーク` の**前**に追加:

```js
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
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test`
Expected: `Cannot find module './static-policy'` で落ちる

- [ ] **Step 3: 実装**

`server/static-policy.js` を作成:

```js
// 静的配信の許可リスト。
// リポジトリルートを配信しているので、表にあるファイルだけを返し、それ以外は 404 にする
// （deploy.sh / package.json / docs / server を外に出さない）。
// 新しい HTML / JS / CSS を足したらここに追加する。忘れると 404 になるのですぐ気付く。
const path = require('path');

// 無認証で配信する（観客が共有リンクで開くページとその依存）
const PUBLIC_FILES = new Set([
  'share.html', 'present.html', 'board.html', 'help.html',
  'theme.css', 'share.css', 'present.css', 'board.css', 'help.css',
  'api.js', 'share.js', 'present.js', 'board.js', 'scoring.js'
]);
// 配下のファイルを無認証で配信するディレクトリ（末尾スラッシュなし）
const PUBLIC_DIRS = ['help/img', 'fonts'];

// 認証してから配信する（運営用ページとその依存）
const PROTECTED_FILES = new Set([
  'index.html', 'admin.html', 'ranking.html', 'techniques.html',
  'style.css', 'admin.css',
  'app.js', 'admin.js', 'admin-events.js', 'admin-players.js', 'admin-round.js', 'admin-results.js',
  'courts.js', 'data.js', 'outbox.js', 'route.js', 'storage.js', 'techpicker.js'
]);
// 開発時だけ配信する（認証必須）。本番から破壊的テストページを消す
const DEV_ONLY_PROTECTED_FILES = new Set(['test.html']);

// URL パス → ルート相対の正規化済みパス。解釈できなければ null。
// express.static と同じくデコードしてから正規化するので、%2F や .. で迂回できない。
function normalize(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (e) {
    return null;
  }
  const norm = path.posix.normalize('/' + decoded.replace(/\\/g, '/'));
  const rel = norm.replace(/^\/+/, '');
  if (rel === '' || rel === '.') return 'index.html';   // "/" は index.html
  return rel;
}

// 戻り値: 'public' | 'protected' | null（配信しない）
function classify(urlPath, opts) {
  const production = !!(opts && opts.production);
  const rel = normalize(urlPath);
  if (rel === null || rel.endsWith('/')) return null;
  if (PUBLIC_FILES.has(rel)) return 'public';
  for (const dir of PUBLIC_DIRS) {
    if (rel.startsWith(dir + '/') && rel.length > dir.length + 1) return 'public';
  }
  if (PROTECTED_FILES.has(rel)) return 'protected';
  if (!production && DEV_ONLY_PROTECTED_FILES.has(rel)) return 'protected';
  return null;
}

module.exports = { classify };
```

- [ ] **Step 4: 通ることを確認**

Run: `npm test`
Expected: `Result: 6 passed, 0 failed`

- [ ] **Step 5: コミット**

```bash
git add server/static-policy.js server/auth.test.js
git commit -m "feat: 静的配信の許可リスト（配信するファイルと公開/認証の区分）"
```

---

### Task 3: 認証モジュール（`server/auth.js`）

Basic ヘッダの解析、資格情報の比較（タイミング攻撃に配慮）、公開 API の判定、401 の返し方 2 種類。

**Files:**
- Create: `server/auth.js`
- Modify: `server/auth.test.js`（単体テストを追加）

- [ ] **Step 1: 失敗するテストを書く**

`server/auth.test.js` の `// ── スモーク` の前（Task 2 のテストの後）に追加:

```js
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
```

`basic()` は Task 1 でファイル末尾側に定義済みだが、関数宣言なので巻き上げで使える。

- [ ] **Step 2: 失敗を確認**

Run: `npm test`
Expected: `Cannot find module './auth'` で落ちる

- [ ] **Step 3: 実装**

`server/auth.js` を作成:

```js
// Basic 認証。
// 資格情報は環境変数 AUTH_USER / AUTH_PASS（server/index.js が渡す）。
// 運営用 HTML を保護してブラウザにダイアログを出させ、以降の fetch にはブラウザが
// 自動で Authorization を付ける。API の 401 には WWW-Authenticate を付けず、
// 共有ページを見ている観客の画面にダイアログが出ないようにする。
const crypto = require('crypto');

function digest(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest();
}

// 長さが違うと timingSafeEqual が投げるので、固定長のダイジェスト同士を比べる
function safeEqual(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

// Authorization ヘッダ → { user, pass }。無い・形式違い・":" なしは null。
// パスワードに ":" を含められるよう、最初の ":" で分割する。
function parseBasic(header) {
  if (typeof header !== 'string') return null;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!m) return null;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

// 無認証で通す API。共有リンク越しの読み出しだけ（大会 ID は伏せられている）。
const PUBLIC_API = /^\/api\/links\/[^/]+(\/ranking|\/live)?$/;
function isPublicApi(method, urlPath) {
  return method === 'GET' && PUBLIC_API.test(urlPath);
}

function createAuth(opts) {
  const user = (opts && opts.user) || '';
  const pass = (opts && opts.pass) || '';
  const enabled = user !== '' && pass !== '';

  function isAuthorized(req) {
    if (!enabled) return true;
    const c = parseBasic(req.headers.authorization);
    if (!c) return false;
    // && で短絡させず両方比較する（ユーザー名の正否が応答時間に出ないように）
    const u = safeEqual(c.user, user);
    const p = safeEqual(c.pass, pass);
    return u && p;
  }

  // ページ向け 401: ブラウザにダイアログを出させる
  function rejectPage(res) {
    res.set('WWW-Authenticate', 'Basic realm="phx-tameshigiri", charset="UTF-8"');
    res.status(401).type('text/plain').send('認証が必要です');
  }

  // API 向け 401: WWW-Authenticate を付けない（観客の画面にダイアログを出さない）
  function rejectApi(res) {
    res.status(401).json({ error: '認証が必要です' });
  }

  return { enabled, isAuthorized, rejectPage, rejectApi };
}

module.exports = { parseBasic, isPublicApi, createAuth };
```

- [ ] **Step 4: 通ることを確認**

Run: `npm test`
Expected: `Result: 11 passed, 0 failed`

- [ ] **Step 5: コミット**

```bash
git add server/auth.js server/auth.test.js
git commit -m "feat: Basic 認証の解析・比較・公開 API 判定"
```

---

### Task 4: `server/index.js` への組み込み

cors を外し、起動時チェック、API の認証、静的配信の許可リスト、SPA フォールバック廃止を配線する。結合テストで設計書 §F の表を固定する。

**Files:**
- Modify: `server/index.js:1-8`（require）、`:286-289`（ミドルウェア）、`:1299-1339`（静的配信）
- Modify: `server/auth.test.js`（結合テストを追加）

- [ ] **Step 1: 失敗する結合テストを書く**

`server/auth.test.js` の `main();` の**前**（スモークテストの後）に追加:

```js
// ── 結合: 開発・認証あり ──
test('公開ページとアセットは無認証で 200', async () => {
  await withServer(AUTH_DEV, async base => {
    for (const p of ['/share.html', '/present.html', '/board.html', '/help.html',
                     '/theme.css', '/api.js', '/scoring.js',
                     '/fonts/ShipporiMinchoB1-Bold.woff2', '/help/img/admin_bulk.png']) {
      assert.strictEqual((await get(base, p)).status, 200, p);
    }
  });
});

test('共有リンク API は無認証で通る（存在しないトークンは 404）', async () => {
  await withServer(AUTH_DEV, async base => {
    for (const p of ['/api/links/zzzzzz', '/api/links/zzzzzz/ranking', '/api/links/zzzzzz/live']) {
      const res = await get(base, p);
      assert.notStrictEqual(res.status, 401, p);
      assert.strictEqual(res.status, 404, p);
    }
  });
});

test('運営用ページは無認証で 401 + WWW-Authenticate', async () => {
  await withServer(AUTH_DEV, async base => {
    for (const p of ['/', '/index.html', '/admin.html', '/ranking.html', '/techniques.html',
                     '/app.js', '/admin.js', '/style.css', '/test.html']) {
      const res = await get(base, p);
      assert.strictEqual(res.status, 401, p);
      assert.ok(/^Basic realm=/.test(res.headers.get('www-authenticate') || ''), p);
    }
  });
});

test('保護 API は無認証で 401、WWW-Authenticate なし、JSON 本文', async () => {
  await withServer(AUTH_DEV, async base => {
    const cases = [
      ['GET', '/api/events'], ['GET', '/api/events/abc'], ['GET', '/api/events/abc/export'],
      ['GET', '/api/events/abc/history'], ['GET', '/api/events/abc/ranking'],
      ['GET', '/api/techniques'], ['POST', '/api/links'], ['POST', '/api/events'],
      ['PATCH', '/api/events/abc/players/p1'], ['DELETE', '/api/events/abc'],
      ['PUT', '/api/events/abc/live/A'], ['GET', '/api/nonexistent']
    ];
    for (const [method, p] of cases) {
      const res = await fetch(base + p, {
        method, headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : '{}'
      });
      assert.strictEqual(res.status, 401, method + ' ' + p);
      assert.strictEqual(res.headers.get('www-authenticate'), null, method + ' ' + p);
      assert.deepStrictEqual(await res.json(), { error: '認証が必要です' }, method + ' ' + p);
    }
  });
});

test('誤った資格情報は 401、正しい資格情報で通る', async () => {
  await withServer(AUTH_DEV, async base => {
    assert.strictEqual((await get(base, '/', basic(USER, 'wrong'))).status, 401);
    assert.strictEqual((await get(base, '/api/events', basic('wrong', PASS))).status, 401);
    assert.strictEqual((await get(base, '/', basic(USER, PASS))).status, 200);
    assert.strictEqual((await get(base, '/admin.html', basic(USER, PASS))).status, 200);
    assert.strictEqual((await get(base, '/test.html', basic(USER, PASS))).status, 200);
    assert.strictEqual((await get(base, '/api/events', basic(USER, PASS))).status, 200);
    assert.strictEqual((await get(base, '/api/techniques', basic(USER, PASS))).status, 200);
  });
});

test('表にないファイルは認証付きでも 404（index.html を返さない）', async () => {
  await withServer(AUTH_DEV, async base => {
    for (const p of ['/deploy.sh', '/package.json', '/Dockerfile', '/docker-compose.yml',
                     '/.gitignore', '/server/index.js', '/server/data/', '/%73erver/data/',
                     '/docs/', '/docs/superpowers/specs/2026-09-14-access-control-design.md',
                     '/nonexistent', '/anything/deep', '/help/img/../../deploy.sh']) {
      const res = await get(base, p, basic(USER, PASS));
      assert.strictEqual(res.status, 404, p);
      const body = await res.text();
      assert.ok(!body.includes('<html'), p + ' が HTML を返した');
    }
  });
});

test('Access-Control-Allow-Origin を返さない', async () => {
  await withServer(AUTH_DEV, async base => {
    for (const p of ['/share.html', '/api/links/zzzzzz/ranking']) {
      const res = await get(base, p, { Origin: 'https://evil.example' });
      assert.strictEqual(res.headers.get('access-control-allow-origin'), null, p);
    }
    const res = await get(base, '/api/events', Object.assign({ Origin: 'https://evil.example' }, basic(USER, PASS)));
    assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
  });
});

// ── 結合: 本番 ──
test('本番・認証あり: test.html は認証付きでも 404', async () => {
  await withServer(AUTH_PROD, async base => {
    assert.strictEqual((await get(base, '/test.html', basic(USER, PASS))).status, 404);
    assert.strictEqual((await get(base, '/share.html')).status, 200);
    assert.strictEqual((await get(base, '/')).status, 401);
  });
});

test('本番・認証なし: 終了コード 1 で起動しない', async () => {
  const s = await startServer({ NODE_ENV: 'production', AUTH_USER: '', AUTH_PASS: '' });
  const code = await s.exit;
  assert.strictEqual(code, 1);
  assert.ok(s.output().includes('AUTH_USER'), '理由をログに出す: ' + s.output());
});

// ── 結合: 開発・認証なし ──
test('開発・認証なし: 許可リストは効く（deploy.sh は 404、share.html は 200）', async () => {
  await withServer(NO_AUTH_DEV, async base => {
    assert.strictEqual((await get(base, '/deploy.sh')).status, 404);
    assert.strictEqual((await get(base, '/share.html')).status, 200);
    assert.strictEqual((await get(base, '/test.html')).status, 200);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test`
Expected: 結合テストのうち「公開ページ…」「共有リンク API…」以外が落ちる（`/` が 200、`/deploy.sh` が 200、本番・認証なしで起動してしまう、など）。単体テスト 11 件とスモークは通る。

- [ ] **Step 3: require と cors を差し替える**

`server/index.js` の先頭 5 行:

```js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
```

を次にする:

```js
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createAuth, isPublicApi } = require('./auth');
const { classify } = require('./static-policy');
```

- [ ] **Step 4: 起動時チェックと API 認証ミドルウェアを置く**

`server/index.js` の

```js
// ミドルウェア
app.use(cors());
// ペイロードサイズ制限を緩和
app.use(express.json({ limit: '50mb' }));
```

を次にする:

```js
// ────────────────────────────────────────
// 認証
// ────────────────────────────────────────
// 資格情報は環境変数。本番で未設定なら無防備なまま上がらないよう起動を拒否する。
// 開発時は警告だけ出して認証なしで動かす（test.html の従来運用を壊さない）。
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const auth = createAuth({ user: process.env.AUTH_USER, pass: process.env.AUTH_PASS });
if (!auth.enabled) {
  if (IS_PRODUCTION) {
    console.error('AUTH_USER と AUTH_PASS が設定されていません。本番では認証なしで起動できません。');
    process.exit(1);
  }
  console.warn('⚠ AUTH_USER / AUTH_PASS が未設定のため認証なしで起動します（開発用）');
}

// ミドルウェア
// CORS は返さない。全ページが同一オリジンから fetch しており、
// Access-Control-Allow-Origin: * を出すと外部サイトから API を叩く余地が残る。
// ペイロードサイズ制限を緩和
app.use(express.json({ limit: '50mb' }));

// API の認証。共有リンク越しの読み出し（isPublicApi）だけ無認証で通す。
// 401 に WWW-Authenticate を付けないのは、共有ページを見ている観客の画面に
// ブラウザのパスワードダイアログが出ないようにするため。運営端末は保護された
// HTML を開いた時点で認証済みなので、fetch にはブラウザが自動で資格情報を付ける。
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (isPublicApi(req.method, req.path)) return next();
  if (auth.isAuthorized(req)) return next();
  auth.rejectApi(res);
});
```

- [ ] **Step 5: 静的配信を許可リストにし、SPA フォールバックを廃止する**

`server/index.js` 末尾の静的配信ブロック。既存の `/server` 除外ミドルウェア（`const SERVER_DIR = ...` から `next(); });` まで）は**そのまま残す**。その直後の

```js
app.use(express.static(PUBLIC_DIR, {
    etag: false,
    setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
}));

app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    } else {
        next();
    }
});
```

を次にする:

```js
// 許可リスト。表にあるファイルだけ配信し、運営用は認証してから返す（server/static-policy.js）。
// 未定義の /api/ パスもここで 404 にする。
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '見つかりません' });
  }
  const kind = classify(req.path, { production: IS_PRODUCTION });
  if (!kind) return res.status(404).end();
  if (kind === 'protected' && !auth.isAuthorized(req)) return auth.rejectPage(res);
  next();
});

app.use(express.static(PUBLIC_DIR, {
    etag: false,
    setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
}));

// SPA フォールバックは置かない。画面遷移はハッシュと ?token= で行っており、
// パスによるルーティングはないため、未知のパスは 404 でよい。
app.use((req, res) => {
    res.status(404).end();
});
```

- [ ] **Step 6: 通ることを確認**

Run: `npm test`
Expected: `Result: 21 passed, 0 failed`

- [ ] **Step 7: 開発サーバーで従来のブラウザテストが通ることを確認**

Run（別ターミナル、認証なし）: `npm start`
ブラウザで `http://localhost:3457/test.html` を開く。
Expected: 既存の `Result: 267 passed, 0 failed`（件数は master の現状に依存。`failed` が 0 であること）。

- [ ] **Step 8: コミット**

```bash
git add server/index.js server/auth.test.js
git commit -m "feat: Basic 認証と静的配信の許可リストを組み込み、cors と SPA フォールバックを廃止"
```

---

### Task 5: 送信キューの 401/403 と採点画面の表示

401/403 で採点を捨てない。認証切れを画面に出す。

**Files:**
- Modify: `outbox.js:56-62`（`isPermanentFailure`）、`:13-19`（変数）、`:95-102`（`status`）、`:151-172`（`drain` の成否分岐）、`:256-264`（export）
- Modify: `app.js:87-110`（`onSaveStatus`）
- Modify: `test.html:1226` 付近（`coalesce` テストの後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `Outbox.coalesce(q, { eventId: 'e', playerId: 'p', note: 'x' });` を含むテストブロックの直後（`// 注意: このページは index.html と localStorage を共有する。` の前）に追加:

```js
    // 401/403 は資格情報の失効。再認証すれば通るので捨ててはいけない
    // （捨てると採点が黙って失われる）。404/400 は何度送っても通らないので捨てる。
    assert('isPermanentFailure: 401 は捨てない', Outbox.isPermanentFailure(401), false);
    assert('isPermanentFailure: 403 は捨てない', Outbox.isPermanentFailure(403), false);
    assert('isPermanentFailure: 408 は捨てない', Outbox.isPermanentFailure(408), false);
    assert('isPermanentFailure: 429 は捨てない', Outbox.isPermanentFailure(429), false);
    assert('isPermanentFailure: 404 は捨てる', Outbox.isPermanentFailure(404), true);
    assert('isPermanentFailure: 400 は捨てる', Outbox.isPermanentFailure(400), true);
    assert('isPermanentFailure: 0（通信断）は捨てない', Outbox.isPermanentFailure(0), false);
    assert('isPermanentFailure: 500 は捨てない', Outbox.isPermanentFailure(500), false);
```

さらに、`assert('捨てた後キューが空になる', Outbox.pendingCount(), 0);` の直後に追加:

```js
    // 401 のエントリはキューに残り、状態に lastStatus が出る
    Api.updatePlayer = async function() { return { ok: false, status: 401 }; };
    localStorage.setItem('tmg_outbox', JSON.stringify([
      { eventId: 'ev1', playerId: 'pa', score: 1, result: 'a', queuedAt: 't8' }
    ]));
    var dropped401 = [];
    Outbox.init(function() {}, function(list) { dropped401 = dropped401.concat(list); });
    await new Promise(function(r) { setTimeout(r, 400); });
    assert('401 のエントリは捨てない', Outbox.pendingCount(), 1);
    assert('401 で捨てたと通知しない', dropped401.length, 0);
    assert('401 の直後の状態は retrying', Outbox.status().state, 'retrying');
    assert('状態に直近の失敗ステータスが乗る', Outbox.status().lastStatus, 401);
    Api.updatePlayer = async function() { return { ok: true }; };
    Outbox.flushNow();
    await new Promise(function(r) { setTimeout(r, 300); });
    assert('再認証後に送れたら lastStatus は消える', [Outbox.pendingCount(), Outbox.status().lastStatus], [0, null]);
```

- [ ] **Step 2: 失敗を確認**

Run: `npm start`（認証なし）→ ブラウザで `http://localhost:3457/test.html`
Expected: `isPermanentFailure` 系が `Outbox.isPermanentFailure is not a function` で失敗（ページ全体が止まる場合は次の Step 3 で export を先に足してから再確認）。`401 のエントリは捨てない` が `got: 0 expected: 1` で失敗。

- [ ] **Step 3: `outbox.js` を直す**

変数宣言（`var dropped = [];` の直後）に追加:

```js
  var lastStatus = null;     // 直近に失敗した HTTP ステータス（0=通信断）。成功で null に戻す
```

`isPermanentFailure` を次にする:

```js
  // 何度送っても通らない失敗か。
  // 4xx はリクエスト自体が受け付けられていないので再送しても同じ。
  // ただし 408（タイムアウト）と 429（レート制限）は時間を置けば通る。
  // 401 / 403（資格情報の失効）も、ページを再読み込みして再認証すれば通るので捨てない。
  // 捨てると未送信の採点が黙って失われる。
  function isPermanentFailure(status) {
    if (status === 401 || status === 403) return false;
    if (status === 408 || status === 429) return false;
    return status >= 400 && status < 500;
  }
```

`status()` の戻り値に `lastStatus` を足す:

```js
  function status() {
    var state = 'idle';
    if (queue.length > 0) state = failingSince ? 'retrying' : 'sending';
    return {
      state: state,
      pending: queue.length,
      failingSince: failingSince,
      lastStatus: lastStatus
    };
  }
```

`drain()` の成功分岐、`failingSince = null;` の直後に:

```js
          lastStatus = null;
```

`drain()` の再送分岐（`} else {` の直後、`if (!failingSince) failingSince = Date.now();` の前）に:

```js
          lastStatus = res ? res.status : 0;
```

export に `isPermanentFailure` を足す:

```js
  return {
    init: init,
    enqueue: enqueue,
    flushNow: flushNow,
    pendingCount: pendingCount,
    applyPending: applyPending,
    status: status,
    coalesce: coalesce,
    isPermanentFailure: isPermanentFailure
  };
```

- [ ] **Step 4: `app.js` の表示を直す**

`onSaveStatus` を次にする:

```js
  function onSaveStatus(st) {
    if (!saveStatusEl) return;
    // 401/403 は資格情報の失効。再送では直らず、ページを開き直して再認証する必要がある。
    var authLost = st.pending > 0 && (st.lastStatus === 401 || st.lastStatus === 403);
    saveStatusEl.classList.remove('sending', 'retrying');
    if (st.state === 'idle') {
      saveStatusEl.textContent = '● 保存済み';
    } else if (st.state === 'sending') {
      saveStatusEl.textContent = '◌ 保存中…';
      saveStatusEl.classList.add('sending');
    } else if (authLost) {
      saveStatusEl.textContent = '⚠ 認証が切れました・ページを再読み込みしてください';
      saveStatusEl.classList.add('retrying');
    } else {
      saveStatusEl.textContent = '⚠ 未保存 ' + st.pending + ' 件・再送中';
      saveStatusEl.classList.add('retrying');
    }

    // 最初の失敗から30秒経っても未保存が残っていればバナーに昇格する。
    // 認証切れは待っても直らないので即座に昇格する。
    var stale = st.failingSince && (Date.now() - st.failingSince >= BANNER_AFTER_MS);
    if (authLost) {
      saveBannerTextEl.textContent =
        '⚠ 認証が切れています。ページを再読み込みしてください（未保存 ' + st.pending + ' 件は保持されます）';
      saveBannerEl.style.display = 'flex';
    } else if (st.pending > 0 && stale) {
      saveBannerTextEl.textContent =
        '⚠ サーバーに保存できていません（' + st.pending + '件未保存）';
      saveBannerEl.style.display = 'flex';
    } else {
      saveBannerEl.style.display = 'none';
    }
  }
```

- [ ] **Step 5: 通ることを確認**

ブラウザで `http://localhost:3457/test.html` を**新しいタブで**開く（同一タブの再読み込みは bfcache で古い JS が残ることがある）。
Expected: 追加した 14 件を含めて `failed` が 0。

- [ ] **Step 6: コミット**

```bash
git add outbox.js app.js test.html
git commit -m "fix: 送信キューが 401/403 で採点を捨てないようにし、認証切れを画面に出す"
```

---

### Task 6: 設定ファイルと依存の整理

**Files:**
- Modify: `docker-compose.yml`
- Create: `.env.example`
- Modify: `.gitignore`、`.dockerignore`
- Modify: `package.json`（`cors` を依存から外す）

- [ ] **Step 1: `docker-compose.yml`**

`environment:` を次にする:

```yaml
    environment:
      - PORT=3457
      - NODE_ENV=production
      # 運営用ページと書き込み API の Basic 認証。リポジトリ直下の .env から読む。
      # 未設定なら compose が起動前に止まる（無防備なまま上げない）。
      - AUTH_USER=${AUTH_USER:?AUTH_USER を .env に設定してください}
      - AUTH_PASS=${AUTH_PASS:?AUTH_PASS を .env に設定してください}
```

- [ ] **Step 2: `.env.example`**

```
# docker compose が読む。コピーして .env にし、値を入れる（.env はコミットしない）。
# 運営端末（タブレット・スマホ）が採点画面・運営画面を開くときに入力する ID とパスワード。
# パスワードは十分長いランダム文字列にする。例: openssl rand -base64 24
AUTH_USER=
AUTH_PASS=
```

- [ ] **Step 3: `.gitignore` と `.dockerignore`**

`.gitignore` の `# Server data` セクションの前に追加:

```
# Credentials
.env
```

`.dockerignore` の末尾に追加:

```
.env
```

- [ ] **Step 4: `cors` を依存から外す**

Run: `npm uninstall cors`
Expected: `package.json` の `dependencies` から `cors` が消え、`express` だけ残る。

確認: `grep -n "cors" package.json server/index.js` が何も出さない。

- [ ] **Step 5: `.env` なしで compose が止まることを確認（Docker がある場合）**

Run: `docker compose config`
Expected: `AUTH_USER を .env に設定してください` を含むエラーで終了。Docker が無い環境ではスキップし、Task 7 で報告する。

- [ ] **Step 6: `npm test` が通ることを確認**

Run: `npm test`
Expected: `Result: 21 passed, 0 failed`

- [ ] **Step 7: コミット**

```bash
git add docker-compose.yml .env.example .gitignore .dockerignore package.json
git commit -m "chore: 認証の資格情報を .env から注入し、cors 依存を外す"
```

---

### Task 7: 最終検証

**Files:** 変更なし

- [ ] **Step 1: 全テスト**

Run: `npm test`
Expected: `Result: 21 passed, 0 failed`

- [ ] **Step 2: 認証ありの開発サーバーでブラウザ確認**

Run（PowerShell）: `$env:AUTH_USER='staff'; $env:AUTH_PASS='secret'; npm start`

ブラウザで確認（それぞれ新しいタブ）:
- `http://localhost:3457/` → ID/パスワードのダイアログが出る → 入力後に採点画面が出る
- 同じブラウザで `http://localhost:3457/admin.html` → **ダイアログが出ずに**開く（資格情報がキャッシュされている）
- 採点画面で 1 件採点 → 「● 保存済み」になる（fetch に資格情報が自動で付いている）
- シークレットウィンドウで `http://localhost:3457/share.html?token=<存在しないトークン>` → ダイアログが**出ない**（エラー表示は出てよい）
- シークレットウィンドウで `http://localhost:3457/deploy.sh` → 404
- `http://localhost:3457/test.html` → ダイアログ → 入力後に `failed` 0

- [ ] **Step 3: 本番モードの起動拒否**

Run（PowerShell）: `$env:NODE_ENV='production'; $env:AUTH_USER=''; $env:AUTH_PASS=''; node server/index.js; echo "exit=$LASTEXITCODE"`
Expected: `AUTH_USER と AUTH_PASS が設定されていません…` と `exit=1`

- [ ] **Step 4: 結果を報告**

ユーザーに以下を報告する:
- `npm test` と `test.html` の結果（件数）
- Step 2 の各確認の結果
- Docker の確認（Task 6 Step 5）を実施できたか
- 配備手順は設計書 §E（サーバーで `.env` を作ってから `bash deploy.sh`、`curl` で `/` 401・`/share.html` 200・`/deploy.sh` 404 を確認）

---

## 設計書との対応

| 設計書 | タスク |
|---|---|
| §A 資格情報・起動時チェック・比較 | Task 3, 4 |
| §A 公開 API・401 の返し方 2 種類 | Task 3, 4 |
| §B 許可リスト・`/server` 除外の維持・フォールバック廃止 | Task 2, 4 |
| §C CORS | Task 4, 6 |
| §D outbox の 401/403・表示 | Task 5 |
| §E docker-compose / .env / .gitignore / .dockerignore | Task 6 |
| §F `auth.test.js`・`test.html` | Task 1–5 |
| §G 同期の維持 | 全タスク共通ルール |
| §H phx-tournament | 設計書に手順あり。本計画の範囲外 |
