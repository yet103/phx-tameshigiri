# 観戦ダッシュボード（公開・QR）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 共有トークンで開く公開の観戦ダッシュボード（watch.html）と、まとめ API（ETag/304、5 秒ポーリング）、運営画面の「📱 観戦用 QR」を足す。

**Architecture:** サーバーに `GET /api/links/:token/watch` を 1 本（既存の `/live` と `computeRanking` を合成、`EventStatus.courtProgress` で確定 n/N）。公開ページ watch.html は api.js・courts.js・scoring.js だけで描き、5 秒ごとに `If-None-Match` 付きで読む。QR は desk-match.js から `DeskInvites.qrSvg` を使う。

**Tech Stack:** Express（server/index.js）、status.js（サーバーと画面で共有）、素の JS、test.html。

**設計書:** `docs/superpowers/specs/2026-10-09-watch-dashboard-design.md`

**実装者への注意:** いまのファイルを正とする。`git add` を使わず `git commit -m … -- <ファイル>`。`git reset` 禁止。開発サーバーは `PORT=3461 node server/index.js`。server/index.js・status.js・static-policy.js を変えたら再起動。新しい静的ファイル（watch.*）は配信の許可リストに載せないと 403/404 になる。

---

### Task 1: `EventStatus.courtProgress` とまとめ API

**Files:**
- Modify: `status.js`（`roundProgress` の近く）、`server/index.js`（`/api/links/:token/live` の直後）、`server/authz.js`（公開経路の表）
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

status.js の純粋関数（test.html の `EventStatus.roundProgress` のテストの近く）:

```js
    var cpP = [
      { id: 'a', order: 'A-男子-1-1', confirmed: true }, { id: 'b', order: 'A-男子-1-2' }, { id: 'c', order: 'B-女子-1-1', confirmed: true },
      { id: 'd', order: 'A-男子-2-1', confirmed: true, sourcePlayerId: 'a' }, { id: 'e', order: '', name: 'x' }
    ];
    assert('courtProgress: 一巡目はコートごとに 確定 / 行数。未分類（order 無し）は数えない',
      EventStatus.courtProgress(cpP, 1), { A: { done: 1, total: 2 }, B: { done: 1, total: 1 } });
    assert('courtProgress: 二巡目は二巡目の行だけ', EventStatus.courtProgress(cpP, 2), { A: { done: 1, total: 1 } });
    assert('courtProgress: 空', EventStatus.courtProgress([], 1), {});
    assert('courtProgress: 数える巡目（progressRoundOf）は draft=1, round1=1, round1_done=2, round2=2, round2_done は二巡目の行があれば 2',
      [EventStatus.progressRoundOf('draft', cpP), EventStatus.progressRoundOf('round1', cpP), EventStatus.progressRoundOf('round1_done', cpP),
       EventStatus.progressRoundOf('round2', cpP), EventStatus.progressRoundOf('round2_done', cpP), EventStatus.progressRoundOf('final', [cpP[0]])],
      [1, 1, 2, 2, 2, 1]);
```

API（`roEvent` などの API テストの近く。共有リンクは `Api.createShareLink`）:

```js
    var wEv = await Api.saveEvent({ name: 'テスト用 観戦', date: '2026-10-09', venue: '', players: [] });
    var wP1 = await Api.createPlayer(wEv.id, { name: '観戦 甲', court: 'A', isFemale: false, isNewFace: false, tech1: '真', tech2: '連', tech3: '左', round: 1, bib: 7, rank: '参段' });
    var wP2 = await Api.createPlayer(wEv.id, { name: '観戦 乙', court: 'B', isFemale: true, isNewFace: false, tech1: '真', tech2: '連', tech3: '左', round: 1 });
    await Api.changeStatus(wEv.id, 'round1');
    await Api.putLive(wEv.id, 'A', { playerId: wP1.id, timer: { sec: 250, running: true } });
    var wTok = (await Api.createShareLink(wEv.id)).token;
    var w1 = await Api.loadWatch(wTok, null);
    assert('watch: 200 で event / courts / ranking を返す', [w1.ok, w1.status, Object.keys(w1.data).sort()], [true, 200, ['courts', 'event', 'ranking']]);
    assert('watch: courts はコートの順で progress と live を持つ',
      w1.data.courts.map(function(c) { return [c.court, c.progress.round, c.progress.done, c.progress.total, c.live ? c.live.player.name : null]; }),
      [['A', 1, 0, 1, '観戦 甲'], ['B', 1, 0, 1, null]]);
    assert('watch: live.player に bib と rank が付く（/live には無い）', [w1.data.courts[0].live.player.bib, w1.data.courts[0].live.player.rank], [7, '参段']);
    assert('watch: ETag が付き、If-None-Match が一致すれば 304', (await Api.loadWatch(wTok, w1.etag)).status, 304);
    await Api.updatePlayer(wEv.id, wP1.id, { score: 20, result: '1    1    1    ', confirmed: true });
    var w2 = await Api.loadWatch(wTok, w1.etag);
    assert('watch: 採点を確定すると 200 と新しい ETag、progress が進む', [w2.status, w2.etag !== w1.etag, w2.data.courts[0].progress.done], [200, true, 1]);
    assert('watch: 不正なトークンは 400、無いトークンは 404', [(await Api.loadWatch('x', null)).status, (await Api.loadWatch('zzzzzzzz', null)).status], [400, 404]);
    await Api.deleteEvent(wEv.id);
```

`Api.putLive` の引数の形は api.js を見て合わせる（無ければ fetch で PUT）。`Api.loadWatch(token, etag)` は Task 2 で足す（このテストを先に書き、Task 1 の時点では `Api.loadWatch` の無い失敗で赤になる。Task 1 で api.js の `loadWatch` も一緒に足してよい）。

- [ ] **Step 2: 失敗を確かめる**（`EventStatus.courtProgress is not a function` など）

- [ ] **Step 3: status.js**

```js
  // コートごとの「確定 n / N」（観戦ダッシュボードの API と画面。設計書 2026-10-09 §2）。
  // round の行だけを数え、order の読めない行（コートが決まらない）は数えない。
  // 戻り値: { <コート>: { done, total } }（コートは order の先頭の段）
  function courtProgress(players, round) {
    var out = {};
    (players || []).forEach(function(p) {
      if (!p || roundOf(p) !== round) return;
      var m = String(p.order || '').match(ORDER_PATTERN);
      if (!m) return;
      var c = m[1];
      if (!Object.prototype.hasOwnProperty.call(out, c)) out[c] = { done: 0, total: 0 };
      out[c].total++;
      if (p.confirmed === true) out[c].done++;
    });
    return out;
  }

  // 「確定 n / N」で数える巡目（courts.js の progressRound と同じ規則。サーバーでも使うのでこちらに置く）
  //   進行中（round1 / round2）→ その巡目、draft → 1、round1_done → 2、
  //   round2_done / final / archived → 二巡目の行があれば 2、無ければ 1
  function progressRoundOf(status, players) {
    var r = scoringRound(status);
    if (r) return r;
    if (status === 'draft' || !status) return 1;
    if (status === 'round1_done') return 2;
    return (players || []).some(function(p) { return p && roundOf(p) === 2; }) ? 2 : 1;
  }
```

公開に `courtProgress: courtProgress, progressRoundOf: progressRoundOf,` を足す。`scoringRound` の戻り値（null か数値か）は実装を見て合わせる。

- [ ] **Step 4: サーバー**

`/api/links/:token/live` の直後に。トークン→大会の解決は `/live` のコードをそのまま使う（共通化してよい: `resolveLinkEvent(req, res)` が `{ event, eventPath }` か null を返し、エラー応答は中で出す）。

