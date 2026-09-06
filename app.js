var App = (function() {
  // --- 状態 ---
  var currentEvent = null;   // 現在選択中の大会オブジェクト
  var players = [];          // currentEvent.players の参照
  var visiblePlayers = [];   // 選択中コートで絞り込んだ選手（巡回・一覧の対象）
  var currentCourt = '';     // '' なら全コート
  var currentIndex = -1;  // 選択中の選手インデックス
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
  var csvFileInput     = document.getElementById('csvFileInput');
  var playerListPanel  = document.getElementById('playerListPanel');
  var playerListBody   = document.getElementById('playerListBody');
  var courtSelect      = document.getElementById('courtSelect');

  // --- 初期化 ---
  async function init() {
    applyTheme(Storage.loadTheme());
    // 技術データをAPIから取得してScoringに注入
    var techData = await Api.loadTechniques();
    if (techData && techData.techniques) {
      Scoring.setTechniques(techData.techniques);
    }
    // 送信キューを起動する。前回未送信の採点があればここで再送される。
    var recovered = Outbox.init(onSaveStatus);
    if (recovered > 0) {
      alert('前回未送信の採点 ' + recovered + ' 件を送信します。');
    }
    // 大会一覧を取得してドロップダウンに展開
    await refreshEventList();
    bindEvents();
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

    document.getElementById('btnImport').addEventListener('click', function() { csvFileInput.click(); });
    csvFileInput.addEventListener('change', onCsvImport);
    document.getElementById('btnExport').addEventListener('click', onCsvExport);
    document.getElementById('btnDownloadHtml').addEventListener('click', onDownloadHtml);
    document.getElementById('btnGenNext').addEventListener('click', onGenNextRound);
    document.getElementById('btnPlayerList').addEventListener('click', togglePlayerList);
    document.getElementById('btnPlayerListClose').addEventListener('click', closePlayerList);

    // 大会管理イベント
    document.getElementById('eventSelect').addEventListener('change', function() {
      onEventSelect(this.value);
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
      await createEvent(
        name,
        document.getElementById('newEventDate').value,
        document.getElementById('newEventVenue').value.trim()
      );
      document.getElementById('newEventModal').style.display = 'none';
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
    // 選択中のコートが今の大会に存在しなければ全コートへ戻す
    if (currentCourt && list.indexOf(currentCourt) === -1) {
      currentCourt = '';
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
      totalScoreDisplay.textContent = '合計: 0点';
      playerNameLabel.textContent = players.length > 0
        ? '（このコートに選手がいません）'
        : '（選手がいません）';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = '';
    }
    refreshPlayerList();
  }

  // --- 大会管理 ---
  async function refreshEventList() {
    var events = await Api.listEvents();
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

  async function onEventSelect(eventId, court) {
    if (!eventId) {
      currentEvent = null;
      players = [];
      visiblePlayers = [];
      currentCourt = '';
      currentIndex = -1;
      refreshCourtList();
      scoreTableBody.innerHTML = '';
      totalScoreDisplay.textContent = '合計: 0点';
      playerNameLabel.textContent = '（大会を選択してください）';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = '';
      Route.clear();
      refreshPlayerList();
      return;
    }
    currentEvent = await Api.loadEvent(eventId);
    if (!currentEvent) {
      // 復元しようとした大会が既に削除されている
      Route.clear();
      document.getElementById('eventSelect').value = '';
      return;
    }
    players = currentEvent.players || [];
    if (court !== undefined) currentCourt = court;
    refreshCourtList();
    applyCourtFilter();
    Route.set(currentEvent.id, currentCourt);
  }

  async function createEvent(name, date, venue) {
    var event = {
      name: name,
      date: date,
      venue: venue,
      players: []
    };
    var result = await Api.saveEvent(event);
    if (result && result.id) {
      await refreshEventList();
      await onEventSelect(result.id);
      document.getElementById('eventSelect').value = result.id;
    }
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
  async function movePlayer(delta) {
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
    // 順番パース: コート-性別-巡目-番号
    var m = (p.order || '').match(/^(.+)-(男子|女子)-(\d+)-(\d+)$/);
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
    var techNames = [player.tech1, player.tech2, player.tech3].filter(Boolean);
    var expectedLen = techNames.length * 5;
    var validResult = player.result && player.result.length === expectedLen;
    var decoded = validResult ? Scoring.decodeResult(player.result, techNames.length) : null;

    for (var i = 0; i < techNames.length; i++) {
      var rowData = decoded ? decoded[i] : { values: ['','','',''], techPoint: '' };
      var tr = buildScoreRow(techNames[i], player.isFemale, rowData, i);
      scoreTableBody.appendChild(tr);
    }
    updateTotal();
  }

  function buildScoreRow(techName, isFemale, rowData, rowIndex) {
    var tr = document.createElement('tr');
    tr.dataset.tech = techName;
    tr.dataset.row = rowIndex;

    var tdName = document.createElement('td');
    tdName.className = 'tech-name';
    tdName.textContent = techName;
    tr.appendChild(tdName);

    var tech = Scoring.findTechnique(techName, isFemale);

    // 初〜四の太刀
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

    // 技術点
    var tdTp = document.createElement('td');
    tdTp.className = 'strike-cell';
    tdTp.dataset.strike = 'tp';
    tdTp.dataset.value = rowData.techPoint || '';
    setCellDisplay(tdTp, rowData.techPoint || '');
    tdTp.addEventListener('click', onStrikeClick);
    tr.appendChild(tdTp);

    // 得点
    var tdScore = document.createElement('td');
    tdScore.className = 'score-col';
    tr.appendChild(tdScore);

    updateRowScore(tr, isFemale);
    return tr;
  }

  function setCellDisplay(td, value) {
    td.textContent = value;
    td.classList.remove('success', 'fail');
    if (value === '○') td.classList.add('success');
    else if (value === '×') td.classList.add('fail');
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

  // --- 採点インタラクション ---
  async function onStrikeClick(e) {
    var td = e.currentTarget;
    if (td.classList.contains('disabled')) return;
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    
    var current = td.dataset.value || '';
    var next = current === '' ? '○' : current === '○' ? '×' : '';
    td.dataset.value = next;
    setCellDisplay(td, next);
    
    var tr = td.closest('tr');
    var p = visiblePlayers[currentIndex];
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    
    // 採点履歴を記録
    if (currentEvent) {
      Api.addHistory(currentEvent.id, {
        action: 'score_update',
        playerName: p ? p.name : '',
        techName: tr ? tr.dataset.tech : '',
        strike: td.dataset.strike !== 'tp' ? parseInt(td.dataset.strike) : 'tp',
        value: next,
        detail: (td.dataset.strike === 'tp' ? '技術点' : ["初太刀","二の太刀","三の太刀","四の太刀"][parseInt(td.dataset.strike)]) + ' → ' + (next || '空白')
      });
    }
  }

  function updateRowScore(tr, isFemale) {
    var techName = tr.dataset.tech;
    var values = [];
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      values.push(cell && !cell.classList.contains('disabled') ? (cell.dataset.value || '') : '');
    }
    var tpCell = tr.querySelector('[data-strike="tp"]');
    var techPoint = tpCell ? (tpCell.dataset.value || '') : '';

    var rowScore = 0;
    for (var i = 0; i < 4; i++) {
      rowScore += Scoring.calcStrikeScore(techName, i, values[i], isFemale);
    }
    if (techPoint === '○') rowScore += 3;

    var scoreCell = tr.querySelector('.score-col');
    scoreCell.textContent = rowScore > 0 ? rowScore : '';
  }

  function updateTotal() {
    var total = 0;
    var rows = scoreTableBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var sc = rows[i].querySelector('.score-col');
      if (sc) total += parseFloat(sc.textContent) || 0;
    }
    totalScoreDisplay.textContent = '合計: ' + total + '点';
    if (visiblePlayers[currentIndex] !== undefined) {
      visiblePlayers[currentIndex].score = total;
      updatePlayerListScore(currentIndex, total);
    }
  }

  // 現在の採点内容をキューに積む。通信は待たない（Outboxのワーカーが送る）。
  function saveCurrentState() {
    if (currentIndex < 0 || !visiblePlayers[currentIndex] || !currentEvent) return;
    var rows = scoreTableBody.querySelectorAll('tr');
    var rowDataArr = [];
    for (var i = 0; i < rows.length; i++) {
      var values = [];
      for (var s = 0; s < 4; s++) {
        var cell = rows[i].querySelector('[data-strike="' + s + '"]');
        values.push(cell && !cell.classList.contains('disabled') ? (cell.dataset.value || '') : '');
      }
      var tpCell = rows[i].querySelector('[data-strike="tp"]');
      rowDataArr.push({ values: values, techPoint: tpCell ? (tpCell.dataset.value || '') : '' });
    }
    var p = visiblePlayers[currentIndex];
    p.result = Scoring.encodeResult(rowDataArr);

    Outbox.enqueue({
      eventId: currentEvent.id,
      playerId: p.id,
      score: p.score,
      result: p.result
    });
  }

  async function setAllSuccess() {
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    var rows = scoreTableBody.querySelectorAll('tr');
    var p = visiblePlayers[currentIndex];
    for (var i = 0; i < rows.length; i++) {
      for (var s = 0; s < 4; s++) {
        var cell = rows[i].querySelector('[data-strike="' + s + '"]');
        if (cell && !cell.classList.contains('disabled')) {
          cell.dataset.value = '○';
          setCellDisplay(cell, '○');
        }
      }
      updateRowScore(rows[i], p ? p.isFemale : false);
    }
    updateTotal();
    saveCurrentState();
  }

  async function setAllFail() {
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    var rows = scoreTableBody.querySelectorAll('tr');
    var p = visiblePlayers[currentIndex];
    for (var i = 0; i < rows.length; i++) {
      for (var s = 0; s < 4; s++) {
        var cell = rows[i].querySelector('[data-strike="' + s + '"]');
        // ○以外の空白セルのみ×にする
        if (cell && !cell.classList.contains('disabled') && (cell.dataset.value || '') !== '○') {
          cell.dataset.value = '×';
          setCellDisplay(cell, '×');
        }
      }
      updateRowScore(rows[i], p ? p.isFemale : false);
    }
    updateTotal();
    saveCurrentState();
  }

  // --- CSV インポート/エクスポート ---
  function onCsvImport(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (!currentEvent) { alert('先に大会を選択または作成してください。'); return; }
    var reader = new FileReader();
    reader.onload = async function(ev) {
      var text = ev.target.result;
      csvFileInput.value = '';
      var mode = 'replace';
      if (players.length > 0) {
        var choice = confirm('既存データをクリアして読み込みますか？\n（キャンセルで追記）');
        mode = choice ? 'replace' : 'append';
      }
      var result = await Api.importCsv(currentEvent.id, text, mode);
      if (result && result.blocked) {
        var ok = confirm(
          'この大会には採点済みの選手が少なくとも ' + result.scoredCount + ' 名います。\n' +
          '他のコート端末による採点も含まれます。\n' +
          '読み込みを続けると、これらの採点結果はすべて失われます。\n' +
          '本当に続行しますか？'
        );
        if (!ok) return;
        result = await Api.importCsv(currentEvent.id, text, mode, true);
      }
      if (result && result.success) {
        // 大会データを再読み込み
        currentEvent = await Api.loadEvent(currentEvent.id);
        players = currentEvent.players || [];
        refreshCourtList();
        applyCourtFilter();
        // 履歴記録
        Api.addHistory(currentEvent.id, {
          action: 'csv_import',
          detail: result.playerCount + '名の選手データをインポート'
        });
      } else {
        alert('インポートに失敗しました。');
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  async function onCsvExport() {
    if (!currentEvent) { alert('大会を選択してください。'); return; }
    if (players.length === 0) { alert('エクスポートするデータがありません。'); return; }
    var csvText = await Api.exportCsv(currentEvent.id);
    if (csvText) {
      Storage.downloadCsv('players.csv', csvText);
    }
  }

  function onDownloadHtml() {
    if (players.length === 0) { alert('ダウンロードするデータがありません。'); return; }
    var html = Storage.buildPlayersHtml(players);
    Storage.downloadHtml('result.html', html);
  }

  // --- 二巡目データ生成 ---
  function onGenNextRound() {
    if (!currentEvent || players.length === 0) { alert('選手データがありません。'); return; }
    if (!confirm('二巡目データを生成します。よろしいですか？')) return;

    // 女子→男子の順、得点の昇順でソート
    var sorted = players.slice().sort(function(a, b) {
      var gA = a.isFemale ? 1 : 0;
      var gB = b.isFemale ? 1 : 0;
      if (gB !== gA) return gB - gA; // 女子(1)が先
      return (a.score || 0) - (b.score || 0); // 得点昇順
    });

    var femaleCount = 0, maleCount = 0;
    var lines = ['選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果'];
    sorted.forEach(function(p) {
      var courtMatch = (p.order || '').match(/^([^-]+)/);
      var court = courtMatch ? courtMatch[1] : 'A';
      var gender = p.isFemale ? '女子' : '男子';
      var num = p.isFemale ? ++femaleCount : ++maleCount;
      var order = court + '-' + gender + '-2-' + num;
      lines.push([p.name, order, '', '', '', '0', p.isNewFace ? '○' : '', p.isFemale ? '○' : '', ''].join(','));
    });
    Storage.downloadCsv('players_二巡目.csv', lines.join('\r\n'));
  }

  // --- 選手一覧パネル ---
  function togglePlayerList() {
    if (playerListPanel.classList.contains('open')) {
      closePlayerList();
    } else {
      openPlayerList();
    }
  }

  function openPlayerList() {
    renderPlayerList();
    playerListPanel.classList.add('open');
    document.getElementById('btnPlayerList').classList.add('active');
  }

  function closePlayerList() {
    playerListPanel.classList.remove('open');
    document.getElementById('btnPlayerList').classList.remove('active');
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
      '<td>' + (p.score || 0) + '</td>';
    tr.addEventListener('click', function() {
      var idx = parseInt(this.dataset.index, 10);
      saveCurrentState();
      selectPlayer(idx);
    });
    return tr;
  }

  // 選手データ自体が入れ替わったとき用（開いていれば一覧を作り直す）
  function refreshPlayerList() {
    if (!playerListPanel.classList.contains('open')) return;
    renderPlayerList();
  }

  function updatePlayerList() {
    if (!playerListPanel.classList.contains('open')) return;
    var rows = playerListBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var idx = parseInt(rows[i].dataset.index, 10);
      rows[i].classList.toggle('current-player', idx === currentIndex);
    }
    // 現在の選手行を表示領域内にスクロール
    var currentRow = playerListBody.querySelector('tr.current-player');
    if (currentRow) currentRow.scrollIntoView({ block: 'nearest' });
  }

  function updatePlayerListScore(index, score) {
    if (!playerListPanel.classList.contains('open')) return;
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    if (row) {
      var cells = row.querySelectorAll('td');
      cells[cells.length - 1].textContent = score;
    }
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', App.init);
