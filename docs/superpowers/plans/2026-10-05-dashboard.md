# ダッシュボード 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 採点画面（コートごと）・PC 運営の試合進行・順位表示を iframe で 1 画面に並べる `dashboard.html` を作り、閲覧専用（盾）と操作可能の 2 モードを持たせる。

**Architecture:** 新しい IIFE `Dashboard`（dashboard.js）が URL（`#event/<id>`）→ 面の一覧（純粋関数 `panes`）→ DOM を描く。各面は iframe を `transform: scale` で縮め、閲覧専用では透明な盾がクリックを止めホイールだけ `contentWindow.scrollBy` で渡す。ranking.html は `#event/<id>` で自動読み込み＋10 秒更新を足す。サーバー API は変えない。

**Tech Stack:** 素の JavaScript（ES5 流儀）、test.html のブラウザテスト、Node サーバー（static-policy の許可リストだけ）。設計書: `docs/superpowers/specs/2026-10-05-dashboard-design.md`。

**前提:** ブランチ `feature/dashboard`。開発サーバー dev-3461（新しい静的ファイルを足したら再起動。起動時に許可リストを読む）。test.html 開始 1815 passed。

---

### Task 1: ranking.html のハッシュ対応（`Ranking.parseHash`・自動読み込み・10 秒更新）

**Files:** Modify `ranking.html`（script 部分）、`test.html`

- [ ] テスト（test.html の home.js の節の後ろ、`// ---- bundle-import.js` の前）:

```javascript
    // ---- ranking.html のハッシュ（設計書 2026-10-05 dashboard §3） ----
    assert('Ranking.parseHash: #event/<id> → id', Ranking.parseHash('#event/abc'), 'abc');
    assert('Ranking.parseHash: エンコードを戻す', Ranking.parseHash('#event/a%20b'), 'a b');
    assert('Ranking.parseHash: 無し・他のハッシュ・壊れたエンコードは空',
      [Ranking.parseHash(''), Ranking.parseHash('#foo'), Ranking.parseHash('#event/'), Ranking.parseHash('#event/%E0%A4%A'), Ranking.parseHash(null)],
      ['', '', '', '', '']);
```

- [ ] ranking.html: `<script>` の中身を `var Ranking = (function(){ ... return { parseHash } })();` で包むのではなく、先頭にグローバルの小さな IIFE を置く（test.html は ranking.html を読まないので、`Ranking` を `ranking.js` に出す）。**`ranking.js` を新規**に作り、ranking.html から `<script src="ranking.js"></script>` で読む。test.html にも script タグ。static-policy の PROTECTED_FILES に `ranking.js`。

`ranking.js`:
```javascript
// 順位表示ページ（ranking.html）の URL のハッシュ。#event/<id> で大会を指定して開く
// （ダッシュボードの面。設計書 2026-10-05-dashboard-design.md §3）。他は ''。
var Ranking = (function() {
  function parseHash(hash) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    var m = raw.match(/^event\/(.+)$/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return ''; }
  }
  return { parseHash: parseHash };
})();
```

- [ ] ranking.html の script: 「大会一覧を読み込む」の後に、ハッシュがあれば select を合わせて読み込み、10 秒ごとに読み直す。ボタンの処理は `loadAndRender(id, {quiet})` に切り出す（quiet は alert の代わりに画面内の 1 行）。

```javascript
    var AUTO_REFRESH_MS = 10000;
    var autoTimer = null;
    var autoEventId = '';

    function showNote(text) {
      rankingContainer.innerHTML = '';
      var p = document.createElement('p');
      p.style.color = 'var(--text-muted)';
      p.textContent = text;
      rankingContainer.appendChild(p);
    }

    // 大会を読んで描く。quiet はダッシュボード（ハッシュ）経由: alert を出さず画面内の 1 行にする
    async function loadAndRender(eventId, quiet) {
      var data = await Api.loadRanking(eventId);
      if (!data) {
        if (quiet) showNote('順位を読み込めませんでした。' + (AUTO_REFRESH_MS / 1000) + ' 秒後にもう一度読みます。');
        else alert('順位データの読み込みに失敗しました。');
        return;
      }
      renderRankings(data);
    }

    function stopAuto() {
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = null;
      autoEventId = '';
    }

    // ハッシュの大会を自動で読み、10 秒ごとに読み直す（確定するたび順位が動く）
    function startAuto(eventId) {
      stopAuto();
      autoEventId = eventId;
      rankEventSelect.value = eventId;
      loadAndRender(eventId, true);
      autoTimer = setInterval(function() { loadAndRender(autoEventId, true); }, AUTO_REFRESH_MS);
    }

    function applyHash() {
      var id = Ranking.parseHash(location.hash);
      if (!id) { stopAuto(); return; }
      if (id !== autoEventId) startAuto(id);
    }
```

