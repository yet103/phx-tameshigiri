var App = (function() {
  // --- 状態 ---
  var players = [];       // 選手データ配列
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

  // --- 初期化 ---
  function init() {
    players = Storage.loadPlayers();
    applyTheme(Storage.loadTheme());
    if (players.length > 0) selectPlayer(0);
    bindEvents();
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
  }

  // --- 選手切り替え ---
  function movePlayer(delta) {
    if (players.length === 0) return;
    saveCurrentState();
    var next = currentIndex + delta;
    if (next < 0 || next >= players.length) return;
    selectPlayer(next);
  }

  function selectPlayer(index) {
    var changed = index !== currentIndex;
    currentIndex = index;
    var p = players[index];
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
  function onStrikeClick(e) {
    var td = e.currentTarget;
    if (td.classList.contains('disabled')) return;
    var current = td.dataset.value || '';
    var next = current === '' ? '○' : current === '○' ? '×' : '';
    td.dataset.value = next;
    setCellDisplay(td, next);
    var tr = td.closest('tr');
    var p = players[currentIndex];
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
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
    if (players[currentIndex] !== undefined) {
      players[currentIndex].score = total;
      updatePlayerListScore(currentIndex, total);
    }
  }

  function saveCurrentState() {
    if (currentIndex < 0 || !players[currentIndex]) return;
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
    players[currentIndex].result = Scoring.encodeResult(rowDataArr);
    Storage.savePlayers(players);
  }

  function setAllSuccess() {
    var rows = scoreTableBody.querySelectorAll('tr');
    var p = players[currentIndex];
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

  function setAllFail() {
    var rows = scoreTableBody.querySelectorAll('tr');
    var p = players[currentIndex];
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
    var reader = new FileReader();
    reader.onload = function(ev) {
      var text = ev.target.result;
      var imported = Storage.parseCsv(text);
      if (imported.length === 0) { alert('選手データが見つかりませんでした。'); return; }
      csvFileInput.value = '';

      if (players.length > 0) {
        var choice = confirm('既存データをクリアして読み込みますか？\n（キャンセルで追記）');
        if (choice) {
          players = imported;
        } else {
          players = players.concat(imported);
        }
      } else {
        players = imported;
      }
      Storage.savePlayers(players);
      currentIndex = -1;
      if (players.length > 0) selectPlayer(0);
      renderPlayerList();
    };
    reader.readAsText(file, 'UTF-8');
  }

  function onCsvExport() {
    if (players.length === 0) { alert('エクスポートするデータがありません。'); return; }
    Storage.downloadCsv('players.csv', players);
  }

  function onDownloadHtml() {
    if (players.length === 0) { alert('ダウンロードするデータがありません。'); return; }
    var html = Storage.buildPlayersHtml(players);
    Storage.downloadHtml('result.html', html);
  }

  // --- 二巡目データ生成 ---
  function onGenNextRound() {
    if (players.length === 0) { alert('選手データがありません。'); return; }
    if (!confirm('二巡目データを生成します。よろしいですか？')) return;

    // 女子→男子の順、得点の昇順でソート
    var sorted = players.slice().sort(function(a, b) {
      var gA = a.isFemale ? 1 : 0;
      var gB = b.isFemale ? 1 : 0;
      if (gB !== gA) return gB - gA; // 女子(1)が先
      return (a.score || 0) - (b.score || 0); // 得点昇順
    });

    // 連番を性別ごとに振り直す
    var femaleCount = 0, maleCount = 0;
    var next = sorted.map(function(p) {
      var courtMatch = (p.order || '').match(/^([^-]+)/);
      var court = courtMatch ? courtMatch[1] : 'A';
      var gender = p.isFemale ? '女子' : '男子';
      var num = p.isFemale ? ++femaleCount : ++maleCount;
      return {
        name: p.name,
        order: court + '-' + gender + '-2-' + num,
        tech1: '', tech2: '', tech3: '',
        score: 0,
        isNewFace: p.isNewFace,
        isFemale: p.isFemale,
        result: ''
      };
    });

    Storage.downloadCsv('players_二巡目.csv', next);
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
    for (var i = 0; i < players.length; i++) {
      playerListBody.appendChild(buildPlayerListRow(i));
    }
  }

  function buildPlayerListRow(index) {
    var p = players[index];
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
