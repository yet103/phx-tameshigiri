# 運営者のスマホで大会を進行する：選手登録・二巡目・結果発表

**日付**: 2026-09-08
**対象**: phx-tameshigiri（試し斬り採点システム）
**前提となる設計書**: [2026-09-07-court-operation-reliability-design.md](2026-09-07-court-operation-reliability-design.md)

運営者がスマホ1台で「大会作成 → 選手登録 → （タブレットで一巡目採点）→ 二巡目生成と技の入力 →
（タブレットで二巡目採点）→ 結果発表」を完結できるようにする。採点はこれまでどおりコートごとのタブレットで行う。

---

## 背景

現状の運用上の穴は3つある。

| 課題 | 現状 | 影響 |
|---|---|---|
| 選手を1人ずつ登録できない | CSV インポートのみ | 当日の飛び入り・訂正のたびに PC で CSV を編集する |
| 二巡目が CSV の往復 | 生成した CSV をダウンロードし、技を書き足して再インポート | スマホでは事実上不可能 |
| 全ページが 768px 専用 | `style.css` の `body{min-width:768px}` | 375px では主要導線（選手名・次の選手・保存）が初期表示で画面外 |

3点目は監査で確認した事実で、根本原因は1行。ただし採点画面はタブレット専用と決めたので、
**採点画面は触らず、運営用のページを別に作る**。

---

## 決定事項（ブレストで確定）

| 論点 | 決定 |
|---|---|
| スマホの役割 | **運営はスマホ、採点はタブレット**。採点表（7列）のスマホ対応はしない |
| 登録項目 | 名前・コート・性別・新人・技3つ。**番号はコート×性別で自動採番** |
| 二巡目の技 | **当面は運営者が生成後に手入力**。将来、選手自身が申告できる形を妨げない |
| 結果発表 | スマホの順位表 ＋ 大画面の発表モード ＋ 参加者向け閲覧専用リンク、の3つすべて |
| 手動登録の場所 | **運営者スマホの画面のみ**。タブレットの選手一覧パネルは変えない |
| 画面構成 | **運営専用ページ `admin.html` を新設**。`index.html` は変更しない |
| ナビゲーション | **下タブ**（大会／選手／進行／結果）。どの順でも行き来できる |
| 技の選び方 | **一覧から順にタップ**（ボトムシート、①②③のチップ、配点を横に表示） |
| 二巡目の技入力 | **一覧で埋めていく**（各行に技チップ、空きは赤の＋、未入力件数を常時表示） |
| 発表モード | **A（部門ごとに大きく）＋ C（下位から順に発表）**。B（3部門一画面）は不採用 |
| 二巡目の番号 | **コート×性別ごとに1から**（現行 CSV 生成のコート横断通番は廃止） |
| 未採点での二巡目生成 | **人数を出して確認、承諾で生成** |
| 採点済み選手の性別変更 | **警告を出し、採点画面で開き直してもらう**（サーバーは再計算しない） |

モックアップは `.superpowers/brainstorm/` 配下に残している（`admin-nav.html` / `player-form.html` / `round-tab.html` / `results-tab.html`）。

---

## スコープ

### 対象

- サーバー API：選手の追加・編集・削除、二巡目生成、共有トークン、順位データ
- `admin.html`：運営者向け4タブ（大会／選手／進行／結果）
- `techpicker.js`：技の選択 UI（共用部品）
- `share.html`：参加者向けの閲覧専用順位ページ
- `present.html`：大画面用の発表モード
- `ranking.html`：順位計算をサーバーに寄せる差し替え
- `theme.css`：テーマ変数の切り出し
- `test.html`：上記の回帰テスト

### 対象外

- 採点画面（`index.html` / `app.js`）のスマホ対応（レイアウト変更）。ただし `app.js` の「二巡目データ生成」は番号規則の二重管理を避けるため、サーバーの生成 API を呼ぶ形に置き換える（計画3。下記「採番と二巡目生成」）
- 選手自身による技の申告画面（将来。`techpicker.js` を流用できる形にしておくまで）
- 認証・認可（並行セッションで実施中。本設計は「申し送り」節で噛み合わせを定義する）
- 順位表示の自動更新の高度化（`share.html` は60秒の定期取得のみ）
- 順番の再採番機能（欠番を残す方針。将来「並び直す」を採点開始前限定で足す余地は残す）