一覧の読み込みの `(async function(){...})()` の末尾（option を足した後）に `applyHash();`。`window.addEventListener('hashchange', applyHash);`。ボタンの click は:

```javascript
    btnLoadFromEvent.addEventListener('click', function() {
      var eventId = rankEventSelect.value;
      if (!eventId) { alert('大会を選択してください。'); return; }
      if (eventId !== autoEventId) stopAuto();   // ハッシュの大会と違う大会を手で読んだら自動更新は止める
      loadAndRender(eventId, false);
    });
```

- [ ] test.html に `<script src="ranking.js"></script>`（`<script src="home.js">` の後）。ranking.html の `<script src="storage.js"></script>` の後に `<script src="ranking.js"></script>`。static-policy に `'ranking.js'`。
- [ ] 開発サーバー再起動 → test.html 0 failed。`ranking.html#event/<id>` で自動表示＋10 秒更新を確認。
- [ ] Commit: `feat: 順位表示ページを #event/<id> で自動読み込み・10 秒更新できるように（ranking.js の Ranking.parseHash）`

### Task 2: dashboard.js の純粋関数とテスト

**Files:** Create `dashboard.js`、Modify `test.html`、`server/static-policy.js`

- [ ] テスト（Task 1 のテストの直後）:

```javascript
    // ---- dashboard.js（設計書 2026-10-05 dashboard §4） ----
    assert('Dashboard.parseHash', [Dashboard.parseHash('#event/abc'), Dashboard.parseHash('#event/a%20b'), Dashboard.parseHash(''), Dashboard.parseHash('#foo'), Dashboard.parseHash('#event/%E0%A4%A')],
      ['abc', 'a b', '', '', '']);
    assert('Dashboard.panes: コートの採点 → 運営 → 順位の順。ID はエンコード',
      Dashboard.panes('a b', ['A', 'B']).map(function(p) { return [p.kind, p.title, p.url]; }),
      [['court', 'A コート', 'scoring.html#event/a%20b/A'], ['court', 'B コート', 'scoring.html#event/a%20b/B'],
       ['desk', '運営', 'desk.html#match/a%20b'], ['rank', '順位', 'ranking.html#event/a%20b']]);
    assert('Dashboard.panes: コート 0 なら運営と順位だけ',
      Dashboard.panes('e1', []).map(function(p) { return p.kind; }), ['desk', 'rank']);
    assert('Dashboard.panes: コート名もエンコード', Dashboard.panes('e1', ['第 1'])[0].url, 'scoring.html#event/e1/' + encodeURIComponent('第 1'));
    assert('Dashboard.columnsFor', [Dashboard.columnsFor(0), Dashboard.columnsFor(2), Dashboard.columnsFor(3)], [1, 2, 3]);
    assert('Dashboard.clampZoom: 範囲外・NaN は 75、5 刻みに丸める', [Dashboard.clampZoom('60'), Dashboard.clampZoom('120'), Dashboard.clampZoom('x'), Dashboard.clampZoom(73), Dashboard.clampZoom(50)], [60, 75, 75, 75, 50]);
    assert('Dashboard.normalizeMode', [Dashboard.normalizeMode('edit'), Dashboard.normalizeMode('view'), Dashboard.normalizeMode('x'), Dashboard.normalizeMode(null)], ['edit', 'view', 'view', 'view']);
    try { localStorage.removeItem('tmg_dashboard_zoom'); localStorage.removeItem('tmg_dashboard_mode'); } catch (e) {}
    assert('Dashboard.loadZoom / loadMode: 控えが無ければ既定', [Dashboard.loadZoom(), Dashboard.loadMode()], [75, 'view']);
    Dashboard.saveZoom(60); Dashboard.saveMode('edit');
    assert('Dashboard.saveZoom / saveMode → load', [Dashboard.loadZoom(), Dashboard.loadMode()], [60, 'edit']);
    try { localStorage.removeItem('tmg_dashboard_zoom'); localStorage.removeItem('tmg_dashboard_mode'); } catch (e) {}
```

