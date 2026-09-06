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
        var ok = false;
        try {
          var result = await Api.updatePlayer(entry.eventId, entry.playerId, {
            score: entry.score,
            result: entry.result
          });
          ok = !!result;
        } catch (e) {
          ok = false;
        }

        if (ok) {
          // 送信済みのエントリだけを取り除く。
          // 送信中に同じ選手が再採点されていれば別オブジェクトに差し替わっているので、
          // 参照が一致するときだけ削除する（新しい採点を取りこぼさない）。
          if (queue[0] === entry) queue.shift();
          save();
          backoffMs = BACKOFF_MIN;
          failingSince = null;
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
  // 戻り値: 復元した件数（呼び出し元が「N件送信しました」を出すのに使う）
  function init(onStatusChange) {
    statusHandler = onStatusChange || null;
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
    status: status,
    coalesce: coalesce
  };
})();
