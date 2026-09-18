// 大会一覧の区画（#events）。一覧の表・新規作成・コピー・取り込み・アーカイブ・削除。
// 中身は計画2の Task 7 / Task 8 で入れる。
(function() {
  function render(container, ctx) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'desk-empty';
    p.textContent = '大会一覧はこのあとのタスクで実装します。';
    container.appendChild(p);
  }

  Desk.registerTab('events', { render: render });
})();
