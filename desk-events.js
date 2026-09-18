// 大会一覧の区画（#events）。表（名前・日付・会場・人数・状態・更新）と行の「⋯」。
// archived は下の「▸ アーカイブ（n 件）」に畳む（当日の運営で押し間違えないよう、
// 進行中・準備中の大会と混ぜない）。
(function() {
  var outsideClickBound = false;   // 「⋯」の外側クリック検知は document に1回だけ付ける

  async function render(container, ctx) {
    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '大会';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.appendChild(h2);
    head.appendChild(spacer);

    var btnImport = document.createElement('button');
    btnImport.type = 'button';
    btnImport.className = 'desk-btn';
    btnImport.textContent = '📂 取り込む';
    btnImport.addEventListener('click', function() {
      // 選択〜取り込み完了まで二重送信を防ぐ
      btnImport.disabled = true;
      Storage.pickJsonFile(importBundleText, function() { btnImport.disabled = false; });
    });
    head.appendChild(btnImport);

    var btnNew = document.createElement('button');
    btnNew.type = 'button';
    btnNew.className = 'desk-btn primary';
    btnNew.textContent = '＋ 新規作成';
    btnNew.addEventListener('click', openNewDialog);
    head.appendChild(btnNew);

    container.appendChild(head);

    var body = document.createElement('div');
    container.appendChild(body);

    var loading = document.createElement('p');
    loading.className = 'desk-empty';
    loading.textContent = '読み込み中…';
    body.appendChild(loading);

    var events = await Api.listEvents();
    if (ctx.isStale()) return;   // 待っている間に区画を切り替えられた
    body.innerHTML = '';
    if (!Array.isArray(events)) {
      // 取得できなかっただけで、大会が消えたわけではない。「0件」と誤解させない。
      var err = document.createElement('p');
      err.className = 'desk-empty';
      err.textContent = '大会一覧を取得できませんでした。通信を確認してください。';
      body.appendChild(err);
      alert('大会一覧を取得できませんでした。通信を確認してください。');
      return;
    }
    if (events.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = '大会がまだありません。';
      body.appendChild(none);
      return;
    }

    // 直近に触った大会を上に出す
    events.sort(function(a, b) {
      var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
      if (x === y) return 0;
      return x < y ? 1 : -1;
    });

    var active = events.filter(function(ev) { return EventStatus.of(ev) !== 'archived'; });
    var archived = events.filter(function(ev) { return EventStatus.of(ev) === 'archived'; });

    if (active.length === 0) {
      var noneActive = document.createElement('p');
      noneActive.className = 'desk-empty';
      noneActive.textContent = '進行中・準備中の大会はありません。';
      body.appendChild(noneActive);
    } else {
      body.appendChild(buildTable(active));
    }

    if (archived.length > 0) {
      var det = document.createElement('details');
      det.className = 'desk-archived';
      var sum = document.createElement('summary');
      sum.textContent = '▸ アーカイブ（' + archived.length + ' 件）';
      det.addEventListener('toggle', function() {
        sum.textContent = (det.open ? '▾ ' : '▸ ') + 'アーカイブ（' + archived.length + ' 件）';
      });
      det.appendChild(sum);
      det.appendChild(buildTable(archived));
      body.appendChild(det);
    }
  }

  function buildTable(list) {
    var table = document.createElement('table');
    table.className = 'desk-table';
    table.innerHTML =
      '<thead><tr><th>大会名</th><th>日付</th><th>会場</th><th>人数</th>' +
      '<th>状態</th><th>更新</th><th></th></tr></thead>';
    var tbody = document.createElement('tbody');
    list.forEach(function(ev) { tbody.appendChild(buildRow(ev)); });
    table.appendChild(tbody);
    return table;
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  // 更新日時（ISO 文字列）を「9/18 21:45」の形に。読めない値は「—」。
  function formatUpdated(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var hh = String(d.getHours());
    var mi = String(d.getMinutes());
    if (hh.length < 2) hh = '0' + hh;
    if (mi.length < 2) mi = '0' + mi;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mi;
  }

  function buildRow(ev) {
    var st = EventStatus.of(ev);
    var tr = document.createElement('tr');

    // 大会名はリンク。ハッシュを書き換えるだけで desk.js の applyRoute が拾う。
    var tdName = document.createElement('td');
    var link = document.createElement('a');
    link.className = 'desk-cell-main';
    link.href = '#players/' + encodeURIComponent(ev.id);
    link.textContent = ev.name || '(名称未設定)';
    tdName.appendChild(link);
    tr.appendChild(tdName);

    tr.appendChild(cell(ev.date || '—'));
    tr.appendChild(cell(ev.venue || '—'));
    tr.appendChild(cell(String(ev.playerCount || 0), 'num'));

    var tdStatus = document.createElement('td');
    var badge = document.createElement('span');
    badge.className = 'desk-badge' + (EventStatus.isScoringOpen(st) ? ' on' : '');
    badge.textContent = EventStatus.LABELS[st];
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    tr.appendChild(cell(formatUpdated(ev.updatedAt)));

    var tdAct = document.createElement('td');
    tdAct.className = 'act';
    tdAct.appendChild(buildRowMenu(ev, st));
    tr.appendChild(tdAct);
    return tr;
  }

  // details/summary の外側をクリックしたら閉じる。document への登録は1回だけ
  // （描画のたびにリスナーが積み重ならないように）。
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

  function buildRowMenu(ev, st) {
    bindOutsideClickOnce();
    var menu = document.createElement('details');
    menu.className = 'desk-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    sum.setAttribute('aria-label', (ev.name || '(名称未設定)') + ' の操作');
    menu.appendChild(sum);
    var body = document.createElement('div');
    body.className = 'desk-menu-body';
    menu.appendChild(body);

    body.appendChild(menuItem(menu, '開く', function() { Desk.navigate('players', ev.id); }));
    body.appendChild(menuItem(menu, '📄 コピーして作成', function() { openCopyDialog(ev); }));
    body.appendChild(menuItem(menu, '💾 ファイルに保存', function() { onSaveFile(ev); }));
    // アーカイブは「最終結果」まで進んだ大会だけ（遷移表にない組み合わせはサーバーが拒む）
    if (st === 'final') {
      body.appendChild(menuItem(menu, '📥 アーカイブ', function() { onArchive(ev); }));
    }
    body.appendChild(menuItem(menu, '🗑 削除', function() { onDelete(ev); }));
    return menu;
  }

  async function onSaveFile(ev) {
    var json = await Api.exportBundle(ev.id);
    // json: 成功時は文字列、サーバーがエラーを返したときは {error}、通信失敗は null
    if (typeof json !== 'string') {
      alert(json && json.error
        ? '大会をファイルに保存できませんでした。\n' + json.error
        : '大会をファイルに保存できませんでした。通信を確認してください。');
      return;
    }
    // ファイル名はサーバーの Content-Disposition ではなくクライアントで組む
    Storage.downloadText(Storage.bundleFilename(ev.name, ev.date), json,
      'application/json;charset=utf-8');
    Desk.toast('ファイルに保存しました');
  }

  async function onDelete(ev) {
    if (!confirm('大会「' + (ev.name || '(名称未設定)') + '」を削除します。\n' +
        '選手データも一緒に消えます。よろしいですか？')) {
      return;
    }
    var ok = await Api.deleteEvent(ev.id);
    if (!ok) {
      alert('大会の削除に失敗しました。');
      return;
    }
    Desk.toast('大会を削除しました');
    Desk.navigate('events');   // 一覧を描き直す
  }

  // --- ダイアログ ---

  var fieldSeq = 0;   // input id の連番（label の for と対にする）

  function addField(form, labelText, type) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = type;
    input.id = 'df_' + (++fieldSeq);
    label.htmlFor = input.id;
    label.textContent = labelText;
    form.appendChild(label);
    form.appendChild(input);
    return input;
  }

  // 新規作成。保存に失敗したらダイアログを閉じない（閉じると入力し直しになる）。
  function openNewDialog() {
    var form = document.createElement('div');
    form.className = 'desk-form';
    var inName = addField(form, '大会名', 'text');
    var inDate = addField(form, '日付', 'date');
    var inVenue = addField(form, '会場', 'text');
    inDate.value = Storage.todayLocal();

    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'desk-btn primary';
    btnSave.textContent = '作成';

    var dialog = Desk.openDialog('新規作成', form, [btnSave]);
    inName.focus();

    btnSave.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnSave.disabled = true;
      dialog.lock(true);
      var result = await Api.saveEvent({
        name: name, date: inDate.value, venue: inVenue.value.trim(), players: []
      });
      btnSave.disabled = false;
      dialog.lock(false);
      if (!result || !result.id) {
        alert('大会の作成に失敗しました。通信を確認してください。');
        return;   // ダイアログは開いたまま。入力を残す
      }
      dialog.close();
      Desk.toast('大会を作成しました');
      Desk.navigate('players', result.id);
    });
  }

  // コピーして作成。技と配点は必ず複製される（サーバーの仕様）。
  function openCopyDialog(ev) {
    var wrap = document.createElement('div');

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = '技と配点は必ず複製されます。得点・共有リンク・履歴は引き継ぎません。';
    wrap.appendChild(note);

    var form = document.createElement('div');
    form.className = 'desk-form';
    var inName = addField(form, '大会名', 'text');
    var inDate = addField(form, '日付', 'date');
    var inVenue = addField(form, '会場', 'text');
    inName.value = (ev.name || '(名称未設定)') + '（コピー）';
    inDate.value = Storage.todayLocal();
    inVenue.value = ev.venue || '';

    var check = document.createElement('label');
    check.className = 'desk-check';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    check.appendChild(cb);
    check.appendChild(document.createTextNode(' 選手も複製する（一巡目の行だけ。得点は消えます）'));
    form.appendChild(check);
    wrap.appendChild(form);

    var btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'desk-btn primary';
    btnCopy.textContent = 'コピーして作成';

    var dialog = Desk.openDialog('コピーして作成', wrap, [btnCopy]);
    inName.focus();

    btnCopy.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnCopy.disabled = true;
      dialog.lock(true);
      var result = await Api.copyEvent(ev.id, {
        name: name, date: inDate.value, venue: inVenue.value.trim(), withPlayers: cb.checked
      });
      btnCopy.disabled = false;
      dialog.lock(false);
      if (!result) {
        alert('コピーに失敗しました。通信を確認してください。');
        return;   // ダイアログは開いたまま
      }
      if (result.error) {
        alert('コピーに失敗しました。\n' + result.error);
        return;
      }
      dialog.close();
      Desk.toast('大会をコピーしました（' + (result.playerCount || 0) + '名）');
      Desk.navigate('players', result.id);
    });
  }

  // --- アーカイブ ---

  async function onArchive(ev) {
    // 確認文言はスマホ運営と共通（courts.js）
    if (!confirm(Courts.statusConfirmMessage('final', 'archived', null))) return;
    var res = await Api.changeStatus(ev.id, 'archived');
    if (!res) {
      alert('アーカイブできませんでした。通信を確認してください。');
      return;
    }
    if (!res.ok) {
      alert(res.error);
    } else {
      Desk.toast('アーカイブしました');
    }
    Desk.navigate('events');   // 成否にかかわらず一覧を描き直す（他の端末が動かしている）
  }

  // --- 取り込み ---
  // 検証（format / version）は Storage.checkBundle。スマホ運営（admin-events.js）と同じ流れ。

  async function importBundleText(text) {
    var bundle;
    try {
      bundle = JSON.parse(text);
    } catch (e) {
      alert('ファイルを読めませんでした。');
      return;
    }
    var chk = Storage.checkBundle(bundle);
    if (!chk.ok) { alert(chk.error); return; }

    var name = (bundle.event && bundle.event.name) || '';
    var date = (bundle.event && bundle.event.date) || '';

    // 取り込みは常に新しい大会として追加される。同名・同日があれば先に断りを入れる。
    var existing = await Api.listEvents();
    if (Array.isArray(existing)) {
      var dup = existing.filter(function(e) {
        return String(e.name || '').trim() === String(name).trim() &&
               String(e.date || '') === String(date);
      });
      if (dup.length > 0 &&
          !confirm('同じ名前と日付の大会が既にあります。\n別の大会として追加しますか？')) {
        return;
      }
    }

    var result = await Api.importBundle(bundle);
    if (!result) {
      alert('取り込みに失敗しました。通信を確認してください。');
      return;
    }
    if (!result.success) {
      alert('取り込みに失敗しました。\n' + (result.error || ''));
      return;
    }
    Desk.toast('大会を取り込みました（' + (result.playerCount || 0) + '名）');
    Desk.navigate('players', result.id);
  }

  Desk.registerTab('events', { render: render });
})();
