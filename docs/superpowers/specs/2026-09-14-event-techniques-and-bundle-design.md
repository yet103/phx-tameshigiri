# 大会ごとの技マスタと、大会の一括エクスポート／インポート

**日付**: 2026-09-14
**対象**: phx-tameshigiri（試し斬り採点システム）
**前提となる設計書**: [2026-09-13-scoring-refinement-and-bulk-entry-design.md](2026-09-13-scoring-refinement-and-bulk-entry-design.md)（選手の項目・CSV 15 列）、[2026-09-08-mobile-admin-flow-design.md](2026-09-08-mobile-admin-flow-design.md)（運営画面・共有トークン）、[2026-09-13-live-board-design.md](2026-09-13-live-board-design.md)（配信用ボードの `techniques` 同梱）

技（形）の配点マスタは今、サーバー全体で 1 つ（`server/data/techniques/custom.json`、無ければコードの既定値）で、採点画面・技シート・技術リスト編集・配信ボードのどれも大会 ID を持たずに読んでいる。これを **大会ごとに固有** にする（A）。あわせて、大会を **1 ファイルに丸ごと保存し、別サーバーで取り込める** ようにする（B）。B は A の保存形式に依存するので A を先に作る。

---

## 決定事項

| 論点 | 決定 |
|---|---|
| 技マスタの置き場所 | **大会 JSON に `techniques` を同梱**（別ファイルにしない。削除・エクスポートが大会と一緒に済む） |
| 新規大会の初期値 | **雛形を複製**して持つ。雛形＝今の全体リスト（`custom.json`、無ければ既定値）。技術リスト編集画面で「別の大会からコピー」もできる |
| 今の全体リスト（`custom.json`） | **雛形として残す**。技術リスト編集画面で雛形も編集できる。`techniques` を持たない既存大会は雛形を使う（初めて編集したときに大会へ保存される） |
| 取り込んだ大会の ID | **常に新しい大会として追加**。既存を上書きしない。同名・同日の大会があれば取り込み前に確認 |
| エクスポートに含めるもの | **大会情報＋技マスタ＋選手（全項目）＋採点履歴**。共有リンクのトークンと配信ボードの状態は含めない（取り込み先で発行し直す） |

---

## A. 大会ごとの技マスタ

### データ

大会 JSON（`server/data/events/<id>.json`）に `techniques` を足す。形は `GET /api/techniques` の `techniques` と同じ。

```json
"techniques": [
  { "name": "立位袈裟", "strikes": [1, null, null, null] },
  { "name": "四方",     "strikes": [17, 5, 7, 3] }
]
```

- **有効な技リスト**（その大会の採点に使うもの）＝ `event.techniques` が配列ならそれ、無ければ雛形（`readTechniques().techniques`）。サーバーは `effectiveTechniques(event)` を 1 か所に置き、全ハンドラがそれを使う。
- 雛形は今のまま `custom.json` ／ `DEFAULT_TECHNIQUES`。`GET/POST/DELETE /api/techniques` の意味は変えない（「雛形の取得・保存・既定値に戻す」）。`data.js` の `TECHNIQUES` は引き続き通信失敗時の端末側の控え。
- 既存大会の一括移行はしない。`techniques` が無い大会は雛形で動き続ける。雛形を後から変えるとその大会の有効な技リストも変わるので、大会の技リストを固定したいときは編集画面で「保存」すれば大会に写る（下記）。

### サーバー（server/index.js）

すべて同期ハンドラのまま（`server/index.js` の不変条件）。書き込みは `writeJsonAtomic` 1 回。

