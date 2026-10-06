// ダッシュボード（設計書 2026-10-05-dashboard-design.md、面の閉じる・入れ替えは 2026-10-06-dashboard-panes-design.md）。
// 採点画面（コートごと）・PC 運営の試合進行・順位表示を iframe で 1 画面に並べる。閲覧専用（盾がクリックを止め、
// ホイールだけ中へ渡す）と操作可能（盾なし）の 2 モード。各 iframe は等倍で読み込み、transform: scale で縮める。
// 面は DOM の順番ではなく絶対配置で並べる（閉じる・入れ替えで iframe を読み直さないため）。
// 依存: Api（listEvents / loadEvent）、Storage（テーマ）、Courts（listFrom / UNASSIGNED）。
var Dashboard = (function() {
  var ZOOM_KEY = 'tmg_dashboard_zoom';
  var MODE_KEY = 'tmg_dashboard_mode';
  var ZOOM_DEFAULT = 75, ZOOM_MIN = 50, ZOOM_MAX = 100, ZOOM_STEP = 5;
  // 面の仕切り（ユーザー要望 2026-10-05: 枠をリサイズでき、位置を端末に保存）。
  // layout = { row: 上段の高さ %, cols: { top1: [%], top2: [%,%], top3: [%,%,%], bottom: [%,%], bottom1: [%], bottom3: [%,%,%] … } }
  // （各配列の合計 100。キーは rowKey() が作る。下段 2 面の 'bottom' は以前からの控えとの互換）
  var LAYOUT_KEY = 'tmg_dashboard_layout';
  var ROW_DEFAULT = 60, PANE_MIN = 15, GUTTER_PX = 8;
  // 面の並びと閉じた面（ユーザー要望 2026-10-06）。panes = { top: [鍵], bottom: [鍵], hidden: [鍵] }
  var PANES_KEY = 'tmg_dashboard_panes';
  var DRAG_START_PX = 6;   // 見出しを掴んでこれだけ動いたら入れ替えのドラッグ開始（クリックと区別）
  var EDGE_RATIO = 0.25;   // 放す先の面の左右この割合の帯なら「隣に差し込む」、真ん中なら「入れ替え」

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

  // 面の鍵（並び・非表示の控えに使う。大会をまたいで同じ）: コートは court:<名>、他は kind
  function paneKey(p) { return p.kind === 'court' ? 'court:' + p.court : p.kind; }

  // 上段の列数＝コート数（0 なら 1 枚の案内）
  function columnsFor(courtCount) { return Math.max(1, courtCount | 0); }

  // 縮小率は 50〜100 の 5 刻み。範囲外・数でないものは既定の 75
  function clampZoom(v) {
    var n = Number(v);
    if (!isFinite(n) || n < ZOOM_MIN || n > ZOOM_MAX) return ZOOM_DEFAULT;
    return Math.round(n / ZOOM_STEP) * ZOOM_STEP;
  }
  function normalizeMode(v) { return v === 'edit' ? 'edit' : 'view'; }

  // --- 面の並びと非表示（純粋関数） ---

  // 文字列だけ・重複なしの配列に正す
  function cleanKeys(arr, seen) {
    var out = [];
    (Array.isArray(arr) ? arr : []).forEach(function(k) {
      if (typeof k !== 'string' || !k || seen[k]) return;
      seen[k] = true;
      out.push(k);
    });
    return out;
  }
  // 控えから読んだ生の値を正す（鍵の実在は見ない。それは arrangePanes）
  function normalizePanes(raw) {
    var s = (raw && typeof raw === 'object') ? raw : {};
    var seen = Object.create(null);
    var top = cleanKeys(s.top, seen), bottom = cleanKeys(s.bottom, seen);
    return { top: top, bottom: bottom, hidden: cleanKeys(s.hidden, Object.create(null)) };
  }
  // 控えの並びを今の大会の面（keys）に合わせる。無い鍵は落とし、控えに無い鍵は既定の段の末尾に足す。
  // hidden は今ある鍵だけ残す。壊れた控えは既定の並び
  function arrangePanes(keys, defaultTop, defaultBottom, saved) {
    var have = Object.create(null);
    (keys || []).forEach(function(k) { have[k] = true; });
    var s = normalizePanes(saved);
    var seen = Object.create(null);
    function pick(arr) {
      var out = [];
      arr.forEach(function(k) { if (have[k] && !seen[k]) { seen[k] = true; out.push(k); } });
      return out;
    }
    var top = pick(s.top), bottom = pick(s.bottom);
    top = top.concat(pick(defaultTop || []));
    bottom = bottom.concat(pick(defaultBottom || []));
    bottom = bottom.concat(pick(keys || []));   // どちらの既定にも無い鍵（念のため）は下段へ
    var hidden = s.hidden.filter(function(k) { return have[k]; });
    return { top: top, bottom: bottom, hidden: hidden };
  }
  // 面 a と b の場所を入れ替える（同じ段でも別の段でも）。片方が無ければそのまま
  function swapPanes(arr, a, b) {
    var out = { top: arr.top.slice(), bottom: arr.bottom.slice(), hidden: arr.hidden.slice() };
    function find(k) {
      var i = out.top.indexOf(k);
      if (i >= 0) return { row: 'top', i: i };
      i = out.bottom.indexOf(k);
      if (i >= 0) return { row: 'bottom', i: i };
      return null;
    }
    var pa = find(a), pb = find(b);
    if (!pa || !pb || a === b) return out;
    out[pa.row][pa.i] = b;
    out[pb.row][pb.i] = a;
    return out;
  }
  // 面 key を row の refKey の前（side 'before'）か後ろ（'after'）に差し込む（元の段からは抜く）。
  // refKey が無ければ row の末尾。key と refKey が同じ・key が無ければそのまま。横一列もこれで作れる
  function insertPane(arr, key, row, refKey, side) {
    var out = { top: arr.top.slice(), bottom: arr.bottom.slice(), hidden: arr.hidden.slice() };
    if (row !== 'top' && row !== 'bottom') return out;
    if (key === refKey) return out;
    if (out.top.indexOf(key) < 0 && out.bottom.indexOf(key) < 0) return out;
    out.top = out.top.filter(function(k) { return k !== key; });
    out.bottom = out.bottom.filter(function(k) { return k !== key; });
    var list = out[row];
    var i = refKey ? list.indexOf(refKey) : -1;
    if (i < 0) list.push(key);
    else list.splice(side === 'after' ? i + 1 : i, 0, key);
    return out;
  }
  // 全部を上段に横一列（上段の並び → 下段の並び）
  function oneRow(arr) {
    return { top: arr.top.concat(arr.bottom), bottom: [], hidden: arr.hidden.slice() };
  }
  // 幅の控えのキー。上段 top<n>。下段は 2 面なら以前からの 'bottom'、他は bottom<n>
  function rowKey(row, n) { return row === 'top' ? 'top' + n : (n === 2 ? 'bottom' : 'bottom' + n); }
  // 段の縦の位置（%）。両方あれば上段 row%・下段 100-row% で横の仕切り 1 本、片方だけなら 100%。無い段は null
  function rowGeometry(layout, topN, bottomN) {
    var both = topN > 0 && bottomN > 0;
    var row = (layout && isFinite(Number(layout.row))) ? Number(layout.row) : ROW_DEFAULT;
    return {
      top: topN > 0 ? { y: 0, h: both ? row : 100 } : null,
      bottom: bottomN > 0 ? { y: both ? row : 0, h: both ? Math.round((100 - row) * 10) / 10 : 100 } : null,
      gutters: both ? 1 : 0
    };
  }
  // 段の中の横の位置（%）。cols（合計 100）から各面の x と w
  function colGeometry(cols) {
    var x = 0;
    return cols.map(function(w) {
      var o = { x: Math.round(x * 10) / 10, w: w };
      x += w;
      return o;
    });
  }

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
      var m = key.match(/^(top|bottom)(\d*)$/);
      if (!m || (m[1] === 'top' && !m[2])) return;
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
  function loadPanes() {
    try { return normalizePanes(JSON.parse(localStorage.getItem(PANES_KEY) || 'null')); }
    catch (e) { return normalizePanes(null); }
  }
  function savePanes(p) {
    try { localStorage.setItem(PANES_KEY, JSON.stringify(normalizePanes(p))); } catch (e) {}
  }
  function loadZoom() { try { return clampZoom(localStorage.getItem(ZOOM_KEY)); } catch (e) { return ZOOM_DEFAULT; } }
  function saveZoom(z) { try { localStorage.setItem(ZOOM_KEY, String(clampZoom(z))); } catch (e) {} }
  function loadMode() { try { return normalizeMode(localStorage.getItem(MODE_KEY)); } catch (e) { return 'view'; } }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, normalizeMode(m)); } catch (e) {} }

  // --- 画面 ---
  var mode = 'view', zoom = ZOOM_DEFAULT, eventId = '', courts = [];
  var layout = { row: ROW_DEFAULT, cols: {} };
  var arr = { top: [], bottom: [], hidden: [] };   // 面の並びと閉じた面（今の大会の鍵に合わせたもの）
  var paneList = [];                               // 今の大会の面（panes() に key を足したもの。nocourt の案内も含む）
  var paneEls = Object.create(null);               // 鍵 → 面の要素（大会を選んだときに 1 回だけ作る）
  var defaults = { top: [], bottom: [] };          // 「並びを元に戻す」の既定

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
    box.setAttribute('data-key', p.key);
    var head = document.createElement('div');
    head.className = 'dash-pane-head';
    head.title = 'ドラッグして別の面と場所を入れ替えます';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.title;
    var tag = document.createElement('span');
    tag.className = 'tag';
    head.appendChild(name);
    head.appendChild(tag);
    // × で閉じる。戻すのは上の帯の「▦ 面」（ユーザー要望 2026-10-06）
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'dash-pane-close';
    close.textContent = '×';
    close.title = 'この面を閉じます（上の「▦ 面」で戻せます）';
    close.setAttribute('aria-label', p.title + ' を閉じる');
    close.addEventListener('click', function() { hidePane(p.key); });
    head.appendChild(close);
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
    enablePaneDrag(box, head, p.key);
    return box;
  }

  // コートが無い大会の案内（閉じられない・掴めない・メニューに出ない面）
  function buildNoCourtPane() {
    var box = document.createElement('div');
    box.className = 'dash-pane dash-empty';
    box.setAttribute('data-key', 'nocourt');
    box.textContent = 'コートがありません（選手登録でコートを付けてください）。';
    return box;
  }

  // 面の入れ替え・移動: 見出しを掴んで DRAG_START_PX 動いたらドラッグ。放す先は
  //   - 別の面の真ん中 → その面と入れ替え（swapPanes。金の枠）
  //   - 別の面の左右 EDGE_RATIO の帯 → その面の左／右に差し込む（insertPane。その側に金の帯）
  //   - 空いている段の帯（ドラッグ中だけ出る .dash-drop-row）→ その段へ移す（横一列・縦に戻す）
  // 仕切りと同じく、ドラッグ中は body.dash-dragging で iframe の pointer-events を切る（elementFromPoint で面が拾える）
  var DROP_CLASSES = ['dash-drop-target', 'dash-drop-before', 'dash-drop-after', 'dash-drop-row-on'];
  function enablePaneDrag(box, head, key) {
    var start = null, target = null, zones = [];
    function clearTarget() {
      if (target) DROP_CLASSES.forEach(function(c) { target.el.classList.remove(c); });
      target = null;
    }
    function setTarget(t) {
      if (target && t && target.el === t.el && target.cls === t.cls) return;
      clearTarget();
      target = t;
      if (target) target.el.classList.add(target.cls);
    }
    // 空いている段にだけ出す受け皿
    function buildZones() {
      var grid = document.getElementById('dashGrid');
      ['top', 'bottom'].forEach(function(row) {
        if (visibleKeys(row).length > 0) return;
        var z = document.createElement('div');
        z.className = 'dash-drop-row dash-drop-row-' + row;
        z.setAttribute('data-row', row);
        z.textContent = row === 'top' ? 'ここに放すと上の段へ' : 'ここに放すと下の段へ';
        grid.appendChild(z);
        zones.push(z);
      });
    }
    function removeZones() {
      zones.forEach(function(z) { if (z.parentNode) z.parentNode.removeChild(z); });
      zones = [];
    }
    head.addEventListener('pointerdown', function(e) {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('.dash-pane-close')) return;
      start = { x: e.clientX, y: e.clientY, moving: false };
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    head.addEventListener('pointermove', function(e) {
      if (!start) return;
      if (!start.moving) {
        if (Math.abs(e.clientX - start.x) < DRAG_START_PX && Math.abs(e.clientY - start.y) < DRAG_START_PX) return;
        start.moving = true;
        document.body.classList.add('dash-dragging', 'dash-swapping');
        box.classList.add('dash-drag-src');
        buildZones();
      }
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var zone = (el && el.closest) ? el.closest('.dash-drop-row') : null;
      if (zone) { setTarget({ el: zone, cls: 'dash-drop-row-on', act: 'row', row: zone.getAttribute('data-row') }); return; }
      var t = (el && el.closest) ? el.closest('.dash-pane[data-key]') : null;
      if (!t || t === box || t.getAttribute('data-key') === 'nocourt') { clearTarget(); return; }
      var rect = t.getBoundingClientRect();
      var ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      var ref = t.getAttribute('data-key');
      if (ratio < EDGE_RATIO) setTarget({ el: t, cls: 'dash-drop-before', act: 'before', ref: ref });
      else if (ratio > 1 - EDGE_RATIO) setTarget({ el: t, cls: 'dash-drop-after', act: 'after', ref: ref });
      else setTarget({ el: t, cls: 'dash-drop-target', act: 'swap', ref: ref });
    });
    function finish(commit) {
      if (!start) return;
      var moved = start.moving, t = target;
      start = null;
      clearTarget();
      removeZones();
      document.body.classList.remove('dash-dragging', 'dash-swapping');
      box.classList.remove('dash-drag-src');
      if (!commit || !moved || !t) return;
      if (t.act === 'swap') arr = swapPanes(arr, key, t.ref);
      else if (t.act === 'row') arr = insertPane(arr, key, t.row, null);
      else arr = insertPane(arr, key, rowOf(t.ref), t.ref, t.act);
      savePanes(arr);
      applyPositions();
    }
    head.addEventListener('pointerup', function() { finish(true); });
    head.addEventListener('pointercancel', function() { finish(false); });
  }
  function rowOf(key) { return arr.top.indexOf(key) >= 0 ? 'top' : 'bottom'; }
  // その段で表示中の鍵（閉じた面と、要素の無い鍵は除く）
  function visibleKeys(row) {
    var hidden = Object.create(null);
    arr.hidden.forEach(function(k) { hidden[k] = true; });
    return arr[row].filter(function(k) { return !hidden[k] && paneEls[k]; });
  }

  function hidePane(key) {
    if (arr.hidden.indexOf(key) < 0) arr.hidden.push(key);
    savePanes(arr);
    applyPositions();
  }
  function showPane(key) {
    arr.hidden = arr.hidden.filter(function(k) { return k !== key; });
    savePanes(arr);
    applyPositions();
  }

  // calc() で位置を入れる。全体から仕切りの分（px）を引いた残りに割合を掛け、手前の仕切りの分を足す
  function calcPos(pct, gutterCount, before) {
    return 'calc((100% - ' + (gutterCount * GUTTER_PX) + 'px) * ' + (pct / 100) + ' + ' + (before * GUTTER_PX) + 'px)';
  }
  function calcSize(pct, gutterCount) {
    return 'calc((100% - ' + (gutterCount * GUTTER_PX) + 'px) * ' + (pct / 100) + ')';
  }

  // 面と仕切りの位置を当てる。面の要素は動かさず style だけ変える（iframe を読み直さない）。
  // 仕切りは本数が変わるので作り直す
  function applyPositions() {
    var grid = document.getElementById('dashGrid');
    var old = grid.querySelectorAll('.dash-gutter');
    for (var i = 0; i < old.length; i++) grid.removeChild(old[i]);
    var rows = { top: visibleKeys('top'), bottom: visibleKeys('bottom') };
    Object.keys(paneEls).forEach(function(k) {
      paneEls[k].classList.toggle('hidden', rows.top.indexOf(k) < 0 && rows.bottom.indexOf(k) < 0);
    });
    var allClosed = document.getElementById('dashAllClosed');
    if (allClosed) allClosed.classList.toggle('hidden', rows.top.length + rows.bottom.length > 0);

    var geo = rowGeometry(layout, rows.top.length, rows.bottom.length);
    ['top', 'bottom'].forEach(function(row) {
      var keys = rows[row], g = geo[row];
      if (!g) return;
      var n = keys.length, key = rowKey(row, n);
      var cols = colGeometry(colsFor(layout, key, n));
      var before = (row === 'bottom') ? geo.gutters : 0;
      var top = calcPos(g.y, geo.gutters, before), height = calcSize(g.h, geo.gutters);
      keys.forEach(function(k, i) {
        var el = paneEls[k];
        el.style.left = calcPos(cols[i].x, n - 1, i);
        el.style.width = calcSize(cols[i].w, n - 1);
        el.style.top = top;
        el.style.height = height;
        if (i > 0) {
          var gv = buildGutter('v', key, n, i - 1);
          gv.style.left = calcPos(cols[i].x, n - 1, i - 1);
          gv.style.width = GUTTER_PX + 'px';
          gv.style.top = top;
          gv.style.height = height;
          grid.appendChild(gv);
        }
      });
    });
    if (geo.gutters) {
      var gh = buildGutter('h', 'row', 2, 0);
      gh.style.left = '0';
      gh.style.width = '100%';
      gh.style.top = calcPos(layout.row, 1, 0);
      gh.style.height = GUTTER_PX + 'px';
      grid.appendChild(gh);
    }
    renderPanesMenu();
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
      var rect = document.getElementById('dashGrid').getBoundingClientRect();
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
      applyPositions();
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
      applyPositions();
      saveLayout(layout);
    });
    return g;
  }

  // 「▦ 面」のメニュー: 面ごとのチェック（付いている＝表示中）、すべて表示、並びを元に戻す
  function renderPanesMenu() {
    var list = document.getElementById('dashPanesList');
    if (!list) return;
    list.innerHTML = '';
    var hidden = Object.create(null);
    arr.hidden.forEach(function(k) { hidden[k] = true; });
    var byKey = Object.create(null);
    paneList.forEach(function(p) { byKey[p.key] = p; });
    arr.top.concat(arr.bottom).forEach(function(k) {
      var p = byKey[k];
      if (!p || k === 'nocourt') return;
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !hidden[k];
      cb.addEventListener('change', function() { if (cb.checked) showPane(k); else hidePane(k); });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(p.title));
      list.appendChild(label);
    });
    var sep = document.createElement('div');
    sep.className = 'sep';
    list.appendChild(sep);
    var all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'すべて表示';
    all.disabled = arr.hidden.length === 0;
    all.addEventListener('click', function() { arr.hidden = []; savePanes(arr); applyPositions(); });
    list.appendChild(all);
    var row1 = document.createElement('button');
    row1.type = 'button';
    row1.textContent = '横一列に並べる';
    row1.title = '全部の面を上の段に横一列に並べます';
    row1.disabled = arr.bottom.length === 0;
    row1.addEventListener('click', function() { arr = oneRow(arr); savePanes(arr); applyPositions(); });
    list.appendChild(row1);
    var reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = '並びを元に戻す';
    reset.title = '既定の 2 段（上にコート、下に運営と順位）に戻し、閉じた面も出します';
    reset.addEventListener('click', function() {
      arr = arrangePanes(paneList.map(function(p) { return p.key; }), defaults.top, defaults.bottom, null);
      savePanes(arr);
      applyPositions();
    });
    list.appendChild(reset);
  }

  function renderGrid() {
    var grid = document.getElementById('dashGrid');
    grid.innerHTML = '';
    paneEls = Object.create(null);
    paneList = [];
    var menu = document.getElementById('dashPanesMenu');
    if (menu) menu.classList.toggle('hidden', !eventId);
    if (!eventId) {
      var empty = document.createElement('div');
      empty.className = 'dash-empty';
      empty.textContent = '大会を選んでください。';
      grid.appendChild(empty);
      return;
    }
    paneList = panes(eventId, courts).map(function(p) { p.key = paneKey(p); return p; });
    var courtKeys = paneList.filter(function(p) { return p.kind === 'court'; }).map(function(p) { return p.key; });
    paneList.forEach(function(p) { paneEls[p.key] = buildPane(p); });
    if (courtKeys.length === 0) {
      paneList.push({ kind: 'empty', key: 'nocourt', title: '' });
      paneEls.nocourt = buildNoCourtPane();
      courtKeys = ['nocourt'];
    }
    paneList.forEach(function(p) { grid.appendChild(paneEls[p.key]); });
    var allClosed = document.createElement('div');
    allClosed.className = 'dash-empty hidden';
    allClosed.id = 'dashAllClosed';
    allClosed.textContent = 'すべての面を閉じています。上の「▦ 面」から表示できます。';
    grid.appendChild(allClosed);

    defaults = { top: courtKeys, bottom: ['desk', 'rank'] };
    arr = arrangePanes(paneList.map(function(p) { return p.key; }), defaults.top, defaults.bottom, loadPanes());
    arr.hidden = arr.hidden.filter(function(k) { return k !== 'nocourt'; });
    applyPositions();
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

  // 「▦ 面」のメニュー（details）。外側のクリックか Esc で閉じる
  function initPanesMenu() {
    var menu = document.getElementById('dashPanesMenu');
    if (!menu) return;
    document.addEventListener('click', function(e) {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && menu.open) menu.open = false;
    });
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
    initPanesMenu();
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
    paneKey: paneKey,
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
    saveLayout: saveLayout,
    normalizePanes: normalizePanes,
    arrangePanes: arrangePanes,
    swapPanes: swapPanes,
    insertPane: insertPane,
    oneRow: oneRow,
    rowKey: rowKey,
    rowGeometry: rowGeometry,
    colGeometry: colGeometry,
    loadPanes: loadPanes,
    savePanes: savePanes
  };
})();
