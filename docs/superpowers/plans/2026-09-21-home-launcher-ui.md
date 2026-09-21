# トップの作り直しと、コート一覧・テストバッジ・ヘルプ（トラック B・C） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** トップ（`index.html`）を「＋ 大会を新規作成」「▶ 作成済みの大会」の二択にし、作成を 4 経路（前回の大会をコピー／テンプレート 3 種／作成済みからコピー／完全新規）から選べるようにする。あわせて、大会が持つコート一覧（`settings.courts`）を基本情報で編集できるようにし、各画面のコート候補に出し、運営画面の大会一覧にテスト大会の印を足し、ヘルプを新しい構成に直す。

**Architecture:** トップは 1 ページのまま、ハッシュで 3 つの区画（入口 / `#new` / `#list`）を出し分ける。切り替えは `home.js` の `applyRoute()` に閉じ、`#event/…` の採点画面への転送は今までどおり**最優先**（`applyRoute` の先頭で `redirectIfScoring()` を通す）。純粋関数 `Home.pickPrevious` / `Home.templateSpec` は DOM に触らず `test.html` で固定する。作成の 4 経路は `Api.copyEvent` / `Api.createFromTemplate` / `Api.saveEvent` の 3 本に落とし、戻り値を `{ id } | { error } | null` に揃えてから 1 箇所で扱う。コート一覧はトラック A が入れた `Courts.listFrom(players, extraCourts)` と `Courts.validateCourtList(list)` を呼ぶだけにして、`courts.js` は触らない。

**Tech Stack:** 素の JavaScript（IIFE、`var` と `function`。`async`/`await` は可）、Express 5、`test.html`（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は `JSON.stringify` 比較）、`npm test`（`server/auth.test.js`）。

設計書: `docs/superpowers/specs/2026-09-21-home-launcher-design.md`（特に「画面」「純粋関数」「テスト」「手動確認」の節）
前提の設計書: `docs/superpowers/specs/2026-09-18-pc-mode-and-event-status-design.md`（トップ・モード切替・コピー API）、`docs/superpowers/specs/2026-09-19-player-extra-fields-design.md`（大会の `settings`）
前の計画: `docs/superpowers/plans/2026-09-18-home-and-scoring-rename.md`（いまのトップを作った計画。`Home.redirectTarget` / `sortForHome`、`home.css` の決まりごと）

この計画は設計書「実装の分割」の **トラック B（トップの作り直し）** と **トラック C（基本情報のコート一覧・各画面のコート候補・運営画面の一覧のテストバッジ・ヘルプ）** だけを扱う。

---

## ⚠ 最初に読むこと

- **この計画に貼ったコード断片より、いまのリポジトリのファイルを正とする。** 計画を書いた時点（2026-09-21）から、トラック A や別の作業で行番号も中身もずれている。必ず対象のファイルを開いて、いまある関数・変数・コメントに合わせて直すこと。断片は「何をどう書くか」を示すためのもので、そのまま貼り付ける前提ではない
- **トラック A は commit 済み**（`2533a07` = `Courts.listFrom` の第 2 引数と `Courts.validateCourtList`、`e628957` = `POST /api/events/from-template` と `settings.courts`・`test`、`Api.createFromTemplate`）。B と C はこの上に積む。呼ぶのは次のもので、**形はもう変えない**:
  - `Api.createFromTemplate(template, data)` → `{ id, playerCount } | { error } | null`（`data` は `{ name, date, venue }`。`template` は `'practice' | 'tournament' | 'systest'`）
  - `Courts.listFrom(players, extraCourts)`（第 2 引数は省略可。省略時は従来どおり。文字列でない要素と空文字は捨てられる）
  - `Courts.validateCourtList(list)` → `''`（妥当）か日本語のエラー文言。文言は `コート一覧の形式が不正です` / `コートは20件までです` / `コート名「x」は使えません`（空・`-` を含む・`未分類`・32 文字超）/ `コート名「x」が重複しています`
  - `GET /api/events` / `GET /api/events/:id` の各大会に `test`（真偽値）、`settings.courts`（文字列の配列）
  - `PATCH /api/events/:id` の `settings` が `courts` を受ける
  - 始める前の確認: `git log --oneline -5` に `2533a07` と `e628957` がある。トップを開いて devtools のコンソールで `typeof Courts.validateCourtList === 'function' && typeof Api.createFromTemplate === 'function'` が `true`。`curl -s localhost:3461/api/events | head -c 300` の各要素に `"test"` がある
- **A のタスクはこの計画に入っていない。** `server/index.js` `api.js` `courts.js` は**触らない**
- **B と C は触るファイルが分かれているので並行できる**（末尾の「並行の仕方」を見ること）。`test.html` に追記するのは **B だけ**（`home.js` の節）

---

## 前提・共通の手順

- **サーバーの起動**: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。`.claude/launch.json` の `dev-3461` が同じ構成。すでに起動していれば使い回す
- **サーバーを変えたら再起動が要る**が、この計画で変えるのは HTML / CSS / ブラウザ用 JS だけなので**再起動は不要**。ブラウザの再読み込みで足りる
- **ブラウザのテスト**: `http://localhost:3461/test.html` を開き、ページ末尾の `Result: N passed, 0 failed` を見る。編集後の再確認は同じ URL への再 navigate ではなく `location.reload()` か**新しいタブ**で行う（bfcache で古い JS が使われる）
- **サーバーのテスト**: リポジトリのルートで `npm test`。末尾の `Result: N passed, 0 failed`
- **画面確認**: `http://localhost:3461/`（トップ）、`http://localhost:3461/desk.html`（PC 運営）、`http://localhost:3461/admin.html`（スマホ運営）、`http://localhost:3461/help.html`（マニュアル）
- 確認に使う大会は**この作業中に自分で作った大会だけ**にする。**本物の大会（「第10回全日本試し斬り大会」「名古屋城決戦」など）のデータには絶対に触らない**（状態を進めない・選手を消さない・コートを足さない）
- 作った確認用の大会は、最後に運営画面の `⋯ → 削除` で片づける

### commit の作法（必ず守る）

- **`git add` と `git reset` は使わない。** 同じ作業ツリーで別の担当者（トラック A）が作業している。ステージに他人のファイルを巻き込むと、その人の途中の変更を commit してしまう
- commit は必ず **pathspec 付き**で打つ:

```bash
git commit -m "feat: 〜" -- home.js index.html home.css
```

- 打つ前に `git status --short` を見て、**自分が直したファイルだけ**を pathspec に並べる
- `.git/index.lock` があると commit が失敗する（他の担当者が同時に commit している）。**数秒待って同じコマンドを打ち直す**。`rm .git/index.lock` はしない
- コミットメッセージは日本語。接頭辞は `feat:` `fix:` `refactor:` `test:` `docs:`。末尾に、実行中のセッションで指示されている `Co-Authored-By:` の行を付ける
- この計画で触るファイルはすべて**すでに git にある**ので、pathspec の commit だけで足りる（新しいファイルは作らない）

### コードの作法

- IIFE、`var` と `function`（`let` / `const` / アロー / クラスは使わない）。`async`/`await` は可
- **`await` の直後は、自分が最新の要求かと、画面を離れていないかを見てから DOM に触る**。`home.js` は `seq !== eventsSeq` と `paneFor(location.hash)` を見る。`desk-*.js` は `ctx.isStale()` を見る。離れていたら `alert` も出さない
- **状態の判定を直書きしない**（`event.status === 'final'` と書かず、`EventStatus.of` / `isScoringOpen` / `isLocked` / `LABELS` を使う）
- **コートの規則を直書きしない**（`Courts.listFrom` / `Courts.validateCourtList` / `Courts.UNASSIGNED` を使う）
- **`home.css` と `desk.css` は `theme.css` の変数だけを使う**。生の色（`#fff` など）を書かない。`style.css` `admin.css` `help.css` は読み込まない
- 黒金のトーン（帯は `--band-bg` に `--gold-light` の明朝、押せるものの枠は `--border`、強調は `--accent`、副次のボタンは `.desk-btn-sub` の調子）
- コメントは既存の調子に合わせる。**「なぜそう書いたか」を書く**（「何をしているか」はコードが言っている）。他のファイルと重なる決まりは、どこで固定されているかを書き添える

---

## 調査で分かっていること（実装前に読む）

- `home.js` の `init()` は **`#homeMain` が無ければ何もしない**（`test.html` も `home.js` を読むため）。この作りは残す
- `index.html` の `<head>` にある `<script>Home.redirectIfScoring();</script>` は**本文を描く前に**転送するためのもの。**消さない・動かさない**
- `Home.redirectTarget` は `Route.parse(hash)` に判定を任せている。`Route.parse('#new')` / `Route.parse('#list')` / `Route.parse('#')` はすべて `null` を返すので、**新しいハッシュが転送とぶつかることはない**
- `Storage.adminHref('#players/<id>')` がモード（PC / スマホ）に応じた運営画面の URL を返す。**トップは行き先を組み立てない**
- `updateAdminLinks()` は `[data-event-id]` を持つ要素の `href` だけを差し替える。**一覧の行には必ず `data-event-id` を付ける**（モードを切り替えたときに行き先が追従する）
- `Storage.todayLocal()` が `YYYY-MM-DD`（ローカル時刻）を返す。日付欄の初期値はこれを使う（`toISOString` は UTC なので深夜にずれる）
- コピーのダイアログの流れは `desk-events.js` の `openCopyDialog`。**失敗したらフォームを残して `alert`**、成功したら選手登録へ。トップの作成画面も同じ扱いにし、文言も合わせる（「技と配点は必ず複製されます。得点・共有リンク・履歴は引き継ぎません。」「選手も複製する（一巡目の行だけ。得点は消えます）」）
- `Api.saveEvent` は `{ success: true, id }` か `null` を返す（`error` は持たない）。`Api.copyEvent` と `Api.createFromTemplate` は `{ id, playerCount } | { error } | null`。**トップ側で `{ id } | { error } | null` に揃えてから 1 箇所で扱う**
- `desk-*.js` / `admin-*.js` の `ctx` は `{ eventId, event, players, techniques, isStale }`。**`ctx.event.settings` はいつでも読める**（`admin-round.js` の冒頭のように `ctx.event` が `null` の経路だけ気をつける）
- `Courts.courtProgress(players, round)` は `courts.js`（トラック A のファイル）にあり、中で `listFrom(players)` を呼ぶ。**`courts.js` は触らないので、選手のいないコートのカードは `desk-match.js` 側で補う**
- `desk.css` に「チップ」の見た目は無い。`.desk-badge` `.desk-btn-sub` `.desk-note` `.desk-empty` はある
- `desk.css` の末尾（現在 407 行目からの `/* ===== 大会トーン（ポスター準拠） ===== */`）は暗いテーマ向けの上書き。**新しい section はその直前に足す**（変数だけを使うので暗いテーマの上書きは要らない）
- `admin.css` は触らない。スマホ運営の大会一覧のテストの印は、行の副題（`.row-sub`）の文字列に足すだけにする
- 選手の絞り込み（`desk-players.js` の `courtPop` と冒頭の絞り込みの整理、`admin-players.js` の冒頭、`admin-round.js` の `currentCourt` の整理、`admin.js` の `renderCourtChips`）は「**いまいる選手のコート**」を出すところなので、`settings.courts` は**混ぜない**（選手が 0 人のコートの絞り込みを出しても空の表になるだけ）。設計書が第 2 引数を渡すと言っているのは「選手登録のコート候補」「貼り付けの既定コート」「スマホのフォーム」「試合進行のカード」「基本情報のコート一覧」の 5 箇所

