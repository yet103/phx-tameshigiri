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
    // 準備中・一巡目 進行中は二巡目の話をまだしない（生成もできない）。
    if (st !== 'draft' && st !== 'round1') {
      container.appendChild(buildRound2(st, ctx));
    }
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

  function buildRound2(st, ctx) {
    var wrap = document.createElement('div');
    var editable = (st === 'round1_done');
    var rows = roundTwo(ctx.players).slice().sort(Courts.compareOrder);

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '二巡目';
    head.appendChild(h2);
    wrap.appendChild(head);

    if (!editable) {
      var note = document.createElement('p');
      note.className = 'desk-note';
      note.textContent = '技を入れられるのは「一巡目終了」のときだけです（いまは「' +
        EventStatus.LABELS[st] + '」）。直すときは上部の「戻す」で一巡目終了まで戻してください。';
      wrap.appendChild(note);
    }

    var bar = document.createElement('div');
    bar.className = 'desk-match-bar';

    if (editable) {
      var btnGen = document.createElement('button');
      btnGen.type = 'button';
      btnGen.className = 'desk-btn primary';
      btnGen.id = 'btnMatchGenRound2';
      btnGen.textContent = '二巡目を生成';
      btnGen.addEventListener('click', function() { onGenerate(ctx); });
      bar.appendChild(btnGen);

      var btnAll = document.createElement('button');
      btnAll.type = 'button';
      btnAll.className = 'desk-btn';
      btnAll.id = 'btnMatchCopyAll';
      btnAll.addEventListener('click', function() { onCopyAll(ctx); });
      setCopyAllButton(btnAll, ctx);
      bar.appendChild(btnAll);
    }

    // 二巡目の行が0件のときは「二巡目 0名　技 未入力 0」を出さない
    // （このあとの空メッセージと二重になるため）。
    if (rows.length > 0) {
      var incomplete = rows.filter(Courts.isTechIncomplete).length;
      var count = document.createElement('span');
      count.className = 'desk-match-count' + (incomplete === 0 ? ' done' : '');
      count.id = 'matchRound2Count';
      count.textContent = '二巡目 ' + rows.length + '名　技 未入力 ' + incomplete;
      bar.appendChild(count);
    }
    if (bar.children.length > 0) wrap.appendChild(bar);

    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = editable
        ? '二巡目の選手はまだいません。「二巡目を生成」を押してください。'
        : '二巡目の選手はいません。';
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

    var table = document.createElement('table');
    table.className = 'desk-table desk-match-table';
    table.innerHTML =
      '<thead><tr><th>巡</th><th>No.</th><th>名前</th><th>一巡目</th>' +
      '<th>技1</th><th>技2</th><th>技3</th>' + (editable ? '<th></th>' : '') + '</tr></thead>';
    var tbody = document.createElement('tbody');
    rows.forEach(function(p) {
      tbody.appendChild(buildRow(p, ctx, editable, techniques));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
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

    var selects = [];
    [1, 2, 3].forEach(function(slot) {
      var td = document.createElement('td');
      var sel = buildTechSelect(p['tech' + slot] || '', techniques);
      sel.addEventListener('change', function() { onTechChange(p, selects, ctx, tr); });
      td.appendChild(sel);
      tr.appendChild(td);
      selects.push(sel);
    });

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
      btn.textContent = '一巡目と同じ技をコピー';
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
    markEmpty(sel);
    return sel;
  }

  function markEmpty(sel) {
    sel.className = sel.value ? '' : 'empty';
  }

  function valuesOf(selects) {
    return [selects[0].value, selects[1].value, selects[2].value];
  }

  function setValues(selects, arr) {
    selects.forEach(function(s, i) {
      s.value = arr[i] || '';
      markEmpty(s);
    });
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
      setValues(selects, [p.tech1 || '', p.tech2 || '', p.tech3 || '']);
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
      setValues(selects, [p.tech1 || '', p.tech2 || '', p.tech3 || '']);
      return false;
    }
    p.tech1 = arr[0];
    p.tech2 = arr[1];
    p.tech3 = arr[2];
    setValues(selects, arr);
    updateCount(ctx);
    return true;
  }

  // 「全員に一巡目と同じ技をコピー」ボタンの表示（件数と disabled）を作り直す。
  // 対象は描画時に固定すると、手で入れた技を後から一括コピーで上書きしてしまうので、
  // 呼ぶたびに Courts.techCopyTargets(ctx.players) を数え直す。
  function setCopyAllButton(btn, ctx) {
    var targets = Courts.techCopyTargets(ctx.players);
    btn.textContent = '全員に一巡目と同じ技をコピー（' + targets.length + ' 名）';
    btn.disabled = targets.length === 0;
    btn.title = targets.length === 0 ? '技が空で未採点の二巡目の行がありません' : '';
  }

  // 帯の「二巡目 N名　技 未入力 n」と「全員にコピー」ボタンの件数を数え直す
  // （表全体を描き直さずに済ませる）。
  function updateCount(ctx) {
    var el = document.getElementById('matchRound2Count');
    if (el) {
      var rows = roundTwo(ctx.players);
      var n = rows.filter(Courts.isTechIncomplete).length;
      el.textContent = '二巡目 ' + rows.length + '名　技 未入力 ' + n;
      el.className = 'desk-match-count' + (n === 0 ? ' done' : '');
    }
    var btnAll = document.getElementById('btnMatchCopyAll');
    if (btnAll) setCopyAllButton(btnAll, ctx);
  }

  function onTechChange(p, selects, ctx, tr) {
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
    if (ok) Desk.toast('一巡目の技をコピーしました');
  }

  // 「全員に一巡目と同じ技をコピー」。対象は Courts.techCopyTargets（技が3枠とも空で
  // 未採点、かつコピー元の一巡目の行に技がある二巡目の行）。確認の直前に数え直す
  // （ボタンの描画後に手で技を入れた行を、古い対象一覧で上書きしないため）。
  // 1件ずつ PATCH を送り、失敗したらそこで止める（locked や通信断は次の行でも
  // 同じように失敗するため、同じ alert を人数分出さない）。
  // 最後に大会を読み直して表と件数を作り直す。
  async function onCopyAll(ctx) {
    var targets = Courts.techCopyTargets(ctx.players);
    if (targets.length === 0) return;
    if (!confirm('技が空の ' + targets.length + ' 名に、一巡目と同じ技をコピーします。\n' +
        'よろしいですか？')) return;
    var btn = document.getElementById('btnMatchCopyAll');
    if (btn) btn.disabled = true;
    var done = 0;
    var failed = null;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var res = await Api.updatePlayerInfo(ctx.eventId, t.player.id, {
        tech1: t.source.tech1 || '', tech2: t.source.tech2 || '', tech3: t.source.tech3 || ''
      });
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
      if (!res || !res.ok) {
        failed = { player: t.player, res: res };
        break;
      }
      done++;
    }
    if (failed) {
      var why = (failed.res && failed.res.reason === 'locked')
        ? 'この大会は最終結果を確定済みです。編集するには「戻す」を押してください。'
        : '通信を確認してもう一度お試しください。';
      alert(done + ' 名にコピーしました。\n' +
        '「' + (failed.player.name || '(名称未設定)') + '」で失敗したので中断しました。\n' + why);
    } else {
      Desk.toast(done + ' 名に一巡目の技をコピーしました');
    }
    // reloadEvent が通信断で描き直せないことがあるので、分岐に置かず必ず戻す
    // （成功時は直後の reloadEvent がボタンごと作り直すので無害。onGenerate と同じ作法）。
    if (btn) btn.disabled = false;
    await Desk.reloadEvent();
  }

  // --- 二巡目の生成 ---
  // 番号規則はサーバーの生成 API が唯一の実装。クライアントは確認と再送だけを持つ。
  // 確認文言・結果文言は courts.js（スマホ運営の進行タブと共通）。
  async function onGenerate(ctx) {
    var src = (ctx.players || []).filter(function(p) { return Courts.roundOf(p) === 1; });
    var scored = src.filter(Courts.isScored).length;
    if (!confirm('一巡目 採点済み ' + scored + ' / ' + src.length + '。\n' +
        '全コート分の二巡目を作ります（採点画面にも反映されます）。\nよろしいですか？')) return;
    var btn = document.getElementById('btnMatchGenRound2');
    if (btn) btn.disabled = true;
    var result = await Api.generateNextRound(ctx.eventId, false);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    if (btn) btn.disabled = false;
    if (!result) {
      alert('二巡目を生成できませんでした。一巡目の選手が登録されているか、通信を確認してください。');
      return;
    }
    if (result.blocked) {
      if (result.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        return;
      }
      if (result.reason === 'status') {
        // 他の端末が先に状態を戻していた。サーバーの文言をそのまま出して読み直す。
        alert(result.error);
        await Desk.reloadEvent();
        return;
      }
      // nextRoundConflictMessage は unscored / exists の文言しか持たない
      if (!confirm(Courts.nextRoundConflictMessage(result, '「選手」の区画でコートを設定してください'))) return;
      if (btn) btn.disabled = true;
      result = await Api.generateNextRound(ctx.eventId, true);
      if (ctx.isStale()) return;
      if (btn) btn.disabled = false;
      if (!result || result.blocked) {
        alert('二巡目を生成できませんでした。一巡目の選手が登録されているか、通信を確認してください。');
        return;
      }
    }
    Desk.toast(Courts.nextRoundResultMessage(result));
    await Desk.reloadEvent();
  }

  Desk.registerTab('match', { render: render });
})();
