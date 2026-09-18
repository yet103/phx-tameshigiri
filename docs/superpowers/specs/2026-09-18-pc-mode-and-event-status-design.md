# PC 運営モードと大会の状態（準備中 → 最終結果 → アーカイブ）

**日付**: 2026-09-18
**対象**: phx-tameshigiri（試し斬り採点システム）
**前提となる設計書**: [2026-09-08-mobile-admin-flow-design.md](2026-09-08-mobile-admin-flow-design.md)、[2026-09-18-players-table-design.md](2026-09-18-players-table-design.md)

大会の「いま何をする段階か」をデータに持たせ、PC で大会を作って試合を進める運営画面を新設する。
今のスマホ運営（`admin.html`）はスマホモードとして残し、PC とスマホをヘッダーのボタンで行き来できるようにする。
トップページはアプリの説明と入口にし、採点画面は `scoring.html` に移す。

---

## 背景（何がわかりにくいか）

| 課題 | 現状 | 影響 |
|---|---|---|
| 入口が採点画面 | ドメイン直打ちで `index.html`（採点）が開き、大会の作成・削除ボタンまである | 初見の人にアプリの全体像と始め方が伝わらない |
| 大会に状態が無い | 準備中・試合中・終了をデータが持たない。巡目は `order` から導出するだけ | 画面が「いま何をする段階か」を示せない |
| 「進行」タブの役割が曖昧 | 二巡目の生成場所であり、採点画面へのリンクがそこにある | 試合の開始・終了という概念が無い |
| 選手登録が1人ずつ | シートで1人ずつ。一括は名前だけ | PC で表に打ち込む、Excel から貼る使い方に合わない |

---

## 決定事項（ブレストで確定）

| 論点 | 決定 |
|---|---|
| 状態の粒度 | **7段階**: 準備中 / 一巡目 進行中 / 一巡目終了 / 二巡目 進行中 / 二巡目終了 / 最終結果 / アーカイブ |
| 状態の進め方 | **運営者がボタンで進める**。自動では変わらない。各状態から1つ前に戻せる |
| 編集を止める時点 | **「最終結果を確定」から**。サーバーが 409 で拒む（見た目だけの制限にしない） |
| 採点画面 | 状態が「進行中」のときだけ得点を送れる。それ以外はバナーで理由を出し、確定を無効にする |
| PC とスマホ | **別ページ**（`desk.html` / `admin.html`）。同じハッシュ体系で、ヘッダーのボタンで行き来する |
| トップ | `index.html` を作り直して説明と入口にする。採点は `scoring.html` に改名し、古いブックマークは転送で生かす |
| コピー | 技と配点は必ず複製。選手は任意（一巡目の行だけ、得点は消す） |
| スマホ運営 | 段階表示と「次へ進む」ボタンを足す以外は触らない |
| 二巡目なし | 一巡目終了から直接「最終結果」へ進める |

---

## 全体構成

### ページ

| ファイル | 役割 | 端末 | 状態 |
|---|---|---|---|
| `index.html` | **トップ**。説明・全体の流れ・入口ボタン・進行中の大会一覧 | 全端末 | 作り直し |
| `scoring.html` | 採点（今の `index.html`）。大会作成・削除を外し、状態バナーを足す | コートのタブレット | 改名＋変更 |
| `desk.html` | **PC 運営**。大会一覧・基本情報・技と配点・選手・試合・結果 | PC（1024px 以上） | 新規 |
| `admin.html` | スマホ運営。段階表示と次へ進むボタンを足す | 運営者のスマホ | 小変更 |
| `techniques.html` `ranking.html` `share.html` `present.html` `board.html` | 変更なし（`techniques.html` は編集ロジックの切り出し元になる） | | |
| `help.html` | 全体の流れ・大会の作成・採点の進行の各節を新しい流れに合わせる | | 更新 |

### JS モジュール（IIFE。`var` と `function`。`async`/`await` は可）

