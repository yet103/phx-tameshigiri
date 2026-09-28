# 決戦を先頭コートの末尾で行う（決戦コートの廃止）

**日付**: 2026-09-28
**対象**: phx-tameshigiri
**前提となる設計書**: [2026-09-22-round2-prep-and-finale-design.md](2026-09-22-round2-prep-and-finale-design.md)（二巡目準備と決戦。本書はその「決戦のコート」の決定を置き換える）

## 背景

2026-09-22 の設計では、暫定ベスト8 の二巡目の行を専用コート「決戦」（`settings.finalCourt`）に移していた。ユーザーの運用は次のとおりで、別コートは要らない。

> 二巡目の最後にベスト8 の候補が確定したら、A コートだけでそのまま 8 人が試技を行い最終順位が確定。あくまでも一巡目・二巡目があるだけ。

確認済みの解釈（2026-09-28）:
- 候補 8 名の二巡目の行は**先頭のコート（A）の二巡目の末尾**に置く。別コート「決戦」は作らない。
- 候補 8 名は A コートの通常の選手が全員終わってから斬る（他コートは通常の二巡目が終われば終わり）。
- 状態「決戦 進行中」（`round2_final`）の区切りと、集計（一巡目＋二巡目の合計）は変えない。3 本目は無い。

## 決定事項

| 論点 | 決定 |
|---|---|
| 候補の選び方 | 変えない（一般男子・一巡目の得点上位 8 名・8 位同点は全員・0 点除外） |
| 候補の行のコート | **先頭のコート**。`Courts.listFrom(一巡目の行, settings.courts)` の先頭（文字列昇順。通常「A」）。生成時に決める |
| 候補の行の番号 | 先頭コートの男子の二巡目の通常の行の**続き番号**（`A-男子-2-(k+1)〜(k+n)`）。並びは一巡目の得点が低い順（同点は一巡目の order 順）。通常の行を先に採番してから候補を採番する |
| 決戦の判定 | コート名ではなく**行の印 `finalist: true`** で判定する（既に印は付いている）。`round2` は印の無い行だけ、`round2_final` は印のある行だけ採点できる |
| `settings.finalCourt` | **廃止**。基本情報の入力欄・PATCH の検証（`finale_exists` / `court_conflict`）・複製・バンドルの書き出しを消す。PATCH や取り込みで届いても無視して保存しない |
| 既存データ | コート「決戦」に置かれた行がある大会はそのまま（印で判定するので採点できる。採点画面ではコート「決戦」を選ぶ）。移行処理は作らない |
| 表示上の「決戦コート」 | 候補の行のコート名（`Courts.finaleCourt(players)`: 印のある二巡目の行の先頭のコート名。無ければ `''`）。配信ボードはこのコートを映しているときに決戦の表を出す |

## 共有ロジック（`status.js` / `courts.js`）

- 消す: `DEFAULT_FINAL_COURT`、`EventStatus.finalCourtOf`、`EventStatus.scoringCourtFilter`、`EventStatus.isCourtScorable`、`Courts.finalCourtOf`。
- 足す:
  - `EventStatus.isPlayerScorable(status, player)`: `round2` なら `player.finalist !== true`、`round2_final` なら `player.finalist === true`、他は `true`。`player` が無ければ `true`（状態だけの判定は `isScoringOpen` が受け持つ）。
  - `EventStatus.finaleCourt(players)`: `finalists(players)` を `Courts.compareOrder` 相当の番号順に並べた先頭の行のコート名（`order` の解析）。無ければ `''`。`Courts.finaleCourt` はこれをそのまま返す。
  - `EventStatus.firstCourt(players, extraCourts)`: `Courts.listFrom` と同じ規則（コート名を集めて文字列昇順、`未分類` は除く）の先頭。サーバーの生成で使う。`Courts.listFrom` の並びと一致することを test.html で固定する。
- `finalists` / `hasFinalists` / `nextStep` / `nextLabel` / `scoringRound` / `stageCountText` / `transitionConfirmMessage` は変えない。

## サーバー（`server/index.js`）

