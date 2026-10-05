// ダッシュボード（設計書 2026-10-05-dashboard-design.md）。採点画面（コートごと）・PC 運営の試合進行・
// 順位表示を iframe で 1 画面に並べる。閲覧専用（盾がクリックを止め、ホイールだけ中へ渡す）と
// 操作可能（盾なし）の 2 モード。各 iframe は等倍で読み込み、transform: scale で縮める。
// 依存: Api（listEvents / loadEvent）、Storage（テーマ）、Courts（listFrom / UNASSIGNED）。
var Dashboard = (function() {
  var ZOOM_KEY = 'tmg_dashboard_zoom';
  var MODE_KEY = 'tmg_dashboard_mode';
  var ZOOM_DEFAULT = 75, ZOOM_MIN = 50, ZOOM_MAX = 100, ZOOM_STEP = 5;

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
  function loadZoom() { try { return clampZoom(localStorage.getItem(ZOOM_KEY)); } catch (e) { return ZOOM_DEFAULT; } }
  function saveZoom(z) { try { localStorage.setItem(ZOOM_KEY, String(clampZoom(z))); } catch (e) {} }
  function loadMode() { try { return normalizeMode(localStorage.getItem(MODE_KEY)); } catch (e) { return 'view'; } }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, normalizeMode(m)); } catch (e) {} }

  // --- 画面 ---
  var mode = 'view', zoom = ZOOM_DEFAULT, eventId = '', courts = [];

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
    var courtPanes = list.filter(function(p) { return p.kind === 'court'; });

    var top = document.createElement('div');
    top.className = 'dash-row';
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
    saveMode: saveMode
  };
})();
