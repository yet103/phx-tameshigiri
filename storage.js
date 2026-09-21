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

  // いまの端末で開くべき運営画面のモード。控えが無ければ画面幅（1024px 以上を PC）で決める。
  // トップの 🖥/📱 ボタンは「いまどちらか」の表示にこれを使う。表示と行き先が
  // 食い違わないよう、adminHref もこの 1 つの判定を通す。
  function currentMode() {
    var mode = loadMode();
    if (mode) return mode;
    var wide = false;
    try {
      wide = !!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches);
    } catch (e) {
      wide = false;
    }
    return wide ? 'pc' : 'mobile';
  }

  // いまの端末で開くべき運営画面の URL（ハッシュ付き）。
  function adminHref(hash) {
    return modeHref(hash, currentMode());
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

  // --- 大会ファイルの取り込み（PC 運営 desk-events.js とスマホ運営 admin-events.js で共用）---

  // ファイル選択ダイアログを出し、選ばれたファイルの中身（UTF-8 の文字列）を onText に渡す。
  // accept は <input type="file"> の accept 属性（'.json,application/json' など）。
  // onText は Promise を返してもよい（取り込みの完了まで onDone を待たせる）。
  // onDone は選択〜取り込みが終わった時点（成功・失敗・キャンセルのどれでも）で一度だけ
  // 呼ぶ。呼び出し元はこれでボタンの disabled を戻す。省略してもよい。
  // ページに <input type="file"> を置かずに済ませるため、その場で作って捨てる。
  function pickTextFile(accept, onText, onDone) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    var removed = false;
    var fileChosen = false;   // change でファイルを受け取ったら true
    var finished = false;
    function cleanup() {
      if (removed) return;
      removed = true;
      window.removeEventListener('focus', onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    }
    function finish() {
      if (finished) return;
      finished = true;
      if (onDone) onDone();
    }
    // ファイル選択ダイアログをキャンセルすると change は発火しない。
    // cancel イベントが取れる環境ではそれで、取れない環境（フォールバック）では
    // ダイアログを閉じてウィンドウに戻ってきた最初の focus で片付ける。
    function onCancel() { cleanup(); finish(); }
    function onFocus() {
      // change がこの同じ tick で来ることがある（フォーカスが先に戻る環境）。
      // ここで即 cleanup すると、その change を取りこぼす。
      setTimeout(function() {
        cleanup();
        if (!fileChosen) finish();   // ファイルを選んでいれば finish は change 側に任せる
      }, 0);
    }
    input.addEventListener('cancel', onCancel);
    window.addEventListener('focus', onFocus);

    input.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) {
        fileChosen = true;
        var reader = new FileReader();
        reader.onload = function(ev) {
          var r = null;
          try {
            r = onText(ev.target.result);
          } catch (err) {
            console.error(err);
          }
          // 成功でも例外でもボタンを戻す（reject 側を落とすと無効のまま残る）
          if (r && typeof r.then === 'function') r.then(finish, finish);
          else finish();
        };
        reader.onerror = function() { alert('ファイルを読めませんでした。'); finish(); };
        reader.readAsText(file, 'UTF-8');
      } else {
        finish();
      }
      cleanup();
    });
    input.click();
  }

  // 大会のエクスポートファイル（JSON）を選ぶ。desk-events.js / admin-events.js が使う。
  function pickJsonFile(onText, onDone) {
    pickTextFile('.json,application/json', onText, onDone);
  }

  // 選手の CSV を選ぶ。desk-players.js / admin-players.js の「CSV 取り込み」が使う。
  function pickCsvFile(onText, onDone) {
    pickTextFile('.csv,text/csv', onText, onDone);
  }

  // 取り込むファイルがこのアプリのエクスポートかどうか。
  // 文言はサーバー（server/index.js の POST /api/events/import）と揃える。
  // 戻り値: { ok: true } | { ok: false, error: '…' }
  function checkBundle(bundle) {
    if (!bundle || typeof bundle !== 'object' || bundle.format !== 'phx-tameshigiri-event') {
      return { ok: false, error: 'このアプリのエクスポートファイルではありません。' };
    }
    if (bundle.version !== 1) {
      return { ok: false, error: '対応していないファイル形式です（version: ' + bundle.version + '）\n' +
        'このアプリを更新してください。' };
    }
    return { ok: true };
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
  // 列は CSV エクスポート（server/index.js の export）と同じ18列に揃える
  // （選手の追加項目 ゼッケン・級位段位・レンタルを末尾に足す）。
  function buildPlayersHtml(players) {
    var rows = players.map(function(p) {
      var adj = Array.isArray(p.adjust) ? p.adjust : [0, 0, 0];
      return '<tr><td>' + [
        esc(p.name), esc(p.order), esc(p.tech1), esc(p.tech2), esc(p.tech3),
        esc(String(p.score !== undefined ? p.score : '')), p.isNewFace ? '○' : '', p.isFemale ? '○' : '',
        esc(p.result),
        esc(String(Number(adj[0]) || 0)), esc(String(Number(adj[1]) || 0)), esc(String(Number(adj[2]) || 0)),
        esc(String(Number(p.totalAdjust) || 0)), esc(p.note), p.confirmed === true ? '○' : '',
        (typeof p.bib === 'number') ? esc(String(p.bib)) : '', esc(p.rank), p.rental === true ? '○' : ''
      ].join('</td><td>') + '</td></tr>';
    });
    return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
      '<style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px}' +
      'th{background:#eee}</style></head><body>' +
      '<table><tr><th>選手名</th><th>順番</th><th>技1</th><th>技2</th><th>技3</th>' +
      '<th>得点</th><th>新人</th><th>女子</th><th>結果</th>' +
      '<th>補正点1</th><th>補正点2</th><th>補正点3</th><th>全体補正</th><th>備考</th><th>確定</th>' +
      '<th>ゼッケン</th><th>級位段位</th><th>レンタル</th></tr>' +
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
    currentMode: currentMode,
    adminHref: adminHref,
    todayLocal: todayLocal,
    pickJsonFile: pickJsonFile,
    pickTextFile: pickTextFile,
    pickCsvFile: pickCsvFile,
    checkBundle: checkBundle,
    downloadText: downloadText,
    downloadCsv: downloadCsv,
    downloadHtml: downloadHtml,
    bundleFilename: bundleFilename,
    buildPlayersHtml: buildPlayersHtml,
    esc: esc
  };
})();
