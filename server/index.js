const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createAuth, isPublicApi } = require('./auth');
const { classify } = require('./static-policy');
// 大会の状態。クライアント（<script src="status.js">）と同じファイルを読む。
// 判定を2箇所に持たないため、状態に関わる分岐は必ずこのモジュールを通す。
const EventStatus = require('../status.js');

const app = express();
// ルーティングを大文字小文字で区別する。既定の区別なしだと /API/events が
// ルートに一致する一方、認証ミドルウェアの '/api/' 判定をすり抜ける。
app.set('case sensitive routing', true);
const PORT = process.env.PORT || 3457;

// データ保存先ディレクトリ
const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_DIR = path.join(DATA_DIR, 'events');
const TECHNIQUES_DIR = path.join(DATA_DIR, 'techniques');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const LINKS_DIR = path.join(DATA_DIR, 'links');

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
      reducedFirst: (Number.isInteger(rf) && rf >= 0 && rf <= 99) ? rf : null
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
const ORDER_PATTERN = /^([^-]+)-(男子|女子)-(\d+)-(\d+)$/;

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

// settings.finalCourt（決戦コートの名前）の寛容な取り込み。
// コート名の規則（isValidCourt）を通らない値は落として既定（EventStatus.finalCourtOf の
// '決戦'）に任せる。取り込み系 API が他の項目を黙って落とすのと同じ流儀。
function sanitizeFinalCourt(name) {
  return isValidCourt(name) ? name : '';
}

// 決戦コート以外で使われているコート名（settings.courts と選手の order のコート名。
// Courts.listFrom 相当）。決戦の行（finalist === true）自身のコート名は「通常のコート」に
// 数えない（PATCH /api/events/:id の決戦コート名の衝突チェック用。レビュー指摘C）。
function nonFinalCourtNames(players, courts) {
  const seen = Object.create(null);   // コート名が '__proto__' などでも壊れないように
  const out = [];
  function add(c) {
    if (!c || c === '未分類') return;
    if (!seen[c]) { seen[c] = true; out.push(c); }
  }
  (Array.isArray(players) ? players : []).forEach(p => {
    if (p && p.finalist === true) return;
    add(courtOf(p));
  });
  (Array.isArray(courts) ? courts : []).forEach(add);
  return out;
}

// 同一の コート×性別×巡目 における次の番号。該当が無ければ 1。
// 件数+1 ではなく最大+1 を使う（削除で欠番があっても衝突しない）。
function nextOrderNumber(players, court, gender, round) {
  let max = 0;
  (players || []).forEach(p => {
    const parsed = parseOrder((p && p.order) || '');
    if (!parsed) return;
    if (parsed.court !== court || parsed.gender !== gender || parsed.round !== round) return;
    if (parsed.number > max) max = parsed.number;
  });
  return max + 1;
}

