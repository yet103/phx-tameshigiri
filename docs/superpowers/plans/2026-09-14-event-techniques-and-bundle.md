# 大会ごとの技マスタと一括エクスポート／インポート 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 技（形）の配点マスタをサーバー全体で1つ持つのをやめて大会ごとに持たせ、さらに大会1件を丸ごと1つの JSON ファイルに書き出して別サーバーで取り込めるようにする。

**Architecture:** 技リストは大会 JSON の `techniques` に同梱し、サーバーの `effectiveTechniques(event)`（`event.techniques` があればそれ、無ければ雛形 `custom.json` / `DEFAULT_TECHNIQUES` の複製）を唯一の判断箇所にする。検証 `validateTechniques(list)` は `PUT /api/events/:id/techniques` と `POST /api/events/import` で共用する。クライアントは `Api.loadEvent` の応答に付く `techniques` をそのまま使い、各画面は `Api.loadTechniques()`（雛形）を大会選択中は呼ばない。設計書は `docs/superpowers/specs/2026-09-14-event-techniques-and-bundle-design.md`。

**Tech Stack:** vanilla JS (IIFE), Express 5, test.html（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は JSON.stringify 比較）

---

## 全タスク共通のルール

- **トラック A を全部終えてマージしてから、トラック B に着手する。** B は A で入る `validateTechniques` / `cloneTechniques` / `effectiveTechniques` を使う。
- サーバーの起動: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。テストは `http://localhost:3461/test.html` をブラウザで開いて `Result: N passed, 0 failed` を確認する。編集後の再確認は同じ URL への再 navigate ではなく `location.reload()` か新しいタブで行う（bfcache 対策）。
- **既存テスト 405 件を壊さない。** テスト用に作った大会は必ず `await Api.deleteEvent(id)` で消す。本物の大会 JSON（`server/data/events/` の「第10回全日本試し斬り大会」「名古屋城決戦」）には触れない。
- 雛形（`server/data/techniques/custom.json`）をテストで書き換えたら、**元の状態に戻す**。もともと `custom.json` が無かった環境で残すと、`runApiTests()` 冒頭の「デフォルト一致」2件がスキップされてテスト件数が変わる。
- `git add` は触ったファイルを明示する。`git add -A` は使わない。
- 書き込み系ハンドラは同期のまま（`server/index.js` 294〜299行の不変条件）。新しく足す書き込みハンドラも `async` にしない。
- `server/index.js` 300行付近の「対象:」のルート一覧コメントに、新しく足した書き込み系ルートを追記する。

---

# トラック A（大会ごとの技マスタ）

### Task A1: 新規大会に雛形の複製を持たせ、GET で有効な技リストを返す

**Files:**
- Modify: `server/index.js`（`DEFAULT_TECHNIQUES` の直後 79行付近に関数を追加、`GET /api/events/:id` 341-353、`POST /api/events` 356-395）
- Test: `test.html`（`runApiTests()` の末尾。`await Api.deleteEvent(rank2Event.id);`（671行）の次の行に追記する）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests()` の末尾（671行 `await Api.deleteEvent(rank2Event.id);` の次の行）に追記する。

```js

    // --- 大会ごとの技マスタ（トラックA） ---
    // 雛形（custom.json / 既定値）を複製して新規大会に持たせる。
    var a1Tmpl = await Api.loadTechniques();
    var a1Event = await Api.saveEvent({ name: '技マスタテスト', date: '2026-09-14', venue: '', players: [] });
    var a1Loaded = await Api.loadEvent(a1Event.id);
    assert('新規大会は雛形を複製した技リストを持つ', a1Loaded.techniques, a1Tmpl.techniques);
    assert('GET /api/events/:id は techniquesSource を返す', a1Loaded.techniquesSource, 'event');
    assert('GET /api/events/:id の techniques は配列', Array.isArray(a1Loaded.techniques), true);

    // 既存 ID への上書き保存で techniques を送らなければ、大会の技リストを引き継ぐ
    await Api.saveEvent({ id: a1Event.id, name: '技マスタテスト改', date: '2026-09-14', venue: '', players: [] });
    var a1Again = await Api.loadEvent(a1Event.id);
    assert('保存し直しても大会の技リストは残る', a1Again.techniques, a1Tmpl.techniques);
    assert('保存し直しても名前は更新される', a1Again.name, '技マスタテスト改');
    await Api.deleteEvent(a1Event.id);
```

- [ ] **Step 2: テストが失敗することを確認する**

ブラウザで `http://localhost:3461/test.html` を開き、`新規大会は雛形を複製した技リストを持つ` と `GET /api/events/:id は techniquesSource を返す` が ✗ になることを確かめる。

- [ ] **Step 3: サーバーに技リストの複製・判定の関数を足す**

`server/index.js` の `DEFAULT_TECHNIQUES` の閉じ括弧（79行 `];`）の直後に追加する。

```js

// 技リストの複製と正規化。
// 雛形（DEFAULT_TECHNIQUES / custom.json）をそのまま大会 JSON に入れると、
// あとで雛形を変えたときに採点中の大会の配点まで動いたように見える。必ず複製して渡す。
// 同時に { name, strikes } 以外のキーを落とす（保存する形はこの2つだけ）。
function cloneTechniques(list) {
  return (Array.isArray(list) ? list : []).map(function(t) {
    return {
      name: (t && typeof t.name === 'string') ? t.name.trim() : '',
      strikes: [0, 1, 2, 3].map(function(i) {
        const v = (t && Array.isArray(t.strikes)) ? t.strikes[i] : null;
        return Number.isInteger(v) ? v : null;
      })
    };
  });
}

// その大会の採点に使う技リスト（有効な技リスト）。
// event.techniques が配列ならそれ、無ければ雛形の複製。技リストを読むハンドラは必ずこれを使う。
function effectiveTechniques(event) {
  if (event && Array.isArray(event.techniques)) return event.techniques;
  return cloneTechniques(readTechniques().techniques);
}

// その大会が自前の技リストを持っているか。GET の techniquesSource に使う。
function techniquesSourceOf(event) {
  return (event && Array.isArray(event.techniques)) ? 'event' : 'template';
}
```

- [ ] **Step 4: `GET /api/events/:id` の応答に技リストを足す**

`server/index.js` の `GET /api/events/:id`（341-353行）の中の

```js
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(data);
```

を次に置き換える。

```js
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // 有効な技リストは応答にだけ足す（ファイルには書かない）。
    // techniques を持たない大会（この機能より前に作られた大会）は雛形で動き続ける。
    data.techniquesSource = techniquesSourceOf(data);
    data.techniques = effectiveTechniques(data);
    res.json(data);
```

- [ ] **Step 5: `POST /api/events` で雛形を複製する／既存を引き継ぐ**

`server/index.js` の `POST /api/events` の `// live（配信用ボードの…` のコメント塊（385-389行）の直後、`writeJsonAtomic(eventPath, event);`（390行）の直前に挿入する。

```js
    // 技リスト（大会ごとの配点）。body に techniques が無いときは
    //   既存ファイルがある → その大会の techniques を引き継ぐ（shareToken と同じ扱い）
    //   既存ファイルが無い → 雛形（custom.json / 既定値）を複製して持たせる
    // 複製なので、あとで雛形を変えてもこの大会の配点は動かない。
    if (!Array.isArray(event.techniques)) {
      let inherited = null;
      if (fs.existsSync(eventPath)) {
        try {
          const prevForTech = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
          if (Array.isArray(prevForTech.techniques)) inherited = prevForTech.techniques;
        } catch (e) {
          // 壊れた既存ファイルは上書きを止めない
        }
      }
      event.techniques = inherited || cloneTechniques(readTechniques().techniques);
    }
```

- [ ] **Step 6: テストを通す**

`node server/index.js` を再起動し、`http://localhost:3461/test.html` を再読み込みして `failed` が 0 であることを確かめる。

- [ ] **Step 7: コミットする**

