# ダッシュボードの閲覧専用（採点の面を見るだけで触れる）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ダッシュボードの閲覧専用で、採点の面の盾をやめて採点画面に閲覧モードを持たせる（一覧の選手を押して見られる・スクロール・面ごとの倍率。採点行為と運営操作だけ禁止。操作ボタンとタイマーのボタンは非表示）。

**Architecture:** app.js に `viewOnly` と `ScoringApp.setViewOnly(flag)` を足し、`body.view-only` の CSS と書き込みの入口の番で「見るだけ」を保証する。見るだけの選択は `viewPinnedId` で追いかけを止め、`Courts.viewFollowDecision` の規則で採点席が次の選手に移ったら戻る。dashboard.js は盾を desk の面だけにし、面ごとの倍率を持つ。

**Tech Stack:** 素の JS、test.html。

**設計書:** `docs/superpowers/specs/2026-10-10-dashboard-view-mode-design.md`

**実装者への注意:** いまのファイルを正とする。`git add` を使わず `git commit -m … -- <ファイル>`。`git reset` 禁止。開発サーバーは `PORT=3461 node server/index.js`（サーバーは変えないので再起動不要）。app.js の既存の規約: await の後は seq / 大会 id で判定。`embedded`・`liveOwner`・`takeOwnership`・`releaseOwnershipIfViewOnly`・`liveFollowTarget`・`applyLiveTimer` は d5a693b で入った仕組み（コメントを読む）。

---

### Task 1: 規則の純粋関数 `Courts.viewFollowDecision`

**Files:**
- Modify: `courts.js`（`liveRemaining` の近く）、公開
- Test: `test.html`（`liveRemaining` のテストの近く）

- [ ] **Step 1: 失敗するテストを書く**

```js
    assert('viewFollowDecision: 見るだけの選択が無ければ追いかける', Courts.viewFollowDecision({ pinnedId: null, pinnedLiveId: null, liveId: 'a' }), 'follow');
    assert('viewFollowDecision: 選択中で採点席が同じ選手なら固定のまま', Courts.viewFollowDecision({ pinnedId: 'x', pinnedLiveId: 'a', liveId: 'a' }), 'pinned');
    assert('viewFollowDecision: 採点席が次の選手に移ったら追いかけに戻る', Courts.viewFollowDecision({ pinnedId: 'x', pinnedLiveId: 'a', liveId: 'b' }), 'follow');
    assert('viewFollowDecision: 採点席が待機中（live 無し）になっても戻る', Courts.viewFollowDecision({ pinnedId: 'x', pinnedLiveId: 'a', liveId: null }), 'follow');
    assert('viewFollowDecision: 選択した時点で採点席が待機中（pinnedLiveId null）→ 採点席が誰かを映したら戻る',
      [Courts.viewFollowDecision({ pinnedId: 'x', pinnedLiveId: null, liveId: null }), Courts.viewFollowDecision({ pinnedId: 'x', pinnedLiveId: null, liveId: 'a' })], ['pinned', 'follow']);
```

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: 実装**

```js
  // ダッシュボードの閲覧専用の採点の面で、一覧の選手を「見るだけ」で選んだあと、採点席の選手を追いかけに戻すか
  // （設計書 2026-10-10 §2）。pinnedId … 見るだけで選んだ選手の id（無ければ null）、pinnedLiveId … 選んだ時点で
  // 採点席が映していた選手の id（待機中なら null）、liveId … いま採点席が映している選手の id（待機中なら null）。
  // 戻り値: 'follow'（追いかける）| 'pinned'（選んだ選手を出したまま）。採点席が次の選手に移った（待機中も含む）ら戻る。
  function viewFollowDecision(s) {
    if (!s || !s.pinnedId) return 'follow';
    var pinnedLive = s.pinnedLiveId || null;
    var live = s.liveId || null;
    return live === pinnedLive ? 'pinned' : 'follow';
  }
```

公開に `viewFollowDecision: viewFollowDecision,`。

- [ ] **Step 4: テストを通す** → **Step 5: Commit**

```bash
git commit -m "feat(courts): viewFollowDecision（閲覧専用の面で見るだけの選択から追いかけに戻す規則）（設計書 2026-10-10 §2）" -- courts.js test.html
```

---

### Task 2: 採点画面の閲覧モード（app.js・scoring.html・style.css）

**Files:**
- Modify: `app.js`（状態・`setViewOnly`・一覧の行クリック・`refreshFromServer`・書き込みの入口の番・帯）、`scoring.html`（帯の要素）、`style.css`（`body.view-only`）

- [ ] **Step 1: 状態と公開**

