# 観戦ダッシュボード（公開・閲覧専用・QR で配る）

日付: 2026-10-09
ユーザー要望: 「ダッシュボードを閲覧専用で任意端末にクローン表示したい。サーバに負荷をできるだけかけず、定期リフレッシュだけできるかたちで」「QR で」→ 共有トークンで開く公開ページ＋まとめ API 1 本＋運営画面の QR の方針で承認。

## 1. 決めたこと

- **公開ページ watch.html**（観戦ダッシュボード）。URL は `watch.html#<共有トークン>`（順位の共有リンク share.html・表彰 present.html・配信用ボード board.html と同じトークン）。認証なし、見るだけ（押せるものはライト／ダークの切り替えと文字の大きさだけ）。
- **まとめ API 1 本** `GET /api/links/:token/watch`（公開）。コートごとの採点中の選手と技の結果・タイマー・確定 n / N、順位（3 部門・ベスト4 の列）、ベスト4（暫定／確定）を 1 回で返す。**ETag** を付け、`If-None-Match` が一致すれば **304**（中身なし）。端末は **5 秒ごと**に 1 回読む。画面が裏に回ったら止め、戻ったら読む。
- **QR**: PC 運営の試合進行の見出しに「📱 観戦用 QR」。押すと共有リンクを発行（既にあればそれ）し、`watch.html#<トークン>` の QR と URL をダイアログに出す。観戦用は秘密ではない（順位の共有リンクと同じ公開範囲）ので、写真に撮って配ってよい旨を添える。
- いまの dashboard.html（運営用。中の面は認証付き）はそのまま。観戦用はそれとは別の軽いページ。

## 2. API `GET /api/links/:token/watch`

- 認可: `server/authz.js` に `/api/links/:token/ranking` と同じく `public: true` で登録。
- 入力の検証・リンクの解決は `/api/links/:token/live` と同じ（不正なトークン 400、無いリンク・大会 404）。
- 応答（JSON）:

```
{
  event: { name, date, status, updatedAt },          // status は EventStatus.of
  courts: [                                           // Courts.listFrom と同じ順（settings.courts ∪ 選手のコート。未分類は除く）
    { court: 'A',
      progress: { round, done, total },               // いま数える巡目の 確定 n / N（EventStatus.courtProgress）
      live: null | {                                  // event.live[court] が無ければ null
        updatedAt, timer: { sec, running },
        player: null | { name, order, isFemale, bib, rank, tech1, tech2, tech3, result, adjust, totalAdjust, score, confirmed }
      } }
  ],
  ranking: <computeRanking(event) と同じ: rankings / detail / best4Chance / progress / best4>,
  techniques: 大会の有効な技リストのうち name / strikes / reducedFirst だけ（端末は Scoring.setTechniques に渡して技ごとの配点・得点を出す。運営の備考 note・drawn・repeatable は公開しない）
}
```

- `live.player` は `/live` の形に `bib`（整数のときだけ）と `rank`（文字列）を足したもの。`/live` 自体は変えない。
- **ETag**: 応答本文の JSON 文字列の SHA-1（弱い ETag `W/"…"`）。`If-None-Match` と一致すれば 304。`Cache-Control: no-cache`（毎回サーバーに確かめるが、一致なら本文を送らない）。`Date` ヘッダー（Node が自動で付ける）を端末が時計のずれの補正に使う。
- 計算は要求ごと（大会ファイル 1 回読む＋順位計算。先日の計測で 1 要求 数 ms）。メモリのキャッシュは入れない（必要になったら updatedAt＋live をキーに足す）。

### `EventStatus.courtProgress(players, round)`（status.js。サーバーと test.html で共有）

コートごとに `{ court: { done, total } }`。`total` はその巡目の行数、`done` は `confirmed === true` の数。巡目は `EventStatus.scoringRound(status)`、無ければ `draft` は 1、`round1_done` は 2、`round2_done` / `final` / `archived` は二巡目の行があれば 2 無ければ 1（courts.js の `progressRound` と同じ規則。両方にコメントで相互参照）。

## 3. 画面 watch.html / watch.js / watch.css