---

## ファイル構成

### トラック B（トップ）

| ファイル | 役割 | この計画での扱い |
|---|---|---|
| `index.html` | トップの骨組み。入口 / `#list` / `#new` の 3 つの区画の器 | Task B2 で書き直す |
| `home.css` | トップの見た目 | **Task B2 で書き切る。以降のタスクでは編集しない**（足りない見た目が出たら Task B2 の節に追記してからまとめて直す） |
| `home.js` | トップの制御。純粋関数（`redirectTarget` / `sortForHome` / `pickPrevious` / `templateSpec`）と、区画の出し分け・一覧・作成画面 | Task B1 / B3 / B4 / B5 / B6 |
| `test.html` | `home.js` の節に `pickPrevious` / `templateSpec` の assert を足す | **Task B1 だけが触る** |

### トラック C（コート一覧・印・ヘルプ）

| ファイル | 役割 | この計画での扱い |
|---|---|---|
| `desk-setup.js` | 基本情報。コート一覧を読み取りから編集可に、テスト大会の印を出す | Task C1 |
| `desk.css` | チップの見た目、バッジの間隔 | **Task C1 だけが触る** |
| `desk-players.js` | PC の選手登録のコート候補・貼り付けの既定コート | Task C2 |
| `admin-players.js` | スマホの選手フォームのコート候補 | Task C2 |
| `desk-match.js` | 試合進行のコート別カード | Task C3 |
| `desk-events.js` | PC の大会一覧のテストバッジ | Task C4 |
| `admin-events.js` | スマホの大会一覧のテストの印 | Task C4 |
| `help.html` | 「トップページ」「大会を作る」「基本情報」 | Task C5 |

---

# トラック B: トップの作り直し

## Task B1: 純粋関数 `Home.pickPrevious` と `Home.templateSpec`

**Files:**
- Modify: `home.js`（`sortForHome` の下、`// --- 描画 ---` の前）
- Test: `test.html`（`h2home.textContent = 'home.js'` から始まる節の末尾、`sortForHome` の assert のあと）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `home.js` の節、`sortForHome: status の無い大会は推定する` の assert の**直後**に足す。

```javascript
    // 「前回の大会」（設計書 2026-09-21-home-launcher-design.md「純粋関数」）。
    // トップの作成画面の「前回の大会をコピー」が元にする 1 件。
    // テスト大会とアーカイブ済みは選ばない（コピー元として不適切なので）。
    var prevEvents = [
      { id: 'old',  updatedAt: '2026-09-10T00:00:00.000Z' },
      { id: 'test', updatedAt: '2026-09-20T00:00:00.000Z', test: true },
      { id: 'arc',  updatedAt: '2026-09-19T00:00:00.000Z', status: 'archived' },
      { id: 'new',  updatedAt: '2026-09-18T00:00:00.000Z' }
    ];
    assert('pickPrevious: テストとアーカイブを除いた中で updatedAt が最新',
      (Home.pickPrevious(prevEvents) || {}).id, 'new');
    assert('pickPrevious: テスト大会しか無ければ null',
      Home.pickPrevious([{ id: 't', test: true, updatedAt: '2026-09-20T00:00:00.000Z' }]), null);
    assert('pickPrevious: アーカイブしか無ければ null',
      Home.pickPrevious([{ id: 'a', status: 'archived', updatedAt: '2026-09-20T00:00:00.000Z' }]), null);
    assert('pickPrevious: 0 件は null', Home.pickPrevious([]), null);
    assert('pickPrevious: null でも落ちない', Home.pickPrevious(null), null);
    assert('pickPrevious: updatedAt が無い大会だけでも先頭を返す',
      (Home.pickPrevious([{ id: 'x' }, { id: 'y' }]) || {}).id, 'x');
    assert('pickPrevious: 元の配列を書き換えない',
      (function() {
        var src = prevEvents.slice();
        Home.pickPrevious(src);
        return src.map(function(ev) { return ev.id; });
      })(), ['old', 'test', 'arc', 'new']);

    // テンプレートの表示用の文言（作る中身はサーバーが決める。ここは画面の文言だけ）
    assert('templateSpec: 稽古用', Home.templateSpec('practice').name, '稽古用');
    assert('templateSpec: 大会用', Home.templateSpec('tournament').name, '大会用');
    assert('templateSpec: システムテスト用', Home.templateSpec('systest').name, 'システムテスト用');
    assert('templateSpec: 説明が空でない',
      Home.templateSpec('practice').description.length > 0, true);
    assert('templateSpec: 知らない名前は null', Home.templateSpec('foo'), null);
    assert('templateSpec: 空文字は null', Home.templateSpec(''), null);
    assert('templateSpec: null でも落ちない', Home.templateSpec(null), null);
    assert('templateSpec: プロトタイプの名前を拾わない',
      Home.templateSpec('constructor'), null);
```

- [ ] **Step 2: テストが落ちることを確かめる**

`http://localhost:3461/test.html` を**新しいタブで**開く。
期待: 赤い行が 15 本出て、末尾が `Result: N passed, 15 failed` になる（`Home.pickPrevious is not a function` で落ちるのではなく、`assert` の中で例外になるので、コンソールにもエラーが出る場合は行を 1 本ずつ確認する）。

- [ ] **Step 3: `home.js` に実装する**

`sortForHome` の関数の**直後**、`// --- 描画 ---` の行の**前**に足す。

```javascript
  // --- 作成画面の材料（純粋関数）---

  // 「前回の大会」= 作成画面の「前回の大会をコピー」が元にする 1 件。
  // テスト大会（test）とアーカイブ済みは選ばない（前者は本物でなく、後者は片づけた大会なので、
  // 「前回」として勝手に選ぶと事故になる）。該当が無ければ null で、画面はその項目を出さない。
  // 同着（updatedAt が同じ）は先に出てきた方を残す。元の配列は書き換えない。
  function pickPrevious(events) {
    var best = null;
    (events || []).forEach(function(ev) {
      if (!ev || ev.test === true) return;
      if (EventStatus.of(ev) === 'archived') return;
      if (!best || String(ev.updatedAt || '') > String(best.updatedAt || '')) best = ev;
    });
    return best;
  }

  // テンプレートの表示名と 1 行説明。作る中身はサーバー（POST /api/events/from-template）が
  // 決めるので、ここに持つのは画面に出す文言だけ。知らない名前なら null。
  // 'constructor' などプロトタイプの名前で拾わないよう hasOwnProperty で引く。
  var TEMPLATES = {
    practice:   { name: '稽古用',          description: '技と配点は雛形のまま。コートは「稽古」の 1 つだけ。選手はあとから登録します。' },
    tournament: { name: '大会用',          description: '技と配点は雛形のまま。コートは A・B の 2 つ。ゼッケン番号を必須にします。' },
    systest:    { name: 'システムテスト用', description: 'ダミーの選手 20 名（男女 10 名ずつ・技入り）で、採点から発表まで試せます。一覧では既定で隠れます。' }
  };

  function templateSpec(template) {
    var key = String(template == null ? '' : template);
    if (!Object.prototype.hasOwnProperty.call(TEMPLATES, key)) return null;
    return { name: TEMPLATES[key].name, description: TEMPLATES[key].description };
  }
```

ファイル末尾の `return { … }` に 2 つ足す。

```javascript
  return {
    redirectTarget: redirectTarget,
    redirectIfScoring: redirectIfScoring,
    sortForHome: sortForHome,
    pickPrevious: pickPrevious,
    templateSpec: templateSpec
  };
```

- [ ] **Step 4: テストが通ることを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
期待: 末尾が `Result: N passed, 0 failed`（N は Task B1 前の件数 + 15）。

- [ ] **Step 5: commit**

```bash
git status --short
git commit -m "feat: トップの「前回の大会」とテンプレートの文言（Home.pickPrevious / templateSpec）" -- home.js test.html
```

---

## Task B2: `index.html` の骨組みと `home.css`

**Files:**
- Modify: `index.html`（`<body>` の中を丸ごと）
- Modify: `home.css`（丸ごと書き直す）

この段階では見た目だけを作る。`#new` と `#list` の中身は Task B4〜B6 で入れるので、ここでは空の器と「読み込み中…」で構わない。**ハッシュの出し分けは Task B3**なので、このタスクの終わりでは入口だけが見え、`#list` と `#new` は `hidden` のままで良い。

- [ ] **Step 1: `index.html` の `<body>` を書き直す**

`<head>` は**触らない**（`Home.redirectIfScoring()` の呼び出しを動かさない）。`<body>` を次の形にする。

```html
<body data-theme="light">

  <header class="home-top">
    <span class="home-title">試し斬り採点システム</span>
    <button type="button" class="home-icon-btn" id="btnTheme" aria-label="テーマ切り替え">🌙</button>
    <button type="button" class="home-icon-btn" id="btnMode" aria-label="運営画面の行き先を切り替える"></button>
  </header>

  <!-- 3 つの区画を 1 ページに置き、ハッシュで出し分ける（home.js の applyRoute）。
       ハッシュ無し＝入口、#new＝大会を新規作成、#list＝作成済みの大会。
       #event/… は採点画面へ転送されるので、ここには来ない。 -->
  <main class="home-main" id="homeMain">

    <!-- 入口（ハッシュ無し） -->
    <section class="home-pane" id="paneHome">
      <nav class="home-entries" aria-label="入口">
        <a class="home-entry primary" href="#new">
          <span class="home-entry-main">＋ 大会を新規作成</span>
          <span class="home-entry-sub">テンプレート・コピー・完全新規</span>
        </a>
        <a class="home-entry" href="#list">
          <span class="home-entry-main">▶ 作成済みの大会</span>
          <span class="home-entry-sub">選んで開始・続きから</span>
        </a>
      </nav>

      <p class="home-links">コート端末の方は
        <a href="scoring.html">採点画面</a> ／
        <a href="ranking.html">順位表示</a> ／
        <a href="help.html">ヘルプ</a>
      </p>

      <!-- 説明と 7 段階の流れは既定で閉じる（初めの画面を 2 つの入口だけにするため） -->
      <details class="home-about">
        <summary>このアプリについて</summary>
        <div class="home-about-body">
          <p>試し斬りの大会を、選手の登録から採点・順位の発表まで一本で進めるためのアプリです。大会のデータはサーバーに1つだけあり、運営者の PC とスマホ、コートのタブレット、会場の大画面が同じ大会を読み書きします。</p>
          <p>運営は PC かスマホで大会を作り、コートのタブレットで採点し、結果を大画面や共有リンクで発表します。初めての方は<a href="help.html">ヘルプ</a>をご覧ください。</p>

          <section class="home-flow" id="homeFlow">
            <h2>全体の流れ</h2>
            <p>大会は 7 つの<strong>状態</strong>を順に進みます。状態が変わるのは、運営者が「次へ進む」を押したときだけです。</p>
            <div class="home-flow-band" id="homeFlowBand"></div>
            <p class="home-note">二巡目を行わない大会は、「一巡目終了」から直接「最終結果」へ進められます。どの状態からも 1 つ前に戻せます。</p>
          </section>
        </div>
      </details>
    </section>

    <!-- 作成済みの大会（#list） -->
    <section class="home-pane" id="paneList" hidden>
      <div class="home-pane-head">
        <a class="home-back" href="#">← 戻る</a>
        <h2>作成済みの大会</h2>
      </div>
      <label class="home-check">
        <input type="checkbox" id="chkShowTest"> テストも表示
      </label>
      <div class="home-event-list" id="homeEventList">読み込み中…</div>
    </section>

    <!-- 大会を新規作成（#new）。中身は home.js が作る -->
    <section class="home-pane" id="paneNew" hidden>
      <div class="home-pane-head">
        <a class="home-back" href="#">← 戻る</a>
        <h2>大会を新規作成</h2>
      </div>
      <div id="newBody"></div>
    </section>

  </main>

</body>
```

