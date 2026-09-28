# 採点画面の操作改善と閲覧専用 URL の導線（設計書）

日付: 2026-09-28
対象: `scoring.html` / `app.js` / `style.css`（採点画面）、`desk-match.js` / `admin-round.js` / `admin.js` / `admin-results.js`（運営画面の採点画面リンク）、`help.html`（文言）

## 背景

ユーザーから採点画面の UI/UX について 7 件の要望が出た。いずれも現行の機能の並べ替えと補足で、データ形式・API は変えない。
質問への回答（2026-09-28）で確定した解釈:

- 「形成功したら自動で次の方にフォーカス」の「次の方」は**次の技（形）の行**。「失敗」でも同様に進める。
- 共有 URL（読み取り専用）は、**採点画面を開く箇所**（PC 運営の試合進行カード、スマホ運営の試合進行タブ）からも並べて取れるようにする。
- 確定前の移動メッセージは文言だけでなく、**OK＝確定してから移動、キャンセル＝留まる**に変える。

## 決定事項

| # | 要望 | 決定 |
|---|------|------|
| 1 | 形成功したら次の形へ | 「形成功」「失敗」を押して行の採点が終わったら、採点表の選択行を次の技の行へ進める。最後の行では動かない |
| 2 | 共有 URL が分かりにくい | 採点画面を開くボタンの隣に「閲覧専用 URL をコピー」を置く（PC 運営・スマホ運営の両方）。中身は結果確認の「共有リンク」と同じ `share.html#<token>` |
| 3 | 確定メッセージ | 未確定で離れるときの確認を「確定して次へでよいですか？」にし、OK で確定→移動。確定できない状態のときだけ従来の「確定せずに移動しますか？」を出す |
| 4 | 選手一覧をコンパクトに | 行の上下余白を無くし、各列は文字が収まる幅。得点の右に「備考」列を足し、残り幅は備考が吸収。選手名は太字 |
| 5 | 選手名横に級位・段位 | 選手の帯で名前の右に級位・段位（`rank`）を小さく添える |
| 6 | 選手一覧にも級位・段位 | 選手一覧の選手名の右隣に「級位・段位」列を足す |
| 7 | 前後の選手ボタンの位置 | 操作区画の 1 段目（開始・停止・リセット・分数）に「◀ 前の選手」「次の選手 ▶」を並べる。2 段目は 形成功・失敗・確定・合計 |

## 各項目の設計

### 1. 形成功・失敗のあと次の技の行を選ぶ（`app.js`）

- `setAllSuccess()` と `setAllFail()` の末尾（保存と履歴の後）で `advanceRow()` を呼ぶ。
- `advanceRow()`: `selectedRow + 1` の `tr[data-tech]` があれば `selectRow(selectedRow + 1)`。無ければ何もしない。
- `setAllFail()` で行に「未」が無く何もしなかったときは進めない（従来どおり早期 return）。
- 行の選択は視覚的な反転（`.selected`）だけで、入力欄へフォーカスは移さない（タブレットでソフトキーボードが出るのを避ける）。

### 2. 閲覧専用 URL を採点画面リンクの隣に（`desk-match.js` / `admin-round.js` / `admin.js` / `admin-results.js`）

- **PC 運営（試合進行のコートカード）**: `採点画面を開く` `URL をコピー` の並びを `採点画面を開く` `採点 URL をコピー` `閲覧専用 URL をコピー` にする。
  - 閲覧専用は `Api.createShareLink(eventId)`（冪等）でトークンを取り、`new URL('share.html#' + token, location.href).href` を `Desk.copyText(url, '閲覧専用 URL（共有リンク）をコピーしました')` で写す。取得失敗時は `alert('共有リンクを作成できませんでした。通信を確認してください。')`（結果の区画と同じ文言）。
  - 通信中はボタンを `disabled`、終わったら戻す（`ctx.isStale()` なら戻さない。`desk-results.js` の `onCopyShare` と同じ作法）。
  - コートごとにカードがあるので同じボタンがコート数だけ並ぶが、閲覧専用 URL は大会で 1 つ（どれを押しても同じ URL）。
- **スマホ運営（試合進行タブの見出し）**: `採点画面へ` の右に `閲覧専用 URL` ボタン（`round-open` と同じ見た目のボタン）を置く。処理は `admin-results.js` の `onCopy` と同じ。
  - クリップボード処理（`navigator.clipboard` → 失敗で `window.prompt`）を `admin.js` の `Admin.copyText(text, okMessage)` に切り出し、`admin-results.js` の `onCopy` と新しいボタンの両方から使う（`Desk.copyText` と同じ戻り値・同じ文言）。
- 結果確認の「共有リンクをコピー」はそのまま残す（ヘルプ §4 の説明はこちらが基準）。

### 3. 確定して移動（`app.js`）

- `onConfirm()` から「確定する側」の処理を `confirmCurrent()` に切り出す。戻り値は確定できたら `true`。
  - 技が無い（`!hasScoreRows()`）・内訳を復元できない（`!gridRestorable && !gridDirty`）は `alert` せずに `false` を返す（`onConfirm` から呼ぶときは従来どおり `alert` を出す。alert の有無は引数 `quiet` で分ける）。
- `confirmLeave(direction)`:
  - 従来と同じ条件で「聞かなくてよい」場合は `true`。
  - 確定できる状態なら `confirm('この選手の採点がまだ確定されていません。確定して次へでよいですか？')`。OK なら `confirmCurrent()` を実行して `true`、キャンセルなら `false`（留まる）。
  - 確定できない状態（技未入力・復元不可）なら従来の `confirm('この選手の採点がまだ確定されていません。確定せずに移動しますか？')`。
  - 文言は移動先を問わず同じ（前の選手・一覧のタップ・大会やコートの切替でも「確定して次へ」）。呼び出し側は変えない。