// order 文字列を組み立てる。
function buildOrder(court, isFemale, round, n) {
  return court + '-' + (isFemale ? '女子' : '男子') + '-' + round + '-' + n;
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
function appendHistory(eventId, entry) {
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

// 決戦（暫定ベスト8）の表。決戦の行が無ければ null（設計書 2026-09-22）。
// rows は試技順（決戦コートの番号順）。r1 は一巡目の得点（sourcePlayerId で引く）、
// r2 は斬った人だけ（未採点は null）、rank も斬った人だけの中での暫定順位
// （合計降順・同点同順位。1, 1, 3）。
// ○×の生データ（result）は返さない（共有リンクから無認証で読まれるため）。
function computeFinale(event) {
  const players = ((event && event.players) || []);
  const finalRows = EventStatus.finalists(players);
  if (finalRows.length === 0) return null;

  const byId = Object.create(null);
  players.forEach(p => { if (p && typeof p.id === 'string') byId[p.id] = p; });
  const numberOf = p => {
    const parsed = parseOrder(p && p.order);
    return parsed ? parsed.number : 0;
  };

  const rows = finalRows.slice()
    .sort((a, b) => numberOf(a) - numberOf(b))
    .map(p => {
      const srcRow = (p.sourcePlayerId && Object.prototype.hasOwnProperty.call(byId, p.sourcePlayerId))
        ? byId[p.sourcePlayerId] : null;
      const r1 = (srcRow && typeof srcRow.score === 'number') ? srcRow.score : 0;
      const scored = EventStatus.isScored(p);
      const r2 = scored ? ((typeof p.score === 'number') ? p.score : 0) : null;
      return {
        name: String(p.name || '').trim(),
        order: numberOf(p),
        r1: r1,
        r2: r2,
        total: r1 + (r2 === null ? 0 : r2),
        scored: scored,
        rank: null
      };
    });

  // 暫定順位は斬った人だけで付ける。rows の要素をそのまま並べ替えて書き込む。
  const done = rows.filter(r => r.scored).sort((a, b) => b.total - a.total || a.order - b.order);
  let current = 1;
  let prevTotal = null;
  done.forEach((r, i) => {
    if (prevTotal !== null && r.total !== prevTotal) current = i + 1;
    prevTotal = r.total;
    r.rank = current;
  });

  return {
    court: EventStatus.finalCourtOf(event),
    status: EventStatus.of(event),
    rows: rows
  };
}

// 順位の集計。順位ロジックの唯一の実装。
// 行ごとに isFemale で男女に振り分け、isNewFace なら新人にも入れる。
// 氏名で合算する（一巡目＋二巡目）。得点降順、同点は同順位で次の順位は飛ぶ（1, 1, 3）。
// ○×の生データ（result）や order は返さない（共有リンクから無認証で読まれるため）。
function computeRanking(event) {
  // 選手名が __proto__ / constructor などでも壊れないよう、プロトタイプ無しの辞書を使う
  const male = Object.create(null);
  const female = Object.create(null);
  const newFace = Object.create(null);

  const add = (dict, name, score) => { dict[name] = (dict[name] || 0) + score; };

  ((event && event.players) || []).forEach(p => {
    // CSV エクスポートは氏名の前後に空白が付くことがある。trim して合算する（表示名もこちらを使う）。
    const name = String((p && p.name) || '').trim();
    if (!name) return;
    const score = typeof p.score === 'number' ? p.score : 0;
    if (p.isFemale) add(female, name, score);
    else add(male, name, score);
    if (p.isNewFace) add(newFace, name, score);
  });

  const rank = dict => {
    const entries = Object.keys(dict)
      .map(name => ({ name: name, score: dict[name] }))
      // 同点は氏名順で安定させる
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ja'));
    let current = 1;
    let prev = null;
    return entries.map((e, i) => {
      if (prev !== null && e.score !== prev) current = i + 1;
      prev = e.score;
      return { rank: current, name: e.name, score: e.score };
    });
  };

  return {
    event: {
      name: (event && event.name) || '',
      date: (event && event.date) || '',
      venue: (event && event.venue) || '',
      updatedAt: (event && event.updatedAt) || ''
    },
    rankings: {
      male: rank(male),
      female: rank(female),
      newFace: rank(newFace)
    },
    // 決戦（暫定ベスト8）の表。決戦の行が無ければ null。
    // 順位の集計（rankings）は変えない（氏名で合算、一般男子／新人／一般女子）。
    finale: computeFinale(event)
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

// API の認証。本文を読む前に弾く（無認証の巨大 JSON をメモリに載せない、
// body-parser の 400/413 を無認証クライアントに見せない）。
// 共有リンク越しの読み出し（isPublicApi）だけ無認証で通す。
// 401 に WWW-Authenticate を付けないのは、共有ページを見ている観客の画面に
// ブラウザのパスワードダイアログが出ないようにするため。運営端末は保護された
// HTML を開いた時点で認証済みなので、fetch にはブラウザが自動で資格情報を付ける。
// パスは小文字化して判定する（case sensitive routing と二重の守り。/API/ を素通りさせない）。
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (!p.startsWith('/api/')) return next();
  if (isPublicApi(req.method, p)) return next();
  if (auth.isAuthorized(req)) return next();
  auth.rejectApi(res);
});

// ペイロードサイズ制限を緩和
app.use(express.json({ limit: '50mb' }));

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
app.get('/api/events', (req, res) => {
  try {
    const files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
    const events = files.map(file => {
      const data = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, file), 'utf-8'));
      return {
        id: data.id,
        name: data.name,
        date: data.date,
        venue: data.venue,
        playerCount: Array.isArray(data.players) ? data.players.length : 0,
        // ファイルに status が無ければ選手から推定する（ファイルには書かない）
        status: EventStatus.of(data),
        updatedAt: data.updatedAt,
        createdAt: data.createdAt,
        // テスト大会の印（既定 false。設計書「テスト大会」。一覧では既定非表示にするための印）
        test: data.test === true
      };
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
    rank: typeof p.rank === 'string' ? p.rank.trim().slice(0, 20) : '',
    rental: p.rental === true
  };
  if (Array.isArray(p.adjust) && p.adjust.length === 3 && p.adjust.every(n => Number.isInteger(n))) {
    out.adjust = p.adjust.slice();
  }
  if (Number.isInteger(p.totalAdjust)) out.totalAdjust = p.totalAdjust;
  if (typeof p.note === 'string') {
    const note = p.note.trim().slice(0, 200);
    if (note) out.note = note;
  }
  if (p.confirmed === true) out.confirmed = true;
  if (bib !== null && bib !== undefined) out.bib = bib;
  if (sourcePlayerId) out.sourcePlayerId = sourcePlayerId;
  return out;
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
// techniques/settings/status/shareToken/test。live はこの経路では書かない）。
// body にしか無い未知のキー（live・techniquesSource・その他）は最初から event に
// コピーしないので、自然に落ちる。
app.post('/api/events', (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};

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

    // status はこの経路では変えない。状態を変える経路は POST /api/events/:id/status だけ。
    // body に status が入っていても無視する。既存の大会が status を持っていればその値を
    // そのまま引き継ぎ、持たない大会（この機能より前に作られた・取り込んだ大会）は
    // 書かずに推定のままにする（EventStatus.of が読み出しのたびに選手から推定する）。
    // ここで推定値を書き込んでしまうと、「status の無い大会」という区別が消え、
    // 以後は常にこの POST 時点の推定値に固定されてしまう。新規作成のときだけ draft。
    if (!exists) {
      event.status = 'draft';
    } else if (prev && EventStatus.STATES.indexOf(prev.status) !== -1) {
      event.status = prev.status;
    }
    // test（テスト大会の印）も同じ理由でこの経路では変えない。body に入っていても無視し、
    // 既存の大会が test:true を持っていればそのまま引き継ぐ（テンプレート API だけが true にする）。
    if (prev && prev.test === true) event.test = true;

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
      event.settings = { requireBib: s.requireBib === true, requireRank: s.requireRank === true, courts: courtsInput.slice() };
      const fc = sanitizeFinalCourt(s.finalCourt);
      if (fc) event.settings.finalCourt = fc;
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
      // courts を省いた PATCH は部分更新（name だけ・requireBib だけ、等）として使われるので、
      // 指定が無ければ既存のコート一覧を残す（[] にすると消えてしまう）。
      let courts = (event.settings && Array.isArray(event.settings.courts)) ? event.settings.courts.slice() : [];
      if (s.courts !== undefined) {
        const courtsErr = validateCourtList(s.courts);
        if (courtsErr) return res.status(400).json({ error: courtsErr });
        courts = s.courts.slice();
      }
      // 決戦コートの名前。courts と同じく、指定が無ければ既存の値を残す
      // （name だけの部分更新で決戦コートが消えないように）。
      // 空文字は「既定（決戦）に戻す」意味なのでキーごと落とす。
      let finalCourt = (event.settings && typeof event.settings.finalCourt === 'string')
        ? event.settings.finalCourt : '';
      if (s.finalCourt !== undefined) {
        const name = typeof s.finalCourt === 'string' ? s.finalCourt.trim() : '';
        if (name && !isValidCourt(name)) {
          return res.status(400).json({ error: 'コート名「' + s.finalCourt + '」は使えません' });
        }
        // 決戦の行がすでにあるときに名前をいまと違う値に変えると、決戦コートに移した選手を
        // どのコート端末でも採点できなくなる（レビュー指摘B）。実際に値が変わるときだけ止める。
        const nextFinal = EventStatus.finalCourtOf({ settings: { finalCourt: name } });
        if (nextFinal !== EventStatus.finalCourtOf(event) && EventStatus.hasFinalists(event.players)) {
          return res.status(400).json({
            error: '決戦の行がすでにあるため、決戦コートの名前は変えられません',
            reason: 'finale_exists'
          });
        }
        finalCourt = name;
      }
      // 決戦コートの名前が通常のコート（settings.courts や選手の order のコート名）と
      // かぶると、どちらのコート端末で採点すべきか判定できなくなる（レビュー指摘C）。
      // 決戦コート自身の行（finalist の行）はここでは「通常のコート」に数えない。
      if (s.finalCourt !== undefined || s.courts !== undefined) {
        const effectiveFinal = EventStatus.finalCourtOf({ settings: { finalCourt: finalCourt } });
        const otherCourts = nonFinalCourtNames(event.players, courts);
        if (otherCourts.indexOf(effectiveFinal) !== -1) {
          return res.status(400).json({
            error: 'コート名「' + effectiveFinal + '」は通常のコートと同じ名前のため決戦コートに使えません',
            reason: 'court_conflict'
          });
        }
      }
      event.settings = { requireBib: s.requireBib === true, requireRank: s.requireRank === true, courts: courts };
      if (finalCourt) event.settings.finalCourt = finalCourt;
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
        courts: sanitizeCourtList(src.settings.courts)
      };
      const fc = sanitizeFinalCourt(src.settings.finalCourt);
      if (fc) event.settings.finalCourt = fc;
    }
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
  '初段', '二段', '三段', '四段', '五段', '六段', '七段', '八段', '九段', '十段'];

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
        order: buildOrder(court, isFemale, 1, numberInCourt[court][label]),
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
      settings: { requireBib: spec.requireBib === true, requireRank: false, courts: spec.courts.slice() },
      players: []
    };

    // systest だけダミー選手20名を作り、test:true を付ける（設計書「テンプレート」）。
    if (body.template === 'systest') {
      event.test = true;
      event.players = buildSystestPlayers(techniques);
    }

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
    if (!EventStatus.canTransition(from, to)) {
      return res.status(409).json({
        error: 'この状態からは進めません',
        reason: 'transition',
        from: from,
        to: to
      });
    }

    const players = Array.isArray(event.players) ? event.players : [];
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
      // 差分だけ追加される。誰も採点していなければ暫定ベスト8と番号を現在の一巡目の
      // 得点から付け直す。レビュー指摘J）。
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
        finalistCount: gen.finalistCount, reordered: !!gen.reordered
      };
    }

    // 二巡目の行が無ければ二巡目は始められない（既存データの移行。通常の遷移では
    // round1_done が必ず二巡目を作るので、この経路は round2 が無いまま round1_done を
    // 持つ大会＝取り込んだ古いデータのためだけに残る）。
    if (from === 'round1_done' && to === 'round2' &&
        players.filter(p => EventStatus.roundOf(p) === 2).length === 0) {
      return res.status(409).json({ error: '二巡目が生成されていません', reason: 'no_round2' });
    }
    // 決戦の行が無ければ決戦は始められない（暫定ベスト8 が 0 名の大会）
    if (from === 'round2' && to === 'round2_final' && !EventStatus.hasFinalists(event.players)) {
      return res.status(409).json({ error: '決戦の選手がいません', reason: 'no_finale' });
    }
    // 決戦の行があるのに二巡目を終了しようとしたら止める（先に「決戦を開始」を押す）。
    // 決戦の行が無い大会（この機能より前に作られた大会）は round2 → round2_done を素通しする
    // （既存データの移行）。
    if (from === 'round2' && to === 'round2_done' && EventStatus.hasFinalists(event.players)) {
      return res.status(409).json({
        error: '決戦がまだです。先に「決戦を開始」を押してください', reason: 'finale_pending'
      });
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
        (round2Info ? '（二巡目 ' + round2Info.created + ' 名を生成。決戦 ' +
                      round2Info.finalistCount + ' 名）' : '')
    });
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
app.post('/api/events/:id/players', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const body = req.body || {};

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: '選手名が必要です' });
    }
    const court = typeof body.court === 'string' ? body.court.trim() : '';
    if (!isValidCourt(court)) {
      return res.status(400).json({ error: '不正なコート名です' });
    }
    const round = body.round === undefined ? 1 : body.round;
    if (!Number.isInteger(round) || round < 1 || round > 9) {
      return res.status(400).json({ error: '不正な巡目です' });
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

    if (bibParsed.value !== null) {
      const conflict = findBibConflict(event.players, bibParsed.value, null);
      if (conflict) {
        return res.status(409).json({
          error: bibConflictMessage(bibParsed.value, conflict.name),
          reason: 'bib'
        });
      }
    }

    const isFemale = body.isFemale === true;
    const gender = isFemale ? '女子' : '男子';
    const n = nextOrderNumber(event.players, court, gender, round);

    const player = {
      id: generateId(),
      name: name,
      order: buildOrder(court, isFemale, round, n),
      tech1: typeof body.tech1 === 'string' ? body.tech1 : '',
      tech2: typeof body.tech2 === 'string' ? body.tech2 : '',
      tech3: typeof body.tech3 === 'string' ? body.tech3 : '',
      score: 0,
      isNewFace: body.isNewFace === true,
      isFemale: isFemale,
      result: '',
      rank: rankParsed.value,
      rental: rentalParsed.value
    };
    if (bibParsed.value !== null) player.bib = bibParsed.value;

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
  return { ok: true, value: v.trim() };
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
    checked.push({
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
    const gender = row.isFemale ? '女子' : '男子';
    const key = bulkOrderKey(row.court, gender);
    if (nextNo[key] === undefined) {
      nextNo[key] = nextOrderNumber(event.players, row.court, gender, 1);
    }
    const n = nextNo[key]++;
    const player = {
      id: generateId(),
      name: row.name,
      order: buildOrder(row.court, row.isFemale, 1, n),
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
    return player;
  });

  event.players = event.players.concat(created);
  event.updatedAt = new Date().toISOString();
  writeJsonAtomic(eventPath, event);
  res.status(201).json({ success: true, created: created.length, players: created });
}

// 採番の控えのキー。コート名に使えない文字（改行）で連結して、
// 'A' + '男子' と 'A男' + '子' が同じキーにならないようにする。
function bulkOrderKey(court, gender) {
  return court + '\n' + gender;
}

// POST /api/events/:id/players/bulk : 選手をまとめて追加（一巡目）
// 2 つの形を受ける。どちらか一方だけ。
//   { court, isFemale, isNewFace, names: [...] } … 同じコート・性別・新人区分で名前だけ（スマホ運営）
//   { rows: [{ name, court, isFemale, isNewFace, tech1, tech2, tech3 }, ...] } … 行ごとに違う（PC 運営の貼り付け）
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

    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    if (!Array.isArray(event.players)) event.players = [];

    const isFemale = body.isFemale === true;
    const isNewFace = body.isNewFace === true;
    const gender = isFemale ? '女子' : '男子';
    let n = nextOrderNumber(event.players, court, gender, 1);
    const created = names.map(name => {
      const player = {
        id: generateId(),
        name: name,
        order: buildOrder(court, isFemale, 1, n),
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

// PATCH /api/events/:id/players/:playerId : 選手の部分更新（採点と運営編集の共用）
// 受理するフィールドは allowlist に限る。単純マージだと id / order / 未知のキーまで
// クライアントが書き込めてしまう。
// court と round は order を組み立てる入力としてだけ使い、選手オブジェクトには保存しない
// （巡目は order から導出できる値なので、二重に持つと不整合の元になる）。
// 採点済みガードは掛けない（誤字修正は採点中でも必要。性別変更の警告はクライアント側）。
// レンタル×抜刀の形と同じ形の回数制限（repeatable でない技の重複）の検証は
// bulk rows（一括登録）だけで行う。この単体経路（採点画面・運営編集フォームからの
// 1件ずつの更新）はクライアントが techniqueOptions で技の候補自体を絞り込んでおり、
// 「試合開始」の可否は courts.js の startBlockers が別途まとめて見るため、ここで
// 二重に検証しない（画面の赤枠もクライアント側の判定に任せる）。
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

    const body = req.body || {};
    const player = event.players[playerIndex];

    ['tech1', 'tech2', 'tech3'].forEach(key => {
      if (typeof body[key] === 'string') player[key] = body[key];
    });
    // name は POST /api/events/:id/players（選手を1名追加）と同じ検証（trim 後 1〜100 文字）。
    // 空白だけの名前を通すと、順位表から静かに選手が消える（trim した名前で集計するため）。
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 100) {
        return res.status(400).json({ error: '選手名が必要です' });
      }
      player.name = name;
    }
    // result は 1=○, 0=×, 2=△（減点成功）, 空白=未入力 のエンコード（バンドル取込・CSV拡張取込と
    // 同じ規則）。それ以外の文字列（手入力の誤りなど）が混じると採点画面の decodeResult が
    // 読めずに壊れるため、緩く無視せず 400 で断る。
    if (body.result !== undefined) {
      if (typeof body.result !== 'string' || body.result.length > 100 || !/^[012 ]*$/.test(body.result)) {
        return res.status(400).json({ error: 'result が不正です' });
      }
      player.result = body.result;
    }
    ['isNewFace', 'isFemale'].forEach(key => {
      if (typeof body[key] === 'boolean') player[key] = body[key];
    });
    // ゼッケン番号・級位段位・真剣レンタル（設計書「選手の追加項目」）。
    // bib は null で未設定に戻せる（既存の「無ければキーを持たない」形に合わせてキー自体を消す）。
    // 型が合わないものは 400 で断る（重複判定に関わる bib はもちろん、rank/rental も
    // POST と同じ検証を通す）。
    if (body.bib !== undefined) {
      if (body.bib === null) {
        delete player.bib;
      } else {
        if (!isValidBibValue(body.bib)) {
          return res.status(400).json({ error: BIB_INVALID });
        }
        const conflict = findBibConflict(event.players, body.bib, player.id);
        if (conflict) {
          return res.status(409).json({
            error: bibConflictMessage(body.bib, conflict.name),
            reason: 'bib'
          });
        }
        player.bib = body.bib;
      }
    }
    if (body.rank !== undefined) {
      if (!isValidRankValue(body.rank)) {
        return res.status(400).json({ error: RANK_INVALID });
      }
      player.rank = body.rank.trim();
    }
    if (body.rental !== undefined) {
      if (typeof body.rental !== 'boolean') {
        return res.status(400).json({ error: RENTAL_INVALID });
      }
      player.rental = body.rental;
    }
    // 一巡目の bib / rank / rental が変わったら、sourcePlayerId でその行に紐づく二巡目の行にも
    // 同じ値を写す。二巡目生成が一巡目の値を複製しているのと同じ選手を指すため、PATCH で
    // 一巡目だけ更新すると食い違ってしまう（名前は元から複製するだけで PATCH では追随させない。
    // 名前は採点中に直接編集される可能性があり、二巡目側の呼び出し名を勝手に書き換えたくない）。
    // player.id が二巡目行の sourcePlayerId でない（＝player が一巡目行でない）場合は
    // 該当する行が無いので何もしない。
    const bibRankRentalChanged = body.bib !== undefined || body.rank !== undefined || body.rental !== undefined;
    if (bibRankRentalChanged) {
      event.players.forEach(function(p) {
        if (p && p.sourcePlayerId === player.id) {
          if (body.bib !== undefined) {
            if (Number.isInteger(player.bib)) p.bib = player.bib; else delete p.bib;
          }
          if (body.rank !== undefined) p.rank = player.rank;
          if (body.rental !== undefined) p.rental = player.rental;
        }
      });
    }
    // 補正点（技ごと・全体）・備考・確定。型が合わないものは黙って無視する（他の項目と同じ）。
    if (Array.isArray(body.adjust) && body.adjust.length === 3 &&
        body.adjust.every(n => Number.isInteger(n))) {
      player.adjust = body.adjust.slice();
    }
    if (Number.isInteger(body.totalAdjust)) player.totalAdjust = body.totalAdjust;
    if (typeof body.note === 'string') player.note = body.note.trim().slice(0, 200);
    if (typeof body.confirmed === 'boolean') player.confirmed = body.confirmed;
    // 補正点で負の合計になりうるので負数も受理する。NaN・Infinity は無視する。
    // 採点画面が送る値は常に整数（Scoring.calcTotalScore が toInt で丸める）なので、
    // -9999〜9999 の整数だけ受理する（それ以外は他の項目と同じく黙って無視する）。
    if (Number.isInteger(body.score) && body.score >= -9999 && body.score <= 9999) {
      player.score = body.score;
    }

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
      const gender = player.isFemale === true ? '女子' : '男子';
      // order を解析できない選手（CSV由来の空 order など）は、
      // コートの指定が無い限り触らない。
      const changed = cur
        ? (cur.court !== court || cur.gender !== gender || cur.round !== round)
        : (body.court !== undefined);
      // body.court は上で検証済み。指定が無いときは現在の order のコートをそのまま使う
      // （'未分類' でも再検証しない。再検証すると isFemale だけ書き換わって order と食い違う）。
      if (changed && court) {
        const others = event.players.filter((p, i) => i !== playerIndex);
        player.order = buildOrder(court, player.isFemale === true, round,
          nextOrderNumber(others, court, gender, round));
      }
    }

    event.players[playerIndex] = player;
    event.updatedAt = new Date().toISOString();

    writeJsonAtomic(eventPath, event);
    res.json({ success: true, player: player });
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

// POST /api/events/:id/import : 選手データのCSVインポート
app.post('/api/events/:id/import', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    const { csvText, mode, force } = req.body;

    // replace は players 配列を丸ごと置換するため、採点済みデータがあると
    // 他コートの採点まで消える。件数を返して拒否し、明示的な force のときだけ通す。
    if (mode === 'replace' && force !== true) {
      const scoredCount = (event.players || []).filter(EventStatus.isScored).length;
      if (scoredCount > 0) {
        return res.status(409).json({
          error: '採点済みのデータがあります',
          scoredCount: scoredCount
        });
      }
    }

    const lines = parseCSV(csvText);
    if (lines.length === 0) {
      return res.status(400).json({ error: '空のデータです' });
    }
    
    // 先頭行で形式を判別する（設計書 T5「サーバー」の表）
    //   2列目が「コート」 → 簡易7列（名前,コート,性別,技①,技②,技③,新人）。順番はサーバーが採番
    //   それ以外          → 従来9列／拡張15列（補正点1..3,全体補正,備考,確定）。順番は CSV の値
    // どちらの形式も末尾に ゼッケン,級位段位,レンタル の3列が続くことがある
    // （設計書「選手の追加項目」。無ければ従来どおり読む）。
    const header = lines[0].map(c => String(c || '').trim());
    const isSimple = header[1] === 'コート';
    const dataLines = lines.slice(1);
    const toInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
    const truthy = v => ['○', '1', 'はい', '新人'].indexOf(String(v || '').trim()) !== -1;
    const femaleMark = v => ['女', '女子', '○', 'F', 'f'].indexOf(String(v || '').trim()) !== -1;
    // ゼッケンの重複（2件目以降）・範囲外の値は行ごと 400 にはせず「未設定」に落として
    // 取り込みを続ける。落とした件数は bibDropped として応答に含める（下の resolveBibDrops）。
    // append 時は既存選手の bib も重複判定に含める（replace/新規は空）。
    const existingBibsForImport = mode === 'replace' ? [] :
      (event.players || []).filter(p => Number.isInteger(p && p.bib)).map(p => p.bib);

    let importedPlayers;
    let bibDropped = { duplicate: 0, outOfRange: 0 };
    if (isSimple) {
      // 簡易7列の後ろに3列（ゼッケン,級位段位,レンタル）が続くことがある。
      const hasExtra = header.length >= 10;
      // 採番の土台: replace なら空、append なら既存の選手
      const base = mode === 'replace' ? [] : (event.players || []);
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
        const isFemale = femaleMark(row[2]);
        const gender = isFemale ? '女子' : '男子';
        const n = nextOrderNumber(base.concat(importedPlayers), court, gender, 1);
        const player = {
          id: generateId(),
          name,
          order: buildOrder(court, isFemale, 1, n),
          // 末尾に空白が残ると Scoring.findTechnique の完全一致に掛からず配点が
          // 全部0になる（手入力・コピペ由来の空白を落とす）。
          tech1: String(row[3] || '').trim(),
          tech2: String(row[4] || '').trim(),
          tech3: String(row[5] || '').trim(),
          score: 0,
          isNewFace: truthy(row[6]),
          isFemale,
          result: '',
          rank: hasExtra ? String(row[8] || '').trim().slice(0, 20) : '',
          rental: hasExtra ? truthy(row[9]) : false
        };
        importedPlayers.push(player);
        rawBibs.push(hasExtra ? row[7] : undefined);
      }
      const bibResult = resolveBibDrops(rawBibs, classifyBibCsv, existingBibsForImport);
      importedPlayers.forEach((p, i) => { if (bibResult.bibs[i] !== null) p.bib = bibResult.bibs[i]; });
      bibDropped = { duplicate: bibResult.duplicate, outOfRange: bibResult.outOfRange };
    } else {
      // 拡張15列かどうかは先頭行（ヘッダー）の列数で一度だけ決める（設計書 T5 の表）。
      // 行ごとに判定すると、行によって列数が違う崩れたCSVで挙動が揺れる。
      // 10〜14列は従来どおり9列として読む（補正点・備考・確定は読まない）。
      // さらにその後ろに3列（ゼッケン,級位段位,レンタル）が続くことがある。
      const isExtended = header.length >= 15;
      const extBase = isExtended ? 15 : 9;
      const hasExtra = header.length >= extBase + 3;
      const rows = dataLines.map(row => {
        // 選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果[,補正点1,補正点2,補正点3,全体補正,備考,確定][,ゼッケン,級位段位,レンタル]
        const p = {
          id: generateId(),
          name: row[0] || '',
          order: row[1] || '',
          tech1: row[2] || '',
          tech2: row[3] || '',
          tech3: row[4] || '',
          score: parseFloat(row[5]) || 0,
          isNewFace: row[6] === '○',
          isFemale: row[7] === '○',
          // 結果は 1=○, 0=×, 2=△（減点成功）, 空白=未入力 のエンコード。それ以外（手入力・
          // 崩れたCSV由来の誤り）が混じっていたら PATCH .../players/:id やバンドル取込と
          // 同じ規則で空に落とす（採点画面の decodeResult が読めない文字列を保存しない）。
          result: (typeof row[8] === 'string' && row[8].length <= 100 && /^[012 ]*$/.test(row[8]))
            ? row[8] : ''
        };
        if (isExtended) {
          p.adjust = [toInt(row[9]), toInt(row[10]), toInt(row[11])];
          p.totalAdjust = toInt(row[12]);
          p.note = String(row[13] || '').trim().slice(0, 200);
          p.confirmed = String(row[14] || '').trim() === '○';
        }
        p.rank = hasExtra ? String(row[extBase + 1] || '').trim().slice(0, 20) : '';
        p.rental = hasExtra ? truthy(row[extBase + 2]) : false;
        return { player: p, rawBib: hasExtra ? row[extBase] : undefined };
      }).filter(r => r.player.name !== ''); // 空行等を除外
      // 拡張形式は「順番」列（p.order）から巡目が分かる。二巡目以降の行は一巡目の複製と
      // 同じ bib を持つのが正常な状態なので、重複判定の対象外にして値をそのまま通す
      // （レビュー修正。簡易7列形式は順番をサーバーが採番するので常に一巡目＝対象、
      // ここでは触らない）。
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
    }

    if (mode === 'replace') {
      event.players = importedPlayers;
    } else {
      event.players = (event.players || []).concat(importedPlayers);
    }

    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);

    res.json({ success: true, playerCount: event.players.length, bibDropped: bibDropped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id/export : 大会の選手データをCSVエクスポート
app.get('/api/events/:id/export', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    
    const header = ['選手名', '順番', '技 1', '技 2', '技 3', '得点', '新人', '女子', '結果',
                    '補正点1', '補正点2', '補正点3', '全体補正', '備考', '確定',
                    'ゼッケン', '級位段位', 'レンタル'];
    const rows = [header];

    for (const p of (event.players || [])) {
      const adj = Array.isArray(p.adjust) ? p.adjust : [0, 0, 0];
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
        p.rental === true ? '○' : ''
      ]);
    }
    
    const csvContent = rows.map(row => row.map(escapeCSV).join(',')).join('\r\n');
    const bom = '\uFEFF';
    
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
      return n + ' 行目の「抜刀後」の指定が不正です';
    }
    // repeatable（同じ巡で何度でも可）は省略可。省略時は cloneTechniques が false にする
    // （設計書 2026-09-20-rules-alignment-design.md）。
    if (t.repeatable !== undefined && typeof t.repeatable !== 'boolean') {
      return n + ' 行目の「回数制限なし」の指定が不正です';
    }
    // reducedFirst（減点成功△の初太刀の配点）は省略・null か 0〜99 の整数。省略時は cloneTechniques が null にする。
    if (t.reducedFirst !== undefined && t.reducedFirst !== null) {
      const rf = t.reducedFirst;
      if (!Number.isInteger(rf) || rf < 0 || rf > 99) {
        return n + ' 行目の「減点初太刀」の配点が不正です（0〜99の整数か空）';
      }
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

// PUT /api/events/:id/techniques : その大会の技リストを置き換える
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
    event.techniques = cloneTechniques(body.techniques);
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ success: true, techniques: event.techniques });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id/techniques : 雛形の複製で置き換える（「雛形に戻す」）
// 雛形との連動状態には戻さない。戻すと、あとで雛形を変えたときに採点中の大会の配点が動く。
app.delete('/api/events/:id/techniques', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    event.techniques = cloneTechniques(readTechniques().techniques);
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
// adjust / totalAdjust / note / confirmed / sourcePlayerId / bib は持っている選手にだけ付ける。
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
        courts: sanitizeCourtList(event.settings.courts)
      };
      const fc = sanitizeFinalCourt(event.settings.finalCourt);
      if (fc) bundle.event.settings.finalCourt = fc;
    }
    // status（大会の状態）。status を持たない大会（この機能より前に作られた・取り込んだ大会）は
    // 書き出さない＝取り込み側は従来どおり選手から推定する。EventStatus.of の推定値を書いて
    // しまうと、取り込み先が「status を持つ大会」に変わり、以後推定し直さなくなってしまう
    // （POST /api/events が推定値を書き込まない理由と同じ）。
    // final/archived を含め生の値をそのまま書く（取り込み側でロックが効くようにするため）。
    if (EventStatus.STATES.indexOf(event.status) !== -1) {
      bundle.event.status = event.status;
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
        courts: sanitizeCourtList(src.settings.courts)
      };
      const fc = sanitizeFinalCourt(src.settings.finalCourt);
      if (fc) event.settings.finalCourt = fc;
    }
    // status（大会の状態）。STATES にある値ならそのまま採用する（final/archived を含む。
    // 取り込み後もロックが効くようにするため）。無い・不正なバンドル（古いバンドル）は
    // 付けない＝従来どおり EventStatus.of が選手から推定する。
    if (EventStatus.STATES.indexOf(src.status) !== -1) {
      event.status = src.status;
    }

    // 履歴はオブジェクトの要素だけ通す。キーが '__proto__' でもプロトタイプを汚さないよう
    // setOwn で写す（computeRanking が氏名の辞書に Object.create(null) を使うのと同じ理由）。
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

