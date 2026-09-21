# phx-tameshigiri

試し斬り採点システム。運営画面（PC 用 `desk.html` / スマホ用 `admin.html`）で大会・選手・技を管理し、
コートの端末（`scoring.html`）で採点、`ranking.html` / `share.html` / `present.html` / `board.html` で
結果を見せる。使い方はアプリ内のマニュアル（`help.html`）を参照。ここは開発・運用のための手引き。

## セットアップ

```
npm install
```

依存は `express` のみ。Node 18 以上（開発・CI では Node 24 で確認）。

### .env の作り方

運営用ページと書き込み API は Basic 認証で守られている。`.env.example` をコピーして `.env` を作り、
値を入れる（`.env` は `.gitignore` 済みでコミットされない）。

```
cp .env.example .env
```

`.env` の中身:

```
AUTH_USER=（運営者に配る ID）
AUTH_PASS=（十分長いランダム文字列。例: openssl rand -base64 24）
```

パスワードに `#` `$` 空白などの記号を含む場合は `AUTH_PASS='...'` のように単一引用符で囲む
（二重引用符だと `$` がシェルに展開される）。

`AUTH_USER` / `AUTH_PASS` が未設定のまま `node server/index.js` を起動すると、開発用として
認証なしで動く（コンソールに警告が出る）。ただし `NODE_ENV=production` のときは未設定だと
起動そのものを拒否する（本番で無防備なまま上がるのを防ぐため）。

## 開発サーバー（dev-3461）

開発中は本番用の 3457 番とは別のポートで動かす。

```
PORT=3461 node server/index.js
```

`http://localhost:3461` で開く。`.claude/launch.json` に `dev-3461`（`PORT=3461`）の設定がある
環境では、そちらから起動・プレビューできる。ポートを変えたいときは `PORT` 環境変数を変える
（既定は 3457）。

## テスト

このプロジェクトのテストは2種類ある。両方合わせて確認すること。

### `npm test` — 認証・静的配信のテスト（Node のみ、外部依存なし）

```
npm test
```

`server/auth.test.js` を実行する。`server/index.js` を子プロセスとして起動し、Basic 認証の
組み合わせや静的ファイルの許可リストを HTTP で検証する。ブラウザは不要。

### `npm run test:browser` — アプリ本体の単体テスト（`test.html`、1000件超）

`data.js` `scoring.js` `api.js` `storage.js` `courts.js` など画面側のロジックは `test.html` に
1000件を超えるテストとしてまとまっている。ブラウザで直接開いても確認できるが、CI やコマンド
ラインからは次で実行する。

```
npm run test:browser
```

中身は `scripts/run-test-html.mjs`（1ファイル）。ヘッドレス Chrome を Chrome DevTools Protocol
(CDP) で起動し、`test.html` を読み込んで、ページが末尾に出す `Result: N passed, M failed` を
読み取る。M（failed）が 0 以外なら終了コード 1 で終わる。

前提:

- **サーバーが先に起動していること。** `test.html` は `Api` 経由でサーバーにアクセスするため、
  `PORT=3461 node server/index.js` などで先に立ち上げておく（このスクリプト自身はサーバーを
  起動しない）。
- 開く URL は引数か環境変数 `TEST_HTML_URL` で指定する（既定は
  `http://localhost:3461/test.html`）。

```
node scripts/run-test-html.mjs http://localhost:3461/test.html
# または
TEST_HTML_URL=http://localhost:3461/test.html npm run test:browser
```

- Chrome の実行ファイルは環境変数 `CHROME_PATH` で指定できる。指定が無ければ Windows /
  macOS / Linux の既定のインストール場所を順に探す（Windows は Chrome → Edge の順）。見つから
  ない環境ではその旨を表示して終了コード 1 で終わる。
- CDP の待受ポートは既定で 9333。空いていない環境では環境変数 `CDP_PORT` で変える。

### `server/data` と `test-tmpl-notech.json` の注意

`server/data/` は `.gitignore` 対象で、大会データ（JSON）が入る実行時ディレクトリ。リポジトリには
含まれないため、まっさらな環境ではここは空。

`test.html` の一部のテスト（`techniquesSource: 'template'` のまま技を持たない、この機能より前に
作られた大会向けの `updateEventInfo` の確認）は、`server/data` に固定 ID
`test-tmpl-notech` のフィクスチャがあるときだけ動く。`POST /api/events/import` は必ず技を複製
するため、通常の操作ではこの状態の大会を作れない。フィクスチャが無い環境では、該当のテストは
**失敗ではなくスキップ**として `test.html` の結果に表示される（`npm run test:browser` の
`passed`/`failed` の件数には影響しない）。

本物の大会「第10回全日本試し斬り大会」「名古屋城決戦」も同じ `techniquesSource: 'template'` の
状態を持つが、テストからは絶対に書き込みで確かめない。フィクスチャを作る場合は、本物とは別の
ID・別のデータとして `server/data` に手で置くこと。

## ブランチと本番反映

開発は `master` で行い、レビュー・動作確認が済んだら `production` ブランチへ反映して本番サーバー
に配る。`production` への直接コミットはしない（`master` 経由のみ）。

本番サーバー側で `deploy.sh` を実行すると、`production` ブランチを pull して Docker イメージを
再ビルド・再起動する（`git checkout production && git pull origin production` →
`docker compose up -d --build`）。認証情報は本番サーバー上の `.env`（`docker-compose.yml` が
`AUTH_USER` / `AUTH_PASS` を読む）にあり、リポジトリには含まれない。

```
./deploy.sh
```

`docker-compose.yml` は `server/data` を名前付きボリューム（`tameshigiri-data`）に永続化する。
コンテナを作り直しても大会データは消えない。
