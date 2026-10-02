// AI 用キー（Bearer）と砂場（「テスト用」で始まる大会だけ書ける）のテスト（段階 2）。
// 設計書 docs/superpowers/specs/2026-10-03-invite-links-and-ai-key-design.md 8.1。
// データは TMG_DATA_DIR の一時ディレクトリ（開発機の大会に触らない）。実行: npm test
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRunner, makeDataDir, removeDataDir, withServer: withServerIn, basic, get, api } = require('./test-support');
const cred = require('./credentials');

const USER = 'staff';
const PASS = 'pa:ss-w0rd';
const B = basic(USER, PASS);
const { test, main } = createRunner();
const DIRS = [];
function dataDir() { const d = makeDataDir(); DIRS.push(d); return d; }
const AUTH_DEV = { NODE_ENV: 'development', AUTH_USER: USER, AUTH_PASS: PASS };
const NO_AUTH_DEV = { NODE_ENV: 'development', AUTH_USER: '', AUTH_PASS: '' };
const withServer = (env, fn, dir) => withServerIn(Object.assign({ TMG_DATA_DIR: dir || dataDir() }, env), fn);

// 書き込みの多いテストは上限を緩めたキーで
const WIDE = { perMinute: 600, writesPerMinute: 300, perDay: 20000 };

async function issueKey(base, label, limits) {
  const r = await api(base, 'POST', '/api/ai-keys', { label: label || 'Claude Code（テスト）', limits: limits }, B);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.ok(/^phxai\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/.test(r.body.key), r.body.key);
  return r.body;
}
const bearer = key => ({ Authorization: 'Bearer ' + key });

// 運営が作る大会（選手つき、一巡目に進める）。戻り値: 大会 ID
async function adminEvent(base, name) {
  const r = await api(base, 'POST', '/api/events', {
    name: name, date: '', venue: '', settings: { courts: ['A', 'B'] },
    players: [{ id: 'pa1', name: '甲', order: 'A-男子-1-1' }, { id: 'pb1', name: '乙', order: 'B-男子-1-1' }]
  }, B);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual((await api(base, 'POST', '/api/events/' + r.body.id + '/status', { to: 'round1' }, B)).status, 200);
  return r.body.id;
}

test('発行と一覧: キーは 1 回だけ、一覧に secretHash もキーも無い。運営だけ', async () => {
  await withServer(AUTH_DEV, async base => {
    const k = await issueKey(base);
    assert.deepStrictEqual([k.aiKey.label, k.aiKey.status, k.aiKey.limits, k.aiKey.useCount],
      ['Claude Code（テスト）', 'active', { perMinute: 60, writesPerMinute: 30, perDay: 2000 }, 0]);
    // 既定の期限は 30 日後の日本時間の終わり
    const exp = Date.parse(k.aiKey.expiresAt);
    assert.ok(/T14:59:59\.999Z$/.test(k.aiKey.expiresAt) && exp > Date.now() + 29 * 86400e3 && exp < Date.now() + 31 * 86400e3);
    const list = await api(base, 'GET', '/api/ai-keys', undefined, B);
    assert.strictEqual(list.body.length, 1);
    const text = JSON.stringify(list.body);
    assert.ok(!text.includes(k.key.split('.')[2]) && !text.includes('secretHash'));
    assert.strictEqual((await api(base, 'GET', '/api/ai-keys')).status, 401);
    const bad = async (body, reason) => {
      const r = await api(base, 'POST', '/api/ai-keys', body, B);
      assert.deepStrictEqual([r.status, r.body.reason], [400, reason], JSON.stringify(body));
    };
    await bad({ label: '' }, 'bad_label');
    await bad({ label: 'x', expiresInDays: 91 }, 'bad_expiry');
    await bad({ label: 'x', expiresAt: new Date(Date.now() + 100 * 86400e3).toISOString() }, 'bad_expiry');
    await bad({ label: 'x', limits: { perMinute: 0 } }, 'bad_limits');
    const d7 = await api(base, 'POST', '/api/ai-keys', { label: '7 日', expiresInDays: 7 }, B);
    assert.strictEqual(d7.status, 201);
  });
});

