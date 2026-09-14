# アクセス制御（Basic 認証）と静的配信の許可リスト

**日付**: 2026-09-14
**対象**: phx-tameshigiri（試し斬り採点システム）。phx-tournament への適用手順は §H。
**前提となる設計書**: [2026-09-08-mobile-admin-flow-design.md](2026-09-08-mobile-admin-flow-design.md)（運営画面・共有トークン）、[2026-09-13-live-board-design.md](2026-09-13-live-board-design.md)（配信ボード）、[2026-09-07-court-operation-reliability-design.md](2026-09-07-court-operation-reliability-design.md)（送信キュー）

`server/index.js` には認証・認可がなく、`express.static` がリポジトリルートを配信している。本番は `https://tameshigiri.phx-base.org` で **公開インターネットから到達可能**（nginx 1.29.8 が TLS 終端、HTTP→HTTPS 301、HSTS 有効）。2026-09-10 に本番へステータスのみ確認したところ、`/deploy.sh` `/package.json` `/Dockerfile` `/docker-compose.yml` が 200 で取得でき、`/test.html`（大会の作成・削除を行う破壊的テストページ）も公開されていた。`/api/events` 系は無認証で列挙・読み書き・削除できる。

これを、**運営スタッフだけが書き込め、観客は共有リンク経由でしか読めない** 状態にする。運営端末（コートのタブレット、運営者のスマホ）には **一度だけ認証すれば済む** 形にする。

---

## 決定事項（ユーザー確認済み）

| 論点 | 決定 |
|---|---|
| 認証が必要か | **必要**。公開インターネットに出ている |
| 方式 | **Basic 認証**（アプリ側で完結。nginx は触らない） |
| 観客の閲覧 | **共有リンク（`share.html` / `present.html` / `board.html`）は無認証のまま**。`/api/events/*` は全て認証の内側 |
| 認証の契機 | **運営用 HTML ページ自体を保護**する。ページを開いた瞬間にブラウザがダイアログを出し、以降の `fetch` にはブラウザが自動で資格情報を付ける |
| 静的配信 | **コード上の許可リスト**（ファイル移動なし）。表にないパスは 404。既存の `/server` 実パス除外は残す |
| CORS | `cors()` を外し **同一オリジンのみ** |
| スコープ | **phx-tameshigiri のみ実装**。phx-tournament は同方式の適用手順を残す（§H） |

`public/` ディレクトリへの移設案は、対象が約 40 ファイルに及び並行作業と衝突するため見送った（2026-09-14 決定）。

---

## A. 認証ミドルウェア

### 資格情報

環境変数 `AUTH_USER` と `AUTH_PASS`。両方が非空のとき認証が有効。

- `NODE_ENV === 'production'` で未設定 → **起動を拒否**（`console.error` のうえ `process.exit(1)`）。無防備なまま本番が上がる事故を防ぐ。
- それ以外で未設定 → `console.warn` して **認証なし** で起動（ローカル開発・`test.html` の従来運用を壊さない）。

パスワード比較は `crypto.timingSafeEqual`。長さが違うと `timingSafeEqual` が例外を投げるので、ユーザー名・パスワードそれぞれを SHA-256 ダイジェストにしてから比較する。

### 判定

`Authorization: Basic <base64(user:pass)>` を解析し、最初の `:` で分割する（パスワードに `:` を含められる）。

**認証不要（公開）** — 下記 §B の「公開」欄のファイルと、次の API:

| メソッド | パス |
|---|---|
| GET | `/api/links/:token` |
| GET | `/api/links/:token/ranking` |
| GET | `/api/links/:token/live` |

**上記以外の全てが認証必須。** `/api/events/*`（一覧・詳細・作成・削除・選手・インポート・エクスポート・二巡目生成・順位・ライブ・履歴）、`/api/techniques`（GET を含む。観客用ページは技術リストを `/api/links/:token/live` 経由で受け取るので閉じても影響しない）、`POST /api/links`、運営用 HTML とその JS/CSS。

### 401 の返し方（観客にダイアログを出さない）

| 対象 | レスポンス | 理由 |
|---|---|---|
| `/api/` 以外（HTML ページ・アセット） | `401` + `WWW-Authenticate: Basic realm="phx-tameshigiri", charset="UTF-8"`、本文 `認証が必要です` | ページ遷移でブラウザが確実にダイアログを出す |
| `/api/*` | `401` + JSON `{ "error": "認証が必要です" }`、**`WWW-Authenticate` を付けない** | `fetch` の 401 でブラウザがダイアログを出すかは実装依存。付けないことで、共有ページを見ている観客の画面に突然パスワード入力が出る事故をなくす |

運営端末は保護された HTML を開いた時点で認証済みになり、以降の同一オリジンへの `fetch` にはブラウザが自動で `Authorization` を付ける。したがって API 側の 401 は「資格情報が失効した」異常系にしか現れない。

### 配置

`app.use(express.json(...))` の**前**、全ルートより前に置く。本文を読む前に弾くことで、無認証の巨大 JSON をメモリに載せず、body-parser の 400/413（開発時はスタックトレース付き HTML）を無認証クライアントに見せない。同期実装で `await` を挟まない（§G）。

