# 運営スマホ対応 1: サーバー API と `api.js` 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運営者のスマホから選手の追加・編集・削除、二巡目の生成、順位の取得、共有リンクの発行ができるよう、サーバー API とその `api.js` ラッパを実装する（画面は計画2・3で作る）。

**Architecture:** すべての書き込み系ハンドラを既存どおり**同期**（`fs.readFileSync` → 変更 → `writeJsonAtomic`）のまま `server/index.js` に追加し、`order`（`コート-性別-巡目-番号`）の採番と巡目の導出、順位の集計をサーバー側の純粋関数（`parseOrder` / `roundOf` / `nextOrderNumber` / `buildOrder` / `computeRanking`）に集約する。クライアントは `api.js` に薄いラッパ関数を足すだけで、巡目の導出だけは表示のためにクライアント側にも `Courts.roundOf` として同じ実装を置き、両方を `test.html` で固定する。共有リンクは `server/data/links/<token>.json` に置き、大会削除時に連鎖削除する。

**Tech Stack:** Node.js 24 / Express 5（同期 `fs`、JSON ファイル永続化、`crypto.randomBytes`）、素の JavaScript（ES5 相当の IIFE、ビルド無し）、`test.html` によるブラウザ単体テスト。

**設計書:** [docs/superpowers/specs/2026-09-08-mobile-admin-flow-design.md](../specs/2026-09-08-mobile-admin-flow-design.md) の「実装の分割」計画1（テスト 1〜15 と 18）
**前提となる設計書:** [docs/superpowers/specs/2026-09-07-court-operation-reliability-design.md](../specs/2026-09-07-court-operation-reliability-design.md)

---

## 前提知識（この計画を実行する人へ）

このプロジェクトには**ビルド工程もバンドラもテストランナーもありません**。以下を必ず理解してから着手してください。

### テストの動かし方

1. サーバーを起動する（作業中は起動したままにする）。Bash ツールでバックグラウンド実行:
   ```bash
   cd /c/usr/data/AI-Workspace/10_PROJECTS/AntigravityApps/phx-tameshigiri && node server/index.js > "$TEMP/tmg_server.log" 2>&1 &
   ```
   起動確認:
   ```bash
   sleep 1; cat "$TEMP/tmg_server.log"
   ```
   `🎯 PHX Tameshigiri running at http://localhost:3457` が出れば成功。
2. Browser ツールでテストページを開く:
   - `mcp__Claude_Browser__navigate` に `http://localhost:3457/test.html`
   - `mcp__Claude_Browser__find` に `Result:` を渡して末尾のサマリ行を読む
3. サマリ行 `Result: N passed, M failed` の **`M` が 0 であることが合格条件**。
4. `test.html` / `api.js` / `courts.js` を変更したら**ページを再読み込み**するだけでよい（サーバーは `Cache-Control: no-store` を送る）。

### サーバーの再起動（`server/index.js` を変更したら必須）

```bash
netstat -ano | grep ':3457' | grep LISTENING
```
で LISTENING 行の末尾の PID を取り、
```bash
powershell -Command "Stop-Process -Id <PID> -Force"
```
で停止してから、上の起動コマンドを再実行する。**`server/index.js` を編集したのに再起動を忘れると、古いコードに対してテストが走り、原因不明の失敗として時間を溶かします。**

### コードの書き方

**サーバー（`server/index.js`）**

- Node スタイル。`const` / `let` / アロー関数を使ってよい（既存コードがそうなっている）。
- **書き込み系のハンドラは必ず同期のままにすること。** `async (req, res) => {...}` は禁止。`fs.readFileSync` → オブジェクトを変更 → `writeJsonAtomic` の 3 手で完結させる。
  この不変条件は `server/index.js` の `// ── Event API ──` 直前のコメントに明記されており、`test.html` の「並行PATCH12本が全件反映される」（テスト15）が番人になっている。**このテストを消さないこと。**
- 既に使えるヘルパ:
  | 名前 | 用途 |
  |---|---|
  | `isValidId(id)` | `/^[A-Za-z0-9_-]{1,64}$/`。パストラバーサル防止 |
  | `requireValidId(req, res)` | 不正なら 400 を返して `false`。`req.params.id` 専用 |
  | `isScored(player)` | `score > 0` または `result` に `0`/`1` を含む |
  | `writeJsonAtomic(path, data)` | 一時ファイル経由のアトミック書き込み |
  | `generateId()` | 選手・大会の ID 採番 |
  | `EVENTS_DIR` / `HISTORY_DIR` / `TECHNIQUES_DIR` | データ保存先 |

**クライアント（`api.js` / `courts.js` / `test.html`）**

- すべて IIFE。`var` と `function(){}` で書く。`async` / `await` は使ってよい。
- **アロー関数・`let`・`const`・テンプレートリテラル・`class` は使わない。**
- `api.js` の作法: 全関数を `try/catch` で包み、失敗時は**戻り値のコメントに明記した falsy** を返す。呼び出し元は例外を捕まえない。
- `updatePlayer`（採点経路）は `{ ok, status }` を返す。`outbox.js` が `res.ok` と `status === 404` を見て「捨てるか再送するか」を決めているので、**この形を変えないこと**。運営画面の編集は別関数 `updatePlayerInfo` を新設して混ぜない。

### 現状の到達点

作業ツリーは `316db41 docs: 運営者スマホでの大会進行…の設計書` の直後で、`test.html` は **87 passed, 0 failed** です。着手前に必ずこの数字を確認してください。

### コミット

日本語のコミットメッセージ。末尾に共著者行を付ける。

```bash
git commit -m "feat: ..." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## ファイル構成

| ファイル | 責務 | 状態 |
|---|---|---|
| `server/index.js` | `order` の採番・解析ヘルパ、選手 CRUD、二巡目生成、順位集計、共有リンク、大会削除の連鎖削除 | 変更 |
| `api.js` | 新規エンドポイントのラッパ 8 関数 | 変更 |
| `courts.js` | `Courts.roundOf` を追加（`order` の解析はこのモジュールの責務） | 変更 |
| `test.html` | 設計書のテスト 1〜14 と 18 を追加。15（並行PATCH）は維持 | 変更 |
| `server/data/links/` | 共有トークン置き場。起動時に `mkdirSync` | **新規（自動生成）** |

**この計画では画面ファイル（`admin.html` / `share.html` / `present.html` / `ranking.html` / `app.js`）に一切触りません。** それらは計画2・3の担当です。

---

## 計画2・3が依存するインタフェース（変更禁止）

この計画が確定させる公開インタフェース。名前も戻り値の形も変えないでください。

```javascript
// api.js
Api.createPlayer(eventId, data)                 // → player | null
Api.updatePlayerInfo(eventId, playerId, data)   // → { ok: true, player } | { ok: false, status }
Api.deletePlayer(eventId, playerId, force)      // → true | { blocked: true, player } | false
Api.generateNextRound(eventId, force)           // → { success, created, skipped, existingCount, untrackedCount, unassignedCount }
                                                //   | { blocked: true, reason, unscoredCount, existingCount, untrackedCount, unassignedCount } | null