```js
// GET /api/links/:token/watch : 観戦ダッシュボード（公開）。コートごとの採点中の選手・確定 n/N・順位を 1 回で返す。
// ETag（本文の SHA-1）を付け、If-None-Match が一致すれば 304（設計書 2026-10-09 §2）。
app.get('/api/links/:token/watch', (req, res) => {
  try {
    const resolved = resolveLinkEvent(req, res);
    if (!resolved) return;
    const event = resolved.event;
    const players = Array.isArray(event.players) ? event.players : [];
    const status = EventStatus.of(event);
    const live = (event.live && typeof event.live === 'object') ? event.live : {};
    const round = EventStatus.progressRoundOf(status, players);
    const progress = EventStatus.courtProgress(players, round);
    const courtList = courtListFor(event);   // settings.courts ∪ 選手のコート（未分類を除く）。Courts.listFrom と同じ順
    const courts = courtList.map(court => {
      const entry = Object.prototype.hasOwnProperty.call(live, court) ? live[court] : null;
      const p = entry && entry.playerId ? players.filter(q => q && q.id === entry.playerId)[0] : null;
      const pr = Object.prototype.hasOwnProperty.call(progress, court) ? progress[court] : { done: 0, total: 0 };
      return {
        court,
        progress: { round, done: pr.done, total: pr.total },
        live: entry ? {
          updatedAt: entry.updatedAt || '',
          timer: { sec: Number.isInteger(entry.timer && entry.timer.sec) ? entry.timer.sec : DEFAULT_LIVE_TIMER.sec, running: !!(entry.timer && entry.timer.running) },
          player: p ? Object.assign(livePlayerView(p), { bib: Number.isInteger(p.bib) ? p.bib : null, rank: typeof p.rank === 'string' ? p.rank : '' }) : null
        } : null
      };
    });
    const body = {
      event: { name: event.name || '', date: event.date || '', status, updatedAt: event.updatedAt || '' },
      courts,
      ranking: computeRanking(event)
    };
    const json = JSON.stringify(body);
    const etag = 'W/"' + crypto.createHash('sha1').update(json).digest('hex') + '"';
    res.set('Cache-Control', 'no-cache');
    res.set('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('application/json').send(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

`livePlayerView(p)` は `/live` の player の組み立てを関数に切り出したもの（`/live` もそれを使う。形は変えない）。`courtListFor(event)` は settings.courts と選手の order の先頭の段の和集合を、courts.js の `Courts.listFrom` と同じ順（settings の順→残りは名前順、未分類は除く）で返す。`crypto` は `require('crypto')`（既に読んでいればそれ）。

`server/authz.js` の表に `{ method: 'GET', pattern: '/api/links/:token/watch', public: true }` を足す。

api.js:

```js
  async function loadWatch(token, etag) {
    // GET /api/links/:token/watch（観戦ダッシュボード。公開。設計書 2026-10-09）
    // etag を渡すと If-None-Match を付け、変化が無ければ status 304・data null で返る。
    // 戻り値: { ok, status, data, etag, serverDate }（serverDate は応答の Date ヘッダー。通信失敗は status 0）
    try {
      var headers = {};
      if (etag) headers['If-None-Match'] = etag;
      var res = await fetch('/api/links/' + encodeURIComponent(token) + '/watch', { headers: headers, cache: 'no-cache' });
      noteServerDate(res);
      var data = null;
      if (res.status === 200) data = await res.json();
      return { ok: res.status === 200 || res.status === 304, status: res.status, data: data,
               etag: res.headers.get('ETag') || etag || null, serverDate: res.headers.get('Date') || '' };
    } catch (e) {
      return { ok: false, status: 0, data: null, etag: etag || null, serverDate: '' };
    }
  }
```

公開に `loadWatch: loadWatch,`。`putLive` が無ければ同じ作法で足す（テスト用。`PUT /api/events/:id/live/:court`）。

- [ ] **Step 5: テストを通す**（サーバー再起動 → test.html。`npm test` も。invite.test の経路の網羅テストが authz の表の追加で通ることを確かめる）

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(api): 観戦ダッシュボードのまとめ API GET /api/links/:token/watch（ETag/304）、EventStatus.courtProgress（設計書 2026-10-09 §2）" -- status.js server/index.js server/authz.js api.js test.html
```

---

### Task 2: 公開ページ watch.html / watch.js / watch.css

**Files:**
- Create: `watch.html`、`watch.js`、`watch.css`
- Modify: `server/static-policy.js`（PUBLIC_FILES に 3 つ）
- Test: `test.html`（static-policy のテストがあればそこに public の assert、watch.js の純粋関数）

- [ ] **Step 1: static-policy のテストと純粋関数のテスト**

