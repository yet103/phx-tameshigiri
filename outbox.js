// 採点の送信キュー
// 採点セルの操作は通信を待たずにキューへ積み、送信は独立したワーカーが担う。
// 同一選手のエントリは常に1件に畳む（result は毎回全文なので最新だけ送れば足りる）。
// キューは localStorage に退避し、端末が落ちても次回起動時に再送する。
//
// 版（rev）と衝突（網羅検証 M2。設計書 2026-10-01 1.3）:
// - エントリは baseRev（端末がその選手を読み込んだ時点の rev）を持ち、採点の項目と一緒に送る。
// - 送信が成功して応答の player.rev を受け取ったら、同じ選手の残りのエントリの baseRev が
//   いま送ったエントリの baseRev と同じなら新しい rev に書き換える（自分の連続保存で衝突にしない）。
// - 409 stale / not_scorable を受けたら、エントリを捨てずに「衝突」（entry.conflict）として残し、
//   送信を止めて呼び出し元（採点画面）に確認を任せる（resolveConflict）。
//   起動時・online 復帰時・「今すぐ再試行」の再送も同じ仕組みで、衝突なら確認が出る
//   （端末に残した衝突の印は起動時の読み込みで外し、送り直して確かめる）。
// - 時間切れ後の自分の採点（レビュー指摘 1）: 送信が曖昧に失敗したとき（通信断・時間切れの status 0、
//   408、5xx）は、実はサーバーに届いて版が進んでいるかもしれない。送った本文と baseRev をエントリの
//   maybeApplied に控え、次に 409 stale が返ったら、サーバーの今の行がその本文の値と同じで
//   rev が baseRev + 1 なら「自分の送信が届いていた」とみなし、確認を出さずに baseRev を今の rev に
//   して送り直す（待ち時間中のタップは別のエントリに畳まれ、古い baseRev のまま送られるため）。
//
// 別タブ（網羅検証 S9・レビュー指摘 3）: 同じ端末の別タブも同じ localStorage のキーを使う。保存の直前に
// 読み直し、他のタブが積んだエントリ（tab が自分でないもの）を消さずに残す。各タブは生存時刻を
// ALIVE_KEY に数秒ごとに書き、起動時と定期の見回りで引き取るのは、tab の無いエントリ（更新前の画面）と、
// 生存時刻が古い（閉じた・止まった）タブのエントリだけにする（生きているタブのキューを二重に送らない）。
// 止まっている間に他のタブに引き取られたエントリ（adoptedFrom が自分で queuedAt が同じ）は、
// 自分では送らずに捨てる。
var Outbox = (function() {
  var STORAGE_KEY = 'tmg_outbox';
  var ALIVE_KEY = 'tmg_outbox_tabs';   // { タブの印: 最後に生存を書いた時刻（ms） }
  var ALIVE_MS = 5000;                 // 生存時刻を書く間隔（見回りも同じ間隔）
  var TAB_DEAD_MS = 15000;             // これ以上生存時刻が更新されないタブは閉じた（止まった）とみなす
  var ALIVE_FORGET_MS = 3600000;       // 1 時間以上前の生存時刻は表から消す（表が膨らまないように）
  var MAYBE_APPLIED_MAX = 5;           // maybeApplied に控える本文の数の上限
  var BACKOFF_MIN = 1000;
  var BACKOFF_MAX = 30000;
  var TICK_MS = 1000;
  // このタブの印。保存のとき、自分のエントリと他のタブのエントリを見分けるのに使う。
  var TAB_ID = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // サーバーが採点の PATCH とみなす項目（これがあるときだけ baseRev を送る）
  var SCORE_KEYS = ['score', 'result', 'adjust', 'totalAdjust', 'confirmed'];
  // 衝突として残す 409 の理由。それ以外の 409（locked など）は従来どおり送れないものとして捨てる。
  var CONFLICT_REASONS = ['stale', 'not_scorable'];
  // 衝突と同じく捨てずに残す 403 の理由（設計書 2026-10-03 6.6）。採点の鍵の端末で、別のコート・
  // 未分類の行（scope）や運営の項目（field）を送ったとき。採点専用の画面は範囲外の選手を出さないので
  // 通常は起きない（古いキューの残り・コートの付け替え・別の QR で入り直したとき）。
  var SCOPE_REASONS = ['scope', 'field'];

  var queue = [];
  var sending = false;       // 送信処理が走っている最中か
  var backoffMs = BACKOFF_MIN;
  var failingSince = null;   // 最初に失敗した時刻（復旧したら null に戻す）
  var retryTimer = null;     // バックオフ待ちのタイマー
  var tickTimer = null;      // 状態通知用の毎秒タイマー
  var statusHandler = null;
  var discardHandler = null;
  var conflictHandler = null;
  var savedHandler = null;
  var dropped = [];          // 恒久的に送れず捨てたエントリ
  var conflicted = [];       // 衝突になって、まだ呼び出し元へ知らせていないエントリ
  var lastStatus = null;     // 直近に失敗した HTTP ステータス（0=通信断）。成功か破棄で null に戻す
  var lastReason = '';       // 直近に失敗した応答の reason（401 の session_expired など）。lastStatus と一緒に戻す
  var onlineBound = false;
  var aliveTimer = null;     // 生存時刻を書き、閉じたタブのエントリを引き取る見回りのタイマー

  // 同一の大会・選手のエントリを後勝ちでマージする。元の配列とエントリは変更しない。
  // 単純に置き換えないのは、備考だけのエントリ（score / result を持たない）が
  // まだ送れていない採点を落としてしまうため。新しいエントリが持つ項目だけを上書きする。
  // 衝突の印（conflict）は新しいエントリが持たないので残る（確認が済むまで送らない）。
  function coalesce(q, entry) {
    var next = (q || []).slice();
    for (var i = 0; i < next.length; i++) {
      if (next[i].eventId === entry.eventId && next[i].playerId === entry.playerId) {
        next[i] = Object.assign({}, next[i], entry);
        return next;
      }
    }
    next.push(entry);
    return next;
  }

  function readStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(function(e) { return e && typeof e === 'object'; }) : [];
    } catch (e) { return []; }
  }

  // --- タブの生存時刻 ---
  function readAlive() {
    try {
      var raw = localStorage.getItem(ALIVE_KEY);
      var map = raw ? JSON.parse(raw) : {};
      return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    } catch (e) { return {}; }
  }

  function writeAlive(map) {
    try {
      if (Object.keys(map).length === 0) localStorage.removeItem(ALIVE_KEY);
      else localStorage.setItem(ALIVE_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  // このタブの生存時刻を書く（古い印は掃除する）
  function beat() {
    var map = readAlive();
    var now = Date.now();
    Object.keys(map).forEach(function(k) {
      if (typeof map[k] !== 'number' || now - map[k] > ALIVE_FORGET_MS) delete map[k];
    });
    map[TAB_ID] = now;
    writeAlive(map);
  }

  // このタブを閉じる。生存時刻を消し、残したエントリを他のタブ（次の起動）がすぐ引き取れるようにする
  function forgetAlive() {
    var map = readAlive();
    delete map[TAB_ID];
    writeAlive(map);
  }

  // 他のタブのエントリか（tab が付いていて、そのタブの生存時刻が新しい）
  function ownedByLiveTab(e, alive, now) {
    if (!e.tab || e.tab === TAB_ID) return false;
    var t = alive[e.tab];
    return typeof t === 'number' && now - t < TAB_DEAD_MS;
  }

  // 引き取ったエントリの写し。自分の印を付け、元のタブを adoptedFrom に控える（元のタブが止まって
  // いただけで戻ってきたとき、同じエントリを二重に送らないため）。衝突の印は外して送り直す
  // （前回「端末に残す」を選んだ衝突も、起動時に送って確かめ、まだ衝突なら確認を出す。レビュー指摘 2）。
  function adoptCopy(e) {
    var copy = Object.assign({}, e, { tab: TAB_ID });
    if (e.tab && e.tab !== TAB_ID) copy.adoptedFrom = e.tab;
    delete copy.conflict;
    return copy;
  }

  // 起動時の読み込み。前回のこのタブ・閉じたタブ（生存時刻が古い）・tab の無い（更新前の画面の）
  // エントリを引き取り、同じ選手のエントリは畳む（後勝ち）。生きている他のタブのエントリは
  // そのタブが送るので引き取らない（save は他のタブのエントリを消さずに残す）。
  function load() {
    var stored = readStored();
    var alive = readAlive();
    var now = Date.now();
    var q = [];
    stored.forEach(function(e) {
      if (ownedByLiveTab(e, alive, now)) return;
      q = coalesce(q, adoptCopy(e));
    });
    return q;
  }

  // 見回り: 起動したあとに閉じた（止まった）タブのエントリを引き取る。tab の無いエントリは
  // 生きているかどうか分からない更新前の画面のものなので、ここでは引き取らない（次の起動で引き取る）。
  // 自分のキューに同じ選手があれば、自分のほうが新しいので引き取らない（save が落とす）。
  function adoptOrphans() {
    var alive = readAlive();
    var now = Date.now();
    var mine = {};
    queue.forEach(function(e) { mine[e.eventId + '\u0000' + e.playerId] = true; });
    var adopted = 0;
    readStored().forEach(function(e) {
      if (!e.tab || e.tab === TAB_ID || ownedByLiveTab(e, alive, now)) return;
      var key = e.eventId + '\u0000' + e.playerId;
      if (mine[key]) return;
      mine[key] = true;
      queue.push(adoptCopy(e));
      adopted++;
    });
    if (adopted > 0) {
      save();
      startTicking();
      if (!retryTimer) drain();
    }
    return adopted;
  }

  // 止まっている間に他のタブに引き取られたエントリを、自分のキューから外す（二重に送らない）。
  // 引き取られたあとにこのタブで採点し直していれば queuedAt が変わるので、そちらは残す。
  function dropAdoptedByOthers() {
    var taken = {};
    readStored().forEach(function(e) {
      if (e.tab && e.tab !== TAB_ID && e.adoptedFrom === TAB_ID) {
        taken[e.eventId + '\u0000' + e.playerId + '\u0000' + e.queuedAt] = true;
      }
    });
    var before = queue.length;
    queue = queue.filter(function(e) {
      return !taken[e.eventId + '\u0000' + e.playerId + '\u0000' + e.queuedAt];
    });
    return before - queue.length;
  }

  // 保存の直前に localStorage を読み直し、他のタブのエントリ（tab が自分でないもの）を残して書く。
  // 自分のキューにある選手と同じ選手のエントリは、自分のほうが新しい（または送り終えた）ので落とす。
  function save() {
    try {
      var mine = {};
      queue.forEach(function(e) { mine[e.eventId + '\u0000' + e.playerId] = true; });
      var others = readStored().filter(function(e) {
        // tab の無いエントリは更新前の画面（別タブ）が積んだもの。これも消さない。
        return e.tab !== TAB_ID && !mine[e.eventId + '\u0000' + e.playerId];
      });
      var all = others.concat(queue);
      if (all.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function pendingCount() {
    return queue.length;
  }

  function conflictCount() {
    return queue.filter(function(e) { return !!e.conflict; }).length;
  }

  // 何度送っても通らない失敗か。
  // 4xx はリクエスト自体が受け付けられていないので再送しても同じ。
  // ただし 408（タイムアウト）と 429（レート制限）は時間を置けば通る。
  // 401 / 403（資格情報の失効）も、ページを再読み込みして再認証すれば通るので捨てない。
  // 採点の鍵の端末の 401（session_expired / session_revoked / invite_revoked）も捨てない。
  // 新しい QR で入り直すと送られる（設計書 2026-10-03 D6: 取り消された端末の未送信は端末に残す）。
  // 捨てると未送信の採点が黙って失われる。
  // 409 stale / not_scorable は捨てずに衝突として残す（drain で先に分ける）。
  function isPermanentFailure(status) {
    if (status === 401 || status === 403) return false;
    if (status === 408 || status === 429) return false;
    return status >= 400 && status < 500;
  }

  // 応答が「衝突」（捨てずに確認する）か。409 stale / not_scorable と、403 scope / field。
  function isConflict(res) {
    if (!res) return false;
    if (res.status === 409) return CONFLICT_REASONS.indexOf(res.reason) !== -1;
    if (res.status === 403) return SCOPE_REASONS.indexOf(res.reason) !== -1;
    return false;
  }

  // まだ送れていない採点を、サーバーから読み直した選手データに上書きする。
  // キューにある値のほうが新しいので、画面と再エンコードの基準はこちらにする。
  // これをしないと、サーバーの古い値で画面が巻き戻り、
  // 次の1タップがその古い DOM から再エンコードされて未送信分を消す。
  // 版（rev）もエントリの baseRev に戻す。画面の内容はその版を元にした編集なので、
  // 次の保存もその版を baseRev として送る（サーバーの新しい rev を使うと衝突に気付けない）。
  // 戻り値: 上書きした件数
  function applyPending(eventId, playerList) {
    var n = 0;
    for (var i = 0; i < queue.length; i++) {
      var e = queue[i];
      if (e.eventId !== eventId) continue;
      for (var j = 0; j < (playerList || []).length; j++) {
        if (playerList[j].id === e.playerId) {
          // エントリが持っている項目だけを上書きする。
          // 備考だけのエントリは score / result を持たないので、そこは触らない
          // （旧形式のエントリには adjust 以下の4項目が無い）。
          if ('score' in e) playerList[j].score = e.score;
          if ('result' in e) playerList[j].result = e.result;
          if ('adjust' in e) playerList[j].adjust = e.adjust;
          if ('totalAdjust' in e) playerList[j].totalAdjust = e.totalAdjust;
          if ('note' in e) playerList[j].note = e.note;
          if ('confirmed' in e) playerList[j].confirmed = e.confirmed;
          if (typeof e.baseRev === 'number') playerList[j].rev = e.baseRev;
          n++;
          break;
        }
      }
    }
    return n;
  }

  // 現在の状態。app.js はこれを見て表示を決める。
  // state: 'idle' | 'sending' | 'retrying' | 'conflict'（送れるエントリが無く、衝突だけが残っている）
  function status() {
    var conflicts = conflictCount();
    var state = 'idle';
    if (queue.length > conflicts) state = failingSince ? 'retrying' : 'sending';
    else if (conflicts > 0) state = 'conflict';
    return {
      state: state,
      pending: queue.length,
      conflicts: conflicts,
      failingSince: failingSince,
      lastStatus: lastStatus,
      lastReason: lastReason
    };
  }

  // 状態通知。呼び出し元のコールバックが投げてもワーカーを巻き込まない。
  function notify() {
    if (!statusHandler) return;
    try { statusHandler(status()); } catch (e) {}
  }

  // 捨てたエントリを呼び出し元へ知らせる。黙って捨てると採点が
  // 消えたことに誰も気付けない。
  function flushDropped() {
    if (dropped.length === 0) return;
    if (!discardHandler) return;   // ハンドラが付くまで溜めておく
    var list = dropped;
    dropped = [];
    try { discardHandler(list); } catch (e) {}
  }

  // 衝突になったエントリを呼び出し元へ知らせる（呼び出し元が確認を出し、resolveConflict で答える）。
  function flushConflicts() {
    if (conflicted.length === 0) return;
    if (!conflictHandler) return;   // ハンドラが付くまで溜めておく
    var list = conflicted;
    conflicted = [];
    list.forEach(function(e) {
      try { conflictHandler(e); } catch (err) {}
    });
  }

  // キューが空でない間だけ毎秒通知する（バナー昇格の判定に使う）。
  function startTicking() {
    if (tickTimer) return;
    tickTimer = setInterval(function() {
      if (queue.length === 0) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      notify();
    }, TICK_MS);
  }

  function findEntry(eventId, playerId) {
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].eventId === eventId && queue[i].playerId === playerId) return queue[i];
    }
    return null;
  }

  function removeEntry(entry) {
    var i = queue.indexOf(entry);
    if (i !== -1) queue.splice(i, 1);
  }

  // 次に送るエントリ（衝突の印の無い先頭）。無ければ null。
  function nextSendable() {
    for (var i = 0; i < queue.length; i++) {
      if (!queue[i].conflict) return queue[i];
    }
    return null;
  }

  function hasScoreKey(entry) {
    for (var i = 0; i < SCORE_KEYS.length; i++) {
      if (SCORE_KEYS[i] in entry) return true;
    }
    return false;
  }

  // エントリから PATCH の本文を作る。エントリが持っている項目だけを送る
  // （備考だけのエントリで score / result を undefined のまま送らないため）。
  // baseRev は採点の項目があるときだけ付ける（備考だけの PATCH はサーバーが版を見ない）。
  function buildBody(entry) {
    var body = {};
    if ('score' in entry) body.score = entry.score;
    if ('result' in entry) body.result = entry.result;
    if ('adjust' in entry) body.adjust = entry.adjust;
    if ('totalAdjust' in entry) body.totalAdjust = entry.totalAdjust;
    if ('note' in entry) body.note = entry.note;
    if ('confirmed' in entry) body.confirmed = entry.confirmed;
    if (typeof entry.baseRev === 'number' && hasScoreKey(entry)) body.baseRev = entry.baseRev;
    return body;
  }

  // 送信が成功して新しい rev を受け取ったとき、同じ選手の残りのエントリ（送信中に積まれたもの）の
  // baseRev が、いま送ったエントリの baseRev と同じなら新しい rev に書き換える。
  function rebase(sent, newRev) {
    if (typeof newRev !== 'number' || typeof sent.baseRev !== 'number') return;
    queue.forEach(function(e) {
      if (e !== sent && e.eventId === sent.eventId && e.playerId === sent.playerId &&
          e.baseRev === sent.baseRev) {
        e.baseRev = newRev;
      }
    });
  }

  // 送信の失敗が「届いたかどうか分からない」ものか（通信断・時間切れの status 0、408、5xx）。
  // 401 / 403 / 429 などは、サーバーが受け付けずに断ったと分かっている。
  function isAmbiguousFailure(res) {
    if (!res) return true;
    var st = res.status;
    return !st || st === 408 || st >= 500;
  }

  // 曖昧に失敗した送信の本文と baseRev を、その選手のいまのエントリに控える（レビュー指摘 1）。
  // 送信中に同じ選手が再採点されていれば、差し替わった新しいエントリに控える。
  function rememberMaybeApplied(sent, body) {
    if (typeof sent.baseRev !== 'number' || !hasScoreKey(sent)) return false;
    var held = findEntry(sent.eventId, sent.playerId);
    if (!held) return false;
    var list = Array.isArray(held.maybeApplied) ? held.maybeApplied.slice() : [];
    list.push({ baseRev: sent.baseRev, body: body });
    held.maybeApplied = list.slice(-MAYBE_APPLIED_MAX);
    return true;
  }

  function sameValue(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }

  // 409 stale のサーバーの行が、このエントリが前に曖昧に失敗した送信の結果そのものか。
  // その送信の採点の値がすべて今の行と同じで、rev がその baseRev のちょうど 1 つ先なら、
  // 間に他の端末の更新は無く、自分の送信が届いていた（時間切れのあとに適用された）とみなせる。
  function wasOwnWrite(entry, player) {
    if (!player || typeof player.rev !== 'number' || !Array.isArray(entry.maybeApplied)) return false;
    return entry.maybeApplied.some(function(m) {
      if (!m || typeof m.baseRev !== 'number' || !m.body || m.baseRev + 1 !== player.rev) return false;
      var keys = SCORE_KEYS.filter(function(k) { return k in m.body; });
      return keys.length > 0 && keys.every(function(k) { return sameValue(m.body[k], player[k]); });
    });
  }

  // キューを先頭から順に送る（衝突の印のあるエントリは飛ばす）。失敗したらバックオフして再挑戦する。
  async function drain() {
    if (sending) return;
    if (dropAdoptedByOthers() > 0) save();
    if (!nextSendable()) { notify(); flushConflicts(); return; }
    sending = true;
    notify();

    // 途中で何が投げても sending を巻き戻す。
    // ここで詰まると以降の drain() が全て無視され、送信が恒久停止するため。
    try {
      for (;;) {
        var entry = nextSendable();
        if (!entry) break;
        var body = buildBody(entry);
        var res = null;
        try {
          res = await Api.updatePlayer(entry.eventId, entry.playerId, body);
        } catch (e) {
          res = null;
        }

        if (res && res.ok) {
          // 送信済みのエントリだけを取り除く。
          // 送信中に同じ選手が再採点されていれば別オブジェクトに差し替わっているので、
          // 参照が一致するときだけ削除する（新しい採点を取りこぼさない）。
          removeEntry(entry);
          var savedPlayer = res.player || null;
          if (savedPlayer) rebase(entry, savedPlayer.rev);
          // 送れたので、前に曖昧に失敗した送信の控えはもう要らない（版が先へ進んだ）
          var rest = findEntry(entry.eventId, entry.playerId);
          if (rest) delete rest.maybeApplied;
          save();
          backoffMs = BACKOFF_MIN;
          failingSince = null;
          lastStatus = null;
          lastReason = '';
          if (savedHandler) {
            try { savedHandler(entry, savedPlayer); } catch (e) {}
          }
          notify();
        } else if (isConflict(res)) {
          // 別の端末が先に更新した（stale）・今は採点できない巡目（not_scorable）・
          // この端末の登録の範囲外（403 scope / field）。
          // 捨てずに衝突の印を付けて残し、確認を呼び出し元に任せる。
          // 送信中に同じ選手が再採点されていれば、差し替わった新しいエントリに印を付ける。
          var held = findEntry(entry.eventId, entry.playerId);
          if (held && res.reason === 'stale' && wasOwnWrite(held, res.player)) {
            // 時間切れで諦めた自分の送信が実は届いていた。確認を出さずに今の版の上で送り直す
            // （控えは使い切る。同じ選手の次の stale は、また控えがあるときだけ同じ扱いにする）。
            // 画面の控えの版も進めてもらう（前の送信が res.player の版で保存された、として知らせる。
            // 知らせないと次のタップが古い版を baseRev にして、また自分の採点と衝突する）。
            var fromRev = held.baseRev;
            held.baseRev = res.player.rev;
            delete held.maybeApplied;
            save();
            lastStatus = null;
            lastReason = '';
            if (savedHandler) {
              try {
                savedHandler({ eventId: held.eventId, playerId: held.playerId, baseRev: fromRev }, res.player);
              } catch (e) {}
            }
            notify();
            continue;
          }
          if (held) {
            held.conflict = {
              status: res.status,
              reason: res.reason,
              error: res.error || '',
              player: res.player || null,
              eventStatus: res.eventStatus || null
            };
            conflicted.push(held);
          }
          save();
          lastStatus = null;
          lastReason = '';
          notify();
        } else if (res && isPermanentFailure(res.status)) {
          // 送り先が存在しない、リクエストが受け付けられない等。
          // 何度送っても通らないので捨てて先へ進む。
          // 残すとこの1件が先頭に張り付き、以降の採点が全部届かなくなる。
          // 理由（サーバーの本文の reason / error）を添えて呼び出し元に渡す（画面の知らせに出す）。
          removeEntry(entry);
          save();
          entry.dropStatus = res.status;
          entry.dropReason = res.reason || '';
          entry.dropError = res.error || '';
          dropped.push(entry);
          lastStatus = null;
          lastReason = '';
          notify();
        } else {
          // 届いたかどうか分からない失敗なら、送った本文を控える（あとの 409 stale で自分の送信と見分ける）
          if (isAmbiguousFailure(res) && rememberMaybeApplied(entry, body)) save();
          lastStatus = res ? res.status : 0;
          lastReason = (res && typeof res.reason === 'string') ? res.reason : '';
          if (!failingSince) failingSince = Date.now();
          sending = false;
          notify();
          startTicking();
          scheduleRetry();
          return;
        }
      }
    } finally {
      sending = false;
      flushDropped();
      flushConflicts();
    }

    notify();
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function() {
      retryTimer = null;
      drain();
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
  }

  // 採点をキューに積む。通信は待たない。
  function enqueue(entry) {
    // 呼び出し元がオブジェクトを使い回しても参照の一意性が壊れないよう、
    // ここで必ず新しいオブジェクトにする。
    // drain() の参照一致の判定がこの一意性を前提にしている。
    // 積むのは呼び出し元が渡した項目だけ。備考だけを直したいときは
    // { eventId, playerId, note } のように採点を含めずに呼べる。
    // baseRev は画面がその選手を読み込んだ時点の rev（採点の保存では必ず渡す）。
    var queued = {
      eventId: entry.eventId,
      playerId: entry.playerId,
      queuedAt: new Date().toISOString(),
      tab: TAB_ID
    };
    if ('score' in entry) queued.score = entry.score;
    if ('result' in entry) queued.result = entry.result;
    if ('adjust' in entry) queued.adjust = entry.adjust;
    if ('totalAdjust' in entry) queued.totalAdjust = entry.totalAdjust;
    if ('note' in entry) queued.note = entry.note;
    if ('confirmed' in entry) queued.confirmed = entry.confirmed;
    if (typeof entry.baseRev === 'number') queued.baseRev = entry.baseRev;
    queue = coalesce(queue, queued);
    save();
    startTicking();
    // バックオフ待機中なら、その再送に任せる。
    // タップのたびに即時送信を試みると、回線が不安定なときほどバックオフが無効になる。
    if (!retryTimer) drain();
  }

  // バックオフ待ちを打ち切って即座に送信を試みる。
  // 衝突の印も外して送り直す（「今すぐ再試行」・online 復帰。まだ衝突なら確認がもう一度出る）。
  function flushNow() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    backoffMs = BACKOFF_MIN;
    var cleared = false;
    queue.forEach(function(e) {
      if (e.conflict) { delete e.conflict; cleared = true; }
    });
    if (cleared) save();
    drain();
  }

  // 衝突の確認への答え。
  //   'overwrite' … この端末の内容で上書きする。baseRev をサーバーの今の rev（409 の player.rev）にして送り直す。
  //   'discard'   … サーバーの内容を採る。エントリを捨てる（画面の読み直しは呼び出し元）。
  //   'keep'      … 端末に残す（送らない。次の起動（load が衝突の印を外す）・online 復帰・「今すぐ再試行」で
  //                 送り直して確かめ、まだ衝突なら確認がもう一度出る）。
  // 戻り値: 対象のエントリ（無ければ null）。
  function resolveConflict(eventId, playerId, action) {
    var e = findEntry(eventId, playerId);
    if (!e) return null;
    if (action === 'overwrite') {
      var p = e.conflict && e.conflict.player;
      if (p && typeof p.rev === 'number') e.baseRev = p.rev;
      delete e.conflict;
      delete e.maybeApplied;   // 今の版の上で送るので、前の送信の控えは要らない
      save();
      notify();
      if (!retryTimer) drain();
    } else if (action === 'discard') {
      removeEntry(e);
      save();
      notify();
    } else {
      notify();
    }
    return e;
  }

  // 起動時に呼ぶ。localStorage の残件があれば自動送信する。
  // onDiscard は、送り先が存在せず恒久的に送れなかったエントリの配列を受け取る。
  // handlers（省略可）:
  //   onConflict(entry) … 409 stale / not_scorable・403 scope / field で衝突になったエントリ（entry.conflict に
  //                       { status, reason, error, player, eventStatus }。403 の player は null）。
  //                       呼び出し元が確認して resolveConflict で答える。
  //   onSaved(entry, player) … 送信が成功したエントリと、サーバーの保存後の選手（rev 入り。無ければ null）。
  //                       時間切れのあとに届いていたと分かった送信は、{ eventId, playerId, baseRev } だけの
  //                       写しと 409 の player（その送信で保存された行）で呼ぶ。
  // 戻り値: 復元した件数（呼び出し元が「N件送信しました」を出すのに使う）
  function init(onStatusChange, onDiscard, handlers) {
    statusHandler = onStatusChange || null;
    discardHandler = onDiscard || null;
    conflictHandler = (handlers && handlers.onConflict) || null;
    savedHandler = (handlers && handlers.onSaved) || null;
    beat();   // 生存時刻を先に書く（このあと起動した他のタブに、このタブのエントリを引き取らせない）
    queue = load();
    conflicted = [];
    if (queue.length > 0) save();   // 引き取ったエントリを自分の印で書き直す
    var recovered = queue.length;

    if (!onlineBound) {
      window.addEventListener('online', function() { flushNow(); });
      // 閉じるときは生存時刻を消し、残したエントリを他のタブ（次の起動）がすぐ引き取れるようにする。
      // 戻る・進むのキャッシュ（bfcache）に入るだけなら消さない（戻ってきたら続きを送る）。
      window.addEventListener('pagehide', function(ev) {
        if (!(ev && ev.persisted)) forgetAlive();
      });
      // bfcache から戻った。止まっている間に他のタブが引き取ったエントリは外し、続きを送る。
      window.addEventListener('pageshow', function(ev) {
        if (!(ev && ev.persisted)) return;
        beat();
        if (dropAdoptedByOthers() > 0) save();
        adoptOrphans();
        notify();
        if (!retryTimer) drain();
      });
      onlineBound = true;
    }
    if (!aliveTimer) {
      aliveTimer = setInterval(function() {
        beat();
        adoptOrphans();
      }, ALIVE_MS);
    }

    if (recovered > 0) {
      startTicking();
      drain();
    } else {
      notify();
    }
    return recovered;
  }

  return {
    init: init,
    enqueue: enqueue,
    flushNow: flushNow,
    resolveConflict: resolveConflict,
    pendingCount: pendingCount,
    conflictCount: conflictCount,
    applyPending: applyPending,
    status: status,
    coalesce: coalesce,
    buildBody: buildBody,
    isPermanentFailure: isPermanentFailure,
    isConflict: isConflict,
    CONFLICT_REASONS: CONFLICT_REASONS,
    SCOPE_REASONS: SCOPE_REASONS,
    adoptOrphans: adoptOrphans,
    ALIVE_KEY: ALIVE_KEY,
    TAB_ID: TAB_ID
  };
})();
