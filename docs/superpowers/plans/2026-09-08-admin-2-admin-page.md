# 運営画面の土台（theme.css・TechPicker・大会／選手タブ）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運営者のスマホ（375px）で「大会を作る → 選手を1人ずつ登録・編集・削除する」を完結できる `admin.html` を新設する。あわせてテーマ変数を `theme.css` に切り出し、技の選択部品 `techpicker.js` を純粋関数つきで用意する。

**Architecture:** `admin.html` は `theme.css` ＋ `admin.css` だけを読み、`style.css`（`body{min-width:768px}`）を持ち込まない。`admin.js` が「タブ登録・ハッシュ routing・大会の読み込み・トースト・コート絞り込みチップ」だけを持つ骨組みで、各タブは `Admin.registerTab(name, { render })` で自分を登録する。この骨組みは計画3（進行タブ・結果タブ）がそのまま乗るための契約なので、公開名・DOM・スクリプト順を変えない。技の選択は `TechPicker` に閉じ込め、状態は純粋関数（`select` / `toArray` / `fromArray`）で持つ。将来「選手が自分のスマホで技を申告する」画面に DOM ごと流用するため。

**Tech Stack:** 素の JavaScript（IIFE、`var` と `function(){}`、`async`/`await` 可）、Express 5 の静的配信、ビルド工程・バンドラ・テストランナーなし。テストは `test.html` をブラウザで開いて読む。

**設計書:** [docs/superpowers/specs/2026-09-08-mobile-admin-flow-design.md](../specs/2026-09-08-mobile-admin-flow-design.md)
**前提計画:** [2026-09-08-admin-1-server-api.md](2026-09-08-admin-1-server-api.md)（**着地していること**。完了時点のテスト件数は 204）

---

## 前提知識（この計画を実行する人へ）

### テスト件数

計画1完了時点の `test.html` は **208 passed, 0 failed**。この計画で **26 件**足し、完了時点で **234 passed, 0 failed** になる。着手前に 208 を実測で確認すること。

### この計画の依存（計画1が用意済み。再定義しない）

```javascript
Api.createPlayer(eventId, data)                 // → player | null
Api.updatePlayerInfo(eventId, playerId, data)   // → { ok: true, player } | { ok: false, status }
Api.deletePlayer(eventId, playerId, force)      // → true | { blocked: true, player } | false
Api.loadEvent(id)                               // → event | null
Api.listEvents()                                // → array | null
Api.saveEvent(event)                            // → { success, id } | null
Api.deleteEvent(id)                             // → true | false
Api.loadTechniques()                            // → { isCustom, techniques } | null
Api.importCsv(eventId, csvText, mode, force)    // → { success } | { blocked, scoredCount } | null
Courts.courtOf / listFrom / filter / UNASSIGNED / roundOf
```

### テストの動かし方

1. サーバーを起動する（起動したままにする）:
   ```bash
   node server/index.js > "$TEMP/tmg_server.log" 2>&1 &
   ```
   `$TEMP/tmg_server.log` に `🎯 PHX Tameshigiri running at http://localhost:3457` が出れば成功。
2. `http://localhost:3457/test.html` を開き、ページ末尾の `Result: N passed, M failed` を読む。**`M` が 0 であることが合格条件。**
3. **この計画は `server/index.js` を一切変更しないので、サーバーの再起動は不要。** クライアントのファイルは `Cache-Control: no-store` で配信されるので、ブラウザのリロードだけで反映される。

### ブラウザでの確認に使うツール

- `mcp__Claude_Browser__navigate` — ページを開く
- `mcp__Claude_Browser__resize_window`（`preset: "mobile"` = 375x812）— 375px の確認
- `mcp__Claude_Browser__find` — 要素の存在確認
- `mcp__Claude_Browser__javascript_tool` — 幅・タップ目標の高さの実測
- `mcp__Claude_Browser__read_console_messages` — `X is not defined` や 404 の検知

**各タスクの最後に必ず `read_console_messages` でエラーが0件であることを確認する。** バンドラが無いので、`<script>` の足し忘れは実行時まで分からない。

### コードの書き方（厳守）

- すべて IIFE。`var` と `function(){}` のみ。
- **禁止:** アロー関数、`let` / `const`、テンプレートリテラル、`class`、`arguments.callee`。
- `async` / `await` は可。
- **新規 JS ファイルを追加したら、それを使う HTML すべてに `<script>` を足すこと。** 忘れると `X is not defined` になる。
- ユーザー入力・サーバー由来の文字列は必ず `textContent` で入れる（`innerHTML` に混ぜない）。
- テーマは `document.body.setAttribute('data-theme', t)`、永続化は `Storage.loadTheme()` / `Storage.saveTheme(t)`（`tmg_theme`）。

### コミット

日本語のメッセージで、末尾に必ず以下を付ける。

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

## ファイル構成

| ファイル | 責務 | 状態 |
|---|---|---|
| `theme.css` | `:root` と `[data-theme="dark"]` のテーマ変数だけ | **新規** |
| `style.css` | テーマ変数を削除（採点画面のレイアウトのみ） | 変更 |
| `index.html` | `theme.css` の読み込みを `style.css` の**前**に追加 | 変更 |
| `ranking.html` | 同上 | 変更 |
| `techniques.html` | 同上 | 変更 |
| `techpicker.js` | 技の選択状態（純粋関数）とボトムシート・チップ描画 | **新規** |
| `admin.html` | 運営画面の骨組み（上部バー・本文・下タブ・トースト） | **新規** |
| `admin.css` | 運営画面のスタイル。375px 基準 | **新規** |
| `admin.js` | タブ登録・ハッシュ routing・大会読み込み・トースト・コートチップ・テーマ | **新規** |
| `admin-events.js` | 大会タブ（一覧・新規作成・削除） | **新規** |
| `admin-players.js` | 選手タブ（一覧・追加・編集・削除・CSVインポート） | **新規** |
| `test.html` | `techpicker.js` の読み込みとテスト16〜17 | 変更 |

計画3 が `admin-round.js` / `admin-results.js` を `admin.html` のスクリプト末尾に足す。**`app.js` / `index.html` の採点機能・`server/index.js` はこの計画では触らない。**

### 完成時の `admin.html` のスクリプト順（契約。変えない）

```html
<script src="api.js"></script>
<script src="storage.js"></script>
<script src="courts.js"></script>
<script src="techpicker.js"></script>
<script src="admin.js"></script>
<script src="admin-events.js"></script>
<script src="admin-players.js"></script>
```

このうち `admin-events.js` は Task 6、`admin-players.js` は Task 8 で追加する（存在しないファイルを読んで 404 を出さないため、作った回で足す）。

---

## Task 1: `theme.css` の切り出し

`style.css` は変数を62箇所で参照している。読み忘れると表示が崩れるので、既存3ページすべてに `theme.css` を足したことを実測で確認する。

**Files:**
- Create: `theme.css`
- Modify: `style.css`
- Modify: `index.html`
- Modify: `ranking.html`
- Modify: `techniques.html`

- [ ] **Step 1: 現在のテストが緑であることを確認する**

サーバーを起動し、`http://localhost:3457/test.html` を開く。

Expected: `Result: 208 passed, 0 failed`

- [ ] **Step 2: `theme.css` を新規作成する**

`style.css` の1〜49行目（`/* ===== CSS変数（ライトテーマ デフォルト） ===== */` から `[data-theme="dark"]` ブロックの閉じ括弧まで）をそのまま移す。**値は1つも変えない。**

```css
/* ===== テーマ変数 =====
   全ページ共通。style.css / admin.css より先に読み込むこと。
   style.css はこの変数を62箇所で参照しているため、読み忘れると表示が崩れる。
   新規ページ（admin.html など）は theme.css と自分の CSS だけを読み、
   style.css は読まない（body{min-width:768px} を持ち込まないため）。 */

/* ライトテーマ（デフォルト） */
:root {
  --bg:           #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-header:    #e8e8f0;
  --border:       #cccccc;
  --text:         #222222;
  --text-muted:   #666666;
  --accent:       #2c5282;
  --accent-text:  #ffffff;
  --cell-success: #d4edda;
  --cell-success-text: #155724;
  --cell-fail:    #f8d7da;
  --cell-fail-text:    #721c24;
  --cell-disabled:#cccccc;
  --timer-bg:     #c0392b;
  --timer-text:   #ffffff;
  --btn-success:  #27ae60;
  --btn-fail:     #c0392b;
  --btn-neutral:  #3498db;
  --score-color:  #d35400;
  --warn:         #b7791f;
  --banner-text:  #ffffff;
}

/* ダークテーマ */
[data-theme="dark"] {
  --bg:           #1a1a2e;
  --bg-secondary: #16213e;
  --bg-header:    #2a2a4e;
  --border:       #444466;
  --text:         #e0e0ff;
  --text-muted:   #9999bb;
  --accent:       #4a90d9;
  --accent-text:  #ffffff;
  --cell-success: #1a5c2a;
  --cell-success-text: #4ade80;
  --cell-fail:    #5c1a1a;
  --cell-fail-text:    #ff8888;
  --cell-disabled:#333355;
  --timer-bg:     #c0392b;
  --timer-text:   #ffffff;
  --btn-success:  #27ae60;
  --btn-fail:     #c0392b;
  --btn-neutral:  #2980b9;
  --score-color:  #f1c40f;
  --warn:         #f6ad55;
  --banner-text:  #ffffff;
}
```

- [ ] **Step 3: `style.css` から変数ブロックを削除する**

`style.css` の先頭は現在こうなっている。

```css
/* ===== CSS変数（ライトテーマ デフォルト） ===== */
:root {
  --bg:           #ffffff;
```

1行目から `[data-theme="dark"] { … }` の閉じ括弧（49行目）とその後の空行までを削除し、ファイルの先頭を以下にする。

```css
/* ===== 採点画面のレイアウト =====
   色は theme.css の変数を使う。このファイル単体では読み込まないこと。 */

/* ===== リセット & ベース ===== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Meiryo", "Yu Gothic", "ヒラギノ角ゴ Pro W3", sans-serif;
  font-size: 14px;
  background: var(--bg);
  color: var(--text);
  min-width: 768px;   /* 採点画面は意図的にタブレット専用。運営画面は admin.html 側 */
}
```

以下で変数定義が残っていないことを確認する。

```bash
grep -n "^:root\|^\[data-theme" style.css
```

Expected: 何も出力されない。

- [ ] **Step 4: 既存3ページに `theme.css` の読み込みを追加する**

`index.html` の7行目:

```html
  <link rel="stylesheet" href="style.css">
```

↓

