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

  // 描画の再入ガード。Api.loadEvent の往復中にタブを切り替えられると、
  // 遅れて戻ってきた古い応答が新しい画面を上書きする。
  var renderSeq = 0;

  // --- タブ登録 ---

  // def = { render: function(container, ctx) }  render は async でもよい
  // ctx = { eventId, event, players }（events タブでは event / players は null）
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
      applyRoute();          // 同じハッシュでは hashchange が出ないので直接描く
    } else {
      location.hash = hash;  // hashchange → applyRoute
    }
  }

  async function applyRoute() {
    var route = parseHash(location.hash);
    if (!route) {
      // ハッシュが無いときは前回の続きから。それも無ければ大会一覧。
      var last = loadLast() || { tab: 'events', eventId: '' };
      navigate(last.tab, last.eventId);
      return;
    }
    if (route.tab !== 'events' && !route.eventId) {
      navigate('events');
      return;
    }

    currentTab = route.tab;
    selectedEventId = route.eventId || null;
    saveLast();
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
      navigate('events');
      return;
    }
    setTitle(ev.name || '試し斬り 運営');
    renderTab(seq, { eventId: selectedEventId, event: ev, players: ev.players || [] });
  }

  // 現在の大会を読み直して、いま開いているタブを描き直す
  async function reloadEvent() {
    if (!selectedEventId) return;
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
    await def.render(content, ctx);
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

  // --- テーマ ---

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀' : '🌙';
  }

  // --- 起動 ---

  function init() {
    content = document.getElementById('tabContent');
    applyTheme(Storage.loadTheme());
    document.getElementById('btnTheme').addEventListener('click', function() {
      var next = Storage.loadTheme() === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });

    var btns = document.querySelectorAll('.tabbar button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function() {
        navigate(this.dataset.tab, selectedEventId);
      });
    }

    window.addEventListener('hashchange', function() { applyRoute(); });
    applyRoute();
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
    renderCourtChips: renderCourtChips
  };
})();
