# 選手タブの表形式化（絞り込み・並べ替え） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運営画面（`admin.html`）の選手タブを、コート・性別・巡目・新人・技未入力・名前で絞り込み、No・名前・得点で並べ替えられる 1 行 1 段の表にする。スマホ幅（375px）でも表形式のままで、横スクロールを許して全 10 列を出す。

**Architecture:** 絞り込み・並べ替えは `courts.js` に純粋関数（`applyFilter` / `sortBy` ほか）として置き、`test.html` で固定する。`admin-players.js` は `filter` / `sort` の 2 つの状態オブジェクトを持ち、チップ・検索欄・`<table>` を組み立てるだけにする。`order` 文字列（`A-男子-1-1`）はデータとしては変えず、表示だけ 4 列（巡・コート・性・No）に分解する。サーバー・採点画面・進行タブ・各シートは触らない。

**Tech Stack:** 素の JavaScript（IIFE、`var`、ES5 風の書き方に合わせる。`Object.assign` などブラウザ標準の API は使ってよい）、Express 5、`test.html`（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は `JSON.stringify` 比較）。

設計書: `docs/superpowers/specs/2026-09-18-players-table-design.md`

---

## 前提・共通の手順

- サーバーの起動: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。既に起動していれば再利用する。JS/CSS は静的配信なので、クライアント側だけの変更ならサーバー再起動は不要
- `.env` が無ければ Basic 認証は掛からない（`.env.example` のみ存在）。掛かっていれば `.env` の `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` を使う
- 自動テスト: `http://localhost:3461/test.html` をブラウザで開き、ページ末尾の `Result: N passed, 0 failed` を確認する。編集後の再確認は同じ URL への再 navigate ではなく `location.reload()` か**新しいタブ**で行う（bfcache で古い JS が使われるため）
- 画面確認: `http://localhost:3461/admin.html` を幅 375px（モバイル表示）と PC 幅の両方で見る。検証に使う大会は「テスト用」と名前に入った大会だけを使い、本物の大会名の大会は触らない
- `git add` は**明示したファイルだけ**を対象にする（同じ作業ツリーで他の変更が staged になっている可能性がある）
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける

---

## ファイル構成

- Modify: `courts.js` — 末尾の `return { ... }` の前に純粋関数を追加し、`return` に公開名を足す
  - `normalizeName(s)`、`hasNoTech(p)`、`sexOf(p)`、`roundsOf(players)`、`orderKey(p)`（既存・公開に加える）
  - `defaultFilter()`、`applyFilter(players, filter)`
  - `defaultSort()`、`sortBy(players, sort)`
- Modify: `test.html` — `courts.js` 節（`nextRoundResultMessage: 通常` の assert の直後、`var h2tp = document.createElement('h2');` の前）に追記
- Modify: `admin.js` — `renderCourtChips` を汎用の `renderChips` の上に組み直す。`Admin.renderChips` を公開に加える
- Modify: `admin.css` — 「一覧の行」節の直後に「選手タブの絞り込みと表」節を追加
- Modify: `admin-players.js` — 状態を `filter` / `sort` に置き換え、`render` / `renderList` / `buildRow` を表向けに書き換える
- Modify: `help.html` — 選手タブの説明とスクリーンショットを差し替え、絞り込み・並べ替えの段落を追加
- Replace: `help/img/admin_players.png` — 新しい選手タブのスクリーンショット（幅 750px = 375px の 2 倍）

---

### Task 1: `courts.js` に名前・技・性別・巡目の補助関数を足す

**Files:**
- Modify: `courts.js`（`function nextRoundResultMessage` の直前に関数を追加、末尾の `return {` に公開名を追加）
- Test: `test.html`（`courts.js` 節の末尾、`nextRoundResultMessage: 通常` の assert の直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `assert('nextRoundResultMessage: 通常', ...)` の assert（2 行）の直後、`var h2tp = document.createElement('h2');` の前に追記する。

```js
    // ---- 選手タブの絞り込み・並べ替え（設計書 2026-09-18-players-table-design.md） ----
    assert('normalizeName: 全角・半角スペースと前後空白を除く', Courts.normalizeName('　箕輪 憲人 '), '箕輪憲人');
    assert('normalizeName: 大文字小文字を同一視', Courts.normalizeName('Abc'), 'abc');
    assert('normalizeName: null は空文字', Courts.normalizeName(null), '');

    assert('hasNoTech: 3つとも空文字', Courts.hasNoTech({ tech1: '', tech2: '', tech3: '' }), true);
    assert('hasNoTech: 未定義でも空', Courts.hasNoTech({}), true);
    assert('hasNoTech: 空白だけは空', Courts.hasNoTech({ tech1: ' ' }), true);
    assert('hasNoTech: 1つでも入っていれば false', Courts.hasNoTech({ tech2: '真' }), false);
    assert('hasNoTech: null でも落ちない', Courts.hasNoTech(null), true);

    assert('sexOf: order の女子を優先', Courts.sexOf({ order: 'A-女子-1-3', isFemale: false }), '女子');
    assert('sexOf: order の男子を優先', Courts.sexOf({ order: 'A-男子-1-3', isFemale: true }), '男子');
    assert('sexOf: order が解析不能なら isFemale', Courts.sexOf({ order: '', isFemale: true }), '女子');
    assert('sexOf: order が解析不能で isFemale も無ければ男子', Courts.sexOf({}), '男子');

    assert('roundsOf: 一意な巡目を昇順', Courts.roundsOf([{ order: 'A-男子-2-1' }, { order: 'A-男子-1-1' }, { order: 'B-男子-2-1' }]), [1, 2]);
    assert('roundsOf: 解析不能は 1 巡目', Courts.roundsOf([{ order: '' }]), [1]);
    assert('roundsOf: 空配列は空', Courts.roundsOf([]), []);

    assert('orderKey: 番号を数値で返す', Courts.orderKey({ order: 'A-男子-1-10' }).no, 10);
    assert('orderKey: 解析不能は 0', Courts.orderKey({ order: '' }).no, 0);
```

