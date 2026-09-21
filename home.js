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

  // --- 作成画面の材料（純粋関数）---

  // 「前回の大会」= 作成画面の「前回の大会をコピー」が元にする 1 件。
  // テスト大会（test）とアーカイブ済みは選ばない（前者は本物でなく、後者は片づけた大会なので、
  // 「前回」として勝手に選ぶと事故になる）。該当が無ければ null で、画面はその項目を出さない。
  // 同着（updatedAt が同じ）は先に出てきた方を残す。元の配列は書き換えない。
  function pickPrevious(events) {
    var best = null;
    (events || []).forEach(function(ev) {
      if (!ev || ev.test === true) return;
      if (EventStatus.of(ev) === 'archived') return;
      if (!best || String(ev.updatedAt || '') > String(best.updatedAt || '')) best = ev;
    });
    return best;
  }

  // テンプレートの表示名と 1 行説明。作る中身はサーバー（POST /api/events/from-template）が
  // 決めるので、ここに持つのは画面に出す文言だけ。知らない名前なら null。
  // 'constructor' などプロトタイプの名前で拾わないよう hasOwnProperty で引く。
  var TEMPLATES = {
    practice:   { name: '稽古用',          description: '技と配点は雛形のまま。コートは「稽古」の 1 つだけ。選手はあとから登録します。' },
    tournament: { name: '大会用',          description: '技と配点は雛形のまま。コートは A・B の 2 つ。ゼッケン番号を必須にします。' },
    systest:    { name: 'システムテスト用', description: 'ダミーの選手 20 名（男女 10 名ずつ・技入り）で、採点から発表まで試せます。一覧では既定で隠れます。' }
  };

  function templateSpec(template) {
    var key = String(template == null ? '' : template);
    if (!Object.prototype.hasOwnProperty.call(TEMPLATES, key)) return null;
    return { name: TEMPLATES[key].name, description: TEMPLATES[key].description };
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

  // --- 区画の出し分け ---

  // ハッシュから出す区画を決める。知らないハッシュは入口に落とす。
  //   '' / '#' → 'home'、'#new' → 'new'、'#list' → 'list'
  // '#event/…' はここに来ない（applyRoute の先頭で採点画面へ転送する）。
  function paneFor(hash) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    if (raw === 'new') return 'new';
    if (raw === 'list') return 'list';
    return 'home';
  }

  function showPane(id, on) {
    var el = document.getElementById(id);
    if (!el) return;
    if (on) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  // ハッシュが変わるたびに呼ぶ。転送の判定が最優先（採点画面の URL を誤って
  // 共有・ブックマークされたとき、入口や一覧を一瞬でも見せない）。
  function applyRoute() {
    if (redirectIfScoring()) return;
    var pane = paneFor(location.hash);
    showPane('paneHome', pane === 'home');
    showPane('paneList', pane === 'list');
    showPane('paneNew', pane === 'new');
    if (pane === 'list') loadEvents().catch(function(e) { console.error(e); });
    if (pane === 'new') openNew();
  }

  // --- 大会を新規作成（#new）---

  // 読み込みの世代とキャッシュは #list の節で宣言（#list と #new のどちらも
  // 一覧を使うので、世代は 1 つで足りる）。
  var eventsSeq = 0;
  var eventsCache = null;   // 直近に取れた一覧。null は「まだ取れていない・取れなかった」

  // 1 段目で選ぶ「経路」。2 段目のフォームの中身がこれで変わる。
  //   'copy-prev'  前回の大会をコピー（Home.pickPrevious が選んだ 1 件）
  //   'template'   テンプレートから（newTemplate に practice / tournament / systest）
  //   'copy-pick'  作成済みの大会からコピー（2 段目のセレクトで選ぶ）
  //   'blank'      完全新規
  var newRoute = '';
  var newTemplate = '';
  var copySource = '';      // コピー元の大会ID

  var TEMPLATE_ORDER = ['practice', 'tournament', 'systest'];

  // #new に入るたびに 1 段目から始める（前に開いたときの選択を引きずらない）。
  function openNew() {
    newRoute = '';
    newTemplate = '';
    copySource = '';
    renderNew();
  }

  function renderNew() {
    var box = document.getElementById('newBody');
    box.innerHTML = '';
    if (!newRoute) { renderNewStep1(box).catch(function(e) { console.error(e); }); return; }
    if (newRoute === 'template' && !newTemplate) { renderNewTemplates(box); return; }
    renderNewForm(box);
  }

  // 押せるカード 1 枚。
  function newCard(main, sub, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'home-card';
    var m = document.createElement('span');
    m.className = 'home-card-main';
    m.textContent = main;
    var s = document.createElement('span');
    s.className = 'home-card-sub';
    s.textContent = sub;
    b.appendChild(m);
    b.appendChild(s);
    b.addEventListener('click', onClick);
    return b;
  }

  // 1 段目。「前回の大会をコピー」と「作成済みの大会からコピー」は一覧が要るので、
  // 4 枚とも取れてからまとめて描く（先に 2 枚だけ出すと並びが崩れる）。
  async function renderNewStep1(box) {
    var loading = document.createElement('p');
    loading.className = 'home-note';
    loading.textContent = '読み込み中…';
    box.appendChild(loading);

    var seq = ++eventsSeq;
    var events = await Api.listEvents();
    if (seq !== eventsSeq) return;
    if (paneFor(location.hash) !== 'new' || newRoute) return;   // 待っている間に画面が変わった
    eventsCache = events;
    box.innerHTML = '';

    if (events === null) {
      // 通信に失敗しても、コピーを使わない 2 枚は使える。作成そのものは進められる。
      var warn = document.createElement('p');
      warn.className = 'home-note';
      warn.textContent = 'コピー元にできる大会を取得できませんでした。テンプレートと完全新規は使えます。';
      box.appendChild(warn);
      events = [];
    }

    var cards = document.createElement('div');
    cards.className = 'home-cards';
    box.appendChild(cards);

    var prev = pickPrevious(events);
    if (prev) {
      cards.appendChild(newCard('前回の大会をコピー',
        '「' + (prev.name || '(名称未設定)') + '」の技・配点・コートを引き継ぎます。',
        function() { newRoute = 'copy-prev'; copySource = prev.id; renderNew(); }));
    }

    cards.appendChild(newCard('テンプレートから',
      '稽古用・大会用・システムテスト用の雛形から作ります。',
      function() { newRoute = 'template'; renderNew(); }));

    if (copyableEvents(events).length > 0) {
      cards.appendChild(newCard('作成済みの大会からコピー',
        '元にする大会を選びます（アーカイブ済みも選べます）。',
        function() { newRoute = 'copy-pick'; copySource = ''; renderNew(); }));
    }

    cards.appendChild(newCard('完全新規',
      '名前・日付・会場だけの空の大会を作ります。技と配点は雛形から入ります。',
      function() { newRoute = 'blank'; renderNew(); }));
  }

  // 1 段目でテンプレートを選んだあとの 3 枚。文言は Home.templateSpec に持つ。
  function renderNewTemplates(box) {
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'home-btn-sub';
    back.textContent = '← 選び直す';
    back.addEventListener('click', function() { newRoute = ''; renderNew(); });
    box.appendChild(back);

    var cards = document.createElement('div');
    cards.className = 'home-cards';
    box.appendChild(cards);

    TEMPLATE_ORDER.forEach(function(key) {
      var spec = templateSpec(key);
      cards.appendChild(newCard(spec.name, spec.description, function() {
        newTemplate = key;
        renderNew();
      }));
    });
  }

  var newFieldSeq = 0;

  function addField(form, labelText, type) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = type;
    input.id = 'nf_' + (++newFieldSeq);
    label.htmlFor = input.id;
    label.textContent = labelText;
    form.appendChild(label);
    form.appendChild(input);
    return input;
  }

  function addSelect(form, labelText) {
    var label = document.createElement('label');
    var sel = document.createElement('select');
    sel.id = 'nf_' + (++newFieldSeq);
    label.htmlFor = sel.id;
    label.textContent = labelText;
    form.appendChild(label);
    form.appendChild(sel);
    return sel;
  }

  function findEvent(id) {
    var found = (eventsCache || []).filter(function(ev) { return ev.id === id; });
    return found.length ? found[0] : null;
  }

  // 「作成済みの大会からコピー」の候補。テスト大会（test）は本物でないのでコピー元にしない。
  function copyableEvents(events) {
    return (events || []).filter(function(ev) { return ev && ev.test !== true; });
  }

  // フォームの世代。「作成」を押して通信を待っている間に「← 選び直す」で戻られたら、
  // 遅れて届いた結果に対して alert も遷移もしない（戻った後の画面を汚さない）。
  var formSeq = 0;

  // 2 段目。4 経路で違うのは「注記」「コピー元のセレクト」「選手も複製するのチェック」
  // 「作成のときに呼ぶ API」の 4 つだけ。ほかは共通。
  function renderNewForm(box) {
    var mySeq = ++formSeq;
    var isCopy = (newRoute === 'copy-prev' || newRoute === 'copy-pick');

    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'home-btn-sub';
    back.textContent = '← 選び直す';
    back.addEventListener('click', function() {
      formSeq++;   // このフォームは無効に（通信中の結果が届いても無視する）
      // テンプレートの 3 枚から来たときは 3 枚に戻す（4 枚まで戻さない）
      if (newRoute === 'template') newTemplate = '';
      else newRoute = '';
      renderNew();
    });
    box.appendChild(back);

    var title = document.createElement('p');
    title.className = 'home-card-main';
    title.textContent = formTitle();
    box.appendChild(title);

    var note = document.createElement('p');
    note.className = 'home-note';
    note.textContent = formNote();
    box.appendChild(note);

    var form = document.createElement('div');
    form.className = 'home-form';
    box.appendChild(form);

    // コピー元のセレクト（「作成済みの大会からコピー」だけ）。
    // 並びは一覧と同じにせず、更新の新しい順にする（探しやすさを優先）。
    var selSrc = null;
    if (newRoute === 'copy-pick') {
      selSrc = addSelect(form, 'コピー元の大会');
      copyableEvents(eventsCache).slice().sort(function(a, b) {
        var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
        if (x === y) return 0;
        return x < y ? 1 : -1;
      }).forEach(function(ev) {
        var o = document.createElement('option');
        o.value = ev.id;
        o.textContent = (ev.name || '(名称未設定)') + '（' + (ev.date || '日付なし') + '・' +
          (ev.playerCount || 0) + '名）';
        selSrc.appendChild(o);
      });
      copySource = selSrc.value;
    }

    var inName = addField(form, '大会名', 'text');
    var inDate = addField(form, '日付', 'date');
    var inVenue = addField(form, '会場', 'text');
    inDate.value = Storage.todayLocal();

    // コピーは元の大会から初期値を引く（desk-events.js の openCopyDialog と同じ）。
    function fillFromSource() {
      var src = findEvent(copySource);
      if (!src) return;
      inName.value = (src.name || '(名称未設定)') + '（コピー）';
      inVenue.value = src.venue || '';
    }
    if (isCopy) fillFromSource();
    if (selSrc) {
      selSrc.addEventListener('change', function() {
        copySource = selSrc.value;
        fillFromSource();
      });
    }

    var cbPlayers = null;
    if (isCopy) {
      var check = document.createElement('label');
      check.className = 'home-form-check';
      cbPlayers = document.createElement('input');
      cbPlayers.type = 'checkbox';
      cbPlayers.checked = true;
      check.appendChild(cbPlayers);
      check.appendChild(document.createTextNode(' 選手も複製する（一巡目の行だけ。得点は消えます）'));
      form.appendChild(check);
    }

    var actions = document.createElement('div');
    actions.className = 'home-form-actions';
    var btnCreate = document.createElement('button');
    btnCreate.type = 'button';
    btnCreate.className = 'home-btn';
    btnCreate.textContent = '作成';
    actions.appendChild(btnCreate);
    form.appendChild(actions);
    inName.focus();

    // 4 経路の違いはここだけ。戻り値を { id } | { error } | null に揃える。
    async function create(name) {
      var date = inDate.value;
      var venue = inVenue.value.trim();
      if (newRoute === 'blank') {
        var saved = await Api.saveEvent({ name: name, date: date, venue: venue, players: [] });
        return (saved && saved.id) ? { id: saved.id } : null;
      }
      if (newRoute === 'template') {
        return await Api.createFromTemplate(newTemplate, { name: name, date: date, venue: venue });
      }
      if (!copySource) return { error: 'コピー元の大会を選んでください。' };
      return await Api.copyEvent(copySource, {
        name: name, date: date, venue: venue, withPlayers: cbPlayers.checked
      });
    }

    btnCreate.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnCreate.disabled = true;
      var result = await create(name);
      // 待っている間に画面を離れていたら何も出さない（alert も出さない）。
      // 「← 選び直す」で同じ #new のまま前段に戻っていた場合も mySeq がずれて弾かれる。
      if (mySeq !== formSeq) return;
      if (paneFor(location.hash) !== 'new') return;
      btnCreate.disabled = false;
      if (!result) {
        alert('大会を作成できませんでした。通信を確かめてください。');
        return;   // フォームは残す（入力し直しにならないように）
      }
      if (result.error) {
        alert('大会を作成できませんでした。\n' + result.error);
        return;
      }
      // 作ったら運営画面の選手登録へ（行き先は PC / スマホのモードで変わる）
      location.href = Storage.adminHref('#players/' + encodeURIComponent(result.id));
    });
  }

  function formTitle() {
    if (newRoute === 'template') {
      var spec = templateSpec(newTemplate);
      return 'テンプレート「' + (spec ? spec.name : newTemplate) + '」から作る';
    }
    if (newRoute === 'copy-prev') return '前回の大会をコピーして作る';
    if (newRoute === 'copy-pick') return '作成済みの大会からコピーして作る';
    return '完全新規で作る';
  }

  function formNote() {
    if (newRoute === 'template') {
      var spec = templateSpec(newTemplate);
      return spec ? spec.description : '';
    }
    if (newRoute === 'copy-prev' || newRoute === 'copy-pick') {
      // desk-events.js のコピーのダイアログと同じ文言にそろえる
      return '技と配点は必ず複製されます。得点・共有リンク・履歴は引き継ぎません。';
    }
    return '技と配点は雛形（技術リスト編集の「雛形」）から入ります。';
  }

  // --- 作成済みの大会（#list）---
  // eventsSeq / eventsCache は上の節（#new）で宣言。#list と #new のどちらも
  // 一覧を使うので、世代は 1 つで足りる。

  var showTest = false;     // 「テストも表示」のチェック
  var listExpanded = false; // 「すべて見る」を押したか
  var LIST_LIMIT = 5;       // 畳む前に出す件数（設計書「作成済みの大会」）

  async function loadEvents() {
    var seq = ++eventsSeq;
    var box = document.getElementById('homeEventList');
    box.textContent = '読み込み中…';
    var events = await Api.listEvents();
    if (seq !== eventsSeq) return;                      // 新しい読み込みが始まっている
    if (paneFor(location.hash) !== 'list') return;      // 待っている間に区画を離れた
    eventsCache = events;
    // Api.listEvents は通信に失敗すると null、大会が 0 件なら [] を返す。区別して出す。
    if (events === null) {
      renderNote(box, '大会の一覧を取得できませんでした。通信を確かめて、画面を読み込み直してください。');
      return;
    }
    renderList(box, events);
  }

  function renderNote(box, text) {
    box.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'home-note';
    p.textContent = text;
    box.appendChild(p);
  }

  // テスト大会は既定で隠す（本物の大会に混ぜない）。運営画面の一覧と採点画面の
  // 選択肢には出るので、テストで使う人はそちらから入れる。
  function visibleHere(ev) {
    return showTest || ev.test !== true;
  }

  function renderList(box, events) {
    box.innerHTML = '';
    // sortForHome はアーカイブを外して「採点中 → 準備中・巡目終了 → 最終結果」の順にする
    var active = sortForHome(events).filter(visibleHere);
    var archived = (events || []).filter(function(ev) {
      return EventStatus.of(ev) === 'archived';
    }).filter(visibleHere).sort(function(a, b) {
      var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
      if (x === y) return 0;
      return x < y ? 1 : -1;
    });

    if ((events || []).length === 0) {
      renderNote(box, '大会がまだありません。「＋ 大会を新規作成」から作ってください。');
      return;
    }
    if (active.length === 0 && archived.length === 0) {
      renderNote(box, 'テスト大会だけです。「テストも表示」にチェックを入れると出ます。');
      return;
    }

    var shown = listExpanded ? active : active.slice(0, LIST_LIMIT);
    shown.forEach(function(ev) { box.appendChild(eventRow(ev)); });

    if (active.length > shown.length) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'home-more';
      more.textContent = 'すべて見る（残り ' + (active.length - shown.length) + ' 件）';
      more.addEventListener('click', function() {
        listExpanded = true;
        renderList(box, eventsCache || []);
      });
      box.appendChild(more);
    }

    if (archived.length > 0) {
      var det = document.createElement('details');
      det.className = 'home-archived';
      var sum = document.createElement('summary');
      sum.textContent = '▸ アーカイブ（' + archived.length + ' 件）';
      det.addEventListener('toggle', function() {
        sum.textContent = (det.open ? '▾ ' : '▸ ') + 'アーカイブ（' + archived.length + ' 件）';
      });
      det.appendChild(sum);
      var inner = document.createElement('div');
      inner.className = 'home-event-list';
      archived.forEach(function(ev) { inner.appendChild(eventRow(ev)); });
      det.appendChild(inner);
      box.appendChild(det);
    }
  }

  // 行はリンクにする（中クリックで別タブに開ける。行き先はモードで変わるので
  // data-event-id を持たせ、updateAdminLinks が href だけ作り直す）。
  function eventRow(ev) {
    var status = EventStatus.of(ev);

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

    if (ev.test === true) {
      var tb = document.createElement('span');
      tb.className = 'home-badge test';
      tb.textContent = 'テスト';
      a.appendChild(tb);
    }
    return a;
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
    // 「テストも表示」。取れている一覧があれば描き直すだけで済ませる
    // （チェックのたびに通信しない）。取れていなければ読み直す。
    var chk = document.getElementById('chkShowTest');
    chk.addEventListener('change', function() {
      showTest = chk.checked;
      listExpanded = false;
      if (eventsCache) renderList(document.getElementById('homeEventList'), eventsCache);
      else loadEvents().catch(function(e) { console.error(e); });
    });
    // ハッシュで区画を出し分ける。index.html の <head> での redirectIfScoring は
    // ページ読み込み時の 1 回だけなので、開いたままハッシュを書き換えられた場合にも
    // 効くよう applyRoute からも通す。
    applyRoute();
    window.addEventListener('hashchange', applyRoute);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    redirectTarget: redirectTarget,
    redirectIfScoring: redirectIfScoring,
    sortForHome: sortForHome,
    pickPrevious: pickPrevious,
    templateSpec: templateSpec
  };
})();
