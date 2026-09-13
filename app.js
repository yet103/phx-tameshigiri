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

  // --- DOM参照 ---
  var courtLabel       = document.getElementById('courtLabel');
  var playerOrderLabel = document.getElementById('playerOrderLabel');
  var playerNameLabel  = document.getElementById('playerNameLabel');
  var scoreTableBody   = document.getElementById('scoreTableBody');
  var totalScoreDisplay= document.getElementById('totalScoreDisplay');
  var timerDisplay     = document.getElementById('timerDisplay');
  var playerListSection = document.getElementById('playerListSection');
  var playerListBody   = document.getElementById('playerListBody');
  var courtSelect      = document.getElementById('courtSelect');
  var totalAdjustInput = document.getElementById('totalAdjustInput');
  var noteInput        = document.getElementById('noteInput');
  var btnConfirm       = document.getElementById('btnConfirm');
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
    saveStatusEl.classList.remove('sending', 'retrying');
    if (st.state === 'idle') {
      saveStatusEl.textContent = '● 保存済み';
    } else if (st.state === 'sending') {
      saveStatusEl.textContent = '◌ 保存中…';
      saveStatusEl.classList.add('sending');
    } else {
      saveStatusEl.textContent = '⚠ 未保存 ' + st.pending + ' 件・再送中';
      saveStatusEl.classList.add('retrying');
    }

    // 最初の失敗から30秒経っても未保存が残っていればバナーに昇格する
    var stale = st.failingSince && (Date.now() - st.failingSince >= BANNER_AFTER_MS);
    if (st.pending > 0 && stale) {
      saveBannerTextEl.textContent =
        '⚠ サーバーに保存できていません（' + st.pending + '件未保存）';
      saveBannerEl.style.display = 'flex';
    } else {
      saveBannerEl.style.display = 'none';
    }
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
      return '  選手ID ' + e.playerId + ' / ' + e.score + '点';
    }).join('\n');
    alert('保存できなかった採点が ' + entries.length + ' 件あります。\n' +
          '対象の選手がサーバー上に見つかりませんでした。\n' +
          '（名簿を入れ直した直後などに起きます）\n\n' + detail + '\n\n' +
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

    // 大会管理イベント
    document.getElementById('eventSelect').addEventListener('change', function() {
      currentCourt = '';   // 大会が変われば担当コートも選び直す
      onEventSelect(this.value, '');
    });
    courtSelect.addEventListener('change', function() {
      currentCourt = this.value;
      applyCourtFilter();
      if (currentEvent) Route.set(currentEvent.id, currentCourt);
    });
    document.getElementById('btnNewEvent').addEventListener('click', function() {
      document.getElementById('newEventModal').style.display = 'flex';
      document.getElementById('newEventName').value = '';
      document.getElementById('newEventDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('newEventVenue').value = '';
      document.getElementById('newEventName').focus();
    });
    document.getElementById('btnCancelNewEvent').addEventListener('click', function() {
      document.getElementById('newEventModal').style.display = 'none';
    });
    document.getElementById('btnCreateEvent').addEventListener('click', async function() {
      var name = document.getElementById('newEventName').value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      var created = await createEvent(
        name,
        document.getElementById('newEventDate').value,
        document.getElementById('newEventVenue').value.trim()
      );
      // 失敗したらモーダルは開いたままにして、入力内容を残す
      if (created) {
        document.getElementById('newEventModal').style.display = 'none';
      }
    });
    document.getElementById('btnDeleteEvent').addEventListener('click', function() {
      onDeleteEvent();
    });

    document.getElementById('btnRetrySave').addEventListener('click', function() {
      Outbox.flushNow();
    });

    // 未送信の採点があるときだけ離脱を警告する
    window.addEventListener('beforeunload', function(e) {
      if (Outbox.pendingCount() > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // --- コート ---
  // 現在の大会の選手からコート選択肢を作り直す
  function refreshCourtList() {
    var list = Courts.listFrom(players);
    courtSelect.innerHTML = '<option value="">全コート</option>';
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement('option');
      opt.value = list[i];
      opt.textContent = list[i] === Courts.UNASSIGNED ? Courts.UNASSIGNED : list[i] + ' コート';
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
      pending.textContent = currentCourt + ' コート';
      courtSelect.appendChild(pending);
    }
    courtSelect.value = currentCourt;
  }

  // 絞り込みを適用して画面を作り直す
  function applyCourtFilter() {
    visiblePlayers = Courts.filter(players, currentCourt);
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
    }
    refreshPlayerList();
  }

  // --- 大会管理 ---
  async function refreshEventList() {
    var events = await Api.listEvents();
    if (!events) {
      // 取得できなかっただけで、大会が消えたわけではない。
      // 一覧を空にすると「大会が無くなった」ように見えるので、今の表示を保つ。
      alert('大会一覧を取得できませんでした。通信を確認してください。');
      return;
    }
    var select = document.getElementById('eventSelect');
    select.innerHTML = '<option value="">-- 大会を選択 --</option>';
    for (var i = 0; i < events.length; i++) {
      var opt = document.createElement('option');
      opt.value = events[i].id;
      opt.textContent = events[i].name + ' (' + (events[i].date || '') + ')';
      select.appendChild(opt);
    }
    // 前回選択していた大会があれば再選択
    if (currentEvent) {
      select.value = currentEvent.id;
    }
  }

  // 大会読み込みの再入ガード。
  // Api.loadEvent の往復中に別の大会やコートへ切り替えられると、
  // 遅れて戻ってきた古い応答が新しい選択を上書きし、
  // 「画面はA大会・内部状態はB大会」というねじれが起きる。
  // 採点対象の取り違えに直結するため、最後の要求だけが状態を書き換えるようにする。
  var loadSeq = 0;

  // サーバーから読み直した大会データを画面の状態に取り込む。
  // 未送信の採点はキューのほうが新しいので必ず上書きする。これを忘れると
  // 画面がサーバーの古い値へ巻き戻り、次の1タップがその古いDOMから
  // 再エンコードされて未送信分を破棄する。
  // 読み直す経路が複数あるため、ここに一本化して付け忘れを防ぐ。
  function adoptEvent(event) {
    currentEvent = event;
    players = event.players || [];
    Outbox.applyPending(event.id, players);
  }

  // 運営画面リンクに選択中の大会を引き継がせる。採点画面と運営画面は
  // 控え（localStorage）を別キー（tmg_last / tmg_admin_last）で持つため、
  // ハッシュ無しの遷移だと相手側が最後に見ていた大会に着地してしまう。
  // ハッシュを付けて運営画面の選手タブへ直接渡す。
  function updateAdminLink(eventId) {
    var link = document.getElementById('linkAdmin');
    if (!link) return;   // このリンクを持たないページから呼ばれても落ちないように
    link.href = eventId
      ? 'admin.html#players/' + encodeURIComponent(eventId)
      : 'admin.html';
  }

  async function onEventSelect(eventId, court) {
    var seq = ++loadSeq;
    if (!eventId) {
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
      return;
    }
    var loaded = await Api.loadEvent(eventId);
    if (seq !== loadSeq) return;   // 追い越された。古い応答は捨てる
    if (!loaded) {
      // 復元しようとした大会が既に削除されている。
      // 前の大会の選手や得点が画面に残らないよう、未選択状態まで戻す。
      currentEvent = null;
      document.getElementById('eventSelect').value = '';
      await onEventSelect('');
      return;
    }
    adoptEvent(loaded);
    if (court !== undefined) currentCourt = court;
    refreshCourtList();
    applyCourtFilter();
    Route.set(currentEvent.id, currentCourt);
    updateAdminLink(currentEvent.id);
  }

  // 戻り値: 作成できたら true。呼び出し元はこれを見てモーダルを閉じるか決める
  // （失敗して閉じてしまうと、入力し直しになる）
  async function createEvent(name, date, venue) {
    var event = {
      name: name,
      date: date,
      venue: venue,
      players: []
    };
    var result = await Api.saveEvent(event);
    if (!result || !result.id) {
      alert('大会の作成に失敗しました。');
      return false;
    }
    await refreshEventList();
    document.getElementById('eventSelect').value = result.id;
    currentCourt = '';
    await onEventSelect(result.id, '');
    return true;
  }

  async function onDeleteEvent() {
    if (!currentEvent) return;
    if (!confirm('大会「' + currentEvent.name + '」を削除します。よろしいですか？')) return;
    var ok = await Api.deleteEvent(currentEvent.id);
    if (!ok) { alert('大会の削除に失敗しました。'); return; }
    await refreshEventList();
    document.getElementById('eventSelect').value = '';
    await onEventSelect('');
  }

  // --- 選手切り替え ---
  function movePlayer(delta) {
    if (visiblePlayers.length === 0) return;
    saveCurrentState();
    var next = currentIndex + delta;
    if (next < 0 || next >= visiblePlayers.length) return;
    selectPlayer(next);
  }

  function selectPlayer(index) {
    var changed = index !== currentIndex;
    currentIndex = index;
    var p = visiblePlayers[index];
    updatePlayerLabels(p);
    renderScoreGrid(p);
    if (changed) resetTimer();
    updatePlayerList();
  }

  function updatePlayerLabels(p) {
    // 順番パース: コート-性別-巡目-番号（コート名は Courts.roundOf 等と同じく「-」を含まない前提）
    var m = (p.order || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    if (m) {
      courtLabel.textContent = m[1] + 'コート';
      playerOrderLabel.textContent = m[2] + ' ' + m[3] + '巡目 ' + m[4] + '番';
    } else {
      courtLabel.textContent = '';
      playerOrderLabel.textContent = p.order || '';
    }
    playerNameLabel.textContent = p.name || '';
  }

  // --- スコアグリッド描画 ---
  function renderScoreGrid(player) {
    scoreTableBody.innerHTML = '';
    gridDirty = false;
    gridEdited = false;
    noticeRow = null;
    selectedRow = -1;
    var techNames = [player.tech1, player.tech2, player.tech3].filter(Boolean);
    // 全体補正点・備考は技の有無に関わらず表示する（技が無いときは編集不可）
    totalAdjustInput.value = adjustText(player.totalAdjust);
    noteInput.value = player.note || '';
    if (techNames.length === 0) {
      // 技が未入力（進行タブでまだ入力されていない二巡目の選手など）。
      // 空のグリッドから合計0を計算して上書き保存すると既存の得点が消えるので、
      // 表示だけ既存の得点にして、選手データにも保存キューにも触れない。
      gridRestorable = false;
      var trEmpty = document.createElement('tr');
      var tdEmpty = document.createElement('td');
      tdEmpty.colSpan = 7;
      tdEmpty.className = 'score-empty';
      tdEmpty.textContent = '技が未入力です。運営画面の進行タブで技を入力してください。';
      trEmpty.appendChild(tdEmpty);
      scoreTableBody.appendChild(trEmpty);
      setTotalDisplay(player.score || 0);
      totalAdjustInput.disabled = true;
      noteInput.disabled = true;
      applyConfirmedStyle(!!player.confirmed);
      return;
    }
    totalAdjustInput.disabled = false;
    noteInput.disabled = false;
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

    updateRowScore(tr, isFemale);
    return tr;
  }

  function setCellDisplay(td, value) {
    td.classList.remove('success', 'fail', 'empty');
    if (value === '○') { td.textContent = '成功'; td.classList.add('success'); }
    else if (value === '×') { td.textContent = '失敗'; td.classList.add('fail'); }
    else { td.textContent = '未'; td.classList.add('empty'); }
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

  // --- タイマー ---
  function startTimer() {
    if (timerRunning) return;
    timerRunning = true;
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
  }

  function stopTimer() {
    timerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function resetTimer() {
    stopTimer();
    timerSec = 300;
    timerDisplay.textContent = '05:00';
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function setTotalDisplay(n) {
    totalScoreDisplay.textContent = '合計: ' + n + '点';
  }

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
    totalAdjustInput.value = '';
    noteInput.value = '';
    totalAdjustInput.disabled = true;
    noteInput.disabled = true;
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
    // 既に確定済みなら何もしない。技の有無を先に見ると、技が無い確定済みの
    // 選手をただ開いただけで無関係な警告が出る。
    if (p.confirmed) return;
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
    var td = e.currentTarget;
    if (td.classList.contains('disabled')) return;
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    // 技が無い選手は採点できない
    if (!hasScoreRows()) return;
    if (!confirmReplaceIfNeeded()) return;

    var tr = td.closest('tr');
    selectRow(parseInt(tr.dataset.row, 10));
    var current = td.dataset.value || '';
    var next = current === '' ? '○' : current === '○' ? '×' : '';
    td.dataset.value = next;
    setCellDisplay(td, next);

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
      // 同じ技を複数の枠に入れられるので、techName だけでは行を特定できない。
      // buildScoreRow が振った 0 始まりの行番号（tr.dataset.row）も残す。
      techRow: parseInt(tr.dataset.row, 10),
      strike: parseInt(td.dataset.strike, 10),
      value: next,
      detail: STRIKE_LABELS[parseInt(td.dataset.strike, 10)] + ' → ' +
              (next === '○' ? '成功' : next === '×' ? '失敗' : '未')
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

  // 「失敗」: 選択中の技の行の「未」だけを失敗にする（成功は触らない）
  function setAllFail() {
    var tr = guardRowAction();
    if (!tr) return;
    var p = visiblePlayers[currentIndex];
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      if (cell && !cell.classList.contains('disabled') && (cell.dataset.value || '') === '') {
        cell.dataset.value = '×';
        setCellDisplay(cell, '×');
      }
    }
    gridEdited = true;
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    Api.addHistory(currentEvent.id, {
      action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10), strike: 'rest', value: '×', detail: '未を失敗に'
    });
  }

  // 形成功・失敗の共通ガード。対象の行（tr）を返す。操作できなければ null。
  function guardRowAction() {
    if (!currentEvent) { alert('大会が選択されていません。'); return null; }
    if (!hasScoreRows()) {
      alert('技が未入力のため採点できません。運営画面の進行タブで技を入力してください。');
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
    tr.innerHTML =
      '<td>' + esc(p.order || '') + '</td>' +
      '<td>' + esc(p.name || '') + '</td>' +
      '<td>' + esc(p.tech1 || '') + '</td>' +
      '<td>' + esc(p.tech2 || '') + '</td>' +
      '<td>' + esc(p.tech3 || '') + '</td>' +
      '<td class="' + (p.confirmed ? 'confirmed' : '') + '">' + (p.score || 0) + '</td>';
    tr.addEventListener('click', function() {
      var idx = parseInt(this.dataset.index, 10);
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