- [ ] **Step 2: `home.css` を丸ごと書き直す**

上部バー・帯・入口ボタン・大会の行は今のものをそのまま残し、新しい区画・カード・フォーム・チップの分を足す。

```css
/* トップページ（index.html）専用のスタイル。
   375px のスマホから PC まで、この 1 枚で読めるように組む。
   style.css / admin.css / desk.css / help.css は読み込まない
   （各画面のレイアウトを持ち込まない）。色は theme.css の変数だけを使う。
   このファイルは計画「トップの作り直し」の Task B2 で書き切る。以降のタスクでは編集しない
   （並行作業で衝突するため。足りない見た目が出たら計画の Task B2 の節に
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
  font-family: var(--mincho); font-size: 18px; margin: 0 0 10px;
  padding-bottom: 4px; border-bottom: 1px solid var(--border);
}
.home-note { color: var(--text-muted); font-size: 13px; }

/* 区画。hidden の属性だけで出し分ける（display は .home-pane に持たせない） */
.home-pane[hidden] { display: none; }
.home-pane-head { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.home-back { align-self: flex-start; color: var(--text-muted); text-decoration: none; font-size: 14px; }
.home-back:hover { color: var(--accent); text-decoration: underline; }

/* ===== 入口の 2 つ ===== */
.home-entries { display: grid; grid-template-columns: 1fr; gap: 12px; }
.home-entry {
  display: flex; flex-direction: column; justify-content: center;
  min-height: 88px; padding: 14px 16px;
  background: var(--card-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px; text-decoration: none;
}
.home-entry:hover { border-color: var(--accent); }
.home-entry.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.home-entry-main { font-family: var(--mincho); font-size: 19px; font-weight: bold; }
.home-entry-sub { font-size: 12px; color: var(--text-muted); }
/* accent-text は accent（濃い地）の上で読める色。band-muted は帯の上の前提の色なので、
   暗いテーマで accent（金地）に乗ると読みにくい。本文と同じ色の不透明度を落として弱める。 */
.home-entry.primary .home-entry-sub { color: var(--accent-text); opacity: 0.8; }

/* 小さなリンクの行 */
.home-links { margin-top: 14px; font-size: 13px; color: var(--text-muted); }
.home-links a { color: var(--accent); }

/* ===== このアプリについて（折りたたみ） ===== */
.home-about { margin-top: 18px; }
.home-about > summary {
  cursor: pointer; list-style: none;
  padding: 8px 0; color: var(--text-muted); font-size: 14px;
}
.home-about > summary::-webkit-details-marker { display: none; }
.home-about > summary::before { content: "▸ "; }
.home-about[open] > summary::before { content: "▾ "; }
.home-about > summary:hover { color: var(--text); }
.home-about-body p { margin: 0 0 8px; }
.home-about-body a { color: var(--accent); }
.home-flow { margin-top: 18px; }

/* ===== 大会の一覧（#list） ===== */
.home-check {
  display: inline-flex; align-items: center; gap: 6px;
  margin-bottom: 10px; font-size: 13px; color: var(--text-muted); cursor: pointer;
}
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
.home-badge.test { border-color: var(--warn); color: var(--warn); }
.home-more {
  align-self: flex-start;
  min-height: 36px; padding: 0 12px;
  background: transparent; color: var(--text-muted);
  border: 1px solid var(--border); font-size: 13px;
}
.home-more:hover { color: var(--text); border-color: var(--accent); }
.home-archived { margin-top: 12px; }
.home-archived > summary { cursor: pointer; color: var(--text-muted); font-size: 13px; padding: 6px 0; }
.home-archived > summary::-webkit-details-marker { display: none; }
.home-archived .home-event-list { margin-top: 8px; }

/* ===== 大会を新規作成（#new） ===== */
.home-cards { display: grid; grid-template-columns: 1fr; gap: 10px; }
.home-card {
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  min-height: 64px; padding: 12px 14px;
  background: var(--card-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px;
}
.home-card:hover { border-color: var(--accent); }
.home-card-main { font-size: 16px; font-weight: bold; }
.home-card-sub { font-size: 12px; color: var(--text-muted); line-height: 1.5; }

.home-form { display: grid; grid-template-columns: 1fr; gap: 10px; margin: 12px 0; }
.home-form label { font-size: 13px; color: var(--text-muted); }
.home-form input[type="text"], .home-form input[type="date"], .home-form select {
  width: 100%; min-height: 40px; padding: 0 8px;
  font-family: inherit; font-size: 15px;
  background: var(--card-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px;
}
.home-form-check { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--text); }
.home-form-actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
.home-btn {
  min-height: 44px; padding: 0 20px;
  background: var(--accent); color: var(--accent-text);
  border: 1px solid var(--accent); font-size: 15px; font-weight: bold;
}
.home-btn:disabled { opacity: .5; cursor: not-allowed; }
.home-btn-sub {
  min-height: 44px; padding: 0 8px;
  background: transparent; color: var(--text-muted);
  border: none; font-size: 14px; text-decoration: underline;
}
.home-btn-sub:hover { color: var(--text); }

/* ===== 全体の流れの帯 =====
   help.html の縦長の図は使わず、desk.js の上部の段階表示と同じ調子で
   横一列のコンパクトな帯にする。ラベルは EventStatus.LABELS をそのまま使うので
   文言の二重定義がない。375px では折り返して 2〜3 段になる。 */
.home-flow-band {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px;
  margin: 14px 0;
}
.home-flow-step {
  padding: 8px 6px;
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px;
  text-align: center;
}
/* 最終結果の段だけ黒金で強調する（help.html の d-box-key と同じ意図） */
.home-flow-step.key { background: var(--band-bg); border-color: var(--gold); border-width: 2px; }
.home-flow-num {
  display: inline-block; width: 18px; height: 18px; line-height: 18px;
  border-radius: 50%; background: var(--gold-deep); color: var(--band-text);
  font-size: 11px; font-weight: bold; margin-bottom: 4px;
}
.home-flow-step.key .home-flow-num { background: var(--gold); color: var(--band-bg); }
.home-flow-label {
  font-family: var(--mincho); font-size: 13px; font-weight: bold; color: var(--text); line-height: 1.3;
}
.home-flow-step.key .home-flow-label { color: var(--gold-light); }
.home-flow-caption { font-size: 11px; color: var(--text-muted); margin-top: 2px; line-height: 1.3; }
.home-flow-step.key .home-flow-caption { color: var(--band-muted); }

/* 2 列に置けるだけの幅があるときだけ入口とカードを並べる */
@media (min-width: 620px) {
  .home-entries { grid-template-columns: 1fr 1fr; }
  .home-cards { grid-template-columns: 1fr 1fr; }
  .home-pane-head { flex-direction: row; align-items: baseline; gap: 12px; }
  .home-pane-head h2 { flex: 1; margin: 0; }
  .home-form { grid-template-columns: 120px 1fr; align-items: center; }
  .home-form label { grid-column: 1; }
  .home-form input[type="text"], .home-form input[type="date"], .home-form select { grid-column: 2; }
  .home-form-check, .home-form-actions { grid-column: 2; }
}
```

- [ ] **Step 3: 画面を見る**

`http://localhost:3461/` を新しいタブで開く。
期待:
- 入口のカードが 2 つ（「＋ 大会を新規作成」が濃い地、「▶ 作成済みの大会」が白地）
- その下に「コート端末の方は 採点画面 ／ 順位表示 ／ ヘルプ」
- 「▸ このアプリについて」が**閉じた**状態。開くと説明 2 段落と 7 段階の帯が出る
- 🌙 と 🖥/📱 のボタンが今までどおり効く
- コンソールにエラーが出ていない（`#homeEventList` はまだ「読み込み中…」のままで良い。一覧の読み込みは Task B4）

この時点では `#new` / `#list` は `hidden` のままで、リンクを押しても何も起きない（出し分けは Task B3）。

- [ ] **Step 4: commit**

```bash
git status --short
git commit -m "feat: トップを入口 2 つに作り直す（骨組みと見た目）" -- index.html home.css
```

---

## Task B3: ハッシュで区画を出し分ける（`#new` / `#list`。転送は最優先のまま）

**Files:**
- Modify: `home.js`（`// --- 起動 ---` の前に「区画の出し分け」の節を足し、`init` を書き換える）

- [ ] **Step 1: 出し分けを書く**

`home.js` の `// --- 進行中の大会 ---` の節の**前**に足す。

```javascript
  // --- 区画の出し分け ---

  // ハッシュから出す区画を決める。知らないハッシュは入口に落とす。
  //   '' / '#' → 'home'、'#new' → 'new'、'#list' → 'list'
  // '#event/…' はここに来ない（applyRoute の先頭で採点画面へ転送する）。
  function paneFor(hash) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    if (raw === 'new') return 'new';
    if (raw === 'list') return 'list';
    return 'home';
  }

  function showPane(id, on) {
    var el = document.getElementById(id);
    if (!el) return;
    if (on) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  // ハッシュが変わるたびに呼ぶ。転送の判定が最優先（採点画面の URL を誤って
  // 共有・ブックマークされたとき、入口や一覧を一瞬でも見せない）。
  function applyRoute() {
    if (redirectIfScoring()) return;
    var pane = paneFor(location.hash);
    showPane('paneHome', pane === 'home');
    showPane('paneList', pane === 'list');
    showPane('paneNew', pane === 'new');
    if (pane === 'list') loadEvents().catch(function(e) { console.error(e); });
    if (pane === 'new') openNew();
  }
```

`openNew()` は Task B5 で書く。B3 の時点では下の仮置きを入れ、B5 で中身に差し替える。

```javascript
  // Task B5 で中身を入れる。いまは器を空にするだけ。
  function openNew() {
    document.getElementById('newBody').innerHTML = '';
  }
```

- [ ] **Step 2: `init` を書き換える**

いまの `init` の末尾（`loadEvents()` の呼び出しと `hashchange` の登録）を次のようにする。

```javascript
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
    renderFlow();
    // ハッシュで区画を出し分ける。index.html の <head> での redirectIfScoring は
    // ページ読み込み時の 1 回だけなので、開いたままハッシュを書き換えられた場合にも
    // 効くよう applyRoute からも通す。
    applyRoute();
    window.addEventListener('hashchange', applyRoute);
  }
```

**`loadEvents()` は `init` から直接呼ばない**（`#list` を開いたときだけ読む）。`hashchange` に登録していた `Home.redirectIfScoring` は `applyRoute` に置き換える（`applyRoute` の先頭で呼んでいる）。

- [ ] **Step 3: 画面で確かめる**

`http://localhost:3461/` を新しいタブで開き、次を順に見る。

