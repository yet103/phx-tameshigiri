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

  return {
    UNASSIGNED: UNASSIGNED,
    courtOf: courtOf,
    listFrom: listFrom,
    filter: filter
  };
})();
