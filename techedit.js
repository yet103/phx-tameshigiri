// 技リスト編集（技名と太刀ごとの配点の表）の描画・保存・コピー。
// もとは techniques.html の <script> にあった。技術リスト編集ページと
// PC 運営の「技と配点」の区画（desk-techniques.js）から同じコードを使う。
//
//   TechEdit.mount(container, eventId, opts) → { isDirty, destroy }
//     container : 中身を入れ替えてよい要素
//     eventId   : '' なら雛形（新規大会の初期値）、大会IDならその大会の技リスト
//     opts.events   : [{ id, name, date }]「別の大会からコピー」の候補（既定は []）
//     opts.title    : 見出しに使う大会名（省略時は events から引き、無ければ ID をそのまま）
//     opts.readOnly : true なら保存・雛形に戻す・コピーを無効にする（確定済みの大会）
//     opts.onSaved  : function(techniques) 保存が成功したあとに呼ぶ（省略可）
//   戻り値の isDirty() は「表を触ったか」。対象を切り替える前の確認に使う。
//   destroy() は DOM から外す前に呼ぶ（開きっぱなしのコピーのシートを閉じ、
//   遅れて戻ってくる応答を無視する）。
//
// 対象の選択とハッシュの管理は呼び出し側が持つ。この中では location に触らない
// （PC 運営は #techniques/<id> という別のハッシュ体系を持つため）。
// class 名は techniques.html のときのまま（style.css と desk.css の両方に定義がある）。
var TechEdit = (function() {

  function makeButton(text, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    return b;
  }

  function mount(container, eventId, opts) {
    opts = opts || {};
    var events = Array.isArray(opts.events) ? opts.events : [];
    var readOnly = opts.readOnly === true;
    var targetId = eventId || '';
    var dirty = false;
    var copyOverlay = null;
    // 読み込みの再入ガード。destroy でも進めて、外したあとに戻ってきた応答で
    // DOM に触らないようにする（app.js の loadSeq と同じ考え方）。
    var loadSeq = 0;

    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'tech-head';
    var title = document.createElement('h2');
    title.className = 'tech-title';
    var btnCopy = makeButton('別の大会からコピー', 'btn-neutral');
    var btnSave = makeButton('保存', 'btn-neutral');
    var btnReset = makeButton('デフォルト設定に戻す', 'btn-fail');
    head.appendChild(title);
    head.appendChild(btnCopy);
    head.appendChild(btnSave);
    head.appendChild(btnReset);
    container.appendChild(head);

    var note = document.createElement('p');
    note.className = 'tech-note';
    note.hidden = true;
    container.appendChild(note);

    var warn = document.createElement('p');
    warn.className = 'tech-warn';
    warn.hidden = true;
    container.appendChild(warn);

    var scroll = document.createElement('div');
    scroll.className = 'tech-scroll';
    var table = document.createElement('table');
    table.className = 'tech-table';
    table.innerHTML =
      '<thead><tr><th>技名</th><th>初太刀</th><th>二ノ太刀</th><th>三ノ太刀</th><th>四ノ太刀</th></tr></thead>' +
      '<tbody></tbody>';
    var tbody = table.querySelector('tbody');
    scroll.appendChild(table);
    container.appendChild(scroll);

    tbody.addEventListener('input', function() { dirty = true; });

    function renderTable(techs) {
      tbody.innerHTML = '';
      (techs || []).forEach(function(t, i) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><input type="text" value="' + Storage.esc(t.name) + '" data-field="name" data-idx="' + i + '"></td>' +
          [0,1,2,3].map(function(s) {
            var v = (t.strikes[s] !== null && t.strikes[s] !== undefined) ? Storage.esc(String(t.strikes[s])) : '';
            return '<td><input type="number" min="0" max="99" value="' + v +
              '" data-field="strike" data-idx="' + i + '" data-strike="' + s + '"></td>';
          }).join('');
        tbody.appendChild(tr);
      });
      dirty = false;
      if (readOnly) {
        var inputs = tbody.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) inputs[i].disabled = true;
      }
    }

    function collectTechs() {
      var techs = [];
      var rows = tbody.querySelectorAll('tr');
      rows.forEach(function(tr) {
        var name = tr.querySelector('[data-field="name"]').value.trim();
        var strikes = [0,1,2,3].map(function(s) {
          var v = tr.querySelector('[data-strike="' + s + '"]').value;
          if (v === '') return null;
          var n = parseInt(v, 10);
          return isNaN(n) ? null : n;
        });
        techs.push({ name: name, strikes: strikes });
      });
      return techs;
    }

    function eventById(id) {
      return events.filter(function(e) { return e.id === id; })[0] || null;
    }

    // 見出し・注記・ボタンの文言を対象に合わせる
    function updateChrome(source) {
      if (!targetId) {
        title.textContent = '雛形（新規大会の初期値）';
        btnReset.textContent = 'デフォルト設定に戻す';
        btnCopy.style.display = 'none';   // 雛形には「別の大会からコピー」を出さない
        note.hidden = false;
        note.textContent =
          'ここで保存した内容は、これから作る大会の初期値になります。既に技リストを持つ大会の配点は変わりません。';
        warn.hidden = true;
        return;
      }
      var ev = eventById(targetId);
      // 大会一覧が取れていないときは名前が分からない。空欄より ID を出すほうが
      // 「今どの対象を触っているか」を誤認しない。
      var label = opts.title || (ev ? (ev.name || '(名称未設定)') : targetId);
      title.textContent = label + ' の技リスト';
      btnReset.textContent = '雛形に戻す';
      btnCopy.style.display = '';
      if (readOnly) {
        note.hidden = false;
        note.textContent =
          'この大会は最終結果を確定済みです。技と配点は編集できません（上部の「戻す」を押すと編集できます）。';
        return;
      }
      if (source === 'template') {
        note.hidden = false;
        note.textContent =
          'この大会はまだ雛形を使っています。保存するとこの大会だけの技リストになります。';
      } else {
        note.hidden = true;
        note.textContent = '';
      }
    }

    function updateScoredWarning(players) {
      var n = (players || []).filter(function(p) { return Courts.isScored(p); }).length;
      if (n === 0) { warn.hidden = true; warn.textContent = ''; return; }
      warn.hidden = false;
      warn.textContent = '採点済みの選手が ' + n + ' 名います。' +
        '配点を変えても保存済みの得点は変わりません（採点し直すと新しい配点で計算されます）。';
    }

    // 通信に失敗したときは端末側の既定値（data.js の TECHNIQUES）を出し、
    // 保存・雛形に戻す・コピーを無効にする（この状態で保存すると、サーバーの
    // 技術リストを既定値で上書きしてしまう）。
    function fallbackToLocal(message) {
      alert(message);
      renderTable(TECHNIQUES);
      btnSave.disabled = true;
      btnReset.disabled = true;
      btnCopy.disabled = true;
    }

    async function load() {
      var seq = ++loadSeq;
      btnSave.disabled = readOnly;
      btnReset.disabled = readOnly;
      btnCopy.disabled = readOnly;
      warn.hidden = true;
      if (!targetId) {
        updateChrome('');
        var td = await Api.loadTechniques();
        if (seq !== loadSeq) return;
        if (!td) {
          fallbackToLocal('技術リストをサーバーから取得できませんでした。\n' +
            '端末側の既定値を表示しています。\n' +
            '保存・雛形に戻す・別の大会からコピーを無効にしました。再読み込みしてください。');
          return;
        }
        renderTable(td.techniques);
        return;
      }
      var data = await Api.loadEventTechniques(targetId);
      if (seq !== loadSeq) return;
      if (!data) {
        updateChrome('');
        fallbackToLocal('この大会の技リストを取得できませんでした。\n' +
          '端末側の既定値を表示しています。\n' +
          '保存・雛形に戻す・別の大会からコピーを無効にしました。再読み込みしてください。');
        return;
      }
      updateChrome(data.source);
      renderTable(data.techniques);
      var ev = await Api.loadEvent(targetId);
      if (seq !== loadSeq) return;
      updateScoredWarning(ev ? ev.players : []);
    }

    // 「別の大会からコピー」のシート。admin.css を読まないページでも動くよう、
    // 最小限の要素をその場で組み立てて捨てる。
    function closeCopySheet() {
      if (copyOverlay && copyOverlay.parentNode) copyOverlay.parentNode.removeChild(copyOverlay);
      copyOverlay = null;
    }

    function openCopySheet() {
      var others = events.filter(function(e) { return e.id !== targetId; });
      if (others.length === 0) { alert('コピーできる大会がありません。'); return; }
      closeCopySheet();
      var overlay = document.createElement('div');
      overlay.className = 'tech-overlay';
      copyOverlay = overlay;
      var panel = document.createElement('div');
      panel.className = 'tech-sheet';
      var h = document.createElement('h3');
      h.textContent = 'どの大会の技リストをコピーしますか？（保存するまでサーバーには書きません）';
      panel.appendChild(h);

      others.forEach(function(ev) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tech-sheet-item btn-neutral';
        b.textContent = (ev.name || '(名称未設定)') + '（' + (ev.date || '日付なし') + '）';
        b.addEventListener('click', async function() {
          closeCopySheet();
          // コピー元の応答を待つ間に対象そのものを切り替えられていたら、
          // 戻ってきた表を今の対象（別の大会かもしれない）に流し込まない。
          var seq = loadSeq;
          var data = await Api.loadEventTechniques(ev.id);
          if (seq !== loadSeq) return;
          if (!data) { alert('その大会の技リストを取得できませんでした。'); return; }
          renderTable(data.techniques);
          dirty = true;
          alert('「' + (ev.name || '(名称未設定)') + '」の技リストを読み込みました。\n' +
                '保存を押すまでこの大会には反映されません。');
        });
        panel.appendChild(b);
      });

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'tech-sheet-item';
      cancel.textContent = '閉じる';
      cancel.addEventListener('click', closeCopySheet);
      panel.appendChild(cancel);

      overlay.appendChild(panel);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) closeCopySheet(); });
      document.body.appendChild(overlay);
    }

    btnCopy.addEventListener('click', openCopySheet);

    btnSave.addEventListener('click', async function() {
      var seq = loadSeq;   // 対象や画面が切り替えられていないかを await のたびに確かめる
      var techs = collectTechs();
      if (!targetId) {
        var r0 = await Api.saveTechniques(techs);
        if (seq !== loadSeq) return;
        if (!r0) { alert('保存に失敗しました。通信を確認してください。'); return; }
        if (!r0.success) { alert(r0.error || '保存に失敗しました。'); return; }
        dirty = false;
        alert('雛形を保存しました。\nこれから作る大会の初期値になります。');
        if (opts.onSaved) opts.onSaved(techs);
        return;
      }
      var r = await Api.saveEventTechniques(targetId, techs);
      if (seq !== loadSeq) return;
      if (!r) { alert('保存に失敗しました。通信を確認してください。'); return; }
      if (!r.success) { alert(r.error || '保存に失敗しました。'); return; }
      dirty = false;
      renderTable(r.techniques);
      updateChrome('event');
      alert('保存しました。');
      if (opts.onSaved) opts.onSaved(r.techniques);
    });

    btnReset.addEventListener('click', async function() {
      var seq = loadSeq;   // 対象や画面が切り替えられていないかを await のたびに確かめる
      if (!targetId) {
        if (!confirm('デフォルト設定に戻します。よろしいですか？')) return;
        var ok = await Api.resetTechniques();
        if (seq !== loadSeq) return;
        if (!ok) { alert('リセットに失敗しました。'); return; }
        // リセット自体は成功しているので、再取得に失敗しても表は出す。
        // ただしその場合に表示できるのは端末側の既定値であって、
        // サーバーが実際に採点で使う値ではない。黙って同じ顔をさせない。
        var td = await Api.loadTechniques();
        if (seq !== loadSeq) return;
        if (td) {
          renderTable(td.techniques);
          alert('デフォルトに戻しました。');
        } else {
          renderTable(TECHNIQUES);
          alert('デフォルトに戻しました。\n' +
                'ただし最新の技術リストを取得できなかったため、\n' +
                'この画面には端末側の既定値を表示しています。');
        }
        return;
      }
      if (!confirm('この大会の技リストを雛形（新規大会の初期値）で置き換えます。\nよろしいですか？')) return;
      var okEv = await Api.resetEventTechniques(targetId);
      if (seq !== loadSeq) return;
      if (!okEv) { alert('リセットに失敗しました。'); return; }
      var data = await Api.loadEventTechniques(targetId);
      if (seq !== loadSeq) return;
      if (!data) {
        alert('雛形に戻しました。\nただし最新の技リストを取得できませんでした。再読み込みしてください。');
        return;
      }
      renderTable(data.techniques);
      updateChrome(data.source);
      alert('雛形に戻しました。');
      if (opts.onSaved) opts.onSaved(data.techniques);
    });

    function destroy() {
      loadSeq++;          // 遅れて戻ってくる応答を無視する
      closeCopySheet();   // シートを開いたまま画面を離れても残さない
      container.innerHTML = '';
    }

    load().catch(function(e) { console.error(e); });

    return {
      isDirty: function() { return dirty; },
      destroy: destroy
    };
  }

  return { mount: mount };
})();
