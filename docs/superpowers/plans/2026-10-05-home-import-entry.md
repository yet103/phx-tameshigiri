# トップの「📂 ファイルから取り込む」入口と取り込み導線の整理 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** トップ（index.html）から大会ファイル（bundle JSON）を取り込めるようにし、PC／スマホ運営に二重にある取り込み処理を共通部品にまとめ、ボタン名と案内で「大会ファイル」と「選手 CSV」の取り込みを区別する。

**Architecture:** 新しいグローバル IIFE `BundleImport`（bundle-import.js）が JSON 解析→形式検査→同名同日の確認→送信→結果を担い、3 画面（トップ・PC 運営・スマホ運営）はボタンの disabled 管理・完了文言・遷移だけを持つ。トップは遷移してしまうので、完了文言は `Storage.setPendingToast` で sessionStorage に 1 回きり置き、desk.js／admin.js が起動時に `takePendingToast` で出す。

**Tech Stack:** 素の JavaScript（IIFE、ES5 流儀、`var`）、test.html のブラウザテスト（`assert(desc, actual, expected)`）、Node サーバーは変更なし。設計書: `docs/superpowers/specs/2026-10-05-home-import-entry-design.md`。

**前提:** ブランチ `feature/home-import-entry` を master から切る。test.html は開発サーバー（`.claude/launch.json` の dev-3461、`http://localhost:3461/test.html`）で開き、末尾の「Result: N passed, 0 failed」を確かめる（開始時点 1843 passed）。「いまのファイルを正とする」: 以下のコード断片は計画時点のもの。周辺が違っていれば今のファイルに合わせる。

---

### Task 1: 共通部品 `bundle-import.js`（run と message）

**Files:**
- Create: `bundle-import.js`
- Modify: `server/static-policy.js:22-30`（PROTECTED_FILES に足す）
- Modify: `test.html:16-34`（script タグ）と `test.html:6913` 付近（checkBundle のテストの後ろ）

- [ ] **Step 1: テストを書く（test.html の checkBundle のテストの直後に足す）**

```javascript
    // ---- bundle-import.js（トップ・PC 運営・スマホ運営で共用の取り込み処理。設計書 2026-10-05 §3） ----
    await (async function() {
      var biAlerts = [], biConfirms = [], biSent = [];
      var biOrigList = Api.listEvents, biOrigImport = Api.importBundle;
      var biHooks = {
        alert: function(m) { biAlerts.push(String(m)); },
        confirm: function(m) { biConfirms.push(String(m)); return biConfirmAnswer; }
      };
      var biConfirmAnswer = true;
      var biGood = JSON.stringify({ format: 'phx-tameshigiri-event', version: 1,
        event: { name: '大会X', date: '2026-10-05', players: [] } });
      Api.listEvents = async function() { return [{ id: 'e9', name: '大会X', date: '2026-10-05' }]; };
      Api.importBundle = async function(b) { biSent.push(b); return { success: true, id: 'new1', playerCount: 3, bibDropped: { duplicate: 1, outOfRange: 0 } }; };
      try {
        var r1 = await BundleImport.run('{', biHooks);
        assert('BundleImport.run: JSON が壊れていれば alert して null', [r1, biAlerts], [null, ['ファイルを読めませんでした。']]);
        biAlerts = [];
        var r2 = await BundleImport.run('{"format":"x"}', biHooks);
        assert('BundleImport.run: 形式が違えば checkBundle の文言で alert して null', [r2, biAlerts], [null, ['このアプリのエクスポートファイルではありません。']]);
        biAlerts = []; biConfirmAnswer = false;
        var r3 = await BundleImport.run(biGood, biHooks);
        assert('BundleImport.run: 同名同日があり confirm で いいえ → 送らず null',
          [r3, biConfirms, biSent.length], [null, ['同じ名前と日付の大会が既にあります。\n別の大会として追加しますか？'], 0]);
        biConfirms = []; biConfirmAnswer = true;
        var r4 = await BundleImport.run(biGood, biHooks);
        assert('BundleImport.run: 成功 → { id, playerCount, bibDropped }',
          [r4, biSent.length, biAlerts], [{ id: 'new1', playerCount: 3, bibDropped: { duplicate: 1, outOfRange: 0 } }, 1, []]);
        var r5 = await BundleImport.run(biGood, { alert: biHooks.alert, confirm: biHooks.confirm, isStale: function() { return true; } });
        assert('BundleImport.run: isStale が真なら黙って null（送らない）', [r5, biSent.length, biAlerts], [null, 1, []]);
        Api.listEvents = async function() { return null; };
        var r6 = await BundleImport.run(biGood, biHooks);
        assert('BundleImport.run: 一覧が取れなくても確認なしで送る', [r6 && r6.id, biConfirms], ['new1', []]);
        Api.importBundle = async function() { return null; };
        var r7 = await BundleImport.run(biGood, biHooks);
        assert('BundleImport.run: 通信失敗 → alert して null', [r7, biAlerts], [null, ['取り込みに失敗しました。通信を確認してください。']]);
        biAlerts = [];
        Api.importBundle = async function() { return { success: false, error: '大会名が不正です' }; };
        var r8 = await BundleImport.run(biGood, biHooks);
        assert('BundleImport.run: サーバーが断れば error を添えて alert', [r8, biAlerts], [null, ['取り込みに失敗しました。\n大会名が不正です']]);
      } finally {
        Api.listEvents = biOrigList;
        Api.importBundle = biOrigImport;
      }
      assert('BundleImport.message: 落ちたゼッケンが無ければ人数だけ',
        BundleImport.message({ id: 'a', playerCount: 34, bibDropped: { duplicate: 0, outOfRange: 0 } }),
        '大会を取り込みました（34 名）');
      assert('BundleImport.message: 落ちたゼッケンがあれば文言を足す',
        BundleImport.message({ id: 'a', playerCount: 2, bibDropped: { duplicate: 1, outOfRange: 0 } }),
        '大会を取り込みました（2 名）。' + Courts.bibDroppedMessage({ duplicate: 1, outOfRange: 0 }));
      assert('BundleImport.message: playerCount 無しは 0 名', BundleImport.message({ id: 'a' }), '大会を取り込みました（0 名）');
    })();
```

