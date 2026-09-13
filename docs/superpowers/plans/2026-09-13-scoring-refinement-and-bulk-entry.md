# 採点画面の改良と選手一括登録 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 採点画面に補正点（技ごと・全体）・備考・確定・行選択・「未／成功／失敗」表記・下部選手一覧・スマホ対応を入れ、技シートにヘッダーと検索を足し、運営画面に一括登録・簡易 CSV・採点画面への導線を足す。

**Architecture:** 純粋関数（`scoring.js` / `courts.js` / `techpicker.js`）→ サーバー（`server/index.js`）→ 画面（`app.js` / `admin-*.js`）の順に、`test.html` のテストで固定しながら進める。設計書は `docs/superpowers/specs/2026-09-13-scoring-refinement-and-bulk-entry-design.md`。

**Tech Stack:** 素の JavaScript（IIFE モジュール、ビルド無し）、Express 5、ブラウザで開く `test.html`（サーバー起動が必要）。

**トラック（並行実装の単位）**: 同じファイルを触るチケットは同じトラックにまとめる。トラックは git worktree で分け、自分のポートでサーバーを立てる（`server/data/` は gitignore なので worktree ごとに空から始まる。本物の大会「第10回全日本試し斬り大会」は main の worktree にしか無い）。

| トラック | チケット | 触ってよいファイル | ポート |
|---|---|---|---|
| A | T5, T6 | `scoring.js`, `courts.js`, `outbox.js`, `storage.js`, `app.js`, `index.html`, `style.css`, `theme.css`, `server/index.js`（isScored / PATCH / export のみ）, `test.html` | 3461 |
| B | T4 | `techpicker.js`, `admin.css`（TechPicker の節のみ）, `test.html` | 3462 |
| C | T1, T2 | `server/index.js`（bulk / import のみ）, `api.js`, `admin-players.js`, `test.html` | 3463 |
| D | T3 | `admin-round.js`, `admin.css`（進行タブの節のみ） | 3464 |

**共通ルール**
- 設計書の該当節を先に読む。
- `test.html` は `http://localhost:<ポート>/test.html` をブラウザで開いて確認する。ブラウザツールを使うときは自分専用のタブを `tabs_create` で作り、以後は必ずその `tabId` を渡す。編集後の再確認は同じ URL への再 navigate ではなく `location.reload()` か新しいタブで行う（bfcache 対策）。
- サーバーの起動: `PORT=3461 node server/index.js`（worktree のルートで。バックグラウンド実行）。
- `git add` は触ったファイルを明示する。`git add -A` は使わない。
- コミットメッセージは日本語、`<type>: <subject>`。末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 新規の `await` の後で DOM やサーバーに書くときは、運営画面なら `ctx.isStale()`／`Admin.currentEventId()`、採点画面なら `loadSeq` の追い越し判定で古い応答を捨てる。
- `test.html` の既存 267 件を壊さない（変更した仕様に合わせて期待値を直すのは可）。

---

## トラック A（T5 データモデル → T6 採点画面）

### Task A1: Scoring に補正点を入れる（純粋関数）

**Files:**
- Modify: `scoring.js`
- Test: `test.html`（`scoring.js` の節、505〜573行付近）

- [ ] **Step 1: 既存テストを新仕様に書き換え、追加テストを書く**

`test.html` の `scoring.js` 節にある `encodeResult` / `decodeResult` / `calcTotalScore` のテストを次に置き換える（`techPoint` は廃止）。

```js
    // encodeResult / decodeResult テスト
    // 1技=5文字（初/二/三/四の太刀 + 5文字目）。5文字目は互換のため残すが、新しい保存では常に空白。
    var encRows = [
      { techName: '破図味(男)', values: ['○','×','',''], adjust: 3 },
      { techName: '夢想返し',   values: ['○','○','',''], adjust: 0 }
    ];
    var encoded = Scoring.encodeResult(encRows);
    assert('encodeResult 5文字目は空白（補正点は result に入れない）', encoded, '10   11   ');
    var decoded = Scoring.decodeResult(encoded, 2, [3, 0, 0]);
    assert('decodeResult values[0]', decoded[0].values, ['○','×','','']);
    assert('decodeResult adjust[0] は adjust 配列から', decoded[0].adjust, 3);
    assert('decodeResult values[1]', decoded[1].values, ['○','○','','']);
    assert('decodeResult adjust[1]', decoded[1].adjust, 0);
    // 旧データ（adjust 配列を持たない選手）は 5 文字目の '1' を補正点 3 と読み替える
    var legacy = Scoring.decodeResult('10  111   ', 2, undefined);
    assert('decodeResult 旧データ: 技術点○ → 補正点3', legacy[0].adjust, 3);
    assert('decodeResult 旧データ: 技術点空 → 0', legacy[1].adjust, 0);
    var legacyX = Scoring.decodeResult('10  0', 1, null);
    assert('decodeResult 旧データ: 技術点× → 0', legacyX[0].adjust, 0);
    // adjust があるときは 5 文字目を見ない
    var mixed = Scoring.decodeResult('10  1', 1, [0, 0, 0]);
    assert('decodeResult adjust があれば 5 文字目は無視', mixed[0].adjust, 0);
    // adjust の要素が数値でなくても落ちない
    assert('decodeResult adjust に文字列が混ざっても 0', Scoring.decodeResult('     ', 1, ['x', 1, 2])[0].adjust, 0);
    assert('decodeResult adjust は整数に丸める', Scoring.decodeResult('     ', 1, [2.7, 0, 0])[0].adjust, 2);
```

`calcTotalScore` のテストを次に置き換える。

```js
    // calcTotalScore: 全行合計 + 行ごとの補正点 + 全体補正点
    var rows = [
      { techName: '破図味(男)', values: ['○','○','○','○'], adjust: 0 },
      { techName: '夢想返し',   values: ['○','○','',''],   adjust: 3 }
    ];
    // 破図味(男): 20+4+4+2 = 30、夢想返し: 13+5 = 18 + 補正3 = 21 → 合計51
    assert('calcTotalScore', Scoring.calcTotalScore(rows, false, 0), 51);
    assert('calcTotalScore 全体補正点を足す', Scoring.calcTotalScore(rows, false, -5), 46);
    assert('calcTotalScore 全体補正点 省略は 0', Scoring.calcTotalScore(rows, false), 51);
    assert('calcTotalScore 負の補正で負になる', Scoring.calcTotalScore([{ techName: '夢想返し', values: ['','','',''], adjust: -4 }], false, -1), -5);
    assert('calcRowScore 太刀 + 補正', Scoring.calcRowScore('夢想返し', ['○','○','',''], 3, false), 21);
    assert('calcRowScore 補正が文字列でも 0 扱い', Scoring.calcRowScore('夢想返し', ['○','','',''], 'x', false), 13);
    assert('normalizeAdjust 配列でなければ [0,0,0]', Scoring.normalizeAdjust(undefined), [0, 0, 0]);
    assert('normalizeAdjust 足りない要素は 0', Scoring.normalizeAdjust([1]), [1, 0, 0]);
    assert('normalizeAdjust 余分な要素は捨てる', Scoring.normalizeAdjust([1, 2, 3, 4]), [1, 2, 3]);
```

`femaleRows` の行も `techPoint: ''` → `adjust: 0` に直す。

- [ ] **Step 2: テストが落ちることを確認**

Run: サーバー起動後、ブラウザで `http://localhost:3461/test.html`
Expected: `encodeResult 5文字目は空白` などが ✗（`calcRowScore` / `normalizeAdjust` は未定義エラーになるので、その手前で止まる可能性がある。落ちていればよい）。

- [ ] **Step 3: scoring.js を実装**

`scoring.js` の `calcTotalScore` 〜 `encodeResult` を次に置き換え、`return` に追加する。

```js
  // 補正点の配列を [n, n, n]（整数）に正規化する。配列でなければ [0, 0, 0]。
  function normalizeAdjust(adjust) {
    var out = [0, 0, 0];
    if (!Array.isArray(adjust)) return out;
    for (var i = 0; i < 3; i++) {
      var n = Number(adjust[i]);
      out[i] = Number.isFinite(n) ? Math.trunc(n) : 0;
    }
    return out;
  }

  function toInt(n) {
    var v = Number(n);
    return Number.isFinite(v) ? Math.trunc(v) : 0;
  }

  // 1行（1技）の得点 = 太刀の配点合計 + その技の補正点
  function calcRowScore(techName, values, adjust, isFemale) {
    var s = 0;
    for (var i = 0; i < 4; i++) {
      s += calcStrikeScore(techName, i, (values || [])[i], isFemale);
    }
    return s + toInt(adjust);
  }

  // 全行の合計得点 = Σ 行の得点 + 全体補正点
  // rows: [{ techName, values: [v0,v1,v2,v3], adjust: 整数 }, ...]
  function calcTotalScore(rows, isFemale, totalAdjust) {
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      total += calcRowScore(rows[i].techName, rows[i].values, rows[i].adjust, isFemale);
    }
    return total + toInt(totalAdjust);
  }

  // resultエンコード文字列から行データに変換
  // result は技ごとに5文字: 初〜四の太刀（1=○, 0=×, 空白=未）＋5文字目。
  // 5文字目は旧「技術点」（1=○ → 補正点3）で、adjust 配列を持たない旧データの読み替えにだけ使う。
  // adjust が配列なら、その値を各行の補正点にし、5文字目は見ない。
  // 注意: 技名(techName)はエンコード文字列に含まれない。呼び出し元が player.tech1〜tech3 から別途供給すること。
  function decodeResult(result, techCount, adjust) {
    var hasAdjust = Array.isArray(adjust);
    var adj = normalizeAdjust(adjust);
    var rows = [];
    for (var i = 0; i < techCount; i++) {
      var offset = i * 5;
      var values = [];
      for (var s = 0; s < 4; s++) {
        var ch = result.charAt(offset + s);
        values.push(ch === '1' ? '○' : ch === '0' ? '×' : '');
      }
      var tpCh = result.charAt(offset + 4);
      rows.push({ values: values, adjust: hasAdjust ? adj[i] : (tpCh === '1' ? 3 : 0) });
    }
    return rows;
  }

  // result が現在の技数に対して復元可能かどうか（技ごとに5文字。技の数が変わると復元できない）
  function canDecode(result, techCount) {
    return !!result && result.length === techCount * 5 && /^[01 ]*$/.test(result);
  }

  // 行データからresultエンコード文字列を生成。5文字目は常に空白（補正点は adjust に持つ）。
  function encodeResult(rows) {
    var str = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      for (var s = 0; s < 4; s++) {
        str += row.values[s] === '○' ? '1' : row.values[s] === '×' ? '0' : ' ';
      }
      str += ' ';
    }
    return str;
  }

  return {
    setTechniques: setTechniques,
    findTechnique: findTechnique,
    calcStrikeScore: calcStrikeScore,
    calcRowScore: calcRowScore,
    calcTotalScore: calcTotalScore,
    normalizeAdjust: normalizeAdjust,
    decodeResult: decodeResult,
    encodeResult: encodeResult,
    canDecode: canDecode
  };
```

