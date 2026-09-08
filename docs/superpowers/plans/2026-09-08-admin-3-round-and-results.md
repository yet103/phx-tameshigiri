# 進行タブ・結果タブ・発表と共有ページ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 運営者のスマホで「二巡目を生成 → 技を入力 → 結果を発表・共有」まで完結できるようにする。あわせて順位計算のクライアント実装（`ranking.html`）と二巡目の番号規則のクライアント実装（`app.js`）を捨て、サーバーを唯一の実装にする。

**Architecture:** 計画2 で作った `admin.html` のタブ枠組みに、進行タブ（`admin-round.js`）と結果タブ（`admin-results.js`）を登録する。発表・共有は認証を通さない独立ページ（`present.html` / `share.html`）とし、共有トークンで `GET /api/links/:token/ranking` だけを読む。順位の集計はサーバーの `computeRanking` が唯一の実装で、`ranking.html` / 結果タブ / `share.html` / `present.html` はその結果を描くだけにする。二巡目の生成も `POST /api/events/:id/rounds/2/generate` が唯一の実装で、運営画面と採点画面（`app.js`）は同じ確認文言で同じ API を呼ぶ。

**Tech Stack:** 素の JavaScript（ES5 相当の IIFE、`var` と `function`、`async`/`await` は可）、ビルド工程・バンドラ・テストランナー無し。Node.js / Express 5 のサーバーは**この計画では変更しない**。テストは `test.html` をブラウザで開いて `Result: N passed, M failed` を読む。

**設計書:** [docs/superpowers/specs/2026-09-08-mobile-admin-flow-design.md](../specs/2026-09-08-mobile-admin-flow-design.md)（「実装の分割」の**計画3**）
**前提計画:** [2026-09-08-admin-1-server-api.md](2026-09-08-admin-1-server-api.md)、[2026-09-08-admin-2-admin-page.md](2026-09-08-admin-2-admin-page.md)（**両方が着地していること**。計画2完了時点のテスト件数は 219）

---

## 前提知識（この計画を実行する人へ）

**この計画は 計画1（サーバー API と `api.js`）と 計画2（`theme.css`・`TechPicker`・`admin.html` の大会／選手タブ）が着地した後にだけ実行できます。**

**サーバーの起動**

```bash
node server/index.js > "$TEMP/tmg_server.log" 2>&1 &
```

`http://localhost:3457` で待ち受けます。**この計画は `server/index.js` を一切変更しないので、作業中の再起動は不要です。** サーバーは `Cache-Control: no-store` を送るので、JS/CSS/HTML の変更はブラウザのリロードだけで反映されます。

**テストの動かし方**

1. ブラウザで `http://localhost:3457/test.html` を開く
2. ページ末尾の `Result: N passed, M failed` を読む。**`M` が 0 であることが合格条件**
3. 計画2 完了時点は **232 passed**。本計画で増えるのは Task 7 の 6 件だけで、最終的に **238 passed, 0 failed** になる

**モジュールの書き方**

すべて IIFE です。**アロー関数・`let`/`const`・テンプレートリテラル・`class` は使いません。** `var` と `function(){}` を使い、`async`/`await` は使って構いません。

```javascript
var Foo = (function() {
  function bar() { /* ... */ }
  return { bar: bar };
})();
```

**新規 JS ファイルを追加したら、それを使う HTML すべてに `<script>` タグを足すこと。** バンドラは無いので、書き忘れると `Foo is not defined` になります。読み込み順は依存関係順です。

**計画1 が提供している契約（この計画はこれらをそのまま使う）**

```javascript
Api.generateNextRound(eventId, force)
  // → { success, created, skipped }
  // | { blocked: true, reason: 'unscored'|'exists', unscoredCount, existingCount }
  // | null
Api.loadRanking(eventId)
  // → { event: { name, date, venue, updatedAt },
  //     rankings: { male: [{rank,name,score}], female: […], newFace: […] } } | null
Api.createShareLink(eventId)      // → { token } | null（冪等）
Api.loadShareLink(token)          // → { token, targetType, createdAt } | null
Api.loadSharedRanking(token)      // → loadRanking と同じ形 | null
Api.updatePlayerInfo(eventId, playerId, data)  // → { ok: true, player } | { ok: false, status }
Api.loadEvent(eventId)
Courts.courtOf(player) / listFrom(players) / filter(players, court) / UNASSIGNED / roundOf(player)
```

二巡目の行は `sourcePlayerId` を持つ（一巡目の行が削除されていると参照先が無い場合がある）。

**計画2 が提供している契約**

- `admin.html`：`<main id="tabContent">`、`<nav class="tabbar">` の中に `<button data-tab="events|players|round|results">`、`<div id="toast" hidden>`、`<script>` は `api.js, storage.js, courts.js, techpicker.js, admin.js, admin-events.js, admin-players.js` の順。**本計画はこの後ろに `admin-round.js` と `admin-results.js` を足す**
- `admin.css` が存在する（本計画は末尾に追記する）。技チップの親に `chips-required` を付けると空きチップが赤くなる
- `theme.css` が存在し、テーマ変数がすべて入っている。新規ページは `theme.css` ＋ 各自の CSS だけを読み、`style.css` は読まない（`style.css` の `body{min-width:768px}` を新規ページに持ち込まないため）
- `TechPicker.open` が作るシートのクラスは `.tp-overlay`（外枠）と `.tp-sheet`（本体）

```javascript
Admin.registerTab(name, def)   // def = { render: function(container, ctx) }（async 可）
                               // ctx = { eventId, event, players, isStale }
Admin.navigate(tab, eventId)
Admin.reloadEvent()            // async。再取得して現在のタブを描き直す
Admin.currentEventId()
Admin.toast(msg)               // 2秒の通知
Admin.renderCourtChips(container, players, current, onChange)  // 「全コート」＋ Courts.listFrom のチップ列
Admin.openSheet(title, bodyEl, buttons, onClose)  // → { close, lock }（lock(true) の間は ✕ と外側タップで閉じない）

TechPicker.select(state, name); TechPicker.toArray(state); TechPicker.fromArray(names)
TechPicker.open({ techniques, initial, onChange, onClose })   // 下部シート
TechPicker.renderChips(el, state, onTap)                      // ①②③、空きは「＋」
```

- `ctx.isStale()` — await の直後に見て true なら描画をやめる（タブや大会を切り替えられた後の古い応答を画面に反映しないため）
- 同じタブをもう一度タップすると再取得・再描画される（コート絞り込みは各タブが自分で保持する）
- `Admin.reloadEvent()` は大会タブ（events）では何もしない

`Admin.registerTab` はスクリプト評価時（＝`admin.js` の読み込み直後、DOMContentLoaded より前）に呼ぶ。`admin.js` の初期化は DOMContentLoaded で走るので登録が間に合う。

**ブラウザでの確認**

Browser ツール（`mcp__Claude_Browser__navigate` / `find` / `resize_window`（preset `mobile` = 375x812）/ `read_console_messages` / `javascript_tool`）を使う。`javascript_tool` はページのコンテキストで評価され、最後の式が返る（トップレベル `await` 可）。

**コミット**

日本語のメッセージで、末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を入れる。

---

## ファイル構成

| ファイル | 責務 | 状態 |
|---|---|---|
| `admin-round.js` | 進行タブ。二巡目の生成（409 の2確認）、二巡目一覧、技の入力、CSVエクスポート | **新規** |
| `admin-results.js` | 結果タブ。3部門の順位、発表モードを開く、共有リンクのコピー | **新規** |
| `share.html` / `share.css` / `share.js` | 参加者向けの閲覧専用順位ページ（トークン、60秒更新） | **新規** |
| `present.html` / `present.css` / `present.js` | 大画面用の発表モード（掲示 A ／ 発表 C） | **新規** |
| `admin.html` | `admin-round.js` / `admin-results.js` の `<script>` 追加 | 変更 |
| `admin.css` | 進行タブ・結果タブのスタイルを末尾に追記 | 変更 |
| `ranking.html` | クライアント集計と CSV 読み込みを廃止し、`Api.loadRanking` を描くだけにする | 変更 |
| `app.js` | `onGenNextRound` だけを差し替える（他は触らない） | 変更 |
| `test.html` | `present.js` の読み込みと `Present.revealOrder` のテスト 6 件 | 変更 |
| `server/index.js` | — | **変更しない** |

---

## Task 1: 進行タブの土台（二巡目一覧・採点済み件数・未入力カウンタ）

進行タブの骨格を作る。この時点では「二巡目を生成」ボタンは置くだけで、まだ何もしない（Task 2 で結線する）。

**Files:**
- Create: `admin-round.js`
- Modify: `admin.html`, `admin.css`

- [ ] **Step 1: 着手前の状態を確認する**

サーバーを起動し、`http://localhost:3457/test.html` を開く。

```bash
node server/index.js > "$TEMP/tmg_server.log" 2>&1 &
```

Expected: `Result: 232 passed, 0 failed`

- [ ] **Step 2: 検証用の捨て大会を作る**

`http://localhost:3457/admin.html` を開き、`javascript_tool` で以下を評価する。**「第10回全日本試し斬り大会」は絶対に触らない。**

```javascript
await (async function () {
  var ev = await Api.saveEvent({ name: '計画3検証', date: '2026-09-08', venue: '検証', players: [] });
  var csv = [
    '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果',
    '検証太郎,A-男子-1-1,四方,真,連,30,,,1',
    '検証次郎,A-男子-1-2,四方,真,連,20,○,,1',
    '検証花子,A-女子-1-1,四方,真,連,25,,○,1',
    '検証三郎,B-男子-1-1,四方,真,連,10,,,1',
    '検証梅子,B-女子-1-1,四方,真,連,15,○,○,1',
    '検証未採点,A-男子-1-3,四方,真,連,0,,,'
  ].join('\n');
  await Api.importCsv(ev.id, csv, 'replace');
  return ev.id;
})()
```

Expected: 大会 ID が返る。**この ID を控える**（以降 `<EV>` と書く）。

- [ ] **Step 3: `admin-round.js` を作る**

新規ファイル。全内容:

```javascript
// 進行タブ：二巡目の生成と技の入力
// 設計書の選択 A「一覧で埋めていく」。行タップで TechPicker のシートを開き、
// シートを閉じたときに PATCH で保存する。
var AdminRound = (function() {

  var CTX = null;          // { eventId, event, players }
  var containerEl = null;  // タブの入れ物（描き直しに使う）
  var currentCourt = '';   // '' なら全コート
  var lastEventId = null;  // 大会が変わったらコート絞り込みを戻すため
  var techniques = null;   // Api.loadTechniques() の結果のキャッシュ
  var pickerOpen = false;  // チップと行の両方がタップを拾うので二重に開かない
  var counterEl = null;
  var listEl = null;

  // 採点済みの判定。server/index.js の isScored と同じ規則をクライアントにも持つ。
  // 得点が正なら採点済み。○×（結果文字列の 0/1）が1つでもあれば採点済み。
  function isScored(p) {
    if (!p) return false;
    if (typeof p.score === 'number' && p.score > 0) return true;
    return /[01]/.test(p.result || '');
  }

  // 技が3つ揃っていない行を「未入力」と数える（一巡目のデータは常に3つ入っている）
  function isTechIncomplete(p) {
    return !p.tech1 || !p.tech2 || !p.tech3;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function roundOne(players) {
    return (players || []).filter(function(p) { return Courts.roundOf(p) === 1; });
  }

  function roundTwo(players) {
    return (players || []).filter(function(p) { return Courts.roundOf(p) === 2; });
  }

  // 現在のコート絞り込みで見えている二巡目の行
  function visibleRows() {
    return Courts.filter(roundTwo(CTX ? CTX.players : []), currentCourt);
  }

  // sourcePlayerId が指す一巡目の行。削除済みなら null
  function sourceOf(p) {
    if (!p || !p.sourcePlayerId || !CTX) return null;
    var all = CTX.players || [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === p.sourcePlayerId) return all[i];
    }
    return null;
  }

  // --- 描画 ---

  function render(container, ctx) {
    containerEl = container;
    CTX = ctx;
    container.innerHTML = '';
    if (!ctx || !ctx.eventId) {
      container.innerHTML = '<p class="round-empty">大会を選んでください。</p>';
      return;
    }
    if (ctx.eventId !== lastEventId) {
      currentCourt = '';
      lastEventId = ctx.eventId;
    }
    var players = ctx.players || [];

    // 見出し：一巡目の採点状況・生成ボタン・メニュー
    var head = document.createElement('div');
    head.className = 'round-head';
    var src = roundOne(players);
    var scored = src.filter(isScored).length;
    var stat = document.createElement('div');
    stat.className = 'round-stat';
    stat.id = 'roundScoredStat';
    stat.textContent = '一巡目 採点済み ' + scored + ' / ' + src.length;
    head.appendChild(stat);
    var genBtn = document.createElement('button');
    genBtn.className = 'round-gen';
    genBtn.id = 'btnGenRound2';
    genBtn.textContent = '二巡目を生成';
    genBtn.addEventListener('click', onGenerate);
    head.appendChild(genBtn);
    head.appendChild(buildMenu());
    container.appendChild(head);

    // コート絞り込み。チップは大会全体のコートから作る。
    // 二巡目が未生成のときにチップ列が消えないようにするため。
    var chipsWrap = document.createElement('div');
    chipsWrap.className = 'round-courts';
    container.appendChild(chipsWrap);
    Admin.renderCourtChips(chipsWrap, players, currentCourt, function(court) {
      currentCourt = court;
      render(containerEl, CTX);
    });

    counterEl = document.createElement('div');
    counterEl.className = 'round-counter';
    counterEl.id = 'roundCounter';
    container.appendChild(counterEl);

    listEl = document.createElement('div');
    listEl.className = 'round-list';
    listEl.id = 'roundList';
    container.appendChild(listEl);

    var rows = visibleRows();
    if (rows.length === 0) {
      listEl.innerHTML = '<p class="round-empty">二巡目の選手はまだいません。' +
        '「二巡目を生成」を押してください。</p>';
    } else {
      rows.forEach(function(p) { listEl.appendChild(buildRow(p)); });
    }
    updateCounter();
  }

  function updateCounter() {
    if (!counterEl) return;
    var rows = visibleRows();
    var n = rows.filter(isTechIncomplete).length;
    counterEl.textContent = '二巡目 ' + rows.length + '名　技 未入力 ' + n;
    counterEl.className = 'round-counter' + (n === 0 ? ' done' : '');
  }

  function buildRow(p) {
    var row = document.createElement('div');
    row.className = 'round-row';
    row.setAttribute('data-player-id', p.id);

    var src = sourceOf(p);
    var top = document.createElement('div');
    top.className = 'round-row-top';
    top.innerHTML =
      '<span class="round-name">' + esc(p.order) + '　' + esc(p.name) + '</span>' +
      '<span class="round-prev">一巡目 ' + (src ? esc(String(src.score || 0)) : '—') + '</span>';
    row.appendChild(top);

    // chips-required: 空きのチップを赤くする（admin.css）
    var chips = document.createElement('div');
    chips.className = 'round-chips chips chips-required';
    row.appendChild(chips);
    drawChips(p, row);

    var copy = document.createElement('button');
    copy.className = 'round-copy';
    copy.textContent = '一巡目と同じ技をコピー';
    if (!src) {
      copy.disabled = true;
      copy.title = '一巡目の行が削除されています';
    } else {
      copy.addEventListener('click', function(ev) {
        ev.stopPropagation();   // 行タップ（シートを開く）と二重に反応させない
        onCopyFromRound1(p, src, row);
      });
    }
    row.appendChild(copy);

    row.addEventListener('click', function() { openPicker(p, row); });
    return row;
  }

  function drawChips(p, row) {
    TechPicker.renderChips(
      row.querySelector('.round-chips'),
      TechPicker.fromArray([p.tech1, p.tech2, p.tech3]),
      function() { openPicker(p, row); }
    );
  }

  // --- 技の入力（Task 3 で中身を入れる） ---

  function openPicker(p, row) {
    // Task 3
  }

  function onCopyFromRound1(p, src, row) {
    // Task 3
  }

  // --- 二巡目の生成（Task 2 で中身を入れる） ---

  function onGenerate() {
    // Task 2
  }

  // --- メニュー（二次導線） ---

  function buildMenu() {
    var menu = document.createElement('details');
    menu.className = 'round-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    menu.appendChild(sum);
    var btn = document.createElement('button');
    btn.id = 'btnRoundExport';
    btn.textContent = 'CSVエクスポート';
    btn.addEventListener('click', async function() {
      menu.open = false;
      var eventId = CTX.eventId;
      var csv = await Api.exportCsv(eventId);
      if (CTX.isStale()) return;  // 通信中に大会を切り替えられた
      if (!csv) { alert('エクスポートに失敗しました。'); return; }
      Storage.downloadCsv('players.csv', csv);
    });
    menu.appendChild(btn);
    return menu;
  }

  Admin.registerTab('round', { render: render });

  return {
    render: render,
    isScored: isScored,
    isTechIncomplete: isTechIncomplete
  };
})();
```

- [ ] **Step 4: `admin.html` に `<script>` を足す**

置換前（`</body>` の直前）:

```html
  <script src="admin-players.js"></script>
</body>
```

置換後:

```html
  <script src="admin-players.js"></script>
  <script src="admin-round.js"></script>
</body>
```

- [ ] **Step 5: `admin.css` の末尾に進行タブのスタイルを追記する**

ファイル末尾に追記する。

```css
/* ===== 進行タブ（admin-round.js） ===== */
.round-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 0; }
.round-stat { flex: 1; font-size: 14px; }
.round-gen {
  background: var(--accent); color: var(--accent-text);
  border: none; border-radius: 6px; padding: 10px 14px; min-height: 44px; font-size: 14px;
}
.round-menu { position: relative; }
.round-menu > summary {
  list-style: none; cursor: pointer; width: 44px; height: 44px; line-height: 44px;
  text-align: center; border-radius: 6px; background: var(--bg-secondary); color: var(--text);
}
.round-menu > summary::-webkit-details-marker { display: none; }
.round-menu > button {
  position: absolute; right: 0; top: 48px; z-index: 20; white-space: nowrap;
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
  border-radius: 6px; padding: 10px 14px; min-height: 44px;
}
.round-courts { margin: 4px 0; }
.round-counter {
  padding: 8px 10px; border-radius: 6px; background: var(--bg-secondary);
  color: var(--text-muted); font-size: 13px; margin-bottom: 6px;
}
.round-counter.done { background: var(--cell-success); color: var(--cell-success-text); font-weight: bold; }
.round-list { display: flex; flex-direction: column; gap: 6px; padding-bottom: 16px; }
.round-row { background: var(--bg-secondary); border-radius: 8px; padding: 8px 10px; cursor: pointer; }
.round-row-top { display: flex; justify-content: space-between; gap: 8px; font-weight: bold; }
.round-prev { color: var(--text-muted); font-weight: normal; font-size: 12px; white-space: nowrap; }
.round-chips { margin: 6px 0; min-height: 28px; }
.round-copy {
  background: transparent; color: var(--accent); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px 10px; min-height: 36px; font-size: 12px;
}
.round-copy:disabled { color: var(--text-muted); opacity: .5; cursor: default; }
.round-empty { color: var(--text-muted); padding: 12px 4px; }
```

- [ ] **Step 6: 進行タブが描けることを確認する**

`mcp__Claude_Browser__navigate` で `http://localhost:3457/admin.html#round/<EV>` を開き、`javascript_tool` で:

```javascript
[document.getElementById('roundScoredStat').textContent,
 document.getElementById('roundCounter').textContent,
 document.getElementById('roundList').textContent.slice(0, 30)]
```

Expected: `["一巡目 採点済み 5 / 6", "二巡目 0名　技 未入力 0", "二巡目の選手はまだいません。…"]`
（カウンタは 0 件なので緑になる。`roundCounter` の `className` が `round-counter done`）

`read_console_messages` で `onlyErrors: true`。Expected: エラー 0 件。

- [ ] **Step 7: 375px で横スクロールが出ないことを確認する**

`resize_window` を preset `mobile` にしてリロードし、`javascript_tool` で:

```javascript
[document.documentElement.scrollWidth, window.innerWidth]
```

Expected: 2つの値が等しい（横スクロールなし）。

- [ ] **Step 8: コミット**

```bash
git add admin-round.js admin.html admin.css
git commit -m "feat: 運営画面の進行タブに二巡目一覧と採点済み件数を出す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: 「二巡目を生成」と 2 つの 409 確認

未採点・生成済みの 409 をそれぞれ確認ダイアログにして、承諾時だけ `force` で再送する。

**Files:**
- Modify: `admin-round.js`

- [ ] **Step 1: `onGenerate` を実装する**

`admin-round.js` の以下を置き換える。

置換前:

```javascript
  // --- 二巡目の生成（Task 2 で中身を入れる） ---

  function onGenerate() {
    // Task 2
  }
```

置換後:

```javascript
  // --- 二巡目の生成 ---
  // 番号規則はサーバーの生成 API が唯一の実装。クライアントは確認と再送だけを持つ。
  // 同じ文言を app.js の onGenNextRound も持つ（採点画面と運営画面で流れを揃えるため）。

  function conflictMessage(result) {
    if (result.reason === 'unscored') {
      return '未採点が' + result.unscoredCount + '名います。\n' +
             'このまま生成すると、あとから入る一巡目の得点は二巡目の並び順に反映されません。\n' +
             '生成しますか？';
    }
    return '二巡目は生成済みです（' + result.existingCount + '名）。\n' +
           '未生成の選手がいれば差分だけ追加しますか？\n' +
           '※CSV で作った二巡目がある大会では使わないでください（重複します）。';
  }

  async function onGenerate() {
    var eventId = CTX.eventId;
    var result = await Api.generateNextRound(eventId, false);
    if (CTX.isStale()) return;  // 通信中に大会を切り替えられた
    if (!result) { alert('二巡目の生成に失敗しました。通信を確認してください。'); return; }
    if (result.blocked) {
      if (!confirm(conflictMessage(result))) return;
      result = await Api.generateNextRound(eventId, true);
      if (CTX.isStale()) return;
      if (!result || result.blocked) {
        alert('二巡目の生成に失敗しました。通信を確認してください。');
        return;
      }
    }
    Admin.toast('二巡目を生成しました（' + result.created + '名）');
    await Admin.reloadEvent();
  }
