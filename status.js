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
    // 一巡目上位 4 名（最終組）が A コートの最後にまとめて斬る段階。追加の試技ではなく順番の演出
    // （内部名 round2_final は変えない。設計書 2026-10-04-finale-after-round2-design.md）。
    round2_final: '最終組 進行中',
    round2_done: '二巡目終了',
    final: '最終結果',
    archived: 'アーカイブ'
  };

  // 「次へ進む」ボタンの文言。archived から進む先は無い。
  // 最終組のあとは「最終組を終了」、二巡目終了からは「結果を確定して表彰へ」（2026-10-04 試合進行の
  // 二巡目以降の見直し。状態名 round2_done の「二巡目終了」は変えない）。「決戦」の呼び名は
  // 「最終組」に改めた（2026-10-04 最終組とベスト4）。
  var NEXT_LABELS = {
    draft: '試合開始',
    round1: '一巡目を終了',
    round1_done: '二巡目を開始',
    round2: '最終組を開始',
    round2_final: '最終組を終了',
    round2_done: '結果を確定して表彰へ',
    final: 'アーカイブ',
    archived: null
  };
  // 最終組の無い大会で二巡目 進行中から二巡目終了へ進むボタンの文言（nextLabel）
  var ROUND2_END_LABEL = '二巡目を終了';

  // 許される遷移（設計書「状態と遷移」の表）。ここに無い組み合わせはサーバーが 409 で拒む。
  var TRANSITIONS = {
    draft: ['round1'],
    round1: ['draft', 'round1_done'],
    round1_done: ['round1', 'round2', 'final'],
    // round2 → round2_done は「最終組の行が 0 件のとき」だけ。判定はサーバー
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
  // 最終組の候補を置くコート（firstCourt）と、候補がいるコート（finaleCourt）の判定に使う。
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
  // round2_done からは最終組の行があれば round2_final、無ければ round2
  // （最終組の無い大会を添字だけで round2_final に戻さない。既存データの移行）。
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

  // 最終組（一巡目上位 4 名）の行。二巡目の行に付いた finalist の印で判定する。
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

  // 最終組の候補がいるコートの名前（表示と配信ボードの判定用。設計書 2026-09-28）。
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

  // 先頭のコート（二巡目の生成で最終組の候補の行を置くコート。設計書 2026-09-28）。
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
  // 最終組かどうかはコート名ではなく行の印 finalist で判定する（設計書 2026-09-28）。
  //   round2       … 候補以外（候補は「最終組を開始」の後）
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
  // （一巡目終了の後に一巡目の行の得点が届いても受け付けない）、最終組の制限（isPlayerScorable）の3つ。
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

  // 最終組の選考で使う得点。確定済みの行だけ数える（未確定は 0。順位と同じ基準）。
  function confirmedScoreOf(p) {
    return (p && p.confirmed === true && typeof p.score === 'number') ? p.score : 0;
  }

  // 最終組の人数（設計書 2026-10-01-finale-best4.md）。選考・画面の文言はすべてこれを使う。
  // 「最終組」は一巡目上位 4 名を A コートの最後にまとめて斬らせる順番の演出（追加の試技ではない）。
  // 以前は「決戦（暫定ベスト4）」と呼んでいた（2026-10-04 に呼び名を改めた。設計書
  // 2026-10-04-finale-after-round2-design.md）。「暫定ベスト4」は合計の上位 4（best4Standings）だけに使う。
  var FINALIST_COUNT = 4;
  var FINALIST_LABEL = '最終組';
  var FINALIST_DESC = '一巡目上位 ' + FINALIST_COUNT + ' 名';

  // ベスト4（合計の一般男子上位 4 名。結果の見せ場）の人数と呼び名。
  var BEST4_COUNT = 4;
  var BEST4_LABEL = 'ベスト' + BEST4_COUNT;
  var BEST4_PROVISIONAL_LABEL = '暫定ベスト' + BEST4_COUNT;

  // 最終組の選考。一般男子（isFemale が true でない＝新人も含む。順位の集計と同じ規則）の
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
  // 二巡目の最終組の行（finalist の印）の元（sourcePlayerId）を比べる。
  // 一巡目の終了のあとで一巡目の行が確定・得点変更されると、最終組の印は選び直されない。
  // それを試合進行（PC・スマホ）とサーバの応答で知らせるための共通の判定。
  // 戻り値: { changed, missing: [{ id, name, score }], extra: [{ id, name, score }], round2Scored }
  //   missing … 選ぶべきなのに最終組の行が無い一巡目の行
  //   extra   … 最終組の行があるのに選ぶべきでない一巡目の行
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

  // ---- 合計とベスト4（設計書 2026-10-04-finale-after-round2-design.md 2.2・2.3） ----

  // 選手ごとの合計。一巡目の行ごとにまとめる（server/index.js の computeRanking から移した。
  // 網羅検証 M1。設計書 2026-10-01 2.3）:
  //   一巡目の行 … 自分の id の組（id が無ければ行ごとに別の組）
  //   sourcePlayerId を持つ行 … その id の組（元の行が消えていてもその id でまとめる）
  //   sourcePlayerId を持たない二巡目以降の行（旧データ・CSV 由来）… 同じ氏名・同じ性別の
  //     一巡目の組に足す（無ければ氏名＋性別の組を作る）
  // （以前は氏名だけで合算していたため、一巡目の氏名を直すと 2 行に割れ、同姓同名の別人は合算されていた。
  // id の無い一巡目の行を 'id:' に寄せないのは、id の無い行どうしが 1 人に合算されないようにするため）
  // 組の氏名・性別・新人は代表（一巡目の行。無ければ最初に入った行）から。代表の氏名が空なら
  // 組の中の最初の空でない氏名。それも無い組は返さない（順位と同じ）。
  // 数える得点は確定済みの行だけ。opts.countAll（status を持たない旧データ。サーバーの
  // countsAllScores）なら確定の印を見ずに全行を数える。
  // 戻り値（最初に現れた順）: [{ key, name, isFemale, isNewFace, r1, r2, total, r2Rows, r2Done }]
  //   r1 … 一巡目の行の得点、r2 … 二巡目以降の行の得点（数えるものだけ）、total = r1 + r2
  //   r2Rows … 二巡目以降の行の数、r2Done … r2Rows > 0 かつその行がすべて確定済み
  //   （countAll なら確定済みか採点済み）
  // id や氏名が __proto__ などでも壊れないよう、プロトタイプ無しの辞書を使う。
  function playerTotals(players, opts) {
    var countAll = !!(opts && opts.countAll);
    var list = (players || []).filter(function(p) { return p && typeof p === 'object'; });
    var groups = Object.create(null);
    var byNameSex = Object.create(null);
    var keys = [];
    function nameOf(p) { return String((p && p.name) || '').trim(); }
    function sexKey(p) { return (p.isFemale === true ? '女' : '男') + '|' + nameOf(p); }
    function counts(p) { return p.confirmed === true || countAll; }
    function scoreOf(p) { return (counts(p) && typeof p.score === 'number') ? p.score : 0; }
    function doneOf(p) { return p.confirmed === true || (countAll && isScored(p)); }
    function addTo(key, p, first) {
      if (!groups[key]) {
        groups[key] = { rep: p, r1: 0, r2: 0, r2Rows: 0, r2Pending: 0 };
        keys.push(key);
      }
      var g = groups[key];
      if (first) {
        g.r1 += scoreOf(p);
      } else {
        g.r2 += scoreOf(p);
        g.r2Rows++;
        if (!doneOf(p)) g.r2Pending++;
      }
    }

    var keyOf = new Array(list.length);
    // 1 周目: 一巡目の行が組を作る（二巡目の行が配列の前にあっても代表は一巡目になる）
    list.forEach(function(p, i) {
      if (roundOf(p) !== 1) return;
      var key = (typeof p.id === 'string' && p.id) ? 'id:' + p.id : 'row:' + i;
      keyOf[i] = key;
      addTo(key, p, true);
      var nk = sexKey(p);
      if (!byNameSex[nk]) byNameSex[nk] = key;
    });
    // 2 周目: 二巡目以降の行
    list.forEach(function(p, i) {
      if (roundOf(p) === 1) return;
      var key = (typeof p.sourcePlayerId === 'string' && p.sourcePlayerId) ? 'id:' + p.sourcePlayerId
        : (byNameSex[sexKey(p)] || ('name:' + sexKey(p)));
      keyOf[i] = key;
      addTo(key, p, false);
    });

    var namesByKey = Object.create(null);
    list.forEach(function(p, i) {
      var n = nameOf(p);
      if (n && !namesByKey[keyOf[i]]) namesByKey[keyOf[i]] = n;
    });

    var out = [];
    keys.forEach(function(key) {
      var g = groups[key];
      var name = nameOf(g.rep) || namesByKey[key] || '';
      if (!name) return;
      out.push({
        key: key,
        name: name,
        isFemale: g.rep.isFemale === true,
        isNewFace: g.rep.isNewFace === true,
        r1: g.r1,
        r2: g.r2,
        total: g.r1 + g.r2,
        r2Rows: g.r2Rows,
        r2Done: g.r2Rows > 0 && g.r2Pending === 0
      });
    });
    return out;
  }

  // 合計の降順・同点は氏名順に並べ、同点同順位（1, 1, 3）を付ける（順位の集計と同じ規則）。
  // list の要素は { name, total } を持つ。戻り値は並べた新しい配列で、各要素に rank を足した複製。
  function rankByTotal(list) {
    var current = 1;
    var prevTotal = null;
    return (list || []).slice()
      .sort(function(a, b) { return b.total - a.total || a.name.localeCompare(b.name, 'ja'); })
      .map(function(e, i) {
        if (prevTotal !== null && e.total !== prevTotal) current = i + 1;
        prevTotal = e.total;
        return Object.assign({}, e, { rank: current });
      });
  }

  // 採点画面の選手一覧の「順位」「新人枠」の列（ユーザー要望 2026-10-05）。順位の集計（server の
  // computeRanking）と同じ規則で、一般男子（新人を含む）・一般女子・新人枠の順位を選手ごとに出す。
  // 採点の鍵の端末は順位の API を呼べないので、画面側がこれで計算する。
  //   opts.countAll … playerTotals と同じ（status の無い旧データは全行を数える）
  // 戻り値: { byKey: { <playerTotals の key>: { division, newFace } }, byNameSex: { '男|氏名': 同じ } }
  //   division … 男子なら一般男子、女子なら一般女子の順位（同点同順位。0 点も順位に入る）
  //   newFace  … 新人枠の順位（新人でなければ null）
  function rankMap(players, opts) {
    var totals = playerTotals(players, opts);
    var byKey = Object.create(null);
    var byNameSex = Object.create(null);
    function put(t, field) {
      var e = byKey[t.key] || (byKey[t.key] = { division: null, newFace: null });
      e[field] = t.rank;
      byNameSex[(t.isFemale ? '女' : '男') + '|' + t.name] = e;
    }
    rankByTotal(totals.filter(function(t) { return t.isFemale !== true; })).forEach(function(t) { put(t, 'division'); });
    rankByTotal(totals.filter(function(t) { return t.isFemale === true; })).forEach(function(t) { put(t, 'division'); });
    rankByTotal(totals.filter(function(t) { return t.isNewFace === true; })).forEach(function(t) { put(t, 'newFace'); });
    return { byKey: byKey, byNameSex: byNameSex };
  }

  // ベスト4（結果の見せ場）。一般男子（新人を含む）の合計（一巡目＋確定済みの二巡目）の上位
  // BEST4_COUNT 名。最後の位が同点なら全員。合計 0 点以下は含めない（最終組の選考と同じ規則）。
  // 最終組（一巡目上位 4 名。順番の演出）とは別の概念で、一致しないことがある。
  //   opts.countAll … playerTotals と同じ（旧データ）
  //   opts.status   … 大会の状態。final / archived なら確定扱い（final: true）
  // 戻り値: { final, remaining, rows: [{ name, total, r1, r2, rank }] }
  //   rows      … 順位の一般男子（rankings.male）のうち score > 0 かつ rank <= 4 と同じ行・同じ順位。
  //               r2 は二巡目を終えた人だけ（まだの人は null。total は一巡目だけ）
  //   remaining … 二巡目の行があって確定していない一般男子の人数。二巡目の行が 1 つも無い大会
  //               （一巡目の途中など）は一般男子の全員
  //   final     … status が final / archived、または二巡目の行があって remaining が 0
  //               （false の間は「暫定ベスト4」。画面は final のとき remaining を出さない）
  function best4Standings(players, opts) {
    var totals = playerTotals(players, opts);
    var males = totals.filter(function(t) { return t.isFemale !== true; });
    var hasR2 = (players || []).some(function(p) { return p && typeof p === 'object' && roundOf(p) !== 1; });
    var remaining = hasR2
      ? males.filter(function(t) { return t.r2Rows > 0 && !t.r2Done; }).length
      : males.length;
    var status = opts && opts.status;
    var rows = rankByTotal(males.filter(function(t) { return t.total > 0; }))
      .filter(function(t) { return t.rank <= BEST4_COUNT; })
      .map(function(t) {
        return { name: t.name, total: t.total, r1: t.r1, r2: t.r2Done ? t.r2 : null, rank: t.rank };
      });
    return {
      final: isLocked(status) || (hasR2 && remaining === 0),
      remaining: remaining,
      rows: rows
    };
  }

  // 「次へ進む」の行き先。二巡目 進行中からは、最終組の行があれば最終組へ、
  // 無ければ二巡目終了へ（最終組が 0 名の大会）。
  function nextStep(status, players) {
    if (status === 'round2') return hasFinalists(players) ? 'round2_final' : 'round2_done';
    return next(status);
  }

  // 「次へ進む」ボタンの文言。nextStep と対になる。
  function nextLabel(status, players) {
    // 最終組が無い大会の二巡目は、そのまま「二巡目を終了」（以前は round2_final の文言を借りていたが、
    // 最終組のあとの文言を「最終組を終了」にしたので別に持つ）。
    if (status === 'round2' && !hasFinalists(players)) return ROUND2_END_LABEL;
    var label = NEXT_LABELS[status];
    return label === undefined ? null : label;
  }

  // コート端末で得点を送れる状態か。最終組 進行中も採点できる（最終組の選手だけ。
  // 選手ごとの判定は isPlayerScorable）。
  function isScoringOpen(status) {
    return status === 'round1' || status === 'round2' || status === 'round2_final';
  }

  // 採点の対象になる巡目。進行中でなければ null。最終組は二巡目の一部。
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
  // round2_final は返さない。最終組は運営者が「最終組を開始」を押して入る状態で、
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

  // ---- 二巡目の形の申請（設計書 2026-10-03-round2-forms-prereg-design.md 2 章） ----
  // 一巡目の行に r2tech1〜3 を持たせ、二巡目の行を作るときの形にする。
  // 3 つとも空（キーが無い・空白だけを含む）なら「一巡目と同じ形」。1 つでも入っていれば
  // その行の指定どおり（空の枠は空のまま）。二巡目以降の行は持たない。
  var R2_TECH_KEYS = ['r2tech1', 'r2tech2', 'r2tech3'];
  var TECH_KEYS = ['tech1', 'tech2', 'tech3'];

  function trimmedOf(p, key) {
    var v = p ? p[key] : undefined;
    return typeof v === 'string' ? v.trim() : '';
  }

  // 申請があるか（3 つのうち 1 つでも空白以外が入っているか）
  function hasRound2Techs(p) {
    return R2_TECH_KEYS.some(function(k) { return trimmedOf(p, k) !== ''; });
  }

  // 二巡目の行に入れる形。申請が無ければ一巡目の tech1〜3（文字列でなければ ''。従来の複製と同じく
  // 値はそのまま）、あれば r2tech1〜3 を trim したもの（空の枠は ''）。
  function round2TechsOf(p) {
    if (!hasRound2Techs(p)) {
      return TECH_KEYS.map(function(k) { var v = p ? p[k] : undefined; return typeof v === 'string' ? v : ''; });
    }
    return R2_TECH_KEYS.map(function(k) { return trimmedOf(p, k); });
  }

  // 3 枠の技の並びが同じか（trim 後の文字列で比べる。性別の接尾辞の有無も区別する）。
  function sameTechs(a, b) {
    for (var i = 0; i < 3; i++) {
      var x = (a && typeof a[i] === 'string') ? a[i].trim() : '';
      var y = (b && typeof b[i] === 'string') ? b[i].trim() : '';
      if (x !== y) return false;
    }
    return true;
  }

  function techsOf(p) {
    return TECH_KEYS.map(function(k) { return trimmedOf(p, k); });
  }

  // 保存する申請（2.3 の正規化）。申請が無い、またはその行の tech1〜3 と 3 つとも同じなら null
  // （キーごと持たない）、それ以外は trim した 3 つ（空の枠は ''）。
  function normalizedRound2Techs(p) {
    if (!hasRound2Techs(p)) return null;
    var r2 = R2_TECH_KEYS.map(function(k) { return trimmedOf(p, k); });
    if (sameTechs(r2, techsOf(p))) return null;
    return r2;
  }

  // 一巡目の行を before → after に直したとき、紐づく二巡目の行 row の技を何にするか（2.4・2.5・3.3.1）。
  // 書き写すなら新しい形（3 つの配列）、触らないなら null。サーバの PATCH と画面の確認
  // （Courts.round2LinkedScored）が同じ判定を使う。
  //   r2Sent … この変更で申請（r2tech1〜3 のどれか）を送ったか
  //   ・二巡目の形（round2TechsOf）が変わっていない、または row がもう同じ形 → null
  //   ・申請を直した → 書き写す（row が採点済みかどうかは呼び出し側が見る。409 scored / force）
  //   ・申請は変えず一巡目の形だけ直した → row が未採点で、直す前の二巡目の形と 3 つとも同じなら付いていく
  function round2SyncTarget(before, after, r2Sent, row) {
    var oldT = round2TechsOf(before);
    var newT = round2TechsOf(after);
    if (sameTechs(oldT, newT)) return null;
    var cur = techsOf(row);
    if (sameTechs(cur, newT)) return null;
    if (r2Sent) return newT;
    if (!isScored(row) && sameTechs(cur, oldT)) return newT;
    return null;
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
    ROUND2_END_LABEL: ROUND2_END_LABEL,
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
    FINALIST_DESC: FINALIST_DESC,
    BEST4_COUNT: BEST4_COUNT,
    BEST4_LABEL: BEST4_LABEL,
    BEST4_PROVISIONAL_LABEL: BEST4_PROVISIONAL_LABEL,
    playerTotals: playerTotals,
    best4Standings: best4Standings,
    rankMap: rankMap,
    pickFinalists: pickFinalists,
    round1Sources: round1Sources,
    finalistDiff: finalistDiff,
    isScoringOpen: isScoringOpen,
    scoringRound: scoringRound,
    isLocked: isLocked,
    derive: derive,
    of: of,
    R2_TECH_KEYS: R2_TECH_KEYS,
    hasRound2Techs: hasRound2Techs,
    round2TechsOf: round2TechsOf,
    sameTechs: sameTechs,
    normalizedRound2Techs: normalizedRound2Techs,
    round2SyncTarget: round2SyncTarget,
    // server/index.js が自前実装の代わりに使う。courts.js との一致は
    // test.html の「derive の巡目判定が Courts.roundOf と一致する」で固定する。
    roundOf: roundOf,
    isScored: isScored
  };
});