- [ ] **Step 2: テストが失敗することを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。`normalizeName` 以降の assert は `Courts.normalizeName is not a function` で例外になり、`courts.js` 節の途中でスクリプトが止まる（`Result` 行が出ないか、`failed` が 0 でない）ことを確認する。

- [ ] **Step 3: 実装する**

`courts.js` の `// 二巡目生成 API の 409 応答 ...` コメント（`function nextRoundConflictMessage` の直前）の前に追加する。

```js
  // ---- 選手タブの絞り込み・並べ替え（admin-players.js から使う純粋関数） ----

  // 名前検索の正規化。前後の空白と全角・半角スペースを取り除き、大文字小文字を同一視する
  // （「箕輪 憲人」を「箕輪憲人」でも当てる）。
  function normalizeName(s) {
    return String(s == null ? '' : s).replace(/[\s　]+/g, '').toLowerCase();
  }

  // 技が 3 枠とも空か（空白だけも空とみなす）。受付で技の入力漏れを探すのに使う。
  function hasNoTech(p) {
    if (!p) return true;
    return !(String(p.tech1 || '').trim() || String(p.tech2 || '').trim() || String(p.tech3 || '').trim());
  }

  // 性別（'男子' | '女子'）。order の第 2 セグメントを優先し、解析できなければ isFemale で補う
  // （選手データは両方を持っているが、採番の元になる order を正とする）。
  function sexOf(p) {
    var m = String((p && p.order) || '').match(/^[^-]+-(男子|女子)-/);
    if (m) return m[1];
    return (p && p.isFemale) ? '女子' : '男子';
  }

  // 選手にある巡目の一意な値を昇順で（巡目の絞り込みチップの候補）。
  function roundsOf(players) {
    var seen = {};
    var list = [];
    (players || []).forEach(function(p) {
      var r = roundOf(p);
      if (!seen[r]) { seen[r] = true; list.push(r); }
    });
    return list.sort(function(a, b) { return a - b; });
  }
```

末尾の `return { ... }` に公開名を足す（`compareOrder: compareOrder,` の次の行）:

```js
    compareOrder: compareOrder,
    orderKey: orderKey,
    normalizeName: normalizeName,
    hasNoTech: hasNoTech,
    sexOf: sexOf,
    roundsOf: roundsOf,
```

- [ ] **Step 4: テストが通ることを確認する**

`test.html` を `location.reload()` で読み直し、上の 17 件が ✓ で、`failed` が 0 であることを確認する。

- [ ] **Step 5: コミット**