```js
    assert('static-policy: watch.* は公開', ['watch.html', 'watch.js', 'watch.css'].map(StaticPolicy.classify), ['public', 'public', 'public']);
```

（`StaticPolicy` の読み方・関数名は test.html の既存の static-policy のテストに合わせる。無ければ server 側のテスト `server/invite.test.js` の作法で足す。）

watch.js の純粋関数（`Watch.statusLabel`、`Watch.courtCardModel`）:

```js
    assert('Watch.statusLabel', ['draft', 'round1', 'round1_done', 'round2', 'round2_done', 'final', 'archived', ''].map(Watch.statusLabel),
      ['準備中', '一巡目 進行中', '二巡目準備', '二巡目 進行中', '二巡目終了', '最終結果', '最終結果', '']);
    var wcm = Watch.courtCardModel({ court: 'A', progress: { round: 1, done: 2, total: 5 }, live: { updatedAt: '2026-10-09T00:00:00Z', timer: { sec: 300, running: false },
      player: { name: '甲', order: 'A-男子-1-3', isFemale: false, bib: 7, rank: '参段', tech1: '真', tech2: '連', tech3: '左', result: '1    1    1    ', adjust: [0, 0, 0], totalAdjust: 0, score: 20, confirmed: false } } });
    assert('Watch.courtCardModel: 札の見出しと選手の帯', [wcm.title, wcm.progressText, wcm.stage, wcm.who],
      ['A コート', '確定 2 / 5', '男子の部　一巡目　A コート', 'No.7　甲　参段']);
    assert('Watch.courtCardModel: 待機中', Watch.courtCardModel({ court: 'B', progress: { round: 1, done: 0, total: 3 }, live: null }).who, '待機中');
```

- [ ] **Step 2: 失敗を確かめる**

- [ ] **Step 3: watch.html**

board.html を手本に（`<meta name="viewport">`、theme.css → watch.css、`api.js`・`courts.js`・`scoring.js`・`watch.js` の順）。本文:

```html
<header class="watch-head">
  <div class="watch-title"><span id="eventName">…</span> <span id="eventStatus" class="watch-status"></span></div>
  <div class="watch-tools"><span id="updatedAt" class="watch-updated"></span>
    <button type="button" id="btnFontDown">A-</button><button type="button" id="btnFontUp">A+</button><button type="button" id="btnTheme">🌙 ダーク</button></div>
</header>
<p id="notice" class="watch-notice" hidden></p>
<section id="courts" class="watch-courts"></section>
<p id="best4Line" class="watch-best4" hidden></p>
<section id="ranking" class="watch-ranking"></section>
```

- [ ] **Step 4: watch.js**

IIFE `Watch`（公開: `statusLabel`、`courtCardModel`、`init`）。

- `statusLabel(status)`: 表 `{ draft: '準備中', round1: '一巡目 進行中', round1_done: '二巡目準備', round2: '二巡目 進行中', round2_done: '二巡目終了', final: '最終結果', archived: '最終結果' }`、無ければ ''。
- `courtCardModel(c)`: `{ title: c.court + ' コート', progressText: '確定 ' + done + ' / ' + total, stage, who, rows, total, confirmed, timer }`。`stage` は order を `^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$` で読み「男子の部　一巡目　A コート」（混合は部なし。app.js の `updatePlayerLabels` と同じ）。`who` は `'No.' + bib + '　'`（bib が数値のときだけ）＋名前＋（rank があれば `'　' + Courts.rankLabel(rank)`）。live が無い／player が null なら `who: '待機中'`、rows 空。`rows` は board.js の `renderRows` と同じく `Scoring.decodeResult(result, techCount, adjust)` → 各技 `{ name, cells: [{ label: '成功'|'失敗'|'減点'|'未'|'無効'|'', points, cls }], score }`（Scoring.setTechniques は API に技得点表が無いので使えない → **技得点表は `/api/links/:token` か ranking には無い。board.js がどう配点を得ているか（`Board` が `/api/links/:token` の応答の techniques を使っているなら同じ）を確かめ、同じ経路で読む。無ければ API の応答に `techniques` を足す（Task 1 に戻って `body.techniques = event.techniques || null` を足し、設計書 §2 に追記）**。
- `init()`: ハッシュからトークン。無ければ notice に「このリンクは使えません」。`load(force)`: `Api.loadWatch(token, force ? null : etag)` → 200 なら `render(data)`、304 なら `updatedAt` だけ更新、404 なら notice、0 なら「読み込めませんでした。5 秒後にもう一度読みます」。`setInterval(load, 5000)` と `visibilitychange`（hidden で止め、visible で即 load）。タイマーは `Courts.liveRemaining(timer, updatedAt, Api.serverNowMs())` を毎秒描く（`setInterval` 1 本で全コート）。
- `render(data)`: 見出し（名前・状態）、コートの札（`courtCardModel` → DOM。同じコートで同じ選手なら札を作り直さず値だけ差し替える）、ベスト4 の行（`Courts.best4LineText(data.ranking.best4)`。無ければ hidden）、順位表（share.js に順位表を描く関数が公開されていればそれを使う。無ければ `Courts.rankPanel` を見て、app.js の採点画面の順位表（`rankPanelSection`）と同じ描き方を watch.js に書く。列は 順位・名前・合計（内訳を常に出す）・ベスト4、合計の色 class は ranking.js の規則（pending / r1 / done）と同じ）。
- 文字の大きさ: `document.documentElement.style.fontSize` を 90〜140% で段階的に。localStorage `watchFontPct`。ダークは board.js と同じ作法（`data-theme`）。