Api.loadRanking(eventId)                        // → { event, rankings } | null
Api.createShareLink(eventId)                    // → { token } | null
Api.loadShareLink(token)                        // → { token, targetType, createdAt } | null
Api.loadSharedRanking(token)                    // → { event, rankings } | null

// courts.js
Courts.roundOf(player)                          // → 1 以上の整数。解析できなければ 1
```

サーバーのルート:

| メソッド | パス |
|---|---|
| `POST` | `/api/events/:id/players` |
| `PATCH` | `/api/events/:id/players/:playerId`（allowlist 化） |
| `DELETE` | `/api/events/:id/players/:playerId?force=1` |
| `POST` | `/api/events/:id/rounds/2/generate` |
| `GET` | `/api/events/:id/ranking` |
| `POST` | `/api/links` |
| `GET` | `/api/links/:token` |
| `GET` | `/api/links/:token/ranking` |

---

## Task 1: 巡目の導出（`Courts.roundOf` とサーバーの `roundOf`）

`order` の第3セグメントが巡目。`round` フィールドを持つと二重管理になるため、常に `order` から導出する。サーバーとクライアントはモジュールを共有できないので同じ関数を2箇所に置き、両方をテストで固定する。

**Files:**
- Modify: `courts.js`
- Modify: `server/index.js`
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の courts.js セクション末尾、`assert('filter: 該当なしは空', Courts.filter(courtPlayers, 'Z').length, 0);` の直後（`var h2r = document.createElement('h2');` の直前）に追加する。

```javascript
    assert('roundOf: A-男子-2-3 → 2', Courts.roundOf({ order: 'A-男子-2-3' }), 2);
    assert('roundOf: A-男子-1-1 → 1', Courts.roundOf({ order: 'A-男子-1-1' }), 1);
    assert('roundOf: 空のorderは1', Courts.roundOf({ order: '' }), 1);
    assert('roundOf: 不正形式は1', Courts.roundOf({ order: 'A-男子-1' }), 1);
    assert('roundOf: nullでも落ちない', Courts.roundOf(null), 1);
```

- [ ] **Step 2: 失敗を確認する**

Run: ブラウザで `http://localhost:3457/test.html` を再読み込みし、`Result:` を探す。

Expected: FAIL。**`Result:` 行が表示されない**（`Courts.roundOf` が未定義のため `TypeError: Courts.roundOf is not a function` で初期化 IIFE が中断し、サマリが追加されない）。`mcp__Claude_Browser__read_console_messages` で `TypeError: Courts.roundOf is not a function` が確認できる。

- [ ] **Step 3: `courts.js` に `roundOf` を実装する**

`courts.js` の `filter` 関数の直後（`return {` の直前）に追加する。

```javascript
  // 巡目（order の第3セグメント）。解析できなければ 1（一巡目）とみなす。
  // 巡目は order からいつでも導出できるので、選手データには持たせない。
  // サーバー側の同じ実装は server/index.js の roundOf。両方を test.html で固定している。
  function roundOf(player) {
    var m = ((player && player.order) || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    return m ? parseInt(m[3], 10) : 1;
  }
```

同ファイル末尾の公開オブジェクトを以下に差し替える。

差し替え前:
```javascript
  return {
    UNASSIGNED: UNASSIGNED,
    courtOf: courtOf,
    listFrom: listFrom,
    filter: filter
  };
```

差し替え後:
```javascript
  return {
    UNASSIGNED: UNASSIGNED,
    courtOf: courtOf,
    listFrom: listFrom,
    filter: filter,
    roundOf: roundOf
  };
```

- [ ] **Step 4: サーバー側の `order` ヘルパを実装する**

`server/index.js` の `isScored` 関数の直後（`// JSONのアトミック書き込み` コメントの直前）に追加する。以降のタスクがすべてこのヘルパ群の上に乗る。

```javascript
// ── order（コート-性別-巡目-番号）の解析と組み立て ──
// クライアント側の対応実装は courts.js（Courts.courtOf / Courts.roundOf）。
// モジュールを共有できない（CommonJS と <script> の IIFE）ため同じ規則を2箇所に持ち、
// 両方を test.html で固定している。
const ORDER_PATTERN = /^([^-]+)-(男子|女子)-(\d+)-(\d+)$/;

// order を { court, gender, round, number } に分解する。解析できなければ null。
function parseOrder(order) {
  const m = (order || '').match(ORDER_PATTERN);
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
  const m = ((player && player.order) || '').match(ORDER_PATTERN);
  return m ? parseInt(m[3], 10) : 1;
}

// コート名（order の先頭セグメント）。Courts.courtOf と同じ規則。
function courtOf(player) {
  const m = ((player && player.order) || '').match(/^([^-]+)/);
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
```

- [ ] **Step 5: 通ることを確認する**

Run: サーバーを停止（`netstat -ano | grep ':3457' | grep LISTENING` → `powershell -Command "Stop-Process -Id <PID> -Force"`）して再起動し、`http://localhost:3457/test.html` を再読み込みする。

Expected: `Result: 96 passed, 0 failed`

- [ ] **Step 6: コミット**

```bash
git add courts.js server/index.js test.html
git commit -m "feat: order から巡目を導出する roundOf をサーバーとクライアントに追加" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: 選手の手動追加（`POST /api/events/:id/players` と `createPlayer`）

CSV インポートしか無かった選手登録に、1名ずつ追加する経路を足す。`order` はサーバーが コート×性別×巡目 ごとに採番する。既存行に触れないため採点中の端末には影響しない（ガード無し）。

**Files:**
- Modify: `server/index.js`
- Modify: `api.js`
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests` 関数の末尾、`await Api.deleteEvent(cleanEvent.id);`（未採点のみの大会のテスト）の直後、関数の閉じ括弧 `}` の直前に追加する。

