// 試合進行タブ：二巡目の生成と技の入力
// 設計書の選択 A「一覧で埋めていく」。行タップで TechPicker のシートを開き、
// シートを閉じたときに PATCH で保存する。
var AdminRound = (function() {

  var CTX = null;          // { eventId, event, players, isStale }
  var currentCourt = '';   // '' なら全コート
  var lastEventId = null;  // 大会が変わったらコート絞り込みを戻すため
  var techniques = null;   // ctx.techniques（その大会の有効な技リスト）。render のたびに入れ替える
  // チップと行の両方がタップを拾うので二重に開かないよう、実際にシートが
  // 存在するか（.tp-overlay）と、まだ開いている最中か（openingPicker）だけで判定する。
  // かつて pickerOpen という別フラグも持っていたが、openPicker が新しいシートの
  // pickerOpen を立てた直後に TechPicker.open が前のシートの done()（onClose）を
  // 同期的に呼び、そちらが pickerOpen を false に戻してしまい、二つのフラグが
  // ずれることがあった。判定に使う条件をそのままフラグにする。
  var openingPicker = false;  // TechPicker.open を呼ぶまでの間の多重タップを防ぐ（await ensureTechniques 中の連打対策）
  var counterEl = null;
  var listEl = null;
  var outsideClickBound = false;  // '⋯' メニューの外側タップ検知は document に1回だけ付ける

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

  // --- 段階表示と遷移 ---
  // 件数・確認文言は courts.js（Courts.stageCountText / Courts.statusConfirmMessage。
  // PC 運営の上部と共用）にある。

  // 状態を変える。失敗の理由はサーバーの文言をそのまま出す。
  // transition の 409 は他の端末が先に進めていた場合なので、画面を読み直す。
  async function applyStatus(from, to) {
    var ctx = CTX;
    if (!confirm(Courts.statusConfirmMessage(from, to, ctx.players))) return;
    var res = await Api.changeStatus(ctx.eventId, to);
    if (ctx.isStale()) return;   // 通信中に大会やタブを切り替えられた
    if (!res) {
      alert('状態を変えられませんでした。通信を確認してください。');
      return;
    }
    if (!res.ok) {
      alert(res.error);
      // 読み直すのは他の端末が先に進めていた場合（transition）だけ。
      // empty / no_round2 はこちらの入力不足であり、読み直しても状態は変わらない。
      if (res.reason === 'transition') await Admin.reloadEvent();
      return;
    }
    Admin.toast(EventStatus.LABELS[to] + ' にしました');
    await Admin.reloadEvent();
  }

  // 試合進行タブの先頭の段階表示。現在の状態と「次へ進む」。
  // 件数は下の .round-stat（stageCountText）に出す。
  // 「戻す」と「二巡目なしで終了」は ⋯ メニュー（buildMenu）にある。
  function buildStage(st) {
    var wrap = document.createElement('div');
    wrap.className = 'round-stage';

    var label = document.createElement('div');
    label.className = 'round-stage-label';
    label.id = 'roundStageLabel';
    label.textContent = '現在の状態: ' + EventStatus.LABELS[st];
    wrap.appendChild(label);

    var next = EventStatus.next(st);
    if (next) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'round-next';
      btn.id = 'btnRoundNext';
      btn.textContent = EventStatus.NEXT_LABELS[st] + ' ▶';
      btn.addEventListener('click', function() { applyStatus(st, next); });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  // --- 描画 ---

  function render(container, ctx) {
    CTX = ctx;
    // 配点は大会ごと。雛形（Api.loadTechniques）は取りに行かない。
    techniques = (Array.isArray(ctx.techniques) && ctx.techniques.length > 0) ? ctx.techniques : null;
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

    // 段階表示(現在の状態と「次へ進む」)を先頭に置く
    var st = EventStatus.of(ctx.event);
    container.appendChild(buildStage(st));

    // 見出し：採点の進み具合・生成ボタン・メニュー
    var head = document.createElement('div');
    head.className = 'round-head';
    var stat = document.createElement('div');
    stat.className = 'round-stat';
    stat.id = 'roundScoredStat';
    stat.textContent = Courts.stageCountText(st, players);
    head.appendChild(stat);
    var genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'round-gen';
    genBtn.id = 'btnGenRound2';
    genBtn.textContent = '二巡目を生成';
    // 生成できるのは「一巡目終了」のときだけ（サーバーも 409 status で拒む）
    if (st !== 'round1_done') {
      genBtn.disabled = true;
      genBtn.title = '「一巡目終了」のときだけ生成できます（今は「' + EventStatus.LABELS[st] + '」）';
    } else {
      genBtn.addEventListener('click', onGenerate);
    }
    head.appendChild(genBtn);
    // 採点画面へ（絞り込み中のコートを引き継ぐ。採点画面の Route と同じ形 #event/<大会ID>/<コート>）
    var openBtn = document.createElement('a');
    openBtn.className = 'round-open';
    openBtn.id = 'btnOpenScoring';
    openBtn.textContent = '採点画面へ';
    openBtn.href = Admin.scoringHref(ctx.eventId, currentCourt);
    head.appendChild(openBtn);
    head.appendChild(buildMenu(st, players));
    container.appendChild(head);

    // コート絞り込み。チップは大会全体のコートから作る。
    // 二巡目が未生成のときにチップ列が消えないようにするため。
    var chipsWrap = document.createElement('div');
    chipsWrap.className = 'court-chips round-courts';
    container.appendChild(chipsWrap);
    function onCourtChange(court) {
      currentCourt = court;
      Admin.renderCourtChips(chipsWrap, players, currentCourt, onCourtChange);
      openBtn.href = Admin.scoringHref(ctx.eventId, currentCourt);
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
    var n = rows.filter(Courts.isTechIncomplete).length;
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

  // 技リストは render で ctx.techniques から入る。取れていなければ大会を開き直してもらう。
  function ensureTechniques() {
    if (techniques) return true;
    alert('技術リストを取得できませんでした。大会を開き直してください。');
    return false;
  }

  async function openPicker(p, row, slot) {
    // 実際にシートがある（.tp-overlay）か、まだ TechPicker.open を呼んでいる
    // 最中（openingPicker）のときだけ弾く。openingPicker は await ensureTechniques()
    // の完了を待つ間に連打されても、シートがまだ DOM に無い（.tp-overlay 判定を
    // すり抜ける）のを同期的にガードするため。
    if (openingPicker || document.querySelector('.tp-overlay')) return;
    openingPicker = true;
    var ctx = CTX;
    var eventId = ctx.eventId;
    if (!ensureTechniques()) { openingPicker = false; return; }
    if (ctx.isStale()) { openingPicker = false; return; }  // 待っている間に画面を離れていた
    // 最新の選択は onChange で控える
    var latest = TechPicker.fromArray([p.tech1, p.tech2, p.tech3]);
    TechPicker.open({
      techniques: Courts.techniqueOptions(techniques, !!p.isFemale),
      initial: latest,
      slot: slot,
      onChange: function(state) {
        latest = state;
        TechPicker.renderChips(row.querySelector('.round-chips'), state,
          function(slot) { openPicker(p, row, slot); });
      },
      onClose: async function(state) {
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
    // 採点済みの選手の技を変えると、result 文字列の長さは変わらないため
    // 採点画面（Scoring.canDecode）はこれを検知できず、黙って新しい技の配点で
    // 再解釈してしまう（admin-players.js の性別変更ガードと同じ理由）。
    // openPicker の onClose と onCopyFromRound1 のどちらから来ても必ずここを通す。
    if (Courts.isScored(p) &&
        (arr[0] !== (p.tech1 || '') || arr[1] !== (p.tech2 || '') || arr[2] !== (p.tech3 || ''))) {
      var ok = confirm(
        'この選手は採点済みです（' + (p.score || 0) + '点）。\n' +
        '得点が変わる可能性があります。採点画面でこの選手を開き直してください。\n\n' +
        'このまま保存しますか？'
      );
      if (!ok) {
        drawChips(p, row);
        return false;
      }
    }
    var res = await Api.updatePlayerInfo(eventId, p.id,
      { tech1: arr[0], tech2: arr[1], tech3: arr[2] });
    if (ctx.isStale()) return !!(res && res.ok);   // 画面を離れていたら DOM に触れない（alert もしない）
    if (!res || !res.ok) {
      if (res && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      } else {
        alert('技を保存できませんでした。通信を確認してもう一度お試しください。');
      }
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
      if (result.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        return;
      }
      if (result.reason === 'status') {
        alert(result.error);
        return;
      }
      // nextRoundConflictMessage は unscored / exists の文言しか持たない
      if (!confirm(Courts.nextRoundConflictMessage(result, '選手登録タブでコートを設定してください'))) return;
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

  function buildMenu(st, players) {
    bindOutsideClickOnce();
    var menu = document.createElement('details');
    menu.className = 'round-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    menu.appendChild(sum);

    // 戻す（prev が無い draft では出さない）
    var back = EventStatus.prev(st, players);
    if (back) {
      var btnBack = document.createElement('button');
      btnBack.type = 'button';
      btnBack.id = 'btnRoundBack';
      btnBack.textContent = '◀ ' + EventStatus.LABELS[back] + ' に戻す';
      btnBack.addEventListener('click', function() {
        menu.open = false;
        applyStatus(st, back);
      });
      menu.appendChild(btnBack);
    }

    // 二巡目なしで終了（一巡目終了のときだけ）
    if (st === 'round1_done') {
      var btnSkip = document.createElement('button');
      btnSkip.type = 'button';
      btnSkip.id = 'btnRoundSkipRound2';
      btnSkip.textContent = '二巡目なしで終了';
      btnSkip.addEventListener('click', function() {
        menu.open = false;
        applyStatus(st, 'final');
      });
      menu.appendChild(btnSkip);
    }

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
    render: render
  };
})();
