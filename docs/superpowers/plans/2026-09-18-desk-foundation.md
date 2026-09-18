# PC 運営の土台（`desk.html` の骨組み・大会一覧・コピー・基本情報・技と配点） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC（幅 1024px 以上）で大会を作って運営する画面 `desk.html` を新設し、大会一覧・新規作成・コピー・取り込み・アーカイブ・基本情報・技と配点までを動くようにする。選手・試合・結果の区画は入口（プレースホルダー）だけ置き、🖥/📱 でスマホ運営（`admin.html`）と行き来できるようにする。

**Architecture:** `desk.js` はスマホ運営の `admin.js` と同じ骨組み（`registerTab` / `applyRoute` / `renderSeq` / `ctx.isStale()` / 控え / `reloadEvent` / トースト / 共通ダイアログ）を持ち、ハッシュ体系だけが違う（`#events` / `#setup/<id>` / `#techniques/<id>` / `#players/<id>` / `#match/<id>` / `#results/<id>`）。区画の中身は `desk-*.js` が `Desk.registerTab` で登録する。状態の判定は計画1で入れた `status.js`（`EventStatus.*`）を必ず使い、状態の遷移は `Api.changeStatus` だけを通す。PC とスマホで二重実装にならないよう、段階表示の件数と遷移の確認文言は `courts.js` に寄せ、技リスト編集は `techniques.html` から `techedit.js` に切り出して両方から使う。

**Tech Stack:** 素の JavaScript（IIFE、`var`、`function`。`async`/`await` は可）、Express 5、`test.html`（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は `JSON.stringify` 比較）。

設計書: `docs/superpowers/specs/2026-09-18-pc-mode-and-event-status-design.md`（特に「全体構成」「API > コピー」「画面設計 > モードの切り替え」「画面設計 > PC 運営」「認証・静的配信」「テスト」の節）
前の計画: `docs/superpowers/plans/2026-09-18-event-status.md`（計画1。実装済み。`status.js` / 遷移 API / ロックガード / 採点画面の状態バナー / スマホ運営の段階表示）

この計画は設計書「実装の分割」の **計画2: PC 運営の土台** だけを扱う。計画3以降（`index.html` の作り直し、`scoring.html` への改名、PC の選手表と貼り付け、PC の試合と結果、ヘルプ）は**やらない**。
**採点画面のファイル名はこの計画でも `index.html` のまま**（改名は計画3）。採点画面を開く URL を組む場所は `desk.js` の `scoringHref` 1 箇所だけにして、改名時に直す旨をコメントに残す。

---

## 前提・共通の手順

- **サーバーの起動**: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。`.claude/launch.json` の `dev-3461` が同じ構成。既に起動していれば再利用する
- **サーバーを変えたら必ず再起動する**（`server/index.js` と `status.js` は `require` で読まれる）。JS/CSS/HTML の変更だけなら再起動は不要
- **自動テスト**: `http://localhost:3461/test.html` をブラウザで開き、ページ末尾の `Result: N passed, 0 failed` を確認する。編集後の再確認は同じ URL への再 navigate ではなく `location.reload()` か**新しいタブ**で行う（bfcache で古い JS が使われるため）
- **画面確認**: `http://localhost:3461/desk.html`（PC 運営。ウィンドウ幅 1280px）、`http://localhost:3461/admin.html`（スマホ運営。幅 375px）、`http://localhost:3461/techniques.html`（技術リスト編集。PC 幅とスマホ幅の両方）
- 確認に使う大会は**自分でこの作業中に作った大会だけ**にする。**本物の大会「第10回全日本試し斬り大会」のデータには絶対に触らない**（状態を進めたり選手を消したりしない）
- `git add` は**明示したファイルだけ**を対象にする（同じ作業ツリーで他の人の変更が入っていることがある。`git status` を見て他人のファイルを巻き込まない）
- コミットメッセージは日本語。接頭辞は `feat:` `fix:` `refactor:` `test:` `docs:`。末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける
- **作法**: IIFE、`var` と `function`、`async`/`await` は可。`await` の直後は必ず `ctx.isStale()`（区画）か `seq !== renderSeq`（骨組み）を見て、古い応答では DOM に触らない・`alert` も出さない
- **`desk.css` は `theme.css` の変数だけを使う**。`style.css` と `admin.css` は読まない。PC 幅は 1024px 以上を前提にし、1280px で横スクロールを作らない
- **状態の判定を直書きしない**（`event.status === 'final'` のような比較を書かず、`EventStatus.of` / `isLocked` / `next` / `prev` を使う）
- **設計書との差**: 設計書「上部の段階表示」は `round1_done` で「一巡目の技未入力の件数」と書いているが、一巡目終了は**二巡目の技を入れる段階**なので、計画1の実装（スマホ運営の進行タブ）どおり**二巡目**の技未入力を数える。PC とスマホで同じ関数（`Courts.stageCountText`）を使う

---

## ファイル構成

- **Create**: `desk.html` — PC 運営のページ。`theme.css` と `desk.css` だけを読む
- **Create**: `desk.css` — PC 運営の見た目。**Task 4 で全部書き、以降のタスクでは編集しない**（並行作業の衝突を避けるため。足りない見た目が出たら Task 4 の節に追記してからまとめて直す）
- **Create**: `desk.js` — 骨組み（ハッシュ・区画の登録と描画・上部の段階表示と遷移・共通ダイアログ・トースト・テーマ・📱）
- **Create**: `desk-events.js` — 大会一覧の表、新規作成、コピー、取り込み、アーカイブ、削除、ファイルに保存
- **Create**: `desk-setup.js` — 基本情報（名前・日付・会場）とコート一覧（読み取り）
- **Create**: `desk-techniques.js` — 技と配点（`techedit.js` を埋め込む）
- **Create**: `desk-players.js` — 選手（この計画では読み取り専用の表。編集は計画4）
- **Create**: `desk-match.js` — 試合（この計画ではプレースホルダー。計画5）
- **Create**: `desk-results.js` — 結果（この計画ではプレースホルダー。計画5）
- **Create**: `techedit.js` — 技リスト編集の描画と保存（`techniques.html` からの切り出し）。`TechEdit.mount(container, eventId, opts)`
- **Modify**: `storage.js` — `loadMode` / `saveMode` / `mapHash` / `modeHref` / `adminHref` / `todayLocal` / `pickJsonFile` / `checkBundle`
- **Modify**: `courts.js` — `isTechIncomplete` / `stageCountText` / `statusConfirmMessage`（`admin-round.js` から移す）
- **Modify**: `admin-round.js` — 移した関数を `Courts.*` から呼ぶ
- **Modify**: `admin-events.js` — `todayLocal` / ファイル選択 / バンドル検証を `Storage.*` に置き換える
- **Modify**: `admin.html` `admin.js` `admin.css` — ヘッダーに 🖥（PC 運営へ）
- **Modify**: `api.js` — `copyEvent(eventId, data)`
- **Modify**: `server/index.js` — `POST /api/events/:id/copy`
- **Modify**: `server/static-policy.js` — `PROTECTED_FILES` に新しいファイルを足す
- **Modify**: `techniques.html` — 編集ロジックを `techedit.js` に渡し、対象の選択とテーマだけを持つ
- **Modify**: `test.html` — `Storage` のモード（ハッシュ対応）、`Courts` の段階表示と確認文言、テスト 12（コピー）、`Storage.checkBundle`

---

## 並行できるタスク

- **Task 1 → 2 → 3** は順番に行う（3 つとも `test.html` を触るため）
- **Task 4 → 5** は単独（`desk.html` を作る／`<script>` を足す）
- **Task 5 の後**は次の組が並行できる（触るファイルが重ならない）:
  - **A**: Task 6（`desk.js`）
  - **B**: Task 7 → Task 8（`desk-events.js`。Task 8 は `storage.js` `admin-events.js` `test.html` も触る）
  - **C**: Task 9（`desk-setup.js`）
  - **D**: Task 10 → Task 11（`techedit.js` `techniques.html` → `desk-techniques.js` `desk.html`）
  - **E**: Task 12（`desk-players.js`）
  - **F**: Task 13（`admin.html` `admin.js` `admin.css`。Task 1 の後ならいつでも）
- `desk.html` を触るのは Task 4・5・11 だけ。`desk.css` を触るのは Task 4 だけ。この 2 つを守れば上の組は衝突しない

---

### Task 1: `storage.js` に運営モードとハッシュの対応を足す

PC 運営（`desk.html`）とスマホ運営（`admin.html`）は別ページで、ハッシュの語彙も一部違う（`#round` ⇔ `#match`）。どちらを開くか・ハッシュをどう読み替えるかを 1 箇所（`storage.js`）に置き、`admin.js` `desk.js`（と計画3の `index.html`）はそれを呼ぶだけにする。`todayLocal` も `admin-events.js` と `desk-events.js` で使うのでここへ移す。

**Files:**
- Modify: `storage.js`（`saveTheme` の直後に追記、`return {}` に公開を追加）
- Modify: `admin-events.js`（`todayLocal` を消して `Storage.todayLocal()` を呼ぶ）
- Modify: `test.html`（末尾の `storage.js` 節。`bundleFilename: null でも落ちない` の assert の直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `assert('bundleFilename: null でも落ちない', Storage.bundleFilename(null, null), 'tameshigiri_nodate_大会.json');` の直後（`await runApiTests();` の前）に足す。

```js
    // ---- 運営画面のモード（PC / スマホ）とハッシュの対応（設計書「モードの切り替え」） ----
    // 端末に控えてあるモードをテストで書き換えるので、最後に元へ戻す。
    var modeSaved = null;
    try { modeSaved = localStorage.getItem('tmg_mode'); } catch (e) {}

    assert('mapHash: #events はどちらのモードでも #events',
      [Storage.mapHash('#events', 'pc'), Storage.mapHash('#events', 'mobile')], ['#events', '#events']);
    assert('mapHash: 空のハッシュは #events', Storage.mapHash('', 'pc'), '#events');
    assert('mapHash: null でも #events', Storage.mapHash(null, 'pc'), '#events');
    assert('mapHash: 先頭の # は無くてもよい', Storage.mapHash('players/e1', 'pc'), '#players/e1');
    assert('mapHash: 大会IDの無い区画は #events に落とす', Storage.mapHash('#players', 'pc'), '#events');
    assert('mapHash: #players はどちらでもそのまま',
      [Storage.mapHash('#players/e1', 'pc'), Storage.mapHash('#players/e1', 'mobile')],
      ['#players/e1', '#players/e1']);
    assert('mapHash: #results はどちらでもそのまま',
      [Storage.mapHash('#results/e1', 'pc'), Storage.mapHash('#results/e1', 'mobile')],
      ['#results/e1', '#results/e1']);
    assert('mapHash: スマホの #round は PC の #match', Storage.mapHash('#round/e1', 'pc'), '#match/e1');
    assert('mapHash: PC の #match はスマホの #round', Storage.mapHash('#match/e1', 'mobile'), '#round/e1');
    assert('mapHash: #setup は PC ではそのまま', Storage.mapHash('#setup/e1', 'pc'), '#setup/e1');
    assert('mapHash: PC にしか無い #setup はスマホでは #players',
      Storage.mapHash('#setup/e1', 'mobile'), '#players/e1');
    assert('mapHash: PC にしか無い #techniques はスマホでは #players',
      Storage.mapHash('#techniques/e1', 'mobile'), '#players/e1');
    assert('mapHash: 知らない区画は #events', Storage.mapHash('#zzz/e1', 'pc'), '#events');
    assert('mapHash: 大会IDのエンコードはそのまま保つ',
      Storage.mapHash('#players/' + encodeURIComponent('a b'), 'pc'), '#players/a%20b');

    assert('modeHref: pc は desk.html', Storage.modeHref('#round/e1', 'pc'), 'desk.html#match/e1');
    assert('modeHref: mobile は admin.html', Storage.modeHref('#match/e1', 'mobile'), 'admin.html#round/e1');
    assert('modeHref: 知らないモードはスマホ扱い', Storage.modeHref('#events', 'zzz'), 'admin.html#events');

    Storage.saveMode('pc');
    assert('loadMode: 控えた値を返す', Storage.loadMode(), 'pc');
    assert('adminHref: 控えが pc なら desk.html', Storage.adminHref('#round/e1'), 'desk.html#match/e1');
    Storage.saveMode('mobile');
    assert('adminHref: 控えが mobile なら admin.html', Storage.adminHref('#setup/e1'), 'admin.html#players/e1');
    Storage.saveMode('zzz');
    assert('saveMode: 知らない値は控えない（前の値のまま）', Storage.loadMode(), 'mobile');
    try {
      if (modeSaved === null) localStorage.removeItem('tmg_mode');
      else localStorage.setItem('tmg_mode', modeSaved);
    } catch (e) {}

    assert('todayLocal: YYYY-MM-DD の形', /^\d{4}-\d{2}-\d{2}$/.test(Storage.todayLocal()), true);
```

- [ ] **Step 2: テストが落ちるのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result:` の行が出ない。ブラウザのコンソールに `TypeError: Storage.mapHash is not a function`（この節は `runApiTests()` の前にあるので、例外でページの実行が止まる）

- [ ] **Step 3: `storage.js` に実装する**

`storage.js` の `function saveTheme(theme) { … }` の閉じ括弧の直後（`// --- ダウンロードヘルパ ---` のコメントの直前）に足す。

```js
  // --- 運営画面のモード（PC / スマホ）---
  // 運営画面は desk.html（PC）と admin.html（スマホ）の 2 枚。どちらを開くかの控えと、
  // ハッシュの読み替えをここ 1 箇所に置く（admin.js・desk.js・計画3の index.html が使う）。
  var MODE_KEY = 'tmg_mode';
  var MODE_PAGES = { pc: 'desk.html', mobile: 'admin.html' };

  // 'pc' | 'mobile' | null（控えが無い＝まだ選んでいない）
  function loadMode() {
    try {
      var v = localStorage.getItem(MODE_KEY);
      return (v === 'pc' || v === 'mobile') ? v : null;
    } catch (e) {
      return null;
    }
  }

  function saveMode(mode) {
    if (mode !== 'pc' && mode !== 'mobile') return;   // 知らない値で控えを壊さない
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  }

  // ハッシュをそのモードの語彙に読み替える（設計書「モードの切り替え」の対応表）。
  //   #round/<id>（スマホ） ⇔ #match/<id>（PC）
  //   #setup/<id> #techniques/<id>（PC にしか無い） → スマホでは #players/<id>
  //   知らない区画・大会IDの無い区画・空 → #events
  // 大会IDはエンコードされたまま持ち回る（デコードして組み直すと二重エンコードになる）。
  function mapHash(hash, mode) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    if (!raw) return '#events';
    var parts = raw.split('/');
    var tab = parts[0];
    var id = parts[1] || '';
    if (tab === 'events') return '#events';
    if (!id) return '#events';
    if (mode === 'pc') {
      if (tab === 'round') tab = 'match';
      if (['setup', 'techniques', 'players', 'match', 'results'].indexOf(tab) === -1) return '#events';
    } else {
      if (tab === 'match') tab = 'round';
      if (tab === 'setup' || tab === 'techniques') tab = 'players';
      if (['players', 'round', 'results'].indexOf(tab) === -1) return '#events';
    }
    return '#' + tab + '/' + id;
  }

  // 指定したモードの運営画面の URL（ハッシュ付き）。'pc' 以外はスマホ扱い。
  function modeHref(hash, mode) {
    var m = (mode === 'pc') ? 'pc' : 'mobile';
    return MODE_PAGES[m] + mapHash(hash, m);
  }

  // いまの端末で開くべき運営画面の URL。控えが無ければ画面幅（1024px 以上を PC）で決める。
  function adminHref(hash) {
    var mode = loadMode();
    if (!mode) {
      var wide = false;
      try {
        wide = !!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches);
      } catch (e) {
        wide = false;
      }
      mode = wide ? 'pc' : 'mobile';
    }
    return modeHref(hash, mode);
  }

  // 今日の日付（YYYY-MM-DD）。toISOString は UTC なので JST の深夜に前日になる。
  // 新規大会・コピーのダイアログの初期値に使う（admin-events.js / desk-events.js 共用）。
  function todayLocal() {
    var d = new Date();
    var mm = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    if (mm.length < 2) mm = '0' + mm;
    if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
```

`storage.js` の `return {` に足す（`saveTheme: saveTheme,` の直後）。

```js
    loadMode: loadMode,
    saveMode: saveMode,
    mapHash: mapHash,
    modeHref: modeHref,
    adminHref: adminHref,
    todayLocal: todayLocal,
```

- [ ] **Step 4: `admin-events.js` の `todayLocal` を置き換える**

`admin-events.js` の次のブロックを削除する。

```js
  // toISOString は UTC なので JST の深夜に前日になる。ローカル日付を組み立てる。
  function todayLocal() {
    var d = new Date();
    var mm = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    if (mm.length < 2) mm = '0' + mm;
    if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
```

`openNewSheet` の中の 1 行を置き換える。置き換え前:

```js
    inDate.value = todayLocal();
```

置き換え後:

```js
    inDate.value = Storage.todayLocal();
```

- [ ] **Step 5: テストが通るのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`（N は Step 1 で足した分だけ増えている）

- [ ] **Step 6: スマホ運営の新規大会が壊れていないことを確認する**

`http://localhost:3461/admin.html#events` を新しいタブ・幅 375px で開き、「＋ 新規大会」を押す。
Expected: 日付欄に今日の日付が入っている（`Storage.todayLocal` 経由）。✕ で閉じる（大会は作らない）

- [ ] **Step 7: コミット**