```

- [ ] **Step 2: 未採点の 409 を確認する**

`http://localhost:3457/admin.html#round/<EV>` をリロードし、`javascript_tool` で確認ダイアログを差し替えてからボタンを押す。

```javascript
await (async function () {
  var seen = [];
  var origConfirm = window.confirm, origAlert = window.alert;
  window.confirm = function (m) { seen.push(m); return false; };  // いったん断る
  window.alert = function (m) { seen.push('ALERT:' + m); };
  document.getElementById('btnGenRound2').click();
  await new Promise(function (r) { setTimeout(r, 800); });
  window.confirm = origConfirm; window.alert = origAlert;
  var ev = await Api.loadEvent('<EV>');
  return [seen, ev.players.length];
})()
```

Expected: 1件目のメッセージが `未採点が1名います。` で始まり `生成しますか？` で終わる。`ALERT:` は含まれない。選手数は **6 のまま**（断ったので生成されていない）。

- [ ] **Step 3: 承諾して生成されることを確認する**

```javascript
await (async function () {
  var origConfirm = window.confirm;
  window.confirm = function () { return true; };
  document.getElementById('btnGenRound2').click();
  await new Promise(function (r) { setTimeout(r, 1200); });
  window.confirm = origConfirm;
  var ev = await Api.loadEvent('<EV>');
  var r2 = ev.players.filter(function (p) { return Courts.roundOf(p) === 2; });
  return [ev.players.length, r2.length, r2.map(function (p) { return p.order; })];
})()
```

Expected: `[12, 6, [...]]` で、`order` が `A-女子-2-1`, `B-女子-2-1`, `A-男子-2-1`〜`A-男子-2-3`, `B-男子-2-1` をコート×性別ごとに 1 から採番したもの（並びは女子先・得点昇順）。

- [ ] **Step 4: 生成済みの 409 を確認する**

```javascript
await (async function () {
  var seen = [];
  var origConfirm = window.confirm;
  window.confirm = function (m) { seen.push(m); return false; };
  document.getElementById('btnGenRound2').click();
  await new Promise(function (r) { setTimeout(r, 800); });
  window.confirm = origConfirm;
  return seen;
})()
```

Expected: `["二巡目は生成済みです（6名）。\n未生成の選手がいれば差分だけ追加しますか？\n※CSV で作った二巡目がある大会では使わないでください（重複します）。"]`

- [ ] **Step 5: 一覧に二巡目が出ていることを確認する**

ページをリロードして `javascript_tool`:

```javascript
[document.getElementById('roundCounter').textContent,
 document.querySelectorAll('#roundList .round-row').length,
 document.querySelector('#roundList .round-prev').textContent,
 document.querySelectorAll('#roundList .chip.empty').length]
```

Expected: `["二巡目 6名　技 未入力 6", 6, "一巡目 15", 18]`（先頭は女子の最低得点 = 検証梅子 15 点。空きチップが 6行×3 = 18 個あり、`chips-required` により赤く表示される）

- [ ] **Step 6: コミット**

```bash
git add admin-round.js
git commit -m "feat: 進行タブの二巡目生成に未採点・生成済みの確認を入れる" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: 技の入力と「一巡目と同じ技をコピー」

行タップで `TechPicker` のシートを開き、閉じたときに保存する。行ごとに一巡目からのコピーを置く。

**Files:**
- Modify: `admin-round.js`

- [ ] **Step 1: `openPicker` / `onCopyFromRound1` / `saveTech` を実装する**

置換前:

```javascript
  // --- 技の入力（Task 3 で中身を入れる） ---

  function openPicker(p, row) {
    // Task 3
  }

  function onCopyFromRound1(p, src, row) {
    // Task 3
  }
```

置換後:

```javascript
  // --- 技の入力 ---

  async function ensureTechniques() {
    if (techniques) return true;
    var data = await Api.loadTechniques();
    if (!data || !data.techniques) {
      alert('技術リストを取得できませんでした。');
      return false;
    }
    techniques = data.techniques;
    return true;
  }

  async function openPicker(p, row) {
    if (pickerOpen) return;   // チップと行の両方がタップを拾うので二重に開かない
    if (!(await ensureTechniques())) return;
    var eventId = CTX.eventId;
    // 最新の選択は onChange で控える
    var latest = TechPicker.fromArray([p.tech1, p.tech2, p.tech3]);
    pickerOpen = true;
    TechPicker.open({
      techniques: techniques,
      initial: latest,
      onChange: function(state) {
        latest = state;
        TechPicker.renderChips(row.querySelector('.round-chips'), state,
          function() { openPicker(p, row); });
      },
      onClose: async function(state) {
        pickerOpen = false;
        latest = state || latest;
        var arr = TechPicker.toArray(latest);
        if (arr[0] === (p.tech1 || '') &&
            arr[1] === (p.tech2 || '') &&
            arr[2] === (p.tech3 || '')) {
          return;   // 変わっていないなら送らない
        }
        await saveTech(p, arr, row, eventId);
      }
    });
  }

  // 保存できたら true。失敗したら画面もサーバーに合わせて元に戻す。
  async function saveTech(p, arr, row, eventId) {
    var res = await Api.updatePlayerInfo(eventId, p.id,
      { tech1: arr[0], tech2: arr[1], tech3: arr[2] });
    if (!res || !res.ok) {
      alert('技を保存できませんでした。通信を確認してもう一度お試しください。');
      drawChips(p, row);
      return false;
    }
    p.tech1 = arr[0];
    p.tech2 = arr[1];
    p.tech3 = arr[2];
    drawChips(p, row);
    updateCounter();
    return true;
  }

  async function onCopyFromRound1(p, src, row) {
    var ok = await saveTech(p, [src.tech1 || '', src.tech2 || '', src.tech3 || ''],
      row, CTX.eventId);
    if (ok) Admin.toast('一巡目の技をコピーしました');
  }
```

- [ ] **Step 2: コピーが保存されることを確認する**

`http://localhost:3457/admin.html#round/<EV>` をリロードし、`javascript_tool`:

```javascript
await (async function () {
  document.querySelector('#roundList .round-row .round-copy').click();
  await new Promise(function (r) { setTimeout(r, 900); });
  var ev = await Api.loadEvent('<EV>');
  var row = document.querySelector('#roundList .round-row');
  var id = row.getAttribute('data-player-id');
  var p = ev.players.filter(function (x) { return x.id === id; })[0];
  return [[p.tech1, p.tech2, p.tech3],
          document.getElementById('roundCounter').textContent];
})()
```

Expected: `[["四方","真","連"], "二巡目 6名　技 未入力 5"]`

- [ ] **Step 3: シートが開いて保存されることを確認する**

```javascript
await (async function () {
  document.querySelectorAll('#roundList .round-row')[1].click();
  await new Promise(function (r) { setTimeout(r, 600); });
  return document.querySelectorAll('.tp-sheet').length;
})()
```

Expected: `1`（`TechPicker.open` のシートが1枚開く）

シート内の技を3つタップして「完了」で閉じ、`javascript_tool` で:

```javascript
await (async function () {
  var ev = await Api.loadEvent('<EV>');
  var id = document.querySelectorAll('#roundList .round-row')[1].getAttribute('data-player-id');
  var p = ev.players.filter(function (x) { return x.id === id; })[0];
  return [[p.tech1, p.tech2, p.tech3], document.getElementById('roundCounter').textContent];
})()
```

Expected: 選んだ 3 技が順に入り、カウンタが `技 未入力 4` になる。

- [ ] **Step 4: 一巡目を削除した行でコピーが無効になることを確認する**

```javascript
await (async function () {
  var ev = await Api.loadEvent('<EV>');
  var r2 = ev.players.filter(function (p) { return Courts.roundOf(p) === 2; })[0];
  await Api.deletePlayer('<EV>', r2.sourcePlayerId, true);
  location.reload();
})()
```

リロード後:

```javascript
[document.querySelector('#roundList .round-row .round-prev').textContent,
 document.querySelector('#roundList .round-row .round-copy').disabled]
```

Expected: `["一巡目 —", true]`

- [ ] **Step 5: 全件入力でカウンタが緑になることを確認する**

```javascript
await (async function () {
  var ev = await Api.loadEvent('<EV>');
  var r2 = ev.players.filter(function (p) { return Courts.roundOf(p) === 2; });
  for (var i = 0; i < r2.length; i++) {
    await Api.updatePlayerInfo('<EV>', r2[i].id, { tech1: '四方', tech2: '真', tech3: '連' });
  }
  location.reload();
})()
```

リロード後:

```javascript
[document.getElementById('roundCounter').textContent,
 document.getElementById('roundCounter').className,
 document.querySelectorAll('#roundList .chip.empty').length]
```

Expected: `["二巡目 6名　技 未入力 0", "round-counter done", 0]`

- [ ] **Step 6: CSVエクスポートがメニューから出せることを確認する**

`find` で `⋯` を探してクリックし、`CSVエクスポート` が現れることを確認する。`read_console_messages`（`onlyErrors: true`）。

Expected: メニューに `CSVエクスポート` が1件、コンソールエラー 0 件。

- [ ] **Step 7: コミット**

