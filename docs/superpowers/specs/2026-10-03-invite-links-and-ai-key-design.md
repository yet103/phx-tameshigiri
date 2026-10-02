# 招待リンク（役割つき）と AI 用キー・MCP サーバー

**日付**: 2026-10-03
**対象**: phx-tameshigiri（master 176c4dd 起点）
**状態**: 設計（未実装）。11 章の「決定待ち」をユーザーが決めてから計画に落とす。
**前提となる設計書**: [2026-09-14-access-control-design.md](2026-09-14-access-control-design.md)（Basic 認証・静的配信の許可リスト）、[2026-10-01-audit-fixes-design.md](2026-10-01-audit-fixes-design.md)（選手の版 rev・採点の PATCH・409 の理由）、[2026-09-13-live-board-design.md](2026-09-13-live-board-design.md)（配信用ボード）、[2026-09-07-court-operation-reliability-design.md](2026-09-07-court-operation-reliability-design.md)（送信キュー）

今は運営・採点の全員が **Basic 認証 1 組** を共有している。ユーザーの要望は「Basic 認証の代わりに URL で安全かつ便利に。AI からの自動操縦も」。本書はそれを 3 段に分けて設計する。

| 段階 | 中身 | 本書での粒度 |
|---|---|---|
| **1** | 役割を絞った **招待リンク**（まず **採点** 用）。QR で配り、端末は読むだけで採点端末になる。運営は当面 Basic のまま | 実装者が迷わない粒度 |
| **2** | **AI 用の API キー**（砂場＝「テスト用」で始まる大会だけ書ける）と、ユーザーの PC に置く **MCP サーバー** | 実装者が迷わない粒度 |
| **3** | 運営も招待リンク＋PIN に移し、Basic を外す | 概要だけ（9 章） |

---

## 決定済み（ユーザーと合意した方向）

| 論点 | 決定 |
|---|---|
| リンクの形 | `https://tameshigiri.phx-base.org/join#k=<鍵>`。`#` 以降はブラウザがサーバーに送らないのでアクセスログに残らない |
| 鍵の使い方 | join ページが鍵をサーバーに渡し、**HttpOnly・Secure・SameSite の Cookie（セッション）** に交換する。`history.replaceState` でアドレス欄から鍵を消す。以後はブックマークで入れる |
| 役割 | 運営（全操作。段階 3 で PIN 併用を検討）／採点（指定した大会の指定したコートの採点だけ）／閲覧（今の共有リンク）。**段階 1 で作るのは採点だけ** |
| 鍵の管理 | 期限つき（採点は大会当日の終わりなど）。PC 運営に「発行した鍵と使っている端末」の一覧と 1 本ずつの取り消し。サーバーは **鍵のハッシュだけ** 保存。QR で出し、タブレットは読み取るだけ |
| 採点の鍵でできること | その大会・そのコートの採点（採点の PATCH: `score` `result` `adjust` `totalAdjust` `confirmed` `note`、live の送信、読み出しに必要な GET）だけ。大会の削除・CSV・技得点表・状態遷移などは 403 |
| AI 用キー | `Authorization: Bearer <キー>`（URL に載せない）。書けるのは名前が「テスト用」で始まる大会だけ（作成・採点・状態遷移・削除）、本番の大会は読むだけ。複数発行・期限・取り消し・回数制限。操作は履歴に actor「AI」 |
| MCP サーバー | ユーザーの PC に置く小さな Node のサーバー。キーは環境変数か Windows の資格情報マネージャーで **MCP サーバーだけが持つ**。Claude はツールを呼ぶだけでキーを見ない・打たない |
| CLAUDE.md | 本書に追記の文案を載せ、**ユーザーが自分で追記する** |

---

## 1. 今の仕組み（読んで確かめた事実）

### 1.1 認証（`server/auth.js`）

- 資格情報は環境変数 `AUTH_USER` / `AUTH_PASS`（`server/index.js:535` で `createAuth` に渡す）。両方が非空のとき有効（`auth.js:38`）。
- 比較は SHA-256 ダイジェスト同士の `crypto.timingSafeEqual`（`auth.js:8-15`）。ユーザー名とパスワードを `&&` で短絡させず両方比べる（`auth.js:44-47`）。
- `parseBasic` は最初の `:` で分割（`auth.js:19-27`）。
- ページ向け 401 は `WWW-Authenticate: Basic` 付き（`auth.js:51-54`）、API 向け 401 は付けない JSON（`auth.js:57-59`）。観客の画面にダイアログを出さないため。
- 本番（`NODE_ENV=production`）で未設定なら起動を拒否、開発では警告して **認証なし**（`index.js:534-542`）。
- `app.set('case sensitive routing', true)`（`index.js:14`）と、ミドルウェアでのパスの小文字化（`index.js:555-561`）の二重の守り。
- **API の認証ミドルウェアは `express.json` の前**（`index.js:555-561` → `564`）。無認証の巨大 JSON を読まない。`express.json` の上限は 50mb（`index.js:564`）。
- CORS は返さない（`index.js:544-546` のコメント）。
- `trust proxy` は設定していない（`index.js` に該当なし）。したがって `req.ip` は直前の接続元（本番では nginx）になる。
- リクエストのログは出していない（`console.log` は起動時の `index.js:3742` だけ）。

### 1.2 無認証で通る API

`auth.js:30-33` の `isPublicApi`: `GET`/`HEAD` の `/api/links/:token`、`/api/links/:token/ranking`、`/api/links/:token/live` の 3 本だけ。

### 1.3 静的配信（`server/static-policy.js`）

- `PUBLIC_FILES`（`static-policy.js:10-14`）: `share.html` `present.html` `board.html` `help.html`、その CSS、`api.js` `share.js` `present.js` `board.js` `scoring.js` `courts.js`。`PUBLIC_DIRS`（`:16`）: `help/img` `fonts`。
- `PROTECTED_FILES`（`:19-27`）: `index.html` `scoring.html` `admin.html` `desk.html` `ranking.html` `techniques.html` と運営・採点の JS/CSS。
- `test.html` は開発時だけ（`:29`、`:56`）。
- `classify` はデコード・正規化してから表と照合（`:33-58`）。表に無いパスは 404。
- `index.js:3702-3714` で、実パスが `server/` 配下なら 404（`server/data` を外に出さない二重の守り）。`index.js:3718-3726` で許可リストを適用し、`protected` は `auth.isAuthorized` を通らなければ `rejectPage`（Basic のダイアログ）。

### 1.4 共有リンク（閲覧）

- `POST /api/links`（`index.js:3530-3577`）が大会ごとに 1 つ、冪等にトークンを作る。トークンは `crypto.randomBytes(6).toString('base64url')`（8 文字、`index.js:3562`）。`server/data/links/<token>.json` と大会の `shareToken` に書く。
- 観客向けの URL はすべてハッシュにトークンを入れる: `present.html#<token>`（`desk-results.js:181`）、`board.html#<token>/<コート>`（`desk-match.js:511`、`desk-results.js:242`）。
- `GET /api/links/:token` は `targetId` を返さない（`index.js:3590`）。
- 大会を消すとリンクファイルも消す（`index.js:941-949`）。

### 1.5 採点画面（`scoring.html` + `app.js`）の通信

`scoring.html:170-178` が読む JS: `data.js` `scoring.js` `courts.js` `status.js` `route.js` `outbox.js` `api.js` `storage.js` `app.js`（CSS は `theme.css` `style.css`）。使う API は次の 6 種類だけ（`app.js` と `outbox.js` を grep して確認）:

| API | 呼び出し元 |
|---|---|
| `GET /api/techniques` | `app.js:69` |
| `GET /api/events` | `app.js:599`（大会の選択肢） |
| `GET /api/events/:id` | `app.js:792` `:881` |
| `PATCH /api/events/:id/players/:playerId` | `outbox.js:426`（本文は `outbox.js:349-358` の `score` `result` `adjust` `totalAdjust` `note` `confirmed` `baseRev` だけ。**`force` は送らない**） |
| `PUT /api/events/:id/live/:court` | `app.js:1385` |
| `POST /api/events/:id/history` | `app.js:1129` ほか |

- 大会・コートの選択は URL ハッシュ `#event/<eventId>/<court>` が正で、`localStorage` の `tmg_last` に控え（`route.js:1-91`）。
- 画面上部に `トップ` `運営` `技得点表` `順位表示` `ヘルプ` のリンク（`scoring.html:47-52`）。
- 送信キューは 401/403 を捨てずに再送する（`outbox.js:221-225`）。`app.js:119` 付近で「認証が切れました・ページを再読み込みしてください」を出す。409 の `stale` / `not_scorable` は捨てずに衝突として持つ（`outbox.js:41`）。それ以外の 4xx は捨てて「保存できなかった採点が n 件」（`outbox.js:484-497`、`app.js:179`）。

### 1.6 履歴

- `appendHistory`（`index.js:303-317`）が `server/data/history/<id>.json` に積む。状態遷移はサーバーが積む（`index.js:1303-1307` の `status_change`）。
- `POST /api/events/:id/history` は `HISTORY_STRING_KEYS`（`index.js:3496`）と数値キーだけを残す。**`actor` に当たる項目は無い**（誰が操作したかは記録されていない）。

### 1.7 テスト大会の印と「テスト用」という名前

- 大会の `test: true` はテンプレート `systest` だけが付ける（`index.js:1160`）。`POST /api/events` は body の `test` を無視し、既存の値を引き継ぐだけ（`index.js:812-814`）。トップの一覧では既定で隠す（`home.js:566-569`）。
- 「テスト用」で始まる名前は慣習で、コードに意味は無い。予行スクリプト（`scratchpad/rehearsal/rehearse.mjs`）は `テスト用 本番予行 <日時>` で作る。開発機には `テスト用 技リストなし雛形（test.html 用・削除しないでください）` という **消してはいけない** テスト用の大会がある（`server/data/events/` を読んで確認。gitignore 対象）。
- 大会の `date` は `YYYY-MM-DD` か空文字（`home.js:425` の `<input type="date">`、既存データで確認）。

### 1.8 本番構成（読み取れる範囲）

| 項目 | 事実 | 出所 |
|---|---|---|
| コンテナ | `node:18-alpine`、`npm start`、`USER node` | `Dockerfile` |
| 公開ポート | `"3457:3457"`（ホストの **全インターフェース** に公開） | `docker-compose.yml` |
| データ | 名前付きボリューム `tameshigiri-data` を `/app/server/data` に | `docker-compose.yml` |
| 環境変数 | `PORT=3457` `NODE_ENV=production` `AUTH_USER` `AUTH_PASS`（`${VAR:?}`） | `docker-compose.yml` |
| 配備 | `git checkout production && git pull && sudo docker compose up -d --build`、`set -e` | `deploy.sh` |
| TLS | **nginx 1.29.8 が TLS 終端、HTTP→HTTPS 301、HSTS 有効**（2026-09-10 の観測） | 2026-09-14 設計書の冒頭 |
| nginx の設定 | **リポジトリに無い**（`proxy_set_header` の有無、ログの書式、nginx がホストかコンテナかは不明） | — |
| コンテナのタイムゾーン | `node:18-alpine` に `TZ` の指定なし（UTC で動く前提で設計する） | `Dockerfile` |

**Cookie の `Secure` が効く前提について**: ブラウザが `https://tameshigiri.phx-base.org` で開いている限り、`Secure` の Cookie はブラウザが保存・送信する（サーバー側が HTTP で受けていても、Cookie の `Secure` はブラウザとオリジンの間の話）。サーバーは `req.secure` を見ずに、本番では常に `Secure` を付ける（`trust proxy` 無しでは `req.secure` が偽になるため、見てはいけない）。
**要確認**: (a) ポート 3457 がインターネットから直接届くか（届くなら HTTP 平文で API が叩ける。Basic の資格情報も平文で流れうる）。(b) nginx が `X-Forwarded-For` / `X-Forwarded-Proto` / `Host` をどう渡しているか。(c) nginx のアクセスログに `Authorization` や `Cookie` を出す独自の書式が無いか。詳しくは 13 章。

---

## 2. 脅威と対策

