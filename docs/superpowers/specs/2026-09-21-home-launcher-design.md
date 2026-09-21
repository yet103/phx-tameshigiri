# トップを「新規作成／作成済みの大会」の二択にする（テンプレート・コピー・テスト大会）

**日付**: 2026-09-21
**対象**: phx-tameshigiri（試し斬り採点システム）
**前提となる設計書**: [2026-09-18-pc-mode-and-event-status-design.md](2026-09-18-pc-mode-and-event-status-design.md)（トップ・コピー API）、[2026-09-19-player-extra-fields-design.md](2026-09-19-player-extra-fields-design.md)（大会の `settings`）

「初めの画面がごちゃごちゃで分かりにくい」への対応。トップを 2 つの入口にし、新規作成をテンプレート・コピー・完全新規から選ぶ作成画面にする。ユーザー承認済み（「二巡目なし」の既定は不要）。

## 決定事項

| 論点 | 決定 |
|---|---|
| トップの入口 | **「＋ 大会を新規作成」「▶ 作成済みの大会」の 2 つ**。採点画面・順位表示・ヘルプは小さなリンク。説明と 7 段階の流れは「このアプリについて」に畳む（既定は閉じる） |
| 作成済みの大会 | 押すと一覧（進行中 → 準備中 → 終了の順、状態バッジ、`archived` は「アーカイブ」に畳む、テスト大会は既定で隠し「テストも表示」で出す）。**5 件まで**表示し「すべて見る」で残りを開く。行を押すと運営画面のその大会（`Storage.adminHref('#players/<id>')`） |
| 新規作成 | 2 段階。1 段目で **「前回の大会をコピー」（先頭）／テンプレートから／作成済みの大会からコピー／完全新規**。2 段目で名前・日付・会場（コピーは元の大会の選択と「選手も複製する」）。作成後は運営画面の選手登録へ |
| テンプレート | **稽古用**（技術マスタの雛形、コート「稽古」1 つ）／**大会用**（雛形、コート A・B、ゼッケン必須 on）／**システムテスト用**（雛形、コート A・B、ダミー選手 男子01〜10・女子01〜10、技は雛形から 3 つずつ順に、`test: true`） |
| コート一覧 | 大会の `settings.courts`（文字列の配列、既定 `[]`）。基本情報で編集。選手のコートと合わせて `Courts.listFrom` の候補に出す |
| テスト大会 | 大会の `test: true`。トップの一覧で既定非表示（バッジ「テスト」）。運営画面の大会一覧・採点画面の選択肢には出す（テストで使うため）。バッジは運営画面の一覧にも出す |
| 二巡目なしの既定 | **入れない** |

## データ

```
event に  settings.courts: string[]   コート一覧（コート名の規則は選手と同じ: 空・'-'・'未分類' 不可、32 文字まで、重複なし、最大 20）
          test: boolean               テスト大会（既定 false。`POST /api/events` の body では無視し、テンプレート API だけが true にする）
```

- `GET /api/events` の各要素に `test` を足す。`GET /api/events/:id` にも
- コピーとバンドルは `settings.courts` を写す。`test` は**写さない**（コピー先は本物として扱う。バンドルの取り込みも false）
- `PATCH /api/events/:id` の `settings` は `requireBib` `requireRank` に加えて `courts` を受ける（検証は上の規則。不正なら 400「コート名「x」は使えません」）
- `Courts.listFrom(players, extraCourts)`: 第 2 引数（省略可）を足し、選手のコートと `extraCourts` の和集合を昇順で返す（`未分類` は末尾）。既存の 1 引数呼び出しは変えない。画面側は `Courts.listFrom(ctx.players, ctx.event.settings && ctx.event.settings.courts)` を使う（PC 選手登録のコート候補、貼り付けの既定コート、スマホのフォーム、試合進行のカード、基本情報のコート一覧）

## API

### テンプレートから作成 `POST /api/events/from-template`（新規）

```
リクエスト: { "template": "practice" | "tournament" | "systest", "name": "…", "date": "2026-09-21", "venue": "…" }
201:        { "success": true, "id": "<大会ID>", "playerCount": 20 }
400:        template が不明 / name が空・100 文字超
```

| template | 作る内容 |
|---|---|
| `practice` | `techniques` は雛形（`readTechniques()` を `cloneTechniques`）、`settings: { requireBib:false, requireRank:false, courts:['稽古'] }`、選手なし、`status: 'draft'` |
| `tournament` | 同上だが `courts:['A','B']`、`requireBib:true` |
| `systest` | `tournament` に加えて選手 20 名: 男子01〜10 を A・B に交互（`A-男子-1-1` …）、女子01〜10 も交互。技 3 つは雛形の技リストを先頭から順に回して割り当てる（`repeatable` でない同じ技を 1 人に 2 回入れない。性別の接尾辞付きの技は接尾辞なしの名前で）。`bib` は 1〜20 の連番。`test: true` |

「前回の大会をコピー」は既存の `POST /api/events/:id/copy` を使う（`updatedAt` が最新で `test` でない大会を元にする。無ければ項目を出さない）。

### `api.js`

```javascript
createFromTemplate(template, data)   // → { id, playerCount } | { error } | null
```

## 画面

### トップ `index.html` / `home.js` / `home.css`

```
┌──────────────────────────────────────────────┐
│ 試し斬り採点システム                 🌙  🖥/📱 │
├──────────────────────────────────────────────┤
│  ┌──────────────────┐ ┌──────────────────┐   │
│  │ ＋ 大会を新規作成  │ │ ▶ 作成済みの大会  │   │
│  │ テンプレート・コピー│ │ 選んで開始・続き  │   │
│  └──────────────────┘ └──────────────────┘   │
│  コート端末の方は 採点画面 ／ 順位表示 ／ ヘルプ │
│  ▸ このアプリについて                          │
└──────────────────────────────────────────────┘
```