- [ ] **Step 2: test.html に script タグを足す（`<script src="courts.js"></script>` の直後）**

```html
<script src="bundle-import.js"></script>
```

- [ ] **Step 3: test.html を開いて失敗を確かめる**

`http://localhost:3461/test.html` を開く。期待: bundle-import.js が 404 で `BundleImport is not defined` の例外（結果が出ない、または fail）。

- [ ] **Step 4: `bundle-import.js` を書く**

```javascript
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
```

- [ ] **Step 5: `server/static-policy.js` の PROTECTED_FILES に足す**

`'data.js', 'outbox.js', 'route.js', 'status.js', 'storage.js', 'techpicker.js',` の行の直後に:

```javascript
  'bundle-import.js',
```

- [ ] **Step 6: test.html を開いて通ることを確かめる**

期待: 新しい 11 件が ✓、Result の failed が 0。従来の「大会を取り込みました（n名）」は「n名」（空白なし）だったが、新しい文言は「n 名」（半角空白あり）。既存テストに「大会を取り込みました（」を含む assert があれば（`grep -n "大会を取り込みました" test.html`）この文言に直す。

- [ ] **Step 7: Commit**

```bash
git add bundle-import.js server/static-policy.js test.html
git commit -m "feat: 大会ファイルの取り込み処理を bundle-import.js に共通化（設計書 2026-10-05 §3。まだ呼ぶ側は未置換）"
```

---

### Task 2: `Storage.setPendingToast` / `takePendingToast`

**Files:**
- Modify: `storage.js`（loadMode/saveMode の近く＋ return の一覧）
- Modify: `test.html`（Task 1 のテストの直後）

- [ ] **Step 1: テストを書く**

```javascript
    // ---- 1 回きりの通知（トップから運営画面へ飛ぶときの完了文言。設計書 2026-10-05 §3.2） ----
    try { sessionStorage.removeItem('phx.pendingToast'); } catch (e) {}
    assert('takePendingToast: 何も無ければ空文字', Storage.takePendingToast(), '');
    Storage.setPendingToast('大会を取り込みました（34 名）');
    assert('takePendingToast: 置いた文言が 1 回だけ読める',
      [Storage.takePendingToast(), Storage.takePendingToast()], ['大会を取り込みました（34 名）', '']);
    Storage.setPendingToast('');
    assert('setPendingToast: 空文字は置かない', Storage.takePendingToast(), '');
```