```html
  <link rel="stylesheet" href="theme.css">
  <link rel="stylesheet" href="style.css">
```

`ranking.html` の7行目、`techniques.html` の7行目も**まったく同じ置き換え**を行う（3ファイルすべて）。以下で3件そろっていることを確認する。

```bash
grep -c 'href="theme.css"' index.html ranking.html techniques.html
```

Expected:
```
index.html:1
ranking.html:1
techniques.html:1
```

- [ ] **Step 5: 3ページ × 2テーマで変数が解決していることを実測する**

`mcp__Claude_Browser__navigate` で `http://localhost:3457/index.html` を開き、`mcp__Claude_Browser__javascript_tool` で以下を実行する。

```javascript
(function() {
  var cs = getComputedStyle(document.body);
  var light = cs.getPropertyValue('--accent').trim();
  document.body.setAttribute('data-theme', 'dark');
  var dark = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  var warn = getComputedStyle(document.body).getPropertyValue('--warn').trim();
  document.body.setAttribute('data-theme', 'light');
  return [light, dark, warn];
})()
```

Expected: `["#2c5282", "#4a90d9", "#f6ad55"]`

`http://localhost:3457/ranking.html` と `http://localhost:3457/techniques.html` でも同じスクリプトを実行する。

Expected: 3ページとも `["#2c5282", "#4a90d9", "#f6ad55"]`

- [ ] **Step 6: コンソールにエラーが無いことを確認する**

`mcp__Claude_Browser__read_console_messages`（`onlyErrors: true`）を3ページそれぞれで実行する。

Expected: 0件（`theme.css` の 404 が出ていないこと）

- [ ] **Step 7: テストが緑のままであることを確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 208 passed, 0 failed`

- [ ] **Step 8: コミット**

```bash
git add theme.css style.css index.html ranking.html techniques.html
git commit -m "refactor: テーマ変数を theme.css に切り出し、既存3ページで先に読み込む" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: `techpicker.js` の純粋関数（TDD）

選択状態を DOM から切り離す。**先にテストを書いて落とす。**

**Files:**
- Create: `techpicker.js`
- Modify: `test.html`

- [ ] **Step 1: `test.html` に `techpicker.js` の読み込みを足す**

`test.html` の以下の行:

```html
<script src="outbox.js"></script>
```

↓

```html
<script src="outbox.js"></script>
<script src="techpicker.js"></script>
```

- [ ] **Step 2: 失敗するテストを書く（テスト16〜17）**

`test.html` のメイン IIFE 内、`route.js` の見出しを作る以下の行の**直前**に挿入する。

```javascript
    var h2r = document.createElement('h2');
    h2r.textContent = 'route.js';
```

挿入する内容:

```javascript
    var h2tp = document.createElement('h2');
    h2tp.textContent = 'techpicker.js';
    results.appendChild(h2tp);

    // select: 未選択なら末尾に追加（最大3）、選択済みならタップで外して後ろを詰める
    assert('select: 空の state に1つ追加', TechPicker.select([], '真'), ['真']);
    assert('select: 2つ目は末尾に付く',
      TechPicker.select(['真'], '水月'), ['真', '水月']);
    assert('select: 3つ目まで入る',
      TechPicker.select(['真', '水月'], '四方'), ['真', '水月', '四方']);
    assert('select: 4つ目は無視される',
      TechPicker.select(['真', '水月', '四方'], '夢想返し'), ['真', '水月', '四方']);
    assert('select: 選択済みをもう一度選ぶと外れて後ろが詰まる',
      TechPicker.select(['真', '水月', '四方'], '水月'), ['真', '四方']);
    assert('select: 元の state を破壊しない', (function() {
      var st = ['真', '水月'];
      TechPicker.select(st, '四方');
      return st;
    })(), ['真', '水月']);
    assert('select: state が null でも落ちない', TechPicker.select(null, '真'), ['真']);

    assert('toArray: 未選択は空文字で3枠', TechPicker.toArray([]), ['', '', '']);
    assert('toArray: 2つなら3枠目が空文字',
      TechPicker.toArray(['真', '水月']), ['真', '水月', '']);
    assert('toArray: 3つはそのまま',
      TechPicker.toArray(['真', '水月', '四方']), ['真', '水月', '四方']);
    assert('toArray: null は空3枠', TechPicker.toArray(null), ['', '', '']);
    assert('fromArray: 空文字を落として詰める',
      TechPicker.fromArray(['真', '', '四方']), ['真', '四方']);
    assert('fromArray: 全部空なら空配列', TechPicker.fromArray(['', '', '']), []);
    assert('fromArray: null は空配列', TechPicker.fromArray(null), []);
    assert('toArray → fromArray → toArray で往復する',
      TechPicker.toArray(TechPicker.fromArray(['真', '', '四方'])), ['真', '四方', '']);
```

- [ ] **Step 3: テストが失敗することを確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: 実行が途中で止まり、`mcp__Claude_Browser__read_console_messages`（`onlyErrors: true`）に `TechPicker is not defined` が出る。`Result:` の行は表示されない。

- [ ] **Step 4: `techpicker.js` を純粋関数だけで作る**

```javascript
// 技の選択（最大3・順序つき）と、その選択 UI。
// 選択状態は純粋関数だけで扱い、DOM を触る関数（open / renderChips）と分けてある。
// 将来「選手が自分のスマホで技を申告する」画面にそのまま流用するため。
var TechPicker = (function() {
  var MAX = 3;
  var CIRCLED = ['①', '②', '③'];

  // --- 純粋関数 ---

  // 未選択なら末尾に追加（最大3。4つ目は無視する）。
  // 選択済みの技を渡すとそれを外し、後ろを詰める（②を外せば③が②になる）。
  // 常に新しい配列を返す。呼び出し元の state は壊さない。
  function select(state, name) {
    var list = (state || []).slice();
    var i = list.indexOf(name);
    if (i >= 0) {
      list.splice(i, 1);
      return list;
    }
    if (list.length >= MAX) return list;
    list.push(name);
    return list;
  }

  // ['技1', '技2', '技3']。未選択の枠は ''。
  function toArray(state) {
    var list = state || [];
    var out = [];
    for (var i = 0; i < MAX; i++) {
      out.push(list[i] || '');
    }
    return out;
  }

  // ['a', '', 'c'] → ['a', 'c']。空の枠を落として詰める。
  function fromArray(names) {
    var out = [];
    (names || []).forEach(function(n) {
      if (n) out.push(n);
    });
    return out.slice(0, MAX);
  }

  return {
    select: select,
    toArray: toArray,
    fromArray: fromArray
  };
})();
```

- [ ] **Step 5: テストが通ることを確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 234 passed, 0 failed`

- [ ] **Step 6: コミット**

```bash
git add techpicker.js test.html
git commit -m "feat: 技の選択状態を扱う TechPicker の純粋関数を追加" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: `TechPicker` のボトムシートとチップ描画

`open` と `renderChips` を足す。純粋関数のテストは緑のまま維持する。

（コードレビュー後の追記）`strikesLabel` は外部から呼べるよう `TechPicker` の返り値にも含めてエクスポートする。また `open` は再入時（シートを開いたまま別の行のシートを開いた場合）に前のシートの `onClose` をその時点の最終 state で呼んでから閉じる。

**Files:**
- Modify: `techpicker.js`

- [ ] **Step 1: `strikesLabel` とシート・チップの描画を追加する**

`techpicker.js` の以下の行:

```javascript
  return {
    select: select,
    toArray: toArray,
    fromArray: fromArray
  };
```

を、以下に差し替える。

```javascript
  // --- 表示ヘルパ ---

  // 配点の表示。null（打てない太刀）は飛ばして '/' でつなぐ。例: 四方 → '17/5/7/3'
  function strikesLabel(tech) {
    var s = (tech && tech.strikes) || [];
    var parts = [];
    for (var i = 0; i < s.length; i++) {
      if (s[i] !== null && s[i] !== undefined) parts.push(String(s[i]));
    }
    return parts.join('/');
  }

  // --- DOM ---

  // 開いているシート。多重に開かないよう1枚だけ持つ。
  var openSheet = null;

  function closeSheet() {
    if (openSheet && openSheet.parentNode) openSheet.parentNode.removeChild(openSheet);
    openSheet = null;
  }

  // ①②③ のチップを el に描く。空きの枠は「＋」。
  // 空きを赤くしたい画面（計画3の進行タブ）は el に class="chips-required" を付ける。
  function renderChips(el, state, onTap) {
    el.innerHTML = '';
    var arr = toArray(state);
    for (var i = 0; i < MAX; i++) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = arr[i] ? 'chip' : 'chip empty';
      chip.textContent = CIRCLED[i] + ' ' + (arr[i] || '＋');
      chip.dataset.name = arr[i] || '';
      chip.addEventListener('click', function() {
        if (onTap) onTap(this.dataset.name);
      });
      el.appendChild(chip);
    }
  }

  // 下部シートを開く。
  // options = { techniques, initial, onChange, onClose }
  //   techniques : Api.loadTechniques() の techniques 配列
  //   initial    : 選択済みの state（配列）
  //   onChange   : 1タップごとに新しい state を受け取る
  //   onClose    : 閉じたときに最終的な state を受け取る
  function open(options) {
    closeSheet();
    var opts = options || {};
    var state = (opts.initial || []).slice();
    var techs = opts.techniques || [];

    var overlay = document.createElement('div');
    overlay.className = 'tp-overlay';
    var sheet = document.createElement('div');
    sheet.className = 'tp-sheet';

    var head = document.createElement('div');
    head.className = 'tp-head';
    var title = document.createElement('span');
    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'tp-close';
    btnClose.textContent = '完了';
    head.appendChild(title);
    head.appendChild(btnClose);

    var list = document.createElement('div');
    list.className = 'tp-list';

    // 選択順の番号と選択中の見た目を付け直す
    function refresh() {
      title.textContent = state.length < MAX
        ? '技を選ぶ — ' + (state.length + 1) + 'つ目'
        : '技を選ぶ — 3つ選択済み';
      var rows = list.querySelectorAll('.tp-item');
      for (var i = 0; i < rows.length; i++) {
        var pos = state.indexOf(rows[i].dataset.name);
        rows[i].className = pos >= 0 ? 'tp-item on' : 'tp-item';
        rows[i].querySelector('.tp-no').textContent = pos >= 0 ? CIRCLED[pos] : '';
      }
    }

    techs.forEach(function(t) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'tp-item';
      item.dataset.name = t.name;
      // 枠だけ innerHTML で作り、値は textContent で入れる（技名はサーバー由来）
      item.innerHTML = '<span class="tp-no"></span><span class="tp-name"></span><span class="tp-pt"></span>';
      item.querySelector('.tp-name').textContent = t.name;
      item.querySelector('.tp-pt').textContent = strikesLabel(t);
      item.addEventListener('click', function() {
        state = select(state, this.dataset.name);
        refresh();
        if (opts.onChange) opts.onChange(state.slice());
      });
      list.appendChild(item);
    });

    sheet.appendChild(head);
    sheet.appendChild(list);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    openSheet = overlay;
    refresh();

    function done() {
      closeSheet();
      if (opts.onClose) opts.onClose(state.slice());
    }
    btnClose.addEventListener('click', done);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) done();   // シートの外側をタップしたら閉じる
    });
  }

  return {
    select: select,
    toArray: toArray,
    fromArray: fromArray,
    open: open,
    renderChips: renderChips
  };
```

