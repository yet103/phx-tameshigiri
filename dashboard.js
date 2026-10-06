// ダッシュボード（設計書 2026-10-05-dashboard-design.md、面の閉じる・入れ替えは 2026-10-06-dashboard-panes-design.md）。
// 採点画面（コートごと）・PC 運営の試合進行・順位表示を iframe で 1 画面に並べる。閲覧専用（盾がクリックを止め、
// ホイールだけ中へ渡す）と操作可能（盾なし）の 2 モード。各 iframe は等倍で読み込み、transform: scale で縮める。
// 面の並びは「段 → 列 → 列の中に縦に積んだ面」の 3 層（段はいくつでも、列の中に何面でも積める）で持ち、
// DOM の順番ではなく絶対配置で並べる（閉じる・入れ替えで iframe を読み直さないため）。
// 依存: Api（listEvents / loadEvent）、Storage（テーマ）、Courts（listFrom / UNASSIGNED）。
var Dashboard = (function() {
  var ZOOM_KEY = 'tmg_dashboard_zoom';
  var MODE_KEY = 'tmg_dashboard_mode';
  var ZOOM_DEFAULT = 75, ZOOM_MIN = 50, ZOOM_MAX = 100, ZOOM_STEP = 5;
  // 面の仕切り（ユーザー要望 2026-10-05: 枠をリサイズでき、位置を端末に保存）。
  // layout = { row: 2 段のときの上段の高さ %（以前からの控え）,
  //            cols: { top<n> | bottom | bottom<n> | row<段>_<n>: [%...]（段ごとの列の幅）,
  //                    stk<段>_<列>_<n>: [%...]（列の中に積んだ面の高さ） },
  //            rows: { rows<段の数>: [%...]（段の高さ） } }（各配列の合計 100。キーは rowKey() / stackKey()）
  var LAYOUT_KEY = 'tmg_dashboard_layout';
  var ROW_DEFAULT = 60, PANE_MIN = 15, GUTTER_PX = 8, MAX_ROWS = 6;
  // 面の並びと閉じた面（ユーザー要望 2026-10-06）。
  // panes = { rows: [段, …], hidden: [鍵, …] }、段 = [列, …]、列 = [鍵, …]（上から順に縦に積む）
  // （以前の { top, bottom } と、列が鍵の文字列だけの控えも読める）
  var PANES_KEY = 'tmg_dashboard_panes';
  var DRAG_START_PX = 6;   // 見出しを掴んでこれだけ動いたら入れ替えのドラッグ開始（クリックと区別）
  var EDGE_RATIO = 0.25;   // 放す先の面の端この割合の帯なら「隣に差し込む／上下に積む」、真ん中なら「入れ替え」

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

  // 文字列だけ・重複なし（seen をまたいで）の配列に正す
  function cleanKeys(arr, seen) {
    var out = [];
    (Array.isArray(arr) ? arr : []).forEach(function(k) {
      if (typeof k !== 'string' || !k || seen[k]) return;
      seen[k] = true;
      out.push(k);
    });
    return out;
  }
  // 空の列・空の段を消す
  function pruneRows(rows) {
    return rows.map(function(row) { return row.filter(function(cell) { return cell.length > 0; }); })
      .filter(function(row) { return row.length > 0; });
  }
  function copyArr(arr) {
    return { rows: arr.rows.map(function(row) { return row.map(function(cell) { return cell.slice(); }); }), hidden: arr.hidden.slice() };
  }
  // 控えから読んだ生の値を正す（鍵の実在は見ない。それは arrangePanes）。
  // 以前の { top, bottom } は 2 段として、列が鍵の文字列だけなら 1 面の列として読む
  function normalizePanes(raw) {
    var s = (raw && typeof raw === 'object') ? raw : {};
    var seen = Object.create(null);
    var src = Array.isArray(s.rows) ? s.rows : [s.top, s.bottom];
    var rows = src.map(function(row) {
      if (!Array.isArray(row)) return [];
      return row.map(function(cell) { return cleanKeys(Array.isArray(cell) ? cell : [cell], seen); });
    });
    return { rows: pruneRows(rows), hidden: cleanKeys(s.hidden, Object.create(null)) };
  }
  // 控えの並びを今の大会の面（keys）に合わせる。無い鍵は落とし、控えに無い鍵は既定の段（defaultRows[i]。鍵の配列）の
  // 末尾に 1 面の列として足す（その段が無ければ段ごと足す）。どの既定にも無い鍵は最後の段へ。hidden は今ある鍵だけ残す
  function arrangePanes(keys, defaultRows, saved) {
    var have = Object.create(null);
    (keys || []).forEach(function(k) { have[k] = true; });
    var s = normalizePanes(saved);
    var seen = Object.create(null);
    function pick(arr) {
      var out = [];
      (arr || []).forEach(function(k) { if (have[k] && !seen[k]) { seen[k] = true; out.push(k); } });
      return out;
    }
    function cellsOf(list) { return list.map(function(k) { return [k]; }); }
    var rows = s.rows.map(function(row) { return row.map(pick); });
    (defaultRows || []).forEach(function(def, i) {
      var extra = pick(def);
      if (!extra.length) return;
      if (rows[i]) rows[i] = rows[i].concat(cellsOf(extra));
      else rows.push(cellsOf(extra));
    });
    var rest = pick(keys || []);
    if (rest.length) {
      if (rows.length) rows[rows.length - 1] = rows[rows.length - 1].concat(cellsOf(rest));
      else rows.push(cellsOf(rest));
    }
    return { rows: pruneRows(rows), hidden: s.hidden.filter(function(k) { return have[k]; }) };
  }
  // 鍵の場所 { r: 段, c: 列, i: 列の中の位置 }。無ければ null
  function findPane(rows, key) {
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        var i = rows[r][c].indexOf(key);
        if (i >= 0) return { r: r, c: c, i: i };
      }
    }
    return null;
  }
  // 鍵を抜く（空の列・段はまだ消さない。段・列の番号を保つため）
  function withoutKey(rows, key) {
    return rows.map(function(row) { return row.map(function(cell) { return cell.filter(function(k) { return k !== key; }); }); });
  }
  function allKeys(arr) {
    var out = [];
    arr.rows.forEach(function(row) { row.forEach(function(cell) { out = out.concat(cell); }); });
    return out;
  }
  // 面 a と b の場所を入れ替える（どこにあっても）。片方が無ければそのまま
  function swapPanes(arr, a, b) {
    var out = copyArr(arr);
    var pa = findPane(out.rows, a), pb = findPane(out.rows, b);
    if (!pa || !pb || a === b) return out;
    out.rows[pa.r][pa.c][pa.i] = b;
    out.rows[pb.r][pb.c][pb.i] = a;
    return out;
  }
  // 面 key を、段 rowIndex の refKey がある列の左（side 'before'）か右（'after'）に、1 面の列として差し込む
  // （元の場所からは抜く）。refKey が無ければ段の右端。key と refKey が同じ・key が無い・段が無ければそのまま
  function insertPane(arr, key, rowIndex, refKey, side) {
    var out = copyArr(arr);
    if (key === refKey || !findPane(out.rows, key) || !out.rows[rowIndex]) return out;
    out.rows = withoutKey(out.rows, key);
    var row = out.rows[rowIndex];
    var ci = -1;
    if (refKey) row.forEach(function(cell, c) { if (cell.indexOf(refKey) >= 0) ci = c; });
    if (ci < 0) row.push([key]);
    else row.splice(side === 'after' ? ci + 1 : ci, 0, [key]);
    out.rows = pruneRows(out.rows);
    return out;
  }
  // 面 key を refKey と同じ列の、refKey のすぐ上（where 'above'）か下（'below'）に積む（元の場所からは抜く）
  function stackPane(arr, key, refKey, where) {
    var out = copyArr(arr);
    if (key === refKey || !findPane(out.rows, key) || !findPane(out.rows, refKey)) return out;
    out.rows = withoutKey(out.rows, key);
    var f = findPane(out.rows, refKey);
    out.rows[f.r][f.c].splice(where === 'below' ? f.i + 1 : f.i, 0, key);
    out.rows = pruneRows(out.rows);
    return out;
  }
  // 面 key だけの新しい段を、段 rowIndex の上（where 'above'）か下（'below'）に作る（元の場所からは抜く）。
  // 段の数が MAX_ROWS を超えるならそのまま。空になった段は消える（一人だけの段を自分の上に動かしても変わらない）
  function newRowPane(arr, key, rowIndex, where) {
    var out = copyArr(arr);
    if (!findPane(out.rows, key)) return out;
    var rows = withoutKey(out.rows, key);
    var idx = Math.min(rows.length, Math.max(0, (where === 'below') ? rowIndex + 1 : rowIndex));
    rows.splice(idx, 0, [[key]]);
    rows = pruneRows(rows);
    if (rows.length > MAX_ROWS) return out;
    out.rows = rows;
    return out;
  }
  // 全部を 1 段に横一列（今の順。積んだ面もばらす）
  function oneRow(arr) {
    var all = allKeys(arr);
    return { rows: all.length ? [all.map(function(k) { return [k]; })] : [], hidden: arr.hidden.slice() };
  }
  // 全部を 1 面ずつの段に縦一列（MAX_ROWS を超える分は最後の段に横に並べる）
  function oneColumn(arr) {
    var all = allKeys(arr);
    var rows = all.slice(0, MAX_ROWS - 1).map(function(k) { return [[k]]; });
    if (all.length >= MAX_ROWS) rows.push(all.slice(MAX_ROWS - 1).map(function(k) { return [k]; }));
    return { rows: rows, hidden: arr.hidden.slice() };
  }
  // 列の幅の控えのキー（段の番号と列の数）。0 段目は top<n>、1 段目は 2 列なら以前からの 'bottom' 他は bottom<n>、
  // それ以降は row<段>_<n>
  function rowKey(rowIndex, n) {
    if (rowIndex === 0) return 'top' + n;
    if (rowIndex === 1) return n === 2 ? 'bottom' : 'bottom' + n;
    return 'row' + rowIndex + '_' + n;
  }
  // 列の中に積んだ面の高さの控えのキー
  function stackKey(rowIndex, cellIndex, n) { return 'stk' + rowIndex + '_' + cellIndex + '_' + n; }
  // 段の縦の位置（%）。counts は表示中の各段の列の数（空の段は含めない）。段の間に横の仕切りが counts.length-1 本
  function rowGeometry(layout, counts) {
    var m = (counts || []).length;
    var hs = m > 0 ? rowsFor(layout, m) : [];
    var y = 0;
    return {
      rows: hs.map(function(h) { var o = { y: Math.round(y * 10) / 10, h: h }; y += h; return o; }),
      gutters: Math.max(0, m - 1)
    };
  }
  // 並びの位置（%）。cols（合計 100）から各要素の x と w（縦に積んだ面にも使う）
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
  function roundCols(arr) { return arr.map(function(v) { return Math.round(Number(v) * 10) / 10; }); }
  // 控えから読んだ生の値を正す。壊れた部分だけ既定に落とす
  function normalizeLayout(raw) {
    var out = { row: ROW_DEFAULT, cols: {}, rows: {} };
    if (!raw || typeof raw !== 'object') return out;
    var row = clampPct(raw.row, PANE_MIN, 100 - PANE_MIN);
    if (row !== null) out.row = row;
    var cols = (raw.cols && typeof raw.cols === 'object') ? raw.cols : {};
    Object.keys(cols).forEach(function(key) {
      var m = key.match(/^(?:top(\d+)|bottom(\d*)|row\d+_(\d+)|stk\d+_\d+_(\d+))$/);
      if (!m) return;
      var n = m[1] ? parseInt(m[1], 10) : m[3] ? parseInt(m[3], 10) : m[4] ? parseInt(m[4], 10) : (m[2] ? parseInt(m[2], 10) : 2);
      if (n < 1 || n > 12) return;
      if (validCols(cols[key], n)) out.cols[key] = roundCols(cols[key]);
    });
    var rows = (raw.rows && typeof raw.rows === 'object') ? raw.rows : {};
    Object.keys(rows).forEach(function(key) {
      var m = key.match(/^rows(\d+)$/);
      if (!m) return;
      var n = parseInt(m[1], 10);
      if (n < 1 || n > 12) return;
      if (validCols(rows[key], n)) out.rows[key] = roundCols(rows[key]);
    });
    return out;
  }
  // 段の列の幅（%）／列に積んだ面の高さ（%）。控えに無い・合わない数なら等分
  function colsFor(layout, key, n) {
    var arr = layout && layout.cols && layout.cols[key];
    return validCols(arr, n) ? arr.slice() : equalCols(n);
  }
  // 段の高さ（%）。控えに無ければ 2 段は以前からの row（上段 %）から、他は等分
  function rowsFor(layout, m) {
    var arr = layout && layout.rows && layout.rows['rows' + m];
    if (validCols(arr, m)) return arr.slice();
    if (m === 2) {
      var r = clampPct(layout && layout.row, PANE_MIN, 100 - PANE_MIN);
      if (r === null) r = ROW_DEFAULT;
      return [r, Math.round((100 - r) * 10) / 10];
    }
    return equalCols(m);
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
  var layout = { row: ROW_DEFAULT, cols: {}, rows: {} };
  var arr = { rows: [], hidden: [] };            // 面の並びと閉じた面（今の大会の鍵に合わせたもの）
  var paneList = [];                             // 今の大会の面（panes() に key を足したもの。nocourt の案内も含む）
  var paneEls = Object.create(null);             // 鍵 → 面の要素（大会を選んだときに 1 回だけ作る）
  var defaultRows = [];                          // 「並びを元に戻す」の既定（段ごとの鍵の配列）

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
    head.title = 'ドラッグして場所を変えます（別の面の真ん中で入れ替え、左右の端でその隣の列、上下の端でその面の上下に積む、画面の上端・下端で一番上・下の段）';
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

  // 面の移動: 見出しを掴んで DRAG_START_PX 動いたらドラッグ。放す先は
  //   - 別の面の真ん中 → その面と入れ替え（swapPanes。金の枠）
  //   - 別の面の左右 EDGE_RATIO の帯 → その面の列の左／右に新しい列（insertPane。その側に金の帯）
  //   - 別の面の上下 EDGE_RATIO の帯 → その面と同じ列の上／下に積む（stackPane。その側に金の帯）
  //   - 画面の上端・下端の帯（ドラッグ中だけ出る .dash-drop-row）→ 一番上／一番下の新しい段（newRowPane）
  // 仕切りと同じく、ドラッグ中は body.dash-dragging で iframe の pointer-events を切る（elementFromPoint で面が拾える）
  var DROP_CLASSES = ['dash-drop-target', 'dash-drop-before', 'dash-drop-after', 'dash-drop-above', 'dash-drop-below', 'dash-drop-row-on'];
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
    function buildZones() {
      var grid = document.getElementById('dashGrid');
      ['top', 'bottom'].forEach(function(where) {
        var z = document.createElement('div');
        z.className = 'dash-drop-row dash-drop-row-' + where;
        z.setAttribute('data-where', where);
        z.textContent = where === 'top' ? 'ここに放すと一番上の段へ' : 'ここに放すと一番下の段へ';
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
      if (zone) { setTarget({ el: zone, cls: 'dash-drop-row-on', act: 'edge', where: zone.getAttribute('data-where') }); return; }
      var t = (el && el.closest) ? el.closest('.dash-pane[data-key]') : null;
      if (!t || t === box || t.getAttribute('data-key') === 'nocourt') { clearTarget(); return; }
      var rect = t.getBoundingClientRect();
      var rx = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      var ry = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
      var ex = Math.min(rx, 1 - rx), ey = Math.min(ry, 1 - ry);   // 左右の端・上下の端への近さ
      var ref = t.getAttribute('data-key');
      if (ex >= EDGE_RATIO && ey >= EDGE_RATIO) setTarget({ el: t, cls: 'dash-drop-target', act: 'swap', ref: ref });
      else if (ex < ey) setTarget(rx < 0.5 ? { el: t, cls: 'dash-drop-before', act: 'before', ref: ref } : { el: t, cls: 'dash-drop-after', act: 'after', ref: ref });
      else setTarget(ry < 0.5 ? { el: t, cls: 'dash-drop-above', act: 'above', ref: ref } : { el: t, cls: 'dash-drop-below', act: 'below', ref: ref });
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
      var next;
      if (t.act === 'swap') next = swapPanes(arr, key, t.ref);
      else if (t.act === 'edge') next = newRowPane(arr, key, t.where === 'top' ? 0 : arr.rows.length - 1, t.where === 'top' ? 'above' : 'below');
      else if (t.act === 'above' || t.act === 'below') next = stackPane(arr, key, t.ref, t.act);
      else next = insertPane(arr, key, rowOf(t.ref), t.ref, t.act);
      arr = next;
      savePanes(arr);
      applyPositions();
    }
    head.addEventListener('pointerup', function() { finish(true); });
    head.addEventListener('pointercancel', function() { finish(false); });
  }
  function rowOf(key) {
    var f = findPane(arr.rows, key);
    return f ? f.r : 0;
  }
  // 表示中の並び（閉じた面と、要素の無い鍵は除く。空になった列・段は飛ばす）:
  // [{ r: 段の番号, cells: [{ c: 列の番号, keys }] }]
  function visibleRows() {
    var hidden = Object.create(null);
    arr.hidden.forEach(function(k) { hidden[k] = true; });
    return arr.rows.map(function(row, r) {
      return {
        r: r,
        cells: row.map(function(cell, c) {
          return { c: c, keys: cell.filter(function(k) { return !hidden[k] && paneEls[k]; }) };
        }).filter(function(x) { return x.keys.length > 0; })
      };
    }).filter(function(x) { return x.cells.length > 0; });
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

  // calc() で位置を入れる。全体（base。既定は 100%）から仕切りの分（px）を引いた残りに割合を掛け、手前の仕切りの分を足す
  function calcPos(pct, gutterCount, before, base, offset) {
    return 'calc(' + (offset ? offset + ' + ' : '') + '(' + (base || '100%') + ' - ' + (gutterCount * GUTTER_PX) + 'px) * ' +
      (pct / 100) + ' + ' + (before * GUTTER_PX) + 'px)';
  }
  function calcSize(pct, gutterCount, base) {
    return 'calc((' + (base || '100%') + ' - ' + (gutterCount * GUTTER_PX) + 'px) * ' + (pct / 100) + ')';
  }

  // 面と仕切りの位置を当てる。面の要素は動かさず style だけ変える（iframe を読み直さない）。
  // 仕切りは本数が変わるので作り直す
  function applyPositions() {
    var grid = document.getElementById('dashGrid');
    var old = grid.querySelectorAll('.dash-gutter');
    for (var i = 0; i < old.length; i++) grid.removeChild(old[i]);
    var vr = visibleRows();
    var shown = Object.create(null);
    vr.forEach(function(x) { x.cells.forEach(function(cell) { cell.keys.forEach(function(k) { shown[k] = true; }); }); });
    Object.keys(paneEls).forEach(function(k) { paneEls[k].classList.toggle('hidden', !shown[k]); });
    var allClosed = document.getElementById('dashAllClosed');
    if (allClosed) allClosed.classList.toggle('hidden', vr.length > 0);

    var geo = rowGeometry(layout, vr.map(function(x) { return x.cells.length; }));
    var m = vr.length;
    vr.forEach(function(x, j) {
      var g = geo.rows[j], n = x.cells.length, key = rowKey(x.r, n);
      var cols = colGeometry(colsFor(layout, key, n));
      var rowTop = calcPos(g.y, geo.gutters, j), rowH = calcSize(g.h, geo.gutters);
      x.cells.forEach(function(cell, i) {
        var left = calcPos(cols[i].x, n - 1, i), width = calcSize(cols[i].w, n - 1);
        if (i > 0) {
          var gv = buildGutter('v', key, n, i - 1);
          gv.style.left = calcPos(cols[i].x, n - 1, i - 1);
          gv.style.width = GUTTER_PX + 'px';
          gv.style.top = rowTop;
          gv.style.height = rowH;
          grid.appendChild(gv);
        }
        var s = cell.keys.length, skey = stackKey(x.r, cell.c, s);
        var hs = colGeometry(colsFor(layout, skey, s));
        cell.keys.forEach(function(k, q) {
          var el = paneEls[k];
          el.style.left = left;
          el.style.width = width;
          el.style.top = s === 1 ? rowTop : calcPos(hs[q].x, s - 1, q, rowH, rowTop);
          el.style.height = s === 1 ? rowH : calcSize(hs[q].w, s - 1, rowH);
          if (q > 0) {
            var gs = buildGutter('s', skey, s, q - 1, cell.keys);
            gs.style.left = left;
            gs.style.width = width;
            gs.style.top = calcPos(hs[q].x, s - 1, q - 1, rowH, rowTop);
            gs.style.height = GUTTER_PX + 'px';
            grid.appendChild(gs);
          }
        });
      });
      if (j < m - 1) {
        var gh = buildGutter('h', 'rows' + m, m, j);
        gh.style.left = '0';
        gh.style.width = '100%';
        gh.style.top = calcPos(g.y + g.h, geo.gutters, j);
        gh.style.height = GUTTER_PX + 'px';
        grid.appendChild(gh);
      }
    });
    renderPanesMenu();
  }

  // 仕切り。pointerdown で掴み、pointermove で layout を更新して当て直し、pointerup で保存。
  //   'v' … 段の中の列の幅（layout.cols[key]）、'h' … 段の高さ（layout.rows[key]。key は rows<段の数>）、
  //   's' … 列に積んだ面の高さ（layout.cols[key]。key は stk…。stackKeys はその列の鍵で、動かせる長さを測るのに使う）
  // iframe がポインターを飲まないよう、ドラッグ中は body.dash-dragging で iframe の pointer-events を切る。
  // ダブルクリックでその仕切りを既定に戻す。
  function buildGutter(kind, key, n, index, stackKeys) {
    var g = document.createElement('div');
    g.className = 'dash-gutter dash-gutter-' + (kind === 'v' ? 'v' : 'h');
    g.setAttribute('role', 'separator');
    g.setAttribute('aria-orientation', kind === 'v' ? 'vertical' : 'horizontal');
    g.title = 'ドラッグで大きさを変えます。ダブルクリックで元に戻します';
    var start = null;
    function trackLength() {
      if (kind === 's') {
        var first = paneEls[stackKeys[0]].getBoundingClientRect();
        var last = paneEls[stackKeys[stackKeys.length - 1]].getBoundingClientRect();
        return (last.bottom - first.top) - GUTTER_PX * (n - 1);
      }
      var rect = document.getElementById('dashGrid').getBoundingClientRect();
      return (kind === 'h' ? rect.height : rect.width) - GUTTER_PX * (n - 1);
    }
    g.addEventListener('pointerdown', function(e) {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, track: trackLength(),
                vals: kind === 'h' ? rowsFor(layout, n) : colsFor(layout, key, n) };
      g.setPointerCapture(e.pointerId);
      document.body.classList.add('dash-dragging');
      e.preventDefault();
    });
    g.addEventListener('pointermove', function(e) {
      if (!start || start.track <= 0) return;
      var delta = (kind === 'v' ? (e.clientX - start.x) : (e.clientY - start.y)) / start.track * 100;
      if (kind === 'h') layout.rows[key] = dragCols(start.vals, index, delta);
      else layout.cols[key] = dragCols(start.vals, index, delta);
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
      if (kind === 'h') { delete layout.rows[key]; layout.row = ROW_DEFAULT; }
      else delete layout.cols[key];
      applyPositions();
      saveLayout(layout);
    });
    return g;
  }

  // 「▦ 面」のメニュー: 面ごとのチェック（付いている＝表示中）、すべて表示、横一列・縦一列、並びを元に戻す
  function renderPanesMenu() {
    var list = document.getElementById('dashPanesList');
    if (!list) return;
    list.innerHTML = '';
    var hidden = Object.create(null);
    arr.hidden.forEach(function(k) { hidden[k] = true; });
    var byKey = Object.create(null);
    paneList.forEach(function(p) { byKey[p.key] = p; });
    allKeys(arr).forEach(function(k) {
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
    function button(text, title, disabled, onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (title) b.title = title;
      b.disabled = !!disabled;
      b.addEventListener('click', onClick);
      list.appendChild(b);
    }
    var count = allKeys(arr).length;
    var isOneRow = arr.rows.length === 1 && arr.rows[0].every(function(cell) { return cell.length === 1; });
    var isOneColumn = arr.rows.length === Math.min(count, MAX_ROWS) && arr.rows.every(function(row) { return row.length === 1 && row[0].length === 1; });
    button('すべて表示', '', arr.hidden.length === 0, function() { arr.hidden = []; savePanes(arr); applyPositions(); });
    button('横一列に並べる', '全部の面を 1 つの段に横一列に並べます', isOneRow || count === 0, function() {
      arr = oneRow(arr); savePanes(arr); applyPositions();
    });
    button('縦一列に並べる', '全部の面を 1 面ずつの段に縦に並べます', isOneColumn || count === 0, function() {
      arr = oneColumn(arr); savePanes(arr); applyPositions();
    });
    button('並びを元に戻す', '既定の 2 段（上にコート、下に運営と順位）に戻し、閉じた面も出します', false, function() {
      arr = arrangePanes(paneList.map(function(p) { return p.key; }), defaultRows, null);
      savePanes(arr);
      applyPositions();
    });
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

    defaultRows = [courtKeys, ['desk', 'rank']];
    arr = arrangePanes(paneList.map(function(p) { return p.key; }), defaultRows, loadPanes());
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
    rowsFor: rowsFor,
    dragCols: dragCols,
    dragRow: dragRow,
    loadLayout: loadLayout,
    saveLayout: saveLayout,
    normalizePanes: normalizePanes,
    arrangePanes: arrangePanes,
    swapPanes: swapPanes,
    insertPane: insertPane,
    stackPane: stackPane,
    newRowPane: newRowPane,
    oneRow: oneRow,
    oneColumn: oneColumn,
    allKeys: allKeys,
    rowKey: rowKey,
    stackKey: stackKey,
    rowGeometry: rowGeometry,
    colGeometry: colGeometry,
    loadPanes: loadPanes,
    savePanes: savePanes
  };
})();