- [ ] `dashboard.js`（純粋関数の部分。画面は Task 3 で足す）:

```javascript
// ダッシュボード（設計書 2026-10-05-dashboard-design.md）。採点画面（コートごと）・PC 運営の試合進行・
// 順位表示を iframe で 1 画面に並べる。閲覧専用（盾がクリックを止める）と操作可能の 2 モード。
var Dashboard = (function() {
  var ZOOM_KEY = 'tmg_dashboard_zoom';
  var MODE_KEY = 'tmg_dashboard_mode';
  var ZOOM_DEFAULT = 75, ZOOM_MIN = 50, ZOOM_MAX = 100, ZOOM_STEP = 5;

  function parseHash(hash) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    var m = raw.match(/^event\/(.+)$/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return ''; }
  }

  // 面の一覧。コートの採点 → 運営 → 順位
  function panes(eventId, courts) {
    var id = encodeURIComponent(eventId);
    var list = (courts || []).map(function(c) {
      return { kind: 'court', court: c, title: c + ' コート', url: 'scoring.html#event/' + id + '/' + encodeURIComponent(c) };
    });
    list.push({ kind: 'desk', title: '運営', url: 'desk.html#match/' + id });
    list.push({ kind: 'rank', title: '順位', url: 'ranking.html#event/' + id });
    return list;
  }

  function columnsFor(courtCount) { return Math.max(1, courtCount | 0); }

  function clampZoom(v) {
    var n = Number(v);
    if (!isFinite(n) || n < ZOOM_MIN || n > ZOOM_MAX) return ZOOM_DEFAULT;
    return Math.round(n / ZOOM_STEP) * ZOOM_STEP;
  }
  function normalizeMode(v) { return v === 'edit' ? 'edit' : 'view'; }
  function loadZoom() { try { return clampZoom(localStorage.getItem(ZOOM_KEY)); } catch (e) { return ZOOM_DEFAULT; } }
  function saveZoom(z) { try { localStorage.setItem(ZOOM_KEY, String(clampZoom(z))); } catch (e) {} }
  function loadMode() { try { return normalizeMode(localStorage.getItem(MODE_KEY)); } catch (e) { return 'view'; } }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, normalizeMode(m)); } catch (e) {} }

  return { parseHash: parseHash, panes: panes, columnsFor: columnsFor, clampZoom: clampZoom,
    normalizeMode: normalizeMode, loadZoom: loadZoom, saveZoom: saveZoom, loadMode: loadMode, saveMode: saveMode };
})();
```

- [ ] test.html に `<script src="dashboard.js"></script>`、static-policy に `'dashboard.html', 'dashboard.js', 'dashboard.css'`。再起動 → 0 failed。
- [ ] Commit: `feat: dashboard.js の純粋関数（ハッシュ・面の一覧・縮小率・モードの控え）とテスト`

### Task 3: dashboard.html / dashboard.css と画面の描画

**Files:** Create `dashboard.html`、`dashboard.css`、Modify `dashboard.js`

- [ ] `dashboard.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PHX試し斬り ダッシュボード</title>
  <link rel="stylesheet" href="theme.css">
  <link rel="stylesheet" href="dashboard.css">
</head>
<body data-theme="light">
  <header class="dash-bar">
    <span class="dash-title">ダッシュボード</span>
    <select id="dashEvent" aria-label="大会"><option value="">-- 大会を選択 --</option></select>
    <button type="button" class="dash-icon" id="dashReload" title="コートと大会を読み直す">↻</button>
    <span class="dash-modes" role="group" aria-label="モード">
      <button type="button" id="dashModeView" data-mode="view">👁 閲覧専用</button>
      <button type="button" id="dashModeEdit" data-mode="edit">✎ 操作可能</button>
    </span>
    <label class="dash-zoom">縮小 <input type="range" id="dashZoom" min="50" max="100" step="5"> <span id="dashZoomVal">75%</span></label>
    <span class="spacer"></span>
    <button type="button" class="dash-icon" id="btnTheme" aria-label="テーマ切り替え">🌙</button>
    <a href="index.html" class="dash-link">トップへ</a>
  </header>
  <main class="dash-grid" id="dashGrid"></main>
  <script src="api.js"></script>
  <script src="storage.js"></script>
  <script src="courts.js"></script>
  <script src="dashboard.js"></script>
</body>
</html>
```