- [ ] **Step 2: テストが緑のままであることを確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 234 passed, 0 failed`

- [ ] **Step 3: コミット**

```bash
git add techpicker.js
git commit -m "feat: TechPicker のボトムシートとチップ描画を追加" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: `admin.html` の骨組みと `admin.css`

DOM とスクリプト順は計画3が乗る契約。**要素の id・class・タブの順序を変えない。**

**Files:**
- Create: `admin.html`
- Create: `admin.css`

- [ ] **Step 1: `admin.html` を作る（スクリプトはまだ足さない）**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>試し斬り 運営</title>
  <link rel="stylesheet" href="theme.css">
  <link rel="stylesheet" href="admin.css">
</head>
<body data-theme="light">

  <header class="topbar"><span id="topTitle">試し斬り 運営</span><button id="btnTheme" class="theme-btn">🌙</button></header>
  <main id="tabContent"></main>
  <nav class="tabbar">
    <button data-tab="events">大会</button><button data-tab="players">選手</button>
    <button data-tab="round">進行</button><button data-tab="results">結果</button>
  </nav>
  <div id="toast" hidden></div>

</body>
</html>
```

- [ ] **Step 2: `admin.css` を作る**

```css
/* 運営画面（admin.html）専用のスタイル。375px 幅を基準に組む。
   style.css は読み込まない（body{min-width:768px} をこのページに持ち込まないため）。
   色は theme.css の変数だけを使う。
   タップ目標は 44px 以上を守ること（スマホ片手操作が前提）。 */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: "Meiryo", "Yu Gothic", "ヒラギノ角ゴ Pro W3", sans-serif;
  font-size: 15px;
  line-height: 1.5;
  background: var(--bg);
  color: var(--text);
  padding: 52px 0 64px;   /* 上下の固定バーの高さぶん本文を逃がす */
  -webkit-text-size-adjust: 100%;
}

button {
  font-family: inherit;
  font-size: 15px;
  cursor: pointer;
  border: none;
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text);
}

input[type="text"], input[type="date"] {
  font-family: inherit;
  font-size: 16px;        /* 16px 未満だと iOS がフォーカス時にページを拡大する */
  width: 100%;
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}

/* ===== 上部バー ===== */
.topbar {
  position: fixed; top: 0; left: 0; right: 0; height: 52px; z-index: 30;
  display: flex; align-items: center; gap: 8px; padding: 0 8px 0 12px;
  background: var(--accent); color: var(--accent-text);
}
#topTitle {
  flex: 1; font-weight: bold;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.theme-btn {
  width: 44px; height: 44px; font-size: 20px;
  background: transparent; color: var(--accent-text);
}

/* ===== 下タブ ===== */
.tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  display: flex; background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}
.tabbar button {
  flex: 1; min-height: 56px; border-radius: 0; font-size: 13px;
  background: transparent; color: var(--text-muted);
  border-top: 3px solid transparent;
}
.tabbar button.on {
  color: var(--accent); font-weight: bold; border-top-color: var(--accent);
}

/* ===== 本文 ===== */
main { padding: 8px 12px 16px; }
.section-head { display: flex; align-items: center; gap: 8px; margin: 4px 0 10px; }
.section-head h2 { font-size: 16px; }
.section-head .spacer { flex: 1; }
.head-btn { min-height: 44px; padding: 0 12px; background: var(--accent); color: var(--accent-text); }
.icon-btn { min-width: 44px; min-height: 44px; font-size: 18px; }
.empty { color: var(--text-muted); padding: 16px 4px; }

/* ===== コート絞り込みチップ =====
   コートが増えても body の横スクロールを作らないよう、この帯の中だけで横に流す */
.court-chips {
  display: flex; gap: 6px; margin-bottom: 10px;
  overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch;
}
.court-chip {
  flex: 0 0 auto; min-height: 44px; padding: 0 14px; border-radius: 22px;
  border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text);
}
.court-chip.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }

/* ===== 一覧の行 ===== */
.list { display: flex; flex-direction: column; gap: 6px; }
.row {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 56px; padding: 8px 10px; text-align: left;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text);
}
.row-body { flex: 1; min-width: 0; }
.row-main { font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-badge {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 13px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: bold;
  background: var(--bg-header); color: var(--text-muted);
}
.row-score { flex: 0 0 auto; font-weight: bold; color: var(--score-color); }
.row-del { flex: 0 0 auto; min-width: 44px; min-height: 44px; background: transparent; color: var(--text-muted); font-size: 16px; }

/* ===== 右下の追加ボタン ===== */
.fab {
  position: fixed; right: 16px; bottom: 72px; z-index: 25;
  width: 56px; height: 56px; border-radius: 28px; font-size: 26px; line-height: 1;
  background: var(--btn-success); color: #fff;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
}

/* ===== シート（フォーム・メニュー共用） ===== */
.sheet-overlay {
  position: fixed; inset: 0; z-index: 40;
  background: rgba(0, 0, 0, 0.45); display: flex; align-items: flex-end;
}
.sheet {
  width: 100%; max-height: 92vh; display: flex; flex-direction: column;
  background: var(--bg); border-radius: 14px 14px 0 0; border-top: 2px solid var(--accent);
}
.sheet-head {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 14px;
  border-bottom: 1px solid var(--border); font-weight: bold;
}
.sheet-head span { flex: 1; }
.sheet-close { min-width: 44px; min-height: 44px; background: transparent; color: var(--text-muted); }
.sheet-body { flex: 1; overflow-y: auto; padding: 10px 14px 14px; }
.sheet-actions { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
.btn { flex: 1; min-height: 48px; }
.btn.primary { background: var(--btn-success); color: #fff; font-weight: bold; }
.btn.danger { background: var(--btn-fail); color: #fff; }
.menu-item { display: block; width: 100%; min-height: 52px; text-align: left; padding: 0 12px; margin-bottom: 8px; }

/* ===== フォーム部品 ===== */
.field { margin-bottom: 12px; }
.field > label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg button {
  flex: 1 0 auto; min-width: 56px; min-height: 44px;
  border: 1px solid var(--accent); background: var(--bg); color: var(--accent);
}
.seg button.on { background: var(--accent); color: var(--accent-text); font-weight: bold; }
.toggle { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.toggle input { width: 22px; height: 22px; }

/* 技チップ */
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  min-height: 44px; padding: 0 14px; border-radius: 22px;
  background: var(--accent); color: var(--accent-text); border: 1px solid var(--accent);
}
.chip.empty { background: var(--bg-secondary); color: var(--text-muted); border-color: var(--border); }
/* 未入力を目立たせたい画面（計画3の進行タブ）は親に .chips-required を付ける */
.chips-required .chip.empty { background: var(--btn-fail); color: var(--banner-text); border-color: var(--btn-fail); }

/* ===== TechPicker のボトムシート ===== */
.tp-overlay { position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, 0.45); display: flex; align-items: flex-end; }
.tp-sheet {
  width: 100%; max-height: 80vh; display: flex; flex-direction: column;
  background: var(--bg); border-radius: 14px 14px 0 0; border-top: 2px solid var(--accent);
}
.tp-head {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 14px;
  border-bottom: 1px solid var(--border); font-weight: bold;
}
.tp-head span { flex: 1; }
.tp-close { min-width: 64px; min-height: 44px; }
.tp-list { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.tp-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 48px; padding: 0 14px; text-align: left;
  border-radius: 0; background: transparent; color: var(--text);
  border-bottom: 1px solid var(--border);
}
.tp-item.on { background: var(--bg-header); font-weight: bold; }
.tp-no { flex: 0 0 auto; width: 20px; color: var(--accent); }
.tp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-pt { flex: 0 0 auto; font-size: 12px; color: var(--text-muted); }

/* ===== トースト ===== */
#toast {
  position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); z-index: 60;
  max-width: 90vw; padding: 10px 16px; border-radius: 20px;
  background: var(--accent); color: var(--accent-text); font-size: 14px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
/* #toast に display を指定しているので、hidden 属性を明示的に効かせる */
#toast[hidden] { display: none; }
```

- [ ] **Step 3: 375px で骨組みが収まることを確認する**

`mcp__Claude_Browser__resize_window`（`preset: "mobile"`）→ `mcp__Claude_Browser__navigate` で `http://localhost:3457/admin.html` を開き、`javascript_tool` で実行する。

```javascript
(function() {
  var tabs = document.querySelectorAll('.tabbar button');
  return {
    noHScroll: document.body.scrollWidth <= window.innerWidth,
    width: window.innerWidth,
    tabCount: tabs.length,
    tabHeight: Math.round(tabs[0].getBoundingClientRect().height),
    tabTop: Math.round(tabs[0].getBoundingClientRect().top),
    themeBtn: Math.round(document.getElementById('btnTheme').getBoundingClientRect().height),
    toastHidden: getComputedStyle(document.getElementById('toast')).display
  };
})()
```

Expected: `{ noHScroll: true, width: 375, tabCount: 4, tabHeight: 56, tabTop: 756, themeBtn: 44, toastHidden: "none" }`
（`tabTop` は 812 − 56 = 756。下タブが画面下に固定されていることの確認）

- [ ] **Step 4: コンソールにエラーが無いことを確認する**

`mcp__Claude_Browser__read_console_messages`（`onlyErrors: true`）

Expected: 0件

- [ ] **Step 5: コミット**

```bash
git add admin.html admin.css
git commit -m "feat: 運営画面 admin.html の骨組みと 375px 基準の admin.css を追加" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: `admin.js` — タブ骨組み・ハッシュ routing・トースト

計画3 が乗る契約。**`registerTab` / `navigate` / `reloadEvent` / `currentEventId` / `toast` / `renderCourtChips` の6つ以外を公開しない。**

**Files:**
- Create: `admin.js`
- Modify: `admin.html`

- [ ] **Step 1: `admin.js` を作る**

```javascript
// 運営画面の骨組み。
// タブの中身は admin-events.js / admin-players.js（計画3で admin-round.js /
// admin-results.js）が Admin.registerTab で登録する。このモジュールは
// 「どのタブを、どの大会で描くか」だけを持ち、画面の中身は知らない。
//
// ハッシュ体系: #events / #players/<大会ID> / #round/<大会ID> / #results/<大会ID>
// 採点画面の Route（#event/<id>/<court>）とは別体系で、ここで完結させる。
// 選択中の大会は localStorage の tmg_admin_last に控える（採点画面の tmg_last とは分ける。
// 運営者のスマホとコートのタブレットは別端末で、混ぜる理由がない）。
var Admin = (function() {
  var LAST_KEY = 'tmg_admin_last';
  var TABS = ['events', 'players', 'round', 'results'];

  var defs = {};
  var content = null;
  var currentTab = 'events';
  var selectedEventId = null;
  var toastTimer = null;

  // 描画の再入ガード。Api.loadEvent の往復中にタブを切り替えられると、
  // 遅れて戻ってきた古い応答が新しい画面を上書きする。
  var renderSeq = 0;

  // --- タブ登録 ---

  // def = { render: function(container, ctx) }  render は async でもよい
  // ctx = { eventId, event, players }（events タブでは event / players は null）
  function registerTab(name, def) {
    defs[name] = def;
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
      applyRoute();          // 同じハッシュでは hashchange が出ないので直接描く
    } else {
      location.hash = hash;  // hashchange → applyRoute
    }
  }

  async function applyRoute() {
    var route = parseHash(location.hash);
    if (!route) {
      // ハッシュが無いときは前回の続きから。それも無ければ大会一覧。
      var last = loadLast() || { tab: 'events', eventId: '' };
      navigate(last.tab, last.eventId);
      return;
    }
    if (route.tab !== 'events' && !route.eventId) {
      navigate('events');
      return;
    }

    currentTab = route.tab;
    selectedEventId = route.eventId || null;
    saveLast();
    highlightTabs();

    var seq = ++renderSeq;
    if (currentTab === 'events') {
      setTitle('試し斬り 運営');
      renderTab(seq, { eventId: null, event: null, players: null });
      return;
    }

    content.innerHTML = '';
    var loading = document.createElement('p');
    loading.className = 'empty';
    loading.textContent = '読み込み中…';
    content.appendChild(loading);

    var ev = await Api.loadEvent(selectedEventId);
    if (seq !== renderSeq) return;   // 追い越された
    if (!ev) {
      alert('大会データを取得できませんでした。通信を確認してください。');
      navigate('events');
      return;
    }
    setTitle(ev.name || '試し斬り 運営');
    renderTab(seq, { eventId: selectedEventId, event: ev, players: ev.players || [] });
  }

  // 現在の大会を読み直して、いま開いているタブを描き直す
  async function reloadEvent() {
    if (!selectedEventId) return;
    var seq = ++renderSeq;
    var ev = await Api.loadEvent(selectedEventId);
    if (seq !== renderSeq) return;
    if (!ev) {
      alert('大会データを取得できませんでした。通信を確認してください。');
      return;
    }
    setTitle(ev.name || '試し斬り 運営');
    renderTab(seq, { eventId: selectedEventId, event: ev, players: ev.players || [] });
  }

  async function renderTab(seq, ctx) {
    var def = defs[currentTab];
    content.innerHTML = '';
    if (!def) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'このタブはまだ準備中です。';
      content.appendChild(p);
      return;
    }
    await def.render(content, ctx);
  }

  function currentEventId() {
    return selectedEventId || null;
  }

  // --- 画面の共通部品 ---

  function setTitle(text) {
    document.getElementById('topTitle').textContent = text;
  }

  function highlightTabs() {
    var btns = document.querySelectorAll('.tabbar button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].dataset.tab === currentTab);
    }
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.hidden = true; }, 2000);
  }

  // コート絞り込みのチップ列。「全コート」（court = ''）＋ Courts.listFrom の並び。
  // 選手タブと進行タブで共用する。
  function renderCourtChips(container, players, current, onChange) {
    container.innerHTML = '';
    var list = [''].concat(Courts.listFrom(players));
    list.forEach(function(c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = (c === (current || '')) ? 'court-chip on' : 'court-chip';
      if (c === '') b.textContent = '全コート';
      else if (c === Courts.UNASSIGNED) b.textContent = Courts.UNASSIGNED;
      else b.textContent = c + ' コート';
      b.dataset.court = c;
      b.addEventListener('click', function() {
        if (onChange) onChange(this.dataset.court);
      });
      container.appendChild(b);
    });
  }

  // --- テーマ ---

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀' : '🌙';
  }

  // --- 起動 ---

  function init() {
    content = document.getElementById('tabContent');
    applyTheme(Storage.loadTheme());
    document.getElementById('btnTheme').addEventListener('click', function() {
      var next = Storage.loadTheme() === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });

    var btns = document.querySelectorAll('.tabbar button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function() {
        navigate(this.dataset.tab, selectedEventId);
      });
    }

    window.addEventListener('hashchange', function() { applyRoute(); });
    applyRoute();
  }

  // 各タブの登録（admin-events.js など）はスクリプト読み込み時に済むので、
  // DOMContentLoaded の時点では defs がそろっている。
  document.addEventListener('DOMContentLoaded', init);

  return {
    registerTab: registerTab,
    navigate: navigate,
    reloadEvent: reloadEvent,
    currentEventId: currentEventId,
    toast: toast,
    renderCourtChips: renderCourtChips
  };
})();
```

- [ ] **Step 2: `admin.html` にスクリプトを足す**

`admin.html` の以下の行:

```html
  <div id="toast" hidden></div>

