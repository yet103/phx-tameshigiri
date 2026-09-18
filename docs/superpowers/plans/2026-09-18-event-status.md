# 大会の状態モデル（準備中 → 最終結果 → アーカイブ） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 大会に 7 段階の状態（`draft` / `round1` / `round1_done` / `round2` / `round2_done` / `final` / `archived`）を持たせ、運営者がボタンで進める形にする。採点画面は「進行中」のときだけ得点を送れるようにし、`final` 以降はサーバーが書き込みを 409 で拒む。

**Architecture:** 状態の判定は `status.js`（リポジトリ直下）に純粋関数として1箇所だけ置く。サーバーは `require('../status.js')`、ブラウザは `<script src="status.js">` で同じファイルを読む（UMD 風の包み）。`derive` は `courts.js` に依存できない（サーバーは `courts.js` を読めない）ので `order` の正規表現と採点済み判定を自前で持ち、`test.html` で `Courts.roundOf` / `Courts.isScored` と一致することを固定する。状態を変える経路はサーバーの `POST /api/events/:id/status` だけで、`POST /api/events` の body の `status` は無視する。

**Tech Stack:** 素の JavaScript（IIFE、`var`、`function`。`async`/`await` は可）、Express 5、`test.html`（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は `JSON.stringify` 比較）。

設計書: `docs/superpowers/specs/2026-09-18-pc-mode-and-event-status-design.md`（特に「状態モデル」「API」「画面設計 > 採点画面」「画面設計 > スマホ運営」「テスト」の節）

この計画は設計書「実装の分割」の **計画1: 状態モデル** だけを扱う。計画2以降（`desk.html`、`index.html` の作り直し、`scoring.html` への改名、コピー API、PC の選手表）は**やらない**。
**採点画面のファイル名はこの計画では `index.html` のまま**（改名は計画3）。

---

## 前提・共通の手順

- **サーバーの起動**: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。`package.json` の `npm start` は `node server/index.js` で、ポートは環境変数 `PORT`（既定 3457）。`.claude/launch.json` の `dev-3461` が同じ構成（`PORT=3461`）なので、開発中はそれを使う。既に起動していれば再利用する
- **サーバーを変えたら必ず再起動する**（`server/index.js` と `status.js` は `require` で読まれるので、プロセスを立て直さないと反映されない）。JS/CSS/HTML の変更だけならサーバー再起動は不要
- `.env` が無ければ Basic 認証は掛からない（`.env.example` のみ存在）。掛かっていれば `.env` の `AUTH_USER` / `AUTH_PASS` を使う
- **自動テスト**: `http://localhost:3461/test.html` をブラウザで開き、ページ末尾の `Result: N passed, 0 failed` を確認する。編集後の再確認は同じ URL への再 navigate ではなく `location.reload()` か**新しいタブ**で行う（bfcache で古い JS が使われるため）
- **画面確認**: `http://localhost:3461/index.html`（採点画面）と `http://localhost:3461/admin.html`（スマホ運営、幅 375px のモバイル表示）。検証に使う大会は**自分でこの作業中に作った大会だけ**にする。**本物の大会「第10回全日本試し斬り大会」のデータには絶対に触らない**（状態を進めたり選手を消したりしない）
- `git add` は**明示したファイルだけ**を対象にする（同じ作業ツリーで他の変更が staged になっている可能性がある）
- コミットメッセージは日本語。接頭辞は `feat:` `fix:` `test:` `docs:`。末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける
- **サーバーとクライアントで同じ判定を二重に持たない**。状態の判定は必ず `status.js` の関数を呼ぶ（`event.status === 'final'` のような直書きをしない）
- `admin-*.js` は `await` の後に必ず `ctx.isStale()` を見て、古い応答なら DOM に触らない（`alert` も出さない）

---

## ファイル構成

- **Create**: `status.js` — 状態の定数と純粋関数。UMD 風の包みでサーバーとブラウザの両方から読む
  - `STATES` `LABELS` `NEXT_LABELS` `canTransition(from,to)` `next(status)` `prev(status,players)` `isScoringOpen(status)` `scoringRound(status)` `isLocked(status)` `derive(event)` `of(event)`
- **Modify**: `server/static-policy.js` — `PROTECTED_FILES` に `status.js` を足す
- **Modify**: `server/index.js` — `require('../status.js')`、`rejectIfLocked` / `appendHistory` の追加、`POST /api/events/:id/status` の新設、`GET /api/events` と `GET /api/events/:id` に `status`、`POST /api/events` の `status` の扱い、9 本のハンドラにロックガード、二巡目生成の状態ガード
- **Modify**: `api.js` — `changeStatus(eventId, to)` の追加と公開
- **Modify**: `index.html` — 「＋ 新規大会」「大会削除」とモーダルの撤去、運営画面へのリンク、状態バナーの器、`<script src="status.js">`
- **Modify**: `app.js` — 大会作成・削除の撤去、選択肢の並び替えと状態つきの文言、状態バナー、巡目の絞り込み、採点操作の無効化、破棄警告の文言
- **Modify**: `style.css` — 状態バナーと採点ロックの見た目、運営画面リンク
- **Modify**: `admin.html` — `<script src="status.js">`
- **Modify**: `admin-events.js` — 行の副文に状態ラベル、`archived` を末尾の「アーカイブ」欄にまとめる
- **Modify**: `admin-round.js` — 段階表示（現在の状態・採点済み n / N）、「次へ進む」、⋯メニューの「戻す」「二巡目なしで終了」、「二巡目を生成」の有効条件
- **Modify**: `admin.css` — 段階表示・次へ進む・一覧の小見出し
- **Modify**: `test.html` — テスト 1〜11・14 の追加、既存の二巡目生成テストを遷移つきに直す
- **Modify**: `help.html` — 「0. 全体の流れ」と「2. 採点の進行」を新しい流れに合わせる（画像は差し替えない）

---

### Task 1: `status.js` を作る（テスト 1〜5）

**Files:**
- Create: `status.js`
- Modify: `server/static-policy.js`（`PROTECTED_FILES` の集合）
- Modify: `test.html`（`<script src="courts.js"></script>` の直後に `<script src="status.js"></script>`、テスト本体は `courts.js` 節の末尾＝`var h2tp = document.createElement('h2');` の直前）
- Modify: `index.html`（`<script src="courts.js"></script>` の直後）
- Modify: `admin.html`（`<script src="courts.js"></script>` の直後）

- [ ] **Step 1: 失敗するテストを書く**

まず `test.html` の 21 行目 `<script src="courts.js"></script>` の直後に 1 行足す。

```html
<script src="status.js"></script>
```

次に `test.html` の `courts.js` 節の末尾（`assert('sortBy: 元配列を変えない', ...)` の行の直後、`var h2tp = document.createElement('h2');` の前）に追記する。

```js
    var h2es = document.createElement('h2');
    h2es.textContent = 'status.js';
    results.appendChild(h2es);

    // ---- 1. canTransition（設計書「状態と遷移」の表） ----
    var OK_TRANSITIONS = [
      ['draft', 'round1'],
      ['round1', 'draft'], ['round1', 'round1_done'],
      ['round1_done', 'round1'], ['round1_done', 'round2'], ['round1_done', 'final'],
      ['round2', 'round1_done'], ['round2', 'round2_done'],
      ['round2_done', 'round2'], ['round2_done', 'final'],
      ['final', 'round2_done'], ['final', 'round1_done'], ['final', 'archived'],
      ['archived', 'final']
    ];
    assert('canTransition: 表にある組み合わせは全部 true',
      OK_TRANSITIONS.filter(function(t) { return !EventStatus.canTransition(t[0], t[1]); }), []);
    assert('canTransition: draft → round2 は false', EventStatus.canTransition('draft', 'round2'), false);
    assert('canTransition: draft → final は false', EventStatus.canTransition('draft', 'final'), false);
    assert('canTransition: round1 → round2 は false', EventStatus.canTransition('round1', 'round2'), false);
    assert('canTransition: round2 → final は false', EventStatus.canTransition('round2', 'final'), false);
    assert('canTransition: archived → draft は false', EventStatus.canTransition('archived', 'draft'), false);
    assert('canTransition: 同じ状態へは false', EventStatus.canTransition('round1', 'round1'), false);
    assert('canTransition: 未知の状態は false', EventStatus.canTransition('zzz', 'round1'), false);
    assert('canTransition: 未知の行き先は false', EventStatus.canTransition('draft', 'zzz'), false);

    // ---- 2. next / prev ----
    assert('next: draft → round1', EventStatus.next('draft'), 'round1');
    assert('next: round1_done → round2', EventStatus.next('round1_done'), 'round2');
    assert('next: round2_done → final', EventStatus.next('round2_done'), 'final');
    assert('next: final → archived', EventStatus.next('final'), 'archived');
    assert('next: archived は null', EventStatus.next('archived'), null);
    assert('next: 未知の状態は null', EventStatus.next('zzz'), null);

    var R1_ONLY = [{ order: 'A-男子-1-1' }, { order: 'A-男子-1-2' }];
    var R1_R2 = [{ order: 'A-男子-1-1' }, { order: 'A-男子-2-1' }];
    assert('prev: draft は null', EventStatus.prev('draft', R1_ONLY), null);
    assert('prev: round1 → draft', EventStatus.prev('round1', R1_ONLY), 'draft');
    assert('prev: round1_done → round1', EventStatus.prev('round1_done', R1_ONLY), 'round1');
    assert('prev: round2 → round1_done', EventStatus.prev('round2', R1_R2), 'round1_done');
    assert('prev: round2_done → round2', EventStatus.prev('round2_done', R1_R2), 'round2');
    assert('prev: final は二巡目があれば round2_done', EventStatus.prev('final', R1_R2), 'round2_done');
    assert('prev: final は二巡目が無ければ round1_done', EventStatus.prev('final', R1_ONLY), 'round1_done');
    assert('prev: final で players が無くても落ちない', EventStatus.prev('final', null), 'round1_done');
    assert('prev: archived → final', EventStatus.prev('archived', R1_ONLY), 'final');

    // ---- 3. derive ----
    function derivePlayers(list) { return EventStatus.derive({ players: list }); }
    assert('derive: 選手0名は draft', derivePlayers([]), 'draft');
    assert('derive: players が無くても draft', EventStatus.derive({}), 'draft');
    assert('derive: null でも draft', EventStatus.derive(null), 'draft');
    assert('derive: 一巡目が誰も採点していなければ draft',
      derivePlayers([{ order: 'A-男子-1-1', score: 0, result: '' }, { order: 'A-男子-1-2', score: 0, result: '' }]), 'draft');
    assert('derive: 一巡目が1人でも採点済みなら round1',
      derivePlayers([{ order: 'A-男子-1-1', score: 30, result: '1    ' }, { order: 'A-男子-1-2', score: 0, result: '' }]), 'round1');
    assert('derive: 一巡目が全員採点済みでも round1 のまま',
      derivePlayers([{ order: 'A-男子-1-1', score: 30, result: '1    ' }, { order: 'A-男子-1-2', score: 10, result: '1    ' }]), 'round1');
    assert('derive: 二巡目があり一部未採点なら round2',
      derivePlayers([
        { order: 'A-男子-1-1', score: 30, result: '1    ' },
        { order: 'A-男子-2-1', score: 10, result: '1    ' },
        { order: 'A-男子-2-2', score: 0, result: '' }
      ]), 'round2');
    assert('derive: 二巡目が全員採点済みなら round2_done',
      derivePlayers([
        { order: 'A-男子-1-1', score: 30, result: '1    ' },
        { order: 'A-男子-2-1', score: 10, result: '1    ' },
        { order: 'A-男子-2-2', score: 20, result: '1    ' }
      ]), 'round2_done');
    assert('derive: 二巡目が全員未採点なら round2',
      derivePlayers([
        { order: 'A-男子-1-1', score: 30, result: '1    ' },
        { order: 'A-男子-2-1', score: 0, result: '' }
      ]), 'round2');
    assert('derive: order が空の選手は一巡目として数える',
      derivePlayers([{ order: '', score: 30, result: '1    ' }]), 'round1');

    // ---- 4. derive の内部判定が Courts と一致する ----
    var CMP_PLAYERS = [
      { order: 'A-男子-1-1', score: 30, result: '1    ' },
      { order: 'A-男子-1-2', score: 0, result: '' },
      { order: 'A-男子-1-3', score: 0, result: '', adjust: [0, -3, 0] },
      { order: 'A-男子-1-4', score: 0, result: '', totalAdjust: 5 },
      { order: 'A-女子-2-1', score: 0, result: '0    ' },
      { order: '', score: 0, result: '' },
      { order: 'B-女子-2-10', score: 12, result: '11   ' }
    ];
    // derive は Courts に依存できない（サーバーは courts.js を読めない）ので同じ規則を2箇所に持つ。
    // 同じ入力で結果が一致することをここで固定する。
    assert('derive の巡目判定が Courts.roundOf と一致する',
      CMP_PLAYERS.map(function(p) { return EventStatus._roundOf(p); }),
      CMP_PLAYERS.map(function(p) { return Courts.roundOf(p); }));
    assert('derive の採点済み判定が Courts.isScored と一致する',
      CMP_PLAYERS.map(function(p) { return EventStatus._isScored(p); }),
      CMP_PLAYERS.map(function(p) { return Courts.isScored(p); }));

    // ---- 5. of / isScoringOpen / scoringRound / isLocked / ラベル ----
    assert('of: 有効な status はそのまま', EventStatus.of({ status: 'final', players: [] }), 'final');
    assert('of: 不正な文字列は derive', EventStatus.of({ status: 'zzz', players: [] }), 'draft');
    assert('of: status が無ければ derive',
      EventStatus.of({ players: [{ order: 'A-男子-1-1', score: 30, result: '1    ' }] }), 'round1');
    assert('of: null でも draft', EventStatus.of(null), 'draft');

    assert('isScoringOpen: round1 / round2 だけ true',
      EventStatus.STATES.filter(EventStatus.isScoringOpen), ['round1', 'round2']);
    assert('scoringRound: round1 は 1', EventStatus.scoringRound('round1'), 1);
    assert('scoringRound: round2 は 2', EventStatus.scoringRound('round2'), 2);
    assert('scoringRound: それ以外は null', EventStatus.scoringRound('round1_done'), null);
    assert('isLocked: final / archived だけ true',
      EventStatus.STATES.filter(EventStatus.isLocked), ['final', 'archived']);

    assert('STATES は7段階',
      EventStatus.STATES,
      ['draft', 'round1', 'round1_done', 'round2', 'round2_done', 'final', 'archived']);
    assert('LABELS は全状態にある',
      EventStatus.STATES.filter(function(s) { return !EventStatus.LABELS[s]; }), []);
    assert('LABELS: round1 は「一巡目 進行中」', EventStatus.LABELS.round1, '一巡目 進行中');
    assert('NEXT_LABELS: draft は「試合開始」', EventStatus.NEXT_LABELS.draft, '試合開始');
    assert('NEXT_LABELS: round1_done は「二巡目を開始」', EventStatus.NEXT_LABELS.round1_done, '二巡目を開始');
    assert('NEXT_LABELS: archived は null', EventStatus.NEXT_LABELS.archived, null);
```

