# コート運用対応（同時採点・保存信頼性・選択保持）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 複数コート・複数端末での試し斬り採点運用に耐えるよう、書き込みの堅牢化・保存失敗の可視化と自動再送・コート絞り込みと選択状態の保持を実装する。

**Architecture:** サーバーは書き込みを一時ファイル経由のアトミック方式に統一し、同期実行という既存の安全性を回帰テストで固定する。クライアントは採点操作を `Outbox`（localStorage 退避つき送信キュー）経由に切り替え、`Route` が大会・コート選択を URL ハッシュと localStorage に保持し、`Courts` が選手データからコートを導出する。既存の IIFE モジュールパターンを踏襲する。

**Tech Stack:** Node.js 18 / Express 5（同期 `fs`、JSON ファイル永続化）、素の JavaScript（ES5 相当の IIFE、ビルド無し）、`test.html` によるブラウザ単体テスト。

**設計書:** [docs/superpowers/specs/2026-09-07-court-operation-reliability-design.md](../specs/2026-09-07-court-operation-reliability-design.md)

---

## 前提知識（この計画を実行する人へ）

このプロジェクトにはビルド工程もテストランナーもありません。以下を必ず理解してから着手してください。

**テストの動かし方**

1. サーバーを起動する（作業中は起動したままにする）:
   ```bash
   npm run dev
   ```
   `🎯 PHX Tameshigiri running at http://localhost:3457` が出れば成功。
2. ブラウザで `http://localhost:3457/test.html` を開く。
3. ページ末尾の `Result: N passed, M failed` を読む。**`M` が 0 であることが合格条件。**
4. テストを変更したら**ブラウザをリロード**する（サーバーは `Cache-Control: no-store` を送るので再起動は不要。ただし `server/index.js` を変更した場合はサーバーの再起動が必要）。

**サーバーの再起動方法**（`server/index.js` を変更したとき）

```bash
node -e "require('http').get('http://localhost:3457/api/events',r=>process.exit(0)).on('error',()=>process.exit(1))"
```
で生存確認できます。停止はサーバーを起動した端末で Ctrl+C、または以下:

```bash
npx --yes kill-port 3457
```

**モジュールの書き方**

すべて IIFE です。ES Modules や `class` は使いません。既存ファイルに合わせて `var` と `function` を使ってください。

```javascript
var Foo = (function() {
  function bar() { /* ... */ }
  return { bar: bar };
})();
```

**新規 JS ファイルを追加したら、それを使う HTML すべてに `<script>` タグを足すこと。** バンドラは無いので、書き忘れると `Foo is not defined` になります。読み込み順は依存関係順です。

**現状の到達点**

作業ツリーには DB 保存機能への移行（localStorage 廃止 → サーバー API）が未コミットで入っており、`test.html` は **40 passed, 0 failed** です。この計画を始める前に必ずこの状態を確認してください。

---

## ファイル構成

| ファイル | 責務 | 状態 |
|---|---|---|
| `server/index.js` | アトミック書き込み、同期実行の不変条件コメント、インポートの 409 ガード | 変更 |
| `api.js` | `importCsv` に `force` 引数を追加 | 変更 |
| `courts.js` | 選手データからコートを導出・絞り込む（純粋関数のみ） | **新規** |
| `route.js` | 大会・コート選択を URL ハッシュと localStorage に保持 | **新規** |
| `outbox.js` | 採点の送信キュー。集約・永続化・再送・状態通知 | **新規** |
| `app.js` | 画面制御。`Outbox` / `Route` / `Courts` の呼び出し、コート絞り込み | 変更 |
| `index.html` | コート選択、保存状態インジケータ、バナー、`<script>` 追加 | 変更 |
| `style.css` | `--warn` 変数、`.save-status` / `.save-banner` | 変更 |
| `techniques.html` | リセット失敗時の `alert` | 変更 |
| `test.html` | 追加テスト | 変更 |

> [!NOTE]
> **設計書からの逸脱**: 設計書のファイル表では新規ファイルを `outbox.js` / `route.js` の 2 つとしていましたが、
> コート導出を `route.js`（URL と localStorage の永続化が責務）に混ぜると 1 ファイル 2 責務になるため、
> `courts.js` を分離して 3 ファイルにします。どちらも純粋関数だけの小さなモジュールで、単体テストしやすくなります。

---

## Task 1: アトミック書き込み

書き込み中にプロセスが落ちてもファイルが壊れないよう、一時ファイル経由の書き込みに統一する。

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 現在のテストが緑であることを確認する**

`npm run dev` でサーバーを起動し、`http://localhost:3457/test.html` を開く。

Expected: `Result: 40 passed, 0 failed`

- [ ] **Step 2: `writeJsonAtomic` ヘルパを追加する**

`server/index.js` の `escapeCSV` 関数の直後（`// ミドルウェア` コメントの直前）に追加する。

```javascript
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
```

- [ ] **Step 3: すべての `writeFileSync` 呼び出しを置き換える**

`server/index.js` 内の以下 5 箇所（217/269/329/401/458 行目付近）を置き換える。置き換え対象は `JSON.stringify(..., null, 2)` を書いているものだけで、`writeJsonAtomic` 内の 1 箇所は当然そのまま残す。

置換前 → 置換後:

```javascript
// 1) POST /api/events
fs.writeFileSync(path.join(EVENTS_DIR, `${event.id}.json`), JSON.stringify(event, null, 2));
// ↓
writeJsonAtomic(path.join(EVENTS_DIR, `${event.id}.json`), event);

// 2) PATCH /api/events/:id/players/:playerId
fs.writeFileSync(eventPath, JSON.stringify(event, null, 2));
// ↓
writeJsonAtomic(eventPath, event);

// 3) POST /api/events/:id/import
fs.writeFileSync(eventPath, JSON.stringify(event, null, 2));
// ↓
writeJsonAtomic(eventPath, event);

// 4) POST /api/techniques
fs.writeFileSync(customPath, JSON.stringify(techniques, null, 2));
// ↓
writeJsonAtomic(customPath, techniques);

// 5) POST /api/events/:id/history
fs.writeFileSync(historyPath, JSON.stringify(data, null, 2));
// ↓
writeJsonAtomic(historyPath, data);
```

置換後、以下のコマンドで残りが無いことを確認する。

```bash
grep -n "fs.writeFileSync" server/index.js
```

Expected: `writeJsonAtomic` 関数内の 1 行だけがヒットする。

- [ ] **Step 4: サーバーを再起動してテストを実行する**

サーバーを Ctrl+C で止めて `npm run dev` で再起動し、`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 40 passed, 0 failed`

- [ ] **Step 5: 一時ファイルが残らないことを確認する**

```bash
find server/data -name "*.tmp"
```

Expected: 何も出力されない

- [ ] **Step 6: コミット**

```bash
git add server/index.js
git commit -m "fix: JSONの書き込みを一時ファイル経由のアトミック方式にする"
```

---

## Task 2: 同期実行の不変条件と並行 PATCH の回帰テスト

