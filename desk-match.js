// 試合の区画（#match/<id>）。コート別の進み具合と採点画面を開く入口。
// 二巡目の形登録（技の入力）は別の区画（desk-round2.js）に分けた（ユーザー要望 2026-09-30）。
//
// ポーリングはしない。「確定 n / N」といま採点中の選手は、大会を読んだ時点の値で、
// 「↻ 最新に更新」（Desk.reloadEvent）を押したときだけ変わる。自動で更新するのは
// 配信ボード（board.html）だけ、という既存の方針を変えないため。
(function() {
  var outsideClickBound = false;   // 「⋯」の外側クリック検知は document に1回だけ付ける

  // 大会が持つコート一覧（基本情報の settings.courts）。desk-players.js と同じ理由で
  // ここにも置く（courts.js はこの計画では触らない）。
  function extraCourts(ctx) {
    return (ctx && ctx.event && ctx.event.settings && ctx.event.settings.courts) || [];
  }

  // コート別のカードの材料。Courts.courtProgress は選手から導かれたコートしか返さないので、
  // 大会が持つコート（選手がまだ 1 人もいないコート）を 0 / 0 の行として補う。
  // 並びは Courts.listFrom に合わせる（昇順・未分類は末尾）。
  // コート名が 'constructor' でも壊れないよう Object.create(null) + hasOwnProperty で引く。
  // 決戦（暫定ベスト8）の行は数えない（決戦は別のカードにする。設計書 2026-09-28）。
  // コートの一覧も決戦以外の行から作る。2026-09-22 の設計で専用コート「決戦」に候補を
  // 置いた既存大会で、「決戦 コート 0 / 0」の通常のカードが出ないように。
  // female が真偽値なら、その性別の行だけを数える（男子の部・女子の部でカードを分ける。
  // ユーザー要望 2026-09-30）。カードに female を持たせ、レンタル人数もその性別で数える。
  function courtCards(ctx, round, female) {
    var plainPlayers = (ctx.players || []).filter(function(p) {
      if (p.finalist === true) return false;
      if (typeof female === 'boolean' && (p.isFemale === true) !== female) return false;
      return true;
    });
    // 「確定 n / N」は確定済みの行を数える（採点途中は数えない。ユーザー要望 2026-09-30）。
    // 選手のいないコート（settings.courts だけにある「稽古」など）のカードは出さない。
    var byCourt = Object.create(null);
    plainPlayers.forEach(function(p) {
      if (Courts.roundOf(p) !== round) return;
      var c = Courts.courtOf(p);
      if (!byCourt[c]) byCourt[c] = { court: c, total: 0, scored: 0 };
      byCourt[c].total++;
      if (p.confirmed === true) byCourt[c].scored++;
    });
    return Courts.listFrom(plainPlayers, extraCourts(ctx)).filter(function(c) {
      return Object.prototype.hasOwnProperty.call(byCourt, c);
    }).map(function(c) {
      var row = byCourt[c];
      if (typeof female === 'boolean') row.female = female;
      return row;
    });
  }

  // --- 描画 ---

  function render(container, ctx) {
    container.innerHTML = '';
    var st = EventStatus.of(ctx.event);

    container.appendChild(buildHead(ctx));
    container.appendChild(buildCourts(st, ctx));
    // 決戦 進行中のときだけ、決戦のカード（buildCourts）の直後に暫定順位を出す
    // （非同期。あとから差し込む。レビュー指摘E）。二巡目の形登録の表は desk-round2.js に移した。
    if (st === 'round2_final') renderFinaleTable(container, ctx);
  }

  function buildHead(ctx) {
    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '試合進行';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.appendChild(h2);
    head.appendChild(spacer);

    var btnReload = document.createElement('button');
    btnReload.type = 'button';
    btnReload.className = 'desk-btn';
    btnReload.id = 'btnMatchReload';
    btnReload.textContent = '↻ 最新に更新';
    btnReload.addEventListener('click', function() { Desk.reloadEvent(); });
    head.appendChild(btnReload);

    head.appendChild(buildMenu(ctx));
    return head;
  }

  // details/summary の外側をクリックしたら閉じる。document への登録は1回だけ
  // （描画のたびにリスナーが積み重ならないように）。desk-events.js と同じ作法。
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

  function menuItem(menu, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', function() {
      menu.open = false;
      onClick();
    });
    return b;
  }

  function buildMenu(ctx) {
    bindOutsideClickOnce();
    var menu = document.createElement('details');
    menu.className = 'desk-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    sum.setAttribute('aria-label', '試合の操作');
    menu.appendChild(sum);
    var body = document.createElement('div');
    body.className = 'desk-menu-body';
    menu.appendChild(body);
    body.appendChild(menuItem(menu, '📄 CSVエクスポート', function() { onExportCsv(ctx); }));
    return menu;
  }

  async function onExportCsv(ctx) {
    var csv = await Api.exportCsv(ctx.eventId);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    if (!csv) {
      alert('エクスポートに失敗しました。通信を確認してください。');
      return;
    }
    Storage.downloadCsv('players.csv', csv);
    Desk.toast('CSV を保存しました');
  }

  // --- コート別のカード ---

  function buildCourts(st, ctx) {
    var wrap = document.createElement('div');
    var round = Courts.progressRound(st, ctx.players);

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.id = 'matchCourtsNote';
    note.textContent = (round === 1 ? '一巡目' : '二巡目') + 'の進み具合です。' +
      '「確定」の件数と「いま採点中」は自動では変わりません。' +
      '「↻ 最新に更新」を押すと読み直します。';
    wrap.appendChild(note);

    // 男子の部・女子の部でカードの組を分ける（0 名の部は出さない）。見出しは「男子の部 一巡目」のように巡目を添える。
    var roundLabel = (round === 1 ? '一巡目' : '二巡目');
    var groups = [];
    [[false, '男子の部'], [true, '女子の部']].forEach(function(g) {
      var cards = courtCards(ctx, round, g[0]);
      if (cards.some(function(r) { return r.total > 0; })) {
        groups.push({ caption: g[1] + ' ' + roundLabel, rows: cards });
      }
    });
    if (groups.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいません。「選手」の区画で登録してください。';
      wrap.appendChild(none);
      return wrap;
    }

    // 決戦（暫定ベスト8）は先頭コート（通常 A）の二巡目の末尾で斬る（設計書 2026-09-28）。
    // 通常のカード（rows）は決戦の行を数えず、決戦は候補の行だけを数えるカード 1 枚にして別枠に置く。
    // 決戦かどうかはコート名ではなく行の印 finalist で分ける。二巡目を数えるときだけ出す。
    var finale = [];
    var fin = Courts.finalists(ctx.players);
    if (round === 2 && fin.length > 0) {
      finale = [{
        court: Courts.finaleCourt(ctx.players),
        total: fin.length,
        scored: fin.filter(function(p) { return p.confirmed === true; }).length,
        finale: true
      }];
    }
    var caption = finale.length > 0
      ? '決戦（暫定ベスト8・' + finale[0].court + ' コートの最後）' : '';

    // 決戦 進行中は決戦のカードを先に、他コートは畳む（設計書「画面」）。
    if (st === 'round2_final' && finale.length > 0) {
      wrap.appendChild(buildCourtGrid(finale, ctx, round, caption));
      var others = document.createElement('details');
      others.className = 'desk-match-others';
      var sum = document.createElement('summary');
      sum.textContent = '他のコート';
      others.appendChild(sum);
      groups.forEach(function(g) { others.appendChild(buildCourtGrid(g.rows, ctx, round, g.caption)); });
      wrap.appendChild(others);
      appendRound1Results(wrap, ctx, round);
      return wrap;
    }

    groups.forEach(function(g) { wrap.appendChild(buildCourtGrid(g.rows, ctx, round, g.caption)); });
    if (finale.length > 0) {
      // 二巡目 進行中は「開始前」として別枠に置く（先頭コートの通常の選手が終わってから斬る）。
      wrap.appendChild(buildCourtGrid(finale, ctx, round,
        st === 'round2' ? caption + '　開始前' : caption));
    }
    appendRound1Results(wrap, ctx, round);
    return wrap;
  }

  // 二巡目を数えている間も一巡目の結果を残す（ユーザー要望 2026-09-30）。一巡目のカード一式を
  // 「一巡目の結果」として畳んで下に置く（読み取り専用: 採点中の表示とボタンは出さない）。
  function appendRound1Results(wrap, ctx, round) {
    if (round !== 2) return;
    var groups = [];
    [[false, '男子の部'], [true, '女子の部']].forEach(function(g) {
      var cards = courtCards(ctx, 1, g[0]);
      if (cards.length > 0) groups.push({ caption: g[1] + ' 一巡目', rows: cards });
    });
    if (groups.length === 0) return;
    var box = document.createElement('details');
    box.className = 'desk-match-others';
    box.id = 'matchRound1Results';
    var sum = document.createElement('summary');
    sum.textContent = '一巡目の結果';
    box.appendChild(sum);
    groups.forEach(function(g) { box.appendChild(buildCourtGrid(g.rows, ctx, 1, g.caption, true)); });
    wrap.appendChild(box);
  }

  // コート別カードのグリッドを1つ作る。caption が空でなければ見出しを先頭に置く。
  function buildCourtGrid(rows, ctx, round, caption, readOnly) {
    var wrap = document.createElement('div');
    if (caption) {
      var h3 = document.createElement('h3');
      h3.className = 'desk-match-caption';
      h3.textContent = caption;
      wrap.appendChild(h3);
    }
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいません。「選手」の区画で登録してください。';
      wrap.appendChild(none);
      return wrap;
    }
    var grid = document.createElement('div');
    grid.className = 'desk-match-courts';
    rows.forEach(function(r) { grid.appendChild(buildCourtCard(r, ctx, round, readOnly)); });
    wrap.appendChild(grid);
    return wrap;
  }

  function buildCourtCard(row, ctx, round, readOnly) {
    var card = document.createElement('section');
    card.className = 'desk-match-card';

    var name = document.createElement('div');
    name.className = 'desk-match-court';
    name.textContent = (row.court === Courts.UNASSIGNED) ? Courts.UNASSIGNED : row.court + ' コート';
    card.appendChild(name);

    var prog = document.createElement('div');
    prog.className = 'desk-match-progress' +
      ((row.total > 0 && row.scored === row.total) ? ' done' : '');
    prog.textContent = '確定 ' + row.scored + ' / ' + row.total;
    card.appendChild(prog);

    // 真剣レンタルの人数はカードに出さない（ユーザー要望 2026-09-30。選手表のレンタル列で分かる）

    // コートの決まっていない選手は採点画面のコート絞り込みに載せられない
    // （サーバーの isValidCourt が「未分類」を弾く）。カードは出すが操作は置かない。
    if (row.court === Courts.UNASSIGNED) {
      var hint = document.createElement('p');
      hint.className = 'desk-note';
      hint.textContent = 'コートが決まっていない選手です。「選手」の区画でコートを設定してください。';
      card.appendChild(hint);
      return card;
    }

    if (readOnly) {
      card.appendChild(buildCardTable(ctx, row, round, null));
      return card;
    }

    var live = document.createElement('div');
    var liveP = livePlayerFor(ctx, row, round);
    var finished = row.total > 0 && row.scored === row.total;
    if (liveP) {
      live.className = 'desk-match-live';
      live.textContent = 'いま採点中: ' + (liveP.name || '(名称未設定)');
    } else if (finished) {
      live.className = 'desk-match-live done';
      live.textContent = '終了';
    } else {
      live.className = 'desk-match-live idle';
      live.textContent = '待機中';
    }
    card.appendChild(live);

    // そのカードの選手の表（順番・ゼッケン・選手名・級位段位・得点・備考。ユーザー要望 2026-09-30）。
    // 数えている行（同じコート・巡目・性別・決戦の印）を試技順に並べる。
    card.appendChild(buildCardTable(ctx, row, round, liveP ? liveP.id : null));

    var actions = document.createElement('div');
    actions.className = 'desk-match-actions';

    var btnOpen = document.createElement('button');
    btnOpen.type = 'button';
    btnOpen.className = 'desk-btn primary';
    btnOpen.textContent = '採点画面を開く';
    btnOpen.addEventListener('click', function() {
      Desk.openScoring(ctx.eventId, row.court);
    });
    actions.appendChild(btnOpen);

    // 配信用ボード（board.html#<token>/<コート>）の URL。コートごとに違うのでカードに置く（ユーザー要望 2026-09-30。
    // 閲覧専用 URL（共有リンク）は大会で 1 つなので結果確認に任せ、ここには置かない）。トークンは冪等（Api.createShareLink）。
    var btnBoard = document.createElement('button');
    btnBoard.type = 'button';
    btnBoard.className = 'desk-btn';
    btnBoard.textContent = '📺 配信用ボードの URL をコピー';
    btnBoard.addEventListener('click', function() {
      copyBoardUrl(btnBoard, ctx, row.court);
    });
    actions.appendChild(btnBoard);

    card.appendChild(actions);
    return card;
  }

  // カードの中の選手の表
  function buildCardTable(ctx, row, round, liveId) {
    var list = (ctx.players || []).filter(function(p) {
      return Courts.courtOf(p) === row.court && Courts.roundOf(p) === round &&
        (p.finalist === true) === (row.finale === true) &&
        (typeof row.female !== 'boolean' || (p.isFemale === true) === row.female);
    }).sort(Courts.compareOrder);
    var table = document.createElement('table');
    table.className = 'desk-table desk-match-table';
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    var byId = Object.create(null);
    (ctx.players || []).forEach(function(p) { if (p && typeof p.id === 'string') byId[p.id] = p; });
    var withR1 = (round === 2);   // 二巡目の表には一巡目の得点も並べる（ユーザー要望 2026-09-30）
    var labels = withR1
      ? ['順番', 'ゼッケン', '選手名', '級位・段位', '一巡目', '得点', '備考']
      : ['順番', 'ゼッケン', '選手名', '級位・段位', '得点', '備考'];
    labels.forEach(function(label, i) {
      var th = document.createElement('th');
      th.textContent = label;
      if (i === labels.length - 1) th.className = 'note';
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    list.forEach(function(p) {
      var tr = document.createElement('tr');
      // 確定済みの行はグレー、いま採点中の行は反転（採点画面の選手一覧と同じ配色）
      if (p.confirmed === true) tr.className = 'done';
      if (liveId && p.id === liveId) tr.className = 'current';
      var m = (p.order || '').match(/-(\d+)$/);
      var scored = p.confirmed === true;   // 得点は確定済みだけ出す（ユーザー要望 2026-09-30）
      var cells = [
        [m ? m[1] : (p.order || ''), 'num'],
        [Number.isInteger(p.bib) ? String(p.bib) : '', 'num'],
        [p.name || '', 'name'],
        [Courts.rankLabel(p.rank), '']
      ];
      if (withR1) {
        var src = (p.sourcePlayerId && byId[p.sourcePlayerId]) ? byId[p.sourcePlayerId] : null;
        cells.push([(src && src.confirmed === true) ? String(src.score || 0) : '', 'num score confirmed']);
      }
      cells.push([scored ? String(p.score || 0) : '', 'num score' + (p.confirmed === true ? ' confirmed' : '')]);
      cells.push([p.note || '', 'note']);
      cells.forEach(function(c) {
        var td = document.createElement('td');
        td.textContent = c[0];
        if (c[1]) td.className = c[1];
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  // そのカードで「いま採点中」に出す名前。決戦のカードと先頭コートの通常のカードは同じコート
  // （live はコートごとに 1 人）を分け合うので、採点中の選手の印がカードと合うときだけ出す
  // （二巡目 進行中に A の通常の選手を採点しているとき、決戦のカードに名前を出さないように）。
  // そのカードで「いま採点中」の選手（行）。live はコートごとに 1 人なので、その選手が
  // このカードの組（部・巡目・決戦の印）に属するときだけ返す（ユーザー要望 2026-09-30:
  // 男女＋コート＋巡目で判定）。属さなければ null。
  function livePlayerFor(ctx, row, round) {
    var who = Courts.livePlayerName(ctx.event && ctx.event.live, row.court, ctx.players);
    if (!who) return null;
    var entry = ctx.event.live[row.court];   // livePlayerName が名前を返した＝hasOwnProperty 済み
    var p = (ctx.players || []).filter(function(x) { return x && x.id === entry.playerId; })[0];
    if (!p) return null;
    if ((p.finalist === true) !== (row.finale === true)) return null;
    if (Courts.roundOf(p) !== round) return null;
    if (typeof row.female === 'boolean' && (p.isFemale === true) !== row.female) return null;
    return p;
  }

  // 配信用ボードの URL をクリップボードへ。desk-results.js の onCopyBoard と同じ作法。
  async function copyBoardUrl(btn, ctx, court) {
    btn.disabled = true;
    try {
      var link = await Api.createShareLink(ctx.eventId);
      if (ctx.isStale()) return;   // 画面を離れていたら alert も出さない
      if (!link || !link.token) {
        alert('共有リンクを作成できませんでした。通信を確認してください。');
        return;
      }
      var url = new URL('board.html#' + link.token + '/' + encodeURIComponent(court), location.href).href;
      await Desk.copyText(url, court + ' コートの配信用ボードの URL をコピーしました');
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }

  // 決戦 進行中のときだけ、コートのカードの下に暫定順位を出す。
  // 順位はサーバーが計算する（computeRanking の finale）。ポーリングはしない
  // （「↻ 最新に更新」で読み直す、というこの区画の方針を変えない）。
  async function renderFinaleTable(container, ctx) {
    var box = document.createElement('div');
    box.className = 'desk-match-finale-rank';
    box.textContent = '読み込み中…';
    container.appendChild(box);
    var data = await Api.loadRanking(ctx.eventId);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    if (!data || !data.finale) { box.textContent = '暫定順位を取得できませんでした。'; return; }
    box.textContent = '';
    var h3 = document.createElement('h3');
    h3.className = 'desk-match-caption';
    h3.textContent = '決戦の暫定順位';
    box.appendChild(h3);
    var table = document.createElement('table');
    table.className = 'desk-table';
    table.innerHTML = '<thead><tr><th>試技順</th><th>名前</th><th>一巡目</th><th>二巡目</th>' +
      '<th>合計</th><th>暫定順位</th></tr></thead>';
    var tbody = document.createElement('tbody');
    data.finale.rows.forEach(function(r) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(String(r.order), 'num'));
      tr.appendChild(cell(r.name, 'desk-cell-main'));
      tr.appendChild(cell(String(r.r1), 'num'));
      tr.appendChild(cell(r.r2 === null ? '—' : String(r.r2), 'num'));
      tr.appendChild(cell(r.scored ? String(r.total) : '—', 'num'));
      tr.appendChild(cell(r.rank === null ? '—' : String(r.rank), 'num'));
      if (!r.scored) tr.className = 'is-pending';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    box.appendChild(table);
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  Desk.registerTab('match', { render: render });
})();