```bash
git add storage.js admin-events.js test.html
git commit -m "feat: 運営画面のモードとハッシュの対応を storage.js に置く" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 段階表示の件数と遷移の確認文言を `courts.js` に寄せる

計画1で `admin-round.js` に入れた `stageCountText` / `advanceMessage` / `isTechIncomplete` は、PC 運営の上部の段階表示でもそのまま要る。文言を二重に持たないよう `courts.js`（`nextRoundConflictMessage` などの文言がすでに居る場所）へ移す。
`courts.js` は `EventStatus` を**呼び出し時に**参照する（読み込み順に依存しない）。この 3 つの関数を使うページは `status.js` も読むこと。

**Files:**
- Modify: `courts.js`（`nextRoundResultMessage` の直後、`return {` の直前）
- Modify: `admin-round.js`（`isTechIncomplete` / `stageCountText` / `advanceMessage` の削除と呼び出しの置き換え）
- Modify: `test.html`（`courts.js` 節の末尾＝`assert('sortBy: 元配列を変えない', …)` の直後、`var h2es = document.createElement('h2');` の直前）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `assert('sortBy: 元配列を変えない', ordersOf(sPlayers), ['A-男子-1-10', 'A-男子-1-2', 'B-男子-1-1']);` の直後に足す。

```js
    // ---- 段階表示の件数と遷移の確認文言（PC 運営と スマホ運営で共用） ----
    var tcP = [
      { order: 'A-男子-1-1', tech1: '真', tech2: '', tech3: '', score: 10 },  // 一巡目・採点済み・技未入力
      { order: 'A-男子-1-2', tech1: '真', tech2: '連', tech3: '左' },         // 一巡目・未採点・技あり
      { order: 'A-男子-2-1', tech1: '', tech2: '', tech3: '' }                // 二巡目・未採点・技未入力
    ];

    assert('isTechIncomplete: 3つ揃っていれば false', Courts.isTechIncomplete(tcP[1]), false);
    assert('isTechIncomplete: 1つでも空なら true', Courts.isTechIncomplete(tcP[0]), true);
    assert('isTechIncomplete: 全部空なら true', Courts.isTechIncomplete(tcP[2]), true);
    assert('isTechIncomplete: null でも落ちない', Courts.isTechIncomplete(null), true);

    assert('stageCountText: draft は一巡目の人数と技未入力',
      Courts.stageCountText('draft', tcP), '一巡目 2名　技 未入力 1');
    assert('stageCountText: round1 は一巡目の採点済み',
      Courts.stageCountText('round1', tcP), '採点済み 1 / 2');
    assert('stageCountText: round1_done は二巡目の人数と技未入力',
      Courts.stageCountText('round1_done', tcP), '二巡目 1名　技 未入力 1');
    assert('stageCountText: round2 は二巡目の採点済み',
      Courts.stageCountText('round2', tcP), '採点済み 0 / 1');
    assert('stageCountText: round2_done 以降は出さない',
      [Courts.stageCountText('round2_done', tcP), Courts.stageCountText('final', tcP),
       Courts.stageCountText('archived', tcP)], ['', '', '']);
    assert('stageCountText: players が無くても落ちない',
      Courts.stageCountText('round1', null), '採点済み 0 / 0');

    assert('statusConfirmMessage: draft → round1',
      Courts.statusConfirmMessage('draft', 'round1', tcP),
      '一巡目 2名。技が未入力の選手が 1名います。\n試合を開始しますか？');
    assert('statusConfirmMessage: round1 → round1_done',
      Courts.statusConfirmMessage('round1', 'round1_done', tcP),
      '一巡目の未採点が 1名います。\n一巡目を終了しますか？');
    assert('statusConfirmMessage: round1_done → round2',
      Courts.statusConfirmMessage('round1_done', 'round2', tcP),
      '二巡目 1名。技が未入力の選手が 1名います。\n二巡目を開始しますか？');
    assert('statusConfirmMessage: round1_done → final（二巡目なしで終了）',
      Courts.statusConfirmMessage('round1_done', 'final', tcP),
      '二巡目を行わずに最終結果にします。\nよろしいですか？');
    assert('statusConfirmMessage: round2 → round2_done',
      Courts.statusConfirmMessage('round2', 'round2_done', tcP),
      '二巡目の未採点が 1名います。\n二巡目を終了しますか？');
    assert('statusConfirmMessage: round2_done → final',
      Courts.statusConfirmMessage('round2_done', 'final', tcP),
      '得点・選手・技を編集できなくなります。\n最終結果を確定しますか？');
    assert('statusConfirmMessage: final → archived',
      Courts.statusConfirmMessage('final', 'archived', tcP),
      '一覧のアーカイブ欄に移り、採点画面の選択肢から消えます。\nアーカイブしますか？');
    assert('statusConfirmMessage: 戻すときは行き先のラベル',
      Courts.statusConfirmMessage('round1', 'draft', tcP), '準備中に戻します。よろしいですか？');
    assert('statusConfirmMessage: final から round1_done に戻す',
      Courts.statusConfirmMessage('final', 'round1_done', tcP), '一巡目終了に戻します。よろしいですか？');
```

- [ ] **Step 2: テストが落ちるのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result:` の行が出ない。コンソールに `TypeError: Courts.isTechIncomplete is not a function`

- [ ] **Step 3: `courts.js` に移す**

`courts.js` の `nextRoundResultMessage` の閉じ括弧の直後（`return {` の直前）に足す。

```js
  // ---- 大会の状態の段階表示（PC 運営の上部と スマホ運営の進行タブで共用） ----
  // EventStatus（status.js）は呼び出し時に参照する。この 3 つを使うページは
  // courts.js と status.js の両方を読むこと。

  // 技が3つ揃っていない行を「未入力」と数える（一巡目のデータは常に3つ入っている）。
  function isTechIncomplete(p) {
    return !p || !p.tech1 || !p.tech2 || !p.tech3;
  }

  // 段階表示に添える件数。
  //   進行中（round1 / round2）→ その巡目の「採点済み n / N」
  //   draft                    → これから採点する一巡目の人数と技未入力の件数
  //   round1_done              → これから採点する二巡目の人数と技未入力の件数
  //   round2_done 以降         → 出さない（数えるものが無い）
  function stageCountText(status, players) {
    var list = players || [];
    var r = EventStatus.scoringRound(status);
    if (r) {
      var rows = list.filter(function(p) { return roundOf(p) === r; });
      return '採点済み ' + rows.filter(isScored).length + ' / ' + rows.length;
    }
    if (status === 'draft') {
      var r1 = list.filter(function(p) { return roundOf(p) === 1; });
      return '一巡目 ' + r1.length + '名　技 未入力 ' + r1.filter(isTechIncomplete).length;
    }
    if (status === 'round1_done') {
      var r2 = list.filter(function(p) { return roundOf(p) === 2; });
      return '二巡目 ' + r2.length + '名　技 未入力 ' + r2.filter(isTechIncomplete).length;
    }
    return '';
  }

  // 状態を変える前の確認文言（設計書「確認と拒否」の表）。承諾したときだけ遷移する。
  // サーバーは硬い条件（選手0名・二巡目0件・遷移表にない組み合わせ）だけを 409 で拒むので、
  // 件数の警告はここで出す。
  function statusConfirmMessage(from, to, players) {
    var list = players || [];
    function round(n) { return list.filter(function(p) { return roundOf(p) === n; }); }
    if (from === 'draft' && to === 'round1') {
      var r1 = round(1);
      return '一巡目 ' + r1.length + '名。技が未入力の選手が ' +
        r1.filter(isTechIncomplete).length + '名います。\n試合を開始しますか？';
    }
    if (from === 'round1' && to === 'round1_done') {
      return '一巡目の未採点が ' + round(1).filter(function(p) { return !isScored(p); }).length +
        '名います。\n一巡目を終了しますか？';
    }
    if (from === 'round1_done' && to === 'round2') {
      var r2 = round(2);
      return '二巡目 ' + r2.length + '名。技が未入力の選手が ' +
        r2.filter(isTechIncomplete).length + '名います。\n二巡目を開始しますか？';
    }
    if (from === 'round1_done' && to === 'final') {
      return '二巡目を行わずに最終結果にします。\nよろしいですか？';
    }
    if (from === 'round2' && to === 'round2_done') {
      return '二巡目の未採点が ' + round(2).filter(function(p) { return !isScored(p); }).length +
        '名います。\n二巡目を終了しますか？';
    }
    if (to === 'final') {
      return '得点・選手・技を編集できなくなります。\n最終結果を確定しますか？';
    }
    if (to === 'archived') {
      return '一覧のアーカイブ欄に移り、採点画面の選択肢から消えます。\nアーカイブしますか？';
    }
    return EventStatus.LABELS[to] + 'に戻します。よろしいですか？';
  }
```

`courts.js` の `return {` に足す（`nextRoundResultMessage: nextRoundResultMessage` の行の末尾にカンマを足してから続ける）。

```js
    isTechIncomplete: isTechIncomplete,
    stageCountText: stageCountText,
    statusConfirmMessage: statusConfirmMessage
```

- [ ] **Step 4: `admin-round.js` から重複を消す**

次の 3 つを削除する（コメントごと）。

1. `isTechIncomplete`:

```js
  // 技が3つ揃っていない行を「未入力」と数える（一巡目のデータは常に3つ入っている）
  function isTechIncomplete(p) {
    return !p.tech1 || !p.tech2 || !p.tech3;
  }
```

2. `stageCountText`（`// --- 段階表示と遷移 ---` の見出しは残し、その下の `stageCountText` 関数だけを消す）:

```js
  // 「採点済み n / N」。進行中はその巡目、一巡目終了は二巡目の技の入力状況、
  // 二巡目終了以降は数を出さない（設計書「上部の段階表示」）。
  function stageCountText(st, players) {
    var r = EventStatus.scoringRound(st);
    if (r) {
      var rows = (players || []).filter(function(p) { return Courts.roundOf(p) === r; });
      return '採点済み ' + rows.filter(Courts.isScored).length + ' / ' + rows.length;
    }
    if (st === 'round1_done') {
      var r2 = roundTwo(players);
      return '二巡目 ' + r2.length + '名　技 未入力 ' + r2.filter(isTechIncomplete).length;
    }
    return '';
  }
```

3. `advanceMessage`（`// 設計書「確認と拒否」の表の確認文言。承諾したときだけ遷移する。` のコメントから、`return EventStatus.LABELS[to] + 'に戻します。よろしいですか？';` の下の閉じ括弧まで全部）。

残った参照を置き換える。

`applyStatus` の中:

```js
    if (!confirm(advanceMessage(from, to, ctx.players))) return;
```
→
```js
    if (!confirm(Courts.statusConfirmMessage(from, to, ctx.players))) return;
```

`render` の中:

```js
    stat.textContent = stageCountText(st, players);
```
→
```js
    stat.textContent = Courts.stageCountText(st, players);
```

`updateCounter` の中:

```js
    var n = rows.filter(isTechIncomplete).length;
```
→
```js
    var n = rows.filter(Courts.isTechIncomplete).length;
```

モジュールの公開から `isTechIncomplete` を外す（参照している場所は無い）。置き換え前:

```js
  return {
    render: render,
    isTechIncomplete: isTechIncomplete
  };
```

置き換え後:

```js
  return {
    render: render
  };
```

- [ ] **Step 5: テストが通るのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`

- [ ] **Step 6: スマホ運営の進行タブを確認する**

`http://localhost:3461/admin.html#events` を新しいタブ・幅 375px で開き、「＋ 新規大会」で「PC土台テスト」を作る（以降のタスクでもこの大会を使う）。選手タブで A コートに選手を 2 名足し、進行タブを開く。
Expected:
- 段階表示に「現在の状態: 準備中」と「試合開始 ▶」が出る
- その下の件数が `一巡目 2名　技 未入力 2`（**計画1では draft のとき空欄だった。`stageCountText` に draft の行を足したのでここが変わる。意図した変更**）
- 「試合開始 ▶」の確認文言が `一巡目 2名。技が未入力の選手が 2名います。／試合を開始しますか？`。キャンセルする
- ⋯ メニューに「二巡目を生成」が無効のまま残っていること（状態は準備中）

- [ ] **Step 7: コミット**

```bash
git add courts.js admin-round.js test.html
git commit -m "refactor: 段階表示の件数と遷移の確認文言を courts.js に寄せる" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 大会のコピー API（`POST /api/events/:id/copy` と `Api.copyEvent`。テスト 12）

設計書「API > コピー」。技と配点は必ず複製、選手は任意で**一巡目の行だけ**（得点は消す）。作られる大会は `draft`。アーカイブ済みの大会からもコピーできる（元は読むだけなのでロックガードは掛けない）。

**Files:**
- Modify: `server/index.js`（`DELETE /api/events/:id` のハンドラの直後、`// POST /api/events/:id/status` のコメントの直前）
- Modify: `api.js`（`deleteEvent` の直後に `copyEvent`、`return {` に公開）
- Modify: `test.html`（`runApiTests` の中。`// --- 大会のエクスポート（bundle。トラックB） ---` のコメントの直前）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `// --- 大会のエクスポート（bundle。トラックB） ---` の直前に足す。

```js
    // ---- 12. 大会のコピー ----
    var cpSrc = await Api.saveEvent({ name: 'コピー元', date: '2026-03-01', venue: '本部道場', players: [] });
    await Api.saveEventTechniques(cpSrc.id, [{ name: 'コピー技', strikes: [7, null, null, null] }]);
    var cpBulk = await Api.createPlayersBulk(cpSrc.id, {
      court: 'A', isFemale: false, isNewFace: true, names: ['写 一郎', '写 二郎']
    });
    await Api.updatePlayerInfo(cpSrc.id, cpBulk.players[0].id, {
      tech1: 'コピー技', score: 21, result: '11   ', note: 'メモ'
    });
    await Api.changeStatus(cpSrc.id, 'round1');
    await Api.changeStatus(cpSrc.id, 'round1_done');
    await Api.generateNextRound(cpSrc.id, true);   // 二巡目の行（コピーされないことの確認用）
    await Api.createShareLink(cpSrc.id);

    var cpRes = await Api.copyEvent(cpSrc.id,
      { name: '第11回コピー先', date: '2027-03-01', venue: '東京体育館', withPlayers: true });
    assert('copyEvent は新しい大会IDと人数を返す', [typeof cpRes.id, cpRes.playerCount], ['string', 2]);
    assert('コピー先のIDは元と違う', cpRes.id !== cpSrc.id, true);

    var cpNew = await Api.loadEvent(cpRes.id);
    assert('コピー先の名前・日付・会場はダイアログの入力',
      [cpNew.name, cpNew.date, cpNew.venue], ['第11回コピー先', '2027-03-01', '東京体育館']);
    assert('コピー先は draft', cpNew.status, 'draft');
    assert('技リストは同じ内容', cpNew.techniques, [{ name: 'コピー技', strikes: [7, null, null, null] }]);
    await Api.saveEventTechniques(cpRes.id, [{ name: '書き換え技', strikes: [1, null, null, null] }]);
    assert('技リストは別オブジェクト（コピー先を変えても元は変わらない）',
      (await Api.loadEvent(cpSrc.id)).techniques, [{ name: 'コピー技', strikes: [7, null, null, null] }]);

    assert('複製されるのは一巡目の行だけ', cpNew.players.length, 2);
    assert('複製された行はすべて一巡目',
      cpNew.players.filter(function(p) { return Courts.roundOf(p) !== 1; }).length, 0);
    var cpP = cpNew.players.filter(function(p) { return p.name === '写 一郎'; })[0];
    assert('名前・順番・技・新人・性別は引き継ぐ',
      [cpP.name, cpP.order, cpP.tech1, cpP.isNewFace, cpP.isFemale],
      ['写 一郎', 'A-男子-1-1', 'コピー技', true, false]);
    assert('得点・結果・備考は消える', [cpP.score, cpP.result, cpP.note], [0, '', '']);
    assert('選手IDは新しい', cpP.id !== cpBulk.players[0].id, true);
    assert('複製した選手IDも有効なID', /^[A-Za-z0-9_-]{1,64}$/.test(cpP.id), true);
    assert('sourcePlayerId は付けない', cpP.sourcePlayerId, undefined);
    assert('shareToken は引き継がない', cpNew.shareToken, undefined);
    assert('live は引き継がない', cpNew.live, undefined);
    assert('コピー先の履歴は空', (await Api.loadHistory(cpRes.id)).entries.length, 0);

    var cpNoP = await Api.copyEvent(cpSrc.id,
      { name: '選手なしコピー', date: '2027-03-02', venue: '', withPlayers: false });
    assert('withPlayers が false なら選手は0名', cpNoP.playerCount, 0);
    assert('withPlayers が false でも技リストは複製する',
      (await Api.loadEvent(cpNoP.id)).techniques, [{ name: 'コピー技', strikes: [7, null, null, null] }]);

    assert('大会名が空なら 400 の理由を返す',
      (await Api.copyEvent(cpSrc.id, { name: '  ' })).error, '大会名が不正です（1〜100文字）');
    assert('存在しない大会のコピーは 404 の理由を返す',
      (await Api.copyEvent('zzzzzzzznotexist', { name: 'x' })).error, '大会が見つかりません');

    await Api.changeStatus(cpSrc.id, 'final');
    await Api.changeStatus(cpSrc.id, 'archived');
    var cpArch = await Api.copyEvent(cpSrc.id,
      { name: 'アーカイブからコピー', date: '2027-03-03', venue: '', withPlayers: true });
    assert('アーカイブ済みの大会からもコピーできる',
      [typeof cpArch.id, cpArch.playerCount], ['string', 2]);

    await Api.deleteEvent(cpSrc.id);
    await Api.deleteEvent(cpRes.id);
    await Api.deleteEvent(cpNoP.id);
    await Api.deleteEvent(cpArch.id);
```

- [ ] **Step 2: テストが落ちるのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result:` の行が出ない。コンソールに `TypeError: Api.copyEvent is not a function`

- [ ] **Step 3: サーバーにコピーのハンドラを足す**

`server/index.js` の `// POST /api/events/:id/status : 大会の状態を進める・戻す` のコメントの直前に足す。

```js
// POST /api/events/:id/copy : 大会をコピーして新しい大会を作る
// 技と配点は必ず複製する。選手は withPlayers のときだけ、元の一巡目の行だけを複製し、
// 得点・結果・備考・補正・確定は落とす（来年の同じ大会を作るための機能）。
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
        .filter(p => p && typeof p === 'object' && !Array.isArray(p) && roundOf(p) === 1)
        .map(p => {
          let newId = generateId();
          while (used[newId]) newId = generateId();
          used[newId] = true;
          return {
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
            note: ''
          };
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
    writeJsonAtomic(path.join(EVENTS_DIR, `${id}.json`), event);
    res.status(201).json({ success: true, id: id, playerCount: players.length });
  } catch (err) {
    console.error('大会のコピーに失敗:', err);
    res.status(500).json({ error: '大会のコピーに失敗しました' });
  }
});
```

- [ ] **Step 4: `api.js` に `copyEvent` を足す**

`api.js` の `deleteEvent` の閉じ括弧の直後（`async function changeStatus` の直前）に足す。

```js
  async function copyEvent(eventId, data) {
    // POST /api/events/:eventId/copy
    // Body: { name, date, venue, withPlayers }
    // 戻り値: { id, playerCount } | { error }（400/404: 理由をダイアログに出す） | null（通信失敗）
    // 技と配点は必ず複製される。withPlayers が true のときだけ一巡目の選手も複製される
    // （得点は消える）。作られる大会は必ず draft。
    try {
      var res = await fetch('/api/events/' + eventId + '/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) return { error: await readErrorMessage(res) };
      var json = await res.json();
      return { id: json.id, playerCount: json.playerCount || 0 };
    } catch (e) {
      return null;
    }
  }
```

`api.js` の `return {` に足す（`deleteEvent: deleteEvent,` の直後）。

```js
    copyEvent: copyEvent,
```

- [ ] **Step 5: サーバーを再起動してテストが通るのを確認する**

サーバーのプロセスを止めて `PORT=3461 node server/index.js` で起動し直し、`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`

- [ ] **Step 6: コミット**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 大会のコピー API を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `desk.html` / `desk.css` / `desk.js` の骨組み

スマホ運営の `admin.js` と同じ骨組みを PC 用に作る。この時点では区画がまだ 1 つも登録されていないので、どのハッシュでも「この区画はまだ準備中です。」と出るのが正しい。
**`desk.css` はこの Task で全部書き、以降のタスクでは編集しない**（並行作業の衝突を避ける）。後のタスクはここで決めた class 名を使う。

**Files:**
- Create: `desk.html`
- Create: `desk.css`
- Create: `desk.js`
- Modify: `server/static-policy.js`（`PROTECTED_FILES`）

- [ ] **Step 1: `desk.html` を作る**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>試し斬り PC 運営</title>
  <link rel="stylesheet" href="theme.css">
  <link rel="stylesheet" href="desk.css">
</head>
<body data-theme="light">

  <header class="desk-top">
    <span class="desk-title" id="deskTitle">試し斬り 運営</span>
    <button id="btnTheme" class="desk-icon-btn" aria-label="テーマ切り替え">🌙</button>
    <button id="btnMobile" class="desk-icon-btn" aria-label="スマホ運営に切り替える" title="スマホ運営に切り替える">📱</button>
  </header>

  <!-- 1024px 未満でだけ出す案内（desk.css のメディアクエリ） -->
  <div class="desk-narrow" id="deskNarrow">
    <p>この画面は幅 1024px 以上の PC 向けです。スマホでは運営画面のスマホ版をお使いください。</p>
    <button type="button" class="desk-btn primary" id="btnNarrowSwitch">スマホ運営（admin.html）に切り替える</button>
  </div>

  <div class="desk-head" id="deskHead" hidden></div>

  <div class="desk-body">
    <nav class="desk-nav" id="deskNav"></nav>
    <main class="desk-main" id="deskMain"></main>
  </div>

  <div id="deskToast" class="desk-toast" hidden></div>

  <script src="api.js"></script>
  <script src="storage.js"></script>
  <script src="courts.js"></script>
  <script src="status.js"></script>
  <script src="desk.js"></script>

</body>
</html>
```

- [ ] **Step 2: `desk.css` を作る**

```css
/* PC 運営画面（desk.html）専用のスタイル。幅 1024px 以上を前提に組む。
   style.css / admin.css は読み込まない（採点画面・スマホ運営のレイアウトを持ち込まない）。
   色は theme.css の変数だけを使う。1280px で横スクロールを作らないこと。
   このファイルは計画2の Task 4 で書き切る。以降のタスクでは編集しない
   （区画ごとに CSS を足すと並行作業で衝突するため。足りない見た目が出たら
    計画の Task 4 の節に追記してからまとめて直す）。 */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: "Meiryo", "Yu Gothic", "ヒラギノ角ゴ Pro W3", sans-serif;
  font-size: 14px;
  line-height: 1.6;
  background: var(--bg);
  color: var(--text);
}