- [ ] **Step 2: テストが失敗することを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。`status.js` はまだ無いので `<script src="status.js">` が 404 になり、`EventStatus is not defined` でスクリプトが止まる（`Result` 行が出ない）ことを確認する。

- [ ] **Step 3: `status.js` を作る**

リポジトリ直下に `status.js` を新規作成する。

```js
// 大会の状態（準備中 → 一巡目 → … → アーカイブ）。
// サーバー（server/index.js の require）とブラウザ（<script src="status.js">）の
// 両方から読むので、リポジトリ直下に置いて UMD 風の包みにする。
// 判定をここ1箇所にまとめ、画面・API・テストで同じ関数を使う。
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventStatus = factory();
})(this, function() {

  var STATES = ['draft', 'round1', 'round1_done', 'round2', 'round2_done', 'final', 'archived'];

  var LABELS = {
    draft: '準備中',
    round1: '一巡目 進行中',
    round1_done: '一巡目終了',
    round2: '二巡目 進行中',
    round2_done: '二巡目終了',
    final: '最終結果',
    archived: 'アーカイブ'
  };

  // 「次へ進む」ボタンの文言。archived から進む先は無い。
  var NEXT_LABELS = {
    draft: '試合開始',
    round1: '一巡目を終了',
    round1_done: '二巡目を開始',
    round2: '二巡目を終了',
    round2_done: '最終結果を確定',
    final: 'アーカイブ',
    archived: null
  };

  // 許される遷移（設計書「状態と遷移」の表）。ここに無い組み合わせはサーバーが 409 で拒む。
  var TRANSITIONS = {
    draft: ['round1'],
    round1: ['draft', 'round1_done'],
    round1_done: ['round1', 'round2', 'final'],
    round2: ['round1_done', 'round2_done'],
    round2_done: ['round2', 'final'],
    final: ['round2_done', 'round1_done', 'archived'],
    archived: ['final']
  };

  // ---- courts.js と同じ規則の私物コピー ----
  // derive はサーバーでも動く必要があり、サーバーは courts.js（IIFE のブラウザ用）を読めない。
  // そこで order の解析と採点済み判定をここに複製する。両者が一致することは
  // test.html の「derive の巡目判定が Courts.roundOf と一致する」で固定する。
  // courts.js の roundOf / isScored を変えたら、必ずここも同じに変えること。
  var ORDER_PATTERN = /^([^-]+)-(男子|女子)-(\d+)-(\d+)$/;

  function roundOf(player) {
    var order = (player && typeof player.order === 'string') ? player.order : '';
    var m = order.match(ORDER_PATTERN);
    return m ? parseInt(m[3], 10) : 1;
  }

  function isScored(player) {
    if (!player) return false;
    if (typeof player.score === 'number' && player.score > 0) return true;
    if (/[01]/.test(player.result || '')) return true;
    if (Array.isArray(player.adjust)) {
      for (var i = 0; i < player.adjust.length; i++) {
        if (Number(player.adjust[i])) return true;
      }
    }
    return !!Number(player.totalAdjust);
  }

  function playersOf(event) {
    return (event && Array.isArray(event.players)) ? event.players : [];
  }

  function rowsOfRound(players, round) {
    return (players || []).filter(function(p) { return roundOf(p) === round; });
  }

  // ---- 判定関数 ----

  function canTransition(from, to) {
    var list = Object.prototype.hasOwnProperty.call(TRANSITIONS, from) ? TRANSITIONS[from] : null;
    return !!list && list.indexOf(to) !== -1;
  }

  // 表の右隣。archived と未知の状態は null。
  function next(status) {
    var i = STATES.indexOf(status);
    if (i === -1 || i === STATES.length - 1) return null;
    return STATES[i + 1];
  }

  // 「戻す」の行き先。draft と未知の状態は null。
  // final からは二巡目の行があれば round2_done、無ければ round1_done。
  function prev(status, players) {
    if (status === 'final') {
      return rowsOfRound(players, 2).length > 0 ? 'round2_done' : 'round1_done';
    }
    var i = STATES.indexOf(status);
    if (i <= 0) return null;
    return STATES[i - 1];
  }

  // コート端末で得点を送れる状態か。
  function isScoringOpen(status) {
    return status === 'round1' || status === 'round2';
  }

  // 採点の対象になる巡目。進行中でなければ null。
  function scoringRound(status) {
    if (status === 'round1') return 1;
    if (status === 'round2') return 2;
    return null;
  }

  // 得点・選手・技の書き込みをサーバーが拒む状態か。
  function isLocked(status) {
    return status === 'final' || status === 'archived';
  }

  // status を持たない大会の状態を選手から推定する（設計書「状態の無い既存データ」）。
  // 「一巡目が全員採点済みで二巡目が無い」は round1 のまま（運営者が
  // 「一巡目を終了」を押すのが新しい流れなので、推定で先へ進めない）。
  function derive(event) {
    var players = playersOf(event);
    if (players.length === 0) return 'draft';
    var r2 = rowsOfRound(players, 2);
    if (r2.length > 0) {
      for (var i = 0; i < r2.length; i++) {
        if (!isScored(r2[i])) return 'round2';
      }
      return 'round2_done';
    }
    for (var j = 0; j < players.length; j++) {
      if (roundOf(players[j]) !== 2 && isScored(players[j])) return 'round1';
    }
    return 'draft';
  }

  // 大会の状態。ファイルの status が有効ならそれ、無ければ推定値。
  function of(event) {
    if (event && STATES.indexOf(event.status) !== -1) return event.status;
    return derive(event);
  }

  return {
    STATES: STATES,
    LABELS: LABELS,
    NEXT_LABELS: NEXT_LABELS,
    canTransition: canTransition,
    next: next,
    prev: prev,
    isScoringOpen: isScoringOpen,
    scoringRound: scoringRound,
    isLocked: isLocked,
    derive: derive,
    of: of,
    // courts.js との一致をテストで固定するためだけに出す（画面からは使わない）
    _roundOf: roundOf,
    _isScored: isScored
  };
});
```

- [ ] **Step 4: 静的配信の許可リストに足す**

`server/static-policy.js` の `PROTECTED_FILES` の最終行 `'courts.js', 'data.js', 'outbox.js', 'route.js', 'storage.js', 'techpicker.js'` を次に置き換える。

```js
  'courts.js', 'data.js', 'outbox.js', 'route.js', 'status.js', 'storage.js', 'techpicker.js'
```

- [ ] **Step 5: 採点画面と運営画面でも読めるようにする**

`index.html` の `<script src="courts.js"></script>` の直後に足す（依存が無いので `api.js` より前でよい）。

```html
  <script src="status.js"></script>
```

`admin.html` の `<script src="courts.js"></script>` の直後に足す。

```html
  <script src="status.js"></script>
```

- [ ] **Step 6: テストが通ることを確認する**

サーバーを再起動してから（`static-policy.js` を変えたため）、`test.html` を新しいタブで開く。
Expected: 上の `status.js` 節の assert が全部 ✓ で、`Result: N passed, 0 failed`。

