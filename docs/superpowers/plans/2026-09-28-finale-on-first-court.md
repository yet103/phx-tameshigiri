# 決戦を先頭コートの末尾で行う（決戦コートの廃止） 実装計画

**Goal:** 暫定ベスト8 の二巡目の行を専用コート「決戦」（`settings.finalCourt`）ではなく、先頭のコート（通常 A）の男子の二巡目の末尾（続き番号）に置く。決戦かどうかはコート名ではなく行の印 `finalist: true` で判定する。

**設計書（正）:** `docs/superpowers/specs/2026-09-28-finale-on-first-court-design.md`
（置き換え元: `docs/superpowers/specs/2026-09-22-round2-prep-and-finale-design.md` の「決戦のコート」）

**Tech Stack:** 素の HTML/CSS/JS（IIFE）＋ Node/Express。テストは `test.html`（ブラウザ）と `npm test`（サーバーの認証・静的配信）。

**運用ルール:**
- commit は `git commit -m "…" -- <ファイル>`（pathspec）。新規ファイルだけ `git add <ファイル>`。`git reset` は使わない。
- 開発サーバー（3461）は別セッションが起動していて止められず、`server/index.js` の変更は反映されない。サーバーを変えた後のテスト・検証は自分で `PORT=3470` のサーバーを起動して行い、終わったら止める（データディレクトリは共有なので既存の大会には触らない）。
- 既存の大会「テスト大会」「横浜大会」「横浜大会2」「鎌倉大会（シミュレーション）」「第10回全日本試し斬り大会」「テスト用 技リストなし雛形」は触らない。検証用の大会は「決戦確認 opus」で作り、終わったら消す。
- ブラウザツールは編集のたびに新しいタブで開く（bfcache 対策）。

**順序の方針:** 各 commit の時点で test.html が通るように、先に新しい関数を足し（Task 1）、呼び出し側を順に置き換え（Task 2〜6）、最後に古い関数とそのテストを消す（Task 7）。

---

## Task 1: 共有ロジックに新しい判定を足す（`status.js` / `courts.js`）

**Files:** `status.js`, `courts.js`, `test.html`

- [ ] `status.js` に私物の `courtOf(player)` を足す（`courts.js` の `Courts.courtOf` と同じ規則: `order` の先頭セグメント、無ければ `'未分類'`）。サーバーは `courts.js` を読めないので、`roundOf` / `isScored` と同じく複製する。
- [ ] `EventStatus.isPlayerScorable(status, player)`: `player` が無ければ `true`。`round2` → `player.finalist !== true`、`round2_final` → `player.finalist === true`、他は `true`。
- [ ] `EventStatus.finaleCourt(players)`: `finalists(players)` を（コート → 性別 → 番号）の順で比べた先頭の行のコート名。無ければ `''`。`finalists` は二巡目（`ORDER_PATTERN` が解析できる行）だけを返すので、比較キーは必ず取れる。
- [ ] `EventStatus.firstCourt(players, extraCourts)`: 選手の `courtOf` と `extraCourts`（配列以外は無視・文字列で空でないものだけ）を集め、`'未分類'` を除いて文字列の昇順（`Array.prototype.sort` の既定と同じ UTF-16 順）の先頭。無ければ `''`。
- [ ] `courts.js` に `Courts.finaleCourt(players)`（`EventStatus.finaleCourt` をそのまま返す）を足し、公開する。
- [ ] `test.html`（status.js の節、`finalists` のテストの後）に足す:
  - `isPlayerScorable`: round2 は印のある行 false・無い行 true、round2_final は逆、round1 / round1_done は true、player が無ければ true。
  - `finaleCourt`: 印のある二巡目の行のコート（`A-男子-2-9` / `A-男子-2-10` → `'A'`）、印が無ければ `''`、一巡目に印が付いていても拾わない、既存データのコート「決戦」の行なら `'決戦'`。`Courts.finaleCourt` も同じ値。
  - `firstCourt`: 選手のコートと extraCourts の和の先頭、未分類は除く、選手がいなければ extraCourts の先頭、何も無ければ `''`。いくつかの入力で `Courts.listFrom(players, extra).filter(c => c !== '未分類')[0] || ''` と一致すること。