button { font-family: inherit; font-size: 14px; cursor: pointer; border: none; border-radius: 4px; }
input[type="text"], input[type="date"], input[type="number"], select, textarea {
  font-family: inherit; font-size: 14px; min-height: 34px; padding: 4px 8px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg); color: var(--text);
}
a { color: var(--accent); }

/* ===== 上部バー ===== */
.desk-top {
  display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 8px 0 16px;
  background: var(--band-bg); color: var(--band-text);
}
.desk-title { flex: 1; font-family: var(--mincho); font-size: 18px; font-weight: 700; color: var(--gold-light); }
.desk-icon-btn { width: 36px; height: 36px; font-size: 18px; background: transparent; color: var(--band-text); }
.desk-icon-btn:hover { background: var(--band-bg-2); }

/* ===== 大会の見出しと段階表示 ===== */
.desk-head { padding: 10px 16px; background: var(--bg-header); border-bottom: 1px solid var(--border); }
.desk-head-line { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.desk-head-name { font-size: 18px; font-weight: bold; }
.desk-head-meta { color: var(--text-muted); font-size: 13px; }
.desk-stage { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
.desk-stage-steps { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.desk-stage-step { font-size: 13px; color: var(--text-muted); white-space: nowrap; }
.desk-stage-step.done { color: var(--text); }
.desk-stage-step.on { color: var(--accent); font-weight: bold; font-size: 14px; }
.desk-stage-sep { color: var(--text-muted); }
.desk-stage-archived {
  padding: 1px 8px; border-radius: 10px; font-size: 12px;
  border: 1px solid var(--warn); color: var(--warn);
}
.desk-stage-count { font-size: 13px; color: var(--text-muted); }
.desk-stage-actions { margin-left: auto; display: flex; gap: 8px; }

/* ===== ボタン ===== */
.desk-btn {
  min-height: 34px; padding: 0 14px;
  background: var(--bg-secondary); color: var(--text); border: 1px solid var(--border);
}
.desk-btn:hover:not(:disabled) { border-color: var(--accent); }
.desk-btn.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: bold; }
.desk-btn.danger { background: var(--btn-fail); color: #fff; border-color: var(--btn-fail); }
.desk-btn:disabled { opacity: .5; cursor: not-allowed; }

/* ===== 本体（左の区画ナビ＋本文） ===== */
.desk-body { display: grid; grid-template-columns: 180px 1fr; align-items: start; min-height: calc(100vh - 48px); }
.desk-nav {
  display: flex; flex-direction: column; gap: 2px; padding: 12px 8px;
  border-right: 1px solid var(--border); background: var(--bg-secondary);
  position: sticky; top: 0;
}
.desk-nav button {
  text-align: left; min-height: 40px; padding: 0 12px; border-radius: 0;
  background: transparent; color: var(--text); border-left: 3px solid transparent;
}
.desk-nav button:hover:not(:disabled) { background: var(--card-bg); }
.desk-nav button.on { background: var(--card-bg); color: var(--accent); font-weight: bold; border-left-color: var(--accent); }
.desk-nav button:disabled { opacity: .45; cursor: not-allowed; }
.desk-nav-sep { height: 1px; background: var(--border); margin: 6px 4px; }
.desk-main { padding: 16px 20px 40px; min-width: 0; }

/* ===== 見出し・注記 ===== */
.desk-section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.desk-section-head h2 { font-size: 16px; }
.desk-section-head .spacer { flex: 1; }
.desk-empty { color: var(--text-muted); padding: 20px 0; }
.desk-note, .desk-warn { padding: 8px 10px; border-radius: 4px; font-size: 13px; margin-bottom: 12px; background: var(--card-bg); }
.desk-note { border: 1px solid var(--border); color: var(--text-muted); }
.desk-warn { border: 1px solid var(--warn); color: var(--warn); }

/* ===== 表 ===== */
.desk-table { border-collapse: collapse; width: 100%; background: var(--card-bg); }
.desk-table th, .desk-table td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; white-space: nowrap; }
.desk-table th { background: var(--bg-header); font-size: 13px; }
.desk-table td.num { text-align: right; }
.desk-table td.act { text-align: center; width: 48px; }
.desk-table tbody tr:hover { background: var(--row-selected); }
.desk-cell-main { font-weight: bold; }
.desk-badge {
  display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-muted);
}
.desk-badge.on { border-color: var(--accent); color: var(--accent); font-weight: bold; }

/* ===== 行の ⋯ メニュー ===== */
.desk-menu { position: relative; display: inline-block; }
.desk-menu > summary {
  list-style: none; cursor: pointer; width: 32px; height: 32px; line-height: 32px;
  text-align: center; border-radius: 4px; background: var(--bg-secondary); color: var(--text);
}
.desk-menu > summary::-webkit-details-marker { display: none; }
.desk-menu-body {
  position: absolute; right: 0; top: 34px; z-index: 20;
  display: flex; flex-direction: column; min-width: 190px; padding: 4px;
  background: var(--card-bg); border: 1px solid var(--border); border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,.25);
}
.desk-menu-body button {
  text-align: left; min-height: 36px; padding: 0 10px; white-space: nowrap;
  background: transparent; color: var(--text);
}
.desk-menu-body button:hover:not(:disabled) { background: var(--bg-secondary); }
.desk-menu-body button:disabled { opacity: .45; cursor: not-allowed; }

/* アーカイブ済みの折りたたみ（大会一覧） */
.desk-archived > summary {
  list-style: none; cursor: pointer; margin-top: 16px; padding: 8px 0;
  color: var(--text-muted); font-size: 13px;
}
.desk-archived > summary::-webkit-details-marker { display: none; }

/* ===== フォーム ===== */
.desk-form { display: grid; grid-template-columns: 120px 340px; gap: 10px 12px; align-items: center; margin-bottom: 16px; }
.desk-form label { color: var(--text-muted); }
.desk-form input, .desk-form select { width: 100%; }
.desk-form-actions { grid-column: 2; display: flex; gap: 8px; }
.desk-check { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; }

/* ===== ダイアログ ===== */
.desk-dialog-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.desk-dialog {
  display: flex; flex-direction: column; width: 480px; max-width: 92vw; max-height: 86vh;
  background: var(--card-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px;
}
.desk-dialog-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: bold; }
.desk-dialog-head .spacer { flex: 1; }
.desk-dialog-close { width: 32px; height: 32px; font-size: 16px; background: transparent; color: var(--text); }
.desk-dialog-body { padding: 16px; overflow: auto; }
.desk-dialog-body .desk-form { grid-template-columns: 100px 1fr; margin-bottom: 0; }
.desk-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }

/* ===== トースト ===== */
.desk-toast {
  position: fixed; right: 20px; bottom: 20px; z-index: 60;
  padding: 10px 16px; border-radius: 6px; font-weight: bold;
  background: var(--accent); color: var(--accent-text);
  box-shadow: 0 4px 12px rgba(0,0,0,.3);
}

