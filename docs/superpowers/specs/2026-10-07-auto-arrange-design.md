# 選手登録の自動整列（コートの振り分けと試技順）

日付: 2026-10-07
ユーザー要望: 「選手登録で、自動整列機能を。ゼッケン順／奇数を A、偶数を B などの自動振り分けを。提案ください。UX」→ 提案 A（ダイアログで振り分けと試技順を 1 回で適用、プレビュー付き、元に戻す）で決定。ゼッケンの無い選手は「振り分けの対象から外し、適用後に赤く示して手で直してもらう」。UI ラフ（帯のボタン・ダイアログ・適用後の赤枠）を承認。

## 1. 決めたこと

- 選手登録（PC 運営 desk-players.js）の見出しの帯に **「⚙ 自動整列」** ボタン。**準備中（draft）だけ**押せる（それ以外は disabled、title「準備中だけ使えます」）。スマホ運営（admin-players.js）には付けない。
- ダイアログ（`Desk.openDialog`、題「自動整列（一巡目）」）で 2 つを選ぶ。
  - **コートの振り分け**: 変えない ／ ゼッケンの奇数 → A、偶数 → B ／ 名簿順に交互 ／ 前半・後半で等分
  - **各コートの試技順**: ゼッケン順 ／ 名前順（五十音）／ 今の順のまま
  - 既定は「ゼッケンの奇数 → A、偶数 → B」と「ゼッケン順」。文言はコート名で変わる（2 コート: 「奇数 → A、偶数 → B」、3 コート以上: 「ゼッケンを 3 で割った余りで（余り 1 → A、2 → B、0 → C）」）。コートが 1 つのときは振り分けのラジオを disabled にして「コートが 1 つなので振り分けはありません」と添える（既定は「変えない」。試技順だけ使える）。
- 選択を変えるたびに**プレビュー**を更新する。コートごとに「A コート　17 名」と先頭 4 名（「No.1　山田 太郎」。ゼッケン無しは名前だけ）と「… ほか n 名」。対象外の選手がいれば警告の 1 行「ゼッケン未登録 3 名は対象外です。今のコートの末尾に残し、適用後に赤く示します」。
- **適用**で 1 回の API に送り、トースト「自動整列しました」。帯に **「↶ 元に戻す」** が出て、適用前の並びを 1 回だけ戻せる（次に自動整列を適用し直す・区画を離れる・大会を切り替える・ドラッグで並べ替える・行のコートを変えると消える）。
- **ゼッケン未登録の扱い**（ゼッケンを使う規則のとき）: 振り分けと並べ替えの対象から外し、今のコートの末尾に今の相対順で残す。適用後、その行を赤枠（`desk-row-attention`）にして、行の左に短い案内「ゼッケンを入れるかコートを選んでください」を出す。赤枠は画面の状態として持ち、表を描き直しても残る。その行のゼッケンかコートを保存したら消える。区画を離れると消える。
- 対象が 0 名のときは「適用」を disabled にして警告「整列できる選手がいません（一巡目でコートが決まっている選手が対象です）」。
- 対象は**一巡目の行で order が読める行**だけ。コート名が使えない行（`未分類-…`、33 文字以上など。`isValidCourt` を通らない）も対象外（クライアントとサーバーで同じ規則）。二巡目の行と、order が読めない行（CSV 由来の空 order）は触らない（読めない行はプレビューに「コート未定 n 名は対象外です」と出す）。
- 男女を分ける大会では、帯（コート×性別）の中で並ぶ（番号は性別ごと）。混合では男女通しで並ぶ。振り分け（奇数偶数・交互・等分）は性別に関わらず全員で行う。

## 2. 規則（courts.js の純粋関数。test.html で固定）

`Courts.arrangePlayers(players, courts, opts)` → `{ layout: [{ court, ids }], skipped: [id…], unassigned: [id…] }`

- `players`: 大会の選手全員。対象は `roundOf === 1` かつ `orderKey(p).sex !== 2`（order が読める）。それ以外は `unassigned`（読めない一巡目の行）か無視（二巡目）。
- `courts`: 振り分け先のコートの並び（`Courts.listFrom(players, settings.courts)` から未分類を除いたもの。先頭が A）。
- `opts.assign`: `'keep' | 'bibParity' | 'alternate' | 'halves'`
  - `keep`: 今のコートのまま。
  - `bibParity`: ゼッケンを `courts.length` で割った余りで振る（余り 1 → courts[0]、2 → courts[1]、…、0 → 末尾のコート。2 コートなら奇数 A・偶数 B）。ゼッケン無しは `skipped`。
  - `alternate`: 対象を名簿順（`compareOrder`）に並べ、i 番目を `courts[i % courts.length]` へ。
  - `halves`: 名簿順に並べ、`courts.length` 等分して順に（端数は前から）。
