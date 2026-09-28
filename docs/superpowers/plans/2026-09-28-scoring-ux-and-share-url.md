# 採点画面の操作改善と閲覧専用 URL の導線 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 採点画面の操作を要望 7 件に沿って直し（次の技の行へ自動で進む・確定して移動・級位段位の表示・選手一覧のコンパクト化と備考列・前後の選手ボタンを 1 段目へ）、運営画面の「採点画面を開く」の隣に閲覧専用 URL のコピーを置く。

**Architecture:** 設計書 `docs/superpowers/specs/2026-09-28-scoring-ux-and-share-url-design.md`。データ形式・API・サーバーは変えない。トラック A（採点画面: `scoring.html` `app.js` `style.css` `help.html`）とトラック B（閲覧専用 URL: `desk-match.js` `admin-round.js` `admin.js` `admin-results.js` `admin.css`）はファイルが重ならないので並行できる。

**Tech Stack:** 素の HTML/CSS/JS（フレームワーク無し、IIFE モジュール）。テストは `test.html`（ブラウザで開く）と `npm test`（サーバー）。開発サーバーは `.claude/launch.json` の `dev-3461`（`node server/index.js`、ポート 3461）。

**運用ルール（同じ作業ツリーで並行するため）:**
- commit は必ず `git commit -m "…" -- <ファイル> <ファイル>`（pathspec）。`git add` と `git reset` は使わない。
- `index.lock` があれば数秒待って再試行。
- 自分の担当ファイル以外は触らない。
- ブラウザ検証は編集のたびに新しいタブを開く（同じ URL への再 navigate は bfcache で古い JS が動く）。
- 開発サーバーの大会「テスト大会」「横浜大会」「横浜大会2」「第10回全日本試し斬り大会」は触らない。検証用の大会は名前を「UX確認 A」のように付けて自分で作り、終わったら消す。

---

## トラック A: 採点画面

### Task A1: 形成功・失敗のあと次の技の行を選ぶ

**Files:**
- Modify: `app.js`（`setAllSuccess` / `setAllFail`、`selectRow` の近く）

- [ ] **Step 1: `advanceRow()` を `selectedRowEl()` の直後に足す**

```js
  // 形成功・失敗で行の採点が終わったら、次の技の行を選ぶ（ユーザー要望）。
  // 最後の行では動かない。入力欄へフォーカスは移さない（タブレットでキーボードが出るため）。
  function advanceRow() {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    if (selectedRow < 0 || selectedRow + 1 >= rows.length) return;
    selectRow(selectedRow + 1);
  }
```

- [ ] **Step 2: `setAllSuccess()` の末尾（`Api.addHistory(...)` の後）に `advanceRow();` を足す**

```js
    Api.addHistory(currentEvent.id, {
      action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10), strike: 'all', value: '○', detail: '形成功'
    });
    advanceRow();
  }
```

- [ ] **Step 3: `setAllFail()` の末尾（`Api.addHistory(...)` の後）にも `advanceRow();` を足す**

行に「未」が無くて早期 `return` する経路では呼ばれない（そのまま）。

- [ ] **Step 4: ブラウザで確認**