公開 API の判定は GET に加えて HEAD も通す（監視ツールが HEAD を使うことがある。Express は HEAD を GET ハンドラに流す）。

---

## B. 静的配信の許可リスト

`express.static` の前に、**デコード・正規化した実パス**（既存の `/server` 除外と同じ手順）を許可リストと照合するミドルウェアを置く。表にないパスは **404**。`/` は `index.html` として扱う。

| 区分 | ファイル |
|---|---|
| **公開** | `share.html` `present.html` `board.html` `help.html` / `theme.css` `share.css` `present.css` `board.css` `help.css` / `api.js` `share.js` `present.js` `board.js` `scoring.js` / `help/img/*` `fonts/*` |
| **認証必須** | `index.html`（`/` を含む）`admin.html` `ranking.html` `techniques.html` / `style.css` `admin.css` / `app.js` `admin.js` `admin-events.js` `admin-players.js` `admin-round.js` `admin-results.js` `courts.js` `data.js` `outbox.js` `route.js` `storage.js` `techpicker.js` |
| **開発時のみ・認証必須** | `test.html`（`NODE_ENV !== 'production'` のときだけ配信。本番から破壊的テストページが消える） |
| **配信しない（404）** | 上記以外の全て。`deploy.sh` `Dockerfile` `docker-compose.yml` `package.json` `.gitignore` `.dockerignore` `docs/*` `server/*` など |

- `help/img/*` と `fonts/*` はディレクトリ単位で許可する（`..` を含むパスは正規化後の実パス判定で弾かれる）。
- 既存の `/server` 実パス除外はそのまま残す（許可リストで構造的に到達不能だが、二重の守りとして維持。申し送りどおり）。
- **SPA フォールバックは廃止**する。現在は `/anything` が `index.html` を返すが、画面遷移はハッシュ（`#event/...`）と `?token=` で行っており、パスによるルーティングはない。未知のパスは 404。
- 新しい HTML/JS/CSS を追加したら表に足す。忘れると 404 で即座に気付く（安全側の失敗）。

---

## C. CORS

`app.use(cors())` を削除し、`package.json` の依存からも外す。全ページは同一オリジンから `fetch` しており、`Access-Control-Allow-Origin: *` を返す理由がない。現状これが nginx を通過して外に出ており、残すと認証を入れても外部サイトからの操作余地（資格情報付きリクエストの誘導）が残る。

---

## D. 送信キュー（outbox.js）の 401/403

`isPermanentFailure` は 408/429 以外の 4xx を「再送しても無駄」と判定し、**キューから捨てる**。ここに 401 が流れると未送信の採点が黙って失われる。

- `isPermanentFailure` から **401 と 403 を除外**し、再送対象に戻す。
- `status()` に `lastStatus`（直近の失敗ステータス）を加える。
- `app.js` の `onSaveStatus` は `retrying` かつ `lastStatus` が 401/403 のとき、表示を `⚠ 認証が切れました・ページを再読み込みしてください` にし、30 秒待たずに即バナーへ昇格させる。再読み込みすればページ保護によりダイアログが出て復旧し、キューはそのまま再送される。
- `isPermanentFailure` を `Outbox` の公開関数に加え、`test.html` で固定する（`coalesce` と同じくテスト用の露出）。

`admin.html` は送信キューを持たず `api.js` を直接呼ぶ。401 は `null` として既存の「保存に失敗しました」系の表示に落ちる。ページ保護があるため実運用で起きにくく、今回はこれ以上手を入れない。

---

## E. 設定と配備

**docker-compose.yml**

```yaml
environment:
  - PORT=3457
  - NODE_ENV=production
  - AUTH_USER=${AUTH_USER:?AUTH_USER を .env に設定してください}
  - AUTH_PASS=${AUTH_PASS:?AUTH_PASS を .env に設定してください}
```

`${VAR:?msg}` により、`.env` が無いまま `docker compose up` すると起動前に理由付きで止まる。

**ファイル**

- `.env.example` を追加（`AUTH_USER=` `AUTH_PASS=` の雛形とコメント）。
- `.gitignore` と `.dockerignore` に `.env` を追加。
- `deploy.sh` は変更しない。サーバー側で `.env` を一度作れば以降のデプロイに引き継がれる。

**配備手順（サーバーで一度だけ）**

1. リポジトリ直下に `.env` を作り `AUTH_USER` / `AUTH_PASS` を書く（パスワードは十分長いランダム文字列）。
2. `bash deploy.sh`。
3. 確認: `curl -sS -o /dev/null -w '%{http_code}' https://tameshigiri.phx-base.org/` → `401`、同 `/share.html` → `200`、同 `/deploy.sh` → `404`、同 `/api/events` → `401`、`curl -u user:pass .../api/events` → `200`。

---

## F. テスト

### `server/auth.test.js`（Node 標準モジュールのみ、`npm test`）

`server/index.js` を **子プロセスとして起動**して検証する（`index.js` の構造を変えず、`NODE_ENV` や資格情報の組み合わせを変えて何度でも起動できる）。空きポートは `net` で取り、`PORT` として渡す。起動完了はログの `running at` で待つ。

