# 選手登録の自動整列 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 選手登録に「⚙ 自動整列」を足し、コートの振り分け（奇数偶数・交互・等分）と各コートの試技順（ゼッケン・名前）を 1 回の API で適用する。ゼッケン未登録の選手は対象外にして赤枠で示し、適用前の並びに 1 回だけ戻せる。

**Architecture:** 規則は `Courts.arrangePlayers`（純粋関数）に置き、画面はその結果 `layout` をプレビューに描き、`POST …/players/arrange` に送る。サーバーは `layout` を検証して全行の order を 1 回で書き直す（原子的）。「元に戻す」は適用前の layout を同じ API に送るだけ。

**Tech Stack:** Express（server/index.js）、素の JS（courts.js・desk-players.js・api.js）、test.html（`npm run test:browser`。サーバー起動が前提）。

**設計書:** `docs/superpowers/specs/2026-10-07-auto-arrange-design.md`

**実装者への注意:** いまのファイルを正とする。`git add` を使わず `git commit -m … -- <ファイル>` でコミット。`git reset` 禁止。開発サーバーは `PORT=3461 node server/index.js`（launch.json の dev-3461）。server/index.js を変えたら再起動。

---

### Task 1: 規則の純粋関数 `Courts.arrangePlayers` / `Courts.arrangePreview`

**Files:**
- Modify: `courts.js`（`sortBy` の下に追加、末尾の公開に 2 つ）
- Test: `test.html`（`compareOrder:` のテストの近く）

- [ ] **Step 1: 失敗するテストを書く**

```js
    // ---- 自動整列（設計書 2026-10-07 auto-arrange §2） ----
    function arP(id, court, no, bib, name, female) {
      var p = { id: id, order: court + '-' + (female ? '女子' : '男子') + '-1-' + no, name: name, isFemale: !!female };
      if (bib !== null) p.bib = bib;
      return p;
    }
    var arPlayers = [
      arP('m1', 'A', 1, 5, 'さとう', false), arP('m2', 'A', 2, 2, 'たなか', false), arP('m3', 'B', 1, 3, 'あべ', false),
      arP('f1', 'A', 1, 4, 'やまだ', true), arP('f2', 'B', 1, null, 'いとう', true),   // f2 はゼッケン無し
      { id: 'r2', order: 'A-男子-2-1', name: 'さとう', isFemale: false, bib: 5, sourcePlayerId: 'm1' },   // 二巡目は対象外
      { id: 'x1', order: '', name: 'コート未定', isFemale: false }   // order が読めない
    ];
    var arA = Courts.arrangePlayers(arPlayers, ['A', 'B'], { assign: 'bibParity', order: 'bib' });
    assert('arrangePlayers: 奇数→A・偶数→B、各コートはゼッケン順。ゼッケン無しは今のコートの末尾',
      arA.layout, [{ court: 'A', ids: ['m3', 'm1'] }, { court: 'B', ids: ['m2', 'f1', 'f2'] }]);
    assert('arrangePlayers: ゼッケン無しは skipped、読めない order は unassigned、二巡目は含めない',
      [arA.skipped, arA.unassigned], [['f2'], ['x1']]);
    var arK = Courts.arrangePlayers(arPlayers, ['A', 'B'], { assign: 'keep', order: 'keep' });
    assert('arrangePlayers: keep/keep は今の並びそのまま（元に戻す用）',
      arK.layout, [{ court: 'A', ids: ['m1', 'm2', 'f1'] }, { court: 'B', ids: ['m3', 'f2'] }]);
    var arAlt = Courts.arrangePlayers(arPlayers, ['A', 'B'], { assign: 'alternate', order: 'keep' });
    assert('arrangePlayers: 名簿順に交互（名簿順＝今の試技順 A の男子→女子→B）',
      arAlt.layout, [{ court: 'A', ids: ['m1', 'f1', 'f2'] }, { court: 'B', ids: ['m2', 'm3'] }]);
    var arHalf = Courts.arrangePlayers(arPlayers, ['A', 'B'], { assign: 'halves', order: 'name' });
    assert('arrangePlayers: 前半・後半で等分（端数は前）、各コートは名前順',
      arHalf.layout, [{ court: 'A', ids: ['m2', 'm1', 'f1'] }, { court: 'B', ids: ['m3', 'f2'] }]);
    var ar3 = Courts.arrangePlayers(arPlayers, ['A', 'B', 'C'], { assign: 'bibParity', order: 'bib' });
    assert('arrangePlayers: 3 コートはゼッケンを 3 で割った余り（1→A, 2→B, 0→C）。ゼッケン無しは今のコートの末尾',
      ar3.layout, [{ court: 'A', ids: ['f1'] }, { court: 'B', ids: ['m2', 'm1', 'f2'] }, { court: 'C', ids: ['m3'] }]);
    assert('arrangePreview: コートごとの人数と先頭（ゼッケン無しは名前だけ）',
      Courts.arrangePreview(arA.layout, arPlayers),
      [{ court: 'A', count: 2, heads: ['No.3　あべ', 'No.5　さとう'] }, { court: 'B', count: 3, heads: ['No.2　たなか', 'No.4　やまだ', 'いとう'] }]);
```