| ファイル | 責務 | 依存 |
|---|---|---|
| `status.js`（新規） | 大会の状態。遷移表・ラベル・推定・判定の**純粋関数**。サーバー（CommonJS）とブラウザ（`EventStatus` グローバル）の両方から同じファイルを読む | なし |
| `storage.js`（変更） | モード（`pc` / `mobile`）の控えと、運営画面の URL の選択 | なし |
| `api.js`（変更） | `changeStatus` `copyEvent`、`createPlayersBulk` の行形式 | なし |
| `app.js`（変更） | 状態バナー、巡目の絞り込み、確定の無効化。大会作成・削除の撤去 | `EventStatus` |
| `admin.js` `admin-events.js` `admin-round.js`（変更） | 状態バッジ、段階表示、次へ進む・戻すボタン、PC への切り替え | `EventStatus` |
| `home.js`（新規） | トップの制御。大会一覧、モードに応じた運営画面の URL、`#event/` の転送 | `Api` `Storage` `EventStatus` |
| `desk.js`（新規） | PC 運営の骨組み。ハッシュ、上部の段階表示と遷移ボタン、左の区画、テーマ、スマホへの切り替え | `Api` `Storage` `EventStatus` |
| `desk-events.js` | 大会一覧・新規作成・コピー・取り込み・アーカイブ・削除 | `Api` |
| `desk-setup.js` | 基本情報（名前・日付・会場）とコート一覧 | `Api` `Courts` |
| `desk-techniques.js` | 技と配点（`techedit.js` を埋め込む） | `TechEdit` |
| `techedit.js`（新規、`techniques.html` から切り出し） | 技リスト編集の描画と保存。コンテナと大会 ID を渡すと動く | `Api` |
| `desk-players.js` | 編集できる選手の表、貼り付けによる一括登録 | `Api` `Courts` |
| `desk-match.js` | コート別の状況、採点画面を開く、二巡目の生成と技入力の表 | `Api` `Courts` |
| `desk-results.js` | 順位、発表モード、共有リンク、配信ボード | `Api` |

`desk.html` は `theme.css` と `desk.css` だけを読む（`style.css` の `min-width:768px` は関係ないが、採点画面の見た目を持ち込まない）。

---

## 状態モデル

### 状態と遷移

```
draft ──▶ round1 ──▶ round1_done ──▶ round2 ──▶ round2_done ──▶ final ──▶ archived
                          │                                        ▲
                          └────────────（二巡目なしで終了）────────────┘
```

| 値 | 表示 | できること | 次へ進むボタンの文言 |
|---|---|---|---|
| `draft` | 準備中 | 基本情報・技と配点・選手を自由に編集 | 試合開始 |
| `round1` | 一巡目 進行中 | コート端末で一巡目を採点。選手の追加・訂正は可 | 一巡目を終了 |
| `round1_done` | 一巡目終了 | 二巡目を生成し、技を入力 | 二巡目を開始（二巡目なしで終了） |
| `round2` | 二巡目 進行中 | コート端末で二巡目を採点 | 二巡目を終了 |
| `round2_done` | 二巡目終了 | 順位を確認。訂正が要れば戻す | 最終結果を確定 |
| `final` | 最終結果 | 得点・選手・技は編集不可。発表・共有・ファイル保存はできる | アーカイブ |
| `archived` | アーカイブ | 閲覧のみ。一覧の「アーカイブ」欄に移る。採点画面の選択肢に出ない | （復元のみ） |

許される遷移（`EventStatus.canTransition(from, to)`）:

| from | to |
|---|---|
| `draft` | `round1` |
| `round1` | `draft`, `round1_done` |
| `round1_done` | `round1`, `round2`, `final` |
| `round2` | `round1_done`, `round2_done` |
| `round2_done` | `round2`, `final` |
| `final` | `round2_done`, `round1_done`, `archived` |
| `archived` | `final` |

「戻す」の行き先は `EventStatus.prev(status, players)`: `final` からは二巡目の行があれば `round2_done`、無ければ `round1_done`。それ以外は表の左隣。

### 確認と拒否

クライアントは進む前に状況を数えて確認する。サーバーは硬い条件だけを 409 で拒む。

