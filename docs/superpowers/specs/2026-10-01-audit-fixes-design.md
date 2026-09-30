# 網羅バグ検証の修正（2026-10-01）: サーバと共通部品の約束

**日付**: 2026-10-01
**対象**: phx-tameshigiri（master 278fb3c 起点）
**入力**: 2026-09-30 網羅バグ検証の指摘（M1〜M6・S1〜S19）。ユーザーはすべての修正案を採用済み。加えて「二巡目は得点が低い順に並べる」を徹底する。

## 変えないこと（ユーザー確認済み）

- 最終順位は一巡目＋二巡目の合算。同点は同順位（タイブレークなし）。
- 決戦の候補は一巡目の**確定済み**上位 8（8 位同点は全員、一般男子＝新人含む、0 点は除外）。先頭コート男子の二巡目の末尾に置く。
- 大会の削除の確認、自動更新しない方針。

## 分担

3 段で直す。本書はその 1 段目（サーバと共通部品）で決めた**約束**を書く。2 段目（採点画面: `app.js` `outbox.js` `board.js` `api.js` `storage.js`）と 3 段目（運営画面: `desk*.js` `admin*.js` `techedit.js` `help.html`）は、この約束に沿って直す。

1 段目で変えるファイル: `server/index.js` `status.js` `courts.js` `share.js` `test.html`（`scoring.js` は変更なし）。

---

## 1. 選手の版（rev）と採点の保存（M2）

### 1.1 rev の付け方

- 選手の行に整数 `rev` を持たせる。**無い行（旧データ・新規作成の行）は 0 とみなす**。ファイルに `rev` を書くのは初めて上がったとき。
- `rev` は「採点に関わる値」が**実際に変わったとき**だけ +1 する。採点に関わる値（以下 **版の項目**）:
  `score` `result` `adjust` `totalAdjust` `confirmed` `tech1` `tech2` `tech3` `isFemale`
  - 技と性別を含めるのは、別の端末が技や性別を変えた選手を古い採点表のまま保存させないため（古い技の並びで ○× を書くと内訳が壊れる）。
  - `name` `note` `bib` `rank` `rental` `isNewFace` `order` の変更では上げない（運営が名前や備考を直すたびに採点画面が衝突になるのを避ける）。
- 上げる経路: `PATCH …/players/:id`、M1 の性別の写し（写された二巡目の行も +1）、M3 の技名の付け替え、M6 の確定の移行、`POST /api/events`（既存 ID の上書きで版の項目が変わった行）。
- 二巡目の作り直し（`reorderRound2`）は行の `rev` を引き継ぐ。CSV の置換・バンドル取り込みで作る行は 0 から（id も新しくなる）。
- 応答で返す選手（`PATCH` の `player`、409 の `player`）には必ず `rev`（整数）が入る。`GET /api/events/:id` は保存どおり（無ければキーが無い＝0）。

### 1.2 採点の PATCH と baseRev

`PATCH /api/events/:id/players/:playerId` の本文に次のどれかがあれば **採点の PATCH** とする: `score` `result` `adjust` `totalAdjust` `confirmed`。

| 送り方 | サーバ |
|---|---|
| 採点の PATCH に `baseRev`（端末がその選手を読み込んだ時点の `rev`）あり | 下の 2 つの検査をする |
| 採点の PATCH に `baseRev` なし | **当面は受理する**（検査しない。従来どおり後勝ち） |
| 備考だけ・運営の項目だけの PATCH | 従来どおり（`baseRev` は要らない。送っても検査しない） |

`baseRev` を送らない採点の PATCH を拒まない理由: 更新前の画面（コート端末は一日開きっぱなしのことが多い）の送信キューは 4xx を「送っても通らない」として**捨てる**（`outbox.js` の `isPermanentFailure`）。拒むとその端末の採点が黙って失われる。受理すれば少なくとも採点は残る。新しい採点画面は**必ず** `baseRev` を送ること（送らないと保護が効かない）。全端末が新しい画面になったあとで拒む側に締める余地は残す。

