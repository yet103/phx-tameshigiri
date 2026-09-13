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
  var lastAttemptAt = null;
  var timerId = null;
  var busy = false;
  var pendingRefresh = false;
  var rendered = false;
  var invalid = false;
  var tokenSeq = 0;

  var elHead = null;
  var elStatus = null;
  var elBody = null;

  // 参加者に見せるページなので、端末の設定に関わらずポスターと同じ黒金（dark）で固定する。
  // 採点・運営の端末が控えている tmg_theme も見ない（別の人の端末で開くページのため）。
  function applyTheme() {
    document.body.setAttribute('data-theme', 'dark');
  }

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
    timerId = setInterval(function() { refresh(); }, REFRESH_MS);
  }

  function decodeToken() {
    var hash = location.hash.replace(/^#/, '');
    try {
      return decodeURIComponent(hash);
    } catch (e) {
      return hash;
    }
  }

  function showInvalid() {
    // 404/400 はトークンが無効と確定しているので、ポーリングを止めて叩き続けない。
    invalid = true;
    rendered = false;
    lastUpdatedAt = null;
    stopTimer();
    if (elHead) elHead.textContent = '';
    if (elStatus) elStatus.textContent = '';
    document.title = '順位';
    if (elBody) {
      elBody.textContent = '';
      var div = document.createElement('div');
      div.className = 'share-error';
      div.textContent = 'このリンクは無効です';
      elBody.appendChild(div);
    }
  }

  function showFetchError() {
    // まだ一度も描画できていない状態での通信失敗。前回表示がないので専用メッセージを出す。
    if (elHead) elHead.textContent = '';
    if (elStatus) {
      elStatus.className = 'share-status';
      elStatus.textContent = '取得できませんでした';
    }
    document.title = '順位';
    if (elBody) {
      elBody.textContent = '';
      var div = document.createElement('div');
      div.className = 'share-error';
      div.textContent = '順位を取得できませんでした。通信を確認してください。';
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

  // Api.fetchSharedRanking の結果で状態を進める。busy 中に来た呼び出しは捨てず
  // pendingRefresh に立てておき、進行中の取得が終わった時点でもう一度だけ実行する。
  async function refresh() {
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
      var isFirstSuccess = !rendered;
      invalid = false;
      if (!timerId) startTimer();
      lastFetchedAt = new Date();
      if (elStatus) {
        elStatus.className = 'share-status';
        elStatus.textContent = hhmm(lastFetchedAt) + ' 時点';
      }

      var updatedAt = result.data.event ? result.data.event.updatedAt : null;
      if (!rendered || updatedAt !== lastUpdatedAt) {
        lastUpdatedAt = updatedAt;
        rendered = true;
        renderHead(result.data.event || {});
        renderBody(result.data.rankings || {});
      }

      if (isFirstSuccess && result.data.event && result.data.event.name) {
        document.title = result.data.event.name + ' の順位';
      }
    } else if (result.status === 400 || result.status === 404) {
      showInvalid();
    } else if (!rendered) {
      showFetchError();
    } else if (elStatus) {
      elStatus.className = 'share-status warn';
      elStatus.textContent = '更新できませんでした（前回 ' + hhmm(lastFetchedAt) + ' 時点）';
    }

    if (pendingRefresh) {
      pendingRefresh = false;
      refresh();
    }
  }

  function start() {
    if (!token) {
      showInvalid();
      return;
    }
    startTimer();
    refresh();
  }

  function init() {
    applyTheme();

    elHead = document.getElementById('shareHead');
    elStatus = document.getElementById('shareStatus');
    elBody = document.getElementById('shareBody');

    token = decodeToken();
    start();

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) return;
      if (invalid) return;
      // 直近の取得試行から5秒未満なら floor（可視化のたびに叩き過ぎない）
      if (lastAttemptAt && (new Date() - lastAttemptAt) < 5000) return;
      refresh();
    });

    window.addEventListener('hashchange', function() {
      stopTimer();
      tokenSeq++;
      invalid = false;
      rendered = false;
      lastUpdatedAt = null;
      lastFetchedAt = null;
      lastAttemptAt = null;
      busy = false;
      pendingRefresh = false;
      token = decodeToken();
      start();
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('shareRoot')) init();
  });

  return {
    refresh: refresh
  };
})();