期待値の根拠: `alternate` の名簿順は `compareOrder`（巡目 → コート → 男子 → 女子 → 番号）なので A: m1, m2, f1、B: m3, f2 → 交互に m1→A, m2→B, f1→A, m3→B, f2→A。`halves` は名簿順 5 名を 3・2 に分け、A: m1, m2, f1 を名前順（たなか・さとう・やまだ）、B: m3, f2 を名前順（あべ・いとう）。`order: name` ではゼッケン無しを除外しない（除外はゼッケンを使う規則だけ）。3 コートの `bibParity` は 余り 1 → A（bib 4: f1）、余り 2 → B（bib 2, 5 → m2, m1）、余り 0 → C（bib 3: m3）、f2 はゼッケン無しなので今のコート B の末尾。

- [ ] **Step 2: 失敗を確かめる**

test.html を開く。期待: `Courts.arrangePlayers is not a function`。

- [ ] **Step 3: 実装**

```js
  // ---- 自動整列（設計書 2026-10-07 auto-arrange §2） ----
  // 一巡目で order が読める行を、コートの振り分け（assign）と各コートの試技順（order）で並べ直した
  // layout（コートごとの id の並び）を返す。サーバーの POST …/players/arrange に送る形。
  //   assign: 'keep' | 'bibParity'（ゼッケンをコート数で割った余り。1→courts[0] … 0→末尾）| 'alternate'（名簿順に交互）| 'halves'（名簿順に等分）
  //   order : 'keep'（今の試技順）| 'bib'（ゼッケン順）| 'name'（五十音）
  // ゼッケンを使う規則（bibParity / bib）では、ゼッケンの無い選手は対象外（skipped）にして今のコートの末尾に今の順で残す。
  // 二巡目の行は含めない。order が読めない一巡目の行は unassigned（触らない）。
  // courts は振り分け先の並び（先頭が A）。courts に無いコートにいる選手は assign:'keep' のときだけそのコートの layout を足す。
  function arrangePlayers(players, courts, opts) {
    opts = opts || {};
    var assign = opts.assign || 'keep';
    var order = opts.order || 'keep';
    var usesBib = assign === 'bibParity' || order === 'bib';
    var target = [], unassigned = [];
    (players || []).forEach(function(p) {
      if (!p || roundOf(p) !== 1) return;
      if (orderKey(p).sex === 2) { unassigned.push(p.id); return; }
      target.push(p);
    });
    target.sort(compareOrder);   // 名簿順＝今の試技順
    var hasBib = function(p) { return typeof p.bib === 'number' && isFinite(p.bib); };
    var skipped = usesBib ? target.filter(function(p) { return !hasBib(p); }) : [];
    var active = usesBib ? target.filter(hasBib) : target;

    var list = courts.slice();
    var byCourt = Object.create(null);
    list.forEach(function(c) { byCourt[c] = []; });
    function put(court, p) {
      if (!byCourt[court]) { byCourt[court] = []; list.push(court); }
      byCourt[court].push(p);
    }
    if (assign === 'keep') {
      active.forEach(function(p) { put(courtOf(p), p); });
    } else if (assign === 'bibParity') {
      active.forEach(function(p) {
        var r = p.bib % courts.length;
        put(courts[r === 0 ? courts.length - 1 : r - 1], p);
      });
    } else if (assign === 'alternate') {
      active.forEach(function(p, i) { put(courts[i % courts.length], p); });
    } else if (assign === 'halves') {
      var n = active.length, k = courts.length;
      var base = Math.floor(n / k), extra = n % k, idx = 0;
      courts.forEach(function(c, ci) {
        var take = base + (ci < extra ? 1 : 0);
        active.slice(idx, idx + take).forEach(function(p) { put(c, p); });
        idx += take;
      });
    }
    function cmp(a, b) {
      var c = 0;
      if (order === 'bib') c = bibValue(a) - bibValue(b);
      else if (order === 'name') c = String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      return c !== 0 ? c : compareOrder(a, b);
    }
    list.forEach(function(c) { byCourt[c].sort(cmp); });
    skipped.forEach(function(p) { put(courtOf(p), p); });   // 今のコートの末尾に今の順で
    return {
      layout: list.map(function(c) { return { court: c, ids: byCourt[c].map(function(p) { return p.id; }) }; }),
      skipped: skipped.map(function(p) { return p.id; }),
      unassigned: unassigned
    };
  }

  // プレビューの材料。コートごとの人数と先頭 maxHeads 名（既定 4）の表示文字列（「No.3　あべ」。ゼッケン無しは名前だけ）。
  function arrangePreview(layout, players, maxHeads) {
    var byId = Object.create(null);
    (players || []).forEach(function(p) { if (p && p.id) byId[p.id] = p; });
    var n = maxHeads || 4;
    return (layout || []).map(function(l) {
      return {
        court: l.court,
        count: l.ids.length,
        heads: l.ids.slice(0, n).map(function(id) {
          var p = byId[id] || {};
          return (typeof p.bib === 'number' ? 'No.' + p.bib + '　' : '') + (p.name || '');
        })
      };
    });
  }
```

