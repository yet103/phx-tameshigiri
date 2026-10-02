// 招待リンク（採点の鍵）とセッション Cookie のテスト（段階 1）。
// 設計書 docs/superpowers/specs/2026-10-03-invite-links-and-ai-key-design.md 8.1。
// データは TMG_DATA_DIR の一時ディレクトリ（開発機の大会に触らない）。実行: npm test
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createRunner, makeDataDir, removeDataDir, startServer, withServer: withServerIn, basic, get, api
} = require('./test-support');
const cred = require('./credentials');
const { parseCookies } = require('./auth');
const authz = require('./authz');
const { classify, scorerAllowed, SCORER_FILES } = require('./static-policy');

const USER = 'staff';
const PASS = 'pa:ss-w0rd';
const B = basic(USER, PASS);
const { test, main } = createRunner();
const DIRS = [];
function dataDir() { const d = makeDataDir(); DIRS.push(d); return d; }

const AUTH_DEV = { NODE_ENV: 'development', AUTH_USER: USER, AUTH_PASS: PASS };
const AUTH_PROD = { NODE_ENV: 'production', AUTH_USER: USER, AUTH_PASS: PASS };
const NO_AUTH_DEV = { NODE_ENV: 'development', AUTH_USER: '', AUTH_PASS: '' };
const withServer = (env, fn, dir) => withServerIn(Object.assign({ TMG_DATA_DIR: dir || dataDir() }, env), fn);

// ── 準備のヘルパー ──
// A・B コートと未分類の行を持つ大会を作り、一巡目に進める。戻り値: 大会 ID
async function makeEvent(base, name, headers) {
  const created = await api(base, 'POST', '/api/events', {
    name: name, date: '', venue: '',
    settings: { courts: ['A', 'B'] },
    players: [
      { id: 'pa1', name: '甲', order: 'A-男子-1-1' },
      { id: 'pa2', name: '乙', order: 'A-男子-1-2' },
      { id: 'pb1', name: '丙', order: 'B-男子-1-1' },
      { id: 'pu1', name: '丁', order: '' }
    ]
  }, headers || B);
  assert.strictEqual(created.status, 200, JSON.stringify(created.body));
  const id = created.body.id;
  const st = await api(base, 'POST', '/api/events/' + id + '/status', { to: 'round1' }, headers || B);
  assert.strictEqual(st.status, 200, JSON.stringify(st.body));
  return id;
}

async function invite(base, eventId, extra, headers) {
  const r = await api(base, 'POST', '/api/invites',
    Object.assign({ role: 'scorer', eventId: eventId, court: 'A', label: 'A コート タブレット' }, extra || {}), headers || B);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

// join して Cookie ヘッダの値（'tmg_s=…'）を返す
async function join(base, key, headers) {
  const r = await api(base, 'POST', '/api/join', { key: key, confirm: true }, headers);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const sc = r.headers.get('set-cookie');
  assert.ok(sc, 'Set-Cookie がある');
  return sc.split(';')[0];
}

const C = cookie => ({ Cookie: cookie });

// ── 単体: 鍵の書式と照合 ──
test('鍵: 生成した鍵は isValidId の ID と 43 文字の秘密。形の違いは無効', () => {
  const dir = dataDir();
  const store = cred.createCredentials({ dir: path.join(dir, 'auth') });
  const { key, invite: inv } = store.createInvite({
    role: 'scorer', eventId: 'ev1', court: 'A', label: 'x', expiresAt: new Date(Date.now() + 3600e3).toISOString(), maxDevices: 2
  });
  const t = cred.parseToken('invite', key);
  assert.ok(t && /^[A-Za-z0-9_-]{12}$/.test(t.id) && /^[A-Za-z0-9_-]{43}$/.test(t.secret), key);
  assert.strictEqual(t.id, inv.id);
  for (const bad of ['', 'a', 'a.b.c', t.id + '.' + t.secret + 'x', t.id + '.' + t.secret.slice(1),
                     t.id + '!.' + t.secret, '.' + t.secret, t.id + '.', 'phxai.' + key, key + ' ']) {
    assert.strictEqual(cred.parseToken('invite', bad), null, bad);
  }
  const ai = 'phxai.' + t.id + '.' + t.secret;
  assert.deepStrictEqual(cred.parseToken('ai', ai), t);
  assert.strictEqual(cred.parseToken('ai', key), null);
  assert.strictEqual(cred.parseToken('ai', 'phxa.' + key), null);
});

test('鍵: 正しい秘密だけ通る。secretHash に鍵そのものが含まれない', () => {
  const dir = dataDir();
  const store = cred.createCredentials({ dir: path.join(dir, 'auth') });
  const { key, invite: inv } = store.createInvite({
    role: 'scorer', eventId: 'ev1', court: null, label: 'x', expiresAt: new Date(Date.now() + 3600e3).toISOString(), maxDevices: 2
  });
  const t = cred.parseToken('invite', key);
  assert.ok(cred.verifySecret(t.secret, inv.secretHash));
  assert.ok(!cred.verifySecret(t.secret.slice(0, 42) + (t.secret[42] === 'A' ? 'B' : 'A'), inv.secretHash));
  assert.ok(!cred.verifySecret(t.secret, 'sha256:zz'));
  assert.ok(!inv.secretHash.includes(t.secret));
  assert.strictEqual(store.checkInviteKey(key).ok, true);
  assert.strictEqual(store.checkInviteKey(t.id + '.' + 'A'.repeat(43)).reason, 'key_invalid');
  const fileText = fs.readFileSync(path.join(dir, 'auth', 'invites.json'), 'utf-8');
  assert.ok(!fileText.includes(t.secret), 'ファイルに秘密が無い');
});

// ── 単体: 期限 ──
test('期限: 日本時間の日の終わり・既定・範囲外', () => {
  assert.strictEqual(cred.endOfDayJst('2026-10-12').toISOString(), '2026-10-12T14:59:59.999Z');
  assert.strictEqual(cred.endOfDayJst(''), null);
  assert.strictEqual(cred.endOfDayJst('2026/10/12'), null);
  // 2026-10-03 10:00 JST（01:00Z）に発行
  const now = Date.parse('2026-10-03T01:00:00.000Z');
  assert.strictEqual(cred.defaultInviteExpiry('2026-10-12', now).toISOString(), '2026-10-12T14:59:59.999Z');
  assert.strictEqual(cred.defaultInviteExpiry('', now).toISOString(), '2026-10-03T14:59:59.999Z');
  assert.strictEqual(cred.defaultInviteExpiry('2026-09-01', now).toISOString(), '2026-10-03T14:59:59.999Z');
  // 日本時間で日付が変わる直前（2026-10-03 23:30 JST = 14:30Z）と直後（00:30 JST = 15:30Z）
  assert.strictEqual(cred.defaultInviteExpiry('', Date.parse('2026-10-03T14:30:00Z')).toISOString(), '2026-10-03T14:59:59.999Z');
  assert.strictEqual(cred.defaultInviteExpiry('', Date.parse('2026-10-03T15:30:00Z')).toISOString(), '2026-10-04T14:59:59.999Z');
  assert.strictEqual(cred.inviteExpiryFromPreset('tomorrow', '', now).toISOString(), '2026-10-04T14:59:59.999Z');
  assert.strictEqual(cred.inviteExpiryFromPreset('today', '2026-10-12', now).toISOString(), '2026-10-03T14:59:59.999Z');
  assert.strictEqual(cred.inviteExpiryFromPreset('zzz', '', now), null);
  const K = cred.constants;
  assert.ok(cred.parseExpiry(new Date(now + 3600e3).toISOString(), now, K.INVITE_MIN_MS, K.INVITE_MAX_MS));
  assert.strictEqual(cred.parseExpiry(new Date(now + 5 * 60e3).toISOString(), now, K.INVITE_MIN_MS, K.INVITE_MAX_MS), null);
  assert.strictEqual(cred.parseExpiry(new Date(now + 8 * 86400e3).toISOString(), now, K.INVITE_MIN_MS, K.INVITE_MAX_MS), null);
  assert.strictEqual(cred.parseExpiry('あした', now, K.INVITE_MIN_MS, K.INVITE_MAX_MS), null);
});

// ── 単体: Cookie ──
test('Cookie の解析: 複数・同名の重複・"=" を含む値・壊れた値', () => {
  assert.deepStrictEqual(parseCookies('a=1; tmg_s=x.y; b=2'),
    [{ name: 'a', value: '1' }, { name: 'tmg_s', value: 'x.y' }, { name: 'b', value: '2' }]);
  assert.deepStrictEqual(parseCookies('tmg_s=one; tmg_s=two').map(c => c.value), ['one', 'two']);
  assert.deepStrictEqual(parseCookies('k=a=b=c'), [{ name: 'k', value: 'a=b=c' }]);
  assert.deepStrictEqual(parseCookies('novalue; =x; ;  ; ok=1'), [{ name: 'ok', value: '1' }]);
  assert.deepStrictEqual(parseCookies(undefined), []);
  assert.deepStrictEqual(parseCookies(''), []);
});

test('端末の要約', () => {
  assert.strictEqual(cred.summarizeUa('Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'), 'iPad・Safari');
  assert.strictEqual(cred.summarizeUa('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'), 'Android・Chrome');
  assert.strictEqual(cred.summarizeUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0'), 'Windows・Edge');
  assert.strictEqual(cred.summarizeUa('node'), '不明な端末');
});

// ── 単体: 認可の判定表 ──
test('authz: index.js の /api/ ルートは全部ルート表にあり、表のルートは全部 index.js にある', () => {
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf-8');
  const re = /app\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']*)'/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) !== null) found.push(m[1].toUpperCase() + ' ' + m[2]);
  assert.ok(found.length >= 40, '拾えたルート ' + found.length);
  const table = authz.ROUTES.map(r => r.method + ' ' + r.pattern);
  const missing = found.filter(f => table.indexOf(f) === -1);
  assert.deepStrictEqual(missing, [], '判定表に無いルート');
  const extra = table.filter(t => found.indexOf(t) === -1);
  assert.deepStrictEqual(extra, [], 'index.js に無い判定表の行');
});

