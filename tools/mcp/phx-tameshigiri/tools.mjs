// MCP のツール 10 本（設計書 2026-10-03 7.3）と、クライアント側の安全策（7.4）。
// 書き込むツールは必ず先に GET /api/events/:id で今の名前を読み、「テスト用」で始まらなければ API を呼ばずに拒否する。
// サーバー側にも同じ砂場の判定（5.4）があり、二重の守りになる。
import { ToolError, badInput } from './errors.mjs';
import { loadScoring, loadStatus, mulberry32, planScoring, scoreBody } from './scoring-vm.mjs';

export const SANDBOX_PREFIX = 'テスト用';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ORDER_PATTERN = /^([^-]+)-(男子|女子)-(\d+)-(\d+)$/;
const VALUES = ['○', '×', '△', ''];
const STATES = ['draft', 'round1', 'round1_done', 'round2', 'round2_done', 'final', 'archived'];
const FORCE_STATES = ['final', 'archived'];
const MAX_EVENT_ROWS = 300;
const MAX_ADD_PLAYERS = 100;
const DEFAULT_SEED = 20261001;

export const isSandboxName = name => typeof name === 'string' && name.trim().startsWith(SANDBOX_PREFIX);

function parseOrder(o) {
  const m = ORDER_PATTERN.exec(String(o || ''));
  return m ? { court: m[1], gender: m[2], round: +m[3], number: +m[4] } : null;
}
const roundOf = p => { const o = parseOrder(p && p.order); return o ? o.round : 1; };
const courtOf = p => { const m = /^([^-]+)/.exec(String((p && p.order) || '')); return m ? m[1] : '未分類'; };
const techsOf = p => [p.tech1, p.tech2, p.tech3].map(t => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
const revOf = p => (typeof p.rev === 'number' && Number.isInteger(p.rev) && p.rev >= 0 ? p.rev : 0);
const isInt = v => typeof v === 'number' && Number.isInteger(v);

// ───────── 引数の検査 ─────────
function obj(args) {
  return (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
}
function needId(v, label) {
  if (typeof v !== 'string' || !ID_PATTERN.test(v)) throw badInput(label + ' が不正です（英数字・-・_ の 1〜64 文字）');
  return v;
}
function optBool(v, label, def) {
  if (v === undefined) return def;
  if (typeof v !== 'boolean') throw badInput(label + ' は true / false で指定してください');
  return v;
}
function optInt(v, label, def, min, max) {
  if (v === undefined) return def;
  if (!isInt(v) || v < min || v > max) throw badInput(label + ' は ' + min + '〜' + max + ' の整数で指定してください');
  return v;
}
function optStr(v, label, max) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length > max) throw badInput(label + ' は ' + max + ' 文字までの文字列で指定してください');
  return v;
}
function validCourt(c) {
  return typeof c === 'string' && c.length > 0 && c.length <= 32 && !c.includes('-') && c !== '未分類';
}

// ───────── 安全策 ─────────
async function readEvent(api, eventId) {
  return api.request('GET', '/api/events/' + encodeURIComponent(eventId));
}
function guardSandbox(event) {
  if (!isSandboxName(event && event.name)) {
    throw new ToolError('『' + (event && event.name) + '』はテスト用の大会ではないので書き込みません。' +
      '本番の大会の操作は運営画面で行ってください（AI が書き込めるのは名前が「' + SANDBOX_PREFIX + '」で始まる大会だけです）。',
      { status: null, reason: 'not_sandbox', extra: { eventId: event && event.id, name: event && event.name } });
  }
}

function playerView(p) {
  return {
    id: p.id, name: p.name, order: p.order, court: courtOf(p), round: roundOf(p),
    isFemale: p.isFemale === true, isNewFace: p.isNewFace === true,
    tech1: p.tech1 || '', tech2: p.tech2 || '', tech3: p.tech3 || '',
    score: typeof p.score === 'number' ? p.score : 0, confirmed: p.confirmed === true,
    rev: revOf(p)
  };
}

