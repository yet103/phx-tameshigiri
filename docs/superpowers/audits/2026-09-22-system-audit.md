# 全体点検（2026-09-22）: 矛盾・不整合の一覧

対象: master 627dd68 時点。Opus の監査担当 3 名（サーバー／画面／ヘルプ・テスト・運用資料）が読んで実機確認した結果を、指揮官が重大度順にまとめた。コードの修正は未実施。

凡例: **A** 必ず直す ／ **B** 直したほうがよい ／ **C** 好み。〔S〕サーバー・データ、〔U〕画面、〔D〕ヘルプ・テスト・資料。

---

## A. 必ず直す（16 件）

### データ・サーバー

1. 〔S〕**`POST /api/events` が丸ごと無検証**（`server/index.js:498-589`）。名前 300 文字・`settings.courts` の不正値・他大会の `shareToken` まで保存される。`shareToken` を書き込めるため、その大会を削除すると無関係な大会の共有 URL が消える。既存 ID に送ると `settings` が消える。→ `PATCH` と同じ検証（name 1〜100、date/venue 切り詰め、`settings` は `validateCourtList` 経由で 3 項目だけ、`shareToken` は body から常に捨てて既存を引き継ぐ、`settings` も引き継ぐ、未知キーを落とす）。
2. 〔S〕**バンドル往復で `status` が失われ、`final`/`archived` のロックが外れる**（`index.js:1957-1982`, `2119-2128`）。取り込み後は `derive` で `round2` 等になる。→ バンドルに `status` を含め、取り込み時に `STATES` にあれば採用。
3. 〔S〕**二巡目生成が `未分類` コートの行を作る**（`index.js:2182-2212`）。コメントは「作らない」だが `parseOrder` が `未分類-男子-1-1` を通す。→ `isValidCourt` で弾き `unassignedCount` に加える。
4. 〔S〕**`PATCH …/players/:id` が `result` と `name` を無検証で受ける**（`index.js:1415`）。`result: "ZZZZ"`、空白だけの `name`（順位表から静かに消える）、`score: 1e9` が通る。→ バンドル取込と同じ `/^[012 ]*$/` と `POST` と同じ name 検証。CSV 拡張取込にも同じ正規化。

### 画面

5. 〔U〕**スマホ運営の選手登録が `final`/`archived` でも操作できる**（`admin-players.js` 全体、`EventStatus` 参照なし）。→ PC と同じ `locked` 判定で FAB・編集・削除・CSV を止め、警告を出す。
6. 〔U〕**`techniques.html` が確定済みの大会でも技と配点を編集できるように見える**（`techniques.html:128-137`、`status.js` 未読込）。→ `readOnly: EventStatus.isLocked(...)` を渡す。
7. 〔U〕**二巡目の技を入れられる状態が PC とスマホで違う**（`admin-round.js:259-312` は全状態で編集可、`desk-match.js:187` は `round1_done` のみ）。→ スマホも同じ制限と注記。
8. 〔U〕**基本情報がスマホ運営に無い**（`storage.js:55` が `#setup` を `#players` に落とす）。大会名の修正・必須設定・コート一覧がスマホからできない。→ ⋯ メニューに基本情報シート（名前・日付・会場・必須 2 つ・コート一覧）。
9. 〔U〕**採点画面が通信断と「大会が削除された」を区別せず控えを捨てる**（`app.js:502-508`）。→ `Api.loadEventResult` に寄せ、404 だけ `Route.clear()`。
10. 〔U〕**配信ボードが無効になった太刀を「未」と表示**（`board.js:48-55, 96-120`）。採点画面は「—」。打てない太刀の記号も逆。→ `failedAt` の位置を渡して「—」で描き、記号を揃える。
11. 〔U〕**「HTML 保存」が 15 列のまま**（`storage.js:230`）。CSV は 18 列（ゼッケン・級位段位・レンタル）。→ 3 列を足す。

### ヘルプ・資料

