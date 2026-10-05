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
  // ハッシュが無いときに最初に出す大会（ユーザー要望 2026-10-05「現在進行中の大会を表示」）。
  // 進行中（round1 / round2）の大会のうち更新が新しいもの。無ければ null。テスト大会は選ばない。
  function pickCurrent(events) {
    var best = null;
    (events || []).forEach(function(ev) {
      if (!ev || ev.test === true) return;
      if (ev.status !== 'round1' && ev.status !== 'round2') return;
      if (!best || String(ev.updatedAt || '') > String(best.updatedAt || '')) best = ev;
    });
    return best;
  }

  // 文字の大きさ（%）。50〜200 の 10 刻み。範囲外・数でないものは 100
  function clampZoom(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 50 || n > 200) return 100;
    return Math.round(n / 10) * 10;
  }

  return { parseHash: parseHash, pickCurrent: pickCurrent, clampZoom: clampZoom };
})();