function scoreOf(p) {
  return (p && typeof p.score === 'number') ? p.score : 0;
}

// 暫定ベスト8。一般男子（isFemale が true でない＝新人も含む。computeRanking と同じ規則）の
// 一巡目の得点上位 8 名。0 点は含めない。8 位が同点なら全員（同点同順位）。8 名未満なら全員。
// 戻り値: { <playerId>: true }（選手 id が '__proto__' でも壊れない辞書）
function pickFinalists(src) {
  const out = Object.create(null);
  const males = src
    .filter(p => p.isFemale !== true && scoreOf(p) > 0)
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a) || (a.order || '').localeCompare(b.order || ''));
  if (males.length === 0) return out;
  const cut = scoreOf(males.length >= 8 ? males[7] : males[males.length - 1]);
  males.forEach(p => { if (scoreOf(p) >= cut) out[p.id] = true; });
  return out;
}

// 決戦以外の並び（従来どおり）: 女子が先、その中で一巡目の得点が低い順、同点は order 順。
function compareForRound2(a, b) {
  const fa = a.isFemale === true ? 0 : 1;
  const fb = b.isFemale === true ? 0 : 1;
  if (fa !== fb) return fa - fb;
  if (scoreOf(a) !== scoreOf(b)) return scoreOf(a) - scoreOf(b);
  return (a.order || '').localeCompare(b.order || '');
}