公開に `arrangePlayers: arrangePlayers, arrangePreview: arrangePreview,` を足す。`bibValue` は既存（ゼッケン無しは 10000）。

- [ ] **Step 4: テストを通す**

期待値は Step 1 の注記どおりに固定する（実装の出力を見て、計算が合っているか手で確かめてから固定する。合わなければ実装を疑う）。`arrangePreview` の heads は既定 4 名なので A は 2 名、B は 3 名。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(courts): 自動整列の規則 arrangePlayers / arrangePreview（設計書 2026-10-07 auto-arrange §2）" -- courts.js test.html
```

---

### Task 2: サーバー `POST …/players/arrange` と `Api.arrangePlayers`

**Files:**
- Modify: `server/index.js`（`POST …/players/reorder` の直後）
- Modify: `api.js`（`reorderPlayers` の直後、末尾の公開）
- Test: `test.html`（API テスト。`reorderPlayers` のテストの近く）

- [ ] **Step 1: 失敗するテストを書く**

```js
    // 自動整列 API（設計書 2026-10-07 auto-arrange §3）
    var agEv = await Api.saveEvent({ name: 'テスト用 自動整列', date: '2026-10-07', venue: '', players: [] });
    var agM1 = await Api.createPlayer(agEv.id, { name: '男1', court: 'A', isFemale: false, isNewFace: false, tech1: '', tech2: '', tech3: '', round: 1, bib: 1 });
    var agM2 = await Api.createPlayer(agEv.id, { name: '男2', court: 'A', isFemale: false, isNewFace: false, tech1: '', tech2: '', tech3: '', round: 1, bib: 2 });
    var agF1 = await Api.createPlayer(agEv.id, { name: '女1', court: 'A', isFemale: true, isNewFace: false, tech1: '', tech2: '', tech3: '', round: 1, bib: 3 });
    var agRes = await Api.arrangePlayers(agEv.id, { layout: [{ court: 'A', ids: [agF1.id, agM1.id] }, { court: 'B', ids: [agM2.id] }] });
    assert('arrange: 成功。分ける大会は番号が性別ごとに 1 から', agRes.ok && agRes.players.slice().sort(Courts.compareOrder).map(function(p) { return p.order + ':' + p.name; }),
      ['A-男子-1-1:男1', 'A-女子-1-1:女1', 'B-男子-1-1:男2']);
    var agMiss = await Api.arrangePlayers(agEv.id, { layout: [{ court: 'A', ids: [agF1.id] }] });
    assert('arrange: 全員が含まれていなければ 400 arrange_mismatch', [agMiss.ok, agMiss.reason], [false, 'arrange_mismatch']);
    var agDup = await Api.arrangePlayers(agEv.id, { layout: [{ court: 'A', ids: [agF1.id, agM1.id, agM1.id] }, { court: 'B', ids: [agM2.id] }] });
    assert('arrange: id の重複は 400', agDup.ok, false);
    var agBad = await Api.arrangePlayers(agEv.id, { layout: [{ court: 'A-B', ids: [agF1.id, agM1.id, agM2.id] }] });
    assert('arrange: コート名の不正は 400', agBad.ok, false);
    // 元に戻す往復（keep/keep の layout を送り返す）
    var agNow = (await Api.loadEvent(agEv.id)).players;
    var agBefore = Courts.arrangePlayers(agNow, ['A', 'B'], { assign: 'keep', order: 'keep' }).layout;
    await Api.arrangePlayers(agEv.id, { layout: [{ court: 'A', ids: [agM2.id, agM1.id, agF1.id] }, { court: 'B', ids: [] }] });
    var agUndo = await Api.arrangePlayers(agEv.id, { layout: agBefore });
    assert('arrange: 元に戻すと order が完全に戻る', agUndo.players.slice().sort(Courts.compareOrder).map(function(p) { return p.order + ':' + p.name; }),
      ['A-男子-1-1:男1', 'A-女子-1-1:女1', 'B-男子-1-1:男2']);
    await Api.changeStatus(agEv.id, 'round1');
    var agLocked = await Api.arrangePlayers(agEv.id, { layout: agBefore });
    assert('arrange: 準備中でなければ 409 not_draft', [agLocked.ok, agLocked.reason], [false, 'not_draft']);
    await Api.changeStatus(agEv.id, 'draft');
    await Api.updateEventInfo(agEv.id, { settings: { mixed: true } });
    var agMix = await Api.arrangePlayers(agEv.id, { layout: [{ court: 'A', ids: [agF1.id, agM1.id] }, { court: 'B', ids: [agM2.id] }] });
    assert('arrange: 混合は男女通し', agMix.players.slice().sort(Courts.compareOrder).map(function(p) { return p.order + ':' + p.name; }),
      ['A-混合-1-1:女1', 'A-混合-1-2:男1', 'B-混合-1-1:男2']);
    await Api.deleteEvent(agEv.id);
