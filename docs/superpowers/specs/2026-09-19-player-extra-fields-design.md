# 選手の追加項目: ゼッケン番号・級位段位・真剣レンタル（形マスタの「抜刀後の形」）

**日付**: 2026-09-19
**対象**: phx-tameshigiri（試し斬り採点システム）
**前提となる設計書**: [2026-09-19-ux-feedback-round2-design.md](2026-09-19-ux-feedback-round2-design.md)（技の選択肢を性別で絞る仕組みを流用する）

## 決定事項（ユーザーと確定）

| 論点 | 決定 |
|---|---|
| ゼッケン番号 | 選手の項目 `bib`。**整数のみ**（1〜9999）。空は未設定。**同じ大会内で重複不可**（サーバーが 409） |
| 級位・段位 | 選手の項目 `rank`。文字列（20 文字まで）。候補をプルダウンで出すが自由入力も可 |
| 真剣レンタル | 選手の項目 `rental`。真偽値、既定 false。大会の設定は無し（常に任意） |
| 必須の設定 | 大会の `settings.requireBib` / `settings.requireRank`（既定 false）。**登録は空でも通し、「試合開始」で止める** |
| レンタルの縛り | 形マスタ（技と配点）の各技に `drawn`（**抜刀後の形**なら true。既定 false）。**レンタルの選手には `drawn` の技だけを出す**。既定の技リストにも分類は持たせず、運営者が形マスタで設定する |
| 試合開始の判定 | 必須項目の未入力と、レンタルなのに抜刀の形を選んでいる選手を数え、1 人でもいれば **進めない**（alert で人数と名前を出す。確認して進む形にはしない）。必須を外すか入力すれば通る |
| 表示 | 採点画面の選手名バーにゼッケン（`No.12`）。試合進行のコート別カードに「真剣レンタル n 名」。結果・発表・共有には出さない |

## データ

```
players[] に  bib: number | null    ゼッケン番号（整数 1〜9999。無ければキーを持たない）
              rank: string          級位・段位（空文字可、20 文字まで）
              rental: boolean       真剣レンタル（既定 false）
event に      settings: { requireBib: boolean, requireRank: boolean }   無ければ両方 false
techniques[] に drawn: boolean      抜刀後の形（既定 false）
```

- 既存データは項目が無いだけで読める（移行不要）。`bib` が無い・null は「未設定」
- 二巡目生成は `bib` `rank` `rental` を一巡目の行から複製する（`sourcePlayerId` の行と同じ値）
- コピー（`POST /api/events/:id/copy`）は `settings` と `techniques`（`drawn` を含む）を複製。`withPlayers` のとき `bib` `rank` `rental` も複製
- バンドル（`GET …/bundle` / `POST /api/events/import`）は `settings` と選手の 3 項目、技の `drawn` を含める。古いバンドルには無くてよい
- CSV エクスポート（`GET …/export`）の列に `ゼッケン` `級位段位` `レンタル`（`○`/空）を末尾に足す。CSV インポート（`POST …/import`）は列があれば読む（無ければ従来どおり）。簡易 7 列形式（名前,コート,性別,技①,技②,技③,新人）は変えず、その後ろに `ゼッケン,級位段位,レンタル` があれば読む

## API

| エンドポイント | 変更 |
|---|---|
| `POST /api/events/:id/players` | body の `bib` `rank` `rental` を受ける。検証: `bib` は省略/null か 1〜9999 の整数、同じ大会に同じ `bib` があれば 409 `{ error: 'ゼッケン番号 12 は「山田 太郎」が使っています', reason: 'bib' }`。`rank` は文字列 20 文字まで（trim）。`rental` は真偽値 |
| `PATCH /api/events/:id/players/:playerId` | allowlist に `bib` `rank` `rental` を足す。`bib` の重複は自分以外と比べて 409。`bib: null` で未設定に戻せる |
| `POST …/players/bulk`（`rows`） | 行に `bib` `rank` `rental` を受ける。全行検証: 型、`bib` の重複（行同士と既存の両方）、**レンタルの行の技が `drawn` でない** → 行番号つき 400 `「n 行目: レンタルの選手は抜刀してからの形だけ選べます（破図味）」`。`names` 形式は変えない |
| `PATCH /api/events/:id` | allowlist に `settings`（`{ requireBib, requireRank }` の真偽値だけ。他のキーは無視）を足す |
| `PUT /api/events/:id/techniques` / `PUT /api/techniques` | `validateTechniques` が `drawn` を受ける（省略か真偽値。それ以外は 400）。`cloneTechniques` が `drawn` を写す |
| `POST /api/events/:id/status`（`draft → round1`） | サーバーは変えない（硬い条件は選手 0 名のまま）。判定はクライアント |