```js
  // ダッシュボードの閲覧専用の面（設計書 2026-10-10）。採点行為だけ禁止で、一覧の選手は見るだけで選べる。
  // 面として開かれた直後は親の body.dash-edit の有無で決め、以後は親が ScoringApp.setViewOnly で切り替える。
  var viewOnly = false;
  var viewPinnedId = null;       // 見るだけで選んだ選手の id（null なら採点席を追いかける）
  var viewPinnedLiveId = null;   // 選んだ時点で採点席が映していた選手の id（待機中なら null）
```

初期化（`embedded` の判定の直後）:

```js
  if (embedded) {
    try { viewOnly = !window.parent.document.body.classList.contains('dash-edit'); } catch (e) { viewOnly = false; }
  }
```

公開（app.js の末尾か、IIFE が返すオブジェクトに。無ければ `window.ScoringApp = { setViewOnly: setViewOnly };`）:

```js
  function setViewOnly(flag) {
    viewOnly = !!flag;
    if (!viewOnly) { viewPinnedId = null; viewPinnedLiveId = null; }
    document.body.classList.toggle('view-only', viewOnly);
    document.getElementById('eventSelect').disabled = viewOnly;
    courtSelect.disabled = viewOnly;
    applyScoringLock();
    renderViewBand();
    if (viewOnly) refreshFromServer();   // 閲覧に戻ったら採点席の選手を追いかけ直す
  }
  window.ScoringApp = { setViewOnly: setViewOnly };
```

`init` の最後（画面が組み上がった後）で `document.body.classList.toggle('view-only', viewOnly)` と `setViewOnly(viewOnly)` を一度呼ぶ。

- [ ] **Step 2: 書き込みの入口の番**

`viewOnly` のときは何も書かない。番を置く場所（関数の先頭に `if (viewOnly) return;`）:
- `publishLive`（既存の `releaseOwnershipIfViewOnly(); if (!liveOwner) return;` の前）
- `saveCurrentState`（採点の保存。関数名は実装を見て合わせる。Outbox に積む入口も含む）
- `onConfirm` / `onConfirmNext` / `setAllSuccess` / `setAllFail` / `onStrikeClick` / `onAdjustChange` / `onTotalAdjustChange` / `onNoteChange` / `onRecalc`
- 一覧のドラッグの開始（`gripHandle` の pointerdown。`canReorder` を `canReorder && !viewOnly` にするのが簡単）
- `takeOwnership`（閲覧モードでは持ち主にならない: `if (viewOnly) return;`）
- `startTimer` / `stopTimer` / `resetTimer` のボタン（CSS で隠すが、`applyLiveTimer` からの `startTimer()` は通す。ボタンの handler 側で `if (viewOnly) return;`）

- [ ] **Step 3: 見るだけの選択と戻る**

一覧の行クリック（`section.current` の行。2277 行付近）:

```js
      tr.addEventListener('click', function() {
        if (listClickBlocked()) return;
        var idx = parseInt(this.dataset.index, 10);
        if (viewOnly) {
          // 見るだけの選択（設計書 2026-10-10 §2）。持ち主にならず、配信も送らず、採点席が次の選手に移ったら戻る
          var p = visiblePlayers[idx];
          viewPinnedId = p ? p.id : null;
          viewPinnedLiveId = currentLiveId();
          showPlayerReadOnly(idx);
          renderViewBand();
          return;
        }
        if (idx !== currentIndex && !confirmLeave()) return;
        saveCurrentState();
        takeOwnership();
        selectPlayer(idx);
      });
```

- `currentLiveId()`: `currentEvent.live[currentCourt].playerId`（無ければ null）。
- `showPlayerReadOnly(idx)`: `currentIndex = idx; updatePlayerLabels(p); renderScoreGrid(p); updatePlayerList(); applyScoringLock();`（`selectPlayer` は `resetTimer`・`refreshFromServer`・`publishLive` を呼ぶので使わない）。
- 他のコートの一覧の行（`!section.readOnly` の分岐）は `viewOnly` なら何もしない（`changeCourt` を呼ばない）。

`refreshFromServer` の追いかけの判定（`var following = embedded && !liveOwner && !gridEdited;` の付近）:

```js
    var liveIdNow = liveFollowTarget(loaded, currentCourt);   // 一覧にいる採点席の選手（無ければ null）
    if (viewOnly && Courts.viewFollowDecision({ pinnedId: viewPinnedId, pinnedLiveId: viewPinnedLiveId, liveId: liveIdNow }) === 'follow') {
      viewPinnedId = null; viewPinnedLiveId = null;
    }
    var following = embedded && !liveOwner && !gridEdited && !viewPinnedId;
```

（`liveFollowTarget` は一覧にいない選手を null にするので、`pinnedLiveId` も同じ関数の値で取る＝`currentLiveId()` ではなく `liveFollowTarget(currentEvent, currentCourt)` を使うこと。両方を同じ規則にする。）

