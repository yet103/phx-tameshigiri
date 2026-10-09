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
  // 選手一覧はコートごとの区画（ユーザー要望 2026-10-05）。採点の下に縦に積み、コートごとに折りたたむ。
  // 利用者が開閉したコート（court → true / false）。既定は採点中のコートだけ開く（どの窓幅でも同じ。
  // 2026-10-05 の「PC では全コートを開いたまま」はユーザー要望でやめた）。
  // 採点中のコートが変わったら忘れる（新しいコートだけ開いた状態に戻す）。
  var listOpen = {};
  var listOpenCourt = null;  // listOpen を記録したときの採点中のコート
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
  // 一覧の行をドラッグして試技順を入れ替えられるか（ユーザー要望 2026-10-05）。運営（role admin: Basic・開発）だけ。
  // 採点の鍵の端末と、セッションを読めなかったときは出さない（サーバーも reorder は運営だけ。server/authz.js）。
  var canReorder = false;
  // ダッシュボード（dashboard.html）の面として iframe の中で開かれているか。面の中では、持ち主になるまでは
  //   ・配信の状態（live。配信用ボードと運営画面の「いま採点中」）を送らない（採点席の端末が持ち主。
  //     面が開いただけで先頭の選手に上書きされていた。実況席の使い方の確認 2026-10-07）
  //   ・採点席が映している選手とタイマーを追いかける（refreshFromServer の followLive）
  var embedded = (function() { try { return window.self !== window.top; } catch (e) { return true; } })();
  // 配信の持ち主か。通常の採点画面は常に持ち主。面（iframe）は、人がその面で操作した（選手を選ぶ・タイマー・採点）
  // ときから持ち主になる（takeOwnership。以後は追いかけず、publishLive を送る。レビュー指摘 2026-10-07）
  var liveOwner = !embedded;
  // ダッシュボードの閲覧専用の面（設計書 2026-10-10）。採点行為だけ禁止で、一覧の選手は見るだけで選べる。
  // 面として開かれた直後は親の body.dash-edit の有無で決め、以後は親が ScoringApp.setViewOnly で切り替える。
  // 通常の採点画面（iframe でない）は常に false（挙動は変えない）。
  var viewOnly = false;
  var viewPinnedId = null;       // 見るだけで選んだ選手の id（null なら採点席を追いかける）
  var viewPinnedLiveId = null;   // 選んだ時点で採点席が映していた選手の id（待機中なら null）
  var viewBandKey = '';          // 「採点中: …」の帯を最後に組んだときの採点席の選手 id
  var viewBandTimerHandle = null; // 帯の残り時間を毎秒書き換える setInterval
  if (embedded) {
    try { viewOnly = !window.parent.document.body.classList.contains('dash-edit'); } catch (e) { viewOnly = false; }
  }

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
  var playerListCourts = document.getElementById('playerListCourts');
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
    if (viewOnly) applyViewOnlyUi();   // 閲覧専用の面は、最初から操作ボタンを出さない
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
    canReorder = !!(session && session.ok && session.role === 'admin');
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

    // 閲覧専用の面ではボタン自体が見えないが、念のため手元でも止める（applyLiveTimer からの startTimer は通す）
    document.getElementById('btnTimerStart').addEventListener('click', function() { if (viewOnly) return; takeOwnership(); startTimer(); });
    document.getElementById('btnTimerStop').addEventListener('click', function() { if (viewOnly) return; takeOwnership(); stopTimer(); });
    document.getElementById('btnTimerReset').addEventListener('click', function() { if (viewOnly) return; takeOwnership(); resetTimer(); });

    document.getElementById('btnAllSuccess').addEventListener('click', setAllSuccess);
    document.getElementById('btnAllFail').addEventListener('click', setAllFail);

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
    courtSelect.addEventListener('change', function() { changeCourt(this.value); });
    document.getElementById('btnRetrySave').addEventListener('click', function() {
      Outbox.flushNow();
    });

    // タブ切替やスリープから戻ったら、他端末の書き込みを取りに行く
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') refreshFromServer();
    });
    // 画面を見ている間は 10 秒ごとにも読み直す（他のコートの確定を一覧と順位表に反映する。ユーザー要望 2026-10-05）。
    // refreshFromServer は編集中（gridEdited）の採点欄を作り直さず、ドラッグ中は一覧の描き直しを保留するので安全
    setInterval(function() {
      if (document.visibilityState === 'visible' && currentEvent && !listDrag) refreshFromServer();
    }, AUTO_REFRESH_MS);

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
    courtSelect.disabled = viewOnly || (!!scorerSession && courtSelect.options.length <= 1);
  }

  // 採点中のコートを切り替える（コートの選択欄の change と、他のコートの一覧の行のクリック）。
  // 未確定の選手から離れるときの確認（confirmLeave）は今までどおり。playerId を渡すと、
  // 切り替えた先でその選手を開く（無ければ先頭）。戻り値: 切り替えたら true。
  function changeCourt(court, playerId) {
    if (!confirmLeave()) { courtSelect.value = currentCourt; return false; }
    saveCurrentState();   // 一覧の行で選手を移るときと同じく、離れる前に今の選手を送る（未編集なら何もしない）
    currentCourt = court;
    courtSelect.value = court;
    applyCourtFilter(playerId);
    if (currentEvent) Route.set(currentEvent.id, currentCourt);
    return true;
  }

  // コートの一覧の並び（試技順に並べてから大会の状態で絞る。Courts.listForStatus）
  function courtPlayers(court) {
    return Courts.listForStatus(players, court, currentEvent ? currentStatus() : null);
  }

  // 絞り込みを適用して画面を作り直す。preferId（省略可）の選手がいればその選手を、無ければ先頭を開く
  function applyCourtFilter(preferId) {
    visiblePlayers = courtPlayers(currentCourt);
    currentIndex = -1;
    if (visiblePlayers.length > 0) {
      var start = 0;
      for (var i = 0; preferId && i < visiblePlayers.length; i++) {
        if (visiblePlayers[i].id === preferId) { start = i; break; }
      }
      selectPlayer(start);
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

  // いま開いている選手を採点してよいか。状態が採点できるかだけで決まる（行ごとの制限は無い。
  // 設計書 2026-10-05）。呼び出し側が多いので名前は残す。
  function scoringOpenHere() {
    return scoringOpen();
  }

  // 大会選択バーの下の状態バナー。採点できるかどうかと、できないときの次の手を出す。
  function renderStatusBanner() {
    var el = document.getElementById('statusBanner');
    if (!el) return;
    if (!currentEvent) { el.hidden = true; el.textContent = ''; return; }
    var st = currentStatus();
    el.hidden = false;
    if (EventStatus.isScoringOpen(st)) {
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
    var locked = !!currentEvent && !scoringOpen();
    // 確定済みは「採点できる状態」のまま入力だけ止める。確定ボタンは押せる（取り消しのトグル）。
    // 技得点表に無い技がある選手（gridBlocked）は、保存・確定（取り消しも）を止める（網羅検証 M3）。
    // 閲覧専用の面（viewOnly）は常に凍結（○× も補正点も備考も触れない。設計書 2026-10-10 §2）
    var frozen = locked || currentConfirmed() || gridBlocked || viewOnly;
    document.body.classList.toggle('scoring-locked', locked);
    document.body.classList.toggle('score-frozen', frozen);
    btnConfirm.disabled = locked || gridBlocked;
    // 「確定して次へ」は確定と同じ条件で押せる（確定済みなら次へ移るだけ）
    document.getElementById('btnConfirmNext').disabled = locked || gridBlocked;
    var btnRecalc = document.getElementById('btnRecalc');
    if (btnRecalc) btnRecalc.disabled = locked || viewOnly;
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

  // 表示する選手の絞り込み（進行中ならその巡目だけ。並びは試技順のまま）は Courts.listForStatus に移した
  // （他のコートの一覧でも同じ規則を使うため。2026-10-05）。

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
    applyCourtFilter();   // 面（iframe）では、この中の selectPlayer → refreshFromServer が採点席の選手を追いかける
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
    if (viewOnly) return true;   // 閲覧専用では未確定の採点が無い（離れても聞かない）
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
    if (viewOnly) return;   // 閲覧専用の面は前後の選手へ動かさない（ボタンも隠してある）
    if (visiblePlayers.length === 0) return;
    var next = currentIndex + delta;
    if (next < 0 || next >= visiblePlayers.length) return;
    if (!confirmLeave()) return;
    takeOwnership();   // 実際に動いたときだけ、面を配信の持ち主にする
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
    // バナーとロックを見直す。
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
  var AUTO_REFRESH_MS = 10000;   // 見ている間の自動の読み直しの間隔

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
    visiblePlayers = courtPlayers(currentCourt);
    // ダッシュボードの面（持ち主でない）では、採点席が映している選手（live）を追いかける。
    // 照合は読み直した後の一覧で行う（今回の応答で増えた行も拾う）。採点席が待機中（live が無い・
    // playerId が null）なら面のタイマーも止めて、配信用ボードと表示を揃える
    releaseOwnershipIfViewOnly();
    // 閲覧専用の面で「見るだけ」で選んだ選手がいる間は追いかけない。採点席が次の選手に移った（待機中も含む）か、
    // 選んだ選手が一覧から消えたら選択を外して追いかけに戻る（Courts.viewFollowDecision。設計書 2026-10-10 §2）。
    // 採点席の選手は、選んだ時点と同じ規則（liveFollowTarget。一覧にいる選手だけ）で見る
    var liveIdNow = (embedded && !liveOwner) ? liveFollowTarget(loaded, currentCourt) : null;
    if (viewOnly && viewPinnedId) {
      var pinnedListed = visiblePlayers.some(function(x) { return x.id === viewPinnedId; });
      if (!pinnedListed || Courts.viewFollowDecision({ pinnedId: viewPinnedId, pinnedLiveId: viewPinnedLiveId, liveId: liveIdNow }) === 'follow') {
        clearViewPin();
      }
    }
    var following = embedded && !liveOwner && !gridEdited && !viewPinnedId;
    var followId = following ? liveIdNow : null;
    if (followId) currentId = followId;
    if (following && !followId) haltTimer();
    var idx = -1;
    for (var i = 0; i < visiblePlayers.length; i++) {
      if (visiblePlayers[i].id === currentId) { idx = i; break; }
    }
    if (idx === -1) {
      // 表示中の選手が消えた（名簿の入れ直しなど）。先頭（面では追いかけ先）から出し直す
      applyCourtFilter(followId || undefined);
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
    renderViewBand();
    if (followId) applyLiveTimer(loaded, currentCourt);
  }

  // 面（iframe）で追いかける選手の id。コートが決まっていて、live のその選手が今の一覧にいるときだけ
  function liveFollowTarget(ev, court) {
    if (!court || !ev || !ev.live || !Object.prototype.hasOwnProperty.call(ev.live, court)) return null;
    var entry = ev.live[court];
    var id = entry && entry.playerId;
    if (!id) return null;
    for (var i = 0; i < visiblePlayers.length; i++) {
      if (visiblePlayers[i].id === id) return id;
    }
    return null;
  }

  // 面（iframe）で、採点席のタイマー（live.timer）を映す。配信用ボードと同じ規則（Courts.liveRemaining）。
  // 面の中では publishLive は送らないので、startTimer を呼んでも配信は変わらない
  function applyLiveTimer(ev, court) {
    var entry = ev && ev.live && Object.prototype.hasOwnProperty.call(ev.live, court) ? ev.live[court] : null;
    if (!entry || !entry.timer) return;
    var left = Courts.liveRemaining(entry.timer, entry.updatedAt, Api.serverNowMs());   // 時計のずれはサーバーの Date で補正
    haltTimer();
    timerSec = left;
    timerDisplay.textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60);
    if (entry.timer.running === true && left > 0) startTimer();
  }

  // 面の中で人が操作したら、その面が配信の持ち主になる（以後は追いかけず、publishLive を送る）
  function takeOwnership() {
    if (viewOnly) return;   // 閲覧専用の面は配信の持ち主にならない
    liveOwner = true;
  }

  // ダッシュボードが「閲覧専用」（body.dash-edit が無い）に戻ったら持ち主を外し、追いかけに戻る
  // （同一オリジンなので親の body を読める。読めなければ触らない。レビュー指摘 2026-10-07）
  function releaseOwnershipIfViewOnly() {
    if (viewOnly) { liveOwner = false; return; }
    if (!embedded || !liveOwner) return;
    try {
      if (!window.parent.document.body.classList.contains('dash-edit')) liveOwner = false;
    } catch (e) { /* 別オリジンなどで読めないときはそのまま */ }
  }

  function updatePlayerLabels(p) {
    // 順番パース: コート-性別の段-巡目-番号（性別の段は 男子・女子・混合。コート名は Courts.roundOf 等と
    // 同じく「-」を含まない前提。設計書 2026-10-07）
    var m = (p.order || '').match(/^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/);
    // ゼッケンは持っている選手だけ（出走番号は画面に出さない。設計書 2026-10-07 §1）。
    // コートで呼び出すときに使う。未設定の選手に「No.」だけが残らないよう、数値のときだけ出す。
    var bib = (typeof p.bib === 'number') ? 'No.' + p.bib : '';
    if (m) {
      // 部・巡目・コートは帯の 1 行目に大きく出す（「男子の部　一巡目　A コート」。混合は部を付けず
      // 「一巡目　A コート」）。左端のコートのバッジは同じ内容の重複になるので出さない。
      var roundName = m[3] === '1' ? '一巡目' : (m[3] === '2' ? '二巡目' : m[3] + '巡目');
      playerStageLabel.textContent = (m[2] === '混合' ? '' : m[2] + 'の部　') + roundName + '　' + m[1] + ' コート';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = bib;
    } else {
      playerStageLabel.textContent = '';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = bib;
    }
    playerNameLabel.textContent = p.name || '';
    // 級位・段位は名前の右に小さく（空なら :empty で消える）
    playerRankLabel.textContent = Courts.rankLabel(p.rank);
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
    if (viewOnly) return;
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
    gridEdited = true; takeOwnership();
    updateTotal();          // p.score を再計算の値にし、知らせの行を外す
    saveCurrentState();
    addHistory(currentEvent.id, {
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
    if (viewOnly) return;   // 閲覧専用の面は配信の状態を一切送らない（設計書 2026-10-10 §2）
    if (!currentEvent) return;
    releaseOwnershipIfViewOnly();
    if (!liveOwner) return;   // 人が操作していない面（ダッシュボード）からは配信の状態を変えない
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
    if (viewOnly) return;
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
      enqueueSave({
        eventId: currentEvent.id,
        playerId: p.id,
        confirmed: false,
        baseRev: EventStatus.revOf(p)
      });
      addHistory(currentEvent.id, {
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
    if (viewOnly) return;
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
    if (viewOnly) return false;
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
    gridEdited = true; takeOwnership();
    applyConfirmedStyle(true);
    applyScoringLock();   // 確定済みは点数を触れない
    saveCurrentState();
    addHistory(currentEvent.id, {
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
    if (viewOnly) return;
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
    gridEdited = true; takeOwnership();
    unconfirmIfNeeded();
    updateTotal();
    saveCurrentState();
    addHistory(currentEvent.id, {
      action: 'score_update',
      playerName: p ? p.name : '',
      detail: '全体補正点 → ' + n
    });
  }

  // 備考は得点に影響しないので、内訳を復元できない選手でも保存する。
  // 採点（score / result）を載せないエントリを積むので、既存の得点は動かない。
  // 確定も解除しない。
  function onNoteChange() {
    if (viewOnly) return;
    if (!currentEvent) return;
    var p = visiblePlayers[currentIndex];
    if (!p) return;
    p.note = noteInput.value.trim().slice(0, 200);
    enqueueSave({ eventId: currentEvent.id, playerId: p.id, note: p.note });
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
    if (viewOnly) return;
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
    if (viewOnly) return;
    var current = noteInput.value || '';
    var alreadyIncluded = current.indexOf(preset) !== -1;
    var wouldExceed = !alreadyIncluded && (current ? current.length + 1 + preset.length : preset.length) > 200;
    noteInput.value = Scoring.appendNote(current, preset);
    onNoteChange();
    if (wouldExceed) alert('備考は 200 文字までです');
  }

  function onAdjustChange(e) {
    if (viewOnly) return;
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
    gridEdited = true; takeOwnership();
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    addHistory(currentEvent.id, {
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
    if (viewOnly) return;
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

    gridEdited = true; takeOwnership();
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
    addHistory(currentEvent.id, {
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
  // 閲覧専用（viewOnly）の面からは、採点も履歴も送らない。ここが書き込みの最後の番（各ハンドラの先頭の番に加えて）
  function enqueueSave(entry) {
    if (viewOnly) return;
    Outbox.enqueue(entry);
  }
  function addHistory(eventId, record) {
    if (viewOnly) return;
    HistoryOutbox.add(eventId, record);
  }

  function saveCurrentState() {
    if (viewOnly) return;
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

    enqueueSave({
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
    if (viewOnly) return;
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
    gridEdited = true; takeOwnership();
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    addHistory(currentEvent.id, {
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
      addHistory(currentEvent.id, {
        action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
        techRow: parseInt(tr.dataset.row, 10), strike: 'rest', value: '×',
        detail: '確定時に未を失敗に（以降の太刀は無効）'
      });
    }
    gridEdited = true; takeOwnership();
    updateTotal();
  }

  function setAllFail() {
    if (viewOnly) return;
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
    gridEdited = true; takeOwnership();
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    addHistory(currentEvent.id, {
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

  // --- 選手一覧（コートごとの区画。ユーザー要望 2026-10-05） ---
  // どの窓幅でも採点の下にコートの区画を縦に並べる（ページ幅 --page-max-width の中。設計書 2026-10-05 5.2）。
  // 採点中のコートだけ開き、他のコートは見出しを押すと開く（窓幅で変えない。ユーザー要望 2026-10-05 夜:
  // PC で全コートを開いたままにするのはやめた。他のコートへは上のコート選択か見出しで）。
  // 以前の「▾ 選手一覧」の開閉（localStorage の tmg_player_list_open）はやめた。
  // 採点中のコートの一覧は visiblePlayers（巡回の対象）そのもの、他のコートは courtPlayers で同じ規則で作る。
  // 一覧の下に順位表（renderRankPanel）。

  // 一覧の見出し行（6 列。運営の端末では左端に掴み手の列を足して 7 列）。順番の列は出さない（設計書 2026-10-07 §1）。
  // 合計・順位・新人枠の列はやめ、順位は一覧の下の順位表に出す（設計書 2026-10-05 5.3）
  var PLAYER_LIST_HEAD =
    '<th>ゼッケン</th><th>選手名</th><th>級位・段位</th>' +
    '<th>一巡目</th><th>二巡目</th><th class="note">備考</th>';

  function playerListHead() {
    return '<tr>' + (canReorder ? '<th class="grip" title="⋮⋮ をドラッグして試技順を入れ替えます"></th>' : '') +
      PLAYER_LIST_HEAD + '</tr>';
  }

  function playerListColumns() {
    return canReorder ? 7 : 6;
  }

  // そのコートの区画を開いているか。採点中のコートは既定で開き、他は既定で閉じる
  // （利用者が開閉したら listOpen に従う）
  function isCourtListOpen(section) {
    if (section.court in listOpen) return listOpen[section.court];
    return section.current;
  }

  function renderPlayerList() {
    // 順位表は一覧と同じ時機に描く（確定・取り消し・保存・読み直し・コートの切り替え）。
    // 並べ替えでは得点が変わらないので、ドラッグ中に一覧の描き直しを保留しても先に描いてよい
    renderRankPanel();
    // ドラッグ中は描き直さない（掴んだ行が DOM から外れる）。離したあとに描く（endListDrag）
    if (listDrag) { listRenderPending = true; return; }
    listRenderPending = false;
    playerListCourts.innerHTML = '';
    if (listOpenCourt !== currentCourt) { listOpen = {}; listOpenCourt = currentCourt; }
    var sections = currentEvent ? Scope.listSections(currentEvent, scorerSession, currentCourt) : [];
    playerListSection.hidden = sections.length === 0;
    sections.forEach(function(s) {
      playerListCourts.appendChild(buildCourtList(s, s.current ? visiblePlayers : courtPlayers(s.court)));
    });
  }

  // コート 1 つ分の区画（見出し＋表）
  function buildCourtList(section, list) {
    var box = document.createElement('div');
    box.className = 'court-list' + (section.current ? ' current' : '') + (section.readOnly ? ' read-only' : '');
    box.dataset.court = section.court;
    var open = isCourtListOpen(section);
    box.classList.toggle('collapsed', !open);

    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'court-list-head';
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    head.innerHTML =
      '<span class="court-list-arrow">' + (open ? '▾' : '▸') + '</span>' +
      '<span class="court-list-name">' + esc(courtOptionLabel(section.court)) + '</span>' +
      (section.current ? '<span class="court-list-tag">採点中</span>' : '') +
      (section.readOnly ? '<span class="court-list-tag view-only">見るだけ</span>' : '') +
      '<span class="court-list-count">' + list.length + ' 名</span>';
    head.addEventListener('click', function() {
      var next = box.classList.contains('collapsed');
      listOpen[section.court] = next;
      box.classList.toggle('collapsed', !next);
      head.setAttribute('aria-expanded', next ? 'true' : 'false');
      head.querySelector('.court-list-arrow').textContent = next ? '▾' : '▸';
      if (next && section.current) scrollPlayerListTo(box.querySelector('tr.current-player'));
    });
    box.appendChild(head);

    var wrap = document.createElement('div');
    wrap.className = 'player-list-body';
    var table = document.createElement('table');
    table.className = 'player-list-table';
    table.innerHTML = '<thead>' + playerListHead() + '</thead>';
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);

    // 分ける大会: 男子の部・女子の部の帯で分ける（並びは list のまま。性別が切り替わる所に帯を入れる）。
    // 混合の大会（order の性別の段が 混合。Courts.isMixedOrder）: 性別の帯は入れず、複数の巡目が並ぶときだけ巡目の帯。
    var lastSex = null;
    var rounds = {};
    list.forEach(function(p) { rounds[Courts.roundOf(p)] = true; });
    var manyRounds = Object.keys(rounds).length > 1;   // 複数の巡目が並ぶ状態（準備中・形登録・最終結果など）
    for (var i = 0; i < list.length; i++) {
      var r = Courts.roundOf(list[i]);
      var roundText = r === 1 ? '一巡目' : r === 2 ? '二巡目' : r + '巡目';
      var sex;
      if (Courts.isMixedOrder(list[i])) {
        sex = manyRounds ? roundText : '';
      } else {
        sex = (list[i].isFemale === true ? '女子の部' : '男子の部') + (manyRounds ? ('　' + roundText) : '');
      }
      if (sex && sex !== lastSex) {
        var band = document.createElement('tr');
        band.className = 'player-list-band';
        var td = document.createElement('td');
        td.colSpan = playerListColumns();   // （掴み手・）ゼッケン・選手名・級位段位・一巡目・二巡目・備考
        td.textContent = sex;
        band.appendChild(td);
        tbody.appendChild(band);
        lastSex = sex;
      }
      tbody.appendChild(buildPlayerListRow(list[i], i, section));
    }
    return box;
  }

  // 一覧の行。採点中のコートの行は data-index（visiblePlayers の添字）で、押すとその選手に切り替わる。
  // 他のコートの行は押すと採点中のコートをそのコートに切り替えてその選手を開く（changeCourt）。
  // 見るだけのコート（採点専用の端末の範囲外）の行は押しても何もしない。
  function buildPlayerListRow(p, index, section) {
    var tr = document.createElement('tr');
    if (section.current) {
      tr.dataset.index = index;
      if (index === currentIndex) tr.classList.add('current-player');
    }
    if (p.confirmed) tr.classList.add('done');   // 確定済みの行はグレー（ユーザー要望）
    var hasBib = (typeof p.bib === 'number');
    tr.dataset.playerId = p.id || '';
    tr.innerHTML =
      // 運営の端末だけ、左端に試技順を入れ替える掴み手（⋮⋮。中身は下の gripHandle）
      (canReorder ? '<td class="grip"></td>' : '') +
      // 未設定は薄い「—」（数値なので esc は要らないが、列を空にはしない）
      '<td' + (hasBib ? '' : ' class="no-bib"') + '>' + (hasBib ? p.bib : '—') + '</td>' +
      '<td class="name">' + esc(p.name || '') + '</td>' +
      // 級位・段位は空なら空セル（ゼッケンと違い「—」は出さない）。title に全文
      '<td class="grade" title="' + escAttr(Courts.rankLabel(p.rank)) + '"><div class="clip">' + esc(Courts.rankLabel(p.rank)) + '</div></td>' +
      // 得点は一巡目・二巡目の 2 列（合計・順位は一覧の下の順位表。設計書 2026-10-05 5.3）。確定済みの値だけ出す
      // （採点途中の値は一覧に出さない。2026-09-30）。中身は fillScoreCells で入れる
      '<td class="score r1"></td><td class="score r2"></td>' +
      // 備考は残り幅を吸収する列。折り返し可
      '<td class="note" title="' + escAttr(p.note || '') + '"><div class="clip">' + esc(p.note || '') + '</div></td>';
    if (canReorder) tr.querySelector('td.grip').appendChild(gripHandle(p));
    if (section.current) {
      tr.addEventListener('click', function() {
        if (listClickBlocked()) return;   // 並べ替えの直後・保存の通信中は選手を切り替えない
        var idx = parseInt(this.dataset.index, 10);
        if (viewOnly) { onViewPick(idx); return; }   // 閲覧専用: 見るだけの選択（持ち主にならず、配信も保存もしない）
        if (idx !== currentIndex && !confirmLeave()) return;
        saveCurrentState();
        takeOwnership();   // 面の中で人が選んだら、その面が配信の持ち主になる
        selectPlayer(idx);
      });
    } else if (!section.readOnly) {
      tr.addEventListener('click', function() {
        if (listClickBlocked() || viewOnly) return;   // 閲覧専用の面は別のコートへ移らない（面はコートごと）
        changeCourt(section.court, p.id);
      });
    }
    fillScoreCells(tr, p);
    return tr;
  }

  // --- 一覧の行のドラッグで試技順を入れ替える（ユーザー要望 2026-10-05） ---
  // 運営の端末（canReorder）だけ。行の左端の掴み手（⋮⋮）を押さえて上下に動かし、離した所へ入れる。
  // 指（iPad Safari）でも動くよう Pointer Events で作る（HTML5 のドラッグ＆ドロップは iPad Safari で動かない）。
  // マウスも同じ経路。掴み手は押した瞬間に掴む（CSS の touch-action: none で画面のスクロールにしない）。
  // 掴み手以外のタップは今までどおり選手の切り替え。ドラッグを離した直後のクリックは捨てる（listClickBlocked）。
  // 入れ替えられるのは同じ帯（コート×性別×巡目。Courts.sameReorderGroup）の中だけ。帯をまたぐ所・行の無い所で
  // 離したら元に戻す（PC 運営の選手登録の表と同じ。Courts.canDropInList）。
  // 離したら POST …/players/reorder で保存し、サーバーが振り直した番号で一覧を作り直す（採点中の選手は id で保つ）。
  var listDrag = null;           // ドラッグ中の状態（null なら掴んでいない）
  var listRenderPending = false; // ドラッグ中に一覧の描き直しを頼まれた（離したあとに描く）
  var reorderBusy = false;       // 保存の通信中（一覧を触れなくする）
  var suppressClickUntil = 0;    // ドラッグを離した直後のクリック（行の切り替え）を捨てる期限
  var DRAG_MOVE_PX = 4;          // これだけ動いたらドラッグとみなす（それ未満は掴み手のタップで、何もしない）
  var AUTO_SCROLL_EDGE = 28;     // 一覧の枠の上下端からこの距離に指があれば、枠を送る

  function listClickBlocked() {
    return reorderBusy || !!listDrag || Date.now() < suppressClickUntil;
  }

  // 掴み手。組を持たない行（order の形が崩れた行）と、最終結果を確定済みの大会では薄くして掴めない
  function gripHandle(p) {
    var h = document.createElement('span');
    h.className = 'drag-handle';
    h.textContent = '⋮⋮';
    var blocked = '';
    if (EventStatus.isLocked(currentStatus())) blocked = '最終結果を確定済みのため入れ替えできません';
    else if (Courts.reorderGroupKey(p) === null) blocked = '番号の形式が崩れた行のため入れ替えできません';
    if (blocked) {
      h.classList.add('disabled');
      h.title = blocked;
    } else {
      h.title = 'ドラッグで試技順を入れ替えます（同じ部・巡目の中だけ）';
      h.addEventListener('pointerdown', onGripPointerDown);
    }
    // 掴み手のタップでは選手を切り替えない
    h.addEventListener('click', function(e) { e.stopPropagation(); });
    return h;
  }

  function rowPlayer(tr) {
    return (tr && tr.dataset && tr.dataset.playerId) ? findPlayer(tr.dataset.playerId) : null;
  }

  function onGripPointerDown(e) {
    if (viewOnly || reorderBusy || listDrag || !currentEvent) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var h = e.currentTarget;
    var tr = h.closest('tr');
    var box = tr ? tr.closest('.player-list-body') : null;
    if (!tr || !box || !rowPlayer(tr)) return;
    e.preventDefault();      // 文字の選択・長押しのメニューを出さない
    e.stopPropagation();
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
    var rect = tr.getBoundingClientRect();
    listDrag = {
      handle: h, tr: tr, tbody: tr.parentNode, box: box, pointerId: e.pointerId,
      startY: e.clientY, lastY: e.clientY, lastX: e.clientX, startScroll: box.scrollTop,
      rowTop: rect.top, rowHeight: rect.height,
      moved: false, target: null, after: false, invalid: false, timer: null
    };
    h.addEventListener('pointermove', onGripPointerMove);
    h.addEventListener('pointerup', onGripPointerUp);
    h.addEventListener('pointercancel', onGripPointerCancel);
    h.addEventListener('lostpointercapture', onGripPointerCancel);
  }

  function onGripPointerMove(e) {
    var d = listDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    d.lastY = e.clientY;
    d.lastX = e.clientX;
    if (!d.moved) {
      if (Math.abs(e.clientY - d.startY) < DRAG_MOVE_PX) return;
      d.moved = true;
      d.tr.classList.add('dragging');
      document.body.classList.add('list-dragging');
      d.timer = setInterval(autoScrollList, 30);   // 枠の上下端に指を置いている間、枠を送る
    }
    trackListDrag();
  }

  // 掴んだ行を指に付けて動かし、落とす位置（行の前／後）に線を出す
  function trackListDrag() {
    var d = listDrag;
    if (!d || !d.moved) return;
    var scrolled = d.box.scrollTop - d.startScroll;
    d.tr.style.transform = 'translateY(' + (d.lastY - d.startY + scrolled) + 'px)';
    setListDropMark(listDropTarget(d, scrolled));
  }

  // 指の高さにある落とし先。{ tr, after, invalid }。
  //   掴んだ行の元の位置（空いて見える所）… tr なし・invalid 偽（離しても何もしない）
  //   帯の行・別の組の行・表の外（他のコートの列も）… tr なし・invalid 真（帯をまたぐ。離したら元に戻す）
  function listDropTarget(d, scrolled) {
    var boxRect = d.box.getBoundingClientRect();
    var head = d.box.querySelector('thead');
    var top = boxRect.top + (head ? head.getBoundingClientRect().height : 0);
    var y = d.lastY;
    var ownTop = d.rowTop - scrolled;
    if (y >= ownTop && y < ownTop + d.rowHeight) return { tr: null, after: false, invalid: false };
    if (y < top || y > boxRect.bottom || d.lastX < boxRect.left || d.lastX > boxRect.right) {
      return { tr: null, after: false, invalid: true };
    }
    var moving = rowPlayer(d.tr);
    var rows = d.tbody.children;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r === d.tr) continue;
      var rect = r.getBoundingClientRect();
      if (y < rect.top || y >= rect.bottom) continue;
      var q = rowPlayer(r);   // 帯の行（男子の部・女子の部）は選手が無い
      if (!q || !Courts.canDropInList(moving, q, currentStatus())) return { tr: null, after: false, invalid: true };
      return { tr: r, after: y > rect.top + rect.height / 2, invalid: false };
    }
    return { tr: null, after: false, invalid: true };
  }

  function setListDropMark(hit) {
    var d = listDrag;
    if (d.target && d.target !== hit.tr) d.target.classList.remove('drop-before', 'drop-after');
    d.target = hit.tr;
    d.after = hit.after;
    d.invalid = hit.invalid;
    if (d.target) {
      d.target.classList.toggle('drop-before', !d.after);
      d.target.classList.toggle('drop-after', d.after);
    }
    d.tr.classList.toggle('drop-invalid', d.invalid);
  }

  function autoScrollList() {
    var d = listDrag;
    if (!d || !d.moved) return;
    var rect = d.box.getBoundingClientRect();
    var head = d.box.querySelector('thead');
    var top = rect.top + (head ? head.getBoundingClientRect().height : 0);
    var step = 0;
    if (d.lastY < top + AUTO_SCROLL_EDGE) step = -8;
    else if (d.lastY > rect.bottom - AUTO_SCROLL_EDGE) step = 8;
    if (!step) return;
    var before = d.box.scrollTop;
    d.box.scrollTop += step;
    if (d.box.scrollTop !== before) trackListDrag();
  }

  function onGripPointerUp(e) {
    var d = listDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    var drop = (d.moved && d.target) ? { moving: d.tr, target: d.target, after: d.after } : null;
    endListDrag();
    if (drop) dropListRow(drop.moving, drop.target, drop.after);
    else flushListRender();
  }

  // 指が画面から外れた・OS に取られた（pointercancel / lostpointercapture）。元に戻す
  function onGripPointerCancel(e) {
    var d = listDrag;
    if (!d || (e && typeof e.pointerId === 'number' && e.pointerId !== d.pointerId)) return;
    endListDrag();
    flushListRender();
  }

  // 掴んでいた行の見た目を戻す（並びを変えるのは dropListRow）
  function endListDrag() {
    var d = listDrag;
    if (!d) return;
    listDrag = null;
    if (d.timer) clearInterval(d.timer);
    d.handle.removeEventListener('pointermove', onGripPointerMove);
    d.handle.removeEventListener('pointerup', onGripPointerUp);
    d.handle.removeEventListener('pointercancel', onGripPointerCancel);
    d.handle.removeEventListener('lostpointercapture', onGripPointerCancel);
    try { d.handle.releasePointerCapture(d.pointerId); } catch (err) { /* 無視 */ }
    d.tr.classList.remove('dragging', 'drop-invalid');
    d.tr.style.transform = '';
    if (d.target) d.target.classList.remove('drop-before', 'drop-after');
    document.body.classList.remove('list-dragging');
    if (d.moved) suppressClickUntil = Date.now() + 400;
  }

  // ドラッグ中に後回しにした一覧の描き直し
  function flushListRender() {
    if (!listRenderPending) return;
    renderPlayerList();
    updatePlayerList();
  }

  // 離したあと。先に行を動かして見せ、組の全員の新しい並び（Courts.reorderIds）を保存する。
  // 成功したらサーバーが振り直した番号を当てて作り直し、失敗したら元の並びに描き直して理由を出す。
  async function dropListRow(moving, target, after) {
    if (viewOnly) { flushListRender(); return; }
    var mp = rowPlayer(moving), tp = rowPlayer(target);
    if (!currentEvent || !mp || !tp || !Courts.canDropInList(mp, tp, currentStatus())) { flushListRender(); return; }
    var tbody = moving.parentNode;
    var shown = [];
    Array.prototype.forEach.call(tbody.querySelectorAll('tr[data-player-id]'), function(r) {
      var q = rowPlayer(r);
      if (q && Courts.sameReorderGroup(mp, q)) shown.push(q.id);
    });
    var group = Courts.reorderGroup(players, mp).map(function(q) { return q.id; });
    var ids = Courts.reorderIds(group, shown, mp.id, tp.id, after);
    if (!ids) { flushListRender(); return; }   // 並びが変わらない（自分のすぐ上下に落とした）
    var key = Courts.orderKey(mp);
    var eventId = currentEvent.id;   // await をまたぐので大会をここで固定する
    tbody.insertBefore(moving, after ? target.nextSibling : target);
    reorderBusy = true;
    playerListSection.classList.add('reorder-saving');
    var res = null;
    try {
      res = await Api.reorderPlayers(eventId, {
        court: key.court, isFemale: key.sex === 1, round: key.round, ids: ids
      });
    } finally {
      reorderBusy = false;
      playerListSection.classList.remove('reorder-saving');
    }
    if (!currentEvent || currentEvent.id !== eventId) return;   // 通信中に大会を切り替えた（一覧は描き直し済み）
    if (res && res.ok) {
      applyReorderedOrders(res.players);
      return;
    }
    renderPlayerList();   // 元の並びに戻す
    updatePlayerList();
    alert(reorderFailMessage(res));
    refreshFromServer();  // 別の端末で行が足された・消された、状態が進んだ、などを取り込む
  }

  function reorderFailMessage(res) {
    if (res && res.reason === 'locked') {
      return 'この大会は最終結果を確定済みのため、試技順を入れ替えられません。';
    }
    if (res && res.reason === 'reorder_mismatch') {
      return res.error || '並べ替える選手が現在の登録と一致しません。読み直したので、もう一度入れ替えてください。';
    }
    if (res && (res.status === 401 || res.status === 403)) {
      return '試技順を入れ替えられませんでした。入れ替えは運営の端末でだけできます。';
    }
    return '試技順を保存できませんでした。\n通信を確認してください。';
  }

  // 並べ替えの応答（大会の選手全体）の番号（order）だけを手元の選手に当て、採点中の選手を id で保ったまま
  // 巡回の対象（visiblePlayers）と一覧を作り直す（並びが変わるので currentIndex は id から引き直す）。
  // 得点などは触らない（編集中の採点を壊さない）。他の変更は続く refreshFromServer で取り込む。
  function applyReorderedOrders(serverPlayers) {
    (serverPlayers || []).forEach(function(sp) {
      var lp = (sp && sp.id) ? findPlayer(sp.id) : null;
      if (lp && typeof sp.order === 'string') lp.order = sp.order;
    });
    var cur = visiblePlayers[currentIndex] || null;
    visiblePlayers = courtPlayers(currentCourt);
    currentIndex = -1;
    for (var i = 0; cur && i < visiblePlayers.length; i++) {
      if (visiblePlayers[i].id === cur.id) { currentIndex = i; break; }
    }
    if (cur && currentIndex === -1) {   // 並べ替えでコートや巡目は変わらないので、ここへは来ないはず
      applyCourtFilter(cur.id);
      return;
    }
    renderPlayerList();
    updatePlayerList();
    if (cur) updatePlayerLabels(visiblePlayers[currentIndex]);   // 「3番」などの番号
    refreshFromServer();
  }

  // 一覧の行の一巡目・二巡目（と合計）。どの巡目の行でも、同じ選手（sourcePlayerId でつながる
  // 一巡目の行と二巡目の行）の確定済みの得点を出す。確定していない巡目は空欄、合計は確定した分の和
  // （どちらも未確定なら空欄。一覧には出さない）。順位と同じ「確定だけ反映」の基準。
  function scorePair(p) {
    var r1 = null, r2 = null;
    if (Courts.roundOf(p) === 2) {
      r2 = p;
      if (p.sourcePlayerId) r1 = players.filter(function(q) { return q && q.id === p.sourcePlayerId; })[0] || null;
    } else {
      r1 = p;
      r2 = players.filter(function(q) { return q && q.sourcePlayerId === p.id && Courts.roundOf(q) === 2; })[0] || null;
    }
    var s1 = (r1 && r1.confirmed === true) ? Number(r1.score) || 0 : null;
    var s2 = (r2 && r2.confirmed === true) ? Number(r2.score) || 0 : null;
    var total = (s1 === null && s2 === null) ? null : (s1 || 0) + (s2 || 0);
    return { r1: s1, r2: s2, total: total };
  }

  function fillScoreCells(tr, p) {
    var sp = scorePair(p);
    var cells = { r1: tr.querySelector('td.score.r1'), r2: tr.querySelector('td.score.r2') };
    Object.keys(cells).forEach(function(k) {
      if (!cells[k]) return;
      cells[k].textContent = sp[k] === null ? '' : String(sp[k]);
      cells[k].classList.toggle('confirmed', sp[k] !== null);
    });
  }

  // 選手データ自体が入れ替わったとき用（一覧を作り直す）
  function refreshPlayerList() {
    renderPlayerList();
  }

  // 採点中のコートの区画の tbody（無ければ null）。強調・自動スクロールはこの区画にだけ効かせる
  function currentListBody() {
    return playerListCourts.querySelector('.court-list.current tbody');
  }

  function updatePlayerList() {
    markRankPanelCurrent();   // 順位表の今の選手の強調も付け替える
    var body = currentListBody();
    if (!body) return;
    var rows = body.querySelectorAll('tr[data-index]');
    for (var i = 0; i < rows.length; i++) {
      var idx = parseInt(rows[i].dataset.index, 10);
      rows[i].classList.toggle('current-player', idx === currentIndex);
    }
    // 現在の選手行を表示領域内にスクロール
    scrollPlayerListTo(body.querySelector('tr.current-player'));
  }

  // 一覧の枠（.player-list-body）の中だけをスクロールさせる。
  // 一覧はページのフローに置いたので、scrollIntoView を使うとページ全体が動き、
  // スマホでは「次の選手」ボタンが画面の外へ逃げてしまう。閉じた区画（高さ 0）では何もしない。
  function scrollPlayerListTo(row) {
    if (!row) return;
    var box = row.closest('.player-list-body');
    if (!box || box.clientHeight === 0) return;
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
    var p = visiblePlayers[index];
    if (!p || p.confirmed !== true) return;   // 確定前の途中の値は一覧に出さない
    // 得点が変わると順位表（全コートの選手）も動くので、一覧と順位表ごと描き直す（表は小さい）
    renderPlayerList();
    updatePlayerList();
  }

  function updatePlayerListConfirmed(index, on) {
    // 確定・取り消しで一覧の得点（一巡目・二巡目）と順位表が動くので、一覧ごと描き直す（renderPlayerList が順位表も描く）
    renderPlayerList();
    updatePlayerList();
  }

  // 備考を変えたとき（手入力・文例）に一覧の備考セルを書き換える
  function updatePlayerListNote(index, note) {
    var body = currentListBody();
    var row = body ? body.querySelector('tr[data-index="' + index + '"]') : null;
    var cell = row ? row.querySelector('td.note') : null;
    if (!cell) return;
    cell.title = note || '';
    var clip = cell.querySelector('.clip');
    (clip || cell).textContent = note || '';
  }

  // --- 順位表（一覧の下の #rankPanelSection。設計書 2026-10-05 5.4） ---
  // 一般男子・新人枠・一般女子の 3 表（順位・名前・合計）。材料は Courts.rankPanel（順位の集計 computeRanking と
  // 同じ EventStatus.rankings）。採点の鍵の端末は順位 API を呼べないので画面で計算する（players は全コートの選手）。
  // 確定した得点のある選手だけ出す（結果確認は全員。ここだけ違う。D4）。順位は全員で付けたものをそのまま使う。
  // countAll（status の無い旧データ）は GET /api/events/:id が status を推定値で埋めるので、今は常に偽になる（D10）。
  var rankPanelSection = document.getElementById('rankPanelSection');
  var rankPanelCols = document.getElementById('rankPanelCols');

  function renderRankPanel() {
    if (!rankPanelSection || !rankPanelCols) return;
    rankPanelSection.hidden = !currentEvent;
    var prevRows = Ranking.captureRows(rankPanelCols);   // 入れ替わりのアニメーション用に前の位置を控える
    rankPanelCols.innerHTML = '';
    if (!currentEvent) return;
    var countAllHere = typeof currentEvent.status !== 'string';
    var cats = Courts.rankPanel(players, { countAll: countAllHere });
    // 合計の内訳（一巡目・二巡目・二巡目を終えたか）。色分けと「41+44」（ユーザー要望 2026-10-06）
    var totalsByKey = Object.create(null);
    EventStatus.playerTotals(players, { countAll: countAllHere }).forEach(function(t) { totalsByKey[t.key] = t; });
    var finished = currentStatus() === 'final' || currentStatus() === 'archived';
    // 見出しに「〜巡目 済み/全員」（何人中何人が確定したか。ユーザー要望 2026-10-05）
    var progress = EventStatus.roundProgress(players, currentStatus());
    // ベスト4 に残れる可能性（部門ごと。二巡目の行ができてから。記号だけで、凡例は下。ユーザー要望 2026-10-05）
    var chances = EventStatus.best4Chances(players, {
      countAll: typeof currentEvent.status !== 'string',
      maxExtraOf: function(p) { return Courts.maxExtraOf(activeTechniques, p); }
    });
    var any = cats.some(function(c) { return c.rows.length > 0; });
    rankPanelCols.classList.toggle('empty', !any);
    if (!any) {
      var msg = document.createElement('p');
      msg.className = 'rank-panel-empty';
      msg.textContent = 'まだ確定した得点がありません';
      rankPanelCols.appendChild(msg);
      return;
    }
    var built = {};
    cats.forEach(function(c) {
      var col = document.createElement('section');
      col.className = 'rank-panel-col';
      col.dataset.category = c.key;
      var h = document.createElement('h3');
      h.textContent = c.title;
      var pr = progress[c.key];
      if (pr) {
        var prEl = document.createElement('span');
        prEl.className = 'rank-panel-progress';
        prEl.textContent = pr.label;
        prEl.title = pr.round + ' 巡目の行 ' + pr.total + ' 名のうち、確定済み ' + pr.done + ' 名';
        h.appendChild(prEl);
      }
      var catChances = chances ? chances[c.key] : null;
      var withChance = !!catChances;
      if (withChance) {
        var remEl = document.createElement('span');
        remEl.className = 'rank-panel-progress';
        remEl.textContent = '残り ' + catChances.remaining + ' 名';
        remEl.title = '二巡目がまだ確定していない人数';
        h.appendChild(remEl);
      }
      col.appendChild(h);
      if (c.rows.length === 0) {
        var none = document.createElement('p');
        none.className = 'rank-panel-none';
        none.textContent = 'まだいません';
        col.appendChild(none);
      } else {
        var table = document.createElement('table');
        table.className = 'rank-panel-table';
        table.innerHTML = '<thead><tr><th class="rank">順位</th><th class="name">名前</th>' +
          '<th class="total">合計</th>' + (withChance ? '<th class="chance">ベスト4</th>' : '') + '</tr></thead>';
        var tbody = document.createElement('tbody');
        c.rows.forEach(function(r) {
          var tr = document.createElement('tr');
          tr.dataset.key = r.key || '';
          tr.dataset.rowkey = c.key + '|' + (r.key || r.name || '');   // 描き直しで同じ人の行を見つける（Ranking.animateRows）
          tr.dataset.score = String(Number(r.score) || 0);
          var ch = withChance ? catChances.byKey[r.key] : null;
          var dt = Ranking.detailText(totalsByKey[r.key]);
          tr.innerHTML = '<td class="rank">' + (Number(r.rank) || 0) + '</td>' +
            '<td class="name">' + esc(r.name || '') + '</td>' +
            '<td class="total ' + Ranking.totalClass(true, totalsByKey[r.key], finished) + '">' + (Number(r.score) || 0) +
              (dt ? '<span class="rank-panel-sub">' + esc(dt) + '</span>' : '') +
              // まだ斬っていない人は「→最大」（二巡目が全部成功したときの合計）を添える（低い人に ○ が付く理由が分かるように）
              (ch && ch.pending ? '<span class="rank-panel-max">→' + ch.max + '?</span>' : '') + '</td>' +
            (withChance ? '<td class="chance ' + (ch ? ch.flag : '') + '" title="' +
              (ch ? esc('最大 ' + ch.max + ' 点' + (ch.pending ? '（二巡目が全部成功したとき）' : '（確定）')) : '') + '">' +
              (ch ? esc(ch.label) : '') + '</td>' : '');
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        col.appendChild(table);
      }
      built[c.key] = col;
    });
    // 男子と女子を横に、新人枠は女子の下に（ユーザー要望 2026-10-06）
    if (built.male) rankPanelCols.appendChild(built.male);
    var stack = document.createElement('div');
    stack.className = 'rank-panel-stack';
    if (built.female) stack.appendChild(built.female);
    if (built.newFace) stack.appendChild(built.newFace);
    if (stack.childNodes.length) rankPanelCols.appendChild(stack);
    // 合計の色の凡例（終わった大会では全員青なので出さない）
    if (!finished) {
      var colorLegend = document.createElement('p');
      colorLegend.className = 'rank-panel-legend rank-panel-legend-colors';
      colorLegend.textContent = Ranking.COLOR_LEGEND;
      rankPanelCols.appendChild(colorLegend);
    }
    // 凡例（ベスト4 の列があるときだけ。ベスト4 を隠す設定なら凡例も消える）
    if (chances) {
      var legend = document.createElement('p');
      legend.className = 'rank-panel-legend rank-panel-legend-best4';
      legend.textContent = 'ベスト4: ' + ['sure', 'possible', 'out'].map(function(k) {
        return EventStatus.BEST4_FLAGS[k] + ' ' + EventStatus.BEST4_FLAG_TEXT[k];
      }).join('　') + '　→n? はまだ斬っていない人の最大（二巡目が全部成功したときの合計）';
      rankPanelCols.appendChild(legend);
    }
    markRankPanelCurrent();
    Ranking.applyOpts(rankPanelCols, Ranking.loadOpts());   // 内訳・ベスト4 の表示は順位表示ページの設定と同じ
    Ranking.animateRows(rankPanelCols, prevRows);   // 順位の入れ替わりを滑らせる（ユーザー要望 2026-10-06）
  }

  // 今開いている選手の組の鍵（playerTotals の key）。一巡目の行なら自分の id、二巡目の行なら sourcePlayerId
  function currentRankKey() {
    var p = visiblePlayers[currentIndex];
    if (!p) return null;
    var id = Courts.roundOf(p) === 1 ? p.id : p.sourcePlayerId;
    return (typeof id === 'string' && id) ? 'id:' + id : null;
  }

  // 順位表の今の選手の行を強調する（一覧の今の選手と同じ色。D7）
  function markRankPanelCurrent() {
    if (!rankPanelCols) return;
    var key = currentRankKey();
    var rows = rankPanelCols.querySelectorAll('tr[data-key]');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('current', !!key && rows[i].dataset.key === key);
    }
  }

  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- ダッシュボードの閲覧専用の面（設計書 2026-10-10 §2） ---
  // 閲覧モードの見た目と無効化をまとめて当てる（setViewOnly と、面として開かれた直後の init から）
  function applyViewOnlyUi() {
    document.body.classList.toggle('view-only', viewOnly);
    if (!viewOnly) document.body.classList.remove('view-pinned');
    var evSel = document.getElementById('eventSelect');
    if (evSel) evSel.disabled = viewOnly || !!scorerSession;
    courtSelect.disabled = viewOnly || (!!scorerSession && courtSelect.options.length <= 1);
    applyScoringLock();
    renderViewBand();
  }

  // ダッシュボードから閲覧専用／操作可能を切り替える（同一オリジン。iframe の contentWindow から呼ぶ）
  function setViewOnly(flag) {
    flag = !!flag;
    if (flag && !viewOnly) {
      // 入力欄に打ちかけの備考などがあれば、閲覧に入る前に change を発火させて保存させる（入った後は書かない）
      try { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch (e) { /* 無視 */ }
    }
    viewOnly = flag;
    if (viewOnly) {
      gridEdited = false;   // 編集は 1 操作ごとに保存済み。閲覧に入ったら採点席の選手を追いかけ直す
      liveOwner = false;
    } else {
      clearViewPin();
    }
    applyViewOnlyUi();
    refreshFromServer();   // 採点席の選手を追いかけ直す（操作可能に戻したときも表示を最新にする）
  }

  function clearViewPin() {
    viewPinnedId = null;
    viewPinnedLiveId = null;
  }

  // 一覧の行を押したとき（閲覧専用）: その選手を見るだけで出す。採点席が映している選手を押したときは追いかけに戻る
  function onViewPick(idx) {
    var p = visiblePlayers[idx];
    if (!p) return;
    var liveId = currentEvent ? liveFollowTarget(currentEvent, currentCourt) : null;
    if (liveId === p.id) {
      clearViewPin();
      showPlayerReadOnly(idx);
      refreshFromServer();   // 採点席のタイマーも映し直す
      return;
    }
    viewPinnedId = p.id;
    viewPinnedLiveId = liveId;   // 選んだ時点で採点席が映していた選手（待機中なら null）
    showPlayerReadOnly(idx);
  }

  // 見るだけの表示。selectPlayer は resetTimer・refreshFromServer・publishLive を呼ぶので使わない
  function showPlayerReadOnly(idx) {
    var p = visiblePlayers[idx];
    if (!p) return;
    currentIndex = idx;
    updatePlayerLabels(p);
    renderScoreGrid(p);
    updatePlayerList();
    renderStatusBanner();
    applyScoringLock();
    renderViewBand();
  }

  // 採点席のタイマーの残り表示（"04:12"）。配信用ボードと同じ規則（Courts.liveRemaining）
  function liveTimerText() {
    var live = currentEvent && currentEvent.live;
    var entry = live && Object.prototype.hasOwnProperty.call(live, currentCourt) ? live[currentCourt] : null;
    if (!entry || !entry.timer) return '';
    var left = Courts.liveRemaining(entry.timer, entry.updatedAt, Api.serverNowMs());
    return pad(Math.floor(left / 60)) + ':' + pad(left % 60);
  }

  // 閲覧専用の面で、見るだけの選択をしている間だけ出す帯「採点中: 衛藤豊　04:12　▶ 戻る」。
  // 見るだけの選択の間はタイマー欄を隠し（body.view-pinned。見ている選手のタイマーではないので）、採点席のタイマーはこの帯に出す
  function renderViewBand() {
    var band = document.getElementById('viewBand');
    if (!band) return;
    var pinned = viewOnly && !!viewPinnedId;
    document.body.classList.toggle('view-pinned', pinned);
    var liveId = pinned && currentEvent ? liveFollowTarget(currentEvent, currentCourt) : null;
    var show = pinned && !!liveId && liveId !== viewPinnedId;
    band.hidden = !show;
    if (!show) {
      if (viewBandTimerHandle) { clearInterval(viewBandTimerHandle); viewBandTimerHandle = null; }
      viewBandKey = '';
      band.textContent = '';
      return;
    }
    if (viewBandKey !== liveId) {
      var p = visiblePlayers.filter(function(x) { return x.id === liveId; })[0];
      band.textContent = '';
      var txt = document.createElement('span');
      txt.textContent = '採点中: ' + (p ? p.name : '');
      var t = document.createElement('span');
      t.id = 'viewBandTimer';
      t.className = 'view-band-timer';
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'view-band-back';
      back.textContent = '▶ 戻る';
      back.addEventListener('click', function() { clearViewPin(); renderViewBand(); refreshFromServer(); });
      band.appendChild(txt); band.appendChild(t); band.appendChild(back);
      viewBandKey = liveId;
    }
    var tEl = document.getElementById('viewBandTimer');
    if (tEl) tEl.textContent = liveTimerText();
    if (!viewBandTimerHandle) {
      // 残り時間は live の updatedAt からの経過で毎秒出し直す（採点席が動かしている間も合う）
      viewBandTimerHandle = setInterval(function() {
        var el = document.getElementById('viewBandTimer');
        if (el) el.textContent = liveTimerText();
      }, 1000);
    }
  }

  window.ScoringApp = { setViewOnly: setViewOnly };

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', App.init);