```bash
git add admin-round.js
git commit -m "feat: 進行タブで二巡目の技を入力・一巡目からコピーできるようにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: 結果タブ

3部門の順位を出し、発表モードと共有リンクの入口を置く。

**Files:**
- Create: `admin-results.js`
- Modify: `admin.html`, `admin.css`

- [ ] **Step 1: `admin-results.js` を作る**

新規ファイル。全内容:

```javascript
// 結果タブ：サーバーの順位（computeRanking）を描き、発表・共有の入口を置く
var AdminResults = (function() {

  var CATEGORIES = [
    { key: 'male',    title: '一般男子' },
    { key: 'newFace', title: '新人' },
    { key: 'female',  title: '一般女子' }
  ];

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function render(container, ctx) {
    container.innerHTML = '';
    if (!ctx || !ctx.eventId) {
      container.innerHTML = '<p class="results-empty">大会を選んでください。</p>';
      return;
    }
    var eventId = ctx.eventId;

    var bar = document.createElement('div');
    bar.className = 'results-bar';
    bar.appendChild(makeBtn('btnResultsReload', '最新に更新', onReload));
    bar.appendChild(makeBtn('btnResultsPresent', '発表モードで開く', onPresent));
    bar.appendChild(makeBtn('btnResultsCopy', '共有リンクをコピー', onCopy));
    container.appendChild(bar);

    var body = document.createElement('div');
    body.className = 'results-body';
    body.id = 'resultsBody';
    body.textContent = '読み込み中…';
    container.appendChild(body);

    var data = await Api.loadRanking(eventId);
    if (ctx.isStale()) return;  // 通信中に大会を切り替えられた
    if (!data) {
      body.textContent = '順位を取得できませんでした。「最新に更新」でやり直してください。';
      return;
    }
    body.innerHTML = '';
    CATEGORIES.forEach(function(c) {
      body.appendChild(buildSection(c.title, (data.rankings && data.rankings[c.key]) || []));
    });
  }

  function makeBtn(id, label, handler) {
    var b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }

  function buildSection(title, rows) {
    var sec = document.createElement('section');
    sec.className = 'results-section';
    if (rows.length === 0) {
      sec.innerHTML = '<h3>' + esc(title) + '</h3><p class="results-empty">データなし</p>';
      return sec;
    }
    var lines = rows.map(function(r) {
      return '<li><span class="results-rank">' + esc(String(r.rank)) + '</span>' +
             '<span class="results-name">' + esc(r.name) + '</span>' +
             '<span class="results-score">' + esc(String(r.score)) + '</span></li>';
    }).join('');
    sec.innerHTML = '<h3>' + esc(title) + '</h3><ul class="results-list">' + lines + '</ul>';
    return sec;
  }

  function onReload() {
    Admin.reloadEvent();
  }

  // トークンは冪等に発行される（既にあれば同じものが返る）
  async function shareToken() {
    var link = await Api.createShareLink(Admin.currentEventId());
    if (!link || !link.token) {
      alert('共有リンクを作成できませんでした。通信を確認してください。');
      return null;
    }
    return link.token;
  }

  async function onPresent() {
    var token = await shareToken();
    if (!token) return;
    var url = 'present.html#' + token;
    var w = window.open(url, '_blank');
    // await をまたぐとポップアップがブロックされることがある。黙って何も起きないより URL を出す。
    if (!w) alert('新しいタブを開けませんでした。次のURLを開いてください。\n' +
                  location.origin + '/' + url);
  }

  async function onCopy() {
    var token = await shareToken();
    if (!token) return;
    var url = location.origin + '/share.html#' + token;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        Admin.toast('リンクをコピーしました');
        return;
      } catch (e) {
        // 権限が無い・HTTPS でない等。下の prompt に落とす
      }
    }
    window.prompt('このURLをコピーしてください', url);
  }

  Admin.registerTab('results', { render: render });

  return { render: render };
})();
```

- [ ] **Step 2: `admin.html` に `<script>` を足す**

置換前:

```html
  <script src="admin-round.js"></script>
</body>
```

置換後:

```html
  <script src="admin-round.js"></script>
  <script src="admin-results.js"></script>
</body>
```

- [ ] **Step 3: `admin.css` の末尾に結果タブのスタイルを追記する**

Task 1 で足した進行タブのブロックの後ろに追記する。

```css
/* ===== 結果タブ（admin-results.js） ===== */
.results-bar { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 0; }
.results-bar button {
  flex: 1 1 auto; min-height: 44px; border: none; border-radius: 6px;
  padding: 10px 12px; background: var(--accent); color: var(--accent-text); font-size: 13px;
}
.results-body { padding-bottom: 16px; }
.results-section { margin-bottom: 16px; }
.results-section h3 { color: var(--accent); font-size: 15px; margin-bottom: 6px; }
.results-list { list-style: none; margin: 0; padding: 0; }
.results-list li {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 6px; border-bottom: 1px solid var(--border);
}
.results-rank { width: 2.5em; text-align: right; color: var(--score-color); font-weight: bold; }
.results-name { flex: 1; }
.results-score { font-weight: bold; }
.results-empty { color: var(--text-muted); padding: 8px 4px; }
```

- [ ] **Step 4: 順位が3部門出ることを確認する**

`http://localhost:3457/admin.html#results/<EV>` を開き、`javascript_tool`:

```javascript
[].map.call(document.querySelectorAll('.results-section h3'), function (h) { return h.textContent; })
```

Expected: `["一般男子","新人","一般女子"]`

```javascript
[].map.call(document.querySelectorAll('.results-section')[0].querySelectorAll('li'),
  function (li) { return li.textContent; })
```

Expected: 一般男子の行が得点降順で並ぶ（`検証太郎` が先頭）。同点があれば同じ順位番号になる。

- [ ] **Step 5: 共有リンクのコピーを確認する**

`javascript_tool`:

```javascript
await (async function () {
  var copied = null;
  var orig = navigator.clipboard && navigator.clipboard.writeText;
  if (orig) navigator.clipboard.writeText = function (t) { copied = t; return Promise.resolve(); };
  document.getElementById('btnResultsCopy').click();
  await new Promise(function (r) { setTimeout(r, 900); });
  if (orig) navigator.clipboard.writeText = orig;
  return copied;
})()
```

Expected: `"http://localhost:3457/share.html#<8文字のトークン>"`。**このトークンを控える**（以降 `<TOKEN>` と書く）。

- [ ] **Step 6: 375px で収まることを確認する**

`resize_window` preset `mobile` でリロードし:

```javascript
[document.documentElement.scrollWidth, window.innerWidth,
 [].map.call(document.querySelectorAll('.results-bar button'),
   function (b) { return b.getBoundingClientRect().height >= 44; })]
```

Expected: 幅が等しく、3つのボタンがすべて `true`。

- [ ] **Step 7: コミット**

```bash
git add admin-results.js admin.html admin.css
git commit -m "feat: 運営画面の結果タブに順位と発表・共有の入口を作る" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: `share.html` — 参加者向けの閲覧専用ページ

トークンで順位だけを見せる。60秒ごとに取り直し、`updatedAt` が変わったときだけ描き直す。

**Files:**
- Create: `share.html`, `share.css`, `share.js`

- [ ] **Step 1: `share.css` を作る**

新規ファイル。全内容:

```css
/* 参加者向けの順位ページ。theme.css の変数を使う（style.css は読まない＝768px の制約が及ばない） */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Meiryo", "Yu Gothic", "ヒラギノ角ゴ Pro W3", sans-serif;
  font-size: 15px;
  background: var(--bg);
  color: var(--text);
}
.share-root { max-width: 560px; margin: 0 auto; padding: 14px 14px 40px; }
.share-head h1 { font-size: 18px; margin-bottom: 2px; }
.share-meta { color: var(--text-muted); font-size: 13px; }
.share-status { display: block; color: var(--text-muted); font-size: 12px; margin: 8px 0 14px; }
.share-status.warn { color: var(--warn); font-weight: bold; }
.share-section { margin-bottom: 22px; }
.share-section h2 {
  font-size: 16px; color: var(--accent);
  border-bottom: 2px solid var(--accent); padding-bottom: 4px; margin-bottom: 6px;
}
.share-list { list-style: none; }
.share-list li {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 4px; border-bottom: 1px solid var(--border);
}
.share-rank { width: 2.5em; text-align: right; color: var(--score-color); font-weight: bold; }
.share-name { flex: 1; }
.share-score { font-weight: bold; }
.share-empty { color: var(--text-muted); padding: 8px 4px; }
.share-error { padding: 48px 8px; text-align: center; color: var(--text-muted); font-size: 16px; }
```

- [ ] **Step 2: `share.html` を作る**

新規ファイル。全内容:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>順位</title>
  <link rel="stylesheet" href="theme.css">
  <link rel="stylesheet" href="share.css">
</head>
<body data-theme="light">

  <div class="share-root" id="shareRoot">
    <div class="share-head" id="shareHead"></div>
    <span class="share-status" id="shareStatus"></span>
    <div id="shareBody"></div>
  </div>

  <script src="api.js"></script>
  <script src="share.js"></script>
</body>
</html>
```

- [ ] **Step 3: `share.js` を作る**

新規ファイル。全内容:

```javascript
// share.html の制御。共有トークンで順位だけを取り、60秒ごとに取り直す。
// 認証タスクの「無認証で通すファイル」に storage.js は入っていないので読み込まない。
// テーマは localStorage を直接見る（採点画面と同じキー）。
var Share = (function() {

  var REFRESH_MS = 60000;
  var CATEGORIES = [
    { key: 'male',    title: '一般男子' },
    { key: 'newFace', title: '新人' },
    { key: 'female',  title: '一般女子' }
  ];

  var token = '';
  var lastUpdatedAt = null;
  var lastFetchedAt = null;
  var timerId = null;
  var headEl, statusEl, bodyEl;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function applyTheme() {
    var t = null;
    try { t = localStorage.getItem('tmg_theme'); } catch (e) {}
    if (!t) {
      t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark' : 'light';
    }
    document.body.setAttribute('data-theme', t);
  }

  function hhmm(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function showInvalid() {
    if (timerId) { clearInterval(timerId); timerId = null; }
    headEl.innerHTML = '';
    statusEl.textContent = '';
    bodyEl.innerHTML = '<p class="share-error">このリンクは無効です</p>';
  }

  function renderHead(ev) {
    ev = ev || {};
    headEl.innerHTML =
      '<h1>' + esc(ev.name) + '</h1>' +
      '<div class="share-meta">' + esc(ev.date) + (ev.venue ? '　' + esc(ev.venue) : '') + '</div>';
  }

  function renderBody(rankings) {
    var html = '';
    CATEGORIES.forEach(function(c) {
      var rows = rankings[c.key] || [];
      html += '<section class="share-section"><h2>' + esc(c.title) + '</h2>';
      if (rows.length === 0) {
        html += '<p class="share-empty">データなし</p>';
      } else {
        html += '<ul class="share-list">';
        rows.forEach(function(r) {
          html += '<li><span class="share-rank">' + esc(String(r.rank)) + '</span>' +
                  '<span class="share-name">' + esc(r.name) + '</span>' +
                  '<span class="share-score">' + esc(String(r.score)) + '</span></li>';
        });
        html += '</ul>';
      }
      html += '</section>';
    });
    bodyEl.innerHTML = html;
  }

  async function refresh(isFirst) {
    var data = await Api.loadSharedRanking(token);
    if (!data) {
      // 初回の失敗はトークンが無効とみなす。2回目以降は前回の内容を残す。
      if (isFirst) { showInvalid(); return; }
      statusEl.textContent = '更新できませんでした（前回 ' +
        (lastFetchedAt ? hhmm(lastFetchedAt) : '—') + ' 時点）';
      statusEl.className = 'share-status warn';
      return;
    }
    lastFetchedAt = new Date();
    statusEl.textContent = hhmm(lastFetchedAt) + ' 時点';
    statusEl.className = 'share-status';
    var updatedAt = (data.event && data.event.updatedAt) || '';
    if (updatedAt === lastUpdatedAt) return;   // 中身が変わっていないなら描き直さない
    lastUpdatedAt = updatedAt;
    renderHead(data.event);
    renderBody(data.rankings || {});
  }

  function init() {
    applyTheme();
    headEl = document.getElementById('shareHead');
    statusEl = document.getElementById('shareStatus');
    bodyEl = document.getElementById('shareBody');
    token = (location.hash || '').replace(/^#/, '');
    if (!token) { showInvalid(); return; }
    timerId = setInterval(function() { refresh(false); }, REFRESH_MS);
    refresh(true);
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('shareRoot')) init();
  });

  return { refresh: refresh };
})();
```

- [ ] **Step 4: 順位が出ることを確認する**

`http://localhost:3457/share.html#<TOKEN>` を開き、`javascript_tool`:

```javascript
[document.querySelector('.share-head h1').textContent,
 [].map.call(document.querySelectorAll('.share-section h2'), function (h) { return h.textContent; }),
 document.getElementById('shareStatus').textContent]
```

