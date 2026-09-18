# PC の選手表（編集できる表・行の追加・貼り付けによる一括登録） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC 運営（`desk.html`）の「選手」の区画を、読み取り専用の表から**編集できる表**にする。セルを直して blur / Enter で保存、「＋ 行を追加」で 1 人ずつ足す、「📋 貼り付けて追加」で Excel から一気に登録する、行の「⋯」から削除・CSV 取り込みができるところまで。

**Architecture:** 表は `desk-players.js` だけが持つ。保存はセル 1 つにつき 1 項目を `Api.updatePlayerInfo`（PATCH）で送り、表全体を送り直さない。絞り込み・並べ替えはスマホ運営の選手タブと同じ純粋関数（`Courts.applyFilter` / `Courts.sortBy`）を使い、DOM を持たない判定（貼り付けの解析・採点済みの警告）は `courts.js` に置いて `test.html` で固定する。貼り付けの登録先はサーバーの `POST /api/events/:id/players/bulk` を行形式（`rows`）に拡張して使い、全行を検証してから 1 回だけ書く。

**Tech Stack:** 素の JavaScript（IIFE、`var` と `function`。`async`/`await` は可）、Express 5、`test.html`（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は `JSON.stringify` 比較）。

設計書: `docs/superpowers/specs/2026-09-18-pc-mode-and-event-status-design.md`（「画面設計 > PC 運営 > 選手」「API > 一括登録」「エラー処理」「テスト」13）
参考: `docs/superpowers/specs/2026-09-18-players-table-design.md`（スマホの選手表。絞り込み・並べ替え・IME の知見）
前の計画: `docs/superpowers/plans/2026-09-18-desk-foundation.md`（計画2。実装済み。`Desk.*` の公開 API・`desk.css` の `.desk-table` など・読み取り専用の選手表）

この計画は設計書「実装の分割」の **計画4: PC の選手表** だけを扱う。計画5（PC の試合と結果）とヘルプの更新は**やらない**。

---

## 前提・共通の手順

- **同じ作業ツリーで計画3（トップと `scoring.html` への改名）の担当者が並行して作業している**。触っているのは `index.html` `home.js` `home.css` `scoring.html` `app.js` `server/static-policy.js` `server/auth.test.js` `admin.js` `desk.js` `ranking.html` `techniques.html` `help.html` と **`test.html`** と **`storage.js`**。
  - **この計画では `desk.js` `app.js` `index.html` `home.*` `admin.js` には一切触らない**
  - `test.html` と `storage.js` は両方が触る。**足す場所をこの計画で指定したとおりにすれば衝突しない**（`test.html` は `runApiTests` の中と `courts.js` の節の末尾、`storage.js` は `pickJsonFile` の節）。編集前に必ず `git status` と対象箇所を読み直す
  - `git add` は**各タスクで明示したファイルだけ**。`git status` に出る他人の変更を巻き込まない。`.git/index.lock` があれば数秒待って再試行する
- **サーバーの起動**: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。`.claude/launch.json` の `dev-3461` が同じ構成。既に起動していれば再利用する
- **サーバーを変えたら必ず再起動する**（`server/index.js` と `status.js` は `require` で読まれる）。JS / CSS / HTML の変更だけなら再起動は不要
- **自動テスト**: `http://localhost:3461/test.html` をブラウザで開き、ページ末尾の `Result: N passed, 0 failed` を確認する。編集後の再確認は同じ URL への再 navigate ではなく `location.reload()` か**新しいタブ**で行う（bfcache で古い JS が使われる）
- **画面確認**: `http://localhost:3461/desk.html`（PC 運営。ウィンドウ幅 **1280px**）、`http://localhost:3461/admin.html`（スマホ運営。幅 375px。共通化した部分の回帰確認）
- 確認に使う大会は**自分がこの作業中に作った大会だけ**。**本物の大会「第10回全日本試し斬り大会」のデータには絶対に触らない**（状態を進めない・選手を消さない）
- コミットメッセージは日本語。接頭辞は `feat:` `fix:` `refactor:` `test:` `docs:`。末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける
- **作法**: IIFE、`var` と `function`、`async`/`await` は可。`await` の直後は必ず `ctx.isStale()` を見て、古ければ DOM に触らない・`alert` も出さない。ダイアログの中で `await` をまたぐときは `Desk.currentEventId() !== eventId` も見る（`desk-events.js` と同じ作法）
- **状態の判定を直書きしない**（`event.status === 'final'` と書かず `EventStatus.of` / `EventStatus.isLocked` を使う）
- **`desk.css` は `theme.css` の変数だけを使う**。赤い文字は `--btn-fail`（#b3261e 固定）ではなく `--cell-fail-text` を使う（ダークで読めるのはこちら）。`--btn-fail` は枠線とボタンに使う
- 計画2では「`desk.css` は Task 4 で書き切り、以降は触らない」としたが、**この計画では選手表のために追記してよい**（Task 5 の 1 タスクにまとめる）

---

## ファイル構成

- **Modify**: `server/index.js` — `POST /api/events/:id/players/bulk` に行形式（`rows`）を足す。`bulkFromRows` を新設
- **Modify**: `api.js` — `createPlayersBulk` の説明を行形式に合わせ、エラー応答が JSON でなくても `{ error }` を返す
- **Modify**: `courts.js` — `parsePasteRows(text, techniques)`（貼り付けの解析）、`scoreMayChange(player, data)` と `scoreChangeConfirmMessage(player)`（採点済みの警告。`admin-players.js` から移す）
- **Modify**: `storage.js` — `pickTextFile(accept, onText, onDone)` を切り出し、`pickJsonFile` と新しい `pickCsvFile` をその薄いラッパーにする
- **Modify**: `admin-players.js` — 移した 2 つを `Courts.*` から呼ぶ。自前の `pickCsv` を `Storage.pickCsvFile` に置き換える
- **Modify**: `desk.css` — 選手表・チップの帯・セルの入力・貼り付けダイアログのスタイル
- **Modify**: `desk-players.js` — 読み取り専用の表を、絞り込み・並べ替え・編集・行の追加・貼り付け・削除・CSV 取り込みができる表にする（この計画の本体）
- **Modify**: `test.html` — 設計書のテスト 13（`bulk` の `rows`）、`Courts.parsePasteRows`、`Courts.scoreMayChange` / `scoreChangeConfirmMessage`

**触らない**: `desk.js` `desk.html` `admin.js` `admin.html` `app.js` `index.html` `home.*` `server/static-policy.js`（新しいファイルを作らないので許可リストの変更は不要）。

---

## 並行できるタスク

- **Task 1 → 2 → 3 → 4** は順番に行う（1・2・3 が `test.html`、3・4 が `admin-players.js`、2・3 が `courts.js` を触る）
- **Task 5**（`desk.css`）は**いつでも単独で並行できる**（他のどのタスクとも触るファイルが重ならない）
- **Task 6 → 7 → 8 → 9 → 10** は順番に行う（全部 `desk-players.js` の同じ関数群を育てる）。開始の前提は次のとおり:
  - Task 6: Task 5 が済んでいること
  - Task 7: Task 3（`Courts.scoreMayChange`）と Task 6
  - Task 8: Task 7
  - Task 9: Task 1（サーバーの `rows`）と Task 2（`Courts.parsePasteRows`）と Task 8
  - Task 10: Task 4（`Storage.pickCsvFile`）と Task 9
- **Task 11** は全部の後（通しの手動確認）
- つまり、**A: Task 1→2→3→4** と **B: Task 5** を同時に始め、両方が終わったら Task 6 以降を 1 本で進めるのが最短

---

### Task 1: 一括登録 API に行形式（`rows`）を足す（設計書のテスト 13）

今の `POST /api/events/:id/players/bulk` は「同じコート・性別・新人区分で名前だけ」の形（`names`）しか受けない。PC の貼り付けは行ごとにコート・性別・新人・技が違うので、`rows` の形を足す。**全行を検証してから 1 回だけ書く**（途中で失敗して半分だけ登録された状態を作らない）。技名はその大会の**有効な技リスト**（`effectiveTechniques`）にある名前だけを許す。ロックガード（`rejectIfLocked`）は既存のまま。

**Files:**
- Modify: `server/index.js`（`app.post('/api/events/:id/players/bulk', …)` の節。現在 792 行目あたりのコメントから）
- Modify: `api.js`（`createPlayersBulk`）
- Modify: `test.html`（`runApiTests` の中。既存の `// 一括登録` の一連の後ろ）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests` の中、既存の一括登録テストの最後の行

```js
    await Api.importCsv(testEventId, '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n', 'replace');   // 後続のテストのため空に戻す
```

の**直後**（`// PATCH: 補正点・備考・確定・負の得点` の直前）に足す。

```js
    // ---- 一括登録の行形式（設計書 API「一括登録」・テスト 13。PC 運営の「貼り付けて追加」） ----
    // 技名はその大会の「有効な技リスト」で照合されるので、実際の技リストから借りる
    // （サーバーに独自の雛形が保存されている環境でも固定の技名に依存しない）。
    var brEvent = await Api.saveEvent({ name: '行形式テスト', date: '2026-09-19', venue: '', players: [] });
    var brLoaded = await Api.loadEvent(brEvent.id);
    var brTech = brLoaded.techniques[0].name;
    var brTech2 = brLoaded.techniques[1].name;

    var br = await Api.createPlayersBulk(brEvent.id, { rows: [
      { name: '行 一郎', court: 'A', isFemale: false, isNewFace: true, tech1: brTech, tech2: '', tech3: '' },
      { name: ' 行 二郎 ', court: 'A', isFemale: false, isNewFace: false, tech1: brTech, tech2: brTech2, tech3: brTech },
      { name: '行 花子', court: 'B', isFemale: true, isNewFace: false }
    ] });
    assert('bulk rows: 3 行が採番される', br.created, 3);
    assert('bulk rows: コート×性別ごとに採番する',
      br.players.map(function(p) { return p.order; }), ['A-男子-1-1', 'A-男子-1-2', 'B-女子-1-1']);
    assert('bulk rows: 名前は trim する', br.players[1].name, '行 二郎');
    assert('bulk rows: 技はそのまま入る',
      [br.players[1].tech1, br.players[1].tech2, br.players[1].tech3], [brTech, brTech2, brTech]);
    assert('bulk rows: 技を省いた行は空で作る',
      [br.players[2].tech1, br.players[2].tech2, br.players[2].tech3], ['', '', '']);
    assert('bulk rows: 性別・新人は行ごとに付く',
      [br.players[0].isNewFace, br.players[1].isNewFace, br.players[2].isFemale], [true, false, true]);

    var br2 = await Api.createPlayersBulk(brEvent.id, { rows: [{ name: '行 三郎', court: 'A' }] });
    assert('bulk rows: 既存の続きから採番', br2.players[0].order, 'A-男子-1-3');

    var brBadTech = await Api.createPlayersBulk(brEvent.id, { rows: [
      { name: '行 四郎', court: 'A', tech1: brTech },
      { name: '行 五郎', court: 'A', tech1: 'ありえない技' }
    ] });
    assert('bulk rows: 技リストに無い技名は行番号つきの 400',
      brBadTech && brBadTech.error, '2 行目: 技「ありえない技」は技リストにありません');

    var brNoName = await Api.createPlayersBulk(brEvent.id, {
      rows: [{ name: '行 六郎', court: 'A' }, { name: '  ', court: 'A' }]
    });
    assert('bulk rows: 名前が空なら行番号つきの 400', brNoName && brNoName.error, '2 行目: 選手名が必要です');

    var brBadCourt = await Api.createPlayersBulk(brEvent.id, { rows: [{ name: '行 七郎', court: 'A-1' }] });
    assert('bulk rows: 不正なコートは行番号つきの 400', brBadCourt && brBadCourt.error, '1 行目: 不正なコート名です');

    var brNoCourt = await Api.createPlayersBulk(brEvent.id, { rows: [{ name: '行 八郎' }] });
    assert('bulk rows: コートが空でも行番号つきの 400', brNoCourt && brNoCourt.error, '1 行目: 不正なコート名です');

    var brEmpty = await Api.createPlayersBulk(brEvent.id, { rows: [] });
    assert('bulk rows: 空の配列は 400', brEmpty && brEmpty.error, '登録する行がありません');

    var brMany = [];
    for (var bri = 0; bri < 501; bri++) brMany.push({ name: '多' + bri, court: 'A' });
    var brTooMany = await Api.createPlayersBulk(brEvent.id, { rows: brMany });
    assert('bulk rows: 501 行は 400', brTooMany && brTooMany.error, '一度に登録できるのは500名までです');

    var brAfter = await Api.loadEvent(brEvent.id);
    assert('bulk rows: 1 行でも不正なら 1 人も登録されない（4名のまま）', brAfter.players.length, 4);
    await Api.deleteEvent(brEvent.id);
```

- [ ] **Step 2: テストが落ちるのを確かめる**

サーバーを起動したまま `http://localhost:3461/test.html` を**新しいタブ**で開く。
Expected: `bulk rows:` の assert が赤で落ちる（`rows` を知らないサーバーは `names` が無いので `名前の配列が必要です` を返す）。`Result: N passed, M failed`（M > 0）。