12. 〔D〕**ヘルプの採点画面「⑤操作区画」のボタン順が実装と逆**（`help.html:483, 491`）。→ 「前の選手 形成功 失敗 確定 次の選手 ▶（右端に合計）」。
13. 〔D〕**採点画面のスクリーンショット 3 枚が古い**（ゼッケン・文例・並べ替え・△が写っていない）。→ 撮り直し。
14. 〔D〕**スマホ運営のスクリーンショット 10 枚が旧タブ名**（選手／進行／結果）。`admin_events.png`（✕→⋯、取り込み、アーカイブ欄）、`admin_player_form.png`（3 項目なし）、`admin_players.png`（ゼッケン列なし）は figcaption とも矛盾。→ 撮り直しと figcaption/alt 更新（一覧は末尾）。
15. 〔D〕**PC 運営にヘルプへの導線が無い**（`desk.html` のヘッダーに ⋯ もリンクも無い）。ヘルプの「開き方」も PC を書いていない。→ ヘッダーにヘルプのリンク。
16. 〔D〕**ヘルプに PC の「技と配点」区画の説明が無い**（§1・§3・§5 が `techniques.html` とスマホの導線だけ）。**試合開始で止まる条件がヘルプは 3 件、実装は 4 件**（`repeat` が無い。`help.html:448, 309`）。**`npm test` が `test.html` の 1141 件を走らせない**（`package.json` は `auth.test.js` のみ、手順書も無い）。

---

## B. 直したほうがよい（30 件）

### データ・サーバー

17. 〔S〕`isFemale` と `order` の性別セグメントが独立して保持され、`Courts.sexOf` は order 優先、`computeRanking`・二巡目生成・採点は `isFemale` のみ。CSV/バンドル取込で食い違うと画面ごとに性別が変わる。→ 取込時に突き合わせ、正を 1 つに決める。
18. 〔S〕CSV 往復で `sourcePlayerId` が消え、bib の伝播と重複除外が壊れる（`index.js:1740`）。→ CSV に 19 列目 `sourcePlayerId`。
19. 〔S〕`PATCH /api/events/:id` の `settings` が `courts` だけ部分更新、`requireBib/requireRank` は省略で false（`index.js:622-634`）。→ 3 つとも「未指定なら既存」。
20. 〔S〕経路ごとに選手オブジェクトのキーが揃わない（bulk `names` は `rank`/`rental` を持たない、CSV 拡張は全員に `adjust` 等を付ける、古い 15 列 CSV の replace で `rank`/`rental` が消える）。→ `makePlayer` のようなファクトリに寄せ、`hasExtra` 偽なら触らない。
21. 〔S〕CSV 取込と貼り付けの読み替え語彙が違う（`〇`・`レンタル`・`あり`・`true`・`はい`）。→ 語彙表を 1 箇所に。
22. 〔S〕`board.js` が `Scoring.canDecode` を通さず内訳を描く。→ 偽なら内訳を出さない。
23. 〔S〕CSV 拡張取込の二巡目行の `bib` が `bibDropped` に数えられない（`index.js:1702-1712`）。
24. 〔S〕設計書と実装の食い違い: CSV 判定「10 列以上」と `>= 15`、`buildPlayersHtml` 15 列、技リストのキー、`result` の正規表現、bulk rows の rental エラーに技名が無い、`PUT`/`POST /api/techniques`、アクセス制御の許可リスト表が古い。→ 実装正の箇所は設計書を、設計書正（技名付きエラー、HTML 列）は実装を直す。
25. 〔S〕同期ハンドラの不変条件一覧に `bulk` と `status` が無い（`index.js:422-443`）。

### 画面

26. 〔U〕スマホ試合進行のコート絞り込みに `settings.courts` が出ない（`admin-round.js:122`、設計書はスマホも対象）。
27. 〔U〕貼り付けだけ「保存は通す」規則から外れ、回数制限・レンタルで行を弾く（`courts.js:731-742`）。→ 方針を 1 つに。
28. 〔U〕`admin-round.js:356-372` の採点済み警告だけ自前実装（`Courts.scoreMayChange` を使わない）。
29. 〔U〕技と配点の呼び名が 3 つ（技と配点／技術リスト編集／技リスト）。→ 「技と配点」に統一。
30. 〔U〕スマホ運営は試合進行タブ以外に状態が出ない。→ 上部バー直下に状態バッジ。
31. 〔U〕結果画面のボタン文言・トーストが PC とスマホで違う（絵文字、「リンクをコピーしました」）。
32. 〔U〕`ranking.html` の大会選択が `undefined` を出し、アーカイブ・テストも混ざり、状態ラベルも無い。
33. 〔U〕`techniques.html` と `ranking.html` の「運営」リンクがモードを見ない（`admin.html` 固定）。ヘルプも同じ（〔D〕15）。
34. 〔U〕大会名の長さ検証がトップだけ（PC・スマホの新規作成は 101 文字以上を送り「通信を確認」の誤案内）。
35. 〔U〕「新しいコート名」の規則と文言が 2 系統（選手行の `askCourtName` と基本情報）。
36. 〔U〕候補に無い技の見せ方が 3 通り（`（選べない技）`／`（リストにありません）`／スマホは印なし）。→ 共通関数。
37. 〔U〕採点画面の下部一覧だけ `order` を生データで出す（`A-男子-1-1`）。
38. 〔U〕スマホからは大会のコピー・配信ボードの URL・全員コピー・試合開始時の採点画面オープンができない（機能差の表は元報告を参照）。