```javascript
    // --- 選手の手動追加 ---
    var addEvent = await Api.saveEvent({ name: '追加テスト', date: '2026-02-01', venue: '', players: [] });
    var p1 = await Api.createPlayer(addEvent.id, {
      name: '一郎', court: 'A', isFemale: false, isNewFace: false, tech1: '真', tech2: '', tech3: ''
    });
    assert('createPlayer 1人目の order', p1.order, 'A-男子-1-1');
    assert('createPlayer は id を採番する', typeof p1.id, 'string');
    assert('createPlayer の初期得点は0', p1.score, 0);
    assert('createPlayer は result を空で作る', p1.result, '');
    assert('createPlayer は技を保存する', p1.tech1, '真');

    var p2 = await Api.createPlayer(addEvent.id, { name: '二郎', court: 'A', isFemale: false });
    assert('同条件の2人目は -1-2', p2.order, 'A-男子-1-2');
    var p3 = await Api.createPlayer(addEvent.id, { name: '三郎', court: 'B', isFemale: false });
    assert('別コートは番号が1に戻る', p3.order, 'B-男子-1-1');
    var p4 = await Api.createPlayer(addEvent.id, { name: '花子', court: 'A', isFemale: true });
    assert('同コートでも女子は別採番', p4.order, 'A-女子-1-1');
    assert('createPlayer は選手を大会に追加する',
      (await Api.loadEvent(addEvent.id)).players.length, 4);

    assert('name が空なら null', await Api.createPlayer(addEvent.id, { name: '', court: 'A' }), null);
    assert('コート名に - があれば null',
      await Api.createPlayer(addEvent.id, { name: '四郎', court: 'A-1' }), null);
    assert('コート名が未分類なら null',
      await Api.createPlayer(addEvent.id, { name: '四郎', court: '未分類' }), null);
    assert('存在しない大会は null',
      await Api.createPlayer('nosuchevent', { name: '四郎', court: 'A' }), null);
    await Api.deleteEvent(addEvent.id);
```

- [ ] **Step 2: 失敗を確認する**

Run: `http://localhost:3457/test.html` を再読み込みし、`Result:` を探す。

Expected: FAIL。**`Result:` 行が表示されない**。コンソールに `TypeError: Api.createPlayer is not a function` が出る。

- [ ] **Step 3: サーバーにハンドラを実装する**

`server/index.js` の `// ── Player API ──` コメントの直後、`// PATCH /api/events/:id/players/:playerId : 選手の採点結果を部分更新` コメントの直前に追加する。

```javascript
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
```

- [ ] **Step 4: `api.js` に `createPlayer` を追加する**

`api.js` の `updatePlayer` 関数の閉じ括弧 `}` の直後、`async function importCsv(...)` の直前に追加する。

```javascript
  async function createPlayer(eventId, data) {
    // POST /api/events/:eventId/players
    // Body: { name, court, isFemale, isNewFace, tech1, tech2, tech3, round }
    // 戻り値: 追加された player オブジェクト | null（400/404/通信失敗）
    // order はサーバーが コート×性別×巡目 ごとに採番するので、送っても無視される。
    // round を省略すると 1（一巡目）。二巡目の行は generateNextRound が作る。
    try {
      var res = await fetch('/api/events/' + eventId + '/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) return null;
      var json = await res.json();
      return json.player || null;
    } catch (e) {
      return null;
    }
  }
```

`api.js` 末尾の公開オブジェクトの `updatePlayer: updatePlayer,` の直後に1行足す。

```javascript
    createPlayer: createPlayer,
```

- [ ] **Step 5: 通ることを確認する**

Run: サーバーを再起動し、`http://localhost:3457/test.html` を再読み込みする。

Expected: `Result: 109 passed, 0 failed`

- [ ] **Step 6: コミット**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 選手を1名ずつ追加するAPIとコート×性別ごとの自動採番" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: 選手の削除（`DELETE /api/events/:id/players/:playerId` と `deletePlayer`）

誤登録の取り消し。採点済みの選手は 409 で拒否し、得点を見せて確認を取ってから `?force=1` で消す。**削除後の再採番はしない**（他端末が表示中の `order` が動くため）。

**Files:**
- Modify: `server/index.js`
- Modify: `api.js`
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests` 末尾、Task 2 で追加した `await Api.deleteEvent(addEvent.id);` の直後に追加する。

```javascript
    // --- 選手の削除 ---
    var delEvent = await Api.saveEvent({ name: '削除テスト', date: '2026-02-01', venue: '', players: [] });
    var d1 = await Api.createPlayer(delEvent.id, { name: '一郎', court: 'A', isFemale: false });
    var d2 = await Api.createPlayer(delEvent.id, { name: '二郎', court: 'A', isFemale: false });
    var d3 = await Api.createPlayer(delEvent.id, { name: '三郎', court: 'A', isFemale: false });
    assert('deletePlayer は true を返す', await Api.deletePlayer(delEvent.id, d2.id, false), true);
    assert('削除された選手は大会から消える',
      (await Api.loadEvent(delEvent.id)).players.map(function(p) { return p.name; }), ['一郎', '三郎']);
    var d4 = await Api.createPlayer(delEvent.id, { name: '四郎', court: 'A', isFemale: false });
    assert('削除後の追加は欠番を埋めない（最大+1）', d4.order, 'A-男子-1-4');
    assert('残った選手の順番は動かない',
      (await Api.loadEvent(delEvent.id)).players.map(function(p) { return p.order; }),
      ['A-男子-1-1', 'A-男子-1-3', 'A-男子-1-4']);
    assert('存在しない選手の削除は false',
      await Api.deletePlayer(delEvent.id, 'nosuchplayer', false), false);

    // 採点済みは 409 で拒否し、force で通す
    await Api.updatePlayer(delEvent.id, d1.id, { score: 30, result: '1    ' });
    var delBlocked = await Api.deletePlayer(delEvent.id, d1.id, false);
    assert('採点済みの削除は拒否される', delBlocked.blocked, true);
    assert('拒否時に得点を返す', delBlocked.player.score, 30);
    assert('拒否時に選手名を返す', delBlocked.player.name, '一郎');
    assert('拒否時に順番を返す', delBlocked.player.order, 'A-男子-1-1');
    assert('拒否されても選手は残る', (await Api.loadEvent(delEvent.id)).players.length, 3);
    assert('force=true なら採点済みでも削除できる',
      await Api.deletePlayer(delEvent.id, d1.id, true), true);
    assert('force 削除後は2名', (await Api.loadEvent(delEvent.id)).players.length, 2);
    await Api.deleteEvent(delEvent.id);
```

- [ ] **Step 2: 失敗を確認する**

Run: `http://localhost:3457/test.html` を再読み込みする。

Expected: FAIL。**`Result:` 行が表示されない**。コンソールに `TypeError: Api.deletePlayer is not a function` が出る。

- [ ] **Step 3: サーバーにハンドラを実装する**

`server/index.js` の `PATCH /api/events/:id/players/:playerId` ハンドラの閉じ `});` の直後、`// POST /api/events/:id/import : 選手データのCSVインポート` コメントの直前に追加する。

```javascript
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
    const idx = players.findIndex(p => p.id === req.params.playerId);
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
          score: target.score || 0
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
```

- [ ] **Step 4: `api.js` に `deletePlayer` を追加する**

`api.js` の Task 2 で追加した `createPlayer` の閉じ括弧 `}` の直後、`async function importCsv(...)` の直前に追加する。