検査（`baseRev` ありの採点の PATCH。上から順に見る）:

1. `baseRev` が 0 以上の整数でなければ **400**。
2. **stale**: `baseRev !== 今の rev` かつ、本文の採点の値が今の値と 1 つでも違うなら **409** `{ reason: 'stale', error, player }`（`player` はサーバの今の行。`rev` 入り）。
   - 値が全部同じなら衝突にしない（タイムアウトで通信を諦めたが実はサーバに届いていた、の再送を 200 で通すため）。
3. **not_scorable**: 大会が `status` を持ち、`body.force !== true` で、`EventStatus.isRowScorable(status, player)` が偽なら **409** `{ reason: 'not_scorable', error, status, player }`。
   - `isRowScorable(status, p)` = `isScoringOpen(status)` かつ `roundOf(p) === scoringRound(status)` かつ `isPlayerScorable(status, p)`（決戦の制限）。
   - `status` を持たない旧データの大会は検査しない（M6 の移行前の互換）。
   - `force: true` はこの検査だけを越える（運営が承知で終わった巡目を直すとき）。stale は `force` では越えない。

成功したら `{ success: true, player }`（`player.rev` は保存後の版）。

### 1.3 採点画面（2 段目）がやること

- 選手を読み込んだ時点の `rev`（無ければ 0）を控え、採点の保存のたびに `baseRev` として送る。送信キューのエントリにも `baseRev` を持たせる。
- 自分の連続保存で衝突にしない: 送信が成功して応答の `player.rev` を受け取ったら、**同じ選手のキューに残っているエントリの `baseRev` が、いま送ったエントリの `baseRev` と同じなら新しい `rev` に書き換える**。画面の控えも新しい `rev` にする。
- 409 `stale` / `not_scorable` を受けたら、キューのエントリを捨てずに「衝突」として保持し、確認を出す:
  - stale: 「別の端末で更新されています。サーバの内容を読み込みますか／この端末の内容で上書きしますか」。上書きは `baseRev` を 409 の `player.rev` にして再送する。読み込みは 409 の `player` で画面を描き直し、エントリを捨てる。
  - not_scorable: 「この巡目は今は採点できません（状態: …）」。サーバの内容を読み込む（エントリを捨てる）か、端末に残す。運営が承知で直す場合に限り `force: true` を付けて送ってよい。
  - 起動時・online 復帰時の再送も同じ仕組みで、衝突なら確認が出る。
- 409 を受けた選手は読み直す（`player` が付いているのでそれを使ってよい）。
- 保存時は DOM の全行ではなく、その端末で編集した選手だけ（既存）。
- 確定の取り消しは `{ confirmed: false, baseRev }` だけを送る（S5）。
- 補正点（行・全体）は ±999 に制限する（S4。サーバは範囲外を 400 で丸ごと拒む）。
- fetch は 15 秒で AbortController（S8）。

---

## 2. 一巡目の修正の写しと順位の合算キー（M1）

### 2.1 写し

一巡目の行（`sourcePlayerId` で指される行）の `name` / `isNewFace` / `isFemale` が PATCH で**変わった**ら、その行を `sourcePlayerId` に持つ二巡目の行にも同じ値を写す（`bib` / `rank` / `rental` は従来どおり写す）。

- `isFemale` を写すとき、決戦の印の無い二巡目の行は `order` の性別も組み直す（コート・巡目はそのまま、番号はその組の最大+1）。決戦の行は `order` を変えない。写した行の `rev` は +1。
- 採点済みの二巡目の行に性別が写る場合も S7 の `scored` の対象（下）。

### 2.2 二巡目の行での変更は拒む

