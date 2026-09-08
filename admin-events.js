// 大会タブ（#events）。大会の一覧・新規作成・削除。
(function() {

  async function render(container) {
    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '大会';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.appendChild(h2);
    head.appendChild(spacer);
    container.appendChild(head);

    var list = document.createElement('div');
    list.className = 'list';
    container.appendChild(list);

    var loading = document.createElement('p');
    loading.className = 'empty';
    loading.textContent = '読み込み中…';
    list.appendChild(loading);

    var events = await Api.listEvents();
    list.innerHTML = '';
    if (!events) {
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
    body.style.background = 'transparent';
    body.style.color = 'inherit';
    body.style.textAlign = 'left';
    body.style.minHeight = '44px';
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
      onDelete(ev);
    });

    row.appendChild(body);
    row.appendChild(del);
    return row;
  }

  async function onDelete(ev) {
    if (!confirm('大会「' + (ev.name || '') + '」を削除します。\n選手データも一緒に消えます。よろしいですか？')) return;
    var ok = await Api.deleteEvent(ev.id);
    if (!ok) {
      alert('大会の削除に失敗しました。');
      return;
    }
    Admin.toast('大会を削除しました');
    Admin.navigate('events');
  }

  Admin.registerTab('events', { render: render });
})();