test('認証: 正しい Bearer で一覧に sandbox。誤り・期限切れ・取り消しは 401（Cookie に落ちない）。クエリのキーは読まない', async () => {
  const dir = dataDir();
  // 期限切れのキーを起動前に書く
  fs.mkdirSync(path.join(dir, 'auth'), { recursive: true });
  const secret = 'E'.repeat(43);
  const past = new Date(Date.now() - 3600e3).toISOString();
  fs.writeFileSync(path.join(dir, 'auth', 'ai-keys.json'), JSON.stringify({ version: 1, keys: [{
    id: 'KeyExpired01', label: '古い', secretHash: cred.hashSecret(secret), createdAt: past, expiresAt: past,
    revokedAt: null, limits: { perMinute: 60, writesPerMinute: 30, perDay: 2000 }, lastUsedAt: null, useCount: 0
  }] }));
  await withServer(AUTH_DEV, async base => {
    const prod = await adminEvent(base, '本番の大会');
    const sand = await adminEvent(base, 'テスト用 運営の大会');
    const k = await issueKey(base);
    const list = await api(base, 'GET', '/api/events', undefined, bearer(k.key));
    assert.strictEqual(list.status, 200);
    const byId = Object.fromEntries(list.body.map(e => [e.id, e]));
    assert.deepStrictEqual([byId[prod].sandbox, byId[sand].sandbox, byId[sand].createdByAi], [false, true, false]);
    assert.strictEqual((await api(base, 'GET', '/api/events/' + prod, undefined, bearer(k.key))).body.sandbox, false);

    const t = cred.parseToken('ai', k.key);
    const wrong = 'phxai.' + t.id + '.' + 'Z'.repeat(43);
    // 有効な採点の Cookie があっても Bearer の誤りは 401
    const inv = await api(base, 'POST', '/api/invites', { role: 'scorer', eventId: prod, court: 'A' }, B);
    const join = await api(base, 'POST', '/api/join', { key: inv.body.key, confirm: true });
    const cookie = join.headers.get('set-cookie').split(';')[0];
    const w = await api(base, 'GET', '/api/events', undefined, Object.assign({ Cookie: cookie }, bearer(wrong)));
    assert.deepStrictEqual([w.status, w.body.reason], [401, 'key_invalid']);
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, bearer(''))).body.reason, 'key_invalid');
    assert.strictEqual((await api(base, 'GET', '/api/links/zzzzzz', undefined, bearer(wrong))).status, 401);
    const ex = await api(base, 'GET', '/api/events', undefined, bearer('phxai.KeyExpired01.' + secret));
    assert.deepStrictEqual([ex.status, ex.body.reason], [401, 'key_expired']);
    const q = await api(base, 'GET', '/api/events?key=' + encodeURIComponent(k.key));
    assert.deepStrictEqual([q.status, q.body.reason], [401, 'auth_required']);
    // ページは開けない
    for (const p of ['/admin.html', '/', '/scoring.html']) {
      const r = await get(base, p, bearer(k.key));
      assert.deepStrictEqual([r.status, r.headers.get('www-authenticate')], [401, null], p);
    }
    assert.strictEqual((await get(base, '/share.html', bearer(k.key))).status, 200);
    // 取り消し
    const k2 = await issueKey(base, '取り消すキー');
    assert.strictEqual((await api(base, 'POST', '/api/ai-keys/' + k2.aiKey.id + '/revoke', {}, B)).status, 200);
    const rv = await api(base, 'GET', '/api/events', undefined, bearer(k2.key));
    assert.deepStrictEqual([rv.status, rv.body.reason], [401, 'key_revoked']);
    const listed = (await api(base, 'GET', '/api/ai-keys', undefined, B)).body.find(x => x.id === k2.aiKey.id);
    assert.strictEqual(listed.status, 'revoked');
  }, dir);
});

