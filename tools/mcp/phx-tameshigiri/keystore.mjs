// AI 用キーの読み出し（設計書 2026-10-03 7.2）。
//   PHX_KEY_SOURCE=vault … Windows の資格情報マネージャー（PasswordVault）。Windows PowerShell 5.1 の子プロセスで読む
//   PHX_KEY_SOURCE=env   … 環境変数 PHX_AI_KEY（Windows 以外とテスト用）
// 読み出したキーはこのモジュールの中（メモリ）にだけ持つ。キーを標準出力・標準エラー・ツールの結果に出さない。
// キーは子プロセスのコマンドライン引数に載せない（プロセス一覧から見えるため）。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.mjs';

export const KEY_PATTERN = /^phxai\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/;
export const DEFAULT_VAULT_RESOURCE = 'phx-tameshigiri-ai';

const NO_KEY_MESSAGE = 'AI 用キーが設定されていません。運営画面（PC）の大会一覧の「AI 用キー」で発行し、' +
  'set-key.ps1 を自分のターミナル（Claude Code の外）で実行して保存してください。キーをチャットに貼らないでください。';

// Windows PowerShell 5.1 の場所。PowerShell 7（pwsh）は WinRT の型を直接読めないので使わない。
function windowsPowerShell() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const p = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(p) ? p : 'powershell.exe';
}

// 子プロセスに渡すスクリプト（秘密は含まない）。リソース名とユーザー名（ホスト名）は環境変数で渡す。
// 見つからない・読めないときは何も書かずに終了コード 3。
const VAULT_READ_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'try {',
  '  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '  [void][Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]',
  '  $v = New-Object Windows.Security.Credentials.PasswordVault',
  '  $c = $v.Retrieve($env:PHX_VAULT_Q_RESOURCE, $env:PHX_VAULT_Q_USER)',
  '  $c.RetrievePassword()',
  '  [Console]::Out.Write($c.Password)',
  '  exit 0',
  '} catch { exit 3 }'
].join('\n');

function encodePs(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

// 資格情報マネージャーから読む。戻り値: キーの文字列か null（無い・読めない）。
export function readVault(resource, user, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 15000;
  return new Promise(resolve => {
    let out = '';
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    let child;
    try {
      child = spawn(windowsPowerShell(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePs(VAULT_READ_SCRIPT)], {
          env: Object.assign({}, process.env, { PHX_VAULT_Q_RESOURCE: resource, PHX_VAULT_Q_USER: user }),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        });
    } catch (e) {
      return finish(null);
    }
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* 無視 */ } finish(null); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', () => { /* 子の標準エラーは捨てる（何も転送しない） */ });
    child.on('error', () => { clearTimeout(timer); finish(null); });
    child.on('close', code => {
      clearTimeout(timer);
      const v = out.trim();
      out = '';
      finish(code === 0 && v ? v : null);
    });
  });
}

// キーの置き場所。getKey() は最初の呼び出しで読み、成功したら覚えておく。
// 失敗（無い・形が違う）は覚えない（ユーザーが set-key.ps1 を実行したあと、再起動なしで読めるように）。
// サーバーが 401（無効・期限切れ・取り消し）を返したら forget() で忘れ、次の呼び出しで読み直す。
export function createKeyStore(config) {
  const source = config.source;
  let cached = null;
  const lastSeen = new Set();   // 伏せ字にする文字列（読んだことのあるキー）

  async function load() {
    if (source === 'env') return (process.env.PHX_AI_KEY || '').trim() || null;
    if (source === 'vault') return readVault(config.vaultResource, config.vaultUser);
    return null;
  }

  return {
    source,
    async getKey() {
      if (cached) return cached;
      const v = await load();
      if (v) lastSeen.add(v);
      if (!v || !KEY_PATTERN.test(v)) {
        throw new ToolError(v ? 'AI 用キーの形が違います。' + NO_KEY_MESSAGE : NO_KEY_MESSAGE, { status: null, reason: 'no_key' });
      }
      cached = v;
      return v;
    },
    forget() { cached = null; },
    // 文字列からキー（とその秘密の部分）を伏せる。念のための最後の守り（7.2）
    redact(text) {
      let s = String(text);
      const secrets = new Set();
      [...lastSeen].concat(cached ? [cached] : []).concat(process.env.PHX_AI_KEY ? [process.env.PHX_AI_KEY.trim()] : [])
        .forEach(k => {
          if (!k) return;
          secrets.add(k);
          const parts = k.split('.');
          if (parts.length === 3 && parts[2].length >= 16) secrets.add(parts[2]);
        });
      for (const k of secrets) {
        if (k.length >= 8) s = s.split(k).join('***');
      }
      return s;
    }
  };
}