---

## 全体構成

### ページ

| ファイル | 役割 | 対象端末 | 状態 |
|---|---|---|---|
| `index.html` | 採点 | タブレット（768px以上） | **変更なし** |
| `admin.html` | 運営：大会／選手／進行／結果 | 運営者のスマホ（375px〜） | 新規 |
| `share.html` | 順位の閲覧専用 | 参加者のスマホ。認証なし | 新規 |
| `present.html` | 発表モード | 大画面につないだ端末。認証なし | 新規 |
| `ranking.html` | 運営用の順位表 | — | 順位計算をサーバー結果に差し替え。`theme.css` を読み込む |
| `techniques.html` | 技術リスト編集 | — | `theme.css` の読み込み追加のみ |

### CSS

`style.css` の先頭にあるテーマ変数（`:root` と `[data-theme="dark"]` の全変数、`--warn` `--banner-text` を含む）を
**`theme.css`** に切り出す。`style.css` は `theme.css` を前提とし、**`style.css` を読む既存3ページ（`index.html` / `ranking.html` / `techniques.html`）はすべて `theme.css` を先に読む**。`style.css` 内で変数を62箇所参照しているため、読み忘れると表示が崩れる。
`style.css` の `body{min-width:768px}` は採点画面の意図的な制約なので残す。

新規ページは `theme.css` ＋ 各自の CSS（`admin.css` / `share.css` / `present.css`）だけを読み、
`style.css` を読まない。これで 768px の制約が新規ページに一切及ばない。

### JS モジュール（すべて IIFE。`var` と `function`。`async`/`await` は可）

| ファイル | 責務 | 依存 |
|---|---|---|
| `techpicker.js`（新規） | 技のボトムシート選択。選択状態（最大3・順序つき）を純粋関数で持ち、シートの描画とチップの描画を提供する | `Api`（技術リスト取得） |
| `admin.js`（新規） | 運営画面の制御。ハッシュ `#<タブ>/<大会ID>` で状態を持つ | `Api` `Courts` `TechPicker` `Storage`（テーマ） |
| `share.js`（新規） | `share.html` の制御。トークンで順位を取得し描画、60秒ごと更新 | `Api` |
| `present.js`（新規） | `present.html` の制御。A/C モードの切り替えと進行 | `Api` |
| `api.js`（変更） | 新規エンドポイントの関数を追加 | — |
| `courts.js`（変更） | `Courts.courtOf` / `listFrom` / `filter` に加え、**`Courts.roundOf(player)` を追加**する。`order` の解析はこのモジュールの責務 | — |
| `outbox.js` | **運営画面では読み込まない**（採点しないため） | — |

`admin.html` のハッシュは採点画面の `Route`（`#event/<id>/<court>`）とは別の体系で、`admin.js` 内で完結させる。
選択中の大会は `localStorage.tmg_admin_last` に控え、ハッシュが無いときの復帰に使う（採点画面の `tmg_last` とは分ける。運営者のスマホとタブレットは別端末で、混ぜる理由がない）。

### 順位計算の一本化

順位の集計ロジック（氏名で合算、一般男子／新人／一般女子、同点同順位）は現在 `ranking.html` のクライアント側にある。
これを **サーバーの `computeRanking(event)` に移し、唯一の実装にする**。運営画面・`ranking.html`・`share.html`・`present.html` はすべてサーバーの結果を受け取るだけにする。

---

## データモデル

追加は最小で、既存の `events/*.json` はそのまま読める（移行不要）。

```
players[] の二巡目行に   sourcePlayerId : string   一巡目のどの行から生成したか
event に                 shareToken     : string   共有トークン（発行済みなら再利用）
server/data/links/<token>.json          { token, targetType: "event", targetId, createdAt }
```

**`round` フィールドは追加しない。** `order`（`コート-性別-巡目-番号`）の第3セグメントから導出できる値を二重に持つと不整合の元になる。
サーバーとクライアントはモジュールを共有できない（CommonJS と `<script>` の IIFE）ため、**同じ関数を2箇所に持つ**：サーバーは `server/index.js` の `roundOf`、クライアントは `Courts.roundOf`。両方をテストで固定する。

```javascript
// order の第3セグメント。解析できなければ 1（一巡目）とみなす
function roundOf(player) {
  var m = (player && player.order || '').match(/^(.+)-(男子|女子)-(\d+)-(\d+)$/);
  return m ? parseInt(m[3], 10) : 1;
}
```

