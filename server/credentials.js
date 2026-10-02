// 招待（採点の鍵）・セッション（端末の Cookie）・AI 用キーのストアと監査ログ。
// 設計書 docs/superpowers/specs/2026-10-03-invite-links-and-ai-key-design.md 4 章。
//
// 置き場所は <データ>/auth/ の invites.json / sessions.json / ai-keys.json / audit.jsonl。
// 3 つの JSON は起動時にメモリへ読み込み、以後メモリを正とし、変更のたびに丸ごと書く
// （件数は数十件の想定）。壊れたファイルは起動を止めず、.broken-<時刻> に名前を変えて空から始める。
//
// 【不変条件】すべて同期の fs とメモリだけで書く（await を挟まない）。採点の PATCH などの
// 書き込み系ハンドラが同期で read-modify-write している前提（server/index.js の不変条件）を壊さない。
// サーバーは 1 プロセス（コンテナ 1 つ）の前提。複数プロセスにするならこのストアは作り直しが要る。
//
// 鍵・セッションの秘密・AI キーはどこにも保存しない（SHA-256 のハッシュだけ）。
// 秘密は 256 ビットの乱数なので遅いハッシュ（bcrypt / scrypt）は使わない（設計書 4.2）。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AI_PREFIX = 'phxai';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const JST_OFFSET = 9 * 60 * MINUTE;

const INVITE_MIN_MS = 10 * MINUTE;      // 運営が指定する期限の下限（今 + 10 分）
const INVITE_MAX_MS = 7 * DAY;          // 上限（今 + 7 日。D1）
const AI_KEY_DEFAULT_DAYS = 30;         // D10
const AI_KEY_MAX_DAYS = 90;
const DEFAULT_MAX_DEVICES = 2;          // D2
const MAX_DEVICES_LIMIT = 5;
const LABEL_MAX = 40;
const SESSION_TOUCH_MS = 5 * MINUTE;    // lastSeenAt をファイルに書く間隔
const AI_USE_FLUSH_MS = MINUTE;         // lastUsedAt / useCount をファイルに書く間隔
const KEEP_INVITE_MS = 30 * DAY;        // 取り消し・期限切れから掃除までの日数
const KEEP_AI_KEY_MS = 90 * DAY;
const AUDIT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_AI_LIMITS = { perMinute: 60, writesPerMinute: 30, perDay: 2000 };   // D9
const AI_LIMIT_MAX = { perMinute: 600, writesPerMinute: 300, perDay: 20000 };

// ── 鍵の書式（4.1） ──
function randomId() { return crypto.randomBytes(9).toString('base64url'); }        // 12 文字
function randomSecret() { return crypto.randomBytes(32).toString('base64url'); }   // 43 文字

// 'invite' / 'session' は <id>.<secret>、'ai' は phxai.<id>.<secret>。
// 形が違えば null（照合せずに無効）。
function parseToken(kind, s) {
  if (typeof s !== 'string' || s.length > 200) return null;
  const parts = s.split('.');
  if (kind === 'ai') {
    if (parts.length !== 3 || parts[0] !== AI_PREFIX) return null;
    parts.shift();
  } else if (parts.length !== 2) {
    return null;
  }
  const [id, secret] = parts;
  if (!ID_PATTERN.test(id) || !SECRET_PATTERN.test(secret)) return null;
  return { id, secret };
}

function formatToken(kind, id, secret) {
  return (kind === 'ai' ? AI_PREFIX + '.' : '') + id + '.' + secret;
}

function sha256(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest(); }
function hashSecret(secret) { return 'sha256:' + sha256(secret).toString('hex'); }

// 保存した secretHash と照合する。形の違う保存値は常に偽。
function verifySecret(secret, stored) {
  if (typeof stored !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(stored)) return false;
  return crypto.timingSafeEqual(sha256(secret), Buffer.from(stored.slice(7), 'hex'));
}

// ── 期限（4.7）。コンテナの TZ に依存しないよう日本時間 +09:00 で固定計算する ──
// 'YYYY-MM-DD' → その日の日本時間 23:59:59.999 の Date。形が違えば null。
function endOfDayJst(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(dateStr + 'T23:59:59.999+09:00');
  return isNaN(d.getTime()) ? null : d;
}

