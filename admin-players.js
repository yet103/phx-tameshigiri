// 選手タブ（#players/<大会ID>）。選手の一覧・追加・編集・削除。
(function() {
  var currentCourt = '';
  var courtOwner = null;   // currentCourt がどの大会のものか（大会が変われば全コートに戻す）
  var techCache = null;    // Api.loadTechniques() の techniques

  // 採点済みかどうか。サーバーの isScored と同じ判定を持つ。
  // result は 1=○, 0=×, 空白=未入力 でエンコードされている。
  function isScored(p) {
    if (!p) return false;
    if (typeof p.score === 'number' && p.score > 0) return true;
    return /[01]/.test(p.result || '');
  }

  // 行の並び順。order 文字列をそのまま比較すると 1-10 が 1-2 より前に来るので、
  // 巡目 → コート → 性別（男子が先）→ 番号 に分解して比べる。
  function orderKey(p) {
    var m = String((p && p.order) || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    if (!m) return { court: Courts.courtOf(p), sex: 2, round: 1, no: 0 };
    return {
      court: m[1],
      sex: m[2] === '男子' ? 0 : 1,
      round: parseInt(m[3], 10),
      no: parseInt(m[4], 10)
    };
  }

  function compareOrder(a, b) {
    var x = orderKey(a), y = orderKey(b);
    if (x.round !== y.round) return x.round - y.round;
    if (x.court !== y.court) return x.court < y.court ? -1 : 1;
    if (x.sex !== y.sex) return x.sex - y.sex;
    return x.no - y.no;
  }

  async function render(container, ctx) {
    if (courtOwner !== ctx.eventId) {
      currentCourt = '';
      courtOwner = ctx.eventId;
    }

    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '選手 ' + ctx.players.length + '名';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.appendChild(h2);
    head.appendChild(spacer);
    container.appendChild(head);

    var chips = document.createElement('div');
    chips.className = 'court-chips';
    container.appendChild(chips);

    var list = document.createElement('div');
    list.className = 'list';
    container.appendChild(list);

    // コートを切り替えたらチップと一覧を描き直す
    function onCourtChange(court) {
      currentCourt = court;
      Admin.renderCourtChips(chips, ctx.players, currentCourt, onCourtChange);
      renderList(list, ctx);
    }
    Admin.renderCourtChips(chips, ctx.players, currentCourt, onCourtChange);
    renderList(list, ctx);

    // 技術リストは追加・編集フォームで使う。タブを開いたときに1回だけ取る。
    if (!techCache) {
      var td = await Api.loadTechniques();
      if (td && td.techniques) techCache = td.techniques;
    }
  }

  function renderList(list, ctx) {
    list.innerHTML = '';
    var rows = Courts.filter(ctx.players, currentCourt).slice().sort(compareOrder);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'empty';
      none.textContent = ctx.players.length === 0
        ? '選手がまだいません。右下の「＋」で追加してください。'
        : 'このコートに選手がいません。';
      list.appendChild(none);
      return;
    }
    rows.forEach(function(p) {
      list.appendChild(buildRow(ctx, p));
    });
  }

  function buildRow(ctx, p) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';

    var badge = document.createElement('span');
    badge.className = 'row-badge';
    badge.textContent = String(Courts.roundOf(p));

    var body = document.createElement('span');
    body.className = 'row-body';
    var main = document.createElement('span');
    main.className = 'row-main';
    main.textContent = (p.order || '') + '  ' + (p.name || '');
    var sub = document.createElement('span');
    sub.className = 'row-sub';
    var techs = [p.tech1, p.tech2, p.tech3].filter(function(t) { return !!t; });
    sub.textContent = techs.length ? techs.join(' / ') : '技 未入力';
    // admin.css の .row-main/.row-sub は ellipsis 用のプロパティだけ持ち、
    // display は未指定。<span> のままだと横並びのまま省略記号が効かず縦に
    // 積まれないので、ここで明示的にブロック化する。
    main.style.display = 'block';
    sub.style.display = 'block';
    body.appendChild(main);
    body.appendChild(sub);

    var score = document.createElement('span');
    score.className = 'row-score';
    score.textContent = String(p.score || 0);

    row.appendChild(badge);
    row.appendChild(body);
    row.appendChild(score);
    return row;
  }

  Admin.registerTab('players', { render: render });
})();