現在の同時採点の安全性は「書き込みハンドラが同期であること」に依存している。この前提を明文化し、テストで固定する。

**Files:**
- Modify: `server/index.js`
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests` 関数の末尾（`// 大会一覧テスト` ブロックの後、関数の閉じ括弧の直前）に追加する。

```javascript
    // 並行PATCHの回帰テスト
    // 書き込みハンドラが同期である限り、同時PATCHは取りこぼされない。
    // 将来ハンドラが async 化されるとこのテストが落ちる（不変条件の番人）。
    var raceEvent = await Api.saveEvent({ name: '並行テスト', date: '2026-01-01', venue: '', players: [] });
    var raceCsv = '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n';
    for (var ri = 1; ri <= 12; ri++) {
      raceCsv += 'P' + ri + ',A-男子-1-' + ri + ',真,,,0,,,\n';
    }
    await Api.importCsv(raceEvent.id, raceCsv, 'replace');
    var raceLoaded = await Api.loadEvent(raceEvent.id);
    var raceIds = raceLoaded.players.map(function(p) { return p.id; });
    await Promise.all(raceIds.map(function(pid, i) {
      return Api.updatePlayer(raceEvent.id, pid, { score: (i + 1) * 10, result: '' });
    }));
    var raceAfter = await Api.loadEvent(raceEvent.id);
    var raceExpected = raceIds.map(function(_, i) { return (i + 1) * 10; });
    assert('並行PATCH12本が全件反映される',
      raceAfter.players.map(function(p) { return p.score; }),
      raceExpected);
    await Api.deleteEvent(raceEvent.id);
```

- [ ] **Step 2: テストを実行して通ることを確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 41 passed, 0 failed`

> [!NOTE]
> このテストは**現状で通る**のが正しい。TDD の「まず落とす」には当たらない回帰テストであり、
> 目的は将来の非同期化を検知することにある。落ちた場合は Task 1 の変更を疑うこと。

- [ ] **Step 3: 不変条件のコメントを追加する**

`server/index.js` の `// ── Event API ──` コメントの直前に追加する。

```javascript
// 【不変条件】以下の書き込み系ハンドラは同期のまま維持すること。
// 同期 fs + 単一スレッドにより read-modify-write が不可分になっており、
// これが複数端末からの同時採点の安全性を担保している。
// async 化して await を挟むと、コートごとの端末が同時に採点したとき
// 更新が失われる。非同期化する場合は大会IDごとの書き込みロックを併せて導入すること。
// test.html の「並行PATCH12本が全件反映される」がこの不変条件の番人。
```

- [ ] **Step 4: サーバーを再起動してテストを実行する**

Expected: `Result: 41 passed, 0 failed`

- [ ] **Step 5: コミット**

```bash
git add server/index.js test.html
git commit -m "test: 並行PATCHの回帰テストと同期実行の不変条件コメントを追加"
```

---

## Task 3: CSV インポートによる採点済みデータ消失の防止

`mode=replace` は `players` を丸ごと置換するため、大会中に実行すると全コートの採点が消える。採点済みデータがある場合はサーバーが 409 で拒否し、件数を明示した確認を経た場合のみ実行する。

**Files:**
- Modify: `server/index.js`
- Modify: `api.js`
- Modify: `app.js`
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests` 内、Task 2 で追加した並行 PATCH テストの直後に追加する。

```javascript
    // インポートガードのテスト
    var guardEvent = await Api.saveEvent({ name: 'ガードテスト', date: '2026-01-01', venue: '', players: [] });
    var guardCsv = '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' +
                   '採点済,A-男子-1-1,真,,,30,,,1    \n';
    await Api.importCsv(guardEvent.id, guardCsv, 'replace');

    // 採点済みデータがある大会への replace は 409 で拒否される
    var blocked = await Api.importCsv(guardEvent.id, guardCsv, 'replace');
    assert('採点済み大会へのreplaceは拒否される', blocked.blocked, true);
    assert('拒否時に採点済み人数を返す', blocked.scoredCount, 1);

    // force を付ければ通る
    var forced = await Api.importCsv(guardEvent.id, guardCsv, 'replace', true);
    assert('forceを付けたreplaceは成功する', forced.success, true);

    // append は採点済みでも拒否しない
    var appended = await Api.importCsv(guardEvent.id, guardCsv, 'append');
    assert('appendは採点済みでも拒否しない', appended.success, true);

    await Api.deleteEvent(guardEvent.id);
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: FAIL。`採点済み大会へのreplaceは拒否される → got: undefined expected: true` が出る。

- [ ] **Step 3: サーバー側にガードを実装する**

`server/index.js` の `POST /api/events/:id/import` ハンドラ内、`const { csvText, mode } = req.body;` の行を以下に差し替える。

```javascript
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
```

さらに `escapeCSV` 関数の直後（`writeJsonAtomic` の隣）に判定ヘルパを追加する。

```javascript
// 採点済みかどうかの判定
// result は 1=○, 0=×, 空白=未入力 でエンコードされているため、
// 0 か 1 を含んでいれば何らかの採点が入っている。
function isScored(player) {
  if (!player) return false;
  if (typeof player.score === 'number' && player.score > 0) return true;
  return /[01]/.test(player.result || '');
}
```

- [ ] **Step 4: `api.js` に `force` を追加する**

`api.js` の `importCsv` 関数を以下に差し替える。

```javascript
  async function importCsv(eventId, csvText, mode, force) {
    // POST /api/events/:eventId/import
    // Body: { csvText, mode: 'replace' | 'append', force }
    // 戻り値: { success: true, playerCount } |
    //         { blocked: true, scoredCount } (409: 採点済みデータあり) | null
    var res = await fetch('/api/events/' + eventId + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText: csvText, mode: mode || 'replace', force: force === true })
    });
    if (res.status === 409) {
      var conflict = await res.json();
      return { blocked: true, scoredCount: conflict.scoredCount || 0 };
    }
    if (!res.ok) return null;
    return await res.json();
  }
```

- [ ] **Step 5: サーバーを再起動してテストを実行する**

Expected: `Result: 46 passed, 0 failed`

- [ ] **Step 6: `app.js` のインポート処理を 409 に対応させる**

`app.js` の `onCsvImport` 関数内、`var result = await Api.importCsv(currentEvent.id, text, mode);` の行を以下に差し替える。

```javascript
      var result = await Api.importCsv(currentEvent.id, text, mode);
      if (result && result.blocked) {
        var ok = confirm(
          'この大会には採点済みの選手が ' + result.scoredCount + ' 名います。\n' +
          '読み込みを続けると、これらの採点結果はすべて失われます。\n' +
          '本当に続行しますか？'
        );
        if (!ok) return;
        result = await Api.importCsv(currentEvent.id, text, mode, true);
      }
```

- [ ] **Step 7: 手動で確認する**

1. `http://localhost:3457/index.html` を開く
2. 「＋ 新規大会」で大会を作り、CSV インポートで `data_0.csv` を読み込む
3. 適当なセルをタップして採点する
4. もう一度 CSV インポートで `data_0.csv` を読み込み、「既存データをクリア」を選ぶ

