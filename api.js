var Api = (function() {

  // --- Events ---
  async function listEvents() {
    // GET /api/events
    // 戻り値: [{ id, name, date, venue, playerCount, updatedAt, createdAt }] or null（通信失敗時）
    // null は「取得に失敗した」、[] は「大会が0件」を表す。区別して呼び出し元に返す。
    try {
      var res = await fetch('/api/events');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function loadEvent(id) {
    // GET /api/events/:id
    // 戻り値: { id, name, date, venue, players, createdAt, updatedAt } or null
    // 通信自体に失敗した場合も null（fetch は回線断で reject する）
    try {
      var res = await fetch('/api/events/' + id);
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
      var res = await fetch('/api/events/' + id);
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
    // settings は { requireBib, requireRank }（ゼッケン・級位段位を必須にするか。設計書
    // 「選手の追加項目」）。他のキーが混ざっていてもサーバーが無視する。
    // 戻り値: { ok: true, event: { id, name, date, venue, updatedAt, settings } }
    //       | { ok: false, status: HTTPステータス, reason, error }（400 / 404 / 409。
    //         409 の reason は 'locked'）
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

  async function changeStatus(eventId, to) {
    // POST /api/events/:eventId/status
    // Body: { to: 'round1' }
    // 戻り値: { ok: true, status: 新しい状態 }
    //       | { ok: false, status: HTTPステータス, reason, error }（400 / 404 / 409）
    //       | null（通信そのものの失敗）
    // 409 の reason は 'transition' | 'empty' | 'no_round2'。画面はこれで
    // 「読み直す」「先に生成する」などの次の行動を出し分けるので、error だけでなく
    // reason も返す（他の API と違って ok:false に理由を載せるのはこのため）。
    try {
      var res = await fetch('/api/events/' + eventId + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to })
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
      return { ok: true, status: json.status };
    } catch (e) {
      return null;
    }
  }

  // --- Players ---
  async function updatePlayer(eventId, playerId, data) {
    // PATCH /api/events/:eventId/players/:playerId
    // Body: { score, result, その他の更新フィールド }
    // 戻り値: { ok: true } | { ok: false, status: <HTTPステータス> }
    // 通信自体に失敗した場合は status: 0（再送すれば通る見込みがある失敗）。
    // 送信キューは 404（送り先が存在しない＝何度送っても通らない）と
    // それ以外を区別する必要があるため、真偽値ではなく状態を返す。
    try {
      var res = await fetch('/api/events/' + eventId + '/players/' + playerId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true };
    } catch (e) {
      return { ok: false, status: 0 };
    }
  }

  async function createPlayer(eventId, data) {
    // POST /api/events/:eventId/players
    // Body: { name, court, isFemale, isNewFace, tech1, tech2, tech3, round, bib, rank, rental }
    // 戻り値: 追加された player オブジェクト（成功）
    //       | { player: null, reason, error }（409。確定済みガード（reason: 'locked'）と
    //         ゼッケン番号の重複（reason: 'bib'）の2種類）
    //       | null（400/404/通信失敗）
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
    //     | { rows: [{ name, court, isFemale, isNewFace, tech1, tech2, tech3, bib, rank, rental }, ...] }
    //       （行ごとに違う。bib / rank / rental は設計書「選手の追加項目」）
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
    //         bib, rank, rental } のうち送りたいものだけ。id と order は送っても無視される。
    // bib は null で未設定に戻せる（設計書「選手の追加項目」）。
    // 戻り値: { ok: true, player } | { ok: false, status: <HTTPステータス>, reason, error }
    //       （reason / error が付くのは 409 のときだけ。確定済みガード（reason: 'locked'）と
    //        ゼッケン番号の重複（reason: 'bib'）の2種類）
    // 通信自体に失敗した場合は status: 0。
    // 採点経路（Outbox → updatePlayer）と混ぜないため、同じPATCHでも別関数にしている。
    try {
      var res = await fetch('/api/events/' + eventId + '/players/' + playerId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        if (res.status === 409) {
          var conflict = null;
          try { conflict = await res.json(); } catch (e) { /* JSON でない応答 */ }
          return {
            ok: false,
            status: 409,
            reason: (conflict && conflict.reason) || '',
            error: (conflict && conflict.error) || 'サーバーがエラーを返しました（409）'
          };
        }
        return { ok: false, status: res.status };
      }
      var json = await res.json();
      return { ok: true, player: json.player || null };
    } catch (e) {
      return { ok: false, status: 0 };
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

  async function importCsv(eventId, csvText, mode, force) {
    // POST /api/events/:eventId/import
    // Body: { csvText, mode: 'replace' | 'append', force }
    // 戻り値: { success: true, playerCount, bibDropped: { duplicate, outOfRange } }
    //           （bibDropped は重複・範囲外で「未設定」に落とした件数。設計書「選手の追加項目」） |
    //         { blocked: true, reason, error, scoredCount } (409: reason は 'locked'
    //           （確定済み。この場合 scoredCount は0）か ''（採点済みデータあり）) |
    //         { success: false, error } (その他の4xx: 失敗理由を画面に出すため) | null（通信失敗）
    try {
      var res = await fetch('/api/events/' + eventId + '/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: csvText, mode: mode || 'replace', force: force === true })
      });
      if (res.status === 409) {
        var conflict = await res.json();
        return {
          blocked: true,
          reason: conflict.reason || '',
          error: conflict.error || ('サーバーがエラーを返しました（' + res.status + '）'),
          scoredCount: conflict.scoredCount || 0
        };
      }
      if (!res.ok) {
        var errJson = await res.json();
        return { success: false, error: errJson.error };
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
    //   { success: true, created, skipped, existingCount, untrackedCount, unassignedCount }
    //     created: 新規に作った二巡目行数
    //     skipped: source（order が解析できる一巡目）のうち既に二巡目行を生成済みだった人数
    //              （force での差分追加時に意味を持つ。それ以外は 0）
    //     existingCount: 呼び出し時点で既にあった二巡目行数
    //     untrackedCount: 既存の二巡目行のうち sourcePlayerId を持たない件数
    //                     （CSVインポート由来。force すると重複生成される）
    //     unassignedCount: order が解析できず二巡目を作れなかった一巡目選手の人数
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
      var res = await fetch('/api/techniques');
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

  async function saveEventTechniques(eventId, techs) {
    // PUT /api/events/:eventId/techniques
    // 戻り値: { success: true, techniques } | { success: false, error }（4xx。行番号つきの理由）
    //       | null（通信失敗）
    try {
      var res = await fetch('/api/events/' + eventId + '/techniques', {
        method: 'PUT',
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

  async function resetEventTechniques(eventId) {
    // DELETE /api/events/:eventId/techniques（雛形の複製で置き換える）
    // 戻り値: 真偽
    try {
      var res = await fetch('/api/events/' + eventId + '/techniques', { method: 'DELETE' });
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
      var res = await fetch('/api/events/' + eventId + '/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
      return res.ok;
    } catch (e) {
      return false;
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
      var res = await fetch('/api/events/' + eventId + '/live/' + encodeURIComponent(court), {
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

  // --- Ranking / Share ---
  async function loadRanking(eventId) {
    // GET /api/events/:eventId/ranking
    // 戻り値: { event: { name, date, venue, updatedAt },
    //          rankings: { male: [{ rank, name, score }], female: [...], newFace: [...] } }
    //       | null（400/404/通信失敗）
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
    // 戻り値: loadRanking と同じ { event, rankings } | null
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

  return {
    listEvents: listEvents,
    loadEvent: loadEvent,
    loadEventResult: loadEventResult,
    saveEvent: saveEvent,
    updateEventInfo: updateEventInfo,
    deleteEvent: deleteEvent,
    copyEvent: copyEvent,
    changeStatus: changeStatus,
    updatePlayer: updatePlayer,
    createPlayer: createPlayer,
    createPlayersBulk: createPlayersBulk,
    updatePlayerInfo: updatePlayerInfo,
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
    putLive: putLive,
    loadLive: loadLive,
    loadRanking: loadRanking,
    createShareLink: createShareLink,
    loadShareLink: loadShareLink,
    loadSharedRanking: loadSharedRanking,
    fetchSharedRanking: fetchSharedRanking
  };
})();