| API | 内容 |
|---|---|
| `GET /api/events/:id` | 応答の `techniques` は **常に有効な技リスト**（無い大会は雛形の複製を応答にだけ足す。ファイルには書かない）。応答に `techniquesSource: 'event' | 'template'` を足す |
| `GET /api/events/:id/techniques` | `{ source: 'event' \| 'template', techniques: [...] }` |
| `PUT /api/events/:id/techniques` | body `{ techniques: [...] }`。検証に通れば `event.techniques` を置き換え、`updatedAt` 更新。応答 `{ success: true, techniques }` |
| `DELETE /api/events/:id/techniques` | `event.techniques` を **雛形の複製に置き換える**（「雛形に戻す」。雛形との連動状態には戻さない。戻すと後で雛形を変えたとき採点中の大会が動くため） |
| `POST /api/events`（新規作成） | body に `techniques` が無く、そのファイルがまだ無ければ **雛形を複製して `techniques` に入れる**。同じ ID の既存ファイルがあり body に `techniques` が無ければ、既存の `techniques` を引き継ぐ（`shareToken` と同じ扱い） |
| `GET /api/links/:token/live` | `techniques: effectiveTechniques(event)` |

技リストの検証（`PUT` と B の取り込みで共用。`validateTechniques(list)` → エラー文字列 or null）:

- 配列で 1〜200 件。
- 各要素: `name` は文字列を trim して 1〜50 文字、重複不可（`(男)` `(女)` 付きは別名として扱う）。`strikes` は長さ 4 の配列で、各要素は `null` か 0〜99 の整数。
- 上記以外のキーは捨てる（`{ name, strikes }` だけを保存）。
- 違反は 400 `{ error: 'n 行目の技名が空です' }` のように行番号付きで返す。

### クライアント

**api.js**: `loadEventTechniques(eventId)`（`{source, techniques}` | null）、`saveEventTechniques(eventId, techs)`（`{success}` | `{error}` | null）、`resetEventTechniques(eventId)`（真偽）。既存の `loadTechniques / saveTechniques / resetTechniques` は雛形用として残す。

**採点画面（app.js）**: `init()` の雛形読み込みは残す（大会未選択時と通信失敗時の控え）。`onEventSelect` で `Api.loadEvent` の応答の `techniques` を `Scoring.setTechniques` に入れる。応答に無ければ（旧サーバー）雛形のまま。大会を離れたら雛形に戻す。上部リンク「技術リスト編集」は選択中の大会があれば `techniques.html#<eventId>` へ。

**運営画面**: `admin.js` が大会を読むときの `ctx` に `techniques`（有効な技リスト）を足す。`admin-players.js` / `admin-round.js` の技キャッシュは **大会 ID ごと** にし、`ctx.techniques` があればそれを使う（`Api.loadTechniques()` は呼ばない）。⋯メニュー「技術リスト編集」は `techniques.html#<currentEventId>`（大会未選択なら `techniques.html`＝雛形）。

**技術リスト編集（techniques.html）**:

- 上部に対象の切り替え: `<select>` で「雛形（新規大会の初期値）」と大会一覧（`Api.listEvents()`、更新日の新しい順）。ハッシュ `#<eventId>` で開けばその大会が選ばれる。切り替えると表を読み直す（未保存の編集があれば確認）。
- 見出しに対象名を出す（「名古屋城決戦 の技リスト」「雛形（新規大会の初期値）」）。大会で `source` が `template` のときは「この大会はまだ雛形を使っています。保存するとこの大会だけの技リストになります」と出す。
- 大会に採点済みの選手がいれば（`Courts.isScored` の規則）警告を常時表示: 「採点済みの選手が n 名います。配点を変えても保存済みの得点は変わりません（採点し直すと新しい配点で計算されます）」。
- ボタン: 「保存」（大会なら `PUT /api/events/:id/techniques`、雛形なら `POST /api/techniques`）、「雛形に戻す」（大会。`DELETE /api/events/:id/techniques`）／「デフォルト設定に戻す」（雛形。`DELETE /api/techniques`）、「別の大会からコピー」（大会一覧のシートから 1 つ選ぶと、その大会の有効な技リストを表に読み込む。保存するまでサーバーには書かない）。
- 400 の `error` はそのまま alert に出す。
- 通信失敗時の「端末側の既定値を表示・保存無効」の挙動は今のまま。

**配信ボード・順位・発表・共有**: 変更なし（ボードはサーバーが有効な技リストを返す。順位は保存済みの `score` の合算）。