```bash
git add courts.js test.html
git commit -m "feat: 選手タブの絞り込み用に名前正規化・技未入力・性別・巡目一覧の純粋関数を足す" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `courts.js` に `defaultFilter` / `applyFilter` を足す

**Files:**
- Modify: `courts.js`（Task 1 で足した `roundsOf` の直後）
- Test: `test.html`（Task 1 で足したブロックの直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の Task 1 ブロック（`orderKey: 解析不能は 0` の assert）の直後に追記する。

```js
    var fPlayers = [
      { order: 'A-男子-1-1', name: 'ジュリアーノ熊代', tech1: '破図味', tech2: '夢想返し', tech3: '響き返し', score: 66 },
      { order: 'A-男子-1-2', name: '箕輪 憲人', tech1: '水月', tech2: '', tech3: '', score: 47, isNewFace: true },
      { order: 'A-女子-1-1', name: '佐藤 花', tech1: '', tech2: '', tech3: '', score: 0 },
      { order: 'B-男子-1-1', name: '田中 太郎', tech1: '四方', tech2: '両車', tech3: '陽中陰', score: 30 },
      { order: 'A-男子-2-1', name: 'ジュリアーノ熊代', tech1: '真', tech2: '真', tech3: '真', score: 10 }
    ];
    function ordersOf(rows) { return rows.map(function(p) { return p.order; }); }
    function withFilter(patch) { return Object.assign(Courts.defaultFilter(), patch); }

    assert('defaultFilter: 既定値', Courts.defaultFilter(), { court: '', sex: '', round: 0, newFace: false, noTech: false, query: '' });
    assert('applyFilter: 既定は全件', Courts.applyFilter(fPlayers, Courts.defaultFilter()).length, 5);
    assert('applyFilter: コート', ordersOf(Courts.applyFilter(fPlayers, withFilter({ court: 'B' }))), ['B-男子-1-1']);
    assert('applyFilter: 性別', ordersOf(Courts.applyFilter(fPlayers, withFilter({ sex: '女子' }))), ['A-女子-1-1']);
    assert('applyFilter: 巡目', ordersOf(Courts.applyFilter(fPlayers, withFilter({ round: 2 }))), ['A-男子-2-1']);
    assert('applyFilter: 新人', ordersOf(Courts.applyFilter(fPlayers, withFilter({ newFace: true }))), ['A-男子-1-2']);
    assert('applyFilter: 技未入力', ordersOf(Courts.applyFilter(fPlayers, withFilter({ noTech: true }))), ['A-女子-1-1']);
    assert('applyFilter: 名前の部分一致（空白の違いを無視）', ordersOf(Courts.applyFilter(fPlayers, withFilter({ query: '箕輪憲' }))), ['A-男子-1-2']);
    assert('applyFilter: 名前の空白だけの検索は全件', Courts.applyFilter(fPlayers, withFilter({ query: '  ' })).length, 5);
    assert('applyFilter: 複数条件は AND', ordersOf(Courts.applyFilter(fPlayers, withFilter({ court: 'A', sex: '男子', round: 1 }))), ['A-男子-1-1', 'A-男子-1-2']);
    assert('applyFilter: filter が無ければ全件', Courts.applyFilter(fPlayers, null).length, 5);
    assert('applyFilter: 元配列を変えない', fPlayers.length, 5);
```

- [ ] **Step 2: テストが失敗することを確認する**

`test.html` を新しいタブで開く。`defaultFilter: 既定値` で `Courts.defaultFilter is not a function` の例外になることを確認する。

- [ ] **Step 3: 実装する**

`courts.js` の `roundsOf` の直後に追加する。

```js
  // 絞り込み条件の既定値。court '' は全コート、sex '' は男女、round 0 は全巡。
  function defaultFilter() {
    return { court: '', sex: '', round: 0, newFace: false, noTech: false, query: '' };
  }

  // 絞り込み。すべての条件を AND で適用し、新しい配列を返す。
  function applyFilter(players, f) {
    f = f || defaultFilter();
    var q = normalizeName(f.query);
    return (players || []).filter(function(p) {
      if (f.court && courtOf(p) !== f.court) return false;
      if (f.sex && sexOf(p) !== f.sex) return false;
      if (f.round && roundOf(p) !== f.round) return false;
      if (f.newFace && !p.isNewFace) return false;
      if (f.noTech && !hasNoTech(p)) return false;
      if (q && normalizeName(p.name).indexOf(q) === -1) return false;
      return true;
    });
  }
```

末尾の `return { ... }` に公開名を足す（`roundsOf: roundsOf,` の次の行）:

```js
    roundsOf: roundsOf,
    defaultFilter: defaultFilter,
    applyFilter: applyFilter,
```

- [ ] **Step 4: テストが通ることを確認する**

`test.html` を `location.reload()` し、`defaultFilter` / `applyFilter` の 12 件が ✓、`failed` が 0 であることを確認する。

- [ ] **Step 5: コミット**

```bash
git add courts.js test.html
git commit -m "feat: 選手の絞り込み（コート・性別・巡目・新人・技未入力・名前）の純粋関数を足す" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `courts.js` に `defaultSort` / `sortBy` を足す

**Files:**
- Modify: `courts.js`（Task 2 で足した `applyFilter` の直後）
- Test: `test.html`（Task 2 で足したブロックの直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の Task 2 ブロック（`applyFilter: 元配列を変えない`）の直後に追記する。