`sourcePlayerId` が今ある行を指している行（＝一巡目に元がある二巡目の行）で、`name` / `isNewFace` / `isFemale` を**今と違う値に**変える PATCH は **409** `{ reason: 'linked', error: '二巡目の行の氏名・性別・新人は一巡目の行で直してください' }`。同じ値を送るのは通す（スマホの編集シートが全項目を送るため）。`force` では越えない。元の行が消えている二巡目の行は直せる。

画面（3 段目）: 二巡目の行（`sourcePlayerId` を持つ行）の氏名・性別・新人は PC・スマホとも読み取り専用にし、tooltip で「一巡目の行で直してください」。

### 2.3 順位の合算キー

`computeRanking` は**一巡目の行の id**（二巡目の行は `sourcePlayerId`）で合算する。

- 一巡目の行（巡目 1）: キーは自分の id。
- `sourcePlayerId` を持つ行: キーは `sourcePlayerId`（元の行が消えていてもその id でまとめる）。
- `sourcePlayerId` を持たない二巡目以降の行（旧データ・CSV 由来）: 従来どおり**氏名（と性別）で**、同じ氏名・同じ性別の一巡目の組に足す。見つからなければ氏名の組を作る。
- 組の氏名・性別・新人は、組の代表（一巡目の行。無ければ最初に入った行）から取る。氏名が空の組は出さない（従来どおり）。
- 応答の形は変えない（`{ rank, name, score }`。id は出さない）。同姓同名の別人は別々の行として並ぶ。

画面（3 段目）: `help.html` の「合算は氏名だけ」の注記（同姓同名が合算される）を「一巡目の行ごとに合算」に直す。

---

## 3. 技得点表の保存と使用中の技（M3）

### 3.1 PUT /api/events/:id/techniques

本文: `{ techniques: [...], renames?: [{ from, to }] }`

- `from` は**今の**技得点表の技名、`to` は**新しい**技得点表の技名（どちらも表の名前そのもの。性別の接尾辞付きも可）。
- 選手の技名（`tech1`〜`tech3`、接尾辞なしの表示名のことがある）を、選手の性別で今の表に解決（`resolveTechnique`）し、新しい表でも解決できなければ「消える技」とする。今の表でも解決できない技名（もともと表に無い）は数えない。
- 解決先が `renames` の `from` なら、選手の技名を付け替える: 選手の値が `from` そのものなら `to`、接尾辞なしの表示名なら `to` の接尾辞を外した名前（新しい表で同じ性別に解決できることを確かめる。できなければ「消える技」のまま）。
- 消える技が 1 つでも残れば **409** `{ reason: 'tech_in_use', error, names, count, usages }`
  - `names`: 消える技の、**今の表での名前**（重複なし、表の順）
  - `count`: 影響する選手の行の数
  - `usages`: `[{ name, count }]`（技ごとの行の数）
  - 何も書かない。
- `renames` の検証（400）: 配列で 200 件まで、`from`/`to` は空でない文字列、`from` は今の表にある、`to` は新しい表にある、`from` が新しい表にも残っているのは不可、同じ `from` の重複は不可。
- 成功: 技得点表を保存し、付け替えた行の `rev` を +1。応答 `{ success: true, techniques, renamed }`（`renamed` は付け替えた行の数）。
- `DELETE /api/events/:id/techniques`（雛形に戻す）も同じ検査をする（付け替えは無し。消える技があれば 409 `tech_in_use`）。

画面（3 段目、`techedit.js`）: 409 `tech_in_use` を受けたら件数を出して「選手の技名も新しい名前に付け替える（改名のとき）／保存しない」を選ばせる。改名は「旧名→新名」の対応を `renames` で送り直す。削除は保存しない（拒否のみ）。

### 3.2 採点画面・試合開始

- 採点画面（2 段目）: 技得点表に無い技の行を赤く警告し、その選手の保存・確定を止める（記録は消さない）。判定は `Courts.unknownTechs(player, techniques)`（下）。
- 試合開始の `Courts.startBlockers` に `kind: 'unknownTech'`（一巡目で、技得点表に無い技を選んでいる選手）を足す。文言は「技得点表に無い技を選んでいる」。`event.techniques` が配列でないときは判定しない。
- CSV 取り込みは全形式で技名を trim する（5 章）。

