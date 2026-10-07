# 男女を分けずに進める大会（混合）と出走番号の非表示 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 大会の設定 `settings.mixed` で男女を分けずに進められるようにし（order の性別の段を `混合`、コート×巡目で通し番号）、出走番号を全画面から消す。

**Architecture:** order 書式 `コート-(男子|女子|混合)-巡目-番号` をサーバー・status.js・courts.js・app.js・board.js・MCP ツールで揃える。性別の段はサーバーの `genderSeg(event, isFemale)` だけが決める。設定の切り替え（準備中だけ）で `renumberForMixed` が全行を振り直す。画面は番号を出さず、混合では帯・カードを性別で分けない。

**Tech Stack:** Node + Express（server/index.js、CommonJS）、素の JS（IIFE）、test.html（ブラウザの単体テスト。`npm run test:browser` はサーバー起動が前提）、`npm test`（Node のテスト 3 本）。

**設計書:** `docs/superpowers/specs/2026-10-07-mixed-gender-flow-design.md`

**実装者への注意（このリポジトリの規約）:**
- 計画のコード断片は書いた時点のもの。**いまのファイルを正とし**、断片は意図の説明として読む。
- 同じツリーで並行するときは `git add` を使わず `git commit -m … -- <ファイル>`（pathspec）で commit する。`git reset` は禁止。
- 開発サーバーは `node server/index.js`（ポート 3461）。test.html は `http://localhost:3461/test.html` を開くか `npm run test:browser`。新しい JS を足したときは開発サーバーの再起動が要るが、今回は既存ファイルの編集だけ。
- test.html の API テストは実際のサーバーに大会を作って消す。大会名は「テスト用 …」か既存の命名に倣う。
- ブラウザで確認するときは編集ごとに新しいタブを開く（bfcache で古い JS が残る）。

---

## ファイルの責務

| ファイル | 変更 |
|---|---|
| `server/index.js` | ORDER_PATTERN に `混合`、`genderSeg`、`buildOrder`/`nextOrderNumber` の引数を「性別の段」に、settings.mixed の保存・写し、`renumberForMixed`、切り替えの draft ガード、並べ替え・二巡目生成の混合対応 |
| `status.js` | ORDER_PATTERN に `混合` |
| `courts.js` | `roundOf`/`orderKey` の正規表現、`isMixedOrder` |
| `app.js` | 帯の見出し、番号の非表示、一覧の「順番」列の削除、混合の帯 |
| `board.js` | 番号の非表示、混合の表示 |
| `desk-match.js` | 混合の組、カードの「順番」列の削除 |
| `desk-players.js` | No. 列の削除、「巡」で試技順、混合の帯、性別の編集、下書き行、ドラッグ |
| `desk-setup.js`・`admin.js` | 「男女を分けずに進める（混合）」のチェック |
| `api.js` | コメントだけ（settings のキー、reorder の isFemale） |
| `tools/mcp/phx-tameshigiri/tools.mjs` | ORDER_PATTERN に `混合` |
| `help.html` | 設定の一節、No. の記述の削除 |
| `test.html` | 純粋関数と API のテスト |

Task 1〜3 はサーバー（同じファイルなので 1 人が順に）。Task 4 は courts.js（Task 2 のテストが `Courts.compareOrder` で混合を読むので、**Task 1 → Task 4 → Task 2 → Task 3** の順）。Task 5〜9 は画面ごとにファイルが分かれるので並行できる。Task 10 はヘルプ。Task 11 は全体の確認。

---

### Task 1: サーバー: order の性別の段と settings.mixed

**Files:**
- Modify: `server/index.js`（222 付近 ORDER_PATTERN、299 buildOrder、287 nextOrderNumber、呼び出し 10 か所、settings を書く 5 か所）
- Modify: `status.js:74`
- Test: `test.html`（API テスト。`settingsテスト` の近く 496 付近）

- [ ] **Step 1: 失敗するテストを書く（test.html の API テスト）**

`var stEvent = …` の settings テストの直後に足す。既存の完全一致の assert（`{ requireBib: …, requireRank: …, courts: [] }`）には **`mixed: false` を足す**（test.html 内で `requireRank:` を grep し、settings オブジェクトの完全一致をしている箇所すべて。バンドルの書き出し・コピー・テンプレートのテストも含む）。

```js
    // 混合（settings.mixed。設計書 2026-10-07）
    var mxRes = await Api.updateEventInfo(stEvent.id, { settings: { mixed: true } });
    assert('PATCH: settings.mixed を保存する', mxRes.event.settings.mixed, true);
    var mxP1 = await Api.createPlayer(stEvent.id, { name: '混合 男', court: 'A', isFemale: false, isNewFace: false, tech1: '', tech2: '', tech3: '', round: 1 });
    var mxP2 = await Api.createPlayer(stEvent.id, { name: '混合 女', court: 'A', isFemale: true, isNewFace: false, tech1: '', tech2: '', tech3: '', round: 1 });
    assert('混合: 追加した選手の order は コート-混合-巡目-番号 で男女通し', [mxP1.order, mxP2.order], ['A-混合-1-1', 'A-混合-1-2']);
    assert('混合: isFemale は行に残る', [mxP1.isFemale, mxP2.isFemale], [false, true]);
    var mxSex = await Api.updatePlayerInfo(stEvent.id, mxP1.id, { isFemale: true });
    assert('混合: 性別を変えても order は変わらない', mxSex.player.order, 'A-混合-1-1');
```

`Api.updatePlayerInfo` の戻り値の形（`{ ok, player }` か）は api.js の該当関数のコメントを見て合わせる。

- [ ] **Step 2: テストが失敗することを確かめる**

開発サーバーを起動し `http://localhost:3461/test.html` を開く（または `npm run test:browser`）。期待: 「混合: 追加した選手の order は …」が `A-男子-1-1` で失敗。

- [ ] **Step 3: ORDER_PATTERN と genderSeg・buildOrder・nextOrderNumber**

`server/index.js` 222 付近:

```js
const ORDER_PATTERN = /^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/;
```

`parseOrder` の戻り値 `gender` はそのまま（`'男子' | '女子' | '混合'`）。

