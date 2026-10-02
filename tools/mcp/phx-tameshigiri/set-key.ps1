# 試し斬り採点システムの AI 用キーを Windows の資格情報マネージャーに保存する（設計書 2026-10-03 7.2）。
# ユーザーが自分のターミナル（Claude Code の外）で実行する。Claude（AI）は実行しない。
#
# 使い方（Windows PowerShell 5.1。PowerShell 7 の pwsh では動きません）:
#   powershell -NoProfile -ExecutionPolicy Bypass -File <このファイル> -HostName tameshigiri.phx-base.org
#   powershell -NoProfile -ExecutionPolicy Bypass -File <このファイル> -HostName localhost      （開発サーバー用）
#
# 保存先: 資格情報マネージャー > Web 資格情報 > <Resource>（既定 phx-tameshigiri-ai）/ <HostName>
# 消すとき: 資格情報マネージャー > Web 資格情報 から削除する。
param(
  [string]$Resource = 'phx-tameshigiri-ai',
  [Parameter(Mandatory = $true)][string]$HostName   # 例: tameshigiri.phx-base.org / localhost
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') {
  throw 'Windows PowerShell 5.1（powershell.exe）で実行してください（pwsh では資格情報マネージャーの型を読めません）'
}
$sec = Read-Host -AsSecureString 'AI 用キーを貼り付けて Enter（画面には出ません）'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$plain = $plain.Trim()
if ($plain -notmatch '^phxai\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$') { $plain = $null; throw 'キーの形が違います（phxai. で始まるキーをそのまま貼り付けてください）' }
[void][Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
try { $vault.Remove($vault.Retrieve($Resource, $HostName)) } catch { }
$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential($Resource, $HostName, $plain)))
$plain = $null
Write-Host "保存しました（資格情報マネージャー > Web 資格情報 > $Resource / $HostName）"
Write-Host 'クリップボードを空にしてください（Windows のクリップボード履歴を使っているなら、その項目も消してください）。'
Write-Host 'Claude Code を起動し直すか /mcp で再接続すると、MCP サーバーが新しいキーを読みます。'