| # | 脅威 | 起こり方 | 対策（本書の該当章） |
|---|---|---|---|
| T1 | **鍵の漏えい（経路）** | アクセスログ・プロキシのログ・ブラウザ履歴・画面共有・写真 | 鍵は `#` の後ろだけ（サーバー・nginx のログに乗らない）。join ページは読み込み直後に `replaceState` で消す（6.1）。サーバーは鍵を受けるのを **POST の本文だけ** にし、クエリの `?k=` は読まない（5.1）。保存はハッシュだけ（4.2）。期限（4.7）と端末数の上限（4.4）で漏れたときの被害を絞る |
| T2 | **転送**（LINE などで URL や QR の写真を送る） | 受け取った人が先に使う。メッセージのサービス側に URL が残る | 端末数の上限（既定 2）。超えたら 409 で断り、運営の一覧に **知らない端末** として出る（6.2）。1 本ずつ取り消せる。運営画面に「QR は画面で読ませる。写真で送らない」を明記（6.2・6.8）。リンクの下見（LINE などのプレビュー）で端末が登録されないよう、join ページは **「登録する」ボタンを押すまで交換しない**（6.1） |
| T3 | **端末の紛失** | タブレットを置き忘れる・盗まれる | 運営の一覧から **その端末だけ** 取り消す（5.1 `POST /api/sessions/:id/revoke`）。セッションは鍵の期限で必ず切れる（4.4）。端末に残るのは Cookie（HttpOnly で JS から読めない）と未送信の採点だけ |
| T4 | **総当たり** | 鍵・セッション・AI キーを当て推量 | 秘密部分は 256 ビットの乱数（4.1）で総当たりは成り立たない。加えて失敗の回数制限（3.6）。比較は `timingSafeEqual`（4.2） |
| T5 | **CSRF** | 別サイトのページから Cookie 付きで書き込みを送らせる。**`tournament.phx-base.org` は同じサイト（same-site）** なので SameSite だけでは防げない | Cookie は `SameSite=Lax`（3.3）。加えて Cookie で認証された非 GET には **`Sec-Fetch-Site: same-origin`**（無ければ `Origin` の一致）を求める（3.4）。CORS は今どおり返さない |
| T6 | **セッション固定** | 攻撃者が用意したセッション ID を被害者に使わせる | サーバーはクライアントが持ってきた ID を受け入れない。join のたびに **新しい ID を作る**（4.4）。Cookie 名に `__Host-` を付け、兄弟サブドメイン（`*.phx-base.org`）から Cookie を差し込めないようにする（3.3） |
| T7 | **時計ずれ** | タブレットの時計が狂っている。コンテナは UTC | 期限の判定は **サーバーの時計だけ**。端末は判定しない（表示もサーバーが返す `now` と `expiresAt` で出す）。「当日の終わり」は日本時間 +09:00 で固定計算（4.7。日本に夏時間は無い）。**要確認**: ホストの NTP（13 章） |
| T8 | **ログ** | 鍵やキーがログに残る | 鍵は `#` の後ろ、AI キーは `Authorization` ヘッダー。サーバーは鍵・キー・Cookie を一切ログに出さない（エラーの文言にも入れない）。監査ログ（4.6）には鍵の ID だけを書く。**要確認**: nginx のログ書式（13 章） |
| T9 | **Referer** | 次のページの読み込みで URL が漏れる | 断片（`#…`）は仕様上 Referer に入らない。念のため join ページは `Referrer-Policy: no-referrer`、外部の資源を一切読まない（6.1） |
| T10 | **OBS の配信用ボード URL** | `board.html#<共有トークン>/<コート>` を OBS のシーン設定に保存している | **変えない**。共有トークンは閲覧専用で、招待の鍵とは別物・別の場所。運営画面では「配信用 URL（見るだけ）」と「採点端末の招待（書き込める）」を見た目で分け、ボタンを並べない（6.2）。共有トークンで書き込めないことはテストで固定（8 章） |
| T11 | **XSS で Cookie を盗む** | 選手名などに仕込んだスクリプト | Cookie は HttpOnly。join ページは厳しい CSP（6.1）。他のページの CSP は段階 3 で検討（9 章） |
| T12 | **AI キーの漏えい** | 設定ファイル・チャット・リポジトリに平文で残る | キーは MCP サーバーだけが持ち、既定の置き場所は Windows の資格情報マネージャー（7.2）。Claude Code の設定ファイルに平文で書かない（7.7）。キーには接頭辞 `phxai.` を付け、見つけやすくする（4.1）。期限（既定 30 日）・取り消し・回数制限（3.6）。監査ログに使用の記録（4.6） |
| T13 | **AI の誤操作で本番大会を壊す** | 大会 ID の取り違え、削除・状態遷移の誤り | **サーバーとクライアント（MCP）の両方で** 「テスト用」以外への書き込みを拒む（5.4・7.5）。AI は既存の大会 ID を指定して `POST /api/events` で上書きできない。名前を「テスト用」以外に変えられない。削除は名前の完全一致の確認つき（7.4）。雛形の技得点表・鍵の発行など全体に効く操作は AI に許さない（5.2） |
| T14 | **AI が本番大会を「テスト用」に改名して壊す** | 改名で砂場の外から内へ持ち込む | AI の改名は「テスト用 → テスト用」だけ（5.4）。運営が本番大会を「テスト用」に改名したときは、運営画面が「AI が書き込めるようになります」と確認する（6.7） |
| T15 | **採点の鍵で運営の操作をする** | 採点端末から `DELETE` や CSV 取り込みを送る | ルートごとの判定表（5.2）で既定は拒否。採点の PATCH は許す項目を列挙し、それ以外の項目が 1 つでもあれば 403（5.3）。`force` も 403 |

---

## 3. 役割と認証の解決（Basic との併存）

### 3.1 主体（principal）

リクエストごとに 1 つ決め、`req.principal` に置く。

| `kind` | 由来 | 中身 |
|---|---|---|
| `admin` | Basic が正しい、または **開発で認証なし**（今の互換） | — |
| `scorer` | 有効なセッション Cookie（採点の鍵から作ったもの） | `inviteId` `sessionId` `eventId` `court`（`null` は全コート）`label` `expiresAt` |
| `ai` | 有効な AI キー（Bearer） | `keyId` `label` `expiresAt` |
| `anonymous` | 上のどれでもない | `reason`（`auth_required` / `session_expired` / `session_revoked` / `invite_revoked`） |

### 3.2 解決の順（優先順位）

1. `Authorization: Basic …` が **正しい** → `admin`。**誤っていたら無視して次へ**（パスワードを変えたあと、ブラウザが古い Basic を送り続ける採点タブレットを、Cookie で通すため）。
2. `Authorization: Bearer …` がある → AI キーとして検証。正しければ `ai`。**誤り・期限切れ・取り消し済みなら 401 で止める**（Cookie には落とさない。機械の呼び出しは理由がはっきり返った方がよい）。
3. セッション Cookie が **有効** → `scorer`。
4. セッション Cookie があるが無効（期限切れ・取り消し・知らない ID）→ `anonymous`（`reason` 付き）。**開発の認証なしでも admin にしない**（期限切れの振る舞いを開発で試せるように）。
5. 何も無く、認証が無効（開発・`AUTH_USER` 未設定）→ `admin`（今の互換）。
6. それ以外 → `anonymous`（`auth_required`）。

Basic と Cookie の両方があれば Basic が勝つ（運営は採点の上位）。これにより **今 Basic で使っている端末は何も変わらない**。

### 3.3 セッション Cookie

| 属性 | 値 | 理由 |
|---|---|---|
| 名前 | 本番 `__Host-tmg_s`、開発 `tmg_s` | `__Host-` はブラウザが `Secure`・`Path=/`・`Domain` なしを強制する。兄弟サブドメインから同名の Cookie を差し込めない（T6）。開発は `http://localhost` なので付けない |
| 値 | `<sessionId>.<secret>`（4.1） | ID でファイルを引き、秘密はハッシュで照合 |
| `HttpOnly` | 付ける | JS から読めない（T11） |
| `Secure` | 本番（`NODE_ENV=production`）は常に付ける。開発は `COOKIE_SECURE=1` のときだけ | `req.secure` は `trust proxy` なしでは偽なので見ない（1.8） |
| `SameSite` | `Lax` | `Strict` だと、QR リーダーや他のアプリから開いたとき（サイトをまたぐ遷移）に保護ページの読み込みで Cookie が送られず 401 になる端末がある。書き込みは fetch なので `Lax` でも別サイトからは送られない。同じサイトの兄弟サブドメインは 3.4 で止める |
| `Path` | `/` | — |
| `Max-Age` | `expiresAt − 今 + 30 日`（秒、切り上げ。30 日は 4.8 の掃除までの保持期間） | 期限の判定はサーバーがする。期限ちょうどにするとブラウザが期限の瞬間に Cookie を消し、サーバーが `session_expired` を返せずに「認証が必要です」（運営のパスワード欄）になる（結合試験 E1）ので、掃除でセッションを消すまでは残す。ブラウザを閉じても残る（タブレットの再起動で消えない） |

Cookie の読み書きは自前（依存を増やさない）。`req.headers.cookie` を `; ` で分け、最初の `=` で名前と値に分ける。同名が複数あれば **すべて試して最初に有効なもの**（`__Host-` で差し込みは防げるが、念のため）。

### 3.4 CSRF の守り

`/api/` への `GET` / `HEAD` 以外のリクエストで、主体が `scorer` または `admin`（Basic・開発）のとき、次を見る（同期のミドルウェア、本文を読む前）:

1. `Sec-Fetch-Site` ヘッダーがあれば、`same-origin` 以外（`same-site` `cross-site`。`none` も含む）は **403 `{ reason: 'origin' }`**。
2. 無ければ `Origin` ヘッダーを見る。あれば `PUBLIC_ORIGIN`（環境変数、例 `https://tameshigiri.phx-base.org`）と一致しなければ 403。`PUBLIC_ORIGIN` が未設定の開発では `http://` + `Host` と比べる。
3. どちらも無い（`curl`、予行スクリプト、古いブラウザ）は通す。

AI（Bearer）はブラウザが自動で付けないヘッダーなので CSRF の対象外（見ない）。

- 本番の `docker-compose.yml` に `PUBLIC_ORIGIN=https://tameshigiri.phx-base.org` を足す（秘密ではないので compose に直書き）。未設定の本番は起動時に警告を出し、1 だけで判定する。
- Basic に掛けても既存の運営画面は壊れない（全ページ同一オリジンの fetch で `same-origin`）。予行スクリプトも壊れない（ヘッダーを付けない）。

### 3.5 401 / 403 / 429 の形

API は今と同じく JSON、`WWW-Authenticate` は付けない。`reason` を必ず付ける（画面が文言を出し分ける）。

| 状態 | 本文 |
|---|---|
| 401 | `{ error, reason: 'auth_required' \| 'session_expired' \| 'session_revoked' \| 'invite_revoked' \| 'invite_expired' \| 'key_invalid' \| 'key_expired' \| 'key_revoked' }`（`invite_expired` は `POST /api/join` だけ。セッションの期限切れは鍵の期限切れでも `session_expired`） |
| 403 | `{ error, reason: 'role' \| 'scope' \| 'field' \| 'sandbox' \| 'origin', fields?: [...] }` |
| 429 | `{ error, reason: 'rate_limited', retryAfter: 秒 }` ＋ `Retry-After` ヘッダー |

ページ（保護 HTML）の扱いは 6.5。

### 3.6 速度制限（メモリ上、同期）

| 対象 | 単位 | 上限（推奨。11 章） |
|---|---|---|
| `POST /api/join` の失敗（鍵の照合が通らない） | `req.ip` | 10 回/分 → 以後 1 分 429 |
| `POST /api/join` の失敗（鍵の照合が通らない） | 全体（全 IP の合計） | 30 回/分 |
| Bearer の失敗 | `req.ip` | 10 回/分 |
| AI キーごと | キー ID | 60 回/分、書き込み（GET 以外）30 回/分、2,000 回/日（日は日本時間で区切る） |

- `POST /api/join` は **鍵の照合が通らない失敗（`key_invalid`）だけを数え、上限中もそれだけを 429 にする**。正しい鍵（下見・登録）は上限中でも止めない（鍵なしの連打で全員の登録が止まらないように。レビュー R2）。照合は通ったが使えない鍵（`invite_revoked` / `invite_expired`）も、上限中でも本来の理由を返す（数えない。監査ログへの記録は IP ごと 10 回/分まで）。上限中に正しい鍵だけ通すと「通るか」を試せることになるが、秘密は 256 ビットなので総当たりの助けにならない。本文の誤り（400 / 413）は数えない。
- AI キーの回数は、**429 で拒んだ要求は数えない**。それ以外（認可の 403 `sandbox` / `role` などで拒んだ要求も）は数える（数えるのは本文を読む前の段で、認可より先。レビュー R7）。

- 固定窓のカウンタを `Map` に持つ（再起動で消えてよい）。古い窓は 1 分ごとに掃除。
- `req.ip` は `trust proxy` が無い今は nginx のアドレスになり、**実質は全体の上限** になる。秘密は 256 ビットなので総当たり対策としては全体の上限でも足り、正しい鍵の利用者を巻き込みにくいよう上限は緩めにしている。nginx が `X-Forwarded-For` を渡していると確認できたら、環境変数 `TRUST_PROXY`（例 `loopback, uniquelocal`）で `app.set('trust proxy', …)` を有効にする（**要確認**、13 章）。ポート 3457 が外に開いている間は `TRUST_PROXY` を設定しない（`X-Forwarded-For` を偽装できるため）。

---

## 4. データの形

### 4.1 鍵・キー・セッションの書式

