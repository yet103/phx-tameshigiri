// 認可（ルートごとの判定表と、本文に依存する検査のヘルパー）。
// 設計書 docs/superpowers/specs/2026-10-03-invite-links-and-ai-key-design.md 5.2〜5.5。
//
// 2 段で判定する:
//   (a) 認証ミドルウェア（server/index.js。本文を読む前・同期）… matchRoute + authorize。
//       主体の役割と URL の大会 ID・コート（採点の「自」、AI の「砂」）を見る。
//   (b) 各ハンドラの中（書き換えの前）… 採点の PATCH の項目と行のコート、live の playerId、
//       AI の作成・改名の名前、POST /api/links の targetId。ここのヘルパーを
//       `const deny = …; if (deny) return sendDeny(res, deny);` の形で使う。
//
// 【表に無いものは運営以外すべて拒否（既定拒否）】新しい /api/ ルートを足したら ROUTES にも足す。
// 足し忘れは server/invite.test.js の「index.js の全ルートが表にある」で落ちる。
//
// 役割の値:
//   scorer: 'none' | 'any'（誰の鍵でも可）| 'list'（一覧。ハンドラが自分の大会に絞る）
//           | 'own'（URL の大会が鍵の大会）| 'own-court'（加えて URL のコートが鍵のコート）
//   ai:     'none' | 'read'（どの大会も可）| 'sandbox'（URL の大会が「テスト用」）
//           | 'sandbox-own'（加えて AI が作った大会。D11）| 'create'（ハンドラが新しい名前を検査）
//           | 'body'（ハンドラが本文の大会を検査）| 'self'（whoami）
//   admin:  false のときだけ運営も拒む（whoami）
//   public: true は無認証で可

const SANDBOX_PREFIX = 'テスト用';

const NONE = { scorer: 'none', ai: 'none' };

const ROUTES = [
  // 文字どおりの一致を先に置く（POST /api/events/import と /from-template。Express と同じ）
  { method: 'POST', pattern: '/api/events/import', roles: { scorer: 'none', ai: 'none' } },
  { method: 'POST', pattern: '/api/events/from-template', roles: { scorer: 'none', ai: 'create' } },

  { method: 'GET', pattern: '/api/events', roles: { scorer: 'list', ai: 'read' } },
  { method: 'POST', pattern: '/api/events', roles: { scorer: 'none', ai: 'create' } },
  { method: 'GET', pattern: '/api/events/:id', roles: { scorer: 'own', ai: 'read' } },
  { method: 'PATCH', pattern: '/api/events/:id', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'DELETE', pattern: '/api/events/:id', roles: { scorer: 'none', ai: 'sandbox-own' } },
  { method: 'POST', pattern: '/api/events/:id/copy', roles: { scorer: 'none', ai: 'create' } },
  { method: 'POST', pattern: '/api/events/:id/status', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'POST', pattern: '/api/events/:id/players', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'POST', pattern: '/api/events/:id/players/bulk', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'POST', pattern: '/api/events/:id/players/reorder', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'POST', pattern: '/api/events/:id/players/arrange', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'PATCH', pattern: '/api/events/:id/players/:playerId', roles: { scorer: 'own', ai: 'sandbox' } },
  { method: 'DELETE', pattern: '/api/events/:id/players/:playerId', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'POST', pattern: '/api/events/:id/import', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'GET', pattern: '/api/events/:id/export', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'GET', pattern: '/api/events/:id/techniques', roles: { scorer: 'own', ai: 'read' } },
  { method: 'PUT', pattern: '/api/events/:id/techniques', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'DELETE', pattern: '/api/events/:id/techniques', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'GET', pattern: '/api/events/:id/bundle', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'POST', pattern: '/api/events/:id/rounds/2/generate', roles: { scorer: 'none', ai: 'sandbox' } },
  { method: 'GET', pattern: '/api/events/:id/ranking', roles: { scorer: 'none', ai: 'read' } },   // D7
  { method: 'PUT', pattern: '/api/events/:id/live/:court', roles: { scorer: 'own-court', ai: 'sandbox' } },
  { method: 'GET', pattern: '/api/techniques', roles: { scorer: 'any', ai: 'read' } },
  { method: 'POST', pattern: '/api/techniques', roles: NONE },
  { method: 'DELETE', pattern: '/api/techniques', roles: NONE },
  { method: 'GET', pattern: '/api/events/:id/history', roles: { scorer: 'none', ai: 'read' } },
  { method: 'POST', pattern: '/api/events/:id/history', roles: { scorer: 'own', ai: 'sandbox' } },
  { method: 'POST', pattern: '/api/links', roles: { scorer: 'none', ai: 'body' } },
  { method: 'GET', pattern: '/api/links/:token', public: true },
  { method: 'GET', pattern: '/api/links/:token/ranking', public: true },
  { method: 'GET', pattern: '/api/links/:token/live', public: true },

  // 新しい API（5.1）
  { method: 'POST', pattern: '/api/join', public: true },
  { method: 'GET', pattern: '/api/session', public: true },
  { method: 'POST', pattern: '/api/session/logout', public: true },
  { method: 'GET', pattern: '/api/invites', roles: NONE },
  { method: 'POST', pattern: '/api/invites', roles: NONE },
  { method: 'POST', pattern: '/api/invites/:id/revoke', roles: NONE },
  { method: 'POST', pattern: '/api/sessions/:id/revoke', roles: NONE },
  { method: 'GET', pattern: '/api/ai-keys', roles: NONE },
  { method: 'POST', pattern: '/api/ai-keys', roles: NONE },
  { method: 'POST', pattern: '/api/ai-keys/:id/revoke', roles: NONE },
  { method: 'GET', pattern: '/api/ai/whoami', admin: false, roles: { scorer: 'none', ai: 'self' } }
];

