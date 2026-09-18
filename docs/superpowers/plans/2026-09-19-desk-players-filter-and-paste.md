# 貼り付けの不足列・セルの中央揃え・PC 選手表の見出しフィルタ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書「UX 見直しへの修正要望（第 1 回）」のうち、**1. セルの中央揃え**・**2. 貼り付けの不足列**・**4. 見出しのフィルタ（PC 選手表）** の 3 件（トラック C と B）を実装する。

**Architecture:** 判定は DOM を持たない純粋関数（`courts.js`）に置き、`test.html` で固定する。貼り付けは `Courts.parsePasteRows(text, techniques, defaults)` に第 3 引数を足して「コートが空の行を既定コートで補う」だけにし、画面（`desk-players.js` の `openPasteDialog`）はその既定コートを選ぶセレクトを持つ。選手表の絞り込みは、状態（`Courts.defaultFilter()` の形）はそのままに、見せ方だけをチップの帯から見出しの ▼ のポップオーバーへ移す。複数選択が要るのはコートだけなので、`filter.court` を配列でも文字列でも受けられるように `Courts.applyFilter` を広げる（後方互換。スマホの選手登録タブは文字列のまま動く）。

**Tech Stack:** 素の JavaScript（IIFE、`var` と `function`。`async`/`await` は可）、CSS は `theme.css` の変数だけ、`test.html`（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は `JSON.stringify` 比較）。

設計書: `docs/superpowers/specs/2026-09-19-ux-feedback-round1-design.md`（「1. セルの中央揃え」「2. 貼り付けの不足列」「4. 見出しのフィルタ（PC 選手表）」「テスト」1〜3）
参考: `docs/superpowers/specs/2026-09-18-pc-mode-and-event-status-design.md`（「画面設計 > PC 運営 > 選手」）、`docs/superpowers/specs/2026-09-18-players-table-design.md`（スマホの選手表。絞り込みの状態の形と IME の知見）
前の計画: `docs/superpowers/plans/2026-09-19-desk-players-table.md`（`desk-players.js` の構造。実装済み）

**この計画で扱わないもの**: 設計書の「3. メニュー名」（トラック A）と「5. 採点画面のボタン配置」（トラック D）。**別の担当者が同じ作業ツリーで並行して実装中**なので、`desk.js` `admin.html` `admin-*.js` `scoring.html` には**一切触らない**。`help.html` はこの計画では **Task 3 の 1 段落の追記だけ**（メニュー名の書き換えには触らない）。

---

## ⚠ 最初に読むこと

- **この計画に貼ったコード断片は「いつの時点かのスナップショット」です。いまのファイルの内容を正とします。**
  置き換え前のコードを貼った箇所は、**編集の直前に必ずそのファイルを読み直して**ください。別の担当者が同じ行を書き換えていることがあります（現に `desk-players.js` の `<h2>` は書き換わっています）。一致しなければ、**この計画の断片ではなく、いまのファイルに合わせて**当てること。趣旨（何を足すか・何を消すか）はこの計画のとおりに保つ。
- **他人のファイルを巻き込まない。** `git add` は各タスクで明示したファイルだけ。`git checkout` `git stash` `git clean` `git reset --hard` は**絶対に使わない**（他の担当者の未コミットの作業を消します）。

---

## 前提・共通の手順

### 並行作業の状況（作業開始時点）

同じ作業ツリー（ブランチ `feature/ux-feedback-round1`）で、**トラック A（メニュー名）とトラック D（採点画面のボタン配置）の担当者が同時に作業しています**。作業開始時点で未コミットの変更があるファイル:

| ファイル | 誰の作業か | この計画での扱い |
|---|---|---|
| `desk.js` `admin.html` `admin-round.js` `admin-results.js` `desk-match.js` `desk-results.js` | A | **触らない** |
| `admin-players.js` | A | **触らない**（状態の形の参考に読むだけ） |
| `scoring.html` | D | **触らない** |
| `desk-players.js` | A（`<h2>` の文言など数行） | この計画の本体。**コミット時に注意**（下記） |
| `style.css` | D（`.player-nav` `.action-bar` など） | Task 4 で `.player-list-table` だけ触る。**コミット時に注意**（下記） |
| `help.html` | A（メニュー名。大きく書き換え中） | Task 3 で 1 段落だけ足す。**コミット時に注意**（下記） |

### コミットの手順（毎回これを守る）

1. `git status --porcelain` と `git diff <そのファイル>` を読む
2. そのファイルの差分が**自分の変更だけ**なら `git add <ファイル>` して commit
3. **他人のハンクが混ざっていたら、そのファイルはコミットしない。** 指揮官に「◯◯ に他人の未コミット変更があるので保留した」と報告し、指示を仰ぐ（相手がコミットしたら `git diff` を読み直して自分のぶんだけになっているか確かめ、コミットする）
4. `.git/index.lock` があれば数秒待って再試行する

コミットメッセージは**日本語**。接頭辞は `feat:` `fix:` `refactor:` `style:` `test:` `docs:`。末尾に必ず次の 1 行を付ける:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

### サーバーとテスト

- **サーバーの起動**: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。`.claude/launch.json` の `dev-3461` が同じ構成。既に起動していれば再利用する
- この計画は `server/` を**変えない**ので、サーバーの再起動は不要（JS / CSS / HTML の変更だけ）
- **自動テスト**: `http://localhost:3461/test.html` をブラウザで開き、ページ末尾の `Result: N passed, 0 failed` を見る。**再確認は同じ URL への再 navigate ではなく `location.reload()` か新しいタブで行う**（bfcache で古い JS が使われて、直したはずのテストが落ちたままに見える）
- **作業を始める前に、いまの `N` を控えること。** 設計書では 853。以降の「Expected」はこの控えた数を基準に書く
- **画面確認**: `http://localhost:3461/desk.html`（PC 運営。ウィンドウ幅 **1280px**）、`http://localhost:3461/admin.html`（スマホ運営。幅 **375px**）、`http://localhost:3461/scoring.html`（採点画面。幅 **1024px**。Task 4 の中央揃えの確認だけ。**DOM も CSS の他の節も変えない**）
- 確認に使う大会は**自分がこの作業中に作った大会だけ**。**本物の大会「第10回全日本試し斬り大会」のデータには絶対に触らない**（状態を進めない・選手を消さない）
- ライト／ダークの切り替えは各画面の 🌙 ボタン（PC 運営は左下、採点画面は下部のツールバー）

### コードの作法

- IIFE、`var` と `function`（`const` `let` `=>` は使わない）。`async`/`await` は可
- `await` の直後は必ず `ctx.isStale()` を見て、古ければ DOM に触らない・`alert` も出さない。ダイアログの中で `await` をまたぐときは `Desk.currentEventId() !== eventId` も見る
- 状態の判定を直書きしない（`event.status === 'final'` と書かず `EventStatus.of` / `EventStatus.isLocked` を使う）
- **`desk.css` は `theme.css` の変数だけを使う**。赤い文字は `--btn-fail`（#b3261e 固定）ではなく `--cell-fail-text`（ダークでも読める）
- **ポップオーバーは画面に同時に 1 つだけ**。外側クリックと Esc で閉じる
- **見出しの ▼ のクリックは `stopPropagation` で並べ替えと分ける**

---

## 設計書との差分（この計画での決定）

実装の都合で設計書の文言どおりにできない点が 3 つある。**この計画のとおりに作ること。**

1. **「新人」の ▼ は「新人だけ」のチェック 1 つにする。**
   設計書は「新人のみ／新人以外」の 2 つと書いているが、いまの状態 `filter.newFace` は真偽値（すべて／新人だけ）で、「新人以外」は表せない。設計書は「新人は既存の 3 値のまま」とも書いているので、**状態は変えず**チェック 1 つにする。技 1〜3 の「技が未入力の行だけ」も同じくチェック 1 つ（設計書どおり）。
2. **ポップオーバーのボタンは「すべて選択」の 1 つだけにする。**
   設計書は「すべて選択」「解除」の 2 つだが、この状態モデルには「どれも表示しない」が無い（空＝すべて）ので、2 つとも「絞り込みなし」に戻る同じ動きになる。紛らわしいので 1 つにする。名前の検索と、チェック 1 つだけの列（新人・技）にはボタンを置かない。
3. **ポップオーバーは `document.body` に `position: fixed` で置く。**
   設計書は `position: absolute` だが、表の枠 `.desk-players-wrap` は `overflow-x: auto` のため縦にも切られる（`desk.css` の `.desk-menu` のコメントにある既知の落とし穴）。見出しの中に絶対配置すると、行数が少ない大会でポップオーバーが切れる。`document.body` に `fixed` で置き、▼ の実座標（`getBoundingClientRect`）から位置を決め、スクロール・リサイズ・ハッシュ変更で閉じる。

---

## ファイル構成

- **Modify**: `courts.js` — `parsePasteRows(text, techniques, defaults)` の第 3 引数と `parsePasteRow` の `courtFilled`（Task 1）、`applyFilter` のコート配列対応（Task 5）
- **Modify**: `test.html` — `parsePasteRows` の節に 9 件（Task 1）、`applyFilter` の節に 6 件（Task 5）
- **Modify**: `desk-players.js` — `openPasteDialog` に既定コートのセレクトとプレビューの色分け（Task 2）、チップの帯の撤去と見出しの ▼ のフィルタ（Task 6）
- **Modify**: `desk.css` — 貼り付けダイアログの補ったコートの色（Task 2）、選手表の中央揃え（Task 4）、チップの CSS の削除と ▼・ポップオーバーの CSS（Task 6）
- **Modify**: `admin.css` — スマホ選手登録タブの表の中央揃え（Task 4。**この 2 行だけ**）
- **Modify**: `style.css` — 採点画面下部の選手一覧の中央揃え（Task 4。**`.player-list-table` の節だけ**）
- **Modify**: `help.html` — 「（d）PC の表に打ち込む・Excel から貼り付ける」に 1 段落（Task 3。**ここだけ**）

