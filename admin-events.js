// 大会タブ（#events）。大会の一覧・新規作成・削除。
(function() {
  var fieldSeq = 0;   // addField が発行する input id の連番（label の for と対にする）

  async function render(container, ctx) {
    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '大会';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    var btnNew = document.createElement('button');
    btnNew.type = 'button';
    btnNew.className = 'head-btn';
    btnNew.textContent = '＋ 新規大会';
    btnNew.addEventListener('click', openNewSheet);

    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(btnNew);
    container.appendChild(head);

    var list = document.createElement('div');
    list.className = 'list';
    container.appendChild(list);

    var loading = document.createElement('p');
    loading.className = 'empty';
    loading.textContent = '読み込み中…';
    list.appendChild(loading);

    var events = await Api.listEvents();
    if (ctx.isStale()) return;   // 待っている間にタブや大会を切り替えられた
    list.innerHTML = '';
    if (!Array.isArray(events)) {
      // 取得できなかっただけで、大会が消えたわけではない。「0件」と誤解させない。
      var err = document.createElement('p');
      err.className = 'empty';
      err.textContent = '大会一覧を取得できませんでした。通信を確認してください。';
      list.appendChild(err);
      alert('大会一覧を取得できませんでした。通信を確認してください。');
      return;
    }
    if (events.length === 0) {
      var none = document.createElement('p');
      none.className = 'empty';
      none.textContent = '大会がまだありません。「＋ 新規大会」で作成してください。';
      list.appendChild(none);
      return;
    }

    // 直近に触った大会を上に出す
    events.sort(function(a, b) {
      var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
      if (x === y) return 0;
      return x < y ? 1 : -1;
    });

    events.forEach(function(ev) {
      list.appendChild(buildRow(ev));
    });
  }

  function buildRow(ev) {
    var row = document.createElement('div');
    row.className = 'row';

    var body = document.createElement('button');
    body.type = 'button';
    body.className = 'row-body';
    var main = document.createElement('div');
    main.className = 'row-main';
    main.textContent = ev.name || '(名称未設定)';
    var sub = document.createElement('div');
    sub.className = 'row-sub';
    sub.textContent = (ev.date || '日付なし') + ' ・ ' + (ev.playerCount || 0) + '名';
    body.appendChild(main);
    body.appendChild(sub);
    body.addEventListener('click', function() {
      Admin.navigate('players', ev.id);
    });

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'row-del';
    del.textContent = '✕';
    del.addEventListener('click', function() {
      del.disabled = true;
      onDelete(ev, del);
    });

    row.appendChild(body);
    row.appendChild(del);
    return row;
  }

  async function onDelete(ev, del) {
    if (!confirm('大会「' + (ev.name || '(名称未設定)') + '」を削除します。\n選手データも一緒に消えます。よろしいですか？')) {
      del.disabled = false;
      return;
    }
    var ok = await Api.deleteEvent(ev.id);
    if (!ok) {
      alert('大会の削除に失敗しました。');
      del.disabled = false;
      return;
    }
    Admin.toast('大会を削除しました');
    Admin.navigate('events');
  }

  // toISOString は UTC なので JST の深夜に前日になる。ローカル日付を組み立てる。
  function todayLocal() {
    var d = new Date();
    var mm = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    if (mm.length < 2) mm = '0' + mm;
    if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  // 新規大会のシート。
  // 保存に失敗したらシートを閉じない（閉じると入力し直しになる）。
  function openNewSheet() {
    var body = document.createElement('div');
    var inName = addField(body, '大会名', 'text');
    var inDate = addField(body, '日付', 'date');
    var inVenue = addField(body, '会場', 'text');
    inDate.value = todayLocal();

    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn primary';
    btnSave.textContent = '作成';

    var sheet = Admin.openSheet('新規大会', body, [btnSave]);
    inName.focus();

    btnSave.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnSave.disabled = true;
      sheet.lock(true);
      var result = await Api.saveEvent({
        name: name,
        date: inDate.value,
        venue: inVenue.value.trim(),
        players: []
      });
      btnSave.disabled = false;
      sheet.lock(false);
      if (!result || !result.id) {
        alert('大会の作成に失敗しました。通信を確認してください。');
        return;   // シートは開いたまま。入力を残す
      }
      sheet.close();
      Admin.toast('大会を作成しました');
      Admin.navigate('players', result.id);
    });
  }

  function addField(parent, labelText, type) {
    var field = document.createElement('div');
    field.className = 'field';
    var label = document.createElement('label');
    label.textContent = labelText;
    var input = document.createElement('input');
    input.type = type;
    input.id = 'f_' + (++fieldSeq);
    label.htmlFor = input.id;
    field.appendChild(label);
    field.appendChild(input);
    parent.appendChild(field);
    return input;
  }

  Admin.registerTab('events', { render: render });
})();
