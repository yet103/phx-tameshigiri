const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3457;

// データ保存先ディレクトリ
const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_DIR = path.join(DATA_DIR, 'events');
const TECHNIQUES_DIR = path.join(DATA_DIR, 'techniques');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

// 起動時にディレクトリ自動生成
fs.mkdirSync(EVENTS_DIR, { recursive: true });
fs.mkdirSync(TECHNIQUES_DIR, { recursive: true });
fs.mkdirSync(HISTORY_DIR, { recursive: true });

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
const DEFAULT_TECHNIQUES = [
  { name: "立位袈裟",    strikes: [1,  null, null, null] },
  { name: "立位逆袈裟",  strikes: [2,  null, null, null] },
  { name: "立位横一",    strikes: [8,  null, null, null] },
  { name: "座位袈裟",    strikes: [3,  null, null, null] },
  { name: "座位逆袈裟",  strikes: [4,  null, null, null] },
  { name: "座位横一",    strikes: [10, null, null, null] },
  { name: "基本一",      strikes: [15, 1,    null, null] },
  { name: "基本二",      strikes: [9,  1,    null, null] },
  { name: "真",          strikes: [11, 3,    null, null] },
  { name: "連",          strikes: [8,  3,    null, null] },
  { name: "左",          strikes: [18, 3,    null, null] },
  { name: "右",          strikes: [13, 3,    null, null] },
  { name: "捨",          strikes: [17, 3,    null, null] },
  { name: "胸尽くし(男)", strikes: [11, 1,    null, null] },
  { name: "胸尽くし(女)", strikes: [13, 1,    null, null] },
  { name: "円要",        strikes: [16, 1,    null, null] },
  { name: "両車",        strikes: [17, 5,    1,    null] },
  { name: "野送り",      strikes: [6,  null, null, null] },
  { name: "玉光",        strikes: [6,  null, null, null] },
  { name: "水月(男)",    strikes: [17, 11,   null, null] },
  { name: "水月(女)",    strikes: [17, 13,   null, null] },
  { name: "置藁水月",    strikes: [35, null, null, null] },
  { name: "陰中陽",      strikes: [8,  null, null, null] },
  { name: "陽中陰",      strikes: [17, 2,    null, null] },
  { name: "響き返し",    strikes: [14, 4,    2,    null] },
  { name: "破図味(男)",  strikes: [20, 4,    4,    2   ] },
  { name: "破図味(女)",  strikes: [20, 6,    6,    2   ] },
  { name: "前腰",        strikes: [13, 1,    null, null] },
  { name: "夢想返し",    strikes: [13, 5,    null, null] },
  { name: "廻り懸り",    strikes: [17, 1,    null, null] },
  { name: "右の敵",      strikes: [15, 1,    null, null] },
  { name: "四方",        strikes: [17, 5,    7,    3   ] }
];

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

// 採点済みかどうかの判定
// result は 1=○, 0=×, 空白=未入力 でエンコードされているため、
// 0 か 1 を含んでいれば何らかの採点が入っている。
function isScored(player) {
  if (!player) return false;
  if (typeof player.score === 'number' && player.score > 0) return true;
  return /[01]/.test(player.result || '');
}

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

