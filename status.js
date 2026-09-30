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

  // 級位・段位の表記の正規化。段は「初段・弐段・参段」の表記にそろえる（ユーザー要望 2026-09-29）。
  // 保存済みの「二段」「三段」（および半角・全角の 2段/3段）は表示のたびに読み替え、
  // サーバーは保存時にもこれを通す（新しいデータは正規化された形で入る）。他の文字列はそのまま。
  function normalizeRank(v) {
    var s = (typeof v === 'string') ? v.trim() : '';
    return s.replace(/^[二2２]段$/, '弐段').replace(/^[三3３]段$/, '参段');
  }

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

  // 選手のコート名（order の先頭セグメント）。courts.js の Courts.courtOf と同じ規則。
  // 決戦の候補を置くコート（firstCourt）と、候補がいるコート（finaleCourt）の判定に使う。
  var UNASSIGNED = '未分類';

  function courtOf(player) {
    var order = (player && typeof player.order === 'string') ? player.order : '';
    var m = order.match(/^([^-]+)/);
    return m ? m[1] : UNASSIGNED;
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
  // final からは二巡目に採点済みか確定済みの行があれば round2_done、無ければ round1_done。
  // 一巡目の終了で二巡目の行は必ず作られるので、行があるかどうかでは「二巡目を行わず
  // 最終結果へ」の後の「戻す」が二巡目終了に行ってしまう（網羅検証 S11。2026-10-01）。
  // round2_done からは決戦の行があれば round2_final、無ければ round2
  // （決戦の無い大会を添字だけで round2_final に戻さない。既存データの移行）。
  function prev(status, players) {
    if (status === 'final') {
      var played = rowsOfRound(players, 2).some(function(p) {
        return isScored(p) || (p && p.confirmed === true);
      });
      return played ? 'round2_done' : 'round1_done';
    }
    if (status === 'round2_done') {
      return hasFinalists(players) ? 'round2_final' : 'round2';
    }
    var i = STATES.indexOf(status);
    if (i <= 0) return null;
    return STATES[i - 1];
  }

  // 暫定ベスト4（決戦に出る選手）の行。二巡目の行に付いた finalist の印で判定する。
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

  // 決戦の候補がいるコートの名前（表示と配信ボードの判定用。設計書 2026-09-28）。
  // 候補の行を（コート → 性別 → 番号）の順に並べた先頭の行のコート。候補がいなければ ''。
  // 候補の行は生成時に先頭のコート（firstCourt）へ置くので、通常は「A」。
  // 2026-09-22 の設計で専用コート「決戦」に置かれた既存大会では '決戦' を返す（移行しない）。
  // finalists は二巡目（ORDER_PATTERN が解析できる行）だけを返すので、m は必ず取れる。
  function finaleCourt(players) {
    var best = null;
    finalists(players).forEach(function(p) {
      var m = p.order.match(ORDER_PATTERN);
      var key = { court: m[1], sex: m[2] === '男子' ? 0 : 1, no: parseInt(m[4], 10) };
      if (!best ||
          key.court < best.court ||
          (key.court === best.court && (key.sex < best.sex ||
            (key.sex === best.sex && key.no < best.no)))) {
        best = key;
      }
    });
    return best ? best.court : '';
  }

  // 先頭のコート（二巡目の生成で決戦の候補の行を置くコート。設計書 2026-09-28）。
  // Courts.listFrom と同じ規則（選手のコートと extraCourts＝settings.courts の和、
  // 文字列の昇順、'未分類' は除く）の先頭。何も無ければ ''。
  // 両者の一致は test.html の「firstCourt は Courts.listFrom の先頭と一致する」で固定する。
  function firstCourt(players, extraCourts) {
    var first = '';
    function add(c) {
      if (typeof c !== 'string' || !c || c === UNASSIGNED) return;
      // Array.prototype.sort の既定（UTF-16 の符号単位順）と同じ比べ方
      if (!first || c < first) first = c;
    }
    (players || []).forEach(function(p) { add(courtOf(p)); });
    (Array.isArray(extraCourts) ? extraCourts : []).forEach(add);
    return first;
  }

  // その選手をいま採点してよいか（状態が採点できることは isScoringOpen が見る）。
  // 決戦かどうかはコート名ではなく行の印 finalist で判定する（設計書 2026-09-28）。
  //   round2       … 候補以外（候補は「決戦を開始」の後）
  //   round2_final … 候補だけ（他の選手は斬り終わっている）
  //   それ以外     … 制限なし
  // player が無い（コートに選手がいない）ときは true（状態だけで決める）。
  function isPlayerScorable(status, player) {
    if (!player) return true;
    if (status === 'round2') return player.finalist !== true;
    if (status === 'round2_final') return player.finalist === true;
    return true;
  }

  // その行を今の状態で採点してよいか（サーバの not_scorable の判定。設計書 2026-10-01 1.2）。
  // 状態が採点できること（isScoringOpen）、行の巡目がその状態の巡目であること
  // （一巡目終了の後に一巡目の行の得点が届いても受け付けない）、決戦の制限（isPlayerScorable）の3つ。
  // 採点画面の「この選手を採点できるか」もこれに寄せてよい。
  function isRowScorable(status, player) {
    if (!isScoringOpen(status)) return false;
    if (!player) return false;
    if (roundOf(player) !== scoringRound(status)) return false;
    return isPlayerScorable(status, player);
  }

  // 選手の行の版（設計書 2026-10-01 1.1）。無い・壊れた値は 0（旧データ・新規作成の行）。
  function revOf(player) {
    var v = player && player.rev;
    return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0) ? v : 0;
  }

  // 暫定ベスト4 の選考で使う得点。確定済みの行だけ数える（未確定は 0。順位と同じ基準）。
  function confirmedScoreOf(p) {
    return (p && p.confirmed === true && typeof p.score === 'number') ? p.score : 0;
  }

  // 決戦に進む人数（暫定ベスト N の N。設計書 2026-10-01-finale-best4.md）。選考・画面の文言はすべてこれを使う。
  var FINALIST_COUNT = 4;
  var FINALIST_LABEL = '暫定ベスト' + FINALIST_COUNT;

  // 暫定ベスト4。一般男子（isFemale が true でない＝新人も含む。順位の集計と同じ規則）の
  // 一巡目の確定済みの得点の上位 FINALIST_COUNT 名。0 点は含めない。最後の位が同点なら全員（同点同順位）。
  // FINALIST_COUNT 名未満なら全員。rows は一巡目の行（呼び出し側が絞る）。
  // 戻り値: { <playerId>: true }（選手 id が '__proto__' でも壊れない辞書）。
  // サーバの二巡目生成と finalistDiff（S18）が同じ判定を使う（以前は server/index.js にあった）。
  function pickFinalists(rows) {
    var out = Object.create(null);
    var males = (rows || []).filter(function(p) {
      return p && p.isFemale !== true && confirmedScoreOf(p) > 0;
    }).sort(function(a, b) { return confirmedScoreOf(b) - confirmedScoreOf(a); });
    if (males.length === 0) return out;
    var cut = confirmedScoreOf(males.length >= FINALIST_COUNT ? males[FINALIST_COUNT - 1] : males[males.length - 1]);
    males.forEach(function(p) { if (confirmedScoreOf(p) >= cut) out[p.id] = true; });
    return out;
  }

  // 二巡目の元になる一巡目の行（order が解析でき、コートが使える名前の行）。
  // サーバの generateRound2 の src と同じ条件（isValidCourt: '未分類' でない・32 文字まで。
  // '-' を含まないことは ORDER_PATTERN が保証する）。
  function round1Sources(players) {
    return (players || []).filter(function(p) {
      if (!p || roundOf(p) !== 1) return false;
      var m = (typeof p.order === 'string' ? p.order : '').match(ORDER_PATTERN);
      return !!m && m[1] !== UNASSIGNED && m[1].length <= 32;
    });
  }

  // 選考の差（網羅検証 S18。設計書 2026-10-01 6 章）。今の一巡目の確定得点で選ぶべき候補と、
  // 二巡目の決戦の行（finalist の印）の元（sourcePlayerId）を比べる。
  // 一巡目の終了のあとで一巡目の行が確定・得点変更されると、決戦の印は選び直されない。
  // それを試合進行（PC・スマホ）とサーバの応答で知らせるための共通の判定。
  // 戻り値: { changed, missing: [{ id, name, score }], extra: [{ id, name, score }], round2Scored }
  //   missing … 選ぶべきなのに決戦の行が無い一巡目の行
  //   extra   … 決戦の行があるのに選ぶべきでない一巡目の行
  //   round2Scored … 二巡目に採点済みか確定済みの行があるか（無ければ戻して選び直せる）
  // 二巡目の行が 1 つも無いときは changed: false（まだ選んでいない）。
  function finalistDiff(players) {
    var list = players || [];
    var r2 = rowsOfRound(list, 2);
    var result = { changed: false, missing: [], extra: [], round2Scored: false };
    if (r2.length === 0) return result;
    result.round2Scored = r2.some(function(p) { return isScored(p) || (p && p.confirmed === true); });
    var src = round1Sources(list);
    var want = pickFinalists(src);
    var have = Object.create(null);
    finalists(list).forEach(function(p) {
      if (typeof p.sourcePlayerId === 'string' && p.sourcePlayerId) have[p.sourcePlayerId] = true;
    });
    function brief(p) {
      return { id: p.id, name: String(p.name || '').trim(), score: confirmedScoreOf(p) };
    }
    src.forEach(function(p) {
      var w = !!want[p.id];
      var h = !!have[p.id];
      if (w && !h) result.missing.push(brief(p));
      if (!w && h) result.extra.push(brief(p));
    });
    result.changed = result.missing.length > 0 || result.extra.length > 0;
    return result;
  }

  // 「次へ進む」の行き先。二巡目 進行中からは、決戦の行があれば決戦へ、
  // 無ければ二巡目終了へ（暫定ベスト4 が 0 名の大会）。
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

  // コート端末で得点を送れる状態か。決戦 進行中も採点できる（決戦の選手だけ。
  // 選手ごとの判定は isPlayerScorable）。
  function isScoringOpen(status) {
    return status === 'round1' || status === 'round2' || status === 'round2_final';
  }

  // 採点の対象になる巡目。進行中でなければ null。決戦は二巡目の一部。
  function scoringRound(status) {
    if (status === 'round1') return 1;
    if (status === 'round2' || status === 'round2_final') return 2;
    return null;
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
    normalizeRank: normalizeRank,
    finalists: finalists,
    hasFinalists: hasFinalists,
    finaleCourt: finaleCourt,
    firstCourt: firstCourt,
    isPlayerScorable: isPlayerScorable,
    isRowScorable: isRowScorable,
    revOf: revOf,
    confirmedScoreOf: confirmedScoreOf,
    FINALIST_COUNT: FINALIST_COUNT,
    FINALIST_LABEL: FINALIST_LABEL,
    pickFinalists: pickFinalists,
    round1Sources: round1Sources,
    finalistDiff: finalistDiff,
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
