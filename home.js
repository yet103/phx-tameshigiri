// トップページ（index.html）の制御。
// ・改名前（index.html が採点画面だった頃）のブックマークを scoring.html へ転送する
// ・入口ボタンの行き先（運営画面は PC / スマホのモードで変わる）
// ・進行中の大会の一覧
// このファイルは test.html からも読まれる。DOM を持たないページで落ちないよう、
// 描画は init で #homeMain の有無を見てから行い、転送は index.html から明示的に呼ぶ。
var Home = (function() {

  // --- 転送（純粋関数）---

  // 採点画面へ転送すべきハッシュなら転送先の URL、そうでなければ null。
  // ハッシュの解釈は route.js に任せる（壊れたパーセントエンコーディングでも例外を投げない）。
  // 戻り値は受け取ったハッシュをそのまま繋ぐ。Route.build で組み直すと
  // すでにエンコード済みの大会IDが二重にエンコードされる。
  function redirectTarget(hash) {
    var h = String(hash == null ? '' : hash);
    if (!Route.parse(h)) return null;
    return 'scoring.html' + h;
  }

  // 実際に転送する。index.html の <head> から呼ぶ（本文を描く前に抜けるため）。
  // history に残さないよう replace を使う（戻るボタンで転送が繰り返されない）。
  function redirectIfScoring() {
    var to = redirectTarget(location.hash);
    if (!to) return false;
    location.replace(to);
    return true;
  }

  // --- 大会の並び（純粋関数）---

  // 設計書「画面設計 > トップ」の並び順。小さいほど上。
  //   0: 採点できる状態（一巡目 / 二巡目 進行中）
  //   1: 準備中・一巡目終了・二巡目終了（運営の手が要る）
  //   2: 最終結果（終わっている）
  function statusRank(status) {
    if (EventStatus.isScoringOpen(status)) return 0;
    if (status === 'final') return 2;
    return 1;
  }

  // 進行中の大会の一覧を並べ替える。アーカイブは除く。
  // 同じ段の中は updatedAt の新しい順、それも同じなら元の順（Array#sort は
  // 実装によって不安定なので、添字を持って同着の順を固定する）。
  // 元の配列は書き換えない。
  function sortForHome(events) {
    var rows = [];
    (events || []).forEach(function(ev, i) {
      var status = EventStatus.of(ev);
      if (status === 'archived') return;
      rows.push({ ev: ev, i: i, rank: statusRank(status) });
    });
    rows.sort(function(a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      var x = String(a.ev.updatedAt || ''), y = String(b.ev.updatedAt || '');
      if (x !== y) return x < y ? 1 : -1;
      return a.i - b.i;
    });
    return rows.map(function(r) { return r.ev; });
  }

  return {
    redirectTarget: redirectTarget,
    redirectIfScoring: redirectIfScoring,
    sortForHome: sortForHome
  };
})();
