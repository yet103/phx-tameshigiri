// 基本情報の区画（#setup/<id>）。大会名・日付・会場とコートの一覧。
// 中身は計画2の Task 9 で入れる。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '基本情報はこのあとのタスクで実装します。';
    container.appendChild(p);
  }

  Desk.registerTab('setup', { render: render });
})();