---

## 4. 状態遷移（M6・S11・S19）

`POST /api/events/:id/status` 本文: `{ to, force?, from? }`

- **S19**: `from`（画面が見ていた状態）が文字列で、今の状態と違えば **409** `{ reason: 'stale', error, status: 今の状態, to }`。何も変えない。`from` を送らない古い画面は従来どおり（互換）。画面（3 段目）は必ず `from` を送り、409 `stale` なら読み直して出し直す。
- **M6**: `status` を持たない大会が初めて遷移するとき、採点済み（`isScored`）で確定の印の無い行に `confirmed: true` を付ける（`rev` +1）。遷移を拒むとき（409）は付けない。
- 一巡目の終了（`round1 → round1_done`）の応答の `round2` に `finalistDiff`（6 章）を足す。
- 409 の reason 一覧: `transition` `empty` `exists` `generate_failed` `no_round2` `no_finale` `finale_pending` `stale`。

### 4.1 戻す（S11）

`EventStatus.prev('final', players)`: 二巡目の行に採点済み（`isScored`）か確定済みの行が 1 つでもあれば `round2_done`、無ければ `round1_done`（「二巡目を行わず最終結果へ」の後の「戻す」が二巡目終了に行かないように）。

### 4.2 確認文言（S2）・段階表示（S12）

- `Courts.statusConfirmMessage(from, 'final', players)`: 未確定の行があれば先頭に「⚠ 未確定が 一巡目 n名・二巡目 m名 います（未確定の得点は順位に入りません）。」を足す（0 の巡目は書かない。全員確定なら従来の文言のまま）。`round1_done → final` は一巡目だけを数える（二巡目は行わないため）。
- `Courts.stageCountText('round2', players)`: 決戦の行を除いて数える。`round2_final` は決戦の行だけ（従来どおり）。

---

## 5. CSV の取り込みと書き出し（M5）

### 5.1 書き出し（GET /api/events/:id/export）

20 列（**拡張形式**）:

`選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果,補正点1,補正点2,補正点3,全体補正,備考,確定,ゼッケン,級位段位,レンタル,決戦,一巡目の行`

- `決戦`: 決戦の印（`finalist`）のある二巡目の行は `○`。
- `一巡目の行`: `sourcePlayerId` が指す行の `order`（例 `A-男子-1-3`）。元が無ければ空。

### 5.2 取り込み（POST /api/events/:id/import）

本文: `{ csvText, mode: 'replace' | 'append', force?, expectedCount? }`

検査の順（最初に当たったもので返す）:

1. 確定済みの大会は 409 `locked`（従来どおり）。
2. **expectedCount**（`replace` のときだけ見る）: 数値で、サーバの選手数と違えば **409** `{ reason: 'stale', error, playerCount }`。送らない古い画面は従来どおり（互換）。
3. **文字化け**: `csvText` に U+FFFD（�）があれば **400** `{ reason: 'encoding', error }`。
4. **見出し**: 1 行目を厳密に照合する。既知の形式でなければ **400** `{ reason: 'format', error }`。
   - 照合の前に、各セルの空白（半角・全角）を取り除き、先頭の BOM と、見出しの末尾の空セル（Excel が付ける）を落とす。技の列は `技1` / `技①`（`技 1` は空白を除いて `技1`）のどちらも可。
   - 簡易形式: `名前,コート,性別,技①,技②,技③,新人,ゼッケン,級位段位,レンタル` の**先頭から 2 列以上**（1 列目は `選手名` も可）。
   - 従来形式: `選手名,順番,技1,技2,技3,得点,新人,女子,結果` の 9 列 / その後に `ゼッケン,級位段位,レンタル`（12 列）/ 15 列（`補正点1,補正点2,補正点3,全体補正,備考,確定`）/ 18 列（15 列＋ゼッケン,級位段位,レンタル）/ **20 列（18 列＋決戦,一巡目の行）**。これ以外の列数は 400。