- [ ] `dashboard.css`（theme.css の変数を使う。暗いテーマは `[data-theme="dark"]` で変数が切り替わる）:

```css
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--sans, sans-serif); display: flex; flex-direction: column; overflow: hidden; }
.dash-bar { flex: 0 0 36px; display: flex; align-items: center; gap: 10px; padding: 0 10px; background: var(--band-bg); color: var(--band-text); font-size: 13px; }
.dash-title { font-family: var(--mincho); font-weight: bold; color: var(--gold-light); }
.dash-bar select, .dash-bar input[type="range"] { font-size: 13px; }
.dash-bar select { max-width: 260px; }
.dash-bar .spacer { flex: 1; }
.dash-modes button { font-size: 12px; padding: 3px 8px; border: 1px solid var(--band-muted); background: var(--band-bg-2); color: var(--band-text); cursor: pointer; }
.dash-modes button:first-child { border-radius: 4px 0 0 4px; }
.dash-modes button:last-child { border-radius: 0 4px 4px 0; border-left: 0; }
.dash-modes button.on { background: var(--gold); color: #1b1b1b; border-color: var(--gold); }
.dash-zoom { display: flex; align-items: center; gap: 6px; color: var(--band-muted); }
.dash-zoom input { width: 90px; }
.dash-icon { background: none; border: 0; color: var(--band-text); font-size: 15px; cursor: pointer; }
.dash-link { color: var(--band-muted); text-decoration: none; }
.dash-link:hover { color: var(--gold-light); }
.dash-grid { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: 3fr 2fr; gap: 8px; padding: 8px; }
.dash-row { display: grid; gap: 8px; min-height: 0; }
.dash-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; border: 1px solid var(--border); border-radius: 6px; background: var(--card-bg); overflow: hidden; }
.dash-pane-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 2px 8px; font-size: 12px; background: var(--bg-header); border-bottom: 1px solid var(--border); }
.dash-pane-head .name { font-weight: bold; }
.dash-pane-head .tag { margin-left: auto; font-size: 11px; color: var(--text-muted); }
.dash-pane-body { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.dash-pane-body iframe { border: 0; transform-origin: 0 0; display: block; }
.pane-shield { position: absolute; inset: 0; cursor: default; }
body.dash-edit .pane-shield { display: none; }
.dash-empty { display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 15px; }
```

- [ ] dashboard.js に画面の部分を足す（return の前。`init` は `DOMContentLoaded` で、`#dashGrid` が無ければ何もしない＝test.html で落ちない）:

