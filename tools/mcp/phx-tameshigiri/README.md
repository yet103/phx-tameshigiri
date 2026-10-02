# MCP サーバー「phx-tameshigiri」（AI 用キー）

Claude Code から試し斬り採点システムの API を **AI 用キー** で操作するための MCP サーバーです。
設計書: `docs/superpowers/specs/2026-10-03-invite-links-and-ai-key-design.md` の 7 章。

- 書き込めるのは名前が **「テスト用」で始まる大会だけ**（作成・選手登録・採点・状態遷移・削除）。本番の大会は一覧・詳細・順位を読むだけ。
  MCP サーバー（クライアント側）とサーバー（`403 sandbox`）の二重の守りです。
- 削除できるのは **AI が作ったテスト用の大会だけ**。運営が作ったテスト用の大会は消しません。
- キーは Windows の **資格情報マネージャー** に置き、MCP サーバーが起動後に読みます。Claude はキーを見ません・打ちません。
  キーを設定ファイル・`.env`・`-e PHX_AI_KEY=…` に書かないでください（平文で残ります）。
- 依存なし（Node 18 以上）。`npm install` は要りません。

## 設定手順（ユーザーが自分で行う）

### 1. キーを発行する

運営画面（PC）の大会一覧 → **AI 用キー** → [発行する]（ラベル例「Claude Code（自宅 PC）」）。表示されたキーを [コピー]。
キーが表示されるのはこのときだけです。期限は既定 30 日（最長 90 日）、回数は 1 分 60 回・書き込み 30 回・1 日 2,000 回まで。

### 2. キーを資格情報マネージャーに保存する

**自分のターミナル（Claude Code の外）** で、Windows PowerShell 5.1（`powershell.exe`）を使って実行します（PowerShell 7 の `pwsh` では動きません）。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\usr\data\AI-Workspace\10_PROJECTS\AntigravityApps\phx-tameshigiri\tools\mcp\phx-tameshigiri\set-key.ps1 -HostName tameshigiri.phx-base.org
```

「AI 用キーを貼り付けて Enter」と出たら貼り付けて Enter（画面には出ません）。
保存先は **資格情報マネージャー > Web 資格情報 > `phx-tameshigiri-ai` / `tameshigiri.phx-base.org`** です。
終わったらクリップボードを空にしてください（Windows のクリップボード履歴を使っているなら、その項目も消す）。

- ユーザー名に接続先のホスト名を使うので、本番と開発のキーを別々に置けます（開発サーバー用は `-HostName localhost`）。
- キーを消すとき: Windows の「資格情報マネージャー」→「Web 資格情報」→ `phx-tameshigiri-ai` の項目を削除。

### 3. Claude Code に登録する

このリポジトリのディレクトリ（`C:\usr\data\AI-Workspace\10_PROJECTS\AntigravityApps\phx-tameshigiri`）で、自分のターミナルから:

```powershell
claude mcp add --scope local --env PHX_BASE_URL=https://tameshigiri.phx-base.org --transport stdio phx-tameshigiri -- node C:\usr\data\AI-Workspace\10_PROJECTS\AntigravityApps\phx-tameshigiri\tools\mcp\phx-tameshigiri\server.mjs
```

- `--scope local` はこのプロジェクトの自分だけの設定です（`~/.claude.json` のこのプロジェクトの項目に入り、リポジトリには入りません）。
  中身は接続先の URL だけで、キーは含みません。
- オプション（`--scope` `--env` `--transport`）はサーバー名より前、`--` の後ろが起動コマンドです。
  `--env` は複数の値を取るので、名前の直前に `--transport stdio` を置いて区切っています。
- **`--env PHX_AI_KEY=…` は使わない**（設定ファイルに平文で残るため）。
- 開発サーバー用に別名で足してもよい（キーは手順 2 を `-HostName localhost` で）:
  ```powershell
  claude mcp add --scope local --env PHX_BASE_URL=http://localhost:3457 --transport stdio phx-tameshigiri-dev -- node C:\usr\data\AI-Workspace\10_PROJECTS\AntigravityApps\phx-tameshigiri\tools\mcp\phx-tameshigiri\server.mjs
  ```
  （ポートは開発サーバーに合わせる。`http://` は `localhost` / `127.0.0.1` だけ許します）