- [ ] **Step 2: test.html を開いて失敗を確かめる**

期待: `Storage.takePendingToast is not a function`。

- [ ] **Step 3: storage.js に足す（saveMode の直後）**

```javascript
  // 1 回きりの通知（設計書 2026-10-05-home-import-entry-design.md §3.2）。
  // トップは運営画面へ遷移してしまい toast を出せないので、文言を sessionStorage に置いてから
  // 遷移し、desk.js / admin.js が起動時に takePendingToast で読んで消す。
  // sessionStorage が使えない環境（プライベートモード等）では黙って何もしない。
  var PENDING_TOAST_KEY = 'phx.pendingToast';

  function setPendingToast(text) {
    var s = String(text == null ? '' : text);
    if (!s) return;
    try { sessionStorage.setItem(PENDING_TOAST_KEY, s); } catch (e) {}
  }

  function takePendingToast() {
    try {
      var s = sessionStorage.getItem(PENDING_TOAST_KEY) || '';
      if (s) sessionStorage.removeItem(PENDING_TOAST_KEY);
      return s;
    } catch (e) {
      return '';
    }
  }
```

return の一覧（`saveMode: saveMode,` の直後）に:

```javascript
    setPendingToast: setPendingToast,
    takePendingToast: takePendingToast,
```

- [ ] **Step 4: test.html を開いて通ることを確かめる**

期待: 3 件 ✓、failed 0。

- [ ] **Step 5: Commit**

```bash
git add storage.js test.html
git commit -m "feat: Storage.setPendingToast / takePendingToast（トップから運営画面へ飛ぶときの 1 回きりの通知）"
```

---

### Task 3: PC 運営・スマホ運営を共通部品に置き換え、ボタン名を変え、起動時に pending toast を出す

**Files:**
- Modify: `desk-events.js:19-28`（ボタン）と `desk-events.js:410-453`（importBundleText）
- Modify: `admin-events.js:14-23`（ボタン）と `admin-events.js:240-288` 付近（importBundleText）
- Modify: `desk.js:679-698`（init）、`admin.js:750-782`（init）
- Modify: `desk.html:35`、`admin.html:24`（script タグ）
- Modify: `test.html`（「📂 取り込む」を参照するテストがあれば文言を直す）

- [ ] **Step 1: 既存テストの文言を確認**

```bash
grep -n "📂 取り込む\|importBundleText" test.html desk-events.js admin-events.js
```

test.html に「📂 取り込む」を期待する assert があれば「📂 大会ファイルを取り込む」に直す（Step 5 で通す）。

- [ ] **Step 2: desk-events.js を置き換える**

ボタン（`btnImport.textContent = '📂 取り込む';` を含むブロック）を:

```javascript
    var btnImport = document.createElement('button');
    btnImport.type = 'button';
    btnImport.className = 'desk-btn';
    btnImport.textContent = '📂 大会ファイルを取り込む';
    btnImport.addEventListener('click', function() {
      // 選択〜取り込み完了まで二重送信を防ぐ
      btnImport.disabled = true;
      Storage.pickJsonFile(function(text) { return importBundleText(text, ctx); },
        function() { btnImport.disabled = false; });
    });
    head.appendChild(btnImport);
```

`importBundleText` 全体を:

```javascript
  // 大会ファイルの取り込み。中身は bundle-import.js（トップ・スマホ運営と共用）。
  // ここでは完了の文言と遷移だけ。区画を離れていたら（ctx.isStale）共通部品が null を返す。
  async function importBundleText(text, ctx) {
    var result = await BundleImport.run(text, { isStale: ctx.isStale });
    if (!result) return;
    Desk.toast(BundleImport.message(result));
    Desk.navigate('players', result.id);
  }
```

- [ ] **Step 3: admin-events.js を置き換える**

ボタンの `btnImport.textContent = '📂 取り込む';` を `'📂 大会ファイルを取り込む'` に。`importBundleText` 全体を:

```javascript
  // 大会ファイルの取り込み。中身は bundle-import.js（トップ・PC 運営と共用）。
  async function importBundleText(text) {
    var result = await BundleImport.run(text);
    if (!result) return;
    Admin.toast(BundleImport.message(result));
    Admin.navigate('players', result.id);
  }
```

