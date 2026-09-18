// 技と配点の区画（#techniques/<id>）。techedit.js を埋め込む。
// 中身は計画2の Task 11 で入れる。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '技と配点はこのあとのタスクで実装します。';
    container.appendChild(p);
  }

  Desk.registerTab('techniques', { render: render });
})();
