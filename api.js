var Api = (function() {

  // --- Events ---
  async function listEvents() {
    // GET /api/events
    // 戻り値: [{ id, name, date, venue, playerCount, updatedAt, createdAt }]
    var res = await fetch('/api/events');
    if (!res.ok) return [];
    return await res.json();
  }

  async function loadEvent(id) {
    // GET /api/events/:id
    // 戻り値: { id, name, date, venue, players, createdAt, updatedAt } or null
    var res = await fetch('/api/events/' + id);
    if (!res.ok) return null;
    return await res.json();
  }

  async function saveEvent(event) {
    // POST /api/events
    // Body: eventオブジェクト全体
    // 戻り値: { success: true, id } or null
    var res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    if (!res.ok) return null;
    return await res.json();
  }

  async function deleteEvent(id) {
    // DELETE /api/events/:id
    var res = await fetch('/api/events/' + id, { method: 'DELETE' });
    return res.ok;
  }

  // --- Players ---
  async function updatePlayer(eventId, playerId, data) {
    // PATCH /api/events/:eventId/players/:playerId
    // Body: { score, result, その他の更新フィールド }
    var res = await fetch('/api/events/' + eventId + '/players/' + playerId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) return null;
    return await res.json();
  }

  async function importCsv(eventId, csvText, mode, force) {
    // POST /api/events/:eventId/import
    // Body: { csvText, mode: 'replace' | 'append', force }
    // 戻り値: { success: true, playerCount } |
    //         { blocked: true, scoredCount } (409: 採点済みデータあり) | null
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
  }

  async function exportCsv(eventId) {
    // GET /api/events/:eventId/export
    // 戻り値: CSVテキスト文字列
    var res = await fetch('/api/events/' + eventId + '/export');
    if (!res.ok) return null;
    return await res.text();
  }

  // --- Techniques ---
  async function loadTechniques() {
    // GET /api/techniques
    // 戻り値: { isCustom, techniques: [...] }
    var res = await fetch('/api/techniques');
    if (!res.ok) return null;
    return await res.json();
  }

  async function saveTechniques(techs) {
    // POST /api/techniques
    var res = await fetch('/api/techniques', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ techniques: techs })
    });
    return res.ok;
  }

  async function resetTechniques() {
    // DELETE /api/techniques
    var res = await fetch('/api/techniques', { method: 'DELETE' });
    return res.ok;
  }

  // --- History ---
  async function loadHistory(eventId) {
    // GET /api/events/:eventId/history
    var res = await fetch('/api/events/' + eventId + '/history');
    if (!res.ok) return { eventId: eventId, entries: [] };
    return await res.json();
  }

  async function addHistory(eventId, entry) {
    // POST /api/events/:eventId/history
    // Body: { action, playerName, techName, strike, value, detail }
    var res = await fetch('/api/events/' + eventId + '/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    return res.ok;
  }

  return {
    listEvents: listEvents,
    loadEvent: loadEvent,
    saveEvent: saveEvent,
    deleteEvent: deleteEvent,
    updatePlayer: updatePlayer,
    importCsv: importCsv,
    exportCsv: exportCsv,
    loadTechniques: loadTechniques,
    saveTechniques: saveTechniques,
    resetTechniques: resetTechniques,
    loadHistory: loadHistory,
    addHistory: addHistory
  };
})();