開発サーバーを開き、技が 3 つある選手で 形成功 → 2 行目が反転、もう一度 形成功 → 3 行目、もう一度 → 3 行目のまま。失敗 → 次の行。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 形成功・失敗のあと次の技の行を選ぶ" -- app.js
```

### Task A2: 未確定で移動するとき「確定して次へ」

**Files:**
- Modify: `app.js`（`confirmLeave`、`onConfirm`）

- [ ] **Step 1: `onConfirm()` の確定する側を `confirmCurrent(quiet)` に切り出す**

`onConfirm()` を次に置き換える（取り消しのトグル部分は変えない）。

```js
  function onConfirm() {
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    var p = visiblePlayers[currentIndex];
    if (!p) return;
    // 確定済みで押したら確定を取り消す（トグル。ユーザー要望）。技の有無を先に見ると、
    // 技が無い確定済みの選手をただ開いただけで無関係な警告が出るので、ここで分岐する。
    if (p.confirmed) {
      if (!confirm('確定を取り消しますか？（取り消すと点数を直せます）')) return;
      p.confirmed = false;
      gridEdited = true;
      applyConfirmedStyle(false);
      applyScoringLock();
      saveCurrentState();
      Api.addHistory(currentEvent.id, {
        action: 'unconfirm',
        playerName: p.name || '',
        detail: '確定を取り消し（' + (p.score || 0) + '点）'
      });
      return;
    }
    confirmCurrent(false);
  }

  // 表示中の選手を確定できるか（技があり、内訳が復元できている）。
  // confirmLeave はこれで「確定して移動」か「確定せずに移動」かの文言を選ぶ。
  function canConfirmCurrent() {
    if (!hasScoreRows()) return false;
    if (!gridRestorable && !gridDirty) return false;
    return true;
  }

  // 表示中の選手を確定する。確定ボタンと、未確定で移動するときの「確定して次へ」から呼ぶ。
  // quiet が true のときは理由の alert を出さない。確定できたら true。
  function confirmCurrent(quiet) {
    var p = visiblePlayers[currentIndex];
    if (!p || !currentEvent) return false;
    if (!hasScoreRows()) {
      if (!quiet) alert('技が未入力のため確定できません。');
      return false;
    }
    if (!gridRestorable && !gridDirty) {
      if (!quiet) alert('内訳を復元できない選手は、採点し直してから確定してください。');
      return false;
    }
    p.confirmed = true;
    gridEdited = true;
    applyConfirmedStyle(true);
    applyScoringLock();   // 確定済みは点数を触れない
    saveCurrentState();
    Api.addHistory(currentEvent.id, {
      action: 'confirm',
      playerName: p.name || '',
      detail: '確定（' + (p.score || 0) + '点）'
    });
    return true;
  }
```

- [ ] **Step 2: `confirmLeave()` を置き換える**

```js
  // --- 選手切り替え ---
  // 採点を入れたのに確定していない選手から離れようとしたら、一度だけ聞く（ユーザー要望）。
  // OK なら確定してから移動、キャンセルなら留まる。確定できない状態（技未入力・内訳復元不可）
  // のときだけ従来どおり「確定せずに移動」を聞く。
  // 採点できない状態や、まだ何も入れていない選手では聞かない。戻り値 true なら移動してよい。
  function confirmLeave() {
    var p = visiblePlayers[currentIndex];
    if (!p || !scoringOpenHere() || p.confirmed) return true;
    if (!gridEdited && !Courts.isScored(p)) return true;
    if (!canConfirmCurrent()) {
      return confirm('この選手の採点がまだ確定されていません。確定せずに移動しますか？');
    }
    if (!confirm('この選手の採点がまだ確定されていません。確定して次へでよいですか？')) return false;
    return confirmCurrent(true);
  }
```

- [ ] **Step 3: ブラウザで確認**

未確定で採点した選手で「次の選手 ▶」→ 確認が出る → OK → 一覧の行がグレー（確定済み）になり次の選手へ。キャンセル → 留まる。同じ選手を一覧からタップ・大会セレクト変更でも同じ文言。技が無い大会（テスト用 技リストなし雛形 など）では従来文言。

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: 未確定で移動するときは「確定して次へ」で確定してから移動する" -- app.js
```

### Task A3: 選手の帯に級位・段位

**Files:**
- Modify: `scoring.html`（`.player-nav`）、`app.js`（`updatePlayerLabels`、変数宣言）、`style.css`（`.player-nav` の節と大会トーンの節）

- [ ] **Step 1: `scoring.html` の選手ナビゲーションに rank の span を足す**

```html
  <!-- 選手ナビゲーション -->
  <div class="player-nav">
    <span class="court-label" id="courtLabel"></span>
    <div class="player-text">
      <span class="order-label" id="playerOrderLabel"></span>
      <strong id="playerNameLabel">（大会を選択してください）</strong>
      <span class="rank-label" id="playerRankLabel"></span>
    </div>
  </div>
```

- [ ] **Step 2: `app.js` の変数宣言（`playerNameLabel` の次の行）に足す**

```js
  var playerRankLabel  = document.getElementById('playerRankLabel');
```

- [ ] **Step 3: `updatePlayerLabels(p)` の `playerNameLabel.textContent = p.name || '';` の直後に足す**

```js
    // 級位・段位は名前の右に小さく（空なら :empty で消える）
    playerRankLabel.textContent = String(p.rank || '').trim();
```

- [ ] **Step 4: 大会未選択・選手なしのときも消す**

