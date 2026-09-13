// board.html 専用のスクリプト（YouTube 配信＝OBS のブラウザソースに映す閲覧専用ページ）。
// - 操作 UI は持たない。クリックしても何も起きない。
// - URL は board.html#<トークン>/<コート>。?bg=transparent で背景を透過にする。
// - 2秒ごとに GET /api/links/:token/live を読む。遅れて届いた応答は seq で捨てる。
// - storage.js は読み込まない：無認証で開くページなので、theme は dark 固定にする
//   （share.js と同じ方針）。
var Board = (function() {
  var REFRESH_MS = 2000;
  var TICK_MS = 500;
  // 連続でこの回数しくじったら右下に「更新できません」を出す。
  // 1回の取りこぼしで注意書きが点滅すると配信で目障りなので 2 回から。
  var NOTICE_AFTER = 2;

  var token = '';
  var court = '';
  var pollSeq = 0;
  var pollTimer = null;
  var tickTimer = null;
  var failCount = 0;
  var invalid = false;
  var live = null;        // 直近に描いたコートの状態 { updatedAt, timer, player }
  // サーバーとこの端末の時計のずれ（サーバー - 端末）。
  // タイマーは「サーバーの現在時刻 - updatedAt」で進めるので、
  // 端末の時計が狂っていても配信の残り時間がずれないようにする。
  var skewMs = 0;

  var el = {};

  // --- 純粋関数（test.html から検証する。DOM には触らない） ---

  // 画面に出す残り秒数。running なら updatedAt からの経過を引き、0 で止める。
  // running でなければ sec をそのまま返す。時刻が読めないときも sec のまま。
  function remaining(timer, updatedAt, now) {
    var sec = timer ? Math.trunc(Number(timer.sec)) : 0;
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    if (!timer || timer.running !== true) return sec;
    var from = Date.parse(updatedAt);
    var to = Date.parse(now);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return sec;
    var elapsed = Math.floor((to - from) / 1000);
    if (elapsed < 0) elapsed = 0;   // 時計のずれで未来から来た場合は経過0とみなす
    var left = sec - elapsed;
    return left > 0 ? left : 0;
  }

  // 採点表の行。技①②③から空の枠を除き、result と adjust を行に添える。
  // 添字は Scoring.decodeResult と同じく「空の枠を詰めた表示行」の順。
  // 戻り値: [{ techName, values: ['○'|'×'|''] ×4, adjust: 整数 }]
  function rowsFor(player) {
    var p = player || {};
    var names = [p.tech1, p.tech2, p.tech3].filter(Boolean);
    var decoded = Scoring.decodeResult(String(p.result || ''), names.length, p.adjust);
    return names.map(function(name, i) {
      return { techName: name, values: decoded[i].values, adjust: decoded[i].adjust };
    });
  }

  // URL のハッシュ（#<トークン>/<コート>）を分解する。
  // コートは「-」を含まないので、最初の「/」だけで切れば足りる。
  function parseHash(hash) {
    var h = String(hash || '');
    if (h.charAt(0) === '#') h = h.slice(1);
    try { h = decodeURIComponent(h); } catch (e) { /* 壊れた％表記はそのまま扱う */ }
    var slash = h.indexOf('/');
    if (slash === -1) return { token: h, court: '' };
    return { token: h.slice(0, slash), court: h.slice(slash + 1) };
  }

  // --- 描画 ---

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function mmss(sec) {
    return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
  }

  // サーバー時計に合わせた「今」
  function serverNow() {
    return new Date(Date.now() + skewMs).toISOString();
  }

  function setNotice(text) {
    el.notice.textContent = text || '';
  }

  function renderTimer() {
    if (!live || !live.timer) {
      el.timer.textContent = '--:--';
      return;
    }
    var sec = remaining(live.timer, live.updatedAt, serverNow());
    el.timer.textContent = mmss(sec);
    el.timer.classList.toggle('is-zero', sec === 0);
  }

  // 太刀セル1つ分。打てない太刀（配点 null）はグレーにする。
  function strikeCell(techName, index, value, isFemale) {
    var td = document.createElement('td');
    var tech = Scoring.findTechnique(techName, isFemale);
    if (tech && tech.strikes[index] === null) {
      td.className = 'na';
      td.textContent = '—';
      return td;
    }
    if (value === '○') {
      td.className = 'success';
      td.textContent = '成功';
    } else if (value === '×') {
      td.className = 'fail';
      td.textContent = '失敗';
    } else {
      td.className = 'none';
      td.textContent = '未';
    }
    return td;
  }

  var CIRCLED = ['①', '②', '③'];

  function renderRows(player) {
    el.body.textContent = '';
    var rows = rowsFor(player);
    rows.forEach(function(row, i) {
      var tr = document.createElement('tr');

      var tech = document.createElement('td');
      tech.className = 'tech';
      var no = document.createElement('span');
      no.className = 'no';
      no.textContent = CIRCLED[i] || '';
      tech.appendChild(no);
      tech.appendChild(document.createTextNode(row.techName));
      tr.appendChild(tech);

      for (var s = 0; s < 4; s++) {
        tr.appendChild(strikeCell(row.techName, s, row.values[s], player.isFemale === true));
      }

      var adjust = document.createElement('td');
      adjust.className = 'num';
      adjust.textContent = row.adjust === 0 ? '' : String(row.adjust);
      tr.appendChild(adjust);

      var score = document.createElement('td');
      score.className = 'num score';
      score.textContent = Scoring.calcRowScore(row.techName, row.values, row.adjust, player.isFemale === true);
      tr.appendChild(score);

      el.body.appendChild(tr);
    });
  }

  // 順番（A-男子-1-3）を「男子 1巡目 3番」にする。読めない形はそのまま出す。
  function orderLabel(order) {
    var m = String(order || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    return m ? m[2] + ' ' + m[3] + '巡目 ' + m[4] + '番' : String(order || '');
  }

  // 待機中（このコートのライブ状態が無い・選手が未設定）
  function renderIdle(eventName) {
    live = null;
    el.root.classList.add('is-idle');
    el.court.textContent = court;
    el.event.textContent = eventName || '';
    el.order.textContent = '';
    el.name.textContent = '待機中';
    el.timer.textContent = '--:--';
  }

  function render(data) {
    var entry = data.courts && Object.prototype.hasOwnProperty.call(data.courts, court)
      ? data.courts[court] : null;
    if (!entry || !entry.player) {
      renderIdle(data.eventName);
      return;
    }
    var p = entry.player;
    live = entry;
    el.root.classList.remove('is-idle');
    el.court.textContent = court;
    el.event.textContent = data.eventName || '';
    el.order.textContent = orderLabel(p.order);
    el.name.textContent = p.name || '';

    renderRows(p);
    renderTimer();

    var confirmed = p.confirmed === true;
    document.querySelector('.board-table').classList.toggle('confirmed', confirmed);
    el.total.classList.toggle('confirmed', confirmed);
    el.total.textContent = '合計 ' + p.score + ' 点';
    el.confirmed.classList.toggle('is-hidden', !confirmed);
  }

  // --- 取得 ---

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function showInvalid() {
    // 400/404 はトークンが無効と確定しているので、叩き続けない。
    invalid = true;
    stopPolling();
    renderIdle('');
    el.name.textContent = 'このリンクは無効です';
    setNotice('');
  }

  async function poll() {
    var mySeq = ++pollSeq;
    var result = await Api.loadLive(token);
    if (mySeq !== pollSeq) return;   // 追い越された。古い応答は捨てる
    if (result.ok) {
      failCount = 0;
      setNotice('');
      skewMs = Date.parse(result.data.now) - Date.now();
      if (!Number.isFinite(skewMs)) skewMs = 0;
      // 行の得点と「打てない太刀」の判定は配点表が要る。応答に毎回入っているので、
      // 描く前に Scoring へ入れる（運営が配点を変えても次の取得で追いつく）。
      if (Array.isArray(result.data.techniques)) Scoring.setTechniques(result.data.techniques);
      render(result.data);
      return;
    }
    if (result.status === 400 || result.status === 404) {
      showInvalid();
      return;
    }
    // 通信・サーバーの失敗。今の表示はそのまま残す（配信から採点表が消えないように）。
    failCount++;
    if (failCount >= NOTICE_AFTER) setNotice('更新できません');
  }

  function start() {
    invalid = false;
    failCount = 0;
    live = null;
    setNotice('');
    if (!token) {
      renderIdle('');
      el.name.textContent = 'リンクが指定されていません';
      return;
    }
    if (!court) {
      renderIdle('');
      el.name.textContent = 'コートが指定されていません';
      return;
    }
    poll();
    stopPolling();
    pollTimer = setInterval(poll, REFRESH_MS);
  }

  function init() {
    document.body.setAttribute('data-theme', 'dark');
    if (/(^|[?&])bg=transparent($|&)/.test(location.search)) {
      document.body.classList.add('is-transparent');
    }

    el = {
      root: document.getElementById('boardRoot'),
      court: document.getElementById('boardCourt'),
      event: document.getElementById('boardEvent'),
      order: document.getElementById('boardOrder'),
      name: document.getElementById('boardName'),
      timer: document.getElementById('boardTimer'),
      body: document.getElementById('boardBody'),
      total: document.getElementById('boardTotal'),
      confirmed: document.getElementById('boardConfirmed'),
      notice: document.getElementById('boardNotice')
    };

    // 応答が届く前に findTechnique が呼ばれても落ちないように空で初期化する
    // （board.html は data.js を読まないので、既定の TECHNIQUES を持たない）。
    Scoring.setTechniques([]);

    var parsed = parseHash(location.hash);
    token = parsed.token;
    court = parsed.court;
    start();

    // 秒の表示はサーバーを待たずにこちらで進める（2秒ごとの取得の間も動かすため）。
    tickTimer = setInterval(function() {
      if (live) renderTimer();
    }, TICK_MS);

    window.addEventListener('hashchange', function() {
      stopPolling();
      pollSeq++;   // 切替前に投げた応答は捨てる
      var next = parseHash(location.hash);
      token = next.token;
      court = next.court;
      start();
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('boardRoot')) init();
  });

  return {
    remaining: remaining,
    rowsFor: rowsFor,
    parseHash: parseHash
  };
})();
