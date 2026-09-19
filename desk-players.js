// 選手の区画（#players/<id>）。編集できる表。
// 絞り込み・並べ替えはスマホ運営の選手登録タブと同じ純粋関数（Courts.applyFilter / Courts.sortBy）。
// 絞り込みは見出しの ▼（Excel 風）。スマホの admin-players.js はチップの帯のまま。
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

  // 「＋ 行を追加」の下書き行。null なら出さない。
  // 値は次に作る行の初期値（直前の行のコート・性別・新人を引き継ぐ）。
  // サーバーにはまだ無い行なので、大会を移ったら捨てる。
  var draft = null;   // null | { court, isFemale, isNewFace }

  // 表の列。key があるものは見出しの文字を押すと並べ替えられる
  // （巡・コート・性別は絞り込みの軸なので並べ替えの対象にしない）。
  // filter があるものは見出しに ▼ が付き、押すと絞り込みのポップオーバーが開く。
  // 技1〜3 はどの列の ▼ からでも同じ「技が未入力の行だけ」を開く。
  var COLUMNS = [
    { label: '巡', cls: 'col-round', filter: 'round' },
    { key: 'order', label: 'No.', cls: 'col-no' },
    { key: 'name', label: '名前', cls: 'col-name', filter: 'name' },
    { label: 'コート', cls: 'col-court', filter: 'court' },
    { label: '性別', cls: 'col-sex', filter: 'sex' },
    { label: '新人', cls: 'col-new', filter: 'newFace' },
    { label: '技1', cls: 'col-tech', filter: 'noTech' },
    { label: '技2', cls: 'col-tech', filter: 'noTech' },
    { label: '技3', cls: 'col-tech', filter: 'noTech' },
    { key: 'score', label: '得点', cls: 'col-score' },
    { label: '', cls: 'act' }
  ];

  // この画面の絞り込みの初期値。複数選べるのはコートだけなので配列にする
  // （Courts.applyFilter は文字列も配列も受ける。Courts.defaultFilter() の既定は '' のまま）。
  function newFilter() {
    var f = Courts.defaultFilter();
    f.court = [];
    return f;
  }

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
      filter = newFilter();
      sort = Courts.defaultSort();
      draft = null;
      stateOwner = ctx.eventId;
    }
    if (locked) draft = null;   // 確定済みの大会では行を足せない
    // 絞り込み中のコート・巡目の選手が全員いなくなったら「すべて」に戻す
    var courtList = Courts.listFrom(ctx.players);
    filter.court = (filter.court || []).filter(function(c) { return courtList.indexOf(c) !== -1; });
    if (filter.round && Courts.roundsOf(ctx.players).indexOf(filter.round) === -1) filter.round = 0;
    // 前の描画のポップオーバーを残さない（document.body に置くので勝手には消えない）
    closePopover();

    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '選手登録';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    var count = document.createElement('span');
    count.className = 'desk-head-meta';
    count.textContent = (ctx.players || []).length + ' 名';
    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(count);
    if (!locked) {
      var btnAdd = document.createElement('button');
      btnAdd.type = 'button';
      btnAdd.className = 'desk-btn';
      btnAdd.textContent = '＋ 行を追加';
      btnAdd.addEventListener('click', function() { startDraft(ctx); });
      head.appendChild(btnAdd);
      var btnPaste = document.createElement('button');
      btnPaste.type = 'button';
      btnPaste.className = 'desk-btn';
      btnPaste.textContent = '📋 貼り付けて追加';
      btnPaste.addEventListener('click', function() { openPasteDialog(ctx); });
      head.appendChild(btnPaste);
    }
    head.appendChild(buildHeadMenu(ctx, locked));
    container.appendChild(head);

    if (locked) {
      var warn = document.createElement('p');
      warn.className = 'desk-warn';
      warn.textContent = 'この大会は最終結果を確定済みです。上部の「戻す」を押すと編集できます。';
      container.appendChild(warn);
    }

    // 表の上の行。絞り込みは見出しの ▼ に移したので、ここは件数と解除ボタンだけ。
    var bar = document.createElement('div');
    bar.className = 'desk-players-bar';
    container.appendChild(bar);

    var wrap = document.createElement('div');
    wrap.className = 'desk-players-wrap';
    container.appendChild(wrap);

    view = { bar: bar, wrap: wrap, ctx: ctx, locked: locked, heads: [], tbody: null };

    redrawTable();
  }

  // 表ごと描き直す（見出しも作り直す。並べ替え・行の追加や削除・絞り込みの一括解除）。
  // 開いているポップオーバーは見出しの ▼ を指しているので、先に閉じる。
  function redrawTable() {
    if (!view) return;
    closePopover();
    renderTable(view.wrap, view.ctx, view.locked);
  }

  // 行と件数だけ描き直す（絞り込みを変えたとき）。見出しは作り直さない
  // ＝ 開いているポップオーバーの中の入力欄と IME の変換が生き残る。
  function refreshRows() {
    if (!view) return;
    fillRows(view.ctx, view.locked);
    updateHeadMarks();
  }

  // ---- 絞り込みの状態 ----

  var FILTER_KINDS = ['round', 'name', 'court', 'sex', 'newFace', 'noTech'];

  function isFilterActive(kind) {
    if (kind === 'court') return (filter.court || []).length > 0;
    if (kind === 'round') return !!filter.round;
    if (kind === 'sex') return !!filter.sex;
    if (kind === 'newFace') return !!filter.newFace;
    if (kind === 'noTech') return !!filter.noTech;
    if (kind === 'name') return !!filter.query;
    return false;
  }

  function isAnyFilterActive() {
    return FILTER_KINDS.some(isFilterActive);
  }

  function clearFilter() {
    filter = newFilter();
    redrawTable();   // 見出しの ▼ と背景も戻すので表ごと描き直す
  }

  // 見出しの ▼ と背景を、いまの絞り込みに合わせる（表は作り直さない）。
  function updateHeadMarks() {
    if (!view || !view.heads) return;
    view.heads.forEach(function(h) {
      var on = isFilterActive(h.kind);
      h.th.classList.toggle('filtered', on);
      h.btn.classList.toggle('on', on);
    });
  }

  // ---- 見出しの ▼ のポップオーバー ----
  // 画面に同時に 1 つだけ。外側クリック・Esc・スクロール・リサイズ・ハッシュ変更で閉じる。
  // 表の枠（.desk-players-wrap）は overflow-x: auto なので中に絶対配置すると縦にも切られる
  // （desk.css の .desk-menu のコメント参照）。document.body に fixed で置いて逃がす。
  var popover = null;   // null | { el, btn, col }
  var popoverBound = false;

  function bindPopoverCloseOnce() {
    if (popoverBound) return;
    popoverBound = true;
    document.addEventListener('click', function(e) {
      if (!popover) return;
      if (popover.el.contains(e.target)) return;   // ▼ 自身は stopPropagation でここに来ない
      closePopover();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && popover) { e.preventDefault(); closePopover(true); }
    });
    // 表や窓が動くと ▼ の位置がずれるので閉じる（中身のスクロールでは閉じない）
    window.addEventListener('scroll', function(e) {
      if (popover && popover.el.contains(e.target)) return;
      closePopover();
    }, true);
    window.addEventListener('resize', function() { closePopover(); });
    // 別の区画へ移っても body に残り続けないように
    window.addEventListener('hashchange', function() { closePopover(); });
  }

  // refocus を true にしたときだけ ▼ にフォーカスを戻す（Esc と ▼ の再クリック）。
  // 外側クリックで戻すと、その直後のセルのクリックが 1 回無効になる（フォーカスの奪い合い）ので戻さない。
  function closePopover(refocus) {
    if (!popover) return;
    var btn = popover.btn;
    if (popover.el.parentNode) popover.el.parentNode.removeChild(popover.el);
    popover = null;
    if (btn && btn.isConnected) {
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    }
  }

  function togglePopover(btn, col) {
    if (popover && popover.btn === btn) { closePopover(true); return; }
    openPopover(btn, col);
  }

  function openPopover(btn, col) {
    closePopover();
    bindPopoverCloseOnce();
    var box = document.createElement('div');
    box.className = 'desk-filter-pop';
    // 中のボタン（「すべて選択」など）を押すと中身が作り直され、click が document まで
    // 泡立つ頃には押した要素が DOM から外れていて「外側クリック」に誤判定される。
    // ここで止めて外側クリック扱いにしない。
    box.addEventListener('click', function(e) { e.stopPropagation(); });
    document.body.appendChild(box);
    popover = { el: box, btn: btn, col: col };
    rebuildPopover();
    placePopover();
    btn.setAttribute('aria-expanded', 'true');
    var first = box.querySelector('input');
    if (first) first.focus();
  }

  // 中身だけ作り直す（「すべて選択」やチェックの入り直しを反映する）。
  // 名前の検索欄は作り直すと入力中の文字と IME の変換が消えるので、ここからは呼ばない。
  function rebuildPopover() {
    if (!popover) return;
    popover.el.innerHTML = '';
    popover.el.appendChild(popoverBody(popover.col));
  }

  // ▼ の実座標から位置を決める。画面の右端からはみ出すときは寄せ戻す。
  function placePopover() {
    if (!popover) return;
    var r = popover.btn.getBoundingClientRect();
    popover.el.style.top = (r.bottom + 4) + 'px';
    var left = r.left;
    var w = popover.el.offsetWidth;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
    popover.el.style.left = left + 'px';
  }

  // チェック 1 行
  function checkRow(label, checked, onChange) {
    var lab = document.createElement('label');
    lab.className = 'desk-filter-row';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = checked;
    chk.addEventListener('change', function() { onChange(chk.checked); });
    lab.appendChild(chk);
    var span = document.createElement('span');
    span.textContent = label;
    lab.appendChild(span);
    return lab;
  }

  // 「すべて選択」＝ この列の絞り込みを外す。
  // 設計書の「解除」は、この状態モデルでは同じ「絞り込みなし」に戻るため置かない
  // （空＝すべて。「どれも表示しない」という状態が無い）。
  function allButton(onAll) {
    var row = document.createElement('div');
    row.className = 'desk-filter-actions';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'desk-btn';
    b.textContent = 'すべて選択';
    b.addEventListener('click', onAll);
    row.appendChild(b);
    return row;
  }

  function popoverBody(col) {
    var ctx = view.ctx;
    if (col.filter === 'name') return namePop();
    if (col.filter === 'court') return courtPop(ctx);
    if (col.filter === 'round') {
      return triPop(Courts.roundsOf(ctx.players).map(function(r) {
        return { value: r, label: r === 1 ? '一巡目' : r === 2 ? '二巡目' : r + '巡目' };
      }), filter.round, 0, function(v) { filter.round = v; });
    }
    if (col.filter === 'sex') {
      return triPop([{ value: '男子', label: '男子' }, { value: '女子', label: '女子' }],
        filter.sex, '', function(v) { filter.sex = v; });
    }
    if (col.filter === 'newFace') {
      return flagPop('新人だけ', filter.newFace, function(v) { filter.newFace = v; });
    }
    return flagPop('技が未入力の行だけ', filter.noTech, function(v) { filter.noTech = v; });
  }

  // コート。ここだけ本当の複数選択（filter.court は配列）。
  // 空配列＝すべて。全部にチェックが入った状態も空配列に戻す（同じ意味なので状態を1つに保つ）。
  function courtPop(ctx) {
    var box = document.createElement('div');
    var list = Courts.listFrom(ctx.players);   // 未分類も含む
    var body = document.createElement('div');
    body.className = 'desk-filter-list';
    var all = (filter.court || []).length === 0;
    list.forEach(function(c) {
      body.appendChild(checkRow(c, all || filter.court.indexOf(c) !== -1, function(on) {
        var cur = ((filter.court || []).length === 0) ? list.slice() : filter.court.slice();
        var i = cur.indexOf(c);
        if (on && i === -1) cur.push(c);
        if (!on && i !== -1) cur.splice(i, 1);
        filter.court = (cur.length === list.length) ? [] : cur;
        refreshRows();   // チェックの見た目はブラウザが変えているので作り直さない
      }));
    });
    box.appendChild(body);
    box.appendChild(allButton(function() {
      filter.court = [];
      rebuildPopover();
      refreshRows();
    }));
    return box;
  }

  // 3 値（すべて／A／B）をチェックで見せる。両方入り＝すべて、片方だけ＝その値。
  // 最後の 1 つを外したら「すべて」に戻す（この状態モデルに「どれも出さない」は無い）。
  // items は 1〜2 個（巡目は 1 巡だけの大会がある）。
  function triPop(items, current, empty, set) {
    var box = document.createElement('div');
    var body = document.createElement('div');
    body.className = 'desk-filter-list';
    var all = String(current) === String(empty);
    items.forEach(function(it) {
      var on = all || String(current) === String(it.value);
      body.appendChild(checkRow(it.label, on, function(checked) {
        if (all) {
          // すべて → この 1 つを外す ＝ 残りだけを見る
          if (!checked) {
            var other = items.filter(function(x) { return String(x.value) !== String(it.value); })[0];
            set(other ? other.value : empty);
          }
        } else if (String(current) === String(it.value)) {
          if (!checked) set(empty);     // 最後の 1 つを外したら「すべて」に戻す
        } else if (checked) {
          set(empty);                   // 2 つとも入った ＝ すべて
        }
        rebuildPopover();               // 相手側のチェックも入れ直す
        refreshRows();
      }));
    });
    box.appendChild(body);
    box.appendChild(allButton(function() { set(empty); rebuildPopover(); refreshRows(); }));
    return box;
  }

  // チェック 1 つだけ（新人・技未入力）。外した状態が「すべて」なのでボタンは要らない。
  function flagPop(label, on, set) {
    var box = document.createElement('div');
    var body = document.createElement('div');
    body.className = 'desk-filter-list';
    body.appendChild(checkRow(label, !!on, function(checked) {
      set(checked);
      refreshRows();
    }));
    box.appendChild(body);
    return box;
  }

  // 名前の検索。refreshRows は見出しを作り直さないので、打ち込みと IME の変換が続く。
  function namePop() {
    var box = document.createElement('div');
    var input = document.createElement('input');
    input.type = 'search';
    input.className = 'desk-filter-search';
    input.placeholder = '名前で検索';
    input.setAttribute('aria-label', '名前で検索');
    input.value = filter.query;
    function applyQuery() {
      // Chromium は変換確定で compositionend と input の両方が来るので、同じ文字列なら描き直さない
      if (input.value === filter.query) return;
      filter.query = input.value;
      refreshRows();
    }
    input.addEventListener('input', function(ev) {
      // IME 変換中は確定前の文字で絞り込まない（変換終了時に確定値で最後の input が来る）
      if (ev.isComposing) return;
      applyQuery();
    });
    // WebKit は input(isComposing:true) → compositionend の順で、その後 isComposing:false の
    // input が来ないため、compositionend でも絞り込む（techpicker.js の検索欄と同じ）。
    input.addEventListener('compositionend', applyQuery);
    // Esc はブラウザの既定（入力欄を空にする）ではなくポップオーバーを閉じるほうに使う
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { e.preventDefault(); closePopover(true); }
    });
    box.appendChild(input);
    return box;
  }

  // 表の上の「表示 n / N 名」と「絞り込みを解除」。
  function renderCount(shown, total) {
    if (!view || !view.bar) return;
    view.bar.innerHTML = '';
    var span = document.createElement('span');
    span.className = 'desk-players-count';
    span.textContent = '表示 ' + shown + ' / ' + total + ' 名';
    view.bar.appendChild(span);
    if (!isAnyFilterActive()) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'desk-btn';
    b.textContent = '絞り込みを解除';
    b.addEventListener('click', function() { clearFilter(); });
    view.bar.appendChild(b);
  }

  // 条件に合う行が無いときの 1 行。表の外に出すと見出しごと消えて
  // 絞り込みを戻せなくなるので、行として出す。
  function noMatchRow() {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.className = 'desk-empty-row';
    td.colSpan = COLUMNS.length;
    td.textContent = '条件に合う選手がいません。';
    tr.appendChild(td);
    return tr;
  }

  // 見出し。絞り込みでは作り直さない（ポップオーバーの中の入力を保つため）。
  // view.heads に { kind, th, btn } を貯めて、updateHeadMarks で色だけ塗り替える。
  function buildHead(ctx) {
    view.heads = [];
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    COLUMNS.forEach(function(col) {
      var th = document.createElement('th');
      th.className = col.cls;
      if (!col.key) {
        th.textContent = col.label;
        // 操作列は見出しの文字が空なので、スクリーンリーダー向けに列名を付ける
        if (col.cls === 'act') th.setAttribute('aria-label', '操作');
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
      if (col.filter) th.appendChild(filterButton(th, col));
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    updateHeadMarks();
    return thead;
  }

  // 見出しの ▼。並べ替え（見出しの文字のボタン）と分けるため、
  // クリックは stopPropagation して外側クリックの判定にも流さない。
  function filterButton(th, col) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter-btn';
    b.textContent = '▼';
    b.setAttribute('aria-label', (col.label || '操作') + 'の絞り込み');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function(e) {
      e.stopPropagation();
      togglePopover(b, col);
    });
    view.heads.push({ kind: col.filter, th: th, btn: b });
    return b;
  }

  // 行と件数だけ作り直す（見出しはそのまま）。
  function fillRows(ctx, locked) {
    var tbody = view && view.tbody;
    if (!tbody) return;
    tbody.innerHTML = '';
    var players = ctx.players || [];
    var rows = Courts.sortBy(Courts.applyFilter(players, filter), sort);
    rows.forEach(function(p) { tbody.appendChild(buildRow(ctx, p, locked)); });
    if (rows.length === 0 && !draft) tbody.appendChild(noMatchRow());
    // 下書き行は絞り込みに関わらず必ず末尾に出す（打ち込んでいる途中で消えない）
    if (draft && !locked) tbody.appendChild(buildDraftRow(ctx));
    renderCount(rows.length, players.length);
  }

  function renderTable(wrap, ctx, locked) {
    wrap.innerHTML = '';
    view.tbody = null;
    var players = ctx.players || [];
    if (players.length === 0 && !draft) {
      if (view.bar) view.bar.innerHTML = '';
      wrap.appendChild(emptyMessage('まだ選手がいません。「＋ 行を追加」か「📋 貼り付けて追加」で登録してください。'));
      return;
    }
    var table = document.createElement('table');
    table.className = 'desk-table desk-players-table';
    table.appendChild(buildHead(ctx));
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);
    view.tbody = tbody;
    fillRows(ctx, locked);
  }

  // 1 人 1 行。名前・コート・性別・新人・技は編集できる。
  // 巡・No.（order から導出）と得点は読み取り（得点は採点画面が書く）。
  function buildRow(ctx, p, locked) {
    var key = Courts.orderKey(p);
    var tr = document.createElement('tr');
    tr.appendChild(cell(String(Courts.roundOf(p)), 'num col-round'));
    tr.appendChild(cell(String(key.no || ''), 'num col-no'));
    tr.appendChild(nameCell(ctx, p, locked));
    tr.appendChild(courtCell(ctx, p, locked));
    tr.appendChild(sexCell(ctx, p, locked));
    tr.appendChild(newFaceCell(ctx, p, locked));
    tr.appendChild(techCell(ctx, p, locked, 1));
    tr.appendChild(techCell(ctx, p, locked, 2));
    tr.appendChild(techCell(ctx, p, locked, 3));
    tr.appendChild(cell(String(p.score || 0), 'num col-score'));
    var tdAct = document.createElement('td');
    tdAct.className = 'act';
    if (!locked) tdAct.appendChild(buildRowMenu(ctx, p));
    tr.appendChild(tdAct);
    return tr;
  }

  // --- セルの編集（1 項目ずつ保存する） ---

  // 保存に成功した選手をその場で差し替える。表は描き直さないので、
  // 次の保存の比較（Courts.scoreMayChange）が古い値を見ないようにする。
  function adopt(dst, src) {
    ['name', 'order', 'tech1', 'tech2', 'tech3', 'result'].forEach(function(k) {
      if (typeof src[k] === 'string') dst[k] = src[k];
    });
    if (typeof src.score === 'number') dst.score = src.score;
    dst.isFemale = src.isFemale === true;
    dst.isNewFace = src.isNewFace === true;
  }

  // セル 1 つの保存。patch は送る 1 項目だけ。
  //   revert : 失敗したときに表示を元へ戻す
  //   after  : 成功したときの追加処理（order が変わるセルは表を描き直す）
  // 失敗しても表は描き直さない（他のセルの入力途中を壊さないため）。
  async function saveCell(ctx, p, el, patch, revert, after) {
    // 採点済みの選手の性別・技は、採点画面が変更に気付けない（Courts.scoreMayChange 参照）
    if (Courts.scoreMayChange(p, patch) && !confirm(Courts.scoreChangeConfirmMessage(p))) {
      revert();
      return;
    }
    el.disabled = true;
    el.classList.add('saving');
    var res = await Api.updatePlayerInfo(ctx.eventId, p.id, patch);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた。DOM にも alert にも触らない
    el.disabled = false;
    el.classList.remove('saving');
    if (!res || !res.ok) {
      revert();
      if (res && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      } else {
        alert('保存できませんでした。\n入力内容と通信を確認してください。');
      }
      return;
    }
    if (res.player) adopt(p, res.player);
    Desk.toast('保存しました');
    if (after) after();
  }

  // 文字の入力（名前）。blur で保存し、Enter は blur に流す（二重送信しない）。
  // buildPatch(value) が null を返したら送らずに元へ戻す（理由は buildPatch が alert する）。
  function bindText(ctx, p, el, buildPatch, after) {
    var last = el.value;
    var busy = false;
    var composing = false;

    async function commit() {
      if (busy) return;
      var value = el.value.trim();
      el.value = value;
      if (value === last) return;
      var patch = buildPatch(value);
      if (!patch) { el.value = last; return; }
      busy = true;
      await saveCell(ctx, p, el, patch, function() { el.value = last; }, after);
      busy = false;
      if (ctx.isStale()) return;
      if (el.value === value) last = value;   // 成功（失敗なら revert で last に戻っている）
    }

    el.addEventListener('blur', function() { commit(); });
    el.addEventListener('compositionstart', function() { composing = true; });
    el.addEventListener('compositionend', function() { composing = false; });
    el.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      // IME 変換中の Enter は変換の確定。保存には使わない
      // （keyCode 229 は変換中を示す環境向けの保険）。
      if (composing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      el.blur();   // 保存は blur に一本化する
    });
  }

  // セレクト・チェックの保存（change で1回だけ）。
  //   readValue() : いまの値
  //   toPatch(v)  : 送るオブジェクト
  //   setValue(v) : 表示を書き戻す（失敗したときの巻き戻し）
  function bindChoice(ctx, p, el, initial, readValue, toPatch, setValue, after) {
    var last = initial;
    var busy = false;
    el.addEventListener('change', async function() {
      if (busy) return;
      var value = readValue();
      if (value === last) return;
      busy = true;
      await saveCell(ctx, p, el, toPatch(value), function() { setValue(last); }, after);
      busy = false;
      if (ctx.isStale()) return;
      if (readValue() === value) last = value;
    });
  }

  function nameCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-name';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'desk-cell-input';
    input.value = p.name || '';
    input.setAttribute('aria-label', '名前');
    input.disabled = locked;
    bindText(ctx, p, input, function(v) {
      if (!v) { alert('名前を入力してください。'); return null; }
      return { name: v };
    }, null);
    td.appendChild(input);
    return td;
  }

  var NEW_COURT = ' new';   // 「新しいコート…」の選択肢の値（コート名には使えない文字）

  // コートの選択肢。既存のコート＋その選手の今のコート＋「新しいコート…」。
  function fillCourtOptions(sel, ctx, current) {
    sel.innerHTML = '';
    var list = Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    if (current && list.indexOf(current) === -1) list.push(current);   // 未分類のままの選手も表示する
    list.forEach(function(c) { addOption(sel, c, c); });
    addOption(sel, NEW_COURT, '新しいコート…');
    sel.value = current;
  }

  function addOption(sel, value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
    return o;
  }

  function hasOption(sel, value) {
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === value) return true;
    }
    return false;
  }

  // 新しく作ったコートを「新しいコート…」の手前に足して選ぶ
  // （querySelector で値を探すとコート名の記号でセレクタが壊れるので options を舐める）。
  function insertCourtOption(sel, name) {
    if (!hasOption(sel, name)) {
      var o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      sel.insertBefore(o, sel.lastChild);
    }
    sel.value = name;
  }

  // 新しいコート名の入力。order は「コート-性別-巡目-番号」なので "-" と「未分類」は使えない。
  // 取りやめ・不正なら '' を返す（呼び出し側は選択を元に戻す）。
  function askCourtName() {
    var name = prompt('新しいコート名を入力してください（例: D）');
    if (name === null) return '';
    name = name.trim();
    if (!name) { alert('コート名を入力してください。'); return ''; }
    if (name.indexOf('-') >= 0) { alert('コート名に「-」は使えません。'); return ''; }
    if (name === Courts.UNASSIGNED) { alert('「' + Courts.UNASSIGNED + '」はコート名に使えません。'); return ''; }
    if (name.length > 32) { alert('コート名は32文字までです。'); return ''; }
    return name;
  }

  function courtCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-court';
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', 'コート');
    sel.disabled = locked;
    var cur = Courts.courtOf(p);
    fillCourtOptions(sel, ctx, cur);

    var last = cur;
    var busy = false;
    sel.addEventListener('change', async function() {
      if (busy) return;
      var value = sel.value;
      if (value === NEW_COURT) {
        var name = askCourtName();
        if (!name) { sel.value = last; return; }
        insertCourtOption(sel, name);
        value = name;
      }
      if (value === last) return;
      busy = true;
      // コートが変わると order が振り直される（番号が変わる）ので、表ごと読み直す
      await saveCell(ctx, p, sel, { court: value }, function() { sel.value = last; },
        function() { Desk.reloadEvent(); });
      busy = false;
      if (ctx.isStale()) return;
      if (sel.value === value) last = value;
    });
    td.appendChild(sel);
    return td;
  }

  function sexCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-sex';
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', '性別');
    sel.disabled = locked;
    addOption(sel, '男子', '男子');
    addOption(sel, '女子', '女子');
    var cur = Courts.sexOf(p);
    sel.value = cur;
    // 性別が変わると order が振り直される（男女で採番が別）ので、表ごと読み直す
    bindChoice(ctx, p, sel, cur,
      function() { return sel.value; },
      function(v) { return { isFemale: v === '女子' }; },
      function(v) { sel.value = v; },
      function() { Desk.reloadEvent(); });
    td.appendChild(sel);
    return td;
  }

  function newFaceCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-new';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'desk-cell-check';
    chk.checked = !!p.isNewFace;
    chk.setAttribute('aria-label', '新人');
    chk.disabled = locked;
    bindChoice(ctx, p, chk, !!p.isNewFace,
      function() { return chk.checked; },
      function(v) { return { isNewFace: v }; },
      function(v) { chk.checked = v; },
      null);
    td.appendChild(chk);
    return td;
  }

  // 技の選択肢は「その選手の性別で絞った技リスト」＋空（技を消せるように）。
  // 性別が変わって保存されると行ごと Desk.reloadEvent() で作り直されるので、
  // ここは呼ばれるたびに p.isFemale で絞り直せばよい（作り直しは呼び出し側任せ）。
  // 選手が持っている技がリストに無い場合（接尾辞付きの旧データ・技リストを
  // 入れ替えた後など）は、黙って空にしないよう、その名前も選択肢に足す。
  function techCell(ctx, p, locked, slot) {
    var td = document.createElement('td');
    td.className = 'col-tech';
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', '技' + slot);
    sel.disabled = locked;
    var cur = p['tech' + slot] || '';
    addOption(sel, '', '—');
    var found = false;
    Courts.techniqueOptions(ctx.techniques, !!p.isFemale).forEach(function(t) {
      var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
      if (!n) return;
      addOption(sel, n, n);
      if (n === cur) found = true;
    });
    if (cur && !found) addOption(sel, cur, cur + '（リストに無い技）');
    sel.value = cur;
    bindChoice(ctx, p, sel, cur,
      function() { return sel.value; },
      function(v) {
        var patch = {};
        patch['tech' + slot] = v;
        return patch;
      },
      function(v) { sel.value = v; },
      null);
    td.appendChild(sel);
    return td;
  }

  // --- 「＋ 行を追加」の下書き行 ---

  // 直前の行（いま表に出ている最後の行）からコート・性別・新人を引き継ぐ。
  // 表が空なら最初のコート（無ければ A）・男子・新人なし。
  function draftSeed(ctx) {
    var rows = Courts.sortBy(Courts.applyFilter(ctx.players || [], filter), sort);
    var last = rows.length ? rows[rows.length - 1] : null;
    var courts = Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    var court = last ? Courts.courtOf(last) : '';
    if (!court || court === Courts.UNASSIGNED) court = courts[0] || 'A';
    return {
      court: court,
      isFemale: last ? !!last.isFemale : false,
      isNewFace: last ? !!last.isNewFace : false
    };
  }

  function startDraft(ctx) {
    // 既に下書き行があるなら作り直さず、その行の名前欄にフォーカスを戻すだけ
    // （連打で下書きの入力途中の値やコート・性別・新人の選択を捨てないため）。
    if (!draft) {
      draft = draftSeed(ctx);
      redrawTable();
    }
    var input = view && view.wrap.querySelector('.desk-draft-row input[type="text"]');
    if (input) input.focus();
  }

  function cancelDraft() {
    draft = null;
    redrawTable();
  }

  // 下書き行。サーバーにはまだ無いので、保存するのは名前を確定したとき 1 回だけ。
  // コート・性別・新人・技はその場の値を持つだけで、通信はしない。
  function buildDraftRow(ctx) {
    var d = {
      name: '', court: draft.court, isFemale: draft.isFemale, isNewFace: draft.isNewFace,
      tech1: '', tech2: '', tech3: ''
    };
    var tr = document.createElement('tr');
    tr.className = 'desk-draft-row';
    tr.appendChild(cell('1', 'num col-round'));    // 追加は常に一巡目（二巡目は生成 API が作る）
    tr.appendChild(cell('—', 'num col-no'));       // 番号はサーバーが採番する

    var tdName = document.createElement('td');
    tdName.className = 'col-name';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'desk-cell-input';
    input.placeholder = '名前を入れて Enter';
    input.setAttribute('aria-label', '追加する選手の名前');
    tdName.appendChild(input);
    tr.appendChild(tdName);

    // コート
    var tdCourt = document.createElement('td');
    tdCourt.className = 'col-court';
    var selCourt = document.createElement('select');
    selCourt.className = 'desk-cell-select';
    selCourt.setAttribute('aria-label', 'コート');
    fillCourtOptions(selCourt, ctx, d.court);
    selCourt.addEventListener('change', function() {
      if (selCourt.value === NEW_COURT) {
        var name = askCourtName();
        if (!name) { selCourt.value = d.court; return; }
        insertCourtOption(selCourt, name);
      }
      d.court = selCourt.value;
    });
    tdCourt.appendChild(selCourt);
    tr.appendChild(tdCourt);

    // 技 1〜3 のセレクトはあとで性別を切り替えたときに作り直す（候補を絞り直す）ので、
    // 先に配列へ控えておく。
    var techSelects = [];
    function fillTechOptions(sel) {
      var cur = sel.value;
      sel.innerHTML = '';
      addOption(sel, '', '—');
      Courts.techniqueOptions(ctx.techniques, d.isFemale).forEach(function(t) {
        var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
        if (n) addOption(sel, n, n);
      });
      sel.value = cur || '';
    }

    // 性別
    var tdSex = document.createElement('td');
    tdSex.className = 'col-sex';
    var selSex = document.createElement('select');
    selSex.className = 'desk-cell-select';
    selSex.setAttribute('aria-label', '性別');
    addOption(selSex, '男子', '男子');
    addOption(selSex, '女子', '女子');
    selSex.value = d.isFemale ? '女子' : '男子';
    selSex.addEventListener('change', function() {
      d.isFemale = (selSex.value === '女子');
      // 候補が変わるので技セレクトを作り直す（選んだ技名は接尾辞を外した形なので、
      // たいていはそのまま選び直せる。無ければ空に戻る）。
      techSelects.forEach(function(sel, i) {
        fillTechOptions(sel);
        d['tech' + (i + 1)] = sel.value;
      });
    });
    tdSex.appendChild(selSex);
    tr.appendChild(tdSex);

    // 新人
    var tdNew = document.createElement('td');
    tdNew.className = 'col-new';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'desk-cell-check';
    chk.checked = d.isNewFace;
    chk.setAttribute('aria-label', '新人');
    chk.addEventListener('change', function() { d.isNewFace = chk.checked; });
    tdNew.appendChild(chk);
    tr.appendChild(tdNew);

    // 技 1〜3
    [1, 2, 3].forEach(function(slot) {
      var td = document.createElement('td');
      td.className = 'col-tech';
      var sel = document.createElement('select');
      sel.className = 'desk-cell-select';
      sel.setAttribute('aria-label', '技' + slot);
      fillTechOptions(sel);
      sel.addEventListener('change', function() { d['tech' + slot] = sel.value; });
      td.appendChild(sel);
      tr.appendChild(td);
      techSelects.push(sel);
    });

    tr.appendChild(cell('—', 'num col-score'));
    tr.appendChild(cell('', 'act'));

    var busy = false;
    // create() が成功した後の印。busy=false から Desk.reloadEvent() の完了までの間に
    // 入力が再有効化されている隙間があり、そこでもう一度 Enter を送ると同じ行から
    // create() が二重に呼ばれて同名選手が2人登録される（確認で見つかった）。
    // 成功経路では busy を戻さず入力も disabled のままにし、この行は reloadEvent が
    // 作り直すのに任せる。done はその意図を先頭で弾くための明示の印（busy に頼り
    // きらない）。失敗経路だけ busy を戻して入力を再有効化し、打ち直せるようにする。
    var done = false;
    var composing = false;

    function setDisabled(flag) {
      [input, selCourt, selSex, chk].forEach(function(el) { el.disabled = flag; });
      var sels = tr.querySelectorAll('.col-tech select');
      for (var i = 0; i < sels.length; i++) sels[i].disabled = flag;
    }

    async function create() {
      if (busy || done) return;
      var name = input.value.trim();
      if (!name) { cancelDraft(); return; }
      var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する（貼り付け・CSV と同じ規約）
      busy = true;
      setDisabled(true);
      var result = await Api.createPlayer(eventId, {
        name: name, court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace,
        tech1: d.tech1, tech2: d.tech2, tech3: d.tech3, round: 1
      });
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
      if (result && result.player === null) {
        // 409（いまは確定済みガードだけ）。行は残す（入力を失わせない）。打ち直せるよう戻す。
        busy = false;
        setDisabled(false);
        if (result.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else {
          alert(result.error);
        }
        return;
      }
      if (!result) {
        // 通信失敗など。打ち直せるよう戻す。
        busy = false;
        setDisabled(false);
        alert('選手を追加できませんでした。\n入力内容と通信を確認してください。');
        return;
      }
      // 成功。busy はそのまま（true）、入力も disabled のままにして、
      // この行からの再送・再描画までの隙間の二重送信を防ぐ。
      done = true;
      Desk.toast(result.order + ' ' + result.name + ' を追加しました');
      // 続けて打ち込めるよう、同じコート・性別・新人でもう 1 行出す
      draft = { court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace };
      await Desk.reloadEvent();
      // reloadEvent は必ず renderSeq を上げるので、ここでは ctx.isStale() ではなく
      // 「大会が変わったか」で見る（貼り付け・CSV と同じ規約）。
      if (Desk.currentEventId() !== eventId) return;
      // reloadEvent が取得に失敗すると再描画されず、登録済みの名前が入った行が
      // 無効のまま残る（実ブラウザでは Esc も届かない）。登録自体は済んでいるので畳む。
      if (tr.isConnected) { cancelDraft(); return; }
      var next = view && view.wrap.querySelector('.desk-draft-row input[type="text"]');
      if (next) next.focus();
    }

    input.addEventListener('compositionstart', function() { composing = true; });
    input.addEventListener('compositionend', function() { composing = false; });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { e.preventDefault(); cancelDraft(); return; }
      if (e.key !== 'Enter') return;
      if (composing || e.isComposing || e.keyCode === 229) return;   // IME 変換中の Enter は確定
      e.preventDefault();
      create();
    });
    input.addEventListener('blur', function() {
      // 行の中で Tab 移動しただけなら消さない。フォーカスが行の外へ出たときだけ判断する。
      setTimeout(function() {
        if (busy || !tr.parentNode) return;
        if (tr.contains(document.activeElement)) return;
        if (input.value.trim()) create();
        else cancelDraft();
      }, 0);
    });

    return tr;
  }

  // --- 「📋 貼り付けて追加」（Excel からの一括登録） ---

  // 1 行の下見（プレビュー）。取り込めない行は赤く、技リストに無い技名も赤くする。
  function pasteLine(row) {
    var div = document.createElement('div');
    div.className = 'desk-paste-line' + (row.ok ? '' : ' bad');
    var head = document.createElement('span');
    head.textContent = row.line + ': ' + row.name + '　';
    div.appendChild(head);
    // 補ったコートだけ薄く出す（貼った値と区別する）。取り込めない行は行ごと赤いので、
    // その行では赤より薄い色が勝つが、断る理由は行末に出るので紛れない。
    var court = document.createElement('span');
    court.textContent = row.court || '—';
    if (row.courtFilled) court.className = 'desk-paste-filled';
    div.appendChild(court);
    var mid = document.createElement('span');
    mid.textContent = '　' + (row.isFemale ? '女子' : '男子') + (row.isNewFace ? '　新人' : '') + '　';
    div.appendChild(mid);
    row.techs.forEach(function(t, i) {
      var span = document.createElement('span');
      span.textContent = (i > 0 ? '・' : '') + (t || '—');
      if (t && row.badTechs.indexOf(t) !== -1) span.className = 'desk-paste-bad';
      div.appendChild(span);
    });
    if (!row.ok) {
      var why = document.createElement('span');
      why.textContent = '　← ' + row.error;
      div.appendChild(why);
    }
    return div;
  }

  function openPasteDialog(ctx) {
    var body = document.createElement('div');

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'Excel の範囲をそのまま貼り付けられます。列は 名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 の順' +
      '（タブ区切りかカンマ区切り）。1 行目が「名前」で始まるときは見出しとして読み飛ばします。' +
      '性別は「女子」「女」「F」が女子、それ以外は男子。新人は「新人」「○」「1」「true」。' +
      '技はこの大会の技リストにある名前だけです。' +
      '名前だけの行でも登録できます（足りない列は 男子・新人なし・技は空。コートは下のセレクトの値）。';
    body.appendChild(note);

    // 「コートが空の行に使うコート」。既存コート（未分類は除く）＋「新しいコート…」。
    // 初期値は既存コートの先頭。大会にコートがまだ無ければ空（コート列が空の行は赤くなる）。
    var courtRow = document.createElement('p');
    courtRow.className = 'desk-paste-court';
    var courtLabel = document.createElement('label');
    courtLabel.textContent = 'コートが空の行に使うコート';
    var selDefault = document.createElement('select');
    selDefault.setAttribute('aria-label', 'コートが空の行に使うコート');
    var courtList = Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    addOption(selDefault, '', '（指定しない）');
    courtList.forEach(function(c) { addOption(selDefault, c, c); });
    addOption(selDefault, NEW_COURT, '新しいコート…');
    selDefault.value = courtList[0] || '';
    var lastDefault = selDefault.value;
    courtLabel.appendChild(selDefault);
    courtRow.appendChild(courtLabel);
    body.appendChild(courtRow);

    var ta = document.createElement('textarea');
    ta.className = 'desk-paste';
    ta.setAttribute('aria-label', '貼り付ける選手の一覧');
    ta.placeholder = '山田 太郎\n佐藤 花子\tA\t女子\t\t…';
    body.appendChild(ta);

    var summary = document.createElement('p');
    summary.className = 'desk-paste-count';
    body.appendChild(summary);

    var preview = document.createElement('div');
    preview.className = 'desk-paste-preview';
    body.appendChild(preview);

    var btnAdd = document.createElement('button');
    btnAdd.type = 'button';
    btnAdd.className = 'desk-btn primary';
    btnAdd.textContent = '登録';

    var dialog = Desk.openDialog('貼り付けて追加', body, [btnAdd]);
    var okRows = [];
    var ngCount = 0;

    // 「新しいコート…」が選ばれたままの値をそのまま既定コートにしない
    function defaultCourt() {
      return selDefault.value === NEW_COURT ? '' : selDefault.value;
    }

    function update() {
      var parsed = Courts.parsePasteRows(ta.value, ctx.techniques || [], { court: defaultCourt() });
      okRows = parsed.rows.filter(function(r) { return r.ok; });
      ngCount = parsed.rows.length - okRows.length;
      summary.textContent = okRows.length + ' 人を登録します' +
        (ngCount > 0 ? '（取り込めない行が ' + ngCount + ' 行あります）' : '');
      summary.className = 'desk-paste-count' + (ngCount > 0 ? ' desk-paste-bad' : '');
      preview.innerHTML = '';
      parsed.rows.forEach(function(r) { preview.appendChild(pasteLine(r)); });
      btnAdd.disabled = okRows.length === 0;
    }
    selDefault.addEventListener('change', function() {
      if (selDefault.value === NEW_COURT) {
        var name = askCourtName();
        if (!name) { selDefault.value = lastDefault; update(); return; }
        insertCourtOption(selDefault, name);   // 「新しいコート…」の手前に足して選ぶ
      }
      lastDefault = selDefault.value;
      update();
    });
    ta.addEventListener('input', update);
    update();
    ta.focus();

    btnAdd.addEventListener('click', async function() {
      if (okRows.length === 0) return;
      if (okRows.length > 500) {
        alert('一度に登録できるのは 500 人までです（いまは ' + okRows.length + ' 人）。分けて貼り付けてください。');
        return;
      }
      var rows = okRows.map(function(r) {
        return {
          name: r.name, court: r.court, isFemale: r.isFemale, isNewFace: r.isNewFace,
          tech1: r.techs[0], tech2: r.techs[1], tech3: r.techs[2]
        };
      });
      if (!confirm(rows.length + ' 人を登録します。よろしいですか？' +
          (ngCount > 0 ? '\n取り込めない ' + ngCount + ' 行は登録しません。' : ''))) {
        return;
      }
      var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
      // 確認ダイアログの後・API 呼び出しの前で、大会が切り替わっていないか再確認する
      // （admin-players.js の一括登録と同じ規約。古い ctx の大会に書き込まない）。
      if (Desk.currentEventId() !== eventId) {
        alert('大会が切り替わったため、登録を中止しました。');
        return;
      }
      btnAdd.disabled = true;
      dialog.lock(true);
      var res = await Api.createPlayersBulk(eventId, { rows: rows });
      if (Desk.currentEventId() !== eventId) return;   // 大会が切り替わっていたら画面に触らない
      btnAdd.disabled = false;
      dialog.lock(false);
      if (!res || res.error) {
        // 失敗してもダイアログは閉じない（貼り付けた内容を残す）
        alert('登録できませんでした。\n' + ((res && res.error) || '入力内容と通信を確認してください。'));
        return;
      }
      Desk.toast(res.created + ' 人を登録しました');
      // 履歴（CSV 取り込み・スマホの一括登録と同じ形で残す）
      Api.addHistory(eventId, {
        action: 'bulk_add',
        detail: res.created + '名の選手を一括登録'
      });
      dialog.close();
      Desk.reloadEvent();
    });
  }

  // --- 「⋯」メニュー（行の削除・CSV 取り込み） ---

  // details/summary の外側をクリックしたら閉じる。document への登録は 1 回だけ
  // （描画のたびにリスナーが積み重ならないように）。desk-events.js と同じ作り。
  var outsideClickBound = false;
  function bindOutsideClickOnce() {
    if (outsideClickBound) return;
    outsideClickBound = true;
    document.addEventListener('click', function(e) {
      var menus = document.querySelectorAll('.desk-menu[open]');
      for (var i = 0; i < menus.length; i++) {
        if (!menus[i].contains(e.target)) menus[i].open = false;
      }
    });
  }

  function menuItem(menu, label, onClick, disabledReason) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (disabledReason) {
      b.disabled = true;
      b.title = disabledReason;
    } else {
      b.addEventListener('click', function() {
        menu.open = false;
        onClick();
      });
    }
    return b;
  }

  function buildMenu(label) {
    bindOutsideClickOnce();
    var menu = document.createElement('details');
    menu.className = 'desk-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    sum.setAttribute('aria-label', label);
    menu.appendChild(sum);
    var body = document.createElement('div');
    body.className = 'desk-menu-body';
    menu.appendChild(body);
    return { el: menu, body: body };
  }

  function buildHeadMenu(ctx, locked) {
    var menu = buildMenu('選手のメニュー');
    menu.body.appendChild(menuItem(menu.el, '📄 CSV を取り込む', function() {
      Storage.pickCsvFile(function(text) { return importCsvText(ctx, text); });
    }, locked ? 'この大会は最終結果を確定済みです' : ''));
    return menu.el;
  }

  function buildRowMenu(ctx, p) {
    var menu = buildMenu((p.name || '') + ' の操作');
    menu.body.appendChild(menuItem(menu.el, '🗑 削除', function() { onDelete(ctx, p); }));
    return menu.el;
  }

  // 削除の二重実行ガード。confirm() が開いている間やサーバーとの通信中に、
  // 別の行やもう一度同じ行から重ねて呼ばれても弾く（画面全体で 1 件ずつ）。
  var deleteBusy = false;

  // 削除。採点済みは 409 で得点を返してくるので、もう一度確認して force で消す
  // （admin-players.js の編集シートと同じ流れ・同じ文言）。
  async function onDelete(ctx, p) {
    if (deleteBusy) return;
    deleteBusy = true;
    try {
      // 一巡目の行だけ「二巡目の行は残ります」と断る（二巡目の行自体を消すときは不要）
      var roundFragment = (Courts.roundOf(p) === 1) ? '二巡目の行は残ります。\n' : '';
      if (!confirm(
        '選手「' + (p.name || '') + '」（' + (p.order || '') + '）を削除します。\n' +
        roundFragment +
        'よろしいですか？'
      )) return;

      var res = await Api.deletePlayer(ctx.eventId, p.id, false);
      if (ctx.isStale()) return;

      if (res && res.blocked && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        return;
      }
      if (res && res.blocked) {
        // 採点済みガード。得点を出してもう一度確認し、承諾したときだけ force。
        var bp = res.player || { name: p.name, order: p.order, score: p.score };
        if (!confirm(
          '「' + bp.name + '」（' + bp.order + '）は採点済みです（' + bp.score + '点）。\n' +
          '削除すると採点結果は戻せません。' + roundFragment + '\n' +
          '本当に削除しますか？'
        )) return;
        res = await Api.deletePlayer(ctx.eventId, p.id, true);
        if (ctx.isStale()) return;
      }
      if (res !== true) {
        alert('選手の削除に失敗しました。');
        return;
      }
      Desk.toast('削除しました');
      await Desk.reloadEvent();
    } finally {
      deleteBusy = false;
    }
  }

  // CSV 取り込み（admin-players.js と同じ流れ）。
  // 確認ダイアログをはさむので、書き込みの直前に必ず大会が同じか見る。
  async function importCsvText(ctx, text) {
    var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
    var eventName = (ctx.event && ctx.event.name) || '';
    var mode = 'replace';
    if ((ctx.players || []).length > 0) {
      mode = confirm(
        '大会「' + eventName + '」に読み込みます。' +
        '既存データをクリアして読み込みますか？（キャンセルで追記）'
      ) ? 'replace' : 'append';
      if (mode === 'append') {
        if (!confirm(
          '既存の ' + ctx.players.length + ' 名に追記します。' +
          '同じ順番の選手がいると重複します。追記しますか？'
        )) return;
      }
    }
    if (Desk.currentEventId() !== eventId) {
      alert('大会が切り替わったため、CSV の読み込みを中止しました。');
      return;
    }
    var result = await Api.importCsv(eventId, text, mode);
    if (Desk.currentEventId() !== eventId) return;
    if (result && result.blocked && result.reason === 'locked') {
      alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      return;
    }
    if (result && result.blocked) {
      if (!confirm(
        '大会「' + eventName + '」\n' +
        'この大会には採点済みの選手が少なくとも ' + result.scoredCount + ' 名います。\n' +
        '他のコート端末による採点も含まれます。\n' +
        '読み込みを続けると、これらの採点結果はすべて失われます。\n' +
        '本当に続行しますか？'
      )) return;
      if (Desk.currentEventId() !== eventId) {
        alert('大会が切り替わったため、CSV の読み込みを中止しました。');
        return;
      }
      result = await Api.importCsv(eventId, text, mode, true);
      if (Desk.currentEventId() !== eventId) return;
    }
    if (!result || !result.success) {
      alert('インポートに失敗しました。' + (result && result.error ? '\n' + result.error : ''));
      return;
    }
    Desk.toast(result.playerCount + '名を読み込みました');
    // 履歴記録（server/data/history に残す。CSV の一括登録は履歴を辿れるようにする）
    Api.addHistory(eventId, {
      action: 'csv_import',
      detail: result.playerCount + '名の選手データをインポート'
    });
    if (Desk.currentEventId() === eventId) Desk.reloadEvent();
  }

  // destroy: 区画から離れるときにポップオーバーを閉じる（document.body に置くので勝手には消えない）。
  // closePopover(refocus) は引数なしで呼ばれても popover が無ければ何もしないので、そのまま渡せる。
  Desk.registerTab('players', { render: render, destroy: closePopover });
})();