```js
    var sPlayers = [
      { order: 'A-男子-1-10', name: 'い', score: 9 },
      { order: 'A-男子-1-2', name: 'あ', score: 10 },
      { order: 'B-男子-1-1', name: 'う', score: 10 }
    ];
    assert('defaultSort: 既定は order 昇順', Courts.defaultSort(), { key: 'order', dir: 'asc' });
    assert('sortBy: order 昇順は compareOrder と同じ', ordersOf(Courts.sortBy(sPlayers, Courts.defaultSort())), ['A-男子-1-2', 'A-男子-1-10', 'B-男子-1-1']);
    assert('sortBy: order 降順', ordersOf(Courts.sortBy(sPlayers, { key: 'order', dir: 'desc' })), ['B-男子-1-1', 'A-男子-1-10', 'A-男子-1-2']);
    assert('sortBy: 名前昇順（日本語順）', ordersOf(Courts.sortBy(sPlayers, { key: 'name', dir: 'asc' })), ['A-男子-1-2', 'A-男子-1-10', 'B-男子-1-1']);
    assert('sortBy: 名前降順', ordersOf(Courts.sortBy(sPlayers, { key: 'name', dir: 'desc' })), ['B-男子-1-1', 'A-男子-1-10', 'A-男子-1-2']);
    assert('sortBy: 得点降順は数値順（10 が 9 より上）、同点は order 順', ordersOf(Courts.sortBy(sPlayers, { key: 'score', dir: 'desc' })), ['A-男子-1-2', 'B-男子-1-1', 'A-男子-1-10']);
    assert('sortBy: 得点昇順でも同点は order 昇順', ordersOf(Courts.sortBy(sPlayers, { key: 'score', dir: 'asc' })), ['A-男子-1-10', 'A-男子-1-2', 'B-男子-1-1']);
    assert('sortBy: 得点が文字列でも数値順', ordersOf(Courts.sortBy([{ order: 'A-男子-1-1', score: '9' }, { order: 'A-男子-1-2', score: '10' }], { key: 'score', dir: 'desc' })), ['A-男子-1-2', 'A-男子-1-1']);
    assert('sortBy: 得点が無ければ 0 扱い', ordersOf(Courts.sortBy([{ order: 'A-男子-1-1' }, { order: 'A-男子-1-2', score: 1 }], { key: 'score', dir: 'desc' })), ['A-男子-1-2', 'A-男子-1-1']);
    assert('sortBy: sort が無ければ order 昇順', ordersOf(Courts.sortBy(sPlayers, null)), ['A-男子-1-2', 'A-男子-1-10', 'B-男子-1-1']);
    assert('sortBy: 元配列を変えない', ordersOf(sPlayers), ['A-男子-1-10', 'A-男子-1-2', 'B-男子-1-1']);
```

- [ ] **Step 2: テストが失敗することを確認する**

`test.html` を新しいタブで開く。`defaultSort: 既定は order 昇順` で `Courts.defaultSort is not a function` の例外になることを確認する。

- [ ] **Step 3: 実装する**

`courts.js` の `applyFilter` の直後に追加する。

```js
  // 並べ替えの既定値（= 従来の compareOrder 順）。
  function defaultSort() {
    return { key: 'order', dir: 'asc' };
  }

  // 並べ替え。key は 'order' | 'name' | 'score'、dir は 'asc' | 'desc'。
  // 同値のときは compareOrder（昇順）で並べて安定させる。元配列は変えない。
  function sortBy(players, s) {
    s = s || defaultSort();
    var sign = s.dir === 'desc' ? -1 : 1;
    function primary(a, b) {
      if (s.key === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      if (s.key === 'score') return (Number(a.score) || 0) - (Number(b.score) || 0);
      return compareOrder(a, b);
    }
    return (players || []).slice().sort(function(a, b) {
      var c = primary(a, b) * sign;
      return c !== 0 ? c : compareOrder(a, b);
    });
  }
```

末尾の `return { ... }` に公開名を足す（`applyFilter: applyFilter,` の次の行）:

```js
    applyFilter: applyFilter,
    defaultSort: defaultSort,
    sortBy: sortBy,
```

- [ ] **Step 4: テストが通ることを確認する**

`test.html` を `location.reload()` し、`defaultSort` / `sortBy` の 11 件が ✓、`failed` が 0 であることを確認する。既存の `compareOrder` などのテストも ✓ のままであること。

- [ ] **Step 5: コミット**

```bash
git add courts.js test.html
git commit -m "feat: 選手の並べ替え（No・名前・得点、昇降）の純粋関数を足す" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `admin.js` のチップ描画を汎用化する

**Files:**
- Modify: `admin.js:301-317`（`function renderCourtChips`）と `admin.js:474`（公開名）

チップは自動テストの対象外（DOM 生成）。進行タブのコートチップが従来どおり動くことをブラウザで確認する。

- [ ] **Step 1: `renderChips` を書き、`renderCourtChips` をその上に組み直す**

`admin.js` の `function renderCourtChips(container, players, current, onChange) { ... }`（301〜317 行）を次で置き換える。

```js
  // チップの帯を描く。items は [{ value, label }]、current は選択中の value
  // （比較は文字列化して行う。数値の巡目や真偽値のトグルもそのまま渡せる）。
  // small が true なら高さ 32px の小型（.chip-sm）。
  // 選手タブの絞り込み（性別・巡目・新人・技未入力）と下の renderCourtChips で共用。
  function renderChips(container, items, current, onChange, small) {
    container.innerHTML = '';
    items.forEach(function(it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'court-chip'
        + (small ? ' chip-sm' : '')
        + (String(it.value) === String(current) ? ' on' : '');
      b.textContent = it.label;
      b.addEventListener('click', function() {
        if (onChange) onChange(it.value);
      });
      container.appendChild(b);
    });
  }

  // コートの絞り込みチップ（「全コート」「A コート」…「未分類」）。選手タブと進行タブで共用。
  function renderCourtChips(container, players, current, onChange) {
    var items = [''].concat(Courts.listFrom(players)).map(function(c) {
      var label = c === '' ? '全コート'
        : (c === Courts.UNASSIGNED ? Courts.UNASSIGNED : c + ' コート');
      return { value: c, label: label };
    });
    renderChips(container, items, current || '', onChange);
  }