- `opts.order`: `'bib' | 'name' | 'keep'`
  - `bib`: ゼッケン昇順。ゼッケン無しは `skipped`（振り分けの `skipped` と合わせて 1 つの集合）。
  - `name`: `localeCompare(…, 'ja')`。
  - `keep`: 今の試技順（`compareOrder`）。
- `skipped` の選手は、今のコートの `ids` の**末尾**に今の相対順で付ける（コートは変えない）。
- `layout` は `courts` の順。選手が 0 名のコートも `{ court, ids: [] }` で含める（サーバーが「全員」を検証できるように）。コート一覧に無いコートに今いる選手（例: 設定から外したコート）は `keep` のときだけそのコートの `layout` を足す。
- 同点（同じゼッケンはあり得ない。同じ名前）は `compareOrder` で安定させる。

プレビューの文言は `Courts.arrangePreview(layout, players)` → `[{ court, count, heads: [string…] }]` で作る。

## 3. サーバー

`POST /api/events/:id/players/arrange`。本文 `{ layout: [{ court, ids }] }`。

- 検証: `layout` は配列・コート名は `isValidCourt`・重複なし。`ids` を全部合わせた集合が「一巡目で order が読める行」の集合と**過不足なく一致**しなければ 400 `reason: 'arrange_mismatch'`（「整列する選手が現在の登録と一致しません。画面を読み直してからやり直してください」）。
- 状態が draft でなければ 409 `reason: 'not_draft'`（「自動整列は準備中だけ使えます」）。確定済みは従来の `rejectIfLocked` が先。
- 各 `{ court, ids }` について順に、`ids[i]` の order を `buildOrder(court, genderSeg(event, p.isFemale), 1, n)` にする。番号 n は コート×性別の段 ごとに 1 から（分ける大会では男子・女子が別々に 1 から。混合は通し）。
- `rev` は上げない（得点・技は変わらない）。`updatedAt` は更新。応答 `{ success: true, players }`。
- 「元に戻す」は画面が持つ適用前の `layout` を同じ API に送る。他の端末が間に行を足していれば 400 `arrange_mismatch` になるので、画面は「読み直してください」と案内して読み直す。

## 4. 画面（desk-players.js）

- 見出しの帯（「📋 貼り付けて追加」「📄 選手を CSV から取り込む」の並び）に「⚙ 自動整列」。`EventStatus.of(ctx.event) === 'draft'` でなければ disabled。
- ダイアログ本体: ラジオ 2 組（`desk-form` の作法）、プレビュー（コートごとの小さな箱）、警告の 1 行。ボタンは「適用」（`desk-btn primary`）。✕ でやめる。
- 適用: `dialog.lock(true)` → `Api.arrangePlayers(ctx.eventId, { layout })` → `ctx.isStale()` を見る → 失敗なら reason ごとに alert（`not_draft`・`arrange_mismatch`・`locked`・通信）→ 成功なら `undoLayout` に適用前の layout（`Courts.arrangePlayers(players, courts, { assign: 'keep', order: 'keep' })` の結果）、`attentionIds` に `skipped` を入れ、トースト、`Desk.reloadEvent()`。
- 帯の「↶ 元に戻す」: `undoLayout` があるときだけ出す。押すと同じ API に送り、成功でトースト「元に戻しました」、`undoLayout` と `attentionIds` を消す。
- 赤枠: `buildRow` で `attentionIds` に含まれる行に `tr.classList.add('desk-row-attention')` と、名前セルの下に小さな案内（`desk-row-attention-note`）。ゼッケンかコートのセルを保存したら `attentionIds` から外す（`saveCell` の成功経路）。`render` の入口で大会が変わっていたら両方を空にする。
- 既存の `redrawTable`/`fillRows` はそのまま。赤枠は行の class だけなので帯や並べ替えに影響しない。

## 5. API ラッパー（api.js）

`Api.arrangePlayers(eventId, { layout })` → `{ ok: true, players } | { ok: false, status, reason, error }`（`reorderPlayers` と同じ形）。

## 6. ヘルプ（help.html）

選手登録の節に「⚙ 自動整列」の段落: 準備中だけ、2 つの選択肢、プレビュー、ゼッケン未登録は対象外で赤枠、元に戻すは 1 回、二巡目は対象外。

## 7. テスト

- `Courts.arrangePlayers`: 4 つの振り分け × 3 つの並び、ゼッケン無しの除外と末尾維持、3 コートの余り、等分の端数、二巡目と読めない order の除外、混合と分ける大会で同じ layout（番号の違いはサーバー側）。
- `Courts.arrangePreview` の文言。
- API: 正常（分ける大会で性別ごとに 1 から・混合で通し）、`arrange_mismatch`（1 人欠け・知らない id・重複）、`not_draft`、`locked`、コート名の不正、元に戻す往復で order が完全に戻る。

## 8. 変えないもの

ドラッグ並べ替え、行ごとのコート選択、貼り付け・CSV の取り込み、スマホ運営、二巡目の生成規則。