- [ ] **Step 4: テストが通ることを確認**

Run: ブラウザで `test.html` を `location.reload()`
Expected: `scoring.js` 節がすべて ✓。他の節も従来どおり。

- [ ] **Step 5: Commit**

```bash
git add scoring.js test.html
git commit -m "feat: 技ごとの補正点と全体補正点を Scoring に入れる（旧・技術点は読み替え）"
```

### Task A2: 採点済み判定に補正点を足す（Courts とサーバー）

**Files:**
- Modify: `courts.js`（`isScored`）
- Modify: `server/index.js:152-158`（`isScored`）
- Test: `test.html`（`courts.js` 節 618〜622行付近）

- [ ] **Step 1: テストを足す**

```js
    assert('isScored: 補正点が入っていれば採点済み', Courts.isScored({ score: 0, result: '', adjust: [0, -2, 0] }), true);
    assert('isScored: 全体補正点が入っていれば採点済み', Courts.isScored({ score: 0, result: '', totalAdjust: 1 }), true);
    assert('isScored: 補正点が全部 0 なら未採点', Courts.isScored({ score: 0, result: '', adjust: [0, 0, 0], totalAdjust: 0 }), false);
    assert('isScored: 負の合計でも result があれば採点済み', Courts.isScored({ score: -3, result: '0    ' }), true);
```

- [ ] **Step 2: 落ちることを確認**（`補正点が入っていれば採点済み` が ✗）

- [ ] **Step 3: courts.js の isScored を置き換え**

```js
  // 採点済みの判定。server/index.js の isScored と同じ規則。
  // 太刀の ○× のほか、補正点（技ごと・全体）が 0 以外なら採点済みとみなす
  // （負の補正で score が 0 以下になっても拾えるように、score > 0 だけに頼らない）。
  function isScored(player) {
    if (!player) return false;
    if (typeof player.score === 'number' && player.score > 0) return true;
    if (/[01]/.test(player.result || '')) return true;
    if (Array.isArray(player.adjust)) {
      for (var i = 0; i < player.adjust.length; i++) {
        if (Number(player.adjust[i])) return true;
      }
    }
    return !!Number(player.totalAdjust);
  }
```

- [ ] **Step 4: server/index.js の isScored も同じにする**

```js
function isScored(player) {
  if (!player) return false;
  if (typeof player.score === 'number' && player.score > 0) return true;
  if (/[01]/.test(player.result || '')) return true;
  if (Array.isArray(player.adjust) && player.adjust.some(n => Number(n))) return true;
  return !!Number(player.totalAdjust);
}
```

- [ ] **Step 5: テストが通ることを確認。Commit**

```bash
git add courts.js server/index.js test.html
git commit -m "fix: 補正点だけが入った選手も採点済みとみなす（クライアント・サーバー共通）"
```

### Task A3: サーバーの PATCH 受理項目とエクスポート列

**Files:**
- Modify: `server/index.js:504-511`（PATCH の allowlist）、`server/index.js:686-700`（export）
- Test: `test.html`（`runApiTests` の中）

- [ ] **Step 1: API テストを足す**（`runApiTests` の「大会取得テスト」の後、CSV インポートテストの前に入れる）

```js
    // PATCH: 補正点・備考・確定・負の得点
    var padded = await Api.importCsv(testEventId, '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n補正 太郎,A-男子-1-9,四方,,,0,,,', 'append');
    var padLoaded = await Api.loadEvent(testEventId);
    var padP = padLoaded.players.filter(function(p) { return p.name === '補正 太郎'; })[0];
    var padRes = await Api.updatePlayerInfo(testEventId, padP.id, {
      adjust: [1, -2, 0], totalAdjust: -3, note: '  審判メモ  ', confirmed: true, score: -4
    });
    assert('PATCH adjust を保存', padRes.player.adjust, [1, -2, 0]);
    assert('PATCH totalAdjust を保存', padRes.player.totalAdjust, -3);
    assert('PATCH note は trim', padRes.player.note, '審判メモ');
    assert('PATCH confirmed を保存', padRes.player.confirmed, true);
    assert('PATCH 負の score を受理', padRes.player.score, -4);
    var badRes = await Api.updatePlayerInfo(testEventId, padP.id, {
      adjust: [1, 2], totalAdjust: 1.5, note: 12, confirmed: 'yes', score: NaN
    });
    assert('PATCH 長さ3でない adjust は無視', badRes.player.adjust, [1, -2, 0]);
    assert('PATCH 整数でない totalAdjust は無視', badRes.player.totalAdjust, -3);
    assert('PATCH 文字列でない note は無視', badRes.player.note, '審判メモ');
    assert('PATCH 真偽値でない confirmed は無視', badRes.player.confirmed, true);
    var longNote = new Array(202).join('あ');   // 201文字
    var longRes = await Api.updatePlayerInfo(testEventId, padP.id, { note: longNote });
    assert('PATCH note は200文字で切る', longRes.player.note.length, 200);
    var csvOut = await Api.exportCsv(testEventId);
    var csvHead = csvOut.replace(/^\uFEFF/, '').split('\r\n')[0];
    assert('export は15列', csvHead.split(',').length, 15);
    assert('export のヘッダー末尾', csvHead.split(',').slice(9), ['補正点1', '補正点2', '補正点3', '全体補正', '備考', '確定']);
    var csvRow = csvOut.replace(/^\uFEFF/, '').split('\r\n').filter(function(l) { return l.indexOf('補正 太郎') === 0; })[0];
    assert('export に補正点・確定が出る', csvRow.split(',').slice(9), ['1', '-2', '0', '-3', '審判メモ', '○']);
```

`Api.exportCsv` は文字列を返す（`api.js:163`）。

- [ ] **Step 2: 落ちることを確認**（`PATCH adjust を保存` が ✗）

- [ ] **Step 3: PATCH を実装**（`['isNewFace', 'isFemale']` の直後、`score` の行を置き換え）

```js
    // 補正点（技ごと・全体）・備考・確定。型が合わないものは黙って無視する（他の項目と同じ）。
    if (Array.isArray(body.adjust) && body.adjust.length === 3 &&
        body.adjust.every(n => Number.isInteger(n))) {
      player.adjust = body.adjust.slice();
    }
    if (Number.isInteger(body.totalAdjust)) player.totalAdjust = body.totalAdjust;
    if (typeof body.note === 'string') player.note = body.note.trim().slice(0, 200);
    if (typeof body.confirmed === 'boolean') player.confirmed = body.confirmed;
    // 補正点で負の合計になりうるので負数も受理する。NaN・Infinity は無視する
    if (Number.isFinite(body.score)) player.score = body.score;
```

- [ ] **Step 4: export を15列にする**

```js
    const header = ['選手名', '順番', '技 1', '技 2', '技 3', '得点', '新人', '女子', '結果',
                    '補正点1', '補正点2', '補正点3', '全体補正', '備考', '確定'];
    const rows = [header];

    for (const p of (event.players || [])) {
      const adj = Array.isArray(p.adjust) ? p.adjust : [0, 0, 0];
      rows.push([
        p.name || '',
        p.order || '',
        p.tech1 || '',
        p.tech2 || '',
        p.tech3 || '',
        p.score != null ? p.score : 0,
        p.isNewFace ? '○' : '',
        p.isFemale ? '○' : '',
        p.result || '',
        Number(adj[0]) || 0,
        Number(adj[1]) || 0,
        Number(adj[2]) || 0,
        Number(p.totalAdjust) || 0,
        p.note || '',
        p.confirmed === true ? '○' : ''
      ]);
    }
```

- [ ] **Step 5: サーバーを再起動してテストが通ることを確認。Commit**

```bash
git add server/index.js test.html
git commit -m "feat: 選手の補正点・備考・確定をサーバーで受理し、CSV エクスポートに列を足す"
```

### Task A4: Outbox と HTML 保存に新項目を通す

**Files:**
- Modify: `outbox.js`（`applyPending`, `drain`, `enqueue`）
- Modify: `storage.js`（`buildPlayersHtml`）
- Test: `test.html`（`outbox.js` 節・`storage.js` 節）

- [ ] **Step 1: テストを足す**

`outbox.js` 節（`Outbox.coalesce` のテスト付近）に:

```js
    var q1 = Outbox.coalesce([], { eventId: 'e', playerId: 'p', score: 1, result: 'r', adjust: [1, 0, 0], totalAdjust: 2, note: 'n', confirmed: true });
    assert('coalesce は補正点・備考・確定を保つ', [q1[0].adjust, q1[0].totalAdjust, q1[0].note, q1[0].confirmed], [[1, 0, 0], 2, 'n', true]);
```

`applyPending` のテスト（`fromServer` を使っている箇所）の直後に:

```js
    localStorage.setItem('tmg_outbox', JSON.stringify([
      { eventId: 'ev1', playerId: 'p1', score: 55, result: 'X', adjust: [1, 2, 3], totalAdjust: -1, note: 'メモ', confirmed: true, queuedAt: 't4' },
      { eventId: 'ev1', playerId: 'p2', score: 5, result: 'Y', queuedAt: 't5' }   // 旧形式（新項目なし）
    ]));
    Outbox.init(function() {}, function() {});
    await new Promise(function(r) { setTimeout(r, 400); });
    var fromServer2 = [
      { id: 'p1', score: 0, result: '', adjust: [0, 0, 0], totalAdjust: 0, note: '', confirmed: false },
      { id: 'p2', score: 0, result: '', adjust: [9, 9, 9], totalAdjust: 9, note: '既存', confirmed: true }
    ];
    Outbox.applyPending('ev1', fromServer2);
    assert('applyPending は補正点・備考・確定も上書きする',
      [fromServer2[0].adjust, fromServer2[0].totalAdjust, fromServer2[0].note, fromServer2[0].confirmed],
      [[1, 2, 3], -1, 'メモ', true]);
    assert('applyPending 旧形式のエントリは新項目に触らない',
      [fromServer2[1].adjust, fromServer2[1].totalAdjust, fromServer2[1].note, fromServer2[1].confirmed],
      [[9, 9, 9], 9, '既存', true]);
```