5. **二巡目がある大会の置換**: `replace` で、大会に二巡目の行があり、形式が 20 列でなければ **409** `{ reason: 'round2_format', error }`（決戦の印と一巡目とのつながりが落ちるため。`force` でも越えない）。
6. **採点済みの置換**: `replace` で採点済みの行があり `force !== true` なら **409** `{ error, scoredCount }`（従来どおり。reason は空）。

値は `sanitizePlayerForSave` と同じ規則を通す: 氏名 trim・100 字、順番 40 字、技 trim・50 字、得点は -9999〜9999 の整数（小数は切り捨て、範囲外・数値でないものは 0）、結果は 0/1/2/空白だけ、補正点は 3 つとも -999〜999 の整数のときだけ、全体補正は -999〜999 の整数のときだけ、級位段位は `normalizeRank`、備考 200 字。
20 列の `一巡目の行` は、取り込んだ一巡目の行の中で `order` が一致する行が**ちょうど 1 つ**あれば `sourcePlayerId` にする。`決戦` は二巡目の行だけ有効。

画面（3 段目、`desk-players.js` / `admin-players.js` / `storage.js`）:
- 読み込みは UTF-8 で読み、U+FFFD があれば `TextDecoder('shift_jis')` で読み直す。
- 置換は取り込む直前に大会を読み直し、その選手数を `expectedCount` で送る。409 `stale` なら読み直してやり直させる。
- 409 `round2_format` は「二巡目がある大会は、結果確認の CSV エクスポート（20 列）で書き出したファイルだけ置換できます」。
- 確認ダイアログは破壊的な方（置換＝既存データをクリア）を OK にしない文言・順序にする。

---

## 6. 選考の差（S18）

`EventStatus.finalistDiff(players)` を共通関数にする（サーバ・PC・スマホで同じ判定）。

- 一巡目の行（`order` が解析でき、コートが `未分類` でない行）から `EventStatus.pickFinalists` で今選ぶべき候補を出し、二巡目の決戦の行（`finalist: true`）の `sourcePlayerId` と比べる。
- 戻り値: `{ changed, missing: [{ id, name, score }], extra: [{ id, name, score }], round2Scored }`
  - `missing`: 選ぶべきなのに決戦の行が無い一巡目の行
  - `extra`: 決戦の行があるのに選ぶべきでない一巡目の行
  - `score` は一巡目の確定済みの得点（未確定は 0）
  - `round2Scored`: 二巡目に採点済みか確定済みの行があるか
  - 二巡目の行が 1 つも無いときは `changed: false`（まだ選んでいない）。
- `Courts.finalistDiffMessage(diff)`: 警告文。`round2Scored` が偽なら「戻して一巡目を終了し直すと選び直せます」を添える。差が無ければ `''`。
- サーバの応答に入れる所: 一巡目の終了（`POST …/status` の `round2.finalistDiff`）、`POST …/rounds/2/generate`（`finalistDiff`）。二巡目に採点済みがあって差分追加になったときもこれで差が分かる。

画面（3 段目）: 試合進行（PC・スマホ）で `round1_done` 以降、`EventStatus.finalistDiff(event.players).changed` なら警告を出す（一巡目の行が後から確定・得点変更された場合）。遷移の応答の `round2.finalistDiff.changed` でも警告する。

`EventStatus.pickFinalists(rows)`: 一般男子（`isFemale !== true`）・確定済み・得点 > 0 の上位 8、8 位同点は全員。戻り値は `{ id: true }`（プロトタイプ無し）。サーバの生成もこれを使う。

---

## 7. 二巡目の並び（S1）