test('whoami: AI だけ。期限・上限・残り・砂場の接頭辞', async () => {
  await withServer(AUTH_DEV, async base => {
    const k = await issueKey(base);
    const r = await api(base, 'GET', '/api/ai/whoami', undefined, bearer(k.key));
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.keyId, r.body.label, r.body.expiresAt, r.body.sandboxPrefix],
      [k.aiKey.id, k.aiKey.label, k.aiKey.expiresAt, 'テスト用']);
    assert.deepStrictEqual(r.body.limits, { perMinute: 60, writesPerMinute: 30, perDay: 2000 });
    assert.deepStrictEqual(r.body.remaining, { minute: 59, writesMinute: 30, day: 1999 });
    assert.ok(r.body.now);
    assert.strictEqual((await api(base, 'GET', '/api/ai/whoami', undefined, B)).body.reason, 'role');
    assert.strictEqual((await api(base, 'GET', '/api/ai/whoami')).status, 401);
    // GET /api/session は ai
    const s = await api(base, 'GET', '/api/session', undefined, bearer(k.key));
    assert.deepStrictEqual([s.body.role, s.body.via], ['ai', 'bearer']);
  });
});

test('砂場: 本番の大会への書き込みは 403 sandbox。読みは 200、export・bundle は 403', async () => {
  await withServer(AUTH_DEV, async base => {
    const prod = await adminEvent(base, '本番の大会');
    const k = await issueKey(base, '砂場', WIDE);
    const h = bearer(k.key);
    const writes = [
      ['PATCH', '/api/events/' + prod, { venue: 'x' }],
      ['DELETE', '/api/events/' + prod],
      ['POST', '/api/events/' + prod + '/status', { to: 'round1_done' }],
      ['POST', '/api/events/' + prod + '/players', { name: 'x', court: 'A' }],
      ['POST', '/api/events/' + prod + '/players/bulk', { rows: [{ name: 'x', court: 'A' }] }],
      ['POST', '/api/events/' + prod + '/players/reorder', { court: 'A', isFemale: false, round: 1, ids: ['pa1'] }],
      ['PATCH', '/api/events/' + prod + '/players/pa1', { score: 1, baseRev: 0 }],
      ['DELETE', '/api/events/' + prod + '/players/pa1'],
      ['POST', '/api/events/' + prod + '/import', { csv: 'x' }],
      ['PUT', '/api/events/' + prod + '/techniques', { techniques: [] }],
      ['DELETE', '/api/events/' + prod + '/techniques'],
      ['PUT', '/api/events/' + prod + '/live/A', { playerId: null }],
      ['POST', '/api/events/' + prod + '/history', { action: 'x' }],
      ['POST', '/api/events/' + prod + '/rounds/2/generate', {}],
      ['POST', '/api/links', { targetType: 'event', targetId: prod }],
      ['GET', '/api/events/' + prod + '/export'],
      ['GET', '/api/events/' + prod + '/bundle']
    ];
    for (const [m, p, body] of writes) {
      const r = await api(base, m, p, body, h);
      assert.deepStrictEqual([r.status, r.body.reason], [403, 'sandbox'], m + ' ' + p + ' ' + JSON.stringify(r.body));
    }
    for (const p of ['/api/events/' + prod, '/api/events/' + prod + '/ranking', '/api/events/' + prod + '/history',
                     '/api/events/' + prod + '/techniques', '/api/techniques']) {
      assert.strictEqual((await api(base, 'GET', p, undefined, h)).status, 200, p);
    }
    const ev = (await api(base, 'GET', '/api/events/' + prod, undefined, B)).body;
    assert.deepStrictEqual([ev.name, ev.status, ev.players.length], ['本番の大会', 'round1', 2], '本番の大会は変わっていない');
    // 全体に効く操作・運営の操作
    for (const [m, p, body] of [['POST', '/api/techniques', { techniques: [] }], ['DELETE', '/api/techniques'],
                                ['POST', '/api/events/import', {}], ['GET', '/api/invites'],
                                ['POST', '/api/invites', { role: 'scorer', eventId: prod, court: 'A' }],
                                ['GET', '/api/ai-keys'], ['POST', '/api/ai-keys', { label: 'x' }],
                                ['POST', '/api/ai-keys/' + k.aiKey.id + '/revoke', {}], ['GET', '/api/nonexistent']]) {
      const r = await api(base, m, p, body, h);
      assert.deepStrictEqual([r.status, r.body.reason], [403, 'role'], m + ' ' + p);
    }
  });
});