// 照合用に前処理する（セグメントの配列。':' で始まるものは引数）
const COMPILED = ROUTES.map(r => Object.assign({}, r, {
  segments: r.pattern.split('/').slice(1),
  write: r.method !== 'GET'
}));

function decodeSegment(s) {
  try { return decodeURIComponent(s); } catch (e) { return null; }
}

// メソッドとパス → { route, params } か null（表に無い）。
// 文字どおりのセグメントは小文字にして比べ（認証の二重の守り。/API/ を素通りさせない）、
// 引数は元のパスから取ってデコードする（大会 ID は大文字を含みうる）。
// HEAD は GET として扱い、末尾のスラッシュ 1 つは無視する（Express と同じ）。
function matchRoute(method, urlPath) {
  const m = method === 'HEAD' ? 'GET' : String(method || '').toUpperCase();
  let p = String(urlPath || '');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const segs = p.split('/').slice(1);
  for (const r of COMPILED) {
    if (r.method !== m || r.segments.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const want = r.segments[i];
      if (want.startsWith(':')) {
        const v = decodeSegment(segs[i]);
        if (v === null || v === '') { ok = false; break; }
        params[want.slice(1)] = v;
      } else if (want !== segs[i].toLowerCase()) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: r, params: params };
  }
  return null;
}

// ── 砂場（5.4） ──
function isSandboxName(name) {
  return typeof name === 'string' && name.trim().startsWith(SANDBOX_PREFIX);
}
function isSandboxEvent(event) {
  return !!event && isSandboxName(event.name);
}

function deny(status, reason, error, extra) {
  return { status: status, body: Object.assign({ error: error, reason: reason }, extra || {}) };
}
const DENY_ROLE = () => deny(403, 'role', 'この操作は許可されていません');
const DENY_SCOPE = () => deny(403, 'scope', 'この端末の登録では操作できない大会・コートです');
const DENY_SANDBOX = () => deny(403, 'sandbox', 'AI が書き込めるのは名前が「テスト用」で始まる大会だけです');

// ctx.loadEvent が返す「大会ファイルはあるが読めない」の印（壊れた JSON など）。
// 名前で砂場か判定できないので、AI には 403 sandbox（無い大会の null とは分ける。null はハンドラの 404 に任せる）
const UNREADABLE = Object.freeze({ unreadable: true });