| 遷移 | クライアントの確認（承諾で進む） | サーバーが拒む条件 |
|---|---|---|
| `draft → round1` | 一巡目の技が未入力の人数 | 一巡目の選手が 0 名 |
| `round1 → round1_done` | 一巡目の未採点の人数 | なし |
| `round1_done → round2` | 二巡目の技が未入力の人数 | 二巡目の行が 0 件 |
| `round1_done → final` | 「二巡目を行わずに最終結果にします」 | なし |
| `round2 → round2_done` | 二巡目の未採点の人数 | なし |
| `round2_done → final` | 「得点・選手・技を編集できなくなります」 | なし |
| `final → archived` | 「一覧のアーカイブ欄に移り、採点画面の選択肢から消えます」 | なし |
| 戻す（すべて） | 「○○に戻します」 | 遷移表にない組み合わせ |

### 状態の無い既存データ

`status` の無い大会は、読み出し時に `EventStatus.derive(event)` で推定して応答に含める。ファイルには書かない。
次に遷移 API を呼んだときに保存される（移行作業は不要）。

```
選手が 0 名                      → draft
二巡目の行がある
  └ 二巡目が全員採点済み          → round2_done
  └ それ以外                      → round2
一巡目の行だけ
  └ 1 人でも採点済み              → round1
  └ 誰も採点していない            → draft
```

「一巡目が全員採点済みで二巡目が無い」は `round1` のまま。運営者が「一巡目を終了」を押すのが新しい流れなので、推定で先に進めない。

### 判定関数

```javascript
EventStatus.STATES            // ['draft','round1','round1_done','round2','round2_done','final','archived']
EventStatus.LABELS            // { draft: '準備中', round1: '一巡目 進行中', … }
EventStatus.NEXT_LABELS       // { draft: '試合開始', round1: '一巡目を終了', … }（archived は null）
EventStatus.canTransition(from, to)   // → boolean
EventStatus.next(status)              // 表の右隣。archived は null
EventStatus.prev(status, players)     // 戻す先。draft は null
EventStatus.isScoringOpen(status)     // round1 / round2 で true
EventStatus.scoringRound(status)      // 1 / 2 / null
EventStatus.isLocked(status)          // final / archived で true
EventStatus.derive(event)             // 上の推定
EventStatus.of(event)                 // event.status が有効ならそれ、無ければ derive
```

`status.js` の先頭は次の形にして、サーバーは `require('../status.js')`、ブラウザは `<script src="status.js">` で読む。
`Courts.roundOf` / `Courts.isScored` と同じ判定が必要なので、`derive` はそれらと同じ正規表現・条件を**自前で持つ**（`courts.js` に依存させない。サーバーは `courts.js` を読めない）。`test.html` で `Courts` の結果と一致することを固定する。

```javascript
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventStatus = factory();
})(this, function() { /* … */ });
```

---

## API

すべて同期ハンドラ（`readFileSync` → 変更 → `writeJsonAtomic`）。既存の不変条件を保つ。

### 状態の遷移 `POST /api/events/:id/status`（新規）

```
リクエスト: { "to": "round1" }
200:        { "success": true, "status": "round1" }
400:        to が STATES にない
404:        大会なし
409:        { "error": "この状態からは進めません", "reason": "transition", "from": "draft", "to": "round2" }
409:        { "error": "一巡目の選手がいません", "reason": "empty" }          draft → round1 で選手 0 名
409:        { "error": "二巡目が生成されていません", "reason": "no_round2" }  round1_done → round2 で二巡目 0 件
```

`from` は `EventStatus.of(event)`。成功時に `status` と `updatedAt` を書く。
履歴（`server/data/history`）に `{ action: 'status_change', detail: '準備中 → 一巡目 進行中' }` をサーバーが追記する（クライアントの `addHistory` は使わない。遷移と履歴を1つの操作にする）。

### ロックガード（`final` / `archived`）

`EventStatus.isLocked(EventStatus.of(event))` のとき、次の書き込みを 409 `{ "error": "この大会は最終結果を確定済みです", "reason": "locked", "status": "final" }` で拒む。

- `POST /api/events`（既存 ID の上書き）、`POST /api/events/:id/players`、`…/players/bulk`、`PATCH …/players/:playerId`、`DELETE …/players/:playerId`
- `POST /api/events/:id/import`、`PUT` / `DELETE /api/events/:id/techniques`、`POST /api/events/:id/rounds/2/generate`、`PUT /api/events/:id/live/:court`

拒まないもの: `POST /api/events/:id/status`（戻す・アーカイブ）、`DELETE /api/events/:id`（確認つきの削除は残す）、`GET` 系、`POST /api/links`。