// 決戦の並び: 一巡目の得点が低い順、同点は一巡目の order 順（設計書の決定）。
function compareByScoreAsc(a, b) {
  if (scoreOf(a) !== scoreOf(b)) return scoreOf(a) - scoreOf(b);
  return (a.order || '').localeCompare(b.order || '');
}

// 一巡目の行から二巡目の行を1つ作る。
// ゼッケン・級位段位・真剣レンタルは同じ選手を指すので複製する（設計書「選手の追加項目」）。
// 技も複製する（自己申告があった選手だけ運営画面で直す。設計書 2026-09-22 の決定）。
// 得点・結果は複製しない。
function buildRound2Row(players, newRows, p, court, isFemale, finalist) {
  const gender = isFemale ? '女子' : '男子';
  const n = nextOrderNumber(players.concat(newRows), court, gender, 2);
  const row = {
    id: generateId(),
    name: p.name || '',
    order: buildOrder(court, isFemale, 2, n),
    tech1: typeof p.tech1 === 'string' ? p.tech1 : '',
    tech2: typeof p.tech2 === 'string' ? p.tech2 : '',
    tech3: typeof p.tech3 === 'string' ? p.tech3 : '',
    score: 0,
    isNewFace: p.isNewFace === true,
    isFemale: isFemale,
    result: '',
    sourcePlayerId: p.id,
    rank: typeof p.rank === 'string' ? p.rank : '',
    rental: p.rental === true
  };
  if (Number.isInteger(p.bib)) row.bib = p.bib;
  // コートを手で変えても決戦の印は残す（設計書「データ」）。
  if (finalist) row.finalist = true;
  return row;
}