**マニュアル（help.html）**: §1 の技の選び方に「配点は大会ごと。技術リスト編集は⋯メニューから、選択中の大会のものが開く」を足す。§3 の「技術リスト編集で変えられる」を「大会ごとに変えられる。雛形を変えても既に技リストを持つ大会は変わらない」に直す。

---

## B. 大会の一括エクスポート／インポート

### ファイル形式（`.json`）

```json
{
  "format": "phx-tameshigiri-event",
  "version": 1,
  "exportedAt": "2026-09-14T05:00:00.000Z",
  "sourceEventId": "mu08vucj5f26xgt3v",
  "event": {
    "name": "名古屋城決戦", "date": "2025-10-25", "venue": "名古屋城",
    "createdAt": "…", "updatedAt": "…",
    "techniques": [ { "name": "…", "strikes": [ … ] } ],
    "players": [
      { "id": "…", "name": "…", "order": "A-男子-1-1", "tech1": "…", "tech2": "…", "tech3": "…",
        "score": 66, "isNewFace": false, "isFemale": false, "result": "1110 11   111  ",
        "adjust": [0, 0, 0], "totalAdjust": 0, "note": "", "confirmed": true, "sourcePlayerId": "…" }
    ]
  },
  "history": [ { "action": "…", "timestamp": "…" } ]
}
```

- `event.techniques` は **有効な技リスト**（雛形を使っている大会は雛形の複製）。取り込み先の雛形に依存させない。
- 選手は上のキーだけ（`adjust` 等は持っている選手にだけ付く）。`shareToken` と `live` は **出さない**。
- `event.status` は大会が `STATES`（`draft`/`round1`/`round1_done`/`round2`/`round2_done`/`final`/`archived`）に含まれる値を持つときだけ出す。持たない大会（この機能より前に作られた・取り込んだ大会）は出さない＝取り込み側は選手から推定する（全体点検 2026-09-22 A-2）。
- `history` は `history/<id>.json` の `entries`（無ければ `[]`）。
- `sourceEventId` は参照用。取り込みには使わない。
- ファイル名: `tameshigiri_<日付>_<大会名>.json`。大会名は `/ \ : * ? " < > |` と制御文字を `_` に置き換え、40 文字で切る。

### サーバー

| API | 内容 |
|---|---|
| `GET /api/events/:id/bundle` | 上の JSON を返す。`Content-Disposition: attachment; filename*=UTF-8''…`。大会が無ければ 404 |
| `POST /api/events/import` | body ＝上の JSON。検証に通れば **新しい ID** で `events/<id>.json` を作り、`history` があれば `history/<id>.json` に `{ eventId, entries }` を書く。応答 `{ success: true, id, playerCount }` |

取り込みの検証（違反は 400 と日本語の `error`）:

- `format === 'phx-tameshigiri-event'`、`version === 1`。`event` がオブジェクト、`event.name` が trim して 1〜100 文字。`date` `venue` は文字列（無ければ `''`）。`createdAt` `updatedAt` は取り込み時刻で付け直す（元の値は使わない）。
- `techniques` は `validateTechniques`。無ければ雛形を複製。
- `players` は配列で 0〜2000 件。各選手は **許可リストのキーだけ** を取り込む: `name`（文字列、1〜100）、`order`（文字列 ≤ 40）、`tech1..3`（文字列 ≤ 50、trim）、`score`（有限数。無ければ 0）、`isNewFace` `isFemale` `confirmed`（真偽に変換）、`result`（`/^[01 ]*$/`、≤ 100 文字。違反なら `''`）、`adjust`（長さ 3 の整数配列のときだけ）、`totalAdjust`（整数のときだけ）、`note`（trim ≤ 200）、`sourcePlayerId`。
- 選手 `id`: 有効な ID（`isValidId`）でファイル内で一意ならそのまま使う。無効・重複なら振り直し、`sourcePlayerId` も新しい ID に付け替える。`sourcePlayerId` がファイル内のどの選手も指していなければ捨てる。
- `history` は配列（無ければ `[]`）で 0〜20000 件。各要素はオブジェクトのみ通し、`timestamp` が無ければ取り込み時刻。
- `shareToken` `live` `id` が `event` に入っていても **無視**する。
- `status` は `STATES` に含まれる値ならそのまま採用する（`final`/`archived` を含む。取り込み後もロックが効くようにするため）。無い・不正な値（古いバンドル）は付けない＝選手から推定する（全体点検 2026-09-22 A-2）。
- 同じ ID の大会は生まれない（`generateId`）。同名・同日の確認はクライアントが行う。