test('authz: 照合（大文字・HEAD・import と :id の区別・末尾スラッシュ）', () => {
  assert.strictEqual(authz.matchRoute('GET', '/API/Events').route.pattern, '/api/events');
  assert.strictEqual(authz.matchRoute('HEAD', '/api/events/abc').route.pattern, '/api/events/:id');
  assert.strictEqual(authz.matchRoute('POST', '/api/events/import').route.pattern, '/api/events/import');
  const g = authz.matchRoute('GET', '/api/events/import');
  assert.strictEqual(g.route.pattern, '/api/events/:id');
  assert.strictEqual(g.params.id, 'import');
  assert.strictEqual(authz.matchRoute('GET', '/api/events/').route.pattern, '/api/events');
  const live = authz.matchRoute('PUT', '/api/events/Ab1/live/%E7%A8%BD%E5%8F%A4');
  assert.deepStrictEqual(live.params, { id: 'Ab1', court: '稽古' });
  assert.strictEqual(authz.matchRoute('GET', '/api/nonexistent'), null);
  assert.strictEqual(authz.matchRoute('PATCH', '/api/events'), null);
});

test('authz: 表に無いパスは運営以外拒否。採点の自・AI の砂', () => {
  const admin = { kind: 'admin', via: 'basic' };
  const scorer = { kind: 'scorer', eventId: 'ev1', court: 'A', label: 'A' };
  const scorerAll = { kind: 'scorer', eventId: 'ev1', court: null, label: '全' };
  const ai = { kind: 'ai', label: 'x' };
  const anon = { kind: 'anonymous', reason: 'auth_required' };
  const none = authz.matchRoute('GET', '/api/nonexistent');
  assert.strictEqual(authz.authorize(admin, none, {}), null);
  assert.strictEqual(authz.authorize(scorer, none, {}).body.reason, 'role');
  assert.strictEqual(authz.authorize(ai, none, {}).body.reason, 'role');
  assert.strictEqual(authz.authorize(anon, none, {}).status, 401);
  const r = (m, p) => authz.matchRoute(m, p);
  assert.strictEqual(authz.authorize(scorer, r('GET', '/api/events/ev1'), {}), null);
  assert.strictEqual(authz.authorize(scorer, r('GET', '/api/events/ev2'), {}).body.reason, 'scope');
  assert.strictEqual(authz.authorize(scorer, r('PUT', '/api/events/ev1/live/A'), {}), null);
  assert.strictEqual(authz.authorize(scorer, r('PUT', '/api/events/ev1/live/B'), {}).body.reason, 'scope');
  assert.strictEqual(authz.authorize(scorerAll, r('PUT', '/api/events/ev1/live/B'), {}), null);
  assert.strictEqual(authz.authorize(scorer, r('DELETE', '/api/events/ev1'), {}).body.reason, 'role');
  assert.strictEqual(authz.authorize(admin, r('GET', '/api/ai/whoami'), {}).body.reason, 'role');
  const load = id => ({ ev1: { name: '本番' }, ev2: { name: 'テスト用 x' }, ev3: { name: '  テスト用', createdBy: 'ai' } })[id] || null;
  assert.strictEqual(authz.authorize(ai, r('PATCH', '/api/events/ev1'), { loadEvent: load }).body.reason, 'sandbox');
  assert.strictEqual(authz.authorize(ai, r('PATCH', '/api/events/ev2'), { loadEvent: load }), null);
  assert.strictEqual(authz.authorize(ai, r('PATCH', '/api/events/zz'), { loadEvent: load }), null);   // 無ければハンドラの 404
  assert.strictEqual(authz.authorize(ai, r('DELETE', '/api/events/ev2'), { loadEvent: load }).body.reason, 'sandbox');
  assert.strictEqual(authz.authorize(ai, r('DELETE', '/api/events/ev3'), { loadEvent: load }), null);
  assert.strictEqual(authz.authorize(ai, r('GET', '/api/events/ev1/ranking'), { loadEvent: load }), null);
  assert.ok(authz.isSandboxName(' テスト用 予行'));
  assert.ok(!authz.isSandboxName('ﾃｽﾄ用'));
  assert.ok(!authz.isSandboxName('本番 テスト用'));
  assert.ok(!authz.isSandboxName(null));
});