Expected: `["計画3検証", ["一般男子","新人","一般女子"], "HH:MM 時点"]`

- [ ] **Step 5: 無効なトークンを確認する**

`http://localhost:3457/share.html#zzzzzzzz` を開く。

```javascript
document.getElementById('shareBody').textContent
```

Expected: `"このリンクは無効です"`

ハッシュ無し（`http://localhost:3457/share.html`）でも同じ表示になることを確認する。

- [ ] **Step 6: 更新失敗で前回の内容が残ることを確認する**

`http://localhost:3457/share.html#<TOKEN>` に戻り、`javascript_tool`:

```javascript
await (async function () {
  var before = document.querySelectorAll('.share-list li').length;
  var orig = Api.loadSharedRanking;
  Api.loadSharedRanking = async function () { return null; };
  await Share.refresh(false);
  Api.loadSharedRanking = orig;
  return [before, document.querySelectorAll('.share-list li').length,
          document.getElementById('shareStatus').textContent,
          document.getElementById('shareStatus').className];
})()
```

Expected: 行数が前後で同じ、ステータスが `更新できませんでした（前回 HH:MM 時点）`、クラスが `share-status warn`。

- [ ] **Step 7: `updatedAt` が変わったときだけ描き直すことを確認する**

```javascript
await (async function () {
  document.querySelector('.share-list li').setAttribute('data-mark', '1');
  await Share.refresh(false);
  return document.querySelector('.share-list li').getAttribute('data-mark');
})()
```

Expected: `"1"`（`updatedAt` が同じなので `innerHTML` が再構築されておらず、印を付けた要素がそのまま残る）

- [ ] **Step 8: ライト／ダークを確認する**

```javascript
(function () { try { localStorage.setItem('tmg_theme', 'dark'); } catch (e) {} location.reload(); })()
```

リロード後:

```javascript
[document.body.getAttribute('data-theme'), getComputedStyle(document.body).backgroundColor]
```

Expected: `["dark", "rgb(26, 26, 46)"]`。確認後 `localStorage.setItem('tmg_theme','light')` に戻す。

- [ ] **Step 9: 375px を確認する**

`resize_window` preset `mobile` でリロードし `[document.documentElement.scrollWidth, window.innerWidth]`。

Expected: 2つの値が等しい。

- [ ] **Step 10: コミット**

```bash
git add share.html share.css share.js
git commit -m "feat: 参加者向けの閲覧専用順位ページ share.html を追加する" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: `present.html` — 掲示モード（A）

大画面用の暗いページ。まず「掲示」（1画面に1部門）だけを作る。「発表」ボタンは置くが Task 7 で中身を入れる。

**Files:**
- Create: `present.html`, `present.css`, `present.js`

- [ ] **Step 1: `present.css` を作る**

新規ファイル。全内容:

```css
/* 大画面用。常に暗い配色なので body に data-theme="dark" を固定し、theme.css の変数を使う */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Meiryo", "Yu Gothic", "ヒラギノ角ゴ Pro W3", sans-serif;
  background: var(--bg);
  color: var(--text);
}
.present-root { display: flex; flex-direction: column; height: 100vh; }
.present-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; background: var(--bg-secondary); border-bottom: 1px solid var(--border);
}
.present-modes { display: flex; gap: 6px; }
.present-tools { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.present-bar button {
  min-height: 40px; padding: 8px 14px; font-size: 14px;
  border: 1px solid var(--border); border-radius: 6px;
  background: transparent; color: var(--text); cursor: pointer;
}
.present-modes button.on {
  background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: bold;
}
.present-status { color: var(--text-muted); font-size: 12px; }
.present-screen { flex: 1; overflow-y: auto; padding: 16px 32px; cursor: pointer; }
.present-title { font-size: 32px; font-weight: bold; color: var(--score-color); margin-bottom: 14px; }
.present-page { font-size: 20px; color: var(--text-muted); margin-left: 16px; }
.present-list { list-style: none; }
.present-list li {
  display: flex; align-items: center; gap: 24px;
  padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 28px;
}
.present-list li.top { font-weight: bold; font-size: 34px; }
.present-list li.veil { color: var(--text-muted); }
.present-list li.veil .present-name { letter-spacing: 6px; }
.present-rank { width: 2.5em; text-align: right; color: var(--score-color); }
.present-name { flex: 1; }
.present-score { width: 4em; text-align: right; }
.present-hint { padding: 10px 32px 18px; color: var(--text-muted); font-size: 16px; }
.present-hint strong { background: var(--score-color); color: var(--bg); border-radius: 6px; padding: 4px 10px; }
.present-pick { display: flex; gap: 16px; flex-wrap: wrap; padding-top: 24px; }
.present-pick button {
  font-size: 24px; padding: 20px 28px; border-radius: 10px;
  border: 2px solid var(--score-color); background: transparent; color: var(--text); cursor: pointer;
}
.present-error { font-size: 24px; color: var(--text-muted); padding: 48px 8px; }
```

- [ ] **Step 2: `present.html` を作る**

新規ファイル。全内容:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>発表モード</title>
  <link rel="stylesheet" href="theme.css">
  <link rel="stylesheet" href="present.css">
</head>
<body data-theme="dark">

  <div class="present-root" id="presentRoot">
    <header class="present-bar">
      <div class="present-modes">
        <button id="btnModeBoard" class="on">掲示</button>
        <button id="btnModeReveal">発表</button>
      </div>
      <div class="present-tools">
        <span class="present-status" id="presentStatus"></span>
        <button id="btnPresentRefresh">更新</button>
        <button id="btnPresentFull">全画面</button>
      </div>
    </header>
    <main class="present-screen" id="presentScreen"></main>
    <div class="present-hint" id="presentHint"></div>
  </div>

  <script src="api.js"></script>
  <script src="present.js"></script>
</body>
</html>
```

- [ ] **Step 3: `present.js` を作る（掲示モードまで）**

新規ファイル。全内容:

```javascript
// present.html の制御。掲示（A）と発表（C）の2モード。
// 発表モード中は自動更新しない（読み上げ中に順位が動かないように）。
var Present = (function() {

  var REFRESH_MS = 60000;
  var CATEGORIES = [
    { key: 'male',    title: '一般男子' },
    { key: 'newFace', title: '新人' },
    { key: 'female',  title: '一般女子' }
  ];

  var token = '';
  var mode = 'board';       // 'board' | 'reveal'
  var catIndex = 0;
  var data = null;
  var lastFetchedAt = null;
  var invalid = false;
  var screenEl, hintEl, statusEl, btnBoard, btnReveal;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function hhmm(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function rowsOf(index) {
    if (!data || !data.rankings) return [];
    return data.rankings[CATEGORIES[index].key] || [];
  }

  // --- 取得 ---

  async function load(isFirst) {
    var got = await Api.loadSharedRanking(token);
    if (!got) {
      if (isFirst) { invalid = true; render(); return; }
      statusEl.textContent = '更新できませんでした（前回 ' +
        (lastFetchedAt ? hhmm(lastFetchedAt) : '—') + ' 時点）';
      return;
    }
    data = got;
    lastFetchedAt = new Date();
    statusEl.textContent = hhmm(lastFetchedAt) + ' 時点';
    render();
  }

  // --- 描画 ---

  function render() {
    if (invalid) {
      screenEl.innerHTML = '<p class="present-error">このリンクは無効です</p>';
      hintEl.textContent = '';
      return;
    }
    if (!data) {
      screenEl.innerHTML = '<p class="present-error">読み込み中…</p>';
      hintEl.textContent = '';
      return;
    }
    renderBoard();
  }

  function renderBoard() {
    var rows = rowsOf(catIndex);
    var html = '<div class="present-title">' + esc(CATEGORIES[catIndex].title) + ' の部' +
      '<span class="present-page">' + (catIndex + 1) + ' / ' + CATEGORIES.length + '</span></div>';
    if (rows.length === 0) {
      html += '<p class="present-error">データなし</p>';
    } else {
      html += '<ul class="present-list">';
      rows.forEach(function(r) {
        html += '<li class="' + (r.rank <= 3 ? 'top' : '') + '">' +
                '<span class="present-rank">' + esc(String(r.rank)) + '</span>' +
                '<span class="present-name">' + esc(r.name) + '</span>' +
                '<span class="present-score">' + esc(String(r.score)) + '</span></li>';
      });
      html += '</ul>';
    }
    screenEl.innerHTML = html;
    hintEl.innerHTML = 'タップ／→ で次の部門　←で前';
  }

  // --- 進行 ---

  function next() {
    if (invalid || !data) return;
    catIndex = (catIndex + 1) % CATEGORIES.length;
    render();
  }

  function prev() {
    if (invalid || !data) return;
    catIndex = (catIndex + CATEGORIES.length - 1) % CATEGORIES.length;
    render();
  }

  function setMode(m) {
    mode = m;
    btnBoard.className = (m === 'board' ? 'on' : '');
    btnReveal.className = (m === 'reveal' ? 'on' : '');
    render();
  }

  function toggleFull() {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      return;
    }
    var el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
    else alert('この端末では全画面にできません。');
  }

  function onKey(ev) {
    if (ev.target && ev.target.tagName === 'BUTTON') return;  // ボタンの Space/Enter と競合させない
    if (ev.key === 'ArrowRight' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      next();
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      prev();
    }
  }

  function init() {
    screenEl = document.getElementById('presentScreen');
    hintEl = document.getElementById('presentHint');
    statusEl = document.getElementById('presentStatus');
    btnBoard = document.getElementById('btnModeBoard');
    btnReveal = document.getElementById('btnModeReveal');

    token = (location.hash || '').replace(/^#/, '');
    if (!token) { invalid = true; render(); return; }

    screenEl.addEventListener('click', next);
    document.addEventListener('keydown', onKey);
    btnBoard.addEventListener('click', function() { this.blur(); setMode('board'); });
    btnReveal.addEventListener('click', function() { this.blur(); setMode('reveal'); });
    document.getElementById('btnPresentRefresh').addEventListener('click', function() {
      this.blur();
      load(false);
    });
    document.getElementById('btnPresentFull').addEventListener('click', function() {
      this.blur();
      toggleFull();
    });

    // 掲示モードのときだけ自動更新する
    setInterval(function() { if (mode === 'board' && !invalid) load(false); }, REFRESH_MS);
    load(true);
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('presentRoot')) init();
  });

  return { };
})();
```

- [ ] **Step 4: 掲示モードを確認する**

`http://localhost:3457/present.html#<TOKEN>` を開き、`javascript_tool`:

```javascript
[document.querySelector('.present-title').textContent,
 document.querySelectorAll('.present-list li').length,
 document.querySelectorAll('.present-list li.top').length]
```

Expected: `["一般男子 の部1 / 3", <一般男子の人数>, <rank<=3 の人数>]`

- [ ] **Step 5: 次／前の部門を確認する**

```javascript
(function () {
  document.getElementById('presentScreen').click();
  var a = document.querySelector('.present-title').textContent;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  var b = document.querySelector('.present-title').textContent;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  var c = document.querySelector('.present-title').textContent;
  return [a, b, c];
})()
```

Expected: `["新人 の部2 / 3", "一般女子 の部3 / 3", "新人 の部2 / 3"]`

- [ ] **Step 6: 無効トークンとコンソールを確認する**

`http://localhost:3457/present.html#zzzzzzzz` を開き:

```javascript
document.getElementById('presentScreen').textContent
```

Expected: `"このリンクは無効です"`

`read_console_messages`（`onlyErrors: true`）。Expected: エラー 0 件。

- [ ] **Step 7: コミット**

```bash
git add present.html present.css present.js
git commit -m "feat: 大画面用の発表モード present.html（掲示モード）を追加する" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: 発表モード（C）と `Present.revealOrder`（TDD）

下位から1人ずつ開く発表モードを足す。開く順は純粋関数に切り出し、先にテストを書く。

**Files:**
- Modify: `test.html`, `present.js`

- [ ] **Step 1: 失敗するテストを書く**

まず `test.html` に `present.js` を読み込ませる。

置換前:

```html
<script src="techpicker.js"></script>
<script>
```

置換後:

```html
<script src="techpicker.js"></script>
<script src="present.js"></script>
<script>
```

次にテスト本体。`test.html` の末尾近く、`await runApiTests();` の直前に追加する。

置換前:

```javascript
    await runApiTests();
```

置換後:

```javascript
    // present.js（発表モードで開く順）
    var h2p = document.createElement('h2');
    h2p.textContent = 'present.js';
    results.appendChild(h2p);

    assert('revealOrder: 空配列は空', Present.revealOrder([]), []);
    assert('revealOrder: null でも落ちない', Present.revealOrder(null), []);
    assert('revealOrder: 1件は [0]', Present.revealOrder([{ rank: 1, name: 'A', score: 1 }]), [0]);
    var revRows = [
      { rank: 1, name: 'A', score: 74 },
      { rank: 1, name: 'B', score: 74 },
      { rank: 3, name: 'C', score: 62 }
    ];
    assert('revealOrder: 下位から順に開く', Present.revealOrder(revRows), [2, 1, 0]);
    assert('revealOrder: 同順位もまとめず1人ずつ', Present.revealOrder(revRows).length, revRows.length);
    assert('revealOrder: 最後に開くのは1位の行',
      revRows[Present.revealOrder(revRows)[revRows.length - 1]].rank, 1);

    await runApiTests();
```

`http://localhost:3457/test.html` をリロードする。

Expected: ページ末尾に `Result:` が**出ない**（`Present.revealOrder is not a function` で IIFE が止まる）。`read_console_messages` で `Present.revealOrder is not a function` を確認する。これが赤の状態。

- [ ] **Step 2: `revealOrder` を実装する**

`present.js` の `esc` 関数の直前に追加する。

置換前:

```javascript
  var screenEl, hintEl, statusEl, btnBoard, btnReveal;

  function esc(s) {
```

置換後:

```javascript
  var screenEl, hintEl, statusEl, btnBoard, btnReveal;
  var picking = true;   // 発表モードで部門を選んでいる最中か
  var order = [];       // revealOrder の結果（rankings 配列への添字）
  var step = 0;         // 何人開いたか

  // 発表（C）モードで開く順。下位から1人ずつ、最後が先頭行（＝1位）。
  // 同順位もまとめず1人ずつ、一覧の並びの後ろから開く（司会が1人ずつ読み上げるため）。
  // 戻り値は rankings 配列への添字の列。
  function revealOrder(rows) {
    var out = [];
    var n = (rows || []).length;
    for (var i = n - 1; i >= 0; i--) out.push(i);
    return out;
  }

  function esc(s) {
```

さらに公開する。置換前:

```javascript
  return { };
})();
```

置換後:

```javascript
  return { revealOrder: revealOrder };
})();
```

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 238 passed, 0 failed`

- [ ] **Step 3: 発表モードの描画と進行を実装する**

`present.js` の `render` を置き換える。

置換前:

```javascript
    if (!data) {
      screenEl.innerHTML = '<p class="present-error">読み込み中…</p>';
      hintEl.textContent = '';
      return;
    }
    renderBoard();
  }