// 採点の行の並び: コート → 男子・女子 → 番号
function rowSort() {
  return (a, b) => {
    const oa = parseOrder(a.order) || { court: '', gender: '', number: 0 };
    const ob = parseOrder(b.order) || { court: '', gender: '', number: 0 };
    if (oa.court !== ob.court) return oa.court < ob.court ? -1 : 1;
    if (oa.gender !== ob.gender) return oa.gender === '男子' ? -1 : 1;
    return oa.number - ob.number;
  };
}

// ───────── ツールの定義 ─────────
const EVENT_ID = { type: 'string', description: '大会 ID（list_events の id）' };

export const TOOL_DEFS = [
  {
    name: 'whoami',
    title: 'AI 用キーの確認',
    description: '接続先と AI 用キーの情報（ラベル・期限・残り回数・砂場の接頭辞「テスト用」）を返す。キーそのものは返さない。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'list_events',
    title: '大会の一覧',
    description: '大会の一覧（id・名前・日付・状態・人数・sandbox（AI が書き込めるテスト用か）・createdByAi）。' +
      '本番の大会は読むだけ。includeProduction: false でテスト用だけ。',
    inputSchema: {
      type: 'object',
      properties: { includeProduction: { type: 'boolean', description: '本番の大会も含める（既定 true）' } },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'get_event',
    title: '大会の詳細',
    description: '大会の詳細と選手の行（最大 300 行。超えたら truncated: true）。round（1/2）と court で絞れる。' +
      '技得点表（techniques: name と strikes。strikes の null はその太刀が無い）も返す。score_player の rows は技の並び（tech1〜tech3 の空でないもの）の順。',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: EVENT_ID,
        round: { type: 'integer', enum: [1, 2], description: '巡目で絞る' },
        court: { type: 'string', description: 'コートで絞る（例 A）' },
        includeTechniques: { type: 'boolean', description: '技得点表を含める（既定 true）' }
      },
      required: ['eventId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'create_test_event',
    title: 'テスト用の大会を作る',
    description: 'テスト用の大会を作る。名前が「テスト用」で始まらなければ先頭に「テスト用 」を足して作る（戻り値の name で知らせる）。' +
      'template: blank（空。courts のコート）/ systest（ダミー選手 20 名、コート A・B）。作った大会は一覧で既定で隠れる（test）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '大会名（100 文字まで）' },
        date: { type: 'string', description: '日付（例 2026-10-12）' },
        venue: { type: 'string', description: '会場' },
        courts: { type: 'array', items: { type: 'string' }, description: 'コート名（既定 ["A","B"]。blank のときだけ）' },
        template: { type: 'string', enum: ['blank', 'systest'], description: '既定 blank' }
      },
      required: ['name'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'add_players',
    title: '選手を登録する',
    description: 'テスト用の大会に一巡目の選手をまとめて登録する（最大 100 名）。技名は技得点表の名前（(男)/(女) の付いた技は付けない名前でもよい）。' +
      '同じ形（repeatable でない技）は 1 人 1 回まで。',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: EVENT_ID,
        players: {
          type: 'array',
          maxItems: MAX_ADD_PLAYERS,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              court: { type: 'string' },
              isFemale: { type: 'boolean' },
              isNewFace: { type: 'boolean' },
              tech1: { type: 'string' },
              tech2: { type: 'string' },
              tech3: { type: 'string' },
              bib: { type: 'integer', description: 'ゼッケン番号（任意）' },
              rank: { type: 'string', description: '級位・段位（任意）' }
            },
            required: ['name', 'court'],
            additionalProperties: false
          }
        }
      },
      required: ['eventId', 'players'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'score_player',
    title: '1 名を採点する',
    description: 'テスト用の大会の 1 名を採点する（採点画面と同じ計算で得点を出し、最新の版 baseRev を付けて保存）。' +
      'rows は技の並び（tech1〜tech3 の空でないもの）の順に 1 行ずつ、values は初〜四ノ太刀の 4 つ（○ 成功 / × 失敗 / △ 減点成功（初太刀で減点のある技だけ）/ "" 未・無し）。' +
      '配点が null の太刀は "" にする。adjust はその技の補正点、totalAdjust は全体補正。confirmed は既定 true（確定）。',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: EVENT_ID,
        playerId: { type: 'string', description: '選手の行の id（get_event の players[].id）' },
        rows: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              values: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', enum: VALUES } },
              adjust: { type: 'integer', minimum: -999, maximum: 999 }
            },
            required: ['values'],
            additionalProperties: false
          }
        },
        totalAdjust: { type: 'integer', minimum: -999, maximum: 999 },
        confirmed: { type: 'boolean', description: '確定する（既定 true）' },
        note: { type: 'string', description: '備考（200 文字まで）' }
      },
      required: ['eventId', 'playerId', 'rows'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'auto_score',
    title: '乱数で採点する（予行用）',
    description: 'テスト用の大会で、今の状態で採点できる行のうち未確定の行を、予行スクリプトと同じ乱数（mulberry32）と割合で採点・確定する。' +
      '確定済みの行は飛ばす（途中で回数の上限に当たっても、もう一度呼べば続きから）。court で絞れる。',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: EVENT_ID,
        court: { type: 'string', description: 'コートで絞る' },
        seed: { type: 'integer', description: '乱数の種（既定 20261001）' },
        confirm: { type: 'boolean', description: '確定まで進める（既定 true。false なら未確定で保存）' }
      },
      required: ['eventId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'change_status',
    title: '大会の状態を変える',
    description: 'テスト用の大会の状態を変える（今の状態を読んでから from を付けて送る）。状態: draft 準備中 / round1 一巡目 / round1_done 二巡目準備（一巡目の終了で二巡目を生成）/ ' +
      'round2 二巡目 / round2_done 二巡目終了 / final 最終結果 / archived アーカイブ。final と archived は force: true が無ければ拒否する。',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: EVENT_ID,
        to: { type: 'string', enum: STATES },
        force: { type: 'boolean', description: 'final / archived に進めるときだけ true' }
      },
      required: ['eventId', 'to'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'get_ranking',
    title: '順位',
    description: '大会の順位（一般男子・一般女子・新人の rankings、ベスト4 の best4、大会の状態 event.status）。サーバーの ranking API の応答そのまま。',
    inputSchema: { type: 'object', properties: { eventId: EVENT_ID }, required: ['eventId'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'delete_test_event',
    title: 'テスト用の大会を消す',
    description: 'AI が作ったテスト用の大会を消す（取り消せない）。confirmName に今の大会名を完全に一致させて渡す。運営が作ったテスト用の大会は消さない。',
    inputSchema: {
      type: 'object',
      properties: { eventId: EVENT_ID, confirmName: { type: 'string', description: '今の大会名（完全一致）' } },
      required: ['eventId', 'confirmName'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }
];

// ───────── ツールの本体 ─────────
export function createHandlers(api) {
  return {
    async whoami() {
      const w = await api.request('GET', '/api/ai/whoami');
      return {
        baseUrl: api.baseUrl, keyLabel: w.label, keyId: w.keyId, expiresAt: w.expiresAt, now: w.now,
        limits: w.limits, remaining: w.remaining, sandboxPrefix: w.sandboxPrefix
      };
    },

    async list_events(args) {
      const a = obj(args);
      const includeProduction = optBool(a.includeProduction, 'includeProduction', true);
      const list = await api.request('GET', '/api/events');
      const rows = (Array.isArray(list) ? list : []).map(e => ({
        id: e.id, name: e.name, date: e.date || '', status: e.status, playerCount: e.playerCount,
        sandbox: e.sandbox === true, createdByAi: e.createdByAi === true, test: e.test === true
      }));
      return includeProduction ? rows : rows.filter(r => r.sandbox);
    },

    async get_event(args) {
      const a = obj(args);
      const eventId = needId(a.eventId, 'eventId');
      if (a.round !== undefined && a.round !== 1 && a.round !== 2) throw badInput('round は 1 か 2 で指定してください');
      const court = optStr(a.court, 'court', 32);
      const includeTechniques = optBool(a.includeTechniques, 'includeTechniques', true);
      const ev = await readEvent(api, eventId);
      let players = (Array.isArray(ev.players) ? ev.players : []).filter(p => p && typeof p === 'object');
      if (a.round !== undefined) players = players.filter(p => roundOf(p) === a.round);
      if (court !== undefined) players = players.filter(p => courtOf(p) === court);
      const out = {
        id: ev.id, name: ev.name, date: ev.date || '', venue: ev.venue || '', status: ev.status,
        sandbox: isSandboxName(ev.name), createdByAi: ev.createdBy === 'ai', test: ev.test === true,
        courts: (ev.settings && Array.isArray(ev.settings.courts)) ? ev.settings.courts : [],
        playerCount: players.length,
        players: players.slice(0, MAX_EVENT_ROWS).map(playerView)
      };
      if (players.length > MAX_EVENT_ROWS) out.truncated = true;
      if (includeTechniques) {
        out.techniques = (Array.isArray(ev.techniques) ? ev.techniques : []).map(t => {
          const v = { name: t.name, strikes: t.strikes };
          if (typeof t.reducedFirst === 'number') v.reducedFirst = t.reducedFirst;
          if (t.repeatable === true) v.repeatable = true;
          return v;
        });
      }
      return out;
    },

    async create_test_event(args) {
      const a = obj(args);
      if (typeof a.name !== 'string' || !a.name.trim()) throw badInput('name（大会名）を指定してください');
      let name = a.name.trim();
      const renamed = !isSandboxName(name);
      if (renamed) name = SANDBOX_PREFIX + ' ' + name;
      if (name.length > 100) throw badInput('大会名は「' + SANDBOX_PREFIX + ' 」を含めて 100 文字までです');
      const date = optStr(a.date, 'date', 20) || '';
      const venue = optStr(a.venue, 'venue', 100) || '';
      const template = a.template === undefined ? 'blank' : a.template;
      if (template !== 'blank' && template !== 'systest') throw badInput('template は blank か systest です');
      let courts = ['A', 'B'];
      if (a.courts !== undefined) {
        if (!Array.isArray(a.courts) || a.courts.length === 0 || a.courts.length > 20 || !a.courts.every(validCourt) ||
            new Set(a.courts).size !== a.courts.length) {
          throw badInput('courts はコート名（1〜32 文字、- を含まない、未分類 以外、重複なし）の配列で指定してください');
        }
        courts = a.courts.slice();
      }
      let id;
      if (template === 'systest') {
        const r = await api.request('POST', '/api/events/from-template', { template: 'systest', name, date, venue });
        id = r && r.id;
      } else {
        const r = await api.request('POST', '/api/events', {
          name, date, venue, players: [], settings: { requireBib: false, requireRank: false, courts }
        });
        id = r && r.id;
      }
      if (!id) throw new ToolError('大会の id が返りませんでした', { status: null, reason: 'bad_response' });
      const out = { id, name, template };
      if (renamed) out.note = '名前が「' + SANDBOX_PREFIX + '」で始まらなかったので、先頭に足して作りました';
      if (template === 'systest' && a.courts !== undefined) out.courtsNote = 'systest のコートは A・B 固定です（courts は使いません）';
      return out;
    },

    async add_players(args) {
      const a = obj(args);
      const eventId = needId(a.eventId, 'eventId');
      if (!Array.isArray(a.players) || a.players.length === 0) throw badInput('players を 1 名以上指定してください');
      if (a.players.length > MAX_ADD_PLAYERS) throw badInput('一度に登録できるのは ' + MAX_ADD_PLAYERS + ' 名までです');
      const rows = a.players.map((p, i) => {
        const at = (i + 1) + ' 人目: ';
        if (!p || typeof p !== 'object' || Array.isArray(p)) throw badInput(at + '選手はオブジェクトで指定してください');
        if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100) throw badInput(at + 'name は 1〜100 文字です');
        if (!validCourt(p.court)) throw badInput(at + 'court が不正です（1〜32 文字、- を含まない、未分類 以外）');
        const row = { name: p.name.trim(), court: p.court };
        if (p.isFemale !== undefined) row.isFemale = optBool(p.isFemale, at + 'isFemale', false);
        if (p.isNewFace !== undefined) row.isNewFace = optBool(p.isNewFace, at + 'isNewFace', false);
        for (const k of ['tech1', 'tech2', 'tech3']) {
          if (p[k] !== undefined) row[k] = optStr(p[k], at + k, 50);
        }
        if (p.bib !== undefined) row.bib = optInt(p.bib, at + 'bib', undefined, 1, 99999);
        if (p.rank !== undefined) row.rank = optStr(p.rank, at + 'rank', 20);
        return row;
      });
      const ev = await readEvent(api, eventId);
      guardSandbox(ev);
      const r = await api.request('POST', '/api/events/' + encodeURIComponent(eventId) + '/players/bulk', { rows });
      return {
        created: r.created,
        players: (r.players || []).map(p => ({ id: p.id, name: p.name, order: p.order }))
      };
    },

    async score_player(args) {
      const a = obj(args);
      const eventId = needId(a.eventId, 'eventId');
      const playerId = needId(a.playerId, 'playerId');
      if (!Array.isArray(a.rows)) throw badInput('rows（技ごとの太刀の結果）を指定してください');
      const totalAdjust = optInt(a.totalAdjust, 'totalAdjust', 0, -999, 999);
      const confirmed = optBool(a.confirmed, 'confirmed', true);
      const note = optStr(a.note, 'note', 200);
      a.rows.forEach((r, i) => {
        const at = (i + 1) + ' 行目: ';
        if (!r || typeof r !== 'object' || !Array.isArray(r.values) || r.values.length !== 4) {
          throw badInput(at + 'values は 4 つ（初〜四ノ太刀）の配列で指定してください');
        }
        if (!r.values.every(v => VALUES.includes(v))) throw badInput(at + 'values は ○ / × / △ / "" のどれかです');
        optInt(r.adjust, at + 'adjust', 0, -999, 999);
      });

      const ev = await readEvent(api, eventId);
      guardSandbox(ev);
      const player = (Array.isArray(ev.players) ? ev.players : []).find(p => p && p.id === playerId);
      if (!player) throw new ToolError('選手が見つかりません（' + playerId + '）', { status: 404, reason: 'not_found' });
      const techs = techsOf(player);
      if (techs.length === 0) throw badInput('この選手には技が登録されていません');
      if (a.rows.length !== techs.length) {
        throw badInput('rows の数（' + a.rows.length + '）が技の数（' + techs.length + ': ' + techs.join(' / ') + '）と合いません', { techniques: techs });
      }
      const isFemale = player.isFemale === true;
      const { Scoring } = loadScoring();
      Scoring.setTechniques(Array.isArray(ev.techniques) ? ev.techniques : []);
      const rows = techs.map((name, i) => {
        const tech = Scoring.findTechnique(name, isFemale);
        if (!tech) throw badInput('技「' + name + '」が大会の技得点表にありません');
        const values = a.rows[i].values.slice();
        values.forEach((v, s) => {
          if (v !== '' && tech.strikes[s] === null) {
            throw badInput((i + 1) + ' 行目（' + name + '）: ' + (s + 1) + ' 本目の太刀はこの技に無い（配点 null）ので "" にしてください', { strikes: tech.strikes });
          }
          if (v === '△' && !(s === 0 && typeof tech.reducedFirst === 'number')) {
            throw badInput((i + 1) + ' 行目（' + name + '）: △（減点成功）は減点のある技の初太刀だけです');
          }
        });
        return { techName: name, values, adjust: a.rows[i].adjust || 0 };
      });
      const body = scoreBody(Scoring, { rows, totalAdjust }, isFemale, confirmed, revOf(player), note);
      const r = await api.request('PATCH', '/api/events/' + encodeURIComponent(eventId) + '/players/' + encodeURIComponent(playerId), body);
      const saved = (r && r.player) || {};
      return { playerId, name: saved.name, score: saved.score, rev: saved.rev, confirmed: saved.confirmed === true, result: saved.result };
    },

    async auto_score(args) {
      const a = obj(args);
      const eventId = needId(a.eventId, 'eventId');
      const court = optStr(a.court, 'court', 32);
      const seed = optInt(a.seed, 'seed', DEFAULT_SEED, -2147483648, 4294967295);
      const confirm = optBool(a.confirm, 'confirm', true);

      const ev = await readEvent(api, eventId);
      guardSandbox(ev);
      const EventStatus = loadStatus();
      const status = ev.status;
      if (!EventStatus.isScoringOpen(status)) {
        throw badInput('今の状態（' + (EventStatus.LABELS[status] || status) + '）では採点できません。change_status で一巡目・二巡目に進めてください', { eventStatus: status });
      }
      const all = (Array.isArray(ev.players) ? ev.players : []).filter(p => p && typeof p === 'object');
      const inScope = all.filter(p => roundOf(p) === EventStatus.scoringRound(status) && (court === undefined || courtOf(p) === court));
      const targets = inScope.filter(p => EventStatus.isRowScorable(status, p) && p.confirmed !== true && techsOf(p).length > 0)
        .sort(rowSort());
      const { Scoring } = loadScoring();
      const rnd = mulberry32(seed);
      const done = [];
      for (const p of targets) {
        const isFemale = p.isFemale === true;
        Scoring.setTechniques(Array.isArray(ev.techniques) ? ev.techniques : []);
        const plan = planScoring(Scoring, rnd, techsOf(p), isFemale);
        const body = scoreBody(Scoring, plan, isFemale, confirm, revOf(p));
        let r;
        try {
          r = await api.request('PATCH', '/api/events/' + encodeURIComponent(eventId) + '/players/' + encodeURIComponent(p.id), body);
        } catch (e) {
          if (e instanceof ToolError) {
            e.message += '\n途中まで採点しました（' + done.length + ' / ' + targets.length + ' 名）。確定済みの行は飛ばすので、もう一度 auto_score を呼べば続きから採点します。';
            e.extra = Object.assign({}, e.extra || {}, { scored: done.length, remaining: targets.length - done.length, players: done });
          }
          throw e;
        }
        const saved = (r && r.player) || {};
        done.push({ id: p.id, name: p.name, court: courtOf(p), score: saved.score, confirmed: saved.confirmed === true });
      }
      return { status, seed, scored: done.length, skipped: inScope.length - done.length, players: done };
    },

    async change_status(args) {
      const a = obj(args);
      const eventId = needId(a.eventId, 'eventId');
      if (!STATES.includes(a.to)) throw badInput('to は ' + STATES.join(' / ') + ' のどれかです');
      const force = optBool(a.force, 'force', false);
      if (FORCE_STATES.includes(a.to) && !force) {
        throw badInput('「' + a.to + '」（' + (a.to === 'final' ? '最終結果' : 'アーカイブ') + '）への遷移は取り消しにくいので、force: true が無ければ進めません。' +
          'ユーザーに大会名と操作を示して承認を得てから force: true で呼んでください。');
      }
      const ev = await readEvent(api, eventId);
      guardSandbox(ev);
      const from = ev.status;
      const r = await api.request('POST', '/api/events/' + encodeURIComponent(eventId) + '/status', { to: a.to, from });
      return { from, status: r.status, round2: r.round2 || null };
    },

    async get_ranking(args) {
      const a = obj(args);
      const eventId = needId(a.eventId, 'eventId');
      return api.request('GET', '/api/events/' + encodeURIComponent(eventId) + '/ranking');
    },

    async delete_test_event(args) {
      const a = obj(args);
      const eventId = needId(a.eventId, 'eventId');
      if (typeof a.confirmName !== 'string') throw badInput('confirmName（今の大会名）を指定してください');
      const ev = await readEvent(api, eventId);
      guardSandbox(ev);
      if (ev.createdBy !== 'ai') {
        throw new ToolError('『' + ev.name + '』は運営が作ったテスト用の大会なので、AI は消しません（消せるのは AI が作った大会だけ）。',
          { status: null, reason: 'not_sandbox', extra: { eventId, name: ev.name, createdByAi: false } });
      }
      if (a.confirmName !== ev.name) {
        throw new ToolError('confirmName が今の大会名と一致しないので消しません。今の名前: 『' + ev.name + '』',
          { status: null, reason: 'confirm_mismatch', extra: { eventId, name: ev.name } });
      }
      await api.request('DELETE', '/api/events/' + encodeURIComponent(eventId));
      return { deleted: true, id: eventId, name: ev.name };
    }
  };
}
