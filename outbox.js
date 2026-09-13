// 採点の送信キュー
// 採点セルの操作は通信を待たずにキューへ積み、送信は独立したワーカーが担う。
// 同一選手のエントリは常に1件に畳む（result は毎回全文なので最新だけ送れば足りる）。
// キューは localStorage に退避し、端末が落ちても次回起動時に再送する。
var Outbox = (function() {
  var STORAGE_KEY = 'tmg_outbox';
  var BACKOFF_MIN = 1000;
  var BACKOFF_MAX = 30000;
  var TICK_MS = 1000;

  var queue = [];
  var sending = false;       // 送信処理が走っている最中か
  var backoffMs = BACKOFF_MIN;
  var failingSince = null;   // 最初に失敗した時刻（復旧したら null に戻す）
  var retryTimer = null;     // バックオフ待ちのタイマー
  var tickTimer = null;      // 状態通知用の毎秒タイマー
  var statusHandler = null;
  var discardHandler = null;
  var dropped = [];          // 恒久的に送れず捨てたエントリ

  // 同一の大会・選手のエントリを最新で置き換える。元の配列は変更しない。
  function coalesce(q, entry) {
    var next = (q || []).slice();
    for (var i = 0; i < next.length; i++) {
      if (next[i].eventId === entry.eventId && next[i].playerId === entry.playerId) {
        next[i] = entry;
        return next;
      }
    }
    next.push(entry);
    return next;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function save() {
    try {
      if (queue.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {}
  }

  function pendingCount() {
    return queue.length;
  }

  // 何度送っても通らない失敗か。
  // 4xx はリクエスト自体が受け付けられていないので再送しても同じ。
  // ただし 408（タイムアウト）と 429（レート制限）は時間を置けば通る。
  function isPermanentFailure(status) {
    if (status === 408 || status === 429) return false;
    return status >= 400 && status < 500;
  }

  // まだ送れていない採点を、サーバーから読み直した選手データに上書きする。
  // キューにある値のほうが新しいので、画面と再エンコードの基準はこちらにする。
  // これをしないと、サーバーの古い値で画面が巻き戻り、
  // 次の1タップがその古い DOM から再エンコードされて未送信分を消す。
  // 戻り値: 上書きした件数
  function applyPending(eventId, playerList) {
    var n = 0;
    for (var i = 0; i < queue.length; i++) {
      var e = queue[i];
      if (e.eventId !== eventId) continue;
      for (var j = 0; j < (playerList || []).length; j++) {
        if (playerList[j].id === e.playerId) {
          playerList[j].score = e.score;
          playerList[j].result = e.result;
          // 新項目は、エントリが持っているときだけ上書きする（旧形式のエントリには無い）
          if ('adjust' in e) playerList[j].adjust = e.adjust;
          if ('totalAdjust' in e) playerList[j].totalAdjust = e.totalAdjust;
          if ('note' in e) playerList[j].note = e.note;
          if ('confirmed' in e) playerList[j].confirmed = e.confirmed;
          n++;
          break;
        }
      }
    }
    return n;
  }

  // 現在の状態。app.js はこれを見て表示を決める。
  function status() {
    var state = 'idle';
    if (queue.length > 0) state = failingSince ? 'retrying' : 'sending';
    return {
      state: state,
      pending: queue.length,
      failingSince: failingSince
    };
  }

  // 状態通知。呼び出し元のコールバックが投げてもワーカーを巻き込まない。
  function notify() {
    if (!statusHandler) return;
    try { statusHandler(status()); } catch (e) {}
  }

  // 捨てたエントリを呼び出し元へ知らせる。黙って捨てると採点が
  // 消えたことに誰も気付けない。
  function flushDropped() {
    if (dropped.length === 0) return;
    if (!discardHandler) return;   // ハンドラが付くまで溜めておく
    var list = dropped;
    dropped = [];
    try { discardHandler(list); } catch (e) {}
  }

  // キューが空でない間だけ毎秒通知する（バナー昇格の判定に使う）。
  function startTicking() {
    if (tickTimer) return;
    tickTimer = setInterval(function() {
      if (queue.length === 0) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      notify();
    }, TICK_MS);
  }

  // キューを先頭から順に送る。失敗したらバックオフして再挑戦する。
  async function drain() {
    if (sending) return;
    if (queue.length === 0) { notify(); return; }
    sending = true;
    notify();

    // 途中で何が投げても sending を巻き戻す。
    // ここで詰まると以降の drain() が全て無視され、送信が恒久停止するため。
    try {
      while (queue.length > 0) {
        var entry = queue[0];
        var res = null;
        try {
          var body = { score: entry.score, result: entry.result };
          if ('adjust' in entry) body.adjust = entry.adjust;
          if ('totalAdjust' in entry) body.totalAdjust = entry.totalAdjust;
          if ('note' in entry) body.note = entry.note;
          if ('confirmed' in entry) body.confirmed = entry.confirmed;
          res = await Api.updatePlayer(entry.eventId, entry.playerId, body);
        } catch (e) {
          res = null;
        }

        if (res && res.ok) {
          // 送信済みのエントリだけを取り除く。
          // 送信中に同じ選手が再採点されていれば別オブジェクトに差し替わっているので、
          // 参照が一致するときだけ削除する（新しい採点を取りこぼさない）。
          if (queue[0] === entry) queue.shift();
          save();
          backoffMs = BACKOFF_MIN;
          failingSince = null;
          notify();
        } else if (res && isPermanentFailure(res.status)) {
          // 送り先が存在しない、リクエストが受け付けられない等。
          // 何度送っても通らないので捨てて先へ進む。
          // 残すとこの1件が先頭に張り付き、以降の採点が全部届かなくなる。
          if (queue[0] === entry) queue.shift();
          save();
          dropped.push(entry);
          notify();
        } else {
          if (!failingSince) failingSince = Date.now();
          sending = false;
          notify();
          startTicking();
          scheduleRetry();
          return;
        }
      }
    } finally {
      sending = false;
      flushDropped();
    }

    notify();
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function() {
      retryTimer = null;
      drain();
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
  }

  // 採点をキューに積む。通信は待たない。
  function enqueue(entry) {
    // 呼び出し元がオブジェクトを使い回しても参照の一意性が壊れないよう、
    // ここで必ず新しいオブジェクトにする。
    // drain() の queue[0] === entry 判定がこの一意性を前提にしている。
    var queued = {
      eventId: entry.eventId,
      playerId: entry.playerId,
      score: entry.score,
      result: entry.result,
      queuedAt: new Date().toISOString()
    };
    if ('adjust' in entry) queued.adjust = entry.adjust;
    if ('totalAdjust' in entry) queued.totalAdjust = entry.totalAdjust;
    if ('note' in entry) queued.note = entry.note;
    if ('confirmed' in entry) queued.confirmed = entry.confirmed;
    queue = coalesce(queue, queued);
    save();
    startTicking();
    // バックオフ待機中なら、その再送に任せる。
    // タップのたびに即時送信を試みると、回線が不安定なときほどバックオフが無効になる。
    if (!retryTimer) drain();
  }

  // バックオフ待ちを打ち切って即座に送信を試みる。
  function flushNow() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    backoffMs = BACKOFF_MIN;
    drain();
  }

  // 起動時に呼ぶ。localStorage の残件があれば自動送信する。
  // onDiscard は、送り先が存在せず恒久的に送れなかったエントリの配列を受け取る。
  // 戻り値: 復元した件数（呼び出し元が「N件送信しました」を出すのに使う）
  function init(onStatusChange, onDiscard) {
    statusHandler = onStatusChange || null;
    discardHandler = onDiscard || null;
    queue = load();
    var recovered = queue.length;

    window.addEventListener('online', flushNow);

    if (recovered > 0) {
      startTicking();
      drain();
    } else {
      notify();
    }
    return recovered;
  }

  return {
    init: init,
    enqueue: enqueue,
    flushNow: flushNow,
    pendingCount: pendingCount,
    applyPending: applyPending,
    status: status,
    coalesce: coalesce
  };
})();