```

公開名を足す（`renderCourtChips: renderCourtChips,` の直前）:

```js
    renderChips: renderChips,
    renderCourtChips: renderCourtChips,
```

- [ ] **Step 2: 進行タブのコートチップが従来どおり動くことを確認する**

`http://localhost:3461/admin.html` を新しいタブで開き、テスト用の大会を選んで「進行」タブへ。「全コート」「A コート」「B コート」のチップが出て、押すと選択中（黒地）が切り替わり、その下の一覧がそのコートだけになること。「採点画面へ」のリンクが選択中のコートを含むこと（`index.html#event/<id>/A` の形）。

選手タブ（この時点ではまだカード形式）でもコートチップの切り替えが従来どおり効くこと。

- [ ] **Step 3: `test.html` が引き続き `failed` 0 であることを確認する**

`test.html` を新しいタブで開き、`Result` 行の `failed` が 0 であること。

- [ ] **Step 4: コミット**

```bash
git add admin.js
git commit -m "refactor: コートチップの描画を汎用の renderChips に分けて選手タブの絞り込みでも使えるようにする" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `admin.css` に絞り込み帯と表のスタイルを足す

**Files:**
- Modify: `admin.css`（「一覧の行」節の末尾、`.row-del { ... }` の直後・「右下の追加ボタン」節の前）

- [ ] **Step 1: スタイルを追加する**

`.row-del { flex: 0 0 auto; ... }` の行の直後に追加する。

```css

/* ===== 選手タブの絞り込みと表 =====
   絞り込みは 3 段（コート／性別・巡目・新人・技未入力／名前検索）。
   表は 1 行 1 段で折り返さず、幅を超えたら .players-table-wrap の中だけ横に流す。
   名前列は左に固定して、横スクロール中も誰の行か分かるようにする（採点表の技名列と同じ手法）。 */
.chip-sm { min-height: 32px; padding: 0 10px; border-radius: 16px; font-size: 13px; }
.players-filters { gap: 10px; }
.chip-group { display: inline-flex; gap: 4px; flex: 0 0 auto; }
.players-search { margin-bottom: 10px; }
.players-search input[type="search"] {
  font-family: inherit; font-size: 16px;   /* 16px 未満だと iOS がフォーカス時にページを拡大する */
  width: 100%; min-height: 44px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--card-bg); color: var(--text);
}
/* 固定列を wrap の左端にぴったり付けるため、wrap 自体には左右の余白を付けない */
.players-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.players-table {
  border-collapse: separate; border-spacing: 0;   /* collapse だと sticky の罫線がずれる */
  width: 100%; white-space: nowrap; font-size: 14px;
}
.players-table th, .players-table td {
  height: 44px; padding: 0 6px; text-align: left; vertical-align: middle;
  border-bottom: 1px solid var(--border);
}
.players-table th { font-size: 12px; font-weight: normal; color: var(--text-muted); background: var(--bg-header); }
.players-table td { background: var(--card-bg); }
.players-table .col-name {
  position: sticky; left: 0; z-index: 1;
  font-weight: bold; box-shadow: 2px 0 0 var(--border);
}
.players-table th.col-name { z-index: 2; }
.players-table .col-score { text-align: right; font-weight: bold; color: var(--score-color); }
.players-table td.muted { color: var(--text-muted); font-weight: normal; }
.players-table tbody tr { cursor: pointer; }
.players-table tbody tr:active td { background: var(--bg-secondary); }
/* 見出しの並べ替えボタン。表の見出しの見た目のまま、タップ目標だけ 44px にする */
.sort-btn {
  min-height: 44px; padding: 0; border-radius: 0;
  background: transparent; color: inherit; font-size: 12px;
}
.sort-btn.on { color: var(--text); font-weight: bold; }
```

- [ ] **Step 2: 既存画面が崩れていないことを確認する**

`admin.html` を新しいタブで開き、進行タブ・結果タブ・選手タブ（まだカード形式）の見た目が変わっていないこと（この節のセレクタはまだどの要素にも当たらない）。

- [ ] **Step 3: コミット**

```bash
git add admin.css
git commit -m "style: 選手タブの絞り込み帯と横スクロール表（名前列固定）のスタイルを足す" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `admin-players.js` を表形式に書き換える

**Files:**
- Modify: `admin-players.js:1-132`（状態変数、`render`、`renderList`、`buildRow`）

`openMenu` / `openAddSheet` / `openEditSheet` / `buildCommonFields` / 一括登録 / CSV インポート（133 行目以降）は触らない。

- [ ] **Step 1: 状態変数を置き換える**

ファイル先頭の

```js
(function() {
  var currentCourt = '';
  var courtOwner = null;   // currentCourt がどの大会のものか（大会が変われば全コートに戻す）
```

を次に置き換える。

```js
(function() {
  // 絞り込みと並べ替えの状態。形は Courts.defaultFilter() / Courts.defaultSort()。
  // 大会が変われば既定に戻す。選手の追加・編集後の再描画（Admin.reloadEvent）では保つ。
  var filter = null;
  var sort = null;
  var stateOwner = null;   // filter / sort がどの大会のものか
```

