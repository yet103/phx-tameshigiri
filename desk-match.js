// 試合の区画（#match/<id>）。コート別の状況・採点画面を開く・二巡目の生成と技入力。
// 中身は計画5で作る。それまではスマホ運営の「進行」タブを使う。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '試合の進行は計画5で実装します。いまは 📱 でスマホ運営に切り替えて「進行」タブをお使いください。';
    container.appendChild(p);
  }

  Desk.registerTab('match', { render: render });
})();