```js
// 大会の設定 settings.mixed（男女を分けずに進める。設計書 2026-10-07）。
function isMixedEvent(event) {
  return !!(event && event.settings && typeof event.settings === 'object' && event.settings.mixed === true);
}

// order の性別の段。混合の大会は '混合'（男女を区別せず コート×巡目 で通し番号）、
// そうでなければ行の性別。性別の段を決めるのはこの関数だけ。
function genderSeg(event, isFemale) {
  return isMixedEvent(event) ? '混合' : (isFemale === true ? '女子' : '男子');
}

// 同一の コート×性別の段×巡目 における次の番号。該当が無ければ 1。
function nextOrderNumber(players, court, seg, round) {
  let max = 0;
  (players || []).forEach(p => {
    const parsed = parseOrder((p && p.order) || '');
    if (!parsed) return;
    if (parsed.court !== court || parsed.gender !== seg || parsed.round !== round) return;
    if (parsed.number > max) max = parsed.number;
  });
  return max + 1;
}

// order 文字列を組み立てる。seg は genderSeg の戻り値。
function buildOrder(court, seg, round, n) {
  return court + '-' + seg + '-' + round + '-' + n;
}
```

- [ ] **Step 4: 呼び出し 10 か所を genderSeg に通す**

`grep -n "buildOrder(\|nextOrderNumber(" server/index.js` で全部を見る。それぞれ `const gender = isFemale ? '女子' : '男子';` を `const seg = genderSeg(event, isFemale);` に、`buildOrder(court, isFemale, …)` を `buildOrder(court, seg, …)` に。

- 選手の追加（2046 付近）: `const seg = genderSeg(event, isFemale); const n = nextOrderNumber(event.players, court, seg, round); … order: buildOrder(court, seg, round, n)`
- 一括登録（2345 付近）: `const seg = genderSeg(event, row.isFemale); const key = bulkOrderKey(row.court, seg); … nextOrderNumber(event.players, row.court, seg, 1) … buildOrder(row.court, seg, 1, n)`。混合では男女が同じ key になり通し番号になる。
- names 形式（2427 付近）: 同様。
- 並べ替え（2500 付近）: Task 3 で扱う（ここでは `const seg = genderSeg(event, body.isFemale === true)` にし、比較を `parsed.gender !== seg`、`buildOrder(court, seg, round, i + 1)` に）。
- 選手の更新（2798 付近）: `const seg = genderSeg(event, player.isFemale === true);` `changed = cur.court !== court || cur.gender !== seg || cur.round !== round`、`buildOrder(court, seg, round, nextOrderNumber(others, court, seg, round))`。
- 一巡目から二巡目への伝播（2848 付近）: `const seg = genderSeg(event, p.isFemale); if (parsed.gender !== seg) { … buildOrder(parsed.court, seg, parsed.round, nextOrderNumber(others, parsed.court, seg, parsed.round)) }`。混合では `parsed.gender === '混合' === seg` なので入らない（性別を変えても order は変わらない）。
- CSV 取り込み（3128 付近）: `const seg = genderSeg(event, isFemale);`。
- テンプレート（1750〜1763）: テンプレートは常に分ける大会（mixed: false）。`buildOrder(court, label, 1, numberInCourt[court][label])`（label は '男子'/'女子' なのでそのまま段になる）。
- 二巡目生成 `buildRound2Row`（3862 付近）と `reorderRound2` の `place`（3993 付近）: Task 3 で扱う。ここでは引数 `event` を足して `genderSeg(event, isFemale)` を使うところまで。

- [ ] **Step 5: settings.mixed を書く 5 か所**

- POST /api/events（1473 付近）: `event.settings = { requireBib: …, requireRank: …, mixed: s.mixed === true, courts: … }`
- PATCH /api/events/:id（1552 付近）: `const mixed = s.mixed !== undefined ? s.mixed === true : cur.mixed === true;` … `event.settings = { requireBib, requireRank, mixed, courts }`（切り替え時の振り直しは Task 2）
- コピー（1687 付近）: `mixed: src.settings.mixed === true,`
- テンプレート（1806 付近）: `mixed: false,`
- バンドル書き出し（3633 付近）と取り込み（3770 付近）: `mixed: … === true,`

- [ ] **Step 6: status.js の ORDER_PATTERN**

`status.js:74`: `var ORDER_PATTERN = /^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/;`

- [ ] **Step 7: テストが通ることを確かめる**

開発サーバーを再起動（server/index.js と status.js を変えたため）。test.html を開き直し、Step 1 の assert と、`mixed: false` を足した既存の assert が通ること。`npm test` も通ること（期待: 23 passed 相当。失敗が出たら settings の形を見ている箇所）。

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(server): order の性別の段に「混合」、settings.mixed、genderSeg（設計書 2026-10-07 §2・§3）" -- server/index.js status.js test.html
```

---

### Task 2: サーバー: 切り替え時の振り直しと準備中だけのガード

**Files:**
- Modify: `server/index.js`（PATCH /api/events/:id の settings、`nextOrderNumber` の下に `renumberForMixed`）
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

Task 1 の混合テストの続きに足す（stEvent は mixed: true、A に 2 名）。

```js
    // 切り替えの振り直し（設計書 2026-10-07 §3）。分ける大会に戻すと男女それぞれ 1 から
    var mxOff = await Api.updateEventInfo(stEvent.id, { settings: { mixed: false } });
    assert('混合 → 分ける: 全行を男女それぞれ 1 から振り直す',
      (await Api.loadEvent(stEvent.id)).players.map(function(p) { return p.order; }).sort(),
      ['A-女子-1-1', 'A-女子-1-2']);   // mxP1 は Step 1 で女子に変えた
    var mxP3 = await Api.createPlayer(stEvent.id, { name: '混合 男2', court: 'A', isFemale: false, isNewFace: false, tech1: '', tech2: '', tech3: '', round: 1 });
    var mxOn = await Api.updateEventInfo(stEvent.id, { settings: { mixed: true } });
    assert('分ける → 混合: 今の並び（男子 → 女子、番号順）のまま通し番号',
      (await Api.loadEvent(stEvent.id)).players.slice().sort(Courts.compareOrder).map(function(p) { return p.order + ':' + p.name; }),
      ['A-混合-1-1:混合 男2', 'A-混合-1-2:混合 男', 'A-混合-1-3:混合 女']);
    // 試合開始の後は変えられない
    await Api.changeStatus(stEvent.id, 'round1');
    var mxLocked = await Api.updateEventInfo(stEvent.id, { settings: { mixed: false } });
    assert('試合開始の後は mixed を変えられない（409 mixed_locked）', [mxLocked.ok, mxLocked.reason], [false, 'mixed_locked']);
    assert('409 のとき settings は変わらない', (await Api.loadEvent(stEvent.id)).settings.mixed, true);
    await Api.changeStatus(stEvent.id, 'draft');
    var mxSame = await Api.updateEventInfo(stEvent.id, { settings: { mixed: true, requireBib: true } });
    assert('mixed が変わらない PATCH は振り直さない', (await Api.loadEvent(stEvent.id)).players.slice().sort(Courts.compareOrder).map(function(p) { return p.order; }), ['A-混合-1-1', 'A-混合-1-2', 'A-混合-1-3']);