- 確かめる・外す: `claude mcp list` / `claude mcp get phx-tameshigiri` / `claude mcp remove phx-tameshigiri`

### 4. 権限（任意。ユーザーが承認して入れる）

`.claude/settings.json`（CLAUDE.md の「環境設定ファイルの変更は要確認」に当たるので、ユーザーが自分で入れる）:

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

書き込むツール（作成・選手登録・採点）は既定の確認のまま（慣れたら `allow` に移す）。
あわせて CLAUDE.md への追記文案が設計書の 12 章にあります。

### 5. 確認

Claude Code で `/mcp` に `phx-tameshigiri` が出ること。「whoami を呼んで」で、ラベル・期限・残り回数が返ること。

### 6. キーを替えるとき

運営画面で古いキーを取り消し、新しいキーを発行して手順 2 をやり直します。
MCP サーバーは、サーバーが 401（無効・期限切れ・取り消し）を返した次の呼び出しで資格情報マネージャーを読み直します。
すぐ切り替えたいときは `/mcp` で再接続するか Claude Code を起動し直してください。

## 環境変数

| 変数 | 意味 | 既定 |
|---|---|---|
| `PHX_BASE_URL` | 接続先（秘密ではない）。`https://` 必須。`http://` は `localhost` / `127.0.0.1` / `[::1]` だけ。`user:pass@` を含むと起動しない | なし（必須） |
| `PHX_KEY_SOURCE` | `vault`（資格情報マネージャー）/ `env` | Windows は `vault`、他は `env` |
| `PHX_AI_KEY` | `env` のときのキー（他の OS とテスト用） | — |
| `PHX_VAULT_RESOURCE` | 資格情報の「リソース名」 | `phx-tameshigiri-ai` |

## ツール

Claude Code ではツール名が `mcp__phx-tameshigiri__<名前>` になります。戻り値は JSON の文字列、失敗は `isError: true` と日本語の文
（最後の行に `{"status":…,"reason":…}`。`reason` はサーバーの値か、`not_sandbox` / `confirm_mismatch` / `no_key` / `bad_input` / `network`）。

| ツール | 内容 |
|---|---|
| `whoami` | 接続先・キーのラベル・期限・残り回数・砂場の接頭辞 |
| `list_events` | 大会の一覧（`sandbox` = AI が書き込めるテスト用か、`createdByAi`）。`includeProduction: false` でテスト用だけ |
| `get_event` | 大会の詳細・選手の行（最大 300 行）・技得点表。`round` / `court` で絞れる |
| `create_test_event` | テスト用の大会を作る。名前が「テスト用」で始まらなければ先頭に足す。`template: blank / systest` |
| `add_players` | 一巡目の選手をまとめて登録（最大 100 名） |
| `score_player` | 1 名を採点（採点画面と同じ計算。最新の版 `baseRev` を付ける） |
| `auto_score` | 今の状態で採点できる未確定の行を、予行スクリプトと同じ乱数（mulberry32、既定の種 20261001）・同じ割合で採点・確定。確定済みは飛ばす |
| `change_status` | 状態を変える（今の状態を `from` に付ける）。`final` / `archived` は `force: true` が無ければ拒否 |
| `get_ranking` | 順位（ranking API の応答そのまま） |
| `delete_test_event` | AI が作ったテスト用の大会を消す。`confirmName` が今の名前と完全一致しなければ拒否 |

予行の流れ: `create_test_event` → `add_players` → `change_status(round1)` → `auto_score` → `change_status(round1_done)` →
`change_status(round2)` → `auto_score` → `change_status(round2_final)` → `auto_score` → `change_status(round2_done)` → `get_ranking` → `delete_test_event`。

- `auto_score` の乱数は予行スクリプト（`rehearse.mjs`）の `planScoring` と同じ式です。ただし予行スクリプトは選手登録の技選びでも同じ乱数を使うので、
  得点の並びまでは一致しません（同じ種・同じ手順の組み合わせなら MCP 同士では同じ結果になります）。
