// トップページ（index.html）の制御。
// ・改名前（index.html が採点画面だった頃）のブックマークを scoring.html へ転送する
// ・入口ボタンの行き先（運営画面は PC / スマホのモードで変わる）
// ・進行中の大会の一覧
// このファイルは test.html からも読まれる。DOM を持たないページで落ちないよう、
// 描画は init で #homeMain の有無を見てから行い、転送は index.html から明示的に呼ぶ。
var Home = (function() {

  // --- 転送（純粋関数）---

  // 採点画面へ転送すべきハッシュなら転送先の URL、そうでなければ null。
  // ハッシュの解釈は route.js に任せる（壊れたパーセントエンコーディングでも例外を投げない）。
  // 戻り値は受け取ったハッシュをそのまま繋ぐ。Route.build で組み直すと
  // すでにエンコード済みの大会IDが二重にエンコードされる。
  function redirectTarget(hash) {
    var h = String(hash == null ? '' : hash);
    if (!Route.parse(h)) return null;
    return 'scoring.html' + h;
  }

  // 実際に転送する。index.html の <head> から呼ぶ（本文を描く前に抜けるため）。
  // history に残さないよう replace を使う（戻るボタンで転送が繰り返されない）。
  function redirectIfScoring() {
    var to = redirectTarget(location.hash);
    if (!to) return false;
    location.replace(to);
    return true;
  }

  // --- 大会の並び（純粋関数）---

  // 設計書「画面設計 > トップ」の並び順。小さいほど上。
  //   0: 採点できる状態（一巡目 / 二巡目 進行中）
  //   1: 準備中・一巡目終了・二巡目終了（運営の手が要る）
  //   2: 最終結果（終わっている）
  function statusRank(status) {
    if (EventStatus.isScoringOpen(status)) return 0;
    if (status === 'final') return 2;
    return 1;
  }

  // 進行中の大会の一覧を並べ替える。アーカイブは除く。
  // 同じ段の中は updatedAt の新しい順、それも同じなら元の順（Array#sort は
  // 実装によって不安定なので、添字を持って同着の順を固定する）。
  // 元の配列は書き換えない。
  function sortForHome(events) {
    var rows = [];
    (events || []).forEach(function(ev, i) {
      var status = EventStatus.of(ev);
      if (status === 'archived') return;
      rows.push({ ev: ev, i: i, rank: statusRank(status) });
    });
    rows.sort(function(a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      var x = String(a.ev.updatedAt || ''), y = String(b.ev.updatedAt || '');
      if (x !== y) return x < y ? 1 : -1;
      return a.i - b.i;
    });
    return rows.map(function(r) { return r.ev; });
  }

  // --- 描画 ---

  // 「全体の流れ」の帯に添える一言。ラベル自体は EventStatus.LABELS から取るので
  // ここでは文言を二重定義しない（一言は EventStatus には無い情報なのでここだけに持つ）。
  var FLOW_CAPTIONS = {
    draft: '大会を作る・選手登録',
    round1: 'コート端末で採点',
    round1_done: '二巡目を生成・技入力',
    round2: 'コート端末で採点',
    round2_done: '順位を確認',
    final: '発表・共有',
    archived: '保管'
  };

  // 「全体の流れ」= 7段階を横一列の帯で出す（desk.js の上部の段階表示と同じ調子）。
  // 状態そのものは変わらない静的な内容なので、DOMContentLoaded で一度だけ描く。
  function renderFlow() {
    var band = document.getElementById('homeFlowBand');
    if (!band) return;
    band.innerHTML = '';
    band.setAttribute('role', 'list');
    band.setAttribute('aria-label', '大会の状態（7段階）');

    EventStatus.STATES.forEach(function(s, i) {
      var step = document.createElement('div');
      step.className = 'home-flow-step' + (s === 'final' ? ' key' : '');
      step.setAttribute('role', 'listitem');

      var num = document.createElement('span');
      num.className = 'home-flow-num';
      num.setAttribute('aria-hidden', 'true');
      num.textContent = String(i + 1);

      var label = document.createElement('div');
      label.className = 'home-flow-label';
      label.textContent = EventStatus.LABELS[s];

      var caption = document.createElement('div');
      caption.className = 'home-flow-caption';
      caption.textContent = FLOW_CAPTIONS[s] || '';

      step.appendChild(num);
      step.appendChild(label);
      step.appendChild(caption);
      band.appendChild(step);
    });
  }

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀' : '🌙';
  }

  // 🖥/📱 ボタン。いまのモードの「相手」を出す（スマホモードなら 🖥 ＝ PC へ）。
  // トップ自体の見た目はモードで変わらない。変わるのは運営画面へのリンクの行き先だけなので、
  // 押しても他のページへは移らず、控えとボタンとリンクだけを差し替える
  // （admin.html / desk.html のボタンは相手のページへ移る。そこだけ挙動が違う）。
  function applyMode() {
    var toPc = (Storage.currentMode() !== 'pc');
    var btn = document.getElementById('btnMode');
    var label = toPc ? 'PC 運営に切り替える' : 'スマホ運営に切り替える';
    btn.textContent = toPc ? '🖥' : '📱';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    updateAdminLinks();
  }

  function onModeClick() {
    Storage.saveMode(Storage.currentMode() === 'pc' ? 'mobile' : 'pc');
    applyMode();
  }

  // 運営画面へ向かうリンクの行き先をいまのモードで作り直す。
  // 大会の行は描き直さず href だけ差し替える（読み込み中の一覧を消さないため）。
  function updateAdminLinks() {
    var link = document.getElementById('linkAdmin');
    if (link) link.href = Storage.adminHref('#events');
    var rows = document.querySelectorAll('[data-event-id]');
    for (var i = 0; i < rows.length; i++) {
      rows[i].href = Storage.adminHref('#players/' + encodeURIComponent(rows[i].getAttribute('data-event-id')));
    }
  }

  // --- 進行中の大会 ---

  // 読み込みの世代。あとから始めた読み込みが先に返ることがあるので、
  // 古い応答では DOM に触らない（他の画面の renderSeq と同じ作法）。
  var listSeq = 0;

  async function loadEvents() {
    var seq = ++listSeq;
    var box = document.getElementById('homeEventList');
    box.textContent = '読み込み中…';
    var events = await Api.listEvents();
    if (seq !== listSeq) return;
    // Api.listEvents は通信に失敗すると null、大会が 0 件なら [] を返す。区別して出す。
    if (events === null) {
      renderNote(box, '大会の一覧を取得できませんでした。通信を確かめて、画面を読み込み直してください。');
      return;
    }
    renderEvents(box, sortForHome(events));
  }

  function renderNote(box, text) {
    box.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'home-note';
    p.textContent = text;
    box.appendChild(p);
  }

  function renderEvents(box, list) {
    if (list.length === 0) {
      renderNote(box, '進行中の大会はありません。「運営画面を開く」から作成してください。');
      return;
    }
    box.innerHTML = '';
    list.forEach(function(ev) {
      var status = EventStatus.of(ev);

      // 行はリンクにする（中クリックで別タブに開ける。行き先はモードで変わるので
      // data-event-id を持たせ、updateAdminLinks が href だけ作り直す）。
      var a = document.createElement('a');
      a.className = 'home-event';
      a.setAttribute('data-event-id', ev.id);
      a.href = Storage.adminHref('#players/' + encodeURIComponent(ev.id));

      var name = document.createElement('span');
      name.className = 'home-event-name';
      name.textContent = ev.name || '(名称未設定)';

      var meta = document.createElement('span');
      meta.className = 'home-event-meta';
      meta.textContent = (ev.date || '日付なし') + ' ・ ' + (ev.playerCount || 0) + '名';

      var badge = document.createElement('span');
      badge.className = 'home-badge' + (EventStatus.isScoringOpen(status) ? ' on' : '');
      badge.textContent = EventStatus.LABELS[status];

      a.appendChild(name);
      a.appendChild(meta);
      a.appendChild(badge);
      box.appendChild(a);
    });
  }

  // --- 起動 ---

  function init() {
    // test.html もこのファイルを読む。トップの DOM が無ければ何もしない。
    if (!document.getElementById('homeMain')) return;
    applyTheme(Storage.loadTheme());
    document.getElementById('btnTheme').addEventListener('click', function() {
      var next = Storage.loadTheme() === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });
    document.getElementById('btnMode').addEventListener('click', onModeClick);
    applyMode();
    renderFlow();
    loadEvents().catch(function(e) { console.error(e); });
    // トップを開いたままハッシュだけ書き換えられても転送する（採点画面のURLを
    // 誤って共有・ブックマークされた場合など）。index.html の <head> での
    // 呼び出しはページ読み込み時の 1 回だけなので、それとは別に効かせる。
    window.addEventListener('hashchange', Home.redirectIfScoring);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    redirectTarget: redirectTarget,
    redirectIfScoring: redirectIfScoring,
    sortForHome: sortForHome
  };
})();
