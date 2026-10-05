// 認証と静的配信の許可リストのテスト（ほか、データのファイルを直接書く必要がある結合テスト）。
// server/index.js を子プロセスで起動し、環境変数の組み合わせごとに HTTP で検証する。
// 実行: npm test（外部依存なし。Node 18 以上）
const assert = require('assert');
const path = require('path');
const { createRunner, makeDataDir, removeDataDir, startServer, withServer: withServerIn, basic, get } = require('./test-support');

const USER = 'staff';
const PASS = 'pa:ss-w0rd';   // ':' を含めて、最初の ':' で分割していることを確かめる

const { test, main } = createRunner();

// データは一時ディレクトリ（開発機の server/data に触らない）。終わったら消す。
const DATA_DIR = makeDataDir();
const withServer = (env, fn) => withServerIn(Object.assign({ TMG_DATA_DIR: DATA_DIR }, env), fn);

const NO_AUTH_DEV = { NODE_ENV: 'development', AUTH_USER: '', AUTH_PASS: '' };
const AUTH_DEV = { NODE_ENV: 'development', AUTH_USER: USER, AUTH_PASS: PASS };
const AUTH_PROD = { NODE_ENV: 'production', AUTH_USER: USER, AUTH_PASS: PASS };

// ── 単体: 静的配信の許可リスト ──
const { classify } = require('./static-policy');

test('classify: 観客用ページとそのアセットは public', () => {
  for (const p of ['/share.html', '/present.html', '/board.html', '/help.html',
                   '/theme.css', '/share.css', '/present.css', '/board.css', '/help.css',
                   '/api.js', '/share.js', '/present.js', '/board.js', '/scoring.js', '/courts.js',
                   '/help/img/admin_bulk.png', '/fonts/ShipporiMinchoB1-Bold.woff2']) {
    assert.strictEqual(classify(p, { production: true }), 'public', p);
  }
});

test('classify: 運営用ページとそのアセットは protected', () => {
  for (const p of ['/', '/index.html', '/scoring.html', '/admin.html', '/ranking.html', '/techniques.html',
                   '/style.css', '/admin.css', '/home.css',
                   '/app.js', '/home.js', '/admin.js', '/bundle-import.js', '/admin-players.js', '/admin-round.js',
                   '/admin-results.js', '/data.js', '/outbox.js', '/route.js',
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

test('isPublicApi: 共有リンクの GET/HEAD 3 本だけが公開', () => {
  assert.strictEqual(isPublicApi('GET', '/api/links/abc123'), true);
  assert.strictEqual(isPublicApi('GET', '/api/links/abc123/ranking'), true);
  assert.strictEqual(isPublicApi('GET', '/api/links/abc123/live'), true);
  assert.strictEqual(isPublicApi('HEAD', '/api/links/abc123/ranking'), true);   // 監視の HEAD を通す
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
    for (const p of ['/', '/index.html', '/scoring.html', '/admin.html', '/ranking.html', '/techniques.html',
                     '/app.js', '/admin.js', '/style.css', '/test.html',
                     '/home.js', '/home.css']) {
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
        body: method === 'GET' ? undefined : '{}',
        signal: AbortSignal.timeout(5000)
      });
      assert.strictEqual(res.status, 401, method + ' ' + p);
      assert.strictEqual(res.headers.get('www-authenticate'), null, method + ' ' + p);
      assert.deepStrictEqual(await res.json(), { error: '認証が必要です', reason: 'auth_required' }, method + ' ' + p);
    }
  });
});

test('壊れた JSON でも無認証なら 401（body-parser の 400 を見せない）', async () => {
  await withServer(AUTH_DEV, async base => {
    const res = await fetch(base + '/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
      signal: AbortSignal.timeout(5000)
    });
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(await res.json(), { error: '認証が必要です', reason: 'auth_required' });
  });
});

test('パスの大文字小文字で認証を迂回できない', async () => {
  await withServer(AUTH_DEV, async base => {
    const cases = [['GET', '/API/events'], ['GET', '/Api/Techniques'], ['POST', '/API/events'],
                   ['DELETE', '/API/events/x'], ['POST', '/API/links'], ['GET', '/API/links/zzzzzz/ranking']];
    for (const [method, p] of cases) {
      const res = await fetch(base + p, {
        method, headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : '{}', signal: AbortSignal.timeout(5000)
      });
      // 401（認証で弾く）か 404（ルートに一致しない）のどちらか。200 は絶対にだめ
      assert.ok(res.status === 401 || res.status === 404, method + ' ' + p + ' → ' + res.status);
    }
    // 大文字のページパスも配信しない
    assert.strictEqual((await get(base, '/INDEX.HTML', basic(USER, PASS))).status, 404);
  });
});