- 並べる得点は**一巡目の確定済みの得点だけ**（未確定は 0 扱い＝先頭側）。
- 同点は一巡目の試技順（`order` の番号を**数値で**。コート・性別が違えばコート名 → 男子が先）。`'A-男子-1-10'` が `'A-男子-1-2'` より前に来ない。
- 通常の行はコート×性別ごとに一巡目の確定得点の低い順、決戦の候補は先頭コート男子の末尾に低い順（従来どおり）。

---

## 8. 入力検証（S4・S7・S15・S16）

- **S4**: `PATCH …/players/:id` の `score`（-9999〜9999 の整数）・`adjust`（長さ 3、各 -999〜999 の整数）・`totalAdjust`（-999〜999 の整数）は、送られていて不正なら **400** で要求全体を拒む（何も書かない）。以前は黙って無視していた。`confirmed`（真偽値でない）・`note`（文字列でない）は従来どおり無視。
- **S7**: 採点済み（`isScored`）の行の `tech1`〜`tech3` / `isFemale` を今と違う値に変える PATCH は、`force: true` が無ければ **409** `{ reason: 'scored', error, player }`。M1 で性別が写る二巡目の行が採点済みの場合も同じ。画面（3 段目）は `Courts.scoreMayChange` の確認を承諾したら `force: true` を付けて送る。
- **S15**:
  - `POST …/players`: 氏名 100 字まで（超えたら 400）。技は trim し、50 字を超えたら 400。
  - `PATCH …/players/:id`: 技は trim し、50 字を超えたら 400。
  - 一括登録（名前だけの形・行の形）: 氏名 100 字まで（超えたら 400、行番号つき）。
  - `POST …/history`: 大会が無ければ 404。本文は許可した項目だけ（`action` `detail` `playerName` `playerId` `techName` `techRow` `strike` `value` `court` `round`）を残す（文字列は 200 字・`detail` は 500 字で切る。数値は有限値だけ）。`action` が無ければ 400。壊れた履歴ファイルでも 500 にしない（空から積み直す）。
- **S16**: `PATCH /api/events/:id` の `settings` は**キーごとの部分更新**にする。`requireBib` / `requireRank` / `courts` は送られたキーだけ変える（送られたが真偽値でない `requireBib` 等は従来どおり false）。`courts` は送られたら置き換える（和集合にはしない。削除できなくなるため）。画面（3 段目、`desk-setup.js` / `admin.js`）は**変わったキーだけ**送る（古い画面の courts で他端末の追加を消さない）。

---

## 9. 共有の見え方（S11 の後半）

`share.js`: 決戦の表は `finale.status` が `round2` / `round2_final` / `round2_done` のときだけ出す（`round1_done` で候補名を公開しない、`final` 以降に「決戦（暫定）」を残さない）。

---

## 10. 共通関数の追加（まとめ）

| 関数 | 所在 | 用途 |
|---|---|---|
| `EventStatus.isRowScorable(status, p)` | status.js | not_scorable の判定。採点画面の「この選手を採点できるか」もこれに寄せてよい |
| `EventStatus.revOf(p)` | status.js | `rev`（無ければ 0） |
| `EventStatus.pickFinalists(rows)` | status.js | 暫定ベスト8 の選考 |
| `EventStatus.finalistDiff(players)` | status.js | 選考の差（S18） |
| `EventStatus.prev` | status.js | S11 の変更 |
| `Courts.unknownTechs(p, techniques)` | courts.js | 技得点表に無い技名（M3） |
| `Courts.finalistDiffMessage(diff)` | courts.js | S18 の警告文 |
| `Courts.startBlockers` | courts.js | `unknownTech` を追加 |
| `Courts.statusConfirmMessage` | courts.js | S2 |
| `Courts.stageCountText` | courts.js | S12 |

---

## 11. 画面側でやること（一覧）

### 採点画面（2 段目: app.js / outbox.js / board.js / api.js / storage.js）