| 種類 | 書式 | 例の長さ |
|---|---|---|
| 招待の鍵 | `<inviteId>.<secret>` | `inviteId` = `randomBytes(9)` の base64url（12 文字）、`secret` = `randomBytes(32)` の base64url（43 文字） |
| セッション（Cookie の値） | `<sessionId>.<secret>` | 同上 |
| AI キー | `phxai.<keyId>.<secret>` | 同上。接頭辞は目で見て分かる・秘密の検出ツールで引っかけるため |

- ID は `isValidId`（`index.js:37`、`[A-Za-z0-9_-]{1,64}`）を通る。区切りは `.`（base64url に含まれない）。
- 解析は「`.` で分けてちょうど 2 つ（AI は 3 つ）、ID が `isValidId`、秘密が 43 文字の base64url」。外れたら照合せずに無効。

### 4.2 ハッシュ方式

- 保存するのは `secretHash = 'sha256:' + hex(SHA-256(secret))` だけ。照合は `timingSafeEqual(SHA-256(入力の secret), 保存値)`。
- **bcrypt / scrypt は使わない**。遅いハッシュは推測しやすいパスワードを守るためのもので、256 ビットの乱数には要らない。さらに `scrypt` の同期版は 1 回数十ミリ秒イベントループを止め、採点の PATCH（同期の不変条件、`index.js:570-591`）を詰まらせる。
- 鍵そのもの・セッションの秘密・AI キーは **どこにも保存しない**（応答で 1 回だけ返す）。

### 4.3 招待（`server/data/auth/invites.json`）

```json
{
  "version": 1,
  "invites": [
    {
      "id": "Q2x9aB3dE5fG",
      "role": "scorer",
      "eventId": "mu08vucj5f26xgt3v",
      "court": "A",
      "label": "A コート タブレット",
      "secretHash": "sha256:3b1f…（64 桁）",
      "createdAt": "2026-10-03T01:00:00.000Z",
      "expiresAt": "2026-10-12T14:59:59.999Z",
      "maxDevices": 2,
      "revokedAt": null,
      "revokedReason": null,
      "lastJoinAt": null
    }
  ]
}
```

- `role` は段階 1 では `'scorer'` だけ受ける（他は 400）。
- `court` は `isValidCourt`（`index.js:232`）を通るコート名か `null`（全コート）。発行時にその大会の `settings.courts` または選手の `order` に現れるコートであることを確かめる（無ければ 400 `unknown_court`）。
- `label` は 0〜40 文字（空なら `"<court> コート"` か `"全コート"`）。
- `revokedReason`: `'manual'`（運営が取り消し）／`'event_deleted'`（大会の削除）。

### 4.4 セッション（`server/data/auth/sessions.json`）

```json
{
  "version": 1,
  "sessions": [
    {
      "id": "h7Kp0sQ1wE3r",
      "inviteId": "Q2x9aB3dE5fG",
      "secretHash": "sha256:…",
      "createdAt": "2026-10-12T00:10:00.000Z",
      "expiresAt": "2026-10-12T14:59:59.999Z",
      "lastSeenAt": "2026-10-12T03:21:00.000Z",
      "revokedAt": null,
      "device": { "ua": "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) …", "summary": "iPad・Safari" }
    }
  ]
}
```

- **役割・大会・コートはセッションに写さず、毎回 `inviteId` から招待を引く**。招待を取り消せば、その招待から作った全端末が次のリクエストで 401 になる。
- 有効の条件: `revokedAt === null` かつ `now < expiresAt` かつ 招待が有効（`revokedAt === null` かつ `now < invite.expiresAt`）かつ 招待の大会が存在する。
- `expiresAt` は交換の時点の `invite.expiresAt`。
- `lastSeenAt` は書き込みが多くなるので **5 分に 1 回まで** 更新（メモリ上は毎回、ファイルは間引く）。
- 端末数: その招待の **有効なセッションの数** が `maxDevices` 以上なら新しい交換は 409 `device_limit`。取り消した端末・期限切れの端末は数えない。
- 同じ端末が同じ招待で入り直したとき（Cookie に同じ招待の有効なセッションがある）は、古いセッションを取り消してから新しいセッションを作る（数を増やさない。T6 の「必ず新しい ID」も守る）。
- **別の招待の QR で入り直したとき**（Cookie に別の招待の有効なセッションがある）も、`confirm: true` で登録できたら前の招待のセッションを取り消す（前の招待の枠を使い続けない。監査は `reason: 'switch'`。レビュー R3）。下見の応答に `switching: true` を付ける。端末数の上限で断ったときは前の登録はそのまま。
- `device.ua` は `User-Agent` の先頭 200 文字。`summary` はサーバーで簡単に作る（`iPad` / `iPhone` / `Android` / `Windows` / `Mac` と `Safari` / `Chrome` / `Edge` / `Firefox`、分からなければ「不明な端末」）。IP は保存しない（監査ログだけに書く。4.6）。

### 4.5 AI キー（`server/data/auth/ai-keys.json`）

```json
{
  "version": 1,
  "keys": [
    {
      "id": "Zr4Tq8Wn1Ys0",
      "label": "Claude Code（自宅 PC）",
      "secretHash": "sha256:…",
      "createdAt": "2026-10-03T01:00:00.000Z",
      "expiresAt": "2026-11-02T14:59:59.999Z",
      "revokedAt": null,
      "limits": { "perMinute": 60, "writesPerMinute": 30, "perDay": 2000 },
      "lastUsedAt": null,
      "useCount": 0
    }
  ]
}
```

- `lastUsedAt` `useCount` は 1 分に 1 回までファイルに書く。

### 4.6 監査ログ（`server/data/auth/audit.jsonl`）

1 行 1 件の JSON。追記は `fs.appendFileSync`（同期）。5MB を超えたら `audit.1.jsonl` に名前を変えて新しく始める（1 世代だけ残す）。

```json
{"at":"2026-10-12T00:10:00.000Z","actor":"admin","action":"invite.create","inviteId":"Q2x9aB3dE5fG","eventId":"mu08…","court":"A"}
{"at":"…","actor":"scorer","action":"session.create","inviteId":"Q2x9…","sessionId":"h7Kp…","ip":"172.18.0.1","ua":"iPad・Safari"}
{"at":"…","actor":"anonymous","action":"join.fail","reason":"invite_revoked","inviteId":"Q2x9…","ip":"…"}
{"at":"…","actor":"AI","action":"api","keyId":"Zr4T…","method":"PATCH","route":"/api/events/:id/players/:playerId","eventId":"…","status":200}
```

記録するもの: 招待の発行・取り消し、セッションの作成・取り消し、join の失敗、AI キーの発行・取り消し・失敗、AI の **全リクエスト**（GET を含む。応答の状態コード付き）。鍵・キー・Cookie の値は書かない。

### 4.7 期限の計算（サーバーだけ）

- 「日の終わり」は日本時間の 23:59:59.999。`new Date(YYYY-MM-DD + 'T23:59:59.999+09:00')`。コンテナの TZ（UTC）に依存しない。
- 採点の招待の既定: 大会の `date` が `YYYY-MM-DD` で、その日の終わりが未来なら **その日の終わり**。それ以外（空・過去）は **発行した日の終わり**（日本時間）。
- 運営が `expiresAt` を指定したら、`今 + 10 分` 以上・`今 + 7 日` 以下でなければ 400 `bad_expiry`。
- AI キーの既定: 発行から 30 日後の日の終わり。上限 90 日。

### 4.8 取り消しと掃除

- 取り消しは **消さずに `revokedAt` を書く**（一覧と監査に残す）。
- 起動時と、以後 1 時間に 1 回（`setInterval`、同期の処理）、次を削除:
  - セッション: `revokedAt` か `expiresAt` から 30 日を過ぎたもの
  - 招待: 同じく 30 日を過ぎたもの（その招待のセッションも）
  - AI キー: 90 日を過ぎたもの
- 大会の削除（`DELETE /api/events/:id`、`index.js:934`）で、その大会の招待を `revokedReason: 'event_deleted'` で取り消す。

### 4.9 置き場所と非公開の担保

- 新しいディレクトリは `server/data/auth/`（起動時に `mkdirSync`、`index.js:24-28` と同じ書き方）。本番では既存のボリューム `tameshigiri-data` に入るので、配備し直しても消えない。
- 3 つの JSON は **起動時にメモリに読み込み、以後メモリを正とし、変更のたびに `writeJsonAtomic`（`index.js:293`）で丸ごと書く**（件数は数十件の想定）。壊れたファイルは起動を止めない: `.broken-<時刻>` に名前を変えて空から始め、`console.error` に出す。
- 外に出ないことは 3 重に守られている: (1) 静的配信の許可リストに無い（`static-policy.js`）、(2) `server/` 配下の実パスは 404（`index.js:3702-3714`）、(3) `.gitignore` の `server/data/`。テストで `/server/data/auth/invites.json` と `/%73erver/data/auth/sessions.json` が Basic 付きでも 404 であることを固定する（8 章）。
- テストのためにデータの置き場所を環境変数 `TMG_DATA_DIR` で変えられるようにする（未設定なら今どおり `server/data`。`index.js:17`）。`auth.test.js` は一時ディレクトリを使い、開発機の大会に触らない。

### 4.10 同期の不変条件

`index.js:570-591` の「書き込み系ハンドラは同期のまま」を守る。新しいストア・認可・速度制限・監査はすべて同期の `fs` とメモリだけで書き、`await` を挟まない。サーバーは 1 プロセス（コンテナ 1 つ）の前提。複数プロセスにするなら、このストアは作り直しが要る（コメントに明記する）。

---

## 5. API

### 5.1 新しい API

| メソッド・パス | 誰が | 本文 → 応答 |
|---|---|---|
| `POST /api/join` | 誰でも（鍵が要る） | `{ key, confirm }` → 下記 |
| `GET /api/session` | 誰でも | → `{ role: 'admin'\|'scorer'\|'none', via: 'basic'\|'session'\|'dev'\|null, scope: { eventId, eventName, court } \| null, label, expiresAt, now, reason }` |
| `POST /api/session/logout` | 誰でも（自分の Cookie だけ） | → `{ success: true }`、Cookie を消す（`Max-Age=0`）。そのセッションに `revokedAt` を書く。HTML のフォームから来たとき（`Content-Type: application/x-www-form-urlencoded`）は 303 で `/` へ |
| `POST /api/invites` | 運営 | `{ role: 'scorer', eventId, court: 'A'\|null, label?, expiresAt?, maxDevices? }` → 201 `{ invite: <一覧と同じ形>, key, joinPath: '/join#k=<key>' }`。**`key` を返すのはこの 1 回だけ** |
| `GET /api/invites?eventId=…` | 運営 | → `[{ id, role, eventId, eventName, court, label, createdAt, expiresAt, maxDevices, status: 'active'\|'expired'\|'revoked', revokedAt, revokedReason, devices: [{ id, summary, ua, createdAt, lastSeenAt, status }] }]`。`secretHash` は返さない |
| `POST /api/invites/:id/revoke` | 運営 | → `{ success: true, revokedSessions: n }` |
| `POST /api/sessions/:id/revoke` | 運営 | → `{ success: true }`（その端末だけ） |
| `POST /api/ai-keys` | 運営 | `{ label, expiresAt?, limits? }` → 201 `{ aiKey: <一覧の形>, key }`（1 回だけ） |
| `GET /api/ai-keys` | 運営 | → `[{ id, label, createdAt, expiresAt, revokedAt, status, limits, lastUsedAt, useCount }]` |
| `POST /api/ai-keys/:id/revoke` | 運営 | → `{ success: true }` |
| `GET /api/ai/whoami` | AI だけ | → `{ keyId, label, expiresAt, now, limits, remaining: { minute, writesMinute, day }, sandboxPrefix: 'テスト用' }` |

**`POST /api/join` の詳細**

- **`app.use(express.json({ limit: '50mb' }))` より前に** `app.post('/api/join', express.json({ limit: '2kb' }), handler)` として登録する（無認証の大きな本文を読まない。`/api/session/logout` も同じく前に置く。本文は読まない）。
- `key` だけを読む。クエリ文字列の鍵（`?k=`）は読まない（ログに残る経路を作らない）。
- `confirm: false`（下見）: 鍵が有効なら `200 { role, eventId, eventName, court, label, expiresAt, now, devices: { active, max } }`。**セッションは作らない・Cookie も出さない**。
- `confirm: true`: 鍵が有効で端末数に空きがあれば、セッションを作って `Set-Cookie`、`200 { role, eventId, eventName, court, label, expiresAt, now, next: '/scoring.html#event/<id>/<court>' }`（全コートの鍵は `court` を空にした `next`）。
- 失敗: 鍵の形が違う・知らない ID・秘密が違う → 401 `key_invalid`。取り消し済み → 401 `invite_revoked`。期限切れ → 401 `invite_expired`。大会が無い → 401 `invite_revoked`（`event_deleted` で取り消されているはず）。端末数の上限 → 409 `device_limit`（`devices` 付き）。速度制限 → 429。
- 応答に `Cache-Control: no-store`。

