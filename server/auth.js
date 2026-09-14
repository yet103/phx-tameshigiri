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