```

`Api.changeStatus` の引数の形は api.js を見て合わせる（`changeStatus(eventId, status)` か `changeStatus(eventId, { status })`）。`Courts.compareOrder` が `混合` を読めるのは Task 4 の後なので、Task 4 を先に済ませるか、この assert だけ Task 4 の後で確かめる。

- [ ] **Step 2: テストが失敗することを確かめる**

期待: 「混合 → 分ける: …」が `A-混合-…` のままで失敗。

- [ ] **Step 3: renumberForMixed と PATCH のガード**

`nextOrderNumber` の下に:

```js
// settings.mixed の切り替えで全行の order を振り直す（設計書 2026-10-07 §3）。
// 今の並び（巡目 → コート → 男子 → 女子 → 番号。混合の行は性別の段が同じなので番号順）を保ったまま、
//   mixed … コート×巡目 ごとに 1 から通し番号。性別の段は '混合'
//   分ける … コート×巡目×性別 ごとに 1 から。性別の段は行の isFemale から
// order が読めない行（CSV 由来の空 order など）は触らない。rev は上げない（得点・技は変わらない）。
function renumberForMixed(event, mixed) {
  const players = Array.isArray(event.players) ? event.players : [];
  const rows = [];
  players.forEach(p => {
    const o = parseOrder((p && p.order) || '');
    if (o) rows.push({ p: p, o: o });
  });
  rows.sort((a, b) => {
    if (a.o.round !== b.o.round) return a.o.round - b.o.round;
    if (a.o.court !== b.o.court) return a.o.court < b.o.court ? -1 : 1;
    const ga = a.o.gender === '女子' ? 1 : 0;
    const gb = b.o.gender === '女子' ? 1 : 0;
    if (ga !== gb) return ga - gb;
    return a.o.number - b.o.number;
  });
  const next = Object.create(null);
  rows.forEach(x => {
    const seg = mixed ? '混合' : (x.p.isFemale === true ? '女子' : '男子');
    const key = x.o.court + '\n' + seg + '\n' + x.o.round;
    next[key] = (next[key] || 0) + 1;
    x.p.order = buildOrder(x.o.court, seg, x.o.round, next[key]);
  });
}
```

PATCH /api/events/:id の settings の中（`requireRank` を決めた直後）:

```js
      const mixed = s.mixed !== undefined ? s.mixed === true : cur.mixed === true;
      if (mixed !== (cur.mixed === true)) {
        // 男女の分け方は準備中だけ変えられる（採点画面の巡回が order の並びに乗っているため。設計書 2026-10-07 §1）
        const st = EventStatus.of(event);
        if (st !== 'draft') {
          return res.status(409).json({
            error: '試合開始の後は男女の分け方を変えられません',
            reason: 'mixed_locked',
            status: st
          });
        }
        renumberForMixed(event, mixed);
      }
      event.settings = { requireBib: requireBib, requireRank: requireRank, mixed: mixed, courts: courts };
```

`EventStatus.of(event)` の戻り値が `'draft'` の文字列であることは status.js の `STATES` で確認済み。

- [ ] **Step 4: テストが通ることを確かめる**

サーバー再起動 → test.html。期待: Step 1 の assert が全部通る。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): 混合の切り替えで出走順を振り直す。準備中だけ変更可（409 mixed_locked）（設計書 2026-10-07 §3）" -- server/index.js test.html
```

---

### Task 3: サーバー: 並べ替え・二巡目生成の混合対応

**Files:**
- Modify: `server/index.js`（並べ替え 2470〜2520、`compareForRound2` 3846、`buildRound2Row` 3860、`generateRound2` 3960 付近、`reorderRound2` 3980〜4000）
- Test: `test.html`

- [ ] **Step 1: 失敗するテストを書く**

Task 2 の続き（stEvent は mixed、draft、A に 男2・男・女 の 3 名）。

```js
    // 並べ替え: 混合では コート×巡目 の全員を 1 組として受ける（isFemale は見ない）
    var mxAll = (await Api.loadEvent(stEvent.id)).players.slice().sort(Courts.compareOrder);
    var mxReo = await Api.reorderPlayers(stEvent.id, { court: 'A', isFemale: false, round: 1, ids: [mxAll[2].id, mxAll[0].id, mxAll[1].id] });
    assert('混合: 並べ替えは男女通しの組で通る', mxReo.ok, true);
    assert('混合: 並べ替えの結果',
      mxReo.players.slice().sort(Courts.compareOrder).map(function(p) { return p.order + ':' + p.name; }),
      ['A-混合-1-1:混合 女', 'A-混合-1-2:混合 男2', 'A-混合-1-3:混合 男']);
    // 二巡目: 女子が先ではなく、一巡目の確定得点が低い順を男女通しで
    await Api.changeStatus(stEvent.id, 'round1');
    var mxNow = (await Api.loadEvent(stEvent.id)).players;
    async function mxScore(p, score) {
      // 得点を確定する既存の補助（このファイルの他の API テストが使っているもの）に合わせる。
      // 例: await Api.updatePlayer(stEvent.id, p.id, { score: score, result: '1', confirmed: true, … })
    }
    await mxScore(mxNow[0], 30);   // 女
    await mxScore(mxNow[1], 10);   // 男2
    await mxScore(mxNow[2], 20);   // 男
    var mxDone = await Api.changeStatus(stEvent.id, 'round1_done');
    assert('混合: 二巡目は一巡目の得点が低い順を男女通しで',
      (await Api.loadEvent(stEvent.id)).players.filter(function(p) { return Courts.roundOf(p) === 2; })
        .sort(Courts.compareOrder).map(function(p) { return p.order + ':' + p.name; }),
      ['A-混合-2-1:混合 男2', 'A-混合-2-2:混合 男', 'A-混合-2-3:混合 女']);
    await Api.deleteEvent(stEvent.id);
```

`mxScore` は test.html の既存テスト（「一巡目を終了すると … 二巡目を生成する」付近 60 行目のコメントが指す補助）で得点を確定している書き方をそのまま使う。