`app.js` で `playerOrderLabel.textContent = '';` としている 2 か所（`refreshCourtList` 系の 271 行付近と `clearEvent` 系の 521 行付近）に、それぞれ直後に次を足す。

```js
      playerRankLabel.textContent = '';
```

- [ ] **Step 5: `style.css` の `.player-nav .order-label` の行の直後に足す**

```css
.player-nav .rank-label { font-size: 16px; font-weight: normal; color: var(--text-muted); white-space: nowrap; }
.player-nav .rank-label:empty { display: none; }
```

大会トーンの節の `.player-nav .order-label { color: var(--band-muted); }` を次に変える。

```css
.player-nav .order-label, .player-nav .rank-label { color: var(--band-muted); }
```

- [ ] **Step 6: ブラウザで確認**

級位・段位を入れた選手（運営画面の選手登録で「級位・段位」に「初段」など）で帯に「初段」が名前の右に出る。空の選手では何も出ず、名前の右に隙間が残らない。

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: 採点画面の選手の帯に級位・段位を出す" -- scoring.html app.js style.css
```

### Task A4: 選手一覧のコンパクト化・級位段位列・備考列・選手名太字

**Files:**
- Modify: `scoring.html`（`#playerListTable` の thead）、`app.js`（`buildPlayerListRow`、`updatePlayerListScore`、`updatePlayerListConfirmed`、`onNoteChange`、新 `updatePlayerListNote`）、`style.css`（選手一覧の節）

- [ ] **Step 1: `scoring.html` の見出し行を置き換える**

```html
        <thead>
          <tr>
            <th>順番</th>
            <th>ゼッケン</th>
            <th>選手名</th>
            <th>級位・段位</th>
            <th>技1</th>
            <th>技2</th>
            <th>技3</th>
            <th>得点</th>
            <th class="note">備考</th>
          </tr>
        </thead>
```

- [ ] **Step 2: `buildPlayerListRow` の `tr.innerHTML = …` を置き換える**

```js
    tr.innerHTML =
      '<td>' + esc(p.order || '') + '</td>' +
      // 未設定は薄い「—」（数値なので esc は要らないが、列を空にはしない）
      '<td' + (hasBib ? '' : ' class="no-bib"') + '>' + (hasBib ? p.bib : '—') + '</td>' +
      '<td class="name">' + esc(p.name || '') + '</td>' +
      // 級位・段位は空なら空セル（ゼッケンと違い「—」は出さない）
      '<td>' + esc(String(p.rank || '').trim()) + '</td>' +
      '<td>' + esc(p.tech1 || '') + '</td>' +
      '<td>' + esc(p.tech2 || '') + '</td>' +
      '<td>' + esc(p.tech3 || '') + '</td>' +
      '<td class="score' + (p.confirmed ? ' confirmed' : '') + '">' + (p.score || 0) + '</td>' +
      // 備考は残り幅を吸収する列。折り返し可
      '<td class="note">' + esc(p.note || '') + '</td>';
```

- [ ] **Step 3: `updatePlayerListScore` / `updatePlayerListConfirmed` を `td.score` 指定に変え、`updatePlayerListNote` を足す**

```js
  function updatePlayerListScore(index, score) {
    if (!isPlayerListOpen()) return;
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    var cell = row ? row.querySelector('td.score') : null;
    if (cell) cell.textContent = score;
  }

  function updatePlayerListConfirmed(index, on) {
    if (!isPlayerListOpen()) return;
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    if (row) {
      row.classList.toggle('done', on);
      var cell = row.querySelector('td.score');
      if (cell) cell.classList.toggle('confirmed', on);
    }
  }

  // 備考を変えたとき（手入力・文例）に一覧の備考セルを書き換える
  function updatePlayerListNote(index, note) {
    if (!isPlayerListOpen()) return;
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    var cell = row ? row.querySelector('td.note') : null;
    if (cell) cell.textContent = note || '';
  }
```

- [ ] **Step 4: `onNoteChange()` の末尾で一覧を更新する**

```js
  function onNoteChange() {
    if (!currentEvent) return;
    var p = visiblePlayers[currentIndex];
    if (!p) return;
    p.note = noteInput.value.trim().slice(0, 200);
    Outbox.enqueue({ eventId: currentEvent.id, playerId: p.id, note: p.note });
    updatePlayerListNote(currentIndex, p.note);
  }
```

