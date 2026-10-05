// 選手の区画（#players/<id>）。編集できる表。
// ゼッケン・級位段位・真剣レンタルは名前のすぐ右の 3 列（設計書「選手の追加項目」）。
// レンタルの選手には「抜刀後」の形だけを技の候補に出す（Courts.techniqueOptions の第 3 引数）。
// 絞り込み・並べ替えはスマホ運営の選手登録タブと同じ純粋関数（Courts.applyFilter / Courts.sortBy）。
// 絞り込みは見出しの ▼（Excel 風）。スマホの admin-players.js はチップの帯のまま。
// セルの編集・行の追加・貼り付け・削除はこのあとのタスクで足す。
// 表は 男子の部・女子の部 × コート × 巡目 の帯に分け、帯の中は行の左端の掴み手（⋮⋮）の
// ドラッグで試技順を入れ替えられる（POST …/players/reorder。ユーザー要望 2026-09-30）。
(function() {
  // 絞り込みと並べ替えの状態。形は Courts.defaultFilter() / Courts.defaultSort()。
  // 大会が変われば既定に戻す。保存後の描き直し（Desk.reloadEvent）では保つ。
  var filter = null;
  var sort = null;
  var stateOwner = null;

  // 大会が持つコート一覧（基本情報で編集する settings.courts）。
  // 選手が 1 人もいないコートも候補に出したいので、Courts.listFrom の第 2 引数に渡す
  // （設計書 2026-09-21-home-launcher-design.md「コート一覧」）。
  // 絞り込み（courtPop・render 冒頭の整理）では使わない。あそこは「いまいる選手の
  // コート」を出す場所なので、選手 0 人のコートを混ぜても空の表になるだけ。
  function extraCourts(ctx) {
    return (ctx && ctx.event && ctx.event.settings && ctx.event.settings.courts) || [];
  }

  // いま描いている表。行の追加・削除や並べ替えで表だけを描き直すために覚えておく。
  // render のたびに入れ替える（古い ctx の DOM を触らない）。
  var view = null;   // { chips, wrap, ctx, locked }
  // いま表に出ている行数（絞り込み後）。セルを 1 つ保存したあとに
  // 「表示 n / N 名」を数え直すために覚えておく。
  var lastShown = 0;

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
    // 選手の追加項目。名前のすぐ右にまとめる（col-name は sticky なので、
    // その右に足すぶんには左端の固定に影響しない）。
    { key: 'bib', label: 'ゼッケン', cls: 'col-bib' },
    { label: '級位段位', cls: 'col-rank' },
    { label: 'レンタル', cls: 'col-rental' },
    { label: 'コート', cls: 'col-court', filter: 'court' },
    { label: '性別', cls: 'col-sex', filter: 'sex' },
    { label: '新人', cls: 'col-new', filter: 'newFace' },
    { label: '技1', cls: 'col-tech', filter: 'noTech' },
    { label: '技2', cls: 'col-tech', filter: 'noTech' },
    { label: '技3', cls: 'col-tech', filter: 'noTech' },
    // 二巡目の形の申請（一巡目の行の r2tech1〜3）。3 列のセレクトにすると表が 1280px に収まらないので、
    // 1 列に要約を出し、押すとポップオーバーで技 3 つを選ぶ（設計書 2026-10-03 6.1・D8）。
    { label: '二巡目の形', cls: 'col-r2', filter: 'r2' },
    { key: 'score', label: '得点', cls: 'col-score' },
    { label: '', cls: 'act' }
  ];

  // 級位・段位の候補（datalist）。自由入力も受けるので、この一覧は縛りではない。
  var RANKS = ['無級', '十級', '九級', '八級', '七級', '六級', '五級', '四級', '三級', '二級', '一級',
    '初段', '弐段', '参段', '四段', '五段', '六段', '七段', '八段', '九段', '十段'];
  var RANK_LIST_ID = 'deskRankList';

  // 級位段位のセルが list= で参照する datalist。render のたびに作り直す
  // （render は container.innerHTML = '' で前のを捨てるので id は重複しない）。
  function buildRankList() {
    var dl = document.createElement('datalist');
    dl.id = RANK_LIST_ID;
    RANKS.forEach(function(r) {
      var o = document.createElement('option');
      o.value = r;
      dl.appendChild(o);
    });
    return dl;
  }

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
      // 二巡目準備（形の登録）の段階で開いたら、見たいのは二巡目の行。
      // 大会を切り替えたときの初期値だけで、運営者が自分で変えた絞り込みは上書きしない。
      if (EventStatus.of(ctx.event) === 'round1_done' &&
          Courts.roundsOf(ctx.players).indexOf(2) !== -1) {
        filter.round = 2;
      }
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
    container.appendChild(buildRankList());   // 級位段位のセルが参照する候補

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
    // 「＋ 行を追加」は男子の部・女子の部それぞれの最下部に置く（fillRows の addRow。ユーザー要望 2026-09-30）
    if (!locked) {
      var btnPaste = document.createElement('button');
      btnPaste.type = 'button';
      btnPaste.className = 'desk-btn';
      btnPaste.textContent = '📋 貼り付けて追加';
      btnPaste.addEventListener('click', function() { openPasteDialog(ctx); });
      head.appendChild(btnPaste);
    }
    // CSV の取り込みは「⋯」メニューに隠さず直接のボタンにする（メニューの項目がこれ 1 つだけだったため。
    // ユーザー要望 2026-09-30）。確定済みの大会では押せない。
    var btnCsv = document.createElement('button');
    btnCsv.type = 'button';
    btnCsv.className = 'desk-btn';
    btnCsv.id = 'btnDeskPlayersCsv';
    btnCsv.textContent = '📄 選手を CSV から取り込む';
    btnCsv.disabled = locked;
    if (locked) btnCsv.title = 'この大会は最終結果を確定済みです';
    btnCsv.addEventListener('click', function() {
      Storage.pickCsvFile(function(text) { return importCsvText(ctx, text); });
    });
    head.appendChild(btnCsv);
    container.appendChild(head);

    // 工程表（試合開始 ▶ などの遷移ボタン）。試合進行・形登録と同じ部品を先頭に置く
    // （「試合開始」を探して迷わないように。ユーザー要望 2026-10-05）
    if (window.DeskMatch && DeskMatch.buildSteps) {
      container.appendChild(DeskMatch.buildSteps(EventStatus.of(ctx.event), ctx, { where: 'players' }));
    }

    // 二巡目準備の段階は、やることが「形を直す」なので二巡目の形登録の区画へ誘導する。
    if (EventStatus.of(ctx.event) === 'round1_done') {
      var guide = document.createElement('p');
      guide.className = 'desk-note';
      guide.id = 'playersRound1DoneGuide';
      guide.appendChild(document.createTextNode('いまは二巡目の形登録の段階です。'));
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'desk-btn-sub';
      go.textContent = '形登録へ →';
      go.addEventListener('click', function() { Desk.navigate('round2', ctx.eventId); });
      guide.appendChild(go);
      container.appendChild(guide);
    }

    if (locked) {
      var warn = document.createElement('p');
      warn.className = 'desk-warn';
      warn.textContent = 'この大会は最終結果を確定済みです。試合進行の「戻す」を押すと編集できます。';
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

  var FILTER_KINDS = ['round', 'name', 'court', 'sex', 'newFace', 'noTech', 'r2'];

  function isFilterActive(kind) {
    if (kind === 'r2') return !!filter.r2;
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
  // 下にはみ出すとき（表の下の方の行の「二巡目の形」など）は、ボタンの上に出す。
  function placePopover() {
    if (!popover) return;
    var r = popover.btn.getBoundingClientRect();
    var h = popover.el.offsetHeight;
    var top = r.bottom + 4;
    if (top + h > window.innerHeight - 8 && r.top - 4 - h >= 8) top = r.top - 4 - h;
    popover.el.style.top = top + 'px';
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
        return { value: r, label: roundLabel(r) };
      }), filter.round, 0, function(v) { filter.round = v; });
    }
    if (col.filter === 'sex') {
      return triPop([{ value: '男子', label: '男子' }, { value: '女子', label: '女子' }],
        filter.sex, '', function(v) { filter.sex = v; });
    }
    if (col.filter === 'newFace') {
      return flagPop('新人だけ', filter.newFace, function(v) { filter.newFace = v; });
    }
    if (col.filter === 'r2') {
      // 二巡目の形の申請（Courts.applyFilter の r2）。どちらか片方だけにすると二巡目の行は出ない
      // （二巡目の行は申請を持たない）。申請の入力漏れを確かめるのに使う（設計書 2026-10-03 6.1）。
      return triPop([{ value: 'yes', label: '申請あり' }, { value: 'no', label: '一巡目と同じ' }],
        filter.r2 || '', '', function(v) { filter.r2 = v; });
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

  // 試合開始で止まる理由の見出し（Courts.startBlockers の kind と対応）。
  // repeat（同じ形の回数制限。設計書 2026-09-20-rules-alignment-design.md）は
  // Courts.BLOCKER_LABELS の文言（「同じ形を2回以上選んでいる」）だと帯が長くなるので、
  // ここだけ短い「同じ形 2 回」にする（あとに renderCount が人数を続ける）。
  // r2〜 は二巡目の形の申請の誤り（設計書 2026-10-03 6.1。直す場所は「二巡目の形」の列の赤枠）。
  var BLOCKER_LABELS = {
    bib: 'ゼッケン未入力', rank: '級位段位未入力', rental: 'レンタル不可の形', repeat: '同じ形 2 回',
    unknownTech: '表に無い技',
    r2unknownTech: '二巡目: 表に無い技', r2repeat: '二巡目: 同じ形 2 回', r2rental: '二巡目: レンタル不可の形'
  };

  // 表の上の「表示 n / N 名」「ゼッケン未入力 n …」「絞り込みを解除」。
  // 件数は Courts.startBlockers をそのまま数えるので、「試合開始」で止まる条件と
  // 必ず一致する（絞り込みで隠れている行も数える。隠れたまま止まると理由が分からない）。
  function renderCount(shown, total) {
    if (!view || !view.bar) return;
    view.bar.innerHTML = '';
    var span = document.createElement('span');
    span.className = 'desk-players-count';
    span.textContent = '表示 ' + shown + ' / ' + total + ' 名';
    view.bar.appendChild(span);

    // 件数は一巡目の行だけを対象にする（bib/rank は startBlockers が一巡目だけ拾うが、
    // rental は巡目を見ないため、二巡目の行の技セルの赤枠に釣られて帯の件数が二重に
    // 膨らまないよう、渡す前にここで絞る。二巡目の行の赤枠自体は markRow 側の話なので
    // ここでは触らない）。
    var round1Players = (view.ctx.players || []).filter(function(p) { return Courts.roundOf(p) === 1; });
    var blockers = Courts.startBlockers(view.ctx.event, round1Players);
    if (blockers.length > 0) {
      var warn = document.createElement('span');
      warn.className = 'desk-players-blockers';
      warn.textContent = blockers.map(function(b) {
        return (BLOCKER_LABELS[b.kind] || b.kind) + ' ' + b.players.length;
      }).join('　');
      warn.title = 'この件数が残っていると「試合開始」で止まります';
      view.bar.appendChild(warn);
    }

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
  // 帯の行（男子の部・女子の部 × コート × 巡目 で表を分けて見せる）
  function sexRow(label) {
    var tr = document.createElement('tr');
    tr.className = 'desk-sex-row';
    var td = document.createElement('td');
    td.colSpan = COLUMNS.length;
    td.textContent = label;
    tr.appendChild(td);
    return tr;
  }

  // 帯と帯の間の空き行（枠線なし・紙面の地色）
  function gapRow() {
    var tr = document.createElement('tr');
    tr.className = 'desk-sex-gap';
    var td = document.createElement('td');
    td.colSpan = COLUMNS.length;
    tr.appendChild(td);
    return tr;
  }

  // 各部の末尾の「＋ 行を追加」の行。押すとその部（性別）の下書き行を出す
  function addRow(ctx, female) {
    var tr = document.createElement('tr');
    tr.className = 'desk-add-row';
    var td = document.createElement('td');
    td.colSpan = COLUMNS.length;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'desk-btn-sub';
    b.textContent = '＋ 行を追加（' + (female ? '女子' : '男子') + '）';
    b.addEventListener('click', function() { startDraft(ctx, female); });
    td.appendChild(b);
    tr.appendChild(td);
    return tr;
  }

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

  // 巡目・コートの帯の文言
  function roundLabel(r) {
    return r === 1 ? '一巡目' : r === 2 ? '二巡目' : r + '巡目';
  }

  function courtLabel(c) {
    return c === Courts.UNASSIGNED ? c : c + ' コート';
  }

  // 1 つの部（性別）の行を「コート×巡目」の帯に分ける。
  // 帯の並びはコート名の昇順（Courts.listFrom の順。未分類は末尾）→ 巡目の昇順。
  // 帯の中の行は渡された順（＝見出しで選んだ並べ替え）のまま。
  // 戻り値: [{ court, round, rows }]（0 名の帯は無い）
  function divisionBands(rows) {
    var courts = Courts.listFrom(rows);
    var map = Object.create(null);   // コート名が 'constructor' などでも壊れないように
    var bands = [];
    rows.forEach(function(p) {
      var court = Courts.courtOf(p);
      var round = Courts.roundOf(p);
      var key = court + '\n' + round;
      if (!map[key]) {
        map[key] = { court: court, round: round, rows: [] };
        bands.push(map[key]);
      }
      map[key].rows.push(p);
    });
    return bands.sort(function(a, b) {
      var c = courts.indexOf(a.court) - courts.indexOf(b.court);
      return c !== 0 ? c : a.round - b.round;
    });
  }

  // 行と件数だけ作り直す（見出しはそのまま）。
  function fillRows(ctx, locked) {
    var tbody = view && view.tbody;
    if (!tbody) return;
    tbody.innerHTML = '';
    clearDrag();   // 描き直すとドラッグ中の行は DOM から外れる
    var players = ctx.players || [];
    var rows = Courts.sortBy(Courts.applyFilter(players, filter), sort);
    // 男子の部・女子の部を、さらに コート×巡目 の帯に分けて見せる（ユーザー要望 2026-09-30）。
    // No.（試技順）は コート×性別×巡目 ごとに 1 から振るので、帯の中では No. が 1 からの連番になる。
    // 並べ替え・絞り込みは帯の中に効き、それぞれの先頭に帯の行（部・コート・巡目と人数）を置く。
    if (rows.length === 0 && !draft && players.length > 0) tbody.appendChild(noMatchRow());
    // 各部の末尾に「＋ 行を追加」を置き、下書き行はその部の中に出す（性別は部で決まる）。
    // 編集できる大会では 0 名の部も帯（「男子の部　0 名」）と追加ボタンを出す（最初の 1 人を足せるように）。
    // 確定済みでは 0 名の部を出さない。0 名のコート×巡目の帯は出さない。
    var shown = 0;
    [['男子の部', false], ['女子の部', true]].forEach(function(g) {
      var female = g[1];
      var inDivision = rows.filter(function(p) { return (p.isFemale === true) === female; });
      var hasDraft = !!draft && !locked && draft.isFemale === female;
      if (inDivision.length === 0 && locked) return;
      var bands = divisionBands(inDivision);
      if (bands.length === 0) {
        if (shown++ > 0) tbody.appendChild(gapRow());
        tbody.appendChild(sexRow(g[0] + '　0 名'));
      }
      bands.forEach(function(b) {
        // 帯と帯の間に少し間を空ける（ユーザー要望 2026-09-30）
        if (shown++ > 0) tbody.appendChild(gapRow());
        tbody.appendChild(sexRow(g[0] + '　' + courtLabel(b.court) + '　' + roundLabel(b.round) +
          '　' + b.rows.length + ' 名'));
        var band = { court: b.court, isFemale: female, round: b.round, rows: b.rows };
        band.blocked = dragBlockReason(ctx, band);
        b.rows.forEach(function(p) { tbody.appendChild(buildRow(ctx, p, locked, band)); });
      });
      // 下書き行は絞り込みに関わらず必ず出す（打ち込んでいる途中で消えない）
      if (hasDraft) tbody.appendChild(buildDraftRow(ctx));
      if (!locked) tbody.appendChild(addRow(ctx, female));
    });
    lastShown = rows.length;   // afterRowEdit が件数だけ描き直すときに使う
    renderCount(rows.length, players.length);
  }

  // --- 行のドラッグで試技順を入れ替える（ユーザー要望 2026-09-30） ---
  // 同じ帯（＝同じ コート×性別×巡目）の中で入れ替え、落としたらその帯の No. を
  // 上から 1, 2, 3 … に振り直して保存する（POST …/players/reorder）。
  // 同じ部・同じ巡目の別のコートの帯にも落とせる（ユーザー要望 2026-10-05）: 先にコートを変え
  // （PATCH court。サーバーは移動先の末尾の番号を付ける）、移動先の帯を落とした位置で並べ直し、
  // 元の帯の番号も詰める（moveRowToBand）。性別や巡目をまたぐドロップは受け付けない
  // （性別は行の削除と追加で行う）。
  // 掴めるのは行の左端の掴み手（⋮⋮）だけ。行全体を draggable にすると、行の中の入力欄で
  // 文字を選ぶ操作がドラッグに化けるため。

  var drag = null;          // null | { tr, band }  いまドラッグしている行
  var dropMark = null;      // null | tr  線を出している行
  var reorderBusy = false;  // 保存の通信中（二重送信を防ぐ。通信中はどの帯も掴めない）

  // その帯をドラッグで並べ替えられないときの理由（ツールチップの文言）。できるなら ''。
  //   ・見出しで No. 以外の並べ替え（名前順など）を選んでいる
  //   ・絞り込みで帯の行が欠けている（全行を送らないとサーバーが 400 にする）
  //   ・order が「コート-性別-巡目-番号」の形でない行がある（CSV 由来の空の order など）
  function dragBlockReason(ctx, band) {
    if (!sort || sort.key !== 'order' || sort.dir !== 'asc') return 'No. 順のときに並べ替えできます';
    var all = (ctx.players || []).filter(function(p) {
      return (p.isFemale === true) === band.isFemale &&
        Courts.courtOf(p) === band.court && Courts.roundOf(p) === band.round;
    });
    if (all.length !== band.rows.length) return '絞り込みを解除すると並べ替えできます';
    var sex = band.isFemale ? 1 : 0;
    var broken = band.court === Courts.UNASSIGNED || band.rows.some(function(p) {
      return Courts.orderKey(p).sex !== sex;
    });
    if (broken) return 'この帯には番号の形式が崩れた行があるため並べ替えできません';
    return '';
  }

  // 行の左端の掴み手。並べ替えできない帯では薄くして、理由をツールチップに出す。
  function dragHandle(ctx, tr, band) {
    var h = document.createElement('span');
    h.className = 'drag-handle';
    h.textContent = '⋮⋮';
    if (band.blocked) {
      h.classList.add('disabled');
      h.title = band.blocked;
      return h;
    }
    h.draggable = true;
    h.title = 'ドラッグで試技順を入れ替えます';
    h.addEventListener('dragstart', function(e) {
      if (reorderBusy) { e.preventDefault(); return; }
      closePopover();
      drag = { tr: tr, band: band };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Firefox は何か setData しないとドラッグが始まらない
        try { e.dataTransfer.setData('text/plain', tr.dataset.playerId || ''); } catch (err) { /* 無視 */ }
        // 掴み手だけでなく行ごと動いて見えるように
        try { e.dataTransfer.setDragImage(tr, 12, Math.round(tr.offsetHeight / 2)); } catch (err) { /* 無視 */ }
      }
      tr.classList.add('dragging');
    });
    h.addEventListener('dragend', function() { clearDrag(); });
    return h;
  }

  function setDropMark(tr, after) {
    if (dropMark && dropMark !== tr) dropMark.classList.remove('drop-before', 'drop-after');
    dropMark = tr;
    tr.classList.toggle('drop-before', !after);
    tr.classList.toggle('drop-after', after);
  }

  function clearDropMark() {
    if (dropMark) dropMark.classList.remove('drop-before', 'drop-after');
    dropMark = null;
  }

  function clearDrag() {
    if (drag && drag.tr) drag.tr.classList.remove('dragging');
    drag = null;
    clearDropMark();
  }

  // 行の上半分なら「その前」、下半分なら「その後」に落とす
  function isAfter(tr, e) {
    var r = tr.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  }

  // 落とし先にできる帯か: 同じ帯（並べ替え）か、同じ部・同じ巡目の別のコート（コートの移動）。
  // 帯の比較は band オブジェクトの同一性（fillRows の 1 回の描画で帯ごとに 1 つ）。
  function canDropOnBand(from, to) {
    if (!from || !to) return false;
    if (from === to) return true;
    return !to.blocked && to.court !== Courts.UNASSIGNED &&
      to.isFemale === from.isFemale && to.round === from.round;
  }

  // 落とせる帯の行だけを落とし先にする（dragover で preventDefault しない行には落とせない）。
  function bindDropTarget(ctx, tr, band) {
    tr.addEventListener('dragover', function(e) {
      if (!drag || !canDropOnBand(drag.band, band)) { clearDropMark(); return; }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      setDropMark(tr, isAfter(tr, e));
    });
    tr.addEventListener('drop', function(e) {
      if (!drag || !canDropOnBand(drag.band, band)) return;
      e.preventDefault();
      var moving = drag.tr;
      var fromBand = drag.band;
      var after = isAfter(tr, e);
      clearDrag();
      if (fromBand === band) dropRow(ctx, band, moving, tr, after);
      else moveRowToBand(ctx, fromBand, band, moving, tr, after);
    });
  }

  // 別のコートの帯に落とした（コートの移動）。先に表の上で行を動かして見せ、
  // (1) コートを変える（PATCH court。移動先の末尾の番号になる）→ (2) 移動先の帯を落とした位置で並べ直す
  // → (3) 元の帯の番号を詰める、の順に保存し、最後に大会を読み直す。途中で失敗したら読み直して今の状態を出す
  // （(1) が済んでいればコートは移っている）。
  async function moveRowToBand(ctx, fromBand, toBand, moving, target, after) {
    if (reorderBusy) return;
    var movingId = moving.dataset.playerId;
    var targetIds = toBand.rows.map(function(p) { return p.id; });
    var to = targetIds.indexOf(target.dataset.playerId);
    if (to === -1 || fromBand.rows.every(function(p) { return p.id !== movingId; })) return;
    targetIds.splice(after ? to + 1 : to, 0, movingId);
    var sourceIds = fromBand.rows.map(function(p) { return p.id; }).filter(function(id) { return id !== movingId; });

    var msg = courtLabel(fromBand.court) + ' から ' + courtLabel(toBand.court) + ' へ移します。';
    if (EventStatus.isScoringOpen(EventStatus.of(ctx.event))) {
      msg += '\n採点中です。両方のコートの呼び出し順（No.）が変わります。';
    }
    if (!confirm(msg + '\nよろしいですか？')) return;
    target.parentNode.insertBefore(moving, after ? target.nextSibling : target);
    renumberShown(targetIds);
    renumberShown(sourceIds);

    var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
    reorderBusy = true;
    if (view && view.tbody) view.tbody.classList.add('reorder-saving');
    try {
      var res = await Api.updatePlayerInfo(eventId, movingId, { court: toBand.court });
      if (ctx.isStale()) return;
      if (!res || !res.ok) {
        if (res && res.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else {
          alert('コートを移せませんでした。\n' + ((res && res.error) || '通信を確認してください。'));
        }
        redrawTable();   // 元の並びに戻す
        return;
      }
      var r2 = await Api.reorderPlayers(eventId, {
        court: toBand.court, isFemale: toBand.isFemale, round: toBand.round, ids: targetIds
      });
      if (ctx.isStale()) return;
      var r3 = null;
      if (r2 && r2.ok && sourceIds.length > 0) {
        r3 = await Api.reorderPlayers(eventId, {
          court: fromBand.court, isFemale: fromBand.isFemale, round: fromBand.round, ids: sourceIds
        });
        if (ctx.isStale()) return;
      }
      if (!r2 || !r2.ok || (sourceIds.length > 0 && (!r3 || !r3.ok))) {
        // コートは移った。番号は移動先の末尾（または元の帯に欠番）のまま。最新を読み直して出す
        alert('コートは移しましたが、試技順を保存できませんでした。\n最新の並びを読み直します。');
        await Desk.reloadEvent();
        return;
      }
      Desk.toast(courtLabel(toBand.court) + ' へ移して試技順を保存しました');
      await Desk.reloadEvent();
    } finally {
      reorderBusy = false;
      if (view && view.tbody && Desk.currentEventId() === eventId) view.tbody.classList.remove('reorder-saving');
    }
  }

  // 落としたあと。先に表の上で行を動かして No. を振り直して見せ、保存する。
  // 成功したら大会を読み直して表を描き直し、失敗したら元の並び（ctx.players は変えていない）に戻す。
  async function dropRow(ctx, band, moving, target, after) {
    if (reorderBusy || moving === target) return;
    var before = band.rows.map(function(p) { return p.id; });
    var ids = before.slice();
    var movingId = moving.dataset.playerId;
    var from = ids.indexOf(movingId);
    if (from === -1 || ids.indexOf(target.dataset.playerId) === -1) return;
    ids.splice(from, 1);
    var to = ids.indexOf(target.dataset.playerId);
    ids.splice(after ? to + 1 : to, 0, movingId);
    if (ids.join('\n') === before.join('\n')) return;   // 並びが変わらない（自分のすぐ上下に落とした）

    // 採点が始まっている段階では、No. が採点画面の呼び出し順なので一度聞く（レビュー指摘。準備中は聞かない）
    if (EventStatus.isScoringOpen(EventStatus.of(ctx.event)) &&
        !confirm('採点中です。順番を入れ替えると採点画面の呼び出し順（No.）が変わります。\n入れ替えますか？')) return;
    target.parentNode.insertBefore(moving, after ? target.nextSibling : target);
    renumberShown(ids);

    var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
    reorderBusy = true;
    if (view && view.tbody) view.tbody.classList.add('reorder-saving');
    try {
      var res = await Api.reorderPlayers(eventId, {
        court: band.court, isFemale: band.isFemale, round: band.round, ids: ids
      });
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた。DOM にも alert にも触らない
      if (!res || !res.ok) {
        if (res && res.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else if (res && res.reason === 'reorder_mismatch') {
          // 別の端末で行が足された・消されたなど。最新を読み直す
          alert(res.error);
          await Desk.reloadEvent();
          return;
        } else {
          alert('並べ替えを保存できませんでした。\n通信を確認してください。');
        }
        redrawTable();   // 元の並びに戻す
        return;
      }
      Desk.toast('試技順を保存しました');
      await Desk.reloadEvent();
    } finally {
      reorderBusy = false;
      // reloadEvent が描き直せなかったとき（通信断）にも通信中の見た目を残さない
      if (view && view.tbody && Desk.currentEventId() === eventId) view.tbody.classList.remove('reorder-saving');
    }
  }

  // 動かした帯の No. のセルを、保存を待たずに新しい並びで書き換える（見た目だけ）
  function renumberShown(ids) {
    if (!view || !view.tbody) return;
    Array.prototype.forEach.call(view.tbody.children, function(tr) {
      var i = ids.indexOf(tr.dataset && tr.dataset.playerId);
      if (i === -1) return;
      var no = tr.querySelector('td.col-no');
      if (no) no.textContent = String(i + 1);
    });
  }

  function renderTable(wrap, ctx, locked) {
    wrap.innerHTML = '';
    view.tbody = null;
    var players = ctx.players || [];
    // 選手 0 名でも表（男子の部・女子の部の帯と「＋ 行を追加」）を出す。確定済みで 0 名のときだけ案内文
    if (players.length === 0 && !draft && locked) {
      if (view.bar) view.bar.innerHTML = '';
      wrap.appendChild(emptyMessage('選手がいません。'));
      return;
    }
    // 選手が 0 名で編集できるときだけ、どの取り込みを使うかの案内（設計書 2026-10-05 §4）。
    // 大会ごと持ち込むファイル（.json）はここでは読めない（大会一覧の 📂）。
    if (players.length === 0 && !draft) {
      var hint = document.createElement('p');
      hint.className = 'desk-note';
      hint.id = 'playersImportHint';
      hint.textContent = '大会ごと持ち込むファイル（.json）は「大会一覧」の 📂 大会ファイルを取り込む、' +
        '選手だけの CSV はここの 📄 選手を CSV から取り込む から。';
      wrap.appendChild(hint);
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
  // band は行が属する帯（fillRows。ドラッグで試技順を入れ替える範囲）。
  function buildRow(ctx, p, locked, band) {
    var key = Courts.orderKey(p);
    // この行の入力を控えておく（レンタルの切り替えで技を作り直す・赤枠を塗り直す）
    var refs = { techSelects: [], bibInput: null, rankInput: null, r2Button: null };
    var tr = document.createElement('tr');
    // 一巡目の bib/rank/rental 保存が二巡目の行に伝播したとき、表全体を描き直さずこの行
    // だけを探して差し替えるための目印（saveCell 参照）。
    tr.dataset.playerId = p.id || '';
    tr.deskBand = band || null;   // 差し替えるときに同じ帯のまま作り直すため
    var tdRound = cell('', 'num col-round');
    // 左端の掴み手（確定済みの大会では出さない）
    if (band && !locked) {
      tdRound.appendChild(dragHandle(ctx, tr, band));
      bindDropTarget(ctx, tr, band);
    }
    tdRound.appendChild(document.createTextNode(String(Courts.roundOf(p))));
    tr.appendChild(tdRound);
    tr.appendChild(cell(String(key.no || ''), 'num col-no'));
    tr.appendChild(nameCell(ctx, p, locked));
    tr.appendChild(bibCell(ctx, p, locked, refs));
    tr.appendChild(rankCell(ctx, p, locked, refs));
    tr.appendChild(rentalCell(ctx, p, locked, refs));
    tr.appendChild(courtCell(ctx, p, locked));
    tr.appendChild(sexCell(ctx, p, locked));
    tr.appendChild(newFaceCell(ctx, p, locked));
    tr.appendChild(techCell(ctx, p, locked, 1, refs));
    tr.appendChild(techCell(ctx, p, locked, 2, refs));
    tr.appendChild(techCell(ctx, p, locked, 3, refs));
    tr.appendChild(r2Cell(ctx, p, locked, refs));
    // 得点は確定済みだけ出す（採点途中の値は表に出さない。ユーザー要望 2026-09-30）
    tr.appendChild(cell(p.confirmed === true ? String(p.score || 0) : '', 'num col-score'));
    var tdAct = document.createElement('td');
    tdAct.className = 'act';
    // 「⋯」の中に削除だけ入れていたが分かりにくいので、文字の「削除」を直接置く（ユーザー要望 2026-10-05）
    if (!locked) tdAct.appendChild(buildDeleteLink(ctx, p));
    tr.appendChild(tdAct);
    markRow(ctx, refs, p);   // 描いた時点の赤枠
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
    // 追加項目。サーバーは選手の全体を返すので、キーが無い＝未設定として揃える
    // （null / '' / false。この形は markRow と Courts.startBlockers が前提にしている）。
    dst.bib = (typeof src.bib === 'number') ? src.bib : null;
    dst.rank = (typeof src.rank === 'string') ? src.rank : '';
    dst.rental = src.rental === true;
    // 二巡目の形の申請。キーが無い＝申請なし（一巡目と同じ）なので '' にそろえる（設計書 2026-10-03 6.1）
    EventStatus.R2_TECH_KEYS.forEach(function(k) {
      dst[k] = (typeof src[k] === 'string') ? src[k] : '';
    });
    if (typeof src.rev === 'number') dst.rev = src.rev;
  }

  // サーバーが書き換えた相手の行（PATCH の応答の linked / source。設計書 2026-10-03 3.3.3）を
  // 手元の控え（ctx.players）に取り込み、表にその行があれば 1 行だけ作り直す（表全体は描き直さない。
  // 他の行で入力途中の文字やフォーカスを消さないため。saveCell の伝播と同じ方針）。
  // 控えは同じオブジェクトを書き換える（他の行のクロージャが掴んでいる参照もそのまま新しくなる）。
  // サーバーは「無ければキーを持たない」形で返す（bib を消した・申請を空にした・note が無い等）ので、
  // 応答に無いキーは控えからも消してから写し、adopt で表の前提の形（bib: null・rank: ''・申請 '' 等）に
  // そろえる（Object.assign だけだと、一巡目のゼッケンを消しても二巡目の行に古いゼッケンが残った。レビュー指摘）。
  function absorbRow(ctx, row) {
    if (!row || typeof row.id !== 'string') return null;
    var local = (ctx.players || []).filter(function(q) { return q && q.id === row.id; })[0];
    if (!local) return null;
    Courts.replacePlayerFields(local, row);
    adopt(local, row);
    rebuildRowOf(ctx, local);
    return local;
  }

  // 表の中の、その選手の行だけを作り直す。絞り込みで隠れている等で見当たらなければ何もしない
  // （ctx.players 側は更新済みなので、次に描き直されたときには反映される）。
  function rebuildRowOf(ctx, player) {
    if (!view || view.ctx !== ctx || !view.tbody) return;
    var oldTr = Array.prototype.find.call(view.tbody.children, function(tr) {
      return tr.dataset && tr.dataset.playerId === player.id;
    });
    if (oldTr) oldTr.replaceWith(buildRow(ctx, player, view.locked, oldTr.deskBand));
  }

  // 一巡目に元がある二巡目の行か（sourcePlayerId が今ある行を指している）。
  // その行の氏名・性別・新人は一巡目の行で直す（サーバーも 409 linked で断る。網羅検証 M1）。
  // 元の行が消えている二巡目の行は直せる（サーバーの判定と同じ）。
  var LINKED_NOTE = '一巡目の行で直してください';
  function isLinked(ctx, p) {
    if (!p || !p.sourcePlayerId) return false;
    return (ctx.players || []).some(function(q) { return q && q !== p && q.id === p.sourcePlayerId; });
  }

  // セル 1 つの保存。patch は送る 1 項目だけ。
  //   revert : 失敗したときに表示を元へ戻す
  //   after  : 成功したときの追加処理（order が変わるセルは表を描き直す）
  // 失敗しても表は描き直さない（他のセルの入力途中を壊さないため）。
  async function saveCell(ctx, p, el, patch, revert, after) {
    // 採点済みの選手の性別・技は、採点画面が変更に気付けない（Courts.scoreMayChange 参照）。
    // 確認を承諾したら force: true を付けて送る（サーバーは force なしだと 409 scored。網羅検証 S7）
    var forced = false;
    if (Courts.scoreMayChange(p, patch)) {
      if (!confirm(Courts.scoreChangeConfirmMessage(p))) {
        revert();
        return;
      }
      forced = true;
    }
    el.disabled = true;
    el.classList.add('saving');
    var res = await Api.updatePlayerInfo(ctx.eventId, p.id, forced ? Object.assign({ force: true }, patch) : patch);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた。DOM にも alert にも触らない
    var declined = false;
    if (res && !res.ok && res.reason === 'scored' && !forced) {
      // 画面の控えが古く、その間に採点されていた。同じ確認を出し、承諾されたら force で送り直す。
      // linked が付いていれば理由は二巡目の行の採点（申請の書き写し先。設計書 2026-10-03 5.4）
      var again = res.linked ? Courts.round2ChangeConfirmMessage(res.linked)
        : Courts.scoreChangeConfirmMessage(res.player || p);
      if (confirm(again)) {
        res = await Api.updatePlayerInfo(ctx.eventId, p.id, Object.assign({ force: true }, patch));
        if (ctx.isStale()) return;
      } else {
        declined = true;
      }
    }
    el.disabled = false;
    el.classList.remove('saving');
    if (!res || !res.ok) {
      revert();
      if (declined) return;   // 確認でやめた。保存していないので何も出さない
      if (res && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      } else if (res && res.reason === 'bib') {
        // 「ゼッケン番号 12 は「山田 太郎」が使っています」。誰と重なったかを
        // 知っているのはサーバーだけなので、文言をそのまま出す（セルは元に戻す）。
        alert(res.error);
      } else if (res && res.reason === 'linked') {
        alert(res.error || ('二巡目の行の氏名・性別・新人は' + LINKED_NOTE));
      } else {
        alert('保存できませんでした。\n入力内容と通信を確認してください。');
      }
      return;
    }
    if (res.player) adopt(p, res.player);
    // サーバーが書き換えた相手の行（設計書 2026-10-03 3.3.3）。一巡目の行の技を直して申請の無い選手の
    // 二巡目の行が付いていった（linked）、二巡目の行の技を直して一巡目の行の申請へ書き戻した（source）。
    // 氏名などの写しも linked に入るので、下の手元での写しはそれ以外の行（念のため）だけに掛ける。
    var absorbed = Object.create(null);
    (res.linked || []).forEach(function(row) {
      if (absorbRow(ctx, row)) absorbed[row.id] = true;
    });
    if (res.source && absorbRow(ctx, res.source)) absorbed[res.source.id] = true;
    // 一巡目の bib/rank/rental/name/isNewFace を保存したら、サーバーが sourcePlayerId で紐づく二巡目の
    // 行にも同じ値を写している（server/index.js の PATCH …/players/:playerId。氏名・新人の写しは
    // 網羅検証 M1 で足された）。表のローカルな控え（ctx.players）はサーバーの応答（この行だけ）では
    // 追随しないので、ここで一致する行を探して同じように書き換える（レビュー修正）。
    // redrawTable() で表全体を作り直すと、他の行で入力途中の文字やフォーカスが消えてしまう
    // （このコメントの上の「表そのものは描き直さない」という前提に反する）ので、
    // 伝播した二巡目の行だけを新しく作って差し替える。他の行の DOM・入力状態には触れない。
    if (patch.bib !== undefined || patch.rank !== undefined || patch.rental !== undefined ||
        patch.name !== undefined || patch.isNewFace !== undefined || patch.isFemale !== undefined) {
      (ctx.players || []).forEach(function(other) {
        if (other && other.sourcePlayerId === p.id && !absorbed[other.id]) {
          if (patch.bib !== undefined) {
            other.bib = (typeof p.bib === 'number') ? p.bib : null;
          }
          if (patch.rank !== undefined) other.rank = p.rank;
          if (patch.rental !== undefined) other.rental = p.rental;
          if (patch.name !== undefined) other.name = p.name;
          if (patch.isNewFace !== undefined) other.isNewFace = p.isNewFace === true;
          if (patch.isFemale !== undefined) other.isFemale = p.isFemale === true;
          // 絞り込みで隠れている・並べ替えでこの表に無い等、行が見当たらなければ何もしない
          // （ctx.players 側は更新済みなので、次に描き直されたときには反映される）。
          rebuildRowOf(ctx, other);
        }
      });
    }
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

  // --- 赤枠（必須未入力・レンタルが選べない形・同じ形の回数制限） ---
  // 判定は Courts.startBlockers と同じ規則にする（表の上の件数と食い違わせない）。
  //   ゼッケン・級位段位 … 大会の settings で必須にしていて、一巡目の行が空のとき
  //   技                 … レンタルの選手の tech1〜3 のうち、抜刀後の形でない技。
  //                        または repeatable でない技が3枠のうち2回以上（巡目を問わない。
  //                        Courts.duplicateForms は行の3枠だけを見るため。設計書
  //                        2026-09-20-rules-alignment-design.md「同じ形の回数制限」）
  // 二巡目の行の必須は数えない（二巡目は一巡目の行から複製されるため）。
  function markRow(ctx, refs, p) {
    var settings = (ctx.event && ctx.event.settings) || {};
    var firstRound = Courts.roundOf(p) === 1;
    setMark(refs.bibInput, 'desk-cell-required',
      settings.requireBib === true && firstRound && typeof p.bib !== 'number');
    setMark(refs.rankInput, 'desk-cell-required',
      settings.requireRank === true && firstRound && !String(p.rank || '').trim());
    var isFemale = !!p.isFemale;
    var dupForms = Courts.duplicateForms([p.tech1, p.tech2, p.tech3], ctx.techniques, isFemale);
    refs.techSelects.forEach(function(t) {
      var name = p['tech' + t.slot] || '';
      var rentalBad = p.rental === true && !!name && !Courts.isDrawnTechnique(ctx.techniques, name, isFemale);
      var resolved = name ? Courts.resolveTechnique(ctx.techniques, name, isFemale) : null;
      var display = resolved ? Courts.stripGenderSuffix(resolved.name) : '';
      var repeatBad = !!display && dupForms.indexOf(display) !== -1;
      setMark(t.sel, 'desk-cell-bad', rentalBad || repeatBad);
      t.sel.title = repeatBad ? '同じ形は 1 回までです' : rentalBad ? 'レンタルの選手は抜刀してからの形だけ選べます' : '';
    });
    // 二巡目の形の申請（一巡目の行だけ）。レンタルや一巡目の形を変えると見え方・赤枠も変わるので塗り直す
    if (refs.r2Button) paintR2Button(ctx, refs.r2Button, p);
  }

  function setMark(el, cls, on) {
    if (el) el.classList.toggle(cls, on === true);
  }

  // セルを 1 つ保存できたあとに呼ぶ。その行の赤枠と、表の上の件数を塗り直す。
  // 表そのものは描き直さない（他のセルの入力途中を壊さないため。saveCell と同じ方針）。
  function afterRowEdit(ctx, refs, p) {
    markRow(ctx, refs, p);
    if (view && view.ctx === ctx) renderCount(lastShown, (ctx.players || []).length);
  }

  function nameCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-name';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'desk-cell-input';
    input.value = p.name || '';
    input.setAttribute('aria-label', '名前');
    // 二巡目の行の氏名は一巡目の行で直す（一巡目で直すと二巡目へ写る。網羅検証 M1）
    var linked = isLinked(ctx, p);
    input.disabled = locked || linked;
    if (linked) input.title = LINKED_NOTE;
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
    var list = Courts.listFrom(ctx.players, extraCourts(ctx))
      .filter(function(c) { return c !== Courts.UNASSIGNED; });
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

  // 網羅検証 S14: 一巡目の終了のあとに一巡目の選手を足しても、その選手を採点する経路が無い
  // （採点できるのは今の状態の巡目の行だけ。二巡目の行も一巡目の終了のときに作られる）。
  // 追加が済んだあとに、戻し方を案内する。準備中・一巡目 進行中は空文字。
  function round1AddNote(ctx) {
    var st = EventStatus.of(ctx.event);
    if (st === 'draft' || st === 'round1') return '';
    return '一巡目の選手を追加しました。いまは「' + (EventStatus.LABELS[st] || st) + '」なので、' +
      'この選手は採点できません（二巡目にも入りません）。\n' +
      '採点するには、試合進行で一巡目に戻して終了し直す必要があります。';
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

  // 性別は読み取り専用（表が男子の部・女子の部で分かれているため。ユーザー要望 2026-09-30）。
  // 間違えたときは行を削除して正しい部に追加し直す。
  function sexCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-sex';
    td.textContent = Courts.sexOf(p);
    if (isLinked(ctx, p)) td.title = LINKED_NOTE;
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
    // 二巡目の行の新人は一巡目の行で直す（nameCell と同じ理由。網羅検証 M1）
    var linked = isLinked(ctx, p);
    chk.disabled = locked || linked;
    if (linked) chk.title = LINKED_NOTE;
    bindChoice(ctx, p, chk, !!p.isNewFace,
      function() { return chk.checked; },
      function(v) { return { isNewFace: v }; },
      function(v) { chk.checked = v; },
      null);
    td.appendChild(chk);
    return td;
  }

  // ゼッケン番号。整数 1〜9999 か空（未設定）。空にすると bib: null を送って戻す。
  // 同じ大会での重複はサーバーが 409 で断り、saveCell がその文言をそのまま出す。
  // 二巡目の行は一巡目の複製（generateNextRound / saveCell の伝播）なので読み取り専用にする
  // （レビュー修正。二巡目のセルを直接書き換えても一巡目には反映されず食い違うため）。
  function bibCell(ctx, p, locked, refs) {
    var td = document.createElement('td');
    td.className = 'col-bib';
    var isRound2 = Courts.roundOf(p) !== 1;
    var input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '9999';
    input.step = '1';
    input.className = 'desk-cell-input';
    input.value = (typeof p.bib === 'number') ? String(p.bib) : '';
    input.setAttribute('aria-label', 'ゼッケン番号');
    input.disabled = locked || isRound2;
    if (isRound2) input.title = '一巡目の行で変更します';
    bindText(ctx, p, input, function(v) {
      if (v === '') return { bib: null };
      // type="number" でも貼り付けや IME で数字以外が残ることがあるので自分で見る
      if (!/^[0-9]+$/.test(v)) { alert('ゼッケン番号は 1〜9999 の整数で入力してください。'); return null; }
      var n = parseInt(v, 10);
      if (n < 1 || n > 9999) { alert('ゼッケン番号は 1〜9999 の整数で入力してください。'); return null; }
      return { bib: n };
    }, function() { afterRowEdit(ctx, refs, p); });
    td.appendChild(input);
    refs.bibInput = input;
    return td;
  }

  // 級位・段位。候補は datalist で出すが自由入力も受ける（20 文字まで）。
  // 二巡目の行は一巡目の複製なので読み取り専用にする（bibCell と同じ理由）。
  function rankCell(ctx, p, locked, refs) {
    var td = document.createElement('td');
    td.className = 'col-rank';
    var isRound2 = Courts.roundOf(p) !== 1;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'desk-cell-input';
    input.setAttribute('list', RANK_LIST_ID);
    input.value = Courts.rankLabel(p.rank);
    input.setAttribute('aria-label', '級位・段位');
    input.disabled = locked || isRound2;
    if (isRound2) input.title = '一巡目の行で変更します';
    bindText(ctx, p, input, function(v) {
      if (v.length > 20) { alert('級位・段位は 20 文字までです。'); return null; }
      return { rank: v };
    }, function() { afterRowEdit(ctx, refs, p); });
    td.appendChild(input);
    refs.rankInput = input;
    return td;
  }

  // 真剣レンタル。切り替えると技の候補が変わる（抜刀後の形だけ／全部）ので、
  // 保存できたらその行の技セレクトを作り直す。性別・コートと違って order は
  // 変わらないので、表ごとの Desk.reloadEvent() は要らない（行だけで足りる）。
  // 二巡目の行は一巡目の複製なので読み取り専用にする（bibCell と同じ理由）。
  function rentalCell(ctx, p, locked, refs) {
    var td = document.createElement('td');
    td.className = 'col-rental';
    var isRound2 = Courts.roundOf(p) !== 1;
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'desk-cell-check';
    chk.checked = p.rental === true;
    chk.setAttribute('aria-label', '真剣レンタル');
    chk.disabled = locked || isRound2;
    if (isRound2) chk.title = '一巡目の行で変更します';
    bindChoice(ctx, p, chk, p.rental === true,
      function() { return chk.checked; },
      function(v) { return { rental: v }; },
      function(v) { chk.checked = v; },
      function() {
        refs.techSelects.forEach(function(t) { t.fill(); });
        afterRowEdit(ctx, refs, p);
      });
    td.appendChild(chk);
    return td;
  }

  // 技の選択肢は「その選手の性別とレンタルで絞った技リスト」＋空（技を消せるように）。
  // 性別が変わって保存されると行ごと Desk.reloadEvent() で作り直される。レンタルは
  // order を変えないので表を作り直さず、rentalCell から fill() を呼んで候補だけ入れ替える。
  // 選手が持っている技が候補に無い場合（接尾辞付きの旧データ、技リストを入れ替えた後、
  // レンタルにしたら選べなくなった形）は、黙って空にしないよう、その名前も選択肢に足す。
  function techCell(ctx, p, locked, slot, refs) {
    var td = document.createElement('td');
    td.className = 'col-tech';
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', '技' + slot);
    sel.disabled = locked;

    function fill() {
      var cur = p['tech' + slot] || '';
      sel.innerHTML = '';
      addOption(sel, '', '—');
      var found = false;
      Courts.techniqueOptions(ctx.techniques, !!p.isFemale, p.rental === true).forEach(function(t) {
        var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
        if (!n) return;
        addOption(sel, n, Courts.techniqueLabel(t));   // 「夢想返し（18）」。value は技名のまま
        if (n === cur) found = true;
      });
      if (cur && !found) {
        // 技リストに無いのか、レンタルで選べなくなっただけなのかを書き分ける
        addOption(sel, cur, cur +
          (Courts.resolveTechnique(ctx.techniques, cur, !!p.isFemale) ? '（選べない技）' : '（リストに無い技）'));
      }
      sel.value = cur;
    }
    fill();

    bindChoice(ctx, p, sel, p['tech' + slot] || '',
      function() { return sel.value; },
      function(v) {
        var patch = {};
        patch['tech' + slot] = v;
        return patch;
      },
      function(v) { sel.value = v; },
      function() { afterRowEdit(ctx, refs, p); });
    td.appendChild(sel);
    refs.techSelects.push({ sel: sel, slot: slot, fill: fill });
    return td;
  }

  // --- 二巡目の形（申請）の列（設計書 2026-10-03-round2-forms-prereg-design.md 6.1） ---
  // 一巡目の行の r2tech1〜3。3 つとも空なら「一巡目と同じ形」。セルはボタン 1 つで、押すと
  // ポップオーバーで技 3 つを選ぶ。3 つを 1 回の PATCH で送る（同じ形の回数制限が 3 つの組で
  // 決まるため。セル 1 つずつ保存する他の列とは違う）。二巡目の行は「—」（その行の技1〜3 が二巡目の形）。

  // 申請の 3 つの誤り（Courts.techIssues）を文言の配列にする。無ければ []。
  // 表に無い技は、技得点表が取れているときだけ見る（Courts.startBlockers の r2unknownTech と同じ）。
  function r2IssueTexts(ctx, p, techs) {
    var iss = Courts.techIssues(techs, ctx.techniques || [], !!p.isFemale, p.rental === true);
    var out = [];
    if (Array.isArray(ctx.techniques) && iss.unknown.length > 0) {
      out.push('技「' + iss.unknown.join('」「') + '」は技得点表にありません');
    }
    if (iss.repeat.length > 0) out.push('同じ形は 1 回までです（' + iss.repeat.join('・') + '）');
    if (iss.rentalBad) out.push('レンタルの選手は抜刀してからの形だけ選べます');
    return out;
  }

  function r2Summary(techs) {
    return techs.map(function(t) { return t || '—'; }).join('・');
  }

  // セルのボタンの見え方。申請なし＝「一巡目と同じ」を薄く、申請あり＝技名の要約（幅を超えたら …）。
  // 列は 96px（1280px の窓に表を収めるため。desk.css）なので、括弧を付けずに収まる文言にした。
  // 誤りがあれば赤枠（.desk-cell-bad）にして、理由を title に出す。
  function paintR2Button(ctx, b, p) {
    var has = EventStatus.hasRound2Techs(p);
    var techs = EventStatus.round2TechsOf(p);
    var issues = has ? r2IssueTexts(ctx, p, techs) : [];
    b.className = 'desk-r2-btn' + (has ? ' set' : ' same') + (issues.length > 0 ? ' desk-cell-bad' : '');
    b.textContent = has ? r2Summary(techs) : '一巡目と同じ';
    b.title = (has ? '二巡目の形: ' + r2Summary(techs) : '二巡目も一巡目と同じ形です（押すと変えられます）') +
      (issues.length > 0 ? '\n' + issues.join('\n') : '');
  }

  function r2Cell(ctx, p, locked, refs) {
    var td = document.createElement('td');
    td.className = 'col-r2';
    if (Courts.roundOf(p) !== 1) {
      td.textContent = '—';
      td.classList.add('desk-r2-none');
      td.title = '二巡目の行は 技1〜3 が二巡目の形です';
      return td;
    }
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', '二巡目の形');
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    paintR2Button(ctx, b, p);
    b.disabled = locked;
    b.addEventListener('click', function(e) {
      // 外側クリックの判定（document の click）に流さない。もう一度押したら閉じる
      e.stopPropagation();
      if (popover && popover.btn === b) { closePopover(true); return; }
      openR2Popover(ctx, p, b);
    });
    td.appendChild(b);
    refs.r2Button = b;
    return td;
  }

  // 技 1 つのセレクト。候補は一巡目の技セルと同じ（性別とレンタルで絞る）。
  // いまの値が候補に無ければ、黙って空にしないよう選択肢に足す（techCell の fill と同じ）。
  function r2Select(ctx, p, slot, value) {
    var sel = document.createElement('select');
    sel.className = 'desk-r2-select';
    sel.setAttribute('aria-label', '二巡目の技' + slot);
    addOption(sel, '', '—');
    var found = false;
    Courts.techniqueOptions(ctx.techniques, !!p.isFemale, p.rental === true).forEach(function(t) {
      var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
      if (!n) return;
      addOption(sel, n, Courts.techniqueLabel(t));
      if (n === value) found = true;
    });
    if (value && !found) {
      addOption(sel, value, value +
        (Courts.resolveTechnique(ctx.techniques, value, !!p.isFemale) ? '（選べない技）' : '（リストに無い技）'));
    }
    sel.value = value || '';
    return sel;
  }

  // ポップオーバー（絞り込みの ▼ と同じ仕組み・同じ置き場所。document.body に fixed、同時に 1 つだけ、
  // 外側クリック・Esc・スクロールで閉じる）。申請なしで開いたら一巡目の形を下書きとして入れる
  // （1 本だけ変える人も 3 つ書く必要があるのを補う。設計書 2.2）。
  function openR2Popover(ctx, p, btn) {
    closePopover();
    bindPopoverCloseOnce();
    var has = EventStatus.hasRound2Techs(p);
    var start = has ? EventStatus.round2TechsOf(p) : [p.tech1 || '', p.tech2 || '', p.tech3 || ''];
    var hasRow2 = (ctx.players || []).some(function(q) { return q && q !== p && q.sourcePlayerId === p.id; });

    var box = document.createElement('div');
    box.className = 'desk-filter-pop desk-r2-pop';
    box.id = 'deskR2Pop';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', (p.name || '') + ' の二巡目の形');
    box.addEventListener('click', function(e) { e.stopPropagation(); });

    var title = document.createElement('div');
    title.className = 'desk-r2-pop-title';
    title.textContent = '二巡目の形（空 = 一巡目と同じ）';
    box.appendChild(title);
    var sub = document.createElement('div');
    sub.className = 'desk-r2-pop-sub';
    sub.textContent = (p.name || '') + '　一巡目: ' + r2Summary([p.tech1 || '', p.tech2 || '', p.tech3 || '']);
    box.appendChild(sub);
    if (hasRow2) {
      var linkedNote = document.createElement('div');
      linkedNote.className = 'desk-r2-pop-note warn';
      linkedNote.textContent = '二巡目の行ができています。ここで変えると二巡目の行の技も変わります。';
      box.appendChild(linkedNote);
    }
    if (!has) {
      var draftNote = document.createElement('div');
      draftNote.className = 'desk-r2-pop-note';
      draftNote.textContent = '一巡目の形を下書きとして入れています。変える技だけ選び直して保存してください。';
      box.appendChild(draftNote);
    }

    var grid = document.createElement('div');
    grid.className = 'desk-r2-pop-grid';
    var selects = [1, 2, 3].map(function(slot) {
      var lab = document.createElement('label');
      lab.className = 'desk-r2-pop-row';
      var span = document.createElement('span');
      span.textContent = '技' + slot;
      lab.appendChild(span);
      var sel = r2Select(ctx, p, slot, start[slot - 1]);
      lab.appendChild(sel);
      grid.appendChild(lab);
      return sel;
    });
    box.appendChild(grid);

    var issueEl = document.createElement('div');
    issueEl.className = 'desk-r2-pop-issue';
    issueEl.id = 'deskR2PopIssue';
    box.appendChild(issueEl);

    function values() { return selects.map(function(s) { return s.value; }); }
    // 選んだ時点で誤りを示す（同じ形の回数制限・表に無い技・レンタル）。保存は止めない
    // （サーバーも止めない。試合開始の検査が止める。選手登録の帯にも件数が出る）。
    function paintIssues() {
      var v = values();
      var texts = r2IssueTexts(ctx, p, v);
      issueEl.textContent = texts.join('\n');
      issueEl.hidden = texts.length === 0;
      var iss = Courts.techIssues(v, ctx.techniques || [], !!p.isFemale, p.rental === true);
      selects.forEach(function(s) {
        var n = s.value;
        var bad = false;
        if (n) {
          var resolved = Courts.resolveTechnique(ctx.techniques, n, !!p.isFemale);
          var display = resolved ? Courts.stripGenderSuffix(resolved.name) : '';
          bad = (Array.isArray(ctx.techniques) && !resolved) ||
            (!!display && iss.repeat.indexOf(display) !== -1) ||
            (p.rental === true && !Courts.isDrawnTechnique(ctx.techniques, n, !!p.isFemale));
        }
        s.classList.toggle('desk-cell-bad', bad);
      });
    }
    selects.forEach(function(s) { s.addEventListener('change', paintIssues); });
    paintIssues();

    var actions = document.createElement('div');
    actions.className = 'desk-filter-actions desk-r2-pop-actions';
    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'desk-btn primary';
    btnSave.id = 'btnR2PopSave';
    btnSave.textContent = '保存';
    var btnSame = document.createElement('button');
    btnSame.type = 'button';
    btnSame.className = 'desk-btn';
    btnSame.id = 'btnR2PopSame';
    btnSame.textContent = '一巡目と同じにする';
    var btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'desk-btn';
    btnCancel.textContent = 'やめる';
    actions.appendChild(btnSave);
    actions.appendChild(btnSame);
    actions.appendChild(btnCancel);
    box.appendChild(actions);

    var ui = {
      setBusy: function(flag) {
        selects.concat([btnSave, btnSame, btnCancel]).forEach(function(el) { el.disabled = flag; });
        box.classList.toggle('saving', flag);
      }
    };
    btnSave.addEventListener('click', function() { saveR2(ctx, p, values(), ui); });
    btnSame.addEventListener('click', function() { saveR2(ctx, p, ['', '', ''], ui); });
    btnCancel.addEventListener('click', function() { closePopover(true); });

    document.body.appendChild(box);
    popover = { el: box, btn: btn, col: null };
    placePopover();
    btn.setAttribute('aria-expanded', 'true');
    selects[0].focus();
  }

  // 申請の保存。values は 3 つ（'' は空の枠。3 つとも空なら「一巡目と同じ」）。
  // 送る前に、書き写し先の二巡目の行が採点済みなら Courts.round2ChangeConfirmMessage で聞き、承諾で force。
  // サーバーの 409 scored に linked が付いて返ったとき（画面の控えが古かった）も同じ確認で送り直す。
  // 成功したら行の控えに申請を取り込み、応答の linked（書き写した二巡目の行）も表の中で差し替える。
  var r2Busy = false;
  async function saveR2(ctx, p, values, ui) {
    if (r2Busy) return;
    var patch = { r2tech1: values[0], r2tech2: values[1], r2tech3: values[2] };
    // 比べる元は保存されている申請そのもの（技だけの PATCH では正規化しないので、一巡目の形と同じ申請が
    // 残っていることがある。それを「一巡目と同じにする」で消すときは送る）。
    var before = EventStatus.hasRound2Techs(p) ? EventStatus.round2TechsOf(p) : null;
    var after = EventStatus.normalizedRound2Techs(Object.assign({}, p, patch));
    var unchanged = before ? EventStatus.sameTechs(before, values) : !after;
    if (unchanged) {
      closePopover(true);   // 変わっていない（下書きのまま保存した・同じ申請を選び直した）。送らない
      return;
    }
    var forced = false;
    var scoredRow = Courts.round2LinkedScored(p, patch, ctx.players);
    if (scoredRow) {
      if (!confirm(Courts.round2ChangeConfirmMessage(scoredRow))) return;
      forced = true;
    }
    r2Busy = true;
    ui.setBusy(true);
    try {
      var res = await Api.updatePlayerInfo(ctx.eventId, p.id, forced ? Object.assign({ force: true }, patch) : patch);
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた。DOM にも alert にも触らない
      if (res && !res.ok && res.reason === 'scored' && !forced) {
        var again = res.linked ? Courts.round2ChangeConfirmMessage(res.linked)
          : Courts.scoreChangeConfirmMessage(res.player || p);
        if (!confirm(again)) { ui.setBusy(false); return; }
        res = await Api.updatePlayerInfo(ctx.eventId, p.id, Object.assign({ force: true }, patch));
        if (ctx.isStale()) return;
      }
      ui.setBusy(false);
      if (!res || !res.ok) {
        // ポップオーバーは閉じない（選んだ値を残して、直してもう一度保存できるように）
        if (res && res.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else if (res && res.status === 400 && res.error) {
          alert(res.error);
        } else {
          alert('二巡目の形を保存できませんでした。\n通信を確認してもう一度お試しください。');
        }
        return;
      }
      if (res.player) adopt(p, res.player);
      (res.linked || []).forEach(function(row) { absorbRow(ctx, row); });
      closePopover();
      rebuildRowOf(ctx, p);
      // 作り直した行のボタンにフォーカスを戻す（キーボードで続けて操作できるように）
      if (view && view.tbody) {
        var tr = Array.prototype.find.call(view.tbody.children, function(x) {
          return x.dataset && x.dataset.playerId === p.id;
        });
        var nb = tr && tr.querySelector('.desk-r2-btn');
        if (nb) nb.focus();
      }
      if (view && view.ctx === ctx) renderCount(lastShown, (ctx.players || []).length);
      Desk.toast(after ? '二巡目の形を保存しました' : '二巡目は一巡目と同じ形にしました');
    } finally {
      r2Busy = false;
    }
  }

  // --- 「＋ 行を追加」の下書き行 ---

  // 直前の行（いま表に出ている最後の行）からコート・性別・新人を引き継ぐ。
  // 表が空なら最初のコート（無ければ A）・男子・新人なし。
  function draftSeed(ctx, female) {
    // 引き継ぐのは同じ部（性別）の、表で最後に見えている行から（帯の並びは fillRows と同じ）
    var bands = divisionBands(Courts.sortBy(Courts.applyFilter(ctx.players || [], filter), sort)
      .filter(function(p) { return (p.isFemale === true) === female; }));
    var lastRows = bands.length ? bands[bands.length - 1].rows : [];
    var last = lastRows.length ? lastRows[lastRows.length - 1] : null;
    var courts = Courts.listFrom(ctx.players, extraCourts(ctx))
      .filter(function(c) { return c !== Courts.UNASSIGNED; });
    var court = last ? Courts.courtOf(last) : '';
    if (!court || court === Courts.UNASSIGNED) court = courts[0] || 'A';
    return {
      court: court,
      isFemale: female,
      isNewFace: last ? !!last.isNewFace : false,
      // レンタルも直前の行から引き継ぐ（受付でレンタルの列が続くことが多い）。
      // ゼッケンと級位段位は人ごとに違うので引き継がない。
      rental: last ? last.rental === true : false
    };
  }

  function startDraft(ctx, female) {
    // 既に同じ部の下書き行があるなら作り直さず、その行の名前欄にフォーカスを戻すだけ
    // （連打で下書きの入力途中の値やコート・新人の選択を捨てないため）。別の部のボタンを押したら作り直す。
    if (!draft || draft.isFemale !== (female === true)) {
      draft = draftSeed(ctx, female === true);
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
      bib: '', rank: '', rental: draft.rental === true,
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

    // ゼッケン（空なら未設定で登録する）
    var tdBib = document.createElement('td');
    tdBib.className = 'col-bib';
    var inBib = document.createElement('input');
    inBib.type = 'number';
    inBib.min = '1';
    inBib.max = '9999';
    inBib.step = '1';
    inBib.className = 'desk-cell-input';
    inBib.setAttribute('aria-label', '追加する選手のゼッケン番号');
    inBib.addEventListener('change', function() { d.bib = inBib.value.trim(); });
    tdBib.appendChild(inBib);
    tr.appendChild(tdBib);

    // 級位段位
    var tdRank = document.createElement('td');
    tdRank.className = 'col-rank';
    var inRank = document.createElement('input');
    inRank.type = 'text';
    inRank.className = 'desk-cell-input';
    inRank.setAttribute('list', RANK_LIST_ID);
    inRank.setAttribute('aria-label', '追加する選手の級位・段位');
    inRank.addEventListener('change', function() { d.rank = inRank.value.trim(); });
    tdRank.appendChild(inRank);
    tr.appendChild(tdRank);

    // レンタル（技の候補が変わるので、切り替えたら技セレクトを作り直す）
    var tdRental = document.createElement('td');
    tdRental.className = 'col-rental';
    var chkRental = document.createElement('input');
    chkRental.type = 'checkbox';
    chkRental.className = 'desk-cell-check';
    chkRental.checked = d.rental;
    chkRental.setAttribute('aria-label', '真剣レンタル');
    tdRental.appendChild(chkRental);
    tr.appendChild(tdRental);

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
      Courts.techniqueOptions(ctx.techniques, d.isFemale, d.rental).forEach(function(t) {
        var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
        if (n) addOption(sel, n, Courts.techniqueLabel(t));
      });
      sel.value = cur || '';
    }

    chkRental.addEventListener('change', function() {
      d.rental = chkRental.checked;
      // 候補が変わる（レンタルなら抜刀後の形だけ）。選べなくなった技は空に戻る。
      techSelects.forEach(function(sel, i) {
        fillTechOptions(sel);
        d['tech' + (i + 1)] = sel.value;
      });
    });

    // 性別
    var tdSex = document.createElement('td');
    tdSex.className = 'col-sex';
    var selSex = document.createElement('select');
    selSex.className = 'desk-cell-select';
    selSex.setAttribute('aria-label', '性別');
    addOption(selSex, '男子', '男子');
    addOption(selSex, '女子', '女子');
    selSex.value = d.isFemale ? '女子' : '男子';
    // 性別は押した「＋ 行を追加」の部で決まる（表が男女で分かれているため変えられない）
    selSex.disabled = true;
    selSex.title = '性別は表の部（男子の部・女子の部）で決まります';
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

    // 二巡目の形は下書きでは入れない（行を作ってからセルで入れる。設計書 2026-10-03 6.1）
    var tdR2 = cell('（追加後に設定）', 'col-r2 desk-r2-none');
    tdR2.title = '選手を追加したあと、この列で二巡目の形を入れられます';
    tr.appendChild(tdR2);
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
      [input, inBib, inRank, chkRental, selCourt, selSex, chk].forEach(function(el) { el.disabled = flag; });
      var sels = tr.querySelectorAll('.col-tech select');
      for (var i = 0; i < sels.length; i++) sels[i].disabled = flag;
    }

    async function create() {
      if (busy || done) return;
      var name = input.value.trim();
      if (!name) { cancelDraft(); return; }
      // change を待たずに Enter で確定されることがあるので、送る直前に読み直す
      d.bib = inBib.value.trim();
      d.rank = inRank.value.trim();
      d.rental = chkRental.checked;
      var bib = null;
      if (d.bib !== '') {
        if (!/^[0-9]+$/.test(d.bib) || parseInt(d.bib, 10) < 1 || parseInt(d.bib, 10) > 9999) {
          alert('ゼッケン番号は 1〜9999 の整数で入力してください。');
          inBib.focus();
          return;
        }
        bib = parseInt(d.bib, 10);
      }
      if (d.rank.length > 20) { alert('級位・段位は 20 文字までです。'); inRank.focus(); return; }
      var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する（貼り付け・CSV と同じ規約）
      busy = true;
      setDisabled(true);
      var result = await Api.createPlayer(eventId, {
        name: name, court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace,
        bib: bib, rank: d.rank, rental: d.rental,
        tech1: d.tech1, tech2: d.tech2, tech3: d.tech3, round: 1
      });
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
      if (result && result.player === null) {
        // 409（確定済みガード（reason:'locked'）と、ゼッケン番号の重複（reason:'bib'））と
        // 400（入力の不正。技得点表に無い技名など）が通る。行は残す（入力を失わせない）。打ち直せるよう戻す。
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
      var addNote = round1AddNote(ctx);
      if (addNote) alert(addNote);
      // 続けて打ち込めるよう、同じコート・性別・新人でもう 1 行出す
      // ゼッケンは大会内で重複できないので引き継がない。級位段位も人ごとに違う。
      draft = { court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace, rental: d.rental };
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
    // 追加項目。書いていない列は出さない（短い行の下見が横に伸びないように）。
    var extras = [];
    if (typeof row.bib === 'number') extras.push('No.' + row.bib);
    if (row.rank) extras.push(Courts.rankLabel(row.rank));
    if (row.rental) extras.push('レンタル');
    if (extras.length > 0) {
      var ex = document.createElement('span');
      ex.textContent = '　' + extras.join('　');
      div.appendChild(ex);
    }
    // 二巡目の形の申請（11〜13 列目）。書いた行だけ出す。表に無い技名は赤
    var r2 = row.r2techs || ['', '', ''];
    if (r2.some(function(t) { return !!t; })) {
      var r2Head = document.createElement('span');
      r2Head.textContent = '　二巡目: ';
      div.appendChild(r2Head);
      r2.forEach(function(t, i) {
        var span = document.createElement('span');
        span.textContent = (i > 0 ? '・' : '') + (t || '—');
        if (t && (row.badR2Techs || []).indexOf(t) !== -1) span.className = 'desk-paste-bad';
        div.appendChild(span);
      });
    }
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
    note.textContent = 'Excel の範囲をそのまま貼り付けられます。列は ' +
      '名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 / ゼッケン / 級位段位 / レンタル / ' +
      '二巡目技1 / 二巡目技2 / 二巡目技3 の順' +
      '（タブ区切りかカンマ区切り）。1 行目が「名前」で始まるときは見出しとして読み飛ばします。' +
      '二巡目の技は、二巡目で形を変える選手だけ書きます（空なら一巡目と同じ形）。' +
      '性別は「女子」「女」「F」が女子、それ以外は男子。新人とレンタルは「○」「1」「true」など' +
      '（レンタルは「レンタル」「あり」も可）。ゼッケンは 1〜9999 の整数で、同じ大会の中で重複できません。' +
      '技はこの大会の技得点表にある名前だけです。' +
      '男女で配点が分かれる技は 破図味 のように接尾辞なしで書けます（行の性別で解決します）。' +
      'レンタルの行には「抜刀状態」の形しか書けません。' +
      '名前だけの行でも登録できます（足りない列は 男子・新人なし・技は空・ゼッケンと級位段位は未設定・' +
      'レンタルなし。コートは下のセレクトの値）。';
    body.appendChild(note);

    // 「コートが空の行に使うコート」。既存コート（未分類は除く）＋「新しいコート…」。
    // 初期値は既存コートの先頭。大会にコートがまだ無ければ空（コート列が空の行は赤くなる）。
    var courtRow = document.createElement('p');
    courtRow.className = 'desk-paste-court';
    var courtLabel = document.createElement('label');
    courtLabel.textContent = 'コートが空の行に使うコート';
    var selDefault = document.createElement('select');
    selDefault.setAttribute('aria-label', 'コートが空の行に使うコート');
    var courtList = Courts.listFrom(ctx.players, extraCourts(ctx))
      .filter(function(c) { return c !== Courts.UNASSIGNED; });
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

    // 既存（一巡目）の bib。貼り付けの重複検証に使う（設計書「選手の追加項目」レビュー修正）。
    // 二巡目の複製は一巡目と同じ bib を持つのが正常なので数えない（findBibConflict と同じ理由）。
    var existingBibs = (ctx.players || [])
      .filter(function(p) { return Courts.roundOf(p) === 1 && Number.isInteger(p.bib); })
      .map(function(p) { return p.bib; });

    function update() {
      var parsed = Courts.parsePasteRows(ta.value, ctx.techniques || [],
        { court: defaultCourt(), existingBibs: existingBibs });
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
          // 未設定は bib: null / rank: '' / rental: false で送る（サーバーの検証に合わせる）
          bib: (typeof r.bib === 'number') ? r.bib : null,
          rank: r.rank || '',
          rental: r.rental === true,
          tech1: r.techs[0], tech2: r.techs[1], tech3: r.techs[2],
          // 二巡目の形の申請（3 つとも空なら一巡目と同じ。サーバーが正規化する）
          r2tech1: r.r2techs[0], r2tech2: r.r2techs[1], r2tech3: r.r2techs[2],
          // プレビューでの元の行番号。サーバーが 400 の文言に使う（貼り付けは ok:false の行を
          // 除いて送るため、送信順の何行目かとプレビューの行番号がずれてしまうため）。
          line: r.line
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
      var bulkNote = round1AddNote(ctx);
      if (bulkNote) alert(bulkNote);
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

  // 行の右端の「削除」（文字のボタン）。押すと onDelete の確認へ
  function buildDeleteLink(ctx, p) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'desk-link-btn';
    b.textContent = '削除';
    b.setAttribute('aria-label', (p.name || '') + ' を削除');
    b.addEventListener('click', function() { onDelete(ctx, p); });
    return b;
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

  // 選択肢つきの確認。OK / キャンセルの 2 択だと「どちらが破壊的か」が読み取れないので、
  // 破壊的な操作は文言を明示したボタンにし、既定（主ボタン）にしない（網羅検証 M5）。
  // options: [{ label, value, cls }]（左から並ぶ。cls は 'primary' / 'danger'）。
  // ✕・外側クリック・画面遷移で閉じたら null（やめる）。
  function choose(title, lines, options) {
    return new Promise(function(resolve) {
      var body = document.createElement('div');
      lines.forEach(function(t) {
        var p = document.createElement('p');
        p.className = 'desk-note';
        p.textContent = t;
        body.appendChild(p);
      });
      var picked = null;
      var dialog = null;
      var buttons = options.map(function(o) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'desk-btn' + (o.cls ? ' ' + o.cls : '');
        b.textContent = o.label;
        b.addEventListener('click', function() { picked = o.value; dialog.close(); });
        return b;
      });
      dialog = Desk.openDialog(title, body, buttons, function() { resolve(picked); });
    });
  }

  // 取り込みが断られた理由を画面の文言にする（サーバーの reason で書き分ける。網羅検証 M5）
  function importFailureMessage(result) {
    if (result && result.reason === 'encoding') {
      return 'CSV の文字が化けていて読み取れませんでした。\n' +
        'UTF-8（Excel なら「CSV UTF-8（コンマ区切り）」）か Shift_JIS で保存し直してください。';
    }
    if (result && result.reason === 'format') {
      return 'CSV の 1 行目（見出し）が、読み込める形式と合っていません。\n' +
        '結果確認の「CSV エクスポート」で書き出した形（23 列。以前の 20 列も可）、または簡易形式' +
        '（名前,コート,性別,技①,技②,技③,新人,ゼッケン,級位段位,レンタル,二巡目技①,二巡目技②,二巡目技③。' +
        '先頭から 2 列以上）の見出しで作ってください。';
    }
    if (result && result.reason === 'round2_format') {
      return '二巡目がある大会には、結果確認の CSV エクスポートで書き出した形のファイル（23 列。以前の 20 列も可）だけ取り込めます（置き換え・追記とも）。\n' +
        '（一巡目とのつながりを保ち、つながりの無い二巡目の行を増やさないため）';
    }
    return 'インポートに失敗しました。' + (result && result.error ? '\n' + result.error : '');
  }

  // CSV 取り込み（admin-players.js と同じ流れ）。
  // 確認ダイアログをはさむので、書き込みの直前に必ず大会が同じか見る。
  // 取り込み直前に大会を読み直し、いまの選手数を確かめて expectedCount で送る
  // （0 名表示の古い画面から、他の端末が登録した選手を確認なしで消さない。網羅検証 M5）。
  async function importCsvText(ctx, text) {
    var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
    var fresh = await Api.loadEventResult(eventId);
    if (Desk.currentEventId() !== eventId) return;
    if (!fresh.ok) {
      alert(fresh.status === 404 ? 'この大会は削除されています' : '大会データを取得できませんでした。通信を確認してください。');
      return;
    }
    var eventName = fresh.event.name || '';
    var nowPlayers = fresh.event.players || [];
    var count = nowPlayers.length;
    var mode = 'replace';
    if (count > 0) {
      var lines = ['大会「' + eventName + '」には、いま ' + count + ' 名の選手がいます。読み込み方を選んでください。'];
      var shown = (ctx.players || []).length;
      if (shown !== count) {
        lines.push('※ 画面の表示は ' + shown + ' 名でしたが、いまは ' + count + ' 名です（他の端末で変わりました）。');
      }
      lines.push('追記する: 既存の ' + count + ' 名は残し、CSV の選手を足します（同じ順番の選手がいると重複します）。');
      lines.push('置き換える: 既存の ' + count + ' 名を全部消して、CSV の内容だけにします（採点結果も消えます）。');
      if (nowPlayers.some(function(p) { return Courts.roundOf(p) === 2; })) {
        lines.push('二巡目の行があるため、置き換え・追記とも結果確認の CSV エクスポートの形のファイル（23 列。以前の 20 列も可）だけ受け付けます。');
      }
      var pick = await choose('CSV の取り込み', lines, [
        { label: '置き換える（既存 ' + count + ' 名を消す）', value: 'replace', cls: 'danger' },
        { label: '追記する', value: 'append', cls: 'primary' }
      ]);
      if (!pick) return;
      mode = pick;
    }
    if (Desk.currentEventId() !== eventId) {
      alert('大会が切り替わったため、CSV の読み込みを中止しました。');
      return;
    }
    var expected = (mode === 'replace') ? count : undefined;
    var result = await Api.importCsv(eventId, text, mode, false, expected);
    if (Desk.currentEventId() !== eventId) return;
    if (result && result.blocked && result.reason === 'locked') {
      alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      return;
    }
    if (result && result.blocked && result.reason === 'stale') {
      alert('取り込む間に選手の人数が変わりました（いまは ' + (result.playerCount || 0) + ' 名）。\n' +
        '画面を読み直します。内容を確かめてから、もう一度取り込んでください。');
      await Desk.reloadEvent();
      return;
    }
    if (result && result.blocked && result.reason === 'round2_format') {
      alert(importFailureMessage(result));
      return;
    }
    if (result && result.blocked) {
      var go = await choose('採点結果が消えます', [
        '大会「' + eventName + '」には採点済みの選手が少なくとも ' + result.scoredCount + ' 名います。',
        '他のコート端末による採点も含まれます。',
        '置き換えると、これらの採点結果はすべて失われて戻せません。'
      ], [
        { label: '採点結果を消して置き換える', value: 'go', cls: 'danger' },
        { label: 'やめる', value: 'stop', cls: 'primary' }
      ]);
      if (go !== 'go') return;
      if (Desk.currentEventId() !== eventId) {
        alert('大会が切り替わったため、CSV の読み込みを中止しました。');
        return;
      }
      result = await Api.importCsv(eventId, text, mode, true, expected);
      if (Desk.currentEventId() !== eventId) return;
      if (result && result.blocked && result.reason === 'stale') {
        alert('取り込む間に選手の人数が変わりました（いまは ' + (result.playerCount || 0) + ' 名）。\n' +
          '画面を読み直します。内容を確かめてから、もう一度取り込んでください。');
        await Desk.reloadEvent();
        return;
      }
    }
    if (!result || !result.success) {
      if (!result) {
        alert('インポートに失敗しました。通信を確認してください。');
      } else {
        alert(importFailureMessage(result));
      }
      return;
    }
    // ゼッケンの重複・範囲外は行を弾かず「未設定」に落として取り込む（サーバー側）ので、
    // その件数があれば結果の文言に足す（設計書「選手の追加項目」レビュー修正）。
    var bibMsg = Courts.bibDroppedMessage(result.bibDropped);
    Desk.toast(result.playerCount + '名を読み込みました' + (bibMsg ? '。' + bibMsg : ''));
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
