// 二巡目の形登録の区画（#round2/<id>）。状態が「二巡目準備（形の登録）」（round1_done）のときだけ
// 左メニューに出す（desk.js の NAV の when）。以前は試合進行（desk-match.js）の下に出していた
// 二巡目の表（一巡目の得点・一巡目と同じ形に戻す・決戦の枠・技のセレクト）をそのまま移した
// （ユーザー要望 2026-09-30「試合進行は進み具合を見る画面に限定し、形登録は独立した区画にする」）。
// 段階の遷移ボタン（二巡目を開始 など）は試合進行の工程表の下にだけ置く。
(function() {

  // 技を入れられるのは「二巡目準備（形の登録）」のときだけ。それ以外の状態では表を出さない
  // （二巡目の採点が始まってから技を差し替えると、採点画面が古い ○× を新しい配点で
  //  読み直してしまう。直したいときは試合進行の「戻す」で二巡目準備に戻す）。

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
  // 出さず試合進行のカード（desk-match.js の buildCourtGrid）と同じ空メッセージにする（レビュー指摘F）。
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

  function render(container, ctx) {
    container.innerHTML = '';
    var st = EventStatus.of(ctx.event);

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '二巡目の形登録';
    head.appendChild(h2);
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.appendChild(spacer);
    var btnReload = document.createElement('button');
    btnReload.type = 'button';
    btnReload.className = 'desk-btn';
    btnReload.id = 'btnRound2Reload';
    btnReload.textContent = '↻ 最新に更新';
    btnReload.addEventListener('click', function() { Desk.reloadEvent(); });
    head.appendChild(btnReload);
    container.appendChild(head);

    // 形登録の段階でないとき（ブックマーク・戻るボタン・他の端末が先に進めた等でこの区画を開いた）は
    // 表を出さず、試合進行へ案内する。
    if (st !== 'round1_done') {
      var off = document.createElement('p');
      off.className = 'desk-note';
      off.id = 'round2OffNote';
      off.appendChild(document.createTextNode('形を直せるのは「' + EventStatus.LABELS.round1_done +
        '」のときだけです（いまは「' + EventStatus.LABELS[st] + '」）。直すときは試合進行の「戻す」で戻してください。'));
      off.appendChild(goMatchButton(ctx));
      container.appendChild(off);
      return;
    }

    var guide = document.createElement('p');
    guide.className = 'desk-note';
    guide.id = 'round2Guide';
    guide.appendChild(document.createTextNode('一巡目の形を初期値にしています。自己申告があれば直してください。' +
      '試技順は一巡目の得点が低い順です。直し終えたら、試合進行の「' +
      EventStatus.NEXT_LABELS.round1_done + ' ▶」で二巡目に入ります。'));
    guide.appendChild(goMatchButton(ctx));
    container.appendChild(guide);

    // 一巡目の行が終了後に確定・得点変更されたときの選考の差（網羅検証 S18。試合進行と同じ警告）
    var diffMsg = Courts.finalistDiffMessage(EventStatus.finalistDiff(ctx.players || []));
    if (diffMsg) {
      var diffBox = document.createElement('p');
      diffBox.className = 'desk-warn';
      diffBox.id = 'round2FinalistDiff';
      diffBox.style.whiteSpace = 'pre-line';
      diffBox.textContent = diffMsg;
      container.appendChild(diffBox);
    }

    container.appendChild(buildRound2(ctx));
  }

  function goMatchButton(ctx) {
    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'desk-btn-sub';
    go.id = 'btnRound2GoMatch';
    go.textContent = '試合進行へ →';
    go.addEventListener('click', function() { Desk.navigate('match', ctx.eventId); });
    return go;
  }

  // 二巡目の表（決戦以外・決戦）。この区画は round1_done のときだけ描くので常に編集できる
  // （技得点表が取れていないときだけ読み取り専用に落とす）。
  function buildRound2(ctx) {
    var wrap = document.createElement('div');
    var editable = true;
    var rows = roundTwo(ctx.players).slice().sort(Courts.compareOrder);

    // 二巡目の行が0件のときは「二巡目 0名　技 未入力 0」を出さない
    // （このあとの空メッセージと二重になるため）。
    if (rows.length > 0) {
      var bar = document.createElement('div');
      bar.className = 'desk-match-bar';
      var incomplete = rows.filter(Courts.isTechIncomplete).length;
      var count = document.createElement('span');
      count.className = 'desk-match-count' + (incomplete === 0 ? ' done' : '');
      count.id = 'round2Count';
      count.textContent = '二巡目 ' + rows.length + '名　技 未入力 ' + incomplete;
      bar.appendChild(count);
      wrap.appendChild(bar);
    }

    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = '二巡目の選手はいません。試合進行の「◀ ' + EventStatus.LABELS.round1 + ' に戻す」で一巡目に戻ると作り直せます。';
      wrap.appendChild(none);
      return wrap;
    }

    // 技リストはサーバーが GET の応答に必ず入れる（effectiveTechniques）。
    // 取れていないときはセレクトを作れないので、読み取り専用の表にする。
    var techniques = (Array.isArray(ctx.techniques) && ctx.techniques.length > 0) ? ctx.techniques : null;
    if (editable && !techniques) {
      var warn = document.createElement('p');
      warn.className = 'desk-warn';
      warn.textContent = '技得点表を取得できませんでした。大会を開き直してください。';
      wrap.appendChild(warn);
      editable = false;
    }

    // 「全員に一巡目と同じ技をコピー」。初期値は既に一巡目の複製なので、通常は出番が無い。
    // 旧バージョンが生成した行（sourcePlayerId あり・技が空）や、生成後に一巡目へ選手を足した行など、
    // 技が複製されていない行が残っているときだけの逃げ道として、対象が1名以上のときだけ
    // ボタンを出す（レビュー指摘D）。sourcePlayerId の無い行（CSV 由来）は対象外。
    if (editable) {
      var copyTargets = Courts.techCopyTargets(ctx.players);
      if (copyTargets.length > 0) {
        var copyBar = document.createElement('div');
        copyBar.className = 'desk-match-bar';
        var btnCopyAll = document.createElement('button');
        btnCopyAll.type = 'button';
        btnCopyAll.className = 'desk-btn';
        btnCopyAll.id = 'btnRound2CopyAll';
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
      finNote.id = 'round2FinaleNote';
      finNote.textContent = '暫定ベスト8（一般男子・一巡目の得点上位）。' +
        Courts.finaleCourt(ctx.players) + ' コートの二巡目の最後に斬ります。';
      wrap.appendChild(finNote);

      var finWrap = document.createElement('div');
      finWrap.className = 'desk-match-finale';
      finWrap.appendChild(buildRound2Table(finalRows, ctx, editable, techniques));
      wrap.appendChild(finWrap);
    }

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
    // 一巡目の得点は確定済みだけ出す（採点途中の値は順位にも入らない。網羅検証 S10）
    var r1Cell = cell((src && src.confirmed === true) ? String(src.score || 0) : '—', 'num');
    if (src && src.confirmed !== true) r1Cell.title = '一巡目が未確定です';
    tr.appendChild(r1Cell);

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
    function restore() {
      setValues(selects, [p.tech1 || '', p.tech2 || '', p.tech3 || ''], ctx.techniques, !!p.isFemale);
    }
    // 確認を承諾したら force: true を付けて送る（サーバーは採点済みの行の技の変更を force なしで
    // 409 scored にする。網羅検証 S7）。
    var forced = false;
    if (Courts.scoreMayChange(p, patch)) {
      if (!confirm(Courts.scoreChangeConfirmMessage(p))) { restore(); return false; }
      forced = true;
    }
    setRowDisabled(selects, tr, true);
    var res = await Api.updatePlayerInfo(ctx.eventId, p.id, forced ? Object.assign({ force: true }, patch) : patch);
    if (ctx.isStale()) return !!(res && res.ok);   // 画面を離れていたら DOM に触れない（alert もしない）
    if (res && !res.ok && res.reason === 'scored' && !forced) {
      // 画面の控えが古く、その間に採点されていた。同じ確認を出し、承諾されたら force で送り直す
      if (!confirm(Courts.scoreChangeConfirmMessage(res.player || p))) {
        setRowDisabled(selects, tr, false);
        restore();
        return false;
      }
      res = await Api.updatePlayerInfo(ctx.eventId, p.id, Object.assign({ force: true }, patch));
      if (ctx.isStale()) return !!(res && res.ok);
    }
    setRowDisabled(selects, tr, false);
    if (!res || !res.ok) {
      if (res && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      } else {
        alert('技を保存できませんでした。通信を確認してもう一度お試しください。');
      }
      restore();
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
    var el = document.getElementById('round2Count');
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
    Desk.toast('技をコピーしました');
    await Desk.reloadEvent();   // 対象が 0 になったのでボタンを消す（件数を持つボタンを作り直す）
  }

  Desk.registerTab('round2', { render: render });
})();