- [ ] **Step 4: script タグと起動時の通知**

desk.html の `<script src="courts.js"></script>` の直後に `<script src="bundle-import.js"></script>`。admin.html も同じ位置に同じ 1 行。

desk.js の init、`applyRoute().catch(...)` の直前に:

```javascript
    // トップから取り込んで飛んできたときの完了文言（Storage.setPendingToast。設計書 2026-10-05 §3.2）
    var pending = Storage.takePendingToast();
    if (pending) toast(pending);
```

admin.js の init も同じ位置に同じ 3 行。

- [ ] **Step 5: test.html と画面で確かめる**

test.html: failed 0。開発サーバーの PC 運営 `http://localhost:3461/desk.html#events` でボタン名が「📂 大会ファイルを取り込む」、`tameshigiri_鎌倉大会（本番リハーサル）.json`（`C:\usr\data\AI-Workspace\90_WORK\20_OUTPUT\phx-tameshigiri_data_鎌倉\`）を選ぶと「同じ名前と日付の大会が既にあります」→ いいえ でも、はい → 「大会を取り込みました（34 名）」で選手登録が開くこと。確認で作った大会は行の「⋯」→ 🗑 削除。スマホ運営 `admin.html#events` も同じ。

- [ ] **Step 6: Commit**

```bash
git add desk-events.js admin-events.js desk.js admin.js desk.html admin.html test.html
git commit -m "refactor: PC 運営・スマホ運営の大会ファイル取り込みを BundleImport に置き換え、ボタン名を「📂 大会ファイルを取り込む」に。起動時に Storage.takePendingToast の文言を出す"
```

---

### Task 4: 選手登録のボタン名と 0 名のときの案内

**Files:**
- Modify: `desk-players.js:149-162`（ボタン）、`desk-players.js:883-900`（renderTable）
- Modify: `admin-players.js:1150-1158`（メニュー項目）、`admin-players.js:73-125`（render）
- Modify: `test.html`（「📄 CSV を取り込む」「📄 CSVインポート」を期待する assert があれば直す）

- [ ] **Step 1: 既存テストの文言を確認**

```bash
grep -n "CSV を取り込む\|CSVインポート\|btnDeskPlayersCsv" test.html
```

- [ ] **Step 2: desk-players.js**

`btnCsv.textContent = '📄 CSV を取り込む';` → `'📄 選手を CSV から取り込む'`。

renderTable の `var table = document.createElement('table');` の直前に:

```javascript
    // 選手が 0 名で編集できるときだけ、どの取り込みを使うかの案内（設計書 2026-10-05 §4）。
    // 大会ごと持ち込むファイル（.json）はここでは読めない（大会一覧の 📂）。
    if (players.length === 0 && !draft) {
      var hint = document.createElement('p');
      hint.className = 'desk-note';
      hint.id = 'playersImportHint';
      hint.textContent = '大会ごと持ち込むファイル（.json）は「大会一覧」の 📂 大会ファイルを取り込む、' +
        '選手だけの CSV はここの 📄 選手を CSV から取り込む から。';
      wrap.appendChild(hint);
    }
```

- [ ] **Step 3: admin-players.js**

`btnCsv.textContent = '📄 CSVインポート';` → `'📄 選手を CSV から取り込む'`。

render の `container.appendChild(head);`（見出しを付けた直後）に:

```javascript
    // 選手が 0 名で編集できるときだけ、どの取り込みを使うかの案内（設計書 2026-10-05 §4）
    if (ctx.players.length === 0 && !locked) {
      var hint = document.createElement('p');
      hint.className = 'field-note';
      hint.id = 'playersImportHint';
      hint.textContent = '大会ごと持ち込むファイル（.json）は「大会」タブの 📂 大会ファイルを取り込む、' +
        '選手だけの CSV はここの ⋯ → 📄 選手を CSV から取り込む から。';
      container.appendChild(hint);
    }
```

- [ ] **Step 4: 確認**

test.html failed 0。開発サーバーで空の大会（PC 運営 大会一覧「＋ 新規作成」で「テスト用 空」等）の選手登録を開き、案内が出ること。選手が 1 名いる大会では出ないこと。

- [ ] **Step 5: Commit**

