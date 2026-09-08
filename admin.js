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
  // ctx = { eventId, event, players, isStale }（events タブでは event / players は null）
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
      setTitle('試し斬り 運営');
      renderTab(seq, { eventId: null, event: null, players: null });
      return;
    }

    content.innerHTML = '';
    var loading = document.createElement('p');
    loading.className = 'empty';
    loading.textContent = '読み込み中…';
    content.appendChild(loading);

    var ev = await Api.loadEvent(selectedEventId);
    if (seq !== renderSeq) return;   // 追い越された
    if (!ev) {
      alert('大会データを取得できませんでした。通信を確認してください。');
      redirect('events');
      return;
    }
    saveLast();
    setTitle(ev.name || '試し斬り 運営');
    renderTab(seq, { eventId: selectedEventId, event: ev, players: ev.players || [] });
  }

  // 現在の大会を読み直して、いま開いているタブを描き直す
  async function reloadEvent() {
    if (currentTab === 'events' || !selectedEventId) return;
    var seq = ++renderSeq;
    var ev = await Api.loadEvent(selectedEventId);
    if (seq !== renderSeq) return;
    if (!ev) {
      alert('大会データを取得できませんでした。通信を確認してください。');
      return;
    }
    setTitle(ev.name || '試し斬り 運営');
    renderTab(seq, { eventId: selectedEventId, event: ev, players: ev.players || [] });
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

  // コート絞り込みのチップ列。「全コート」（court = ''）＋ Courts.listFrom の並び。
  // 選手タブと進行タブで共用する。
  function renderCourtChips(container, players, current, onChange) {
    container.innerHTML = '';
    var list = [''].concat(Courts.listFrom(players));
    list.forEach(function(c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = (c === (current || '')) ? 'court-chip on' : 'court-chip';
      if (c === '') b.textContent = '全コート';
      else if (c === Courts.UNASSIGNED) b.textContent = Courts.UNASSIGNED;
      else b.textContent = c + ' コート';
      b.dataset.court = c;
      b.addEventListener('click', function() {
        if (onChange) onChange(this.dataset.court);
      });
      container.appendChild(b);
    });
  }

  // 運営画面から他の画面へ戻る導線（下タブは運営画面内のタブなので、ページ間の移動はここに置く）
  function openAdminMenu() {
    var body = document.createElement('div');

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

    var btnRanking = document.createElement('button');
    btnRanking.type = 'button';
    btnRanking.className = 'menu-item';
    btnRanking.textContent = '🏆 順位表示';
    body.appendChild(btnRanking);

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn';
    btnClose.textContent = '閉じる';

    var sheet = openSheet('メニュー', body, [btnClose]);
    btnClose.addEventListener('click', sheet.close);

    btnScoring.addEventListener('click', function() { location.href = 'index.html'; });
    btnTechniques.addEventListener('click', function() { location.href = 'techniques.html'; });
    btnRanking.addEventListener('click', function() { location.href = 'ranking.html'; });
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
    renderCourtChips: renderCourtChips,
    openSheet: openSheet,
    // シートを全部閉じる。ハッシュ遷移時に applyRoute が呼ぶ。テストからも使う。
    closeAllSheets: closeAllSheets
  };
})();
