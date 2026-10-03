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
    var steps = buildSteps(st, ctx);
    container.appendChild(steps);
    // 二巡目 進行中: 決戦に出る人（ベスト4）を工程表の下に 1 行で（2026-10-04）
    if (st === 'round2') container.appendChild(buildFinaleLine(ctx.players));
    // 最終結果: 工程表の下に「表彰」の区画（上位 3 名・発表モード・共有リンク・成績表）
    var award = (st === 'final') ? buildAwardSection(ctx) : null;
    if (award) container.appendChild(award);
    var diffBox = buildFinalistDiff(st, ctx.players);
    if (diffBox) container.appendChild(diffBox);
    container.appendChild(buildCourts(st, ctx));
    // 決戦 進行中のときだけ、決戦のカード（buildCourts）の直後に暫定順位を出す
    // （非同期。あとから差し込む。レビュー指摘E）。二巡目の形登録の表は desk-round2.js に移した。
    if (st === 'round2_final') renderFinaleTable(container, ctx);
    // 二巡目終了: 順位の要約を工程表の中、遷移ボタン（結果を確定して表彰へ）の上に差し込む。
    // 最終結果: 表彰の区画の中に（どちらも非同期。Api.loadRanking は結果確認と同じ）
    if (st === 'round2_done') {
      var slot = buildRankSlot();
      steps.insertBefore(slot, steps.querySelector('.desk-steps-actions'));
      renderRankSummary(slot, ctx);
    } else if (award) {
      renderRankSummary(award.querySelector('.desk-rank-slot'), ctx);
    }
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

  // --- 工程表（ユーザー要望 2026-09-30。5 段にしたのは 2026-10-04） ---
  // 試合進行の先頭に「① 一巡目 → ② 二巡目の形登録 → ③ 二巡目 → ④ 決戦（ベスト4） → ⑤ 結果・表彰」の
  // 5 段を置き、現在の段を金で塗って、その段階でやることを 1 行で示す。下に、その段階に関係する遷移ボタン
  // （進める・戻す。二巡目準備なら「二巡目を行わず最終結果へ」も）を置く。段階の遷移ボタンは
  // 工程表の中だけ（上部の状態バーは表示だけ）。押したときの確認と通信は Desk.applyStatus（desk.js）。
  // 工程表は試合進行と、二巡目の形登録の区画（desk-round2.js）の先頭に出す（2026-10-03。
  // DeskMatch.buildSteps(st, ctx, { where: 'round2' })）。区画は同時に 1 つしか描かないので、
  // 遷移ボタンの id（btnDeskNext など）は重ならない。
  // 上部の状態バー（desk.js の STAGE_GROUPS）は幅が限られるので 5 段のまま変えない。工程表の ③ 二巡目・
  // ④ 決戦・⑤ のうち二巡目終了は、状態バーの「二巡目」の段（補足文 進行中／決戦 進行中／二巡目終了）に、
  // ⑤ の最終結果・アーカイブは状態バーの「最終結果」に当たる。準備中はどの段も光らない（①の手前）。
  var MATCH_STEPS = [
    { label: '① 一巡目',                                     states: ['round1'] },
    { label: '② 二巡目の形登録',                             states: ['round1_done'] },
    { label: '③ 二巡目',                                     states: ['round2'] },
    { label: '④ 決戦（ベスト' + EventStatus.FINALIST_COUNT + '）', states: ['round2_final'] },
    { label: '⑤ 結果・表彰',                                 states: ['round2_done', 'final', 'archived'] }
  ];

  // 工程表の現在の段の添字。準備中と知らない状態は -1（まだ①の前）。
  function matchStepIndex(st) {
    for (var i = 0; i < MATCH_STEPS.length; i++) {
      if (MATCH_STEPS[i].states.indexOf(st) !== -1) return i;
    }
    return -1;
  }

  // その段階でやること（1 行）。ボタンの文言は EventStatus.nextLabel と同じものを引き、ボタンと同じく ▶ を添える。
  // where は工程表を置く区画（'match' 試合進行 | 'round2' 二巡目の形登録）。違うのは形登録の段の 1 行だけ。
  function stepTodo(st, players, where) {
    var nx = EventStatus.nextLabel(st, players);
    var q = '「' + nx + ' ▶」';
    switch (st) {
      case 'draft':
        return '準備中です。選手と技（二巡目で形を変える選手は「二巡目の形」も）をそろえたら' + q +
          'を押します（採点画面が別のウィンドウで開きます）。';
      case 'round1':
        return '各コートで一巡目を採点しています。全コートの確定がそろったら' + q + 'を押します。';
      case 'round1_done':
        return where === 'round2'
          ? '申請された二巡目の形（申請の無い人は一巡目の形）が入っています。当日の変更があれば下の表で直し、' +
            '確かめ終えたら' + q + 'を押します。試技順は一巡目の得点が低い順です。'
          : '二巡目の行ができました。形登録で形を確かめてから' + q + 'を押します。';
      case 'round2':
        return EventStatus.hasFinalists(players)
          ? '各コートで二巡目を採点しています。決戦以外が斬り終わったら' + q + 'を押します。'
          : '各コートで二巡目を採点しています。全コートの確定がそろったら' + q + 'を押します。';
      case 'round2_final':
        return '決戦 進行中です（' + Courts.finaleCourt(players) + ' コートの最後）。斬り終わったら' + q + 'を押します。';
      case 'round2_done':
        return '二巡目が終わりました。下の順位を確かめて' + q + 'を押します。';
      case 'final':
        return '最終結果です。表彰は下の順位と発表モードで。得点・選手・技は編集できません。';
      case 'archived':
        return 'アーカイブ済みです。';
      default:
        return '';
    }
  }

  // 二巡目 進行中に工程表の下に出す 1 行（純粋関数。test.html で固定する）。決戦に出る人（二巡目の行で
  // finalist の印）の名前を試技順（Courts.finalists。order の番号の低い順）で並べる。
  // 0 名なら候補がいない理由を書く（選考は一般男子の一巡目の確定得点が 0 点より上の人。EventStatus.pickFinalists）。
  function finaleLineText(players) {
    var fin = Courts.finalists(players || []);
    if (fin.length === 0) {
      return '決戦の候補はいません（一般男子に一巡目の確定得点が 1 点以上の人がいない）';
    }
    return '決戦（ベスト' + EventStatus.FINALIST_COUNT + '・' + Courts.finaleCourt(players) + ' コートの最後）: ' +
      fin.map(function(p) { return String(p.name || '').trim() || '(名称未設定)'; }).join('・');
  }

  function buildFinaleLine(players) {
    var p = document.createElement('p');
    p.className = 'desk-match-finale-line';
    p.id = 'matchFinaleLine';
    p.textContent = finaleLineText(players);
    return p;
  }

  // --- 順位の要約（二巡目終了・最終結果。2026-10-04） ---
  // 3 部門（一般男子・新人枠・一般女子。結果確認と同じ語）の上位 3 名。同点は同順位なので
  // rank <= 3 の全員（4 名以上になりうる）。rows は Api.loadRanking の rankings の 1 部門。
  var SUMMARY_TOP = 3;
  function topRanked(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function(r) {
      return r && typeof r.rank === 'number' && r.rank <= SUMMARY_TOP;
    });
  }

  // 部門の並びと見出しは結果確認（DeskResults.CATEGORIES）と同じ。読めなければ同じ内容を使う
  var SUMMARY_CATEGORIES = [
    { key: 'male',    title: '一般男子' },
    { key: 'newFace', title: '新人枠' },
    { key: 'female',  title: '一般女子' }
  ];
  function summaryCategories() {
    return (window.DeskResults && Array.isArray(DeskResults.CATEGORIES)) ? DeskResults.CATEGORIES : SUMMARY_CATEGORIES;
  }

  function buildRankSlot() {
    var slot = document.createElement('div');
    slot.className = 'desk-rank-slot';
    slot.id = 'matchRankSummary';
    var loading = document.createElement('p');
    loading.className = 'desk-rank-msg';
    loading.textContent = '順位を読み込み中…';
    slot.appendChild(loading);
    return slot;
  }

  // 要約を slot に描く（非同期）。読めなければ「順位を読み込めませんでした。↻ 最新に更新」
  async function renderRankSummary(slot, ctx) {
    if (!slot) return;
    var data = await Api.loadRanking(ctx.eventId);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    slot.innerHTML = '';
    if (!data || !data.rankings) {
      var err = document.createElement('p');
      err.className = 'desk-rank-msg';
      err.id = 'matchRankError';
      err.appendChild(document.createTextNode('順位を読み込めませんでした。'));
      var re = document.createElement('button');
      re.type = 'button';
      re.className = 'desk-btn-sub';
      re.textContent = '↻ 最新に更新';
      re.addEventListener('click', function() { Desk.reloadEvent(); });
      err.appendChild(re);
      err.appendChild(jumpButton('btnMatchGoResults', '結果確認へ →', 'results', ctx));
      slot.appendChild(err);
      return;
    }
    var cols = document.createElement('div');
    cols.className = 'desk-rank-summary';
    summaryCategories().forEach(function(c) {
      cols.appendChild(buildRankColumn(c.title, topRanked(data.rankings[c.key])));
    });
    slot.appendChild(cols);
    var more = document.createElement('div');
    more.className = 'desk-rank-more';
    more.appendChild(jumpButton('btnMatchGoResults', '結果確認で全順位 →', 'results', ctx));
    slot.appendChild(more);
  }

  function buildRankColumn(title, rows) {
    var col = document.createElement('section');
    col.className = 'desk-rank-col';
    var h = document.createElement('h4');
    h.textContent = title;
    col.appendChild(h);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-rank-none';
      none.textContent = 'データなし';
      col.appendChild(none);
      return col;
    }
    var table = document.createElement('table');
    table.className = 'desk-rank-table';
    var tbody = document.createElement('tbody');
    rows.forEach(function(r) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(String(r.rank) + '位', 'rank'));
      tr.appendChild(cell(r.name || '', 'name'));
      tr.appendChild(cell(String(r.score), 'score'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    col.appendChild(table);
    return col;
  }

  // 最終結果の「表彰」の区画。上位 3 名の要約（renderRankSummary が .desk-rank-slot に描く）と、
  // 結果確認と同じ 3 つのボタン（処理は desk-results.js の DeskResults。自動で結果確認へは移さない）。
  function buildAwardSection(ctx) {
    var sec = document.createElement('section');
    sec.className = 'desk-award';
    sec.id = 'matchAward';
    var h3 = document.createElement('h3');
    h3.className = 'desk-match-caption';
    h3.textContent = '表彰';
    sec.appendChild(h3);
    sec.appendChild(buildRankSlot());
    var bar = document.createElement('div');
    bar.className = 'desk-award-actions';
    [
      ['btnMatchPresent', '🖵 発表モードで開く', 'desk-btn primary', 'present'],
      ['btnMatchShare', '🔗 共有リンクをコピー', 'desk-btn', 'copyShare'],
      ['btnMatchHtml', '📄 成績表（HTML）を保存', 'desk-btn', 'downloadHtml']
    ].forEach(function(d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.id = d[0];
      b.className = d[2];
      b.textContent = d[1];
      // 発表モードは空のタブをクリックの処理の中で同期に開く（DeskResults.present の作法）ので、間に await を挟まない
      b.addEventListener('click', function() {
        if (window.DeskResults && typeof DeskResults[d[3]] === 'function') DeskResults[d[3]](b, ctx);
      });
      bar.appendChild(b);
    });
    sec.appendChild(bar);
    return sec;
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
    } else if (st === 'archived') {
      // 二巡目終了・最終結果では、順位の要約の「結果確認で全順位 →」が同じ近道になる（renderRankSummary）
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
    var roundLabel = (round === 1 ? '一巡目' : '二巡目');
    // 二巡目終了・最終結果・アーカイブでは、コートのカードは「二巡目の明細」として畳む（既定は閉じる。
    // 2026-10-04。主役は順位の要約・表彰）。二巡目を行わずに最終結果にした大会は「一巡目の明細」
    var folded = (st === 'round2_done' || st === 'final' || st === 'archived');

    if (!folded) {
      var note = document.createElement('p');
      note.className = 'desk-note';
      note.id = 'matchCourtsNote';
      note.textContent = roundLabel + 'の進み具合です。' +
        '「確定」の件数と「いま採点中」は自動では変わりません。' +
        '「↻ 最新に更新」を押すと読み直します。';
      wrap.appendChild(note);
    }

    // 男子の部・女子の部でカードの組を分ける（0 名の部は出さない）。見出しは「男子の部 一巡目」のように巡目を添える。
    var groups = [];
    [[false, '男子の部'], [true, '女子の部']].forEach(function(g) {
      var cards = courtCards(ctx, round, g[0]);
      if (cards.some(function(r) { return r.total > 0; })) {
        groups.push({ caption: g[1] + ' ' + roundLabel, rows: cards, female: g[0] });
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

    var target = wrap;
    if (folded) {
      target = document.createElement('details');
      target.className = 'desk-match-others';
      target.id = 'matchRoundDetails';
      var dsum = document.createElement('summary');
      dsum.textContent = roundLabel + 'の明細';
      target.appendChild(dsum);
      wrap.appendChild(target);
    }
    // 二巡目 進行中は「開始前」として置く（先頭コートの通常の選手が終わってから斬る）
    appendGroupsWithFinale(target, groups, finale, ctx, round,
      st === 'round2' ? caption + '　開始前' : caption);
    appendRound1Results(wrap, ctx, round);
    return wrap;
  }

  // 部ごとのカードを並べ、決戦のカードは先頭コート（EventStatus.firstCourt）の男子のカードの直後に
  // 金の枠で囲んで差し込む（2026-10-04。以前はページの末尾。決戦は先頭コートの二巡目の最後に斬るので、
  // そのコートのカードの隣に見せる）。先頭コートの男子のカードが無ければ末尾に置く。
  function appendGroupsWithFinale(target, groups, finale, ctx, round, finaleCaption) {
    var first = EventStatus.firstCourt(ctx.players, extraCourts(ctx));
    var placed = finale.length === 0;
    function finaleBlock() {
      var box = document.createElement('div');
      box.className = 'desk-match-finale';
      box.id = 'matchFinaleBlock';
      box.appendChild(buildCourtGrid(finale, ctx, round, finaleCaption));
      return box;
    }
    groups.forEach(function(g) {
      var idx = -1;
      if (!placed && g.female === false) {
        g.rows.forEach(function(r, i) { if (idx === -1 && r.court === first) idx = i; });
      }
      if (idx === -1) {
        target.appendChild(buildCourtGrid(g.rows, ctx, round, g.caption));
        return;
      }
      var head = buildCourtGrid(g.rows.slice(0, idx + 1), ctx, round, g.caption);
      var grid = head.querySelector('.desk-match-courts');
      if (grid) grid.classList.add('split');
      target.appendChild(head);
      target.appendChild(finaleBlock());
      var rest = g.rows.slice(idx + 1);
      if (rest.length > 0) target.appendChild(buildCourtGrid(rest, ctx, round, ''));
      placed = true;
    });
    if (!placed) target.appendChild(finaleBlock());
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
  // MATCH_STEPS・matchStepIndex・stepTodo・finaleLineText・topRanked は test.html で固定する純粋関数。
  window.DeskMatch = {
    buildSteps: buildSteps,
    MATCH_STEPS: MATCH_STEPS,
    matchStepIndex: matchStepIndex,
    stepTodo: stepTodo,
    finaleLineText: finaleLineText,
    topRanked: topRanked
  };
})();