`POST /api/events` の body に `status` が入っていても**無視し、既存の値を引き継ぐ**（`shareToken` と同じ扱い）。新規作成時は `draft`。状態を変える経路は遷移 API だけにする。

### 二巡目生成の前提

`POST /api/events/:id/rounds/2/generate` は状態が `round1_done` のときだけ通す。それ以外は 409 `{ "error": "一巡目を終了してから生成してください", "reason": "status", "status": "round1" }`。
既存の `unscored` / `exists` の 409 と `force` の扱いは変えない。`test.html` の生成テストは、先に `draft → round1 → round1_done` と遷移させてから呼ぶ。

### コピー `POST /api/events/:id/copy`（新規）

```
リクエスト: { "name": "第11回…", "date": "2027-09-05", "venue": "東京体育館", "withPlayers": true }
201:        { "success": true, "id": "<新しい大会ID>", "playerCount": 18 }
400:        name が空 / 1〜100 文字でない
404:        元の大会なし
```

- `techniques` は必ず複製（`cloneTechniques`）
- `withPlayers` が true のとき、元の**一巡目の行だけ**を複製する。`name` `order` `isFemale` `isNewFace` `tech1..3` を保ち、`id` は新規、`score: 0`、`result: ''`、`note: ''`、`sourcePlayerId` は付けない
- `status: 'draft'`。`shareToken` `live` `createdAt` は引き継がない。履歴も複製しない
- アーカイブ済みの大会からもコピーできる（読むだけなので）

### 一括登録 `POST /api/events/:id/players/bulk`（拡張）

今の `{ names, court, isFemale, isNewFace }` に加えて、行ごとの形を受ける。どちらか一方。

```
リクエスト: { "rows": [ { "name": "山田 太郎", "court": "A", "isFemale": false, "isNewFace": true,
                        "tech1": "四方", "tech2": "", "tech3": "" }, … ] }
201:        { "success": true, "created": 3, "players": [ … ] }
400:        { "error": "3 行目: 選手名が必要です" }   行番号つき（1 始まり）
```

- 500 行まで。`court` の検証は既存と同じ（空・`-` を含む・`未分類` は 400）
- `tech1..3` は空か、その大会の `techniques` にある名前。無い名前は 400 `「3 行目: 技「○○」は技リストにありません」`
- `order` はサーバーが採番（既存の規則。コート × 性別ごとに最大 + 1）
- 全行を検証してから書く（途中で失敗して半分だけ登録された状態を作らない）

### 一覧 `GET /api/events`

各要素に `status`（`EventStatus.of` の値）を足す。`GET /api/events/:id` の応答にも `status` を足す（ファイルに無ければ推定値）。

### `api.js` の追加

```javascript
changeStatus(eventId, to)        // → { ok: true, status } | { ok: false, status(HTTP), reason, error } | null（通信断）
copyEvent(eventId, data)         // → { id, playerCount } | { error } | null
createPlayersBulk(eventId, data) // 既存。data.rows があれば行形式で送る。失敗時に { error } を返せるようにする
```

`changeStatus` は 409 の理由（`transition` / `empty` / `no_round2`）を画面に出す必要があるので、`ok: false` に `reason` と `error` を載せる。

---

## 画面設計

### トップ `index.html`

- `#event/…` のハッシュで開かれたら、何も描かずに `location.replace('scoring.html' + location.hash)`（タブレットの古いブックマーク）
- ヘッダー: アプリ名、🌙 テーマ、🖥/📱 モード
- 本文: 3〜4 行の説明。全体の流れ（`help.html` の「0. 全体の流れ」の図を流用し、状態の 7 段階に合わせる）。入口ボタン「運営画面を開く」「採点画面（コート端末）」「順位表示」「ヘルプ」
- 進行中の大会: `GET /api/events` から `archived` を除き、`isScoringOpen` を先頭、次に `round1_done` / `round2_done` / `draft`、最後に `final`。行に状態バッジ。行を押すと運営画面のその大会（`Storage.adminHref('#players/<id>')`）
- 「運営画面を開く」は `Storage.adminHref('#events')`

### モードの切り替え