**`order` の制約**: コート名に `-` を含めない（`Courts.courtOf` が先頭セグメントを `/^([^-]+)/` で取るため）。
コート名を `未分類` にしない（`Courts.UNASSIGNED` と衝突する）。サーバーの検証条件に入れる。

---

## API

すべて**同期ハンドラ**（`fs.readFileSync` → 変更 → `writeJsonAtomic`）。前設計書の不変条件を維持し、
`test.html` の「並行PATCH12本が全件反映される」がそのまま番人になる。
新しいパスパラメータ（`:playerId` `:token`）にも `isValidId` を適用する。

### 選手追加 `POST /api/events/:id/players`（新規）

```json
リクエスト:  { "name": "山田 太郎", "court": "A", "isFemale": false, "isNewFace": true,
              "tech1": "四方", "tech2": "", "tech3": "", "round": 1 }
レスポンス 201: { "success": true, "player": { "id": "…", "name": "山田 太郎", "order": "A-男子-1-3",
                  "tech1": "四方", "tech2": "", "tech3": "", "score": 0,
                  "isNewFace": true, "isFemale": false, "result": "" } }
```

- `order` は**サーバーが組み立てる**。クライアントの `id` / `order` / `score` / `result` は無視する
- `round` 省略時は 1。**選手タブの登録フォームは常に `round: 1` で送る**（二巡目行は生成 API が作る）。API が `round` を受理するのは将来の拡張余地で、今回 UI からは使わない
- 400: 大会ID不正／`name` 空／`court` が空・`-` を含む・`未分類`／`round` が 1〜9 の整数でない
- 404: 大会が存在しない
- ガードなし（新規行の追加は既存行に触れないため、採点中の端末に影響しない）

### 選手編集 `PATCH /api/events/:id/players/:playerId`（既存を拡張）

- 受理フィールドを allowlist 化：`name, tech1, tech2, tech3, isNewFace, isFemale, score, result, court, round`
- `id` と `order` は無視（書き換え不可）
- `court` / `isFemale` / `round` のいずれかが来たときだけ `order` を再組立て。移動先の番号は末尾採番（下記の採番規則）。移動元の欠番は許容
- **`court` と `round` は `order` を組み立てる入力としてだけ使い、選手オブジェクトには保存しない**（現行の `{...player, ...req.body}` の単純マージをやめ、allowlist の各項目を明示的に代入する）
- `round` が省略されたときは現在の `order` から `roundOf` で読んだ巡目を据え置く（一巡目扱いにしない）
- レスポンスに更新後の選手を足す：`{ "success": true, "player": {...} }`。`Outbox` は `res.ok` しか見ないので後方互換
- 400: allowlist 外のみ／型不正／`court` 形式不正。404: 大会または選手なし
- 採点済みガードは掛けない（誤字修正は採点中でも必要）。**採点済み選手の `isFemale` 変更はクライアントが警告する**（下記「性別変更」）

### 選手削除 `DELETE /api/events/:id/players/:playerId?force=1`（新規）

- 200: `{ "success": true }`
- 404: 大会または選手なし
- **409**（`isScored(player)` かつ `force !== '1'`）: `{ "error": "採点済みの選手です", "player": { "name", "order", "score" } }`
- 削除後の**再採番はしない**
- 一巡目の選手を削除しても、その `sourcePlayerId` を持つ二巡目行は**そのまま残す**（二巡目の採点を消さない）。削除確認に「二巡目の行は残ります」と出す。参照先を失った二巡目行は、進行タブで「一巡目の得点」を `—` と表示し、「一巡目と同じ技をコピー」を無効にする

### 二巡目生成 `POST /api/events/:id/rounds/2/generate`（新規）

```json
リクエスト:  { "force": false }
200:         { "success": true, "created": 18, "skipped": 0 }
409（未採点）: { "error": "一巡目に未採点の選手がいます", "reason": "unscored", "unscoredCount": 3 }
409（生成済み）: { "error": "二巡目は既に生成されています", "reason": "exists", "existingCount": 18 }
```

- 400: 一巡目の選手が0名。404: 大会なし
- どちらの 409 も `force: true` で越えられる。生成済みで `force` のときは**未生成の一巡目行だけを差分追加**し、`skipped` に既存件数を返す