`api.js`: `createPlayer` / `updatePlayerInfo` / `createPlayersBulk` は body をそのまま送るので変更不要。409 の `reason: 'bib'` を呼び出し側が文言に使う。`updateEventInfo(eventId, { settings })` で設定を送る。

## 純粋関数（`courts.js`。`test.html` で固定。サーバーは同じ規則を自前で持つ）

```javascript
Courts.techniqueOptions(techniques, isFemale, rental)   // 第 3 引数を足す。rental が true なら drawn の技だけ
Courts.isDrawnTechnique(techniques, name, isFemale)     // resolveTechnique で解決した技の drawn（無ければ false）
Courts.startBlockers(event, players)                    // 試合開始を止める理由の一覧
//   → [{ kind: 'bib' | 'rank' | 'rental', players: [player, …] }]  空配列なら進める
//   bib: settings.requireBib かつ一巡目で bib が未設定 / rank: 同様 / rental: rental かつ tech1〜3 に drawn でない技がある
Courts.blockerMessage(blockers)                         // alert の文言「ゼッケン番号が未入力: 3 名（山田 太郎、…）」を改行で連ねる
Courts.parsePasteRows(text, techniques, defaults)       // 列を足す: 名前, コート, 性別, 新人, 技1, 技2, 技3, ゼッケン, 級位段位, レンタル
//   ゼッケンは数字以外なら ok:false「ゼッケン番号は数字で」。レンタルは 新人と同じ語（○/1/true/レンタル/あり）で真。
//   レンタルの行に drawn でない技があれば ok:false「レンタルの選手は抜刀してからの形だけ選べます」
```

`Courts.statusConfirmMessage` は変えない。`draft → round1` の前に `startBlockers` を見て、空でなければ `alert(blockerMessage)` して遷移しない（PC `desk.js` の `applyStatus` とスマホ `admin-round.js` の `applyStatus` の両方）。

## 画面

**形マスタ（`techedit.js`、`techniques.html` と PC の技と配点）**: 配点 4 列の右に「抜刀後」のチェック列。保存時に `drawn` を送る。列の見出しに「レンタルの選手が選べる形」の補足（`title`）。スマホ幅の詰め表示でも列が見えること。

**基本情報（`desk-setup.js`）**: 「ゼッケン番号を必須にする」「級位・段位を必須にする」のチェック 2 つ。保存は `updateEventInfo` に `settings` を含める。ロック中は無効。

**PC 選手登録（`desk-players.js`）**:
- 列を足す: 名前の右に「ゼッケン」（数値入力、並べ替え可）、「級位段位」（`datalist` 付きテキスト: 無級・十級〜一級・初段〜十段）、「レンタル」（チェック）。列幅と `width` の合計を直す（`desk.css`）
- 必須なのに空のセル、レンタルなのに抜刀の形の技セルは赤枠（`.desk-cell-required` / `.desk-cell-bad`）。表の上に「ゼッケン未入力 n　級位段位未入力 n　レンタル不可の形 n」（0 なら出さない）
- 技セレクトの候補は `techniqueOptions(techniques, isFemale, rental)`。レンタルを切り替えたら行の技セレクトを作り直す（性別と同じ）。候補に無い保存済みの名前は選択肢に足す（既存の作法）
- `bib` の 409 は文言をそのまま alert し、セルを戻す
- 貼り付けダイアログ: 列の説明に 3 列を足す。プレビューで赤く
- CSV 取り込みは既存の流れ（サーバーが列を読む）

**PC 試合進行（`desk-match.js`）**: コート別カードに「真剣レンタル n 名」（その巡目の行で `rental` の数。0 なら出さない）。二巡目の表の技セレクトも `rental` で絞る。