```

置換後:

```javascript
    if (!data) {
      screenEl.innerHTML = '<p class="present-error">読み込み中…</p>';
      hintEl.textContent = '';
      return;
    }
    if (mode === 'reveal') renderReveal();
    else renderBoard();
  }

  // 発表モードは下位が上に来るように並びを逆にして描く。
  // 表示の上から順に開いていくと、最後に開くのが一番下の1位になる。
  function renderReveal() {
    if (picking) {
      var pick = '<div class="present-title">部門を選んでください</div><div class="present-pick">';
      CATEGORIES.forEach(function(c, i) {
        pick += '<button data-cat="' + i + '">' + esc(c.title) + '</button>';
      });
      pick += '</div>';
      screenEl.innerHTML = pick;
      [].forEach.call(screenEl.querySelectorAll('.present-pick button'), function(b) {
        b.addEventListener('click', function(ev) {
          ev.stopPropagation();   // 画面タップ（次へ進む）と二重に反応させない
          startCategory(parseInt(b.getAttribute('data-cat'), 10));
        });
      });
      hintEl.textContent = '';
      return;
    }

    var rows = rowsOf(catIndex);
    var revealedUpTo = step;   // order の先頭から step 件が開いている
    var html = '<div class="present-title">' + esc(CATEGORIES[catIndex].title) + ' の部　発表</div>';
    if (rows.length === 0) {
      html += '<p class="present-error">データなし</p>';
      screenEl.innerHTML = html;
      hintEl.innerHTML = '<strong>タップで 次の部門</strong>';
      return;
    }
    html += '<ul class="present-list">';
    for (var pos = 0; pos < order.length; pos++) {
      var r = rows[order[pos]];
      var open = pos < revealedUpTo;
      html += '<li class="' + (r.rank <= 3 ? 'top ' : '') + (open ? '' : 'veil') + '">' +
              '<span class="present-rank">' + esc(String(r.rank)) + '</span>' +
              '<span class="present-name">' + (open ? esc(r.name) : '？？？？') + '</span>' +
              '<span class="present-score">' + (open ? esc(String(r.score)) : '—') + '</span></li>';
    }
    html += '</ul>';
    screenEl.innerHTML = html;

    if (step < order.length) {
      hintEl.innerHTML = '<strong>タップで ' + esc(String(rows[order[step]].rank)) + '位 を発表</strong>';
    } else {
      hintEl.innerHTML = '<strong>タップで 次の部門</strong>';
    }
  }

  function startCategory(index) {
    catIndex = index;
    picking = false;
    order = revealOrder(rowsOf(index));
    step = 0;
    render();
  }
```

- [ ] **Step 4: `next` / `prev` / `setMode` を発表モードに対応させる**

置換前:

```javascript
  function next() {
    if (invalid || !data) return;
    catIndex = (catIndex + 1) % CATEGORIES.length;
    render();
  }

  function prev() {
    if (invalid || !data) return;
    catIndex = (catIndex + CATEGORIES.length - 1) % CATEGORIES.length;
    render();
  }

  function setMode(m) {
    mode = m;
    btnBoard.className = (m === 'board' ? 'on' : '');
    btnReveal.className = (m === 'reveal' ? 'on' : '');
    render();
  }
```

置換後:

```javascript
  function next() {
    if (invalid || !data) return;
    if (mode === 'reveal') {
      if (picking) return;                       // 部門を選ぶまでは進まない
      if (step < order.length) { step++; render(); return; }
      startCategory((catIndex + 1) % CATEGORIES.length);  // 全員開いたら次の部門を伏せ字から
      return;
    }
    catIndex = (catIndex + 1) % CATEGORIES.length;
    render();
  }

  function prev() {
    if (invalid || !data) return;
    if (mode === 'reveal') {
      if (picking) return;
      if (step > 0) { step--; render(); }        // 開きすぎたら1人ぶん伏せ直す
      return;
    }
    catIndex = (catIndex + CATEGORIES.length - 1) % CATEGORIES.length;
    render();
  }

  function setMode(m) {
    mode = m;
    btnBoard.className = (m === 'board' ? 'on' : '');
    btnReveal.className = (m === 'reveal' ? 'on' : '');
    if (m === 'reveal') { picking = true; step = 0; order = []; }
    render();
  }
```

- [ ] **Step 5: 発表モードの動きを確認する**

`http://localhost:3457/present.html#<TOKEN>` をリロードし、`javascript_tool`:

```javascript
(function () {
  document.getElementById('btnModeReveal').click();
  var picks = document.querySelectorAll('.present-pick button').length;
  document.querySelector('.present-pick button').click();
  var veiled = document.querySelectorAll('.present-list li.veil').length;
  var total = document.querySelectorAll('.present-list li').length;
  var firstRank = document.querySelector('.present-list li .present-rank').textContent;
  var lastRank = [].slice.call(document.querySelectorAll('.present-list li .present-rank')).pop().textContent;
  return [picks, total, veiled, firstRank, lastRank, document.getElementById('presentHint').textContent];
})()
```

Expected: `[3, <人数>, <人数>, "<最下位の順位>", "1", "タップで <最下位>位 を発表"]`
（全員伏せ字。表示の一番下が1位）

```javascript
(function () {
  var screen = document.getElementById('presentScreen');
  var seen = [];
  for (var i = 0; i < 3; i++) {
    screen.click();
    seen.push(document.querySelectorAll('.present-list li.veil').length);
  }
  var openNames = [].map.call(document.querySelectorAll('.present-list li:not(.veil) .present-name'),
    function (n) { return n.textContent; });
  return [seen, openNames];
})()
```

Expected: 伏せ字が 1 件ずつ減る（例 `[n-1, n-2, n-3]`）。開いた行は上から順（下位から順）に残っている。

```javascript
(function () {
  var screen = document.getElementById('presentScreen');
  for (var i = 0; i < 20; i++) screen.click();   // 全部開いて次の部門へ
  return [document.querySelector('.present-title').textContent,
          document.querySelectorAll('.present-list li.veil').length];
})()
```

Expected: 別の部門のタイトルになり、伏せ字が全件に戻っている。

- [ ] **Step 6: 発表モードで自動更新しないことを確認する**

```javascript
await (async function () {
  var calls = 0;
  var orig = Api.loadSharedRanking;
  Api.loadSharedRanking = async function (t) { calls++; return orig(t); };
  document.getElementById('btnModeReveal').click();
  await new Promise(function (r) { setTimeout(r, 1500); });
  Api.loadSharedRanking = orig;
  return calls;
})()
```

Expected: `0`（発表モードでは自動取得が走らない。「更新」ボタンを押したときだけ取りに行く）

- [ ] **Step 7: 全画面ボタンを確認する**

`find` で `全画面` を探してクリックする（ブラウザの許可設定によっては拒否される。その場合は `javascript_tool` で `typeof document.documentElement.requestFullscreen` が `"function"` であることの確認に代える）。

Expected: 例外が出ない（`read_console_messages` の `onlyErrors: true` でエラー 0 件）。

- [ ] **Step 8: テストが緑であることを再確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 238 passed, 0 failed`

- [ ] **Step 9: コミット**

```bash
git add present.js test.html
git commit -m "feat: 発表モードで下位から1人ずつ順位を開けるようにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: `ranking.html` をサーバーの順位に差し替える

