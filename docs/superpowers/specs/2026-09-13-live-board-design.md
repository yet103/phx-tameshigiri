# 配信用ボード（OBS ブラウザソース向け）

**日付**: 2026-09-13
**対象**: phx-tameshigiri（試し斬り採点システム）
**前提となる設計書**: [2026-09-13-scoring-refinement-and-bulk-entry-design.md](2026-09-13-scoring-refinement-and-bulk-entry-design.md)（データモデル・配色・フォント）、[2026-09-08-mobile-admin-flow-design.md](2026-09-08-mobile-admin-flow-design.md)（共有トークン）

YouTube ライブ配信（OBS）に、A コート・B コートの採点の様子をそれぞれ映す。OBS の「ブラウザソース」で開く閲覧専用ページ `board.html` を追加し、採点画面が「今どの選手を開いているか」「タイマーの状態」をサーバーへ送る仕組みを足す。

---

## 決定事項

| 論点 | 決定 |
|---|---|
| 方式 | **配信専用の閲覧ページ＋ブラウザソース**（タブレットの画面ミラーは採らない） |
| 表示するもの | コート、今の選手（順番・名前）、技①②③と各太刀の 未／成功／失敗、補正点、行の得点、合計、確定済みか、**タイマー** |
| 認証 | 共有リンクと同じ **トークン**（`POST /api/links` で発行済みのもの）。無認証で読めるのは今の選手1人分だけ |
| 更新 | 配信ページが **2秒ごと**にサーバーを読む（push は使わない） |
| 「今の選手」 | 採点画面が選手を切り替えたとき・タイマーを操作したときにサーバーへ送る（1秒ごとの送信はしない） |
| 見た目 | 黒金（ダークと同じ変数）。`?bg=transparent` で背景を透過にできる。文字は 1920×1080 の配信で読める大きさ（選手名 64px 以上） |

---

## サーバー

### ライブ状態の保存

大会 JSON に `live` を足す（コートごと）。`updatedAt` はサーバーの受信時刻（ISO）。

```json
"live": {
  "A": { "playerId": "…", "timer": { "sec": 300, "running": true }, "updatedAt": "2026-10-11T01:23:45.678Z" },
  "B": { … }
}
```

### `PUT /api/events/:id/live/:court`

- 採点画面（コート端末）が送る。認証は他の採点 API と同じ（現状は無し）。
- body: `{ playerId: string|null, timer: { sec: 整数(0..5999), running: 真偽値 } }`
- 検証: `:court` は `isValidCourt`。`playerId` は `null` か、その大会に存在する選手の ID（無ければ 400）。`timer` が無ければ既存の値を保つ。`sec` が整数でなければ 400。
- 応答: `{ success: true, live: { …そのコートの値… } }`
- 同期ハンドラのまま（`server/index.js:294` の不変条件）。`writeJsonAtomic` 1回。

### `GET /api/links/:token/live`

- 無認証（共有リンクと同じ扱い。`share.*` / `present.*` と同じく静的配信の例外にも `board.*` を足す）。
- 応答:

```json
{
  "eventName": "…",
  "now": "2026-10-11T01:23:47.000Z",
  "courts": {
    "A": {
      "updatedAt": "…",
      "timer": { "sec": 300, "running": true },
      "player": { "name": "…", "order": "A-男子-1-3", "isFemale": false, "tech1": "…", "tech2": "…", "tech3": "…",
                  "result": "…", "adjust": [0,0,0], "totalAdjust": 0, "score": 41, "confirmed": false }
    },
    "B": null
  },
  "techniques": [ { "name": "…", "strikes": [20,4,4,2] }, … ]
}
```

- `player` は `live[court].playerId` の選手が大会に存在するときだけ。`result` / `adjust` を返すのは**今の選手1人分だけ**（名簿全体の生データは返さない。`GET /api/links/:token` の方針を守る）。
- `techniques` は `GET /api/techniques` と同じ内容（配点の描画に使う。毎回返してよい、小さい）。
- `courts` はライブ状態があるコートだけ。トークンが無効なら 404。