```javascript
  async function deletePlayer(eventId, playerId, force) {
    // DELETE /api/events/:eventId/players/:playerId?force=1
    // 戻り値: true（削除成功）
    //       | { blocked: true, player: { name, order, score } }（409: 採点済み）
    //       | false（404・400・通信失敗）
    // 削除後の再採番はしないので、番号には欠番が残る。
    try {
      var url = '/api/events/' + eventId + '/players/' + playerId +
                (force === true ? '?force=1' : '');
      var res = await fetch(url, { method: 'DELETE' });
      if (res.status === 409) {
        var conflict = await res.json();
        return { blocked: true, player: conflict.player || null };
      }
      return res.ok;
    } catch (e) {
      return false;
    }
  }
```

`api.js` 末尾の公開オブジェクトの `createPlayer: createPlayer,` の直後に1行足す。

```javascript
    deletePlayer: deletePlayer,
```

- [ ] **Step 5: 通ることを確認する**

Run: サーバーを再起動し、`http://localhost:3457/test.html` を再読み込みする。

Expected: `Result: 124 passed, 0 failed`

- [ ] **Step 6: コミット**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 選手削除APIと採点済みの409ガード" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: `PATCH` の allowlist 化と `updatePlayerInfo`

現行の `PATCH` は `{ ...player, ...req.body }` の単純マージで、`id` も `order` も任意のゴミも書き込めてしまう。受理フィールドを allowlist に限り、`court` / `round` は `order` を組み立てる入力としてだけ使う。

> [!NOTE]
> **設計書からの逸脱（意図的）**: 設計書は「`court` / `isFemale` / `round` のいずれかが来たときだけ `order` を再組立て」としていますが、
> 運営フォームは保存のたびに `isFemale` を必ず送るため、そのまま実装すると**値が変わっていないのに毎回末尾採番され、編集のたびに番号が動きます**。
> そこで「(コート, 性別, 巡目) が**実際に変わったとき**だけ組み立て直す」に絞ります。設計書のテスト5（`court` を `B` に変えると再組立て）は変わらず通ります。

**Files:**
- Modify: `server/index.js`
- Modify: `api.js`
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests` 末尾、Task 3 で追加した `await Api.deleteEvent(delEvent.id);` の直後に追加する。

```javascript
    // --- 選手情報の編集 ---
    var edEvent = await Api.saveEvent({ name: '編集テスト', date: '2026-02-01', venue: '', players: [] });
    var edP = await Api.createPlayer(edEvent.id, { name: '一郎', court: 'A', isFemale: false, tech1: '真' });
    var edRes = await Api.updatePlayerInfo(edEvent.id, edP.id, {
      name: '一郎改', id: 'hacked', order: 'Z-男子-9-9', foo: 'bar'
    });
    assert('updatePlayerInfo は ok を返す', edRes.ok, true);
    assert('updatePlayerInfo は更新後の選手を返す', edRes.player.name, '一郎改');
    assert('id は書き換えられない', edRes.player.id, edP.id);
    assert('order は body で書き換えられない', edRes.player.order, 'A-男子-1-1');
    assert('allowlist 外のフィールドは保存しない', edRes.player.foo, undefined);

    var movedRes = await Api.updatePlayerInfo(edEvent.id, edP.id, { court: 'B' });
    assert('court を変えると order が組み立て直される', movedRes.player.order, 'B-男子-1-1');
    assert('court は選手に保存しない', movedRes.player.court, undefined);
    assert('round は選手に保存しない', movedRes.player.round, undefined);

    // 二巡目の行はコートを変えても巡目が据え置かれる
    var edP2 = await Api.createPlayer(edEvent.id, { name: '二郎', court: 'A', isFemale: false, round: 2 });
    assert('round を指定して追加できる', edP2.order, 'A-男子-2-1');
    var movedRound2 = await Api.updatePlayerInfo(edEvent.id, edP2.id, { court: 'C' });
    assert('round 省略時は巡目が据え置かれる', movedRound2.player.order, 'C-男子-2-1');

    // 性別を変えると order も追従する
    var femaleRes = await Api.updatePlayerInfo(edEvent.id, edP.id, { isFemale: true });
    assert('性別を変えると order が女子になる', femaleRes.player.order, 'B-女子-1-1');

    // 変わっていない値の再送では番号が動かない
    var sameRes = await Api.updatePlayerInfo(edEvent.id, edP.id, {
      name: '一郎改2', court: 'B', isFemale: true
    });
    assert('コート・性別が同じなら番号は動かない', sameRes.player.order, 'B-女子-1-1');

    assert('存在しない選手は status 404',
      (await Api.updatePlayerInfo(edEvent.id, 'nosuchplayer', { name: 'x' })).status, 404);
    await Api.deleteEvent(edEvent.id);
```

- [ ] **Step 2: 失敗を確認する**

Run: `http://localhost:3457/test.html` を再読み込みする。

Expected: FAIL。**`Result:` 行が表示されない**。コンソールに `TypeError: Api.updatePlayerInfo is not a function` が出る。

- [ ] **Step 3: `PATCH` ハンドラを差し替える**

`server/index.js` の既存の `PATCH /api/events/:id/players/:playerId` ハンドラ（`// PATCH /api/events/:id/players/:playerId : 選手の採点結果を部分更新` から、対応する `});` まで）を、以下で**丸ごと差し替える**。

差し替え前:
```javascript
// PATCH /api/events/:id/players/:playerId : 選手の採点結果を部分更新
app.patch('/api/events/:id/players/:playerId', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    const playerIndex = event.players.findIndex(p => p.id === req.params.playerId);
    
    if (playerIndex === -1) {
      return res.status(404).json({ error: '選手が見つかりません' });
    }
    
    // 部分更新
    event.players[playerIndex] = {
      ...event.players[playerIndex],
      ...req.body
    };
    event.updatedAt = new Date().toISOString();

    writeJsonAtomic(eventPath, event);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

差し替え後:
```javascript
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
    const playerIndex = event.players.findIndex(p => p.id === req.params.playerId);

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
```

> `Outbox` は `res.ok` しか見ないため、レスポンスに `player` を足しても後方互換。採点経路が送るのは `score`（数値）と `result`（文字列）だけで、どちらも allowlist に入っている。テスト15（並行PATCH12本）がこれを守る。

- [ ] **Step 4: `api.js` に `updatePlayerInfo` を追加する**

`api.js` の `createPlayer` の閉じ括弧 `}` の直後、`async function deletePlayer(...)` の直前に追加する。

```javascript
  async function updatePlayerInfo(eventId, playerId, data) {
    // PATCH /api/events/:eventId/players/:playerId（運営画面の編集専用）
    // Body: { name, tech1, tech2, tech3, isNewFace, isFemale, score, result, court, round }
    //       のうち送りたいものだけ。id と order は送っても無視される。
    // 戻り値: { ok: true, player } | { ok: false, status: <HTTPステータス> }
    // 通信自体に失敗した場合は status: 0。
    // 採点経路（Outbox → updatePlayer）と混ぜないため、同じPATCHでも別関数にしている。
    try {
      var res = await fetch('/api/events/' + eventId + '/players/' + playerId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) return { ok: false, status: res.status };
      var json = await res.json();
      return { ok: true, player: json.player || null };
    } catch (e) {
      return { ok: false, status: 0 };
    }
  }
