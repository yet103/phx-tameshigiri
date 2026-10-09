// 認証。Basic（運営）・セッション Cookie（採点の鍵で登録した端末）・Bearer（AI 用キー）。
// 設計書 docs/superpowers/specs/2026-10-03-invite-links-and-ai-key-design.md 3 章。
//
// Basic の資格情報は環境変数 AUTH_USER / AUTH_PASS（server/index.js が渡す）。
// 運営用 HTML を保護してブラウザにダイアログを出させ、以降の fetch にはブラウザが
// 自動で Authorization を付ける。API の 401 には WWW-Authenticate を付けず、
// 共有ページを見ている観客の画面にダイアログが出ないようにする。
//
// すべて同期（本文を読む前のミドルウェアから呼ぶ。server/index.js の不変条件）。
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

// Authorization: Bearer <値> → 値（空文字もありうる）。Bearer でなければ null。
function parseBearer(header) {
  if (typeof header !== 'string') return null;
  const m = /^Bearer(?:\s+(.*))?$/i.exec(header.trim());
  if (!m) return null;
  return (m[1] || '').trim();
}

// 無認証で通す API。
//   共有リンク越しの読み出し（大会 ID は伏せられている）… GET/HEAD の 4 本
//   招待の交換・自分のセッションの確認と解除 … POST /api/join、GET/HEAD /api/session、POST /api/session/logout
const PUBLIC_LINK_API = /^\/api\/links\/[^/]+(\/ranking|\/live|\/watch)?$/;
function isPublicApi(method, urlPath) {
  const get = method === 'GET' || method === 'HEAD';
  if (get && PUBLIC_LINK_API.test(urlPath)) return true;
  if (get && urlPath === '/api/session') return true;
  if (method === 'POST' && (urlPath === '/api/join' || urlPath === '/api/session/logout')) return true;
  return false;
}

function createAuth(opts) {
  const user = (opts && opts.user) || '';
  const pass = (opts && opts.pass) || '';
  const enabled = user !== '' && pass !== '';

  // Basic が正しいか（認証が無効なら常に真。今の互換）
  function isAuthorized(req) {
    if (!enabled) return true;
    return hasValidBasic(req);
  }

  // Basic のヘッダーがあって正しいか（認証が無効なら偽）
  function hasValidBasic(req) {
    if (!enabled) return false;
    const c = parseBasic(req.headers.authorization);
    if (!c) return false;
    // && で短絡させず両方比較する（ユーザー名の正否が応答時間に出ないように）
    const u = safeEqual(c.user, user);
    const p = safeEqual(c.pass, pass);
    return u && p;
  }

  // ページ向け 401: ブラウザにダイアログを出させる。本文はダイアログを閉じたときに見える。
  // 採点端末（Cookie が消えた・ホーム画面のアプリで Cookie が別）が戻れるよう /join への案内を置く。
  function rejectPage(res) {
    res.set('WWW-Authenticate', 'Basic realm="phx-tameshigiri", charset="UTF-8"');
    res.set('Cache-Control', 'no-store');
    res.status(401).type('html').send(pageShell('認証が必要です',
      '<h1>認証が必要です</h1>' +
      '<p>運営の方は、運営の ID・パスワードを入れてください（ページを再読み込みすると、もう一度聞かれます）。</p>' +
      '<p>採点端末の方は、運営から受け取った QR をもう一度読み取ってください。' +
      'QR の URL を貼り付けて登録することもできます（<a href="/join">/join</a>）。</p>' +
      '<p><a class="btn" href="/join">QR の URL を貼り付けて登録する</a></p>'));
  }

  // API 向け 401: WWW-Authenticate を付けない（観客の画面にダイアログを出さない）
  function rejectApi(res, reason) {
    res.status(401).json({ error: '認証が必要です', reason: reason || 'auth_required' });
  }

  return { enabled, isAuthorized, hasValidBasic, rejectPage, rejectApi };
}

// ── Cookie（3.3）。依存を増やさず自前で読み書きする ──
const COOKIE_NAME_PROD = '__Host-tmg_s';
const COOKIE_NAME_DEV = 'tmg_s';

function sessionCookieName(production) {
  return production ? COOKIE_NAME_PROD : COOKIE_NAME_DEV;
}

