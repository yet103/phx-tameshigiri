// 大会ファイル（bundle JSON。「💾 ファイルに保存」の出力）の取り込み処理。
// トップ（home.js）・PC 運営（desk-events.js）・スマホ運営（admin-events.js）で共用する
// （設計書 2026-10-05-home-import-entry-design.md §3）。
// 担うのは JSON 解析 → 形式検査（Storage.checkBundle）→ 同名同日の確認 → 送信（Api.importBundle）
// → 結果まで。ボタンの disabled 管理・完了の文言の表示・画面遷移は呼ぶ側が行う。
// 依存: Storage（checkBundle）、Api（listEvents / importBundle）、Courts（bibDroppedMessage）。
var BundleImport = (function() {

  // text（ファイルの中身）を取り込む。
  // hooks（省略可）:
  //   isStale()   待ち合わせの後に呼び、true なら黙って null を返す（PC 運営の ctx.isStale）
  //   confirm(m)  既定は window.confirm
  //   alert(m)    既定は window.alert
  // 戻り値: { id, playerCount, bibDropped } | null（失敗・取りやめ。失敗は alert 済み）
  async function run(text, hooks) {
    hooks = hooks || {};
    var say = hooks.alert || function(m) { window.alert(m); };
    var ask = hooks.confirm || function(m) { return window.confirm(m); };
    var stale = hooks.isStale || function() { return false; };

    var bundle;
    try {
      bundle = JSON.parse(text);
    } catch (e) {
      say('ファイルを読めませんでした。');
      return null;
    }
    var chk = Storage.checkBundle(bundle);
    if (!chk.ok) { say(chk.error); return null; }

    var name = (bundle.event && bundle.event.name) || '';
    var date = (bundle.event && bundle.event.date) || '';

    // 取り込みは常に新しい大会として追加される。同名・同日があれば先に断りを入れる。
    // 一覧が取れなかった（null）ときは確認なしで進む（取り込み自体は別の通信）。
    var existing = await Api.listEvents();
    if (stale()) return null;
    if (Array.isArray(existing)) {
      var dup = existing.filter(function(e) {
        return String(e.name || '').trim() === String(name).trim() &&
               String(e.date || '') === String(date);
      });
      if (dup.length > 0 &&
          !ask('同じ名前と日付の大会が既にあります。\n別の大会として追加しますか？')) {
        return null;
      }
    }

    var result = await Api.importBundle(bundle);
    if (stale()) return null;
    if (!result) {
      say('取り込みに失敗しました。通信を確認してください。');
      return null;
    }
    if (!result.success) {
      say('取り込みに失敗しました。\n' + (result.error || ''));
      return null;
    }
    return { id: result.id, playerCount: result.playerCount || 0, bibDropped: result.bibDropped };
  }

  // 完了の文言。ゼッケンの重複・範囲外は取り込みを弾かず「未設定」に落とす（サーバー側）ので、
  // その件数があれば文言に足す（設計書「選手の追加項目」レビュー修正）。
  function message(result) {
    var n = (result && result.playerCount) || 0;
    var bib = Courts.bibDroppedMessage(result && result.bibDropped);
    return '大会を取り込みました（' + n + ' 名）' + (bib ? '。' + bib : '');
  }

  return { run: run, message: message };
})();
