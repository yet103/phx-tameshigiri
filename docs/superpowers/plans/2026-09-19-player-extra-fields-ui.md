# 選手の追加項目（ゼッケン・級位段位・真剣レンタル）画面側 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書「選手の追加項目: ゼッケン番号・級位段位・真剣レンタル（形マスタの「抜刀後の形」）」のうち、**画面側のトラック C・D・E** を実装する。形マスタに「抜刀後」のチェック、基本情報に必須の設定、PC とスマホの選手登録に ゼッケン・級位段位・レンタルの入力、レンタルの選手に抜刀後の形だけを出す絞り込み、「試合開始」で未入力と不正な技を止める判定、採点画面のゼッケン表示、ヘルプ。

**Architecture:** 判定と解析は DOM を持たない純粋関数（`courts.js`）に置き、`test.html` で固定する。この計画が呼ぶ純粋関数はほぼすべて**トラック B が先に作る**（`techniqueOptions` の第 3 引数、`isDrawnTechnique`、`startBlockers`、`blockerMessage`、`parsePasteRows` の列）。この計画で `courts.js` に足すのは **`sortBy` の `bib`** の 1 か所だけ（PC 選手表の「ゼッケン」列を並べ替えられるようにするため）。画面は「サーバーが持つ規則をクライアントで先に見せる」役で、保存そのものはトラック A のサーバーが検証する。

**Tech Stack:** 素の JavaScript（IIFE、`var` と `function`。`const` `let` `=>` は使わない。`async`/`await` は可）、CSS は `theme.css` の変数だけ、`test.html`（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は `JSON.stringify` 比較）。

設計書: `docs/superpowers/specs/2026-09-19-player-extra-fields-design.md`（「画面」「純粋関数」「API」「手動確認」）
前提となる設計書: `docs/superpowers/specs/2026-09-19-ux-feedback-round2-design.md`（技の選択肢を性別で絞る仕組み。`techniqueOptions` / `resolveTechnique` / `withCurrentTechniques`）
書き方の見本・`desk-players.js` の構造: `docs/superpowers/plans/2026-09-19-desk-players-filter-and-paste.md`（実装済み）

**この計画で扱わないもの**: トラック **A**（`server/index.js` と `api.js`）とトラック **B**（`courts.js` の純粋関数）。**別の担当者 2 人が同じ作業ツリーで並行して実装中**なので、`server/` と `api.js` には**一切触らない**。`courts.js` も Task 4 の `sortBy` の 1 か所以外は触らない。

---

## ⚠ 最初に読むこと

- **この計画に貼ったコード断片は「いつの時点かのスナップショット」です。いまのファイルの内容を正とします。**
  置き換え前のコードを貼った箇所は、**編集の直前に必ずそのファイルを読み直して**ください。別の担当者が同じ行を書き換えていることがあります。一致しなければ、**この計画の断片ではなく、いまのファイルに合わせて**当てること。趣旨（何を足すか・何を消すか）はこの計画のとおりに保つ。
- **他人のファイルを巻き込まない。** `git add` は各タスクで明示したファイルだけ。`git checkout` `git stash` `git clean` `git reset --hard` は**絶対に使わない**（他の担当者の未コミットの作業を消します）。

---

## 前提・共通の手順

### トラック A・B が先（この計画の前提条件）

この計画のタスクは、**A と B がコミット済みであること**を前提にします。始める前に確かめること:

```bash
git log --oneline -20
git status --porcelain
grep -n "requireBib" server/index.js
grep -n "isDrawnTechnique" courts.js
grep -n "startBlockers" courts.js
grep -n "blockerMessage" courts.js
grep -n "function techniqueOptions" courts.js
```

- **A（サーバーと `api.js`）**: `requireBib` が `server/index.js` に当たること。当たらなければ A の担当者を待つ（この計画の保存はすべて 400 で落ちます）。
- **B（`courts.js` の純粋関数）**: `isDrawnTechnique` `startBlockers` `blockerMessage` が当たり、`techniqueOptions` が第 3 引数 `rental` を取っていること。当たらなければ B の担当者を待つ。

**A・B のタスクはこの計画には含めません。**

### B の署名（この計画が呼ぶもの）

設計書「純粋関数」の節で固定されている形です。**実装の直前に `courts.js` を読んで実物と突き合わせること**（特に `parsePasteRows` の行が持つキー名）。

```javascript
Courts.techniqueOptions(techniques, isFemale, rental)
//   → [{ name, strikes }]  rental が true なら drawn の技だけ。性別の絞り込みと AND
Courts.isDrawnTechnique(techniques, name, isFemale)
//   → boolean  resolveTechnique で解決した技の drawn（解決できなければ false）
Courts.startBlockers(event, players)
//   → [{ kind: 'bib' | 'rank' | 'rental', players: [player, …] }]  空配列なら試合を開始できる
//     bib   : event.settings.requireBib かつ 一巡目の行で bib が未設定
//     rank  : event.settings.requireRank かつ 一巡目の行で rank が空
//     rental: p.rental かつ tech1〜3 に drawn でない技がある
Courts.blockerMessage(blockers)
//   → string  「ゼッケン番号が未入力: 3 名（山田 太郎、…）」を改行で連ねた alert 用の文言
Courts.parsePasteRows(text, techniques, defaults)
//   → { headerSkipped, rows: [{ line, name, court, isFemale, isNewFace, techs, badTechs,
//                               courtFilled, bib, rank, rental, ok, error }] }
//     列は 名前, コート, 性別, 新人, 技1, 技2, 技3, ゼッケン, 級位段位, レンタル
```

`Api`（A が用意済み・呼び出し側の変更は不要）:

- `Api.createPlayer(eventId, { …, bib, rank, rental })` → 409 は `{ player: null, reason: 'bib', error: 'ゼッケン番号 12 は「山田 太郎」が使っています' }`
- `Api.updatePlayerInfo(eventId, playerId, { bib })` → 409 は `{ ok: false, status: 409, reason: 'bib', error: <同じ文言> }`。`bib: null` で未設定に戻せる
- `Api.updateEventInfo(eventId, { name, date, venue, settings: { requireBib, requireRank } })`
- `Api.createPlayersBulk(eventId, { rows: [{ …, bib, rank, rental }] })` → 400 は `{ error: '3 行目: …' }`

### 並行作業の状況（作業開始時点）

同じ作業ツリー（ブランチ `feature/player-extra-fields`）で、**トラック A と B の担当者が同時に作業しています**。さらに C・D・E も並行できます（下の「タスクの順序」）。ファイルの持ち主:

| ファイル | 持ち主 | この計画での扱い |
|---|---|---|
| `server/index.js` `api.js` | A | **触らない** |
| `courts.js` | B | **Task 4 の `sortBy` の 1 か所だけ**。ほかは読むだけ |
| `test.html` | A・B・D | **Task 4 の 1 か所だけ**（`sortBy` の節の末尾） |
| `techedit.js` `techniques.html` `desk-setup.js` | **C** | Task 1・2 |
| `desk-players.js` `desk-match.js` `desk.js` `admin-round.js` `desk.css` | **D** | Task 4〜11 |
| `admin-players.js` `app.js` `scoring.html` `style.css` `help.html` | **E** | Task 12〜17 |

- **`desk.css` は C と D が触りうるので D に寄せます。C は `desk.css` を一切触らない**（Task 1 の「抜刀後」列は既存の `.tech-table` の規則で足りる。Task 2 のチェックは既存の `.desk-check` を使う）。
- **`help.html` は E だけ**が触る（Task 16）。
- `admin.css` は**触らない**（下の「設計書との差分」3 を見ること）。

### コミットの手順（毎回これを守る）

1. `git status --porcelain` と `git diff <そのファイル>` を読む
2. そのファイルの差分が**自分の変更だけ**なら `git add <ファイル>` して commit
3. **他人のハンクが混ざっていたら、そのファイルはコミットしない。** 指揮官に「◯◯ に他人の未コミット変更があるので保留した」と報告し、指示を仰ぐ
4. `.git/index.lock` があれば数秒待って再試行する

コミットメッセージは**日本語**。接頭辞は `feat:` `fix:` `refactor:` `style:` `test:` `docs:`。末尾に必ず次の 1 行を付ける:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

### サーバーとテスト

- **サーバーの起動**: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。`.claude/launch.json` の `dev-3461` が同じ構成。既に起動していれば再利用する。**A がサーバーを直しているので、A のコミットを取り込んだら必ず再起動する**
- **自動テスト**: `http://localhost:3461/test.html` をブラウザで開き、ページ末尾の `Result: N passed, 0 failed` を見る。**再確認は同じ URL への再 navigate ではなく `location.reload()` か新しいタブで行う**（bfcache で古い JS が使われて、直したはずのテストが落ちたままに見える）
- **作業を始める前に、いまの `N` を控えること。** 設計書の見込みは 903 だが、A・B が先に入るので増えている。以降の「Expected」はこの控えた数を基準に書く
- **画面確認**: `http://localhost:3461/desk.html`（PC 運営。ウィンドウ幅 **1280px**）、`http://localhost:3461/admin.html`（スマホ運営。幅 **375px**）、`http://localhost:3461/scoring.html`（採点画面。幅 **1024px**）、`http://localhost:3461/techniques.html`（技術リスト編集。**1280px と 375px の両方**）、`http://localhost:3461/help.html`
- 確認に使う大会は**自分がこの作業中に作った大会だけ**。**本物の大会「第10回全日本試し斬り大会」のデータには絶対に触らない**（状態を進めない・選手を消さない）
- ライト／ダークの切り替えは各画面の 🌙 ボタン（PC 運営は左下、採点画面は下部のツールバー）

### この計画の確認用の大会の作り方（各トラックで 1 つ作る）

1. `desk.html` → 「大会」→「＋ 新しい大会」で `UI確認-C`（C）/ `UI確認-D`（D）/ `UI確認-E`（E）を作る
2. 「技と配点」で `破図味(男)` と `破図味(女)` の「抜刀後」にチェックを入れて保存する（Task 1 の完了後。それ以前は `techniques.html` でも同じことができる）
3. 「選手登録」で A コートに男子 3 名・女子 2 名を登録する

### コードの作法

- IIFE、`var` と `function`（`const` `let` `=>` は使わない）。`async`/`await` は可
- `await` の直後は必ず `ctx.isStale()` を見て、古ければ DOM に触らない・`alert` も出さない。ダイアログの中で `await` をまたぐときは `Desk.currentEventId() !== eventId` も見る
- 状態の判定を直書きしない（`event.status === 'final'` と書かず `EventStatus.of` / `EventStatus.isLocked` を使う）
- **`desk.css` は `theme.css` の変数だけを使う**。赤い文字・赤い枠は `--btn-fail`（#b3261e 固定）ではなく `--cell-fail-text`（ダークでも読める）
- 既存コメントの調子を保つ（「なぜそうしたか」「どの落とし穴を避けたか」を日本語で書く）

---

## 設計書との差分（この計画での決定）

実装の都合で設計書の文言をそのままにできない点が 4 つある。**この計画のとおりに作ること。**

1. **PC 選手表の新しい 3 列は「名前」の右にまとめて置く。** 設計書は「名前の右に『ゼッケン』…『級位段位』…『レンタル』」と書いている。3 つとも名前の右に **ゼッケン → 級位段位 → レンタル** の順で置き、コート・性別・新人はその右へずらす。選手の属性が 1 か所に並び、`col-name` の sticky（`left: 0`）にも影響しない。
2. **ゼッケンの並べ替えには `Courts.sortBy` の `key: 'bib'` を足す（Task 4）。** いまの `sortBy` は `'order' | 'name' | 'score'` しか知らない。設計書が「ゼッケンは並べ替え可」と書いているので、`courts.js` に 1 か所だけ足して `test.html` で固定する。**`courts.js` はトラック B の担当ファイルなので、編集の直前に必ず読み直すこと。**
3. **`admin.css` は変更しない。** スマホの選手表に足すゼッケン列は、既存の `.players-table th/td`（中央揃え・高さ 44px・nowrap）と `.players-table td.muted`（未設定の `—`）だけで足りる。設計書はトラック E のファイルに `admin.css` を挙げているが、足す規則が無い。
4. **スマホの追加フォームの「保存して次を追加」で消すのは 名前・ゼッケン・級位段位・技。** レンタルはコート・性別・新人と同じ「その場で続く印」として残す。ゼッケンは大会内で重複できないので必ず消す。
5. **スマホの二巡目の技ピッカー（`admin-round.js`）も `rental` で絞る（Task 10）。** 設計書の「画面」は PC の二巡目（`desk-match.js`）しか書いていないが、同じ規則を同じ画面の役割で持たせないと、スマホから二巡目の技を入れたときだけレンタルの選手に抜刀前の形を入れられてしまう。`admin-round.js` は Task 10 で開くので、そこで一緒に直す。

---

## ファイル構成

- **Modify**: `techedit.js` — 表の見出しと行に「抜刀後」のチェック、`collectTechs` が `drawn` を返す（Task 1）
- **Modify**: `techniques.html` — `<style>` に「抜刀後」列の幅（Task 1。**ここだけ**）
- **Modify**: `desk-setup.js` — 必須の設定のチェック 2 つと `updateEventInfo` の `settings`（Task 2）
- **Modify**: `courts.js` — `sortBy` の `key: 'bib'`（Task 4。**ここだけ**）
- **Modify**: `test.html` — `sortBy` の節に 3 件（Task 4。**ここだけ**）
- **Modify**: `desk.css` — 新しい 3 列の幅と表の `width` の合計、赤枠、件数の帯（Task 5）
- **Modify**: `desk-players.js` — 3 列のセル・`adopt`・`bib` の 409・レンタル切替での技セレクトの作り直し・下書き行（Task 6）、赤枠と件数（Task 7）、貼り付けダイアログ（Task 8）
- **Modify**: `desk-match.js` — コート別カードの「真剣レンタル n 名」、二巡目のセレクトの `rental` 絞り込み（Task 9）
- **Modify**: `desk.js` — `applyStatus` の `draft → round1` の前に `startBlockers`（Task 10）
- **Modify**: `admin-round.js` — `applyStatus` の同じ判定と、二巡目の技ピッカーの `rental` 絞り込み（Task 10）
- **Modify**: `admin-players.js` — 追加・編集フォームの 3 項目、`TechPicker` の `rental` 絞り込み、`bib` の 409（Task 12・13）、表のゼッケン列（Task 14）
- **Modify**: `app.js` — 順番ラベルの `No.12`、下部の選手一覧のゼッケン列（Task 15）
- **Modify**: `scoring.html` — 選手一覧の見出しに「ゼッケン」（Task 15）
- **Modify**: `style.css` — `.player-list-table` の未設定セル（Task 15。**ここだけ**）
- **Modify**: `help.html` — 「選手を登録する」「技の配点を変える」「当日の流れ」（Task 16）