// Cookie ヘッダ → [{ name, value }]（同名の重複もそのまま並べる）。
// '; ' で分け、最初の '=' で名前と値に分ける。'=' の無い断片は捨てる。
function parseCookies(header) {
  if (typeof header !== 'string' || header === '') return [];
  const out = [];
  header.split(';').forEach(part => {
    const s = part.trim();
    const i = s.indexOf('=');
    if (i <= 0) return;
    let value = s.slice(i + 1).trim();
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') value = value.slice(1, -1);
    out.push({ name: s.slice(0, i).trim(), value: value });
  });
  return out;
}

// Set-Cookie の値。maxAgeSec が 0 なら消す。
function buildSessionCookie(name, value, maxAgeSec, secure) {
  return name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.max(0, Math.ceil(maxAgeSec)) +
    (secure ? '; Secure' : '');
}

// ── 主体の解決（3.2） ──
// deps: { auth, credentials, cookieName }
// 戻り値の kind: 'admin' | 'scorer' | 'ai' | 'anonymous'
//   admin     … { via: 'basic' | 'dev' }
//   scorer    … { via: 'session', inviteId, sessionId, eventId, court, label, expiresAt, session, invite }
//   ai        … { via: 'bearer', keyId, label, expiresAt, key }
//   anonymous … { reason, bearer?: true（Bearer の誤り。401 で止める） }
function resolvePrincipal(req, deps) {
  const { auth, credentials, cookieName } = deps;
  const header = req.headers.authorization;

  // 1. 正しい Basic → 運営。誤っていたら無視して次へ（古い Basic を送り続ける端末を Cookie で通す）
  if (auth.hasValidBasic(req)) return { kind: 'admin', via: 'basic' };

  // 2. Bearer → AI 用キー。誤り・期限切れ・取り消しは 401 で止める（Cookie に落とさない）
  const bearer = parseBearer(header);
  if (bearer !== null) {
    const r = credentials.verifyAiKey(bearer);
    if (!r.ok) return { kind: 'anonymous', reason: r.reason, bearer: true };
    return { kind: 'ai', via: 'bearer', keyId: r.key.id, label: r.key.label, expiresAt: r.key.expiresAt, key: r.key };
  }

  // 3・4. セッション Cookie。同名が複数あればすべて試して最初に有効なもの
  const cookies = parseCookies(req.headers.cookie).filter(c => c.name === cookieName);
  if (cookies.length) {
    let firstFail = null;
    for (const c of cookies) {
      const r = credentials.verifySessionCookie(c.value);
      if (r.ok) {
        return {
          kind: 'scorer', via: 'session',
          inviteId: r.invite.id, sessionId: r.session.id,
          eventId: r.invite.eventId, court: r.invite.court === undefined ? null : r.invite.court,
          label: r.invite.label, expiresAt: r.invite.expiresAt,
          session: r.session, invite: r.invite
        };
      }
      if (!firstFail) firstFail = r;
    }
    // 開発の認証なしでも運営にしない（期限切れの振る舞いを開発で試せるように）
    return { kind: 'anonymous', reason: firstFail.reason, cookie: true };
  }

  // 5. 認証が無効（開発・AUTH_USER 未設定）→ 運営（今の互換）
  if (!auth.enabled) return { kind: 'admin', via: 'dev' };

  // 6.
  return { kind: 'anonymous', reason: 'auth_required' };
}

// ── CSRF（3.4） ──
// Cookie・Basic・開発の運営で認証された /api/ の GET/HEAD 以外に、同じオリジンからの要求であることを求める。
// AI（Bearer）はブラウザが自動で付けないヘッダーなので見ない。戻り値: true（拒む）/ false（通す）。
// opts: { publicOrigin（PUBLIC_ORIGIN。例 https://tameshigiri.phx-base.org）, production }
//   1. Sec-Fetch-Site があれば same-origin 以外を拒む（same-site・cross-site・none）
//   2. 無ければ Origin を PUBLIC_ORIGIN と比べる。PUBLIC_ORIGIN が未設定なら、開発は http:// + Host と比べ、
//      本番は比べない（起動時に警告を出している。1 だけで判定する）
//   3. どちらも無い（curl・予行スクリプト・古いブラウザ）は通す
function isCrossOrigin(req, principal, opts) {
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  if (!principal || (principal.kind !== 'scorer' && principal.kind !== 'admin')) return false;
  const sfs = req.headers['sec-fetch-site'];
  if (typeof sfs === 'string' && sfs !== '') return sfs !== 'same-origin';
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    const publicOrigin = opts && opts.publicOrigin;
    if (publicOrigin) return origin !== publicOrigin;
    if (opts && opts.production) return false;
    return origin !== 'http://' + (req.headers.host || '');
  }
  return false;
}