// ── 単体: 静的配信 ──
test('static-policy: join は公開、招待の画面ファイルは保護、SCORER_FILES、tools と auth は配信しない', () => {
  for (const p of ['/join.html', '/join.js', '/join.css', '/join']) {
    assert.strictEqual(classify(p, { production: true }), 'public', p);
  }
  for (const p of ['/vendor/qrcode.js', '/desk-invites.js', '/scope.js']) {
    assert.strictEqual(classify(p, { production: true }), 'protected', p);
  }
  assert.deepStrictEqual(Array.from(SCORER_FILES).sort(),
    ['app.js', 'data.js', 'outbox.js', 'route.js', 'scope.js', 'scoring.html', 'status.js', 'storage.js', 'style.css']);
  assert.ok(scorerAllowed('/scoring.html'));
  assert.ok(!scorerAllowed('/admin.html'));
  assert.ok(!scorerAllowed('/'));
  for (const p of ['/tools/mcp/phx-tameshigiri/server.mjs', '/server/data/auth/invites.json',
                   '/%73erver/data/auth/sessions.json', '/vendor/', '/vendor/other.js', '/join/', '/JOIN']) {
    assert.strictEqual(classify(p, { production: false }), null, p);
  }
});

// ── 結合: 発行 ──
test('発行: 運営だけ。key は 1 回だけ。一覧に key も secretHash も無い。知らないコートは 400', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '招待テスト');
    const inv = await invite(base, ev);
    assert.ok(/^[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/.test(inv.key), inv.key);
    assert.strictEqual(inv.joinPath, '/join#k=' + inv.key);
    assert.strictEqual(inv.invite.court, 'A');
    assert.strictEqual(inv.invite.status, 'active');
    assert.strictEqual(inv.invite.eventName, '招待テスト');
    assert.strictEqual(inv.invite.maxDevices, 2);
    assert.strictEqual(inv.invite.secretHash, undefined);
    const list = await api(base, 'GET', '/api/invites?eventId=' + ev, undefined, B);
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.length, 1);
    const text = JSON.stringify(list.body);
    assert.ok(!text.includes(inv.key.split('.')[1]) && !text.includes('secretHash'), text);
    // 無認証 401、採点の Cookie 403
    assert.strictEqual((await api(base, 'POST', '/api/invites', { role: 'scorer', eventId: ev, court: 'A' })).status, 401);
    const cookie = await join(base, inv.key);
    const asScorer = await api(base, 'POST', '/api/invites', { role: 'scorer', eventId: ev, court: 'A' }, C(cookie));
    assert.deepStrictEqual([asScorer.status, asScorer.body.reason], [403, 'role']);
    assert.strictEqual((await api(base, 'GET', '/api/invites', undefined, C(cookie))).status, 403);
    // 入力の検査
    const bad = async (body, reason, status) => {
      const r = await api(base, 'POST', '/api/invites', Object.assign({ role: 'scorer', eventId: ev, court: 'A' }, body), B);
      assert.deepStrictEqual([r.status, r.body.reason], [status || 400, reason], JSON.stringify(body));
    };
    await bad({ court: 'Z' }, 'unknown_court');
    await bad({ court: '未分類' }, 'unknown_court');
    await bad({ role: 'admin' }, 'bad_role');
    await bad({ maxDevices: 6 }, 'bad_max_devices');
    await bad({ maxDevices: 0 }, 'bad_max_devices');
    await bad({ label: 'あ'.repeat(41) }, 'bad_label');
    await bad({ expiresAt: new Date(Date.now() + 60e3).toISOString() }, 'bad_expiry');
    await bad({ expiresAt: new Date(Date.now() + 8 * 86400e3).toISOString() }, 'bad_expiry');
    const nf = await api(base, 'POST', '/api/invites', { role: 'scorer', eventId: 'nosuchevent', court: 'A' }, B);
    assert.strictEqual(nf.status, 404);
    // 全コート・ラベルの既定・期限の型
    const all = await invite(base, ev, { court: null, label: '', expiresPreset: 'tomorrow', maxDevices: 5 });
    assert.deepStrictEqual([all.invite.court, all.invite.label, all.invite.maxDevices], [null, '全コート', 5]);
    assert.ok(/T14:59:59\.999Z$/.test(all.invite.expiresAt), all.invite.expiresAt);
    const def = await invite(base, ev, { label: '' });
    assert.strictEqual(def.invite.label, 'A コート');
  });
});

// ── 結合: 交換 ──
test('交換: 下見はセッションを作らない。登録で Cookie。違う鍵・取り消し・端末数の上限', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '交換テスト');
    const inv = await invite(base, ev);
    const pre = await api(base, 'POST', '/api/join', { key: inv.key, confirm: false });
    assert.strictEqual(pre.status, 200);
    assert.strictEqual(pre.headers.get('set-cookie'), null);
    assert.strictEqual(pre.headers.get('cache-control'), 'no-store');
    assert.deepStrictEqual([pre.body.role, pre.body.eventId, pre.body.eventName, pre.body.court, pre.body.devices],
      ['scorer', ev, '交換テスト', 'A', { active: 0, max: 2 }]);
    assert.ok(pre.body.now && pre.body.expiresAt);
    const listed = await api(base, 'GET', '/api/invites', undefined, B);
    assert.strictEqual(listed.body[0].devices.length, 0, '下見で端末が増えない');

    const r = await api(base, 'POST', '/api/join', { key: inv.key, confirm: true },
      { 'User-Agent': 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) Version/17.6 Safari/604.1' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.next, '/scoring.html#event/' + ev + '/A');
    const sc = r.headers.get('set-cookie');
    assert.ok(/^tmg_s=[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}; /.test(sc), sc);
    for (const attr of ['HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(sc.includes(attr), attr);
    const maxAge = Number(/Max-Age=(\d+)/.exec(sc)[1]);
    // 期限 + 30 日（掃除までの保持期間。期限の判定はサーバー。結合試験 E1）
    assert.ok(maxAge > 30 * 86400 && maxAge <= 37 * 86400, sc);
    assert.ok(!sc.includes('Secure'), '開発は Secure を付けない');
    const devs = (await api(base, 'GET', '/api/invites', undefined, B)).body[0].devices;
    assert.deepStrictEqual([devs.length, devs[0].summary, devs[0].status], [1, 'iPad・Safari', 'active']);

    // クエリの ?k= は読まない
    const q = await api(base, 'POST', '/api/join?k=' + encodeURIComponent(inv.key), { confirm: true });
    assert.deepStrictEqual([q.status, q.body.reason], [401, 'key_invalid']);
    // 違う鍵
    const t = cred.parseToken('invite', inv.key);
    const wrong = await api(base, 'POST', '/api/join', { key: t.id + '.' + 'A'.repeat(43), confirm: false });
    assert.deepStrictEqual([wrong.status, wrong.body.reason], [401, 'key_invalid']);
    assert.strictEqual((await api(base, 'POST', '/api/join', { key: 'garbage', confirm: true })).body.reason, 'key_invalid');
    assert.strictEqual((await api(base, 'POST', '/api/join', '{bad', {})).status, 400);

    // 2 台目まで、3 台目は 409 device_limit
    await join(base, inv.key);
    const third = await api(base, 'POST', '/api/join', { key: inv.key, confirm: true });
    assert.deepStrictEqual([third.status, third.body.reason, third.body.devices], [409, 'device_limit', { active: 2, max: 2 }]);
    assert.strictEqual(third.headers.get('set-cookie'), null);

    // 取り消し済み
    const inv2 = await invite(base, ev, { court: 'B', label: 'B' });
    assert.strictEqual((await api(base, 'POST', '/api/invites/' + inv2.invite.id + '/revoke', {}, B)).status, 200);
    const rv = await api(base, 'POST', '/api/join', { key: inv2.key, confirm: false });
    assert.deepStrictEqual([rv.status, rv.body.reason], [401, 'invite_revoked']);
  });
});

