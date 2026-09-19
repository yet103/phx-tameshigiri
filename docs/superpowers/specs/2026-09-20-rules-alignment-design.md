# 公式ルール（点数表）への追随: 抜刀後の既定・同じ形の回数制限・胸尽くしの減点

**日付**: 2026-09-20
**対象**: phx-tameshigiri（試し斬り採点システム）
**前提となる設計書**: [2026-09-19-player-extra-fields-design.md](2026-09-19-player-extra-fields-design.md)、[2026-09-19-ux-feedback-round1-design.md](2026-09-19-ux-feedback-round1-design.md)（途中失敗の規則）

tameshigiri.jp の「IIO 試し斬りルール 2025」の点数表と突き合わせた結果、配点は既定の技リスト（`data.js`）と 32 技すべて一致。アプリに無かった規則 3 つを入れる。ユーザーは推奨案で承認済み。

## 決定事項

| 論点 | 決定 |
|---|---|
| 抜刀後の形の既定 | 点数表の「抜刀しての試し斬り」6 技（`立位袈裟` `立位逆袈裟` `立位横一` `座位袈裟` `座位逆袈裟` `座位横一`）に **既定で `drawn: true`**。形マスタで変えられる点は変わらない。既存の大会の技リスト（大会ごとの複製）は変えない |
| 同じ形の回数制限 | 技に **`repeatable`**（同じ巡で何度でも可。既定 false）。上の 6 技だけ既定 true。**`repeatable` でない技は 1 人の 3 枠に 1 回まで**（巡ごと。一巡目と二巡目で同じ形は可）。以前の「同じ技を複数の枠に入れてよい」は撤回 |
| 胸尽くしの減点 | 技に **`reducedFirst`**（減点時の初太刀の配点。整数 0〜99 か null）。既定は `胸尽くし(男)` `胸尽くし(女)` に **4**、他は null。初太刀のセルに **△（減点成功）** の状態を足し、点は `reducedFirst`。形マスタで編集できる |
| △ の扱い | 成功の一種（失敗ではないので後ろの太刀は無効にならない）。`reducedFirst` が null の技では △ は出ない（○→×→未 のまま）。初太刀だけ（二ノ太刀以降には出さない） |

## データ

```
techniques[] に repeatable: boolean      同じ巡で何度でも可（既定 false）
               reducedFirst: number|null 減点時の初太刀の配点（既定 null）
players[].result の文字: '1'=○ '0'=× '2'=△ ' '=未（技ごとに 5 文字は変えない）
```

- `validateTechniques`: `repeatable` は省略か真偽値、`reducedFirst` は省略・null か 0〜99 の整数。`cloneTechniques` は両方を写す（`repeatable` の既定 false、`reducedFirst` の既定 null）
- `data.js` の `TECHNIQUES` に `drawn` `repeatable` `reducedFirst` を足す（上の既定）。`test.html` の既定リストの比較テストは 3 項目も含めて比べる
- バンドル・コピー・雛形（`custom.json`）は `cloneTechniques` 経由なので自動で往復する
- 採点済みの判定（`Courts.isScored` / `EventStatus.isScored` / サーバー）: `/[012]/` にする（3 か所を同時に。`test.html` の一致テストに △ のケースを足す）

## 純粋関数

`scoring.js`（採点画面・配信ボードが読む）:

```javascript
Scoring.calcStrikeScore(techName, strikeIndex, value, isFemale)
//   value '△' かつ strikeIndex === 0 かつ tech.reducedFirst が数値 → reducedFirst。それ以外の '△' は 0
Scoring.decodeResult / encodeResult   // '2' ⇔ '△'
Scoring.canDecode                       // /^[012 ]*$/
Scoring.failedAt / effectiveValues      // '△' は失敗ではない（'×' だけを見る）
Scoring.canReduce(techName, strikeIndex, isFemale)  // 新規。△ を出せるセルか（初太刀かつ reducedFirst が数値）
```

`courts.js`（登録側）:

```javascript
Courts.techniqueOptions(techniques, isFemale, rental)   // 変更なし（repeatable は候補を絞らない）
Courts.duplicateForms(techs, techniques, isFemale)      // 新規。['tech1','tech2','tech3'] のうち repeatable でない技が 2 回以上ある名前の配列（接尾辞なしで解決、名前は表示名）。無ければ []
Courts.startBlockers(event, players)                    // kind 'repeat' を足す: duplicateForms が空でない選手（一巡目）
Courts.blockerMessage                                   // 'repeat' のラベル「同じ形を 2 回以上選んでいる」
Courts.parsePasteRows(text, techniques, defaults)       // 行の技に repeatable でない同じ技が 2 回あれば ok:false「同じ形は 1 回までです（破図味）」
```

サーバー（`server/index.js`）: `POST …/players/bulk` の `rows` の技に同じ規則（行番号つき 400「n 行目: 同じ形は 1 回までです（破図味）」）。単体 `POST` / `PATCH` は見ない（レンタル×抜刀と同じ方針。コメントに明記）。