Expected: 「この大会には採点済みの選手が 1 名います。…」という確認が出る。キャンセルすると採点が残る。

- [ ] **Step 8: コミット**

```bash
git add server/index.js api.js app.js test.html
git commit -m "feat: 採点済み大会へのCSV上書きインポートを確認付きで防止する"
```

---

## Task 4: `courts.js` — コート導出（純粋関数）

選手の `order` からコートを導出する純粋関数群。UI からもテストからも使える。

**Files:**
- Create: `courts.js`
- Modify: `index.html`
- Modify: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `<script src="storage.js"></script>` の**次の行**に読み込みを追加する。

```html
<script src="courts.js"></script>
```

`test.html` のメイン IIFE 内、`storage.js` のテストブロック（`assert('storage.js loadTheme default is light', ...)` の行）の直後に追加する。

```javascript
    var h2c = document.createElement('h2');
    h2c.textContent = 'courts.js';
    results.appendChild(h2c);

    assert('courtOf: A-男子-1-1 → A', Courts.courtOf({ order: 'A-男子-1-1' }), 'A');
    assert('courtOf: ハイフン無しはそのまま', Courts.courtOf({ order: 'B' }), 'B');
    assert('courtOf: 空のorderは未分類', Courts.courtOf({ order: '' }), Courts.UNASSIGNED);
    assert('courtOf: orderが無い場合も未分類', Courts.courtOf({}), Courts.UNASSIGNED);
    assert('courtOf: nullでも落ちない', Courts.courtOf(null), Courts.UNASSIGNED);

    var courtPlayers = [
      { order: 'B-男子-1-1' },
      { order: 'A-男子-1-1' },
      { order: 'A-女子-1-2' },
      { order: '' },
      { order: 'B-女子-1-1' }
    ];
    assert('listFrom: 重複を除き昇順、未分類は末尾',
      Courts.listFrom(courtPlayers), ['A', 'B', Courts.UNASSIGNED]);
    assert('listFrom: 未分類が無ければ含めない',
      Courts.listFrom([{ order: 'A-男子-1-1' }]), ['A']);
    assert('listFrom: 空配列は空配列', Courts.listFrom([]), []);

    assert('filter: 空文字は全件', Courts.filter(courtPlayers, '').length, 5);
    assert('filter: Aで2件', Courts.filter(courtPlayers, 'A').length, 2);
    assert('filter: 未分類で1件', Courts.filter(courtPlayers, Courts.UNASSIGNED).length, 1);
    assert('filter: 該当なしは空', Courts.filter(courtPlayers, 'Z').length, 0);
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: FAIL。ブラウザのコンソールに `Courts is not defined` が出て、テストが途中で止まる。

- [ ] **Step 3: `courts.js` を実装する**

新規ファイル `courts.js` を作成する。

```javascript
// 選手データからコートを導出する純粋関数群
// order は "A-男子-1-1"（コート-性別-巡目-番号）形式で、先頭セグメントがコート。
var Courts = (function() {
  var UNASSIGNED = '未分類';

  // 選手のコート名を返す。判定できない場合は UNASSIGNED。
  function courtOf(player) {
    var order = (player && player.order) || '';
    var m = order.match(/^([^-]+)/);
    return m ? m[1] : UNASSIGNED;
  }

  // 選手一覧から一意なコート名を昇順で返す。UNASSIGNED は末尾に置く。
  function listFrom(players) {
    var seen = {};
    var list = [];
    var hasUnassigned = false;
    (players || []).forEach(function(p) {
      var c = courtOf(p);
      if (c === UNASSIGNED) { hasUnassigned = true; return; }
      if (!seen[c]) { seen[c] = true; list.push(c); }
    });
    list.sort();
    if (hasUnassigned) list.push(UNASSIGNED);
    return list;
  }

  // 指定コートの選手だけを返す。court が空文字なら全件。
  function filter(players, court) {
    if (!court) return (players || []).slice();
    return (players || []).filter(function(p) { return courtOf(p) === court; });
  }

  return {
    UNASSIGNED: UNASSIGNED,
    courtOf: courtOf,
    listFrom: listFrom,
    filter: filter
  };
})();
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Expected: `Result: 58 passed, 0 failed`

- [ ] **Step 5: `index.html` に読み込みを追加する**

`index.html` の `<script src="scoring.js"></script>` の**次の行**に追加する。

```html
  <script src="courts.js"></script>
```

- [ ] **Step 6: 採点画面が壊れていないことを確認する**

`http://localhost:3457/index.html` を開き、ブラウザのコンソールにエラーが出ていないことを確認する。

Expected: エラー無し。大会を選ぶと従来どおり採点できる。

- [ ] **Step 7: コミット**

```bash
git add courts.js index.html test.html
git commit -m "feat: 選手データからコートを導出する courts.js を追加"
```

---

## Task 5: `route.js` — 選択状態の保持（純粋関数部分）

URL ハッシュの解析を先に純粋関数として作り、テストで固定する。

**Files:**
- Create: `route.js`
- Modify: `index.html`
- Modify: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `<script src="courts.js"></script>` の**次の行**に読み込みを追加する。

```html
<script src="route.js"></script>
```

`test.html` の `courts.js` テストブロックの直後に追加する。

