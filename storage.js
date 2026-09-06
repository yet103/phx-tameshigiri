var Storage = (function() {
  var THEME_KEY = 'tmg_theme';

  function loadTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'light'; }
    catch(e) { return 'light'; }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch(e) {}
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

  function downloadCsv(filename, csvText) {
    downloadText(filename, '\uFEFF' + csvText, 'text/csv;charset=utf-8');
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
    loadTheme: loadTheme,
    saveTheme: saveTheme,
    downloadText: downloadText,
    downloadCsv: downloadCsv,
    downloadHtml: downloadHtml,
    buildPlayersHtml: buildPlayersHtml,
    esc: esc
  };
})();