test('作成: 「テスト用」だけ。test と createdBy。id 指定・本番名への改名は 403。コピー・雛形。削除は AI が作った大会だけ', async () => {
  await withServer(AUTH_DEV, async base => {
    const prod = await adminEvent(base, '本番の大会');
    const adminSand = await adminEvent(base, 'テスト用 運営の大会（削除しないでください）');
    const k = await issueKey(base, '作成', WIDE);
    const h = bearer(k.key);
    const no = await api(base, 'POST', '/api/events', { name: '本番っぽい名前' }, h);
    assert.deepStrictEqual([no.status, no.body.reason], [403, 'sandbox']);
    const withId = await api(base, 'POST', '/api/events', { id: prod, name: 'テスト用 上書き' }, h);
    assert.deepStrictEqual([withId.status, withId.body.reason], [403, 'sandbox']);
    const ok = await api(base, 'POST', '/api/events', { name: 'テスト用 AI の大会', date: '2026-10-12' }, h);
    assert.strictEqual(ok.status, 200);
    const id = ok.body.id;
    const file = (await api(base, 'GET', '/api/events/' + id, undefined, B)).body;
    assert.deepStrictEqual([file.test, file.createdBy, file.status], [true, 'ai', 'draft']);
    // 運営が保存し直しても createdBy は残る（body の createdBy は無視）
    await api(base, 'POST', '/api/events', { id: id, name: 'テスト用 AI の大会', createdBy: 'admin' }, B);
    assert.strictEqual((await api(base, 'GET', '/api/events/' + id, undefined, B)).body.createdBy, 'ai');
    // 運営が作った大会に createdBy は付かない
    assert.strictEqual((await api(base, 'GET', '/api/events/' + prod, undefined, B)).body.createdBy, undefined);

    const rn = await api(base, 'PATCH', '/api/events/' + id, { name: '本番の名前' }, h);
    assert.deepStrictEqual([rn.status, rn.body.reason], [403, 'sandbox']);
    assert.strictEqual((await api(base, 'PATCH', '/api/events/' + id, { name: 'テスト用 改名' }, h)).status, 200);
    assert.strictEqual((await api(base, 'PATCH', '/api/events/' + id, { venue: '道場' }, h)).status, 200);

    const cp = await api(base, 'POST', '/api/events/' + prod + '/copy', { name: 'テスト用 コピー', withPlayers: true }, h);
    assert.strictEqual(cp.status, 201);
    const cpFile = (await api(base, 'GET', '/api/events/' + cp.body.id, undefined, B)).body;
    assert.deepStrictEqual([cpFile.test, cpFile.createdBy, cpFile.players.length], [true, 'ai', 2]);
    assert.strictEqual((await api(base, 'POST', '/api/events/' + prod + '/copy', { name: '本番のコピー' }, h)).body.reason, 'sandbox');
    const tp = await api(base, 'POST', '/api/events/from-template', { template: 'systest', name: 'テスト用 雛形' }, h);
    assert.strictEqual(tp.status, 201);
    assert.strictEqual((await api(base, 'POST', '/api/events/from-template', { template: 'blank', name: 'テスト用' }, h)).status, 400);
    assert.strictEqual((await api(base, 'POST', '/api/events/from-template', { template: 'practice', name: '稽古' }, h)).body.reason, 'sandbox');

    // 削除: 運営が作ったテスト用は消せない（D11）、AI が作った大会は消せる
    const d1 = await api(base, 'DELETE', '/api/events/' + adminSand, undefined, h);
    assert.deepStrictEqual([d1.status, d1.body.reason], [403, 'sandbox']);
    assert.strictEqual((await api(base, 'DELETE', '/api/events/' + id, undefined, h)).status, 200);
    assert.strictEqual((await api(base, 'GET', '/api/events/' + id, undefined, B)).status, 404);
    // 運営が作ったテスト用の大会は読み書きできる
    assert.strictEqual((await api(base, 'PATCH', '/api/events/' + adminSand + '/players/pa1',
      { score: 3, result: '1', baseRev: 0, force: true }, h)).status, 200);
  });
});

