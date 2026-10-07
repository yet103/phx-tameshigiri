const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  createAuth, isPublicApi, resolvePrincipal, isCrossOrigin, createRateLimiter,
  sessionCookieName, parseCookies, buildSessionCookie, sendScorerForbiddenPage, sendSessionInvalidPage
} = require('./auth');
const { classify, normalize: normalizeStaticPath, scorerAllowed } = require('./static-policy');
const credentialsLib = require('./credentials');
const authz = require('./authz');
// 大会の状態。クライアント（<script src="status.js">）と同じファイルを読む。
// 判定を2箇所に持たないため、状態に関わる分岐は必ずこのモジュールを通す。
const EventStatus = require('../status.js');

const app = express();
// ルーティングを大文字小文字で区別する。既定の区別なしだと /API/events が
// ルートに一致する一方、認証ミドルウェアの '/api/' 判定をすり抜ける。
app.set('case sensitive routing', true);
const PORT = process.env.PORT || 3457;
// nginx が X-Forwarded-For を渡していると確かめてから設定する（例 'loopback, uniquelocal'）。
// ポート 3457 が外から届く間は設定しない（X-Forwarded-For を偽装できるため。設計書 2026-10-03 3.6）。
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY.trim();
  app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp);
}

// データ保存先ディレクトリ。テストは TMG_DATA_DIR で一時ディレクトリに向ける
// （開発機の大会に触らない。設計書 2026-10-03 4.9）。未設定なら今どおり server/data。
const DATA_DIR = process.env.TMG_DATA_DIR ? path.resolve(process.env.TMG_DATA_DIR) : path.join(__dirname, 'data');
const EVENTS_DIR = path.join(DATA_DIR, 'events');
const TECHNIQUES_DIR = path.join(DATA_DIR, 'techniques');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const LINKS_DIR = path.join(DATA_DIR, 'links');
// 招待・セッション・AI 用キー・監査ログ（server/credentials.js）。静的配信の許可リストに無く、
// server/ 配下の実パスは 404 なので外には出ない。
const AUTH_DIR = path.join(DATA_DIR, 'auth');

// 起動時にディレクトリ自動生成
fs.mkdirSync(EVENTS_DIR, { recursive: true });
fs.mkdirSync(TECHNIQUES_DIR, { recursive: true });
fs.mkdirSync(HISTORY_DIR, { recursive: true });
fs.mkdirSync(LINKS_DIR, { recursive: true });

// ID生成
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ID検証（パストラバーサル防止）
// ファイル名として使うIDは英数字・ハイフン・アンダースコアのみ許可する
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

// 不正なIDなら400を返して処理を打ち切る（戻り値: 妥当なら true）
function requireValidId(req, res) {
  if (!isValidId(req.params.id)) {
    res.status(400).json({ error: '不正な大会IDです' });
    return false;
  }
  return true;
}