- `server/static-policy.js` の `PUBLIC_FILES` に `watch.html`・`watch.js`・`watch.css` を足す。読むスクリプトは公開のもの（api.js・courts.js・scoring.js）だけ。`status.js` は読まない（状態の表示文字は API の `event.status` を watch.js の小さな表で日本語にする）。
- レイアウト（board.css・share.css と同じ黒地に金の配色、明朝）:
  1. 見出し: 大会名、状態（準備中／一巡目 進行中／二巡目準備／二巡目 進行中／二巡目終了／最終結果）、「更新 HH:MM:SS」、右に「ダーク」と文字の大きさ（A- / A+。localStorage に保存）。
  2. **コートの札**（`repeat(auto-fit, minmax(360px, 1fr))` で並ぶ。スマホは 1 列）: コート名、「確定 n / N」、採点中の選手（部・巡目・コート、No.ゼッケン 名前 段位）、技 3 行の表（初太刀〜四ノ太刀の 成功／失敗／減点／未・無効 と配点、技ごとの得点。board.js の `renderRows` と同じ規則で `Scoring.decodeResult` / `calcRowScore` を使う）、合計と「確定」「未確定」の印、タイマー（`Courts.liveRemaining(timer, updatedAt, serverNow)` を毎秒ローカルで刻む）。live が無い・player が null なら「待機中」。
  3. **ベスト4 の 1 行**: `ranking.best4` があれば「暫定ベスト4（合計）: 名前（点）…　残り n 名」、final なら「ベスト4（合計）: …」（`Courts.best4LineText`）。
  4. **順位表**: 3 部門（一般男子・新人枠・一般女子）。順位・名前・合計、合計の色（青／金茶／グレー）、`best4Chance` があればベスト4 の列（確／可／-）と凡例、見出しに「一巡目 11/26」（`ranking.progress`）。内訳（24+48 / 82→164?）は常に出す（押すものを増やさない）。描画は share.js の順位表の部品を共有できればそれを使い、無理なら watch.js に同じ規則で書く（どちらにしたかを報告）。
- **読み直し**: 5 秒ごと `GET /api/links/<token>/watch`、`If-None-Match` に前回の ETag。304 なら何もしない（「更新」の時刻だけ進める）。200 なら描き直す（採点中のコートの札は選手が同じならその場で値だけ差し替え、ちらつかせない）。`document.visibilityState` が hidden の間は止め、visible に戻ったら即 1 回読む。通信に失敗したら見出しに「読み込めませんでした。5 秒後にもう一度読みます」。
- 時計のずれ: 応答の `Date` ヘッダーから `skewMs` を取り（board.js と同じ）、タイマーの残りはそれで計算する。
- URL のトークンが無い・リンクが無い（404）ときは「このリンクは使えません」を大きく出す。

## 4. 運営画面の QR（desk-match.js）

- 試合進行の見出しの「📊 ダッシュボード」の右に「📱 観戦用 QR」。押すと `Api.createShareLink(ctx.eventId)`（冪等）→ `Desk.openDialog('観戦用ダッシュボード（QR）', …)` に、`watch.html#<token>` の URL の QR（`DeskInvites.qrSvg` を公開して使う）、URL の文字、「URL をコピー」（`Desk.copyText`）、注記「このページは見るだけです。順位の共有リンクと同じ公開範囲なので、写真に撮って配って構いません」。
- 共有リンクを取れなかったら alert（desk-results.js の `onCopyShare` と同じ文言）。

## 5. 負荷の見積もり

端末 1 台 = 5 秒に 1 回の小さな要求（200 のとき数 KB、変化が無ければ 304）。50 台で毎秒 10 回。先日の計測（毎秒 1,500 回で p95 48ms）の 1% 以下。

## 6. テスト

- status.js `courtProgress`: 一巡目／二巡目の数え方、未分類の扱い、空。
- API: 応答の形（courts の順・progress・live.player の bib/rank・ranking のキー）、ETag と 304 の往復（変化が無ければ 304、採点を確定したら 200 と新しい ETag）、不正・無いトークンの 400/404、公開経路（認可の表。invite.test の網羅テストに載る）。
- static-policy: watch.* が public。
- 画面の純粋な部分（状態の日本語化、札の並び）を watch.js から切り出せるなら test.html で固定。

## 7. ヘルプと資料

- help.html: 「観戦用ダッシュボード」の一節（QR の出し方、見える内容、5 秒更新、見るだけ）。
- 実況席向け資料（docs/memo/2026-10-07-commentary-guide.html）の末尾に「来場者・関係者に配るとき」として QR の案内を 1 段落。

## 8. 変えないもの

dashboard.html（運営用）、share.html、present.html、board.html、`/api/links/:token/live` の形。