| 起動条件 | 検証 |
|---|---|
| 開発・認証あり | `/share.html` `/present.html` `/board.html` `/help.html` `/theme.css` `/api.js` `/fonts/ShipporiMinchoB1-Bold.woff2` `/help/img/<実在ファイル>` が無認証で 200 |
| 同 | `GET /api/links/xxxxxx/ranking` が無認証で 401 以外（404 でよい） |
| 同 | `/` `/index.html` `/admin.html` `/ranking.html` `/app.js` `/test.html` が無認証で 401 かつ `WWW-Authenticate` あり |
| 同 | `GET /api/events` `GET /api/techniques` `POST /api/links` が無認証で 401 かつ `WWW-Authenticate` **なし**、JSON 本文 |
| 同 | 誤った資格情報で 401、正しい資格情報で `/` と `GET /api/events` が 200 |
| 同 | 正しい資格情報でも `/deploy.sh` `/package.json` `/Dockerfile` `/docker-compose.yml` `/server/index.js` `/%73erver/data/` `/docs/` `/nonexistent` が 404（`index.html` を返さない） |
| 同 | レスポンスに `Access-Control-Allow-Origin` が無い |
| 本番・認証あり | `/test.html` が（認証付きでも）404 |
| 本番・認証なし | プロセスが終了コード 1 で終わり、ポートを開かない |
| 開発・認証なし | `/` `GET /api/events` が無認証で 200（従来どおり） |

`package.json` に `"test": "node server/auth.test.js"` を追加。

### `test.html`

- `Outbox.isPermanentFailure`: 401 → `false`、403 → `false`、404 → `true`、408 → `false`、400 → `true`。
- 既存の 267 件は認証なしの開発サーバーで従来どおり通ること。認証ありの開発サーバーでは `test.html` を開いた時点でダイアログが出て、以降の `fetch` に資格情報が付くので同じく通ること。

---

## G. 既存の不変条件

`server/index.js` 冒頭の「書き込み系ハンドラは同期のまま維持」を守る。認証ミドルウェアと許可リストミドルウェアはどちらも同期実装で、`await` も非同期 I/O も使わない。`test.html` の「並行 PATCH 12 本が全件反映される」は引き続き番人。

---

## H. phx-tournament への適用手順（今回は実装しない）

同じ `server/index.js` 構成（Express、`cors()`、`PUBLIC_DIR = リポジトリルート`、認証なし）。`https://tournament.phx-base.org` も無認証で 200 を返す。**リポジトリ直下に `node_modules` があるため静的配信の露出はこちらより広い。**

1. §A のミドルウェアをそのまま移植。公開 API は `GET /api/links/:token`（共有リンク）のみ。
2. §B の許可リストを作る: `index.html`、`css/*`、`js/*`、共有リンクで開く画面とそのアセット。`node_modules/*` `server/*` `deploy.sh` `Dockerfile` `docker-compose.yml` `package.json` `docs/*` `work/*` `scratch/*` `goal.txt` は配信しない。
3. `cors()` を外す。
4. `docker-compose.yml` に `AUTH_USER` / `AUTH_PASS`（`${VAR:?}`）を足し、`.env.example` を置く。両プロジェクトで同じ資格情報を使うか別にするかは運用判断（別を推奨）。
5. §F の `auth.test.js` を許可リストに合わせて移植。

---

## 運用

- **運営端末（タブレット・スマホ）**: `https://tameshigiri.phx-base.org/`（採点）または `/admin.html`（運営）を開く。初回にブラウザが ID/パスワードを聞く。以降はブラウザが覚える。
- **観客**: 従来どおり共有リンク（`share.html?token=...` 等）。変更なし。
- **マニュアル（`help.html`）は公開**のまま。運営用ページへのリンクを含むが、それらを開いた時点でダイアログが出るだけで、観客用ページ（`share` `present` `board`）から運営用ページへのリンクはない。
- **資格情報の変更**: サーバーの `.env` を書き換えて `docker compose up -d`。運営端末は次にページを開いたとき再入力。大会中は変えない。

---

## 残るリスク（承知のうえで採用）

- **Basic 認証の資格情報キャッシュはブラウザ任せ。** iOS Safari は再起動で忘れることがある。その場合スタッフには **ページを開いた時点でダイアログが出る** ので無言の失敗にはならないが、「一度設定すれば永久」は保証できない。採点中に失効した場合は §D の表示で再読み込みを促し、キューは失われない。
- **運営用 JS（`app.js` 等）は認証必須だが、公開 JS（`api.js` `scoring.js`）は読める。** 秘密は含まない。
- **認証情報は 1 組**。スタッフ個人の識別や権限の区別はしない（大会運営の規模では不要、YAGNI）。
- **総当たり対策はしない**。パスワードを十分長くすることで対処する。必要になれば nginx 側のレート制限で足す。

## スコープ外

- 個人別アカウント、セッション、ログアウト
- nginx の設定変更
- phx-tournament の実装
- `admin.html` の 401 専用表示