## 画面

**形マスタ（`techedit.js` / `techniques.html` / PC の技と配点）**: 「抜刀後」の右に「回数制限なし」のチェック列と「減点初太刀」の数値欄（空＝なし。`title`「胸尽くしなど。切先が鞘から抜けていたときの初太刀の点」）。保存時に `repeatable` `reducedFirst` を送る。スマホ幅でも 3 列が見えるよう `techniques.html` の幅指定を調整（横スクロールは `.tech-scroll` 内でよい）。

**選手登録（PC `desk-players.js`、スマホ `admin-players.js`）**: 技の候補は絞らない（同じ技を 2 枠目に選べてしまうが、選んだ時点で赤枠と帯「同じ形 2 回 n」で示す。保存は通す。試合開始で止める）。PC の技セルの赤枠は既存の `desk-cell-bad` を流用。貼り付けのプレビューは `ok:false` で赤。

**試合進行（`desk-match.js`、スマホ `admin-round.js`）**: 二巡目の表と技ピッカーでも同じ（赤枠と件数、コピーは名前をそのまま）。

**採点画面（`app.js` / `style.css`）**: `canReduce` なセル（胸尽くしの初太刀）はタップで 未 → ○ → △ → × → 未 の順（それ以外は従来の 未 → ○ → × → 未）。△ は「減点」と表示し、`--warn` 系の色（黄土）で ○ と区別。行の得点・合計は `reducedFirst` で計算。「形成功」は従来どおり全部 ○（△ にはしない）。履歴の `detail` に「減点成功（4 点）」。配信ボード（`board.js`）も △ を「減点」で表示し得点を一致させる。下部の選手一覧は変更なし。

**ヘルプ**: 「技の配点を変える」に 3 属性、「採点画面の見方」に △、「技の選び方」に回数制限。

## テスト（`test.html`）

1. `Scoring`: `calcStrikeScore('胸尽くし(男)', 0, '△')` が 4、`(女)` が 4、`reducedFirst` の無い技の △ が 0、二ノ太刀の △ が 0。`encodeResult`/`decodeResult` の '2' の往復、`canDecode` が '2' を受ける、`failedAt(['△','○'])` が -1、`canReduce` の真偽
2. `Courts.duplicateForms`: `['破図味','破図味','四方']` → `['破図味']`、`['立位袈裟','立位袈裟','']` → []（repeatable）、`['破図味','破図味(男)','']` → `['破図味']`（接尾辞は同じ形）、空 → []
3. `startBlockers` の `repeat`、`blockerMessage` のラベル、`parsePasteRows` の重複行
4. サーバー: bulk rows の重複が行番号つき 400、`validateTechniques` が `reducedFirst: 100` / `'4'` を 400、`cloneTechniques` が既定を補う、既定の技リストで 6 技だけ `drawn` と `repeatable` が true、胸尽くし 2 技だけ `reducedFirst` が 4
5. `isScored` 3 か所が `'2'` だけの `result` を採点済みと判定する（一致テスト）
6. 既存テストがすべて通る（現在 1012）

## 手動確認

- 形マスタで「回数制限なし」「減点初太刀」が保存され、雛形と大会別の両方で往復する
- PC 選手登録で `破図味` を 2 枠に入れると赤枠と帯、試合開始が止まる。`立位袈裟` を 2 枠は通る
- 採点画面で胸尽くしの初太刀が 未→○→△→×→未 と回り、△ で 4 点、合計が合う。他の技の初太刀に △ が出ない。配信ボードの得点が一致。確定 → 選び直し → △ が残る
- 貼り付けで同じ形 2 回の行が赤く、一括登録でも拒まれる
- 375px の形マスタと採点画面 768px で崩れない

## 実装の分割（1 計画）

| トラック | 内容 | ファイル |
|---|---|---|
| A | `data.js` の既定、`scoring.js` の △、`status.js` / `courts.js` / サーバーの `isScored`、`validateTechniques` / `cloneTechniques`、bulk rows の重複検証 | `data.js` `scoring.js` `status.js` `courts.js`（`isScored` のみ）`server/index.js` `test.html` |
| B | `courts.js` の `duplicateForms` / `startBlockers` の `repeat` / `parsePasteRows` | `courts.js` `test.html` |
| C | 形マスタの 2 列、採点画面の △ と履歴、配信ボード、ヘルプ | `techedit.js` `techniques.html` `app.js` `style.css` `board.js` `help.html` |
| D | PC・スマホの選手登録と二巡目の赤枠・件数（`repeat`） | `desk-players.js` `desk-match.js` `admin-players.js` `admin-round.js` `desk.css` |

A と B は `courts.js` `test.html` が重なる → **同じ担当者が A → B の順**。C・D は A・B の後で並行。commit は `git commit -- <ファイル>`（pathspec）で行い、`git add` と `git reset` は使わない。