- `Storage.loadMode()` → `'pc' | 'mobile' | null`、`Storage.saveMode(mode)`
- `Storage.adminHref(hash)`: 控えがあればそれ、無ければ `matchMedia('(min-width: 1024px)').matches` で決め、`desk.html` / `admin.html` にハッシュを付けて返す
- ボタンは `index.html` `admin.html` `desk.html` のヘッダー、テーマ切替の隣。`admin.html` では 🖥（PC へ）、`desk.html` では 📱（スマホへ）。押すとモードを控えて相手のページへ移る。ハッシュの対応:

| `admin.html` | `desk.html` |
|---|---|
| `#events` | `#events` |
| `#players/<id>` | `#players/<id>` |
| `#round/<id>` | `#match/<id>` |
| `#results/<id>` | `#results/<id>` |
| `#players/<id>`（落とし先） | `#setup/<id>` `#techniques/<id>` |

### 採点画面 `scoring.html`（`app.js`）

- 「＋ 新規大会」「大会削除」とそのモーダルを外す。代わりに「大会の作成は運営画面で」のリンク（`Storage.adminHref('#events')`）
- 大会の選択肢: `archived` を除く。`isScoringOpen` を先頭に並べ、文言は `大会名 (日付)（一巡目 進行中）`（日付が無ければ括弧ごと省略）
- 大会選択バーの下に状態バナー。`isScoringOpen` なら「一巡目 進行中」を淡く表示。それ以外は警告色で「この大会は「準備中」です。運営画面で「試合開始」を押すと採点できます」のように、`NEXT_LABELS` を使った文言
- `isScoringOpen` のとき、表示する選手を `scoringRound(status)` の巡目に絞る（コートの絞り込みと併用）。それ以外は全巡目を表示する
- `isScoringOpen` でないとき: 確定・形成功・失敗・得点の入力・補正点・備考を無効にする。前後の選手の移動、タイマー、CSV エクスポート、HTML 保存は使える
- 大会データは今のとおり選択時に読む。状態はそのときの値で判定する（ポーリングは無い設計。運営が状態を変えたら「大会を選び直す」運用。既存の「選手を足したら選び直す」と同じ）
- `Outbox` は 4xx を破棄する既存の規則で 409 `locked` も破棄する。破棄の警告文言に「運営画面で状態を確認してください」を足す

### スマホ運営 `admin.html`

- 大会タブの行の副文に状態ラベルを足す（`9/7 ・ 18名 ・ 一巡目 進行中`）。`archived` は末尾にまとめ、見出し「アーカイブ」を付ける
- 進行タブの先頭に段階表示（現在の状態のラベルと「採点済み n / N」）と「次へ進む」ボタン。「戻す」と「二巡目なしで終了」は既存の「⋯」メニューへ
- 「二巡目を生成」は `round1_done` のときだけ有効。それ以外は無効にして `title` に理由
- 確認文言はサーバーの 409 と同じ理由を出す。`ok:false` の `error` をそのまま `alert`
- 「採点画面へ」のリンクは `scoring.html` に向ける（改名後）
- メニューに「🖥 PC で開く」を足すのではなく、ヘッダーのボタンで切り替える

### PC 運営 `desk.html`

```
┌ 試し斬り 運営                                                   🌙  📱 ┐
├ 第10回全日本試し斬り大会  9/7 東京体育館                                  ┤
│  ○準備中 ─ ●一巡目 進行中 ─ ○一巡目終了 ─ ○二巡目 ─ ○二巡目終了 ─ ○最終結果  │
│  採点済み 15 / 18                              [ ◀ 戻す ] [ 一巡目を終了 ▶ ] │
├──────────┬────────────────────────────────────────────────────────────┤
│ 基本情報  │                                                            │
│ 技と配点  │  （左の区画に応じた内容）                                    │
│ 選手      │                                                            │
│ 試合      │                                                            │
│ 結果      │                                                            │
└──────────┴────────────────────────────────────────────────────────────┘
```

ハッシュ: `#events` / `#setup/<id>` / `#techniques/<id>` / `#players/<id>` / `#match/<id>` / `#results/<id>`。
`desk.js` は `admin.js` と同じ構造（`registerTab` / `applyRoute` / `renderSeq` / `isStale` / 控え `tmg_desk_last`）で作る。同じ大会を読み直す `reloadEvent` も同じ。