// 粗い認可（本文を読む前）。戻り値: null（通す）か { status, body }。
// matched: matchRoute の戻り値（null は表に無い）。
// ctx.loadEvent(id): 大会ファイルを同期で読む（無ければ null、あるが読めなければ UNREADABLE）。
function authorize(principal, matched, ctx) {
  const kind = principal && principal.kind;
  const route = matched && matched.route;
  if (route && route.public) return null;
  if (kind === 'admin') {
    if (route && route.admin === false) return DENY_ROLE();
    return null;   // 表に無いパスも運営は今どおり（ルートが無ければ 404）
  }
  if (kind !== 'scorer' && kind !== 'ai') {
    return deny(401, (principal && principal.reason) || 'auth_required', '認証が必要です');
  }
  if (!route) return DENY_ROLE();
  const params = matched.params;

  if (kind === 'scorer') {
    const rule = route.roles.scorer;
    if (rule === 'any' || rule === 'list') return null;
    if (rule === 'own' || rule === 'own-court') {
      if (params.id !== principal.eventId) return DENY_SCOPE();
      if (rule === 'own-court' && principal.court !== null && params.court !== principal.court) return DENY_SCOPE();
      return null;
    }
    return DENY_ROLE();
  }

  // AI
  const rule = route.roles.ai;
  if (rule === 'read' || rule === 'create' || rule === 'body' || rule === 'self') return null;
  if (rule === 'sandbox' || rule === 'sandbox-own') {
    const event = ctx && ctx.loadEvent ? ctx.loadEvent(params.id) : null;
    if (!event) return null;   // 大会が無ければハンドラの 404 に任せる
    if (event === UNREADABLE || event.unreadable === true) {
      return deny(403, 'sandbox', '大会ファイルが読めないため、AI からは操作できません');
    }
    if (!isSandboxEvent(event)) return DENY_SANDBOX();
    if (rule === 'sandbox-own' && event.createdBy !== 'ai') {
      return deny(403, 'sandbox', 'AI が削除できるのは AI が作った「テスト用」の大会だけです');
    }
    return null;
  }
  return DENY_ROLE();
}

// ── ハンドラの中の検査（5.3・5.4） ──

// 採点の鍵に許す PATCH の項目
const SCORER_PATCH_KEYS = ['score', 'result', 'adjust', 'totalAdjust', 'confirmed', 'note', 'baseRev'];
const SCORER_SCORE_KEYS = ['score', 'result', 'adjust', 'totalAdjust', 'confirmed'];

// 採点の PATCH。player の行のコートは courtOf で渡す（server/index.js の courtOf）。
function checkScorerPatch(principal, player, body, courtOf) {
  if (!principal || principal.kind !== 'scorer') return null;
  const bad = Object.keys(body || {}).filter(k => SCORER_PATCH_KEYS.indexOf(k) === -1);
  if (bad.length) {
    return deny(403, 'field', 'この端末の登録では変えられない項目です', { fields: bad });
  }
  const court = courtOf(player);
  if (court === '未分類' || (principal.court !== null && court !== principal.court)) return DENY_SCOPE();
  if (SCORER_SCORE_KEYS.some(k => body[k] !== undefined) && body.baseRev === undefined) {
    return deny(400, 'base_rev_required', 'baseRev が必要です');
  }
  return null;
}

// live の playerId（その行も鍵のコート）
function checkScorerLive(principal, player, courtOf) {
  if (!principal || principal.kind !== 'scorer' || !player) return null;
  const court = courtOf(player);
  if (court === '未分類' || (principal.court !== null && court !== principal.court)) return DENY_SCOPE();
  return null;
}

// AI の作成（新しい名前が「テスト用」）
function checkAiCreateName(principal, name) {
  if (!principal || principal.kind !== 'ai') return null;
  if (!isSandboxName(name)) return DENY_SANDBOX();
  return null;
}

// AI の改名（送られた新しい名前も「テスト用」。T14）
function checkAiRename(principal, body) {
  if (!principal || principal.kind !== 'ai') return null;
  if (body && body.name !== undefined && !isSandboxName(body.name)) return DENY_SANDBOX();
  return null;
}

// AI が本文で大会を指すルート（POST /api/links の targetId）
function checkAiBodyEvent(principal, event) {
  if (!principal || principal.kind !== 'ai' || !event) return null;
  if (!isSandboxEvent(event)) return DENY_SANDBOX();
  return null;
}

function sendDeny(res, d) {
  res.status(d.status).json(d.body);
}

// 履歴の actor（5.6）
function actorLabel(principal) {
  if (!principal) return '運営';
  if (principal.kind === 'scorer') return '採点端末（' + (principal.label || '') + '）';
  if (principal.kind === 'ai') return 'AI（' + (principal.label || '') + '）';
  return '運営';
}

// 大会を新しく作るルート（AI の作成。応答の id が新しい大会）
const ROUTES_CREATE = new Set(['/api/events', '/api/events/from-template', '/api/events/:id/copy']);

module.exports = {
  ROUTES, ROUTES_CREATE, SANDBOX_PREFIX, UNREADABLE,
  matchRoute, authorize,
  isSandboxName, isSandboxEvent,
  checkScorerPatch, checkScorerLive, checkAiCreateName, checkAiRename, checkAiBodyEvent,
  sendDeny, actorLabel,
  SCORER_PATCH_KEYS
};