`// 行の並び順（巡目 → コート → 性別 → 番号）は courts.js の Courts.compareOrder` から始まる 2 行のコメントを次に置き換える。

```js
  // 絞り込み（Courts.applyFilter）と並べ替え（Courts.sortBy）は courts.js の純粋関数。
  // 並び順の既定は巡目 → コート → 性別 → 番号（進行タブ admin-round.js と同じ compareOrder）。
```

- [ ] **Step 2: `render` を書き換える**

`async function render(container, ctx) { ... }` 全体（`adoptTechniques(ctx);` から `renderList(list, ctx);` の閉じ `}` まで）を次に置き換える。

```js
  async function render(container, ctx) {
    adoptTechniques(ctx);
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
    head.className = 'section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '選手 ' + ctx.players.length + '名';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    var btnMenu = document.createElement('button');
    btnMenu.type = 'button';
    btnMenu.className = 'icon-btn';
    btnMenu.textContent = '⋯';
    btnMenu.addEventListener('click', function() { openMenu(ctx); });

    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(btnMenu);
    container.appendChild(head);

    // 1 段目: コート
    var courtChips = document.createElement('div');
    courtChips.className = 'court-chips';
    container.appendChild(courtChips);

    // 2 段目: 性別・巡目・新人・技未入力
    var filterChips = document.createElement('div');
    filterChips.className = 'court-chips players-filters';
    container.appendChild(filterChips);

    // 3 段目: 名前検索
    var search = document.createElement('div');
    search.className = 'players-search';
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = '名前で検索';
    input.setAttribute('aria-label', '名前で検索');
    input.value = filter.query;
    search.appendChild(input);
    container.appendChild(search);

    var wrap = document.createElement('div');
    wrap.className = 'players-table-wrap';
    container.appendChild(wrap);

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'fab';
    fab.textContent = '＋';
    fab.addEventListener('click', function() { openAddSheet(ctx); });
    container.appendChild(fab);

    // チップを押したらチップの帯と表を描き直す（検索欄は作り直さない。入力中の文字を保つ）
    function redraw() {
      Admin.renderCourtChips(courtChips, ctx.players, filter.court, function(c) {
        filter.court = c;
        redraw();
      });
      renderFilterChips(filterChips, ctx, redraw);
      renderTable(wrap, ctx);
    }
    input.addEventListener('input', function() {
      filter.query = input.value;
      renderTable(wrap, ctx);
    });
    redraw();
  }

  // 2 段目のチップ。性別・巡目は 1 つ選ぶ、新人・技未入力は押すたびに on/off。
  function renderFilterChips(el, ctx, redraw) {
    el.innerHTML = '';
    function group(items, current, onPick) {
      var g = document.createElement('span');
      g.className = 'chip-group';
      Admin.renderChips(g, items, current, function(v) { onPick(v); redraw(); }, true);
      el.appendChild(g);
    }
    group([{ value: '', label: '男女' }, { value: '男子', label: '男子' }, { value: '女子', label: '女子' }],
      filter.sex, function(v) { filter.sex = v; });
    group([{ value: 0, label: '全巡' }].concat(Courts.roundsOf(ctx.players).map(function(r) {
      return { value: r, label: r + '巡' };
    })), filter.round, function(v) { filter.round = v; });
    group([{ value: true, label: '新人' }], filter.newFace, function() { filter.newFace = !filter.newFace; });
    group([{ value: true, label: '技未入力' }], filter.noTech, function() { filter.noTech = !filter.noTech; });
  }
```

- [ ] **Step 3: `renderList` と `buildRow` を `renderTable` と `buildTr` に置き換える**

`function renderList(list, ctx) { ... }` と `function buildRow(ctx, p) { ... }` の 2 関数（`renderList` の先頭から `buildRow` の `return row;\n  }` まで）を次に置き換える。