クライアント側の集計（`parseCsvText` / `renderRankings` / `buildRankTable`）と CSV 読み込みを捨て、`Api.loadRanking` の結果を描くだけにする。`theme.css` の読み込みは計画2で追加済み。

**Files:**
- Modify: `ranking.html`

- [ ] **Step 1: `theme.css` が読み込まれていることを確認する**

```bash
grep -n "theme.css" ranking.html
```

Expected: `<link rel="stylesheet" href="theme.css">` の行が1件出る（計画2で追加済み）。出なければ `style.css` の `<link>` の直前に足す。

- [ ] **Step 2: CSV 読み込みの UI を消す**

置換前:

```html
      <button id="btnLoadFromEvent" class="btn-neutral">大会データを読み込む</button>
      <button id="btnLoadCsv" class="btn-neutral">CSVを読み込む（複数可）</button>
      <button id="btnDownloadHtml" class="btn-neutral">HTMLダウンロード</button>
      <button class="theme-btn" id="btnTheme">🌙 ダーク</button>
      <input type="file" id="rankCsvInput" accept=".csv" multiple style="display:none;">
    </div>

    <div class="ranking-container" id="rankingContainer">
      <p style="color:var(--text-muted)">大会を選択するか、CSVを読み込むと順位が表示されます。</p>
    </div>
```

置換後:

```html
      <button id="btnLoadFromEvent" class="btn-neutral">大会データを読み込む</button>
      <button id="btnDownloadHtml" class="btn-neutral">HTMLダウンロード</button>
      <button class="theme-btn" id="btnTheme">🌙 ダーク</button>
    </div>

    <div class="ranking-container" id="rankingContainer">
      <p style="color:var(--text-muted)">大会を選択すると順位が表示されます。</p>
    </div>
```

- [ ] **Step 3: スクリプトを差し替える**

置換前（`var body = document.body;` から始まる変数宣言）:

```javascript
    var body = document.body;
    var rankingContainer = document.getElementById('rankingContainer');
    var rankCsvInput = document.getElementById('rankCsvInput');
    var rankEventSelect = document.getElementById('rankEventSelect');
    var btnLoadFromEvent = document.getElementById('btnLoadFromEvent');
```

置換後:

```javascript
    var body = document.body;
    var rankingContainer = document.getElementById('rankingContainer');
    var rankEventSelect = document.getElementById('rankEventSelect');
    var btnLoadFromEvent = document.getElementById('btnLoadFromEvent');
    // 順位の集計はサーバーの computeRanking が唯一の実装。この画面は描くだけ。
    var CATEGORIES = [
      { key: 'male',    title: '一般男子' },
      { key: 'newFace', title: '新人' },
      { key: 'female',  title: '一般女子' }
    ];
```

置換前（読み込みボタンから `buildRankTable` の終わりまで、すべて）:

```javascript
    // 大会データを読み込む
    btnLoadFromEvent.addEventListener('click', async function() {
      var eventId = rankEventSelect.value;
      if (!eventId) {
        alert('大会を選択してください。');
        return;
      }
      var eventData = await Api.loadEvent(eventId);
      if (eventData && eventData.players) {
        renderRankings(eventData.players);
      } else {
        alert('大会データの読み込みに失敗しました。');
      }
    });

    document.getElementById('btnLoadCsv').addEventListener('click', function() {
      rankCsvInput.click();
    });

    function parseCsvText(text) {
      var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      var players = [];
      for (var i = 1; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var cols = line.split(',');
        players.push({
          name: cols[0] || '',
          score: parseFloat(cols[5]) || 0,
          isNewFace: cols[6] === '○',
          isFemale: cols[7] === '○'
        });
      }
      return players;
    }

    rankCsvInput.addEventListener('change', function(e) {
      var files = Array.prototype.slice.call(e.target.files);
      rankCsvInput.value = '';
      if (files.length === 0) return;
      var allPlayers = [];
      var loaded = 0;
      files.forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          var ps = parseCsvText(ev.target.result);
          Array.prototype.push.apply(allPlayers, ps);
          loaded++;
          if (loaded === files.length) renderRankings(allPlayers);
        };
        reader.readAsText(file, 'UTF-8');
      });
    });

    function renderRankings(players) {
      var maleScores = {}, femaleScores = {}, newFaceScores = {};
      players.forEach(function(p) {
        if (!p.name) return;
        var score = p.score || 0;
        if (!p.isFemale) addScore(maleScores, p.name, score);
        if (p.isFemale)  addScore(femaleScores, p.name, score);
        if (p.isNewFace) addScore(newFaceScores, p.name, score);
      });

      rankingContainer.innerHTML = '';
      rankingContainer.appendChild(buildRankTable('一般男子', maleScores));
      rankingContainer.appendChild(buildRankTable('新人', newFaceScores));
      rankingContainer.appendChild(buildRankTable('一般女子', femaleScores));
    }

    function addScore(dict, name, score) {
      dict[name] = (dict[name] || 0) + score;
    }

    function buildRankTable(title, scores) {
      var entries = Object.keys(scores).map(function(k) {
        return { name: k, score: scores[k] };
      }).sort(function(a, b) { return b.score - a.score; });

      var div = document.createElement('div');
      div.className = 'ranking-section';
      if (entries.length === 0) {
        div.innerHTML = '<h3>' + Storage.esc(title) + '</h3><p style="color:var(--text-muted)">データなし</p>';
        return div;
      }

      var rows = '';
      var rank = 1, prevScore = null;
      entries.forEach(function(e, i) {
        if (prevScore !== null && e.score !== prevScore) rank = i + 1;
        rows += '<tr><td>' + rank + '</td><td>' + Storage.esc(e.name) + '</td><td>' + Storage.esc(String(e.score)) + '</td></tr>';
        prevScore = e.score;
      });

      div.innerHTML = '<h3>' + Storage.esc(title) + '</h3>' +
        '<table class="rank-table"><tr><th>順位</th><th>選手名</th><th>得点</th></tr>' +
        rows + '</table>';
      return div;
    }
```

置換後:

```javascript
    // 大会データを読み込む
    btnLoadFromEvent.addEventListener('click', async function() {
      var eventId = rankEventSelect.value;
      if (!eventId) {
        alert('大会を選択してください。');
        return;
      }
      var data = await Api.loadRanking(eventId);
      if (!data) {
        alert('順位データの読み込みに失敗しました。');
        return;
      }
      renderRankings(data);
    });

    function renderRankings(data) {
      rankingContainer.innerHTML = '';
      CATEGORIES.forEach(function(c) {
        rankingContainer.appendChild(
          buildRankTable(c.title, (data.rankings && data.rankings[c.key]) || []));
      });
    }

    function buildRankTable(title, rows) {
      var div = document.createElement('div');
      div.className = 'ranking-section';
      if (rows.length === 0) {
        div.innerHTML = '<h3>' + Storage.esc(title) + '</h3><p style="color:var(--text-muted)">データなし</p>';
        return div;
      }
      var trs = rows.map(function(r) {
        return '<tr><td>' + Storage.esc(String(r.rank)) + '</td><td>' + Storage.esc(r.name) +
               '</td><td>' + Storage.esc(String(r.score)) + '</td></tr>';
      }).join('');
      div.innerHTML = '<h3>' + Storage.esc(title) + '</h3>' +
        '<table class="rank-table"><tr><th>順位</th><th>選手名</th><th>得点</th></tr>' +
        trs + '</table>';
      return div;
    }
```

- [ ] **Step 4: HTML ダウンロードの案内文を直す**

置換前:

```javascript
      if (!rankingContainer.querySelector('.ranking-section')) {
        alert('大会データまたはCSVを読み込んでから順位を表示してください。');
        return;
      }
```

置換後:

```javascript
      if (!rankingContainer.querySelector('.ranking-section')) {
        alert('大会データを読み込んでから順位を表示してください。');
        return;
      }
```

- [ ] **Step 5: CSV 由来のコードが残っていないことを確認する**

```bash
grep -n "parseCsvText\|rankCsvInput\|btnLoadCsv\|addScore" ranking.html
```

Expected: 何も出力されない

- [ ] **Step 6: 画面を確認する**

`http://localhost:3457/ranking.html` を開き、`javascript_tool`:

```javascript
await (async function () {
  document.getElementById('rankEventSelect').value = '<EV>';
  document.getElementById('btnLoadFromEvent').click();
  await new Promise(function (r) { setTimeout(r, 900); });
  return [[].map.call(document.querySelectorAll('.ranking-section h3'), function (h) { return h.textContent; }),
          document.querySelectorAll('.rank-table tr').length,
          !!document.getElementById('btnLoadCsv')];
})()
```

Expected: `[["一般男子","新人","一般女子"], <3表分の行数>, false]`

`read_console_messages`（`onlyErrors: true`）。Expected: エラー 0 件。

- [ ] **Step 7: コミット**

```bash
git add ranking.html
git commit -m "refactor: 順位表示をサーバーの集計結果に一本化しCSV読み込みを廃止する" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: `app.js` の二巡目生成を API 呼び出しにする

採点画面の「二巡目データ生成」を、CSV を作る実装からサーバーの生成 API に置き換える。番号規則をクライアントに二重に持たないため。**`app.js` はこの関数以外を触らない。**

**Files:**
- Modify: `app.js`

- [ ] **Step 1: `onGenNextRound` を差し替える**

置換前（`// --- 二巡目データ生成 ---` から始まる関数まるごと。現在の `app.js` を読んで、以下と一致することを確認してから置き換える）:

```javascript
  // --- 二巡目データ生成 ---
  async function onGenNextRound() {
    if (!currentEvent) { alert('大会を選択してください。'); return; }
    if (!confirm('二巡目データを生成します。よろしいですか？')) return;
    // await をまたぐので、対象の大会をここで固定する。
    // 通信中に大会を切り替えられると、別の大会の内容から生成してしまう。
    var eventId = currentEvent.id;
    // 全選手の得点順で並べるので、他コートの採点が入っていないと
    // 二巡目のシードが狂う。必ずサーバーから取り直す。
    var latest = await Api.loadEvent(eventId);
    if (!latest) { alert('最新の大会データを取得できませんでした。'); return; }
    if (!currentEvent || currentEvent.id !== eventId) return;  // 追い越された
    var all = latest.players || [];
    Outbox.applyPending(eventId, all);
    if (all.length === 0) { alert('選手データがありません。'); return; }

    // 女子→男子の順、得点の昇順でソート
    var sorted = all.slice().sort(function(a, b) {
      var gA = a.isFemale ? 1 : 0;
      var gB = b.isFemale ? 1 : 0;
      if (gB !== gA) return gB - gA; // 女子(1)が先
      return (a.score || 0) - (b.score || 0); // 得点昇順
    });

    var femaleCount = 0, maleCount = 0;
    var lines = ['選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果'];
    sorted.forEach(function(p) {
      // コートの導出は Courts に一本化する（旧実装は独自の正規表現を持ち、
      // order が空の選手を黙って A コートに割り当てていた）
      var court = Courts.courtOf(p);
      var gender = p.isFemale ? '女子' : '男子';
      var num = p.isFemale ? ++femaleCount : ++maleCount;
      var order = court + '-' + gender + '-2-' + num;
      lines.push([p.name, order, '', '', '', '0', p.isNewFace ? '○' : '', p.isFemale ? '○' : '', ''].join(','));
    });
    Storage.downloadCsv('players_二巡目.csv', lines.join('\r\n'));
  }
```

