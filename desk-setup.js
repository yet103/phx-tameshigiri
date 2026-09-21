// 基本情報の区画（#setup/<id>）。大会名・日付・会場・必須の設定と、コート一覧の編集。
// コートは 2 通りある。選手の order から導かれるコート（外せない）と、大会が
// settings.courts に持つコート（選手が 0 人でも候補に出したいもの。ここで足す・外す）。
// 検証は Courts.validateCourtList で、サーバーの PATCH と同じ規則・同じ文言になる。
// 保存は PATCH /api/events/:id（Api.updateEventInfo）で名前・日付・会場と
// settings（ゼッケン・級位段位を必須にするか、コート一覧）だけを送る。
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

    // テスト大会の印。変える UI は出さない（test を立てるのはテンプレート API だけ）。
    if (ctx.event && ctx.event.test === true) {
      var testNote = document.createElement('p');
      testNote.className = 'desk-note';
      testNote.textContent = 'テスト大会です（トップの「作成済みの大会」では既定で隠れます）。';
      container.appendChild(testNote);
    }

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
    // 画面で編集中のコート一覧（保存するのはこの配列）。
    // 選手から導かれるコートはここに入れない（外せないものを保存し直さない）。
    // settings.courts は壊れたデータ（配列でない値）が来ても落ちないように読む
    var extra = Array.isArray(settings.courts) ? settings.courts.slice() : [];
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

    // 基本情報とコート一覧の保存は同じ PATCH（どちらのボタンからも全部を送る）。
    // コートを足したのに上の「保存」を押し忘れる、という取りこぼしを無くすため、
    // コートの節にも同じ保存を置く。押したボタンだけを無効にして二重送信を防ぐ。
    async function saveInfo(btn) {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      var courtErr = Courts.validateCourtList(extra);
      if (courtErr) { alert(courtErr); return; }
      // 決戦コートの名前もコートの名前の規則に従う（サーバーも見るが、文言をここで出す）。
      var finalName = inFinal.value.trim();
      if (finalName) {
        var finalErr = Courts.validateCourtList([finalName]);
        if (finalErr) { alert(finalErr); return; }
      }
      btn.disabled = true;
      var result = await Api.updateEventInfo(ctx.eventId, {
        name: name, date: inDate.value, venue: inVenue.value.trim(),
        // settings はサーバーが requireBib / requireRank / courts / finalCourt だけを拾う
        // （他のキーは無視される）。毎回すべて送るので、外したときも保存される。
        // finalCourt は空欄なら「既定（決戦）に戻す」意味（サーバーがキーごと落とす）。
        settings: {
          requireBib: chkBib.checked,
          requireRank: chkRank.checked,
          courts: extra.slice(),
          finalCourt: finalName
        }
      });
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
      btn.disabled = false;
      if (!result || !result.ok) {
        if (result && result.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else {
          alert((result && result.error) || '保存できませんでした。通信を確認してください。');
        }
        return;
      }
      Desk.toast('基本情報を保存しました');
      await Desk.reloadEvent();   // 上部の見出しと、この区画のチップを描き直す
    }

    btnSave.addEventListener('click', function() { saveInfo(btnSave); });

    // --- コート一覧（大会の settings.courts を編集する）---

    var courtHead = document.createElement('div');
    courtHead.className = 'desk-section-head';
    var h2c = document.createElement('h2');
    h2c.textContent = 'コート';
    courtHead.appendChild(h2c);
    container.appendChild(courtHead);

    var courtNote = document.createElement('p');
    courtNote.className = 'desk-note';
    courtNote.textContent =
      'ここで足したコートは、選手が 1 人もいなくても選手登録のコート候補と試合進行のカードに出ます。' +
      '灰色のコートは選手のコート指定から決まったもので、外せません（外すときは「選手」の区画でコートを変えます）。';
    container.appendChild(courtNote);

    // 決戦コートの名前（settings.finalCourt）。空欄なら既定の「決戦」。
    // 一覧のコート（settings.courts）とは別に持つ（設計書「データ」）。
    var finalWrap = document.createElement('div');
    finalWrap.className = 'desk-form';
    var inFinal = addField(finalWrap, '決戦コートの名前', 'text');
    inFinal.id = 'setupFinalCourt';
    inFinal.placeholder = EventStatus.finalCourtOf({});   // '決戦'
    inFinal.value = (typeof settings.finalCourt === 'string') ? settings.finalCourt : '';
    inFinal.disabled = locked;
    container.appendChild(finalWrap);

    var finalNote = document.createElement('p');
    finalNote.className = 'desk-note';
    finalNote.textContent = '一巡目を終了したときに、暫定ベスト8（一般男子・一巡目の得点上位）を' +
      'このコートへ移します。空欄なら「' + EventStatus.finalCourtOf({}) + '」になります。' +
      '名前の規則は他のコートと同じです（「-」と「未分類」は使えません）。';
    container.appendChild(finalNote);

    var chipWrap = document.createElement('div');
    chipWrap.className = 'desk-court-chips';
    container.appendChild(chipWrap);

    var courtActions = document.createElement('div');
    courtActions.className = 'desk-form-actions';
    var btnCourtSave = document.createElement('button');
    btnCourtSave.type = 'button';
    btnCourtSave.className = 'desk-btn primary';
    btnCourtSave.textContent = '保存';
    btnCourtSave.disabled = locked;
    btnCourtSave.addEventListener('click', function() { saveInfo(btnCourtSave); });
    courtActions.appendChild(btnCourtSave);
    container.appendChild(courtActions);

    var tableWrap = document.createElement('div');
    container.appendChild(tableWrap);

    // 選手の order から導かれたコート（外せない）
    function playerCourts() {
      return Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    }

    // 画面に出すコート＝選手のコート ∪ 大会のコート（未分類は表だけに出す）
    function allCourts() {
      return Courts.listFrom(ctx.players, extra);
    }

    function renderChips() {
      chipWrap.innerHTML = '';
      var fixed = playerCourts();
      var names = allCourts().filter(function(c) { return c !== Courts.UNASSIGNED; });

      if (names.length === 0) {
        var empty = document.createElement('span');
        empty.className = 'desk-empty-inline';
        empty.textContent = 'コートがまだありません。';
        chipWrap.appendChild(empty);
      }

      names.forEach(function(c) {
        var hasPlayers = fixed.indexOf(c) !== -1;
        var chip = document.createElement('span');
        chip.className = 'desk-chip' + (hasPlayers ? ' fixed' : '');
        var label = document.createElement('span');
        label.textContent = hasPlayers ? (c + '（選手あり）') : c;
        chip.appendChild(label);
        if (!hasPlayers && !locked) {
          var x = document.createElement('button');
          x.type = 'button';
          x.className = 'desk-chip-x';
          x.textContent = '×';
          x.setAttribute('aria-label', c + ' を外す');
          x.addEventListener('click', function() {
            var i = extra.indexOf(c);
            if (i !== -1) extra.splice(i, 1);
            renderChips();
            renderCourtTable();
          });
          chip.appendChild(x);
        }
        chipWrap.appendChild(chip);
      });

      if (locked) return;
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'desk-btn-sub';
      add.textContent = '＋ コートを足す';
      add.addEventListener('click', onAddCourt);
      chipWrap.appendChild(add);
    }

    // 名前の規則はサーバーの PATCH と同じ（Courts.validateCourtList）。
    // 既にあるコートと合わせて検証するので、重複も 20 件超もここで弾ける。
    function onAddCourt() {
      var name = prompt('コート名を入力してください（例: A）', '');
      if (name === null) return;   // キャンセル
      name = String(name).trim();
      var err = Courts.validateCourtList(
        allCourts().filter(function(c) { return c !== Courts.UNASSIGNED; }).concat([name]));
      if (err) { alert(err); return; }
      extra.push(name);
      renderChips();
      renderCourtTable();
    }

    // コート別の人数。大会だけが持つコートは 0 / 0 / 0 で出す
    // （足したコートが確かに入っていることが見える）。
    function renderCourtTable() {
      tableWrap.innerHTML = '';
      var courts = allCourts();
      if (courts.length === 0) return;

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
      tableWrap.appendChild(table);
    }

    renderChips();
    renderCourtTable();
  }

  Desk.registerTab('setup', { render: render });
})();
