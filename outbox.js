// 採点の送信キュー
// 採点セルの操作は通信を待たずにキューへ積み、送信は独立したワーカーが担う。
// 同一選手のエントリは常に1件に畳む（result は毎回全文なので最新だけ送れば足りる）。
// キューは localStorage に退避し、端末が落ちても次回起動時に再送する。
var Outbox = (function() {
  var STORAGE_KEY = 'tmg_outbox';

  var queue = [];

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

  // init / enqueue / flushNow / status は Task 7 で追加する
  return {
    coalesce: coalesce,
    pendingCount: pendingCount
  };
})();
