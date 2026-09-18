// 選手の区画（#players/<id>）。編集できる表。
// 絞り込み・並べ替えはスマホ運営の選手タブと同じ純粋関数（Courts.applyFilter / Courts.sortBy）。
// 帯は PC 幅なので 1 段に並べる（スマホの admin-players.js は 3 段）。
// セルの編集・行の追加・貼り付け・削除はこのあとのタスクで足す。
(function() {
  // 絞り込みと並べ替えの状態。形は Courts.defaultFilter() / Courts.defaultSort()。
  // 大会が変われば既定に戻す。保存後の描き直し（Desk.reloadEvent）では保つ。
  var filter = null;
  var sort = null;
  var stateOwner = null;

  // いま描いている表。行の追加・削除や並べ替えで表だけを描き直すために覚えておく。
  // render のたびに入れ替える（古い ctx の DOM を触らない）。
  var view = null;   // { chips, wrap, ctx, locked }

  // 表の列。key があるものは見出しを押すと並べ替えられる
  // （巡・コート・性別は絞り込みの軸なので並べ替えの対象にしない）。
  var COLUMNS = [
    { label: '巡', cls: 'col-round' },
    { key: 'order', label: 'No.', cls: 'col-no' },
    { key: 'name', label: '名前', cls: 'col-name' },
    { label: 'コート', cls: 'col-court' },
    { label: '性別', cls: 'col-sex' },
    { label: '新人', cls: 'col-new' },
    { label: '技1', cls: 'col-tech' },
    { label: '技2', cls: 'col-tech' },
    { label: '技3', cls: 'col-tech' },
    { key: 'score', label: '得点', cls: 'col-score' },
    { label: '', cls: 'act' }
  ];

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function emptyMessage(text) {
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = text;
    return p;
  }

  function render(container, ctx) {
    var locked = EventStatus.isLocked(EventStatus.of(ctx.event));
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
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '選手';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    var count = document.createElement('span');
    count.className = 'desk-head-meta';
    count.textContent = (ctx.players || []).length + ' 名';
    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(count);
    container.appendChild(head);

    if (locked) {
      var warn = document.createElement('p');
      warn.className = 'desk-warn';
      warn.textContent = 'この大会は最終結果を確定済みです。上部の「戻す」を押すと編集できます。';
      container.appendChild(warn);
    }

    // 帯。チップは押すたびに作り直すが、検索の入力欄は作り直さない
    // （入力中の文字と IME の変換を保つ。スマホの選手タブと同じ理由）。
    var bar = document.createElement('div');
    bar.className = 'desk-players-bar';
    var chips = document.createElement('div');
    chips.className = 'desk-players-chips';
    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'desk-players-search';
    search.placeholder = '名前で検索';
    search.setAttribute('aria-label', '名前で検索');
    search.value = filter.query;
    bar.appendChild(chips);
    bar.appendChild(search);
    container.appendChild(bar);

    var wrap = document.createElement('div');
    wrap.className = 'desk-players-wrap';
    container.appendChild(wrap);

    view = { chips: chips, wrap: wrap, ctx: ctx, locked: locked };

    function applyQuery() {
      // Chromium は変換確定で compositionend と input の両方が来るので、同じ文字列なら描き直さない
      if (search.value === filter.query) return;
      filter.query = search.value;
      redrawTable();
    }
    search.addEventListener('input', function(ev) {
      // IME 変換中は確定前の文字で絞り込まない（変換終了時に確定値で最後の input が来る）
      if (ev.isComposing) return;
      applyQuery();
    });
    // WebKit は input(isComposing:true) → compositionend の順で、その後 isComposing:false の
    // input が来ないため、compositionend でも絞り込む（techpicker.js の検索欄と同じ）。
    search.addEventListener('compositionend', applyQuery);

    refresh();
  }

  // 帯と表を描き直す（チップを押したとき）
  function refresh() {
    if (!view) return;
    renderChips(view.chips, view.ctx);
    renderTable(view.wrap, view.ctx, view.locked);
  }

  // 表だけ描き直す（並べ替え・名前の検索・行の追加や削除）
  function redrawTable() {
    if (!view) return;
    renderTable(view.wrap, view.ctx, view.locked);
  }

  // チップの小さな並び（admin.js の Admin.renderChips の PC 版。desk.html は admin.js を読まない）。
  function chipGroup(parent, items, current, onPick) {
    var g = document.createElement('span');
    g.className = 'desk-chip-group';
    items.forEach(function(item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'desk-chip' + (String(item.value) === String(current) ? ' on' : '');
      b.textContent = item.label;
      b.addEventListener('click', function() { onPick(item.value); refresh(); });
      g.appendChild(b);
    });
    parent.appendChild(g);
  }

  function renderChips(el, ctx) {
    el.innerHTML = '';
    chipGroup(el, [{ value: '', label: '全コート' }].concat(Courts.listFrom(ctx.players).map(function(c) {
      return { value: c, label: c === Courts.UNASSIGNED ? c : c + ' コート' };
    })), filter.court, function(v) { filter.court = v; });

    chipGroup(el, [{ value: '', label: '男女' }, { value: '男子', label: '男子' }, { value: '女子', label: '女子' }],
      filter.sex, function(v) { filter.sex = v; });

    chipGroup(el, [{ value: 0, label: '全巡' }].concat(Courts.roundsOf(ctx.players).map(function(r) {
      return { value: r, label: r + '巡' };
    })), filter.round, function(v) { filter.round = v; });

    chipGroup(el, [{ value: true, label: '新人' }], filter.newFace, function() { filter.newFace = !filter.newFace; });
    chipGroup(el, [{ value: true, label: '技未入力' }], filter.noTech, function() { filter.noTech = !filter.noTech; });
  }

  function renderTable(wrap, ctx, locked) {
    wrap.innerHTML = '';
    var players = ctx.players || [];
    if (players.length === 0) {
      wrap.appendChild(emptyMessage('まだ選手がいません。'));
      return;
    }
    var rows = Courts.sortBy(Courts.applyFilter(players, filter), sort);
    if (rows.length === 0) {
      wrap.appendChild(emptyMessage('条件に合う選手がいません。'));
      return;
    }

    var table = document.createElement('table');
    table.className = 'desk-table desk-players-table';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    COLUMNS.forEach(function(col) {
      var th = document.createElement('th');
      th.className = col.cls;
      if (!col.key) {
        th.textContent = col.label;
      } else {
        var on = sort.key === col.key;
        th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = on ? 'sort-btn on' : 'sort-btn';
        b.textContent = col.label + (on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
        b.addEventListener('click', function() {
          // 同じ列なら昇⇄降、別の列なら昇順から
          if (sort.key === col.key) sort.dir = (sort.dir === 'asc' ? 'desc' : 'asc');
          else sort = { key: col.key, dir: 'asc' };
          redrawTable();
        });
        th.appendChild(b);
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function(p) { tbody.appendChild(buildRow(ctx, p, locked)); });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  // 1 人 1 行。巡・No.（order から導出）と得点は読み取り。
  // 名前・コート・性別・新人・技は Task 7 で入力にする。
  function buildRow(ctx, p, locked) {
    var key = Courts.orderKey(p);
    var tr = document.createElement('tr');
    tr.appendChild(cell(String(Courts.roundOf(p)), 'num col-round'));
    tr.appendChild(cell(String(key.no || ''), 'num col-no'));
    tr.appendChild(cell(p.name || '', 'col-name desk-cell-main'));
    tr.appendChild(cell(Courts.courtOf(p), 'col-court'));
    tr.appendChild(cell(Courts.sexOf(p), 'col-sex'));
    tr.appendChild(cell(p.isNewFace ? '○' : '', 'col-new'));
    tr.appendChild(cell(p.tech1 || '', 'col-tech'));
    tr.appendChild(cell(p.tech2 || '', 'col-tech'));
    tr.appendChild(cell(p.tech3 || '', 'col-tech'));
    tr.appendChild(cell(String(p.score || 0), 'num col-score'));
    tr.appendChild(cell('', 'act'));
    return tr;
  }

  Desk.registerTab('players', { render: render });
})();