- [ ] **Step 5: `style.css` の選手一覧の節を置き換える**

`/* ===== 選手一覧（ページ下部・開閉） ===== */` から `.player-list-table tr.current-player td:last-child { … }` までを次に置き換える。

```css
/* ===== 選手一覧（ページ下部・開閉） =====
   上下の余白を詰め、備考以外の列は文字が収まる幅（width:1% + nowrap）。
   備考の列が残り幅を吸収する（ユーザー要望）。 */
.player-list-section { border-top: 2px solid var(--border); }
.player-list-toggle {
  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px;
  padding: 0 12px; text-align: left; font-weight: bold; font-size: 14px;
  background: var(--bg-header); color: var(--text); border-radius: 0;
}
.player-list-section.closed .player-list-body { display: none; }
.player-list-body { overflow: auto; max-height: 50vh; }
.player-list-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.player-list-table th {
  background: var(--bg-header);
  border: 1px solid var(--border);
  padding: 3px 6px;
  text-align: center;
  white-space: nowrap;
  width: 1%;
  position: sticky;
  top: 0;
  z-index: 1;
}
.player-list-table td {
  border: 1px solid var(--border);
  padding: 2px 6px;
  line-height: 1.3;
  cursor: pointer;
  white-space: nowrap;
  width: 1%;
  text-align: center;
}
.player-list-table td.name { font-weight: bold; }
.player-list-table td.score {
  font-weight: bold;
  color: var(--score-color);
}
.player-list-table td.confirmed { color: var(--score-confirmed); }
/* 備考の列は残り幅を吸収し、長ければ折り返す */
.player-list-table th.note, .player-list-table td.note {
  width: auto;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
/* ゼッケンが未設定の行（「—」）。入っている行と見分けられるように薄くする。
   選択中の行は .player-list-table tr.current-player td のほうが詳細度が高いので、
   反転した文字色が勝つ（薄いまま読めなくなることはない）。 */
.player-list-table td.no-bib { color: var(--text-muted); }
.player-list-table tr:hover td { opacity: 0.75; }
/* 確定済みの行はグレー。選択中の行（下の .current-player）のほうが後にあるので勝つ */
.player-list-table tr.done td { background: var(--cell-disabled); color: var(--text-muted); }
.player-list-table tr.current-player td {
  background: var(--accent);
  color: var(--accent-text);
}
.player-list-table tr.current-player td.score {
  color: var(--accent-text);
}
```

- [ ] **Step 6: `style.css` を検索して `td:last-child` の残りが無いか確認**

```bash
grep -n "player-list-table td:last-child" style.css
```
Expected: 出力なし。

- [ ] **Step 7: ブラウザで確認**

一覧の行が低く（約 24px）、選手名が太字、級位・段位列と備考列が出る。備考を入力（または「文例」で追記）→ 一覧の備考セルが変わる。確定 → 得点セルが青、行がグレー。選択行は反転して得点も反転色。スマホ幅（375px）で横スクロールになるだけで崩れない。

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: 採点画面の選手一覧をコンパクトにし、級位・段位と備考の列を足す" -- scoring.html app.js style.css
```

### Task A5: 前後の選手ボタンを 1 段目（タイマーの列）へ

**Files:**
- Modify: `scoring.html`（`.action-block`）、`style.css`（`.action-bar .nav-btn`、ロック時の `[disabled]`、大会トーンの節）

- [ ] **Step 1: `scoring.html` の `.action-block` を置き換える**

```html
  <!-- 前後の選手・タイマー・採点操作をひとつの区画にまとめる -->
  <div class="action-block">
    <!-- 1段目: 前の選手 ｜ タイマー ｜ 次の選手（ユーザー要望） -->
    <div class="timer-bar">
      <button class="nav-btn" id="btnPrev">◀ 前の選手</button>
      <button id="btnTimerStart">▶ 開始</button>
      <button id="btnTimerStop">■ 停止</button>
      <button id="btnTimerReset">↺ リセット</button>
      <div class="timer-display" id="timerDisplay">05:00</div>
      <button class="nav-btn" id="btnNext">次の選手 ▶</button>
    </div>

    <!-- 2段目: 形成功・失敗・確定（右端に合計） -->
    <div class="action-bar">
      <button class="btn-success" id="btnAllSuccess">形成功</button>
      <button class="btn-fail"    id="btnAllFail">失敗</button>
      <button class="btn-confirm" id="btnConfirm">確定</button>
      <div class="total-score" id="totalScoreDisplay"><span class="total-label">合計</span><span class="total-value" id="totalScoreBox"><span id="totalScoreValue">0</span><span class="total-unit">点</span></span></div>
    </div>
  </div>