- [ ] **Step 3: サーバーに行形式を足す**

`server/index.js` の一括登録の節。置き換え前（コメント 2 行 + ハンドラの冒頭 5 行）:

```js
// POST /api/events/:id/players/bulk : 同じコート・性別・新人区分の選手をまとめて追加（一巡目、技は空）
// 名前は1件ずつ trim して空を除く。コート・性別・巡目は全員共通なので nextOrderNumber は
// 最初に1回だけ求め、あとは連番で増やす（毎回 concat して数え直すと件数の二乗のコストになる）。
app.post('/api/events/:id/players/bulk', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const body = req.body || {};
    const court = typeof body.court === 'string' ? body.court.trim() : '';
```

置き換え後:

```js
// 一括登録の行形式（PC 運営の「貼り付けて追加」）。
// 行ごとにコート・性別・新人・技が違う。全行を検証してから 1 回だけ書き、
// 1 行でも不正なら 1 人も登録しない（半分だけ登録された状態を運営に見せない）。
// 技名はその大会の「有効な技リスト」（effectiveTechniques）にある名前だけを許す。
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

  const known = {};
  effectiveTechniques(event).forEach(t => {
    const n = (t && typeof t.name === 'string') ? t.name.trim() : '';
    if (n) known[n] = true;
  });

  // 1. 全行の検証（ここでは何も書かない）
  const checked = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const at = `${i + 1} 行目: `;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: at + '選手名が必要です' });
    }
    const court = typeof row.court === 'string' ? row.court.trim() : '';
    if (!isValidCourt(court)) {
      return res.status(400).json({ error: at + '不正なコート名です' });
    }
    const techs = ['tech1', 'tech2', 'tech3'].map(k => (typeof row[k] === 'string' ? row[k].trim() : ''));
    for (let t = 0; t < techs.length; t++) {
      if (techs[t] && !known[techs[t]]) {
        return res.status(400).json({ error: at + `技「${techs[t]}」は技リストにありません` });
      }
    }
    checked.push({
      name: name,
      court: court,
      isFemale: row.isFemale === true,
      isNewFace: row.isNewFace === true,
      techs: techs
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
    return {
      id: generateId(),
      name: row.name,
      order: buildOrder(row.court, row.isFemale, 1, n),
      tech1: row.techs[0],
      tech2: row.techs[1],
      tech3: row.techs[2],
      score: 0,
      isNewFace: row.isNewFace,
      isFemale: row.isFemale,
      result: ''
    };
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
```

これ以降（`if (!isValidCourt(court)) {` から `});` まで）は**そのまま**。

- [ ] **Step 4: `api.js` の説明と失敗時の戻り値を直す**

`api.js` の `createPlayersBulk`。置き換え前:

```js
  async function createPlayersBulk(eventId, data) {
    // POST /api/events/:eventId/players/bulk
    // Body: { court, isFemale, isNewFace, names: ['名前', ...] }
    // 戻り値: { created, players } | { error } (400/404: 失敗理由を画面に出すため) | null（通信失敗）
    // 1回の書き込みで コート×性別×一巡目 の続き番号を順に付ける。技は空で作る。
    try {
      var res = await fetch('/api/events/' + eventId + '/players/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        var errJson = await res.json();
        return { error: errJson.error };
      }
```

置き換え後:

```js
  async function createPlayersBulk(eventId, data) {
    // POST /api/events/:eventId/players/bulk
    // Body: { court, isFemale, isNewFace, names: ['名前', ...] }（同じコート・性別でまとめて）
    //     | { rows: [{ name, court, isFemale, isNewFace, tech1, tech2, tech3 }, ...] }（行ごとに違う）
    // 戻り値: { created, players } | { error } (400/404/409: 失敗理由を画面に出すため) | null（通信失敗）
    // 1回の書き込みで コート×性別×一巡目 の続き番号を順に付ける。
    // rows 形式は全行を検証してから書くので、失敗したときは 1 人も登録されていない。
    // rows の 400 は「3 行目: …」のように行番号つきの文言で返る。
    try {
      var res = await fetch('/api/events/' + eventId + '/players/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        var errJson = null;
        try { errJson = await res.json(); } catch (e) { /* JSON でない応答 */ }
        return { error: (errJson && errJson.error) || ('サーバーがエラーを返しました（' + res.status + '）') };
      }
```

これ以降はそのまま。

- [ ] **Step 5: テストが通るのを確かめる**

サーバーを再起動する（`server/index.js` を変えたため）。`http://localhost:3461/test.html` を**新しいタブ**で開く。
Expected: `Result: N passed, 0 failed`。`bulk rows:` の ✓ が 14 本。既存の `bulk:`（names 形式）の ✓ も全部残っている。

- [ ] **Step 6: コミット**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 一括登録に行ごとの形式（rows）を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 貼り付けたテキストの解析を `courts.js` に足す

「📋 貼り付けて追加」の解析は DOM に触らない純粋関数にして `test.html` で固定する（設計書「テスト」の指示）。置き場は `courts.js`（選手データを読む純粋関数の置き場。`desk.html` と `test.html` の両方が既に読んでいる。新しいファイルを作ると `server/static-policy.js` の許可リストを触ることになり、計画3の担当者と衝突する）。

**Files:**
- Modify: `courts.js`（`statusConfirmMessage` の直後、`return {` の直前に追記。公開の一覧にも足す）
- Modify: `test.html`（`courts.js` の節の末尾。`statusConfirmMessage: archived から final への復元は確定の文言にならない` の assert の直後、`var h2es = document.createElement('h2');` の直前）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の

```js
    assert('statusConfirmMessage: archived から final への復元は確定の文言にならない',
      Courts.statusConfirmMessage('archived', 'final', tcP), '最終結果に戻します。よろしいですか？');
```

の**直後**（空行をはさんで `var h2es = document.createElement('h2');` の前）に足す。

```js
    // ---- 貼り付けによる一括登録の解析（PC 運営の「📋 貼り付けて追加」） ----
    // 列は 名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 の固定順。
    var pTech = [{ name: '四方' }, { name: '水月' }];
    function pRows(text) { return Courts.parsePasteRows(text, pTech).rows; }
    // 1 行を「行番号|名前|コート|女子か|新人か|技/技/技|送れるか|理由」の文字列にして比べる
    function pBrief(text) {
      return pRows(text).map(function(r) {
        return [r.line, r.name, r.court, r.isFemale, r.isNewFace, r.techs.join('/'), r.ok, r.error].join('|');
      });
    }

    assert('parsePasteRows: タブ区切り（Excel）を読む',
      pBrief('山田 太郎\tA\t男子\t新人\t四方\t水月\t'),
      ['1|山田 太郎|A|false|true|四方/水月/|true|']);
    assert('parsePasteRows: カンマ区切りを読む',
      pBrief('山田 太郎,A,女子,,四方,,'),
      ['1|山田 太郎|A|true|false|四方//|true|']);
    assert('parsePasteRows: 1行目が「名前」で始まれば見出しとして飛ばす',
      pBrief('名前,コート,性別,新人,技1,技2,技3\n佐藤 花子,B,女,○,,,'),
      ['2|佐藤 花子|B|true|true|//|true|']);
    assert('parsePasteRows: headerSkipped で見出しを飛ばしたか分かる',
      [Courts.parsePasteRows('名前,コート\n山田,A', pTech).headerSkipped,
       Courts.parsePasteRows('山田,A', pTech).headerSkipped], [true, false]);
    assert('parsePasteRows: 空行は飛ばし、行番号は元の文字列のまま',
      pBrief('\n山田,A\n\n佐藤,B'),
      ['2|山田|A|false|false|//|true|', '4|佐藤|B|false|false|//|true|']);
    assert('parsePasteRows: 性別は 女子/女/F を女子、それ以外は男子',
      pRows('あ,A,女子\nい,A,女\nう,A,f\nえ,A,F\nお,A,男子\nか,A,').map(function(r) { return r.isFemale; }),
      [true, true, true, true, false, false]);
    assert('parsePasteRows: 新人は 新人/○/1/true',
      pRows('あ,A,,新人\nい,A,,○\nう,A,,1\nえ,A,,true\nお,A,,\nか,A,,男子').map(function(r) { return r.isNewFace; }),
      [true, true, true, true, false, false]);
    assert('parsePasteRows: 技リストに無い技名は badTechs に入れて送らない',
      pRows('山田,A,,,四方,幻の太刀,').map(function(r) { return [r.badTechs, r.ok, r.error]; }),
      [[['幻の太刀'], false, '技「幻の太刀」は技リストにありません']]);
    assert('parsePasteRows: 空の技は許す',
      pRows('山田,A,,,,,').map(function(r) { return [r.badTechs, r.ok]; }), [[[], true]]);
    assert('parsePasteRows: 技リストが無ければ技名は全部「リストに無い」',
      Courts.parsePasteRows('山田,A,,,四方', null).rows.map(function(r) { return [r.badTechs, r.ok]; }),
      [[['四方'], false]]);
    assert('parsePasteRows: 名前が空なら送らない',
      pRows(',A,,,,,').map(function(r) { return [r.ok, r.error]; }), [[false, '名前がありません']]);
    assert('parsePasteRows: コートが空なら送らない',
      pRows('山田').map(function(r) { return [r.ok, r.error]; }), [[false, 'コートがありません']]);
    assert('parsePasteRows: コート名に - は使えない',
      pRows('山田,A-1').map(function(r) { return [r.ok, r.error]; }), [[false, 'コート名「A-1」は使えません']]);
    assert('parsePasteRows: 未分類はコート名に使えない',
      pRows('山田,未分類').map(function(r) { return r.ok; }), [false]);
    assert('parsePasteRows: 列が足りなくても落ちない',
      pBrief('山田,A'), ['1|山田|A|false|false|//|true|']);
    assert('parsePasteRows: 前後の空白は落とす',
      pBrief(' 山田 太郎 , A , 女子 , 新人 , 四方 , , '),
      ['1|山田 太郎|A|true|true|四方//|true|']);
    assert('parsePasteRows: null でも落ちない',
      Courts.parsePasteRows(null, pTech), { headerSkipped: false, rows: [] });
    assert('parsePasteRows: 空文字は 0 行',
      Courts.parsePasteRows('   \n  ', pTech).rows.length, 0);
```