- 2 つの入口はハッシュで切り替える: `#new`（作成画面）/ `#list`（一覧）。ハッシュ無しは入口だけ。戻るボタンで入口に戻れる。`#event/…` の転送は今までどおり最優先
- **`#list`**: 見出し「作成済みの大会」、一覧（`Home.sortForHome` の順。`test` は隠す。「テストも表示」のチェックで出す。5 件まで＋「すべて見る」。`archived` は「▸ アーカイブ（n 件）」）。行の右に状態バッジ（テストは「テスト」バッジも）。行を押すと `Storage.adminHref('#players/<id>')`
- **`#new`**: 1 段目はカード 4 つ（前回の大会をコピー／テンプレートから／作成済みの大会からコピー／完全新規）。テンプレートを選ぶと 3 つのテンプレートのカード（名前と 1 行説明）。2 段目はフォーム（名前・日付（今日）・会場。コピーは元の大会のセレクトと「選手も複製する（得点は消す）」）。「作成」で API → 成功したら `Storage.adminHref('#players/<id>')` へ。失敗はフォームを残して alert
- 「このアプリについて」: `<details>` で説明 2 段落と流れの帯を包む。既定は閉じる
- 375px で入口 2 つが縦に並び、1 画面に収まる

### 基本情報 `desk-setup.js`

- コート一覧を読み取り専用から**編集可**に: チップ＋「＋ コートを足す」（名前を入力。規則の検証はクライアントでも同じ文言）、チップの「×」で外す（そのコートに選手がいれば外せない旨を alert）。保存は `updateEventInfo({ settings })` に `courts` を含める。選手から導出したコートは灰色のチップで「（選手あり）」と示し、外せない
- テストの印（`test`）は基本情報に「テスト大会（一覧では既定で隠れます）」の読み取り専用の表示だけ（変更 UI は無し）

### 運営画面の大会一覧（`desk-events.js` / `admin-events.js`）

- 行にテストのバッジ（`test`）。隠さない

### スマホ運営の大会作成（`admin-events.js`）

- 変更なし（完全新規のまま）。テンプレートはトップから

### ヘルプ

- 「トップページ」の節を新しい構成に、「大会を作る」にテンプレート 3 種と「前回の大会をコピー」、「基本情報」にコート一覧

## 純粋関数（`courts.js` / `home.js`。`test.html` で固定）

```javascript
Courts.listFrom(players, extraCourts)          // 和集合。extraCourts 省略で従来どおり
Courts.validateCourtList(list)                 // → '' | エラー文言（空・'-'・'未分類'・32 文字超・重複・20 件超）
Home.sortForHome(events)                       // 既存。test を含む配列を返し、隠すのは描画側
Home.pickPrevious(events)                      // 「前回の大会」: test でなく archived でもない中で updatedAt が最新。無ければ null
Home.templateSpec(template)                    // クライアントの表示用: { name, description }（3 種）
```

## テスト（`test.html`）

1. サーバー: `from-template` の 3 種（`practice` は選手 0・`courts:['稽古']`、`tournament` は `requireBib` と `['A','B']`、`systest` は 20 名・`bib` 1〜20・男女 10 ずつ・A/B 交互・技 3 つが雛形にある名前・同じ形が 2 回入っていない・`test: true`）。不明な template と空の name が 400。`GET /api/events` に `test`
2. サーバー: `PATCH settings.courts` の検証（重複・`-`・21 件）と保存、コピーとバンドルで `courts` が写り `test` が false になる、`POST /api/events` の body の `test` が無視される
3. `Courts.listFrom` の第 2 引数（和集合・昇順・未分類末尾・重複なし）、`validateCourtList`
4. `Home.pickPrevious`（test と archived を除く、最新）、`templateSpec`
5. 既存テストがすべて通る（現在 1066）

## 手動確認

- トップ 375px / 1280px: 入口 2 つ、小さなリンク、折りたたみ。`#event/…` の転送は生きている
- 新規作成の 4 経路すべてで大会ができて選手登録に着地する。稽古用のコート候補に「稽古」、大会用に A・B、テスト用に 20 名と「テスト」バッジ
- 作成済みの一覧でテストが隠れ、「テストも表示」で出る。5 件で「すべて見る」
- 基本情報でコートを足す・外す（選手がいるコートは外せない）→ 選手登録のコート候補に反映
- 「前回の大会をコピー」が最新の本物の大会を元にする

## 実装の分割（1 計画）

| トラック | 内容 | ファイル |
|---|---|---|
| A | サーバー（`from-template`、`settings.courts`、`test`、コピー・バンドル）と `api.js`、`Courts.listFrom` / `validateCourtList` | `server/index.js` `api.js` `courts.js` `test.html` |
| B | トップの作り直し（`#new` / `#list`、作成画面、折りたたみ） | `index.html` `home.js` `home.css` `test.html`（`Home.*`） |
| C | 基本情報のコート一覧の編集、各画面のコート候補に `settings.courts` を含める、運営画面の一覧のテストバッジ、ヘルプ | `desk-setup.js` `desk-players.js` `desk-match.js` `admin-players.js` `admin-round.js` `desk-events.js` `admin-events.js` `help.html` |

A が先。B と C は A の後で並行（`test.html` は A と B が触るので、B は `Home.*` の節に追記し、A の完了後に始める）。commit は `git commit -- <ファイル>`（pathspec）で行い、`git add` と `git reset` は使わない。