**上部の段階表示**: 7 段階のうち `archived` は表示せず、`final` のときに「アーカイブ」ボタンを出す。現在の状態を強調し、通過した状態を塗る。「採点済み n / N」は `scoringRound` の巡目、`round1_done` では二巡目の人数と技未入力の件数、`draft` では一巡目の人数、`round2_done` 以降は出さない。
「次へ進む」は `NEXT_LABELS`、`round1_done` では「二巡目を開始」の隣に小さく「二巡目なしで終了」。「戻す」は `prev` が null なら出さない。
確認文言は「確認と拒否」の表のとおり。成功したら `reloadEvent`。`draft → round1` の成功時は採点画面を別ウィンドウで開く（`window.open('scoring.html#event/<id>', 'tmg_scoring')`）。

**大会一覧 `#events`**: 表（名前・日付・会場・人数・状態・更新）。`updatedAt` 降順。`archived` は下の「▸ アーカイブ（n 件）」に畳む。上に「＋ 新規作成」「📂 取り込む」。行の「⋯」に「開く」「コピーして作成」「ファイルに保存」「アーカイブ（`final` のときだけ）」「削除」。
新規作成はダイアログ（名前・日付・会場）。作成後は `#players/<id>`。
コピーはダイアログ（名前は「元の名前（コピー）」を初期値、日付は今日、会場は元の値、「選手も複製する（得点は消す）」チェック）。作成後は `#players/<id>`。

**基本情報 `#setup/<id>`**: 名前・日付・会場の入力と「保存」（`Api.saveEvent` に `players` を含めた現在の大会を渡す既存の作法。`status` は body に入れても無視される）。コートの一覧は `Courts.listFrom(players)` を読み取り専用で出す（コートは選手のコートから決まる、と注記）。ロック中は入力を無効にする。

**技と配点 `#techniques/<id>`**: `techniques.html` の編集部分を `techedit.js` に切り出し、`TechEdit.mount(container, eventId, { onSaved })` で埋め込む。`techniques.html` も同じモジュールを使うように差し替える（見た目と動きは変えない）。ロック中は保存を無効にする。

**選手 `#players/<id>`**: 編集できる表。

| 列 | 入力 | 保存 |
|---|---|---|
| 巡 | 読み取り（`Courts.roundOf`） | |
| No. | 読み取り（`order`） | |
| 名前 | テキスト | blur / Enter で `updatePlayerInfo` |
| コート | セレクト（既存コート＋「新しいコート…」で入力） | 同上（`order` が変わる） |
| 性別 | セレクト（男子／女子） | 同上。採点済みなら既存の警告 |
| 新人 | チェック | 同上 |
| 技1〜3 | セレクト（その大会の技リスト。空を含む） | 同上。採点済みなら既存の警告 |
| 得点 | 読み取り | |
| ⋯ | 削除（採点済みは 409 の得点を出して再確認） | |

- 絞り込みと並べ替えは `Courts.applyFilter` / `Courts.sortBy`（スマホの選手タブと同じ純粋関数）。帯の UI は PC 幅に合わせて1段
- 「＋ 行を追加」で空行（クライアントだけの下書き）を末尾に足す。名前を入れて blur / Enter で `createPlayer`。コート・性別・新人は直前の行の値を初期値にする
- **貼り付け**: 「📋 貼り付けて追加」でテキストエリアのダイアログ。タブ区切り（Excel）とカンマ区切りを受ける。列は `名前, コート, 性別, 新人, 技1, 技2, 技3` の固定順。1 行目が「名前」で始まれば見出しとして飛ばす。性別は `女子`/`女`/`F` を女子、それ以外を男子。新人は `新人`/`○`/`1`/`true` を新人。技リストに無い技名は赤く示し、送らない。件数を確認して `createPlayersBulk(eventId, { rows })`
- 保存に失敗したセルは元の値に戻して `alert`。通信中はそのセルを無効にする
- 表全体は `isLocked` のとき読み取り専用（入力を無効、行の追加・貼り付け・削除を隠す）
- CSV 取り込み（既存の `importCsv`、409 ガードつき）は「⋯」に残す