/* ===== 技と配点（techedit.js が作る。class 名は techniques.html と同じ） ===== */
.tech-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.tech-title { font-size: 16px; margin-right: auto; }
.tech-note, .tech-warn { padding: 8px 10px; border-radius: 4px; font-size: 13px; margin-bottom: 12px; background: var(--card-bg); }
.tech-note { border: 1px solid var(--border); color: var(--text-muted); }
.tech-warn { border: 1px solid var(--warn); color: var(--warn); }
.tech-scroll { overflow-x: auto; }
.tech-table { border-collapse: collapse; width: 100%; background: var(--card-bg); }
.tech-table th, .tech-table td { border: 1px solid var(--border); padding: 4px 8px; text-align: center; }
.tech-table th { background: var(--bg-header); font-size: 13px; }
.tech-table td:first-child { text-align: left; }
.tech-table input[type="text"], .tech-table input[type="number"] { width: 70px; min-height: 28px; text-align: center; }
.tech-table td:first-child input[type="text"] { width: 180px; }
.btn-neutral { min-height: 34px; padding: 0 14px; background: var(--btn-neutral); color: #fff; }
.btn-fail { min-height: 34px; padding: 0 14px; background: var(--btn-fail); color: #fff; }
.btn-neutral:disabled, .btn-fail:disabled { opacity: .5; cursor: not-allowed; }
.tech-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
.tech-sheet {
  width: 480px; max-width: 92vw; max-height: 70vh; overflow-y: auto; padding: 16px;
  background: var(--card-bg); color: var(--text); border: 1px solid var(--border); border-radius: 8px;
}
.tech-sheet h3 { margin: 0 0 10px; font-size: 15px; }
.tech-sheet-item {
  display: block; width: 100%; min-height: 44px; text-align: left; padding: 0 12px; margin-bottom: 8px;
  background: var(--bg-secondary); color: var(--text);
}

/* ===== 狭い幅（スマホ運営への案内） ===== */
.desk-narrow { display: none; }
@media (max-width: 1023px) {
  .desk-narrow {
    display: flex; flex-direction: column; align-items: flex-start; gap: 12px;
    margin: 16px; padding: 16px; border: 1px solid var(--warn); border-radius: 6px;
    background: var(--card-bg); color: var(--warn);
  }
  .desk-head, .desk-body { display: none; }
}
```

- [ ] **Step 3: `desk.js` を作る**

```js
// PC 運営画面（desk.html）の骨組み。
// 区画の中身は desk-events.js / desk-setup.js / desk-techniques.js /
// desk-players.js / desk-match.js / desk-results.js が Desk.registerTab で登録する。
// 構造はスマホ運営の admin.js と同じ（registerTab / applyRoute / renderSeq /
// ctx.isStale / 控え / reloadEvent / トースト / 共通ダイアログ）。違うのはハッシュと見た目だけ。
//
// ハッシュ体系: #events / #setup/<id> / #techniques/<id> / #players/<id> / #match/<id> / #results/<id>
// 選択中の大会は localStorage の tmg_desk_last に控える（スマホ運営の tmg_admin_last、
// 採点画面の tmg_last とは分ける。別の端末で別の大会を見ていることがある）。
var Desk = (function() {
  var LAST_KEY = 'tmg_desk_last';
  var NAV = [
    { tab: 'events',     label: '大会一覧' },
    { tab: 'setup',      label: '基本情報' },
    { tab: 'techniques', label: '技と配点' },
    { tab: 'players',    label: '選手' },
    { tab: 'match',      label: '試合' },
    { tab: 'results',    label: '結果' }
  ];
  var TABS = NAV.map(function(n) { return n.tab; });

  var defs = {};
  var activeDef = null;    // いま描いている区画（DOM から外す前に destroy を呼ぶ）
  var main = null, head = null, nav = null;
  var currentTab = 'events';
  var selectedEventId = null;
  var currentEvent = null;   // 最後に読んだ大会（上部の見出しと段階表示が使う）
  var toastTimer = null;

  // 開いているダイアログのハンドル。ハッシュ遷移で古い ctx のまま残らないよう、
  // ルートが変わったら全部閉じる。
  var openDialogs = [];

  // 描画の再入ガード。Api.loadEvent の往復中に区画を切り替えられると、
  // 遅れて戻ってきた古い応答が新しい画面を上書きする。
  var renderSeq = 0;

  // --- 区画の登録 ---

  // def = { render: function(container, ctx), destroy: function()（省略可） }
  // ctx = { eventId, event, players, techniques, isStale }
  //   （events の区画では event / players / techniques は null）
  // ctx.isStale() — await の直後に見て true なら描画をやめる（alert も出さない）
  // destroy()     — その区画が DOM から外れる直前に呼ぶ後始末
  //                 （開きっぱなしのシートを閉じる、遅れて戻る応答を無視する、など）
  function registerTab(name, def) {
    defs[name] = def;
  }

  function destroyActive() {
    var def = activeDef;
    activeDef = null;
    if (def && typeof def.destroy === 'function') {
      try { def.destroy(); } catch (e) { console.error(e); }
    }
  }

  // --- ハッシュ ---

  function parseHash(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    if (!raw) return null;
    var parts = raw.split('/');
    if (TABS.indexOf(parts[0]) === -1) return null;
    var id = '';
    if (parts[1]) {
      try { id = decodeURIComponent(parts[1]); } catch (e) { return null; }
    }
    return { tab: parts[0], eventId: id };
  }

  function buildHash(tab, eventId) {
    if (tab === 'events' || !eventId) return '#' + tab;
    return '#' + tab + '/' + encodeURIComponent(eventId);
  }

  function loadLast() {
    try {
      var raw = localStorage.getItem(LAST_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || TABS.indexOf(v.tab) === -1) return null;
      if (v.tab !== 'events' && !v.eventId) return null;
      return { tab: v.tab, eventId: v.eventId || '' };
    } catch (e) {
      return null;
    }
  }

  function saveLast() {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({
        tab: currentTab,
        eventId: selectedEventId || ''
      }));
    } catch (e) {}
  }

  // --- 遷移 ---

  function navigate(tab, eventId) {
    var id = (eventId === undefined || eventId === null) ? selectedEventId : eventId;
    var hash = buildHash(tab, id);
    if (location.hash === hash) {
      applyRoute().catch(function(e) { console.error(e); });   // 同じハッシュでは hashchange が出ない
    } else {
      location.hash = hash;   // hashchange → applyRoute
    }
  }

  // ユーザー操作を経ない自動の戻し用。履歴に積まない
  // （戻るボタンで #setup → #events → #setup … と往復してしまう）。
  function redirect(tab, eventId) {
    var id = (eventId === undefined || eventId === null) ? selectedEventId : eventId;
    var hash = buildHash(tab, id);
    if (location.hash === hash) {
      applyRoute().catch(function(e) { console.error(e); });
    } else {
      location.replace(location.pathname + location.search + hash);
    }
  }

  async function applyRoute() {
    closeAllDialogs();
    destroyActive();
    // ダイアログの onClose が起動する reloadEvent を、これから描く画面より古い扱いにする
    renderSeq++;
    var route = parseHash(location.hash);
    if (!route) {
      // ハッシュが無いときは前回の続きから。それも無ければ大会一覧。
      var last = loadLast() || { tab: 'events', eventId: '' };
      redirect(last.tab, last.eventId);
      return;
    }
    if (route.tab !== 'events' && !route.eventId) {
      toast('先に大会を選んでください');
      redirect('events');
      return;
    }

    currentTab = route.tab;
    selectedEventId = route.eventId || null;
    if (currentTab === 'events') {
      currentEvent = null;
      saveLast();
    }
    renderNav();

    var seq = ++renderSeq;
    if (currentTab === 'events') {
      renderHead(null);
      renderTab(seq, { eventId: null, event: null, players: null, techniques: null });
      return;
    }

    main.innerHTML = '';
    var loading = document.createElement('p');
    loading.className = 'desk-empty';
    loading.textContent = '読み込み中…';
    main.appendChild(loading);

    var ev = await Api.loadEvent(selectedEventId);
    if (seq !== renderSeq) return;   // 追い越された
    if (!ev) {
      alert('大会データを取得できませんでした。通信を確認してください。');
      redirect('events');
      return;
    }
    currentEvent = ev;
    saveLast();
    renderHead(ev);
    renderTab(seq, {
      eventId: selectedEventId, event: ev, players: ev.players || [],
      techniques: Array.isArray(ev.techniques) ? ev.techniques : null
    });
  }

  // 現在の大会を読み直して、いま開いている区画を描き直す
  async function reloadEvent() {
    if (currentTab === 'events' || !selectedEventId) return;
    var seq = ++renderSeq;
    var ev = await Api.loadEvent(selectedEventId);
    if (seq !== renderSeq) return;
    if (!ev) {
      alert('大会データを取得できませんでした。通信を確認してください。');
      return;
    }
    currentEvent = ev;
    renderHead(ev);
    renderTab(seq, {
      eventId: selectedEventId, event: ev, players: ev.players || [],
      techniques: Array.isArray(ev.techniques) ? ev.techniques : null
    });
  }

  async function renderTab(seq, ctx) {
    destroyActive();
    var def = defs[currentTab];
    main.innerHTML = '';
    if (!def) {
      var p = document.createElement('p');
      p.className = 'desk-empty';
      p.textContent = 'この区画はまだ準備中です。';
      main.appendChild(p);
      return;
    }
    activeDef = def;
    // 区画の render が await をまたぐ間に区画や大会を切り替えられたかどうか。
    // 各区画は await の直後にこれを見て、古ければ描画をやめる。
    ctx.isStale = function() { return seq !== renderSeq; };
    try {
      await def.render(main, ctx);
    } catch (e) {
      if (seq !== renderSeq) return;   // 古い描画の失敗は無視する
      console.error(e);
      main.innerHTML = '';
      var err = document.createElement('p');
      err.className = 'desk-empty';
      err.textContent = '画面の表示に失敗しました。区画を選び直してください。';
      main.appendChild(err);
    }
  }

  function currentEventId() {
    return selectedEventId || null;
  }

  // --- 画面の共通部品 ---

  // 上部の大会の見出し。大会一覧では隠す。
  function renderHead(event) {
    head.innerHTML = '';
    if (!event) {
      head.hidden = true;
      return;
    }
    head.hidden = false;
    var line = document.createElement('div');
    line.className = 'desk-head-line';
    var name = document.createElement('span');
    name.className = 'desk-head-name';
    name.textContent = event.name || '(名称未設定)';
    var meta = document.createElement('span');
    meta.className = 'desk-head-meta';
    meta.textContent = (event.date || '日付なし') + '　' + (event.venue || '会場未設定');
    line.appendChild(name);
    line.appendChild(meta);
    head.appendChild(line);
  }

  function renderNav() {
    nav.innerHTML = '';
    NAV.forEach(function(item, i) {
      if (i === 1) {
        var sep = document.createElement('div');
        sep.className = 'desk-nav-sep';
        nav.appendChild(sep);
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = (item.tab === currentTab) ? 'on' : '';
      b.textContent = item.label;
      // 大会を開くまでは大会一覧しか使えない（どの大会を描くのか決まらない）
      if (item.tab !== 'events' && !selectedEventId) {
        b.disabled = true;
        b.title = '大会一覧から大会を開いてください';
      } else {
        b.addEventListener('click', function() { navigate(item.tab, selectedEventId); });
      }
      nav.appendChild(b);
    });
  }

  function toast(msg) {
    var el = document.getElementById('deskToast');
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.hidden = true; }, 2000);
  }

  // 共通ダイアログ（新規作成・コピーなど）。スマホ運営の Admin.openSheet と同じ契約。
  // onClose はどの経路で閉じても（✕・外側クリック・close()・closeAllDialogs()）1回だけ呼ばれる。
  // onClose の中でサーバーに書き込まないこと（古い ctx で書いてしまう）。
  // 戻り値: { close, lock }
  //   close()    : 閉じる
  //   lock(flag) : true の間は ✕ と外側クリックで閉じない（保存の通信中に入力を失わないため）
  function openDialog(titleText, bodyEl, buttons, onClose) {
    var overlay = document.createElement('div');
    overlay.className = 'desk-dialog-overlay';
    var box = document.createElement('div');
    box.className = 'desk-dialog';

    var headEl = document.createElement('div');
    headEl.className = 'desk-dialog-head';
    var title = document.createElement('span');
    title.textContent = titleText;
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'desk-dialog-close';
    btnClose.textContent = '✕';
    headEl.appendChild(title);
    headEl.appendChild(spacer);
    headEl.appendChild(btnClose);

    var body = document.createElement('div');
    body.className = 'desk-dialog-body';
    body.appendChild(bodyEl);

    var actions = document.createElement('div');
    actions.className = 'desk-dialog-actions';
    buttons.forEach(function(b) { actions.appendChild(b); });

    box.appendChild(headEl);
    box.appendChild(body);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var closed = false;
    var locked = false;
    function close() {
      if (closed) return;
      closed = true;
      var i = openDialogs.indexOf(handle);
      if (i >= 0) openDialogs.splice(i, 1);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (onClose) onClose();
    }
    function tryClose() {
      if (!locked) close();
    }
    btnClose.addEventListener('click', tryClose);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) tryClose();
    });
    var handle = {
      close: close,
      lock: function(flag) {
        locked = !!flag;
        btnClose.disabled = !!flag;
      }
    };
    openDialogs.push(handle);
    return handle;
  }

  // 戻るボタンなどでハッシュが変わったら、前の画面のダイアログを残さない
  // （古い ctx で保存してしまう）。lock 中でも問答無用で閉じる。
  function closeAllDialogs() {
    openDialogs.slice().forEach(function(d) { d.close(); });
  }

  // 採点画面のハッシュ（route.js の Route.build と同じ形。desk.html は route.js を読まない）。
  // ★計画3で採点画面を scoring.html に改名する。そのときここの 'index.html' を
  //   'scoring.html' に直すこと。PC 運営で採点画面の URL を知っているのはこの関数だけ。
  function scoringHref(eventId, court) {
    if (!eventId) return 'index.html';
    var hash = '#event/' + encodeURIComponent(eventId);
    if (court) hash += '/' + encodeURIComponent(court);
    return 'index.html' + hash;
  }

  // 採点画面を別ウィンドウで開く。コートごとに窓の名前を変え、同じコートは同じ窓を使い回す。
  // ポップアップが塞がれていたら（戻り値 null）開き直し方を案内する。
  function openScoring(eventId, court) {
    var name = court ? 'tmg_scoring_' + court : 'tmg_scoring';
    var w = window.open(scoringHref(eventId, court), name);
    if (!w) {
      alert('採点画面を開けませんでした。\nポップアップを許可するか、「試合」の区画から開いてください。');
    }
    return w;
  }

  // --- テーマとモード ---

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀' : '🌙';
  }

  // スマホ運営へ。いま見ている区画に対応するハッシュを持っていく（storage.js の対応表）。
  function toMobile() {
    Storage.saveMode('mobile');
    location.href = Storage.modeHref(location.hash, 'mobile');
  }

  // --- 起動 ---

  function init() {
    // test.html は desk.html の DOM を持たない。desk.js を読み込ませても落ちないようにする。
    if (!document.getElementById('deskMain')) return;
    main = document.getElementById('deskMain');
    head = document.getElementById('deskHead');
    nav = document.getElementById('deskNav');

    applyTheme(Storage.loadTheme());
    document.getElementById('btnTheme').addEventListener('click', function() {
      var next = Storage.loadTheme() === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });
    document.getElementById('btnMobile').addEventListener('click', toMobile);
    document.getElementById('btnNarrowSwitch').addEventListener('click', toMobile);

    window.addEventListener('hashchange', function() { applyRoute().catch(function(e) { console.error(e); }); });
    applyRoute().catch(function(e) { console.error(e); });
  }

  // 各区画の登録（desk-events.js など）はスクリプト読み込み時に済むので、
  // DOMContentLoaded の時点では defs がそろっている。
  document.addEventListener('DOMContentLoaded', init);

  return {
    registerTab: registerTab,
    navigate: navigate,
    reloadEvent: reloadEvent,
    currentEventId: currentEventId,
    toast: toast,
    openDialog: openDialog,
    closeAllDialogs: closeAllDialogs,
    scoringHref: scoringHref,
    openScoring: openScoring
  };
})();
```

- [ ] **Step 4: 静的配信の許可リストに足す**

`server/static-policy.js` の `PROTECTED_FILES` を置き換える。置き換え前:

```js
const PROTECTED_FILES = new Set([
  'index.html', 'admin.html', 'ranking.html', 'techniques.html',
  'style.css', 'admin.css',
  'app.js', 'admin.js', 'admin-events.js', 'admin-players.js', 'admin-round.js', 'admin-results.js',
  'courts.js', 'data.js', 'outbox.js', 'route.js', 'status.js', 'storage.js', 'techpicker.js'
]);
```

置き換え後（`scoring.html` と `home.js` は計画3で足す）:

```js
const PROTECTED_FILES = new Set([
  'index.html', 'admin.html', 'desk.html', 'ranking.html', 'techniques.html',
  'style.css', 'admin.css', 'desk.css',
  'app.js', 'admin.js', 'admin-events.js', 'admin-players.js', 'admin-round.js', 'admin-results.js',
  'desk.js', 'desk-events.js', 'desk-setup.js', 'desk-techniques.js',
  'desk-players.js', 'desk-match.js', 'desk-results.js', 'techedit.js',
  'courts.js', 'data.js', 'outbox.js', 'route.js', 'status.js', 'storage.js', 'techpicker.js'
]);
```

- [ ] **Step 5: サーバーを再起動して配信を確認する**

サーバーを再起動してから:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3461/desk.html
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3461/desk.css
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3461/desk.js
```

Expected: 3 行とも `200`（`.env` があって Basic 認証が掛かっている場合は `401`。その場合は `-u "$AUTH_USER:$AUTH_PASS"` を付けて `200` を確認する）

- [ ] **Step 6: 画面で確認する**

`http://localhost:3461/desk.html` をウィンドウ幅 1280px の新しいタブで開く。
Expected:
- 上部の黒地の帯に「試し斬り 運営」「🌙」「📱」が出る
- 左に「大会一覧 / 基本情報 / 技と配点 / 選手 / 試合 / 結果」が縦に並び、「大会一覧」が選択色、それ以外は薄く無効（大会を選んでいないため）
- 本文に「この区画はまだ準備中です。」（区画がまだ登録されていないので正しい）
- URL が `desk.html#events` になっている
- 🌙 を押すとダークテーマになり、再読み込みしても保たれる。ライト・ダークのどちらでも文字が読める
- ウィンドウ幅を 800px にすると、本文と左のナビが消えて「この画面は幅 1024px 以上の PC 向けです。」の案内と切り替えボタンだけになる
- 1280px に戻して横スクロールバーが出ない
- コンソールにエラーが出ていない

`http://localhost:3461/desk.html#players/zzz` を開く。
Expected: 「大会データを取得できませんでした。通信を確認してください。」の alert が出て `#events` に戻る

- [ ] **Step 7: コミット**

```bash
git add desk.html desk.css desk.js server/static-policy.js
git commit -m "feat: PC 運営画面の骨組み（ハッシュ・区画ナビ・ダイアログ・テーマ）を作る" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 6 つの区画のプレースホルダーと `desk.html` の `<script>`

以降のタスクを並行できるよう、区画のファイルを先に全部作って `desk.html` に読み込ませる。中身はこのあとのタスク（と計画4・5）で入れ替える。
**このあと `desk.html` を触るのは Task 11 だけ**（`data.js` と `techedit.js` の 2 行を足す）。

**Files:**
- Create: `desk-events.js` `desk-setup.js` `desk-techniques.js` `desk-players.js` `desk-match.js` `desk-results.js`
- Modify: `desk.html`（`<script src="desk.js"></script>` の直後）

- [ ] **Step 1: 6 つのファイルを作る**

`desk-events.js`:

```js
// 大会一覧の区画（#events）。一覧の表・新規作成・コピー・取り込み・アーカイブ・削除。
// 中身は計画2の Task 7 / Task 8 で入れる。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '大会一覧はこのあとのタスクで実装します。';
    container.appendChild(p);
  }

  Desk.registerTab('events', { render: render });
})();
```

`desk-setup.js`:

```js
// 基本情報の区画（#setup/<id>）。大会名・日付・会場とコートの一覧。
// 中身は計画2の Task 9 で入れる。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '基本情報はこのあとのタスクで実装します。';
    container.appendChild(p);
  }

  Desk.registerTab('setup', { render: render });
})();
```

`desk-techniques.js`:

```js
// 技と配点の区画（#techniques/<id>）。techedit.js を埋め込む。
// 中身は計画2の Task 11 で入れる。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '技と配点はこのあとのタスクで実装します。';
    container.appendChild(p);
  }

  Desk.registerTab('techniques', { render: render });
})();
```

`desk-players.js`:

```js
// 選手の区画（#players/<id>）。計画2では読み取り専用の表（Task 12）、
// 編集できる表と貼り付けによる一括登録は計画4で作る。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '選手の表はこのあとのタスクで実装します。';
    container.appendChild(p);
  }

  Desk.registerTab('players', { render: render });
})();
```

`desk-match.js`:

```js
// 試合の区画（#match/<id>）。コート別の状況・採点画面を開く・二巡目の生成と技入力。
// 中身は計画5で作る。それまではスマホ運営の「進行」タブを使う。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '試合の進行は計画5で実装します。いまは 📱 でスマホ運営に切り替えて「進行」タブをお使いください。';
    container.appendChild(p);
  }

  Desk.registerTab('match', { render: render });
})();
```

`desk-results.js`:

```js
// 結果の区画（#results/<id>）。順位・発表モード・共有リンク・配信ボード。
// 中身は計画5で作る。それまではスマホ運営の「結果」タブを使う。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '結果は計画5で実装します。いまは 📱 でスマホ運営に切り替えて「結果」タブをお使いください。';
    container.appendChild(p);
  }

  Desk.registerTab('results', { render: render });
})();
```

- [ ] **Step 2: `desk.html` に読み込ませる**

`desk.html` の `<script src="desk.js"></script>` の直後に足す。

```html
  <script src="desk-events.js"></script>
  <script src="desk-setup.js"></script>
  <script src="desk-techniques.js"></script>
  <script src="desk-players.js"></script>
  <script src="desk-match.js"></script>
  <script src="desk-results.js"></script>
```

- [ ] **Step 3: 画面で確認する**

`http://localhost:3461/desk.html#events` を新しいタブ・幅 1280px で開く。
Expected:
- 「大会一覧はこのあとのタスクで実装します。」と出る
- コンソールに 404 が出ていない（6 本とも配信されている）

URL を `desk.html#match/PC土台テストの大会ID`（Task 2 で作った大会の ID。スマホ運営の URL からコピーする）に変える。
Expected:
- 上部に大会名・日付・会場が出る
- 左のナビが全部押せるようになり、「試合」が選択色
- 本文に「試合の進行は計画5で実装します。…」
- 左のナビで「結果」「選手」「基本情報」「技と配点」を押すと URL が `#results/…` `#players/…` `#setup/…` `#techniques/…` に変わり、それぞれの文言が出る
- ブラウザの戻るボタンで前の区画に戻れる

- [ ] **Step 4: コミット**

