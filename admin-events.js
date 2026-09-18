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
    var btnImport = document.createElement('button');
    btnImport.type = 'button';
    btnImport.className = 'head-btn';
    btnImport.textContent = '📂 取り込む';
    btnImport.addEventListener('click', function() {
      // ファイル選択〜取り込み完了まで二重送信を防ぐ。成功・失敗・キャンセルの
      // どれで終わっても pickBundle が最後に呼ぶコールバックで必ず戻す。
      btnImport.disabled = true;
      pickBundle(function() { btnImport.disabled = false; });
    });

    var btnNew = document.createElement('button');
    btnNew.type = 'button';
    btnNew.className = 'head-btn';
    btnNew.textContent = '＋ 新規大会';
    btnNew.addEventListener('click', openNewSheet);

    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(btnImport);
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

    // アーカイブ済みは末尾にまとめる。当日の運営で押し間違えないよう、
    // 進行中・準備中の大会と混ぜない。
    var active = events.filter(function(ev) { return EventStatus.of(ev) !== 'archived'; });
    var archived = events.filter(function(ev) { return EventStatus.of(ev) === 'archived'; });
    active.forEach(function(ev) { list.appendChild(buildRow(ev)); });
    if (archived.length > 0) {
      var head2 = document.createElement('div');
      head2.className = 'list-head';
      head2.textContent = 'アーカイブ（' + archived.length + ' 件）';
      list.appendChild(head2);
      archived.forEach(function(ev) { list.appendChild(buildRow(ev)); });
    }
  }

  function buildRow(ev) {
    var row = document.createElement('div');
    row.className = 'row';

    var body = document.createElement('button');
    body.type = 'button';
    body.className = 'row-body';
    var main = document.createElement('span');
    main.className = 'row-main';
    main.textContent = ev.name || '(名称未設定)';
    var sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = (ev.date || '日付なし') + ' ・ ' + (ev.playerCount || 0) + '名 ・ ' +
      EventStatus.LABELS[EventStatus.of(ev)];
    body.appendChild(main);
    body.appendChild(sub);
    body.addEventListener('click', function() {
      Admin.navigate('players', ev.id);
    });

    // 行の操作は「⋯」のシートにまとめる（削除だけだった「✕」の置き換え）。
    // タップ目標の大きさは .row-del のまま（44px）。
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'row-del';
    more.textContent = '⋯';
    more.setAttribute('aria-label', (ev.name || '(名称未設定)') + ' の操作');
    more.addEventListener('click', function() {
      openRowMenu(ev);
    });

    row.appendChild(body);
    row.appendChild(more);
    return row;
  }

  // 行の「⋯」メニュー。ファイルに保存と削除。
  function openRowMenu(ev) {
    var body = document.createElement('div');

    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'menu-item';
    btnSave.textContent = '💾 ファイルに保存';
    body.appendChild(btnSave);

    var btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'menu-item';
    btnDel.textContent = '🗑 削除';
    body.appendChild(btnDel);

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn';
    btnClose.textContent = '閉じる';

    var sheet = Admin.openSheet(ev.name || '(名称未設定)', body, [btnClose]);
    btnClose.addEventListener('click', sheet.close);

    btnSave.addEventListener('click', async function() {
      btnSave.disabled = true;
      sheet.lock(true);
      var json = await Api.exportBundle(ev.id);
      btnSave.disabled = false;
      sheet.lock(false);
      // json: 成功時は文字列、サーバーがエラーを返したときは {error}、
      // 通信そのものに失敗したときは null。
      if (typeof json !== 'string') {
        alert(json && json.error
          ? '大会をファイルに保存できませんでした。\n' + json.error
          : '大会をファイルに保存できませんでした。通信を確認してください。');
        return;   // シートは開いたまま
      }
      // ファイル名はサーバーの Content-Disposition ではなくクライアントで組む
      Storage.downloadText(Storage.bundleFilename(ev.name, ev.date), json,
        'application/json;charset=utf-8');
      sheet.close();
      Admin.toast('ファイルに保存しました');
    });

    btnDel.addEventListener('click', function() {
      sheet.close();
      onDelete(ev);
    });
  }

  async function onDelete(ev) {
    if (!confirm('大会「' + (ev.name || '(名称未設定)') + '」を削除します。\n選手データも一緒に消えます。よろしいですか？')) {
      return;
    }
    var ok = await Api.deleteEvent(ev.id);
    if (!ok) {
      alert('大会の削除に失敗しました。');
      return;
    }
    Admin.toast('大会を削除しました');
    Admin.navigate('events');
  }

  // 新規大会のシート。
  // 保存に失敗したらシートを閉じない（閉じると入力し直しになる）。
  function openNewSheet() {
    var body = document.createElement('div');
    var inName = addField(body, '大会名', 'text');
    var inDate = addField(body, '日付', 'date');
    var inVenue = addField(body, '会場', 'text');
    inDate.value = Storage.todayLocal();

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

  // admin.html には file input を置かない（DOM は計画3との契約）。その場で作って捨てる。
  // onDone はファイル選択〜取り込みが完全に終わった時点（成功・失敗・キャンセルの
  // どれでも）で一度だけ呼ぶ。呼び出し元はこれでボタンの disabled を戻す。
  function pickBundle(onDone) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    var removed = false;
    var fileChosen = false;   // change でファイルを受け取ったら true
    var finished = false;
    function cleanup() {
      if (removed) return;
      removed = true;
      window.removeEventListener('focus', onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    }
    function finish() {
      if (finished) return;
      finished = true;
      if (onDone) onDone();
    }
    // ファイル選択ダイアログをキャンセルすると change は発火しない。
    // cancel イベントが取れる環境ではそれで、取れない環境（フォールバック）では
    // ダイアログを閉じてウィンドウに戻ってきた最初の focus で片付ける。
    // change が先に来た場合はそちらの removeChild が先に効き、cleanup は何もしない。
    function onCancel() { cleanup(); finish(); }
    function onFocus() {
      // change がこの同じ tick で来ることがある（フォーカスが先に戻る環境）。
      // ここで即 cleanup すると、その change を取りこぼす。
      setTimeout(function() {
        cleanup();
        // ファイルを選んでいれば、finish は取り込みの完了（change 側）に任せる。
        if (!fileChosen) finish();
      }, 0);
    }
    input.addEventListener('cancel', onCancel);
    window.addEventListener('focus', onFocus);

    input.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) {
        fileChosen = true;
        var reader = new FileReader();
        reader.onload = function(ev) {
          // 成功でも例外でも「📂 取り込む」を戻す（reject 側を落とすとボタンが無効のまま残る）
          importBundleText(ev.target.result).then(finish, finish);
        };
        reader.onerror = function() { alert('ファイルを読めませんでした。'); finish(); };
        reader.readAsText(file, 'UTF-8');
      } else {
        finish();
      }
      cleanup();
    });
    input.click();
  }

  async function importBundleText(text) {
    var bundle;
    try {
      bundle = JSON.parse(text);
    } catch (e) {
      alert('ファイルを読めませんでした。');
      return;
    }
    if (!bundle || typeof bundle !== 'object' || bundle.format !== 'phx-tameshigiri-event') {
      alert('このアプリのエクスポートファイルではありません。');
      return;
    }
    if (bundle.version !== 1) {
      // format は合っているが version が違う（新しい版が書き出したファイルなど）。
      // サーバー（server/index.js の POST /api/events/import）と文言を揃える。
      alert('対応していないファイル形式です（version: ' + bundle.version + '）\nこのアプリを更新してください。');
      return;
    }
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
    Admin.toast('大会を取り込みました（' + (result.playerCount || 0) + '名）');
    Admin.navigate('players', result.id);
  }

  Admin.registerTab('events', { render: render });
})();