**試合 `#match/<id>`**（スマホの「進行」に相当）:
- コートごとのカード: コート名、`scoringRound` の巡目の「採点済み n / N」、いま採点中の選手（`event.live[コート]` の `playerId` から名前を引く。無ければ「待機中」）、「採点画面を開く」（`window.open('scoring.html#event/<id>/<コート>', 'tmg_scoring_<コート>')`）、「URL をコピー」（絶対 URL をクリップボードへ）
- `round1_done` のとき: 「二巡目を生成」ボタン（既存の確認・`force` の流れは `Courts.nextRoundConflictMessage` を使う）と、生成後の二巡目の表（巡・No.・名前・一巡目の得点・技1〜3 のセレクト・「一巡目と同じ技をコピー」）。上に「全員に一巡目と同じ技をコピー」（技が空の行だけを対象にし、件数を確認してから行ごとに `updatePlayerInfo`）と「技 未入力 n」
- それ以外の状態では二巡目の表を読み取り専用で出す（`round2` 以降）か出さない（`draft` / `round1`）
- CSV エクスポートは「⋯」

**結果 `#results/<id>`**: スマホの結果タブと同じ内容（3 部門の順位、最新に更新、発表モードで開く、共有リンクをコピー）を PC 幅で 3 列に。配信ボードの URL コピーも足す（`board.html#<token>`）。

### ヘルプ `help.html`

- 「0. 全体の流れ」を 7 段階の図にし、端末の役割に「運営者の PC」を足す
- 「1. 大会の作成」に PC の表と貼り付け、コピー、アーカイブを足す
- 「2. 採点の進行」を「試合開始 → 一巡目を終了 → 二巡目を生成 → 二巡目を開始 → …」の流れに書き直し、採点画面の状態バナーを説明する
- 画面の URL を `scoring.html` に直す

---

## 認証・静的配信（`server/static-policy.js`）

`PROTECTED_FILES` に足す: `scoring.html`, `desk.html`, `desk.css`, `home.js`, `desk.js`, `desk-events.js`, `desk-setup.js`, `desk-techniques.js`, `desk-players.js`, `desk-match.js`, `desk-results.js`, `techedit.js`, `status.js`。
`index.html` は引き続き保護（トップは大会一覧を出すため）。`share` / `present` / `board` の無認証は変えない。`status.js` はサーバーがルート相対で `require` するのでリポジトリ直下に置く。

---

## エラー処理

- 遷移の失敗（409）は `error` をそのまま `alert`。`transition` のときは画面を読み直す（他の端末が先に進めていた）
- `locked` の 409 は運営画面では `alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください')`。採点画面では `Outbox` が破棄して警告
- コピー・一括登録の失敗はダイアログを閉じず入力を残す（既存の作法）
- `window.open` がブロックされたら（戻り値 null）「ポップアップを許可するか、試合の区画から開いてください」

---

## テスト（`test.html` に追加）

### 純粋関数（`status.js`）

1. `canTransition` の表どおり（許される組み合わせ全部と、代表的な不許可）
2. `next` / `prev`: `prev('final', players)` が二巡目の有無で変わる。`prev('draft')` が null
3. `derive`: 選手 0 → `draft`、一巡目未採点 → `draft`、一巡目一部採点 → `round1`、二巡目あり一部採点 → `round2`、二巡目全員採点 → `round2_done`
4. `derive` の採点済み判定と巡目判定が `Courts.isScored` / `Courts.roundOf` と一致する（同じ入力で比較）
5. `of`: `status` が有効ならそのまま、不正な文字列なら `derive`

### サーバー

6. 新規作成の大会が `status: 'draft'`。`POST /api/events` の body に `status: 'final'` を入れても `draft` のまま
7. `changeStatus` で `draft → round1` が通り、`draft → round2` が 409 `transition`
8. 選手 0 名で `draft → round1` が 409 `empty`
9. `round1_done → round2` が二巡目 0 件で 409 `no_round2`
10. `final` の大会で選手追加・PATCH・削除・技の PUT・生成・`putLive` がすべて 409 `locked`。`changeStatus('round2_done')` で戻すと通る
11. `generateNextRound` が `round1` で 409 `status`、`round1_done` で通る（既存の生成テストを遷移つきに直す）
12. `copyEvent`: `techniques` が同じ内容で別オブジェクト、`withPlayers` で一巡目だけ複製され `score` 0・`result` 空・`id` が新規、`shareToken` を持たない、`status` が `draft`
13. `createPlayersBulk({ rows })`: 3 行が採番される。技リストに無い技名が行番号つきの 400。1 行でも不正なら 1 人も登録されない
14. `GET /api/events` の各要素に `status` がある。`status` の無い既存ファイルで推定値が返る
15. 既存の「並行 PATCH 12 本」はそのまま