```bash
git add desk-players.js admin-players.js test.html
git commit -m "feat: 選手登録のボタン名を「📄 選手を CSV から取り込む」に、0 名のときに大会ファイルと選手 CSV の使い分けの案内を出す"
```

---

### Task 5: トップの 3 つ目の入口

**Files:**
- Modify: `index.html:14-19`（script タグ）、`index.html:36-46`（入口）
- Modify: `home.js:659-695`（init）と return
- Modify: `home.css:56-71, 188-190`
- Modify: `test.html:6429` 付近（home.js の節）

- [ ] **Step 1: テストを書く（test.html の home.js の節の末尾）**

```javascript
    // トップの入口（設計書 2026-10-05 §2）。index.html は静的なので中身を取って見る
    await (async function() {
      var html = await fetch('index.html').then(function(r) { return r.text(); });
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var entries = doc.querySelectorAll('#paneHome .home-entries .home-entry');
      assert('index.html: 入口は 3 つ', entries.length, 3);
      var third = entries[2];
      assert('index.html: 3 つ目はボタンで「📂 ファイルから取り込む」',
        [third.tagName, third.id, third.querySelector('.home-entry-main').textContent],
        ['BUTTON', 'btnHomeImport', '📂 ファイルから取り込む']);
      assert('index.html: bundle-import.js と courts.js を読む',
        [!!doc.querySelector('script[src="bundle-import.js"]'), !!doc.querySelector('script[src="courts.js"]')], [true, true]);
    })();
    assert('Home.importHref: 取り込んだ大会の選手登録へ（いまのモード）',
      Home.importHref('ab c'), Storage.adminHref('#players/ab%20c'));
```

- [ ] **Step 2: test.html を開いて失敗を確かめる**

期待: 「入口は 3 つ」が 2、`Home.importHref is not a function`。

- [ ] **Step 3: index.html**

script タグ: `<script src="storage.js"></script>` の直後に

```html
  <script src="courts.js"></script>
  <script src="bundle-import.js"></script>
```

入口（`<nav class="home-entries" aria-label="入口">` の中、2 つ目の `</a>` の直後）に:

```html
        <button type="button" class="home-entry secondary" id="btnHomeImport">
          <span class="home-entry-main">📂 ファイルから取り込む</span>
          <span class="home-entry-sub">「💾 ファイルに保存」で書き出した大会ファイル（.json）を新しい大会として追加</span>
        </button>
```

index.html 冒頭のコメント「ハッシュ無し＝入口、#new＝…」はそのまま（区画は増えない）。

- [ ] **Step 4: home.js**

init の `document.getElementById('btnMode').addEventListener('click', onModeClick);` の直後に:

```javascript
    document.getElementById('btnHomeImport').addEventListener('click', onImportClick);
```

`// --- 起動 ---` の直前に:

```javascript
  // --- 📂 ファイルから取り込む（設計書 2026-10-05 §2.2）---

  // 取り込んだ大会の選手登録の URL（新規作成の完了と同じ行き先。PC／スマホのモードに従う）
  function importHref(id) {
    return Storage.adminHref('#players/' + encodeURIComponent(id));
  }

  // 押した瞬間にファイル選択を開く。選択中にハッシュが変わっても取り込みは続ける
  // （対象はサーバーで区画に依らない。途中で捨てると「選んだのに何も起きない」になる）。
  // 完了の文言はトップでは出せないので sessionStorage に置き、運営画面が起動時に出す。
  function onImportClick() {
    var btn = document.getElementById('btnHomeImport');
    btn.disabled = true;
    Storage.pickJsonFile(async function(text) {
      try {
        var result = await BundleImport.run(text);
        if (!result) return;
        Storage.setPendingToast(BundleImport.message(result));
        location.href = importHref(result.id);
      } catch (e) {
        console.error(e);
      }
    }, function() { btn.disabled = false; });
  }
```

return に `importHref: importHref,` を足す。

- [ ] **Step 5: home.css**

`.home-entry.primary .home-entry-note { ... }` の直後に:

```css
/* 3 つ目（📂 ファイルから取り込む）。年に数回の操作なので主文を小さく、補助の入口に見せる */
.home-entry.secondary { min-height: 0; padding: 10px 16px; font: inherit; text-align: left; cursor: pointer; width: 100%; }
.home-entry.secondary .home-entry-main { font-size: 16px; }
.home-entry.secondary:disabled { opacity: 0.6; cursor: default; }
```