| 操作 | 期待 |
|---|---|
| 「＋ 大会を新規作成」を押す | URL が `#new`、見出し「大会を新規作成」と「← 戻る」が出る（中身は空） |
| 「← 戻る」を押す | 入口の 2 つに戻る |
| 「▶ 作成済みの大会」を押す | URL が `#list`、見出し「作成済みの大会」と「テストも表示」、「読み込み中…」 |
| ブラウザの戻るボタン | 1 つ前の区画に戻る |
| `http://localhost:3461/#event/abc/A` を開く | 即座に `scoring.html#event/abc/A` へ移る（トップの入口が見えない） |
| トップを開いたまま、アドレス欄で `#event/abc` に書き換える | `scoring.html#event/abc` へ移る |
| `http://localhost:3461/#foo` を開く | 入口が出る（知らないハッシュは入口） |

- [ ] **Step 4: commit**

```bash
git status --short
git commit -m "feat: トップを #new / #list のハッシュで出し分ける" -- home.js
```

---

## Task B4: `#list`（作成済みの大会の一覧）

**Files:**
- Modify: `home.js`（`// --- 進行中の大会 ---` の節を丸ごと書き換える）

- [ ] **Step 1: 一覧の状態と読み込みを書く**

いまの `listSeq` / `loadEvents` / `renderNote` / `renderEvents` を次に置き換える。

```javascript
  // --- 作成済みの大会（#list）---

  // 読み込みの世代。あとから始めた読み込みが先に返ることがあるので、
  // 古い応答では DOM に触らない（他の画面の renderSeq と同じ作法）。
  // #list と #new のどちらも一覧を使うので、世代は 1 つで足りる。
  var eventsSeq = 0;
  var eventsCache = null;   // 直近に取れた一覧。null は「まだ取れていない・取れなかった」
  var showTest = false;     // 「テストも表示」のチェック
  var listExpanded = false; // 「すべて見る」を押したか
  var LIST_LIMIT = 5;       // 畳む前に出す件数（設計書「作成済みの大会」）

  async function loadEvents() {
    var seq = ++eventsSeq;
    var box = document.getElementById('homeEventList');
    box.textContent = '読み込み中…';
    var events = await Api.listEvents();
    if (seq !== eventsSeq) return;                      // 新しい読み込みが始まっている
    if (paneFor(location.hash) !== 'list') return;      // 待っている間に区画を離れた
    eventsCache = events;
    // Api.listEvents は通信に失敗すると null、大会が 0 件なら [] を返す。区別して出す。
    if (events === null) {
      renderNote(box, '大会の一覧を取得できませんでした。通信を確かめて、画面を読み込み直してください。');
      return;
    }
    renderList(box, events);
  }

  function renderNote(box, text) {
    box.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'home-note';
    p.textContent = text;
    box.appendChild(p);
  }

  // テスト大会は既定で隠す（本物の大会に混ぜない）。運営画面の一覧と採点画面の
  // 選択肢には出るので、テストで使う人はそちらから入れる。
  function visibleHere(ev) {
    return showTest || ev.test !== true;
  }
```

- [ ] **Step 2: 一覧の描画を書く**

```javascript
  function renderList(box, events) {
    box.innerHTML = '';
    // sortForHome はアーカイブを外して「採点中 → 準備中・巡目終了 → 最終結果」の順にする
    var active = sortForHome(events).filter(visibleHere);
    var archived = (events || []).filter(function(ev) {
      return EventStatus.of(ev) === 'archived';
    }).filter(visibleHere).sort(function(a, b) {
      var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
      if (x === y) return 0;
      return x < y ? 1 : -1;
    });

    if ((events || []).length === 0) {
      renderNote(box, '大会がまだありません。「＋ 大会を新規作成」から作ってください。');
      return;
    }
    if (active.length === 0 && archived.length === 0) {
      renderNote(box, 'テスト大会だけです。「テストも表示」にチェックを入れると出ます。');
      return;
    }

    var shown = listExpanded ? active : active.slice(0, LIST_LIMIT);
    shown.forEach(function(ev) { box.appendChild(eventRow(ev)); });

    if (active.length > shown.length) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'home-more';
      more.textContent = 'すべて見る（残り ' + (active.length - shown.length) + ' 件）';
      more.addEventListener('click', function() {
        listExpanded = true;
        renderList(box, eventsCache || []);
      });
      box.appendChild(more);
    }

    if (archived.length > 0) {
      var det = document.createElement('details');
      det.className = 'home-archived';
      var sum = document.createElement('summary');
      sum.textContent = '▸ アーカイブ（' + archived.length + ' 件）';
      det.addEventListener('toggle', function() {
        sum.textContent = (det.open ? '▾ ' : '▸ ') + 'アーカイブ（' + archived.length + ' 件）';
      });
      det.appendChild(sum);
      var inner = document.createElement('div');
      inner.className = 'home-event-list';
      archived.forEach(function(ev) { inner.appendChild(eventRow(ev)); });
      det.appendChild(inner);
      box.appendChild(det);
    }
  }

  // 行はリンクにする（中クリックで別タブに開ける。行き先はモードで変わるので
  // data-event-id を持たせ、updateAdminLinks が href だけ作り直す）。
  function eventRow(ev) {
    var status = EventStatus.of(ev);

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

    if (ev.test === true) {
      var tb = document.createElement('span');
      tb.className = 'home-badge test';
      tb.textContent = 'テスト';
      a.appendChild(tb);
    }
    return a;
  }
```

- [ ] **Step 3: 「テストも表示」を `init` で結ぶ**

`init` の `applyRoute();` の**前**に足す。

```javascript
    // 「テストも表示」。取れている一覧があれば描き直すだけで済ませる
    // （チェックのたびに通信しない）。取れていなければ読み直す。
    var chk = document.getElementById('chkShowTest');
    chk.addEventListener('change', function() {
      showTest = chk.checked;
      listExpanded = false;
      if (eventsCache) renderList(document.getElementById('homeEventList'), eventsCache);
      else loadEvents().catch(function(e) { console.error(e); });
    });
```

- [ ] **Step 4: 画面で確かめる**

準備: 運営画面（`desk.html`）で確認用の大会を 6 件作る（名前は「確認用1」〜「確認用6」で良い）。テスト大会はまだ作れないので、Task B6 のあとに「テストも表示」の確認をやり直す（このタスクでは 5 件＋「すべて見る」だけを見る）。

`http://localhost:3461/#list` を新しいタブで開く。

| 見るところ | 期待 |
|---|---|
| 並び | 採点中が先、次に準備中・巡目終了、最後に最終結果 |
| 件数 | 5 件だけ出て「すべて見る（残り 1 件）」が下に出る。押すと全部出る |
| 行 | 名前・日付と人数・状態バッジ。押すと運営画面のその大会の選手登録が開く |
| 🖥/📱 を押す | 入口に戻らず、行の行き先だけが `desk.html` ⇄ `admin.html` で入れ替わる（行を右クリックしてリンクのアドレスを見る） |
| アーカイブ | 1 件アーカイブすると「▸ アーカイブ（1 件）」に畳まれ、押すと開く |
| 0 件のとき | （一時的に大会を全部消せないので確認は任意）「大会がまだありません。」 |

- [ ] **Step 5: commit**

```bash
git status --short
git commit -m "feat: トップの #list に作成済みの大会の一覧を出す" -- home.js
```

---

## Task B5: `#new` の 1 段目（4 つのカードとテンプレート 3 種）

**Files:**
- Modify: `home.js`（Task B3 で仮置きした `openNew` を差し替え、作成画面の節を足す）

- [ ] **Step 1: 作成画面の状態と 1 段目を書く**

`// --- 区画の出し分け ---` の節と `// --- 作成済みの大会（#list）---` の節の間に、新しい節として足す。仮置きの `openNew` は消す。

この節は `#list` の節で宣言した `eventsSeq` と `eventsCache` を使い回す（一覧は 1 本しか読まないので世代も 1 つで足りる）。`var` は関数の先頭に巻き上がるので並び順は動くが、読む人が迷わないよう、**`var eventsSeq` と `var eventsCache` の 2 行だけは `// --- 大会を新規作成（#new）---` の直前に移し**、`#list` の節には「上の節で宣言」のコメントを残すこと。

```javascript
  // --- 大会を新規作成（#new）---

  // 1 段目で選ぶ「経路」。2 段目のフォームの中身がこれで変わる。
  //   'copy-prev'  前回の大会をコピー（Home.pickPrevious が選んだ 1 件）
  //   'template'   テンプレートから（newTemplate に practice / tournament / systest）
  //   'copy-pick'  作成済みの大会からコピー（2 段目のセレクトで選ぶ）
  //   'blank'      完全新規
  var newRoute = '';
  var newTemplate = '';
  var copySource = '';      // コピー元の大会ID

  var TEMPLATE_ORDER = ['practice', 'tournament', 'systest'];

  // #new に入るたびに 1 段目から始める（前に開いたときの選択を引きずらない）。
  function openNew() {
    newRoute = '';
    newTemplate = '';
    copySource = '';
    renderNew();
  }

  function renderNew() {
    var box = document.getElementById('newBody');
    box.innerHTML = '';
    if (!newRoute) { renderNewStep1(box).catch(function(e) { console.error(e); }); return; }
    if (newRoute === 'template' && !newTemplate) { renderNewTemplates(box); return; }
    renderNewForm(box);
  }

  // 押せるカード 1 枚。
  function newCard(main, sub, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'home-card';
    var m = document.createElement('span');
    m.className = 'home-card-main';
    m.textContent = main;
    var s = document.createElement('span');
    s.className = 'home-card-sub';
    s.textContent = sub;
    b.appendChild(m);
    b.appendChild(s);
    b.addEventListener('click', onClick);
    return b;
  }

  // 1 段目。「前回の大会をコピー」と「作成済みの大会からコピー」は一覧が要るので、
  // 4 枚とも取れてからまとめて描く（先に 2 枚だけ出すと並びが崩れる）。
  async function renderNewStep1(box) {
    var loading = document.createElement('p');
    loading.className = 'home-note';
    loading.textContent = '読み込み中…';
    box.appendChild(loading);

    var seq = ++eventsSeq;
    var events = await Api.listEvents();
    if (seq !== eventsSeq) return;
    if (paneFor(location.hash) !== 'new' || newRoute) return;   // 待っている間に画面が変わった
    eventsCache = events;
    box.innerHTML = '';

    if (events === null) {
      // 通信に失敗しても、コピーを使わない 2 枚は使える。作成そのものは進められる。
      var warn = document.createElement('p');
      warn.className = 'home-note';
      warn.textContent = 'コピー元にできる大会を取得できませんでした。テンプレートと完全新規は使えます。';
      box.appendChild(warn);
      events = [];
    }

    var cards = document.createElement('div');
    cards.className = 'home-cards';
    box.appendChild(cards);

    var prev = pickPrevious(events);
    if (prev) {
      cards.appendChild(newCard('前回の大会をコピー',
        '「' + (prev.name || '(名称未設定)') + '」の技・配点・コートを引き継ぎます。',
        function() { newRoute = 'copy-prev'; copySource = prev.id; renderNew(); }));
    }

    cards.appendChild(newCard('テンプレートから',
      '稽古用・大会用・システムテスト用の雛形から作ります。',
      function() { newRoute = 'template'; renderNew(); }));

    if (events.length > 0) {
      cards.appendChild(newCard('作成済みの大会からコピー',
        '元にする大会を選びます（アーカイブ済みも選べます）。',
        function() { newRoute = 'copy-pick'; copySource = ''; renderNew(); }));
    }

    cards.appendChild(newCard('完全新規',
      '名前・日付・会場だけの空の大会を作ります。技と配点は雛形から入ります。',
      function() { newRoute = 'blank'; renderNew(); }));
  }

  // 1 段目でテンプレートを選んだあとの 3 枚。文言は Home.templateSpec に持つ。
  function renderNewTemplates(box) {
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'home-btn-sub';
    back.textContent = '← 選び直す';
    back.addEventListener('click', function() { newRoute = ''; renderNew(); });
    box.appendChild(back);

    var cards = document.createElement('div');
    cards.className = 'home-cards';
    box.appendChild(cards);

    TEMPLATE_ORDER.forEach(function(key) {
      var spec = templateSpec(key);
      cards.appendChild(newCard(spec.name, spec.description, function() {
        newTemplate = key;
        renderNew();
      }));
    });
  }
```