```bash
git add desk-events.js desk-setup.js desk-techniques.js desk-players.js desk-match.js desk-results.js desk.html
git commit -m "feat: PC 運営の6区画を登録する（中身はこのあとのタスク）" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 上部の段階表示と遷移ボタン（`desk.js`）

設計書「画面設計 > PC 運営」の上部の帯。7 段階のうち `archived` は並べず、`final` のときに「アーカイブ ▶」を出す。件数と確認文言は Task 2 で `courts.js` に寄せたものを使う。
`draft → round1` に成功したら、コート端末用に採点画面を別ウィンドウで開く。

**Files:**
- Modify: `desk.js`（`NAV` の直後に `STAGE_STEPS`、`renderHead` の中に 1 行、`renderHead` の直後に `buildStage` / `applyStatus`）

- [ ] **Step 1: 段階の並びを定数にする**

`desk.js` の `var TABS = NAV.map(function(n) { return n.tab; });` の直後に足す。

```js
  // 上部に並べる段階。archived は並べない（アーカイブは final の「次へ進む」で、
  // 戻すときは prev が final を返す）。
  var STAGE_STEPS = ['draft', 'round1', 'round1_done', 'round2', 'round2_done', 'final'];
```

- [ ] **Step 2: `renderHead` に段階表示を足す**

`desk.js` の `renderHead` の中、`head.appendChild(line);` の直後に足す。

```js
    head.appendChild(buildStage(EventStatus.of(event), event.players || []));
```

- [ ] **Step 3: `buildStage` と `applyStatus` を足す**

`desk.js` の `renderHead` の閉じ括弧の直後（`function renderNav() {` の直前）に足す。

```js
  // 段階の帯。現在の状態を強調し、通過した状態を塗る。右に「戻す」「次へ進む」。
  function buildStage(st, players) {
    var wrap = document.createElement('div');
    wrap.className = 'desk-stage';

    var steps = document.createElement('div');
    steps.className = 'desk-stage-steps';
    var cur = STAGE_STEPS.indexOf(st);   // archived は -1（全部を通過済みとして塗る）
    STAGE_STEPS.forEach(function(s, i) {
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'desk-stage-sep';
        sep.textContent = '─';
        steps.appendChild(sep);
      }
      var el = document.createElement('span');
      el.className = 'desk-stage-step' +
        (s === st ? ' on' : '') +
        ((cur === -1 || i < cur) ? ' done' : '');
      el.textContent = (s === st ? '●' : '○') + EventStatus.LABELS[s];
      steps.appendChild(el);
    });
    wrap.appendChild(steps);

    if (st === 'archived') {
      var badge = document.createElement('span');
      badge.className = 'desk-stage-archived';
      badge.textContent = EventStatus.LABELS.archived;
      wrap.appendChild(badge);
    }

    var count = document.createElement('span');
    count.className = 'desk-stage-count';
    count.id = 'deskStageCount';
    count.textContent = Courts.stageCountText(st, players);
    wrap.appendChild(count);

    var actions = document.createElement('div');
    actions.className = 'desk-stage-actions';

    var back = EventStatus.prev(st, players);
    if (back) {
      var btnBack = document.createElement('button');
      btnBack.type = 'button';
      btnBack.className = 'desk-btn';
      btnBack.id = 'btnDeskBack';
      btnBack.textContent = '◀ ' + EventStatus.LABELS[back] + ' に戻す';
      btnBack.addEventListener('click', function() { applyStatus(st, back); });
      actions.appendChild(btnBack);
    }

    // 二巡目を行わずに最終結果へ（一巡目終了のときだけ）
    if (st === 'round1_done') {
      var btnSkip = document.createElement('button');
      btnSkip.type = 'button';
      btnSkip.className = 'desk-btn';
      btnSkip.id = 'btnDeskSkipRound2';
      btnSkip.textContent = '二巡目なしで終了';
      btnSkip.addEventListener('click', function() { applyStatus(st, 'final'); });
      actions.appendChild(btnSkip);
    }

    var nx = EventStatus.next(st);
    if (nx) {
      var btnNext = document.createElement('button');
      btnNext.type = 'button';
      btnNext.className = 'desk-btn primary';
      btnNext.id = 'btnDeskNext';
      btnNext.textContent = EventStatus.NEXT_LABELS[st] + ' ▶';
      btnNext.addEventListener('click', function() { applyStatus(st, nx); });
      actions.appendChild(btnNext);
    }
    wrap.appendChild(actions);
    return wrap;
  }

  // 状態を変える。確認文言は courts.js（スマホ運営と共通）。
  // 失敗の理由はサーバーの文言をそのまま出し、読み直す
  // （transition の 409 は他の端末が先に進めていた場合）。
  async function applyStatus(from, to) {
    var eventId = selectedEventId;
    var players = (currentEvent && currentEvent.players) || [];
    if (!eventId) return;
    if (!confirm(Courts.statusConfirmMessage(from, to, players))) return;
    var seq = renderSeq;
    var res = await Api.changeStatus(eventId, to);
    if (seq !== renderSeq || selectedEventId !== eventId) return;   // 通信中に画面を離れた
    if (!res) {
      alert('状態を変えられませんでした。通信を確認してください。');
      return;
    }
    if (!res.ok) {
      alert(res.error);
      await reloadEvent();   // 他の端末が先に進めていた可能性がある
      return;
    }
    toast(EventStatus.LABELS[to] + ' にしました');
    // 試合開始に成功したら、コート端末で使う採点画面を別ウィンドウで開く
    if (from === 'draft' && to === 'round1') openScoring(eventId, '');
    await reloadEvent();
  }
```

- [ ] **Step 4: 画面で確認する**

`http://localhost:3461/desk.html#setup/<PC土台テストの大会ID>` を新しいタブ・幅 1280px で開く（大会 ID はスマホ運営の URL から取る）。**本物の大会では試さない**。
Expected:
- 大会名の下に `●準備中 ─ ○一巡目 進行中 ─ ○一巡目終了 ─ ○二巡目 進行中 ─ ○二巡目終了 ─ ○最終結果` が並び、「準備中」だけが強調されている
- その右に `一巡目 2名　技 未入力 2`
- 右端に「試合開始 ▶」だけがある（準備中は `prev` が無いので「戻す」は出ない）
- 「試合開始 ▶」を押すと `一巡目 2名。技が未入力の選手が 2名います。／試合を開始しますか？` の確認。承諾すると
  - 右下に「一巡目 進行中 にしました」のトースト
  - 採点画面（`index.html#event/<id>`）が別ウィンドウで開く（ポップアップを塞いでいる場合は案内の alert が出る。その場合はブラウザで許可してからもう一度試す）
  - 段階表示の強調が「一巡目 進行中」に移り、件数が `採点済み 0 / 2` になる
  - 右端が「◀ 準備中 に戻す」と「一巡目を終了 ▶」の 2 つになる
- 「一巡目を終了 ▶」→ 承諾 → 「二巡目を開始 ▶」の左に「二巡目なしで終了」が出る
- 「二巡目を開始 ▶」を押すと（二巡目が 0 件なので）`二巡目が生成されていません` の alert が出て、画面が読み直される
- 「二巡目なしで終了」→ 承諾 → 段階表示が「最終結果」になり、右端が「◀ 一巡目終了 に戻す」と「アーカイブ ▶」、件数は空
- 「アーカイブ ▶」→ 承諾 → 段階表示の右に「アーカイブ」のバッジが出て、ボタンは「◀ 最終結果 に戻す」だけになる
- 「◀ 最終結果 に戻す」→ 承諾 →「最終結果」に戻る。さらに「◀ 一巡目終了 に戻す」で編集できる状態に戻す（次のタスクのために `一巡目終了` か `準備中` まで戻しておく）

- [ ] **Step 5: コミット**

```bash
git add desk.js
git commit -m "feat: PC 運営の上部に段階表示と次へ進む・戻すを出す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 大会一覧の表（`desk-events.js`）

設計書「大会一覧 `#events`」。表（名前・日付・会場・人数・状態・更新）を `updatedAt` 降順で出し、`archived` は下の「▸ アーカイブ（n 件）」に畳む。行の「⋯」には、この Task では既存の API だけで足りる「開く」「ファイルに保存」「削除」を置く（「コピーして作成」「アーカイブ」は Task 8）。

**Files:**
- Modify: `desk-events.js`（プレースホルダーを置き換える）

- [ ] **Step 1: `desk-events.js` を書く**

ファイル全体を置き換える。

```js
// 大会一覧の区画（#events）。表（名前・日付・会場・人数・状態・更新）と行の「⋯」。
// archived は下の「▸ アーカイブ（n 件）」に畳む（当日の運営で押し間違えないよう、
// 進行中・準備中の大会と混ぜない）。
(function() {
  var outsideClickBound = false;   // 「⋯」の外側クリック検知は document に1回だけ付ける

  async function render(container, ctx) {
    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '大会';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.appendChild(h2);
    head.appendChild(spacer);
    container.appendChild(head);

    var body = document.createElement('div');
    container.appendChild(body);

    var loading = document.createElement('p');
    loading.className = 'desk-empty';
    loading.textContent = '読み込み中…';
    body.appendChild(loading);

    var events = await Api.listEvents();
    if (ctx.isStale()) return;   // 待っている間に区画を切り替えられた
    body.innerHTML = '';
    if (!Array.isArray(events)) {
      // 取得できなかっただけで、大会が消えたわけではない。「0件」と誤解させない。
      var err = document.createElement('p');
      err.className = 'desk-empty';
      err.textContent = '大会一覧を取得できませんでした。通信を確認してください。';
      body.appendChild(err);
      alert('大会一覧を取得できませんでした。通信を確認してください。');
      return;
    }
    if (events.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = '大会がまだありません。';
      body.appendChild(none);
      return;
    }

    // 直近に触った大会を上に出す
    events.sort(function(a, b) {
      var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
      if (x === y) return 0;
      return x < y ? 1 : -1;
    });

    var active = events.filter(function(ev) { return EventStatus.of(ev) !== 'archived'; });
    var archived = events.filter(function(ev) { return EventStatus.of(ev) === 'archived'; });

    if (active.length === 0) {
      var noneActive = document.createElement('p');
      noneActive.className = 'desk-empty';
      noneActive.textContent = '進行中・準備中の大会はありません。';
      body.appendChild(noneActive);
    } else {
      body.appendChild(buildTable(active));
    }

    if (archived.length > 0) {
      var det = document.createElement('details');
      det.className = 'desk-archived';
      var sum = document.createElement('summary');
      sum.textContent = '▸ アーカイブ（' + archived.length + ' 件）';
      det.addEventListener('toggle', function() {
        sum.textContent = (det.open ? '▾ ' : '▸ ') + 'アーカイブ（' + archived.length + ' 件）';
      });
      det.appendChild(sum);
      det.appendChild(buildTable(archived));
      body.appendChild(det);
    }
  }

  function buildTable(list) {
    var table = document.createElement('table');
    table.className = 'desk-table';
    table.innerHTML =
      '<thead><tr><th>大会名</th><th>日付</th><th>会場</th><th>人数</th>' +
      '<th>状態</th><th>更新</th><th></th></tr></thead>';
    var tbody = document.createElement('tbody');
    list.forEach(function(ev) { tbody.appendChild(buildRow(ev)); });
    table.appendChild(tbody);
    return table;
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  // 更新日時（ISO 文字列）を「9/18 21:45」の形に。読めない値は「—」。
  function formatUpdated(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var hh = String(d.getHours());
    var mi = String(d.getMinutes());
    if (hh.length < 2) hh = '0' + hh;
    if (mi.length < 2) mi = '0' + mi;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mi;
  }

  function buildRow(ev) {
    var st = EventStatus.of(ev);
    var tr = document.createElement('tr');

    // 大会名はリンク。ハッシュを書き換えるだけで desk.js の applyRoute が拾う。
    var tdName = document.createElement('td');
    var link = document.createElement('a');
    link.className = 'desk-cell-main';
    link.href = '#players/' + encodeURIComponent(ev.id);
    link.textContent = ev.name || '(名称未設定)';
    tdName.appendChild(link);
    tr.appendChild(tdName);

    tr.appendChild(cell(ev.date || '—'));
    tr.appendChild(cell(ev.venue || '—'));
    tr.appendChild(cell(String(ev.playerCount || 0), 'num'));

    var tdStatus = document.createElement('td');
    var badge = document.createElement('span');
    badge.className = 'desk-badge' + (EventStatus.isScoringOpen(st) ? ' on' : '');
    badge.textContent = EventStatus.LABELS[st];
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    tr.appendChild(cell(formatUpdated(ev.updatedAt)));

    var tdAct = document.createElement('td');
    tdAct.className = 'act';
    tdAct.appendChild(buildRowMenu(ev, st));
    tr.appendChild(tdAct);
    return tr;
  }

  // details/summary の外側をクリックしたら閉じる。document への登録は1回だけ
  // （描画のたびにリスナーが積み重ならないように）。
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

  function menuItem(menu, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', function() {
      menu.open = false;
      onClick();
    });
    return b;
  }

  function buildRowMenu(ev, st) {
    bindOutsideClickOnce();
    var menu = document.createElement('details');
    menu.className = 'desk-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    sum.setAttribute('aria-label', (ev.name || '(名称未設定)') + ' の操作');
    menu.appendChild(sum);
    var body = document.createElement('div');
    body.className = 'desk-menu-body';
    menu.appendChild(body);

    body.appendChild(menuItem(menu, '開く', function() { Desk.navigate('players', ev.id); }));
    body.appendChild(menuItem(menu, '💾 ファイルに保存', function() { onSaveFile(ev); }));
    body.appendChild(menuItem(menu, '🗑 削除', function() { onDelete(ev); }));
    return menu;
  }

  async function onSaveFile(ev) {
    var json = await Api.exportBundle(ev.id);
    // json: 成功時は文字列、サーバーがエラーを返したときは {error}、通信失敗は null
    if (typeof json !== 'string') {
      alert(json && json.error
        ? '大会をファイルに保存できませんでした。\n' + json.error
        : '大会をファイルに保存できませんでした。通信を確認してください。');
      return;
    }
    // ファイル名はサーバーの Content-Disposition ではなくクライアントで組む
    Storage.downloadText(Storage.bundleFilename(ev.name, ev.date), json,
      'application/json;charset=utf-8');
    Desk.toast('ファイルに保存しました');
  }

  async function onDelete(ev) {
    if (!confirm('大会「' + (ev.name || '(名称未設定)') + '」を削除します。\n' +
        '選手データも一緒に消えます。よろしいですか？')) {
      return;
    }
    var ok = await Api.deleteEvent(ev.id);
    if (!ok) {
      alert('大会の削除に失敗しました。');
      return;
    }
    Desk.toast('大会を削除しました');
    Desk.navigate('events');   // 一覧を描き直す
  }

  Desk.registerTab('events', { render: render });
})();
```

- [ ] **Step 2: 画面で確認する**

`http://localhost:3461/desk.html#events` を新しいタブ・幅 1280px で開く。
Expected:
- 表に「大会名 / 日付 / 会場 / 人数 / 状態 / 更新」の見出しがあり、更新が新しい順に並ぶ
- 「PC土台テスト」の状態欄にバッジが出る（進行中のときだけ色が付く）
- 大会名をクリックすると `#players/<id>` に移る（いまはプレースホルダーか Task 12 の表）
- ブラウザの戻るで一覧に戻る
- 行の「⋯」→「💾 ファイルに保存」で `tameshigiri_<日付>_PC土台テスト.json` がダウンロードされる
- 「⋯」を開いたまま表の外をクリックすると閉じる
- アーカイブ済みの大会があれば（Task 6 で戻していれば無い）「▸ アーカイブ（n 件）」の折りたたみが下に出て、開くと「▾」に変わる
- 1280px で横スクロールが出ない

**削除の確認は使い捨ての大会で行う**: スマホ運営（`admin.html`）で「削除テスト」という大会を作り、PC の一覧でその行の「⋯」→「🗑 削除」→ 承諾。
Expected: 「大会を削除しました」のトーストが出て一覧から消える

- [ ] **Step 3: コミット**

```bash
git add desk-events.js
git commit -m "feat: PC 運営の大会一覧を表にする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 新規作成・コピー・取り込み・アーカイブ（`desk-events.js`）

上の「＋ 新規作成」「📂 取り込む」と、行の「⋯」の「コピーして作成」「アーカイブ（`final` のときだけ）」。
取り込みは `admin-events.js` と同じ流れを使う。ファイル選択の段取り（`pickBundle`）とファイル形式の検証はどちらの画面でも同じなので `storage.js` に移し、重複を作らない。

**Files:**
- Modify: `storage.js`（`todayLocal` の直後に `pickJsonFile` と `checkBundle`、`return {}` に公開）
- Modify: `admin-events.js`（`pickBundle` の削除と、`importBundleText` の検証の置き換え）
- Modify: `desk-events.js`（見出しのボタンと行メニューの追加、ダイアログ、取り込み）
- Modify: `test.html`（末尾の `storage.js` 節。Task 1 で足した `todayLocal` の assert の直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `assert('todayLocal: YYYY-MM-DD の形', …);` の直後に足す。

```js
    // ---- 取り込むファイルの検証（PC 運営とスマホ運営で共用。文言はサーバーと揃える） ----
    assert('checkBundle: 正しいファイルは ok',
      Storage.checkBundle({ format: 'phx-tameshigiri-event', version: 1, event: { name: 'a' } }),
      { ok: true });
    assert('checkBundle: format が違えば断る',
      Storage.checkBundle({ format: 'x', version: 1 }),
      { ok: false, error: 'このアプリのエクスポートファイルではありません。' });
    assert('checkBundle: JSON がオブジェクトでなければ断る',
      Storage.checkBundle('abc'),
      { ok: false, error: 'このアプリのエクスポートファイルではありません。' });
    assert('checkBundle: null でも落ちない',
      Storage.checkBundle(null),
      { ok: false, error: 'このアプリのエクスポートファイルではありません。' });
    assert('checkBundle: version が違えば更新を促す',
      Storage.checkBundle({ format: 'phx-tameshigiri-event', version: 2 }),
      { ok: false, error: '対応していないファイル形式です（version: 2）\nこのアプリを更新してください。' });