```

- [ ] **Step 2: `style.css` の `.action-bar .nav-btn` を `.action-block .nav-btn` に変える（2 か所）**

レイアウトの節:
```css
/* コート端末は指で操作するので、押せるものはすべて 44px 以上にする。
   前後の選手は 1 段目（タイマーの列）に置く（.timer-bar button より後ろで詳細度も高いので勝つ） */
.action-block .nav-btn {
  background: var(--accent);
  color: var(--accent-text);
  padding: 6px 16px;
  white-space: nowrap;
  min-height: 44px;
}
```

大会トーンの節:
```css
.action-block .nav-btn { background: var(--band-bg-2); color: var(--gold-light); border: 1px solid var(--gold); }
```

- [ ] **Step 3: ロック時の薄さを区画全体に広げる**

```css
body.scoring-locked .action-block button[disabled] { opacity: 0.45; }
```
```css
body.score-frozen .action-block button[disabled] { opacity: 0.45; }
```
（元の `.action-bar button[disabled]` の 2 行を置き換える）

- [ ] **Step 4: `.timer-display` の `margin-left: auto` はそのまま**

「次の選手 ▶」はその右（右端）に並ぶ。狭い幅で折り返してよい。

- [ ] **Step 5: ブラウザで確認**

1 段目が「◀ 前の選手 ▶ 開始 ■ 停止 ↺ リセット 05:00 次の選手 ▶」、2 段目が「形成功 失敗 確定 … 合計」。前後の選手が動く。準備中の大会（ロック中）で形成功・失敗・確定が薄くなり、前後の選手は押せる。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: 前後の選手ボタンをタイマーの列に並べる" -- scoring.html style.css
```

### Task A6: ヘルプの文言

**Files:**
- Modify: `help.html`（採点画面の見方 ②⑤⑦、図の alt）

- [ ] **Step 1: 図の alt を直す**

```html
      <img src="help/img/scoring_tablet.png" loading="lazy" alt="タブレットで開いた採点画面。上から、大会とコートの選択バー、コートバッジを左端に置いた選手の帯（中央に順番と名前、右に級位・段位）、採点表、全体補正点と備考、前の選手・タイマー・次の選手を 1 段目に、形成功・失敗・確定を 2 段目にまとめた操作区画（右端に合計）、ツールバー、下部の選手一覧。">
```

- [ ] **Step 2: ② の文を直す**

```html
          <li>②選手の帯 — <span class="term">コートのバッジは帯の左端に小さく</span>付きます。中央に「男子 1巡目 1番」のような<span class="term">順番と選手名が並んで</span>出て、級位・段位が登録されていれば名前の右に小さく出ます。前後の選手へのボタンはこの帯には無く、⑤の操作区画にあります。</li>
```

- [ ] **Step 3: ⑤ の文を直す**

```html
          <li>⑤操作区画 — <span class="term">1段目が</span> <span class="ui">◀ 前の選手</span> とタイマー（<span class="ui">▶ 開始</span> <span class="ui">■ 停止</span> <span class="ui">↺ リセット</span>。5分から0へ向かって数え、選手を切り替えると自動で <span class="ui">05:00</span> に戻ります）、右端に <span class="ui">次の選手 ▶</span>。<span class="term">2段目が</span> <span class="ui">形成功</span> <span class="ui">失敗</span> <span class="ui">確定</span>（右端に <span class="ui">合計</span>）です。<span class="ui">形成功</span> <span class="ui">失敗</span> はどちらも選択中の行にだけ効きます。<span class="ui">形成功</span> は打つ太刀を全部「成功」に、<span class="ui">失敗</span> は最初の「未」のセルだけを「失敗」にします（すでに成功・失敗のセルは変えません）。どちらも押すと<span class="term">次の技の行が自動で選ばれる</span>ので、続けて押していけば 3 つの技を採点できます。<span class="ui">確定</span> を押すと <span class="ui">確定済み</span> になり、得点と合計が青くなります。得点に関わる編集をすると、自動で確定が外れます。確定せずに <span class="ui">次の選手 ▶</span> などで移ろうとすると <span class="msg">この選手の採点がまだ確定されていません。確定して次へでよいですか？</span> と聞かれ、OK で確定してから移ります（キャンセルでその選手に留まります）。技が入っていないなど確定できない選手では <span class="msg">確定せずに移動しますか？</span> と聞かれます。</li>
```