- [ ] **Step 5: watch.css**

board.css・share.css を手本に。`.watch-courts { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; }`、札は黒地に金の枠、技の表は board と同じ配色（成功 緑・失敗 赤・減点 黄・未 薄い）、タイマーは大きく。順位表は share.css の表に合わせる。スマホ幅（< 600px）は 1 列。

- [ ] **Step 6: static-policy**

`PUBLIC_FILES` に `'watch.html', 'watch.js', 'watch.css'`。

- [ ] **Step 7: ブラウザで確かめる**

テスト用の大会（systest テンプレート）を試合開始にし、採点画面で 1 人採点中にして共有リンクを発行、`watch.html#<token>` を別タブで開く。札に選手と技の表とタイマー、確定 n/N、順位表、採点を確定すると 5 秒以内に反映、裏に回すと通信が止まる（開発者ツールのネットワーク）、スマホ幅で 1 列。確認後に大会を消す。

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(watch): 観戦ダッシュボード watch.html（公開・閲覧専用・5 秒ごと ETag 付きで読み直し）（設計書 2026-10-09 §3）" -- watch.html watch.js watch.css server/static-policy.js test.html
```

---

### Task 3: 運営画面の「📱 観戦用 QR」

**Files:**
- Modify: `desk-invites.js`（`qrSvg` を公開）、`desk-match.js`（見出しのボタンとダイアログ）

- [ ] **Step 1: desk-invites.js** の公開オブジェクトに `qrSvg: qrSvg,` を足す。

- [ ] **Step 2: desk-match.js**

`buildHead` の「📊 ダッシュボード」の右:

```js
    var btnWatch = document.createElement('button');
    btnWatch.type = 'button';
    btnWatch.className = 'desk-btn';
    btnWatch.id = 'btnMatchWatchQr';
    btnWatch.textContent = '📱 観戦用 QR';
    btnWatch.title = '見るだけの観戦ダッシュボードの QR と URL を出します';
    btnWatch.addEventListener('click', function() { openWatchQr(btnWatch, ctx); });
    head.appendChild(btnWatch);