// デフォルト技術リスト
// drawn/repeatable/reducedFirst の既定は data.js の TECHNIQUES と同じ
// （設計書 2026-09-20-rules-alignment-design.md。test.html がサーバーの既定と data.js の一致を固定する）。
const DEFAULT_TECHNIQUES = [
  { name: "立位袈裟",    strikes: [1,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "立位逆袈裟",  strikes: [2,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "立位横一",    strikes: [8,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "座位袈裟",    strikes: [3,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "座位逆袈裟",  strikes: [4,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "座位横一",    strikes: [10, null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "基本一",      strikes: [15, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "基本二",      strikes: [9,  1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "真",          strikes: [11, 3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "連",          strikes: [8,  3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "左",          strikes: [18, 3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "右",          strikes: [13, 3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "捨",          strikes: [17, 3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "胸尽くし(男)", strikes: [11, 1,    null, null], drawn: false, repeatable: false, reducedFirst: 4 },
  { name: "胸尽くし(女)", strikes: [13, 1,    null, null], drawn: false, repeatable: false, reducedFirst: 4 },
  { name: "円要",        strikes: [16, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "両車",        strikes: [17, 5,    1,    null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "野送り",      strikes: [6,  null, null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "玉光",        strikes: [6,  null, null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "水月(男)",    strikes: [17, 11,   null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "水月(女)",    strikes: [17, 13,   null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "置藁水月",    strikes: [35, null, null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "陰中陽",      strikes: [8,  null, null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "陽中陰",      strikes: [17, 2,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "響き返し",    strikes: [14, 4,    2,    null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "破図味(男)",  strikes: [20, 4,    4,    2   ], drawn: false, repeatable: false, reducedFirst: null },
  { name: "破図味(女)",  strikes: [20, 6,    6,    2   ], drawn: false, repeatable: false, reducedFirst: null },
  { name: "前腰",        strikes: [13, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "夢想返し",    strikes: [13, 5,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "廻り懸り",    strikes: [17, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "右の敵",      strikes: [15, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "四方",        strikes: [17, 5,    7,    3   ], drawn: false, repeatable: false, reducedFirst: null }
];

// 技リストの複製と正規化。
// 雛形（DEFAULT_TECHNIQUES / custom.json）をそのまま大会 JSON に入れると、
// あとで雛形を変えたときに採点中の大会の配点まで動いたように見える。必ず複製して渡す。
// 同時に { name, strikes, drawn, repeatable, reducedFirst } 以外のキーを落とす（保存する形はこの5つだけ）。
// drawn（抜刀後の形。既定 false）はレンタルの選手に出す技を絞り込むための印
// （設計書「選手の追加項目」。courts.js の Courts.isDrawnTechnique と同じ規則）。
// repeatable（同じ巡で何度でも選べるか。既定 false）・reducedFirst（減点成功△の初太刀の配点。既定 null）は
// 設計書 2026-09-20-rules-alignment-design.md。
function cloneTechniques(list) {
  return (Array.isArray(list) ? list : []).map(function(t) {
    const rf = t && t.reducedFirst;
    return {
      name: (t && typeof t.name === 'string') ? t.name.trim() : '',
      strikes: [0, 1, 2, 3].map(function(i) {
        const v = (t && Array.isArray(t.strikes)) ? t.strikes[i] : null;
        return Number.isInteger(v) ? v : null;
      }),
      drawn: !!(t && t.drawn === true),
      repeatable: !!(t && t.repeatable === true),
      reducedFirst: (Number.isInteger(rf) && rf >= 0 && rf <= 99) ? rf : null,
      // note（備考。技得点表の右端の列）は省略可。得点には関わらない。省略時は ''
      note: (t && typeof t.note === 'string') ? t.note.trim().slice(0, 100) : ''
    };
  });
}

// その大会の採点に使う技リスト（有効な技リスト）。
// event.techniques が配列ならそれ、無ければ雛形の複製。技リストを読むハンドラは必ずこれを使う。
function effectiveTechniques(event) {
  if (event && Array.isArray(event.techniques)) return event.techniques;
  return cloneTechniques(readTechniques().techniques);
}

// その大会が自前の技リストを持っているか。GET の techniquesSource に使う。
function techniquesSourceOf(event) {
  return (event && Array.isArray(event.techniques)) ? 'event' : 'template';
}

// CSVパース関数（RFC 4180対応）
function parseCSV(text) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i+1];
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++; // エスケープされたダブルクォート
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentLine.push(currentField);
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++;
        }
        currentLine.push(currentField);
        lines.push(currentLine);
        currentLine = [];
        currentField = '';
      } else if (char === '\n') {
        currentLine.push(currentField);
        lines.push(currentLine);
        currentLine = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }
  
  if (currentField !== '' || currentLine.length > 0) {
    currentLine.push(currentField);
    lines.push(currentLine);
  }
  
  // 最後の空行を削除
  if (lines.length > 0 && lines[lines.length - 1].length === 1 && lines[lines.length - 1][0] === '') {
    lines.pop();
  }
  
  return lines;
}

// CSVエスケープ関数
function escapeCSV(field) {
  if (field == null) return '';
  const str = String(field);
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// 採点済みかどうかの判定・巡目（order の第3セグメント）の判定は EventStatus.isScored /
// EventStatus.roundOf を使う（status.js に一本化。以前はここに自前実装を持っていたが、
// status.js の derive も同じ規則を持つ必要があり、判定を2箇所に持たない）。
// クライアント側の同じ実装は courts.js の Courts.isScored / Courts.roundOf。

// ── order（コート-性別-巡目-番号）の解析と組み立て ──
// クライアント側の対応実装は courts.js（Courts.courtOf / Courts.roundOf）。
// モジュールを共有できない（CommonJS と <script> の IIFE）ため同じ規則を2箇所に持ち、
// クライアント側は test.html の roundOf テスト、サーバー側は createPlayer / generateNextRound の API テストで固定する。
const ORDER_PATTERN = /^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/;

// order を { court, gender, round, number } に分解する。解析できなければ null。
function parseOrder(order) {
  const m = (typeof order === 'string' ? order : '').match(ORDER_PATTERN);
  if (!m) return null;
  return {
    court: m[1],
    gender: m[2],
    round: parseInt(m[3], 10),
    number: parseInt(m[4], 10)
  };
}

// コート名（order の先頭セグメント）。Courts.courtOf と同じ規則。
function courtOf(player) {
  const order = (player && typeof player.order === 'string') ? player.order : '';
  const m = order.match(/^([^-]+)/);
  return m ? m[1] : '未分類';
}

// コート名の検証。
// '-' を含むと order の解析（先頭セグメント＝コート）が壊れ、
// '未分類' はクライアントの Courts.UNASSIGNED と衝突する。
// 長さは32文字までに制限する。
function isValidCourt(court) {
  return typeof court === 'string' && court.length > 0 &&
         court.length <= 32 &&
         court.indexOf('-') === -1 && court !== '未分類';
}

// コート一覧（大会の settings.courts）の検証。courts.js の Courts.validateCourtList と同じ規則
// （個々の名前は isValidCourt と同じ。重複なし・最大20件）。
// 戻り値: エラー文字列 or null（妥当。validateTechniques と同じ規則）。
function validateCourtList(list) {
  if (!Array.isArray(list)) return 'コート一覧の形式が不正です';
  if (list.length > 20) return 'コートは20件までです';
  const seen = Object.create(null);   // コート名が '__proto__' などでも壊れないように
  for (let i = 0; i < list.length; i++) {
    const name = list[i];
    if (!isValidCourt(name)) return 'コート名「' + name + '」は使えません';
    if (seen[name]) return 'コート名「' + name + '」が重複しています';
    seen[name] = true;
  }
  return null;
}

// コピー・バンドル取り込みで settings.courts を写すときの寛容な取り込み。
// 取り込み系 API（バンドル・インポート）は他の項目（bib・rank など）も不正値を
// 400 にはせず黙って落とすので、courts も同じ流儀に合わせる（コピーは自分自身のデータ
// なので常に妥当なはずだが、念のため同じ関数を通す）。
function sanitizeCourtList(list) {
  if (!Array.isArray(list)) return [];
  const seen = Object.create(null);
  const out = [];
  list.forEach(function(c) {
    if (!isValidCourt(c) || seen[c]) return;
    seen[c] = true;
    out.push(c);
  });
  return out.slice(0, 20);
}

// 大会の設定 settings.mixed（男女を分けずに進める。設計書 2026-10-07）。
function isMixedEvent(event) {
  return !!(event && event.settings && typeof event.settings === 'object' && event.settings.mixed === true);
}

// order の性別の段。混合の大会は '混合'（男女を区別せず コート×巡目 で通し番号）、
// そうでなければ行の性別。性別の段を決めるのはこの関数だけ。
function genderSeg(event, isFemale) {
  return isMixedEvent(event) ? '混合' : (isFemale === true ? '女子' : '男子');
}

// 同一の コート×性別の段×巡目 における次の番号。該当が無ければ 1。
// seg は genderSeg の戻り値（男子・女子・混合）。
// 件数+1 ではなく最大+1 を使う（削除で欠番があっても衝突しない）。
function nextOrderNumber(players, court, seg, round) {
  let max = 0;
  (players || []).forEach(p => {
    const parsed = parseOrder((p && p.order) || '');
    if (!parsed) return;
    if (parsed.court !== court || parsed.gender !== seg || parsed.round !== round) return;
    if (parsed.number > max) max = parsed.number;
  });
  return max + 1;
}

// order 文字列を組み立てる。seg は genderSeg の戻り値。
function buildOrder(court, seg, round, n) {
  return court + '-' + seg + '-' + round + '-' + n;
}

// settings.mixed の切り替えで全行の order を振り直す（設計書 2026-10-07 §3）。
// 今の並び（巡目 → コート → 男子 → 女子 → 番号。混合の行は性別の段が同じなので番号順）を保ったまま、
//   mixed … コート×巡目 ごとに 1 から通し番号。性別の段は '混合'
//   分ける … コート×巡目×性別 ごとに 1 から。性別の段は行の isFemale から
// order が読めない行（CSV 由来の空 order など）は触らない。rev は上げない（得点・技は変わらない）。
function renumberForMixed(event, mixed) {
  const players = Array.isArray(event.players) ? event.players : [];
  const rows = [];
  players.forEach(p => {
    const o = parseOrder((p && p.order) || '');
    if (o) rows.push({ p: p, o: o });
  });
  rows.sort((a, b) => {
    if (a.o.round !== b.o.round) return a.o.round - b.o.round;
    if (a.o.court !== b.o.court) return a.o.court < b.o.court ? -1 : 1;
    const ga = a.o.gender === '女子' ? 1 : 0;
    const gb = b.o.gender === '女子' ? 1 : 0;
    if (ga !== gb) return ga - gb;
    return a.o.number - b.o.number;
  });
  const next = Object.create(null);
  rows.forEach(x => {
    const seg = mixed ? '混合' : (x.p.isFemale === true ? '女子' : '男子');
    const key = x.o.court + '\n' + seg + '\n' + x.o.round;
    next[key] = (next[key] || 0) + 1;
    x.p.order = buildOrder(x.o.court, seg, x.o.round, next[key]);
  });
}

// JSONのアトミック書き込み
// writeFileSync で直接上書きすると、書き込み中にプロセスが落ちたときに
// ファイルが切り詰められ、大会データが丸ごと失われる。
// 一時ファイルへ書いてから rename することで、読み手からは
// 「古い完全なファイル」か「新しい完全なファイル」のどちらかしか見えなくなる。
function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath); // 同一ファイルシステム上なのでアトミック
}

// 履歴（server/data/history/<id>.json）に1件追記する。
// クライアントの Api.addHistory（POST /api/events/:id/history）と同じ形で書く。
// 状態の遷移は「状態を書く」と「履歴に残す」を1つの操作にしたいので、
// クライアントに addHistory を呼ばせず、サーバーがここで積む。
// principal（req.principal）を渡すと、誰が操作したか（actor）をサーバーが付ける
// （'運営' / '採点端末（<ラベル>）' / 'AI（<ラベル>）'。設計書 2026-10-03 5.6）。
function appendHistory(eventId, entry, principal) {
  if (principal) entry = Object.assign({}, entry, { actor: authz.actorLabel(principal) });
  const historyPath = path.join(HISTORY_DIR, `${eventId}.json`);
  let data = { eventId: eventId, entries: [] };
  if (fs.existsSync(historyPath)) {
    try {
      data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    } catch (e) {
      data = { eventId: eventId, entries: [] };   // 壊れた履歴で遷移を止めない
    }
  }
  if (!Array.isArray(data.entries)) data.entries = [];
  data.entries.push(Object.assign({}, entry, { timestamp: new Date().toISOString() }));
  writeJsonAtomic(historyPath, data);
}

// final / archived の大会への書き込みを拒む。
// 拒んだら 409 を返して true。呼び出し側は必ず `if (rejectIfLocked(res, event)) return;` の形で使う。
// 見た目の制限だけにしないため、画面側の無効化とは別にサーバーでも止める。
function rejectIfLocked(res, event) {
  const st = EventStatus.of(event);
  if (!EventStatus.isLocked(st)) return false;
  res.status(409).json({
    error: 'この大会は最終結果を確定済みです',
    reason: 'locked',
    status: st
  });
  return true;
}

// 確定の印を見ずに全行の得点を数える大会か。「確定」の機能より前に作られた、status を持たない大会だけ
// （旧データの互換。QA 指摘 2026-09-30）。状態を持つ大会は、最終結果のあとも確定済みの行だけを数える
// （確定の瞬間に順位が跳ねないように。未確定の行は「最終結果を確定」の前に確認で知らせる）。
function countsAllScores(event) {
  return !(event && typeof event.status === 'string');
}

// ── 選手の版（rev）。設計書 2026-10-01-audit-fixes-design.md 1 章 ──
// 遅れて届いた採点が新しい採点を上書きしないよう（網羅検証 M2）、行ごとに版を持たせる。
// 版を上げるのは「採点に関わる値」（REV_FIELDS）が実際に変わったときだけ。
// 名前・備考・ゼッケンなどの直しで採点画面を衝突にしないため、それらは含めない。
// 技と性別を含めるのは、古い技の並びのまま ○× を書かせないため。
const SCORE_FIELDS = ['score', 'result', 'adjust', 'totalAdjust', 'confirmed'];
const REV_FIELDS = SCORE_FIELDS.concat(['tech1', 'tech2', 'tech3', 'isFemale']);

// 版の項目を比べるための正規化（無い adjust と [0,0,0] は区別する。旧データの 5 文字目の
// 読み替えが変わるため）。JSON 文字列にして比べる。
function revFieldValue(p, key) {
  const v = p ? p[key] : undefined;
  if (key === 'confirmed' || key === 'isFemale') return v === true;
  if (key === 'adjust') return Array.isArray(v) ? v.slice() : null;
  if (key === 'score') return typeof v === 'number' ? v : 0;
  if (key === 'totalAdjust') return Number.isInteger(v) ? v : null;
  return typeof v === 'string' ? v : '';
}

function revFieldsDiffer(before, after, keys) {
  return (keys || REV_FIELDS).some(k =>
    JSON.stringify(revFieldValue(before, k)) !== JSON.stringify(revFieldValue(after, k)));
}

// before（変更前の複製）と after（変更後の行）で版の項目が変わっていれば rev を +1 する。
function bumpRevIfChanged(before, after) {
  if (revFieldsDiffer(before, after)) after.rev = EventStatus.revOf(before) + 1;
}

// 応答で返す選手の行。rev を必ず整数で入れる（ファイルに rev が無い行も 0 として返す）。
function playerWithRev(p) {
  return Object.assign({}, p, { rev: EventStatus.revOf(p) });
}

// 順位の集計。順位ロジックは status.js の EventStatus.rankings（採点画面の順位表 Courts.rankPanel と
// 同じ関数。一致を構造で保証する。設計書 2026-10-05 2.3）。
// 一巡目の行ごとに合算する（一巡目＋二巡目。網羅検証 M1。設計書 2026-10-01 2.3）。
// まとめ方は status.js の EventStatus.playerTotals（ベスト4 の best4Standings と共有。
// 「順位の一般男子の上位 4 ＝ ベスト4」を同じまとめ方で保証する。設計書 2026-10-04 2.2）:
//   一巡目の行 … 自分の id の組
//   sourcePlayerId を持つ行 … その id の組（元の行が消えていてもその id でまとめる）
//   sourcePlayerId を持たない二巡目以降の行（旧データ・CSV 由来）… 従来どおり氏名と性別で、
//     同じ氏名・同じ性別の一巡目の組に足す（無ければ氏名の組を作る）
// 組の氏名・性別・新人は組の代表（一巡目の行。無ければ最初に入った行）から取る。
// 得点降順、同点は同順位で次の順位は飛ぶ（1, 1, 3）。
// ○×の生データ（result）や order・id・key は返さない（共有リンクから無認証で読まれるため）。
// event.status は共有ページが表示条件（ベスト4 を出すか）に使う（状態名は秘密ではない。設計書 2026-10-05 4.2）。
function computeRanking(event) {
  const lockedEvent = countsAllScores(event);   // 旧データ（status 無し）だけ全行を数える
  const players = ((event && event.players) || []).filter(p => p && typeof p === 'object');
  const r = EventStatus.rankings(players, { countAll: lockedEvent });
  // counted … 確定した得点が 1 つでもある組（偽なら合計はまだ仮。順位表示ページは得点をグレーにする。ユーザー要望 2026-10-06）
  const strip = e => ({ rank: e.rank, name: e.name, score: e.score, counted: e.counted === true });
  // ベスト4 に残れる可能性（一般男子。二巡目の行ができてから。順位表示ページの列。ユーザー要望 2026-10-05）
  const techList = (event && Array.isArray(event.techniques) && event.techniques.length > 0)
    ? event.techniques : readTechniques().techniques;
  const maxExtraOf = p => ['tech1', 'tech2', 'tech3'].reduce((sum, k) => {
    const name = (p && typeof p[k] === 'string') ? p[k].trim() : '';
    const t = name ? resolveTechnique(techList, name, p.isFemale === true) : null;
    const strikes = (t && Array.isArray(t.strikes)) ? t.strikes : [];
    return sum + strikes.reduce((a, v) => a + ((typeof v === 'number' && isFinite(v)) ? v : 0), 0);
  }, 0);
  const chances = EventStatus.best4Chances(players, { countAll: lockedEvent, maxExtraOf });
  // 順位の行は rank/name/score/counted だけ（key は出さない。共有リンクにも出る契約）。可能性は別の項目に、各部門の行と同じ並びで持つ
  const chanceRows = key => r[key].map(e => {
    const c = chances[key].byKey[e.key];
    return c ? { flag: c.flag, label: c.label, max: c.max, pending: c.pending } : null;
  });
  // 合計の内訳（一巡目・二巡目・二巡目を終えたか）。順位の行と同じ並びで別の項目に持つ（行の契約は変えない。
  // 順位表示ページの「内訳」トグルと、一巡目まで／二巡目までの色分け。ユーザー要望 2026-10-06）
  const totalsByKey = Object.create(null);
  EventStatus.playerTotals(players, { countAll: lockedEvent }).forEach(t => { totalsByKey[t.key] = t; });
  const detailRows = key => r[key].map(e => {
    const t = totalsByKey[e.key];
    return t ? { r1: t.r1, r2: t.r2, r2Done: t.r2Done === true } : null;
  });
  const best4Chance = chances ? {
    remaining: { male: chances.male.remaining, female: chances.female.remaining, newFace: chances.newFace.remaining },
    male: chanceRows('male'),
    female: chanceRows('female'),
    newFace: chanceRows('newFace'),
    legend: ['sure', 'possible', 'out'].map(k => EventStatus.BEST4_FLAGS[k] + ' ' + EventStatus.BEST4_FLAG_TEXT[k])
  } : null;

  return {
    event: {
      name: (event && event.name) || '',
      date: (event && event.date) || '',
      venue: (event && event.venue) || '',
      updatedAt: (event && event.updatedAt) || '',
      status: EventStatus.of(event)
    },
    rankings: {
      male: r.male.map(strip),
      female: r.female.map(strip),
      newFace: r.newFace.map(strip)
    },
    detail: { male: detailRows('male'), female: detailRows('female'), newFace: detailRows('newFace') },
    // ベスト4 に残れる可能性（部門ごと。rankings の各配列と同じ並びの配列、二巡目が未確定の人数、凡例。
    // 二巡目の行が無ければ null。順位表示ページの列。ユーザー要望 2026-10-05）
    best4Chance: best4Chance,
    // 部門ごとの「〜巡目 済み/全員」（{ round, done, total, label }。順位表示ページの見出し用。ユーザー要望 2026-10-05）
    progress: EventStatus.roundProgress(players, EventStatus.of(event)),
    // ベスト4（一般男子の合計の上位 4 名・同点は全員・0 点以下は除く）。二巡目の途中は
    // final: false（暫定ベスト4）で、remaining に二巡目が未確定の一般男子の人数。常にある。
    // rows は name・total・r1・r2・rank だけ（○× や order・id は返さない）。設計書 2026-10-04 2.6。
    best4: EventStatus.best4Standings(players, { countAll: lockedEvent, status: EventStatus.of(event) })
  };
}

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

// ── 招待リンク・AI 用キー（設計書 docs/superpowers/specs/2026-10-03-invite-links-and-ai-key-design.md） ──
// CSRF の確認で Origin と比べる公開 URL（秘密ではないので docker-compose.yml に直書き）。
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
if (IS_PRODUCTION && !PUBLIC_ORIGIN) {
  console.warn('⚠ PUBLIC_ORIGIN が未設定です。書き込みの出所の確認は Sec-Fetch-Site だけで行います');
}
// セッション Cookie。本番は __Host- 付きで常に Secure（req.secure は trust proxy なしでは偽なので見ない）。
const COOKIE_NAME = sessionCookieName(IS_PRODUCTION);
const COOKIE_SECURE = IS_PRODUCTION || process.env.COOKIE_SECURE === '1';
const MINUTE_MS = 60 * 1000;
// セッション Cookie を期限のあとも残す長さ（掃除でセッションを消すまでの保持期間と同じ）
const SESSION_COOKIE_GRACE_MS = credentialsLib.constants.KEEP_INVITE_MS;

// 大会ファイルを同期で読む（無い・壊れている・不正な ID は null）。認可の判定で使う。
function loadEventSync(id) {
  if (!isValidId(id)) return null;
  const p = path.join(EVENTS_DIR, `${id}.json`);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return null;
  }
}

// 認可の判定（authz.authorize）で使う読み出し。「無い」と「あるが読めない」を分ける。
//   無い・不正な ID … null（ハンドラの 404 / 400 に任せる）
//   あるが読めない（壊れた JSON・オブジェクトでない）… authz.UNREADABLE（AI には 403 sandbox。
//   名前で砂場か判定できない大会を AI に消させない・書かせない）
function loadEventForAuthz(id) {
  if (!isValidId(id)) return null;
  const p = path.join(EVENTS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const ev = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return (ev && typeof ev === 'object' && !Array.isArray(ev)) ? ev : authz.UNREADABLE;
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;   // 確かめた直後に消えた
    return authz.UNREADABLE;
  }
}

const credentials = credentialsLib.createCredentials({
  dir: AUTH_DIR,
  eventExists: id => isValidId(id) && fs.existsSync(path.join(EVENTS_DIR, `${id}.json`))
});
// 古い招待・セッション・AI キーの掃除（起動時と 1 時間に 1 回。同期）
credentials.cleanup();
setInterval(() => {
  try { credentials.cleanup(); } catch (e) { console.error('認証データの掃除に失敗: ' + e.message); }
}, 60 * MINUTE_MS).unref();
// 速度制限（メモリ上。req.ip は trust proxy が無い今は nginx のアドレスで、実質は全体の上限）
const limiter = createRateLimiter();
setInterval(() => limiter.sweep(), MINUTE_MS).unref();

// 監査ログの actor
function auditActor(principal) {
  const k = principal && principal.kind;
  if (k === 'ai') return 'AI';
  return k || 'anonymous';
}

// AI が作った大会の同時に存在できる数（D13）
const AI_EVENT_QUOTA = 20;
function countAiEvents() {
  return fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json')).filter(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, f), 'utf-8')).createdBy === 'ai';
    } catch (e) {
      return false;
    }
  }).length;
}

// AI の作成（POST /api/events・コピー・テンプレート）の検査。名前が「テスト用」で始まらなければ 403 sandbox、
// AI が作った大会が上限に達していれば 409 sandbox_quota。拒んだら true（`if (rejectAiCreate(…)) return;`）。
function rejectAiCreate(req, res, name) {
  const d = authz.checkAiCreateName(req.principal, name);
  if (d) { authz.sendDeny(res, d); return true; }
  if (req.principal && req.principal.kind === 'ai' && countAiEvents() >= AI_EVENT_QUOTA) {
    res.status(409).json({
      error: 'AI が作った大会が ' + AI_EVENT_QUOTA + ' 件あります。不要な大会を消してから作ってください',
      reason: 'sandbox_quota', limit: AI_EVENT_QUOTA
    });
    return true;
  }
  return false;
}

// AI が作った大会の印（一覧で既定で隠す test と、AI が消せる大会の createdBy。D11・D12）
function markAiCreated(req, event) {
  if (req.principal && req.principal.kind === 'ai') {
    event.test = true;
    event.createdBy = 'ai';
  }
}

function sendRateLimited(res, retryAfter) {
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({ error: '回数の上限に達しました。しばらく待ってからやり直してください', reason: 'rate_limited', retryAfter: retryAfter });
}

const AI_KEY_ERRORS = {
  key_invalid: 'AI 用キーが無効です',
  key_expired: 'AI 用キーの期限が切れています',
  key_revoked: 'AI 用キーは取り消されています'
};

// AI の 1 日の上限は日本時間で区切る。次の日本時間 0 時までの秒数。
function secondsUntilJstMidnight() {
  const end = credentialsLib.endOfDayJst(credentialsLib.jstDateOf(Date.now()));
  return Math.max(1, Math.ceil((end.getTime() + 1 - Date.now()) / 1000));
}

// AI の書き込みが 2xx で終わったとき、その大会の履歴に積む要点（設計書 5.6）
function aiHistorySummary(req, res, matched, eventId) {
  const route = matched.route;
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const jb = (res.locals.jsonBody && typeof res.locals.jsonBody === 'object') ? res.locals.jsonBody : {};
  const ev = loadEventSync(eventId);
  switch (route.pattern) {
    case '/api/events/:id/players/:playerId': {
      const p = ev && Array.isArray(ev.players) ? ev.players.find(x => x && x.id === matched.params.playerId) : null;
      const who = p ? String(p.name || '') : matched.params.playerId;
      const scoring = ['score', 'result', 'adjust', 'totalAdjust', 'confirmed'].some(k => b[k] !== undefined);
      return '選手 ' + who + (scoring ? ' の採点' : ' の変更');
    }
    case '/api/events/:id/status':
      return '状態を「' + (EventStatus.LABELS[b.to] || b.to) + '」へ';
    case '/api/events/:id/players/bulk':
      return '選手 ' + (jb.created || 0) + ' 名を追加';
    case '/api/events/:id/players':
      return '選手 ' + (typeof b.name === 'string' ? b.name.trim() : '') + ' を追加';
    case '/api/events':
    case '/api/events/from-template':
    case '/api/events/:id/copy':
      return '大会「' + (ev ? ev.name : '') + '」を作成';
    default:
      return '';
  }
}

// API の認証と認可。本文を読む前に弾く（無認証の巨大 JSON をメモリに載せない、
// body-parser の 400/413 を無認証クライアントに見せない）。すべて同期。
//   1. 主体の解決（server/auth.js の resolvePrincipal。Basic → Bearer → Cookie → 開発の運営）
//      ページの配信（下の許可リスト）でも req.principal を使うので、全リクエストで解決する。
//   2. Bearer の誤りは 401 で止める（失敗の回数制限つき）。AI は回数制限と監査・履歴の記録。
//   3. CSRF（Cookie・Basic・開発の運営の GET/HEAD 以外に同じオリジンを求める）
//   4. ルートの判定表（server/authz.js。表に無いものは運営以外拒否）
// 401 に WWW-Authenticate を付けないのは、共有ページを見ている観客の画面に
// ブラウザのパスワードダイアログが出ないようにするため。運営端末は保護された
// HTML を開いた時点で認証済みなので、fetch にはブラウザが自動で資格情報を付ける。
// パスは小文字化して判定する（case sensitive routing と二重の守り。/API/ を素通りさせない）。
app.use((req, res, next) => {
  const principal = resolvePrincipal(req, { auth, credentials, cookieName: COOKIE_NAME });
  req.principal = principal;
  if (principal.kind === 'scorer') credentials.touchSession(principal.session);

  const p = req.path.toLowerCase();
  if (!p.startsWith('/api/')) return next();
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  const matched = authz.matchRoute(req.method, req.path);

  // Bearer の誤り・期限切れ・取り消し（Cookie に落とさない）
  if (principal.bearer) {
    const failKey = 'bearer-fail:' + req.ip;
    const wait = limiter.check(failKey, 10, MINUTE_MS);
    if (wait) return sendRateLimited(res, wait);
    limiter.hitAndBlock(failKey, 10, MINUTE_MS, MINUTE_MS);
    credentials.audit({
      actor: 'anonymous', action: 'ai.fail', reason: principal.reason, ip: req.ip,
      method: req.method, route: matched ? matched.route.pattern : null
    });
    return res.status(401).json({ error: AI_KEY_ERRORS[principal.reason] || '認証が必要です', reason: principal.reason });
  }

  if (principal.kind === 'ai') {
    const key = principal.key;
    const lim = key.limits || credentialsLib.constants.DEFAULT_AI_LIMITS;
    const params = matched ? matched.params : {};
    // 監査ログ（AI の全リクエスト。GET も、拒否も）と、書き込みの履歴（5.6）
    const origJson = res.json.bind(res);
    res.json = body => { res.locals.jsonBody = body; return origJson(body); };
    // 応答を送る直前（res.end）に同期で書く（'finish' だと、応答を受け取ったクライアントより後になることがある）
    let recorded = false;
    const origEnd = res.end.bind(res);
    res.end = function(...args) {
      if (!recorded) {
        recorded = true;
        recordAiRequest();
      }
      return origEnd(...args);
    };
    const recordAiRequest = () => {
      try {
        const jb = res.locals.jsonBody;
        const createdId = (matched && authz.ROUTES_CREATE.has(matched.route.pattern) && jb && isValidId(jb.id)) ? jb.id : null;
        const bodyEventId = (matched && matched.route.pattern === '/api/links' && req.body && isValidId(req.body.targetId))
          ? req.body.targetId : null;
        // 作る系（コピーを含む）は新しい大会、それ以外は URL の大会、POST /api/links は本文の大会
        const eventId = createdId ||
          ((isValidId(params.id) && matched && matched.route.pattern.startsWith('/api/events/:id')) ? params.id : bodyEventId);
        credentials.audit({
          actor: 'AI', action: 'api', keyId: key.id, method: req.method,
          route: matched ? matched.route.pattern : req.path.slice(0, 200),
          eventId: eventId || undefined, status: res.statusCode
        });
        const deleted = matched && matched.route.method === 'DELETE' && matched.route.pattern === '/api/events/:id';
        if (!isRead && matched && !deleted && res.statusCode >= 200 && res.statusCode < 300 && eventId &&
            fs.existsSync(path.join(EVENTS_DIR, `${eventId}.json`))) {
          const summary = aiHistorySummary(req, res, matched, eventId);
          appendHistory(eventId, {
            action: 'ai_api',
            detail: (req.method + ' ' + matched.route.pattern + (summary ? ' ' + summary : '')).slice(0, 500)
          }, principal);
        }
      } catch (e) {
        console.error('AI の操作の記録に失敗: ' + e.message);
      }
    };
    // 回数制限（キーごと。D9）。429 で拒んだ要求は数えない（このあとの認可の 403 などで拒んだ要求は数える）
    const dayKey = 'ai-day:' + key.id + ':' + credentialsLib.jstDateOf(Date.now());
    let wait = limiter.check('ai-min:' + key.id, lim.perMinute, MINUTE_MS);
    if (!wait && !isRead) wait = limiter.check('ai-wmin:' + key.id, lim.writesPerMinute, MINUTE_MS);
    if (!wait && limiter.check(dayKey, lim.perDay, 24 * 60 * MINUTE_MS)) wait = secondsUntilJstMidnight();
    if (wait) return sendRateLimited(res, wait);
    limiter.hit('ai-min:' + key.id, MINUTE_MS);
    if (!isRead) limiter.hit('ai-wmin:' + key.id, MINUTE_MS);
    limiter.hit(dayKey, 24 * 60 * MINUTE_MS);
    credentials.recordAiUse(key);
  }

  if (isCrossOrigin(req, principal, { publicOrigin: PUBLIC_ORIGIN, production: IS_PRODUCTION })) {
    return res.status(403).json({ error: '別のサイトからの操作は受け付けません', reason: 'origin' });
  }
  if (isPublicApi(req.method, p)) return next();
  const denied = authz.authorize(principal, matched, { loadEvent: loadEventForAuthz });
  if (denied) return authz.sendDeny(res, denied);
  next();
});

// POST /api/join : 招待の鍵をセッション Cookie に交換する（無認証。設計書 5.1）
// express.json（50mb）より前に、2kb の本文だけを読む形で登録する（無認証の大きな本文を読まない）。
// 鍵は本文の key だけから読む（クエリの ?k= は読まない。ログに残る経路を作らない）。
//   confirm: false … 下見。セッションも Cookie も作らない（リンクの下見で端末が登録されないように）
//   confirm: true  … 端末数に空きがあればセッションを作って Set-Cookie
const joinJson = express.json({ limit: '2kb' });
const JOIN_ERRORS = {
  key_invalid: 'この QR は読み取れませんでした',
  invite_revoked: 'この QR は取り消されています',
  invite_expired: 'この QR は期限切れです'
};
app.post('/api/join', (req, res) => {
  res.set('Cache-Control', 'no-store');
  joinJson(req, res, err => {
    if (err) {
      return res.status(err.status === 413 ? 413 : 400).json({ error: '本文が不正です', reason: 'bad_request' });
    }
    try {
      handleJoin(req, res);
    } catch (e) {
      console.error('join の処理に失敗: ' + e.message);
      res.status(500).json({ error: '登録に失敗しました' });
    }
  });
});

// 速度制限（設計書 3.6）。数えるのは「鍵の照合が通らない」失敗だけ。
//   - 正しい鍵（登録・下見）は止めない（鍵なしの連打で全員の登録が止まらないように）
//   - 照合は通ったが使えない鍵（取り消し・期限切れ）は、上限中でも本来の理由を返す。監査ログは IP ごと 10 回/分まで
//   - 照合が通らない鍵は IP ごと 10 回/分（超えたら 1 分止める）と、全体（全 IP の合計）30 回/分
// 秘密は 256 ビットなので、上限中に正しい鍵だけ通しても総当たりの助けにはならない。
const JOIN_FAIL_PER_IP = 10;
const JOIN_FAIL_ALL = 30;
function handleJoin(req, res) {
  const ip = req.ip;
  const failKey = 'join-fail:' + ip;
  const allKey = 'join-fail-all';

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const confirm = body.confirm === true;
  const r = credentials.checkInviteKey(typeof body.key === 'string' ? body.key : '');
  if (!r.ok) {
    if (!r.invite) {
      const wait = limiter.check(failKey, JOIN_FAIL_PER_IP, MINUTE_MS) || limiter.check(allKey, JOIN_FAIL_ALL, MINUTE_MS);
      if (wait) return sendRateLimited(res, wait);
      limiter.hitAndBlock(failKey, JOIN_FAIL_PER_IP, MINUTE_MS, MINUTE_MS);
      limiter.hit(allKey, MINUTE_MS);
      credentials.audit({ actor: 'anonymous', action: 'join.fail', reason: r.reason, ip: ip });
    } else {
      const auditKey = 'join-known:' + ip;
      if (!limiter.check(auditKey, 10, MINUTE_MS)) {
        limiter.hit(auditKey, MINUTE_MS);
        credentials.audit({ actor: 'anonymous', action: 'join.fail', reason: r.reason, inviteId: r.invite.id, ip: ip });
      }
    }
    const out = { error: JOIN_ERRORS[r.reason], reason: r.reason };
    if (r.reason === 'invite_expired') out.expiresAt = r.invite.expiresAt;
    return res.status(401).json(out);
  }

  const inv = r.invite;
  const event = loadEventSync(inv.eventId) || {};
  const nowIso = new Date().toISOString();
  const info = {
    role: inv.role, eventId: inv.eventId, eventName: event.name || '', court: inv.court,
    label: inv.label, expiresAt: inv.expiresAt, now: nowIso
  };
  // Cookie にある有効なセッション（この端末の今の登録）。
  //   同じ招待 … 入り直し。古いセッションを取り消してから新しいセッションを作る（数を増やさない。ID は必ず新しく作る）
  //   別の招待 … 乗り換え。登録できたら前の招待のセッションも取り消す（前の招待の枠を使い続けない。監査 reason: 'switch'）
  const current = parseCookies(req.headers.cookie)
    .filter(c => c.name === COOKIE_NAME)
    .map(c => credentials.verifySessionCookie(c.value))
    .filter(v => v.ok)
    .map(v => v.session);
  const mine = current.filter(s => s.inviteId === inv.id);
  const others = current.filter(s => s.inviteId !== inv.id);
  const active = credentials.activeSessionCount(inv.id);
  const devices = { active: active, max: inv.maxDevices };
  if (!confirm) {
    return res.json(Object.assign(info, { devices: devices, rejoin: mine.length > 0, switching: others.length > 0 }));
  }

  if (active - mine.length >= inv.maxDevices) {
    credentials.audit({ actor: 'anonymous', action: 'join.fail', reason: 'device_limit', inviteId: inv.id, ip: ip });
    return res.status(409).json({
      error: 'この QR で登録できる端末の数に達しています', reason: 'device_limit', devices: devices
    });
  }
  mine.forEach(s => {
    credentials.revokeSession(s.id);
    credentials.audit({ actor: 'scorer', action: 'session.revoke', reason: 'rejoin', inviteId: inv.id, sessionId: s.id });
  });
  others.forEach(s => {
    credentials.revokeSession(s.id);
    credentials.audit({
      actor: 'scorer', action: 'session.revoke', reason: 'switch', inviteId: s.inviteId, sessionId: s.id, toInviteId: inv.id
    });
  });
  const created = credentials.createSession(inv, req.headers['user-agent']);
  credentials.audit({
    actor: 'scorer', action: 'session.create', inviteId: inv.id, sessionId: created.session.id,
    ip: ip, ua: created.session.device.summary
  });
  // Max-Age は期限 + 掃除までの保持期間（30 日）。期限の瞬間にブラウザが Cookie を消すと、サーバーが
  // session_expired を返せず「認証が必要です」（運営のパスワード欄）になるため。期限の判定はサーバーがする。
  res.set('Set-Cookie', buildSessionCookie(COOKIE_NAME, created.cookieValue,
    (Date.parse(inv.expiresAt) - Date.now() + SESSION_COOKIE_GRACE_MS) / 1000, COOKIE_SECURE));
  const next = '/scoring.html#event/' + encodeURIComponent(inv.eventId) +
    (inv.court ? '/' + encodeURIComponent(inv.court) : '');
  res.json(Object.assign(info, { next: next }));
}

// POST /api/session/logout : この端末の登録を解除する（自分の Cookie だけ。本文は読まない）
// そのセッションに revokedAt を書き、Cookie を消す。HTML のフォーム（401/403 のページ）から来たら 303 で / へ。
app.post('/api/session/logout', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    parseCookies(req.headers.cookie).filter(c => c.name === COOKIE_NAME).forEach(c => {
      const t = credentialsLib.parseToken('session', c.value);
      if (!t) return;
      const s = credentials.getSession(t.id);
      if (!s || !credentialsLib.verifySecret(t.secret, s.secretHash)) return;
      if (!s.revokedAt) {
        credentials.revokeSession(s.id);
        credentials.audit({ actor: 'scorer', action: 'session.revoke', reason: 'logout', inviteId: s.inviteId, sessionId: s.id });
      }
    });
    res.set('Set-Cookie', buildSessionCookie(COOKIE_NAME, '', 0, COOKIE_SECURE));
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (ct.startsWith('application/x-www-form-urlencoded')) return res.redirect(303, '/');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ペイロードサイズ制限を緩和
app.use(express.json({ limit: '50mb' }));

// AI（Bearer）だけ、本文を読み終えた直後に認可をもう一度（同期）。
// express.json は非同期なので、本文をゆっくり送っている間に運営が大会名を「テスト用」から本番の名前に
// 変えると、最初の判定（本文を読む前）だけでは本番の大会に書けてしまう。ここからハンドラの同期の検査・書き込みまでは
// 割り込まれない。
app.use((req, res, next) => {
  const principal = req.principal;
  if (!principal || principal.kind !== 'ai') return next();
  const p = req.path.toLowerCase();
  if (!p.startsWith('/api/') || isPublicApi(req.method, p)) return next();
  const denied = authz.authorize(principal, authz.matchRoute(req.method, req.path), { loadEvent: loadEventForAuthz });
  if (denied) return authz.sendDeny(res, denied);
  next();
});

// ── セッション・招待・AI 用キーの API（設計書 2026-10-03 5.1。認可は server/authz.js の表） ──

// GET /api/session : 今の主体（誰でも）。採点画面は role: 'scorer' のとき採点専用モードにする。
app.get('/api/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const pr = req.principal || {};
  const out = { role: 'none', via: null, scope: null, label: null, expiresAt: null, now: new Date().toISOString(), reason: null };
  if (pr.kind === 'admin') {
    out.role = 'admin';
    out.via = pr.via;
  } else if (pr.kind === 'scorer') {
    const ev = loadEventSync(pr.eventId) || {};
    out.role = 'scorer';
    out.via = 'session';
    out.scope = { eventId: pr.eventId, eventName: ev.name || '', court: pr.court };
    out.label = pr.label;
    out.expiresAt = pr.expiresAt;
  } else if (pr.kind === 'ai') {
    out.role = 'ai';
    out.via = 'bearer';
    out.label = pr.label;
    out.expiresAt = pr.expiresAt;
  } else {
    out.reason = pr.reason || 'auth_required';
  }
  res.json(out);
});

// 招待を一覧の形にする（大会名を足す）
function inviteListItem(inv) {
  const ev = loadEventSync(inv.eventId);
  return credentials.inviteView(inv, ev ? (ev.name || '') : null);
}

// POST /api/invites : 採点の招待を発行する（運営）。key を返すのはこの 1 回だけ。
// 本文: { role: 'scorer', eventId, court: 'A' | null, label?, expiresAt?, expiresPreset?, maxDevices? }
//   expiresPreset … 'event'（既定。大会の日の終わり、日付が無い・過去なら今日の終わり）/ 'today' / 'tomorrow'。
//                   画面が端末の時計で日付を計算しないための追加（T7）。expiresAt があればそちらが優先。
app.post('/api/invites', (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    if (body.role !== 'scorer') {
      return res.status(400).json({ error: '発行できるのは採点の招待だけです', reason: 'bad_role' });
    }
    if (!isValidId(body.eventId)) {
      return res.status(400).json({ error: '不正な大会IDです', reason: 'bad_event' });
    }
    const event = loadEventSync(body.eventId);
    if (!event) return res.status(404).json({ error: '大会が見つかりません' });

    let court = null;
    if (body.court !== null && body.court !== undefined && body.court !== '') {
      const courts = new Set((event.settings && Array.isArray(event.settings.courts)) ? event.settings.courts : []);
      (Array.isArray(event.players) ? event.players : []).forEach(p => { if (p) courts.add(courtOf(p)); });
      if (!isValidCourt(body.court) || !courts.has(body.court)) {
        return res.status(400).json({ error: 'この大会に無いコートです', reason: 'unknown_court' });
      }
      court = body.court;
    }

    if (body.label !== undefined && typeof body.label !== 'string') {
      return res.status(400).json({ error: 'ラベルが不正です', reason: 'bad_label' });
    }
    let label = credentialsLib.cleanLabel(body.label);
    if (label.length > credentialsLib.constants.LABEL_MAX) {
      return res.status(400).json({ error: 'ラベルは 40 文字までです', reason: 'bad_label' });
    }
    if (!label) label = court === null ? '全コート' : court + ' コート';

    const C = credentialsLib.constants;
    let maxDevices = C.DEFAULT_MAX_DEVICES;
    if (body.maxDevices !== undefined) {
      if (!Number.isInteger(body.maxDevices) || body.maxDevices < 1 || body.maxDevices > C.MAX_DEVICES_LIMIT) {
        return res.status(400).json({ error: '端末の数は 1〜5 です', reason: 'bad_max_devices' });
      }
      maxDevices = body.maxDevices;
    }

    const nowMs = Date.now();
    let expires;
    if (body.expiresAt !== undefined) {
      expires = credentialsLib.parseExpiry(body.expiresAt, nowMs, C.INVITE_MIN_MS, C.INVITE_MAX_MS);
    } else {
      // 型の期限は「今より後」と上限 7 日だけを見る（23:55 に発行した「今日の終わり」も通す）。
      // 大会の日が 7 日より先なら断る（その日が近づいてから発行する）
      expires = credentialsLib.inviteExpiryFromPreset(body.expiresPreset, event.date, nowMs);
      if (expires && (expires.getTime() <= nowMs || expires.getTime() > nowMs + C.INVITE_MAX_MS)) {
        expires = null;
      }
    }
    if (!expires) {
      return res.status(400).json({ error: '期限は今から 10 分後〜7 日後で指定してください', reason: 'bad_expiry' });
    }

    const created = credentials.createInvite({
      role: 'scorer', eventId: body.eventId, court: court, label: label,
      expiresAt: expires.toISOString(), maxDevices: maxDevices
    });
    credentials.audit({
      actor: auditActor(req.principal), action: 'invite.create', inviteId: created.invite.id,
      eventId: body.eventId, court: court
    });
    res.set('Cache-Control', 'no-store');
    res.status(201).json({
      invite: inviteListItem(created.invite),
      key: created.key,
      joinPath: '/join#k=' + created.key
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invites?eventId=… : 招待と端末の一覧（運営）。secretHash・鍵は返さない。新しい順。
app.get('/api/invites', (req, res) => {
  try {
    const eventId = typeof req.query.eventId === 'string' && req.query.eventId !== '' ? req.query.eventId : null;
    const list = credentials.listInvites()
      .filter(inv => eventId === null || inv.eventId === eventId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(inviteListItem);
    res.set('Cache-Control', 'no-store');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invites/:id/revoke : 招待を取り消す（運営）。その招待で登録した全端末が次のリクエストから 401。
app.post('/api/invites/:id/revoke', (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: '不正な招待IDです' });
    const r = credentials.revokeInvite(req.params.id, 'manual');
    if (!r) return res.status(404).json({ error: '招待が見つかりません' });
    credentials.audit({
      actor: auditActor(req.principal), action: 'invite.revoke', reason: 'manual',
      inviteId: req.params.id, eventId: r.invite.eventId, revokedSessions: r.revokedSessions
    });
    res.json({ success: true, revokedSessions: r.revokedSessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions/:id/revoke : その端末だけ外す（運営）
app.post('/api/sessions/:id/revoke', (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: '不正な端末IDです' });
    const s = credentials.revokeSession(req.params.id);
    if (!s) return res.status(404).json({ error: '端末が見つかりません' });
    credentials.audit({
      actor: auditActor(req.principal), action: 'session.revoke', reason: 'manual',
      inviteId: s.inviteId, sessionId: s.id
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-keys : AI 用キーを発行する（運営）。key を返すのはこの 1 回だけ。
// 本文: { label, expiresAt?, expiresInDays?, limits? }
//   既定の期限は 30 日後の日本時間の終わり、上限 90 日（D10）。expiresInDays（1〜90）はその日数後の日の終わり
//   （画面が端末の時計で日付を計算しないための追加）。limits は { perMinute, writesPerMinute, perDay }（D9）。
app.post('/api/ai-keys', (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const C = credentialsLib.constants;
    if (body.label !== undefined && typeof body.label !== 'string') {
      return res.status(400).json({ error: 'ラベルが不正です', reason: 'bad_label' });
    }
    const label = credentialsLib.cleanLabel(body.label);
    if (!label || label.length > C.LABEL_MAX) {
      return res.status(400).json({ error: 'ラベルは 1〜40 文字で指定してください', reason: 'bad_label' });
    }
    const nowMs = Date.now();
    const maxEnd = credentialsLib.endOfJstDayPlus(nowMs, C.AI_KEY_MAX_DAYS).getTime();
    let expires = null;
    if (body.expiresAt !== undefined) {
      expires = credentialsLib.parseExpiry(body.expiresAt, nowMs, C.INVITE_MIN_MS, maxEnd - nowMs);
    } else if (body.expiresInDays !== undefined) {
      if (Number.isInteger(body.expiresInDays) && body.expiresInDays >= 1 && body.expiresInDays <= C.AI_KEY_MAX_DAYS) {
        expires = credentialsLib.endOfJstDayPlus(nowMs, body.expiresInDays);
      }
    } else {
      expires = credentialsLib.endOfJstDayPlus(nowMs, C.AI_KEY_DEFAULT_DAYS);
    }
    if (!expires) {
      return res.status(400).json({ error: '期限は今から 10 分後〜90 日後で指定してください', reason: 'bad_expiry' });
    }
    const limits = credentialsLib.normalizeAiLimits(body.limits);
    if (!limits) {
      return res.status(400).json({ error: '回数の上限が不正です', reason: 'bad_limits' });
    }
    const created = credentials.createAiKey({ label: label, expiresAt: expires.toISOString(), limits: limits });
    credentials.audit({ actor: auditActor(req.principal), action: 'aikey.create', keyId: created.aiKey.id });
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ aiKey: credentials.aiKeyView(created.aiKey), key: created.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-keys : AI 用キーの一覧（運営）。新しい順。secretHash・キーは返さない。
app.get('/api/ai-keys', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(credentials.listAiKeys()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(credentials.aiKeyView));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-keys/:id/revoke : AI 用キーを取り消す（運営）。次の呼び出しから 401 key_revoked。
app.post('/api/ai-keys/:id/revoke', (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: '不正なキーIDです' });
    const k = credentials.revokeAiKey(req.params.id);
    if (!k) return res.status(404).json({ error: 'キーが見つかりません' });
    credentials.audit({ actor: auditActor(req.principal), action: 'aikey.revoke', keyId: k.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/whoami : AI 用キーの確認（AI だけ）。残りの回数はこの呼び出しを数えたあとの値。
app.get('/api/ai/whoami', (req, res) => {
  const pr = req.principal;
  const lim = pr.key.limits || credentialsLib.constants.DEFAULT_AI_LIMITS;
  res.set('Cache-Control', 'no-store');
  res.json({
    keyId: pr.keyId,
    label: pr.label,
    expiresAt: pr.expiresAt,
    now: new Date().toISOString(),
    limits: Object.assign({}, lim),
    remaining: {
      minute: limiter.remaining('ai-min:' + pr.keyId, lim.perMinute),
      writesMinute: limiter.remaining('ai-wmin:' + pr.keyId, lim.writesPerMinute),
      day: limiter.remaining('ai-day:' + pr.keyId + ':' + credentialsLib.jstDateOf(Date.now()), lim.perDay)
    },
    sandboxPrefix: authz.SANDBOX_PREFIX
  });
});

// ────────────────────────────────────────
// API ルート
// ────────────────────────────────────────

// 【不変条件】以下の書き込み系ハンドラは同期のまま維持すること。
// 同期 fs + 単一スレッドにより read-modify-write が不可分になっており、
// これが複数端末からの同時採点の安全性を担保している。
// async 化して await を挟むと、コートごとの端末が同時に採点したとき
// 更新が失われる。非同期化する場合は大会IDごとの書き込みロックを併せて導入すること。
// test.html の「並行PATCH12本が全件反映される」がこの不変条件の番人。
//
// 対象:
//   POST   /api/events
//   PATCH  /api/events/:id
//   DELETE /api/events/:id
//   POST   /api/events/:id/players
//   PATCH  /api/events/:id/players/:playerId
//   DELETE /api/events/:id/players/:playerId
//   POST   /api/events/:id/rounds/2/generate
//   POST   /api/events/:id/import
//   POST   /api/events/import      （大会ファイルの取り込み。新しい ID で作る）
//   POST   /api/events/:id/history
//   PUT    /api/events/:id/live/:court
//   POST   /api/links               （大会ファイルに shareToken を書き込む）
//   POST   /api/techniques / DELETE /api/techniques
//   PUT    /api/events/:id/techniques / DELETE /api/events/:id/techniques
// ── Event API ──

// GET /api/events : 大会一覧
// 採点の鍵の端末には自分の大会 1 件だけを返す。AI には各行に sandbox（名前が「テスト用」で始まる）と
// createdByAi を足す（設計書 2026-10-03 5.2 の 1）。
app.get('/api/events', (req, res) => {
  try {
    const pr = req.principal || {};
    let files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
    if (pr.kind === 'scorer') files = files.filter(f => f === `${pr.eventId}.json`);
    const events = files.map(file => {
      const data = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, file), 'utf-8'));
      const row = {
        id: data.id,
        name: data.name,
        date: data.date,
        venue: data.venue,
        // 人数は一巡目の行の数（二巡目の行は同じ人のもう 1 行。行数を出すと 70 名に見えた。ユーザー指摘 2026-10-06）
        playerCount: Array.isArray(data.players) ? data.players.filter(p => p && typeof p === 'object' && EventStatus.roundOf(p) === 1).length : 0,
        // ファイルに status が無ければ選手から推定する（ファイルには書かない）
        status: EventStatus.of(data),
        updatedAt: data.updatedAt,
        createdAt: data.createdAt,
        // テスト大会の印（既定 false。設計書「テスト大会」。一覧では既定非表示にするための印）
        test: data.test === true
      };
      if (pr.kind === 'ai') {
        row.sandbox = authz.isSandboxEvent(data);
        row.createdByAi = data.createdBy === 'ai';
      }
      return row;
    });
    // updatedAt 降順ソート
    events.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id : 大会詳細
app.get('/api/events/:id', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const filePath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // 有効な技リストは応答にだけ足す（ファイルには書かない）。
    // techniques を持たない大会（この機能より前に作られた大会）は雛形で動き続ける。
    data.techniquesSource = techniquesSourceOf(data);
    data.techniques = effectiveTechniques(data);
    // 状態も応答にだけ足す。status を持たない大会は選手から推定した値を返す。
    data.status = EventStatus.of(data);
    // テスト大会の印（既定 false。ファイルに無ければ false のまま返す）。
    data.test = data.test === true;
    // AI には砂場（AI が書き込めるか）を足す（設計書 2026-10-03 5.4）
    if (req.principal && req.principal.kind === 'ai') data.sandbox = authz.isSandboxEvent(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 選手1件を保存用に洗う共通部分。POST /api/events の丸ごと保存とバンドル取り込みの
// 両方から呼ぶ（全体点検 A-14: 二重実装の解消）。id・bib・sourcePlayerId は呼び出し元ごとに
// 検証・採番の規則が違う（バンドル取り込みは id を振り直し、bib はゼッケン重複解決を経る）ため、
// 呼び出し元で検証・解決済みの値をそのまま渡してもらう（bib は null なら出力に含めない。
// sourcePlayerId も同様）。ここに無いキー（order 以外の運営専用の値、__proto__ 等）は
// 出力に出ない＝保存されない。
// score は PATCH .../players/:playerId と同じ規則: 採点画面が送る値は常に整数
// （Scoring.calcTotalScore が toInt で丸める）なので、-9999〜9999 の整数だけ受理し、
// それ以外（1e9 や小数など）は 0 に丸める。
// 得点・補正点の範囲（網羅検証 S4。設計書 2026-10-01 8 章）。
// 得点は採点画面が送る合計（Scoring.calcTotalScore が toInt で丸める整数）。
// 補正点は採点画面の入力欄で ±999 に制限する。PATCH は範囲外を 400 で丸ごと拒み、
// 取り込み系（sanitizePlayerForSave）は黙って落とす。
function isValidScore(v) {
  return Number.isInteger(v) && v >= -9999 && v <= 9999;
}
function isValidAdjust(v) {
  return Array.isArray(v) && v.length === 3 && v.every(n => Number.isInteger(n) && n >= -999 && n <= 999);
}
function isValidTotalAdjust(v) {
  return Number.isInteger(v) && v >= -999 && v <= 999;
}
// 更新前の採点画面（baseRev を送らない）の補正点を ±999 に丸める（PATCH の互換。レビュー指摘 9）。
// 整数でない値・長さの違う配列は触らない（形の検査で従来どおり 400）。得点は丸めた分を差し引く
// （得点 ＝ Σ 行の得点 ＋ 全体補正で、補正点は線形に足されるため）。body をその場で書き換える。
function clampLegacyAdjust(body) {
  const clamp = n => Math.max(-999, Math.min(999, n));
  let delta = 0;
  if (Array.isArray(body.adjust) && body.adjust.length === 3 && body.adjust.every(n => Number.isInteger(n))) {
    const next = body.adjust.map(clamp);
    for (let i = 0; i < 3; i++) delta += body.adjust[i] - next[i];
    body.adjust = next;
  }
  if (Number.isInteger(body.totalAdjust)) {
    const t = clamp(body.totalAdjust);
    delta += body.totalAdjust - t;
    body.totalAdjust = t;
  }
  if (delta !== 0 && Number.isInteger(body.score)) body.score -= delta;
}

function sanitizePlayerForSave(p, id, bib, sourcePlayerId) {
  const out = {
    id: id,
    name: typeof p.name === 'string' ? p.name.trim().slice(0, 100) : '',
    order: typeof p.order === 'string' ? p.order.slice(0, 40) : '',
    tech1: typeof p.tech1 === 'string' ? p.tech1.trim().slice(0, 50) : '',
    tech2: typeof p.tech2 === 'string' ? p.tech2.trim().slice(0, 50) : '',
    tech3: typeof p.tech3 === 'string' ? p.tech3.trim().slice(0, 50) : '',
    // 得点は整数。小数（旧 CSV 取り込みの名残）は切り捨て、範囲外や数値でないものは 0
    score: (Number.isFinite(p.score) && p.score >= -9999 && p.score <= 9999) ? Math.trunc(p.score) : 0,
    isNewFace: p.isNewFace === true,
    isFemale: p.isFemale === true,
    // 結果は 1=○, 0=×, 2=△（減点成功）, 空白=未入力 のエンコード。それ以外は捨てる
    // （採点画面の decodeResult が読めない文字列を保存しない）。
    result: (typeof p.result === 'string' && p.result.length <= 100 && /^[012 ]*$/.test(p.result))
      ? p.result : '',
    rank: EventStatus.normalizeRank(typeof p.rank === 'string' ? p.rank.trim().slice(0, 20) : ''),
    rental: p.rental === true
  };
  // 補正点は行・全体とも -999〜999 の整数（PATCH の isValidAdjust / isValidTotalAdjust と同じ。
  // 網羅検証 S4）。範囲外は取り込まない（黙って落とす。取り込み系の流儀）。
  if (isValidAdjust(p.adjust)) out.adjust = p.adjust.slice();
  if (isValidTotalAdjust(p.totalAdjust)) out.totalAdjust = p.totalAdjust;
  if (typeof p.note === 'string') {
    const note = p.note.trim().slice(0, 200);
    if (note) out.note = note;
  }
  if (p.confirmed === true) out.confirmed = true;
  // 旧データの印（二巡目の行の決戦の印）は写さない（大会の保存・バンドル取り込み・CSV 取り込みで落とす。設計書 2026-10-05 D2）
  if (bib !== null && bib !== undefined) out.bib = bib;
  if (sourcePlayerId) out.sourcePlayerId = sourcePlayerId;
  // 二巡目の形の申請（設計書 2026-10-03 3.1）。技と同じ規則（trim・50 字）で洗い、一巡目の行で
  // 正規化の後に 1 つでも空でないときだけ残す（二巡目の行・一巡目と同じ形の申請はキーごと落とす）。
  R2_TECH_KEYS.forEach(k => { out[k] = typeof p[k] === 'string' ? p[k].trim().slice(0, 50) : ''; });
  applyRound2Techs(out);
  return out;
}

// ── 二巡目の形の申請（設計書 2026-10-03-round2-forms-prereg-design.md） ──
// 一巡目の行の r2tech1〜3。3 つとも空ならキーごと持たない（= 一巡目と同じ形）。版（rev）の項目ではない。
const R2_TECH_KEYS = EventStatus.R2_TECH_KEYS;

// 行の r2tech1〜3 を正規化して置き直す（2.3）。一巡目の行でない・申請が無い・tech1〜3 と 3 つとも
// 同じならキーを消す。それ以外は trim した 3 つ（空の枠は ''）を書く。p をその場で書き換える。
function applyRound2Techs(p) {
  const norm = EventStatus.roundOf(p) === 1 ? EventStatus.normalizedRound2Techs(p) : null;
  R2_TECH_KEYS.forEach((k, i) => {
    if (norm) p[k] = norm[i];
    else delete p[k];
  });
}

// 二巡目の形の検証（bulk rows。設計書 3.1）。戻り値はエラー文言（行番号は呼び出し側が付ける）か null。
// 規則は一巡目の技と同じ: 表に無い技名・レンタルなら drawn だけ・repeatable でない形の 2 回以上
// （接尾辞は同じ形として数える）。courts.js の parsePasteRow（techIssues）と同じ順・同じ文言:
// 表に無い技名を全部（「」でつなぐ）→ レンタル → 同じ形（レビュー指摘 2026-10-03 で順をそろえた）。
function checkRound2Techs(techList, techs, isFemale, rental) {
  const unknown = [];
  for (const t of techs) {
    if (t && !resolveTechnique(techList, t, isFemale) && unknown.indexOf(t) === -1) unknown.push(t);
  }
  if (unknown.length > 0) return `二巡目の技「${unknown.join('」「')}」は技リストにありません`;
  const formCounts = Object.create(null);
  let dupForm = '';
  for (const t of techs) {
    if (!t) continue;
    const resolved = resolveTechnique(techList, t, isFemale);
    if (rental && resolved.drawn !== true) return '二巡目の形: ' + RENTAL_DRAWN_ONLY;
    if (resolved.repeatable !== true) {
      const display = stripGenderSuffix(resolved.name);
      formCounts[display] = (formCounts[display] || 0) + 1;
      if (formCounts[display] >= 2 && !dupForm) dupForm = display;
    }
  }
  if (dupForm) return `二巡目の形: 同じ形は 1 回までです（${dupForm}）`;
  return null;
}

// 本文の r2tech1〜3 を読む（POST の 1 名追加・bulk rows）。文字列でなければ ''。trim する。
function readRound2Techs(body) {
  return R2_TECH_KEYS.map(k => (typeof (body && body[k]) === 'string' ? body[k].trim() : ''));
}

// POST /api/events の body の players を保存用に洗う。
// PATCH .../players/:playerId や CSV/バンドル取り込みと同程度の検証（型が違えば既定に落とす）。
// id が isValidId を通らない要素は丸ごと落とす（他の選手の行を装った上書きを防ぐ）。
function sanitizeEventPlayersForSave(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(p => p && typeof p === 'object' && !Array.isArray(p) && isValidId(p.id))
    .map(p => {
      const bib = (Number.isInteger(p.bib) && p.bib >= 1 && p.bib <= 9999) ? p.bib : null;
      const sourcePlayerId = isValidId(p.sourcePlayerId) ? p.sourcePlayerId : null;
      return sanitizePlayerForSave(p, p.id, bib, sourcePlayerId);
    });
}

// POST /api/events : 大会作成・更新
// body を丸ごと信用しない。ここで書き出す event オブジェクトはこの関数が組み立てた
// フィールドだけを持つ（許すキーは id/name/date/venue/createdAt/updatedAt/players/
// techniques/settings/status/shareToken/test/createdBy。live はこの経路では書かない）。
// AI（Bearer）は新規作成だけ（id を送れば 403 sandbox）、名前は「テスト用」で始まるものだけ。
// AI が作った大会には test: true と createdBy: 'ai' を付ける（設計書 2026-10-03 5.4・D12）。
// body にしか無い未知のキー（live・techniquesSource・その他）は最初から event に
// コピーしないので、自然に落ちる。
app.post('/api/events', (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const isAi = !!(req.principal && req.principal.kind === 'ai');
    // AI に既存の大会を丸ごと上書きさせない（新規作成だけ）
    if (isAi && body.id !== undefined) {
      return res.status(403).json({ error: 'AI は大会 ID を指定して保存できません（新規作成だけ）', reason: 'sandbox' });
    }

    let id = body.id;
    if (!id) {
      id = generateId();
    } else if (!isValidId(id)) {
      return res.status(400).json({ error: '不正な大会IDです' });
    }

    const eventPath = path.join(EVENTS_DIR, `${id}.json`);
    const exists = fs.existsSync(eventPath);
    let prev = null;
    if (exists) {
      try {
        prev = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
      } catch (e) {
        prev = null;   // 壊れた既存ファイルは上書きを止めない（引き継ぎも行わない）
      }
    }
    // 確定済みの大会を丸ごと上書きさせない（得点・選手・技が消える）
    if (prev && rejectIfLocked(res, prev)) return;

    // name / date / venue は PATCH /api/events/:id と同じ検証・切り詰め。
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      return res.status(400).json({ error: '大会名が不正です（1〜100文字）' });
    }
    if (rejectAiCreate(req, res, name)) return;
    const date = typeof body.date === 'string' ? body.date.slice(0, 20) : '';
    const venue = typeof body.venue === 'string' ? body.venue.slice(0, 100) : '';

    const now = new Date().toISOString();
    const event = {
      id: id,
      name: name,
      date: date,
      venue: venue,
      // 既存 ID への上書きは元の createdAt を優先する（body.createdAt は取り込み時などに
      // 送られてくる程度で、実在する大会の作成日時としては prev の方が正）。
      createdAt: (prev && typeof prev.createdAt === 'string' && prev.createdAt) ||
        (typeof body.createdAt === 'string' && body.createdAt) || now,
      updatedAt: now,
      players: sanitizeEventPlayersForSave(body.players)
    };
    // 選手の版（rev）は body から受け取らない（sanitizePlayerForSave が落とす）。既存の行を
    // 上書きするときは、元の行の版を引き継ぎ、採点に関わる値が変わっていれば +1 する
    // （丸ごとの保存を挟んでも採点画面の衝突検出が効くように。設計書 2026-10-01 1.1）。
    if (prev && Array.isArray(prev.players)) {
      const prevById = Object.create(null);
      prev.players.forEach(p => { if (p && isValidId(p.id)) prevById[p.id] = p; });
      event.players.forEach(p => {
        const old = prevById[p.id];
        if (!old) return;
        const rev = EventStatus.revOf(old) + (revFieldsDiffer(old, p) ? 1 : 0);
        if (rev > 0) p.rev = rev;
      });
    }

    // status はこの経路では変えない。状態を変える経路は POST /api/events/:id/status だけ。
    // body に status が入っていても無視する。既存の大会が status を持っていればその値を
    // そのまま引き継ぎ、持たない大会（この機能より前に作られた・取り込んだ大会）は
    // 書かずに推定のままにする（EventStatus.of が読み出しのたびに選手から推定する）。
    // ここで推定値を書き込んでしまうと、「status の無い大会」という区別が消え、
    // 以後は常にこの POST 時点の推定値に固定されてしまう。新規作成のときだけ draft。
    // 旧データの状態名は今の状態名に直して書く（EventStatus.normalizeStatus。設計書 2026-10-05 2.2）。
    if (!exists) {
      event.status = 'draft';
    } else if (prev && EventStatus.STATES.indexOf(EventStatus.normalizeStatus(prev.status)) !== -1) {
      event.status = EventStatus.normalizeStatus(prev.status);
    }
    // test（テスト大会の印）も同じ理由でこの経路では変えない。body に入っていても無視し、
    // 既存の大会が test:true を持っていればそのまま引き継ぐ（テンプレート API だけが true にする）。
    if (prev && prev.test === true) event.test = true;
    // createdBy（誰が作ったか。今は AI が作った大会の 'ai' だけ）も test と同じ扱い。body は無視して引き継ぐ
    if (prev && typeof prev.createdBy === 'string') event.createdBy = prev.createdBy;
    if (isAi && !exists) {
      event.test = true;
      event.createdBy = 'ai';
    }

    // shareToken は body から常に捨てる（他の大会の shareToken を書き込めると、その大会を
    // 削除したときに無関係な大会の共有 URL が孤児のまま生き残る）。既存の値だけを引き継ぐ。
    if (prev && isValidId(prev.shareToken)) {
      event.shareToken = prev.shareToken;
    }
    // live（配信用ボードのコートごとの状態）は shareToken と違ってこの経路では扱わない。
    // 名簿を入れ直した大会の live には、もう居ない選手の playerId が残りうる。
    // 落としても配信用ボードが数秒「待機中」になるだけで、コート端末の次の
    // publishLive がすぐ入れ直す（トークンのように配布済みで失うと困る値ではない）。

    // settings（ゼッケン・級位段位の必須・コート一覧）。{ requireBib, requireRank, courts }
    // だけを抽出する（他のキーは無視。真偽値でなければ false）。courts は不正なら 400 で断る。
    // body に settings が無いときは techniques と同じく既存の値を引き継ぐ。
    if (body.settings !== undefined) {
      const rawSettings = body.settings;
      const s = (rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) ? rawSettings : {};
      const courtsInput = Array.isArray(s.courts) ? s.courts : [];
      const courtsErr = validateCourtList(courtsInput);
      if (courtsErr) return res.status(400).json({ error: courtsErr });
      // finalCourt（2026-09-22 の決戦コートの名前）は廃止。届いても保存しない（設計書 2026-09-28）。
      // mixed（男女を分けずに進める）は既存の大会では本文の値を無視して引き継ぐ。この経路には
      // 準備中だけのガード（409 mixed_locked）も出走順の振り直しも無いので、ここで変わると
      // 試合開始の後でも設定だけが変わり、order と食い違う。変更は PATCH /api/events/:id だけ。
      const mixed = prev ? !!(prev.settings && prev.settings.mixed === true) : s.mixed === true;
      event.settings = { requireBib: s.requireBib === true, requireRank: s.requireRank === true, mixed, courts: courtsInput.slice() };
    } else if (prev && prev.settings && typeof prev.settings === 'object' && !Array.isArray(prev.settings)) {
      event.settings = prev.settings;
    }

    // 技リスト（大会ごとの配点）。body に techniques が無いときは
    //   既存ファイルがある → その大会の techniques を引き継ぐ（shareToken と同じ扱い）
    //   既存ファイルが無い → 雛形（custom.json / 既定値）を複製して持たせる
    // 複製なので、あとで雛形を変えてもこの大会の配点は動かない。
    if (!Array.isArray(body.techniques)) {
      const inherited = (prev && Array.isArray(prev.techniques)) ? prev.techniques : null;
      event.techniques = inherited || cloneTechniques(readTechniques().techniques);
    } else {
      // body が techniques を送ってきたとき（技術リスト編集画面からの保存し直しなど）は
      // PUT /api/events/:id/techniques と同じ検証を通す。素通りさせると壊れた
      // 技リストがそのまま保存され、以後の PUT/DELETE の挙動が壊れる。
      const badTech = validateTechniques(body.techniques);
      if (badTech) return res.status(400).json({ error: badTech });
      event.techniques = cloneTechniques(body.techniques);
    }

    writeJsonAtomic(eventPath, event);
    res.json({ success: true, id: event.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/events/:id : 基本情報（名前・日付・会場・settings）だけを更新する
// POST /api/events は大会ファイルを丸ごと送り直す作法で、GET の応答（techniques を
// effectiveTechniques で埋めたもの）をそのまま送り返すと、techniques を持たない大会
// （この機能より前に作られた雛形運用の大会）が自前の技リストを持つ大会に変わってしまう。
// 基本情報の保存はこの経路だけを使い、name / date / venue / settings 以外（techniques /
// players / status / shareToken / live）には一切触れない。
app.patch('/api/events/:id', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    const body = req.body || {};
    // AI の改名は「テスト用 → テスト用」だけ（設計書 2026-10-03 5.4・T14）
    const renameDenied = authz.checkAiRename(req.principal, body);
    if (renameDenied) return authz.sendDeny(res, renameDenied);

    // name は必須ではない（送られてきたときだけ検証して差し替える）
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 100) {
        return res.status(400).json({ error: '大会名が不正です（1〜100文字）' });
      }
      event.name = name;
    }
    // 長さの上限は POST /api/events/:id/copy と同じ
    if (typeof body.date === 'string') event.date = body.date.slice(0, 20);
    if (typeof body.venue === 'string') event.venue = body.venue.slice(0, 100);
    // settings（ゼッケン・級位段位の必須。設計書「選手の追加項目」。courts はコート一覧。
    // 設計書「コート一覧」）。{ requireBib, requireRank } の真偽値だけを取り出す
    // （他のキーは無視。真偽値でなければ false）。courts は不正なら 400 で断り、何も保存しない。
    if (body.settings !== undefined) {
      const s = (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings))
        ? body.settings : {};
      // settings はキーごとの部分更新（網羅検証 S16。設計書 2026-10-01 8 章）。
      // 送られたキーだけ変え、送られなかったキーは今の値を残す。画面は変わったキーだけを送る
      // （古い画面が開いた時点の courts を丸ごと送り返して、他の端末が足したコートを消さないため）。
      // 送られたが真偽値でない requireBib / requireRank は従来どおり false。
      // courts は送られたら置き換える（和集合にはしない。コートを消せなくなるため）。
      const cur = (event.settings && typeof event.settings === 'object' && !Array.isArray(event.settings))
        ? event.settings : {};
      let courts = Array.isArray(cur.courts) ? cur.courts.slice() : [];
      if (s.courts !== undefined) {
        const courtsErr = validateCourtList(s.courts);
        if (courtsErr) return res.status(400).json({ error: courtsErr });
        courts = s.courts.slice();
      }
      const requireBib = s.requireBib !== undefined ? s.requireBib === true : cur.requireBib === true;
      const requireRank = s.requireRank !== undefined ? s.requireRank === true : cur.requireRank === true;
      // finalCourt（2026-09-22 の決戦コートの名前）は廃止。届いても無視して保存しない
      // （設計書 2026-09-28）。既存の大会に残っている
      // finalCourt キーも、settings を送る PATCH で落ちる（どこからも読まないので害は無い）。
      // mixed（男女を分けずに進める。設計書 2026-10-07）。requireBib と同じ部分更新。
      const mixed = s.mixed !== undefined ? s.mixed === true : cur.mixed === true;
      if (mixed !== (cur.mixed === true)) {
        // 男女の分け方は準備中だけ変えられる（採点画面の巡回が order の並びに乗っているため。設計書 2026-10-07 §1）
        const st = EventStatus.of(event);
        if (st !== 'draft') {
          return res.status(409).json({
            error: '試合開始の後は男女の分け方を変えられません',
            reason: 'mixed_locked',
            status: st
          });
        }
        renumberForMixed(event, mixed);
      }
      event.settings = { requireBib: requireBib, requireRank: requireRank, mixed: mixed, courts: courts };
    }

    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({
      success: true,
      event: {
        id: event.id, name: event.name, date: event.date, venue: event.venue,
        updatedAt: event.updatedAt, settings: event.settings
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id : 大会削除
app.delete('/api/events/:id', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    const historyPath = path.join(HISTORY_DIR, `${req.params.id}.json`);
    
    if (fs.existsSync(eventPath)) {
      // 共有リンクを孤児にしない。残すと消えた大会を指すトークンが生き続ける。
      try {
        const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
        if (isValidId(event.shareToken)) {
          const linkPath = path.join(LINKS_DIR, `${event.shareToken}.json`);
          if (fs.existsSync(linkPath)) {
            fs.unlinkSync(linkPath);
          }
        }
      } catch (e) {
        // 大会ファイルが壊れていてもリンク削除の失敗で削除自体を止めない
      }
      fs.unlinkSync(eventPath);
    }
    if (fs.existsSync(historyPath)) {
      fs.unlinkSync(historyPath);
    }
    // その大会の採点の招待を取り消す（端末は次のリクエストから 401。設計書 2026-10-03 4.8）
    const revokedInvites = credentials.revokeInvitesForEvent(req.params.id);
    if (revokedInvites) {
      credentials.audit({ actor: auditActor(req.principal), action: 'invite.revoke', reason: 'event_deleted', eventId: req.params.id, count: revokedInvites });
    }
    // 存在しなくても成功とする
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/copy : 大会をコピーして新しい大会を作る
// 技と配点（drawn を含む）と settings は必ず複製する。選手は withPlayers のときだけ、
// 元の一巡目の行だけを複製し、得点・結果・備考・補正・確定は落とす
// （来年の同じ大会を作るための機能）。ゼッケン・級位段位・レンタルは同じ選手を指すので
// withPlayers のときは複製する（設計書「選手の追加項目」）。
// 元の大会は読むだけなのでロックガードは掛けない（アーカイブ済みからもコピーできる）。
// 新しい ID の新規作成なので、他端末との read-modify-write の競合は起きない。
app.post('/api/events/:id/copy', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const srcPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(srcPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      return res.status(400).json({ error: '大会名が不正です（1〜100文字）' });
    }
    // AI は新しい名前が「テスト用」なら本番の大会からもコピーできる（コピー元は読むだけ）
    if (rejectAiCreate(req, res, name)) return;
    const src = JSON.parse(fs.readFileSync(srcPath, 'utf-8'));
    const now = new Date().toISOString();
    const id = generateId();

    let players = [];
    if (body.withPlayers === true) {
      const used = Object.create(null);
      players = (Array.isArray(src.players) ? src.players : [])
        .filter(p => p && typeof p === 'object' && !Array.isArray(p) && EventStatus.roundOf(p) === 1)
        .map(p => {
          let newId = generateId();
          while (used[newId]) newId = generateId();
          used[newId] = true;
          const newPlayer = {
            id: newId,
            name: typeof p.name === 'string' ? p.name : '',
            order: typeof p.order === 'string' ? p.order : '',
            tech1: typeof p.tech1 === 'string' ? p.tech1 : '',
            tech2: typeof p.tech2 === 'string' ? p.tech2 : '',
            tech3: typeof p.tech3 === 'string' ? p.tech3 : '',
            score: 0,
            isNewFace: p.isNewFace === true,
            isFemale: p.isFemale === true,
            result: '',
            note: '',
            rank: typeof p.rank === 'string' ? p.rank : '',
            rental: p.rental === true
          };
          if (Number.isInteger(p.bib)) newPlayer.bib = p.bib;
          // 二巡目の形の申請も一巡目の技と同じく写す（設計書 2026-10-03 3.8・D10）
          R2_TECH_KEYS.forEach(k => { if (typeof p[k] === 'string') newPlayer[k] = p[k]; });
          applyRound2Techs(newPlayer);
          return newPlayer;
        });
    }

    // shareToken / live / createdAt / 履歴は引き継がない。status は必ず draft。
    const event = {
      id: id,
      name: name,
      date: typeof body.date === 'string' ? body.date.slice(0, 20) : '',
      venue: typeof body.venue === 'string' ? body.venue.slice(0, 100) : '',
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      // 雛形を使っている大会からコピーしても、コピー先には複製を持たせる
      // （あとで雛形を変えてもコピー先の配点が動かないようにする）
      techniques: cloneTechniques(effectiveTechniques(src)),
      players: players
    };
    // settings（ゼッケン・級位段位の必須・コート一覧）。無い大会（この機能より前に作られた大会）
    // からは複製しない。test（テスト大会の印）は写さない（コピー先は本物として扱う。
    // event に test を持たせないことで既定の false のまま。設計書「テスト大会」）。
    if (src.settings && typeof src.settings === 'object' && !Array.isArray(src.settings)) {
      event.settings = {
        requireBib: src.settings.requireBib === true,
        requireRank: src.settings.requireRank === true,
        mixed: src.settings.mixed === true,
        courts: sanitizeCourtList(src.settings.courts)
      };
    }
    markAiCreated(req, event);
    writeJsonAtomic(path.join(EVENTS_DIR, `${id}.json`), event);
    res.status(201).json({ success: true, id: id, playerCount: players.length });
  } catch (err) {
    console.error('大会のコピーに失敗:', err);
    res.status(500).json({ error: '大会のコピーに失敗しました' });
  }
});

// ── テンプレートから大会を作成（トップの「新規作成」） ──
// 設計書 2026-09-21-home-launcher-design.md「テンプレートから作成」。
// courts は雛形として渡す固定の一覧なので isValidCourt を通す必要はない（内部データ）。
const TEMPLATE_SPECS = {
  practice: { courts: ['稽古'], requireBib: false },
  tournament: { courts: ['A', 'B'], requireBib: true },
  systest: { courts: ['A', 'B'], requireBib: true }
};

// systest のダミー選手20名の技3つ。雛形の技リストを先頭から順に回す共有カーソルを
// 呼び出しをまたいで進めながら選ぶ（「技は雛形から3つずつ順に」）。
//   ・末尾が (男)/(女) で、その選手の性別と逆の技は飛ばす
//   ・repeatable でない技をその選手にもう入れていたら飛ばす（2回入れない）
//   ・採用するのは接尾辞を外した表示名（性別の接尾辞付きの技は接尾辞なしの名前で）
// 技が極端に少ない雛形でも無限ループにならないよう、探索回数に上限を付ける。
function buildSystestTechPicker(techniques) {
  const list = (techniques || []).filter(t => t && typeof t.name === 'string' && t.name);
  let cursor = 0;
  return function(isFemale) {
    const picked = [];
    const usedDisplay = Object.create(null);   // 表示名が '__proto__' などでも壊れないように
    if (list.length === 0) return ['', '', ''];
    const otherSuffix = isFemale ? '(男)' : '(女)';
    let guard = 0;
    while (picked.length < 3 && guard < list.length * 4) {
      guard++;
      const t = list[cursor % list.length];
      cursor++;
      if (t.name.slice(-3) === otherSuffix) continue;   // 別の性別専用の技は飛ばす
      const display = stripGenderSuffix(t.name);
      if (!display) continue;
      if (Object.prototype.hasOwnProperty.call(usedDisplay, display) && t.repeatable !== true) continue;
      usedDisplay[display] = true;
      picked.push(display);
    }
    while (picked.length < 3) picked.push('');   // 技が足りない雛形でも落ちない保険
    return picked;
  };
}

// systest のダミー選手20名（男子01〜10・女子01〜10）。コート A・B に交互、bib は1〜20の連番。
// 級位・段位は画面の候補（desk-players.js の RANKS）と同じ 21 段階を順に回す
// （検証は 20 文字までの文字列なので、どれも通る）。動作確認で級位段位の表示と
// 必須チェックを試せるように、空にしない。
const SYSTEST_RANKS = ['無級', '十級', '九級', '八級', '七級', '六級', '五級', '四級', '三級', '二級', '一級',
  '初段', '弐段', '参段', '四段', '五段', '六段', '七段', '八段', '九段', '十段'];

function buildSystestPlayers(techniques) {
  const pickTechs = buildSystestTechPicker(techniques);
  const courts = ['A', 'B'];
  const numberInCourt = { A: { 男子: 0, 女子: 0 }, B: { 男子: 0, 女子: 0 } };
  const players = [];
  let bib = 0;
  [false, true].forEach(function(isFemale) {
    const label = isFemale ? '女子' : '男子';
    for (let i = 1; i <= 10; i++) {
      const court = courts[(i - 1) % 2];   // 奇数番目→A、偶数番目→B（交互）
      numberInCourt[court][label]++;
      bib++;
      const techs = pickTechs(isFemale);
      players.push({
        id: generateId(),
        name: label + String(i).padStart(2, '0'),
        order: buildOrder(court, label, 1, numberInCourt[court][label]),
        tech1: techs[0],
        tech2: techs[1],
        tech3: techs[2],
        score: 0,
        isNewFace: false,
        isFemale: isFemale,
        result: '',
        rank: SYSTEST_RANKS[(bib - 1) % SYSTEST_RANKS.length],
        rental: false,
        bib: bib
      });
    }
  });
  return players;
}

// POST /api/events/from-template : テンプレートから大会を作る
app.post('/api/events/from-template', (req, res) => {
  try {
    const body = req.body || {};
    const spec = Object.prototype.hasOwnProperty.call(TEMPLATE_SPECS, body.template) ? TEMPLATE_SPECS[body.template] : null;
    if (!spec) {
      return res.status(400).json({ error: '不明なテンプレートです' });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      return res.status(400).json({ error: '大会名が不正です（1〜100文字）' });
    }
    if (rejectAiCreate(req, res, name)) return;
    const now = new Date().toISOString();
    const id = generateId();
    const techniques = cloneTechniques(readTechniques().techniques);

    const event = {
      id: id,
      name: name,
      date: typeof body.date === 'string' ? body.date.slice(0, 20) : '',
      venue: typeof body.venue === 'string' ? body.venue.slice(0, 100) : '',
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      techniques: techniques,
      settings: { requireBib: spec.requireBib === true, requireRank: false, mixed: false, courts: spec.courts.slice() },
      players: []
    };

    // systest だけダミー選手20名を作り、test:true を付ける（設計書「テンプレート」）。
    if (body.template === 'systest') {
      event.test = true;
      event.players = buildSystestPlayers(techniques);
    }
    markAiCreated(req, event);

    writeJsonAtomic(path.join(EVENTS_DIR, `${id}.json`), event);
    res.status(201).json({ success: true, id: id, playerCount: event.players.length });
  } catch (err) {
    console.error('テンプレートからの大会作成に失敗:', err);
    res.status(500).json({ error: 'テンプレートからの大会作成に失敗しました' });
  }
});

// POST /api/events/:id/status : 大会の状態を進める・戻す
// 状態を変える唯一の経路（POST /api/events の body の status は無視される）。
// クライアントは進む前に件数を数えて確認し、ここでは硬い条件だけを 409 で拒む。
// ロックガードは掛けない（final / archived から戻す・アーカイブするための経路）。
app.post('/api/events/:id/status', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const to = (req.body || {}).to;
    if (typeof to !== 'string' || EventStatus.STATES.indexOf(to) === -1) {
      return res.status(400).json({ error: '不正な状態です' });
    }
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    const from = EventStatus.of(event);
    // 画面が見ていた状態（from）と今の状態が違えば断る（網羅検証 S19）。古い画面の「戻す」
    // （prev は画面の状態から計算する）で想定外の状態へ行かないようにする。
    // from を送らない古い画面は従来どおり（互換）。
    const seenFrom = (req.body || {}).from;
    if (typeof seenFrom === 'string' && seenFrom !== from) {
      return res.status(409).json({
        error: '大会の状態が変わっています。画面を読み直してください',
        reason: 'stale',
        status: from,
        to: to
      });
    }
    if (!EventStatus.canTransition(from, to)) {
      return res.status(409).json({
        error: 'この状態からは進めません',
        reason: 'transition',
        from: from,
        to: to
      });
    }

    const players = Array.isArray(event.players) ? event.players : [];
    // status を持たない大会（「確定」の機能より前の大会）が初めて遷移するときは、採点済みの行に
    // 確定の印を付けて移行する（網羅検証 M6）。status を書いた時点から順位・選考は確定済みの行だけを
    // 数えるので、付けないと得点が全部順位から消える。この後の検査で断る（409）ときは
    // ファイルを書かないので、印も残らない。
    if (typeof event.status !== 'string') {
      players.forEach(p => {
        if (p && EventStatus.isScored(p) && p.confirmed !== true) {
          const before = Object.assign({}, p);
          p.confirmed = true;
          bumpRevIfChanged(before, p);
        }
      });
    }
    // 一巡目の選手が1人もいなければ試合は始められない
    if (from === 'draft' && to === 'round1' &&
        players.filter(p => EventStatus.roundOf(p) === 1).length === 0) {
      return res.status(409).json({ error: '一巡目の選手がいません', reason: 'empty' });
    }

    // 一巡目の終了で二巡目を作る（設計書 2026-09-22 の決定。手動の「二巡目を生成」は無い）。
    // 生成できなければ状態も進めない（ファイルを書かずに返す＝遷移の取り消し）。
    let round2Info = null;
    if (from === 'round1' && to === 'round1_done') {
      if (players.filter(p => EventStatus.roundOf(p) === 1).length === 0) {
        return res.status(409).json({ error: '一巡目の選手がいません', reason: 'empty' });
      }
      // CSV 由来など追跡できない（sourcePlayerId を持たない）二巡目の行が既にあるときに
      // force で進めると、その行とは別に自動生成の行が重複して増える（レビュー指摘A）。
      // force: true が来ていなければ、いったん止めて件数だけ返す。
      const bodyForce = !!(req.body && req.body.force === true);
      const existingRound2 = players.filter(p => EventStatus.roundOf(p) === 2);
      const untrackedCount = existingRound2.filter(p => p && !p.sourcePlayerId).length;
      if (untrackedCount > 0 && !bodyForce) {
        const round1Candidates = players.filter(p => p && EventStatus.roundOf(p) === 1);
        const validRound1 = round1Candidates.filter(p => {
          const parsed = parseOrder(p && p.order);
          return parsed !== null && isValidCourt(parsed.court);
        });
        return res.status(409).json({
          error: '追跡できない二巡目の行があります。このまま進めますか？',
          reason: 'exists',
          existingCount: existingRound2.length,
          untrackedCount: untrackedCount,
          unassignedCount: round1Candidates.length - validRound1.length
        });
      }
      // 未採点の確認はクライアントが済ませているので force 扱いで呼ぶ（既に二巡目があれば
      // 差分だけ追加される。誰も採点していなければ番号を現在の一巡目の得点から付け直す。レビュー指摘J）。
      const gen = generateRound2(event, true, true);
      if (!gen.ok) {
        return res.status(409).json({
          error: gen.body.error || '二巡目を生成できませんでした', reason: 'generate_failed'
        });
      }
      event.players = gen.players;
      round2Info = {
        created: gen.created, skipped: gen.skipped, existingCount: gen.existingCount,
        untrackedCount: gen.untrackedCount, unassignedCount: gen.unassignedCount,
        reordered: !!gen.reordered,
        fromRequest: gen.fromRequest
      };
    }

    // 二巡目の行が無ければ二巡目は始められない（既存データの移行。通常の遷移では
    // round1_done が必ず二巡目を作るので、この経路は round2 が無いまま round1_done を
    // 持つ大会＝取り込んだ古いデータのためだけに残る）。
    if (from === 'round1_done' && to === 'round2' &&
        players.filter(p => EventStatus.roundOf(p) === 2).length === 0) {
      return res.status(409).json({ error: '二巡目が生成されていません', reason: 'no_round2' });
    }
    event.status = to;
    event.updatedAt = new Date().toISOString();
    // 状態が変わったら live は空にする。前の状態で映していた選手を配信ボードが
    // 映し続けないようにするため（次の putLive までの数秒は「待機中」になる）。
    event.live = {};
    writeJsonAtomic(eventPath, event);
    appendHistory(req.params.id, {
      action: 'status_change',
      detail: EventStatus.LABELS[from] + ' → ' + EventStatus.LABELS[to] +
        (round2Info ? '（二巡目 ' + round2Info.created + ' 名を生成）' : '')
    }, req.principal);
    res.json({ success: true, status: to, round2: round2Info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Player API ──

// POST /api/events/:id/players : 選手を1名追加
// order はサーバーが組み立てる。クライアントが送る id / order / score / result は無視する。
// 既存行に触れないため、採点中の端末には影響しない（ガードは掛けない）。
// レンタル×抜刀の形（rental の選手は drawn の技だけ）と同じ形の回数制限
// （repeatable でない技の重複）の検証は bulk rows（一括登録）だけで行う。この単体経路は
// スマホ・PC の1件ずつの編集フォームから来るため、技の候補自体をクライアントが
// techniqueOptions で絞り込んでおり、また「試合開始」の可否は courts.js の startBlockers
// が別途まとめて見る（画面の赤枠はクライアント側の判定に任せる）。ここで二重に検証しない。
// ただし技得点表に無い技名は bulk rows と同じく 400 で断る（reason: 'unknown_tech'。空は可）。
app.post('/api/events/:id/players', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const body = req.body || {};

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: '選手名が必要です' });
    }
    // 氏名 100 字・技名 50 字は PATCH・取り込みと同じ上限（網羅検証 S15）
    if (name.length > NAME_MAX) {
      return res.status(400).json({ error: NAME_TOO_LONG });
    }
    const techs = ['tech1', 'tech2', 'tech3'].map(k => (typeof body[k] === 'string' ? body[k].trim() : ''));
    if (techs.some(t => t.length > TECH_NAME_MAX)) {
      return res.status(400).json({ error: TECH_TOO_LONG });
    }
    const court = typeof body.court === 'string' ? body.court.trim() : '';
    if (!isValidCourt(court)) {
      return res.status(400).json({ error: '不正なコート名です' });
    }
    const round = body.round === undefined ? 1 : body.round;
    if (!Number.isInteger(round) || round < 1 || round > 9) {
      return res.status(400).json({ error: '不正な巡目です' });
    }
    // 二巡目の形の申請（設計書 2026-10-03 3.2）。一巡目の行にだけ。同じ形・レンタルはこの経路では
    // 見ない（一巡目の技と同じ方針。画面が候補を絞り、試合開始の検査が見る）。
    const r2techs = readRound2Techs(body);
    if (r2techs.some(t => t.length > TECH_NAME_MAX)) {
      return res.status(400).json({ error: TECH_TOO_LONG });
    }
    if (round !== 1 && r2techs.some(t => t)) {
      return res.status(400).json({ error: '二巡目の形は一巡目の行にだけ登録できます', reason: 'not_round1' });
    }

    // ゼッケン番号・級位段位・真剣レンタル（設計書「選手の追加項目」）。
    // 型が合わないものは他の項目と違い黙って無視せず 400 で断る（ゼッケンの重複判定に
    // 関わる値なので、送り手の入力ミスをそのまま通したくない）。
    const bibParsed = parseBibForCreate(body.bib);
    if (!bibParsed.ok) {
      return res.status(400).json({ error: BIB_INVALID });
    }
    const rankParsed = parseRankForCreate(body.rank);
    if (!rankParsed.ok) {
      return res.status(400).json({ error: RANK_INVALID });
    }
    const rentalParsed = parseRentalForCreate(body.rental);
    if (!rentalParsed.ok) {
      return res.status(400).json({ error: RENTAL_INVALID });
    }

    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    if (!Array.isArray(event.players)) event.players = [];

    // 技はその大会の技得点表にある名前だけ（一括登録 bulk rows と同じ規則。空は可）。
    // 表に無い技名で登録すると、採点画面で配点が引けず 0 点になる（通し試験の所見 B）。
    const createIsFemale = body.isFemale === true;
    const createTechList = effectiveTechniques(event);
    for (const t of techs) {
      if (t && !resolveTechnique(createTechList, t, createIsFemale)) {
        return res.status(400).json({ error: `技「${t}」は技リストにありません`, reason: 'unknown_tech' });
      }
    }
    for (const t of r2techs) {
      if (t && !resolveTechnique(createTechList, t, createIsFemale)) {
        return res.status(400).json({ error: `二巡目の技「${t}」は技リストにありません`, reason: 'unknown_tech' });
      }
    }

    if (bibParsed.value !== null) {
      const conflict = findBibConflict(event.players, bibParsed.value, null);
      if (conflict) {
        return res.status(409).json({
          error: bibConflictMessage(bibParsed.value, conflict.name),
          reason: 'bib'
        });
      }
    }

    const isFemale = createIsFemale;
    const seg = genderSeg(event, isFemale);
    const n = nextOrderNumber(event.players, court, seg, round);

    const player = {
      id: generateId(),
      name: name,
      order: buildOrder(court, seg, round, n),
      // 前後の空白は落とす（残ると技得点表の完全一致に掛からず配点が 0 になる）
      tech1: techs[0],
      tech2: techs[1],
      tech3: techs[2],
      score: 0,
      isNewFace: body.isNewFace === true,
      isFemale: isFemale,
      result: '',
      rank: rankParsed.value,
      rental: rentalParsed.value
    };
    if (bibParsed.value !== null) player.bib = bibParsed.value;
    R2_TECH_KEYS.forEach((k, i) => { player[k] = r2techs[i]; });
    applyRound2Techs(player);

    event.players.push(player);
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.status(201).json({ success: true, player: player });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 技名の解決。courts.js の Courts.resolveTechnique と同じ規則（完全一致 → 性別の
// 接尾辞付きで再検索。採点画面の Scoring.findTechnique とも同じ）。courts.js は
// ブラウザ用の IIFE で require できないので、ここに同じ規則を自前で持つ
// （status.js を EventStatus として require しているのとは事情が違う。courts.js は
// UMD 包みでなく module.exports を持たない）。テストは test.html の Courts.resolveTechnique と
// ここ（サーバーの bulk rows テスト）の両方で固定する。
function resolveTechnique(techniques, name, isFemale) {
  const list = techniques || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].name === name) return list[i];
  }
  const nameWithGender = name + (isFemale ? '(女)' : '(男)');
  for (let j = 0; j < list.length; j++) {
    if (list[j] && list[j].name === nameWithGender) return list[j];
  }
  return null;
}

// '破図味(男)' → '破図味'。courts.js の Courts.stripGenderSuffix と同じ規則
// （bulk rows の重複エラー文言に出す表示名を、接尾辞なしに揃えるため）。
function stripGenderSuffix(name) {
  const s = String(name == null ? '' : name);
  if (s.slice(-3) === '(男)' || s.slice(-3) === '(女)') return s.slice(0, -3);
  return s;
}

// ── 選手の追加項目（ゼッケン番号・級位段位・真剣レンタル）の検証 ──
// 設計書「選手の追加項目」。POST/PATCH の選手 API と bulk rows で共用する。
const NAME_MAX = 100;
const TECH_NAME_MAX = 50;
const NAME_TOO_LONG = '選手名は100文字までです';
const TECH_TOO_LONG = '技名は50文字までです';
const BIB_INVALID = 'ゼッケン番号は1〜9999の整数で指定してください';
const RANK_INVALID = '級位・段位は20文字までの文字列で指定してください';
const RENTAL_INVALID = '真剣レンタルの指定が不正です';
const RENTAL_DRAWN_ONLY = 'レンタルの選手は抜刀してからの形だけ選べます';

function isValidBibValue(v) {
  return Number.isInteger(v) && v >= 1 && v <= 9999;
}
function isValidRankValue(v) {
  return typeof v === 'string' && v.trim().length <= 20;
}

// ゼッケン番号の検証（新規作成用）。省略・null は「未設定」（value: null）。
// それ以外は 1〜9999 の整数だけを許す。戻り値: { ok, value }
function parseBibForCreate(v) {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (!isValidBibValue(v)) return { ok: false, value: null };
  return { ok: true, value: v };
}
// 級位・段位の検証（新規作成用）。省略時は既定の空文字。
function parseRankForCreate(v) {
  if (v === undefined) return { ok: true, value: '' };
  if (!isValidRankValue(v)) return { ok: false, value: '' };
  return { ok: true, value: EventStatus.normalizeRank(v) };
}
// 真剣レンタルの検証（新規作成用）。省略時は既定の false。
function parseRentalForCreate(v) {
  if (v === undefined) return { ok: true, value: false };
  if (typeof v !== 'boolean') return { ok: false, value: false };
  return { ok: true, value: v };
}

// 同じ大会内での bib 重複を探す。selfId と同じ選手は比較から外す（PATCH の自分自身）。
// 加えて「同じ選手の別の巡目の行」も比較から外す（二巡目生成が一巡目の bib を複製するため、
// 素直に比較すると自分自身の複製と衝突してしまう）。selfId が二巡目行ならその sourcePlayerId
// （元の一巡目行）も、selfId を sourcePlayerId として持つ行（selfId が一巡目行ならその二巡目行）
// も同じ選手として除外する。
// 見つかれば bib を使っている選手を返す（無ければ null）。
function findBibConflict(players, bib, selfId) {
  const list = players || [];
  const selfPlayer = list.find(function(p) { return p && p.id === selfId; });
  const originId = selfPlayer && isValidId(selfPlayer.sourcePlayerId) ? selfPlayer.sourcePlayerId : null;
  const excluded = Object.create(null);
  if (selfId) excluded[selfId] = true;
  if (originId) excluded[originId] = true;
  list.forEach(function(p) {
    if (p && isValidId(p.sourcePlayerId) &&
        (p.sourcePlayerId === selfId || (originId && p.sourcePlayerId === originId))) {
      excluded[p.id] = true;
    }
  });
  const hit = list.find(function(p) {
    return p && !excluded[p.id] && Number.isInteger(p.bib) && p.bib === bib;
  });
  return hit || null;
}

function bibConflictMessage(bib, ownerName) {
  return 'ゼッケン番号 ' + bib + ' は「' + (ownerName || '') + '」が使っています';
}

// CSV取り込み・バンドル取り込みは登録系 API と違って行単位で 400 にはせず、
// 重複・範囲外の bib を黙って「未設定」に落として取り込みを続ける（多数の選手データを
// 1件のミスで丸ごと弾かない）。その代わり、落とした件数を bibDropped として応答に含め、
// 画面側で「n 件は未設定にしました」と伝える。
// parseOne(raw) は 3 通りを返す: undefined（未入力）/ null（範囲外・不正な値）/ 整数（1〜9999）。
// existingBibs はすでにその大会にある bib の配列（append 取り込み時。replace・新規作成時は空）。
// groupKeys は rawValues と同じ長さの配列（省略可）。同じ groupKey を持つ行同士は「同じ選手の
// 別の巡目」として重複扱いしない（バンドル取り込みで一巡目と二巡目が同じ bib を持つのは
// findBibConflict と同じく正常な状態のため）。省略時は全行が別グループ扱い（CSV 取り込みは
// 二巡目の複製を扱わないので、これで従来どおりの単純な重複判定になる）。
// 戻り値: { bibs: (number|null)[]（rawValues と同じ順・同じ長さ）, duplicate, outOfRange }
function resolveBibDrops(rawValues, parseOne, existingBibs, groupKeys) {
  const seen = Object.create(null);   // bib(文字列化) -> groupKey
  (existingBibs || []).forEach(function(b, idx) { seen[b] = '__existing_' + idx; });
  let duplicate = 0;
  let outOfRange = 0;
  const bibs = rawValues.map(function(raw, i) {
    const parsed = parseOne(raw);
    if (parsed === undefined) return null;   // 未入力
    if (parsed === null) { outOfRange++; return null; }   // 範囲外・不正な値
    const groupKey = groupKeys ? groupKeys[i] : '__row_' + i;
    if (Object.prototype.hasOwnProperty.call(seen, parsed) && seen[parsed] !== groupKey) {
      duplicate++;   // 2件目以降の重複（別の選手が同じ番号を使っている）
      return null;
    }
    seen[parsed] = groupKey;
    return parsed;
  });
  return { bibs: bibs, duplicate: duplicate, outOfRange: outOfRange };
}

// CSV の1セルから bib を分類する。空欄は「未入力」、数値化できないか範囲外は「範囲外」。
// 従来の bibFromCsv と同じ緩い読み方（parseInt）を保ちつつ、未入力と不正値を区別する。
function classifyBibCsv(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return undefined;
  const n = parseInt(s, 10);
  return (Number.isInteger(n) && n >= 1 && n <= 9999) ? n : null;
}

// バンドル取り込みの選手1名分の生の bib 値を分類する（JSON の値なので型もさまざま）。
function classifyBibBundle(v) {
  if (v === undefined || v === null) return undefined;
  return (Number.isInteger(v) && v >= 1 && v <= 9999) ? v : null;
}

// 一括登録の行形式（PC 運営の「貼り付けて追加」）。
// 行ごとにコート・性別・新人・技が違う。全行を検証してから 1 回だけ書き、
// 1 行でも不正なら 1 人も登録しない（半分だけ登録された状態を運営に見せない）。
// 技名はその大会の「有効な技リスト」（effectiveTechniques）から、行の性別で resolveTechnique
// して見つかる名前だけを許す（接尾辞なしの名前もその性別で解決できれば通す）。
// 採番は コート×性別 ごとに最大+1 を 1 回だけ求め、あとは連番で増やす
// （行ごとに数え直すと件数の二乗のコストになる）。巡目は常に 1（二巡目は生成 API が作る）。
function bulkFromRows(req, res, rows) {
  if (rows.length === 0) {
    return res.status(400).json({ error: '登録する行がありません' });
  }
  if (rows.length > 500) {
    return res.status(400).json({ error: '一度に登録できるのは500名までです' });
  }

  const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(eventPath)) {
    return res.status(404).json({ error: '大会が見つかりません' });
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
  if (rejectIfLocked(res, event)) return;
  if (!Array.isArray(event.players)) event.players = [];

  const techList = effectiveTechniques(event);

  // 1. 全行の検証（ここでは何も書かない）
  // ゼッケン番号は行同士（seenBib）と既存の選手の両方で重複を見る
  // （設計書「選手の追加項目」API「一括登録」）。
  const seenBib = Object.create(null);
  const checked = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    // 行番号は貼り付けプレビューの行番号（row.line）があればそれを使う。貼り付けは ok:false の
    // 行を除いて送るため、送信順の何行目か（i + 1）とプレビューの行番号がずれるため
    // （desk-players.js の「貼り付けて追加」）。line が無い・不正なら従来どおり i + 1。
    const lineNo = (Number.isInteger(row.line) && row.line > 0) ? row.line : (i + 1);
    const at = `${lineNo} 行目: `;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: at + '選手名が必要です' });
    }
    if (name.length > NAME_MAX) {
      return res.status(400).json({ error: at + NAME_TOO_LONG });
    }
    const court = typeof row.court === 'string' ? row.court.trim() : '';
    if (!isValidCourt(court)) {
      return res.status(400).json({ error: at + '不正なコート名です' });
    }
    // isFemale / isNewFace は省略（undefined）は許すが、それ以外は真偽値でなければ断る
    // （文字列 'true' などを黙って false 扱いにすると、送り手が気付けない）。
    if (row.isFemale !== undefined && typeof row.isFemale !== 'boolean') {
      return res.status(400).json({ error: at + '性別の指定が不正です' });
    }
    if (row.isNewFace !== undefined && typeof row.isNewFace !== 'boolean') {
      return res.status(400).json({ error: at + '新人の指定が不正です' });
    }
    const bibParsed = parseBibForCreate(row.bib);
    if (!bibParsed.ok) {
      return res.status(400).json({ error: at + BIB_INVALID });
    }
    if (bibParsed.value !== null) {
      if (seenBib[bibParsed.value]) {
        return res.status(400).json({ error: at + bibConflictMessage(bibParsed.value, seenBib[bibParsed.value]) });
      }
      const bibConflict = findBibConflict(event.players, bibParsed.value, null);
      if (bibConflict) {
        return res.status(400).json({ error: at + bibConflictMessage(bibParsed.value, bibConflict.name) });
      }
      seenBib[bibParsed.value] = name;
    }
    const rankParsed = parseRankForCreate(row.rank);
    if (!rankParsed.ok) {
      return res.status(400).json({ error: at + RANK_INVALID });
    }
    const rentalParsed = parseRentalForCreate(row.rental);
    if (!rentalParsed.ok) {
      return res.status(400).json({ error: at + RENTAL_INVALID });
    }
    const isFemale = row.isFemale === true;
    const techs = ['tech1', 'tech2', 'tech3'].map(k => (typeof row[k] === 'string' ? row[k].trim() : ''));
    // 同じ形の重複（repeatable でない技だけ数える）。接尾辞は同じ形として数えるため
    // stripGenderSuffix した表示名で数える（courts.js の Courts.duplicateForms と同じ規則）。
    const formCounts = Object.create(null);
    let dupForm = '';
    for (let t = 0; t < techs.length; t++) {
      if (!techs[t]) continue;
      const resolved = resolveTechnique(techList, techs[t], isFemale);
      if (!resolved) {
        return res.status(400).json({ error: at + `技「${techs[t]}」は技リストにありません` });
      }
      // レンタルの選手には drawn（抜刀後の形）の技だけを許す（courts.js の startBlockers /
      // parsePasteRows と同じ規則。ここは貼り付けのプレビューを経ずに届く経路でもあるため
      // 400 で止める必要がある）。
      if (rentalParsed.value && resolved.drawn !== true) {
        return res.status(400).json({ error: at + RENTAL_DRAWN_ONLY });
      }
      if (resolved.repeatable !== true) {
        const display = stripGenderSuffix(resolved.name);
        formCounts[display] = (formCounts[display] || 0) + 1;
        if (formCounts[display] >= 2 && !dupForm) dupForm = display;
      }
    }
    if (dupForm) {
      return res.status(400).json({ error: `${at}同じ形は 1 回までです（${dupForm}）` });
    }
    // 二巡目の形の申請（設計書 2026-10-03 3.2）。空なら一巡目と同じ形（検査しない）。
    const r2techs = readRound2Techs(row);
    if (r2techs.some(t => t.length > TECH_NAME_MAX)) {
      return res.status(400).json({ error: at + TECH_TOO_LONG });
    }
    const r2Err = checkRound2Techs(techList, r2techs, isFemale, rentalParsed.value);
    if (r2Err) return res.status(400).json({ error: at + r2Err });
    checked.push({
      r2techs: r2techs,
      name: name,
      court: court,
      isFemale: isFemale,
      isNewFace: row.isNewFace === true,
      techs: techs,
      bib: bibParsed.value,
      rank: rankParsed.value,
      rental: rentalParsed.value
    });
  }

  // 2. 採番して書く
  const nextNo = {};
  const created = checked.map(row => {
    const seg = genderSeg(event, row.isFemale);
    const key = bulkOrderKey(row.court, seg);
    if (nextNo[key] === undefined) {
      nextNo[key] = nextOrderNumber(event.players, row.court, seg, 1);
    }
    const n = nextNo[key]++;
    const player = {
      id: generateId(),
      name: row.name,
      order: buildOrder(row.court, seg, 1, n),
      tech1: row.techs[0],
      tech2: row.techs[1],
      tech3: row.techs[2],
      score: 0,
      isNewFace: row.isNewFace,
      isFemale: row.isFemale,
      result: '',
      rank: row.rank,
      rental: row.rental
    };
    if (row.bib !== null) player.bib = row.bib;
    R2_TECH_KEYS.forEach((k, i) => { player[k] = row.r2techs[i]; });
    applyRound2Techs(player);
    return player;
  });

  event.players = event.players.concat(created);
  event.updatedAt = new Date().toISOString();
  writeJsonAtomic(eventPath, event);
  res.status(201).json({ success: true, created: created.length, players: created });
}

// 採番の控えのキー。コート名に使えない文字（改行）で連結して、
// 'A' + '男子' と 'A男' + '子' が同じキーにならないようにする。
function bulkOrderKey(court, seg) {
  return court + '\n' + seg;
}

// POST /api/events/:id/players/bulk : 選手をまとめて追加（一巡目）
// 2 つの形を受ける。どちらか一方だけ。
//   { court, isFemale, isNewFace, names: [...] } … 同じコート・性別・新人区分で名前だけ（スマホ運営）
//   { rows: [{ name, court, isFemale, isNewFace, tech1, tech2, tech3, bib, rank, rental,
//              r2tech1, r2tech2, r2tech3, line }, ...] } … 行ごとに違う（PC 運営の貼り付け）
// names 形式: 名前は1件ずつ trim して空を除く。コート・性別・巡目は全員共通なので nextOrderNumber は
// 最初に1回だけ求め、あとは連番で増やす（毎回 concat して数え直すと件数の二乗のコストになる）。
app.post('/api/events/:id/players/bulk', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const body = req.body || {};
    if (Array.isArray(body.rows)) return bulkFromRows(req, res, body.rows);
    const court = typeof body.court === 'string' ? body.court.trim() : '';
    if (!isValidCourt(court)) {
      return res.status(400).json({ error: '不正なコート名です' });
    }
    if (!Array.isArray(body.names)) {
      return res.status(400).json({ error: '名前の配列が必要です' });
    }
    if (body.names.length > 500) {
      return res.status(400).json({ error: '一度に登録できるのは500名までです' });
    }
    const names = body.names
      .map(n => (typeof n === 'string' ? n.trim() : ''))
      .filter(n => n !== '');
    if (names.length === 0) {
      return res.status(400).json({ error: '登録する名前がありません' });
    }
    // 氏名 100 字は 1 名追加・PATCH と同じ上限（網羅検証 S15）。1 件でも長ければ 1 人も登録しない
    const longIdx = names.findIndex(n => n.length > NAME_MAX);
    if (longIdx !== -1) {
      return res.status(400).json({ error: (longIdx + 1) + ' 人目: ' + NAME_TOO_LONG });
    }

    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    if (!Array.isArray(event.players)) event.players = [];

    const isFemale = body.isFemale === true;
    const isNewFace = body.isNewFace === true;
    const seg = genderSeg(event, isFemale);
    let n = nextOrderNumber(event.players, court, seg, 1);
    const created = names.map(name => {
      const player = {
        id: generateId(),
        name: name,
        order: buildOrder(court, seg, 1, n),
        tech1: '',
        tech2: '',
        tech3: '',
        score: 0,
        isNewFace: isNewFace,
        isFemale: isFemale,
        result: ''
      };
      n++;
      return player;
    });

    event.players = event.players.concat(created);
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.status(201).json({ success: true, created: created.length, players: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/players/reorder : 1 つの組（コート×性別×巡目）の試技順の並べ替え
// （PC 運営の選手登録の表で行をドラッグしたとき。ユーザー要望 2026-09-30）。
// Body: { court, isFemale, round, ids: [選手ID, ...] }
// ids の順に order の番号を 1, 2, 3 … と振り直す（欠番も詰まる）。他の項目は変えない。
// ids はその組の行の id の集合と完全に一致していなければならない（不足・余分があれば
// 400 reorder_mismatch。画面が古いまま一部の行だけ送ってくると、送られなかった行と番号が
// 重なってしまうため）。組は order の コート・性別・巡目 で決める。
// 採点済みの行を含んでも並べ替えは許す（得点は行に付いているので、番号が変わっても壊れない）。
// 二巡目の行は sourcePlayerId で一巡目に紐づくが、order は伝播しない（PATCH の bib 等の伝播とは別）。
app.post('/api/events/:id/players/reorder', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const body = req.body || {};
    const court = body.court;
    if (!isValidCourt(court)) {
      return res.status(400).json({ error: '不正なコート名です' });
    }
    if (typeof body.isFemale !== 'boolean') {
      return res.status(400).json({ error: '性別の指定が不正です' });
    }
    const round = body.round;
    if (!Number.isInteger(round) || round < 1 || round > 9) {
      return res.status(400).json({ error: '不正な巡目です' });
    }
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 ||
        !ids.every(id => typeof id === 'string' && id !== '')) {
      return res.status(400).json({ error: '選手IDの配列が必要です' });
    }
    const seen = Object.create(null);   // id が '__proto__' などでも壊れないように
    for (const id of ids) {
      if (seen[id]) return res.status(400).json({ error: '選手IDが重複しています' });
      seen[id] = true;
    }

    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    if (!Array.isArray(event.players)) event.players = [];

    // この組の行（order の コート・性別の段・巡目 が一致するもの）を id で引けるようにする。
    // 混合の大会では性別の段が '混合' なので、body.isFemale は見ない（コート×巡目の全員が 1 組）。
    const seg = genderSeg(event, body.isFemale === true);
    const byId = Object.create(null);
    event.players.forEach(p => {
      const parsed = parseOrder((p && p.order) || '');
      if (!parsed) return;
      if (parsed.court !== court || parsed.gender !== seg || parsed.round !== round) return;
      byId[p.id] = p;
    });
    if (Object.keys(byId).length !== ids.length || !ids.every(id => byId[id])) {
      return res.status(400).json({
        error: '並べ替える選手が現在の登録と一致しません。画面を読み直してからやり直してください',
        reason: 'reorder_mismatch'
      });
    }

    ids.forEach((id, i) => {
      byId[id].order = buildOrder(court, seg, round, i + 1);
    });
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ success: true, players: event.players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/events/:id/players/:playerId : 選手の部分更新（採点と運営編集の共用）
// 受理するフィールドは allowlist に限る。単純マージだと id / order / 未知のキーまで
// クライアントが書き込めてしまう。
// court と round は order を組み立てる入力としてだけ使い、選手オブジェクトには保存しない
// （巡目は order から導出できる値なので、二重に持つと不整合の元になる）。
// レンタル×抜刀の形と同じ形の回数制限（repeatable でない技の重複）の検証は
// bulk rows（一括登録）だけで行う。この単体経路（採点画面・運営編集フォームからの
// 1件ずつの更新）はクライアントが techniqueOptions で技の候補自体を絞り込んでおり、
// 「試合開始」の可否は courts.js の startBlockers が別途まとめて見るため、ここで
// 二重に検証しない（画面の赤枠もクライアント側の判定に任せる）。
//
// 検査の順（設計書 2026-10-01-audit-fixes-design.md 1・2・8 章）。検査で断るときは何も書かない。
//   1. 形の検査（400）: score / adjust / totalAdjust の範囲（S4。黙って捨てずに要求全体を断る）、
//      result、name、技名 50 字、baseRev の形、bib / rank / rental
//   2. 採点の PATCH（score / result / adjust / totalAdjust / confirmed のどれかを含む）で baseRev があるとき:
//        stale（409）… baseRev が今の rev と違い、採点の値が今と違う（M2 a）
//        not_scorable（409）… その行の巡目が今の状態で採点できない（M2 b。force で越えられる）
//      baseRev の無い採点の PATCH は当面受理する（更新前の画面の送信キューは 4xx を捨てるので、
//      拒むとその端末の採点が黙って失われる。設計書 1.2）。同じ理由で、baseRev の無い採点の PATCH の
//      範囲外の補正点は 1 の検査の前に ±999 に丸める（clampLegacyAdjust。baseRev ありは 400）。
//   3. linked（409）… 一巡目に元がある二巡目の行の氏名・性別・新人を変えようとした（M1。一巡目で直す）
//   4. scored（409）… 採点済みの行の技・性別を変えようとした（S7。force で越えられる）
//   5. bib（409）… ゼッケンの重複
// 成功したら、一巡目の行の変更を sourcePlayerId でつながる二巡目の行に写し（M1）、
// 採点に関わる値が変わった行の rev を +1 する。応答の player には必ず rev が入る。
// 二巡目の形の申請 r2tech1〜3（設計書 2026-10-03 3.3）: 一巡目の行にだけ送れる（それ以外は 400 not_round1）。
// 申請を直すと二巡目の行の技に書き写し（写す先が採点済みなら 409 scored に linked＝その行、force で越える）、
// 二巡目の行の技を直すと一巡目の行の申請に書き戻す。応答に書き換えた相手の行を足す:
//   linked: [二巡目の行（rev 入り）…]（一巡目の行の PATCH で二巡目の行が変わったとき）
//   source: 一巡目の行（rev 入り）（二巡目の行の PATCH で申請を書き戻したとき）
app.patch('/api/events/:id/players/:playerId', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    if (!isValidId(req.params.playerId)) {
      return res.status(400).json({ error: '不正な選手IDです' });
    }
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    if (!Array.isArray(event.players)) event.players = [];
    const playerIndex = event.players.findIndex(p => p && p.id === req.params.playerId);

    if (playerIndex === -1) {
      return res.status(404).json({ error: '選手が見つかりません' });
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const player = event.players[playerIndex];
    const before = Object.assign({}, player);
    const force = body.force === true;

    // ── 採点の鍵の端末（設計書 2026-10-03 5.3） ──
    // 許すのは採点の項目（score result adjust totalAdjust confirmed note）と baseRev だけ。それ以外が 1 つでも
    // あれば 403 field（force も）。行のコートが鍵のコートでなければ 403 scope（未分類も）。採点の項目を
    // 送るなら baseRev は必須（400）。行の読み込みと書き換えの間に await が無いので、ここで見た行を書き換える。
    const scorerDenied = authz.checkScorerPatch(req.principal, player, body, courtOf);
    if (scorerDenied) return authz.sendDeny(res, scorerDenied);

    // ── 0. 更新前の画面の補正点（レビュー指摘 9） ──
    // 更新前の採点画面は補正点の入力に上限が無く、baseRev も送らない。その送信キューは 4xx を
    // 「送っても通らない」として捨てるので、範囲外を 400 で断るとその選手の採点ごと黙って消える。
    // baseRev の無い採点の PATCH に限り、整数の補正点を ±999 に丸めて受理する（得点も丸めた分だけ
    // 差し引いて、補正点と合う値にする）。新しい画面（baseRev あり）は従来どおり 400。
    if (body.baseRev === undefined && SCORE_FIELDS.some(k => body[k] !== undefined)) {
      clampLegacyAdjust(body);
    }

    // ── 1. 形の検査（400）。ここではまだ何も書き換えない ──
    // 得点・補正点は範囲外なら要求全体を断る（以前は黙って無視し、他の項目だけ保存していた。網羅検証 S4）。
    if (body.score !== undefined && !isValidScore(body.score)) {
      return res.status(400).json({ error: '得点は -9999〜9999 の整数で指定してください' });
    }
    if (body.adjust !== undefined && !isValidAdjust(body.adjust)) {
      return res.status(400).json({ error: '補正点は3つとも -999〜999 の整数で指定してください' });
    }
    if (body.totalAdjust !== undefined && !isValidTotalAdjust(body.totalAdjust)) {
      return res.status(400).json({ error: '全体補正は -999〜999 の整数で指定してください' });
    }
    // result は 1=○, 0=×, 2=△（減点成功）, 空白=未入力 のエンコード（バンドル取込・CSV拡張取込と
    // 同じ規則）。それ以外の文字列（手入力の誤りなど）が混じると採点画面の decodeResult が
    // 読めずに壊れるため、緩く無視せず 400 で断る。
    if (body.result !== undefined) {
      if (typeof body.result !== 'string' || body.result.length > 100 || !/^[012 ]*$/.test(body.result)) {
        return res.status(400).json({ error: 'result が不正です' });
      }
    }
    // name は POST /api/events/:id/players（選手を1名追加）と同じ検証（trim 後 1〜100 文字）。
    // 空白だけの名前を通すと、順位表から静かに選手が消える（trim した名前で集計するため）。
    let newName;
    if (body.name !== undefined) {
      newName = typeof body.name === 'string' ? body.name.trim() : '';
      if (!newName || newName.length > NAME_MAX) {
        return res.status(400).json({ error: '選手名が必要です' });
      }
    }
    // 技名は前後の空白を落とし、50 字まで（網羅検証 S15。残った空白は技得点表の完全一致に掛からない）
    const newTechs = {};
    for (const key of ['tech1', 'tech2', 'tech3']) {
      if (typeof body[key] !== 'string') continue;
      const t = body[key].trim();
      if (t.length > TECH_NAME_MAX) return res.status(400).json({ error: TECH_TOO_LONG });
      newTechs[key] = t;
    }
    // 二巡目の形の申請（設計書 2026-10-03 3.3）。文字列のときだけ見る（技と同じ）。一巡目の行にだけ
    // 送れる（PATCH 後ではなく今の巡目で見る）。表に無い技名は見ない（画面が候補を絞り、試合開始の検査が見る）。
    const newR2 = {};
    for (const key of R2_TECH_KEYS) {
      if (typeof body[key] !== 'string') continue;
      const t = body[key].trim();
      if (t.length > TECH_NAME_MAX) return res.status(400).json({ error: TECH_TOO_LONG });
      newR2[key] = t;
    }
    const r2Sent = Object.keys(newR2).length > 0;
    if (r2Sent && EventStatus.roundOf(player) !== 1) {
      return res.status(400).json({ error: '二巡目の形は一巡目の行にだけ登録できます', reason: 'not_round1' });
    }
    if (body.baseRev !== undefined && !(Number.isInteger(body.baseRev) && body.baseRev >= 0)) {
      return res.status(400).json({ error: 'baseRev が不正です' });
    }
    // ゼッケン番号・級位段位・真剣レンタル（設計書「選手の追加項目」）。
    // 型が合わないものは 400 で断る（重複判定に関わる bib はもちろん、rank/rental も
    // POST と同じ検証を通す）。
    if (body.bib !== undefined && body.bib !== null && !isValidBibValue(body.bib)) {
      return res.status(400).json({ error: BIB_INVALID });
    }
    if (body.rank !== undefined && !isValidRankValue(body.rank)) {
      return res.status(400).json({ error: RANK_INVALID });
    }
    if (body.rental !== undefined && typeof body.rental !== 'boolean') {
      return res.status(400).json({ error: RENTAL_INVALID });
    }

    // ── 2. 採点の PATCH の版と状態（409 stale / not_scorable） ──
    const touchesScore = SCORE_FIELDS.some(k => body[k] !== undefined);
    if (touchesScore && body.baseRev !== undefined) {
      // この要求を当てたらどうなるか（採点の値だけ）。値が今と同じなら、タイムアウトで諦めたが
      // 実は届いていた要求の再送なので衝突にしない。
      const candidate = Object.assign({}, player);
      if (body.score !== undefined) candidate.score = body.score;
      if (body.result !== undefined) candidate.result = body.result;
      if (body.adjust !== undefined) candidate.adjust = body.adjust;
      if (body.totalAdjust !== undefined) candidate.totalAdjust = body.totalAdjust;
      if (typeof body.confirmed === 'boolean') candidate.confirmed = body.confirmed;
      if (body.baseRev !== EventStatus.revOf(player) && revFieldsDiffer(player, candidate, SCORE_FIELDS)) {
        return res.status(409).json({
          error: '別の端末で更新されています',
          reason: 'stale',
          player: playerWithRev(player)
        });
      }
      // status を持たない旧データの大会は検査しない（M6 の移行前の互換）。
      // 旧データの状態名は今の状態名に読み替えて判定する（設計書 2026-10-05 2.2）。
      const rowStatus = EventStatus.normalizeStatus(event.status);
      if (typeof event.status === 'string' && !force && !EventStatus.isRowScorable(rowStatus, player)) {
        return res.status(409).json({
          error: 'この選手は今の状態では採点できません',
          reason: 'not_scorable',
          status: rowStatus,
          player: playerWithRev(player)
        });
      }
    }

    // ── 3. 一巡目に元がある二巡目の行の氏名・性別・新人（409 linked。網羅検証 M1） ──
    // 同じ選手を指す 2 行が食い違わないよう、一巡目の行で直して二巡目へ写す。
    // 同じ値を送るのは通す（スマホの編集シートは全項目を送るため）。元の行が消えていれば直せる。
    const hasSource = isValidId(player.sourcePlayerId) &&
      event.players.some(p => p && p !== player && p.id === player.sourcePlayerId);
    const nameChanges = newName !== undefined && newName !== String(player.name || '').trim();
    const newFaceChanges = typeof body.isNewFace === 'boolean' && body.isNewFace !== (player.isNewFace === true);
    const femaleChanges = typeof body.isFemale === 'boolean' && body.isFemale !== (player.isFemale === true);
    if (hasSource && (nameChanges || newFaceChanges || femaleChanges)) {
      return res.status(409).json({
        error: '二巡目の行の氏名・性別・新人は一巡目の行で直してください',
        reason: 'linked'
      });
    }

    // ── 4. 採点済みの行の技・性別（409 scored。網羅検証 S7） ──
    // 技の差し替えは result の長さを変えないので採点画面が気付けず、古い ○× を新しい技の配点で
    // 読み直してしまう。性別は配点が男女で違う。画面が確認した上でだけ force で通す。
    // 性別は二巡目の行にも写るので、写る先が採点済みでも同じ扱い。
    const linkedRows = event.players.filter(p => p && p !== player && p.sourcePlayerId === player.id);
    const techChanges = Object.keys(newTechs).some(k => newTechs[k] !== String(player[k] || '').trim());
    if (!force && (
      ((techChanges || femaleChanges) && EventStatus.isScored(player)) ||
      (femaleChanges && linkedRows.some(p => EventStatus.isScored(p))))) {
      return res.status(409).json({
        error: '採点済みの選手の技・性別を変えると得点が変わります',
        reason: 'scored',
        player: playerWithRev(player)
      });
    }
    // 一巡目の行の二巡目の形（申請）を直すと、紐づく二巡目の行の技にも書き写す（設計書 2026-10-03 3.3.1）。
    // 書き写す先が採点済みなら force が要る（409 scored に linked＝その二巡目の行を付ける）。
    // 申請は変えず一巡目の形だけを直して二巡目の行が付いていく（2.5）のは未採点の行だけなので断らない。
    // 判定は EventStatus.round2SyncTarget（画面の Courts.round2LinkedScored と同じ）。
    // body.round で一巡目以外へ移す行は申請ごと消えるので、書き写さない。
    const syncRound2 = EventStatus.roundOf(player) === 1 && linkedRows.length > 0 &&
      (body.round === undefined || body.round === 1);
    if (syncRound2 && r2Sent && !force) {
      const r2After = Object.assign({}, player, newTechs, newR2);
      applyRound2Techs(r2After);
      const scoredLinked = linkedRows.find(L =>
        EventStatus.isScored(L) && EventStatus.round2SyncTarget(player, r2After, true, L));
      if (scoredLinked) {
        return res.status(409).json({
          error: '二巡目の行は採点済みです。二巡目の形を変えると得点が変わります',
          reason: 'scored',
          player: playerWithRev(player),
          linked: playerWithRev(scoredLinked)
        });
      }
    }

    // ── 5. ゼッケンの重複（409 bib） ──
    if (body.bib !== undefined && body.bib !== null) {
      const conflict = findBibConflict(event.players, body.bib, player.id);
      if (conflict) {
        return res.status(409).json({
          error: bibConflictMessage(body.bib, conflict.name),
          reason: 'bib'
        });
      }
    }

    // ── ここから書き換え（検査はすべて通った） ──
    Object.keys(newTechs).forEach(k => { player[k] = newTechs[k]; });
    // 申請は送られた枠だけ置き換える（送られていない枠は今の値）。正規化は order を組み直した後。
    Object.keys(newR2).forEach(k => { player[k] = newR2[k]; });
    if (newName !== undefined) player.name = newName;
    if (body.result !== undefined) player.result = body.result;
    ['isNewFace', 'isFemale'].forEach(key => {
      if (typeof body[key] === 'boolean') player[key] = body[key];
    });
    // bib は null で未設定に戻せる（既存の「無ければキーを持たない」形に合わせてキー自体を消す）。
    if (body.bib !== undefined) {
      if (body.bib === null) delete player.bib;
      else player.bib = body.bib;
    }
    if (body.rank !== undefined) player.rank = EventStatus.normalizeRank(body.rank);
    if (body.rental !== undefined) player.rental = body.rental;
    // 補正点（技ごと・全体）・得点は上で範囲を検査済み。補正点で負の合計になりうるので負数も受理する。
    if (body.adjust !== undefined) player.adjust = body.adjust.slice();
    if (body.totalAdjust !== undefined) player.totalAdjust = body.totalAdjust;
    if (body.score !== undefined) player.score = body.score;
    // 備考・確定は型が合わなければ黙って無視する（従来どおり）。
    if (typeof body.note === 'string') player.note = body.note.trim().slice(0, 200);
    if (typeof body.confirmed === 'boolean') player.confirmed = body.confirmed;

    // court / round / isFemale が来たときだけ order を組み立て直す。
    // ただし (コート, 性別, 巡目) が実際に変わったときだけにする。
    // 運営フォームは保存のたびに isFemale を送るため、変わっていないのに
    // 採番し直すと編集のたびに番号が動いてしまう。
    if (body.court !== undefined || body.round !== undefined ||
        typeof body.isFemale === 'boolean') {
      const cur = parseOrder(player.order || '');
      let court;
      if (body.court !== undefined) {
        court = typeof body.court === 'string' ? body.court.trim() : '';
        if (!isValidCourt(court)) {
          return res.status(400).json({ error: '不正なコート名です' });
        }
      } else {
        court = cur ? cur.court : '';
      }
      // round を省略したときは現在の order の巡目を据え置く（一巡目扱いにしない）。
      const round = body.round !== undefined ? body.round : EventStatus.roundOf(player);
      if (!Number.isInteger(round) || round < 1 || round > 9) {
        return res.status(400).json({ error: '不正な巡目です' });
      }
      const seg = genderSeg(event, player.isFemale === true);
      // order を解析できない選手（CSV由来の空 order など）は、
      // コートの指定が無い限り触らない。混合の大会は性別を変えても性別の段が '混合' のままなので order は変わらない。
      const changed = cur
        ? (cur.court !== court || cur.gender !== seg || cur.round !== round)
        : (body.court !== undefined);
      // body.court は上で検証済み。指定が無いときは現在の order のコートをそのまま使う
      // （'未分類' でも再検証しない。再検証すると isFemale だけ書き換わって order と食い違う）。
      if (changed && court) {
        const others = event.players.filter((p, i) => i !== playerIndex);
        player.order = buildOrder(court, seg, round,
          nextOrderNumber(others, court, seg, round));
      }
    }

    // 一巡目の行の変更を、sourcePlayerId でその行に紐づく二巡目の行にも写す。
    // 二巡目生成が一巡目の値を複製しているのと同じ選手を指すため、一巡目だけ更新すると食い違う。
    //   bib / rank / rental … 従来どおり
    //   name / isNewFace / isFemale … 網羅検証 M1（以前は写さず、氏名で合算する順位が 2 行に割れた）。
    //     二巡目の行ではこの 3 つを直せない（上の linked）ので、一巡目で直したものがそのまま写る。
    //     性別を写すとき、order の性別も組み直す（番号はその組の最大+1）。
    // player が一巡目行でなければ linkedRows は空なので何もしない。
    //   tech1〜3 … 二巡目の形（申請）を直した・申請の無い選手の一巡目の形を直した（設計書 2026-10-03
    //     3.3.1。EventStatus.round2SyncTarget。採点済みの行への書き写しは上の 409 scored を越えた force のときだけ）
    // 申請の正規化（2.3）: 申請を送ったときだけ置き直す。技だけの PATCH では申請に触らない
    // （一巡目の形を一時的に申請と同じにしただけで申請が黙って消え、戻しても復活しないため。レビュー指摘）。
    // body.round で一巡目以外へ移った行は申請を消す。
    if (r2Sent || (body.round !== undefined && EventStatus.roundOf(player) !== 1)) applyRound2Techs(player);
    const nameCopied = newName !== undefined && String(player.name || '') !== String(before.name || '');
    const linkedOut = [];
    linkedRows.forEach(p => {
      const rowBefore = Object.assign({}, p);
      const target = (syncRound2 && EventStatus.roundOf(player) === 1)
        ? EventStatus.round2SyncTarget(before, player, r2Sent, p) : null;
      if (target) {
        p.tech1 = target[0];
        p.tech2 = target[1];
        p.tech3 = target[2];
      }
      if (body.bib !== undefined) {
        if (Number.isInteger(player.bib)) p.bib = player.bib; else delete p.bib;
      }
      if (body.rank !== undefined) p.rank = player.rank;
      if (body.rental !== undefined) p.rental = player.rental;
      if (nameCopied) p.name = player.name;
      if (newFaceChanges) p.isNewFace = player.isNewFace === true;
      if (femaleChanges) {
        p.isFemale = player.isFemale === true;
        const parsed = parseOrder(p.order || '');
        if (parsed) {
          const seg = genderSeg(event, p.isFemale === true);
          if (parsed.gender !== seg) {
            const others = event.players.filter(q => q !== p);
            p.order = buildOrder(parsed.court, seg, parsed.round,
              nextOrderNumber(others, parsed.court, seg, parsed.round));
          }
        }
      }
      bumpRevIfChanged(rowBefore, p);
      if (JSON.stringify(rowBefore) !== JSON.stringify(p)) linkedOut.push(p);
    });

    // 二巡目の行の技を直したら、元の一巡目の行の申請に書き戻す（設計書 2026-10-03 2.4・3.3.2）。
    // 新しい形が一巡目の行の tech1〜3 と 3 つとも同じなら申請を空に、違えばその 3 つを入れる。
    // 一巡目の行の rev は上げない（申請は版の項目ではない）。
    let sourceOut = null;
    if (EventStatus.roundOf(before) === 2 && isValidId(player.sourcePlayerId) &&
        !EventStatus.sameTechs([before.tech1, before.tech2, before.tech3], [player.tech1, player.tech2, player.tech3])) {
      const src = event.players.find(p => p && p !== player && p.id === player.sourcePlayerId);
      if (src && EventStatus.roundOf(src) === 1) {
        R2_TECH_KEYS.forEach((k, i) => {
          const v = player['tech' + (i + 1)];
          src[k] = typeof v === 'string' ? v : '';
        });
        applyRound2Techs(src);
        sourceOut = src;
      }
    }

    bumpRevIfChanged(before, player);
    event.players[playerIndex] = player;
    event.updatedAt = new Date().toISOString();

    writeJsonAtomic(eventPath, event);
    const out = { success: true, player: playerWithRev(player) };
    // 書き換えた相手の行（画面がその行だけ差し替える。設計書 3.3.3）
    if (linkedOut.length > 0) out.linked = linkedOut.map(playerWithRev);
    if (sourceOut) out.source = playerWithRev(sourceOut);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id/players/:playerId : 選手を削除
// 採点済みなら 409 で得点を返して拒否し、?force=1 のときだけ通す。
// 削除後の再採番はしない。order は表示と並び順のためだけの値であり、
// 再採番すると採点中の端末が持つラベルと絞り込み対象が実行中に動いてしまう。
// 一巡目を消しても、sourcePlayerId で結ばれた二巡目の行はそのまま残す（二巡目の採点を消さない）。
app.delete('/api/events/:id/players/:playerId', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    if (!isValidId(req.params.playerId)) {
      return res.status(400).json({ error: '不正な選手IDです' });
    }
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    const players = Array.isArray(event.players) ? event.players : [];
    const idx = players.findIndex(p => p && p.id === req.params.playerId);
    if (idx === -1) {
      return res.status(404).json({ error: '選手が見つかりません' });
    }

    const target = players[idx];
    if (EventStatus.isScored(target) && req.query.force !== '1') {
      return res.status(409).json({
        error: '採点済みの選手です',
        player: {
          name: target.name || '',
          order: target.order || '',
          score: Number(target.score) || 0
        }
      });
    }

    players.splice(idx, 1);
    event.players = players;
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CSV の形式（設計書 2026-10-01-audit-fixes-design.md 5 章。網羅検証 M5） ──
// 1 行目（見出し）を厳密に照合して形式を決める。見出しを見ずに列の位置だけで読むと、
// Shift_JIS を UTF-8 として読んで化けた CSV や、違うファイルが「成功」として取り込まれてしまう。
// 照合の前に各セルの空白（半角・全角）と先頭の BOM、見出しの末尾の空セル（Excel が付ける）を落とし、
// 技の列は「技1」「技①」を同じものとして扱う（「技 1」は空白を落として「技1」）。
//   簡易形式 … CSV_SIMPLE_COLS の先頭から 2 列以上（1 列目は「選手名」も可）。順番はサーバが採番
//   従来形式 … 9 列 / 12 列（9＋ゼッケン等）/ 15 列（9＋補正点等）/ 18 列 / 20 列（18＋決戦の列・一巡目の行）
//             / 23 列（20＋二巡目 技 1〜3。設計書 2026-10-03 3.6）
// 簡易形式の 11〜13 列目は二巡目の形の申請（二巡目技①②③）。
const CSV_SIMPLE_COLS = ['名前', 'コート', '性別', '技①', '技②', '技③', '新人', 'ゼッケン', '級位段位', 'レンタル',
  '二巡目技①', '二巡目技②', '二巡目技③'];
const CSV_STD_BASE = ['選手名', '順番', '技 1', '技 2', '技 3', '得点', '新人', '女子', '結果'];
const CSV_STD_ADJ = ['補正点1', '補正点2', '補正点3', '全体補正', '備考', '確定'];
const CSV_EXTRA = ['ゼッケン', '級位段位', 'レンタル'];
// 決戦の列（互換のため列名だけ残す。書き出しは空、読み込みは無視。設計書 2026-10-05 D2）と、
// 二巡目の行が指す一巡目の行（その行の order。書き出し→置換で往復させる）。
const CSV_ROUNDTRIP = ['決戦', '一巡目の行'];
// 二巡目の形の申請（一巡目の行の r2tech1〜3。二巡目の行は常に空）。既存の列の位置を変えないよう末尾に足す。
const CSV_R2TECH = ['二巡目 技 1', '二巡目 技 2', '二巡目 技 3'];
// 往復できる 20 列（以前の書き出し。読み込みだけ）
const CSV_ROUNDTRIP_HEADER_20 = CSV_STD_BASE.concat(CSV_STD_ADJ, CSV_EXTRA, CSV_ROUNDTRIP);
// 書き出す見出し（23 列の拡張形式。これと 20 列だけが二巡目のある大会の置換・追記に使える）
const CSV_EXPORT_HEADER = CSV_ROUNDTRIP_HEADER_20.concat(CSV_R2TECH);

function normalizeCsvHeaderCell(cell, index) {
  let s = String(cell == null ? '' : cell);
  if (index === 0) s = s.replace(/^﻿/, '');
  s = s.replace(/[\s　]+/g, '');
  return s.replace(/^(二巡目)?技([①②③])$/, (m, r2, d) => (r2 || '') + '技' + ('①②③'.indexOf(d) + 1));
}

function sameCsvHeader(actual, expected) {
  if (actual.length !== expected.length) return false;
  const want = expected.map(normalizeCsvHeaderCell);
  return actual.every((c, i) => c === want[i]);
}

// 見出し行から形式を決める。既知の形式でなければ null。
// 戻り値: { kind: 'simple', columns } | { kind: 'std', adj, extraBase, roundtrip, r2 }
//   roundtrip … 往復できる形式（20 列か 23 列）。r2 … 二巡目 技 1〜3 の列がある（23 列）
//   extraBase … ゼッケン列の位置（無ければ -1）
function detectCsvFormat(headerRow) {
  const cells = (headerRow || []).map(normalizeCsvHeaderCell);
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  if (cells.length >= 2 && cells[1] === 'コート') {
    if (cells.length > CSV_SIMPLE_COLS.length) return null;
    const want = CSV_SIMPLE_COLS.map(normalizeCsvHeaderCell);
    for (let i = 0; i < cells.length; i++) {
      if (i === 0 && (cells[0] === '名前' || cells[0] === '選手名')) continue;
      if (cells[i] !== want[i]) return null;
    }
    return { kind: 'simple', columns: cells.length };
  }
  const candidates = [
    { cols: CSV_STD_BASE, adj: false, extraBase: -1, roundtrip: false },
    { cols: CSV_STD_BASE.concat(CSV_EXTRA), adj: false, extraBase: 9, roundtrip: false },
    { cols: CSV_STD_BASE.concat(CSV_STD_ADJ), adj: true, extraBase: -1, roundtrip: false },
    { cols: CSV_STD_BASE.concat(CSV_STD_ADJ, CSV_EXTRA), adj: true, extraBase: 15, roundtrip: false },
    { cols: CSV_ROUNDTRIP_HEADER_20, adj: true, extraBase: 15, roundtrip: true, r2: false },
    { cols: CSV_EXPORT_HEADER, adj: true, extraBase: 15, roundtrip: true, r2: true }
  ];
  for (const c of candidates) {
    if (sameCsvHeader(cells, c.cols)) {
      return { kind: 'std', adj: c.adj, extraBase: c.extraBase, roundtrip: c.roundtrip, r2: c.r2 === true };
    }
  }
  return null;
}

// CSV のセルの数値。空は 0、数値として読めなければ 0。範囲と整数化は sanitizePlayerForSave が行う。
function csvNumber(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
// 補正点のセル。小数は切り捨てる（範囲外は sanitizePlayerForSave が落とす）。
function csvInt(v) {
  return Math.trunc(csvNumber(v));
}

// POST /api/events/:id/import : 選手データのCSVインポート
// Body: { csvText, mode: 'replace' | 'append', force?, expectedCount? }
// 検査の順（設計書 2026-10-01 5.2。最初に当たったもので返し、何も書かない）:
//   locked（409）→ expectedCount の食い違い（409 stale。replace のときだけ）→ 文字化け（400 encoding）
//   → 見出し（400 format）→ 二巡目がある大会への往復できない形式の置換・追記（409 round2_format）
//   → 採点済みの置換（409。force で越えられる）→ 行ごとの検査（簡易形式のコート名は 400）
// 値は sanitizePlayerForSave と同じ規則で洗う（氏名 100 字・技 trim 50 字・得点 -9999〜9999 の整数・
// 補正点 ±999・級位段位の正規化など）。
app.post('/api/events/:id/import', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const csvText = typeof body.csvText === 'string' ? body.csvText : '';
    const mode = body.mode === 'replace' ? 'replace' : 'append';
    const force = body.force === true;
    const current = Array.isArray(event.players) ? event.players : [];

    // 画面が見ていた選手数と違えば置換しない（0 名と表示している古い画面から、確認なしで
    // 他の端末が登録した選手を消さないため。網羅検証 M5）。送らない古い画面は従来どおり。
    if (mode === 'replace' && body.expectedCount !== undefined) {
      if (!Number.isInteger(body.expectedCount) || body.expectedCount < 0) {
        return res.status(400).json({ error: 'expectedCount が不正です' });
      }
      if (body.expectedCount !== current.length) {
        return res.status(409).json({
          error: '選手の人数が変わっています。画面を読み直してからやり直してください',
          reason: 'stale',
          playerCount: current.length
        });
      }
    }

    // UTF-8 として読めなかった文字（U+FFFD）が残っていれば断る。画面は Shift_JIS で読み直してから送る。
    if (csvText.indexOf('�') !== -1) {
      return res.status(400).json({
        error: '文字化けした文字があります。CSV を UTF-8 か Shift_JIS で保存し直してください',
        reason: 'encoding'
      });
    }

    const lines = parseCSV(csvText);
    if (lines.length === 0) {
      return res.status(400).json({ error: '空のデータです' });
    }
    const fmt = detectCsvFormat(lines[0]);
    if (!fmt) {
      return res.status(400).json({
        error: 'CSV の見出し（1 行目）が読み込める形式ではありません',
        reason: 'format'
      });
    }

    // 二巡目の行がある大会を、一巡目とのつながりを持たない形式で置き換えると、
    // 二巡目の行が追跡できなくなる。追記でも、9 列などの形式では二巡目の行が
    // 一巡目とのつながり無しに増えうる（通し試験の所見 C）。置換・追記とも、往復できる 23 列
    // （以前の 20 列も可）の形式だけ許す（force でも越えない）。20 列で置き換えると二巡目の形の申請は
    // 空になるが、二巡目の行の形（実際の形）は 3〜5 列目で往復する（設計書 2026-10-03 3.6.2）。
    if (current.some(p => EventStatus.roundOf(p) === 2) && !(fmt.kind === 'std' && fmt.roundtrip)) {
      return res.status(409).json({
        error: '二巡目がある大会には、CSV エクスポートで書き出した形のファイル（23 列。以前の 20 列も可）だけ取り込めます（置換・追記とも）',
        reason: 'round2_format'
      });
    }

    // replace は players 配列を丸ごと置換するため、採点済みデータがあると
    // 他コートの採点まで消える。件数を返して拒否し、明示的な force のときだけ通す。
    if (mode === 'replace' && !force) {
      const scoredCount = current.filter(EventStatus.isScored).length;
      if (scoredCount > 0) {
        return res.status(409).json({
          error: '採点済みのデータがあります',
          scoredCount: scoredCount
        });
      }
    }

    const dataLines = lines.slice(1);
    const truthy = v => ['○', '1', 'はい', '新人'].indexOf(String(v || '').trim()) !== -1;
    const femaleMark = v => ['女', '女子', '○', 'F', 'f'].indexOf(String(v || '').trim()) !== -1;
    const mark = v => String(v == null ? '' : v).trim() === '○';
    // ゼッケンの重複（2件目以降）・範囲外の値は行ごと 400 にはせず「未設定」に落として
    // 取り込みを続ける。落とした件数は bibDropped として応答に含める（下の resolveBibDrops）。
    // append 時は既存選手の bib も重複判定に含める（replace/新規は空）。
    const existingBibsForImport = mode === 'replace' ? [] :
      current.filter(p => Number.isInteger(p && p.bib)).map(p => p.bib);

    let importedPlayers;
    let bibDropped = { duplicate: 0, outOfRange: 0 };
    if (fmt.kind === 'simple') {
      // 簡易形式（名前,コート,性別,技①,技②,技③,新人[,ゼッケン,級位段位,レンタル,二巡目技①,二巡目技②,二巡目技③] の先頭から）。
      // 見出しに無い列は読まない。順番はサーバーが採番する（採番の土台: replace なら空、append なら既存）。
      const has = i => fmt.columns > i;
      const base = mode === 'replace' ? [] : current;
      importedPlayers = [];
      const rawBibs = [];
      for (let i = 0; i < dataLines.length; i++) {
        const row = dataLines[i];
        const name = String(row[0] || '').trim();
        if (!name) continue;
        const court = String(row[1] || '').trim();
        if (!isValidCourt(court)) {
          return res.status(400).json({ error: (i + 2) + ' 行目のコート名が不正です' });
        }
        const isFemale = has(2) && femaleMark(row[2]);
        const seg = genderSeg(event, isFemale);
        const n = nextOrderNumber(base.concat(importedPlayers), court, seg, 1);
        importedPlayers.push(sanitizePlayerForSave({
          name: name,
          order: buildOrder(court, seg, 1, n),
          // 末尾に空白が残ると Scoring.findTechnique の完全一致に掛からず配点が
          // 全部0になる（手入力・コピペ由来の空白は sanitizePlayerForSave が落とす）。
          tech1: has(3) ? String(row[3] || '') : '',
          tech2: has(4) ? String(row[4] || '') : '',
          tech3: has(5) ? String(row[5] || '') : '',
          score: 0,
          isNewFace: has(6) && truthy(row[6]),
          isFemale: isFemale,
          result: '',
          rank: has(8) ? String(row[8] || '').trim().slice(0, 20) : '',
          rental: has(9) && truthy(row[9]),
          // 二巡目の形の申請（11〜13 列目。技名の検証はしない＝試合開始の検査で止まる）
          r2tech1: has(10) ? String(row[10] || '') : '',
          r2tech2: has(11) ? String(row[11] || '') : '',
          r2tech3: has(12) ? String(row[12] || '') : ''
        }, generateId(), null, null));
        rawBibs.push(has(7) ? row[7] : undefined);
      }
      const bibResult = resolveBibDrops(rawBibs, classifyBibCsv, existingBibsForImport);
      importedPlayers.forEach((p, i) => { if (bibResult.bibs[i] !== null) p.bib = bibResult.bibs[i]; });
      bibDropped = { duplicate: bibResult.duplicate, outOfRange: bibResult.outOfRange };
    } else {
      // 従来形式。列の意味は見出しで決まる（行ごとに列数を見ない。崩れた CSV で挙動を揺らさない）。
      // 選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果[,補正点1,補正点2,補正点3,全体補正,備考,確定]
      //   [,ゼッケン,級位段位,レンタル][,決戦,一巡目の行][,二巡目 技 1,二巡目 技 2,二巡目 技 3]
      //   （決戦の列は互換のため列名だけ残す。19 列目は読み飛ばす）
      const rows = [];
      dataLines.forEach(row => {
        const raw = {
          name: String(row[0] || ''),
          order: String(row[1] || '').trim(),
          tech1: String(row[2] || ''),
          tech2: String(row[3] || ''),
          tech3: String(row[4] || ''),
          score: csvNumber(row[5]),
          isNewFace: mark(row[6]),
          isFemale: mark(row[7]),
          // 結果は 1=○, 0=×, 2=△（減点成功）, 空白=未入力 のエンコード。それ以外（手入力・
          // 崩れたCSV由来の誤り）は sanitizePlayerForSave が空に落とす。空白に意味があるので trim しない。
          result: typeof row[8] === 'string' ? row[8] : ''
        };
        if (fmt.adj) {
          raw.adjust = [csvInt(row[9]), csvInt(row[10]), csvInt(row[11])];
          raw.totalAdjust = csvInt(row[12]);
          raw.note = String(row[13] || '');
          raw.confirmed = mark(row[14]);
        }
        if (fmt.extraBase >= 0) {
          raw.rank = String(row[fmt.extraBase + 1] || '').trim().slice(0, 20);
          raw.rental = truthy(row[fmt.extraBase + 2]);
        }
        // 23 列: 21〜23 列目は二巡目の形の申請（二巡目の行の値は sanitizePlayerForSave が捨てる）
        if (fmt.r2) {
          raw.r2tech1 = String(row[20] || '');
          raw.r2tech2 = String(row[21] || '');
          raw.r2tech3 = String(row[22] || '');
        }
        const p = sanitizePlayerForSave(raw, generateId(), null, null);
        if (!p.name) return;   // 空行等を除外（氏名は trim して見る）
        rows.push({
          player: p,
          rawBib: fmt.extraBase >= 0 ? row[fmt.extraBase] : undefined,
          sourceOrder: fmt.roundtrip ? String(row[19] || '').trim() : ''
        });
      });
      // 拡張形式は order をそのまま使うので、性別の段（男子・女子・混合）が大会の分け方と食い違う
      // CSV は取り込めない（混合の大会の CSV を分ける大会へ、またはその逆）。何も保存せず断る。
      // 簡易形式（上の枝）はサーバーが採番するので対象外。設計書 2026-10-07 §4。
      const mixedNow = isMixedEvent(event);
      const mismatch = rows.some(r => {
        const parsed = parseOrder(r.player.order);
        return parsed && (parsed.gender === '混合') !== mixedNow;
      });
      if (mismatch) {
        return res.status(400).json({
          error: '男女の分け方（混合）が違う大会の CSV です。基本情報の「男女を分けずに進める（混合）」を合わせてから取り込んでください',
          reason: 'mixed_mismatch'
        });
      }
      // 拡張形式は「順番」列（p.order）から巡目が分かる。二巡目以降の行は一巡目の複製と
      // 同じ bib を持つのが正常な状態なので、重複判定の対象外にして値をそのまま通す
      // （レビュー修正。簡易形式は順番をサーバーが採番するので常に一巡目＝対象）。
      const roundOfRow = rows.map(r => EventStatus.roundOf(r.player));
      const round1RawBibs = rows.filter((r, i) => roundOfRow[i] === 1).map(r => r.rawBib);
      const bibResult = resolveBibDrops(round1RawBibs, classifyBibCsv, existingBibsForImport);
      let round1Cursor = 0;
      importedPlayers = rows.map((r, i) => {
        if (roundOfRow[i] === 1) {
          const v = bibResult.bibs[round1Cursor++];
          if (v !== null) r.player.bib = v;
        } else {
          const v = classifyBibCsv(r.rawBib);
          if (typeof v === 'number') r.player.bib = v;
        }
        return r.player;
      });
      bibDropped = { duplicate: bibResult.duplicate, outOfRange: bibResult.outOfRange };
      // 20 列・23 列の形式: 二巡目の行の「一巡目の行」（一巡目の order）を、取り込んだ一巡目の行の id に
      // つなぎ直す（sourcePlayerId の往復）。order がちょうど 1 行に一致するときだけ。
      if (fmt.roundtrip) {
        const byOrder = Object.create(null);
        importedPlayers.forEach((p, i) => {
          if (roundOfRow[i] !== 1 || !p.order) return;
          byOrder[p.order] = byOrder[p.order] ? null : p;   // 2 行目以降は曖昧（null）
        });
        rows.forEach((r, i) => {
          if (roundOfRow[i] === 1 || !r.sourceOrder) return;
          const src = byOrder[r.sourceOrder];
          if (src) r.player.sourcePlayerId = src.id;
        });
      }
    }

    if (mode === 'replace') {
      event.players = importedPlayers;
    } else {
      event.players = current.concat(importedPlayers);
    }

    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);

    res.json({ success: true, playerCount: event.players.length, bibDropped: bibDropped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id/export : 大会の選手データをCSVエクスポート
// 23 列の拡張形式（CSV_EXPORT_HEADER）。「一巡目の行」（sourcePlayerId が指す行の order）を
// 出すので、書き出し→置換取り込みで一巡目とのつながりが往復する（網羅検証 M5）。
// 19 列目（決戦の列）は互換のため列名だけ残し、常に空（設計書 2026-10-05 D2）。
// 末尾の 3 列は一巡目の行の二巡目の形の申請（申請が無ければ空。二巡目の行は常に空。設計書 2026-10-03 3.6.1）。
app.get('/api/events/:id/export', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    const players = Array.isArray(event.players) ? event.players : [];
    const byId = Object.create(null);
    players.forEach(p => { if (p && typeof p.id === 'string') byId[p.id] = p; });

    const rows = [CSV_EXPORT_HEADER];

    for (const p of players) {
      if (!p) continue;
      const adj = Array.isArray(p.adjust) ? p.adjust : [0, 0, 0];
      const src = (typeof p.sourcePlayerId === 'string' && Object.prototype.hasOwnProperty.call(byId, p.sourcePlayerId))
        ? byId[p.sourcePlayerId] : null;
      const r2 = EventStatus.roundOf(p) === 1 ? EventStatus.normalizedRound2Techs(p) : null;
      rows.push([
        p.name || '',
        p.order || '',
        p.tech1 || '',
        p.tech2 || '',
        p.tech3 || '',
        p.score != null ? p.score : 0,
        p.isNewFace ? '○' : '',
        p.isFemale ? '○' : '',
        p.result || '',
        Number(adj[0]) || 0,
        Number(adj[1]) || 0,
        Number(adj[2]) || 0,
        Number(p.totalAdjust) || 0,
        p.note || '',
        p.confirmed === true ? '○' : '',
        Number.isInteger(p.bib) ? p.bib : '',
        p.rank || '',
        p.rental === true ? '○' : '',
        '',
        src ? (src.order || '') : '',
        r2 ? r2[0] : '',
        r2 ? r2[1] : '',
        r2 ? r2[2] : ''
      ]);
    }

    const csvContent = rows.map(row => row.map(escapeCSV).join(',')).join('\r\n');
    const bom = '﻿';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="event_${req.params.id}.csv"`);
    res.send(bom + csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Event Techniques API ──
// 大会ごとの技マスタ。雛形（GET/POST/DELETE /api/techniques）とは別物で、
// 大会 JSON の techniques に持つ。読み出しは必ず effectiveTechniques を通す。

const STRIKE_LABELS = ['初太刀', '二ノ太刀', '三ノ太刀', '四ノ太刀'];

// 技リストの検証。PUT /api/events/:id/techniques と POST /api/events/import で共用する。
// 戻り値: エラー文字列（日本語。行番号は1始まり） or null（妥当）
// 技名は trim して比較する。'胸尽くし(男)' と '胸尽くし(女)' は別名として扱う（そのまま別の文字列）。
function validateTechniques(list) {
  if (!Array.isArray(list)) return '技リストが配列ではありません';
  if (list.length < 1 || list.length > 200) return '技は1〜200件で指定してください';
  const seen = Object.create(null);   // 技名が '__proto__' でも壊れないように
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const n = i + 1;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return n + ' 行目の形式が不正です';
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!name) return n + ' 行目の技名が空です';
    if (name.length > 50) return n + ' 行目の技名が長すぎます（50文字まで）';
    if (seen[name]) return n + ' 行目の技名「' + name + '」が重複しています';
    seen[name] = true;
    if (!Array.isArray(t.strikes) || t.strikes.length !== 4) return n + ' 行目の配点は4つ必要です';
    for (let s = 0; s < 4; s++) {
      const v = t.strikes[s];
      if (v === null) continue;
      if (!Number.isInteger(v) || v < 0 || v > 99) {
        return n + ' 行目の' + STRIKE_LABELS[s] + 'の配点が不正です（0〜99の整数か空）';
      }
    }
    // drawn（抜刀後の形）は省略可。省略時は cloneTechniques が false にする。
    if (t.drawn !== undefined && typeof t.drawn !== 'boolean') {
      return n + ' 行目の「抜刀状態」の指定が不正です';
    }
    // repeatable（同じ巡で何度でも可）は省略可。省略時は cloneTechniques が false にする
    // （設計書 2026-09-20-rules-alignment-design.md）。
    if (t.repeatable !== undefined && typeof t.repeatable !== 'boolean') {
      return n + ' 行目の「回数制限」の指定が不正です';
    }
    // reducedFirst（減点成功△の初太刀の配点）は省略・null か 0〜99 の整数。省略時は cloneTechniques が null にする。
    if (t.reducedFirst !== undefined && t.reducedFirst !== null) {
      const rf = t.reducedFirst;
      if (!Number.isInteger(rf) || rf < 0 || rf > 99) {
        return n + ' 行目の「減点初太刀」の配点が不正です（0〜99の整数か空）';
      }
    }
    // note（備考）は省略可。文字列で 100 文字まで（技得点表の右端の列。得点には関わらない）。
    if (t.note !== undefined && t.note !== null) {
      if (typeof t.note !== 'string') return n + ' 行目の備考の形式が不正です';
      if (t.note.trim().length > 100) return n + ' 行目の備考が長すぎます（100文字まで）';
    }
  }
  return null;
}

// GET /api/events/:id/techniques : その大会の有効な技リスト
app.get('/api/events/:id/techniques', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    res.json({ source: techniquesSourceOf(event), techniques: effectiveTechniques(event) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 技得点表の差し替えで、選手が使っている技が消えないかを調べる（網羅検証 M3。設計書 2026-10-01 3 章）。
// 選手の技名（接尾辞なしの表示名のことがある）を選手の性別で今の表に解決し、新しい表でも
// 解決できなければ「消える技」。今の表でも解決できない技名（もともと表に無い）は数えない。
// renames（[{ from, to }]。表の名前）の from に解決される技は、選手の技名を付け替える案を作る:
//   選手の値が from そのもの → to、接尾辞なしの表示名 → to の接尾辞を外した名前
//   （新しい表で同じ性別に解決できることを確かめる。できなければ消える技のまま）。
// players は書き換えない。戻り値: { vanished: [{ name, count }]（今の表の順）, count, changes: [{ player, key, value }] }
function planTechniqueChange(players, oldList, newList, renames) {
  const renameTo = Object.create(null);
  (renames || []).forEach(r => { renameTo[r.from] = r.to; });
  const vanishedRows = Object.create(null);   // 今の表の名前 -> 行の数
  const changes = [];
  let count = 0;
  (players || []).forEach(p => {
    if (!p || typeof p !== 'object') return;
    const isFemale = p.isFemale === true;
    let affected = false;
    const seenHere = Object.create(null);
    // 二巡目の形の申請（r2tech1〜3）も「使っている技」に含めて同じ規則で付け替える（設計書 2026-10-03 3.5）。
    // 同じ行の tech と r2tech に同じ技があっても、消える技の数え方は 1 行（seenHere）。
    ['tech1', 'tech2', 'tech3', 'r2tech1', 'r2tech2', 'r2tech3'].forEach(key => {
      const v = String(p[key] == null ? '' : p[key]).trim();
      if (!v) return;
      const oldRes = resolveTechnique(oldList, v, isFemale);
      if (!oldRes) return;
      if (resolveTechnique(newList, v, isFemale)) return;
      if (Object.prototype.hasOwnProperty.call(renameTo, oldRes.name)) {
        const to = renameTo[oldRes.name];
        const value = v === oldRes.name ? to : stripGenderSuffix(to);
        const res2 = resolveTechnique(newList, value, isFemale);
        if (res2 && res2.name === to) {
          changes.push({ player: p, key: key, value: value });
          return;
        }
      }
      affected = true;
      if (!seenHere[oldRes.name]) {
        seenHere[oldRes.name] = true;
        vanishedRows[oldRes.name] = (vanishedRows[oldRes.name] || 0) + 1;
      }
    });
    if (affected) count++;
  });
  const vanished = (oldList || [])
    .filter(t => t && Object.prototype.hasOwnProperty.call(vanishedRows, t.name))
    .map(t => ({ name: t.name, count: vanishedRows[t.name] }));
  return { vanished: vanished, count: count, changes: changes };
}

// renames の検証。戻り値: エラー文字列 or null（妥当）。
function validateTechniqueRenames(renames, oldList, newList) {
  if (renames === undefined || renames === null) return null;
  if (!Array.isArray(renames) || renames.length > 200) return '技名の付け替えの指定が不正です';
  const has = (list, name) => (list || []).some(t => t && t.name === name);
  const seen = Object.create(null);
  for (const r of renames) {
    if (!r || typeof r !== 'object' || typeof r.from !== 'string' || typeof r.to !== 'string' ||
        !r.from || !r.to) {
      return '技名の付け替えの指定が不正です';
    }
    if (seen[r.from]) return '付け替え元「' + r.from + '」が重複しています';
    seen[r.from] = true;
    if (!has(oldList, r.from)) return '付け替え元「' + r.from + '」は今の技得点表にありません';
    if (has(newList, r.from)) return '付け替え元「' + r.from + '」が新しい技得点表にも残っています';
    if (!has(newList, r.to)) return '付け替え先「' + r.to + '」は新しい技得点表にありません';
  }
  return null;
}

// 技得点表の差し替えの共通部分（PUT と DELETE）。使用中の技が消えるなら 409 tech_in_use を返して true。
// 消えないなら付け替えを選手に当て（版の項目なので rev +1）、付け替えた行の数を out.renamed に入れて false。
function applyTechniqueChange(res, event, newList, renames, out) {
  const oldList = effectiveTechniques(event);
  const plan = planTechniqueChange(event.players, oldList, newList, renames);
  if (plan.vanished.length > 0) {
    res.status(409).json({
      error: '選手が使っている技が技得点表から消えます（' +
        plan.vanished.map(v => v.name).join('、') + '。' + plan.count + ' 名）',
      reason: 'tech_in_use',
      names: plan.vanished.map(v => v.name),
      count: plan.count,
      usages: plan.vanished
    });
    return true;
  }
  const touched = [];
  plan.changes.forEach(c => {
    if (touched.indexOf(c.player) === -1) touched.push(c.player);
  });
  touched.forEach(p => {
    const before = Object.assign({}, p);
    plan.changes.filter(c => c.player === p).forEach(c => { p[c.key] = c.value; });
    // 申請は付け替えのあとで正規化し直す（一巡目の形と同じになれば空）。rev は tech が変わった行だけ
    // +1（申請は版の項目ではない。bumpRevIfChanged が REV_FIELDS だけを見る）。
    if (EventStatus.hasRound2Techs(p)) applyRound2Techs(p);
    bumpRevIfChanged(before, p);
  });
  out.renamed = touched.length;
  return false;
}

// PUT /api/events/:id/techniques : その大会の技リストを置き換える
// Body: { techniques, renames?: [{ from, to }] }
// 選手が使っている技が消える差し替えは 409 tech_in_use（{ names, count, usages }）で断る。
// 改名のときは renames（今の表の名前 → 新しい表の名前）を付けて送り直すと、選手の技名も付け替える
// （設計書 2026-10-01 3.1）。削除は拒否のみ（採点画面でその行が 0 点になり、保存で ○× が消えるため）。
app.put('/api/events/:id/techniques', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const body = req.body || {};
    const invalid = validateTechniques(body.techniques);
    if (invalid) return res.status(400).json({ error: invalid });
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    const newList = cloneTechniques(body.techniques);
    const renameErr = validateTechniqueRenames(body.renames, effectiveTechniques(event), newList);
    if (renameErr) return res.status(400).json({ error: renameErr });
    const out = { renamed: 0 };
    if (applyTechniqueChange(res, event, newList, body.renames, out)) return;
    event.techniques = newList;
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ success: true, techniques: event.techniques, renamed: out.renamed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id/techniques : 雛形の複製で置き換える（「雛形に戻す」）
// 雛形との連動状態には戻さない。戻すと、あとで雛形を変えたときに採点中の大会の配点が動く。
// 選手が使っている技が雛形に無ければ PUT と同じく 409 tech_in_use（付け替えは無し）。
app.delete('/api/events/:id/techniques', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    const newList = cloneTechniques(readTechniques().techniques);
    if (applyTechniqueChange(res, event, newList, null, { renamed: 0 })) return;
    event.techniques = newList;
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ success: true, techniques: event.techniques });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Event Bundle API（大会1件の書き出し・取り込み） ──
// 大会情報＋技マスタ＋選手（全項目）＋採点履歴を1つの JSON にまとめる。
// 共有トークン（shareToken）と配信ボードの状態（live）は出さない。取り込み先で作り直す。

const BUNDLE_FORMAT = 'phx-tameshigiri-event';
const BUNDLE_VERSION = 1;

// Content-Disposition に入れるファイル名。
// クライアント側の同じ規則の実装は storage.js の Storage.bundleFilename
// （画面はサーバーのヘッダーを使わず自分で組む。規則が食い違ったら test.html の
//  bundleFilename のテストとこの関数を突き合わせること）。
function bundleFilename(name, date) {
  let safe = String(name == null ? '' : name)
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .slice(0, 40)
    .trim();
  if (!safe) safe = '大会';
  let d = String(date == null ? '' : date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = 'nodate';
  return 'tameshigiri_' + d + '_' + safe + '.json';
}

// エクスポートに出す選手の項目。ここに無いキーは出さない。
// adjust / totalAdjust / note / confirmed / sourcePlayerId / bib は持っている選手にだけ付ける
// （旧データの二巡目の行の決戦の印は出さない。設計書 2026-10-05 D2）。
// rank / rental は設計書の既定値（''・false）どおり常に出す（isNewFace 等と同じ扱い）。
function pickBundlePlayer(p) {
  const src = (p && typeof p === 'object') ? p : {};
  const out = {
    id: typeof src.id === 'string' ? src.id : '',
    name: typeof src.name === 'string' ? src.name : '',
    order: typeof src.order === 'string' ? src.order : '',
    tech1: typeof src.tech1 === 'string' ? src.tech1 : '',
    tech2: typeof src.tech2 === 'string' ? src.tech2 : '',
    tech3: typeof src.tech3 === 'string' ? src.tech3 : '',
    score: typeof src.score === 'number' ? src.score : 0,
    isNewFace: src.isNewFace === true,
    isFemale: src.isFemale === true,
    result: typeof src.result === 'string' ? src.result : '',
    rank: typeof src.rank === 'string' ? src.rank : '',
    rental: src.rental === true
  };
  if (Array.isArray(src.adjust)) out.adjust = src.adjust.slice();
  if (Number.isInteger(src.totalAdjust)) out.totalAdjust = src.totalAdjust;
  if (typeof src.note === 'string' && src.note !== '') out.note = src.note;
  if (src.confirmed === true) out.confirmed = true;
  if (isValidId(src.sourcePlayerId)) out.sourcePlayerId = src.sourcePlayerId;
  if (Number.isInteger(src.bib)) out.bib = src.bib;
  // 二巡目の形の申請（一巡目の行で申請があるときだけ。note と同じく「あるときだけ」。設計書 2026-10-03 3.7）。
  // BUNDLE_VERSION は 1 のまま（知らないキーを落とす古いサーバーでは申請が空になるだけ）。
  const r2 = EventStatus.roundOf(src) === 1 ? EventStatus.normalizedRound2Techs(src) : null;
  if (r2) R2_TECH_KEYS.forEach((k, i) => { out[k] = r2[i]; });
  return out;
}

// GET /api/events/:id/bundle : 大会1件を丸ごと書き出す
app.get('/api/events/:id/bundle', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    const historyPath = path.join(HISTORY_DIR, `${req.params.id}.json`);
    let entries = [];
    if (fs.existsSync(historyPath)) {
      try {
        const h = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        if (Array.isArray(h.entries)) entries = h.entries;
      } catch (e) {
        // 履歴が壊れていても大会の書き出しは止めない
      }
    }
    const bundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      sourceEventId: typeof event.id === 'string' ? event.id : req.params.id,
      event: {
        name: event.name || '',
        date: event.date || '',
        venue: event.venue || '',
        createdAt: event.createdAt || '',
        updatedAt: event.updatedAt || '',
        // 雛形を使っている大会も複製を書き出す。取り込み先の雛形に依存させない。
        techniques: effectiveTechniques(event),
        players: (Array.isArray(event.players) ? event.players : []).map(pickBundlePlayer)
      },
      history: entries
    };
    // settings（ゼッケン・級位段位の必須・コート一覧）。無い大会（古いバンドル）は書き出さない。
    // test（テスト大会の印）はここに含めない＝書き出さない（設計書「テスト大会」）。
    if (event.settings && typeof event.settings === 'object' && !Array.isArray(event.settings)) {
      bundle.event.settings = {
        requireBib: event.settings.requireBib === true,
        requireRank: event.settings.requireRank === true,
        mixed: event.settings.mixed === true,
        courts: sanitizeCourtList(event.settings.courts)
      };
    }
    // status（大会の状態）。status を持たない大会（この機能より前に作られた・取り込んだ大会）は
    // 書き出さない＝取り込み側は従来どおり選手から推定する。EventStatus.of の推定値を書いて
    // しまうと、取り込み先が「status を持つ大会」に変わり、以後推定し直さなくなってしまう
    // （POST /api/events が推定値を書き込まない理由と同じ）。
    // final/archived を含めそのまま書く（取り込み側でロックが効くようにするため）。旧データの状態名は
    // 今の状態名に直して書く（EventStatus.normalizeStatus。設計書 2026-10-05 2.2）。
    if (EventStatus.STATES.indexOf(EventStatus.normalizeStatus(event.status)) !== -1) {
      bundle.event.status = EventStatus.normalizeStatus(event.status);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // RFC 5987 の attr-char は英数字と一部の記号だけで、' ( ) * は含まれない。
    // encodeURIComponent はこの4文字をエスケープせずに残すため、追加で %XX にする。
    const encodedName = encodeURIComponent(bundleFilename(bundle.event.name, bundle.event.date))
      .replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodedName);
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    console.error('大会の書き出しに失敗:', err);
    res.status(500).json({ error: '大会の書き出しに失敗しました' });
  }
});

// POST /api/events/import : エクスポートファイル1件を新しい大会として取り込む
// 常に新しい ID を採番する（既存の大会は上書きしない）。
// event の id / shareToken / live は入っていても無視する。
// 大会ファイルと履歴ファイルはどちらも新しい ID の新規作成なので、
// 他端末との read-modify-write の競合は起きない（writeJsonAtomic を2回呼ぶ）。
app.post('/api/events/import', (req, res) => {
  try {
    const bundle = req.body || {};
    if (bundle.format !== BUNDLE_FORMAT) {
      return res.status(400).json({ error: 'このアプリのエクスポートファイルではありません' });
    }
    if (bundle.version !== BUNDLE_VERSION) {
      return res.status(400).json({ error: '対応していないファイル形式です（version: ' + bundle.version + '）' });
    }
    const src = bundle.event;
    if (!src || typeof src !== 'object' || Array.isArray(src)) {
      return res.status(400).json({ error: '大会データがありません' });
    }
    const name = typeof src.name === 'string' ? src.name.trim() : '';
    if (!name || name.length > 100) {
      return res.status(400).json({ error: '大会名が不正です（1〜100文字）' });
    }

    let techniques;
    if (src.techniques === undefined || src.techniques === null) {
      techniques = cloneTechniques(readTechniques().techniques);
    } else {
      const techErr = validateTechniques(src.techniques);
      if (techErr) return res.status(400).json({ error: '技リスト: ' + techErr });
      techniques = cloneTechniques(src.techniques);
    }

    const rawPlayers = (src.players === undefined || src.players === null) ? [] : src.players;
    if (!Array.isArray(rawPlayers)) {
      return res.status(400).json({ error: '選手データが配列ではありません' });
    }
    if (rawPlayers.length > 2000) {
      return res.status(400).json({ error: '選手は2000名までです' });
    }
    const rawHistory = (bundle.history === undefined || bundle.history === null) ? [] : bundle.history;
    if (!Array.isArray(rawHistory)) {
      return res.status(400).json({ error: '履歴が配列ではありません' });
    }
    if (rawHistory.length > 20000) {
      return res.status(400).json({ error: '履歴は20000件までです' });
    }

    const now = new Date().toISOString();

    // 名前の無い行は落とす（CSV インポートと同じ）。ID の割り当ての前に落として、
    // sourcePlayerId が「落とした選手」を指さないようにする。
    const kept = rawPlayers.filter(p => p && typeof p === 'object' && !Array.isArray(p) &&
      typeof p.name === 'string' && p.name.trim() !== '');

    // 選手 ID の割り当て。有効（isValidId）かつファイル内で一意ならそのまま、
    // そうでなければ振り直す。旧 ID → 新 ID の対応を残し、sourcePlayerId を付け替える。
    const usedIds = Object.create(null);
    const idMap = Object.create(null);
    const assigned = kept.map(p => {
      const oldId = typeof p.id === 'string' ? p.id : '';
      let newId;
      if (isValidId(oldId) && !usedIds[oldId]) {
        newId = oldId;
      } else {
        newId = generateId();
        while (usedIds[newId]) newId = generateId();
      }
      usedIds[newId] = true;
      if (oldId && !Object.prototype.hasOwnProperty.call(idMap, oldId)) idMap[oldId] = newId;
      return newId;
    });

    // ゼッケンの重複（2件目以降）・範囲外の値は取り込み全体を 400 にはせず「未設定」に落とす
    // （設計書「選手の追加項目」・CSV 取り込みと同じ規則）。一巡目とその二巡目の複製は
    // sourcePlayerId でつながる「同じ選手」なので、groupKey を揃えて重複扱いしない
    // （findBibConflict が同じ関係を bib 重複判定から外すのと同じ理由）。
    const bibGroupKeys = kept.map((p, i) => {
      if (typeof p.sourcePlayerId === 'string' &&
          Object.prototype.hasOwnProperty.call(idMap, p.sourcePlayerId)) {
        return idMap[p.sourcePlayerId];
      }
      return assigned[i];
    });
    const bibResult = resolveBibDrops(kept.map(p => p.bib), classifyBibBundle, [], bibGroupKeys);

    // 許可リストのキーだけを取り込む。それ以外は捨てる（sanitizePlayerForSave の共通部分 +
    // このバンドル取り込み固有の id・bib・sourcePlayerId 解決）。
    const players = kept.map((p, i) => {
      // 元ファイルのどの選手も指していない sourcePlayerId は捨てる
      const sourcePlayerId = (typeof p.sourcePlayerId === 'string' &&
        Object.prototype.hasOwnProperty.call(idMap, p.sourcePlayerId)) ? idMap[p.sourcePlayerId] : null;
      return sanitizePlayerForSave(p, assigned[i], bibResult.bibs[i], sourcePlayerId);
    });

    const id = generateId();
    const event = {
      id: id,
      name: name,
      date: typeof src.date === 'string' ? src.date.slice(0, 20) : '',
      venue: typeof src.venue === 'string' ? src.venue.slice(0, 100) : '',
      createdAt: now,
      updatedAt: now,
      techniques: techniques,
      players: players
    };
    // settings（ゼッケン・級位段位の必須・コート一覧）。無いバンドル（古いバンドル）は付けない。
    // test は bundle.event に無い（書き出していない）ので、この event には常に付かない
    // ＝取り込み先は必ず false（設計書「テスト大会」バンドルの取り込みも false）。
    if (src.settings && typeof src.settings === 'object' && !Array.isArray(src.settings)) {
      event.settings = {
        requireBib: src.settings.requireBib === true,
        requireRank: src.settings.requireRank === true,
        mixed: src.settings.mixed === true,
        courts: sanitizeCourtList(src.settings.courts)
      };
    }
    // status（大会の状態）。STATES にある値ならそのまま採用する（final/archived を含む。
    // 取り込み後もロックが効くようにするため）。無い・不正なバンドル（古いバンドル）は
    // 付けない＝従来どおり EventStatus.of が選手から推定する。旧データの状態名は
    // 今の状態名に直して保存する（EventStatus.normalizeStatus。設計書 2026-10-05 2.2）。
    if (EventStatus.STATES.indexOf(EventStatus.normalizeStatus(src.status)) !== -1) {
      event.status = EventStatus.normalizeStatus(src.status);
    }

    // 履歴はオブジェクトの要素だけ通す。キーが '__proto__' でもプロトタイプを汚さないよう
    // setOwn で写す（EventStatus.playerTotals が氏名の辞書に Object.create(null) を使うのと同じ理由）。
    // なお履歴の playerId は選手 ID の振り直しに追従しない（参照用の記録であり、
    // 付け替えると元の履歴の意味が変わってしまうため）。
    const entries = rawHistory
      .filter(e => e && typeof e === 'object' && !Array.isArray(e))
      .map(e => {
        const copy = {};
        Object.keys(e).forEach(k => setOwn(copy, k, e[k]));
        if (typeof copy.timestamp !== 'string' || !copy.timestamp) setOwn(copy, 'timestamp', now);
        return copy;
      });

    // 履歴を先に書き、大会を後に書く。どちらも新しい ID の新規作成なので、
    // 途中で失敗しても他端末とは競合しない。順序が逆（大会を先）だと、
    // 履歴の書き込みだけが失敗したときに「大会はあるが履歴が欠けた」半端な
    // 取り込みが成立してしまう。この順序なら、失敗するのはせいぜい
    // 「参照されない孤児の履歴ファイルが残る」だけで実害が無い。
    if (entries.length > 0) {
      writeJsonAtomic(path.join(HISTORY_DIR, `${id}.json`), { eventId: id, entries: entries });
    }
    writeJsonAtomic(path.join(EVENTS_DIR, `${id}.json`), event);

    res.json({
      success: true,
      id: id,
      playerCount: players.length,
      bibDropped: { duplicate: bibResult.duplicate, outOfRange: bibResult.outOfRange }
    });
  } catch (err) {
    console.error('大会の取り込みに失敗:', err);
    res.status(500).json({ error: '大会の取り込みに失敗しました' });
  }
});

// ── Round API ──

// ── 二巡目の生成（設計書 2026-09-08 と 2026-09-22） ──
// POST …/rounds/2/generate と POST …/status（round1 → round1_done）の両方から呼ぶ
// 唯一の実装。event は書き換えず、新しい players 配列を返す。
// 呼び出し側は ok のときだけ event.players を差し替えて書き出す
// （生成できなければ状態も進めない＝「失敗したら遷移も取り消す」）。
// この関数は同期のまま維持すること（server/index.js 冒頭の【不変条件】）。

// 二巡目の並びに使う一巡目の得点。確定済みの得点だけ（未確定は 0 扱い＝先頭側。網羅検証 S1）。
// 順位と同じ基準にそろえる（採点途中の値で並びを決めない）。
function scoreOf(p) {
  return EventStatus.confirmedScoreOf(p);
}

// 同点のときの一巡目の試技順。order を文字列で比べると 'A-男子-1-10' が 'A-男子-1-2' より前に来るので、
// コート（文字列）→ 男子が先 → 番号（数値）で比べる（網羅検証 S1。Courts.compareOrder と同じ考え方）。
function compareRound1Order(a, b) {
  const x = parseOrder(a && a.order);
  const y = parseOrder(b && b.order);
  if (!x || !y) {
    if (x || y) return x ? -1 : 1;   // 解析できない行は後ろ（二巡目の元にはならないが念のため）
    return String((a && a.order) || '').localeCompare(String((b && b.order) || ''));
  }
  if (x.court !== y.court) return x.court < y.court ? -1 : 1;
  if (x.gender !== y.gender) return x.gender === '男子' ? -1 : 1;
  return x.number - y.number;
}

// 二巡目の並び。
//   分ける大会: 女子が先、その中で一巡目の確定得点が低い順、同点は一巡目の試技順。
//     番号はコート×性別ごとに振るので、実際に効くのは「その組の中で低い順」。
//   混合の大会（設計書 2026-10-07 §4）: 女子先をやめ、男女を通して一巡目の確定得点が低い順、同点は一巡目の試技順。
function round2Comparator(mixed) {
  return function(a, b) {
    if (!mixed) {
      const fa = a.isFemale === true ? 0 : 1;
      const fb = b.isFemale === true ? 0 : 1;
      if (fa !== fb) return fa - fb;
    }
    if (scoreOf(a) !== scoreOf(b)) return scoreOf(a) - scoreOf(b);
    return compareRound1Order(a, b);
  };
}

// 一巡目の行から二巡目の行を1つ作る。
// ゼッケン・級位段位・真剣レンタルは同じ選手を指すので複製する（設計書「選手の追加項目」）。
// 技は二巡目の形の申請（r2tech1〜3）があればそれ、無ければ一巡目の複製（EventStatus.round2TechsOf。
// 設計書 2026-10-03 3.4。当日の変更は形登録で直す）。得点・結果は複製しない。
function buildRound2Row(event, players, newRows, p, court, isFemale) {
  const seg = genderSeg(event, isFemale);
  const n = nextOrderNumber(players.concat(newRows), court, seg, 2);
  const techs = EventStatus.round2TechsOf(p);
  const row = {
    id: generateId(),
    name: p.name || '',
    order: buildOrder(court, seg, 2, n),
    tech1: techs[0],
    tech2: techs[1],
    tech3: techs[2],
    score: 0,
    isNewFace: p.isNewFace === true,
    isFemale: isFemale,
    result: '',
    sourcePlayerId: p.id,
    rank: typeof p.rank === 'string' ? p.rank : '',
    rental: p.rental === true
  };
  if (Number.isInteger(p.bib)) row.bib = p.bib;
  return row;
}

// 二巡目の行を生成する（純粋関数）。
// 全員を自分のコートに置き、女子先→一巡目の確定得点の昇順→同点は一巡目の試技順（番号は数値で）に並べる
// （網羅検証 S1。未確定の得点は 0 扱い）。採番は コート×性別ごとに1から。
// 一巡目上位を特定のコートの末尾に回す仕組みは 2026-10-05 にやめた（設計書 2026-10-05 4.3）。
// 一巡目の行は一切変更せず、新規行を末尾に追記するだけにする。
// source は order が解析できる一巡目の行だけ（parseOrder できない選手は
// コートが決まらないので二巡目を作れない。'未分類' を製造すると isValidCourt と
// 衝突する）。解析できない行は unassignedCount として件数だけ返し、
// 運営画面で選手情報を直してもらう。
// skipped は「source のうち既に二巡目行を生成済みだった人数」を表す
// （force での差分追加時に意味を持つ）。sourcePlayerId を持たない二巡目行は
// CSV インポート由来で、force するとそれとは別に重複生成されてしまうため
// untrackedCount として件数を返し、クライアントが force 前に警告できるようにする。
// allowReorder: true のときだけ、誰も採点していない二巡目を「作り直す」分岐（レビュー指摘J）
// に入ってよい。POST …/rounds/2/generate（運営者が明示的に差分追加を求める操作）は
// 常に false で呼び、既存の行の並び・添字を変えない今までどおりの差分追加だけを行う。
// round1 → round1_done の遷移（サーバーが自動で呼ぶ）だけ true で呼ぶ。
// 戻り値:
//   { ok: true, players, created, skipped, existingCount, untrackedCount, unassignedCount,
//     fromRequest, reordered }
//   { ok: false, code: 400 | 409, body: { error, reason?, … } }
function generateRound2(event, force, allowReorder) {
  const players = Array.isArray(event.players) ? event.players : [];
  const round1Candidates = players.filter(p => p && EventStatus.roundOf(p) === 1);
  // '未分類' コートの行（order が解析できても isValidCourt を通らない）からは作らない。
  const src = round1Candidates.filter(p => {
    const parsed = parseOrder(p && p.order);
    return parsed !== null && isValidCourt(parsed.court);
  });
  const unassignedCount = round1Candidates.length - src.length;
  if (src.length === 0) {
    return { ok: false, code: 400, body: { error: '一巡目の選手がいません' } };
  }

  const existing = players.filter(p => p && EventStatus.roundOf(p) === 2);
  const untrackedCount = existing.filter(p => !p.sourcePlayerId).length;
  // 「未採点」は確定していない行（確定だけを反映する基準にそろえる。QA 指摘 2026-09-30）
  const unscored = src.filter(p => p.confirmed !== true);
  if (unscored.length > 0 && !force) {
    return { ok: false, code: 409, body: {
      error: '一巡目に未採点の選手がいます', reason: 'unscored',
      unscoredCount: unscored.length, existingCount: existing.length,
      untrackedCount: untrackedCount, unassignedCount: unassignedCount } };
  }
  if (existing.length > 0 && !force) {
    return { ok: false, code: 409, body: {
      error: '二巡目は既に生成されています', reason: 'exists',
      unscoredCount: unscored.length, existingCount: existing.length,
      untrackedCount: untrackedCount, unassignedCount: unassignedCount } };
  }

  // 二巡目の行が1つも採点されておらず、すべて sourcePlayerId で一巡目の行を
  // 追跡できるなら、一巡目の得点を戻して直したあとの「一巡目を終了」で二巡目の並びが
  // 古い得点のまま残らないよう、行の入れ物（id・技・ゼッケン・級位段位・レンタル）を
  // 保ったまま、コート内の番号だけを現在の一巡目の得点から付け直す
  // （レビュー指摘J。設計書 2026-10-05 D9）。採点済みの行が1つでもあれば、この分岐には入らず従来どおり
  // 差分追加だけを行う（採点結果を勝手に組み替えない）。
  const base = players.filter(p => !(p && EventStatus.roundOf(p) === 2));
  if (allowReorder && force && existing.length > 0 && untrackedCount === 0 &&
      existing.every(p => !EventStatus.isScored(p))) {
    return reorderRound2(event, src, existing, base, unassignedCount);
  }

  // force のときは未生成の一巡目行だけを差分追加する。既存の二巡目行には触れない。
  const generated = Object.create(null);
  existing.forEach(p => { if (p && p.sourcePlayerId) generated[p.sourcePlayerId] = true; });
  const targets = src.filter(p => p && !generated[p.id]);
  const ordered = targets.slice().sort(round2Comparator(isMixedEvent(event)));

  const newRows = [];
  ordered.forEach(p => {
    newRows.push(buildRound2Row(event, players, newRows, p, courtOf(p), p.isFemale === true));
  });

  return {
    ok: true,
    players: players.concat(newRows),
    created: newRows.length,
    skipped: src.length - targets.length,
    existingCount: existing.length,
    untrackedCount: untrackedCount,
    unassignedCount: unassignedCount,
    // 申請の形（r2tech1〜3）で作った行の数（設計書 2026-10-03 3.4。トーストに出す）
    fromRequest: targets.filter(EventStatus.hasRound2Techs).length,
    reordered: false
  };
}

// generateRound2 の「誰も採点していない二巡目を作り直す」分岐（レビュー指摘J）。
// src（現在の一巡目の得点）からコート内の番号を付け直し、既存の二巡目行
// （sourcePlayerId で対応が取れるもの）は id・技・ゼッケン・級位段位・レンタルを保ったまま
// 並べ直す。対応する既存行が無い src（前回の生成より後に増えた一巡目の選手）は新規に作る。
// 対応する src が無くなった既存行（一巡目から削除された選手）は落とす。
function reorderRound2(event, src, existing, base, unassignedCount) {
  const bySource = Object.create(null);
  existing.forEach(p => { if (p && p.sourcePlayerId) bySource[p.sourcePlayerId] = p; });

  // generateRound2 と同じ並び（全員を自分のコートに。分ける大会は女子先→一巡目の確定得点の昇順→同点は試技順、混合は男女通しで得点の昇順）
  const ordered = src.slice().sort(round2Comparator(isMixedEvent(event)));

  const newRows = [];
  let reused = 0;
  function place(p, court, isFemale) {
    const old = bySource[p.id];
    const seg = genderSeg(event, isFemale);
    let row;
    if (old) {
      reused++;
      row = {
        id: old.id,
        name: p.name || '',
        order: buildOrder(court, seg, 2, nextOrderNumber(base.concat(newRows), court, seg, 2)),
        tech1: typeof old.tech1 === 'string' ? old.tech1 : '',
        tech2: typeof old.tech2 === 'string' ? old.tech2 : '',
        tech3: typeof old.tech3 === 'string' ? old.tech3 : '',
        score: 0,
        isNewFace: p.isNewFace === true,
        isFemale: isFemale,
        result: '',
        sourcePlayerId: p.id,
        rank: typeof old.rank === 'string' ? old.rank : '',
        rental: old.rental === true
      };
      if (Number.isInteger(old.bib)) row.bib = old.bib;
      // 二巡目準備で入れた備考と確定は付け直しても残す（採点済みの行はここに来ない）
      if (typeof old.note === 'string' && old.note) row.note = old.note;
      if (old.confirmed === true) row.confirmed = true;
      // 版も引き継ぐ（同じ行の入れ物のまま並びだけ変えるので、採点画面の控えと食い違わせない）
      if (EventStatus.revOf(old) > 0) row.rev = EventStatus.revOf(old);
    } else {
      row = buildRound2Row(event, base, newRows, p, court, isFemale);
    }
    newRows.push(row);
  }
  ordered.forEach(p => place(p, courtOf(p), p.isFemale === true));

  return {
    ok: true,
    players: base.concat(newRows),
    created: newRows.length - reused,
    skipped: reused,
    existingCount: existing.length,
    untrackedCount: 0,
    unassignedCount: unassignedCount,
    // 作り直しでは既存の行の技を保つが、申請の同期（2.4）で申請と一致しているので src の申請で数える
    fromRequest: src.filter(EventStatus.hasRound2Techs).length,
    reordered: true
  };
}

// POST /api/events/:id/rounds/2/generate : 二巡目の行を生成
app.post('/api/events/:id/rounds/2/generate', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    // 二巡目を作るのは「一巡目終了」のときだけ。運営者が一巡目の終了を宣言する前に
    // 生成すると、あとから入る一巡目の得点が二巡目の並び順に反映されない。
    const genStatus = EventStatus.of(event);
    if (genStatus !== 'round1_done') {
      return res.status(409).json({
        error: '一巡目を終了してから生成してください',
        reason: 'status',
        status: genStatus
      });
    }
    const result = generateRound2(event, !!(req.body && req.body.force === true));
    if (!result.ok) return res.status(result.code).json(result.body);

    event.players = result.players;
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({
      success: true,
      created: result.created,
      skipped: result.skipped,
      existingCount: result.existingCount,
      untrackedCount: result.untrackedCount,
      unassignedCount: result.unassignedCount,
      fromRequest: result.fromRequest,
      reordered: !!result.reordered
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id/ranking : 順位データ（運営画面・ranking.html 用）
// 参加者向けは GET /api/links/:token/ranking（無認証）。どちらも computeRanking を共有する。
app.get('/api/events/:id/ranking', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    res.json(computeRanking(event));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Live API（配信用ボード） ──
// コートの端末が「今どの選手を開いているか」「タイマーの状態」を置く場所。
// 大会 JSON の live（コートごと）に持ち、board.html が GET /api/links/:token/live で読む。

// live のコート名はコート名そのものをキーにするので、'__proto__' のような名前でも
// プロトタイプを汚さないように defineProperty で書き、読みは hasOwnProperty で見る
// （computeRanking が氏名の辞書に Object.create(null) を使っているのと同じ理由）。
function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value: value, enumerable: true, writable: true, configurable: true });
}

function getOwn(obj, key) {
  return (obj && Object.prototype.hasOwnProperty.call(obj, key)) ? obj[key] : undefined;
}

const DEFAULT_LIVE_TIMER = { sec: 300, running: false };

// PUT /api/events/:id/live/:court : そのコートのライブ状態を置き換える
// 認可は他の採点 API と同じ扱い（採点の鍵は自分のコートだけ。server/authz.js）。
// timer を省略したときは既存の値を据え置く（選手だけ切り替えた場合など）。
// event.updatedAt は動かさない。共有ページ（share.js）は updatedAt の変化で
// 順位を描き直すので、選手を切り替えるたびに動かすと無駄な再描画を呼ぶ。
app.put('/api/events/:id/live/:court', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const court = req.params.court;
    if (!isValidCourt(court)) {
      return res.status(400).json({ error: '不正なコート名です' });
    }
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    const body = req.body || {};

    let playerId = null;
    if (body.playerId !== null && body.playerId !== undefined) {
      if (!isValidId(body.playerId)) {
        return res.status(400).json({ error: '不正な選手IDです' });
      }
      const found = (event.players || []).find(p => p && p.id === body.playerId);
      if (!found) {
        return res.status(400).json({ error: '選手が見つかりません' });
      }
      // 採点の鍵の端末は、そのコートの行だけ映せる（設計書 2026-10-03 5.2 の 23）
      const liveDenied = authz.checkScorerLive(req.principal, found, courtOf);
      if (liveDenied) return authz.sendDeny(res, liveDenied);
      playerId = body.playerId;
    }

    if (!event.live || typeof event.live !== 'object') event.live = {};
    const prev = getOwn(event.live, court) || {};
    let timer = prev.timer || DEFAULT_LIVE_TIMER;
    if (body.timer !== undefined) {
      const t = body.timer;
      if (!t || typeof t !== 'object' || !Number.isInteger(t.sec) || t.sec < 0 || t.sec > 5999) {
        return res.status(400).json({ error: '不正なタイマーです' });
      }
      timer = { sec: t.sec, running: t.running === true };
    }

    const entry = {
      playerId: playerId,
      timer: { sec: timer.sec, running: timer.running === true },
      updatedAt: new Date().toISOString()
    };
    setOwn(event.live, court, entry);
    writeJsonAtomic(eventPath, event);
    res.json({ success: true, live: entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Techniques API ──

// 技術一覧の読み出し。GET /api/techniques と GET /api/links/:token/live が共有する。
// cloneTechniques を通して返す（DEFAULT_TECHNIQUES には drawn を持たせていないため、
// 大会の techniques と同じ形 { name, strikes, drawn } に揃える。呼び出し元の多くは
// 既に cloneTechniques をもう一度掛けているが、掛け直しても結果は変わらない）。
function readTechniques() {
  const customPath = path.join(TECHNIQUES_DIR, 'custom.json');
  if (fs.existsSync(customPath)) {
    return { isCustom: true, techniques: cloneTechniques(JSON.parse(fs.readFileSync(customPath, 'utf-8'))) };
  }
  return { isCustom: false, techniques: cloneTechniques(DEFAULT_TECHNIQUES) };
}

// GET /api/techniques : 技術一覧取得
app.get('/api/techniques', (req, res) => {
  try {
    res.json(readTechniques());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/techniques : カスタム技術保存
// PUT /api/events/:id/techniques と同じ検証を通す。ここが緩いと、
// 壊れた雛形（技名が空など）を複製した新規大会が以後 PUT で保存できなくなる。
app.post('/api/techniques', (req, res) => {
  try {
    const { techniques } = req.body;
    const badTech = validateTechniques(techniques);
    if (badTech) return res.status(400).json({ error: badTech });
    const customPath = path.join(TECHNIQUES_DIR, 'custom.json');
    writeJsonAtomic(customPath, cloneTechniques(techniques));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/techniques : カスタム技術削除（デフォルトに戻す）
app.delete('/api/techniques', (req, res) => {
  try {
    const customPath = path.join(TECHNIQUES_DIR, 'custom.json');
    if (fs.existsSync(customPath)) {
      fs.unlinkSync(customPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── History API ──

// GET /api/events/:id/history : 採点履歴取得
app.get('/api/events/:id/history', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const historyPath = path.join(HISTORY_DIR, `${req.params.id}.json`);
    if (fs.existsSync(historyPath)) {
      // 壊れた履歴ファイルでも 500 にしない（POST の appendHistory と同じく空の履歴として扱う）。
      // 読むだけなのでファイルは消さず、調べられるようログに出す。
      let data;
      try {
        data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      } catch (e) {
        console.error(`履歴ファイルを読めません（空の履歴として返します）: ${historyPath}: ${e.message}`);
        data = null;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) data = { eventId: req.params.id, entries: [] };
      if (!Array.isArray(data.entries)) data.entries = [];
      res.json(data);
    } else {
      res.json({ eventId: req.params.id, entries: [] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/history : 採点履歴保存
// 本文をそのまま積むと、任意のキーや巨大な値が履歴ファイルに入り、存在しない大会の履歴も作れた
// （網羅検証 S15）。許可した項目だけを残し、長さを切る。action は必須。大会が無ければ 404。
// 壊れた履歴ファイルでも 500 にしない（appendHistory が空から積み直す）。
// strike（太刀の番号）は採点画面が 0 始まりの数値で送る。古いデータ・他の画面の文字列も受けるので両方を通す。
const HISTORY_STRING_KEYS = ['action', 'detail', 'playerName', 'playerId', 'techName', 'strike', 'value', 'court'];
const HISTORY_NUMBER_KEYS = ['techRow', 'round', 'strike'];
// 採点画面が送れなかった履歴を送り直すときの印（同じ印の履歴を二度積まない。結合試験 E2）
const HISTORY_CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
function historyHasClientId(eventId, clientId) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, `${eventId}.json`), 'utf-8'));
    return Array.isArray(data.entries) && data.entries.some(e => e && e.clientId === clientId);
  } catch (e) {
    return false;
  }
}
app.post('/api/events/:id/history', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    if (!fs.existsSync(path.join(EVENTS_DIR, `${req.params.id}.json`))) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const entry = {};
    HISTORY_STRING_KEYS.forEach(k => {
      if (typeof body[k] === 'string') entry[k] = body[k].slice(0, k === 'detail' ? 500 : 200);
    });
    HISTORY_NUMBER_KEYS.forEach(k => {
      if (typeof body[k] === 'number' && Number.isFinite(body[k])) entry[k] = body[k];
    });
    if (!entry.action) {
      return res.status(400).json({ error: 'action が必要です' });
    }
    if (typeof body.clientId === 'string' && HISTORY_CLIENT_ID.test(body.clientId)) {
      if (historyHasClientId(req.params.id, body.clientId)) return res.json({ success: true, duplicate: true });
      entry.clientId = body.clientId;
    }
    // actor は本文から受けず、サーバーが主体から付ける（設計書 2026-10-03 5.6）
    appendHistory(req.params.id, entry, req.principal);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Share Link API ──
// GET 系は参加者が無認証で開く（share.html / present.html / board.html）。
// 認証を足す際も保護しないこと（board.html は OBS のブラウザソースが開くので、
// ログインを挟むと配信に何も映らなくなる）。
// トークンは必ず isValidId で検証してから path.join する
// （検証せずに join するとパストラバーサルでデータ全体が読める）。

// POST /api/links : 共有トークンの発行。大会ごとに1つで冪等。
app.post('/api/links', (req, res) => {
  try {
    const body = req.body || {};
    if (body.targetType !== 'event') {
      return res.status(400).json({ error: '不正な対象種別です' });
    }
    if (!isValidId(body.targetId)) {
      return res.status(400).json({ error: '不正な大会IDです' });
    }
    const eventPath = path.join(EVENTS_DIR, `${body.targetId}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    // AI は「テスト用」の大会だけ（設計書 2026-10-03 5.2 の 29）
    const linkDenied = authz.checkAiBodyEvent(req.principal, event);
    if (linkDenied) return authz.sendDeny(res, linkDenied);

    // 発行済みならそのまま返す。リンクを配ったあとに変わると困る。
    if (isValidId(event.shareToken)) {
      const existingLinkPath = path.join(LINKS_DIR, `${event.shareToken}.json`);
      if (fs.existsSync(existingLinkPath)) {
        return res.json({ token: event.shareToken });
      }
      // リンクファイルだけ消えていた場合は同じトークンで作り直す（配布済みの URL を死なせない）。
      writeJsonAtomic(existingLinkPath, {
        token: event.shareToken,
        targetType: 'event',
        targetId: body.targetId,
        createdAt: new Date().toISOString()
      });
      return res.json({ token: event.shareToken });
    }

    // 6バイトの base64url は8文字で、ID_PATTERN（英数字・- ・_）に収まる。
    const token = crypto.randomBytes(6).toString('base64url');
    writeJsonAtomic(path.join(LINKS_DIR, `${token}.json`), {
      token: token,
      targetType: 'event',
      targetId: body.targetId,
      createdAt: new Date().toISOString()
    });

    event.shareToken = token;
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ token: token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/links/:token : トークンの参照先（無認証）
app.get('/api/links/:token', (req, res) => {
  try {
    if (!isValidId(req.params.token)) {
      return res.status(400).json({ error: '不正なトークンです' });
    }
    const linkPath = path.join(LINKS_DIR, `${req.params.token}.json`);
    if (!fs.existsSync(linkPath)) {
      return res.status(404).json({ error: 'リンクが見つかりません' });
    }
    const link = JSON.parse(fs.readFileSync(linkPath, 'utf-8'));
    // targetId は返さない。無認証で読める応答から /api/events/:id の宛先を漏らさないため。
    // （認証が入るまでは GET /api/events から ID が引けるので、これは認証後に効く対策）
    // 順位は /api/links/:token/ranking から取る
    res.json({ token: link.token, targetType: link.targetType, createdAt: link.createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/links/:token/ranking : 共有リンク越しの順位（無認証）
// 返すのは computeRanking の結果だけで、○×や order といった生データは含まれない。
app.get('/api/links/:token/ranking', (req, res) => {
  try {
    if (!isValidId(req.params.token)) {
      return res.status(400).json({ error: '不正なトークンです' });
    }
    const linkPath = path.join(LINKS_DIR, `${req.params.token}.json`);
    if (!fs.existsSync(linkPath)) {
      return res.status(404).json({ error: 'リンクが見つかりません' });
    }
    const link = JSON.parse(fs.readFileSync(linkPath, 'utf-8'));
    if (link.targetType !== 'event' || !isValidId(link.targetId)) {
      return res.status(404).json({ error: 'リンクが見つかりません' });
    }
    const eventPath = path.join(EVENTS_DIR, `${link.targetId}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    res.json(computeRanking(JSON.parse(fs.readFileSync(eventPath, 'utf-8'))));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/links/:token/live : 共有リンク越しのライブ状態（無認証。board.html が2秒ごとに読む）
// 返すのは「そのコートで今開いている選手1人分」だけ。名簿全体の result / order は返さない
// （GET /api/links/:token が targetId を伏せているのと同じ方針）。
// ライブ状態が無いコートはキーごと含めない（board 側は「待機中」を出す）。
app.get('/api/links/:token/live', (req, res) => {
  try {
    if (!isValidId(req.params.token)) {
      return res.status(400).json({ error: '不正なトークンです' });
    }
    const linkPath = path.join(LINKS_DIR, `${req.params.token}.json`);
    if (!fs.existsSync(linkPath)) {
      return res.status(404).json({ error: 'リンクが見つかりません' });
    }
    const link = JSON.parse(fs.readFileSync(linkPath, 'utf-8'));
    if (link.targetType !== 'event' || !isValidId(link.targetId)) {
      return res.status(404).json({ error: 'リンクが見つかりません' });
    }
    const eventPath = path.join(EVENTS_DIR, `${link.targetId}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    const live = (event.live && typeof event.live === 'object') ? event.live : {};
    const players = Array.isArray(event.players) ? event.players : [];

    const courts = {};
    Object.keys(live).forEach(court => {
      const entry = live[court];
      if (!entry || typeof entry !== 'object') return;
      const p = entry.playerId ? players.filter(q => q && q.id === entry.playerId)[0] : null;
      setOwn(courts, court, {
        updatedAt: entry.updatedAt || '',
        timer: {
          sec: Number.isInteger(entry.timer && entry.timer.sec) ? entry.timer.sec : DEFAULT_LIVE_TIMER.sec,
          running: !!(entry.timer && entry.timer.running)
        },
        // adjust は配列のときだけそのまま返す。無い選手（旧データ）は null にして、
        // board 側の Scoring.decodeResult に「5文字目を補正点として読む」旧解釈をさせる。
        player: p ? {
          name: p.name || '',
          order: p.order || '',
          isFemale: p.isFemale === true,
          tech1: p.tech1 || '',
          tech2: p.tech2 || '',
          tech3: p.tech3 || '',
          result: p.result || '',
          adjust: Array.isArray(p.adjust) ? p.adjust : null,
          totalAdjust: Number.isFinite(p.totalAdjust) ? p.totalAdjust : 0,
          score: typeof p.score === 'number' ? p.score : 0,
          confirmed: p.confirmed === true
        } : null
      });
    });

    res.json({
      eventName: event.name || '',
      now: new Date().toISOString(),
      courts: courts,
      // 配点は大会ごと。雛形ではなくこの大会の有効な技リストを返す
      // （board.html は返ってきた配点で得点の内訳を描く）。
      techniques: effectiveTechniques(event)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────
// 静的ファイル配信（許可リスト）
// ────────────────────────────────────────
const PUBLIC_DIR = path.resolve(__dirname, '..');

// server/ 配下はデータとサーバー本体。静的配信の対象から外す。
// 共有リンクは無認証で開かれるので、/server/data/events/<id>.json が読めてはいけない。
// 生の req.path を正規表現で見るだけでは %73erver や //server、/a/../server で迂回できる。
// express.static と同じようにデコード・正規化した実パスで判定する
// （Windows はパスの大文字小文字を区別しないので、比較も区別しない）。
const SERVER_DIR = path.resolve(__dirname);
app.use((req, res, next) => {
  let decoded;
  try {
    decoded = decodeURIComponent(req.path);
  } catch (e) {
    return res.status(400).end();
  }
  const target = path.resolve(PUBLIC_DIR, '.' + decoded.replace(/\\/g, '/'));
  const t = target.toLowerCase();
  const s = SERVER_DIR.toLowerCase();
  if (t === s || t.startsWith(s + path.sep)) return res.status(404).end();
  next();
});

// 許可リスト。表にあるファイルだけ配信し、運営用は認証してから返す（server/static-policy.js）。
// 未定義の /api/ パスもここで 404 にする。
// 保護ページは主体ごとに（設計書 2026-10-03 6.5）:
//   運営 … 今どおり 200
//   採点の鍵の端末 … SCORER_FILES（採点画面とその依存）だけ 200。/ と /index.html は /scoring.html へ 302、
//                   他の保護ページは 403 の HTML（ダイアログなし）
//   無効な Cookie … 401 の HTML（期限切れ・取り消し済み。ダイアログなし）
//   AI（Bearer）… 401（ページは開けない）
//   何も無い … 401 + WWW-Authenticate（今どおり）
const JOIN_PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
app.use((req, res, next) => {
  if (req.path.toLowerCase().startsWith('/api/')) {
    return res.status(404).json({ error: '見つかりません' });
  }
  const kind = classify(req.path, { production: IS_PRODUCTION });
  if (!kind) return res.status(404).end();
  const rel = normalizeStaticPath(req.path);
  if (rel === 'join.html') {
    // 招待の鍵を読み取って開くページ。鍵（#k=…）を外に出さない・埋め込ませない（6.1）
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', JOIN_PAGE_CSP);
    res.set('Cache-Control', 'no-store');
    // /join（拡張子なし）は join.html を返す（リンクを短くするため）
    if (req.path !== '/join.html') req.url = '/join.html';
  }
  if (kind === 'protected') {
    const pr = req.principal || {};
    if (pr.kind === 'admin') return next();
    if (pr.kind === 'scorer') {
      if (rel === 'index.html') return res.redirect(302, '/scoring.html');
      if (scorerAllowed(req.path)) return next();
      return sendScorerForbiddenPage(res, pr);
    }
    if (pr.kind === 'anonymous' && pr.cookie) return sendSessionInvalidPage(res, pr.reason);
    if (pr.kind === 'ai' || pr.bearer) {
      return res.status(401).type('text/plain').send('認証が必要です');
    }
    return auth.rejectPage(res);
  }
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

app.listen(PORT, () => {
    console.log(`🎯 PHX Tameshigiri running at http://localhost:${PORT}`);
});