- [ ] **Step 4: ⑦ の文を直す**

```html
          <li>⑦選手一覧 — 順番・<span class="ui">ゼッケン</span>・選手名・級位・段位・技1〜3・得点・備考の表です。行をタップするとその選手に切り替わります。見出しの <span class="ui">▾ 選手一覧</span> で開閉できます。</li>
```

- [ ] **Step 5: Commit**

```bash
git commit -m "docs: ヘルプの採点画面の説明を操作区画の並び替え・級位段位・備考列に合わせる" -- help.html
```

---

## トラック B: 閲覧専用 URL を採点画面リンクの隣に

### Task B1: PC 運営の試合進行カードに「閲覧専用 URL をコピー」

**Files:**
- Modify: `desk-match.js`（コートカードの `actions`）

- [ ] **Step 1: `btnCopy` のラベルを変え、閲覧専用のボタンを足す**

`desk-match.js` の `var btnCopy = …` から `actions.appendChild(btnCopy);` までを次に置き換える。

```js
    var btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'desk-btn';
    btnCopy.textContent = '採点 URL をコピー';
    btnCopy.addEventListener('click', function() {
      // コートの端末にメッセージで送れるよう、相対ではなく絶対 URL にする
      var url = new URL(Desk.scoringHref(ctx.eventId, row.court), location.href).href;
      Desk.copyText(url, row.court + ' コートの採点画面の URL をコピーしました');
    });
    actions.appendChild(btnCopy);

    // 閲覧専用 URL（共有リンク share.html#<token>）。採点画面の URL と並べて取れるようにする（ユーザー要望）。
    // 大会で 1 つなのでどのコートのカードから押しても同じ URL。トークンは冪等（Api.createShareLink）。
    var btnShare = document.createElement('button');
    btnShare.type = 'button';
    btnShare.className = 'desk-btn';
    btnShare.textContent = '閲覧専用 URL をコピー';
    btnShare.addEventListener('click', function() {
      copyShareUrl(btnShare, ctx);
    });
    actions.appendChild(btnShare);
```

- [ ] **Step 2: `copyShareUrl` をモジュール内（`buildCourtCard` 系の関数の直後）に足す**

```js
  // 閲覧専用 URL（共有リンク）をクリップボードへ。desk-results.js の onCopyShare と同じ作法。
  async function copyShareUrl(btn, ctx) {
    btn.disabled = true;
    try {
      var link = await Api.createShareLink(ctx.eventId);
      if (ctx.isStale()) return;   // 画面を離れていたら alert も出さない
      if (!link || !link.token) {
        alert('共有リンクを作成できませんでした。通信を確認してください。');
        return;
      }
      await Desk.copyText(new URL('share.html#' + link.token, location.href).href,
        '閲覧専用 URL（共有リンク）をコピーしました');
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }
```

- [ ] **Step 3: ブラウザで確認**

`desk.html#match/<大会ID>` を開き、コートカードに 3 つのボタン。「閲覧専用 URL をコピー」→ トースト → 貼り付けた URL（`share.html#…`）を新しいタブで開くと順位の共有ページが出る。結果確認の「🔗 共有リンクをコピー」と同じ URL。

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: PC 運営の試合進行カードに閲覧専用 URL のコピーを置く" -- desk-match.js
```

### Task B2: スマホ運営のコピー処理を `Admin.copyText` に共通化

**Files:**
- Modify: `admin.js`（`toast` の直後に `copyText`、公開）、`admin-results.js`（`onCopy`）

- [ ] **Step 1: `admin.js` の `toast` の直後に足す**

```js
  // URL などをクリップボードへ写す。結果確認タブ（共有リンク）と試合進行タブ（閲覧専用 URL）が使う。
  // navigator.clipboard は HTTPS か localhost でしか使えず、権限が無い環境もあるので、
  // 失敗したら prompt に落として手で写せるようにする（PC 運営の Desk.copyText と同じ作法）。
  // 戻り値: クリップボードに入ったら true、prompt に落ちたら false。
  async function copyText(text, okMessage) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        toast(okMessage || 'コピーしました');
        return true;
      } catch (e) {
        // 権限が無い・HTTPS でない等。下の prompt に落とす
      }
    }
    window.prompt('このURLをコピーしてください', text);
    return false;
  }