- [ ] **Step 2: テストが落ちるのを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Courts.parsePasteRows is not a function` で `courts.js` の節から先が止まる（赤い行と `Result` の failed が増える。落ちた地点で以降の assert が動かないのは想定どおり）。

- [ ] **Step 3: `courts.js` に `parsePasteRows` を足す**

`courts.js` の `statusConfirmMessage` の閉じ括弧 `}` の直後、`return {` の直前に足す。

```js
  // ---- 貼り付けによる一括登録の解析（PC 運営 desk-players.js の「📋 貼り付けて追加」） ----

  // 性別・新人の表記ゆれ。設計書「画面設計 > PC 運営 > 選手」の貼り付けの節のとおり。
  var FEMALE_WORDS = ['女子', '女', 'f'];
  var NEWFACE_WORDS = ['新人', '○', '〇', '1', 'true'];

  // 貼り付けたテキストを 1 行 1 人に解析する。DOM には触らない（test.html で固定する）。
  // 列は 名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 の固定順。
  // タブが1つでもある行はタブ区切り（Excel からの貼り付け）、無ければカンマ区切りとして切る。
  // techniques はその大会の有効な技リスト（[{ name, strikes }]）。
  // 戻り値: { headerSkipped, rows: [ {
  //   line,      貼り付けた文字列の行番号（1 始まり。空行と見出しも数える）
  //   name, court, isFemale, isNewFace,
  //   techs,     ['技1', '技2', '技3']（空の枠は ''）
  //   badTechs,  技リストに無い技名（画面で赤く示す）
  //   ok,        サーバーに送ってよい行か
  //   error      送れない理由（ok が true なら ''）
  // } ] }
  function parsePasteRows(text, techniques) {
    var known = {};
    (techniques || []).forEach(function(t) {
      var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
      if (n) known[n] = true;
    });
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var rows = [];
    var headerSkipped = false;
    var seenFirst = false;
    lines.forEach(function(line, i) {
      if (!line.trim()) return;   // 空行は飛ばす（行番号は元のまま）
      var cols = (line.indexOf('\t') >= 0 ? line.split('\t') : line.split(',')).map(function(s) {
        return String(s).trim();
      });
      if (!seenFirst) {
        seenFirst = true;
        // Excel の1行目をそのまま貼れるように、「名前…」で始まる最初の行は見出しとみなす
        if (cols[0].indexOf('名前') === 0) { headerSkipped = true; return; }
      }
      rows.push(parsePasteRow(cols, i + 1, known));
    });
    return { headerSkipped: headerSkipped, rows: rows };
  }

  // 1 行分。不正でも例外は投げず、ok: false と理由を付けて返す（画面が行ごとに赤く示す）。
  function parsePasteRow(cols, line, known) {
    var techs = [cols[4] || '', cols[5] || '', cols[6] || ''];
    var badTechs = techs.filter(function(t) { return t && !known[t]; });
    var row = {
      line: line,
      name: cols[0] || '',
      court: cols[1] || '',
      isFemale: FEMALE_WORDS.indexOf(String(cols[2] || '').toLowerCase()) !== -1,
      isNewFace: NEWFACE_WORDS.indexOf(String(cols[3] || '').toLowerCase()) !== -1,
      techs: techs,
      badTechs: badTechs,
      ok: true,
      error: ''
    };
    if (!row.name) return badRow(row, '名前がありません');
    if (!row.court) return badRow(row, 'コートがありません');
    // order は「コート-性別-巡目-番号」。サーバーの isValidCourt と同じ条件で先に弾く。
    if (row.court.indexOf('-') >= 0 || row.court === UNASSIGNED || row.court.length > 32) {
      return badRow(row, 'コート名「' + row.court + '」は使えません');
    }
    if (badTechs.length > 0) {
      return badRow(row, '技「' + badTechs.join('」「') + '」は技リストにありません');
    }
    return row;
  }

  function badRow(row, message) {
    row.ok = false;
    row.error = message;
    return row;
  }
```

`courts.js` の `return { … }` の `statusConfirmMessage: statusConfirmMessage` の行の後ろに足す。

```js
    statusConfirmMessage: statusConfirmMessage,
    parsePasteRows: parsePasteRows
```

（`statusConfirmMessage` の行末のカンマを忘れないこと。`parsePasteRow` と `badRow` は内部用なので公開しない。）

- [ ] **Step 4: テストが通るのを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`。`parsePasteRows:` の ✓ が 18 本。

- [ ] **Step 5: コミット**

```bash
git add courts.js test.html
git commit -m "feat: 貼り付けた選手行を解析する純粋関数を courts.js に足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 採点済みの選手の変更警告を `courts.js` に寄せる

いまは `admin-players.js` の中に `scoreMayChange(player, data)` があり、警告文もその場で組んでいる。PC の表でも同じ警告を出すので `courts.js` に移す。ただし **PC の表は 1 項目ずつ保存する**ので、`data` に含まれていないキーを「変更なし」として扱えるようにする（今の実装は `data.isFemale` が無いと常に「変わった」と判定してしまう）。

**Files:**
- Modify: `courts.js`（Task 2 で足した節の直前、`nextRoundResultMessage` の直後。公開の一覧にも足す）
- Modify: `admin-players.js`（`scoreMayChange` を消して `Courts.*` を呼ぶ）
- Modify: `test.html`（`courts.js` の節。Task 2 で足した `parsePasteRows` の一連の**直後**）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `assert('parsePasteRows: 空文字は 0 行', …);` の直後に足す。

```js
    // ---- 採点済みの選手の性別・技を変えたときの警告（PC 運営とスマホ運営で共用） ----
    // 技の差し替えは result 文字列の長さを変えないので採点画面が気付けない。必ず断る。
    var smScored = { name: 'あ', order: 'A-男子-1-1', score: 66, isFemale: false, tech1: '真', tech2: '連', tech3: '左' };
    var smFresh = { name: 'い', order: 'A-男子-1-2', score: 0, isFemale: false, tech1: '真', tech2: '連', tech3: '左' };

    assert('scoreMayChange: 未採点なら false', Courts.scoreMayChange(smFresh, { isFemale: true }), false);
    assert('scoreMayChange: 採点済みで性別を変えると true', Courts.scoreMayChange(smScored, { isFemale: true }), true);
    assert('scoreMayChange: 採点済みでも性別が同じなら false', Courts.scoreMayChange(smScored, { isFemale: false }), false);
    assert('scoreMayChange: 採点済みで技を差し替えると true', Courts.scoreMayChange(smScored, { tech2: '水月' }), true);
    assert('scoreMayChange: 採点済みで技を空にするのも true', Courts.scoreMayChange(smScored, { tech3: '' }), true);
    assert('scoreMayChange: 採点済みでも同じ技なら false', Courts.scoreMayChange(smScored, { tech1: '真' }), false);
    assert('scoreMayChange: 送っていない項目は変更とみなさない（1項目ずつ保存する PC の表）',
      Courts.scoreMayChange(smScored, { name: 'う' }), false);
    assert('scoreMayChange: 全項目を送っても変更が無ければ false（スマホの編集シート）',
      Courts.scoreMayChange(smScored, { name: 'あ', court: 'A', isFemale: false, isNewFace: false,
        tech1: '真', tech2: '連', tech3: '左' }), false);
    assert('scoreMayChange: 技が空の採点済み選手に技を入れると true',
      Courts.scoreMayChange({ score: 5, tech1: '' }, { tech1: '真' }), true);
    assert('scoreMayChange: 補正点だけの採点済みでも拾う',
      Courts.scoreMayChange({ adjust: [0, 3, 0], tech1: '真' }, { tech1: '連' }), true);
    assert('scoreMayChange: player が無くても落ちない', Courts.scoreMayChange(null, { tech1: '真' }), false);
    assert('scoreMayChange: data が無くても落ちない', Courts.scoreMayChange(smScored, null), false);

    assert('scoreChangeConfirmMessage: 得点を含む文言',
      Courts.scoreChangeConfirmMessage(smScored),
      'この選手は採点済みです（66点）。\n' +
      '得点が変わる可能性があります。採点画面でこの選手を開き直してください。\n\n' +
      'このまま保存しますか？');
    assert('scoreChangeConfirmMessage: 得点が無ければ 0点',
      Courts.scoreChangeConfirmMessage({}).indexOf('（0点）') !== -1, true);
```

- [ ] **Step 2: テストが落ちるのを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Courts.scoreMayChange is not a function` で止まる。

- [ ] **Step 3: `courts.js` に移す**

`courts.js` の `nextRoundResultMessage` の閉じ括弧 `}` の直後（`// ---- 大会の状態の段階表示 …` の節の直前）に足す。

```js
  // ---- 採点済みの選手の訂正（スマホ運営の編集シートと PC 運営の表で共用） ----

  // 採点済みの選手について、性別か技を変えると得点が変わりうるかどうか。
  // 性別は配点が男女で違うので分かりやすいが、技の差し替えは result 文字列の
  // 長さを変えないため、採点画面（Scoring.canDecode）はこの変更を検知できず、
  // 黙って古い ○× を新しい技の配点で再解釈してしまう。だから必ず断る。
  // data は「これから送る項目」だけでよい（PC の表はセル1つずつ保存する）。
  // 含まれていないキーは「変えない」とみなす。
  function scoreMayChange(player, data) {
    if (!isScored(player)) return false;
    var d = data || {};
    if (typeof d.isFemale === 'boolean' && d.isFemale !== !!player.isFemale) return true;
    var keys = ['tech1', 'tech2', 'tech3'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (typeof d[k] === 'string' && d[k] !== (player[k] || '')) return true;
    }
    return false;
  }

  // scoreMayChange が true のときに出す確認文言。
  function scoreChangeConfirmMessage(player) {
    return 'この選手は採点済みです（' + ((player && player.score) || 0) + '点）。\n' +
      '得点が変わる可能性があります。採点画面でこの選手を開き直してください。\n\n' +
      'このまま保存しますか？';
  }
```

`courts.js` の `return { … }` の `nextRoundResultMessage: nextRoundResultMessage,` の直後に足す。

```js
    scoreMayChange: scoreMayChange,
    scoreChangeConfirmMessage: scoreChangeConfirmMessage,
```

- [ ] **Step 4: `admin-players.js` を `Courts.*` に切り替える**

置き換え前（`openEditSheet` の直前にある関数）:

```js
  // 採点済みの選手について、性別か技を変えると得点が変わりうるかどうか。
  // 性別は配点が男女で違うので分かりやすいが、技の差し替えは result 文字列の
  // 長さを変えないため、採点画面（Scoring.canDecode）はこの変更を検知できず、
  // 黙って古い ○× を新しい技の配点で再解釈してしまう。
  function scoreMayChange(player, data) {
    if (!Courts.isScored(player)) return false;
    if (data.isFemale !== !!player.isFemale) return true;
    if (data.tech1 !== (player.tech1 || '')) return true;
    if (data.tech2 !== (player.tech2 || '')) return true;
    if (data.tech3 !== (player.tech3 || '')) return true;
    return false;
  }

```

置き換え後（関数ごと消す。空行も残さない）:

```js
  // 採点済みの選手の性別・技を変えたときの警告は courts.js（Courts.scoreMayChange /
  // Courts.scoreChangeConfirmMessage）に置いてある。PC 運営の選手表と同じ判定・同じ文言を使う。

```

そして `btnSave` のハンドラの中。置き換え前:

```js
      // 採点済みの選手の性別や技を変えても、サーバーは得点を再計算しない。
      // 男女で配点が違う技があるほか、技の差し替えは採点画面が検知できないため、
      // 採点画面で開き直してもらう必要がある（scoreMayChange 参照）。
      if (scoreMayChange(player, data)) {
        var ok = confirm(
          'この選手は採点済みです（' + (player.score || 0) + '点）。\n' +
          '得点が変わる可能性があります。採点画面でこの選手を開き直してください。\n\n' +
          'このまま保存しますか？'
        );
        if (!ok) return;
      }
```

置き換え後:

```js
      // 採点済みの選手の性別や技を変えても、サーバーは得点を再計算しない。
      // 男女で配点が違う技があるほか、技の差し替えは採点画面が検知できないため、
      // 採点画面で開き直してもらう必要がある（Courts.scoreMayChange 参照）。
      if (Courts.scoreMayChange(player, data) && !confirm(Courts.scoreChangeConfirmMessage(player))) {
        return;
      }
```

- [ ] **Step 5: テストが通るのを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`。`scoreMayChange:` の ✓ が 12 本、`scoreChangeConfirmMessage:` が 2 本。

- [ ] **Step 6: スマホ運営で回帰を確かめる**

`http://localhost:3461/admin.html#players/<テスト用の大会ID>` を幅 375px で開く（採点済みの選手がいる自分のテスト大会。無ければ作って採点画面で 1 人だけ得点を入れる）。
Expected:
- 採点済みの選手の行をタップ → 技を 1 つ差し替えて「保存」→「この選手は採点済みです（○点）。…このまま保存しますか？」が出る。キャンセルすると保存されない
- 同じ選手で名前だけ直して「保存」→ 警告が出ずに保存できる
- 未採点の選手は技を変えても警告が出ない

- [ ] **Step 7: コミット**

```bash
git add courts.js admin-players.js test.html
git commit -m "refactor: 採点済みの選手の変更警告を courts.js に寄せる" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: CSV のファイル選択を `storage.js` に寄せる

`admin-players.js` が自前で `<input type="file" accept=".csv">` を作って捨てている。`storage.js` の `pickJsonFile` がほぼ同じことをしていて、そちらの方が後から直した分だけ堅い（`cancel` イベントとフォールバックの `focus`、`onDone` の一度きりの呼び出し）。`accept` だけを引数にした `pickTextFile` に切り出し、`pickJsonFile` と新しい `pickCsvFile` をその薄いラッパーにする。PC の選手表の CSV 取り込み（Task 10）はこれを使う。

**Files:**
- Modify: `storage.js`（`pickJsonFile` の節。`return {}` に 2 つ足す）
- Modify: `admin-players.js`（`pickCsv` を消して `Storage.pickCsvFile` を呼ぶ）

計画3の担当者も `storage.js` を触る（`currentMode` の切り出し。`adminHref` の節）。**`pickJsonFile` の節だけを編集すること。**

- [ ] **Step 1: `storage.js` に `pickTextFile` を切り出す**

置き換え前（コメントと関数の宣言行だけ。中身は触らない）:

```js
  // ファイル選択ダイアログを出し、選ばれた JSON ファイルの中身（文字列）を onText に渡す。
  // onText は Promise を返してもよい（取り込みの完了まで onDone を待たせる）。
  // onDone は選択〜取り込みが終わった時点（成功・失敗・キャンセルのどれでも）で一度だけ
  // 呼ぶ。呼び出し元はこれでボタンの disabled を戻す。
  // ページに <input type="file"> を置かずに済ませるため、その場で作って捨てる。
  function pickJsonFile(onText, onDone) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
```

置き換え後:

```js
  // ファイル選択ダイアログを出し、選ばれたファイルの中身（UTF-8 の文字列）を onText に渡す。
  // accept は <input type="file"> の accept 属性（'.json,application/json' など）。
  // onText は Promise を返してもよい（取り込みの完了まで onDone を待たせる）。
  // onDone は選択〜取り込みが終わった時点（成功・失敗・キャンセルのどれでも）で一度だけ
  // 呼ぶ。呼び出し元はこれでボタンの disabled を戻す。省略してもよい。
  // ページに <input type="file"> を置かずに済ませるため、その場で作って捨てる。
  function pickTextFile(accept, onText, onDone) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
```

そして同じ関数の末尾。置き換え前:

```js
      cleanup();
    });
    input.click();
  }

  // 取り込むファイルがこのアプリのエクスポートかどうか。