```

`api.js` 末尾の公開オブジェクトの `createPlayer: createPlayer,` の直後に1行足す。

```javascript
    updatePlayerInfo: updatePlayerInfo,
```

- [ ] **Step 5: 通ることを確認する**

Run: サーバーを再起動し、`http://localhost:3457/test.html` を再読み込みする。

Expected: `Result: 137 passed, 0 failed`（テスト15「並行PATCH12本が全件反映される」も緑のままであることを目視で確認する）

- [ ] **Step 6: コミット**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 選手PATCHをallowlist化し、コート変更でorderを組み立て直す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: 二巡目の生成（`POST /api/events/:id/rounds/2/generate` と `generateNextRound`）

CSV の往復をやめ、サーバーが二巡目の行を作る。女子先・得点昇順に並べ、コート×性別ごとに1から採番する。未採点や生成済みは 409 で確認を取り、`force` で越える。

**Files:**
- Modify: `server/index.js`
- Modify: `api.js`
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests` 末尾、Task 4 で追加した `await Api.deleteEvent(edEvent.id);` の直後に追加する。

```javascript
    // --- 二巡目の生成 ---
    var genEvent = await Api.saveEvent({ name: '二巡目テスト', date: '2026-02-01', venue: '', players: [] });
    var genCsv = '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' +
                 'M1,A-男子-1-1,真,,,30,,,1    \n' +
                 'M2,A-男子-1-2,真,,,10,,,1    \n' +
                 'M3,A-男子-1-3,真,,,20,○,,1    \n' +
                 'F1,A-女子-1-1,真,,,50,,○,1    \n' +
                 'F2,A-女子-1-2,真,,,5,,○,1    \n' +
                 'M4,B-男子-1-1,真,,,40,,,1    \n';
    await Api.importCsv(genEvent.id, genCsv, 'replace');
    var beforeIds = (await Api.loadEvent(genEvent.id)).players.map(function(p) { return p.id; });

    var gen = await Api.generateNextRound(genEvent.id, false);
    assert('generateNextRound の created は一巡目の人数', gen.created, 6);
    assert('生成時の skipped は0', gen.skipped, 0);

    var genLoaded = await Api.loadEvent(genEvent.id);
    assert('二巡目を足しても一巡目の id は変わらない',
      genLoaded.players.slice(0, 6).map(function(p) { return p.id; }), beforeIds);
    assert('二巡目が6行追加される', genLoaded.players.length, 12);

    var round2 = genLoaded.players.slice(6);
    assert('二巡目は女子が先頭・得点の低い順',
      round2.map(function(p) { return p.name; }), ['F2', 'F1', 'M2', 'M3', 'M1', 'M4']);
    assert('二巡目の順番はコート×性別ごとに1から',
      round2.map(function(p) { return p.order; }),
      ['A-女子-2-1', 'A-女子-2-2', 'A-男子-2-1', 'A-男子-2-2', 'A-男子-2-3', 'B-男子-2-1']);
    assert('二巡目の技は空', [round2[0].tech1, round2[0].tech2, round2[0].tech3], ['', '', '']);
    assert('二巡目の得点は0', round2[0].score, 0);
    assert('二巡目の結果は空', round2[0].result, '');
    assert('二巡目は一巡目の id を sourcePlayerId に持つ',
      round2[0].sourcePlayerId, genLoaded.players[4].id);
    assert('二巡目は新人フラグを引き継ぐ',
      round2.filter(function(p) { return p.isNewFace; }).map(function(p) { return p.name; }), ['M3']);
    assert('二巡目は女子フラグを引き継ぐ',
      round2.filter(function(p) { return p.isFemale; }).map(function(p) { return p.name; }), ['F2', 'F1']);

    var again = await Api.generateNextRound(genEvent.id, false);
    assert('生成済みの再実行は拒否される', again.reason, 'exists');
    assert('拒否時に既存の二巡目人数を返す', again.existingCount, 6);
    assert('拒否されても選手は増えない', (await Api.loadEvent(genEvent.id)).players.length, 12);
    await Api.deleteEvent(genEvent.id);

    // 未採点が残る大会
    var unsEvent = await Api.saveEvent({ name: '未採点テスト', date: '2026-02-01', venue: '', players: [] });
    var unsCsv = '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' +
                 'S1,A-男子-1-1,真,,,30,,,1    \n' +
                 'S2,A-男子-1-2,真,,,0,,,\n' +
                 'S3,A-男子-1-3,真,,,0,,,\n';
    await Api.importCsv(unsEvent.id, unsCsv, 'replace');
    var unscored = await Api.generateNextRound(unsEvent.id, false);
    assert('未採点があれば拒否される', unscored.reason, 'unscored');
    assert('未採点の人数を返す', unscored.unscoredCount, 2);
    var forcedGen = await Api.generateNextRound(unsEvent.id, true);
    assert('force なら未採点でも生成できる', forcedGen.created, 3);
    assert('未採点は得点0として先頭に並ぶ',
      (await Api.loadEvent(unsEvent.id)).players.slice(3).map(function(p) { return p.name; }),
      ['S2', 'S3', 'S1']);
    await Api.deleteEvent(unsEvent.id);

    // 一巡目が0名なら 400
    var emptyEvent = await Api.saveEvent({ name: '空テスト', date: '2026-02-01', venue: '', players: [] });
    assert('一巡目が0名なら null', await Api.generateNextRound(emptyEvent.id, false), null);
    await Api.deleteEvent(emptyEvent.id);
```

- [ ] **Step 2: 失敗を確認する**

Run: `http://localhost:3457/test.html` を再読み込みする。

Expected: FAIL。**`Result:` 行が表示されない**。コンソールに `TypeError: Api.generateNextRound is not a function` が出る。

- [ ] **Step 3: サーバーにハンドラを実装する**

`server/index.js` の `GET /api/events/:id/export` ハンドラの閉じ `});` の直後、`// ── Techniques API ──` コメントの直前に、新しいセクションとして追加する。

```javascript
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

    const src = players.filter(p => roundOf(p) === 1);
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

    const existing = players.filter(p => roundOf(p) === 2);
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
    existing.forEach(p => { if (p.sourcePlayerId) generated[p.sourcePlayerId] = true; });
    const targets = src.filter(p => !generated[p.id]);

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
```

- [ ] **Step 4: `api.js` に `generateNextRound` を追加する**

`api.js` の `exportCsv` 関数の閉じ括弧 `}` の直後、`// --- Techniques ---` コメントの直前に、新しいセクションとして追加する。