**スマホ選手登録（`admin-players.js`）**: 追加・編集フォームに ゼッケン（数値）、級位段位（テキスト＋候補）、レンタル（トグル）。`TechPicker` に渡す配列を `techniqueOptions(list, isFemale, rental)` に。表にゼッケン列を足す（級位・レンタルは表には出さず、行のシートで見る）。一括登録（名前だけ）は変更なし。

**採点画面（`app.js`）**: 選手名バーの順番ラベルを `男子 1巡目 1番　No.12`（`bib` があるときだけ `No.` を足す）。下部の選手一覧にゼッケン列。

**ヘルプ**: 「選手を登録する」にゼッケン・級位段位・レンタル、「技の配点を変える」に抜刀後の形、「試合を開始する」に止まる条件を足す。

## テスト（`test.html`）

1. サーバー: `createPlayer` で `bib: 12` が保存され、同じ `bib` の 2 人目が 409 `reason: 'bib'`、`bib: 0` / `'12'` / `1.5` が 400、`PATCH` で `bib: null` に戻せる、`rank` 21 文字が 400、`rental: 'yes'` が 400
2. サーバー bulk rows: 行同士の `bib` 重複が 400（行番号つき、1 人も増えない）、レンタルの行に `drawn` でない技が 400、`drawn` の技なら 201
3. サーバー: `validateTechniques` が `drawn: 'x'` を 400、`cloneTechniques` が `drawn` を写す。コピーとバンドルの往復で `settings` `drawn` `bib` `rank` `rental` が残る。二巡目生成で 3 項目が複製される
4. `Courts.techniqueOptions` の第 3 引数: `rental: true` で `drawn` の技だけ。性別と AND
5. `Courts.startBlockers` / `blockerMessage`: 必須 off なら空、`requireBib` で未設定の一巡目だけ（二巡目の行は数えない）、レンタルで抜刀の形、複数種類の連結
6. `Courts.parsePasteRows`: 10 列を読む、ゼッケンが数字以外で `ok:false`、レンタルの語、レンタルの行の技の検証、7 列だけの行は従来どおり
7. 既存テストがすべて通る（現在 903）

## 手動確認

- 形マスタで `破図味` に「抜刀後」を付ける → レンタルの選手の技セレクトと技ピッカーに `破図味` だけが出る → レンタルを外すと全部出る
- 基本情報でゼッケン必須にする → 未入力の選手がいる状態で「試合開始」が止まり、名前が出る → 入力すると進む
- ゼッケンの重複が PC の表・貼り付け・スマホのフォームで拒まれる
- 採点画面のバーに `No.12`、試合進行のカードに「真剣レンタル 2 名」
- CSV エクスポート → 取り込みで 3 項目が往復する。古い CSV（列なし）も読める
- 375px のスマホフォームと 1280px の PC 表で崩れない

## 実装の分割（1 計画）

| トラック | 内容 | ファイル |
|---|---|---|
| A | サーバー（選手の 3 項目・重複・settings・techniques の `drawn`・bulk・CSV・バンドル・コピー・二巡目）と `api.js` | `server/index.js` `api.js` `test.html` |
| B | 純粋関数（`techniqueOptions` の第 3 引数、`isDrawnTechnique`、`startBlockers`、`blockerMessage`、`parsePasteRows` の列）| `courts.js` `test.html` |
| C | 形マスタの「抜刀後」列と基本情報の必須チェック | `techedit.js` `techniques.html` `desk-setup.js` `desk.css` |
| D | PC 選手登録の列・赤枠・件数・貼り付け、試合進行のレンタル人数と絞り込み、試合開始の判定（PC・スマホ） | `desk-players.js` `desk-match.js` `desk.js` `admin-round.js` `desk.css` |
| E | スマホ選手登録のフォームと表、採点画面のバーと一覧、ヘルプ | `admin-players.js` `admin.css` `app.js` `scoring.html` `style.css` `help.html` |

A と B は独立（`test.html` の追記位置を分ける）。C・D・E は A・B の後。C・D・E は触るファイルが分かれるので並行できる（`desk.css` は C と D が触るので、追記位置を分けるか D に寄せる）。