```javascript
  // --- 画面 ---
  var mode = 'view', zoom = ZOOM_DEFAULT, eventId = '', courts = [], events = [];

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    var b = document.getElementById('btnTheme');
    if (b) b.textContent = theme === 'dark' ? '☀' : '🌙';
  }

  function applyMode() {
    document.body.classList.toggle('dash-edit', mode === 'edit');
    var vb = document.getElementById('dashModeView'), eb = document.getElementById('dashModeEdit');
    vb.classList.toggle('on', mode === 'view');
    eb.classList.toggle('on', mode === 'edit');
    vb.setAttribute('aria-pressed', mode === 'view' ? 'true' : 'false');
    eb.setAttribute('aria-pressed', mode === 'edit' ? 'true' : 'false');
    var tags = document.querySelectorAll('.dash-pane-head .tag');
    for (var i = 0; i < tags.length; i++) tags[i].textContent = mode === 'view' ? '閲覧専用' : '';
  }

  // iframe を等倍で読み込み、transform で縮める（中は iframe 自身がスクロール）
  function applyZoom() {
    var z = zoom / 100;
    var frames = document.querySelectorAll('.dash-pane-body iframe');
    for (var i = 0; i < frames.length; i++) {
      frames[i].style.transform = 'scale(' + z + ')';
      frames[i].style.width = (100 / z) + '%';
      frames[i].style.height = (100 / z) + '%';
    }
    document.getElementById('dashZoom').value = zoom;
    document.getElementById('dashZoomVal').textContent = zoom + '%';
  }

  function buildPane(p) {
    var box = document.createElement('div');
    box.className = 'dash-pane dash-pane-' + p.kind;
    var head = document.createElement('div');
    head.className = 'dash-pane-head';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.title;
    var tag = document.createElement('span');
    tag.className = 'tag';
    head.appendChild(name);
    head.appendChild(tag);
    box.appendChild(head);
    var body = document.createElement('div');
    body.className = 'dash-pane-body';
    var frame = document.createElement('iframe');
    frame.src = p.url;
    frame.title = p.title;
    body.appendChild(frame);
    // 閲覧専用の盾。クリック・タップ・キーは中に届かない。ホイールだけ中へ渡す（同じオリジン）
    var shield = document.createElement('div');
    shield.className = 'pane-shield';
    shield.addEventListener('wheel', function(e) {
      e.preventDefault();
      try { frame.contentWindow.scrollBy(e.deltaX, e.deltaY); } catch (err) {}
    }, { passive: false });
    body.appendChild(shield);
    box.appendChild(body);
    return box;
  }

  function renderGrid() {
    var grid = document.getElementById('dashGrid');
    grid.innerHTML = '';
    if (!eventId) {
      var empty = document.createElement('div');
      empty.className = 'dash-empty';
      empty.style.gridRow = '1 / -1';
      empty.textContent = '大会を選んでください。';
      grid.appendChild(empty);
      return;
    }
    var list = panes(eventId, courts);
    var top = document.createElement('div');
    top.className = 'dash-row';
    var courtPanes = list.filter(function(p) { return p.kind === 'court'; });
    top.style.gridTemplateColumns = 'repeat(' + columnsFor(courtPanes.length) + ', minmax(0, 1fr))';
    if (courtPanes.length === 0) {
      var none = document.createElement('div');
      none.className = 'dash-pane dash-empty';
      none.textContent = 'コートがありません（選手登録でコートを付けてください）。';
      top.appendChild(none);
    } else {
      courtPanes.forEach(function(p) { top.appendChild(buildPane(p)); });
    }
    var bottom = document.createElement('div');
    bottom.className = 'dash-row';
    bottom.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    list.filter(function(p) { return p.kind !== 'court'; }).forEach(function(p) { bottom.appendChild(buildPane(p)); });
    grid.appendChild(top);
    grid.appendChild(bottom);
    applyZoom();
    applyMode();
  }

  // 大会を読んでコートを知る（Courts.listFrom。未分類は除く）
  async function loadEventCourts(id) {
    var ev = await Api.loadEvent(id);
    var players = (ev && Array.isArray(ev.players)) ? ev.players : [];
    return Courts.listFrom(players).filter(function(c) { return c !== Courts.UNASSIGNED; });
  }

  async function selectEvent(id) {
    eventId = id || '';
    var hash = eventId ? '#event/' + encodeURIComponent(eventId) : '';
    if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
    document.getElementById('dashEvent').value = eventId;
    courts = eventId ? await loadEventCourts(eventId) : [];
    renderGrid();
  }

  async function loadEvents() {
    var sel = document.getElementById('dashEvent');
    var list = await Api.listEvents();
    events = Array.isArray(list) ? list.filter(function(e) { return e.test !== true; }) : [];
    while (sel.options.length > 1) sel.remove(1);
    events.forEach(function(e) {
      var o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.name + (e.date ? ' (' + e.date + ')' : '');
      sel.appendChild(o);
    });
    sel.value = eventId;
  }

  function init() {
    if (!document.getElementById('dashGrid')) return;   // test.html では描かない
    mode = loadMode();
    zoom = loadZoom();
    applyTheme(Storage.loadTheme());
    document.getElementById('btnTheme').addEventListener('click', function() {
      var next = Storage.loadTheme() === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });
    document.getElementById('dashModeView').addEventListener('click', function() {
      mode = 'view'; saveMode(mode); applyMode();
    });
    document.getElementById('dashModeEdit').addEventListener('click', function() {
      if (mode === 'edit') return;
      if (!confirm('操作可能にします。採点や工程表のボタンが押せるようになります。')) return;
      mode = 'edit'; saveMode(mode); applyMode();
    });
    document.getElementById('dashZoom').addEventListener('input', function() {
      zoom = clampZoom(this.value); saveZoom(zoom); applyZoom();
    });
    document.getElementById('dashEvent').addEventListener('change', function() {
      selectEvent(this.value).catch(function(e) { console.error(e); });
    });
    document.getElementById('dashReload').addEventListener('click', function() {
      loadEvents().then(function() { return selectEvent(eventId); }).catch(function(e) { console.error(e); });
    });
    window.addEventListener('hashchange', function() {
      var id = parseHash(location.hash);
      if (id !== eventId) selectEvent(id).catch(function(e) { console.error(e); });
    });
    eventId = parseHash(location.hash);
    loadEvents().then(function() { return selectEvent(eventId); }).catch(function(e) { console.error(e); });
  }
  document.addEventListener('DOMContentLoaded', init);
```

