// 選手データからコートを導出する純粋関数群
// order は "A-男子-1-1"（コート-性別-巡目-番号）形式で、先頭セグメントがコート。
var Courts = (function() {
  var UNASSIGNED = '未分類';

  // 選手のコート名を返す。判定できない場合は UNASSIGNED。
  function courtOf(player) {
    var order = (player && player.order) || '';
    var m = order.match(/^([^-]+)/);
    return m ? m[1] : UNASSIGNED;
  }

  // 選手一覧から一意なコート名を昇順で返す。UNASSIGNED は末尾に置く。
  function listFrom(players) {
    var seen = {};
    var list = [];
    var hasUnassigned = false;
    (players || []).forEach(function(p) {
      var c = courtOf(p);
      if (c === UNASSIGNED) { hasUnassigned = true; return; }
      if (!seen[c]) { seen[c] = true; list.push(c); }
    });
    list.sort();
    if (hasUnassigned) list.push(UNASSIGNED);
    return list;
  }

  // 指定コートの選手だけを返す。court が空文字なら全件。
  function filter(players, court) {
    if (!court) return (players || []).slice();
    return (players || []).filter(function(p) { return courtOf(p) === court; });
  }

  // 巡目（order の第3セグメント）。解析できなければ 1（一巡目）とみなす。
  // 巡目は order からいつでも導出できるので、選手データには持たせない。
  // サーバー側の同じ実装は server/index.js の roundOf。
  // クライアント側は test.html の roundOf テスト、サーバー側は createPlayer / generateNextRound の API テストで固定する。
  function roundOf(player) {
    var order = (player && typeof player.order === 'string') ? player.order : '';
    var m = order.match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    return m ? parseInt(m[3], 10) : 1;
  }

  // 採点済みの判定。server/index.js の isScored と同じ規則。
  // サーバー側は API テスト、クライアント側は下の test.html で固定する。
  // 太刀の ○× のほか、補正点（技ごと・全体）が 0 以外なら採点済みとみなす
  // （負の補正で score が 0 以下になっても拾えるように、score > 0 だけに頼らない）。
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

  // 行の並び順。order 文字列をそのまま比較すると 1-10 が 1-2 より前に来るので、
  // 巡目 → コート → 性別（男子が先）→ 番号 に分解して比べる。
  // admin-players.js（選手タブ）と admin-round.js（進行タブ）で共有する。
  function orderKey(p) {
    var m = String((p && p.order) || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    if (!m) return { court: courtOf(p), sex: 2, round: roundOf(p), no: 0 };
    return {
      court: m[1],
      sex: m[2] === '男子' ? 0 : 1,
      round: parseInt(m[3], 10),
      no: parseInt(m[4], 10)
    };
  }

  function compareOrder(a, b) {
    var x = orderKey(a), y = orderKey(b);
    if (x.round !== y.round) return x.round - y.round;
    if (x.court !== y.court) return x.court < y.court ? -1 : 1;
    if (x.sex !== y.sex) return x.sex - y.sex;
    return x.no - y.no;
  }

  // ---- 選手タブの絞り込み・並べ替え（admin-players.js から使う純粋関数） ----

  // 名前検索の正規化。前後の空白と全角・半角スペースを取り除き、大文字小文字を同一視する
  // （「箕輪 憲人」を「箕輪憲人」でも当てる）。
  function normalizeName(s) {
    return String(s == null ? '' : s).replace(/[\s　]+/g, '').toLowerCase();
  }

  // 技が 3 枠とも空か（空白だけも空とみなす）。受付で技の入力漏れを探すのに使う。
  function hasNoTech(p) {
    if (!p) return true;
    return !(String(p.tech1 || '').trim() || String(p.tech2 || '').trim() || String(p.tech3 || '').trim());
  }

  // 性別（'男子' | '女子'）。order の第 2 セグメントを優先し、解析できなければ isFemale で補う
  // （選手データは両方を持っているが、採番の元になる order を正とする）。
  function sexOf(p) {
    var m = String((p && p.order) || '').match(/^[^-]+-(男子|女子)-/);
    if (m) return m[1];
    return (p && p.isFemale) ? '女子' : '男子';
  }

  // 選手にある巡目の一意な値を昇順で（巡目の絞り込みチップの候補）。
  function roundsOf(players) {
    var seen = {};
    var list = [];
    (players || []).forEach(function(p) {
      var r = roundOf(p);
      if (!seen[r]) { seen[r] = true; list.push(r); }
    });
    return list.sort(function(a, b) { return a - b; });
  }

  // 絞り込み条件の既定値。court '' は全コート、sex '' は男女、round 0 は全巡。
  function defaultFilter() {
    return { court: '', sex: '', round: 0, newFace: false, noTech: false, query: '' };
  }

  // 絞り込み。すべての条件を AND で適用し、新しい配列を返す。
  function applyFilter(players, f) {
    f = f || defaultFilter();
    var q = normalizeName(f.query);
    return (players || []).filter(function(p) {
      if (f.court && courtOf(p) !== f.court) return false;
      if (f.sex && sexOf(p) !== f.sex) return false;
      if (f.round && roundOf(p) !== f.round) return false;
      if (f.newFace && !p.isNewFace) return false;
      if (f.noTech && !hasNoTech(p)) return false;
      if (q && normalizeName(p.name).indexOf(q) === -1) return false;
      return true;
    });
  }

  // 二巡目生成 API の 409 応答（reason: 'unscored' | 'exists'）を確認文言にする。
  // 採点画面（app.js）と運営画面（admin-round.js）で同じ文言を使う。
  // fixHint: コート未設定の選手をどこで直すかの案内（画面ごとに違う）
  function nextRoundConflictMessage(result, fixHint) {
    var extra = '';
    // exists 分岐は本文で既に既存件数を述べているので、ここで足すのは unscored のときだけ
    if (result.reason === 'unscored' && result.existingCount > 0) {
      extra += '\n※二巡目は既に ' + result.existingCount + ' 名分あります。未生成の選手がいれば差分だけ追加します。';
    }
    if (result.untrackedCount > 0) {
      extra += '\n※CSV で作った二巡目の行が ' + result.untrackedCount + ' 件あります。続けると重複します。';
    }
    if (result.unassignedCount > 0) {
      extra += '\n※コートが決まっていない選手が ' + result.unassignedCount + ' 名います（二巡目を作れません。' + fixHint + '）。';
    }
    if (result.reason === 'unscored') {
      return '未採点が' + result.unscoredCount + '名います。\n' +
             'このまま生成すると、あとから入る一巡目の得点は二巡目の並び順に反映されません。\n' +
             '生成しますか？' + extra;
    }
    return '二巡目は生成済みです（' + result.existingCount + '名）。\n' +
           '未生成の選手がいれば差分だけ追加しますか？' + extra;
  }

  // 二巡目生成 API の成功応答を結果文言にする（採点画面と運営画面で共有）。
  function nextRoundResultMessage(result) {
    var created = result.created || 0;
    var note = result.unassignedCount > 0
      ? '（コート未設定の ' + result.unassignedCount + ' 名は作っていません）' : '';
    if (created === 0) {
      return '追加する選手はいませんでした（二巡目は ' + result.existingCount + ' 名分のまま）' + note;
    }
    return '二巡目を生成しました（' + created + '名）' + note;
  }

  return {
    UNASSIGNED: UNASSIGNED,
    courtOf: courtOf,
    listFrom: listFrom,
    filter: filter,
    roundOf: roundOf,
    isScored: isScored,
    compareOrder: compareOrder,
    orderKey: orderKey,
    normalizeName: normalizeName,
    hasNoTech: hasNoTech,
    sexOf: sexOf,
    roundsOf: roundsOf,
    defaultFilter: defaultFilter,
    applyFilter: applyFilter,
    nextRoundConflictMessage: nextRoundConflictMessage,
    nextRoundResultMessage: nextRoundResultMessage
  };
})();