// ミリ秒の時刻 → 日本時間の 'YYYY-MM-DD'
function jstDateOf(ms) {
  return new Date(ms + JST_OFFSET).toISOString().slice(0, 10);
}

// 日本時間の日付に n 日足した日の終わり
function endOfJstDayPlus(ms, days) {
  return endOfDayJst(jstDateOf(ms + days * DAY));
}

// 採点の招待の既定の期限: 大会の日の終わりが未来ならそれ、それ以外は発行した日の終わり。
function defaultInviteExpiry(eventDate, nowMs) {
  const d = endOfDayJst(eventDate);
  if (d && d.getTime() > nowMs) return d;
  return endOfDayJst(jstDateOf(nowMs));
}

// 運営が選ぶ期限の型（画面は端末の時計で日付を計算しない。T7）。
//   'event' … 既定（defaultInviteExpiry）、'today' … 今日の終わり、'tomorrow' … 明日の終わり
function inviteExpiryFromPreset(preset, eventDate, nowMs) {
  if (preset === 'today') return endOfJstDayPlus(nowMs, 0);
  if (preset === 'tomorrow') return endOfJstDayPlus(nowMs, 1);
  if (preset === 'event' || preset === undefined || preset === null) return defaultInviteExpiry(eventDate, nowMs);
  return null;
}

// 指定された期限（ISO 文字列）を検査する。妥当なら Date、範囲外・形違いは null。
function parseExpiry(value, nowMs, minMs, maxMs) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  if (t < nowMs + minMs || t > nowMs + maxMs) return null;
  return new Date(t);
}

