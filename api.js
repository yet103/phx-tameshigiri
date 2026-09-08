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

  async function deleteEvent(id) {
    // DELETE /api/events/:id
    try {
      var res = await fetch('/api/events/' + id, { method: 'DELETE' });
      return res.ok;
    } catch (e) {
      return false;
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
    // Body: { name, court, isFemale, isNewFace, tech1, tech2, tech3, round }
    // 戻り値: 追加された player オブジェクト | null（400/404/通信失敗）
    // order はサーバーが コート×性別×巡目 ごとに採番するので、送っても無視される。
    // round を省略すると 1（一巡目）。二巡目の行は generateNextRound が作る。
    try {
      var res = await fetch('/api/events/' + eventId + '/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) return null;
      var json = await res.json();
      return json.player || null;
    } catch (e) {
      return null;
    }
  }

  async function deletePlayer(eventId, playerId, force) {
    // DELETE /api/events/:eventId/players/:playerId?force=1
    // 戻り値: true（削除成功）
    //       | { blocked: true, player: { name, order, score } }（409: 採点済み）
    //       | false（404・400・通信失敗）
    // 削除後の再採番はしないので、番号には欠番が残る。
    try {
      var url = '/api/events/' + eventId + '/players/' + playerId +
                (force === true ? '?force=1' : '');
      var res = await fetch(url, { method: 'DELETE' });
      if (res.status === 409) {
        var conflict = await res.json();
        return { blocked: true, player: conflict.player || null };
      }
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function importCsv(eventId, csvText, mode, force) {
    // POST /api/events/:eventId/import
    // Body: { csvText, mode: 'replace' | 'append', force }
    // 戻り値: { success: true, playerCount } |
    //         { blocked: true, scoredCount } (409: 採点済みデータあり) | null
    try {
      var res = await fetch('/api/events/' + eventId + '/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: csvText, mode: mode || 'replace', force: force === true })
      });
      if (res.status === 409) {
        var conflict = await res.json();
        return { blocked: true, scoredCount: conflict.scoredCount || 0 };
      }
      if (!res.ok) return null;
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
    try {
      var res = await fetch('/api/techniques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ techniques: techs })
      });
      return res.ok;
    } catch (e) {
      return false;
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

  return {
    listEvents: listEvents,
    loadEvent: loadEvent,
    saveEvent: saveEvent,
    deleteEvent: deleteEvent,
    updatePlayer: updatePlayer,
    createPlayer: createPlayer,
    deletePlayer: deletePlayer,
    importCsv: importCsv,
    exportCsv: exportCsv,
    loadTechniques: loadTechniques,
    saveTechniques: saveTechniques,
    resetTechniques: resetTechniques,
    loadHistory: loadHistory,
    addHistory: addHistory
  };
})();