```

```js
  // 観戦用ダッシュボード（watch.html。公開・見るだけ）の QR と URL（設計書 2026-10-09 §4）。
  // 共有リンク（順位の共有・表彰・配信用ボードと同じトークン）を発行して使う。秘密ではないので写真で配ってよい
  async function openWatchQr(btn, ctx) {
    btn.disabled = true;
    try {
      var link = await Api.createShareLink(ctx.eventId);
      if (ctx.isStale()) return;
      if (!link || !link.token) {
        alert('共有リンクを作成できませんでした。通信を確認してください。');
        return;
      }
      var url = new URL('watch.html#' + link.token, location.href).href;
      var wrap = document.createElement('div');
      var note = document.createElement('p');
      note.className = 'desk-note';
      note.textContent = 'このページは見るだけです（採点中の選手・確定の進み具合・順位。5 秒ごとに更新）。' +
        '順位の共有リンクと同じ公開範囲なので、写真に撮って配って構いません。';
      wrap.appendChild(note);
      var qr = DeskInvites.qrSvg(url, 240);
      qr.classList.add('desk-watch-qr');
      wrap.appendChild(qr);
      var urlBox = document.createElement('p');
      urlBox.className = 'desk-watch-url';
      urlBox.textContent = url;
      wrap.appendChild(urlBox);
      var btnCopy = document.createElement('button');
      btnCopy.type = 'button';
      btnCopy.className = 'desk-btn primary';
      btnCopy.textContent = 'URL をコピー';
      btnCopy.addEventListener('click', function() { Desk.copyText(url, '観戦用の URL をコピーしました'); });
      var btnClose = document.createElement('button');
      btnClose.type = 'button';
      btnClose.className = 'desk-btn';
      btnClose.textContent = '閉じる';
      var dialog = Desk.openDialog('観戦用ダッシュボード（QR）', wrap, [btnCopy, btnClose]);
      btnClose.addEventListener('click', function() { dialog.close(); });
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }
```

`qrSvg(text, size)` の引数の形は desk-invites.js の実装に合わせる。desk.css に `.desk-watch-qr { display: block; margin: 8px auto; }`、`.desk-watch-url { word-break: break-all; font-size: 13px; text-align: center; }`。

- [ ] **Step 3: ブラウザで確かめる**（QR が出る、URL をコピーできる、QR を読むと watch.html が開く＝URL が正しい）

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desk-match): 「📱 観戦用 QR」（watch.html の QR と URL）（設計書 2026-10-09 §4）" -- desk-invites.js desk-match.js desk.css
```

---

### Task 4: ヘルプと実況資料

**Files:**
- Modify: `help.html`（配信用ボードの節の近くに「観戦用ダッシュボード」）、`docs/memo/2026-10-07-commentary-guide.html`（末尾に 1 段落）

- [ ] **Step 1: help.html**

```html
    <h3>観戦用ダッシュボード（QR）</h3>
    <p>試合進行の見出しの <span class="ui">📱 観戦用 QR</span> を押すと、見るだけの観戦ページ（<span class="ui">watch.html</span>）の QR と URL が出ます。観客や関係者のスマホ・タブレット・会場のモニターで開けます。採点中の選手と技ごとの結果、タイマー、各コートの <span class="ui">確定 n / N</span>、順位表（ベスト4 の可能性の列つき）、二巡目の間は <span class="msg">暫定ベスト4（合計）</span> が出て、5 秒ごとに自動で最新になります。押せるものは「ダーク」と文字の大きさだけで、採点や進行は変えられません。順位の共有リンクと同じ公開範囲なので、写真に撮って配って構いません（採点端末の招待の QR とは違います）。</p>
```

- [ ] **Step 2: 実況資料** の「7. 困ったとき」の前に:

```html
  <h2>8. 来場者・関係者に配るとき <small>観戦用ダッシュボード</small></h2>
  <p>運営画面の試合進行にある <span class="ui">📱 観戦用 QR</span> で、見るだけの観戦ページの QR が出ます。スマホで読むと、この資料で説明した「採点の面」「確定 n / N」「順位」「暫定ベスト4」が 1 ページにまとまって出て、5 秒ごとに最新になります。実況席の予備の端末にもこれを出しておけます。</p>
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: 観戦用ダッシュボードの説明（ヘルプ・実況資料）（設計書 2026-10-09 §7）" -- help.html docs/memo/2026-10-07-commentary-guide.html
```

---

### Task 5: 全体の確認

- `npm test`、`npm run test:browser`（0 failed）。
- 負荷の確認: scratchpad の load.mjs の URL に `/api/links/<token>/watch` を足して 50 並列 10 秒（エラー 0・p95 100ms 以下を目安）。304 の経路も `If-None-Match` を付けて叩く。
- Opus レビュー（仕様準拠＋品質を 1 回）。
- master に ff マージ、origin/master と origin/production へ push。
