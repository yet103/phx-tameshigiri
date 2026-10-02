// 採点端末の招待（QR）と AI 用キー（PC 運営）。
// 設計書: docs/superpowers/specs/2026-10-03-invite-links-and-ai-key-design.md の 6.2・6.3・6.7。
//
// - 試合進行（desk-match.js）が openInviteDialog（コートのカードのボタン）と
//   buildInvitesSection（区画「招待した端末」）を使う。
// - 大会一覧（desk-events.js）が mountAiKeys（区画「AI 用キー」）を使う。
// - 基本情報（desk-setup.js）が sandboxRenameMessage（大会名を「テスト用」で始まる名前に
//   変えるときの確認）を使う。
//
// 鍵（採点の招待）と AI 用キーは、発行の応答に 1 回だけ載る。この画面はそれをクロージャの変数に
// 持ち、ダイアログを閉じるときに捨てる。localStorage・sessionStorage・URL・ログには書かない。
// サーバーとの通信は Api.*（api.js。invite_api.md の形: 失敗は { ok:false, status, reason, error }）。
// QR は vendor/qrcode.js（qrcode-generator）で作り、自前で SVG に描く（外部に頼らない）。
// スマホ運営（admin.html）には置かない（設計書 D17）。
var DeskInvites = (function() {
  // サーバーの isSandboxName と同じ判定（trim のあと前方一致）。AI が書ける大会の目印
  var SANDBOX_PREFIX = 'テスト用';
  var DOW = ['日', '月', '火', '水', '木', '金', '土'];
  var MAX_DEVICES = 5;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function button(label, cls, onClick) {
    var b = el('button', cls, label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  // --- 純粋な部品（test.html で固定できる） ---

  function isSandboxName(name) {
    return typeof name === 'string' && name.trim().indexOf(SANDBOX_PREFIX) === 0;
  }

  // 大会名を変えて保存するときの確認文。「テスト用」で始まらない名前から始まる名前に変わるときだけ
  // 文を返す（AI が書き込める大会になる。T14）。外す向き・そのままのときは ''。
  function sandboxRenameMessage(oldName, newName) {
    if (isSandboxName(newName) && !isSandboxName(oldName)) {
      return 'この大会は AI が書き込める大会になります（名前が「' + SANDBOX_PREFIX + '」で始まるため）。\n' +
        'よろしいですか？';
    }
    return '';
  }

  // 日本時間の「10/12(日) 23:59」。端末の時計や時差に依らない（日本に夏時間は無い）。読めなければ「—」
  function formatJst(iso) {
    if (!iso) return '—';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '—';
    var d = new Date(t + 9 * 3600 * 1000);
    var hh = String(d.getUTCHours());
    var mi = String(d.getUTCMinutes());
    if (hh.length < 2) hh = '0' + hh;
    if (mi.length < 2) mi = '0' + mi;
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + DOW[d.getUTCDay()] + ') ' + hh + ':' + mi;
  }

  function inviteStatusLabel(inv) {
    if (!inv) return '—';
    if (inv.status === 'revoked') {
      return inv.revokedReason === 'event_deleted' ? '取り消し済み（大会を削除）' : '取り消し済み';
    }
    if (inv.status === 'expired') return '期限切れ';
    if (inv.status === 'active') return '有効';
    return String(inv.status || '—');
  }

  function deviceStatusLabel(dev) {
    var s = dev && dev.status;
    if (s === 'active') return '有効';
    if (s === 'revoked') return '外した';
    if (s === 'expired') return '期限切れ';
    return String(s || '—');
  }

  function keyStatusLabel(k) {
    var s = k && k.status;
    if (s === 'active') return '有効';
    if (s === 'revoked') return '取り消し済み';
    if (s === 'expired') return '期限切れ';
    return String(s || '—');
  }

  // 大会の日（YYYY-MM-DD）の終わり（日本時間）が、nowMs から 7 日より先か。日付が読めなければ false
  function tooFarAhead(dateStr, nowMs) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    var end = new Date(dateStr + 'T23:59:59.999+09:00').getTime();
    if (isNaN(end)) return false;
    return end - nowMs > 7 * 24 * 3600 * 1000;
  }

  function courtLabel(court) {
    return court ? court + ' コート' : '全コート';
  }

  function defaultLabel(court) {
    return court ? court + ' コート タブレット' : '全コート タブレット';
  }

  // --- QR ---

  // 文字列を QR（誤り訂正 M・型番は自動）にした行列。dark なら true。大きさは 型番 × 4 + 17
  function qrMatrix(text) {
    if (typeof qrcode !== 'function') throw new Error('qrcode が読み込まれていません');
    var qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    var n = qr.getModuleCount();
    var rows = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) row.push(qr.isDark(r, c));
      rows.push(row);
    }
    return rows;
  }

  // 行列を SVG に描く。余白は 4 モジュール。ダークテーマでも白地・黒で描く（読み取れなくなるため）
  function qrSvg(text, size) {
    var m = qrMatrix(text);
    var n = m.length;
    var margin = 4;
    var dim = n + margin * 2;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + dim + ' ' + dim);
    svg.setAttribute('width', String(size || 280));
    svg.setAttribute('height', String(size || 280));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '採点端末の登録用の QR コード');
    svg.setAttribute('shape-rendering', 'crispEdges');
    var bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', String(dim));
    bg.setAttribute('height', String(dim));
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);
    var d = '';
    for (var y = 0; y < n; y++) {
      var x = 0;
      while (x < n) {
        if (!m[y][x]) { x++; continue; }
        var start = x;
        while (x < n && m[y][x]) x++;
        d += 'M' + (start + margin) + ' ' + (y + margin) + 'h' + (x - start) + 'v1h-' + (x - start) + 'z';
      }
    }
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#000000');
    svg.appendChild(path);
    return svg;
  }

  // --- 通信の薄い包み ---

  function isFail(res) {
    return !res || res.ok === false;
  }

  function errText(res, fallback) {
    if (!res || res.status === 0) return '通信できません。通信を確認してください。';
    if (res.reason === 'rate_limited') return 'しばらく待ってからもう一度お試しください。';
    return res.error || fallback;
  }

  function call(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (typeof Api[name] !== 'function') {
      return Promise.resolve({ ok: false, status: 0, error: 'この画面の通信部品（api.js の ' + name + '）がありません。画面を読み込み直してください。' });
    }
    return Api[name].apply(Api, args);
  }

  // --- 共通のダイアログ部品 ---

  var fieldSeq = 0;

  function addField(form, labelText, input) {
    var label = el('label', null, labelText);
    if (!input.id) input.id = 'inv_' + (++fieldSeq);   // 呼び出し側が id を決めていればそれを使う
    label.htmlFor = input.id;
    form.appendChild(label);
    form.appendChild(input);
    return input;
  }

  function maskedSecret(id) {
    var box = el('code', 'desk-secret');
    box.id = id;
    box.textContent = '（伏せています。「表示」で出ます）';
    return box;
  }

  // 秘密の文字列を伏せて持つ行: [枠] [表示/伏せる] [コピー]。秘密は get() で毎回取り出す（捨てたあとは空）
  function secretRow(boxId, get, copyLabel, copyOk) {
    var row = el('div', 'desk-secret-row');
    var box = maskedSecret(boxId);
    var shown = false;
    var btnShow = button('表示', 'desk-btn', null);
    var btnCopy = button(copyLabel, 'desk-btn primary', null);
    function paint() {
      var v = get();
      if (!v) { box.textContent = '（閉じたので表示できません）'; return; }
      box.textContent = shown ? v : '（伏せています。「表示」で出ます）';
      btnShow.textContent = shown ? '伏せる' : '表示';
    }
    btnShow.addEventListener('click', function() { shown = !shown; paint(); });
    btnCopy.addEventListener('click', function() {
      var v = get();
      if (!v) return;
      Desk.copyText(v, copyOk);
    });
    row.appendChild(box);
    row.appendChild(btnShow);
    row.appendChild(btnCopy);
    return row;
  }

  // ==========================================================
  // 採点端末の招待（試合進行）
  // ==========================================================

  // いま画面にある区画「招待した端末」の読み直し（無ければ何もしない）。カードのボタンから発行したあと用
  var invitesReload = null;
  function refreshInvites() {
    if (typeof invitesReload === 'function') invitesReload();
  }

  function courtChoices(ctx) {
    var extra = (ctx.event && ctx.event.settings && ctx.event.settings.courts) || [];
    return Courts.listFrom(ctx.players || [], extra).filter(function(c) { return c !== Courts.UNASSIGNED; });
  }

  // 発行ダイアログ。court は開いたカードのコート（省略・空なら先頭のコート）。
  // 発行したら同じダイアログの中身を QR に差し替える。閉じるとき鍵を捨て、onChanged（一覧の読み直し）を呼ぶ。
  function openInviteDialog(ctx, court, onChanged) {
    if (typeof onChanged !== 'function') onChanged = refreshInvites;   // 区画「招待した端末」を読み直す
    var courts = courtChoices(ctx);
    var startCourt = court || courts[0] || '';
    var issued = false;
    var secret = { url: null };   // 鍵つき URL。この変数だけが持つ。閉じるとき null にする

    var wrap = el('div');
    var form = el('div', 'desk-form');

    var selCourt = el('select');
    selCourt.id = 'inviteCourt';
    courts.forEach(function(c) {
      var o = el('option', null, c + ' コート');
      o.value = c;
      selCourt.appendChild(o);
    });
    var oAll = el('option', null, '全コート（すべてのコートで採点できる）');
    oAll.value = '';
    selCourt.appendChild(oAll);
    selCourt.value = startCourt;
    addField(form, 'コート', selCourt);

    var inLabel = el('input');
    inLabel.type = 'text';
    inLabel.id = 'inviteLabel';
    inLabel.maxLength = 40;
    inLabel.value = defaultLabel(startCourt);
    addField(form, 'ラベル', inLabel);
    var labelTouched = false;
    inLabel.addEventListener('input', function() { labelTouched = true; });
    selCourt.addEventListener('change', function() {
      if (!labelTouched) inLabel.value = defaultLabel(selCourt.value);
    });

    var selExpiry = el('select');
    selExpiry.id = 'inviteExpiry';
    var evDate = ctx.event && ctx.event.date;
    // サーバーは期限を「今から 7 日後まで」に絞る。大会の日が 7 日より先なら「大会の日の終わり」は断られるので、
    // 選べなくして理由を書く（その日が近づいてから発行する）。判定の元はサーバー、ここは目印だけ
    var farAway = tooFarAhead(evDate, Date.now());
    [
      ['event', '大会の日の終わり' + (evDate ? '（' + evDate + (farAway ? '。7 日より先のため、近づいてから' : '') + '）' : '（日付がなければ今日の終わり）')],
      ['today', '今日の終わり'],
      ['tomorrow', '明日の終わり']
    ].forEach(function(p) {
      var o = el('option', null, p[1]);
      o.value = p[0];
      if (p[0] === 'event' && farAway) o.disabled = true;
      selExpiry.appendChild(o);
    });
    selExpiry.value = farAway ? 'today' : 'event';
    addField(form, '期限', selExpiry);

    var inDevices = el('input');
    inDevices.type = 'number';
    inDevices.id = 'inviteDevices';
    inDevices.min = '1';
    inDevices.max = String(MAX_DEVICES);
    inDevices.step = '1';
    inDevices.value = '2';
    addField(form, '端末の数', inDevices);

    wrap.appendChild(form);
    wrap.appendChild(el('p', 'desk-note',
      'この QR は採点ができる鍵です。期限は日本時間の 23:59 までです。端末の数は、この QR で登録できる台数の上限です' +
      '（超えると 3 台目以降は断られ、下の一覧に出ます）。'));

    var btnCreate = button('発行する', 'desk-btn primary', null);
    btnCreate.id = 'btnInviteCreate';
    var btnDone = button('閉じる', 'desk-btn', null);
    btnDone.id = 'btnInviteDone';
    btnDone.hidden = true;

    var dialog = Desk.openDialog('採点端末を招待（QR）', wrap, [btnCreate, btnDone], function() {
      secret.url = null;   // 鍵を捨てる
      if (issued && typeof onChanged === 'function') onChanged();
    });
    btnDone.addEventListener('click', function() { dialog.close(); });

    btnCreate.addEventListener('click', async function() {
      var max = Number(inDevices.value);
      if (!Number.isInteger(max) || max < 1 || max > MAX_DEVICES) {
        alert('端末の数は 1〜' + MAX_DEVICES + ' の整数で入力してください。');
        return;
      }
      var label = inLabel.value.trim() || defaultLabel(selCourt.value);
      btnCreate.disabled = true;
      dialog.lock(true);
      var res = await call('createInvite', {
        role: 'scorer',
        eventId: ctx.eventId,
        court: selCourt.value || null,
        label: label,
        maxDevices: max,
        expiresPreset: selExpiry.value
      });
      dialog.lock(false);
      if (isFail(res) || !res.key || !res.invite) {
        btnCreate.disabled = false;
        alert('招待を発行できませんでした。\n' + errText(res, '通信を確認してください。'));
        return;
      }
      issued = true;
      var path = res.joinPath || ('/join#k=' + res.key);
      secret.url = location.origin + path;
      btnCreate.hidden = true;
      btnDone.hidden = false;
      showIssued(wrap, res.invite, secret, ctx);
    });
  }

  // 発行直後の表示（QR・注意・URL）。鍵が見えるのはここだけ
  function showIssued(wrap, invite, secret, ctx) {
    wrap.innerHTML = '';
    var target = el('p', 'desk-invite-target');
    target.id = 'inviteIssuedInfo';
    target.textContent = (ctx.event && ctx.event.name ? ctx.event.name + ' ・ ' : '') +
      courtLabel(invite.court) + ' ・ ' + (invite.label || '') + ' ・ 期限 ' + formatJst(invite.expiresAt) +
      ' ・ 端末は ' + invite.maxDevices + ' 台まで';
    wrap.appendChild(target);

    var warn = el('p', 'desk-warn',
      'この QR は採点ができる鍵です。会場でタブレットのカメラに読み取らせてください。' +
      '写真に撮って送らない・他の人に見せないでください。' +
      'この画面を閉じると二度と表示できません（必要なら新しく発行してください）。');
    warn.id = 'inviteIssuedWarn';
    wrap.appendChild(warn);

    var qrBox = el('div', 'desk-qr-box');
    qrBox.id = 'inviteQr';
    try {
      qrBox.appendChild(qrSvg(secret.url, 280));
    } catch (e) {
      console.error(e);
      qrBox.appendChild(el('p', 'desk-warn', 'QR を作れませんでした。下の URL をコピーして、タブレットで開いてください。'));
    }
    wrap.appendChild(qrBox);

    wrap.appendChild(secretRow('inviteUrl', function() { return secret.url; },
      'URL をコピー', '鍵つき URL をコピーしました（他の人に見せないでください）'));
    wrap.appendChild(el('p', 'desk-note',
      'タブレットのカメラで QR を読み取り、開いた画面で「この端末を登録する」を押すと、この端末が採点端末になります。'));
  }

  // 区画「招待した端末」。試合進行の末尾に置く（読み込みは開いたときと「↻ 更新」だけ。自動更新はしない）
  function buildInvitesSection(ctx) {
    var sec = el('section', 'desk-invites');
    sec.id = 'invitesSection';

    var head = el('div', 'desk-section-head');
    head.appendChild(el('h2', null, '招待した端末'));
    head.appendChild(el('div', 'spacer'));
    var btnReload = button('↻ 更新', 'desk-btn', function() { load(); });
    btnReload.id = 'btnInvitesReload';
    head.appendChild(btnReload);
    var btnNew = button('📱 採点端末を招待（QR）', 'desk-btn invite', function() {
      openInviteDialog(ctx, '', load);
    });
    btnNew.id = 'btnInviteNew';
    head.appendChild(btnNew);
    sec.appendChild(head);

    sec.appendChild(el('p', 'desk-note',
      '知らない端末に見えたら「この端末を外す」を押してください。QR は会場の画面で読み取らせ、写真で送らないでください。' +
      '一覧は開いたときと「↻ 更新」で読み直します。'));

    var box = el('div');
    box.id = 'invitesList';
    sec.appendChild(box);

    var open = Object.create(null);   // 端末の行を開いている招待（読み直しても開いたまま）

    async function load() {
      box.innerHTML = '';
      box.appendChild(el('p', 'desk-empty', '読み込み中…'));
      var res = await call('listInvites', ctx.eventId);
      if (ctx.isStale() || !sec.isConnected) return;
      box.innerHTML = '';
      if (!Array.isArray(res)) {
        box.appendChild(el('p', 'desk-empty', '招待の一覧を取得できませんでした。' + errText(res, '')));
        return;
      }
      if (res.length === 0) {
        box.appendChild(el('p', 'desk-empty', 'まだ招待していません。コートのカードの「📱 この端末を招待（QR）」から発行します。'));
        return;
      }
      box.appendChild(buildInvitesTable(res));
    }

    function buildInvitesTable(list) {
      var table = el('table', 'desk-table desk-invites-table');
      table.innerHTML = '<thead><tr><th>ラベル</th><th>コート</th><th>期限</th><th>状態</th>' +
        '<th>最終利用</th><th>端末</th><th></th></tr></thead>';
      var tbody = el('tbody');
      list.forEach(function(inv) {
        var active = inv.status === 'active';
        var tr = el('tr', active ? '' : 'inactive');
        tr.setAttribute('data-invite', inv.id);
        tr.appendChild(td(inv.label || '—', 'desk-cell-main'));
        tr.appendChild(td(courtLabel(inv.court)));
        tr.appendChild(td(formatJst(inv.expiresAt)));
        var tdSt = el('td');
        tdSt.appendChild(el('span', 'desk-badge' + (active ? ' on' : ''), inviteStatusLabel(inv)));
        tr.appendChild(tdSt);
        tr.appendChild(td(formatJst(inv.lastJoinAt)));
        var devs = Array.isArray(inv.devices) ? inv.devices : [];
        var activeN = typeof inv.activeDevices === 'number' ? inv.activeDevices
          : devs.filter(function(d) { return d.status === 'active'; }).length;
        tr.appendChild(td(activeN + ' / ' + inv.maxDevices, 'num'));

        var tdAct = el('td', 'act');
        var devRow = null;
        if (devs.length > 0) {
          var btnDev = button((open[inv.id] ? '▾ ' : '▸ ') + '端末（' + devs.length + '）', 'desk-btn-sub', null);
          btnDev.addEventListener('click', function() {
            open[inv.id] = !open[inv.id];
            btnDev.textContent = (open[inv.id] ? '▾ ' : '▸ ') + '端末（' + devs.length + '）';
            devRow.hidden = !open[inv.id];
          });
          tdAct.appendChild(btnDev);
        }
        if (active) {
          tdAct.appendChild(button('取り消す', 'desk-btn-sub danger', function() { revokeInvite(inv, activeN); }));
        }
        tr.appendChild(tdAct);
        tbody.appendChild(tr);

        if (devs.length > 0) {
          devRow = el('tr', 'desk-invites-devices');
          devRow.hidden = !open[inv.id];
          var tdDev = el('td');
          tdDev.colSpan = 7;
          tdDev.appendChild(buildDevicesTable(inv, devs));
          devRow.appendChild(tdDev);
          tbody.appendChild(devRow);
        }
      });
      table.appendChild(tbody);
      return table;
    }

    function buildDevicesTable(inv, devs) {
      var t = el('table', 'desk-table desk-devices-table');
      t.innerHTML = '<thead><tr><th>端末</th><th>登録</th><th>最後の通信</th><th>状態</th><th></th></tr></thead>';
      var tb = el('tbody');
      devs.forEach(function(dev) {
        var r = el('tr', dev.status === 'active' ? '' : 'inactive');
        r.setAttribute('data-session', dev.id);
        r.appendChild(td(dev.summary || '不明な端末'));
        r.appendChild(td(formatJst(dev.createdAt)));
        r.appendChild(td(formatJst(dev.lastSeenAt)));
        r.appendChild(td(deviceStatusLabel(dev)));
        var a = el('td', 'act');
        if (dev.status === 'active') {
          var b = button('この端末を外す', 'desk-btn-sub danger', function() { revokeDevice(inv, dev); });
          a.appendChild(b);
        }
        r.appendChild(a);
        tb.appendChild(r);
      });
      t.appendChild(tb);
      return t;
    }

    async function revokeInvite(inv, activeN) {
      if (!confirm('「' + (inv.label || '招待') + '」の招待を取り消します。\n' +
          'この招待で登録した ' + activeN + ' 台の端末は、次の保存から採点できなくなります。\nよろしいですか？')) return;
      var res = await call('revokeInvite', inv.id);
      if (ctx.isStale()) return;
      if (isFail(res)) { alert('取り消せませんでした。\n' + errText(res, '')); return; }
      Desk.toast('招待を取り消しました');
      load();
    }

    async function revokeDevice(inv, dev) {
      if (!confirm('この端末（' + (dev.summary || '不明な端末') + '）を外します。\n' +
          '次の保存から採点できなくなります（端末に残っている未送信の採点は、新しい QR で登録し直すと送られます）。\nよろしいですか？')) return;
      var res = await call('revokeSession', dev.id);
      if (ctx.isStale()) return;
      if (isFail(res)) { alert('外せませんでした。\n' + errText(res, '')); return; }
      Desk.toast('端末を外しました');
      load();
    }

    invitesReload = load;
    load();
    return sec;
  }

  function td(text, cls) {
    var e = el('td', cls || null, text);
    return e;
  }

  // ==========================================================
  // AI 用キー（大会一覧）
  // ==========================================================

  function mountAiKeys(host, ctx) {
    host.innerHTML = '';
    var sec = el('section', 'desk-aikeys');
    sec.id = 'aiKeysSection';

    var head = el('div', 'desk-section-head');
    head.appendChild(el('h2', null, 'AI 用キー'));
    head.appendChild(el('div', 'spacer'));
    var btnReload = button('↻ 更新', 'desk-btn', function() { load(); });
    btnReload.id = 'btnAiKeysReload';
    head.appendChild(btnReload);
    var btnNew = button('🔑 発行する', 'desk-btn invite', function() { openAiKeyDialog(load); });
    btnNew.id = 'btnAiKeyNew';
    head.appendChild(btnNew);
    sec.appendChild(head);

    sec.appendChild(el('p', 'desk-note',
      'Claude Code などの AI が、あなたの PC の MCP サーバー経由でこのサーバーを操作するためのキーです。' +
      'AI は本番の大会を読むだけで、書き込めるのは名前が「' + SANDBOX_PREFIX + '」で始まる大会だけです。' +
      'キーは発行したときの 1 回だけ表示します。他の人や Claude のチャットには見せないでください。'));

    var box = el('div');
    box.id = 'aiKeysList';
    sec.appendChild(box);
    host.appendChild(sec);

    async function load() {
      box.innerHTML = '';
      box.appendChild(el('p', 'desk-empty', '読み込み中…'));
      var res = await call('listAiKeys');
      if (ctx.isStale() || !sec.isConnected) return;
      box.innerHTML = '';
      if (!Array.isArray(res)) {
        box.appendChild(el('p', 'desk-empty', 'AI 用キーの一覧を取得できませんでした。' + errText(res, '')));
        return;
      }
      if (res.length === 0) {
        box.appendChild(el('p', 'desk-empty', 'まだ発行していません。'));
        return;
      }
      var table = el('table', 'desk-table desk-aikeys-table');
      table.innerHTML = '<thead><tr><th>ラベル</th><th>発行日</th><th>期限</th><th>状態</th>' +
        '<th>最後の利用</th><th>回数</th><th></th></tr></thead>';
      var tbody = el('tbody');
      res.forEach(function(k) {
        var active = k.status === 'active';
        var tr = el('tr', active ? '' : 'inactive');
        tr.setAttribute('data-aikey', k.id);
        tr.appendChild(td(k.label || '—', 'desk-cell-main'));
        tr.appendChild(td(formatJst(k.createdAt)));
        tr.appendChild(td(formatJst(k.expiresAt)));
        var tdSt = el('td');
        tdSt.appendChild(el('span', 'desk-badge' + (active ? ' on' : ''), keyStatusLabel(k)));
        tr.appendChild(tdSt);
        tr.appendChild(td(formatJst(k.lastUsedAt)));
        tr.appendChild(td(String(k.useCount || 0), 'num'));
        var tdAct = el('td', 'act');
        if (active) {
          tdAct.appendChild(button('取り消す', 'desk-btn-sub danger', function() { revoke(k); }));
        }
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      box.appendChild(table);
    }

    async function revoke(k) {
      if (!confirm('AI 用キー「' + (k.label || '') + '」を取り消します。\n' +
          'このキーを使っている AI（MCP サーバー）は、すぐに操作できなくなります。\nよろしいですか？')) return;
      var res = await call('revokeAiKey', k.id);
      if (ctx.isStale()) return;
      if (isFail(res)) { alert('取り消せませんでした。\n' + errText(res, '')); return; }
      Desk.toast('AI 用キーを取り消しました');
      load();
    }

    load();
  }

  // set-key.ps1 を自分のターミナルで実行するコマンド（キーは含まない）
  function setKeyCommand() {
    return 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\tools\\mcp\\phx-tameshigiri\\set-key.ps1 -HostName ' +
      location.hostname;
  }

  function openAiKeyDialog(onChanged) {
    var issued = false;
    var secret = { key: null };   // 発行されたキー。この変数だけが持つ。閉じるとき null にする

    var wrap = el('div');
    var form = el('div', 'desk-form');
    var inLabel = el('input');
    inLabel.type = 'text';
    inLabel.id = 'aiKeyLabel';
    inLabel.maxLength = 40;
    inLabel.value = 'Claude Code（自宅 PC）';
    addField(form, 'ラベル', inLabel);
    var selDays = el('select');
    selDays.id = 'aiKeyDays';
    [[30, '30 日（既定）'], [7, '7 日'], [90, '90 日（上限）']].forEach(function(p) {
      var o = el('option', null, p[1]);
      o.value = String(p[0]);
      selDays.appendChild(o);
    });
    selDays.value = '30';
    addField(form, '期限', selDays);
    wrap.appendChild(form);
    wrap.appendChild(el('p', 'desk-note',
      'このキーで AI が書き込めるのは、名前が「' + SANDBOX_PREFIX + '」で始まる大会だけです（本番の大会は読むだけ）。' +
      '期限が来るか取り消すと使えなくなります。'));

    var btnCreate = button('発行する', 'desk-btn primary', null);
    btnCreate.id = 'btnAiKeyCreate';
    var btnDone = button('閉じる', 'desk-btn', null);
    btnDone.id = 'btnAiKeyDone';
    btnDone.hidden = true;
    var dialog = Desk.openDialog('AI 用キーを発行', wrap, [btnCreate, btnDone], function() {
      secret.key = null;   // キーを捨てる
      if (issued && typeof onChanged === 'function') onChanged();
    });
    btnDone.addEventListener('click', function() { dialog.close(); });

    btnCreate.addEventListener('click', async function() {
      var label = inLabel.value.trim();
      if (!label) { alert('ラベルを入力してください。'); return; }
      btnCreate.disabled = true;
      dialog.lock(true);
      var res = await call('createAiKey', { label: label, expiresInDays: Number(selDays.value) });
      dialog.lock(false);
      if (isFail(res) || !res.key) {
        btnCreate.disabled = false;
        alert('AI 用キーを発行できませんでした。\n' + errText(res, '通信を確認してください。'));
        return;
      }
      issued = true;
      secret.key = res.key;
      btnCreate.hidden = true;
      btnDone.hidden = false;
      showIssuedKey(wrap, res.aiKey || {}, secret);
    });
  }

  function showIssuedKey(wrap, aiKey, secret) {
    wrap.innerHTML = '';
    var info = el('p', 'desk-invite-target');
    info.id = 'aiKeyIssuedInfo';
    info.textContent = (aiKey.label || '') + ' ・ 期限 ' + formatJst(aiKey.expiresAt);
    wrap.appendChild(info);

    wrap.appendChild(el('p', 'desk-warn',
      'このキーは、あなたの PC の MCP サーバーにだけ渡してください。Claude のチャットには貼らないでください（Claude には渡しません）。' +
      '他の人に見せないでください。この画面を閉じると二度と表示できません。'));

    wrap.appendChild(secretRow('aiKeyValue', function() { return secret.key; },
      'キーをコピー', 'AI 用キーをコピーしました（他の人に見せないでください）'));

    var steps = el('ol', 'desk-steps-list');
    steps.id = 'aiKeySteps';
    var s1 = el('li', null, '「キーをコピー」を押してキーを写します。');
    var s2 = el('li', null, '自分のターミナル（Claude Code の外）で、phx-tameshigiri のフォルダに移り、次を実行します。');
    var cmd = el('code', 'desk-secret desk-command', setKeyCommand());
    cmd.id = 'aiKeyCommand';
    s2.appendChild(cmd);
    s2.appendChild(document.createTextNode('表示に従ってキーを貼り付けると、Windows の資格情報マネージャーに保存されます（画面には出ません）。'));
    var s3 = el('li', null, 'クリップボードを空にします（クリップボード履歴を使っているなら、その項目も消します）。');
    steps.appendChild(s1);
    steps.appendChild(s2);
    steps.appendChild(s3);
    wrap.appendChild(steps);
    wrap.appendChild(button('実行するコマンドをコピー', 'desk-btn-sub', function() {
      Desk.copyText(setKeyCommand(), 'コマンドをコピーしました（キーは含まれません）');
    }));
  }

  return {
    SANDBOX_PREFIX: SANDBOX_PREFIX,
    isSandboxName: isSandboxName,
    sandboxRenameMessage: sandboxRenameMessage,
    formatJst: formatJst,
    tooFarAhead: tooFarAhead,
    inviteStatusLabel: inviteStatusLabel,
    deviceStatusLabel: deviceStatusLabel,
    defaultLabel: defaultLabel,
    qrMatrix: qrMatrix,
    qrSvg: qrSvg,
    openInviteDialog: openInviteDialog,
    refreshInvites: refreshInvites,
    buildInvitesSection: buildInvitesSection,
    mountAiKeys: mountAiKeys,
    setKeyCommand: setKeyCommand
  };
})();