```javascript
    var h2r = document.createElement('h2');
    h2r.textContent = 'route.js';
    results.appendChild(h2r);

    assert('parse: 大会とコート',
      Route.parse('#event/abc123/A'), { eventId: 'abc123', court: 'A' });
    assert('parse: 大会のみ',
      Route.parse('#event/abc123'), { eventId: 'abc123', court: '' });
    assert('parse: 先頭の#が無くても解釈する',
      Route.parse('event/abc123/B'), { eventId: 'abc123', court: 'B' });
    assert('parse: 日本語コート名をデコードする',
      Route.parse('#event/abc123/' + encodeURIComponent('未分類')),
      { eventId: 'abc123', court: '未分類' });
    assert('parse: 空文字はnull', Route.parse(''), null);
    assert('parse: #だけはnull', Route.parse('#'), null);
    assert('parse: 未知のスクリーンはnull', Route.parse('#foo/abc'), null);
    assert('parse: 大会IDが無ければnull', Route.parse('#event/'), null);
    assert('parse: 余分なセグメントは無視する',
      Route.parse('#event/abc/A/extra'), { eventId: 'abc', court: 'A' });

    assert('build: 大会とコート', Route.build('abc', 'A'), '#event/abc/A');
    assert('build: コート無し', Route.build('abc', ''), '#event/abc');
    assert('build: 日本語コート名をエンコードする',
      Route.build('abc', '未分類'), '#event/abc/' + encodeURIComponent('未分類'));
    assert('build: 大会IDが無ければ空', Route.build('', 'A'), '');
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Expected: FAIL。コンソールに `Route is not defined` が出る。

- [ ] **Step 3: `route.js` を実装する**

新規ファイル `route.js` を作成する。

```javascript
// 「どの大会・どのコートを見ているか」の保持
// URLハッシュ (#event/<eventId>/<court>) を正とし、localStorage に控えを置く。
// ハッシュが無いとき（ページ間リンクやドメイン直打ち）は控えから復帰する。
var Route = (function() {
  var LAST_KEY = 'tmg_last';

  // ハッシュ文字列を { eventId, court } に解析する。解釈できなければ null。
  function parse(hash) {
    if (!hash) return null;
    var body = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    if (!body) return null;
    var parts = body.split('/');
    if (parts[0] !== 'event') return null;
    var eventId = decodeURIComponent(parts[1] || '');
    if (!eventId) return null;
    return {
      eventId: eventId,
      court: decodeURIComponent(parts[2] || '')
    };
  }

  // { eventId, court } からハッシュ文字列を組み立てる。
  function build(eventId, court) {
    if (!eventId) return '';
    var hash = '#event/' + encodeURIComponent(eventId);
    if (court) hash += '/' + encodeURIComponent(court);
    return hash;
  }

  function loadLast() {
    try {
      var raw = localStorage.getItem(LAST_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.eventId) return null;
      return { eventId: obj.eventId, court: obj.court || '' };
    } catch (e) { return null; }
  }

  function saveLast(eventId, court) {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({
        eventId: eventId, court: court || ''
      }));
    } catch (e) {}
  }

  function clear() {
    try { localStorage.removeItem(LAST_KEY); } catch (e) {}
    if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  // 選択をURLと控えの両方に反映する。
  function set(eventId, court) {
    if (!eventId) { clear(); return; }
    var hash = build(eventId, court);
    if (location.hash !== hash) {
      history.replaceState(null, '', location.pathname + location.search + hash);
    }
    saveLast(eventId, court);
  }

  // ハッシュ → 控え の順で復帰する。どちらも無ければ null。
  function restore() {
    return parse(location.hash) || loadLast();
  }

  // ブラウザの戻る/進むに追従する。
  function onChange(fn) {
    window.addEventListener('hashchange', function() {
      fn(parse(location.hash));
    });
  }

  return {
    parse: parse,
    build: build,
    set: set,
    restore: restore,
    clear: clear,
    onChange: onChange
  };
})();
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Expected: `Result: 71 passed, 0 failed`

- [ ] **Step 5: `index.html` に読み込みを追加する**

`index.html` の `<script src="courts.js"></script>` の**次の行**に追加する。

```html
  <script src="route.js"></script>
```

- [ ] **Step 6: コミット**

```bash
git add route.js index.html test.html
git commit -m "feat: 大会・コート選択をURLとlocalStorageに保持する route.js を追加"
```

---

## Task 6: `outbox.js` — 送信キューの集約ロジック

キューへの積み方（同一選手は 1 件に畳む）を純粋関数として先に固める。

**Files:**
- Create: `outbox.js`
- Modify: `index.html`
- Modify: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `<script src="route.js"></script>` の**次の行**に読み込みを追加する。

```html
<script src="outbox.js"></script>
```

`test.html` の `route.js` テストブロックの直後に追加する。