- `generateRound2` / `reorderRound2`: `EventStatus.finalCourtOf(event)` の代わりに `EventStatus.firstCourt(src, event.settings && event.settings.courts)` を候補のコートにする。通常の行（`plain`）を先に `buildRound2Row` してから候補（`finals`）を採番するので、続き番号になる（`nextOrderNumber` は最大+1）。
- `sanitizeFinalCourt` / `nonFinalCourtNames` と、PATCH `/api/events/:id` の `finalCourt` の取り込み・`finale_exists`・`court_conflict` を消す。`settings` は `{ requireBib, requireRank, courts }` だけ保存する。`copy` / `from-template` / `bundle` の書き出し・取り込みからも `finalCourt` を落とす。
- `computeFinale`: `court` を `EventStatus.finaleCourt(players)` にする。他は変えない。
- 遷移の拒否（`no_finale` / `finale_pending` / `no_round2`）は変えない。

## 画面

**採点画面（`app.js`）**
- `scoringOpenHere()`: `EventStatus.isPlayerScorable(currentStatus(), visiblePlayers[currentIndex])`。
- 状態バナー: `round2` で候補の行を開いたら「この選手は決戦（暫定ベスト8）です。他の選手が終わり、運営画面で「決戦を開始」を押すと採点できます」。`round2_final` で候補以外を開いたら「決戦 進行中。採点できるのは決戦（暫定ベスト8）の選手だけです」。
- 選手一覧: `round2` はそのコートの二巡目の全員（候補は末尾に並ぶ。行に「決戦」の印を付け、`tr.finale` で薄く）。`round2_final` は候補だけ（`filterForStatus` で `finalist === true` に絞る）。
- 選手の帯の「決戦 n/N」表示は変えない。

**PC 試合進行（`desk-match.js`）**
- コート別カードの `plain` / `finale` の分け方をコート名から印に変える。`round2` は先頭コートのカードに候補を含めず、別枠「決戦（暫定ベスト8・A コートの最後）　開始前」に 8 名。`round2_final` は決戦のカードを前面に、他は畳む（従来どおり）。
- 二巡目の形登録の注記: 「暫定ベスト8（一般男子・一巡目の得点上位）。A コートの二巡目の最後に斬ります。」（コート名は `Courts.finaleCourt`）。

**スマホ試合進行（`admin-round.js`）**: 決戦の見出しの文言を「決戦（暫定ベスト8）　A コートの最後に斬ります」に（コート名は `Courts.finaleCourt`）。

**基本情報（`desk-setup.js`）**: 「決戦コートの名前」の入力欄と注記を消す。

**発表・共有・配信ボード（`present.js` / `share.js` / `board.js`）**: 変えない（`finale.court` がサーバーから来る。配信ボードは A コートを映しているときに決戦の表が出る）。

**ヘルプ（`help.html`）**: 「決戦コート」「決戦コートに移ります」「決戦コートの名前」の記述を「A コートの最後」に直す。流れ図の「暫定ベスト8 が決戦コートで斬る」も同様。

## テスト（`test.html`）

- 消す: `settings.finalCourt` の PATCH・複製・バンドル・衝突（`finale_exists` / `court_conflict`）のテスト、`finalCourtOf` のテスト、`scoringCourtFilter` / `isCourtScorable` のテスト。
- 直す: 二巡目生成で候補の行のコートが「決戦」になっていることを見ているテストは、先頭コートで通常の行の続き番号になっていることを見る。`computeFinale` / ranking の `finale.court` は先頭コート。
- 足す: `isPlayerScorable` の 3 状態、`finaleCourt`（印のある行のコート／無ければ空）、`firstCourt` と `Courts.listFrom` の一致、`reorderRound2` 後も候補が先頭コートの末尾に並ぶこと。
- `npm test`（サーバー）は据え置き。

## 変えないこと

- 候補の選び方、状態の遷移と文言、集計（氏名で合算）、`finale.rows` の形、`live` の扱い、二巡目の形の複製、行の `finalist` の印。
- コート「決戦」に既に置かれた既存大会の行（そのまま動く）。