```javascript
  // --- Rounds ---
  async function generateNextRound(eventId, force) {
    // POST /api/events/:eventId/rounds/2/generate
    // 戻り値: { success: true, created, skipped, existingCount, untrackedCount, unassignedCount }
    //       | { blocked: true, reason: 'unscored' | 'exists',
    //           unscoredCount, existingCount, untrackedCount, unassignedCount }
    //       | null（400: 一巡目が0名 / 404 / 通信失敗）
    // どちらの 409 も force: true で越えられる。
    // 注: untrackedCount / unassignedCount は本タスクの直後の修正（F4, F3）で足された
    // フィールド。この Step を実装する時点では existingCount / unscoredCount のみでよい。
    try {
      var res = await fetch('/api/events/' + eventId + '/rounds/2/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: force === true })
      });
      if (res.status === 409) {
        var conflict = await res.json();
        return {
          blocked: true,
          reason: conflict.reason || '',
          unscoredCount: conflict.unscoredCount || 0,
          existingCount: conflict.existingCount || 0
        };
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }
```

`api.js` 末尾の公開オブジェクトの `exportCsv: exportCsv,` の直後に1行足す。

```javascript
    generateNextRound: generateNextRound,
```

- [ ] **Step 5: 通ることを確認する**

Run: サーバーを再起動し、`http://localhost:3457/test.html` を再読み込みする。

Expected: `Result: 171 passed, 0 failed`

- [ ] **Step 6: コミット**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 二巡目の生成APIをサーバーに実装し、コート×性別ごとに採番する" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: 順位の集計（`computeRanking` と `GET /api/events/:id/ranking`）

順位の集計は今 `ranking.html` のクライアント側にしかない。サーバーの `computeRanking(event)` を唯一の実装にし、運営画面・`ranking.html`・`share.html`・`present.html` はその結果を描くだけにする（差し替えは計画3）。

**Files:**
- Modify: `server/index.js`
- Modify: `api.js`
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests` 末尾、Task 5 で追加した `await Api.deleteEvent(emptyEvent.id);` の直後に追加する。

```javascript
    // --- 順位データ ---
    var rankEvent = await Api.saveEvent({ name: '順位テスト', date: '2026-03-01', venue: '道場', players: [] });
    var rankCsv = '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' +
                  '吉野,A-男子-1-1,真,,,40,,,1    \n' +
                  '吉野,A-男子-2-1,真,,,34,,,1    \n' +
                  '田中,A-男子-1-2,真,,,74,,,1    \n' +
                  '佐藤,A-男子-1-3,真,,,20,,,1    \n' +
                  '新人太郎,A-男子-1-4,真,,,10,○,,1    \n' +
                  '花子,A-女子-1-1,真,,,30,,○,1    \n';
    await Api.importCsv(rankEvent.id, rankCsv, 'replace');
    var ranking = await Api.loadRanking(rankEvent.id);
    assert('loadRanking は大会名を返す', ranking.event.name, '順位テスト');
    assert('loadRanking は開催日と会場を返す',
      [ranking.event.date, ranking.event.venue], ['2026-03-01', '道場']);
    assert('一般男子は氏名で合算し同点は同順位（1,1,3）',
      ranking.rankings.male,
      [ { rank: 1, name: '吉野', score: 74 },
        { rank: 1, name: '田中', score: 74 },
        { rank: 3, name: '佐藤', score: 20 },
        { rank: 4, name: '新人太郎', score: 10 } ]);
    assert('一般女子', ranking.rankings.female, [{ rank: 1, name: '花子', score: 30 }]);
    assert('新人は男子にも新人にも入る',
      ranking.rankings.newFace, [{ rank: 1, name: '新人太郎', score: 10 }]);
    assert('順位の項目は rank/name/score だけ',
      Object.keys(ranking.rankings.male[0]), ['rank', 'name', 'score']);
    assert('順位に result は含まれない', ranking.rankings.male[0].result, undefined);
    assert('存在しない大会の順位は null', await Api.loadRanking('nosuchevent'), null);
    await Api.deleteEvent(rankEvent.id);
```

- [ ] **Step 2: 失敗を確認する**

Run: `http://localhost:3457/test.html` を再読み込みする。

Expected: FAIL。**`Result:` 行が表示されない**。コンソールに `TypeError: Api.loadRanking is not a function` が出る。

- [ ] **Step 3: `computeRanking` を実装する**

`server/index.js` の `writeJsonAtomic` 関数の直後、`// ミドルウェア` コメントの直前に追加する。

```javascript
// 順位の集計。順位ロジックの唯一の実装。
// 行ごとに isFemale で男女に振り分け、isNewFace なら新人にも入れる。
// 氏名で合算する（一巡目＋二巡目）。得点降順、同点は同順位で次の順位は飛ぶ（1, 1, 3）。
// ○×の生データ（result）や order は返さない（共有リンクから無認証で読まれるため）。
function computeRanking(event) {
  const male = {};
  const female = {};
  const newFace = {};

  const add = (dict, name, score) => { dict[name] = (dict[name] || 0) + score; };

  ((event && event.players) || []).forEach(p => {
    const name = (p && p.name) || '';
    if (!name) return;
    const score = typeof p.score === 'number' ? p.score : 0;
    if (p.isFemale) add(female, name, score);
    else add(male, name, score);
    if (p.isNewFace) add(newFace, name, score);
  });

  const rank = dict => {
    const entries = Object.keys(dict)
      .map(name => ({ name: name, score: dict[name] }))
      .sort((a, b) => b.score - a.score);
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
    }
  };
}
```

- [ ] **Step 4: `GET /api/events/:id/ranking` を追加する**

`server/index.js` の Task 5 で追加した `POST /api/events/:id/rounds/2/generate` ハンドラの閉じ `});` の直後、`// ── Techniques API ──` コメントの直前に追加する。

```javascript
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
```

- [ ] **Step 5: `api.js` に `loadRanking` を追加する**

`api.js` の `addHistory` 関数の閉じ括弧 `}` の直後、`return {` の直前に、新しいセクションとして追加する。

```javascript
  // --- Ranking / Share ---
  async function loadRanking(eventId) {
    // GET /api/events/:eventId/ranking
    // 戻り値: { event: { name, date, venue, updatedAt },
    //          rankings: { male: [{ rank, name, score }], female: [...], newFace: [...] } }
    //       | null（400/404/通信失敗）
    try {
      var res = await fetch('/api/events/' + eventId + '/ranking');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }
```

`api.js` 末尾の公開オブジェクトの `addHistory: addHistory` の行を以下に差し替える（末尾のカンマに注意）。

差し替え前:
```javascript
    addHistory: addHistory
```

差し替え後:
```javascript
    addHistory: addHistory,
    loadRanking: loadRanking
```

