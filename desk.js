// PC 運営画面（desk.html）の骨組み。
// 区画の中身は desk-events.js / desk-setup.js / desk-techniques.js /
// desk-players.js / desk-match.js / desk-results.js が Desk.registerTab で登録する。
// 構造はスマホ運営の admin.js と同じ（registerTab / applyRoute / renderSeq /
// ctx.isStale / 控え / reloadEvent / トースト / 共通ダイアログ）。違うのはハッシュと見た目だけ。
//
// ハッシュ体系: #events / #setup/<id> / #techniques/<id> / #players/<id> / #match/<id> / #results/<id>
// 選択中の大会は localStorage の tmg_desk_last に控える（スマホ運営の tmg_admin_last、
// 採点画面の tmg_last とは分ける。別の端末で別の大会を見ていることがある）。
var Desk = (function() {
  var LAST_KEY = 'tmg_desk_last';
  var NAV = [
    { tab: 'events',     label: '大会一覧' },
    { tab: 'setup',      label: '基本情報' },
    { tab: 'techniques', label: '技と配点' },
    { tab: 'players',    label: '選手' },
    { tab: 'match',      label: '試合' },
    { tab: 'results',    label: '結果' }
  ];
  var TABS = NAV.map(function(n) { return n.tab; });

  // 上部に並べる段階。archived は並べない（アーカイブは final の「次へ進む」で、
  // 戻すときは prev が final を返す）。
  var STAGE_STEPS = ['draft', 'round1', 'round1_done', 'round2', 'round2_done', 'final'];

  var defs = {};
  var activeDef = null;    // いま描いている区画（DOM から外す前に destroy を呼ぶ）
  var main = null, head = null, nav = null;
  var currentTab = 'events';
  var selectedEventId = null;
  var currentEvent = null;   // 最後に読んだ大会（上部の見出しと段階表示が使う）
  var toastTimer = null;

  // 開いているダイアログのハンドル。ハッシュ遷移で古い ctx のまま残らないよう、
  // ルートが変わったら全部閉じる。
  var openDialogs = [];

  // 描画の再入ガード。Api.loadEvent の往復中に区画を切り替えられると、
  // 遅れて戻ってきた古い応答が新しい画面を上書きする。
  var renderSeq = 0;

  // --- 区画の登録 ---

  // def = { render: function(container, ctx), destroy: function()（省略可） }
  // ctx = { eventId, event, players, techniques, isStale }
  //   （events の区画では event / players / techniques は null）
  // ctx.isStale() — await の直後に見て true なら描画をやめる（alert も出さない）
  // destroy()     — その区画が DOM から外れる直前に呼ぶ後始末
  //                 （開きっぱなしのシートを閉じる、遅れて戻る応答を無視する、など）
  function registerTab(name, def) {
    defs[name] = def;
  }

  function destroyActive() {
    var def = activeDef;
    activeDef = null;
    if (def && typeof def.destroy === 'function') {
      try { def.destroy(); } catch (e) { console.error(e); }
    }
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
      applyRoute().catch(function(e) { console.error(e); });   // 同じハッシュでは hashchange が出ない
    } else {
      location.hash = hash;   // hashchange → applyRoute
    }
  }

  // ユーザー操作を経ない自動の戻し用。履歴に積まない
  // （戻るボタンで #setup → #events → #setup … と往復してしまう）。
  function redirect(tab, eventId) {
    var id = (eventId === undefined || eventId === null) ? selectedEventId : eventId;
    var hash = buildHash(tab, id);
    if (location.hash === hash) {
      applyRoute().catch(function(e) { console.error(e); });
    } else {
      location.replace(location.pathname + location.search + hash);
    }
  }

  async function applyRoute() {
    closeAllDialogs();
    destroyActive();
    // ダイアログの onClose が起動する reloadEvent を、これから描く画面より古い扱いにする
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
    if (currentTab === 'events') {
      currentEvent = null;
      saveLast();
    }
    renderNav();

    var seq = ++renderSeq;
    if (currentTab === 'events') {
      renderHead(null);
      renderTab(seq, { eventId: null, event: null, players: null, techniques: null });
      return;
    }

    main.innerHTML = '';
    var loading = document.createElement('p');
    loading.className = 'desk-empty';
    loading.textContent = '読み込み中…';
    main.appendChild(loading);

    var ev = await Api.loadEvent(selectedEventId);
    if (seq !== renderSeq) return;   // 追い越された
    if (!ev) {
      alert('大会データを取得できませんでした。通信を確認してください。');
      redirect('events');
      return;
    }
    currentEvent = ev;
    saveLast();
    renderHead(ev);
    renderTab(seq, {
      eventId: selectedEventId, event: ev, players: ev.players || [],
      techniques: Array.isArray(ev.techniques) ? ev.techniques : null
    });
  }

  // 現在の大会を読み直して、いま開いている区画を描き直す
  async function reloadEvent() {
    if (currentTab === 'events' || !selectedEventId) return;
    var seq = ++renderSeq;
    var ev = await Api.loadEvent(selectedEventId);
    if (seq !== renderSeq) return;
    if (!ev) {
      alert('大会データを取得できませんでした。通信を確認してください。');
      return;
    }
    currentEvent = ev;
    renderHead(ev);
    renderTab(seq, {
      eventId: selectedEventId, event: ev, players: ev.players || [],
      techniques: Array.isArray(ev.techniques) ? ev.techniques : null
    });
  }

  async function renderTab(seq, ctx) {
    destroyActive();
    var def = defs[currentTab];
    main.innerHTML = '';
    if (!def) {
      var p = document.createElement('p');
      p.className = 'desk-empty';
      p.textContent = 'この区画はまだ準備中です。';
      main.appendChild(p);
      return;
    }
    activeDef = def;
    // 区画の render が await をまたぐ間に区画や大会を切り替えられたかどうか。
    // 各区画は await の直後にこれを見て、古ければ描画をやめる。
    ctx.isStale = function() { return seq !== renderSeq; };
    try {
      await def.render(main, ctx);
    } catch (e) {
      if (seq !== renderSeq) return;   // 古い描画の失敗は無視する
      console.error(e);
      main.innerHTML = '';
      var err = document.createElement('p');
      err.className = 'desk-empty';
      err.textContent = '画面の表示に失敗しました。区画を選び直してください。';
      main.appendChild(err);
    }
  }

  function currentEventId() {
    return selectedEventId || null;
  }

  // --- 画面の共通部品 ---

  // 上部の大会の見出し。大会一覧では隠す。
  function renderHead(event) {
    head.innerHTML = '';
    if (!event) {
      head.hidden = true;
      return;
    }
    head.hidden = false;
    var line = document.createElement('div');
    line.className = 'desk-head-line';
    var name = document.createElement('span');
    name.className = 'desk-head-name';
    name.textContent = event.name || '(名称未設定)';
    var meta = document.createElement('span');
    meta.className = 'desk-head-meta';
    meta.textContent = (event.date || '日付なし') + '　' + (event.venue || '会場未設定');
    line.appendChild(name);
    line.appendChild(meta);
    head.appendChild(line);
    head.appendChild(buildStage(EventStatus.of(event), event.players || []));
  }

  // 段階の帯。現在の状態を強調し、通過した状態を塗る。右に「戻す」「次へ進む」。
  function buildStage(st, players) {
    var wrap = document.createElement('div');
    wrap.className = 'desk-stage';

    var steps = document.createElement('div');
    steps.className = 'desk-stage-steps';
    var cur = STAGE_STEPS.indexOf(st);   // archived は -1（全部を通過済みとして塗る）
    STAGE_STEPS.forEach(function(s, i) {
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'desk-stage-sep';
        sep.textContent = '─';
        steps.appendChild(sep);
      }
      var el = document.createElement('span');
      el.className = 'desk-stage-step' +
        (s === st ? ' on' : '') +
        ((cur === -1 || i < cur) ? ' done' : '');
      el.textContent = (s === st ? '●' : '○') + EventStatus.LABELS[s];
      steps.appendChild(el);
    });
    wrap.appendChild(steps);

    if (st === 'archived') {
      var badge = document.createElement('span');
      badge.className = 'desk-stage-archived';
      badge.textContent = EventStatus.LABELS.archived;
      wrap.appendChild(badge);
    }

    var count = document.createElement('span');
    count.className = 'desk-stage-count';
    count.id = 'deskStageCount';
    count.textContent = Courts.stageCountText(st, players);
    wrap.appendChild(count);

    var actions = document.createElement('div');
    actions.className = 'desk-stage-actions';

    var back = EventStatus.prev(st, players);
    if (back) {
      var btnBack = document.createElement('button');
      btnBack.type = 'button';
      btnBack.className = 'desk-btn';
      btnBack.id = 'btnDeskBack';
      btnBack.textContent = '◀ ' + EventStatus.LABELS[back] + ' に戻す';
      btnBack.addEventListener('click', function() { applyStatus(st, back); });
      actions.appendChild(btnBack);
    }

    // 二巡目を行わずに最終結果へ（一巡目終了のときだけ）
    if (st === 'round1_done') {
      var btnSkip = document.createElement('button');
      btnSkip.type = 'button';
      btnSkip.className = 'desk-btn';
      btnSkip.id = 'btnDeskSkipRound2';
      btnSkip.textContent = '二巡目なしで終了';
      btnSkip.addEventListener('click', function() { applyStatus(st, 'final'); });
      actions.appendChild(btnSkip);
    }

    var nx = EventStatus.next(st);
    if (nx) {
      var btnNext = document.createElement('button');
      btnNext.type = 'button';
      btnNext.className = 'desk-btn primary';
      btnNext.id = 'btnDeskNext';
      btnNext.textContent = EventStatus.NEXT_LABELS[st] + ' ▶';
      btnNext.addEventListener('click', function() { applyStatus(st, nx); });
      actions.appendChild(btnNext);
    }
    wrap.appendChild(actions);
    return wrap;
  }

  // 状態を変える。確認文言は courts.js（スマホ運営と共通）。
  // 失敗の理由はサーバーの文言をそのまま出し、読み直す
  // （transition の 409 は他の端末が先に進めていた場合）。
  async function applyStatus(from, to) {
    var eventId = selectedEventId;
    var players = (currentEvent && currentEvent.players) || [];
    if (!eventId) return;
    if (!confirm(Courts.statusConfirmMessage(from, to, players))) return;
    var seq = renderSeq;
    var res = await Api.changeStatus(eventId, to);
    if (seq !== renderSeq || selectedEventId !== eventId) return;   // 通信中に画面を離れた
    if (!res) {
      alert('状態を変えられませんでした。通信を確認してください。');
      return;
    }
    if (!res.ok) {
      alert(res.error);
      await reloadEvent();   // 他の端末が先に進めていた可能性がある
      return;
    }
    toast(EventStatus.LABELS[to] + ' にしました');
    // 試合開始に成功したら、コート端末で使う採点画面を別ウィンドウで開く
    if (from === 'draft' && to === 'round1') openScoring(eventId, '');
    await reloadEvent();
  }

  function renderNav() {
    nav.innerHTML = '';
    NAV.forEach(function(item, i) {
      if (i === 1) {
        var sep = document.createElement('div');
        sep.className = 'desk-nav-sep';
        nav.appendChild(sep);
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = (item.tab === currentTab) ? 'on' : '';
      b.textContent = item.label;
      // 大会を開くまでは大会一覧しか使えない（どの大会を描くのか決まらない）
      if (item.tab !== 'events' && !selectedEventId) {
        b.disabled = true;
        b.title = '大会一覧から大会を開いてください';
      } else {
        b.addEventListener('click', function() { navigate(item.tab, selectedEventId); });
      }
      nav.appendChild(b);
    });
  }

  function toast(msg) {
    var el = document.getElementById('deskToast');
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.hidden = true; }, 2000);
  }

  // 共通ダイアログ（新規作成・コピーなど）。スマホ運営の Admin.openSheet と同じ契約。
  // onClose はどの経路で閉じても（✕・外側クリック・close()・closeAllDialogs()）1回だけ呼ばれる。
  // onClose の中でサーバーに書き込まないこと（古い ctx で書いてしまう）。
  // 戻り値: { close, lock }
  //   close()    : 閉じる
  //   lock(flag) : true の間は ✕ と外側クリックで閉じない（保存の通信中に入力を失わないため）
  function openDialog(titleText, bodyEl, buttons, onClose) {
    var overlay = document.createElement('div');
    overlay.className = 'desk-dialog-overlay';
    var box = document.createElement('div');
    box.className = 'desk-dialog';

    var headEl = document.createElement('div');
    headEl.className = 'desk-dialog-head';
    var title = document.createElement('span');
    title.textContent = titleText;
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'desk-dialog-close';
    btnClose.textContent = '✕';
    headEl.appendChild(title);
    headEl.appendChild(spacer);
    headEl.appendChild(btnClose);

    var body = document.createElement('div');
    body.className = 'desk-dialog-body';
    body.appendChild(bodyEl);

    var actions = document.createElement('div');
    actions.className = 'desk-dialog-actions';
    buttons.forEach(function(b) { actions.appendChild(b); });

    box.appendChild(headEl);
    box.appendChild(body);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var closed = false;
    var locked = false;
    function close() {
      if (closed) return;
      closed = true;
      var i = openDialogs.indexOf(handle);
      if (i >= 0) openDialogs.splice(i, 1);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
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
    openDialogs.push(handle);
    return handle;
  }

  // 戻るボタンなどでハッシュが変わったら、前の画面のダイアログを残さない
  // （古い ctx で保存してしまう）。lock 中でも問答無用で閉じる。
  function closeAllDialogs() {
    openDialogs.slice().forEach(function(d) { d.close(); });
  }

  // 採点画面のハッシュ（route.js の Route.build と同じ形。desk.html は route.js を読まない）。
  // ★計画3で採点画面を scoring.html に改名する。そのときここの 'index.html' を
  //   'scoring.html' に直すこと。PC 運営で採点画面の URL を知っているのはこの関数だけ。
  function scoringHref(eventId, court) {
    if (!eventId) return 'index.html';
    var hash = '#event/' + encodeURIComponent(eventId);
    if (court) hash += '/' + encodeURIComponent(court);
    return 'index.html' + hash;
  }

  // 採点画面を別ウィンドウで開く。コートごとに窓の名前を変え、同じコートは同じ窓を使い回す。
  // ポップアップが塞がれていたら（戻り値 null）開き直し方を案内する。
  function openScoring(eventId, court) {
    var name = court ? 'tmg_scoring_' + court : 'tmg_scoring';
    var w = window.open(scoringHref(eventId, court), name);
    if (!w) {
      alert('採点画面を開けませんでした。\nポップアップを許可するか、「試合」の区画から開いてください。');
    }
    return w;
  }

  // --- テーマとモード ---

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀' : '🌙';
  }

  // スマホ運営へ。いま見ている区画に対応するハッシュを持っていく（storage.js の対応表）。
  function toMobile() {
    Storage.saveMode('mobile');
    location.href = Storage.modeHref(location.hash, 'mobile');
  }

  // --- 起動 ---

  function init() {
    // test.html は desk.html の DOM を持たない。desk.js を読み込ませても落ちないようにする。
    if (!document.getElementById('deskMain')) return;
    main = document.getElementById('deskMain');
    head = document.getElementById('deskHead');
    nav = document.getElementById('deskNav');

    applyTheme(Storage.loadTheme());
    document.getElementById('btnTheme').addEventListener('click', function() {
      var next = Storage.loadTheme() === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });
    document.getElementById('btnMobile').addEventListener('click', toMobile);
    document.getElementById('btnNarrowSwitch').addEventListener('click', toMobile);

    window.addEventListener('hashchange', function() { applyRoute().catch(function(e) { console.error(e); }); });
    applyRoute().catch(function(e) { console.error(e); });
  }

  // 各区画の登録（desk-events.js など）はスクリプト読み込み時に済むので、
  // DOMContentLoaded の時点では defs がそろっている。
  document.addEventListener('DOMContentLoaded', init);

  return {
    registerTab: registerTab,
    navigate: navigate,
    reloadEvent: reloadEvent,
    currentEventId: currentEventId,
    toast: toast,
    openDialog: openDialog,
    closeAllDialogs: closeAllDialogs,
    scoringHref: scoringHref,
    openScoring: openScoring
  };
})();