**触らない**: `desk.js` `desk.html` `admin.html` `admin.js` `admin-players.js` `admin-round.js` `admin-results.js` `desk-match.js` `desk-results.js` `desk-events.js` `scoring.html` `app.js` `index.html` `home.*` `server/` `api.js` `storage.js` `theme.css`。新しいファイルは作らない（静的配信の許可リストの変更は不要）。

---

## タスクの順序

**全部を 1 人が順番に行う**（`desk-players.js` `courts.js` `test.html` `desk.css` が重なるので並行できない）。

```
トラック C:  Task 1 → Task 2 → Task 3
トラック B:  Task 4 → Task 5 → Task 6
仕上げ:      Task 7（通しの手動確認）
```

- Task 1（`courts.js` + `test.html`）→ Task 2（`desk-players.js` + `desk.css`）の順は必須（Task 2 は Task 1 の `defaults` を使う）
- Task 3（`help.html`）は他人が大きく書き換え中。ハンクが混ざっていたら**飛ばして Task 7 の後に戻る**（タスクの中に書いてある）
- Task 4（CSS 3 ファイル）は他のどのタスクとも中身が重ならない。ただし `desk.css` は Task 2・Task 6 も触るので、この順に行うこと
- Task 5（`courts.js` + `test.html`）→ Task 6（`desk-players.js` + `desk.css`）の順は必須（Task 6 は配列のコートを使う）

---

### Task 1: 貼り付けの不足列を既定コートで補う（`Courts.parsePasteRows` の第 3 引数）

列が足りない行（名前だけ、名前とコートだけ、…）をエラーにせず、無い列は 性別＝男子・新人＝なし・技＝空 として読む（**これはいまの実装でも既にそうなっている**。`cols[n] || ''` で埋めている）。足りないのは**コート**だけなので、第 3 引数 `defaults = { court }` を受け、**コートの列が空のときだけ** `defaults.court` で補う。補った値にも既存の検証（`-` を含まない・`未分類` でない・32 文字以内）を掛ける。画面が「貼った値」と「補った値」を色で分けられるように `courtFilled` を返す。**引数を省いたときは従来と同じ動き**（既存テストを壊さない）。

**Files:**
- Modify: `courts.js`（`parsePasteRows` と `parsePasteRow`。ファイル末尾近くの「貼り付けによる一括登録の解析」の節）
- Modify: `test.html`（`// ---- 貼り付けによる一括登録の解析` の節。`parsePasteRows: 空文字は 0 行` の assert の直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の次の 2 行

```js
    assert('parsePasteRows: 空文字は 0 行',
      Courts.parsePasteRows('   \n  ', pTech).rows.length, 0);
```

の**直後**（`// ---- splitDelimited` のコメントの直前）に足す。

```js

    // ---- 貼り付けの不足列と既定コート（第 3 引数 defaults = { court }） ----
    // 列が足りない行はエラーにせず、無い列は 性別＝男子・新人＝なし・技＝空 で読む。
    // コートの列が空の行だけ defaults.court で補い、補った値にも同じ検証を掛ける。
    // defaults を省いたときは従来どおり（上の既存テストがそれを固定している）。
    function pRowsD(text, defaults) { return Courts.parsePasteRows(text, pTech, defaults).rows; }
    function pBriefD(text, defaults) {
      return pRowsD(text, defaults).map(function(r) {
        return [r.line, r.name, r.court, r.isFemale, r.isNewFace, r.techs.join('/'), r.ok, r.error].join('|');
      });
    }

    assert('parsePasteRows: defaults.court が名前だけの行を補う（男子・新人なし・技空）',
      pBriefD('山田 太郎', { court: 'A' }), ['1|山田 太郎|A|false|false|//|true|']);
    assert('parsePasteRows: defaults.court は空のコート列だけを補い、貼った値は上書きしない',
      pBriefD('山田,B\n佐藤', { court: 'A' }),
      ['1|山田|B|false|false|//|true|', '2|佐藤|A|false|false|//|true|']);
    assert('parsePasteRows: courtFilled で補った行が分かる',
      pRowsD('山田,B\n佐藤', { court: 'A' }).map(function(r) { return r.courtFilled; }), [false, true]);
    assert('parsePasteRows: defaults が無ければ従来どおりコートがありません',
      pRows('山田').map(function(r) { return [r.ok, r.error]; }), [[false, 'コートがありません']]);
    assert('parsePasteRows: defaults.court が空文字なら従来どおりコートがありません',
      pRowsD('山田', { court: '' }).map(function(r) { return [r.ok, r.error]; }), [[false, 'コートがありません']]);
    assert('parsePasteRows: 補ったコート名にも検証が掛かる（- は使えない）',
      pRowsD('山田', { court: 'A-1' }).map(function(r) { return [r.ok, r.error]; }),
      [[false, 'コート名「A-1」は使えません']]);
    assert('parsePasteRows: 補ったコートが未分類なら断る',
      pRowsD('山田', { court: '未分類' }).map(function(r) { return r.ok; }), [false]);
    assert('parsePasteRows: 名前が空の行は defaults があっても「名前がありません」のまま',
      pRowsD(',A', { court: 'B' }).map(function(r) { return [r.ok, r.error]; }), [[false, '名前がありません']]);
    assert('parsePasteRows: 全部の列を貼った行の courtFilled は false',
      pRowsD('山田,A,女子,新人,四方,水月,', { court: 'B' }).map(function(r) { return [r.court, r.courtFilled]; }),
      [['A', false]]);
```

- [ ] **Step 2: テストが落ちるのを確かめる**

サーバーを起動したまま `http://localhost:3461/test.html` を**新しいタブ**で開く。
Expected: `parsePasteRows: defaults.court …` の assert が赤く落ちる（第 3 引数を知らない実装はコートを補わないので `コートがありません`、`courtFilled` は `undefined`）。`Result: N passed, M failed`（M は 6 前後）。

- [ ] **Step 3: `courts.js` に第 3 引数を足す**

`courts.js` の `parsePasteRows` の説明コメントと関数の頭を直す。置き換え前（戻り値の説明の末尾から関数の先頭まで）:

```js
  //   name, court, isFemale, isNewFace,
  //   techs,     ['技1', '技2', '技3']（空の枠は ''）
  //   badTechs,  技リストに無い技名（画面で赤く示す）
  //   ok,        サーバーに送ってよい行か
  //   error      送れない理由（ok が true なら ''）
  // } ] }
  function parsePasteRows(text, techniques) {
```

置き換え後:

```js
  //   name, court, isFemale, isNewFace,
  //   techs,     ['技1', '技2', '技3']（空の枠は ''）
  //   badTechs,  技リストに無い技名（画面で赤く示す）
  //   courtFilled, コートの列が空で defaults.court から補った行か（画面が色を分ける）
  //   ok,        サーバーに送ってよい行か
  //   error      送れない理由（ok が true なら ''）
  // } ] }
  // defaults = { court } は「列が足りない行に使う既定値」。いまはコートだけ。
  // 貼り付けダイアログの「コートが空の行に使うコート」を渡す。省略すると従来どおり
  // （コートの列が空の行は「コートがありません」で断る）。
  function parsePasteRows(text, techniques, defaults) {
```

次に、`parsePasteRow` を呼んでいる 1 行を直す。置き換え前:

```js
      var row = parsePasteRow(cols, i + 1, known);
```

置き換え後:

```js
      var row = parsePasteRow(cols, i + 1, known, defaults || {});
```

- [ ] **Step 4: `parsePasteRow` でコートを補う**

置き換え前（`parsePasteRow` の先頭から `row` の組み立てまで）:

```js
  function parsePasteRow(cols, line, known) {
    var techs = [cols[4] || '', cols[5] || '', cols[6] || ''];
    var badTechs = techs.filter(function(t) { return t && !known[t]; });
    var row = {
      line: line,
      name: cols[0] || '',
      court: cols[1] || '',
      isFemale: FEMALE_WORDS.indexOf(String(cols[2] || '').toLowerCase()) !== -1,
      isNewFace: NEWFACE_WORDS.indexOf(String(cols[3] || '').toLowerCase()) !== -1,
      techs: techs,
      badTechs: badTechs,
      ok: true,
      error: ''
    };
```

置き換え後:

```js
  // 列が足りない行（名前だけ、名前とコートだけ、…）はエラーにしない。
  // 無い列は 性別＝男子・新人＝なし・技＝空 として読み、コートだけ defaults.court で補う。
  // 補った値にも下の検証（'-' を含まない・未分類でない・32文字以内）を掛ける
  // （既定コートが不正なら、その行は貼った行と同じ理由で断る）。
  function parsePasteRow(cols, line, known, defaults) {
    var techs = [cols[4] || '', cols[5] || '', cols[6] || ''];
    var badTechs = techs.filter(function(t) { return t && !known[t]; });
    var pasted = cols[1] || '';
    var fallback = (defaults && typeof defaults.court === 'string') ? defaults.court.trim() : '';
    var row = {
      line: line,
      name: cols[0] || '',
      court: pasted || fallback,
      courtFilled: !pasted && !!fallback,
      isFemale: FEMALE_WORDS.indexOf(String(cols[2] || '').toLowerCase()) !== -1,
      isNewFace: NEWFACE_WORDS.indexOf(String(cols[3] || '').toLowerCase()) !== -1,
      techs: techs,
      badTechs: badTechs,
      ok: true,
      error: ''
    };
```

以降（`if (!row.name) …` から）は**そのまま**。`row.court` が補った値になっているので、コート名の検証は自動で補った値にも掛かる。

- [ ] **Step 5: テストが通るのを確かめる**

`http://localhost:3461/test.html` を**新しいタブ**で開く。
Expected: `Result: (控えた N + 9) passed, 0 failed`。

- [ ] **Step 6: コミット**

`git diff courts.js test.html` を読み、自分の変更だけであることを確かめてから:

```bash
git add courts.js test.html
git commit -m "$(cat <<'EOF'
feat: 貼り付けの不足列を既定コートで補えるようにする

Courts.parsePasteRows に第 3 引数 defaults = { court } を足し、コートの列が
空の行だけを補う。補った値にも既存のコート名の検証を掛け、画面が貼った値と
区別できるよう courtFilled を返す。引数を省いたときは従来どおり。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 貼り付けダイアログに「コートが空の行に使うコート」を足す

`desk-players.js` の `openPasteDialog` に、テキストエリアの上のコートのセレクトを足す。選択肢は既存コート（`Courts.listFrom(ctx.players)` から `未分類` を除く）＋「新しいコート…」（手入力）。初期値は既存コートの先頭、無ければ空（そのときはコート列が空の行が赤くなる）。プレビューは `Courts.parsePasteRows(text, techniques, { court: <選んだコート> })` で描き、セレクトを変えたら描き直す。補ったコートはプレビューで薄い色にする。

**Files:**
- Modify: `desk-players.js`（`pasteLine` と `openPasteDialog`。「📋 貼り付けて追加」の節）
- Modify: `desk.css`（「貼り付けて追加のダイアログ」の節に 1 行足す）

- [ ] **Step 1: `desk.css` に補ったコートの色を足す**

「貼り付けて追加のダイアログ」の節の

```css
/* 取り込めない行。--btn-fail はダークで読みにくいので文字色は --cell-fail-text を使う */
.desk-paste-line.bad, .desk-paste-bad { color: var(--cell-fail-text); }
.desk-paste-bad { font-weight: bold; }
```

の**直後**に足す。

```css
/* 上のセレクトから補ったコート（貼った値と区別する） */
.desk-paste-filled { color: var(--text-muted); font-style: italic; }
/* 「コートが空の行に使うコート」の行 */
.desk-paste-court { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 13px; }
.desk-paste-court select {
  min-height: 30px; padding: 2px 6px; border-radius: 3px;
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
}
```

- [ ] **Step 2: `pasteLine` でコートを別の `span` にする**

コートだけ色を分けられるように、1 行分の組み立てを分ける。置き換え前:

```js
  function pasteLine(row) {
    var div = document.createElement('div');
    div.className = 'desk-paste-line' + (row.ok ? '' : ' bad');
    var head = document.createElement('span');
    head.textContent = row.line + ': ' + row.name + '　' + row.court + '　' +
      (row.isFemale ? '女子' : '男子') + (row.isNewFace ? '　新人' : '') + '　';
    div.appendChild(head);
```

置き換え後:

```js
  function pasteLine(row) {
    var div = document.createElement('div');
    div.className = 'desk-paste-line' + (row.ok ? '' : ' bad');
    var head = document.createElement('span');
    head.textContent = row.line + ': ' + row.name + '　';
    div.appendChild(head);
    // 補ったコートだけ薄く出す（貼った値と区別する）。取り込めない行は行ごと赤いので、
    // その行では赤より薄い色が勝つが、断る理由は行末に出るので紛れない。
    var court = document.createElement('span');
    court.textContent = row.court || '—';
    if (row.courtFilled) court.className = 'desk-paste-filled';
    div.appendChild(court);
    var mid = document.createElement('span');
    mid.textContent = '　' + (row.isFemale ? '女子' : '男子') + (row.isNewFace ? '　新人' : '') + '　';
    div.appendChild(mid);
```

以降（`row.techs.forEach(…)` から）は**そのまま**。

- [ ] **Step 3: ダイアログに既定コートのセレクトを足す**

`openPasteDialog` の説明文からテキストエリアまでを直す。置き換え前:

```js
  function openPasteDialog(ctx) {
    var body = document.createElement('div');

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'Excel の範囲をそのまま貼り付けられます。列は 名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 の順' +
      '（タブ区切りかカンマ区切り）。1 行目が「名前」で始まるときは見出しとして読み飛ばします。' +
      '性別は「女子」「女」「F」が女子、それ以外は男子。新人は「新人」「○」「1」「true」。' +
      '技はこの大会の技リストにある名前だけです。';
    body.appendChild(note);

    var ta = document.createElement('textarea');
    ta.className = 'desk-paste';
    ta.setAttribute('aria-label', '貼り付ける選手の一覧');
    ta.placeholder = '山田 太郎\tA\t男子\t新人\t…\n佐藤 花子\tA\t女子\t\t…';
    body.appendChild(ta);
```

置き換え後:

```js
  function openPasteDialog(ctx) {
    var body = document.createElement('div');

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'Excel の範囲をそのまま貼り付けられます。列は 名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 の順' +
      '（タブ区切りかカンマ区切り）。1 行目が「名前」で始まるときは見出しとして読み飛ばします。' +
      '性別は「女子」「女」「F」が女子、それ以外は男子。新人は「新人」「○」「1」「true」。' +
      '技はこの大会の技リストにある名前だけです。' +
      '名前だけの行でも登録できます（足りない列は 男子・新人なし・技は空。コートは下のセレクトの値）。';
    body.appendChild(note);

    // 「コートが空の行に使うコート」。既存コート（未分類は除く）＋「新しいコート…」。
    // 初期値は既存コートの先頭。大会にコートがまだ無ければ空（コート列が空の行は赤くなる）。
    var courtRow = document.createElement('p');
    courtRow.className = 'desk-paste-court';
    var courtLabel = document.createElement('label');
    courtLabel.textContent = 'コートが空の行に使うコート';
    var selDefault = document.createElement('select');
    selDefault.setAttribute('aria-label', 'コートが空の行に使うコート');
    var courtList = Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    addOption(selDefault, '', '（指定しない）');
    courtList.forEach(function(c) { addOption(selDefault, c, c); });
    addOption(selDefault, NEW_COURT, '新しいコート…');
    selDefault.value = courtList[0] || '';
    var lastDefault = selDefault.value;
    courtLabel.appendChild(selDefault);
    courtRow.appendChild(courtLabel);
    body.appendChild(courtRow);

    var ta = document.createElement('textarea');
    ta.className = 'desk-paste';
    ta.setAttribute('aria-label', '貼り付ける選手の一覧');
    ta.placeholder = '山田 太郎\n佐藤 花子\tA\t女子\t\t…';
    body.appendChild(ta);
```

- [ ] **Step 4: プレビューに既定コートを渡し、セレクトの変更で描き直す**

置き換え前:

```js
    function update() {
      var parsed = Courts.parsePasteRows(ta.value, ctx.techniques || []);
```

置き換え後:

```js
    // 「新しいコート…」が選ばれたままの値をそのまま既定コートにしない
    function defaultCourt() {
      return selDefault.value === NEW_COURT ? '' : selDefault.value;
    }

    function update() {
      var parsed = Courts.parsePasteRows(ta.value, ctx.techniques || [], { court: defaultCourt() });
```

`update` の残り（`okRows = …` 以降）は**そのまま**。

続けて、`ta.addEventListener('input', update);` の**直前**に足す。

```js
    selDefault.addEventListener('change', function() {
      if (selDefault.value === NEW_COURT) {
        var name = askCourtName();
        if (!name) { selDefault.value = lastDefault; update(); return; }
        insertCourtOption(selDefault, name);   // 「新しいコート…」の手前に足して選ぶ
      }
      lastDefault = selDefault.value;
      update();
    });
```

**注意**: `insertCourtOption` は `sel.lastChild` の手前に入れる。このセレクトも「新しいコート…」が最後なので、そのまま使える。

登録ボタンの側（`okRows.map(…)`）は `r.court` に補った値が入っているので**変更不要**。

- [ ] **Step 5: ブラウザで確かめる**

`http://localhost:3461/desk.html`（幅 1280px）を開き、**自分で作ったテスト用の大会**の「選手登録」で「📋 貼り付けて追加」を押す。

- [ ] セレクト「コートが空の行に使うコート」がテキストエリアの上に出て、初期値が既存コートの先頭になっている
- [ ] 名前だけ 3 行（`山田 太郎` 改行 `佐藤 花子` 改行 `鈴木 一郎`）を貼ると、プレビューの 3 行が緑（赤くない）で、コートが**薄い斜体**で出る。上の件数が「3 人を登録します」
- [ ] セレクトを別のコートに変えると、プレビューのコートがその場で変わる
- [ ] セレクトを「（指定しない）」にすると、3 行とも赤くなり「← コートがありません」が出て、「登録」が押せない
- [ ] セレクトを「新しいコート…」にして `D` と入れると、選択肢に `D` が増えて選ばれ、プレビューが `D` になる。取りやめ（キャンセル）だと元のコートに戻る
- [ ] コートを貼った行（`田中,B`）は薄くならず、その行だけ `B` のまま
- [ ] 「登録」を押すと 3 人が登録され、表にその既定コートで並ぶ
- [ ] 🌙 でダークにしても、薄いコートの文字が読める

- [ ] **Step 6: コミット**

`git diff desk-players.js desk.css` を読む。`desk-players.js` に**他人のハンク（`<h2>` の文言など）が混ざっていないか**を必ず確かめる。混ざっていたら「コミットの手順」の 3 に従う。

```bash
git add desk-players.js desk.css
git commit -m "$(cat <<'EOF'
feat: 貼り付けダイアログに「コートが空の行に使うコート」を足す

名前だけの行でも登録できるよう、コートの列が空の行に使う既定コートを
ダイアログで選べるようにした。プレビューは既定コートを反映し、補った
コートは薄い斜体で貼った値と区別する。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ヘルプに「名前だけでも登録できる」を書く

**⚠ このタスクを始める前に `git diff help.html` を読むこと。** トラック A の担当者がメニュー名で `help.html` を大きく書き換えている。他人のハンクが残っていたら**このタスクを飛ばし、Task 4 に進む**。Task 7 の後に戻ってきて、そのときも残っていれば指揮官に報告する。

**Files:**
- Modify: `help.html`（`<h3>（d）PC の表に打ち込む・Excel から貼り付ける</h3>` の節。貼り付けの `<ol>` の直後）

- [ ] **Step 1: 段落を足す**

`（d）` の節の、貼り付け手順の `<ol>` が閉じた直後（`<ul>` で「タブ区切り…」が始まる直前）に足す。**周りの文言は触らない**（トラック A が「選手」→「選手登録」などに書き換えている最中。いまの文言をそのまま残す）。

置き換え前（末尾の 2 行が目印）:

```html
      <li>件数を確かめて <span class="ui">登録</span> を押します。</li>
    </ol>
    <ul>
      <li>タブ区切り（Excel からのコピー）とカンマ区切りのどちらでも読めます。</li>
```

置き換え後:

```html
      <li>件数を確かめて <span class="ui">登録</span> を押します。</li>
    </ol>
    <p><span class="term">名前だけ</span>の行でも登録できます。足りない列は 性別＝男子・新人＝なし・技＝空 として読みます。コートの列が空の行には、貼り付け欄の上の <span class="ui">コートが空の行に使うコート</span> で選んだコートが入ります（下見の一覧では、補ったコートが<span class="term">薄い字</span>で出ます）。コートを選んでいないと、コートの列が空の行は赤くなって登録できません。</p>
    <ul>
      <li>タブ区切り（Excel からのコピー）とカンマ区切りのどちらでも読めます。</li>
```

- [ ] **Step 2: ブラウザで確かめる**

`http://localhost:3461/help.html` を開き、「（d）PC の表に打ち込む・Excel から貼り付ける」まで進む。
Expected: 手順の箇条書きの直後に新しい段落が出て、`コートが空の行に使うコート` が枠付き（`.ui`）、`名前だけ` と `薄い字` が強調（`.term`）になっている。レイアウトが崩れていない。

- [ ] **Step 3: コミット**

`git diff help.html` を読み、**自分の 1 段落だけ**であることを確かめる。他人のハンクがあればコミットしない（「コミットの手順」の 3）。

```bash
git add help.html
git commit -m "$(cat <<'EOF'
docs: ヘルプに名前だけの行でも貼り付けで登録できることを書く

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 選手一覧のセルを 3 か所とも中央揃えにする

PC の選手表（`desk.css`）・スマホの選手登録タブ（`admin.css`）・採点画面下部の選手一覧（`style.css`）の 3 か所を、見出しも含めて全列中央揃えにする。入力欄とセレクトの中の文字も中央にする。**CSS だけのタスク。JS と HTML は触らない。**

**Files:**
- Modify: `desk.css`（`.desk-players-table` の節、`.desk-cell-input` / `.desk-cell-select` の節）
- Modify: `admin.css`（`.players-table` の節。**2 か所だけ**）
- Modify: `style.css`（`.player-list-table` の節。**2 か所だけ**）

- [ ] **Step 1: `desk.css` を直す**

置き換え前:

```css
.desk-players-table { table-layout: fixed; width: 1022px; border-collapse: collapse; }
.desk-players-table th, .desk-players-table td { padding: 2px 6px; vertical-align: middle; }
```

置き換え後:

```css
.desk-players-table { table-layout: fixed; width: 1022px; border-collapse: collapse; }
.desk-players-table th, .desk-players-table td { padding: 2px 6px; vertical-align: middle; text-align: center; }
/* 上の .desk-table td.num は右寄せ。選手表だけ中央に戻す（同じ詳細度なので後ろのこれが勝つ） */
.desk-players-table td.num { text-align: center; }
```

続けて、セルの入力の節。置き換え前:

```css
.desk-cell-input, .desk-cell-select {
  width: 100%; min-height: 28px; padding: 2px 4px;
  background: transparent; color: inherit; border: 1px solid transparent; border-radius: 3px;
}
```

置き換え後:

```css
.desk-cell-input, .desk-cell-select {
  width: 100%; min-height: 28px; padding: 2px 4px; text-align: center;
  background: transparent; color: inherit; border: 1px solid transparent; border-radius: 3px;
}
/* セレクトは閉じているときの表示行にも中央を掛ける（text-align だけでは効かない） */
.desk-cell-select { text-align-last: center; }
```

- [ ] **Step 2: `admin.css` を直す**

置き換え前:

```css
.players-table th, .players-table td {
  height: 44px; padding: 0 6px; text-align: left; vertical-align: middle;
  border-bottom: 1px solid var(--border);
}
```

置き換え後:

```css
.players-table th, .players-table td {
  height: 44px; padding: 0 6px; text-align: center; vertical-align: middle;
  border-bottom: 1px solid var(--border);
}
```

置き換え前:

```css
.players-table .col-score { text-align: right; font-weight: bold; color: var(--score-color); }
```

置き換え後:

```css
.players-table .col-score { text-align: center; font-weight: bold; color: var(--score-color); }
```

**この 2 か所だけ**。`.players-table .col-name`（左に固定する名前列）は `text-align` を持たないので、上の行の中央揃えがそのまま効く。

- [ ] **Step 3: `style.css` を直す**

置き換え前:

```css
.player-list-table td {
  border: 1px solid var(--border);
  padding: 5px 8px;
  cursor: pointer;
  white-space: nowrap;
  height: 44px;
}
.player-list-table td:last-child {
  text-align: right;
  font-weight: bold;
  color: var(--score-color);
}
```

置き換え後:

```css
.player-list-table td {
  border: 1px solid var(--border);
  padding: 5px 8px;
  cursor: pointer;
  white-space: nowrap;
  height: 44px;
  text-align: center;
}
.player-list-table td:last-child {
  text-align: center;
  font-weight: bold;
  color: var(--score-color);
}
```

`.player-list-table th` は既に `text-align: center` なので**触らない**。`.player-nav` `.action-bar` `.timer-bar` など、**この節以外の `style.css` には一切触らない**（トラック D が同時に書き換えている）。

- [ ] **Step 4: ブラウザで 3 か所を確かめる（ライト／ダークの両方）**

- [ ] `http://localhost:3461/desk.html`（幅 1280px）の「選手登録」: 見出し（巡 / No. / 名前 / コート / 性別 / 新人 / 技1〜3 / 得点）と、すべてのセルの中身が中央。名前の入力欄の文字も中央。コート・性別・技のセレクトの文字も中央。新人のチェックも中央。No. と得点が右寄せでなく中央
- [ ] 並べ替えの ▲▼ が見出しの文字の右に付いたまま（`名前 ▲` のように）
- [ ] 名前列を左に固定したまま横スクロールしても崩れない（窓を 1000px まで狭めて確認）
- [ ] `http://localhost:3461/admin.html`（幅 375px）の「選手登録」タブ: 表の全列が中央。名前列（左に固定）も中央。得点が右寄せでなく中央
- [ ] `http://localhost:3461/scoring.html`（幅 1024px）で大会とコートを選び、下部の選手一覧: 全列が中央。得点の列も中央
- [ ] 3 画面とも 🌙 でダークにして同じことを確認

- [ ] **Step 5: コミット**

`git diff desk.css admin.css style.css` を読む。**`style.css` にトラック D のハンク（`.player-nav` `.action-block` `.action-bar` など）が残っていないか必ず確かめる。**

- 残っていなければ 3 ファイルまとめてコミットする
- 残っていたら **`desk.css` と `admin.css` だけ**をコミットし、`style.css` は保留して指揮官に報告する（D がコミットしたあとに `git diff style.css` を読み直し、自分のぶんだけになっていたら追いコミットする）

```bash
git add desk.css admin.css style.css
git commit -m "$(cat <<'EOF'
style: 選手一覧のセルを全列中央揃えにする

PC の選手表・スマホの選手登録タブ・採点画面下部の選手一覧の 3 か所を、
見出しも入力欄・セレクトの中の文字も中央にする。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

`style.css` を保留したときは、コミットメッセージの本文から「採点画面下部の選手一覧」を外し、`git add desk.css admin.css` だけにする。

---

### Task 5: `Courts.applyFilter` のコートを配列でも受ける

見出しのフィルタで複数コートを選べるようにするため、`filter.court` を**配列でも文字列でも**受ける。`''` と空配列は「すべて」。**`Courts.defaultFilter()` の既定は `''` のまま変えない**（スマホの選手登録タブ `admin-players.js` は文字列のまま使い続ける）。

**Files:**
- Modify: `courts.js`（`applyFilter`。「選手タブの絞り込み・並べ替え」の節）
- Modify: `test.html`（`applyFilter: 元配列を変えない` の assert の直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の

```js
    assert('applyFilter: 元配列を変えない', ordersOf(fPlayers), ['A-男子-1-1', 'A-男子-1-2', 'A-女子-1-1', 'B-男子-1-1', 'A-男子-2-1']);
```

の**直後**（`var sPlayers = [` の直前）に足す。

```js

    // filter.court は配列でも受ける（PC の見出しフィルタは複数コートを選べる）。
    // 文字列は後方互換（スマホの選手登録タブはコートのチップが 1 つだけなので文字列のまま）。
    assert('applyFilter: コートの配列で複数コートが残る',
      ordersOf(Courts.applyFilter(fPlayers, withFilter({ court: ['A', 'B'] }))),
      ['A-男子-1-1', 'A-男子-1-2', 'A-女子-1-1', 'B-男子-1-1', 'A-男子-2-1']);
    assert('applyFilter: コートの配列が 1 つなら文字列と同じ',
      ordersOf(Courts.applyFilter(fPlayers, withFilter({ court: ['B'] }))), ['B-男子-1-1']);
    assert('applyFilter: コートの空配列は全件',
      Courts.applyFilter(fPlayers, withFilter({ court: [] })).length, 5);
    assert('applyFilter: 配列に無いコートを指定すると 0 件',
      Courts.applyFilter(fPlayers, withFilter({ court: ['Z'] })).length, 0);
    assert('applyFilter: コートの配列も他の条件と AND',
      ordersOf(Courts.applyFilter(fPlayers, withFilter({ court: ['A', 'B'], sex: '女子' }))), ['A-女子-1-1']);
    assert('defaultFilter: court の既定は空文字のまま（配列にしない）',
      Courts.defaultFilter().court, '');
```

- [ ] **Step 2: テストが落ちるのを確かめる**

`http://localhost:3461/test.html` を**新しいタブ**で開く。
Expected: `applyFilter: コートの配列…` の assert が落ちる（配列と文字列を `===` で比べるので全部落ちる）。`defaultFilter: court の既定は…` は通る。`Result: N passed, M failed`（M は 4）。

- [ ] **Step 3: `applyFilter` を直す**

置き換え前:

```js
  // 絞り込み。すべての条件を AND で適用し、新しい配列を返す。
  function applyFilter(players, f) {
    f = f || defaultFilter();
    var q = normalizeName(f.query);
    return (players || []).filter(function(p) {
      if (f.court && courtOf(p) !== f.court) return false;
```

置き換え後:

```js
  // コートの一致。filter.court は文字列（1 コート）でも配列（複数コート）でも受ける。
  // '' と空配列は「すべて」。配列は PC の見出しフィルタのために後から足した形で、
  // スマホの選手登録タブ（admin-players.js）は文字列のまま使い続ける（後方互換）。
  function courtMatches(want, p) {
    if (Array.isArray(want)) {
      if (want.length === 0) return true;
      return want.indexOf(courtOf(p)) !== -1;
    }
    if (!want) return true;
    return courtOf(p) === want;
  }

  // 絞り込み。すべての条件を AND で適用し、新しい配列を返す。
  function applyFilter(players, f) {
    f = f || defaultFilter();
    var q = normalizeName(f.query);
    return (players || []).filter(function(p) {
      if (!courtMatches(f.court, p)) return false;
```

以降（`if (f.sex && …)` から）は**そのまま**。`defaultFilter()` は**変えない**。`courtMatches` は外に出さない（`return { … }` は触らない）。

- [ ] **Step 4: テストが通るのを確かめる**

`http://localhost:3461/test.html` を**新しいタブ**で開く。
Expected: `Result: (Task 1 の後の数 + 6) passed, 0 failed`。

- [ ] **Step 5: スマホの選手登録タブが壊れていないことを確かめる**

`http://localhost:3461/admin.html`（幅 375px）の「選手登録」タブ。
Expected: コートのチップを押すとそのコートだけに絞られ、「全コート」で戻る（文字列の経路がそのまま動く）。

- [ ] **Step 6: コミット**

`git diff courts.js test.html` を読み、自分の変更だけであることを確かめてから:

```bash
git add courts.js test.html
git commit -m "$(cat <<'EOF'
feat: Courts.applyFilter のコートを配列でも受ける

PC の選手表の見出しフィルタで複数コートを選べるようにするため、
filter.court を配列でも文字列でも受けるようにした。'' と空配列は
「すべて」。defaultFilter() の既定は '' のままで、スマホの選手登録タブは
文字列のまま動く。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: PC 選手表の絞り込みを見出しの ▼ に寄せる

チップの帯と名前の検索欄をやめ、見出しの各列に ▼ を付けて、そこから絞り込む（Excel 風）。判定は `Courts.applyFilter` のまま。帯があった場所には「表示 n / N 名」と、絞り込み中だけ「絞り込みを解除」を出す。

このタスクは `desk-players.js` の描き分けを変える。要は **見出し（`<thead>`）は絞り込みでは作り直さない**こと。ポップオーバーの中で名前を打っているあいだ入力欄と IME の変換が生き残る必要があり、行だけを描き直すため。

| 列 | ▼ で開くもの | 使う状態 |
|---|---|---|
| 巡 | チェック式（`Courts.roundsOf` の巡目。ふつう一巡目／二巡目） | `filter.round`（0 / 1 / 2） |
| 名前 | 検索欄（部分一致。`Courts.normalizeName`） | `filter.query` |
| コート | チェック式・複数選択（`Courts.listFrom`。`未分類` も含む） | `filter.court`（配列） |
| 性別 | チェック式（男子／女子） | `filter.sex`（'' / '男子' / '女子'） |
| 新人 | チェック 1 つ「新人だけ」 | `filter.newFace`（真偽値） |
| 技1〜3 | チェック 1 つ「技が未入力の行だけ」（3 列で共通） | `filter.noTech`（真偽値） |
| No.・得点・⋯ | ▼ なし | — |

**Files:**
- Modify: `desk-players.js`（COLUMNS / `render` / `refresh` / `redrawTable` / `chipGroup` / `renderChips` / `renderTable`。新しく絞り込みの節を足す）
- Modify: `desk.css`（`.desk-chip*` と `.desk-players-search` を消し、▼ とポップオーバーの CSS を足す）

- [ ] **Step 1: `desk.css` のチップの CSS を入れ替える**

置き換え前（「選手の表（desk-players.js）」の節の頭）:

```css
/* ===== 選手の表（desk-players.js） ===== */
/* 帯は PC 幅なので 1 段（スマホの選手タブは 3 段）。右端に名前の検索。 */
.desk-players-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.desk-players-chips { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.desk-chip-group { display: inline-flex; gap: 4px; }
.desk-chip {
  min-height: 28px; padding: 0 10px; font-size: 13px;
  background: var(--bg-secondary); color: var(--text-muted); border: 1px solid var(--border);
}
.desk-chip:hover { border-color: var(--accent); color: var(--text); }
.desk-chip.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: bold; }
.desk-players-search { width: 200px; margin-left: auto; }
```

置き換え後:

```css
/* ===== 選手の表（desk-players.js） ===== */
/* 絞り込みは見出しの ▼ に寄せたので、表の上の帯は件数と「絞り込みを解除」だけ。 */
.desk-players-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; min-height: 30px; }
.desk-players-count { font-size: 13px; color: var(--text-muted); }
```

- [ ] **Step 2: `desk.css` に ▼ とポップオーバーの CSS を足す**

「並べ替えできる見出し」の節を置き換える。置き換え前:

```css
/* 並べ替えできる見出し */
.sort-btn { background: transparent; color: inherit; font-size: 13px; font-weight: bold; padding: 2px 4px; }
.sort-btn:hover { color: var(--accent); }
.sort-btn.on { color: var(--accent); }
```

置き換え後:

```css
/* 並べ替えできる見出し */
.sort-btn { background: transparent; color: inherit; font-size: 13px; font-weight: bold; padding: 2px 4px; }
.sort-btn:hover { color: var(--accent); }
.sort-btn.on { color: var(--accent); }

/* ===== 見出しの ▼ のフィルタ（desk-players.js） ===== */
/* ▼ は見出しの文字の右に小さく。押しても並べ替えは起きない（JS 側で stopPropagation）。 */
.filter-btn { background: transparent; color: var(--text-muted); font-size: 11px; padding: 0 2px; line-height: 1; }
.filter-btn:hover { color: var(--accent); }
.filter-btn.on { color: var(--accent); font-weight: bold; }
/* 絞り込み中の列は見出しの背景を薄く色付ける。
   .desk-players-table th.col-name（左に固定する名前列）と同じ詳細度なので、必ずその後ろに置く。 */
.desk-players-table th.filtered, .desk-players-table th.col-name.filtered { background: var(--row-selected); }
/* ポップオーバーは document.body に fixed で置く（.desk-players-wrap は overflow-x: auto の
   ため中に絶対配置すると縦にも切られる。.desk-menu-body と同じ落とし穴）。位置は JS が入れる。 */
.desk-filter-pop {
  position: fixed; z-index: 30; min-width: 170px; max-width: 280px; padding: 6px;
  background: var(--card-bg); border: 1px solid var(--border); border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,.25);
}
.desk-filter-list { max-height: 220px; overflow-y: auto; }
.desk-filter-row {
  display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 4px;
  cursor: pointer; white-space: nowrap; font-size: 13px; text-align: left;
}
.desk-filter-row:hover { background: var(--bg-secondary); }
.desk-filter-row input { width: 16px; height: 16px; flex: 0 0 auto; }
.desk-filter-actions { display: flex; gap: 6px; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); }
.desk-filter-search {
  width: 100%; min-height: 30px; padding: 2px 6px; font-family: inherit;
  background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 3px;
}
/* 条件に合う行が無いとき。見出しを残したいので、表の外ではなく行として出す。 */
.desk-empty-row { text-align: center; color: var(--text-muted); padding: 16px 0; }
```

- [ ] **Step 3: COLUMNS に ▼ の種類を足す**

置き換え前:

```js
  var COLUMNS = [
    { label: '巡', cls: 'col-round' },
    { key: 'order', label: 'No.', cls: 'col-no' },
    { key: 'name', label: '名前', cls: 'col-name' },
    { label: 'コート', cls: 'col-court' },
    { label: '性別', cls: 'col-sex' },
    { label: '新人', cls: 'col-new' },
    { label: '技1', cls: 'col-tech' },
    { label: '技2', cls: 'col-tech' },
    { label: '技3', cls: 'col-tech' },
    { key: 'score', label: '得点', cls: 'col-score' },
    { label: '', cls: 'act' }
  ];
```

置き換え後:

```js
  // 表の列。key があるものは見出しの文字を押すと並べ替えられる
  // （巡・コート・性別は絞り込みの軸なので並べ替えの対象にしない）。
  // filter があるものは見出しに ▼ が付き、押すと絞り込みのポップオーバーが開く。
  // 技1〜3 はどの列の ▼ からでも同じ「技が未入力の行だけ」を開く。
  var COLUMNS = [
    { label: '巡', cls: 'col-round', filter: 'round' },
    { key: 'order', label: 'No.', cls: 'col-no' },
    { key: 'name', label: '名前', cls: 'col-name', filter: 'name' },
    { label: 'コート', cls: 'col-court', filter: 'court' },
    { label: '性別', cls: 'col-sex', filter: 'sex' },
    { label: '新人', cls: 'col-new', filter: 'newFace' },
    { label: '技1', cls: 'col-tech', filter: 'noTech' },
    { label: '技2', cls: 'col-tech', filter: 'noTech' },
    { label: '技3', cls: 'col-tech', filter: 'noTech' },
    { key: 'score', label: '得点', cls: 'col-score' },
    { label: '', cls: 'act' }
  ];

  // この画面の絞り込みの初期値。複数選べるのはコートだけなので配列にする
  // （Courts.applyFilter は文字列も配列も受ける。Courts.defaultFilter() の既定は '' のまま）。
  function newFilter() {
    var f = Courts.defaultFilter();
    f.court = [];
    return f;
  }
```

- [ ] **Step 4: `render` の帯を件数の行に入れ替える**

置き換え前（`render` の頭のほう）:

```js
    if (stateOwner !== ctx.eventId) {
      filter = Courts.defaultFilter();
      sort = Courts.defaultSort();
      draft = null;
      stateOwner = ctx.eventId;
    }
    if (locked) draft = null;   // 確定済みの大会では行を足せない
    // 絞り込み中のコート・巡目の選手が全員いなくなったら「全コート」「全巡」に戻す
    if (filter.court && Courts.listFrom(ctx.players).indexOf(filter.court) === -1) filter.court = '';
    if (filter.round && Courts.roundsOf(ctx.players).indexOf(filter.round) === -1) filter.round = 0;
```

置き換え後:

```js
    if (stateOwner !== ctx.eventId) {
      filter = newFilter();
      sort = Courts.defaultSort();
      draft = null;
      stateOwner = ctx.eventId;
    }
    if (locked) draft = null;   // 確定済みの大会では行を足せない
    // 絞り込み中のコート・巡目の選手が全員いなくなったら「すべて」に戻す
    var courtList = Courts.listFrom(ctx.players);
    filter.court = (filter.court || []).filter(function(c) { return courtList.indexOf(c) !== -1; });
    if (filter.round && Courts.roundsOf(ctx.players).indexOf(filter.round) === -1) filter.round = 0;
    // 前の描画のポップオーバーを残さない（document.body に置くので勝手には消えない）
    closePopover();
```

続けて、帯の組み立てから `refresh()` までを丸ごと入れ替える。置き換え前:

```js
    // 帯。チップは押すたびに作り直すが、検索の入力欄は作り直さない
    // （入力中の文字と IME の変換を保つ。スマホの選手登録タブと同じ理由）。
    var bar = document.createElement('div');
    bar.className = 'desk-players-bar';
    var chips = document.createElement('div');
    chips.className = 'desk-players-chips';
    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'desk-players-search';
    search.placeholder = '名前で検索';
    search.setAttribute('aria-label', '名前で検索');
    search.value = filter.query;
    bar.appendChild(chips);
    bar.appendChild(search);
    container.appendChild(bar);

    var wrap = document.createElement('div');
    wrap.className = 'desk-players-wrap';
    container.appendChild(wrap);

    view = { chips: chips, wrap: wrap, ctx: ctx, locked: locked };

    function applyQuery() {
      // Chromium は変換確定で compositionend と input の両方が来るので、同じ文字列なら描き直さない
      if (search.value === filter.query) return;
      filter.query = search.value;
      redrawTable();
    }
    search.addEventListener('input', function(ev) {
      // IME 変換中は確定前の文字で絞り込まない（変換終了時に確定値で最後の input が来る）
      if (ev.isComposing) return;
      applyQuery();
    });
    // WebKit は input(isComposing:true) → compositionend の順で、その後 isComposing:false の
    // input が来ないため、compositionend でも絞り込む（techpicker.js の検索欄と同じ）。
    search.addEventListener('compositionend', applyQuery);

    refresh();
  }

  // 帯と表を描き直す（チップを押したとき）
  function refresh() {
    if (!view) return;
    renderChips(view.chips, view.ctx);
    renderTable(view.wrap, view.ctx, view.locked);
  }

  // 表だけ描き直す（並べ替え・名前の検索・行の追加や削除）
  function redrawTable() {
    if (!view) return;
    renderTable(view.wrap, view.ctx, view.locked);
  }

  // チップの小さな並び（admin.js の Admin.renderChips の PC 版。desk.html は admin.js を読まない）。
  function chipGroup(parent, items, current, onPick) {
    var g = document.createElement('span');
    g.className = 'desk-chip-group';
    items.forEach(function(item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'desk-chip' + (String(item.value) === String(current) ? ' on' : '');
      b.textContent = item.label;
      b.addEventListener('click', function() { onPick(item.value); refresh(); });
      g.appendChild(b);
    });
    parent.appendChild(g);
  }

  function renderChips(el, ctx) {
    el.innerHTML = '';
    chipGroup(el, [{ value: '', label: '全コート' }].concat(Courts.listFrom(ctx.players).map(function(c) {
      return { value: c, label: c === Courts.UNASSIGNED ? c : c + ' コート' };
    })), filter.court, function(v) { filter.court = v; });

    chipGroup(el, [{ value: '', label: '男女' }, { value: '男子', label: '男子' }, { value: '女子', label: '女子' }],
      filter.sex, function(v) { filter.sex = v; });

    chipGroup(el, [{ value: 0, label: '全巡' }].concat(Courts.roundsOf(ctx.players).map(function(r) {
      return { value: r, label: r + '巡' };
    })), filter.round, function(v) { filter.round = v; });

    chipGroup(el, [{ value: true, label: '新人' }], filter.newFace, function() { filter.newFace = !filter.newFace; });
    chipGroup(el, [{ value: true, label: '技未入力' }], filter.noTech, function() { filter.noTech = !filter.noTech; });
  }
```

置き換え後:

```js
    // 表の上の行。絞り込みは見出しの ▼ に移したので、ここは件数と解除ボタンだけ。
    var bar = document.createElement('div');
    bar.className = 'desk-players-bar';
    container.appendChild(bar);

    var wrap = document.createElement('div');
    wrap.className = 'desk-players-wrap';
    container.appendChild(wrap);

    view = { bar: bar, wrap: wrap, ctx: ctx, locked: locked, heads: [], tbody: null };

    redrawTable();
  }

  // 表ごと描き直す（見出しも作り直す。並べ替え・行の追加や削除・絞り込みの一括解除）。
  // 開いているポップオーバーは見出しの ▼ を指しているので、先に閉じる。
  function redrawTable() {
    if (!view) return;
    closePopover();
    renderTable(view.wrap, view.ctx, view.locked);
  }

  // 行と件数だけ描き直す（絞り込みを変えたとき）。見出しは作り直さない
  // ＝ 開いているポップオーバーの中の入力欄と IME の変換が生き残る。
  function refreshRows() {
    if (!view) return;
    fillRows(view.ctx, view.locked);
    updateHeadMarks();
  }

  // ---- 絞り込みの状態 ----

  var FILTER_KINDS = ['round', 'name', 'court', 'sex', 'newFace', 'noTech'];

  function isFilterActive(kind) {
    if (kind === 'court') return (filter.court || []).length > 0;
    if (kind === 'round') return !!filter.round;
    if (kind === 'sex') return !!filter.sex;
    if (kind === 'newFace') return !!filter.newFace;
    if (kind === 'noTech') return !!filter.noTech;
    if (kind === 'name') return !!filter.query;
    return false;
  }

  function isAnyFilterActive() {
    return FILTER_KINDS.some(isFilterActive);
  }

  function clearFilter() {
    filter = newFilter();
    redrawTable();   // 見出しの ▼ と背景も戻すので表ごと描き直す
  }

  // 見出しの ▼ と背景を、いまの絞り込みに合わせる（表は作り直さない）。
  function updateHeadMarks() {
    if (!view || !view.heads) return;
    view.heads.forEach(function(h) {
      var on = isFilterActive(h.kind);
      h.th.classList.toggle('filtered', on);
      h.btn.classList.toggle('on', on);
    });
  }

  // ---- 見出しの ▼ のポップオーバー ----
  // 画面に同時に 1 つだけ。外側クリック・Esc・スクロール・リサイズ・ハッシュ変更で閉じる。
  // 表の枠（.desk-players-wrap）は overflow-x: auto なので中に絶対配置すると縦にも切られる
  // （desk.css の .desk-menu のコメント参照）。document.body に fixed で置いて逃がす。
  var popover = null;   // null | { el, btn, col }
  var popoverBound = false;

  function bindPopoverCloseOnce() {
    if (popoverBound) return;
    popoverBound = true;
    document.addEventListener('click', function(e) {
      if (!popover) return;
      if (popover.el.contains(e.target)) return;   // ▼ 自身は stopPropagation でここに来ない
      closePopover();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && popover) { e.preventDefault(); closePopover(); }
    });
    // 表や窓が動くと ▼ の位置がずれるので閉じる（中身のスクロールでは閉じない）
    window.addEventListener('scroll', function(e) {
      if (popover && popover.el.contains(e.target)) return;
      closePopover();
    }, true);
    window.addEventListener('resize', function() { closePopover(); });
    // 別の区画へ移っても body に残り続けないように
    window.addEventListener('hashchange', function() { closePopover(); });
  }

  function closePopover() {
    if (!popover) return;
    var btn = popover.btn;
    if (popover.el.parentNode) popover.el.parentNode.removeChild(popover.el);
    popover = null;
    if (btn && btn.isConnected) {
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  }

  function togglePopover(btn, col) {
    if (popover && popover.btn === btn) { closePopover(); return; }
    openPopover(btn, col);
  }

  function openPopover(btn, col) {
    closePopover();
    bindPopoverCloseOnce();
    var box = document.createElement('div');
    box.className = 'desk-filter-pop';
    document.body.appendChild(box);
    popover = { el: box, btn: btn, col: col };
    rebuildPopover();
    placePopover();
    btn.setAttribute('aria-expanded', 'true');
    var first = box.querySelector('input');
    if (first) first.focus();
  }

  // 中身だけ作り直す（「すべて選択」やチェックの入り直しを反映する）。
  // 名前の検索欄は作り直すと入力中の文字と IME の変換が消えるので、ここからは呼ばない。
  function rebuildPopover() {
    if (!popover) return;
    popover.el.innerHTML = '';
    popover.el.appendChild(popoverBody(popover.col));
  }

  // ▼ の実座標から位置を決める。画面の右端からはみ出すときは寄せ戻す。
  function placePopover() {
    if (!popover) return;
    var r = popover.btn.getBoundingClientRect();
    popover.el.style.top = (r.bottom + 4) + 'px';
    var left = r.left;
    var w = popover.el.offsetWidth;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
    popover.el.style.left = left + 'px';
  }

  // チェック 1 行
  function checkRow(label, checked, onChange) {
    var lab = document.createElement('label');
    lab.className = 'desk-filter-row';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = checked;
    chk.addEventListener('change', function() { onChange(chk.checked); });
    lab.appendChild(chk);
    var span = document.createElement('span');
    span.textContent = label;
    lab.appendChild(span);
    return lab;
  }

  // 「すべて選択」＝ この列の絞り込みを外す。
  // 設計書の「解除」は、この状態モデルでは同じ「絞り込みなし」に戻るため置かない
  // （空＝すべて。「どれも表示しない」という状態が無い）。
  function allButton(onAll) {
    var row = document.createElement('div');
    row.className = 'desk-filter-actions';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'desk-btn';
    b.textContent = 'すべて選択';
    b.addEventListener('click', onAll);
    row.appendChild(b);
    return row;
  }

  function popoverBody(col) {
    var ctx = view.ctx;
    if (col.filter === 'court') return courtPop(ctx);
    if (col.filter === 'round') {
      return triPop(Courts.roundsOf(ctx.players).map(function(r) {
        return { value: r, label: r === 1 ? '一巡目' : r === 2 ? '二巡目' : r + '巡目' };
      }), filter.round, 0, function(v) { filter.round = v; });
    }
    if (col.filter === 'sex') {
      return triPop([{ value: '男子', label: '男子' }, { value: '女子', label: '女子' }],
        filter.sex, '', function(v) { filter.sex = v; });
    }
    if (col.filter === 'newFace') {
      return flagPop('新人だけ', filter.newFace, function(v) { filter.newFace = v; });
    }
    return flagPop('技が未入力の行だけ', filter.noTech, function(v) { filter.noTech = v; });
  }

  // コート。ここだけ本当の複数選択（filter.court は配列）。
  // 空配列＝すべて。全部にチェックが入った状態も空配列に戻す（同じ意味なので状態を1つに保つ）。
  function courtPop(ctx) {
    var box = document.createElement('div');
    var list = Courts.listFrom(ctx.players);   // 未分類も含む
    var body = document.createElement('div');
    body.className = 'desk-filter-list';
    var all = (filter.court || []).length === 0;
    list.forEach(function(c) {
      body.appendChild(checkRow(c, all || filter.court.indexOf(c) !== -1, function(on) {
        var cur = ((filter.court || []).length === 0) ? list.slice() : filter.court.slice();
        var i = cur.indexOf(c);
        if (on && i === -1) cur.push(c);
        if (!on && i !== -1) cur.splice(i, 1);
        filter.court = (cur.length === list.length) ? [] : cur;
        refreshRows();   // チェックの見た目はブラウザが変えているので作り直さない
      }));
    });
    box.appendChild(body);
    box.appendChild(allButton(function() {
      filter.court = [];
      rebuildPopover();
      refreshRows();
    }));
    return box;
  }

  // 3 値（すべて／A／B）をチェックで見せる。両方入り＝すべて、片方だけ＝その値。
  // 最後の 1 つを外したら「すべて」に戻す（この状態モデルに「どれも出さない」は無い）。
  // items は 1〜2 個（巡目は 1 巡だけの大会がある）。
  function triPop(items, current, empty, set) {
    var box = document.createElement('div');
    var body = document.createElement('div');
    body.className = 'desk-filter-list';
    var all = String(current) === String(empty);
    items.forEach(function(it) {
      var on = all || String(current) === String(it.value);
      body.appendChild(checkRow(it.label, on, function(checked) {
        if (all) {
          // すべて → この 1 つを外す ＝ 残りだけを見る
          if (!checked) {
            var other = items.filter(function(x) { return String(x.value) !== String(it.value); })[0];
            set(other ? other.value : empty);
          }
        } else if (String(current) === String(it.value)) {
          if (!checked) set(empty);     // 最後の 1 つを外したら「すべて」に戻す
        } else if (checked) {
          set(empty);                   // 2 つとも入った ＝ すべて
        }
        rebuildPopover();               // 相手側のチェックも入れ直す
        refreshRows();
      }));
    });
    box.appendChild(body);
    box.appendChild(allButton(function() { set(empty); rebuildPopover(); refreshRows(); }));
    return box;
  }

  // チェック 1 つだけ（新人・技未入力）。外した状態が「すべて」なのでボタンは要らない。
  function flagPop(label, on, set) {
    var box = document.createElement('div');
    var body = document.createElement('div');
    body.className = 'desk-filter-list';
    body.appendChild(checkRow(label, !!on, function(checked) {
      set(checked);
      refreshRows();
    }));
    box.appendChild(body);
    return box;
  }

  // 名前の検索。refreshRows は見出しを作り直さないので、打ち込みと IME の変換が続く。
  function namePop() {
    var box = document.createElement('div');
    var input = document.createElement('input');
    input.type = 'search';
    input.className = 'desk-filter-search';
    input.placeholder = '名前で検索';
    input.setAttribute('aria-label', '名前で検索');
    input.value = filter.query;
    function applyQuery() {
      // Chromium は変換確定で compositionend と input の両方が来るので、同じ文字列なら描き直さない
      if (input.value === filter.query) return;
      filter.query = input.value;
      refreshRows();
    }
    input.addEventListener('input', function(ev) {
      // IME 変換中は確定前の文字で絞り込まない（変換終了時に確定値で最後の input が来る）
      if (ev.isComposing) return;
      applyQuery();
    });
    // WebKit は input(isComposing:true) → compositionend の順で、その後 isComposing:false の
    // input が来ないため、compositionend でも絞り込む（techpicker.js の検索欄と同じ）。
    input.addEventListener('compositionend', applyQuery);
    // Esc はブラウザの既定（入力欄を空にする）ではなくポップオーバーを閉じるほうに使う
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
    });
    box.appendChild(input);
    return box;
  }
