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

  // --- DOM参照 ---
  var courtLabel       = document.getElementById('courtLabel');
  var playerOrderLabel = document.getElementById('playerOrderLabel');
  var playerNameLabel  = document.getElementById('playerNameLabel');
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
  var scoreTable       = document.getElementById('scoreTable');

  // --- 初期化 ---
  async function init() {
    applyTheme(Storage.loadTheme());
    initPlayerListOpen();
    // 送信キューは何よりも先に起動する。
    // ここから下の API 呼び出しがどう転んでも、前回未送信の採点が
    // 復旧され、online イベントの購読も済んでいる状態にするため。
    var recovered = Outbox.init(onSaveStatus, onSaveDiscarded);
    // 技術データをAPIから取得してScoringに注入
    var techData = await Api.loadTechniques();
    if (techData && techData.techniques) {
      templateTechniques = techData.techniques;
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
    if (restored && restored.eventId) {
      document.getElementById('eventSelect').value = restored.eventId;
      await onEventSelect(restored.eventId, restored.court || '');
    }
    // ブラウザの戻る/進むに追従する
    Route.onChange(async function(sel) {
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
    var authLost = st.pending > 0 && (st.lastStatus === 401 || st.lastStatus === 403);
    saveStatusEl.classList.remove('sending', 'retrying');
    if (st.state === 'idle') {
      saveStatusEl.textContent = '● 保存済み';
    } else if (st.state === 'sending') {
      saveStatusEl.textContent = '◌ 保存中…';
      saveStatusEl.classList.add('sending');
    } else if (authLost) {
      saveStatusEl.textContent = '⚠ 認証が切れました・ページを再読み込みしてください';
      saveStatusEl.classList.add('retrying');
    } else {
      saveStatusEl.textContent = '⚠ 未保存 ' + st.pending + ' 件・再送中';
      saveStatusEl.classList.add('retrying');
    }

    // 最初の失敗から30秒経っても未保存が残っていればバナーに昇格する。
    // 認証切れは待っても直らないので即座に昇格する。
    var stale = st.failingSince && (Date.now() - st.failingSince >= BANNER_AFTER_MS);
    if (authLost) {
      saveBannerTextEl.textContent =
        '⚠ 認証が切れています。ページを再読み込みしてください（未保存 ' + st.pending + ' 件は保持されます）';
      saveBannerEl.style.display = 'flex';
    } else if (st.pending > 0 && stale) {
      saveBannerTextEl.textContent =
        '⚠ サーバーに保存できていません（' + st.pending + '件未保存）';
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
      return '  選手ID ' + e.playerId + ' / ' + ('score' in e ? e.score + '点' : '備考');
    }).join('\n');
    alert('保存できなかった採点が ' + entries.length + ' 件あります。\n' +
          'サーバーが受け付けませんでした。\n' +
          '（名簿を入れ直した直後や、大会が「最終結果」「アーカイブ」になっているときに起きます）\n\n' +
          detail + '\n\n' +
          '運営画面で状態を確認してください。\n' +
          '該当する選手の採点を確認し、必要なら入力し直してください。');
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

    document.getElementById('btnExport').addEventListener('click', onCsvExport);
    document.getElementById('btnDownloadHtml').addEventListener('click', onDownloadHtml);
    document.getElementById('btnPlayerListToggle').addEventListener('click', togglePlayerList);
    btnConfirm.addEventListener('click', onConfirm);
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
    var list = Courts.listFrom(players);
    courtSelect.innerHTML = '<option value="">全コート</option>';
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement('option');
      opt.value = list[i];
      opt.textContent = courtOptionLabel(list[i]);
      courtSelect.appendChild(opt);
    }
    // 名簿が入っている大会で、選択中のコートがそこに無ければ全コートへ戻す
    if (currentCourt && players.length > 0 && list.indexOf(currentCourt) === -1) {
      currentCourt = '';
    }
    // 名簿がまだ入っていない場合は、配布されたURLのコート指定を落とさない。
    // 「先に端末を配ってURLを開かせ、後から名簿を入れる」段取りがあるため、
    // 選択肢として残しておく。
    if (currentCourt && list.indexOf(currentCourt) === -1) {
      var pending = document.createElement('option');
      pending.value = currentCourt;
      pending.textContent = courtOptionLabel(currentCourt);
      courtSelect.appendChild(pending);
    }
    courtSelect.value = currentCourt;
  }

  // 絞り込みを適用して画面を作り直す
  function applyCourtFilter() {
    visiblePlayers = filterForStatus(Courts.filter(players, currentCourt));
    currentIndex = -1;
    if (visiblePlayers.length > 0) {
      selectPlayer(0);
    } else {
      scoreTableBody.innerHTML = '';
      setTotalDisplay(0);
      playerNameLabel.textContent = players.length > 0
        ? '（このコートに選手がいません）'
        : '（選手がいません）';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = '';
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

  // いま開いている選手のコート。選手がいなければコート選択の値。
  function currentCourtName() {
    var p = visiblePlayers[currentIndex];
    return p ? Courts.courtOf(p) : currentCourt;
  }

  // いま開いている選手を採点してよいか。状態が採点できることに加えて、
  // 決戦のコート制限（EventStatus.scoringCourtFilter）も見る。
  //   二巡目 進行中 … 決戦コートは「決戦を開始」の後
  //   決戦 進行中   … 決戦コート以外は斬り終わっている
  function scoringOpenHere() {
    if (!scoringOpen()) return false;
    return EventStatus.isCourtScorable(currentStatus(), currentEvent, currentCourtName());
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
        // 状態は採点できるが、このコートは今は採点できない（決戦のコート制限）
        el.className = 'status-banner closed';
        el.textContent = (st === 'round2')
          ? '決戦コートは「決戦を開始」の後に採点します'
          : '決戦 進行中。採点できるのは決戦コートだけです';
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
    var locked = !!currentEvent && !scoringOpenHere();
    // 確定済みは「採点できる状態」のまま入力だけ止める。確定ボタンは押せる（取り消しのトグル）。
    var frozen = locked || currentConfirmed();
    document.body.classList.toggle('scoring-locked', locked);
    document.body.classList.toggle('score-frozen', frozen);
    btnConfirm.disabled = locked;
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
  function filterForStatus(list) {
    var round = currentEvent ? EventStatus.scoringRound(currentStatus()) : null;
    if (!round) return list;
    return list.filter(function(p) { return Courts.roundOf(p) === round; });
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
      Scoring.setTechniques(event.techniques);
    } else if (templateTechniques) {
      Scoring.setTechniques(templateTechniques);
    }
  }

  // サーバーから読み直した大会データを画面の状態に取り込む。
  // 未送信の採点はキューのほうが新しいので必ず上書きする。これを忘れると
  // 画面がサーバーの古い値へ巻き戻り、次の1タップがその古いDOMから
  // 再エンコードされて未送信分を破棄する。
  // 読み直す経路が複数あるため、ここに一本化して付け忘れを防ぐ。
  function adoptEvent(event) {
    currentEvent = event;
    players = event.players || [];
    Outbox.applyPending(event.id, players);
    // 大会を読み直す経路（onEventSelect / refreshFromServer）はここに集まる。
    // 配点の入れ替えもここでやると付け忘れない。
    applyEventTechniques(event);
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
      refreshCourtList();
      scoreTableBody.innerHTML = '';
      setTotalDisplay(0);
      playerNameLabel.textContent = '（大会を選択してください）';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = '';
      clearAdjustInputs();
      Route.clear();
      refreshPlayerList();
      updateAdminLink('');
      updateTechniquesLink('');
      renderStatusBanner();
      applyScoringLock();
      // 大会を離れたら配点も雛形に戻す（次に選ぶ大会まで前の大会の配点を持ち越さない）。
      if (templateTechniques) Scoring.setTechniques(templateTechniques);
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
  // 採点できない状態や、まだ何も入れていない選手では聞かない。戻り値 true なら移動してよい。
  function confirmLeave() {
    var p = visiblePlayers[currentIndex];
    if (!p || !scoringOpenHere() || p.confirmed) return true;
    if (!gridEdited && !Courts.isScored(p)) return true;
    return confirm('この選手の採点がまだ確定されていません。確定せずに移動しますか？');
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
    // バナーとロックを見直す（決戦コートの制限は選手のコートで決まる）。
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
    adoptEvent(loaded);
    refreshCourtList();
    visiblePlayers = filterForStatus(Courts.filter(players, currentCourt));
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
      courtLabel.textContent = m[1] + 'コート';
      playerOrderLabel.textContent = m[2] + ' ' + m[3] + '巡目 ' + m[4] + '番' + bib;
    } else {
      courtLabel.textContent = '';
      playerOrderLabel.textContent = (p.order || '') + bib;
    }
    playerNameLabel.textContent = p.name || '';

    // 決戦 進行中は、決戦の何人目かを順番の右に添える（設計書「採点画面」）。
    if (currentStatus() === 'round2_final' && p.finalist === true) {
      var fin = Courts.finalists(players);
      var at = 0;
      for (var fi = 0; fi < fin.length; fi++) {
        if (fin[fi].id === p.id) { at = fi + 1; break; }
      }
      if (at > 0) {
        playerOrderLabel.textContent += '　決戦 ' + at + '/' + fin.length;
      }
    }
  }

  // --- スコアグリッド描画 ---
  function renderScoreGrid(player) {
    scoreTableBody.innerHTML = '';
    gridDirty = false;
    gridEdited = false;
    noticeRow = null;
    selectedRow = -1;
    var techNames = [player.tech1, player.tech2, player.tech3].filter(Boolean);
    totalAdjustInput.value = adjustText(player.totalAdjust);
    noteInput.value = player.note || '';
    // 技が無い選手は補正段ごと隠す（無効の欄に値だけ見えていると「合計に入っていない」ように見えるため）
    adjustBar.classList.toggle('is-hidden', techNames.length === 0);
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
      var tr = buildScoreRow(techNames[i], player.isFemale, rowData, i);
      scoreTableBody.appendChild(tr);
    }
    selectRow(0);
    if (decoded) {
      updateTotal();
    } else {
      setTotalDisplay(player.score || 0);
    }
    applyConfirmedStyle(!!player.confirmed);
    applyScoringLock();
  }

  function buildScoreRow(techName, isFemale, rowData, rowIndex) {
    var tr = document.createElement('tr');
    tr.dataset.tech = techName;
    tr.dataset.row = rowIndex;

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

  // 行の補正点入力欄の値（空欄は 0）
  function rowAdjust(tr) {
    var inp = tr.querySelector('.adjust-input');
    if (!inp) return 0;
    var n = parseInt(inp.value, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function totalAdjustValue() {
    var n = parseInt(totalAdjustInput.value, 10);
    return Number.isFinite(n) ? n : 0;
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
      if (!confirm('確定を取り消しますか？（取り消すと点数を直せます）')) return;
      p.confirmed = false;
      gridEdited = true;
      applyConfirmedStyle(false);
      applyScoringLock();
      saveCurrentState();
      Api.addHistory(currentEvent.id, {
        action: 'unconfirm',
        playerName: p.name || '',
        detail: '確定を取り消し（' + (p.score || 0) + '点）'
      });
      return;
    }
    if (!hasScoreRows()) {
      alert('技が未入力のため確定できません。');
      return;
    }
    if (!gridRestorable && !gridDirty) {
      alert('内訳を復元できない選手は、採点し直してから確定してください。');
      return;
    }
    p.confirmed = true;
    gridEdited = true;
    applyConfirmedStyle(true);
    applyScoringLock();   // 確定済みは点数を触れない
    saveCurrentState();
    Api.addHistory(currentEvent.id, {
      action: 'confirm',
      playerName: p.name || '',
      detail: '確定（' + (p.score || 0) + '点）'
    });
  }

  // 補正点の欄に入れる表示文字列（0 と非数は空欄）
  function adjustText(v) {
    return Number(v) ? String(Math.trunc(v)) : '';
  }

  function onTotalAdjustChange() {
    if (!currentEvent || !hasScoreRows()) return;
    var p = visiblePlayers[currentIndex];
    // 置き換えを断られたら、入力を保存値へ戻す。空欄にすると表示と
    // player.totalAdjust が食い違い、次の置き換えで 0 として消える。
    if (!confirmReplaceIfNeeded()) {
      totalAdjustInput.value = p ? adjustText(p.totalAdjust) : '';
      return;
    }
    var n = totalAdjustValue();
    totalAdjustInput.value = adjustText(n);
    gridEdited = true;
    unconfirmIfNeeded();
    updateTotal();
    saveCurrentState();
    Api.addHistory(currentEvent.id, {
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
    // 断られたら描画時の値へ戻す（空欄にしない。理由は onTotalAdjustChange と同じ）
    if (!confirmReplaceIfNeeded()) { inp.value = inp.dataset.initial || ''; return; }
    var n = rowAdjust(tr);
    inp.value = adjustText(n);
    var p = visiblePlayers[currentIndex];
    gridEdited = true;
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    Api.addHistory(currentEvent.id, {
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
    Api.addHistory(currentEvent.id, {
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

  function updateTotal() {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    // 技が無い選手は採点できない
    if (rows.length === 0) return;
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      var sc = rows[i].querySelector('.score-col');
      if (sc) total += parseInt(sc.dataset.score, 10) || 0;
    }
    total += totalAdjustValue();
    setTotalDisplay(total);
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
      confirmed: p.confirmed
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
    Api.addHistory(currentEvent.id, {
      action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10), strike: 'all', value: '○', detail: '形成功'
    });
  }

  // 「失敗」: 選択中の技の行の最初の「未」（配点のある太刀）を失敗にする（残りは自動で無効になる）
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
    Api.addHistory(currentEvent.id, {
      action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10), strike: 'rest', value: '×',
      detail: '未を失敗に' + (voided ? '（以降の太刀は無効）' : '')
    });
  }

  // 形成功・失敗の共通ガード。対象の行（tr）を返す。操作できなければ null。
  function guardRowAction() {
    if (!currentEvent) { alert('大会が選択されていません。'); return null; }
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

  // --- CSV エクスポート ---
  async function onCsvExport() {
    if (!currentEvent) { alert('大会を選択してください。'); return; }
    if (players.length === 0) { alert('エクスポートするデータがありません。'); return; }
    // await をまたぐので、対象の大会をここで固定する。
    // 通信中に大会を切り替えられると、別の大会のCSVを保存してしまう。
    var eventId = currentEvent.id;
    var csvText = await Api.exportCsv(eventId);
    if (!csvText) { alert('エクスポートに失敗しました。'); return; }
    if (!currentEvent || currentEvent.id !== eventId) return;  // 追い越された
    Storage.downloadCsv('players.csv', csvText);
  }

  async function onDownloadHtml() {
    if (!currentEvent) { alert('大会を選択してください。'); return; }
    // 手元の players は自分が大会を開いた時点のもので、他コートの端末が
    // その後つけた得点が入っていない。成績表なので必ず取り直す。
    // await をまたぐので、対象の大会をここで固定する。
    // 通信中に大会を切り替えられると、別の大会の内容を出力してしまう。
    var eventId = currentEvent.id;
    var latest = await Api.loadEvent(eventId);
    if (!latest) { alert('最新の大会データを取得できませんでした。'); return; }
    if (!currentEvent || currentEvent.id !== eventId) return;  // 追い越された
    var all = latest.players || [];
    // この端末の未送信分もキューが正なので反映する
    Outbox.applyPending(eventId, all);
    if (all.length === 0) { alert('ダウンロードするデータがありません。'); return; }
    Storage.downloadHtml('result.html', Storage.buildPlayersHtml(all));
  }

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
    for (var i = 0; i < visiblePlayers.length; i++) {
      playerListBody.appendChild(buildPlayerListRow(i));
    }
  }

  function buildPlayerListRow(index) {
    var p = visiblePlayers[index];
    var tr = document.createElement('tr');
    tr.dataset.index = index;
    if (index === currentIndex) tr.classList.add('current-player');
    if (p.confirmed) tr.classList.add('done');   // 確定済みの行はグレー（ユーザー要望）
    var hasBib = (typeof p.bib === 'number');
    tr.innerHTML =
      '<td>' + esc(p.order || '') + '</td>' +
      // 未設定は薄い「—」（数値なので esc は要らないが、列を空にはしない）
      '<td' + (hasBib ? '' : ' class="no-bib"') + '>' + (hasBib ? p.bib : '—') + '</td>' +
      '<td>' + esc(p.name || '') + '</td>' +
      '<td>' + esc(p.tech1 || '') + '</td>' +
      '<td>' + esc(p.tech2 || '') + '</td>' +
      '<td>' + esc(p.tech3 || '') + '</td>' +
      '<td class="' + (p.confirmed ? 'confirmed' : '') + '">' + (p.score || 0) + '</td>';
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
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    if (row) {
      var cells = row.querySelectorAll('td');
      cells[cells.length - 1].textContent = score;
    }
  }

  function updatePlayerListConfirmed(index, on) {
    if (!isPlayerListOpen()) return;
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    if (row) {
      row.classList.toggle('done', on);
      var cells = row.querySelectorAll('td');
      cells[cells.length - 1].classList.toggle('confirmed', on);
    }
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', App.init);