```

- [ ] **Step 2: `admin.js` の公開オブジェクトに足す**

```js
    toast: toast,
    copyText: copyText,
```

- [ ] **Step 3: `admin-results.js` の `onCopy` を置き換える**

```js
  async function onCopy() {
    var eventId = Admin.currentEventId();
    if (!eventId) {
      alert('大会を選んでください。');
      return;
    }
    var btn = this;
    btn.disabled = true;
    try {
      var token = await shareToken(eventId);
      if (!token) return;
      await Admin.copyText(new URL('share.html#' + token, location.href).href, 'リンクをコピーしました');
    } finally {
      btn.disabled = false;
    }
  }
```

- [ ] **Step 4: ブラウザで確認**

`admin.html#results/<大会ID>` の「共有リンクをコピー」が従来どおり動く（トースト「リンクをコピーしました」）。

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: スマホ運営のクリップボード処理を Admin.copyText に共通化" -- admin.js admin-results.js
```

### Task B3: スマホ運営の試合進行タブに「閲覧専用 URL」

**Files:**
- Modify: `admin-round.js`（見出し `head`）、`admin.css`（`.round-open` の隣）

- [ ] **Step 1: `admin-round.js` の見出しで `openBtn` の直後にボタンを足す**

`head.appendChild(openBtn);` の直後に次を入れる。

```js
    // 閲覧専用 URL（共有リンク share.html#<token>）。採点画面へのリンクと並べて取れるようにする
    // （ユーザー要望）。処理は結果確認タブの「共有リンクをコピー」と同じ（トークンは冪等）。
    var shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'round-open round-share';
    shareBtn.id = 'btnRoundShare';
    shareBtn.textContent = '閲覧専用 URL';
    shareBtn.addEventListener('click', function() {
      copyShareUrl(shareBtn, ctx);
    });
    head.appendChild(shareBtn);
```

- [ ] **Step 2: `copyShareUrl` を `AdminRound` モジュール内（`roundOne` の前）に足す**

```js
  // 閲覧専用 URL（共有リンク）をクリップボードへ。admin-results.js の onCopy と同じ作法。
  async function copyShareUrl(btn, ctx) {
    btn.disabled = true;
    try {
      var link = await Api.createShareLink(ctx.eventId);
      if (ctx.isStale()) return;   // 通信中に大会やタブを切り替えられた
      if (!link || !link.token) {
        alert('共有リンクを作成できませんでした。通信を確認してください。');
        return;
      }
      await Admin.copyText(new URL('share.html#' + link.token, location.href).href,
        '閲覧専用 URL（共有リンク）をコピーしました');
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }
```

- [ ] **Step 3: `admin.css` の `.round-open` の直後に足す**

```css
/* 閲覧専用 URL のボタン。リンク（.round-open）と同じ見た目で、button のリセットを打ち消す */
button.round-share { cursor: pointer; font-family: inherit; }
button.round-share[disabled] { opacity: 0.45; }
```

- [ ] **Step 4: ブラウザで確認**

`admin.html#round/<大会ID>` の見出しに「採点画面へ」「閲覧専用 URL」「⋯」が並ぶ。「閲覧専用 URL」→ トースト → URL が `share.html#…`。375px 幅で 2 行目に折り返して収まる。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: スマホ運営の試合進行タブに閲覧専用 URL のコピーを置く" -- admin-round.js admin.css
```

---

## 統合後（指揮官）

- [ ] `help.html` の「採点画面を開く」の節に、PC 運営のカードとスマホ運営の見出しに `閲覧専用 URL をコピー` があり §4 の共有リンクと同じ URL である旨を足す。
- [ ] `test.html` を開いて全件 passed、`npm test` が通ることを確認。
- [ ] Opus レビュー（仕様準拠＋品質を 1 回）→ 指摘は実装者へ戻す。
- [ ] master へ ff マージ。
