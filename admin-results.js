// 結果タブ：サーバーの順位（computeRanking）を描き、発表・共有の入口を置く
var AdminResults = (function() {

  var CATEGORIES = [
    { key: 'male',    title: '一般男子' },
    { key: 'newFace', title: '新人' },
    { key: 'female',  title: '一般女子' }
  ];

  async function render(container, ctx) {
    container.innerHTML = '';
    if (!ctx || !ctx.eventId) {
      var msg = document.createElement('p');
      msg.className = 'results-empty';
      msg.textContent = '大会を選んでください。';
      container.appendChild(msg);
      return;
    }
    var eventId = ctx.eventId;

    var bar = document.createElement('div');
    bar.className = 'results-bar';
    bar.appendChild(makeBtn('btnResultsReload', '最新に更新', onReload));
    bar.appendChild(makeBtn('btnResultsPresent', '発表モードで開く', onPresent));
    bar.appendChild(makeBtn('btnResultsCopy', '共有リンクをコピー', onCopy));
    container.appendChild(bar);

    var body = document.createElement('div');
    body.className = 'results-body';
    body.id = 'resultsBody';
    body.textContent = '読み込み中…';
    container.appendChild(body);

    var data = await Api.loadRanking(eventId);
    if (ctx.isStale()) return;  // 通信中に大会やタブを切り替えられた
    if (!data) {
      body.textContent = '順位を取得できませんでした。「最新に更新」でやり直してください。';
      return;
    }
    body.innerHTML = '';
    CATEGORIES.forEach(function(c) {
      body.appendChild(buildSection(c.title, (data.rankings && data.rankings[c.key]) || []));
    });
  }

  function makeBtn(id, label, handler) {
    var b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }

  function buildSection(title, rows) {
    var sec = document.createElement('section');
    sec.className = 'results-section';
    var h3 = document.createElement('h3');
    h3.textContent = title;
    sec.appendChild(h3);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'results-empty';
      none.textContent = 'データなし';
      sec.appendChild(none);
      return sec;
    }
    var ul = document.createElement('ul');
    ul.className = 'results-list';
    rows.forEach(function(r) {
      var li = document.createElement('li');
      var rank = document.createElement('span');
      rank.className = 'results-rank';
      rank.textContent = String(r.rank);
      var name = document.createElement('span');
      name.className = 'results-name';
      name.textContent = r.name;
      var score = document.createElement('span');
      score.className = 'results-score';
      score.textContent = String(r.score);
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(score);
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    return sec;
  }

  function onReload() {
    Admin.reloadEvent();
  }

  // トークンは冪等に発行される（既にあれば同じものが返る）
  async function shareToken(eventId) {
    var link = await Api.createShareLink(eventId);
    if (!link || !link.token) {
      alert('共有リンクを作成できませんでした。通信を確認してください。');
      return null;
    }
    return link.token;
  }

  async function onPresent() {
    var eventId = Admin.currentEventId();
    if (!eventId) {
      alert('大会を選んでください。');
      return;
    }
    // ポップアップブロッカーは「クリックイベント処理中の同期的な window.open」しか
    // 許可しないブラウザが多い。await をまたいでから開こうとするとブロックされる
    // ことがあるので、まず空タブを同期的に開いておき、トークン取得後に location を差し替える。
    var w = window.open('', '_blank');
    var token = await shareToken(eventId);
    if (!token) {
      if (w) w.close();
      return;
    }
    var url = 'present.html#' + token;
    if (!w) {
      alert('新しいタブを開けませんでした。次のURLを開いてください。\n' +
            location.origin + '/' + url);
      return;
    }
    w.location = url;
  }

  async function onCopy() {
    var eventId = Admin.currentEventId();
    if (!eventId) {
      alert('大会を選んでください。');
      return;
    }
    var token = await shareToken(eventId);
    if (!token) return;
    var url = location.origin + '/share.html#' + token;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        Admin.toast('リンクをコピーしました');
        return;
      } catch (e) {
        // 権限が無い・HTTPS でない等。下の prompt に落とす
      }
    }
    window.prompt('このURLをコピーしてください', url);
  }

  Admin.registerTab('results', { render: render });

  return { render: render };
})();
