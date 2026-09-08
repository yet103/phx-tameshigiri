// 技の選択（最大3・順序つき）と、その選択 UI。
// 選択状態は純粋関数だけで扱い、DOM を触る関数（open / renderChips）と分けてある。
// 将来「選手が自分のスマホで技を申告する」画面にそのまま流用するため。
var TechPicker = (function() {
  var MAX = 3;
  var CIRCLED = ['①', '②', '③'];

  // --- 純粋関数 ---

  // 未選択なら末尾に追加（最大3。4つ目は無視する）。
  // 選択済みの技を渡すとそれを外し、後ろを詰める（②を外せば③が②になる）。
  // 常に新しい配列を返す。呼び出し元の state は壊さない。
  function select(state, name) {
    var list = (state || []).slice();
    var i = list.indexOf(name);
    if (i >= 0) {
      list.splice(i, 1);
      return list;
    }
    if (list.length >= MAX) return list;
    list.push(name);
    return list;
  }

  // ['技1', '技2', '技3']。未選択の枠は ''。
  function toArray(state) {
    var list = state || [];
    var out = [];
    for (var i = 0; i < MAX; i++) {
      out.push(list[i] || '');
    }
    return out;
  }

  // ['a', '', 'c'] → ['a', 'c']。空の枠を落として詰める。
  function fromArray(names) {
    var out = [];
    (names || []).forEach(function(n) {
      if (n) out.push(n);
    });
    return out.slice(0, MAX);
  }

  return {
    select: select,
    toArray: toArray,
    fromArray: fromArray
  };
})();