```

置き換え後:

```js
      cleanup();
    });
    input.click();
  }

  // 大会のエクスポートファイル（JSON）を選ぶ。desk-events.js / admin-events.js が使う。
  function pickJsonFile(onText, onDone) {
    pickTextFile('.json,application/json', onText, onDone);
  }

  // 選手の CSV を選ぶ。desk-players.js / admin-players.js の「CSV 取り込み」が使う。
  function pickCsvFile(onText, onDone) {
    pickTextFile('.csv,text/csv', onText, onDone);
  }

  // 取り込むファイルがこのアプリのエクスポートかどうか。
```

`storage.js` の `return { … }` の `pickJsonFile: pickJsonFile,` の直後に足す。

```js
    pickTextFile: pickTextFile,
    pickCsvFile: pickCsvFile,
```

- [ ] **Step 2: `admin-players.js` の呼び出し側を直す**

`openMenu` の中。置き換え前:

```js
    btnCsv.addEventListener('click', function() {
      sheet.close();
      pickCsv(ctx);
    });
```

置き換え後:

```js
    btnCsv.addEventListener('click', function() {
      sheet.close();
      // ファイル選択は storage.js（PC 運営の選手表と共通）。admin.html には file input を置かない。
      Storage.pickCsvFile(function(text) { return importCsvText(ctx, text); });
    });
