// 試合の区画（#match/<id>）。工程表（段階の遷移ボタン）・コート別の進み具合・採点画面を開く入口。
// 二巡目の形登録（技の入力）は別の区画（desk-round2.js）に分けた（ユーザー要望 2026-09-30）。
// 工程表は部品（DeskMatch.buildSteps）にして、形登録の区画の先頭にも出す（設計書
// 2026-10-03-round2-forms-prereg-design.md 6.2。遷移ボタンは工程表の中にだけ置く）。
//
// ポーリングはしない。「確定 n / N」といま採点中の選手は、大会を読んだ時点の値で、
// 「↻ 最新に更新」（Desk.reloadEvent）を押したときだけ変わる。自動で更新するのは
// 配信ボード（board.html）だけ、という既存の方針を変えないため。
(function() {

  // 大会が持つコート一覧（基本情報の settings.courts）。desk-players.js と同じ理由で
  // ここにも置く（courts.js はこの計画では触らない）。
  function extraCourts(ctx) {
    return (ctx && ctx.event && ctx.event.settings && ctx.event.settings.courts) || [];
  }

  // コート別のカードの材料。Courts.courtProgress は選手から導かれたコートしか返さないので、
  // 大会が持つコート（選手がまだ 1 人もいないコート）を 0 / 0 の行として補う。
  // 並びは Courts.listFrom に合わせる（昇順・未分類は末尾）。
  // コート名が 'constructor' でも壊れないよう Object.create(null) + hasOwnProperty で引く。
  // 決戦（暫定ベスト4）の行は数えない（決戦は別のカードにする。設計書 2026-09-28）。
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
    container.appendChild(buildSteps(st, ctx));
    var diffBox = buildFinalistDiff(st, ctx.players);
    if (diffBox) container.appendChild(diffBox);
    container.appendChild(buildCourts(st, ctx));
    // 決戦 進行中のときだけ、決戦のカード（buildCourts）の直後に暫定順位を出す
    // （非同期。あとから差し込む。レビュー指摘E）。二巡目の形登録の表は desk-round2.js に移した。
    if (st === 'round2_final') renderFinaleTable(container, ctx);
    // 招待した採点端末の一覧（設計書 2026-10-03 6.2。desk-invites.js）。試合進行の末尾に置く
    if (window.DeskInvites) container.appendChild(DeskInvites.buildInvitesSection(ctx));
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
    // CSV エクスポートは結果確認へ移した（1 画面 1 目的。ユーザー要望 2026-09-30）。⋯ は空になったので置かない
    return head;
  }

  // --- 工程表（ユーザー要望 2026-09-30） ---
  // 試合進行の先頭に「① 一巡目 → ② 二巡目の形登録 → ③ 二巡目（決戦を含む）」の 3 段を置き、
  // 現在の段を金で塗って、その段階でやることを 1 行で示す。下に、その段階に関係する遷移ボタン
  // （進める・戻す。二巡目準備なら「二巡目を行わず最終結果へ」も）を置く。段階の遷移ボタンは
  // 工程表の中だけ（上部の状態バーは表示だけ）。押したときの確認と通信は Desk.applyStatus（desk.js）。
  // 工程表は試合進行と、二巡目の形登録の区画（desk-round2.js）の先頭に出す（2026-10-03。
  // DeskMatch.buildSteps(st, ctx, { where: 'round2' })）。区画は同時に 1 つしか描かないので、
  // 遷移ボタンの id（btnDeskNext など）は重ならない。
  var MATCH_STEPS = [
    { label: '① 一巡目',               states: ['round1'] },
    { label: '② 二巡目の形登録',       states: ['round1_done'] },
    { label: '③ 二巡目（決戦を含む）', states: ['round2', 'round2_final', 'round2_done'] }
  ];

  // 工程表の現在の段の添字。準備中は -1（まだ①の前）、最終結果・アーカイブは 3（全部済み）。
  function matchStepIndex(st) {
    if (st === 'final' || st === 'archived') return MATCH_STEPS.length;
    for (var i = 0; i < MATCH_STEPS.length; i++) {
      if (MATCH_STEPS[i].states.indexOf(st) !== -1) return i;
    }
    return -1;
  }

  // その段階でやること（1 行）。ボタンの文言は EventStatus.nextLabel と同じものを引く。
  // where は工程表を置く区画（'match' 試合進行 | 'round2' 二巡目の形登録）。違うのは形登録の段の 1 行だけ。
  function stepTodo(st, players, where) {
    var nx = EventStatus.nextLabel(st, players);
    switch (st) {
      case 'draft':
        return '準備中です。選手と技（二巡目で形を変える選手は「二巡目の形」も）をそろえたら「' + nx +
          '」を押します（採点画面が別のウィンドウで開きます）。';
      case 'round1':
        return '各コートで一巡目を採点しています。全コートの確定がそろったら「' + nx + '」を押します。';
      case 'round1_done':
        return where === 'round2'
          ? '申請された二巡目の形（申請の無い人は一巡目の形）が入っています。当日の変更があれば下の表で直し、' +
            '確かめ終えたら「' + nx + '」を押します。試技順は一巡目の得点が低い順です。'
          : '二巡目の行ができました。形登録で形を確かめてから「' + nx + '」を押します。';
      case 'round2':
        return EventStatus.hasFinalists(players)
          ? '各コートで二巡目を採点しています。決戦以外が斬り終わったら「' + nx + '」を押します。'
          : '各コートで二巡目を採点しています。全コートの確定がそろったら「' + nx + '」を押します。';
      case 'round2_final':
        return '決戦 進行中です（' + Courts.finaleCourt(players) + ' コートの最後）。斬り終わったら「' + nx + '」を押します。';
      case 'round2_done':
        return '二巡目終了です。結果確認で順位を確かめてから「' + nx + '」を押します。';
      case 'final':
        return '最終結果です（得点・選手・技は編集できません）。発表・共有・書き出しは結果確認から。';
      case 'archived':
        return 'アーカイブ済みです（見るだけ）。';
      default:
        return '';
    }
  }

  // 網羅検証 S18: 一巡目の終了のあとで一巡目の行が確定・得点変更されると、決戦（暫定ベスト4）の
  // 印は選び直されない。今の一巡目の確定得点で選び直した結果と違うときに警告を出す
  // （判定は EventStatus.finalistDiff、文言は Courts.finalistDiffMessage。スマホ運営と共通）。
  // 一巡目終了より前は二巡目の行が無いので出ない。
  function buildFinalistDiff(st, players) {
    if (['round1_done', 'round2', 'round2_final', 'round2_done'].indexOf(st) === -1) return null;
    var msg = Courts.finalistDiffMessage(EventStatus.finalistDiff(players || []));
    if (!msg) return null;
    var box = document.createElement('p');
    box.className = 'desk-warn';
    box.id = 'matchFinalistDiff';
    box.style.whiteSpace = 'pre-line';
    box.textContent = msg;
    return box;
  }

  // 二巡目を開始する前の検査（Courts.round2StartBlockers。設計書 2026-10-03 5.3）に引っかかる行が
  // あるときの帯の文言。無ければ ''。工程表は「二巡目を開始 ▶」を押せなくして、この帯で理由を示す
  // （押したときの最終の検査は Desk.applyStatus が読み直した大会でもう一度行う）。
  function round2BlockerText(st, ctx, where) {
    if (st !== 'round1_done') return '';
    var blockers = Courts.round2StartBlockers(ctx.event, ctx.players || []);
    if (blockers.length === 0) return '';
    return Courts.blockerMessage(blockers, where === 'round2'
      ? '二巡目を開始できません。下の表で直してください。'
      : '二巡目を開始できません。形登録で直してください。');
  }

  // 工程表。opts.where: 'match'（既定。試合進行）| 'round2'（二巡目の形登録の区画の先頭）。
  // 違いは形登録の段の 1 行（stepTodo）と近道のボタンだけ（設計書 2026-10-03 6.2）。
  // 形登録の区画は技を直すたびにこれを作り直して差し替える（帯と「二巡目を開始」の可否を合わせるため）。
  function buildSteps(st, ctx, opts) {
    var where = (opts && opts.where === 'round2') ? 'round2' : 'match';
    var players = ctx.players || [];
    var box = document.createElement('div');
    box.className = 'desk-steps';
    box.id = where === 'round2' ? 'round2Steps' : 'matchSteps';

    var row = document.createElement('div');
    row.className = 'desk-steps-row';
    var cur = matchStepIndex(st);
    MATCH_STEPS.forEach(function(s, i) {
      if (i > 0) {
        var arrow = document.createElement('span');
        arrow.className = 'desk-steps-arrow';
        arrow.textContent = '→';
        row.appendChild(arrow);
      }
      var el = document.createElement('span');
      el.className = 'desk-steps-step' + (i === cur ? ' on' : '') + (i < cur ? ' done' : '');
      el.textContent = s.label;
      row.appendChild(el);
    });
    box.appendChild(row);

    var todo = document.createElement('p');
    todo.className = 'desk-steps-todo';
    todo.id = where === 'round2' ? 'round2StepsTodo' : 'matchStepsTodo';
    todo.appendChild(document.createTextNode(stepTodo(st, players, where)));
    // 形登録（②）と結果確認への近道。形登録の区画では、逆向きに試合進行への近道
    // （コート別の進み具合を見たいとき）を置く。
    if (st === 'round1_done') {
      todo.appendChild(where === 'round2'
        ? jumpButton('btnRound2GoMatch', '試合進行へ →', 'match', ctx)
        : jumpButton('btnMatchGoRound2', '形登録へ →', 'round2', ctx));
    } else if (st === 'round2_done' || st === 'final' || st === 'archived') {
      todo.appendChild(jumpButton('btnMatchGoResults', '結果確認へ →', 'results', ctx));
    }
    box.appendChild(todo);

    var blockText = round2BlockerText(st, ctx, where);
    if (blockText) {
      var band = document.createElement('p');
      band.className = 'desk-steps-blockers';
      band.id = where === 'round2' ? 'round2StepsBlockers' : 'matchStepsBlockers';
      band.textContent = blockText;
      box.appendChild(band);
    }

    var actions = document.createElement('div');
    actions.className = 'desk-steps-actions';

    // 「次へ進む」の行き先は選手データで変わる（二巡目 進行中は、決戦の行があれば
    // 決戦へ、無ければ二巡目終了へ）。ラベルも同じ判定で決める。
    var nx = EventStatus.nextStep(st, players);
    if (nx) {
      var next = stepButton('btnDeskNext', 'desk-btn primary',
        EventStatus.nextLabel(st, players) + ' ▶', st, nx,
        function(pl) { return EventStatus.nextStep(st, pl); });
      if (blockText) {
        // 二巡目の行に誤りがある間は押せない。data-blocked は Desk.setStageButtonsDisabled が
        // 通信の後に有効へ戻さないための印（他の遷移ボタンの通信で解けないように）
        next.disabled = true;
        next.setAttribute('data-blocked', '1');
        next.title = '二巡目の行の技の誤りを直すと押せます';
      }
      actions.appendChild(next);
    }
    var back = EventStatus.prev(st, players);
    if (back) {
      actions.appendChild(stepButton('btnDeskBack', 'desk-btn',
        '◀ ' + EventStatus.LABELS[back] + ' に戻す', st, back,
        function(pl) { return EventStatus.prev(st, pl); }));
    }
    // 二巡目を行わずに最終結果へ（二巡目準備のときだけ）
    if (st === 'round1_done') {
      actions.appendChild(stepButton('btnDeskSkipRound2', 'desk-btn desk-btn-sub',
        '二巡目を行わず最終結果へ', st, 'final'));
    }
    if (actions.childNodes.length > 0) box.appendChild(actions);
    return box;
  }

  // resolveTo: 読み直した選手から行き先を決め直す関数（省略可。行き先が選手のデータで変わる
  // 「次へ進む」「戻す」だけが渡す。Desk.applyStatus が読み直した結果と突き合わせる）
  function stepButton(id, cls, label, from, to, resolveTo) {
    var b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', function() { Desk.applyStatus(from, to, { resolveTo: resolveTo }); });
    return b;
  }

  function jumpButton(id, label, tab, ctx) {
    var b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = 'desk-btn-sub';
    b.textContent = label;
    b.addEventListener('click', function() { Desk.navigate(tab, ctx.eventId); });
    return b;
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

    // 決戦（暫定ベスト4）は先頭コート（通常 A）の二巡目の末尾で斬る（設計書 2026-09-28）。
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
      ? '決戦（' + EventStatus.FINALIST_LABEL + '・' + finale[0].court + ' コートの最後）' : '';

    // 決戦 進行中は決戦のカードを先に、他コートは畳む（設計書「画面」）。
    if (st === 'round2_final' && finale.length > 0) {
      var finaleGrid = buildCourtGrid(finale, ctx, round, caption);
      finaleGrid.id = 'matchFinaleGrid';   // 暫定順位（renderFinaleTable）をこの直後に差し込む
      wrap.appendChild(finaleGrid);
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

    // 採点端末の招待（QR）。上の「採点画面を開く」「📺 配信用ボード」は自分の画面・見るだけの URL、
    // こちらは採点が書き込める鍵なので、段と色を分けて並べない（設計書 T10）。決戦のカードには出さない
    // （同じコートの通常のカードから発行する）。
    if (window.DeskInvites && row.finale !== true) {
      var inviteCap = document.createElement('div');
      inviteCap.className = 'desk-match-cap danger';
      inviteCap.textContent = '採点端末（書き込める鍵）';
      card.appendChild(inviteCap);
      var inviteRow = document.createElement('div');
      inviteRow.className = 'desk-match-actions';
      var btnInvite = document.createElement('button');
      btnInvite.type = 'button';
      btnInvite.className = 'desk-btn invite';
      btnInvite.textContent = '📱 この端末を招待（QR）';
      btnInvite.addEventListener('click', function() {
        DeskInvites.openInviteDialog(ctx, row.court);
      });
      inviteRow.appendChild(btnInvite);
      card.appendChild(inviteRow);
    }
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

  // 決戦 進行中のときだけ、決戦のカードの直後に暫定順位を出す。
  // 順位はサーバーが計算する（computeRanking の finale）。ポーリングはしない
  // （「↻ 最新に更新」で読み直す、というこの区画の方針を変えない）。
  async function renderFinaleTable(container, ctx) {
    var box = document.createElement('div');
    box.className = 'desk-match-finale-rank';
    box.id = 'matchFinaleRank';
    box.textContent = '読み込み中…';
    // 決戦のカードの直後に置く（「他のコート」「一巡目の結果」の畳みより上）。カードが無ければ末尾
    var anchor = container.querySelector('#matchFinaleGrid');
    if (anchor) anchor.insertAdjacentElement('afterend', box);
    else container.appendChild(box);
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

  // 形登録の区画（desk-round2.js）が工程表を使う。desk-invites.js の DeskInvites と同じ作り。
  window.DeskMatch = { buildSteps: buildSteps };
})();