- M2: 1.3 のとおり（`baseRev`、キューの `baseRev` の書き換え、409 `stale` / `not_scorable` の衝突保持と確認、起動時・online の再送も同じ、409 で選手を読み直す）。`Api.updatePlayer` は 409 の本文（`reason` / `player`）を返すようにする。
- M3: 技得点表に無い技の行を赤く警告し、その選手の保存・確定を止める（`Courts.unknownTechs`）。
- M4: 開いただけで `p.score`・一覧を書き換えない。保存済みの score と再計算値が違えば「技得点表の変更で点が変わります（保存 16 → 再計算 21）」と「計算し直して保存」（確定済みなら確定し直しの確認つき）。`board.js` は合計と行の和が食い違わない表示に。
- S4: 補正点（行・全体）を ±999 に制限。
- S5: 確定の取り消しは `{ confirmed: false, baseRev }` だけ。
- S8: fetch に 15 秒のタイムアウト（AbortController）。タイムアウトは失敗として `failingSince` を立てる。
- S9: 保存直前に localStorage を読み直してマージ（または storage イベントで同期）。
- S17: 編集中（`gridEdited`）は配点を入れ替えない（または全行の `updateRowScore` をやり直す）。
- `storage.js`: CSV を UTF-8 で読み、U+FFFD があれば Shift_JIS で読み直す（M5。運営画面の取り込みが使う）。
- `api.js`: `importCsv` に `expectedCount` を渡せるように、`changeStatus` に `from` を渡せるように、`updatePlayerInfo` に `force` を通せるように（本文に入れるだけ）、`saveEventTechniques` に `renames` と 409 `tech_in_use` の本文を返すように、409 の `reason` と付随の値（`player` `playerCount` `names` `count` `usages` `status`）を呼び出し側に返すように。

### 運営画面（3 段目: desk*.js / admin*.js / techedit.js / help.html）

- M1: 二巡目の行の氏名・性別・新人を読み取り専用（tooltip「一巡目の行で直してください」）。409 `linked` の文言を出す。`desk-players.js` の保存後の写し（bib/rank/rental）に name/isNewFace/isFemale を足す。help.html:644 の同姓同名の記述を直す。
- M3: `techedit.js` で 409 `tech_in_use` の選択（付け替える／保存しない）と `renames` の再送。
- M4: help.html の案内文を「開いて『計算し直して保存』」に。
- M5: 取り込み直前の読み直しと `expectedCount`、409 `stale` / `round2_format` / 400 `format` / `encoding` の文言、確認ダイアログの文言・順序。
- S3: 状態遷移の確認文の件数は、確認を出す直前に大会を読み直して数える。
- S6: スマホの編集シートは開いた時点から変わった項目だけ送る。
- S7: `Courts.scoreMayChange` の確認を承諾したら `force: true` を付けて送る。409 `scored` にも同じ確認を出す。
- S10: 二巡目の形登録画面の一巡目得点は確定済みだけ。
- S13: 遷移の応答の `unassignedCount > 0` を知らせる。
- S14: round1 以外の状態で一巡目の行を追加したら「一巡目に戻して終了し直す必要があります」と案内する。
- S16: 基本情報の保存は変わった `settings` のキーだけ送る。
- S18: 試合進行（PC・スマホ）で `EventStatus.finalistDiff` の警告（`Courts.finalistDiffMessage`）。遷移の応答の `round2.finalistDiff` でも。
- S19: 状態遷移に `from` を送る。409 `stale` なら読み直す。

---

## 12. テスト

- `test.html`: 上の約束をそれぞれ API テスト・共通関数のテストで固定する（rev と 409 `stale` / `not_scorable`、`linked`、写し、合算キー、`tech_in_use` と付け替え、CSV の見出し・`expectedCount`・20 列の往復・`round2_format`・値の洗浄、M6 の移行、`from`、S2/S11/S12/S18/S1/S4/S7/S15/S16）。
- 仕様の変更で期待値が変わった既存テスト（S4 の「範囲外の得点・補正点は無視」→ 400、S12 の round2 の件数、S2 の確定文言、書き出しの列数 18 → 20）は、新しい仕様に合わせて直す。