</body>
```

↓

```html
  <div id="toast" hidden></div>

  <script src="api.js"></script>
  <script src="storage.js"></script>
  <script src="courts.js"></script>
  <script src="techpicker.js"></script>
  <script src="admin.js"></script>

</body>
```

- [ ] **Step 3: routing とトーストを実測で確認する**

`http://localhost:3457/admin.html` を開き（375px のまま）、`javascript_tool` で実行する。

```javascript
(function() {
  var on = document.querySelector('.tabbar button.on');
  return {
    hash: location.hash,
    activeTab: on ? on.dataset.tab : null,
    body: document.getElementById('tabContent').textContent,
    last: localStorage.getItem('tmg_admin_last')
  };
})()
```

Expected: `{ hash: "#events", activeTab: "events", body: "このタブはまだ準備中です。", last: "{\"tab\":\"events\",\"eventId\":\"\"}" }`

続けて実行する。

```javascript
(function() {
  Admin.navigate('players', 'abc123');
  return [location.hash, Admin.currentEventId()];
})()
```

Expected: `["#players/abc123", "abc123"]`
（存在しない大会IDなので `大会データを取得できませんでした` の alert が出て `#events` に戻る。alert が出ることも期待どおり。alert を閉じてから次へ進む）

トーストを確認する。

```javascript
(function() {
  Admin.toast('テスト通知');
  var el = document.getElementById('toast');
  return [el.hidden, el.textContent, getComputedStyle(el).display];
})()
```

Expected: `[false, "テスト通知", "block"]`（`none` でなければよい）。2秒後にもう一度 `document.getElementById('toast').hidden` を評価すると `true`。

- [ ] **Step 4: コンソールにエラーが無いことを確認する**

`mcp__Claude_Browser__read_console_messages`（`onlyErrors: true`）

Expected: 0件（`Admin is not defined` / `Courts is not defined` / 404 が無いこと）

- [ ] **Step 5: コミット**

```bash
git add admin.js admin.html
git commit -m "feat: 運営画面の骨組み admin.js（タブ登録・ハッシュ routing・トースト）" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: `admin-events.js` — 大会一覧

**Files:**
- Create: `admin-events.js`
- Modify: `admin.html`

- [ ] **Step 1: `admin-events.js` を作る（一覧のみ）**

```javascript
// 大会タブ（#events）。大会の一覧・新規作成・削除。
(function() {

  async function render(container) {
    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '大会';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.appendChild(h2);
    head.appendChild(spacer);
    container.appendChild(head);

    var list = document.createElement('div');
    list.className = 'list';
    container.appendChild(list);

    var loading = document.createElement('p');
    loading.className = 'empty';
    loading.textContent = '読み込み中…';
    list.appendChild(loading);

    var events = await Api.listEvents();
    list.innerHTML = '';
    if (!events) {
      // 取得できなかっただけで、大会が消えたわけではない。「0件」と誤解させない。
      var err = document.createElement('p');
      err.className = 'empty';
      err.textContent = '大会一覧を取得できませんでした。通信を確認してください。';
      list.appendChild(err);
      alert('大会一覧を取得できませんでした。通信を確認してください。');
      return;
    }
    if (events.length === 0) {
      var none = document.createElement('p');
      none.className = 'empty';
      none.textContent = '大会がまだありません。「＋ 新規大会」で作成してください。';
      list.appendChild(none);
      return;
    }

    // 直近に触った大会を上に出す
    events.sort(function(a, b) {
      var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
      if (x === y) return 0;
      return x < y ? 1 : -1;
    });

    events.forEach(function(ev) {
      list.appendChild(buildRow(ev));
    });
  }

  function buildRow(ev) {
    var row = document.createElement('div');
    row.className = 'row';

    var body = document.createElement('button');
    body.type = 'button';
    body.className = 'row-body';
    body.style.background = 'transparent';
    body.style.color = 'inherit';
    body.style.textAlign = 'left';
    body.style.minHeight = '44px';
    var main = document.createElement('div');
    main.className = 'row-main';
    main.textContent = ev.name || '(名称未設定)';
    var sub = document.createElement('div');
    sub.className = 'row-sub';
    sub.textContent = (ev.date || '日付なし') + ' ・ ' + (ev.playerCount || 0) + '名';
    body.appendChild(main);
    body.appendChild(sub);
    body.addEventListener('click', function() {
      Admin.navigate('players', ev.id);
    });

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'row-del';
    del.textContent = '✕';
    del.addEventListener('click', function() {
      onDelete(ev);
    });

    row.appendChild(body);
    row.appendChild(del);
    return row;
  }

  async function onDelete(ev) {
    if (!confirm('大会「' + (ev.name || '') + '」を削除します。\n選手データも一緒に消えます。よろしいですか？')) return;
    var ok = await Api.deleteEvent(ev.id);
    if (!ok) {
      alert('大会の削除に失敗しました。');
      return;
    }
    Admin.toast('大会を削除しました');
    Admin.navigate('events');
  }

  Admin.registerTab('events', { render: render });
})();
```

- [ ] **Step 2: `admin.html` に読み込みを足す**

`admin.html` の以下の行:

```html
  <script src="admin.js"></script>
