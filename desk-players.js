// 選手の区画（#players/<id>）。計画2では読み取り専用の表。
// 編集できる表・行の追加・貼り付けによる一括登録は計画4で作る。
(function() {

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function render(container, ctx) {
    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '選手';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    var count = document.createElement('span');
    count.className = 'desk-head-meta';
    count.textContent = (ctx.players || []).length + ' 名';
    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(count);
    container.appendChild(head);

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'いまは一覧だけです（PC で編集できる表と貼り付けによる一括登録は計画4で作ります）。' +
      '登録・訂正は 📱 でスマホ運営に切り替えて「選手」タブで行ってください。';
    container.appendChild(note);

    var players = ctx.players || [];
    if (players.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいません。';
      container.appendChild(none);
      return;
    }

    var table = document.createElement('table');
    table.className = 'desk-table';
    table.innerHTML =
      '<thead><tr><th>巡</th><th>No.</th><th>名前</th><th>コート</th><th>性別</th>' +
      '<th>新人</th><th>技1</th><th>技2</th><th>技3</th><th>得点</th></tr></thead>';
    var tbody = document.createElement('tbody');
    // 並びは選手タブと同じ既定（巡目 → コート → 性別 → 番号）
    Courts.sortBy(players, Courts.defaultSort()).forEach(function(p) {
      var key = Courts.orderKey(p);
      var tr = document.createElement('tr');
      tr.appendChild(cell(String(Courts.roundOf(p)), 'num'));
      tr.appendChild(cell(String(key.no || ''), 'num'));
      tr.appendChild(cell(p.name || '', 'desk-cell-main'));
      tr.appendChild(cell(Courts.courtOf(p)));
      tr.appendChild(cell(Courts.sexOf(p)));
      tr.appendChild(cell(p.isNewFace ? '○' : ''));
      tr.appendChild(cell(p.tech1 || ''));
      tr.appendChild(cell(p.tech2 || ''));
      tr.appendChild(cell(p.tech3 || ''));
      tr.appendChild(cell(String(p.score || 0), 'num'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  Desk.registerTab('players', { render: render });
})();
