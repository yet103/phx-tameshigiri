// 運営画面の骨組み。
// タブの中身は admin-events.js / admin-players.js（計画3で admin-round.js /
// admin-results.js）が Admin.registerTab で登録する。このモジュールは
// 「どのタブを、どの大会で描くか」だけを持ち、画面の中身は知らない。
//
// ハッシュ体系: #events / #players/<大会ID> / #round/<大会ID> / #results/<大会ID>
// 採点画面の Route（#event/<id>/<court>）とは別体系で、ここで完結させる。
// 選択中の大会は localStorage の tmg_admin_last に控える（採点画面の tmg_last とは分ける。
// 運営者のスマホとコートのタブレットは別端末で、混ぜる理由がない）。
var Admin = (function() {
  var LAST_KEY = 'tmg_admin_last';
  var TABS = ['events', 'players', 'round', 'results'];

  var defs = {};
  var content = null;
  var currentTab = 'events';
  var selectedEventId = null;
  var toastTimer = null;

  // 現在開いているシートのハンドル。ハッシュ遷移で古い ctx のまま
  // 残らないよう、ルートが変わったら全部閉じる。
  var openSheets = [];

  // 描画の再入ガード。Api.loadEvent の往復中にタブを切り替えられると、
  // 遅れて戻ってきた古い応答が新しい画面を上書きする。
  var renderSeq = 0;

  // --- タブ登録 ---

  // def = { render: function(container, ctx) }  render は async でもよい
  // ctx = { eventId, event, players, techniques, isStale }
  //   （events タブでは event / players / techniques は null）
  // ctx.techniques — その大会の有効な技リスト（配点は大会ごと。雛形を取りに行かない）
  // ctx.isStale() — await の直後に見て true なら描画をやめる
  // （タブや大会を切り替えられた後の古い応答を画面に反映しないため）
  function registerTab(name, def) {
    defs[name] = def;
  }

  // --- ハッシュ ---

  function parseHash(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    if (!raw) return null;
    var parts = raw.split('/');
    if (TABS.indexOf(parts[0]) === -1) return null;
    var id = '';
    if (parts[1]) {
      try { id = decodeURIComponent(parts[1]); } catch (e) { return null; }
    }
    return { tab: parts[0], eventId: id };
  }

  function buildHash(tab, eventId) {
    if (tab === 'events' || !eventId) return '#' + tab;
    return '#' + tab + '/' + encodeURIComponent(eventId);
  }

  function loadLast() {
    try {
      var raw = localStorage.getItem(LAST_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || TABS.indexOf(v.tab) === -1) return null;
      if (v.tab !== 'events' && !v.eventId) return null;
      return { tab: v.tab, eventId: v.eventId || '' };
    } catch (e) {
      return null;
    }
  }

  function saveLast() {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({
        tab: currentTab,
        eventId: selectedEventId || ''
      }));
    } catch (e) {}
  }

  // 大会が消えている（404）ときに控えを残さない。残すと次回起動時に
  // 存在しない大会を読み直そうとして、また同じ案内を出すだけになる。
  function clearLast() {
    try { localStorage.removeItem(LAST_KEY); } catch (e) {}
  }

  // --- 遷移 ---

  function navigate(tab, eventId) {
    var id = (eventId === undefined || eventId === null) ? selectedEventId : eventId;
    var hash = buildHash(tab, id);
    if (location.hash === hash) {
      applyRoute().catch(function(e) { console.error(e); });  // 同じハッシュでは hashchange が出ないので直接描く
    } else {
      location.hash = hash;  // hashchange → applyRoute
    }
  }

  // ユーザー操作を経ない自動の戻し用。
  // 自動の戻しは履歴に積まない（戻るボタンで #round → #events → #round … と往復してしまう）。
  function redirect(tab, eventId) {
    var id = (eventId === undefined || eventId === null) ? selectedEventId : eventId;
    var hash = buildHash(tab, id);
    if (location.hash === hash) {
      applyRoute().catch(function(e) { console.error(e); });  // 同じハッシュでは hashchange が出ないので直接描く
    } else {
      location.replace(location.pathname + location.search + hash);  // hashchange → applyRoute（履歴には積まない）
    }
  }

  async function applyRoute() {
    closeAllSheets();
    // シートの onClose が起動する reloadEvent を、これから描く画面より古い扱いにする
    renderSeq++;
    var route = parseHash(location.hash);
    if (!route) {
      // ハッシュが無いときは前回の続きから。それも無ければ大会一覧。
      var last = loadLast() || { tab: 'events', eventId: '' };
      redirect(last.tab, last.eventId);
      return;
    }
    if (route.tab !== 'events' && !route.eventId) {
      toast('先に大会を選んでください');
      redirect('events');
      return;
    }

    currentTab = route.tab;
    selectedEventId = route.eventId || null;
    if (currentTab === 'events') saveLast();
    highlightTabs();

    var seq = ++renderSeq;
    if (currentTab === 'events') {
      setTitle('PHX試し斬り 運営');
      renderTab(seq, { eventId: null, event: null, players: null, techniques: null });
      return;
    }

    content.innerHTML = '';
    var loading = document.createElement('p');
    loading.className = 'empty';
    loading.textContent = '読み込み中…';
    content.appendChild(loading);

    var evResult = await Api.loadEventResult(selectedEventId);
    if (seq !== renderSeq) return;   // 追い越された
    if (!evResult.ok) {
      if (evResult.status === 404) {
        alert('この大会は削除されています');
        clearLast();
      } else {
        alert('大会データを取得できませんでした。通信を確認してください。');
      }
      redirect('events');
      return;
    }
    var ev = evResult.event;
    saveLast();
    setTitle(ev.name || 'PHX試し斬り 運営');
    renderTab(seq, {
      eventId: selectedEventId, event: ev, players: ev.players || [],
      techniques: Array.isArray(ev.techniques) ? ev.techniques : null
    });
  }

  // 現在の大会を読み直して、いま開いているタブを描き直す
  async function reloadEvent() {
    if (currentTab === 'events' || !selectedEventId) return;
    var seq = ++renderSeq;
    var evResult = await Api.loadEventResult(selectedEventId);
    if (seq !== renderSeq) return;
    if (!evResult.ok) {
      if (evResult.status === 404) {
        alert('この大会は削除されています');
        clearLast();
        redirect('events');
      } else {
        alert('大会データを取得できませんでした。通信を確認してください。');
      }
      return;
    }
    var ev = evResult.event;
    setTitle(ev.name || 'PHX試し斬り 運営');
    renderTab(seq, {
      eventId: selectedEventId, event: ev, players: ev.players || [],
      techniques: Array.isArray(ev.techniques) ? ev.techniques : null
    });
  }

  async function renderTab(seq, ctx) {
    var def = defs[currentTab];
    content.innerHTML = '';
    if (!def) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'このタブはまだ準備中です。';
      content.appendChild(p);
      return;
    }
    // タブの render が await をまたぐ間にタブや大会を切り替えられたかどうか。
    // 各タブは await の直後にこれを見て、古ければ描画をやめる
    // （大会IDの比較だけでは、同じ大会内のタブ切り替えを検出できない）。
    ctx.isStale = function() { return seq !== renderSeq; };
    try {
      await def.render(content, ctx);
    } catch (e) {
      if (seq !== renderSeq) return;   // 古い描画の失敗は無視する
      console.error(e);
      content.innerHTML = '';
      var err = document.createElement('p');
      err.className = 'empty';
      err.textContent = '画面の表示に失敗しました。タブを選び直してください。';
      content.appendChild(err);
    }
  }

  function currentEventId() {
    return selectedEventId || null;
  }

  // --- 画面の共通部品 ---

  function setTitle(text) {
    document.getElementById('topTitle').textContent = text;
  }

  function highlightTabs() {
    var btns = document.querySelectorAll('.tabbar button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].dataset.tab === currentTab);
    }
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.hidden = true; }, 2000);
  }

  // シートの外枠。中身と操作ボタンを渡す。大会タブ・選手タブ・（計画3の）進行タブで共用する。
  // onClose はシートがどの経路で閉じても（✕・外側タップ・close()・closeAllSheets()）1回だけ呼ばれる。
  // onClose はハッシュ遷移（closeAllSheets）でも呼ばれる。onClose の中でサーバーに書き込まないこと
  // （古い ctx で書いてしまう）。
  // 戻り値: { close, lock }
  //   close()     : シートを閉じる
  //   lock(flag)  : true の間は ✕ と外側タップで閉じない（保存の通信中に入力を失わないため）
  function openSheet(titleText, bodyEl, buttons, onClose) {
    var overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    var sheet = document.createElement('div');
    sheet.className = 'sheet';

    var head = document.createElement('div');
    head.className = 'sheet-head';
    var title = document.createElement('span');
    title.textContent = titleText;
    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'sheet-close';
    btnClose.textContent = '✕';
    head.appendChild(title);
    head.appendChild(btnClose);

    var body = document.createElement('div');
    body.className = 'sheet-body';
    body.appendChild(bodyEl);

    var actions = document.createElement('div');
    actions.className = 'sheet-actions';
    buttons.forEach(function(b) { actions.appendChild(b); });

    sheet.appendChild(head);
    sheet.appendChild(body);
    sheet.appendChild(actions);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    var closed = false;
    var locked = false;
    function close() {
      if (closed) return;
      closed = true;
      var i = openSheets.indexOf(handle);
      if (i >= 0) openSheets.splice(i, 1);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      TechPicker.dismiss();   // ピッカーは常にシートの上に乗るので、シートを閉じたら残さない
      if (onClose) onClose();
    }
    function tryClose() {
      if (!locked) close();
    }
    btnClose.addEventListener('click', tryClose);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) tryClose();
    });
    var handle = {
      close: close,
      lock: function(flag) {
        locked = !!flag;
        btnClose.disabled = !!flag;
      }
    };
    openSheets.push(handle);
    return handle;
  }

  // 戻るボタンなどでハッシュが変わったら、前の画面のシートを残さない
  // （古い ctx で保存してしまう）。lock 中でも問答無用で閉じる
  // （ユーザーはもう別の画面に移っている）。
  function closeAllSheets() {
    openSheets.slice().forEach(function(s) { s.close(); });
    TechPicker.dismiss();
  }

  // チップの帯を描く。items は [{ value, label }]、current は選択中の value
  // （比較は文字列化して行う。数値の巡目や真偽値のトグルもそのまま渡せる）。
  // small が true なら高さ 32px の小型（.chip-sm）。
  // 選手タブの絞り込み（性別・巡目・新人・技未入力）と下の renderCourtChips で共用。
  function renderChips(container, items, current, onChange, small) {
    container.innerHTML = '';
    items.forEach(function(it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'court-chip'
        + (small ? ' chip-sm' : '')
        + (String(it.value) === String(current) ? ' on' : '');
      b.textContent = it.label;
      b.addEventListener('click', function() {
        if (onChange) onChange(it.value);
      });
      container.appendChild(b);
    });
  }

  // コートの絞り込みチップ（「全コート」「A コート」…「未分類」）。選手タブと進行タブで共用。
  function renderCourtChips(container, players, current, onChange) {
    var items = [''].concat(Courts.listFrom(players)).map(function(c) {
      var label = c === '' ? '全コート'
        : (c === Courts.UNASSIGNED ? Courts.UNASSIGNED : c + ' コート');
      return { value: c, label: label };
    });
    renderChips(container, items, current || '', onChange);
  }

  // 採点画面のハッシュ（route.js の Route.build と同じ形。admin.html は route.js を読まない）。
  // eventId が空なら大会選択前なのでハッシュ無しの 'scoring.html' を返す
  // （採点画面側で tmg_last の控えから開かせるため）。
  function scoringHref(eventId, court) {
    if (!eventId) return 'scoring.html';
    var hash = '#event/' + encodeURIComponent(eventId);
    if (court) hash += '/' + encodeURIComponent(court);
    return 'scoring.html' + hash;
  }

  // 運営画面から他の画面へ戻る導線（下タブは運営画面内のタブなので、ページ間の移動はここに置く）
  // ボタンはシートが開いている間も DOM フォーカスを保持するため、Enter の
  // オートリピートなどで連続発火するとシートが二重に開いてしまう。再入を防ぐ。
  var adminMenuOpen = false;
  function openAdminMenu() {
    if (adminMenuOpen) return;
    adminMenuOpen = true;

    var body = document.createElement('div');

    var btnHome = document.createElement('button');
    btnHome.type = 'button';
    btnHome.className = 'menu-item';
    btnHome.textContent = '🏠 トップ';
    body.appendChild(btnHome);

    // 基本情報（名前・日付・会場・必須設定・コート一覧）はスマホ運営にタブが無いので、
    // ⋯ メニューから開くシートで編集する（Storage.mapHash の #setup → #players の
    // 対応は変えない。設計書「モードの切り替え」）。選択中の大会があるときだけ出す。
    var btnSetup = null;
    if (currentEventId()) {
      btnSetup = document.createElement('button');
      btnSetup.type = 'button';
      btnSetup.className = 'menu-item';
      btnSetup.textContent = '📝 基本情報';
      body.appendChild(btnSetup);
    }

    var btnScoring = document.createElement('button');
    btnScoring.type = 'button';
    btnScoring.className = 'menu-item';
    btnScoring.textContent = '📋 採点画面';
    body.appendChild(btnScoring);

    var btnTechniques = document.createElement('button');
    btnTechniques.type = 'button';
    btnTechniques.className = 'menu-item';
    btnTechniques.textContent = '🗒 技術リスト編集';
    body.appendChild(btnTechniques);

    // 大会を選んでいるときだけ出す（どの大会を保存するのか決まらないため）
    var btnBundle = null;
    if (currentEventId()) {
      btnBundle = document.createElement('button');
      btnBundle.type = 'button';
      btnBundle.className = 'menu-item';
      btnBundle.textContent = '💾 大会をファイルに保存';
      body.appendChild(btnBundle);
    }

    var btnRanking = document.createElement('button');
    btnRanking.type = 'button';
    btnRanking.className = 'menu-item';
    btnRanking.textContent = '🏆 順位表示';
    body.appendChild(btnRanking);

    var btnHelp = document.createElement('button');
    btnHelp.type = 'button';
    btnHelp.className = 'menu-item';
    btnHelp.textContent = '❓ ヘルプ';
    body.appendChild(btnHelp);

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn';
    btnClose.textContent = '閉じる';

    var sheet = openSheet('メニュー', body, [btnClose], function() { adminMenuOpen = false; });
    btnClose.addEventListener('click', sheet.close);

    // 選択中の大会があれば採点画面にもそのまま引き継ぐ（tmg_last / tmg_admin_last が
    // 別々の控えキーのため、ハッシュ無しだと採点画面側の控えに戻ってしまう）。
    btnHome.addEventListener('click', function() {
      sheet.close();
      location.href = 'index.html';
    });
    if (btnSetup) {
      btnSetup.addEventListener('click', function() {
        sheet.close();
        openEventInfoSheet(currentEventId());
      });
    }
    btnScoring.addEventListener('click', function() {
      sheet.close();
      location.href = scoringHref(currentEventId(), '');
    });
    btnTechniques.addEventListener('click', function() {
      sheet.close();
      // 配点は大会ごと。選択中の大会があればその大会の技リストを開く
      // （大会未選択なら雛形＝新規大会の初期値を開く）。
      var id = currentEventId();
      location.href = id ? 'techniques.html#' + encodeURIComponent(id) : 'techniques.html';
    });
    btnRanking.addEventListener('click', function() {
      sheet.close();
      location.href = 'ranking.html';
    });
    btnHelp.addEventListener('click', function() {
      sheet.close();
      location.href = 'help.html';
    });

    if (btnBundle) {
      btnBundle.addEventListener('click', async function() {
        // await をまたぐので、対象の大会をここで固定する
        var eventId = currentEventId();
        if (!eventId) return;
        btnBundle.disabled = true;
        sheet.lock(true);
        // ファイル名に使う大会名と日付は大会データから取る
        var ev = await Api.loadEvent(eventId);
        var json = ev ? await Api.exportBundle(eventId) : null;
        btnBundle.disabled = false;
        sheet.lock(false);
        // json: 成功時は文字列、サーバーがエラーを返したときは {error}、
        // 通信そのものに失敗したときは null。
        if (!ev || typeof json !== 'string') {
          alert(json && json.error
            ? '大会をファイルに保存できませんでした。\n' + json.error
            : '大会をファイルに保存できませんでした。通信を確認してください。');
          return;   // シートは開いたまま
        }
        Storage.downloadText(Storage.bundleFilename(ev.name, ev.date), json,
          'application/json;charset=utf-8');
        sheet.close();
        toast('ファイルに保存しました');
      });
    }
  }

  // --- 基本情報シート（⋯メニュー） ---
  // PC 運営の desk-setup.js と同じ流れ・同じ文言。名前・日付・会場・必須2つ・コート一覧を
  // 編集し、保存は Api.updateEventInfo(eventId, { name, date, venue, settings }) の1本
  // （大会ファイルを丸ごと送り直す Api.saveEvent は使わない。techniques を持たない大会が
  // 自前の技リストを持つ大会に変わってしまうのを避けるため）。
  async function openEventInfoSheet(eventId) {
    var evResult = await Api.loadEventResult(eventId);
    if (currentEventId() !== eventId) return;   // 開いている間に大会を切り替えられた
    if (!evResult.ok) {
      if (evResult.status === 404) {
        alert('この大会は削除されています');
        clearLast();
        redirect('events');
      } else {
        alert('大会データを取得できませんでした。通信を確認してください。');
      }
      return;
    }
    var ev = evResult.event;
    var locked = EventStatus.isLocked(EventStatus.of(ev));
    var players = ev.players || [];
    var settings = ev.settings || {};
    // 画面で編集中のコート一覧（保存するのはこの配列）。選手から導かれるコートは
    // ここに入れない（外せないものを保存し直さない。desk-setup.js と同じ規約）。
    var extra = Array.isArray(settings.courts) ? settings.courts.slice() : [];

    var body = document.createElement('div');

    if (ev.test === true) {
      var testNote = document.createElement('p');
      testNote.className = 'field-note';
      testNote.textContent = 'テスト大会です（トップの「作成済みの大会」では既定で隠れます）。';
      body.appendChild(testNote);
    }
    if (locked) {
      var warn = document.createElement('p');
      warn.className = 'admin-warn';
      warn.textContent = 'この大会は最終結果を確定済みです。試合進行タブの「⋯」→「◀ … に戻す」を押すと編集できます。';
      body.appendChild(warn);
    }

    function addField(labelText, type) {
      var wrap = document.createElement('div');
      wrap.className = 'field';
      var label = document.createElement('label');
      label.textContent = labelText;
      var input = document.createElement('input');
      input.type = type;
      wrap.appendChild(label);
      wrap.appendChild(input);
      body.appendChild(wrap);
      return input;
    }
    var inName = addField('大会名', 'text');
    inName.value = ev.name || '';
    var inDate = addField('日付', 'date');
    inDate.value = ev.date || '';
    var inVenue = addField('会場', 'text');
    inVenue.value = ev.venue || '';

    function addCheck(labelText, checked) {
      var wrap = document.createElement('div');
      wrap.className = 'field';
      var label = document.createElement('label');
      label.className = 'toggle';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked === true;
      var span = document.createElement('span');
      span.textContent = labelText;
      label.appendChild(input);
      label.appendChild(span);
      wrap.appendChild(label);
      body.appendChild(wrap);
      return input;
    }
    var chkBib = addCheck('ゼッケン番号を必須にする', settings.requireBib === true);
    var chkRank = addCheck('級位・段位を必須にする', settings.requireRank === true);

    var reqNote = document.createElement('p');
    reqNote.className = 'field-note';
    reqNote.textContent =
      'チェックを入れても、選手の登録は空のままできます。' +
      '一巡目にその項目が空の選手がいる間だけ「試合開始」で止まり、人数と名前が出ます。';
    body.appendChild(reqNote);

    // 決戦コートの名前（settings.finalCourt）。空欄なら既定の「決戦」（PC 運営 desk-setup.js と同じ）。
    var inFinal = addField('決戦コートの名前', 'text');
    inFinal.id = 'setupFinalCourt';
    inFinal.placeholder = EventStatus.finalCourtOf({});   // '決戦'
    inFinal.value = (typeof settings.finalCourt === 'string') ? settings.finalCourt : '';
    // 決戦の行がすでにあると、名前を変えても決戦コートに移した選手をどのコート端末でも
    // 採点できなくなる（サーバーも PATCH で 400 にする。レビュー指摘B）。
    var hasFinalRows = EventStatus.hasFinalists(players);
    inFinal.disabled = locked || hasFinalRows;

    var finalNote = document.createElement('p');
    finalNote.className = 'field-note';
    finalNote.textContent = hasFinalRows
      ? '決戦の行ができた後は変えられません。'
      : ('一巡目を終了したときに、暫定ベスト8（一般男子・一巡目の得点上位）を' +
        'このコートへ移します。空欄なら「' + EventStatus.finalCourtOf({}) + '」になります。' +
        '名前の規則は他のコートと同じです（「-」と「未分類」は使えません）。');
    body.appendChild(finalNote);

    // --- コート一覧 ---
    var courtField = document.createElement('div');
    courtField.className = 'field';
    var courtLabel = document.createElement('label');
    courtLabel.textContent = 'コート';
    courtField.appendChild(courtLabel);
    var courtNote = document.createElement('p');
    courtNote.className = 'field-note';
    // この文言が PC（desk-setup.js）の後半と違うのは意図（スマホの試合進行画面には
    // settings.courts の一覧を出していないため、PC 側の「試合進行にも出ます」に相当する
    // 一文が無い＝全体点検 B-26）。
    // B-26（スマホ試合進行に settings.courts を出す）を直すとき PC の文言に揃える。
    courtNote.textContent =
      'ここで足したコートは、選手が1人もいなくても選手登録のコート候補に出ます。' +
      '選手あり（灰色）のコートは選手のコート指定から決まったもので、ここでは外せません。';
    courtField.appendChild(courtNote);
    var courtList = document.createElement('div');
    courtList.className = 'court-list';
    courtField.appendChild(courtList);
    body.appendChild(courtField);

    function playerCourts() {
      return Courts.listFrom(players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    }
    function allCourts() {
      return Courts.listFrom(players, extra).filter(function(c) { return c !== Courts.UNASSIGNED; });
    }
    function renderCourts() {
      courtList.innerHTML = '';
      var fixed = playerCourts();
      var names = allCourts();
      if (names.length === 0) {
        var empty = document.createElement('span');
        empty.className = 'field-note';
        empty.textContent = 'コートがまだありません。';
        courtList.appendChild(empty);
      }
      names.forEach(function(c) {
        var hasPlayers = fixed.indexOf(c) !== -1;
        var item = document.createElement('span');
        item.className = 'court-item' + (hasPlayers ? ' fixed' : '');
        var label = document.createElement('span');
        label.textContent = hasPlayers ? (c + '（選手あり）') : c;
        item.appendChild(label);
        if (!hasPlayers && !locked) {
          var x = document.createElement('button');
          x.type = 'button';
          x.textContent = '×';
          x.setAttribute('aria-label', c + ' を外す');
          x.addEventListener('click', function() {
            var i = extra.indexOf(c);
            if (i !== -1) extra.splice(i, 1);
            renderCourts();
          });
          item.appendChild(x);
        }
        courtList.appendChild(item);
      });
    }
    renderCourts();

    if (!locked) {
      var btnAddCourt = document.createElement('button');
      btnAddCourt.type = 'button';
      btnAddCourt.className = 'btn-sub';
      btnAddCourt.textContent = '＋ コートを足す';
      btnAddCourt.addEventListener('click', function() {
        var name = prompt('コート名を入力してください（例: A）', '');
        if (name === null) return;
        name = String(name).trim();
        // 名前の規則はサーバーの PATCH と同じ（Courts.validateCourtList）。
        // 既にあるコートと合わせて検証するので、重複も件数超もここで弾ける。
        var err = Courts.validateCourtList(allCourts().concat([name]));
        if (err) { alert(err); return; }
        extra.push(name);
        renderCourts();
      });
      courtField.appendChild(btnAddCourt);
    }

    var btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'btn';
    btnCancel.textContent = '閉じる';
    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn primary';
    btnSave.textContent = '保存';

    if (locked) {
      inName.disabled = true;
      inDate.disabled = true;
      inVenue.disabled = true;
      chkBib.disabled = true;
      chkRank.disabled = true;
      btnSave.disabled = true;
    }

    var sheet = openSheet('基本情報', body, [btnCancel, btnSave]);
    btnCancel.addEventListener('click', sheet.close);

    btnSave.addEventListener('click', async function() {
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
      btnSave.disabled = true;
      sheet.lock(true);
      var result = await Api.updateEventInfo(eventId, {
        name: name, date: inDate.value, venue: inVenue.value.trim(),
        // finalCourt は空欄なら「既定（決戦）に戻す」意味（サーバーがキーごと落とす）。
        settings: {
          requireBib: chkBib.checked,
          requireRank: chkRank.checked,
          courts: extra.slice(),
          finalCourt: finalName
        }
      });
      // 保存中に大会を切り替えられていたら、もう閉じているシートを操作しない
      // （PC 運営 desk-setup.js の ctx.isStale() と同じ扱い）。
      sheet.lock(false);
      btnSave.disabled = false;
      if (currentEventId() !== eventId) return;
      if (!result || !result.ok) {
        if (result && result.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else {
          alert((result && result.error) || '保存できませんでした。通信を確認してください。');
        }
        return;
      }
      sheet.close();
      toast('基本情報を保存しました');
      await reloadEvent();
    });
  }

  // --- テーマ ---

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀' : '🌙';
  }

  // --- 起動 ---

  function init() {
    // test.html は admin.html の DOM を持たない。admin.js を読み込ませて
    // Admin.openSheet / closeAllSheets をテストするための早期リターン。
    if (!document.getElementById('tabContent')) return;
    content = document.getElementById('tabContent');
    applyTheme(Storage.loadTheme());
    document.getElementById('btnTheme').addEventListener('click', function() {
      var next = Storage.loadTheme() === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });
    document.getElementById('btnAdminMenu').addEventListener('click', openAdminMenu);

    // PC 運営へ。いま見ているタブに対応するハッシュを持っていく（storage.js の対応表）。
    var btnPc = document.getElementById('btnPc');
    if (btnPc) {
      btnPc.addEventListener('click', function() {
        Storage.saveMode('pc');
        location.href = Storage.modeHref(location.hash, 'pc');
      });
    }

    var btns = document.querySelectorAll('.tabbar button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function() {
        navigate(this.dataset.tab, selectedEventId);
      });
    }

    window.addEventListener('hashchange', function() { applyRoute().catch(function(e) { console.error(e); }); });
    applyRoute().catch(function(e) { console.error(e); });
  }

  // 各タブの登録（admin-events.js など）はスクリプト読み込み時に済むので、
  // DOMContentLoaded の時点では defs がそろっている。
  document.addEventListener('DOMContentLoaded', init);

  return {
    registerTab: registerTab,
    navigate: navigate,
    reloadEvent: reloadEvent,
    currentEventId: currentEventId,
    toast: toast,
    renderChips: renderChips,
    renderCourtChips: renderCourtChips,
    scoringHref: scoringHref,
    openSheet: openSheet,
    // シートを全部閉じる。ハッシュ遷移時に applyRoute が呼ぶ。テストからも使う。
    closeAllSheets: closeAllSheets
  };
})();