- [ ] **Step 2: テストが失敗することを確かめる**

期待: 「混合: 並べ替えは男女通しの組で通る」が `reorder_mismatch` で失敗（組の判定が '男子' のため）。

- [ ] **Step 3: 並べ替え**

2500 付近:

```js
    // この組の行（order の コート・性別の段・巡目 が一致するもの）を id で引けるようにする。
    // 混合の大会では性別の段が '混合' なので、body.isFemale は見ない（コート×巡目の全員が 1 組）。
    const seg = genderSeg(event, body.isFemale === true);
    const byId = Object.create(null);
    event.players.forEach(p => {
      const parsed = parseOrder((p && p.order) || '');
      if (!parsed) return;
      if (parsed.court !== court || parsed.gender !== seg || parsed.round !== round) return;
      byId[p.id] = p;
    });
    …
    ids.forEach((id, i) => {
      byId[id].order = buildOrder(court, seg, round, i + 1);
    });
```

- [ ] **Step 4: 二巡目の並びと行の生成**

```js
// 二巡目の並び。分ける大会: 女子が先、その中で一巡目の確定得点が低い順、同点は一巡目の試技順。
// 混合の大会（設計書 2026-10-07 §4）: 男女を通して一巡目の確定得点が低い順、同点は一巡目の試技順。
function round2Comparator(mixed) {
  return function(a, b) {
    if (!mixed) {
      const fa = a.isFemale === true ? 0 : 1;
      const fb = b.isFemale === true ? 0 : 1;
      if (fa !== fb) return fa - fb;
    }
    if (scoreOf(a) !== scoreOf(b)) return scoreOf(a) - scoreOf(b);
    return compareRound1Order(a, b);
  };
}
```

`compareForRound2` を使っている 2 か所（`generateRound2` の `targets.slice().sort(compareForRound2)`、`reorderRound2` の `src.slice().sort(compareForRound2)`）を `.sort(round2Comparator(isMixedEvent(event)))` にし、`compareForRound2` は消す。

`buildRound2Row(players, newRows, p, court, isFemale)` → `buildRound2Row(event, players, newRows, p, court, isFemale)`。中は `const seg = genderSeg(event, isFemale); const n = nextOrderNumber(players.concat(newRows), court, seg, 2); … order: buildOrder(court, seg, 2, n)`。呼び出し（generateRound2）に `event` を足す。

`reorderRound2` の `place` の中: `order: buildOrder(court, seg, 2, nextOrderNumber(base.concat(newRows), court, seg, 2))`（`const seg = genderSeg(event, isFemale);` を先に）。`place` の新規行の分岐（old が無いとき `buildRound2Row` を呼んでいるなら `event` を足す）。

`compareRound1Order` の `x.gender !== y.gender` は混合では同じ段なので効かない。そのまま。

- [ ] **Step 5: テストが通ることを確かめる**

サーバー再起動 → test.html。期待: Task 1〜3 の assert が通り、既存の二巡目のテスト（「女子が先」の分ける大会）も通る。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(server): 混合の並べ替えと二巡目生成（男女通しの組・得点の低い順）（設計書 2026-10-07 §4）" -- server/index.js test.html
```

---

### Task 4: クライアントの純粋関数: courts.js・MCP ツール

**Files:**
- Modify: `courts.js:67`（roundOf）、`courts.js:92`（orderKey）、`sexOf` の近くに `isMixedOrder`、末尾の公開
- Modify: `tools/mcp/phx-tameshigiri/tools.mjs:9`
- Test: `test.html`（`compareOrder:` のテスト 4642 付近、`reorderGroupKey` 3520 付近）

- [ ] **Step 1: 失敗するテストを書く**

`compareOrder: 番号は数値順` の assert の近くに:

```js
    assert('roundOf: 混合の order も巡目を読む', Courts.roundOf({ order: 'B-混合-2-7' }), 2);
    assert('orderKey: 混合は sex 0・番号を読む', Courts.orderKey({ order: 'B-混合-2-7' }), { court: 'B', sex: 0, round: 2, no: 7 });
    assert('compareOrder: 混合は番号順（男女は見ない）',
      [{ order: 'A-混合-1-2', isFemale: true }, { order: 'A-混合-1-10', isFemale: false }, { order: 'A-混合-1-1', isFemale: false }]
        .sort(Courts.compareOrder).map(function(p) { return p.order; }),
      ['A-混合-1-1', 'A-混合-1-2', 'A-混合-1-10']);
    assert('reorderGroupKey: 混合は コート×巡目 で 1 組（男女で分かれない）',
      [Courts.reorderGroupKey({ order: 'A-混合-1-1', isFemale: false }), Courts.reorderGroupKey({ order: 'A-混合-1-2', isFemale: true })],
      ['A|0|1', 'A|0|1']);
    assert('sexOf: 混合の order では行の isFemale から', [Courts.sexOf({ order: 'A-混合-1-1', isFemale: true }), Courts.sexOf({ order: 'A-混合-1-1' })], ['女子', '男子']);
    assert('isMixedOrder', [Courts.isMixedOrder({ order: 'A-混合-1-1' }), Courts.isMixedOrder({ order: 'A-男子-1-1' }), Courts.isMixedOrder({})], [true, false, false]);
```

- [ ] **Step 2: テストが失敗することを確かめる**

期待: `roundOf` が 1、`orderKey` が `{ court:'B', sex:2, round:1, no:0 }`、`isMixedOrder` が未定義で失敗。

- [ ] **Step 3: courts.js**

```js
  function roundOf(player) {
    var order = (player && typeof player.order === 'string') ? player.order : '';
    var m = order.match(/^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/);
    return m ? parseInt(m[3], 10) : 1;
  }
  …
  // 行の並び順。… 巡目 → コート → 性別（男子が先。混合は全行 0 なので効かない）→ 番号 に分解して比べる。
  function orderKey(p) {
    var m = String((p && p.order) || '').match(/^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/);
    if (!m) return { court: courtOf(p), sex: 2, round: roundOf(p), no: 0 };
    return {
      court: m[1],
      sex: m[2] === '女子' ? 1 : 0,
      round: parseInt(m[3], 10),
      no: parseInt(m[4], 10)
    };
  }
  …
  // 混合の大会の行か（order の性別の段が '混合'。設計書 2026-10-07 §2）。
  // 採点画面・配信ボードは大会の settings を持たないので order から判定する。
  function isMixedOrder(p) {
    return /^[^-]+-混合-/.test(String((p && p.order) || ''));
  }