```

- [ ] **Step 3: `admin-players.js` の `pickCsv` を消す**

`openMenu` の閉じ括弧の次にある関数を**丸ごと削除**する。消す範囲は

```js
  // admin.html には file input を置かない（DOM は計画3との契約）。その場で作って捨てる。
  function pickCsv(ctx) {
```

の行から、その関数の終わり（`    input.click();` とその次の行の `  }`）まで。削除後は `openMenu` の閉じ括弧の次が `  async function importCsvText(ctx, text) {` になる。

- [ ] **Step 4: 既存のテストが通ったままか確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`（この Task はテストを増やさない。ファイル選択は DOM のダイアログなので画面で確かめる）。

- [ ] **Step 5: 画面で確かめる**

`http://localhost:3461/admin.html#players/<自分のテスト大会ID>` を幅 375px で開く。
Expected:
- 「⋯」→「📄 CSVインポート」でファイル選択ダイアログが開き、`.csv` が選べる
- `data_0.csv` を選ぶと今までどおり確認（クリア / 追記）が出て、読み込める
- ファイル選択をキャンセルしても画面が固まらない（何も起きない）
- `admin.html#events` の「📂 取り込む」（JSON）も今までどおり動く（`pickJsonFile` の回帰）
- `desk.html#events` の「📂 取り込む」も今までどおり動く

- [ ] **Step 6: コミット**

```bash
git add storage.js admin-players.js
git commit -m "refactor: CSV のファイル選択を storage.js に寄せる" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `desk.css` に選手表のスタイルを足す

**Task 1〜4 と並行してよい**（触るファイルが重ならない）。計画2では「`desk.css` は Task 4 で書き切る」としたが、選手表のためにこのタスクで追記する。**`desk.css` を触るのはこの計画ではこのタスクだけ**。

列は 11 個（巡・No.・名前・コート・性別・新人・技1〜3・得点・⋯）。1280px で横スクロールを作らないため、幅の合計を約 990px に収める（左の区画ナビ 180px ＋ 本文の余白 36px ＝ 約 1206px）。窓が狭いときのために名前列は左に固定し、表の枠だけ横スクロールさせる（採点表・スマホの選手表と同じ方式）。

**Files:**
- Modify: `desk.css`（`/* ===== 行の ⋯ メニュー ===== */` の**直前**に 1 節を足す。ファイル冒頭のコメントも直す）

- [ ] **Step 1: 冒頭のコメントを直す**

置き換え前:

```css
   このファイルは計画2の Task 4 で書き切る。以降のタスクでは編集しない
   （区画ごとに CSS を足すと並行作業で衝突するため。足りない見た目が出たら
    計画の Task 4 の節に追記してからまとめて直す）。 */
```

置き換え後:

```css
   区画ごとに少しずつ足すと並行作業で衝突するので、CSS を足すのは計画ごとに
   1 つのタスクにまとめる（計画2は Task 4、計画4は Task 5）。 */
```

- [ ] **Step 2: 選手表のスタイルを足す**

`/* ===== 行の ⋯ メニュー ===== */` の直前に足す。

```css
/* ===== 選手の表（desk-players.js） ===== */
/* 帯は PC 幅なので 1 段（スマホの選手タブは 3 段）。右端に名前の検索。 */
.desk-players-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.desk-players-chips { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.desk-chip-group { display: inline-flex; gap: 4px; }
.desk-chip {
  min-height: 28px; padding: 0 10px; font-size: 13px;
  background: var(--bg-secondary); color: var(--text-muted); border: 1px solid var(--border);
}
.desk-chip:hover { border-color: var(--accent); color: var(--text); }
.desk-chip.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: bold; }
.desk-players-search { width: 200px; margin-left: auto; }

/* 1280px では横スクロールしない幅に収める。窓が狭いときだけ表の枠が横に流れ、
   名前の列は左に固定して誰の行か分かるようにする（採点表の固定列と同じ手法）。 */
.desk-players-wrap { overflow-x: auto; }
.desk-players-table { table-layout: fixed; }
.desk-players-table th, .desk-players-table td { padding: 2px 6px; vertical-align: middle; }
.desk-players-table tbody tr { height: 34px; }
.desk-players-table th.col-name, .desk-players-table td.col-name { position: sticky; left: 0; z-index: 1; }
.desk-players-table th.col-name { background: var(--bg-header); }
.desk-players-table td.col-name { background: var(--card-bg); }
.desk-players-table tbody tr:hover td.col-name { background: var(--row-selected); }
.desk-players-table .col-round { width: 40px; }
.desk-players-table .col-no { width: 52px; }
.desk-players-table .col-name { width: 190px; }
.desk-players-table .col-court { width: 96px; }
.desk-players-table .col-sex { width: 84px; }
.desk-players-table .col-new { width: 52px; text-align: center; }
.desk-players-table .col-tech { width: 132px; }
.desk-players-table .col-score { width: 64px; color: var(--score-color); font-weight: bold; }

/* セルの入力。ふだんは枠を見せず、触ったときだけ枠を出す（表が線だらけにならない）。 */
.desk-cell-input, .desk-cell-select {
  width: 100%; min-height: 28px; padding: 2px 4px;
  background: transparent; color: inherit; border: 1px solid transparent; border-radius: 3px;
}
.desk-cell-input:hover:not(:disabled), .desk-cell-select:hover:not(:disabled) { border-color: var(--border); }
.desk-cell-input:focus, .desk-cell-select:focus { border-color: var(--accent); background: var(--bg); outline: none; }
.desk-cell-input:disabled, .desk-cell-select:disabled { opacity: .55; cursor: not-allowed; }
/* 保存の通信中 */
.desk-cell-input.saving, .desk-cell-select.saving { border-color: var(--accent); opacity: .5; }
.desk-cell-check { display: block; margin: 0 auto; width: 16px; height: 16px; }

/* 「＋ 行を追加」の下書き行（まだサーバーに無い行） */
.desk-draft-row td { background: var(--bg-header); }
.desk-draft-row td.col-name { background: var(--bg-header); }

/* 並べ替えできる見出し */
.sort-btn { background: transparent; color: inherit; font-size: 13px; font-weight: bold; padding: 2px 4px; }
.sort-btn:hover { color: var(--accent); }
.sort-btn.on { color: var(--accent); }

/* 貼り付けて追加のダイアログ */
.desk-paste { width: 100%; min-height: 140px; font-family: inherit; white-space: pre; }
.desk-paste-count { margin: 8px 0 6px; font-size: 13px; }
.desk-paste-preview {
  max-height: 240px; overflow: auto; padding: 6px;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px;
}
.desk-paste-line { font-size: 13px; white-space: nowrap; }
/* 取り込めない行。--btn-fail はダークで読みにくいので文字色は --cell-fail-text を使う */
.desk-paste-line.bad, .desk-paste-bad { color: var(--cell-fail-text); }
.desk-paste-bad { font-weight: bold; }
```

- [ ] **Step 3: 画面で確かめる**

`http://localhost:3461/desk.html#players/<自分のテスト大会ID>` を幅 1280px で開く。
Expected:
- **まだ見た目は変わらない**（`desk-players.js` が新しい class を使い始めるのは Task 6 から）。読み取り専用の表が今までどおり出る
- ライト／ダークを切り替えても崩れない
- ブラウザのコンソールに CSS の解析エラーが出ていない

- [ ] **Step 4: コミット**

```bash
git add desk.css
git commit -m "feat: PC 運営の選手表のスタイルを desk.css に足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 選手表に絞り込み・並べ替えの帯を足す（`desk-players.js`）

**前提: Task 5 が済んでいること。**

読み取り専用の表のままで、帯（コート / 性別 / 巡目 / 新人 / 技未入力 / 名前の検索）と見出しの並べ替えを足す。判定は `Courts.applyFilter` / `Courts.sortBy`（スマホと同じ純粋関数）。`desk.html` は `admin.js` を読まないので、チップの描画だけこのファイルに小さく書く。ロック中（`EventStatus.isLocked`）の警告もここで出す。

**Files:**
- Modify: `desk-players.js`（**ファイルを丸ごと置き換える**）

- [ ] **Step 1: `desk-players.js` を書き換える**

ファイル全体を次の内容にする。

```js
// 選手の区画（#players/<id>）。編集できる表。
// 絞り込み・並べ替えはスマホ運営の選手タブと同じ純粋関数（Courts.applyFilter / Courts.sortBy）。
// 帯は PC 幅なので 1 段に並べる（スマホの admin-players.js は 3 段）。
// セルの編集・行の追加・貼り付け・削除はこのあとのタスクで足す。
(function() {
  // 絞り込みと並べ替えの状態。形は Courts.defaultFilter() / Courts.defaultSort()。
  // 大会が変われば既定に戻す。保存後の描き直し（Desk.reloadEvent）では保つ。
  var filter = null;
  var sort = null;
  var stateOwner = null;

  // いま描いている表。行の追加・削除や並べ替えで表だけを描き直すために覚えておく。
  // render のたびに入れ替える（古い ctx の DOM を触らない）。
  var view = null;   // { chips, wrap, ctx, locked }

  // 表の列。key があるものは見出しを押すと並べ替えられる
  // （巡・コート・性別は絞り込みの軸なので並べ替えの対象にしない）。
  var COLUMNS = [
    { label: '巡', cls: 'col-round' },
    { key: 'order', label: 'No.', cls: 'col-no' },
    { key: 'name', label: '名前', cls: 'col-name' },
    { label: 'コート', cls: 'col-court' },
    { label: '性別', cls: 'col-sex' },
    { label: '新人', cls: 'col-new' },
    { label: '技1', cls: 'col-tech' },
    { label: '技2', cls: 'col-tech' },
    { label: '技3', cls: 'col-tech' },
    { key: 'score', label: '得点', cls: 'col-score' },
    { label: '', cls: 'act' }
  ];

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function emptyMessage(text) {
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = text;
    return p;
  }

  function render(container, ctx) {
    var locked = EventStatus.isLocked(EventStatus.of(ctx.event));
    if (stateOwner !== ctx.eventId) {
      filter = Courts.defaultFilter();
      sort = Courts.defaultSort();
      stateOwner = ctx.eventId;
    }
    // 絞り込み中のコート・巡目の選手が全員いなくなったら「全コート」「全巡」に戻す
    if (filter.court && Courts.listFrom(ctx.players).indexOf(filter.court) === -1) filter.court = '';
    if (filter.round && Courts.roundsOf(ctx.players).indexOf(filter.round) === -1) filter.round = 0;

    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '選手';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    var count = document.createElement('span');
    count.className = 'desk-head-meta';
    count.textContent = (ctx.players || []).length + ' 名';
    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(count);
    container.appendChild(head);

    if (locked) {
      var warn = document.createElement('p');
      warn.className = 'desk-warn';
      warn.textContent = 'この大会は最終結果を確定済みです。上部の「戻す」を押すと編集できます。';
      container.appendChild(warn);
    }

    // 帯。チップは押すたびに作り直すが、検索の入力欄は作り直さない
    // （入力中の文字と IME の変換を保つ。スマホの選手タブと同じ理由）。
    var bar = document.createElement('div');
    bar.className = 'desk-players-bar';
    var chips = document.createElement('div');
    chips.className = 'desk-players-chips';
    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'desk-players-search';
    search.placeholder = '名前で検索';
    search.setAttribute('aria-label', '名前で検索');
    search.value = filter.query;
    bar.appendChild(chips);
    bar.appendChild(search);
    container.appendChild(bar);

    var wrap = document.createElement('div');
    wrap.className = 'desk-players-wrap';
    container.appendChild(wrap);

    view = { chips: chips, wrap: wrap, ctx: ctx, locked: locked };

    function applyQuery() {
      // Chromium は変換確定で compositionend と input の両方が来るので、同じ文字列なら描き直さない
      if (search.value === filter.query) return;
      filter.query = search.value;
      redrawTable();
    }
    search.addEventListener('input', function(ev) {
      // IME 変換中は確定前の文字で絞り込まない（変換終了時に確定値で最後の input が来る）
      if (ev.isComposing) return;
      applyQuery();
    });
    // WebKit は input(isComposing:true) → compositionend の順で、その後 isComposing:false の
    // input が来ないため、compositionend でも絞り込む（techpicker.js の検索欄と同じ）。
    search.addEventListener('compositionend', applyQuery);

    refresh();
  }

  // 帯と表を描き直す（チップを押したとき）
  function refresh() {
    if (!view) return;
    renderChips(view.chips, view.ctx);
    renderTable(view.wrap, view.ctx, view.locked);
  }

  // 表だけ描き直す（並べ替え・名前の検索・行の追加や削除）
  function redrawTable() {
    if (!view) return;
    renderTable(view.wrap, view.ctx, view.locked);
  }

  // チップの小さな並び（admin.js の Admin.renderChips の PC 版。desk.html は admin.js を読まない）。
  function chipGroup(parent, items, current, onPick) {
    var g = document.createElement('span');
    g.className = 'desk-chip-group';
    items.forEach(function(item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'desk-chip' + (String(item.value) === String(current) ? ' on' : '');
      b.textContent = item.label;
      b.addEventListener('click', function() { onPick(item.value); refresh(); });
      g.appendChild(b);
    });
    parent.appendChild(g);
  }

  function renderChips(el, ctx) {
    el.innerHTML = '';
    chipGroup(el, [{ value: '', label: '全コート' }].concat(Courts.listFrom(ctx.players).map(function(c) {
      return { value: c, label: c === Courts.UNASSIGNED ? c : c + ' コート' };
    })), filter.court, function(v) { filter.court = v; });

    chipGroup(el, [{ value: '', label: '男女' }, { value: '男子', label: '男子' }, { value: '女子', label: '女子' }],
      filter.sex, function(v) { filter.sex = v; });

    chipGroup(el, [{ value: 0, label: '全巡' }].concat(Courts.roundsOf(ctx.players).map(function(r) {
      return { value: r, label: r + '巡' };
    })), filter.round, function(v) { filter.round = v; });

    chipGroup(el, [{ value: true, label: '新人' }], filter.newFace, function() { filter.newFace = !filter.newFace; });
    chipGroup(el, [{ value: true, label: '技未入力' }], filter.noTech, function() { filter.noTech = !filter.noTech; });
  }

  function renderTable(wrap, ctx, locked) {
    wrap.innerHTML = '';
    var players = ctx.players || [];
    if (players.length === 0) {
      wrap.appendChild(emptyMessage('まだ選手がいません。'));
      return;
    }
    var rows = Courts.sortBy(Courts.applyFilter(players, filter), sort);
    if (rows.length === 0) {
      wrap.appendChild(emptyMessage('条件に合う選手がいません。'));
      return;
    }

    var table = document.createElement('table');
    table.className = 'desk-table desk-players-table';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    COLUMNS.forEach(function(col) {
      var th = document.createElement('th');
      th.className = col.cls;
      if (!col.key) {
        th.textContent = col.label;
      } else {
        var on = sort.key === col.key;
        th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = on ? 'sort-btn on' : 'sort-btn';
        b.textContent = col.label + (on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
        b.addEventListener('click', function() {
          // 同じ列なら昇⇄降、別の列なら昇順から
          if (sort.key === col.key) sort.dir = (sort.dir === 'asc' ? 'desc' : 'asc');
          else sort = { key: col.key, dir: 'asc' };
          redrawTable();
        });
        th.appendChild(b);
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function(p) { tbody.appendChild(buildRow(ctx, p, locked)); });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  // 1 人 1 行。巡・No.（order から導出）と得点は読み取り。
  // 名前・コート・性別・新人・技は Task 7 で入力にする。
  function buildRow(ctx, p, locked) {
    var key = Courts.orderKey(p);
    var tr = document.createElement('tr');
    tr.appendChild(cell(String(Courts.roundOf(p)), 'num col-round'));
    tr.appendChild(cell(String(key.no || ''), 'num col-no'));
    tr.appendChild(cell(p.name || '', 'col-name desk-cell-main'));
    tr.appendChild(cell(Courts.courtOf(p), 'col-court'));
    tr.appendChild(cell(Courts.sexOf(p), 'col-sex'));
    tr.appendChild(cell(p.isNewFace ? '○' : '', 'col-new'));
    tr.appendChild(cell(p.tech1 || '', 'col-tech'));
    tr.appendChild(cell(p.tech2 || '', 'col-tech'));
    tr.appendChild(cell(p.tech3 || '', 'col-tech'));
    tr.appendChild(cell(String(p.score || 0), 'num col-score'));
    tr.appendChild(cell('', 'act'));
    return tr;
  }

  Desk.registerTab('players', { render: render });
})();
```

- [ ] **Step 2: 画面で確かめる**

準備: `desk.html#events` から「＋ 新規作成」で `選手表テスト` を作り、スマホ運営（`admin.html#players/<id>`）か CSV 取り込みで **A コートと B コート・男女・新人あり・技が空の人が 1 人以上** いる状態にする（10 名程度）。

`http://localhost:3461/desk.html#players/<選手表テストのID>` を新しいタブ・幅 1280px で開く。
Expected:
- 帯が 1 段で出る（`全コート / A コート / B コート` `男女 / 男子 / 女子` `全巡 / 1巡` `新人` `技未入力`）と、右端に「名前で検索」
- チップを押すと表が絞り込まれ、押したチップだけが塗られる
- 「技未入力」で技が 3 つとも空の選手だけになる
- 名前を打つと絞り込まれる。**日本語を IME で打っている途中では絞り込まれず、確定した時点で絞り込まれる**
- 見出しの「No.」「名前」「得点」を押すと ▲▼ が付いて並びが変わる。他の列には ▲▼ が出ない
- 開発者ツールで `<th class="col-name">` に `aria-sort` が付いている（並べ替え中は `ascending` / `descending`、それ以外は `none`）
- 1280px で横スクロールが出ない。窓を 900px に狭めると表の枠だけ横に流れ、**名前の列が左に貼り付いて追従する**
- 条件に合う行が無いと「条件に合う選手がいません。」、選手が 0 名の大会では「まだ選手がいません。」
- 別の大会へ移って戻ると絞り込みが既定（全コート・男女・全巡・No. 昇順）に戻る
- 最終結果を確定した大会（テスト用に `二巡目なしで終了` まで進めた大会）では上に「この大会は最終結果を確定済みです。…」が出る
- ライト／ダークの両方で読める

- [ ] **Step 3: コミット**

```bash
git add desk-players.js
git commit -m "feat: PC 運営の選手表に絞り込みと並べ替えを足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: セルを編集できるようにする（`desk-players.js`）

**前提: Task 3（`Courts.scoreMayChange`）と Task 6。**

名前・コート・性別・新人・技1〜3 を入力にして、blur / Enter（セレクトとチェックは change）で **1 項目だけ** PATCH する。通信中はそのセルを無効にし、失敗したらそのセルを元に戻して `alert`（`reason === 'locked'` は専用の文言）。採点済みの選手の性別・技は `Courts.scoreMayChange` で断る。ロック中は全部の入力を無効にする。

**Files:**
- Modify: `desk-players.js`（`buildRow` を置き換え、その後ろにセルの関数群を足す）

- [ ] **Step 1: `buildRow` を置き換える**

Task 6 で書いた `buildRow`（`// 1 人 1 行。巡・No.（order から導出）と得点は読み取り。` のコメントから関数の閉じ括弧まで）を丸ごと次に置き換える。

```js
  // 1 人 1 行。名前・コート・性別・新人・技は編集できる。
  // 巡・No.（order から導出）と得点は読み取り（得点は採点画面が書く）。
  function buildRow(ctx, p, locked) {
    var key = Courts.orderKey(p);
    var tr = document.createElement('tr');
    tr.appendChild(cell(String(Courts.roundOf(p)), 'num col-round'));
    tr.appendChild(cell(String(key.no || ''), 'num col-no'));
    tr.appendChild(nameCell(ctx, p, locked));
    tr.appendChild(courtCell(ctx, p, locked));
    tr.appendChild(sexCell(ctx, p, locked));
    tr.appendChild(newFaceCell(ctx, p, locked));
    tr.appendChild(techCell(ctx, p, locked, 1));
    tr.appendChild(techCell(ctx, p, locked, 2));
    tr.appendChild(techCell(ctx, p, locked, 3));
    tr.appendChild(cell(String(p.score || 0), 'num col-score'));
    tr.appendChild(cell('', 'act'));
    return tr;
  }
```

- [ ] **Step 2: セルの関数群を足す**

`buildRow` の**直後**（`Desk.registerTab('players', …)` の前）に足す。

```js
  // --- セルの編集（1 項目ずつ保存する） ---

  // 保存に成功した選手をその場で差し替える。表は描き直さないので、
  // 次の保存の比較（Courts.scoreMayChange）が古い値を見ないようにする。
  function adopt(dst, src) {
    ['name', 'order', 'tech1', 'tech2', 'tech3', 'result'].forEach(function(k) {
      if (typeof src[k] === 'string') dst[k] = src[k];
    });
    if (typeof src.score === 'number') dst.score = src.score;
    dst.isFemale = src.isFemale === true;
    dst.isNewFace = src.isNewFace === true;
  }

  // セル 1 つの保存。patch は送る 1 項目だけ。
  //   revert : 失敗したときに表示を元へ戻す
  //   after  : 成功したときの追加処理（order が変わるセルは表を描き直す）
  // 失敗しても表は描き直さない（他のセルの入力途中を壊さないため）。
  async function saveCell(ctx, p, el, patch, revert, after) {
    // 採点済みの選手の性別・技は、採点画面が変更に気付けない（Courts.scoreMayChange 参照）
    if (Courts.scoreMayChange(p, patch) && !confirm(Courts.scoreChangeConfirmMessage(p))) {
      revert();
      return;
    }
    el.disabled = true;
    el.classList.add('saving');
    var res = await Api.updatePlayerInfo(ctx.eventId, p.id, patch);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた。DOM にも alert にも触らない
    el.disabled = false;
    el.classList.remove('saving');
    if (!res || !res.ok) {
      revert();
      if (res && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      } else {
        alert('保存できませんでした。\n入力内容と通信を確認してください。');
      }
      return;
    }
    if (res.player) adopt(p, res.player);
    Desk.toast('保存しました');
    if (after) after();
  }

  // 文字の入力（名前）。blur で保存し、Enter は blur に流す（二重送信しない）。
  // buildPatch(value) が null を返したら送らずに元へ戻す（理由は buildPatch が alert する）。
  function bindText(ctx, p, el, buildPatch, after) {
    var last = el.value;
    var busy = false;
    var composing = false;

    async function commit() {
      if (busy) return;
      var value = el.value.trim();
      el.value = value;
      if (value === last) return;
      var patch = buildPatch(value);
      if (!patch) { el.value = last; return; }
      busy = true;
      await saveCell(ctx, p, el, patch, function() { el.value = last; }, after);
      busy = false;
      if (ctx.isStale()) return;
      if (el.value === value) last = value;   // 成功（失敗なら revert で last に戻っている）
    }

    el.addEventListener('blur', function() { commit(); });
    el.addEventListener('compositionstart', function() { composing = true; });
    el.addEventListener('compositionend', function() { composing = false; });
    el.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      // IME 変換中の Enter は変換の確定。保存には使わない
      // （keyCode 229 は変換中を示す環境向けの保険）。
      if (composing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      el.blur();   // 保存は blur に一本化する
    });
  }

  // セレクト・チェックの保存（change で1回だけ）。
  //   readValue() : いまの値
  //   toPatch(v)  : 送るオブジェクト
  //   setValue(v) : 表示を書き戻す（失敗したときの巻き戻し）
  function bindChoice(ctx, p, el, initial, readValue, toPatch, setValue, after) {
    var last = initial;
    var busy = false;
    el.addEventListener('change', async function() {
      if (busy) return;
      var value = readValue();
      if (value === last) return;
      busy = true;
      await saveCell(ctx, p, el, toPatch(value), function() { setValue(last); }, after);
      busy = false;
      if (ctx.isStale()) return;
      if (readValue() === value) last = value;
    });
  }

  function nameCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-name';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'desk-cell-input';
    input.value = p.name || '';
    input.setAttribute('aria-label', '名前');
    input.disabled = locked;
    bindText(ctx, p, input, function(v) {
      if (!v) { alert('名前を入力してください。'); return null; }
      return { name: v };
    }, null);
    td.appendChild(input);
    return td;
  }

  var NEW_COURT = ' new';   // 「新しいコート…」の選択肢の値（コート名には使えない文字）

  // コートの選択肢。既存のコート＋その選手の今のコート＋「新しいコート…」。
  function fillCourtOptions(sel, ctx, current) {
    sel.innerHTML = '';
    var list = Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    if (current && list.indexOf(current) === -1) list.push(current);   // 未分類のままの選手も表示する
    list.forEach(function(c) { addOption(sel, c, c); });
    addOption(sel, NEW_COURT, '新しいコート…');
    sel.value = current;
  }

  function addOption(sel, value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
    return o;
  }

  function hasOption(sel, value) {
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === value) return true;
    }
    return false;
  }

  // 新しく作ったコートを「新しいコート…」の手前に足して選ぶ
  // （querySelector で値を探すとコート名の記号でセレクタが壊れるので options を舐める）。
  function insertCourtOption(sel, name) {
    if (!hasOption(sel, name)) {
      var o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      sel.insertBefore(o, sel.lastChild);
    }
    sel.value = name;
  }

  // 新しいコート名の入力。order は「コート-性別-巡目-番号」なので "-" と「未分類」は使えない。
  // 取りやめ・不正なら '' を返す（呼び出し側は選択を元に戻す）。
  function askCourtName() {
    var name = prompt('新しいコート名を入力してください（例: D）');
    if (name === null) return '';
    name = name.trim();
    if (!name) { alert('コート名を入力してください。'); return ''; }
    if (name.indexOf('-') >= 0) { alert('コート名に「-」は使えません。'); return ''; }
    if (name === Courts.UNASSIGNED) { alert('「' + Courts.UNASSIGNED + '」はコート名に使えません。'); return ''; }
    if (name.length > 32) { alert('コート名は32文字までです。'); return ''; }
    return name;
  }

  function courtCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-court';
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', 'コート');
    sel.disabled = locked;
    var cur = Courts.courtOf(p);
    fillCourtOptions(sel, ctx, cur);

    var last = cur;
    var busy = false;
    sel.addEventListener('change', async function() {
      if (busy) return;
      var value = sel.value;
      if (value === NEW_COURT) {
        var name = askCourtName();
        if (!name) { sel.value = last; return; }
        insertCourtOption(sel, name);
        value = name;
      }
      if (value === last) return;
      busy = true;
      // コートが変わると order が振り直される（番号が変わる）ので、表ごと読み直す
      await saveCell(ctx, p, sel, { court: value }, function() { sel.value = last; },
        function() { Desk.reloadEvent(); });
      busy = false;
      if (ctx.isStale()) return;
      if (sel.value === value) last = value;
    });
    td.appendChild(sel);
    return td;
  }

  function sexCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-sex';
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', '性別');
    sel.disabled = locked;
    addOption(sel, '男子', '男子');
    addOption(sel, '女子', '女子');
    var cur = Courts.sexOf(p);
    sel.value = cur;
    // 性別が変わると order が振り直される（男女で採番が別）ので、表ごと読み直す
    bindChoice(ctx, p, sel, cur,
      function() { return sel.value; },
      function(v) { return { isFemale: v === '女子' }; },
      function(v) { sel.value = v; },
      function() { Desk.reloadEvent(); });
    td.appendChild(sel);
    return td;
  }

  function newFaceCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-new';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'desk-cell-check';
    chk.checked = !!p.isNewFace;
    chk.setAttribute('aria-label', '新人');
    chk.disabled = locked;
    bindChoice(ctx, p, chk, !!p.isNewFace,
      function() { return chk.checked; },
      function(v) { return { isNewFace: v }; },
      function(v) { chk.checked = v; },
      null);
    td.appendChild(chk);
    return td;
  }

  // 技の選択肢は「その大会の技リスト」＋空（技を消せるように）。
  // 選手が持っている技がリストに無い場合（技リストを入れ替えた後など）は、
  // 黙って空にしないよう、その名前も選択肢に足す。
  function techCell(ctx, p, locked, slot) {
    var td = document.createElement('td');
    td.className = 'col-tech';
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', '技' + slot);
    sel.disabled = locked;
    var cur = p['tech' + slot] || '';
    addOption(sel, '', '—');
    var found = false;
    (ctx.techniques || []).forEach(function(t) {
      var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
      if (!n) return;
      addOption(sel, n, n);
      if (n === cur) found = true;
    });
    if (cur && !found) addOption(sel, cur, cur + '（リストに無い技）');
    sel.value = cur;
    bindChoice(ctx, p, sel, cur,
      function() { return sel.value; },
      function(v) {
        var patch = {};
        patch['tech' + slot] = v;
        return patch;
      },
      function(v) { sel.value = v; },
      null);
    td.appendChild(sel);
    return td;
  }
```

- [ ] **Step 3: 画面で確かめる**

`http://localhost:3461/desk.html#players/<選手表テストのID>` を新しいタブ・幅 1280px で開く。
Expected:
- 名前を直して Tab か別の場所をクリック（blur）→ 右下に「保存しました」。ページを再読み込みしても直っている
- 名前を直して **Enter** → 同じく保存される（1 回だけ。ネットワークタブで PATCH が 1 本）
- 名前を**日本語で IME 変換中に Enter**（変換候補の確定）→ 保存されない。変換を確定してからもう一度 Enter で保存される
- 名前を空にして blur → 「名前を入力してください。」が出て元の名前に戻る
- コートを B に変える → 表が読み直されて **No. が振り直される**（B コートの続き番号になる）
- コートで「新しいコート…」→ `D` と入力 → D コートに移る。`A-1` と入力すると「コート名に「-」は使えません。」
- 「新しいコート…」で取り消し（キャンセル）→ 選択が元のコートに戻る
- 性別を変える → No. が振り直される
- 新人のチェックを付け外し → 「保存しました」。再読み込みしても残る
- 技のセレクトで技を選ぶ・「—」で消す → 保存される
- **採点済みの選手**（採点画面で得点を入れた人）の技か性別を変えると「この選手は採点済みです（○点）。…」が出る。キャンセルすると元に戻る。名前と新人は警告なしで保存できる
- サーバーを止めてから名前を直して blur → 「保存できませんでした。…」が出て、そのセルが元の値に戻る（サーバーを戻すこと）
- 最終結果を確定した大会では入力が全部灰色で触れない
- 1280px で横スクロールが出ない

- [ ] **Step 4: コミット**

```bash
git add desk-players.js
git commit -m "feat: PC 運営の選手表のセルを編集できるようにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 「＋ 行を追加」の下書き行（`desk-players.js`）

**前提: Task 7。**

表の末尾にクライアントだけの下書き行を出す。名前を入れて blur / Enter で `Api.createPlayer`（一巡目）。コート・性別・新人は直前の行の値を初期値にする。Esc か、名前が空のままフォーカスが行の外へ出たら行を消す。保存できたら同じ初期値でもう 1 行出す（表に打ち込んでいく使い方）。ロック中は「＋ 行を追加」を出さない。

**Files:**
- Modify: `desk-players.js`（モジュール先頭の状態・`render` の頭・`renderTable`・末尾に下書き行の関数群）

- [ ] **Step 1: 下書きの状態を足す**

`var view = null;   // { chips, wrap, ctx, locked }` の直後に足す。

```js
  // 「＋ 行を追加」の下書き行。null なら出さない。
  // 値は次に作る行の初期値（直前の行のコート・性別・新人を引き継ぐ）。
  // サーバーにはまだ無い行なので、大会を移ったら捨てる。
  var draft = null;   // null | { court, isFemale, isNewFace }
```

- [ ] **Step 2: 大会が変わったら下書きを捨てる**

`render` の中。置き換え前:

```js
    if (stateOwner !== ctx.eventId) {
      filter = Courts.defaultFilter();
      sort = Courts.defaultSort();
      stateOwner = ctx.eventId;
    }
```

置き換え後:

```js
    if (stateOwner !== ctx.eventId) {
      filter = Courts.defaultFilter();
      sort = Courts.defaultSort();
      draft = null;
      stateOwner = ctx.eventId;
    }
    if (locked) draft = null;   // 確定済みの大会では行を足せない
```

- [ ] **Step 3: 見出しに「＋ 行を追加」を足す**

`render` の中。置き換え前:

```js
    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(count);
    container.appendChild(head);
```

置き換え後:

```js
    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(count);
    if (!locked) {
      var btnAdd = document.createElement('button');
      btnAdd.type = 'button';
      btnAdd.className = 'desk-btn';
      btnAdd.textContent = '＋ 行を追加';
      btnAdd.addEventListener('click', function() { startDraft(ctx); });
      head.appendChild(btnAdd);
    }
    container.appendChild(head);
```

- [ ] **Step 4: `renderTable` を下書き行に対応させる**

Task 6 で書いた `renderTable` を丸ごと次に置き換える。

```js
  function renderTable(wrap, ctx, locked) {
    wrap.innerHTML = '';
    var players = ctx.players || [];
    if (players.length === 0 && !draft) {
      wrap.appendChild(emptyMessage('まだ選手がいません。「＋ 行を追加」か「📋 貼り付けて追加」で登録してください。'));
      return;
    }
    var rows = Courts.sortBy(Courts.applyFilter(players, filter), sort);
    if (rows.length === 0 && !draft) {
      wrap.appendChild(emptyMessage('条件に合う選手がいません。'));
      return;
    }

    var table = document.createElement('table');
    table.className = 'desk-table desk-players-table';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    COLUMNS.forEach(function(col) {
      var th = document.createElement('th');
      th.className = col.cls;
      if (!col.key) {
        th.textContent = col.label;
      } else {
        var on = sort.key === col.key;
        th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = on ? 'sort-btn on' : 'sort-btn';
        b.textContent = col.label + (on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
        b.addEventListener('click', function() {
          // 同じ列なら昇⇄降、別の列なら昇順から
          if (sort.key === col.key) sort.dir = (sort.dir === 'asc' ? 'desc' : 'asc');
          else sort = { key: col.key, dir: 'asc' };
          redrawTable();
        });
        th.appendChild(b);
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function(p) { tbody.appendChild(buildRow(ctx, p, locked)); });
    // 下書き行は絞り込みに関わらず必ず末尾に出す（打ち込んでいる途中で消えない）
    if (draft && !locked) tbody.appendChild(buildDraftRow(ctx));
    table.appendChild(tbody);
    wrap.appendChild(table);
  }
```

- [ ] **Step 5: 下書き行の関数群を足す**

`techCell` の直後（`Desk.registerTab('players', …)` の前）に足す。

```js
  // --- 「＋ 行を追加」の下書き行 ---

  // 直前の行（いま表に出ている最後の行）からコート・性別・新人を引き継ぐ。
  // 表が空なら最初のコート（無ければ A）・男子・新人なし。
  function draftSeed(ctx) {
    var rows = Courts.sortBy(Courts.applyFilter(ctx.players || [], filter), sort);
    var last = rows.length ? rows[rows.length - 1] : null;
    var courts = Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    var court = last ? Courts.courtOf(last) : '';
    if (!court || court === Courts.UNASSIGNED) court = courts[0] || 'A';
    return {
      court: court,
      isFemale: last ? !!last.isFemale : false,
      isNewFace: last ? !!last.isNewFace : false
    };
  }

  function startDraft(ctx) {
    draft = draftSeed(ctx);
    redrawTable();
    var input = view && view.wrap.querySelector('.desk-draft-row input[type="text"]');
    if (input) input.focus();
  }

  function cancelDraft() {
    draft = null;
    redrawTable();
  }

  // 下書き行。サーバーにはまだ無いので、保存するのは名前を確定したとき 1 回だけ。
  // コート・性別・新人・技はその場の値を持つだけで、通信はしない。
  function buildDraftRow(ctx) {
    var d = {
      name: '', court: draft.court, isFemale: draft.isFemale, isNewFace: draft.isNewFace,
      tech1: '', tech2: '', tech3: ''
    };
    var tr = document.createElement('tr');
    tr.className = 'desk-draft-row';
    tr.appendChild(cell('1', 'num col-round'));    // 追加は常に一巡目（二巡目は生成 API が作る）
    tr.appendChild(cell('—', 'num col-no'));       // 番号はサーバーが採番する

    var tdName = document.createElement('td');
    tdName.className = 'col-name';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'desk-cell-input';
    input.placeholder = '名前を入れて Enter';
    input.setAttribute('aria-label', '追加する選手の名前');
    tdName.appendChild(input);
    tr.appendChild(tdName);

    // コート
    var tdCourt = document.createElement('td');
    tdCourt.className = 'col-court';
    var selCourt = document.createElement('select');
    selCourt.className = 'desk-cell-select';
    selCourt.setAttribute('aria-label', 'コート');
    fillCourtOptions(selCourt, ctx, d.court);
    selCourt.addEventListener('change', function() {
      if (selCourt.value === NEW_COURT) {
        var name = askCourtName();
        if (!name) { selCourt.value = d.court; return; }
        insertCourtOption(selCourt, name);
      }
      d.court = selCourt.value;
    });
    tdCourt.appendChild(selCourt);
    tr.appendChild(tdCourt);

    // 性別
    var tdSex = document.createElement('td');
    tdSex.className = 'col-sex';
    var selSex = document.createElement('select');
    selSex.className = 'desk-cell-select';
    selSex.setAttribute('aria-label', '性別');
    addOption(selSex, '男子', '男子');
    addOption(selSex, '女子', '女子');
    selSex.value = d.isFemale ? '女子' : '男子';
    selSex.addEventListener('change', function() { d.isFemale = (selSex.value === '女子'); });
    tdSex.appendChild(selSex);
    tr.appendChild(tdSex);

    // 新人
    var tdNew = document.createElement('td');
    tdNew.className = 'col-new';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'desk-cell-check';
    chk.checked = d.isNewFace;
    chk.setAttribute('aria-label', '新人');
    chk.addEventListener('change', function() { d.isNewFace = chk.checked; });
    tdNew.appendChild(chk);
    tr.appendChild(tdNew);

    // 技 1〜3
    [1, 2, 3].forEach(function(slot) {
      var td = document.createElement('td');
      td.className = 'col-tech';
      var sel = document.createElement('select');
      sel.className = 'desk-cell-select';
      sel.setAttribute('aria-label', '技' + slot);
      addOption(sel, '', '—');
      (ctx.techniques || []).forEach(function(t) {
        var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
        if (n) addOption(sel, n, n);
      });
      sel.addEventListener('change', function() { d['tech' + slot] = sel.value; });
      td.appendChild(sel);
      tr.appendChild(td);
    });

    tr.appendChild(cell('—', 'num col-score'));
    tr.appendChild(cell('', 'act'));

    var busy = false;
    var composing = false;

    function setDisabled(flag) {
      [input, selCourt, selSex, chk].forEach(function(el) { el.disabled = flag; });
      var sels = tr.querySelectorAll('.col-tech select');
      for (var i = 0; i < sels.length; i++) sels[i].disabled = flag;
    }

    async function create() {
      if (busy) return;
      var name = input.value.trim();
      if (!name) { cancelDraft(); return; }
      busy = true;
      setDisabled(true);
      var created = await Api.createPlayer(ctx.eventId, {
        name: name, court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace,
        tech1: d.tech1, tech2: d.tech2, tech3: d.tech3, round: 1
      });
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
      busy = false;
      setDisabled(false);
      if (created && created.player === null) {
        // 409（いまは確定済みガードだけ）。行は残す（入力を失わせない）
        if (created.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else {
          alert(created.error);
        }
        return;
      }
      if (!created) {
        alert('選手を追加できませんでした。\n入力内容と通信を確認してください。');
        return;
      }
      Desk.toast(created.order + ' ' + created.name + ' を追加しました');
      // 続けて打ち込めるよう、同じコート・性別・新人でもう 1 行出す
      draft = { court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace };
      await Desk.reloadEvent();
      if (ctx.isStale()) return;
      var next = view && view.wrap.querySelector('.desk-draft-row input[type="text"]');
      if (next) next.focus();
    }

    input.addEventListener('compositionstart', function() { composing = true; });
    input.addEventListener('compositionend', function() { composing = false; });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { e.preventDefault(); cancelDraft(); return; }
      if (e.key !== 'Enter') return;
      if (composing || e.isComposing || e.keyCode === 229) return;   // IME 変換中の Enter は確定
      e.preventDefault();
      create();
    });
    input.addEventListener('blur', function() {
      // 行の中で Tab 移動しただけなら消さない。フォーカスが行の外へ出たときだけ判断する。
      setTimeout(function() {
        if (busy || !tr.parentNode) return;
        if (tr.contains(document.activeElement)) return;
        if (input.value.trim()) create();
        else cancelDraft();
      }, 0);
    });

    return tr;
  }
```

- [ ] **Step 6: 下書きが読み直しをまたぐことを確かめる（コードの確認だけ）**

`draft` はモジュール変数なので、`Desk.reloadEvent()` → `render` を通っても（同じ大会・ロックされていない限り）残り、`renderTable` が新しい下書き行を作る。**追加の変更は不要。** `render` の先頭で `draft` を消すのは「大会が変わったとき」と「ロック中」の 2 つだけであることを目で確かめる。

- [ ] **Step 7: 画面で確かめる**

`http://localhost:3461/desk.html#players/<選手表テストのID>` を新しいタブ・幅 1280px で開く。
Expected:
- 「＋ 行を追加」を押すと表の末尾に色の違う行が出て、名前の入力にカーソルが入る
- コート・性別・新人が**表の最後の行と同じ**になっている
- 名前を入れて Enter → 「A-男子-1-5 ○○ を追加しました」のトースト。表に行が増え、**下に空の下書き行がもう 1 つ出て**カーソルが入る（続けて打ち込める）
- 下書き行で Tab を押してコート・性別・技を選んでから名前に戻って Enter → その内容で登録される（Tab 移動で行が消えない）
- 名前を空のまま表の外をクリック → 下書き行が消える
- 名前を入れている途中で Esc → 下書き行が消える
- IME で変換中の Enter では登録されない（変換の確定だけ）
- 選手が 0 名の大会でも「＋ 行を追加」で 1 人目を登録できる
- 最終結果を確定した大会には「＋ 行を追加」が出ない

- [ ] **Step 8: コミット**

```bash
git add desk-players.js
git commit -m "feat: PC 運営の選手表に「＋ 行を追加」を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 「📋 貼り付けて追加」（`desk-players.js`）

**前提: Task 1（サーバーの `rows`）・Task 2（`Courts.parsePasteRows`）・Task 8。**

テキストエリアのダイアログ（`Desk.openDialog`）を出し、タブ区切り／カンマ区切りを `Courts.parsePasteRows` で解析する。取り込める行と取り込めない行を件数と一覧で見せ、取り込めない行は赤く（技名がリストに無い場合はその技名も赤く）示して**送らない**。確認してから `Api.createPlayersBulk(eventId, { rows })`。

**Files:**
- Modify: `desk-players.js`（`render` の見出し・末尾にダイアログの関数群）

- [ ] **Step 1: 見出しに「📋 貼り付けて追加」を足す**

`render` の中。Task 8 で書いた `if (!locked) { … }` のブロックの **`head.appendChild(btnAdd);` の直後**（同じ `if` の中）に足す。

```js
      var btnPaste = document.createElement('button');
      btnPaste.type = 'button';
      btnPaste.className = 'desk-btn';
      btnPaste.textContent = '📋 貼り付けて追加';
      btnPaste.addEventListener('click', function() { openPasteDialog(ctx); });
      head.appendChild(btnPaste);
```

- [ ] **Step 2: ダイアログの関数群を足す**

`buildDraftRow` の直後（`Desk.registerTab('players', …)` の前）に足す。

```js
  // --- 「📋 貼り付けて追加」（Excel からの一括登録） ---

  // 1 行の下見（プレビュー）。取り込めない行は赤く、技リストに無い技名も赤くする。
  function pasteLine(row) {
    var div = document.createElement('div');
    div.className = 'desk-paste-line' + (row.ok ? '' : ' bad');
    var head = document.createElement('span');
    head.textContent = row.line + ': ' + row.name + '　' + row.court + '　' +
      (row.isFemale ? '女子' : '男子') + (row.isNewFace ? '　新人' : '') + '　';
    div.appendChild(head);
    row.techs.forEach(function(t, i) {
      var span = document.createElement('span');
      span.textContent = (i > 0 ? '・' : '') + (t || '—');
      if (t && row.badTechs.indexOf(t) !== -1) span.className = 'desk-paste-bad';
      div.appendChild(span);
    });
    if (!row.ok) {
      var why = document.createElement('span');
      why.textContent = '　← ' + row.error;
      div.appendChild(why);
    }
    return div;
  }

  function openPasteDialog(ctx) {
    var body = document.createElement('div');

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'Excel の範囲をそのまま貼り付けられます。列は 名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 の順' +
      '（タブ区切りかカンマ区切り）。1 行目が「名前」で始まるときは見出しとして読み飛ばします。' +
      '性別は「女子」「女」「F」が女子、それ以外は男子。新人は「新人」「○」「1」「true」。' +
      '技はこの大会の技リストにある名前だけです。';
    body.appendChild(note);

    var ta = document.createElement('textarea');
    ta.className = 'desk-paste';
    ta.setAttribute('aria-label', '貼り付ける選手の一覧');
    ta.placeholder = '山田 太郎\tA\t男子\t新人\t…\n佐藤 花子\tA\t女子\t\t…';
    body.appendChild(ta);

    var summary = document.createElement('p');
    summary.className = 'desk-paste-count';
    body.appendChild(summary);

    var preview = document.createElement('div');
    preview.className = 'desk-paste-preview';
    body.appendChild(preview);

    var btnAdd = document.createElement('button');
    btnAdd.type = 'button';
    btnAdd.className = 'desk-btn primary';
    btnAdd.textContent = '登録';

    var dialog = Desk.openDialog('貼り付けて追加', body, [btnAdd]);
    var okRows = [];
    var ngCount = 0;

    function update() {
      var parsed = Courts.parsePasteRows(ta.value, ctx.techniques || []);
      okRows = parsed.rows.filter(function(r) { return r.ok; });
      ngCount = parsed.rows.length - okRows.length;
      summary.textContent = okRows.length + ' 人を登録します' +
        (ngCount > 0 ? '（取り込めない行が ' + ngCount + ' 行あります）' : '');
      summary.className = 'desk-paste-count' + (ngCount > 0 ? ' desk-paste-bad' : '');
      preview.innerHTML = '';
      parsed.rows.forEach(function(r) { preview.appendChild(pasteLine(r)); });
      btnAdd.disabled = okRows.length === 0;
    }
    ta.addEventListener('input', update);
    update();
    ta.focus();

    btnAdd.addEventListener('click', async function() {
      if (okRows.length === 0) return;
      if (okRows.length > 500) {
        alert('一度に登録できるのは 500 人までです（いまは ' + okRows.length + ' 人）。分けて貼り付けてください。');
        return;
      }
      var rows = okRows.map(function(r) {
        return {
          name: r.name, court: r.court, isFemale: r.isFemale, isNewFace: r.isNewFace,
          tech1: r.techs[0], tech2: r.techs[1], tech3: r.techs[2]
        };
      });
      if (!confirm(rows.length + ' 人を登録します。よろしいですか？' +
          (ngCount > 0 ? '\n取り込めない ' + ngCount + ' 行は登録しません。' : ''))) {
        return;
      }
      var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
      // 確認ダイアログの後・API 呼び出しの前で、大会が切り替わっていないか再確認する
      // （admin-players.js の一括登録と同じ規約。古い ctx の大会に書き込まない）。
      if (Desk.currentEventId() !== eventId) {
        alert('大会が切り替わったため、登録を中止しました。');
        return;
      }
      btnAdd.disabled = true;
      dialog.lock(true);
      var res = await Api.createPlayersBulk(eventId, { rows: rows });
      if (Desk.currentEventId() !== eventId) return;   // 大会が切り替わっていたら画面に触らない
      btnAdd.disabled = false;
      dialog.lock(false);
      if (!res || res.error) {
        // 失敗してもダイアログは閉じない（貼り付けた内容を残す）
        alert('登録できませんでした。\n' + ((res && res.error) || '入力内容と通信を確認してください。'));
        return;
      }
      Desk.toast(res.created + ' 人を登録しました');
      // 履歴（CSV 取り込み・スマホの一括登録と同じ形で残す）
      Api.addHistory(eventId, {
        action: 'bulk_add',
        detail: res.created + '名の選手を一括登録'
      });
      dialog.close();
      Desk.reloadEvent();
    });
  }
```

- [ ] **Step 3: 画面で確かめる**

`http://localhost:3461/desk.html#players/<選手表テストのID>` を新しいタブ・幅 1280px で開く。技リストにある技名を 1 つ控えておく（表の技セレクトを開けば分かる）。

「📋 貼り付けて追加」を押して、次を貼り付ける（`真` の部分は実際の技名にする）。

```
名前,コート,性別,新人,技1,技2,技3
貼付 一郎,A,男子,新人,真,,
貼付 花子,A,女,,真,,
貼付 二郎,B,男子,,幻の太刀,,
,A,男子,,,,
貼付 三郎,,男子,,,,
```

Expected:
- 見出し行が飛ばされ、下見に 5 行（元の 2〜6 行目）が出る
- 行ごとの見え方: `2: 貼付 一郎`（ふつうの色）、`3: 貼付 花子`（ふつうの色。女子・新人なし）、`4: 貼付 二郎`（赤。技名「幻の太刀」が太い赤で、末尾に「← 技「幻の太刀」は技リストにありません」）、`5:`（赤。「← 名前がありません」）、`6: 貼付 三郎`（赤。「← コートがありません」）
- 件数は「2 人を登録します（取り込めない行が 3 行あります）」と赤で出る
- 「登録」→ 確認 →「2 人を登録しました」。表に 2 人増え、`貼付 花子` が女子・A コートで入っている。技も入っている
- タブ区切り（Excel からコピーした範囲）でも同じように読める
- 全部の行が取り込めないときは「登録」が押せない
- サーバーを止めて「登録」→ 「登録できませんでした。…」が出て、**ダイアログは閉じず**貼り付けた内容が残る（サーバーを戻すこと）
- 最終結果を確定した大会には「📋 貼り付けて追加」が出ない

- [ ] **Step 4: コミット**

```bash
git add desk-players.js
git commit -m "feat: PC 運営の選手表に貼り付けによる一括登録を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 行の「⋯」（削除）と見出しの「⋯」（CSV 取り込み）（`desk-players.js`）

**前提: Task 4（`Storage.pickCsvFile`）・Task 9。**

行の「⋯」から削除（採点済みは 409 の得点を出して再確認。一巡目を消しても二巡目は残る注記）。見出しの「⋯」から CSV 取り込み（`Api.importCsv`。採点済み 409 のガードつき）。メニューは `desk-events.js` と同じ `<details class="desk-menu">` の作り。ロック中は行の「⋯」を出さず、CSV 取り込みは無効にする。

**Files:**
- Modify: `desk-players.js`（`render` の見出し・`buildRow` の最後のセル・末尾にメニューと CSV の関数群）

- [ ] **Step 1: 見出しに「⋯」を足す**

`render` の中。置き換え前（Task 8・9 で育てたブロックの閉じ括弧と、その次の行）:

```js
      head.appendChild(btnPaste);
    }
    container.appendChild(head);
```

置き換え後:

```js
      head.appendChild(btnPaste);
    }
    head.appendChild(buildHeadMenu(ctx, locked));
    container.appendChild(head);
```

- [ ] **Step 2: 行の最後のセルを「⋯」にする**

`buildRow` の中。置き換え前:

```js
    tr.appendChild(cell(String(p.score || 0), 'num col-score'));
    tr.appendChild(cell('', 'act'));
    return tr;
  }
```

置き換え後:

```js
    tr.appendChild(cell(String(p.score || 0), 'num col-score'));
    var tdAct = document.createElement('td');
    tdAct.className = 'act';
    if (!locked) tdAct.appendChild(buildRowMenu(ctx, p));
    tr.appendChild(tdAct);
    return tr;
  }
```

- [ ] **Step 3: メニューと CSV の関数群を足す**

`openPasteDialog` の直後（`Desk.registerTab('players', …)` の前）に足す。

```js
  // --- 「⋯」メニュー（行の削除・CSV 取り込み） ---

  // details/summary の外側をクリックしたら閉じる。document への登録は 1 回だけ
  // （描画のたびにリスナーが積み重ならないように）。desk-events.js と同じ作り。
  var outsideClickBound = false;
  function bindOutsideClickOnce() {
    if (outsideClickBound) return;
    outsideClickBound = true;
    document.addEventListener('click', function(e) {
      var menus = document.querySelectorAll('.desk-menu[open]');
      for (var i = 0; i < menus.length; i++) {
        if (!menus[i].contains(e.target)) menus[i].open = false;
      }
    });
  }

  function menuItem(menu, label, onClick, disabledReason) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (disabledReason) {
      b.disabled = true;
      b.title = disabledReason;
    } else {
      b.addEventListener('click', function() {
        menu.open = false;
        onClick();
      });
    }
    return b;
  }

  function buildMenu(label) {
    bindOutsideClickOnce();
    var menu = document.createElement('details');
    menu.className = 'desk-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    sum.setAttribute('aria-label', label);
    menu.appendChild(sum);
    var body = document.createElement('div');
    body.className = 'desk-menu-body';
    menu.appendChild(body);
    return { el: menu, body: body };
  }

  function buildHeadMenu(ctx, locked) {
    var menu = buildMenu('選手のメニュー');
    menu.body.appendChild(menuItem(menu.el, '📄 CSV を取り込む', function() {
      Storage.pickCsvFile(function(text) { return importCsvText(ctx, text); });
    }, locked ? 'この大会は最終結果を確定済みです' : ''));
    return menu.el;
  }

  function buildRowMenu(ctx, p) {
    var menu = buildMenu((p.name || '') + ' の操作');
    menu.body.appendChild(menuItem(menu.el, '🗑 削除', function() { onDelete(ctx, p); }));
    return menu.el;
  }

  // 削除。採点済みは 409 で得点を返してくるので、もう一度確認して force で消す
  // （admin-players.js の編集シートと同じ流れ・同じ文言）。
  async function onDelete(ctx, p) {
    // 一巡目の行だけ「二巡目の行は残ります」と断る（二巡目の行自体を消すときは不要）
    var roundFragment = (Courts.roundOf(p) === 1) ? '二巡目の行は残ります。\n' : '';
    if (!confirm(
      '選手「' + (p.name || '') + '」（' + (p.order || '') + '）を削除します。\n' +
      roundFragment +
      'よろしいですか？'
    )) return;

    var res = await Api.deletePlayer(ctx.eventId, p.id, false);
    if (ctx.isStale()) return;

    if (res && res.blocked && res.reason === 'locked') {
      alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      return;
    }
    if (res && res.blocked) {
      // 採点済みガード。得点を出してもう一度確認し、承諾したときだけ force。
      var bp = res.player || { name: p.name, order: p.order, score: p.score };
      if (!confirm(
        '「' + bp.name + '」（' + bp.order + '）は採点済みです（' + bp.score + '点）。\n' +
        '削除すると採点結果は戻せません。' + roundFragment + '\n' +
        '本当に削除しますか？'
      )) return;
      res = await Api.deletePlayer(ctx.eventId, p.id, true);
      if (ctx.isStale()) return;
    }
    if (res !== true) {
      alert('選手の削除に失敗しました。');
      return;
    }
    Desk.toast('削除しました');
    await Desk.reloadEvent();
  }

  // CSV 取り込み（admin-players.js と同じ流れ）。
  // 確認ダイアログをはさむので、書き込みの直前に必ず大会が同じか見る。
  async function importCsvText(ctx, text) {
    var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
    var eventName = (ctx.event && ctx.event.name) || '';
    var mode = 'replace';
    if ((ctx.players || []).length > 0) {
      mode = confirm(
        '大会「' + eventName + '」に読み込みます。' +
        '既存データをクリアして読み込みますか？（キャンセルで追記）'
      ) ? 'replace' : 'append';
      if (mode === 'append') {
        if (!confirm(
          '既存の ' + ctx.players.length + ' 名に追記します。' +
          '同じ順番の選手がいると重複します。追記しますか？'
        )) return;
      }
    }
    if (Desk.currentEventId() !== eventId) {
      alert('大会が切り替わったため、CSV の読み込みを中止しました。');
      return;
    }
    var result = await Api.importCsv(eventId, text, mode);
    if (Desk.currentEventId() !== eventId) return;
    if (result && result.blocked && result.reason === 'locked') {
      alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      return;
    }
    if (result && result.blocked) {
      if (!confirm(
        '大会「' + eventName + '」\n' +
        'この大会には採点済みの選手が少なくとも ' + result.scoredCount + ' 名います。\n' +
        '他のコート端末による採点も含まれます。\n' +
        '読み込みを続けると、これらの採点結果はすべて失われます。\n' +
        '本当に続行しますか？'
      )) return;
      if (Desk.currentEventId() !== eventId) {
        alert('大会が切り替わったため、CSV の読み込みを中止しました。');
        return;
      }
      result = await Api.importCsv(eventId, text, mode, true);
      if (Desk.currentEventId() !== eventId) return;
    }
    if (!result || !result.success) {
      alert('インポートに失敗しました。' + (result && result.error ? '\n' + result.error : ''));
      return;
    }
    Desk.toast(result.playerCount + '名を読み込みました');
    // 履歴記録（server/data/history に残す。CSV の一括登録は履歴を辿れるようにする）
    Api.addHistory(eventId, {
      action: 'csv_import',
      detail: result.playerCount + '名の選手データをインポート'
    });
    if (Desk.currentEventId() === eventId) Desk.reloadEvent();
  }
