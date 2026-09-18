# トップページと採点画面の改名（`index.html` の作り直し・`scoring.html`） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 今の採点画面 `index.html` を `scoring.html` に改名し、`index.html` を「アプリの説明・全体の流れ・入口ボタン・進行中の大会一覧」を出すトップページとして作り直す。古いブックマーク（`index.html#event/<id>/<コート>`）は採点画面へ転送して生かす。

**Architecture:** トップの制御は新しい `home.js`（IIFE の `Home`）に閉じる。転送の判定 `Home.redirectTarget(hash)` と大会の並べ替え `Home.sortForHome(events)` は DOM に触らない純粋関数にして `test.html` で固定する。転送は本文を描く前に済ませたいので、`index.html` の `<head>` で `home.js` を読み、その場で `Home.redirectIfScoring()` を呼ぶ（`test.html` は `home.js` を読むが呼ばないので転送されない）。運営画面（PC / スマホ）の行き先は計画2で入れた `Storage.adminHref` / `Storage.modeHref` だけを通し、トップは行き先を組み立てない。採点画面の URL を知っている場所は `Admin.scoringHref`（スマホ運営）と `Desk.scoringHref`（PC 運営）と `Home.redirectTarget` の 3 箇所だけにする。

**Tech Stack:** 素の JavaScript（IIFE、`var`、`function`。`async`/`await` は可）、Express 5、`test.html`（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は `JSON.stringify` 比較）、`npm test`（`server/auth.test.js`。Node のテストランナー自作版）。

設計書: `docs/superpowers/specs/2026-09-18-pc-mode-and-event-status-design.md`（特に「全体構成 > ページ」「画面設計 > トップ」「画面設計 > モードの切り替え」「認証・静的配信」「テスト > 手動確認」の節）
前の計画: `docs/superpowers/plans/2026-09-18-event-status.md`（計画1。実装済み）、`docs/superpowers/plans/2026-09-18-desk-foundation.md`（計画2。実装済み。`Storage.loadMode/saveMode/mapHash/modeHref/adminHref`、`Desk.scoringHref`、`admin.html` の 🖥 ボタン）

この計画は設計書「実装の分割」の **計画3: トップと採点画面の改名** だけを扱う。計画4（PC の選手表と貼り付け）・計画5（PC の試合と結果、ヘルプの残り）は**やらない**。
採点画面（`app.js`）の中身（状態バナー・巡目の絞り込み・大会作成の撤去）は計画1で入っている。この計画で `app.js` に入れる変更は**運営画面へのリンクを `Storage.adminHref` に通す 1 箇所だけ**。

---

## 前提・共通の手順

- **サーバーの起動**: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。`.claude/launch.json` の `dev-3461` が同じ構成。既に起動していれば再利用する
- **サーバーを変えたら必ず再起動する**（`server/index.js` `server/static-policy.js` `status.js` は `require` で読まれる）。HTML / CSS / ブラウザ用 JS の変更だけなら再起動は不要
- **ブラウザのテスト**: `http://localhost:3461/test.html` を開き、ページ末尾の `Result: N passed, 0 failed` を確認する。編集後の再確認は同じ URL への再 navigate ではなく `location.reload()` か**新しいタブ**で行う（bfcache で古い JS が使われるため）
- **サーバーのテスト**: リポジトリのルートで `npm test`（`server/auth.test.js`）。末尾の `Result: N passed, 0 failed` を見る
- **画面確認**: `http://localhost:3461/`（トップ）、`http://localhost:3461/scoring.html`（採点。Task 2 以降）、`http://localhost:3461/admin.html`（スマホ運営）、`http://localhost:3461/desk.html`（PC 運営）、`http://localhost:3461/help.html`（マニュアル）
- 確認に使う大会は**自分でこの作業中に作った大会だけ**にする。**本物の大会「第10回全日本試し斬り大会」のデータには絶対に触らない**（状態を進めたり選手を消したりしない）
- `git add` は**明示したファイルだけ**を対象にする（同じ作業ツリーで他の人が作業していることがある。`git status` を見て他人のファイルを巻き込まない）
- コミットメッセージは日本語。接頭辞は `feat:` `fix:` `refactor:` `test:` `docs:`。末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける
- **作法**: IIFE、`var` と `function`、`async`/`await` は可。`await` の直後は必ず「自分が最新の要求か」を見てから DOM に触る（`home.js` では `seq !== listSeq` を見る）
- **`home.css` は `theme.css` の変数だけを使う**。`style.css` `admin.css` `desk.css` `help.css` は読まない。375px のスマホから PC まで同じ 1 枚で読める
- **状態の判定を直書きしない**（`event.status === 'final'` のような比較を書かず、`EventStatus.of` / `isScoringOpen` / `LABELS` を使う）

### 調査で分かっていること（実装前に読む）

- `Storage.adminHref` の既定（控えが無いときの `matchMedia('(min-width: 1024px)')`）は **計画2で実装済み**。Task 1 でこれを `Storage.currentMode()` として切り出すだけで、判定そのものは変えない
- `Route.parse('#event/<id>/<コート>')` が `{ eventId, court }` を返し、`#events` や壊れたパーセントエンコーディングでは `null` を返す。転送の判定はこれをそのまま使う（自前の正規表現を書かない）
- `Storage.downloadHtml` は `Storage.buildPlayersHtml(players)` で**その場で組んだ表の HTML** を保存する（`app.js:1188`）。自分のページのファイル名やソースは一切見ていないので、**改名の影響はない**
- `route.js` は `location.pathname` を保ったままハッシュだけ書き換える（`history.replaceState(null, '', location.pathname + location.search + hash)`）。**改名の影響はない**
- `server/index.js` に **SPA フォールバックは無い**（末尾は `app.use((req, res) => res.status(404).end())`）。`server/auth.js` も `index.html` を特別扱いしていない。`static-policy.js` の `normalize` が `"/" → 'index.html'` を返す 1 箇所だけが `index.html` という名前を知っている。**この 1 行は変えない**（`/` でトップが開くのが正しい）
- `server/index.js` の大文字小文字の迂回対策（`/INDEX.HTML` は 404）は許可リストの完全一致で効いている。`scoring.html` も同じ扱いになるので追加の作業は無い
- **`scoring.js` と `scoring.html` は別物**。`scoring.js` は得点計算のモジュールで、共有ページも読むので `PUBLIC_FILES`（無認証）にある。`scoring.html` は運営側のページなので `PROTECTED_FILES`（認証あり）に入れる。**`scoring.js` を動かさないこと**
- `admin-round.js` の「採点画面へ」は `Admin.scoringHref(ctx.eventId, currentCourt)` を呼ぶだけ（`admin-round.js:148,161`）。`Admin.scoringHref` を直せば済むので、**`admin-round.js` は変更しない**
- `deploy.sh` `Dockerfile` `docker-compose.yml` `package.json` に `index.html` の記述は無い（`Dockerfile` は `COPY . .`）。**変更しない**。リポジトリに `README` は無い
- `board.html` `share.html` `present.html` にページナビ（`page-links`）は無い。`index.html` への参照も無い。**変更しない**
- `.superpowers/brainstorm/` 配下の HTML にも `index.html` の記述があるが、ブレストの記録なので**触らない**

---

## ファイル構成