- `beforeunload` 等の追加はしない（現状もない）。

### 4〜6. 選手の帯と選手一覧（`scoring.html` / `app.js` / `style.css`）

**選手の帯**

- `#playerNameLabel` の右に `<span class="rank-label" id="playerRankLabel"></span>` を足す。
- `updatePlayerLabels(p)` で `String(p.rank || '').trim()` を入れる。空なら `:empty` で非表示。
- 見た目: 順番と同じ 16px、通常太さ、`--band-muted`（黒金の帯の上なので）。名前の baseline に揃える。

**選手一覧（`#playerListTable`）**

- 列: 順番 ｜ ゼッケン ｜ 選手名（太字） ｜ 級位・段位 ｜ 技1 ｜ 技2 ｜ 技3 ｜ 得点 ｜ 備考
- 幅: 備考以外は `width: 1%; white-space: nowrap`（内容の幅で決まる）。備考は `text-align: left; white-space: normal; overflow-wrap: anywhere` で残り幅を吸収する。長い備考で行が高くなるのは許容。
- 行の高さ: `td` の `height: 44px` を外し、`padding: 2px 6px; line-height: 1.3`。`th` も `padding: 3px 6px`。
- セルの識別: 得点は `td.score`、備考は `td.note`（`cells[cells.length - 1]` の決め打ちをやめる）。`updatePlayerListScore` / `updatePlayerListConfirmed` は `td.score` を使う。
- 備考の更新: `onNoteChange()`（文例の追記も同じ経路）の末尾で `updatePlayerListNote(currentIndex, p.note)` を呼び、開いている一覧の `td.note` を書き換える。
- 選手名は `<td class="name">` に `font-weight: bold`。`esc()` は従来どおり。
- 級位・段位が空の選手は空セル（「—」は出さない。ゼッケンの「—」は従来どおり）。

### 7. 前後の選手を 1 段目に（`scoring.html` / `style.css`）

- `.timer-bar` の並び: `◀ 前の選手` ｜ `▶ 開始` `■ 停止` `↺ リセット` ｜ `05:00` ｜ `次の選手 ▶`。
  - `#btnPrev` を先頭、`#btnNext` を末尾に置く。`.timer-display` の `margin-left: auto` は残し、`#btnNext` はその右。
- `.action-bar`（2 段目）: `形成功` `失敗` `確定` ｜ `合計`（右端）。
- `.nav-btn` の指定は `.action-bar .nav-btn` から `.action-block .nav-btn` に変える（大会トーンの上書き節も同じく）。
- `body.scoring-locked` / `body.score-frozen` の `[disabled]` の薄さは `.action-block button[disabled]` に広げる（前後の選手ボタンが 1 段目へ移っても同じ見た目）。
- ID とイベント登録（`btnPrev` / `btnNext`）は変えない。

### ヘルプ（`help.html`）

- 採点画面の見方 ②（選手の帯）: 名前の右に級位・段位が出る旨。
- ⑤（操作区画）: 1 段目が `◀ 前の選手` タイマー `次の選手 ▶`、2 段目が `形成功` `失敗` `確定`（右端に合計）。`形成功` `失敗` を押すと次の技の行が選ばれる旨。未確定で移動するときの確認文 `確定して次へでよいですか？`（OK で確定して移動）を `.msg` で追記。
- ⑦（選手一覧）: 列の並びを 順番・ゼッケン・選手名・級位・段位・技1〜3・得点・備考 に。
- 採点画面を開くの節: PC 運営のカードとスマホ運営の見出しに `閲覧専用 URL をコピー` があり、§4 の共有リンクと同じ URL である旨。
- 画像（`help/img/scoring_tablet*.png`）の撮り直しは本設計の範囲外（文言と alt だけ直す）。

## 変えないこと

- データ形式・API・サーバー。`rank` は既にある選手の項目をそのまま表示するだけ。
- 確定の条件（技未入力・復元不可）、確定済みの凍結、`gridEdited` のときだけ保存する規則。
- 選手一覧の開閉・記憶、確定済み行のグレー、選択行の反転。
- 結果確認の「共有リンクをコピー」「発表モードで開く」。

## テスト・検証

- `test.html` は `app.js`（DOM 直結）を対象にしていないので、本件の自動テストは追加しない。既存の `test.html` が全件通ることを確認する。
- ブラウザ検証（開発サーバー `dev-3461`）:
  - 形成功→次の行が反転、最後の行では動かない。失敗（未あり）→次の行。失敗（未なし）→動かない。
  - 未確定で次の選手→確認→OK で確定済みになって移動。キャンセルで留まる。技未入力の選手では従来文言。
  - 選手の帯に級位・段位。一覧の列・太字・備考が出る。備考を変えると一覧が更新される。
  - 1 段目に前後の選手ボタン。ロック中（準備中の大会）に薄くなる。
  - PC 運営・スマホ運営の両方で閲覧専用 URL がコピーされ、`share.html` が開ける。
- スマホ幅（375px）で崩れないこと（1 段目は折り返してよい）。

## 実装の分担（指揮官メモ）

- トラック A（採点画面）: `scoring.html` `app.js` `style.css` `help.html`。項目 1・3〜7。
- トラック B（閲覧専用 URL）: `desk-match.js` `admin-round.js` `admin.js` `admin-results.js` `admin.css`（必要なら）。項目 2。`help.html` は触らない（指揮官が後で足す）。
- 両トラックは同じ作業ツリーで並行するので、commit は `git commit -m … -- <ファイル>` のみ、`git add` と `git reset` は禁止。