この追加は「後始末」（`Api.updatePlayer = origUpdate` の行）より前に置く。

`storage.js` 節に:

```js
    var html15 = Storage.buildPlayersHtml([{ name: 'A', order: 'A-男子-1-1', tech1: '四方', tech2: '', tech3: '', score: 10, isNewFace: false, isFemale: false, result: '1    ', adjust: [1, 0, 0], totalAdjust: -2, note: '備考<b>', confirmed: true }]);
    assert('buildPlayersHtml は15列の見出し', (html15.match(/<th>/g) || []).length, 15);
    assert('buildPlayersHtml 備考をエスケープ', html15.indexOf('備考&lt;b&gt;') !== -1, true);
    assert('buildPlayersHtml 確定は○', html15.indexOf('<td>○</td></tr>') !== -1, true);
```

- [ ] **Step 2: 落ちることを確認**

- [ ] **Step 3: outbox.js を直す**

`applyPending` の内側:

```js
        if (playerList[j].id === e.playerId) {
          playerList[j].score = e.score;
          playerList[j].result = e.result;
          // 新項目は、エントリが持っているときだけ上書きする（旧形式のエントリには無い）
          if ('adjust' in e) playerList[j].adjust = e.adjust;
          if ('totalAdjust' in e) playerList[j].totalAdjust = e.totalAdjust;
          if ('note' in e) playerList[j].note = e.note;
          if ('confirmed' in e) playerList[j].confirmed = e.confirmed;
          n++;
          break;
        }
```

`drain` の送信:

```js
          var body = { score: entry.score, result: entry.result };
          if ('adjust' in entry) body.adjust = entry.adjust;
          if ('totalAdjust' in entry) body.totalAdjust = entry.totalAdjust;
          if ('note' in entry) body.note = entry.note;
          if ('confirmed' in entry) body.confirmed = entry.confirmed;
          res = await Api.updatePlayer(entry.eventId, entry.playerId, body);
```

`enqueue` の `queued`:

```js
    var queued = {
      eventId: entry.eventId,
      playerId: entry.playerId,
      score: entry.score,
      result: entry.result,
      queuedAt: new Date().toISOString()
    };
    if ('adjust' in entry) queued.adjust = entry.adjust;
    if ('totalAdjust' in entry) queued.totalAdjust = entry.totalAdjust;
    if ('note' in entry) queued.note = entry.note;
    if ('confirmed' in entry) queued.confirmed = entry.confirmed;
```

`coalesce` はエントリをそのまま置くので変更不要。

- [ ] **Step 4: storage.js の buildPlayersHtml を15列にする**

```js
  function buildPlayersHtml(players) {
    var rows = players.map(function(p) {
      var adj = Array.isArray(p.adjust) ? p.adjust : [0, 0, 0];
      return '<tr><td>' + [
        esc(p.name), esc(p.order), esc(p.tech1), esc(p.tech2), esc(p.tech3),
        esc(String(p.score !== undefined ? p.score : '')), p.isNewFace ? '○' : '', p.isFemale ? '○' : '',
        esc(p.result),
        esc(String(Number(adj[0]) || 0)), esc(String(Number(adj[1]) || 0)), esc(String(Number(adj[2]) || 0)),
        esc(String(Number(p.totalAdjust) || 0)), esc(p.note), p.confirmed === true ? '○' : ''
      ].join('</td><td>') + '</td></tr>';
    });
    return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
      '<style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px}' +
      'th{background:#eee}</style></head><body>' +
      '<table><tr><th>選手名</th><th>順番</th><th>技1</th><th>技2</th><th>技3</th>' +
      '<th>得点</th><th>新人</th><th>女子</th><th>結果</th>' +
      '<th>補正点1</th><th>補正点2</th><th>補正点3</th><th>全体補正</th><th>備考</th><th>確定</th></tr>' +
      rows.join('') + '</table></body></html>';
  }
```

- [ ] **Step 5: テストが通ることを確認。Commit**

```bash
git add outbox.js storage.js test.html
git commit -m "feat: 送信キューと HTML 保存に補正点・備考・確定を通す"
```

### Task A5: 採点画面の HTML と CSS（見出し・確定ボタン・補正段・下部一覧・スマホ）

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `theme.css`

- [ ] **Step 1: theme.css に変数を足す**（ライトとダークの両方）

```css
  --row-selected: #fff3cd;      /* 選択中の技の行 */
  --score-confirmed: #1a56db;   /* 確定済みの得点 */
```

ダーク:

```css
  --row-selected: #4a3f1a;
  --score-confirmed: #60a5fa;
```

- [ ] **Step 2: index.html を直す**

採点表の見出し:

```html
        <tr>
          <th>技</th>
          <th>初太刀</th>
          <th>二ノ太刀</th>
          <th>三ノ太刀</th>
          <th>四ノ太刀</th>
          <th>補正点</th>
          <th>得点</th>
        </tr>
```

採点表の直後（`.score-table-wrap` の閉じタグの後）に全体補正・備考の段:

```html
  <!-- 全体補正点・備考 -->
  <div class="adjust-bar">
    <label>全体補正点 <input type="number" step="1" inputmode="numeric" class="adjust-input" id="totalAdjustInput"></label>
    <label class="note-label">備考 <input type="text" maxlength="200" id="noteInput" placeholder="（任意）"></label>
  </div>
```

アクションバー:

```html
  <div class="action-bar">
    <button class="btn-success" id="btnAllSuccess">形成功</button>
    <button class="btn-fail"    id="btnAllFail">失敗</button>
    <button class="btn-confirm" id="btnConfirm">確定</button>
    <div class="total-score" id="totalScoreDisplay">合計: 0点</div>
  </div>
```

ツールバーから `btnPlayerList` を消す:

```html
  <div class="toolbar">
    <button id="btnExport">CSVエクスポート</button>
    <button id="btnDownloadHtml">HTML保存</button>
    <button class="theme-btn" id="btnTheme">🌙 ダーク</button>
  </div>
```

浮くパネル（`<div class="player-list-panel" ...>` 〜 その閉じタグ）を次に置き換える:

```html
  <!-- 選手一覧（ページ下部に常設。見出しで開閉） -->
  <section class="player-list-section" id="playerListSection">
    <button type="button" class="player-list-toggle" id="btnPlayerListToggle" aria-expanded="true">
      <span class="player-list-arrow">▾</span> 選手一覧
    </button>
    <div class="player-list-body" id="playerListBody-wrap">
      <table class="player-list-table" id="playerListTable">
        <thead>
          <tr>
            <th>順番</th>
            <th>選手名</th>
            <th>技1</th>
            <th>技2</th>
            <th>技3</th>
            <th>得点</th>
          </tr>
        </thead>
        <tbody id="playerListBody"></tbody>
      </table>
    </div>
  </section>
```

- [ ] **Step 3: style.css を直す**

`body` から `min-width: 768px;` の行を削除する（コメントも消す）。

`.player-nav`, `.timer-bar`, `.event-bar`（index.html の `<style>` にある）, `.toolbar`, `.action-bar` に `flex-wrap: wrap;` を足す（`.action-bar` と `.toolbar` は既にある）。`index.html` の `<style>` の `.event-bar` にも `flex-wrap: wrap;` を足す。

採点表の追加スタイル（`.score-table td.score-notice` の後に）:

```css
.score-table td.tech-name { cursor: pointer; }
.score-table td.strike-cell.empty { color: var(--text-muted); font-weight: normal; font-size: 14px; }
.score-table tr.selected td { background: var(--row-selected); }
.score-table tr.selected td.strike-cell.success { background: var(--cell-success); }
.score-table tr.selected td.strike-cell.fail { background: var(--cell-fail); }
.score-table tr.selected td.strike-cell.disabled { background: var(--cell-disabled); }
.score-table td.adjust-cell { padding: 2px 4px; }
.adjust-input {
  width: 64px; height: 40px; text-align: center; font-size: 16px;
  background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px;
}
.score-table.confirmed td.score-col { color: var(--score-confirmed); }
.total-score.confirmed { color: var(--score-confirmed); }

/* ===== 全体補正点・備考 ===== */
.adjust-bar {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 8px 12px;
}
.adjust-bar label { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.adjust-bar .note-label { flex: 1; min-width: 200px; }
.adjust-bar #noteInput {
  flex: 1; height: 40px; padding: 0 8px; font-size: 16px;
  background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px;
}

/* ===== 確定 ===== */
.btn-confirm { background: var(--btn-neutral); color: #fff; }
.btn-confirm.on { background: var(--score-confirmed); color: #fff; }
```

浮くパネルの節（`/* ===== 選手一覧フローティングパネル ===== */` から `.player-list-table tr.current-player td:last-child { ... }` まで）を次に置き換える:

```css
/* ===== 選手一覧（ページ下部・開閉） ===== */
.player-list-section { border-top: 2px solid var(--border); }
.player-list-toggle {
  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px;
  padding: 0 12px; text-align: left; font-weight: bold; font-size: 14px;
  background: var(--bg-header); color: var(--text); border-radius: 0;
}
.player-list-section.closed .player-list-body { display: none; }
.player-list-body { overflow: auto; max-height: 50vh; }
.player-list-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.player-list-table th {
  background: var(--bg-header);
  border: 1px solid var(--border);
  padding: 5px 8px;
  text-align: center;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}
.player-list-table td {
  border: 1px solid var(--border);
  padding: 5px 8px;
  cursor: pointer;
  white-space: nowrap;
  height: 44px;
}
.player-list-table td:last-child {
  text-align: right;
  font-weight: bold;
  color: var(--score-color);
}
.player-list-table td.confirmed { color: var(--score-confirmed); }
.player-list-table tr:hover td { opacity: 0.75; }
.player-list-table tr.current-player td {
  background: var(--accent);
  color: var(--accent-text);
}
.player-list-table tr.current-player td:last-child {
  color: var(--accent-text);
}
```

- [ ] **Step 4: ブラウザで index.html を開いて崩れていないことを目視**（app.js はまだ古いのでボタンは効かない。表示だけ確認する）

- [ ] **Step 5: Commit**

```bash
git add index.html style.css theme.css
git commit -m "feat: 採点画面の骨組みを補正点・確定・下部選手一覧に合わせ、スマホ幅でも開けるようにする"
```

