# トップに「📂 ファイルから取り込む」の入口を足し、取り込みの導線を整理する 設計書

作成日: 2026-10-05
きっかけ: 鎌倉大会（本番リハーサル）の大会ファイル（bundle JSON）を本番に入れようとしたユーザーが、トップ（index.html）から取り込みの入口を見つけられず、先に空の大会を作ってしまった。大会ファイルの取り込みは PC 運営・スマホ運営の「大会一覧」の見出しにだけあり、選手登録の「📄 CSV を取り込む」とは受け付けるファイルも結果も違う。

ユーザー決定（2026-10-05）: **案 B「トップの入口に 3 つ目を足す」**（案 A「新規作成の経路の 5 枚目のカード」は不採用。案 C「選手登録の CSV ボタンで JSON も受ける」は見送り）。

## 1. 変える範囲

| 画面 | 変更 |
|---|---|
| トップ `index.html` / `home.js` / `home.css` | 入口に 3 つ目「📂 ファイルから取り込む」。押すとファイル選択 → 取り込み → 運営画面の選手登録へ |
| 共通 `bundle-import.js`（新規） | admin-events.js と desk-events.js に二重にある取り込み処理（JSON 解析・形式検査・同名同日の確認・送信・結果の文言）を 1 か所にまとめ、3 画面から使う |
| PC 運営 `desk-events.js`、スマホ運営 `admin-events.js` | 共通部品を呼ぶ形に置き換え。ボタン名を「📂 大会ファイルを取り込む」に |
| PC 運営 `desk-players.js`、スマホ運営 `admin-players.js` | 「📄 CSV を取り込む」→「📄 選手を CSV から取り込む」。選手 0 名のときの案内に 1 行足す |
| ヘルプ `help.html` | 「別のサーバーや PC から取り込む」にトップからの手順を追記。ボタン名の変更を反映 |
| `server/static-policy.js` | `bundle-import.js` を PROTECTED_FILES に足す（index.html・admin.html・desk.html はどれも保護ページ。`courts.js` は既に公開ファイルなので index.html に足すだけ） |
| テスト `test.html` | 共通部品の単体テストと、トップの入口の描画テスト |

変えないもの: サーバー API（`POST /api/events/import` はそのまま）、取り込みの規則（常に新しい大会として追加・ID 振り直し・技リスト無しなら雛形）、選手登録の CSV 取り込みの中身。

## 2. トップの入口

### 2.1 見た目

入口（`#paneHome` の `nav.home-entries`）を 3 つにする。

| 位置 | 項目 | 主文 | 副文 |
|---|---|---|---|
| 1 | （既存）primary | ＋ 大会を新規作成 | テンプレート・コピー・完全新規 |
| 2 | （既存） | ▶ 作成済みの大会 | 選んで開始・続きから ＋ 運営画面: PC 用／スマホ用 |
| 3 | **新規** `home-entry secondary` | 📂 ファイルから取り込む | 「💾 ファイルに保存」で書き出した大会ファイル（.json）を新しい大会として追加 |

- 3 つ目は `<button type="button">`（他の 2 つは `<a>`）。押した瞬間にファイル選択ダイアログを開く。専用の区画（`#import`）は作らない（説明は副文で足りる。YAGNI）。
- 幅 620px 以上の 2 列並びでは、3 つ目は 2 列ぶち抜き（`grid-column: 1 / -1`）で下に置き、主文を 16px・上下の余白を小さくして「補助の入口」に見せる。620px 未満は 1 列なので 3 段目に並ぶ。
- 色は 2 つ目と同じ枠線だけ（primary の金は 1 つ目だけ）。

### 2.2 動き

1. 押す → ボタンを `disabled` にして `Storage.pickJsonFile(onText, onDone)` を呼ぶ（キャンセル・失敗・成功のどれでも `onDone` で `disabled` を戻す。desk-events.js と同じ）。
2. 読めたテキストを共通部品 `BundleImport.run(text, hooks)`（§3）に渡す。
3. 成功したら `location.href = Storage.adminHref('#players/' + encodeURIComponent(id))`（新規作成の完了と同じ行き先。PC／スマホのモードに従う）。トップには toast が無いので、完了の文言は運営画面側で出す（§3.3）。
4. 失敗・キャンセルはトップに留まる。失敗は `alert`（新規作成の失敗と同じ流儀）。

ファイル選択中にハッシュが変わっても（`#new` や `#list` へ移っても）、読み込みが終わった時点でそのまま取り込みは続ける。取り込みの対象はサーバーなので区画は関係なく、途中で捨てると「選んだのに何も起きない」になる。

## 3. 共通部品 `bundle-import.js`

グローバル `BundleImport`（IIFE。courts.js・storage.js・api.js と同じ流儀）。index.html・admin.html・desk.html・test.html が読む。

```
BundleImport.run(text, hooks) → Promise<{ id, playerCount, bibDropped } | null>
  hooks.isStale()   省略可。待ち合わせの後に呼び、true なら黙って null を返す（desk の ctx.isStale）
  hooks.confirm(msg) 省略可。既定は window.confirm
  hooks.alert(msg)   省略可。既定は window.alert
```