```

`sexOf` は変えない（`(男子|女子)` に当たらず isFemale に落ちる）。末尾の公開オブジェクトに `isMixedOrder: isMixedOrder,` を足す。

- [ ] **Step 4: MCP ツール**

`tools/mcp/phx-tameshigiri/tools.mjs:9`: `const ORDER_PATTERN = /^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/;`。`tools/mcp/phx-tameshigiri/test.mjs` があれば `node tools/mcp/phx-tameshigiri/test.mjs` で通ることを確かめる（通し方は同ディレクトリの README か package.json）。

- [ ] **Step 5: テストが通ることを確かめる**

test.html を開き直し（JS の再読み込み。新しいタブで）、Step 1 の assert が通ること。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(courts): order の「混合」を読む（roundOf / orderKey / isMixedOrder）（設計書 2026-10-07 §2）" -- courts.js tools/mcp/phx-tameshigiri/tools.mjs test.html
```

---

### Task 5: 基本情報の設定: 「男女を分けずに進める（混合）」

**Files:**
- Modify: `desk-setup.js`（105〜110 のチェック、135〜140 の locked、155〜160 の settingsPatch）
- Modify: `admin.js`（536〜540、590〜592、720〜722）
- Modify: `api.js:102` コメント

- [ ] **Step 1: desk-setup.js**

```js
    var origMixed = settings.mixed === true;
    var chkBib = addCheck(form, 'ゼッケン番号を必須にする', settings.requireBib === true);
    var chkRank = addCheck(form, '級位・段位を必須にする', settings.requireRank === true);
    // 男女を分けずに進める（混合。設計書 2026-10-07）。準備中だけ変えられる
    var chkMixed = addCheck(form, '男女を分けずに進める（混合）', origMixed);
    var isDraft = EventStatus.of(ctx.event) === 'draft';
    chkMixed.disabled = !isDraft;
```

`reqNote` の下に:

```js
    var mixedNote = document.createElement('p');
    mixedNote.className = 'desk-note';
    mixedNote.textContent =
      '「男女を分けずに進める（混合）」を入れると、試合進行・選手登録・採点画面の一覧で男子の部・女子の部に分けず、' +
      '出走順はコートごとに男女通しになります（順位の部門は変わりません）。試合開始の後は変えられません。';
    container.appendChild(mixedNote);
```

`if (locked) { … }` に `chkMixed.disabled = true;` を足す。

`saveInfo` の settingsPatch:

```js
      if (chkMixed.checked !== origMixed) {
        var n = (ctx.players || []).length;
        if (n > 0) {
          var mixedMsg = chkMixed.checked
            ? '出走順を男女通しに振り直します。並びは今のまま（男子 → 女子）です。よろしいですか？'
            : '出走順を男女それぞれで振り直します。並びは今のままです。よろしいですか？';
          if (!confirm(mixedMsg)) return;
        }
        settingsPatch.mixed = chkMixed.checked;
      }
```

（`btn.disabled = true` より前に置く。confirm で止めたらボタンは触らない。）

失敗時の分岐に `mixed_locked` を足す:

```js
        if (result && result.reason === 'locked') {
          alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        } else if (result && result.reason === 'mixed_locked') {
          alert('試合開始の後は男女の分け方を変えられません。');
        } else {
```

`ctx.players` が無ければ `ctx.event.players` を見る（desk.js の ctx の形に合わせる）。

- [ ] **Step 2: admin.js（スマホ運営の基本情報）**

同じ 3 点（`origMixed`・`chkMixed`（`EventStatus.of(ev) === 'draft'` でなければ disabled）・settingsPatch と confirm・`mixed_locked` の alert）。admin.js の addCheck は引数が `(label, checked)` なので `var chkMixed = addCheck('男女を分けずに進める（混合）', origMixed);`。注記は `field-note` で reqNote の下に同じ文。

- [ ] **Step 3: api.js のコメント**

`updateEventInfo` のコメント `settings は { requireBib, requireRank, courts }` → `{ requireBib, requireRank, mixed, courts }`。`reorderPlayers` のコメントに「混合の大会では isFemale は無視される（コート×巡目の全員が 1 組）」を足す。

- [ ] **Step 4: ブラウザで確かめる**

開発サーバーで PC 運営の基本情報を開き、チェックを入れて保存 → confirm → トースト「基本情報を保存しました」。試合開始の後に開くとチェックが無効。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 基本情報に「男女を分けずに進める（混合）」（準備中だけ。設計書 2026-10-07 §3）" -- desk-setup.js admin.js api.js
```

---

### Task 6: 試合進行: 混合の組とカードの「順番」列

**Files:**
- Modify: `desk-match.js`（562〜568、599〜603、749〜770）

- [ ] **Step 1: 組の列挙**

```js
    // 分ける大会: 男子の部・女子の部でカードの組を分ける（0 名の部は出さない）。見出しは「男子の部 一巡目」。
    // 混合の大会（settings.mixed。設計書 2026-10-07 §5）: 巡目ごとに 1 組（見出しは「一巡目」）。
    var groups = [];
    divisionsOf(ctx).forEach(function(g) {
      var cards = courtCards(ctx, round, g[0]);
      if (cards.some(function(r) { return r.total > 0; })) {
        groups.push({ caption: (g[1] ? g[1] + ' ' : '') + roundLabel, rows: cards, female: g[0] });
      }
    });
```

`appendRound1Results` も同じく `divisionsOf(ctx)` で、caption は `(g[1] ? g[1] + ' ' : '') + '一巡目'`。

```js
  // カードの組。分ける大会は [性別, 部の名前] の 2 組、混合は性別で絞らない 1 組（female は undefined）
  function divisionsOf(ctx) {
    var mixed = !!(ctx.event && ctx.event.settings && ctx.event.settings.mixed === true);
    return mixed ? [[undefined, '']] : [[false, '男子の部'], [true, '女子の部']];
  }
```

`courtCards(ctx, round, undefined)` は `typeof female === 'boolean'` が偽なので性別で絞らず `row.female` も付けない（既存の挙動）。`livePlayerFor` も `row.female` が無ければ性別を見ない（既存）。

- [ ] **Step 2: カードの「順番」列を消す**

```js
    var labels = withR1
      ? ['ゼッケン', '選手名', '級位・段位', '一巡目', '得点', '備考']
      : ['ゼッケン', '選手名', '級位・段位', '得点', '備考'];
    …
      var cells = [
        [Number.isInteger(p.bib) ? String(p.bib) : '', 'num'],
        [p.name || '', 'name'],
        [Courts.rankLabel(p.rank), '']
      ];