`renderNewForm` は Task B6 で書く。B5 の間は次の仮置きを入れて、B6 で差し替える。

```javascript
  // Task B6 で中身を入れる。
  function renderNewForm(box) {
    var p = document.createElement('p');
    p.className = 'home-note';
    p.textContent = '経路: ' + newRoute + ' / テンプレート: ' + (newTemplate || '—') +
      ' / コピー元: ' + (copySource || '—');
    box.appendChild(p);
  }
```

- [ ] **Step 2: 画面で確かめる**

`http://localhost:3461/#new` を新しいタブで開く。

| 操作 | 期待 |
|---|---|
| 開いた直後 | 「読み込み中…」のあと、カードが 4 枚。先頭が「前回の大会をコピー」で、副題に直近の大会名が入っている |
| 「テンプレートから」 | 「← 選び直す」と、稽古用・大会用・システムテスト用の 3 枚 |
| 「← 選び直す」 | 4 枚に戻る |
| 稽古用を押す | 仮置きの行に `経路: template / テンプレート: practice` が出る |
| 「← 戻る」→「＋ 大会を新規作成」 | 毎回 1 段目から始まる（前の選択が残らない） |
| 大会が 0 件のとき | 「前回の大会をコピー」と「作成済みの大会からコピー」が出ず、2 枚だけ（確認は任意） |

- [ ] **Step 3: commit**

```bash
git status --short
git commit -m "feat: トップの作成画面に 4 つの経路とテンプレート 3 種を出す" -- home.js
```

---

## Task B6: `#new` の 2 段目（フォームと作成）

**Files:**
- Modify: `home.js`（Task B5 で仮置きした `renderNewForm` を差し替える）

- [ ] **Step 1: フォームの部品を書く**

`renderNewTemplates` の下に足す。

```javascript
  var newFieldSeq = 0;

  function addField(form, labelText, type) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    input.type = type;
    input.id = 'nf_' + (++newFieldSeq);
    label.htmlFor = input.id;
    label.textContent = labelText;
    form.appendChild(label);
    form.appendChild(input);
    return input;
  }

  function addSelect(form, labelText) {
    var label = document.createElement('label');
    var sel = document.createElement('select');
    sel.id = 'nf_' + (++newFieldSeq);
    label.htmlFor = sel.id;
    label.textContent = labelText;
    form.appendChild(label);
    form.appendChild(sel);
    return sel;
  }

  function findEvent(id) {
    var found = (eventsCache || []).filter(function(ev) { return ev.id === id; });
    return found.length ? found[0] : null;
  }
```

- [ ] **Step 2: 2 段目を書く**

仮置きの `renderNewForm` を丸ごと置き換える。

```javascript
  // 2 段目。4 経路で違うのは「注記」「コピー元のセレクト」「選手も複製するのチェック」
  // 「作成のときに呼ぶ API」の 4 つだけ。ほかは共通。
  function renderNewForm(box) {
    var isCopy = (newRoute === 'copy-prev' || newRoute === 'copy-pick');

    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'home-btn-sub';
    back.textContent = '← 選び直す';
    back.addEventListener('click', function() {
      // テンプレートの 3 枚から来たときは 3 枚に戻す（4 枚まで戻さない）
      if (newRoute === 'template') newTemplate = '';
      else newRoute = '';
      renderNew();
    });
    box.appendChild(back);

    var title = document.createElement('p');
    title.className = 'home-card-main';
    title.textContent = formTitle();
    box.appendChild(title);

    var note = document.createElement('p');
    note.className = 'home-note';
    note.textContent = formNote();
    box.appendChild(note);

    var form = document.createElement('div');
    form.className = 'home-form';
    box.appendChild(form);

    // コピー元のセレクト（「作成済みの大会からコピー」だけ）。
    // 並びは一覧と同じにせず、更新の新しい順にする（探しやすさを優先）。
    var selSrc = null;
    if (newRoute === 'copy-pick') {
      selSrc = addSelect(form, 'コピー元の大会');
      (eventsCache || []).slice().sort(function(a, b) {
        var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
        if (x === y) return 0;
        return x < y ? 1 : -1;
      }).forEach(function(ev) {
        var o = document.createElement('option');
        o.value = ev.id;
        o.textContent = (ev.name || '(名称未設定)') + '（' + (ev.date || '日付なし') + '・' +
          (ev.playerCount || 0) + '名）';
        selSrc.appendChild(o);
      });
      copySource = selSrc.value;
    }

    var inName = addField(form, '大会名', 'text');
    var inDate = addField(form, '日付', 'date');
    var inVenue = addField(form, '会場', 'text');
    inDate.value = Storage.todayLocal();

    // コピーは元の大会から初期値を引く（desk-events.js の openCopyDialog と同じ）。
    function fillFromSource() {
      var src = findEvent(copySource);
      if (!src) return;
      inName.value = (src.name || '(名称未設定)') + '（コピー）';
      inVenue.value = src.venue || '';
    }
    if (isCopy) fillFromSource();
    if (selSrc) {
      selSrc.addEventListener('change', function() {
        copySource = selSrc.value;
        fillFromSource();
      });
    }

    var cbPlayers = null;
    if (isCopy) {
      var check = document.createElement('label');
      check.className = 'home-form-check';
      cbPlayers = document.createElement('input');
      cbPlayers.type = 'checkbox';
      cbPlayers.checked = true;
      check.appendChild(cbPlayers);
      check.appendChild(document.createTextNode(' 選手も複製する（一巡目の行だけ。得点は消えます）'));
      form.appendChild(check);
    }

    var actions = document.createElement('div');
    actions.className = 'home-form-actions';
    var btnCreate = document.createElement('button');
    btnCreate.type = 'button';
    btnCreate.className = 'home-btn';
    btnCreate.textContent = '作成';
    actions.appendChild(btnCreate);
    form.appendChild(actions);
    inName.focus();

    // 4 経路の違いはここだけ。戻り値を { id } | { error } | null に揃える。
    async function create(name) {
      var date = inDate.value;
      var venue = inVenue.value.trim();
      if (newRoute === 'blank') {
        var saved = await Api.saveEvent({ name: name, date: date, venue: venue, players: [] });
        return (saved && saved.id) ? { id: saved.id } : null;
      }
      if (newRoute === 'template') {
        return await Api.createFromTemplate(newTemplate, { name: name, date: date, venue: venue });
      }
      if (!copySource) return { error: 'コピー元の大会を選んでください。' };
      return await Api.copyEvent(copySource, {
        name: name, date: date, venue: venue, withPlayers: cbPlayers.checked
      });
    }

    btnCreate.addEventListener('click', async function() {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      btnCreate.disabled = true;
      var result = await create(name);
      // 待っている間に画面を離れていたら何も出さない（alert も出さない）
      if (paneFor(location.hash) !== 'new') return;
      btnCreate.disabled = false;
      if (!result) {
        alert('大会を作成できませんでした。通信を確かめてください。');
        return;   // フォームは残す（入力し直しにならないように）
      }
      if (result.error) {
        alert('大会を作成できませんでした。\n' + result.error);
        return;
      }
      // 作ったら運営画面の選手登録へ（行き先は PC / スマホのモードで変わる）
      location.href = Storage.adminHref('#players/' + encodeURIComponent(result.id));
    });
  }

  function formTitle() {
    if (newRoute === 'template') {
      var spec = templateSpec(newTemplate);
      return 'テンプレート「' + (spec ? spec.name : newTemplate) + '」から作る';
    }
    if (newRoute === 'copy-prev') return '前回の大会をコピーして作る';
    if (newRoute === 'copy-pick') return '作成済みの大会からコピーして作る';
    return '完全新規で作る';
  }

  function formNote() {
    if (newRoute === 'template') {
      var spec = templateSpec(newTemplate);
      return spec ? spec.description : '';
    }
    if (newRoute === 'copy-prev' || newRoute === 'copy-pick') {
      // desk-events.js のコピーのダイアログと同じ文言にそろえる
      return '技と配点は必ず複製されます。得点・共有リンク・履歴は引き継ぎません。';
    }
    return '技と配点は雛形（技術リスト編集の「雛形」）から入ります。';
  }
```

- [ ] **Step 3: 4 経路すべてで作ってみる**

`http://localhost:3461/#new` を新しいタブで開き、4 経路を順に通す。**作った大会はあとで消す**。

| 経路 | 操作 | 期待 |
|---|---|---|
| 前回の大会をコピー | 先頭のカード → 名前が「〈直近の大会名〉（コピー）」、日付が今日、会場が元の会場。「選手も複製する」は入っている → 作成 | 運営画面の選手登録が開き、元の一巡目の選手が得点 0 で入っている。状態は「準備中」 |
| テンプレート（稽古用） | テンプレートから → 稽古用 → 名前「確認・稽古」→ 作成 | 選手 0 名で開く。基本情報のコートに「稽古」が 1 つ。選手を 1 人足すときのコート候補に「稽古」が出る |
| テンプレート（大会用） | 大会用 → 名前「確認・大会」→ 作成 | 選手 0 名。基本情報のコートに A・B。「ゼッケン番号を必須にする」にチェックが入っている |
| テンプレート（システムテスト用） | システムテスト用 → 名前「確認・テスト」→ 作成 | 選手 20 名（男子01〜10・女子01〜10）、ゼッケン 1〜20、A と B が交互、技が 3 つ入っている。トップの `#list` では既定で隠れ、「テストも表示」で「テスト」バッジ付きで出る |
| 作成済みからコピー | 作成済みの大会からコピー → セレクトを別の大会に変える | 名前と会場がその大会のものに入れ替わる |
| 作成済みからコピー | 「選手も複製する」を**外して**作成 | 選手 0 名の大会ができる |
| 完全新規 | 完全新規 → 名前だけ入れて作成 | 選手 0 名・コート無しの大会ができる |
| 失敗の扱い | 名前を空にして「作成」 | 「大会名を入力してください。」が出て、画面はそのまま |
| 失敗の扱い | devtools の Network を Offline にして「作成」 | alert が出て、**入力したフォームが残っている**（消えない）。Offline を戻せばそのまま作成できる |

- [ ] **Step 4: commit**

```bash
git status --short
git commit -m "feat: トップの作成画面のフォームと 4 経路の作成" -- home.js
```

---

## Task B7: トラック B の仕上げの確認（375px / 1280px）

**Files:** なし（確認だけ。直しが要れば該当タスクのファイルに戻って直し、同じ pathspec で commit する）

- [ ] **Step 1: テストを通す**

```bash
npm test
```
期待: `Result: N passed, 0 failed`

`http://localhost:3461/test.html` を新しいタブで開く。
期待: `Result: N passed, 0 failed`

