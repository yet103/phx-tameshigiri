// 採点の鍵で登録した端末（採点専用モード）の範囲の判定（設計書 2026-10-03 6.4・6.6）
// 純粋関数だけを置く（test.html で固定する）。courts.js の後に読むこと（Courts を使う）。
//
// session は GET /api/session の応答（Api.getSession の成功の形）:
//   { role: 'admin' | 'scorer' | 'ai' | 'none', via, scope: { eventId, eventName, court } | null,
//     label, expiresAt, now, reason }
// 採点専用モードは role === 'scorer' のときだけ。運営（Basic・開発）は今までどおり何も絞らない。
// 画面で絞るのは「出さない・選ばせない」ため。守りの本体はサーバーの判定表（server/authz.js）。
var Scope = (function() {
  // 採点の登録が切れた（期限切れ・端末の取り消し・招待の取り消し）ことを表す 401 の reason
  var SESSION_LOST_REASONS = ['session_expired', 'session_revoked', 'invite_revoked'];

  function isScorer(session) {
    return !!(session && session.role === 'scorer' && session.scope &&
              typeof session.scope.eventId === 'string' && session.scope.eventId);
  }

  // 鍵のコート。全コートの鍵（court: null）と採点専用でないときは null。
  function scopeCourt(session) {
    if (!isScorer(session)) return null;
    var c = session.scope.court;
    return (typeof c === 'string' && c) ? c : null;
  }

  // 大会の選択肢。採点専用なら鍵の大会だけ（サーバーも 1 件に絞って返すが、念のため画面でも絞る）。
  function filterEvents(events, session) {
    var list = Array.isArray(events) ? events : [];
    if (!isScorer(session)) return list.slice();
    var id = session.scope.eventId;
    return list.filter(function(ev) { return ev && ev.id === id; });
  }

  // コートの選択肢。
  //   運営 … その大会の選手のコート全部（今の画面と同じ。未分類も含む）
  //   採点（1 コートの鍵）… そのコートだけ（名簿がまだ無くても出す）
  //   採点（全コートの鍵）… その大会の選手のコートから未分類を除いたもの（未分類の行はサーバーが 403 scope）
  // 採点専用で、event が鍵の大会でなければ空（範囲外の大会のコートは出さない）。
  function allowedCourts(event, session) {
    var players = (event && Array.isArray(event.players)) ? event.players : [];
    if (!isScorer(session)) return Courts.listFrom(players);
    if (event && event.id && event.id !== session.scope.eventId) return [];
    var c = scopeCourt(session);
    if (c) return [c];
    return Courts.listFrom(players).filter(function(x) { return x !== Courts.UNASSIGNED; });
  }

  function courtAllowed(court, event, session) {
    if (!court) return false;
    if (!isScorer(session)) return true;
    var c = scopeCourt(session);
    if (c) return court === c;
    if (court === Courts.UNASSIGNED) return false;
    // 全コートの鍵: 大会を読んでいて名簿にコートがあれば、その中から。名簿がまだ無ければ受ける
    // （「先に端末を配り、後から名簿を入れる」段取り。今の画面の refreshCourtList と同じ考え）
    var list = allowedCourts(event, session);
    return list.length === 0 || list.indexOf(court) !== -1;
  }

  // 復帰した選択（Route.restore の結果。null もある）を鍵の範囲に収める。
  // 戻り値: { eventId, court }（court は '' もある＝画面が先頭のコートを選ぶ）。
  //   運営 … route をそのまま返す（null は null）
  //   採点 … 大会は必ず鍵の大会。コートは 1 コートの鍵ならそのコート、全コートの鍵なら
  //          route のコートが範囲内ならそれ、外なら ''
  // event（省略可）は読み込み済みの鍵の大会（全コートの鍵でコートが名簿にあるか見るため）。
  function clampRoute(route, session, event) {
    if (!isScorer(session)) return route || null;
    var id = session.scope.eventId;
    var c = scopeCourt(session);
    if (c) return { eventId: id, court: c };
    var want = (route && route.eventId === id && typeof route.court === 'string') ? route.court : '';
    return { eventId: id, court: courtAllowed(want, event, session) ? want : '' };
  }

  // 範囲外を開こうとしていたか（clampRoute で中身が変わるか）
  function routeChanged(route, clamped) {
    if (!clamped) return false;
    if (!route) return true;
    return route.eventId !== clamped.eventId || (route.court || '') !== (clamped.court || '');
  }

  // --- 日本時間の表示（端末の時計・タイムゾーンに依らない。期限の判定はサーバーだけ。T7） ---
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  function jstParts(iso) {
    var t = Date.parse(iso);
    if (typeof iso !== 'string' || !isFinite(t)) return null;
    var d = new Date(t + 9 * 3600 * 1000);
    return {
      year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
      hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: WEEKDAYS[d.getUTCDay()]
    };
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // '2026-10-12T14:59:59.999Z' → '10/12（月）23:59'（withWeekday が偽なら '10/12 23:59'）。読めなければ ''。
  function formatExpiry(iso, withWeekday) {
    var p = jstParts(iso);
    if (!p) return '';
    return p.month + '/' + p.day + (withWeekday ? '（' + p.weekday + '）' : ' ') +
      pad2(p.hour) + ':' + pad2(p.minute);
  }

  function courtText(court) {
    return court ? court + ' コート' : '全コート';
  }

  // 上部の札: 「採点専用 ・ A コート ・ 10/12 23:59 まで」
  function badgeText(session) {
    if (!isScorer(session)) return '';
    var parts = ['採点専用', courtText(scopeCourt(session))];
    var exp = formatExpiry(session.expiresAt, false);
    if (exp) parts.push(exp + ' まで');
    return parts.join(' ・ ');
  }

  function isSessionLost(reason) {
    return SESSION_LOST_REASONS.indexOf(reason) !== -1;
  }

  // 送信が 401 / 403 で止まっているときの表示（保存状態の小さな表示と、昇格したバナー）。
  //   採点の登録が切れた（session_expired / session_revoked / invite_revoked）… 再読み込みを促さない
  //     （再読み込みしても 401 の HTML になるだけ）。新しい QR で入り直すと送られる。
  //   それ以外（運営の Basic 切れなど）… 今までの文言
  // 戻り値: { sessionLost, status, banner }
  function authLostText(reason, pending) {
    var n = (typeof pending === 'number' && pending >= 0) ? pending : 0;
    if (isSessionLost(reason)) {
      return {
        sessionLost: true,
        status: '⚠ 採点の登録が切れました（未送信 ' + n + ' 件）',
        banner: '⚠ この端末の採点の登録が切れました。未送信 ' + n + ' 件は端末に残っています。' +
          '運営に新しい QR をもらって読み取ると送られます'
      };
    }
    return {
      sessionLost: false,
      status: '⚠ 認証が切れました・ページを再読み込みしてください',
      banner: '⚠ 認証が切れています。ページを再読み込みしてください（未保存 ' + n + ' 件は保持されます）'
    };
  }

  return {
    SESSION_LOST_REASONS: SESSION_LOST_REASONS,
    isScorer: isScorer,
    scopeCourt: scopeCourt,
    filterEvents: filterEvents,
    allowedCourts: allowedCourts,
    courtAllowed: courtAllowed,
    clampRoute: clampRoute,
    routeChanged: routeChanged,
    formatExpiry: formatExpiry,
    courtText: courtText,
    badgeText: badgeText,
    isSessionLost: isSessionLost,
    authLostText: authLostText
  };
})();
