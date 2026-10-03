// PC 運営画面（desk.html）の骨組み。
// 区画の中身は desk-events.js / desk-setup.js / desk-techniques.js /
// desk-players.js / desk-match.js / desk-results.js が Desk.registerTab で登録する。
// 構造はスマホ運営の admin.js と同じ（registerTab / applyRoute / renderSeq /
// ctx.isStale / 控え / reloadEvent / トースト / 共通ダイアログ）。違うのはハッシュと見た目だけ。
//
// ハッシュ体系: #events / #setup/<id> / #techniques/<id> / #players/<id> / #match/<id> / #round2/<id> / #results/<id>
// 選択中の大会は localStorage の tmg_desk_last に控える（スマホ運営の tmg_admin_last、
// 採点画面の tmg_last とは分ける。別の端末で別の大会を見ていることがある）。
var Desk = (function() {
  var LAST_KEY = 'tmg_desk_last';
  // when: その状態のときだけ左メニューに出す（省略時は常に出す）。二巡目の形登録は
  // 「二巡目準備（形の登録）」のときだけ（ユーザー要望 2026-09-30）。
  var NAV = [
    { tab: 'events',     id: 'navEvents',     label: '大会一覧' },
    { tab: 'setup',      id: 'navSetup',      label: '基本情報' },
    { tab: 'techniques', id: 'navTechniques', label: '技得点表' },
    { tab: 'players',    id: 'navPlayers',    label: '選手登録' },
    { tab: 'match',      id: 'navMatch',      label: '試合進行' },
    { tab: 'round2',     id: 'navRound2',     label: '二巡目の形登録',
      when: function(st) { return st === 'round1_done'; } },
    { tab: 'results',    id: 'navResults',    label: '結果確認' }
  ];
  var TABS = NAV.map(function(n) { return n.tab; });

  // 上部の状態バーの 5 段（ユーザー要望 2026-09-30）。EventStatus の状態値と遷移はそのままで、
  // 見せ方だけをまとめる。決戦・二巡目終了・アーカイブは段の中の補足文（STAGE_NOTES）で示す。
  // 試合進行の工程表（desk-match.js の MATCH_STEPS）は 5 段（① 一巡目 … ③ 二巡目・④ 決戦・⑤ 結果・表彰）。
  // 状態バーは幅が限られるので段を分けず、工程表の ③④ と ⑤ の二巡目終了はここの「二巡目」
  // （補足文で区別）、⑤ の最終結果・アーカイブは「最終結果」に当たる（2026-10-04）。
  var STAGE_GROUPS = [
    { label: '準備中',   states: ['draft'] },
    { label: '一巡目',   states: ['round1'] },
    { label: '形登録',   states: ['round1_done'] },
    { label: '二巡目',   states: ['round2', 'round2_final', 'round2_done'] },
    { label: '最終結果', states: ['final', 'archived'] }
  ];
  var STAGE_NOTES = {
    round1: '進行中',
    round2: '進行中',
    round2_final: '決戦 進行中',
    round2_done: '二巡目終了',
    archived: 'アーカイブ'
  };

  var defs = {};
  var activeDef = null;    // いま描いている区画（DOM から外す前に destroy を呼ぶ）
  var main = null, head = null, nav = null;
  var currentTab = 'events';
  var selectedEventId = null;
  var currentEvent = null;   // 最後に読んだ大会（上部の見出しと段階表示が使う）
  var currentEventLoadedId = null;   // currentEvent がどの大会IDで読んだものか（左メニューの出し分けに使う）
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
    // 別の大会へ移るときは、読み終わるまで前の大会の状態で左メニューを出し分けない
    if (currentEventLoadedId !== selectedEventId) currentEvent = null;
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
    setCurrentEvent(ev);
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
    setCurrentEvent(ev);
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

  // 読み終えた大会を控え、状態で出し分ける左メニュー（二巡目の形登録）を描き直す
  function setCurrentEvent(ev) {
    currentEvent = ev;
    currentEventLoadedId = selectedEventId;
    renderNav();
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

  // 上部の状態バー。現在の段階を金で塗り、通過した段階を塗る（表示だけ。進める・戻すのボタンは
  // 工程表（desk-match.js の DeskMatch.buildSteps）の中にだけ置く。ユーザー要望 2026-09-30「段階の
  // 遷移ボタンは 1 か所に」。工程表は試合進行と二巡目の形登録の先頭に出す。2026-10-03）。
  // 決戦・二巡目終了・アーカイブは、現在の段の補足文（stageOf の note）で示す。
  function buildStage(st, players) {
    var wrap = document.createElement('div');
    wrap.className = 'desk-stage';
    wrap.title = '現在の状態: ' + (EventStatus.LABELS[st] || st);

    var steps = document.createElement('div');
    steps.className = 'desk-stage-steps';
    steps.id = 'deskStageSteps';
    var view = stageOf(st);
    STAGE_GROUPS.forEach(function(g, i) {
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'desk-stage-sep';
        sep.textContent = '─';
        steps.appendChild(sep);
      }
      var isCurrent = (i === view.index);
      var isPast = (i < view.index);
      var el = document.createElement('span');
      el.className = 'desk-stage-step' + (isCurrent ? ' on' : '') + (isPast ? ' done' : '');
      // 通過済みと現在は塗り（●）、未到達は空（○）
      el.textContent = (isCurrent || isPast ? '●' : '○') + g.label;
      if (isCurrent && view.note) {
        var note = document.createElement('span');
        note.className = 'desk-stage-note';
        note.id = 'deskStageNote';
        note.textContent = view.note;
        el.appendChild(note);
      }
      steps.appendChild(el);
    });
    wrap.appendChild(steps);

    var count = document.createElement('span');
    count.className = 'desk-stage-count';
    count.id = 'deskStageCount';
    count.textContent = Courts.stageCountText(st, players);
    wrap.appendChild(count);
    return wrap;
  }

  // 状態 → 状態バーの段（STAGE_GROUPS の添字・段の名前・補足文）。未知の状態は index -1。
  function stageOf(st) {
    for (var i = 0; i < STAGE_GROUPS.length; i++) {
      if (STAGE_GROUPS[i].states.indexOf(st) !== -1) {
        return { index: i, label: STAGE_GROUPS[i].label,
          note: Object.prototype.hasOwnProperty.call(STAGE_NOTES, st) ? STAGE_NOTES[st] : '' };
      }
    }
    return { index: -1, label: '', note: '' };
  }

  // 段階の遷移ボタン（次へ進む・戻す・二巡目を行わず最終結果へ。工程表の中にある。
  // desk-match.js の DeskMatch.buildSteps。試合進行と形登録の区画のどちらに出ていても同じ id）。
  // 通信中は連打・二重送信を防ぐため無効にする。成功時は reloadEvent が区画を描き直す
  // （ボタンごと作り直されるので戻し忘れにならない）。失敗時・通信断のときだけここで明示的に戻す。
  // data-blocked の付いたボタン（二巡目の行に誤りがある間の「二巡目を開始」）は有効に戻さない。
  function setStageButtonsDisabled(flag) {
    ['btnDeskNext', 'btnDeskBack', 'btnDeskSkipRound2'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (!flag && el.hasAttribute('data-blocked')) return;
      el.disabled = flag;
    });
  }

  // 状態を変えたあとのトーストの文言（純粋関数。test.html で固定する）。
  // round2 は一巡目終了の応答の生成結果（無ければ null）。二巡目 0 名分のときは何も作っていないので
  // 「作りました」を出さない（レビュー指摘I）。申請の形で作った行（fromRequest。設計書 2026-10-03 3.4）と
  // 決戦の人数は 0 なら書かない。
  function statusToastText(to, round2) {
    var msg = (EventStatus.LABELS[to] || to) + ' にしました';
    if (round2 && round2.created > 0) {
      var notes = [];
      if (round2.fromRequest > 0) notes.push('申請の形 ' + round2.fromRequest + ' 名');
      if (round2.finalistCount > 0) notes.push('決戦 ' + round2.finalistCount + ' 名');
      msg += '（二巡目 ' + round2.created + ' 名分作りました' + (notes.length ? '・' + notes.join('・') : '') + '）';
    }
    if (round2 && round2.untrackedCount > 0) {
      msg += '（追跡できない二巡目の行が' + round2.untrackedCount + '件あります）';
    }
    return msg;
  }

  // 状態を変える。確認文言は courts.js（スマホ運営と共通）。
  // 失敗の理由はサーバーの文言をそのまま出し、読み直す
  // （transition の 409 は他の端末が先に進めていた場合）。
  // opts.resolveTo(players): 読み直した選手から「行き先」を決め直す関数（次へ進む・戻すは
  //   選手のデータで行き先が変わる。読み直した結果が画面の行き先と違ったら進めずに描き直す）。
  async function applyStatus(from, to, opts) {
    var eventId = selectedEventId;
    if (!eventId) return;
    var seq = renderSeq;
    // 網羅検証 S3: 確認文の件数は「画面を開いた時点」の値だと、他の端末で採点が進んだあとに
    // 古い件数で聞いてしまう。確認を出す直前に大会を読み直して数える。
    setStageButtonsDisabled(true);
    var fresh = await Api.loadEventResult(eventId);
    if (seq !== renderSeq || selectedEventId !== eventId) return;   // 通信中に画面を離れた
    setStageButtonsDisabled(false);
    if (!fresh.ok) {
      if (fresh.status === 404) {
        alert('この大会は削除されています');
        clearLast();
        redirect('events');
      } else {
        alert('大会データを取得できませんでした。通信を確認してください。');
      }
      return;
    }
    var ev = fresh.event;
    var players = ev.players || [];
    var nowStatus = EventStatus.of(ev);
    if (nowStatus !== from) {
      // 画面が古い（他の端末が先に進めた・戻した）。想定外の状態へ行かないよう進めずに描き直す
      alert('他の端末で状態が変わっていました（いまは「' + (EventStatus.LABELS[nowStatus] || nowStatus) +
        '」）。画面を読み直します。\nもう一度確かめてから操作してください。');
      await reloadEvent();
      return;
    }
    if (opts && typeof opts.resolveTo === 'function') {
      var resolved = opts.resolveTo(players);
      if (resolved && resolved !== to) {
        alert('選手の状況が変わったため、進む先が変わります。画面を読み直します。\nもう一度確かめてから操作してください。');
        await reloadEvent();
        return;
      }
    }
    // 試合開始の前だけ、必須項目の未入力とレンタルの選手の技を見る。サーバーは硬い条件
    // （選手 0 名・遷移表にない組み合わせ）しか見ないので、ここで止める。
    // 「確認して進む」にはしない（設計書の決定事項）。必須を外すか入力すれば通る。
    if (from === 'draft' && to === 'round1') {
      var blockers = Courts.startBlockers(ev, players);
      if (blockers.length > 0) { alert(Courts.blockerMessage(blockers)); return; }
    }
    // 二巡目の開始の前に、二巡目の行の技（表に無い技・同じ形 2 回・レンタルで選べない形）を見る
    // （設計書 2026-10-03 5.3・D7。試合開始と同じく「確認して進む」にはしない）。
    if (from === 'round1_done' && to === 'round2') {
      var r2Blockers = Courts.round2StartBlockers(ev, players);
      if (r2Blockers.length > 0) {
        // 文言は工程表の帯と同じ（形登録の区画から押したら「下の表で」。desk-match.js の where）
        alert(Courts.blockerMessage(r2Blockers, currentTab === 'round2'
          ? '二巡目を開始できません。下の表で直してください。'
          : '二巡目を開始できません。形登録で直してください。'));
        return;
      }
    }
    if (!confirm(Courts.statusConfirmMessage(from, to, players))) return;
    setStageButtonsDisabled(true);
    // 網羅検証 S19: 画面が見ていた状態（from）を送る。違えばサーバーが 409 stale で断る
    var res = await Api.changeStatus(eventId, to, { from: from });
    // 追跡できない（CSV 由来の）二巡目の行が既にあると、一巡目終了は 409 exists で
    // いったん止まる。確認して承諾されたら force で再送する（レビュー指摘A）。
    if (res && !res.ok && res.reason === 'exists' && from === 'round1' && to === 'round1_done') {
      if (seq !== renderSeq || selectedEventId !== eventId) { setStageButtonsDisabled(false); return; }
      if (!confirm(Courts.nextRoundConflictMessage(res, '選手登録でコートを設定してください'))) {
        setStageButtonsDisabled(false);
        return;
      }
      res = await Api.changeStatus(eventId, to, { from: from, force: true });
    }
    if (seq !== renderSeq || selectedEventId !== eventId) return;   // 通信中に画面を離れた
    // 成功しても reloadEvent が通信断で描き直せないことがあるので、分岐に置かず
    // ここで必ず戻す（成功時は直後の reloadEvent が帯ごと作り直すので無害）。
    setStageButtonsDisabled(false);
    if (!res) {
      alert('状態を変えられませんでした。通信を確認してください。');
      return;
    }
    if (!res.ok) {
      if (res.reason === 'stale') {
        // 画面が見ていた状態が古い。読み直して、もう一度確かめてもらう（S19）
        alert('他の端末で状態が変わっていました' +
          (res.currentStatus ? '（いまは「' + (EventStatus.LABELS[res.currentStatus] || res.currentStatus) + '」）' : '') +
          '。画面を読み直します。\nもう一度確かめてから操作してください。');
        await reloadEvent();
        return;
      }
      alert(res.error);
      // 他の端末が先に進めていたときだけ読み直す。
      // finale_pending / no_finale はこちらの画面が古い（決戦の行の有無を取り違えている）
      // 可能性があるので、これも読み直す。empty / no_round2 は入力不足なので読み直さない。
      if (res.reason === 'transition' || res.reason === 'finale_pending' ||
          res.reason === 'no_finale') {
        await reloadEvent();
      }
      return;
    }
    toast(statusToastText(to, res.round2 || null));
    // 網羅検証 S13: コートが決まっていない一巡目の選手は二巡目に入らない。黙って外れないよう知らせる
    if (res.round2 && res.round2.unassignedCount > 0) {
      alert('⚠ コートが決まっていない（未分類の）選手が ' + res.round2.unassignedCount +
        ' 名います。二巡目には入っていません。\n選手登録でコートを設定し、一巡目に戻して終了し直してください。');
    }
    // 網羅検証 S18: 暫定ベスト4 が今の一巡目の確定得点で選び直した結果と違うときは警告する
    if (res.round2 && res.round2.finalistDiff) {
      var diffMsg = Courts.finalistDiffMessage(res.round2.finalistDiff);
      if (diffMsg) alert(diffMsg);
    }
    // 試合開始に成功したら、コート端末で使う採点画面を別ウィンドウで開く
    if (from === 'draft' && to === 'round1') openScoring(eventId, '');
    // 一巡目を終了したら、形を直す画面（二巡目の形登録）へ自動で移る（設計書の決定。
    // 2026-09-30 に形登録を試合進行から独立した区画に分けた）
    if (from === 'round1' && to === 'round1_done') {
      navigate('round2', eventId);
      return;
    }
    // 形登録の区画の工程表から進めた・戻した（二巡目を開始・一巡目に戻す・二巡目を行わず最終結果へ）
    // ときは試合進行へ移る。形登録の区画は「二巡目準備」以外では表を出さないため（設計書 2026-10-03 6.5）
    if (currentTab === 'round2' && to !== 'round1_done') {
      navigate('match', eventId);
      return;
    }
    await reloadEvent();
  }

  function renderNav() {
    nav.innerHTML = '';
    var st = currentEvent ? EventStatus.of(currentEvent) : null;
    NAV.forEach(function(item, i) {
      // 状態で出し分ける項目。いま開いている区画なら（段階が変わった直後でも）残す
      if (item.when && item.tab !== currentTab && !(st && item.when(st))) return;
      if (i === 1) {
        var sep = document.createElement('div');
        sep.className = 'desk-nav-sep';
        nav.appendChild(sep);
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = (item.tab === currentTab) ? 'on' : '';
      b.id = item.id;
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
  // PC 運営で採点画面の URL を知っているのはこの関数だけ。
  function scoringHref(eventId, court) {
    if (!eventId) return 'scoring.html';
    var hash = '#event/' + encodeURIComponent(eventId);
    if (court) hash += '/' + encodeURIComponent(court);
    return 'scoring.html' + hash;
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

  // URL などをクリップボードへ写す。試合の区画（採点画面の URL）と
  // 結果の区画（共有リンク・配信ボード）が使う。
  // navigator.clipboard は HTTPS か localhost でしか使えず、権限が無い環境もあるので、
  // 失敗したら prompt に落として手で写せるようにする
  // （スマホ運営の admin-results.js「共有リンクをコピー」と同じ作法）。
  // 戻り値: クリップボードに入ったら true、prompt に落ちたら false。
  async function copyText(text, okMessage) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        toast(okMessage || 'コピーしました');
        return true;
      } catch (e) {
        // 権限が無い・HTTPS でない等。下の prompt に落とす
      }
    }
    window.prompt('このURLをコピーしてください', text);
    return false;
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
    // 狭い幅の案内（btnNarrowSwitch）は撤去した（スマホでも PC 版を出す。2026-09-30）。切り替えは上部の 📱 だけ

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
    applyStatus: applyStatus,
    statusToastText: statusToastText,
    stageOf: stageOf,
    currentEventId: currentEventId,
    toast: toast,
    openDialog: openDialog,
    closeAllDialogs: closeAllDialogs,
    copyText: copyText,
    scoringHref: scoringHref,
    openScoring: openScoring
  };
})();
