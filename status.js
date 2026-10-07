// 大会の状態（準備中 → 一巡目 → … → アーカイブ）。
// サーバー（server/index.js の require）とブラウザ（<script src="status.js">）の
// 両方から読むので、リポジトリ直下に置いて UMD 風の包みにする。
// 判定をここ1箇所にまとめ、画面・API・テストで同じ関数を使う。
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventStatus = factory();
})(this, function() {

  // 7 状態（設計書 2026-10-05 2.1。旧データの状態名は normalizeStatus で今の状態名に読む）。
  var STATES = ['draft', 'round1', 'round1_done', 'round2', 'round2_done', 'final', 'archived'];

  var LABELS = {
    draft: '準備中',
    round1: '一巡目 進行中',
    // 一巡目を終了した直後の段階。二巡目の行はサーバーが作り終えているので、
    // 運営者がここでやるのは「自己申告があった選手の形を直す」こと（設計書 2026-09-22）。
    round1_done: '二巡目準備（形の登録）',
    round2: '二巡目 進行中',
    round2_done: '二巡目終了',
    final: '最終結果',
    archived: 'アーカイブ'
  };

  // 「次へ進む」ボタンの文言。archived から進む先は無い。
  // 二巡目終了からは「結果を確定して表彰へ」（2026-10-04 試合進行の二巡目以降の見直し。
  // 状態名 round2_done の「二巡目終了」は変えない）。
  var NEXT_LABELS = {
    draft: '試合開始',
    round1: '一巡目を終了',
    round1_done: '二巡目を開始',
    round2: '二巡目を終了',
    round2_done: '結果を確定して表彰へ',
    final: 'アーカイブ',
    archived: null
  };
  // 二巡目 進行中から二巡目終了へ進むボタンの文言。NEXT_LABELS.round2 と同じ値（互換のため残す）。
  var ROUND2_END_LABEL = NEXT_LABELS.round2;

  // 旧データの状態名を今の状態名に読み替える表（設計書 2026-10-05 2.2。ファイルは書き換えない）。
  var LEGACY_STATUS = { round2_final: 'round2' };

  // ファイルの status を今の状態名に直す。知らない値はそのまま返す（of が STATES で弾く）。
  function normalizeStatus(s) {
    return (typeof s === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_STATUS, s)) ? LEGACY_STATUS[s] : s;
  }

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
  var ORDER_PATTERN = /^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/;

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
  // final からは二巡目に採点済みか確定済みの行があれば round2_done、無ければ round1_done。
  // 一巡目の終了で二巡目の行は必ず作られるので、行があるかどうかでは「二巡目を行わず
  // 最終結果へ」の後の「戻す」が二巡目終了に行ってしまう（網羅検証 S11。2026-10-01）。
  // round2_done からは round2（設計書 2026-10-05 2.1）。
  function prev(status, players) {
    if (status === 'final') {
      var played = rowsOfRound(players, 2).some(function(p) {
        return isScored(p) || (p && p.confirmed === true);
      });
      return played ? 'round2_done' : 'round1_done';
    }
    var i = STATES.indexOf(status);
    if (i <= 0) return null;
    return STATES[i - 1];
  }

  // その行を今の状態で採点してよいか（サーバの not_scorable の判定。設計書 2026-10-01 1.2）。
  // 状態が採点できること（isScoringOpen）、player があること、行の巡目がその状態の巡目であること
  // （一巡目終了の後に一巡目の行の得点が届いても受け付けない）の3つ（設計書 2026-10-05 2.1）。
  // 採点画面の「この選手を採点できるか」もこれに寄せてよい。
  function isRowScorable(status, player) {
    if (!isScoringOpen(status)) return false;
    if (!player) return false;
    return roundOf(player) === scoringRound(status);
  }

  // 選手の行の版（設計書 2026-10-01 1.1）。無い・壊れた値は 0（旧データ・新規作成の行）。
  function revOf(player) {
    var v = player && player.rev;
    return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0) ? v : 0;
  }

  // 確定済みの行の得点（未確定は 0。順位と同じ基準）。サーバの二巡目の並び（一巡目の確定得点の低い順）が使う。
  function confirmedScoreOf(p) {
    return (p && p.confirmed === true && typeof p.score === 'number') ? p.score : 0;
  }

  // ベスト4（合計の一般男子上位 4 名。結果の見せ場）の人数と呼び名。
  var BEST4_COUNT = 4;
  var BEST4_LABEL = 'ベスト' + BEST4_COUNT;
  var BEST4_PROVISIONAL_LABEL = '暫定ベスト' + BEST4_COUNT;

  // ---- 合計・順位・ベスト4（設計書 2026-10-04 2.2・2.3、2026-10-05 2.3） ----

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
  // 戻り値（最初に現れた順）: [{ key, name, isFemale, isNewFace, r1, r2, total, r2Rows, r2Done, counted }]
  //   r1 … 一巡目の行の得点、r2 … 二巡目以降の行の得点（数えるものだけ）、total = r1 + r2
  //   r2Rows … 二巡目以降の行の数、r2Done … r2Rows > 0 かつその行がすべて確定済み
  //   （countAll なら確定済みか採点済み）
  //   counted … その組に「数えた行」が 1 つ以上ある（確定済みの行。countAll なら採点済みの行。
  //   採点画面の順位表は counted の組だけを出す。設計書 2026-10-05 2.3）
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
        groups[key] = { rep: p, r1: 0, r2: 0, r2Rows: 0, r2Pending: 0, counted: false };
        keys.push(key);
      }
      var g = groups[key];
      if (doneOf(p)) g.counted = true;
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
        r2Done: g.r2Rows > 0 && g.r2Pending === 0,
        counted: g.counted
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

  // 3 部門の順位（設計書 2026-10-05 2.3）。順位の集計（server の computeRanking）と採点画面の
  // 順位表（Courts.rankPanel）が同じこの関数を使う。採点の鍵の端末は順位の API を呼べないので、
  // 画面側もこれで計算する。
  //   opts.countAll … playerTotals と同じ（status の無い旧データは全行を数える）
  // 戻り値: { male: [...], female: [...], newFace: [...] }、各要素は { key, rank, name, score, counted }
  //   male    … isFemale が true でない組（新人を含む）
  //   female  … isFemale が true の組
  //   newFace … isNewFace が true の組（男女混合）
  //   並びと順位は rankByTotal（合計の降順・同点は氏名順・同点同順位 1, 1, 3。0 点も順位に入る）
  //   key / counted は playerTotals のもの（共有リンクには出さない。サーバーが落とす）
  // 順位表の見出しに添える「〜巡目 済み/全員」（ユーザー要望 2026-10-05）。
  // 巡目は進行中（round1 / round2）ならその巡目、そうでなければ行のある最大の巡目（無ければ 1）。
  // 済み = その巡目の行のうち確定済み（confirmed）の数、全員 = その巡目の行の数。部門の分け方は rankings と同じ
  // （一般男子は新人を含む）。label は「一巡目 12/17」の形（ranking.html はこれをそのまま出す）。
  var ROUND_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function roundLabel(round) {
    return (ROUND_KANJI[round - 1] || String(round)) + '巡目';
  }
  function roundProgress(players, status) {
    var list = (Array.isArray(players) ? players : []).filter(function(p) { return p && typeof p === 'object'; });
    var round = scoringRound(status);
    if (!round) {
      round = 1;
      list.forEach(function(p) { round = Math.max(round, roundOf(p)); });
    }
    function count(filter) {
      var rows = list.filter(function(p) { return roundOf(p) === round && filter(p); });
      var done = rows.filter(function(p) { return p.confirmed === true; }).length;
      return { round: round, done: done, total: rows.length, label: roundLabel(round) + ' ' + done + '/' + rows.length };
    }
    return {
      male: count(function(p) { return p.isFemale !== true; }),
      female: count(function(p) { return p.isFemale === true; }),
      newFace: count(function(p) { return p.isNewFace === true; })
    };
  }

  function rankings(players, opts) {
    var totals = playerTotals(players, opts);
    function rank(list) {
      return rankByTotal(list).map(function(t) {
        return { key: t.key, rank: t.rank, name: t.name, score: t.total, counted: t.counted };
      });
    }
    return {
      male: rank(totals.filter(function(t) { return t.isFemale !== true; })),
      female: rank(totals.filter(function(t) { return t.isFemale === true; })),
      newFace: rank(totals.filter(function(t) { return t.isNewFace === true; }))
    };
  }

  // ベスト4（結果の見せ場）。一般男子（新人を含む）の合計（一巡目＋確定済みの二巡目）の上位
  // BEST4_COUNT 名。最後の位が同点なら全員。合計 0 点以下は含めない。
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

  // ベスト4 に残れる可能性（部門ごと: 一般男子・一般女子・新人枠。二巡目の順位表に出す。ユーザー要望 2026-10-05）。
  //   opts.maxExtraOf(player) … 未確定の二巡目の行が全部成功したときに加わる最大の得点（技の満点の合計）。
  //                            技の解決は呼ぶ側（画面は Courts.maxExtraOf、サーバーは自前の resolveTechnique）
  //   opts.countAll … playerTotals と同じ
  // 部門の中でそれぞれについて cur（確定済みの合計）と max（cur ＋ 未確定の二巡目の満点）を出し、
  //   sure     … 自分の cur を上回れる相手（max_j > cur_i）が 3 人以下 → 何があってもベスト4（同点は同順位で全員入る）
  //   possible … 自分の max を既に上回っている相手（cur_j > max_i）が 3 人以下 → 残れる可能性あり
  //   out      … それ以外 → 圏外
  // 二巡目の行が 1 つも無ければ null（一巡目の間は出さない）。
  // 戻り値: { male, female, newFace }、各 { remaining, byKey: { <playerTotals の key>: { cur, max, flag, pending, label } } }
  //   label は記号だけ（◎ ○ ✕）。凡例の文言は BEST4_FLAG_TEXT
  var BEST4_FLAGS = { sure: '確', possible: '可', out: '-' };   // 確定・可能性あり・圏外（ユーザー要望 2026-10-06）
  var BEST4_FLAG_TEXT = { sure: '確定（残りの全員が全部成功しても 4 位以内）', possible: '可能性あり（自分の残りが全部成功すれば 4 位以内）', out: '圏外' };
  function best4Chances(players, opts) {
    var list = (players || []).filter(function(p) { return p && typeof p === 'object'; });
    if (!list.some(function(p) { return roundOf(p) !== 1; })) return null;
    var all = playerTotals(list, opts);
    return {
      male: best4ChancesOf(list, all.filter(function(t) { return t.isFemale !== true; }), opts),
      female: best4ChancesOf(list, all.filter(function(t) { return t.isFemale === true; }), opts),
      newFace: best4ChancesOf(list, all.filter(function(t) { return t.isNewFace === true; }), opts)
    };
  }
  function best4ChancesOf(list, totals, opts) {
    var maxExtraOf = (opts && typeof opts.maxExtraOf === 'function') ? opts.maxExtraOf : function() { return 0; };
    // 未確定の二巡目の行の満点を組（key）ごとに足す
    var extra = Object.create(null);
    list.forEach(function(p) {
      if (roundOf(p) === 1 || p.confirmed === true) return;
      var key = (typeof p.sourcePlayerId === 'string' && p.sourcePlayerId) ? 'id:' + p.sourcePlayerId : null;
      if (!key) return;
      var v = Number(maxExtraOf(p)) || 0;
      extra[key] = (extra[key] || 0) + (v > 0 ? v : 0);
    });
    var rows = totals.map(function(t) {
      var pending = t.r2Rows > 0 && !t.r2Done;
      return { key: t.key, cur: t.total, max: t.total + (pending ? (extra[t.key] || 0) : 0), pending: pending };
    });
    var byKey = Object.create(null);
    rows.forEach(function(r) {
      var canBeat = 0, alreadyAbove = 0;
      rows.forEach(function(o) {
        if (o === r) return;
        if (o.max > r.cur) canBeat++;
        if (o.cur > r.max) alreadyAbove++;
      });
      var flag = canBeat <= BEST4_COUNT - 1 ? 'sure' : (alreadyAbove <= BEST4_COUNT - 1 ? 'possible' : 'out');
      byKey[r.key] = { cur: r.cur, max: r.max, pending: r.pending, flag: flag, label: BEST4_FLAGS[flag] };
    });
    return { remaining: rows.filter(function(r) { return r.pending; }).length, byKey: byKey };
  }

  // 「次へ進む」の行き先。next と同じ（players は受けるが使わない。呼び出し側を変えずに済ませる。
  // 設計書 2026-10-05 2.1）。
  function nextStep(status, players) {
    return next(status);
  }

  // 「次へ進む」ボタンの文言。nextStep と対になる（players は使わない）。
  function nextLabel(status, players) {
    var label = Object.prototype.hasOwnProperty.call(NEXT_LABELS, status) ? NEXT_LABELS[status] : undefined;
    return label === undefined ? null : label;
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

  // 大会の状態。ファイルの status（旧データの状態名は normalizeStatus で読み替える）が有効ならそれ、
  // 無ければ推定値。
  function of(event) {
    var s = event ? normalizeStatus(event.status) : undefined;
    if (STATES.indexOf(s) !== -1) return s;
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
    normalizeStatus: normalizeStatus,
    normalizeRank: normalizeRank,
    isRowScorable: isRowScorable,
    revOf: revOf,
    confirmedScoreOf: confirmedScoreOf,
    BEST4_COUNT: BEST4_COUNT,
    BEST4_LABEL: BEST4_LABEL,
    BEST4_PROVISIONAL_LABEL: BEST4_PROVISIONAL_LABEL,
    playerTotals: playerTotals,
    best4Standings: best4Standings,
    rankings: rankings,
    roundProgress: roundProgress,
    best4Chances: best4Chances,
    BEST4_FLAGS: BEST4_FLAGS,
    BEST4_FLAG_TEXT: BEST4_FLAG_TEXT,
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
