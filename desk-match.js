// 試合の区画（#match/<id>）。コート別の状況・採点画面を開く・二巡目の生成と技入力。
// スマホ運営の「進行」タブ（admin-round.js）と同じことを PC 幅でやる。
//
// ポーリングはしない。「採点済み n / N」といま採点中の選手は、大会を読んだ時点の値で、
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
  function courtCards(ctx, round) {
    var byCourt = Object.create(null);
    Courts.courtProgress(ctx.players, round).forEach(function(r) { byCourt[r.court] = r; });
    return Courts.listFrom(ctx.players, extraCourts(ctx)).map(function(c) {
      return Object.prototype.hasOwnProperty.call(byCourt, c)
        ? byCourt[c]
        : { court: c, total: 0, scored: 0 };
    });
  }

  // --- 描画 ---

  function render(container, ctx) {
    container.innerHTML = '';
    var st = EventStatus.of(ctx.event);

    container.appendChild(buildHead(ctx));
    container.appendChild(buildCourts(st, ctx));
    // 決戦 進行中のときだけ、決戦コートのカード（buildCourts）の直後に暫定順位を出す
    // （非同期。あとから差し込む。レビュー指摘E。以前は container の末尾に出ていて、
    // 二巡目の形登録の表を挟んで離れた場所に見えていた）。
    if (st === 'round2_final') renderFinaleTable(container, ctx);
    // 準備中・一巡目 進行中は二巡目の話をまだしない（形はサーバーが一巡目終了で作る）。
    if (st !== 'draft' && st !== 'round1') {
      container.appendChild(buildRound2(st, ctx));
    }
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
      '「採点済み」と「いま採点中」は自動では変わりません。' +
      '「↻ 最新に更新」を押すと読み直します。';
    wrap.appendChild(note);

    var rows = courtCards(ctx, round);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいません。「選手」の区画で登録してください。';
      wrap.appendChild(none);
      return wrap;
    }

    var finalCourt = Courts.finalCourtOf(ctx.event);
    var hasFinale = Courts.finalists(ctx.players).length > 0;
    var plain = rows.filter(function(r) { return !hasFinale || r.court !== finalCourt; });
    var finale = rows.filter(function(r) { return hasFinale && r.court === finalCourt; });

    // 決戦 進行中は決戦のカードを先に、他コートは畳む（設計書「画面」）。
    if (st === 'round2_final' && finale.length > 0) {
      wrap.appendChild(buildCourtGrid(finale, ctx, round, '決戦'));
      var others = document.createElement('details');
      others.className = 'desk-match-others';
      var sum = document.createElement('summary');
      sum.textContent = '他のコート（' + plain.length + '）';
      others.appendChild(sum);
      others.appendChild(buildCourtGrid(plain, ctx, round, ''));
      wrap.appendChild(others);
      return wrap;
    }

    wrap.appendChild(buildCourtGrid(plain, ctx, round, ''));
    if (finale.length > 0) {
      // 二巡目 進行中は「決戦（開始前）」として別枠に置く。
      wrap.appendChild(buildCourtGrid(finale, ctx, round, st === 'round2' ? '決戦（開始前）' : '決戦'));
    }
    return wrap;
  }

  // コート別カードのグリッドを1つ作る。caption が空でなければ見出しを先頭に置く。
  function buildCourtGrid(rows, ctx, round, caption) {
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
    rows.forEach(function(r) { grid.appendChild(buildCourtCard(r, ctx, round)); });
    wrap.appendChild(grid);
    return wrap;
  }

  function buildCourtCard(row, ctx, round) {
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

    // 真剣レンタルの人数（いま数えている巡目の行だけ）。0 なら行ごと出さない
    // （レンタルのいない大会でカードが縦に伸びないように）。
    var rental = (ctx.players || []).filter(function(p) {
      return Courts.courtOf(p) === row.court && Courts.roundOf(p) === round && p.rental === true;
    }).length;
    if (rental > 0) {
      var rent = document.createElement('div');
      rent.className = 'desk-match-rental';
      rent.textContent = '真剣レンタル ' + rental + ' 名';
      card.appendChild(rent);
    }

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

  // --- 二巡目（生成と技の入力） ---
  // 技を入れられるのは「一巡目終了」のときだけ。それ以外の状態では読み取り専用にする
  // （二巡目の採点が始まってから技を差し替えると、採点画面が古い ○× を新しい配点で
  //  読み直してしまう。直したいときは上部の「戻す」で一巡目終了に戻す）。

  function roundTwo(players) {
    return (players || []).filter(function(p) { return Courts.roundOf(p) === 2; });
  }

  // sourcePlayerId が指す一巡目の行。削除済み・CSV 由来の行では null
  function sourceOf(p, players) {
    if (!p || !p.sourcePlayerId) return null;
    return (players || []).filter(function(q) { return q && q.id === p.sourcePlayerId; })[0] || null;
  }

  // 二巡目の表を1つ作る（決戦とそれ以外で同じ作り）。
  // rows が0件（全員が決戦に入ったときの「決戦以外」など）なら、見出しだけの空表を
  // 出さず buildCourtGrid と同じ空メッセージにする（レビュー指摘F）。
  function buildRound2Table(rows, ctx, editable, techniques) {
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいません。「選手」の区画で登録してください。';
      return none;
    }
    var table = document.createElement('table');
    table.className = 'desk-table desk-match-table';
    table.innerHTML =
      '<thead><tr><th>巡</th><th>No.</th><th>名前</th><th>一巡目</th>' +
      '<th>技1</th><th>技2</th><th>技3</th>' + (editable ? '<th></th>' : '') + '</tr></thead>';
    var tbody = document.createElement('tbody');
    rows.forEach(function(p) { tbody.appendChild(buildRow(p, ctx, editable, techniques)); });
    table.appendChild(tbody);
    return table;
  }

  function buildRound2(st, ctx) {
    var wrap = document.createElement('div');
    var editable = (st === 'round1_done');
    var rows = roundTwo(ctx.players).slice().sort(Courts.compareOrder);

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    // 形を直す段階（round1_done）だけ「二巡目の形登録」。それ以外は「二巡目」。
    h2.textContent = editable ? '二巡目の形登録' : '二巡目';
    head.appendChild(h2);
    wrap.appendChild(head);

    if (editable) {
      var guide = document.createElement('p');
      guide.className = 'desk-note';
      guide.id = 'matchRound2Guide';
      guide.textContent = '一巡目の形を初期値にしています。自己申告があれば直してください。' +
        '試技順は一巡目の得点が低い順です。';
      wrap.appendChild(guide);
    } else {
      var note = document.createElement('p');
      note.className = 'desk-note';
      note.textContent = '形を直せるのは「' + EventStatus.LABELS.round1_done + '」のときだけです（いまは「' +
        EventStatus.LABELS[st] + '」）。直すときは上部の「戻す」で戻してください。';
      wrap.appendChild(note);
    }

    // 二巡目の行が0件のときは「二巡目 0名　技 未入力 0」を出さない
    // （このあとの空メッセージと二重になるため）。
    if (rows.length > 0) {
      var bar = document.createElement('div');
      bar.className = 'desk-match-bar';
      var incomplete = rows.filter(Courts.isTechIncomplete).length;
      var count = document.createElement('span');
      count.className = 'desk-match-count' + (incomplete === 0 ? ' done' : '');
      count.id = 'matchRound2Count';
      count.textContent = '二巡目 ' + rows.length + '名　技 未入力 ' + incomplete;
      bar.appendChild(count);
      wrap.appendChild(bar);
    }

    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = '二巡目の選手はいません。上部の「◀ 一巡目 進行中 に戻す」で一巡目に戻ると作り直せます。';
      wrap.appendChild(none);
      return wrap;
    }

    // 技リストはサーバーが GET の応答に必ず入れる（effectiveTechniques）。
    // 取れていないときはセレクトを作れないので、読み取り専用の表にする。
    var techniques = (Array.isArray(ctx.techniques) && ctx.techniques.length > 0) ? ctx.techniques : null;
    if (editable && !techniques) {
      var warn = document.createElement('p');
      warn.className = 'desk-warn';
      warn.textContent = '技術リストを取得できませんでした。大会を開き直してください。';
      wrap.appendChild(warn);
      editable = false;
    }

    // 「全員に一巡目と同じ技をコピー」。初期値は既に一巡目の複製なので、通常は出番が無い。
    // CSV 由来（sourcePlayerId が無い）の行や、生成後に一巡目へ選手を足した行など、
    // 技が複製されていない行が残っているときだけの逃げ道として、対象が1名以上のときだけ
    // ボタンを出す（レビュー指摘D）。
    if (editable) {
      var copyTargets = Courts.techCopyTargets(ctx.players);
      if (copyTargets.length > 0) {
        var copyBar = document.createElement('div');
        copyBar.className = 'desk-match-bar';
        var btnCopyAll = document.createElement('button');
        btnCopyAll.type = 'button';
        btnCopyAll.className = 'desk-btn';
        btnCopyAll.id = 'btnMatchCopyAll';
        btnCopyAll.textContent = '全員に一巡目と同じ技をコピー（' + copyTargets.length + ' 名）';
        btnCopyAll.addEventListener('click', function() { onCopyAll(ctx, btnCopyAll); });
        copyBar.appendChild(btnCopyAll);
        wrap.appendChild(copyBar);
      }
    }

    var finalRows = Courts.finalists(ctx.players);
    var plainRows = rows.filter(function(p) { return p.finalist !== true; });

    // 決戦以外（元のコートで先に斬る）
    wrap.appendChild(buildRound2Table(plainRows, ctx, editable, techniques));

    // 決戦の区画（暫定ベスト8）。0 名なら節ごと出さない。
    if (finalRows.length > 0) {
      var finHead = document.createElement('div');
      finHead.className = 'desk-section-head';
      var finH2 = document.createElement('h2');
      finH2.textContent = '決戦（暫定ベスト8）';
      finHead.appendChild(finH2);
      wrap.appendChild(finHead);

      var finNote = document.createElement('p');
      finNote.className = 'desk-note';
      finNote.id = 'matchFinaleNote';
      finNote.textContent = '暫定ベスト8（一般男子・一巡目の得点上位）。決戦コート「' +
        Courts.finalCourtOf(ctx.event) + '」で最後に斬ります。';
      wrap.appendChild(finNote);

      var finWrap = document.createElement('div');
      finWrap.className = 'desk-match-finale';
      finWrap.appendChild(buildRound2Table(finalRows, ctx, editable, techniques));
      wrap.appendChild(finWrap);
    }

    return wrap;
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

  function buildRow(p, ctx, editable, techniques) {
    var src = sourceOf(p, ctx.players);
    var tr = document.createElement('tr');
    tr.setAttribute('data-player-id', p.id);
    tr.appendChild(cell('2', 'num'));
    tr.appendChild(cell(String(Courts.orderKey(p).no || ''), 'num'));
    tr.appendChild(cell(p.name || '', 'desk-cell-main'));
    tr.appendChild(cell(src ? String(src.score || 0) : '—', 'num'));

    if (!editable) {
      tr.appendChild(cell(p.tech1 || ''));
      tr.appendChild(cell(p.tech2 || ''));
      tr.appendChild(cell(p.tech3 || ''));
      return tr;
    }

    // 技の候補は選手の性別とレンタルで絞る（Courts.techniqueOptions）。レンタルの選手は
    // 抜刀後の形だけ。コピー（一巡目と同じ技をコピー / 全員コピー）は名前をそのまま
    // 入れるだけで、ここでは絞らない（一巡目と同じ名前が正。ensureOption が候補に
    // 無い名前を「（リストにありません）」として足すので、値は落ちない）。
    var techOptions = Courts.techniqueOptions(techniques, !!p.isFemale, p.rental === true);
    var selects = [];
    [1, 2, 3].forEach(function(slot) {
      var td = document.createElement('td');
      var sel = buildTechSelect(p['tech' + slot] || '', techOptions);
      sel.addEventListener('change', function() { onTechChange(p, selects, ctx, tr); });
      td.appendChild(sel);
      tr.appendChild(td);
      selects.push(sel);
    });
    // 空欄の赤枠に加えて、同じ形の回数制限の赤枠も塗る（3枠揃った時点で判定するので、
    // ループの外でまとめて呼ぶ。設計書 2026-09-20-rules-alignment-design.md）。
    updateTechMarks(selects, techniques, !!p.isFemale);

    var tdCopy = document.createElement('td');
    tdCopy.className = 'copy';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'desk-btn';
    if (!src) {
      btn.disabled = true;
      // コピー元が無い行のボタンは通信の前後で有効に戻さない（setRowDisabled が見る印）
      btn.setAttribute('data-nosource', '1');
      btn.textContent = '一巡目の行がありません';
      btn.title = 'コピー元の一巡目の行が削除されています';
    } else {
      // 初期値が既に一巡目の複製なので「コピー」ではなく「戻す」（自己申告で直した後に
      // 元へ戻したいときのため）。
      btn.textContent = '一巡目と同じ形に戻す';
      btn.addEventListener('click', function() { onCopyRow(p, src, selects, ctx, tr); });
    }
    tdCopy.appendChild(btn);
    tr.appendChild(tdCopy);
    return tr;
  }

  // 技のセレクト。先頭は「（空）」。空のときは赤枠にして未入力を目立たせる。
  function buildTechSelect(value, techniques) {
    var sel = document.createElement('select');
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '（空）';
    sel.appendChild(blank);
    (techniques || []).forEach(function(t) {
      var o = document.createElement('option');
      o.value = t.name;
      o.textContent = t.name;
      sel.appendChild(o);
    });
    // その大会の技リストから消えた技名が入っている行でも、値を落とさずに見せる
    if (value && !(techniques || []).some(function(t) { return t.name === value; })) {
      var o2 = document.createElement('option');
      o2.value = value;
      o2.textContent = value + '（リストにありません）';
      sel.appendChild(o2);
    }
    sel.value = value || '';
    return sel;
  }

  // 空欄（従来の赤枠）と、同じ形の回数制限（設計書 2026-09-20-rules-alignment-design.md）の
  // 赤枠をまとめて塗り直す。duplicateForms は3枠揃った値で判定するので、必ず selects
  // 全部（3つ）で呼ぶこと。desk-cell-bad は desk-players.js の技セルと同じクラスを流用する。
  function updateTechMarks(selects, techniques, isFemale) {
    var dup = Courts.duplicateForms(valuesOf(selects), techniques, isFemale);
    selects.forEach(function(s) {
      var bad = false;
      if (s.value) {
        var resolved = Courts.resolveTechnique(techniques, s.value, isFemale);
        var display = resolved ? Courts.stripGenderSuffix(resolved.name) : '';
        bad = !!display && dup.indexOf(display) !== -1;
      }
      s.classList.toggle('empty', !s.value);
      s.classList.toggle('desk-cell-bad', bad);
      s.title = bad ? '同じ形は 1 回までです' : '';
    });
  }

  function valuesOf(selects) {
    return [selects[0].value, selects[1].value, selects[2].value];
  }

  // セレクトに value と同じ <option> が無ければ足す。技リストにありません（buildTechSelect の
  // 初期値と同じ作法）。一巡目と同じ技をコピー」で入る値は性別で絞った候補に無いことがある
  // （接尾辞付きの旧データなど）。setValues はコピーと保存失敗時の巻き戻しの両方で使うので、
  // ここで足しておかないと値は正しく保存されているのに表示だけ空に見えてしまう。
  // ここで足した option には dataset.adhoc を付けて、あとで removeStaleAdhocOptions が
  // 「今の値でなくなった、その場しのぎの選択肢」だけを取り除けるようにする
  // （例: 女子の行に (男) の技をコピー → 別の技に変え直しても、選択肢に (男) が残り続けない）。
  function ensureOption(sel, value) {
    if (!value) return;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === value) return;
    }
    var o = document.createElement('option');
    o.value = value;
    o.textContent = value + '（リストにありません）';
    o.dataset.adhoc = '1';
    sel.appendChild(o);
  }

  // ensureOption が足した option のうち、これから設定する値と違うものを取り除く。
  function removeStaleAdhocOptions(sel, keepValue) {
    for (var i = sel.options.length - 1; i >= 0; i--) {
      var o = sel.options[i];
      if (o.dataset.adhoc === '1' && o.value !== keepValue) {
        sel.removeChild(o);
      }
    }
  }

  function setValues(selects, arr, techniques, isFemale) {
    selects.forEach(function(s, i) {
      removeStaleAdhocOptions(s, arr[i] || '');
      ensureOption(s, arr[i]);
      s.value = arr[i] || '';
    });
    updateTechMarks(selects, techniques, isFemale);
  }

  function setRowDisabled(selects, tr, flag) {
    selects.forEach(function(s) { s.disabled = flag; });
    var btn = tr.querySelector('td.copy .desk-btn');
    if (btn && !btn.hasAttribute('data-nosource')) btn.disabled = flag;
  }

  // 技の保存。保存できたら true。失敗したら画面をサーバーに合わせて元に戻す。
  // 採点済みの選手の技を差し替えると得点が変わりうるかどうかの判定と確認文言は
  // courts.js の Courts.scoreMayChange / scoreChangeConfirmMessage（desk-players.js の
  // saveCell と共通）を使う。かつては admin-round.js の saveTech の判定をそのまま
  // 写していたが、計画4 でこの2関数が courts.js に入ったのでそちらに寄せた。
  async function saveTech(p, arr, selects, ctx, tr) {
    var patch = { tech1: arr[0], tech2: arr[1], tech3: arr[2] };
    if (Courts.scoreMayChange(p, patch) && !confirm(Courts.scoreChangeConfirmMessage(p))) {
      setValues(selects, [p.tech1 || '', p.tech2 || '', p.tech3 || ''], ctx.techniques, !!p.isFemale);
      return false;
    }
    setRowDisabled(selects, tr, true);
    var res = await Api.updatePlayerInfo(ctx.eventId, p.id, patch);
    if (ctx.isStale()) return !!(res && res.ok);   // 画面を離れていたら DOM に触れない（alert もしない）
    setRowDisabled(selects, tr, false);
    if (!res || !res.ok) {
      if (res && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      } else {
        alert('技を保存できませんでした。通信を確認してもう一度お試しください。');
      }
      setValues(selects, [p.tech1 || '', p.tech2 || '', p.tech3 || ''], ctx.techniques, !!p.isFemale);
      return false;
    }
    p.tech1 = arr[0];
    p.tech2 = arr[1];
    p.tech3 = arr[2];
    setValues(selects, arr, ctx.techniques, !!p.isFemale);
    updateCount(ctx);
    return true;
  }

  // 帯の「二巡目 N名　技 未入力 n」の件数を数え直す（表全体を描き直さずに済ませる）。
  function updateCount(ctx) {
    var el = document.getElementById('matchRound2Count');
    if (el) {
      var rows = roundTwo(ctx.players);
      var n = rows.filter(Courts.isTechIncomplete).length;
      el.textContent = '二巡目 ' + rows.length + '名　技 未入力 ' + n;
      el.className = 'desk-match-count' + (n === 0 ? ' done' : '');
    }
  }

  function onTechChange(p, selects, ctx, tr) {
    // 保存の通信を待たず、選んだ時点で赤枠を塗る（設計書「選んだ時点で赤枠と件数で示す」）。
    // 通信が失敗すれば saveTech の setValues が元の値へ塗り直す。
    updateTechMarks(selects, ctx.techniques, !!p.isFemale);
    saveTech(p, valuesOf(selects), selects, ctx, tr);
  }

  async function onCopyRow(p, src, selects, ctx, tr) {
    var arr = [src.tech1 || '', src.tech2 || '', src.tech3 || ''];
    // 既に一巡目と同じ値なら PATCH を送らない（saveTech の確認・保存を素通りさせない）。
    if ((p.tech1 || '') === arr[0] && (p.tech2 || '') === arr[1] && (p.tech3 || '') === arr[2]) {
      Desk.toast('既に一巡目と同じ技です');
      return;
    }
    var ok = await saveTech(p, arr, selects, ctx, tr);
    if (ctx.isStale()) return;
    if (ok) Desk.toast('一巡目と同じ形に戻しました');
  }

  // 「全員に一巡目と同じ技をコピー」（レビュー指摘D）。対象は Courts.techCopyTargets
  // （技が3枠とも空で未採点、一巡目の行が残っていて技が入っている行だけ）。
  // 行ごとの保存（saveTech）を順番に呼ぶ（同時に何件も PATCH を投げない）。
  async function onCopyAll(ctx, btn) {
    var targets = Courts.techCopyTargets(ctx.players);
    if (targets.length === 0) return;
    if (!confirm('技が空の ' + targets.length + ' 名に、一巡目と同じ技をコピーします。よろしいですか？')) return;
    btn.disabled = true;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var tr = document.querySelector('tr[data-player-id="' + t.player.id + '"]');
      var selects = tr ? Array.prototype.slice.call(tr.querySelectorAll('select')) : [];
      if (selects.length !== 3) continue;   // 描画が古い・行が見つからない
      var arr = [t.source.tech1 || '', t.source.tech2 || '', t.source.tech3 || ''];
      await saveTech(t.player, arr, selects, ctx, tr);
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    }
    btn.disabled = false;
    Desk.toast('技をコピーしました');
  }

  Desk.registerTab('match', { render: render });
})();