- [ ] **Step 6: 通ることを確認する**

Run: サーバーを再起動し、`http://localhost:3457/test.html` を再読み込みする。

Expected: `Result: 179 passed, 0 failed`

- [ ] **Step 7: コミット**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 順位の集計をサーバーの computeRanking に一本化する" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: 共有リンク（`LINKS_DIR` と `/api/links` 系、大会削除の連鎖削除）

参加者向けの閲覧専用リンク。トークンは大会ごとに1つで冪等に発行し、`GET` 系は無認証で通す（並行して進む認証タスクへの申し送り）。トークンは `isValidId` で必ず検証してから `path.join` する。

**Files:**
- Modify: `server/index.js`
- Modify: `api.js`
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests` 末尾、Task 6 で追加した `await Api.deleteEvent(rankEvent.id);` の直後に追加する。

```javascript
    // --- 共有リンク ---
    var shareEvent = await Api.saveEvent({ name: '共有テスト', date: '2026-03-02', venue: '', players: [] });
    var shareCsv = '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' +
                   '甲,A-男子-1-1,真,,,25,,,1    \n' +
                   '乙,A-男子-1-2,真,,,50,,,1    \n' +
                   '丙,A-男子-1-3,真,,,10,,,1    \n' +
                   '甲,A-男子-2-1,真,,,25,,,1    \n';
    await Api.importCsv(shareEvent.id, shareCsv, 'replace');

    var link1 = await Api.createShareLink(shareEvent.id);
    assert('createShareLink はトークンを返す', typeof link1.token, 'string');
    assert('トークンは8文字', link1.token.length, 8);
    var link2 = await Api.createShareLink(shareEvent.id);
    assert('createShareLink は冪等（同じトークンを返す）', link2.token, link1.token);
    assert('トークンは大会に保存される',
      (await Api.loadEvent(shareEvent.id)).shareToken, link1.token);

    var linkInfo = await Api.loadShareLink(link1.token);
    assert('loadShareLink は対象種別を返す', linkInfo.targetType, 'event');
    assert('loadShareLink は対象の大会IDを返す', linkInfo.targetId, shareEvent.id);
    assert('loadShareLink は作成日時を返す', typeof linkInfo.createdAt, 'string');

    var shared = await Api.loadSharedRanking(link1.token);
    assert('loadSharedRanking は氏名合算と同点同順位（1,1,3）を返す',
      shared.rankings.male,
      [ { rank: 1, name: '甲', score: 50 },
        { rank: 1, name: '乙', score: 50 },
        { rank: 3, name: '丙', score: 10 } ]);
    assert('共有の順位の項目も rank/name/score だけ',
      Object.keys(shared.rankings.male[0]), ['rank', 'name', 'score']);
    assert('共有の順位は大会名を含む', shared.event.name, '共有テスト');

    assert('不正なトークンは null',
      await Api.loadShareLink('../../events/' + shareEvent.id), null);
    assert('不正なトークンの順位も null',
      await Api.loadSharedRanking('../../events/' + shareEvent.id), null);
    assert('存在しないトークンは null', await Api.loadShareLink('zzzzzzzz'), null);

    await Api.deleteEvent(shareEvent.id);
    assert('大会を削除するとリンクも消える', await Api.loadShareLink(link1.token), null);
    assert('大会を削除すると共有の順位も消える', await Api.loadSharedRanking(link1.token), null);
```

- [ ] **Step 2: 失敗を確認する**

Run: `http://localhost:3457/test.html` を再読み込みする。

Expected: FAIL。**`Result:` 行が表示されない**。コンソールに `TypeError: Api.createShareLink is not a function` が出る。

- [ ] **Step 3: `crypto` と `LINKS_DIR` を用意する**

`server/index.js` 冒頭の `const fs = require('fs');` の直後に1行追加する。

```javascript
const crypto = require('crypto');
```

`const HISTORY_DIR = path.join(DATA_DIR, 'history');` の直後に1行追加する。

```javascript
const LINKS_DIR = path.join(DATA_DIR, 'links');
```

`fs.mkdirSync(HISTORY_DIR, { recursive: true });` の直後に1行追加する。

```javascript
fs.mkdirSync(LINKS_DIR, { recursive: true });
```

- [ ] **Step 4: 共有リンクのハンドラを実装する**

`server/index.js` の `POST /api/events/:id/history` ハンドラの閉じ `});` の直後、`// ────────────────────────────────────────` （静的ファイル配信の区切り）の直前に、新しいセクションとして追加する。

```javascript
// ── Share Link API ──
// GET 系は参加者が無認証で開く（share.html / present.html）。認証を足す際も保護しないこと。
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
    if (isValidId(event.shareToken) &&
        fs.existsSync(path.join(LINKS_DIR, `${event.shareToken}.json`))) {
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
    res.json(JSON.parse(fs.readFileSync(linkPath, 'utf-8')));
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
```

- [ ] **Step 5: 大会削除でリンクも消す**

`server/index.js` の `DELETE /api/events/:id` ハンドラ内の以下のブロックを差し替える。

差し替え前:
```javascript
    if (fs.existsSync(eventPath)) {
      fs.unlinkSync(eventPath);
    }
```

差し替え後:
```javascript
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
```

- [ ] **Step 6: `api.js` に3関数を追加する**

`api.js` の Task 6 で追加した `loadRanking` の閉じ括弧 `}` の直後、`return {` の直前に追加する。

```javascript
  async function createShareLink(eventId) {
    // POST /api/links
    // 戻り値: { token } | null（400/404/通信失敗）
    // 冪等。大会に shareToken があればそれをそのまま返す。
    try {
      var res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'event', targetId: eventId })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function loadShareLink(token) {
    // GET /api/links/:token（無認証）
    // 戻り値: { token, targetType, createdAt } | null
    // 不正・失効したトークンは null。呼び出し元は「このリンクは無効です」を出す。
    try {
      var res = await fetch('/api/links/' + encodeURIComponent(token));
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function loadSharedRanking(token) {
    // GET /api/links/:token/ranking（無認証）
    // 戻り値: loadRanking と同じ { event, rankings } | null
    try {
      var res = await fetch('/api/links/' + encodeURIComponent(token) + '/ranking');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }
```

`api.js` 末尾の公開オブジェクトの `loadRanking: loadRanking` の行を以下に差し替える。

差し替え前:
```javascript
    loadRanking: loadRanking
```

差し替え後:
```javascript
    loadRanking: loadRanking,
    createShareLink: createShareLink,
    loadShareLink: loadShareLink,
    loadSharedRanking: loadSharedRanking
```

- [ ] **Step 7: 通ることを確認する**

Run: サーバーを再起動し、`http://localhost:3457/test.html` を再読み込みする。

Expected: `Result: 204 passed, 0 failed`

また、リンクのディレクトリが作られ、テストの後始末で空になっていることを確認する。