### ヘルプ・テスト・資料

39. 〔D〕ヘルプ内部の矛盾: 「自動で更新するのは配信用ボードだけ」vs 共有・発表は 60 秒（`help.html:476, 673, 690`）。「何度押しても同じ URL」vs「作り直したとき」（`:671, 725`）。
40. 〔D〕ヘルプの CSV 列数が 15 のまま（18 列）、簡易 7 列＋3 列の説明が無い。エラー文言「ゼッケン番号は数字で」が実装と違う。
41. 〔D〕状態バナーの一覧に `round1_done`・`round2_done` の文言が無い。
42. 〔D〕`auth.test.js` の protected リストに PC 運営の 11 ファイルが無く、ルート直下の全ファイルを走査するテストも無い。
43. 〔D〕`package-lock.json` が `.gitignore` 対象で `Dockerfile` の `COPY` が常に空振り。→ 追跡して `npm ci --omit=dev`。
44. 〔D〕README が無い（.env、ブランチ運用、ポート、テストの走らせ方が散在）。
45. 〔D〕`test.html` がリポジトリ外のフィクスチャ（`test-tmpl-notech.json`、雛形の有無）に依存して黙ってスキップする。
46. 〔D〕後の設計書が前の決定を覆したのに前側に注記が無い（重複可→回数制限、`board.html#<token>`→コートごと、トップ 4 ボタン→2 入口、操作区画の並び、PC のヘルプ導線）。未解決事項の印も無い。

---

## C. 好み（10 件）

47. 〔S〕`validateCourtList` の戻り値（サーバー null／クライアント ''）、`findTechnique` の null ガード、`rank` の trim 有無、`history` にロックガードが無い。
48. 〔U〕黒金トーンの当て方のばらつき（下線 1px/2px、バッジの色、見出しの下線）。古いコメント（`min-width:768px` の記述、死んだ `.topbar` 規則）。スマホ取り込みの `isStale` ガード無し。
49. 〔D〕用語の統一案: 技と配点／技・形の書き分け／一巡目・二巡目／コート端末／運営画面（PC 用・スマホ用）。CSV と貼り付けの「女子」判定語。`.claude/launch.json` の扱い。`.dockerignore` の取りこぼし、`docker-compose.yml` の `version`。ヘルプの細かい取りこぼし（編集シートの 3 項目、「すべて見る（残り n 件）」、「8 つのボタン」）。

---

## 撮り直しが要る画像

`scoring_tablet.png` `scoring_tablet_unconfirmed.png` `scoring_mobile.png`（ゼッケン・文例・並べ替え・△）／`admin_events.png` `admin_new_event.png` `admin_players.png` `admin_players_menu.png` `admin_bulk.png` `admin_player_form.png` `admin_tech_sheet.png` `admin_round.png` `admin_round_court_b.png` `admin_results.png`（旧タブ名ほか）／`admin_menu.png`（🏠 トップ・💾 保存が無い）。据え置き: `share_mobile.png` `present_board.png` `present_reveal.png` `ranking_page.png`。

## 問題なしと確認された主な点

状態の遷移表と `POST /status` の 409 条件、ロックガード 11 経路、`roundOf`/`isScored`/`resolveTechnique` の重複実装の一致、`result` の 4 文字と `calcRowScore` の一貫、`computeRanking` が保存済み `score` を使うこと、`data.js` とサーバー既定の 32 技の一致、静的配信の allowlist（48 ファイル全部が分類済み）、`Storage.mapHash` の対応表、部門名の 5 箇所一致、`locked` 文言の 9 箇所一致、CSV 取込と削除の確認の流れの PC・スマホ一致、ブレークポイントの整合、`npm test` 23 件と `test.html` 1203 件の通過。