test('交換: 期限切れの招待は 401 invite_expired、期限切れのセッションは session_expired', async () => {
  const dir = dataDir();
  // 起動前に大会・招待・セッションのファイルを書く（ストアは起動時に読む）
  fs.mkdirSync(path.join(dir, 'events'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'auth'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'events', 'evx.json'), JSON.stringify({
    id: 'evx', name: '期限テスト', date: '', venue: '', status: 'round1',
    players: [{ id: 'p1', name: '甲', order: 'A-男子-1-1' }], settings: { courts: ['A'] }
  }));
  const invSecret = 'S'.repeat(43);
  const sesSecret = 'T'.repeat(43);
  const past = new Date(Date.now() - 3600e3).toISOString();
  fs.writeFileSync(path.join(dir, 'auth', 'invites.json'), JSON.stringify({ version: 1, invites: [{
    id: 'InvExpired01', role: 'scorer', eventId: 'evx', court: 'A', label: 'A', secretHash: cred.hashSecret(invSecret),
    createdAt: past, expiresAt: past, maxDevices: 2, revokedAt: null, revokedReason: null, lastJoinAt: null
  }] }));
  fs.writeFileSync(path.join(dir, 'auth', 'sessions.json'), JSON.stringify({ version: 1, sessions: [{
    id: 'SesExpired01', inviteId: 'InvExpired01', secretHash: cred.hashSecret(sesSecret),
    createdAt: past, expiresAt: past, lastSeenAt: past, revokedAt: null, device: { ua: '', summary: '不明な端末' }
  }] }));
  await withServer(AUTH_DEV, async base => {
    const r = await api(base, 'POST', '/api/join', { key: 'InvExpired01.' + invSecret, confirm: false });
    assert.deepStrictEqual([r.status, r.body.reason, r.body.expiresAt], [401, 'invite_expired', past]);
    const cookie = C('tmg_s=SesExpired01.' + sesSecret);
    const s = await api(base, 'GET', '/api/session', undefined, cookie);
    assert.deepStrictEqual([s.status, s.body.role, s.body.reason], [200, 'none', 'session_expired']);
    const e = await api(base, 'GET', '/api/events', undefined, cookie);
    assert.deepStrictEqual([e.status, e.body.reason], [401, 'session_expired']);
    const page = await get(base, '/scoring.html', cookie);
    assert.strictEqual(page.status, 401);
    assert.strictEqual(page.headers.get('www-authenticate'), null);
    assert.ok((await page.text()).includes('期限切れ'));
    // 開発の認証なしでも、無効な Cookie は運営にしない
  }, dir);
  await withServer(NO_AUTH_DEV, async base => {
    const cookie = C('tmg_s=SesExpired01.' + sesSecret);
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, cookie)).status, 401);
    assert.strictEqual((await api(base, 'GET', '/api/events')).status, 200);
  }, dir);
});

test('交換: 失敗が 10 回で 11 回目は 429（Retry-After）', async () => {
  await withServer(AUTH_DEV, async base => {
    for (let i = 0; i < 10; i++) {
      const r = await api(base, 'POST', '/api/join', { key: 'x' + i, confirm: false });
      assert.strictEqual(r.status, 401, 'attempt ' + (i + 1));
    }
    const r = await api(base, 'POST', '/api/join', { key: 'x', confirm: false });
    assert.deepStrictEqual([r.status, r.body.reason], [429, 'rate_limited']);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.ok(r.body.retryAfter > 0);
  });
});

test('交換: 本番は __Host-tmg_s と Secure', async () => {
  await withServer(AUTH_PROD, async base => {
    const ev = await makeEvent(base, '本番 Cookie テスト');
    const inv = await invite(base, ev);
    const r = await api(base, 'POST', '/api/join', { key: inv.key, confirm: true });
    const sc = r.headers.get('set-cookie');
    assert.ok(sc.startsWith('__Host-tmg_s='), sc);
    assert.ok(sc.includes('; Secure') && sc.includes('Path=/') && !/Domain=/i.test(sc), sc);
    const cookie = sc.split(';')[0];
    const s = await api(base, 'GET', '/api/session', undefined, C(cookie));
    assert.strictEqual(s.body.role, 'scorer');
    // 開発の名前の Cookie は本番では読まない
    const devName = await api(base, 'GET', '/api/session', undefined, C(cookie.replace('__Host-tmg_s', 'tmg_s')));
    assert.strictEqual(devName.body.role, 'none');
  });
});