### Task A6: app.js（採点表の描画・行選択・補正点・確定・下部一覧）

**Files:**
- Modify: `app.js`

設計書の「T6 採点画面」を実装する。以下は置き換える関数の完成形。

- [ ] **Step 1: 状態と DOM 参照を足す**（先頭の `--- 状態 ---` と `--- DOM参照 ---`）

```js
  var selectedRow = -1;      // 選択中の技の行（0始まり）。技が無ければ -1
  var PLAYER_LIST_KEY = 'tmg_player_list_open';
```

```js
  var playerListSection = document.getElementById('playerListSection');
  var playerListBody   = document.getElementById('playerListBody');
  var totalAdjustInput = document.getElementById('totalAdjustInput');
  var noteInput        = document.getElementById('noteInput');
  var btnConfirm       = document.getElementById('btnConfirm');
  var scoreTable       = document.getElementById('scoreTable');
```

`playerListPanel` の参照は消す。

- [ ] **Step 2: bindEvents を直す**

`btnPlayerList` / `btnPlayerListClose` の2行を次に置き換える:

```js
    document.getElementById('btnPlayerListToggle').addEventListener('click', togglePlayerList);
    btnConfirm.addEventListener('click', onConfirm);
    totalAdjustInput.addEventListener('change', onTotalAdjustChange);
    noteInput.addEventListener('change', onNoteChange);
```

`init` の `applyTheme(...)` の直後に `initPlayerListOpen();` を足す。

- [ ] **Step 3: 採点表の描画を置き換える**（`renderScoreGrid` 〜 `setCellDisplay`）

```js
  var STRIKE_LABELS = ['初太刀', '二ノ太刀', '三ノ太刀', '四ノ太刀'];

  function renderScoreGrid(player) {
    scoreTableBody.innerHTML = '';
    gridDirty = false;
    noticeRow = null;
    selectedRow = -1;
    var techNames = [player.tech1, player.tech2, player.tech3].filter(Boolean);
    // 全体補正点・備考は技の有無に関わらず表示する（技が無いときは編集不可）
    totalAdjustInput.value = Number(player.totalAdjust) ? String(Math.trunc(player.totalAdjust)) : '';
    noteInput.value = player.note || '';
    if (techNames.length === 0) {
      gridRestorable = false;
      var trEmpty = document.createElement('tr');
      var tdEmpty = document.createElement('td');
      tdEmpty.colSpan = 7;
      tdEmpty.className = 'score-empty';
      tdEmpty.textContent = '技が未入力です。運営画面の進行タブで技を入力してください。';
      trEmpty.appendChild(tdEmpty);
      scoreTableBody.appendChild(trEmpty);
      setTotalDisplay(player.score || 0);
      totalAdjustInput.disabled = true;
      noteInput.disabled = true;
      applyConfirmedStyle(!!player.confirmed);
      return;
    }
    totalAdjustInput.disabled = false;
    noteInput.disabled = false;
    gridRestorable = Scoring.canDecode(player.result, techNames.length) || !Courts.isScored(player);
    var decoded = gridRestorable ? Scoring.decodeResult(player.result, techNames.length, player.adjust) : null;

    if (!decoded) {
      var trNotice = document.createElement('tr');
      var tdNotice = document.createElement('td');
      tdNotice.colSpan = 7;
      tdNotice.className = 'score-notice';
      tdNotice.textContent = '内訳を復元できません（技の数が変わっています）。' +
        '採点し直すと現在の得点 ' + (player.score || 0) + '点 は置き換わります。';
      trNotice.appendChild(tdNotice);
      scoreTableBody.appendChild(trNotice);
      noticeRow = trNotice;
    }

    // 技が3つ未満のとき、adjust の添字は「技の枠」ではなく「表示行」に合わせる
    // （tech1..3 を filter(Boolean) しているため）。保存時も同じ順で書く。
    for (var i = 0; i < techNames.length; i++) {
      var rowData = decoded ? decoded[i] : { values: ['','','',''], adjust: 0 };
      var tr = buildScoreRow(techNames[i], player.isFemale, rowData, i);
      scoreTableBody.appendChild(tr);
    }
    selectRow(0);
    if (decoded) {
      updateTotal();
    } else {
      setTotalDisplay(player.score || 0);
    }
    applyConfirmedStyle(!!player.confirmed);
  }

  function buildScoreRow(techName, isFemale, rowData, rowIndex) {
    var tr = document.createElement('tr');
    tr.dataset.tech = techName;
    tr.dataset.row = rowIndex;

    var tdName = document.createElement('td');
    tdName.className = 'tech-name';
    tdName.textContent = techName;
    tdName.addEventListener('click', function() { selectRow(rowIndex); });
    tr.appendChild(tdName);

    var tech = Scoring.findTechnique(techName, isFemale);

    // 初〜四の太刀
    for (var s = 0; s < 4; s++) {
      var td = document.createElement('td');
      td.className = 'strike-cell';
      td.dataset.strike = s;
      var disabled = !tech || tech.strikes[s] === null;
      if (disabled) {
        td.classList.add('disabled');
      } else {
        td.dataset.value = rowData.values[s] || '';
        setCellDisplay(td, rowData.values[s] || '');
        td.addEventListener('click', onStrikeClick);
      }
      tr.appendChild(td);
    }

    // 補正点（任意の整数。0 は空欄で表示）
    var tdAdj = document.createElement('td');
    tdAdj.className = 'adjust-cell';
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.step = '1';
    inp.inputMode = 'numeric';
    inp.className = 'adjust-input';
    inp.value = Number(rowData.adjust) ? String(Math.trunc(rowData.adjust)) : '';
    inp.addEventListener('focus', function() { selectRow(rowIndex); });
    inp.addEventListener('change', onAdjustChange);
    tdAdj.appendChild(inp);
    tr.appendChild(tdAdj);

    // 得点
    var tdScore = document.createElement('td');
    tdScore.className = 'score-col';
    tr.appendChild(tdScore);

    updateRowScore(tr, isFemale);
    return tr;
  }

  function setCellDisplay(td, value) {
    td.classList.remove('success', 'fail', 'empty');
    if (value === '○') { td.textContent = '成功'; td.classList.add('success'); }
    else if (value === '×') { td.textContent = '失敗'; td.classList.add('fail'); }
    else { td.textContent = '未'; td.classList.add('empty'); }
  }

  // --- 行の選択 ---
  function selectRow(index) {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    if (rows.length === 0) { selectedRow = -1; return; }
    if (index < 0 || index >= rows.length) index = 0;
    selectedRow = index;
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('selected', i === index);
    }
  }

  function selectedRowEl() {
    if (selectedRow < 0) return null;
    return scoreTableBody.querySelector('tr[data-tech][data-row="' + selectedRow + '"]');
  }

  // 行の補正点入力欄の値（空欄は 0）
  function rowAdjust(tr) {
    var inp = tr.querySelector('.adjust-input');
    if (!inp) return 0;
    var n = parseInt(inp.value, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function totalAdjustValue() {
    var n = parseInt(totalAdjustInput.value, 10);
    return Number.isFinite(n) ? n : 0;
  }
```

- [ ] **Step 4: 確定の表示と解除**（`setTotalDisplay` の後に）

```js
  // 確定済みの見た目（得点列・合計・下部一覧の得点を青）とボタンの状態
  function applyConfirmedStyle(on) {
    scoreTable.classList.toggle('confirmed', on);
    totalScoreDisplay.classList.toggle('confirmed', on);
    btnConfirm.classList.toggle('on', on);
    btnConfirm.textContent = on ? '確定済み' : '確定';
    updatePlayerListConfirmed(currentIndex, on);
  }

  // 得点に関わる編集をしたら確定を解除する（保存は呼び出し元の saveCurrentState が行う）
  function unconfirmIfNeeded() {
    var p = visiblePlayers[currentIndex];
    if (!p || !p.confirmed) return;
    p.confirmed = false;
    applyConfirmedStyle(false);
  }

  function onConfirm() {
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    var p = visiblePlayers[currentIndex];
    if (!p) return;
    if (scoreTableBody.querySelectorAll('tr[data-tech]').length === 0) {
      alert('技が未入力のため確定できません。');
      return;
    }
    if (!gridRestorable && !gridDirty) {
      alert('内訳を復元できない選手は、採点し直してから確定してください。');
      return;
    }
    if (p.confirmed) return;
    p.confirmed = true;
    applyConfirmedStyle(true);
    saveCurrentState();
    Api.addHistory(currentEvent.id, {
      action: 'confirm',
      playerName: p.name || '',
      detail: '確定（' + (p.score || 0) + '点）'
    });
  }

  function onTotalAdjustChange() {
    if (!currentEvent || scoreTableBody.querySelectorAll('tr[data-tech]').length === 0) return;
    if (!confirmReplaceIfNeeded()) { totalAdjustInput.value = ''; return; }
    var n = totalAdjustValue();
    totalAdjustInput.value = n ? String(n) : '';
    unconfirmIfNeeded();
    updateTotal();
    saveCurrentState();
    var p = visiblePlayers[currentIndex];
    Api.addHistory(currentEvent.id, {
      action: 'score_update',
      playerName: p ? p.name : '',
      detail: '全体補正点 → ' + n
    });
  }

  function onNoteChange() {
    if (!currentEvent || scoreTableBody.querySelectorAll('tr[data-tech]').length === 0) return;
    if (!gridRestorable && !gridDirty) return;   // 復元不能な内訳を空で上書きしない
    var p = visiblePlayers[currentIndex];
    if (!p) return;
    p.note = noteInput.value.trim().slice(0, 200);
    saveCurrentState();   // 備考は確定を解除しない
  }

  function onAdjustChange(e) {
    var inp = e.currentTarget;
    var tr = inp.closest('tr');
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    if (!confirmReplaceIfNeeded()) { inp.value = ''; return; }
    var n = rowAdjust(tr);
    inp.value = n ? String(n) : '';
    var p = visiblePlayers[currentIndex];
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    Api.addHistory(currentEvent.id, {
      action: 'score_update',
      playerName: p ? p.name : '',
      techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10),
      strike: 'adjust',
      value: n,
      detail: '補正点 → ' + n
    });
  }
```

- [ ] **Step 5: 採点インタラクションを置き換える**（`onStrikeClick` 〜 `setAllFail`）