```

- [ ] **Step 2: テストが落ちるのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result:` の行が出ない。コンソールに `TypeError: Storage.checkBundle is not a function`

- [ ] **Step 3: `storage.js` に 2 つの関数を足す**

`storage.js` の `todayLocal` の閉じ括弧の直後に足す。

```js
  // --- 大会ファイルの取り込み（PC 運営 desk-events.js とスマホ運営 admin-events.js で共用）---

  // ファイル選択ダイアログを出し、選ばれた JSON ファイルの中身（文字列）を onText に渡す。
  // onText は Promise を返してもよい（取り込みの完了まで onDone を待たせる）。
  // onDone は選択〜取り込みが終わった時点（成功・失敗・キャンセルのどれでも）で一度だけ
  // 呼ぶ。呼び出し元はこれでボタンの disabled を戻す。
  // ページに <input type="file"> を置かずに済ませるため、その場で作って捨てる。
  function pickJsonFile(onText, onDone) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    var removed = false;
    var fileChosen = false;   // change でファイルを受け取ったら true
    var finished = false;
    function cleanup() {
      if (removed) return;
      removed = true;
      window.removeEventListener('focus', onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    }
    function finish() {
      if (finished) return;
      finished = true;
      if (onDone) onDone();
    }
    // ファイル選択ダイアログをキャンセルすると change は発火しない。
    // cancel イベントが取れる環境ではそれで、取れない環境（フォールバック）では
    // ダイアログを閉じてウィンドウに戻ってきた最初の focus で片付ける。
    function onCancel() { cleanup(); finish(); }
    function onFocus() {
      // change がこの同じ tick で来ることがある（フォーカスが先に戻る環境）。
      // ここで即 cleanup すると、その change を取りこぼす。
      setTimeout(function() {
        cleanup();
        if (!fileChosen) finish();   // ファイルを選んでいれば finish は change 側に任せる
      }, 0);
    }
    input.addEventListener('cancel', onCancel);
    window.addEventListener('focus', onFocus);

    input.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) {
        fileChosen = true;
        var reader = new FileReader();
        reader.onload = function(ev) {
          var r = null;
          try {
            r = onText(ev.target.result);
          } catch (err) {
            console.error(err);
          }
          // 成功でも例外でもボタンを戻す（reject 側を落とすと無効のまま残る）
          if (r && typeof r.then === 'function') r.then(finish, finish);
          else finish();
        };
        reader.onerror = function() { alert('ファイルを読めませんでした。'); finish(); };
        reader.readAsText(file, 'UTF-8');
      } else {
        finish();
      }
      cleanup();
    });
    input.click();
  }

  // 取り込むファイルがこのアプリのエクスポートかどうか。
  // 文言はサーバー（server/index.js の POST /api/events/import）と揃える。
  // 戻り値: { ok: true } | { ok: false, error: '…' }
  function checkBundle(bundle) {
    if (!bundle || typeof bundle !== 'object' || bundle.format !== 'phx-tameshigiri-event') {
      return { ok: false, error: 'このアプリのエクスポートファイルではありません。' };
    }
    if (bundle.version !== 1) {
      return { ok: false, error: '対応していないファイル形式です（version: ' + bundle.version + '）\n' +
        'このアプリを更新してください。' };
    }
    return { ok: true };
  }
```

`storage.js` の `return {` に足す（`todayLocal: todayLocal,` の直後）。

```js
    pickJsonFile: pickJsonFile,
    checkBundle: checkBundle,
```

- [ ] **Step 4: テストが通るのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`

- [ ] **Step 5: `admin-events.js` を共通の関数に寄せる**

`pickBundle` 関数を丸ごと削除する（`// admin.html には file input を置かない（DOM は計画3との契約）。…` のコメントから、`input.click();` の下の閉じ括弧まで）。

`btnImport` のクリック処理を置き換える。置き換え前:

```js
    btnImport.addEventListener('click', function() {
      // ファイル選択〜取り込み完了まで二重送信を防ぐ。成功・失敗・キャンセルの
      // どれで終わっても pickBundle が最後に呼ぶコールバックで必ず戻す。
      btnImport.disabled = true;
      pickBundle(function() { btnImport.disabled = false; });
    });
```

置き換え後:

```js
    btnImport.addEventListener('click', function() {
      // ファイル選択〜取り込み完了まで二重送信を防ぐ。成功・失敗・キャンセルの
      // どれで終わっても Storage.pickJsonFile が最後に呼ぶコールバックで必ず戻す。
      btnImport.disabled = true;
      Storage.pickJsonFile(importBundleText, function() { btnImport.disabled = false; });
    });
```

`importBundleText` の検証を置き換える。置き換え前:

```js
    if (!bundle || typeof bundle !== 'object' || bundle.format !== 'phx-tameshigiri-event') {
      alert('このアプリのエクスポートファイルではありません。');
      return;
    }
    if (bundle.version !== 1) {
      // format は合っているが version が違う（新しい版が書き出したファイルなど）。
      // サーバー（server/index.js の POST /api/events/import）と文言を揃える。
      alert('対応していないファイル形式です（version: ' + bundle.version + '）\nこのアプリを更新してください。');
      return;
    }
```

置き換え後:

```js
    var chk = Storage.checkBundle(bundle);
    if (!chk.ok) { alert(chk.error); return; }
```

- [ ] **Step 6: `desk-events.js` に見出しのボタンとダイアログを足す**

`render` の中、`head.appendChild(spacer);` の直後（`container.appendChild(head);` の前）に足す。

```js
    var btnImport = document.createElement('button');
    btnImport.type = 'button';
    btnImport.className = 'desk-btn';
    btnImport.textContent = '📂 取り込む';
    btnImport.addEventListener('click', function() {
      // 選択〜取り込み完了まで二重送信を防ぐ
      btnImport.disabled = true;
      Storage.pickJsonFile(importBundleText, function() { btnImport.disabled = false; });
    });
    head.appendChild(btnImport);

    var btnNew = document.createElement('button');
    btnNew.type = 'button';
    btnNew.className = 'desk-btn primary';
    btnNew.textContent = '＋ 新規作成';
    btnNew.addEventListener('click', openNewDialog);
    head.appendChild(btnNew);
```

`buildRowMenu` の中、「開く」の直後に足す（「🗑 削除」より前）。

```js
    body.appendChild(menuItem(menu, '📄 コピーして作成', function() { openCopyDialog(ev); }));
```

`buildRowMenu` の「💾 ファイルに保存」の直後に足す。

```js
    // アーカイブは「最終結果」まで進んだ大会だけ（遷移表にない組み合わせはサーバーが拒む）
    if (st === 'final') {
      body.appendChild(menuItem(menu, '📥 アーカイブ', function() { onArchive(ev); }));
    }
```

`Desk.registerTab('events', { render: render });` の直前に足す。

```js
  // --- ダイアログ ---

  var fieldSeq = 0;   // input id の連番（label の for と対にする）

  function addField(form, labelText, type) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = type;
    input.id = 'df_' + (++fieldSeq);
    label.htmlFor = input.id;
    label.textContent = labelText;
    form.appendChild(label);
    form.appendChild(input);
    return input;
  }

  // 新規作成。保存に失敗したらダイアログを閉じない（閉じると入力し直しになる）。
  function openNewDialog() {
    var form = document.createElement('div');
    form.className = 'desk-form';
    var inName = addField(form, '大会名', 'text');
    var inDate = addField(form, '日付', 'date');
    var inVenue = addField(form, '会場', 'text');
    inDate.value = Storage.todayLocal();

    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'desk-btn primary';
    btnSave.textContent = '作成';

    var dialog = Desk.openDialog('新規作成', form, [btnSave]);
    inName.focus();

    btnSave.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnSave.disabled = true;
      dialog.lock(true);
      var result = await Api.saveEvent({
        name: name, date: inDate.value, venue: inVenue.value.trim(), players: []
      });
      btnSave.disabled = false;
      dialog.lock(false);
      if (!result || !result.id) {
        alert('大会の作成に失敗しました。通信を確認してください。');
        return;   // ダイアログは開いたまま。入力を残す
      }
      dialog.close();
      Desk.toast('大会を作成しました');
      Desk.navigate('players', result.id);
    });
  }

  // コピーして作成。技と配点は必ず複製される（サーバーの仕様）。
  function openCopyDialog(ev) {
    var wrap = document.createElement('div');

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = '技と配点は必ず複製されます。得点・共有リンク・履歴は引き継ぎません。';
    wrap.appendChild(note);

    var form = document.createElement('div');
    form.className = 'desk-form';
    var inName = addField(form, '大会名', 'text');
    var inDate = addField(form, '日付', 'date');
    var inVenue = addField(form, '会場', 'text');
    inName.value = (ev.name || '(名称未設定)') + '（コピー）';
    inDate.value = Storage.todayLocal();
    inVenue.value = ev.venue || '';

    var check = document.createElement('label');
    check.className = 'desk-check';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    check.appendChild(cb);
    check.appendChild(document.createTextNode(' 選手も複製する（一巡目の行だけ。得点は消えます）'));
    form.appendChild(check);
    wrap.appendChild(form);

    var btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'desk-btn primary';
    btnCopy.textContent = 'コピーして作成';

    var dialog = Desk.openDialog('コピーして作成', wrap, [btnCopy]);
    inName.focus();

    btnCopy.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnCopy.disabled = true;
      dialog.lock(true);
      var result = await Api.copyEvent(ev.id, {
        name: name, date: inDate.value, venue: inVenue.value.trim(), withPlayers: cb.checked
      });
      btnCopy.disabled = false;
      dialog.lock(false);
      if (!result) {
        alert('コピーに失敗しました。通信を確認してください。');
        return;   // ダイアログは開いたまま
      }
      if (result.error) {
        alert('コピーに失敗しました。\n' + result.error);
        return;
      }
      dialog.close();
      Desk.toast('大会をコピーしました（' + (result.playerCount || 0) + '名）');
      Desk.navigate('players', result.id);
    });
  }

  // --- アーカイブ ---

  async function onArchive(ev) {
    // 確認文言はスマホ運営と共通（courts.js）
    if (!confirm(Courts.statusConfirmMessage('final', 'archived', null))) return;
    var res = await Api.changeStatus(ev.id, 'archived');
    if (!res) {
      alert('アーカイブできませんでした。通信を確認してください。');
      return;
    }
    if (!res.ok) {
      alert(res.error);
    } else {
      Desk.toast('アーカイブしました');
    }
    Desk.navigate('events');   // 成否にかかわらず一覧を描き直す（他の端末が動かしている）
  }

  // --- 取り込み ---
  // 検証（format / version）は Storage.checkBundle。スマホ運営（admin-events.js）と同じ流れ。

  async function importBundleText(text) {
    var bundle;
    try {
      bundle = JSON.parse(text);
    } catch (e) {
      alert('ファイルを読めませんでした。');
      return;
    }
    var chk = Storage.checkBundle(bundle);
    if (!chk.ok) { alert(chk.error); return; }

    var name = (bundle.event && bundle.event.name) || '';
    var date = (bundle.event && bundle.event.date) || '';

    // 取り込みは常に新しい大会として追加される。同名・同日があれば先に断りを入れる。
    var existing = await Api.listEvents();
    if (Array.isArray(existing)) {
      var dup = existing.filter(function(e) {
        return String(e.name || '').trim() === String(name).trim() &&
               String(e.date || '') === String(date);
      });
      if (dup.length > 0 &&
          !confirm('同じ名前と日付の大会が既にあります。\n別の大会として追加しますか？')) {
        return;
      }
    }

    var result = await Api.importBundle(bundle);
    if (!result) {
      alert('取り込みに失敗しました。通信を確認してください。');
      return;
    }
    if (!result.success) {
      alert('取り込みに失敗しました。\n' + (result.error || ''));
      return;
    }
    Desk.toast('大会を取り込みました（' + (result.playerCount || 0) + '名）');
    Desk.navigate('players', result.id);
  }
```

- [ ] **Step 7: 画面で確認する（PC）**

`http://localhost:3461/desk.html#events` を新しいタブ・幅 1280px で開く。
Expected:
- 見出しの右に「📂 取り込む」「＋ 新規作成」
- 「＋ 新規作成」→ 中央にダイアログ。日付に今日が入っている。大会名を空のまま「作成」を押すと「大会名を入力してください。」の alert が出てダイアログは開いたまま
- 大会名「PC作成テスト」で「作成」→「大会を作成しました」のトーストが出て `#players/<新しいID>` に移る
- 一覧に戻り、その行の「⋯」→「📄 コピーして作成」→ 大会名の初期値が `PC作成テスト（コピー）`、日付が今日、会場が元と同じ、チェックが入っている
- 「コピーして作成」→「大会をコピーしました（0名）」のトーストが出て `#players/<新しいID>` に移る。一覧に戻るとコピー先が「準備中」で並んでいる
- Task 7 で保存した `tameshigiri_….json` を「📂 取り込む」で選ぶ → 同名・同日の確認が出て、承諾すると「大会を取り込みました（n名）」
- 「📂 取り込む」でファイル選択をキャンセルしても、ボタンが押せる状態に戻る
- `final` まで進めた大会の「⋯」にだけ「📥 アーカイブ」がある（試すときは使い捨ての大会で。アーカイブすると一覧の「▸ アーカイブ」に移る）
- 確認に使った「PC作成テスト」「そのコピー」「取り込んだ大会」を「⋯」→「🗑 削除」で消す

- [ ] **Step 8: 画面で確認する（スマホ運営が壊れていないこと）**

`http://localhost:3461/admin.html#events` を新しいタブ・幅 375px で開く。
Expected: 「📂 取り込む」でファイルを選ぶと今までどおり取り込める。キャンセルしてもボタンが戻る

- [ ] **Step 9: コミット**

```bash
git add storage.js admin-events.js desk-events.js test.html
git commit -m "feat: PC 運営で大会の新規作成・コピー・取り込み・アーカイブができるようにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 基本情報とコート一覧（`desk-setup.js`）

設計書「基本情報 `#setup/<id>`」。名前・日付・会場の編集と、コート一覧の読み取り。ロック中（`final` / `archived`）は入力と保存を無効にする。

**Files:**
- Modify: `desk-setup.js`（プレースホルダーを置き換える）

- [ ] **Step 1: `desk-setup.js` を書く**

ファイル全体を置き換える。

```js
// 基本情報の区画（#setup/<id>）。大会名・日付・会場の編集と、コート一覧の確認。
// コートは選手の order から決まるので、ここでは読み取りだけ（変えるのは「選手」の区画）。
// 保存は POST /api/events（Api.saveEvent）で大会ファイルを丸ごと書き直す既存の作法。
// 画面が持っている古い選手データでコート端末の採点を巻き戻さないよう、
// 送る直前に大会を読み直して、名前・日付・会場だけ差し替えてから送る。
(function() {
  var fieldSeq = 0;

  function addField(form, labelText, type) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = type;
    input.id = 'sf_' + (++fieldSeq);
    label.htmlFor = input.id;
    label.textContent = labelText;
    form.appendChild(label);
    form.appendChild(input);
    return input;
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function render(container, ctx) {
    container.innerHTML = '';
    var locked = EventStatus.isLocked(EventStatus.of(ctx.event));

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '基本情報';
    head.appendChild(h2);
    container.appendChild(head);

    if (locked) {
      var warn = document.createElement('p');
      warn.className = 'desk-warn';
      warn.textContent = 'この大会は最終結果を確定済みです。上部の「戻す」を押すと編集できます。';
      container.appendChild(warn);
    }

    var form = document.createElement('div');
    form.className = 'desk-form';
    var inName = addField(form, '大会名', 'text');
    var inDate = addField(form, '日付', 'date');
    var inVenue = addField(form, '会場', 'text');
    inName.value = ctx.event.name || '';
    inDate.value = ctx.event.date || '';
    inVenue.value = ctx.event.venue || '';

    var actions = document.createElement('div');
    actions.className = 'desk-form-actions';
    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'desk-btn primary';
    btnSave.id = 'btnSetupSave';
    btnSave.textContent = '保存';
    actions.appendChild(btnSave);
    form.appendChild(actions);
    container.appendChild(form);

    if (locked) {
      inName.disabled = true;
      inDate.disabled = true;
      inVenue.disabled = true;
      btnSave.disabled = true;
    }

    btnSave.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnSave.disabled = true;
      var fresh = await Api.loadEvent(ctx.eventId);
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
      if (!fresh) {
        btnSave.disabled = false;
        alert('保存できませんでした。通信を確認してください。');
        return;
      }
      fresh.name = name;
      fresh.date = inDate.value;
      fresh.venue = inVenue.value.trim();
      // GET の応答にだけ付く値は送り返さない（サーバーも捨てるが、送らないほうが意図が明確）
      delete fresh.techniquesSource;
      delete fresh.status;
      var result = await Api.saveEvent(fresh);
      if (ctx.isStale()) return;
      btnSave.disabled = false;
      if (!result || !result.id) {
        // saveEvent は 409（確定済み）も null にする。他の端末が先に確定した場合もここへ来る。
        alert('保存できませんでした。\n通信を確認するか、大会が「最終結果」になっていないか確かめてください。');
        return;
      }
      Desk.toast('基本情報を保存しました');
      await Desk.reloadEvent();   // 上部の見出しを描き直す
    });

    // --- コート一覧（読み取り） ---

    var courtHead = document.createElement('div');
    courtHead.className = 'desk-section-head';
    var h2c = document.createElement('h2');
    h2c.textContent = 'コート';
    courtHead.appendChild(h2c);
    container.appendChild(courtHead);

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'コートは選手ひとりひとりのコート指定から決まります（変えるときは「選手」の区画で）。';
    container.appendChild(note);

    var courts = Courts.listFrom(ctx.players);
    if (courts.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいないので、コートはありません。';
      container.appendChild(none);
      return;
    }

    var table = document.createElement('table');
    table.className = 'desk-table';
    table.innerHTML = '<thead><tr><th>コート</th><th>一巡目</th><th>二巡目</th><th>合計</th></tr></thead>';
    var tbody = document.createElement('tbody');
    courts.forEach(function(c) {
      var rows = Courts.filter(ctx.players, c);
      var r1 = rows.filter(function(p) { return Courts.roundOf(p) === 1; }).length;
      var r2 = rows.filter(function(p) { return Courts.roundOf(p) === 2; }).length;
      var tr = document.createElement('tr');
      tr.appendChild(cell(c === Courts.UNASSIGNED ? Courts.UNASSIGNED : c + ' コート'));
      tr.appendChild(cell(String(r1), 'num'));
      tr.appendChild(cell(String(r2), 'num'));
      tr.appendChild(cell(String(rows.length), 'num'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  Desk.registerTab('setup', { render: render });
})();
```