### 5.2 認可の判定表（既存の API 32 本＋新しい API）

記号: ✓ 許す ／ ✗ 拒む（403 `role`）／ **自** 採点の鍵の大会（とコート）だけ（外れたら 403 `scope`）／ **砂** AI は「テスト用」の大会だけ（外れたら 403 `sandbox`。5.4）／ 公 無認証で可。
「閲覧」は今の共有リンク（無認証）で、`/api/links/:token*` の GET 以外は全部 401。

| # | メソッド・パス（`index.js` の行） | 運営 | 採点 | AI | 閲覧 |
|---|---|---|---|---|---|
| 1 | `GET /api/events`（595） | ✓ | **自**（一覧を自分の大会 1 件に絞って返す） | ✓（全件。各行に `sandbox: true/false` を足す） | ✗ |
| 2 | `GET /api/events/:id`（623） | ✓ | **自** | ✓ | ✗ |
| 3 | `POST /api/events`（742） | ✓ | ✗ | 新規だけ（`id` を送れば 403 `sandbox`）・名前が「テスト用」 | ✗ |
| 4 | `PATCH /api/events/:id`（870） | ✓ | ✗ | **砂**（`name` を送るなら新しい名前も「テスト用」） | ✗ |
| 5 | `DELETE /api/events/:id`（934） | ✓ | ✗ | **砂**（11 章 D11: AI が作った大会だけに絞るか） | ✗ |
| 6 | `POST /api/events/:id/copy`（972） | ✓ | ✗ | 新しい名前が「テスト用」（コピー元は読むだけなので本番でも可） | ✗ |
| 7 | `POST /api/events/from-template`（1130） | ✓ | ✗ | 名前が「テスト用」 | ✗ |
| 8 | `POST /api/events/:id/status`（1176） | ✓ | ✗ | **砂** | ✗ |
| 9 | `POST /api/events/:id/players`（1326） | ✓ | ✗ | **砂** | ✗ |
| 10 | `POST /api/events/:id/players/bulk`（1727） | ✓ | ✗ | **砂** | ✗ |
| 11 | `POST /api/events/:id/players/reorder`（1801） | ✓ | ✗ | **砂** | ✗ |
| 12 | `PATCH /api/events/:id/players/:playerId`（1887） | ✓ | **自**（その行がそのコート・採点の項目だけ。5.3） | **砂**（全項目、`force` 可） | ✗ |
| 13 | `DELETE /api/events/:id/players/:playerId`（2150） | ✓ | ✗ | **砂** | ✗ |
| 14 | `POST /api/events/:id/import`（2269、CSV） | ✓ | ✗ | **砂** | ✗ |
| 15 | `GET /api/events/:id/export`（2482、CSV） | ✓ | ✗ | **砂**（割り切り。本番の名簿は `GET /api/events/:id` で読めるので持ち出しの防止にはならない。大量の書き出しを AI の既定の操作にしない程度の意味） | ✗ |
| 16 | `GET /api/events/:id/techniques`（2592） | ✓ | **自** | ✓ | ✗ |
| 17 | `PUT /api/events/:id/techniques`（2707） | ✓ | ✗ | **砂** | ✗ |
| 18 | `DELETE /api/events/:id/techniques`（2736） | ✓ | ✗ | **砂** | ✗ |
| 19 | `GET /api/events/:id/bundle`（2810） | ✓ | ✗ | **砂**（15 と同じ理由） | ✗ |
| 20 | `POST /api/events/import`（2880、大会ファイル） | ✓ | ✗ | ✗（名前が取り込むファイル次第で、砂場を保証しにくい。要るなら段階 2 の後で） | ✗ |
| 21 | `POST /api/events/:id/rounds/2/generate`（3279） | ✓ | ✗ | **砂** | ✗ |
| 22 | `GET /api/events/:id/ranking`（3323） | ✓ | ✗（段階 1。11 章 D7） | ✓ | ✗ |
| 23 | `PUT /api/events/:id/live/:court`（3359） | ✓ | **自**（`:court` が鍵のコート。`playerId` を送るならその行もそのコート） | **砂** | ✗ |
| 24 | `GET /api/techniques`（3425、雛形） | ✓ | ✓（`app.js:69` が起動時に読む。秘密は無い） | ✓ | ✗ |
| 25 | `POST /api/techniques`（3436） | ✓ | ✗ | ✗（全大会の雛形に効く） | ✗ |
| 26 | `DELETE /api/techniques`（3450） | ✓ | ✗ | ✗ | ✗ |
| 27 | `GET /api/events/:id/history`（3466） | ✓ | ✗（採点画面は使わない） | ✓ | ✗ |
| 28 | `POST /api/events/:id/history`（3498） | ✓ | **自**（`actor` はサーバーが付ける。5.6） | **砂** | ✗ |
| 29 | `POST /api/links`（3530） | ✓ | ✗ | **砂**（`targetId` が「テスト用」） | ✗ |
| 30 | `GET /api/links/:token`（3580） | 公 | 公 | 公 | 公 |
| 31 | `GET /api/links/:token/ranking`（3601） | 公 | 公 | 公 | 公 |
| 32 | `GET /api/links/:token/live`（3628） | 公 | 公 | 公 | 公 |
| 新 | `POST /api/join` `GET /api/session` `POST /api/session/logout` | 公 | 公 | 公 | 公 |
| 新 | `/api/invites*` `/api/sessions/:id/revoke` `/api/ai-keys*` | ✓ | ✗ | ✗ | ✗ |
| 新 | `GET /api/ai/whoami` | ✗ | ✗ | ✓ | ✗ |
| — | **表に無い `/api/` のパス** | 今どおり（ルートが無ければ 404） | ✗ | ✗ | 401 |

**表に無いものは運営以外すべて拒否（既定拒否）**。新しいルートを足したら表にも足す。足し忘れは運営以外で 403 になり、すぐ気付く（安全側の失敗）。テストで「`index.js` の `app.get/post/put/patch/delete('/api/…')` が全部表にある」ことを固定する（8 章）。

ルートの照合は Express と同じにする: `POST /api/events/import` と `POST /api/events/from-template` は文字どおりの一致を先に見る（`GET /api/events/import` は大会 ID `import` の `GET` として扱う。Express も同じ）。パスは小文字化してから照合する（1.1 の二重の守り）。

### 5.3 採点の PATCH（`PATCH /api/events/:id/players/:playerId`）で採点の鍵に許す項目

| 区分 | 項目 | 採点の鍵 |
|---|---|---|
| 採点 | `score` `result` `adjust` `totalAdjust` `confirmed` | 許す |
| 採点 | `note` | 許す |
| 版 | `baseRev` | 許す。**採点の項目を送るなら必須**（無ければ 400 `base_rev_required`。採点の鍵で入る端末は必ず新しい画面なので、互換の受理＝`index.js:1916` の丸めは要らない） |
| 運営 | `name` `tech1` `tech2` `tech3` `isFemale` `isNewFace` `bib` `rank` `rental` `court` `round` | **拒む**。1 つでも本文にあれば（値が今と同じでも）403 `{ reason: 'field', fields: [...] }` |
| 越え | `force` | **拒む**（403 `field`）。`not_scorable` を越えるのは運営だけ |
| その他 | 上に無いキー | 拒む（403 `field`）。採点画面は上の 7 つしか送らない（`outbox.js:349-358`） |

さらに、その選手の行のコート（`courtOf`、`index.js:222`）が鍵のコートと同じであること（鍵が全コートなら見ない）。`未分類` の行は採点の鍵では触れない（403 `scope`）。決戦の行は先頭コートの末尾に置く約束（設計書 2026-09-28）なので、先頭コートの鍵で採点できる。

検査は **ハンドラの中**、`body` と `player` を取り出した直後（`index.js:1906-1909`）・`clampLegacyAdjust`（`:1916`）と「形の検査」より前に置く。理由: 本文と行の両方を見る必要があり、ミドルウェア（本文を読む前）では行のコートが分からない。ハンドラの中なら読み込みと書き込みの間に `await` が無いので、検査した行と書き換える行が同じだと保証できる。

### 5.4 AI の砂場の判定

```
isSandboxName(name) = typeof name === 'string' && name.trim().startsWith('テスト用')
isSandboxEvent(event) = isSandboxName(event.name)   // 今ファイルにある名前で判定する
```

- **大会 ID を含むルート**（表の「砂」）: ミドルウェア（本文を読む前）で大会ファイルを同期で読み、`isSandboxEvent` が偽なら 403 `sandbox`。大会が無ければ通して、ハンドラの 404 に任せる。**ファイルはあるが読めない（壊れた JSON など）ときは 403 `sandbox`**（名前で砂場か判定できない大会を AI に消させない・書かせない。「無い」とは分ける。レビュー R5。`authz.UNREADABLE`）。
- **本文を読んだあとにもう一度**: `express.json` は非同期なので、本文をゆっくり送っている間に運営が大会名を「テスト用」から本番の名前に変えると、本文を読む前の判定だけでは本番の大会に書ける。`express.json` の直後に **AI だけ** 同じ判定（`authorize`）をもう一度通す同期のミドルウェアを置く。そこからハンドラの同期の検査・書き込みまでは割り込まれない（レビュー R4）。
- **作る系**（3・6・7）: ハンドラの中で、新しい名前が `isSandboxName` でなければ 403 `sandbox`。作った大会には `test: true` と `createdBy: 'ai'` を付ける（11 章 D12。`test` は一覧で既定で隠すための既存の印、`createdBy` は新しい項目。`POST /api/events` の「許すキー」のコメント `index.js:738-741` に `createdBy` を足し、既存の値を引き継ぐ。`test` と同じ扱い）。
- **改名**（4）: ハンドラの中で、`body.name` があれば新しい名前も `isSandboxName`。
- **`POST /api/events` に `id`**: AI は 403（既存の大会の丸ごと上書きを AI にさせない。新規作成だけ）。
- **数の上限**: AI が作った（`createdBy: 'ai'`）大会が 20 件あるとき、AI の作成は 409 `sandbox_quota`（11 章 D13）。
- 「テスト用」の判定は `trim()` のあとの **前方一致**。全角・半角の違い（`ﾃｽﾄ用`）は一致しない（狭い方に倒す）。

### 5.5 実装の置き場所（2 段の認可）

| 段 | 場所 | 見るもの |
|---|---|---|
| (a) 認証と粗い認可 | `index.js:555-561` の認証ミドルウェアを置き換える。`express.json` の **前**、同期 | 主体の解決（3.2）、CSRF（3.4）、速度制限（3.6）、ルート表（5.2）の役割、URL の大会 ID・コート（採点の「自」、AI の「砂」） |
| (b) 本文に依存する認可 | 各ハンドラの中（検査は書き換えの前） | 採点の PATCH の項目と行のコート（5.3）、`live` の `playerId` のコート、AI の作成・改名の名前（5.4） |

- 新しいファイル `server/authz.js`: ルート表（`{ method, pattern, op, eventParam, courtParam, roles: { scorer: 'none'|'own'|'own-court'|'any', ai: 'none'|'read'|'sandbox'|'create' } }`）、`matchRoute(method, path)`、`authorize(principal, route, ctx)`。純粋関数にして単体テストする。
- 新しいファイル `server/credentials.js`: 招待・セッション・AI キーのストア（4 章）、鍵の生成・解析・照合、期限の計算、掃除、監査ログ。
- `server/auth.js`: `parseBasic` と Basic の照合は残す。Cookie の解析・組み立て、`resolvePrincipal(req)`、`isPublicApi` の拡張（`POST /api/join` `GET /api/session` `POST /api/session/logout`）を足す。
- ハンドラからは `req.principal` を見る。ヘルパー `requireScorerPatch(req, res, event, player, body)` などを `authz.js` に置き、`if (!…) return;` の形で使う（`rejectIfLocked` と同じ書き方）。

### 5.6 履歴の `actor`

- `appendHistory(eventId, entry)` の呼び出しで、サーバーが `actor` を付ける: `'運営'`（Basic・開発）／`'採点端末（<label>）'`／`'AI（<label>）'`。`POST /api/events/:id/history` の本文の `actor` は受けない（今も `HISTORY_STRING_KEYS` に無いので落ちる。その上でサーバーが付ける）。
- AI の **書き込み**（GET 以外）が 2xx で終わったら、`res.on('finish')` で `appendHistory` に `{ action: 'ai_api', actor: 'AI（<label>）', detail: '<METHOD> <ルートの型> <要点>' }` を積む（大会がまだあるときだけ。削除のときは監査ログだけ）。要点は「選手 <名前> の採点」「状態 一巡目 → 一巡目終了」など、本文から作る短い文。
- 監査ログ（4.6）には AI の全リクエストを残す。

---

## 6. 画面

### 6.1 `join.html`（新規・公開）