- [ ] **Step 2: 375px（スマホ幅）で見る**

devtools のデバイスツールバーで幅 375px・高さ 667px にする。`http://localhost:3461/` を開く。

- [ ] 入口の 2 つのカードが**縦に並ぶ**
- [ ] 上部バー・カード 2 枚・小さなリンクの行・「▸ このアプリについて」が**スクロールなしで 1 画面に収まる**
- [ ] 横スクロールが出ない（`document.documentElement.scrollWidth === 375`）
- [ ] 「このアプリについて」を開くと、7 段階の帯が 2〜3 段に折り返して読める
- [ ] `#list`: 「← 戻る」「作成済みの大会」「テストも表示」が縦に並び、行の名前・日付・バッジが折り返して読める（文字が切れない）
- [ ] `#new`: カード 4 枚が縦 1 列。2 段目のフォームはラベルが上・入力が下の 1 列で、入力欄が画面幅いっぱい
- [ ] 押せるもの（🌙・🖥/📱・作成・すべて見る）が指で押せる大きさ（44px 前後）
- [ ] 暗いテーマ（🌙 を押す）でも、カードの副題・バッジ・注記が読める

- [ ] **Step 3: 1280px（PC 幅）で見る**

devtools のデバイスツールバーを切り、ウィンドウを 1280px 幅にする。

- [ ] 入口の 2 つのカードが**横に並ぶ**。本文が中央寄せで、左右に大きな空きができない（`max-width: 760px`）
- [ ] `#new` のカード 4 枚が 2 列 × 2 段（テンプレートの 3 枚は 2 列 + 1）
- [ ] `#new` の 2 段目のフォームがラベル 120px + 入力の 2 列になる
- [ ] `#list` の行が 1 行に収まり、名前が長くても崩れない
- [ ] 暗いテーマでも同じ

- [ ] **Step 4: 転送が生きていることを最後にもう一度確かめる**

- [ ] `http://localhost:3461/#event/<実在する大会ID>/A` → 採点画面がその大会・A コートで開く
- [ ] `http://localhost:3461/#event/<実在する大会ID>` → 採点画面がコート未指定で開く
- [ ] トップを `#list` で開いたまま、アドレス欄を `#event/<大会ID>` に書き換える → 採点画面へ移る
- [ ] ブラウザの戻るで、転送のループに落ちない（`location.replace` を使っているので履歴に残らない）

- [ ] **Step 5: 確認用に作った大会を片づける**

運営画面の大会一覧で、この作業中に作った大会（「確認用1」〜「確認用6」「確認・稽古」「確認・大会」「確認・テスト」など）を `⋯ → 削除` で消す。**本物の大会は消さない。**

- [ ] **Step 6: 直しが出たら commit**

```bash
git status --short
git commit -m "fix: トップの〜" -- home.js home.css index.html
```

---

# トラック C: コート一覧・テストの印・ヘルプ

## Task C1: 基本情報のコート一覧を編集できるようにする

**Files:**
- Modify: `desk-setup.js`（`render` の中。保存の処理とコート一覧の節）
- Modify: `desk.css`（`/* ===== 大会トーン（ポスター準拠） ===== */` の**直前**に 1 section 足す）

設計の決め: 選手の `order` から導かれるコートは**灰色のチップで「（選手あり）」と示し、「×」を出さない**（設計書の「選手から導出したコートは灰色のチップで…外せない」に合わせる。押してから alert で断るより、押せないほうが分かりやすい）。大会だけが持つコート（`settings.courts` のうち選手がいないもの）にだけ「×」を出す。

- [ ] **Step 1: `desk.css` にチップの見た目を足す**

`/* ===== 大会トーン（ポスター準拠） ===== */` の**直前**に足す。色は `theme.css` の変数だけを使うので、暗いテーマ用の上書きは要らない。

```css
/* ===== 基本情報のコート一覧のチップ（desk-setup.js） ===== */
.desk-court-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.desk-chip {
  display: inline-flex; align-items: center; gap: 2px;
  min-height: 32px; padding: 0 4px 0 12px;
  background: var(--card-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 16px; font-size: 13px;
}
/* 選手から導かれたコート。外せないので、押せる見た目にしない */
.desk-chip.fixed { background: var(--bg-secondary); color: var(--text-muted); padding-right: 12px; }
.desk-chip-x {
  width: 26px; height: 26px; line-height: 1;
  background: transparent; color: var(--text-muted);
  border: none; border-radius: 50%; font-size: 15px; cursor: pointer;
}
.desk-chip-x:hover { background: var(--bg-secondary); color: var(--text); }
.desk-empty-inline { color: var(--text-muted); font-size: 13px; }
/* 状態バッジの隣にテストのバッジが並ぶ（desk-events.js） */
.desk-badge + .desk-badge { margin-left: 4px; }
```

- [ ] **Step 2: `desk-setup.js` のファイル冒頭のコメントを直す**

いまの「コートは選手の order から決まるので、ここでは読み取りだけ（変えるのは「選手」の区画）」は嘘になる。次のように直す。

```javascript
// 基本情報の区画（#setup/<id>）。大会名・日付・会場・必須の設定と、コート一覧の編集。
// コートは 2 通りある。選手の order から導かれるコート（外せない）と、大会が
// settings.courts に持つコート（選手が 0 人でも候補に出したいもの。ここで足す・外す）。
// 検証は Courts.validateCourtList で、サーバーの PATCH と同じ規則・同じ文言になる。
// 保存は PATCH /api/events/:id（Api.updateEventInfo）で名前・日付・会場と
// settings（ゼッケン・級位段位を必須にするか、コート一覧）だけを送る。
// 大会ファイルを丸ごと送り直す Api.saveEvent は使わない。GET の応答（techniques を
// effectiveTechniques で埋めたもの）をそのまま送り返すと、techniques を持たない大会
// （この機能より前に作られた雛形運用の大会）が自前の技リストを持つ大会に変わってしまう。
```

- [ ] **Step 3: 保存を 1 つの関数にまとめ、`courts` を送る**

`var settings = ctx.event.settings || {};` の行の**直後**に、画面で編集中のコート一覧を置く。

```javascript
    // 画面で編集中のコート一覧（保存するのはこの配列）。
    // 選手から導かれるコートはここに入れない（外せないものを保存し直さない）。
    var extra = (settings.courts || []).slice();
```

いまの `btnSave.addEventListener('click', async function() { … })` の中身を、引数でボタンを受ける関数に切り出す（コート一覧の節にも保存ボタンを置くため）。

```javascript
    // 基本情報とコート一覧の保存は同じ PATCH（どちらのボタンからも全部を送る）。
    // コートを足したのに上の「保存」を押し忘れる、という取りこぼしを無くすため、
    // コートの節にも同じ保存を置く。押したボタンだけを無効にして二重送信を防ぐ。
    async function saveInfo(btn) {
      var name = inName.value.trim();
      if (!name) { alert('大会名を入力してください。'); return; }
      var courtErr = Courts.validateCourtList(extra);
      if (courtErr) { alert(courtErr); return; }
      btn.disabled = true;
      var result = await Api.updateEventInfo(ctx.eventId, {
        name: name, date: inDate.value, venue: inVenue.value.trim(),
        // settings はサーバーが requireBib / requireRank / courts だけを拾う
        // （他のキーは無視される）。毎回すべて送るので、外したときも保存される。
        settings: {
          requireBib: chkBib.checked,
          requireRank: chkRank.checked,
          courts: extra.slice()
        }
      });
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
      btn.disabled = false;
      if (!result || !result.ok) {
        if (result && result.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else {
          alert((result && result.error) || '保存できませんでした。通信を確認してください。');
        }
        return;
      }
      Desk.toast('基本情報を保存しました');
      await Desk.reloadEvent();   // 上部の見出しと、この区画のチップを描き直す
    }

    btnSave.addEventListener('click', function() { saveInfo(btnSave); });
```

- [ ] **Step 4: テスト大会の印を出す**

`container.appendChild(head);`（見出し「基本情報」）の**直後**、`if (locked) { … }` の前に足す。

```javascript
    // テスト大会の印。変える UI は出さない（test を立てるのはテンプレート API だけ）。
    if (ctx.event && ctx.event.test === true) {
      var testNote = document.createElement('p');
      testNote.className = 'desk-note';
      testNote.textContent = 'テスト大会です（トップの「作成済みの大会」では既定で隠れます）。';
      container.appendChild(testNote);
    }
```

- [ ] **Step 5: コート一覧の節を書き換える**

`// --- コート一覧（読み取り） ---` から `render` の終わりまでを、次に置き換える。

```javascript
    // --- コート一覧（大会の settings.courts を編集する）---

    var courtHead = document.createElement('div');
    courtHead.className = 'desk-section-head';
    var h2c = document.createElement('h2');
    h2c.textContent = 'コート';
    courtHead.appendChild(h2c);
    container.appendChild(courtHead);

    var courtNote = document.createElement('p');
    courtNote.className = 'desk-note';
    courtNote.textContent =
      'ここで足したコートは、選手が 1 人もいなくても選手登録のコート候補と試合進行のカードに出ます。' +
      '灰色のコートは選手のコート指定から決まったもので、外せません（外すときは「選手」の区画でコートを変えます）。';
    container.appendChild(courtNote);

    var chipWrap = document.createElement('div');
    chipWrap.className = 'desk-court-chips';
    container.appendChild(chipWrap);

    var courtActions = document.createElement('div');
    courtActions.className = 'desk-form-actions';
    var btnCourtSave = document.createElement('button');
    btnCourtSave.type = 'button';
    btnCourtSave.className = 'desk-btn primary';
    btnCourtSave.textContent = '保存';
    btnCourtSave.disabled = locked;
    btnCourtSave.addEventListener('click', function() { saveInfo(btnCourtSave); });
    courtActions.appendChild(btnCourtSave);
    container.appendChild(courtActions);

    var tableWrap = document.createElement('div');
    container.appendChild(tableWrap);

    // 選手の order から導かれたコート（外せない）
    function playerCourts() {
      return Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    }

    // 画面に出すコート＝選手のコート ∪ 大会のコート（未分類は表だけに出す）
    function allCourts() {
      return Courts.listFrom(ctx.players, extra);
    }

    function renderChips() {
      chipWrap.innerHTML = '';
      var fixed = playerCourts();
      var names = allCourts().filter(function(c) { return c !== Courts.UNASSIGNED; });

      if (names.length === 0) {
        var empty = document.createElement('span');
        empty.className = 'desk-empty-inline';
        empty.textContent = 'コートがまだありません。';
        chipWrap.appendChild(empty);
      }

      names.forEach(function(c) {
        var hasPlayers = fixed.indexOf(c) !== -1;
        var chip = document.createElement('span');
        chip.className = 'desk-chip' + (hasPlayers ? ' fixed' : '');
        var label = document.createElement('span');
        label.textContent = hasPlayers ? (c + '（選手あり）') : c;
        chip.appendChild(label);
        if (!hasPlayers && !locked) {
          var x = document.createElement('button');
          x.type = 'button';
          x.className = 'desk-chip-x';
          x.textContent = '×';
          x.setAttribute('aria-label', c + ' を外す');
          x.addEventListener('click', function() {
            var i = extra.indexOf(c);
            if (i !== -1) extra.splice(i, 1);
            renderChips();
            renderCourtTable();
          });
          chip.appendChild(x);
        }
        chipWrap.appendChild(chip);
      });

      if (locked) return;
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'desk-btn-sub';
      add.textContent = '＋ コートを足す';
      add.addEventListener('click', onAddCourt);
      chipWrap.appendChild(add);
    }

    // 名前の規則はサーバーの PATCH と同じ（Courts.validateCourtList）。
    // 既にあるコートと合わせて検証するので、重複も 20 件超もここで弾ける。
    function onAddCourt() {
      var name = prompt('コート名を入力してください（例: A）', '');
      if (name === null) return;   // キャンセル
      name = String(name).trim();
      var err = Courts.validateCourtList(
        allCourts().filter(function(c) { return c !== Courts.UNASSIGNED; }).concat([name]));
      if (err) { alert(err); return; }
      extra.push(name);
      renderChips();
      renderCourtTable();
    }

    // コート別の人数。大会だけが持つコートは 0 / 0 / 0 で出す
    // （足したコートが確かに入っていることが見える）。
    function renderCourtTable() {
      tableWrap.innerHTML = '';
      var courts = allCourts();
      if (courts.length === 0) return;

      var table = document.createElement('table');
      table.className = 'desk-table';
      table.innerHTML = '<thead><tr><th>コート</th><th>一巡目</th><th>二巡目</th><th>合計</th></tr></thead>';
      var tbody = document.createElement('tbody');
      courts.forEach(function(c) {
        var rows = Courts.filter(ctx.players, c);
        var r1 = rows.filter(function(p) { return Courts.roundOf(p) === 1; }).length;
        var r2 = rows.filter(function(p) { return Courts.roundOf(p) === 2; }).length;
        var tr = document.createElement('tr');
        tr.appendChild(cell(c === Courts.UNASSIGNED ? Courts.UNASSIGNED : c + ' コート'));
        tr.appendChild(cell(String(r1), 'num'));
        tr.appendChild(cell(String(r2), 'num'));
        tr.appendChild(cell(String(rows.length), 'num'));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    }

    renderChips();
    renderCourtTable();
```