- [ ] **Step 2: 画面で確認する**

`http://localhost:3461/desk.html#setup/<PC土台テストの大会ID>` を新しいタブ・幅 1280px で開く。
Expected:
- 大会名・日付・会場が入った入力欄と「保存」
- 会場に「テスト会場」と入れて「保存」→「基本情報を保存しました」のトーストが出て、上部の見出しの会場が変わる
- 再読み込みしても会場が残っている
- コートの表に `A コート / 一巡目 2 / 二巡目 0 / 合計 2` のような行が出る
- 大会名を空にして「保存」→「大会名を入力してください。」の alert が出て保存されない
- 上部の「次へ進む」で `最終結果` まで進める（この大会は使い捨て）と、入力欄と保存が無効になり、上に「この大会は最終結果を確定済みです。…」の警告が出る。「戻す」で編集できる状態に戻す
- **選手が巻き戻らないこと**: スマホ運営の選手タブで選手を 1 名足してから、PC の基本情報で「保存」を押し、スマホ運営を再読み込みしてもその選手が残っている

- [ ] **Step 3: コミット**

```bash
git add desk-setup.js
git commit -m "feat: PC 運営の基本情報とコート一覧を作る" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 技リスト編集を `techedit.js` に切り出す

`techniques.html` の `<script>` にある編集ロジックを `TechEdit.mount(container, eventId, opts)` に切り出し、`techniques.html` もそのモジュールを使うようにする。**見た目と動きは変えない**。
2 つだけ意図した違いがある: (1) テーマボタンが「編集する対象」の行に移る（見出し行は `TechEdit` が作るため）、(2) 表の外側の `overflow-x:auto` が `div.tech-scroll` になる。

**Files:**
- Create: `techedit.js`
- Modify: `techniques.html`（`<style>` に 2 つの class、本文、`<script>`）

- [ ] **Step 1: `techedit.js` を作る**

```js
// 技リスト編集（技名と太刀ごとの配点の表）の描画・保存・コピー。
// もとは techniques.html の <script> にあった。技術リスト編集ページと
// PC 運営の「技と配点」の区画（desk-techniques.js）から同じコードを使う。
//
//   TechEdit.mount(container, eventId, opts) → { isDirty, destroy }
//     container : 中身を入れ替えてよい要素
//     eventId   : '' なら雛形（新規大会の初期値）、大会IDならその大会の技リスト
//     opts.events   : [{ id, name, date }]「別の大会からコピー」の候補（既定は []）
//     opts.title    : 見出しに使う大会名（省略時は events から引き、無ければ ID をそのまま）
//     opts.readOnly : true なら保存・雛形に戻す・コピーを無効にする（確定済みの大会）
//     opts.onSaved  : function(techniques) 保存が成功したあとに呼ぶ（省略可）
//   戻り値の isDirty() は「表を触ったか」。対象を切り替える前の確認に使う。
//   destroy() は DOM から外す前に呼ぶ（開きっぱなしのコピーのシートを閉じ、
//   遅れて戻ってくる応答を無視する）。
//
// 対象の選択とハッシュの管理は呼び出し側が持つ。この中では location に触らない
// （PC 運営は #techniques/<id> という別のハッシュ体系を持つため）。
// class 名は techniques.html のときのまま（style.css と desk.css の両方に定義がある）。
var TechEdit = (function() {

  function makeButton(text, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    return b;
  }

  function mount(container, eventId, opts) {
    opts = opts || {};
    var events = Array.isArray(opts.events) ? opts.events : [];
    var readOnly = opts.readOnly === true;
    var targetId = eventId || '';
    var dirty = false;
    var copyOverlay = null;
    // 読み込みの再入ガード。destroy でも進めて、外したあとに戻ってきた応答で
    // DOM に触らないようにする（app.js の loadSeq と同じ考え方）。
    var loadSeq = 0;

    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'tech-head';
    var title = document.createElement('h2');
    title.className = 'tech-title';
    var btnCopy = makeButton('別の大会からコピー', 'btn-neutral');
    var btnSave = makeButton('保存', 'btn-neutral');
    var btnReset = makeButton('デフォルト設定に戻す', 'btn-fail');
    head.appendChild(title);
    head.appendChild(btnCopy);
    head.appendChild(btnSave);
    head.appendChild(btnReset);
    container.appendChild(head);

    var note = document.createElement('p');
    note.className = 'tech-note';
    note.hidden = true;
    container.appendChild(note);

    var warn = document.createElement('p');
    warn.className = 'tech-warn';
    warn.hidden = true;
    container.appendChild(warn);

    var scroll = document.createElement('div');
    scroll.className = 'tech-scroll';
    var table = document.createElement('table');
    table.className = 'tech-table';
    table.innerHTML =
      '<thead><tr><th>技名</th><th>初太刀</th><th>二ノ太刀</th><th>三ノ太刀</th><th>四ノ太刀</th></tr></thead>' +
      '<tbody></tbody>';
    var tbody = table.querySelector('tbody');
    scroll.appendChild(table);
    container.appendChild(scroll);

    tbody.addEventListener('input', function() { dirty = true; });

    function renderTable(techs) {
      tbody.innerHTML = '';
      (techs || []).forEach(function(t, i) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><input type="text" value="' + Storage.esc(t.name) + '" data-field="name" data-idx="' + i + '"></td>' +
          [0,1,2,3].map(function(s) {
            var v = (t.strikes[s] !== null && t.strikes[s] !== undefined) ? Storage.esc(String(t.strikes[s])) : '';
            return '<td><input type="number" min="0" max="99" value="' + v +
              '" data-field="strike" data-idx="' + i + '" data-strike="' + s + '"></td>';
          }).join('');
        tbody.appendChild(tr);
      });
      dirty = false;
      if (readOnly) {
        var inputs = tbody.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) inputs[i].disabled = true;
      }
    }

    function collectTechs() {
      var techs = [];
      var rows = tbody.querySelectorAll('tr');
      rows.forEach(function(tr) {
        var name = tr.querySelector('[data-field="name"]').value.trim();
        var strikes = [0,1,2,3].map(function(s) {
          var v = tr.querySelector('[data-strike="' + s + '"]').value;
          if (v === '') return null;
          var n = parseInt(v, 10);
          return isNaN(n) ? null : n;
        });
        techs.push({ name: name, strikes: strikes });
      });
      return techs;
    }

    function eventById(id) {
      return events.filter(function(e) { return e.id === id; })[0] || null;
    }

    // 見出し・注記・ボタンの文言を対象に合わせる
    function updateChrome(source) {
      if (!targetId) {
        title.textContent = '雛形（新規大会の初期値）';
        btnReset.textContent = 'デフォルト設定に戻す';
        btnCopy.style.display = 'none';   // 雛形には「別の大会からコピー」を出さない
        note.hidden = false;
        note.textContent =
          'ここで保存した内容は、これから作る大会の初期値になります。既に技リストを持つ大会の配点は変わりません。';
        warn.hidden = true;
        return;
      }
      var ev = eventById(targetId);
      // 大会一覧が取れていないときは名前が分からない。空欄より ID を出すほうが
      // 「今どの対象を触っているか」を誤認しない。
      var label = opts.title || (ev ? (ev.name || '(名称未設定)') : targetId);
      title.textContent = label + ' の技リスト';
      btnReset.textContent = '雛形に戻す';
      btnCopy.style.display = '';
      if (readOnly) {
        note.hidden = false;
        note.textContent =
          'この大会は最終結果を確定済みです。技と配点は編集できません（上部の「戻す」を押すと編集できます）。';
        return;
      }
      if (source === 'template') {
        note.hidden = false;
        note.textContent =
          'この大会はまだ雛形を使っています。保存するとこの大会だけの技リストになります。';
      } else {
        note.hidden = true;
        note.textContent = '';
      }
    }

    function updateScoredWarning(players) {
      var n = (players || []).filter(function(p) { return Courts.isScored(p); }).length;
      if (n === 0) { warn.hidden = true; warn.textContent = ''; return; }
      warn.hidden = false;
      warn.textContent = '採点済みの選手が ' + n + ' 名います。' +
        '配点を変えても保存済みの得点は変わりません（採点し直すと新しい配点で計算されます）。';
    }

    // 通信に失敗したときは端末側の既定値（data.js の TECHNIQUES）を出し、
    // 保存・雛形に戻す・コピーを無効にする（この状態で保存すると、サーバーの
    // 技術リストを既定値で上書きしてしまう）。
    function fallbackToLocal(message) {
      alert(message);
      renderTable(TECHNIQUES);
      btnSave.disabled = true;
      btnReset.disabled = true;
      btnCopy.disabled = true;
    }

    async function load() {
      var seq = ++loadSeq;
      btnSave.disabled = readOnly;
      btnReset.disabled = readOnly;
      btnCopy.disabled = readOnly;
      warn.hidden = true;
      if (!targetId) {
        updateChrome('');
        var td = await Api.loadTechniques();
        if (seq !== loadSeq) return;
        if (!td) {
          fallbackToLocal('技術リストをサーバーから取得できませんでした。\n' +
            '端末側の既定値を表示しています。\n' +
            '保存・雛形に戻す・別の大会からコピーを無効にしました。再読み込みしてください。');
          return;
        }
        renderTable(td.techniques);
        return;
      }
      var data = await Api.loadEventTechniques(targetId);
      if (seq !== loadSeq) return;
      if (!data) {
        updateChrome('');
        fallbackToLocal('この大会の技リストを取得できませんでした。\n' +
          '端末側の既定値を表示しています。\n' +
          '保存・雛形に戻す・別の大会からコピーを無効にしました。再読み込みしてください。');
        return;
      }
      updateChrome(data.source);
      renderTable(data.techniques);
      var ev = await Api.loadEvent(targetId);
      if (seq !== loadSeq) return;
      updateScoredWarning(ev ? ev.players : []);
    }

    // 「別の大会からコピー」のシート。admin.css を読まないページでも動くよう、
    // 最小限の要素をその場で組み立てて捨てる。
    function closeCopySheet() {
      if (copyOverlay && copyOverlay.parentNode) copyOverlay.parentNode.removeChild(copyOverlay);
      copyOverlay = null;
    }

    function openCopySheet() {
      var others = events.filter(function(e) { return e.id !== targetId; });
      if (others.length === 0) { alert('コピーできる大会がありません。'); return; }
      closeCopySheet();
      var overlay = document.createElement('div');
      overlay.className = 'tech-overlay';
      copyOverlay = overlay;
      var panel = document.createElement('div');
      panel.className = 'tech-sheet';
      var h = document.createElement('h3');
      h.textContent = 'どの大会の技リストをコピーしますか？（保存するまでサーバーには書きません）';
      panel.appendChild(h);

      others.forEach(function(ev) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tech-sheet-item btn-neutral';
        b.textContent = (ev.name || '(名称未設定)') + '（' + (ev.date || '日付なし') + '）';
        b.addEventListener('click', async function() {
          closeCopySheet();
          // コピー元の応答を待つ間に対象そのものを切り替えられていたら、
          // 戻ってきた表を今の対象（別の大会かもしれない）に流し込まない。
          var seq = loadSeq;
          var data = await Api.loadEventTechniques(ev.id);
          if (seq !== loadSeq) return;
          if (!data) { alert('その大会の技リストを取得できませんでした。'); return; }
          renderTable(data.techniques);
          dirty = true;
          alert('「' + (ev.name || '(名称未設定)') + '」の技リストを読み込みました。\n' +
                '保存を押すまでこの大会には反映されません。');
        });
        panel.appendChild(b);
      });

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'tech-sheet-item';
      cancel.textContent = '閉じる';
      cancel.addEventListener('click', closeCopySheet);
      panel.appendChild(cancel);

      overlay.appendChild(panel);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) closeCopySheet(); });
      document.body.appendChild(overlay);
    }

    btnCopy.addEventListener('click', openCopySheet);

    btnSave.addEventListener('click', async function() {
      var techs = collectTechs();
      if (!targetId) {
        var r0 = await Api.saveTechniques(techs);
        if (!r0) { alert('保存に失敗しました。通信を確認してください。'); return; }
        if (!r0.success) { alert(r0.error || '保存に失敗しました。'); return; }
        dirty = false;
        alert('雛形を保存しました。\nこれから作る大会の初期値になります。');
        if (opts.onSaved) opts.onSaved(techs);
        return;
      }
      var r = await Api.saveEventTechniques(targetId, techs);
      if (!r) { alert('保存に失敗しました。通信を確認してください。'); return; }
      if (!r.success) { alert(r.error || '保存に失敗しました。'); return; }
      dirty = false;
      renderTable(r.techniques);
      updateChrome('event');
      alert('保存しました。');
      if (opts.onSaved) opts.onSaved(r.techniques);
    });

    btnReset.addEventListener('click', async function() {
      if (!targetId) {
        if (!confirm('デフォルト設定に戻します。よろしいですか？')) return;
        var ok = await Api.resetTechniques();
        if (!ok) { alert('リセットに失敗しました。'); return; }
        // リセット自体は成功しているので、再取得に失敗しても表は出す。
        // ただしその場合に表示できるのは端末側の既定値であって、
        // サーバーが実際に採点で使う値ではない。黙って同じ顔をさせない。
        var td = await Api.loadTechniques();
        if (td) {
          renderTable(td.techniques);
          alert('デフォルトに戻しました。');
        } else {
          renderTable(TECHNIQUES);
          alert('デフォルトに戻しました。\n' +
                'ただし最新の技術リストを取得できなかったため、\n' +
                'この画面には端末側の既定値を表示しています。');
        }
        return;
      }
      if (!confirm('この大会の技リストを雛形（新規大会の初期値）で置き換えます。\nよろしいですか？')) return;
      var okEv = await Api.resetEventTechniques(targetId);
      if (!okEv) { alert('リセットに失敗しました。'); return; }
      var data = await Api.loadEventTechniques(targetId);
      if (!data) {
        alert('雛形に戻しました。\nただし最新の技リストを取得できませんでした。再読み込みしてください。');
        return;
      }
      renderTable(data.techniques);
      updateChrome(data.source);
      alert('雛形に戻しました。');
      if (opts.onSaved) opts.onSaved(data.techniques);
    });

    function destroy() {
      loadSeq++;          // 遅れて戻ってくる応答を無視する
      closeCopySheet();   // シートを開いたまま画面を離れても残さない
      container.innerHTML = '';
    }

    load().catch(function(e) { console.error(e); });

    return {
      isDirty: function() { return dirty; },
      destroy: destroy
    };
  }

  return { mount: mount };
})();
```

- [ ] **Step 2: `techniques.html` の `<style>` に 2 つの class を足す**

`techniques.html` の `<style>` の中、`.tech-target select { … }` の行の直後に足す。

```css
    .tech-head { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .tech-title { margin: 0; margin-right: auto; font-size: 18px; }
    .tech-scroll { overflow-x: auto; }
```

- [ ] **Step 3: `techniques.html` の本文を差し替える**

`<div class="container" style="padding-top:16px;">` から `</div>`（`<script src="data.js">` の直前まで）を置き換える。置き換え前:

```html
  <div class="container" style="padding-top:16px;">
    <div class="tech-target">
      <label for="targetSelect">編集する対象</label>
      <select id="targetSelect">
        <option value="">雛形（新規大会の初期値）</option>
      </select>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
      <h2 id="targetTitle" style="margin:0;">技術リスト</h2>
      <button id="btnCopyFrom" class="btn-neutral" style="margin-left:auto;">別の大会からコピー</button>
      <button id="btnSaveTech" class="btn-neutral">保存</button>
      <button id="btnResetTech" class="btn-fail">デフォルト設定に戻す</button>
      <button class="theme-btn" id="btnTheme">🌙 ダーク</button>
    </div>

    <p class="tech-note" id="sourceNote" hidden></p>
    <p class="tech-warn" id="scoredWarn" hidden></p>

    <div style="overflow-x:auto;">
      <table class="tech-table" id="techTable">
        <thead>
          <tr>
            <th>技名</th>
            <th>初太刀</th>
            <th>二ノ太刀</th>
            <th>三ノ太刀</th>
            <th>四ノ太刀</th>
          </tr>
        </thead>
        <tbody id="techTableBody"></tbody>
      </table>
    </div>
  </div>
```

置き換え後:

```html
  <div class="container" style="padding-top:16px;">
    <div class="tech-target">
      <label for="targetSelect">編集する対象</label>
      <select id="targetSelect">
        <option value="">雛形（新規大会の初期値）</option>
      </select>
      <button class="theme-btn" id="btnTheme" style="margin-left:auto;">🌙 ダーク</button>
    </div>

    <!-- 見出し・ボタン・注記・表は techedit.js（TechEdit.mount）が作る -->
    <div id="techEditor"></div>
  </div>
```

- [ ] **Step 4: `techniques.html` の `<script>` を差し替える**

`<script src="courts.js"></script>` の直後に 1 行足す。

```html
  <script src="techedit.js"></script>
```

インラインの `<script>` の中身を全部置き換える。置き換え後:

```js
    // 配点は大会ごと（大会 JSON の techniques）。この画面は
    //   対象 = ''        → 雛形（POST/DELETE /api/techniques）
    //   対象 = 大会ID    → その大会（PUT/DELETE /api/events/:id/techniques）
    // を切り替えて編集する。ハッシュ #<大会ID> で開くとその大会が選ばれる。
    // 表の描画・保存・コピーは techedit.js（PC 運営の「技と配点」と共通）。
    // この画面が持つのは「対象の選択」「ハッシュ」「テーマ」だけ。
    var targetSelect = document.getElementById('targetSelect');
    var editor = document.getElementById('techEditor');

    var targetId = '';      // '' なら雛形
    var eventsCache = [];   // Api.listEvents() の結果（更新日の新しい順）
    var handle = null;      // TechEdit.mount の戻り値

    function applyTheme(theme) {
      document.body.setAttribute('data-theme', theme);
      document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀ ライト' : '🌙 ダーク';
    }

    function eventById(id) {
      return eventsCache.filter(function(e) { return e.id === id; })[0] || null;
    }

    function fillTargetSelect() {
      targetSelect.innerHTML = '';
      var opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '雛形（新規大会の初期値）';
      targetSelect.appendChild(opt0);
      eventsCache.forEach(function(ev) {
        var o = document.createElement('option');
        o.value = ev.id;
        o.textContent = (ev.name || '(名称未設定)') + '（' + (ev.date || '日付なし') + '）';
        targetSelect.appendChild(o);
      });
      // 大会一覧が取れなかった（Api.listEvents() が null）ときは、ハッシュの大会IDが
      // 選択肢に無いことがある。表示名は分からないが、選択状態を保つため ID のまま足す。
      if (targetId && !eventById(targetId)) {
        var missing = document.createElement('option');
        missing.value = targetId;
        missing.textContent = targetId;
        targetSelect.appendChild(missing);
      }
      targetSelect.value = targetId;
    }

    // 対象を切り替える。前の TechEdit は destroy してから新しく mount する
    // （古い応答で表が入れ替わらないようにする）。
    function mountTarget(id) {
      if (handle) handle.destroy();
      targetId = id;
      location.hash = id ? '#' + encodeURIComponent(id) : '';
      var ev = eventById(id);
      handle = TechEdit.mount(editor, id, {
        events: eventsCache,
        title: ev ? (ev.name || '(名称未設定)') : id
      });
    }

    (async function() {
      applyTheme(Storage.loadTheme());

      var list = await Api.listEvents();
      var listFailed = (list === null);   // null＝取得失敗、[]＝大会0件（Api.listEvents の戻り値規約）
      eventsCache = Array.isArray(list) ? list : [];
      // 更新日の新しい順
      eventsCache.sort(function(a, b) {
        var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
        if (x === y) return 0;
        return x < y ? 1 : -1;
      });

      var hashId = '';
      try { hashId = decodeURIComponent(String(location.hash || '').replace(/^#/, '')); } catch (e) { hashId = ''; }
      // 一覧が取れているのに載っていない ID だけ捨てる。一覧の取得自体に失敗したときは
      // eventsCache が空になるだけで「その大会が無い」わけではないので、ハッシュの ID を
      // そのまま使う（GET /api/events/:id/techniques は一覧に依存しない）。
      if (!listFailed && hashId && !eventById(hashId)) hashId = '';
      targetId = hashId;
      fillTargetSelect();
      if (listFailed) alert('大会一覧を取得できませんでした。');
      mountTarget(targetId);

      targetSelect.addEventListener('change', function() {
        var next = targetSelect.value;
        if (handle && handle.isDirty() &&
            !confirm('編集中の内容は保存されていません。\n破棄して切り替えますか？')) {
          targetSelect.value = targetId;
          return;
        }
        mountTarget(next);
      });

      document.getElementById('btnTheme').addEventListener('click', function() {
        var current = Storage.loadTheme();
        var next = current === 'dark' ? 'light' : 'dark';
        Storage.saveTheme(next);
        applyTheme(next);
      });
    })();
```

- [ ] **Step 5: 技術リスト編集の画面で確認する（回帰の確認）**

`http://localhost:3461/techniques.html` を新しいタブ・幅 1280px で開く。
Expected:
- 「編集する対象」の行に選択肢とテーマボタン
- 見出し「雛形（新規大会の初期値）」、右に「保存」「デフォルト設定に戻す」（雛形では「別の大会からコピー」は出ない）
- 注記「ここで保存した内容は、これから作る大会の初期値になります。…」
- 表に技名と 4 つの配点が並ぶ（見た目は今までどおり）
- 対象を「PC土台テスト」に変える → 見出しが「PC土台テスト の技リスト」、ボタンが「別の大会からコピー」「保存」「雛形に戻す」、URL のハッシュが `#<大会ID>`
- 配点を 1 つ書き換えて、対象を雛形に戻そうとすると「編集中の内容は保存されていません。…」の確認が出る。キャンセルすると選択が戻る
- 「保存」→「保存しました。」。再読み込みすると保存した値が出る
- 「別の大会からコピー」→ 他の大会の一覧が出て、選ぶと「…を読み込みました。保存を押すまで…」。「閉じる」で消える
- 「雛形に戻す」→ 確認 → 「雛形に戻しました。」
- 採点済みの選手がいる大会を選ぶと「採点済みの選手が n 名います。…」の警告が出る
- スマホ幅（375px）でも表が横スクロールで四ノ太刀まで見える
- コンソールにエラーが出ていない

- [ ] **Step 6: コミット**

```bash
git add techedit.js techniques.html
git commit -m "refactor: 技リスト編集を techedit.js に切り出す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 技と配点の区画（`desk-techniques.js`）

`TechEdit` を PC 運営に埋め込む。ロック中（`final` / `archived`）は保存・雛形に戻す・コピーを無効にする。

**Files:**
- Modify: `desk-techniques.js`（プレースホルダーを置き換える）
- Modify: `desk.html`（`<script src="api.js">` の前に `data.js`、`desk.js` の前に `techedit.js`）

- [ ] **Step 1: `desk.html` にスクリプトを足す**

`desk.html` の `<script src="api.js"></script>` の直前に足す（`techedit.js` の通信断のフォールバックが `TECHNIQUES` を使う）。

```html
  <script src="data.js"></script>
```

`<script src="desk.js"></script>` の直前に足す。

```html
  <script src="techedit.js"></script>
```

- [ ] **Step 2: `desk-techniques.js` を書く**

ファイル全体を置き換える。

```js
// 技と配点の区画（#techniques/<id>）。techedit.js（技術リスト編集ページと共通）を埋め込む。
// 「別の大会からコピー」の候補にするため、描く前に大会一覧を取りに行く。
// 確定済み（final / archived）の大会では編集を無効にする（サーバーも 409 で拒む）。
(function() {
  var handle = null;

  async function render(container, ctx) {
    container.innerHTML = '';

    var box = document.createElement('div');
    container.appendChild(box);

    var loading = document.createElement('p');
    loading.className = 'desk-empty';
    loading.textContent = '読み込み中…';
    box.appendChild(loading);

    var events = await Api.listEvents();
    if (ctx.isStale()) return;   // 待っている間に区画を切り替えられた
    box.innerHTML = '';

    handle = TechEdit.mount(box, ctx.eventId, {
      events: Array.isArray(events) ? events : [],
      title: ctx.event.name || '(名称未設定)',
      readOnly: EventStatus.isLocked(EventStatus.of(ctx.event)),
      onSaved: function() { Desk.toast('技と配点を保存しました'); }
    });
  }

  // 区画を離れるときは TechEdit を片付ける（コピーのシートを残さない）
  function destroy() {
    if (handle) handle.destroy();
    handle = null;
  }

  Desk.registerTab('techniques', { render: render, destroy: destroy });
})();
```

- [ ] **Step 3: 画面で確認する**

`http://localhost:3461/desk.html#techniques/<PC土台テストの大会ID>` を新しいタブ・幅 1280px で開く。
Expected:
- 見出し「PC土台テスト の技リスト」と「別の大会からコピー」「保存」「雛形に戻す」
- 表の配点を書き換えて「保存」→「保存しました。」の alert と右下に「技と配点を保存しました」のトースト
- 「別の大会からコピー」で他の大会の一覧が出る。シートを開いたまま左のナビで「基本情報」に移ると、シートが残らない
- 上部の「次へ進む」で `最終結果` まで進めると、注記が「この大会は最終結果を確定済みです。…」になり、表の入力と 3 つのボタンが無効になる。「戻す」で編集できる状態に戻す
- ライト・ダークのどちらでも表が読める
- コンソールにエラーが出ていない

- [ ] **Step 4: コミット**

```bash
git add desk-techniques.js desk.html
git commit -m "feat: PC 運営の技と配点に techedit.js を埋め込む" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 選手の読み取り専用の表（`desk-players.js`）

新規作成・コピー・取り込みの落とし先が `#players/<id>` なので、空のプレースホルダーのままにしない。計画4で編集できる表に差し替えるので、**凝らない**（絞り込み・並べ替え・編集は作らない）。

**Files:**
- Modify: `desk-players.js`（プレースホルダーを置き換える）

- [ ] **Step 1: `desk-players.js` を書く**

ファイル全体を置き換える。

```js
// 選手の区画（#players/<id>）。計画2では読み取り専用の表。
// 編集できる表・行の追加・貼り付けによる一括登録は計画4で作る。
(function() {

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function render(container, ctx) {
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

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'いまは一覧だけです（PC で編集できる表と貼り付けによる一括登録は計画4で作ります）。' +
      '登録・訂正は 📱 でスマホ運営に切り替えて「選手」タブで行ってください。';
    container.appendChild(note);

    var players = ctx.players || [];
    if (players.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいません。';
      container.appendChild(none);
      return;
    }

    var table = document.createElement('table');
    table.className = 'desk-table';
    table.innerHTML =
      '<thead><tr><th>巡</th><th>No.</th><th>名前</th><th>コート</th><th>性別</th>' +
      '<th>新人</th><th>技1</th><th>技2</th><th>技3</th><th>得点</th></tr></thead>';
    var tbody = document.createElement('tbody');
    // 並びは選手タブと同じ既定（巡目 → コート → 性別 → 番号）
    Courts.sortBy(players, Courts.defaultSort()).forEach(function(p) {
      var key = Courts.orderKey(p);
      var tr = document.createElement('tr');
      tr.appendChild(cell(String(Courts.roundOf(p)), 'num'));
      tr.appendChild(cell(String(key.no || ''), 'num'));
      tr.appendChild(cell(p.name || '', 'desk-cell-main'));
      tr.appendChild(cell(Courts.courtOf(p)));
      tr.appendChild(cell(Courts.sexOf(p)));
      tr.appendChild(cell(p.isNewFace ? '○' : ''));
      tr.appendChild(cell(p.tech1 || ''));
      tr.appendChild(cell(p.tech2 || ''));
      tr.appendChild(cell(p.tech3 || ''));
      tr.appendChild(cell(String(p.score || 0), 'num'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  Desk.registerTab('players', { render: render });
})();
```

- [ ] **Step 2: 画面で確認する**

`http://localhost:3461/desk.html#players/<PC土台テストの大会ID>` を新しいタブ・幅 1280px で開く。
Expected:
- 見出し「選手」と右に「2 名」、注記、表（巡 / No. / 名前 / コート / 性別 / 新人 / 技1〜3 / 得点）
- 一巡目 → 二巡目の順、同じ巡目ではコート・性別・番号の順に並ぶ
- 選手のいない大会（コピーで作った大会など）では「まだ選手がいません。」
- 1280px で横スクロールが出ない

- [ ] **Step 3: コミット**

```bash
git add desk-players.js
git commit -m "feat: PC 運営の選手を読み取り専用の表で出す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: スマホ運営のヘッダーに 🖥（PC 運営へ）

設計書「モードの切り替え」。`admin.html` のヘッダー（テーマボタンの隣）に 🖥 を置き、押すとモードを控えて `desk.html` の対応する区画へ移る。

**Files:**
- Modify: `admin.html`（ヘッダー）
- Modify: `admin.js`（`init` のボタン登録）
- Modify: `admin.css`（`.topbar` の節）

- [ ] **Step 1: `admin.html` にボタンを足す**

`admin.html` の `<header class="topbar">` の行を置き換える。置き換え前:

```html
  <header class="topbar"><span id="topTitle">試し斬り 運営</span><button id="btnTheme" class="theme-btn" aria-label="テーマ切り替え">🌙</button><button id="btnAdminMenu" class="theme-btn" aria-label="メニュー">⋯</button></header>
```

置き換え後:

```html
  <header class="topbar"><span id="topTitle">試し斬り 運営</span><button id="btnTheme" class="theme-btn" aria-label="テーマ切り替え">🌙</button><button id="btnPc" class="theme-btn" aria-label="PC 運営に切り替える" title="PC 運営に切り替える">🖥</button><button id="btnAdminMenu" class="theme-btn" aria-label="メニュー">⋯</button></header>
```

- [ ] **Step 2: `admin.js` にハンドラを足す**

`admin.js` の `init` の中、`document.getElementById('btnAdminMenu').addEventListener('click', openAdminMenu);` の直後に足す。

```js
    // PC 運営へ。いま見ているタブに対応するハッシュを持っていく（storage.js の対応表）。
    var btnPc = document.getElementById('btnPc');
    if (btnPc) {
      btnPc.addEventListener('click', function() {
        Storage.saveMode('pc');
        location.href = Storage.modeHref(location.hash, 'pc');
      });
    }
```

- [ ] **Step 3: `admin.css` でタイトルを詰める**

上部バーのボタンが 3 つになるので、タイトルが潰れないように `#topTitle` の節を置き換える。置き換え前:

```css
#topTitle {
  flex: 1; font-weight: bold;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
```

置き換え後:

```css
/* ボタンが 3 つ（🌙 🖥 ⋯）並ぶので、最小幅を 0 にして大会名を省略できるようにする */
#topTitle {
  flex: 1; min-width: 0; font-weight: bold;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
```

- [ ] **Step 4: 画面で確認する**

`http://localhost:3461/admin.html#round/<PC土台テストの大会ID>` を新しいタブ・幅 375px で開く。
Expected:
- ヘッダーに 🌙 🖥 ⋯ が並び、大会名が潰れずに省略表示される
- 🖥 を押すと `desk.html#match/<同じ大会ID>` に移る（PC 運営の「試合」の区画。幅 375px なので「この画面は幅 1024px 以上の PC 向けです。」の案内が出る）
- そこで「スマホ運営（admin.html）に切り替える」を押すと `admin.html#round/<同じ大会ID>` に戻る
- ウィンドウ幅を 1280px にして `admin.html#players/<id>` から 🖥 → `desk.html#players/<id>`（同じ大会の選手の区画）、📱 で戻ると `admin.html#players/<id>`
- `admin.html#events` から 🖥 → `desk.html#events`
- `desk.html#setup/<id>` から 📱 → `admin.html#players/<id>`（PC にしか無い区画は選手タブに落ちる）

- [ ] **Step 5: コミット**

```bash
git add admin.html admin.js admin.css
git commit -m "feat: スマホ運営のヘッダーに PC 運営への切り替えを足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 完了条件

- `test.html` が `Result: N passed, 0 failed`。設計書のテスト 12（コピー）と、`Storage.mapHash` / `modeHref` / `adminHref` / `checkBundle`、`Courts.stageCountText` / `statusConfirmMessage` / `isTechIncomplete` が入っていること。計画1のテスト（1〜11・14・15）が通ったままであること
- `desk.html` を幅 1280px で開くと、上部の段階表示・左の 6 区画・大会一覧の表が横スクロールなしに収まる。ライト／ダークの両方で読める
- PC 運営で「新規作成 → 基本情報を保存 → 技と配点を保存 → 試合開始 → 一巡目を終了 → 二巡目なしで終了 → アーカイブ → 戻す」が一通りできる
- 「コピーして作成」で技と配点が複製され、選手は一巡目だけ・得点なしで複製される
- 「📂 取り込む」で `admin.html` と同じようにファイルから大会を作れる。スマホ運営の取り込みも壊れていない
- `techniques.html` の見た目と動きが切り出し前と同じ（対象の切り替え・保存・雛形に戻す・別の大会からコピー・採点済みの警告）
- 🖥/📱 で `#players/<id>` を保ったまま行き来でき、`#round` ⇔ `#match` が対応する
- 幅 1024px 未満の `desk.html` は「スマホ運営（admin.html）に切り替える」案内だけになる
- `server/static-policy.js` に新しいファイルが入っていて、`desk.html` 配下が 404 にならない
- 本物の大会「第10回全日本試し斬り大会」のデータが変わっていない（`git status` と大会一覧で確認する）
- 確認に使ったテスト用の大会（`PC土台テスト` `PC作成テスト` とそのコピー、取り込んだ大会、`削除テスト`）を消してある

## この計画でやらないこと（計画3以降）

- `index.html`（トップ）の作り直しと `home.js`、`scoring.html` への改名・転送、各ページのリンク修正（計画3）
- `Storage.adminHref` を実際に使う導線（トップの「運営画面を開く」、採点画面の「大会の作成は運営画面で」）。この計画では関数を用意してテストするところまで（計画3）
- `desk.js` の `scoringHref` を `scoring.html` に直すこと（計画3）
- PC の編集できる選手表・行の追加・貼り付けによる一括登録・`players/bulk` の行形式とテスト 13（計画4）
- PC の試合（コート別の状況・採点画面を開く・二巡目の生成と技入力）と結果（順位・発表・共有・配信ボード）（計画5）
- ヘルプ（`help.html`）の更新（計画3・5）