```js
  function onStrikeClick(e) {
    var td = e.currentTarget;
    if (td.classList.contains('disabled')) return;
    if (!currentEvent) { alert('大会が選択されていません。'); return; }
    if (scoreTableBody.querySelectorAll('tr[data-tech]').length === 0) return;
    if (!confirmReplaceIfNeeded()) return;

    var tr = td.closest('tr');
    selectRow(parseInt(tr.dataset.row, 10));
    var current = td.dataset.value || '';
    var next = current === '' ? '○' : current === '○' ? '×' : '';
    td.dataset.value = next;
    setCellDisplay(td, next);

    var p = visiblePlayers[currentIndex];
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();

    Api.addHistory(currentEvent.id, {
      action: 'score_update',
      playerName: p ? p.name : '',
      techName: tr.dataset.tech,
      // 同じ技を複数の枠に入れられるので、techName だけでは行を特定できない。
      // buildScoreRow が振った 0 始まりの行番号（tr.dataset.row）も残す。
      techRow: parseInt(tr.dataset.row, 10),
      strike: parseInt(td.dataset.strike, 10),
      value: next,
      detail: STRIKE_LABELS[parseInt(td.dataset.strike, 10)] + ' → ' +
              (next === '○' ? '成功' : next === '×' ? '失敗' : '未')
    });
  }

  function rowValues(tr) {
    var values = [];
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      values.push(cell && !cell.classList.contains('disabled') ? (cell.dataset.value || '') : '');
    }
    return values;
  }

  // 行に何も入っていない（太刀が全部「未」で補正も 0）か
  function rowIsBlank(tr) {
    var values = rowValues(tr);
    for (var i = 0; i < 4; i++) if (values[i]) return false;
    return rowAdjust(tr) === 0;
  }

  function updateRowScore(tr, isFemale) {
    var rowScore = Scoring.calcRowScore(tr.dataset.tech, rowValues(tr), rowAdjust(tr), isFemale);
    var scoreCell = tr.querySelector('.score-col');
    // 何も入っていない行は空欄。入力があれば 0 や負の数もそのまま見せる
    scoreCell.textContent = rowIsBlank(tr) ? '' : String(rowScore);
    scoreCell.dataset.score = String(rowScore);
  }

  function updateTotal() {
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    if (rows.length === 0) return;
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      var sc = rows[i].querySelector('.score-col');
      if (sc) total += parseInt(sc.dataset.score, 10) || 0;
    }
    total += totalAdjustValue();
    setTotalDisplay(total);
    if (visiblePlayers[currentIndex] !== undefined) {
      visiblePlayers[currentIndex].score = total;
      updatePlayerListScore(currentIndex, total);
    }
  }

  // 現在の採点内容をキューに積む。通信は待たない（Outboxのワーカーが送る）。
  function saveCurrentState() {
    if (currentIndex < 0 || !visiblePlayers[currentIndex] || !currentEvent) return;
    // 内訳を復元できない選手は、採点し直すまで保存しない
    if (!gridRestorable && !gridDirty) return;
    var rows = scoreTableBody.querySelectorAll('tr[data-tech]');
    var rowDataArr = [];
    var adjust = [0, 0, 0];
    for (var i = 0; i < rows.length; i++) {
      rowDataArr.push({ values: rowValues(rows[i]) });
      if (i < 3) adjust[i] = rowAdjust(rows[i]);
    }
    var p = visiblePlayers[currentIndex];
    p.result = Scoring.encodeResult(rowDataArr);
    p.adjust = adjust;
    p.totalAdjust = totalAdjustValue();
    p.note = noteInput.value.trim().slice(0, 200);
    p.confirmed = !!p.confirmed;

    Outbox.enqueue({
      eventId: currentEvent.id,
      playerId: p.id,
      score: p.score,
      result: p.result,
      adjust: p.adjust,
      totalAdjust: p.totalAdjust,
      note: p.note,
      confirmed: p.confirmed
    });
  }

  // 「形成功」: 選択中の技の行の打てる太刀をすべて成功にする（失敗も成功に変える）
  function setAllSuccess() {
    var tr = guardRowAction();
    if (!tr) return;
    var p = visiblePlayers[currentIndex];
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      if (cell && !cell.classList.contains('disabled')) {
        cell.dataset.value = '○';
        setCellDisplay(cell, '○');
      }
    }
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    Api.addHistory(currentEvent.id, {
      action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10), strike: 'all', value: '○', detail: '形成功'
    });
  }

  // 「失敗」: 選択中の技の行の「未」だけを失敗にする（成功は触らない）
  function setAllFail() {
    var tr = guardRowAction();
    if (!tr) return;
    var p = visiblePlayers[currentIndex];
    for (var s = 0; s < 4; s++) {
      var cell = tr.querySelector('[data-strike="' + s + '"]');
      if (cell && !cell.classList.contains('disabled') && (cell.dataset.value || '') === '') {
        cell.dataset.value = '×';
        setCellDisplay(cell, '×');
      }
    }
    unconfirmIfNeeded();
    updateRowScore(tr, p ? p.isFemale : false);
    updateTotal();
    saveCurrentState();
    Api.addHistory(currentEvent.id, {
      action: 'score_update', playerName: p ? p.name : '', techName: tr.dataset.tech,
      techRow: parseInt(tr.dataset.row, 10), strike: 'rest', value: '×', detail: '未を失敗に'
    });
  }

  // 形成功・失敗の共通ガード。対象の行（tr）を返す。操作できなければ null。
  function guardRowAction() {
    if (!currentEvent) { alert('大会が選択されていません。'); return null; }
    if (scoreTableBody.querySelectorAll('tr[data-tech]').length === 0) {
      alert('技が未入力のため採点できません。運営画面の進行タブで技を入力してください。');
      return null;
    }
    var tr = selectedRowEl();
    if (!tr) { alert('形（技名）をタップして選んでください。'); return null; }
    if (!confirmReplaceIfNeeded()) return null;
    return tr;
  }
```

- [ ] **Step 6: 選手一覧を下部埋め込みに置き換える**（`--- 選手一覧パネル ---` の節をまるごと）

```js
  // --- 選手一覧（ページ下部・開閉） ---
  // 初期状態: 端末の記憶があればそれ、無ければ画面幅 768px 以上で開く
  function initPlayerListOpen() {
    var open = window.innerWidth >= 768;
    try {
      var saved = localStorage.getItem(PLAYER_LIST_KEY);
      if (saved === '1') open = true;
      else if (saved === '0') open = false;
    } catch (e) {}
    setPlayerListOpen(open, false);
  }

  function setPlayerListOpen(open, remember) {
    playerListSection.classList.toggle('closed', !open);
    var btn = document.getElementById('btnPlayerListToggle');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.querySelector('.player-list-arrow').textContent = open ? '▾' : '▸';
    if (remember) {
      try { localStorage.setItem(PLAYER_LIST_KEY, open ? '1' : '0'); } catch (e) {}
    }
    if (open) renderPlayerList();
  }

  function isPlayerListOpen() {
    return !playerListSection.classList.contains('closed');
  }

  function togglePlayerList() {
    setPlayerListOpen(!isPlayerListOpen(), true);
  }

  function renderPlayerList() {
    playerListBody.innerHTML = '';
    for (var i = 0; i < visiblePlayers.length; i++) {
      playerListBody.appendChild(buildPlayerListRow(i));
    }
  }

  function buildPlayerListRow(index) {
    var p = visiblePlayers[index];
    var tr = document.createElement('tr');
    tr.dataset.index = index;
    if (index === currentIndex) tr.classList.add('current-player');
    tr.innerHTML =
      '<td>' + esc(p.order || '') + '</td>' +
      '<td>' + esc(p.name || '') + '</td>' +
      '<td>' + esc(p.tech1 || '') + '</td>' +
      '<td>' + esc(p.tech2 || '') + '</td>' +
      '<td>' + esc(p.tech3 || '') + '</td>' +
      '<td class="' + (p.confirmed ? 'confirmed' : '') + '">' + (p.score || 0) + '</td>';
    tr.addEventListener('click', function() {
      var idx = parseInt(this.dataset.index, 10);
      saveCurrentState();
      selectPlayer(idx);
    });
    return tr;
  }

  // 選手データ自体が入れ替わったとき用（開いていれば一覧を作り直す）
  function refreshPlayerList() {
    if (!isPlayerListOpen()) return;
    renderPlayerList();
  }

  function updatePlayerList() {
    if (!isPlayerListOpen()) return;
    var rows = playerListBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var idx = parseInt(rows[i].dataset.index, 10);
      rows[i].classList.toggle('current-player', idx === currentIndex);
    }
    var currentRow = playerListBody.querySelector('tr.current-player');
    if (currentRow) currentRow.scrollIntoView({ block: 'nearest' });
  }

  function updatePlayerListScore(index, score) {
    if (!isPlayerListOpen()) return;
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    if (row) {
      var cells = row.querySelectorAll('td');
      cells[cells.length - 1].textContent = score;
    }
  }

  function updatePlayerListConfirmed(index, on) {
    if (!isPlayerListOpen()) return;
    var row = playerListBody.querySelector('tr[data-index="' + index + '"]');
    if (row) {
      var cells = row.querySelectorAll('td');
      cells[cells.length - 1].classList.toggle('confirmed', on);
    }
  }
```

`applyCourtFilter` の空表示分岐（`scoreTableBody.innerHTML = ''` のところ）と `onEventSelect('')` の分岐で、`totalAdjustInput.value = ''; noteInput.value = ''; totalAdjustInput.disabled = true; noteInput.disabled = true; applyConfirmedStyle(false);` を足す。

- [ ] **Step 7: ブラウザで動作確認**（自分の worktree のサーバー。大会を作り、選手を CSV で入れる）