```

`Api.changeStatus` の引数の形は api.js の既存テストに合わせる。

- [ ] **Step 2: 失敗を確かめる**（`Api.arrangePlayers is not a function`）

- [ ] **Step 3: サーバー**

`POST /api/events/:id/players/reorder` の直後に:

```js
// POST /api/events/:id/players/arrange : 自動整列（設計書 2026-10-07 auto-arrange §3）
// Body: { layout: [{ court, ids }] }。一巡目で order が読める行の全員を、コートごとの並びで受け取り、
// コートと番号を 1 回で書き直す（原子的）。番号は コート×性別の段（genderSeg）ごとに 1 から。
// 準備中（draft）だけ（409 not_draft）。全員と過不足なく一致しなければ 400 arrange_mismatch。
// rev は上げない（得点・技は変わらない）。「元に戻す」は画面が適用前の layout を送り返す。
app.post('/api/events/:id/players/arrange', (req, res) => {
  try {
    const body = req.body || {};
    const layout = body.layout;
    if (!Array.isArray(layout) || layout.length === 0 || layout.length > 20) {
      return res.status(400).json({ error: 'layout の形式が不正です' });
    }
    const seenCourt = Object.create(null);
    const seenId = Object.create(null);
    let total = 0;
    for (const l of layout) {
      if (!l || typeof l !== 'object' || !isValidCourt(l.court) || !Array.isArray(l.ids)) {
        return res.status(400).json({ error: 'layout の形式が不正です' });
      }
      if (seenCourt[l.court]) return res.status(400).json({ error: 'コートが重複しています' });
      seenCourt[l.court] = true;
      for (const id of l.ids) {
        if (typeof id !== 'string' || id === '' || seenId[id]) {
          return res.status(400).json({ error: '選手IDが不正か重複しています' });
        }
        seenId[id] = true;
        total++;
      }
    }
    if (total > 1000) return res.status(400).json({ error: '選手が多すぎます' });

    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) return res.status(404).json({ error: '大会が見つかりません' });
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    const st = EventStatus.of(event);
    if (st !== 'draft') {
      return res.status(409).json({ error: '自動整列は準備中だけ使えます', reason: 'not_draft', status: st });
    }
    if (!Array.isArray(event.players)) event.players = [];

    // 対象＝一巡目で order が読める行。layout の id の集合と過不足なく一致すること
    const byId = Object.create(null);
    let targetCount = 0;
    event.players.forEach(p => {
      const parsed = parseOrder((p && p.order) || '');
      if (!parsed || parsed.round !== 1) return;
      byId[p.id] = p;
      targetCount++;
    });
    if (targetCount !== total || !Object.keys(seenId).every(id => byId[id])) {
      return res.status(400).json({
        error: '整列する選手が現在の登録と一致しません。画面を読み直してからやり直してください',
        reason: 'arrange_mismatch'
      });
    }

    layout.forEach(l => {
      const next = Object.create(null);   // 性別の段ごとの次の番号
      l.ids.forEach(id => {
        const p = byId[id];
        const seg = genderSeg(event, p.isFemale === true);
        next[seg] = (next[seg] || 0) + 1;
        p.order = buildOrder(l.court, seg, 1, next[seg]);
      });
    });
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({ success: true, players: event.players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

認可（server/authz.js）に経路ごとの表があれば、`reorder` と同じ扱い（運営者だけ）で `arrange` を足す。`grep -n "reorder" server/authz.js` で確かめる。

- [ ] **Step 4: api.js**

`reorderPlayers` の直後に、同じ形で:

```js
  async function arrangePlayers(eventId, body) {
    // POST /api/events/:eventId/players/arrange（PC 運営の選手登録の「⚙ 自動整列」。設計書 2026-10-07）
    // Body: { layout: [{ court, ids }] }。一巡目で order が読める行の全員をコートごとの並びで送る。
    // 戻り値: { ok: true, players } | { ok: false, status, reason, error }
    //   reason: 'not_draft'（409。準備中でない）/ 'locked'（409）/ 'arrange_mismatch'（400）/ ''
    …（reorderPlayers と同じ fetch と戻り値の組み立て。URL だけ /players/arrange）
  }
```

公開に `arrangePlayers: arrangePlayers,` を足す。

- [ ] **Step 5: テストを通す**（サーバー再起動 → test.html）

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(server): POST …/players/arrange（自動整列。準備中だけ・全員一致の検証・1 回で書き直し）（設計書 2026-10-07 auto-arrange §3）" -- server/index.js api.js test.html
```

---

### Task 3: 画面（desk-players.js・desk.css）

**Files:**
- Modify: `desk-players.js`（見出しの帯 140〜160、`buildRow` 1030 付近、`saveCell` の成功経路、新しい関数 `openArrangeDialog` と `renderUndo`）
- Modify: `desk.css`（`.desk-row-attention`、`.desk-row-attention-note`、`.desk-arrange-*`）

- [ ] **Step 1: 状態と帯のボタン**

モジュールの状態に足す:

```js
  // 自動整列（設計書 2026-10-07 auto-arrange §4）
  var undoLayout = null;        // 直前の自動整列の適用前の layout（1 回だけ戻せる）。null なら「元に戻す」は出さない
  var undoEventId = '';         // undoLayout がどの大会のものか（大会が変わったら捨てる）
  var attentionIds = {};        // 適用で対象外になった選手の id → true（赤枠。ゼッケンかコートを直すと消える）
```

`render(container, ctx)` の入口で `if (undoEventId !== ctx.eventId) { undoLayout = null; attentionIds = {}; undoEventId = ctx.eventId; }`。

見出しの帯（`btnCsv` の後）:

```js
    var btnArrange = document.createElement('button');
    btnArrange.type = 'button';
    btnArrange.className = 'desk-btn';
    btnArrange.id = 'btnDeskPlayersArrange';
    btnArrange.textContent = '⚙ 自動整列';
    var isDraft = EventStatus.of(ctx.event) === 'draft';
    btnArrange.disabled = !isDraft;
    if (!isDraft) btnArrange.title = '準備中だけ使えます';
    btnArrange.addEventListener('click', function() { openArrangeDialog(ctx); });
    head.appendChild(btnArrange);
    if (undoLayout && isDraft) {
      var btnUndo = document.createElement('button');
      btnUndo.type = 'button';
      btnUndo.className = 'desk-btn';
      btnUndo.id = 'btnDeskPlayersUndoArrange';
      btnUndo.textContent = '↶ 元に戻す';
      btnUndo.title = '直前の自動整列を取り消します';
      btnUndo.addEventListener('click', function() { undoArrange(ctx, btnUndo); });
      head.appendChild(btnUndo);
    }
```

- [ ] **Step 2: ダイアログ**

```js
  // --- 「⚙ 自動整列」（設計書 2026-10-07 auto-arrange §1・§4） ---
  var ASSIGN_OPTIONS = [
    ['keep', '変えない'], ['bibParity', 'ゼッケンの奇数 → A、偶数 → B'], ['alternate', '名簿順に交互'], ['halves', '前半・後半で等分']
  ];
  var ORDER_OPTIONS = [['bib', 'ゼッケン順'], ['name', '名前順（五十音）'], ['keep', '今の順のまま']];

  function arrangeCourts(ctx) {
    return Courts.listFrom(ctx.players, extraCourts(ctx)).filter(function(c) { return c !== Courts.UNASSIGNED; });
  }

  function openArrangeDialog(ctx) {
    var courts = arrangeCourts(ctx);
    if (courts.length === 0) { alert('コートがありません。基本情報でコートを足してください。'); return; }
    var opts = { assign: 'bibParity', order: 'bib' };
    var body = document.createElement('div');
    body.className = 'desk-form desk-arrange';
    body.appendChild(radioGroup('コートの振り分け', 'arrangeAssign', ASSIGN_OPTIONS.map(function(o) {
      // 3 コート以上では奇数偶数の文言を変える（規則は「コート数で割った余り」）
      return o[0] === 'bibParity' && courts.length > 2 ? [o[0], 'ゼッケンを ' + courts.length + ' で割った余りで ' + courts.join('・') + ' へ'] : o;
    }), opts.assign, function(v) { opts.assign = v; paint(); }));
    body.appendChild(radioGroup('各コートの試技順', 'arrangeOrder', ORDER_OPTIONS, opts.order, function(v) { opts.order = v; paint(); }));
    var pvHead = document.createElement('p');
    pvHead.className = 'desk-note';
    pvHead.textContent = 'プレビュー';
    body.appendChild(pvHead);
    var pv = document.createElement('div');
    pv.className = 'desk-arrange-preview';
    body.appendChild(pv);
    var warn = document.createElement('p');
    warn.className = 'desk-warn';
    body.appendChild(warn);

    var result = null;
    function paint() {
      result = Courts.arrangePlayers(ctx.players || [], courts, opts);
      pv.innerHTML = '';
      Courts.arrangePreview(result.layout, ctx.players || []).forEach(function(c) {
        var box = document.createElement('div');
        box.className = 'desk-arrange-court';
        var h = document.createElement('div');
        h.className = 'desk-arrange-court-head';
        h.textContent = courtLabel(c.court) + '　' + c.count + ' 名';
        box.appendChild(h);
        c.heads.forEach(function(t) { var d = document.createElement('div'); d.textContent = t; box.appendChild(d); });
        if (c.count > c.heads.length) { var m = document.createElement('div'); m.className = 'desk-arrange-more'; m.textContent = '… ほか ' + (c.count - c.heads.length) + ' 名'; box.appendChild(m); }
        pv.appendChild(box);
      });
      var msgs = [];
      if (result.skipped.length > 0) msgs.push('ゼッケン未登録 ' + result.skipped.length + ' 名は対象外です。今のコートの末尾に残し、適用後に赤く示します。');
      if (result.unassigned.length > 0) msgs.push('コート未定 ' + result.unassigned.length + ' 名は対象外です。');
      warn.textContent = msgs.join('\n');
      warn.hidden = msgs.length === 0;
    }
    paint();

    var btnApply = document.createElement('button');
    btnApply.type = 'button';
    btnApply.className = 'desk-btn primary';
    btnApply.textContent = '適用';
    var dialog = Desk.openDialog('自動整列（一巡目）', body, [btnApply]);
    btnApply.addEventListener('click', async function() {
      if (!result) return;
      var eventId = ctx.eventId;
      var before = Courts.arrangePlayers(ctx.players || [], courts, { assign: 'keep', order: 'keep' }).layout;
      btnApply.disabled = true;
      dialog.lock(true);
      var res = await Api.arrangePlayers(eventId, { layout: result.layout });
      if (ctx.isStale()) return;
      if (!res || !res.ok) {
        btnApply.disabled = false;
        dialog.lock(false);
        alert(arrangeFailureMessage(res));
        if (res && res.reason === 'arrange_mismatch') { dialog.close(); await Desk.reloadEvent(); }
        return;
      }
      undoLayout = before;
      undoEventId = eventId;
      attentionIds = {};
      result.skipped.forEach(function(id) { attentionIds[id] = true; });
      dialog.close();
      Desk.toast('自動整列しました');
      await Desk.reloadEvent();
    });
  }

  function arrangeFailureMessage(res) {
    if (res && res.reason === 'locked') return 'この大会は最終結果を確定済みです。編集するには「戻す」を押してください';
    if (res && res.reason === 'not_draft') return '自動整列は準備中だけ使えます。';
    if (res && res.reason === 'arrange_mismatch') return res.error + '\n最新の登録を読み直します。';
    return '自動整列を保存できませんでした。\n' + ((res && res.error) || '通信を確認してください。');
  }

  async function undoArrange(ctx, btn) {
    if (!undoLayout) return;
    var eventId = ctx.eventId;
    btn.disabled = true;
    var res = await Api.arrangePlayers(eventId, { layout: undoLayout });
    if (ctx.isStale()) return;
    if (!res || !res.ok) {
      btn.disabled = false;
      alert(arrangeFailureMessage(res));
      if (res && res.reason === 'arrange_mismatch') { undoLayout = null; attentionIds = {}; await Desk.reloadEvent(); }
      return;
    }
    undoLayout = null;
    attentionIds = {};
    Desk.toast('元に戻しました');
    await Desk.reloadEvent();
  }

  // ラジオの組（desk-form の作法）。onChange(value)
  function radioGroup(labelText, name, options, value, onChange) {
    var wrap = document.createElement('div');
    wrap.className = 'desk-field';
    var lab = document.createElement('div');
    lab.className = 'desk-field-label';
    lab.textContent = labelText;
    wrap.appendChild(lab);
    var row = document.createElement('div');
    row.className = 'desk-radio-row';
    options.forEach(function(o) {
      var l = document.createElement('label');
      var r = document.createElement('input');
      r.type = 'radio'; r.name = name; r.value = o[0]; r.checked = o[0] === value;
      r.addEventListener('change', function() { if (r.checked) onChange(o[0]); });
      l.appendChild(r);
      l.appendChild(document.createTextNode(' ' + o[1]));
      row.appendChild(l);
    });
    wrap.appendChild(row);
    return wrap;
  }
```

`desk-field` / `desk-field-label` は desk-setup.js の `addField` が使う class 名に合わせる（無ければ `addField` の作法を見て同じ class を使う）。`courtLabel` は既存。

- [ ] **Step 3: 赤枠**

`buildRow(ctx, p, locked, band)` の `tr` 生成の直後:

```js
    if (attentionIds[p.id]) tr.classList.add('desk-row-attention');
```

名前セル（`nameCell`）の中に、`attentionIds[p.id]` のとき小さな案内を足す:

```js
      var note = document.createElement('div');
      note.className = 'desk-row-attention-note';
      note.textContent = 'ゼッケンを入れるかコートを選んでください';
      td.appendChild(note);
```

`saveCell` の成功経路で、保存した patch に `bib` か `court` が含まれていて `attentionIds[p.id]` なら `delete attentionIds[p.id]`（表は `Desk.reloadEvent()` か `afterRowEdit` で描き直される。描き直されない経路なら `tr.classList.remove('desk-row-attention')` と note の削除も行う）。

desk.css:

```css
/* 自動整列（設計書 2026-10-07 auto-arrange）。対象外（ゼッケン未登録）の行の赤枠と案内 */
.desk-players-table tr.desk-row-attention td { background: color-mix(in srgb, var(--cell-fail-text) 12%, transparent); }
.desk-players-table tr.desk-row-attention td.col-name { box-shadow: inset 3px 0 0 var(--cell-fail-text); }
.desk-row-attention-note { font-size: 11px; color: var(--cell-fail-text); white-space: nowrap; }
.desk-arrange-preview { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin: 4px 0 8px; }
.desk-arrange-court { border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-size: 13px; }
.desk-arrange-court-head { font-weight: bold; margin-bottom: 2px; }
.desk-arrange-more { color: var(--text-muted); }
.desk-radio-row { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.desk-radio-row label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
```

変数名（`--cell-fail-text`、`--line`、`--text-muted`）は desk.css / theme.css にあるものを使う。`color-mix` が使えない環境を気にするなら `rgba` の固定色でよい。

- [ ] **Step 4: ブラウザで確かめる**

systest のテンプレートから大会を作る（ゼッケン 1〜20 あり）。自動整列を開く → 既定（奇数偶数・ゼッケン順）のプレビューで A に 1,3,5…、B に 2,4,6…。適用 → 表が A: 1,3,5…、B: 2,4,6… の順、トースト、「↶ 元に戻す」が出る → 押すと元の並び。ゼッケンを 2 名分消してから適用 → 2 名が今のコートの末尾で赤枠と案内、ゼッケンを入れると赤枠が消える。試合開始後はボタンが無効。混合の大会でも男女通しで並ぶ。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(desk-players): ⚙ 自動整列（振り分けと試技順のダイアログ、プレビュー、元に戻す、対象外の赤枠）（設計書 2026-10-07 auto-arrange §4）" -- desk-players.js desk.css
```

---

### Task 4: ヘルプ

**Files:**
- Modify: `help.html`（選手登録の節。「試技順の入れ替え」の段落の近く）

- [ ] **Step 1: 段落を足す**

```html
    <p><span class="ui">⚙ 自動整列</span> — <span class="term">準備中だけ</span>使えます。コートの振り分け（<span class="ui">変えない</span> ／ <span class="ui">ゼッケンの奇数 → A、偶数 → B</span>（コートが 3 つ以上のときはゼッケンをコート数で割った余りで順に）／ <span class="ui">名簿順に交互</span> ／ <span class="ui">前半・後半で等分</span>）と、各コートの試技順（<span class="ui">ゼッケン順</span> ／ <span class="ui">名前順（五十音）</span> ／ <span class="ui">今の順のまま</span>）を選ぶと、下にコートごとの人数と先頭の選手が出ます。<span class="ui">適用</span> で一巡目の全員のコートと試技順をまとめて書き換えます（二巡目の行は変わりません）。ゼッケンを使う規則のとき、<span class="term">ゼッケン未登録の選手は対象外</span>です。今のコートの末尾に残り、適用後に赤く示されます（<span class="msg">ゼッケンを入れるかコートを選んでください</span>）。ゼッケンかコートを直すと赤い印は消えます。適用のあと見出しに <span class="ui">↶ 元に戻す</span> が出て、直前の並びに 1 回だけ戻せます（別の大会を開く・区画を離れると戻せなくなります）。他の端末が間に選手を足したり消したりしていると <span class="msg">整列する選手が現在の登録と一致しません。画面を読み直してからやり直してください</span> と出ます。</p>
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs(help): 選手登録の「⚙ 自動整列」（設計書 2026-10-07 auto-arrange §6）" -- help.html
```

---

### Task 5: 全体の確認

- `npm test`、`npm run test:browser`（0 failed）、`node tools/mcp/phx-tameshigiri/test.mjs`。
- Opus レビュー（仕様準拠＋品質を 1 回）。
- master に ff マージ、origin/master と origin/production へ push。
