// share.html 専用のスクリプト。
// - storage.js は読み込まない：認証を通さない静的ファイル群（api.js / share.* / theme.css）に
//   含めないため、テーマは localStorage の 'tmg_theme' を直接読む。
// - 60 秒ごとにサーバーへポーリングし、rankings.event.updatedAt が変化した時だけ
//   見出し・順位表を再描画する（無変化ならスクロール位置や DOM をそのまま保つ）。
var Share = (function() {
  var REFRESH_MS = 60000;

  var CATEGORIES = [
    { key: 'male', title: '一般男子' },
    { key: 'newFace', title: '新人' },
    { key: 'female', title: '一般女子' }
  ];

  var token = '';
  var lastUpdatedAt = null;
  var lastFetchedAt = null;
  var timerId = null;
  var busy = false;
  var rendered = false;
  var invalid = false;

  var elHead = null;
  var elStatus = null;
  var elBody = null;

  function applyTheme() {
    var t = null;
    try { t = localStorage.getItem('tmg_theme'); } catch (e) { t = null; }
    if (!t) {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        t = 'dark';
      } else {
        t = 'light';
      }
    }
    document.body.setAttribute('data-theme', t);
  }

  function hhmm(date) {
    var h = String(date.getHours());
    var m = String(date.getMinutes());
    if (h.length < 2) h = '0' + h;
    if (m.length < 2) m = '0' + m;
    return h + ':' + m;
  }

  function showInvalid() {
    // タイマーは止めない：トークンが後で有効になる（通信復旧）ケースのために
    // ポーリングを続け、次の成功で自動的に復帰できるようにする。
    invalid = true;
    if (elHead) elHead.textContent = '';
    if (elStatus) elStatus.textContent = '';
    if (elBody) {
      elBody.textContent = '';
      var div = document.createElement('div');
      div.className = 'share-error';
      div.textContent = 'このリンクは無効です';
      elBody.appendChild(div);
    }
  }

  function renderHead(ev) {
    elHead.textContent = '';
    var h1 = document.createElement('h1');
    h1.textContent = ev.name;
    elHead.appendChild(h1);

    var meta = document.createElement('div');
    meta.className = 'share-meta';
    var metaText = ev.date || '';
    if (ev.venue) metaText += '　' + ev.venue;
    meta.textContent = metaText;
    elHead.appendChild(meta);
  }

  function renderBody(rankings) {
    elBody.textContent = '';
    for (var i = 0; i < CATEGORIES.length; i++) {
      var cat = CATEGORIES[i];
      var list = (rankings && rankings[cat.key]) || [];

      var section = document.createElement('section');
      section.className = 'share-section';

      var h2 = document.createElement('h2');
      h2.textContent = cat.title;
      section.appendChild(h2);

      if (list.length === 0) {
        var empty = document.createElement('p');
        empty.className = 'share-empty';
        empty.textContent = 'データなし';
        section.appendChild(empty);
      } else {
        var ul = document.createElement('ul');
        ul.className = 'share-list';
        for (var j = 0; j < list.length; j++) {
          var row = list[j];
          var li = document.createElement('li');

          var rankEl = document.createElement('span');
          rankEl.className = 'share-rank';
          rankEl.textContent = row.rank;
          li.appendChild(rankEl);

          var nameEl = document.createElement('span');
          nameEl.className = 'share-name';
          nameEl.textContent = row.name;
          li.appendChild(nameEl);

          var scoreEl = document.createElement('span');
          scoreEl.className = 'share-score';
          scoreEl.textContent = row.score;
          li.appendChild(scoreEl);

          ul.appendChild(li);
        }
        section.appendChild(ul);
      }

      elBody.appendChild(section);
    }
  }

  // isFirst: true（初回） | false（通常の再取得） | 'retry'（初回失敗後の1回だけの再試行）
  async function refresh(isFirst) {
    if (busy) return;
    busy = true;
    try {
      var data = await Api.loadSharedRanking(token);

      if (!data) {
        if (isFirst === true) {
          // 初回読み込み失敗時は3秒後に一度だけ再試行してから無効表示にする
          setTimeout(function() { refresh('retry'); }, 3000);
        } else if (isFirst === 'retry') {
          showInvalid();
        } else if (lastFetchedAt) {
          elStatus.className = 'share-status warn';
          elStatus.textContent = '更新できませんでした（前回 ' + hhmm(lastFetchedAt) + ' 時点）';
        }
        return;
      }

      var isFirstSuccess = !rendered;
      invalid = false;
      lastFetchedAt = new Date();
      elStatus.className = 'share-status';
      elStatus.textContent = hhmm(lastFetchedAt) + ' 時点';

      var updatedAt = data.event ? data.event.updatedAt : null;
      if (!rendered || updatedAt !== lastUpdatedAt) {
        lastUpdatedAt = updatedAt;
        rendered = true;
        renderHead(data.event || {});
        renderBody(data.rankings || {});
      }

      if (isFirstSuccess && data.event && data.event.name) {
        document.title = data.event.name + ' の順位';
      }
    } finally {
      busy = false;
    }
  }

  function startToken(isFirst) {
    if (!token) {
      showInvalid();
      return;
    }
    refresh(isFirst);
  }

  function init() {
    applyTheme();

    elHead = document.getElementById('shareHead');
    elStatus = document.getElementById('shareStatus');
    elBody = document.getElementById('shareBody');

    token = location.hash.replace(/^#/, '');

    timerId = setInterval(function() { refresh(false); }, REFRESH_MS);
    startToken(true);

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) return;
      // 直近取得から5秒未満なら floor（可視化のたびに叩き過ぎない）
      if (lastFetchedAt && (new Date() - lastFetchedAt) < 5000) return;
      refresh(false);
    });

    window.addEventListener('hashchange', function() {
      token = location.hash.replace(/^#/, '');
      invalid = false;
      rendered = false;
      lastUpdatedAt = null;
      lastFetchedAt = null;
      startToken(true);
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('shareRoot')) init();
  });

  return {
    refresh: refresh
  };
})();
