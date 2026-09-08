// 進行タブ：二巡目の生成と技の入力
// 設計書の選択 A「一覧で埋めていく」。行タップで TechPicker のシートを開き、
// シートを閉じたときに PATCH で保存する。
var AdminRound = (function() {

  var CTX = null;          // { eventId, event, players, isStale }
  var currentCourt = '';   // '' なら全コート
  var lastEventId = null;  // 大会が変わったらコート絞り込みを戻すため
  var techniques = null;   // Api.loadTechniques() の結果のキャッシュ
  var pickerOpen = false;  // チップと行の両方がタップを拾うので二重に開かない
  var counterEl = null;
  var listEl = null;
  var outsideClickBound = false;  // '⋯' メニューの外側タップ検知は document に1回だけ付ける

  // 技が3つ揃っていない行を「未入力」と数える（一巡目のデータは常に3つ入っている）
  function isTechIncomplete(p) {
    return !p.tech1 || !p.tech2 || !p.tech3;
  }

  function roundOne(players) {
    return (players || []).filter(function(p) { return Courts.roundOf(p) === 1; });
  }

  function roundTwo(players) {
    return (players || []).filter(function(p) { return Courts.roundOf(p) === 2; });
  }

  // 現在のコート絞り込みで見えている二巡目の行
  function visibleRows() {
    return Courts.filter(roundTwo(CTX ? CTX.players : []), currentCourt);
  }

  // sourcePlayerId が指す一巡目の行。削除済みなら null
  function sourceOf(p) {
    if (!p || !p.sourcePlayerId || !CTX) return null;
    var all = CTX.players || [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].id === p.sourcePlayerId) return all[i];
    }
    return null;
  }

  // --- 描画 ---

  function render(container, ctx) {
    CTX = ctx;
    pickerOpen = false;
    container.innerHTML = '';
    if (!ctx || !ctx.eventId) {
      var msg = document.createElement('p');
      msg.className = 'round-empty';
      msg.textContent = '大会を選んでください。';
      container.appendChild(msg);
      return;
    }
    if (ctx.eventId !== lastEventId) {
      currentCourt = '';
      lastEventId = ctx.eventId;
    }
    var players = ctx.players || [];
    // 絞り込み中のコートが消えていたら全コートに戻す
    if (currentCourt && Courts.listFrom(players).indexOf(currentCourt) === -1) currentCourt = '';

    // 見出し：一巡目の採点状況・生成ボタン・メニュー
    var head = document.createElement('div');
    head.className = 'round-head';
    var src = roundOne(players);
    var scored = src.filter(Courts.isScored).length;
    var stat = document.createElement('div');
    stat.className = 'round-stat';
    stat.id = 'roundScoredStat';
    stat.textContent = '一巡目 採点済み ' + scored + ' / ' + src.length;
    head.appendChild(stat);
    var genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'round-gen';
    genBtn.id = 'btnGenRound2';
    genBtn.textContent = '二巡目を生成';
    genBtn.addEventListener('click', onGenerate);
    head.appendChild(genBtn);
    head.appendChild(buildMenu());
    container.appendChild(head);

    // コート絞り込み。チップは大会全体のコートから作る。
    // 二巡目が未生成のときにチップ列が消えないようにするため。
    var chipsWrap = document.createElement('div');
    chipsWrap.className = 'court-chips round-courts';
    container.appendChild(chipsWrap);
    function onCourtChange(court) {
      currentCourt = court;
      Admin.renderCourtChips(chipsWrap, players, currentCourt, onCourtChange);
      renderList();
    }
    Admin.renderCourtChips(chipsWrap, players, currentCourt, onCourtChange);

    counterEl = document.createElement('div');
    counterEl.className = 'round-counter';
    counterEl.id = 'roundCounter';
    container.appendChild(counterEl);

    listEl = document.createElement('div');
    listEl.className = 'round-list';
    listEl.id = 'roundList';
    container.appendChild(listEl);

    renderList();
  }

  function renderList() {
    listEl.innerHTML = '';
    var rows = visibleRows();
    if (rows.length === 0) {
      var p = document.createElement('p');
      p.className = 'round-empty';
      p.textContent = '二巡目の選手はまだいません。「二巡目を生成」を押してください。';
      listEl.appendChild(p);
    } else {
      rows.forEach(function(r) { listEl.appendChild(buildRow(r)); });
    }
    updateCounter();
  }

  function updateCounter() {
    if (!counterEl) return;
    var rows = visibleRows();
    var n = rows.filter(isTechIncomplete).length;
    var prefix = '';
    if (currentCourt) {
      // 未分類はそのままの表記。それ以外は「A コート」のように「コート」を付ける。
      prefix = (currentCourt === Courts.UNASSIGNED ? currentCourt : currentCourt + ' コート') + '　';
    }
    counterEl.textContent = prefix + '二巡目 ' + rows.length + '名　技 未入力 ' + n;
    counterEl.className = 'round-counter' + (n === 0 ? ' done' : '');
  }

  function buildRow(p) {
    var row = document.createElement('div');
    row.className = 'round-row';
    row.setAttribute('data-player-id', p.id);

    var src = sourceOf(p);
    var top = document.createElement('div');
    top.className = 'round-row-top';
    var name = document.createElement('span');
    name.className = 'round-name';
    name.textContent = (p.order || '') + '　' + (p.name || '');
    var prev = document.createElement('span');
    prev.className = 'round-prev';
    prev.textContent = '一巡目 ' + (src ? String(src.score || 0) : '—');
    top.appendChild(name);
    top.appendChild(prev);
    row.appendChild(top);

    // chips-required: 空きのチップを赤くする（admin.css）
    var chips = document.createElement('div');
    chips.className = 'round-chips chips chips-required';
    row.appendChild(chips);
    drawChips(p, row);

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'round-copy';
    copy.textContent = '一巡目と同じ技をコピー';
    if (!src) {
      copy.disabled = true;
      copy.title = '一巡目の行が削除されています';
    } else {
      copy.addEventListener('click', function(ev) {
        ev.stopPropagation();   // 行タップ（シートを開く）と二重に反応させない
        onCopyFromRound1(p, src, row);
      });
    }
    row.appendChild(copy);

    row.addEventListener('click', function() { openPicker(p, row); });
    return row;
  }

  function drawChips(p, row) {
    TechPicker.renderChips(
      row.querySelector('.round-chips'),
      TechPicker.fromArray([p.tech1, p.tech2, p.tech3]),
      function() { openPicker(p, row); }
    );
  }

  // --- 技の入力 ---

  async function ensureTechniques() {
    if (techniques) return true;
    var data = await Api.loadTechniques();
    if (!data || !data.techniques) {
      alert('技術リストを取得できませんでした。');
      return false;
    }
    techniques = data.techniques;
    return true;
  }

  async function openPicker(p, row) {
    // dismiss で閉じられた後はフラグが残るので、実際にシートがあるときだけ弾く
    if (pickerOpen && document.querySelector('.tp-overlay')) return;
    pickerOpen = true;
    var ctx = CTX;
    var eventId = ctx.eventId;
    if (!(await ensureTechniques())) { pickerOpen = false; return; }
    if (ctx.isStale()) { pickerOpen = false; return; }  // 待っている間に画面を離れていた
    // 最新の選択は onChange で控える
    var latest = TechPicker.fromArray([p.tech1, p.tech2, p.tech3]);
    TechPicker.open({
      techniques: techniques,
      initial: latest,
      onChange: function(state) {
        latest = state;
        TechPicker.renderChips(row.querySelector('.round-chips'), state,
          function() { openPicker(p, row); });
      },
      onClose: async function(state) {
        pickerOpen = false;
        latest = state || latest;
        var arr = TechPicker.toArray(latest);
        if (arr[0] === (p.tech1 || '') &&
            arr[1] === (p.tech2 || '') &&
            arr[2] === (p.tech3 || '')) {
          return;   // 変わっていないなら送らない
        }
        if (ctx.isStale()) return;   // シートを開いたまま画面を離れていたら書かない
        await saveTech(p, arr, row, eventId, ctx);
      }
    });
  }

  // 保存できたら true。失敗したら画面もサーバーに合わせて元に戻す。
  async function saveTech(p, arr, row, eventId, ctx) {
    var res = await Api.updatePlayerInfo(eventId, p.id,
      { tech1: arr[0], tech2: arr[1], tech3: arr[2] });
    if (ctx.isStale()) return !!(res && res.ok);   // 画面を離れていたら DOM に触れない（alert もしない）
    if (!res || !res.ok) {
      alert('技を保存できませんでした。通信を確認してもう一度お試しください。');
      drawChips(p, row);
      return false;
    }
    p.tech1 = arr[0];
    p.tech2 = arr[1];
    p.tech3 = arr[2];
    drawChips(p, row);
    updateCounter();
    return true;
  }

  async function onCopyFromRound1(p, src, row) {
    var ctx = CTX;
    var ok = await saveTech(p, [src.tech1 || '', src.tech2 || '', src.tech3 || ''],
      row, ctx.eventId, ctx);
    if (ctx.isStale()) return;   // 画面を離れていたらトーストを出さない
    if (ok) Admin.toast('一巡目の技をコピーしました');
  }

  // --- 二巡目の生成 ---
  // 番号規則はサーバーの生成 API が唯一の実装。クライアントは確認と再送だけを持つ。
  // 同じ文言を app.js の onGenNextRound も持つ（採点画面と運営画面で流れを揃えるため）。

  function conflictMessage(result) {
    var extra = '';
    if (result.untrackedCount > 0) {
      extra += '\n※CSV で作った二巡目の行が ' + result.untrackedCount + ' 件あります。続けると重複します。';
    }
    if (result.unassignedCount > 0) {
      extra += '\n※コートが決まっていない選手が ' + result.unassignedCount + ' 名います（二巡目を作れません。選手タブでコートを設定してください）。';
    }
    if (result.reason === 'unscored') {
      return '未採点が' + result.unscoredCount + '名います。\n' +
             'このまま生成すると、あとから入る一巡目の得点は二巡目の並び順に反映されません。\n' +
             '生成しますか？' + extra;
    }
    return '二巡目は生成済みです（' + result.existingCount + '名）。\n' +
           '未生成の選手がいれば差分だけ追加しますか？' + extra;
  }

  async function onGenerate() {
    var ctx = CTX;
    var eventId = ctx.eventId;
    var result = await Api.generateNextRound(eventId, false);
    if (ctx.isStale()) return;  // 通信中に大会やタブを切り替えられた
    if (!result) {
      alert('二巡目を生成できませんでした。一巡目の選手が登録されているか、通信を確認してください。');
      return;
    }
    if (result.blocked) {
      if (!confirm(conflictMessage(result))) return;
      result = await Api.generateNextRound(eventId, true);
      if (ctx.isStale()) return;
      if (!result || result.blocked) {
        alert('二巡目を生成できませんでした。一巡目の選手が登録されているか、通信を確認してください。');
        return;
      }
    }
    var note = result.unassignedCount > 0
      ? '（コート未設定の ' + result.unassignedCount + ' 名は作っていません）' : '';
    Admin.toast('二巡目を生成しました（' + result.created + '名）' + note);
    await Admin.reloadEvent();
  }

  // --- メニュー（二次導線） ---

  // details/summary の外側をタップしたら閉じる。document への登録は1回だけ
  // （render のたびに buildMenu が呼ばれてもリスナーが積み重ならないように）。
  function bindOutsideClickOnce() {
    if (outsideClickBound) return;
    outsideClickBound = true;
    document.addEventListener('click', function(e) {
      var menus = document.querySelectorAll('.round-menu[open]');
      for (var i = 0; i < menus.length; i++) {
        if (!menus[i].contains(e.target)) menus[i].open = false;
      }
    });
  }

  function buildMenu() {
    bindOutsideClickOnce();
    var menu = document.createElement('details');
    menu.className = 'round-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    menu.appendChild(sum);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnRoundExport';
    btn.textContent = 'CSVエクスポート';
    btn.addEventListener('click', async function() {
      menu.open = false;
      var ctx = CTX;
      var csv = await Api.exportCsv(ctx.eventId);
      if (ctx.isStale()) return;  // 通信中に大会やタブを切り替えられた
      if (!csv) { alert('エクスポートに失敗しました。'); return; }
      Storage.downloadCsv('players.csv', csv);
    });
    menu.appendChild(btn);
    return menu;
  }

  Admin.registerTab('round', { render: render });

  return {
    render: render,
    isTechIncomplete: isTechIncomplete
  };
})();
