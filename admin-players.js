// 選手タブ（#players/<大会ID>）。選手の一覧・追加・編集・削除。
(function() {
  var currentCourt = '';
  var courtOwner = null;   // currentCourt がどの大会のものか（大会が変われば全コートに戻す）
  var techCache = null;    // Api.loadTechniques() の techniques

  // 採点済みかどうか。サーバーの isScored と同じ判定を持つ。
  // result は 1=○, 0=×, 空白=未入力 でエンコードされている。
  function isScored(p) {
    if (!p) return false;
    if (typeof p.score === 'number' && p.score > 0) return true;
    return /[01]/.test(p.result || '');
  }

  // 行の並び順。order 文字列をそのまま比較すると 1-10 が 1-2 より前に来るので、
  // 巡目 → コート → 性別（男子が先）→ 番号 に分解して比べる。
  function orderKey(p) {
    var m = String((p && p.order) || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    if (!m) return { court: Courts.courtOf(p), sex: 2, round: 1, no: 0 };
    return {
      court: m[1],
      sex: m[2] === '男子' ? 0 : 1,
      round: parseInt(m[3], 10),
      no: parseInt(m[4], 10)
    };
  }

  function compareOrder(a, b) {
    var x = orderKey(a), y = orderKey(b);
    if (x.round !== y.round) return x.round - y.round;
    if (x.court !== y.court) return x.court < y.court ? -1 : 1;
    if (x.sex !== y.sex) return x.sex - y.sex;
    return x.no - y.no;
  }

  // 技術リストを必要なときだけ取りに行く（追加・編集フォームでチップを
  // タップしたとき）。キャッシュがあればそれを返す。
  async function ensureTechniques() {
    if (techCache) return techCache;
    var td = await Api.loadTechniques();
    if (td && td.techniques) techCache = td.techniques;
    return techCache;
  }

  async function render(container, ctx) {
    if (courtOwner !== ctx.eventId) {
      currentCourt = '';
      courtOwner = ctx.eventId;
    }
    // 絞り込み中のコートの選手が全員いなくなったら全コートに戻す
    if (currentCourt && Courts.listFrom(ctx.players).indexOf(currentCourt) === -1) currentCourt = '';

    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '選手 ' + ctx.players.length + '名';
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

    var chips = document.createElement('div');
    chips.className = 'court-chips';
    container.appendChild(chips);

    var list = document.createElement('div');
    list.className = 'list';
    container.appendChild(list);

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'fab';
    fab.textContent = '＋';
    fab.addEventListener('click', function() { openAddSheet(ctx); });
    container.appendChild(fab);

    // コートを切り替えたらチップと一覧を描き直す
    function onCourtChange(court) {
      currentCourt = court;
      Admin.renderCourtChips(chips, ctx.players, currentCourt, onCourtChange);
      renderList(list, ctx);
    }
    Admin.renderCourtChips(chips, ctx.players, currentCourt, onCourtChange);
    renderList(list, ctx);

    // 技術リストは追加・編集フォームで使う。フォームを開くまで待たず、
    // ここで先読みしておく（DOM の描画は待たない）。
    ensureTechniques();
  }

  function renderList(list, ctx) {
    list.innerHTML = '';
    var rows = Courts.filter(ctx.players, currentCourt).slice().sort(compareOrder);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'empty';
      none.textContent = ctx.players.length === 0
        ? '選手がまだいません。右下の「＋」で追加してください。'
        : 'このコートに選手がいません。';
      list.appendChild(none);
      return;
    }
    rows.forEach(function(p) {
      list.appendChild(buildRow(ctx, p));
    });
  }

  function buildRow(ctx, p) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';

    var badge = document.createElement('span');
    badge.className = 'row-badge';
    badge.textContent = String(Courts.roundOf(p));

    var body = document.createElement('span');
    body.className = 'row-body';
    var main = document.createElement('span');
    main.className = 'row-main';
    main.textContent = (p.order || '') + '  ' + (p.name || '');
    var sub = document.createElement('span');
    sub.className = 'row-sub';
    var techs = [p.tech1, p.tech2, p.tech3].filter(function(t) { return !!t; });
    sub.textContent = techs.length ? techs.join(' / ') : '技 未入力';
    body.appendChild(main);
    body.appendChild(sub);

    var score = document.createElement('span');
    score.className = 'row-score';
    score.textContent = String(p.score || 0);

    row.addEventListener('click', function() {
      openEditSheet(ctx, p);
    });

    row.appendChild(badge);
    row.appendChild(body);
    row.appendChild(score);
    return row;
  }

  // --- フォーム部品（追加・編集で共用） ---
  // 戻り値: { el, read, reset }
  //   el    : シートの body に入れる DOM
  //   read(): { name, court, isFemale, isNewFace, tech1, tech2, tech3 } | null
  //           （不正なら alert を出して null）
  //   reset(): 名前と技だけ空にする（コート・性別は保つ。受付を連続処理するため）
  function buildPlayerForm(ctx, player) {
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

    // 技
    var fTech = document.createElement('div');
    fTech.className = 'field';
    var lTech = document.createElement('label');
    lTech.textContent = '技（タップして一覧から順に選ぶ）';
    var chips = document.createElement('div');
    chips.className = 'chips';
    fTech.appendChild(lTech);
    fTech.appendChild(chips);
    el.appendChild(fTech);

    function renderTechChips() {
      TechPicker.renderChips(chips, techState, async function() {
        await ensureTechniques();
        if (!techCache) {
          alert('技術リストを取得できませんでした。技以外は保存できます。');
          return;
        }
        TechPicker.open({
          techniques: techCache,
          initial: techState,
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
      if (!court) { alert('コートを選んでください。「＋」で新しいコートを作れます。'); return null; }
      var t = TechPicker.toArray(techState);
      return {
        name: name,
        court: court,
        isFemale: isFemale,
        isNewFace: chkNew.checked,
        tech1: t[0],
        tech2: t[1],
        tech3: t[2]
      };
    }

    function reset() {
      inName.value = '';
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

      // 採点済みの選手の性別を変えても、サーバーは得点を再計算しない。
      // 男女で配点が違う技があるため、採点画面で開き直してもらう必要がある。
      if (isScored(player) && data.isFemale !== !!player.isFemale) {
        var ok = confirm(
          'この選手は採点済みです（' + (player.score || 0) + '点）。\n' +
          '得点が変わる可能性があります。採点画面でこの選手を開き直してください。\n\n' +
          'このまま保存しますか？'
        );
        if (!ok) return;
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
        alert('選手の更新に失敗しました。\n入力内容と通信を確認してください。');
        return;
      }
      sheet.close();
      Admin.toast('保存しました');
      Admin.reloadEvent();
    });

    btnDelete.addEventListener('click', async function() {
      if (!confirm(
        '選手「' + (player.name || '') + '」（' + (player.order || '') + '）を削除します。\n' +
        '二巡目の行は残ります。\n' +
        'よろしいですか？'
      )) return;

      btnDelete.disabled = true;
      btnSave.disabled = true;
      sheet.lock(true);
      var res = await Api.deletePlayer(ctx.eventId, player.id, false);

      if (res && res.blocked) {
        // 採点済みガード。得点を出してもう一度確認し、承諾したときだけ force。
        // player はサーバー側の実装次第で null になり得るので、その場合は空扱いにする。
        var blockedPlayer = res.player || {};
        var ok = confirm(
          '「' + blockedPlayer.name + '」（' + blockedPlayer.order + '）は採点済みです（' +
          blockedPlayer.score + '点）。\n' +
          '削除すると採点結果は戻せません。二巡目の行は残ります。\n\n' +
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
      pickCsv(ctx);
    });
  }

  // admin.html には file input を置かない（DOM は計画3との契約）。その場で作って捨てる。
  function pickCsv(ctx) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) {
        var reader = new FileReader();
        reader.onload = function(ev) { importCsvText(ctx, ev.target.result); };
        reader.readAsText(file, 'UTF-8');
      }
      if (input.parentNode) input.parentNode.removeChild(input);
    });
    input.click();
  }

  async function importCsvText(ctx, text) {
    var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
    var mode = 'replace';
    if (ctx.players.length > 0) {
      mode = confirm('既存データをクリアして読み込みますか？\n（キャンセルで追記）') ? 'replace' : 'append';
    }
    var result = await Api.importCsv(eventId, text, mode);
    if (result && result.blocked) {
      var ok = confirm(
        'この大会には採点済みの選手が少なくとも ' + result.scoredCount + ' 名います。\n' +
        '他のコート端末による採点も含まれます。\n' +
        '読み込みを続けると、これらの採点結果はすべて失われます。\n' +
        '本当に続行しますか？'
      );
      if (!ok) return;
      result = await Api.importCsv(eventId, text, mode, true);
    }
    if (!result || !result.success) {
      alert('インポートに失敗しました。');
      return;
    }
    if (Admin.currentEventId() !== eventId) return;   // 読み込み中に別の大会へ移った
    Admin.toast(result.playerCount + '名を読み込みました');
    Admin.reloadEvent();
  }

  Admin.registerTab('players', { render: render });
})();
