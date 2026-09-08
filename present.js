// present.html 専用のスクリプト（大画面用・発表モード）。
// - 掲示モード（board）: 60秒ごとに自動更新しながら3部門を順に表示する。
// - 発表モード（reveal）: 部門を選んで、下位から1人ずつタップで順位を開けていく（後続タスクで実装）。
var Present = (function() {
  var REFRESH_MS = 60000;

  var CATEGORIES = [
    { key: 'male', title: '一般男子' },
    { key: 'newFace', title: '新人' },
    { key: 'female', title: '一般女子' }
  ];

  var token = '';
  var mode = 'board';
  var catIndex = 0;
  var data = null;
  var lastFetchedAt = null;
  var invalid = false;

  // 発表（reveal）モードの状態（後続タスクで使用）。
  var picking = true;
  var order = [];
  var step = 0;

  var elScreen = null;
  var elHint = null;
  var elStatus = null;
  var elModeBoard = null;
  var elModeReveal = null;
  var elRefresh = null;
  var elFull = null;

  function hhmm(date) {
    var h = String(date.getHours());
    var m = String(date.getMinutes());
    if (h.length < 2) h = '0' + h;
    if (m.length < 2) m = '0' + m;
    return h + ':' + m;
  }

  function rowsOf(index) {
    var cat = CATEGORIES[index];
    if (!cat || !data || !data.rankings) return [];
    return data.rankings[cat.key] || [];
  }

  async function load(isFirst) {
    var result = await Api.loadSharedRanking(token);

    if (!result) {
      if (isFirst) {
        invalid = true;
        render();
      } else if (lastFetchedAt) {
        elStatus.textContent = '更新できませんでした（前回 ' + hhmm(lastFetchedAt) + ' 時点）';
      }
      return;
    }

    invalid = false;
    data = result;
    lastFetchedAt = new Date();
    elStatus.textContent = hhmm(lastFetchedAt) + ' 時点';
    render();
  }

  function render() {
    if (!elScreen) return;
    elScreen.textContent = '';
    if (elHint) elHint.textContent = '';

    if (invalid) {
      var err = document.createElement('div');
      err.className = 'present-error';
      err.textContent = 'このリンクは無効です';
      elScreen.appendChild(err);
      return;
    }

    if (!data) {
      var loading = document.createElement('div');
      loading.className = 'present-error';
      loading.textContent = '読み込み中…';
      elScreen.appendChild(loading);
      return;
    }

    if (mode === 'reveal') {
      renderReveal();
    } else {
      renderBoard();
    }
  }

  function renderBoard() {
    var cat = CATEGORIES[catIndex];
    var rows = rowsOf(catIndex);

    var h1 = document.createElement('h1');
    h1.className = 'present-title';
    h1.textContent = cat.title + ' の部';
    var pageSpan = document.createElement('span');
    pageSpan.className = 'present-page';
    pageSpan.textContent = (catIndex + 1) + ' / ' + CATEGORIES.length;
    h1.appendChild(pageSpan);
    elScreen.appendChild(h1);

    var ul = document.createElement('ul');
    ul.className = 'present-list';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var li = document.createElement('li');
      if (row.rank <= 3) li.className = 'top';

      var rankEl = document.createElement('span');
      rankEl.className = 'present-rank';
      rankEl.textContent = row.rank;
      li.appendChild(rankEl);

      var nameEl = document.createElement('span');
      nameEl.className = 'present-name';
      nameEl.textContent = row.name;
      li.appendChild(nameEl);

      var scoreEl = document.createElement('span');
      scoreEl.className = 'present-score';
      scoreEl.textContent = row.score;
      li.appendChild(scoreEl);

      ul.appendChild(li);
    }
    elScreen.appendChild(ul);

    if (elHint) elHint.textContent = 'タップ／→ で次の部門　←で前';
  }

  function renderReveal() {
    // TODO: 発表モードの実装（後続タスク）。
    renderBoard();
  }

  function next() {
    catIndex = (catIndex + 1) % CATEGORIES.length;
    render();
  }

  function prev() {
    catIndex = (catIndex - 1 + CATEGORIES.length) % CATEGORIES.length;
    render();
  }

  function setMode(m) {
    mode = m;
    if (elModeBoard) {
      if (m === 'board') elModeBoard.classList.add('on');
      else elModeBoard.classList.remove('on');
    }
    if (elModeReveal) {
      if (m === 'reveal') elModeReveal.classList.add('on');
      else elModeReveal.classList.remove('on');
    }
    render();
  }

  function toggleFull() {
    if (!document.documentElement.requestFullscreen) {
      alert('全画面表示に対応していません');
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  function onKey(ev) {
    if (ev.target && ev.target.tagName === 'BUTTON') return;
    if (ev.key === 'ArrowRight' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      next();
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      prev();
    }
  }

  function init() {
    elScreen = document.getElementById('presentScreen');
    elHint = document.getElementById('presentHint');
    elStatus = document.getElementById('presentStatus');
    elModeBoard = document.getElementById('btnModeBoard');
    elModeReveal = document.getElementById('btnModeReveal');
    elRefresh = document.getElementById('btnPresentRefresh');
    elFull = document.getElementById('btnPresentFull');

    var hash = window.location.hash || '';
    if (hash.charAt(0) === '#') hash = hash.slice(1);
    token = decodeURIComponent(hash);

    elScreen.addEventListener('click', function() {
      next();
    });
    document.addEventListener('keydown', onKey);
    elModeBoard.addEventListener('click', function() {
      this.blur();
      setMode('board');
    });
    elModeReveal.addEventListener('click', function() {
      this.blur();
      setMode('reveal');
    });
    elRefresh.addEventListener('click', function() {
      load(false);
    });
    elFull.addEventListener('click', toggleFull);

    setInterval(function() {
      if (mode === 'board' && !invalid) load(false);
    }, REFRESH_MS);

    if (!token) {
      invalid = true;
      render();
      return;
    }
    load(true);
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('presentRoot')) init();
  });

  return {};
})();