```bash
ls -a "/c/usr/data/AI-Workspace/10_PROJECTS/AntigravityApps/phx-tameshigiri/server/data/links"
```

Expected: `.` と `..` だけ（テストが作ったトークンは大会削除で連鎖削除されている）

- [ ] **Step 8: コミット**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 参加者向けの共有トークンAPIと大会削除時の連鎖削除" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: 同期実行の不変条件コメントの更新と最終確認

書き込み系のハンドラが4本増えたので、不変条件のコメントに新しいエンドポイントを明記して、次に触る人が `async` 化しないようにする。

**Files:**
- Modify: `server/index.js`
- Test: `test.html`（変更なし。全件が緑であることの確認のみ）

- [ ] **Step 1: 非同期ハンドラが混入していないことを確認する**

```bash
grep -n "async (req" /c/usr/data/AI-Workspace/10_PROJECTS/AntigravityApps/phx-tameshigiri/server/index.js
grep -n "await" /c/usr/data/AI-Workspace/10_PROJECTS/AntigravityApps/phx-tameshigiri/server/index.js
```

Expected: どちらも**何も出力されない**（ヒット0件）。1件でも出たら、そのハンドラを同期に書き直すこと。

- [ ] **Step 2: 不変条件コメントを差し替える**

`server/index.js` の `// ── Event API ──` の直前にあるコメントブロックを差し替える。

差し替え前:
```javascript
// 【不変条件】以下の書き込み系ハンドラは同期のまま維持すること。
// 同期 fs + 単一スレッドにより read-modify-write が不可分になっており、
// これが複数端末からの同時採点の安全性を担保している。
// async 化して await を挟むと、コートごとの端末が同時に採点したとき
// 更新が失われる。非同期化する場合は大会IDごとの書き込みロックを併せて導入すること。
// test.html の「並行PATCH12本が全件反映される」がこの不変条件の番人。
```

差し替え後:
```javascript
// 【不変条件】以下の書き込み系ハンドラは同期のまま維持すること。
// 同期 fs + 単一スレッドにより read-modify-write が不可分になっており、
// これが複数端末からの同時採点の安全性を担保している。
// async 化して await を挟むと、コートごとの端末が同時に採点したとき
// 更新が失われる。非同期化する場合は大会IDごとの書き込みロックを併せて導入すること。
// test.html の「並行PATCH12本が全件反映される」がこの不変条件の番人。
//
// 対象:
//   POST   /api/events
//   DELETE /api/events/:id
//   POST   /api/events/:id/players
//   PATCH  /api/events/:id/players/:playerId
//   DELETE /api/events/:id/players/:playerId
//   POST   /api/events/:id/rounds/2/generate
//   POST   /api/events/:id/import
//   POST   /api/events/:id/history
//   POST   /api/links               （大会ファイルに shareToken を書き込む）
//   POST   /api/techniques / DELETE /api/techniques
```

- [ ] **Step 3: 全テストが通ることを確認する**

Run: サーバーを再起動し、`http://localhost:3457/test.html` を再読み込みする。`mcp__Claude_Browser__find` で `並行PATCH` も探して緑（`✓`）であることを確認する。

Expected: `Result: 204 passed, 0 failed`、かつ `✓ 並行PATCH12本が全件反映される` が表示されている。

- [ ] **Step 4: 一時ファイルとテスト残骸が無いことを確認する**

```bash
find /c/usr/data/AI-Workspace/10_PROJECTS/AntigravityApps/phx-tameshigiri/server/data -name "*.tmp"
```

Expected: 何も出力されない

- [ ] **Step 5: コミット**

```bash
git add server/index.js
git commit -m "docs: 同期実行の不変条件に新しい書き込みハンドラを追記" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 設計書のテストとタスクの対応

| 設計書のテスト | 内容 | タスク |
|---|---|---|
| 1 | `createPlayer` の `order` が `A-男子-1-1`、2人目は `-1-2` | Task 2 |
| 2 | 別コート・女子で番号が1に戻る | Task 2 |
| 3 | 削除しても欠番を埋めない（3人目を消さず2人目を消すと次は `-1-4`） | Task 3 |
| 4 | `name` 変更で `id` 不変、body の `id` は無視 | Task 4 |
| 5 | `court` を `B` にすると `order` を再組立て | Task 4 |
| 6 | 採点済みの削除が `blocked`、`force` で成功 | Task 3 |
| 7 | `created === 一巡目人数`、一巡目の `id` が不変 | Task 5 |
| 8 | 2回目は `exists`、人数が増えない | Task 5 |
| 9 | `unscored` と `unscoredCount`、`force` で通る | Task 5 |
| 10 | 二巡目行の `order` / 技 / 得点 / `sourcePlayerId` / 女子先頭 | Task 5 |
| 11 | `createShareLink` が冪等 | Task 7 |
| 12 | `loadSharedRanking` の氏名合算・同点同順位・`result` 非含有 | Task 6（`/api/events/:id/ranking`）＋ Task 7（共有経路） |
| 13 | 不正トークンが `null`（サーバーは 400） | Task 7 |
| 14 | 大会削除で `links/<token>.json` も消える | Task 7 |
| 15 | 並行PATCH12本（既存） | Task 4 で維持を確認、Task 8 で最終確認 |
| 18 | `roundOf` の4パターン | Task 1 |

テスト 16・17（`TechPicker`）は計画2の担当です。

---

## 完了時点のテスト件数

| 時点 | 件数 |
|---|---|
| 着手前 | 87 passed, 0 failed |
| Task 1 完了 | 96 passed, 0 failed |
| Task 2 完了 | 109 passed, 0 failed |
| Task 3 完了 | 124 passed, 0 failed |
| Task 4 完了 | 137 passed, 0 failed |
| Task 5 完了 | 171 passed, 0 failed |
| Task 6 完了 | 179 passed, 0 failed |
| Task 7 完了 | **204 passed, 0 failed** |
| Task 8 完了 | **204 passed, 0 failed**（テスト追加なし） |

**この計画の完了条件は `Result: 204 passed, 0 failed`。**

---

## 引き継ぎ（計画2・3へ）

- `admin.html` の選手登録フォームは `Api.createPlayer` に**常に `round: 1`** で送る。二巡目の行は `Api.generateNextRound` だけが作る。
- 採点済み選手の性別変更でサーバーは得点を再計算しない。「採点画面で開き直してください」の警告はクライアント側の責務。
- 一巡目を削除しても二巡目の行は残る。`sourcePlayerId` の参照先を失った二巡目行は、進行タブで「一巡目の得点」を `—` と表示し、「一巡目と同じ技をコピー」を無効にすること。
- 認証タスクとの噛み合わせ: `GET /api/links/:token` と `GET /api/links/:token/ranking` は**無認証のまま**通すこと。`POST /api/links` は保護対象。