確認項目:
1. 空セルが「未」、タップで「成功」→「失敗」→「未」。
2. 技名タップで行が黄色く選ばれる。選手を切り替えると1行目が選ばれる。
3. 「形成功」で選択行が全部成功。「失敗」で選択行の「未」だけ失敗。
4. 補正点に `-2` を入れると行得点・合計が減る。空にすると 0。
5. 全体補正点・備考が保存され、選手を行き来しても残る（サーバーの JSON を `cat server/data/events/*.json` で確認）。
6. 「確定」で得点・合計・一覧の得点が青。セルを触ると黒に戻り、ボタンが「確定」に戻る。
7. 下部の選手一覧が開閉でき、リロードしても状態が残る。
8. ブラウザの幅を 375px にしても横スクロールで採点できる（`resize_window` の mobile プリセット）。
9. `test.html` の全件が ✓。コンソールにエラーが無い。

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "feat: 採点画面に補正点・全体補正・備考・確定・行選択・未/成功/失敗表記・下部選手一覧を入れる"
```

### Task A7: 表記統一（T7）

**Files:**
- Modify: `techniques.html:32-35`, `data.js:2-4`, `scoring.js`（コメント）, `app.js`（残っていれば）

- [ ] **Step 1: 置換**

`techniques.html` の見出しを `初太刀 / 二ノ太刀 / 三ノ太刀 / 四ノ太刀` に。`data.js` のコメントを `// strikes: [初太刀点, 二ノ太刀点, 三ノ太刀点, 四ノ太刀点]`、`// 補正点（旧・技術点）は全技術で任意の整数を入力できる（app.js）` に。`scoring.js` と `app.js` に「技術点」「二の太刀」が残っていないか `grep -n "技術点\|の太刀" *.js *.html` で確認し、コメントも直す。`test.html` のテスト名に含まれる「二の太刀」等は挙動に関係ないので直さなくてよい。

- [ ] **Step 2: Commit**

```bash
git add techniques.html data.js scoring.js app.js
git commit -m "docs: 太刀の表記を「二ノ太刀」に、技術点を補正点に統一する"
```

---

## トラック B（T4 技シート）

### Task B1: TechPicker.filter（純粋関数）

**Files:**
- Modify: `techpicker.js`
- Test: `test.html`（`techpicker.js` 節 651〜696行付近）

- [ ] **Step 1: テストを足す**

```js
    var ftechs = [{ name: '四方', strikes: [17, 5, 7, 3] }, { name: '夢想返し', strikes: [13, 5, null, null] }, { name: 'Ｋｅｓａ', strikes: [1, null, null, null] }];
    assert('filter: 空なら全件', TechPicker.filter(ftechs, '').length, 3);
    assert('filter: 空白だけなら全件', TechPicker.filter(ftechs, '  ').length, 3);
    assert('filter: 部分一致', TechPicker.filter(ftechs, '返し').map(function(t) { return t.name; }), ['夢想返し']);
    assert('filter: 全角半角を同一視', TechPicker.filter(ftechs, 'kesa').map(function(t) { return t.name; }), ['Ｋｅｓａ']);
    assert('filter: 大文字小文字を同一視', TechPicker.filter(ftechs, 'KESA').length, 1);
    assert('filter: 該当なしは空', TechPicker.filter(ftechs, '存在しない'), []);
    assert('filter: techs が null でも落ちない', TechPicker.filter(null, 'a'), []);
    assert('filter: 元の配列を壊さない', (function() { var c = ftechs.slice(); TechPicker.filter(ftechs, '四'); return ftechs.length === c.length; })(), true);
```

- [ ] **Step 2: 落ちることを確認**（`TechPicker.filter is not a function`）

- [ ] **Step 3: 実装**（`strikesLabel` の後に）

```js
  // 検索用の正規化。全角英数→半角（NFKC）、小文字化、前後の空白除去。
  function normalizeQuery(s) {
    var t = String(s || '');
    try { t = t.normalize('NFKC'); } catch (e) {}
    return t.toLowerCase().trim();
  }

  // 技名の部分一致で絞り込む。query が空なら全件（複製）。
  function filter(techs, query) {
    var list = Array.isArray(techs) ? techs : [];
    var q = normalizeQuery(query);
    if (!q) return list.slice();
    return list.filter(function(t) {
      return normalizeQuery(t && t.name).indexOf(q) !== -1;
    });
  }
```

`return` に `filter: filter,` を足す。

- [ ] **Step 4: テストが通ることを確認。Commit**

```bash
git add techpicker.js test.html
git commit -m "feat: 技名の部分一致で絞り込む TechPicker.filter を追加する"
```

### Task B2: シートにヘッダー行・検索欄・列そろえを入れる

**Files:**
- Modify: `techpicker.js`（`open`）
- Modify: `admin.css`（`/* ===== TechPicker のボトムシート ===== */` の節）

- [ ] **Step 1: open() のシート組み立てを置き換える**（`var list = document.createElement('div');` から `sheet.appendChild(list);` まで）

```js
    var STRIKE_HEADS = ['初太刀', '二ノ太刀', '三ノ太刀', '四ノ太刀'];

    // 検索欄（自動フォーカスはしない。スマホでキーボードが開いてしまうため）
    var search = document.createElement('div');
    search.className = 'tp-search';
    var searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = '技名で絞り込み';
    searchInput.setAttribute('aria-label', '技名で絞り込み');
    search.appendChild(searchInput);

    // ヘッダー行（技名と太刀の配点の列名）
    var header = document.createElement('div');
    header.className = 'tp-row tp-header';
    header.innerHTML = '<span class="tp-no"></span><span class="tp-name">技名</span>' +
      STRIKE_HEADS.map(function(h) { return '<span class="tp-s">' + h + '</span>'; }).join('');

    var list = document.createElement('div');
    list.className = 'tp-list';

    // この枠の選択を確定して閉じる。選ぶのも空にするのも1タップで終わる
    // （多枠選択だった頃と違い、この枠以外の状態には触れない）。
    function pick(name) {
      state = setSlot(state, slot, name);
      if (opts.onChange) opts.onChange(state.slice());
      done();
    }

    function renderList(query) {
      list.innerHTML = '';
      var clearItem = document.createElement('button');
      clearItem.type = 'button';
      clearItem.className = 'tp-item tp-clear';
      clearItem.textContent = '（この枠を空にする）';
      clearItem.addEventListener('click', function() { pick(''); });
      list.appendChild(clearItem);

      var shown = filter(techs, query);
      if (shown.length === 0) {
        var none = document.createElement('div');
        none.className = 'tp-none';
        none.textContent = '該当する技がありません';
        list.appendChild(none);
      }
      shown.forEach(function(t) {
        var item = document.createElement('button');
        item.type = 'button';
        // 重複を許すので、印を付けるのはこの枠に入っている技だけ（他の枠は見ない）
        var isOn = state[slot] !== '' && state[slot] === t.name;
        item.className = isOn ? 'tp-item tp-row on' : 'tp-item tp-row';
        item.dataset.name = t.name;
        // 枠だけ innerHTML で作り、値は textContent で入れる（技名はサーバー由来）
        item.innerHTML = '<span class="tp-no"></span><span class="tp-name"></span>' +
          '<span class="tp-s"></span><span class="tp-s"></span><span class="tp-s"></span><span class="tp-s"></span>';
        item.querySelector('.tp-no').textContent = isOn ? CIRCLED[slot] : '';
        item.querySelector('.tp-name').textContent = t.name;
        var cells = item.querySelectorAll('.tp-s');
        var strikes = (t && t.strikes) || [];
        for (var i = 0; i < 4; i++) {
          var v = strikes[i];
          cells[i].textContent = (v === null || v === undefined) ? '—' : String(v);
        }
        item.addEventListener('click', function() { pick(this.dataset.name); });
        list.appendChild(item);
      });
    }
    renderList('');
    searchInput.addEventListener('input', function() { renderList(searchInput.value); });

    sheet.appendChild(head);
    sheet.appendChild(search);
    sheet.appendChild(header);
    sheet.appendChild(list);
```

- [ ] **Step 2: admin.css の TechPicker 節を直す**（`.tp-item` 〜 `.tp-pt` を置き換え）

```css
.tp-search { padding: 8px 14px; border-bottom: 1px solid var(--border); }
.tp-search input[type="search"] {
  font-family: inherit; font-size: 16px; width: 100%; min-height: 44px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);
}
/* 技名と太刀の配点を列でそろえる（ヘッダー行と各技の行で同じ列幅） */
.tp-row { display: grid; grid-template-columns: 20px 1fr repeat(4, 48px); align-items: center; gap: 4px; }
.tp-header {
  padding: 6px 14px; font-size: 12px; color: var(--text-muted);
  border-bottom: 1px solid var(--border); background: var(--bg-secondary);
}
.tp-header .tp-s { text-align: right; }
.tp-item {
  width: 100%; min-height: 48px; padding: 0 14px; text-align: left;
  border-radius: 0; background: transparent; color: var(--text);
  border-bottom: 1px solid var(--border);
}
.tp-item.on { background: var(--bg-header); font-weight: bold; }
.tp-clear { color: var(--text-muted); display: block; } /* 「この枠を空にする」は控えめな色に。グリッド列は使わない */
.tp-none { padding: 14px; color: var(--text-muted); }
.tp-no { flex: 0 0 auto; width: 20px; color: var(--accent); }
.tp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-s { text-align: right; font-size: 13px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 3: ブラウザで確認**（運営画面 `admin.html` → 選手タブ → ＋ → ① をタップ）

確認項目: ヘッダー行が出る、配点が列でそろう、打てない太刀は「—」、検索で絞り込める、「（この枠を空にする）」が常に先頭、選ぶと閉じる、375px 幅で横にはみ出さない、`test.html` 全件 ✓。

- [ ] **Step 4: Commit**

```bash
git add techpicker.js admin.css
git commit -m "feat: 技シートに太刀のヘッダー行と検索欄を足し、配点を列でそろえる"
```

---

## トラック C（T1 一括登録 → T2 簡易 CSV）

### Task C1: 一括登録 API

**Files:**
- Modify: `server/index.js`（`POST /api/events/:id/players` の直後に追加）
- Modify: `api.js`（`createPlayer` の直後に追加）
- Test: `test.html`（`runApiTests`）

- [ ] **Step 1: API テストを足す**（`runApiTests` の「大会取得テスト」の後）

```js
    // 一括登録
    var bulk = await Api.createPlayersBulk(testEventId, {
      court: 'B', isFemale: true, isNewFace: true, names: ['佐藤 花', '', '  ', '鈴木 梅 ', '高橋 桜']
    });
    assert('bulk: 空行を除いた人数を作る', bulk.created, 3);
    assert('bulk: 順番はコート×性別で連番', bulk.players.map(function(p) { return p.order; }), ['B-女子-1-1', 'B-女子-1-2', 'B-女子-1-3']);
    assert('bulk: 名前は trim', bulk.players[1].name, '鈴木 梅');
    assert('bulk: 性別・新人が付く', [bulk.players[0].isFemale, bulk.players[0].isNewFace], [true, true]);
    assert('bulk: 技は空', [bulk.players[0].tech1, bulk.players[0].tech2, bulk.players[0].tech3], ['', '', '']);
    var bulk2 = await Api.createPlayersBulk(testEventId, { court: 'B', isFemale: true, isNewFace: false, names: ['田中 藤'] });
    assert('bulk: 既存の続きから採番', bulk2.players[0].order, 'B-女子-1-4');
    assert('bulk: 名前が全部空なら null', await Api.createPlayersBulk(testEventId, { court: 'B', isFemale: false, names: ['', ' '] }), null);
    assert('bulk: 不正なコートは null', await Api.createPlayersBulk(testEventId, { court: 'A-1', isFemale: false, names: ['x'] }), null);
    assert('bulk: names が配列でなければ null', await Api.createPlayersBulk(testEventId, { court: 'B', isFemale: false, names: 'x' }), null);
    var bulkLoaded = await Api.loadEvent(testEventId);
    assert('bulk: 大会に4名入っている', bulkLoaded.players.length, 4);
    await Api.importCsv(testEventId, '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n', 'replace');   // 後続のテストのため空に戻す
