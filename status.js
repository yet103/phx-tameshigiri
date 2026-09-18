// 大会の状態（準備中 → 一巡目 → … → アーカイブ）。
// サーバー（server/index.js の require）とブラウザ（<script src="status.js">）の
// 両方から読むので、リポジトリ直下に置いて UMD 風の包みにする。
// 判定をここ1箇所にまとめ、画面・API・テストで同じ関数を使う。
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventStatus = factory();
})(this, function() {

  var STATES = ['draft', 'round1', 'round1_done', 'round2', 'round2_done', 'final', 'archived'];

  var LABELS = {
    draft: '準備中',
    round1: '一巡目 進行中',
    round1_done: '一巡目終了',
    round2: '二巡目 進行中',
    round2_done: '二巡目終了',
    final: '最終結果',
    archived: 'アーカイブ'
  };

  // 「次へ進む」ボタンの文言。archived から進む先は無い。
  var NEXT_LABELS = {
    draft: '試合開始',
    round1: '一巡目を終了',
    round1_done: '二巡目を開始',
    round2: '二巡目を終了',
    round2_done: '最終結果を確定',
    final: 'アーカイブ',
    archived: null
  };

  // 許される遷移（設計書「状態と遷移」の表）。ここに無い組み合わせはサーバーが 409 で拒む。
  var TRANSITIONS = {
    draft: ['round1'],
    round1: ['draft', 'round1_done'],
    round1_done: ['round1', 'round2', 'final'],
    round2: ['round1_done', 'round2_done'],
    round2_done: ['round2', 'final'],
    final: ['round2_done', 'round1_done', 'archived'],
    archived: ['final']
  };

  // ---- courts.js と同じ規則の私物コピー ----
  // derive はサーバーでも動く必要があり、サーバーは courts.js（IIFE のブラウザ用）を読めない。
  // そこで order の解析と採点済み判定をここに複製する。両者が一致することは
  // test.html の「derive の巡目判定が Courts.roundOf と一致する」で固定する。
  // courts.js の roundOf / isScored を変えたら、必ずここも同じに変えること。
  // server/index.js はこのモジュールを require できる（CommonJS）ので、
  // 自前実装を持たずここの roundOf / isScored をそのまま使う。
  var ORDER_PATTERN = /^([^-]+)-(男子|女子)-(\d+)-(\d+)$/;

  function roundOf(player) {
    var order = (player && typeof player.order === 'string') ? player.order : '';
    var m = order.match(ORDER_PATTERN);
    return m ? parseInt(m[3], 10) : 1;
  }

  function isScored(player) {
    if (!player) return false;
    if (typeof player.score === 'number' && player.score > 0) return true;
    if (/[01]/.test(player.result || '')) return true;
    if (Array.isArray(player.adjust)) {
      for (var i = 0; i < player.adjust.length; i++) {
        if (Number(player.adjust[i])) return true;
      }
    }
    return !!Number(player.totalAdjust);
  }

  function playersOf(event) {
    return (event && Array.isArray(event.players)) ? event.players : [];
  }

  function rowsOfRound(players, round) {
    return (players || []).filter(function(p) { return roundOf(p) === round; });
  }

  // ---- 判定関数 ----

  function canTransition(from, to) {
    var list = Object.prototype.hasOwnProperty.call(TRANSITIONS, from) ? TRANSITIONS[from] : null;
    return !!list && list.indexOf(to) !== -1;
  }

  // 表の右隣。archived と未知の状態は null。
  function next(status) {
    var i = STATES.indexOf(status);
    if (i === -1 || i === STATES.length - 1) return null;
    return STATES[i + 1];
  }

  // 「戻す」の行き先。draft と未知の状態は null。
  // final からは二巡目の行があれば round2_done、無ければ round1_done。
  function prev(status, players) {
    if (status === 'final') {
      return rowsOfRound(players, 2).length > 0 ? 'round2_done' : 'round1_done';
    }
    var i = STATES.indexOf(status);
    if (i <= 0) return null;
    return STATES[i - 1];
  }

  // コート端末で得点を送れる状態か。
  function isScoringOpen(status) {
    return status === 'round1' || status === 'round2';
  }

  // 採点の対象になる巡目。進行中でなければ null。
  function scoringRound(status) {
    if (status === 'round1') return 1;
    if (status === 'round2') return 2;
    return null;
  }

  // 得点・選手・技の書き込みをサーバーが拒む状態か。
  function isLocked(status) {
    return status === 'final' || status === 'archived';
  }

  // status を持たない大会の状態を選手から推定する（設計書「状態の無い既存データ」）。
  // 「一巡目が全員採点済みで二巡目が無い」は round1 のまま（運営者が
  // 「一巡目を終了」を押すのが新しい流れなので、推定で先へ進めない）。
  function derive(event) {
    var players = playersOf(event);
    if (players.length === 0) return 'draft';
    var r2 = rowsOfRound(players, 2);
    if (r2.length > 0) {
      for (var i = 0; i < r2.length; i++) {
        if (!isScored(r2[i])) return 'round2';
      }
      return 'round2_done';
    }
    for (var j = 0; j < players.length; j++) {
      if (roundOf(players[j]) !== 2 && isScored(players[j])) return 'round1';
    }
    return 'draft';
  }

  // 大会の状態。ファイルの status が有効ならそれ、無ければ推定値。
  function of(event) {
    if (event && STATES.indexOf(event.status) !== -1) return event.status;
    return derive(event);
  }

  return {
    STATES: STATES,
    LABELS: LABELS,
    NEXT_LABELS: NEXT_LABELS,
    canTransition: canTransition,
    next: next,
    prev: prev,
    isScoringOpen: isScoringOpen,
    scoringRound: scoringRound,
    isLocked: isLocked,
    derive: derive,
    of: of,
    // server/index.js が自前実装の代わりに使う。courts.js との一致は
    // test.html の「derive の巡目判定が Courts.roundOf と一致する」で固定する。
    roundOf: roundOf,
    isScored: isScored
  };
});