// 巡目（order の第3セグメント）。解析できなければ 1（一巡目）とみなす。
function roundOf(player) {
  const order = (player && typeof player.order === 'string') ? player.order : '';
  const m = order.match(ORDER_PATTERN);
  return m ? parseInt(m[3], 10) : 1;
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
function isValidCourt(court) {
  return typeof court === 'string' && court.length > 0 &&
         court.indexOf('-') === -1 && court !== '未分類';
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

// ミドルウェア
app.use(cors());
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
        updatedAt: data.updatedAt,
        createdAt: data.createdAt
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
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events : 大会作成・更新
app.post('/api/events', (req, res) => {
  try {
    const event = req.body;
    if (!event.id) {
      event.id = generateId();
    } else if (!isValidId(event.id)) {
      return res.status(400).json({ error: '不正な大会IDです' });
    }
    const now = new Date().toISOString();
    if (!event.createdAt) {
      event.createdAt = now;
    }
    event.updatedAt = now;
    
    if (!event.players) {
      event.players = [];
    }

    writeJsonAtomic(path.join(EVENTS_DIR, `${event.id}.json`), event);
    res.json({ success: true, id: event.id });
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


// ── Player API ──

// POST /api/events/:id/players : 選手を1名追加
// order はサーバーが組み立てる。クライアントが送る id / order / score / result は無視する。
// 既存行に触れないため、採点中の端末には影響しない（ガードは掛けない）。
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

    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (!Array.isArray(event.players)) event.players = [];

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
      result: ''
    };

    event.players.push(player);
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.status(201).json({ success: true, player: player });
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
    if (!Array.isArray(event.players)) event.players = [];
    const playerIndex = event.players.findIndex(p => p && p.id === req.params.playerId);

    if (playerIndex === -1) {
      return res.status(404).json({ error: '選手が見つかりません' });
    }

    const body = req.body || {};
    const player = event.players[playerIndex];

    ['name', 'tech1', 'tech2', 'tech3', 'result'].forEach(key => {
      if (typeof body[key] === 'string') player[key] = body[key];
    });
    ['isNewFace', 'isFemale'].forEach(key => {
      if (typeof body[key] === 'boolean') player[key] = body[key];
    });
    if (typeof body.score === 'number') player.score = body.score;

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
      const round = body.round !== undefined ? body.round : roundOf(player);
      if (!Number.isInteger(round) || round < 1 || round > 9) {
        return res.status(400).json({ error: '不正な巡目です' });
      }
      const gender = player.isFemale === true ? '女子' : '男子';
      // order を解析できない選手（CSV由来の空 order など）は、
      // コートの指定が無い限り触らない。
      const changed = cur
        ? (cur.court !== court || cur.gender !== gender || cur.round !== round)
        : (body.court !== undefined);
      if (changed && isValidCourt(court)) {
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
    const players = Array.isArray(event.players) ? event.players : [];
    const idx = players.findIndex(p => p && p.id === req.params.playerId);
    if (idx === -1) {
      return res.status(404).json({ error: '選手が見つかりません' });
    }

    const target = players[idx];
    if (isScored(target) && req.query.force !== '1') {
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
    const { csvText, mode, force } = req.body;

    // replace は players 配列を丸ごと置換するため、採点済みデータがあると
    // 他コートの採点まで消える。件数を返して拒否し、明示的な force のときだけ通す。
    if (mode === 'replace' && force !== true) {
      const scoredCount = (event.players || []).filter(isScored).length;
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
    
    // 1行目はヘッダーなのでスキップ
    const dataLines = lines.slice(1);
    
    const importedPlayers = dataLines.map(row => {
      // 選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果
      const name = row[0] || '';
      const order = row[1] || '';
      const tech1 = row[2] || '';
      const tech2 = row[3] || '';
      const tech3 = row[4] || '';
      const scoreRaw = row[5];
      const score = parseFloat(scoreRaw) || 0;
      const isNewFace = row[6] === '○';
      const isFemale = row[7] === '○';
      const result = row[8] || '';
      
      return {
        id: generateId(),
        name,
        order,
        tech1,
        tech2,
        tech3,
        score,
        isNewFace,
        isFemale,
        result
      };
    }).filter(p => p.name !== ''); // 空行等を除外
    
    if (mode === 'replace') {
      event.players = importedPlayers;
    } else {
      event.players = (event.players || []).concat(importedPlayers);
    }
    
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);

    res.json({ success: true, playerCount: event.players.length });
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
    
    const header = ['選手名', '順番', '技 1', '技 2', '技 3', '得点', '新人', '女子', '結果'];
    const rows = [header];
    
    for (const p of (event.players || [])) {
      rows.push([
        p.name || '',
        p.order || '',
        p.tech1 || '',
        p.tech2 || '',
        p.tech3 || '',
        p.score != null ? p.score : 0,
        p.isNewFace ? '○' : '',
        p.isFemale ? '○' : '',
        p.result || ''
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

// ── Round API ──

// POST /api/events/:id/rounds/2/generate : 二巡目の行を生成
// 並べ替えは 女子先 → 得点昇順 → 同点は既存 order の文字列順で安定化。
// 採番は コート×性別ごとに1から（現行CSV生成のコート横断通番は廃止）。
// 一巡目の行は一切変更せず、新規行を末尾に追記するだけにする。
app.post('/api/events/:id/rounds/2/generate', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    const players = Array.isArray(event.players) ? event.players : [];
    const force = !!(req.body && req.body.force === true);

    const src = players.filter(p => p && roundOf(p) === 1);
    if (src.length === 0) {
      return res.status(400).json({ error: '一巡目の選手がいません' });
    }

    const unscored = src.filter(p => !isScored(p));
    if (unscored.length > 0 && !force) {
      return res.status(409).json({
        error: '一巡目に未採点の選手がいます',
        reason: 'unscored',
        unscoredCount: unscored.length
      });
    }

    const existing = players.filter(p => p && roundOf(p) === 2);
    if (existing.length > 0 && !force) {
      return res.status(409).json({
        error: '二巡目は既に生成されています',
        reason: 'exists',
        existingCount: existing.length
      });
    }

    // force のときは未生成の一巡目行だけを差分追加する。既存の二巡目行には触れない。
    // sourcePlayerId を持たない二巡目行（CSV経由）は「未生成」と見なされる。
    const generated = {};
    existing.forEach(p => { if (p && p.sourcePlayerId) generated[p.sourcePlayerId] = true; });
    const targets = src.filter(p => p && !generated[p.id]);

    targets.sort((a, b) => {
      const fa = a.isFemale === true ? 0 : 1;
      const fb = b.isFemale === true ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const sa = typeof a.score === 'number' ? a.score : 0;
      const sb = typeof b.score === 'number' ? b.score : 0;
      if (sa !== sb) return sa - sb;
      return (a.order || '').localeCompare(b.order || '');
    });

    const newRows = [];
    targets.forEach(p => {
      const court = courtOf(p);
      const isFemale = p.isFemale === true;
      const gender = isFemale ? '女子' : '男子';
      // 既存の二巡目行があればその続きから、無ければ 1 から始まる。
      const n = nextOrderNumber(players.concat(newRows), court, gender, 2);
      newRows.push({
        id: generateId(),
        name: p.name || '',
        order: buildOrder(court, isFemale, 2, n),
        tech1: '',
        tech2: '',
        tech3: '',
        score: 0,
        isNewFace: p.isNewFace === true,
        isFemale: isFemale,
        result: '',
        sourcePlayerId: p.id
      });
    });

    event.players = players.concat(newRows);
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ success: true, created: newRows.length, skipped: existing.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Techniques API ──

// GET /api/techniques : 技術一覧取得
app.get('/api/techniques', (req, res) => {
  try {
    const customPath = path.join(TECHNIQUES_DIR, 'custom.json');
    if (fs.existsSync(customPath)) {
      const customData = JSON.parse(fs.readFileSync(customPath, 'utf-8'));
      res.json({ isCustom: true, techniques: customData });
    } else {
      res.json({ isCustom: false, techniques: DEFAULT_TECHNIQUES });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/techniques : カスタム技術保存
app.post('/api/techniques', (req, res) => {
  try {
    const { techniques } = req.body;
    if (!Array.isArray(techniques)) {
      return res.status(400).json({ error: 'Invalid data' });
    }
    const customPath = path.join(TECHNIQUES_DIR, 'custom.json');
    writeJsonAtomic(customPath, techniques);
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

// ────────────────────────────────────────
// 静的ファイル配信とSPAフォールバック
// ────────────────────────────────────────
const PUBLIC_DIR = path.resolve(__dirname, '..');
app.use(express.static(PUBLIC_DIR, {
    etag: false,
    setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
}));

app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    } else {
        next();
    }
});

app.listen(PORT, () => {
    console.log(`🎯 PHX Tameshigiri running at http://localhost:${PORT}`);
});
