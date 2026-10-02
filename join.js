// 採点端末の登録（join.html。設計書 2026-10-03 6.1・6.9）
//
// 流れ:
//   1. 読み込み直後に location.hash の k= から鍵を取り出して変数に持ち、すぐに history.replaceState で
//      アドレス欄と履歴から消す（sessionStorage などには書かない）。
//   2. 鍵が無ければ「QR を読み取ってください」と貼り付け欄。
//   3. 鍵があれば下見（POST /api/join confirm:false）。セッションも Cookie も作らない（LINE などの
//      リンクの下見で端末の枠を使わない）。大会名・コート・期限・端末数を見せて [この端末を登録する]。
//   4. ボタンで登録（confirm:true）。成功したら変数の鍵を捨て、[採点画面を開く]（next へ location.replace）。
//   5. 失敗は reason で文言を出し分ける。通信失敗は鍵がメモリにあるので [もう一度] で再試行できる。
//
// Join.* の純粋関数は test.html で固定する。画面の処理は #joinApp があるページ（join.html）でだけ動く。
var Join = (function() {
  // 招待の鍵の形（サーバーの credentials.parseToken と同じ: <ID>.<43 文字の秘密>）
  var KEY_RE = /^[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{43}$/;

  function isKeyShape(k) {
    return typeof k === 'string' && KEY_RE.test(k);
  }

  // ハッシュ（'#k=<鍵>'。'&' で他の項目が続いてもよい）から k の値を取り出す。無ければ ''。
  // 形の検査はしない（壊れた鍵も「読み取れませんでした」と出すため、そのまま返す）。
  function keyFromHash(hash) {
    if (typeof hash !== 'string' || !hash) return '';
    var body = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    var parts = body.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf('k=') === 0) {
        var v = parts[i].slice(2);
        try { v = decodeURIComponent(v); } catch (e) { /* 壊れたエンコードはそのまま（形の検査で落ちる） */ }
        return v.replace(/\s+/g, '');
      }
    }
    return '';
  }

  // 貼り付けた文字列から鍵を取り出す。受けるもの: join の URL まるごと（https://…/join#k=<鍵>）・
  // '#k=<鍵>'・'k=<鍵>'・鍵だけ。メッセージアプリの折り返しで入った空白・改行は除く。形が違えば ''。
  function extractKey(text) {
    var t = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!t) return '';
    var cand;
    var hashAt = t.indexOf('#');
    if (hashAt !== -1) cand = keyFromHash(t.slice(hashAt));
    else if (t.indexOf('k=') === 0) cand = keyFromHash(t);
    else cand = t;
    return isKeyShape(cand) ? cand : '';
  }

  // 登録のあとに開く URL。サーバーの next（'/scoring.html#event/<id>/<court>'）だけを受ける
  // （別のサイトや別のページへは移らない）。使えなければ '/scoring.html'。
  function safeNext(next) {
    if (typeof next === 'string' && /^\/scoring\.html(#[^\s]*)?$/.test(next)) return next;
    return '/scoring.html';
  }

  // --- 日本時間の表示（端末の時計・タイムゾーンに依らない。scope.js の formatExpiry と同じ。
  //     scope.js は保護ファイルで、まだ登録していないこのページからは読めないので写しを持つ） ---
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  // '2026-10-12T14:59:59.999Z' → '10/12（月）23:59'。読めなければ ''。
  function formatExpiry(iso) {
    var t = Date.parse(iso);
    if (typeof iso !== 'string' || !isFinite(t)) return '';
    var d = new Date(t + 9 * 3600 * 1000);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '（' + WEEKDAYS[d.getUTCDay()] + '）' +
      pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }

  function courtText(court) {
    return court ? court + ' コート' : '全コート';
  }

  // 下見の応答から画面の文言を作る
  function previewText(info) {
    var dev = (info && info.devices) || {};
    return {
      eventName: (info && info.eventName) || '（名称未設定の大会）',
      court: courtText(info && info.court),
      expiry: formatExpiry(info && info.expiresAt) || '—',
      devices: (typeof dev.active === 'number' && typeof dev.max === 'number')
        ? dev.active + ' / ' + dev.max + ' 台' : '—',
      label: (info && info.label) || ''
    };
  }

  // 下見の時点で、端末の数がいっぱいか（同じ端末の入り直し rejoin は数が増えないので除く）
  function previewFull(info) {
    var dev = (info && info.devices) || {};
    return !(info && info.rejoin) && typeof dev.active === 'number' && typeof dev.max === 'number' &&
      dev.active >= dev.max;
  }

  // 下見に添える一言（今この端末が何としてログインしているか。GET /api/session の応答）
  function sessionNote(session, info) {
    if (info && info.rejoin) {
      return 'この端末はこの QR で登録済みです。登録し直すと前の登録と入れ替わります（台数は増えません）。';
    }
    if (!session || session.ok === false) return '';
    if (session.role === 'admin' && session.via === 'basic') {
      return 'この端末は運営としてログインしています。採点端末として登録しても運営の操作はそのまま使えます。';
    }
    if (session.role === 'scorer' && session.scope) {
      return 'この端末はいま「' + (session.scope.eventName || '') + '」の ' + courtText(session.scope.court) +
        ' の採点端末として登録されています。登録すると、この QR の内容に切り替わります。';
    }
    return '';
  }

  // 失敗の文言（設計書 6.1 の 5）。res は Api.join の失敗の形 { ok:false, status, reason, error, ... }。
  // 戻り値: { text, retry（[もう一度] を出すか）, paste（貼り付け欄を出すか） }
  function messageFor(res) {
    var r = res || {};
    if (!r.status || r.reason === 'network') {
      return { text: '通信できません。電波を確かめて [もう一度] を押してください。', retry: true, paste: false };
    }
    if (r.status === 429 || r.reason === 'rate_limited') {
      return { text: 'しばらく待ってからもう一度読み取ってください。', retry: true, paste: false };
    }
    switch (r.reason) {
      case 'key_invalid':
        return { text: 'この QR は読み取れませんでした。運営にもう一度出してもらってください。', retry: false, paste: true };
      case 'invite_expired': {
        var exp = formatExpiry(r.expiresAt);
        return {
          text: 'この QR は期限切れです' + (exp ? '（期限 ' + exp + '）' : '') + '。運営に新しい QR をもらってください。',
          retry: false, paste: true
        };
      }
      case 'invite_revoked':
        return { text: 'この QR は取り消されています。運営に新しい QR をもらってください。', retry: false, paste: true };
      case 'device_limit': {
        var max = r.devices && typeof r.devices.max === 'number' ? r.devices.max : null;
        return {
          text: 'この QR で登録できる端末の数' + (max !== null ? '（' + max + ' 台）' : '') + 'に達しています。' +
            '運営に端末の一覧から古い端末を外してもらうか、新しい QR をもらってください。',
          retry: true, paste: true
        };
      }
      default:
        return {
          text: '登録できませんでした（' + (r.error || ('サーバーの応答 ' + r.status)) + '）。',
          retry: true, paste: false
        };
    }
  }

  // --- 画面（join.html だけ） ---
  function init() {
    var app = document.getElementById('joinApp');
    if (!app) return;
    var $ = function(id) { return document.getElementById(id); };

    // 1. 鍵を変数に移し、すぐにアドレス欄と履歴から消す
    var key = keyFromHash(location.hash);
    if (location.hash || location.pathname !== '/join') {
      try { history.replaceState(null, '', '/join'); } catch (e) { /* 消せなくても登録は続ける */ }
    }
    var lastAction = null;   // [もう一度] でやり直す処理
    var nextUrl = '/scoring.html';
    var busy = false;

    function show(id) {
      ['joinPreview', 'joinDone', 'joinError'].forEach(function(x) { $(x).hidden = (x !== id); });
    }
    function setStatus(text) { $('joinStatus').textContent = text || ''; }
    function showPaste(on) { $('joinPaste').hidden = !on; }

    function showError(res) {
      var m = messageFor(res);
      setStatus('');
      $('joinErrorText').textContent = m.text;
      $('btnJoinRetry').hidden = !(m.retry && key && lastAction);
      show('joinError');
      showPaste(m.paste || !key);
    }

    async function preview() {
      if (busy) return;
      busy = true;
      lastAction = preview;
      setStatus('確認しています…');
      show(null);
      showPaste(false);
      var results = await Promise.all([Api.join(key, false), Api.getSession()]);
      busy = false;
      var info = results[0];
      var session = results[1];
      if (!info || !info.ok) { showError(info); return; }
      if (previewFull(info)) {
        showError({ ok: false, status: 409, reason: 'device_limit', devices: info.devices });
        return;
      }
      var t = previewText(info);
      $('joinEventName').textContent = t.eventName;
      $('joinCourt').textContent = t.court;
      $('joinExpiry').textContent = t.expiry;
      $('joinDevices').textContent = t.devices;
      $('joinLabel').textContent = t.label || '—';
      var note = sessionNote(session, info);
      $('joinNote').textContent = note;
      $('joinNote').hidden = !note;
      $('btnJoinConfirm').disabled = false;
      setStatus('');
      show('joinPreview');
      showPaste(false);
    }

    async function confirmJoin() {
      if (busy || !key) return;
      busy = true;
      lastAction = confirmJoin;
      $('btnJoinConfirm').disabled = true;
      setStatus('登録しています…');
      var r = await Api.join(key, true);
      busy = false;
      if (!r || !r.ok) {
        $('btnJoinConfirm').disabled = false;
        showError(r);
        return;
      }
      // 登録できた。鍵はもう要らないので捨てる（以後は HttpOnly の Cookie で入る）
      key = '';
      lastAction = null;
      nextUrl = safeNext(r.next);
      $('joinDoneScope').textContent = '「' + ((r.eventName) || '') + '」の ' + courtText(r.court);
      setStatus('');
      show('joinDone');
      showPaste(false);
      $('btnOpenScoring').focus();
    }

    $('btnJoinConfirm').addEventListener('click', confirmJoin);
    $('btnOpenScoring').addEventListener('click', function() { location.replace(nextUrl); });
    $('btnJoinRetry').addEventListener('click', function() { if (lastAction) lastAction(); });
    $('joinPasteForm').addEventListener('submit', function(ev) {
      ev.preventDefault();
      var input = $('joinPasteInput');
      var k = extractKey(input.value);
      input.value = '';   // 鍵を画面に残さない
      var err = $('joinPasteError');
      if (!k) {
        err.textContent = 'URL か鍵の形が違います。運営からもらった URL をそのまま貼り付けてください。';
        err.hidden = false;
        return;
      }
      err.hidden = true;
      key = k;
      preview();
    });

    // このページを開いたまま別の QR を読んだ（同じページへのハッシュだけの移動で、読み込み直しにならない）
    window.addEventListener('hashchange', function() {
      var k = keyFromHash(location.hash);
      if (!location.hash) return;
      try { history.replaceState(null, '', '/join'); } catch (e) { /* 消せなくても続ける */ }
      if (!k) return;
      key = k;
      $('joinPasteError').hidden = true;
      if (!isKeyShape(key)) {
        key = '';
        showError({ ok: false, status: 401, reason: 'key_invalid' });
        return;
      }
      preview();
    });

    if (!key) {
      setStatus('QR を読み取ってこのページを開いてください。');
      show(null);
      showPaste(true);
      return;
    }
    if (!isKeyShape(key)) {
      // 形が違う鍵はサーバーに送らずに断る（読み取りの失敗・途中で切れた URL）
      key = '';
      showError({ ok: false, status: 401, reason: 'key_invalid' });
      return;
    }
    preview();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return {
    isKeyShape: isKeyShape,
    keyFromHash: keyFromHash,
    extractKey: extractKey,
    safeNext: safeNext,
    formatExpiry: formatExpiry,
    previewText: previewText,
    previewFull: previewFull,
    sessionNote: sessionNote,
    messageFor: messageFor
  };
})();