```js
  // 表の列。key があるものは見出しタップで並べ替えられる（巡・コート・性は絞り込み軸なので対象外）。
  var COLUMNS = [
    { label: '巡' },
    { label: 'コート' },
    { label: '性' },
    { key: 'order', label: 'No' },
    { key: 'name', label: '名前', cls: 'col-name' },
    { label: '技①' },
    { label: '技②' },
    { label: '技③' },
    { label: '新' },
    { key: 'score', label: '得点', cls: 'col-score' }
  ];

  function renderTable(wrap, ctx) {
    wrap.innerHTML = '';
    if (ctx.players.length === 0) {
      wrap.appendChild(emptyMessage('選手がまだいません。右下の「＋」で追加してください。'));
      return;
    }
    var rows = Courts.sortBy(Courts.applyFilter(ctx.players, filter), sort);
    if (rows.length === 0) {
      wrap.appendChild(emptyMessage('条件に合う選手がいません。'));
      return;
    }

    var table = document.createElement('table');
    table.className = 'players-table';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    COLUMNS.forEach(function(col) {
      var th = document.createElement('th');
      if (col.cls) th.className = col.cls;
      if (!col.key) {
        th.textContent = col.label;
      } else {
        var on = sort.key === col.key;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = on ? 'sort-btn on' : 'sort-btn';
        b.textContent = col.label + (on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
        b.addEventListener('click', function() {
          // 同じ列なら昇⇄降、別の列なら昇順から
          if (sort.key === col.key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
          else sort = { key: col.key, dir: 'asc' };
          renderTable(wrap, ctx);
        });
        th.appendChild(b);
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function(p) {
      tbody.appendChild(buildTr(ctx, p));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  function emptyMessage(text) {
    var none = document.createElement('p');
    none.className = 'empty';
    none.textContent = text;
    return none;
  }

  // 1 人 1 行。order（A-男子-1-1）は巡・コート・性・No の 4 列に分けて出す。
  function buildTr(ctx, p) {
    var tr = document.createElement('tr');
    var key = Courts.orderKey(p);
    var noTech = Courts.hasNoTech(p);
    function cell(text, cls) {
      var td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    cell(String(Courts.roundOf(p)));
    cell(Courts.courtOf(p));
    cell(Courts.sexOf(p) === '女子' ? '女' : '男');
    cell(key.no ? String(key.no) : '');
    cell(p.name || '', 'col-name');
    // 3枠とも表示する（詰めると ['', '真', '真'] と ['真', '真', ''] が同じ見た目になり、
    // どの枠が空か運営が分からなくなる）。空き枠は「—」。3枠とも空なら技①に「未入力」。
    cell(noTech ? '未入力' : (p.tech1 || '—'), noTech ? 'muted' : '');
    cell(p.tech2 || '—');
    cell(p.tech3 || '—');
    cell(p.isNewFace ? '●' : '');
    cell(String(p.score || 0), 'col-score');

    tr.tabIndex = 0;
    tr.addEventListener('click', function() { openEditSheet(ctx, p); });
    tr.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditSheet(ctx, p); }
    });
    return tr;
  }
```

- [ ] **Step 4: `currentCourt` の参照が残っていないことを確認する**

```bash
grep -n "currentCourt\|courtOwner\|renderList\|buildRow" admin-players.js
```

Expected: 何も出ない（0 行）。出たら Step 1〜3 の置き換え漏れなので直す。

- [ ] **Step 5: 自動テストと画面で確認する**

1. `test.html` を新しいタブで開き、`failed` が 0 であること
2. `admin.html` を新しいタブで開き、テスト用の大会の選手タブを開く。3 段のチップ・検索欄・表が出て、表の列が「巡・コート・性・No ▲・名前・技①・技②・技③・新・得点」の順であること
3. ブラウザのコンソールにエラーが出ていないこと

- [ ] **Step 6: コミット**

```bash
git add admin-players.js
git commit -m "feat: 選手タブを絞り込み・並べ替えできる表にする" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: スマホ幅と PC 幅で振る舞いを確認する

**Files:** なし（確認のみ。問題があれば該当タスクのファイルを直して追加コミット）

テスト用の大会（名前に「テスト」を含むもの）を使う。無ければ大会タブで「テスト用 表確認」という大会を作り、選手タブの `⋯` → 「複数人をまとめて登録」で A コート男子 3 名・A コート女子 2 名・B コート男子 2 名を登録し、うち 1 名を編集シートで「新人」にし、2 名に技を入れる（残りは技未入力のまま）。

- [ ] **Step 1: 375px 幅（モバイル表示）で表の横スクロールと固定列を確認する**

ブラウザを幅 375px にして選手タブを開く。

- 表が横にスクロールし、右端の「得点」列まで見えること
- 横にスクロールしても「名前」列が左端に残り、右側の列がその下を通ること（見出し行の「名前」も固定）
- 本文（`body`）自体は横スクロールしないこと（表の枠だけが流れる）
- 2 段目のチップが 375px に収まらなければ、その帯だけ横に流れること

- [ ] **Step 2: 並べ替えを確認する**

- 「No ▲」が既定。タップすると「No ▼」になり、順序が逆になる
- 「名前」をタップすると「名前 ▲」になり五十音順に。もう一度で「名前 ▼」
- 「得点」をタップすると「得点 ▲」、もう一度で「得点 ▼」。同点の人は No 順で並ぶ
- 巡・コート・性・技①②③・新 の見出しはタップしても何も起きない

- [ ] **Step 3: 絞り込みを確認する**

- 「A コート」→ A の選手だけ。「全コート」で戻る
- 「女子」→ 女子だけ。「男女」で戻る
- 二巡目がある大会なら「2巡」→ 二巡目だけ。無い大会では「全巡」「1巡」だけが並ぶ
- 「新人」→ 新人だけ。もう一度押すと解除
- 「技未入力」→ 技が 3 つとも空の人だけ。もう一度押すと解除
- 検索欄に「テスト」など名前の一部を入れると絞られ、空にすると戻る。姓名の間の空白を抜いた文字列でも当たる
- 「A コート」＋「女子」＋「技未入力」のように重ねると AND になる
- 条件に合う人がいないと「条件に合う選手がいません。」が出る
- 「1巡」＋「得点 ▼」で一巡目の順位、「全巡」＋「得点 ▼」で巡目をまたいだ順位になる

- [ ] **Step 4: 状態の維持と初期化を確認する**

- 「A コート」＋「得点 ▼」にした状態で行をタップ → 編集シートで名前を変えて保存 → 表が描き直されても「A コート」「得点 ▼」のまま
- 右下「＋」で 1 人追加 → 追加後も絞り込みと並べ替えが維持される
- 大会タブで別の大会を選んで選手タブに戻る → 「全コート」「男女」「全巡」「No ▲」に戻っている
- ページを再読み込みしても既定に戻る

- [ ] **Step 5: 進行タブと PC 幅を確認する**

- 進行タブのコートチップが従来どおり動く（Task 4 Step 2 と同じ確認）
- ブラウザを PC 幅（1000px 以上）に戻し、表が 960px の中央に収まり、横スクロールが出ないこと。行の高さ・列の並びが崩れていないこと

- [ ] **Step 6: 問題があれば直してコミット**

見つかった不具合は該当のファイルを直し、`test.html` の `failed` 0 を確認してから、内容が分かるメッセージでコミットする（例: `fix: 選手表の名前列が横スクロールで固定されない`）。

---

### Task 8: マニュアル（`help.html`）とスクリーンショットを更新する

**Files:**
- Modify: `help.html:162-165`（選手タブの `<figure>`）と `help.html:240`（「選手を直す・消す」の段落の前）
- Replace: `help/img/admin_players.png`

- [ ] **Step 1: スクリーンショットを撮り直す**

Task 7 のテスト用大会で、375px 幅の選手タブ（既定の状態。数名の選手が表に並び、うち 1 名に「●」、1 名に「未入力」が見える状態）を撮り、`help/img/admin_players.png` を上書きする。幅は 750px（375px の 2 倍。既存の他の `admin_*.png` と同じ）。

- [ ] **Step 2: 選手タブの説明を差し替える**

`help.html` の

```html
      <img src="help/img/admin_players.png" loading="lazy" alt="選手タブ。コートの絞り込みチップ、選手のカード、右下の赤い「＋」ボタン。">
      <figcaption>選手タブ。左の丸い数字は巡目です。名前の下に技が並び、右が得点です。右下の赤い <span class="ui">＋</span> が1人ずつの追加、右上の <span class="ui">⋯</span> がまとめての登録です。</figcaption>
