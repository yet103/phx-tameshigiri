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
//     opts.view     : true なら閲覧モードで開く（文字だけの表。「✎ 編集する」で編集に切り替える。
//                     技得点表ページが使う。PC 運営の「技と配点」は従来どおり編集で開く）
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
    // 閲覧モード（opts.view）。閲覧⇄編集の切り替えで表を描き直すため、最後に描いた技リストと
    // 注記の材料（source・選手）を持っておく。
    var viewable = opts.view === true;
    var editing = !viewable;
    var currentTechs = [];
    var lastSource = '';
    var lastPlayers = [];

    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'tech-head';
    var title = document.createElement('h2');
    title.className = 'tech-title';
    var btnEdit = makeButton('✎ 編集する', 'btn-neutral');
    var btnView = makeButton('閲覧に戻る', 'btn-neutral');
    var btnCopy = makeButton('別の大会からコピー', 'btn-neutral');
    var btnSave = makeButton('保存', 'btn-neutral');
    var btnReset = makeButton('デフォルト設定に戻す', 'btn-fail');
    head.appendChild(title);
    head.appendChild(btnEdit);
    head.appendChild(btnView);
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
    // 「抜刀状態」＝ 抜刀してからの形（data の drawn）。真剣レンタルの選手はこの形しか選べない
    // （設計書「選手の追加項目」の決定事項）。見出しだけでは意味が伝わらないので
    // title を添える。列幅は td:nth-child ではなく col-* の class で指定する
    // （style.css / techniques.html。列の増減や並び替えに強くする）。
    // スマホ幅では「回数制限」「減点初太刀」を「制限」「減点初」に詰める
    // （col-label-full / col-label-short を CSS 側の @media で出し分ける）。
    table.innerHTML =
      '<thead><tr>' +
      '<th class="col-name">技名</th>' +
      // 合計点は配点（初太刀〜四ノ太刀）の合計。自動計算で編集はできない（ユーザー要望）
      '<th class="col-total" title="初太刀〜四ノ太刀の配点の合計（自動計算）">合計点</th>' +
      '<th class="col-strike">初太刀</th><th class="col-strike">二ノ太刀</th>' +
      '<th class="col-strike">三ノ太刀</th><th class="col-strike">四ノ太刀</th>' +
      '<th class="col-drawn" title="抜刀してからの形。レンタルの選手が選べる形">抜刀状態</th>' +
      // 回数制限は「なし」（同じ巡で何度でも選べる＝repeatable）か「あり」（1 人の 3 枠に 1 回まで）で出す（ユーザー要望）
      '<th class="col-repeatable" title="「なし」なら同じ巡（一巡目・二巡目）で何度でも選べる。「あり」は 1 人の 3 枠に 1 回まで">' +
      '<span class="col-label-full">回数制限</span><span class="col-label-short">制限</span></th>' +
      '<th class="col-reduced" title="胸尽くしなど。切先が鞘から抜けていたときの初太刀の点">' +
      '<span class="col-label-full">減点初太刀</span><span class="col-label-short">減点初</span></th>' +
      // 備考は右端。他の列は内容の幅に詰め、備考が残り幅を吸収する（style.css / desk.css の .col-note）
      '<th class="col-note" title="技ごとのメモ（100文字まで）。得点には影響しません">備考</th>' +
      '</tr></thead><tbody></tbody>';
    var tbody = table.querySelector('tbody');
    scroll.appendChild(table);
    container.appendChild(scroll);

    tbody.addEventListener('input', function(e) {
      dirty = true;
      // 配点の欄を変えたら、その行の合計点（自動計算）を描き直す
      var inp = e.target;
      if (inp && inp.dataset && inp.dataset.field === 'strike') {
        var tr = inp.closest('tr');
        if (tr) updateRowTotal(tr);
      }
    });
    // チェックボックスは環境によって input が来ないことがあるので change も見る
    // （dirty が立たないと、対象を切り替えるときの「破棄しますか？」が出なくなる）。
    tbody.addEventListener('change', function() { dirty = true; });

    // 配点の合計（null＝打たない太刀は 0 として足す）
    function strikesTotal(strikes) {
      var sum = 0;
      (strikes || []).forEach(function(v) { if (Number.isInteger(v)) sum += v; });
      return sum;
    }

    // 編集中に配点を変えたら、その行の合計点を描き直す
    function updateRowTotal(tr) {
      var cell = tr.querySelector('td.col-total');
      if (!cell) return;
      var strikes = [0,1,2,3].map(function(s) {
        var inp = tr.querySelector('[data-strike="' + s + '"]');
        var n = inp ? parseInt(inp.value, 10) : NaN;
        return isNaN(n) ? null : n;
      });
      cell.textContent = String(strikesTotal(strikes));
    }

    // 閲覧モードの行（文字だけ。打たない太刀は半角の「-」）
    function viewRowHtml(t) {
      function num(v) {
        return (v !== null && v !== undefined) ? Storage.esc(String(v)) : '<span class="view-empty">-</span>';
      }
      return '<td class="col-name">' + Storage.esc(t.name) + '</td>' +
        '<td class="col-total">' + strikesTotal(t.strikes) + '</td>' +
        [0,1,2,3].map(function(s) { return '<td class="col-strike">' + num(t.strikes[s]) + '</td>'; }).join('') +
        '<td class="col-drawn">' + (t.drawn === true ? '○' : '') + '</td>' +
        '<td class="col-repeatable">' + (t.repeatable === true ? 'なし' : 'あり') + '</td>' +
        '<td class="col-reduced">' + (typeof t.reducedFirst === 'number' ? Storage.esc(String(t.reducedFirst)) : '') + '</td>' +
        '<td class="col-note">' + Storage.esc(typeof t.note === 'string' ? t.note : '') + '</td>';
    }

    function renderTable(techs) {
      currentTechs = techs || [];
      tbody.innerHTML = '';
      currentTechs.forEach(function(t, i) {
        var tr = document.createElement('tr');
        tr.innerHTML = editing ? editRowHtml(t, i) : viewRowHtml(t);
        tbody.appendChild(tr);
      });
      dirty = false;
      if (editing && readOnly) {
        var inputs = tbody.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) inputs[i].disabled = true;
      }
    }

    // 編集モードの行（入力欄）
    function editRowHtml(t, i) {
      return '<td class="col-name"><input type="text" value="' + Storage.esc(t.name) + '" data-field="name" data-idx="' + i + '"></td>' +
        '<td class="col-total">' + strikesTotal(t.strikes) + '</td>' +
          [0,1,2,3].map(function(s) {
            var v = (t.strikes[s] !== null && t.strikes[s] !== undefined) ? Storage.esc(String(t.strikes[s])) : '';
            return '<td class="col-strike"><input type="number" min="0" max="99" value="' + v +
              '" data-field="strike" data-idx="' + i + '" data-strike="' + s + '"></td>';
          }).join('') +
          // drawn / repeatable を持たない古い技リスト（data.js の既定値も持たない）は未チェックで出す
          '<td class="col-drawn"><input type="checkbox" data-field="drawn" data-idx="' + i + '"' +
          (t.drawn === true ? ' checked' : '') + '></td>' +
          // チェック＝回数制限「なし」（何度でも選べる）。見出しが「回数制限」なので、意味が逆に読めないよう文字を添える
          '<td class="col-repeatable"><label class="check-label"><input type="checkbox" data-field="repeatable" data-idx="' + i + '"' +
          (t.repeatable === true ? ' checked' : '') + '> なし</label></td>' +
          '<td class="col-reduced"><input type="number" min="0" max="99" data-field="reducedFirst" data-idx="' + i + '"' +
          ' title="胸尽くしなど。切先が鞘から抜けていたときの初太刀の点"' +
          ' value="' + (typeof t.reducedFirst === 'number' ? Storage.esc(String(t.reducedFirst)) : '') + '"></td>' +
          '<td class="col-note"><input type="text" maxlength="100" data-field="note" data-idx="' + i + '"' +
          ' value="' + Storage.esc(typeof t.note === 'string' ? t.note : '') + '"></td>';
    }

    // 見出しのボタンの出し分け。閲覧では「✎ 編集する」だけ（確定済みの大会は出さない）、
    // 編集では 保存・戻す・コピー（雛形にはコピー無し）と、閲覧で開いた画面なら「閲覧に戻る」。
    function syncButtons() {
      btnEdit.style.display = (!editing && !readOnly) ? '' : 'none';
      btnView.style.display = (editing && viewable) ? '' : 'none';
      btnSave.style.display = editing ? '' : 'none';
      btnReset.style.display = editing ? '' : 'none';
      btnCopy.style.display = (editing && targetId) ? '' : 'none';
    }

    function setEditing(on) {
      editing = on;
      renderTable(currentTechs);
      updateChrome(lastSource);
      updateScoredWarning(lastPlayers);
    }

    btnEdit.addEventListener('click', function() { setEditing(true); });
    btnView.addEventListener('click', function() {
      if (dirty && !confirm('編集中の内容は保存されていません。\n破棄して閲覧に戻りますか？')) return;
      setEditing(false);
    });

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
        var drawnEl = tr.querySelector('[data-field="drawn"]');
        var repeatableEl = tr.querySelector('[data-field="repeatable"]');
        var reducedEl = tr.querySelector('[data-field="reducedFirst"]');
        var noteEl = tr.querySelector('[data-field="note"]');
        var reducedVal = reducedEl ? reducedEl.value : '';
        var reducedFirst = null;
        if (reducedVal !== '') {
          var rn = parseInt(reducedVal, 10);
          if (!isNaN(rn)) reducedFirst = rn;
        }
        techs.push({
          name: name, strikes: strikes,
          drawn: !!(drawnEl && drawnEl.checked),
          repeatable: !!(repeatableEl && repeatableEl.checked),
          reducedFirst: reducedFirst,
          note: noteEl ? noteEl.value.trim().slice(0, 100) : ''
        });
      });
      return techs;
    }

    // 保存前の範囲チェック。「減点初太刀」欄には min="0" max="99" を付けているが、
    // ブラウザは <form> の外の number 入力に制約を強制しない（タイプしたまま通る）ため、
    // サーバー（validateTechniques）と同じ 0〜99 の範囲・同じ文言でここでも止める。
    function validateReducedFirst(techs) {
      for (var i = 0; i < techs.length; i++) {
        var rf = techs[i].reducedFirst;
        if (rf !== null && (!Number.isInteger(rf) || rf < 0 || rf > 99)) {
          alert((i + 1) + ' 行目の「減点初太刀」の配点が不正です（0〜99の整数か空）');
          return false;
        }
      }
      return true;
    }

    function eventById(id) {
      return events.filter(function(e) { return e.id === id; })[0] || null;
    }

    // 見出し・注記・ボタンの文言を対象に合わせる
    function updateChrome(source) {
      lastSource = source;
      if (!editing) {
        // 閲覧: 見出しと（確定済みなら）その注記だけ。編集向けの注記は出さない
        var ev0 = eventById(targetId);
        title.textContent = targetId
          ? (opts.title || (ev0 ? (ev0.name || '(名称未設定)') : targetId)) + ' の技得点表'
          : '雛形（新規大会の初期値）の技得点表';
        note.hidden = !(readOnly && targetId);
        note.textContent = note.hidden ? '' :
          'この大会は最終結果を確定済みです。技と配点は編集できません（上部の「戻す」を押すと編集できます）。';
        warn.hidden = true;
        syncButtons();
        return;
      }
      updateChromeEditing(source);
      syncButtons();
    }

    function updateChromeEditing(source) {
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
      title.textContent = label + ' の技得点表';
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
      lastPlayers = players || [];
      // readOnly（確定済み）と閲覧モードでは配点を編集しないので、
      // 「配点を変えても…」という編集向けの注意書きは出さない。
      if (readOnly || !editing) { warn.hidden = true; warn.textContent = ''; return; }
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
      if (!validateReducedFirst(techs)) return;
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