処理の順と文言は今の desk-events.js の `importBundleText` のまま:

1. `JSON.parse` に失敗 → alert「ファイルを読めませんでした。」→ null
2. `Storage.checkBundle` に失敗 → alert(chk.error) → null
3. `Api.listEvents()` で同名・同日の大会を探し、あれば confirm「同じ名前と日付の大会が既にあります。\n別の大会として追加しますか？」。いいえ → null
4. `Api.importBundle(bundle)`。null → alert「取り込みに失敗しました。通信を確認してください。」。`success` でない → alert「取り込みに失敗しました。\n」+ error
5. 成功 → `{ id, playerCount, bibDropped }` を返す

呼ぶ側（3 画面）が行う: ボタンの disabled 管理、完了の文言（`BundleImport.message(result)` = 「大会を取り込みました（n 名）」＋ `Courts.bibDroppedMessage` の文言）、画面遷移。

### 3.1 PC 運営・スマホ運営の置き換え

`importBundleText` を消し、`BundleImport.run(text, { isStale: ctx.isStale })`（スマホは isStale 無し）→ 成功なら `Desk.toast(BundleImport.message(result))`／`Admin.toast(...)` → `navigate('players', id)`。挙動は今と同じ。

### 3.2 トップから来たときの完了の文言

トップは遷移してしまうので、運営画面の選手登録が開いたときに「大会を取り込みました（n 名）」を出したい。ハッシュに `#players/<id>?imported=<n>` のような印を足すと `parseHash` を触ることになるので、**`sessionStorage` に 1 回きりの文言を置く**: トップは成功時に `Storage.setPendingToast(text)`（キー `phx.pendingToast`、値は文言）を書いてから遷移し、desk.js と admin.js は起動時に `Storage.takePendingToast()` で読んで消し、あれば toast に出す。取り込み以外でも使える小さな仕組みだが、今回はトップの取り込みだけが使う。

### 3.3 失敗の扱い

共通部品は alert で知らせて null を返すだけ。呼ぶ側は null なら何もしない（ボタンを戻すだけ）。例外（想定外の throw）は呼ぶ側の `catch` で `console.error` し、ボタンを戻す。

## 4. ボタン名と案内文

| 場所 | 今 | 変更後 |
|---|---|---|
| PC 運営 大会一覧の見出し | 📂 取り込む | 📂 大会ファイルを取り込む |
| スマホ運営 大会タブの見出し | 📂 取り込む | 📂 大会ファイルを取り込む |
| PC 運営 選手登録の見出し | 📄 CSV を取り込む | 📄 選手を CSV から取り込む |
| スマホ運営 選手登録の「⋯」メニュー | 📄 CSVインポート | 📄 選手を CSV から取り込む |

選手登録で選手が 0 名のとき（男子・女子とも 0 名）、表の上に案内を 1 行（`desk-note`／スマホは同等のクラス）: 「大会ごと持ち込むファイル（.json）は「大会一覧」の 📂 大会ファイルを取り込む、選手だけの CSV はここの 📄 から。」。選手が 1 名でもいれば出さない。

## 5. ヘルプ

- 「別のサーバーや PC から取り込む」の手順に「トップの 📂 ファイルから取り込む を押してファイルを選ぶ（運営画面の大会一覧からでも同じ）」を 1 番目に置く。
- 図の説明文とボタン名（「📂 取り込む」「📄 CSV を取り込む」）を新しい名前に直す。画像（`help/img/admin_events.png`）は撮り直さない（既存方針どおり。文で補う）。

## 6. テスト

test.html に足す:

- `BundleImport.run`: JSON 不正 → alert が 1 回・null。`checkBundle` 失敗 → alert・null。同名同日で confirm が false → importBundle を呼ばない。成功 → `{ id, playerCount, bibDropped }`。`isStale` が true → null（alert 無し）。`Api.listEvents`／`Api.importBundle` は差し替えて使う（既存のテストの流儀）。
- `BundleImport.message`: bibDropped 0 → 「大会を取り込みました（34 名）」、重複 1 → 文言に「重複していた 1 件」。
- `Storage.setPendingToast`／`takePendingToast`: 1 回読むと消える。sessionStorage が使えない環境では黙って何もしない。
- トップ: `#paneHome` に入口が 3 つ、3 つ目が button で文言が「📂 ファイルから取り込む」。
- 既存の desk-events.js／admin-events.js のテストは文言の変更に合わせて直す。

npm test（サーバー）は変更なし。

## 7. 作業の分け方

1 本の計画で足りる（ファイルは 10 前後、依存は「共通部品 → 3 画面」だけ）。順に: 共通部品とテスト → PC／スマホの置き換えとボタン名・案内文 → トップの入口と pendingToast → ヘルプ。ブランチ `feature/home-import-entry`。終わったら master へ ff マージ、production へ push（ユーザー指示 2026-09-29）。