```

を次に置き換える。

```html
      <img src="help/img/admin_players.png" loading="lazy" alt="選手タブ。絞り込みのチップと検索欄、選手の表、右下の赤い「＋」ボタン。">
      <figcaption>選手タブ。1人1行の表で、左から巡目・コート・性別・番号・名前・技①②③・新人・得点です。表は横にスクロールでき、名前の列は左に残ります。右下の赤い <span class="ui">＋</span> が1人ずつの追加、右上の <span class="ui">⋯</span> がまとめての登録です。</figcaption>
```

- [ ] **Step 3: 絞り込み・並べ替えの段落を追加する**

`<h3>選手を直す・消す</h3>` の直前に追加する。

```html
    <h3>選手を探す（絞り込み・並べ替え）</h3>
    <p>表の上のチップで絞り込めます。<span class="ui">全コート</span> / <span class="ui">A コート</span>、<span class="ui">男女</span> / <span class="ui">男子</span> / <span class="ui">女子</span>、<span class="ui">全巡</span> / <span class="ui">1巡</span> / <span class="ui">2巡</span> は1つを選びます。<span class="ui">新人</span> と <span class="ui">技未入力</span> は押すたびに入・切が切り替わります。条件は重ねられます（例: <span class="ui">A コート</span> と <span class="ui">技未入力</span> で、Aコートで技がまだ入っていない人だけ）。</p>
    <p>検索欄に名前の一部を入れると、その文字を含む人だけになります。姓と名の間の空白は無視します。</p>
    <p>表の見出し <span class="ui">No</span> / <span class="ui">名前</span> / <span class="ui">得点</span> を押すと並べ替えられます。もう一度押すと逆順です（▲ が昇順、▼ が降順）。<span class="ui">1巡</span> に絞って <span class="ui">得点</span> を降順にすると一巡目の順位、<span class="ui">全巡</span> のまま降順にすると巡目をまたいだ順位になります。</p>
    <div class="note">絞り込みと並べ替えは、選手を追加・編集しても保たれます。別の大会を開くか、ページを読み直すと元（全コート・男女・全巡・No 昇順）に戻ります。</div>
```

- [ ] **Step 4: マニュアルを表示して確認する**

`http://localhost:3461/help.html` を新しいタブで開き、選手タブの図が新しいスクリーンショットになっていること、「選手を探す（絞り込み・並べ替え）」の節が「選手を直す・消す」の前に出ていること、`<span class="ui">` の装飾が周りの節と同じであること。

- [ ] **Step 5: コミット**

```bash
git add help.html help/img/admin_players.png
git commit -m "docs: マニュアルの選手タブを表形式に合わせ、絞り込み・並べ替えの説明を足す" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 完了の確認

- `test.html` が `failed` 0
- Task 7 の確認項目がすべて通る
- `git status` がクリーン（`.claude/worktrees/` 配下は無視してよい）