test('誤った資格情報は 401、正しい資格情報で通る', async () => {
  await withServer(AUTH_DEV, async base => {
    assert.strictEqual((await get(base, '/', basic(USER, 'wrong'))).status, 401);
    assert.strictEqual((await get(base, '/api/events', basic('wrong', PASS))).status, 401);
    assert.strictEqual((await get(base, '/', basic(USER, PASS))).status, 200);
    assert.strictEqual((await get(base, '/admin.html', basic(USER, PASS))).status, 200);
    assert.strictEqual((await get(base, '/scoring.html', basic(USER, PASS))).status, 200);
    assert.strictEqual((await get(base, '/test.html', basic(USER, PASS))).status, 200);
    assert.strictEqual((await get(base, '/api/events', basic(USER, PASS))).status, 200);
    assert.strictEqual((await get(base, '/api/techniques', basic(USER, PASS))).status, 200);
  });
});

test('表にないファイルは認証付きでも 404（index.html を返さない）', async () => {
  await withServer(AUTH_DEV, async base => {
    // ".." を含むパスは fetch がクライアント側で正規化してしまうので、サーバー側の
    // 正規化は classify の単体テストで見る。%73erver はそのまま送られる。
    for (const p of ['/deploy.sh', '/package.json', '/Dockerfile', '/docker-compose.yml',
                     '/.gitignore', '/server/index.js', '/server/data/', '/%73erver/data/',
                     '/docs/', '/docs/superpowers/specs/2026-09-14-access-control-design.md',
                     '/nonexistent', '/anything/deep']) {
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
  const s = await startServer({ NODE_ENV: 'production', AUTH_USER: '', AUTH_PASS: '', TMG_DATA_DIR: DATA_DIR });
  const code = await s.exit;
  assert.strictEqual(code, 1);
  assert.ok(s.output().includes('AUTH_USER'), '理由をログに出す: ' + s.output());
  await assert.rejects(fetch(s.base + '/', { signal: AbortSignal.timeout(2000) }), 'ポートが開いていない');
});

// ── 結合: 開発・認証なし ──
test('開発・認証なし: 許可リストは効く（deploy.sh は 404、share.html は 200）', async () => {
  await withServer(NO_AUTH_DEV, async base => {
    assert.strictEqual((await get(base, '/deploy.sh')).status, 404);
    assert.strictEqual((await get(base, '/share.html')).status, 200);
    assert.strictEqual((await get(base, '/test.html')).status, 200);
  });
});

// ── 結合: 履歴ファイルが壊れていても GET は 500 にしない（通し試験の所見 A） ──
// ブラウザのテスト（test.html）からは履歴ファイルを壊せないので、ここでファイルを直接書く。
// データは一時ディレクトリ（DATA_DIR）。作った大会は自分の id だけ消す（DELETE が履歴ファイルも消す）。
test('履歴: 壊れた履歴ファイルでも GET は 200 の空の履歴（ファイルは消さずに残す）', async () => {
  const fs = require('fs');
  await withServer(NO_AUTH_DEV, async base => {
    const created = await fetch(base + '/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '履歴破損テスト（自動で消す）', date: '2026-10-01', venue: '', players: [] }),
      signal: AbortSignal.timeout(5000)
    });
    const id = (await created.json()).id;
    assert.ok(id, '大会を作れる');
    const historyPath = path.join(DATA_DIR, 'history', id + '.json');
    try {
      fs.writeFileSync(historyPath, '{ "eventId": "' + id + '", "entries": [ 壊れ');
      const res = await get(base, '/api/events/' + id + '/history');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual((await res.json()).entries, []);
      assert.ok(fs.readFileSync(historyPath, 'utf-8').includes('壊れ'), '壊れたファイルは消さない');
      // 形の違う（entries が配列でない）ファイルも空の履歴として返す
      fs.writeFileSync(historyPath, JSON.stringify({ eventId: id, entries: 'x' }));
      const res2 = await get(base, '/api/events/' + id + '/history');
      assert.strictEqual(res2.status, 200);
      assert.deepStrictEqual((await res2.json()).entries, []);
    } finally {
      await fetch(base + '/api/events/' + id, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
      if (fs.existsSync(historyPath)) fs.unlinkSync(historyPath);
    }
  });
});

main(() => removeDataDir(DATA_DIR));