```
git add server/index.js test.html && git commit -m "feat: 新規大会に雛形を複製した技リストを持たせる" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task A2: 大会の技リストの取得・保存・雛形に戻す API

**Files:**
- Modify: `server/index.js`（`GET /api/events/:id/export` の閉じ括弧 837行の直後に新しい節を追加、ルート一覧コメント 300行付近）
- Modify: `api.js`（`resetTechniques` 270-278 の直後に追加、`return {` の公開一覧 415-440）
- Test: `test.html`（`runApiTests()` の末尾、Task A1 で足したブロックの直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests()` の末尾（Task A1 のブロックの `await Api.deleteEvent(a1Event.id);` の次の行）に追記する。

```js

    // --- 大会の技リストの取得・保存・雛形に戻す ---
    var a2Event = await Api.saveEvent({ name: '技リスト編集テスト', date: '2026-09-14', venue: '', players: [] });
    var a2Got = await Api.loadEventTechniques(a2Event.id);
    assert('loadEventTechniques は source を返す', a2Got.source, 'event');
    assert('loadEventTechniques は技リストを返す', Array.isArray(a2Got.techniques), true);

    var a2Techs = [
      { name: '立位袈裟', strikes: [1, null, null, null] },
      { name: '四方', strikes: [17, 5, 7, 3] }
    ];
    var a2Put = await Api.saveEventTechniques(a2Event.id, a2Techs);
    assert('saveEventTechniques は保存した技リストを返す', a2Put.techniques, a2Techs);
    assert('保存した技リストが大会に入る', (await Api.loadEvent(a2Event.id)).techniques, a2Techs);

    var a2Empty = await Api.saveEventTechniques(a2Event.id, [{ name: '  ', strikes: [1, null, null, null] }]);
    assert('技名が空なら行番号つきで断る', a2Empty.error, '1 行目の技名が空です');
    var a2Len = await Api.saveEventTechniques(a2Event.id, [{ name: '真', strikes: [1, 2, 3] }]);
    assert('strikes が4つでなければ断る', a2Len.error, '1 行目の配点は4つ必要です');
    var a2Dup = await Api.saveEventTechniques(a2Event.id, [
      { name: '真', strikes: [1, null, null, null] },
      { name: '真', strikes: [2, null, null, null] }
    ]);
    assert('技名の重複は断る', a2Dup.error, '2 行目の技名「真」が重複しています');
    var a2Range = await Api.saveEventTechniques(a2Event.id, [{ name: '真', strikes: [100, null, null, null] }]);
    assert('0〜99 の外の配点は断る', a2Range.error, '1 行目の初太刀の配点が不正です（0〜99の整数か空）');
    var a2Many = [];
    for (var a2i = 0; a2i < 201; a2i++) a2Many.push({ name: '技' + a2i, strikes: [1, null, null, null] });
    var a2Over = await Api.saveEventTechniques(a2Event.id, a2Many);
    assert('201件は断る', a2Over.error, '技は1〜200件で指定してください');
    assert('検証に落ちた保存は大会を書き換えない', (await Api.loadEvent(a2Event.id)).techniques, a2Techs);

    // 雛形を変えても、自前の技リストを持つ大会は動かない
    var a2TmplBefore = await Api.loadTechniques();
    await Api.saveTechniques([{ name: '雛形だけの技', strikes: [7, null, null, null] }]);
    assert('雛形を変えても大会の技リストは変わらない',
      (await Api.loadEvent(a2Event.id)).techniques, a2Techs);
    // 雛形を元に戻す。もともと custom.json が無かった環境では消して戻す
    // （残すと次回の実行で「デフォルト一致」の2件がスキップされ、テスト件数が変わる）。
    if (a2TmplBefore.isCustom) await Api.saveTechniques(a2TmplBefore.techniques);
    else await Api.resetTechniques();
    assert('雛形は元に戻っている', (await Api.loadTechniques()).techniques, a2TmplBefore.techniques);

    var a2Reset = await Api.resetEventTechniques(a2Event.id);
    assert('resetEventTechniques は成功する', a2Reset, true);
    assert('雛形に戻すと雛形の複製が入る',
      (await Api.loadEvent(a2Event.id)).techniques, a2TmplBefore.techniques);
    assert('雛形に戻しても大会は自前の技リストを持つ扱い',
      (await Api.loadEvent(a2Event.id)).techniquesSource, 'event');

    assert('存在しない大会の技リストは null', await Api.loadEventTechniques('zzzzzzzznotexist'), null);
    await Api.deleteEvent(a2Event.id);
```

- [ ] **Step 2: テストが失敗することを確認する**

`Api.loadEventTechniques is not a function` で落ちること（＝この節の assert が1つも出ないこと）を確かめる。

- [ ] **Step 3: サーバーに `validateTechniques` を足す**

`server/index.js` の `GET /api/events/:id/export` の閉じ括弧（837行 `});`）の直後に追加する。

```js

// ── Event Techniques API ──
// 大会ごとの技マスタ。雛形（GET/POST/DELETE /api/techniques）とは別物で、
// 大会 JSON の techniques に持つ。読み出しは必ず effectiveTechniques を通す。

const STRIKE_LABELS = ['初太刀', '二ノ太刀', '三ノ太刀', '四ノ太刀'];

// 技リストの検証。PUT /api/events/:id/techniques と POST /api/events/import で共用する。
// 戻り値: エラー文字列（日本語。行番号は1始まり） or null（妥当）
// 技名は trim して比較する。'胸尽くし(男)' と '胸尽くし(女)' は別名として扱う（そのまま別の文字列）。
function validateTechniques(list) {
  if (!Array.isArray(list)) return '技リストが配列ではありません';
  if (list.length < 1 || list.length > 200) return '技は1〜200件で指定してください';
  const seen = Object.create(null);   // 技名が '__proto__' でも壊れないように
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const n = i + 1;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return n + ' 行目の形式が不正です';
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!name) return n + ' 行目の技名が空です';
    if (name.length > 50) return n + ' 行目の技名が長すぎます（50文字まで）';
    if (seen[name]) return n + ' 行目の技名「' + name + '」が重複しています';
    seen[name] = true;
    if (!Array.isArray(t.strikes) || t.strikes.length !== 4) return n + ' 行目の配点は4つ必要です';
    for (let s = 0; s < 4; s++) {
      const v = t.strikes[s];
      if (v === null) continue;
      if (!Number.isInteger(v) || v < 0 || v > 99) {
        return n + ' 行目の' + STRIKE_LABELS[s] + 'の配点が不正です（0〜99の整数か空）';
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: 3つのルートを足す**

Step 3 で足した `validateTechniques` の閉じ括弧の直後に続けて書く。

```js

// GET /api/events/:id/techniques : その大会の有効な技リスト
app.get('/api/events/:id/techniques', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    res.json({ source: techniquesSourceOf(event), techniques: effectiveTechniques(event) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/events/:id/techniques : その大会の技リストを置き換える
app.put('/api/events/:id/techniques', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const body = req.body || {};
    const invalid = validateTechniques(body.techniques);
    if (invalid) return res.status(400).json({ error: invalid });
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    event.techniques = cloneTechniques(body.techniques);
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ success: true, techniques: event.techniques });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id/techniques : 雛形の複製で置き換える（「雛形に戻す」）
// 雛形との連動状態には戻さない。戻すと、あとで雛形を変えたときに採点中の大会の配点が動く。
app.delete('/api/events/:id/techniques', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    event.techniques = cloneTechniques(readTechniques().techniques);
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ success: true, techniques: event.techniques });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 5: ルート一覧コメントに追記する**

`server/index.js` 300行付近の `//   POST   /api/techniques / DELETE /api/techniques` の行の直後に足す。

```js
//   PUT    /api/events/:id/techniques / DELETE /api/events/:id/techniques
```

- [ ] **Step 6: api.js に3つの関数を足す**

`api.js` の `resetTechniques`（270-278行）の閉じ括弧の直後に追加する。

```js

  // --- Event Techniques（大会ごとの技マスタ） ---
  // 雛形用の loadTechniques / saveTechniques / resetTechniques とは別物。
  // 大会を選んでいるときは必ずこちら（または Api.loadEvent の応答の techniques）を使う。
  async function loadEventTechniques(eventId) {
    // GET /api/events/:eventId/techniques
    // 戻り値: { source: 'event' | 'template', techniques: [...] } | null（400/404/通信失敗）
    try {
      var res = await fetch('/api/events/' + eventId + '/techniques');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function saveEventTechniques(eventId, techs) {
    // PUT /api/events/:eventId/techniques
    // 戻り値: { success: true, techniques } | { success: false, error }（4xx。行番号つきの理由）
    //       | null（通信失敗）
    try {
      var res = await fetch('/api/events/' + eventId + '/techniques', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ techniques: techs })
      });
      if (!res.ok) {
        var errJson = await res.json();
        return { success: false, error: errJson.error };
      }
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function resetEventTechniques(eventId) {
    // DELETE /api/events/:eventId/techniques（雛形の複製で置き換える）
    // 戻り値: 真偽
    try {
      var res = await fetch('/api/events/' + eventId + '/techniques', { method: 'DELETE' });
      return res.ok;
    } catch (e) {
      return false;
    }
  }
```

`api.js` の公開一覧（415-440行）の `resetTechniques: resetTechniques,` の直後に足す。

```js
    loadEventTechniques: loadEventTechniques,
    saveEventTechniques: saveEventTechniques,
    resetEventTechniques: resetEventTechniques,
```

- [ ] **Step 7: テストを通す**

サーバーを再起動してテストを再読み込みし、`failed` が 0 であることを確かめる。

- [ ] **Step 8: コミットする**

```
git add server/index.js api.js test.html && git commit -m "feat: 大会ごとの技リストを取得・保存・雛形に戻す API を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task A3: 配信用ボードがその大会の技リストを返す

**Files:**
- Modify: `server/index.js`（`GET /api/links/:token/live` 1288-1293）
- Test: `test.html`（`runApiTests()` の末尾、Task A2 で足したブロックの直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests()` の末尾（Task A2 のブロックの `await Api.deleteEvent(a2Event.id);` の次の行）に追記する。

```js

    // --- 配信用ボードはその大会の技リストを返す ---
    var a3Event = await Api.saveEvent({ name: 'ボード技テスト', date: '2026-09-14', venue: '', players: [] });
    await Api.saveEventTechniques(a3Event.id, [{ name: 'ボード専用技', strikes: [5, 2, null, null] }]);
    var a3Bulk = await Api.createPlayersBulk(a3Event.id, {
      court: 'A', isFemale: false, isNewFace: false, names: ['ボード 甲']
    });
    await Api.putLive(a3Event.id, 'A', { playerId: a3Bulk.players[0].id });
    var a3Token = (await Api.createShareLink(a3Event.id)).token;
    var a3Live = (await Api.loadLive(a3Token)).data;
    assert('loadLive はその大会の技リストを返す（雛形ではない）',
      a3Live.techniques, [{ name: 'ボード専用技', strikes: [5, 2, null, null] }]);
    await Api.deleteEvent(a3Event.id);
```

- [ ] **Step 2: テストが失敗することを確認する**

`loadLive はその大会の技リストを返す（雛形ではない）` が ✗ になることを確かめる。

- [ ] **Step 3: live の応答を大会の技リストにする**

`server/index.js` の `GET /api/links/:token/live` の末尾（1288-1293行）の

```js
      techniques: readTechniques().techniques
```

を次に置き換える。

```js
      // 配点は大会ごと。雛形ではなくこの大会の有効な技リストを返す
      // （board.html は返ってきた配点で得点の内訳を描く）。
      techniques: effectiveTechniques(event)
```

- [ ] **Step 4: テストを通す**

サーバーを再起動してテストを再読み込みし、`failed` が 0 であることを確かめる。

- [ ] **Step 5: コミットする**

```
git add server/index.js test.html && git commit -m "feat: 配信用ボードにその大会の配点を返す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task A4: 採点画面が選択中の大会の配点で採点する

**Files:**
- Modify: `app.js`（`init` 36-79、`adoptEvent` 307-311、`updateAdminLink` 317-323、`onEventSelect` 325-364）
- Modify: `index.html`（`.page-links` 26-32）
- Test: なし（DOM を持つ画面の挙動。Step 6 で手動確認する）

- [ ] **Step 1: 雛形の控えを持つ状態変数を足す**

`app.js` の状態変数（2-19行）の `var timerInterval = null;`（19行）の直後に足す。

```js
  // 雛形（サーバー全体の技リスト）の控え。大会未選択のときと、
  // 大会の応答に techniques が無かったとき（旧サーバー）に使う。
  var templateTechniques = null;
```

- [ ] **Step 2: `init` で雛形を控える**

`app.js` の `init`（45-54行）の

```js
    var techData = await Api.loadTechniques();
    if (techData && techData.techniques) {
      Scoring.setTechniques(techData.techniques);
    } else {
```

を次に置き換える。

```js
    var techData = await Api.loadTechniques();
    if (techData && techData.techniques) {
      templateTechniques = techData.techniques;
      Scoring.setTechniques(techData.techniques);
    } else {
```

- [ ] **Step 3: 大会の配点を採点に入れる関数を足す**

`app.js` の `adoptEvent`（307-311行）の直前に足す。

```js
  // 選択中の大会の配点を採点に反映する。
  // 配点は大会ごと（大会 JSON の techniques）。応答に techniques が無い旧サーバーに
  // 当たったときは雛形のままにする（黙って 0 点にしない）。
  function applyEventTechniques(event) {
    if (event && Array.isArray(event.techniques) && event.techniques.length > 0) {
      Scoring.setTechniques(event.techniques);
    } else if (templateTechniques) {
      Scoring.setTechniques(templateTechniques);
    }
  }
```

- [ ] **Step 4: `adoptEvent` から呼ぶ**

`app.js` の `adoptEvent`（307-311行）を次に置き換える。

```js
  function adoptEvent(event) {
    currentEvent = event;
    players = event.players || [];
    Outbox.applyPending(event.id, players);
    // 大会を読み直す経路（onEventSelect / refreshFromServer）はここに集まる。
    // 配点の入れ替えもここでやると付け忘れない。
    applyEventTechniques(event);
  }
```

- [ ] **Step 5: 上部リンクと大会を離れたときの戻しを入れる**

`app.js` の `updateAdminLink`（317-323行）の閉じ括弧の直後に足す。

```js

  // 上部リンクの「技術リスト編集」。選択中の大会があればその大会の技リストを開く
  // （配点は大会ごとなので、ハッシュ無しで開くと雛形を編集してしまう）。
  function updateTechniquesLink(eventId) {
    var link = document.getElementById('linkTechniques');
    if (!link) return;   // このリンクを持たないページから呼ばれても落ちないように
    link.href = eventId
      ? 'techniques.html#' + encodeURIComponent(eventId)
      : 'techniques.html';
  }
```

`app.js` の `onEventSelect` の大会未選択の分岐（344-346行）の

```js
      refreshPlayerList();
      updateAdminLink('');
      return;
```

を次に置き換える。

```js
      refreshPlayerList();
      updateAdminLink('');
      updateTechniquesLink('');
      // 大会を離れたら配点も雛形に戻す（次に選ぶ大会まで前の大会の配点を持ち越さない）。
      if (templateTechniques) Scoring.setTechniques(templateTechniques);
      return;
```

`onEventSelect` の末尾（362-363行）の

```js
    Route.set(currentEvent.id, currentCourt);
    updateAdminLink(currentEvent.id);
```

を次に置き換える。

```js
    Route.set(currentEvent.id, currentCourt);
    updateAdminLink(currentEvent.id);
    updateTechniquesLink(currentEvent.id);
```

- [ ] **Step 6: index.html のリンクに id を付ける**

`index.html` の29行

```html
    <a href="techniques.html">技術リスト編集</a>
```

を次に置き換える。

```html
    <a href="techniques.html" id="linkTechniques">技術リスト編集</a>
```

- [ ] **Step 7: 手で確かめる**

`http://localhost:3461/index.html` を開き、(1) 大会を選ぶと上部の「技術リスト編集」の href が `techniques.html#<大会ID>` になる、(2) 「-- 大会を選択 --」に戻すと `techniques.html` に戻る、(3) `http://localhost:3461/test.html` の `failed` が 0 のまま、を確かめる。

- [ ] **Step 8: コミットする**

```
git add app.js index.html && git commit -m "feat: 採点画面が選択中の大会の配点で採点する" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task A5: 運営画面が大会の配点を使う

**Files:**
- Modify: `admin.js`（`registerTab` のコメント 30-33、`applyRoute` 128・147、`reloadEvent` 161、`openAdminMenu` 369-372）
- Modify: `admin-players.js`（1-21、76、290-299）
- Modify: `admin-round.js`（9、52付近、212-221、232）
- Test: なし（DOM を持つ画面の挙動。Step 7 で手動確認する）

- [ ] **Step 1: `ctx` に技リストを足す**

`admin.js` の `registerTab` のコメント（31行）

```js
  // ctx = { eventId, event, players, isStale }（events タブでは event / players は null）
```

を次に置き換える。

```js
  // ctx = { eventId, event, players, techniques, isStale }
  //   （events タブでは event / players / techniques は null）
  // ctx.techniques — その大会の有効な技リスト（配点は大会ごと。雛形を取りに行かない）
```

`admin.js` の128行

```js
      renderTab(seq, { eventId: null, event: null, players: null });
```

を次に置き換える。

```js
      renderTab(seq, { eventId: null, event: null, players: null, techniques: null });
```

`admin.js` の147行（`applyRoute` の末尾）

```js
    renderTab(seq, { eventId: selectedEventId, event: ev, players: ev.players || [] });
```

を次に置き換える。

```js
    renderTab(seq, {
      eventId: selectedEventId, event: ev, players: ev.players || [],
      techniques: Array.isArray(ev.techniques) ? ev.techniques : null
    });
```

`admin.js` の161行（`reloadEvent` の末尾）

```js
    renderTab(seq, { eventId: selectedEventId, event: ev, players: ev.players || [] });
```

を次に置き換える。

```js
    renderTab(seq, {
      eventId: selectedEventId, event: ev, players: ev.players || [],
      techniques: Array.isArray(ev.techniques) ? ev.techniques : null
    });
```

- [ ] **Step 2: ⋯メニューの「技術リスト編集」を大会つきにする**

`admin.js` の `openAdminMenu` の中の369-372行

```js
    btnTechniques.addEventListener('click', function() {
      sheet.close();
      location.href = 'techniques.html';
    });
```

を次に置き換える。

```js
    btnTechniques.addEventListener('click', function() {
      sheet.close();
      // 配点は大会ごと。選択中の大会があればその大会の技リストを開く
      // （大会未選択なら雛形＝新規大会の初期値を開く）。
      var id = currentEventId();
      location.href = id ? 'techniques.html#' + encodeURIComponent(id) : 'techniques.html';
    });
```

- [ ] **Step 3: 選手タブの技キャッシュを大会ごとにする**

`admin-players.js` の 5-21行（`var techCache = null;` の行から `ensureTechniques` の閉じ括弧 `}` まで。間にある「行の並び順」のコメントごと）を次に置き換える。

```js
  // 技リストは大会ごと（大会 JSON の techniques）。render のたびに ctx.techniques で
  // 入れ替える。どの大会のものかを一緒に覚えて、大会をまたいで前の大会の配点を使わない。
  var techCache = null;
  var techOwner = null;

  // 行の並び順（巡目 → コート → 性別 → 番号）は courts.js の Courts.compareOrder
  // を使う（進行タブ admin-round.js と共有）。

  function adoptTechniques(ctx) {
    techOwner = ctx.eventId;
    techCache = (Array.isArray(ctx.techniques) && ctx.techniques.length > 0) ? ctx.techniques : null;
  }

  // いま開いている大会の技リストが手元にあるか
  function hasTechniques(ctx) {
    return techOwner === ctx.eventId && !!techCache;
  }
```

- [ ] **Step 4: 選手タブの呼び出し側を直す**

`admin-players.js` の `render` の冒頭（24行 `if (courtOwner !== ctx.eventId) {` の直前）に足す。

```js
    adoptTechniques(ctx);
```

`admin-players.js` の73-76行

```js
    // 技術リストは追加・編集フォームで使う。フォームを開くまで待たず、
    // ここで先読みしておく（DOM の描画は待たない）。
    ensureTechniques();
```

を削除する（`ctx.techniques` として最初から手元にあるので先読みは要らない）。

`admin-players.js` の `buildPlayerForm` の中の291-299行

```js
      TechPicker.renderChips(chips, techState, async function(index) {
        await ensureTechniques();
        if (!techCache) {
          alert('技術リストを取得できませんでした。技以外は保存できます。');
          return;
        }
        TechPicker.open({
          techniques: techCache,
```

を次に置き換える。

```js
      TechPicker.renderChips(chips, techState, function(index) {
        if (!hasTechniques(ctx)) {
          alert('技術リストを取得できませんでした。大会を開き直してください。技以外は保存できます。');
          return;
        }
        TechPicker.open({
          techniques: techCache,
```

- [ ] **Step 5: 進行タブの技キャッシュを大会ごとにする**

`admin-round.js` の9行

```js
  var techniques = null;   // Api.loadTechniques() の結果のキャッシュ
```

を次に置き換える。

```js
  var techniques = null;   // ctx.techniques（その大会の有効な技リスト）。render のたびに入れ替える
```

`admin-round.js` の52行 `CTX = ctx;` の直後に足す。

```js
    // 配点は大会ごと。雛形（Api.loadTechniques）は取りに行かない。
    techniques = (Array.isArray(ctx.techniques) && ctx.techniques.length > 0) ? ctx.techniques : null;
```

`admin-round.js` の212-221行

```js
  async function ensureTechniques() {
    if (techniques) return true;
    var data = await Api.loadTechniques();
    if (!data || !data.techniques) {
      alert('技術リストを取得できませんでした。');
      return false;
    }
    techniques = data.techniques;
    return true;
  }
```

を次に置き換える。

```js
  // 技リストは render で ctx.techniques から入る。取れていなければ大会を開き直してもらう。
  function ensureTechniques() {
    if (techniques) return true;
    alert('技術リストを取得できませんでした。大会を開き直してください。');
    return false;
  }
```

`admin-round.js` の232行

```js
    if (!(await ensureTechniques())) { openingPicker = false; return; }
```

を次に置き換える。

```js
    if (!ensureTechniques()) { openingPicker = false; return; }
```

- [ ] **Step 6: テストが壊れていないことを確認する**

`http://localhost:3461/test.html` を再読み込みし、`failed` が 0 であることを確かめる。

- [ ] **Step 7: 手で確かめる**

`http://localhost:3461/admin.html` を開き、(1) 選手タブで選手をタップ → 技の枠をタップして技シートが開く、(2) 進行タブで技の枠をタップして技シートが開く、(3) 右上の ⋯ → 「🗒 技術リスト編集」の遷移先が `techniques.html#<大会ID>` になる、を確かめる。

- [ ] **Step 8: コミットする**

```
git add admin.js admin-players.js admin-round.js && git commit -m "feat: 運営画面が選択中の大会の配点を使う" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task A6: 技術リスト編集画面で対象（雛形／大会）を切り替える

**Files:**
- Modify: `techniques.html`（全体を置き換える）
- Test: なし（DOM を持つ画面の挙動。Step 3 で手動確認する）

- [ ] **Step 1: `techniques.html` を次の内容に丸ごと置き換える**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>技術リスト編集</title>
  <link rel="stylesheet" href="theme.css">
  <link rel="stylesheet" href="style.css">
  <style>
    .tech-target { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .tech-target select { min-height: 44px; padding: 0 8px; max-width: 100%; }
    .tech-note, .tech-warn {
      margin: 0 0 12px; padding: 8px 10px; border-radius: 6px;
      font-size: 13px; line-height: 1.5; background: var(--card-bg);
    }
    .tech-note { border: 1px solid var(--border); color: var(--text-muted); }
    .tech-warn { border: 1px solid var(--warn); color: var(--warn); }
    .tech-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.4);
      display: flex; align-items: flex-end; justify-content: center; z-index: 50;
    }
    .tech-sheet {
      background: var(--card-bg); color: var(--text); width: 100%; max-width: 480px;
      max-height: 70vh; overflow-y: auto; border-radius: 12px 12px 0 0; padding: 12px;
    }
    .tech-sheet h3 { margin: 0 0 10px; font-size: 15px; }
    .tech-sheet-item {
      display: block; width: 100%; min-height: 52px; text-align: left;
      padding: 0 12px; margin-bottom: 8px;
    }
  </style>
</head>
<body data-theme="light">

  <div class="page-links">
    <a href="index.html">採点</a>
    <a href="admin.html">運営</a>
    <strong>技術リスト編集</strong>
    <a href="ranking.html">順位表示</a>
    <a href="help.html">ヘルプ</a>
  </div>

  <div class="container" style="padding-top:16px;">
    <div class="tech-target">
      <label for="targetSelect">編集する対象</label>
      <select id="targetSelect">
        <option value="">雛形（新規大会の初期値）</option>
      </select>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
      <h2 id="targetTitle" style="margin:0;">技術リスト</h2>
      <button id="btnCopyFrom" class="btn-neutral" style="margin-left:auto;">別の大会からコピー</button>
      <button id="btnSaveTech" class="btn-neutral">保存</button>
      <button id="btnResetTech" class="btn-fail">デフォルト設定に戻す</button>
      <button class="theme-btn" id="btnTheme">🌙 ダーク</button>
    </div>

    <p class="tech-note" id="sourceNote" hidden></p>
    <p class="tech-warn" id="scoredWarn" hidden></p>

    <div style="overflow-x:auto;">
      <table class="tech-table" id="techTable">
        <thead>
          <tr>
            <th>技名</th>
            <th>初太刀</th>
            <th>二ノ太刀</th>
            <th>三ノ太刀</th>
            <th>四ノ太刀</th>
          </tr>
        </thead>
        <tbody id="techTableBody"></tbody>
      </table>
    </div>
  </div>

  <script src="data.js"></script>
  <script src="scoring.js"></script>
  <script src="api.js"></script>
  <script src="storage.js"></script>
  <script src="courts.js"></script>
  <script>
    // 配点は大会ごと（大会 JSON の techniques）。この画面は
    //   対象 = ''        → 雛形（POST/DELETE /api/techniques）
    //   対象 = 大会ID    → その大会（PUT/DELETE /api/events/:id/techniques）
    // を切り替えて編集する。ハッシュ #<大会ID> で開くとその大会が選ばれる。
    var body = document.body;
    var techTableBody = document.getElementById('techTableBody');
    var targetSelect = document.getElementById('targetSelect');
    var targetTitle = document.getElementById('targetTitle');
    var sourceNote = document.getElementById('sourceNote');
    var scoredWarn = document.getElementById('scoredWarn');
    var btnSave = document.getElementById('btnSaveTech');
    var btnReset = document.getElementById('btnResetTech');
    var btnCopy = document.getElementById('btnCopyFrom');

    var targetId = '';      // '' なら雛形
    var eventsCache = [];   // Api.listEvents() の結果（更新日の新しい順）
    var dirty = false;      // 表を触ったか（対象を切り替えるときの確認に使う）

    function applyTheme(theme) {
      body.setAttribute('data-theme', theme);
      document.getElementById('btnTheme').textContent = theme === 'dark' ? '☀ ライト' : '🌙 ダーク';
    }

    function renderTable(techs) {
      techTableBody.innerHTML = '';
      techs.forEach(function(t, i) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><input type="text" value="' + Storage.esc(t.name) + '" data-field="name" data-idx="' + i + '"></td>' +
          [0,1,2,3].map(function(s) {
            var v = t.strikes[s] !== null && t.strikes[s] !== undefined ? Storage.esc(String(t.strikes[s])) : '';
            return '<td><input type="number" min="0" max="99" value="' + v +
              '" data-field="strike" data-idx="' + i + '" data-strike="' + s + '"></td>';
          }).join('');
        techTableBody.appendChild(tr);
      });
      dirty = false;
    }

    function collectTechs() {
      var techs = [];
      var rows = techTableBody.querySelectorAll('tr');
      rows.forEach(function(tr) {
        var name = tr.querySelector('[data-field="name"]').value.trim();
        var strikes = [0,1,2,3].map(function(s) {
          var v = tr.querySelector('[data-strike="' + s + '"]').value;
          if (v === '') return null;
          var n = parseInt(v, 10);
          return isNaN(n) ? null : n;
        });
        techs.push({ name: name, strikes: strikes });
      });
      return techs;
    }

    function eventById(id) {
      return eventsCache.filter(function(e) { return e.id === id; })[0] || null;
    }

    // 見出し・注記・ボタンの文言を対象に合わせる
    function updateChrome(source) {
      if (!targetId) {
        targetTitle.textContent = '雛形（新規大会の初期値）';
        btnReset.textContent = 'デフォルト設定に戻す';
        btnCopy.style.display = 'none';   // 雛形には「別の大会からコピー」を出さない
        sourceNote.hidden = false;
        sourceNote.textContent =
          'ここで保存した内容は、これから作る大会の初期値になります。既に技リストを持つ大会の配点は変わりません。';
        scoredWarn.hidden = true;
        return;
      }
      var ev = eventById(targetId);
      targetTitle.textContent = (ev && ev.name ? ev.name : '(名称未設定)') + ' の技リスト';
      btnReset.textContent = '雛形に戻す';
      btnCopy.style.display = '';
      if (source === 'template') {
        sourceNote.hidden = false;
        sourceNote.textContent =
          'この大会はまだ雛形を使っています。保存するとこの大会だけの技リストになります。';
      } else {
        sourceNote.hidden = true;
        sourceNote.textContent = '';
      }
    }

    function updateScoredWarning(players) {
      var n = (players || []).filter(function(p) { return Courts.isScored(p); }).length;
      if (n === 0) { scoredWarn.hidden = true; scoredWarn.textContent = ''; return; }
      scoredWarn.hidden = false;
      scoredWarn.textContent = '採点済みの選手が ' + n + ' 名います。' +
        '配点を変えても保存済みの得点は変わりません（採点し直すと新しい配点で計算されます）。';
    }

    // 通信に失敗したときは端末側の既定値を出し、保存を無効にする
    // （この状態で保存すると、サーバーの技リストを既定値で上書きしてしまう）。
    function fallbackToLocal(message) {
      alert(message);
      renderTable(TECHNIQUES);
      btnSave.disabled = true;
    }

    async function loadTarget(id) {
      targetId = id;
      btnSave.disabled = false;
      location.hash = id ? '#' + encodeURIComponent(id) : '';
      if (!id) {
        updateChrome('');
        var td = await Api.loadTechniques();
        if (!td) {
          fallbackToLocal('技術リストをサーバーから取得できませんでした。\n' +
            '端末側の既定値を表示しています。\n' +
            '上書きを防ぐため、保存は無効にしました。再読み込みしてください。');
          return;
        }
        renderTable(td.techniques);
        return;
      }
      var data = await Api.loadEventTechniques(id);
      if (!data) {
        updateChrome('');
        fallbackToLocal('この大会の技リストを取得できませんでした。\n' +
          '端末側の既定値を表示しています。\n' +
          '上書きを防ぐため、保存は無効にしました。再読み込みしてください。');
        return;
      }
      updateChrome(data.source);
      renderTable(data.techniques);
      var ev = await Api.loadEvent(id);
      if (targetId !== id) return;   // 待っている間に対象を切り替えられた
      updateScoredWarning(ev ? ev.players : []);
    }

    function fillTargetSelect() {
      targetSelect.innerHTML = '';
      var opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '雛形（新規大会の初期値）';
      targetSelect.appendChild(opt0);
      eventsCache.forEach(function(ev) {
        var o = document.createElement('option');
        o.value = ev.id;
        o.textContent = (ev.name || '(名称未設定)') + '（' + (ev.date || '日付なし') + '）';
        targetSelect.appendChild(o);
      });
      targetSelect.value = targetId;
    }

    // 「別の大会からコピー」のシート。admin.css を読まないページなので、
    // 最小限の要素をその場で組み立てて捨てる。
    function openCopySheet() {
      var others = eventsCache.filter(function(e) { return e.id !== targetId; });
      if (others.length === 0) { alert('コピーできる大会がありません。'); return; }
      var overlay = document.createElement('div');
      overlay.className = 'tech-overlay';
      var panel = document.createElement('div');
      panel.className = 'tech-sheet';
      var h = document.createElement('h3');
      h.textContent = 'どの大会の技リストをコピーしますか？（保存するまでサーバーには書きません）';
      panel.appendChild(h);

      function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }

      others.forEach(function(ev) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tech-sheet-item btn-neutral';
        b.textContent = (ev.name || '(名称未設定)') + '（' + (ev.date || '日付なし') + '）';
        b.addEventListener('click', async function() {
          close();
          var data = await Api.loadEventTechniques(ev.id);
          if (!data) { alert('その大会の技リストを取得できませんでした。'); return; }
          renderTable(data.techniques);
          dirty = true;
          alert('「' + (ev.name || '(名称未設定)') + '」の技リストを読み込みました。\n' +
                '保存を押すまでこの大会には反映されません。');
        });
        panel.appendChild(b);
      });

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'tech-sheet-item';
      cancel.textContent = '閉じる';
      cancel.addEventListener('click', close);
      panel.appendChild(cancel);

      overlay.appendChild(panel);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
      document.body.appendChild(overlay);
    }

    (async function() {
      applyTheme(Storage.loadTheme());

      var list = await Api.listEvents();
      eventsCache = Array.isArray(list) ? list : [];
      // 更新日の新しい順
      eventsCache.sort(function(a, b) {
        var x = String(a.updatedAt || ''), y = String(b.updatedAt || '');
        if (x === y) return 0;
        return x < y ? 1 : -1;
      });

      var hashId = '';
      try { hashId = decodeURIComponent(String(location.hash || '').replace(/^#/, '')); } catch (e) { hashId = ''; }
      if (hashId && !eventsCache.filter(function(e) { return e.id === hashId; })[0]) hashId = '';
      targetId = hashId;
      fillTargetSelect();
      await loadTarget(targetId);

      techTableBody.addEventListener('input', function() { dirty = true; });

      targetSelect.addEventListener('change', async function() {
        var next = targetSelect.value;
        if (dirty && !confirm('編集中の内容は保存されていません。\n破棄して切り替えますか？')) {
          targetSelect.value = targetId;
          return;
        }
        await loadTarget(next);
      });

      btnCopy.addEventListener('click', openCopySheet);

      btnSave.addEventListener('click', async function() {
        var techs = collectTechs();
        if (!targetId) {
          var ok = await Api.saveTechniques(techs);
          if (!ok) { alert('保存に失敗しました。'); return; }
          dirty = false;
          alert('雛形を保存しました。\nこれから作る大会の初期値になります。');
          return;
        }
        var r = await Api.saveEventTechniques(targetId, techs);
        if (!r) { alert('保存に失敗しました。通信を確認してください。'); return; }
        if (!r.success) { alert(r.error || '保存に失敗しました。'); return; }
        dirty = false;
        renderTable(r.techniques);
        updateChrome('event');
        alert('保存しました。');
      });

      btnReset.addEventListener('click', async function() {
        if (!targetId) {
          if (!confirm('デフォルト設定に戻します。よろしいですか？')) return;
          var ok = await Api.resetTechniques();
          if (!ok) { alert('リセットに失敗しました。'); return; }
          // リセット自体は成功しているので、再取得に失敗しても表は出す。
          // ただしその場合に表示できるのは端末側の既定値であって、
          // サーバーが実際に採点で使う値ではない。黙って同じ顔をさせない。
          var td = await Api.loadTechniques();
          if (td) {
            renderTable(td.techniques);
            alert('デフォルトに戻しました。');
          } else {
            renderTable(TECHNIQUES);
            alert('デフォルトに戻しました。\n' +
                  'ただし最新の技術リストを取得できなかったため、\n' +
                  'この画面には端末側の既定値を表示しています。');
          }
          return;
        }
        if (!confirm('この大会の技リストを雛形（新規大会の初期値）で置き換えます。\nよろしいですか？')) return;
        var okEv = await Api.resetEventTechniques(targetId);
        if (!okEv) { alert('リセットに失敗しました。'); return; }
        var data = await Api.loadEventTechniques(targetId);
        if (!data) {
          alert('雛形に戻しました。\nただし最新の技リストを取得できませんでした。再読み込みしてください。');
          return;
        }
        renderTable(data.techniques);
        updateChrome(data.source);
        alert('雛形に戻しました。');
      });

      document.getElementById('btnTheme').addEventListener('click', function() {
        var current = Storage.loadTheme();
        var next = current === 'dark' ? 'light' : 'dark';
        Storage.saveTheme(next);
        applyTheme(next);
      });
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: テストが壊れていないことを確認する**

`http://localhost:3461/test.html` を再読み込みし、`failed` が 0 であることを確かめる。

- [ ] **Step 3: 手で確かめる**

運営画面（`http://localhost:3461/admin.html`）で適当な大会を作り、選手を1名足して採点画面で1太刀だけ○を付けてから、`http://localhost:3461/techniques.html` を開いて確かめる。

1. 対象の `<select>` に「雛形（新規大会の初期値）」と大会一覧が出る。
2. 大会を選ぶと見出しが「〈大会名〉 の技リスト」になり、URL のハッシュが `#<大会ID>` になる。
3. 採点済みの選手がいる大会では「採点済みの選手が 1 名います。…」の黄色い注意が出る。
4. 技名を1つ空にして「保存」を押すと `n 行目の技名が空です` の alert が出る。
5. 技名を戻して「保存」を押すと「保存しました。」が出て、採点画面でその大会を開くと新しい配点で計算される。
6. 「別の大会からコピー」で別の大会を選ぶと表が入れ替わり、保存するまで対象の大会は変わらない。
7. 「雛形に戻す」で雛形の内容に戻る。
8. 表を編集してから対象を切り替えると「編集中の内容は保存されていません。」の確認が出る。

- [ ] **Step 4: コミットする**

```
git add techniques.html && git commit -m "feat: 技術リスト編集で雛形と大会を切り替えられるようにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task A7: マニュアルを大会ごとの配点に合わせる

**Files:**
- Modify: `help.html`（§1「大会前の準備」126-128 付近、§1「技の選び方」212-227 付近、§3「技の配点を変える」403-406 付近、§5「技が見つからない」569-578 付近）
- Test: なし

- [ ] **Step 1: §1「大会前の準備」を直す**

`help.html` の `<h3>大会前の準備</h3>` の次の `<p>` と `<div class="note">`

```html
    <p>前日までに <span class="ui">技術リスト編集</span>（<code>techniques.html</code>）を開いて、技名と配点が今年のものになっているか確かめてください。</p>
    <div class="note">大会が始まってから配点を変えると、すでに採点した選手の得点は変わらないまま、新しい配点との食い違いが残ります。配点の確認は必ず大会の前に済ませてください。</div>
```

を次に置き換える。

```html
    <p>前日までに <span class="ui">技術リスト編集</span>（<code>techniques.html</code>）を開いて、技名と配点が今年のものになっているか確かめてください。</p>
    <p><span class="term">配点は大会ごとです。</span>画面の上の <span class="ui">編集する対象</span> で、<span class="ui">雛形（新規大会の初期値）</span> かどの大会かを選びます。雛形を直しても、すでにある大会の配点は変わりません。大会を作る前に雛形を直しておくと、その後に作る大会にそのまま入ります。</p>
    <div class="note">大会が始まってから配点を変えると、すでに採点した選手の得点は変わらないまま、新しい配点との食い違いが残ります。配点の確認は必ず大会の前に済ませてください。</div>
```

- [ ] **Step 2: §1「技の選び方」に配点の出どころを足す**

`help.html` の §1「技の選び方」の

```html
    <p>技は一巡目・二巡目とも3つ入れるのが基本です。事情があれば2つでも採点はできます。</p>
```

を次に置き換える。

```html
    <p>技は一巡目・二巡目とも3つ入れるのが基本です。事情があれば2つでも採点はできます。</p>
    <p>ここに出る技と配点は<span class="term">その大会のもの</span>です。直すときは、運営画面の右上 <span class="ui">⋯</span> → <span class="ui">🗒 技術リスト編集</span>（選択中の大会のものが開きます）、または採点画面の上のリンク <span class="ui">技術リスト編集</span> から開きます。</p>
```

- [ ] **Step 3: §3「技の配点を変える」を直す**

`help.html` の §3 の

```html
    <p>配点は <span class="ui">技術リスト編集</span>（<code>techniques.html</code>）で変えられます。技名ごとに <span class="ui">初太刀</span> から <span class="ui">四ノ太刀</span> までの点を入れ、<span class="ui">保存</span> を押します。</p>
    <div class="note">配点を変えても、すでに採点した選手の得点は変わりません。変えたときは、その技を使った選手を採点画面で開き直して採点し直してください。大会が始まってからの変更は避けてください。</div>
```

を次に置き換える。

```html
    <p>配点は <span class="ui">技術リスト編集</span>（<code>techniques.html</code>）で<span class="term">大会ごとに</span>変えられます。画面の上の <span class="ui">編集する対象</span> で大会を選び、技名ごとに <span class="ui">初太刀</span> から <span class="ui">四ノ太刀</span> までの点を入れ、<span class="ui">保存</span> を押します。</p>
    <ul>
      <li><span class="ui">雛形（新規大会の初期値）</span> を変えても、すでにある大会の配点は変わりません。雛形はこれから作る大会に入る初期値です。</li>
      <li><span class="ui">雛形に戻す</span> を押すと、その大会の配点を雛形の内容で置き換えます。</li>
      <li><span class="ui">別の大会からコピー</span> で、ほかの大会の配点を表に読み込めます。<span class="ui">保存</span> を押すまでは反映されません。</li>
    </ul>
    <div class="note">配点を変えても、すでに採点した選手の得点は変わりません。変えたときは、その技を使った選手を採点画面で開き直して採点し直してください。大会が始まってからの変更は避けてください。採点済みの選手がいる大会を開くと、画面に人数の注意が出ます。</div>
```

- [ ] **Step 4: §5「技が見つからない」を直す**

`help.html` の §5 の

```html
    <p>技を選ぶシートの絞り込みに出てこない、あるいは採点表の行がまるごと灰色になるときは、その技名が <span class="ui">技術リスト編集</span> にあるか確かめてください。</p>
```

を次に置き換える。

```html
    <p>技を選ぶシートの絞り込みに出てこない、あるいは採点表の行がまるごと灰色になるときは、その技名が <span class="ui">技術リスト編集</span> にあるか確かめてください。配点は大会ごとなので、<span class="term">その大会を選んで</span>から確かめます（画面の上の <span class="ui">編集する対象</span>）。</p>
```

- [ ] **Step 5: ブラウザで確かめる**

`http://localhost:3461/help.html` を開き、§1 と §3 と §5 の該当箇所が崩れていないことを確かめる。

- [ ] **Step 6: コミットする**

```
git add help.html && git commit -m "docs: 配点が大会ごとになったことをマニュアルに書く" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

**トラック A はここまで。master にマージしてからトラック B に進む。**

---

# トラック B（一括エクスポート／インポート）

### Task B1: `Storage.bundleFilename`（純粋関数）

**Files:**
- Modify: `storage.js`（`downloadHtml` 32-34 の直後）
- Test: `test.html`（`await runApiTests();`（1386行）の直前に新しい節を追加）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の1386行 `await runApiTests();` の直前に追記する。

```js
    // storage.js テスト（大会ファイルのファイル名。純粋関数）
    var h2s = document.createElement('h2');
    h2s.textContent = 'storage.js';
    results.appendChild(h2s);

    assert('bundleFilename: 大会名と日付を並べる',
      Storage.bundleFilename('名古屋城決戦', '2025-10-25'),
      'tameshigiri_2025-10-25_名古屋城決戦.json');
    assert('bundleFilename: 使えない文字は _ にする',
      Storage.bundleFilename('a/b\\c:d*e?f"g<h>i|j', '2025-10-25'),
      'tameshigiri_2025-10-25_a_b_c_d_e_f_g_h_i_j.json');
    assert('bundleFilename: 制御文字も _ にする',
      Storage.bundleFilename('a\nb\tc', '2025-10-25'),
      'tameshigiri_2025-10-25_a_b_c.json');
    assert('bundleFilename: 大会名は40文字で切る',
      Storage.bundleFilename('あ'.repeat(45), '2025-10-25'),
      'tameshigiri_2025-10-25_' + 'あ'.repeat(40) + '.json');
    assert('bundleFilename: 日付が無ければ nodate',
      Storage.bundleFilename('大会', ''), 'tameshigiri_nodate_大会.json');
    assert('bundleFilename: 日付の形が違えば nodate',
      Storage.bundleFilename('大会', '2025/10/25'), 'tameshigiri_nodate_大会.json');
    assert('bundleFilename: 大会名が空なら「大会」',
      Storage.bundleFilename('', '2025-10-25'), 'tameshigiri_2025-10-25_大会.json');
    assert('bundleFilename: 前後の空白は落とす',
      Storage.bundleFilename('  名古屋  ', '2025-10-25'), 'tameshigiri_2025-10-25_名古屋.json');
    assert('bundleFilename: null でも落ちない',
      Storage.bundleFilename(null, null), 'tameshigiri_nodate_大会.json');

```

- [ ] **Step 2: テストが失敗することを確認する**

`http://localhost:3461/test.html` を開き、`storage.js` の節の assert が ✗ になる（または `Storage.bundleFilename is not a function` で止まる）ことを確かめる。

- [ ] **Step 3: `storage.js` に足す**

`storage.js` の `downloadHtml`（32-34行）の閉じ括弧の直後に追加する。

```js

  // 大会を1ファイルに書き出すときのファイル名。
  //   bundleFilename('名古屋城決戦', '2025-10-25') → 'tameshigiri_2025-10-25_名古屋城決戦.json'
  // Windows / macOS のファイル名に使えない文字と制御文字を '_' に置き換え、大会名は40文字で切る。
  // サーバー（server/index.js の bundleFilename）にも同じ規則の実装があり、
  // そちらは Content-Disposition 用。画面はサーバーのヘッダーを使わずこちらで組む。
  function bundleFilename(name, date) {
    var safe = String(name == null ? '' : name)
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/[\x00-\x1f\x7f]/g, '_')
      .slice(0, 40)
      .trim();
    if (!safe) safe = '大会';
    var d = String(date == null ? '' : date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = 'nodate';
    return 'tameshigiri_' + d + '_' + safe + '.json';
  }
```

`storage.js` の公開一覧（67-75行）の `downloadHtml: downloadHtml,` の直後に足す。

```js
    bundleFilename: bundleFilename,
```

- [ ] **Step 4: テストを通す**

テストを再読み込みし、`failed` が 0 であることを確かめる。

- [ ] **Step 5: コミットする**

```
git add storage.js test.html && git commit -m "feat: 大会ファイルのファイル名を組む関数を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B2: 大会を1ファイルに書き出す API

**Files:**
- Modify: `server/index.js`（`GET /api/events/:id/export` の閉じ括弧 837行の直後に新しい節を追加）
- Modify: `api.js`（`exportCsv` 189-199 の直後、公開一覧）
- Test: `test.html`（`runApiTests()` の末尾）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests()` の末尾（閉じ括弧 `}` の直前。トラック A で足したブロックがあればその直後）に追記する。

```js

    // --- 大会のエクスポート（bundle。トラックB） ---
    var b2Event = await Api.saveEvent({ name: 'バンドルテスト', date: '2026-09-14', venue: '道場', players: [] });
    var b2Bulk = await Api.createPlayersBulk(b2Event.id, {
      court: 'A', isFemale: false, isNewFace: true, names: ['束 太郎']
    });
    var b2Player = b2Bulk.players[0];
    await Api.updatePlayerInfo(b2Event.id, b2Player.id, {
      tech1: '真', result: '11   ', adjust: [2, 0, 0], totalAdjust: 1,
      note: 'メモ', confirmed: true, score: 15
    });
    await Api.addHistory(b2Event.id, { action: 'test_entry', detail: 'バンドル履歴' });
    await Api.createShareLink(b2Event.id);
    await Api.putLive(b2Event.id, 'A', { playerId: b2Player.id });

    var b2Text = await Api.exportBundle(b2Event.id);
    var b2 = JSON.parse(b2Text);
    assert('bundle は format と version を持つ', [b2.format, b2.version], ['phx-tameshigiri-event', 1]);
    assert('bundle は書き出し時刻を持つ', typeof b2.exportedAt, 'string');
    assert('bundle は元の大会IDを参照用に持つ', b2.sourceEventId, b2Event.id);
    assert('bundle は大会情報を持つ',
      [b2.event.name, b2.event.date, b2.event.venue], ['バンドルテスト', '2026-09-14', '道場']);
    assert('bundle は技リストを持つ', Array.isArray(b2.event.techniques), true);
    assert('bundle の技リストは空でない', b2.event.techniques.length > 0, true);
    assert('bundle は選手の全項目を持つ',
      [b2.event.players[0].name, b2.event.players[0].order, b2.event.players[0].tech1,
       b2.event.players[0].score, b2.event.players[0].isNewFace, b2.event.players[0].result,
       b2.event.players[0].adjust, b2.event.players[0].totalAdjust,
       b2.event.players[0].note, b2.event.players[0].confirmed],
      ['束 太郎', 'A-男子-1-1', '真', 15, true, '11   ', [2, 0, 0], 1, 'メモ', true]);
    assert('bundle は履歴を持つ', b2.history.length, 1);
    assert('bundle は shareToken を含まない', b2Text.indexOf('shareToken'), -1);
    assert('bundle は live を含まない', b2Text.indexOf('"live"'), -1);
    assert('存在しない大会の bundle は null', await Api.exportBundle('zzzzzzzznotexist'), null);
    await Api.deleteEvent(b2Event.id);
```

- [ ] **Step 2: テストが失敗することを確認する**

`Api.exportBundle is not a function` で止まることを確かめる。

- [ ] **Step 3: サーバーに書き出しの節を足す**

`server/index.js` の `GET /api/events/:id/export` の閉じ括弧（837行 `});`）の直後に追加する（トラック A で足した `── Event Techniques API ──` の節がここにあるなら、その節の直後に置く）。

```js

// ── Event Bundle API（大会1件の書き出し・取り込み） ──
// 大会情報＋技マスタ＋選手（全項目）＋採点履歴を1つの JSON にまとめる。
// 共有トークン（shareToken）と配信ボードの状態（live）は出さない。取り込み先で作り直す。

const BUNDLE_FORMAT = 'phx-tameshigiri-event';
const BUNDLE_VERSION = 1;

// Content-Disposition に入れるファイル名。
// クライアント側の同じ規則の実装は storage.js の Storage.bundleFilename
// （画面はサーバーのヘッダーを使わず自分で組む。規則が食い違ったら test.html の
//  bundleFilename のテストとこの関数を突き合わせること）。
function bundleFilename(name, date) {
  let safe = String(name == null ? '' : name)
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .slice(0, 40)
    .trim();
  if (!safe) safe = '大会';
  let d = String(date == null ? '' : date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = 'nodate';
  return 'tameshigiri_' + d + '_' + safe + '.json';
}

// エクスポートに出す選手の項目。ここに無いキーは出さない。
// adjust / totalAdjust / note / confirmed / sourcePlayerId は持っている選手にだけ付ける。
function pickBundlePlayer(p) {
  const src = (p && typeof p === 'object') ? p : {};
  const out = {
    id: typeof src.id === 'string' ? src.id : '',
    name: typeof src.name === 'string' ? src.name : '',
    order: typeof src.order === 'string' ? src.order : '',
    tech1: typeof src.tech1 === 'string' ? src.tech1 : '',
    tech2: typeof src.tech2 === 'string' ? src.tech2 : '',
    tech3: typeof src.tech3 === 'string' ? src.tech3 : '',
    score: typeof src.score === 'number' ? src.score : 0,
    isNewFace: src.isNewFace === true,
    isFemale: src.isFemale === true,
    result: typeof src.result === 'string' ? src.result : ''
  };
  if (Array.isArray(src.adjust)) out.adjust = src.adjust.slice();
  if (Number.isFinite(src.totalAdjust)) out.totalAdjust = src.totalAdjust;
  if (typeof src.note === 'string' && src.note !== '') out.note = src.note;
  if (src.confirmed === true) out.confirmed = true;
  if (isValidId(src.sourcePlayerId)) out.sourcePlayerId = src.sourcePlayerId;
  return out;
}

// GET /api/events/:id/bundle : 大会1件を丸ごと書き出す
app.get('/api/events/:id/bundle', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    const historyPath = path.join(HISTORY_DIR, `${req.params.id}.json`);
    let entries = [];
    if (fs.existsSync(historyPath)) {
      try {
        const h = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        if (Array.isArray(h.entries)) entries = h.entries;
      } catch (e) {
        // 履歴が壊れていても大会の書き出しは止めない
      }
    }
    const bundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      sourceEventId: typeof event.id === 'string' ? event.id : req.params.id,
      event: {
        name: event.name || '',
        date: event.date || '',
        venue: event.venue || '',
        createdAt: event.createdAt || '',
        updatedAt: event.updatedAt || '',
        // 雛形を使っている大会も複製を書き出す。取り込み先の雛形に依存させない。
        techniques: effectiveTechniques(event),
        players: (Array.isArray(event.players) ? event.players : []).map(pickBundlePlayer)
      },
      history: entries
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" +
      encodeURIComponent(bundleFilename(bundle.event.name, bundle.event.date)));
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: api.js に `exportBundle` を足す**

`api.js` の `exportCsv`（189-199行）の閉じ括弧の直後に追加する。

```js

  // --- Event Bundle（大会1件の書き出し・取り込み） ---
  async function exportBundle(eventId) {
    // GET /api/events/:eventId/bundle
    // 戻り値: JSON 文字列 | null（400/404/通信失敗）
    // ファイル名はサーバーの Content-Disposition を使わず Storage.bundleFilename で組む。
    try {
      var res = await fetch('/api/events/' + eventId + '/bundle');
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      return null;
    }
  }
```

`api.js` の公開一覧の `exportCsv: exportCsv,` の直後に足す。

```js
    exportBundle: exportBundle,
```

- [ ] **Step 5: テストを通す**

サーバーを再起動してテストを再読み込みし、`failed` が 0 であることを確かめる。

- [ ] **Step 6: コミットする**

```
git add server/index.js api.js test.html && git commit -m "feat: 大会を丸ごと1ファイルに書き出す API を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B3: 大会ファイルを取り込む API

**Files:**
- Modify: `server/index.js`（`GET /api/events/:id/bundle` の閉じ括弧の直後、ルート一覧コメント 300行付近）
- Modify: `api.js`（`exportBundle` の直後、公開一覧）
- Test: `test.html`（`runApiTests()` の末尾、Task B2 で足したブロックの直後）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の `runApiTests()` の末尾（Task B2 のブロックの `await Api.deleteEvent(b2Event.id);` の次の行）に追記する。

```js

    // --- 大会の取り込み（import） ---
    var b3Bundle = {
      format: 'phx-tameshigiri-event',
      version: 1,
      exportedAt: '2026-09-14T00:00:00.000Z',
      sourceEventId: 'sourceevent1',
      event: {
        id: 'sourceevent1',
        shareToken: 'tokentok',
        live: { A: { playerId: 'p1' } },
        name: ' 取り込みテスト ',
        date: '2026-09-14',
        venue: '会場',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
        techniques: [{ name: '取込技', strikes: [9, null, null, null] }],
        players: [
          { id: 'p1', name: '取込 甲', order: 'A-男子-1-1', tech1: '取込技', tech2: '', tech3: '',
            score: 9, isNewFace: true, isFemale: false, result: '1    ',
            adjust: [1, 0, 0], totalAdjust: 2, note: 'メモ', confirmed: true, secret: 'x' },
          { id: 'p2', name: '取込 甲', order: 'A-男子-2-1', tech1: '', tech2: '', tech3: '',
            score: 0, isNewFace: true, isFemale: false, result: '', sourcePlayerId: 'p1' },
          { id: '../bad', name: '取込 乙', order: 'A-男子-1-2', tech1: '', tech2: '', tech3: '',
            score: 0, isNewFace: false, isFemale: false, result: 'xx' }
        ]
      },
      history: [{ action: 'imported', detail: '取り込み履歴' }]
    };
    var b3Res = await Api.importBundle(b3Bundle);
    assert('importBundle は成功と人数を返す', [b3Res.success, b3Res.playerCount], [true, 3]);
    assert('取り込んだ大会のIDは元と違う', b3Res.id !== 'sourceevent1', true);
    var b3Loaded = await Api.loadEvent(b3Res.id);
    assert('大会名は trim される', b3Loaded.name, '取り込みテスト');
    assert('会場が復元される', b3Loaded.venue, '会場');
    assert('技リストが復元される', b3Loaded.techniques,
      [{ name: '取込技', strikes: [9, null, null, null] }]);
    var b3P1 = b3Loaded.players[0], b3P2 = b3Loaded.players[1], b3P3 = b3Loaded.players[2];
    assert('選手の項目が復元される',
      [b3P1.name, b3P1.order, b3P1.tech1, b3P1.score, b3P1.isNewFace, b3P1.result,
       b3P1.adjust, b3P1.totalAdjust, b3P1.note, b3P1.confirmed],
      ['取込 甲', 'A-男子-1-1', '取込技', 9, true, '1    ', [1, 0, 0], 2, 'メモ', true]);
    assert('許可リスト外のキーは落ちる', b3P1.secret, undefined);
    assert('有効で一意な選手IDはそのまま使う', b3P1.id, 'p1');
    assert('sourcePlayerId は取り込み後のIDを指す', b3P2.sourcePlayerId, b3P1.id);
    assert('不正な選手IDは振り直す', b3P3.id === '../bad', false);
    assert('振り直した選手IDも有効なID', /^[A-Za-z0-9_-]{1,64}$/.test(b3P3.id), true);
    assert('0と1と空白以外の result は空にする', b3P3.result, '');
    assert('shareToken は取り込まない', b3Loaded.shareToken, undefined);
    assert('live は取り込まない', b3Loaded.live, undefined);
    assert('createdAt は取り込み時刻で付け直す', b3Loaded.createdAt === '2020-01-01T00:00:00.000Z', false);
    var b3Hist = await Api.loadHistory(b3Res.id);
    assert('履歴が書かれる', b3Hist.entries.length, 1);
    assert('履歴に timestamp が付く', typeof b3Hist.entries[0].timestamp, 'string');
    await Api.deleteEvent(b3Res.id);

    // 検証（4xx は理由を返す）
    var b3BadFormat = await Api.importBundle({ format: 'x', version: 1, event: { name: 'a' } });
    assert('format 違いは断る', b3BadFormat.error, 'このアプリのエクスポートファイルではありません');
    var b3BadVer = await Api.importBundle({ format: 'phx-tameshigiri-event', version: 99, event: { name: 'a' } });
    assert('version 違いは断る', b3BadVer.error, '対応していないファイル形式です（version: 99）');
    var b3NoName = await Api.importBundle({ format: 'phx-tameshigiri-event', version: 1, event: { name: '   ' } });
    assert('大会名が空なら断る', b3NoName.error, '大会名が不正です（1〜100文字）');
    var b3Many = [];
    for (var b3i = 0; b3i < 2001; b3i++) b3Many.push({ name: '大量' + b3i });
    var b3TooMany = await Api.importBundle({ format: 'phx-tameshigiri-event', version: 1,
      event: { name: '上限テスト', players: b3Many } });
    assert('選手2001名は断る', b3TooMany.error, '選手は2000名までです');
    var b3BadTech = await Api.importBundle({ format: 'phx-tameshigiri-event', version: 1,
      event: { name: '技不正テスト', techniques: [{ name: '', strikes: [1, null, null, null] }] } });
    assert('技リストの不正は行番号つきで断る', b3BadTech.error, '技リスト: 1 行目の技名が空です');

    // 技リストが無ければ雛形を複製する
    var b3NoTech = await Api.importBundle({ format: 'phx-tameshigiri-event', version: 1,
      event: { name: '技なしテスト', players: [] } });
    var b3NoTechLoaded = await Api.loadEvent(b3NoTech.id);
    assert('技リストが無ければ雛形の複製が入る',
      b3NoTechLoaded.techniques, (await Api.loadTechniques()).techniques);
    await Api.deleteEvent(b3NoTech.id);
```

- [ ] **Step 2: テストが失敗することを確認する**

`Api.importBundle is not a function` で止まることを確かめる。

- [ ] **Step 3: 取り込みルートを足す**

`server/index.js` の `GET /api/events/:id/bundle` の閉じ括弧（`});`）の直後に追加する。

```js

// POST /api/events/import : エクスポートファイル1件を新しい大会として取り込む
// 常に新しい ID を採番する（既存の大会は上書きしない）。
// event の id / shareToken / live は入っていても無視する。
// 大会ファイルと履歴ファイルはどちらも新しい ID の新規作成なので、
// 他端末との read-modify-write の競合は起きない（writeJsonAtomic を2回呼ぶ）。
app.post('/api/events/import', (req, res) => {
  try {
    const bundle = req.body || {};
    if (bundle.format !== BUNDLE_FORMAT) {
      return res.status(400).json({ error: 'このアプリのエクスポートファイルではありません' });
    }
    if (bundle.version !== BUNDLE_VERSION) {
      return res.status(400).json({ error: '対応していないファイル形式です（version: ' + bundle.version + '）' });
    }
    const src = bundle.event;
    if (!src || typeof src !== 'object' || Array.isArray(src)) {
      return res.status(400).json({ error: '大会データがありません' });
    }
    const name = typeof src.name === 'string' ? src.name.trim() : '';
    if (!name || name.length > 100) {
      return res.status(400).json({ error: '大会名が不正です（1〜100文字）' });
    }

    let techniques;
    if (src.techniques === undefined || src.techniques === null) {
      techniques = cloneTechniques(readTechniques().techniques);
    } else {
      const techErr = validateTechniques(src.techniques);
      if (techErr) return res.status(400).json({ error: '技リスト: ' + techErr });
      techniques = cloneTechniques(src.techniques);
    }

    const rawPlayers = (src.players === undefined || src.players === null) ? [] : src.players;
    if (!Array.isArray(rawPlayers)) {
      return res.status(400).json({ error: '選手データが配列ではありません' });
    }
    if (rawPlayers.length > 2000) {
      return res.status(400).json({ error: '選手は2000名までです' });
    }
    const rawHistory = (bundle.history === undefined || bundle.history === null) ? [] : bundle.history;
    if (!Array.isArray(rawHistory)) {
      return res.status(400).json({ error: '履歴が配列ではありません' });
    }
    if (rawHistory.length > 20000) {
      return res.status(400).json({ error: '履歴は20000件までです' });
    }

    const now = new Date().toISOString();

    // 名前の無い行は落とす（CSV インポートと同じ）。ID の割り当ての前に落として、
    // sourcePlayerId が「落とした選手」を指さないようにする。
    const kept = rawPlayers.filter(p => p && typeof p === 'object' && !Array.isArray(p) &&
      typeof p.name === 'string' && p.name.trim() !== '');

    // 選手 ID の割り当て。有効（isValidId）かつファイル内で一意ならそのまま、
    // そうでなければ振り直す。旧 ID → 新 ID の対応を残し、sourcePlayerId を付け替える。
    const usedIds = Object.create(null);
    const idMap = Object.create(null);
    const assigned = kept.map(p => {
      const oldId = typeof p.id === 'string' ? p.id : '';
      let newId;
      if (isValidId(oldId) && !usedIds[oldId]) {
        newId = oldId;
      } else {
        newId = generateId();
        while (usedIds[newId]) newId = generateId();
      }
      usedIds[newId] = true;
      if (oldId && !Object.prototype.hasOwnProperty.call(idMap, oldId)) idMap[oldId] = newId;
      return newId;
    });

    // 許可リストのキーだけを取り込む。それ以外は捨てる。
    const players = kept.map((p, i) => {
      const player = {
        id: assigned[i],
        name: p.name.trim().slice(0, 100),
        order: typeof p.order === 'string' ? p.order.slice(0, 40) : '',
        tech1: typeof p.tech1 === 'string' ? p.tech1.trim().slice(0, 50) : '',
        tech2: typeof p.tech2 === 'string' ? p.tech2.trim().slice(0, 50) : '',
        tech3: typeof p.tech3 === 'string' ? p.tech3.trim().slice(0, 50) : '',
        score: Number.isFinite(p.score) ? p.score : 0,
        isNewFace: p.isNewFace === true,
        isFemale: p.isFemale === true,
        // 結果は 1=○, 0=×, 空白=未入力 のエンコード。それ以外が混じっていたら捨てる
        // （採点画面の decodeResult が読めない文字列を保存しない）。
        result: (typeof p.result === 'string' && p.result.length <= 100 && /^[01 ]*$/.test(p.result))
          ? p.result : ''
      };
      if (Array.isArray(p.adjust) && p.adjust.length === 3 && p.adjust.every(n => Number.isInteger(n))) {
        player.adjust = p.adjust.slice();
      }
      if (Number.isInteger(p.totalAdjust)) player.totalAdjust = p.totalAdjust;
      if (typeof p.note === 'string') {
        const note = p.note.trim().slice(0, 200);
        if (note) player.note = note;
      }
      if (p.confirmed === true) player.confirmed = true;
      // 元ファイルのどの選手も指していない sourcePlayerId は捨てる
      if (typeof p.sourcePlayerId === 'string' &&
          Object.prototype.hasOwnProperty.call(idMap, p.sourcePlayerId)) {
        player.sourcePlayerId = idMap[p.sourcePlayerId];
      }
      return player;
    });

    const id = generateId();
    const event = {
      id: id,
      name: name,
      date: typeof src.date === 'string' ? src.date.slice(0, 20) : '',
      venue: typeof src.venue === 'string' ? src.venue.slice(0, 100) : '',
      createdAt: now,
      updatedAt: now,
      techniques: techniques,
      players: players
    };
    writeJsonAtomic(path.join(EVENTS_DIR, `${id}.json`), event);

    // 履歴はオブジェクトの要素だけ通す。キーが '__proto__' でもプロトタイプを汚さないよう
    // setOwn で写す（computeRanking が氏名の辞書に Object.create(null) を使うのと同じ理由）。
    const entries = rawHistory
      .filter(e => e && typeof e === 'object' && !Array.isArray(e))
      .map(e => {
        const copy = {};
        Object.keys(e).forEach(k => setOwn(copy, k, e[k]));
        if (typeof copy.timestamp !== 'string' || !copy.timestamp) setOwn(copy, 'timestamp', now);
        return copy;
      });
    if (entries.length > 0) {
      writeJsonAtomic(path.join(HISTORY_DIR, `${id}.json`), { eventId: id, entries: entries });
    }

    res.json({ success: true, id: id, playerCount: players.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: ルート一覧コメントに追記する**

`server/index.js` 300行付近の `//   POST   /api/events/:id/import` の行の直後に足す。

```js
//   POST   /api/events/import      （大会ファイルの取り込み。新しい ID で作る）
```

- [ ] **Step 5: api.js に `importBundle` を足す**

`api.js` の `exportBundle` の閉じ括弧の直後に追加する。

```js

  async function importBundle(bundle) {
    // POST /api/events/import
    // Body: エクスポートファイルの JSON をパースしたオブジェクト
    // 戻り値: { success: true, id, playerCount }
    //       | { success: false, error }（4xx: 失敗理由を画面に出すため） | null（通信失敗）
    // 常に新しい大会として追加される（既存の大会は上書きされない）。
    try {
      var res = await fetch('/api/events/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle)
      });
      if (!res.ok) {
        var errJson = await res.json();
        return { success: false, error: errJson.error };
      }
      return await res.json();
    } catch (e) {
      return null;
    }
  }
```

`api.js` の公開一覧の `exportBundle: exportBundle,` の直後に足す。

```js
    importBundle: importBundle,
```

- [ ] **Step 6: テストを通す**

サーバーを再起動してテストを再読み込みし、`failed` が 0 であることを確かめる。

- [ ] **Step 7: コミットする**

```
git add server/index.js api.js test.html && git commit -m "feat: 大会ファイルを新しい大会として取り込む API を足す" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B4: 大会タブの行に「⋯」メニュー（保存・削除）を置く

**Files:**
- Modify: `admin-events.js`（`buildRow` 66-97、`onDelete` 99-112）
- Test: なし（DOM を持つ画面の挙動。Step 3 で手動確認する）

- [ ] **Step 1: 行の「✕」を「⋯」に替え、シートを足す**

`admin-events.js` の `buildRow`（66-97行）と `onDelete`（99-112行）を次に置き換える。

```js
  function buildRow(ev) {
    var row = document.createElement('div');
    row.className = 'row';

    var body = document.createElement('button');
    body.type = 'button';
    body.className = 'row-body';
    var main = document.createElement('span');
    main.className = 'row-main';
    main.textContent = ev.name || '(名称未設定)';
    var sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = (ev.date || '日付なし') + ' ・ ' + (ev.playerCount || 0) + '名';
    body.appendChild(main);
    body.appendChild(sub);
    body.addEventListener('click', function() {
      Admin.navigate('players', ev.id);
    });

    // 行の操作は「⋯」のシートにまとめる（削除だけだった「✕」の置き換え）。
    // タップ目標の大きさは .row-del のまま（44px）。
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'row-del';
    more.textContent = '⋯';
    more.setAttribute('aria-label', (ev.name || '(名称未設定)') + ' の操作');
    more.addEventListener('click', function() {
      openRowMenu(ev);
    });

    row.appendChild(body);
    row.appendChild(more);
    return row;
  }

  // 行の「⋯」メニュー。ファイルに保存と削除。
  function openRowMenu(ev) {
    var body = document.createElement('div');

    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'menu-item';
    btnSave.textContent = '💾 ファイルに保存';
    body.appendChild(btnSave);

    var btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'menu-item';
    btnDel.textContent = '🗑 削除';
    body.appendChild(btnDel);

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn';
    btnClose.textContent = '閉じる';

    var sheet = Admin.openSheet(ev.name || '(名称未設定)', body, [btnClose]);
    btnClose.addEventListener('click', sheet.close);

    btnSave.addEventListener('click', async function() {
      btnSave.disabled = true;
      sheet.lock(true);
      var json = await Api.exportBundle(ev.id);
      btnSave.disabled = false;
      sheet.lock(false);
      if (!json) {
        alert('大会をファイルに保存できませんでした。通信を確認してください。');
        return;   // シートは開いたまま
      }
      // ファイル名はサーバーの Content-Disposition ではなくクライアントで組む
      Storage.downloadText(Storage.bundleFilename(ev.name, ev.date), json,
        'application/json;charset=utf-8');
      sheet.close();
      Admin.toast('ファイルに保存しました');
    });

    btnDel.addEventListener('click', function() {
      sheet.close();
      onDelete(ev);
    });
  }

  async function onDelete(ev) {
    if (!confirm('大会「' + (ev.name || '(名称未設定)') + '」を削除します。\n選手データも一緒に消えます。よろしいですか？')) {
      return;
    }
    var ok = await Api.deleteEvent(ev.id);
    if (!ok) {
      alert('大会の削除に失敗しました。');
      return;
    }
    Admin.toast('大会を削除しました');
    Admin.navigate('events');
  }
```

- [ ] **Step 2: テストが壊れていないことを確認する**

`http://localhost:3461/test.html` を再読み込みし、`failed` が 0 であることを確かめる。

- [ ] **Step 3: 手で確かめる**

`http://localhost:3461/admin.html` の大会タブで、(1) 行の右端が「⋯」になっている、(2) タップするとシートに「💾 ファイルに保存」「🗑 削除」が出る、(3) 「ファイルに保存」で `tameshigiri_<日付>_<大会名>.json` がダウンロードされ、中身が `"format": "phx-tameshigiri-event"` で始まる、(4) 「削除」で今までと同じ確認文言が出る、を確かめる。

- [ ] **Step 4: コミットする**

```
git add admin-events.js && git commit -m "feat: 大会タブの行から大会をファイルに保存できるようにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B5: 大会タブに「📂 取り込む」を置く

**Files:**
- Modify: `admin-events.js`（`render` の見出し 8-23、ファイル末尾 `Admin.registerTab` の直前）
- Test: なし（DOM を持つ画面の挙動。Step 4 で手動確認する）

- [ ] **Step 1: 見出しにボタンを足す**

`admin-events.js` の `render` の中の14-22行

```js
    var btnNew = document.createElement('button');
    btnNew.type = 'button';
    btnNew.className = 'head-btn';
    btnNew.textContent = '＋ 新規大会';
    btnNew.addEventListener('click', openNewSheet);

    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(btnNew);
```

を次に置き換える。

```js
    var btnImport = document.createElement('button');
    btnImport.type = 'button';
    btnImport.className = 'head-btn';
    btnImport.textContent = '📂 取り込む';
    btnImport.addEventListener('click', pickBundle);

    var btnNew = document.createElement('button');
    btnNew.type = 'button';
    btnNew.className = 'head-btn';
    btnNew.textContent = '＋ 新規大会';
    btnNew.addEventListener('click', openNewSheet);

    head.appendChild(h2);
    head.appendChild(spacer);
    head.appendChild(btnImport);
    head.appendChild(btnNew);
```

- [ ] **Step 2: ファイル選択と取り込みを足す**

`admin-events.js` の末尾、`Admin.registerTab('events', { render: render });`（179行）の直前に追加する。

```js
  // admin.html には file input を置かない（DOM は計画3との契約）。その場で作って捨てる。
  function pickBundle() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    var removed = false;
    function cleanup() {
      if (removed) return;
      removed = true;
      window.removeEventListener('focus', onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    }
    // ファイル選択ダイアログをキャンセルすると change は発火しない。
    // cancel イベントが取れる環境ではそれで、取れない環境（フォールバック）では
    // ダイアログを閉じてウィンドウに戻ってきた最初の focus で片付ける。
    // change が先に来た場合はそちらの removeChild が先に効き、cleanup は何もしない。
    function onFocus() {
      // change がこの同じ tick で来ることがある（フォーカスが先に戻る環境）。
      // ここで即 cleanup すると、その change を取りこぼす。
      setTimeout(cleanup, 0);
    }
    input.addEventListener('cancel', cleanup);
    window.addEventListener('focus', onFocus);

    input.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) {
        var reader = new FileReader();
        reader.onload = function(ev) { importBundleText(ev.target.result); };
        reader.onerror = function() { alert('ファイルを読めませんでした。'); };
        reader.readAsText(file, 'UTF-8');
      }
      cleanup();
    });
    input.click();
  }

  async function importBundleText(text) {
    var bundle;
    try {
      bundle = JSON.parse(text);
    } catch (e) {
      alert('ファイルを読めませんでした。');
      return;
    }
    if (!bundle || typeof bundle !== 'object' ||
        bundle.format !== 'phx-tameshigiri-event' || bundle.version !== 1) {
      alert('このアプリのエクスポートファイルではありません。');
      return;
    }
    var name = (bundle.event && bundle.event.name) || '';
    var date = (bundle.event && bundle.event.date) || '';

    // 取り込みは常に新しい大会として追加される。同名・同日があれば先に断りを入れる。
    var existing = await Api.listEvents();
    if (Array.isArray(existing)) {
      var dup = existing.filter(function(e) {
        return String(e.name || '').trim() === String(name).trim() &&
               String(e.date || '') === String(date);
      });
      if (dup.length > 0 &&
          !confirm('同じ名前と日付の大会が既にあります。\n別の大会として追加しますか？')) {
        return;
      }
    }

    var result = await Api.importBundle(bundle);
    if (!result) {
      alert('取り込みに失敗しました。通信を確認してください。');
      return;
    }
    if (!result.success) {
      alert('取り込みに失敗しました。\n' + (result.error || ''));
      return;
    }
    Admin.toast('大会を取り込みました（' + (result.playerCount || 0) + '名）');
    Admin.navigate('players', result.id);
  }

```

- [ ] **Step 3: テストが壊れていないことを確認する**

`http://localhost:3461/test.html` を再読み込みし、`failed` が 0 であることを確かめる。

- [ ] **Step 4: 手で確かめる**

1. 大会タブで適当な大会の「⋯」→「💾 ファイルに保存」で JSON を保存する。
2. 見出しの「📂 取り込む」でその JSON を選ぶ。「同じ名前と日付の大会が既にあります。別の大会として追加しますか？」が出て、OK で選手タブに移り、トーストに人数が出る。
3. 一覧に同名の大会が2件並び、ID が別であること（行をタップしたときの URL のハッシュ）を確かめる。
4. 中身が JSON でないファイル（例: `data_0.csv`）を選ぶと「ファイルを読めませんでした。」が出る。
5. `{"format":"x"}` だけを書いた JSON を選ぶと「このアプリのエクスポートファイルではありません。」が出る。
6. 取り込んだ大会を採点画面で開き、元の大会と同じ配点・同じ得点で見えることを確かめる。

- [ ] **Step 5: コミットする**

```
git add admin-events.js && git commit -m "feat: 大会タブで大会ファイルを取り込めるようにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B6: 運営画面の⋯メニューに「💾 大会をファイルに保存」を足す

**Files:**
- Modify: `admin.js`（`openAdminMenu` 325-381）
- Test: なし（DOM を持つ画面の挙動。Step 3 で手動確認する）

- [ ] **Step 1: メニュー項目を足す**

`admin.js` の `openAdminMenu` の中の337-341行

```js
    var btnTechniques = document.createElement('button');
    btnTechniques.type = 'button';
    btnTechniques.className = 'menu-item';
    btnTechniques.textContent = '🗒 技術リスト編集';
    body.appendChild(btnTechniques);
```

の直後に足す。

```js

    // 大会を選んでいるときだけ出す（どの大会を保存するのか決まらないため）
    var btnBundle = null;
    if (currentEventId()) {
      btnBundle = document.createElement('button');
      btnBundle.type = 'button';
      btnBundle.className = 'menu-item';
      btnBundle.textContent = '💾 大会をファイルに保存';
      body.appendChild(btnBundle);
    }
```

- [ ] **Step 2: 押したときの動きを足す**

`admin.js` の `openAdminMenu` の末尾、`btnHelp.addEventListener(...)` の閉じ括弧（380行 `});`）の直後、関数の閉じ括弧（381行 `}`）の直前に足す。

```js

    if (btnBundle) {
      btnBundle.addEventListener('click', async function() {
        // await をまたぐので、対象の大会をここで固定する
        var eventId = currentEventId();
        if (!eventId) return;
        btnBundle.disabled = true;
        sheet.lock(true);
        // ファイル名に使う大会名と日付は大会データから取る
        var ev = await Api.loadEvent(eventId);
        var json = ev ? await Api.exportBundle(eventId) : null;
        btnBundle.disabled = false;
        sheet.lock(false);
        if (!ev || !json) {
          alert('大会をファイルに保存できませんでした。通信を確認してください。');
          return;   // シートは開いたまま
        }
        Storage.downloadText(Storage.bundleFilename(ev.name, ev.date), json,
          'application/json;charset=utf-8');
        sheet.close();
        toast('ファイルに保存しました');
      });
    }
```

- [ ] **Step 3: 手で確かめる**

`http://localhost:3461/admin.html` で、(1) 大会タブ（大会未選択）で ⋯ を開くと「💾 大会をファイルに保存」が出ない、(2) 大会を選んで選手タブに入ってから ⋯ を開くと出る、(3) 押すと JSON がダウンロードされ、トーストが出てシートが閉じる、を確かめる。あわせて `http://localhost:3461/test.html` の `failed` が 0 のままであることを確かめる。

- [ ] **Step 4: コミットする**

```
git add admin.js && git commit -m "feat: 運営画面のメニューから大会をファイルに保存できるようにする" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task B7: マニュアルに大会ファイルの保存と取り込みを書く

**Files:**
- Modify: `help.html`（§1 の大会タブの図の説明 138-141 付近、§1「大会を作る」の直後、§4 の末尾、§5「二巡目を生成できない」の直後）
- Test: なし

- [ ] **Step 1: 大会タブの図の説明を直す（「✕」は無くなった）**

`help.html` の §1 の

```html
      <figcaption>大会タブ。1件ごとに日付と人数が出ます。右の <span class="ui">✕</span> はその大会の削除です。</figcaption>
```

を次に置き換える。

```html
      <figcaption>大会タブ。1件ごとに日付と人数が出ます。右の <span class="ui">⋯</span> から <span class="ui">💾 ファイルに保存</span> と <span class="ui">🗑 削除</span> を選べます。</figcaption>
```

- [ ] **Step 2: §1 に「別のサーバーや PC から取り込む」を足す**

`help.html` の §1 の `<h3>選手を登録する</h3>` の直前に足す。

```html
    <h3>別のサーバーや PC から取り込む</h3>
    <p>ほかのサーバーで作った大会を、そのまま持ってこられます。大会情報・技の配点・選手（採点済みの得点も）・採点履歴が一緒に入ります。</p>
    <ol>
      <li>持ち出す側の運営画面で、大会タブの行の <span class="ui">⋯</span> → <span class="ui">💾 ファイルに保存</span> を押す。<code>tameshigiri_日付_大会名.json</code> が保存されます。</li>
      <li>取り込む側の運営画面で、大会タブの見出しの <span class="ui">📂 取り込む</span> を押し、そのファイルを選ぶ。</li>
      <li><span class="msg">大会を取り込みました（n 名）</span> と出て、選手タブが開きます。</li>
    </ol>
    <div class="note">取り込みは<span class="term">いつも新しい大会として追加</span>されます。同じ名前の大会があっても上書きされません。同じ名前と日付の大会が既にあるときは <span class="msg">同じ名前と日付の大会が既にあります。別の大会として追加しますか？</span> と確認が出ます。共有リンクと配信用ボードのアドレスは持ち込まれないので、取り込んだ側で作り直してください（§4）。</div>

```

- [ ] **Step 3: §4 の末尾に「大会をファイルに保存する」を足す**

`help.html` の §4 の末尾、`<p><a class="back-to-toc" href="#toc">▲ 目次へ</a></p>` の直前（§4 の `</section>` の手前）に足す。

```html
    <h3>大会をファイルに保存する</h3>
    <p>大会1件を丸ごと1つのファイルに書き出せます。大会が終わったあとの控えや、別のサーバーへの持ち出しに使います。</p>
    <ol>
      <li>運営画面の大会タブで、その大会の行の <span class="ui">⋯</span> を押す。</li>
      <li><span class="ui">💾 ファイルに保存</span> を押す。<code>tameshigiri_日付_大会名.json</code> がダウンロードされます。</li>
    </ol>
    <p>大会を選んでいるときは、右上の <span class="ui">⋯</span> → <span class="ui">💾 大会をファイルに保存</span> からも同じことができます。</p>
    <div class="note">共有リンクのトークンと配信用ボードの状態はファイルに入りません。取り込んだ先で <span class="ui">共有リンクをコピー</span> を押して作り直してください（元のリンクとは別の URL になります）。</div>

```

- [ ] **Step 4: §5 に「取り込めない」を足す**

`help.html` の §5 の `<h3>このマニュアルの開き方</h3>` の直前に足す。

```html
    <h3>大会のファイルを取り込めない</h3>
    <ul>
      <li><span class="msg">ファイルを読めませんでした。</span> — 選んだファイルがこのアプリの書き出したものではありません。CSV や画像ではなく、<code>tameshigiri_…json</code> を選んでください。</li>
      <li><span class="msg">このアプリのエクスポートファイルではありません。</span> — 中身は JSON ですが、このアプリの形式ではありません。<span class="ui">⋯</span> → <span class="ui">💾 ファイルに保存</span> で作ったファイルか確かめてください。</li>
      <li><span class="msg">対応していないファイル形式です（version: …）</span> — 新しい版のアプリが書き出したファイルです。取り込む側のアプリを更新してください。</li>
      <li>そのほかの理由（大会名が空、選手が多すぎる、技リストの n 行目が不正）はそのまま画面に出ます。書き出した側でその大会を直してから、もう一度保存し直してください。</li>
    </ul>

```

- [ ] **Step 5: ブラウザで確かめる**

`http://localhost:3461/help.html` を開き、§1・§4・§5 の追記箇所が崩れていないことを確かめる。

- [ ] **Step 6: コミットする**

```
git add help.html && git commit -m "docs: 大会ファイルの保存と取り込みをマニュアルに書く" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 実装時の注意（設計書から動かせない点）

- **書き込み系ハンドラは同期のまま。** 新しく足した `PUT/DELETE /api/events/:id/techniques` と `POST /api/events/import` も `async` にしない。既存大会を書き換えるハンドラは `writeJsonAtomic` 1回。`POST /api/events/import` だけは大会ファイルと履歴ファイルの2回呼ぶが、どちらも新しい ID の新規作成なので他端末と競合しない。
- **`GET /api/events/:id` はファイルを書かない。** 応答に `techniques` と `techniquesSource` を足すだけ。
- **`DELETE /api/events/:id/techniques` は雛形の複製で置き換える。** 雛形との連動状態には戻さない。
- **取り込みは常に新規 ID。** 許可リスト外のキーは捨て、`shareToken` と `live` は無視する。
- **`techniquesSource: 'template'` は新規作成した大会では起きない**（`POST /api/events` が必ず複製を入れるため）。この値はこの機能より前に作られた大会ファイルのための互換パスで、`test.html` からは作れないのでテストしていない。
- **雛形（`custom.json`）をテストで書き換えたら元に戻す。** 戻し忘れると `runApiTests()` 冒頭の「サーバーのデフォルト技術数／定義は data.js と一致」2件がスキップされ、テスト件数が変わる。