描き直しの後（`applyScoringLock()` の後）に `renderViewBand()`。

帯（scoring.html の `.player-nav` の直前に `<div id="viewBand" class="view-band" hidden></div>`）:

```js
  // 閲覧専用の面で、見るだけの選択をしている間だけ出す帯「採点中: 衛藤豊　04:12　▶ 戻る」
  function renderViewBand() {
    var band = document.getElementById('viewBand');
    if (!band) return;
    var liveId = embedded && currentEvent ? liveFollowTarget(currentEvent, currentCourt) : null;
    var show = viewOnly && !!viewPinnedId && liveId && liveId !== viewPinnedId;
    band.hidden = !show;
    if (!show) return;
    var p = visiblePlayers.filter(function(x) { return x.id === liveId; })[0];
    band.innerHTML = '';
    var txt = document.createElement('span');
    txt.textContent = '採点中: ' + (p ? p.name : '') + '　';
    var t = document.createElement('span');
    t.id = 'viewBandTimer';
    t.textContent = liveTimerText();   // live のタイマーの残り（applyLiveTimer と同じ計算。毎秒は timer の interval で更新）
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'view-band-back';
    back.textContent = '▶ 戻る';
    back.addEventListener('click', function() { viewPinnedId = null; viewPinnedLiveId = null; refreshFromServer(); });
    band.appendChild(txt); band.appendChild(t); band.appendChild(back);
  }
```

タイマー: 見るだけの選択の間は、採点席のタイマーを `timerDisplay` ではなく帯に出す（`timerDisplay` は見ている選手のものではないので、`body.view-pinned` で隠す）。毎秒の更新は既存の `startTimer` の interval から `viewBandTimer` も書き換える（`timerDisplay.textContent = …` の横に 1 行）。

- [ ] **Step 4: CSS（style.css）**

```css
/* ダッシュボードの閲覧専用の面（設計書 2026-10-10）。採点行為だけ禁止 */
body.view-only .action-bar button, body.view-only .timer-bar button, body.view-only #btnNotePreset, body.view-only #btnRecalc { display: none; }
body.view-only #scoreTable td[data-strike], body.view-only .adjust-input, body.view-only #totalAdjustInput, body.view-only #noteInput { pointer-events: none; }
body.view-only .player-list-table td.grip, body.view-only .player-list-table th.grip { display: none; }
.view-band { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: var(--band-bg); color: var(--band-text); font-size: 15px; }
.view-band-back { margin-left: auto; }
body.view-only.view-pinned .timer-display { display: none; }
```

変数名（`--band-bg` など）は style.css にあるものに合わせる。`body.view-pinned` は `renderViewBand` で `viewPinnedId` の有無に合わせて付け外し。

- [ ] **Step 5: ブラウザで確かめる**

systest の大会を試合開始し、採点画面（通常）で A コートの 3 人目を採点中にする。別タブで `dashboard.html#event/<id>`（閲覧専用）を開き、A の面で: 操作ボタンとタイマーのボタンが無い、一覧の 1 人目を押すと内訳が出て帯「採点中: … ▶ 戻る」が出る、○× を押しても変わらない、ネットワークに PATCH / PUT が無い、「▶ 戻る」で採点席の選手に戻る、もう一度 1 人目を押してから通常の採点画面で次の選手に移ると 10 秒以内に自動で戻る。操作可能に切り替えると今までどおり採点できる（持ち主になる）。閲覧専用で面の中のリンク（トップ・運営・技得点表・順位表示・ヘルプ・「大会の作成は運営画面で」）が押せない／見えない、順位の面（iframe）の中のリンクの行も見えない。確認後に大会を消す。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(scoring): ダッシュボードの閲覧専用の面に閲覧モード（見るだけの選択と「▶ 戻る」、操作ボタン非表示、書き込みの番）（設計書 2026-10-10 §2）" -- app.js scoring.html style.css
```

---

### Task 3: ダッシュボード（盾の範囲・面ごとの倍率）

**Files:**
- Modify: `dashboard.js`、`dashboard.css`
- Test: `test.html`（`Dashboard.paneZoomFor` が公開できれば）

- [ ] **Step 1: 盾を desk の面だけに**

`buildPane(p)` で `.pane-shield` を作るのは `p.kind === 'desk'` のときだけ。`applyMode()` で `court` の面の iframe に `setViewOnly` を伝える:

```js
    var frames = document.querySelectorAll('.dash-pane-court iframe');
    for (var j = 0; j < frames.length; j++) notifyViewOnly(frames[j], mode === 'view');
  …
  // 採点の面に閲覧／操作を伝える（同一オリジン。読み込み前なら load の後に）
  function notifyViewOnly(frame, flag) {
    function send() {
      try { var w = frame.contentWindow; if (w && w.ScoringApp) w.ScoringApp.setViewOnly(flag); } catch (e) { /* 読めない */ }
    }
    send();
    frame.addEventListener('load', send, { once: true });
  }
