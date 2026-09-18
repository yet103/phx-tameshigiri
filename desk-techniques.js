// 技と配点の区画（#techniques/<id>）。techedit.js（技術リスト編集ページと共通）を埋め込む。
// 「別の大会からコピー」の候補にするため、描く前に大会一覧を取りに行く。
// 確定済み（final / archived）の大会では編集を無効にする（サーバーも 409 で拒む）。
(function() {
  var handle = null;

  async function render(container, ctx) {
    container.innerHTML = '';

    var box = document.createElement('div');
    container.appendChild(box);

    var loading = document.createElement('p');
    loading.className = 'desk-empty';
    loading.textContent = '読み込み中…';
    box.appendChild(loading);

    var events = await Api.listEvents();
    if (ctx.isStale()) return;   // 待っている間に区画を切り替えられた
    box.innerHTML = '';

    handle = TechEdit.mount(box, ctx.eventId, {
      events: Array.isArray(events) ? events : [],
      title: ctx.event.name || '(名称未設定)',
      readOnly: EventStatus.isLocked(EventStatus.of(ctx.event)),
      onSaved: function() { Desk.toast('技と配点を保存しました'); }
    });
  }

  // 区画を離れるときは TechEdit を片付ける（コピーのシートを残さない）
  function destroy() {
    if (handle) handle.destroy();
    handle = null;
  }

  Desk.registerTab('techniques', { render: render, destroy: destroy });
})();