```

↓

```html
  <script src="admin.js"></script>
  <script src="admin-events.js"></script>
```

- [ ] **Step 3: 一覧が出ることを確認する**

大会を1つも作っていない場合は、`http://localhost:3457/admin.html` を開いて `javascript_tool` で作っておく。

```javascript
await Api.saveEvent({ name: '確認用大会A', date: '2026-09-08', venue: '体育館', players: [] })
```

`http://localhost:3457/admin.html#events` をリロードし、`mcp__Claude_Browser__find` で `確認用大会A` を探す。

Expected: `.row-main` に `確認用大会A`、`.row-sub` に `2026-09-08 ・ 0名` が出る。

`javascript_tool` で行の高さを測る。

```javascript
Array.prototype.map.call(document.querySelectorAll('.row, .row-del'),
  function(el) { return Math.round(el.getBoundingClientRect().height); })
```

Expected: すべて 44 以上（`.row` は 56 以上）

- [ ] **Step 4: 大会をタップすると選手タブに移ることを確認する**

一覧の行をタップする（`mcp__Claude_Browser__find` で `確認用大会A` の ref を取り、`computer` の `left_click`）。

Expected: `location.hash` が `#players/<大会ID>` になり、下タブの「選手」に `on` が付き、本文が「このタブはまだ準備中です。」（`admin-players.js` は Task 8）。上部バーのタイトルが `確認用大会A`。

- [ ] **Step 5: コンソールにエラーが無いことを確認する**

`mcp__Claude_Browser__read_console_messages`（`onlyErrors: true`）

Expected: 0件

- [ ] **Step 6: コミット**

```bash
git add admin-events.js admin.html
git commit -m "feat: 運営画面の大会タブ（一覧と削除）" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: `admin-events.js` — 新規大会シート

通信に失敗したらシートは閉じずに入力を残す（採点画面の大会作成モーダルと同じ作法）。

**Files:**
- Modify: `admin-events.js`

- [ ] **Step 1: 「＋ 新規大会」ボタンを見出しに足す**

`admin-events.js` の以下の行:

```javascript
    head.appendChild(h2);
    head.appendChild(spacer);
    container.appendChild(head);
```

↓

```javascript
    var btnNew = document.createElement('button');
    btnNew.type = 'button';
    btnNew.className = 'head-btn';
    btnNew.textContent = '＋ 新規大会';
    btnNew.addEventListener('click', openNewSheet);

    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(btnNew);
    container.appendChild(head);
```

- [ ] **Step 2: シートを作る関数を足す**

`admin-events.js` の以下の行の**直前**に挿入する。

```javascript
  Admin.registerTab('events', { render: render });
```

挿入する内容:

```javascript
  // 新規大会のシート。
  // 保存に失敗したらシートを閉じない（閉じると入力し直しになる）。
  function openNewSheet() {
    var overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    var sheet = document.createElement('div');
    sheet.className = 'sheet';

    var head = document.createElement('div');
    head.className = 'sheet-head';
    var title = document.createElement('span');
    title.textContent = '新規大会';
    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'sheet-close';
    btnClose.textContent = '✕';
    head.appendChild(title);
    head.appendChild(btnClose);

    var body = document.createElement('div');
    body.className = 'sheet-body';
    var inName = addField(body, '大会名', 'text');
    var inDate = addField(body, '日付', 'date');
    var inVenue = addField(body, '会場', 'text');
    inDate.value = new Date().toISOString().split('T')[0];

    var actions = document.createElement('div');
    actions.className = 'sheet-actions';
    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn primary';
    btnSave.textContent = '作成';
    actions.appendChild(btnSave);

    sheet.appendChild(head);
    sheet.appendChild(body);
    sheet.appendChild(actions);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    inName.focus();

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    btnClose.addEventListener('click', close);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close();
    });

    btnSave.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnSave.disabled = true;
      var result = await Api.saveEvent({
        name: name,
        date: inDate.value,
        venue: inVenue.value.trim(),
        players: []
      });
      btnSave.disabled = false;
      if (!result || !result.id) {
        alert('大会の作成に失敗しました。通信を確認してください。');
        return;   // シートは開いたまま。入力を残す
      }
      close();
      Admin.toast('大会を作成しました');
      Admin.navigate('players', result.id);
    });
  }

  function addField(parent, labelText, type) {
    var field = document.createElement('div');
    field.className = 'field';
    var label = document.createElement('label');
    label.textContent = labelText;
    var input = document.createElement('input');
    input.type = type;
    field.appendChild(label);
    field.appendChild(input);
    parent.appendChild(field);
    return input;
  }
```

- [ ] **Step 3: 大会を作れることを確認する**

`http://localhost:3457/admin.html#events` をリロードし、「＋ 新規大会」をタップ。大会名に `運営テスト大会` を入れて「作成」。

Expected: シートが閉じ、「大会を作成しました」のトーストが出て、`location.hash` が `#players/<新しいID>` になる。上部バーが `運営テスト大会`。

`#events` に戻り、一覧の先頭に `運営テスト大会` が出ることを確認する。

Expected: `updatedAt` 降順なので先頭。

- [ ] **Step 4: 失敗時にシートが残ることを確認する**

`javascript_tool` で `Api.saveEvent` を一時的に失敗させてから操作する。

```javascript
(function() {
  window.__origSaveEvent = Api.saveEvent;
  Api.saveEvent = async function() { return null; };
  return 'stubbed';
})()
```

「＋ 新規大会」→ 大会名 `失敗テスト` → 「作成」。

Expected: `大会の作成に失敗しました。通信を確認してください。` の alert が出て、閉じたあともシートが開いたまま、大会名の入力欄に `失敗テスト` が残っている。

元に戻す。

```javascript
(function() { Api.saveEvent = window.__origSaveEvent; return 'restored'; })()
```

- [ ] **Step 5: 375px の確認とコンソール**

```javascript
Array.prototype.map.call(document.querySelectorAll('.head-btn, .sheet-close, .btn, .field input'),
  function(el) { return el.className + ':' + Math.round(el.getBoundingClientRect().height); })
```

Expected: すべての高さが 44 以上。`document.body.scrollWidth <= window.innerWidth` が `true`。

`read_console_messages`（`onlyErrors: true`）Expected: 0件

- [ ] **Step 6: コミット**

```bash
git add admin-events.js
git commit -m "feat: 運営画面の大会タブに新規大会シートを追加" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: `admin-players.js` — 選手一覧とコート絞り込み

一巡目・二巡目の両方を表示する。巡目は行の左端のバッジ。

**Files:**
- Create: `admin-players.js`
- Modify: `admin.html`

- [ ] **Step 1: `admin-players.js` を作る（一覧のみ）**

```javascript
// 選手タブ（#players/<大会ID>）。選手の一覧・追加・編集・削除。
(function() {
  var currentCourt = '';
  var courtOwner = null;   // currentCourt がどの大会のものか（大会が変われば全コートに戻す）
  var techCache = null;    // Api.loadTechniques() の techniques

  // 採点済みかどうか。サーバーの isScored と同じ判定を持つ。
  // result は 1=○, 0=×, 空白=未入力 でエンコードされている。
  function isScored(p) {
    if (!p) return false;
    if (typeof p.score === 'number' && p.score > 0) return true;
    return /[01]/.test(p.result || '');
  }

  // 行の並び順。order 文字列をそのまま比較すると 1-10 が 1-2 より前に来るので、
  // 巡目 → コート → 性別（男子が先）→ 番号 に分解して比べる。
  function orderKey(p) {
    var m = String((p && p.order) || '').match(/^(.+)-(男子|女子)-(\d+)-(\d+)$/);
    if (!m) return { court: Courts.courtOf(p), sex: 2, round: 1, no: 0 };
    return {
      court: m[1],
      sex: m[2] === '男子' ? 0 : 1,
      round: parseInt(m[3], 10),
      no: parseInt(m[4], 10)
    };
  }

  function compareOrder(a, b) {
    var x = orderKey(a), y = orderKey(b);
    if (x.round !== y.round) return x.round - y.round;
    if (x.court !== y.court) return x.court < y.court ? -1 : 1;
    if (x.sex !== y.sex) return x.sex - y.sex;
    return x.no - y.no;
  }

  async function render(container, ctx) {
    if (courtOwner !== ctx.eventId) {
      currentCourt = '';
      courtOwner = ctx.eventId;
    }

    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '選手 ' + ctx.players.length + '名';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.appendChild(h2);
    head.appendChild(spacer);
    container.appendChild(head);

    var chips = document.createElement('div');
    chips.className = 'court-chips';
    container.appendChild(chips);

    var list = document.createElement('div');
    list.className = 'list';
    container.appendChild(list);

    // コートを切り替えたらチップと一覧を描き直す
    function onCourtChange(court) {
      currentCourt = court;
      Admin.renderCourtChips(chips, ctx.players, currentCourt, onCourtChange);
      renderList(list, ctx);
    }
    Admin.renderCourtChips(chips, ctx.players, currentCourt, onCourtChange);
    renderList(list, ctx);

    // 技術リストは追加・編集フォームで使う。タブを開いたときに1回だけ取る。
    if (!techCache) {
      var td = await Api.loadTechniques();
      if (td && td.techniques) techCache = td.techniques;
    }
  }

  function renderList(list, ctx) {
    list.innerHTML = '';
    var rows = Courts.filter(ctx.players, currentCourt).slice().sort(compareOrder);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'empty';
      none.textContent = ctx.players.length === 0
        ? '選手がまだいません。右下の「＋」で追加してください。'
        : 'このコートに選手がいません。';
      list.appendChild(none);
      return;
    }
    rows.forEach(function(p) {
      list.appendChild(buildRow(ctx, p));
    });
  }

  function buildRow(ctx, p) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';

    var badge = document.createElement('span');
    badge.className = 'row-badge';
    badge.textContent = String(Courts.roundOf(p));

    var body = document.createElement('span');
    body.className = 'row-body';
    var main = document.createElement('span');
    main.className = 'row-main';
    main.textContent = (p.order || '') + '  ' + (p.name || '');
    var sub = document.createElement('span');
    sub.className = 'row-sub';
    var techs = [p.tech1, p.tech2, p.tech3].filter(function(t) { return !!t; });
    sub.textContent = techs.length ? techs.join(' / ') : '技 未入力';
    body.appendChild(main);
    body.appendChild(sub);

    var score = document.createElement('span');
    score.className = 'row-score';
    score.textContent = String(p.score || 0);

    row.appendChild(badge);
    row.appendChild(body);
    row.appendChild(score);
    return row;
  }

  Admin.registerTab('players', { render: render });
})();
```

- [ ] **Step 2: `admin.html` に読み込みを足す**

`admin.html` の以下の行:

```html
  <script src="admin-events.js"></script>