test('固定: 作り話の Cookie で join しても新しい ID。同じ招待で入り直すと前を取り消して数が増えない', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '固定テスト');
    const inv = await invite(base, ev, { maxDevices: 1 });
    const fake = 'tmg_s=AttackerSes1.' + 'Q'.repeat(43);
    const c1 = await join(base, inv.key, C(fake));
    assert.notStrictEqual(c1.split('=')[1].split('.')[0], 'AttackerSes1');
    // 端末 1 台の招待でも、同じ端末（Cookie あり）なら入り直せる
    const pre = await api(base, 'POST', '/api/join', { key: inv.key, confirm: false }, C(c1));
    assert.strictEqual(pre.body.rejoin, true);
    const c2 = await join(base, inv.key, C(c1));
    assert.notStrictEqual(c2, c1);
    const devs = (await api(base, 'GET', '/api/invites', undefined, B)).body[0].devices;
    assert.deepStrictEqual(devs.map(d => d.status).sort(), ['active', 'revoked']);
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, C(c1))).body.reason, 'session_revoked');
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, C(c2))).status, 200);
    // 別の端末（Cookie なし）は上限で 409
    assert.strictEqual((await api(base, 'POST', '/api/join', { key: inv.key, confirm: true })).status, 409);
    // 同名の Cookie が 2 つ（古い無効なものと有効なもの）でも、有効なほうで通る
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, C(c1 + '; ' + c2))).status, 200);
  });
});

// ── 結合: 採点の API ──
test('採点の API: 自分の大会・コート・採点の項目だけ', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '採点 API テスト');
    const other = await makeEvent(base, '別の大会');
    const inv = await invite(base, ev);
    const cookie = C(await join(base, inv.key));

    const sess = await api(base, 'GET', '/api/session', undefined, cookie);
    assert.deepStrictEqual([sess.body.role, sess.body.via, sess.body.scope, sess.body.label],
      ['scorer', 'session', { eventId: ev, eventName: '採点 API テスト', court: 'A' }, 'A コート タブレット']);
    assert.strictEqual(sess.body.expiresAt, inv.invite.expiresAt);

    const list = await api(base, 'GET', '/api/events', undefined, cookie);
    assert.deepStrictEqual(list.body.map(e => e.id), [ev]);
    assert.strictEqual((await api(base, 'GET', '/api/events/' + ev, undefined, cookie)).status, 200);
    const o = await api(base, 'GET', '/api/events/' + other, undefined, cookie);
    assert.deepStrictEqual([o.status, o.body.reason], [403, 'scope']);
    assert.strictEqual((await api(base, 'GET', '/api/events/' + ev + '/techniques', undefined, cookie)).status, 200);
    assert.strictEqual((await api(base, 'GET', '/api/techniques', undefined, cookie)).status, 200);

    const full = { score: 5, result: '1', adjust: [0, 0, 0], totalAdjust: 0, confirmed: true, note: 'メモ', baseRev: 0 };
    const ok = await api(base, 'PATCH', '/api/events/' + ev + '/players/pa1', full, cookie);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.deepStrictEqual([ok.body.player.score, ok.body.player.confirmed, ok.body.player.rev], [5, true, 1]);
    const noRev = await api(base, 'PATCH', '/api/events/' + ev + '/players/pa2', { score: 1 }, cookie);
    assert.deepStrictEqual([noRev.status, noRev.body.reason], [400, 'base_rev_required']);
    assert.strictEqual((await api(base, 'PATCH', '/api/events/' + ev + '/players/pa2', { note: 'だけ' }, cookie)).status, 200);
    // r2tech（二巡目の形の申請）も運営の項目（設計書 2026-10-03 2.1・9.3）
    for (const extra of [{ tech1: '真' }, { r2tech1: '真' }, { name: '甲' }, { isFemale: false }, { force: true }, { foo: 1 }, { court: 'A' }]) {
      const r = await api(base, 'PATCH', '/api/events/' + ev + '/players/pa2',
        Object.assign({ score: 1, baseRev: 0 }, extra), cookie);
      assert.deepStrictEqual([r.status, r.body.reason, r.body.fields], [403, 'field', Object.keys(extra)], JSON.stringify(extra));
    }
    for (const pid of ['pb1', 'pu1']) {
      const r = await api(base, 'PATCH', '/api/events/' + ev + '/players/' + pid, { score: 1, baseRev: 0 }, cookie);
      assert.deepStrictEqual([r.status, r.body.reason], [403, 'scope'], pid);
    }
    const otherPatch = await api(base, 'PATCH', '/api/events/' + other + '/players/pa1', { score: 1, baseRev: 0 }, cookie);
    assert.deepStrictEqual([otherPatch.status, otherPatch.body.reason], [403, 'scope']);

    assert.strictEqual((await api(base, 'PUT', '/api/events/' + ev + '/live/A', { playerId: 'pa1' }, cookie)).status, 200);
    assert.strictEqual((await api(base, 'PUT', '/api/events/' + ev + '/live/B', { playerId: null }, cookie)).body.reason, 'scope');
    assert.strictEqual((await api(base, 'PUT', '/api/events/' + ev + '/live/A', { playerId: 'pb1' }, cookie)).body.reason, 'scope');

    const h = await api(base, 'POST', '/api/events/' + ev + '/history', { action: 'score', detail: 'x', actor: 'うそ' }, cookie);
    assert.strictEqual(h.status, 200);
    const hist = (await api(base, 'GET', '/api/events/' + ev + '/history', undefined, B)).body.entries;
    assert.strictEqual(hist[hist.length - 1].actor, '採点端末（A コート タブレット）');
    assert.ok(hist.some(e => e.action === 'status_change' && e.actor === '運営'), '運営の遷移に actor');

    const denied = [
      ['DELETE', '/api/events/' + ev], ['POST', '/api/events/' + ev + '/status', { to: 'round1_done' }],
      ['POST', '/api/events/' + ev + '/import', { csv: 'x' }], ['GET', '/api/events/' + ev + '/export'],
      ['PUT', '/api/events/' + ev + '/techniques', { techniques: [] }], ['DELETE', '/api/events/' + ev + '/techniques'],
      ['POST', '/api/links', { targetType: 'event', targetId: ev }], ['GET', '/api/invites'],
      ['POST', '/api/invites', { role: 'scorer', eventId: ev, court: 'A' }], ['GET', '/api/events/' + ev + '/ranking'],
      ['GET', '/api/events/' + ev + '/history'], ['POST', '/api/events', { name: 'x' }],
      ['PATCH', '/api/events/' + ev, { name: 'x' }], ['POST', '/api/events/' + ev + '/players', { name: 'x', court: 'A' }],
      ['DELETE', '/api/events/' + ev + '/players/pa1'], ['POST', '/api/techniques', { techniques: [] }],
      ['GET', '/api/ai-keys'], ['GET', '/api/ai/whoami'], ['GET', '/api/nonexistent']
    ];
    for (const [m, p, body] of denied) {
      const r = await api(base, m, p, body, cookie);
      assert.deepStrictEqual([r.status, r.body.reason], [403, 'role'], m + ' ' + p);
    }
    assert.ok((await api(base, 'GET', '/api/events/' + ev, undefined, B)).body.name, '大会は消えていない');
  });
});

