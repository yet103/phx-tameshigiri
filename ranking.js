// 順位表示ページ（ranking.html）の URL のハッシュ。#event/<id> で大会を指定して開く
// （ダッシュボードの面。設計書 2026-10-05-dashboard-design.md §3）。他は ''。
// ranking.html の script から呼ぶ。test.html からも読める純粋関数だけ置く。
var Ranking = (function() {
  function parseHash(hash) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    var m = raw.match(/^event\/(.+)$/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return ''; }
  }
  return { parseHash: parseHash };
})();