```

**注意**: `popoverBody` は `col.filter === 'name'` を扱っていない。上の `popoverBody` の `if (col.filter === 'court')` の**直前**に次の 1 行を入れること。

```js
    if (col.filter === 'name') return namePop();
```

- [ ] **Step 5: 表の描画を「見出し」と「行」に分ける**

置き換え前（`renderTable` の全体）:

```js
  function renderTable(wrap, ctx, locked) {
    wrap.innerHTML = '';
    var players = ctx.players || [];
    if (players.length === 0 && !draft) {
      wrap.appendChild(emptyMessage('まだ選手がいません。「＋ 行を追加」か「📋 貼り付けて追加」で登録してください。'));
      return;
    }
    var rows = Courts.sortBy(Courts.applyFilter(players, filter), sort);
    if (rows.length === 0 && !draft) {
      wrap.appendChild(emptyMessage('条件に合う選手がいません。'));
      return;
    }

    var table = document.createElement('table');
    table.className = 'desk-table desk-players-table';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    COLUMNS.forEach(function(col) {
      var th = document.createElement('th');
      th.className = col.cls;
      if (!col.key) {
        th.textContent = col.label;
        // 操作列は見出しの文字が空なので、スクリーンリーダー向けに列名を付ける
        if (col.cls === 'act') th.setAttribute('aria-label', '操作');
      } else {
        var on = sort.key === col.key;
        th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = on ? 'sort-btn on' : 'sort-btn';
        b.textContent = col.label + (on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
        b.addEventListener('click', function() {
          // 同じ列なら昇⇄降、別の列なら昇順から
          if (sort.key === col.key) sort.dir = (sort.dir === 'asc' ? 'desc' : 'asc');
          else sort = { key: col.key, dir: 'asc' };
          redrawTable();
        });
        th.appendChild(b);
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function(p) { tbody.appendChild(buildRow(ctx, p, locked)); });
    // 下書き行は絞り込みに関わらず必ず末尾に出す（打ち込んでいる途中で消えない）
    if (draft && !locked) tbody.appendChild(buildDraftRow(ctx));
    table.appendChild(tbody);
    wrap.appendChild(table);
  }
```

置き換え後:

```js
  // 表の上の「表示 n / N 名」と「絞り込みを解除」。
  function renderCount(shown, total) {
    if (!view || !view.bar) return;
    view.bar.innerHTML = '';
    var span = document.createElement('span');
    span.className = 'desk-players-count';
    span.textContent = '表示 ' + shown + ' / ' + total + ' 名';
    view.bar.appendChild(span);
    if (!isAnyFilterActive()) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'desk-btn';
    b.textContent = '絞り込みを解除';
    b.addEventListener('click', function() { clearFilter(); });
    view.bar.appendChild(b);
  }

  // 条件に合う行が無いときの 1 行。表の外に出すと見出しごと消えて
  // 絞り込みを戻せなくなるので、行として出す。
  function noMatchRow() {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.className = 'desk-empty-row';
    td.colSpan = COLUMNS.length;
    td.textContent = '条件に合う選手がいません。';
    tr.appendChild(td);
    return tr;
  }

  // 見出し。絞り込みでは作り直さない（ポップオーバーの中の入力を保つため）。
  // view.heads に { kind, th, btn } を貯めて、updateHeadMarks で色だけ塗り替える。
  function buildHead(ctx) {
    view.heads = [];
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    COLUMNS.forEach(function(col) {
      var th = document.createElement('th');
      th.className = col.cls;
      if (!col.key) {
        th.textContent = col.label;
        // 操作列は見出しの文字が空なので、スクリーンリーダー向けに列名を付ける
        if (col.cls === 'act') th.setAttribute('aria-label', '操作');
      } else {
        var on = sort.key === col.key;
        th.setAttribute('aria-sort', on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = on ? 'sort-btn on' : 'sort-btn';
        b.textContent = col.label + (on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
        b.addEventListener('click', function() {
          // 同じ列なら昇⇄降、別の列なら昇順から
          if (sort.key === col.key) sort.dir = (sort.dir === 'asc' ? 'desc' : 'asc');
          else sort = { key: col.key, dir: 'asc' };
          redrawTable();
        });
        th.appendChild(b);
      }
      if (col.filter) th.appendChild(filterButton(th, col));
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    updateHeadMarks();
    return thead;
  }

  // 見出しの ▼。並べ替え（見出しの文字のボタン）と分けるため、
  // クリックは stopPropagation して外側クリックの判定にも流さない。
  function filterButton(th, col) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter-btn';
    b.textContent = '▼';
    b.setAttribute('aria-label', (col.label || '操作') + 'の絞り込み');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function(e) {
      e.stopPropagation();
      togglePopover(b, col);
    });
    view.heads.push({ kind: col.filter, th: th, btn: b });
    return b;
  }

  // 行と件数だけ作り直す（見出しはそのまま）。
  function fillRows(ctx, locked) {
    var tbody = view && view.tbody;
    if (!tbody) return;
    tbody.innerHTML = '';
    var players = ctx.players || [];
    var rows = Courts.sortBy(Courts.applyFilter(players, filter), sort);
    rows.forEach(function(p) { tbody.appendChild(buildRow(ctx, p, locked)); });
    if (rows.length === 0 && !draft) tbody.appendChild(noMatchRow());
    // 下書き行は絞り込みに関わらず必ず末尾に出す（打ち込んでいる途中で消えない）
    if (draft && !locked) tbody.appendChild(buildDraftRow(ctx));
    renderCount(rows.length, players.length);
  }

  function renderTable(wrap, ctx, locked) {
    wrap.innerHTML = '';
    view.tbody = null;
    var players = ctx.players || [];
    if (players.length === 0 && !draft) {
      if (view.bar) view.bar.innerHTML = '';
      wrap.appendChild(emptyMessage('まだ選手がいません。「＋ 行を追加」か「📋 貼り付けて追加」で登録してください。'));
      return;
    }
    var table = document.createElement('table');
    table.className = 'desk-table desk-players-table';
    table.appendChild(buildHead(ctx));
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);
    view.tbody = tbody;
    fillRows(ctx, locked);
  }
```

**注意**: `buildHead` は `view.heads` を使うので、`view` が作られた後にしか呼べない。`renderTable` は必ず `render` の後で呼ばれるので問題ない。

- [ ] **Step 6: 冒頭のコメントを直す**

置き換え前（ファイルの 3 行目。**別の担当者が書き換えている可能性があるので、いまの文言を読んでから当てる**）:

```js
  // 帯は PC 幅なので 1 段に並べる（スマホの admin-players.js は 3 段）。
```

置き換え後:

```js
  // 絞り込みは見出しの ▼（Excel 風）。スマホの admin-players.js はチップの帯のまま。
```

- [ ] **Step 7: ブラウザで確かめる**

`http://localhost:3461/desk.html`（幅 1280px）の「選手登録」。**自分で作ったテスト用の大会**で、コートが 2 つ以上・男女・新人・技未入力の行が混ざるようにしておく。

- [ ] チップの帯と名前の検索欄が消えている。表の上に「表示 n / N 名」だけが出ている
- [ ] 巡・名前・コート・性別・新人・技1・技2・技3 の見出しに ▼ がある。No.・得点・⋯ には無い
- [ ] コートの ▼ を押すとポップオーバーが開き、全コート（`未分類` があればそれも）にチェックが入っている
- [ ] コートを 1 つ外すと、その場で行が減り、「表示 n / N 名」が変わる。ポップオーバーは開いたまま
- [ ] コートを 2 つだけ残すと、その 2 コートの行だけが出る（複数選択）
- [ ] 全部のチェックを入れ直すと絞り込みが外れ、▼ の色と見出しの背景が元に戻る
- [ ] 「すべて選択」を押すと全部にチェックが入り、絞り込みが外れる
- [ ] 巡の ▼: 「一巡目」を外すと二巡目だけになる。もう一度「二巡目」も外すと「すべて」に戻る（0 件にならない）
- [ ] 性別の ▼: 「女子」を外すと男子だけ。両方入れると全員
- [ ] 新人の ▼: 「新人だけ」にチェックを入れると新人の行だけ
- [ ] 技1 の ▼ で「技が未入力の行だけ」にチェック → 技2・技3 の ▼ を開いても同じチェックが入っている（3 列共通）
- [ ] 名前の ▼: 検索欄が出る。**日本語を IME で打ち、変換中は絞り込まれず、確定したところで絞り込まれる**。打っている間にポップオーバーが閉じたり入力が消えたりしない
- [ ] 絞り込み中の列は ▼ が色付き、見出しの背景が薄く色付く。名前列（左に固定）も色が付く
- [ ] 絞り込み中だけ「絞り込みを解除」が出て、押すと全部戻る（▼ の色も戻る）
- [ ] ポップオーバーが開いているとき、**表の別の場所をクリックすると閉じる**。**Esc でも閉じる**。**もう一度同じ ▼ を押しても閉じる**
- [ ] 別の列の ▼ を押すと、前のポップオーバーが閉じて新しいほうだけが開く（同時に 2 つ出ない）
- [ ] **見出しの文字（`名前` `No.` `得点`）を押すと並べ替わる。▼ を押しても並べ替わらない**
- [ ] 絞り込みで 0 件になると、見出しは残ったまま「条件に合う選手がいません。」の行が出る。そこから ▼ か「絞り込みを解除」で戻せる
- [ ] 選手が 2 人だけの大会でコートの ▼ を開いても、ポップオーバーが表の枠で切られない
- [ ] 窓を 1000px まで狭めて横スクロールさせ、▼ を開くとポップオーバーが ▼ の下に出る。スクロールすると閉じる
- [ ] ページの一番下の行の ⋯ メニューが今までどおり開く（`.desk-players-wrap` の padding は変えていない）
- [ ] 「＋ 行を追加」で下書き行が出て、絞り込み中でも末尾に残る。名前を入れて Enter で登録できる
- [ ] 「📋 貼り付けて追加」が Task 2 のとおり動く
- [ ] セルを直して blur すると保存される（トーストが出る）
- [ ] 別の大会に切り替えると絞り込みが初期化される。別の区画（試合進行）へ移ってもポップオーバーが画面に残らない
- [ ] 🌙 でダークにして、▼・ポップオーバー・絞り込み中の見出しの背景が読める

- [ ] **Step 8: 自動テストが通ることを確かめる**

`http://localhost:3461/test.html` を**新しいタブ**で開く。
Expected: `Result: (Task 5 の後の数) passed, 0 failed`（このタスクはテストを増やさない。`desk-players.js` は `test.html` が読み込まないので数は変わらない）。

- [ ] **Step 9: コミット**

`git diff desk-players.js desk.css` を読み、他人のハンクが混ざっていないか確かめてから:

```bash
git add desk-players.js desk.css
git commit -m "$(cat <<'EOF'
feat: PC 選手表の絞り込みを見出しの ▼ に寄せる

チップの帯と名前の検索欄をやめ、巡・名前・コート・性別・新人・技の各列の
見出しの ▼ からポップオーバーで絞り込むようにした。コートだけ複数選択
（filter.court は配列）。表の上には「表示 n / N 名」と、絞り込み中だけ
「絞り込みを解除」を出す。ポップオーバーは同時に 1 つで、外側クリック・
Esc・スクロールで閉じる。▼ のクリックは並べ替えと分ける。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 通しの手動確認

**Files:** なし（確認だけ。コミットも無し）

- [ ] **Step 1: 自動テスト**

`http://localhost:3461/test.html` を**新しいタブ**で開く。
Expected: `Result: (控えた N + 15) passed, 0 failed`。

- [ ] **Step 2: 設計書の「手動確認」のうち、この計画の担当ぶんを通す**

- [ ] PC 選手表（`desk.html` 1280px）・スマホ選手登録タブ（`admin.html` 375px）・採点画面下部の一覧（`scoring.html` 1024px）で全列が中央揃え。ライト／ダークの両方
- [ ] 貼り付けで名前だけ 3 行 → 既定コートで登録される。コートのセレクトを変えるとプレビューが変わる
- [ ] 見出しの ▼ で絞り込み、複数コートの選択、「表示 n / N 名」、「絞り込みを解除」、Esc と外側クリックで閉じる、並べ替えと干渉しない
- [ ] スマホの選手登録タブのチップの絞り込みが今までどおり動く（`Courts.applyFilter` の後方互換）
- [ ] 採点画面で選手を選んで採点し、保存できる（`style.css` の中央揃えが他を壊していない）
- [ ] ブラウザのコンソールにエラーが出ていない（`desk.html` `admin.html` `scoring.html` の 3 つとも）

- [ ] **Step 3: Task 3（ヘルプ）を飛ばしていたらここで戻る**

`git diff help.html` を読み、他人のハンクが無ければ Task 3 を実施してコミットする。まだ残っていれば、指揮官に「help.html は他の担当者の作業中なので未実施」と報告する。

- [ ] **Step 4: 保留したファイルがあれば報告する**

`git status --porcelain` を読み、この計画で触ったファイル（`courts.js` `test.html` `desk-players.js` `desk.css` `admin.css` `style.css` `help.html`）のうち未コミットのものを挙げ、その理由（他人の未コミット変更と同居）を指揮官に報告する。