// 二巡目の行を生成する（純粋関数）。
// 並べ替えは 決戦以外→女子先→得点昇順→同点は order 順、決戦は得点昇順→同点は order 順。
// 採番は コート×性別ごとに1から（決戦は決戦コートで1から）。
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
//     finalistCount, reordered }
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
  const unscored = src.filter(p => !EventStatus.isScored(p));
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
  // 追跡できるなら、一巡目の得点を戻して直したあとの「二巡目を終了」で暫定ベスト8が
  // 入れ替わらない不具合を防ぐため、行の入れ物（id・技・ゼッケン・級位段位・レンタル）を
  // 保ったまま、暫定ベスト8の印とコート内の番号だけを現在の一巡目の得点から付け直す
  // （レビュー指摘J）。採点済みの行が1つでもあれば、この分岐には入らず従来どおり
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

  // 暫定ベスト8 は src 全体（一巡目の全員）から選ぶ。差分追加でも母集団を変えない。
  const finalistIds = pickFinalists(src);
  const plain = targets.filter(p => !finalistIds[p.id]).sort(compareForRound2);
  const finals = targets.filter(p => !!finalistIds[p.id]).sort(compareByScoreAsc);

  const finalCourt = EventStatus.finalCourtOf(event);
  const newRows = [];
  plain.forEach(p => {
    newRows.push(buildRound2Row(players, newRows, p, courtOf(p), p.isFemale === true, false));
  });
  finals.forEach(p => {
    newRows.push(buildRound2Row(players, newRows, p, finalCourt, false, true));
  });

  return {
    ok: true,
    players: players.concat(newRows),
    created: newRows.length,
    skipped: src.length - targets.length,
    existingCount: existing.length,
    untrackedCount: untrackedCount,
    unassignedCount: unassignedCount,
    finalistCount: finals.length,
    reordered: false
  };
}