- [ ] 確認: test.html を開いて failed 0。
- [ ] Commit: `feat: 決戦の判定を行の印で行う関数（isPlayerScorable / finaleCourt / firstCourt）を足す`

## Task 2: サーバー（`server/index.js`）

**Files:** `server/index.js`, `api.js`（コメントだけ）, `test.html`

- [ ] `generateRound2` / `reorderRound2`: `EventStatus.finalCourtOf(event)` を `EventStatus.firstCourt(src, event.settings && event.settings.courts)` に置き換える（変数名は `finaleCourt`）。通常の行（`plain`）を先に採番してから候補（`finals`）を採番しているので、候補は先頭コートの男子の二巡目の続き番号になる（`nextOrderNumber` は最大+1）。コメント「決戦は決戦コートで1から」を直す。
- [ ] `sanitizeFinalCourt` / `nonFinalCourtNames` を消す。
- [ ] `POST /api/events`（大会ファイルの保存）: `settings.finalCourt` の取り込みを消す。
- [ ] `PATCH /api/events/:id`: `finalCourt` の取り込み・`finale_exists`・`court_conflict` を消し、`settings` は `{ requireBib, requireRank, courts }` だけ保存する（届いた `finalCourt` は無視。既存大会に残っている `finalCourt` キーも、settings を送る PATCH で自然に落ちる）。
- [ ] `POST /api/events/:id/copy`・`from-template`（あれば）・バンドルの書き出し／取り込みから `finalCourt` を落とす。
- [ ] `computeFinale`: `court: EventStatus.finaleCourt(players)`。コメント「決戦コートの番号順」を「先頭コートの番号順」に。
- [ ] `api.js` の `updateEventInfo` のコメントから `finale_exists` / `court_conflict` を消す。
- [ ] `test.html`:
  - 消す: 「決戦コートの名前（settings.finalCourt）」の節（PATCH の保存・据え置き・`-` の 400・空文字・`court_conflict` 2 件・複製・バンドル）と「レビュー指摘B（`finale_exists`）」の節。
  - 足す（消した節の代わり）: `finalCourt` を PATCH で送っても保存しない（settings は `{requireBib, requireRank, courts}` だけ）、`courts` に「決勝」があっても `finalCourt: '決勝'` を送って 400 にならない、バンドルの `settings.finalCourt` を取り込まない、POST /api/events の `settings.finalCourt` を保存しない。
  - 直す: 二巡目生成の期待値を先頭コートの続き番号に（`決戦8名` → `A-男子-2-3〜10`、`二巡目テスト` → `A-男子-2-1〜4`（B コートの M4 も A へ）、差分追加 → `A-男子-2-1〜3`、未分類 → `A-男子-2-1`）。「決戦コートの名前は settings.finalCourt に従う」は「先頭コートに置く（settings.finalCourt は見ない）」に直す。`finale.court` は `'A'`。
  - 足す: 候補の行のコートが `settings.courts` を含めた先頭（例: 選手は B・C、settings.courts に A → 候補は A）。`reorderRound2` 後も候補が先頭コートの男子の通常の行の後ろ（続き番号）に並ぶこと（A・B に男子 10 名以上で、一巡目に戻して得点を直して再度終了）。
- [ ] 確認: `PORT=3470` で自分のサーバーを起動し、`http://localhost:3470/test.html` で failed 0。`npm test`。
- [ ] Commit: `feat: 暫定ベスト8 を先頭コートの二巡目の末尾に置き、settings.finalCourt を廃止する（サーバー）`

## Task 3: 採点画面（`app.js` / `style.css`）

**Files:** `app.js`, `style.css`

