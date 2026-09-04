var Storage = (function() {
  var PLAYERS_KEY     = 'tmg_players';
  var TECHNIQUES_KEY  = 'tmg_techniques';
  var THEME_KEY       = 'tmg_theme';

  // --- localStorage ---
  function loadPlayers() {
    try {
      var raw = localStorage.getItem(PLAYERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  function savePlayers(players) {
    try {
      localStorage.setItem(PLAYERS_KEY, JSON.stringify(players));
      return true;
    } catch(e) { return false; }
  }

  function loadCustomTechniques() {
    try {
      var raw = localStorage.getItem(TECHNIQUES_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function saveCustomTechniques(techs) {
    try {
      localStorage.setItem(TECHNIQUES_KEY, JSON.stringify(techs));
      return true;
    } catch(e) { return false; }
  }

  function resetCustomTechniques() {
    localStorage.removeItem(TECHNIQUES_KEY);
  }

  function loadTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'light'; }
    catch(e) { return 'light'; }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch(e) {}
  }

  // --- CSV パーサ ---
  // 元アプリCSVフォーマット: 選手名,順番,技1,技2,技3,得点,新人,女子,結果
  function splitCsvLine(line) {
    var result = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else { cur += c; }
      } else {
        if (c === '"') { inQ = true; }
        else if (c === ',') { result.push(cur); cur = ''; }
        else { cur += c; }
      }
    }
    result.push(cur);
    return result;
  }

  function parseCsv(text) {
    var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var players = [];
    // ヘッダー行をスキップ
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var cols = splitCsvLine(line);
      players.push({
        name:      cols[0] || '',
        order:     cols[1] || '',
        tech1:     cols[2] || '',
        tech2:     cols[3] || '',
        tech3:     cols[4] || '',
        score:     parseFloat(cols[5]) || 0,
        isNewFace: cols[6] === '○',
        isFemale:  cols[7] === '○',
        result:    cols[8] || ''
      });
    }
    return players;
  }

  // --- CSV シリアライザ ---
  function quoteCsvField(val) {
    var s = String(val === undefined || val === null ? '' : val);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function serializeCsv(players) {
    var lines = ['選手名,順番,技1,技2,技3,得点,新人,女子,結果'];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      lines.push([
        p.name, p.order, p.tech1, p.tech2, p.tech3,
        p.score !== undefined ? p.score : '',
        p.isNewFace ? '○' : '',
        p.isFemale  ? '○' : '',
        p.result || ''
      ].map(quoteCsvField).join(','));
    }
    return lines.join('\r\n');
  }

  // --- ダウンロードヘルパ ---
  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 100);
  }

  function downloadCsv(filename, players) {
    downloadText(filename, '\uFEFF' + serializeCsv(players), 'text/csv;charset=utf-8');
  }

  function downloadHtml(filename, htmlContent) {
    downloadText(filename, htmlContent, 'text/html;charset=utf-8');
  }

  // --- HTML生成 ---
  function buildPlayersHtml(players) {
    var rows = players.map(function(p) {
      return '<tr><td>' + [
        esc(p.name), esc(p.order), esc(p.tech1), esc(p.tech2), esc(p.tech3),
        esc(String(p.score !== undefined ? p.score : '')), p.isNewFace ? '○' : '', p.isFemale ? '○' : '',
        esc(p.result)
      ].join('</td><td>') + '</td></tr>';
    });
    return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
      '<style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px}' +
      'th{background:#eee}</style></head><body>' +
      '<table><tr><th>選手名</th><th>順番</th><th>技1</th><th>技2</th><th>技3</th>' +
      '<th>得点</th><th>新人</th><th>女子</th><th>結果</th></tr>' +
      rows.join('') + '</table></body></html>';
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    loadPlayers: loadPlayers,
    savePlayers: savePlayers,
    loadCustomTechniques: loadCustomTechniques,
    saveCustomTechniques: saveCustomTechniques,
    resetCustomTechniques: resetCustomTechniques,
    loadTheme: loadTheme,
    saveTheme: saveTheme,
    parseCsv: parseCsv,
    serializeCsv: serializeCsv,
    downloadCsv: downloadCsv,
    downloadHtml: downloadHtml,
    buildPlayersHtml: buildPlayersHtml
  };
})();