置換後:

```javascript
  // --- 二巡目データ生成 ---
  // 番号規則（コート×性別ごとに1から）はサーバーの生成 API が唯一の実装。
  // クライアントで CSV を作ると規則を二重に持つことになるので、API を呼ぶだけにする。
  // CSV が要るときは「CSVエクスポート」が二巡目を含む全件を出す。
  // 確認文言は運営画面（admin-round.js）と同じ。
  async function onGenNextRound() {
    if (!currentEvent) { alert('大会を選択してください。'); return; }
    if (!confirm('二巡目データを生成します。よろしいですか？')) return;
    // await をまたぐので、対象の大会をここで固定する。
    // 通信中に大会を切り替えられると、別の大会に生成してしまう。
    var eventId = currentEvent.id;
    var result = await Api.generateNextRound(eventId, false);
    if (!currentEvent || currentEvent.id !== eventId) return;  // 追い越された
    if (!result) { alert('二巡目の生成に失敗しました。通信を確認してください。'); return; }
    if (result.blocked) {
      var msg = result.reason === 'unscored'
        ? '未採点が' + result.unscoredCount + '名います。\n' +
          'このまま生成すると、あとから入る一巡目の得点は二巡目の並び順に反映されません。\n' +
          '生成しますか？'
        : '二巡目は生成済みです（' + result.existingCount + '名）。\n' +
          '未生成の選手がいれば差分だけ追加しますか？\n' +
          '※CSV で作った二巡目がある大会では使わないでください（重複します）。';
      if (!confirm(msg)) return;
      result = await Api.generateNextRound(eventId, true);
      if (!currentEvent || currentEvent.id !== eventId) return;  // 追い越された
      if (!result || result.blocked) {
        alert('二巡目の生成に失敗しました。通信を確認してください。');
        return;
      }
    }
    alert('二巡目を生成しました（' + result.created + '名）');
    await onEventSelect(currentEvent.id, currentCourt);
  }
```

- [ ] **Step 2: 使われなくなった参照が残っていないことを確認する**

```bash
grep -n "players_二巡目" app.js
```

Expected: 何も出力されない

```bash
grep -n "Courts\.\|Storage.downloadCsv\|Outbox\." app.js
```

Expected: `Courts.` は `refreshCourtList` / `applyCourtFilter` の箇所に残り、`Storage.downloadCsv` は `onCsvExport` の1箇所に残り、`Outbox.` は既存の箇所に残る（いずれも今回の変更で消えてはいけない）。

- [ ] **Step 3: 採点画面から二巡目を生成できることを確認する**

新しい捨て大会で確認する（`<EV>` は既に二巡目がある）。`http://localhost:3457/index.html` を開き、`javascript_tool`:

```javascript
await (async function () {
  var ev = await Api.saveEvent({ name: '計画3検証2', date: '2026-09-08', venue: '', players: [] });
  var csv = [
    '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果',
    '採点太郎,A-男子-1-1,四方,真,連,30,,,1',
    '採点花子,A-女子-1-1,四方,真,連,25,,○,1'
  ].join('\n');
  await Api.importCsv(ev.id, csv, 'replace');
  return ev.id;
})()
```

Expected: 大会 ID が返る（以降 `<EV2>`）。

`http://localhost:3457/index.html#event/<EV2>` を開いてから:

```javascript
await (async function () {
  var seen = [];
  var oc = window.confirm, oa = window.alert;
  window.confirm = function (m) { seen.push('CONFIRM:' + m); return true; };
  window.alert = function (m) { seen.push('ALERT:' + m); };
  document.getElementById('btnGenNext').click();
  await new Promise(function (r) { setTimeout(r, 1500); });
  window.confirm = oc; window.alert = oa;
  var ev = await Api.loadEvent('<EV2>');
  return [seen, ev.players.length];
})()
```

Expected: `[["CONFIRM:二巡目データを生成します。よろしいですか？", "ALERT:二巡目を生成しました（2名）"], 4]`
（全員採点済みなので 409 は出ない。CSV のダウンロードは起きない）

続けてもう一度押す:

```javascript
await (async function () {
  var seen = [];
  var oc = window.confirm;
  window.confirm = function (m) { seen.push(m); return false; };
  document.getElementById('btnGenNext').click();
  await new Promise(function (r) { setTimeout(r, 1200); });
  window.confirm = oc;
  var ev = await Api.loadEvent('<EV2>');
  return [seen.length, seen[1], ev.players.length];
})()
```

Expected: `[2, "二巡目は生成済みです（2名）。\n未生成の選手がいれば差分だけ追加しますか？\n※CSV で作った二巡目がある大会では使わないでください（重複します）。", 4]`

- [ ] **Step 4: 選手一覧に二巡目が出ることを確認する**

Step 3 の1回目のあと、画面が再読み込みされている。`javascript_tool`:

```javascript
(function () {
  document.getElementById('btnPlayerList').click();
  return document.getElementById('playerListBody').textContent.indexOf('-2-') >= 0;
})()
```

Expected: `true`（`onEventSelect` で取り直したので二巡目の行が見えている）

- [ ] **Step 5: テストが緑であることを確認する**

`http://localhost:3457/test.html` をリロードする。

Expected: `Result: 238 passed, 0 failed`

- [ ] **Step 6: コミット**

```bash
git add app.js
git commit -m "refactor: 採点画面の二巡目生成をサーバーAPIに置き換える" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: 通し確認と後片付け

運営者の1日ぶんの流れを一度通す。設計書「手動確認」の後半にあたる。

**Files:**
- Modify: なし（不具合が見つかった場合のみ、該当ファイルを直す）

- [ ] **Step 1: 375px で進行タブ・結果タブを確認する**

`resize_window` preset `mobile`。`http://localhost:3457/admin.html#round/<EV>` と `#results/<EV>` の両方で:

```javascript
[document.documentElement.scrollWidth, window.innerWidth,
 [].every.call(document.querySelectorAll('button'),
   function (b) { return b.offsetParent === null || b.getBoundingClientRect().height >= 36; })]
```

Expected: 幅が等しく、3つ目が `true`（主要な操作ボタンは 44px、行内の補助ボタンは 36px 以上）

- [ ] **Step 2: 二巡目の技を全部埋める**

`#round/<EV>` でコートチップを「全コート」→`A`→`B` と切り替え、それぞれで一覧が絞られることを目視する。技が未入力の行があれば「一巡目と同じ技をコピー」または行タップで埋める。

Expected: カウンタが `技 未入力 0` になり緑（`round-counter done`）

- [ ] **Step 3: `share.html` が60秒以内に追随することを確認する**

`tabs_create` で2つ目のタブを開き `http://localhost:3457/share.html#<TOKEN>` を表示する。運営タブ側（または `javascript_tool`）で得点を動かす:

```javascript
await (async function () {
  var ev = await Api.loadEvent('<EV>');
  var p = ev.players.filter(function (x) { return Courts.roundOf(x) === 2; })[0];
  await Api.updatePlayer('<EV>', p.id, { score: 999, result: '1' });
  return p.name;
})()
```

share タブで 60 秒待ってから（あるいは `javascript_tool` で `await Share.refresh(false)` を評価してから）:

```javascript
document.querySelector('.share-list li .share-score').textContent
```

Expected: 999 になった選手が該当部門の1位に来ている。ステータスが `HH:MM 時点` に更新されている。

- [ ] **Step 4: `present.html` の両モードを歩く**

`http://localhost:3457/present.html#<TOKEN>` で:
- 掲示モード：→ を3回押して 1/3 → 2/3 → 3/3 → 1/3 と回る。上位3名が太字
- 発表モード：部門を選び、タップのたびに下位から1人ずつ開き、最後に1位が開く。← で1人ぶん伏せ直せる。全員開いた後のタップで次の部門が伏せ字から始まる
- 「更新」で `HH:MM 時点` が変わる
- 「全画面」で全画面になる（ブラウザが許可する場合）

Expected: 上記すべてが成立し、`read_console_messages`（`onlyErrors: true`）でエラー 0 件

- [ ] **Step 5: ライト／ダークを新規3ページで確認する**

`share.html` はテーマを切り替えて（Task 5 Step 8 の手順）両方で読めること、`present.html` と `admin.html` の進行／結果タブがダークで読めることを目視する。

Expected: どのページも文字と背景のコントラストが取れており、色が抜けている箇所（変数未定義で透明・黒地に黒）が無い

- [ ] **Step 6: 捨て大会を削除する**

```javascript
await (async function () {
  return [await Api.deleteEvent('<EV>'), await Api.deleteEvent('<EV2>')];
})()
```

Expected: `[true, true]`

削除でトークンの孤児も消えることを確認する:

```javascript
await Api.loadShareLink('<TOKEN>')
```

Expected: `null`

```bash
ls server/data/links
```

Expected: 空（テストと検証で作ったトークンが残っていない）

- [ ] **Step 7: 最終確認とコミット**

```bash
git status --short
```

Expected: 何も出力されない（Task 1〜9 ですべてコミット済み）。通し確認で修正が必要になった場合はここで直し、次でコミットする。

```bash
git log --oneline -9
```

Expected: 本計画の 9 コミットが並んでいる。

修正があった場合のみ:

```bash
git add -A
git commit -m "fix: 通し確認で見つかった不具合を直す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## この計画で触らないもの（自己点検）

- `server/index.js`：**一切変更しない**（計画1 で完了している前提。作業中のサーバー再起動も不要）
- `app.js`：`onGenNextRound` **のみ**変更する。`Outbox` / `Route` / `Courts` の使い方、採点まわり、初期化には手を入れない
- `index.html`：変更しない（`btnGenNext` はそのまま。押したときの中身だけが変わる）
- `style.css`：変更しない（`body{min-width:768px}` は採点画面の意図的な制約として残す）
- `techniques.html`：変更しない（`theme.css` の追加は計画2 の担当）

---

## 完了時点のテスト件数

| 時点 | 件数 |
|---|---|
| 着手前（計画2完了） | 232 passed, 0 failed |
| Task 7 完了 | **238 passed, 0 failed** |
| Task 10 完了 | **238 passed, 0 failed** |

**この計画の完了条件は `Result: 238 passed, 0 failed`。**

---

## 設計上の決定（計画内に明記済み）

- `revealOrder` の同順位：まとめず1人ずつ、一覧の後ろから開く（司会が1人ずつ読み上げるため）。発表モードは下位が上に来るよう並びを反転して描くので、表示の上から順に開くと最後が1位になる
- 「技 未入力」の定義：3つ揃っていない行（一巡目データは常に3つ入っている）
- コートチップは大会全体のコートから作る（二巡目が未生成でもチップ列が消えないため）
- `share.js` は `storage.js` を読まない（認証タスクの無認証許可リストに入っていないため）。テーマは `localStorage` を直接読み、無ければ `prefers-color-scheme` に従う
- `present.html` は `data-theme="dark"` 固定で `theme.css` の変数を使う