// ── 速度制限（3.6）。メモリ上の固定窓。窓は最初の 1 回から数える（再起動で消えてよい） ──
function createRateLimiter(opts) {
  const now = (opts && opts.now) || (() => Date.now());
  const windows = new Map();   // key -> { start, count, windowMs, blockedUntil }

  function entry(key, windowMs) {
    const t = now();
    let e = windows.get(key);
    if (!e || t - e.start >= e.windowMs) {
      e = { start: t, count: 0, windowMs: windowMs, blockedUntil: e && e.blockedUntil > t ? e.blockedUntil : 0 };
      windows.set(key, e);
    }
    return e;
  }

  // 上限に達しているか（数えない）。戻り値: 0（まだ）か 残り秒
  function check(key, limit, windowMs) {
    const t = now();
    const e = entry(key, windowMs);
    if (e.blockedUntil > t) return Math.max(1, Math.ceil((e.blockedUntil - t) / 1000));
    if (e.count >= limit) return Math.max(1, Math.ceil((e.start + e.windowMs - t) / 1000));
    return 0;
  }

  // 1 回数える
  function hit(key, windowMs) {
    entry(key, windowMs).count++;
  }

  // 数えて、上限に達したら blockMs のあいだ止める（失敗の回数制限）
  function hitAndBlock(key, limit, windowMs, blockMs) {
    const e = entry(key, windowMs);
    e.count++;
    if (e.count >= limit) e.blockedUntil = now() + blockMs;
  }

  function remaining(key, limit) {
    const e = windows.get(key);
    if (!e || now() - e.start >= e.windowMs) return limit;
    return Math.max(0, limit - e.count);
  }

  // 古い窓の掃除（1 分ごとに呼ぶ）
  function sweep() {
    const t = now();
    for (const [k, e] of windows) {
      if (t - e.start >= e.windowMs && !(e.blockedUntil > t)) windows.delete(k);
    }
  }

  return { check, hit, hitAndBlock, remaining, sweep };
}

// ── 保護ページの 401 / 403 の HTML（6.5）。スクリプトなし・WWW-Authenticate なし ──
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function pageShell(title, body) {
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title>' +
    '<style>body{font-family:sans-serif;max-width:36em;margin:2em auto;padding:0 16px;line-height:1.7;color:#222;background:#fff}' +
    'a.btn,button{display:inline-block;margin:.4em 0;padding:.6em 1.2em;font-size:1em;border:1px solid #888;border-radius:6px;background:#f4f4f4;color:#222;text-decoration:none;cursor:pointer}' +
    '@media (prefers-color-scheme: dark){body{background:#1b1b1b;color:#eee}a.btn,button{background:#333;color:#eee}}</style>' +
    '</head><body>' + body + '</body></html>';
}

const LOGOUT_FORM = '<form method="post" action="/api/session/logout">' +
  '<button type="submit">この端末の登録を解除する</button></form>' +
  '<p style="font-size:.9em">解除すると、次に開いたとき運営の ID・パスワードを聞かれます。</p>';

function sendScorerForbiddenPage(res, principal) {
  const scope = principal.court === null ? '全コート' : (principal.court + ' コート');
  res.set('Cache-Control', 'no-store');
  res.status(403).type('html').send(pageShell('採点専用の端末です',
    '<h1>採点専用の端末です</h1>' +
    '<p>この端末は <strong>' + escapeHtml(scope) + ' の採点専用</strong> です。運営画面は運営の端末で開いてください。</p>' +
    '<p><a class="btn" href="/scoring.html">採点画面へ</a></p>' + LOGOUT_FORM));
}

function sendSessionInvalidPage(res, reason) {
  const what = reason === 'session_expired' ? '期限切れ' : '取り消し済み';
  res.set('Cache-Control', 'no-store');
  res.status(401).type('html').send(pageShell('採点の登録が切れました',
    '<h1>採点の登録が切れました</h1>' +
    '<p>この端末の採点の登録は <strong>' + what + '</strong> です。運営に新しい QR をもらって読み取ってください。' +
    '未送信の採点はこの端末に残っています。</p>' +
    '<p><a class="btn" href="/join">QR の URL を貼り付けて登録する</a></p>' + LOGOUT_FORM));
}

module.exports = {
  parseBasic, parseBearer, isPublicApi, createAuth,
  sessionCookieName, parseCookies, buildSessionCookie,
  resolvePrincipal, isCrossOrigin, createRateLimiter,
  sendScorerForbiddenPage, sendSessionInvalidPage, escapeHtml
};