- `PUBLIC_FILES` に `join.html` `join.js` `join.css` を足す（端末はまだ認証されていない）。下の CSP でインラインの `<script>` / `<style>` を禁じるので、CSS も別ファイルにする（`theme.css` は既に公開）。
- サーバーは `/join`（拡張子なし）を `join.html` として返す（リンクを短くするため。許可リストの `normalize` で `join` → `join.html` に読み替える 1 行を足す）。
- 応答ヘッダー（`join.html` だけ）: `Referrer-Policy: no-referrer`、`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`、`Cache-Control: no-store`。外部の資源は読まない。

流れ（`join.js`）:

1. 読み込み直後に `location.hash` から `k=` を取り出し、変数に持つ。**すぐに** `history.replaceState(null, '', '/join')` でアドレス欄と履歴から消す。`sessionStorage` などには書かない。
2. 鍵が無ければ「QR を読み取ってこのページを開いてください」と、**鍵の貼り付け欄**（6.9 の iOS 対策。join の URL まるごと・鍵だけのどちらでも受ける）を出す。
3. 鍵があれば `POST /api/join { key, confirm: false }`（下見）。成功なら「**<大会名> の <A> コートの採点端末** として登録します。期限 10/12（日）23:59。登録済みの端末 1 / 2 台」と **[この端末を登録する]** ボタン。
4. ボタンで `POST /api/join { key, confirm: true }`。成功したら変数の鍵を捨て、「登録しました」と **[採点画面を開く]**（`next` へ `location.replace`）。「この画面をブックマークしてください」の案内は採点画面側に出す（そこが入口になるため）。
5. 失敗の文言（`reason` で出し分け）:
   - `key_invalid`: 「この QR は読み取れませんでした。運営にもう一度出してもらってください」
   - `invite_expired`: 「この QR は期限切れです（期限 …）。運営に新しい QR をもらってください」
   - `invite_revoked`: 「この QR は取り消されています。運営に新しい QR をもらってください」
   - `device_limit`: 「この QR で登録できる端末の数（2 台）に達しています。運営に端末の一覧から古い端末を外してもらうか、新しい QR をもらってください」
   - 429: 「しばらく待ってからもう一度読み取ってください」
   - 通信失敗: 「通信できません。電波を確かめて [もう一度] を押してください」（鍵はメモリにあるので再試行できる）
6. 既に運営（Basic）でログインしている端末で開いたら、下見の時点で「この端末は運営としてログインしています。採点端末として登録しても運営の操作はそのまま使えます」と添える（`GET /api/session` の `role`）。

### 6.2 PC 運営（`desk.html`）の「端末の招待」

- 置き場所: **試合進行**（`desk-match.js`）のコートごとのカード。今の「採点画面を開く」「📺 配信用ボードの URL をコピー」（`desk-match.js:401-420`）の **下の段** に、別の色の **[📱 採点端末を招待（QR）]** を置く。配信用 URL のボタンとは段を分け、見出しで「見るだけ」「書き込める」を書き分ける（T10）。
- 試合進行の末尾に区画「**招待した端末**」を新設（新しいファイル `desk-invites.js`）。表: ラベル・コート・期限・状態（有効／期限切れ／取り消し済み）・端末（n / 上限）・[取り消す]。各行を開くと端末の行: 端末の要約（`iPad・Safari`）・登録日時・最後の通信・[この端末を外す]。**知らない端末に見えたら外す** ことを区画の先頭に一文で書く。
- 一覧は試合進行を開いたときと [更新] で読む（自動更新はしない。既存の方針）。
- 招待のダイアログ:
  - 入力: コート（そのカードのコート。「全コート」も選べる）、ラベル（既定 `A コート タブレット`）、期限（既定は 4.7。「大会の日の終わり／今日の終わり／明日の終わり」から選ぶ。日時の手入力は出さない）、端末数（1〜5、既定 2）。
  - [発行する] で `POST /api/invites`。応答の `joinPath` から `location.origin + joinPath` を作り、**QR を大きく** 出す。下に URL（既定では伏せて、[URL を表示] で出す）と [URL をコピー]。
  - 注意書き: 「この QR は **採点ができる鍵** です。会場でタブレットに読み取らせてください。写真に撮って送らないでください。閉じると二度と表示できません（必要なら新しく発行してください）」。
  - 閉じたら鍵を変数から捨てる。
- 取り消しは確認ダイアログ（「A コート タブレットの招待を取り消します。この招待で登録した 2 台の端末は、次の保存から採点できなくなります」）。
- スマホ運営（`admin.html`）には段階 1 では置かない（11 章 D17）。

### 6.3 QR の生成（外部 CDN に頼らない）

| 案 | 中身 | 長所 | 短所 |
|---|---|---|---|
| **A（推奨）** | **qrcode-generator**（Kazuhiko Arase、MIT、依存なしの 1 ファイル）を `vendor/qrcode.js` として同梱 | 実績があり、版・誤り訂正の実装を自分で検証しなくてよい | 取得時にネットワークと出所の確認が要る（CLAUDE.md の「ダウンロード・インストール」） |
| B | 自前の符号器（バイトモード・誤り訂正 M・型番 1〜6 に限定、約 400 行） | 依存ゼロ | リード・ソロモン、マスク選択、型番情報の実装と検証の手間。誤りが読み取り不能として現場で出る |

- A の場合: npm の公開版を取得し、**版と SHA-256 をファイル冒頭のコメントと本書の追記に記録** する。ライセンス表記を残す。`PROTECTED_FILES` に `vendor/qrcode.js` を足す（運営画面だけが読む）。
- 描画は `<canvas>`（または `<svg>`）に自前で描く。誤り訂正レベルは **M**、余白は 4 モジュール。URL は約 100 文字（`https://tameshigiri.phx-base.org/join#k=` 41 文字 + 鍵 56 文字）で、型番 5〜6 程度に収まる。
- `test.html` に「既知の文字列を符号化した行列の大きさが期待どおり（型番 × 4 + 17）」「同じ入力で同じ行列」のテストを足す。実機での読み取りは手動の完了条件（8 章）。

### 6.4 採点画面の「採点専用」モード（`app.js`）

- 起動時（`app.js:69` の前）に `Api.getSession()`（`GET /api/session`）を呼ぶ。`role: 'scorer'` なら採点専用モードにする:
  - 大会の選択肢は鍵の大会 1 件だけ（サーバーも一覧を 1 件にして返す）。選択欄は無効化（`disabled`）。
  - コートの選択肢（`app.js:421-441` で作る）は鍵のコートだけ。全コートの鍵ならその大会のコート全部。
  - `Route.restore()` の結果が鍵の範囲外（別の大会・別のコート）なら、範囲内に置き換えて `Route.set`（黙って範囲外を開かない）。
  - 上部のリンク `トップ` `運営` `技得点表` `順位表示`（`scoring.html:47-51`）と「大会の作成は運営画面で」（`:63`）を隠す。`ヘルプ` は残す。
  - 上部に小さな札: 「採点専用 ・ A コート ・ 10/12 23:59 まで」。期限はサーバーの `expiresAt` を日本時間で表示（端末の時計で残り時間を数えない。T7）。
  - 札の右に [この端末の登録を解除]（確認のうえ `POST /api/session/logout`、未送信があれば止める）。
  - 初回だけ「この画面を Safari（ブラウザ）でブックマークしてください。次からはそこから開けます（ホーム画面に追加するなら、この画面ではなく `/join` を）」を出す（`localStorage` に既読の印。**一度出したら既読**にする。閉じずに再読み込みしても、もう出さない。結合試験 E3）。「ホーム画面に追加」を勧めないのは 6.9（要確認 e）の Cookie の共有が確かめられていないため（レビュー R6）。
- `role: 'admin'` / `'none'` は今の画面のまま（`none` は保護ページなのでここまで来ない）。
- 判定は純粋関数に切り出す: `Scope.filterEvents(events, session)`、`Scope.allowedCourts(event, session)`、`Scope.clampRoute(route, session, event)`（置き場所は `courts.js` か新しい `scope.js`。`scope.js` なら `PROTECTED_FILES` と採点に許すファイル（6.5）に足す）。`test.html` で固定する。

### 6.5 保護ページの 401 / 403（`index.js:3718-3726` の置き換え）

`static-policy.js` に **採点の主体が読んでよいファイル** の表 `SCORER_FILES` を足す: `scoring.html` `style.css` `app.js` `data.js` `status.js` `route.js` `outbox.js` `storage.js`（`scope.js` を作るならそれも）。`classify` の戻り値は今どおり、別に `scorerAllowed(rel)` を足す。

| 主体 | `public` | `protected` で `SCORER_FILES` | 他の `protected` | `/`・`/index.html` |
|---|---|---|---|---|
| 運営 | 200 | 200 | 200 | 200 |
| 採点 | 200 | 200 | **403 の HTML**（ダイアログなし） | **302 → `/scoring.html`**（ハッシュはブラウザが引き継ぐ） |
| 無効な Cookie あり | 200 | **401 の HTML**（ダイアログなし） | 同左 | 同左 |
| 何も無い | 200 | 401 + `WWW-Authenticate`（今どおり） | 同左 | 同左 |

- 403 の HTML（サーバーが組み立てる短い HTML、スクリプトなし）: 「この端末は **<A コート> の採点専用** です。運営画面は運営の端末で開いてください。」＋ [採点画面へ]（`/scoring.html`）＋ フォーム `<form method="post" action="/api/session/logout">` の [この端末の登録を解除する]（解除すると次に開いたとき運営の ID・パスワードを聞かれる）。
- 401 の HTML（無効な Cookie）: 「この端末の採点の登録は **期限切れ／取り消し済み** です。運営に新しい QR をもらって読み取ってください。未送信の採点はこの端末に残っています。」＋ 同じ解除のフォーム（運営がこの端末で Basic を使いたいとき用）。
- どちらも `Cache-Control: no-store`。**`WWW-Authenticate` を付けない**（採点係の端末にパスワード欄を出さない）。

### 6.6 送信キュー（`outbox.js`）と状態バナー（`app.js`）

- 401 は今どおり捨てずに再送対象（`outbox.js:221-225`）。`Api.updatePlayer` は本文の `reason` を返す（既にそうなっている）。
- `app.js:119` の `authLost` 表示を `reason` で出し分ける:
  - `session_expired` / `session_revoked` / `invite_revoked`: 「⚠ この端末の採点の登録が切れました。未送信 n 件は端末に残っています。運営に新しい QR をもらって読み取ると送られます」（再読み込みを促さない。再読み込みしても 401 の HTML になるだけ）
  - それ以外の 401 / 403（運営の Basic 切れ）: 今の文言のまま
- 403 `scope` / `field` は **衝突と同じく捨てずに保持** する: `CONFLICT_REASONS`（`outbox.js:41`）に `scope` `field` を足し、確認の文言は「この端末の登録では保存できない選手です（別のコート・運営の項目）。サーバーの内容を読み込む／あとで決める」。採点専用モードの画面は範囲外の選手を出さないので、通常は起きない（古いキューの残り・コートの付け替えのときだけ）。
- 新しい QR で入り直すと（同じ端末・同じ `localStorage`）、キューはそのまま再送される。

### 6.7 PC 運営の「AI 用キー」（段階 2）

- 置き場所: 大会一覧（`desk-events.js`）の下に区画「**AI 用キー**」（大会に属さないため）。表: ラベル・発行日・期限・状態・最後の利用・回数・[取り消す]。
- [発行する]: ラベル、期限（30 日／7 日／90 日）。発行したらキーを 1 回だけ表示し、[コピー] と注意書き「このキーは **あなたの PC の MCP サーバーにだけ** 渡してください。`tools/mcp/phx-tameshigiri/set-key.ps1` を **自分のターミナルで** 実行し、表示に従って貼り付けます。Claude のチャットに貼らないでください。閉じると二度と表示できません」。
- 基本情報（`desk-setup.js`）で大会名を「テスト用」で **始まるように** 変えるとき、確認「この大会は AI が書き込める大会になります（名前が『テスト用』で始まるため）。よろしいですか」。逆に外すときは確認不要。スマホ運営の大会名の編集にも同じ確認（T14）。

### 6.8 ヘルプ（`help.html`）

- 「2. 採点の進行」に節「**採点端末を QR で招待する**」: 運営が試合進行のコートのカードから発行 → タブレットのカメラで読み取る → [この端末を登録する] → 採点画面をブックマーク。期限、端末の数、取り消し、知らない端末を外す、写真で送らない。
- 「5. 困ったとき」に「**この QR は期限切れです／取り消されています／登録できる端末の数に達しています**」「**この端末は採点専用です**」「**この端末の採点の登録が切れました**」。
- 段階 2 で「AI 用キー」の節（発行・取り消し・何ができて何ができないか。キーをチャットに貼らない）。
- `help.html` は公開ページ。鍵や仕組みの秘密は書かない（書く必要も無い）。

### 6.9 iOS の「ホーム画面に追加」（要確認）

ホーム画面に追加した Web アプリは、Safari と **Cookie の保管場所が別** になる iOS の版がある（**要確認**: 現場のタブレットの iOS の版で、Safari で join した後にホーム画面のアイコンから開いて Cookie が効くか）。効かない場合の逃げ道として:

- join ページの **鍵の貼り付け欄**（6.1 の 2）。ホーム画面のアプリで `/join` を開き、運営からもらった URL を貼る。そのため **ホーム画面に追加するのは `/join`** にしてもらう運用もありうる（採点画面へは登録後に自動で移る）。
- 採点画面の 401 の HTML に「[QR の URL を貼り付けて登録する]（`/join` へ）」のリンクを置く。
- Cookie が無いと（ホーム画面のアプリで Cookie が別のとき）保護ページは Basic の 401 になり、パスワードのダイアログが出る。その 401 の本文（`auth.rejectPage`。ダイアログを閉じると見える）にも「採点端末の方は、運営から受け取った QR をもう一度読み取ってください」と `/join` へのリンクを置く。
- 要確認 (e) が済むまでは、採点画面とヘルプの案内は「Safari（ブラウザ）でブックマーク」にし、ホーム画面に追加するなら `/join` を、と注記する。

Android の Chrome の「ホーム画面に追加」は Chrome と Cookie を共有する想定だが、これも **要確認**。

---

## 7. MCP サーバー（段階 2）

### 7.1 置き場所と構成

```
tools/mcp/phx-tameshigiri/
  server.mjs      … 本体（stdio の MCP サーバー。依存なし、Node 18 以上）
  keystore.mjs    … キーの読み出し（資格情報マネージャー／環境変数）
  api.mjs         … サーバー API の呼び出し（fetch、15 秒で打ち切り、キーを出力に出さない）
  scoring-vm.mjs  … このリポジトリの scoring.js・status.js を vm で読み、採点画面と同じ計算をする（接続先からコードは取らない。レビュー R1）
  set-key.ps1     … ユーザーが自分で実行してキーを保存する
  test.mjs        … MCP サーバーの自動テスト（8 章）
  README.md       … 7.7 の手順（本書から写す）
```

- `tools/` は静的配信の許可リストに無いので配信されない（テストで 404 を固定）。Docker イメージに入れる必要は無いので `.dockerignore` に `tools` を足す。
- **MCP の SDK は使わず手書き** を推奨（11 章 D15）。必要なのは stdio の改行区切り JSON-RPC 2.0 で、`initialize` / `notifications/initialized` / `tools/list` / `tools/call` / `ping` の 5 つだけ。依存ゼロにすると `npm install` が要らず、供給網の心配も無い。実装時に MCP の仕様の最新版で `initialize` の応答（`protocolVersion` の扱い、`capabilities: { tools: {} }`、`serverInfo`）と `tools/call` の戻り（`content: [{ type: 'text', text }]`、`isError`）の形を確かめること。
- 標準出力は JSON-RPC 専用。ログは標準エラーにだけ出す。

### 7.2 キーの読み方

| 環境変数 | 意味 | 既定 |
|---|---|---|
| `PHX_BASE_URL` | 接続先（秘密ではない）。`https://` 必須。`http://` は `localhost` / `127.0.0.1` のときだけ許す。`user:pass@` を含めば起動を拒否（予行スクリプトと同じ） | なし（必須） |
| `PHX_KEY_SOURCE` | `vault`（Windows の資格情報マネージャー）／`env` | Windows では `vault`、他は `env` |
| `PHX_AI_KEY` | `env` のときのキー | — |
| `PHX_VAULT_RESOURCE` | 資格情報の「リソース名」 | `phx-tameshigiri-ai` |

- `vault` の読み方: **Windows PowerShell 5.1**（`powershell.exe`。PowerShell 7 の `pwsh` は WinRT の型を直接読めない）を子プロセスで起動し、`Windows.Security.Credentials.PasswordVault` から `Retrieve(<リソース名>, <PHX_BASE_URL のホスト名>)` → `RetrievePassword()` → `Password` を標準出力に書かせて受け取る。キーはコマンドラインの引数に載せない（引数はプロセス一覧から見える）。この PC の Windows PowerShell 5.1.26100 で `PasswordVault` の型が読めることは確認済み（2026-10-03）。保存・読み出しの通しは実装時に確認する。
- ユーザー名をホスト名にするので、本番（`tameshigiri.phx-base.org`）と開発（`localhost`）のキーを別々に置ける。
- 読み出したキーはメモリにだけ持つ。**キー・`Authorization` ヘッダーを、ツールの結果・エラー文・標準エラーのどこにも出さない**。エラー文は出す前にキーの文字列を `***` に置き換える（念のため）。
- キーが無い・読めないときは、ツールの結果を `isError: true` にして「AI 用キーが設定されていません。運営画面で発行し、`set-key.ps1` を自分のターミナルで実行してください」と返す（Claude にキーを打たせる案内はしない）。

`set-key.ps1`（ユーザーが自分で実行する。Claude は実行しない）:

```powershell
param(
  [string]$Resource = 'phx-tameshigiri-ai',
  [Parameter(Mandatory = $true)][string]$HostName   # 例: tameshigiri.phx-base.org / localhost
)
$sec = Read-Host -AsSecureString 'AI 用キーを貼り付けて Enter（画面には出ません）'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($plain -notmatch '^phxai\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$') { throw 'キーの形が違います' }
[void][Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
try { $vault.Remove($vault.Retrieve($Resource, $HostName)) } catch { }
$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential($Resource, $HostName, $plain)))
Write-Host "保存しました（資格情報マネージャー > Web 資格情報 > $Resource / $HostName）"
```

消すときは Windows の「資格情報マネージャー」の「Web 資格情報」から削除する（README に書く）。

### 7.3 ツール

ツール名は Claude Code では `mcp__phx-tameshigiri__<名前>` になる。戻り値は `content: [{ type: 'text', text: <JSON 文字列> }]`。失敗は `isError: true` と日本語の文。

| ツール | 引数 | 戻り値（JSON） | API |
|---|---|---|---|
| `whoami` | なし | `{ baseUrl, keyLabel, expiresAt, remaining, sandboxPrefix }` | `GET /api/ai/whoami` |
| `list_events` | `{ includeProduction?: boolean = true }` | `[{ id, name, date, status, playerCount, sandbox, createdByAi }]` | `GET /api/events` |
| `get_event` | `{ eventId, round?: 1\|2, court? }` | `{ id, name, status, sandbox, courts, players: [{ id, name, order, court, round, isFemale, isNewFace, tech1, tech2, tech3, score, confirmed, finalist, rev }] }`（最大 300 行。超えたら `truncated: true`） | `GET /api/events/:id` |
| `create_test_event` | `{ name, date?, venue?, courts?: string[] = ['A','B'], template?: 'blank'\|'systest' = 'blank' }` | `{ id, name }` | `POST /api/events` か `POST /api/events/from-template` |
| `add_players` | `{ eventId, players: [{ name, court, isFemale?, isNewFace?, tech1?, tech2?, tech3? }] }`（最大 100） | `{ created, players: [{ id, name, order }] }` | `POST /api/events/:id/players/bulk`（`rows` 形） |
| `score_player` | `{ eventId, playerId, rows: [{ values: ['○'\|'×'\|'△'\|'', …4], adjust?: 整数 }], totalAdjust?: 整数, confirmed?: boolean = true, note? }` | `{ playerId, score, rev, confirmed }` | `GET` で最新の行と `rev` → `PATCH …/players/:playerId`（`score` は `scoring-vm` で計算、`baseRev` を付ける） |
| `auto_score` | `{ eventId, court?, seed?: 整数 = 20261001, confirm?: boolean = true }` | `{ scored, skipped, players: [{ name, score }] }` | 今の状態で採点できる行（`EventStatus.isRowScorable` と同じ規則。このリポジトリの `status.js` を vm で読む）を、予行スクリプトの `planScoring` と同じ乱数で採点 |
| `change_status` | `{ eventId, to, force?: boolean = false }` | `{ status, round2 }` | `GET` で今の状態 → `POST …/status { to, from }` |
| `get_ranking` | `{ eventId }` | ranking API の応答そのまま | `GET /api/events/:id/ranking` |
| `delete_test_event` | `{ eventId, confirmName }` | `{ deleted: true, name }` | `GET` で名前 → 一致を確かめて `DELETE` |

- `create_test_event` の名前が「テスト用」で始まらなければ、**先頭に `テスト用 ` を足して作り**、戻り値の `name` で知らせる（危険の少ない側への補正）。
- `score_player` の `rows` は技の並び（`tech1`〜`tech3` の空でないもの）の順。太刀の数が技と合わなければエラー（配点が `null` の太刀に値を入れたら拒否）。
- 予行スクリプト（`rehearse.mjs`）の手順（作成 → 選手登録 → 試合開始 → 一巡目の採点・確定 → 一巡目終了 → 二巡目開始 → 決戦開始 → 二巡目終了 → 順位の照合 → 片づけ）は、上のツールの組み合わせで再現できる。`auto_score` と `planScoring` は同じ乱数（`mulberry32`）・同じ割合にして、予行スクリプトの結果と突き合わせられるようにする。

### 7.4 安全策（クライアント側。サーバーの 5.4 と二重）

1. **書き込むツールは必ず先に `GET /api/events/:id` で今の名前を読み、`テスト用` で始まらなければ API を呼ばずに拒否**（`isError`: 「『<名前>』はテスト用の大会ではないので書き込みません。本番の大会の操作は運営画面で行ってください」）。
2. `delete_test_event` は `confirmName` が今の名前と **完全に一致** しなければ拒否し、今の名前を返す。D11 で「AI が作った大会だけ」に決まれば `createdByAi` も見る。
3. `change_status` で `final` / `archived` に進めるのは、引数 `force: true` が無ければ拒否（取り消しにくい遷移を誤って押さない）。
4. サーバーの 403 `sandbox` / 401 / 429 は、そのまま理由を日本語にして返す（再試行の繰り返しはしない。429 は `retryAfter` を伝える）。
5. 通信は 15 秒で打ち切る。同じツールの自動再試行はしない（書き込みの二重実行を避ける）。

### 7.5 エラーの形

`{ isError: true, content: [{ type: 'text', text: '<日本語の文>' + '\n' + JSON.stringify({ status, reason }) }] }`。`reason` はサーバーの値か、クライアントの `not_sandbox` / `confirm_mismatch` / `no_key` / `bad_input` / `network`。

### 7.6 ユーザーの設定手順（README に写す）

1. 運営画面（PC）の大会一覧 → **AI 用キー** → [発行する]（ラベル例「Claude Code（自宅 PC）」）。表示されたキーを [コピー]。
2. **自分のターミナル**（Claude Code の外）で:
   `powershell -NoProfile -ExecutionPolicy Bypass -File C:\usr\data\AI-Workspace\10_PROJECTS\AntigravityApps\phx-tameshigiri\tools\mcp\phx-tameshigiri\set-key.ps1 -HostName tameshigiri.phx-base.org`
   → 貼り付けて Enter。クリップボードを空にする（Windows のクリップボード履歴を使っているなら、その項目も消す）。
3. Claude Code に登録（キーを含まないので設定ファイルに残ってよい）:
   ```
   claude mcp add --scope local -e PHX_BASE_URL=https://tameshigiri.phx-base.org phx-tameshigiri -- node C:\usr\data\AI-Workspace\10_PROJECTS\AntigravityApps\phx-tameshigiri\tools\mcp\phx-tameshigiri\server.mjs
   ```
   - `--scope local` はこのプロジェクトの自分だけの設定（リポジトリに入らない）。`-e PHX_AI_KEY=…` は **使わない**（設定ファイルに平文で残るため）。
   - 開発サーバー用に別名で `phx-tameshigiri-dev`（`PHX_BASE_URL=http://localhost:3461`）を足してもよい。キーは手順 2 を `-HostName localhost` で。
4. 権限（`.claude/settings.json`。CLAUDE.md の「環境設定ファイルの変更は要確認」に当たるので、ユーザーが承認して入れる）:
   ```json
   {
     "permissions": {
       "allow": [
         "mcp__phx-tameshigiri__whoami",
         "mcp__phx-tameshigiri__list_events",
         "mcp__phx-tameshigiri__get_event",
         "mcp__phx-tameshigiri__get_ranking"
       ],
       "ask": [
         "mcp__phx-tameshigiri__delete_test_event",
         "mcp__phx-tameshigiri__change_status"
       ]
     }
   }
   ```
   書き込むツール（作成・選手登録・採点）は既定の確認のまま（ユーザーが慣れたら `allow` に移す）。
5. 確認: Claude Code で `/mcp` に `phx-tameshigiri` が出る。「whoami を呼んで」で期限と残り回数が返る。
6. キーを替えるとき: 運営画面で古いキーを取り消し、新しいキーで手順 2 をやり直す（MCP サーバーは次の起動で読み直す）。

却下した案: (a) MCP をサーバー側に HTTP で置く（`claude mcp add --transport http … --header "Authorization: Bearer …"`）… ヘッダーが設定ファイルに平文で残る。(b) `-e PHX_AI_KEY=` で渡す … 同じく平文。(c) `.env` のファイルを MCP サーバーが読む … 平文のファイルがディスクに残る。