`@media (min-width: 620px)` の `.home-entries { grid-template-columns: 1fr 1fr; }` の直後に:

```css
  .home-entry.secondary { grid-column: 1 / -1; }
```

- [ ] **Step 6: 確認**

test.html failed 0。`http://localhost:3461/` を開き、入口が 3 つで、3 つ目が広い幅では 2 列の下に横長、狭い幅（`resize_window` mobile）では 3 段目。押してファイル `tameshigiri_鎌倉大会（本番リハーサル）.json` を選ぶ → 同名同日の確認（開発サーバーに残っていれば）→ 運営画面の選手登録が開き「大会を取り込みました（34 名）」の toast が出る。もう一度トップへ戻っても toast が再び出ないこと（1 回きり）。キャンセルでボタンが戻ること。🖥/📱 で行き先が変わること（PC → desk.html、スマホ → admin.html）。確認で作った大会は削除。

- [ ] **Step 7: Commit**

```bash
git add index.html home.js home.css test.html
git commit -m "feat: トップの入口に「📂 ファイルから取り込む」を足す（設計書 2026-10-05 案 B）。押すとファイル選択→取り込み→運営画面の選手登録へ。完了の文言は Storage.setPendingToast で運営画面が出す"
```

---

### Task 6: ヘルプ

**Files:**
- Modify: `help.html:234-250`（大会タブの図の説明と「別のサーバーや PC から取り込む」）、`help.html:291-301`（CSV インポート）

- [ ] **Step 1: 文言を直す**

- 234 行目の `alt`: 「📂 取り込む」→「📂 大会ファイルを取り込む」。235 行目の `<span class="ui">📂 取り込む</span>` も同じ。
- 「別のサーバーや PC から取り込む」の `<ol>` を:

```html
    <ol>
      <li>持ち出す側の運営画面で、大会タブの行の <span class="ui">⋯</span> → <span class="ui">💾 ファイルに保存</span> を押す。<code>tameshigiri_日付_大会名.json</code> が保存されます。</li>
      <li>取り込む側で、トップの <span class="ui">📂 ファイルから取り込む</span> を押し、そのファイルを選ぶ（運営画面の大会タブの見出しの <span class="ui">📂 大会ファイルを取り込む</span> からでも同じです）。</li>
      <li><span class="msg">大会を取り込みました（n 名）</span> と出て、選手登録タブが開きます。</li>
    </ol>
```

- `<div class="note">` の末尾に 1 文: 「選手だけを足す CSV（選手登録の <span class="ui">📄 選手を CSV から取り込む</span>）とは別の機能です。大会ファイル（.json）は選手登録では読めません。」
- 291 行目の alt の「CSVインポート」→「選手を CSV から取り込む」、301 行目の `<span class="ui">📄 CSVインポート</span>` → `<span class="ui">📄 選手を CSV から取り込む</span>`。他にも `grep -n "CSV を取り込む\|CSVインポート\|📂 取り込む" help.html` で残りを直す。

- [ ] **Step 2: 確認**

`http://localhost:3461/help.html` で該当箇所を読み、崩れがないこと。

- [ ] **Step 3: Commit**

```bash
git add help.html
git commit -m "docs: ヘルプにトップの「📂 ファイルから取り込む」の手順を足し、取り込みのボタン名を新しい名前に直す"
```

---

### Task 7: 仕上げ（テスト全件・マージ・push）

- [ ] **Step 1: 全テスト**

test.html: failed 0（開始 1843 ＋ 約 18）。`npm test`（サーバー。変更なしだが通ることを確認）。

- [ ] **Step 2: 本番と同じ認証でも読めるか**

`server/static-policy.js` に `bundle-import.js` が PROTECTED_FILES にあること（Task 1）。index.html・desk.html・admin.html はどれも保護ページなので保護ファイルで正しい。公開ページ（share/present/board/help）はこのファイルを読まない。

- [ ] **Step 3: マージと push**

```bash
git checkout master
git merge --ff-only feature/home-import-entry
git push origin master
git merge-base --is-ancestor origin/production origin/master && git push origin master:production
git branch -d feature/home-import-entry
```

報告に「production へ push 済み、deploy.sh はお手元で」と書く。