```

`var m = (p.order || '').match(/-(\d+)$/);` は使わなくなるので消す。コメント（684 付近「順番・ゼッケン・…」）も直す。

- [ ] **Step 3: ブラウザで確かめる**

混合にした大会の試合進行で、組が「一巡目」だけで男女が同じカードに数えられ、カードの表に順番列が無いこと。分ける大会では従来どおり 2 組。

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desk-match): 混合は巡目ごとに 1 組、カードの順番列を消す（設計書 2026-10-07 §5）" -- desk-match.js
```

---

### Task 7: 採点画面: 帯の見出し・番号の非表示・一覧の順番列

**Files:**
- Modify: `app.js`（996〜1013 updatePlayerLabels、2087〜2098 PLAYER_LIST_HEAD / playerListColumns、2161〜2180 帯、2200 行）
- Modify: `style.css`（`.player-list-table td.order` などの順番列のスタイルがあれば消す。`grep -n "\.order" style.css app.js`）

- [ ] **Step 1: 帯の 1 行目と番号**

```js
  function updatePlayerLabels(p) {
    // 順番パース: コート-性別の段-巡目-番号（性別の段は 男子・女子・混合。設計書 2026-10-07）
    var m = (p.order || '').match(/^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/);
    // ゼッケンは持っている選手だけ（出走番号は画面に出さない。設計書 2026-10-07 §1）
    var bib = (typeof p.bib === 'number') ? 'No.' + p.bib : '';
    if (m) {
      // 部・巡目・コートは帯の 1 行目に大きく出す（「男子の部　一巡目　A コート」。混合は「一巡目　A コート」）。
      var roundName = m[3] === '1' ? '一巡目' : (m[3] === '2' ? '二巡目' : m[3] + '巡目');
      playerStageLabel.textContent = (m[2] === '混合' ? '' : m[2] + 'の部　') + roundName + '　' + m[1] + ' コート';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = bib;
    } else {
      playerStageLabel.textContent = '';
      courtLabel.textContent = '';
      playerOrderLabel.textContent = bib;
    }
```

- [ ] **Step 2: 一覧の順番列を消す**

```js
  var PLAYER_LIST_HEAD =
    '<th>ゼッケン</th><th>選手名</th><th>級位・段位</th>' +
    '<th>一巡目</th><th>二巡目</th><th class="note">備考</th>';
  …
  function playerListColumns() {
    return canReorder ? 7 : 6;
  }
```

`buildPlayerListRow` の `'<td class="order">' + esc(p.order || '') + '</td>' +` の行とそのコメントを消す。`td.colSpan = playerListColumns();` のコメント「（掴み手・）順番・ゼッケン・…」も直す。ドラッグの処理で `td.order` を参照していないか `grep -n "\.order\b\|td.order" app.js` で確かめる。

- [ ] **Step 3: 帯**

```js
    // 分ける大会: 男子の部・女子の部の帯で分ける（並びは list のまま。性別が切り替わる所に帯を入れる）。
    // 混合の大会（order の性別の段が 混合。Courts.isMixedOrder）: 性別の帯は入れず、複数の巡目が並ぶときだけ巡目の帯。
    var lastSex = null;
    …
    for (var i = 0; i < list.length; i++) {
      var r = Courts.roundOf(list[i]);
      var roundText = r === 1 ? '一巡目' : r === 2 ? '二巡目' : r + '巡目';
      var sex;
      if (Courts.isMixedOrder(list[i])) {
        sex = manyRounds ? roundText : '';
      } else {
        sex = (list[i].isFemale === true ? '女子の部' : '男子の部') + (manyRounds ? ('　' + roundText) : '');
      }
      if (sex && sex !== lastSex) {
        … 既存の帯の生成 …
      }
```

- [ ] **Step 4: ブラウザで確かめる**

混合の大会を試合開始して採点画面を開く。帯の 1 行目が「一巡目　A コート」、2 行目がゼッケンと名前（「3番」が無い）。一覧に順番列が無く、男女が 1 つの帯にまとまる。分ける大会では「男子の部　一巡目　A コート」と男女の帯。運営の端末でドラッグ並べ替えが混合の男女をまたいで通る（Courts.sameReorderGroup が同じ組を返す）。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(scoring): 出走番号を出さない。混合の帯は性別で切らない。一覧の順番列を消す（設計書 2026-10-07 §5）" -- app.js style.css
```

---

### Task 8: 配信ボード

**Files:**
- Modify: `board.js:228〜232`

- [ ] **Step 1: orderLabel**

```js
  // 順番（A-男子-1-3）を「男子 1巡目」にする（番号は出さない。設計書 2026-10-07 §1）。混合は「1巡目」。読めない形は空。
  function orderLabel(order) {
    var m = String(order || '').match(/^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/);
    if (!m) return '';
    return (m[2] === '混合' ? '' : m[2] + ' ') + m[3] + '巡目';
  }
```

読めない order を「そのまま出す」のをやめる理由: 旧データの空 order や CSV 由来の文字列が観客向けに出るのを避ける。

- [ ] **Step 2: test.html に board の orderLabel のテストがあれば直す**

`grep -n "orderLabel\|巡目 .*番" test.html`。あれば期待値を「男子 1巡目」「1巡目」に。無ければ足さなくてよい（board.js は IIFE で公開していない）。

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(board): 出走番号を出さない。混合は巡目だけ（設計書 2026-10-07 §5）" -- board.js test.html
```

---

### Task 9: 選手登録の表（PC 運営）

**Files:**
- Modify: `desk-players.js`（COLUMNS 41〜59、sexRow/addRow 566〜600、fillRows 699〜738、dragBlockReason 759〜770、moveRowToBand/onDrop の reorder 呼び出し 894・900・943、renumberShown 969〜、buildRow 1030、sexCell 1412〜1420、draftSeed 1846〜、startDraft 1866〜、buildDraftRow 1890・1983〜2000、追加成功のトースト 2106）
- Modify: `desk.css:171, 701`（`.col-no` を消す）
- Modify: `help.html` は Task 10

いまのファイルを正とする。以下は意図と要点。

- [ ] **Step 1: 混合の判定と No. 列の削除**