- [ ] **Step 6: 画面で確かめる**

`http://localhost:3461/desk.html` を新しいタブで開き、確認用の大会を 1 つ作って「基本情報」を開く。

- [ ] 「＋ コートを足す」で `A` を足すと、白いチップ「A ×」が出て、下の表に `A コート 0 0 0` の行が増える
- [ ] 「保存」を押すと「基本情報を保存しました」。画面を離れて戻っても `A` が残っている
- [ ] 同じ `A` をもう一度足すと `コート名「A」が重複しています` の alert
- [ ] 空文字・`A-1` のように `-` を含む名前・`未分類`・33 文字の名前は `コート名「…」は使えません`、21 件目は `コートは20件までです`（文言は `Courts.validateCourtList` が返すものをそのまま出す。画面で書き足さない）
- [ ] 「選手」の区画で A コートに選手を 1 人登録してから基本情報に戻ると、`A` が**灰色の「A（選手あり）」**になり `×` が消える
- [ ] 上の「保存」（基本情報のほう）でもコートが保存される
- [ ] 最終結果を確定した大会（`isLocked`）では「＋ コートを足す」も `×` も出ず、コートの「保存」が押せない
- [ ] テンプレート「システムテスト用」で作った大会の基本情報に「テスト大会です（…）」が出る。普通の大会には出ない
- [ ] 暗いテーマでチップが読める

- [ ] **Step 7: commit**

```bash
git status --short
git commit -m "feat: 基本情報でコート一覧を足す・外すできるようにする" -- desk-setup.js desk.css
```

---

## Task C2: 選手登録のコート候補に `settings.courts` を含める

**Files:**
- Modify: `desk-players.js`（先頭に小さな補助を足し、`fillCourtOptions` / `draftSeed` / 貼り付けの既定コートの 3 箇所）
- Modify: `admin-players.js`（先頭に同じ補助、`buildCommonFields` の 1 箇所）

**絞り込みの `Courts.listFrom` は変えない**（`desk-players.js` の `render` 冒頭と `courtPop`、`admin-players.js` の `render` 冒頭）。あそこは「いまいる選手のコート」を出す場所で、選手が 0 人のコートを足しても空の表になるだけ。

- [ ] **Step 1: `desk-players.js` に補助を足す**

IIFE の先頭（`var stateOwner` などの変数の近く）に足す。

```javascript
  // 大会が持つコート一覧（基本情報で編集する settings.courts）。
  // 選手が 1 人もいないコートも候補に出したいので、Courts.listFrom の第 2 引数に渡す
  // （設計書 2026-09-21-home-launcher-design.md「コート一覧」）。
  // 絞り込み（courtPop・render 冒頭の整理）では使わない。あそこは「いまいる選手の
  // コート」を出す場所なので、選手 0 人のコートを混ぜても空の表になるだけ。
  function extraCourts(ctx) {
    return (ctx && ctx.event && ctx.event.settings && ctx.event.settings.courts) || [];
  }
```

- [ ] **Step 2: `desk-players.js` の 3 箇所を直す**

`fillCourtOptions`（コートのセレクトの選択肢）:

```javascript
    var list = Courts.listFrom(ctx.players, extraCourts(ctx))
      .filter(function(c) { return c !== Courts.UNASSIGNED; });
```

`draftSeed`（「＋ 行を追加」の初期コート）:

```javascript
    var courts = Courts.listFrom(ctx.players, extraCourts(ctx))
      .filter(function(c) { return c !== Courts.UNASSIGNED; });
```

貼り付けの「コートが空の行に使うコート」:

```javascript
    var courtList = Courts.listFrom(ctx.players, extraCourts(ctx))
      .filter(function(c) { return c !== Courts.UNASSIGNED; });
```

- [ ] **Step 3: `admin-players.js` に同じ補助を足して 1 箇所を直す**

IIFE の先頭に同じ `extraCourts(ctx)` を足す（`courts.js` はトラック A のファイルなので、共通化のために手を入れない。3 行の重複は許す）。

```javascript
    // 既存のコート一覧（未分類はサーバーが受け付けないので候補に出さない）。
    // 大会が持つコート（基本情報の settings.courts）も候補に含める。
    var courts = Courts.listFrom(ctx.players, extraCourts(ctx)).filter(function(c) {
      return c !== Courts.UNASSIGNED;
    });
```

- [ ] **Step 4: 画面で確かめる**

確認用の大会の基本情報でコート `C` を足して保存してから、

- [ ] PC（`desk.html` → 選手）: 「＋ 行を追加」の行のコートのセレクトに `C` が出る
- [ ] PC: 表が空の大会で「＋ 行を追加」を押すと、初期コートが基本情報の先頭のコートになる（`A` を足していれば `A`）
- [ ] PC: 「貼り付け」の「コートが空の行に使うコート」のセレクトに `C` が出る
- [ ] スマホ（`admin.html` → 選手 → ＋）: コートのセグメントに `C` が出る
- [ ] 選手の絞り込み（PC の「コート ▼」、スマホの絞り込み）には `C` が**出ない**（選手が 0 人なので）
- [ ] コートを足していない大会では、今までどおりの候補（挙動が変わらない）

- [ ] **Step 5: commit**

```bash
git status --short
git commit -m "feat: 選手登録のコート候補に大会のコート一覧を含める" -- desk-players.js admin-players.js
```

---

## Task C3: 試合進行のカードに選手のいないコートも出す

**Files:**
- Modify: `desk-match.js`（コート別カードを作るところ。`Courts.courtProgress(ctx.players, round)` を呼んでいる箇所）

`courts.js` はトラック A のファイルなので触らない。`courtProgress` の結果に、大会だけが持つコートの 0 / 0 の行を `desk-match.js` 側で補う。

- [ ] **Step 1: 補助を足す**

IIFE の先頭に足す。

```javascript
  // 大会が持つコート一覧（基本情報の settings.courts）。desk-players.js と同じ理由で
  // ここにも置く（courts.js はこの計画では触らない）。
  function extraCourts(ctx) {
    return (ctx && ctx.event && ctx.event.settings && ctx.event.settings.courts) || [];
  }

  // コート別のカードの材料。Courts.courtProgress は選手から導かれたコートしか返さないので、
  // 大会が持つコート（選手がまだ 1 人もいないコート）を 0 / 0 の行として補う。
  // 並びは Courts.listFrom に合わせる（昇順・未分類は末尾）。
  // コート名が 'constructor' でも壊れないよう Object.create(null) + hasOwnProperty で引く。
  function courtCards(ctx, round) {
    var byCourt = Object.create(null);
    Courts.courtProgress(ctx.players, round).forEach(function(r) { byCourt[r.court] = r; });
    return Courts.listFrom(ctx.players, extraCourts(ctx)).map(function(c) {
      return Object.prototype.hasOwnProperty.call(byCourt, c)
        ? byCourt[c]
        : { court: c, total: 0, scored: 0 };
    });
  }
```

- [ ] **Step 2: 呼び出しを差し替える**

```javascript
    var rows = courtCards(ctx, round);
```

- [ ] **Step 3: 画面で確かめる**

- [ ] 確認用の大会の基本情報でコート `C` を足して保存 → 「試合進行」に `C コート 0 / 0` のカードが出る
- [ ] 既存の A・B のカードの数字が変わっていない
- [ ] 未分類の選手がいる大会で、未分類のカードが**末尾**のまま
- [ ] コートを足していない大会では、今までどおりのカード（枚数も並びも変わらない）

- [ ] **Step 4: commit**

```bash
git status --short
git commit -m "feat: 試合進行に選手のいないコートのカードも出す" -- desk-match.js
```

---

## Task C4: 運営画面の大会一覧にテスト大会の印を出す

**Files:**
- Modify: `desk-events.js`（`buildRow` の状態のセル）
- Modify: `admin-events.js`（`buildRow` の副題）

トップの `#list` と違い、運営画面と採点画面では**隠さない**（テストで使うため）。印だけ出す。

- [ ] **Step 1: `desk-events.js` にバッジを足す**

`buildRow` の状態のセルを作っているところ、`tdStatus.appendChild(badge);` の**直後**に足す。

```javascript
    // テスト大会（テンプレート「システムテスト用」で作った大会）。
    // トップの一覧では既定で隠れるが、運営画面では隠さない（テストで使うため）。
    if (ev.test === true) {
      var testBadge = document.createElement('span');
      testBadge.className = 'desk-badge';
      testBadge.textContent = 'テスト';
      tdStatus.appendChild(testBadge);
    }
```

（バッジ同士の間隔は Task C1 で `desk.css` に入れた `.desk-badge + .desk-badge` が効く。**`desk.css` はこのタスクでは触らない**。）

- [ ] **Step 2: `admin-events.js` の副題に足す**

スマホ運営の行は副題が 1 本の文字列なので、末尾に足すだけにする（`admin.css` は触らない）。

```javascript
    sub.textContent = (ev.date || '日付なし') + ' ・ ' + (ev.playerCount || 0) + '名 ・ ' +
      EventStatus.LABELS[EventStatus.of(ev)] +
      (ev.test === true ? ' ・ テスト' : '');
```

- [ ] **Step 3: 画面で確かめる**

- [ ] `desk.html` の大会一覧で、テンプレート「システムテスト用」で作った大会の状態の列に「準備中」と「テスト」の 2 つのバッジが並ぶ。普通の大会は 1 つだけ
- [ ] `admin.html` の大会一覧で、その大会の副題の末尾が「・ テスト」になる。普通の大会は付かない
- [ ] 採点画面（`scoring.html`）の大会の選択肢にテスト大会が出る（隠れていない）
- [ ] 暗いテーマでバッジが読める

