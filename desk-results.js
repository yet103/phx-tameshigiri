// 結果の区画（#results/<id>）。順位・発表モード・共有リンク・配信ボード。
// 中身は計画5で作る。それまではスマホ運営の「結果」タブを使う。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '結果は計画5で実装します。いまは 📱 でスマホ運営に切り替えて「結果」タブをお使いください。';
    container.appendChild(p);
  }

  Desk.registerTab('results', { render: render });
})();
