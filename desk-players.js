// 選手の区画（#players/<id>）。計画2では読み取り専用の表（Task 12）、
// 編集できる表と貼り付けによる一括登録は計画4で作る。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '選手の表はこのあとのタスクで実装します。';
    container.appendChild(p);
  }

  Desk.registerTab('players', { render: render });
})();