```js
  // 混合の大会か（settings.mixed。設計書 2026-10-07）。帯を性別で分けず、性別は行ごとに変えられる
  function isMixed(ctx) {
    return !!(ctx && ctx.event && ctx.event.settings && ctx.event.settings.mixed === true);
  }
```

`COLUMNS`: `{ key: 'order', label: 'No.', cls: 'col-no' }` を消し、「巡」の列に `key: 'order'` を足す:

```js
    { key: 'order', label: '巡', cls: 'col-round', filter: 'round' },
```

見出しの描画（626〜640）は `col.key` と `col.filter` の両方を持つ列（名前）を既に扱っているので、そのまま「巡」を押すと試技順で並ぶ。`buildRow` の `tr.appendChild(cell(String(key.no || ''), 'num col-no'));` と `buildDraftRow` の `cell('—', 'num col-no')` を消す。`key` 変数が他で使われていなければ消す。`desk.css` の `.col-no` の 2 か所を消す。

- [ ] **Step 2: 帯（fillRows）**

```js
    // 分ける大会: 男子の部・女子の部を、さらに コート×巡目 の帯に分けて見せる（ユーザー要望 2026-09-30）。
    // 混合の大会（設計書 2026-10-07 §5）: コート×巡目 の帯だけ（部の名前は付けない。female は undefined）。
    // 出走番号は画面に出さない（並びは試技順のまま）。
    var divisions = isMixed(ctx) ? [['', undefined]] : [['男子の部', false], ['女子の部', true]];
    var shown = 0;
    divisions.forEach(function(g) {
      var female = g[1];
      var byDivision = (typeof female === 'boolean');
      var inDivision = byDivision ? rows.filter(function(p) { return (p.isFemale === true) === female; }) : rows;
      var hasDraft = !!draft && !locked && (!byDivision || draft.isFemale === female);
      if (inDivision.length === 0 && locked) return;
      var bands = divisionBands(inDivision);
      if (bands.length === 0) {
        if (shown++ > 0) tbody.appendChild(gapRow());
        tbody.appendChild(sexRow((g[0] ? g[0] + '　' : '') + '0 名'));
      }
      bands.forEach(function(b) {
        if (shown++ > 0) tbody.appendChild(gapRow());
        tbody.appendChild(sexRow((g[0] ? g[0] + '　' : '') + courtLabel(b.court) + '　' + roundLabel(b.round) +
          '　' + b.rows.length + ' 名'));
        var band = { court: b.court, isFemale: female, round: b.round, rows: b.rows };
        band.blocked = dragBlockReason(ctx, band);
        b.rows.forEach(function(p) { tbody.appendChild(buildRow(ctx, p, locked, band)); });
      });
      if (hasDraft) tbody.appendChild(buildDraftRow(ctx));
      if (!locked) tbody.appendChild(addRow(ctx, female));
    });
```

`addRow(ctx, female)`: ボタンの文言は `typeof female === 'boolean' ? '＋ 行を追加（' + (female ? '女子' : '男子') + '）' : '＋ 行を追加'`。

- [ ] **Step 3: ドラッグ**

`dragBlockReason`:

```js
    if (!sort || sort.key !== 'order' || sort.dir !== 'asc') return '試技順（巡の列）のときに並べ替えできます';
    var byDivision = (typeof band.isFemale === 'boolean');
    var all = (ctx.players || []).filter(function(p) {
      return (!byDivision || (p.isFemale === true) === band.isFemale) &&
        Courts.courtOf(p) === band.court && Courts.roundOf(p) === band.round;
    });
    if (all.length !== band.rows.length) return '絞り込みを解除すると並べ替えできます';
    var broken = band.court === Courts.UNASSIGNED || band.rows.some(function(p) {
      if (Courts.reorderGroupKey(p) === null) return true;
      return byDivision ? Courts.orderKey(p).sex !== (band.isFemale ? 1 : 0) : !Courts.isMixedOrder(p);
    });
```

`Api.reorderPlayers` の 3 か所: `isFemale: band.isFemale === true`（混合では undefined を送らない。サーバーは混合で isFemale を見ない）。`moveRowToBand` の `toBand.isFemale` / `fromBand.isFemale` も同じ。

`renumberShown` 関数と呼び出し 3 か所（`renumberShown(targetIds)`、`renumberShown(sourceIds)`、`renumberShown(ids)`）を消す。行はすでに `insertBefore` で動いている。

`moveRowToBand` の確認文「両方のコートの呼び出し順（No.）が変わります」→「両方のコートの呼び出し順が変わります」。`onDrop` の「順番を入れ替えると採点画面の呼び出し順（No.）が変わります」→「…呼び出し順が変わります」。

- [ ] **Step 4: 性別の列（混合では編集できる）**

```js
  // 性別。分ける大会では読み取り専用（表が男子の部・女子の部で分かれているため。ユーザー要望 2026-09-30。
  // 間違えたときは行を削除して正しい部に追加し直す）。混合の大会では行ごとに変えられる（設計書 2026-10-07 §5。
  // 性別を変えても order は変わらない。技の候補が変わるので保存後に表を読み直す）。
  function sexCell(ctx, p, locked) {
    var td = document.createElement('td');
    td.className = 'col-sex';
    if (!isMixed(ctx) || locked || isLinked(ctx, p)) {
      td.textContent = Courts.sexOf(p);
      if (isLinked(ctx, p)) td.title = LINKED_NOTE;
      return td;
    }
    var sel = document.createElement('select');
    sel.className = 'desk-cell-select';
    sel.setAttribute('aria-label', '性別');
    addOption(sel, '男子', '男子');
    addOption(sel, '女子', '女子');
    sel.value = p.isFemale === true ? '女子' : '男子';
    var last = sel.value;
    var busy = false;
    sel.addEventListener('change', async function() {
      if (busy) return;
      var value = sel.value;
      if (value === last) return;
      busy = true;
      await saveCell(ctx, p, sel, { isFemale: value === '女子' }, function() { sel.value = last; },
        function() { Desk.reloadEvent(); });
      busy = false;
    });
    td.appendChild(sel);
    return td;
  }
```

`saveCell` の引数の形は `courtCell`（1380〜1404）と同じ。`isLinked`（二巡目の行）は一巡目から伝播するので読み取り専用のまま。`Api.updatePlayerInfo` が `isFemale` を送れることを api.js で確かめる（サーバーの PATCH は `typeof body.isFemale === 'boolean'` を受ける）。

- [ ] **Step 5: 下書き行**