### クライアント

**api.js**: `exportBundle(eventId)`（JSON 文字列 | null）、`importBundle(bundleObj)`（`{success, id, playerCount}` | `{error}` | null）。

**運営画面・大会タブ（admin-events.js）**:

- 各大会の行の右端の「✕」を「⋯」に替え、シートに「💾 ファイルに保存」「🗑 削除」を置く（削除の確認文言は今のまま）。「ファイルに保存」は `Api.exportBundle` → `Storage.downloadText(filename, json, 'application/json')`（`downloadCsv` と同じ仕組み）。ファイル名はサーバーの `Content-Disposition` を使わず、クライアントで同じ規則で組む（`Storage.bundleFilename(name, date)`。純粋関数にしてテストする）。
- 見出しの「＋ 新規大会」の左に「📂 取り込む」。`<input type="file" accept=".json,application/json">` を開き、読んだテキストを `JSON.parse`。失敗したら「ファイルを読めませんでした」。取り込み前に `format`/`version` を見る。`format` 違いは「このアプリのエクスポートファイルではありません」、`version` 違いは「対応していないファイル形式です（version: n）」。大会一覧に同名・同日の大会があれば「同じ名前と日付の大会が既にあります。別の大会として追加しますか？」で確認。成功したら toast「大会を取り込みました（n 名）」→ 選手タブへ。400 の `error` は alert。
- 運営画面の⋯メニューにも「💾 大会をファイルに保存」（大会選択中のみ）。

**採点画面**: 変更なし（CSV エクスポート・HTML 保存は残す）。

**マニュアル（help.html）**: §1 に「別のサーバーや PC から取り込む」（大会タブ → 取り込む → ファイルを選ぶ）、§4 の後に「大会をファイルに保存する」（大会タブ → ⋯ → ファイルに保存。共有リンクは取り込み先で作り直す）。§5 に「取り込めない → エクスポートファイルか確認、version」。

**名古屋城決戦の本番登録**: この機能で「開発サーバーで保存 → 本番の運営画面で取り込む」と、サーバーに触らずに済む。

---

## テスト（test.html）

- **API（技マスタ）**: 新規作成で `techniques` が雛形の複製になる／`GET /api/events/:id` の `techniquesSource`／`GET :id/techniques` の `source`／`PUT` の検証（名前空 400、strikes 長さ違い 400、重複名 400、成功で保存）／`DELETE` で雛形の複製に戻る／雛形を変えても `techniques` を持つ大会は変わらない／`GET /api/links/:token/live` がその大会の技リストを返す。
- **API（入出力）**: `bundle` の形（`format` `version`、`shareToken` `live` を含まない、`techniques` あり、`history` あり）／`import` の検証（format 違い 400、name 空 400、players 上限 400）／取り込んだ大会の ID が元と違う／選手の項目が復元される／`sourcePlayerId` が付け替わる／`history` が書かれる／`shareToken` を入れても無視される／許可リスト外のキーが落ちる。
- **純粋関数**: `Storage.bundleFilename`（禁止文字の置換・40 文字で切る・日付無し）。
- 既存の 405 件は通ったままにする。テスト用の大会は必ず削除する。

## 進め方

- **トラック A**（技マスタ）→ **トラック B**（入出力）の順。B は A のマージ後に着手。
- 実装は Sonnet、仕様レビューとコード品質レビューは Opus。各トラックは worktree で別ポート。
- 本物の大会「第10回全日本試し斬り大会」「名古屋城決戦」の JSON には触れない。
- 認証タスク（別セッション）への申し送り: `GET/PUT/DELETE /api/events/:id/techniques`、`GET /api/events/:id/bundle`、`POST /api/events/import` は運営系（採点 API と同じ扱い）。