### 順位データ

| メソッド | パス | 認証 | 用途 |
|---|---|---|---|
| `GET` | `/api/events/:id/ranking` | 将来は保護 | 運営画面・`ranking.html` |
| `GET` | `/api/links/:token/ranking` | **なし** | `share.html` / `present.html` |

両方とも同じ `computeRanking(event)` の結果を返す。○×の `result` 文字列や `order` は含めない。

```json
{ "event": { "name": "第10回…", "date": "2026-09-07", "venue": "東京体育館", "updatedAt": "…" },
  "rankings": { "male":    [ { "rank": 1, "name": "吉野隆志", "score": 74 }, … ],
                "female":  [ … ],
                "newFace": [ … ] } }
```

集計規則は現在の `ranking.html` と同じ：行ごとに `isFemale` で男女に振り分け、`isNewFace` なら新人にも入れる。
氏名で合算（一巡目＋二巡目）。得点降順、同点は同順位で次の順位は飛ぶ（1, 1, 3）。

### 共有トークン

| メソッド | パス | 認証 | 要点 |
|---|---|---|---|
| `POST` | `/api/links` | 将来は保護 | Body `{ "targetType": "event", "targetId": "<大会ID>" }` → `{ "token": "kX3p_a9Q" }`。**冪等**（`event.shareToken` があればそれを返す） |
| `GET` | `/api/links/:token` | **なし** | `{ token, targetType, createdAt }`（`targetId` は含めない。無認証で読める応答から `/api/events/:id` の宛先を漏らさないため）。400（`isValidId` 不通過）／404 |

- トークンは `crypto.randomBytes(6).toString('base64url')`（8文字、`ID_PATTERN` に適合）
- 起動時に `LINKS_DIR` を `mkdirSync`
- `DELETE /api/events/:id` は `shareToken` があれば `links/<token>.json` も削除する（孤児防止）
- 姉妹プロジェクト phx-tournament の同名エンドポイントはトークンを検証せずに `path.join` している。**そこは踏襲しない**

### `api.js` の追加（既存の作法：全関数 try/catch、失敗は文書化した falsy）

```javascript
createPlayer(eventId, data)                 // → player | null
updatePlayerInfo(eventId, playerId, data)   // → { ok: true, player } | { ok: false, status }
deletePlayer(eventId, playerId, force)      // → true | { blocked: true, player } | false
generateNextRound(eventId, force)           // → { success, created, skipped }
                                            //   | { blocked: true, reason, unscoredCount|existingCount } | null
loadRanking(eventId)                        // → { event, rankings } | null
createShareLink(eventId)                    // → { token } | null
loadShareLink(token)                        // → { token, targetType, targetId, createdAt } | null
loadSharedRanking(token)                    // → { event, rankings } | null
```

`updatePlayerInfo` は既存 `updatePlayer` と同じ PATCH を叩くが**別関数**にする。採点経路（`Outbox` → `updatePlayer`）と運営編集経路を混ぜないため。

---

## 採番と二巡目生成

### `order` の採番（追加・コート変更時）

同一 **コート × 性別 × 巡目** の既存 `order` を `/^(.+)-(男子|女子)-(\d+)-(\d+)$/` で解析し、**最大番号 + 1**。該当なしなら 1。
件数+1 ではなく最大+1 を使う（欠番があっても衝突しない）。

**削除時は再採番しない。** 理由：
1. 再採番は他の選手行の `order` を書き換える。採点中の端末が持つ選手のラベルと、コート絞り込みの対象集合が実行中に動く
2. `order` は表示と並び順のためだけの値で、順位は氏名で合算するため欠番は結果に影響しない

### 二巡目生成のアルゴリズム（サーバー・同期）

1. `roundOf(p) === 1` の行を一巡目集合 `src` とする。空なら 400
2. **未採点チェック**：`src.filter(p => !isScored(p))` が1件以上で `force !== true` → 409 `unscored`
3. **冪等性**：既存の二巡目行の `sourcePlayerId` 集合を作る。`force !== true` かつ既存が1件以上 → 409 `exists`。`force === true` なら未生成の `src` だけを差分追加し、既存の二巡目行には触れない
4. 並べ替え：女子先 → `score` 昇順 → 同点は既存 `order` 文字列順で安定化
5. 採番：**コート × 性別ごとに 1 から**。`order = コート + '-' + 性別 + '-2-' + n`
6. 新規行：`id: generateId()`、`tech1..3: ''`、`score: 0`、`result: ''`、`name` / `isFemale` / `isNewFace` を複製、`sourcePlayerId` を付与。**一巡目行は無変更で末尾に追記**
7. `updatedAt` 更新 → `writeJsonAtomic`