- **Create**: `home.js` — トップの制御。純粋関数（`redirectTarget` / `sortForHome`）と描画（ヘッダー・モードボタン・入口リンク・大会一覧）
- **Create**: `home.css` — トップの見た目。**Task 2 で全部書き、以降のタスクでは編集しない**（並行作業の衝突を避けるため。足りない見た目が出たら Task 2 の節に追記してからまとめて直す）
- **Rename**: `index.html` → `scoring.html`（`git mv`）。中身は page-links に「トップ」を足すだけ
- **Create**: `index.html`（改名後の新規）— トップページ
- **Modify**: `app.js` — 運営画面へのリンク 2 本を `Storage.adminHref` に通す
- **Modify**: `storage.js` — `currentMode()` を切り出して公開する（`adminHref` はそれを呼ぶだけにする）
- **Modify**: `admin.js` — `scoringHref` の `index.html` → `scoring.html`
- **Modify**: `desk.js` — `scoringHref` の `index.html` → `scoring.html`（計画3で直す旨の ★ コメントも消す）
- **Modify**: `ranking.html` `techniques.html` — page-links の「採点」を `scoring.html` に向け、先頭に「トップ」を足す
- **Modify**: `help.html` — page-links、採点画面の URL、トップページの説明
- **Modify**: `server/static-policy.js` — `PROTECTED_FILES` に `scoring.html` `home.js` `home.css`
- **Modify**: `server/auth.test.js` — `classify` のテストと HTTP のテスト
- **Modify**: `test.html` — `home.js` と `desk.js` を読み込み、`Home` の純粋関数・`Storage.currentMode`・`Admin.scoringHref` / `Desk.scoringHref` を固定する

---

## 並行できるタスク

- **Task 1 → Task 2** は順番に行う（Task 2 は `Home.redirectTarget` を使う）
- **Task 2 の後**は次の 3 組が並行できる（触るファイルが重ならない）:
  - **A**: Task 3 → Task 4（`index.html` と `home.js`）
  - **B**: Task 5（`admin.js` `desk.js` `ranking.html` `techniques.html` `test.html` `app.js`）
  - **C**: Task 6（`help.html`）
- **Task 7（通し確認）** は A・B・C が全部終わってから
- `index.html` を触るのは Task 2・3・4 だけ。`home.css` を触るのは Task 2 だけ。`test.html` を触るのは Task 1 と Task 5 だけ。この 3 つを守れば上の組は衝突しない

---

### Task 1: `home.js` の純粋関数と `Storage.currentMode`、静的配信の許可リスト

トップの判断のうち DOM を使わない部分を先に作る。転送するかどうか（`redirectTarget`）と、進行中の大会をどの順に並べるか（`sortForHome`）は、画面を作る前にテストで固定できる。
あわせて `Storage.adminHref` の中にある「控えが無いときの既定」を `Storage.currentMode()` として取り出す。トップの 🖥/📱 ボタンは「いまどちらのモードか」を表示に使うので、ボタンの表示とリンクの行き先が同じ判定から出るようにする（別々に判定すると、控えが無い端末で「🖥 と表示されているのに `desk.html` へ行く」といった食い違いが起きる）。
静的配信の許可リストにも、この計画で足す 3 ファイルをまとめて入れておく（ファイルがまだ無くても `classify` は名前だけを見るので問題ない。忘れると Task 2 で 404 になる）。

**Files:**
- Create: `home.js`
- Modify: `storage.js`（`adminHref` の節。`return {}` に `currentMode` を追加）
- Modify: `server/static-policy.js`（`PROTECTED_FILES`）
- Modify: `server/auth.test.js`（`classify: 運営用ページとそのアセットは protected` のテスト）
- Modify: `test.html`（`<script>` の並びと、`storage.js` 節・新しい `home.js` 節）

- [ ] **Step 1: 失敗するテストを書く（`test.html`）**

`test.html` の `<script src="admin.js"></script>` の直後に 1 行足す（`home.js` は `Route` と `EventStatus` を使うので、`route.js` `status.js` より後ろなら良い）。

```html
<script src="home.js"></script>
```

次に `storage.js` の節。`assert('saveMode: 知らない値は控えない（前の値のまま）', Storage.loadMode(), 'mobile');` の**直後**、控えを元に戻す `try { if (modeSaved === null) …` の**直前**に足す。

```js
    // currentMode は「控え → 無ければ画面幅」の判定。adminHref がこれを使う。
    Storage.saveMode('pc');
    assert('currentMode: 控えた値をそのまま返す', Storage.currentMode(), 'pc');
    Storage.saveMode('mobile');
    assert('currentMode: 控えを変えたら追従する', Storage.currentMode(), 'mobile');
    try { localStorage.removeItem('tmg_mode'); } catch (e) {}
    assert('currentMode: 控えが無くても pc か mobile のどちらかを返す',
      ['pc', 'mobile'].indexOf(Storage.currentMode()) !== -1, true);
    // 控えが無いときの既定は画面幅で決まる（テストの窓幅に依るので値は固定しない）。
    // 大事なのは「ボタンの表示に使う currentMode」と「リンクの行き先 adminHref」が食い違わないこと。
    assert('currentMode: adminHref と同じモードを指す',
      Storage.adminHref('#events'),
      (Storage.currentMode() === 'pc' ? 'desk.html' : 'admin.html') + '#events');
```

さらに、`route.js` の節の**直前**（`var h2r = document.createElement('h2'); h2r.textContent = 'route.js';` の前）に `home.js` の節を足す。

```js
    var h2home = document.createElement('h2');
    h2home.textContent = 'home.js';
    results.appendChild(h2home);

    // 転送（改名前のブックマーク対策）。ハッシュは組み直さずそのまま繋ぐ。
    assert('redirectTarget: 大会とコートのハッシュは採点画面へ',
      Home.redirectTarget('#event/abc/A'), 'scoring.html#event/abc/A');
    assert('redirectTarget: コート無しでも転送する',
      Home.redirectTarget('#event/abc'), 'scoring.html#event/abc');
    assert('redirectTarget: エンコードをそのまま持ち回る（二重エンコードしない）',
      Home.redirectTarget('#event/a%20b/' + encodeURIComponent('未分類')),
      'scoring.html#event/a%20b/' + encodeURIComponent('未分類'));
    assert('redirectTarget: ハッシュ無しは転送しない', Home.redirectTarget(''), null);
    assert('redirectTarget: null でも落ちない', Home.redirectTarget(null), null);
    assert('redirectTarget: 大会IDが無ければ転送しない', Home.redirectTarget('#event/'), null);
    assert('redirectTarget: 運営画面のハッシュは転送しない', Home.redirectTarget('#events'), null);
    assert('redirectTarget: 壊れたエンコードでも例外を投げず転送しない',
      Home.redirectTarget('#event/%E0%A4%A'), null);

    // 進行中の大会の並び（設計書「画面設計 > トップ」）。
    var homeEvents = [
      { id: 'd',   status: 'draft',       updatedAt: '2026-09-18T10:00:00.000Z' },
      { id: 'f',   status: 'final',       updatedAt: '2026-09-18T12:00:00.000Z' },
      { id: 'r1',  status: 'round1',      updatedAt: '2026-09-18T09:00:00.000Z' },
      { id: 'a',   status: 'archived',    updatedAt: '2026-09-18T13:00:00.000Z' },
      { id: 'r1d', status: 'round1_done', updatedAt: '2026-09-18T11:00:00.000Z' },
      { id: 'r2',  status: 'round2',      updatedAt: '2026-09-18T08:00:00.000Z' }
    ];
    assert('sortForHome: 採点中が先、次に準備中と巡目終了、最後に最終結果',
      Home.sortForHome(homeEvents).map(function(ev) { return ev.id; }),
      ['r1', 'r2', 'r1d', 'd', 'f']);
    assert('sortForHome: アーカイブは出さない',
      Home.sortForHome(homeEvents).filter(function(ev) { return ev.id === 'a'; }).length, 0);
    assert('sortForHome: 元の配列を書き換えない',
      (function() {
        var src = homeEvents.slice();
        Home.sortForHome(src);
        return src.map(function(ev) { return ev.id; });
      })(), ['d', 'f', 'r1', 'a', 'r1d', 'r2']);
    assert('sortForHome: 0 件でも落ちない', Home.sortForHome([]), []);
    assert('sortForHome: null でも落ちない', Home.sortForHome(null), []);
    assert('sortForHome: status の無い大会は推定する（一巡目を採点中 → 先頭）',
      Home.sortForHome([
        { id: 'x', status: 'final', updatedAt: '2026-09-18T20:00:00.000Z' },
        { id: 'y', updatedAt: '2026-09-18T01:00:00.000Z',
          players: [ { order: 'A-男子-1-1', score: 10 }, { order: 'A-男子-1-2', score: 0 } ] }
      ]).map(function(ev) { return ev.id; }), ['y', 'x']);
```