```

↓

```html
  <script src="admin-events.js"></script>
  <script src="admin-players.js"></script>
```

これで契約どおりの順（`api.js`, `storage.js`, `courts.js`, `techpicker.js`, `admin.js`, `admin-events.js`, `admin-players.js`）がそろう。以下で確認する。

```bash
grep -n '<script src=' admin.html
```

Expected: 7行が上記の順で並ぶ。

- [ ] **Step 3: 一覧が出ることを確認する**

Task 7 で作った `運営テスト大会` に選手を入れる。`javascript_tool` で実行する。

```javascript
(async function() {
  var id = Admin.currentEventId();
  var csv = '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' +
    '山田 太郎,A-男子-1-1,四方,,,0,,,\n' +
    '佐藤 花子,A-女子-1-1,水月,響き返し,,0,,○,\n' +
    '鈴木 次郎,B-男子-1-1,真,,,30,○,,1    \n' +
    '山田 太郎,A-男子-2-1,,,,0,,,\n';
  var r = await Api.importCsv(id, csv, 'replace', true);
  await Admin.reloadEvent();
  return r;
})()
```

Expected: `{ success: true, playerCount: 4 }` が返り、一覧に4行出る。並びは `A-男子-1-1 山田 太郎` → `A-女子-1-1 佐藤 花子` → `B-男子-1-1 鈴木 次郎` → `A-男子-2-1 山田 太郎`（巡目→コート→性別→番号）。

`javascript_tool` で確認する。

```javascript
Array.prototype.map.call(document.querySelectorAll('.list .row'), function(r) {
  return r.querySelector('.row-badge').textContent + '|' +
         r.querySelector('.row-main').textContent + '|' +
         r.querySelector('.row-sub').textContent + '|' +
         r.querySelector('.row-score').textContent;
})
```

Expected:
```
["1|A-男子-1-1  山田 太郎|四方|0",
 "1|A-女子-1-1  佐藤 花子|水月 / 響き返し|0",
 "1|B-男子-1-1  鈴木 次郎|真|30",
 "2|A-男子-2-1  山田 太郎|技 未入力|0"]
```

- [ ] **Step 4: コート絞り込みを確認する**

`javascript_tool` で `B コート` のチップをクリックする。

```javascript
(function() {
  var chips = document.querySelectorAll('.court-chip');
  for (var i = 0; i < chips.length; i++) {
    if (chips[i].dataset.court === 'B') { chips[i].click(); break; }
  }
  return Array.prototype.map.call(document.querySelectorAll('.list .row .row-main'),
    function(e) { return e.textContent; });
})()
```

Expected: `["B-男子-1-1  鈴木 次郎"]`。チップの `on` が「B コート」に移っている。

「全コート」に戻すと4行に戻る。

- [ ] **Step 5: コンソールと 375px**

```javascript
[document.body.scrollWidth, window.innerWidth, document.body.scrollWidth <= window.innerWidth]
```

Expected: `[375, 375, true]`

`read_console_messages`（`onlyErrors: true`）Expected: 0件

- [ ] **Step 6: コミット**

```bash
git add admin-players.js admin.html
git commit -m "feat: 運営画面の選手タブ（一覧とコート絞り込み）" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: `admin-players.js` — 選手追加フォーム

モックアップ B（一覧から順にタップ）の形。フォーム部品は編集モード（Task 10）と共用する。

**Files:**
- Modify: `admin-players.js`

- [ ] **Step 1: フォーム部品・シート・追加フォームを足す**

`admin-players.js` の以下の行の**直前**に挿入する。

```javascript
  Admin.registerTab('players', { render: render });
```

挿入する内容:

```javascript
  // --- フォーム部品（追加・編集で共用） ---
  // 戻り値: { el, read, reset }
  //   el    : シートの body に入れる DOM
  //   read(): { name, court, isFemale, isNewFace, tech1, tech2, tech3 } | null
  //           （不正なら alert を出して null）
  //   reset(): 名前と技だけ空にする（コート・性別は保つ。受付を連続処理するため）
  function buildPlayerForm(ctx, player) {
    var el = document.createElement('div');

    // 既存のコート一覧（未分類はサーバーが受け付けないので候補に出さない）
    var courts = Courts.listFrom(ctx.players).filter(function(c) {
      return c !== Courts.UNASSIGNED;
    });
    var court = player ? Courts.courtOf(player) : (courts[0] || '');
    if (court === Courts.UNASSIGNED) court = courts[0] || '';
    if (court && courts.indexOf(court) === -1) courts.push(court);

    var isFemale = player ? !!player.isFemale : false;
    var techState = player
      ? TechPicker.fromArray([player.tech1, player.tech2, player.tech3])
      : [];

    // 名前
    var fName = document.createElement('div');
    fName.className = 'field';
    var lName = document.createElement('label');
    lName.textContent = '名前';
    var inName = document.createElement('input');
    inName.type = 'text';
    inName.value = player ? (player.name || '') : '';
    fName.appendChild(lName);
    fName.appendChild(inName);
    el.appendChild(fName);

    // コート（セグメント＋「＋」で新しいコート名）
    var fCourt = document.createElement('div');
    fCourt.className = 'field';
    var lCourt = document.createElement('label');
    lCourt.textContent = 'コート';
    var segCourt = document.createElement('div');
    segCourt.className = 'seg';
    fCourt.appendChild(lCourt);
    fCourt.appendChild(segCourt);
    el.appendChild(fCourt);

    function renderCourtSeg() {
      segCourt.innerHTML = '';
      courts.forEach(function(c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = (c === court) ? 'on' : '';
        b.textContent = c;
        b.addEventListener('click', function() {
          court = c;
          renderCourtSeg();
        });
        segCourt.appendChild(b);
      });
      var add = document.createElement('button');
      add.type = 'button';
      add.textContent = '＋';
      add.addEventListener('click', function() {
        var name = prompt('新しいコート名を入力してください（例: D）');
        if (name === null) return;
        name = name.trim();
        if (!name) { alert('コート名を入力してください。'); return; }
        // order は「コート-性別-巡目-番号」。コート名に - を含めると解析できなくなる。
        if (name.indexOf('-') >= 0) { alert('コート名に「-」は使えません。'); return; }
        if (name === Courts.UNASSIGNED) {
          alert('「' + Courts.UNASSIGNED + '」はコート名に使えません。');
          return;
        }
        if (courts.indexOf(name) === -1) courts.push(name);
        court = name;
        renderCourtSeg();
      });
      segCourt.appendChild(add);
    }
    renderCourtSeg();

    // 性別
    var fSex = document.createElement('div');
    fSex.className = 'field';
    var lSex = document.createElement('label');
    lSex.textContent = '性別';
    var segSex = document.createElement('div');
    segSex.className = 'seg';
    fSex.appendChild(lSex);
    fSex.appendChild(segSex);
    el.appendChild(fSex);

    function renderSexSeg() {
      segSex.innerHTML = '';
      [['男子', false], ['女子', true]].forEach(function(pair) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = (isFemale === pair[1]) ? 'on' : '';
        b.textContent = pair[0];
        b.addEventListener('click', function() {
          isFemale = pair[1];
          renderSexSeg();
        });
        segSex.appendChild(b);
      });
    }
    renderSexSeg();

    // 新人
    var fNew = document.createElement('div');
    fNew.className = 'field';
    var toggle = document.createElement('label');
    toggle.className = 'toggle';
    var chkNew = document.createElement('input');
    chkNew.type = 'checkbox';
    chkNew.checked = player ? !!player.isNewFace : false;
    var txtNew = document.createElement('span');
    txtNew.textContent = '新人';
    toggle.appendChild(chkNew);
    toggle.appendChild(txtNew);
    fNew.appendChild(toggle);
    el.appendChild(fNew);

    // 技
    var fTech = document.createElement('div');
    fTech.className = 'field';
    var lTech = document.createElement('label');
    lTech.textContent = '技（タップして一覧から順に選ぶ）';
    var chips = document.createElement('div');
    chips.className = 'chips';
    fTech.appendChild(lTech);
    fTech.appendChild(chips);
    el.appendChild(fTech);

    function renderTechChips() {
      TechPicker.renderChips(chips, techState, function() {
        if (!techCache) {
          alert('技術リストを取得できませんでした。技以外は保存できます。');
          return;
        }
        TechPicker.open({
          techniques: techCache,
          initial: techState,
          onChange: function(next) {
            techState = next;
            renderTechChips();
          },
          onClose: function(next) {
            techState = next;
            renderTechChips();
          }
        });
      });
    }
    renderTechChips();

    function read() {
      var name = inName.value.trim();
      if (!name) { alert('名前を入力してください。'); return null; }
      if (!court) { alert('コートを選んでください。「＋」で新しいコートを作れます。'); return null; }
      var t = TechPicker.toArray(techState);
      return {
        name: name,
        court: court,
        isFemale: isFemale,
        isNewFace: chkNew.checked,
        tech1: t[0],
        tech2: t[1],
        tech3: t[2]
      };
    }

    function reset() {
      inName.value = '';
      techState = [];
      renderTechChips();
      inName.focus();
    }

    return { el: el, read: read, reset: reset };
  }

  // シートの外枠（Admin.openSheet(title, bodyEl, buttons, onClose) → { close, lock }）は
  // admin.js に集約されている。ここではローカルに持たない。

  // 追加フォーム
  function openAddSheet(ctx) {
    var form = buildPlayerForm(ctx, null);
    var added = 0;

    var btnSaveClose = document.createElement('button');
    btnSaveClose.type = 'button';
    btnSaveClose.className = 'btn';
    btnSaveClose.textContent = '保存して閉じる';

    var btnSaveNext = document.createElement('button');
    btnSaveNext.type = 'button';
    btnSaveNext.className = 'btn primary';
    btnSaveNext.textContent = '保存して次を追加';

    // どの経路で閉じても、追加した分があれば一覧へ反映する
    var sheet = Admin.openSheet('選手を追加', form.el, [btnSaveClose, btnSaveNext], function() {
      if (added > 0) Admin.reloadEvent();
    });

    // 追加は常に一巡目。二巡目の行は生成 API が作る（計画3）。
    async function save() {
      var data = form.read();
      if (!data) return false;
      data.round = 1;
      btnSaveClose.disabled = true;
      btnSaveNext.disabled = true;
      sheet.lock(true);
      var created = await Api.createPlayer(ctx.eventId, data);
      btnSaveClose.disabled = false;
      btnSaveNext.disabled = false;
      sheet.lock(false);
      if (!created) {
        // 失敗してもシートは閉じない（入力を残す）
        alert('選手を追加できませんでした。\n入力内容と通信を確認してください。');
        return false;
      }
      added++;
      Admin.toast(created.order + ' ' + created.name + ' を追加しました');
      return true;
    }

    btnSaveClose.addEventListener('click', async function() {
      if (!(await save())) return;
      sheet.close();   // onClose が一覧を反映する
    });

    btnSaveNext.addEventListener('click', async function() {
      if (!(await save())) return;
      form.reset();   // コート・性別・新人は保つ
    });
  }
```