**既存の CSV 生成（`app.js` の `onGenNextRound`）との関係**：現行はクライアント側でコートをまたいだ通番の CSV を作る。番号規則をサーバーと二重に持たないため、**このボタンはサーバーの生成 API（`generateNextRound`）を呼ぶ形に置き換える**。確認ダイアログの流れは運営画面と同じ。CSV が必要な場合は既存の「CSVエクスポート」（`GET /api/events/:id/export`）が二巡目行を含む全件を出すので、それで足りる。

`sourcePlayerId` を持たない既存の二巡目行（CSV 経由で作られたもの）は差分判定で「未生成」と見なされるが、`existingCount` は `roundOf` で数えるため既定の 409 で二重生成は防がれる。

---

## 画面設計

### `admin.html` — 下タブ4つ

共通：上部バーに大会名。ハッシュ `#<タブ>/<大会ID>`。タブは常に見える。ダーク／ライトは `Storage.loadTheme` を共用。

**大会 `#events`**
大会の一覧（名前・日付・人数、`updatedAt` 降順）。「＋ 新規大会」で名前・日付・会場のフォーム（シート）。
選ぶと `#players/<大会ID>` へ。削除は既存 API（確認つき）。

**選手 `#players/<大会ID>`**
上部にコート絞り込みのチップ列（`Courts.listFrom` から生成、「全コート」既定）。
行：順番・名前・技3つ・得点。一巡目と二巡目の両方を表示し、巡目は行の左端に小さく出す。
右下の＋で追加フォーム（シート）：

| 項目 | UI |
|---|---|
| 名前 | テキスト |
| コート | セグメント（既存コート＋「＋」で新コート名を入力） |
| 性別 | セグメント（男子／女子） |
| 新人 | トグル |
| 技 | `TechPicker`：チップ①②③、タップでボトムシートが開き一覧から順にタップ。配点を横に表示。チップをタップすると外れる |

「保存して閉じる」「保存して次を追加」。後者は名前と技だけ空にしてコート・性別を保つ（受付を連続処理するため）。
行タップで同じフォームが編集モードで開く。編集モードには「この選手を削除」（採点済みなら得点を出して再確認、`force`）。
**性別変更**：採点済みの選手で性別を変えて保存するとき「得点が変わる可能性があります。採点画面でこの選手を開き直してください」と出す。
CSV インポートは二次導線（メニュー内）として残す（既存の 409 ガードつき）。

**進行 `#round/<大会ID>`**
先頭に「一巡目 採点済み 15 / 18」と「二巡目を生成」ボタン。
- 未採点がいれば「未採点が3名います。このまま生成すると、あとから入る一巡目の得点は二巡目の並び順に反映されません」→ 承諾で `force`
- 生成済みなら「二巡目は生成済みです（18名）。未生成の選手がいれば差分だけ追加しますか」→ 承諾で `force`

その下に二巡目の一覧（コート絞り込み可。既定は「全コート」）。各行：順番・名前・一巡目の得点・技チップ3つ（空きは赤の＋）。
行タップで `TechPicker` のシート。行ごとに「一巡目と同じ技をコピー」（`sourcePlayerId` の行から複製）。
「技 未入力 N」を常時表示し、0 になったら緑。
従来の「二巡目CSV」ダウンロードはメニュー内にバックアップ用として残す。

**結果 `#results/<大会ID>`**
一般男子／新人／一般女子を縦に（`GET /api/events/:id/ranking`）。
ボタン：「最新に更新」「発表モードで開く」「共有リンクをコピー」。
後2つは `createShareLink` でトークンを得て（冪等）、それぞれ `present.html#<token>` を新しいタブで開く／`share.html#<token>` の完全な URL をクリップボードにコピーする。
「共有リンクをコピー」は成功時に「リンクをコピーしました」を短く表示する。

### `share.html#<トークン>` — 参加者向け