// generateRound2 の「誰も採点していない二巡目を作り直す」分岐（レビュー指摘J）。
// src（現在の一巡目の得点）から暫定ベスト8とコート内の番号を付け直し、既存の二巡目行
// （sourcePlayerId で対応が取れるもの）は id・技・ゼッケン・級位段位・レンタルを保ったまま
// 並べ直す。対応する既存行が無い src（前回の生成より後に増えた一巡目の選手）は新規に作る。
// 対応する src が無くなった既存行（一巡目から削除された選手）は落とす。
function reorderRound2(event, src, existing, base, unassignedCount) {
  const bySource = Object.create(null);
  existing.forEach(p => { if (p && p.sourcePlayerId) bySource[p.sourcePlayerId] = p; });

  const finalistIds = pickFinalists(src);
  const plain = src.filter(p => !finalistIds[p.id]).sort(compareForRound2);
  const finals = src.filter(p => !!finalistIds[p.id]).sort(compareByScoreAsc);
  const finalCourt = EventStatus.finalCourtOf(event);

  const newRows = [];
  let reused = 0;
  function place(p, court, isFemale, finalist) {
    const old = bySource[p.id];
    let row;
    if (old) {
      reused++;
      row = {
        id: old.id,
        name: p.name || '',
        order: buildOrder(court, isFemale, 2, nextOrderNumber(base.concat(newRows), court, isFemale ? '女子' : '男子', 2)),
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
    } else {
      row = buildRound2Row(base, newRows, p, court, isFemale, false);
    }
    if (finalist) row.finalist = true;
    newRows.push(row);
  }
  plain.forEach(p => place(p, courtOf(p), p.isFemale === true, false));
  finals.forEach(p => place(p, finalCourt, false, true));

  return {
    ok: true,
    players: base.concat(newRows),
    created: newRows.length - reused,
    skipped: reused,
    existingCount: existing.length,
    untrackedCount: 0,
    unassignedCount: unassignedCount,
    finalistCount: finals.length,
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
      finalistCount: result.finalistCount,
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
// 認証は他の採点 API と同じ扱い（現状は無し）。
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
      const found = (event.players || []).some(p => p && p.id === body.playerId);
      if (!found) {
        return res.status(400).json({ error: '選手が見つかりません' });
      }
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
      const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      res.json(data);
    } else {
      res.json({ eventId: req.params.id, entries: [] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/history : 採点履歴保存
app.post('/api/events/:id/history', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const historyPath = path.join(HISTORY_DIR, `${req.params.id}.json`);
    let data = { eventId: req.params.id, entries: [] };
    
    if (fs.existsSync(historyPath)) {
      data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    }
    
    const entry = {
      ...req.body,
      timestamp: new Date().toISOString()
    };
    
    data.entries.push(entry);
    
    writeJsonAtomic(historyPath, data);
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
app.use((req, res, next) => {
  if (req.path.toLowerCase().startsWith('/api/')) {
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

app.listen(PORT, () => {
    console.log(`🎯 PHX Tameshigiri running at http://localhost:${PORT}`);
});
