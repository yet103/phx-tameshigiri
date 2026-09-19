// 選手登録タブ（#players/<大会ID>）。選手の一覧・追加・編集・削除。
(function() {
  // 絞り込みと並べ替えの状態。形は Courts.defaultFilter() / Courts.defaultSort()。
  // 大会が変われば既定に戻す。選手の追加・編集後の再描画（Admin.reloadEvent）では保つ。
  var filter = null;
  var sort = null;
  var stateOwner = null;   // filter / sort がどの大会のものか
  // 技リストは大会ごと（大会 JSON の techniques）。render のたびに ctx.techniques で
  // 入れ替える。どの大会のものかを一緒に覚えて、大会をまたいで前の大会の配点を使わない。
  var techCache = null;
  var techOwner = null;

  // 絞り込み（Courts.applyFilter）と並べ替え（Courts.sortBy）は courts.js の純粋関数。
  // 並び順の既定は巡目 → コート → 性別 → 番号（試合進行タブ admin-round.js と同じ compareOrder）。

  function adoptTechniques(ctx) {
    techOwner = ctx.eventId;
    techCache = (Array.isArray(ctx.techniques) && ctx.techniques.length > 0) ? ctx.techniques : null;
  }

  // いま開いている大会の技リストが手元にあるか
  function hasTechniques(ctx) {
    return techOwner === ctx.eventId && !!techCache;
  }

  // 性別で絞った選択肢に、いま選んでいる技（tech1〜3）が無ければ足す。接尾辞付きの
  // 旧データ（破図味(男) など）を持つ選手でも、シートにその行が出て①などの印が付くように。
  // Courts.resolveTechnique で技リストの実物が見つかればそれ（配点も出る）、
  // 見つからなければ配点なしの最小の項目を足す。
  function withCurrentTechniques(list, techniques, names, isFemale) {
    var out = list.slice();
    (names || []).forEach(function(name) {
      if (!name) return;
      if (out.some(function(t) { return t.name === name; })) return;
      var resolved = Courts.resolveTechnique(techniques, name, isFemale);
      out.push(resolved || { name: name, strikes: [null, null, null, null] });
    });
    return out;
  }

  async function render(container, ctx) {
    adoptTechniques(ctx);
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
    head.className = 'section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '選手登録 ' + ctx.players.length + '名';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    var btnMenu = document.createElement('button');
    btnMenu.type = 'button';
    btnMenu.className = 'icon-btn';
    btnMenu.textContent = '⋯';
    btnMenu.addEventListener('click', function() { openMenu(ctx); });

    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(btnMenu);
    container.appendChild(head);

    // 1 段目: コート
    var courtChips = document.createElement('div');
    courtChips.className = 'court-chips';
    container.appendChild(courtChips);

    // 2 段目: 性別・巡目・新人・技未入力
    var filterChips = document.createElement('div');
    filterChips.className = 'court-chips players-filters';
    container.appendChild(filterChips);

    // 3 段目: 名前検索
    var search = document.createElement('div');
    search.className = 'players-search';
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = '名前で検索';
    input.setAttribute('aria-label', '名前で検索');
    input.value = filter.query;
    search.appendChild(input);
    container.appendChild(search);

    var wrap = document.createElement('div');
    wrap.className = 'players-table-wrap';
    container.appendChild(wrap);

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'fab';
    fab.textContent = '＋';
    fab.addEventListener('click', function() { openAddSheet(ctx); });
    container.appendChild(fab);

    // チップを押したらチップの帯と表を描き直す（検索欄は作り直さない。入力中の文字を保つ）
    function redraw() {
      Admin.renderCourtChips(courtChips, ctx.players, filter.court, function(c) {
        filter.court = c;
        redraw();
      });
      renderFilterChips(filterChips, ctx, redraw);
      renderTable(wrap, ctx);
    }
    function applyQuery() {
      // Chromium は変換確定で compositionend と input の両方が来るので、同じ文字列なら描き直さない
      if (input.value === filter.query) return;
      filter.query = input.value;
      renderTable(wrap, ctx);
    }
    input.addEventListener('input', function(ev) {
      // IME 変換中は確定前の文字で絞り込まない（変換終了時に確定値で最後の input が発火する）
      if (ev.isComposing) return;
      applyQuery();
    });
    // WebKit（iOS/macOS Safari）は input(isComposing:true) → compositionend の順で、
    // その後 isComposing:false の input が発火しないため、compositionend でも絞り込む。
    input.addEventListener('compositionend', applyQuery);
    redraw();
  }

  // 2 段目のチップ。性別・巡目は 1 つ選ぶ、新人・技未入力は押すたびに on/off。
  function renderFilterChips(el, ctx, redraw) {
    el.innerHTML = '';
    function group(items, current, onPick) {
      var g = document.createElement('span');
      g.className = 'chip-group';
      Admin.renderChips(g, items, current, function(v) { onPick(v); redraw(); }, true);
      el.appendChild(g);
    }
    group([{ value: '', label: '男女' }, { value: '男子', label: '男子' }, { value: '女子', label: '女子' }],
      filter.sex, function(v) { filter.sex = v; });
    group([{ value: 0, label: '全巡' }].concat(Courts.roundsOf(ctx.players).map(function(r) {
      return { value: r, label: r + '巡' };
    })), filter.round, function(v) { filter.round = v; });
    group([{ value: true, label: '新人' }], filter.newFace, function() { filter.newFace = !filter.newFace; });
    group([{ value: true, label: '技未入力' }], filter.noTech, function() { filter.noTech = !filter.noTech; });
  }

  // 表の列。key があるものは見出しタップで並べ替えられる（巡・コート・性は絞り込み軸なので対象外）。
  var COLUMNS = [
    { label: '巡' },
    { label: 'コート' },
    { label: '性' },
    { key: 'order', label: 'No' },
    { key: 'name', label: '名前', cls: 'col-name' },
    // ゼッケンは名前のすぐ右（col-name は sticky なので、その右に足すぶんには
    // 左端の固定に影響しない）。級位段位とレンタルは行のシートで見る。
    { label: 'ゼッケン' },
    { label: '技①' },
    { label: '技②' },
    { label: '技③' },
    { label: '新' },
    { key: 'score', label: '得点', cls: 'col-score' }
  ];

  function renderTable(wrap, ctx) {
    wrap.innerHTML = '';
    if (ctx.players.length === 0) {
      wrap.appendChild(emptyMessage('選手がまだいません。右下の「＋」で追加してください。'));
      return;
    }
    var rows = Courts.sortBy(Courts.applyFilter(ctx.players, filter), sort);
    if (rows.length === 0) {
      wrap.appendChild(emptyMessage('条件に合う選手がいません。'));
      return;
    }

    var table = document.createElement('table');
    table.className = 'players-table';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    COLUMNS.forEach(function(col) {
      var th = document.createElement('th');
      if (col.cls) th.className = col.cls;
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
          if (sort.key === col.key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
          else sort = { key: col.key, dir: 'asc' };
          renderTable(wrap, ctx);
        });
        th.appendChild(b);
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function(p) {
      tbody.appendChild(buildTr(ctx, p));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  function emptyMessage(text) {
    var none = document.createElement('p');
    none.className = 'empty';
    none.textContent = text;
    return none;
  }

  // 1 人 1 行。order（A-男子-1-1）は巡・コート・性・No の 4 列に分けて出す。
  function buildTr(ctx, p) {
    var tr = document.createElement('tr');
    var key = Courts.orderKey(p);
    var noTech = Courts.hasNoTech(p);
    function cell(text, cls) {
      var td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    cell(String(Courts.roundOf(p)));
    cell(Courts.courtOf(p));
    cell(Courts.sexOf(p) === '女子' ? '女' : '男');
    cell(key.no ? String(key.no) : '');
    cell(p.name || '', 'col-name');
    // ゼッケンは未設定なら「—」を薄く出す（0 と空欄を見間違えないように）
    var hasBib = (typeof p.bib === 'number');
    cell(hasBib ? String(p.bib) : '—', hasBib ? '' : 'muted');
    // 3枠とも表示する（詰めると ['', '真', '真'] と ['真', '真', ''] が同じ見た目になり、
    // どの枠が空か運営が分からなくなる）。空き枠は「—」。3枠とも空なら技①に「未入力」。
    cell(noTech ? '未入力' : (p.tech1 || '—'), noTech ? 'muted' : '');
    cell(p.tech2 || '—');
    cell(p.tech3 || '—');
    cell(p.isNewFace ? '●' : '');
    cell(String(p.score || 0), 'col-score');

    tr.tabIndex = 0;
    tr.addEventListener('click', function() { openEditSheet(ctx, p); });
    tr.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditSheet(ctx, p); }
    });
    return tr;
  }

  // コート・性別・新人の入力部品（1人ずつの追加・編集フォームと一括登録シートで共用）
  // 戻り値: { el, court(), isFemale(), isNewFace() }
  function buildCommonFields(ctx, player) {
    var el = document.createElement('div');

    // 既存のコート一覧（未分類はサーバーが受け付けないので候補に出さない）
    var courts = Courts.listFrom(ctx.players).filter(function(c) {
      return c !== Courts.UNASSIGNED;
    });
    var court = player ? Courts.courtOf(player) : (courts[0] || '');
    if (court === Courts.UNASSIGNED) court = courts[0] || '';
    // 最初の選手はコート未定なので A を初期値にする（1タップで変えられる）
    if (!court && courts.length === 0) court = 'A';
    if (court && courts.indexOf(court) === -1) courts.push(court);

    var isFemale = player ? !!player.isFemale : false;

    // コート（セグメント＋「＋」で新しいコート名）
    var fCourt = document.createElement('div');
    fCourt.className = 'field';
    var lCourt = document.createElement('label');
    lCourt.textContent = 'コート';
    var segCourt = document.createElement('div');
    segCourt.className = 'seg';
    fCourt.appendChild(lCourt);
    fCourt.appendChild(segCourt);
    el.appendChild(fCourt);

    function renderCourtSeg() {
      segCourt.innerHTML = '';
      courts.forEach(function(c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = (c === court) ? 'on' : '';
        b.textContent = c;
        b.addEventListener('click', function() {
          court = c;
          renderCourtSeg();
        });
        segCourt.appendChild(b);
      });
      var add = document.createElement('button');
      add.type = 'button';
      add.textContent = '＋';
      add.addEventListener('click', function() {
        var name = prompt('新しいコート名を入力してください（例: D）');
        if (name === null) return;
        name = name.trim();
        if (!name) { alert('コート名を入力してください。'); return; }
        // order は「コート-性別-巡目-番号」。コート名に - を含めると解析できなくなる。
        if (name.indexOf('-') >= 0) { alert('コート名に「-」は使えません。'); return; }
        if (name === Courts.UNASSIGNED) {
          alert('「' + Courts.UNASSIGNED + '」はコート名に使えません。');
          return;
        }
        if (name.length > 32) { alert('コート名は32文字までです。'); return; }
        if (courts.indexOf(name) === -1) courts.push(name);
        court = name;
        renderCourtSeg();
      });
      segCourt.appendChild(add);
    }
    renderCourtSeg();

    // 性別
    var fSex = document.createElement('div');
    fSex.className = 'field';
    var lSex = document.createElement('label');
    lSex.textContent = '性別';
    var segSex = document.createElement('div');
    segSex.className = 'seg';
    fSex.appendChild(lSex);
    fSex.appendChild(segSex);
    el.appendChild(fSex);

    function renderSexSeg() {
      segSex.innerHTML = '';
      [['男子', false], ['女子', true]].forEach(function(pair) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = (isFemale === pair[1]) ? 'on' : '';
        b.textContent = pair[0];
        b.addEventListener('click', function() {
          isFemale = pair[1];
          renderSexSeg();
        });
        segSex.appendChild(b);
      });
    }
    renderSexSeg();

    // 新人
    var fNew = document.createElement('div');
    fNew.className = 'field';
    var toggle = document.createElement('label');
    toggle.className = 'toggle';
    var chkNew = document.createElement('input');
    chkNew.type = 'checkbox';
    chkNew.checked = player ? !!player.isNewFace : false;
    var txtNew = document.createElement('span');
    txtNew.textContent = '新人';
    toggle.appendChild(chkNew);
    toggle.appendChild(txtNew);
    fNew.appendChild(toggle);
    el.appendChild(fNew);

    return {
      el: el,
      court: function() { return court; },
      isFemale: function() { return isFemale; },
      isNewFace: function() { return chkNew.checked; }
    };
  }

  // --- フォーム部品（追加・編集で共用） ---
  // 戻り値: { el, read, reset }
  //   el    : シートの body に入れる DOM
  //   read(): { name, court, isFemale, isNewFace, bib, rank, rental, tech1, tech2, tech3 } | null
  //           （不正なら alert を出して null。bib は数値か null）
  //   reset(): 名前・ゼッケン・級位段位・技を空にする
  //           （コート・性別・新人・レンタルは保つ。受付を連続処理するため）
  function buildPlayerForm(ctx, player) {
    var el = document.createElement('div');

    var techState = player
      ? TechPicker.fromArray([player.tech1, player.tech2, player.tech3])
      : [];

    // 名前
    var fName = document.createElement('div');
    fName.className = 'field';
    var lName = document.createElement('label');
    lName.textContent = '名前';
    var inName = document.createElement('input');
    inName.type = 'text';
    inName.value = player ? (player.name || '') : '';
    fName.appendChild(lName);
    fName.appendChild(inName);
    el.appendChild(fName);

    // ゼッケン番号（空は未設定。同じ大会の中では重複できず、サーバーが 409 で断る）。
    // 一括登録（名前だけ）のシートには出さないので、共通部品ではなくここに置く。
    var fBib = document.createElement('div');
    fBib.className = 'field';
    var lBib = document.createElement('label');
    lBib.textContent = 'ゼッケン番号（1〜9999。空でも登録できます）';
    var inBib = document.createElement('input');
    inBib.type = 'number';
    inBib.min = '1';
    inBib.max = '9999';
    inBib.step = '1';
    inBib.inputMode = 'numeric';
    inBib.value = (player && typeof player.bib === 'number') ? String(player.bib) : '';
    fBib.appendChild(lBib);
    fBib.appendChild(inBib);
    el.appendChild(fBib);

    // 級位・段位。候補は datalist で出すが、自由入力も受ける（20 文字まで）。
    // datalist はこのシートと一緒に作って一緒に捨てるので、id が重なることはない。
    var fRank = document.createElement('div');
    fRank.className = 'field';
    var lRank = document.createElement('label');
    lRank.textContent = '級位・段位（候補から選ぶか、自由に書けます）';
    var inRank = document.createElement('input');
    inRank.type = 'text';
    inRank.setAttribute('list', 'adminRankList');
    inRank.value = (player && typeof player.rank === 'string') ? player.rank : '';
    var rankList = document.createElement('datalist');
    rankList.id = 'adminRankList';
    ['無級', '十級', '九級', '八級', '七級', '六級', '五級', '四級', '三級', '二級', '一級',
     '初段', '二段', '三段', '四段', '五段', '六段', '七段', '八段', '九段', '十段']
      .forEach(function(r) {
        var o = document.createElement('option');
        o.value = r;
        rankList.appendChild(o);
      });
    fRank.appendChild(lRank);
    fRank.appendChild(inRank);
    fRank.appendChild(rankList);
    el.appendChild(fRank);

    var common = buildCommonFields(ctx, player);
    el.appendChild(common.el);

    // 真剣レンタル。新人と同じトグル（.toggle）で、コート・性別・新人のすぐ下に置く。
    // チェックすると、次に開く技ピッカーの候補が「抜刀後」の形だけになる（Task 13）。
    var fRental = document.createElement('div');
    fRental.className = 'field';
    var togRental = document.createElement('label');
    togRental.className = 'toggle';
    var chkRental = document.createElement('input');
    chkRental.type = 'checkbox';
    chkRental.checked = player ? player.rental === true : false;
    var txtRental = document.createElement('span');
    txtRental.textContent = '真剣レンタル（抜刀後の形だけ選べます）';
    togRental.appendChild(chkRental);
    togRental.appendChild(txtRental);
    fRental.appendChild(togRental);
    el.appendChild(fRental);

    // 技
    var fTech = document.createElement('div');
    fTech.className = 'field';
    var lTech = document.createElement('label');
    lTech.textContent = '技（①②③ をタップしてそれぞれ選ぶ）';
    var chips = document.createElement('div');
    chips.className = 'chips';
    fTech.appendChild(lTech);
    fTech.appendChild(chips);
    el.appendChild(fTech);

    function renderTechChips() {
      TechPicker.renderChips(chips, techState, function(index) {
        if (!hasTechniques(ctx)) {
          alert('技術リストを取得できませんでした。大会を開き直してください。技以外は保存できます。');
          return;
        }
        TechPicker.open({
          // 開くたびに今のフォームの性別とレンタルで絞る（切り替えた直後は、次に開く
          // ピッカーから反映されればよい。既に開いているシートは作り直さない）。
          // レンタルにチェックが入っていれば「抜刀後」の形だけ。
          // 絞った候補に今の tech1〜3 が無ければ足す（接尾辞付きの旧データや、
          // レンタルにして選べなくなった形。選んである印を消さないため）。
          techniques: withCurrentTechniques(
            Courts.techniqueOptions(techCache, common.isFemale(), chkRental.checked),
            techCache, TechPicker.toArray(techState), common.isFemale()),
          initial: techState,
          slot: index,
          onChange: function(next) {
            techState = next;
            renderTechChips();
          },
          onClose: function(next) {
            techState = next;
            renderTechChips();
          }
        });
      });
    }
    renderTechChips();

    function read() {
      var name = inName.value.trim();
      if (!name) { alert('名前を入力してください。'); return null; }
      var court = common.court();
      if (!court) { alert('コートを選んでください。「＋」で新しいコートを作れます。'); return null; }
      // 数値入力でも貼り付けや環境によっては数字以外が残るので、自分でも見る。
      // 空は未設定（bib: null）。サーバーは 1〜9999 の整数しか受けない。
      var bibText = inBib.value.trim();
      var bib = null;
      if (bibText !== '') {
        var n = parseInt(bibText, 10);
        if (!/^[0-9]+$/.test(bibText) || n < 1 || n > 9999) {
          alert('ゼッケン番号は 1〜9999 の整数で入力してください。');
          return null;
        }
        bib = n;
      }
      var rank = inRank.value.trim();
      if (rank.length > 20) { alert('級位・段位は 20 文字までです。'); return null; }
      var t = TechPicker.toArray(techState);
      return {
        name: name,
        court: court,
        isFemale: common.isFemale(),
        isNewFace: common.isNewFace(),
        bib: bib,
        rank: rank,
        rental: chkRental.checked,
        tech1: t[0],
        tech2: t[1],
        tech3: t[2]
      };
    }

    function reset() {
      inName.value = '';
      // ゼッケンは大会の中で重複できないので必ず消す。級位段位も人ごとに違う。
      // コート・性別・新人・レンタルは受付が続くので残す（この関数の約束）。
      inBib.value = '';
      inRank.value = '';
      techState = [];
      renderTechChips();
      inName.focus();
    }

    return { el: el, read: read, reset: reset };
  }

  // 追加フォーム
  function openAddSheet(ctx) {
    var form = buildPlayerForm(ctx, null);
    var added = 0;

    var btnSaveClose = document.createElement('button');
    btnSaveClose.type = 'button';
    btnSaveClose.className = 'btn';
    btnSaveClose.textContent = '保存して閉じる';

    var btnSaveNext = document.createElement('button');
    btnSaveNext.type = 'button';
    btnSaveNext.className = 'btn primary';
    btnSaveNext.textContent = '保存して次を追加';

    // どの経路で閉じても、追加した分があれば一覧へ反映する
    var sheet = Admin.openSheet('選手を追加', form.el, [btnSaveClose, btnSaveNext], function() {
      if (added > 0) Admin.reloadEvent();
    });

    // 追加は常に一巡目。二巡目の行は生成 API が作る（計画3）。
    async function save() {
      var data = form.read();
      if (!data) return false;
      data.round = 1;
      btnSaveClose.disabled = true;
      btnSaveNext.disabled = true;
      sheet.lock(true);
      var created = await Api.createPlayer(ctx.eventId, data);
      btnSaveClose.disabled = false;
      btnSaveNext.disabled = false;
      sheet.lock(false);
      if (created && created.player === null) {
        // 409（確定済みガードのみ）。シートは閉じない（入力を残す）
        if (created.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else {
          alert(created.error);
        }
        return false;
      }
      if (!created) {
        // 失敗してもシートは閉じない（入力を残す）
        alert('選手を追加できませんでした。\n入力内容と通信を確認してください。');
        return false;
      }
      added++;
      Admin.toast(created.order + ' ' + created.name + ' を追加しました');
      return true;
    }

    btnSaveClose.addEventListener('click', async function() {
      if (!(await save())) return;
      sheet.close();   // onClose が一覧を反映する
    });

    btnSaveNext.addEventListener('click', async function() {
      if (!(await save())) return;
      form.reset();   // コート・性別・新人は保つ
    });
  }

  // 一括登録(1行1人の名前を貼り付ける)。コート・性別・新人は共通。技は後で入れる。
  function openBulkSheet(ctx) {
    var body = document.createElement('div');
    var common = buildCommonFields(ctx, null);
    body.appendChild(common.el);

    var fNames = document.createElement('div');
    fNames.className = 'field';
    var lNames = document.createElement('label');
    lNames.textContent = '名前（1行に1人）';
    var ta = document.createElement('textarea');
    ta.rows = 8;
    ta.placeholder = '山田 太郎\n佐藤 花子\n…';
    var count = document.createElement('div');
    count.className = 'bulk-count';
    fNames.appendChild(lNames);
    fNames.appendChild(ta);
    fNames.appendChild(count);
    body.appendChild(fNames);

    function names() {
      return ta.value.split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean);
    }
    function updateCount() {
      count.textContent = names().length + ' 人';
    }
    ta.addEventListener('input', updateCount);
    updateCount();

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn';
    btnClose.textContent = '閉じる';
    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn primary';
    btnSave.textContent = '登録';

    var added = 0;
    var sheet = Admin.openSheet('複数人をまとめて登録', body, [btnClose, btnSave], function() {
      if (added > 0) Admin.reloadEvent();
    });
    btnClose.addEventListener('click', sheet.close);

    btnSave.addEventListener('click', async function() {
      var list = names();
      if (list.length === 0) { alert('名前を1人以上入力してください。'); return; }
      var court = common.court();
      if (!court) { alert('コートを選んでください。「＋」で新しいコートを作れます。'); return; }
      var sexLabel = common.isFemale() ? '女子' : '男子';
      if (!confirm(court + ' コート ' + sexLabel + ' ' + list.length + ' 人を登録します。よろしいですか？')) return;
      var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
      // 確認ダイアログの後・API 呼び出しの前で、大会が切り替わっていないか再確認する
      // （importCsvText と同じ規約。古い ctx の大会に書き込んでしまわないため）。
      if (Admin.currentEventId() !== eventId) {
        alert('大会が切り替わったため、登録を中止しました。');
        return;
      }
      btnSave.disabled = true;
      btnClose.disabled = true;
      sheet.lock(true);
      var res = await Api.createPlayersBulk(eventId, {
        court: court, isFemale: common.isFemale(), isNewFace: common.isNewFace(), names: list
      });
      if (Admin.currentEventId() !== eventId) return;   // 大会が切り替わっていたら画面に触らない
      sheet.lock(false);
      btnSave.disabled = false;
      btnClose.disabled = false;
      if (!res || res.error) {
        // 失敗してもシートは閉じない（入力を残す）
        alert('登録できませんでした。\n' + ((res && res.error) || '入力内容と通信を確認してください。'));
        return;
      }
      added += res.created;
      Admin.toast(res.created + ' 人を登録しました');
      // 履歴記録（CSV インポートと同様。一括登録も辿れるようにする）
      Api.addHistory(eventId, {
        action: 'bulk_add',
        detail: res.created + '名の選手を一括登録'
      });
      sheet.close();   // onClose も一覧を反映するが、別大会へ行って戻った経路では
                        // 既に閉じたシートの close が no-op になるため、ここでも直接反映する。
      Admin.reloadEvent();
    });
  }

  // 採点済みの選手の性別・技を変えたときの警告は courts.js（Courts.scoreMayChange /
  // Courts.scoreChangeConfirmMessage）に置いてある。PC 運営の選手表と同じ判定・同じ文言を使う。

  // 編集フォーム（行タップ）
  function openEditSheet(ctx, player) {
    var form = buildPlayerForm(ctx, player);

    var btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn danger';
    btnDelete.textContent = 'この選手を削除';

    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn primary';
    btnSave.textContent = '保存';

    var sheet = Admin.openSheet('選手を編集', form.el, [btnDelete, btnSave]);

    btnSave.addEventListener('click', async function() {
      var data = form.read();
      if (!data) return;

      // 採点済みの選手の性別や技を変えても、サーバーは得点を再計算しない。
      // 男女で配点が違う技があるほか、技の差し替えは採点画面が検知できないため、
      // 採点画面で開き直してもらう必要がある（Courts.scoreMayChange 参照）。
      if (Courts.scoreMayChange(player, data) && !confirm(Courts.scoreChangeConfirmMessage(player))) {
        return;
      }

      btnSave.disabled = true;
      btnDelete.disabled = true;
      sheet.lock(true);
      // round は送らない。サーバーは今の order から巡目を据え置く。
      var res = await Api.updatePlayerInfo(ctx.eventId, player.id, data);
      sheet.lock(false);
      btnSave.disabled = false;
      btnDelete.disabled = false;
      if (!res || !res.ok) {
        // 失敗してもシートは閉じない（入力を残す）
        if (res && res.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else if (res && res.reason === 'bib') {
          // 「ゼッケン番号 12 は「山田 太郎」が使っています」。
          // 誰と重なったかを知っているのはサーバーだけなので文言をそのまま出す。
          alert(res.error);
        } else {
          alert('選手の更新に失敗しました。\n入力内容と通信を確認してください。');
        }
        return;
      }
      sheet.close();
      Admin.toast('保存しました');
      Admin.reloadEvent();
    });

    btnDelete.addEventListener('click', async function() {
      // 一巡目の行だけ「二巡目の行は残ります」と断る（二巡目の行自体を削除するときは不要）。
      var roundFragment = (Courts.roundOf(player) === 1) ? '二巡目の行は残ります。\n' : '';
      if (!confirm(
        '選手「' + (player.name || '') + '」（' + (player.order || '') + '）を削除します。\n' +
        roundFragment +
        'よろしいですか？'
      )) return;

      btnDelete.disabled = true;
      btnSave.disabled = true;
      sheet.lock(true);
      var res = await Api.deletePlayer(ctx.eventId, player.id, false);

      if (res && res.blocked && res.reason === 'locked') {
        sheet.lock(false);
        btnDelete.disabled = false;
        btnSave.disabled = false;
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        return;
      }

      if (res && res.blocked) {
        // 採点済みガード。得点を出してもう一度確認し、承諾したときだけ force。
        // player はサーバー側の実装次第で null になり得るので、その場合は
        // 直前に読んだクロージャの値（name/order/score）にフォールバックする。
        var bp = res.player || { name: player.name, order: player.order, score: player.score };
        var ok = confirm(
          '「' + bp.name + '」（' + bp.order + '）は採点済みです（' +
          bp.score + '点）。\n' +
          '削除すると採点結果は戻せません。' + roundFragment + '\n' +
          '本当に削除しますか？'
        );
        if (!ok) {
          sheet.lock(false);
          btnDelete.disabled = false;
          btnSave.disabled = false;
          return;
        }
        res = await Api.deletePlayer(ctx.eventId, player.id, true);
      }

      sheet.lock(false);
      btnDelete.disabled = false;
      btnSave.disabled = false;
      if (res !== true) {
        alert('選手の削除に失敗しました。');
        return;
      }
      sheet.close();
      Admin.toast('削除しました');
      Admin.reloadEvent();
    });
  }

  // 「⋯」メニュー。主導線は1人ずつの登録で、CSV は一括登録用の二次導線。
  function openMenu(ctx) {
    var body = document.createElement('div');

    var btnBulk = document.createElement('button');
    btnBulk.type = 'button';
    btnBulk.className = 'menu-item';
    btnBulk.textContent = '👥 複数人をまとめて登録';
    body.appendChild(btnBulk);

    var btnCsv = document.createElement('button');
    btnCsv.type = 'button';
    btnCsv.className = 'menu-item';
    btnCsv.textContent = '📄 CSVインポート';
    body.appendChild(btnCsv);

    var btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'btn';
    btnCancel.textContent = '閉じる';

    var sheet = Admin.openSheet('メニュー', body, [btnCancel]);
    btnCancel.addEventListener('click', sheet.close);

    btnCsv.addEventListener('click', function() {
      sheet.close();
      // ファイル選択は storage.js（PC 運営の選手表と共通）。admin.html には file input を置かない。
      Storage.pickCsvFile(function(text) { return importCsvText(ctx, text); });
    });

    btnBulk.addEventListener('click', function() {
      sheet.close();
      openBulkSheet(ctx);
    });
  }

  async function importCsvText(ctx, text) {
    var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
    var eventName = ctx.event && ctx.event.name;
    var mode = 'replace';
    if (ctx.players.length > 0) {
      mode = confirm(
        '大会「' + eventName + '」に読み込みます。' +
        '既存データをクリアして読み込みますか？（キャンセルで追記）'
      ) ? 'replace' : 'append';
      if (mode === 'append') {
        var okAppend = confirm(
          '既存の ' + ctx.players.length + ' 名に追記します。' +
          '同じ順番の選手がいると重複します。追記しますか？'
        );
        if (!okAppend) return;
      }
    }
    // 大会が切り替わっていたら、確認ダイアログの後・Api.importCsv の前で必ず止める
    // （古い ctx の大会に書き込んでしまわないため）。
    if (Admin.currentEventId() !== eventId) {
      alert('大会が切り替わったため、CSV の読み込みを中止しました。');
      return;
    }
    var result = await Api.importCsv(eventId, text, mode);
    if (result && result.blocked && result.reason === 'locked') {
      alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      return;
    }
    if (result && result.blocked) {
      var ok = confirm(
        '大会「' + eventName + '」\n' +
        'この大会には採点済みの選手が少なくとも ' + result.scoredCount + ' 名います。\n' +
        '他のコート端末による採点も含まれます。\n' +
        '読み込みを続けると、これらの採点結果はすべて失われます。\n' +
        '本当に続行しますか？'
      );
      if (!ok) return;
      if (Admin.currentEventId() !== eventId) {
        alert('大会が切り替わったため、CSV の読み込みを中止しました。');
        return;
      }
      result = await Api.importCsv(eventId, text, mode, true);
    }
    if (!result || !result.success) {
      alert('インポートに失敗しました。' + (result && result.error ? '\n' + result.error : ''));
      return;
    }
    // ゼッケンの重複・範囲外は行を弾かず「未設定」に落として取り込む（サーバー側）ので、
    // その件数があれば結果の文言に足す（設計書「選手の追加項目」レビュー修正）。
    var bibMsg = Courts.bibDroppedMessage(result.bibDropped);
    Admin.toast(result.playerCount + '名を読み込みました' + (bibMsg ? '。' + bibMsg : ''));
    // 履歴記録（server/data/history に残す。CSV の一括登録は履歴を辿れるようにする）
    Api.addHistory(eventId, {
      action: 'csv_import',
      detail: result.playerCount + '名の選手データをインポート'
    });
    if (Admin.currentEventId() === eventId) Admin.reloadEvent();
  }

  Admin.registerTab('players', { render: render });
})();