test('作成: AI が作った大会は 20 件まで（21 件目は 409 sandbox_quota）', async () => {
  await withServer(AUTH_DEV, async base => {
    const k = await issueKey(base, '上限', WIDE);
    const h = bearer(k.key);
    for (let i = 0; i < 20; i++) {
      assert.strictEqual((await api(base, 'POST', '/api/events', { name: 'テスト用 ' + i }, h)).status, 200, String(i));
    }
    const r = await api(base, 'POST', '/api/events', { name: 'テスト用 21' }, h);
    assert.deepStrictEqual([r.status, r.body.reason], [409, 'sandbox_quota']);
    // 運営は今どおり作れる
    assert.strictEqual((await api(base, 'POST', '/api/events', { name: 'テスト用 運営' }, B)).status, 200);
  });
});

test('予行の流れ: 作成 → 選手 → 一巡目 → 採点 → 状態遷移 → 順位 → 削除（AI だけで）', async () => {
  await withServer(AUTH_DEV, async base => {
    const k = await issueKey(base, '予行', WIDE);
    const h = bearer(k.key);
    const id = (await api(base, 'POST', '/api/events/from-template', { template: 'tournament', name: 'テスト用 予行' }, h)).body.id;
    const bulk = await api(base, 'POST', '/api/events/' + id + '/players/bulk', {
      rows: [{ name: '一', court: 'A', bib: 1 }, { name: '二', court: 'A', bib: 2 }, { name: '三', court: 'B', isFemale: true, bib: 3 }]
    }, h);
    assert.strictEqual(bulk.status, 201, JSON.stringify(bulk.body));
    assert.strictEqual((await api(base, 'POST', '/api/events/' + id + '/status', { to: 'round1', from: 'draft' }, h)).status, 200);
    for (const p of bulk.body.players) {
      const r = await api(base, 'PATCH', '/api/events/' + id + '/players/' + p.id,
        { score: 10, result: '1', adjust: [0, 0, 0], totalAdjust: 0, confirmed: true, baseRev: 0 }, h);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    }
    assert.strictEqual((await api(base, 'PUT', '/api/events/' + id + '/live/A', { playerId: bulk.body.players[0].id }, h)).status, 200);
    assert.strictEqual((await api(base, 'POST', '/api/events/' + id + '/history', { action: 'note', detail: 'AI' }, h)).status, 200);
    assert.strictEqual((await api(base, 'POST', '/api/links', { targetType: 'event', targetId: id }, h)).status, 200);
    const st = await api(base, 'POST', '/api/events/' + id + '/status', { to: 'round1_done', from: 'round1' }, h);
    assert.strictEqual(st.status, 200, JSON.stringify(st.body));
    const rk = await api(base, 'GET', '/api/events/' + id + '/ranking', undefined, h);
    assert.strictEqual(rk.body.rankings.male.length, 2);
    // 履歴: AI の書き込みに ai_api（actor 付き）、状態遷移の actor も AI
    const hist = (await api(base, 'GET', '/api/events/' + id + '/history', undefined, h)).body.entries;
    const ai = hist.filter(e => e.action === 'ai_api');
    assert.ok(ai.length >= 8, String(ai.length));
    assert.ok(ai.every(e => e.actor === 'AI（予行）'));
    assert.ok(ai.some(e => e.detail === 'PATCH /api/events/:id/players/:playerId 選手 一 の採点'), JSON.stringify(ai.map(e => e.detail)));
    assert.ok(ai.some(e => e.detail === 'POST /api/events/:id/status 状態を「一巡目 終了」へ' ||
      e.detail.startsWith('POST /api/events/:id/status 状態を')), JSON.stringify(ai.map(e => e.detail)));
    assert.ok(ai.some(e => e.detail.startsWith('POST /api/events/from-template 大会「テスト用 予行」を作成')));
    assert.ok(hist.some(e => e.action === 'status_change' && e.actor === 'AI（予行）'));
    // CSRF の確認は AI に掛けない
    assert.strictEqual((await api(base, 'POST', '/api/events/' + id + '/history', { action: 'x' },
      Object.assign({ 'Sec-Fetch-Site': 'cross-site' }, h))).status, 200);
    assert.strictEqual((await api(base, 'DELETE', '/api/events/' + id, undefined, h)).status, 200);
  });
});