- 書き込みは 1 分 30 回までです。`auto_score` が途中で上限に当たると、そこで止まって `retryAfter`（秒）と途中までの数を返します（自動ではやり直しません）。
  待ってからもう一度呼べば、確定済みの行を飛ばして続きから採点します。
- 通信は 15 秒で打ち切り、同じ要求を自動で送り直しません（書き込みの二重実行を避けるため）。

## MCP の版

2026-10-03 に modelcontextprotocol.io の仕様で確認した 2 つの世代の両方に答えます（SDK は使わない手書き、改行区切りの JSON-RPC 2.0）。

- **2026-07-28**（新しい世代）: `initialize` の握手は無く、各リクエストの `params._meta` に
  `io.modelcontextprotocol/protocolVersion` と `io.modelcontextprotocol/clientCapabilities` を載せる。`server/discover` に答え、
  結果に `resultType: "complete"` と `_meta["io.modelcontextprotocol/serverInfo"]` を付ける。知らない版は `-32022`、`_meta` の不足は `-32602`。
- **2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05**（古い世代）: `initialize`（求められた版を知っていればその版、知らなければ 2025-11-25 を返す）
  → `notifications/initialized` → `tools/list` / `tools/call` / `ping`。
- 標準出力は JSON-RPC 専用、ログは標準エラーだけ。標準入力が閉じたら終了します。

## ファイル

| ファイル | 内容 |
|---|---|
| `server.mjs` | 本体（stdio の JSON-RPC、設定の検査） |
| `tools.mjs` | ツール 10 本とクライアント側の安全策 |
| `api.mjs` | サーバー API の呼び出し（Bearer、15 秒で打ち切り、リダイレクトを追わない、エラーの日本語化） |
| `keystore.mjs` | キーの読み出し（資格情報マネージャーを Windows PowerShell 5.1 の子プロセスで読む。キーは引数に載せない／環境変数） |
| `scoring-vm.mjs` | 接続先の `/scoring.js` を vm で読んで採点画面と同じ計算をする。採点できる行の判定はこのリポジトリの `status.js`（サーバーでは保護ファイルなので AI 用キーでは読めない） |
| `errors.mjs` | ツールの失敗の形 |
| `set-key.ps1` | キーを資格情報マネージャーに保存する（ユーザーが実行） |
| `test.mjs` | 自動テスト |

## テスト

```powershell
node tools/mcp/phx-tameshigiri/test.mjs            # 一時データでサーバーを起動して通しで確かめる
node tools/mcp/phx-tameshigiri/test.mjs --vault    # 資格情報マネージャーの経路も（テスト用のリソース名 phx-tameshigiri-ai-test に一時キーを置き、終わったら消す）
```

プロジェクトのサーバー（`server/index.js`）を一時ディレクトリのデータ（`TMG_DATA_DIR`）とテスト用の Basic 認証で起動し、Basic で AI 用キーを発行して、
`PHX_KEY_SOURCE=env` で MCP サーバーを子プロセスとして起動します。`server/data` には触れません。
`PHX_TEST_PORT`（既定は空きポート）と `PHX_TEST_DATA_DIR`（既定は一時ディレクトリ。指定したときは消さない）で変えられます。

## 困ったとき

| 症状 | 原因と対処 |
|---|---|
| `no_key`「AI 用キーが設定されていません」 | 手順 2 が済んでいない、`-HostName` が `PHX_BASE_URL` のホスト名と違う、`pwsh` で保存しようとした。手順 2 をやり直す |
| `401 key_invalid / key_expired / key_revoked` | キーが違う・期限切れ・取り消し済み。運営画面で発行し直して手順 2 |
| `429 rate_limited` | 回数の上限。`retryAfter` 秒待つ |
| `not_sandbox` | 名前が「テスト用」で始まらない大会、または運営が作った大会の削除。運営画面で操作する |
| `/mcp` で失敗と出る | `PHX_BASE_URL` が `https://` でない・`user:pass@` を含む（MCP サーバーが起動を拒否し、理由を標準エラーに書く） |
