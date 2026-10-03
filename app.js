var App = (function() {
  // --- 状態 ---
  var currentEvent = null;   // 現在選択中の大会オブジェクト
  var players = [];          // currentEvent.players の参照
  var visiblePlayers = [];   // 選択中コートで絞り込んだ選手（巡回・一覧の対象）
  var currentCourt = '';     // '' なら全コート
  var currentIndex = -1;  // 選択中の選手インデックス
  var gridRestorable = true; // 表示中のグリッドが player.result から復元できたか
  var gridDirty = false;     // 復元できなかったグリッドを、実際に採点し直したか
  // この選手を表示してから、この端末で得点に関わる編集をしたか。
  // 選手の切り替え（前後ボタン・一覧のクリック）は未編集でも saveCurrentState を
  // 呼ぶので、これが無いと画面の古い値で他端末の確定・備考・得点を巻き戻してしまう。
  var gridEdited = false;
  var noticeRow = null;      // 復元不能を知らせる行（DOM）。置き換え確定時に取り除く
  var selectedRow = -1;      // 選択中の技の行（0始まり）。技が無ければ -1
  var PLAYER_LIST_KEY = 'tmg_player_list_open';
  var timerSec = 300;     // タイマー残り秒数
  var timerRunning = false;
  var timerInterval = null;
  // 雛形（サーバー全体の技リスト）の控え。大会未選択のときと、
  // 大会の応答に techniques が無かったとき（旧サーバー）に使う。
  var templateTechniques = null;
  // いま Scoring に入れている技得点表（技得点表に無い技の判定 Courts.unknownTechs に渡す）。
  var activeTechniques = null;
  // 編集中（gridEdited）に読み直した大会の配点。表を描き直すときまで入れ替えを待つ
  // （行ごとに新旧の配点が混ざらないように。網羅検証 S17）。
  var deferredTechEvent = null;
  // 表示中の選手の技に、技得点表に無い技があるか（網羅検証 M3）。真の間は保存・確定を止める。
  var gridBlocked = false;
  // 保存済みの得点と、今の技得点表で計算し直した得点が違うときの知らせの行（網羅検証 M4）
  var recalcRow = null;
  // 補正点（行・全体）の上限（網羅検証 S4。サーバーは範囲外を 400 で拒む）
  var ADJUST_LIMIT = 999;
  // 採点の鍵で登録した端末なら GET /api/session の応答（採点専用モード。設計書 2026-10-03 6.4）。
  // 運営（Basic・開発）と、セッションを読めなかったときは null（今までどおりの画面）。
  var scorerSession = null;
  var SCORER_HINT_KEY = 'tmg_scorer_hint_seen';   // ブックマークの案内を読んだ印

  // --- DOM参照 ---
  var courtLabel       = document.getElementById('courtLabel');
  var playerOrderLabel = document.getElementById('playerOrderLabel');
  var playerNameLabel  = document.getElementById('playerNameLabel');
  var playerRankLabel  = document.getElementById('playerRankLabel');
  var playerStageLabel = document.getElementById('playerStageLabel');
  var scoreTableBody   = document.getElementById('scoreTableBody');
  var totalScoreDisplay= document.getElementById('totalScoreDisplay');
  var totalScoreValue  = document.getElementById('totalScoreValue');
  var totalScoreBox    = document.getElementById('totalScoreBox');
  var timerDisplay     = document.getElementById('timerDisplay');
  var playerListSection = document.getElementById('playerListSection');
  var playerListBody   = document.getElementById('playerListBody');
  var courtSelect      = document.getElementById('courtSelect');
  var totalAdjustInput = document.getElementById('totalAdjustInput');
  var noteInput        = document.getElementById('noteInput');
  var btnNotePreset    = document.getElementById('btnNotePreset');
  var btnConfirm       = document.getElementById('btnConfirm');
  var adjustBar        = document.querySelector('.adjust-bar');
  var totalAdjustRow   = document.getElementById('totalAdjustRow');   // 採点表の最終行（全体補正点）
  var scoreTable       = document.getElementById('scoreTable');

  // --- 初期化 ---
  async function init() {
    applyTheme(Storage.loadTheme());
    initPlayerListOpen();
    // 送信キューは何よりも先に起動する。
    // ここから下の API 呼び出しがどう転んでも、前回未送信の採点が
    // 復旧され、online イベントの購読も済んでいる状態にするため。
    var recovered = Outbox.init(onSaveStatus, onSaveDiscarded, {
      onConflict: onSaveConflict,
      onSaved: onEntrySaved
    });
    // 採点の鍵で登録した端末なら、大会・コートを鍵の範囲に固定する採点専用モードにする。
    // 読めない（通信失敗・古いサーバー）ときは今までどおりの画面（守りの本体はサーバーの判定表）。
    var session = await Api.getSession();
    if (session && session.ok && Scope.isScorer(session)) enterScorerMode(session);
    // 送れなかった採点の履歴（確定・取り消しなど）を、送れるようになったら送る（起動時・online・定期）。
    // 採点の送信が通ったときにも送る（onEntrySaved）。
    HistoryOutbox.init();
    // 技術データをAPIから取得してScoringに注入
    var techData = await Api.loadTechniques();
    if (techData && techData.techniques) {
      templateTechniques = techData.techniques;
      activeTechniques = techData.techniques;
      Scoring.setTechniques(techData.techniques);
    } else {
      // 端末側の既定値で採点は続けられるが、サーバーのカスタム技術とは
      // 得点が食い違いうる。黙って続けない。
      alert('技術リストをサーバーから取得できませんでした。\n' +
            '端末側の既定値で採点します。得点が実際と異なる可能性があります。');
    }
    // 大会一覧を取得してドロップダウンに展開
    await refreshEventList();
    bindEvents();

    // 運営画面リンクの行き先（PC / スマホ）は端末のモードだけで決まるので、
    // 大会を選ぶ前でも正しいページを指しておく（HTML の初期値は admin.html 固定のため）。
    updateAdminLink('');

    // 選択状態を復帰する（URLハッシュ → localStorage の順）
    var restored = Route.restore();
    // 採点専用では、範囲外（別の大会・別のコート）の控えやブックマークを黙って開かない。
    // 鍵の大会・コートに置き換える（onEventSelect が Route.set で URL と控えも書き直す）。
    if (scorerSession) restored = Scope.clampRoute(restored, scorerSession, null);
    if (restored && restored.eventId) {
      document.getElementById('eventSelect').value = restored.eventId;
      await onEventSelect(restored.eventId, restored.court || '');
    }
    // ブラウザの戻る/進むに追従する
    Route.onChange(async function(sel) {
      if (scorerSession) sel = Scope.clampRoute(sel, scorerSession, currentEvent);
      if (!sel) { await onEventSelect(''); return; }
      document.getElementById('eventSelect').value = sel.eventId;
      await onEventSelect(sel.eventId, sel.court || '');
    });
    // 通知は初期化の後に、かつ次のタスクへ逃がして出す。
    // alert はメインスレッドを止めるため、ここで直に呼ぶと
    // 復元した採点の再送そのものが係員がダイアログを閉じるまで進まない。
    if (recovered > 0) {
      setTimeout(function() {
        alert('前回未送信の採点 ' + recovered + ' 件を送信します。');
      }, 0);
    }
  }

  // --- 保存状態の表示 ---
  var saveStatusEl = document.getElementById('saveStatus');
  var saveBannerEl = document.getElementById('saveBanner');
  var saveBannerTextEl = document.getElementById('saveBannerText');
  var BANNER_AFTER_MS = 30000;

  function onSaveStatus(st) {
    if (!saveStatusEl) return;
    // 401/403 は資格情報の失効。再送では直らず、ページを開き直して再認証する必要がある。
    // 採点の鍵の端末の 401（session_expired / session_revoked / invite_revoked）は再読み込みでは直らない
    // （401 の HTML になるだけ）ので、新しい QR で入り直す案内にする（Scope.authLostText）。
    // 採点専用モードでは auth_required（Cookie が消えた）も同じ案内にする（再読み込みすると運営の
    // パスワード欄が出るだけ。結合試験 E1）。
    var authLost = st.pending > 0 && (st.lastStatus === 401 || st.lastStatus === 403);
    var lostText = authLost ? Scope.authLostText(st.lastReason, st.pending, !!scorerSession) : null;
    saveStatusEl.classList.remove('sending', 'retrying');
    if (st.state === 'idle') {
      saveStatusEl.textContent = '● 保存済み';
    } else if (st.state === 'sending') {
      saveStatusEl.textContent = '◌ 保存中…';
      saveStatusEl.classList.add('sending');
    } else if (authLost) {
      saveStatusEl.textContent = lostText.status;
      saveStatusEl.classList.add('retrying');
    } else if (st.state === 'conflict') {
      // 送れるものは送り終え、別の端末の更新と衝突した採点だけが端末に残っている
      saveStatusEl.textContent = '⚠ 衝突 ' + st.conflicts + ' 件・未保存';
      saveStatusEl.classList.add('retrying');
    } else {
      saveStatusEl.textContent = '⚠ 未保存 ' + st.pending + ' 件・再送中';
      saveStatusEl.classList.add('retrying');
    }

    // 最初の失敗から30秒経っても未保存が残っていればバナーに昇格する。
    // 認証切れは待っても直らないので即座に昇格する。
    // 衝突を端末に残している間も出す（「今すぐ再試行」で送り直すと、まだ衝突なら確認がもう一度出る）。
    var stale = st.failingSince && (Date.now() - st.failingSince >= BANNER_AFTER_MS);
    if (authLost) {
      saveBannerTextEl.textContent = lostText.banner;
      saveBannerEl.style.display = 'flex';
    } else if (st.pending > (st.conflicts || 0) && stale) {
      saveBannerTextEl.textContent =
        '⚠ サーバーに保存できていません（' + st.pending + '件未保存）';
      saveBannerEl.style.display = 'flex';
    } else if (st.conflicts > 0 && !conflictOverlay) {
      saveBannerTextEl.textContent =
        '⚠ 別の端末の更新と衝突した採点が ' + st.conflicts + ' 件あります（この端末に残しています）';
      saveBannerEl.style.display = 'flex';
    } else {
      saveBannerEl.style.display = 'none';
    }

    // 認証切れのときの「今すぐ再試行」は 401 を繰り返すだけなので隠す
    var btnRetrySave = document.getElementById('btnRetrySave');
    if (btnRetrySave) btnRetrySave.hidden = authLost;
  }

  // 送り先が見つからず捨てた採点があれば伝える。
  // 黙って捨てると、採点が消えたことに誰も気付けない。
  function onSaveDiscarded(entries) {
    // 後から追えるよう、捨てた中身そのものを残す
    console.error('保存できずに破棄した採点:', entries);
    try {
      var keep = JSON.parse(localStorage.getItem('tmg_discarded') || '[]');
      localStorage.setItem('tmg_discarded', JSON.stringify(keep.concat(entries)));
    } catch (e) {}
    var detail = entries.map(function(e) {
      // 備考だけのエントリ（score を持たない）が捨てられることもある
      // サーバーが断った理由（Outbox が dropError / dropReason に載せる）も添える
      var why = e.dropError || e.dropReason || '';
      return '  選手ID ' + e.playerId + ' / ' + ('score' in e ? e.score + '点' : '備考') +
        (why ? '（' + why + '）' : '');
    }).join('\n');
    alert('保存できなかった採点が ' + entries.length + ' 件あります。\n' +
          'サーバーが受け付けませんでした。\n' +
          '（名簿を入れ直した直後や、大会が「最終結果」「アーカイブ」になっているときに起きます）\n\n' +
          detail + '\n\n' +
          '運営画面で状態を確認してください。\n' +
          '該当する選手の採点を確認し、必要なら入力し直してください。');
  }

  // --- 送信の成功と衝突（網羅検証 M2。設計書 2026-10-01 1.3） ---

  // 送信が成功した。画面の控えの版（p.rev）を、サーバーの保存後の版に進める。
  // 控えがいま送ったエントリの baseRev のままのときだけ進める（読み直しなどで別の版を控えていれば触らない）。
  function onEntrySaved(entry, saved) {
    HistoryOutbox.flush();   // 採点が送れた＝履歴も送れるはず（登録し直した直後など）
    if (!saved || typeof saved.rev !== 'number') return;
    if (typeof entry.baseRev !== 'number') return;
    if (!currentEvent || currentEvent.id !== entry.eventId) return;
    var p = findPlayer(entry.playerId);
    if (p && EventStatus.revOf(p) === entry.baseRev) p.rev = saved.rev;
  }

  function findPlayer(id) {
    for (var i = 0; i < players.length; i++) {
      if (players[i] && players[i].id === id) return players[i];
    }
    return null;
  }

  // 衝突の確認は 1 件ずつ出す（複数の選手が同時に衝突することがある）。
  var conflictWaiting = [];
  var conflictOverlay = null;

  function onSaveConflict(entry) {
    conflictWaiting.push(entry);
    showNextConflict();
  }

  // 衝突の確認（画面の上に重ねるダイアログ）。confirm() の 2 択では
  // 「読み込む／上書き／あとで」の 3 つを出せないので、その場で作る。
  function showNextConflict() {
    if (conflictOverlay) return;
    var entry = null;
    while (conflictWaiting.length > 0) {
      var e = conflictWaiting.shift();
      // 「今すぐ再試行」などで送り直しが始まっていれば（印が外れていれば）出さない
      if (e && e.conflict) { entry = e; break; }
    }
    if (!entry) { onSaveStatus(Outbox.status()); return; }
    var c = entry.conflict;
    var server = c.player || null;
    var local = (currentEvent && currentEvent.id === entry.eventId) ? findPlayer(entry.playerId) : null;
    var name = (server && server.name) || (local && local.name) || ('選手ID ' + entry.playerId);
    var order = (server && server.order) || (local && local.order) || '';

    var overlay = document.createElement('div');
    overlay.className = 'conflict-overlay';
    var box = document.createElement('div');
    box.className = 'conflict-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    var title = document.createElement('h3');
    var msg = document.createElement('p');
    msg.className = 'conflict-message';
    var outOfScope = c.reason === 'scope' || c.reason === 'field';   // 403（設計書 2026-10-03 6.6）
    if (outOfScope) {
      title.textContent = 'この端末の登録では保存できない選手です';
      msg.textContent = name + (order ? '（' + order + '）' : '') + ' の採点を保存できませんでした。\n' +
        'この端末の登録では保存できない選手です（別のコート・運営の項目）。\n' +
        'サーバーの内容を読み込むか、あとで決めてください（この端末に残します）。';
    } else if (c.reason === 'stale') {
      title.textContent = '別の端末で更新されています';
      msg.textContent = name + (order ? '（' + order + '）' : '') + ' の採点を、別の端末が先に更新しました。\n' +
        'サーバーの内容を読み込みますか／この端末の内容で上書きしますか';
    } else {
      var st = c.eventStatus || (currentEvent && currentEvent.id === entry.eventId ? currentStatus() : '');
      title.textContent = 'この巡目は今は採点できません';
      msg.textContent = name + (order ? '（' + order + '）' : '') + ' の採点を保存できませんでした。\n' +
        'この巡目は今は採点できません（状態: ' + (EventStatus.LABELS[st] || st || '不明') + '）。\n' +
        'サーバーの内容を読み込むか、この端末に残してください。';
    }
    box.appendChild(title);
    box.appendChild(msg);

    // サーバーとこの端末の値を並べる（どちらを残すか選ぶ材料）
    var cmp = document.createElement('table');
    cmp.className = 'conflict-compare';
    function scoreText(score, confirmed) {
      return (typeof score === 'number' ? score + '点' : '—') + (confirmed ? '（確定済み）' : '（未確定）');
    }
    [['サーバー', server ? scoreText(server.score, server.confirmed === true)
                         : (outOfScope ? '（この端末の範囲外）' : '（読み込めませんでした）')],
     ['この端末', scoreText('score' in entry ? entry.score : (local ? local.score : undefined),
                           'confirmed' in entry ? entry.confirmed === true : !!(local && local.confirmed))]]
      .forEach(function(row) {
        var tr = document.createElement('tr');
        var th = document.createElement('th');
        th.textContent = row[0];
        var td = document.createElement('td');
        td.textContent = row[1];
        tr.appendChild(th);
        tr.appendChild(td);
        cmp.appendChild(tr);
      });
    box.appendChild(cmp);

    var actions = document.createElement('div');
    actions.className = 'conflict-actions';
    function addButton(label, cls, action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', function() { resolveConflictChoice(entry, action); });
      actions.appendChild(b);
      return b;
    }
    addButton('サーバーの内容を読み込む', 'conflict-load', 'discard');
    if (c.reason === 'stale') {
      addButton('この端末の内容で上書き', 'conflict-overwrite', 'overwrite');
      addButton('あとで決める（端末に残す）', 'conflict-keep', 'keep');
    } else if (outOfScope) {
      // 上書きは出さない（送り直しても同じ 403 になる）
      addButton('あとで決める（端末に残す）', 'conflict-keep', 'keep');
    } else {
      addButton('この端末に残す', 'conflict-keep', 'keep');
    }
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    conflictOverlay = overlay;
    onSaveStatus(Outbox.status());   // 衝突のバナーはダイアログを閉じてから出す
  }

  function closeConflictDialog() {
    if (conflictOverlay && conflictOverlay.parentNode) conflictOverlay.parentNode.removeChild(conflictOverlay);
    conflictOverlay = null;
  }

  function resolveConflictChoice(entry, action) {
    var c = entry.conflict || {};
    var server = c.player || null;
    closeConflictDialog();
    Outbox.resolveConflict(entry.eventId, entry.playerId, action);
    if (action === 'discard') {
      // サーバーの内容を読み込む。409 に付いてきた選手（サーバーの今の行）で画面を描き直す。
      applyServerPlayer(entry.eventId, server);
    } else if (action === 'overwrite') {
      // この端末の内容で上書き。控えの版もサーバーの今の版にそろえる（次の保存で衝突にしない）。
      var p = (currentEvent && currentEvent.id === entry.eventId) ? findPlayer(entry.playerId) : null;
      if (p && server && typeof server.rev === 'number') p.rev = server.rev;
    }
    onSaveStatus(Outbox.status());
    showNextConflict();
  }

  // サーバーの選手の行（409 の player）を画面の選手に当て、表示中ならその選手を描き直す。
  // 大会の状態が変わったこと（not_scorable）もあるので、最後に大会を読み直す。
  function applyServerPlayer(eventId, server) {
    if (!currentEvent || currentEvent.id !== eventId) return;
    var p = server ? findPlayer(server.id) : null;
    if (p) {
      Object.assign(p, server);
      if (!('rev' in server)) delete p.rev;
      if (p === visiblePlayers[currentIndex]) {
        updatePlayerLabels(p);
        renderScoreGrid(p);   // gridEdited も外れる（サーバーの内容を採ったので）
        renderStatusBanner();
        applyScoringLock();
      }
      refreshPlayerList();
      updatePlayerList();
    }
    refreshFromServer();
  }

  // --- 採点専用モード（採点の鍵で登録した端末。設計書 2026-10-03 6.4） ---
  // 運営への導線（.admin-only）を隠し、上部に「採点専用 ・ A コート ・ 期限」の札と解除のボタンを出す。
  // 大会の選択欄は鍵の大会 1 件に固定（refreshEventList）、コートは鍵のコート（refreshCourtList）。
  function enterScorerMode(session) {
    scorerSession = session;
    document.body.classList.add('scorer-mode');
    var badge = document.getElementById('scorerBadge');
    badge.textContent = Scope.badgeText(session);
    if (session.label) badge.title = session.label;
    document.getElementById('scorerBar').hidden = false;
    document.getElementById('btnScorerLogout').addEventListener('click', onScorerLogout);
    document.getElementById('eventSelect').disabled = true;
    // 初回だけ「ブックマークしてください」（次からの入口になる。join の画面ではなくここで出す。6.1 の 4）。
    // 一度出したら既読にする（閉じずに再読み込みしても、もう出さない。結合試験 E3）
    var seen = false;
    try { seen = localStorage.getItem(SCORER_HINT_KEY) === '1'; } catch (e) {}
    if (!seen) {
      var hint = document.getElementById('scorerHint');
      hint.hidden = false;
      try { localStorage.setItem(SCORER_HINT_KEY, '1'); } catch (e) {}
      document.getElementById('btnScorerHintClose').addEventListener('click', function() {
        hint.hidden = true;
      });
    }
  }

  // この端末の登録を解除する（POST /api/session/logout）。未送信があれば止める
  // （解除すると送れなくなる。端末に残ったまま、もう一度 QR を読むまで届かない）。
  async function onScorerLogout() {
    var pending = Outbox.pendingCount();
    if (pending > 0) {
      alert('未送信の採点が ' + pending + ' 件あります。送信が終わってから解除してください。\n' +
            '（登録が切れている場合は、運営に新しい QR をもらって読み取ると送られます）');
      return;
    }
    if (!confirm('この端末の採点の登録を解除します。\n' +
                 '解除すると、もう一度 QR を読み取るまでこの端末では採点できません。よろしいですか？')) return;
    var r = await Api.logout();
    if (!r || !r.ok) {
      alert('解除できませんでした。通信を確かめて、もう一度押してください。');
      return;
    }
    location.replace('/join');
  }

  // --- テーマ ---
  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀ ライト' : '🌙 ダーク';
  }

  // --- イベントバインド ---
  function bindEvents() {
    document.getElementById('btnTheme').addEventListener('click', function() {
      var current = Storage.loadTheme();
      var next = current === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });

    document.getElementById('btnPrev').addEventListener('click', function() { movePlayer(-1); });
    document.getElementById('btnNext').addEventListener('click', function() { movePlayer(1); });

    document.getElementById('btnTimerStart').addEventListener('click', startTimer);
    document.getElementById('btnTimerStop').addEventListener('click', stopTimer);
    document.getElementById('btnTimerReset').addEventListener('click', resetTimer);

    document.getElementById('btnAllSuccess').addEventListener('click', setAllSuccess);
    document.getElementById('btnAllFail').addEventListener('click', setAllFail);

    document.getElementById('btnPlayerListToggle').addEventListener('click', togglePlayerList);
    btnConfirm.addEventListener('click', onConfirm);
    document.getElementById('btnConfirmNext').addEventListener('click', onConfirmNext);
    totalAdjustInput.addEventListener('change', onTotalAdjustChange);
    noteInput.addEventListener('change', onNoteChange);
    btnNotePreset.addEventListener('click', openNotePresetSheet);

    // 大会管理イベント
    document.getElementById('eventSelect').addEventListener('change', function() {
      if (!confirmLeave()) { this.value = currentEvent ? currentEvent.id : ''; return; }
      var prevCourt = currentCourt;   // 通信断で失敗したとき元へ戻すため退避
      currentCourt = '';   // 大会が変われば担当コートも選び直す
      onEventSelect(this.value, '', prevCourt);
    });
    courtSelect.addEventListener('change', function() {
      if (!confirmLeave()) { this.value = currentCourt; return; }
      currentCourt = this.value;
      applyCourtFilter();
      if (currentEvent) Route.set(currentEvent.id, currentCourt);
    });
    document.getElementById('btnRetrySave').addEventListener('click', function() {
      Outbox.flushNow();
    });

    // タブ切替やスリープから戻ったら、他端末の書き込みを取りに行く
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') refreshFromServer();
    });

    // 未送信の採点があるときだけ離脱を警告する。
    // 認証切れのときは再読み込みが復旧手段なので、離脱確認で止めない
    // （未送信の採点は localStorage に残っており、再読み込み後に再送される）。
    window.addEventListener('beforeunload', function(e) {
      var st = Outbox.status();
      var authLost = st.lastStatus === 401 || st.lastStatus === 403;
      if (Outbox.pendingCount() > 0 && !authLost) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // --- コート ---
  // コート選択肢の表示名。未分類はそのまま、それ以外は「A コート」。
  // 名簿未ロード時に URL のコート指定を残す分岐（refreshCourtList 末尾）でも同じ表記にする。
  function courtOptionLabel(court) {
    return court === Courts.UNASSIGNED ? Courts.UNASSIGNED : court + ' コート';
  }

  // 現在の大会の選手からコート選択肢を作り直す
  function refreshCourtList() {
    // 採点専用では鍵の範囲のコートだけ（1 コートの鍵はそのコート、全コートの鍵は未分類を除く全部）
    var list = scorerSession ? Scope.allowedCourts(currentEvent, scorerSession) : Courts.listFrom(players);
    // コートは必ず 1 つ選ぶ（「全コート」は無くした。ユーザー要望 2026-09-30: 一覧に他コートや他の部が混ざらないように）
    courtSelect.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement('option');
      opt.value = list[i];
      opt.textContent = courtOptionLabel(list[i]);
      courtSelect.appendChild(opt);
    }
    // 名簿が入っている大会で、選択中のコートが無い（未選択・そこに無い）なら先頭のコートにする
    if ((players.length > 0 || scorerSession) && list.length > 0 && list.indexOf(currentCourt) === -1) {
      currentCourt = list[0];
    }
    // 名簿がまだ入っていない場合は、配布されたURLのコート指定を落とさない。
    // 「先に端末を配ってURLを開かせ、後から名簿を入れる」段取りがあるため、
    // 選択肢として残しておく。
    if (currentCourt && list.indexOf(currentCourt) === -1 &&
        (!scorerSession || Scope.courtAllowed(currentCourt, currentEvent, scorerSession))) {
      var pending = document.createElement('option');
      pending.value = currentCourt;
      pending.textContent = courtOptionLabel(currentCourt);
      courtSelect.appendChild(pending);
    }
    courtSelect.value = currentCourt;
    // 採点専用で選べるコートが 1 つなら選択欄を固定する（全コートの鍵は大会のコートの中で選べる）
    courtSelect.disabled = !!scorerSession && courtSelect.options.length <= 1;
  }

  // 絞り込みを適用して画面を作り直す
  function applyCourtFilter() {
    visiblePlayers = filterForStatus(Courts.filter(players, currentCourt).sort(Courts.compareOrder));   // 試技順（男子の部→女子の部、No. 順）に並べてから状態で絞る（候補を末尾に寄せる処理を保つ）
    currentIndex = -1;
    if (visiblePlayers.length > 0) {
      selectPlayer(0);
    } else {
      applyDeferredTechniques();
      gridEdited = false;
      gridBlocked = false;
      recalcRow = null;
      scoreTableBody.innerHTML = '';
      setTotalDisplay(0);
      playerNameLabel.textContent = players.length > 0
        ? '（このコートに選手がいません）'
        : '（選手がいません）';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = '';
      playerRankLabel.textContent = '';
      playerStageLabel.textContent = '';
      clearAdjustInputs();
      // このコートに映すものが無いことを配信用ボードへ伝える（ボードは「待機中」に戻る）。
      // 選手がいる場合は selectPlayer 経由の resetTimer が送る。
      publishLive();
    }
    refreshPlayerList();
    renderStatusBanner();
    applyScoringLock();
  }

  // --- 大会の状態 ---
  // 状態は大会を選んだときの値で判定する（ポーリングはしない設計）。
  // 運営が状態を変えたら、コート端末は「大会を選び直す」運用。
  // 既存の「選手を足したら選び直す」と同じ扱いで、help.html に書いてある。

  function currentStatus() {
    return currentEvent ? EventStatus.of(currentEvent) : null;
  }

  function scoringOpen() {
    return !!currentEvent && EventStatus.isScoringOpen(currentStatus());
  }

  // いま開いている選手を採点してよいか。状態が採点できることに加えて、
  // 最終組の制限（EventStatus.isPlayerScorable。行の印 finalist で判定。設計書 2026-09-28）も見る。
  //   二巡目 進行中   … 最終組（一巡目上位 4 名）の行は「最終組を開始」の後
  //   最終組 進行中   … 最終組の行だけ（他の選手は斬り終わっている）
  function scoringOpenHere() {
    if (!scoringOpen()) return false;
    return EventStatus.isPlayerScorable(currentStatus(), visiblePlayers[currentIndex]);
  }

  // 「最終組（一巡目上位 4 名）」（設計書 2026-10-04-finale-after-round2 5 章）
  function finalGroupName() {
    return EventStatus.FINALIST_LABEL + '（' + EventStatus.FINALIST_DESC + '）';
  }

  // 「最終組 進行中。採点できるのは最終組（一巡目上位 4 名）の選手だけです」
  function finalOnlyMessage() {
    return EventStatus.LABELS.round2_final + '。採点できるのは' + finalGroupName() + 'の選手だけです';
  }

  // 大会選択バーの下の状態バナー。採点できるかどうかと、できないときの次の手を出す。
  function renderStatusBanner() {
    var el = document.getElementById('statusBanner');
    if (!el) return;
    if (!currentEvent) { el.hidden = true; el.textContent = ''; return; }
    var st = currentStatus();
    el.hidden = false;
    if (EventStatus.isScoringOpen(st)) {
      if (!scoringOpenHere()) {
        // 状態は採点できるが、この選手は今は採点できない（最終組の制限。行の印で判定）
        el.className = 'status-banner closed';
        el.textContent = (st === 'round2')
          ? 'この選手は' + finalGroupName() + 'です。他の選手が終わり、運営画面で「' +
            EventStatus.NEXT_LABELS.round2 + '」を押すと採点できます'
          : finalOnlyMessage();
        return;
      }
      // 最終組 進行中に、最終組の選手がいないコートを開いている（一覧が空）。
      // 緑の「最終組 進行中」を出すと採点できるように見えるので、最終組のコートを案内する。
      if (st === 'round2_final' && !visiblePlayers[currentIndex]) {
        var finCourt = Courts.finaleCourt(players);
        el.className = 'status-banner closed';
        el.textContent = finalOnlyMessage() +
          (finCourt ? '（' + finCourt + ' コート）' : '');
        return;
      }
      el.className = 'status-banner open';
      el.textContent = EventStatus.LABELS[st];
      return;
    }
    el.className = 'status-banner closed';
    if (EventStatus.isLocked(st)) {
      el.textContent = 'この大会は「' + EventStatus.LABELS[st] + '」です。得点は編集できません。' +
        '運営画面で「戻す」を押すと編集できます。';
    } else if (EventStatus.isScoringOpen(EventStatus.next(st))) {
      // draft → 試合開始、round1_done → 二巡目を開始。次へ進めば採点できる
      el.textContent = 'この大会は「' + EventStatus.LABELS[st] + '」です。運営画面で「' +
        EventStatus.NEXT_LABELS[st] + '」を押すと採点できます。';
    } else {
      // round2_done。次へ進むと確定してしまうので、戻す方を案内する
      el.textContent = 'この大会は「' + EventStatus.LABELS[st] + '」です。' +
        '運営画面で「戻す」を押すと採点に戻れます。';
    }
  }

  // 採点できない状態のとき、得点に関わる操作を全部止める。
  // 前後の選手の移動・タイマー・CSVエクスポート・HTML保存は使える（設計書「採点画面」）。
  // いま開いている選手が確定済みか（確定済みの間は点数を触れない。ユーザー要望）
  function currentConfirmed() {
    var p = visiblePlayers[currentIndex];
    return !!(p && p.confirmed);
  }

  function applyScoringLock() {
    // 最終組 進行中に最終組のいないコートを開いている（一覧が空）ときも、バナー（renderStatusBanner）
    // と同じく閉じた扱いにする。
    var empty = currentStatus() === 'round2_final' && !visiblePlayers[currentIndex];
    var locked = !!currentEvent && (!scoringOpenHere() || empty);
    // 確定済みは「採点できる状態」のまま入力だけ止める。確定ボタンは押せる（取り消しのトグル）。
    // 技得点表に無い技がある選手（gridBlocked）は、保存・確定（取り消しも）を止める（網羅検証 M3）。
    var frozen = locked || currentConfirmed() || gridBlocked;
    document.body.classList.toggle('scoring-locked', locked);
    document.body.classList.toggle('score-frozen', frozen);
    btnConfirm.disabled = locked || gridBlocked;
    // 「確定して次へ」は確定と同じ条件で押せる（確定済みなら次へ移るだけ）
    document.getElementById('btnConfirmNext').disabled = locked || gridBlocked;
    var btnRecalc = document.getElementById('btnRecalc');
    if (btnRecalc) btnRecalc.disabled = locked;
    document.getElementById('btnAllSuccess').disabled = frozen;
    document.getElementById('btnAllFail').disabled = frozen;
    if (frozen) {
      totalAdjustInput.disabled = true;
      noteInput.disabled = true;
      btnNotePreset.disabled = true;
      closeNotePresetSheet();   // 採点できなくなったら、開いていた文例シートも片付ける
    }
    var inputs = scoreTableBody.querySelectorAll('.adjust-input');
    for (var i = 0; i < inputs.length; i++) inputs[i].disabled = frozen;
  }

  // 表示する選手。進行中ならその巡目だけに絞る（コートの絞り込みと併用）。
  // 進行中でなければ全巡目を出す（見直し・確認のため）。
  // 最終組（一巡目上位 4 名）は先頭コートの二巡目の末尾で斬る（設計書 2026-09-28）ので、
  //   二巡目 進行中 … 全員を出し、最終組の行を末尾に寄せる（採点はできない。一覧で薄く出す）。
  //                   生成した順ですでに末尾のはずだが、差分追加などで崩れても末尾に来るよう
  //                   印の有無で安定に並べ直す。
  //   最終組 進行中 … 最終組の行だけを出す。
  function filterForStatus(list) {
    var st = currentEvent ? currentStatus() : null;
    var round = st ? EventStatus.scoringRound(st) : null;
    if (!round) return list;
    var rows = list.filter(function(p) { return Courts.roundOf(p) === round; });
    if (st === 'round2_final') {
      return rows.filter(function(p) { return p.finalist === true; });
    }
    if (st === 'round2') {
      return rows.filter(function(p) { return p.finalist !== true; })
        .concat(rows.filter(function(p) { return p.finalist === true; }));
    }
    return rows;
  }

  // --- 大会管理 ---
  // 大会の選択肢。archived は出さず、採点できる大会（進行中）を先頭にまとめる。
  // 文言は「大会名（一巡目 進行中）」。当日どれを選べばよいかを一目で分かるようにする。
  async function refreshEventList() {
    var events = await Api.listEvents();
    if (!events) {
      // 取得できなかっただけで、大会が消えたわけではない。
      // 一覧を空にすると「大会が無くなった」ように見えるので、今の表示を保つ。
      alert('大会一覧を取得できませんでした。通信を確認してください。');
      return;
    }
    // 採点専用では鍵の大会だけ（サーバーも 1 件に絞って返す）
    events = Scope.filterEvents(events, scorerSession);
    var usable = events.filter(function(e) { return EventStatus.of(e) !== 'archived'; });
    var open = usable.filter(function(e) { return EventStatus.isScoringOpen(EventStatus.of(e)); });
    var rest = usable.filter(function(e) { return !EventStatus.isScoringOpen(EventStatus.of(e)); });
    var ordered = open.concat(rest);   // 各群の中は listEvents の順（更新の新しい順）のまま

    var select = document.getElementById('eventSelect');
    select.innerHTML = '<option value="">-- 大会を選択 --</option>';
    for (var i = 0; i < ordered.length; i++) {
      select.appendChild(eventOption(ordered[i]));
    }
    // refreshEventList は init からしか呼ばれず、その時点では currentEvent はまだ無い
    // （大会を選ぶのはこのあとの Route.restore / onEventSelect）。一覧から外れている
    // 大会（アーカイブなど）を選んだときの選択肢の救済は onEventSelect 側でやる。
  }

  function eventOption(ev) {
    var opt = document.createElement('option');
    var date = ev.date ? ' (' + ev.date + ')' : '';
    opt.value = ev.id;
    opt.textContent = (ev.name || '(名称未設定)') + date + '（' + EventStatus.LABELS[EventStatus.of(ev)] + '）';
    return opt;
  }

  // 選択肢（#eventSelect）に大会が無ければ足す。一覧から外れている大会
  // （アーカイブされて #event/<id>/... で直接開いた場合など）を選んだときに使う。
  // 黙って未選択に戻ったり、別の大会が選ばれているように見えたりするのを防ぐ。
  // 足した選択肢には data-rescued を付ける。その大会を離れたら
  // removeStaleRescuedOptions で消すため（残しっぱなしにしない）。
  function ensureEventOption(event) {
    var select = document.getElementById('eventSelect');
    var found = false;
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === event.id) { found = true; break; }
    }
    if (!found) {
      var opt = eventOption(event);
      opt.dataset.rescued = '1';
      select.appendChild(opt);
    }
    select.value = event.id;
  }

  // ensureEventOption が救済で足した選択肢のうち、今の大会（keepEventId）以外を消す。
  // 大会を離れる（keepEventId === ''）ときは救済の選択肢を全部消す。
  // 別の大会に切り替わったときも、前の大会の救済分は残さない。
  function removeStaleRescuedOptions(keepEventId) {
    var select = document.getElementById('eventSelect');
    for (var i = select.options.length - 1; i >= 0; i--) {
      var opt = select.options[i];
      if (opt.dataset.rescued === '1' && opt.value !== keepEventId) {
        select.removeChild(opt);
      }
    }
  }

  // 大会読み込みの再入ガード。
  // Api.loadEvent の往復中に別の大会やコートへ切り替えられると、
  // 遅れて戻ってきた古い応答が新しい選択を上書きし、
  // 「画面はA大会・内部状態はB大会」というねじれが起きる。
  // 採点対象の取り違えに直結するため、最後の要求だけが状態を書き換えるようにする。
  var loadSeq = 0;

  // 選択中の大会の配点を採点に反映する。
  // 配点は大会ごと（大会 JSON の techniques）。応答に techniques が無い旧サーバーに
  // 当たったときは雛形のままにする（黙って 0 点にしない）。
  function applyEventTechniques(event) {
    if (event && Array.isArray(event.techniques) && event.techniques.length > 0) {
      activeTechniques = event.techniques;
      Scoring.setTechniques(event.techniques);
    } else if (templateTechniques) {
      activeTechniques = templateTechniques;
      Scoring.setTechniques(templateTechniques);
    }
  }

  // いま採点に使っている技得点表（Courts.unknownTechs に渡す）。雛形も取れなかったときは端末の既定値。
  function currentTechList() {
    if (activeTechniques) return activeTechniques;
    return (typeof TECHNIQUES !== 'undefined' && Array.isArray(TECHNIQUES)) ? TECHNIQUES : [];
  }

  // サーバーから読み直した大会データを画面の状態に取り込む。
  // 未送信の採点はキューのほうが新しいので必ず上書きする。これを忘れると
  // 画面がサーバーの古い値へ巻き戻り、次の1タップがその古いDOMから
  // 再エンコードされて未送信分を破棄する。
  // 読み直す経路が複数あるため、ここに一本化して付け忘れを防ぐ。
  function adoptEvent(event) {
    // 同じ大会を読み直していて、表示中の選手をこの端末で編集している最中か（表は描き直さない）
    var editingSame = gridEdited && !!currentEvent && currentEvent.id === event.id;
    // 版（rev）を単調に保つ（レビュー指摘 8）。読み直しの GET が自分の保存（PATCH）より先に
    // サーバーで読まれ、保存の成功より後に届くことがある（選手を切り替えた直後など）。その古い行で
    // 差し替えると、画面が保存前の値へ巻き戻り、次の保存が古い baseRev で自分の採点と衝突する。
    // 同じ大会の読み直しで、画面の控えのほうが新しい版の行は、控えの行をそのまま使う。
    if (currentEvent && currentEvent.id === event.id && Array.isArray(event.players)) {
      var held = {};
      (players || []).forEach(function(p) { if (p && p.id) held[p.id] = p; });
      event.players = event.players.map(function(p) {
        var mine = (p && p.id) ? held[p.id] : null;
        return (mine && EventStatus.revOf(mine) > EventStatus.revOf(p)) ? mine : p;
      });
    }
    currentEvent = event;
    players = event.players || [];
    Outbox.applyPending(event.id, players);
    // 大会を読み直す経路（onEventSelect / refreshFromServer）はここに集まる。
    // 配点の入れ替えもここでやると付け忘れない。
    // ただし編集中は入れ替えない。描いてある行は古い配点、これから押す太刀は新しい配点、と
    // 1 人の中で新旧が混ざるため（網羅検証 S17）。次に表を描くとき（renderScoreGrid）に入れ替える。
    if (editingSame) {
      deferredTechEvent = event;
    } else {
      deferredTechEvent = null;
      applyEventTechniques(event);
    }
  }

  // 運営画面リンクに選択中の大会を引き継がせる。採点画面と運営画面は
  // 控え（localStorage）を別キー（tmg_last / tmg_admin_last）で持つため、
  // ハッシュ無しの遷移だと相手側が最後に見ていた大会に着地してしまう。
  // ハッシュを付けて運営画面の選手タブへ直接渡す。
  function updateAdminLink(eventId) {
    // linkAdmin と linkEventAdmin は別々のページにしか無いことがあるため、
    // 片方のガードでもう片方の更新まで抜けてしまわないよう、先に済ませる。
    var eventLink = document.getElementById('linkEventAdmin');
    if (eventLink) eventLink.href = Storage.adminHref('#events');

    var link = document.getElementById('linkAdmin');
    if (!link) return;   // このリンクを持たないページから呼ばれても落ちないように
    // 行き先（PC の desk.html / スマホの admin.html）は端末のモードで決まる。
    // 組み立ては storage.js に任せる（採点画面はページ名を知らない）。
    link.href = Storage.adminHref(eventId ? '#players/' + encodeURIComponent(eventId) : '#events');
  }

  // 上部リンクの「技術リスト編集」。選択中の大会があればその大会の技リストを開く
  // （配点は大会ごとなので、ハッシュ無しで開くと雛形を編集してしまう）。
  function updateTechniquesLink(eventId) {
    var link = document.getElementById('linkTechniques');
    if (!link) return;   // このリンクを持たないページから呼ばれても落ちないように
    link.href = eventId
      ? 'techniques.html#' + encodeURIComponent(eventId)
      : 'techniques.html';
  }

  async function onEventSelect(eventId, court, prevCourt) {
    var seq = ++loadSeq;
    if (!eventId) {
      // 大会を離れることを配信用ボードへ伝える（ボードは「待機中」に戻る）。
      // currentEvent / currentCourt を消す前に送る。消した後では宛先が分からない。
      publishLive(true);
      currentEvent = null;
      players = [];
      visiblePlayers = [];
      currentCourt = '';
      currentIndex = -1;
      gridEdited = false;
      gridBlocked = false;
      recalcRow = null;
      refreshCourtList();
      scoreTableBody.innerHTML = '';
      setTotalDisplay(0);
      playerNameLabel.textContent = '（大会を選択してください）';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = '';
      playerRankLabel.textContent = '';
      playerStageLabel.textContent = '';
      clearAdjustInputs();
      Route.clear();
      refreshPlayerList();
      updateAdminLink('');
      updateTechniquesLink('');
      renderStatusBanner();
      applyScoringLock();
      // 大会を離れたら配点も雛形に戻す（次に選ぶ大会まで前の大会の配点を持ち越さない）。
      deferredTechEvent = null;
      if (templateTechniques) {
        activeTechniques = templateTechniques;
        Scoring.setTechniques(templateTechniques);
      }
      // 救済で足した選択肢も、大会を離れたら残さない。
      removeStaleRescuedOptions('');
      return;
    }
    // 404（大会が削除されている）と通信断を区別する（運営画面 desk.js / admin.js の
    // 大会読み込みと同じ出し分け）。404 だけ控え（Route・localStorage）を消して
    // 未選択状態まで戻す。通信断は控えを残し、今の画面もそのまま保つ（再送・再読み込みで
    // 直る見込みがあるものを、勝手に「削除された」扱いにしないため）。
    var evResult = await Api.loadEventResult(eventId);
    if (seq !== loadSeq) return;   // 追い越された。古い応答は捨てる
    if (!evResult.ok) {
      if (evResult.status === 404) {
        // 復元しようとした大会が既に削除されている。
        // 前の大会の選手や得点が画面に残らないよう、未選択状態まで戻す。
        alert('この大会は削除されています');
        currentEvent = null;
        document.getElementById('eventSelect').value = '';
        await onEventSelect('');
      } else {
        // 通信断。控え（Route・localStorage）も選手データも触らず、今の画面のまま戻す。
        // change ハンドラが選択前に eventSelect の値と currentCourt を先に書き換えて
        // いるため、ここで元に戻さないと「選び直したのに切り替わっていない」表示になる。
        alert('大会データを取得できませんでした。通信を確認してください。');
        document.getElementById('eventSelect').value = currentEvent ? currentEvent.id : '';
        if (prevCourt !== undefined) currentCourt = prevCourt;
      }
      return;
    }
    adoptEvent(evResult.event);
    ensureEventOption(currentEvent);
    removeStaleRescuedOptions(currentEvent.id);   // 前の大会の救済分は残さない
    if (court !== undefined) currentCourt = court;
    refreshCourtList();
    applyCourtFilter();
    Route.set(currentEvent.id, currentCourt);
    updateAdminLink(currentEvent.id);
    updateTechniquesLink(currentEvent.id);
  }

  // 大会の作成・削除は運営画面（admin.html#events）にある。
  // コート端末から全コート分のデータを消せる操作を置かないため、この画面からは外した。

  // --- 選手切り替え ---
  // 採点を入れたのに確定していない選手から離れようとしたら、一度だけ聞く（ユーザー要望）。
  // OK なら確定してから移動、キャンセルなら留まる。確定できない状態（技未入力・内訳復元不可）
  // のときだけ従来どおり「確定せずに移動」を聞く。
  // 採点できない状態や、まだ何も入れていない選手では聞かない。戻り値 true なら移動してよい。
  function confirmLeave() {
    var p = visiblePlayers[currentIndex];
    if (!p || !scoringOpenHere() || p.confirmed) return true;
    if (gridBlocked) return true;   // 技得点表に無い技がある選手は確定できない（聞いても進めない）
    if (!gridEdited && !Courts.isScored(p)) return true;
    if (!canConfirmCurrent()) {
      return confirm('この選手の採点がまだ確定されていません。確定せずに移動しますか？');
    }
    if (!confirm('この選手の採点がまだ確定されていません。確定して次へでよいですか？')) return false;
    return confirmCurrent(true);
  }

  function movePlayer(delta) {
    if (visiblePlayers.length === 0) return;
    var next = currentIndex + delta;
    if (next < 0 || next >= visiblePlayers.length) return;
    if (!confirmLeave()) return;
    saveCurrentState();
    selectPlayer(next);
  }

  function selectPlayer(index) {
    var changed = index !== currentIndex;
    currentIndex = index;
    var p = visiblePlayers[index];
    updatePlayerLabels(p);
    renderScoreGrid(p);
    // resetTimer が「新しい選手＋初期値のタイマー」を配信用ボードへ送る（publishLive）。
    // ここで別に送ると同じ内容の書き込みが二重になるので送らない。
    if (changed) resetTimer();
    updatePlayerList();
    // 全コート表示（currentCourt が空）では選手ごとにコートが変わりうるので、
    // バナーとロックを見直す（最終組の制限は選手の印 finalist で決まる）。
    renderStatusBanner();
    applyScoringLock();
    // 別の選手を開いたら、他端末（運営画面や別コートの端末）の書き込みを取りに行く。
    // 通信は待たない。届いたら refreshFromServer が画面を作り直す。
    if (changed) refreshFromServer();
  }

  // --- 他端末の書き込みの取り込み ---
  // 選手を切り替えたときと、画面に戻ってきたとき（タブ切替・スリープ復帰）にサーバーから読み直す。
  // 表示中の選手をこの端末で編集している最中（gridEdited）は画面を作り直さない（入力を壊さない）。
  // 未送信の採点はキューが正なので adoptEvent（Outbox.applyPending）が上書きする。
  var refreshSeq = 0;

  async function refreshFromServer() {
    if (!currentEvent) return;
    var eventId = currentEvent.id;
    var seq = ++refreshSeq;
    var loaded = await Api.loadEvent(eventId);
    if (seq !== refreshSeq) return;                              // 追い越された
    if (!currentEvent || currentEvent.id !== eventId) return;    // 大会が変わった
    if (!loaded) return;                                         // 通信失敗は今の表示を保つ
    var current = visiblePlayers[currentIndex];
    var currentId = current ? current.id : null;
    var keepRow = selectedRow;
    // 編集中の選手は、画面の内容が元にしている版（控えの rev）を保つ。サーバーの新しい rev に
    // 置き換えると、他の端末の更新を知らないまま上書きしてしまう（衝突に気付けない。網羅検証 M2）。
    var keepRev = (gridEdited && current) ? EventStatus.revOf(current) : null;
    adoptEvent(loaded);
    refreshCourtList();
    visiblePlayers = filterForStatus(Courts.filter(players, currentCourt).sort(Courts.compareOrder));   // 試技順（男子の部→女子の部、No. 順）に並べてから状態で絞る（候補を末尾に寄せる処理を保つ）
    var idx = -1;
    for (var i = 0; i < visiblePlayers.length; i++) {
      if (visiblePlayers[i].id === currentId) { idx = i; break; }
    }
    if (idx === -1) {
      // 表示中の選手が消えた（名簿の入れ直しなど）。先頭から出し直す
      applyCourtFilter();
      return;
    }
    currentIndex = idx;
    if (gridEdited) {
      if (keepRev !== null) visiblePlayers[idx].rev = keepRev;
      // 編集中はサーバー値で画面を作り直さない。編集した値は保存のたびにキューへ積んであり、
      // adoptEvent がその値を新しい選手オブジェクトへ反映済みなので、一覧だけ描き直す。
      refreshPlayerList();
      updatePlayerList();
      // 編集中でも、状態バナーとロックは最新に保つ（他端末が大会の状態を進めた場合に備える）。
      renderStatusBanner();
      applyScoringLock();
      return;
    }
    updatePlayerLabels(visiblePlayers[idx]);
    renderScoreGrid(visiblePlayers[idx]);
    selectRow(keepRow);
    refreshPlayerList();
    updatePlayerList();
    renderStatusBanner();
    applyScoringLock();
  }

  function updatePlayerLabels(p) {
    // 順番パース: コート-性別-巡目-番号（コート名は Courts.roundOf 等と同じく「-」を含まない前提）
    var m = (p.order || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    // ゼッケンは持っている選手だけ。コートで呼び出すときに使うので順番の右に添える
    // （未設定の選手に「No.」だけが残らないよう、数値のときだけ足す）。
    var bib = (typeof p.bib === 'number') ? '　No.' + p.bib : '';
    if (m) {
      // 部・巡目・コートは帯の 1 行目に大きく出す（「男子の部　一巡目　A コート」）。
      // 左端のコートのバッジは同じ内容の重複になるので出さない。
      var roundName = m[3] === '1' ? '一巡目' : (m[3] === '2' ? '二巡目' : m[3] + '巡目');
      var stage = m[2] + 'の部　' + roundName + '　' + m[1] + ' コート';
      if (currentStatus() === 'round2_final' && p.finalist === true) {
        stage = finalGroupName() + '　' + m[1] + ' コート';
      }
      playerStageLabel.textContent = stage;
      courtLabel.textContent = '';
      playerOrderLabel.textContent = m[4] + '番' + bib;
    } else {
      playerStageLabel.textContent = '';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = (p.order || '') + bib;
    }
    playerNameLabel.textContent = p.name || '';
    // 級位・段位は名前の右に小さく（空なら :empty で消える）
    playerRankLabel.textContent = Courts.rankLabel(p.rank);

    // 最終組 進行中は、最終組の何人目かを順番の右に添える（設計書「採点画面」）。
    if (currentStatus() === 'round2_final' && p.finalist === true) {
      var fin = Courts.finalists(players);
      var at = 0;
      for (var fi = 0; fi < fin.length; fi++) {
        if (fin[fi].id === p.id) { at = fi + 1; break; }
      }
      if (at > 0) {
        playerOrderLabel.textContent += '　' + EventStatus.FINALIST_LABEL + ' ' + at + '/' + fin.length;
      }
    }
  }

  // --- スコアグリッド描画 ---
  // 編集中に読み直して入れ替えを待たせていた配点を、表を描き直す前に入れる（S17）
  function applyDeferredTechniques() {
    if (!deferredTechEvent) return;
    var ev = deferredTechEvent;
    deferredTechEvent = null;
    applyEventTechniques(ev);
  }

  // 選手の技のうち、技得点表に無いもの（網羅検証 M3）。Courts.unknownTechs に加えて、
  // 採点で引けない技名（Scoring.findTechnique が null）も数える（その行は 0 点・押せない表示になり、
  // 保存すると ○× が消えるため）。
  function unknownTechNames(player) {
    var out = Courts.unknownTechs(player, currentTechList()).slice();
    [player.tech1, player.tech2, player.tech3].filter(Boolean).forEach(function(name) {
      if (!Scoring.findTechnique(name, player.isFemale === true) && out.indexOf(name) === -1) out.push(name);
    });
    return out;
  }

  function renderScoreGrid(player) {
    applyDeferredTechniques();
    scoreTableBody.innerHTML = '';
    gridDirty = false;
    gridEdited = false;
    gridBlocked = false;
    noticeRow = null;
    recalcRow = null;
    selectedRow = -1;
    var techNames = [player.tech1, player.tech2, player.tech3].filter(Boolean);
    totalAdjustInput.value = adjustText(player.totalAdjust);
    noteInput.value = player.note || '';
    // 技が無い選手は補正段ごと隠す（無効の欄に値だけ見えていると「合計に入っていない」ように見えるため）
    adjustBar.classList.toggle('is-hidden', techNames.length === 0);
    totalAdjustRow.classList.toggle('is-hidden', techNames.length === 0);
    if (techNames.length === 0) {
      // 技が未入力（進行タブでまだ入力されていない二巡目の選手など）。
      // 空のグリッドから合計0を計算して上書き保存すると既存の得点が消えるので、
      // 表示だけ既存の得点にして、選手データにも保存キューにも触れない。
      gridRestorable = false;
      var trEmpty = document.createElement('tr');
      var tdEmpty = document.createElement('td');
      tdEmpty.colSpan = 7;
      tdEmpty.className = 'score-empty';
      tdEmpty.textContent = '技が未入力です。運営画面の試合進行で技を入力してください。';
      trEmpty.appendChild(tdEmpty);
      scoreTableBody.appendChild(trEmpty);
      setTotalDisplay(player.score || 0);
      totalAdjustInput.disabled = true;
      noteInput.disabled = true;
      btnNotePreset.disabled = true;
      applyConfirmedStyle(!!player.confirmed);
      applyScoringLock();
      return;
    }
    totalAdjustInput.disabled = false;
    noteInput.disabled = false;
    btnNotePreset.disabled = false;
    // 何も記録されていない選手（得点0で○×も無い）は空のグリッドが正しい状態。
    // result が空白だけでも同じ
    gridRestorable = Scoring.canDecode(player.result, techNames.length) || !Courts.isScored(player);
    var decoded = gridRestorable ? Scoring.decodeResult(player.result, techNames.length, player.adjust) : null;

    // 技得点表に無い技がある選手は、行を赤く示して保存・確定を止める（網羅検証 M3）。
    // その行は配点が引けず 0 点・押せない表示になるので、保存すると ○× が消える。記録には触らない。
    var unknown = unknownTechNames(player);
    gridBlocked = unknown.length > 0;
    if (gridBlocked) {
      var trBad = document.createElement('tr');
      var tdBad = document.createElement('td');
      tdBad.colSpan = 7;
      tdBad.className = 'score-notice tech-unknown-notice';
      tdBad.textContent = '技得点表に無い技があります（' + unknown.join('、') + '）。' +
        'この選手は保存・確定できません（記録は残してあります）。' +
        '運営画面で技を選び直すか、技得点表に技を戻してください。';
      trBad.appendChild(tdBad);
      scoreTableBody.appendChild(trBad);
    }

    if (!decoded) {
      // result を技内訳へ分解できない（技の再割当てなどで長さが噛み合わなくなった
      // 既採点者など）。空欄のグリッドから合計0を計算して上書き保存してしまうと、
      // ここで選手を切り替えるだけで既存の得点が消える。採点し直すまでは
      // 選手データにも保存キューにも触れない（saveCurrentState 側で抑止）。
      var trNotice = document.createElement('tr');
      var tdNotice = document.createElement('td');
      tdNotice.colSpan = 7;
      tdNotice.className = 'score-notice';
      tdNotice.textContent = '内訳を復元できません（技の数が変わっています）。' +
        '採点し直すと現在の得点 ' + (player.score || 0) + '点 は置き換わります。';
      trNotice.appendChild(tdNotice);
      scoreTableBody.appendChild(trNotice);
      noticeRow = trNotice;
    }

    // 技が3つ未満のとき、adjust の添字は「技の枠」ではなく「表示行」に合わせる
    // （tech1..3 を filter(Boolean) しているため）。保存時も同じ順で書く。
    for (var i = 0; i < techNames.length; i++) {
      var rowData = decoded ? decoded[i] : { values: ['','','',''], adjust: 0 };
      var tr = buildScoreRow(techNames[i], player.isFemale, rowData, i, unknown.indexOf(techNames[i]) !== -1 ||
        unknown.indexOf(String(techNames[i]).trim()) !== -1);
      scoreTableBody.appendChild(tr);
    }
    selectRow(0);
    // 開いただけでは p.score・一覧を書き換えない（網羅検証 M4）。合計は保存済みの得点を出し、
    // 今の技得点表で計算し直した値と違えば知らせて「計算し直して保存」を出す。
    var saved = player.score || 0;
    if (decoded && !gridBlocked) {
      var recomputed = gridTotal();
      if (Courts.isScored(player) && recomputed !== saved) {
        showRecalcNotice(saved, recomputed);
        setTotalDisplay(saved);
      } else {
        setTotalDisplay(recomputed);
      }
    } else {
      setTotalDisplay(saved);
    }
    applyConfirmedStyle(!!player.confirmed);
    applyScoringLock();
  }

  // 保存済みの得点と再計算の値が違うことの知らせ（表の先頭の行）と「計算し直して保存」ボタン
  function showRecalcNotice(saved, recomputed) {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'score-notice score-recalc';
    var text = document.createElement('span');
    text.textContent = '技得点表の変更で点が変わります（保存 ' + saved + ' → 再計算 ' + recomputed + '）';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-recalc';
    btn.id = 'btnRecalc';
    btn.textContent = '計算し直して保存';
    btn.addEventListener('click', onRecalc);
    td.appendChild(text);
    td.appendChild(btn);
    tr.appendChild(td);
    scoreTableBody.insertBefore(tr, scoreTableBody.firstChild);
    recalcRow = tr;
  }

  function removeRecalcNotice() {
    if (recalcRow && recalcRow.parentNode) recalcRow.parentNode.removeChild(recalcRow);
    recalcRow = null;
  }

  // 「計算し直して保存」。今の技得点表の配点で合計を出し直して保存する。
  // 確定済みの選手は確定のまま保存し直す（確定し直し）ので、先に確認する。
  function onRecalc() {
    var p = visiblePlayers[currentIndex];
    if (!p || !currentEvent || gridBlocked) return;
    if (!scoringOpenHere()) {
      alert('今は採点できない状態のため、計算し直せません。');
      return;
    }
    var before = p.score || 0;
    var after = gridTotal();
    if (p.confirmed) {
      if (!confirm('確定済みの選手です。\n技得点表の今の配点で計算し直した ' + after + '点（保存 ' + before +
                   '点）で確定し直しますか？')) return;
    }
    gridEdited = true;
    updateTotal();          // p.score を再計算の値にし、知らせの行を外す
    saveCurrentState();
    HistoryOutbox.add(currentEvent.id, {
      action: 'score_update',
      playerName: p.name || '',
      detail: '技得点表の変更で計算し直し（' + before + '点 → ' + after + '点' + (p.confirmed ? '。確定し直し' : '') + '）'
    });
  }

  // unknown が真なら技得点表に無い技の行（赤く示す。記録の ○× は押せない表示で見せるだけ）
  function buildScoreRow(techName, isFemale, rowData, rowIndex, unknown) {
    var tr = document.createElement('tr');
    tr.dataset.tech = techName;
    tr.dataset.row = rowIndex;
    if (unknown) tr.classList.add('tech-unknown');

    var tdName = document.createElement('td');
    tdName.className = 'tech-name';
    tdName.textContent = techName;
    tdName.addEventListener('click', function() { selectRow(rowIndex); });
    tr.appendChild(tdName);

    var tech = Scoring.findTechnique(techName, isFemale);

    // 初〜四ノ太刀
    for (var s = 0; s < 4; s++) {
      var td = document.createElement('td');
      td.className = 'strike-cell';
      td.dataset.strike = s;
      td.dataset.tech = techName;   // 行に付ける前に描くので、技名はセル自身にも持たせる（strikePoints が読む）
      var disabled = !tech || tech.strikes[s] === null;
      if (disabled) {
        td.classList.add('disabled');
        // 技得点表に無い技の行は、記録されている ○× を文字だけで見せる（消えていないことが分かるように）
        if (!tech) {
          var rec = rowData.values[s] || '';
          td.textContent = rec === '○' ? '成功' : rec === '△' ? '減点' : rec === '×' ? '失敗' : '';
        }
      } else {
        td.dataset.value = rowData.values[s] || '';
        setCellDisplay(td, rowData.values[s] || '');
        td.addEventListener('click', onStrikeClick);
      }
      tr.appendChild(td);
    }

    // 補正点（任意の整数。0 は空欄で表示）
    var tdAdj = document.createElement('td');
    tdAdj.className = 'adjust-cell';
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.step = '1';
    inp.inputMode = 'numeric';
    inp.min = String(-ADJUST_LIMIT);
    inp.max = String(ADJUST_LIMIT);
    inp.className = 'adjust-input';
    inp.value = adjustText(rowData.adjust);
    // 置き換えを断られたときに戻す値（この描画時点の補正点。復元不能なら空欄）
    inp.dataset.initial = inp.value;
    inp.addEventListener('focus', function() { selectRow(rowIndex); });
    inp.addEventListener('change', onAdjustChange);
    tdAdj.appendChild(inp);
    tr.appendChild(tdAdj);

    // 得点
    var tdScore = document.createElement('td');
    tdScore.className = 'score-col';
    tr.appendChild(tdScore);

    applyVoiding(tr);
    applySequence(tr);
    updateRowScore(tr, isFemale);
    // 配点が引けない行の得点は出さない（0 点に見せない）
    if (unknown) tdScore.textContent = '—';
    return tr;
  }

  // そのセルの点数。未・成功はその太刀の配点、減点は減点時の点、失敗は 0
  // （常に点数を出しておく。ユーザー要望）。
  function strikePoints(td, value) {
    var tr = td.closest('tr');
    var techName = td.dataset.tech || (tr ? tr.dataset.tech : '');
    if (!techName) return null;
    if (value === '×') return 0;
    var p = visiblePlayers[currentIndex];
    return Scoring.calcStrikeScore(techName, parseInt(td.dataset.strike, 10),
      value === '△' ? '△' : '○', p ? p.isFemale === true : false);
  }

  function setCellDisplay(td, value) {
    td.classList.remove('success', 'fail', 'empty', 'reduced');
    var label;
    if (value === '○') { label = '成功'; td.classList.add('success'); }
    // △（減点成功）。抜刀していた初太刀の胸尽くしなど。失敗ではないので
    // 後ろの太刀は無効にならない（Scoring.failedAt は '×' しか見ない）
    else if (value === '△') { label = '減点'; td.classList.add('reduced'); }
    else if (value === '×') { label = '失敗'; td.classList.add('fail'); }
    else { label = '未'; td.classList.add('empty'); }
    td.textContent = '';
    var main = document.createElement('span');
    main.textContent = label;
    td.appendChild(main);
    var pts = strikePoints(td, value);
    if (pts !== null) {
      var sub = document.createElement('span');
      sub.className = 'strike-pts';
      sub.textContent = pts + '点';
      td.appendChild(sub);
    }
  }

  // 一つの形で途中失敗したら、それ以降の太刀（配点のある太刀）を無効表示にする。
  // 最初の×より前・×が無い行はここで押せる状態（未・成功・失敗）に戻す。
  // 戻り値: この呼び出しで新しく無効になったセルがあるかどうか。
  // 既に無効表示だったセルを塗り直しただけ（例: 失敗点より前のセルを触っただけ）では
  // true にしない。履歴の「（以降の太刀は無効）」をその操作でだけ足すため。
  function applyVoiding(tr) {
    var idx = Scoring.failedAt(rowValues(tr));
    var voided = false;
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      if (!cell || cell.classList.contains('disabled')) continue;
      if (idx !== -1 && s > idx) {
        var wasVoided = cell.classList.contains('voided');
        // ○ のときの配点をそのまま表示する（無効でも元の点数が分かるように）。
        var pts = strikePoints(cell, '○');
        cell.dataset.value = '';
        cell.classList.remove('success', 'fail', 'empty', 'reduced');
        cell.classList.add('voided');
        cell.textContent = '';
        var main = document.createElement('span');
        main.textContent = '無効';
        cell.appendChild(main);
        if (pts !== null) {
          var sub = document.createElement('span');
          sub.className = 'strike-pts';
          sub.textContent = pts + '点';
          cell.appendChild(sub);
        }
        if (!wasVoided) voided = true;
      } else if (cell.classList.contains('voided')) {
        cell.classList.remove('voided');
        setCellDisplay(cell, cell.dataset.value || '');
      }
    }
    return voided;
  }

  // あるセルを「未」に戻したとき、後ろの太刀（配点のある太刀）の値も「未」に戻す。
  // 採点は太刀の順番どおりという前提を保つため（一ノ太刀が未なのに二ノ太刀に値が
  // 残る、という状態を新規の操作では作らない）。
  // 戻り値: 実際に値を戻したセルが1つでもあったか。
  function clearLaterValues(tr, strikeIndex) {
    var cleared = false;
    for (var s = strikeIndex + 1; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      if (!cell || cell.classList.contains('disabled')) continue;
      if ((cell.dataset.value || '') !== '') {
        cell.dataset.value = '';
        setCellDisplay(cell, '');
        cleared = true;
      }
    }
    return cleared;
  }

  // 採点は太刀の順番どおりに。前の太刀（配点のある太刀）が「未」のままなら、
  // 後ろの太刀は押せない（class 'pending' を付ける）。disabled・voided のセルは
  // 対象外（無視して数えない・pending も付けない）。
  function applySequence(tr) {
    var sawEmpty = false;
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      if (!cell) continue;
      if (cell.classList.contains('disabled') || cell.classList.contains('voided')) {
        cell.classList.remove('pending');
        continue;
      }
      cell.classList.toggle('pending', sawEmpty);
      if ((cell.dataset.value || '') === '') sawEmpty = true;
    }
  }

  // 採点できる行（技の行）が出ているか。技が未入力の選手では偽。
  function hasScoreRows() {
    return scoreTableBody.querySelectorAll('tr[data-tech]').length > 0;
  }

  // --- 行の選択 ---
  function selectRow(index) {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    if (rows.length === 0) { selectedRow = -1; return; }
    if (index < 0 || index >= rows.length) index = 0;
    selectedRow = index;
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('selected', i === index);
    }
  }

  function selectedRowEl() {
    if (selectedRow < 0) return null;
    return scoreTableBody.querySelector('tr[data-tech][data-row="' + selectedRow + '"]');
  }

  // 形成功・失敗で行の採点が終わったら、次の技の行を選ぶ（ユーザー要望）。
  // 最後の行では動かない。入力欄へフォーカスは移さない（タブレットでキーボードが出るため）。
  function advanceRow() {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    if (selectedRow < 0 || selectedRow + 1 >= rows.length) return;
    selectRow(selectedRow + 1);
  }

  // 補正点の入力値を整数にし、±ADJUST_LIMIT に収める（網羅検証 S4）。空欄・数値でないものは 0。
  function clampAdjust(raw) {
    var n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-ADJUST_LIMIT, Math.min(ADJUST_LIMIT, n));
  }

  // 入力値が範囲の外か（収める前の値で判定。知らせるため）
  function adjustOutOfRange(raw) {
    var n = parseInt(raw, 10);
    return Number.isFinite(n) && (n > ADJUST_LIMIT || n < -ADJUST_LIMIT);
  }

  // 行の補正点入力欄の値（空欄は 0）
  function rowAdjust(tr) {
    var inp = tr.querySelector('.adjust-input');
    if (!inp) return 0;
    return clampAdjust(inp.value);
  }

  function totalAdjustValue() {
    return clampAdjust(totalAdjustInput.value);
  }

  // --- 配信用ボードへのライブ状態の送信 ---
  // 「今どの選手を開いているか」「タイマーの状態」をサーバーへ置く。board.html（OBS の
  // ブラウザソース）が共有トークン越しに2秒ごとに読む。
  // 送るのは選手が変わったときとタイマーを操作したときだけで、1秒ごとの減算では送らない
  // （board 側が updatedAt からの経過を引いて進める）。
  // 通信は待たず、失敗は握りつぶす。配信が遅れても採点は止めない（alert も出さない）。
  // clear を真にすると、選手がまだ選ばれていても「誰も映さない」を送る
  // （大会から離れるとき。表示中の選手を残すとボードが映し続けてしまう）。
  function publishLive(clear) {
    if (!currentEvent) return;
    // 採点できない状態（準備中・終了・確定済みなど）では配信しない。
    // ただし大会を離れるときの clear は通す（映したままにしないため）。
    if (!clear && !scoringOpen()) return;
    var shown = visiblePlayers[currentIndex] || null;
    var p = clear ? null : shown;
    // 宛先は今映しているコート。全コート表示（currentCourt が空）のときは今の選手から導く。
    // 宛先の判定に p ではなく shown を使うのは、大会から離れるとき（clear）にも
    // 「さっきまで映していた選手のコート」へ届ける必要があるため
    // （大会の選択を外すと currentCourt が先に空になる）。
    // コートが決まらない選手は送らない（サーバーの isValidCourt が弾く値になる）。
    var court = currentCourt || (shown ? Courts.courtOf(shown) : '');
    if (!court || court === Courts.UNASSIGNED) return;
    Api.putLive(currentEvent.id, court, {
      playerId: p ? p.id : null,
      timer: { sec: timerSec, running: timerRunning }
    }).then(function(result) {
      if (!result || result.error) {
        console.warn('ライブ状態を送れませんでした', result && result.error);
      }
    });
  }

  // --- タイマー ---
  // 「開始」を押したことが見えるように、稼働中はボタンと表示にクラスを付ける
  function syncTimerLook() {
    document.getElementById('btnTimerStart').classList.toggle('on', timerRunning);
    timerDisplay.classList.toggle('running', timerRunning);
  }

  function startTimer() {
    if (timerRunning) return;
    timerRunning = true;
    syncTimerLook();
    timerInterval = setInterval(function() {
      if (timerSec > 0) {
        timerSec--;
        var m = Math.floor(timerSec / 60);
        var s = timerSec % 60;
        timerDisplay.textContent = pad(m) + ':' + pad(s);
      } else {
        stopTimer();
        timerDisplay.textContent = '00:00';
      }
    }, 1000);
    publishLive();
  }

  // 計時だけを止める。ライブ状態の送信は呼び出し元がまとめて行う
  // （resetTimer が「止める」と「5分に戻す」で二重に送らないように分けてある）。
  function haltTimer() {
    timerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    syncTimerLook();
  }

  function stopTimer() {
    haltTimer();
    publishLive();
  }

  function resetTimer() {
    haltTimer();
    timerSec = 300;
    timerDisplay.textContent = '05:00';
    publishLive();
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function setTotalDisplay(n) {
    totalScoreValue.textContent = String(n);
    syncTotalWidth();
  }

  // 合計の数字の幅を表の「得点」列にそろえ、数字が得点列の真下で中央にそろうようにする。
  // 表は幅 100% で列幅が内容と画面幅で決まるので、描画のたびに測り直す。
  function syncTotalWidth() {
    var th = scoreTable.querySelector('thead th:last-child');
    if (!th) return;
    var w = th.getBoundingClientRect().width;
    if (w > 0) totalScoreBox.style.minWidth = Math.round(w) + 'px';
  }
  window.addEventListener('resize', syncTotalWidth);

  // 確定済みの見た目（得点列・合計・下部一覧の得点を青）とボタンの状態
  function applyConfirmedStyle(on) {
    scoreTable.classList.toggle('confirmed', on);
    totalScoreDisplay.classList.toggle('confirmed', on);
    btnConfirm.classList.toggle('on', on);
    btnConfirm.textContent = on ? '確定済み' : '確定';
    updatePlayerListConfirmed(currentIndex, on);
  }

  // 選手が表示されていないとき（大会未選択・そのコートに選手がいない）の補正段
  function clearAdjustInputs() {
    adjustBar.classList.add('is-hidden');
    totalAdjustRow.classList.add('is-hidden');
    totalAdjustInput.value = '';
    noteInput.value = '';
    totalAdjustInput.disabled = true;
    noteInput.disabled = true;
    btnNotePreset.disabled = true;
    closeNotePresetSheet();   // 選手がいなくなったら、開いていた文例シートも片付ける
    applyConfirmedStyle(false);
  }

  // 得点に関わる編集をしたら確定を解除する（保存は呼び出し元の saveCurrentState が行う）
  function unconfirmIfNeeded() {
    var p = visiblePlayers[currentIndex];
    if (!p || !p.confirmed) return;
    p.confirmed = false;
    applyConfirmedStyle(false);
  }

  function onConfirm() {
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    var p = visiblePlayers[currentIndex];
    if (!p) return;
    // 確定済みで押したら確定を取り消す（トグル。ユーザー要望）。技の有無を先に見ると、
    // 技が無い確定済みの選手をただ開いただけで無関係な警告が出るので、ここで分岐する。
    if (p.confirmed) {
      if (gridBlocked) return;   // 技得点表に無い技がある選手は触らない（ボタンも無効）
      if (!confirm('確定を取り消しますか？（取り消すと点数を直せます）')) return;
      p.confirmed = false;
      applyConfirmedStyle(false);
      applyScoringLock();
      // 取り消しは確定の印だけを送る（網羅検証 S5）。画面の全項目を送ると、内訳を復元できない
      // 選手では送れず（saveCurrentState が止める）、復元できても他の値まで書き戻してしまう。
      Outbox.enqueue({
        eventId: currentEvent.id,
        playerId: p.id,
        confirmed: false,
        baseRev: EventStatus.revOf(p)
      });
      HistoryOutbox.add(currentEvent.id, {
        action: 'unconfirm',
        playerName: p.name || '',
        detail: '確定を取り消し（' + (p.score || 0) + '点）'
      });
      return;
    }
    confirmCurrent(false);
  }

  // 「確定して次へ ▶」（ユーザー要望 2026-10-04）。確定ボタンと次の選手ボタンを 1 回で。
  // 未確定なら確定（確定の確認文はそのまま出る）してから次の選手へ。確定できなければ留まる。
  // 確定済みで押したら、取り消しはせずに次の選手へ移るだけ（取り消しは「確定済み」ボタンで）。
  // 最後の選手なら確定だけして、その旨を知らせる。
  function onConfirmNext() {
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    var p = visiblePlayers[currentIndex];
    if (!p) return;
    if (!p.confirmed && !confirmCurrent(false)) return;
    var next = currentIndex + 1;
    if (next >= visiblePlayers.length) {
      alert('確定しました。この選手が最後です。');
      return;
    }
    saveCurrentState();
    selectPlayer(next);
  }

  // 表示中の選手を確定できるか（技があり、内訳が復元できている）。
  // confirmLeave はこれで「確定して移動」か「確定せずに移動」かの文言を選ぶ。
  function canConfirmCurrent() {
    if (!hasScoreRows()) return false;
    if (gridBlocked) return false;
    if (!gridRestorable && !gridDirty) return false;
    return true;
  }

  // 表示中の選手を確定する。確定ボタンと、未確定で移動するときの「確定して次へ」から呼ぶ。
  // quiet が true のときは理由の alert を出さない。確定できたら true。
  function confirmCurrent(quiet) {
    var p = visiblePlayers[currentIndex];
    if (!p || !currentEvent) return false;
    if (!hasScoreRows()) {
      if (!quiet) alert('技が未入力のため確定できません。');
      return false;
    }
    if (gridBlocked) {
      if (!quiet) alert('技得点表に無い技があるため確定できません。\n運営画面で技を選び直すか、技得点表に技を戻してください。');
      return false;
    }
    if (!gridRestorable && !gridDirty) {
      if (!quiet) alert('内訳を復元できない選手は、採点し直してから確定してください。');
      return false;
    }
    // 保存済みの得点と今の配点での再計算が違う（技得点表が変わった）なら、再計算の値で確定してよいか聞く（M4）
    if (recalcRow) {
      var recomputed = gridTotal();
      if (!confirm('技得点表の変更で点が変わります（保存 ' + (p.score || 0) + ' → 再計算 ' + recomputed + '）。\n' +
                   '再計算した ' + recomputed + '点 で確定しますか？')) return false;
    }
    // 未の太刀が残っていたら、すべて失敗にしてよいか聞く（ユーザー要望 2026-09-30）。
    // OK なら各行の最初の「未」を失敗にする（以降の太刀は無効になる）。キャンセルなら確定しない。
    if (hasEmptyStrikes()) {
      if (!confirm('未の太刀が残っています。\nすべて失敗にして確定しますか？')) return false;
      failRemainingStrikes(p);
    }
    // 表の内容で合計を出し直して保存する（開いただけでは p.score を書き換えていないため。M4）
    updateTotal();
    p.confirmed = true;
    gridEdited = true;
    applyConfirmedStyle(true);
    applyScoringLock();   // 確定済みは点数を触れない
    saveCurrentState();
    HistoryOutbox.add(currentEvent.id, {
      action: 'confirm',
      playerName: p.name || '',
      detail: '確定（' + (p.score || 0) + '点）'
    });
    return true;
  }

  // 補正点の欄に入れる表示文字列（0 と非数は空欄）
  function adjustText(v) {
    return Number(v) ? String(Math.trunc(v)) : '';
  }

  function onTotalAdjustChange() {
    if (!currentEvent || !hasScoreRows() || gridBlocked) return;
    var p = visiblePlayers[currentIndex];
    // 置き換えを断られたら、入力を保存値へ戻す。空欄にすると表示と
    // player.totalAdjust が食い違い、次の置き換えで 0 として消える。
    if (!confirmReplaceIfNeeded()) {
      totalAdjustInput.value = p ? adjustText(p.totalAdjust) : '';
      return;
    }
    if (adjustOutOfRange(totalAdjustInput.value)) {
      alert('全体補正点は -' + ADJUST_LIMIT + '〜' + ADJUST_LIMIT + ' の範囲です。範囲に収めました。');
    }
    var n = totalAdjustValue();
    totalAdjustInput.value = adjustText(n);
    gridEdited = true;
    unconfirmIfNeeded();
    updateTotal();
    saveCurrentState();
    HistoryOutbox.add(currentEvent.id, {
      action: 'score_update',
      playerName: p ? p.name : '',
      detail: '全体補正点 → ' + n
    });
  }

  // 備考は得点に影響しないので、内訳を復元できない選手でも保存する。
  // 採点（score / result）を載せないエントリを積むので、既存の得点は動かない。
  // 確定も解除しない。
  function onNoteChange() {
    if (!currentEvent) return;
    var p = visiblePlayers[currentIndex];
    if (!p) return;
    p.note = noteInput.value.trim().slice(0, 200);
    Outbox.enqueue({ eventId: currentEvent.id, playerId: p.id, note: p.note });
    updatePlayerListNote(currentIndex, p.note);
  }

  // 備考の文例シート（下部固定パネル）。開いている間は全画面を覆い、
  // 外側タップと「閉じる」で閉じる（techpicker.js のシートと同じ見た目・作法）。
  var notePresetOverlay = null;

  function closeNotePresetSheet() {
    if (notePresetOverlay && notePresetOverlay.parentNode) {
      notePresetOverlay.parentNode.removeChild(notePresetOverlay);
    }
    notePresetOverlay = null;
  }

  function openNotePresetSheet() {
    if (!scoringOpenHere()) return;   // ボタンは無効化してあるが、念のため
    closeNotePresetSheet();

    var overlay = document.createElement('div');
    overlay.className = 'note-preset-overlay';
    var sheet = document.createElement('div');
    sheet.className = 'note-preset-sheet';

    var head = document.createElement('div');
    head.className = 'note-preset-head';
    var title = document.createElement('span');
    title.textContent = '文例を選ぶ';
    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'note-preset-close';
    btnClose.textContent = '閉じる';
    head.appendChild(title);
    head.appendChild(btnClose);

    var list = document.createElement('div');
    list.className = 'note-preset-list';
    NOTE_PRESETS.forEach(function(preset) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'note-preset-item';
      item.textContent = preset;
      item.addEventListener('click', function() {
        pickNotePreset(preset);
        closeNotePresetSheet();
      });
      list.appendChild(item);
    });

    sheet.appendChild(head);
    sheet.appendChild(list);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    notePresetOverlay = overlay;

    btnClose.addEventListener('click', closeNotePresetSheet);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeNotePresetSheet();   // シートの外側をタップしたら閉じる
    });
  }

  // 文例を備考の末尾に追記し、onNoteChange と同じ経路（Outbox.enqueue）で保存する。
  // 200文字を超える分は Scoring.appendNote が切るので、ここでは超えていたかどうかだけ判定して alert する。
  function pickNotePreset(preset) {
    var current = noteInput.value || '';
    var alreadyIncluded = current.indexOf(preset) !== -1;
    var wouldExceed = !alreadyIncluded && (current ? current.length + 1 + preset.length : preset.length) > 200;
    noteInput.value = Scoring.appendNote(current, preset);
    onNoteChange();
    if (wouldExceed) alert('備考は 200 文字までです');
  }

  function onAdjustChange(e) {
    var inp = e.currentTarget;
    var tr = inp.closest('tr');
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    if (gridBlocked) return;   // 技得点表に無い技がある選手は保存しない（入力欄も無効）
    // 断られたら描画時の値へ戻す（空欄にしない。理由は onTotalAdjustChange と同じ）
    if (!confirmReplaceIfNeeded()) { inp.value = inp.dataset.initial || ''; return; }
    if (adjustOutOfRange(inp.value)) {
      alert('補正点は -' + ADJUST_LIMIT + '〜' + ADJUST_LIMIT + ' の範囲です。範囲に収めました。');
    }
    var n = rowAdjust(tr);
    inp.value = adjustText(n);
    var p = visiblePlayers[currentIndex];
    gridEdited = true;
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    HistoryOutbox.add(currentEvent.id, {
      action: 'score_update',
      playerName: p ? p.name : '',
      techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10),
      strike: 'adjust',
      value: n,
      detail: '補正点 → ' + n
    });
  }

  // 復元できないグリッドへ最初に触れたときだけ、既存の得点を置き換える旨を確認する。
  // OK なら gridDirty を立てて以降は毎回聞かない。キャンセルなら呼び出し元は何もしない。
  function confirmReplaceIfNeeded() {
    if (gridRestorable) return true;
    if (gridDirty) return true;
    var p = visiblePlayers[currentIndex];
    var n = p ? (p.score || 0) : 0;
    if (!confirm('記録済みの ' + n + '点 を、いま入力する内容で置き換えます。よろしいですか？')) return false;
    gridDirty = true;
    // 置き換えが確定したので、復元不能を知らせる行はもう不要
    if (noticeRow && noticeRow.parentNode) {
      noticeRow.parentNode.removeChild(noticeRow);
    }
    noticeRow = null;
    return true;
  }

  // --- 採点インタラクション ---
  var STRIKE_LABELS = ['初太刀', '二ノ太刀', '三ノ太刀', '四ノ太刀'];

  function onStrikeClick(e) {
    if (!scoringOpenHere()) return;   // 採点できない状態（理由はバナーに出ている）
    if (currentConfirmed()) return;   // 確定済みは触れない（確定済みボタンで取り消してから）
    if (gridBlocked) return;         // 技得点表に無い技がある選手は保存しない（M3）
    var td = e.currentTarget;
    if (td.classList.contains('disabled') || td.classList.contains('voided') ||
        td.classList.contains('pending')) return;
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    // 技が無い選手は採点できない
    if (!hasScoreRows()) return;
    if (!confirmReplaceIfNeeded()) return;

    var tr = td.closest('tr');
    selectRow(parseInt(tr.dataset.row, 10));
    var strikeIndex = parseInt(td.dataset.strike, 10);
    var p = visiblePlayers[currentIndex];
    var isFemale = p ? p.isFemale : false;
    // △（減点成功）を出せるセルだけ 未→○→△→×→未 の順。それ以外は従来どおり
    // 未→○→×→未（設計書 2026-09-20-rules-alignment-design.md）
    var reducible = Scoring.canReduce(tr.dataset.tech, strikeIndex, isFemale);
    var current = td.dataset.value || '';
    var next;
    if (reducible) {
      next = current === '' ? '○' : current === '○' ? '△' : current === '△' ? '×' : '';
    } else {
      next = current === '' ? '○' : current === '○' ? '×' : '';
    }
    td.dataset.value = next;
    setCellDisplay(td, next);
    // 未に戻したときは、順番の前提を保つため後ろの太刀の値も未に戻す
    var laterCleared = next === '' ? clearLaterValues(tr, strikeIndex) : false;
    var voided = applyVoiding(tr);
    applySequence(tr);

    gridEdited = true;
    unconfirmIfNeeded();
    updateRowScore(tr, isFemale);
    updateTotal();
    saveCurrentState();

    var detail;
    if (next === '△') {
      var reducedPts = Scoring.calcStrikeScore(tr.dataset.tech, strikeIndex, '△', isFemale);
      detail = STRIKE_LABELS[strikeIndex] + ' → 減点成功（' + reducedPts + '点）';
    } else {
      detail = STRIKE_LABELS[strikeIndex] + ' → ' +
                (next === '○' ? '成功' : next === '×' ? '失敗' : '未');
    }
    if (voided) detail += '（以降の太刀は無効）';
    if (laterCleared) detail += '（以降の太刀も未に）';
    HistoryOutbox.add(currentEvent.id, {
      action: 'score_update',
      playerName: p ? p.name : '',
      techName: tr.dataset.tech,
      // 同じ技を複数の枠に入れられるので、techName だけでは行を特定できない。
      // buildScoreRow が振った 0 始まりの行番号（tr.dataset.row）も残す。
      techRow: parseInt(tr.dataset.row, 10),
      strike: strikeIndex,
      value: next,
      detail: detail
    });
  }

  function rowValues(tr) {
    var values = [];
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      values.push(cell && !cell.classList.contains('disabled') ? (cell.dataset.value || '') : '');
    }
    return values;
  }

  // 行に何も入っていない（太刀が全部「未」で補正も 0）か
  function rowIsBlank(tr) {
    var values = rowValues(tr);
    for (var i = 0; i < 4; i++) if (values[i]) return false;
    return rowAdjust(tr) === 0;
  }

  function updateRowScore(tr, isFemale) {
    var rowScore = Scoring.calcRowScore(tr.dataset.tech, rowValues(tr), rowAdjust(tr), isFemale);
    var scoreCell = tr.querySelector('.score-col');
    // 何も入っていない行は空欄。入力があれば 0 や負の数もそのまま見せる
    scoreCell.textContent = rowIsBlank(tr) ? '' : String(rowScore);
    scoreCell.dataset.score = String(rowScore);
  }

  // 表の内容（今の配点）での合計。書き込みはしない。
  function gridTotal() {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      var sc = rows[i].querySelector('.score-col');
      if (sc) total += parseInt(sc.dataset.score, 10) || 0;
    }
    return total + totalAdjustValue();
  }

  // 編集したときに呼ぶ。表の合計を選手の得点にし、表示・一覧も合わせる。
  // 表を描いただけ（選手を開いただけ）では呼ばない（網羅検証 M4。保存済みの得点を勝手に変えない）。
  function updateTotal() {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    // 技が無い選手は採点できない
    if (rows.length === 0) return;
    var total = gridTotal();
    setTotalDisplay(total);
    removeRecalcNotice();   // 編集で再計算の値になったので、配点の変更の知らせはもう要らない
    if (visiblePlayers[currentIndex] !== undefined) {
      visiblePlayers[currentIndex].score = total;
      updatePlayerListScore(currentIndex, total);
    }
  }

  // 現在の採点内容をキューに積む。通信は待たない（Outboxのワーカーが送る）。
  // 呼び出し元には選手の切り替え（前後ボタン・一覧のクリック）も含まれるので、
  // この端末で編集していない選手は何も送らない。送ると、画面を開いてから
  // 他端末が付けた確定・備考・得点を、こちらの古い表示で巻き戻してしまう。
  function saveCurrentState() {
    if (!gridEdited) return;
    if (currentIndex < 0 || !visiblePlayers[currentIndex] || !currentEvent) return;
    // 内訳を復元できない選手は、採点し直すまで保存しない
    // （空のグリッドを送ると内訳が消え、次回 0 点で上書きされる）
    if (!gridRestorable && !gridDirty) return;
    // 技得点表に無い技がある選手は保存しない（その行が空で書かれ ○× が消えるため。M3）
    if (gridBlocked) return;
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    var rowDataArr = [];
    var adjust = [0, 0, 0];
    for (var i = 0; i < rows.length; i++) {
      rowDataArr.push({ values: rowValues(rows[i]) });
      if (i < 3) adjust[i] = rowAdjust(rows[i]);
    }
    var p = visiblePlayers[currentIndex];
    p.result = Scoring.encodeResult(rowDataArr);
    p.adjust = adjust;
    p.totalAdjust = totalAdjustValue();
    p.note = noteInput.value.trim().slice(0, 200);
    p.confirmed = !!p.confirmed;

    Outbox.enqueue({
      eventId: currentEvent.id,
      playerId: p.id,
      score: p.score,
      result: p.result,
      adjust: p.adjust,
      totalAdjust: p.totalAdjust,
      note: p.note,
      confirmed: p.confirmed,
      // この画面がその選手を読み込んだ時点の版。別の端末が先に更新していればサーバーが 409 stale を返す（M2）
      baseRev: EventStatus.revOf(p)
    });
  }

  // 「形成功」: 選択中の技の行の打てる太刀をすべて成功にする（失敗も成功に変える）
  function setAllSuccess() {
    var tr = guardRowAction();
    if (!tr) return;
    var p = visiblePlayers[currentIndex];
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      if (cell && !cell.classList.contains('disabled')) {
        cell.dataset.value = '○';
        setCellDisplay(cell, '○');
      }
    }
    applyVoiding(tr);
    applySequence(tr);
    gridEdited = true;
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    HistoryOutbox.add(currentEvent.id, {
      action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10), strike: 'all', value: '○', detail: '形成功'
    });
    advanceRow();
  }

  // 「失敗」: 選択中の技の行の最初の「未」（配点のある太刀）を失敗にする（残りは自動で無効になる）
  // 行の最初の「未」（配点があり、無効になっていない、値の無いセル）。無ければ null
  function firstEmptyStrike(tr) {
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      if (cell && !cell.classList.contains('disabled') && !cell.classList.contains('voided') &&
          (cell.dataset.value || '') === '') return cell;
    }
    return null;
  }

  // 表のどこかに「未」が残っているか
  function hasEmptyStrikes() {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    for (var i = 0; i < rows.length; i++) {
      if (firstEmptyStrike(rows[i])) return true;
    }
    return false;
  }

  // 残っている「未」をすべて失敗にする（確定のときに OK されたら）。行ごとに最初の未を × にし、
  // 以降の太刀は applyVoiding で無効になる。保存は呼び出し元（確定）の saveCurrentState が行う。
  function failRemainingStrikes(p) {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var target = firstEmptyStrike(tr);
      if (!target) continue;
      target.dataset.value = '×';
      setCellDisplay(target, '×');
      applyVoiding(tr);
      applySequence(tr);
      updateRowScore(tr, p ? p.isFemale : false);
      HistoryOutbox.add(currentEvent.id, {
        action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
        techRow: parseInt(tr.dataset.row, 10), strike: 'rest', value: '×',
        detail: '確定時に未を失敗に（以降の太刀は無効）'
      });
    }
    gridEdited = true;
    updateTotal();
  }

  function setAllFail() {
    var tr = guardRowAction();
    if (!tr) return;
    var target = null;
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      if (cell && !cell.classList.contains('disabled') && !cell.classList.contains('voided') &&
          (cell.dataset.value || '') === '') {
        target = cell;
        break;
      }
    }
    // 行に未が無ければ何もしない
    if (!target) return;
    var p = visiblePlayers[currentIndex];
    target.dataset.value = '×';
    setCellDisplay(target, '×');
    var voided = applyVoiding(tr);
    applySequence(tr);
    gridEdited = true;
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    HistoryOutbox.add(currentEvent.id, {
      action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10), strike: 'rest', value: '×',
      detail: '未を失敗に' + (voided ? '（以降の太刀は無効）' : '')
    });
    advanceRow();
  }

  // 形成功・失敗の共通ガード。対象の行（tr）を返す。操作できなければ null。
  function guardRowAction() {
    if (!currentEvent) { alert('大会が選択されていません。'); return null; }
    if (gridBlocked) { alert('技得点表に無い技があるため採点できません。'); return null; }
    if (!hasScoreRows()) {
      alert('技が未入力のため採点できません。運営画面の試合進行で技を入力してください。');
      return null;
    }
    // 行があれば renderScoreGrid が必ず1行目を選ぶので、いまは到達しない。
    // 選択を外せるようにしたときのための保険として残す。
    var tr = selectedRowEl();
    if (!tr) { alert('形（技名）をタップして選んでください。'); return null; }
    if (!confirmReplaceIfNeeded()) return null;
    return tr;
  }

  // CSV エクスポート・成績表（HTML）の保存は運営画面へ移した（試合進行の ⋯ と結果確認。2026-09-29）。
  // コート端末は目の前の選手の採点だけを受け持つ。

  // --- 選手一覧（ページ下部・開閉） ---
  // 初期状態: 端末の記憶があればそれ、無ければ画面幅 768px 以上で開く
  function initPlayerListOpen() {
    var open = window.innerWidth >= 768;
    try {
      var saved = localStorage.getItem(PLAYER_LIST_KEY);
      if (saved === '1') open = true;
      else if (saved === '0') open = false;
    } catch (e) {}
    setPlayerListOpen(open, false);
  }

  function setPlayerListOpen(open, remember) {
    playerListSection.classList.toggle('closed', !open);
    var btn = document.getElementById('btnPlayerListToggle');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.querySelector('.player-list-arrow').textContent = open ? '▾' : '▸';
    if (remember) {
      try { localStorage.setItem(PLAYER_LIST_KEY, open ? '1' : '0'); } catch (e) {}
    }
    if (open) renderPlayerList();
  }

  function isPlayerListOpen() {
    return !playerListSection.classList.contains('closed');
  }

  function togglePlayerList() {
    setPlayerListOpen(!isPlayerListOpen(), true);
  }

  function renderPlayerList() {
    playerListBody.innerHTML = '';
    // 男子の部・女子の部の帯で分ける（並びは visiblePlayers のまま。性別が切り替わる所に帯を入れる）
    var lastSex = null;
    var rounds = {};
    visiblePlayers.forEach(function(p) { rounds[Courts.roundOf(p)] = true; });
    var manyRounds = Object.keys(rounds).length > 1;   // 複数の巡目が並ぶ状態（準備中・形登録・最終結果など）
    for (var i = 0; i < visiblePlayers.length; i++) {
      var r = Courts.roundOf(visiblePlayers[i]);
      var sex = (visiblePlayers[i].isFemale === true ? '女子の部' : '男子の部') +
        (manyRounds ? ('　' + (r === 1 ? '一巡目' : r === 2 ? '二巡目' : r + '巡目')) : '');
      if (sex !== lastSex) {
        var band = document.createElement('tr');
        band.className = 'player-list-band';
        var td = document.createElement('td');
        td.colSpan = 9;
        td.textContent = sex;
        band.appendChild(td);
        playerListBody.appendChild(band);
        lastSex = sex;
      }
      playerListBody.appendChild(buildPlayerListRow(i));
    }
  }

  function buildPlayerListRow(index) {
    var p = visiblePlayers[index];
    var tr = document.createElement('tr');
    tr.dataset.index = index;
    if (index === currentIndex) tr.classList.add('current-player');
    if (p.confirmed) tr.classList.add('done');   // 確定済みの行はグレー（ユーザー要望）
    // 最終組（一巡目上位 4 名）の行は番号の右に「最終組」の印。二巡目 進行中はまだ採点できないので
    // 薄く出す（tr.finale。設計書 2026-09-28）。
    var isFinale = p.finalist === true && Courts.roundOf(p) === 2;
    if (isFinale && currentStatus() === 'round2') tr.classList.add('finale');
    var hasBib = (typeof p.bib === 'number');
    tr.innerHTML =
      '<td>' + esc(p.order || '') + (isFinale ? ' <span class="finale-mark">' + esc(EventStatus.FINALIST_LABEL) + '</span>' : '') + '</td>' +
      // 未設定は薄い「—」（数値なので esc は要らないが、列を空にはしない）
      '<td' + (hasBib ? '' : ' class="no-bib"') + '>' + (hasBib ? p.bib : '—') + '</td>' +
      '<td class="name">' + esc(p.name || '') + '</td>' +
      // 級位・段位は空なら空セル（ゼッケンと違い「—」は出さない）
      '<td>' + esc(Courts.rankLabel(p.rank)) + '</td>' +
      '<td>' + esc(p.tech1 || '') + '</td>' +
      '<td>' + esc(p.tech2 || '') + '</td>' +
      '<td>' + esc(p.tech3 || '') + '</td>' +
      // 得点は確定済みだけ出す（採点途中の値は一覧に出さない。ユーザー要望 2026-09-30）
      '<td class="score' + (p.confirmed ? ' confirmed' : '') + '">' + (p.confirmed ? (p.score || 0) : '') + '</td>' +
      // 備考は残り幅を吸収する列。折り返し可
      '<td class="note">' + esc(p.note || '') + '</td>';
    tr.addEventListener('click', function() {
      var idx = parseInt(this.dataset.index, 10);
      if (idx !== currentIndex && !confirmLeave()) return;
      saveCurrentState();
      selectPlayer(idx);
    });
    return tr;
  }

  // 選手データ自体が入れ替わったとき用（開いていれば一覧を作り直す）
  function refreshPlayerList() {
    if (!isPlayerListOpen()) return;
    renderPlayerList();
  }

  function updatePlayerList() {
    if (!isPlayerListOpen()) return;
    var rows = playerListBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var idx = parseInt(rows[i].dataset.index, 10);
      rows[i].classList.toggle('current-player', idx === currentIndex);
    }
    // 現在の選手行を表示領域内にスクロール
    scrollPlayerListTo(playerListBody.querySelector('tr.current-player'));
  }

  // 一覧の枠（.player-list-body）の中だけをスクロールさせる。
  // 一覧はページ下部のフローに置いたので、scrollIntoView を使うとページ全体が動き、
  // スマホでは「次の選手」ボタンが画面の外へ逃げてしまう。
  function scrollPlayerListTo(row) {
    var box = document.getElementById('playerListBody-wrap');
    if (!box || !row) return;
    var boxRect = box.getBoundingClientRect();
    var rowRect = row.getBoundingClientRect();
    // 見出し行は position:sticky で枠の上端に居座るので、その分だけ下を使う
    var head = box.querySelector('thead');
    var headHeight = head ? head.getBoundingClientRect().height : 0;
    var top = boxRect.top + headHeight;
    if (rowRect.top < top) {
      box.scrollTop -= top - rowRect.top;
    } else if (rowRect.bottom > boxRect.bottom) {
      box.scrollTop += rowRect.bottom - boxRect.bottom;
    }
  }

  function updatePlayerListScore(index, score) {
    if (!isPlayerListOpen()) return;
    var p = visiblePlayers[index];
    if (!p || p.confirmed !== true) return;   // 確定前の途中の値は一覧に出さない
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    var cell = row ? row.querySelector('td.score') : null;
    if (cell) cell.textContent = score;
  }

  function updatePlayerListConfirmed(index, on) {
    if (!isPlayerListOpen()) return;
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    if (row) {
      row.classList.toggle('done', on);
      var cell = row.querySelector('td.score');
      if (cell) {
        cell.classList.toggle('confirmed', on);
        // 確定したら得点を出し、取り消したら消す
        var p = visiblePlayers[index];
        cell.textContent = on ? String((p && p.score) || 0) : '';
      }
    }
  }

  // 備考を変えたとき（手入力・文例）に一覧の備考セルを書き換える
  function updatePlayerListNote(index, note) {
    if (!isPlayerListOpen()) return;
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    var cell = row ? row.querySelector('td.note') : null;
    if (cell) cell.textContent = note || '';
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', App.init);