---

## 8. テスト計画と完了条件

### 8.1 `npm test`（`server/auth.test.js` の流儀）

- 子プロセスでサーバーを起動し、HTTP で確かめる。ランナーと起動のヘルパーは `server/auth.test.js:14-90` と同じもの（共通部分を `server/test-support.js` に切り出してよい）。
- 新しいファイル `server/invite.test.js`（段階 1）と `server/ai-key.test.js`（段階 2）。`package.json` の `test` を `node server/auth.test.js && node server/invite.test.js && node server/ai-key.test.js` に。
- データは `TMG_DATA_DIR` に `fs.mkdtempSync(os.tmpdir() + '/tmg-')` を渡し、終わったら消す。期限切れなどの状態は **起動前に** JSON を書いて作る（ストアは起動時に読むため）。

**単体（段階 1）**

- 鍵の書式: 生成した鍵が `isValidId` の ID・43 文字の秘密になる。形の違い（区切りの数、記号、長さ）は無効。
- 照合: 正しい秘密だけ通る。`secretHash` に鍵そのものが含まれない。
- 期限: `'2026-10-12'` → `2026-10-12T14:59:59.999Z`。空・過去の日付 → 発行日の日本時間の終わり。範囲外の指定 → `bad_expiry`。
- Cookie の解析: 複数の Cookie、同名の重複、`=` を含む値、壊れた値。
- `authz`: **`server/index.js` のソースから `app.(get|post|put|patch|delete)('/api/…')` を拾い、全部がルート表にある**（足し忘れの番人）。表に無いパスは運営以外拒否。`/API/events` の大文字は小文字化してから照合。`POST /api/events/import` と `GET /api/events/import` の区別。
- `static-policy`: `join.html` `join.js` `join.css` は public、`vendor/qrcode.js` `desk-invites.js` は protected、`SCORER_FILES` の中身、`tools/…` `server/data/auth/…` は null。

**結合（段階 1、`AUTH_DEV`・一時データ）**

| 区分 | 確かめること |
|---|---|
| 発行 | Basic で `POST /api/invites` → 201、`key` は応答に 1 回だけ。`GET /api/invites` に `key` も `secretHash` も無い。無認証 401、採点の Cookie 403。知らないコート 400 |
| 交換 | `confirm:false` は `Set-Cookie` なし・セッションも増えない。`confirm:true` で `Set-Cookie` に `HttpOnly` `SameSite=Lax` `Path=/` `Max-Age`（開発は `tmg_s`）。本番起動（`AUTH_PROD`）では `__Host-tmg_s` と `Secure`。クエリの `?k=` は無視される。違う鍵 401 `key_invalid`、取り消し済み 401 `invite_revoked`、期限切れ 401 `invite_expired`、3 台目 409 `device_limit`、11 回の失敗で 429 |
| 固定 | 作り話の Cookie を付けて join しても、返る Cookie の ID は別物。同じ招待で入り直すと前のセッションが取り消され、数が増えない |
| 採点の API | `GET /api/events` が自分の大会 1 件だけ。別の大会の `GET /api/events/:id` 403 `scope`。自分のコートの行に `{ score, result, adjust, totalAdjust, confirmed, note, baseRev }` → 200。`baseRev` なし 400。`tech1` / `name` / `isFemale` / `force` / 知らないキー → 403 `field`。別コートの行・未分類の行 → 403 `scope`。`PUT live/<自コート>` 200、別コート 403。`POST history` 200 で履歴の `actor` が `採点端末（…）`。`DELETE` 大会・`POST status`・CSV・技得点表・`POST /api/links`・`/api/invites` → 403 `role`。`GET /api/techniques` 200 |
| 採点のページ | `/scoring.html` と `SCORER_FILES` は 200。`/admin.html` `/desk.html` `/ranking.html` は 403、`WWW-Authenticate` なし。`/` は 302 で `/scoring.html` |
| 取り消し | 端末の取り消しのあと、その Cookie の API は 401 `session_revoked`、ページは 401 の HTML（`WWW-Authenticate` なし）。招待の取り消しで全端末 401 `invite_revoked`。大会の削除で招待が `event_deleted` |
| 併存 | Basic だけの端末は今までの全テストどおり。Basic と採点の Cookie の両方 → 運営（`DELETE` も通る）。古い（誤った）Basic と有効な Cookie → 採点として通る |
| CSRF | Cookie 付きの `PATCH` に `Sec-Fetch-Site: same-site` → 403 `origin`。`Origin: https://evil.example` → 403。ヘッダーなし → 通る |
| 非公開 | `/server/data/auth/invites.json` `/%73erver/data/auth/sessions.json` `/tools/mcp/phx-tameshigiri/server.mjs` が Basic 付きでも 404 |
| 閲覧 | 共有リンクの 3 本は無認証で今どおり。共有トークンを Cookie や Bearer に入れても何も書けない |

**結合（段階 2）**

| 区分 | 確かめること |
|---|---|
| 認証 | 正しい Bearer で `GET /api/events` 200、各行に `sandbox`。誤り 401 `key_invalid`（Cookie があっても落ちない）、期限切れ 401 `key_expired`、取り消し 401 `key_revoked`。クエリの `?key=` は無視。Bearer で `/admin.html` などのページは開けない（401） |
| 砂場 | 本番の大会（名前が「テスト用」でない）への `PATCH` / `DELETE` / `status` / 選手 / CSV / 技得点表 / `live` / `history` / `links` → 403 `sandbox`。読み（詳細・順位・履歴）は 200。export・bundle は 403 |
| 作成 | 「テスト用」なしの名前で作成 403。ありで 201、`test: true` と `createdBy: 'ai'`。`id` 付きの `POST /api/events` 403。テスト用 → 本番名への改名 403、テスト用 → テスト用は 200。コピーは新しい名前が「テスト用」なら本番からでも 201。21 件目 409 `sandbox_quota` |
| 全体 | `POST`/`DELETE /api/techniques`、`POST /api/events/import`、`/api/invites`、`/api/ai-keys` → 403 |
| 制限 | 61 回目/分で 429 と `Retry-After`、書き込み 31 回目/分で 429 |
| 記録 | AI の書き込みのあと、その大会の履歴に `actor: 'AI（…）'` の `ai_api`。`audit.jsonl` に AI の全リクエスト。どのファイル・応答・ログにもキーの文字列が無い（テストで発行したキーを全ファイルから grep） |

**MCP サーバー（`tools/mcp/phx-tameshigiri/test.mjs`）**

- 開発サーバーを一時データで起動し、AI キーを発行（Basic）、`PHX_KEY_SOURCE=env` で MCP サーバーを子プロセスで起動して stdio で話す。
- `initialize` → `tools/list` に 10 本。`create_test_event` → `add_players` → `change_status`（round1）→ `auto_score` → … → `get_ranking` → `delete_test_event` の通し。
- 本番名の大会への `score_player` は **API を呼ばずに** 拒否（サーバー側の監査ログに行が増えないことで確かめる）。`confirmName` の不一致で拒否。
- MCP サーバーの標準出力・標準エラーの全文にキーの文字列が無い。

### 8.2 `test.html`（ブラウザ）

- `Scope.filterEvents` / `allowedCourts` / `clampRoute`（6.4）。
- `Outbox`: 403 `scope` / `field` が捨てられずに衝突として残る。401 `session_expired` は再送対象のまま。
- 状態バナーの文言の出し分け（`reason` ごと）を純粋関数にして固定。
- QR: 既知の入力の行列の大きさ、同じ入力で同じ出力。
- 既存の 1583 件は認証なしの開発サーバーで従来どおり通る（主体は 3.2 の 5 で `admin`）。

### 8.3 完了条件

**段階 1**

1. `npm test` と `test.html` が全件通る。
2. 開発サーバーで手動: PC 運営で A コートの招待を発行 → **実機のタブレット（現場で使う機種）** のカメラで QR を読み取り → 登録 → 採点画面が A コートだけで開く → 採点・確定が保存され、配信用ボードに出る → B コートや運営画面に行けない。
3. 端末の取り消し・招待の取り消しで、そのタブレットの次の保存が「登録が切れました」になり、未送信が残る。新しい QR で入り直すと送られる。
4. 既存の Basic の端末・共有リンク・発表モード・配信用ボード（OBS）が何も変わらない。
5. 13 章の「要確認」のうち (a) ポート 3457、(b) nginx のヘッダー、(e) iOS のホーム画面 の結果が本書に追記されている。
6. 本番に配備後の確認（ユーザーが実行）: `curl -sS -o /dev/null -w '%{http_code}' https://tameshigiri.phx-base.org/join` → 200、`/api/session` → 200 `{"role":"none"…}`、`/server/data/auth/invites.json` → 404、`/` → 401（今どおり）。

**段階 2**

1. 段階 1 の条件に加え、`npm test`（AI）と MCP の `test.mjs` が通る。
2. 開発サーバーで、Claude Code から MCP のツールだけで予行（7.3 の流れ）を最後まで流せる。結果が予行スクリプトの同じ種の結果と一致する。
3. 本番で: 「テスト用」の大会の作成 → 採点 → 状態遷移 → 順位 → 削除 が通る。本番の大会への書き込みは **MCP で拒否され、サーバーにも届かない**。サーバー単体でも（`curl` に Bearer を付けて）403 `sandbox` になることをユーザーが 1 回確かめる。
4. 運営画面の AI 用キーの一覧に最後の利用と回数が出る。取り消すと次の呼び出しが 401。
5. CLAUDE.md の追記（12 章）をユーザーが済ませている。

---

## 9. 段階 3（概要）: 運営も招待リンク＋PIN、Basic を外す

- 招待の `role: 'admin'`。運営の鍵は期限を長め（例 30 日）、端末数 1〜2。**PIN（6 桁）を併用**: join の確認で PIN を求め、セッションの作成時だけ照合（端末ごとに 5 回失敗で鍵ごと停止）。PIN は運営の鍵の発行時に運営が決め、サーバーは scrypt のハッシュで保存（PIN は推測しやすいので、こちらは遅いハッシュ。発行・join の時だけなので同期の不変条件への影響は小さい）。
- 鍵の発行・AI キーの発行・招待の取り消しなどの「鍵を作る操作」は、運営のセッションでも **PIN の再入力** を求める。
- 最初の運営の鍵（Basic を外したあとの入口）は、サーバー上で **ユーザーが** `docker compose exec phx-tameshigiri node server/tools/issue-admin-invite.js` を実行して作る（画面からは作れない）。紛失時の復旧も同じ。
- 移行: Basic と運営のセッションの併存期間を置き、全運営端末が招待で入れたのを確かめてから `AUTH_USER` / `AUTH_PASS` を任意にし、最後に Basic のコードを外す。本番の起動条件（`index.js:537-540`）を「運営の招待が 1 本以上あるか、Basic がある」に変える。
- 全ページの CSP、`X-Frame-Options`、運営画面のセッション一覧（自分の端末も含む）。
- スマホ運営（`admin.html`）にも招待の区画。

---

## 10. 変えるファイル（段階 1・2）

| ファイル | 段階 | 内容 |
|---|---|---|
| `server/credentials.js`（新） | 1・2 | ストア・鍵・期限・掃除・監査（4 章） |
| `server/authz.js`（新） | 1・2 | ルート表・`matchRoute`・`authorize`・ハンドラ用ヘルパー（5.2〜5.5） |
| `server/auth.js` | 1・2 | Cookie、`resolvePrincipal`、`isPublicApi` の拡張、CSRF、401/403 の HTML |
| `server/static-policy.js` | 1 | `join.*` を公開、`SCORER_FILES`、`vendor/qrcode.js` `desk-invites.js`（`scope.js`）を保護、`/join` の読み替え |
| `server/index.js` | 1・2 | `TMG_DATA_DIR`、認証ミドルウェアの置き換え、新しい API、採点の PATCH・live・history・大会作成・改名・削除のガード、`actor`、`createdBy`、大会削除で招待の取り消し、`PUBLIC_ORIGIN` `TRUST_PROXY` |
| `join.html` `join.js` `join.css`（新） | 1 | 6.1 |
| `desk-invites.js`（新）、`desk-match.js`、`desk.css` | 1 | 6.2 |
| `desk-events.js`、`desk-setup.js`、`admin-events.js`（改名の確認） | 2 | 6.7 |
| `vendor/qrcode.js`（新） | 1 | 6.3 |
| `api.js` | 1・2 | `getSession` `join` `listInvites` `createInvite` `revokeInvite` `revokeSession` `listAiKeys` `createAiKey` `revokeAiKey` |
| `app.js`、`outbox.js`、`scoring.html`（`scope.js` 新） | 1 | 6.4・6.6 |
| `help.html` | 1・2 | 6.8 |
| `test.html` | 1 | 8.2 |
| `server/invite.test.js` `server/ai-key.test.js`（新）、`package.json` | 1・2 | 8.1 |
| `tools/mcp/phx-tameshigiri/*`（新）、`.dockerignore` | 2 | 7 章 |
| `docker-compose.yml`、`.env.example` | 1 | `PUBLIC_ORIGIN`（直書き）、`TRUST_PROXY`（13 章の結果しだい）、ポートの公開範囲（13 章の結果しだい） |