```

- [ ] **Step 4: 画面で確かめる**

`http://localhost:3461/desk.html#players/<選手表テストのID>` を新しいタブ・幅 1280px で開く。
Expected:
- 各行の右端に「⋯」が出て、押すと「🗑 削除」が出る。表の外を押すと閉じる
- 未採点の選手を削除 → 「選手「○○」（A-男子-1-3）を削除します。二巡目の行は残ります。…」→ OK で消える
- 採点済みの選手を削除 → もう一度「…は採点済みです（○点）。削除すると採点結果は戻せません。…」が出て、OK で消える。キャンセルすると消えない
- 見出しの「⋯」→「📄 CSV を取り込む」でファイル選択。`data_0.csv` を読み込むと確認（クリア／追記）が出て、読み込める
- 最終結果を確定した大会では行の「⋯」が出ず、見出しの「⋯」の「📄 CSV を取り込む」が灰色で、マウスを載せると「この大会は最終結果を確定済みです」と出る
- 二巡目のある大会で一巡目の行を消しても、二巡目の行が残る

- [ ] **Step 5: コミット**

```bash
git add desk-players.js
git commit -m "feat: PC 運営の選手表に行の削除と CSV 取り込みを足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 通しの確認と後始末

コードは足さない。設計書「テスト > 手動確認」のうちこの計画の範囲を通しで確かめ、直すべき点があれば `desk-players.js` / `desk.css` を直して `fix:` でコミットする。

- [ ] **Step 1: 自動テスト**

サーバーを再起動し、`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`。`bulk rows:` `parsePasteRows:` `scoreMayChange:` `scoreChangeConfirmMessage:` の ✓ がそろっている。計画1〜3 のテストも通ったまま。

- [ ] **Step 2: 通しの手動確認（幅 1280px）**

新しいテスト大会を 1 つ作り、次を通す。

- [ ] 「📋 貼り付けて追加」に Excel から 5 行貼り付けて登録できる。技リストに無い技名の行が赤く示され、送られない
- [ ] 「＋ 行を追加」で続けて 3 人打ち込める（コート・性別が引き継がれる）
- [ ] 名前・コート・性別・新人・技をセルで直せる。コート・性別を変えると No. が振り直される
- [ ] 絞り込み（コート・性別・巡目・新人・技未入力・名前）と並べ替え（No.・名前・得点）が効き、**保存しても絞り込みが保たれる**（コート・性別の保存は読み直すので既定に戻らないことを確認する）
- [ ] 上部の段階表示の「技 未入力 n」が、技を入れるたびに減る（コート・性別の保存で読み直したとき）
- [ ] 「試合開始」→ 採点画面で 1 人採点 → PC に戻って**採点済みの選手の技を変えると警告**が出る
- [ ] 「二巡目なしで終了」で最終結果にすると、表が読み取り専用になる（入力が灰色、「＋ 行を追加」「📋 貼り付けて追加」「行の ⋯」が消える）。上部の「戻す」で編集に戻る
- [ ] ライト／ダークの両テーマで表・チップ・貼り付けダイアログが読める（取り込めない行の赤が両方で読めること）
- [ ] 1280px で横スクロールが出ない。900px に狭めると表だけ横に流れ、名前の列が左に残る
- [ ] スマホ運営（`admin.html#players/<同じ大会>`、幅 375px）の選手タブが壊れていない（表示・編集・CSV 取り込み・一括登録）

