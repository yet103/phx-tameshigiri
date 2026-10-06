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

  // ---- 順位表の表示の設定（ユーザー要望 2026-10-06）: 内訳（41+44）とベスト4 の列を出すか ----
  // localStorage tmg_ranking_opts = { detail: false, best4: true }。採点画面の順位表も同じ設定を読む
  var OPTS_KEY = 'tmg_ranking_opts';
  function normalizeOpts(raw) {
    var s = (raw && typeof raw === 'object') ? raw : {};
    return { detail: s.detail === true, best4: s.best4 !== false };
  }
  function loadOpts() {
    try { return normalizeOpts(JSON.parse(localStorage.getItem(OPTS_KEY) || 'null')); }
    catch (e) { return normalizeOpts(null); }
  }
  function saveOpts(o) {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(normalizeOpts(o))); } catch (e) {}
  }
  // 表の入れ物（.rank-panel-cols）に設定の class を付ける。show-detail で内訳が出て、hide-best4 でベスト4 の列と凡例が消える
  function applyOpts(container, opts) {
    if (!container || !container.classList) return;
    var o = normalizeOpts(opts);
    container.classList.toggle('show-detail', o.detail);
    container.classList.toggle('hide-best4', !o.best4);
  }
  // 合計のセルの色分け: 確定した得点が無い → 'pending'（グレー）、二巡目まで終えた（または大会が終わった）→ 'done'（青）、
  // それ以外（一巡目まで）→ 'r1'（金茶）。counted は行、detail は { r2Done }、finished は大会が final / archived か
  function totalClass(counted, detail, finished) {
    if (counted === false) return 'pending';
    if (finished || (detail && detail.r2Done === true)) return 'done';
    return 'r1';
  }
  // 内訳の文字。二巡目まで終えていれば「41+44」、そうでなければ ''
  function detailText(detail) {
    if (!detail || detail.r2Done !== true) return '';
    return (Number(detail.r1) || 0) + '+' + (Number(detail.r2) || 0);
  }
  var COLOR_LEGEND = '合計の色: 青 二巡目まで確定　金茶 一巡目まで　グレー 未確定';

  // ---- 順位の入れ替わりのアニメーション（ユーザー要望 2026-10-06）----
  // 表を描き直す前に captureRows で行（tr[data-rowkey]）の位置と得点を控え、描き直した後に animateRows を呼ぶ。
  // 位置の変わった行は前の位置からの差を transform で置き、次のフレームで 0 に戻す（FLIP。style.css の .rank-row-move）。
  // 新しく出た行は .rank-row-new、得点の変わった行の合計は .rank-score-changed（どちらも CSS の animation）。
  // 順位表示ページ（ranking.html）と採点画面の順位表（app.js）で共用。
  function captureRows(container) {
    var out = {};
    if (!container || !container.querySelectorAll) return out;
    var rows = container.querySelectorAll('tr[data-rowkey]');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      out[rows[i].getAttribute('data-rowkey')] = { top: r.top, left: r.left, score: rows[i].getAttribute('data-score') };
    }
    return out;
  }
  // 戻り値: { moved, added, changed }（件数。test.html が見る）。prev が空（最初の描画）なら何もしない
  function animateRows(container, prev) {
    var stats = { moved: 0, added: 0, changed: 0 };
    if (!container || !container.querySelectorAll || !prev || Object.keys(prev).length === 0) return stats;
    var rows = container.querySelectorAll('tr[data-rowkey]');
    var moved = [];
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i], p = prev[tr.getAttribute('data-rowkey')];
      if (!p) { tr.classList.add('rank-row-new'); stats.added++; continue; }
      var r = tr.getBoundingClientRect();
      // CSS zoom（文字の大きさ）が掛かっていると、画面上の px と transform の px が違うので割り戻す
      var scale = (tr.offsetWidth > 0 && r.width > 0) ? r.width / tr.offsetWidth : 1;
      var dx = (p.left - r.left) / scale, dy = (p.top - r.top) / scale;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        tr.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        moved.push(tr);
        stats.moved++;
      }
      if (p.score !== tr.getAttribute('data-score')) {
        var td = tr.querySelector('td.total');
        if (td) td.classList.add('rank-score-changed');
        stats.changed++;
      }
    }
    if (moved.length) {
      void container.offsetHeight;   // 置いた transform を先に反映させてから transition を有効にする
      moved.forEach(function(tr) {
        tr.classList.add('rank-row-move');
        tr.addEventListener('transitionend', function() { tr.classList.remove('rank-row-move'); }, { once: true });
      });
      // 次のフレームで transform を 0 に戻す（transition が走る）。隠れたタブでは requestAnimationFrame が止まるので
      // setTimeout でも戻す（どちらか先に来た方。2 回呼んでも害は無い）
      var reset = function() { moved.forEach(function(tr) { tr.style.transform = ''; }); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function() { requestAnimationFrame(reset); });
      setTimeout(reset, 40);
    }
    return stats;
  }

  return { parseHash: parseHash, pickCurrent: pickCurrent, clampZoom: clampZoom,
           normalizeOpts: normalizeOpts, loadOpts: loadOpts, saveOpts: saveOpts, applyOpts: applyOpts,
           totalClass: totalClass, detailText: detailText, COLOR_LEGEND: COLOR_LEGEND,
           captureRows: captureRows, animateRows: animateRows };
})();
