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

  // --- 運営画面のモード（PC / スマホ）---
  // 運営画面は desk.html（PC）と admin.html（スマホ）の 2 枚。どちらを開くかの控えと、
  // ハッシュの読み替えをここ 1 箇所に置く（admin.js・desk.js・計画3の index.html が使う）。
  var MODE_KEY = 'tmg_mode';
  var MODE_PAGES = { pc: 'desk.html', mobile: 'admin.html' };

  // 'pc' | 'mobile' | null（控えが無い＝まだ選んでいない）
  function loadMode() {
    try {
      var v = localStorage.getItem(MODE_KEY);
      return (v === 'pc' || v === 'mobile') ? v : null;
    } catch (e) {
      return null;
    }
  }

  function saveMode(mode) {
    if (mode !== 'pc' && mode !== 'mobile') return;   // 知らない値で控えを壊さない
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  }

  // ハッシュをそのモードの語彙に読み替える（設計書「モードの切り替え」の対応表）。
  //   #round/<id>（スマホ） ⇔ #match/<id>（PC）
  //   #setup/<id> #techniques/<id>（PC にしか無い） → スマホでは #players/<id>
  //   知らない区画・大会IDの無い区画・空 → #events
  // 大会IDはエンコードされたまま持ち回る（デコードして組み直すと二重エンコードになる）。
  function mapHash(hash, mode) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    if (!raw) return '#events';
    var parts = raw.split('/');
    var tab = parts[0];
    var id = parts[1] || '';
    if (tab === 'events') return '#events';
    if (!id) return '#events';
    if (mode === 'pc') {
      if (tab === 'round') tab = 'match';
      if (['setup', 'techniques', 'players', 'match', 'results'].indexOf(tab) === -1) return '#events';
    } else {
      if (tab === 'match') tab = 'round';
      if (tab === 'setup' || tab === 'techniques') tab = 'players';
      if (['players', 'round', 'results'].indexOf(tab) === -1) return '#events';
    }
    return '#' + tab + '/' + id;
  }

  // 指定したモードの運営画面の URL（ハッシュ付き）。'pc' 以外はスマホ扱い。
  function modeHref(hash, mode) {
    var m = (mode === 'pc') ? 'pc' : 'mobile';
    return MODE_PAGES[m] + mapHash(hash, m);
  }

  // いまの端末で開くべき運営画面の URL。控えが無ければ画面幅（1024px 以上を PC）で決める。
  function adminHref(hash) {
    var mode = loadMode();
    if (!mode) {
      var wide = false;
      try {
        wide = !!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches);
      } catch (e) {
        wide = false;
      }
      mode = wide ? 'pc' : 'mobile';
    }
    return modeHref(hash, mode);
  }

  // 今日の日付（YYYY-MM-DD）。toISOString は UTC なので JST の深夜に前日になる。
  // 新規大会・コピーのダイアログの初期値に使う（admin-events.js / desk-events.js 共用）。
  function todayLocal() {
    var d = new Date();
    var mm = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    if (mm.length < 2) mm = '0' + mm;
    if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + mm + '-' + dd;
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

  // 大会を1ファイルに書き出すときのファイル名。
  //   bundleFilename('名古屋城決戦', '2025-10-25') → 'tameshigiri_2025-10-25_名古屋城決戦.json'
  // Windows / macOS のファイル名に使えない文字と制御文字を '_' に置き換え、大会名は40文字で切る。
  // サーバー（server/index.js の bundleFilename）にも同じ規則の実装があり、
  // そちらは Content-Disposition 用。画面はサーバーのヘッダーを使わずこちらで組む。
  function bundleFilename(name, date) {
    var safe = String(name == null ? '' : name)
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/[\x00-\x1f\x7f]/g, '_')
      .slice(0, 40)
      .trim();
    if (!safe) safe = '大会';
    var d = String(date == null ? '' : date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = 'nodate';
    return 'tameshigiri_' + d + '_' + safe + '.json';
  }

  // --- HTML生成 ---
  // 列は CSV エクスポート（server/index.js の export）と同じ15列に揃える。
  function buildPlayersHtml(players) {
    var rows = players.map(function(p) {
      var adj = Array.isArray(p.adjust) ? p.adjust : [0, 0, 0];
      return '<tr><td>' + [
        esc(p.name), esc(p.order), esc(p.tech1), esc(p.tech2), esc(p.tech3),
        esc(String(p.score !== undefined ? p.score : '')), p.isNewFace ? '○' : '', p.isFemale ? '○' : '',
        esc(p.result),
        esc(String(Number(adj[0]) || 0)), esc(String(Number(adj[1]) || 0)), esc(String(Number(adj[2]) || 0)),
        esc(String(Number(p.totalAdjust) || 0)), esc(p.note), p.confirmed === true ? '○' : ''
      ].join('</td><td>') + '</td></tr>';
    });
    return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
      '<style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px}' +
      'th{background:#eee}</style></head><body>' +
      '<table><tr><th>選手名</th><th>順番</th><th>技1</th><th>技2</th><th>技3</th>' +
      '<th>得点</th><th>新人</th><th>女子</th><th>結果</th>' +
      '<th>補正点1</th><th>補正点2</th><th>補正点3</th><th>全体補正</th><th>備考</th><th>確定</th></tr>' +
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
    loadMode: loadMode,
    saveMode: saveMode,
    mapHash: mapHash,
    modeHref: modeHref,
    adminHref: adminHref,
    todayLocal: todayLocal,
    downloadText: downloadText,
    downloadCsv: downloadCsv,
    downloadHtml: downloadHtml,
    bundleFilename: bundleFilename,
    buildPlayersHtml: buildPlayersHtml,
    esc: esc
  };
})();