- [ ] **Step 3: 後始末**

- 確認に使ったテスト用の大会（`選手表テスト` など）を `desk.html#events` の「⋯ → 🗑 削除」で消す
- `git status` を見て、この計画で触るべきでないファイル（`index.html` `home.*` `scoring.html` `app.js` `desk.js` など、計画3の担当者の作業）に自分の変更が混ざっていないことを確かめる
- 本物の大会「第10回全日本試し斬り大会」のデータが変わっていないことを `server/data/events/` の `git status` と大会一覧で確かめる

- [ ] **Step 4: 直した点があればコミット**

```bash
git add desk-players.js desk.css
git commit -m "fix: PC 運営の選手表の<直した内容>" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 完了条件

- `test.html` が `Result: N passed, 0 failed`。設計書のテスト 13（`createPlayersBulk({ rows })`）、`Courts.parsePasteRows`、`Courts.scoreMayChange` / `scoreChangeConfirmMessage` が入っている。計画1〜3 のテストが通ったまま
- `POST /api/events/:id/players/bulk` が `{ rows }` を受け、500 行まで、全行を検証してから書き、失敗は行番号つきの 400 を返す。ロックガードは今までどおり 409 `locked`
- PC 運営の選手表で、名前・コート・性別・新人・技1〜3 をセルで直せる。保存は 1 項目ずつ、失敗はそのセルが元に戻って理由が出る
- 「＋ 行を追加」で 1 人ずつ、「📋 貼り付けて追加」で Excel からまとめて登録できる
- 行の「⋯」から削除でき、採点済みは得点つきで再確認される。見出しの「⋯」から CSV を取り込める
- 絞り込み・並べ替え・名前の検索が効き、IME の変換中に絞り込みや保存が起きない
- 最終結果を確定した大会では表が読み取り専用になる（入力が無効、行の追加・貼り付け・削除が出ない）
- 1280px で横スクロールが出ない。ライト／ダークの両方で読める
- スマホ運営の選手タブ（`admin-players.js`）の見た目と動きが変わっていない
- 本物の大会のデータが変わっていない。テスト用の大会を消してある

## この計画でやらないこと（計画5）

- PC の「試合」の区画（コート別の状況・採点画面を開く・二巡目の生成・二巡目の技入力の表）
- PC の「結果」の区画（順位・発表モード・共有リンク・配信ボード）
- `help.html` の更新
- 二巡目の行をこの表から増やすこと（二巡目は生成 API が作る。この表の「＋ 行を追加」と貼り付けは常に一巡目）
