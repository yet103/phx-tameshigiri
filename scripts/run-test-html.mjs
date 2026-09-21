#!/usr/bin/env node
// test.html（ブラウザ用の単体テスト、1000件超）をヘッドレス Chrome で開き、
// 「Result: N passed, M failed」を読んで M が 0 以外なら終了コード 1 にする。
//
// 使い方:
//   node scripts/run-test-html.mjs [URL]
//   TEST_HTML_URL=http://localhost:3461/test.html node scripts/run-test-html.mjs
//
// 前提: サーバー（server/index.js）が起動済みで、test.html が上の URL で開けること。
// このスクリプト自身はサーバーを起動しない。

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const TARGET_URL = process.argv[2] || process.env.TEST_HTML_URL || 'http://localhost:3461/test.html';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9333);
const NAV_TIMEOUT_MS = 15000;
const RESULT_TIMEOUT_MS = 60000;

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await delay(200);
  }
  throw new Error('Chrome の CDP に接続できませんでした: ' + (lastErr ? lastErr.message : 'timeout'));
}

async function getFirstPageWsUrl(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page') || list[0];
  if (!page || !page.webSocketDebuggerUrl) {
    throw new Error('CDP のページターゲットが見つかりませんでした');
  }
  return page.webSocketDebuggerUrl;
}

function cdpClient(ws) {
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg.method, msg.params);
    }
  });
  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  function on(fn) {
    listeners.push(fn);
  }
  return { send, on };
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('Chrome/Chromium/Edge の実行ファイルが見つかりません。CHROME_PATH 環境変数で指定してください。');
    process.exit(1);
  }

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--remote-allow-origins=*',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let exitCode = 1;
  try {
    await waitForCdp(DEBUG_PORT, 10000);
    const wsUrl = await getFirstPageWsUrl(DEBUG_PORT);
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    const cdp = cdpClient(ws);
    await cdp.send('Page.enable');

    const loaded = new Promise((resolve) => {
      cdp.on((method) => {
        if (method === 'Page.loadEventFired') resolve();
      });
    });
    await cdp.send('Page.navigate', { url: TARGET_URL });
    await Promise.race([
      loaded,
      delay(NAV_TIMEOUT_MS).then(() => {
        throw new Error(`ページの読み込みが ${NAV_TIMEOUT_MS}ms 以内に終わりませんでした: ${TARGET_URL}`);
      }),
    ]);

    // test.html はページ読み込み後に非同期でテストを走らせ、
    // 最後に #results へ「Result: N passed, M failed」の行を足す。
    const deadline = Date.now() + RESULT_TIMEOUT_MS;
    let text = '';
    let match = null;
    while (Date.now() < deadline) {
      const evalResult = await cdp.send('Runtime.evaluate', {
        expression: 'document.getElementById("results") ? document.getElementById("results").innerText : ""',
        returnByValue: true,
      });
      text = (evalResult.result && evalResult.result.value) || '';
      match = text.match(/Result:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
      if (match) break;
      await delay(300);
    }

    if (!match) {
      console.error(`タイムアウト: ${RESULT_TIMEOUT_MS}ms 以内に「Result: N passed, M failed」が出ませんでした（${TARGET_URL}）。`);
      console.error('サーバーが起動しているか（server/index.js）、URL が正しいか確かめてください。');
      exitCode = 1;
    } else {
      const passedCount = Number(match[1]);
      const failedCount = Number(match[2]);
      console.log(`Result: ${passedCount} passed, ${failedCount} failed`);
      if (failedCount > 0) {
        const failLines = text.split('\n').filter((l) => l.startsWith('✗'));
        for (const line of failLines) console.log(line);
      }
      exitCode = failedCount === 0 ? 0 : 1;
    }
  } catch (err) {
    console.error('run-test-html: ' + err.message);
    exitCode = 1;
  } finally {
    chrome.kill();
  }
  process.exit(exitCode);
}

main();