- [ ] **Step 7: コミット**

```bash
git add status.js server/static-policy.js test.html index.html admin.html
git commit -m "feat: 大会の状態モデル status.js を足す（遷移表・推定・判定関数）" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `GET` の応答に `status` を足し、`POST /api/events` の `status` を無視する（テスト 6・14）

**Files:**
- Modify: `server/index.js`（6 行目付近の `require`、`GET /api/events`、`GET /api/events/:id`、`POST /api/events`）
- Test: `test.html`（`runApiTests` の中。`assert('listEvents は配列', ...)` の直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `assert('listEvents は配列', Array.isArray(events), true);` の行の直後に追記する。

```js
    // ---- 6 / 14. 大会の状態（status）の既定値と読み出し ----
    var stdEvent = await Api.saveEvent({ name: '状態既定テスト', date: '2026-02-01', venue: '', players: [] });
    assert('新規作成の大会は draft', (await Api.loadEvent(stdEvent.id)).status, 'draft');
    // body の status は無視され、既存の値（ここでは draft）が引き継がれる
    await Api.saveEvent({ id: stdEvent.id, name: '状態既定テスト', date: '2026-02-01', venue: '',
      status: 'final', players: [] });
    assert('POST /api/events の body の status は無視される',
      (await Api.loadEvent(stdEvent.id)).status, 'draft');
    var stdList = (await Api.listEvents()).filter(function(e) { return e.id === stdEvent.id; })[0];
    assert('GET /api/events の各要素に status がある', stdList && stdList.status, 'draft');
    await Api.deleteEvent(stdEvent.id);

    // status を持たないファイル（この機能より前の大会・取り込んだ大会）は選手から推定する。
    // POST /api/events/import は status を書かないので、取り込んだ大会で確かめる。
    var derSrc = await Api.saveEvent({ name: '推定元テスト', date: '2026-02-01', venue: '', players: [] });
    await Api.importCsv(derSrc.id,
      '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' +
      'D1,A-男子-1-1,真,,,30,,,1    \n' +
      'D2,A-男子-1-2,真,,,0,,,\n', 'replace');
    var derImported = await Api.importBundle(JSON.parse(await Api.exportBundle(derSrc.id)));
    assert('status を持たない大会は選手から推定される（一部採点済み → round1）',
      (await Api.loadEvent(derImported.id)).status, 'round1');
    var derList = (await Api.listEvents()).filter(function(e) { return e.id === derImported.id; })[0];
    assert('一覧でも推定値が返る', derList && derList.status, 'round1');
    await Api.deleteEvent(derSrc.id);
    await Api.deleteEvent(derImported.id);