- [ ] `scoringOpenHere()`: `EventStatus.isPlayerScorable(currentStatus(), visiblePlayers[currentIndex])`。`currentCourtName()` は使わなくなるので消す。
- [ ] `renderStatusBanner()`: 採点できる状態で `scoringOpenHere()` が false のとき、`round2` は「この選手は決戦（暫定ベスト8）です。他の選手が終わり、運営画面で「決戦を開始」を押すと採点できます」、`round2_final` は「決戦 進行中。採点できるのは決戦（暫定ベスト8）の選手だけです」。
  - **設計書に無い判断:** `round2_final` で選んだコートに候補がいない（一覧が空）ときも、同じ文言に候補のコートを添えて閉じたバナーにする（「…選手だけです（A コート）」）。空のコートで「決戦 進行中」と緑のバナーが出ると、採点できるように見えるため。
- [ ] `filterForStatus()`: `round2` はその巡目の全員を、印の無い行 → 印のある行の順に並べ直す（安定。データの並びは生成順で通常すでに末尾だが、差分追加などで崩れても候補が末尾に来るように）。`round2_final` は印のある行だけ。
- [ ] 選手一覧 `buildPlayerListRow()`: 印のある行は番号の右に「決戦」の印（`span.finale-mark`）。`round2` のときは `tr.finale` を付けて薄くする。
- [ ] `style.css`: `.player-list-table tr.finale td { color: var(--text-muted); }` と `.finale-mark`（小さな枠付きの文字）。選択中の行（`tr.current-player`）が勝つよう、`tr.current-player` の規則より前に置く。
- [ ] コメントの古い記述（「決戦のコート制限」「決戦コート」）を直す。
- [ ] 確認: ブラウザで round2 の A コート → 候補が末尾に薄く「決戦」の印、開くとロック＋バナー。通常の行は採点できる。round2_final → 候補だけ。
- [ ] Commit: `feat: 採点画面で決戦を行の印で判定し、二巡目は候補を末尾に薄く出す`

## Task 4: PC 運営（`desk-match.js` / `desk-setup.js`）

**Files:** `desk-match.js`, `desk-setup.js`

- [ ] `desk-match.js` の `buildCourts`: 通常のカードは印の無い行だけで数える（`Courts.courtProgress(非候補, round)`、コートの並びは `Courts.listFrom(非候補, extraCourts)` — 既存データのコート「決戦」が 0/0 の通常カードとして出ないように）。候補がいて `round === 2` のときだけ、決戦のカード 1 枚（`court: Courts.finaleCourt(players)`、`total/scored` は候補だけ、`finale: true`）を別枠に。
  - 見出し: `決戦（暫定ベスト8・A コートの最後）`、`round2` のときは末尾に「　開始前」。
  - `round2_final` は決戦の枠を先に、他は `<details>` に畳む（従来どおり）。
  - `buildCourtCard`: 真剣レンタルの人数は `row.finale` に合わせて候補／非候補を数える。「いま採点中」は live の選手の印がカードと合うときだけ出す（`round2` で A の通常の選手を採点中のとき、決戦のカードに名前が出ないように）。
- [ ] 二巡目の形登録の注記（`matchFinaleNote`）: 「暫定ベスト8（一般男子・一巡目の得点上位）。A コートの二巡目の最後に斬ります。」（コート名は `Courts.finaleCourt`）。
- [ ] `desk-setup.js`: 「決戦コートの名前」の入力欄・注記・保存時の検証と `finalCourt` の送信を消す。コメントを直す。
- [ ] 古いコメント（「決戦コートのカード」など）を直す。
- [ ] 確認: `desk.html#match/<id>` の round2 / round2_final 表示、`desk.html#setup/<id>` に決戦コートの欄が無い。
- [ ] Commit: `feat: PC 運営で決戦のカードを行の印で分け、決戦コートの名前の欄を消す`

## Task 5: スマホ運営（`admin-round.js` / `admin.js`）

**Files:** `admin-round.js`, `admin.js`

- [ ] `admin-round.js`: 決戦の見出しを「決戦（暫定ベスト8）　A コートの最後に斬ります」に（`Courts.finaleCourt(players)`）。
- [ ] **設計書に無い判断:** `admin.js`（スマホ運営の基本情報シート）にも同じ「決戦コートの名前」欄があるので消す。設計書の「入力欄を消す」は PC の基本情報だけを挙げているが、`finalCourt` は廃止でサーバーが無視するため、残すと保存しても効かない欄になる。
- [ ] 確認: `admin.html#round/<id>` の表示。
- [ ] Commit: `feat: スマホ運営の決戦の見出しを先頭コートにし、決戦コートの名前の欄を消す`