```javascript
    var h2o = document.createElement('h2');
    h2o.textContent = 'outbox.js';
    results.appendChild(h2o);

    var e1 = { eventId: 'ev1', playerId: 'p1', score: 10, result: 'a', queuedAt: 't1' };
    var e2 = { eventId: 'ev1', playerId: 'p2', score: 20, result: 'b', queuedAt: 't2' };
    var e1b = { eventId: 'ev1', playerId: 'p1', score: 30, result: 'c', queuedAt: 't3' };

    assert('coalesce: 空キューに1件', Outbox.coalesce([], e1), [e1]);
    assert('coalesce: 別選手は併存する', Outbox.coalesce([e1], e2), [e1, e2]);
    assert('coalesce: 同一選手は最新で置き換える', Outbox.coalesce([e1, e2], e1b), [e1b, e2]);
    assert('coalesce: 置き換えても順序が保たれる',
      Outbox.coalesce([e1, e2], e1b).map(function(x) { return x.playerId; }),
      ['p1', 'p2']);
    assert('coalesce: 元の配列を破壊しない', (function() {
      var q = [e1];
      Outbox.coalesce(q, e1b);
      return q[0].score;
    })(), 10);

    var eOther = { eventId: 'ev2', playerId: 'p1', score: 40, result: 'd', queuedAt: 't4' };
    assert('coalesce: 大会が違えば別エントリ',
      Outbox.coalesce([e1], eOther).length, 2);
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Expected: FAIL。コンソールに `Outbox is not defined` が出る。

- [ ] **Step 3: `outbox.js` の骨格と `coalesce` を実装する**

新規ファイル `outbox.js` を作成する。この段階では集約と永続化だけを作り、送信ワーカーは Task 7 で足す。

```javascript
// 採点の送信キュー
// 採点セルの操作は通信を待たずにキューへ積み、送信は独立したワーカーが担う。
// 同一選手のエントリは常に1件に畳む（result は毎回全文なので最新だけ送れば足りる）。
// キューは localStorage に退避し、端末が落ちても次回起動時に再送する。
var Outbox = (function() {
  var STORAGE_KEY = 'tmg_outbox';

  var queue = [];

  // 同一の大会・選手のエントリを最新で置き換える。元の配列は変更しない。
  function coalesce(q, entry) {
    var next = (q || []).slice();
    for (var i = 0; i < next.length; i++) {
      if (next[i].eventId === entry.eventId && next[i].playerId === entry.playerId) {
        next[i] = entry;
        return next;
      }
    }
    next.push(entry);
    return next;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function save() {
    try {
      if (queue.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {}
  }

  function pendingCount() {
    return queue.length;
  }

  // init / enqueue / flushNow / status は Task 7 で追加する
  return {
    coalesce: coalesce,
    pendingCount: pendingCount
  };
})();
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Expected: `Result: 77 passed, 0 failed`

- [ ] **Step 5: `index.html` に読み込みを追加する**

`index.html` の `<script src="route.js"></script>` の**次の行**に追加する。`api.js` より後であれば順序は問わない。

```html
  <script src="outbox.js"></script>
```

- [ ] **Step 6: コミット**

```bash
git add outbox.js index.html test.html
git commit -m "feat: 送信キューの集約ロジック outbox.js を追加"
```

---

## Task 7: `outbox.js` — 送信ワーカーと状態通知

キューを実際に送るワーカー、指数バックオフ、状態通知を実装する。

**Files:**
- Modify: `outbox.js`

- [ ] **Step 1: ワーカーを実装する**

`outbox.js` を以下の内容に**全面的に差し替える**。Task 6 の `coalesce` はそのまま残っている。

```javascript
// 採点の送信キュー
// 採点セルの操作は通信を待たずにキューへ積み、送信は独立したワーカーが担う。
// 同一選手のエントリは常に1件に畳む（result は毎回全文なので最新だけ送れば足りる）。
// キューは localStorage に退避し、端末が落ちても次回起動時に再送する。
var Outbox = (function() {
  var STORAGE_KEY = 'tmg_outbox';
  var BACKOFF_MIN = 1000;
  var BACKOFF_MAX = 30000;
  var TICK_MS = 1000;

  var queue = [];
  var sending = false;       // 送信処理が走っている最中か
  var backoffMs = BACKOFF_MIN;
  var failingSince = null;   // 最初に失敗した時刻（復旧したら null に戻す）
  var retryTimer = null;     // バックオフ待ちのタイマー
  var tickTimer = null;      // 状態通知用の毎秒タイマー
  var statusHandler = null;

  // 同一の大会・選手のエントリを最新で置き換える。元の配列は変更しない。
  function coalesce(q, entry) {
    var next = (q || []).slice();
    for (var i = 0; i < next.length; i++) {
      if (next[i].eventId === entry.eventId && next[i].playerId === entry.playerId) {
        next[i] = entry;
        return next;
      }
    }
    next.push(entry);
    return next;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function save() {
    try {
      if (queue.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {}
  }

  function pendingCount() {
    return queue.length;
  }

  // 現在の状態。app.js はこれを見て表示を決める。
  function status() {
    var state = 'idle';
    if (queue.length > 0) state = failingSince ? 'retrying' : 'sending';
    return {
      state: state,
      pending: queue.length,
      failingSince: failingSince
    };
  }

  function notify() {
    if (statusHandler) statusHandler(status());
  }

  // キューが空でない間だけ毎秒通知する（バナー昇格の判定に使う）。
  function startTicking() {
    if (tickTimer) return;
    tickTimer = setInterval(function() {
      if (queue.length === 0) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      notify();
    }, TICK_MS);
  }

  // キューを先頭から順に送る。失敗したらバックオフして再挑戦する。
  async function drain() {
    if (sending) return;
    if (queue.length === 0) { notify(); return; }
    sending = true;
    notify();

    while (queue.length > 0) {
      var entry = queue[0];
      var ok = false;
      try {
        var result = await Api.updatePlayer(entry.eventId, entry.playerId, {
          score: entry.score,
          result: entry.result
        });
        ok = !!result;
      } catch (e) {
        ok = false;
      }

      if (ok) {
        // 送信済みのエントリだけを取り除く。
        // 送信中に同じ選手が再採点されていれば別オブジェクトに差し替わっているので、
        // 参照が一致するときだけ削除する（新しい採点を取りこぼさない）。
        if (queue[0] === entry) queue.shift();
        save();
        backoffMs = BACKOFF_MIN;
        failingSince = null;
        notify();
      } else {
        if (!failingSince) failingSince = Date.now();
        sending = false;
        notify();
        startTicking();
        scheduleRetry();
        return;
      }
    }

    sending = false;
    notify();
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function() {
      retryTimer = null;
      drain();
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
  }

  // 採点をキューに積む。通信は待たない。
  function enqueue(entry) {
    entry.queuedAt = new Date().toISOString();
    queue = coalesce(queue, entry);
    save();
    startTicking();
    drain();
  }

  // バックオフ待ちを打ち切って即座に送信を試みる。
  function flushNow() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    backoffMs = BACKOFF_MIN;
    drain();
  }

  // 起動時に呼ぶ。localStorage の残件があれば自動送信する。
  // 戻り値: 復元した件数（呼び出し元が「N件送信しました」を出すのに使う）
  function init(onStatusChange) {
    statusHandler = onStatusChange || null;
    queue = load();
    var recovered = queue.length;

    window.addEventListener('online', flushNow);

    if (recovered > 0) {
      startTicking();
      drain();
    } else {
      notify();
    }
    return recovered;
  }

  return {
    init: init,
    enqueue: enqueue,
    flushNow: flushNow,
    pendingCount: pendingCount,
    status: status,
    coalesce: coalesce
  };
})();
```

- [ ] **Step 2: テストを実行して既存テストが壊れていないことを確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 77 passed, 0 failed`

> [!NOTE]
> `test.html` は `api.js` を読み込んでいるので `Outbox` 内の `Api` 参照は解決できる。
> ワーカー自体はタイマーと通信に依存するため単体テストせず、Task 11 の手動確認で検証する。

> [!IMPORTANT]
> **既知の限界**: 送信先の選手がサーバー上から消えている場合（大会中に `force` 付きで
> CSV を再インポートした直後など）、そのエントリは 404 を返し続け、再送が止まらない。
> `Api.updatePlayer` は失敗の種類を区別せず `null` を返すため、恒久的失敗を判別できない。
> 赤バナーで採点係員に気付かせる設計なので実害は限定的だが、
> 頻発するようなら `Api.updatePlayer` に HTTP ステータスを返させて 404 を破棄する対応を検討すること。

- [ ] **Step 3: コミット**

```bash
git add outbox.js
git commit -m "feat: 送信キューのワーカーと指数バックオフを実装"
```

---

## Task 8: 保存状態インジケータとバナーの UI

**Files:**
- Modify: `style.css`
- Modify: `index.html`

- [ ] **Step 1: CSS 変数とスタイルを追加する**

`style.css` の `:root` ブロック内、`--score-color: #d35400;` の**次の行**に追加する。

```css
  --warn:         #b7791f;
```

`[data-theme="dark"]` ブロック内、`--score-color: #f1c40f;` の**次の行**に追加する。

```css
  --warn:         #f6ad55;
```

ファイル末尾に以下を追加する。

```css
/* ===== 保存状態の表示 ===== */
.save-status {
  margin-left: auto;
  font-size: 0.85rem;
  white-space: nowrap;
  color: var(--btn-success);
}
.save-status.sending { color: var(--text-muted); }
.save-status.retrying { color: var(--warn); font-weight: bold; }

.save-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--btn-fail);
  color: #ffffff;
  font-weight: bold;
}
.save-banner button {
  padding: 4px 12px;
  border: 1px solid #ffffff;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  border-radius: 4px;
}
.save-banner button:hover { background: rgba(255, 255, 255, 0.2); }
```

- [ ] **Step 2: `index.html` にインジケータとバナーを追加する**

`index.html` の大会選択バー（`<div class="event-bar">`）内、`<button id="btnDeleteEvent">大会削除</button>` の**次の行**に追加する。

```html
    <span class="save-status" id="saveStatus">● 保存済み</span>
```

`</div>`（event-bar の閉じ）の**次の行**に、バナーを追加する。

```html
  <!-- 保存失敗バナー -->
  <div class="save-banner" id="saveBanner" style="display:none">
    <span id="saveBannerText">⚠ サーバーに保存できていません</span>
    <button id="btnRetrySave">今すぐ再試行</button>
  </div>
```

- [ ] **Step 3: 表示を目視で確認する**

`http://localhost:3457/index.html` を開く。

Expected: 大会選択バーの右端に緑の `● 保存済み` が出ている。赤いバナーは出ていない。テーマを切り替えても文字が読める。

- [ ] **Step 4: コミット**

```bash
git add style.css index.html
git commit -m "feat: 保存状態インジケータと保存失敗バナーのUIを追加"
```

---

## Task 9: 採点保存を `Outbox` 経由に切り替える

**Files:**
- Modify: `app.js`

- [ ] **Step 1: `saveCurrentState` をキュー投入に変える**

`app.js` の `saveCurrentState` 関数を以下に差し替える。`async` を外し、通信を待たなくする。

```javascript
  // 現在の採点内容をキューに積む。通信は待たない（Outboxのワーカーが送る）。
  function saveCurrentState() {
    if (currentIndex < 0 || !visiblePlayers[currentIndex] || !currentEvent) return;
    var rows = scoreTableBody.querySelectorAll('tr');
    var rowDataArr = [];
    for (var i = 0; i < rows.length; i++) {
      var values = [];
      for (var s = 0; s < 4; s++) {
        var cell = rows[i].querySelector('[data-strike="' + s + '"]');
        values.push(cell && !cell.classList.contains('disabled') ? (cell.dataset.value || '') : '');
      }
      var tpCell = rows[i].querySelector('[data-strike="tp"]');
      rowDataArr.push({ values: values, techPoint: tpCell ? (tpCell.dataset.value || '') : '' });
    }
    var p = visiblePlayers[currentIndex];
    p.result = Scoring.encodeResult(rowDataArr);

    Outbox.enqueue({
      eventId: currentEvent.id,
      playerId: p.id,
      score: p.score,
      result: p.result
    });
  }
```

> [!IMPORTANT]
> この時点では `visiblePlayers` はまだ存在しない。Task 10 で導入するまで採点画面は動かない。
> Task 9 と Task 10 は続けて実施し、Task 10 の完了後にまとめて動作確認する。

- [ ] **Step 2: `saveCurrentState` の呼び出し側から `await` を外す**

`app.js` 内の以下 4 箇所を修正する。

```javascript
// 1) onStrikeClick 内
    await saveCurrentState();
// ↓
    saveCurrentState();

// 2) movePlayer 内
    await saveCurrentState();
// ↓
    saveCurrentState();

// 3) setAllSuccess 内
    await saveCurrentState();
// ↓
    saveCurrentState();

// 4) setAllFail 内
    await saveCurrentState();
// ↓
    saveCurrentState();
```

さらに `buildPlayerListRow` 内のクリックハンドラも修正する。

```javascript
    tr.addEventListener('click', async function() {
      var idx = parseInt(this.dataset.index, 10);
      await saveCurrentState();
      selectPlayer(idx);
    });
// ↓
    tr.addEventListener('click', function() {
      var idx = parseInt(this.dataset.index, 10);
      saveCurrentState();
      selectPlayer(idx);
    });
```

- [ ] **Step 3: 保存状態の表示処理を追加する**

`app.js` の `applyTheme` 関数の**直前**に追加する。

```javascript
  // --- 保存状態の表示 ---
  var saveStatusEl = document.getElementById('saveStatus');
  var saveBannerEl = document.getElementById('saveBanner');
  var saveBannerTextEl = document.getElementById('saveBannerText');
  var BANNER_AFTER_MS = 30000;

  function onSaveStatus(st) {
    if (!saveStatusEl) return;
    saveStatusEl.classList.remove('sending', 'retrying');
    if (st.state === 'idle') {
      saveStatusEl.textContent = '● 保存済み';
    } else if (st.state === 'sending') {
      saveStatusEl.textContent = '◌ 保存中…';
      saveStatusEl.classList.add('sending');
    } else {
      saveStatusEl.textContent = '⚠ 未保存 ' + st.pending + ' 件・再送中';
      saveStatusEl.classList.add('retrying');
    }

    // 最初の失敗から30秒経っても未保存が残っていればバナーに昇格する
    var stale = st.failingSince && (Date.now() - st.failingSince >= BANNER_AFTER_MS);
    if (st.pending > 0 && stale) {
      saveBannerTextEl.textContent =
        '⚠ サーバーに保存できていません（' + st.pending + '件未保存）';
      saveBannerEl.style.display = 'flex';
    } else {
      saveBannerEl.style.display = 'none';
    }
  }
```

- [ ] **Step 4: `init` で `Outbox` を起動する**

`app.js` の `init` 関数を以下に差し替える。

```javascript
  async function init() {
    applyTheme(Storage.loadTheme());
    // 技術データをAPIから取得してScoringに注入
    var techData = await Api.loadTechniques();
    if (techData && techData.techniques) {
      Scoring.setTechniques(techData.techniques);
    }
    // 送信キューを起動する。前回未送信の採点があればここで再送される。
    var recovered = Outbox.init(onSaveStatus);
    if (recovered > 0) {
      alert('前回未送信の採点 ' + recovered + ' 件を送信します。');
    }
    // 大会一覧を取得してドロップダウンに展開
    await refreshEventList();
    bindEvents();
  }
```

- [ ] **Step 5: バナーの再試行ボタンと離脱警告を登録する**

`app.js` の `bindEvents` 関数の末尾（閉じ括弧の直前）に追加する。

```javascript
    document.getElementById('btnRetrySave').addEventListener('click', function() {
      Outbox.flushNow();
    });

    // 未送信の採点があるときだけ離脱を警告する
    window.addEventListener('beforeunload', function(e) {
      if (Outbox.pendingCount() > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
```

- [ ] **Step 6: コミット（動作確認は Task 10 の後）**

```bash
git add app.js
git commit -m "feat: 採点の保存を送信キュー経由にし、保存状態を表示する"
```

---

## Task 10: コート絞り込みの導入

`players`（全件）と `visiblePlayers`（絞り込み後）を分け、巡回と一覧を後者に切り替える。

**Files:**
- Modify: `app.js`
- Modify: `index.html`

- [ ] **Step 1: `index.html` にコート選択を追加する**

`index.html` の `<select id="eventSelect">…</select>` の**次の行**に追加する。

```html
    <select id="courtSelect">
      <option value="">全コート</option>
    </select>
```

- [ ] **Step 2: 状態変数と DOM 参照を追加する**

`app.js` 冒頭の状態変数、`var players = [];` の**次の行**に追加する。

```javascript
  var visiblePlayers = [];   // 選択中コートで絞り込んだ選手（巡回・一覧の対象）
  var currentCourt = '';     // '' なら全コート
```

DOM 参照、`var playerListBody   = document.getElementById('playerListBody');` の**次の行**に追加する。

```javascript
  var courtSelect      = document.getElementById('courtSelect');
```

- [ ] **Step 3: コート選択の再構築と適用の関数を追加する**

`app.js` の `refreshEventList` 関数の**直前**に追加する。

```javascript
  // --- コート ---
  // 現在の大会の選手からコート選択肢を作り直す
  function refreshCourtList() {
    var list = Courts.listFrom(players);
    courtSelect.innerHTML = '<option value="">全コート</option>';
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement('option');
      opt.value = list[i];
      opt.textContent = list[i] === Courts.UNASSIGNED ? Courts.UNASSIGNED : list[i] + ' コート';
      courtSelect.appendChild(opt);
    }
    // 選択中のコートが今の大会に存在しなければ全コートへ戻す
    if (currentCourt && list.indexOf(currentCourt) === -1) {
      currentCourt = '';
    }
    courtSelect.value = currentCourt;
  }

  // 絞り込みを適用して画面を作り直す
  function applyCourtFilter() {
    visiblePlayers = Courts.filter(players, currentCourt);
    currentIndex = -1;
    if (visiblePlayers.length > 0) {
      selectPlayer(0);
    } else {
      scoreTableBody.innerHTML = '';
      totalScoreDisplay.textContent = '合計: 0点';
      playerNameLabel.textContent = players.length > 0
        ? '（このコートに選手がいません）'
        : '（選手がいません）';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = '';
    }
    refreshPlayerList();
  }
```

- [ ] **Step 4: `onEventSelect` を絞り込み対応にする**

`app.js` の `onEventSelect` 関数を以下に差し替える。

```javascript
  async function onEventSelect(eventId, court) {
    if (!eventId) {
      currentEvent = null;
      players = [];
      visiblePlayers = [];
      currentCourt = '';
      currentIndex = -1;
      refreshCourtList();
      scoreTableBody.innerHTML = '';
      totalScoreDisplay.textContent = '合計: 0点';
      playerNameLabel.textContent = '（大会を選択してください）';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = '';
      Route.clear();
      refreshPlayerList();
      return;
    }
    currentEvent = await Api.loadEvent(eventId);
    if (!currentEvent) {
      // 復元しようとした大会が既に削除されている
      Route.clear();
      document.getElementById('eventSelect').value = '';
      return;
    }
    players = currentEvent.players || [];
    if (court !== undefined) currentCourt = court;
    refreshCourtList();
    applyCourtFilter();
    Route.set(currentEvent.id, currentCourt);
  }
```

- [ ] **Step 5: `players[currentIndex]` を `visiblePlayers[currentIndex]` に置き換える**

`app.js` 内の以下を修正する。`saveCurrentState` は Task 9 で対応済み。

```javascript
// selectPlayer 内
    var p = players[index];
// ↓
    var p = visiblePlayers[index];

// movePlayer 内
    if (players.length === 0) return;
    ...
    if (next < 0 || next >= players.length) return;
// ↓
    if (visiblePlayers.length === 0) return;
    ...
    if (next < 0 || next >= visiblePlayers.length) return;

// onStrikeClick 内
    var p = players[currentIndex];
// ↓
    var p = visiblePlayers[currentIndex];

// updateTotal 内
    if (players[currentIndex] !== undefined) {
      players[currentIndex].score = total;
      updatePlayerListScore(currentIndex, total);
    }
// ↓
    if (visiblePlayers[currentIndex] !== undefined) {
      visiblePlayers[currentIndex].score = total;
      updatePlayerListScore(currentIndex, total);
    }

// setAllSuccess 内 / setAllFail 内（それぞれ1箇所ずつ）
    var p = players[currentIndex];
// ↓
    var p = visiblePlayers[currentIndex];

// renderPlayerList 内
    for (var i = 0; i < players.length; i++) {
// ↓
    for (var i = 0; i < visiblePlayers.length; i++) {

// buildPlayerListRow 内
    var p = players[index];
// ↓
    var p = visiblePlayers[index];
```

> [!NOTE]
> `visiblePlayers` は `players` の要素への参照を持つ配列なので、
> `visiblePlayers[i].score = ...` は `players` 側にも反映される。コピーではない。

- [ ] **Step 6: 全件を対象にする機能はそのままにする**

以下は **`players`（全件）のまま**にすること。誤って置き換えないよう確認する。

- `onCsvExport`：`if (players.length === 0)` の判定
- `onDownloadHtml`：`Storage.buildPlayersHtml(players)`
- `onGenNextRound`：`players.slice().sort(...)`（全選手の得点順で並べる必要がある）
- `onCsvImport`：`if (players.length > 0)` の判定（既存データの有無）

確認コマンド:

```bash
grep -n "players\[currentIndex\]\|players\.length\|players\.slice\|buildPlayersHtml" app.js
```

Expected: `visiblePlayers` でない `players` の参照は、上記 4 機能と `refreshCourtList` / `applyCourtFilter` 内のものだけ。

- [ ] **Step 7: `onCsvImport` の後処理を絞り込み対応にする**

`app.js` の `onCsvImport` 内、インポート成功後のブロックを以下に差し替える。

```javascript
      if (result && result.success) {
        // 大会データを再読み込み
        currentEvent = await Api.loadEvent(currentEvent.id);
        players = currentEvent.players || [];
        refreshCourtList();
        applyCourtFilter();
        // 履歴記録
        Api.addHistory(currentEvent.id, {
          action: 'csv_import',
          detail: result.playerCount + '名の選手データをインポート'
        });
      } else {
        alert('インポートに失敗しました。');
      }
```

- [ ] **Step 8: `onDeleteEvent` を絞り込み対応にする**

`app.js` の `onDeleteEvent` 関数を以下に差し替える。

```javascript
  async function onDeleteEvent() {
    if (!currentEvent) return;
    if (!confirm('大会「' + currentEvent.name + '」を削除します。よろしいですか？')) return;
    var ok = await Api.deleteEvent(currentEvent.id);
    if (!ok) { alert('大会の削除に失敗しました。'); return; }
    await refreshEventList();
    document.getElementById('eventSelect').value = '';
    await onEventSelect('');
  }
```

- [ ] **Step 9: コート選択のイベントを登録する**

`app.js` の `bindEvents` 内、`eventSelect` の `change` ハンドラの**次に**追加する。

```javascript
    courtSelect.addEventListener('change', function() {
      currentCourt = this.value;
      applyCourtFilter();
      if (currentEvent) Route.set(currentEvent.id, currentCourt);
    });
```

- [ ] **Step 10: 動作を確認する**

`http://localhost:3457/index.html` をリロードし、以下を確認する。

1. 大会を選ぶと、コート選択に「全コート」＋実在するコートが並ぶ
2. コートを選ぶと選手一覧と巡回がそのコート内で完結する
3. 「次の選手」を連打しても他コートの選手が出てこない
4. セルをタップすると `● 保存済み` のまま（送信が速いので `◌ 保存中…` は一瞬）
5. ブラウザのコンソールにエラーが出ていない

Expected: すべて満たす

- [ ] **Step 11: テストを実行する**

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 77 passed, 0 failed`

- [ ] **Step 12: コミット**

```bash
git add app.js index.html
git commit -m "feat: 採点画面にコート絞り込みを追加する"
```

---

## Task 11: 選択状態の復帰

**Files:**
- Modify: `app.js`

- [ ] **Step 1: `init` に復帰処理を追加する**

`app.js` の `init` 関数、`bindEvents();` の**次の行**に追加する。

```javascript

    // 選択状態を復帰する（URLハッシュ → localStorage の順）
    var restored = Route.restore();
    if (restored && restored.eventId) {
      document.getElementById('eventSelect').value = restored.eventId;
      await onEventSelect(restored.eventId, restored.court || '');
    }
    // ブラウザの戻る/進むに追従する
    Route.onChange(async function(sel) {
      if (!sel) { await onEventSelect(''); return; }
      document.getElementById('eventSelect').value = sel.eventId;
      await onEventSelect(sel.eventId, sel.court || '');
    });
```

- [ ] **Step 2: `eventSelect` の change ハンドラを修正する**

大会を切り替えたときはコート選択をリセットする。`app.js` の `bindEvents` 内、以下に差し替える。

```javascript
    document.getElementById('eventSelect').addEventListener('change', function() {
      currentCourt = '';   // 大会が変われば担当コートも選び直す
      onEventSelect(this.value, '');
    });
```

- [ ] **Step 3: `createEvent` の失敗時に警告を出す**

`app.js` の `createEvent` 関数を以下に差し替える。

```javascript
  async function createEvent(name, date, venue) {
    var event = {
      name: name,
      date: date,
      venue: venue,
      players: []
    };
    var result = await Api.saveEvent(event);
    if (!result || !result.id) {
      alert('大会の作成に失敗しました。');
      return;
    }
    await refreshEventList();
    document.getElementById('eventSelect').value = result.id;
    currentCourt = '';
    await onEventSelect(result.id, '');
  }
```

- [ ] **Step 4: `onCsvExport` の失敗時に警告を出す**

`app.js` の `onCsvExport` 関数を以下に差し替える。

```javascript
  async function onCsvExport() {
    if (!currentEvent) { alert('大会を選択してください。'); return; }
    if (players.length === 0) { alert('エクスポートするデータがありません。'); return; }
    var csvText = await Api.exportCsv(currentEvent.id);
    if (!csvText) { alert('エクスポートに失敗しました。'); return; }
    Storage.downloadCsv('players.csv', csvText);
  }
```

- [ ] **Step 5: 4 つの復帰経路を確認する**

| 経路 | 手順 | 期待 |
|---|---|---|
| リロード | 大会とコートを選び、F5 | 同じ大会・コートに戻る |
| ブックマーク | URL をコピーして新しいタブで開く | 同じ大会・コートで開く |
| ページ間移動 | 「順位表示」→「採点」リンク | 前回の大会・コートに戻る |
| ドメイン直打ち | `http://localhost:3457/` を開く | 前回の大会・コートに戻る |

さらに、**削除済み大会からの復帰**を確認する。

1. 大会を選び、URL をコピーする
2. その大会を削除する
3. コピーした URL を開く

Expected: エラーにならず「大会を選択してください」の未選択状態になる

- [ ] **Step 6: テストを実行する**

Expected: `Result: 77 passed, 0 failed`

- [ ] **Step 7: コミット**

```bash
git add app.js
git commit -m "feat: 大会・コート選択をリロードとページ間移動で復帰させる"
```

---

## Task 12: `techniques.html` のリセット失敗時の警告

**Files:**
- Modify: `techniques.html`

- [ ] **Step 1: リセットハンドラを修正する**

`techniques.html` 内のリセットボタンのハンドラを以下に差し替える。

```javascript
      document.getElementById('btnResetTech').addEventListener('click', async function() {
        if (!confirm('デフォルト設定に戻します。よろしいですか？')) return;
        var ok = await Api.resetTechniques();
        if (!ok) { alert('リセットに失敗しました。'); return; }
        var techData = await Api.loadTechniques();
        renderTable(techData ? techData.techniques : TECHNIQUES);
        alert('デフォルトに戻しました。');
      });
```

> [!NOTE]
> 併せて、リセット後の表示元をクライアント側の `TECHNIQUES` ではなく
> サーバーが返すデフォルトに変えている。両者が食い違ったときに気付けるようにするため。

- [ ] **Step 2: 動作を確認する**

`http://localhost:3457/techniques.html` を開き、「保存」→「デフォルトに戻す」を実行する。

Expected: 「デフォルトに戻しました。」が出て、表が 32 件のデフォルト技術に戻る

- [ ] **Step 3: コミット**

```bash
git add techniques.html
git commit -m "fix: 技術リストのリセット失敗時に警告を出す"
```

---

## Task 13: オフライン時の総合動作確認

実装が揃ったので、通信断のシナリオを通しで確認する。

**Files:** なし（確認のみ）

- [ ] **Step 1: オフラインでの採点を確認する**

1. `http://localhost:3457/index.html` で大会とコートを選ぶ
2. ブラウザの開発者ツール → Network タブ → Throttling を **Offline** にする
3. セルを 5 回タップする

Expected:
- タップの反応が遅くならない（通信を待っていない）
- インジケータが `⚠ 未保存 N 件・再送中` に変わる
- 30 秒後に赤いバナー `⚠ サーバーに保存できていません（N件未保存）` が出る

- [ ] **Step 2: 同一選手の集約を確認する**

オフラインのまま、**同じ選手の**セルを 10 回タップする。

Expected: 未保存件数が 1 のまま増えない（同一選手は 1 件に畳まれる）

- [ ] **Step 3: 復帰を確認する**

Throttling を **No throttling** に戻す。

Expected: 数秒以内にインジケータが `● 保存済み` に戻り、バナーが消える。ページをリロードすると採点が保持されている

- [ ] **Step 4: 離脱警告を確認する**

1. 再び Offline にしてセルをタップする
2. タブを閉じようとする

Expected: ブラウザの離脱確認ダイアログが出る。オンラインに戻して保存済みになった後は出ない

- [ ] **Step 5: クラッシュからの復帰を確認する**

1. Offline にしてセルを 3 回タップする（別々の選手）
2. 開発者ツールの Application → Local Storage に `tmg_outbox` が 3 件入っていることを確認する
3. Offline のままタブを閉じる（離脱警告は「閉じる」を選ぶ）
4. Online に戻してから `http://localhost:3457/index.html` を開き直す

Expected: 「前回未送信の採点 3 件を送信します。」が出て、直後にインジケータが `● 保存済み` になり、採点が反映されている

- [ ] **Step 6: 全テストを実行する**

Expected: `Result: 77 passed, 0 failed`

- [ ] **Step 7: 全画面の目視確認**

ライト／ダーク両テーマで以下を確認する。

- 採点画面：コート選択、保存インジケータが読める
- 順位表示：大会データの読み込みが従来どおり動く
- 技術リスト編集：保存とリセットが動く

- [ ] **Step 8: 確認結果をコミット（変更があれば）**

確認だけで変更が無ければコミットは不要。修正が必要になった場合はその修正をコミットする。

---

## 完了条件

- [ ] `test.html` が `Result: 77 passed, 0 failed`
- [ ] Task 13 の手動確認がすべて期待どおり
- [ ] `grep -n "fs.writeFileSync" server/index.js` が `writeJsonAtomic` 内の 1 件のみ
- [ ] `server/data` に `.tmp` ファイルが残っていない