```

- [ ] **Step 2: テストが失敗することを確認する**

`test.html` を新しいタブで開く。
Expected: `新規作成の大会は draft` が `got: undefined expected: "draft"` で ✗ になる（`failed` が 0 でない）。

- [ ] **Step 3: サーバーで `status.js` を読む**

`server/index.js` の 6 行目 `const { classify } = require('./static-policy');` の直後に足す。

```js
// 大会の状態。クライアント（<script src="status.js">）と同じファイルを読む。
// 判定を2箇所に持たないため、状態に関わる分岐は必ずこのモジュールを通す。
const EventStatus = require('../status.js');
```

- [ ] **Step 4: 一覧と詳細に `status` を足す**

`GET /api/events` の `return {` ブロックに 1 行足す（`playerCount` の次）。

```js
      return {
        id: data.id,
        name: data.name,
        date: data.date,
        venue: data.venue,
        playerCount: Array.isArray(data.players) ? data.players.length : 0,
        // ファイルに status が無ければ選手から推定する（ファイルには書かない）
        status: EventStatus.of(data),
        updatedAt: data.updatedAt,
        createdAt: data.createdAt
      };
```

`GET /api/events/:id` の `data.techniques = effectiveTechniques(data);` の直後に足す。

```js
    // 状態も応答にだけ足す。status を持たない大会は選手から推定した値を返す。
    data.status = EventStatus.of(data);
```

- [ ] **Step 5: `POST /api/events` で body の `status` を無視する**

`POST /api/events` の `const eventPath = path.join(EVENTS_DIR, \`${event.id}.json\`);` の直後（`// 既存の shareToken を落とさない。` のコメントの前）に足す。

```js
    // status はこの経路では変えない。状態を変える経路は POST /api/events/:id/status だけ。
    // body に status が入っていても捨て、既存の大会ならその値（無ければ推定値）を
    // 引き継ぐ。新規なら draft。shareToken と同じ扱い。
    delete event.status;
    let carriedStatus = 'draft';
    if (fs.existsSync(eventPath)) {
      try {
        const prevForStatus = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
        carriedStatus = EventStatus.of(prevForStatus);
      } catch (e) {
        // 壊れた既存ファイルは上書きを止めない（draft のまま）
      }
    }
    event.status = carriedStatus;
```

- [ ] **Step 6: サーバーを再起動してテストが通ることを確認する**

サーバーを止めて `PORT=3461 node server/index.js` で立て直し、`test.html` を新しいタブで開く。
Expected: 上の 6 件が ✓ で、`Result: N passed, 0 failed`。

- [ ] **Step 7: コミット**

```bash
git add server/index.js test.html
git commit -m "feat: 大会の応答に status を足し、POST /api/events の status を無視する" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 状態の遷移 API と `Api.changeStatus`（テスト 7・8・9）

**Files:**
- Modify: `server/index.js`（`DELETE /api/events/:id` の直後に新ルート、`writeJsonAtomic` の直後に `appendHistory`）
- Modify: `api.js`（`deleteEvent` の直後に `changeStatus`、末尾の `return {}` に公開）
- Test: `test.html`（Task 2 で足した `status` のテストの直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の Task 2 で足した `await Api.deleteEvent(derImported.id);` の直後に追記する。

```js
    // ---- 7 / 8 / 9. 状態の遷移 API ----
    var stEvent = await Api.saveEvent({ name: '遷移テスト', date: '2026-02-01', venue: '', players: [] });

    var stEmpty = await Api.changeStatus(stEvent.id, 'round1');
    assert('選手0名の draft → round1 は 409 empty',
      [stEmpty.ok, stEmpty.status, stEmpty.reason], [false, 409, 'empty']);
    assert('409 empty は理由の文言を返す', stEmpty.error, '一巡目の選手がいません');

    await Api.createPlayer(stEvent.id, { name: 'S1', court: 'A' });
    var stSkip = await Api.changeStatus(stEvent.id, 'round2');
    assert('draft → round2 は 409 transition',
      [stSkip.ok, stSkip.status, stSkip.reason], [false, 409, 'transition']);
    assert('409 transition は理由の文言を返す', stSkip.error, 'この状態からは進めません');

    var stOk = await Api.changeStatus(stEvent.id, 'round1');
    assert('draft → round1 は通る', [stOk.ok, stOk.status], [true, 'round1']);
    assert('遷移後の GET に新しい status が入る', (await Api.loadEvent(stEvent.id)).status, 'round1');

    var stHist = await Api.loadHistory(stEvent.id);
    var stLast = stHist.entries[stHist.entries.length - 1];
    assert('遷移がサーバー側で履歴に残る', [stLast.action, stLast.detail],
      ['status_change', '準備中 → 一巡目 進行中']);
    assert('遷移の履歴に時刻が付く', typeof stLast.timestamp, 'string');

    await Api.changeStatus(stEvent.id, 'round1_done');
    var stNoR2 = await Api.changeStatus(stEvent.id, 'round2');
    assert('二巡目が0件なら round1_done → round2 は 409 no_round2',
      [stNoR2.ok, stNoR2.status, stNoR2.reason], [false, 409, 'no_round2']);
    assert('409 no_round2 は理由の文言を返す', stNoR2.error, '二巡目が生成されていません');

    var stFinal = await Api.changeStatus(stEvent.id, 'final');
    assert('二巡目なしで round1_done → final に進める', [stFinal.ok, stFinal.status], [true, 'final']);
    var stBack = await Api.changeStatus(stEvent.id, 'round1_done');
    assert('final から round1_done に戻せる（二巡目が無いとき）',
      [stBack.ok, stBack.status], [true, 'round1_done']);

    var stBad = await Api.changeStatus(stEvent.id, 'nosuchstate');
    assert('STATES に無い状態は 400', [stBad.ok, stBad.status], [false, 400]);
    assert('存在しない大会の遷移は 404', (await Api.changeStatus('nosuchevent', 'round1')).status, 404);
    await Api.deleteEvent(stEvent.id);
```

- [ ] **Step 2: テストが失敗することを確認する**

`test.html` を新しいタブで開く。
Expected: `Api.changeStatus is not a function` で `runApiTests` が止まり、`Result` 行が出ない。

- [ ] **Step 3: サーバーに履歴の追記関数を足す**

`server/index.js` の `writeJsonAtomic` の関数定義の直後（`// 順位の集計。` のコメントの前）に足す。

```js
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
```

- [ ] **Step 4: 遷移 API を足す**

`server/index.js` の `DELETE /api/events/:id`（`app.delete('/api/events/:id', ...)`）の閉じ括弧 `});` の直後、`// ── Player API ──` のコメントの前に足す。

```js
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
        players.filter(p => roundOf(p) === 1).length === 0) {
      return res.status(409).json({ error: '一巡目の選手がいません', reason: 'empty' });
    }
    // 二巡目の行が無ければ二巡目は始められない（先に生成する）
    if (from === 'round1_done' && to === 'round2' &&
        players.filter(p => roundOf(p) === 2).length === 0) {
      return res.status(409).json({ error: '二巡目が生成されていません', reason: 'no_round2' });
    }

    event.status = to;
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    appendHistory(req.params.id, {
      action: 'status_change',
      detail: EventStatus.LABELS[from] + ' → ' + EventStatus.LABELS[to]
    });
    res.json({ success: true, status: to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 5: `api.js` に `changeStatus` を足す**

`api.js` の `deleteEvent` 関数の閉じ括弧 `}` の直後（`// --- Players ---` のコメントの前）に足す。

```js
  async function changeStatus(eventId, to) {
    // POST /api/events/:eventId/status
    // Body: { to: 'round1' }
    // 戻り値: { ok: true, status: 新しい状態 }
    //       | { ok: false, status: HTTPステータス, reason, error }（400 / 404 / 409）
    //       | null（通信そのものの失敗）
    // 409 の reason は 'transition' | 'empty' | 'no_round2'。画面はこれで
    // 「読み直す」「先に生成する」などの次の行動を出し分けるので、error だけでなく
    // reason も返す（他の API と違って ok:false に理由を載せるのはこのため）。
    try {
      var res = await fetch('/api/events/' + eventId + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to })
      });
      if (!res.ok) {
        var errJson = null;
        try { errJson = await res.json(); } catch (e) { /* JSON でない応答 */ }
        return {
          ok: false,
          status: res.status,
          reason: (errJson && errJson.reason) || '',
          error: (errJson && errJson.error) ||
                 ('サーバーがエラーを返しました（' + res.status + '）')
        };
      }
      var json = await res.json();
      return { ok: true, status: json.status };
    } catch (e) {
      return null;
    }
  }
```

末尾の `return {` の `deleteEvent: deleteEvent,` の次の行に公開名を足す。

```js
    deleteEvent: deleteEvent,
    changeStatus: changeStatus,
```

- [ ] **Step 6: サーバーを再起動してテストが通ることを確認する**

サーバーを立て直し、`test.html` を新しいタブで開く。
Expected: 上の 15 件が ✓ で、`Result: N passed, 0 failed`。

- [ ] **Step 7: コミット**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 大会の状態を変える遷移 API と Api.changeStatus を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `final` / `archived` のロックガード（テスト 10）

**Files:**
- Modify: `server/index.js`（`appendHistory` の直後に `rejectIfLocked`、9 本のハンドラに 1 行ずつ、`POST /api/events` に 1 箇所）
- Test: `test.html`（Task 3 で足した遷移テストの直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の Task 3 で足した `await Api.deleteEvent(stEvent.id);` の直後に追記する。

```js
    // ---- 10. ロックガード（final / archived は書き込めない） ----
    // Api の関数はステータスコードを丸めるものがあるので、ここは直接 fetch して
    // 「409 かつ reason: locked」を確かめる。
    async function writeResult(url, method, body) {
      var res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      var json = null;
      try { json = await res.json(); } catch (e) { /* 本文が JSON でなくてもよい */ }
      return { status: res.status, reason: (json && json.reason) || '' };
    }

    var lockEvent = await Api.saveEvent({ name: 'ロックテスト', date: '2026-02-01', venue: '', players: [] });
    await Api.importCsv(lockEvent.id,
      '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' +
      'L1,A-男子-1-1,真,,,30,,,1    \n' +
      'L2,A-男子-1-2,真,,,10,,,1    \n', 'replace');
    await Api.changeStatus(lockEvent.id, 'round1');
    await Api.changeStatus(lockEvent.id, 'round1_done');
    await Api.generateNextRound(lockEvent.id, false);
    await Api.changeStatus(lockEvent.id, 'round2');
    await Api.changeStatus(lockEvent.id, 'round2_done');
    assert('round2_done → final に進める',
      (await Api.changeStatus(lockEvent.id, 'final')).status, 'final');

    var lockP = (await Api.loadEvent(lockEvent.id)).players[0];
    var lockBase = '/api/events/' + lockEvent.id;
    assert('確定後の大会上書きは 409 locked',
      await writeResult('/api/events', 'POST', { id: lockEvent.id, name: 'ロックテスト', players: [] }),
      { status: 409, reason: 'locked' });
    assert('確定後の選手追加は 409 locked',
      await writeResult(lockBase + '/players', 'POST', { name: 'L3', court: 'A' }),
      { status: 409, reason: 'locked' });
    assert('確定後の一括登録は 409 locked',
      await writeResult(lockBase + '/players/bulk', 'POST', { court: 'A', names: ['L3'] }),
      { status: 409, reason: 'locked' });
    assert('確定後の PATCH は 409 locked',
      await writeResult(lockBase + '/players/' + lockP.id, 'PATCH', { name: 'X' }),
      { status: 409, reason: 'locked' });
    assert('確定後の選手削除は 409 locked',
      await writeResult(lockBase + '/players/' + lockP.id + '?force=1', 'DELETE'),
      { status: 409, reason: 'locked' });
    assert('確定後の CSV 取り込みは 409 locked',
      await writeResult(lockBase + '/import', 'POST', { csvText: '選手名\n', mode: 'append' }),
      { status: 409, reason: 'locked' });
    assert('確定後の技の PUT は 409 locked',
      await writeResult(lockBase + '/techniques', 'PUT',
        { techniques: [{ name: '真', strikes: [1, null, null, null] }] }),
      { status: 409, reason: 'locked' });
    assert('確定後の技の DELETE は 409 locked',
      await writeResult(lockBase + '/techniques', 'DELETE'),
      { status: 409, reason: 'locked' });
    assert('確定後の二巡目生成は 409 locked',
      await writeResult(lockBase + '/rounds/2/generate', 'POST', { force: true }),
      { status: 409, reason: 'locked' });
    assert('確定後の putLive は 409 locked',
      await writeResult(lockBase + '/live/A', 'PUT', { playerId: lockP.id }),
      { status: 409, reason: 'locked' });

    // 拒まない経路
    assert('確定後も GET は読める', (await Api.loadEvent(lockEvent.id)).status, 'final');
    assert('確定後も共有リンクは発行できる',
      !!(await Api.createShareLink(lockEvent.id)).token, true);

    // 戻すと編集できる
    var lockBack = await Api.changeStatus(lockEvent.id, 'round2_done');
    assert('final から round2_done に戻せる（二巡目があるとき）',
      [lockBack.ok, lockBack.status], [true, 'round2_done']);
    assert('戻したあとは PATCH が通る',
      (await Api.updatePlayerInfo(lockEvent.id, lockP.id, { name: 'L1改' })).ok, true);

    // アーカイブも同じく書けない
    await Api.changeStatus(lockEvent.id, 'final');
    await Api.changeStatus(lockEvent.id, 'archived');
    assert('アーカイブ中の PATCH は 409 locked',
      await writeResult(lockBase + '/players/' + lockP.id, 'PATCH', { name: 'Y' }),
      { status: 409, reason: 'locked' });
    assert('アーカイブから final に戻せる',
      (await Api.changeStatus(lockEvent.id, 'final')).status, 'final');
    assert('確定済みでも大会そのものは削除できる', await Api.deleteEvent(lockEvent.id), true);
```

- [ ] **Step 2: テストが失敗することを確認する**

`test.html` を新しいタブで開く。
Expected: `確定後の大会上書きは 409 locked` 以下が `got: {"status":200,"reason":""}` などで ✗ になる。

- [ ] **Step 3: ロックガードの共通関数を足す**

`server/index.js` の `appendHistory` 関数の直後に足す。

```js
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
```

- [ ] **Step 4: 9 本のハンドラにガードを足す**

次のハンドラで、`const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));` の**直後**に 1 行足す。

```js
    if (rejectIfLocked(res, event)) return;
```

対象（`app.<method>('<path>')` で探す）:

1. `POST /api/events/:id/players`
2. `POST /api/events/:id/players/bulk`
3. `PATCH /api/events/:id/players/:playerId`
4. `DELETE /api/events/:id/players/:playerId`
5. `POST /api/events/:id/import`
6. `PUT /api/events/:id/techniques`
7. `DELETE /api/events/:id/techniques`
8. `POST /api/events/:id/rounds/2/generate`
9. `PUT /api/events/:id/live/:court`

- [ ] **Step 5: `POST /api/events` の上書きにもガードを足す**

Task 2 の Step 5 で足したブロックの `try` の中身を次に差し替える（`carriedStatus` の読み出しと同じ `prevForStatus` を使う）。

```js
    delete event.status;
    let carriedStatus = 'draft';
    if (fs.existsSync(eventPath)) {
      try {
        const prevForStatus = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
        // 確定済みの大会を丸ごと上書きさせない（得点・選手・技が消える）
        if (rejectIfLocked(res, prevForStatus)) return;
        carriedStatus = EventStatus.of(prevForStatus);
      } catch (e) {
        // 壊れた既存ファイルは上書きを止めない（draft のまま）
      }
    }
    event.status = carriedStatus;
```

注意: `rejectIfLocked` は例外を投げない（応答を書いて真偽を返すだけ）ので、`try` の中から `return` して問題ない。ここで拒んだ時点で `writeJsonAtomic` には到達しない。

- [ ] **Step 6: サーバーを再起動してテストが通ることを確認する**

サーバーを立て直し、`test.html` を新しいタブで開く。
Expected: 上の 17 件が ✓ で、`Result: N passed, 0 failed`。

- [ ] **Step 7: コミット**

```bash
git add server/index.js test.html
git commit -m "feat: 最終結果を確定した大会への書き込みを 409 locked で拒む" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 二巡目生成は `round1_done` のときだけ通す（テスト 11・既存テストの修正）

**Files:**
- Modify: `server/index.js`（`POST /api/events/:id/rounds/2/generate`）
- Test: `test.html`（`runApiTests` の先頭に補助関数、`--- 二巡目の生成 ---` 節と往復テストの修正、新しい assert の追加）

- [ ] **Step 1: テスト用の補助関数を足す**

`test.html` の `runApiTests` の冒頭、`results.appendChild(h2);` の直後に足す。

```js
    // 二巡目の生成は状態が round1_done のときだけ通る。
    // 生成を使うテストはこの補助で draft → round1 → round1_done と進めてから呼ぶ。
    async function toRound1Done(eventId) {
      await Api.changeStatus(eventId, 'round1');
      await Api.changeStatus(eventId, 'round1_done');
    }
```

- [ ] **Step 2: 既存の二巡目生成テストを遷移つきに直す**

`test.html` の以下 6 箇所を直す。

(a) `await Api.importCsv(genEvent.id, genCsv, 'replace');` の直後に 1 行足す。

```js
    await toRound1Done(genEvent.id);
```

(b) `await Api.importCsv(unsEvent.id, unsCsv, 'replace');` の直後に 1 行足す。

```js
    await toRound1Done(unsEvent.id);
```

(c) 「一巡目が0名なら 400」のブロックを次のとおり置き換える。置き換え前:

```js
    // 一巡目が0名なら 400
    var emptyEvent = await Api.saveEvent({ name: '空テスト', date: '2026-02-01', venue: '', players: [] });
    assert('一巡目が0名なら null', await Api.generateNextRound(emptyEvent.id, false), null);
    await Api.deleteEvent(emptyEvent.id);
```

置き換え後:

```js
    // 選手0名の大会は round1 に進めないので、生成は状態で拒まれる
    var emptyEvent = await Api.saveEvent({ name: '空テスト', date: '2026-02-01', venue: '', players: [] });
    var emptyGen = await Api.generateNextRound(emptyEvent.id, false);
    assert('準備中の大会の生成は状態で拒まれる', [emptyGen.blocked, emptyGen.reason], [true, 'status']);
    await Api.deleteEvent(emptyEvent.id);

    // round1_done まで進めてから一巡目を全員消すと、400（一巡目の選手がいません）になる
    var goneEvent = await Api.saveEvent({ name: '全消しテスト', date: '2026-02-01', venue: '', players: [] });
    await Api.importCsv(goneEvent.id,
      '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\nG1,A-男子-1-1,真,,,30,,,1    \n', 'replace');
    await toRound1Done(goneEvent.id);
    var goneP = (await Api.loadEvent(goneEvent.id)).players[0];
    await Api.deletePlayer(goneEvent.id, goneP.id, true);
    assert('一巡目が0名なら null', await Api.generateNextRound(goneEvent.id, false), null);
    await Api.deleteEvent(goneEvent.id);
```

(d) `await Api.importCsv(diffEvent.id, diffCsv, 'replace');` の直後に 1 行足す。

```js
    await toRound1Done(diffEvent.id);
```

(e) `unaEvent` の `Api.saveEvent({ name: '未分類テスト', ... })` の**直後**（`var unaGen = ...` の前）に 1 行足す。

```js
    await toRound1Done(unaEvent.id);
```

(f) 往復テストの `var rtRound = await Api.generateNextRound(rtEvent.id);` の**直前**に 1 行足す。

```js
    await toRound1Done(rtEvent.id);
```

- [ ] **Step 3: 状態ガードの新しいテストを書く**

`test.html` の `assert('存在しない大会の二巡目生成は null', await Api.generateNextRound('nosuchevent', false), null);` の直後に追記する。

```js
    // ---- 11. 二巡目の生成は「一巡目終了」のときだけ ----
    var stGenEvent = await Api.saveEvent({ name: '生成状態テスト', date: '2026-02-01', venue: '', players: [] });
    await Api.importCsv(stGenEvent.id,
      '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' +
      'T1,A-男子-1-1,真,,,30,,,1    \n' +
      'T2,A-男子-1-2,真,,,10,,,1    \n', 'replace');
    var genDraft = await Api.generateNextRound(stGenEvent.id, false);
    assert('準備中では二巡目を生成できない', [genDraft.blocked, genDraft.reason], [true, 'status']);
    await Api.changeStatus(stGenEvent.id, 'round1');
    var genRound1 = await Api.generateNextRound(stGenEvent.id, false);
    assert('一巡目 進行中では二巡目を生成できない', [genRound1.blocked, genRound1.reason], [true, 'status']);
    assert('生成を拒まれても選手は増えない',
      (await Api.loadEvent(stGenEvent.id)).players.length, 2);
    await Api.changeStatus(stGenEvent.id, 'round1_done');
    assert('一巡目終了なら二巡目を生成できる',
      (await Api.generateNextRound(stGenEvent.id, false)).created, 2);
    await Api.deleteEvent(stGenEvent.id);
```

- [ ] **Step 4: テストが失敗することを確認する**

`test.html` を新しいタブで開く。
Expected: `準備中では二巡目を生成できない` が `got: [undefined,undefined] expected: [true,"status"]` で ✗ になる（この時点ではガードが無いので生成が通ってしまう）。

- [ ] **Step 5: 生成ハンドラに状態ガードを足す**

`server/index.js` の `POST /api/events/:id/rounds/2/generate` で、Task 4 で足した `if (rejectIfLocked(res, event)) return;` の直後に足す。

```js
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
```

- [ ] **Step 6: サーバーを再起動してテストが通ることを確認する**

サーバーを立て直し、`test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`。特に既存の `generateNextRound の created は一巡目の人数` `未採点があれば拒否される` `差分追加の created は1` `往復テスト用に二巡目が生成される` が ✓ のままであること。

- [ ] **Step 7: コミット**

```bash
git add server/index.js test.html
git commit -m "feat: 二巡目の生成を「一巡目終了」のときだけ通す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 採点画面から大会の作成・削除を外す

**Files:**
- Modify: `index.html`（インライン `<style>` の `.modal*` 群、`.event-bar` のボタン、`newEventModal` のブロック）
- Modify: `app.js`（`bindEvents` の大会管理イベント、`createEvent`、`onDeleteEvent`）
- Modify: `style.css`（「ページリンクバー」節の直前に 1 ブロック）

コート端末に全コートのデータを消す操作を置かない、という既存の方針（`btnExport` のコメント参照）をそろえる作業。

- [ ] **Step 1: `index.html` からモーダルとボタンを外す**

インライン `<style>` の先頭 5 行（`.modal-overlay` から `.modal-actions` まで）を削除する。削除するのは次の 6 行。

```css
    .modal-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1000; }
    .modal { background:var(--bg,#fff); padding:24px; border-radius:8px; min-width:320px; }
    .modal h3 { margin-top:0; }
    .modal label { display:block; margin-bottom:12px; }
    .modal input { display:block; width:100%; padding:8px; margin-top:4px; box-sizing:border-box; }
    .modal-actions { display:flex; gap:8px; justify-content:flex-end; }
```

`.event-bar` の 2 つのボタンを 1 本のリンクに置き換える。置き換え前:

```html
    <button id="btnNewEvent">＋ 新規大会</button>
    <button id="btnDeleteEvent">大会削除</button>
```

置き換え後:

```html
    <a class="event-admin-link" id="linkEventAdmin" href="admin.html#events">大会の作成は運営画面で</a>
```

「大会作成モーダル」のブロック（`<!-- 大会作成モーダル -->` のコメントから `newEventModal` の `</div>` まで、13 行）をまるごと削除する。

同じ位置に状態バナーの器を置く（Task 8 で中身を入れる）。`<!-- 保存失敗バナー -->` のブロックの**直前**に足す。

```html
  <!-- 状態バナー（app.js の renderStatusBanner が中身を入れる） -->
  <div class="status-banner" id="statusBanner" hidden></div>
```

- [ ] **Step 2: `style.css` に見た目を足す**

`/* ===== ページリンクバー ===== */` の行の直前に足す。

```css
/* ===== 大会バーの運営画面リンク・状態バナー =====
   大会の作成と削除は運営画面だけに置く（コート端末から全コートのデータを消せないようにする）。
   状態バナーは大会バーのすぐ下で「いま採点できるか」を言葉で出す。 */
.event-admin-link {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  color: var(--band-muted);
  font-size: 13px;
  text-decoration: underline;
}
.status-banner {
  padding: 8px 12px;
  font-size: 14px;
  border-bottom: 1px solid var(--border);
}
.status-banner.open { background: var(--bg-secondary); color: var(--text-muted); }
.status-banner.closed { background: var(--warn); color: var(--banner-text); font-weight: bold; }
```

- [ ] **Step 3: `app.js` から大会の作成・削除を外す**

`bindEvents` の中の次の 4 ブロック（`btnNewEvent` のリスナーから `btnDeleteEvent` のリスナーまで、`document.getElementById('btnNewEvent').addEventListener(` の行から `});` で閉じる `btnDeleteEvent` のブロックまで）を削除する。

```js
    document.getElementById('btnNewEvent').addEventListener('click', function() { ... });
    document.getElementById('btnCancelNewEvent').addEventListener('click', function() { ... });
    document.getElementById('btnCreateEvent').addEventListener('click', async function() { ... });
    document.getElementById('btnDeleteEvent').addEventListener('click', function() { ... });
```

`createEvent` 関数と `onDeleteEvent` 関数もまるごと削除する（`// 戻り値: 作成できたら true。...` のコメントから `onDeleteEvent` の閉じ括弧まで）。

削除したあと、`// --- 選手切り替え ---` のコメントの直前に案内のコメントを残す。

```js
  // 大会の作成・削除は運営画面（admin.html#events）にある。
  // コート端末から全コート分のデータを消せる操作を置かないため、この画面からは外した。
```

- [ ] **Step 4: 参照が残っていないことを確認する**

```bash
grep -n "btnNewEvent\|btnDeleteEvent\|newEventModal\|btnCreateEvent\|btnCancelNewEvent\|newEventName\|newEventDate\|newEventVenue\|createEvent\|onDeleteEvent\|modal" index.html app.js style.css
```

Expected: 何も出ない（0 行）。出たら消し漏れなので直す。

- [ ] **Step 5: 画面で確認する**

`http://localhost:3461/index.html` を新しいタブで開く。
Expected: 大会バーに「＋ 新規大会」「大会削除」が無く、「大会の作成は運営画面で」のリンクが出ている。リンクを押すと `admin.html#events` が開く。大会を選んで採点できる（ここまでの変更では採点の動きは変わらない）。ブラウザのコンソールにエラーが出ていないこと。

- [ ] **Step 6: コミット**

```bash
git add index.html app.js style.css
git commit -m "feat: 採点画面から大会の作成・削除を外し、運営画面へのリンクにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 採点画面の大会選択肢を状態で並べ替える

**Files:**
- Modify: `app.js`（`refreshEventList`）

- [ ] **Step 1: `refreshEventList` を書き換える**

`app.js` の `async function refreshEventList() { ... }` の本体を次に置き換える。

```js
  // 大会の選択肢。archived は出さず、採点できる大会（進行中）を先頭にまとめる。
  // 文言は「大会名（一巡目 進行中）」。当日どれを選べばよいかを一目で分かるようにする。
  async function refreshEventList() {
    var events = await Api.listEvents();
    if (!events) {
      // 取得できなかっただけで、大会が消えたわけではない。
      // 一覧を空にすると「大会が無くなった」ように見えるので、今の表示を保つ。
      alert('大会一覧を取得できませんでした。通信を確認してください。');
      return;
    }
    var usable = events.filter(function(e) { return EventStatus.of(e) !== 'archived'; });
    var open = usable.filter(function(e) { return EventStatus.isScoringOpen(EventStatus.of(e)); });
    var rest = usable.filter(function(e) { return !EventStatus.isScoringOpen(EventStatus.of(e)); });
    var ordered = open.concat(rest);   // 各群の中は listEvents の順（更新の新しい順）のまま

    var select = document.getElementById('eventSelect');
    select.innerHTML = '<option value="">-- 大会を選択 --</option>';
    for (var i = 0; i < ordered.length; i++) {
      select.appendChild(eventOption(ordered[i]));
    }
    // 前回選択していた大会があれば再選択。一覧から外れている（アーカイブされた）
    // ときは選択肢を足して残す。黙って別の大会に切り替わるのを防ぐ。
    if (currentEvent) {
      var found = false;
      for (var j = 0; j < ordered.length; j++) {
        if (ordered[j].id === currentEvent.id) { found = true; break; }
      }
      if (!found) select.appendChild(eventOption(currentEvent));
      select.value = currentEvent.id;
    }
  }

  function eventOption(ev) {
    var opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = (ev.name || '(名称未設定)') + '（' + EventStatus.LABELS[EventStatus.of(ev)] + '）';
    return opt;
  }
```

- [ ] **Step 2: 画面で確認する**

まず確認用の大会を 3 つ作る（運営画面 `admin.html#events` の「＋ 新規大会」から）。名前は「状態確認テスト1」「状態確認テスト2」「状態確認テスト3」にする。テスト1 に選手を 2 名足し、進行タブで「試合開始」…はまだ Task 11 で作るので、ここでは API を直接叩いて状態を進める。ブラウザのアドレスバーではなく、`test.html` を開いたタブの開発者コンソールで次を実行する（`<id>` は運営画面の URL のハッシュから取る）。

```js
await Api.changeStatus('<テスト1のID>', 'round1');
await Api.changeStatus('<テスト3のID>', 'round1');
await Api.changeStatus('<テスト3のID>', 'round1_done');
await Api.changeStatus('<テスト3のID>', 'final');
await Api.changeStatus('<テスト3のID>', 'archived');
```

`http://localhost:3461/index.html` を新しいタブで開き、大会の選択肢を見る。
Expected:
- 「状態確認テスト1（一巡目 進行中）」が先頭にある
- 「状態確認テスト2（準備中）」がその後ろにある
- 「状態確認テスト3」は選択肢に出ない（アーカイブ）

- [ ] **Step 3: コミット**

```bash
git add app.js
git commit -m "feat: 採点画面の大会選択肢から archived を外し、進行中を先頭に状態つきで並べる" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 採点画面の状態バナー・巡目の絞り込み・採点操作の無効化

**Files:**
- Modify: `app.js`（`applyCourtFilter`、`refreshFromServer`、`renderScoreGrid`、`onEventSelect`、`onStrikeClick`、新規の 4 関数）
- Modify: `style.css`（Task 6 で足した節に追記）

- [ ] **Step 1: `app.js` に状態の補助関数を足す**

`// --- 大会管理 ---` のコメントの直前（`applyCourtFilter` の閉じ括弧の直後）に足す。

```js
  // --- 大会の状態 ---
  // 状態は大会を選んだときの値で判定する（ポーリングはしない設計）。
  // 運営が状態を変えたら、コート端末は「大会を選び直す」運用。
  // 既存の「選手を足したら選び直す」と同じ扱いで、help.html に書いてある。

  function currentStatus() {
    return currentEvent ? EventStatus.of(currentEvent) : null;
  }

  function scoringOpen() {
    return !!currentEvent && EventStatus.isScoringOpen(currentStatus());
  }

  // 大会選択バーの下の状態バナー。採点できるかどうかと、できないときの次の手を出す。
  function renderStatusBanner() {
    var el = document.getElementById('statusBanner');
    if (!el) return;
    if (!currentEvent) { el.hidden = true; el.textContent = ''; return; }
    var st = currentStatus();
    el.hidden = false;
    if (EventStatus.isScoringOpen(st)) {
      el.className = 'status-banner open';
      el.textContent = EventStatus.LABELS[st];
      return;
    }
    el.className = 'status-banner closed';
    if (EventStatus.isLocked(st)) {
      el.textContent = 'この大会は「' + EventStatus.LABELS[st] + '」です。得点は編集できません。' +
        '運営画面で「戻す」を押すと編集できます。';
    } else if (EventStatus.isScoringOpen(EventStatus.next(st))) {
      // draft → 試合開始、round1_done → 二巡目を開始。次へ進めば採点できる
      el.textContent = 'この大会は「' + EventStatus.LABELS[st] + '」です。運営画面で「' +
        EventStatus.NEXT_LABELS[st] + '」を押すと採点できます。';
    } else {
      // round2_done。次へ進むと確定してしまうので、戻す方を案内する
      el.textContent = 'この大会は「' + EventStatus.LABELS[st] + '」です。' +
        '運営画面で「戻す」を押すと採点に戻れます。';
    }
  }

  // 採点できない状態のとき、得点に関わる操作を全部止める。
  // 前後の選手の移動・タイマー・CSVエクスポート・HTML保存は使える（設計書「採点画面」）。
  function applyScoringLock() {
    var locked = !!currentEvent && !scoringOpen();
    document.body.classList.toggle('scoring-locked', locked);
    btnConfirm.disabled = locked;
    document.getElementById('btnAllSuccess').disabled = locked;
    document.getElementById('btnAllFail').disabled = locked;
    if (locked) {
      totalAdjustInput.disabled = true;
      noteInput.disabled = true;
    }
    var inputs = scoreTableBody.querySelectorAll('.adjust-input');
    for (var i = 0; i < inputs.length; i++) inputs[i].disabled = locked;
  }

  // 表示する選手。進行中ならその巡目だけに絞る（コートの絞り込みと併用）。
  // 進行中でなければ全巡目を出す（見直し・確認のため）。
  function filterForStatus(list) {
    var round = currentEvent ? EventStatus.scoringRound(currentStatus()) : null;
    if (!round) return list;
    return list.filter(function(p) { return Courts.roundOf(p) === round; });
  }
```

- [ ] **Step 2: 絞り込みに巡目を効かせる**

`applyCourtFilter` の先頭 1 行を置き換える。置き換え前:

```js
    visiblePlayers = Courts.filter(players, currentCourt);
```

置き換え後:

```js
    visiblePlayers = filterForStatus(Courts.filter(players, currentCourt));
```

`applyCourtFilter` の末尾 `refreshPlayerList();` の直後に 2 行足す。

```js
    renderStatusBanner();
    applyScoringLock();
```

`refreshFromServer` の中の同じ 1 行も置き換える。置き換え前:

```js
    visiblePlayers = Courts.filter(players, currentCourt);
```

置き換え後:

```js
    visiblePlayers = filterForStatus(Courts.filter(players, currentCourt));
```

`refreshFromServer` の末尾 `updatePlayerList();` の直後（関数の最後）に 2 行足す。

```js
    renderStatusBanner();
    applyScoringLock();
```

- [ ] **Step 3: グリッドを描き直すたびにロックを掛け直す**

`renderScoreGrid` には `return` が 2 箇所ある（技が未入力のときの早期 `return` と関数末尾）。どちらも `applyConfirmedStyle(...)` を呼んだ**直後**に 1 行足す。

技が未入力のときの早期 `return` の直前:

```js
      applyConfirmedStyle(!!player.confirmed);
      applyScoringLock();
      return;
```

関数末尾:

```js
    applyConfirmedStyle(!!player.confirmed);
    applyScoringLock();
  }
```

- [ ] **Step 4: 大会を離れたときにバナーを消す**

`onEventSelect` の `if (!eventId) { ... }` ブロックの `if (templateTechniques) Scoring.setTechniques(templateTechniques);` の直前に 2 行足す。

```js
      renderStatusBanner();
      applyScoringLock();
```

- [ ] **Step 5: 太刀のセルにも念のためのガードを足す**

`onStrikeClick` 関数の本体の 1 行目に足す（CSS の `pointer-events` が効かない環境でも二重に止める）。

```js
    if (!scoringOpen()) return;   // 採点できない状態（理由はバナーに出ている）
```

- [ ] **Step 6: `style.css` に無効時の見た目を足す**

Task 6 で足した `.status-banner.closed` の行の直後に足す。

```css
/* 採点できない状態。太刀のセルは押せなくし、全体を薄く見せる */
body.scoring-locked .strike-cell { pointer-events: none; opacity: 0.55; }
body.scoring-locked .action-bar button[disabled] { opacity: 0.45; }
```

- [ ] **Step 7: 画面で確認する**

Task 7 で作った「状態確認テスト1」（`round1`）と「状態確認テスト2」（`draft`）を使う。テスト1 の選手が 2 名以上いることを確認し、開発者コンソールから二巡目まで進める。

```js
// テスト1 を一巡目終了 → 二巡目生成 → 二巡目 進行中 まで進める
await Api.changeStatus('<テスト1のID>', 'round1_done');
await Api.generateNextRound('<テスト1のID>', true);
await Api.changeStatus('<テスト1のID>', 'round2');
```

`http://localhost:3461/index.html` を新しいタブで開く。
Expected:
1. 「状態確認テスト2（準備中）」を選ぶ → バナーに「この大会は「準備中」です。運営画面で「試合開始」を押すと採点できます。」が警告色で出る。確定・形成功・失敗のボタンが押せず、補正点と備考の入力も無効。太刀のセルを押しても何も変わらない。前後の選手の移動とタイマーは使える
2. 「状態確認テスト1（二巡目 進行中）」を選ぶ → バナーが淡い色で「二巡目 進行中」。選手一覧に**二巡目の行だけ**が並ぶ（`order` が `-2-` の行）。確定と得点の入力ができる
3. コンソールから `await Api.changeStatus('<テスト1のID>', 'round2_done')` を実行して大会を選び直す → バナーが「この大会は「二巡目終了」です。運営画面で「戻す」を押すと採点に戻れます。」になり、一巡目と二巡目の両方の行が一覧に出る。採点はできない
4. さらに `'final'` へ進めて選び直す → バナーが「この大会は「最終結果」です。得点は編集できません。運営画面で「戻す」を押すと編集できます。」になる
5. どの状態でも「CSVエクスポート」「HTML保存」「🌙 ダーク」は使える

- [ ] **Step 8: 自動テストが落ちていないことを確認する**

`test.html` を新しいタブで開き、`Result: N passed, 0 failed` であること。

- [ ] **Step 9: コミット**

```bash
git add app.js style.css
git commit -m "feat: 採点画面に状態バナーを出し、進行中の巡目だけを採点できるようにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 破棄した採点の警告に状態の確認を足す

**Files:**
- Modify: `app.js`（`onSaveDiscarded`）

`Outbox` は 4xx を「何度送っても通らない」として捨てる（`outbox.js` の `isPermanentFailure`）。`final` の大会への PATCH は 409 なのでここで捨てられる。捨てた理由に「大会の状態」が加わったことを警告に書く。

- [ ] **Step 1: 警告の文言を直す**

`app.js` の `onSaveDiscarded` の末尾の `alert(...)` を次に置き換える。置き換え前:

```js
    alert('保存できなかった採点が ' + entries.length + ' 件あります。\n' +
          '対象の選手がサーバー上に見つかりませんでした。\n' +
          '（名簿を入れ直した直後などに起きます）\n\n' + detail + '\n\n' +
          '該当する選手の採点を確認し、必要なら入力し直してください。');
```

置き換え後:

```js
    alert('保存できなかった採点が ' + entries.length + ' 件あります。\n' +
          'サーバーが受け付けませんでした。\n' +
          '（名簿を入れ直した直後や、大会が「最終結果」「アーカイブ」になっているときに起きます）\n\n' +
          detail + '\n\n' +
          '運営画面で状態を確認してください。\n' +
          '該当する選手の採点を確認し、必要なら入力し直してください。');
```

- [ ] **Step 2: 画面で確認する**

「状態確認テスト1」を `final` にしてから採点画面で開き、採点を試みる。バナーが出て確定は押せないので、送信キューに積むには開発者コンソールから直接積む。

```js
// 採点画面のタブのコンソールで
Outbox.enqueue({ eventId: '<テスト1のID>', playerId: '<選手のID>', score: 1, result: '1    ' });
Outbox.flushNow();
```

Expected: 数秒後に「保存できなかった採点が 1 件あります。…運営画面で状態を確認してください。」の alert が出る。

- [ ] **Step 3: コミット**

```bash
git add app.js
git commit -m "fix: 破棄した採点の警告に「運営画面で状態を確認してください」を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: スマホ運営・大会タブに状態を出す

**Files:**
- Modify: `admin-events.js`（`render` の一覧の組み立て、`buildRow`）
- Modify: `admin.css`（「一覧の行」節の直後）

- [ ] **Step 1: 行の副文に状態ラベルを足す**

`admin-events.js` の `buildRow` の中の `sub.textContent = ...` の 1 行を置き換える。置き換え前:

```js
    sub.textContent = (ev.date || '日付なし') + ' ・ ' + (ev.playerCount || 0) + '名';
```

置き換え後:

```js
    sub.textContent = (ev.date || '日付なし') + ' ・ ' + (ev.playerCount || 0) + '名 ・ ' +
      EventStatus.LABELS[EventStatus.of(ev)];
```

- [ ] **Step 2: `archived` を末尾の「アーカイブ」欄にまとめる**

`admin-events.js` の `render` の末尾（`events.sort(...)` の直後）の次のブロックを置き換える。置き換え前:

```js
    events.forEach(function(ev) {
      list.appendChild(buildRow(ev));
    });
```

置き換え後:

```js
    // アーカイブ済みは末尾にまとめる。当日の運営で押し間違えないよう、
    // 進行中・準備中の大会と混ぜない。
    var active = events.filter(function(ev) { return EventStatus.of(ev) !== 'archived'; });
    var archived = events.filter(function(ev) { return EventStatus.of(ev) === 'archived'; });
    active.forEach(function(ev) { list.appendChild(buildRow(ev)); });
    if (archived.length > 0) {
      var head2 = document.createElement('div');
      head2.className = 'list-head';
      head2.textContent = 'アーカイブ（' + archived.length + ' 件）';
      list.appendChild(head2);
      archived.forEach(function(ev) { list.appendChild(buildRow(ev)); });
    }
```

- [ ] **Step 3: `admin.css` に小見出しの見た目を足す**

`/* ===== 選手タブの絞り込みと表 =====` のコメントの直前に足す。

```css
/* 一覧の中の小見出し（大会タブの「アーカイブ（n 件）」） */
.list-head {
  padding: 12px 12px 4px;
  font-size: 12px;
  font-weight: bold;
  color: var(--text-muted);
  border-top: 1px solid var(--border);
  margin-top: 8px;
}
```

- [ ] **Step 4: 画面で確認する**

`http://localhost:3461/admin.html#events` を新しいタブ・幅 375px で開く。
Expected:
- 「状態確認テスト2」の副文が `（日付）・ 0名 ・ 準備中` のようになっている
- 「状態確認テスト1」の副文に `最終結果`（Task 9 で final にしたため）が出ている
- 一覧の末尾に「アーカイブ（1 件）」の小見出しがあり、その下に「状態確認テスト3」が並ぶ

- [ ] **Step 5: コミット**

```bash
git add admin-events.js admin.css
git commit -m "feat: スマホ運営の大会一覧に状態ラベルを出し、アーカイブを末尾にまとめる" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: スマホ運営・進行タブの段階表示と遷移操作

**Files:**
- Modify: `admin-round.js`（`render` の見出し、`buildMenu`、新規の `buildStage` / `stageCountText` / `advanceMessage` / `changeStatus`）
- Modify: `admin.css`（「進行タブ」節）

- [ ] **Step 1: `admin-round.js` に段階表示と遷移の関数を足す**

`// --- 描画 ---` のコメントの直前に足す。

```js
  // --- 段階表示と遷移 ---

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

  // 設計書「確認と拒否」の表の確認文言。承諾したときだけ遷移する。
  function advanceMessage(from, to, players) {
    if (from === 'draft' && to === 'round1') {
      var r1 = roundOne(players);
      return '一巡目 ' + r1.length + '名。技が未入力の選手が ' +
        r1.filter(isTechIncomplete).length + '名います。\n試合を開始しますか？';
    }
    if (from === 'round1' && to === 'round1_done') {
      var a = roundOne(players);
      return '一巡目の未採点が ' + a.filter(function(p) { return !Courts.isScored(p); }).length +
        '名います。\n一巡目を終了しますか？';
    }
    if (from === 'round1_done' && to === 'round2') {
      var b = roundTwo(players);
      return '二巡目 ' + b.length + '名。技が未入力の選手が ' +
        b.filter(isTechIncomplete).length + '名います。\n二巡目を開始しますか？';
    }
    if (from === 'round1_done' && to === 'final') {
      return '二巡目を行わずに最終結果にします。\nよろしいですか？';
    }
    if (from === 'round2' && to === 'round2_done') {
      var c = roundTwo(players);
      return '二巡目の未採点が ' + c.filter(function(p) { return !Courts.isScored(p); }).length +
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

  // 状態を変える。失敗の理由はサーバーの文言をそのまま出す。
  // transition の 409 は他の端末が先に進めていた場合なので、画面を読み直す。
  async function applyStatus(from, to) {
    var ctx = CTX;
    if (!confirm(advanceMessage(from, to, ctx.players))) return;
    var res = await Api.changeStatus(ctx.eventId, to);
    if (ctx.isStale()) return;   // 通信中に大会やタブを切り替えられた
    if (!res) {
      alert('状態を変えられませんでした。通信を確認してください。');
      return;
    }
    if (!res.ok) {
      alert(res.error);
      await Admin.reloadEvent();   // 他の端末が先に進めていた可能性がある
      return;
    }
    Admin.toast(EventStatus.LABELS[to] + ' にしました');
    await Admin.reloadEvent();
  }

  // 進行タブの先頭の段階表示。現在の状態と「次へ進む」。
  // 件数は下の .round-stat（stageCountText）に出す。
  // 「戻す」と「二巡目なしで終了」は ⋯ メニュー（buildMenu）にある。
  function buildStage(st) {
    var wrap = document.createElement('div');
    wrap.className = 'round-stage';

    var label = document.createElement('div');
    label.className = 'round-stage-label';
    label.id = 'roundStageLabel';
    label.textContent = '現在の状態: ' + EventStatus.LABELS[st];
    wrap.appendChild(label);

    var next = EventStatus.next(st);
    if (next) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'round-next';
      btn.id = 'btnRoundNext';
      btn.textContent = EventStatus.NEXT_LABELS[st] + ' ▶';
      btn.addEventListener('click', function() { applyStatus(st, next); });
      wrap.appendChild(btn);
    }
    return wrap;
  }
```

- [ ] **Step 2: `render` の見出しを組み替える**

`render` の中の「見出し：一巡目の採点状況・生成ボタン・メニュー」のブロックのうち、コメント行から `head.appendChild(genBtn);` までを次に置き換える（`var src` と `var scored` はこの中でしか使っていないので消してよい。`onGenerate` は自前で数え直す）。置き換え前:

```js
    // 見出し：一巡目の採点状況・生成ボタン・メニュー
    var head = document.createElement('div');
    head.className = 'round-head';
    var src = roundOne(players);
    var scored = src.filter(Courts.isScored).length;
    var stat = document.createElement('div');
    stat.className = 'round-stat';
    stat.id = 'roundScoredStat';
    stat.textContent = '一巡目 採点済み ' + scored + ' / ' + src.length;
    head.appendChild(stat);
    var genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'round-gen';
    genBtn.id = 'btnGenRound2';
    genBtn.textContent = '二巡目を生成';
    genBtn.addEventListener('click', onGenerate);
    head.appendChild(genBtn);
```

置き換え後:

```js
    // 段階表示（現在の状態と「次へ進む」）を先頭に置く
    var st = EventStatus.of(ctx.event);
    container.appendChild(buildStage(st));

    // 見出し：採点の進み具合・生成ボタン・メニュー
    var head = document.createElement('div');
    head.className = 'round-head';
    var stat = document.createElement('div');
    stat.className = 'round-stat';
    stat.id = 'roundScoredStat';
    stat.textContent = stageCountText(st, players);
    head.appendChild(stat);
    var genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'round-gen';
    genBtn.id = 'btnGenRound2';
    genBtn.textContent = '二巡目を生成';
    // 生成できるのは「一巡目終了」のときだけ（サーバーも 409 status で拒む）
    if (st !== 'round1_done') {
      genBtn.disabled = true;
      genBtn.title = '「一巡目終了」のときだけ生成できます（今は「' + EventStatus.LABELS[st] + '」）';
    } else {
      genBtn.addEventListener('click', onGenerate);
    }
    head.appendChild(genBtn);
```

さらに下の `head.appendChild(buildMenu());` を次に置き換える（メニューに状態の項目を渡すため）。

```js
    head.appendChild(buildMenu(st, players));
```

- [ ] **Step 3: ⋯メニューに「戻す」と「二巡目なしで終了」を足す**

`buildMenu` の関数定義を次に置き換える。置き換え前は `function buildMenu() { ... }`。

```js
  function buildMenu(st, players) {
    bindOutsideClickOnce();
    var menu = document.createElement('details');
    menu.className = 'round-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    menu.appendChild(sum);

    // 戻す（prev が無い draft では出さない）
    var back = EventStatus.prev(st, players);
    if (back) {
      var btnBack = document.createElement('button');
      btnBack.type = 'button';
      btnBack.id = 'btnRoundBack';
      btnBack.textContent = '◀ ' + EventStatus.LABELS[back] + ' に戻す';
      btnBack.addEventListener('click', function() {
        menu.open = false;
        applyStatus(st, back);
      });
      menu.appendChild(btnBack);
    }

    // 二巡目なしで終了（一巡目終了のときだけ）
    if (st === 'round1_done') {
      var btnSkip = document.createElement('button');
      btnSkip.type = 'button';
      btnSkip.id = 'btnRoundSkipRound2';
      btnSkip.textContent = '二巡目なしで終了';
      btnSkip.addEventListener('click', function() {
        menu.open = false;
        applyStatus(st, 'final');
      });
      menu.appendChild(btnSkip);
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnRoundExport';
    btn.textContent = 'CSVエクスポート';
    btn.addEventListener('click', async function() {
      menu.open = false;
      var ctx = CTX;
      var csv = await Api.exportCsv(ctx.eventId);
      if (ctx.isStale()) return;  // 通信中に大会やタブを切り替えられた
      if (!csv) { alert('エクスポートに失敗しました。'); return; }
      Storage.downloadCsv('players.csv', csv);
    });
    menu.appendChild(btn);
    return menu;
  }
```

- [ ] **Step 4: `admin.css` に段階表示の見た目を足す**

`/* ===== 進行タブ（admin-round.js） ===== */` のコメントの直後に足す。

```css
/* 段階表示（現在の状態と「次へ進む」）。進行タブの先頭に置く */
.round-stage {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 12px; margin-bottom: 4px;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px;
}
.round-stage-label { flex: 1 1 auto; font-size: 15px; font-weight: bold; }
.round-next {
  min-height: 44px; padding: 0 14px;
  background: var(--accent); color: var(--accent-text);
  border: none; border-radius: 4px; font-size: 14px; font-weight: bold;
}
```

さらに `.round-gen` の定義の直後に無効時の見た目を足す。

```css
.round-gen[disabled] { opacity: 0.45; }
```

- [ ] **Step 5: 画面で確認する（手動確認の 2〜4 行目）**

確認用に新しい大会「進行確認テスト」を作り、選手を 2 名登録して技を 3 つずつ入れる（運営画面の選手タブ）。`http://localhost:3461/admin.html` を幅 375px で開く。

Expected（設計書「手動確認」の 2〜4 行目をスマホ運営で）:
1. 進行タブの先頭に「現在の状態: 準備中」と「試合開始 ▶」が出る。「二巡目を生成」が無効で、`title` に理由が出る
2. 「試合開始 ▶」を押す → 確認文言「一巡目 2名。技が未入力の選手が 0名います。試合を開始しますか？」→ OK で「一巡目 進行中 にしました」のトースト。段階表示が「現在の状態: 一巡目 進行中」、見出しが「採点済み 0 / 2」になる
3. 採点画面（別タブ）で同じ大会を選び直す → バナーが「一巡目 進行中」で、一巡目の選手だけが出る。採点して確定できる
4. 運営で「一巡目を終了 ▶」を押す → 採点画面で大会を選び直すとバナーが警告色になり、確定が押せない
5. 「二巡目を生成」が有効になっている。押して二巡目を作り、技を入れる →「二巡目を開始 ▶」→ 採点画面で選び直すと二巡目の選手だけが出る
6. ⋯ メニューに「◀ …に戻す」が出る。押すと確認のうえ1つ前に戻る。`round1_done` のときだけ「二巡目なしで終了」が出る
7. `draft` のときは ⋯ メニューに「戻す」が出ない
8. `round2_done` まで進めて「最終結果を確定 ▶」→ 選手タブで名前を直そうとすると `alert('この大会は最終結果を確定済みです')` が出る。⋯ メニューの「◀ 二巡目終了 に戻す」で編集できるようになる
9. `final` で「アーカイブ ▶」を押す → 大会タブの「アーカイブ」欄に移り、採点画面の選択肢から消える

- [ ] **Step 6: 自動テストが落ちていないことを確認する**

`test.html` を新しいタブで開き、`Result: N passed, 0 failed` であること。

- [ ] **Step 7: 確認に使った大会を片付ける**

「状態確認テスト1」「状態確認テスト2」「状態確認テスト3」「進行確認テスト」を運営画面から削除する（アーカイブ中でも削除はできる）。**本物の大会には触らない**。

- [ ] **Step 8: コミット**

```bash
git add admin-round.js admin.css
git commit -m "feat: スマホ運営の進行タブに段階表示と「次へ進む」「戻す」を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: ヘルプを新しい流れに合わせる

**Files:**
- Modify: `help.html`（「0. 全体の流れ」節と「2. 採点の進行」節。画像は差し替えない）

- [ ] **Step 1: 「0. 全体の流れ」に状態の段階を足す**

`help.html` の `<h2>0. 全体の流れ</h2>` の直後の 2 つの `<p>` の後、`<div class="diagram">` の**直前**に足す。

```html
    <p>大会には <span class="term">状態</span> があります。運営者が <span class="ui">次へ進む</span> のボタンで1段ずつ進め、自動では変わりません。</p>
    <ol class="status-steps">
      <li><span class="ui">準備中</span> — 技と配点・選手を自由に入れられます。採点はまだできません。</li>
      <li><span class="ui">一巡目 進行中</span> — コートの端末で一巡目を採点します。</li>
      <li><span class="ui">一巡目終了</span> — 二巡目を作り、技を入れます。</li>
      <li><span class="ui">二巡目 進行中</span> — コートの端末で二巡目を採点します。</li>
      <li><span class="ui">二巡目終了</span> — 順位を確かめます。直したいことがあれば1つ前に戻せます。</li>
      <li><span class="ui">最終結果</span> — 得点・選手・技を編集できなくなります。発表・共有・ファイル保存はできます。</li>
      <li><span class="ui">アーカイブ</span> — 見るだけ。大会一覧の「アーカイブ」欄に移り、採点画面の選択肢から消えます。</li>
    </ol>
    <div class="note">二巡目を行わない大会は、<span class="ui">一巡目終了</span> の ⋯ メニューから <span class="ui">二巡目なしで終了</span> で <span class="ui">最終結果</span> へ進めます。どの状態からも ⋯ メニューの <span class="ui">戻す</span> で1つ前に戻せます。</div>
```

図の `<svg>` は差し替えない（画像・図の作り直しは計画3以降）。図の下の `<p>大会のデータはサーバーに1つだけあります。…</p>` の直後に 1 文足す。

```html
    <p>図の各段は、上の状態の 2〜5 にあたります。<span class="term">運営画面で状態を進めないと、コートの端末は採点できません</span>。</p>
```

- [ ] **Step 2: 「2. 採点の進行」を新しい流れに書き直す**

`<h3>コートの端末で採点画面を開く</h3>` の**直前**に新しい小節を足す。

```html
    <h3>試合を開始する</h3>
    <p>選手の登録が済んだら、運営画面の <span class="ui">進行</span> タブを開きます。いちばん上に <span class="ui">現在の状態: 準備中</span> と <span class="ui">試合開始 ▶</span> のボタンが出ています。</p>
    <ol>
      <li><span class="ui">試合開始 ▶</span> を押す。<span class="msg">一巡目 n名。技が未入力の選手が m名います。試合を開始しますか？</span> の確認で <span class="ui">OK</span> を押すと <span class="ui">一巡目 進行中</span> になります。</li>
      <li>コートの端末で大会を選び直すと、採点できるようになります。</li>
      <li>一巡目が終わったら <span class="ui">一巡目を終了 ▶</span> を押します。ここで初めて <span class="ui">二巡目を生成</span> が押せるようになります。</li>
      <li>二巡目の技を入れ終えたら <span class="ui">二巡目を開始 ▶</span>。コートの端末で大会を選び直すと二巡目の選手が出ます。</li>
      <li>二巡目が終わったら <span class="ui">二巡目を終了 ▶</span>、順位を確かめてから <span class="ui">最終結果を確定 ▶</span>。</li>
    </ol>
    <div class="note">押し間違えても ⋯ メニューの <span class="ui">戻す</span> で1つ前に戻せます。<span class="ui">最終結果</span> のあとも <span class="ui">戻す</span> で編集に戻れます。</div>

    <h3>採点画面の状態バナー</h3>
    <p>採点画面では、大会を選ぶバーのすぐ下に今の状態が出ます。</p>
    <ul>
      <li><span class="ui">一巡目 進行中</span> / <span class="ui">二巡目 進行中</span> — 採点できます。選手一覧にはその巡目の選手だけが並びます。</li>
      <li><span class="msg">この大会は「準備中」です。運営画面で「試合開始」を押すと採点できます。</span> — 運営画面で状態を進めてから、<span class="term">この画面で大会を選び直して</span>ください。</li>
      <li><span class="msg">この大会は「最終結果」です。得点は編集できません。運営画面で「戻す」を押すと編集できます。</span> — 確定後は、サーバーが得点の保存そのものを断ります。</li>
    </ul>
    <p>採点できない状態のときは <span class="ui">確定</span> <span class="ui">形成功</span> <span class="ui">失敗</span> と得点・補正点・備考の入力が無効になります。前後の選手の移動・タイマー・<span class="ui">CSVエクスポート</span>・<span class="ui">HTML保存</span> は使えます。</p>
    <div class="note">状態は端末どうしで自動には伝わりません。運営者が状態を変えたら、コートの端末では<span class="term">大会を選び直して</span>ください（選手を足したときと同じです）。</div>
```

- [ ] **Step 3: 大会バーの説明から「大会削除」を外す**

`<h3>採点画面の見方</h3>` の下の figcaption の ①の項目を次に置き換える。置き換え前:

```html
          <li>①大会バー — 大会とコートを選びます。右の <span class="ui">● 保存済み</span> がサーバーへの保存の様子です。同じバーの <span class="ui">大会削除</span> は確認1回で消えるので、押し間違えに注意してください。</li>
```

置き換え後:

```html
          <li>①大会バー — 大会とコートを選びます。右の <span class="ui">● 保存済み</span> がサーバーへの保存の様子です。大会の作成と削除は運営画面にあります（バーの <span class="ui">大会の作成は運営画面で</span> のリンクから開けます）。選択肢にはアーカイブ済みの大会は出ず、採点できる大会が先頭に並びます。</li>
```

（この figcaption が指すスクリーンショットには古いボタンが写っているが、画像の差し替えは計画3以降で行う。）

- [ ] **Step 4: 「二巡目に進む」の手順に状態を足す**

`<h3>二巡目に進む</h3>` の直後の `<p>` を置き換える。置き換え前:

```html
    <p>一巡目が終わったら、運営画面の <span class="ui">進行</span> タブで二巡目を作ります。</p>
```

置き換え後:

```html
    <p>一巡目が終わったら、運営画面の <span class="ui">進行</span> タブで <span class="ui">一巡目を終了 ▶</span> を押してから二巡目を作ります。<span class="term">状態が <span class="ui">一巡目終了</span> でないと <span class="ui">二巡目を生成</span> は押せません</span>（ボタンが灰色のままです）。</p>
```

同じ `<ol>` の 1 番目の項目を置き換える。置き換え前:

```html
      <li>上に <span class="ui">一巡目 採点済み 8 / 8</span> のように進み具合が出ます。全員終わっているか確かめます。</li>
```

置き換え後:

```html
      <li>上に <span class="ui">採点済み 8 / 8</span> のように進み具合が出ます。全員終わっているか確かめてから <span class="ui">一巡目を終了 ▶</span> を押します。</li>
```

- [ ] **Step 5: `help.css` に箇条書きの見た目が要るか確かめる**

`.status-steps` は新しいクラスなので、`help.css` に無ければ既定の `<ol>` の見た目で出る。それで読めれば足さない（YAGNI）。読みづらければ `help.css` の末尾に足す。

```css
.status-steps li { margin-bottom: 6px; }
```

- [ ] **Step 6: 画面で確認する**

`http://localhost:3461/help.html` を新しいタブで開く。
Expected: 「0. 全体の流れ」に 7 段階の箇条書きと注記が出ている。「2. 採点の進行」の先頭に「試合を開始する」「採点画面の状態バナー」の小節がある。目次のリンク（`#flow` `#progress`）が変わらず動く。画像は今までのまま表示される。

- [ ] **Step 7: コミット**

```bash
git add help.html help.css
git commit -m "docs: ヘルプの全体の流れと採点の進行を大会の状態に合わせる" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 完了条件

- `test.html` が `Result: N passed, 0 failed`。設計書のテスト 1〜11・14 が入っており、15（並行 PATCH 12 本）が通ったままであること
- 採点画面（`index.html`）に「＋ 新規大会」「大会削除」が無く、状態バナーが出る。進行中でなければ確定・形成功・失敗・得点・補正点・備考が無効
- スマホ運営（`admin.html`）の進行タブで「準備中 → 試合開始 → 一巡目を終了 → 二巡目を生成 → 二巡目を開始 → 二巡目を終了 → 最終結果を確定 → アーカイブ」を一通り操作でき、⋯ メニューから1つ前に戻せる
- `final` の大会への書き込みがサーバーで 409 になる（画面の無効化だけに頼っていない）
- 本物の大会「第10回全日本試し斬り大会」のデータが変わっていない（`git status` と運営画面の大会一覧で確認する）
- 確認に使ったテスト用の大会を削除してある

## この計画でやらないこと（計画2以降）

- `desk.html`（PC 運営）と `desk-*.js`、`techedit.js` の切り出し
- `index.html` の作り直しと `scoring.html` への改名、`Storage.adminHref` と 🖥/📱 の切り替え
- `POST /api/events/:id/copy`（コピー API）とテスト 12
- `POST /api/events/:id/players/bulk` の行形式（`rows`）とテスト 13
- ヘルプの「1. 大会の作成」節、スクリーンショットの差し替え、URL の `scoring.html` への書き換え