段階 1 だけで 10 ファイルを超えるので、CLAUDE.md の「10 ファイル以上の同時変更は要確認」に当たる。計画を分けるなら「サーバー（credentials/authz/auth/static-policy/index/テスト）」→「join と採点画面」→「PC 運営の招待と QR・ヘルプ」の 3 本。

---

## 11. 決定待ちの事項（推奨値つき）

| # | 事項 | 推奨 | 理由 |
|---|---|---|---|
| D1 | 採点の鍵の既定の期限 | **大会の日の 23:59（日本時間）**。日付が無い・過去なら発行日の 23:59。指定の上限 **7 日** | 当日だけ使う。前日の準備で発行しても当日まで持つ |
| D2 | 1 本の鍵で登録できる端末の数 | 既定 **2**（本番機＋予備）、選べる範囲 1〜5 | 転送されたときに気付ける。予備機への切り替えで詰まらない |
| D3 | Cookie（セッション）の有効期限 | **鍵の期限と同じ**。無操作での切断は **設けない** | 試合の合間の長い休憩で切れると現場が止まる |
| D4 | `SameSite` | **Lax**（＋`Sec-Fetch-Site`/`Origin` の確認） | Strict は QR リーダーから開いたときに 401 になる端末がある。兄弟サブドメインは Lax でも Strict でも同じサイト扱いなので、どのみち 3.4 が要る |
| D5 | 「全コート」の鍵を許すか | **許す** | 1 コートの稽古会・小さな大会で 1 台運用がある |
| D6 | 端末の取り消しで、その端末の未送信をどうするか | **端末に残す**（今の 401 の扱いのまま） | 採点を黙って失わない |
| D7 | 採点の鍵で順位表示（`ranking.html`）を見せるか | **段階 1 は見せない** | 採点に要らない。見せるなら共有リンクで足りる |
| D8 | 運営 PIN の要否（段階 3） | **要る**（6 桁、5 回失敗で停止） | 運営の鍵は全操作できる。URL だけに頼らない |
| D9 | AI キーの回数上限 | **60 回/分、書き込み 30 回/分、2,000 回/日** | 予行 1 回（選手 18 名）で 150 回程度。暴走しても 1 分で止まる |
| D10 | AI キーの期限 | 既定 **30 日**、上限 **90 日** | 使い続けるなら月に 1 回取り替える |
| D11 | AI の削除を「AI が作ったテスト用大会」だけに絞るか | **絞る**（運営が作ったテスト用大会は読み書きできるが消せない） | 開発機の「テスト用 … 削除しないでください」のように、運営が残したいテスト用大会がある |
| D12 | AI が作った大会に `test: true` を付けて一覧で隠すか | **付ける** | 本物の大会に混ぜない（既存の「テストも表示」で出せる） |
| D13 | AI が作った大会の同時に存在できる数 | **20 件** | 暴走したときのディスクと一覧の汚れを抑える |
| D14 | QR の生成 | **qrcode-generator（MIT）を同梱**（取得時に版と SHA-256 を記録） | 自前の符号器の検証コストと現場での読み取り失敗の危険 |
| D15 | MCP の実装 | **SDK を使わず手書き（依存ゼロ）** | ツール呼び出しだけなら JSON-RPC 5 種で足りる。`npm install` が要らない |
| D16 | AI キーの保管場所 | **Windows の資格情報マネージャー（PasswordVault）**。環境変数は他の OS・テスト用 | 平文のファイルを残さない。資格情報マネージャーの画面から見て消せる |
| D17 | スマホ運営（`admin.html`）にも招待の発行を置くか | **段階 1 は PC だけ**（スマホは段階 3） | 当日の発行は PC の試合進行でまとめてやる想定 |
| D18 | AI に本番大会の中身（選手名・得点）を読ませるか | **読ませる**（一覧・詳細・順位・履歴。CSV と大会ファイルの書き出しは不可） | 「本番は読むだけ」の合意どおり。ただし **選手の実名が Claude の会話に入る** ことを了承してもらう。了承しないなら一覧（大会名・日付・状態・人数）だけにする |
| D19 | ポート 3457 の公開範囲 | 13 章 (a) の結果しだいで、nginx がホストにあるなら `"127.0.0.1:3457:3457"` に絞る | 平文の HTTP で API を叩ける経路を消す。`TRUST_PROXY` を安全に使う前提にもなる |

---

## 12. CLAUDE.md の追記文案（ユーザーが自分で追記する）

`C:\usr\data\AI-Workspace\CLAUDE.md` の「## Claude Action Policy」の「### 禁止」の後に、次の節を足す案。今の「本番環境へのデプロイ、DB直接操作」の禁止は **そのまま残す**（この節はその例外を狭く定める）。

```markdown
### 例外: phx-tameshigiri の AI 用キー（MCP サーバー「phx-tameshigiri」）
- 本番（https://tameshigiri.phx-base.org）への操作は、MCP サーバー「phx-tameshigiri」のツール経由に限り可。
  - 書き込み（大会の作成・選手登録・採点・状態遷移・削除）は、名前が「テスト用」で始まる大会だけ。
  - それ以外の大会は読むだけ（一覧・詳細・順位）。書き込みを頼まれたら断り、運営画面での操作を案内する。
- AI 用キーは Claude が見ない・打たない・表示させない・保存しない。
  - curl・スクリプト・ブラウザで本番の API を直接呼ばない（キーを環境変数やファイルから読ませるスクリプトも作らない）。
  - キーがチャットに貼られたら、使わずに、運営画面で取り消して発行し直すようユーザーに伝える。
- 大会の削除・「最終結果を確定」「アーカイブ」への状態遷移は、実行前に大会名と操作をユーザーに示して承認を得る。
- 招待リンク・AI 用キーの発行と取り消し、Basic 認証の資格情報の変更はしない（ユーザーが運営画面・サーバーで行う）。
- デプロイ（deploy.sh）は従来どおりユーザーが実行する。
```

あわせて AGENTS.md にも同じ趣旨を置くかはユーザーの判断（CLAUDE.md は `@AGENTS.md` を読み込んでいるので、他のエージェントにも効かせたいなら AGENTS.md 側が適切）。

---

## 13. 要確認（本番構成。実装の前か段階 1 の配備前に確かめる）

| # | 確かめること | 確かめ方（ユーザーがサーバーで） | 結果で変わること |
|---|---|---|---|
| (a) | ポート 3457 がインターネットから直接届くか | 外の回線から `curl -m 5 http://<サーバーの IP>:3457/share.html`。ファイアウォールの設定 | 届くなら D19（`127.0.0.1:` に絞る）を先にやる。`TRUST_PROXY` はその後。**2026-10-03 確認: 外の回線から `http://tameshigiri.phx-base.org:3457/share.html` は 8 秒で応答なし（ファイアウォールで塞がれている見込み）。compose の `"3457:3457"` は全インターフェースなので、D19 の絞り込みは念のため行う** |
| (b) | nginx が渡すヘッダー（`Host` `X-Forwarded-For` `X-Forwarded-Proto`）、nginx がホストかコンテナか | nginx の `server` ブロックの `proxy_set_header` を見る | `TRUST_PROXY` の値（3.6）、`Origin` の比べ方（3.4。`PUBLIC_ORIGIN` を設定すれば `Host` に依存しない） |
| (c) | nginx のアクセスログに `Authorization` / `Cookie` を出す独自の書式が無いか | `log_format` を見る | 出しているなら外す（AI キー・セッションがログに残る） |
| (d) | サーバーの時計が NTP で合っているか | `timedatectl` | 期限の判定（T7） |
| (e) | 現場のタブレットの機種・OS・ブラウザの版。iOS のホーム画面アプリで Cookie が Safari と共有されるか | 実機で 6.9 の手順 | ホーム画面に追加するのを `/join` にするか、採点画面にするか。`Sec-Fetch-Site` の対応（iOS 16.4 以降の Safari は送る想定だが実機で確かめる） |
| (f) | HSTS と証明書が今も有効か | `curl -sI https://tameshigiri.phx-base.org/share.html` の `Strict-Transport-Security` | `Secure` Cookie の前提。**2026-10-03 確認: `Strict-Transport-Security: max-age=31536000`、`Server: nginx/1.29.8`、証明書の期限 2026-12-03** |
| (g) | 本番の大会に、名前が「テスト用」で始まるのに消してはいけない大会があるか | 運営画面の大会一覧（テストも表示） | D11 の判断、AI に触らせる範囲 |

---

## 14. 実装メモ（PC 運営の画面・QR ライブラリ。2026-10-03）

### 14.1 同梱した QR ライブラリ（6.3 案 A・D14）

| 項目 | 値 |
|---|---|
| ファイル | `vendor/qrcode.js`（グローバル変数 `qrcode` を定義する 1 ファイル） |
| ライブラリ | qrcode-generator **2.0.4**（Kazuhiko Arase、MIT） |
| 取得元 | `https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-2.0.4.tgz`（`npm pack qrcode-generator@2.0.4`） |
| tgz の SHA-512（base64） | `mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==`（`npm view` の `dist.integrity` と一致） |
| 中身の SHA-256 | `79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c`（tgz の `package/dist/qrcode.js`。リポジトリのファイルは、冒頭に出所の注釈 13 行を足しただけで、それより下は無改変。注釈を除いた SHA-256 がこの値と一致することを確かめた） |
| 中身の確認 | 本体の著作権表示・MIT の表記は元のまま残っている。`eval` / `Function(` / `fetch` / `XMLHttpRequest` / 外部読み込みは含まない（純粋な計算だけ。`grep` で確かめた） |
| 更新するとき | 同じ手順で取り直し、`vendor/qrcode.js` 冒頭の注釈と本節を書き換える |

### 14.2 PC 運営の画面（desk-invites.js ほか）

- 発行ダイアログの期限は「大会の日の終わり／今日の終わり／明日の終わり」。サーバーは期限を今から 7 日後までに絞る（4.7）ので、大会の日が 7 日より先のときは「大会の日の終わり」を選べなくして（既定は今日の終わり）理由を書く。判定の元はサーバーで、画面の判定は目印だけ。
- 鍵つき URL・AI 用キーは、発行の応答をクロージャの変数に持ち、ダイアログを閉じるときに捨てる。localStorage・sessionStorage・URL・コンソールには書かない。URL とキーは既定で伏せ、「表示」で出す。
- 大会名を「テスト用」で始まる名前に変えて保存するときの確認は基本情報（desk-setup.js）に置いた。大会一覧（PC）とスマホ運営の大会一覧に「AI 書込可」の目印を出す。
- スマホ運営の大会名の編集（`admin.js` の基本情報の保存）にも、同じ判定（`trim()` のあと「テスト用」の前方一致）の確認を入れた（7df9653）。
- 発行ダイアログを閉じるとき、鍵つき URL・キーを表示していた枠（`.desk-secret`）の文字を消し、ダイアログの中身（QR を含む）を外す（閉じたあとも枠の要素はボタンの処理から参照されて残るため。レビュー R11）。

### 14.3 レビューと結合試験の指摘への対応（2026-10-03）

| 項目 | 対応 |
|---|---|
| R1 | MCP サーバーは接続先の `/scoring.js` を取らず、このリポジトリの `scoring.js`・`status.js` だけを vm で読む。vm の文脈にはホストの値を渡さない（`TECHNIQUES` も文脈の中で作る）。vm は安全境界ではないため、本番サーバーが乗っ取られても利用者の PC でコードが動かないように |
| R2 | 3.6。`POST /api/join` は照合が通らない失敗だけ数える。正しい鍵・照合の通る鍵は上限中でも本来の応答 |
| R3 | 4.4。別の招待で登録し直すと前のセッションを取り消す（`switch`） |
| R4 | 5.4。`express.json` の直後に AI だけ認可をもう一度 |
| R5 | 5.4。読めない大会ファイルは AI に 403 `sandbox` |
| R6 | 6.4・6.9。ブックマークの案内、Basic の 401 の本文に `/join` |
| R7・R8 | 3.6・5.2 の文言 |
| R9 | `join.js` の `createKeyGate`。下見・登録の最中に届いた鍵は預かり、終わってから下見し直す |
| E1 | 3.3 の `Max-Age`（期限 + 30 日）。採点専用モードでは `auth_required` も「登録が切れました・新しい QR」（`Scope.authLostText` の第 3 引数） |
| E2 | `outbox.js` の `HistoryOutbox`。採点画面の履歴は送れなければ端末に控え、起動時・online・採点の送信の成功・30 秒ごとに送り直す。`clientId` を付け、サーバーは同じ `clientId` の履歴を二度積まない |
| E3 | 6.4。ブックマークの案内は一度出したら既読 |
