// 基本情報の区画（#setup/<id>）。大会名・日付・会場の編集と、コート一覧の確認。
// コートは選手の order から決まるので、ここでは読み取りだけ（変えるのは「選手」の区画）。
// 保存は PATCH /api/events/:id（Api.updateEventInfo）で名前・日付・会場と
// settings（ゼッケン・級位段位を必須にするか）だけを送る。
// 大会ファイルを丸ごと送り直す Api.saveEvent は使わない。GET の応答（techniques を
// effectiveTechniques で埋めたもの）をそのまま送り返すと、techniques を持たない大会
// （この機能より前に作られた雛形運用の大会）が自前の技リストを持つ大会に変わってしまう。
(function() {
  var fieldSeq = 0;

  function addField(form, labelText, type) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = type;
    input.id = 'sf_' + (++fieldSeq);
    label.htmlFor = input.id;
    label.textContent = labelText;
    form.appendChild(label);
    form.appendChild(input);
    return input;
  }

  // 必須の設定のチェック 1 行。.desk-check は desk.css にある既存のクラスで、
  // .desk-form のグリッドの 1 行を丸ごと使う（desk-events.js のコピーの
  // ダイアログと同じ作り）。desk.css は別の担当者のファイルなので触らない。
  function addCheck(form, labelText, checked) {
    var label = document.createElement('label');
    label.className = 'desk-check';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked === true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(' ' + labelText));
    form.appendChild(label);
    return input;
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function render(container, ctx) {
    container.innerHTML = '';
    var locked = EventStatus.isLocked(EventStatus.of(ctx.event));

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '基本情報';
    head.appendChild(h2);
    container.appendChild(head);

    if (locked) {
      var warn = document.createElement('p');
      warn.className = 'desk-warn';
      warn.textContent = 'この大会は最終結果を確定済みです。上部の「戻す」を押すと編集できます。';
      container.appendChild(warn);
    }

    var form = document.createElement('div');
    form.className = 'desk-form';
    var inName = addField(form, '大会名', 'text');
    var inDate = addField(form, '日付', 'date');
    var inVenue = addField(form, '会場', 'text');
    inName.value = ctx.event.name || '';
    inDate.value = ctx.event.date || '';
    inVenue.value = ctx.event.venue || '';

    // 必須の設定（大会の settings。無ければ両方 false）。
    // 「必須」でも登録そのものは空で通す。止まるのは「試合開始」のときだけで、
    // 判定は Courts.startBlockers（PC は desk.js、スマホは admin-round.js）。
    var settings = ctx.event.settings || {};
    var chkBib = addCheck(form, 'ゼッケン番号を必須にする', settings.requireBib === true);
    var chkRank = addCheck(form, '級位・段位を必須にする', settings.requireRank === true);

    var actions = document.createElement('div');
    actions.className = 'desk-form-actions';
    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'desk-btn primary';
    btnSave.id = 'btnSetupSave';
    btnSave.textContent = '保存';
    actions.appendChild(btnSave);
    form.appendChild(actions);
    container.appendChild(form);

    var reqNote = document.createElement('p');
    reqNote.className = 'desk-note';
    reqNote.textContent =
      'チェックを入れても、選手の登録は空のままできます。' +
      '一巡目にその項目が空の選手がいる間だけ「試合開始」で止まり、人数と名前が出ます。';
    container.appendChild(reqNote);

    if (locked) {
      inName.disabled = true;
      inDate.disabled = true;
      inVenue.disabled = true;
      chkBib.disabled = true;
      chkRank.disabled = true;
      btnSave.disabled = true;
    }

    btnSave.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnSave.disabled = true;
      var result = await Api.updateEventInfo(ctx.eventId, {
        name: name, date: inDate.value, venue: inVenue.value.trim(),
        // settings はサーバーが requireBib / requireRank の真偽値だけを拾う
        // （他のキーは無視される）。毎回 2 つとも送るので、外したときも保存される。
        settings: { requireBib: chkBib.checked, requireRank: chkRank.checked }
      });
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
      btnSave.disabled = false;
      if (!result || !result.ok) {
        if (result && result.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else {
          alert((result && result.error) || '保存できませんでした。通信を確認してください。');
        }
        return;
      }
      Desk.toast('基本情報を保存しました');
      await Desk.reloadEvent();   // 上部の見出しを描き直す
    });

    // --- コート一覧（読み取り） ---

    var courtHead = document.createElement('div');
    courtHead.className = 'desk-section-head';
    var h2c = document.createElement('h2');
    h2c.textContent = 'コート';
    courtHead.appendChild(h2c);
    container.appendChild(courtHead);

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'コートは選手ひとりひとりのコート指定から決まります（変えるときは「選手」の区画で）。';
    container.appendChild(note);

    var courts = Courts.listFrom(ctx.players);
    if (courts.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいないので、コートはありません。';
      container.appendChild(none);
      return;
    }

    var table = document.createElement('table');
    table.className = 'desk-table';
    table.innerHTML = '<thead><tr><th>コート</th><th>一巡目</th><th>二巡目</th><th>合計</th></tr></thead>';
    var tbody = document.createElement('tbody');
    courts.forEach(function(c) {
      var rows = Courts.filter(ctx.players, c);
      var r1 = rows.filter(function(p) { return Courts.roundOf(p) === 1; }).length;
      var r2 = rows.filter(function(p) { return Courts.roundOf(p) === 2; }).length;
      var tr = document.createElement('tr');
      tr.appendChild(cell(c === Courts.UNASSIGNED ? Courts.UNASSIGNED : c + ' コート'));
      tr.appendChild(cell(String(r1), 'num'));
      tr.appendChild(cell(String(r2), 'num'));
      tr.appendChild(cell(String(rows.length), 'num'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  Desk.registerTab('setup', { render: render });
})();
