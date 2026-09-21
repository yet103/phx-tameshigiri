// 大会の状態（準備中 → 一巡目 → … → アーカイブ）。
// サーバー（server/index.js の require）とブラウザ（<script src="status.js">）の
// 両方から読むので、リポジトリ直下に置いて UMD 風の包みにする。
// 判定をここ1箇所にまとめ、画面・API・テストで同じ関数を使う。
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventStatus = factory();
})(this, function() {

  var STATES = ['draft', 'round1', 'round1_done', 'round2', 'round2_final', 'round2_done', 'final', 'archived'];

  var LABELS = {
    draft: '準備中',
    round1: '一巡目 進行中',
    // 一巡目を終了した直後の段階。二巡目の行はサーバーが作り終えているので、
    // 運営者がここでやるのは「自己申告があった選手の形を直す」こと（設計書 2026-09-22）。
    round1_done: '二巡目準備（形の登録）',
    round2: '二巡目 進行中',
    round2_final: '決戦 進行中',
    round2_done: '二巡目終了',
    final: '最終結果',
    archived: 'アーカイブ'
  };

  // 「次へ進む」ボタンの文言。archived から進む先は無い。
  var NEXT_LABELS = {
    draft: '試合開始',
    round1: '一巡目を終了',
    round1_done: '二巡目を開始',
    round2: '決戦を開始',
    round2_final: '二巡目を終了',
    round2_done: '最終結果を確定',
    final: 'アーカイブ',
    archived: null
  };

  // 許される遷移（設計書「状態と遷移」の表）。ここに無い組み合わせはサーバーが 409 で拒む。
  var TRANSITIONS = {
    draft: ['round1'],
    round1: ['draft', 'round1_done'],
    round1_done: ['round1', 'round2', 'final'],
    // round2 → round2_done は「決戦の行が 0 件のとき」だけ。判定はサーバー
    // （遷移表は硬い形だけを表し、件数の条件は POST /api/events/:id/status が見る）。
    round2: ['round1_done', 'round2_final', 'round2_done'],
    round2_final: ['round2', 'round2_done'],
    round2_done: ['round2', 'round2_final', 'final'],
    final: ['round2_done', 'round1_done', 'archived'],
    archived: ['final']
  };

  // 決戦コートの既定名。event.settings.finalCourt で変えられる（設計書「データ」）。
  var DEFAULT_FINAL_COURT = '決戦';

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

  // result の '2' は △（減点成功）。成功の一種なので採点済みに含める
  // （設計書 2026-09-20-rules-alignment-design.md）。courts.js の Courts.isScored と同じ規則。
  function isScored(player) {
    if (!player) return false;
    if (typeof player.score === 'number' && player.score > 0) return true;
    if (/[012]/.test(player.result || '')) return true;
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
  // round2_done からは決戦の行があれば round2_final、無ければ round2
  // （決戦の無い大会を添字だけで round2_final に戻さない。既存データの移行）。
  function prev(status, players) {
    if (status === 'final') {
      return rowsOfRound(players, 2).length > 0 ? 'round2_done' : 'round1_done';
    }
    if (status === 'round2_done') {
      return hasFinalists(players) ? 'round2_final' : 'round2';
    }
    var i = STATES.indexOf(status);
    if (i <= 0) return null;
    return STATES[i - 1];
  }

  // 決戦コートの名前。settings に無ければ既定の「決戦」。
  // 読み出しはここだけを通す（保存のときに書くのは基本情報の PATCH だけ）。
  function finalCourtOf(event) {
    var s = (event && event.settings) || {};
    var name = (typeof s.finalCourt === 'string') ? s.finalCourt.trim() : '';
    return name || DEFAULT_FINAL_COURT;
  }

  // 暫定ベスト8（決戦に出る選手）の行。二巡目の行に付いた finalist の印で判定する。
  // コートを手で変えても印は残るので、コート名では判定しない（設計書「データ」）。
  // 並びはここでは整えない（試技順に並べるのは Courts.finalists）。
  function finalists(players) {
    return (players || []).filter(function(p) {
      return p && p.finalist === true && roundOf(p) === 2;
    });
  }

  function hasFinalists(players) {
    return finalists(players).length > 0;
  }

  // 「次へ進む」の行き先。二巡目 進行中からは、決戦の行があれば決戦へ、
  // 無ければ二巡目終了へ（暫定ベスト8 が 0 名の大会）。
  function nextStep(status, players) {
    if (status === 'round2') return hasFinalists(players) ? 'round2_final' : 'round2_done';
    return next(status);
  }

  // 「次へ進む」ボタンの文言。nextStep と対になる。
  function nextLabel(status, players) {
    // 決戦が無い大会の二巡目は、そのまま「二巡目を終了」（round2_final の文言を借りる。
    // 同じ文言を2箇所に書かないため）。
    if (status === 'round2' && !hasFinalists(players)) return NEXT_LABELS.round2_final;
    var label = NEXT_LABELS[status];
    return label === undefined ? null : label;
  }

  // コート端末で得点を送れる状態か。決戦 進行中も採点できる（決戦コートだけ）。
  function isScoringOpen(status) {
    return status === 'round1' || status === 'round2' || status === 'round2_final';
  }

  // 採点の対象になる巡目。進行中でなければ null。決戦は二巡目の一部。
  function scoringRound(status) {
    if (status === 'round1') return 1;
    if (status === 'round2' || status === 'round2_final') return 2;
    return null;
  }

  // その状態で採点してよいコートの絞り込み（設計書「状態モデル」）。
  //   round2       … 決戦コート以外（決戦は「決戦を開始」の後）
  //   round2_final … 決戦コートだけ
  //   それ以外     … 制限なし
  // 採点画面（app.js）と配信ボードが同じ判定を使えるよう、素の値だけを返す。
  function scoringCourtFilter(status, event) {
    if (status === 'round2') return { mode: 'exclude', court: finalCourtOf(event) };
    if (status === 'round2_final') return { mode: 'only', court: finalCourtOf(event) };
    return { mode: 'all', court: '' };
  }

  // そのコートで採点してよいか。scoringCourtFilter の判定を1つの真偽値にしたもの。
  function isCourtScorable(status, event, court) {
    var f = scoringCourtFilter(status, event);
    if (f.mode === 'exclude') return court !== f.court;
    if (f.mode === 'only') return court === f.court;
    return true;
  }

  // 得点・選手・技の書き込みをサーバーが拒む状態か。
  function isLocked(status) {
    return status === 'final' || status === 'archived';
  }

  // status を持たない大会の状態を選手から推定する（設計書「状態の無い既存データ」）。
  // 「一巡目が全員採点済みで二巡目が無い」は round1 のまま（運営者が
  // 「一巡目を終了」を押すのが新しい流れなので、推定で先へ進めない）。
  // round2_final は返さない。決戦は運営者が「決戦を開始」を押して入る状態で、
  // 選手データからは区別できないため（既存データの移行。test.html で固定）。
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
    nextStep: nextStep,
    nextLabel: nextLabel,
    finalists: finalists,
    hasFinalists: hasFinalists,
    finalCourtOf: finalCourtOf,
    scoringCourtFilter: scoringCourtFilter,
    isCourtScorable: isCourtScorable,
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