`draftSeed(ctx, female)`: `female` が真偽値でないとき（混合）は性別で絞らず、`isFemale: typeof female === 'boolean' ? female : false`。

```js
    var bands = divisionBands(Courts.sortBy(Courts.applyFilter(ctx.players || [], filter), sort)
      .filter(function(p) { return typeof female !== 'boolean' || (p.isFemale === true) === female; }));
```

`startDraft(ctx, female)`: `if (!draft || (typeof female === 'boolean' && draft.isFemale !== female))` で作り直す。

`buildDraftRow` の性別セレクト: `selSex.disabled = !isMixed(ctx);` `selSex.title = isMixed(ctx) ? '' : '性別は表の部（男子の部・女子の部）で決まります';`（change のハンドラは既存のまま。混合では有効になる）。

追加成功のトースト: `Desk.toast(result.name + ' を追加しました');`（order を出さない）。

- [ ] **Step 6: ブラウザで確かめる**

- 分ける大会: 帯が「男子の部　A コート　一巡目」、No. 列が無い、「巡」の見出しを押すと ▲ が付き試技順、名前順にするとドラッグの掴み手が薄く「試技順（巡の列）のときに並べ替えできます」。ドラッグで入れ替えて「試技順を保存しました」。性別は文字のまま。
- 混合の大会: 帯が「A コート　一巡目」、男女が同じ帯、性別がセレクトで変えられて保存後に表が読み直される、「＋ 行を追加」が帯の下に 1 つで下書きの性別を選べる、ドラッグで男女をまたいで入れ替えられる、コート間の移動（別の帯へ落とす）が通る。
- test.html を開き直し失敗が無いこと（desk-players の純粋関数のテストがあれば）。

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(desk-players): No. 列を消し「巡」で試技順、混合は コート×巡目 の帯で性別を行ごとに編集（設計書 2026-10-07 §5）" -- desk-players.js desk.css
```

---

### Task 10: ヘルプ

**Files:**
- Modify: `help.html`（71、295〜304、330、385〜386、478、545、550、586、603、610、626）

- [ ] **Step 1: 設定の一節**

基本情報の設定（「ゼッケン番号を必須にする」の説明がある節）に:

```html
    <p><span class="ui">男女を分けずに進める（混合）</span> — 入れると、試合進行のカード・選手登録の表・採点画面の一覧で <span class="term">男子の部・女子の部に分けません</span>。出走順はコートごとに男女通しです。順位の部門（一般男子・新人枠・一般女子）と配点は変わりません。<span class="term">準備中だけ変えられます</span>（試合開始の後は <span class="msg">試合開始の後は男女の分け方を変えられません</span>）。選手がいる状態で変えると、並びはそのままで出走順を振り直します（<span class="msg">出走順を男女通しに振り直します。並びは今のまま（男子 → 女子）です。よろしいですか？</span>）。</p>
```

- [ ] **Step 2: 番号の記述を消す**

- 330: 「試技順（No.）の入れ替え」→「試技順の入れ替え」。「落とした位置に合わせて No. を 1 から振り直します」→「落とした位置の順になります（番号は画面に出ません）」。「掴めるのは No. 順で」→「掴めるのは「巡」の列で試技順に並べていて」。「性別は変えられないので…」の後に「（混合の大会では性別の欄で変えられます）」。「帯の中で No. が 1 から並びます」を消す。混合の帯は「A コート　一巡目」と書く。
- 385〜386「順番の付きかた」: 「順番は コート-性別-巡目-番号 の形で自動で付きます（画面には出ません。CSV と大会ファイルで見られます）。混合の大会では性別の段が <span class="ui">混合</span> になり（例 <span class="ui">A-混合-1-3</span>）、コートごとに男女通しです。」
- 545: 「2行目に「1番 No.19」のような番号と選手名」→「2行目にゼッケン（<span class="ui">No.19</span>）と選手名」。混合の大会では 1 行目が「一巡目　A コート」。
- 550: 「列は 順番・ゼッケン・…」→「列は ゼッケン・…」。「男子の部・女子の部の帯で分かれて」の後に「（混合の大会では分かれません）」。「順番の番号が上から振り直されます」→「並びが保存されます」。
- 610: 二巡目の番号の段落。「同じコート・同じ性別の中で」→「同じコートの中で（分ける大会は性別ごと、混合の大会は男女通し）」。例の `A-男子-2-1` はそのまま。「番号を読み上げるときは気をつけてください」→「呼び出しはゼッケンで行ってください」。
- 71・478・626: 「コートごと・部ごとに」→「コートごとに（分ける大会は部ごと、混合は男女通しで）」。
- 586: 「巡・順番・名前・…の表」→「巡・名前・…の表」。「順番はコート内の試技順で、ゼッケンとは別です」を消す。（desk-round2.js に順番の列があるなら Task 9 の実装者に消してもらう。`grep -n "順番" desk-round2.js`。）
- 603: 「二巡目の選手は試技順に並びます」はそのまま。

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(help): 混合の設定と、出走番号を画面に出さない旨（設計書 2026-10-07）" -- help.html
```

---

### Task 11: 全体の確認と申し送り

- [ ] **Step 1: 残りの参照を探す**

```bash
grep -rn "男子|女子" --include=*.js --include=*.html --include=*.mjs . | grep -v node_modules | grep -v worktrees | grep -v old-dev
```

期待: 残るのは `courts.js` の `sexOf`（意図どおり。isFemale に落とす）と test.html のフィクスチャだけ。`順番` の見出し・`No\.` の表示が desk-round2.js・dashboard.js・share.js・present.js に残っていないか `grep -n "'順番'\|No\\." *.js` で確かめ、あれば消す（ゼッケンの `No.` は残す）。

- [ ] **Step 2: テスト**

サーバー再起動 → `npm test` → `npm run test:browser`（または test.html を開く）。期待: failed 0。

- [ ] **Step 3: ブラウザで通し**

テンプレート「システムテスト用」から大会を作り（分ける大会）、基本情報で混合に → 選手登録・試合進行・採点画面・配信ボード（board.html）・ダッシュボードを順に開き、設計書 §5 の見た目を確かめる。試合開始 → 採点 → 一巡目を終了 → 二巡目の並びが男女通しの得点順。終わったら大会を削除。

- [ ] **Step 4: メモリの申し送り**

`C:\Users\yeto1\.claude\projects\…\memory\` に着地状況を書く（指揮官の仕事。実装者は不要）。