test('採点のページ: 採点画面とその依存は 200、他の保護ページは 403（ダイアログなし）、/ は採点画面へ', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, 'ページテスト');
    const cookie = C(await join(base, (await invite(base, ev)).key));
    for (const f of Array.from(SCORER_FILES).filter(f => f !== 'scope.js')) {
      assert.strictEqual((await get(base, '/' + f, cookie)).status, 200, f);
    }
    for (const p of ['/scoring.js', '/api.js', '/courts.js', '/theme.css', '/help.html']) {
      assert.strictEqual((await get(base, p, cookie)).status, 200, p);
    }
    for (const p of ['/admin.html', '/desk.html', '/ranking.html', '/techniques.html', '/home.js', '/desk.js', '/test.html']) {
      const r = await get(base, p, cookie);
      assert.strictEqual(r.status, 403, p);
      assert.strictEqual(r.headers.get('www-authenticate'), null, p);
      assert.strictEqual(r.headers.get('cache-control'), 'no-store', p);
      const text = await r.text();
      assert.ok(text.includes('A コート の採点専用') && text.includes('/api/session/logout') && !text.includes('<script'), p);
    }
    for (const p of ['/', '/index.html']) {
      const r = await get(base, p, cookie);
      assert.deepStrictEqual([r.status, r.headers.get('location')], [302, '/scoring.html'], p);
    }
  });
});

test('取り消し: 端末・招待・大会の削除', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '取り消しテスト');
    const inv = await invite(base, ev);
    const c1 = C(await join(base, inv.key));
    const c2 = C(await join(base, inv.key));
    const devs = (await api(base, 'GET', '/api/invites', undefined, B)).body[0].devices;
    const r = await api(base, 'POST', '/api/sessions/' + devs[0].id + '/revoke', {}, B);
    assert.deepStrictEqual([r.status, r.body], [200, { success: true }]);
    assert.strictEqual((await api(base, 'POST', '/api/sessions/nosuch/revoke', {}, B)).status, 404);
    const after1 = await api(base, 'GET', '/api/events', undefined, c1);
    assert.deepStrictEqual([after1.status, after1.body.reason], [401, 'session_revoked']);
    const page = await get(base, '/scoring.html', c1);
    assert.deepStrictEqual([page.status, page.headers.get('www-authenticate')], [401, null]);
    assert.ok((await page.text()).includes('取り消し済み'));
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, c2)).status, 200, 'もう 1 台は使える');

    const rv = await api(base, 'POST', '/api/invites/' + inv.invite.id + '/revoke', {}, B);
    assert.deepStrictEqual([rv.status, rv.body], [200, { success: true, revokedSessions: 1 }]);
    const after2 = await api(base, 'PATCH', '/api/events/' + ev + '/players/pa1', { score: 1, baseRev: 0 }, c2);
    assert.deepStrictEqual([after2.status, after2.body.reason], [401, 'invite_revoked']);
    const listed = (await api(base, 'GET', '/api/invites', undefined, B)).body[0];
    assert.deepStrictEqual([listed.status, listed.revokedReason], ['revoked', 'manual']);

    // 大会の削除で招待が event_deleted
    const inv3 = await invite(base, ev, { court: 'B', label: 'B' });
    const c3 = C(await join(base, inv3.key));
    assert.strictEqual((await api(base, 'DELETE', '/api/events/' + ev, undefined, B)).status, 200);
    const gone = (await api(base, 'GET', '/api/invites', undefined, B)).body.find(i => i.id === inv3.invite.id);
    assert.deepStrictEqual([gone.status, gone.revokedReason, gone.eventName], ['revoked', 'event_deleted', null]);
    assert.strictEqual((await api(base, 'GET', '/api/session', undefined, c3)).body.reason, 'invite_revoked');
  });
});

test('解除: POST /api/session/logout で自分のセッションを取り消し、Cookie を消す（フォームは 303）', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '解除テスト');
    const inv = await invite(base, ev);
    const c1 = C(await join(base, inv.key));
    const r = await api(base, 'POST', '/api/session/logout', undefined, c1);
    assert.deepStrictEqual([r.status, r.body], [200, { success: true }]);
    assert.ok(/^tmg_s=; .*Max-Age=0/.test(r.headers.get('set-cookie')), r.headers.get('set-cookie'));
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, c1)).body.reason, 'session_revoked');
    const c2 = C(await join(base, inv.key));
    const form = await fetch(base + '/api/session/logout', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, c2),
      body: '', redirect: 'manual', signal: AbortSignal.timeout(5000)
    });
    assert.deepStrictEqual([form.status, form.headers.get('location')], [303, '/']);
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, c2)).status, 401);
    // Cookie が無くても 200（何もしない）
    assert.strictEqual((await api(base, 'POST', '/api/session/logout')).status, 200);
  });
});

// ── 結合: 併存 ──
test('併存: Basic と Cookie の両方は運営。古い Basic と有効な Cookie は採点として通る', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '併存テスト');
    const cookie = await join(base, (await invite(base, ev)).key);
    const both = Object.assign({ Cookie: cookie }, B);
    assert.strictEqual((await api(base, 'GET', '/api/session', undefined, both)).body.role, 'admin');
    assert.strictEqual((await api(base, 'GET', '/api/invites', undefined, both)).status, 200);
    const stale = Object.assign({ Cookie: cookie }, basic(USER, 'old-password'));
    assert.strictEqual((await api(base, 'GET', '/api/session', undefined, stale)).body.role, 'scorer');
    assert.strictEqual((await api(base, 'PATCH', '/api/events/' + ev + '/players/pa1', { score: 3, baseRev: 0 }, stale)).status, 200);
    assert.strictEqual((await api(base, 'DELETE', '/api/events/' + ev, undefined, stale)).body.reason, 'role');
    assert.strictEqual((await get(base, '/admin.html', stale)).status, 403);
    assert.strictEqual((await api(base, 'DELETE', '/api/events/' + ev, undefined, both)).status, 200);
    // Basic だけ・何も無い の GET /api/session
    assert.deepStrictEqual((await api(base, 'GET', '/api/session', undefined, B)).body.via, 'basic');
    const anon = await api(base, 'GET', '/api/session');
    assert.deepStrictEqual([anon.status, anon.body.role, anon.body.reason], [200, 'none', 'auth_required']);
  });
  await withServer(NO_AUTH_DEV, async base => {
    const s = await api(base, 'GET', '/api/session');
    assert.deepStrictEqual([s.body.role, s.body.via], ['admin', 'dev']);
  });
});