// ── 端末の要約（4.4） ──
function summarizeUa(ua) {
  const s = typeof ua === 'string' ? ua : '';
  let device = '';
  if (/iPad/.test(s)) device = 'iPad';
  else if (/iPhone/.test(s)) device = 'iPhone';
  else if (/Android/.test(s)) device = 'Android';
  else if (/Windows/.test(s)) device = 'Windows';
  else if (/Macintosh|Mac OS X/.test(s)) device = 'Mac';
  let browser = '';
  if (/Edg(A|iOS)?\//.test(s)) browser = 'Edge';
  else if (/Firefox\/|FxiOS\//.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';
  if (!device && !browser) return '不明な端末';
  return [device, browser].filter(Boolean).join('・');
}

function cleanLabel(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// AI キーの回数上限を検査する。省略した項目は既定。範囲外・整数でなければ null。
function normalizeAiLimits(input) {
  const out = Object.assign({}, DEFAULT_AI_LIMITS);
  if (input === undefined || input === null) return out;
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  for (const k of Object.keys(DEFAULT_AI_LIMITS)) {
    if (input[k] === undefined) continue;
    const v = input[k];
    if (!Number.isInteger(v) || v < 1 || v > AI_LIMIT_MAX[k]) return null;
    out[k] = v;
  }
  return out;
}

// ── ストア ──
// opts: { dir: <データ>/auth, now?: () => ミリ秒, eventExists?: id => boolean }
function createCredentials(opts) {
  const dir = opts.dir;
  const now = opts.now || (() => Date.now());
  const eventExists = opts.eventExists || (() => true);
  fs.mkdirSync(dir, { recursive: true });

  const files = {
    invites: path.join(dir, 'invites.json'),
    sessions: path.join(dir, 'sessions.json'),
    aiKeys: path.join(dir, 'ai-keys.json'),
    audit: path.join(dir, 'audit.jsonl')
  };

  function load(file, listKey) {
    if (!fs.existsSync(file)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!data || !Array.isArray(data[listKey])) throw new Error(listKey + ' が配列ではありません');
      return data[listKey].filter(x => x && typeof x === 'object' && ID_PATTERN.test(x.id));
    } catch (e) {
      const broken = file + '.broken-' + new Date(now()).toISOString().replace(/[:.]/g, '-');
      try { fs.renameSync(file, broken); } catch (e2) { /* 名前を変えられなくても起動は止めない */ }
      console.error('認証データを読めません（空から始めます）: ' + path.basename(file) + ': ' + e.message);
      return [];
    }
  }

  function writeAtomic(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  let invites = load(files.invites, 'invites');
  let sessions = load(files.sessions, 'sessions');
  let aiKeys = load(files.aiKeys, 'keys');

  function saveInvites() { writeAtomic(files.invites, { version: 1, invites: invites }); }
  function saveSessions() { writeAtomic(files.sessions, { version: 1, sessions: sessions }); }
  function saveAiKeys() { writeAtomic(files.aiKeys, { version: 1, keys: aiKeys }); }

  // ファイルに最後に書いた時刻（lastSeenAt / lastUsedAt の間引き用）。ファイルには出さない。
  const persistedAt = new Map();

  const isoNow = () => new Date(now()).toISOString();
  const ms = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };

  // ── 監査ログ（4.6）。鍵・キー・Cookie の値は書かない ──
  function audit(entry) {
    try {
      try {
        if (fs.statSync(files.audit).size > AUDIT_MAX_BYTES) {
          fs.renameSync(files.audit, path.join(dir, 'audit.1.jsonl'));   // 1 世代だけ残す
        }
      } catch (e) { /* まだ無い */ }
      fs.appendFileSync(files.audit, JSON.stringify(Object.assign({ at: isoNow() }, entry)) + '\n');
    } catch (e) {
      console.error('監査ログを書けません: ' + e.message);
    }
  }

  // ── 招待 ──
  function getInvite(id) { return invites.find(i => i.id === id) || null; }

  function inviteStatus(inv) {
    if (inv.revokedAt) return 'revoked';
    if (now() >= ms(inv.expiresAt)) return 'expired';
    return 'active';
  }

  function sessionStatus(s, inv) {
    if (s.revokedAt) return 'revoked';
    if (inv && inv.revokedAt) return 'revoked';
    if (now() >= ms(s.expiresAt) || (inv && now() >= ms(inv.expiresAt))) return 'expired';
    return 'active';
  }

  function sessionsOfInvite(inviteId) { return sessions.filter(s => s.inviteId === inviteId); }

  function activeSessionCount(inviteId) {
    const inv = getInvite(inviteId);
    return sessionsOfInvite(inviteId).filter(s => sessionStatus(s, inv) === 'active').length;
  }

  // 一覧の形（secretHash は返さない）
  function inviteView(inv, eventName) {
    return {
      id: inv.id,
      role: inv.role,
      eventId: inv.eventId,
      eventName: eventName === undefined ? null : eventName,
      court: inv.court,
      label: inv.label,
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
      maxDevices: inv.maxDevices,
      status: inviteStatus(inv),
      revokedAt: inv.revokedAt || null,
      revokedReason: inv.revokedReason || null,
      lastJoinAt: inv.lastJoinAt || null,
      activeDevices: activeSessionCount(inv.id),
      devices: sessionsOfInvite(inv.id).map(s => ({
        id: s.id,
        summary: (s.device && s.device.summary) || '不明な端末',
        ua: (s.device && s.device.ua) || '',
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt || null,
        revokedAt: s.revokedAt || null,
        status: sessionStatus(s, inv)
      }))
    };
  }

  function createInvite(fields) {
    const id = randomId();
    const secret = randomSecret();
    const inv = {
      id: id,
      role: fields.role,
      eventId: fields.eventId,
      court: fields.court === undefined ? null : fields.court,
      label: fields.label,
      secretHash: hashSecret(secret),
      createdAt: isoNow(),
      expiresAt: fields.expiresAt,
      maxDevices: fields.maxDevices,
      revokedAt: null,
      revokedReason: null,
      lastJoinAt: null
    };
    invites.push(inv);
    saveInvites();
    return { invite: inv, key: formatToken('invite', id, secret) };
  }

  // 鍵 → 招待。失敗の reason は key_invalid / invite_revoked / invite_expired（5.1）。
  function checkInviteKey(key) {
    const t = parseToken('invite', key);
    if (!t) return { ok: false, reason: 'key_invalid' };
    const inv = getInvite(t.id);
    if (!inv || !verifySecret(t.secret, inv.secretHash)) return { ok: false, reason: 'key_invalid' };
    if (inv.revokedAt) return { ok: false, reason: 'invite_revoked', invite: inv };
    if (!eventExists(inv.eventId)) return { ok: false, reason: 'invite_revoked', invite: inv };
    if (now() >= ms(inv.expiresAt)) return { ok: false, reason: 'invite_expired', invite: inv };
    return { ok: true, invite: inv };
  }

  function revokeInvite(id, reason) {
    const inv = getInvite(id);
    if (!inv) return null;
    const active = activeSessionCount(id);
    if (!inv.revokedAt) {
      inv.revokedAt = isoNow();
      inv.revokedReason = reason || 'manual';
      saveInvites();
      return { invite: inv, revokedSessions: active };
    }
    return { invite: inv, revokedSessions: 0 };
  }

  // 大会の削除で、その大会の招待を event_deleted で取り消す。戻り値: 取り消した数
  function revokeInvitesForEvent(eventId) {
    let n = 0;
    invites.forEach(inv => {
      if (inv.eventId === eventId && !inv.revokedAt) {
        inv.revokedAt = isoNow();
        inv.revokedReason = 'event_deleted';
        n++;
      }
    });
    if (n) saveInvites();
    return n;
  }

  // ── セッション ──
  function createSession(invite, ua) {
    const id = randomId();
    const secret = randomSecret();
    const uaText = typeof ua === 'string' ? ua.slice(0, 200) : '';
    const t = isoNow();
    const s = {
      id: id,
      inviteId: invite.id,
      secretHash: hashSecret(secret),
      createdAt: t,
      expiresAt: invite.expiresAt,
      lastSeenAt: t,
      revokedAt: null,
      device: { ua: uaText, summary: summarizeUa(uaText) }
    };
    sessions.push(s);
    invite.lastJoinAt = t;
    saveSessions();
    saveInvites();
    persistedAt.set('s:' + id, now());
    return { session: s, cookieValue: formatToken('session', id, secret) };
  }

  // Cookie の値 → { ok, session, invite } か { ok: false, reason, session? }。
  // reason は session_revoked / invite_revoked / session_expired（3.1）。
  // 役割・大会・コートはセッションに写さず、毎回招待から引く（4.4）。
  function verifySessionCookie(value) {
    const t = parseToken('session', value);
    if (!t) return { ok: false, reason: 'session_revoked' };
    const s = sessions.find(x => x.id === t.id);
    if (!s || !verifySecret(t.secret, s.secretHash)) return { ok: false, reason: 'session_revoked' };
    const inv = getInvite(s.inviteId);
    if (s.revokedAt) return { ok: false, reason: 'session_revoked', session: s };
    if (!inv || inv.revokedAt || !eventExists(inv.eventId)) return { ok: false, reason: 'invite_revoked', session: s };
    if (now() >= ms(s.expiresAt) || now() >= ms(inv.expiresAt)) return { ok: false, reason: 'session_expired', session: s };
    return { ok: true, session: s, invite: inv };
  }

  // 最後の通信。メモリは毎回、ファイルは 5 分に 1 回まで。
  function touchSession(s) {
    s.lastSeenAt = isoNow();
    const last = persistedAt.get('s:' + s.id);
    if (last === undefined || now() - last >= SESSION_TOUCH_MS) {
      persistedAt.set('s:' + s.id, now());
      saveSessions();
    }
  }

  function getSession(id) { return sessions.find(s => s.id === id) || null; }

  function revokeSession(id) {
    const s = getSession(id);
    if (!s) return null;
    if (!s.revokedAt) {
      s.revokedAt = isoNow();
      saveSessions();
    }
    return s;
  }

  // ── AI キー ──
  function aiKeyStatus(k) {
    if (k.revokedAt) return 'revoked';
    if (now() >= ms(k.expiresAt)) return 'expired';
    return 'active';
  }

  function aiKeyView(k) {
    return {
      id: k.id,
      label: k.label,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt || null,
      status: aiKeyStatus(k),
      limits: Object.assign({}, k.limits),
      lastUsedAt: k.lastUsedAt || null,
      useCount: k.useCount || 0
    };
  }

  function createAiKey(fields) {
    const id = randomId();
    const secret = randomSecret();
    const k = {
      id: id,
      label: fields.label,
      secretHash: hashSecret(secret),
      createdAt: isoNow(),
      expiresAt: fields.expiresAt,
      revokedAt: null,
      limits: fields.limits,
      lastUsedAt: null,
      useCount: 0
    };
    aiKeys.push(k);
    saveAiKeys();
    return { aiKey: k, key: formatToken('ai', id, secret) };
  }

  function getAiKey(id) { return aiKeys.find(k => k.id === id) || null; }

  // Bearer の値 → { ok, key } か { ok: false, reason: key_invalid / key_expired / key_revoked }
  function verifyAiKey(token) {
    const t = parseToken('ai', token);
    if (!t) return { ok: false, reason: 'key_invalid' };
    const k = getAiKey(t.id);
    if (!k || !verifySecret(t.secret, k.secretHash)) return { ok: false, reason: 'key_invalid' };
    if (k.revokedAt) return { ok: false, reason: 'key_revoked', key: k };
    if (now() >= ms(k.expiresAt)) return { ok: false, reason: 'key_expired', key: k };
    return { ok: true, key: k };
  }

  function revokeAiKey(id) {
    const k = getAiKey(id);
    if (!k) return null;
    if (!k.revokedAt) {
      k.revokedAt = isoNow();
      saveAiKeys();
    }
    return k;
  }

  // 使用の記録。メモリは毎回、ファイルは 1 分に 1 回まで。
  function recordAiUse(k) {
    k.lastUsedAt = isoNow();
    k.useCount = (k.useCount || 0) + 1;
    const last = persistedAt.get('k:' + k.id);
    if (last === undefined || now() - last >= AI_USE_FLUSH_MS) {
      persistedAt.set('k:' + k.id, now());
      saveAiKeys();
    }
  }

  // ── 掃除（4.8） ──
  function cleanup() {
    const t = now();
    const doneAt = x => Math.min(x.revokedAt ? ms(x.revokedAt) : Infinity, ms(x.expiresAt));
    const keepInvite = inv => t - doneAt(inv) <= KEEP_INVITE_MS;
    const before = [invites.length, sessions.length, aiKeys.length];
    invites = invites.filter(keepInvite);
    const inviteIds = new Set(invites.map(i => i.id));
    sessions = sessions.filter(s => inviteIds.has(s.inviteId) && t - doneAt(s) <= KEEP_INVITE_MS);
    aiKeys = aiKeys.filter(k => t - doneAt(k) <= KEEP_AI_KEY_MS);
    if (invites.length !== before[0]) saveInvites();
    if (sessions.length !== before[1]) saveSessions();
    if (aiKeys.length !== before[2]) saveAiKeys();
  }

  return {
    // 招待
    createInvite, getInvite, checkInviteKey, revokeInvite, revokeInvitesForEvent,
    inviteView, inviteStatus, activeSessionCount,
    listInvites: () => invites.slice(),
    // セッション
    createSession, verifySessionCookie, touchSession, getSession, revokeSession, sessionsOfInvite,
    // AI キー
    createAiKey, verifyAiKey, revokeAiKey, getAiKey, aiKeyView, recordAiUse,
    listAiKeys: () => aiKeys.slice(),
    // 監査・掃除
    audit, cleanup,
    files
  };
}

module.exports = {
  createCredentials,
  parseToken, formatToken, hashSecret, verifySecret,
  endOfDayJst, jstDateOf, endOfJstDayPlus, defaultInviteExpiry, inviteExpiryFromPreset, parseExpiry,
  summarizeUa, normalizeAiLimits, cleanLabel,
  constants: {
    INVITE_MIN_MS, INVITE_MAX_MS, AI_KEY_DEFAULT_DAYS, AI_KEY_MAX_DAYS, DEFAULT_MAX_DEVICES,
    MAX_DEVICES_LIMIT, LABEL_MAX, DEFAULT_AI_LIMITS, AI_PREFIX, DAY, MINUTE, KEEP_INVITE_MS
  }
};
