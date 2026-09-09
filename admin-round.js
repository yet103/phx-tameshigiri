// 進行タブ：二巡目の生成と技の入力
// 設計書の選択 A「一覧で埋めていく」。行タップで TechPicker のシートを開き、
// シートを閉じたときに PATCH で保存する。
var AdminRound = (function() {

  var CTX = null;          // { eventId, event, players, isStale }
  var currentCourt = '';   // '' なら全コート
  var lastEventId = null;  // 大会が変わったらコート絞り込みを戻すため
  var techniques = null;   // Api.loadTechniques() の結果のキャッシュ
  var pickerOpen = false;  // チップと行の両方がタップを拾うので二重に開かない
  var openingPicker = false;  // pickerOpen が立ってから TechPicker.open が呼ばれるまでの間の多重タップを防ぐ（await ensureTechniques 中の連打対策）
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
    return Courts.filter(roundTwo(CTX ? CTX.players : []), currentCourt).slice().sort(Courts.compareOrder);
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
      copy.textContent = '一巡目の行がありません';
    } else {
      copy.addEventListener('click', function(ev) {
        ev.stopPropagation();   // 行タップ（シートを開く）と二重に反応させない
        onCopyFromRound1(p, src, row);
      });
    }
    row.appendChild(copy);

    // 行タップ（チップ以外の部分）は、空いている最初の枠を開く。
    // 全部埋まっていたら①を開く（重複を許すので、選び直しの入口として①を使う）。
    row.addEventListener('click', function() {
      var arr = TechPicker.fromArray([p.tech1, p.tech2, p.tech3]);
      var slot = 0;
      for (var i = 0; i < arr.length; i++) {
        if (!arr[i]) { slot = i; break; }
      }
      openPicker(p, row, slot);
    });
    return row;
  }

  function drawChips(p, row) {
    TechPicker.renderChips(
      row.querySelector('.round-chips'),
      TechPicker.fromArray([p.tech1, p.tech2, p.tech3]),
      function(slot) { openPicker(p, row, slot); }
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

  async function openPicker(p, row, slot) {
    // pickerOpen は dismiss で閉じられた後もフラグが残りうるので、実際にシートが
    // あるか、まだ TechPicker.open を呼んでいる最中（openingPicker）のときだけ弾く。
    // openingPicker は await ensureTechniques() の完了を待つ間に連打されても、
    // シートがまだ DOM に無い（.tp-overlay 判定をすり抜ける）のを同期的にガードするため。
    if (pickerOpen && (openingPicker || document.querySelector('.tp-overlay'))) return;
    pickerOpen = true;
    openingPicker = true;
    var ctx = CTX;
    var eventId = ctx.eventId;
    if (!(await ensureTechniques())) { pickerOpen = false; openingPicker = false; return; }
    if (ctx.isStale()) { pickerOpen = false; openingPicker = false; return; }  // 待っている間に画面を離れていた
    // 最新の選択は onChange で控える
    var latest = TechPicker.fromArray([p.tech1, p.tech2, p.tech3]);
    TechPicker.open({
      techniques: techniques,
      initial: latest,
      slot: slot,
      onChange: function(state) {
        latest = state;
        TechPicker.renderChips(row.querySelector('.round-chips'), state,
          function(slot) { openPicker(p, row, slot); });
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
    openingPicker = false;  // シートを開き終えたので、以降は .tp-overlay の有無だけで多重オープンを判定する
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
  // 確認文言・結果文言は courts.js の Courts.nextRoundConflictMessage /
  // nextRoundResultMessage にある（生成の入口はこの画面だけ。コート端末には置かない）。

  async function onGenerate() {
    var ctx = CTX;
    var eventId = ctx.eventId;
    var src = roundOne(ctx.players);
    var scored = src.filter(Courts.isScored).length;
    if (!confirm('一巡目 採点済み ' + scored + ' / ' + src.length + '。\n' +
        '全コート分の二巡目を作ります（採点画面にも反映されます）。\nよろしいですか？')) return;
    var result = await Api.generateNextRound(eventId, false);
    if (ctx.isStale()) return;  // 通信中に大会やタブを切り替えられた
    if (!result) {
      alert('二巡目を生成できませんでした。一巡目の選手が登録されているか、通信を確認してください。');
      return;
    }
    if (result.blocked) {
      if (!confirm(Courts.nextRoundConflictMessage(result, '選手タブでコートを設定してください'))) return;
      result = await Api.generateNextRound(eventId, true);
      if (ctx.isStale()) return;
      if (!result || result.blocked) {
        alert('二巡目を生成できませんでした。一巡目の選手が登録されているか、通信を確認してください。');
        return;
      }
    }
    Admin.toast(Courts.nextRoundResultMessage(result));
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
