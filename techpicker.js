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
    if (!name) return list;   // 空チップ（＋）のタップは選択ではない
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
    var src = Array.isArray(names) ? names : [];
    var out = [];
    src.forEach(function(n) {
      if (n) out.push(n);
    });
    return out.slice(0, MAX);
  }

  // --- 表示ヘルパ ---

  // 配点の表示。null（打てない太刀）は飛ばして '/' でつなぐ。例: 四方 → '17/5/7/3'
  function strikesLabel(tech) {
    var s = (tech && tech.strikes) || [];
    var parts = [];
    for (var i = 0; i < s.length; i++) {
      if (s[i] !== null && s[i] !== undefined) parts.push(String(s[i]));
    }
    return parts.join('/');
  }

  // --- DOM ---

  // 開いているシート。多重に開かないよう1枚だけ持つ。
  var openSheet = null;

  // 開いているシートの done。再入時にこれを呼んで前のシートを片付ける
  // （開いたまま別の行のシートを開かれたとき、前のシートの選択を捨てない）。
  var pendingDone = null;

  function closeSheet() {
    if (openSheet && openSheet.parentNode) openSheet.parentNode.removeChild(openSheet);
    openSheet = null;
  }

  // ハッシュ遷移などで強制的に片付けるとき。onClose は呼ばない
  // （呼ぶと古い ctx を使う保存が走ってしまう）。
  function dismiss() {
    pendingDone = null;
    closeSheet();
  }

  // ①②③ のチップを el に描く。空きの枠は「＋」。
  // 空きを赤くしたい画面（計画3の進行タブ）は el に class="chips-required" を付ける。
  function renderChips(el, state, onTap) {
    el.innerHTML = '';
    var arr = toArray(state);
    for (var i = 0; i < MAX; i++) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = arr[i] ? 'chip' : 'chip empty';
      chip.textContent = CIRCLED[i] + ' ' + (arr[i] || '＋');
      chip.dataset.name = arr[i] || '';
      chip.addEventListener('click', function() {
        if (onTap) onTap(this.dataset.name);
      });
      el.appendChild(chip);
    }
  }

  // 下部シートを開く。
  // options = { techniques, initial, onChange, onClose }
  //   techniques : Api.loadTechniques() の techniques 配列
  //   initial    : 選択済みの state（配列）
  //   onChange   : 1タップごとに新しい state を受け取る
  //   onClose    : 閉じたときに最終的な state を受け取る
  function open(options) {
    // 開いたまま別の行のシートを開かれたとき、前のシートの選択を捨てない
    // （closeSheet だけだと前のシートの onClose が呼ばれず、選択が消える）。
    if (pendingDone) pendingDone();
    var opts = options || {};
    var state = (opts.initial || []).slice();
    var techs = opts.techniques || [];

    var overlay = document.createElement('div');
    overlay.className = 'tp-overlay';
    var sheet = document.createElement('div');
    sheet.className = 'tp-sheet';

    var head = document.createElement('div');
    head.className = 'tp-head';
    var title = document.createElement('span');
    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'tp-close';
    btnClose.textContent = '完了';
    head.appendChild(title);
    head.appendChild(btnClose);

    var list = document.createElement('div');
    list.className = 'tp-list';

    // 選択順の番号と選択中の見た目を付け直す
    function refresh() {
      title.textContent = state.length < MAX
        ? '技を選ぶ — ' + (state.length + 1) + 'つ目'
        : '技を選ぶ — 3つ選択済み';
      var rows = list.querySelectorAll('.tp-item');
      for (var i = 0; i < rows.length; i++) {
        var pos = state.indexOf(rows[i].dataset.name);
        rows[i].className = pos >= 0 ? 'tp-item on' : 'tp-item';
        rows[i].querySelector('.tp-no').textContent = pos >= 0 ? CIRCLED[pos] : '';
      }
    }

    techs.forEach(function(t) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'tp-item';
      item.dataset.name = t.name;
      // 枠だけ innerHTML で作り、値は textContent で入れる（技名はサーバー由来）
      item.innerHTML = '<span class="tp-no"></span><span class="tp-name"></span><span class="tp-pt"></span>';
      item.querySelector('.tp-name').textContent = t.name;
      item.querySelector('.tp-pt').textContent = strikesLabel(t);
      item.addEventListener('click', function() {
        state = select(state, this.dataset.name);
        refresh();
        if (opts.onChange) opts.onChange(state.slice());
      });
      list.appendChild(item);
    });

    sheet.appendChild(head);
    sheet.appendChild(list);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    openSheet = overlay;
    refresh();

    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      pendingDone = null;
      closeSheet();
      if (opts.onClose) opts.onClose(state.slice());
    }
    pendingDone = done;
    btnClose.addEventListener('click', done);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) done();   // シートの外側をタップしたら閉じる
    });
  }

  return {
    select: select,
    toArray: toArray,
    fromArray: fromArray,
    strikesLabel: strikesLabel,
    open: open,
    dismiss: dismiss,
    renderChips: renderChips
  };
})();