### 手動確認

- PC 幅（1280px）で `desk.html` の 6 区画が横スクロールなしに収まる。スマホ幅（375px）では `admin.html` に切り替える案内を出す
- 準備中 → 試合開始で `scoring.html` が別ウィンドウで開き、一巡目の選手だけが出る。運営で「一巡目を終了」→ タブレットで大会を選び直すとバナーが出て確定が押せない
- 二巡目を生成 → 表で技を入れる → 二巡目を開始 → タブレットで二巡目の選手だけが出る
- 最終結果を確定 → 選手表が読み取り専用。戻すと編集できる
- アーカイブ → 一覧の畳んだ欄に移り、採点画面の選択肢から消える。共有リンクと発表モードは開ける
- Excel から 5 行貼り付けて登録され、技リストに無い技名が赤く示される
- 🖥/📱 で `#players/<id>` を保ったまま行き来する。`#match` ⇔ `#round` の対応
- ライト／ダーク両テーマで `index.html` と `desk.html` が読める
- `index.html#event/<id>/A` を開くと `scoring.html` に転送される

---

## 実装の分割

設計書は本書 1 本、実装計画は 5 本。各段階が単独で検証でき、`master` に戻せる順。

| 計画 | 内容 | 検証 |
|---|---|---|
| **1. 状態モデル** | `status.js`、遷移 API、ロックガード、生成の前提、一覧の `status`、採点画面の状態バナー・巡目の絞り込み・確定の無効化・大会作成/削除の撤去、スマホ運営の段階表示と次へ進む・戻す、ヘルプの流れ | テスト 1〜11、14、15。手動確認の 2〜4 行目（スマホ運営で） |
| **2. PC 運営の土台** | `desk.html` の骨組み（ハッシュ・段階表示・遷移ボタン・左の区画）、大会一覧、新規作成、コピー API とダイアログ、アーカイブ、基本情報、`techedit.js` の切り出しと技と配点、🖥/📱 の切り替え（`admin.html` 側も） | テスト 12。手動確認のコピー・アーカイブ・切り替え |
| **3. トップと採点画面の改名** | `index.html` の作り直し、`scoring.html` への改名と転送、`Storage.adminHref`、静的配信の許可リスト、各ページのリンク修正、ヘルプの URL | 手動確認の最終行と入口 |
| **4. PC の選手表** | 編集できる表、行の追加、貼り付けによる一括登録、bulk API の行形式 | テスト 13。手動確認の貼り付け |
| **5. PC の試合と結果** | コート別の状況、採点画面を開く、二巡目の生成と技入力の表、結果、ヘルプの残り | 手動確認の一巡目〜二巡目の流れを PC で |

1 を先にするのは、2 以降のすべてが状態表示に依存するため。1 が終わった時点でスマホ運営も「試合開始 → 一巡目を終了 → …」の流れになる。
2 を 3 より先にするのは、トップの 🖥 ボタンの行き先が無い状態を作らないため。

---

## リスクと未解決事項

- **状態は端末間で同期しない**。運営が「一巡目を終了」を押しても、採点中のタブレットは大会を選び直すまで気付かない。既存の「選手を足したら選び直す」と同じ運用で周知する。サーバー側は `isScoringOpen` でない状態でも PATCH を拒まない（`locked` のみ拒む）ので、選び直す前に送った得点は保存される
- **`techniques.html` からの切り出し**は動きを変えずに行う。`techniques.html` の見た目の回帰は手動で確認する
- **`window.open` のブロック**。試合開始の自動オープンが塞がれても状態は進んでいるので、試合の区画から開き直せる
- **既存の二巡目行が CSV 由来**（`sourcePlayerId` 無し）の大会は前設計書のとおり。`derive` は行の有無だけを見るので影響しない
- **`index.html` の改名でタブレットのホーム画面アイコン**（`index.html#event/…`）は転送で動くが、ホーム画面に追加し直すよう案内する