// ── 結合: CSRF ──
test('CSRF: Cookie・Basic の書き込みに別サイトの Sec-Fetch-Site・Origin は 403、ヘッダーなしは通る', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, 'CSRF テスト');
    const cookie = await join(base, (await invite(base, ev)).key);
    const patch = h => api(base, 'PATCH', '/api/events/' + ev + '/players/pa1', { note: 'x' }, Object.assign({ Cookie: cookie }, h));
    for (const h of [{ 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'none' },
                     { Origin: 'https://evil.example' }, { Origin: 'null' }]) {
      const r = await patch(h);
      assert.deepStrictEqual([r.status, r.body.reason], [403, 'origin'], JSON.stringify(h));
    }
    assert.strictEqual((await patch({})).status, 200);
    assert.strictEqual((await patch({ 'Sec-Fetch-Site': 'same-origin', Origin: 'https://evil.example' })).status, 200);
    assert.strictEqual((await patch({ Origin: base.replace('127.0.0.1', '127.0.0.1') })).status, 200);
    // Basic も同じ。GET は見ない
    const r = await api(base, 'POST', '/api/events/' + ev + '/history', { action: 'x' }, Object.assign({ 'Sec-Fetch-Site': 'cross-site' }, B));
    assert.strictEqual(r.body.reason, 'origin');
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, Object.assign({ 'Sec-Fetch-Site': 'cross-site' }, B))).status, 200);
  });
});

// ── 結合: 非公開・閲覧 ──
test('非公開: 認証データと tools は Basic 付きでも 404。join は公開（無ければ 404）', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '非公開テスト');
    await invite(base, ev);
    for (const p of ['/server/data/auth/invites.json', '/%73erver/data/auth/sessions.json',
                     '/tools/mcp/phx-tameshigiri/server.mjs', '/server/data/auth/audit.jsonl']) {
      assert.strictEqual((await get(base, p, B)).status, 404, p);
    }
    // join.html はまだ無いことがある（画面の担当が作る）。あれば 200 と CSP、無ければ 404。401 にはしない
    const j = await get(base, '/join');
    assert.ok(j.status === 200 || j.status === 404, String(j.status));
    if (j.status === 200) {
      assert.ok((j.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"));
      assert.strictEqual(j.headers.get('referrer-policy'), 'no-referrer');
    }
  });
});

test('閲覧: 共有リンクは無認証で今どおり。共有トークンを Cookie や Bearer に入れても書けない', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '閲覧テスト');
    const token = (await api(base, 'POST', '/api/links', { targetType: 'event', targetId: ev }, B)).body.token;
    assert.ok(token);
    for (const p of ['/api/links/' + token, '/api/links/' + token + '/ranking', '/api/links/' + token + '/live']) {
      assert.strictEqual((await get(base, p)).status, 200, p);
    }
    const viaCookie = await api(base, 'PATCH', '/api/events/' + ev + '/players/pa1', { score: 1, baseRev: 0 }, C('tmg_s=' + token));
    assert.deepStrictEqual([viaCookie.status, viaCookie.body.reason], [401, 'session_revoked']);
    const viaBearer = await api(base, 'PATCH', '/api/events/' + ev + '/players/pa1', { score: 1, baseRev: 0 }, { Authorization: 'Bearer ' + token });
    assert.deepStrictEqual([viaBearer.status, viaBearer.body.reason], [401, 'key_invalid']);
    // 共有ページは無効な Cookie があっても公開のまま
    assert.strictEqual((await get(base, '/board.html', C('tmg_s=' + token))).status, 200);
  });
});

test('記録: 鍵の文字列はどのファイルにも残らない。監査ログに発行・登録・失敗', async () => {
  const dir = dataDir();
  let key;
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '記録テスト');
    key = (await invite(base, ev)).key;
    await join(base, key);
    await api(base, 'POST', '/api/join', { key: 'nope', confirm: true });
  }, dir);
  const secret = key.split('.')[1];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(dir)) {
    assert.ok(!fs.readFileSync(f, 'utf-8').includes(secret), f + ' に鍵の秘密がある');
  }
  const lines = fs.readFileSync(path.join(dir, 'auth', 'audit.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepStrictEqual(lines.map(l => l.action), ['invite.create', 'session.create', 'join.fail']);
  assert.strictEqual(lines[2].reason, 'key_invalid');
});

test('壊れた認証データでも起動し、.broken に退避して空から始める', async () => {
  const dir = dataDir();
  fs.mkdirSync(path.join(dir, 'auth'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'auth', 'invites.json'), '{ 壊れ');
  await withServer(AUTH_DEV, async base => {
    assert.deepStrictEqual((await api(base, 'GET', '/api/invites', undefined, B)).body, []);
  }, dir);
  assert.ok(fs.readdirSync(path.join(dir, 'auth')).some(f => f.startsWith('invites.json.broken-')));
});

test('開発・認証なし: 従来どおり全員運営（採点・発行もそのまま）', async () => {
  await withServer(NO_AUTH_DEV, async base => {
    const ev = await makeEvent(base, '認証なしテスト', {});
    const r = await api(base, 'PATCH', '/api/events/' + ev + '/players/pa1', { score: 2, result: '1' });
    assert.strictEqual(r.status, 200, '古い画面（baseRev なし）の採点も通る');
    assert.strictEqual((await get(base, '/admin.html')).status, 200);
    const inv = await api(base, 'POST', '/api/invites', { role: 'scorer', eventId: ev, court: 'A' });
    assert.strictEqual(inv.status, 201);
  });
});

// ── レビュー・結合試験の指摘（2026-10-03） ──
test('交換の速度制限（R2）: 照合が通らない失敗だけ数える。上限中も正しい鍵は通り、取り消し・期限切れは本来の理由', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '速度制限テスト');
    const good = await invite(base, ev, { maxDevices: 5 });
    const revoked = await invite(base, ev, { court: 'B', label: 'B' });
    assert.strictEqual((await api(base, 'POST', '/api/invites/' + revoked.invite.id + '/revoke', {}, B)).status, 200);
    // 正しい鍵の下見は 40 回でも止まらない（全体を数えない）
    for (let i = 0; i < 40; i++) {
      const r = await api(base, 'POST', '/api/join', { key: good.key, confirm: false });
      assert.strictEqual(r.status, 200, 'preview ' + (i + 1));
    }
    // 照合の通る取り消し済みの鍵も数えない
    for (let i = 0; i < 12; i++) {
      const r = await api(base, 'POST', '/api/join', { key: revoked.key, confirm: false });
      assert.deepStrictEqual([r.status, r.body.reason], [401, 'invite_revoked'], 'revoked ' + (i + 1));
    }
    // 鍵なし・違う鍵の連打で上限に達する
    for (let i = 0; i < 10; i++) {
      assert.strictEqual((await api(base, 'POST', '/api/join', { key: 'x' + i, confirm: false })).status, 401, 'bad ' + (i + 1));
    }
    const blocked = await api(base, 'POST', '/api/join', { key: 'x', confirm: true });
    assert.deepStrictEqual([blocked.status, blocked.body.reason], [429, 'rate_limited']);
    const t = cred.parseToken('invite', good.key);
    const wrongSecret = await api(base, 'POST', '/api/join', { key: t.id + '.' + 'A'.repeat(43), confirm: false });
    assert.strictEqual(wrongSecret.status, 429, '秘密が違う鍵は上限中は 429');
    // 上限中でも正しい鍵の下見・登録は通る
    assert.strictEqual((await api(base, 'POST', '/api/join', { key: good.key, confirm: false })).status, 200);
    const cookie = await join(base, good.key);
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, C(cookie))).status, 200);
    // 上限中でも、取り消し済みは本来の理由
    const rv = await api(base, 'POST', '/api/join', { key: revoked.key, confirm: true });
    assert.deepStrictEqual([rv.status, rv.body.reason], [401, 'invite_revoked']);
  });
});

