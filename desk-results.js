// 結果の区画（#results/<id>）。順位・発表モード・共有リンク・配信ボード。
// スマホ運営の結果タブ（admin-results.js）と同じ内容を PC 幅で3列に並べる。
// 順位はサーバーが計算したもの（GET /api/events/:id/ranking）をそのまま描く。
// 共有トークンは Api.createShareLink（冪等。既にあれば同じものが返る）。
(function() {
  var CATEGORIES = [
    { key: 'male',    title: '一般男子' },
    { key: 'newFace', title: '新人' },
    { key: 'female',  title: '一般女子' }
  ];

  async function render(container, ctx) {
    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '結果';
    head.appendChild(h2);
    container.appendChild(head);

    var bar = document.createElement('div');
    bar.className = 'desk-results-bar';
    bar.appendChild(makeBtn('btnDeskResultsReload', '↻ 最新に更新', 'desk-btn', function() {
      Desk.reloadEvent();
    }));
    bar.appendChild(makeBtn('btnDeskResultsPresent', '🖵 発表モードで開く', 'desk-btn primary', function() {
      onPresent(this, ctx);
    }));
    bar.appendChild(makeBtn('btnDeskResultsShare', '🔗 共有リンクをコピー', 'desk-btn', function() {
      onCopyShare(this, ctx);
    }));
    container.appendChild(bar);

    var cols = document.createElement('div');
    cols.className = 'desk-results-cols';
    cols.id = 'deskResultsCols';
    container.appendChild(cols);

    var loading = document.createElement('p');
    loading.className = 'desk-empty';
    loading.textContent = '読み込み中…';
    cols.appendChild(loading);

    container.appendChild(buildBoardSection(ctx));

    var data = await Api.loadRanking(ctx.eventId);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    cols.innerHTML = '';
    if (!data) {
      var err = document.createElement('p');
      err.className = 'desk-empty';
      err.textContent = '順位を取得できませんでした。「↻ 最新に更新」でやり直してください。';
      cols.appendChild(err);
      return;
    }
    CATEGORIES.forEach(function(c) {
      cols.appendChild(buildColumn(c.title, (data.rankings && data.rankings[c.key]) || []));
    });
  }

  function makeBtn(id, label, cls, handler) {
    var b = document.createElement('button');
    b.type = 'button';
    if (id) b.id = id;
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }

  function buildColumn(title, rows) {
    var col = document.createElement('section');
    col.className = 'desk-results-col';
    var h3 = document.createElement('h3');
    h3.textContent = title;
    col.appendChild(h3);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'データなし';
      col.appendChild(none);
      return col;
    }
    var ul = document.createElement('ul');
    ul.className = 'desk-results-list';
    rows.forEach(function(r) {
      var li = document.createElement('li');
      var rank = document.createElement('span');
      rank.className = 'desk-results-rank';
      rank.textContent = String(r.rank);
      var name = document.createElement('span');
      name.className = 'desk-results-name';
      name.textContent = r.name;
      var score = document.createElement('span');
      score.className = 'desk-results-score';
      score.textContent = String(r.score);
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(score);
      ul.appendChild(li);
    });
    col.appendChild(ul);
    return col;
  }

  // --- 配信ボード ---
  // board.html はハッシュを #<トークン>/<コート> として読み、コートが無いと
  // 「コートが指定されていません」で止まる（board.js の parseHash と start）。
  // だから設計書の「board.html#<token>」ではなく、コートごとの URL を作る。
  function buildBoardSection(ctx) {
    var sec = document.createElement('div');
    sec.className = 'desk-results-board';

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '配信用ボード';
    head.appendChild(h2);
    sec.appendChild(head);

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'コートごとに1つ、OBS の「ブラウザ」ソースに貼る URL です。' +
      '映像に重ねるときは board.html のすぐ後ろに ?bg=transparent を足すと背景が透けます。';
    sec.appendChild(note);

    var courts = Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    if (courts.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'コートがまだありません（選手を登録するとコートが決まります）。';
      sec.appendChild(none);
      return sec;
    }

    var list = document.createElement('div');
    list.className = 'desk-results-boardlist';
    courts.forEach(function(c) {
      list.appendChild(makeBtn('', '📺 ' + c + ' コートの URL をコピー', 'desk-btn', function() {
        onCopyBoard(this, ctx, c);
      }));
    });
    sec.appendChild(list);
    return sec;
  }

  // --- 共有トークン ---
  // 冪等に発行される（大会に shareToken があればそれがそのまま返る）。
  async function shareToken(ctx) {
    var link = await Api.createShareLink(ctx.eventId);
    if (ctx.isStale()) return null;   // 画面を離れていたら alert も出さない
    if (!link || !link.token) {
      alert('共有リンクを作成できませんでした。通信を確認してください。');
      return null;
    }
    return link.token;
  }

  async function onPresent(btn, ctx) {
    btn.disabled = true;
    // ポップアップブロッカーは「クリックイベント処理中の同期的な window.open」しか
    // 許可しないブラウザが多い。await をまたいでから開くとブロックされることがあるので、
    // まず空タブを同期的に開いておき、トークン取得後に location を差し替える
    // （admin-results.js と同じ作法）。
    var w = window.open('', '_blank');
    try {
      var token = await shareToken(ctx);
      if (!token) {
        if (w) w.close();
        return;
      }
      var url = new URL('present.html#' + token, location.href).href;
      if (!w) {
        alert('新しいタブを開けませんでした。次のURLを開いてください。\n' + url);
        return;
      }
      w.location = url;
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }

  async function onCopyShare(btn, ctx) {
    btn.disabled = true;
    try {
      var token = await shareToken(ctx);
      if (!token) return;
      await Desk.copyText(new URL('share.html#' + token, location.href).href,
        '共有リンクをコピーしました');
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }

  async function onCopyBoard(btn, ctx, court) {
    btn.disabled = true;
    try {
      var token = await shareToken(ctx);
      if (!token) return;
      var url = new URL('board.html#' + token + '/' + encodeURIComponent(court), location.href).href;
      await Desk.copyText(url, court + ' コートの配信用ボードの URL をコピーしました');
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }

  Desk.registerTab('results', { render: render });
})();