`Courts.UNASSIGNED` が公開されていなければ `'未分類'` の定数と比較する（courts.js の return を確認）。`Api.loadEvent(id)` の戻りは大会オブジェクト（null は失敗）。

- [ ] 開発サーバーで `dashboard.html#event/<id>` を 1504 × 1003 で開き、4 面が収まり本体がスクロールしないこと、閲覧専用で面を押しても中が反応せずホイールで中が動くこと、操作可能で確定が押せることを確認。
- [ ] Commit: `feat: ダッシュボード dashboard.html（採点をコートごと・運営・順位を iframe で 1 画面に。閲覧専用／操作可能、縮小率）`

### Task 4: 導線（PC 運営の試合進行・トップ）とヘルプ

**Files:** Modify `desk-match.js:87-107`、`index.html`（コート端末の行）、`help.html`

- [ ] desk-match.js の buildHead、`btnReload` の前に:

```javascript
    var btnDash = document.createElement('button');
    btnDash.type = 'button';
    btnDash.className = 'desk-btn';
    btnDash.id = 'btnMatchDashboard';
    btnDash.textContent = '📊 ダッシュボード';
    btnDash.title = '採点画面（コートごと）・試合進行・順位を 1 画面に並べて新しいタブで開きます';
    btnDash.addEventListener('click', function() {
      window.open('dashboard.html#event/' + encodeURIComponent(ctx.eventId), '_blank');
    });
    head.appendChild(btnDash);
```

- [ ] index.html の `<p class="home-links">` に `<a href="dashboard.html">ダッシュボード</a> ／` を「順位表示」の後ろに足す。
- [ ] help.html: 「順位表示ページ」の項の近く（§の一覧の `<li>`）に 1 項目:

`<li><span class="term">ダッシュボード</span>（<code>dashboard.html</code>） — 本部の PC 向け。採点画面をコートごとに、PC 運営の試合進行と順位表示を 1 画面に並べます（PC 運営の試合進行の <span class="ui">📊 ダッシュボード</span>、またはトップの「ダッシュボード」から）。上の帯で大会を選び、<span class="ui">👁 閲覧専用</span>（既定。面の中は押せず、ホイールで中を動かせます）と <span class="ui">✎ 操作可能</span>（採点・確定・工程表のボタンがそのまま使えます）を切り替えます。縮小率（50〜100%）は端末に覚えます。操作可能では、未確定のまま別の面を触っても警告は出ません。同じコートを 2 面で開かないでください。</li>`

- [ ] Commit: `feat: ダッシュボードへの導線（PC 運営の試合進行・トップ）とヘルプ`

### Task 5: 仕上げ

- [ ] test.html 0 failed、`npm test`。1504 × 1003 と 1280 × 800 でスクリーンショット。
- [ ] master へ ff マージ、`git push origin master`、production へ push。