```

（既存の「CSVインポートテスト」は `replace` で始まるので、この後に置いても影響しない。）

- [ ] **Step 2: 落ちることを確認**

- [ ] **Step 3: api.js に追加**

```js
  async function createPlayersBulk(eventId, data) {
    // POST /api/events/:eventId/players/bulk
    // Body: { court, isFemale, isNewFace, names: ['名前', ...] }
    // 戻り値: { created, players } | null（400/404/通信失敗）
    // 1回の書き込みで コート×性別×一巡目 の続き番号を順に付ける。技は空で作る。
    try {
      var res = await fetch('/api/events/' + eventId + '/players/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) return null;
      var json = await res.json();
      return { created: json.created || 0, players: json.players || [] };
    } catch (e) {
      return null;
    }
  }
```

`return` に `createPlayersBulk: createPlayersBulk,` を足す。

- [ ] **Step 4: server/index.js に追加**（`POST /api/events/:id/players` のハンドラの直後）

```js
// POST /api/events/:id/players/bulk : 同じコート・性別・新人区分の選手をまとめて追加（一巡目、技は空）
// 名前は1件ずつ trim して空を除く。採番は nextOrderNumber を累積しながら順に行い、1回で書き込む。
app.post('/api/events/:id/players/bulk', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const body = req.body || {};
    const court = typeof body.court === 'string' ? body.court.trim() : '';
    if (!isValidCourt(court)) {
      return res.status(400).json({ error: '不正なコート名です' });
    }
    if (!Array.isArray(body.names)) {
      return res.status(400).json({ error: '名前の配列が必要です' });
    }
    const names = body.names
      .map(n => (typeof n === 'string' ? n.trim() : ''))
      .filter(n => n !== '');
    if (names.length === 0) {
      return res.status(400).json({ error: '登録する名前がありません' });
    }
    if (names.length > 500) {
      return res.status(400).json({ error: '一度に登録できるのは500名までです' });
    }

    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (!Array.isArray(event.players)) event.players = [];

    const isFemale = body.isFemale === true;
    const isNewFace = body.isNewFace === true;
    const gender = isFemale ? '女子' : '男子';
    const created = [];
    names.forEach(name => {
      const n = nextOrderNumber(event.players.concat(created), court, gender, 1);
      created.push({
        id: generateId(),
        name: name,
        order: buildOrder(court, isFemale, 1, n),
        tech1: '',
        tech2: '',
        tech3: '',
        score: 0,
        isNewFace: isNewFace,
        isFemale: isFemale,
        result: ''
      });
    });

    event.players = event.players.concat(created);
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.status(201).json({ success: true, created: created.length, players: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 5: サーバーを再起動してテストが通ることを確認。Commit**

```bash
git add server/index.js api.js test.html
git commit -m "feat: 選手をまとめて追加する API（POST /players/bulk）を追加する"
```

### Task C2: 一括登録シート（運営画面）

**Files:**
- Modify: `admin-players.js`（`buildPlayerForm` の部品切り出し、`openMenu`、新規 `openBulkSheet`）

- [ ] **Step 1: コート・性別・新人の部品を切り出す**

`buildPlayerForm` の「コート」「性別」「新人」の組み立て（`var fCourt = ...` から `el.appendChild(fNew);` まで）を次の関数に移し、`buildPlayerForm` からはそれを呼ぶ。

```js
  // コート・性別・新人の入力部品（1人ずつの追加・編集フォームと一括登録シートで共用）
  // 戻り値: { el, court(), isFemale(), isNewFace() }
  function buildCommonFields(ctx, player) {
    var el = document.createElement('div');

    // 既存のコート一覧（未分類はサーバーが受け付けないので候補に出さない）
    var courts = Courts.listFrom(ctx.players).filter(function(c) {
      return c !== Courts.UNASSIGNED;
    });
    var court = player ? Courts.courtOf(player) : (courts[0] || '');
    if (court === Courts.UNASSIGNED) court = courts[0] || '';
    // 最初の選手はコート未定なので A を初期値にする（1タップで変えられる）
    if (!court && courts.length === 0) court = 'A';
    if (court && courts.indexOf(court) === -1) courts.push(court);

    var isFemale = player ? !!player.isFemale : false;

    // コート（セグメント＋「＋」で新しいコート名）
    var fCourt = document.createElement('div');
    fCourt.className = 'field';
    var lCourt = document.createElement('label');
    lCourt.textContent = 'コート';
    var segCourt = document.createElement('div');
    segCourt.className = 'seg';
    fCourt.appendChild(lCourt);
    fCourt.appendChild(segCourt);
    el.appendChild(fCourt);

    function renderCourtSeg() {
      /* 既存の renderCourtSeg の中身をそのまま移す（変更しない） */
    }
    renderCourtSeg();

    // 性別
    var fSex = document.createElement('div');
    fSex.className = 'field';
    var lSex = document.createElement('label');
    lSex.textContent = '性別';
    var segSex = document.createElement('div');
    segSex.className = 'seg';
    fSex.appendChild(lSex);
    fSex.appendChild(segSex);
    el.appendChild(fSex);

    function renderSexSeg() {
      /* 既存の renderSexSeg の中身をそのまま移す（変更しない） */
    }
    renderSexSeg();

    // 新人
    var fNew = document.createElement('div');
    fNew.className = 'field';
    var toggle = document.createElement('label');
    toggle.className = 'toggle';
    var chkNew = document.createElement('input');
    chkNew.type = 'checkbox';
    chkNew.checked = player ? !!player.isNewFace : false;
    var txtNew = document.createElement('span');
    txtNew.textContent = '新人';
    toggle.appendChild(chkNew);
    toggle.appendChild(txtNew);
    fNew.appendChild(toggle);
    el.appendChild(fNew);

    return {
      el: el,
      court: function() { return court; },
      isFemale: function() { return isFemale; },
      isNewFace: function() { return chkNew.checked; }
    };
  }
```

`buildPlayerForm` は名前の後に `var common = buildCommonFields(ctx, player); el.appendChild(common.el);` を置き、`read()` では `court: common.court(), isFemale: common.isFemale(), isNewFace: common.isNewFace()` を返す。`reset()` は名前と技だけ空にする（変更なし）。

- [ ] **Step 2: 既存の追加・編集フォームがこれまでどおり動くことをブラウザで確認**（追加、コート＋、性別切替、新人、保存して次を追加、編集の保存）

- [ ] **Step 3: Commit**

```bash
git add admin-players.js
git commit -m "refactor: 選手フォームのコート・性別・新人の部品を切り出す"
```

- [ ] **Step 4: 一括登録シートを追加**（`openAddSheet` の後に）

```js
  // 一括登録（1行1人の名前を貼り付ける）。コート・性別・新人は共通。技は後で入れる。
  function openBulkSheet(ctx) {
    var body = document.createElement('div');
    var common = buildCommonFields(ctx, null);
    body.appendChild(common.el);

    var fNames = document.createElement('div');
    fNames.className = 'field';
    var lNames = document.createElement('label');
    lNames.textContent = '名前（1行に1人）';
    var ta = document.createElement('textarea');
    ta.className = 'bulk-names';
    ta.rows = 8;
    ta.placeholder = '山田 太郎\n佐藤 花子\n…';
    var count = document.createElement('div');
    count.className = 'bulk-count';
    fNames.appendChild(lNames);
    fNames.appendChild(ta);
    fNames.appendChild(count);
    body.appendChild(fNames);

    function names() {
      return ta.value.split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean);
    }
    function updateCount() {
      count.textContent = names().length + ' 人';
    }
    ta.addEventListener('input', updateCount);
    updateCount();

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn';
    btnClose.textContent = '閉じる';
    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn primary';
    btnSave.textContent = '登録';

    var added = 0;
    var sheet = Admin.openSheet('複数人をまとめて登録', body, [btnClose, btnSave], function() {
      if (added > 0) Admin.reloadEvent();
    });
    btnClose.addEventListener('click', sheet.close);

    btnSave.addEventListener('click', async function() {
      var list = names();
      if (list.length === 0) { alert('名前を1人以上入力してください。'); return; }
      var court = common.court();
      if (!court) { alert('コートを選んでください。「＋」で新しいコートを作れます。'); return; }
      var sexLabel = common.isFemale() ? '女子' : '男子';
      if (!confirm(court + ' コート ' + sexLabel + ' ' + list.length + ' 人を登録します。よろしいですか？')) return;
      var eventId = ctx.eventId;   // await をまたぐので大会をここで固定する
      btnSave.disabled = true;
      btnClose.disabled = true;
      sheet.lock(true);
      var res = await Api.createPlayersBulk(eventId, {
        court: court, isFemale: common.isFemale(), isNewFace: common.isNewFace(), names: list
      });
      if (Admin.currentEventId() !== eventId) return;   // 大会が切り替わっていたら画面に触らない
      sheet.lock(false);
      btnSave.disabled = false;
      btnClose.disabled = false;
      if (!res) {
        // 失敗してもシートは閉じない（入力を残す）
        alert('登録できませんでした。\n入力内容と通信を確認してください。');
        return;
      }
      added += res.created;
      Admin.toast(res.created + ' 人を登録しました');
      sheet.close();   // onClose が一覧を反映する
    });
  }
```

`openMenu` の CSV ボタンの前に:

```js
    var btnBulk = document.createElement('button');
    btnBulk.type = 'button';
    btnBulk.className = 'menu-item';
    btnBulk.textContent = '👥 複数人をまとめて登録';
    body.appendChild(btnBulk);
```

とハンドラ:

```js
    btnBulk.addEventListener('click', function() {
      sheet.close();
      openBulkSheet(ctx);
    });
```

`admin.css` はトラック C では触らない。textarea のスタイルはトラック C が `admin-players.js` からは足せないので、`admin.css` の `input[type="text"], input[type="date"]` のセレクタに `textarea` を足す1行だけ許可する（`admin.css:31`）。`.bulk-count { font-size: 12px; color: var(--text-muted); margin-top: 4px; }` も `/* ===== フォーム部品 ===== */` の末尾に足す。

- [ ] **Step 5: ブラウザで確認**（⋯ → 複数人をまとめて登録 → 名前を3行貼る → 人数表示 → 登録 → 一覧に3名、順番が連番）

- [ ] **Step 6: Commit**

```bash
git add admin-players.js admin.css
git commit -m "feat: 運営画面の選手タブに複数人をまとめて登録するシートを足す"
```

### Task C3: CSV インポートの簡易列（と拡張15列）

**Files:**
- Modify: `server/index.js`（`POST /api/events/:id/import` の行→選手の変換部分）
- Test: `test.html`（`runApiTests`）

- [ ] **Step 1: テストを足す**（既存の「CSVインポートテスト」の後）

```js
    // 簡易列の CSV（順番はサーバーが採番）
    var simpleCsv = '名前,コート,性別,技①,技②,技③,新人\n' +
      '簡易 一郎,A,男,四方,,,\n' +
      '簡易 二子,A,女子,水月,陽中陰,夢想返し,○\n' +
      '簡易 三郎,A,男子,,,,1\n' +
      ',A,男,,,,\n' +
      '簡易 四子,B,○,,,,';
    var simpleRes = await Api.importCsv(testEventId, simpleCsv, 'replace');
    assert('簡易CSV: 空の名前を飛ばす', simpleRes.playerCount, 4);
    var simpleLoaded = await Api.loadEvent(testEventId);
    var sp = simpleLoaded.players;
    assert('簡易CSV: 順番はコート×性別で採番', sp.map(function(p) { return p.order; }), ['A-男子-1-1', 'A-女子-1-1', 'A-男子-1-2', 'B-女子-1-1']);
    assert('簡易CSV: 技', [sp[1].tech1, sp[1].tech2, sp[1].tech3], ['水月', '陽中陰', '夢想返し']);
    assert('簡易CSV: 新人（○）', sp[1].isNewFace, true);
    assert('簡易CSV: 新人（1）', sp[2].isNewFace, true);
    assert('簡易CSV: 新人なし', sp[0].isNewFace, false);
    assert('簡易CSV: 性別 ○ は女子', sp[3].isFemale, true);
    var simpleAppend = await Api.importCsv(testEventId, '名前,コート,性別\n追記 五郎,A,男', 'append');
    var appended2 = await Api.loadEvent(testEventId);
    assert('簡易CSV: 追記は既存の続きから採番', appended2.players[4].order, 'A-男子-1-3');
    assert('簡易CSV: 不正なコートは失敗', await Api.importCsv(testEventId, '名前,コート,性別\n誰か,A-1,男', 'append'), null);
    // 拡張15列（エクスポートの往復）
    var fullCsv = '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果,補正点1,補正点2,補正点3,全体補正,備考,確定\n' +
      '拡張 太郎,C-男子-1-1,四方,,,10,,,1    ,2,0,0,-1,メモ,○';
    await Api.importCsv(testEventId, fullCsv, 'replace');
    var fullLoaded = await Api.loadEvent(testEventId);
    assert('拡張CSV: 補正点', fullLoaded.players[0].adjust, [2, 0, 0]);
    assert('拡張CSV: 全体補正・備考・確定', [fullLoaded.players[0].totalAdjust, fullLoaded.players[0].note, fullLoaded.players[0].confirmed], [-1, 'メモ', true]);
    await Api.importCsv(testEventId, '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n', 'replace');   // 後続のテストのため空に戻す
```

注意: 既存テストの続き（「インポート後の確認」）は `replace` で 1 名を入れ直しているので、この節はその後ろ、「大会削除テスト」の前に置く。

- [ ] **Step 2: 落ちることを確認**

- [ ] **Step 3: import の変換を置き換える**（`const dataLines = lines.slice(1);` から `.filter(p => p.name !== '');` まで）

```js
    // 先頭行で形式を判別する（設計書 T5「サーバー」の表）
    //   2列目が「コート」 → 簡易7列（名前,コート,性別,技①,技②,技③,新人）。順番はサーバーが採番
    //   それ以外          → 従来9列／拡張15列（補正点1..3,全体補正,備考,確定）。順番は CSV の値
    const header = lines[0].map(c => String(c || '').trim());
    const isSimple = header[1] === 'コート';
    const dataLines = lines.slice(1);
    const toInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
    const truthy = v => ['○', '1', 'はい', '新人'].indexOf(String(v || '').trim()) !== -1;
    const femaleMark = v => ['女', '女子', '○', 'F', 'f'].indexOf(String(v || '').trim()) !== -1;

    let importedPlayers;
    if (isSimple) {
      // 採番の土台: replace なら空、append なら既存の選手
      const base = mode === 'replace' ? [] : (event.players || []);
      importedPlayers = [];
      for (let i = 0; i < dataLines.length; i++) {
        const row = dataLines[i];
        const name = String(row[0] || '').trim();
        if (!name) continue;
        const court = String(row[1] || '').trim();
        if (!isValidCourt(court)) {
          return res.status(400).json({ error: (i + 2) + ' 行目のコート名が不正です' });
        }
        const isFemale = femaleMark(row[2]);
        const gender = isFemale ? '女子' : '男子';
        const n = nextOrderNumber(base.concat(importedPlayers), court, gender, 1);
        importedPlayers.push({
          id: generateId(),
          name,
          order: buildOrder(court, isFemale, 1, n),
          tech1: row[3] || '',
          tech2: row[4] || '',
          tech3: row[5] || '',
          score: 0,
          isNewFace: truthy(row[6]),
          isFemale,
          result: ''
        });
      }
    } else {
      importedPlayers = dataLines.map(row => {
        // 選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果[,補正点1,補正点2,補正点3,全体補正,備考,確定]
        const p = {
          id: generateId(),
          name: row[0] || '',
          order: row[1] || '',
          tech1: row[2] || '',
          tech2: row[3] || '',
          tech3: row[4] || '',
          score: parseFloat(row[5]) || 0,
          isNewFace: row[6] === '○',
          isFemale: row[7] === '○',
          result: row[8] || ''
        };
        if (row.length >= 10) {
          p.adjust = [toInt(row[9]), toInt(row[10]), toInt(row[11])];
          p.totalAdjust = toInt(row[12]);
          p.note = String(row[13] || '').trim().slice(0, 200);
          p.confirmed = String(row[14] || '').trim() === '○';
        }
        return p;
      }).filter(p => p.name !== ''); // 空行等を除外
    }
```

- [ ] **Step 4: サーバーを再起動してテストが通ることを確認。Commit**

```bash
git add server/index.js test.html
git commit -m "feat: CSV インポートで簡易7列（順番はサーバー採番）と拡張15列を受け付ける"
```

---

## トラック D（T3 進行タブから採点画面へ）

### Task D1: 「採点画面へ」ボタン

**Files:**
- Modify: `admin-round.js`（`render` の見出し行）
- Modify: `admin.css`（`/* ===== 進行タブ ===== */` の節）

- [ ] **Step 1: ボタンを足す**（`head.appendChild(genBtn);` の直後）

```js
    // 採点画面へ（絞り込み中のコートを引き継ぐ。採点画面の Route と同じ形 #event/<大会ID>/<コート>）
    var openBtn = document.createElement('a');
    openBtn.className = 'round-open';
    openBtn.id = 'btnOpenScoring';
    openBtn.textContent = '採点画面へ';
    openBtn.href = scoringHref(ctx.eventId, currentCourt);
    head.appendChild(openBtn);
```

`onCourtChange` の中で `openBtn.href = scoringHref(ctx.eventId, currentCourt);` を足す（コートを切り替えたら遷移先も変える）。`openBtn` は `onCourtChange` より前に宣言されているので参照できる（見出しの後にチップを作っている順序を保つ）。

モジュール内に純粋関数を足し、`return` にも出す:

```js
  // 採点画面のハッシュ（route.js の Route.build と同じ形。admin.html は route.js を読まない）
  function scoringHref(eventId, court) {
    var hash = '#event/' + encodeURIComponent(eventId || '');
    if (court) hash += '/' + encodeURIComponent(court);
    return 'index.html' + hash;
  }
```

- [ ] **Step 2: テスト**（`test.html` は触らない。トラック D はテストファイルを触らないので、`Admin` の読み込み順の都合で `admin-round.js` は test.html に読み込まれていない。代わりに次をブラウザのコンソールで確認する）

```js
AdminRound.scoringHref('abc', 'A')   // → 'index.html#event/abc/A'
AdminRound.scoringHref('abc', '')    // → 'index.html#event/abc'
AdminRound.scoringHref('a b', '未分類') // → 'index.html#event/a%20b/%E6%9C%AA%E5%88%86%E9%A1%9E'
```

- [ ] **Step 3: admin.css**（`.round-gen` の後に）

```css
.round-open {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px;
  border: 1px solid var(--accent); border-radius: 6px; color: var(--accent);
  text-decoration: none; font-size: 14px; background: var(--bg);
}
```

- [ ] **Step 4: ブラウザで確認**（進行タブ → コートチップで B を選ぶ → 「採点画面へ」 → 採点画面が B コートで開く。戻るで進行タブへ戻れる）

- [ ] **Step 5: Commit**

```bash
git add admin-round.js admin.css
git commit -m "feat: 進行タブから絞り込み中のコートで採点画面を開けるようにする"
```

---

## 統合（指揮官が行う）

- [ ] トラック D → B → C → A の順に `master` へマージする（`test.html` と `admin.css` と `server/index.js` の追記が衝突したら両方を残す）。
- [ ] main の worktree でサーバーを起動し、`test.html` が全件 ✓ であることを確認する（本物の大会は `test.html` が触らない。テストは自分で作った大会だけを消す）。
- [ ] `grep -n "技術点\|の太刀\|techPoint\|player-list-panel\|btnPlayerList\b" *.js *.html *.css` で取り残しを確認する。
- [ ] Opus の code-reviewer に設計書と差分を渡してレビューさせ、指摘を直す。
- [ ] `master` と `production` に push する（AGENTS.md の運用）。デプロイはユーザーがサーバーで行う。