順位3部門だけを縦に表示。大会名・日付。60秒ごとに自動更新（`updatedAt` が変わったときだけ再描画）。
トークンが無効なら「このリンクは無効です」。○×や他の生データは API 自体が返さない。

### `present.html#<トークン>` — 大画面用

暗い背景、大きな文字。上部で「掲示」と「発表」を切り替え。

- **掲示（A）**：1画面に1部門。上位3名は太字。タップ／→キーで次の部門、←で前。部門名と「1 / 3」を表示
- **発表（C）**：部門を選び、全員伏せ字（`？？？？`）から始める。タップ／→キーのたびに**下位から1人ずつ**開く。1位が最後。開いた行は残る。「次の部門」で次へ

データはページを開いたときと「更新」ボタンで取得。**発表（C）モード中は自動更新しない**（読み上げ中に順位が動かないように）。掲示（A）モードは60秒ごとに更新してよい。

### `ranking.html` — 差し替え

クライアント側の集計（`parseCsvText` / `renderRankings` / `buildRankTable`）を `GET /api/events/:id/ranking` の結果を描くだけに置き換える。
CSV を読み込んで順位を出す機能は、サーバーに大会がある前提になったので**削除する**（大会選択→サーバーから読む、に一本化）。

---

## `TechPicker` のインタフェース

将来「選手が自分のスマホで技を申告する」画面に流用できるよう、選択状態を純粋関数で持ち、DOM 依存部分と分ける。

```javascript
// techpicker.js
TechPicker.select(state, name)    // 純粋: 未選択なら末尾に追加（最大3）、選択済みなら外す。新しい state を返す
                                  // state は選択順の配列。途中を外すと後ろが詰まる（②を外せば③が②になる）
TechPicker.toArray(state)         // 純粋: ['技1', '技2', '技3']（未選択は ''）
TechPicker.fromArray(names)       // 純粋: ['技1','技2','技3'] → state
TechPicker.open(options)          // シートを開く。{ techniques, initial, onChange, onClose }
TechPicker.renderChips(el, state, onTap)  // チップ①②③を描く
```

`techniques` は `Api.loadTechniques()` の結果（サーバーのカスタム技術リストを含む）。配点は `strikes` から `1/5/7/3` の形で表示する。
シートは `position: fixed` の下部パネルで、リストは縦スクロール。既に3つ選んでいるときに4つ目をタップしても何も起きない（チップを外してから）。

---

## 認証タスクへの申し送り

並行セッションで認証を追加している。両者の噛み合わせ：

**無認証のまま通すこと**
- `GET /api/links/:token`、`GET /api/links/:token/ranking`
- `share.html`、`present.html`、`share.js`、`present.js`、`share.css`、`present.css`、`theme.css`、`api.js`
- 静的配信から `/server` 配下を除外している（`server/data` の生 JSON が無認証で読めないようにするため）。認証を足す際もこの除外を外さないこと。`GET /api/links/:token` は `targetId` を返さない（`{ token, targetType, createdAt }` のみ）

**保護対象**
- `/api/events*` の全メソッド、`POST /api/links`、`/api/techniques` の書き込み
- `admin.html`、`index.html`、`ranking.html`、`techniques.html`

両セッションが `server/index.js` を触る。**先に着地した方に後から合わせる**。本設計のサーバー変更は「新規ルートの追加」と「PATCH の allowlist 化」で、認証ミドルウェアの挿入位置と独立にできる。

---

## エラー処理

運営操作はすべて低頻度・明示的なので、前設計書の線引きどおり**その場で `await` して失敗は `alert`**。

- 409 は内容（人数・得点）を出して確認し、承諾時のみ `force` で再送
- 通信失敗時はフォームを閉じず入力を残す（大会作成の修正と同じ作法）
- `Api.loadTechniques()` に失敗したら `TechPicker` は開けない。「技術リストを取得できませんでした」と出し、技以外は保存できるようにする
- 運営画面は採点しないので送信キュー（`Outbox`）は使わない
- `share.html` / `present.html` の取得失敗は画面上に「更新できませんでした（前回 HH:MM 時点）」と出し、前回の内容を残す

---

## テスト（`test.html` に追加）

### サーバー（実サーバーに対して）