## Task 6: ヘルプ・配信ボードのコメント（`help.html` / `board.js` / `board.html`）

**Files:** `help.html`, `board.js`, `board.html`

- [ ] `help.html`: 「決戦コートで1人ずつ斬ります。採点できるのは決戦コートだけです」「決戦コートに移ります」「決戦コートはまだ採点できません」「専用のコートに移します」「決戦コートの名前は…」「配信用ボード（決戦コートを映しているとき）」「`board.html#（トークン）/決戦`」、流れ図の「暫定ベスト8 が決戦コートで斬る」を「A コートの最後」の説明に直す。「決戦コートの名前」の項目は消す。
- [ ] `board.js` / `board.html`: 挙動は変えない。コメントの「決戦コート」を「候補のコート（通常は A）」に直すだけ。
- [ ] Commit: `docs: ヘルプの決戦の説明を「A コートの最後に斬る」に直す`

## Task 7: 古い関数とテストを消す

**Files:** `status.js`, `courts.js`, `test.html`

- [ ] `status.js`: `DEFAULT_FINAL_COURT`・`finalCourtOf`・`scoringCourtFilter`・`isCourtScorable` を消す。`isScoringOpen` のコメント（「決戦コートだけ」）を直す。
- [ ] `courts.js`: `Courts.finalCourtOf` を消す。
- [ ] `grep -rn "finalCourtOf\|scoringCourtFilter\|isCourtScorable\|finalCourt"` で `.claude/`・`docs/` 以外に残りが無いことを確かめる。
- [ ] `test.html`: `finalCourtOf`（EventStatus・Courts）・`scoringCourtFilter`・`isCourtScorable` のテストを消す。`Board.finaleFor` のテストは `court: 'A'` に直し、既存データのコート「決戦」でも動く 1 件を残す。
- [ ] 確認: 3470 の test.html で failed 0、`npm test`。
- [ ] Commit: `refactor: 決戦コートの関数（finalCourtOf / scoringCourtFilter / isCourtScorable）を消す`

## Task 8: 通しの検証（commit なし）

- [ ] 3470 のサーバーで「決戦確認 opus」を practice テンプレートから作り、A・B に男子 10 名以上・女子数名（級位・段位付き）。一巡目を採点 →「一巡目を終了」→ 暫定ベスト8 が `A-男子-2-(続き番号)` で `finalist: true`。
- [ ] round2: `scoring.html#event/<id>/A` で候補が末尾に薄く「決戦」、採点できない。通常の行は採点できる。
- [ ] 「決戦を開始」→ 候補だけが一覧に出て採点できる。ranking の `finale.court` が `'A'`。
- [ ] `desk.html#match/<id>`・`admin.html#round/<id>`・`desk.html#setup/<id>`、`board.html#<token>/A` の決戦の表。
- [ ] 一巡目に戻して得点を直し、再度「一巡目を終了」→ 候補が A の末尾に付け直される。
- [ ] 検証用の大会を消し、3470 のサーバーを止める。

## 既知の制限（設計書の範囲外として残すもの）

- 「二巡目を生成」の差分追加（`force`、作り直さない経路）で先頭コートに通常の男子の行が足されると、その行は既存の候補の後ろの番号になる（採番は最大+1）。採点画面の一覧は Task 3 の並べ直しで候補が末尾に来るが、番号は候補より大きい。差分追加は一巡目終了の後に選手を足した例外的な操作で、誰も採点していなければ「一巡目に戻して再度終了」で付け直せる。
- `finale.rows[].order` は先頭コートでの番号（例: 9〜16）になる。発表・共有の未採点の行は「9番」のように出る（採点画面・コートでの呼び出しと同じ番号）。形は変えない（設計書「変えないこと」）。
