var Api = (function() {

  // --- 通信の時間切れ（網羅検証 S8） ---
  // 回線が細いと fetch が返らず、送信キューが止まったまま「保存中…」を出し続ける。
  // 15 秒で打ち切り、通信失敗（status: 0）として扱う（呼び出し側は再送・バックオフに回す）。
  var TIMEOUT_MS = 15000;

  // 打ち切り用の信号。応答の本文を読み終えるまで clear を呼ばないこと（本文の読み込みも時間切れの対象）。
  // AbortController の無い古いブラウザでは信号なし（従来どおり時間切れなし）。
  function timeoutSignal(ms) {
    if (typeof AbortController !== 'function') return { signal: undefined, clear: function() {} };
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, ms || TIMEOUT_MS);
    return { signal: ctrl.signal, clear: function() { clearTimeout(timer); } };
  }

  // fetch に時間切れを付けたもの。応答の見出しが届くまでを見張る（本文が小さい JSON の経路だけで使う）。
  async function fetchTimed(url, opts) {
    var t = timeoutSignal();
    try {
      return await fetch(url, Object.assign({}, opts || {}, t.signal ? { signal: t.signal } : {}));
    } finally {
      t.clear();
    }
  }

  // 応答の本文を JSON として読む。JSON でない（プロキシの HTML エラーページなど）・空なら null。
  async function readJsonSafe(res) {
    var text = '';
    try { text = await res.text(); } catch (e) { return null; }
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function defaultError(status) {
    return 'サーバーがエラーを返しました（' + status + '）';
  }

  // --- Events ---
  async function listEvents() {
    // GET /api/events
    // 戻り値: [{ id, name, date, venue, playerCount, updatedAt, createdAt }] or null（通信失敗時）
    // null は「取得に失敗した」、[] は「大会が0件」を表す。区別して呼び出し元に返す。
    try {
      var res = await fetchTimed('/api/events');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  // サーバーとの時計のずれ（ms）。応答の Date ヘッダー（秒単位）から求める。配信の状態（live）のタイマーを
  // 面で映すときに使う（配信用ボードの skewMs と同じ考え方）。
  // Date ヘッダーは秒単位に切り捨てられているので、測るたびの (Date - 端末の現在) は 0〜1 秒ぶん常に小さい側へばらつく
  // （誤差は負の側にしか出ない）。そのまま上書きすると 5 秒ごとの読み直しでタイマーの秒が戻る・飛ぶので、
  // 測定値の最大値（いちばん真に近い値）を採る。ページを開いてから端末の時計が大きくずれ直すことは観戦では無視する。
  var serverSkewMs = 0;
  var serverSkewSeen = false;
  function noteServerDate(res) {
    var d = res && res.headers && res.headers.get('Date');
    var t = d ? Date.parse(d) : NaN;
    if (!Number.isFinite(t)) return;
    var skew = t - Date.now();
    if (!serverSkewSeen || skew > serverSkewMs) { serverSkewMs = skew; serverSkewSeen = true; }
  }
  function serverNowMs() {
    return Date.now() + serverSkewMs;
  }

  async function loadEvent(id) {
    // GET /api/events/:id
    // 戻り値: { id, name, date, venue, players, createdAt, updatedAt } or null
    // 通信自体に失敗した場合も null（fetch は回線断で reject する）
    try {
      var res = await fetchTimed('/api/events/' + id);
      noteServerDate(res);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function loadEventResult(id) {
    // GET /api/events/:id （404 と通信断を区別する版）
    // 既存の loadEvent は両方 null にする（呼び出し元が多いので戻り値は変えない）。
    // 大会が消えたのか（404）通信の問題なのかで画面の案内を出し分けたい呼び出し元
    // （desk.js / admin.js の大会読み込み）だけがこちらを使う。
    // 戻り値: { ok: true, event } | { ok: false, status }（通信そのものの失敗は status: 0）
    try {
      var res = await fetchTimed('/api/events/' + id);
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, event: await res.json() };
    } catch (e) {
      return { ok: false, status: 0 };
    }
  }

  async function saveEvent(event) {
    // POST /api/events
    // Body: eventオブジェクト全体
    // 戻り値: { success: true, id } or null
    try {
      var res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function updateEventInfo(eventId, data) {
    // PATCH /api/events/:eventId （基本情報の保存専用。name / date / venue / settings だけを送る）
    // 大会ファイルを丸ごと送り直す saveEvent と違い、techniques / players / status には
    // 一切触れない（techniques を持たない大会の技リストを固定してしまわないため）。
    // settings は { requireBib, requireRank, mixed, courts }。courts を省くと既存を保つ
    // （ゼッケン・級位段位は設計書「選手の追加項目」、courts は設計書「コート一覧」）。
    // 他のキーが混ざっていてもサーバーが無視する。
    // 戻り値: { ok: true, event: { id, name, date, venue, updatedAt, settings } }
    //       | { ok: false, status: HTTPステータス, reason, error }（400 / 404 / 409。
    //         409 の reason は 'locked'）
    //         settings.finalCourt（決戦コートの名前）は廃止。送ってもサーバーが無視する
    //         （設計書 2026-09-28）
    //       | null（通信そのものの失敗）
    try {
      var res = await fetch('/api/events/' + eventId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        var errJson = null;
        try { errJson = await res.json(); } catch (e) { /* JSON でない応答 */ }
        return {
          ok: false,
          status: res.status,
          reason: (errJson && errJson.reason) || '',
          error: (errJson && errJson.error) ||
                 ('サーバーがエラーを返しました（' + res.status + '）')
        };
      }
      var json = await res.json();
      return { ok: true, event: json.event || null };
    } catch (e) {
      return null;
    }
  }

  async function deleteEvent(id) {
    // DELETE /api/events/:id
    try {
      var res = await fetch('/api/events/' + id, { method: 'DELETE' });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function copyEvent(eventId, data) {
    // POST /api/events/:eventId/copy
    // Body: { name, date, venue, withPlayers }
    // 戻り値: { id, playerCount } | { error }（400/404: 理由をダイアログに出す） | null（通信失敗）
    // 技と配点は必ず複製される。withPlayers が true のときだけ一巡目の選手も複製される
    // （得点は消える）。作られる大会は必ず draft。
    try {
      var res = await fetch('/api/events/' + eventId + '/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) return { error: await readErrorMessage(res) };
      var json = await res.json();
      return { id: json.id, playerCount: json.playerCount || 0 };
    } catch (e) {
      return null;
    }
  }

  async function createFromTemplate(template, data) {
    // POST /api/events/from-template
    // Body: { template: 'practice' | 'tournament' | 'systest', name, date, venue }
    // 戻り値: { id, playerCount } | { error }（400: 理由をダイアログに出す） | null（通信失敗）
    // systest だけダミー選手20名を作り test:true が付く（設計書「テンプレートから作成」）。
    try {
      var body = Object.assign({ template: template }, data || {});
      var res = await fetch('/api/events/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) return { error: await readErrorMessage(res) };
      var json = await res.json();
      return { id: json.id, playerCount: json.playerCount || 0 };
    } catch (e) {
      return null;
    }
  }

  async function changeStatus(eventId, to, opts) {
    // POST /api/events/:eventId/status
    // Body: { to: 'round1', force: true, from: 画面が見ていた状態 }
    //   opts.from（文字列のときだけ本文に入れる）が今の状態と違えば、サーバーは何も変えずに
    //   409 reason: 'stale' を返す（網羅検証 S19）。opts.force は従来どおり。
    // 戻り値: { ok: true, status: 新しい状態, round2: 生成の結果 | null }
    //       | { ok: false, status: HTTPステータス, reason, error, existingCount, untrackedCount,
    //           unassignedCount, currentStatus }（400 / 404 / 409）
    //         currentStatus は本文の status（stale / locked のときの今の状態。無ければ null）。
    //         ok:false の status は HTTP ステータスなので、本文の status はこの別名で返す。
    //       | null（通信そのものの失敗）
    // 409 の reason は 'stale' | 'transition' | 'empty' | 'no_round2' |
    //   'generate_failed' | 'exists'（round1 → round1_done で追跡できない
    //   二巡目の行がある。opts.force: true で再送すると越えられる。レビュー指摘A）。
    //   to が状態の一覧に無い（旧い画面が送る旧い状態名など）は 400。
    //   画面はこれで「読み直す」「force で確認して進む」などの
    //   次の行動を出し分けるので、error だけでなく reason も返す（他の API と違って
    //   ok:false に理由を載せるのはこのため）。
    // round2 は round1 → round1_done のときだけ入る
    //   { created, skipped, existingCount, untrackedCount, unassignedCount,
    //     fromRequest, reordered }。サーバーが遷移の中で二巡目を生成する（設計書 2026-09-22）。
    //   fromRequest は二巡目の形の申請（一巡目の行の r2tech1〜3）の形で作った行の数
    //   （設計書 2026-10-03 3.4。画面のトーストに出す）。
    //   reordered: true は、誰も採点していなかったため二巡目の番号を現在の
    //   一巡目の得点から付け直したことを表す（レビュー指摘J）。
    // opts.force: true を渡すと、追跡できない二巡目の行があっても確認済みとして進める。
    try {
      var body = { to: to, force: !!(opts && opts.force) };
      if (opts && typeof opts.from === 'string') body.from = opts.from;
      var res = await fetch('/api/events/' + eventId + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        var errJson = await readJsonSafe(res);
        return {
          ok: false,
          status: res.status,
          reason: (errJson && errJson.reason) || '',
          error: (errJson && errJson.error) || defaultError(res.status),
          // reason: 'exists' のときだけ意味を持つ（Courts.nextRoundConflictMessage に渡す）。
          existingCount: (errJson && errJson.existingCount) || 0,
          untrackedCount: (errJson && errJson.untrackedCount) || 0,
          unassignedCount: (errJson && errJson.unassignedCount) || 0,
          currentStatus: (errJson && typeof errJson.status === 'string') ? errJson.status : null
        };
      }
      var json = await res.json();
      return { ok: true, status: json.status, round2: json.round2 || null };
    } catch (e) {
      return null;
    }
  }

  // --- Players ---
  async function updatePlayer(eventId, playerId, data) {
    // PATCH /api/events/:eventId/players/:playerId（採点画面の送信キュー Outbox が使う）
    // Body: { score, result, adjust, totalAdjust, confirmed, note, baseRev, force } のうち送りたいもの。
    //   baseRev は端末がその選手を読み込んだ時点の rev（網羅検証 M2。設計書 2026-10-01 1.2）。
    // 戻り値: { ok: true, player }（player はサーバーの保存後の行。rev 入り。古いサーバーでは null）
    //       | { ok: false, status: <HTTPステータス>, reason, error, player, eventStatus }
    //         （409 / 400 などの本文を読む。reason は 'stale' | 'not_scorable' | 'locked' | '' など、
    //          player は本文の選手（サーバーの今の行。rev 入り）か null、eventStatus は本文の status か null）
    //       | { ok: false, status: 0 }（通信自体の失敗。15 秒の時間切れも含む。再送すれば通る見込みがある）
    // 送信キューは 404（送り先が存在しない＝何度送っても通らない）・409（衝突。捨てずに確認する）と
    // それ以外を区別する必要があるため、真偽値ではなく状態を返す。
    var t = timeoutSignal();
    try {
      var res = await fetch('/api/events/' + eventId + '/players/' + playerId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: t.signal
      });
      var json = await readJsonSafe(res);
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          reason: (json && json.reason) || '',
          error: (json && json.error) || defaultError(res.status),
          player: (json && json.player) || null,
          eventStatus: (json && typeof json.status === 'string') ? json.status : null
        };
      }
      return { ok: true, player: (json && json.player) || null };
    } catch (e) {
      return { ok: false, status: 0 };
    } finally {
      t.clear();
    }
  }

  async function createPlayer(eventId, data) {
    // POST /api/events/:eventId/players
    // Body: { name, court, isFemale, isNewFace, tech1, tech2, tech3, round, bib, rank, rental,
    //         r2tech1, r2tech2, r2tech3 }
    //   r2tech1〜3 は二巡目の形の申請（一巡目の行だけ。3 つとも空なら一巡目と同じ。設計書 2026-10-03）。
    //   round が 1 以外で申請があれば 400 reason: 'not_round1'、表に無い技は 400 reason: 'unknown_tech'。
    // 戻り値: 追加された player オブジェクト（成功）
    //       | { player: null, reason, error }（409。確定済みガード（reason: 'locked'）と
    //         ゼッケン番号の重複（reason: 'bib'）の2種類）
    //       | { player: null, status: 400, reason, error }（400。入力の不正。技得点表に無い技名は
    //         reason: 'unknown_tech'。画面は error をそのまま出せる）
    //       | null（404/通信失敗）
    // order はサーバーが コート×性別×巡目 ごとに採番するので、送っても無視される。
    // round を省略すると 1（一巡目）。二巡目の行は generateNextRound が作る。
    // round は数値（1〜9）。文字列を送ると 400 になる。
    // isFemale / isNewFace は真偽値の true のときだけ立つ（'true' などの文字列は false 扱い）。
    // bib（ゼッケン番号。省略/null で未設定、1〜9999の整数）/ rank（級位・段位。20文字まで）/
    // rental（真剣レンタル。真偽値）は設計書「選手の追加項目」。型が合わないと400。
    try {
      var res = await fetch('/api/events/' + eventId + '/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        if (res.status === 409) {
          var conflict = null;
          try { conflict = await res.json(); } catch (e) { /* JSON でない応答 */ }
          return {
            player: null,
            reason: (conflict && conflict.reason) || '',
            error: (conflict && conflict.error) || 'サーバーがエラーを返しました（409）'
          };
        }
        if (res.status === 400) {
          var bad = await readJsonSafe(res);
          return {
            player: null,
            status: 400,
            reason: (bad && bad.reason) || '',
            error: (bad && bad.error) || defaultError(400)
          };
        }
        return null;
      }
      var json = await res.json();
      return json.player || null;
    } catch (e) {
      return null;
    }
  }

  async function createPlayersBulk(eventId, data) {
    // POST /api/events/:eventId/players/bulk
    // Body: { court, isFemale, isNewFace, names: ['名前', ...] }（同じコート・性別でまとめて）
    //     | { rows: [{ name, court, isFemale, isNewFace, tech1, tech2, tech3, bib, rank, rental,
    //                  r2tech1, r2tech2, r2tech3, line }, ...] }
    //       （行ごとに違う。bib / rank / rental は設計書「選手の追加項目」。r2tech1〜3 は二巡目の形の
    //        申請で、400 は「N 行目: 二巡目の技「X」は技リストにありません」など。設計書 2026-10-03 3.2）
    // 戻り値: { created, players } | { error } (400/404/409: 失敗理由を画面に出すため) | null（通信失敗）
    // 1回の書き込みで コート×性別×一巡目 の続き番号を順に付ける。
    // rows 形式は全行を検証してから書くので、失敗したときは 1 人も登録されていない。
    // rows の 400 は「3 行目: …」のように行番号つきの文言で返る（ゼッケンの重複、
    // レンタルの選手が抜刀後の形以外の技を選んでいる、なども含む）。
    try {
      var res = await fetch('/api/events/' + eventId + '/players/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        var errJson = null;
        try { errJson = await res.json(); } catch (e) { /* JSON でない応答 */ }
        return { error: (errJson && errJson.error) || ('サーバーがエラーを返しました（' + res.status + '）') };
      }
      var json = await res.json();
      return { created: json.created || 0, players: json.players || [] };
    } catch (e) {
      return null;
    }
  }

  async function updatePlayerInfo(eventId, playerId, data) {
    // PATCH /api/events/:eventId/players/:playerId（運営画面の編集専用）
    // Body: { name, tech1, tech2, tech3, isNewFace, isFemale, score, result, court, round,
    //         bib, rank, rental, r2tech1, r2tech2, r2tech3, force } のうち送りたいものだけ。
    //         id と order は送っても無視される。
    //   r2tech1〜3 は二巡目の形の申請。一巡目の行だけ（それ以外は 400 not_round1）。3 つ揃えて
    //   1 回で送る（同じ形の回数制限が 3 つの組で決まるため。設計書 2026-10-03 3.3）。
    //   data はそのまま本文にする（force: true もそのまま入る。採点済みの技・性別の変更（409 scored）や
    //   終わった巡目の採点（409 not_scorable）を承知で通すとき。網羅検証 S7）。
    // bib は null で未設定に戻せる（設計書「選手の追加項目」）。
    // 戻り値: { ok: true, player, linked, source }
    //         linked: 書き換えた二巡目の行（rev 入り）の配列。一巡目の行の PATCH で紐づく二巡目の行が
    //                 変わったとき（申請の書き写し・一巡目の形への追従・氏名などの写し）。無ければ []
    //         source: 二巡目の行の技を直して一巡目の行の申請へ書き戻したとき、その一巡目の行（rev 入り）。
    //                 無ければ null。画面はこの 2 つで手元の他の行も差し替える（設計書 2026-10-03 3.3.3）
    //       | { ok: false, status: <HTTPステータス>, reason, error, player, linked }
    //         （409 / 400 などの本文を読む。409 の reason は 'locked'（確定済み）/ 'bib'（ゼッケンの重複）/
    //          'linked'（二巡目の行の氏名・性別・新人）/ 'scored'（採点済みの技・性別）/ 'stale' /
    //          'not_scorable'。player は本文にあればサーバーの今の行（rev 入り）、無ければ null。
    //          linked は 409 scored のうち、申請の書き写し先の二巡目の行が採点済みで断ったときの
    //          その行（rev 入り、1 つ）。それ以外は null。画面は Courts.round2ChangeConfirmMessage で
    //          聞き直し、承諾されたら force: true で送り直す）
    // 通信自体に失敗した場合は status: 0（15 秒の時間切れも含む）。
    // 採点経路（Outbox → updatePlayer）と混ぜないため、同じPATCHでも別関数にしている。
    var t = timeoutSignal();
    try {
      var res = await fetch('/api/events/' + eventId + '/players/' + playerId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: t.signal
      });
      var json = await readJsonSafe(res);
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          reason: (json && json.reason) || '',
          error: (json && json.error) || defaultError(res.status),
          player: (json && json.player) || null,
          linked: (json && json.linked && typeof json.linked === 'object' && !Array.isArray(json.linked))
            ? json.linked : null
        };
      }
      return {
        ok: true,
        player: (json && json.player) || null,
        linked: (json && Array.isArray(json.linked)) ? json.linked : [],
        source: (json && json.source && typeof json.source === 'object') ? json.source : null
      };
    } catch (e) {
      return { ok: false, status: 0 };
    } finally {
      t.clear();
    }
  }

  async function reorderPlayers(eventId, body) {
    // POST /api/events/:eventId/players/reorder（PC 運営の選手登録の表で行をドラッグしたとき）
    // Body: { court, isFemale, round, ids: [選手ID, ...] }
    //   ids はその組（コート×性別×巡目）の行すべて。この順に番号を 1 から振り直す。
    //   混合の大会では isFemale は無視される（コート×巡目の全員が 1 組）。
    // 戻り値: { ok: true, players }（大会の選手全体）
    //       | { ok: false, status: <HTTPステータス>, reason, error }
    //         （reason は 'locked'（409。確定済み）/ 'reorder_mismatch'（400。組の行と ids が
    //          一致しない）/ ''。通信自体に失敗した場合は status: 0）
    try {
      var res = await fetch('/api/events/' + eventId + '/players/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        var errJson = null;
        try { errJson = await res.json(); } catch (e) { /* JSON でない応答 */ }
        return {
          ok: false,
          status: res.status,
          reason: (errJson && errJson.reason) || '',
          error: (errJson && errJson.error) || ('サーバーがエラーを返しました（' + res.status + '）')
        };
      }
      var json = await res.json();
      return { ok: true, players: json.players || [] };
    } catch (e) {
      return { ok: false, status: 0, reason: '', error: '' };
    }
  }

  async function arrangePlayers(eventId, body) {
    // POST /api/events/:eventId/players/arrange（PC 運営の選手登録の「⚙ 自動整列」。設計書 2026-10-07）
    // Body: { layout: [{ court, ids }] }。一巡目で order が読める行の全員をコートごとの並びで送る。
    //   サーバーはコートと番号を 1 回で書き直す（番号は コート×性別の段ごとに 1 から。混合は通し）。
    //   「元に戻す」は適用前の layout を同じ形で送る。
    // 戻り値: { ok: true, players }（大会の選手全体）
    //       | { ok: false, status: <HTTPステータス>, reason, error }
    //         （reason は 'not_draft'（409。準備中でない）/ 'locked'（409。確定済み）/
    //          'arrange_mismatch'（400。layout の id が現在の一巡目の行と一致しない）/ ''。
    //          通信自体に失敗した場合は status: 0）
    try {
      var res = await fetch('/api/events/' + eventId + '/players/arrange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        var errJson = null;
        try { errJson = await res.json(); } catch (e) { /* JSON でない応答 */ }
        return {
          ok: false,
          status: res.status,
          reason: (errJson && errJson.reason) || '',
          error: (errJson && errJson.error) || ('サーバーがエラーを返しました（' + res.status + '）')
        };
      }
      var json = await res.json();
      return { ok: true, players: json.players || [] };
    } catch (e) {
      return { ok: false, status: 0, reason: '', error: '' };
    }
  }

  async function deletePlayer(eventId, playerId, force) {
    // DELETE /api/events/:eventId/players/:playerId?force=1
    // 戻り値: true（削除成功）
    //       | { blocked: true, reason, error, player: { name, order, score } | null }
    //         （409。reason は 'locked'（確定済み。この場合 player は無い）か
    //          ''（採点済みガード。player が付く）。error はサーバーの文言）
    //       | false（404・400・通信失敗）
    // 削除後の再採番はしないので、番号には欠番が残る。
    try {
      var url = '/api/events/' + eventId + '/players/' + playerId +
                (force === true ? '?force=1' : '');
      var res = await fetch(url, { method: 'DELETE' });
      if (res.status === 409) {
        var conflict = await res.json();
        return {
          blocked: true,
          reason: conflict.reason || '',
          error: conflict.error || ('サーバーがエラーを返しました（' + res.status + '）'),
          player: conflict.player || null
        };
      }
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function importCsv(eventId, csvText, mode, force, expectedCount) {
    // POST /api/events/:eventId/import
    // Body: { csvText, mode: 'replace' | 'append', force, expectedCount }
    //   expectedCount（数値のときだけ本文に入れる）: 置換の直前に画面が読み直した選手数。
    //   サーバーの選手数と違えば 409 reason: 'stale'（網羅検証 M5）。
    // 戻り値: { success: true, playerCount, bibDropped: { duplicate, outOfRange } }
    //           （bibDropped は重複・範囲外で「未設定」に落とした件数。設計書「選手の追加項目」） |
    //         { blocked: true, reason, error, scoredCount, playerCount } (409: reason は
    //           'locked'（確定済み）| 'stale'（選手数が違う。playerCount はサーバーの選手数）|
    //           'round2_format'（二巡目がある大会へ 20 列以外で置換・追記）| ''（採点済みデータあり。scoredCount）。
    //           該当しない件数は 0) |
    //         { success: false, reason, error } (その他の4xx: reason は 'encoding'（文字化け）|
    //           'format'（見出しが読めない）| '') | null（通信失敗）
    try {
      var body = { csvText: csvText, mode: mode || 'replace', force: force === true };
      if (typeof expectedCount === 'number') body.expectedCount = expectedCount;
      var res = await fetch('/api/events/' + eventId + '/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status === 409) {
        var conflict = (await readJsonSafe(res)) || {};
        return {
          blocked: true,
          reason: conflict.reason || '',
          error: conflict.error || defaultError(res.status),
          scoredCount: conflict.scoredCount || 0,
          playerCount: conflict.playerCount || 0
        };
      }
      if (!res.ok) {
        var errJson = (await readJsonSafe(res)) || {};
        return { success: false, reason: errJson.reason || '', error: errJson.error || defaultError(res.status) };
      }
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function exportCsv(eventId) {
    // GET /api/events/:eventId/export
    // 戻り値: CSVテキスト文字列
    try {
      var res = await fetch('/api/events/' + eventId + '/export');
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      return null;
    }
  }

  // --- Event Bundle（大会1件の書き出し・取り込み） ---
  async function exportBundle(eventId) {
    // GET /api/events/:eventId/bundle
    // 戻り値: JSON 文字列（成功）
    //       | { error }（404/500 などサーバーがエラー応答を返した。JSON でない
    //         エラー応答（413 やプロキシの HTML エラーページなど）でも同じ形にする）
    //       | null（通信そのものの失敗。fetch が投げた場合のみ）
    // ファイル名はサーバーの Content-Disposition を使わず Storage.bundleFilename で組む。
    try {
      var res = await fetch('/api/events/' + eventId + '/bundle');
      if (res.ok) return await res.text();
      return { error: await readErrorMessage(res) };
    } catch (e) {
      return null;
    }
  }

  async function importBundle(bundle) {
    // POST /api/events/import
    // Body: エクスポートファイルの JSON をパースしたオブジェクト
    // 戻り値: { success: true, id, playerCount, bibDropped: { duplicate, outOfRange } }
    //           （bibDropped は重複・範囲外で「未設定」に落とした件数。設計書「選手の追加項目」）
    //       | { success: false, error }（4xx/5xx: 失敗理由を画面に出すため。JSON でない
    //         エラー応答でも「通信を確認してください」に丸めず理由を出せるようにする）
    //       | null（通信そのものの失敗。fetch が投げた場合のみ）
    // 常に新しい大会として追加される（既存の大会は上書きされない）。
    try {
      var res = await fetch('/api/events/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle)
      });
      if (!res.ok) {
        return { success: false, error: await readErrorMessage(res) };
      }
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  // !res.ok の応答本文を読み、error フィールドを取り出す共通処理。
  // 本文が JSON でない（413 やプロキシの HTML エラーページなど）ときは
  // catch で null になって「通信を確認してください」に丸めてしまわないよう、
  // ステータスコードだけを使った定型文にする。
  async function readErrorMessage(res) {
    var text = '';
    try { text = await res.text(); } catch (e) { /* 本文が読めなくても続ける */ }
    var json = null;
    try { json = JSON.parse(text); } catch (e) { /* JSON でない応答 */ }
    if (json && typeof json.error === 'string') return json.error;
    return 'サーバーがエラーを返しました（' + res.status + '）';
  }

  // --- Rounds ---
  async function generateNextRound(eventId, force) {
    // POST /api/events/:eventId/rounds/2/generate
    // 戻り値:
    //   { success: true, created, skipped, existingCount, untrackedCount, unassignedCount,
    //     fromRequest, reordered }
    //     reordered: true は、誰も採点していなかったため二巡目の番号を現在の
    //       一巡目の得点から付け直したことを表す（レビュー指摘J）
    //     created: 新規に作った二巡目行数
    //     skipped: source（order が解析できる一巡目）のうち既に二巡目行を生成済みだった人数
    //              （force での差分追加時に意味を持つ。それ以外は 0）
    //     existingCount: 呼び出し時点で既にあった二巡目行数
    //     untrackedCount: 既存の二巡目行のうち sourcePlayerId を持たない件数
    //                     （CSVインポート由来。force すると重複生成される）
    //     unassignedCount: order が解析できず二巡目を作れなかった一巡目選手の人数
    //     fromRequest: 二巡目の形の申請の形で作った行の数（設計書 2026-10-03 3.4）
    //   | { blocked: true, reason: 'unscored' | 'exists' | 'status' | 'locked', error,
    //       unscoredCount, existingCount, untrackedCount, unassignedCount }
    //       （該当しない件数は 0。error はサーバーの文言で、'status' / 'locked' のときは
    //        これをそのまま出す）
    //   | null（400: 一巡目が0名 / 404 / 通信失敗）
    // unscored / exists の 409 は force: true で越えられる。untrackedCount が 0 でないときは
    // force すると CSV由来の二巡目行と重複するので、呼び出し元で警告すること。
    // status（一巡目終了より前）と locked（確定済み）は force でも越えられない。
    try {
      var res = await fetch('/api/events/' + eventId + '/rounds/2/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: force === true })
      });
      if (res.status === 409) {
        var conflict = await res.json();
        return {
          blocked: true,
          reason: conflict.reason || '',
          error: conflict.error || 'サーバーがエラーを返しました（409）',
          unscoredCount: conflict.unscoredCount || 0,
          existingCount: conflict.existingCount || 0,
          untrackedCount: conflict.untrackedCount || 0,
          unassignedCount: conflict.unassignedCount || 0
        };
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  // --- Techniques ---
  async function loadTechniques() {
    // GET /api/techniques
    // 戻り値: { isCustom, techniques: [...] }
    try {
      var res = await fetchTimed('/api/techniques');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function saveTechniques(techs) {
    // POST /api/techniques
    // 戻り値: { success: true } | { success: false, error }（4xx。行番号つきの理由）
    //       | null（通信失敗）
    try {
      var res = await fetch('/api/techniques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ techniques: techs })
      });
      if (!res.ok) {
        var errJson = await res.json();
        return { success: false, error: errJson.error };
      }
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function resetTechniques() {
    // DELETE /api/techniques
    try {
      var res = await fetch('/api/techniques', { method: 'DELETE' });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // --- Event Techniques（大会ごとの技マスタ） ---
  // 雛形用の loadTechniques / saveTechniques / resetTechniques とは別物。
  // 大会を選んでいるときは必ずこちら（または Api.loadEvent の応答の techniques）を使う。
  async function loadEventTechniques(eventId) {
    // GET /api/events/:eventId/techniques
    // 戻り値: { source: 'event' | 'template', techniques: [...] } | null（400/404/通信失敗）
    try {
      var res = await fetch('/api/events/' + eventId + '/techniques');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  // 技得点表の差し替えが断られたときの戻り値（PUT / DELETE で共通）。
  // 409 は conflict: true と { names, count, usages }（reason: 'tech_in_use' のとき意味を持つ。
  // 設計書 2026-10-01 3.1）を付ける。
  async function techniqueFailure(res) {
    var json = (await readJsonSafe(res)) || {};
    var out = { success: false, reason: json.reason || '', error: json.error || defaultError(res.status) };
    if (res.status === 409) {
      out.conflict = true;
      out.names = Array.isArray(json.names) ? json.names : [];
      out.count = json.count || 0;
      out.usages = Array.isArray(json.usages) ? json.usages : [];
    }
    return out;
  }

  async function saveEventTechniques(eventId, techs, renames) {
    // PUT /api/events/:eventId/techniques
    // Body: { techniques, renames }（renames は配列のときだけ入れる。[{ from, to }]。
    //   from は今の表の技名、to は新しい表の技名。サーバーが選手の技名も付け替える）
    // 戻り値: { success: true, techniques, renamed }（renamed は技名を付け替えた選手の行の数）
    //       | { success: false, conflict: true, reason, error, names, count, usages }
    //         （409。reason は 'tech_in_use'（選手が使っている技が消える）か 'locked'（確定済み）。
    //          names: 消える技の今の表での名前、count: 影響する選手の行の数、usages: [{ name, count }]）
    //       | { success: false, reason, error }（その他の4xx。行番号つきの理由）
    //       | null（通信失敗）
    try {
      var body = { techniques: techs };
      if (Array.isArray(renames)) body.renames = renames;
      var res = await fetch('/api/events/' + eventId + '/techniques', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) return await techniqueFailure(res);
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function resetEventTechniques(eventId) {
    // DELETE /api/events/:eventId/techniques（雛形の複製で置き換える）
    // 戻り値: true（成功）
    //       | { success: false, conflict: true, reason, error, names, count, usages }
    //         （409。選手が使っている技が雛形に無い（'tech_in_use'）か確定済み（'locked'）。
    //          オブジェクトは真と評価されるので、呼び出し側は `r === true` か r.conflict で見分けること）
    //       | false（その他の失敗・通信失敗）
    try {
      var res = await fetch('/api/events/' + eventId + '/techniques', { method: 'DELETE' });
      if (res.status === 409) return await techniqueFailure(res);
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // --- History ---
  async function loadHistory(eventId) {
    // GET /api/events/:eventId/history
    try {
      var res = await fetch('/api/events/' + eventId + '/history');
      if (!res.ok) return { eventId: eventId, entries: [] };
      return await res.json();
    } catch (e) {
      return { eventId: eventId, entries: [] };
    }
  }

  async function addHistory(eventId, entry) {
    // POST /api/events/:eventId/history
    // Body: { action, playerName, techName, strike, value, detail }
    try {
      var res = await fetchTimed('/api/events/' + eventId + '/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // 履歴を積む（採点画面の HistoryOutbox が使う。送れなかったら控えて送り直すので、失敗の形を返す）。
  // entry.clientId（控えの印）を付けると、サーバーは同じ印の履歴を二度積まない。
  // 戻り値: { ok: true, status, duplicate } | { ok: false, status（通信失敗は 0）, reason }
  async function postHistory(eventId, entry) {
    try {
      var res = await fetchTimed('/api/events/' + eventId + '/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
      var body = await readJsonSafe(res);
      if (res.ok) return { ok: true, status: res.status, duplicate: !!(body && body.duplicate) };
      return { ok: false, status: res.status, reason: (body && typeof body.reason === 'string') ? body.reason : '' };
    } catch (e) {
      return { ok: false, status: 0, reason: 'network' };
    }
  }

  // --- Live（配信用ボード） ---
  async function putLive(eventId, court, data) {
    // PUT /api/events/:eventId/live/:court
    // Body: { playerId: 選手ID | null, timer: { sec: 整数(0..5999), running: 真偽値 } }
    //       timer を省略するとサーバー側の値を据え置く。
    // 戻り値: { live: { playerId, timer, updatedAt } } | { error }（400/404） | null（通信失敗）
    // 採点画面はこの結果を待たない（配信が遅れても採点は続く）。
    try {
      var res = await fetchTimed('/api/events/' + eventId + '/live/' + encodeURIComponent(court), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        var errJson = await res.json();
        return { error: errJson.error };
      }
      var json = await res.json();
      return { live: json.live || null };
    } catch (e) {
      return null;
    }
  }

  async function loadLive(token) {
    // GET /api/links/:token/live（無認証）
    // 戻り値: { ok: true, data: { eventName, now, courts, techniques } }
    //       | { ok: false, status }
    //   status 400/404 → トークンが無効（board は「このリンクは無効です」を出して取得をやめる）
    //   status 0       → 通信失敗（board は前回の表示を保って取得を続ける）
    // courts はライブ状態のあるコートだけを持つ。各コートは
    // { updatedAt, timer: { sec, running }, player: {...} | null }。
    try {
      var res = await fetch('/api/links/' + encodeURIComponent(token) + '/live');
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, data: await res.json() };
    } catch (e) {
      return { ok: false, status: 0 };
    }
  }

  async function loadWatch(token, etag) {
    // GET /api/links/:token/watch（無認証。観戦ダッシュボード watch.html。設計書 2026-10-09 §2）
    // etag を渡すと If-None-Match を付け、変化が無ければ status 304・data null で返る。
    // 戻り値: { ok, status, data, etag }
    //   ok     … 200 または 304
    //   data   … 200 のときだけ { event, courts, ranking, techniques }（304・失敗は null）
    //   etag   … 応答の ETag。304・失敗のときは渡した etag をそのまま返す
    //   status … HTTP ステータス。0 は通信失敗・15 秒の時間切れ（400/404 はトークンが無効で、叩き続けない）
    // 応答の Date ヘッダーで serverNowMs の時計のずれを更新する（304 でも）。
    // fetch の cache は指定しない（If-None-Match を自分で付けると、ブラウザは勝手に補わず 304 をそのまま返す）。
    try {
      var headers = {};
      if (etag) headers['If-None-Match'] = etag;
      // 15 秒で打ち切る（fetchTimed）。打ち切りは catch で status 0 になり、画面は次の周で読み直す
      var res = await fetchTimed('/api/links/' + encodeURIComponent(token) + '/watch', { headers: headers });
      noteServerDate(res);
      var data = null;
      if (res.status === 200) data = await res.json();
      return {
        ok: res.status === 200 || res.status === 304,
        status: res.status,
        data: data,
        etag: (res.status === 200 && res.headers.get('ETag')) || etag || null
      };
    } catch (e) {
      return { ok: false, status: 0, data: null, etag: etag || null };
    }
  }

  // --- Ranking / Share ---
  async function loadRanking(eventId) {
    // GET /api/events/:eventId/ranking
    // 戻り値: { event: { name, date, venue, updatedAt, status },
    //          rankings: { male: [{ rank, name, score, counted }], female: [...], newFace: [...] },
    //          detail: { male: [{ r1, r2, r2Done } | null, ...], ... }（rankings と同じ並び。合計の内訳。2026-10-06）,
    //          best4: { final, remaining, rows: [{ name, total, r1, r2, rank }] } }
    //                  （ベスト4＝一般男子の合計の上位 4 名・同点は全員・0 点以下は除く。
    //                    final: false の間は暫定ベスト4 で、remaining は二巡目が未確定の一般男子の人数。
    //                    r2 は二巡目を終えた人だけ、まだなら null。EventStatus.best4Standings と同じ。
    //                    設計書 2026-10-04 2.6）
    //       | null（400/404/通信失敗）
    //   event.status は大会の状態（EventStatus.of。旧データの状態名は今の状態名に読み替えた値）。
    //   共有ページが表示条件（ベスト4 を出すか）に使う。rankings は EventStatus.rankings と同じ規則
    //   （key は返さない。counted は確定した得点のある組なら真。設計書 2026-10-05 2.3・4.2）。
    //   共有リンク越しの GET /api/links/:token/ranking（fetchSharedRanking）も同じ形。
    try {
      var res = await fetch('/api/events/' + eventId + '/ranking');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function createShareLink(eventId) {
    // POST /api/links
    // 戻り値: { token } | null（400/404/通信失敗）
    // 冪等。大会に shareToken があればそれをそのまま返す。
    try {
      var res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'event', targetId: eventId })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function loadShareLink(token) {
    // GET /api/links/:token（無認証）
    // 戻り値: { token, targetType, createdAt } | null
    // 不正・失効したトークンは null。呼び出し元は「このリンクは無効です」を出す。
    try {
      var res = await fetch('/api/links/' + encodeURIComponent(token));
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function loadSharedRanking(token) {
    // GET /api/links/:token/ranking（無認証）
    // 戻り値: loadRanking と同じ { event: { …, status }, rankings, best4 } | null
    var r = await fetchSharedRanking(token);
    return r.ok ? r.data : null;
  }

  async function fetchSharedRanking(token) {
    // GET /api/links/:token/ranking（無認証）。loadSharedRanking の結果を状態つきで返す版。
    // 戻り値: { ok: true, data } | { ok: false, status }
    //   status 400/404 → トークンが無効（画面は「このリンクは無効です」を出して取得をやめる）
    //   status 0       → 通信失敗（画面は前回の内容を残して取得を続ける）
    //   その他         → サーバー側の失敗（同上）
    try {
      var res = await fetch('/api/links/' + encodeURIComponent(token) + '/ranking');
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, data: await res.json() };
    } catch (e) {
      return { ok: false, status: 0 };
    }
  }

  // --- 招待リンク・採点の鍵のセッション・AI 用キー（設計書 2026-10-03 5.1） ---
  // 戻り値の形（10 関数で共通）:
  //   成功 … 本文がオブジェクトなら { ok: true, ...本文 }、配列（一覧）なら配列そのもの
  //   失敗 … { ok: false, status: HTTPステータス, reason, error, ...本文 }
  //          （reason は本文の reason か ''。error は本文の error か定型文。本文の他の項目
  //           （devices・expiresAt・retryAfter・fields など）もそのまま載る）
  //   通信そのものの失敗（15 秒の時間切れも） … { ok: false, status: 0, reason: 'network', error }
  // 鍵（招待の key・AI キー）は本文で 1 回だけ返る。呼び出し元は表示し終えたら変数から捨てること。
  // この層は鍵をどこにも控えない（console にも出さない）。
  async function requestJson(method, url, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var t = timeoutSignal();
    try {
      if (t.signal) opts.signal = t.signal;
      var res = await fetch(url, opts);
      var json = await readJsonSafe(res);
      if (!res.ok) {
        var fail = Object.assign({}, (json && typeof json === 'object' && !Array.isArray(json)) ? json : {});
        fail.ok = false;
        fail.status = res.status;
        fail.reason = (json && typeof json.reason === 'string') ? json.reason : '';
        fail.error = (json && typeof json.error === 'string') ? json.error : defaultError(res.status);
        return fail;
      }
      if (Array.isArray(json)) return json;
      return Object.assign({}, (json && typeof json === 'object') ? json : {}, { ok: true });
    } catch (e) {
      return { ok: false, status: 0, reason: 'network', error: '通信できません' };
    } finally {
      t.clear();
    }
  }

  async function getSession() {
    // GET /api/session（誰でも）
    // 戻り値: { ok: true, role: 'admin' | 'scorer' | 'ai' | 'none', via: 'basic' | 'dev' | 'session' | 'bearer' | null,
    //           scope: { eventId, eventName, court（null は全コート） } | null, label, expiresAt, now,
    //           reason（role 'none' のとき auth_required / session_expired / session_revoked / invite_revoked） }
    //       | 失敗の形（古いサーバーは 404）
    return requestJson('GET', '/api/session');
  }

  async function join(key, confirm) {
    // POST /api/join { key, confirm }（無認証。鍵は本文だけで送る。URL に載せない）
    //   confirm: false … 下見。セッションも Cookie も作らない（端末の枠を使わない）
    //   confirm: true  … 登録。Set-Cookie（HttpOnly）でこの端末を採点端末にする
    // 戻り値: { ok: true, role, eventId, eventName, court, label, expiresAt, now,
    //           devices: { active, max }, rejoin }（下見）| { ok: true, …同じ, next }（登録。next は採点画面の URL）
    //       | 失敗の形（401 key_invalid / invite_revoked / invite_expired（expiresAt 付き）、
    //         409 device_limit（devices 付き）、429 rate_limited（retryAfter 付き）、400 bad_request）
    return requestJson('POST', '/api/join', { key: typeof key === 'string' ? key : '', confirm: confirm === true });
  }

  async function logout() {
    // POST /api/session/logout（この端末の登録を解除する。Cookie を消す）
    // 戻り値: { ok: true, success: true } | 失敗の形
    return requestJson('POST', '/api/session/logout');
  }

  async function listInvites(eventId) {
    // GET /api/invites?eventId=…（運営）。eventId を省くと全大会
    // 戻り値: [{ id, role, eventId, eventName, court, label, createdAt, expiresAt, maxDevices,
    //            status: 'active' | 'expired' | 'revoked', revokedAt, revokedReason: 'manual' | 'event_deleted' | null,
    //            lastJoinAt, activeDevices,
    //            devices: [{ id, summary, ua, createdAt, lastSeenAt, revokedAt, status }] }]（新しい順）
    //       | 失敗の形
    return requestJson('GET', '/api/invites' + (eventId ? '?eventId=' + encodeURIComponent(eventId) : ''));
  }

  async function createInvite(opts) {
    // POST /api/invites（運営）
    // opts: { role: 'scorer'（省略時も scorer）, eventId, court: 'A' | null（全コート）, label?,
    //         maxDevices?（1〜5、既定 2）, expiresAt?, expiresPreset?: 'event'（既定）| 'today' | 'tomorrow' }
    // 戻り値: { ok: true, invite: <一覧の 1 行の形>, key, joinPath: '/join#k=<key>' }
    //         key・joinPath を返すのはこの 1 回だけ（QR に出したら捨てる）
    //       | 失敗の形（400 reason: bad_role / bad_event / unknown_court / bad_label / bad_max_devices /
    //         bad_expiry、404 大会なし）
    var body = Object.assign({ role: 'scorer' }, opts || {});
    return requestJson('POST', '/api/invites', body);
  }

  async function revokeInvite(id) {
    // POST /api/invites/:id/revoke（運営）。その招待で登録した端末もすべて次の通信から 401
    // 戻り値: { ok: true, success: true, revokedSessions } | 失敗の形
    return requestJson('POST', '/api/invites/' + encodeURIComponent(id) + '/revoke');
  }

  async function revokeSession(id) {
    // POST /api/sessions/:id/revoke（運営）。その端末だけ外す
    // 戻り値: { ok: true, success: true } | 失敗の形
    return requestJson('POST', '/api/sessions/' + encodeURIComponent(id) + '/revoke');
  }

  async function listAiKeys() {
    // GET /api/ai-keys（運営）
    // 戻り値: [{ id, label, createdAt, expiresAt, revokedAt, status, limits, lastUsedAt, useCount }] | 失敗の形
    return requestJson('GET', '/api/ai-keys');
  }

  async function createAiKey(opts) {
    // POST /api/ai-keys（運営）
    // opts: { label（1〜40 文字）, expiresInDays?（1〜90、既定 30）| expiresAt?, limits? }
    // 戻り値: { ok: true, aiKey: <一覧の 1 行の形>, key }（key はこの 1 回だけ）
    //       | 失敗の形（400 reason: bad_label / bad_expiry / bad_limits）
    return requestJson('POST', '/api/ai-keys', opts || {});
  }

  async function revokeAiKey(id) {
    // POST /api/ai-keys/:id/revoke（運営）
    // 戻り値: { ok: true, success: true } | 失敗の形
    return requestJson('POST', '/api/ai-keys/' + encodeURIComponent(id) + '/revoke');
  }

  return {
    getSession: getSession,
    join: join,
    logout: logout,
    listInvites: listInvites,
    createInvite: createInvite,
    revokeInvite: revokeInvite,
    revokeSession: revokeSession,
    listAiKeys: listAiKeys,
    createAiKey: createAiKey,
    revokeAiKey: revokeAiKey,
    listEvents: listEvents,
    loadEvent: loadEvent,
    loadEventResult: loadEventResult,
    saveEvent: saveEvent,
    updateEventInfo: updateEventInfo,
    serverNowMs: serverNowMs,
    deleteEvent: deleteEvent,
    copyEvent: copyEvent,
    createFromTemplate: createFromTemplate,
    changeStatus: changeStatus,
    updatePlayer: updatePlayer,
    createPlayer: createPlayer,
    createPlayersBulk: createPlayersBulk,
    updatePlayerInfo: updatePlayerInfo,
    reorderPlayers: reorderPlayers,
    arrangePlayers: arrangePlayers,
    deletePlayer: deletePlayer,
    importCsv: importCsv,
    exportCsv: exportCsv,
    exportBundle: exportBundle,
    importBundle: importBundle,
    generateNextRound: generateNextRound,
    loadTechniques: loadTechniques,
    saveTechniques: saveTechniques,
    resetTechniques: resetTechniques,
    loadEventTechniques: loadEventTechniques,
    saveEventTechniques: saveEventTechniques,
    resetEventTechniques: resetEventTechniques,
    loadHistory: loadHistory,
    addHistory: addHistory,
    postHistory: postHistory,
    putLive: putLive,
    loadLive: loadLive,
    loadWatch: loadWatch,
    loadRanking: loadRanking,
    createShareLink: createShareLink,
    loadShareLink: loadShareLink,
    loadSharedRanking: loadSharedRanking,
    fetchSharedRanking: fetchSharedRanking
  };
})();