test('交換の速度制限（R2）: 照合が通らない失敗は全体（全 IP の合計）でも 30 回/分。正しい鍵は止めない', async () => {
  await withServer(Object.assign({ TRUST_PROXY: 'loopback' }, AUTH_DEV), async base => {
    const ev = await makeEvent(base, '全体の上限テスト');
    const good = await invite(base, ev);
    const from = ip => ({ 'X-Forwarded-For': ip });
    for (let n = 0; n < 3; n++) {
      for (let i = 0; i < 10; i++) {
        const r = await api(base, 'POST', '/api/join', { key: 'bad' + i }, from('203.0.113.' + (n + 1)));
        assert.strictEqual(r.status, 401, 'ip ' + n + ' / ' + i);
      }
    }
    const other = await api(base, 'POST', '/api/join', { key: 'bad' }, from('198.51.100.9'));
    assert.deepStrictEqual([other.status, other.body.reason], [429, 'rate_limited'], '31 回目は別の IP でも 429');
    const ok = await api(base, 'POST', '/api/join', { key: good.key, confirm: false }, from('198.51.100.9'));
    assert.strictEqual(ok.status, 200, '正しい鍵は通る');
  });
});

test('乗り換え（R3）: 別の招待の QR で登録すると、前の招待のセッションを取り消す（switch）。上限で断ったら前はそのまま', async () => {
  const dir = dataDir();
  let invA;
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '乗り換えテスト');
    invA = await invite(base, ev, { court: 'A', label: 'A', maxDevices: 1 });
    const invB = await invite(base, ev, { court: 'B', label: 'B', maxDevices: 1 });
    const cA = await join(base, invA.key);
    const pre = await api(base, 'POST', '/api/join', { key: invB.key, confirm: false }, C(cA));
    assert.deepStrictEqual([pre.status, pre.body.rejoin, pre.body.switching], [200, false, true]);
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, C(cA))).status, 200, '下見では取り消さない');
    const cB = await join(base, invB.key, C(cA));
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, C(cA))).body.reason, 'session_revoked');
    assert.strictEqual((await api(base, 'GET', '/api/session', undefined, C(cB))).body.scope.court, 'B');
    // A の枠が空いた: 別の端末が A で登録できる
    await join(base, invA.key);
    const listed = (await api(base, 'GET', '/api/invites?eventId=' + ev, undefined, B)).body;
    const byId = id => listed.find(x => x.id === id);
    assert.deepStrictEqual([byId(invA.invite.id).activeDevices, byId(invB.invite.id).activeDevices], [1, 1]);
    // 上限で断ったときは前の登録（B）はそのまま
    const invC = await invite(base, ev, { court: 'A', label: 'C', maxDevices: 1 });
    await join(base, invC.key);
    const full = await api(base, 'POST', '/api/join', { key: invC.key, confirm: true }, C(cB));
    assert.deepStrictEqual([full.status, full.body.reason], [409, 'device_limit']);
    assert.strictEqual((await api(base, 'GET', '/api/events', undefined, C(cB))).status, 200);
  }, dir);
  const lines = fs.readFileSync(path.join(dir, 'auth', 'audit.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
  const sw = lines.filter(l => l.action === 'session.revoke' && l.reason === 'switch');
  assert.strictEqual(sw.length, 1);
  assert.strictEqual(sw[0].inviteId, invA.invite.id);
});

test('Cookie の期限（E1）: Max-Age は招待の期限 + 30 日。期限を過ぎた Cookie はサーバーが session_expired を返す', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, 'Cookie の期限テスト');
    const inv = await invite(base, ev);
    const r = await api(base, 'POST', '/api/join', { key: inv.key, confirm: true });
    const sc = r.headers.get('set-cookie');
    const maxAge = Number(/Max-Age=(\d+)/.exec(sc)[1]);
    const expected = (Date.parse(r.body.expiresAt) - Date.now()) / 1000 + 30 * 86400;
    assert.ok(Math.abs(maxAge - expected) < 30, 'Max-Age ' + maxAge + ' / 期待 ' + Math.round(expected));
    assert.ok(maxAge > (Date.parse(r.body.expiresAt) - Date.now()) / 1000 + 29 * 86400, '期限より十分長く残る');
  });
});

test('Basic の 401 の本文（R6）: ダイアログを閉じると採点端末向けに /join への案内が見える', async () => {
  await withServer(AUTH_DEV, async base => {
    for (const p of ['/scoring.html', '/', '/admin.html']) {
      const res = await get(base, p);
      assert.strictEqual(res.status, 401, p);
      assert.ok(res.headers.get('www-authenticate'), p + ' はダイアログを出す');
      assert.ok(/text\/html/.test(res.headers.get('content-type')), p);
      const html = await res.text();
      assert.ok(html.includes('運営から受け取った QR をもう一度読み取ってください'), p);
      assert.ok(html.includes('href="/join"'), p);
      assert.ok(!/<script/i.test(html), 'スクリプトなし');
    }
  });
});

test('履歴の clientId（E2）: 同じ clientId の履歴は二度積まない。形の違う clientId は印にしない', async () => {
  await withServer(AUTH_DEV, async base => {
    const ev = await makeEvent(base, '履歴の送り直しテスト');
    const cookie = await join(base, (await invite(base, ev)).key);
    const post = (body, h) => api(base, 'POST', '/api/events/' + ev + '/history', body, h);
    const first = await post({ action: 'confirm', playerName: '甲', detail: '確定', clientId: 'hTEST0001abc' }, C(cookie));
    assert.deepStrictEqual([first.status, first.body.duplicate], [200, undefined]);
    const again = await post({ action: 'confirm', playerName: '甲', detail: '確定', clientId: 'hTEST0001abc' }, C(cookie));
    assert.deepStrictEqual([again.status, again.body.duplicate], [200, true]);
    await post({ action: 'note', detail: '短い印', clientId: 'x' }, B);
    await post({ action: 'note', detail: '短い印', clientId: 'x' }, B);
    const entries = (await api(base, 'GET', '/api/events/' + ev + '/history', undefined, B)).body.entries;
    assert.strictEqual(entries.filter(e => e.clientId === 'hTEST0001abc').length, 1);
    assert.strictEqual(entries.find(e => e.clientId === 'hTEST0001abc').actor, '採点端末（A コート タブレット）');
    assert.strictEqual(entries.filter(e => e.detail === '短い印').length, 2);
    assert.ok(entries.every(e => e.clientId !== 'x'));
  });
});

main(() => DIRS.forEach(removeDataDir));