---

## 採点画面（app.js）

- `publishLive()`: `Api.putLive(eventId, court, { playerId, timer: { sec: timerSec, running: timerRunning } })` を呼ぶ。通信は待たず、失敗は黙って捨てる（採点を止めない。コンソールにだけ出す）。
- 送るタイミング: `selectPlayer` で選手が変わったとき、`startTimer` / `stopTimer` / `resetTimer`、大会・コートの切替直後（選手が決まった時点）。1秒ごとの減算では送らない。
- コート: `currentCourt` が空（全コート表示）なら `Courts.courtOf(選手)`。`未分類` なら送らない。
- `api.js` に `putLive(eventId, court, body)` と `loadLive(token)` を足す。

---

## 配信ページ（board.html / board.css / board.js）

- URL: `board.html#<トークン>/<コート>`（例 `board.html#O7KVvuj-/A`）。`?bg=transparent` で `body` の背景を透過にする（OBS で映像の上に重ねる用）。
- `theme.css` と `board.css` だけを読む。`<body data-theme="dark">` 固定。`scoring.js` を読んで `Scoring.decodeResult` / `calcRowScore` を使う（`Scoring.setTechniques` に応答の `techniques` を入れる）。
- 2秒ごとに `Api.loadLive(token)` を呼ぶ。応答が遅れて追い越された場合は古い応答を捨てる（`seq`）。連続で失敗しても表示は保ち、右下に小さく「更新できません」を出す。
- 表示（上から）:
  1. 帯: コートのバッジ（金のグラデーション）、順番（例「男子 1巡目 3番」）、選手名（明朝 64px 以上）。右にタイマー（残り `mm:ss`、大きく。`running` なら `now` からの経過を引いて進める。0 で止める）。
  2. 採点表: 行＝技①②③（`tech1..3` から空を除いた順。`adjust` の添字も同じ）。列＝技名｜初太刀｜二ノ太刀｜三ノ太刀｜四ノ太刀｜補正｜得点。太刀セルは 未／成功／失敗（採点画面と同じ色変数）。打てない太刀はグレー。
  3. 合計（大きく）。`confirmed` なら得点と合計を `--score-confirmed` の青にし、「確定」の札を出す。
- 選手が未設定（`courts[court]` が無い・`player` が無い）のときは「待機中」と大会名だけ。
- 1920×1080 と 960×540 の両方で崩れない（`clamp()` か `vw` 単位）。
- 操作 UI は置かない（クリックしても何も起きない）。

## OBS の使い方（マニュアルに追記する内容）

1. 運営画面の結果タブ「共有リンクをコピー」でリンクを取り、`share.html#トークン` の `share.html` を `board.html` に置き換え、末尾に `/A` を足す（B も同様）。
2. OBS で「ブラウザソース」を追加し、URL にそのアドレス、幅 960・高さ 540（または 1920×1080）を指定する。映像の上に重ねるなら URL 末尾に `?bg=transparent` を付ける（`board.html?bg=transparent#トークン/A` の順）。
3. A と B の2つを並べる。採点端末で選手を切り替えると 2〜3 秒で追随する。

---

## テスト（test.html）

- API: `PUT /live/:court` の検証（不正コート 400、存在しない playerId 400、timer 省略で据え置き、成功時の `live`）、`GET /api/links/:token/live`（無効トークン 404、`player` は今の選手だけ、他の選手の `result` を含まない、`techniques` を含む、`courts` にライブ状態の無いコートが無い）。
- Board の純粋関数: `Board.remaining(timer, updatedAt, now)`（running なら経過を引く・0 で止まる・running でなければ sec のまま）、`Board.rowsFor(player)`（`tech1..3` の空を除き `adjust` を行に添える）。
- 既存の 362 件は通ったままにする。

## 進め方

- 実装は1人（サーバー → api.js → app.js → board）。レビューは Opus。
- 認証タスク（別セッション）への申し送り: `GET /api/links/:token/live` と `board.*` は無認証で通す。`PUT /api/events/:id/live/:court` は採点 API と同じ扱い。
