// 試合進行タブ：二巡目の生成と技の入力
// 設計書の選択 A「一覧で埋めていく」。行タップで TechPicker のシートを開き、
// シートを閉じたときに PATCH で保存する。
var AdminRound = (function() {

  var CTX = null;          // { eventId, event, players, isStale }
  var currentCourt = '';   // '' なら全コート
  var lastEventId = null;  // 大会が変わったらコート絞り込みを戻すため
  var techniques = null;   // ctx.techniques（その大会の有効な技リスト）。render のたびに入れ替える
  // 技を入れられるのは「一巡目終了」のときだけ（PC 運営 desk-match.js の editable と同じ規則）。
  // render のたびに入れ替える。
  var editable = false;
  // チップと行の両方がタップを拾うので二重に開かないよう、実際にシートが
  // 存在するか（.tp-overlay）と、まだ開いている最中か（openingPicker）だけで判定する。
  // かつて pickerOpen という別フラグも持っていたが、openPicker が新しいシートの
  // pickerOpen を立てた直後に TechPicker.open が前のシートの done()（onClose）を
  // 同期的に呼び、そちらが pickerOpen を false に戻してしまい、二つのフラグが
  // ずれることがあった。判定に使う条件をそのままフラグにする。
  var openingPicker = false;  // TechPicker.open を呼ぶまでの間の多重タップを防ぐ（await ensureTechniques 中の連打対策）
  var counterEl = null;
  var statEl = null;       // 見出しの件数（stageCountText）。形を保存したら数え直す（「一巡目から変更 n」）
  var statStatus = '';     // statEl を描いたときの状態
  var listEl = null;
  var outsideClickBound = false;  // '⋯' メニューの外側タップ検知は document に1回だけ付ける

  function roundOne(players) {
    return (players || []).filter(function(p) { return Courts.roundOf(p) === 1; });
  }

  function roundTwo(players) {
    return (players || []).filter(function(p) { return Courts.roundOf(p) === 2; });
  }

  // --- 順位の要約（二巡目終了・最終結果）---
  // 部門名は結果確認（admin-results.js）と同じ。同点は同順位なので、上位 3 名は rank <= 3 の全員
  // （4 名以上になりうる）。順位は Api.loadRanking（結果確認と同じ）から取る。
  var CATEGORIES = [
    { key: 'male',    title: '一般男子' },
    { key: 'newFace', title: '新人枠' },
    { key: 'female',  title: '一般女子' }
  ];

  function topRows(list) {
    return (list || []).filter(function(r) { return r && Number(r.rank) <= 3; });
  }

  // 3 部門の上位 3 名を縦に 3 つの小さな表で描く（PC 運営は横 3 列）
  function buildTopThree(data) {
    var wrap = document.createElement('div');
    wrap.className = 'round-top3';
    CATEGORIES.forEach(function(c) {
      var sec = document.createElement('section');
      sec.className = 'round-top3-sec';
      var h = document.createElement('h4');
      h.textContent = c.title;
      sec.appendChild(h);
      var rows = topRows(data && data.rankings && data.rankings[c.key]);
      if (rows.length === 0) {
        var none = document.createElement('p');
        none.className = 'round-top3-none';
        none.textContent = 'データなし';
        sec.appendChild(none);
      } else {
        var table = document.createElement('table');
        table.className = 'round-top3-table';
        rows.forEach(function(r) {
          var tr = document.createElement('tr');
          [['round-top3-rank', String(r.rank)], ['round-top3-name', String(r.name == null ? '' : r.name)],
           ['round-top3-score', String(r.score)]].forEach(function(cell) {
            var td = document.createElement('td');
            td.className = cell[0];
            td.textContent = cell[1];
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        sec.appendChild(table);
      }
      wrap.appendChild(sec);
    });
    return wrap;
  }

  // 順位を読み込んで box に上位 3 名を描く。取れなかったら理由と「↻ 最新に更新」を出す。
  // 描画を待たせないよう呼び出し側は await しない（通信中に画面を離れたら ctx.isStale() で捨てる）。
  async function fillTopThree(box, ctx) {
    box.textContent = '順位を読み込み中…';
    var data = await Api.loadRanking(ctx.eventId);
    if (ctx.isStale()) return;
    box.textContent = '';
    // 二巡目終了・最終結果: 上位 3 名の上にベスト4（合計）の 1 行（設計書 2026-10-04 D3。
    // 順位と同じ応答の best4 を使う）
    if (data && data.best4) box.appendChild(buildBest4Line(data.best4, box.id + 'Best4'));
    if (!data) {
      var fail = document.createElement('p');
      fail.className = 'round-rank-fail';
      fail.appendChild(document.createTextNode('順位を読み込めませんでした。'));
      var re = document.createElement('button');
      re.type = 'button';
      re.className = 'round-rank-reload';
      re.textContent = '↻ 最新に更新';
      re.addEventListener('click', function() { Admin.reloadEvent(); });
      fail.appendChild(re);
      box.appendChild(fail);
      return;
    }
    box.appendChild(buildTopThree(data));
  }

  function buildRankLink(ctx) {
    var a = document.createElement('a');
    a.className = 'round-rank-link';
    a.href = '#results/' + encodeURIComponent(ctx.eventId);
    a.textContent = '結果確認で全順位 →';
    return a;
  }

  // 二巡目終了: 状態の 1 行の下に順位の要約（遷移ボタンは段階表示の中）
  function buildSummary(ctx) {
    var sec = document.createElement('section');
    sec.className = 'round-summary';
    sec.id = 'roundSummary';
    var h = document.createElement('h3');
    h.textContent = '順位（上位 3 名）';
    sec.appendChild(h);
    var body = document.createElement('div');
    body.className = 'round-rank-body';
    body.id = 'roundSummaryBody';
    sec.appendChild(body);
    sec.appendChild(buildRankLink(ctx));
    fillTopThree(body, ctx).catch(function(e) { console.error(e); });
    return sec;
  }

  // 最終結果: 「表彰」の区画。上位 3 名と、発表・共有・成績表のボタン（処理は admin-results.js のものを呼ぶ）
  function buildAward(ctx) {
    var sec = document.createElement('section');
    sec.className = 'round-award';
    sec.id = 'roundAward';
    var h = document.createElement('h3');
    h.textContent = '表彰';
    sec.appendChild(h);
    var body = document.createElement('div');
    body.className = 'round-rank-body';
    body.id = 'roundAwardBody';
    sec.appendChild(body);
    sec.appendChild(buildRankLink(ctx));
    var bar = document.createElement('div');
    bar.className = 'round-award-bar';
    [
      ['btnRoundPresent', '発表モードで開く', 'present'],
      ['btnRoundCopy', '共有リンクをコピー', 'copyLink'],
      ['btnRoundHtml', '成績表（HTML）を保存', 'downloadHtml']
    ].forEach(function(d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.id = d[0];
      b.textContent = d[1];
      b.addEventListener('click', function() {
        if (window.AdminResults && typeof AdminResults[d[2]] === 'function') AdminResults[d[2]](b);
      });
      bar.appendChild(b);
    });
    sec.appendChild(bar);
    fillTopThree(body, ctx).catch(function(e) { console.error(e); });
    return sec;
  }

  // 二巡目 進行中: 暫定ベスト4（合計の上位 4 名と残り人数）の 1 行（設計書 2026-10-05 7.1）。
  // 文言は PC 運営と共通（Courts.best4LineText）。
  // ベスト4 は手元の選手の行から計算する（ranking API の best4 と同じ EventStatus.best4Standings。
  // 試合進行は読み直すたびに描き直すので、採点が入れば動く）。
  function best4Of(players) {
    var ev = CTX && CTX.event;
    return EventStatus.best4Standings(players, {
      status: EventStatus.of(ev),
      countAll: !(ev && typeof ev.status === 'string')
    });
  }

  function buildBest4Line(best4, id) {
    var p = document.createElement('p');
    p.className = 'round-best4-line';
    p.id = id || 'roundBest4Line';
    p.textContent = Courts.best4LineText(best4);
    return p;
  }

  // 状態の 1 行（PC 運営の工程表の 1 行と同じ文言。二巡目準備は下の注記が兼ねるので出さない）
  function stageTodo(st, players) {
    var nx = EventStatus.nextLabel(st, players);
    var b = nx ? '「' + nx + ' ▶」' : '';
    switch (st) {
      case 'draft':
        return '準備中です。選手と技をそろえたら' + b + 'を押します。';
      case 'round1':
        return '各コートで一巡目を採点しています。全コートの確定がそろったら' + b + 'を押します。';
      case 'round2':
        return '各コートで二巡目を採点しています。全員が斬り終わったら' + b + 'を押します。';
      case 'round2_done':
        return '二巡目が終わりました。下の順位を確かめて' + b + 'を押します。';
      case 'final':
        return '最終結果です。表彰は下の順位と発表モードで。得点・選手・技は編集できません。';
      case 'archived':
        return 'アーカイブ済みです。';
      default:
        return '';
    }
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
  // opts.resolveTo(players): 読み直した選手から行き先を決め直す関数（次へ進む・戻すは選手の
  //   データで行き先が変わる。読み直した結果が画面の行き先と違ったら進めずに描き直す）。
  // 状態を変える操作の最中か。読み直し・確認・送信の間は段階のボタンを止め、連打で二重に進めない
  // （PC 運営 desk.js の setStageButtonsDisabled と同じ。レビュー指摘 10）。
  var statusBusy = false;

  function setStageButtonsDisabled(flag) {
    ['btnRoundNext', 'btnRoundBack', 'btnRoundSkipRound2'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.disabled = flag;
    });
  }

  async function applyStatus(from, to, opts) {
    if (statusBusy) return;
    statusBusy = true;
    setStageButtonsDisabled(true);
    try {
      await applyStatusBody(from, to, opts);
    } finally {
      statusBusy = false;
      // 成功・読み直しで描き直した後のボタンにも当たるが、新しいボタンは元から押せるので無害
      setStageButtonsDisabled(false);
    }
  }

  async function applyStatusBody(from, to, opts) {
    var ctx = CTX;
    // 網羅検証 S3: 確認文の件数は「画面を開いた時点」の値だと、他の端末で採点が進んだあとに
    // 古い件数で聞いてしまう。確認を出す直前に大会を読み直して数える（PC 運営 desk.js と同じ）。
    var fresh = await Api.loadEventResult(ctx.eventId);
    if (ctx.isStale()) return;   // 通信中に大会やタブを切り替えられた
    if (!fresh.ok) {
      alert(fresh.status === 404 ? 'この大会は削除されています' : '大会データを取得できませんでした。通信を確認してください。');
      return;
    }
    var ev = fresh.event;
    var players = ev.players || [];
    var nowStatus = EventStatus.of(ev);
    if (nowStatus !== from) {
      // 画面が古い（他の端末が先に進めた・戻した）。想定外の状態へ行かないよう進めずに描き直す
      alert('他の端末で状態が変わっていました（いまは「' + (EventStatus.LABELS[nowStatus] || nowStatus) +
        '」）。画面を読み直します。\nもう一度確かめてから操作してください。');
      await Admin.reloadEvent();
      return;
    }
    if (opts && typeof opts.resolveTo === 'function') {
      var resolved = opts.resolveTo(players);
      if (resolved && resolved !== to) {
        alert('選手の状況が変わったため、進む先が変わります。画面を読み直します。\nもう一度確かめてから操作してください。');
        await Admin.reloadEvent();
        return;
      }
    }
    // 試合開始の前だけ、必須項目の未入力とレンタルの選手の技を見る（PC 運営の
    // desk.js の applyStatus と同じ判定・同じ文言。判定は courts.js に置いてある）。
    if (from === 'draft' && to === 'round1') {
      var blockers = Courts.startBlockers(ev, players);
      if (blockers.length > 0) { alert(Courts.blockerMessage(blockers)); return; }
    }
    // 二巡目の開始の前に、二巡目の行の形（表に無い技・同じ形・レンタルで選べない形）を見る
    // （設計書 2026-10-03 5.3。試合開始と同じ規則。直す場所はこの画面の形登録）。
    if (from === 'round1_done' && to === 'round2') {
      var r2Blockers = Courts.round2StartBlockers(ev, players);
      if (r2Blockers.length > 0) {
        alert(Courts.blockerMessage(r2Blockers, '二巡目を開始できません。形登録で直してください。'));
        return;
      }
    }
    if (!confirm(Courts.statusConfirmMessage(from, to, players))) return;
    // 網羅検証 S19: 画面が見ていた状態（from）を送る。違えばサーバーが 409 stale で断る
    var res = await Api.changeStatus(ctx.eventId, to, { from: from });
    if (ctx.isStale()) return;   // 通信中に大会やタブを切り替えられた
    // 追跡できない（CSV 由来の）二巡目の行が既にあると、一巡目終了は 409 exists で
    // いったん止まる。確認して承諾されたら force で再送する（レビュー指摘A）。
    if (res && !res.ok && res.reason === 'exists' && from === 'round1' && to === 'round1_done') {
      if (!confirm(Courts.nextRoundConflictMessage(res, '選手の区画でコートを設定してください'))) return;
      res = await Api.changeStatus(ctx.eventId, to, { from: from, force: true });
      if (ctx.isStale()) return;
    }
    if (!res) {
      alert('状態を変えられませんでした。通信を確認してください。');
      return;
    }
    if (!res.ok) {
      if (res.reason === 'stale') {
        // 画面が見ていた状態が古い。読み直して、もう一度確かめてもらう（S19）
        alert('他の端末で状態が変わっていました' +
          (res.currentStatus ? '（いまは「' + (EventStatus.LABELS[res.currentStatus] || res.currentStatus) + '」）' : '') +
          '。画面を読み直します。\nもう一度確かめてから操作してください。');
        await Admin.reloadEvent();
        return;
      }
      alert(res.error);
      // 読み直すのは他の端末が先に進めていた場合（transition）。
      // empty / no_round2 はこちらの入力不足であり、読み直しても状態は変わらない。
      if (res.reason === 'transition') {
        await Admin.reloadEvent();
      }
      return;
    }
    var toastMsg = EventStatus.LABELS[to] + ' にしました';
    if (res.round2 && res.round2.created > 0) {
      toastMsg += '（二巡目 ' + res.round2.created + ' 名' +
        (res.round2.fromRequest > 0 ? '／申請の形 ' + res.round2.fromRequest + ' 名' : '') + '）';
    }
    if (res.round2 && res.round2.untrackedCount > 0) {
      toastMsg += '（追跡できない二巡目の行が' + res.round2.untrackedCount + '件あります）';
    }
    Admin.toast(toastMsg);
    // 網羅検証 S13: コートが決まっていない一巡目の選手は二巡目に入らない。黙って外れないよう知らせる
    if (res.round2 && res.round2.unassignedCount > 0) {
      alert('⚠ コートが決まっていない（未分類の）選手が ' + res.round2.unassignedCount +
        ' 名います。二巡目には入っていません。\n選手登録でコートを設定し、一巡目に戻して終了し直してください。');
    }
    await Admin.reloadEvent();
  }

  // 試合進行タブの先頭の段階表示。現在の状態と「次へ進む」。
  // 件数は下の .round-stat（stageCountText）に出す。
  // 「戻す」と「二巡目なしで終了」は ⋯ メニュー（buildMenu）にある。
  function buildStage(st, players) {
    var wrap = document.createElement('div');
    wrap.className = 'round-stage';

    var label = document.createElement('div');
    label.className = 'round-stage-label';
    label.id = 'roundStageLabel';
    label.textContent = '現在の状態: ' + EventStatus.LABELS[st];
    wrap.appendChild(label);

    // 「次へ進む」の行き先とラベル（EventStatus.nextStep / nextLabel。players は今は使わないが、
    // 呼び出しの形は変えない。設計書 2026-10-05 2.1）。
    var next = EventStatus.nextStep(st, players);
    if (next) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'round-next';
      btn.id = 'btnRoundNext';
      btn.textContent = EventStatus.nextLabel(st, players) + ' ▶';
      btn.addEventListener('click', function() {
        applyStatus(st, next, { resolveTo: function(pl) { return EventStatus.nextStep(st, pl); } });
      });
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
    container.appendChild(buildStage(st, players));
    // 状態の 1 行（PC 運営の工程表の 1 行と同じ文言）と、二巡目 進行中の暫定ベスト4 の 1 行
    var todoText = stageTodo(st, players);
    if (todoText) {
      var todoEl = document.createElement('p');
      todoEl.className = 'round-todo';
      todoEl.id = 'roundTodo';
      todoEl.textContent = todoText;
      container.appendChild(todoEl);
    }
    if (st === 'round2') {
      container.appendChild(buildBest4Line(best4Of(players)));
    }
    // 二巡目終了は順位の要約、最終結果は「表彰」の区画（アーカイブは要約だけ）。
    // 自動で結果確認へは移さない（ユーザー決定）。
    if (st === 'round2_done' || st === 'archived') container.appendChild(buildSummary(ctx));
    if (st === 'final') container.appendChild(buildAward(ctx));

    // 技を入れられるのは「一巡目終了」のときだけ（PC 運営 desk-match.js の editable と同じ）。
    // それ以外の状態では行タップ・チップ・「一巡目と同じ技をコピー」を止め、同じ注記を出す
    // （注記は二巡目の節＝ counterEl／listEl の直前に置く。desk-match.js の「二巡目」見出し
    // 直下と同じ位置）。
    editable = (st === 'round1_done');

    // 見出し：採点の進み具合・メニュー（二巡目はサーバーが一巡目終了で作るので、生成ボタンは無い）
    var head = document.createElement('div');
    head.className = 'round-head';
    var stat = document.createElement('div');
    stat.className = 'round-stat';
    stat.id = 'roundScoredStat';
    stat.textContent = Courts.stageCountText(st, players);
    statEl = stat;
    statStatus = st;
    head.appendChild(stat);
    // 採点画面へ（絞り込み中のコートを引き継ぐ。採点画面の Route と同じ形 #event/<大会ID>/<コート>）
    var openBtn = document.createElement('a');
    openBtn.className = 'round-open';
    openBtn.id = 'btnOpenScoring';
    openBtn.textContent = '採点画面へ';
    openBtn.href = Admin.scoringHref(ctx.eventId, currentCourt);
    head.appendChild(openBtn);
    // 閲覧専用 URL（共有リンク）は結果確認タブの「共有リンクをコピー」に任せる（2026-09-30 に見出しから外した）
    // ⋯（戻す・二巡目なしで終了）は項目が無い段階（準備中）では出さない
    var menu = buildMenu(st, players);
    if (menu) head.appendChild(menu);
    container.appendChild(head);

    // 二巡目終了以降は、コートの一覧（絞り込み・注記・件数・行）を「二巡目の明細」として
    // 折りたたむ（既定は閉じる）。見るのは順位、明細は必要なときだけ開く。
    var body = container;
    if (st === 'round2_done' || st === 'final' || st === 'archived') {
      var detail = document.createElement('details');
      detail.className = 'round-detail';
      detail.id = 'roundDetail';
      var dsum = document.createElement('summary');
      dsum.textContent = '二巡目の明細';
      detail.appendChild(dsum);
      container.appendChild(detail);
      body = detail;
    }

    // コート絞り込み。チップは大会全体のコートから作る。
    // 二巡目が未生成のときにチップ列が消えないようにするため。
    var chipsWrap = document.createElement('div');
    chipsWrap.className = 'court-chips round-courts';
    body.appendChild(chipsWrap);
    function onCourtChange(court) {
      currentCourt = court;
      Admin.renderCourtChips(chipsWrap, players, currentCourt, onCourtChange);
      openBtn.href = Admin.scoringHref(ctx.eventId, currentCourt);
      renderList();
    }
    Admin.renderCourtChips(chipsWrap, players, currentCourt, onCourtChange);

    var guide = document.createElement('p');
    guide.className = 'round-note';
    if (editable) {
      // 二巡目の行は、申請された二巡目の形（申請の無い人は一巡目の形）で作ってある
      // （設計書 2026-10-03 7.2）。直した形は申請にも書き戻される（サーバー）。
      guide.textContent = '二巡目の形登録。申請された二巡目の形（申請の無い人は一巡目の形）が入っています。' +
        '当日の変更があればここで直してください（直すと申請にも書き戻されます）。' +
        '確かめ終えたら、上の「二巡目を開始 ▶」を押します。試技順は一巡目の得点が低い順です。';
    } else {
      guide.textContent = '形を直せるのは「' + EventStatus.LABELS.round1_done + '」のときだけです（いまは「' +
        EventStatus.LABELS[st] + '」）。直すときは「⋯」の「戻す」で戻してください。';
    }
    body.appendChild(guide);

    counterEl = document.createElement('div');
    counterEl.className = 'round-counter';
    counterEl.id = 'roundCounter';
    body.appendChild(counterEl);

    listEl = document.createElement('div');
    listEl.className = 'round-list';
    listEl.id = 'roundList';
    body.appendChild(listEl);

    // 一覧の末尾から、上の「二巡目を開始 ▶」（段階表示）へ戻る近道（長い一覧の末尾で、
    // 遷移ボタンが画面の上にあることに気づくため）。遷移ボタンそのものは段階表示の 1 つだけ。
    if (editable) {
      var toStage = document.createElement('button');
      toStage.type = 'button';
      toStage.className = 'btn-sub round-to-stage';
      toStage.id = 'btnRoundToStage';
      toStage.textContent = '▲ 確かめ終えたら、上の「二巡目を開始 ▶」へ';
      toStage.addEventListener('click', function() {
        var stageEl = container.querySelector('.round-stage');
        if (stageEl) stageEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
        var nextBtn = document.getElementById('btnRoundNext');
        if (nextBtn) nextBtn.focus({ preventScroll: true });
      });
      container.appendChild(toStage);
    }

    renderList();
  }

  function renderList() {
    listEl.innerHTML = '';
    var rows = visibleRows();
    if (rows.length === 0) {
      var p = document.createElement('p');
      p.className = 'round-empty';
      p.textContent = '二巡目の選手はいません。上部の ⋯ から一巡目に戻ると作り直せます。';
      listEl.appendChild(p);
    } else {
      // 全行を試技順に並べる
      rows.forEach(function(r) { listEl.appendChild(buildRow(r)); });
    }
    updateCounter();
  }

  function updateCounter() {
    if (statEl && statStatus && CTX) statEl.textContent = Courts.stageCountText(statStatus, CTX.players || []);
    if (!counterEl) return;
    var rows = visibleRows();
    // 申請どおりの 2 本の二巡目の行は未入力に数えない（Courts.isTechMissing。通し試験の確認 1）
    var n = rows.filter(function(p) { return Courts.isTechMissing(p, (CTX && CTX.players) || []); }).length;
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
    // 一巡目の得点は確定済みだけ出す（採点途中の値は順位にも入らない。網羅検証 S10）
    prev.textContent = '一巡目 ' + ((src && src.confirmed === true) ? String(src.score || 0) : '—');
    if (src && src.confirmed !== true) prev.title = '一巡目が未確定です';
    // 二巡目の行を作ったときから形が変わったか（一巡目の行と比べる）。「一巡目と同じ／変更」の札
    var diff = document.createElement('span');
    diff.className = 'round-diff';
    top.appendChild(name);
    top.appendChild(diff);
    top.appendChild(prev);
    row.appendChild(top);
    updateDiffBadge(p, diff);

    // chips-required: 空きのチップを赤くする（admin.css）
    var chips = document.createElement('div');
    chips.className = 'round-chips chips chips-required';
    row.appendChild(chips);
    // 同じ形の回数制限の注記（設計書 2026-09-20-rules-alignment-design.md）。
    // 保存は通す（試合開始でだけ止める）ので、赤枠ではなく文言だけ添える。
    var note = document.createElement('p');
    note.className = 'field-note tech-dup-note';
    row.appendChild(note);
    drawChips(p, row);

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'round-copy';
    // 初期値が既に一巡目の複製なので「コピー」ではなく「戻す」（PC 運営と同じ理由）。
    copy.textContent = '一巡目と同じ形に戻す';
    if (!editable) {
      copy.disabled = true;
      copy.title = '「一巡目終了」のときだけ戻せます';
    } else if (!src) {
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
    // 技を入れられるのは「一巡目終了」のときだけ（editable）。それ以外は行タップもチップも
    // 反応させない（drawChips 側で個々のチップの click も無効にする）。
    if (editable) {
      row.addEventListener('click', function() {
        var arr = TechPicker.fromArray([p.tech1, p.tech2, p.tech3]);
        var slot = 0;
        for (var i = 0; i < arr.length; i++) {
          if (!arr[i]) { slot = i; break; }
        }
        openPicker(p, row, slot);
      });
    }
    return row;
  }

  // 「一巡目と同じ／変更」の札（Courts.round2Differs）。一巡目の行が無ければ出さない
  function updateDiffBadge(p, badge) {
    if (!badge) return;
    if (!sourceOf(p)) { badge.textContent = ''; badge.className = 'round-diff'; return; }
    var differs = Courts.round2Differs(p, CTX ? CTX.players : []);
    badge.textContent = differs ? '変更' : '一巡目と同じ';
    badge.className = 'round-diff ' + (differs ? 'changed' : 'same');
    badge.title = differs ? '一巡目と違う形です' : '一巡目と同じ形です';
  }

  function drawChips(p, row) {
    updateDiffBadge(p, row.querySelector('.round-diff'));
    var chipsEl = row.querySelector('.round-chips');
    // 技を入れられるのは「一巡目終了」のときだけ。それ以外は onTap を渡さず
    // （TechPicker.renderChips は techpicker.js 側の共有部品でこの計画では触らないので、
    // 描いた後にここで disabled にする）、チップを押しても開かないようにする。
    TechPicker.renderChips(
      chipsEl,
      TechPicker.fromArray([p.tech1, p.tech2, p.tech3]),
      editable ? function(slot) { openPicker(p, row, slot); } : null
    );
    if (!editable) {
      var chipButtons = chipsEl.querySelectorAll('button');
      for (var i = 0; i < chipButtons.length; i++) chipButtons[i].disabled = true;
    }
    updateRepeatNote(p, row);
  }

  // 同じ形の回数制限の注記。技リストが手元に無ければ判定できないので何も出さない
  // （設計書 2026-09-20-rules-alignment-design.md「同じ形の回数制限」）。
  function updateRepeatNote(p, row) {
    var note = row.querySelector('.tech-dup-note');
    if (!note) return;
    if (!techniques) { note.textContent = ''; return; }
    var dup = Courts.duplicateForms([p.tech1, p.tech2, p.tech3], techniques, !!p.isFemale);
    note.textContent = dup.length > 0 ? '同じ形は 1 回までです（' + dup[0] + '）' : '';
  }

  // --- 技の入力 ---

  // 技リストは render で ctx.techniques から入る。取れていなければ大会を開き直してもらう。
  function ensureTechniques() {
    if (techniques) return true;
    alert('技術リストを取得できませんでした。大会を開き直してください。');
    return false;
  }

  // 性別で絞った選択肢に、いま選んでいる技（tech1〜3）が無ければ足す。接尾辞付きの
  // 旧データ（破図味(男) など）を持つ選手でも、シートにその行が出て①などの印が付くように。
  // admin-players.js の同名の関数と同じ規則（courts.js を共有しない2画面なので複製する）。
  function withCurrentTechniques(list, techList, names, isFemale) {
    var out = list.slice();
    (names || []).forEach(function(name) {
      if (!name) return;
      if (out.some(function(t) { return t.name === name; })) return;
      var resolved = Courts.resolveTechnique(techList, name, isFemale);
      out.push(resolved || { name: name, strikes: [null, null, null, null] });
    });
    return out;
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
      // レンタルの選手には抜刀後の形だけを出す（PC の二巡目の表と同じ規則）。
      // いま選んである技が候補から外れても withCurrentTechniques が足すので、
      // ①②③ の印は消えない（外れている技は「試合開始」の判定では止められない
      //   二巡目なので、運営が見て直す）。
      techniques: withCurrentTechniques(
        Courts.techniqueOptions(techniques, !!p.isFemale, p.rental === true),
        techniques, latest, !!p.isFemale),
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
    // 確認を承諾したら force: true を付けて送る（サーバーは force なしだと 409 scored。網羅検証 S7）。
    var patch = { tech1: arr[0], tech2: arr[1], tech3: arr[2] };
    var forced = false;
    if (Courts.scoreMayChange(p, patch)) {
      if (!confirm(Courts.scoreChangeConfirmMessage(p))) {
        drawChips(p, row);
        return false;
      }
      forced = true;
    }
    var res = await Api.updatePlayerInfo(eventId, p.id, forced ? Object.assign({ force: true }, patch) : patch);
    if (ctx.isStale()) return !!(res && res.ok);   // 画面を離れていたら DOM に触れない（alert もしない）
    if (res && !res.ok && res.reason === 'scored' && !forced) {
      // 画面の控えが古く、その間に採点されていた。同じ確認を出し、承諾されたら force で送り直す
      if (!confirm(Courts.scoreChangeConfirmMessage(res.player || p))) {
        drawChips(p, row);
        return false;
      }
      res = await Api.updatePlayerInfo(eventId, p.id, Object.assign({ force: true }, patch));
      if (ctx.isStale()) return !!(res && res.ok);
    }
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
    if (ok) Admin.toast('一巡目と同じ形に戻しました');
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
        applyStatus(st, back, { resolveTo: function(pl) { return EventStatus.prev(st, pl); } });
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

    // CSV エクスポートは結果確認タブへ移した（1 画面 1 目的。ユーザー要望 2026-09-30）
    if (!back && st !== 'round1_done') return null;   // 項目が無ければ ⋯ ごと出さない
    return menu;
  }

  Admin.registerTab('round', { render: render });

  return {
    render: render
  };
})();