```

`buildPane` で iframe を作った直後にも `notifyViewOnly(iframe, mode === 'view')`（load 後に初期値を揃える）。

- [ ] **Step 2: 面ごとの倍率**

```js
  var PANE_ZOOM_KEY = 'tmg_dashboard_zoom_pane';   // { "court:A": 60, "rank": 100 }
  var PANE_ZOOM_MIN = 50, PANE_ZOOM_MAX = 125;
  var paneZoom = loadPaneZoom();
  function paneZoomFor(key, map, base) {
    var v = map && Object.prototype.hasOwnProperty.call(map, key) ? Number(map[key]) : NaN;
    if (!Number.isFinite(v)) return base;
    return Math.min(PANE_ZOOM_MAX, Math.max(PANE_ZOOM_MIN, Math.round(v / 5) * 5));
  }
```

`applyZoom()` は各 iframe の面の key（`paneKey`）で `paneZoomFor(key, paneZoom, zoom)` を使い、見出しの「75%」の表示も更新。見出しに「−」「75%」「＋」（`.dash-pane-zoom`）を × の左に置き、押すと `paneZoom[key]` を ±5 して保存・適用。「▦ 面」のメニューに「倍率をそろえる（上の縮小に合わせる）」→ `paneZoom = {}` を保存して適用。

- [ ] **Step 3: テスト**（`Dashboard.paneZoomFor` を公開して）

```js
    assert('paneZoomFor: 面ごとの指定が無ければ一括の値', Dashboard.paneZoomFor('court:A', {}, 75), 75);
    assert('paneZoomFor: 指定があればそれ（5 刻み・50〜125 に収める）',
      [Dashboard.paneZoomFor('court:A', { 'court:A': 63 }, 75), Dashboard.paneZoomFor('rank', { rank: 200 }, 75), Dashboard.paneZoomFor('desk', { desk: 'x' }, 75)], [65, 125, 75]);
```

test.html が dashboard.js を読んでいなければ、`Dashboard` の IIFE が `document.getElementById` を初期化時に触らない形（`init` は DOMContentLoaded で）であることを確かめて script を足す。難しければテストは見送り、報告する。

- [ ] **Step 4: ブラウザで確かめる**（閲覧専用で採点の面がスクロールできる、順位の面の「内訳」を押せる、運営の面は押せない、面ごとの「−／＋」が効いて再読み込み後も残る、「倍率をそろえる」で戻る）

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): 盾は運営の面だけ、採点の面に閲覧モードを伝える、面ごとの倍率（設計書 2026-10-10 §3）" -- dashboard.js dashboard.css test.html
```

---

### Task 4: ヘルプと実況資料

**Files:**
- Modify: `help.html`（ダッシュボードの節）、`docs/memo/2026-10-07-commentary-guide.html`（1. の上の帯の説明、2. の一覧の説明）

- [ ] **Step 1: help.html** のダッシュボードの節に:

```html
    <p><span class="ui">👁 閲覧専用</span> のとき、採点の面は<span class="term">見るだけで触れます</span>。選手一覧の行を押すとその選手の採点内容が出ます（採点はできません。○× や補正点は押せず、<span class="ui">形成功</span>・<span class="ui">失敗</span>・<span class="ui">確定</span>・<span class="ui">次の選手</span> とタイマーのボタンは出ません）。別の選手を見ている間は上に <span class="msg">採点中: ○○　04:12　▶ 戻る</span> の帯が出て、採点席が次の選手に移ると自動で採点中の選手に戻ります（<span class="ui">▶ 戻る</span> で手でも戻せます）。スクロールと、面の見出しの <span class="ui">−</span> <span class="ui">＋</span>（面ごとの倍率）も使えます。運営の面は閲覧専用では押せません。順位の面は内訳などを切り替えられます。</p>
```

- [ ] **Step 2: 実況資料** の該当箇所を同じ内容で更新（上の帯の説明の「触っても動かない安全な状態」を「採点はできない。選手を見ることはできる」に、2. の一覧の説明に「行を押すとその選手の内訳が出る。採点席が次に進むと自動で戻る」）。

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: ダッシュボードの閲覧専用でできること（ヘルプ・実況資料）（設計書 2026-10-10 §5）" -- help.html docs/memo/2026-10-07-commentary-guide.html
```

---

### Task 5: 全体の確認

- `npm run test:browser`（0 failed）、`npm test`。
- Opus レビュー（仕様準拠＋品質を 1 回）。特に「閲覧モードで一切書き込まない」の網羅（grep で Api の書き込み呼び出しを全部洗う）と、通常の採点画面の無変更。
- master に ff マージ、origin/master と origin/production へ push。