- [ ] **Step 4: commit**

```bash
git status --short
git commit -m "feat: 運営画面の大会一覧にテスト大会の印を出す" -- desk-events.js admin-events.js
```

---

## Task C5: ヘルプを新しい構成に直す

**Files:**
- Modify: `help.html`（`§0` の「トップページ（入口）」、`§1` の「大会を作る」と「去年の大会をコピーして作る」、`§1` に「基本情報（コート・必須の設定）」を新設）

- [ ] **Step 1: 「トップページ（入口）」を書き直す**

`§0. 全体の流れ` の `<h3>トップページ（入口）</h3>` の下の `<p>` を次に差し替える（`<div class="note">` の古いブックマークの話は**残す**）。

```html
    <h3>トップページ（入口）</h3>
    <p>アドレスをそのまま開く（末尾に何も付けない）と <span class="term">トップページ</span>（<code>index.html</code>）が出ます。入口は 2 つだけです。</p>
    <ul>
      <li><span class="ui">＋ 大会を新規作成</span> … テンプレート・コピー・完全新規から選んで大会を作ります（§1「大会を作る」）。</li>
      <li><span class="ui">▶ 作成済みの大会</span> … いまある大会の一覧です。行を押すと、その大会の運営画面が直接開きます。</li>
    </ul>
    <p>一覧は <span class="term">採点中 → 準備中・巡目終了 → 最終結果</span> の順に並び、5 件まで出ます。残りは <span class="ui">すべて見る</span> で開きます。アーカイブ済みの大会は下の <span class="ui">▸ アーカイブ（n 件）</span> に畳まれます。<span class="ui">システムテスト用</span> のテンプレートで作った大会は既定で隠れていて、<span class="ui">テストも表示</span> にチェックを入れると <span class="ui">テスト</span> の印付きで出ます。</p>
    <p>入口の下の小さなリンクから <span class="ui">採点画面</span>・<span class="ui">順位表示</span>・<span class="ui">ヘルプ</span> へ行けます。コート端末の方はここから採点画面へ入ってください。アプリの説明と 7 段階の流れは <span class="ui">▸ このアプリについて</span> に畳まれています。</p>
    <p>右上の <span class="ui">🖥</span> / <span class="ui">📱</span> は、運営画面の行き先を PC 用（<code>desk.html</code>）とスマホ用（<code>admin.html</code>）で切り替えるボタンです。押した端末に控えられるので、次に開いたときも同じほうが出ます。</p>
```

- [ ] **Step 2: 「大会を作る」にテンプレートとコピーを足す**

`§1. 大会の作成` の `<h3>大会を作る</h3>` の直後に、次を**先頭に**入れる（PC 用・スマホ用の手順はその下に残す）。

```html
    <p><span class="term">いちばん簡単なのはトップページからです。</span>トップの <span class="ui">＋ 大会を新規作成</span> を押すと、4 つの作り方から選べます。</p>
    <ul>
      <li><span class="ui">前回の大会をコピー</span> … 直近に触った大会（テスト大会とアーカイブ済みを除く）をそのままコピーします。毎回の大会はこれがいちばん速いです。</li>
      <li><span class="ui">テンプレートから</span> … 下の 3 種類から選びます。</li>
      <li><span class="ui">作成済みの大会からコピー</span> … 元にする大会を選んでコピーします（アーカイブ済みも選べます）。</li>
      <li><span class="ui">完全新規</span> … 名前・日付・会場だけの空の大会です。技と配点は雛形から入ります。</li>
    </ul>
    <p>どれを選んでも、次の画面で <span class="ui">大会名</span>・<span class="ui">日付</span>（今日が入っています）・<span class="ui">会場</span> を入れて <span class="ui">作成</span> を押します。作ったあとは、その大会の <span class="ui">選手登録</span> が開きます。</p>

    <p><span class="term">テンプレート 3 種</span></p>
    <ul>
      <li><span class="ui">稽古用</span> … 技と配点は雛形のまま。コートは <span class="term">稽古</span> の 1 つ。選手は 0 名。道場の稽古でその場の何人かを採点するとき。</li>
      <li><span class="ui">大会用</span> … 技と配点は雛形のまま。コートは <span class="term">A・B</span>。<span class="ui">ゼッケン番号を必須にする</span> が入った状態。選手は 0 名。本番の大会を一から作るとき。</li>
      <li><span class="ui">システムテスト用</span> … <span class="ui">大会用</span> に加えて、ダミーの選手 20 名（男子01〜10・女子01〜10、ゼッケン 1〜20、A と B に交互、技も入っている）。初めての人が練習する・新しい端末で通しの確認をするとき。</li>
    </ul>
    <div class="note"><span class="ui">システムテスト用</span> で作った大会には <span class="ui">テスト</span> の印が付き、トップの <span class="ui">作成済みの大会</span> では既定で隠れます（<span class="ui">テストも表示</span> で出ます）。運営画面の大会一覧と採点画面の選択肢には、いつでも出ます。練習が終わったら消してください。</div>
```

`help.html` には `<h4>` も `<table>` も無く、見出しは `<h2>` / `<h3>`、囲みは `<div class="note">`、強調は `<span class="term">` / `<span class="ui">` / `<code>` だけを使っている。**この作法から外れない**（`help.css` は触らない）。

- [ ] **Step 3: 「去年の大会をコピーして作る」に一言足す**

その節の先頭に足す。

```html
    <p>トップページの <span class="ui">＋ 大会を新規作成</span> → <span class="ui">作成済みの大会からコピー</span> でも同じことができます。運営画面からやる場合は次のとおりです。</p>
```

- [ ] **Step 4: 「基本情報（コート・必須の設定）」を新設する**

`§1` の `<h3>終わった大会を片づける（アーカイブ）</h3>` の**前**に足す。

```html
    <h3>基本情報（コート・必須の設定）</h3>
    <p>PC 用の運営画面で大会を開き、左の <span class="ui">基本情報</span> を選ぶと、大会名・日付・会場のほかに <span class="term">コート一覧</span> を編集できます。</p>
    <ul>
      <li><span class="ui">＋ コートを足す</span> でコート名（<span class="term">A</span> など）を入れます。<span class="term">選手が 1 人もいなくても</span>、そのコートが選手登録のコート候補と <span class="ui">試合進行</span> のカードに出ます。</li>
      <li>足したコートは <span class="ui">×</span> で外せます。<span class="term">灰色のコート</span>（「A（選手あり）」）は選手のコート指定から決まったもので、外せません。外すときは <span class="ui">選手</span> の区画でその選手のコートを変えます。</li>
      <li>コート名の決まり: 空・<span class="term">-</span>・<span class="term">未分類</span> は使えません。32 文字まで、同じ名前は 1 つだけ、20 コートまでです。</li>
      <li>足した・外したあとは <span class="ui">保存</span> を押してください（上の <span class="ui">保存</span> でも同じように保存されます）。</li>
    </ul>
    <p>同じ画面の <span class="ui">ゼッケン番号を必須にする</span> / <span class="ui">級位・段位を必須にする</span> は、一巡目にその項目が空の選手がいる間だけ <span class="ui">試合開始 ▶</span> で止めるための設定です（§2 の「当日の流れ」）。登録そのものは空のままできます。</p>
```

- [ ] **Step 5: ヘルプを開いて確かめる**

`http://localhost:3461/help.html` を新しいタブで開く。

- [ ] `§0` の「トップページ（入口）」が新しい構成（入口 2 つ・5 件と「すべて見る」・テストも表示・小さなリンク・このアプリについて）になっている
- [ ] `§1` の「大会を作る」にトップからの 4 経路とテンプレート 3 種が出ている
- [ ] `§1` に「基本情報（コート・必須の設定）」の節がある
- [ ] 目次のリンク（`#flow` `#setup`）が効く。見出しの階層が崩れていない（`<h2>` の下は `<h3>` だけ。`<h4>` を足していない）
- [ ] 文字化け・書きかけの文が残っていない（追記した節を頭から読み直す）
- [ ] 375px 幅でも横スクロールが出ない

- [ ] **Step 6: commit**

```bash
git status --short
git commit -m "docs: ヘルプのトップページ・大会を作る・基本情報を新しい構成に直す" -- help.html
```

---

## Task C6: トラック C の仕上げの確認

**Files:** なし（確認だけ）

- [ ] **Step 1: テストを通す**

```bash
npm test
```
期待: `Result: N passed, 0 failed`

`http://localhost:3461/test.html` を新しいタブで開く。
期待: `Result: N passed, 0 failed`（トラック C は `test.html` を触らないので、件数は B の追加分を除いて変わらない）

- [ ] **Step 2: 一通り通す（PC 1280px）**

確認用の大会を 1 つ使って、

- [ ] 基本情報でコート `A` `B` `C` を足して保存 → 選手の区画のコート候補に 3 つとも出る
- [ ] `A` に選手を 3 人、`B` に 2 人登録 → 基本情報で `A` `B` が灰色、`C` が白いまま
- [ ] `C` を `×` で外して保存 → 選手のコート候補から `C` が消え、試合進行の `C` のカードも消える
- [ ] 貼り付けでコート列が空の行を入れ、「コートが空の行に使うコート」で `B` を選ぶ → その行が `B` になる
- [ ] 試合進行のカードが `A` `B` の 2 枚（数字が正しい）

- [ ] **Step 3: 一通り通す（スマホ 375px）**

devtools のデバイスツールバーで 375px にし、`admin.html` を開く。

- [ ] 選手の追加フォームのコートのセグメントに、基本情報で足したコートが出る
- [ ] 大会一覧のテスト大会の副題の末尾が「・ テスト」
- [ ] 横スクロールが出ない

- [ ] **Step 4: 確認用に作った大会を片づける**

運営画面の大会一覧で、この作業中に作った大会を `⋯ → 削除` で消す。**本物の大会は消さない。**

- [ ] **Step 5: 直しが出たら commit**

```bash
git status --short
git commit -m "fix: 〜" -- <直したファイルだけ>
```

---

# 並行の仕方

- **トラック A の完了が全体の前提。** A が入るまで B も C も始めない
- **B と C は同時に進められる**（触るファイルがまったく重ならない）
  - B: `index.html` `home.css` `home.js` `test.html`
  - C: `desk-setup.js` `desk.css` `desk-players.js` `admin-players.js` `desk-match.js` `desk-events.js` `admin-events.js` `help.html`
- **B の中は順番どおり**（B1 → B2 → B3 → B4 → B5 → B6 → B7）。B3 以降はどれも `home.js` を触るので、同時に走らせない
- **C の中は C1 を先にして、そのあと C2 / C3 / C4 / C5 を同時に進められる**（C1 が `desk.css` にチップとバッジの間隔を入れるため。それ以降は 1 タスク 1〜2 ファイルで重ならない）。最後に C6

| 組み合わせ | 同時に走らせてよいか |
|---|---|
| B の任意のタスク × C の任意のタスク | ○ |
| C2 × C3 × C4 × C5 | ○（C1 のあと） |
| C1 × C4 | ✕（`desk.css` の `.desk-badge + .desk-badge` を C1 が入れる） |
| B3 × B4 × B5 × B6 | ✕（どれも `home.js`） |

同時に走らせるときも、commit は必ず `git commit -m … -- <自分が直したファイル>` の pathspec で行い、`git status --short` で他人のファイルが混ざっていないことを見てから打つこと。
