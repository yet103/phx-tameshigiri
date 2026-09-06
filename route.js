// 「どの大会・どのコートを見ているか」の保持
// URLハッシュ (#event/<eventId>/<court>) を正とし、localStorage に控えを置く。
// ハッシュが無いとき（ページ間リンクやドメイン直打ち）は控えから復帰する。
var Route = (function() {
  var LAST_KEY = 'tmg_last';

  // ハッシュ文字列を { eventId, court } に解析する。解釈できなければ null。
  // 壊れたURL（不正なパーセントエンコーディング）でも例外を投げず null を返す。
  // コートごとにURLを配る運用のため、壊れたブックマークで起動時に落ちないようにする。
  function parse(hash) {
    if (!hash) return null;
    var body = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    if (!body) return null;
    var parts = body.split('/');
    if (parts[0] !== 'event') return null;
    try {
      var eventId = decodeURIComponent(parts[1] || '');
      if (!eventId) return null;
      return {
        eventId: eventId,
        court: decodeURIComponent(parts[2] || '')
      };
    } catch (e) {
      return null;
    }
  }

  // { eventId, court } からハッシュ文字列を組み立てる。
  function build(eventId, court) {
    if (!eventId) return '';
    var hash = '#event/' + encodeURIComponent(eventId);
    if (court) hash += '/' + encodeURIComponent(court);
    return hash;
  }

  function loadLast() {
    try {
      var raw = localStorage.getItem(LAST_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.eventId) return null;
      return { eventId: obj.eventId, court: obj.court || '' };
    } catch (e) { return null; }
  }

  function saveLast(eventId, court) {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({
        eventId: eventId, court: court || ''
      }));
    } catch (e) {}
  }

  function clear() {
    try { localStorage.removeItem(LAST_KEY); } catch (e) {}
    if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  // 選択をURLと控えの両方に反映する。
  function set(eventId, court) {
    if (!eventId) { clear(); return; }
    var hash = build(eventId, court);
    if (location.hash !== hash) {
      history.replaceState(null, '', location.pathname + location.search + hash);
    }
    saveLast(eventId, court);
  }

  // ハッシュ → 控え の順で復帰する。どちらも無ければ null。
  function restore() {
    return parse(location.hash) || loadLast();
  }

  // ブラウザの戻る/進むに追従する。
  function onChange(fn) {
    window.addEventListener('hashchange', function() {
      fn(parse(location.hash));
    });
  }

  return {
    parse: parse,
    build: build,
    set: set,
    restore: restore,
    clear: clear,
    onChange: onChange
  };
})();
