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
  var lastUpdatedAt = null;
  var rendered = false;
  var invalid = false;
  var busy = false;
  var pendingRefresh = false;
  var tokenSeq = 0;
  var timerId = null;

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

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(function() {
      if (mode === 'board') load();
    }, REFRESH_MS);
  }

  function decodeToken() {
    var hash = window.location.hash || '';
    if (hash.charAt(0) === '#') hash = hash.slice(1);
    try {
      return decodeURIComponent(hash);
    } catch (e) {
      return hash;
    }
  }

  function showFetchError() {
    // まだ一度も描画できていない状態での通信失敗。前回表示がないので専用メッセージを出す。
    if (!elScreen) return;
    elScreen.textContent = '';
    if (elHint) elHint.textContent = '';
    var err = document.createElement('div');
    err.className = 'present-error';
    err.textContent = '順位を取得できませんでした。通信を確認してください。';
    elScreen.appendChild(err);
  }

  function setInvalid() {
    // 404/400 はトークンが無効と確定しているので、ポーリングを止めて叩き続けない。
    invalid = true;
    rendered = false;
    lastUpdatedAt = null;
    stopTimer();
    render();
  }

  function rowsOf(index) {
    var cat = CATEGORIES[index];
    if (!cat || !data || !data.rankings) return [];
    return data.rankings[cat.key] || [];
  }

  // 発表（C）モードで開く順。下位から1人ずつ、最後が先頭行（＝1位）。
  // 同順位もまとめず1人ずつ、一覧の並びの後ろから開く（司会が1人ずつ読み上げるため）。
  // 戻り値は rankings 配列への添字の列。
  function revealOrder(rows) {
    var out = [];
    var n = (rows || []).length;
    for (var i = n - 1; i >= 0; i--) out.push(i);
    return out;
  }

  // Api.fetchSharedRanking の結果で状態を進める。busy 中に来た呼び出しは捨てず
  // pendingRefresh に立てておき、進行中の取得が終わった時点でもう一度だけ実行する。
  async function load() {
    if (busy) {
      pendingRefresh = true;
      return;
    }
    busy = true;
    var mySeq = tokenSeq;
    var result = await Api.fetchSharedRanking(token);
    if (mySeq !== tokenSeq) {
      // hashchange で別トークンに切り替わった後に届いた古い応答は無視する
      // （busy/pendingRefresh は切替後の呼び出し側が管理している）。
      return;
    }
    busy = false;

    if (result.ok) {
      invalid = false;
      data = result.data;
      lastFetchedAt = new Date();
      if (elStatus) elStatus.textContent = hhmm(lastFetchedAt) + ' 時点';

      // 発表中に人数が変わっても添字がずれないように order を取り直す
      if (mode === 'reveal' && !picking) {
        order = revealOrder(rowsOf(catIndex));
        if (step > order.length) step = order.length;
      }

      var updatedAt = data.event ? data.event.updatedAt : null;
      if (!rendered || updatedAt !== lastUpdatedAt) {
        lastUpdatedAt = updatedAt;
        rendered = true;
        render();
      }
    } else if (result.status === 400 || result.status === 404) {
      setInvalid();
    } else if (!rendered) {
      if (elStatus) elStatus.textContent = '取得できませんでした';
      showFetchError();
    } else if (elStatus) {
      elStatus.textContent = '更新できませんでした（前回 ' +
        (lastFetchedAt ? hhmm(lastFetchedAt) : '—') + ' 時点）';
    }

    if (pendingRefresh) {
      pendingRefresh = false;
      load();
    }
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

    if (rows.length === 0) {
      var boardEmpty = document.createElement('div');
      boardEmpty.className = 'present-error';
      boardEmpty.textContent = 'データなし';
      elScreen.appendChild(boardEmpty);
      if (elHint) elHint.textContent = 'タップ／→ で次の部門　←で前';
      return;
    }

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
    if (picking) {
      var h1 = document.createElement('h1');
      h1.className = 'present-title';
      h1.textContent = '部門を選んでください';
      elScreen.appendChild(h1);

      var pick = document.createElement('div');
      pick.className = 'present-pick';
      for (var i = 0; i < CATEGORIES.length; i++) {
        (function(index) {
          var btn = document.createElement('button');
          btn.setAttribute('data-cat', String(index));
          btn.textContent = CATEGORIES[index].title;
          btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            startCategory(index);
          });
          pick.appendChild(btn);
        })(i);
      }
      elScreen.appendChild(pick);
      if (elHint) elHint.textContent = '';
      return;
    }

    var cat = CATEGORIES[catIndex];
    var rows = rowsOf(catIndex);

    var title = document.createElement('h1');
    title.className = 'present-title';
    title.textContent = cat.title + ' の部　発表';
    elScreen.appendChild(title);

    if (rows.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'present-error';
      empty.textContent = 'データなし';
      elScreen.appendChild(empty);

      if (elHint) {
        elHint.textContent = '';
        var strongEmpty = document.createElement('strong');
        strongEmpty.textContent = 'タップで 次の部門';
        elHint.appendChild(strongEmpty);
      }
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'present-list';
    for (var pos = 0; pos < order.length; pos++) {
      var row = rows[order[pos]];
      if (!row) continue;
      var opened = pos < step;
      var li = document.createElement('li');
      var cls = '';
      if (row.rank <= 3) cls = 'top';
      if (!opened) cls = (cls ? cls + ' ' : '') + 'veil';
      if (cls) li.className = cls;

      var rankEl = document.createElement('span');
      rankEl.className = 'present-rank';
      rankEl.textContent = row.rank;
      li.appendChild(rankEl);

      var nameEl = document.createElement('span');
      nameEl.className = 'present-name';
      nameEl.textContent = opened ? row.name : '？？？？';
      li.appendChild(nameEl);

      var scoreEl = document.createElement('span');
      scoreEl.className = 'present-score';
      scoreEl.textContent = opened ? row.score : '—';
      li.appendChild(scoreEl);

      ul.appendChild(li);
    }
    elScreen.appendChild(ul);

    if (elHint) {
      elHint.textContent = '';
      var strong = document.createElement('strong');
      var nextRow = step < order.length ? rows[order[step]] : null;
      if (nextRow) {
        strong.textContent = 'タップで ' + nextRow.rank + '位 を発表';
      } else {
        strong.textContent = 'タップで 次の部門';
      }
      elHint.appendChild(strong);
    }
  }

  function startCategory(index) {
    catIndex = index;
    picking = false;
    order = revealOrder(rowsOf(index));
    step = 0;
    render();
  }

  function revealNext() {
    if (picking) return;
    if (step < order.length) {
      step++;
      render();
    } else {
      startCategory((catIndex + 1) % CATEGORIES.length);
    }
  }

  function revealPrev() {
    if (picking) return;
    if (step > 0) {
      step--;
      render();
    }
  }

  function next() {
    if (invalid || !data) return;
    if (mode === 'reveal') {
      revealNext();
      return;
    }
    catIndex = (catIndex + 1) % CATEGORIES.length;
    render();
  }

  function prev() {
    if (invalid || !data) return;
    if (mode === 'reveal') {
      revealPrev();
      return;
    }
    catIndex = (catIndex - 1 + CATEGORIES.length) % CATEGORIES.length;
    render();
  }

  function setMode(m) {
    mode = m;
    if (m === 'reveal') {
      picking = true;
      step = 0;
      order = [];
    }
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

  function start() {
    if (!token) {
      setInvalid();
      return;
    }
    startTimer();
    load();
  }

  function init() {
    elScreen = document.getElementById('presentScreen');
    elHint = document.getElementById('presentHint');
    elStatus = document.getElementById('presentStatus');
    elModeBoard = document.getElementById('btnModeBoard');
    elModeReveal = document.getElementById('btnModeReveal');
    elRefresh = document.getElementById('btnPresentRefresh');
    elFull = document.getElementById('btnPresentFull');

    token = decodeToken();

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
      this.blur();
      load();
    });
    elFull.addEventListener('click', function() {
      this.blur();
      toggleFull();
    });

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) return;
      if (invalid) return;
      if (mode !== 'board') return;
      // 直近取得から5秒未満なら floor（可視化のたびに叩き過ぎない）
      if (lastFetchedAt && (new Date() - lastFetchedAt) < 5000) return;
      load();
    });

    window.addEventListener('hashchange', function() {
      stopTimer();
      tokenSeq++;
      invalid = false;
      rendered = false;
      lastUpdatedAt = null;
      lastFetchedAt = null;
      busy = false;
      pendingRefresh = false;
      data = null;
      picking = true;
      order = [];
      step = 0;
      catIndex = 0;
      mode = 'board';
      if (elModeBoard) elModeBoard.classList.add('on');
      if (elModeReveal) elModeReveal.classList.remove('on');
      token = decodeToken();
      start();
    });

    start();
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('presentRoot')) init();
  });

  return {
    revealOrder: revealOrder
  };
})();
