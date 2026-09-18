// 試合の区画（#match/<id>）。コート別の状況・採点画面を開く・二巡目の生成と技入力。
// スマホ運営の「進行」タブ（admin-round.js）と同じことを PC 幅でやる。
//
// ポーリングはしない。「採点済み n / N」といま採点中の選手は、大会を読んだ時点の値で、
// 「↻ 最新に更新」（Desk.reloadEvent）を押したときだけ変わる。自動で更新するのは
// 配信ボード（board.html）だけ、という既存の方針を変えないため。
(function() {
  var outsideClickBound = false;   // 「⋯」の外側クリック検知は document に1回だけ付ける

  // --- 描画 ---

  function render(container, ctx) {
    container.innerHTML = '';
    var st = EventStatus.of(ctx.event);

    container.appendChild(buildHead(ctx));
    container.appendChild(buildCourts(st, ctx));
  }

  function buildHead(ctx) {
    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '試合';
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
      '「採点済み」と「いま採点中」は自動では変わりません。' +
      '「↻ 最新に更新」を押すと読み直します。';
    wrap.appendChild(note);

    var rows = Courts.courtProgress(ctx.players, round);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいません。「選手」の区画で登録してください。';
      wrap.appendChild(none);
      return wrap;
    }

    var grid = document.createElement('div');
    grid.className = 'desk-match-courts';
    rows.forEach(function(r) { grid.appendChild(buildCourtCard(r, ctx)); });
    wrap.appendChild(grid);
    return wrap;
  }

  function buildCourtCard(row, ctx) {
    var card = document.createElement('section');
    card.className = 'desk-match-card';

    var name = document.createElement('div');
    name.className = 'desk-match-court';
    name.textContent = (row.court === Courts.UNASSIGNED) ? Courts.UNASSIGNED : row.court + ' コート';
    card.appendChild(name);

    var prog = document.createElement('div');
    prog.className = 'desk-match-progress' +
      ((row.total > 0 && row.scored === row.total) ? ' done' : '');
    prog.textContent = '採点済み ' + row.scored + ' / ' + row.total;
    card.appendChild(prog);

    // コートの決まっていない選手は採点画面のコート絞り込みに載せられない
    // （サーバーの isValidCourt が「未分類」を弾く）。カードは出すが操作は置かない。
    if (row.court === Courts.UNASSIGNED) {
      var hint = document.createElement('p');
      hint.className = 'desk-note';
      hint.textContent = 'コートが決まっていない選手です。「選手」の区画でコートを設定してください。';
      card.appendChild(hint);
      return card;
    }

    var live = document.createElement('div');
    var who = Courts.livePlayerName(ctx.event && ctx.event.live, row.court, ctx.players);
    if (who) {
      live.className = 'desk-match-live';
      live.textContent = 'いま採点中: ' + who;
    } else {
      live.className = 'desk-match-live idle';
      live.textContent = '待機中';
    }
    card.appendChild(live);

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

    var btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'desk-btn';
    btnCopy.textContent = 'URL をコピー';
    btnCopy.addEventListener('click', function() {
      // コートの端末にメッセージで送れるよう、相対ではなく絶対 URL にする
      var url = new URL(Desk.scoringHref(ctx.eventId, row.court), location.href).href;
      Desk.copyText(url, row.court + ' コートの採点画面の URL をコピーしました');
    });
    actions.appendChild(btnCopy);

    card.appendChild(actions);
    return card;
  }

  Desk.registerTab('match', { render: render });
})();
