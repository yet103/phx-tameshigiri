// present.html 専用のスクリプト（大画面用・発表モード）。
// - 掲示モード（board）: 60秒ごとに自動更新しながら3部門を順に表示する。
// - 発表モード（reveal）: 部門を選んで、下位から1人ずつタップで順位を開けていく。
// - ベスト4 モード（best4）: 合計の一般男子上位 4 名（ranking API の best4）を 4 位 → 1 位の順に
//   タップで出すカウントダウン（設計書 2026-10-04-finale-after-round2 4 章）。
var Present = (function() {
  var REFRESH_MS = 60000;

  var CATEGORIES = [
    { key: 'male', title: '一般男子' },
    { key: 'newFace', title: '新人枠' },
    { key: 'female', title: '一般女子' }
  ];

  var token = '';
  var mode = 'board';
  var catIndex = 0;
  var data = null;
  var lastFetchedAt = null;
  var lastAttemptAt = null;
  var lastUpdatedAt = null;
  var rendered = false;
  var invalid = false;
  var fetchError = false;
  var busy = false;
  var pendingRefresh = false;
  var tokenSeq = 0;
  var timerId = null;

  // 発表（reveal）モードの状態。
  var picking = true;
  var order = [];
  var step = 0;

  // ベスト4（best4）モードで出し終えた組（同順位の人の組）の数。
  var best4Step = 0;

  var elScreen = null;
  var elHint = null;
  var elStatus = null;
  var elModeBoard = null;
  var elModeReveal = null;
  var elModeBest4 = null;
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
      if (mode === 'board' || mode === 'best4') load();
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

  function setInvalid() {
    // 404/400 はトークンが無効と確定しているので、ポーリングを止めて叩き続けない。
    invalid = true;
    rendered = false;
    lastUpdatedAt = null;
    stopTimer();
    if (elStatus) elStatus.textContent = '';
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

  // ベスト4 の行（サーバーが計算した合計の上位。順位の昇順＝1 位が先頭）。無ければ空。
  function best4Rows(d) {
    if (!d || !d.best4 || !Array.isArray(d.best4.rows)) return [];
    return d.best4.rows;
  }

  // ベスト4 を出す順。同じ順位の人は 1 つの組にまとめて同時に出し、下位の組から 1 組ずつ
  // （4 位 → 3 位 → 2 位 → 1 位）。組の中は一覧の並び（同点は氏名順）のまま。
  // 戻り値は rows への添字の配列の配列。
  function best4Groups(rows) {
    var groups = [];
    var list = rows || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var r = list[i];
      var last = groups.length > 0 ? groups[groups.length - 1] : null;
      if (last && list[last[0]] && r && list[last[0]].rank === r.rank) last.unshift(i);
      else groups.push([i]);
    }
    return groups;
  }

  // 最初に開くモード。常に「掲示」（ベスト4 の発表は運営者がボタンを押して始める。
  // 設計書 2026-10-04-finale-after-round2 4 章。状態を見て自動で切り替えることはしない）。
  function defaultMode() {
    return 'board';
  }

  // Api.fetchSharedRanking の結果で状態を進める。busy 中に来た呼び出しは捨てず
  // pendingRefresh に立てておき、進行中の取得が終わった時点でもう一度だけ実行する。
  async function load() {
    if (busy) {
      pendingRefresh = true;
      return;
    }
    busy = true;
    lastAttemptAt = new Date();
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
      fetchError = false;
      if (!timerId) startTimer();
      data = result.data;
      lastFetchedAt = new Date();
      if (elStatus) elStatus.textContent = hhmm(lastFetchedAt) + ' 時点';

      // 発表中に人数が変わっても添字がずれないように order を取り直す
      if (mode === 'reveal' && !picking) {
        order = revealOrder(rowsOf(catIndex));
        if (step > order.length) step = order.length;
      }
      // ベスト4 の人数（組の数）が変わったら、出し終えた組の数を切り詰める
      var nGroups = best4Groups(best4Rows(data)).length;
      if (best4Step > nGroups) best4Step = nGroups;

      var updatedAt = data.event ? data.event.updatedAt : null;
      if (!rendered || updatedAt !== lastUpdatedAt) {
        lastUpdatedAt = updatedAt;
        rendered = true;
        render();
      }
    } else if (result.status === 400 || result.status === 404) {
      setInvalid();
    } else if (!rendered) {
      fetchError = true;
      if (elStatus) elStatus.textContent = '取得できませんでした';
      render();
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

    if (fetchError) {
      var fetchErr = document.createElement('div');
      fetchErr.className = 'present-error';
      fetchErr.textContent = '順位を取得できませんでした。通信を確認してください。';
      elScreen.appendChild(fetchErr);
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
    } else if (mode === 'best4') {
      renderBest4();
    } else {
      renderBoard();
    }
  }

  // ベスト4 の発表。確定後は「ベスト4 発表」、確定前は「暫定ベスト4」に残り人数を小さく添える
  // （確定前でもリハーサル・途中経過の発表に使える）。出し終えた組は上に積み（1 位が一番上）、
  // 最新の組を強調する。
  function renderBest4() {
    var b4 = (data && data.best4) || null;
    var isFinal = !!(b4 && b4.final);
    var rows = best4Rows(data);
    var groups = best4Groups(rows);
    if (best4Step > groups.length) best4Step = groups.length;

    var h1 = document.createElement('h1');
    h1.className = 'present-title';
    h1.textContent = isFinal ? 'ベスト4 発表' : '暫定ベスト4';
    if (!isFinal && b4) {
      var rest = document.createElement('span');
      rest.className = 'present-page';
      rest.textContent = '残り ' + (Number(b4.remaining) || 0) + ' 名';
      h1.appendChild(rest);
    }
    elScreen.appendChild(h1);

    if (rows.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'present-error';
      empty.textContent = 'ベスト4 はまだありません';
      elScreen.appendChild(empty);
      if (elHint) elHint.textContent = '';
      return;
    }

    var firstRank = rows[groups[0][0]].rank;
    if (best4Step === 0) {
      var ready = document.createElement('div');
      ready.className = 'present-error present-best4-ready';
      ready.textContent = 'タップで ' + firstRank + '位から発表します';
      elScreen.appendChild(ready);
    } else {
      // 出し終えた組を、順位の昇順（1 位が上）に並べる。後から出た組ほど上に積まれる
      var ul = document.createElement('ul');
      ul.className = 'present-list present-best4';
      for (var g = best4Step - 1; g >= 0; g--) {
        var latest = (g === best4Step - 1);
        groups[g].forEach(function(idx) {
          ul.appendChild(buildBest4Item(rows[idx], latest));
        });
      }
      elScreen.appendChild(ul);
    }

    if (elHint) {
      elHint.textContent = '';
      var strong = document.createElement('strong');
      if (best4Step < groups.length) {
        var nextRank = rows[groups[best4Step][0]].rank;
        strong.textContent = best4Step === 0
          ? 'タップ／→ で ' + nextRank + '位から発表'
          : 'タップで ' + nextRank + '位 を発表';
        elHint.appendChild(strong);
        if (best4Step > 0) elHint.appendChild(document.createTextNode('　←で 1 つ戻す'));
      } else {
        strong.textContent = isFinal ? '以上がベスト4 です' : '以上が暫定ベスト4 です';
        elHint.appendChild(strong);
        elHint.appendChild(document.createTextNode('　←で 1 つ戻す'));
      }
    }
  }

  // ベスト4 の 1 人。順位（大きく）・名前・一巡目と二巡目（小さく）・合計（大きく）。
  function buildBest4Item(r, latest) {
    var li = document.createElement('li');
    var cls = [];
    if (r.rank <= 3) cls.push('top');
    if (latest) cls.push('latest');
    if (cls.length) li.className = cls.join(' ');

    var rankEl = document.createElement('span');
    rankEl.className = 'present-rank';
    rankEl.textContent = String(r.rank);
    li.appendChild(rankEl);

    var nameBox = document.createElement('span');
    nameBox.className = 'present-name';
    var nameEl = document.createElement('span');
    nameEl.className = 'present-best4-name';
    nameEl.textContent = r.name;
    nameBox.appendChild(nameEl);
    var detail = document.createElement('span');
    detail.className = 'present-best4-detail';
    detail.textContent = '一巡目 ' + (r.r1 == null ? '—' : r.r1) +
      '　二巡目 ' + (r.r2 == null ? '—' : r.r2);
    nameBox.appendChild(detail);
    li.appendChild(nameBox);

    var scoreEl = document.createElement('span');
    scoreEl.className = 'present-score';
    scoreEl.textContent = String(r.total);
    li.appendChild(scoreEl);
    return li;
  }

  function best4Next() {
    var n = best4Groups(best4Rows(data)).length;
    if (best4Step < n) {
      best4Step++;
      render();
    }
  }

  function best4Prev() {
    if (best4Step > 0) {
      best4Step--;
      render();
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
    // ベスト4 モードはカテゴリを持たない単一の画面なので、送りは次の組を出すだけ
    // （レビュー指摘G。catIndex を進めると、掲示モードに戻ったときに表示するカテゴリがずれる）。
    if (mode === 'best4') {
      best4Next();
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
    if (mode === 'best4') {
      best4Prev();
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
    if (m === 'best4') best4Step = 0;
    if (elModeBoard) {
      if (m === 'board') elModeBoard.classList.add('on');
      else elModeBoard.classList.remove('on');
    }
    if (elModeReveal) {
      if (m === 'reveal') elModeReveal.classList.add('on');
      else elModeReveal.classList.remove('on');
    }
    if (elModeBest4) {
      if (m === 'best4') elModeBest4.classList.add('on');
      else elModeBest4.classList.remove('on');
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
    // ボタンの id（btnModeFinale）は旧モードの名残のまま。中身はベスト4
    elModeBest4 = document.getElementById('btnModeFinale');
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
    if (elModeBest4) {
      elModeBest4.addEventListener('click', function() {
        this.blur();
        setMode('best4');
      });
    }
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
      if (mode !== 'board' && mode !== 'best4') return;
      // 直近の取得試行から5秒未満なら floor（可視化のたびに叩き過ぎない）
      if (lastAttemptAt && (new Date() - lastAttemptAt) < 5000) return;
      load();
    });

    window.addEventListener('hashchange', function() {
      stopTimer();
      tokenSeq++;
      invalid = false;
      fetchError = false;
      rendered = false;
      lastUpdatedAt = null;
      lastFetchedAt = null;
      lastAttemptAt = null;
      busy = false;
      pendingRefresh = false;
      data = null;
      picking = true;
      order = [];
      step = 0;
      best4Step = 0;
      catIndex = 0;
      mode = defaultMode();
      if (elModeBoard) elModeBoard.classList.add('on');
      if (elModeReveal) elModeReveal.classList.remove('on');
      if (elModeBest4) elModeBest4.classList.remove('on');
      token = decodeToken();
      start();
    });

    start();
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('presentRoot')) init();
  });

  return {
    revealOrder: revealOrder,
    best4Rows: best4Rows,
    best4Groups: best4Groups,
    defaultMode: defaultMode
  };
})();