- [ ] **Step 2: テストが落ちるのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result:` の行が出ない。ブラウザのコンソールに `home.js` の 404 と `ReferenceError: Home is not defined`（`Storage.currentMode is not a function` が先に出ることもある。どちらでも良い）。

- [ ] **Step 3: `server/static-policy.js` に 3 ファイルを足す**

`PROTECTED_FILES` の中を次のように直す（`scoring.js` は `PUBLIC_FILES` にあるまま。動かさない）。

```js
const PROTECTED_FILES = new Set([
  'index.html', 'scoring.html', 'admin.html', 'desk.html', 'ranking.html', 'techniques.html',
  'style.css', 'admin.css', 'desk.css', 'home.css',
  'app.js', 'home.js',
  'admin.js', 'admin-events.js', 'admin-players.js', 'admin-round.js', 'admin-results.js',
  'desk.js', 'desk-events.js', 'desk-setup.js', 'desk-techniques.js',
  'desk-players.js', 'desk-match.js', 'desk-results.js', 'techedit.js',
  'courts.js', 'data.js', 'outbox.js', 'route.js', 'status.js', 'storage.js', 'techpicker.js'
]);
```

`server/auth.test.js` の `classify: 運営用ページとそのアセットは protected` のパス一覧に 4 つ足す。

```js
  for (const p of ['/', '/index.html', '/scoring.html', '/admin.html', '/ranking.html', '/techniques.html',
                   '/style.css', '/admin.css', '/home.css',
                   '/app.js', '/home.js', '/admin.js', '/admin-events.js', '/admin-players.js', '/admin-round.js',
                   '/admin-results.js', '/courts.js', '/data.js', '/outbox.js', '/route.js',
                   '/storage.js', '/techpicker.js']) {
```

- [ ] **Step 4: `storage.js` に `currentMode` を切り出す**

今の `adminHref`（`// いまの端末で開くべき運営画面の URL。…` の関数）を、次の 2 つに置き換える。判定の中身は変えない。

```js
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
```

`return {}` の `modeHref: modeHref,` の直後に公開を足す。

```js
    currentMode: currentMode,
```

- [ ] **Step 5: `home.js` を作る（純粋関数だけ）**

```js
// トップページ（index.html）の制御。
// ・改名前（index.html が採点画面だった頃）のブックマークを scoring.html へ転送する
// ・入口ボタンの行き先（運営画面は PC / スマホのモードで変わる）
// ・進行中の大会の一覧
// このファイルは test.html からも読まれる。DOM を持たないページで落ちないよう、
// 描画は init で #homeMain の有無を見てから行い、転送は index.html から明示的に呼ぶ。
var Home = (function() {

  // --- 転送（純粋関数）---

  // 採点画面へ転送すべきハッシュなら転送先の URL、そうでなければ null。
  // ハッシュの解釈は route.js に任せる（壊れたパーセントエンコーディングでも例外を投げない）。
  // 戻り値は受け取ったハッシュをそのまま繋ぐ。Route.build で組み直すと
  // すでにエンコード済みの大会IDが二重にエンコードされる。
  function redirectTarget(hash) {
    var h = String(hash == null ? '' : hash);
    if (!Route.parse(h)) return null;
    return 'scoring.html' + h;
  }

  // 実際に転送する。index.html の <head> から呼ぶ（本文を描く前に抜けるため）。
  // history に残さないよう replace を使う（戻るボタンで転送が繰り返されない）。
  function redirectIfScoring() {
    var to = redirectTarget(location.hash);
    if (!to) return false;
    location.replace(to);
    return true;
  }

  // --- 大会の並び（純粋関数）---

  // 設計書「画面設計 > トップ」の並び順。小さいほど上。
  //   0: 採点できる状態（一巡目 / 二巡目 進行中）
  //   1: 準備中・一巡目終了・二巡目終了（運営の手が要る）
  //   2: 最終結果（終わっている）
  function statusRank(status) {
    if (EventStatus.isScoringOpen(status)) return 0;
    if (status === 'final') return 2;
    return 1;
  }

  // 進行中の大会の一覧を並べ替える。アーカイブは除く。
  // 同じ段の中は updatedAt の新しい順、それも同じなら元の順（Array#sort は
  // 実装によって不安定なので、添字を持って同着の順を固定する）。
  // 元の配列は書き換えない。
  function sortForHome(events) {
    var rows = [];
    (events || []).forEach(function(ev, i) {
      var status = EventStatus.of(ev);
      if (status === 'archived') return;
      rows.push({ ev: ev, i: i, rank: statusRank(status) });
    });
    rows.sort(function(a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      var x = String(a.ev.updatedAt || ''), y = String(b.ev.updatedAt || '');
      if (x !== y) return x < y ? 1 : -1;
      return a.i - b.i;
    });
    return rows.map(function(r) { return r.ev; });
  }

  return {
    redirectTarget: redirectTarget,
    redirectIfScoring: redirectIfScoring,
    sortForHome: sortForHome
  };
})();
```

- [ ] **Step 6: テストが通るのを確認する**

サーバーを再起動する（`server/static-policy.js` を変えたため）。
Run: `npm test`
Expected: `Result: N passed, 0 failed`

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`。`home.js` の節に ✓ が 14 本、`storage.js` の節に `currentMode:` の ✓ が 4 本。

- [ ] **Step 7: コミット**

```bash
git add home.js storage.js server/static-policy.js server/auth.test.js test.html
git commit -m "$(cat <<'EOF'
feat: トップページの転送判定と大会の並べ替えを足す

index.html をトップページに作り直す準備。DOM を使わない判定
（redirectTarget / sortForHome）を先に入れてテストで固定した。
Storage.adminHref の中にあったモードの既定を currentMode として
取り出し、ボタンの表示とリンクの行き先が同じ判定から出るようにした。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `index.html` を `scoring.html` に改名し、新しいトップページを作る

`git mv` で採点画面を `scoring.html` にし、空いた `index.html` にトップページを作る。この 2 つを 1 つのコミットにするのは、途中で `/` が 404 になる状態を作らないため。
この時点のトップは「ヘッダー・説明・入口ボタン」まで。全体の流れの図は Task 3、進行中の大会一覧は Task 4 で足す（枠だけ置く）。

**Files:**
- Rename: `index.html` → `scoring.html`（`git mv`。中身は page-links の 1 行だけ直す）
- Create: `index.html`
- Create: `home.css`
- Modify: `home.js`（`// --- 描画 ---` 以降を追記、`return {}` に追加）
- Modify: `server/auth.test.js`（`誤った資格情報は 401、正しい資格情報で通る` のテスト）

- [ ] **Step 1: 失敗するテストを書く（`server/auth.test.js`）**

`test('誤った資格情報は 401、正しい資格情報で通る', …)` の中、`assert.strictEqual((await get(base, '/admin.html', basic(USER, PASS))).status, 200);` の直後に 1 行足す。

```js
    assert.strictEqual((await get(base, '/scoring.html', basic(USER, PASS))).status, 200);
```

- [ ] **Step 2: テストが落ちるのを確認する**

Run: `npm test`
Expected: `✗ 誤った資格情報は 401、正しい資格情報で通る` と出て、`Result: N passed, 1 failed`（`scoring.html` がまだ無いので express.static が 404 を返す）。

- [ ] **Step 3: 採点画面を改名する**

```bash
git mv index.html scoring.html
```

`scoring.html` の page-links を次のように直す（「トップ」を先頭に足す。`<strong>採点</strong>` は自分のページなのでそのまま）。

```html
  <!-- ページナビ -->
  <div class="page-links">
    <a href="index.html">トップ</a>
    <strong>採点</strong>
    <a href="admin.html" id="linkAdmin">運営</a>
    <a href="techniques.html" id="linkTechniques">技術リスト編集</a>
    <a href="ranking.html">順位表示</a>
    <a href="help.html">ヘルプ</a>
  </div>
```

`scoring.html` のそれ以外（`<title>`・読み込む CSS / JS・DOM）は**一切変えない**。

- [ ] **Step 4: `home.css` を作る**

```css
/* トップページ（index.html）専用のスタイル。
   375px のスマホから PC まで、この 1 枚で読めるように組む。
   style.css / admin.css / desk.css / help.css は読み込まない
   （各画面のレイアウトを持ち込まない）。色は theme.css の変数だけを使う。
   このファイルは計画3の Task 2 で書き切る。以降のタスクでは編集しない
   （並行作業で衝突するため。足りない見た目が出たら計画の Task 2 の節に
    追記してからまとめて直す）。 */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: "Meiryo", "Yu Gothic", "ヒラギノ角ゴ Pro W3", sans-serif;
  font-size: 15px;
  line-height: 1.7;
  background: var(--bg);
  color: var(--text);
}
button { font-family: inherit; cursor: pointer; border: none; border-radius: 4px; }

/* ===== 上部バー ===== */
.home-top {
  display: flex; align-items: center; gap: 4px;
  min-height: 48px; padding: 0 8px 0 16px;
  background: var(--band-bg); color: var(--band-text);
  border-bottom: 2px solid var(--gold);
}
.home-title {
  flex: 1; min-width: 0;
  font-family: var(--mincho); font-size: 18px; font-weight: 700; color: var(--gold-light);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 指で押す前提のタップ目標（他のページのバー類と同じ 44px） */
.home-icon-btn {
  width: 44px; height: 44px; font-size: 18px;
  background: transparent; color: var(--band-text);
}
.home-icon-btn:hover { background: var(--band-bg-2); }

/* ===== 本文 ===== */
.home-main { max-width: 760px; margin: 0 auto; padding: 16px 16px 64px; }
.home-main h2 {
  font-family: var(--mincho); font-size: 18px; margin: 28px 0 10px;
  padding-bottom: 4px; border-bottom: 1px solid var(--border);
}
.home-intro p { margin: 0 0 8px; }
.home-intro a { color: var(--accent); }

/* ===== 入口ボタン ===== */
.home-entries { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 18px; }
.home-entry {
  display: flex; flex-direction: column; justify-content: center;
  min-height: 64px; padding: 10px 14px;
  background: var(--card-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px; text-decoration: none;
}
.home-entry:hover { border-color: var(--accent); }
.home-entry.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.home-entry-main { font-size: 16px; font-weight: bold; }
.home-entry-sub { font-size: 12px; color: var(--text-muted); }
.home-entry.primary .home-entry-sub { color: var(--band-muted); }

/* ===== 進行中の大会 ===== */
.home-event-list { display: flex; flex-direction: column; gap: 8px; }
.home-event {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  min-height: 56px; padding: 8px 14px;
  background: var(--card-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px; text-decoration: none;
}
.home-event:hover { border-color: var(--accent); }
.home-event-name { flex: 1 1 auto; min-width: 0; font-size: 16px; font-weight: bold; }
.home-event-meta { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.home-badge {
  padding: 1px 8px; border-radius: 10px; font-size: 12px; white-space: nowrap;
  border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-muted);
}
.home-badge.on { border-color: var(--accent); color: var(--accent); font-weight: bold; }
.home-note { color: var(--text-muted); font-size: 13px; }

/* ===== 全体の流れの図（help.css の .diagram と同じ作り）=====
   図の文字サイズは viewBox の単位。375px のスマホでは図が 343px まで縮む
   （＝約 0.95 倍）ので、実際に 14px を割らないよう 16 単位を下限にする。 */
.diagram {
  background: var(--card-bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px; margin: 14px 0;
}
.diagram svg { display: block; width: 100%; height: auto; max-width: 480px; margin: 0 auto; }
.diagram .d-box { fill: var(--bg-secondary); stroke: var(--border); stroke-width: 1; }
.diagram .d-box-key { fill: var(--band-bg); stroke: var(--gold); stroke-width: 2; }
.diagram .d-title { fill: var(--text); font-family: var(--mincho); font-size: 18px; font-weight: bold; }
.diagram .d-title-key { fill: var(--gold-light); font-family: var(--mincho); font-size: 18px; font-weight: bold; }
.diagram .d-sub { fill: var(--text-muted); font-size: 16px; }
.diagram .d-sub-key { fill: var(--band-muted); font-size: 16px; }
.diagram .d-line { stroke: var(--gold-deep); stroke-width: 2; fill: none; }
.diagram .d-arrow { fill: var(--gold-deep); }
.diagram .d-legend { fill: var(--text); font-size: 16px; }

/* 2 列に置けるだけの幅があるときだけ入口ボタンを並べる */
@media (min-width: 620px) {
  .home-entries { grid-template-columns: 1fr 1fr; }
}
```

- [ ] **Step 5: 新しい `index.html` を作る**

図（Task 3）と大会一覧（Task 4）の入れ物は空のまま置く。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>試し斬り採点システム</title>
  <link rel="stylesheet" href="theme.css">
  <link rel="stylesheet" href="home.css">
  <!-- スクリプトはすべて head で読む。改名前（採点画面が index.html だった頃）の
       ブックマークを、本文を描く前に scoring.html へ転送したいため。
       どれも読み込み時には何もしない小さなモジュールなので、描画は遅れない。 -->
  <script src="route.js"></script>
  <script src="status.js"></script>
  <script src="api.js"></script>
  <script src="storage.js"></script>
  <script src="home.js"></script>
  <script>Home.redirectIfScoring();</script>
</head>
<body data-theme="light">

  <header class="home-top">
    <span class="home-title">試し斬り採点システム</span>
    <button type="button" class="home-icon-btn" id="btnTheme" aria-label="テーマ切り替え">🌙</button>
    <button type="button" class="home-icon-btn" id="btnMode"></button>
  </header>

  <main class="home-main" id="homeMain">

    <section class="home-intro">
      <p>試し斬りの大会を、選手の登録から採点・順位の発表まで一本で進めるためのアプリです。</p>
      <p>大会のデータはサーバーに1つだけあり、運営者の PC とスマホ、コートのタブレット、会場の大画面が同じ大会を読み書きします。</p>
      <p>大会には<strong>状態</strong>があり、運営者が「次へ進む」で1段ずつ進めます。コートの端末で採点できるのは「一巡目 進行中」「二巡目 進行中」のときだけです。</p>
      <p>初めての方は<a href="help.html">ヘルプ</a>をご覧ください。</p>
    </section>

    <nav class="home-entries" aria-label="入口">
      <a class="home-entry primary" id="linkAdmin" href="admin.html#events">
        <span class="home-entry-main">運営画面を開く</span>
        <span class="home-entry-sub">大会の作成・選手の登録・試合の進行</span>
      </a>
      <a class="home-entry" href="scoring.html">
        <span class="home-entry-main">採点画面（コート端末）</span>
        <span class="home-entry-sub">コートのタブレットで得点を入れる</span>
      </a>
      <a class="home-entry" href="ranking.html">
        <span class="home-entry-main">順位表示</span>
        <span class="home-entry-sub">大会の順位を見る・成績表を保存する</span>
      </a>
      <a class="home-entry" href="help.html">
        <span class="home-entry-main">ヘルプ</span>
        <span class="home-entry-sub">当日の手引き（マニュアル）</span>
      </a>
    </nav>

    <section class="home-events">
      <h2>進行中の大会</h2>
      <!-- home.js の loadEvents が中身を入れる（計画3 Task 4） -->
      <div class="home-event-list" id="homeEventList"></div>
    </section>

    <section class="home-flow">
      <h2>全体の流れ</h2>
      <!-- 図は計画3 Task 3 で入れる -->
    </section>

  </main>

</body>
</html>
```

- [ ] **Step 6: `home.js` に描画を足す**

`sortForHome` の後ろ、`return {` の前に足す。

```js
  // --- 描画 ---

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀' : '🌙';
  }

  // 🖥/📱 ボタン。いまのモードの「相手」を出す（スマホモードなら 🖥 ＝ PC へ）。
  // トップ自体の見た目はモードで変わらない。変わるのは運営画面へのリンクの行き先だけなので、
  // 押しても他のページへは移らず、控えとボタンとリンクだけを差し替える
  // （admin.html / desk.html のボタンは相手のページへ移る。そこだけ挙動が違う）。
  function applyMode() {
    var toPc = (Storage.currentMode() !== 'pc');
    var btn = document.getElementById('btnMode');
    var label = toPc ? 'PC 運営に切り替える' : 'スマホ運営に切り替える';
    btn.textContent = toPc ? '🖥' : '📱';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    updateAdminLinks();
  }

  function onModeClick() {
    Storage.saveMode(Storage.currentMode() === 'pc' ? 'mobile' : 'pc');
    applyMode();
  }

  // 運営画面へ向かうリンクの行き先をいまのモードで作り直す。
  // 大会の行は描き直さず href だけ差し替える（読み込み中の一覧を消さないため）。
  function updateAdminLinks() {
    var link = document.getElementById('linkAdmin');
    if (link) link.href = Storage.adminHref('#events');
    var rows = document.querySelectorAll('[data-event-id]');
    for (var i = 0; i < rows.length; i++) {
      rows[i].href = Storage.adminHref('#players/' + encodeURIComponent(rows[i].getAttribute('data-event-id')));
    }
  }

  // --- 起動 ---

  function init() {
    // test.html もこのファイルを読む。トップの DOM が無ければ何もしない。
    if (!document.getElementById('homeMain')) return;
    applyTheme(Storage.loadTheme());
    document.getElementById('btnTheme').addEventListener('click', function() {
      var next = Storage.loadTheme() === 'dark' ? 'light' : 'dark';
      Storage.saveTheme(next);
      applyTheme(next);
    });
    document.getElementById('btnMode').addEventListener('click', onModeClick);
    applyMode();
  }

  document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 7: テストが通るのを確認する**

サーバーは再起動しなくてよい（`server/` は変えていない）。
Run: `npm test`
Expected: `Result: N passed, 0 failed`

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`（Task 1 と同じ本数。`Home` の描画関数は DOM が無いので動かない）。

- [ ] **Step 8: ブラウザで確認する**

`http://localhost:3461/` を新しいタブで開き、次を確かめる。

1. トップが出る（見出し「試し斬り採点システム」、説明 4 行、入口ボタン 4 つ、「進行中の大会」の空の見出し）
2. 🌙 を押すとダークになり、再読み込みしても維持される。ライト・ダークどちらでも文字が読める
3. 🖥（または 📱）を押すとボタンの絵が入れ替わり、**ページは移らない**。そのまま「運営画面を開く」を押すと、🖥 表示のとき `admin.html#events`、📱 表示のとき `desk.html#events` へ行く（ボタンは「切り替え先」を示すので、表示と行き先は逆になる）
4. ブラウザの幅を 375px にしても横スクロールが出ず、ボタンが 1 列になる。1280px では入口ボタンが 2 列になる
5. `http://localhost:3461/index.html#event/<自分で作った大会ID>/A` を開くと、URL が `scoring.html#event/…/A` に変わって採点画面が出る。**戻るボタンを押してもトップに戻るだけで、転送が繰り返されない**
6. `http://localhost:3461/scoring.html` が今までどおり動く（大会を選べる。page-links に「トップ」がある）
7. `http://localhost:3461/` を幅 768px（タブレット想定）で開いてから「採点画面（コート端末）」を押し、採点画面が今までどおり使えること

- [ ] **Step 9: コミット**

```bash
git add index.html scoring.html home.css home.js server/auth.test.js
git commit -m "$(cat <<'EOF'
feat: 採点画面を scoring.html に改名しトップページを作る

ドメインを直打ちすると採点画面が開いていたのを、説明と入口を出す
トップページに変えた。改名前のブックマーク（index.html#event/…）は
scoring.html へ転送するので、コートのタブレットは貼り替えなくてよい。
トップの 🖥/📱 は運営画面のリンク先を切り替えるだけで、ページは移らない。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: トップに「全体の流れ」の図を入れる

`help.html` の「0. 全体の流れ」の図を流用し、7 段階の状態に合わせて作り直す。箱の位置・線の位置・`viewBox`（`0 0 360 698`）は元の図と同じにする（元も 7 箱なので、文字を入れ替えるだけで収まる）。`home.css` の `.diagram` は Task 2 で `help.css` と同じ定義を入れてあるので、CSS は触らない。

**Files:**
- Modify: `index.html`（`<section class="home-flow">` の中）

- [ ] **Step 1: ブラウザでの確認項目を決める（このタスクは見た目だけなので自動テストは足さない）**

- 7 段の箱が上から「準備中 / 一巡目 進行中 / 一巡目終了 / 二巡目 進行中 / 二巡目終了 / 最終結果 / アーカイブ」の順に並ぶ
- 「最終結果」の箱だけが黒金（`d-box-key`）で強調される
- 375px でも文字が潰れず、横スクロールが出ない
- ライト・ダーク両テーマで線と文字が見える
- スクリーンリーダー向けの `aria-label` が図の内容を説明している

- [ ] **Step 2: 図を入れる**

`index.html` の `<section class="home-flow">` を次に差し替える。

```html
    <section class="home-flow">
      <h2>全体の流れ</h2>
      <p>大会は 7 つの<strong>状態</strong>を順に進みます。状態が変わるのは、運営者が「次へ進む」を押したときだけです。</p>

      <div class="diagram">
        <svg viewBox="0 0 360 698" role="img" aria-label="大会の状態は、準備中、一巡目 進行中、一巡目終了、二巡目 進行中、二巡目終了、最終結果、アーカイブの順に進む。準備中は運営画面で技と配点・選手を登録する段階、一巡目 進行中と二巡目 進行中はコートの端末で採点する段階、一巡目終了は二巡目を作って技を入れる段階、二巡目終了は順位を確かめる段階、最終結果は発表と共有ができて編集できなくなる段階、アーカイブは見るだけの段階。端末の役割は、運営者の PC とスマホが運営画面、コートのタブレットが採点画面、会場の大画面が発表モード、参加者のスマホが共有リンク、配信 PC が配信用ボード。">
          <defs>
            <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" class="d-arrow"/>
            </marker>
          </defs>

          <g transform="translate(10,6)">
            <rect class="d-box" width="340" height="52" rx="8"/>
            <text class="d-title" x="14" y="23">準備中</text>
            <text class="d-sub" x="14" y="42">運営画面で技と配点・選手を登録</text>
          </g>
          <line class="d-line" x1="180" y1="61" x2="180" y2="77" marker-end="url(#ah)"/>

          <g transform="translate(10,80)">
            <rect class="d-box" width="340" height="52" rx="8"/>
            <text class="d-title" x="14" y="23">一巡目 進行中</text>
            <text class="d-sub" x="14" y="42">採点画面（コートの端末）</text>
          </g>
          <line class="d-line" x1="180" y1="135" x2="180" y2="151" marker-end="url(#ah)"/>

          <g transform="translate(10,154)">
            <rect class="d-box" width="340" height="52" rx="8"/>
            <text class="d-title" x="14" y="23">一巡目終了</text>
            <text class="d-sub" x="14" y="42">運営画面で二巡目を作り技を入力</text>
          </g>
          <line class="d-line" x1="180" y1="209" x2="180" y2="225" marker-end="url(#ah)"/>

          <g transform="translate(10,228)">
            <rect class="d-box" width="340" height="52" rx="8"/>
            <text class="d-title" x="14" y="23">二巡目 進行中</text>
            <text class="d-sub" x="14" y="42">採点画面（コートの端末）</text>
          </g>
          <line class="d-line" x1="180" y1="283" x2="180" y2="299" marker-end="url(#ah)"/>

          <g transform="translate(10,302)">
            <rect class="d-box" width="340" height="52" rx="8"/>
            <text class="d-title" x="14" y="23">二巡目終了</text>
            <text class="d-sub" x="14" y="42">運営画面で順位を確認</text>
          </g>
          <line class="d-line" x1="180" y1="357" x2="180" y2="373" marker-end="url(#ah)"/>

          <g transform="translate(10,376)">
            <rect class="d-box-key" width="340" height="52" rx="8"/>
            <text class="d-title-key" x="14" y="23">最終結果</text>
            <text class="d-sub-key" x="14" y="42">発表・共有・ファイル保存</text>
          </g>
          <line class="d-line" x1="180" y1="431" x2="180" y2="447" marker-end="url(#ah)"/>

          <g transform="translate(10,450)">
            <rect class="d-box" width="340" height="52" rx="8"/>
            <text class="d-title" x="14" y="23">アーカイブ</text>
            <text class="d-sub" x="14" y="42">一覧の「アーカイブ」欄へ移る</text>
          </g>

          <line class="d-line" x1="10" y1="524" x2="350" y2="524"/>
          <text class="d-title" x="10" y="546">端末の役割</text>

          <text class="d-legend" x="10"  y="576" font-weight="bold">運営者の PC</text>
          <text class="d-sub"    x="10"  y="595">運営画面（PC）</text>
          <text class="d-legend" x="190" y="576" font-weight="bold">運営者のスマホ</text>
          <text class="d-sub"    x="190" y="595">運営画面（スマホ）</text>
          <text class="d-legend" x="10"  y="624" font-weight="bold">コートのタブレット</text>
          <text class="d-sub"    x="10"  y="643">採点画面（A・B）</text>
          <text class="d-legend" x="190" y="624" font-weight="bold">会場の大画面</text>
          <text class="d-sub"    x="190" y="643">発表モード</text>
          <text class="d-legend" x="10"  y="672" font-weight="bold">参加者のスマホ</text>
          <text class="d-sub"    x="10"  y="691">共有リンク</text>
          <text class="d-legend" x="190" y="672" font-weight="bold">配信 PC（OBS）</text>
          <text class="d-sub"    x="190" y="691">配信用ボード</text>
        </svg>
      </div>

      <p class="home-note">二巡目を行わない大会は、「一巡目終了」から直接「最終結果」へ進められます。どの状態からも 1 つ前に戻せます。</p>
    </section>
```

- [ ] **Step 3: ブラウザで確認する**

`http://localhost:3461/` を新しいタブで開き、Step 1 の 5 項目を上から順に確かめる。幅は 375px と 1280px の両方、テーマはライトとダークの両方。

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
docs: トップに大会の 7 段階を示す流れ図を足す

ヘルプの「0. 全体の流れ」の図を流用し、状態の 7 段階に合わせた。
箱と線の位置は元の図のまま（元も 7 箱）で、文字と端末の役割だけ入れ替えた。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: トップに進行中の大会一覧を出す

`GET /api/events` を読み、`Home.sortForHome`（Task 1）の順に並べて出す。行を押すと運営画面のその大会（`Storage.adminHref('#players/<id>')`）へ行く。並べ替えの規則は Task 1 でテスト済みなので、ここは描画と通信の失敗時の文言だけ。

**Files:**
- Modify: `home.js`（`updateAdminLinks` の後ろに追記、`init` の末尾に 1 行、`return {}` は変えない）
- Modify: `index.html`（確認だけ。`#homeEventList` は Task 2 で置いてある）

- [ ] **Step 1: ブラウザでの確認項目を決める（描画と通信なので自動テストは足さない。並びは Task 1 のテストで固定済み）**

- 大会が 1 件以上あるとき、採点中の大会が先頭に出る。行に大会名・日付・人数・状態バッジが出る
- 採点できる状態（一巡目 / 二巡目 進行中）のバッジだけ強調される
- アーカイブ済みの大会は出ない
- 行を押すと運営画面のその大会の選手の区画が開く。🖥/📱 を押してから行を押すと行き先が `admin.html` ⇔ `desk.html` で入れ替わる
- 大会が 0 件のときの文言が出る
- サーバーを止めた状態で開くと、取得失敗の文言が出る（真っ白にならない）

- [ ] **Step 2: `home.js` に一覧を足す**

`updateAdminLinks` の直後、`// --- 起動 ---` の前に足す。

```js
  // --- 進行中の大会 ---

  // 読み込みの世代。あとから始めた読み込みが先に返ることがあるので、
  // 古い応答では DOM に触らない（他の画面の renderSeq と同じ作法）。
  var listSeq = 0;

  async function loadEvents() {
    var seq = ++listSeq;
    var box = document.getElementById('homeEventList');
    box.textContent = '読み込み中…';
    var events = await Api.listEvents();
    if (seq !== listSeq) return;
    // Api.listEvents は通信に失敗すると null、大会が 0 件なら [] を返す。区別して出す。
    if (events === null) {
      renderNote(box, '大会の一覧を取得できませんでした。通信を確かめて、画面を読み込み直してください。');
      return;
    }
    renderEvents(box, sortForHome(events));
  }

  function renderNote(box, text) {
    box.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'home-note';
    p.textContent = text;
    box.appendChild(p);
  }

  function renderEvents(box, list) {
    if (list.length === 0) {
      renderNote(box, '進行中の大会はありません。「運営画面を開く」から作成してください。');
      return;
    }
    box.innerHTML = '';
    list.forEach(function(ev) {
      var status = EventStatus.of(ev);

      // 行はリンクにする（中クリックで別タブに開ける。行き先はモードで変わるので
      // data-event-id を持たせ、updateAdminLinks が href だけ作り直す）。
      var a = document.createElement('a');
      a.className = 'home-event';
      a.setAttribute('data-event-id', ev.id);
      a.href = Storage.adminHref('#players/' + encodeURIComponent(ev.id));

      var name = document.createElement('span');
      name.className = 'home-event-name';
      name.textContent = ev.name || '(名称未設定)';

      var meta = document.createElement('span');
      meta.className = 'home-event-meta';
      meta.textContent = (ev.date || '日付なし') + ' ・ ' + (ev.playerCount || 0) + '名';

      var badge = document.createElement('span');
      badge.className = 'home-badge' + (EventStatus.isScoringOpen(status) ? ' on' : '');
      badge.textContent = EventStatus.LABELS[status];

      a.appendChild(name);
      a.appendChild(meta);
      a.appendChild(badge);
      box.appendChild(a);
    });
  }
```

`init` の末尾（`applyMode();` の次の行）に足す。

```js
    loadEvents().catch(function(e) { console.error(e); });
```

- [ ] **Step 3: ブラウザで確認する**

まず確認用の大会を 2 つ用意する（**本物の大会は触らない**）。運営画面で「テスト用A」「テスト用B」を作り、A は選手を 1 人入れて「試合開始」まで進め、B は準備中のままにする。

`http://localhost:3461/` を新しいタブで開き、Step 1 の 6 項目を確かめる。最後の「取得失敗」はサーバーを止めてから再読み込みして見る（確認が済んだら起動し直す）。

`http://localhost:3461/test.html` も新しいタブで開き、`Result: N passed, 0 failed` のままであることを確かめる（`home.js` を変えたため）。

- [ ] **Step 4: コミット**

```bash
git add home.js
git commit -m "$(cat <<'EOF'
feat: トップに進行中の大会一覧を出す

採点中の大会を先頭に、状態バッジ付きで並べる。行を押すと運営画面の
その大会の選手の区画へ行く（行き先は 🖥/📱 のモードで変わる）。
取得に失敗したときは真っ白にせず、理由と対処を出す。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 採点画面へのリンクを `scoring.html` に向け、各ページに「トップ」を足す

改名で古くなった行き先を全部直す。`grep -n "index\.html"` で洗い出した対象は `admin.js` `desk.js` `ranking.html` `techniques.html` `test.html`（`help.html` は Task 6 でまとめて扱う）。
あわせて、採点画面の運営リンクを `Storage.adminHref` に通す（PC モードの端末で「運営」を押すと `desk.html` へ行くようにする。今は `admin.html` 固定）。

**Files:**
- Modify: `admin.js`（`scoringHref`）
- Modify: `desk.js`（`scoringHref`）
- Modify: `app.js`（`updateAdminLink` と、`linkEventAdmin` の行き先）
- Modify: `ranking.html` `techniques.html`（page-links）
- Modify: `test.html`（`<script>` に `desk.js`、`admin.js` 節の期待値、`desk.js` 節の追加）

- [ ] **Step 1: 失敗するテストを書く（`test.html`）**

`<script src="home.js"></script>` の直後に 1 行足す（`desk.js` は DOM が無ければ何もしないので、test.html で読んでも安全）。

```html
<script src="desk.js"></script>
```

`admin.js` の節の 4 本の期待値を `index.html` から `scoring.html` に直し、その下に `desk.js` の節を足す。

```js
    assert('scoringHref: 大会とコート',
      Admin.scoringHref('abc', 'A'), 'scoring.html#event/abc/A');
    assert('scoringHref: コート無し',
      Admin.scoringHref('abc', ''), 'scoring.html#event/abc');
    assert('scoringHref: 大会IDが無ければハッシュ無し',
      Admin.scoringHref('', 'A'), 'scoring.html');
    assert('scoringHref: 未分類とスペースをエンコードする',
      Admin.scoringHref('a b', '未分類'), 'scoring.html#event/a%20b/' + encodeURIComponent('未分類'));

    var h2d = document.createElement('h2');
    h2d.textContent = 'desk.js';
    results.appendChild(h2d);

    assert('scoringHref: PC 運営も同じ URL を組む',
      Desk.scoringHref('abc', 'A'), 'scoring.html#event/abc/A');
    assert('scoringHref: PC 運営もコート無しに対応する',
      Desk.scoringHref('abc', ''), 'scoring.html#event/abc');
    assert('scoringHref: PC 運営も大会IDが無ければハッシュ無し',
      Desk.scoringHref('', 'A'), 'scoring.html');
    assert('scoringHref: PC 運営も未分類とスペースをエンコードする',
      Desk.scoringHref('a b', '未分類'), 'scoring.html#event/a%20b/' + encodeURIComponent('未分類'));
```

- [ ] **Step 2: テストが落ちるのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 8 failed`。`scoringHref` の 8 本が `✗ … → got: "index.html#event/abc/A" expected: "scoring.html#event/abc/A"` のように赤くなる。

- [ ] **Step 3: `admin.js` と `desk.js` を直す**

`admin.js` の `scoringHref`（`// 採点画面のハッシュ（route.js の Route.build と同じ形。admin.html は route.js を読まない）。` のすぐ下）を次に直す。

```js
  // 採点画面のハッシュ（route.js の Route.build と同じ形。admin.html は route.js を読まない）。
  // eventId が空なら大会選択前なのでハッシュ無しの 'scoring.html' を返す
  // （採点画面側で tmg_last の控えから開かせるため）。
  function scoringHref(eventId, court) {
    if (!eventId) return 'scoring.html';
    var hash = '#event/' + encodeURIComponent(eventId);
    if (court) hash += '/' + encodeURIComponent(court);
    return 'scoring.html' + hash;
  }
```

`desk.js` の `scoringHref` も同じに直す。計画3で直す旨の ★ コメントは役目を終えたので消す。

```js
  // 採点画面のハッシュ（route.js の Route.build と同じ形。desk.html は route.js を読まない）。
  // PC 運営で採点画面の URL を知っているのはこの関数だけ。
  function scoringHref(eventId, court) {
    if (!eventId) return 'scoring.html';
    var hash = '#event/' + encodeURIComponent(eventId);
    if (court) hash += '/' + encodeURIComponent(court);
    return 'scoring.html' + hash;
  }
```

`admin-round.js` は `Admin.scoringHref` を呼んでいるだけなので**変更しない**（`admin-round.js:148,161`）。

- [ ] **Step 4: テストが通るのを確認する**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`。`desk.js` の節に ✓ が 4 本。

- [ ] **Step 5: `ranking.html` と `techniques.html` の page-links を直す**

`ranking.html`（12〜18 行目）:

```html
  <div class="page-links">
    <a href="index.html">トップ</a>
    <a href="scoring.html">採点</a>
    <a href="admin.html">運営</a>
    <a href="techniques.html">技術リスト編集</a>
    <strong>順位表示</strong>
    <a href="help.html">ヘルプ</a>
  </div>
```

`techniques.html`（38〜44 行目）:

```html
  <div class="page-links">
    <a href="index.html">トップ</a>
    <a href="scoring.html">採点</a>
    <a href="admin.html">運営</a>
    <strong>技術リスト編集</strong>
    <a href="ranking.html">順位表示</a>
    <a href="help.html">ヘルプ</a>
  </div>
```

- [ ] **Step 6: 採点画面の運営リンクを `Storage.adminHref` に通す**

`app.js` の `updateAdminLink`（`// 運営画面リンクに選択中の大会を引き継がせる。` のコメントの下）を次に直す。

```js
  function updateAdminLink(eventId) {
    var link = document.getElementById('linkAdmin');
    if (!link) return;   // このリンクを持たないページから呼ばれても落ちないように
    // 行き先（PC の desk.html / スマホの admin.html）は端末のモードで決まる。
    // 組み立ては storage.js に任せる（採点画面はページ名を知らない）。
    link.href = Storage.adminHref(eventId ? '#players/' + encodeURIComponent(eventId) : '#events');
  }
```

同じ `app.js` の中で、大会選択バーの「大会の作成は運営画面で」（`scoring.html` に `id="linkEventAdmin"` で置いてある）も同じ判定に揃える。`updateAdminLink` の末尾に足す。

```js
    var eventLink = document.getElementById('linkEventAdmin');
    if (eventLink) eventLink.href = Storage.adminHref('#events');
```

- [ ] **Step 7: ブラウザで確認する**

1. `http://localhost:3461/scoring.html` を開き、page-links の「トップ」でトップに戻れる
2. 採点画面で大会を選び、page-links の「運営」を押すと、その大会の選手の区画が開く。トップで 🖥/📱 を切り替えてから採点画面を開き直すと、行き先が `admin.html` ⇔ `desk.html` で入れ替わる
3. 大会を選んでいない状態でも「運営」と「大会の作成は運営画面で」が押せて、運営画面の大会一覧が開く
4. `http://localhost:3461/ranking.html` と `techniques.html` の page-links から「トップ」「採点」に行ける
5. スマホ運営（`admin.html`、幅 375px）の進行タブで「採点画面へ」を押すと `scoring.html#event/…/<コート>` が開く
6. PC 運営（`desk.html`、幅 1280px）の試合の区画から採点画面を開くと `scoring.html#event/…` が開く

- [ ] **Step 8: コミット**

```bash
git add admin.js desk.js app.js ranking.html techniques.html test.html
git commit -m "$(cat <<'EOF'
fix: 採点画面へのリンクを scoring.html に向ける

改名で古くなった行き先を直し、各ページのナビに「トップ」を足した。
採点画面の「運営」は端末のモード（PC / スマホ）で行き先が変わるよう
Storage.adminHref を通すようにした。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `help.html` の URL とトップページの説明

マニュアルの中の採点画面の URL を `scoring.html` に直し、ページナビに「トップ」を足す。さらに「0. 全体の流れ」の先頭に、トップページが入口であることを説明する小節を 1 つ足す。**画像は差し替えない**（画面の中身は変わっていないため）。

**Files:**
- Modify: `help.html`（15〜21 行目のナビ、39〜56 行目の「0. 全体の流れ」の先頭、354 行目の URL）

- [ ] **Step 1: ブラウザでの確認項目を決める（文章だけなので自動テストは足さない）**

- ナビから「トップ」と「採点」に行ける
- 「0. 全体の流れ」の先頭にトップページの説明があり、目次の番号（0〜5）は変わっていない
- 「コートの端末で採点画面を開く」の URL の記述が `scoring.html#event/…` になっている
- 375px でも崩れない

- [ ] **Step 2: ページナビを直す（15〜21 行目）**

```html
  <nav class="page-links" aria-label="画面の切り替え">
    <a href="index.html">トップ</a>
    <a href="scoring.html">採点</a>
    <a href="admin.html">運営</a>
    <a href="techniques.html">技術リスト編集</a>
    <a href="ranking.html">順位表示</a>
    <strong>ヘルプ</strong>
  </nav>
```

- [ ] **Step 3: 「0. 全体の流れ」の先頭にトップページの小節を足す**

`<h2>0. 全体の流れ</h2>` の直後、`<p>大会は、大会を作るところから発表までを一本の流れで進めます。</p>` の**前**に足す。

```html
    <h3>トップページ（入口）</h3>
    <p>アドレスをそのまま開く（末尾に何も付けない）と <span class="term">トップページ</span>（<code>index.html</code>）が出ます。アプリの説明と、全体の流れ、進行中の大会の一覧が並んでいます。</p>
    <p>ここから <span class="ui">運営画面を開く</span>・<span class="ui">採点画面（コート端末）</span>・<span class="ui">順位表示</span>・<span class="ui">ヘルプ</span> へ行けます。進行中の大会の行を押すと、その大会の運営画面が直接開きます。</p>
    <p>右上の <span class="ui">🖥</span> / <span class="ui">📱</span> は、<span class="ui">運営画面を開く</span> の行き先を PC 用（<code>desk.html</code>）とスマホ用（<code>admin.html</code>）で切り替えるボタンです。押した端末に控えられるので、次に開いたときも同じほうが出ます。</p>
    <div class="note">以前のアドレス（採点画面が <code>index.html</code> だった頃のブックマーク）を開くと、自動で <code>scoring.html</code> に移ります。コートのタブレットのブックマークは貼り替えなくて構いません。</div>
```

- [ ] **Step 4: 採点画面の URL の記述を直す（354 行目）**

```html
    <p>開いた採点画面の URL には大会とコートが入っています（<code>scoring.html#event/大会ID/コート</code>）。この URL のおかげで、当日はタブを閉じたり端末を再起動したりしても、同じ大会・同じコートに戻れます。</p>
```

- [ ] **Step 5: ブラウザで確認する**

`http://localhost:3461/help.html` を新しいタブで開き、Step 1 の 4 項目を確かめる。目次の「0 全体の流れ」を押すと、足した小節の見出しが見えるところに飛ぶ。

- [ ] **Step 6: コミット**

```bash
git add help.html
git commit -m "$(cat <<'EOF'
docs: ヘルプにトップページの説明を足し、採点画面の URL を直す

採点画面が scoring.html になったので、URL の記述とページナビを直した。
「0. 全体の流れ」の先頭に、トップページが入口であることと
🖥/📱 の意味、古いブックマークが転送されることを書いた。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 通し確認（手動）

Task 3・5・6 を並行で進めた場合、最後にまとめて見る。ここでは**コードを変えない**。落ちていたら該当のタスクに戻って直し、そのタスクの接頭辞（`fix:`）で別コミットにする。

**Files:** なし（確認だけ）

- [ ] **Step 1: 自動テストを通す**

サーバーを再起動してから実行する。

Run: `npm test`
Expected: `Result: N passed, 0 failed`

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`

- [ ] **Step 2: 静的配信を確かめる**

Run: `git status --short`
Expected: 自分が触ったファイル以外が入っていない。`index.html` の削除と `scoring.html` の追加がリネームとして記録されている（`git log --stat -1 -- scoring.html` で確認できる）

ブラウザで次の URL を開く。

- `http://localhost:3461/` → トップが出る
- `http://localhost:3461/index.html` → トップが出る
- `http://localhost:3461/scoring.html` → 採点画面が出る
- `http://localhost:3461/home.js` → JavaScript のソースが出る（404 にならない）
- `http://localhost:3461/home.css` → CSS が出る（404 にならない）

- [ ] **Step 3: 転送を確かめる**

1. `http://localhost:3461/index.html#event/<自分で作ったテスト用大会ID>/A` を開く → URL が `scoring.html#event/…/A` に変わり、A コートの選手が出る
2. そのまま戻るボタンを押す → トップに戻るだけで、転送が繰り返されない
3. `http://localhost:3461/index.html#events` を開く → 転送されずトップが出る
4. `http://localhost:3461/#event/` を開く → 転送されずトップが出る（壊れたブックマークで真っ白にならない）

- [ ] **Step 4: 幅ごとに確かめる**

- **375px（スマホ）**: トップに横スクロールが出ない。入口ボタンが 1 列。流れの図の文字が読める。大会の行が折り返しても崩れない
- **768px（コートのタブレット想定）**: トップから「採点画面（コート端末）」を押し、採点画面で大会とコートを選び、得点を入れて確定できる（**テスト用の大会で行う**）
- **1280px（PC）**: 入口ボタンが 2 列。本文が中央に寄り、間延びしない

- [ ] **Step 5: 入口とモードを確かめる**

1. 「運営画面を開く」→ 運営画面の大会一覧が開く
2. 「採点画面（コート端末）」→ 採点画面が開く
3. 「順位表示」→ `ranking.html` が開く
4. 「ヘルプ」→ `help.html` が開く
5. 🖥/📱 を押す → ボタンの絵が入れ替わり、ページは移らない。「運営画面を開く」と大会の行の行き先が `admin.html` ⇔ `desk.html` で入れ替わる。再読み込みしても控えが効いている
6. ライト・ダーク両テーマで、トップの文字・ボタン・バッジ・図がすべて読める

- [ ] **Step 6: ページ間の行き来を確かめる**

`トップ → 採点 → トップ`、`トップ → 順位表示 → トップ`、`トップ → 技術リスト編集 → トップ`、`トップ → ヘルプ → トップ` が、それぞれのページナビだけで一周できる。

- [ ] **Step 7: 確認用に作った大会を片付ける**

運営画面で「テスト用A」「テスト用B」を削除する。**本物の大会「第10回全日本試し斬り大会」には触らない**。

---

## 完了条件

- `npm test` と `test.html` がどちらも `0 failed`
- `grep -rn "index\.html" --include=*.js --include=*.html --exclude-dir=node_modules --exclude-dir=docs --exclude-dir=.superpowers .` の結果が次だけになる
  - `server/static-policy.js`（`normalize` の `"/" → index.html` と `PROTECTED_FILES`）
  - `server/auth.test.js`（テストのパス一覧）
  - `help.html`（トップページの説明の `<code>index.html</code>`）
  - `ranking.html` `techniques.html` `scoring.html` `help.html` のページナビの「トップ」のリンク
- `index.html#event/<id>/<コート>` が `scoring.html` に転送される
- トップが 375px と 1280px の両方、ライト・ダーク両テーマで読める
- 進行中の大会一覧が、採点中 → 準備中と巡目終了 → 最終結果 の順に出て、アーカイブは出ない
