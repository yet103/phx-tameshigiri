// 技の選択（常に3枠・枠ごとに選び直せる）と、その選択 UI。
// 選択状態は純粋関数だけで扱い、DOM を触る関数（open / renderChips）と分けてある。
// 将来「選手が自分のスマホで技を申告する」画面にそのまま流用するため。
var TechPicker = (function() {
  var MAX = 3;
  var CIRCLED = ['①', '②', '③'];

  // --- 純粋関数 ---

  // ['技1', '技2', '技3']。未選択の枠は ''。穴は詰めない（常に3要素）。
  function toArray(state) {
    var list = Array.isArray(state) ? state : [];
    var out = [];
    for (var i = 0; i < MAX; i++) {
      // 呼び出し元の state に文字列でない要素が混ざっていても、この配列から
      // 先の DOM 描画・PATCH 送信に非文字列が漏れないよう文字列化しておく。
      out.push(String(list[i] || ''));
    }
    return out;
  }

  // 選手の tech1..3 から state を作る。toArray と同じ形（穴は詰めない）。
  function fromArray(names) {
    return toArray(names);
  }

  // index 番目の枠を name に差し替える。name が '' ならその枠を空にする。
  // index が 0..2 以外なら state をそのまま複製して返す（変更しない）。
  // 常に新しい3要素配列を返す。呼び出し元の state は壊さない。同じ技を複数の枠に入れてよい。
  function setSlot(state, index, name) {
    var arr = toArray(state);
    if (index !== 0 && index !== 1 && index !== 2) return arr;
    arr[index] = name || '';
    return arr;
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

  // 検索用の正規化。全角英数→半角（NFKC）、小文字化、前後の空白除去。
  function normalizeQuery(s) {
    var t = String(s || '');
    try { t = t.normalize('NFKC'); } catch (e) {}
    return t.toLowerCase().trim();
  }

  // 技名の部分一致で絞り込む。query が空なら全件（複製）。
  function filter(techs, query) {
    var list = Array.isArray(techs) ? techs : [];
    var q = normalizeQuery(query);
    if (!q) return list.slice();
    return list.filter(function(t) {
      return normalizeQuery(t && t.name).indexOf(q) !== -1;
    });
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
      chip.dataset.slot = i;
      chip.dataset.name = arr[i] || '';
      chip.addEventListener('click', function(ev) {
        // チップのタップは枠が決まっているので、行全体のタップ（別の枠が開く）に伝播させない
        ev.stopPropagation();
        if (onTap) onTap(Number(this.dataset.slot), this.dataset.name);
      });
      el.appendChild(chip);
    }
  }

  // 下部シートを開く。常に「1つの枠」を編集するモード（枠は options.slot）。
  // options = { techniques, initial, slot, onChange, onClose }
  //   techniques : Api.loadTechniques() の techniques 配列
  //   initial    : 選択済みの state（3要素配列。穴は ''）
  //   slot       : 編集する枠（0..2）
  //   onChange   : タップで新しい state を受け取る（選ぶ／空にする、どちらでも呼ぶ）
  //   onClose    : 閉じたときに最終的な state を受け取る
  function open(options) {
    // 開いたまま別の行のシートを開かれたとき、前のシートの選択を捨てない
    // （closeSheet だけだと前のシートの onClose が呼ばれず、選択が消える）。
    if (pendingDone) pendingDone();
    var opts = options || {};
    // slot が 0/1/2 以外（省略・null など）なら①にフォールバックする
    // （admin-round.js の「行タップで空いている最初の枠、全部埋まっていたら①」と同じ規則）。
    // これをしないとタイトルが「NaNつ目」になり、setSlot が範囲外として選択を捨て続ける。
    var slot = (opts.slot === 0 || opts.slot === 1 || opts.slot === 2) ? opts.slot : 0;
    var state = toArray(opts.initial);
    var techs = opts.techniques || [];

    var overlay = document.createElement('div');
    overlay.className = 'tp-overlay';
    var sheet = document.createElement('div');
    sheet.className = 'tp-sheet';

    var head = document.createElement('div');
    head.className = 'tp-head';
    var title = document.createElement('span');
    title.textContent = (slot + 1) + 'つ目の技を選ぶ';
    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'tp-close';
    btnClose.textContent = '閉じる';   // 選ぶと自分で閉じるので、これは「何も選ばずに閉じる」用
    head.appendChild(title);
    head.appendChild(btnClose);

    var list = document.createElement('div');
    list.className = 'tp-list';

    // この枠の選択を確定して閉じる。選ぶのも空にするのも1タップで終わる
    // （多枠選択だった頃と違い、この枠以外の状態には触れない）。
    function pick(name) {
      state = setSlot(state, slot, name);
      if (opts.onChange) opts.onChange(state.slice());
      done();
    }

    var clearItem = document.createElement('button');
    clearItem.type = 'button';
    clearItem.className = 'tp-item tp-clear';
    clearItem.textContent = '（この枠を空にする）';
    clearItem.addEventListener('click', function() { pick(''); });
    list.appendChild(clearItem);

    techs.forEach(function(t) {
      var item = document.createElement('button');
      item.type = 'button';
      // 重複を許すので、印を付けるのはこの枠に入っている技だけ（他の枠は見ない）
      var isOn = state[slot] !== '' && state[slot] === t.name;
      item.className = isOn ? 'tp-item on' : 'tp-item';
      item.dataset.name = t.name;
      // 枠だけ innerHTML で作り、値は textContent で入れる（技名はサーバー由来）
      item.innerHTML = '<span class="tp-no"></span><span class="tp-name"></span><span class="tp-pt"></span>';
      item.querySelector('.tp-no').textContent = isOn ? CIRCLED[slot] : '';
      item.querySelector('.tp-name').textContent = t.name;
      item.querySelector('.tp-pt').textContent = strikesLabel(t);
      item.addEventListener('click', function() { pick(this.dataset.name); });
      list.appendChild(item);
    });

    sheet.appendChild(head);
    sheet.appendChild(list);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    openSheet = overlay;

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
    setSlot: setSlot,
    toArray: toArray,
    fromArray: fromArray,
    strikesLabel: strikesLabel,
    filter: filter,
    open: open,
    dismiss: dismiss,
    renderChips: renderChips
  };
})();