- [ ] **Step 2: FAB を一覧に足す**

`admin-players.js` の `render` 関数内、以下の行:

```javascript
    var list = document.createElement('div');
    list.className = 'list';
    container.appendChild(list);
```

↓

```javascript
    var list = document.createElement('div');
    list.className = 'list';
    container.appendChild(list);

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'fab';
    fab.textContent = '＋';
    fab.addEventListener('click', function() { openAddSheet(ctx); });
    container.appendChild(fab);
```

- [ ] **Step 3: 1人追加できることを確認する**

`http://localhost:3457/admin.html` の選手タブ（`運営テスト大会`）をリロードし、右下の「＋」をタップ。名前 `高橋 三郎`、コート `A`、性別 `男子`、技チップの「① ＋」をタップ → シートで `四方` と `真` をタップ → 「完了」→ 「保存して閉じる」。

Expected: 「A-男子-1-2 高橋 三郎 を追加しました」のトーストが出て一覧に行が増える。行の技が `四方 / 真`。

`javascript_tool` で確認する。

```javascript
(async function() {
  var ev = await Api.loadEvent(Admin.currentEventId());
  var p = ev.players.filter(function(x) { return x.name === '高橋 三郎'; })[0];
  return [p.order, p.tech1, p.tech2, p.tech3, p.score, p.isFemale, p.isNewFace];
})()
```

Expected: `["A-男子-1-2", "四方", "真", "", 0, false, false]`

- [ ] **Step 4: 「保存して次を追加」でコート・性別が保たれることを確認する**

「＋」→ 名前 `連続1`、コート `B`、性別 `女子`、新人オン、技に `水月` → 「保存して次を追加」。

Expected: シートが開いたまま、名前が空、技チップが `① ＋ / ② ＋ / ③ ＋`、コートは `B` が `on`、性別は `女子` が `on`、新人はオンのまま。

続けて名前 `連続2` → 「保存して次を追加」、名前 `連続3` → 「保存して閉じる」。

```javascript
(async function() {
  var ev = await Api.loadEvent(Admin.currentEventId());
  return ev.players.filter(function(p) { return /^連続/.test(p.name); })
    .map(function(p) { return p.name + '|' + p.order + '|' + p.tech1 + '|' + (p.isNewFace ? '新' : '') ; });
})()
```

Expected: `["連続1|B-女子-1-1|水月|新", "連続2|B-女子-1-2||新", "連続3|B-女子-1-3||新"]`
（技は「次を追加」でクリアされるので2人目以降は空）

- [ ] **Step 5: ✕で閉じても追加分が一覧に出ることを確認する**

「＋」→ 名前 `途中閉じ` → 「保存して次を追加」→ 右上の「✕」で閉じる。

Expected: シートが閉じた直後に一覧が読み直され、`途中閉じ` の行が出ている。

- [ ] **Step 6: 375px とコンソール**

シートを開いた状態で実行する。

```javascript
(function() {
  var out = Array.prototype.map.call(
    document.querySelectorAll('.fab, .sheet-close, .btn, .seg button, .chip, .field input[type="text"]'),
    function(el) { return el.className + ':' + Math.round(el.getBoundingClientRect().height); });
  out.push('noHScroll:' + (document.body.scrollWidth <= window.innerWidth));
  return out;
})()
```

Expected: すべての高さが 44 以上、`noHScroll:true`

`read_console_messages`（`onlyErrors: true`）Expected: 0件

- [ ] **Step 7: コミット**

```bash
git add admin-players.js
git commit -m "feat: 運営画面に選手の追加フォーム（技のボトムシート・連続登録）を追加" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: `admin-players.js` — 編集と削除

**Files:**
- Modify: `admin-players.js`

- [ ] **Step 1: 編集シートを足す**

`admin-players.js` の以下の行の**直前**に挿入する。

```javascript
  Admin.registerTab('players', { render: render });
```

挿入する内容:

```javascript
  // 編集フォーム（行タップ）
  function openEditSheet(ctx, player) {
    var form = buildPlayerForm(ctx, player);

    var btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn danger';
    btnDelete.textContent = 'この選手を削除';

    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn primary';
    btnSave.textContent = '保存';

    var sheet = Admin.openSheet('選手を編集', form.el, [btnDelete, btnSave]);

    btnSave.addEventListener('click', async function() {
      var data = form.read();
      if (!data) return;

      // 採点済みの選手の性別を変えても、サーバーは得点を再計算しない。
      // 男女で配点が違う技があるため、採点画面で開き直してもらう必要がある。
      if (isScored(player) && data.isFemale !== !!player.isFemale) {
        var ok = confirm(
          'この選手は採点済みです（' + (player.score || 0) + '点）。\n' +
          '得点が変わる可能性があります。採点画面でこの選手を開き直してください。\n\n' +
          'このまま保存しますか？'
        );
        if (!ok) return;
      }

      btnSave.disabled = true;
      sheet.lock(true);
      // round は送らない。サーバーは今の order から巡目を据え置く。
      var res = await Api.updatePlayerInfo(ctx.eventId, player.id, data);
      btnSave.disabled = false;
      sheet.lock(false);
      if (!res || !res.ok) {
        // 失敗してもシートは閉じない（入力を残す）
        alert('選手の更新に失敗しました。\n入力内容と通信を確認してください。');
        return;
      }
      sheet.close();
      Admin.toast('保存しました');
      Admin.reloadEvent();
    });

    btnDelete.addEventListener('click', async function() {
      if (!confirm(
        '選手「' + (player.name || '') + '」（' + (player.order || '') + '）を削除します。\n' +
        '二巡目の行は残ります。\n' +
        'よろしいですか？'
      )) return;

      btnDelete.disabled = true;
      sheet.lock(true);
      var res = await Api.deletePlayer(ctx.eventId, player.id, false);

      if (res && res.blocked) {
        // 採点済みガード。得点を出してもう一度確認し、承諾したときだけ force。
        var ok = confirm(
          '「' + res.player.name + '」（' + res.player.order + '）は採点済みです（' +
          res.player.score + '点）。\n' +
          '削除すると採点結果は戻せません。二巡目の行は残ります。\n\n' +
          '本当に削除しますか？'
        );
        if (!ok) { btnDelete.disabled = false; sheet.lock(false); return; }
        res = await Api.deletePlayer(ctx.eventId, player.id, true);
      }

      btnDelete.disabled = false;
      sheet.lock(false);
      if (res !== true) {
        alert('選手の削除に失敗しました。');
        return;
      }
      sheet.close();
      Admin.toast('削除しました');
      Admin.reloadEvent();
    });
  }
```

- [ ] **Step 2: 行タップで編集シートを開く**

`admin-players.js` の `buildRow` 関数内、以下の行:

```javascript
    row.appendChild(badge);
    row.appendChild(body);
    row.appendChild(score);
    return row;
```

↓

```javascript
    row.addEventListener('click', function() {
      openEditSheet(ctx, p);
    });

    row.appendChild(badge);
    row.appendChild(body);
    row.appendChild(score);
    return row;
```

- [ ] **Step 3: 名前とコートの編集を確認する**

選手タブで `高橋 三郎` の行をタップ。名前を `高橋 三郎改` に変え、コートを `B` にして「保存」。

Expected: 「保存しました」のトーストが出る。性別は男子のままなので order は `B-男子-1-N`（N は B コート男子の最大番号+1。`鈴木 次郎` が `B-男子-1-1` なので **`B-男子-1-2`**）。

```javascript
(async function() {
  var ev = await Api.loadEvent(Admin.currentEventId());
  var p = ev.players.filter(function(x) { return x.name === '高橋 三郎改'; })[0];
  return [p.order, p.tech1, p.tech2];
})()
```

Expected: `["B-男子-1-2", "四方", "真"]`

- [ ] **Step 4: 採点済み選手の性別変更で警告が出ることを確認する**

Task 8 で入れた `鈴木 次郎`（30点・採点済み）の行をタップし、性別を「女子」にして「保存」。

Expected: 以下の confirm が出る。

```
この選手は採点済みです（30点）。
得点が変わる可能性があります。採点画面でこの選手を開き直してください。

このまま保存しますか？
```

「キャンセル」を押すとシートは開いたままで、サーバーの値は変わらない。

```javascript
(async function() {
  var ev = await Api.loadEvent(Admin.currentEventId());
  var p = ev.players.filter(function(x) { return x.name === '鈴木 次郎'; })[0];
  return [p.isFemale, p.score];
})()
```

Expected: `[false, 30]`

- [ ] **Step 5: 未採点の選手の削除を確認する**

`連続3`（未採点）の行をタップ →「この選手を削除」→ confirm を承諾。

Expected: 「削除しました」のトーストが出て一覧から消える。人数の見出しが1減る。

- [ ] **Step 6: 採点済みの選手の削除が二段確認になることを確認する**

`鈴木 次郎`（30点）の行をタップ →「この選手を削除」→ 1回目の confirm を承諾。

Expected: 2回目の confirm に `「鈴木 次郎」（B-男子-1-1）は採点済みです（30点）。` が出る。「キャンセル」で残ること、もう一度実行して承諾すると消えることの両方を確認する。

- [ ] **Step 7: コンソールを確認してコミット**

`read_console_messages`（`onlyErrors: true`）Expected: 0件

```bash
git add admin-players.js
git commit -m "feat: 運営画面で選手の編集・削除（採点済みガードと性別変更の警告）" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11: CSV インポートを「⋯」メニューに置く

一括登録は残すが、主導線は1人ずつの登録なので二次導線にする。409 の確認文言は `app.js` の `onCsvImport` と同じにする（同じ危険に2つの言い回しを作らない）。

**Files:**
- Modify: `admin-players.js`

- [ ] **Step 1: 見出しに「⋯」を足す**

`admin-players.js` の `render` 関数内、以下の行:

```javascript
    head.appendChild(h2);
    head.appendChild(spacer);
    container.appendChild(head);
```

↓

```javascript
    var btnMenu = document.createElement('button');
    btnMenu.type = 'button';
    btnMenu.className = 'icon-btn';
    btnMenu.textContent = '⋯';
    btnMenu.addEventListener('click', function() { openMenu(ctx); });

    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(btnMenu);
    container.appendChild(head);
```

- [ ] **Step 2: メニューと CSV インポートを足す**

`admin-players.js` の以下の行の**直前**に挿入する。

```javascript
  Admin.registerTab('players', { render: render });
```

挿入する内容:

```javascript
  // 「⋯」メニュー。主導線は1人ずつの登録で、CSV は一括登録用の二次導線。
  function openMenu(ctx) {
    var body = document.createElement('div');

    var btnCsv = document.createElement('button');
    btnCsv.type = 'button';
    btnCsv.className = 'menu-item';
    btnCsv.textContent = '📄 CSVインポート';
    body.appendChild(btnCsv);

    var btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'btn';
    btnCancel.textContent = '閉じる';

    var sheet = Admin.openSheet('メニュー', body, [btnCancel]);
    btnCancel.addEventListener('click', sheet.close);

    btnCsv.addEventListener('click', function() {
      sheet.close();
      pickCsv(ctx);
    });
  }

  // admin.html には file input を置かない（DOM は計画3との契約）。その場で作って捨てる。
  function pickCsv(ctx) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) {
        var reader = new FileReader();
        reader.onload = function(ev) { importCsvText(ctx, ev.target.result); };
        reader.readAsText(file, 'UTF-8');
      }
      if (input.parentNode) input.parentNode.removeChild(input);
    });
    input.click();
  }

  async function importCsvText(ctx, text) {
    var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
    var mode = 'replace';
    if (ctx.players.length > 0) {
      mode = confirm('既存データをクリアして読み込みますか？\n（キャンセルで追記）') ? 'replace' : 'append';
    }
    var result = await Api.importCsv(eventId, text, mode);
    if (result && result.blocked) {
      var ok = confirm(
        'この大会には採点済みの選手が少なくとも ' + result.scoredCount + ' 名います。\n' +
        '他のコート端末による採点も含まれます。\n' +
        '読み込みを続けると、これらの採点結果はすべて失われます。\n' +
        '本当に続行しますか？'
      );
      if (!ok) return;
      result = await Api.importCsv(eventId, text, mode, true);
    }
    if (!result || !result.success) {
      alert('インポートに失敗しました。');
      return;
    }
    Admin.toast(result.playerCount + '名を読み込みました');
    Admin.reloadEvent();
  }
```

- [ ] **Step 3: メニューに到達できることを確認する**

選手タブで「⋯」をタップし、`mcp__Claude_Browser__find` で `CSVインポート` を探す。

Expected: `.menu-item` として1件見つかる。タップするとメニューが閉じ、OS のファイル選択が開く（開いたらキャンセルしてよい。ファイル選択ダイアログはブラウザツールから操作できない）。

- [ ] **Step 4: 409 の確認文言が `app.js` と一致していることを確認する**

```bash
grep -n "他のコート端末による採点も含まれます" app.js admin-players.js
```

Expected: 両ファイルに1件ずつヒットする。

- [ ] **Step 5: コンソールを確認してコミット**

`read_console_messages`（`onlyErrors: true`）Expected: 0件

```bash
git add admin-players.js
git commit -m "feat: 運営画面の選手タブにCSVインポートを二次導線として置く" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12: 375px とテーマの最終確認

**Files:**
- （変更なし。問題が見つかった場合のみ `admin.css` を修正）

- [ ] **Step 1: 4タブすべてで横スクロールが無いことを確認する**

`resize_window`（`preset: "mobile"`）のまま、`#events` → `#players/<id>` → `#round/<id>` → `#results/<id>` の順に `navigate` し、各画面で実行する。

```javascript
[location.hash, document.body.scrollWidth, window.innerWidth,
 document.body.scrollWidth <= window.innerWidth]
```

Expected: 4画面とも `[<hash>, 375, 375, true]`
（`#round` と `#results` は「このタブはまだ準備中です。」の表示。計画3で中身が入る）

- [ ] **Step 2: タップ目標が 44px 以上であることを確認する**

選手タブで追加シートを開いた状態、技のシートを開いた状態のそれぞれで実行する。

```javascript
(function() {
  var sel = '.tabbar button, .theme-btn, .head-btn, .icon-btn, .court-chip, .row, ' +
            '.row-del, .fab, .btn, .menu-item, .seg button, .chip, .sheet-close, ' +
            '.tp-item, .tp-close, .field input';
  var bad = [];
  Array.prototype.forEach.call(document.querySelectorAll(sel), function(el) {
    var h = el.getBoundingClientRect().height;
    if (h > 0 && h < 44) bad.push(el.className + ':' + Math.round(h));
  });
  return bad.length === 0 ? 'OK' : bad;
})()
```

Expected: `"OK"`（44px 未満の要素が1つも無い）

- [ ] **Step 3: 下タブが常に画面下に固定されていることを確認する**

選手が20名以上いる状態にして（Task 8 の CSV を `append` で複数回入れる）、本文を下までスクロールしてから実行する。

```javascript
(function() {
  window.scrollTo(0, document.body.scrollHeight);
  var r = document.querySelector('.tabbar').getBoundingClientRect();
  var t = document.querySelector('.topbar').getBoundingClientRect();
  return { tabBottom: Math.round(r.bottom), topTop: Math.round(t.top), viewH: window.innerHeight };
})()
```

Expected: `{ tabBottom: 812, topTop: 0, viewH: 812 }`（上下のバーがスクロールで動かない）

- [ ] **Step 4: ライト／ダーク両テーマで読めることを確認する**

上部バーの 🌙 をタップしてダークにし、各タブとシートを開いて目視する。

```javascript
(function() {
  var cs = getComputedStyle(document.body);
  return [document.body.getAttribute('data-theme'),
          cs.backgroundColor, cs.color,
          localStorage.getItem('tmg_theme')];
})()
```

Expected: `["dark", "rgb(26, 26, 46)", "rgb(224, 224, 255)", "dark"]`

リロードしてもダークのままであること、`index.html` を開いてもダークのままであること（`tmg_theme` を共用しているため）を確認する。ライトに戻して同様に確認する。

Expected: ライトは `["light", "rgb(255, 255, 255)", "rgb(34, 34, 34)", "light"]`

- [ ] **Step 5: 復帰動作を確認する**

`#players/<id>` を開いた状態で、アドレスバーからハッシュを消して `http://localhost:3457/admin.html` を開き直す。

Expected: `tmg_admin_last` により `#players/<同じID>` に戻る。`localStorage.removeItem('tmg_admin_last')` してハッシュ無しで開くと `#events` になる。

- [ ] **Step 6: 採点画面への影響が無いことを確認する**

`resize_window`（`preset: "desktop"`）に戻し、`http://localhost:3457/index.html` を開く。

Expected: 採点テーブル・ツールバー・テーマ切り替えが従来どおり。`read_console_messages`（`onlyErrors: true`）が0件。

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 234 passed, 0 failed`

- [ ] **Step 7: 確認用データを片付ける**

Task 6〜11 で作った確認用の大会を `#events` から削除する。

Expected: `確認用大会A` と `運営テスト大会` が一覧から消える。

- [ ] **Step 8: 修正が必要だった場合のみコミット**

Step 1〜6 で `admin.css` の修正が必要になった場合のみ:

```bash
git add admin.css
git commit -m "fix: 運営画面のタップ目標と 375px レイアウトを調整" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

修正が不要ならコミットは無し。

---

## 完了条件

- [ ] `test.html` が `Result: 234 passed, 0 failed`
- [ ] `grep -n "^:root\|^\[data-theme" style.css` が何も出さない
- [ ] `grep -c 'href="theme.css"' index.html ranking.html techniques.html` が3ファイルとも 1
- [ ] `grep -n '<script src=' admin.html` が `api.js` → `storage.js` → `courts.js` → `techpicker.js` → `admin.js` → `admin-events.js` → `admin-players.js` の順
- [ ] 375px で4タブとも `document.body.scrollWidth <= window.innerWidth`
- [ ] 44px 未満のタップ目標が0件
- [ ] ライト／ダーク両方で `admin.html` と既存3ページが読める
- [ ] `admin.html` から選手を1人ずつ追加・編集・削除でき、「保存して次を追加」でコート・性別が保たれる
- [ ] `server/index.js` と `app.js` の採点機能に変更が入っていない（`git diff --stat` で確認）

---

## 計画3への申し送り

- `Admin.registerTab('round', { render: … })` / `Admin.registerTab('results', { render: … })` を追加し、`admin.html` のスクリプト末尾に `admin-round.js` / `admin-results.js` を足す。それ以外の `admin.html` の DOM は変えない。
- 進行タブの技チップは、チップの親要素に `class="chips-required"` を付けると空きが赤くなる（`admin.css` に定義済み）。`TechPicker.renderChips` の引数は変えない。
- `TechPicker.open` が作るシートのクラスは `.tp-overlay`（外枠）と `.tp-sheet`（本体）。
- コート絞り込みは `Admin.renderCourtChips(container, players, current, onChange)` を使う。選手タブと同じ見た目になる。
- シートの外枠は `Admin.openSheet(title, bodyEl, buttons, onClose) → { close, lock }` を使う。`lock(true)` の間は ✕ と外側タップで閉じない（保存の通信中に入力を失わないため）。`onClose` はハッシュ遷移（`Admin.closeAllSheets()`）でも呼ばれるので、`onClose` の中でサーバーに書き込まないこと（古い ctx で書いてしまう）。
- `Admin.closeAllSheets()` — 開いているシートを全部閉じる。`applyRoute` がハッシュ遷移のたびに呼ぶ。
- `admin-players.js` の `isScored` / `compareOrder` は選手タブ内のローカル関数。進行タブで必要なら `admin-round.js` に同じものを置くか、共有が増えるなら `courts.js` への移動を検討する（今回は2箇所目が無いので移動しない）。
- `ctx.isStale()` — `render(container, ctx)` の ctx に生えている。await の直後に見て true なら描画をやめる（タブや大会を切り替えられた後の古い応答を画面に反映しないため）。`Admin.currentEventId() !== eventId` の代わりにこれを使うこと。
- 同じタブをもう一度タップすると再取得・再描画される（コート絞り込みは各タブが自分で保持する）。
- `Admin.reloadEvent()` は大会タブ（events）では何もしない。