1. `createPlayer` の `order` が `A-男子-1-1`、同条件でもう1名で `-1-2`
2. 別コート `B`／女子で追加すると番号が 1 に戻る
3. 番号 2 を削除してから追加すると `-1-3`（欠番を埋めない）
4. `updatePlayerInfo` で `name` を変えても `id` 不変。body に `id` を入れても書き換わらない
5. `updatePlayerInfo` で `court` を `B` に変えると `order` が `B-…` に再組立て
6. 採点済み選手の `deletePlayer(force=false)` が `{ blocked, player.score }`、`force=true` で成功
7. `generateNextRound`：全員採点済みで `created === 一巡目人数`、**一巡目行の `id` が全て不変**
8. 続けてもう一度呼ぶと `blocked: 'exists'`、`players.length` が増えない
9. 未採点が残る大会で `blocked: 'unscored'` と `unscoredCount`、`force: true` で通る
10. 生成された二巡目行：`order` が `-2-`、コート×性別ごとに 1 から、`tech1..3` が空、`score === 0`、`sourcePlayerId` が一巡目の `id`、女子が先頭
11. `createShareLink` を2回呼ぶと同じトークン
12. `loadSharedRanking` が氏名合算・同点同順位（1,1,3）を返し、`result` を含まない
13. 不正トークン（`..%2F..%2Fevents%2Fxxx` 相当）が `null`（サーバーは 400）
14. 大会削除で `links/<token>.json` も消える（削除後の `loadShareLink` が `null`）
15. 既存の「並行PATCH12本が全件反映される」は**そのまま維持**

### クライアント（純粋関数）

16. `TechPicker.select`：空に追加／2つ目を末尾に／3つで打ち止め／選択済みをタップで外す／順序が保たれる
17. `TechPicker.toArray` / `fromArray` の往復
18. `roundOf`：`A-男子-2-3` → 2、`A-男子-1-1` → 1、空 → 1、不正形式 → 1

### 手動確認

- スマホ幅（375px）で4タブすべてが横スクロールなしに収まる。タップ目標は 44px 以上
- 「保存して次を追加」で3人続けて登録し、コート・性別が保たれる
- タブレットで一巡目を採点中に運営スマホで選手を追加・編集し、タブレットの採点が影響を受けない
- 二巡目生成 → 技入力 → タブレットで「大会データを読み込む」と二巡目の選手が出る
- `share.html` を別端末で開き、採点中に順位が60秒以内に追随する
- `present.html` の発表モードで、タップごとに下位から1人ずつ開き、1位が最後になる
- ライト／ダーク両テーマで新規3ページが読める

---

## 実装の分割

規模が大きいので、**設計書は1本、実装計画は3本**に分ける。各段階が単独で検証できる順。

| 計画 | 内容 | 検証 |
|---|---|---|
| **1. サーバー API と `api.js`** | 選手 CRUD、二巡目生成、順位、共有トークン、`roundOf`（サーバー側と `Courts.roundOf` の両方）、`computeRanking` | `test.html` の 1〜15 と 18 |
| **2. `theme.css` 切り出し・`TechPicker`・`admin.html` の大会／選手タブ** | 運営画面の土台と登録フロー | 16〜17 ＋ 手動確認の前半 |
| **3. 進行タブ・結果タブ・`share.html`・`present.html`・`ranking.html` 差し替え・`app.js` の二巡目生成をAPI呼び出しに** | 二巡目と発表 | 手動確認の後半 |

---

## リスクと未解決事項

- **端末は他端末の追加行を知らない**。ポーリングは無い設計なので、運営が追加した選手はタブレットが大会を選び直すまで出ない。運用手順として周知する（「選手を足したらタブレットで大会を選び直す」）
- **一巡目の採点中に `force` で二巡目を生成**すると、後から入る一巡目の得点は二巡目の並び順に反映されない。UI の確認文言に明記する
- **採点中の選手を運営が削除**すると、その端末の送信キューが 404 を受けて破棄し警告を出す（前設計の C-2 対応で実装済み）。409 ガードで誤削除自体を減らす
- **共有リンクは URL を知る全員が閲覧可**（無認証が要件）。失効手段は現状「大会削除」のみ。`DELETE /api/links/:token` は将来
- **`sourcePlayerId` の無い既存の二巡目行**（CSV 経由）は差分判定で「未生成」扱い。既定の 409 で二重生成は防がれるが、`force` を押すと重複しうる。確認文言で「CSV で作った二巡目がある大会では使わないでください」と出す