test('制限: 61 回目/分で 429 と Retry-After、書き込み 31 回目/分で 429', async () => {
  await withServer(AUTH_DEV, async base => {
    const k = await issueKey(base, '読み');
    for (let i = 0; i < 60; i++) {
      assert.strictEqual((await api(base, 'GET', '/api/techniques', undefined, bearer(k.key))).status, 200, String(i));
    }
    const r = await api(base, 'GET', '/api/techniques', undefined, bearer(k.key));
    assert.deepStrictEqual([r.status, r.body.reason], [429, 'rate_limited']);
    assert.ok(Number(r.headers.get('retry-after')) > 0 && r.body.retryAfter > 0);

    const w = await issueKey(base, '書き');
    const id = (await api(base, 'POST', '/api/events', { name: 'テスト用 制限' }, bearer(w.key))).body.id;
    for (let i = 1; i < 30; i++) {
      assert.strictEqual((await api(base, 'POST', '/api/events/' + id + '/history', { action: 'x' }, bearer(w.key))).status, 200, String(i));
    }
    const w31 = await api(base, 'POST', '/api/events/' + id + '/history', { action: 'x' }, bearer(w.key));
    assert.deepStrictEqual([w31.status, w31.body.reason], [429, 'rate_limited']);
    // 読みはまだ通る（書き込みの上限だけ）
    assert.strictEqual((await api(base, 'GET', '/api/events/' + id, undefined, bearer(w.key))).status, 200);
  });
});

test('制限: Bearer の失敗が 10 回で 11 回目は 429', async () => {
  await withServer(AUTH_DEV, async base => {
    for (let i = 0; i < 10; i++) {
      assert.strictEqual((await api(base, 'GET', '/api/events', undefined, bearer('phxai.bad'))).status, 401, String(i));
    }
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, bearer('phxai.bad'))).status, 429);
  });
});

test('記録: 監査ログに AI の全リクエスト。キーの文字列はどのファイル・ログにも無い', async () => {
  const dir = dataDir();
  let key;
  let output = '';
  await withServer(AUTH_DEV, async (base, server) => {
    const prod = await adminEvent(base, '本番の大会');
    const k = await issueKey(base, '記録');
    key = k.key;
    const h = bearer(key);
    await api(base, 'GET', '/api/events', undefined, h);
    await api(base, 'PATCH', '/api/events/' + prod, { venue: 'x' }, h);   // 403
    const id = (await api(base, 'POST', '/api/events', { name: 'テスト用 記録' }, h)).body.id;
    await api(base, 'DELETE', '/api/events/' + id, undefined, h);
    output = server.output();
  }, dir);
  const lines = fs.readFileSync(path.join(dir, 'auth', 'audit.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
  const ai = lines.filter(l => l.actor === 'AI');
  assert.deepStrictEqual(ai.map(l => [l.method, l.route, l.status]), [
    ['GET', '/api/events', 200],
    ['PATCH', '/api/events/:id', 403],
    ['POST', '/api/events', 200],
    ['DELETE', '/api/events/:id', 200]
  ]);
  assert.ok(ai[2].eventId && ai[2].eventId === ai[3].eventId);
  assert.ok(lines.some(l => l.action === 'aikey.create' && l.actor === 'admin'));
  const secret = key.split('.')[2];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(dir)) {
    assert.ok(!fs.readFileSync(f, 'utf-8').includes(secret), f + ' にキーがある');
  }
  assert.ok(!output.includes(secret), 'サーバーの出力にキーがある');
});

test('開発・認証なし: AI 用キーも発行でき、Bearer は AI として扱う（砂場が効く）', async () => {
  await withServer(NO_AUTH_DEV, async base => {
    const r = await api(base, 'POST', '/api/ai-keys', { label: '開発' });
    assert.strictEqual(r.status, 201);
    const no = await api(base, 'POST', '/api/events', { name: '本番' }, bearer(r.body.key));
    assert.strictEqual(no.body.reason, 'sandbox');
  });
});

main(() => DIRS.forEach(removeDataDir));