**触らない**: `server/` `api.js` `data.js` `storage.js` `status.js` `techpicker.js` `admin.css` `admin.html` `desk.html` `desk-events.js` `desk-results.js` `desk-techniques.js` `admin.js` `admin-events.js` `admin-results.js` `board.*` `present.*` `share.*` `ranking.html` `theme.css`。新しいファイルは作らない（静的配信の許可リストの変更は不要）。

---

## タスクの順序

```
トラック C:  Task 1 → Task 2 → Task 3（通しの確認）
トラック D:  Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11（通しの確認）
トラック E:  Task 12 → Task 13 → Task 14 → Task 15 → Task 16 → Task 17（通しの確認）
```

- **C・D・E の 3 本は同時に走らせてよい**（触るファイルが重ならない）。C と D の間の `desk.css`、E だけの `help.html` は上の表のとおり分けてある
- トラックの中は**順番どおり**。特に Task 4（`sortBy`）→ Task 5（`desk.css`）→ Task 6（`desk-players.js`）には依存がある
- Task 9・10 は D のトラックだが触るファイルが違うので、Task 6〜8 を待たずに始めてもよい（Task 11 の通し確認は全部が入ってから）
- Task 1（形マスタの「抜刀後」）が入るまで、D と E は「レンタルの選手の技が絞られること」を目で確かめられない。その確認は Task 11 / Task 17 に置いてある

---

### Task 1（C）: 形マスタに「抜刀後」のチェック列を足す

技リストの表（`techedit.js`）は `techniques.html`（技術リスト編集）と PC 運営の「技と配点」の区画（`desk-techniques.js`）から同じコードで使われる。配点 4 列の右に「抜刀後」のチェック列を足し、保存時に `drawn` を送る。見出しには `title` で「レンタルの選手が選べる形」と添える（狭い幅でも列の意味が分かるように）。

**Files:**
- Modify: `techedit.js`（`mount` の `table.innerHTML`、`renderTable`、`collectTechs`、`tbody` のイベント）
- Modify: `techniques.html`（`<head>` の `<style>`。**ここだけ**）

- [ ] **Step 1: 見出しに「抜刀後」を足す**

`techedit.js` の `table.innerHTML =` の行。置き換え前:

```js
    table.innerHTML =
      '<thead><tr><th>技名</th><th>初太刀</th><th>二ノ太刀</th><th>三ノ太刀</th><th>四ノ太刀</th></tr></thead>' +
      '<tbody></tbody>';
```

置き換え後:

```js
    // 「抜刀後」＝ 抜刀してからの形。真剣レンタルの選手はこの形しか選べない
    // （設計書「選手の追加項目」の決定事項）。見出しだけでは意味が伝わらないので
    // title を添える（スマホ幅では見出しを 12px に詰めるため、文字は増やさない）。
    table.innerHTML =
      '<thead><tr><th>技名</th><th>初太刀</th><th>二ノ太刀</th><th>三ノ太刀</th><th>四ノ太刀</th>' +
      '<th title="レンタルの選手が選べる形">抜刀後</th></tr></thead>' +
      '<tbody></tbody>';
```

- [ ] **Step 2: 行にチェックを足す**

`renderTable` の中の `tr.innerHTML =` の式。置き換え前:

```js
        tr.innerHTML =
          '<td><input type="text" value="' + Storage.esc(t.name) + '" data-field="name" data-idx="' + i + '"></td>' +
          [0,1,2,3].map(function(s) {
            var v = (t.strikes[s] !== null && t.strikes[s] !== undefined) ? Storage.esc(String(t.strikes[s])) : '';
            return '<td><input type="number" min="0" max="99" value="' + v +
              '" data-field="strike" data-idx="' + i + '" data-strike="' + s + '"></td>';
          }).join('');
```

置き換え後（末尾に 1 セル足すだけ）:

```js
        tr.innerHTML =
          '<td><input type="text" value="' + Storage.esc(t.name) + '" data-field="name" data-idx="' + i + '"></td>' +
          [0,1,2,3].map(function(s) {
            var v = (t.strikes[s] !== null && t.strikes[s] !== undefined) ? Storage.esc(String(t.strikes[s])) : '';
            return '<td><input type="number" min="0" max="99" value="' + v +
              '" data-field="strike" data-idx="' + i + '" data-strike="' + s + '"></td>';
          }).join('') +
          // drawn を持たない古い技リスト（data.js の既定値も持たない）は未チェックで出す
          '<td><input type="checkbox" data-field="drawn" data-idx="' + i + '"' +
          (t.drawn === true ? ' checked' : '') + '></td>';
```

- [ ] **Step 3: チェックの入り切りも「触った」と数える**

`tbody.addEventListener('input', function() { dirty = true; });` の行の**直後**に足す。

```js
    // チェックボックスは環境によって input が来ないことがあるので change も見る
    // （dirty が立たないと、対象を切り替えるときの「破棄しますか？」が出なくなる）。
    tbody.addEventListener('change', function() { dirty = true; });
```

- [ ] **Step 4: `collectTechs` が `drawn` を返すようにする**

`collectTechs` の `techs.push(...)` の行。置き換え前:

```js
        techs.push({ name: name, strikes: strikes });
```

置き換え後:

```js
        var drawnEl = tr.querySelector('[data-field="drawn"]');
        techs.push({ name: name, strikes: strikes, drawn: !!(drawnEl && drawnEl.checked) });
```

- [ ] **Step 5: `techniques.html` の `<style>` に列幅を足す**

`techniques.html` の `<style>` の中、`.tech-sheet-item { … }` の**直後**（`</style>` の直前）に足す。

```css
    /* 「抜刀後」列（techedit.js）。style.css の .tech-table より後に読まれるので、
       同じ詳細度でもこちらが勝つ。375px では配点の入力を少し詰めて、
       6 列目まで .tech-scroll の横スクロールなしで見せる。 */
    .tech-table th:last-child, .tech-table td:last-child { width: 56px; }
    .tech-table input[type="checkbox"] { width: 20px; height: 20px; margin: 0; }
    @media (max-width: 767px) {
      .tech-table input[type="number"] { width: 38px; }
      .tech-table th:last-child, .tech-table td:last-child { width: 44px; }
    }
```

- [ ] **Step 6: ブラウザで確かめる**

サーバーを起動し、`http://localhost:3461/techniques.html` を**新しいタブ**で開く。

- [ ] 幅 1280px で、表の右端に **抜刀後** の列とチェックが並ぶ。見出しにマウスを載せると「レンタルの選手が選べる形」が出る
- [ ] `破図味(男)` と `破図味(女)` にチェックを入れて **保存** を押す → `保存しました。` が出る
- [ ] ページを再読み込みしても 2 行のチェックが残っている（サーバーに `drawn` が保存された）
- [ ] 上の「編集する対象」で**雛形**に切り替え、チェックを入れて保存 → 再読み込みで残る
- [ ] チェックだけを入れ替えて対象を切り替えると「編集中の内容は保存されていません。破棄して切り替えますか？」が出る（Step 3 の `change`）
- [ ] 幅 **375px** にして、技名〜抜刀後まで横スクロールなしで見える（見えなければ `.tech-scroll` の中で横に流れる。行が崩れていないこと）
- [ ] `http://localhost:3461/desk.html` → 大会を選び「技と配点」の区画でも同じ列が出る。**最終結果を確定した大会**を開くと、チェックも他の入力と同じく無効（グレー）になっている
- [ ] ダーク（左下の 🌙）でもチェックが見える

- [ ] **Step 7: コミット**

```bash
git status --porcelain
git diff techedit.js techniques.html
git add techedit.js techniques.html
git commit -m "$(cat <<'EOF'
feat: 形マスタに「抜刀後」のチェック列を足す

レンタルの選手が選べる形（抜刀してからの形）を運営者が形マスタで
指定できるようにする。保存時に drawn を送る。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2（C）: 基本情報に「必須にする」チェック 2 つを足す

`desk-setup.js` の基本情報のフォームに「ゼッケン番号を必須にする」「級位・段位を必須にする」を足す。保存は `Api.updateEventInfo` に `settings` を含める。確定済み（ロック中）は無効。**登録は空でも通す**（止まるのは「試合開始」だけ）ことを注記で書く。

**Files:**
- Modify: `desk-setup.js`（先頭のコメント、`addField` の隣に `addCheck`、`render` のフォーム、保存ハンドラ）

- [ ] **Step 1: 先頭のコメントを直す**

`desk-setup.js` の冒頭のコメントの 3 行目。置き換え前:

```js
// 保存は PATCH /api/events/:id（Api.updateEventInfo）で名前・日付・会場だけを送る。
```

置き換え後:

```js
// 保存は PATCH /api/events/:id（Api.updateEventInfo）で名前・日付・会場と
// settings（ゼッケン・級位段位を必須にするか）だけを送る。
```

- [ ] **Step 2: `addCheck` を足す**

`addField` 関数の**直後**（`function cell(text, cls) {` の直前）に足す。

```js
  // 必須の設定のチェック 1 行。.desk-check は desk.css にある既存のクラスで、
  // .desk-form のグリッドの 1 行を丸ごと使う（desk-events.js のコピーの
  // ダイアログと同じ作り）。desk.css は別の担当者のファイルなので触らない。
  function addCheck(form, labelText, checked) {
    var label = document.createElement('label');
    label.className = 'desk-check';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked === true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(' ' + labelText));
    form.appendChild(label);
    return input;
  }
```

- [ ] **Step 3: フォームにチェックと注記を足す**

`render` の中。置き換え前:

```js
    inName.value = ctx.event.name || '';
    inDate.value = ctx.event.date || '';
    inVenue.value = ctx.event.venue || '';

    var actions = document.createElement('div');
```

置き換え後:

```js
    inName.value = ctx.event.name || '';
    inDate.value = ctx.event.date || '';
    inVenue.value = ctx.event.venue || '';

    // 必須の設定（大会の settings。無ければ両方 false）。
    // 「必須」でも登録そのものは空で通す。止まるのは「試合開始」のときだけで、
    // 判定は Courts.startBlockers（PC は desk.js、スマホは admin-round.js）。
    var settings = ctx.event.settings || {};
    var chkBib = addCheck(form, 'ゼッケン番号を必須にする', settings.requireBib === true);
    var chkRank = addCheck(form, '級位・段位を必須にする', settings.requireRank === true);

    var actions = document.createElement('div');
