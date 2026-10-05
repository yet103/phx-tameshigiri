// ダッシュボード（設計書 2026-10-05-dashboard-design.md）。採点画面（コートごと）・PC 運営の試合進行・
// 順位表示を iframe で 1 画面に並べる。閲覧専用（盾がクリックを止め、ホイールだけ中へ渡す）と
// 操作可能（盾なし）の 2 モード。各 iframe は等倍で読み込み、transform: scale で縮める。
// 依存: Api（listEvents / loadEvent）、Storage（テーマ）、Courts（listFrom / UNASSIGNED）。
var Dashboard = (function() {
  var ZOOM_KEY = 'tmg_dashboard_zoom';
  var MODE_KEY = 'tmg_dashboard_mode';
  var ZOOM_DEFAULT = 75, ZOOM_MIN = 50, ZOOM_MAX = 100, ZOOM_STEP = 5;
  // 面の仕切り（ユーザー要望 2026-10-05: 枠をリサイズでき、位置を端末に保存）。
  // layout = { row: 上段の高さ %, cols: { top2: [%,%], top3: [%,%,%], bottom: [%,%] } }（各配列の合計 100）
  var LAYOUT_KEY = 'tmg_dashboard_layout';
  var ROW_DEFAULT = 60, PANE_MIN = 15, GUTTER_PX = 8;

  // --- 純粋関数（test.html が見る） ---

  // #event/<id> → id。他・壊れたエンコードは ''
  function parseHash(hash) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    var m = raw.match(/^event\/(.+)$/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return ''; }
  }

  // 面の一覧。コートの採点 → 運営（PC 運営の試合進行）→ 順位（順位表示）の順
  function panes(eventId, courts) {
    var id = encodeURIComponent(eventId);
    var list = (courts || []).map(function(c) {
      return { kind: 'court', court: c, title: c + ' コート', url: 'scoring.html#event/' + id + '/' + encodeURIComponent(c) };
    });
    list.push({ kind: 'desk', title: '運営', url: 'desk.html#match/' + id });
    list.push({ kind: 'rank', title: '順位', url: 'ranking.html#event/' + id });
    return list;
  }

  // 上段の列数＝コート数（0 なら 1 枚の案内）
  function columnsFor(courtCount) { return Math.max(1, courtCount | 0); }

  // 縮小率は 50〜100 の 5 刻み。範囲外・数でないものは既定の 75
  function clampZoom(v) {
    var n = Number(v);
    if (!isFinite(n) || n < ZOOM_MIN || n > ZOOM_MAX) return ZOOM_DEFAULT;
    return Math.round(n / ZOOM_STEP) * ZOOM_STEP;
  }
  function normalizeMode(v) { return v === 'edit' ? 'edit' : 'view'; }

  // --- 面の仕切り（純粋関数） ---
  function clampPct(v, lo, hi) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    return Math.min(hi, Math.max(lo, Math.round(n * 10) / 10));
  }
  function equalCols(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(Math.round(1000 / n) / 10);
    out[n - 1] = Math.round((100 - out.slice(0, -1).reduce(function(a, b) { return a + b; }, 0)) * 10) / 10;
    return out;
  }
  // 列の配列が妥当か（数が n、各 PANE_MIN 以上、合計 100 ± 0.5）
  function validCols(arr, n) {
    if (!Array.isArray(arr) || arr.length !== n) return false;
    var sum = 0;
    for (var i = 0; i < n; i++) {
      var v = Number(arr[i]);
      if (!isFinite(v) || v < PANE_MIN - 0.01) return false;
      sum += v;
    }
    return Math.abs(sum - 100) <= 0.5;
  }
  // 控えから読んだ生の値を正す。壊れた部分だけ既定に落とす
  function normalizeLayout(raw) {
    var out = { row: ROW_DEFAULT, cols: {} };
    if (!raw || typeof raw !== 'object') return out;
    var row = clampPct(raw.row, PANE_MIN, 100 - PANE_MIN);
    if (row !== null) out.row = row;
    var cols = (raw.cols && typeof raw.cols === 'object') ? raw.cols : {};
    Object.keys(cols).forEach(function(key) {
      var m = key.match(/^(top(\d+)|bottom)$/);
      if (!m) return;
      var n = m[2] ? parseInt(m[2], 10) : 2;
      if (n < 1 || n > 12) return;
      if (validCols(cols[key], n)) out.cols[key] = cols[key].map(function(v) { return Math.round(Number(v) * 10) / 10; });
    });
    return out;
  }
  // 段の列の幅（%）。控えに無い・合わない数なら等分
  function colsFor(layout, key, n) {
    var arr = layout && layout.cols && layout.cols[key];
    return validCols(arr, n) ? arr.slice() : equalCols(n);
  }
  // index 番目の仕切りを deltaPct だけ動かす（右・下の面から奪う）。各面は PANE_MIN 以上
  function dragCols(cols, index, deltaPct) {
    var out = cols.slice();
    if (index < 0 || index >= out.length - 1) return out;
    var d = Number(deltaPct) || 0;
    var maxGrow = out[index + 1] - PANE_MIN;
    var maxShrink = out[index] - PANE_MIN;
    d = Math.min(maxGrow, Math.max(-maxShrink, d));
    out[index] = Math.round((out[index] + d) * 10) / 10;
    out[index + 1] = Math.round((out[index + 1] - d) * 10) / 10;
    return out;
  }
  function dragRow(row, deltaPct) {
    return clampPct((Number(row) || ROW_DEFAULT) + (Number(deltaPct) || 0), PANE_MIN, 100 - PANE_MIN);
  }
  function loadLayout() {
    try { return normalizeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null')); }
    catch (e) { return normalizeLayout(null); }
  }
  function saveLayout(layout) {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(normalizeLayout(layout))); } catch (e) {}
  }
  function loadZoom() { try { return clampZoom(localStorage.getItem(ZOOM_KEY)); } catch (e) { return ZOOM_DEFAULT; } }
  function saveZoom(z) { try { localStorage.setItem(ZOOM_KEY, String(clampZoom(z))); } catch (e) {} }
  function loadMode() { try { return normalizeMode(localStorage.getItem(MODE_KEY)); } catch (e) { return 'view'; } }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, normalizeMode(m)); } catch (e) {} }

  // --- 画面 ---
  var mode = 'view', zoom = ZOOM_DEFAULT, eventId = '', courts = [];
  var layout = { row: ROW_DEFAULT, cols: {} };
  var topKey = 'top2';   // 上段の列の控えのキー（コート数で変わる）

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    var b = document.getElementById('btnTheme');
    if (b) b.textContent = theme === 'dark' ? '☀' : '🌙';
  }

  // モード: body.dash-edit で盾（.pane-shield）を消す。見出しの印も付け替える
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

  // iframe を等倍で読み込み、transform で縮める（中は iframe 自身がスクロール）。
  // 幅と高さを 1/z 倍にしてから z 倍に縮めると、面にぴったり収まる
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
    // 閲覧専用の盾。クリック・タップ・キーは中に届かない。ホイールだけ中へ渡す（同じオリジンなので触れる）
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

  // グリッドの行・列のテンプレートを layout から当てる（仕切りは GUTTER_PX の固定幅のトラック）
  function applyLayout() {
    var grid = document.getElementById('dashGrid');
    grid.style.gridTemplateRows = layout.row + 'fr ' + GUTTER_PX + 'px ' + (100 - layout.row) + 'fr';
    var rows = grid.querySelectorAll('.dash-row');
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].getAttribute('data-cols-key');
      var n = parseInt(rows[i].getAttribute('data-cols'), 10) || 1;
      var cols = colsFor(layout, key, n);
      rows[i].style.gridTemplateColumns = cols.map(function(c) { return c + 'fr'; }).join(' ' + GUTTER_PX + 'px ');
    }
  }

  // 仕切り。pointerdown で掴み、pointermove で layout を更新して当て直し、pointerup で保存。
  // iframe がポインターを飲まないよう、ドラッグ中は body.dash-dragging で iframe の pointer-events を切る。
  // ダブルクリックでその仕切りを既定に戻す。
  function buildGutter(kind, key, n, index) {
    var g = document.createElement('div');
    g.className = 'dash-gutter dash-gutter-' + kind;
    g.setAttribute('role', 'separator');
    g.setAttribute('aria-orientation', kind === 'h' ? 'horizontal' : 'vertical');
    g.title = 'ドラッグで大きさを変えます。ダブルクリックで元に戻します';
    var start = null;
    g.addEventListener('pointerdown', function(e) {
      if (e.button !== 0) return;
      var grid = document.getElementById('dashGrid');
      var rect = (kind === 'h' ? grid : g.parentNode).getBoundingClientRect();
      var gutters = kind === 'h' ? 1 : (n - 1);
      var track = (kind === 'h' ? rect.height : rect.width) - GUTTER_PX * gutters;
      start = { x: e.clientX, y: e.clientY, track: track, row: layout.row, cols: colsFor(layout, key, n) };
      g.setPointerCapture(e.pointerId);
      document.body.classList.add('dash-dragging');
      e.preventDefault();
    });
    g.addEventListener('pointermove', function(e) {
      if (!start) return;
      if (kind === 'h') {
        layout.row = dragRow(start.row, (e.clientY - start.y) / start.track * 100);
      } else {
        layout.cols[key] = dragCols(start.cols, index, (e.clientX - start.x) / start.track * 100);
      }
      applyLayout();
    });
    function finish() {
      if (!start) return;
      start = null;
      document.body.classList.remove('dash-dragging');
      saveLayout(layout);
    }
    g.addEventListener('pointerup', finish);
    g.addEventListener('pointercancel', finish);
    g.addEventListener('dblclick', function() {
      if (kind === 'h') layout.row = ROW_DEFAULT;
      else delete layout.cols[key];
      applyLayout();
      saveLayout(layout);
    });
    return g;
  }

  // 1 段分（面と、面の間の仕切り）
  function buildRow(paneList, key) {
    var row = document.createElement('div');
    row.className = 'dash-row';
    row.setAttribute('data-cols-key', key);
    row.setAttribute('data-cols', String(paneList.length));
    paneList.forEach(function(p, i) {
      if (i > 0) row.appendChild(buildGutter('v', key, paneList.length, i - 1));
      row.appendChild(buildPane(p));
    });
    return row;
  }

  function renderGrid() {
    var grid = document.getElementById('dashGrid');
    grid.innerHTML = '';
    grid.style.gridTemplateRows = '';
    if (!eventId) {
      var empty = document.createElement('div');
      empty.className = 'dash-empty';
      empty.style.gridRow = '1 / -1';
      empty.textContent = '大会を選んでください。';
      grid.appendChild(empty);
      return;
    }
    var list = panes(eventId, courts);
    var courtPanes = list.filter(function(p) { return p.kind === 'court'; });
    topKey = 'top' + Math.max(1, courtPanes.length);

    var top;
    if (courtPanes.length === 0) {
      top = document.createElement('div');
      top.className = 'dash-row';
      top.setAttribute('data-cols-key', topKey);
      top.setAttribute('data-cols', '1');
      var none = document.createElement('div');
      none.className = 'dash-pane dash-empty';
      none.textContent = 'コートがありません（選手登録でコートを付けてください）。';
      top.appendChild(none);
    } else {
      top = buildRow(courtPanes, topKey);
    }
    var bottom = buildRow(list.filter(function(p) { return p.kind !== 'court'; }), 'bottom');

    grid.appendChild(top);
    grid.appendChild(buildGutter('h', 'row', 2, 0));
    grid.appendChild(bottom);
    applyLayout();
    applyZoom();
    applyMode();
  }

  // 大会を読んでコートを知る（Courts.listFrom。未分類は除く）。読めなければ空
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

  // 大会の選択肢。テスト大会（test）は出さない
  async function loadEvents() {
    var sel = document.getElementById('dashEvent');
    var list = await Api.listEvents();
    var events = Array.isArray(list) ? list.filter(function(e) { return e.test !== true; }) : [];
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
    layout = loadLayout();
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

  return {
    parseHash: parseHash,
    panes: panes,
    columnsFor: columnsFor,
    clampZoom: clampZoom,
    normalizeMode: normalizeMode,
    loadZoom: loadZoom,
    saveZoom: saveZoom,
    loadMode: loadMode,
    saveMode: saveMode,
    normalizeLayout: normalizeLayout,
    colsFor: colsFor,
    dragCols: dragCols,
    dragRow: dragRow,
    loadLayout: loadLayout,
    saveLayout: saveLayout
  };
})();