```

そして `container.appendChild(form);` の**直後**に注記を足す。置き換え前:

```js
    form.appendChild(actions);
    container.appendChild(form);

    if (locked) {
```

置き換え後:

```js
    form.appendChild(actions);
    container.appendChild(form);

    var reqNote = document.createElement('p');
    reqNote.className = 'desk-note';
    reqNote.textContent =
      'チェックを入れても、選手の登録は空のままできます。' +
      '一巡目にその項目が空の選手がいる間だけ「試合開始」で止まり、人数と名前が出ます。';
    container.appendChild(reqNote);

    if (locked) {
```

- [ ] **Step 4: ロック中は無効にする**

置き換え前:

```js
    if (locked) {
      inName.disabled = true;
      inDate.disabled = true;
      inVenue.disabled = true;
      btnSave.disabled = true;
    }
```

置き換え後:

```js
    if (locked) {
      inName.disabled = true;
      inDate.disabled = true;
      inVenue.disabled = true;
      chkBib.disabled = true;
      chkRank.disabled = true;
      btnSave.disabled = true;
    }
```

- [ ] **Step 5: 保存に `settings` を含める**

`btnSave` のハンドラ。置き換え前:

```js
      var result = await Api.updateEventInfo(ctx.eventId, {
        name: name, date: inDate.value, venue: inVenue.value.trim()
      });
```

置き換え後:

```js
      var result = await Api.updateEventInfo(ctx.eventId, {
        name: name, date: inDate.value, venue: inVenue.value.trim(),
        // settings はサーバーが requireBib / requireRank の真偽値だけを拾う
        // （他のキーは無視される）。毎回 2 つとも送るので、外したときも保存される。
        settings: { requireBib: chkBib.checked, requireRank: chkRank.checked }
      });
```

- [ ] **Step 6: ブラウザで確かめる**

`http://localhost:3461/desk.html` を**新しいタブ**で開き、確認用の大会の「基本情報」を開く。

- [ ] 大会名・日付・会場の下に **ゼッケン番号を必須にする** と **級位・段位を必須にする** が 1 行ずつ並ぶ。チェックが横に間延びしていない（間延びしていたら `desk.css` は Task 5 の担当なので、指揮官に報告して `.desk-check input { width: auto; flex: 0 0 auto; }` を D に足してもらう）
- [ ] 下に「チェックを入れても、選手の登録は空のままできます。…」の注記が出る
- [ ] 両方にチェックして **保存** → `基本情報を保存しました` のトースト。別の区画へ移って戻ると、チェックが残っている
- [ ] 片方だけ外して保存 → 戻るとその片方だけ外れている（`false` も保存される）
- [ ] 上部の段階で**最終結果を確定**した大会を開くと、2 つのチェックも保存ボタンも無効（グレー）
- [ ] 幅 1280px とダークで崩れない

- [ ] **Step 7: コミット**

```bash
git status --porcelain
git diff desk-setup.js
git add desk-setup.js
git commit -m "$(cat <<'EOF'
feat: 基本情報にゼッケン・級位段位を必須にする設定を足す

大会の settings（requireBib / requireRank）を基本情報から編集できる
ようにする。登録は空でも通し、試合開始で止める方針は注記で示す。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3（C）: トラック C の通しの確認

**Files:** なし（確認だけ。直すところが見つかったら Task 1・2 のファイルだけを直して追加でコミットする）

- [ ] **Step 1: 自動テスト**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`（N は作業開始時に控えた数。C は純粋関数を足さないので増えない）

- [ ] **Step 2: 設計書の「手動確認」のうち C のぶんを通す**

- [ ] `techniques.html` で `破図味(男)` `破図味(女)` に「抜刀後」を付けて保存 → 再読み込みで残る
- [ ] PC 運営の「技と配点」でも同じチェックが出て、保存できる
- [ ] 「別の大会からコピー」で別の大会の技リストを読み込むと、チェックの状態も一緒に入れ替わる（保存するまで反映されないこと）
- [ ] 「雛形に戻す」を押すと雛形のチェックの状態になる
- [ ] 基本情報で 2 つのチェックを入れて保存 → 大会を切り替えて戻っても残る
- [ ] 375px の `techniques.html` と 1280px の PC 運営の両方で崩れない。ライト／ダークの両方

- [ ] **Step 3: 保留したファイルがあれば報告する**

他人のハンクが混ざってコミットできなかったファイルがあれば、指揮官に報告する。

---

### Task 4（D）: `Courts.sortBy` にゼッケンの並べ替えを足す

PC 選手表の「ゼッケン」列を見出しから並べ替えられるようにする。いまの `sortBy` は `'order' | 'name' | 'score'` しか知らない。**未設定（`bib` が数値でない）は昇順で末尾**に寄せる（`bib` は 1〜9999 なので 10000 を番人にする。`Infinity` を使うと `Infinity - Infinity` が `NaN` になり比較関数が壊れる）。

**⚠ `courts.js` はトラック B の担当ファイル。編集の直前に必ず読み直し、`sortBy` のまわりに B の変更が入っていないか確かめること。**

**Files:**
- Modify: `courts.js`（`sortBy` と、その直前に `bibValue`）
- Modify: `test.html`（`sortBy: 元配列を変えない` の assert の直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の

```js
    assert('sortBy: 元配列を変えない', ordersOf(sPlayers), ['A-男子-1-10', 'A-男子-1-2', 'B-男子-1-1']);
```

の**直後**（`// ---- 試合の区画（PC 運営 #match）の集計 ----` のコメントの直前）に足す。

```js

    // ---- ゼッケンの並べ替え（PC 選手表の「ゼッケン」列。未設定は昇順で末尾） ----
    var bibPlayers = [
      { id: 'a', order: 'A-男子-1-1', name: 'あ', bib: 12 },
      { id: 'b', order: 'A-男子-1-2', name: 'い' },
      { id: 'c', order: 'A-男子-1-3', name: 'う', bib: 3 },
      { id: 'd', order: 'A-男子-1-4', name: 'え', bib: null }
    ];
    function bibIds(s) { return Courts.sortBy(bibPlayers, s).map(function(p) { return p.id; }); }

    assert('sortBy: bib 昇順は小さい順・未設定は末尾（未設定同士は order 昇順）',
      bibIds({ key: 'bib', dir: 'asc' }), ['c', 'a', 'b', 'd']);
    assert('sortBy: bib 降順は大きい順・未設定は先頭（未設定同士は order 昇順のまま）',
      bibIds({ key: 'bib', dir: 'desc' }), ['b', 'd', 'a', 'c']);
    assert('sortBy: bib は元配列を変えない',
      bibPlayers.map(function(p) { return p.id; }), ['a', 'b', 'c', 'd']);
```

- [ ] **Step 2: テストが落ちるのを確かめる**

`http://localhost:3461/test.html` を**新しいタブ**で開く。
Expected: `sortBy: bib 昇順…` と `sortBy: bib 降順…` の 2 件が赤く落ちる（`key` を知らない `sortBy` は `compareOrder` に落ちるので `['a','b','c','d']` が返る）。`Result: N passed, 2 failed`

- [ ] **Step 3: `courts.js` を直す**

`sortBy` の直前（`// 並べ替えの既定値（= 従来の compareOrder 順）。` のコメントの**直前**）に足す。

```js
  // ゼッケンの並べ替え用の値。未設定（キーが無い・null・数値でない）は 10000 に寄せる。
  // bib は 1〜9999 なので、どの実在の値よりも大きい＝昇順で末尾に来る。
  // Infinity にすると Infinity - Infinity が NaN になり、比較関数が壊れる。
  function bibValue(p) {
    var v = p && p.bib;
    return (typeof v === 'number' && isFinite(v)) ? v : 10000;
  }

```

`sortBy` の中の `primary` を直す。置き換え前:

```js
    function primary(a, b) {
      if (s.key === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      if (s.key === 'score') return (Number(a.score) || 0) - (Number(b.score) || 0);
      return compareOrder(a, b);
    }
```

置き換え後:

```js
    function primary(a, b) {
      if (s.key === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      if (s.key === 'score') return (Number(a.score) || 0) - (Number(b.score) || 0);
      if (s.key === 'bib') return bibValue(a) - bibValue(b);
      return compareOrder(a, b);
    }
```

同じ関数の上のコメントも直す。置き換え前:

```js
  // 並べ替え。key は 'order' | 'name' | 'score'、dir は 'asc' | 'desc'。
```

置き換え後:

```js
  // 並べ替え。key は 'order' | 'name' | 'score' | 'bib'、dir は 'asc' | 'desc'。
```

- [ ] **Step 4: テストが通るのを確かめる**

`http://localhost:3461/test.html` を**新しいタブ**で開く（再 navigate ではなく）。
Expected: `Result: N+3 passed, 0 failed`

- [ ] **Step 5: コミット**

`courts.js` は B の担当ファイル。**`git diff courts.js` を読み、自分の `bibValue` と `primary` の 1 行以外のハンクが混ざっていないことを必ず確かめる。**

```bash
git status --porcelain
git diff courts.js test.html
git add courts.js test.html
git commit -m "$(cat <<'EOF'
feat: ゼッケン番号で並べ替えられるようにする

PC 選手表の「ゼッケン」列の見出しから並べ替えるため、Courts.sortBy に
key: 'bib' を足す。未設定は昇順で末尾（番人は 10000）。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5（D）: `desk.css` に新しい 3 列・赤枠・件数の帯を足す

PC 選手表に足す 3 列（ゼッケン・級位段位・レンタル）の幅と、表の `width` の合計を直す。`table-layout: fixed` の表は「列幅の合計」を `width` に持たせないと横スクロールが起きない（既存のコメントのとおり）。あわせて、Task 6・7 で使う赤枠と件数の帯の見た目を用意する。

**Files:**
- Modify: `desk.css`（`.desk-players-table` の幅のコメントと `width`、列幅の並び、セルの入力の節の末尾、`.desk-players-count` の隣）

- [ ] **Step 1: 表の幅の合計を直す**

置き換え前（コメントの一部と `width`）:

```css
   列幅の合計（40+52+190+96+84+52+132*3+64+48 = 1022px）を表の width にして
   初めて、狭いときに表の枠だけが横スクロールし、sticky の名前列が効くように
   なる。border-collapse: collapse は既定の border-spacing（列の間の隙間）を
   消して幅の計算を列幅の合計どおりにする。 */
.desk-players-table { table-layout: fixed; width: 1022px; border-collapse: collapse; }
```

置き換え後:

```css
   列幅の合計（40+52+190+78+110+68+96+84+52+132*3+64+48 = 1278px）を表の width に
   して初めて、狭いときに表の枠だけが横スクロールし、sticky の名前列が効くように
   なる。border-collapse: collapse は既定の border-spacing（列の間の隙間）を
   消して幅の計算を列幅の合計どおりにする。
   列を足したら必ずこの合計も直すこと（合わないと列がじわじわずれる）。 */
.desk-players-table { table-layout: fixed; width: 1278px; border-collapse: collapse; }
```

- [ ] **Step 2: 列幅を足す**

置き換え前:

```css
.desk-players-table .col-name { width: 190px; }
.desk-players-table .col-court { width: 96px; }
```

置き換え後:

```css
.desk-players-table .col-name { width: 190px; }
/* 選手の追加項目（ゼッケン・級位段位・真剣レンタル）。名前のすぐ右にまとめる。 */
.desk-players-table .col-bib { width: 78px; }
.desk-players-table .col-rank { width: 110px; }
.desk-players-table .col-rental { width: 68px; text-align: center; }
.desk-players-table .col-court { width: 96px; }
```

- [ ] **Step 3: 赤枠を足す**

`.desk-cell-check { display: block; margin: 0 auto; width: 16px; height: 16px; }` の**直後**に足す。

```css
/* 必須なのに空のセル（点線）と、レンタルの選手が選べない形が入っているセル（実線＋赤字）。
   --btn-fail（#b3261e 固定）はダークで読みにくいので --cell-fail-text を使う
   （.desk-paste-bad や .desk-match-count と同じ変数）。ふだんの枠は透明なので、
   触っていなくても赤枠だけは見える。 */
.desk-cell-input.desk-cell-required, .desk-cell-select.desk-cell-required {
  border-color: var(--cell-fail-text); border-style: dashed;
}
.desk-cell-input.desk-cell-bad, .desk-cell-select.desk-cell-bad {
  border-color: var(--cell-fail-text); color: var(--cell-fail-text); font-weight: bold;
}
```

- [ ] **Step 4: 件数の帯を足す**

`.desk-players-count { font-size: 13px; color: var(--text-muted); }` の**直後**に足す。

```css
/* 表の上の「ゼッケン未入力 n　級位段位未入力 n　レンタル不可の形 n」。
   0 件の種類は出さないので、この帯が出ていること自体が「試合開始で止まる」印になる。 */
.desk-players-blockers { font-size: 13px; color: var(--cell-fail-text); font-weight: bold; }
```

- [ ] **Step 5: ブラウザで確かめる**

`http://localhost:3461/desk.html` の確認用の大会 → 「選手登録」。**この時点ではまだ 3 列は無いので、壊れていないことだけを見る。**

- [ ] 幅 1280px で表がこれまでどおり並ぶ（列がずれていない）。窓を 900px に狭めると表の枠だけが横スクロールし、名前の列が左に残る
- [ ] ライト／ダークの両方で見出しと行の色が変わっていない

- [ ] **Step 6: コミット**

```bash
git status --porcelain
git diff desk.css
git add desk.css
git commit -m "$(cat <<'EOF'
style: PC 選手表に追加項目の 3 列と赤枠・件数の帯の CSS を用意する

ゼッケン・級位段位・レンタルの列幅を足し、table-layout: fixed が要る
width の合計を 1278px に直す。必須未入力とレンタル不可の形の赤枠も足す。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6（D）: PC 選手表に ゼッケン・級位段位・レンタルの列を足す

`desk-players.js` の表に 3 列を足し、セルごとに保存する。技の候補を `rental` でも絞り、レンタルを切り替えたらその行の技セレクトを作り直す。必須未入力とレンタル不可の形のセルに赤枠を付ける。`bib` の 409 はサーバーの文言をそのまま出す。「＋ 行を追加」の下書き行も同じ 3 項目を持つ。

**Files:**
- Modify: `desk-players.js`（先頭のコメント、`COLUMNS`、`render`、`adopt`、`saveCell`、`buildRow`、`techCell`、`draftSeed`、`buildDraftRow`。新しく `RANKS` / `buildRankList` / `bibCell` / `rankCell` / `rentalCell` / `markRow` / `setMark` / `afterRowEdit`）

- [ ] **Step 1: 列と級位段位の候補を足す**

`COLUMNS` の定義。置き換え前:

```js
  var COLUMNS = [
    { label: '巡', cls: 'col-round', filter: 'round' },
    { key: 'order', label: 'No.', cls: 'col-no' },
    { key: 'name', label: '名前', cls: 'col-name', filter: 'name' },
    { label: 'コート', cls: 'col-court', filter: 'court' },
```

置き換え後:

```js
  var COLUMNS = [
    { label: '巡', cls: 'col-round', filter: 'round' },
    { key: 'order', label: 'No.', cls: 'col-no' },
    { key: 'name', label: '名前', cls: 'col-name', filter: 'name' },
    // 選手の追加項目。名前のすぐ右にまとめる（col-name は sticky なので、
    // その右に足すぶんには左端の固定に影響しない）。
    { key: 'bib', label: 'ゼッケン', cls: 'col-bib' },
    { label: '級位段位', cls: 'col-rank' },
    { label: 'レンタル', cls: 'col-rental' },
    { label: 'コート', cls: 'col-court', filter: 'court' },
```

`newFilter` 関数の**直前**に足す。

```js
  // 級位・段位の候補（datalist）。自由入力も受けるので、この一覧は縛りではない。
  var RANKS = ['無級', '十級', '九級', '八級', '七級', '六級', '五級', '四級', '三級', '二級', '一級',
    '初段', '二段', '三段', '四段', '五段', '六段', '七段', '八段', '九段', '十段'];
  var RANK_LIST_ID = 'deskRankList';

  // 級位段位のセルが list= で参照する datalist。render のたびに作り直す
  // （render は container.innerHTML = '' で前のを捨てるので id は重複しない）。
  function buildRankList() {
    var dl = document.createElement('datalist');
    dl.id = RANK_LIST_ID;
    RANKS.forEach(function(r) {
      var o = document.createElement('option');
      o.value = r;
      dl.appendChild(o);
    });
    return dl;
  }

```

- [ ] **Step 2: `render` で datalist を置く**

`render` の中。置き換え前:

```js
    container.innerHTML = '';

    var head = document.createElement('div');
```

置き換え後:

```js
    container.innerHTML = '';
    container.appendChild(buildRankList());   // 級位段位のセルが参照する候補

    var head = document.createElement('div');
```

- [ ] **Step 3: `adopt` が 3 項目を取り込むようにする**

置き換え前:

```js
    if (typeof src.score === 'number') dst.score = src.score;
    dst.isFemale = src.isFemale === true;
    dst.isNewFace = src.isNewFace === true;
  }
```

置き換え後:

```js
    if (typeof src.score === 'number') dst.score = src.score;
    dst.isFemale = src.isFemale === true;
    dst.isNewFace = src.isNewFace === true;
    // 追加項目。サーバーは選手の全体を返すので、キーが無い＝未設定として揃える
    // （null / '' / false。この形は markRow と Courts.startBlockers が前提にしている）。
    dst.bib = (typeof src.bib === 'number') ? src.bib : null;
    dst.rank = (typeof src.rank === 'string') ? src.rank : '';
    dst.rental = src.rental === true;
  }
```

- [ ] **Step 4: `saveCell` が `bib` の 409 をそのまま出すようにする**

置き換え前:

```js
    if (!res || !res.ok) {
      revert();
      if (res && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      } else {
        alert('保存できませんでした。\n入力内容と通信を確認してください。');
      }
      return;
    }
```

置き換え後:

```js
    if (!res || !res.ok) {
      revert();
      if (res && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      } else if (res && res.reason === 'bib') {
        // 「ゼッケン番号 12 は「山田 太郎」が使っています」。誰と重なったかを
        // 知っているのはサーバーだけなので、文言をそのまま出す（セルは元に戻す）。
        alert(res.error);
      } else {
        alert('保存できませんでした。\n入力内容と通信を確認してください。');
      }
      return;
    }
```

- [ ] **Step 5: 赤枠を塗る関数を足す**

`nameCell` の**直前**に足す。

```js
  // --- 赤枠（必須未入力・レンタルが選べない形） ---
  // 判定は Courts.startBlockers と同じ規則にする（表の上の件数と食い違わせない）。
  //   ゼッケン・級位段位 … 大会の settings で必須にしていて、一巡目の行が空のとき
  //   技                 … レンタルの選手の tech1〜3 のうち、抜刀後の形でない技
  // 二巡目の行の必須は数えない（二巡目は一巡目の行から複製されるため）。
  function markRow(ctx, refs, p) {
    var settings = (ctx.event && ctx.event.settings) || {};
    var firstRound = Courts.roundOf(p) === 1;
    setMark(refs.bibInput, 'desk-cell-required',
      settings.requireBib === true && firstRound && typeof p.bib !== 'number');
    setMark(refs.rankInput, 'desk-cell-required',
      settings.requireRank === true && firstRound && !String(p.rank || '').trim());
    refs.techSelects.forEach(function(t) {
      var name = p['tech' + t.slot] || '';
      setMark(t.sel, 'desk-cell-bad',
        p.rental === true && !!name &&
        !Courts.isDrawnTechnique(ctx.techniques, name, !!p.isFemale));
    });
  }

  function setMark(el, cls, on) {
    if (el) el.classList.toggle(cls, on === true);
  }

  // セルを 1 つ保存できたあとに呼ぶ。行の赤枠を塗り直す
  // （Task 7 でここに表の上の件数の数え直しも足す）。
  function afterRowEdit(ctx, refs, p) {
    markRow(ctx, refs, p);
  }

```

- [ ] **Step 6: 3 つのセルを作る関数を足す**

`newFaceCell` の**直後**（`// 技の選択肢は…` のコメントの直前）に足す。

```js
  // ゼッケン番号。整数 1〜9999 か空（未設定）。空にすると bib: null を送って戻す。
  // 同じ大会での重複はサーバーが 409 で断り、saveCell がその文言をそのまま出す。
  function bibCell(ctx, p, locked, refs) {
    var td = document.createElement('td');
    td.className = 'col-bib';
    var input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '9999';
    input.step = '1';
    input.className = 'desk-cell-input';
    input.value = (typeof p.bib === 'number') ? String(p.bib) : '';
    input.setAttribute('aria-label', 'ゼッケン番号');
    input.disabled = locked;
    bindText(ctx, p, input, function(v) {
      if (v === '') return { bib: null };
      // type="number" でも貼り付けや IME で数字以外が残ることがあるので自分で見る
      if (!/^[0-9]+$/.test(v)) { alert('ゼッケン番号は 1〜9999 の整数で入力してください。'); return null; }
      var n = parseInt(v, 10);
      if (n < 1 || n > 9999) { alert('ゼッケン番号は 1〜9999 の整数で入力してください。'); return null; }
      return { bib: n };
    }, function() { afterRowEdit(ctx, refs, p); });
    td.appendChild(input);
    refs.bibInput = input;
    return td;
  }

  // 級位・段位。候補は datalist で出すが自由入力も受ける（20 文字まで）。
  function rankCell(ctx, p, locked, refs) {
    var td = document.createElement('td');
    td.className = 'col-rank';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'desk-cell-input';
    input.setAttribute('list', RANK_LIST_ID);
    input.value = (typeof p.rank === 'string') ? p.rank : '';
    input.setAttribute('aria-label', '級位・段位');
    input.disabled = locked;
    bindText(ctx, p, input, function(v) {
      if (v.length > 20) { alert('級位・段位は 20 文字までです。'); return null; }
      return { rank: v };
    }, function() { afterRowEdit(ctx, refs, p); });
    td.appendChild(input);
    refs.rankInput = input;
    return td;
  }

  // 真剣レンタル。切り替えると技の候補が変わる（抜刀後の形だけ／全部）ので、
  // 保存できたらその行の技セレクトを作り直す。性別・コートと違って order は
  // 変わらないので、表ごとの Desk.reloadEvent() は要らない（行だけで足りる）。
  function rentalCell(ctx, p, locked, refs) {
    var td = document.createElement('td');
    td.className = 'col-rental';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'desk-cell-check';
    chk.checked = p.rental === true;
    chk.setAttribute('aria-label', '真剣レンタル');
    chk.disabled = locked;
    bindChoice(ctx, p, chk, p.rental === true,
      function() { return chk.checked; },
      function(v) { return { rental: v }; },
      function(v) { chk.checked = v; },
      function() {
        refs.techSelects.forEach(function(t) { t.fill(); });
        afterRowEdit(ctx, refs, p);
      });
    td.appendChild(chk);
    return td;
  }

```

- [ ] **Step 7: `techCell` を作り直せるようにする**

`techCell` の上のコメントと関数を丸ごと置き換える。置き換え前:

```js
  // 技の選択肢は「その選手の性別で絞った技リスト」＋空（技を消せるように）。
  // 性別が変わって保存されると行ごと Desk.reloadEvent() で作り直されるので、
  // ここは呼ばれるたびに p.isFemale で絞り直せばよい（作り直しは呼び出し側任せ）。
  // 選手が持っている技がリストに無い場合（接尾辞付きの旧データ・技リストを
  // 入れ替えた後など）は、黙って空にしないよう、その名前も選択肢に足す。
  function techCell(ctx, p, locked, slot) {
    var td = document.createElement('td');
    td.className = 'col-tech';
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', '技' + slot);
    sel.disabled = locked;
    var cur = p['tech' + slot] || '';
    addOption(sel, '', '—');
    var found = false;
    Courts.techniqueOptions(ctx.techniques, !!p.isFemale).forEach(function(t) {
      var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
      if (!n) return;
      addOption(sel, n, n);
      if (n === cur) found = true;
    });
    if (cur && !found) addOption(sel, cur, cur + '（リストに無い技）');
    sel.value = cur;
    bindChoice(ctx, p, sel, cur,
      function() { return sel.value; },
      function(v) {
        var patch = {};
        patch['tech' + slot] = v;
        return patch;
      },
      function(v) { sel.value = v; },
      null);
    td.appendChild(sel);
    return td;
  }
```

置き換え後:

```js
  // 技の選択肢は「その選手の性別とレンタルで絞った技リスト」＋空（技を消せるように）。
  // 性別が変わって保存されると行ごと Desk.reloadEvent() で作り直される。レンタルは
  // order を変えないので表を作り直さず、rentalCell から fill() を呼んで候補だけ入れ替える。
  // 選手が持っている技が候補に無い場合（接尾辞付きの旧データ、技リストを入れ替えた後、
  // レンタルにしたら選べなくなった形）は、黙って空にしないよう、その名前も選択肢に足す。
  function techCell(ctx, p, locked, slot, refs) {
    var td = document.createElement('td');
    td.className = 'col-tech';
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', '技' + slot);
    sel.disabled = locked;

    function fill() {
      var cur = p['tech' + slot] || '';
      sel.innerHTML = '';
      addOption(sel, '', '—');
      var found = false;
      Courts.techniqueOptions(ctx.techniques, !!p.isFemale, p.rental === true).forEach(function(t) {
        var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
        if (!n) return;
        addOption(sel, n, n);
        if (n === cur) found = true;
      });
      if (cur && !found) {
        // 技リストに無いのか、レンタルで選べなくなっただけなのかを書き分ける
        addOption(sel, cur, cur +
          (Courts.resolveTechnique(ctx.techniques, cur, !!p.isFemale) ? '（選べない技）' : '（リストに無い技）'));
      }
      sel.value = cur;
    }
    fill();

    bindChoice(ctx, p, sel, p['tech' + slot] || '',
      function() { return sel.value; },
      function(v) {
        var patch = {};
        patch['tech' + slot] = v;
        return patch;
      },
      function(v) { sel.value = v; },
      function() { afterRowEdit(ctx, refs, p); });
    td.appendChild(sel);
    refs.techSelects.push({ sel: sel, slot: slot, fill: fill });
    return td;
  }
```

- [ ] **Step 8: `buildRow` を直す**

置き換え前:

```js
  function buildRow(ctx, p, locked) {
    var key = Courts.orderKey(p);
    var tr = document.createElement('tr');
    tr.appendChild(cell(String(Courts.roundOf(p)), 'num col-round'));
    tr.appendChild(cell(String(key.no || ''), 'num col-no'));
    tr.appendChild(nameCell(ctx, p, locked));
    tr.appendChild(courtCell(ctx, p, locked));
    tr.appendChild(sexCell(ctx, p, locked));
    tr.appendChild(newFaceCell(ctx, p, locked));
    tr.appendChild(techCell(ctx, p, locked, 1));
    tr.appendChild(techCell(ctx, p, locked, 2));
    tr.appendChild(techCell(ctx, p, locked, 3));
    tr.appendChild(cell(String(p.score || 0), 'num col-score'));
```

置き換え後:

```js
  function buildRow(ctx, p, locked) {
    var key = Courts.orderKey(p);
    // この行の入力を控えておく（レンタルの切り替えで技を作り直す・赤枠を塗り直す）
    var refs = { techSelects: [], bibInput: null, rankInput: null };
    var tr = document.createElement('tr');
    tr.appendChild(cell(String(Courts.roundOf(p)), 'num col-round'));
    tr.appendChild(cell(String(key.no || ''), 'num col-no'));
    tr.appendChild(nameCell(ctx, p, locked));
    tr.appendChild(bibCell(ctx, p, locked, refs));
    tr.appendChild(rankCell(ctx, p, locked, refs));
    tr.appendChild(rentalCell(ctx, p, locked, refs));
    tr.appendChild(courtCell(ctx, p, locked));
    tr.appendChild(sexCell(ctx, p, locked));
    tr.appendChild(newFaceCell(ctx, p, locked));
    tr.appendChild(techCell(ctx, p, locked, 1, refs));
    tr.appendChild(techCell(ctx, p, locked, 2, refs));
    tr.appendChild(techCell(ctx, p, locked, 3, refs));
    tr.appendChild(cell(String(p.score || 0), 'num col-score'));
```

同じ関数の末尾。置き換え前:

```js
    if (!locked) tdAct.appendChild(buildRowMenu(ctx, p));
    tr.appendChild(tdAct);
    return tr;
  }
```

置き換え後:

```js
    if (!locked) tdAct.appendChild(buildRowMenu(ctx, p));
    tr.appendChild(tdAct);
    markRow(ctx, refs, p);   // 描いた時点の赤枠
    return tr;
  }
```

- [ ] **Step 9: 下書き行に 3 項目を足す**

`draftSeed` の戻り値。置き換え前:

```js
    return {
      court: court,
      isFemale: last ? !!last.isFemale : false,
      isNewFace: last ? !!last.isNewFace : false
    };
```

置き換え後:

```js
    return {
      court: court,
      isFemale: last ? !!last.isFemale : false,
      isNewFace: last ? !!last.isNewFace : false,
      // レンタルも直前の行から引き継ぐ（受付でレンタルの列が続くことが多い）。
      // ゼッケンと級位段位は人ごとに違うので引き継がない。
      rental: last ? last.rental === true : false
    };
```

`buildDraftRow` の `d`。置き換え前:

```js
    var d = {
      name: '', court: draft.court, isFemale: draft.isFemale, isNewFace: draft.isNewFace,
      tech1: '', tech2: '', tech3: ''
    };
```

置き換え後:

```js
    var d = {
      name: '', court: draft.court, isFemale: draft.isFemale, isNewFace: draft.isNewFace,
      bib: '', rank: '', rental: draft.rental === true,
      tech1: '', tech2: '', tech3: ''
    };
```

名前のセルの**直後**（`// コート` のコメントの直前）に 3 つのセルを足す。置き換え前:

```js
    tdName.appendChild(input);
    tr.appendChild(tdName);

    // コート
```

置き換え後:

```js
    tdName.appendChild(input);
    tr.appendChild(tdName);

    // ゼッケン（空なら未設定で登録する）
    var tdBib = document.createElement('td');
    tdBib.className = 'col-bib';
    var inBib = document.createElement('input');
    inBib.type = 'number';
    inBib.min = '1';
    inBib.max = '9999';
    inBib.step = '1';
    inBib.className = 'desk-cell-input';
    inBib.setAttribute('aria-label', '追加する選手のゼッケン番号');
    inBib.addEventListener('change', function() { d.bib = inBib.value.trim(); });
    tdBib.appendChild(inBib);
    tr.appendChild(tdBib);

    // 級位段位
    var tdRank = document.createElement('td');
    tdRank.className = 'col-rank';
    var inRank = document.createElement('input');
    inRank.type = 'text';
    inRank.className = 'desk-cell-input';
    inRank.setAttribute('list', RANK_LIST_ID);
    inRank.setAttribute('aria-label', '追加する選手の級位・段位');
    inRank.addEventListener('change', function() { d.rank = inRank.value.trim(); });
    tdRank.appendChild(inRank);
    tr.appendChild(tdRank);

    // レンタル（技の候補が変わるので、切り替えたら技セレクトを作り直す）
    var tdRental = document.createElement('td');
    tdRental.className = 'col-rental';
    var chkRental = document.createElement('input');
    chkRental.type = 'checkbox';
    chkRental.className = 'desk-cell-check';
    chkRental.checked = d.rental;
    chkRental.setAttribute('aria-label', '真剣レンタル');
    tdRental.appendChild(chkRental);
    tr.appendChild(tdRental);

    // コート
```

技の候補を作る `fillTechOptions` を `d.rental` でも絞る。置き換え前:

```js
      Courts.techniqueOptions(ctx.techniques, d.isFemale).forEach(function(t) {
```

置き換え後:

```js
      Courts.techniqueOptions(ctx.techniques, d.isFemale, d.rental).forEach(function(t) {
```

`fillTechOptions` の定義の**直後**（`// 性別` のコメントの直前）に、レンタルの切り替えを足す。置き換え前:

```js
      sel.value = cur || '';
    }

    // 性別
```

置き換え後:

```js
      sel.value = cur || '';
    }

    chkRental.addEventListener('change', function() {
      d.rental = chkRental.checked;
      // 候補が変わる（レンタルなら抜刀後の形だけ）。選べなくなった技は空に戻る。
      techSelects.forEach(function(sel, i) {
        fillTechOptions(sel);
        d['tech' + (i + 1)] = sel.value;
      });
    });

    // 性別
```

`setDisabled` に 3 つを足す。置き換え前:

```js
    function setDisabled(flag) {
      [input, selCourt, selSex, chk].forEach(function(el) { el.disabled = flag; });
```

置き換え後:

```js
    function setDisabled(flag) {
      [input, inBib, inRank, chkRental, selCourt, selSex, chk].forEach(function(el) { el.disabled = flag; });
```

`create()` の送信内容。置き換え前:

```js
      var name = input.value.trim();
      if (!name) { cancelDraft(); return; }
      var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する（貼り付け・CSV と同じ規約）
      busy = true;
      setDisabled(true);
      var result = await Api.createPlayer(eventId, {
        name: name, court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace,
        tech1: d.tech1, tech2: d.tech2, tech3: d.tech3, round: 1
      });
```

置き換え後:

```js
      var name = input.value.trim();
      if (!name) { cancelDraft(); return; }
      // change を待たずに Enter で確定されることがあるので、送る直前に読み直す
      d.bib = inBib.value.trim();
      d.rank = inRank.value.trim();
      d.rental = chkRental.checked;
      var bib = null;
      if (d.bib !== '') {
        if (!/^[0-9]+$/.test(d.bib) || parseInt(d.bib, 10) < 1 || parseInt(d.bib, 10) > 9999) {
          alert('ゼッケン番号は 1〜9999 の整数で入力してください。');
          inBib.focus();
          return;
        }
        bib = parseInt(d.bib, 10);
      }
      if (d.rank.length > 20) { alert('級位・段位は 20 文字までです。'); inRank.focus(); return; }
      var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する（貼り付け・CSV と同じ規約）
      busy = true;
      setDisabled(true);
      var result = await Api.createPlayer(eventId, {
        name: name, court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace,
        bib: bib, rank: d.rank, rental: d.rental,
        tech1: d.tech1, tech2: d.tech2, tech3: d.tech3, round: 1
      });
```

成功したあとの次の下書き。置き換え前:

```js
      draft = { court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace };
```

置き換え後:

```js
      // ゼッケンは大会内で重複できないので引き継がない。級位段位も人ごとに違う。
      draft = { court: d.court, isFemale: d.isFemale, isNewFace: d.isNewFace, rental: d.rental };
```

- [ ] **Step 10: 先頭のコメントを直す**

`desk-players.js` の 1〜4 行目。置き換え前:

```js
// 選手の区画（#players/<id>）。編集できる表。
```

置き換え後:

```js
// 選手の区画（#players/<id>）。編集できる表。
// ゼッケン・級位段位・真剣レンタルは名前のすぐ右の 3 列（設計書「選手の追加項目」）。
// レンタルの選手には「抜刀後」の形だけを技の候補に出す（Courts.techniqueOptions の第 3 引数）。
```

- [ ] **Step 11: ブラウザで確かめる**

`http://localhost:3461/desk.html` を**新しいタブ**で開き、確認用の大会 `UI確認-D` の「選手登録」。幅 **1280px**。

- [ ] 名前の右に **ゼッケン**・**級位段位**・**レンタル** の 3 列が出る。列がずれていない（見出しと中身が同じ列に載っている）
- [ ] ゼッケンに `12` と入れて Tab → `保存しました` のトースト。区画を移って戻っても残っている
- [ ] **別の選手にも `12`** と入れて Tab → `ゼッケン番号 12 は「…」が使っています` の alert が出て、セルが元（空）に戻る
- [ ] ゼッケンを空にして Tab → 保存できる（未設定に戻る）
- [ ] ゼッケンに `0` / `10000` を入れると `ゼッケン番号は 1〜9999 の整数で入力してください。` が出て元に戻る
- [ ] 級位段位のセルをクリックすると **無級・十級…十段** の候補が出る。候補にない `錬士六段` も入れて保存できる。21 文字入れると断られる
- [ ] **レンタル**にチェックを入れる → 保存され、**その行の技 1〜3 の候補が `破図味` だけになる**（Task 1 で「抜刀後」を付けた技だけ）。ほかの行の候補は変わらない
- [ ] レンタルを外すと候補が全部に戻る
- [ ] レンタルの選手に抜刀前の形（例: `四方`）が入っていた場合、そのセルが **赤枠＋赤字**になり、セレクトには `四方（選べない技）` と出る
- [ ] 基本情報で「ゼッケン番号を必須にする」を入れて選手登録に戻ると、一巡目でゼッケンが空のセルが **赤い点線**になる。二巡目の行は赤くならない
- [ ] 「＋ 行を追加」の下書き行にも ゼッケン・級位段位・レンタル がある。レンタルにチェックすると下書き行の技の候補が絞られる。名前を入れて Enter で登録され、**次の下書き行はレンタルのチェックを引き継ぎ、ゼッケンと級位段位は空**
- [ ] 下書き行に重複したゼッケンを入れて Enter → サーバーの 409 の文言が出て、行は残る（打ち直せる）
- [ ] 見出しの **ゼッケン** を押すと並べ替わる（▲ で小さい順、未設定は末尾）。もう一度押すと逆順
- [ ] 窓を 1000px に狭めると表の枠だけが横にスクロールし、名前の列が左に残る
- [ ] **最終結果を確定**した大会では 3 つとも無効（グレー）
- [ ] ライト／ダークの両方で赤枠が読める

- [ ] **Step 12: コミット**

```bash
git status --porcelain
git diff desk-players.js
git add desk-players.js
git commit -m "$(cat <<'EOF'
feat: PC 選手表にゼッケン・級位段位・レンタルの列を足す

名前の右に 3 列を足し、セルごとに保存する。レンタルの選手には抜刀後の
形だけを技の候補に出し、切り替えたらその行の技セレクトを作り直す。
必須未入力とレンタル不可の形のセルは赤枠にし、ゼッケンの重複（409）は
サーバーの文言をそのまま出す。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7（D）: 表の上に「ゼッケン未入力 n　級位段位未入力 n　レンタル不可の形 n」を出す

表の上の帯（いまは「表示 n / N 名」と「絞り込みを解除」）に、**試合開始で止まる理由の件数**を足す。数えるのは `Courts.startBlockers` そのものなので、Task 10 の判定と必ず一致する。0 件の種類は出さない。全部 0 なら帯自体に何も足さない。

**Files:**
- Modify: `desk-players.js`（`renderCount` と `afterRowEdit`、`fillRows`）

- [ ] **Step 1: `renderCount` に件数を足す**

置き換え前:

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
```

置き換え後:

```js
  // 試合開始で止まる理由の見出し（Courts.startBlockers の kind と対応）。
  var BLOCKER_LABELS = { bib: 'ゼッケン未入力', rank: '級位段位未入力', rental: 'レンタル不可の形' };

  // 表の上の「表示 n / N 名」「ゼッケン未入力 n …」「絞り込みを解除」。
  // 件数は Courts.startBlockers をそのまま数えるので、「試合開始」で止まる条件と
  // 必ず一致する（絞り込みで隠れている行も数える。隠れたまま止まると理由が分からない）。
  function renderCount(shown, total) {
    if (!view || !view.bar) return;
    view.bar.innerHTML = '';
    var span = document.createElement('span');
    span.className = 'desk-players-count';
    span.textContent = '表示 ' + shown + ' / ' + total + ' 名';
    view.bar.appendChild(span);

    var blockers = Courts.startBlockers(view.ctx.event, view.ctx.players || []);
    if (blockers.length > 0) {
      var warn = document.createElement('span');
      warn.className = 'desk-players-blockers';
      warn.textContent = blockers.map(function(b) {
        return (BLOCKER_LABELS[b.kind] || b.kind) + ' ' + b.players.length;
      }).join('　');
      warn.title = 'この件数が残っていると「試合開始」で止まります';
      view.bar.appendChild(warn);
    }

    if (!isAnyFilterActive()) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'desk-btn';
    b.textContent = '絞り込みを解除';
    b.addEventListener('click', function() { clearFilter(); });
    view.bar.appendChild(b);
  }
```

- [ ] **Step 2: セルを保存したら件数も数え直す**

`afterRowEdit`（Task 6 で足したもの）。置き換え前:

```js
  // セルを 1 つ保存できたあとに呼ぶ。行の赤枠を塗り直す
  // （Task 7 でここに表の上の件数の数え直しも足す）。
  function afterRowEdit(ctx, refs, p) {
    markRow(ctx, refs, p);
  }
```

置き換え後:

```js
  // セルを 1 つ保存できたあとに呼ぶ。その行の赤枠と、表の上の件数を塗り直す。
  // 表そのものは描き直さない（他のセルの入力途中を壊さないため。saveCell と同じ方針）。
  function afterRowEdit(ctx, refs, p) {
    markRow(ctx, refs, p);
    if (view && view.ctx === ctx) renderCount(lastShown, (ctx.players || []).length);
  }
```

`fillRows` が最後に件数を出すところで、いまの表示件数を控える。置き換え前:

```js
    if (draft && !locked) tbody.appendChild(buildDraftRow(ctx));
    renderCount(rows.length, players.length);
  }
```

置き換え後:

```js
    if (draft && !locked) tbody.appendChild(buildDraftRow(ctx));
    lastShown = rows.length;   // afterRowEdit が件数だけ描き直すときに使う
    renderCount(rows.length, players.length);
  }
```

`view` の宣言の隣（`var view = null;` の行の直後）に足す。

```js
  // いま表に出ている行数（絞り込み後）。セルを 1 つ保存したあとに
  // 「表示 n / N 名」を数え直すために覚えておく。
  var lastShown = 0;
```

- [ ] **Step 3: ブラウザで確かめる**

`http://localhost:3461/desk.html` を**新しいタブ**で開き、`UI確認-D` の「選手登録」。

- [ ] 基本情報で 2 つとも必須にして戻ると、表の上に `表示 5 / 5 名` の右に **`ゼッケン未入力 5　級位段位未入力 5`** が赤く出る
- [ ] 1 人にゼッケンを入れると、その場で `ゼッケン未入力 4` に減る（表は描き直されず、ほかのセルの入力途中も消えない）
- [ ] 全員に入れると `ゼッケン未入力` の表示が消える。両方 0 になると赤い帯ごと消える
- [ ] レンタルにチェックして抜刀前の形が残っている行を作ると `レンタル不可の形 1` が出る。技を `破図味` に直すと消える
- [ ] コートで絞り込んでも件数は**全体の**件数のまま（隠れた行も数える）
- [ ] 必須のチェックを外すと帯が消える
- [ ] マウスを帯に載せると「この件数が残っていると「試合開始」で止まります」が出る

- [ ] **Step 4: コミット**

```bash
git status --porcelain
git diff desk-players.js
git add desk-players.js
git commit -m "$(cat <<'EOF'
feat: PC 選手表に試合開始で止まる件数を出す

Courts.startBlockers をそのまま数えて「ゼッケン未入力 n　級位段位未入力 n
　レンタル不可の形 n」を表の上に出す。0 件の種類は出さない。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8（D）: 貼り付けダイアログに 3 列を足す

`Courts.parsePasteRows` は列が **名前, コート, 性別, 新人, 技1, 技2, 技3, ゼッケン, 級位段位, レンタル** の 10 列になっている（B が実装済み）。ダイアログの説明とプレビューをそれに合わせ、登録に 3 項目を含める。

**⚠ 着手の前に `courts.js` の `parsePasteRow` を読み、行が持つキー名（`bib` / `rank` / `rental`）を確かめること。**

**Files:**
- Modify: `desk-players.js`（`pasteLine`、`openPasteDialog` の `note` と `btnAdd` の `rows` の組み立て）

- [ ] **Step 1: プレビューの 1 行に 3 項目を出す**

`pasteLine` の末尾。置き換え前:

```js
    row.techs.forEach(function(t, i) {
      var span = document.createElement('span');
      span.textContent = (i > 0 ? '・' : '') + (t || '—');
      if (t && row.badTechs.indexOf(t) !== -1) span.className = 'desk-paste-bad';
      div.appendChild(span);
    });
    if (!row.ok) {
```

置き換え後:

```js
    row.techs.forEach(function(t, i) {
      var span = document.createElement('span');
      span.textContent = (i > 0 ? '・' : '') + (t || '—');
      if (t && row.badTechs.indexOf(t) !== -1) span.className = 'desk-paste-bad';
      div.appendChild(span);
    });
    // 追加項目。書いていない列は出さない（短い行の下見が横に伸びないように）。
    var extras = [];
    if (typeof row.bib === 'number') extras.push('No.' + row.bib);
    if (row.rank) extras.push(row.rank);
    if (row.rental) extras.push('レンタル');
    if (extras.length > 0) {
      var ex = document.createElement('span');
      ex.textContent = '　' + extras.join('　');
      div.appendChild(ex);
    }
    if (!row.ok) {
```

- [ ] **Step 2: 説明に 3 列を足す**

`openPasteDialog` の `note.textContent`。置き換え前:

```js
    note.textContent = 'Excel の範囲をそのまま貼り付けられます。列は 名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 の順' +
      '（タブ区切りかカンマ区切り）。1 行目が「名前」で始まるときは見出しとして読み飛ばします。' +
      '性別は「女子」「女」「F」が女子、それ以外は男子。新人は「新人」「○」「1」「true」。' +
      '技はこの大会の技リストにある名前だけです。' +
      '男女で配点が分かれる技は 破図味 のように接尾辞なしで書けます（行の性別で解決します）。' +
      '名前だけの行でも登録できます（足りない列は 男子・新人なし・技は空。コートは下のセレクトの値）。';
```

置き換え後:

```js
    note.textContent = 'Excel の範囲をそのまま貼り付けられます。列は ' +
      '名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 / ゼッケン / 級位段位 / レンタル の順' +
      '（タブ区切りかカンマ区切り）。1 行目が「名前」で始まるときは見出しとして読み飛ばします。' +
      '性別は「女子」「女」「F」が女子、それ以外は男子。新人とレンタルは「○」「1」「true」など' +
      '（レンタルは「レンタル」「あり」も可）。ゼッケンは 1〜9999 の整数で、同じ大会の中で重複できません。' +
      '技はこの大会の技リストにある名前だけです。' +
      '男女で配点が分かれる技は 破図味 のように接尾辞なしで書けます（行の性別で解決します）。' +
      'レンタルの行には「抜刀後」の形しか書けません。' +
      '名前だけの行でも登録できます（足りない列は 男子・新人なし・技は空・ゼッケンと級位段位は未設定・' +
      'レンタルなし。コートは下のセレクトの値）。';
```

- [ ] **Step 3: 登録に 3 項目を含める**

`btnAdd` のハンドラの `rows` の組み立て。置き換え前:

```js
      var rows = okRows.map(function(r) {
        return {
          name: r.name, court: r.court, isFemale: r.isFemale, isNewFace: r.isNewFace,
          tech1: r.techs[0], tech2: r.techs[1], tech3: r.techs[2]
        };
      });
```

置き換え後:

```js
      var rows = okRows.map(function(r) {
        return {
          name: r.name, court: r.court, isFemale: r.isFemale, isNewFace: r.isNewFace,
          // 未設定は bib: null / rank: '' / rental: false で送る（サーバーの検証に合わせる）
          bib: (typeof r.bib === 'number') ? r.bib : null,
          rank: r.rank || '',
          rental: r.rental === true,
          tech1: r.techs[0], tech2: r.techs[1], tech3: r.techs[2]
        };
      });
```

- [ ] **Step 4: ブラウザで確かめる**

`http://localhost:3461/desk.html` → `UI確認-D` → 「選手登録」→ **📋 貼り付けて追加**。

タブ区切り（Excel からのコピーと同じ）で次を貼る。`破図味` は Task 1 で「抜刀後」を付けてあるもの、`四方` は付けていないもの。

```
山田 太郎	A	男子		破図味	四方	水月	21	三段
佐藤 花子	A	女子	新人	破図味	破図味	破図味	22	初段	○
鈴木 次郎	A	男子		四方	水月	両車	22	二段
田中 三郎	A	男子		四方	水月	両車	あ
高橋 四郎	A	男子		四方	破図味	水月	25	五段	レンタル
```

- [ ] 説明に ゼッケン / 級位段位 / レンタル の 3 列が書かれている
- [ ] 1 行目（山田）は `ok`。下見に `No.21　三段` が出る
- [ ] 2 行目（佐藤）は `ok`。`No.22　初段　レンタル` が出る
- [ ] 3 行目（鈴木）は **ゼッケンが 2 行目と重複**して赤くなる（理由が行末に出る）
- [ ] 4 行目（田中）は `ゼッケン番号は数字で` で赤くなる
- [ ] 5 行目（高橋）は **レンタルなのに `四方` `水月` が抜刀後でない**ので赤くなる
- [ ] 赤い行を直して **登録** → 人数ぶんだけ登録され、表にゼッケン・級位段位・レンタルが入っている
- [ ] 重複したゼッケンを含めたまま登録すると、サーバーが `3 行目: …` の文言で断り、**1 人も登録されない**
- [ ] 名前だけの行（`山田 五郎` だけ）も従来どおり登録できる（ゼッケンと級位段位は空、レンタルなし）

- [ ] **Step 5: コミット**

```bash
git status --porcelain
git diff desk-players.js
git add desk-players.js
git commit -m "$(cat <<'EOF'
feat: 貼り付けて追加にゼッケン・級位段位・レンタルの列を足す

列の説明を 10 列に直し、下見に追加項目を出し、登録の行に 3 項目を含める。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9（D）: 試合進行にレンタル人数を出し、二巡目の技も絞る

コート別のカードに「真剣レンタル n 名」（その巡目の行で `rental` の数。0 なら出さない）を足す。二巡目の表の技セレクトも `rental` で絞る。

**Files:**
- Modify: `desk-match.js`（`buildCourts`、`buildCourtCard`、`buildRow`）
- Modify: `desk.css`（`.desk-match-live.idle` の隣に `.desk-match-rental`）

- [ ] **Step 1: `desk.css` にレンタル人数の見た目を足す**

`.desk-match-live.idle { background: transparent; color: var(--text-muted); padding-left: 0; }` の**直後**に足す。

```css
/* 真剣レンタルの人数。刀の手配に関わるので、待機中の薄い字ではなく本文の色で出す。 */
.desk-match-rental { font-size: 13px; font-weight: bold; }
```

- [ ] **Step 2: カードに巡目を渡す**

`buildCourts` の中。置き換え前:

```js
    rows.forEach(function(r) { grid.appendChild(buildCourtCard(r, ctx)); });
```

置き換え後:

```js
    rows.forEach(function(r) { grid.appendChild(buildCourtCard(r, ctx, round)); });
```

- [ ] **Step 3: カードに「真剣レンタル n 名」を足す**

置き換え前:

```js
  function buildCourtCard(row, ctx) {
```

置き換え後:

```js
  function buildCourtCard(row, ctx, round) {
```

同じ関数の中。置き換え前:

```js
    prog.textContent = '採点済み ' + row.scored + ' / ' + row.total;
    card.appendChild(prog);
```

置き換え後:

```js
    prog.textContent = '採点済み ' + row.scored + ' / ' + row.total;
    card.appendChild(prog);

    // 真剣レンタルの人数（いま数えている巡目の行だけ）。0 なら行ごと出さない
    // （レンタルのいない大会でカードが縦に伸びないように）。
    var rental = (ctx.players || []).filter(function(p) {
      return Courts.courtOf(p) === row.court && Courts.roundOf(p) === round && p.rental === true;
    }).length;
    if (rental > 0) {
      var rent = document.createElement('div');
      rent.className = 'desk-match-rental';
      rent.textContent = '真剣レンタル ' + rental + ' 名';
      card.appendChild(rent);
    }
```

- [ ] **Step 4: 二巡目の技の候補を `rental` で絞る**

`buildRow` の中。置き換え前:

```js
    // 技の候補は選手の性別で絞る（Courts.techniqueOptions）。コピー（一巡目と同じ技を
    // コピー / 全員コピー）は名前をそのまま入れるだけで、ここでは絞らない
    // （一巡目と同じ名前が正。onCopyRow / 全員コピーの節を参照）。
    var techOptions = Courts.techniqueOptions(techniques, !!p.isFemale);
```

置き換え後:

```js
    // 技の候補は選手の性別とレンタルで絞る（Courts.techniqueOptions）。レンタルの選手は
    // 抜刀後の形だけ。コピー（一巡目と同じ技をコピー / 全員コピー）は名前をそのまま
    // 入れるだけで、ここでは絞らない（一巡目と同じ名前が正。ensureOption が候補に
    // 無い名前を「（リストにありません）」として足すので、値は落ちない）。
    var techOptions = Courts.techniqueOptions(techniques, !!p.isFemale, p.rental === true);
```

- [ ] **Step 5: ブラウザで確かめる**

`UI確認-D` で、A コートにレンタルの選手を 2 名作っておく。上部の段階を **試合開始 ▶** で「一巡目 進行中」にし、`desk.html` の「試合進行」を開く。

- [ ] A コートのカードに「採点済み 0 / 5」の下に **真剣レンタル 2 名** が出る
- [ ] レンタルのいないコートのカードにはその行が出ない
- [ ] 段階を「一巡目終了」まで進め、「二巡目を生成」→ 二巡目の表で**レンタルの選手の行の技セレクトが `破図味` だけ**になる。レンタルでない行は全部出る
- [ ] 「一巡目と同じ技をコピー」を押すと、レンタルの行にも一巡目の名前がそのまま入り、候補に無い名前は `（リストにありません）` として残る（値が消えない）
- [ ] カードのレンタル人数は、二巡目に進むと**二巡目の行**で数え直される
- [ ] ライト／ダークの両方で読める

- [ ] **Step 6: コミット**

```bash
git status --porcelain
git diff desk-match.js desk.css
git add desk-match.js desk.css
git commit -m "$(cat <<'EOF'
feat: 試合進行にレンタル人数を出し、二巡目の技も絞る

コート別のカードにその巡目の「真剣レンタル n 名」を出す（0 なら出さない）。
二巡目の表の技セレクトも Courts.techniqueOptions の第 3 引数で絞る。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10（D）: 「試合開始」で必須の未入力とレンタル不可の形を止める

`draft → round1` の前に `Courts.startBlockers` を見て、空でなければ `alert(Courts.blockerMessage(...))` して**遷移しない**（確認して進む形にはしない）。PC（`desk.js`）とスマホ（`admin-round.js`）の両方。あわせて、スマホの二巡目の技ピッカーも `rental` で絞る（「設計書との差分」5）。

**Files:**
- Modify: `desk.js`（`applyStatus`）
- Modify: `admin-round.js`（`applyStatus`、`openPicker`）

- [ ] **Step 1: `desk.js` の `applyStatus` に判定を足す**

置き換え前:

```js
  async function applyStatus(from, to) {
    var eventId = selectedEventId;
    var players = (currentEvent && currentEvent.players) || [];
    if (!eventId) return;
    if (!confirm(Courts.statusConfirmMessage(from, to, players))) return;
```

置き換え後:

```js
  async function applyStatus(from, to) {
    var eventId = selectedEventId;
    var players = (currentEvent && currentEvent.players) || [];
    if (!eventId) return;
    // 試合開始の前だけ、必須項目の未入力とレンタルの選手の技を見る。サーバーは硬い条件
    // （選手 0 名・遷移表にない組み合わせ）しか見ないので、ここで止める。
    // 「確認して進む」にはしない（設計書の決定事項）。必須を外すか入力すれば通る。
    if (from === 'draft' && to === 'round1') {
      var blockers = Courts.startBlockers(currentEvent, players);
      if (blockers.length > 0) { alert(Courts.blockerMessage(blockers)); return; }
    }
    if (!confirm(Courts.statusConfirmMessage(from, to, players))) return;
```

- [ ] **Step 2: `admin-round.js` の `applyStatus` に同じ判定を足す**

置き換え前:

```js
  async function applyStatus(from, to) {
    var ctx = CTX;
    if (!confirm(Courts.statusConfirmMessage(from, to, ctx.players))) return;
```

置き換え後:

```js
  async function applyStatus(from, to) {
    var ctx = CTX;
    // 試合開始の前だけ、必須項目の未入力とレンタルの選手の技を見る（PC 運営の
    // desk.js の applyStatus と同じ判定・同じ文言。判定は courts.js に置いてある）。
    if (from === 'draft' && to === 'round1') {
      var blockers = Courts.startBlockers(ctx.event, ctx.players);
      if (blockers.length > 0) { alert(Courts.blockerMessage(blockers)); return; }
    }
    if (!confirm(Courts.statusConfirmMessage(from, to, ctx.players))) return;
```

- [ ] **Step 3: スマホの二巡目の技ピッカーも `rental` で絞る**

`admin-round.js` の `openPicker` の中。置き換え前:

```js
      techniques: withCurrentTechniques(
        Courts.techniqueOptions(techniques, !!p.isFemale),
        techniques, latest, !!p.isFemale),
```

置き換え後:

```js
      // レンタルの選手には抜刀後の形だけを出す（PC の二巡目の表と同じ規則）。
      // いま選んである技が候補から外れても withCurrentTechniques が足すので、
      // ①②③ の印は消えない（外れている技は「試合開始」の判定では止められない
      //   二巡目なので、運営が見て直す）。
      techniques: withCurrentTechniques(
        Courts.techniqueOptions(techniques, !!p.isFemale, p.rental === true),
        techniques, latest, !!p.isFemale),
```

- [ ] **Step 4: ブラウザで確かめる（PC）**

`http://localhost:3461/desk.html` → `UI確認-D`。**状態を「準備中」に戻してから**始める（上部の「◀ …に戻す」）。

- [ ] 基本情報で「ゼッケン番号を必須にする」を入れ、一巡目にゼッケンが空の選手を残す → 上部の **試合開始 ▶** を押すと `ゼッケン番号が未入力: n 名（…）` の alert が出て、**状態は「準備中」のまま**（採点画面も開かない）
- [ ] 全員にゼッケンを入れると、いつもの確認（`一巡目 n名。技が未入力の選手が m名います。試合を開始しますか？`）が出て進める
- [ ] 「級位・段位を必須にする」でも同じ
- [ ] 両方引っかかる状態にすると、alert に 2 行とも出る
- [ ] レンタルの選手に抜刀前の形を残す（貼り付けか、レンタルを後からチェックする）→ 試合開始で止まり、その人の名前が出る
- [ ] 必須のチェックを外すと通る
- [ ] 表の上の件数（Task 7）と alert の人数が一致する

- [ ] **Step 5: ブラウザで確かめる（スマホ）**

`http://localhost:3461/admin.html` を幅 **375px** で開き、同じ大会の「試合進行」タブ。

- [ ] 止まる条件を作った状態で **試合開始 ▶** → PC と同じ文言の alert が出て進まない
- [ ] 直すと進める
- [ ] 「一巡目終了」まで進めて二巡目を生成し、レンタルの選手の行をタップ → 技ピッカーに `破図味` だけが並ぶ（すでに入っている技は候補に残り ① などの印が付く）

- [ ] **Step 6: コミット**

```bash
git status --porcelain
git diff desk.js admin-round.js
git add desk.js admin-round.js
git commit -m "$(cat <<'EOF'
feat: 必須の未入力とレンタル不可の形があれば試合開始で止める

draft → round1 の前に Courts.startBlockers を見て、空でなければ
Courts.blockerMessage を alert して遷移しない（PC とスマホの両方）。
スマホの二巡目の技ピッカーもレンタルで絞る。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11（D）: トラック D の通しの確認

**Files:** なし（確認だけ。直すところが見つかったら Task 4〜10 のファイルだけを直して追加でコミットする）

- [ ] **Step 1: 自動テスト**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N+3 passed, 0 failed`（N は作業開始時に控えた数。+3 は Task 4 のぶん）

- [ ] **Step 2: 設計書の「手動確認」のうち D のぶんを通す**

Task 1 が入っていることを確かめてから（入っていなければ `techniques.html` で `破図味(男)` `破図味(女)` に「抜刀後」を付ける）。

- [ ] 形マスタで `破図味` に「抜刀後」を付ける → **レンタルの選手の技セレクトに `破図味` だけ**が出る → レンタルを外すと全部出る
- [ ] 基本情報でゼッケン必須にする → 未入力の選手がいる状態で「試合開始」が止まり、名前が出る → 入力すると進む
- [ ] ゼッケンの重複が **PC の表**（セル編集）と**貼り付け**の両方で拒まれる
- [ ] 試合進行のカードに「真剣レンタル 2 名」
- [ ] CSV 取り込み（右上 ⋯ → 📄 CSV を取り込む）で、サーバーが書き出した CSV を読み直すと 3 項目が戻る。**ゼッケン列の無い古い CSV** も読める
- [ ] 1280px の PC 表で崩れない。窓を 1000px に狭めても名前の列が左に残る
- [ ] ライト／ダークの両方

- [ ] **Step 3: 保留したファイルがあれば報告する**

---

### Task 12（E）: スマホの選手フォームに ゼッケン・級位段位・レンタルを足す

スマホ運営の選手登録タブの「選手を追加」「選手を編集」のシートに 3 項目を足す。**一括登録（名前だけ）のシートは変えない**ので、共通部品の `buildCommonFields`（一括登録も使う）ではなく `buildPlayerForm` に足す。

**Files:**
- Modify: `admin-players.js`（`buildPlayerForm` の DOM・`read`・`reset`）

- [ ] **Step 1: 名前の下にゼッケンと級位段位を足す**

`buildPlayerForm` の中。置き換え前:

```js
    fName.appendChild(lName);
    fName.appendChild(inName);
    el.appendChild(fName);

    var common = buildCommonFields(ctx, player);
    el.appendChild(common.el);
```

置き換え後:

```js
    fName.appendChild(lName);
    fName.appendChild(inName);
    el.appendChild(fName);

    // ゼッケン番号（空は未設定。同じ大会の中では重複できず、サーバーが 409 で断る）。
    // 一括登録（名前だけ）のシートには出さないので、共通部品ではなくここに置く。
    var fBib = document.createElement('div');
    fBib.className = 'field';
    var lBib = document.createElement('label');
    lBib.textContent = 'ゼッケン番号（1〜9999。空でも登録できます）';
    var inBib = document.createElement('input');
    inBib.type = 'number';
    inBib.min = '1';
    inBib.max = '9999';
    inBib.step = '1';
    inBib.inputMode = 'numeric';
    inBib.value = (player && typeof player.bib === 'number') ? String(player.bib) : '';
    fBib.appendChild(lBib);
    fBib.appendChild(inBib);
    el.appendChild(fBib);

    // 級位・段位。候補は datalist で出すが、自由入力も受ける（20 文字まで）。
    // datalist はこのシートと一緒に作って一緒に捨てるので、id が重なることはない。
    var fRank = document.createElement('div');
    fRank.className = 'field';
    var lRank = document.createElement('label');
    lRank.textContent = '級位・段位（候補から選ぶか、自由に書けます）';
    var inRank = document.createElement('input');
    inRank.type = 'text';
    inRank.setAttribute('list', 'adminRankList');
    inRank.value = (player && typeof player.rank === 'string') ? player.rank : '';
    var rankList = document.createElement('datalist');
    rankList.id = 'adminRankList';
    ['無級', '十級', '九級', '八級', '七級', '六級', '五級', '四級', '三級', '二級', '一級',
     '初段', '二段', '三段', '四段', '五段', '六段', '七段', '八段', '九段', '十段']
      .forEach(function(r) {
        var o = document.createElement('option');
        o.value = r;
        rankList.appendChild(o);
      });
    fRank.appendChild(lRank);
    fRank.appendChild(inRank);
    fRank.appendChild(rankList);
    el.appendChild(fRank);

    var common = buildCommonFields(ctx, player);
    el.appendChild(common.el);

    // 真剣レンタル。新人と同じトグル（.toggle）で、コート・性別・新人のすぐ下に置く。
    // チェックすると、次に開く技ピッカーの候補が「抜刀後」の形だけになる（Task 13）。
    var fRental = document.createElement('div');
    fRental.className = 'field';
    var togRental = document.createElement('label');
    togRental.className = 'toggle';
    var chkRental = document.createElement('input');
    chkRental.type = 'checkbox';
    chkRental.checked = player ? player.rental === true : false;
    var txtRental = document.createElement('span');
    txtRental.textContent = '真剣レンタル（抜刀後の形だけ選べます）';
    togRental.appendChild(chkRental);
    togRental.appendChild(txtRental);
    fRental.appendChild(togRental);
    el.appendChild(fRental);
```

- [ ] **Step 2: `read()` に 3 項目を足す**

置き換え前:

```js
    function read() {
      var name = inName.value.trim();
      if (!name) { alert('名前を入力してください。'); return null; }
      var court = common.court();
      if (!court) { alert('コートを選んでください。「＋」で新しいコートを作れます。'); return null; }
      var t = TechPicker.toArray(techState);
      return {
        name: name,
        court: court,
        isFemale: common.isFemale(),
        isNewFace: common.isNewFace(),
        tech1: t[0],
        tech2: t[1],
        tech3: t[2]
      };
    }
```

置き換え後:

```js
    function read() {
      var name = inName.value.trim();
      if (!name) { alert('名前を入力してください。'); return null; }
      var court = common.court();
      if (!court) { alert('コートを選んでください。「＋」で新しいコートを作れます。'); return null; }
      // 数値入力でも貼り付けや環境によっては数字以外が残るので、自分でも見る。
      // 空は未設定（bib: null）。サーバーは 1〜9999 の整数しか受けない。
      var bibText = inBib.value.trim();
      var bib = null;
      if (bibText !== '') {
        var n = parseInt(bibText, 10);
        if (!/^[0-9]+$/.test(bibText) || n < 1 || n > 9999) {
          alert('ゼッケン番号は 1〜9999 の整数で入力してください。');
          return null;
        }
        bib = n;
      }
      var rank = inRank.value.trim();
      if (rank.length > 20) { alert('級位・段位は 20 文字までです。'); return null; }
      var t = TechPicker.toArray(techState);
      return {
        name: name,
        court: court,
        isFemale: common.isFemale(),
        isNewFace: common.isNewFace(),
        bib: bib,
        rank: rank,
        rental: chkRental.checked,
        tech1: t[0],
        tech2: t[1],
        tech3: t[2]
      };
    }
```

- [ ] **Step 3: `reset()` でゼッケンと級位段位を空にする**

置き換え前:

```js
    function reset() {
      inName.value = '';
      techState = [];
      renderTechChips();
      inName.focus();
    }
```

置き換え後:

```js
    function reset() {
      inName.value = '';
      // ゼッケンは大会の中で重複できないので必ず消す。級位段位も人ごとに違う。
      // コート・性別・新人・レンタルは受付が続くので残す（この関数の約束）。
      inBib.value = '';
      inRank.value = '';
      techState = [];
      renderTechChips();
      inName.focus();
    }
```

同じ関数の上のコメント（`buildPlayerForm` の説明）も直す。置き換え前:

```js
  //   read(): { name, court, isFemale, isNewFace, tech1, tech2, tech3 } | null
  //           （不正なら alert を出して null）
  //   reset(): 名前と技だけ空にする（コート・性別は保つ。受付を連続処理するため）
```

置き換え後:

```js
  //   read(): { name, court, isFemale, isNewFace, bib, rank, rental, tech1, tech2, tech3 } | null
  //           （不正なら alert を出して null。bib は数値か null）
  //   reset(): 名前・ゼッケン・級位段位・技を空にする
  //           （コート・性別・新人・レンタルは保つ。受付を連続処理するため）
```

- [ ] **Step 4: ブラウザで確かめる**

`http://localhost:3461/admin.html` を幅 **375px** で開き、`UI確認-E` の「選手登録」タブ → 右下の **＋**。

- [ ] 名前の下に **ゼッケン番号**・**級位・段位**、コート／性別／新人の下に **真剣レンタル** が並ぶ。375px で横に溢れない
- [ ] ゼッケンに `31`、級位段位に `三段`、レンタルにチェックして **保存して次を追加** → 登録できる
- [ ] 次の入力では **ゼッケンと級位段位が空**、コート・性別・新人・**レンタルは残っている**
- [ ] 既に使われているゼッケンを入れて保存 → `ゼッケン番号 31 は「…」が使っています` の alert が出て、**シートは閉じない**（入力が残る）
- [ ] `0` / `10000` / `あ` を入れると `ゼッケン番号は 1〜9999 の整数で入力してください。`
- [ ] 級位・段位の欄をタップすると候補（無級〜十段）が出る。自由入力もできる。21 文字は断られる
- [ ] 表の行をタップして「選手を編集」を開くと、保存済みの 3 項目が入っている。直して保存できる
- [ ] 右上 ⋯ → **👥 複数人をまとめて登録** のシートには 3 項目が**出ない**（変わっていない）

- [ ] **Step 5: コミット**

```bash
git status --porcelain
git diff admin-players.js
git add admin-players.js
git commit -m "$(cat <<'EOF'
feat: スマホの選手フォームにゼッケン・級位段位・レンタルを足す

追加・編集のシートに 3 項目を足す。一括登録（名前だけ）のシートは
共通部品を使うので変えない。「保存して次を追加」ではゼッケンと級位段位
だけを空に戻す。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13（E）: スマホの技ピッカーをレンタルで絞り、ゼッケンの 409 を出す

技ピッカーに渡す配列を `Courts.techniqueOptions(list, isFemale, rental)` にする。すでにある `withCurrentTechniques` の仕組み（いま選んでいる技が候補に無ければ足す）はそのまま使うので、レンタルにしたあとも選んである技の ①②③ の印は消えない。あわせて、編集シートの `bib` の 409 の文言をサーバーのものにする。

**Files:**
- Modify: `admin-players.js`（`renderTechChips` の `TechPicker.open`、`openEditSheet` の保存の失敗分岐）

- [ ] **Step 1: ピッカーの候補をレンタルで絞る**

`renderTechChips` の中。置き換え前:

```js
        TechPicker.open({
          // 開くたびに今のフォームの性別で絞る（性別を切り替えた直後は、次に開く
          // ピッカーから反映されればよい。既に開いているシートは作り直さない）。
          // 絞った候補に今の tech1〜3 が無ければ足す（接尾辞付きの旧データなど）。
          techniques: withCurrentTechniques(
            Courts.techniqueOptions(techCache, common.isFemale()),
            techCache, TechPicker.toArray(techState), common.isFemale()),
```

置き換え後:

```js
        TechPicker.open({
          // 開くたびに今のフォームの性別とレンタルで絞る（切り替えた直後は、次に開く
          // ピッカーから反映されればよい。既に開いているシートは作り直さない）。
          // レンタルにチェックが入っていれば「抜刀後」の形だけ。
          // 絞った候補に今の tech1〜3 が無ければ足す（接尾辞付きの旧データや、
          // レンタルにして選べなくなった形。選んである印を消さないため）。
          techniques: withCurrentTechniques(
            Courts.techniqueOptions(techCache, common.isFemale(), chkRental.checked),
            techCache, TechPicker.toArray(techState), common.isFemale()),
```

- [ ] **Step 2: 編集シートの 409 でゼッケンの文言を出す**

`openEditSheet` の `btnSave` のハンドラ。置き換え前:

```js
      if (!res || !res.ok) {
        // 失敗してもシートは閉じない（入力を残す）
        if (res && res.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else {
          alert('選手の更新に失敗しました。\n入力内容と通信を確認してください。');
        }
        return;
      }
```

置き換え後:

```js
      if (!res || !res.ok) {
        // 失敗してもシートは閉じない（入力を残す）
        if (res && res.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else if (res && res.reason === 'bib') {
          // 「ゼッケン番号 12 は「山田 太郎」が使っています」。
          // 誰と重なったかを知っているのはサーバーだけなので文言をそのまま出す。
          alert(res.error);
        } else {
          alert('選手の更新に失敗しました。\n入力内容と通信を確認してください。');
        }
        return;
      }
```

> 追加のシート（`openAddSheet`）は、409 で `reason` が `'locked'` でなければ `alert(created.error)` とサーバーの文言をそのまま出す作りに既になっている。**変更は要らない**（Task 12 の確認で実際に出ることを見ている）。

- [ ] **Step 3: ブラウザで確かめる**

`http://localhost:3461/admin.html` を幅 **375px** で開き、`UI確認-E` の「選手登録」タブ。**Task 1 が入っていて `破図味` に「抜刀後」が付いていること。**

- [ ] 選手を追加するシートで **真剣レンタル** にチェック → 技の枠 ① をタップ → ピッカーに **`破図味` だけ**が出る
- [ ] レンタルのチェックを外して ① を開き直すと、候補が全部に戻る
- [ ] 先に `四方` を選んでからレンタルにチェックして ① を開くと、`四方` が候補に残っていて ① の印が付いている（値が消えない）
- [ ] 女子の選手でレンタルにすると、`破図味` が接尾辞なしで 1 つだけ出る（`(男)` が出ない）
- [ ] 既に使われているゼッケンに直して編集シートで保存 → サーバーの文言が出て、シートは閉じない

- [ ] **Step 4: コミット**

```bash
git status --porcelain
git diff admin-players.js
git add admin-players.js
git commit -m "$(cat <<'EOF'
feat: スマホの技ピッカーをレンタルで絞る

TechPicker に渡す配列を Courts.techniqueOptions の第 3 引数で絞り、
編集シートのゼッケン重複（409）はサーバーの文言をそのまま出す。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14（E）: スマホの選手表にゼッケン列を足す

表にゼッケンの列を足す（級位段位とレンタルは表には出さず、行をタップしたシートで見る）。**並べ替えの対象にはしない**（スマホの表の並べ替えは No / 名前 / 得点のまま。`Courts.sortBy` の `'bib'` は PC 用で、トラック D が足す）。

**Files:**
- Modify: `admin-players.js`（`COLUMNS`、`buildTr`）

- [ ] **Step 1: 列を足す**

置き換え前:

```js
    { key: 'name', label: '名前', cls: 'col-name' },
    { label: '技①' },
```

置き換え後:

```js
    { key: 'name', label: '名前', cls: 'col-name' },
    // ゼッケンは名前のすぐ右（col-name は sticky なので、その右に足すぶんには
    // 左端の固定に影響しない）。級位段位とレンタルは行のシートで見る。
    { label: 'ゼッケン' },
    { label: '技①' },
```

- [ ] **Step 2: セルを足す**

`buildTr` の中。置き換え前:

```js
    cell(p.name || '', 'col-name');
    // 3枠とも表示する（詰めると ['', '真', '真'] と ['真', '真', ''] が同じ見た目になり、
```

置き換え後:

```js
    cell(p.name || '', 'col-name');
    // ゼッケンは未設定なら「—」を薄く出す（0 と空欄を見間違えないように）
    var hasBib = (typeof p.bib === 'number');
    cell(hasBib ? String(p.bib) : '—', hasBib ? '' : 'muted');
    // 3枠とも表示する（詰めると ['', '真', '真'] と ['真', '真', ''] が同じ見た目になり、
```

- [ ] **Step 3: ブラウザで確かめる**

`http://localhost:3461/admin.html` を幅 **375px** で開き、`UI確認-E` の「選手登録」タブ。

- [ ] 名前の右に **ゼッケン** の列が出て、値のある行は数字、無い行は薄い **—**
- [ ] 表を横にスクロールしても名前の列が左に残る（列を足しても固定が壊れていない）
- [ ] 見出しの **No** / **名前** / **得点** の並べ替えはこれまでどおり動く。**ゼッケン**の見出しは押しても何も起きない（並べ替えの対象ではない）
- [ ] 行をタップすると編集シートが開き、ゼッケン・級位段位・レンタルが入っている
- [ ] ライト／ダークの両方

- [ ] **Step 4: コミット**

```bash
git status --porcelain
git diff admin-players.js
git add admin-players.js
git commit -m "$(cat <<'EOF'
feat: スマホの選手表にゼッケン列を足す

名前の右にゼッケンを出す（未設定は薄い「—」）。級位段位とレンタルは
行のシートで見る。並べ替えの対象にはしない。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15（E）: 採点画面にゼッケンを出す

選手名バーの順番ラベルを `男子 1巡目 1番　No.12` にする（`bib` があるときだけ `No.` を足す）。下部の選手一覧にゼッケンの列を足す。

**Files:**
- Modify: `app.js`（`updatePlayerLabels`、`buildPlayerListRow`）
- Modify: `scoring.html`（選手一覧の `<thead>`）
- Modify: `style.css`（`.player-list-table` の節。**ここだけ**）

- [ ] **Step 1: 順番ラベルにゼッケンを足す**

`app.js` の `updatePlayerLabels`。置き換え前:

```js
  function updatePlayerLabels(p) {
    // 順番パース: コート-性別-巡目-番号（コート名は Courts.roundOf 等と同じく「-」を含まない前提）
    var m = (p.order || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    if (m) {
      courtLabel.textContent = m[1] + 'コート';
      playerOrderLabel.textContent = m[2] + ' ' + m[3] + '巡目 ' + m[4] + '番';
    } else {
      courtLabel.textContent = '';
      playerOrderLabel.textContent = p.order || '';
    }
    playerNameLabel.textContent = p.name || '';
  }
```

置き換え後:

```js
  function updatePlayerLabels(p) {
    // 順番パース: コート-性別-巡目-番号（コート名は Courts.roundOf 等と同じく「-」を含まない前提）
    var m = (p.order || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    // ゼッケンは持っている選手だけ。コートで呼び出すときに使うので順番の右に添える
    // （未設定の選手に「No.」だけが残らないよう、数値のときだけ足す）。
    var bib = (typeof p.bib === 'number') ? '　No.' + p.bib : '';
    if (m) {
      courtLabel.textContent = m[1] + 'コート';
      playerOrderLabel.textContent = m[2] + ' ' + m[3] + '巡目 ' + m[4] + '番' + bib;
    } else {
      courtLabel.textContent = '';
      playerOrderLabel.textContent = (p.order || '') + bib;
    }
    playerNameLabel.textContent = p.name || '';
  }
```

- [ ] **Step 2: 選手一覧の行にゼッケンの列を足す**

`app.js` の `buildPlayerListRow`。置き換え前:

```js
    tr.innerHTML =
      '<td>' + esc(p.order || '') + '</td>' +
      '<td>' + esc(p.name || '') + '</td>' +
```

置き換え後:

```js
    var hasBib = (typeof p.bib === 'number');
    tr.innerHTML =
      '<td>' + esc(p.order || '') + '</td>' +
      // 未設定は薄い「—」（数値なので esc は要らないが、列を空にはしない）
      '<td' + (hasBib ? '' : ' class="no-bib"') + '>' + (hasBib ? p.bib : '—') + '</td>' +
      '<td>' + esc(p.name || '') + '</td>' +
```

- [ ] **Step 3: `scoring.html` の見出しに「ゼッケン」を足す**

置き換え前:

```html
          <tr>
            <th>順番</th>
            <th>選手名</th>
```

置き換え後:

```html
          <tr>
            <th>順番</th>
            <th>ゼッケン</th>
            <th>選手名</th>
```

- [ ] **Step 4: `style.css` に未設定のセルの色を足す**

`.player-list-table td.confirmed { color: var(--score-confirmed); }` の**直後**に足す。

```css
/* ゼッケンが未設定の行（「—」）。入っている行と見分けられるように薄くする。
   選択中の行は .player-list-table tr.current-player td のほうが詳細度が高いので、
   反転した文字色が勝つ（薄いまま読めなくなることはない）。 */
.player-list-table td.no-bib { color: var(--text-muted); }
```

- [ ] **Step 5: ブラウザで確かめる**

`UI確認-E` で「試合開始」まで進め、`http://localhost:3461/scoring.html` を幅 **1024px** で開いて大会と A コートを選ぶ。

- [ ] 選手名バーの上（順番のところ）に `男子 1巡目 1番　No.31` と出る
- [ ] ゼッケンが未設定の選手に切り替えると `男子 1巡目 2番` だけになる（`No.` が残らない）
- [ ] 下部の **選手一覧** を開くと、順番の右に **ゼッケン** の列がある。未設定の行は薄い **—**
- [ ] 選手一覧の行をクリックするとその選手に移る（列を足しても行のクリックが効く）
- [ ] いま採点中の行（反転している行）でもゼッケンが読める
- [ ] ライト／ダークの両方
- [ ] 順位表示（`ranking.html`）・共有（`share.html`）・発表（`present.html`）には**ゼッケンが出ていない**（設計書どおり。これらのファイルは触っていない）

- [ ] **Step 6: コミット**

```bash
git status --porcelain
git diff app.js scoring.html style.css
git add app.js scoring.html style.css
git commit -m "$(cat <<'EOF'
feat: 採点画面にゼッケンを出す

選手名バーの順番ラベルに No.12 を添え（持っている選手だけ）、下部の
選手一覧にゼッケンの列を足す。未設定は薄い「—」。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16（E）: ヘルプに 3 項目・抜刀後の形・試合開始で止まる条件を書く

**Files:**
- Modify: `help.html`（「（a）1人ずつ登録する」「（d）PC の表に打ち込む・Excel から貼り付ける」「技の選び方」「当日の流れ（8つのボタン）」「技の配点を変える」）

> **注意**: `help.html` は長い。編集の直前に該当の `<h3>` を `grep -n` で探し、その周りを読んでから当てること。

- [ ] **Step 1: 「（a）1人ずつ登録する」に 3 項目を足す**

置き換え前:

```html
      <li>新人なら <span class="ui">新人</span> にチェックを入れる。</li>
      <li>技を <span class="ui">①</span> <span class="ui">②</span> <span class="ui">③</span> の枠ごとにタップして選ぶ。</li>
```

置き換え後:

```html
      <li>新人なら <span class="ui">新人</span> にチェックを入れる。</li>
      <li><span class="ui">ゼッケン番号</span> を入れる（1〜9999 の整数。空でも登録できます）。<span class="term">同じ大会の中で同じ番号は使えません。</span>すでに使われている番号を入れると <span class="msg">ゼッケン番号 12 は「山田 太郎」が使っています</span> と出ます。</li>
      <li><span class="ui">級位・段位</span> を入れる（<span class="ui">無級</span> <span class="ui">十級</span>〜<span class="ui">一級</span> <span class="ui">初段</span>〜<span class="ui">十段</span> の候補から選べます。<span class="ui">錬士六段</span> のように自由にも書けます。20 文字まで）。</li>
      <li>真剣を借りる選手は <span class="ui">真剣レンタル</span> にチェックを入れる。チェックすると、技の候補が<span class="term">抜刀後の形</span>だけになります（下の「技の選び方」）。</li>
      <li>技を <span class="ui">①</span> <span class="ui">②</span> <span class="ui">③</span> の枠ごとにタップして選ぶ。</li>
```

- [ ] **Step 2: 「（a）」の下に、必須にできることの断りを足す**

Step 1 で直した `<ul>` の直後の `<figure class="shot-mobile">` の**直前**に足す。

```html
    <div class="note"><span class="term">ゼッケン番号と級位・段位は、空のままでも登録できます。</span>PC 用の運営画面の <span class="ui">基本情報</span> で <span class="ui">ゼッケン番号を必須にする</span> / <span class="ui">級位・段位を必須にする</span> にチェックを入れると、一巡目にその項目が空の選手がいる間だけ <span class="ui">試合開始 ▶</span> で止まります（§2 の「当日の流れ」）。登録の途中で止められることはありません。</div>
```

- [ ] **Step 3: 「（d）PC の表に打ち込む・Excel から貼り付ける」を 10 列にする**

置き換え前:

```html
    <p>PC 用の運営画面（<code>desk.html</code>）の <span class="ui">選手登録</span> の区画は、1人1行の<span class="term">編集できる表</span>です。名前・コート・性別・新人・技1〜3のセルをその場で直せます。直したセルから離れる（Tab や Enter、ほかの場所をクリック）と、その項目だけが保存されます。</p>
```

置き換え後:

```html
    <p>PC 用の運営画面（<code>desk.html</code>）の <span class="ui">選手登録</span> の区画は、1人1行の<span class="term">編集できる表</span>です。名前・ゼッケン・級位段位・レンタル・コート・性別・新人・技1〜3のセルをその場で直せます。直したセルから離れる（Tab や Enter、ほかの場所をクリック）と、その項目だけが保存されます。</p>
    <p>表の上には <span class="msg">ゼッケン未入力 3　級位段位未入力 1　レンタル不可の形 2</span> のように、<span class="term">このままでは試合を開始できない件数</span>が赤く出ます。該当するセルは赤い枠になります（必須なのに空は点線、レンタルの選手が選べない形は実線）。0 件になると消えます。</p>
```

置き換え前:

```html
      <li>Excel で <span class="term">名前・コート・性別・新人・技1・技2・技3</span> の 7 列を、この順に並べて選び、コピーします。</li>
```

置き換え後:

```html
      <li>Excel で <span class="term">名前・コート・性別・新人・技1・技2・技3・ゼッケン・級位段位・レンタル</span> の 10 列を、この順に並べて選び、コピーします。右側の列は無くてもかまいません（7 列までのこれまでの名簿もそのまま読めます）。</li>
```

置き換え前:

```html
      <li>性別は <span class="ui">女子</span> <span class="ui">女</span> <span class="ui">F</span> で女子、ほかは男子です。新人は <span class="ui">新人</span> <span class="ui">○</span> <span class="ui">1</span> <span class="ui">true</span> で新人です。</li>
```

置き換え後:

```html
      <li>性別は <span class="ui">女子</span> <span class="ui">女</span> <span class="ui">F</span> で女子、ほかは男子です。新人は <span class="ui">新人</span> <span class="ui">○</span> <span class="ui">1</span> <span class="ui">true</span> で新人です。レンタルは <span class="ui">レンタル</span> <span class="ui">あり</span> <span class="ui">○</span> <span class="ui">1</span> <span class="ui">true</span> でレンタルです。</li>
      <li>ゼッケンは数字だけです（数字以外は <span class="msg">ゼッケン番号は数字で</span> で断られます）。<span class="term">貼り付けた行どうしの重複も、すでに登録されている選手との重複も断ります。</span></li>
      <li>レンタルの行に<span class="term">抜刀後でない形</span>が書いてあると、その行は赤くなって登録できません。</li>
```

- [ ] **Step 4: 「技の選び方」にレンタルの断りを足す**

置き換え前（既にある `<div class="note">` の直後に新しい `<div class="note">` を足す）:

```html
    <div class="note"><span class="term">男女で配点が違う技があります。</span><span class="ui">胸尽くし</span>・<span class="ui">水月</span>・<span class="ui">破図味</span> は技リストでは <span class="ui">(男)</span> <span class="ui">(女)</span> の2つの行に分かれていますが、この画面には選手の性別に合う方だけが接尾辞なしで出ます（もう一方は選択肢に出ません）。</div>
```

置き換え後:

```html
    <div class="note"><span class="term">男女で配点が違う技があります。</span><span class="ui">胸尽くし</span>・<span class="ui">水月</span>・<span class="ui">破図味</span> は技リストでは <span class="ui">(男)</span> <span class="ui">(女)</span> の2つの行に分かれていますが、この画面には選手の性別に合う方だけが接尾辞なしで出ます（もう一方は選択肢に出ません）。</div>
    <div class="note"><span class="term">真剣レンタルの選手は、抜刀してからの形だけを選べます。</span><span class="ui">真剣レンタル</span> にチェックが入っている選手の技の候補は、技リストで <span class="ui">抜刀後</span> にチェックが付いている形だけになります（どの形が「抜刀後」かは §3 の「技の配点を変える」で運営が決めます）。すでに選んである技は候補に残りますが、抜刀後でない形が残っていると <span class="ui">試合開始 ▶</span> で止まります。</div>
```

- [ ] **Step 5: 「当日の流れ（8つのボタン）」の 1 番目に止まる条件を足す**

置き換え前:

```html
      <li><span class="ui">試合開始 ▶</span> — <span class="msg">一巡目 n名。技が未入力の選手が m名います。試合を開始しますか？</span> の確認で <span class="ui">OK</span>。<span class="ui">一巡目 進行中</span> になり、採点画面が別のウィンドウで開きます。</li>
```

置き換え後:

```html
      <li><span class="ui">試合開始 ▶</span> — <span class="msg">一巡目 n名。技が未入力の選手が m名います。試合を開始しますか？</span> の確認で <span class="ui">OK</span>。<span class="ui">一巡目 進行中</span> になり、採点画面が別のウィンドウで開きます。</li>
    </ol>
    <div class="note"><span class="term">試合開始で止まることがあります。</span>次のどれかに当てはまる選手がいると、<span class="msg">ゼッケン番号が未入力: 3 名（山田 太郎、…）</span> のように人数と名前が出て、<span class="term">状態は「準備中」のまま進みません</span>（「このまま進む」はありません）。直すか、必須の設定を外してから押し直してください。
      <ul>
        <li><span class="ui">基本情報</span> で <span class="ui">ゼッケン番号を必須にする</span> にしていて、一巡目にゼッケンが空の選手がいる。</li>
        <li><span class="ui">級位・段位を必須にする</span> にしていて、一巡目に級位・段位が空の選手がいる。</li>
        <li><span class="ui">真剣レンタル</span> の選手に、<span class="ui">抜刀後</span> でない形が入っている。</li>
      </ul>
      PC 用の <span class="ui">選手登録</span> の表では、同じ件数が表の上に赤く出ます（§1 の（d））。
    </div>
    <ol start="2">
```

> **注意**: `<ol>` を 2 つに割るので、2 番目の `<ol>` に `start="2"` を付けている。**貼ったあと、ブラウザで番号が 1, 2, 3 … 8 と続いていることを必ず目で確かめること。**

- [ ] **Step 6: 「技の配点を変える」に抜刀後の形を足す**

置き換え前:

```html
      <li><span class="ui">別の大会からコピー</span> で、ほかの大会の配点を表に読み込めます。<span class="ui">保存</span> を押すまでは反映されません。</li>
    </ul>
```

置き換え後:

```html
      <li><span class="ui">別の大会からコピー</span> で、ほかの大会の配点を表に読み込めます。<span class="ui">保存</span> を押すまでは反映されません。</li>
      <li>いちばん右の <span class="ui">抜刀後</span> は「抜刀してからの形」の印です。<span class="term">真剣レンタルの選手は、ここにチェックが付いている形だけを選べます。</span>どの形を抜刀後とするかは大会ごとに運営が決めます（既定ではどれも付いていません）。</li>
    </ul>
```

- [ ] **Step 7: ブラウザで確かめる**

`http://localhost:3461/help.html` を開く。

- [ ] 目次からリンクで飛べる（見出しの構造を壊していない）
- [ ] 「（a）1人ずつ登録する」に ゼッケン・級位段位・レンタル の 3 項目と、必須にできることの断りが出る
- [ ] 「（d）PC の表に…」が 10 列になっていて、件数と赤枠の説明がある
- [ ] 「技の選び方」にレンタルの断りが出る
- [ ] 「当日の流れ（8つのボタン）」の番号が **1 から 8 まで続いている**（Step 5 の `start="2"`）。止まる条件の枠がその間に入っている
- [ ] 「技の配点を変える」に「抜刀後」の説明がある
- [ ] 幅 375px と 1280px の両方、ライト／ダークの両方で崩れない

- [ ] **Step 8: コミット**

```bash
git status --porcelain
git diff help.html
git add help.html
git commit -m "$(cat <<'EOF'
docs: ヘルプにゼッケン・級位段位・レンタルと抜刀後の形を書く

選手を登録する・技の選び方・貼り付けの列・技の配点を変える・当日の流れ
（試合開始で止まる条件）に追記する。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17（E）: トラック E の通しの確認

**Files:** なし（確認だけ。直すところが見つかったら Task 12〜16 のファイルだけを直して追加でコミットする）

- [ ] **Step 1: 自動テスト**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`（E は純粋関数を足さないので、E のぶんでは増えない）

- [ ] **Step 2: 設計書の「手動確認」のうち E のぶんを通す**

Task 1 が入っていることを確かめてから（入っていなければ `techniques.html` で `破図味(男)` `破図味(女)` に「抜刀後」を付ける）。

- [ ] 形マスタで `破図味` に「抜刀後」を付ける → **スマホの技ピッカーにレンタルの選手は `破図味` だけ**が出る → レンタルを外すと全部出る
- [ ] ゼッケンの重複が**スマホのフォーム**（追加・編集の両方）で拒まれる
- [ ] 採点画面のバーに `No.12`、下部の選手一覧にゼッケンの列
- [ ] スマホの選手表にゼッケンの列が出て、行をタップしたシートで 級位段位・レンタルが見える
- [ ] **375px のスマホフォーム**で、名前〜技までの欄が横に溢れない
- [ ] ヘルプの追記が読める
- [ ] ライト／ダークの両方

- [ ] **Step 3: 保留したファイルがあれば報告する**

他人のハンクが混ざってコミットできなかったファイルがあれば、指揮官に報告する。

---

## 最後に（3 トラックが揃ってから）

C・D・E が全部コミットされたら、指揮官が次を通す（各トラックの担当者は自分のぶんを終えたら報告して止まる）。

- [ ] `http://localhost:3461/test.html` で `Result: N+3 passed, 0 failed`
- [ ] 設計書「手動確認」の 6 項目を最初から最後まで通す（形マスタ → レンタルの絞り込み → 必須と試合開始 → 重複 → 採点画面とカード → CSV の往復 → 375px と 1280px）
- [ ] `git status --porcelain` に、誰も拾っていない変更が残っていないこと




