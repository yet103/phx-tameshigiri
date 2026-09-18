# PC の試合と結果（コート別の状況・二巡目の生成と技入力・順位・配信ボード・ヘルプ） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC 運営（`desk.html`）の「試合」と「結果」の区画を、プレースホルダーから実際に使えるものにする。試合はコートごとのカード（採点済み n / N・いま採点中の選手・採点画面を開く・URL をコピー）と、一巡目終了のときの二巡目の生成・技入力の表。結果は 3 部門の順位を PC 幅で 3 列に並べ、発表モード・共有リンク・配信ボードの URL を出す。あわせて `help.html` を 7 段階の流れと PC 運営の画面に合わせて書き直す。

**Architecture:** 画面を持つのは `desk-match.js` と `desk-results.js` の 2 ファイルだけ。DOM を持たない判定（コートごとの集計・`live` から採点中の選手を引く・「全員にコピー」の対象行）は `courts.js` に置いて `test.html` で固定する（`test.html` は `desk-match.js` を読み込まないため、純粋関数を区画の中に置くとテストできない）。二巡目の生成・技の保存・状態の遷移は、スマホ運営（`admin-round.js`）と同じ API と同じ確認文言を通す。「採点済み n / N」といま採点中の選手はポーリングせず、「↻ 最新に更新」（`Desk.reloadEvent`）で読み直す。

**Tech Stack:** 素の JavaScript（IIFE、`var` と `function`。`async`/`await` は可）、Express 5、`test.html`（ブラウザで動くテストランナー。`assert(desc, actual, expected)` は `JSON.stringify` 比較）。

設計書: `docs/superpowers/specs/2026-09-18-pc-mode-and-event-status-design.md`（特に「画面設計 > PC 運営 > 試合」「同 > 結果」「画面設計 > ヘルプ」「エラー処理」「テスト」「リスクと未解決事項」の節）
前の計画:
- `docs/superpowers/plans/2026-09-18-event-status.md`（計画1。実装済み。`status.js` / 遷移 API / ロックガード）
- `docs/superpowers/plans/2026-09-18-desk-foundation.md`（計画2。実装済み。`desk.html` の骨組みと `Desk.*` の公開 API、`desk.css`）
- `docs/superpowers/plans/2026-09-18-home-and-scoring-rename.md`（計画3。トップと `scoring.html` への改名）
- `docs/superpowers/plans/2026-09-19-desk-players-table.md`（計画4。**別の担当者がこの後に実装する**。PC の選手表）

この計画は設計書「実装の分割」の **計画5: PC の試合と結果** だけを扱う。

---

## 前提・共通の手順

- **同じ作業ツリーで他の担当者が並行して作業している**。次の 3 つを守れば衝突しない。
  - **`desk-players.js` には一切触らない**（計画4 の本体）
  - **計画4 が足す予定の関数（`Courts.parsePasteRows` / `Courts.scoreMayChange` / `Courts.scoreChangeConfirmMessage` / `Storage.pickCsvFile`）は使わない**。採点済みの選手の技を変えるときの警告は、いまの `admin-round.js` の `saveTech` の判定（`Courts.isScored` と、その場で組む確認文言）をそのまま写す。計画4 が入ったあとで `Courts.scoreChangeConfirmMessage` に寄せられるよう、写した場所にその旨のコメントを残す
  - **`courts.js` `test.html` `desk.css` は計画4 も触る**。足す場所をこの計画で指定したとおり（`courts.js` は `sortBy` の直後、`test.html` は `sortBy: 元配列を変えない` の assert の直後、`desk.css` はファイル末尾）にすれば、計画4 の追記場所（`courts.js` は `nextRoundResultMessage` の直後と `statusConfirmMessage` の直後、`test.html` は `statusConfirmMessage: archived から final …` の assert の直後）とは重ならない。**編集の前に必ず `git status` と対象箇所を読み直す**
  - `git add` は**各タスクで明示したファイルだけ**。`git status` に出る他人の変更（作業開始時点では `home.js`）を巻き込まない。`.git/index.lock` があれば数秒待って再試行する
- **サーバーの起動**: リポジトリのルートで `PORT=3461 node server/index.js`（バックグラウンド）。`.claude/launch.json` の `dev-3461` が同じ構成。既に起動していれば再利用する。この計画は `server/index.js` を変えないので、サーバーの再起動は不要
- **自動テスト**: `http://localhost:3461/test.html` をブラウザで開き、ページ末尾の `Result: N passed, 0 failed` を確認する。編集後の再確認は同じ URL への再 navigate ではなく `location.reload()` か**新しいタブ**で行う（bfcache で古い JS が使われる）
- **画面確認**: `http://localhost:3461/desk.html`（PC 運営。ウィンドウ幅 **1280px**）、`http://localhost:3461/scoring.html`（採点画面。タブレット想定）、`http://localhost:3461/help.html`
- 確認に使う大会は**自分がこの作業中に作った大会だけ**。**本物の大会「第10回全日本試し斬り大会」のデータには絶対に触らない**（状態を進めない・選手を消さない・技を変えない）
- コミットメッセージは日本語。接頭辞は `feat:` `fix:` `refactor:` `test:` `docs:`。末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける
- **作法**: IIFE、`var` と `function`、`async`/`await` は可。`await` の直後は必ず `ctx.isStale()` を見て、古ければ DOM に触らない・`alert` も出さない。ダイアログや確認をまたぐときは `Desk.currentEventId() !== eventId` も見る（`desk-events.js` と同じ作法）
- **状態の判定を直書きしない**（`event.status === 'final'` と書かず `EventStatus.of` / `isLocked` / `scoringRound` / `LABELS` を使う）
- **`desk.css` は `theme.css` の変数だけを使う**。赤い文字は `--cell-fail-text`、赤い枠線とボタンは `--btn-fail`
- **ポーリングを足さない**。「採点済み n / N」といま採点中の選手は、大会を読んだ時点の値。自動更新するのは配信ボード（`board.html`）だけ、という既存の方針を変えない

### 設計書との差（この計画で決めたこと）

1. **配信ボードの URL はコートごとに出す**。設計書は「配信ボードの URL コピー（`board.html#<token>`）」と書いているが、`board.js` はハッシュを `#<トークン>/<コート>` として読み、コートが無いと「コートが指定されていません」で止まる。そこで結果の区画には**コートごとのボタン**を並べ、`board.html#<token>/<コート>` を組む
2. **「全員に一巡目と同じ技をコピー」の対象は「技が3枠とも空」かつ「未採点」の行だけ**。途中まで入れた行を一括で上書きしない（行ごとのボタンで個別に上書きできる）。採点済みの行も外す（得点が変わる警告は行ごとに出す）。そのため画面の「技 未入力 n」（1つでも空なら数える）とボタンの対象件数は一致しないことがあるので、ボタンに件数を書いて区別する
3. **コート別のカードはその巡目の行が 0 件でも出す**。二巡目を生成する前（`round1_done`）にカードが消えないようにするため

---

## ファイル構成

- **Modify**: `desk.js` — `copyText(text, okMessage)` を足す（試合と結果の両方が URL をコピーするので骨組みに置く）
- **Modify**: `courts.js` — `progressRound` / `courtProgress` / `livePlayerName` / `techCopyTargets`（DOM を持たない判定）
- **Modify**: `desk.css` — `.desk-match-*` と `.desk-results-*`（ファイル末尾に追記）
- **Modify**: `desk-match.js` — プレースホルダーを本体に差し替える（この計画の本体その1）
- **Modify**: `desk-results.js` — プレースホルダーを本体に差し替える（この計画の本体その2）
- **Modify**: `help.html` — 「0. 全体の流れ」の図を 7 段階に、「1. 大会の作成」に PC の表・貼り付け・コピー・アーカイブ、「2. 採点の進行」を PC 運営の試合の区画に沿って書き直し、「3. 得点の集計」「4. サイト掲載」に PC の結果の区画
- **Modify**: `test.html` — `courts.js` の節に上の 4 関数のテスト

**触らない**: `desk-players.js` `desk-events.js` `desk-setup.js` `desk-techniques.js` `desk.html` `admin*.js` `app.js` `index.html` `home.*` `server/index.js` `server/static-policy.js` `api.js` `storage.js`（新しいファイルを作らないので許可リストの変更は要らない）。

---

## 並行できるタスク

- **Task 1（`desk.js`）・Task 2（`courts.js` + `test.html`）・Task 3（`desk.css`）・Task 7（`help.html`）は 4 本とも同時に始められる**（触るファイルが重ならない）
- **Task 4 → Task 5** は順番に（どちらも `desk-match.js`）。開始の前提は Task 1・2・3 が済んでいること
- **Task 6**（`desk-results.js`）は Task 1・3 の後ならいつでも。Task 4・5 と並行できる
- **Task 8**（通しの手動確認）は全部の後

最短は「A: Task 1 → 4 → 5」「B: Task 2」「C: Task 3」「D: Task 6（1 と 3 の後）」「E: Task 7」を回し、最後に Task 8。

---

### Task 1: `desk.js` に URL をクリップボードへ写す共通関数を足す

試合の区画（採点画面の URL）と結果の区画（共有リンク・配信ボード）の両方が同じことをする。`navigator.clipboard` は HTTPS か localhost でしか使えず、権限が無い環境もあるので、失敗したら `window.prompt` に落として手で写せるようにする（スマホ運営の `admin-results.js` の「共有リンクをコピー」と同じ作法）。置き場は `desk.js`（`toast` / `openDialog` と同じ「区画から使う共通部品」の並び）。

**Files:**
- Modify: `desk.js`（`openScoring` の閉じ括弧の直後、`// --- テーマとモード ---` の直前。`return {` の公開一覧にも足す）

- [ ] **Step 1: `desk.js` に関数を足す**

`desk.js` の

```js
  function openScoring(eventId, court) {
    var name = court ? 'tmg_scoring_' + court : 'tmg_scoring';
    var w = window.open(scoringHref(eventId, court), name);
    if (!w) {
      alert('採点画面を開けませんでした。\nポップアップを許可するか、「試合」の区画から開いてください。');
    }
    return w;
  }
```

の**直後**（空行をはさんで `// --- テーマとモード ---` の前）に足す。

```js
  // URL などをクリップボードへ写す。試合の区画（採点画面の URL）と
  // 結果の区画（共有リンク・配信ボード）が使う。
  // navigator.clipboard は HTTPS か localhost でしか使えず、権限が無い環境もあるので、
  // 失敗したら prompt に落として手で写せるようにする
  // （スマホ運営の admin-results.js「共有リンクをコピー」と同じ作法）。
  // 戻り値: クリップボードに入ったら true、prompt に落ちたら false。
  async function copyText(text, okMessage) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        toast(okMessage || 'コピーしました');
        return true;
      } catch (e) {
        // 権限が無い・HTTPS でない等。下の prompt に落とす
      }
    }
    window.prompt('このURLをコピーしてください', text);
    return false;
  }
```

- [ ] **Step 2: 公開の一覧に足す**

`desk.js` 末尾の `return {` の中、`scoringHref: scoringHref,` の**直前**に 1 行足す。

```js
    copyText: copyText,
```

足したあとの並びはこうなる。

```js
    toast: toast,
    openDialog: openDialog,
    closeAllDialogs: closeAllDialogs,
    copyText: copyText,
    scoringHref: scoringHref,
    openScoring: openScoring
```

- [ ] **Step 3: ブラウザで確かめる**

`http://localhost:3461/desk.html` を新しいタブで開き、開発者ツールのコンソールで次を実行する。

```js
Desk.copyText('http://example.test/x', 'コピーしました')
```

Expected: 右下に「コピーしました」のトーストが出て、`Promise {<fulfilled>: true}` が返る（localhost なので `navigator.clipboard` が使える）。貼り付け先（アドレスバーなど）に `http://example.test/x` が入る。

- [ ] **Step 4: 既存のテストが通ることを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`（この変更でテストの本数は増えない）

- [ ] **Step 5: commit**

```bash
git add desk.js
git commit -m "$(cat <<'EOF'
feat: PC 運営に URL をクリップボードへ写す共通関数を足す

試合の区画と結果の区画の両方が採点画面・共有リンク・配信ボードの URL を
コピーするので、骨組み（desk.js）に置いて共有する。navigator.clipboard が
使えない環境では prompt に落として手で写せるようにする。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `courts.js` に試合の区画の集計を足す（純粋関数とテスト）

設計書「テスト」の指示どおり、DOM を持たない判定は `courts.js` に置いて `test.html` で固定する（`test.html` は `desk-match.js` を読み込まないので、区画の中に置くとテストできない）。足すのは 4 つ。

| 関数 | 使いどころ |
|---|---|
| `progressRound(status, players)` | コート別のカードで数える巡目 |
| `courtProgress(players, round)` | コートごとの「採点済み n / N」 |
| `livePlayerName(live, court, players)` | いま採点中の選手の名前 |
| `techCopyTargets(players)` | 「全員に一巡目と同じ技をコピー」の対象行 |

**Files:**
- Modify: `courts.js`（`sortBy` の閉じ括弧の直後、`// 二巡目生成 API の 409 応答（reason: 'unscored' | 'exists'）を確認文言にする。` の直前に追記。`return {` の公開一覧は `sortBy: sortBy,` の直後に足す）
- Modify: `test.html`（`courts.js` の節。`assert('sortBy: 元配列を変えない', …);` の直後、`// ---- 段階表示の件数と遷移の確認文言（PC 運営と スマホ運営で共用） ----` の直前）

- [ ] **Step 1: 失敗するテストを書く**

`test.html` の

```js
    assert('sortBy: 元配列を変えない', ordersOf(sPlayers), ['A-男子-1-10', 'A-男子-1-2', 'B-男子-1-1']);
```

の**直後**（空行をはさんで `// ---- 段階表示の件数と遷移の確認文言` の前）に足す。

```js
    // ---- 試合の区画（PC 運営 #match）の集計 ----
    // p1 は一巡目・採点済み、p5 は二巡目・採点済み。p4 は二巡目で技が空、
    // p6 は二巡目で技が途中まで入っている。
    var mcP = [
      { id: 'p1', order: 'A-男子-1-1', name: '山田', tech1: '真', tech2: '連', tech3: '左', score: 10 },
      { id: 'p2', order: 'A-男子-1-2', name: '佐藤', tech1: '真', tech2: '連', tech3: '左' },
      { id: 'p3', order: 'B-女子-1-1', name: '鈴木', tech1: '真', tech2: '連', tech3: '左' },
      { id: 'p4', order: 'A-男子-2-1', name: '佐藤', sourcePlayerId: 'p2' },
      { id: 'p5', order: 'A-男子-2-2', name: '山田', sourcePlayerId: 'p1', score: 5 },
      { id: 'p6', order: 'B-女子-2-1', name: '鈴木', sourcePlayerId: 'p3', tech1: '真', tech2: '', tech3: '' }
    ];

    assert('progressRound: 一巡目 進行中は一巡目', Courts.progressRound('round1', mcP), 1);
    assert('progressRound: 二巡目 進行中は二巡目', Courts.progressRound('round2', mcP), 2);
    assert('progressRound: 準備中はこれから採点する一巡目', Courts.progressRound('draft', mcP), 1);
    assert('progressRound: 一巡目終了はこれから採点する二巡目', Courts.progressRound('round1_done', mcP), 2);
    assert('progressRound: 二巡目終了は二巡目の行があれば二巡目', Courts.progressRound('round2_done', mcP), 2);
    assert('progressRound: 二巡目の行が無ければ一巡目',
      Courts.progressRound('final', [{ order: 'A-男子-1-1' }]), 1);
    assert('progressRound: players が無くても落ちない', Courts.progressRound('archived', null), 1);

    assert('courtProgress: 一巡目のコート別集計',
      Courts.courtProgress(mcP, 1),
      [{ court: 'A', total: 2, scored: 1 }, { court: 'B', total: 1, scored: 0 }]);
    assert('courtProgress: 二巡目のコート別集計',
      Courts.courtProgress(mcP, 2),
      [{ court: 'A', total: 2, scored: 1 }, { court: 'B', total: 1, scored: 0 }]);
    assert('courtProgress: その巡目の行が無いコートも 0 / 0 で出す（生成前にカードを消さない）',
      Courts.courtProgress([{ order: 'A-男子-1-1' }, { order: 'B-男子-1-1' }], 2),
      [{ court: 'A', total: 0, scored: 0 }, { court: 'B', total: 0, scored: 0 }]);
    assert('courtProgress: 未分類は末尾',
      Courts.courtProgress([{ order: '' }, { order: 'A-男子-1-1' }], 1).map(function(x) { return x.court; }),
      ['A', '未分類']);
    assert('courtProgress: players が無ければ空', Courts.courtProgress(null, 1), []);

    var mcLive = { A: { playerId: 'p1', timer: { sec: 300, running: false } }, B: { playerId: null } };
    assert('livePlayerName: live の playerId から名前を引く', Courts.livePlayerName(mcLive, 'A', mcP), '山田');
    assert('livePlayerName: 選手が外れているコートは空文字', Courts.livePlayerName(mcLive, 'B', mcP), '');
    assert('livePlayerName: ライブ状態の無いコートは空文字', Courts.livePlayerName(mcLive, 'C', mcP), '');
    assert('livePlayerName: live が無くても落ちない', Courts.livePlayerName(null, 'A', mcP), '');
    assert('livePlayerName: コート名が空でも落ちない', Courts.livePlayerName(mcLive, '', mcP), '');
    assert('livePlayerName: 消えた選手の ID は空文字',
      Courts.livePlayerName({ A: { playerId: 'zzz' } }, 'A', mcP), '');
    assert('livePlayerName: 名前の無い選手は (名称未設定)',
      Courts.livePlayerName({ A: { playerId: 'p9' } }, 'A', [{ id: 'p9', name: '' }]), '(名称未設定)');
    assert('livePlayerName: プロトタイプのキーを拾わない',
      Courts.livePlayerName({}, 'toString', mcP), '');

    assert('techCopyTargets: 技が空の二巡目の行を一巡目の行と組にして返す',
      Courts.techCopyTargets(mcP).map(function(t) { return [t.player.id, t.source.id]; }),
      [['p4', 'p2']]);
    assert('techCopyTargets: 途中まで入れた行は対象にしない（上書きしない）',
      Courts.techCopyTargets([
        { id: 'a', order: 'A-男子-2-1', tech1: '真', sourcePlayerId: 'b' },
        { id: 'b', order: 'A-男子-1-1', tech1: '真', tech2: '連', tech3: '左' }
      ]).length, 0);
    assert('techCopyTargets: 採点済みの行は対象にしない（行ごとのボタンで確認してから）',
      Courts.techCopyTargets([
        { id: 'a', order: 'A-男子-2-1', score: 3, sourcePlayerId: 'b' },
        { id: 'b', order: 'A-男子-1-1', tech1: '真', tech2: '連', tech3: '左' }
      ]).length, 0);
    assert('techCopyTargets: 一巡目の行が消えていたら対象にしない',
      Courts.techCopyTargets([{ id: 'a', order: 'A-男子-2-1', sourcePlayerId: 'zzz' }]).length, 0);
    assert('techCopyTargets: sourcePlayerId が無い（CSV 由来の）行は対象にしない',
      Courts.techCopyTargets([{ id: 'a', order: 'A-男子-2-1' }]).length, 0);
    assert('techCopyTargets: 一巡目の行の技も空なら対象にしない',
      Courts.techCopyTargets([
        { id: 'a', order: 'A-男子-2-1', sourcePlayerId: 'b' },
        { id: 'b', order: 'A-男子-1-1' }
      ]).length, 0);
    assert('techCopyTargets: 一巡目の行は対象にしない',
      Courts.techCopyTargets([
        { id: 'a', order: 'A-男子-1-1', sourcePlayerId: 'b' },
        { id: 'b', order: 'A-男子-1-2', tech1: '真', tech2: '連', tech3: '左' }
      ]).length, 0);
    assert('techCopyTargets: 並びは No. 順（10 が 2 より後）',
      Courts.techCopyTargets([
        { id: 'y', order: 'A-男子-2-10', sourcePlayerId: 's' },
        { id: 'x', order: 'A-男子-2-2', sourcePlayerId: 's' },
        { id: 's', order: 'A-男子-1-1', tech1: '真', tech2: '連', tech3: '左' }
      ]).map(function(t) { return t.player.id; }), ['x', 'y']);
    assert('techCopyTargets: players が無ければ空', Courts.techCopyTargets(null), []);
```

- [ ] **Step 2: テストが落ちるのを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result:` の行が出ない。コンソールに `TypeError: Courts.progressRound is not a function`（この節は `await runApiTests();` より前にあるので、例外でページの実行が止まる）

- [ ] **Step 3: `courts.js` に実装する**

`courts.js` の `sortBy` の閉じ括弧

```js
    return (players || []).slice().sort(function(a, b) {
      var c = primary(a, b) * sign;
      return c !== 0 ? c : compareOrder(a, b);
    });
  }
```

の**直後**（`// 二巡目生成 API の 409 応答（reason: 'unscored' | 'exists'）を確認文言にする。` の前）に足す。

```js
  // ---- 試合の区画（PC 運営 #match）の集計 ----
  // 画面を持たない判定はここに置き、test.html で固定する
  // （test.html は desk-match.js を読み込まないため）。
  // EventStatus（status.js）は呼び出し時に参照する。この節を使うページは
  // courts.js と status.js の両方を読むこと。

  // コート別のカードで数える巡目。
  //   一巡目 / 二巡目 進行中 → その巡目（EventStatus.scoringRound）
  //   準備中                 → これから採点する一巡目
  //   一巡目終了             → これから採点する二巡目
  //   二巡目終了以降         → 二巡目の行があれば二巡目、無ければ一巡目
  //                            （二巡目なしで終わった大会は一巡目の結果を見せる）
  function progressRound(status, players) {
    var r = EventStatus.scoringRound(status);
    if (r) return r;
    if (status === 'draft') return 1;
    if (status === 'round1_done') return 2;
    var hasRound2 = (players || []).some(function(p) { return roundOf(p) === 2; });
    return hasRound2 ? 2 : 1;
  }

  // コートごとの「採点済み n / N」。round の行だけを数える。
  // 並びは listFrom と同じ（昇順、未分類は末尾）。
  // その巡目の行が 1 つも無いコートも { total: 0, scored: 0 } で残す
  // （二巡目を生成する前にコートのカードが消えてしまわないように）。
  // 戻り値: [{ court, total, scored }]
  function courtProgress(players, round) {
    var list = players || [];
    return listFrom(list).map(function(c) {
      var rows = list.filter(function(p) {
        return courtOf(p) === c && roundOf(p) === round;
      });
      return { court: c, total: rows.length, scored: rows.filter(isScored).length };
    });
  }

  // そのコートでいま採点している選手の名前。live は大会 JSON の event.live
  // （コート名をそのままキーに持つ）。サーバーが defineProperty で書き
  // hasOwnProperty で読んでいるのと同じ理由で、ここでも hasOwnProperty で読む
  // （'__proto__' や 'toString' というコート名でプロトタイプを拾わない）。
  // ライブ状態が無い・選手が外れている・その選手がもう居ないときは空文字。
  function livePlayerName(live, court, players) {
    if (!live || typeof live !== 'object' || !court) return '';
    if (!Object.prototype.hasOwnProperty.call(live, court)) return '';
    var entry = live[court];
    if (!entry || typeof entry !== 'object' || !entry.playerId) return '';
    var found = (players || []).filter(function(p) { return p && p.id === entry.playerId; })[0];
    if (!found) return '';
    return found.name || '(名称未設定)';
  }

  // 「全員に一巡目と同じ技をコピー」の対象。次の4つを満たす二巡目の行だけ。
  //   ・技が3枠とも空（hasNoTech）… 途中まで入れた行を一括で上書きしない
  //   ・未採点              … 得点が変わる警告は行ごとのボタンで出す
  //   ・sourcePlayerId が指す一巡目の行がまだある（CSV 由来の行は対象外）
  //   ・その一巡目の行に技が入っている（空をコピーしても意味が無い）
  // 並びは compareOrder（表と同じ）。戻り値: [{ player, source }]
  function techCopyTargets(players) {
    var list = players || [];
    function sourceOf(p) {
      if (!p || !p.sourcePlayerId) return null;
      return list.filter(function(q) { return q && q.id === p.sourcePlayerId; })[0] || null;
    }
    return list
      .filter(function(p) { return roundOf(p) === 2 && hasNoTech(p) && !isScored(p); })
      .map(function(p) { return { player: p, source: sourceOf(p) }; })
      .filter(function(x) { return x.source && !hasNoTech(x.source); })
      .sort(function(a, b) { return compareOrder(a.player, b.player); });
  }

```

- [ ] **Step 4: 公開の一覧に足す**

`courts.js` 末尾の `return {` の中、`sortBy: sortBy,` の**直後**に 4 行足す。

```js
    sortBy: sortBy,
    progressRound: progressRound,
    courtProgress: courtProgress,
    livePlayerName: livePlayerName,
    techCopyTargets: techCopyTargets,
```

- [ ] **Step 5: テストが通るのを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`（N は Step 1 の前より 29 増える）

- [ ] **Step 6: commit**

```bash
git add courts.js test.html
git commit -m "$(cat <<'EOF'
feat: 試合の区画のコート別集計を courts.js に足す

PC 運営の「試合」で使う判定のうち、画面を持たないものを純粋関数にして
test.html で固定する。数える巡目（progressRound）、コートごとの採点済み
（courtProgress）、live から採点中の選手を引く（livePlayerName）、
「全員に一巡目と同じ技をコピー」の対象行（techCopyTargets）の4つ。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `desk.css` に試合と結果のスタイルを足す

計画2 では「`desk.css` は Task 4 で書き切り、以降は触らない」としたが、区画が増えるのでこの計画でも追記する。**クラス名は `.desk-match-` と `.desk-results-` の接頭辞に限り**、追記は**ファイル末尾**（`@media (max-width: 1023px) { … }` のブロックの後）にまとめる。計画4 も `desk.css` を触るが、あちらは選手表（`.desk-players-*` など）で、追記位置が末尾どうしでぶつかるだけなので、**編集の前にファイル末尾を読み直してから**足す。

**Files:**
- Modify: `desk.css`（ファイル末尾に追記）

- [ ] **Step 1: `desk.css` の末尾に足す**

ファイルのいちばん最後（`@media (max-width: 1023px) { … }` の閉じ括弧の後）に足す。

```css

/* ===== 試合の区画（desk-match.js。計画5） ===== */
.desk-match-courts {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px; margin-bottom: 28px;
}
.desk-match-card {
  display: flex; flex-direction: column; gap: 6px; padding: 12px 14px;
  background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px;
}
.desk-match-court { font-size: 16px; font-weight: bold; }
.desk-match-progress { font-size: 13px; color: var(--text-muted); }
.desk-match-progress.done { color: var(--cell-success-text); font-weight: bold; }
/* いま採点中の選手。待機中は帯を消して控えめにする（配信ボードと同じ言い回し） */
.desk-match-live { font-size: 13px; padding: 4px 8px; border-radius: 4px; background: var(--row-selected); }
.desk-match-live.idle { background: transparent; color: var(--text-muted); padding-left: 0; }
.desk-match-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.desk-match-actions .desk-btn { min-height: 32px; padding: 0 10px; font-size: 13px; }

/* 二巡目の帯（生成・全員にコピー・件数） */
.desk-match-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.desk-match-count { font-size: 13px; color: var(--cell-fail-text); }
.desk-match-count.done { color: var(--cell-success-text); font-weight: bold; }

/* 二巡目の表。技のセレクトは空のとき赤枠にして未入力を目立たせる */
.desk-match-table select { min-width: 130px; min-height: 30px; }
.desk-match-table select.empty { border-color: var(--btn-fail); }
.desk-match-table td.copy { text-align: center; }
.desk-match-table td.copy .desk-btn { min-height: 30px; padding: 0 10px; font-size: 12px; }

/* ===== 結果の区画（desk-results.js。計画5） ===== */
.desk-results-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.desk-results-cols {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; align-items: start;
}
/* 1024〜1199px では3列だと氏名が折り返すので2列に落とす（1280px では3列） */
@media (max-width: 1199px) {
  .desk-results-cols { grid-template-columns: repeat(2, 1fr); }
}
.desk-results-col {
  padding: 12px 14px; background: var(--card-bg);
  border: 1px solid var(--border); border-radius: 6px;
}
.desk-results-col h3 {
  font-size: 15px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border);
}
.desk-results-list { list-style: none; }
.desk-results-list li {
  display: flex; align-items: baseline; gap: 8px; padding: 4px 0;
  border-bottom: 1px solid var(--border);
}
.desk-results-list li:last-child { border-bottom: none; }
.desk-results-rank { width: 2.4em; text-align: right; color: var(--text-muted); }
.desk-results-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.desk-results-score { font-weight: bold; color: var(--score-color); }
.desk-results-board { margin-top: 28px; }
.desk-results-boardlist { display: flex; gap: 8px; flex-wrap: wrap; }
```

- [ ] **Step 2: ブラウザで確かめる**

`http://localhost:3461/desk.html` を新しいタブで開く（幅 1280px）。
Expected: 既存の画面（大会一覧・基本情報・技と配点・選手）の見た目が変わっていない。横スクロールが出ない。新しいクラスはまだ誰も使っていないので画面には出ない。

- [ ] **Step 3: commit**

```bash
git add desk.css
git commit -m "$(cat <<'EOF'
feat: PC 運営の試合と結果のスタイルを足す

コート別のカード（.desk-match-*）と、3列の順位・配信ボードの一覧
（.desk-results-*）。色は theme.css の変数だけを使い、1280px で3列、
1199px 以下では2列に落とす。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 試合の区画にコート別のカードを出す（`desk-match.js`）

いまの `desk-match.js` は「計画5で実装します」のプレースホルダー。まずコートごとのカード（コート名・採点済み n / N・いま採点中の選手・採点画面を開く・URL をコピー）と、見出しの「↻ 最新に更新」「⋯（CSVエクスポート）」を作る。二巡目の表は Task 5。

**前提:** Task 1（`Desk.copyText`）、Task 2（`Courts.progressRound` / `courtProgress` / `livePlayerName`）、Task 3（`desk.css`）が済んでいること。

**Files:**
- Modify: `desk-match.js`（ファイル全体を差し替える）

- [ ] **Step 1: `desk-match.js` を書き直す**

ファイルの中身を丸ごと次に差し替える。

```js
// 試合の区画（#match/<id>）。コート別の状況・採点画面を開く・二巡目の生成と技入力。
// スマホ運営の「進行」タブ（admin-round.js）と同じことを PC 幅でやる。
//
// ポーリングはしない。「採点済み n / N」といま採点中の選手は、大会を読んだ時点の値で、
// 「↻ 最新に更新」（Desk.reloadEvent）を押したときだけ変わる。自動で更新するのは
// 配信ボード（board.html）だけ、という既存の方針を変えないため。
(function() {
  var outsideClickBound = false;   // 「⋯」の外側クリック検知は document に1回だけ付ける

  // --- 描画 ---

  function render(container, ctx) {
    container.innerHTML = '';
    var st = EventStatus.of(ctx.event);

    container.appendChild(buildHead(ctx));
    container.appendChild(buildCourts(st, ctx));
  }

  function buildHead(ctx) {
    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '試合';
    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.appendChild(h2);
    head.appendChild(spacer);

    var btnReload = document.createElement('button');
    btnReload.type = 'button';
    btnReload.className = 'desk-btn';
    btnReload.id = 'btnMatchReload';
    btnReload.textContent = '↻ 最新に更新';
    btnReload.addEventListener('click', function() { Desk.reloadEvent(); });
    head.appendChild(btnReload);

    head.appendChild(buildMenu(ctx));
    return head;
  }

  // details/summary の外側をクリックしたら閉じる。document への登録は1回だけ
  // （描画のたびにリスナーが積み重ならないように）。desk-events.js と同じ作法。
  function bindOutsideClickOnce() {
    if (outsideClickBound) return;
    outsideClickBound = true;
    document.addEventListener('click', function(e) {
      var menus = document.querySelectorAll('.desk-menu[open]');
      for (var i = 0; i < menus.length; i++) {
        if (!menus[i].contains(e.target)) menus[i].open = false;
      }
    });
  }

  function menuItem(menu, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', function() {
      menu.open = false;
      onClick();
    });
    return b;
  }

  function buildMenu(ctx) {
    bindOutsideClickOnce();
    var menu = document.createElement('details');
    menu.className = 'desk-menu';
    var sum = document.createElement('summary');
    sum.textContent = '⋯';
    sum.setAttribute('aria-label', '試合の操作');
    menu.appendChild(sum);
    var body = document.createElement('div');
    body.className = 'desk-menu-body';
    menu.appendChild(body);
    body.appendChild(menuItem(menu, '📄 CSVエクスポート', function() { onExportCsv(ctx); }));
    return menu;
  }

  async function onExportCsv(ctx) {
    var csv = await Api.exportCsv(ctx.eventId);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    if (!csv) {
      alert('エクスポートに失敗しました。通信を確認してください。');
      return;
    }
    Storage.downloadCsv('players.csv', csv);
    Desk.toast('CSV を保存しました');
  }

  // --- コート別のカード ---

  function buildCourts(st, ctx) {
    var wrap = document.createElement('div');
    var round = Courts.progressRound(st, ctx.players);

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.id = 'matchCourtsNote';
    note.textContent = (round === 1 ? '一巡目' : '二巡目') + 'の進み具合です。' +
      '「採点済み」と「いま採点中」は自動では変わりません。' +
      '「↻ 最新に更新」を押すと読み直します。';
    wrap.appendChild(note);

    var rows = Courts.courtProgress(ctx.players, round);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'まだ選手がいません。「選手」の区画で登録してください。';
      wrap.appendChild(none);
      return wrap;
    }

    var grid = document.createElement('div');
    grid.className = 'desk-match-courts';
    rows.forEach(function(r) { grid.appendChild(buildCourtCard(r, ctx)); });
    wrap.appendChild(grid);
    return wrap;
  }

  function buildCourtCard(row, ctx) {
    var card = document.createElement('section');
    card.className = 'desk-match-card';

    var name = document.createElement('div');
    name.className = 'desk-match-court';
    name.textContent = (row.court === Courts.UNASSIGNED) ? Courts.UNASSIGNED : row.court + ' コート';
    card.appendChild(name);

    var prog = document.createElement('div');
    prog.className = 'desk-match-progress' +
      ((row.total > 0 && row.scored === row.total) ? ' done' : '');
    prog.textContent = '採点済み ' + row.scored + ' / ' + row.total;
    card.appendChild(prog);

    // コートの決まっていない選手は採点画面のコート絞り込みに載せられない
    // （サーバーの isValidCourt が「未分類」を弾く）。カードは出すが操作は置かない。
    if (row.court === Courts.UNASSIGNED) {
      var hint = document.createElement('p');
      hint.className = 'desk-note';
      hint.textContent = 'コートが決まっていない選手です。「選手」の区画でコートを設定してください。';
      card.appendChild(hint);
      return card;
    }

    var live = document.createElement('div');
    var who = Courts.livePlayerName(ctx.event && ctx.event.live, row.court, ctx.players);
    if (who) {
      live.className = 'desk-match-live';
      live.textContent = 'いま採点中: ' + who;
    } else {
      live.className = 'desk-match-live idle';
      live.textContent = '待機中';
    }
    card.appendChild(live);

    var actions = document.createElement('div');
    actions.className = 'desk-match-actions';

    var btnOpen = document.createElement('button');
    btnOpen.type = 'button';
    btnOpen.className = 'desk-btn primary';
    btnOpen.textContent = '採点画面を開く';
    btnOpen.addEventListener('click', function() {
      Desk.openScoring(ctx.eventId, row.court);
    });
    actions.appendChild(btnOpen);

    var btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'desk-btn';
    btnCopy.textContent = 'URL をコピー';
    btnCopy.addEventListener('click', function() {
      // コートの端末にメッセージで送れるよう、相対ではなく絶対 URL にする
      var url = new URL(Desk.scoringHref(ctx.eventId, row.court), location.href).href;
      Desk.copyText(url, row.court + ' コートの採点画面の URL をコピーしました');
    });
    actions.appendChild(btnCopy);

    card.appendChild(actions);
    return card;
  }

  Desk.registerTab('match', { render: render });
})();
```

- [ ] **Step 2: ブラウザで確かめる**

準備（この作業用の大会を作る）:

1. `http://localhost:3461/desk.html#events` を開き、「＋ 新規作成」で大会名「試験 計画5」を作る
2. 「選手」の区画で（スマホ運営に切り替えてもよい）A コートに 2 名、B コートに 1 名を登録し、技を 3 つずつ入れる
3. 上部の「試合開始 ▶」で `一巡目 進行中` にする

確認項目（`#match/<id>` を開く）:

- [ ] 見出しが「試合」で、右に「↻ 最新に更新」と「⋯」がある
- [ ] 注記が「一巡目の進み具合です。…」になっている
- [ ] A コート・B コートのカードが横に並ぶ。それぞれ「採点済み 0 / 2」「採点済み 0 / 1」と「待機中」
- [ ] 「採点画面を開く」で別ウィンドウに `scoring.html#event/<id>/A` が開く。A コートの一巡目の選手だけが並ぶ
- [ ] その採点画面で 1 人選んで得点を入れ、運営の「↻ 最新に更新」を押すと「採点済み 1 / 2」に変わり、「いま採点中: （選手名）」が出る
- [ ] 「URL をコピー」でトーストが出て、貼り付けると `http://localhost:3461/scoring.html#event/<id>/A` が入っている
- [ ] 「⋯」→「📄 CSVエクスポート」で `players.csv` が保存される
- [ ] 1280px で横スクロールが出ない。🌙 でダークにしても文字が読める
- [ ] コートを持たない選手を 1 人足す（スマホ運営の選手タブで新しいコートを付けずに登録する方法が無ければこの確認は飛ばしてよい）と「未分類」のカードが出て、ボタンの代わりに案内が出る

- [ ] **Step 3: 既存のテストが通ることを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`

- [ ] **Step 4: commit**

```bash
git add desk-match.js
git commit -m "$(cat <<'EOF'
feat: PC 運営の試合にコート別のカードを出す

コート名・その巡目の採点済み n / N・いま採点中の選手・採点画面を開く・
URL をコピー。件数と採点中の選手はポーリングせず「↻ 最新に更新」で読み直す。
コートの決まっていない選手のカードは操作を置かず、選手の区画への案内を出す。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 試合の区画に二巡目の生成と技入力の表を足す（`desk-match.js`）

`round1_done`（一巡目終了）のときに「二巡目を生成」と、生成後の二巡目の表（巡・No.・名前・一巡目の得点・技1〜3 のセレクト・行ごとの「一巡目と同じ技をコピー」）を出す。表の上に「全員に一巡目と同じ技をコピー」と「二巡目 N名　技 未入力 n」。`round2` 以降は同じ表を読み取り専用で出し、`draft` / `round1` では二巡目の節ごと出さない。

**前提:** Task 4。

**Files:**
- Modify: `desk-match.js`（`render` に 1 行足し、末尾の `Desk.registerTab` の直前に二巡目の節を足す）

- [ ] **Step 1: `render` に二巡目の節を足す**

`desk-match.js` の

```js
  function render(container, ctx) {
    container.innerHTML = '';
    var st = EventStatus.of(ctx.event);

    container.appendChild(buildHead(ctx));
    container.appendChild(buildCourts(st, ctx));
  }
```

を次に差し替える。

```js
  function render(container, ctx) {
    container.innerHTML = '';
    var st = EventStatus.of(ctx.event);

    container.appendChild(buildHead(ctx));
    container.appendChild(buildCourts(st, ctx));
    // 準備中・一巡目 進行中は二巡目の話をまだしない（生成もできない）。
    if (st !== 'draft' && st !== 'round1') {
      container.appendChild(buildRound2(st, ctx));
    }
  }
```

- [ ] **Step 2: 二巡目の節を足す**

`desk-match.js` の末尾、

```js
  Desk.registerTab('match', { render: render });
})();
```

の**直前**に足す。

```js
  // --- 二巡目（生成と技の入力） ---
  // 技を入れられるのは「一巡目終了」のときだけ。それ以外の状態では読み取り専用にする
  // （二巡目の採点が始まってから技を差し替えると、採点画面が古い ○× を新しい配点で
  //  読み直してしまう。直したいときは上部の「戻す」で一巡目終了に戻す）。

  function roundTwo(players) {
    return (players || []).filter(function(p) { return Courts.roundOf(p) === 2; });
  }

  // sourcePlayerId が指す一巡目の行。削除済み・CSV 由来の行では null
  function sourceOf(p, players) {
    if (!p || !p.sourcePlayerId) return null;
    return (players || []).filter(function(q) { return q && q.id === p.sourcePlayerId; })[0] || null;
  }

  function buildRound2(st, ctx) {
    var wrap = document.createElement('div');
    var editable = (st === 'round1_done');
    var rows = roundTwo(ctx.players).slice().sort(Courts.compareOrder);

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '二巡目';
    head.appendChild(h2);
    wrap.appendChild(head);

    if (!editable) {
      var note = document.createElement('p');
      note.className = 'desk-note';
      note.textContent = '技を入れられるのは「一巡目終了」のときだけです（いまは「' +
        EventStatus.LABELS[st] + '」）。直すときは上部の「戻す」で一巡目終了まで戻してください。';
      wrap.appendChild(note);
    }

    var bar = document.createElement('div');
    bar.className = 'desk-match-bar';

    if (editable) {
      var btnGen = document.createElement('button');
      btnGen.type = 'button';
      btnGen.className = 'desk-btn primary';
      btnGen.id = 'btnMatchGenRound2';
      btnGen.textContent = '二巡目を生成';
      btnGen.addEventListener('click', function() { onGenerate(ctx); });
      bar.appendChild(btnGen);

      var targets = Courts.techCopyTargets(ctx.players);
      var btnAll = document.createElement('button');
      btnAll.type = 'button';
      btnAll.className = 'desk-btn';
      btnAll.id = 'btnMatchCopyAll';
      btnAll.textContent = '全員に一巡目と同じ技をコピー（' + targets.length + ' 名）';
      if (targets.length === 0) {
        btnAll.disabled = true;
        btnAll.title = '技が空で未採点の二巡目の行がありません';
      } else {
        btnAll.addEventListener('click', function() { onCopyAll(ctx, targets); });
      }
      bar.appendChild(btnAll);
    }

    var incomplete = rows.filter(Courts.isTechIncomplete).length;
    var count = document.createElement('span');
    count.className = 'desk-match-count' + (incomplete === 0 ? ' done' : '');
    count.id = 'matchRound2Count';
    count.textContent = '二巡目 ' + rows.length + '名　技 未入力 ' + incomplete;
    bar.appendChild(count);
    wrap.appendChild(bar);

    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = editable
        ? '二巡目の選手はまだいません。「二巡目を生成」を押してください。'
        : '二巡目の選手はいません。';
      wrap.appendChild(none);
      return wrap;
    }

    // 技リストはサーバーが GET の応答に必ず入れる（effectiveTechniques）。
    // 取れていないときはセレクトを作れないので、読み取り専用の表にする。
    var techniques = (Array.isArray(ctx.techniques) && ctx.techniques.length > 0) ? ctx.techniques : null;
    if (editable && !techniques) {
      var warn = document.createElement('p');
      warn.className = 'desk-warn';
      warn.textContent = '技術リストを取得できませんでした。大会を開き直してください。';
      wrap.appendChild(warn);
      editable = false;
    }

    var table = document.createElement('table');
    table.className = 'desk-table desk-match-table';
    table.innerHTML =
      '<thead><tr><th>巡</th><th>No.</th><th>名前</th><th>一巡目</th>' +
      '<th>技1</th><th>技2</th><th>技3</th>' + (editable ? '<th></th>' : '') + '</tr></thead>';
    var tbody = document.createElement('tbody');
    rows.forEach(function(p) {
      tbody.appendChild(buildRow(p, ctx, editable, techniques));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function buildRow(p, ctx, editable, techniques) {
    var src = sourceOf(p, ctx.players);
    var tr = document.createElement('tr');
    tr.setAttribute('data-player-id', p.id);
    tr.appendChild(cell('2', 'num'));
    tr.appendChild(cell(String(Courts.orderKey(p).no || ''), 'num'));
    tr.appendChild(cell(p.name || '', 'desk-cell-main'));
    tr.appendChild(cell(src ? String(src.score || 0) : '—', 'num'));

    if (!editable) {
      tr.appendChild(cell(p.tech1 || ''));
      tr.appendChild(cell(p.tech2 || ''));
      tr.appendChild(cell(p.tech3 || ''));
      return tr;
    }

    var selects = [];
    [1, 2, 3].forEach(function(slot) {
      var td = document.createElement('td');
      var sel = buildTechSelect(p['tech' + slot] || '', techniques);
      sel.addEventListener('change', function() { onTechChange(p, selects, ctx, tr); });
      td.appendChild(sel);
      tr.appendChild(td);
      selects.push(sel);
    });

    var tdCopy = document.createElement('td');
    tdCopy.className = 'copy';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'desk-btn';
    if (!src) {
      btn.disabled = true;
      // コピー元が無い行のボタンは通信の前後で有効に戻さない（setRowDisabled が見る印）
      btn.setAttribute('data-nosource', '1');
      btn.textContent = '一巡目の行がありません';
      btn.title = 'コピー元の一巡目の行が削除されています';
    } else {
      btn.textContent = '一巡目と同じ技をコピー';
      btn.addEventListener('click', function() { onCopyRow(p, src, selects, ctx, tr); });
    }
    tdCopy.appendChild(btn);
    tr.appendChild(tdCopy);
    return tr;
  }

  // 技のセレクト。先頭は「（空）」。空のときは赤枠にして未入力を目立たせる。
  function buildTechSelect(value, techniques) {
    var sel = document.createElement('select');
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '（空）';
    sel.appendChild(blank);
    (techniques || []).forEach(function(t) {
      var o = document.createElement('option');
      o.value = t.name;
      o.textContent = t.name;
      sel.appendChild(o);
    });
    // その大会の技リストから消えた技名が入っている行でも、値を落とさずに見せる
    if (value && !(techniques || []).some(function(t) { return t.name === value; })) {
      var o2 = document.createElement('option');
      o2.value = value;
      o2.textContent = value + '（リストにありません）';
      sel.appendChild(o2);
    }
    sel.value = value || '';
    markEmpty(sel);
    return sel;
  }

  function markEmpty(sel) {
    sel.className = sel.value ? '' : 'empty';
  }

  function valuesOf(selects) {
    return [selects[0].value, selects[1].value, selects[2].value];
  }

  function setValues(selects, arr) {
    selects.forEach(function(s, i) {
      s.value = arr[i] || '';
      markEmpty(s);
    });
  }

  function setRowDisabled(selects, tr, flag) {
    selects.forEach(function(s) { s.disabled = flag; });
    var btn = tr.querySelector('td.copy .desk-btn');
    if (btn && !btn.hasAttribute('data-nosource')) btn.disabled = flag;
  }

  // 採点済みの選手の技を差し替えると、result 文字列の長さは変わらないため
  // 採点画面（Scoring.canDecode）はこれを検知できず、黙って新しい技の配点で
  // 再解釈してしまう。だから必ず断る（admin-round.js の saveTech と同じ判定・同じ文言）。
  // ※ 計画4 が Courts.scoreMayChange / scoreChangeConfirmMessage を courts.js に足す。
  //    それが入ったら、この2つの関数はそちらに置き換えてよい。
  function techWillChange(p, arr) {
    return Courts.isScored(p) &&
      (arr[0] !== (p.tech1 || '') || arr[1] !== (p.tech2 || '') || arr[2] !== (p.tech3 || ''));
  }

  function confirmTechChange(p) {
    return confirm(
      'この選手は採点済みです（' + (p.score || 0) + '点）。\n' +
      '得点が変わる可能性があります。採点画面でこの選手を開き直してください。\n\n' +
      'このまま保存しますか？'
    );
  }

  // 技の保存。保存できたら true。失敗したら画面をサーバーに合わせて元に戻す。
  async function saveTech(p, arr, selects, ctx, tr) {
    if (techWillChange(p, arr) && !confirmTechChange(p)) {
      setValues(selects, [p.tech1 || '', p.tech2 || '', p.tech3 || '']);
      return false;
    }
    setRowDisabled(selects, tr, true);
    var res = await Api.updatePlayerInfo(ctx.eventId, p.id,
      { tech1: arr[0], tech2: arr[1], tech3: arr[2] });
    if (ctx.isStale()) return !!(res && res.ok);   // 画面を離れていたら DOM に触れない（alert もしない）
    setRowDisabled(selects, tr, false);
    if (!res || !res.ok) {
      if (res && res.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
      } else {
        alert('技を保存できませんでした。通信を確認してもう一度お試しください。');
      }
      setValues(selects, [p.tech1 || '', p.tech2 || '', p.tech3 || '']);
      return false;
    }
    p.tech1 = arr[0];
    p.tech2 = arr[1];
    p.tech3 = arr[2];
    setValues(selects, arr);
    updateCount(ctx);
    return true;
  }

  // 帯の「二巡目 N名　技 未入力 n」を数え直す（表全体を描き直さずに済ませる）。
  // 「全員にコピー」のボタンの件数は reloadEvent で作り直すので、ここでは触らない。
  function updateCount(ctx) {
    var el = document.getElementById('matchRound2Count');
    if (!el) return;
    var rows = roundTwo(ctx.players);
    var n = rows.filter(Courts.isTechIncomplete).length;
    el.textContent = '二巡目 ' + rows.length + '名　技 未入力 ' + n;
    el.className = 'desk-match-count' + (n === 0 ? ' done' : '');
  }

  function onTechChange(p, selects, ctx, tr) {
    saveTech(p, valuesOf(selects), selects, ctx, tr);
  }

  async function onCopyRow(p, src, selects, ctx, tr) {
    var arr = [src.tech1 || '', src.tech2 || '', src.tech3 || ''];
    var ok = await saveTech(p, arr, selects, ctx, tr);
    if (ctx.isStale()) return;
    if (ok) Desk.toast('一巡目の技をコピーしました');
  }

  // 「全員に一巡目と同じ技をコピー」。対象は Courts.techCopyTargets（技が3枠とも空で
  // 未採点、かつコピー元の一巡目の行に技がある二巡目の行）。1件ずつ PATCH を送り、
  // 失敗したらそこで止める（locked や通信断は次の行でも同じように失敗するため、
  // 同じ alert を人数分出さない）。最後に大会を読み直して表と件数を作り直す。
  async function onCopyAll(ctx, targets) {
    if (targets.length === 0) return;
    if (!confirm('技が空の ' + targets.length + ' 名に、一巡目と同じ技をコピーします。\n' +
        'よろしいですか？')) return;
    var btn = document.getElementById('btnMatchCopyAll');
    if (btn) btn.disabled = true;
    var done = 0;
    var failed = null;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var res = await Api.updatePlayerInfo(ctx.eventId, t.player.id, {
        tech1: t.source.tech1 || '', tech2: t.source.tech2 || '', tech3: t.source.tech3 || ''
      });
      if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
      if (!res || !res.ok) {
        failed = { player: t.player, res: res };
        break;
      }
      done++;
    }
    if (failed) {
      var why = (failed.res && failed.res.reason === 'locked')
        ? 'この大会は最終結果を確定済みです。編集するには「戻す」を押してください。'
        : '通信を確認してもう一度お試しください。';
      alert(done + ' 名にコピーしました。\n' +
        '「' + (failed.player.name || '(名称未設定)') + '」で失敗したので中断しました。\n' + why);
    } else {
      Desk.toast(done + ' 名に一巡目の技をコピーしました');
    }
    await Desk.reloadEvent();
  }

  // --- 二巡目の生成 ---
  // 番号規則はサーバーの生成 API が唯一の実装。クライアントは確認と再送だけを持つ。
  // 確認文言・結果文言は courts.js（スマホ運営の進行タブと共通）。
  async function onGenerate(ctx) {
    var src = (ctx.players || []).filter(function(p) { return Courts.roundOf(p) === 1; });
    var scored = src.filter(Courts.isScored).length;
    if (!confirm('一巡目 採点済み ' + scored + ' / ' + src.length + '。\n' +
        '全コート分の二巡目を作ります（採点画面にも反映されます）。\nよろしいですか？')) return;
    var btn = document.getElementById('btnMatchGenRound2');
    if (btn) btn.disabled = true;
    var result = await Api.generateNextRound(ctx.eventId, false);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    if (btn) btn.disabled = false;
    if (!result) {
      alert('二巡目を生成できませんでした。一巡目の選手が登録されているか、通信を確認してください。');
      return;
    }
    if (result.blocked) {
      if (result.reason === 'locked') {
        alert('この大会は最終結果を確定済みです。編集するには「戻す」を押してください');
        return;
      }
      if (result.reason === 'status') {
        // 他の端末が先に状態を戻していた。サーバーの文言をそのまま出して読み直す。
        alert(result.error);
        await Desk.reloadEvent();
        return;
      }
      // nextRoundConflictMessage は unscored / exists の文言しか持たない
      if (!confirm(Courts.nextRoundConflictMessage(result, '「選手」の区画でコートを設定してください'))) return;
      if (btn) btn.disabled = true;
      result = await Api.generateNextRound(ctx.eventId, true);
      if (ctx.isStale()) return;
      if (btn) btn.disabled = false;
      if (!result || result.blocked) {
        alert('二巡目を生成できませんでした。一巡目の選手が登録されているか、通信を確認してください。');
        return;
      }
    }
    Desk.toast(Courts.nextRoundResultMessage(result));
    await Desk.reloadEvent();
  }
```

- [ ] **Step 3: ブラウザで確かめる**

Task 4 で作った大会「試験 計画5」を使う。採点画面で一巡目を全員採点してから、運営で「一巡目を終了 ▶」を押して `一巡目終了` にする。

- [ ] `#match/<id>` に「二巡目」の節が出て、「二巡目を生成」「全員に一巡目と同じ技をコピー（0 名）」（無効）「二巡目 0名　技 未入力 0」が並ぶ
- [ ] 「二巡目を生成」→ 確認「一巡目 採点済み 3 / 3。…」→ OK でトースト「二巡目を生成しました（3名）」が出て、表に 3 行並ぶ
- [ ] 表の列が 巡 / No. / 名前 / 一巡目 / 技1 / 技2 / 技3 / （コピー）で、「一巡目」の欄にその選手の一巡目の得点が出ている
- [ ] 技のセレクトが 3 つとも赤枠（空）。1 つ選ぶと赤枠が消え、「技 未入力」の件数は 3 のまま（3枠そろって初めて減る）
- [ ] 行の「一巡目と同じ技をコピー」を押すと 3 枠が埋まり、トースト「一巡目の技をコピーしました」、件数が 1 減る
- [ ] 「全員に一巡目と同じ技をコピー（2 名）」を押すと確認が出て、OK で残りが埋まり「技 未入力 0」が緑になる
- [ ] 上部の「二巡目を開始 ▶」で `二巡目 進行中` にすると、表が読み取り専用（セレクトもコピーのボタンも無い）になり、注記「技を入れられるのは「一巡目終了」のときだけです（いまは「二巡目 進行中」）。…」が出る
- [ ] コート別のカードの注記が「二巡目の進み具合です。…」に変わり、件数が二巡目のものになる
- [ ] 上部の「◀ 一巡目終了 に戻す」で戻すと、また技を直せる
- [ ] 採点済みの二巡目の選手の技をセレクトで変えると「この選手は採点済みです（n点）。…」の確認が出る。キャンセルするとセレクトが元の値に戻る
- [ ] 上部の「最終結果を確定 ▶」まで進めると、表は読み取り専用のまま。「戻す」で戻ると直せる
- [ ] `準備中` と `一巡目 進行中` では「二巡目」の節が出ない
- [ ] 1280px で横スクロールが出ない。ライト／ダークどちらでも読める

- [ ] **Step 4: 既存のテストが通ることを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`

- [ ] **Step 5: commit**

```bash
git add desk-match.js
git commit -m "$(cat <<'EOF'
feat: PC 運営の試合に二巡目の生成と技入力の表を足す

一巡目終了のときだけ「二巡目を生成」と技のセレクトを出し、それ以外の状態では
読み取り専用にする。行ごとの「一巡目と同じ技をコピー」と、技が空で未採点の行
だけをまとめて埋める「全員に一巡目と同じ技をコピー」。採点済みの選手の技を
変えるときはスマホ運営と同じ確認を出す。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 結果の区画を作る（`desk-results.js`）

スマホ運営の結果タブ（`admin-results.js`）と同じ内容（3 部門の順位・最新に更新・発表モードで開く・共有リンクをコピー）を PC 幅で 3 列に並べ、配信ボードの URL コピーをコートごとに足す。

**前提:** Task 1（`Desk.copyText`）、Task 3（`desk.css`）。Task 4・5 と並行できる。

**Files:**
- Modify: `desk-results.js`（ファイル全体を差し替える）

- [ ] **Step 1: `desk-results.js` を書き直す**

ファイルの中身を丸ごと次に差し替える。

```js
// 結果の区画（#results/<id>）。順位・発表モード・共有リンク・配信ボード。
// スマホ運営の結果タブ（admin-results.js）と同じ内容を PC 幅で3列に並べる。
// 順位はサーバーが計算したもの（GET /api/events/:id/ranking）をそのまま描く。
// 共有トークンは Api.createShareLink（冪等。既にあれば同じものが返る）。
(function() {
  var CATEGORIES = [
    { key: 'male',    title: '一般男子' },
    { key: 'newFace', title: '新人' },
    { key: 'female',  title: '一般女子' }
  ];

  async function render(container, ctx) {
    container.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '結果';
    head.appendChild(h2);
    container.appendChild(head);

    var bar = document.createElement('div');
    bar.className = 'desk-results-bar';
    bar.appendChild(makeBtn('btnDeskResultsReload', '↻ 最新に更新', 'desk-btn', function() {
      Desk.reloadEvent();
    }));
    bar.appendChild(makeBtn('btnDeskResultsPresent', '🖵 発表モードで開く', 'desk-btn primary', function() {
      onPresent(this, ctx);
    }));
    bar.appendChild(makeBtn('btnDeskResultsShare', '🔗 共有リンクをコピー', 'desk-btn', function() {
      onCopyShare(this, ctx);
    }));
    container.appendChild(bar);

    var cols = document.createElement('div');
    cols.className = 'desk-results-cols';
    cols.id = 'deskResultsCols';
    container.appendChild(cols);

    var loading = document.createElement('p');
    loading.className = 'desk-empty';
    loading.textContent = '読み込み中…';
    cols.appendChild(loading);

    container.appendChild(buildBoardSection(ctx));

    var data = await Api.loadRanking(ctx.eventId);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    cols.innerHTML = '';
    if (!data) {
      var err = document.createElement('p');
      err.className = 'desk-empty';
      err.textContent = '順位を取得できませんでした。「↻ 最新に更新」でやり直してください。';
      cols.appendChild(err);
      return;
    }
    CATEGORIES.forEach(function(c) {
      cols.appendChild(buildColumn(c.title, (data.rankings && data.rankings[c.key]) || []));
    });
  }

  function makeBtn(id, label, cls, handler) {
    var b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }

  function buildColumn(title, rows) {
    var col = document.createElement('section');
    col.className = 'desk-results-col';
    var h3 = document.createElement('h3');
    h3.textContent = title;
    col.appendChild(h3);
    if (rows.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'データなし';
      col.appendChild(none);
      return col;
    }
    var ul = document.createElement('ul');
    ul.className = 'desk-results-list';
    rows.forEach(function(r) {
      var li = document.createElement('li');
      var rank = document.createElement('span');
      rank.className = 'desk-results-rank';
      rank.textContent = String(r.rank);
      var name = document.createElement('span');
      name.className = 'desk-results-name';
      name.textContent = r.name;
      var score = document.createElement('span');
      score.className = 'desk-results-score';
      score.textContent = String(r.score);
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(score);
      ul.appendChild(li);
    });
    col.appendChild(ul);
    return col;
  }

  // --- 配信ボード ---
  // board.html はハッシュを #<トークン>/<コート> として読み、コートが無いと
  // 「コートが指定されていません」で止まる（board.js の parseHash と start）。
  // だから設計書の「board.html#<token>」ではなく、コートごとの URL を作る。
  function buildBoardSection(ctx) {
    var sec = document.createElement('div');
    sec.className = 'desk-results-board';

    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    h2.textContent = '配信用ボード';
    head.appendChild(h2);
    sec.appendChild(head);

    var note = document.createElement('p');
    note.className = 'desk-note';
    note.textContent = 'コートごとに1つ、OBS の「ブラウザ」ソースに貼る URL です。' +
      '映像に重ねるときは board.html のすぐ後ろに ?bg=transparent を足すと背景が透けます。';
    sec.appendChild(note);

    var courts = Courts.listFrom(ctx.players).filter(function(c) { return c !== Courts.UNASSIGNED; });
    if (courts.length === 0) {
      var none = document.createElement('p');
      none.className = 'desk-empty';
      none.textContent = 'コートがまだありません（選手を登録するとコートが決まります）。';
      sec.appendChild(none);
      return sec;
    }

    var list = document.createElement('div');
    list.className = 'desk-results-boardlist';
    courts.forEach(function(c) {
      list.appendChild(makeBtn('', '📺 ' + c + ' コートの URL をコピー', 'desk-btn', function() {
        onCopyBoard(this, ctx, c);
      }));
    });
    sec.appendChild(list);
    return sec;
  }

  // --- 共有トークン ---
  // 冪等に発行される（大会に shareToken があればそれがそのまま返る）。
  async function shareToken(ctx) {
    var link = await Api.createShareLink(ctx.eventId);
    if (ctx.isStale()) return null;   // 画面を離れていたら alert も出さない
    if (!link || !link.token) {
      alert('共有リンクを作成できませんでした。通信を確認してください。');
      return null;
    }
    return link.token;
  }

  async function onPresent(btn, ctx) {
    btn.disabled = true;
    // ポップアップブロッカーは「クリックイベント処理中の同期的な window.open」しか
    // 許可しないブラウザが多い。await をまたいでから開くとブロックされることがあるので、
    // まず空タブを同期的に開いておき、トークン取得後に location を差し替える
    // （admin-results.js と同じ作法）。
    var w = window.open('', '_blank');
    try {
      var token = await shareToken(ctx);
      if (!token) {
        if (w) w.close();
        return;
      }
      var url = new URL('present.html#' + token, location.href).href;
      if (!w) {
        alert('新しいタブを開けませんでした。次のURLを開いてください。\n' + url);
        return;
      }
      w.location = url;
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }

  async function onCopyShare(btn, ctx) {
    btn.disabled = true;
    try {
      var token = await shareToken(ctx);
      if (!token) return;
      await Desk.copyText(new URL('share.html#' + token, location.href).href,
        '共有リンクをコピーしました');
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }

  async function onCopyBoard(btn, ctx, court) {
    btn.disabled = true;
    try {
      var token = await shareToken(ctx);
      if (!token) return;
      var url = new URL('board.html#' + token + '/' + encodeURIComponent(court), location.href).href;
      await Desk.copyText(url, court + ' コートの配信用ボードの URL をコピーしました');
    } finally {
      if (!ctx.isStale()) btn.disabled = false;
    }
  }

  Desk.registerTab('results', { render: render });
})();
```

- [ ] **Step 2: ブラウザで確かめる**

Task 4・5 で使った大会（無ければ選手と得点のある大会を作る）で `#results/<id>` を開く。

- [ ] 「一般男子」「新人」「一般女子」の 3 列が横に並ぶ（幅 1280px）。順位・氏名・得点が 1 行ずつ
- [ ] データの無い部門は「データなし」
- [ ] 「↻ 最新に更新」で読み直される（採点画面で得点を足してから押すと順位が変わる）
- [ ] 「🖵 発表モードで開く」で新しいタブに `present.html#<token>` が開く
- [ ] 「🔗 共有リンクをコピー」でトーストが出て、貼り付けると `http://localhost:3461/share.html#<token>`
- [ ] 下の「配信用ボード」にコート（A・B）のボタンが並び、押すと `http://localhost:3461/board.html#<token>/A` がコピーされる。その URL を開くと A コートのボードが出る（採点画面で A コートの選手を開いていれば選手が映り、いなければ「待機中」）
- [ ] 選手のいない大会では「コートがまだありません（…）」が出る
- [ ] 幅を 1100px にすると 2 列になる。1280px では 3 列で横スクロールが出ない。ライト／ダークどちらでも読める

- [ ] **Step 3: 既存のテストが通ることを確かめる**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`

- [ ] **Step 4: commit**

```bash
git add desk-results.js
git commit -m "$(cat <<'EOF'
feat: PC 運営の結果に3部門の順位と配信ボードの URL を出す

スマホ運営の結果タブと同じ内容（順位・最新に更新・発表モード・共有リンク）を
PC 幅で3列に並べ、配信用ボードの URL をコートごとにコピーできるようにする。
board.html はコートの無いハッシュを受け付けないので、URL は
board.html#<トークン>/<コート> の形で組む。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `help.html` を 7 段階の流れと PC 運営に合わせる

設計書「画面設計 > ヘルプ」の残りを片付ける。**画像は差し替えない**（既存のスクリーンショットはスマホ運営のもの）。説明が画像と合わなくなるところは、文章で「画像はスマホ運営のものです」と断る。

このタスクは他のどのタスクとも並行できる（`help.html` しか触らない）。

**Files:**
- Modify: `help.html`

- [ ] **Step 1: 「0. 全体の流れ」の図を 7 段階にする**

`help.html` の図（`<div class="diagram">` の中の `<svg viewBox="0 0 360 698" …>`）で、**7 つの箱の中の文言と `aria-label` だけ**を差し替える。座標・線・凡例はそのまま使う（箱の数は今も 7 つある）。

まず `aria-label` を差し替える。

置換前:
```html
      <svg viewBox="0 0 360 698" role="img" aria-label="大会を作る、選手を登録、一巡目の採点、二巡目を生成して技を入力、二巡目の採点、結果の確認、発表・共有、という順に進む流れ図。端末の役割は、運営者の PC とスマホが運営画面、コートのタブレットが採点画面、会場の大画面が発表モード、参加者のスマホが共有リンク、配信PC（OBS）が配信用ボード。">
```
置換後:
```html
      <svg viewBox="0 0 360 698" role="img" aria-label="大会の7段階。準備中、一巡目 進行中、一巡目終了、二巡目 進行中、二巡目終了、最終結果、アーカイブの順に、運営者がボタンで1段ずつ進める流れ図。端末の役割は、運営者の PC とスマホが運営画面、コートのタブレットが採点画面、会場の大画面が発表モード、参加者のスマホが共有リンク、配信PC（OBS）が配信用ボード。">
```

次に 7 つの `<g transform="translate(10,…)">` の中の `<text>` を差し替える（`translate` の値と `rect` はそのまま）。

| 箱（`translate` の y） | `d-title`（置換後） | `d-sub`（置換後） |
|---|---|---|
| 6 | `準備中` | `大会を作る・技と配点・選手（運営画面）` |
| 80 | `一巡目 進行中` | `採点画面（コートの端末）` |
| 154 | `一巡目終了` | `二巡目を生成・技を入力（運営画面）` |
| 228 | `二巡目 進行中` | `採点画面（コートの端末）` |
| 302 | `二巡目終了` | `順位を確かめる（運営画面）` |
| 376 | `最終結果` | `編集できなくなる。発表・共有` |
| 450 | `アーカイブ` | `見るだけ。一覧のアーカイブ欄へ` |

たとえば 1 つ目はこうなる。

置換前:
```html
        <g transform="translate(10,6)">
          <rect class="d-box" width="340" height="52" rx="8"/>
          <text class="d-title" x="14" y="23">大会を作る</text>
          <text class="d-sub" x="14" y="42">運営画面・大会タブ</text>
        </g>
```
置換後:
```html
        <g transform="translate(10,6)">
          <rect class="d-box" width="340" height="52" rx="8"/>
          <text class="d-title" x="14" y="23">準備中</text>
          <text class="d-sub" x="14" y="42">大会を作る・技と配点・選手（運営画面）</text>
        </g>
```

7 つ目（`translate(10,450)`）だけは `d-box-key` / `d-title-key` / `d-sub-key` のクラスを使っている。**強調は「最終結果」に移す**ので、6 つ目と 7 つ目のクラスを入れ替える。

置換前:
```html
        <g transform="translate(10,376)">
          <rect class="d-box" width="340" height="52" rx="8"/>
          <text class="d-title" x="14" y="23">結果の確認</text>
          <text class="d-sub" x="14" y="42">運営画面・結果タブ</text>
        </g>
        <line class="d-line" x1="180" y1="431" x2="180" y2="447" marker-end="url(#ah)"/>

        <g transform="translate(10,450)">
          <rect class="d-box-key" width="340" height="52" rx="8"/>
          <text class="d-title-key" x="14" y="23">発表・共有</text>
          <text class="d-sub-key" x="14" y="42">発表モード・共有リンク</text>
        </g>
```
置換後:
```html
        <g transform="translate(10,376)">
          <rect class="d-box-key" width="340" height="52" rx="8"/>
          <text class="d-title-key" x="14" y="23">最終結果</text>
          <text class="d-sub-key" x="14" y="42">編集できなくなる。発表・共有</text>
        </g>
        <line class="d-line" x1="180" y1="431" x2="180" y2="447" marker-end="url(#ah)"/>

        <g transform="translate(10,450)">
          <rect class="d-box" width="340" height="52" rx="8"/>
          <text class="d-title" x="14" y="23">アーカイブ</text>
          <text class="d-sub" x="14" y="42">見るだけ。一覧のアーカイブ欄へ</text>
        </g>
```

最後に、図のすぐ下の 2 つの段落を差し替える。

置換前:
```html
    <p>大会のデータはサーバーに1つだけあります。運営者の PC もスマホも、各コートのタブレットも、同じ大会を読み書きします。</p>
    <p>図の各段は、上の状態の 2〜5 にあたります。<span class="term">運営画面で状態を進めないと、コートの端末は採点できません</span>。</p>
```
置換後:
```html
    <p>大会のデータはサーバーに1つだけあります。運営者の PC もスマホも、各コートのタブレットも、同じ大会を読み書きします。</p>
    <p>図の各段が、上に並べた 7 つの状態です。段と段の間は、運営画面の <span class="ui">次へ進む</span> のボタン（<span class="ui">試合開始 ▶</span> <span class="ui">一巡目を終了 ▶</span> …）で進みます。<span class="term">運営画面で状態を進めないと、コートの端末は採点できません</span>。</p>
```

- [ ] **Step 2: 「1. 大会の作成」に PC の運営画面を足す**

（a）「大会を作る」の節を PC とスマホの両方にする。

置換前:
```html
    <h3>大会を作る</h3>
    <p>運営画面（<code>admin.html</code>）を開きます。</p>
    <ol>
      <li>タブ（スマホは画面の下、PC・タブレットは上部バーの下）で <span class="ui">大会</span> を選ぶ。</li>
      <li>右上の <span class="ui">＋ 新規大会</span> を押す。</li>
      <li>シートで <span class="ui">大会名</span>・<span class="ui">日付</span>・<span class="ui">会場</span> を入れる。</li>
      <li><span class="ui">作成</span> を押す。一覧に大会が増えます。</li>
    </ol>
```
置換後:
```html
    <h3>大会を作る</h3>
    <p>運営画面には <span class="term">PC 用</span>（<code>desk.html</code>）と <span class="term">スマホ用</span>（<code>admin.html</code>）があります。中身は同じ大会で、ヘッダーの <span class="ui">🖥</span> / <span class="ui">📱</span> でいつでも行き来できます。当日の受付や名簿の打ち込みは PC 用が向いています。</p>
    <p><span class="term">PC 用（<code>desk.html</code>）</span>:</p>
    <ol>
      <li>左の区画で <span class="ui">大会一覧</span> を選ぶ。</li>
      <li>右上の <span class="ui">＋ 新規作成</span> を押す。</li>
      <li><span class="ui">大会名</span>・<span class="ui">日付</span>・<span class="ui">会場</span> を入れて <span class="ui">作成</span>。<span class="ui">選手</span> の区画が開きます。</li>
    </ol>
    <p><span class="term">スマホ用（<code>admin.html</code>）</span>:</p>
    <ol>
      <li>タブ（画面の下）で <span class="ui">大会</span> を選ぶ。</li>
      <li>右上の <span class="ui">＋ 新規大会</span> を押す。</li>
      <li>シートで <span class="ui">大会名</span>・<span class="ui">日付</span>・<span class="ui">会場</span> を入れる。</li>
      <li><span class="ui">作成</span> を押す。一覧に大会が増えます。</li>
    </ol>
    <div class="note">このマニュアルの画面写真はスマホ用のものです。PC 用は同じ内容を広い画面に並べたもので、ボタンの名前もほぼ同じです。</div>

    <h3>去年の大会をコピーして作る</h3>
    <p>PC 用の <span class="ui">大会一覧</span> で、元にする大会の行の <span class="ui">⋯</span> → <span class="ui">📄 コピーして作成</span> を押します。</p>
    <ul>
      <li><span class="ui">大会名</span>（「元の名前（コピー）」が入っています）・<span class="ui">日付</span>（今日）・<span class="ui">会場</span> を直します。</li>
      <li><span class="ui">選手も複製する（得点は消す）</span> にチェックを入れると、元の大会の<span class="term">一巡目の選手だけ</span>が、名前・コート・性別・新人・技をそのままに、得点 0 で入ります。二巡目の行は複製しません。</li>
      <li>技と配点は必ず複製されます。共有リンクと配信用ボードのアドレスは引き継ぎません。</li>
    </ul>
    <p>できた大会は <span class="ui">準備中</span> です。アーカイブ済みの大会からもコピーできます。</p>

    <h3>終わった大会を片づける（アーカイブ）</h3>
    <p><span class="ui">最終結果</span> まで進んだ大会は <span class="ui">アーカイブ</span> にできます。上部の <span class="ui">アーカイブ ▶</span>、または大会一覧の行の <span class="ui">⋯</span> → <span class="ui">📥 アーカイブ</span> です。</p>
    <ul>
      <li>大会一覧では、下の <span class="ui">▸ アーカイブ（n 件）</span> に畳まれます。当日の大会と混ざりません。</li>
      <li>採点画面の大会の選択肢から消えます。押し間違えて去年の大会に採点してしまう事故を防ぐためです。</li>
      <li>見るだけはできます。共有リンクと発表モードもそのまま開けます。</li>
      <li>戻すときは上部の <span class="ui">◀ 最終結果 に戻す</span> です。</li>
    </ul>
```

（b）「（c）CSV で読み込む」の節の**最後の `<div class="note">…</div>` の直後**（`<h3>技の選び方</h3>` の直前）に、PC の表と貼り付けの節を足す。

```html
    <h3>（d）PC の表に打ち込む・Excel から貼り付ける</h3>
    <p>PC 用の運営画面（<code>desk.html</code>）の <span class="ui">選手</span> の区画は、1人1行の<span class="term">編集できる表</span>です。名前・コート・性別・新人・技①②③のセルをその場で直せます。直したセルから離れる（Tab や Enter、ほかの場所をクリック）と、その項目だけが保存されます。</p>
    <ul>
      <li><span class="ui">＋ 行を追加</span> で末尾に空の行が増えます。名前を入れて確定すると登録されます。コート・性別・新人は1つ上の行と同じものが入ります。</li>
      <li>表の上の絞り込みと並べ替えは、スマホの選手タブと同じです。</li>
      <li>行の <span class="ui">⋯</span> から削除できます。採点済みの選手を消すときは確認が出ます。</li>
    </ul>
    <p>Excel の名簿からまとめて入れるときは <span class="ui">📋 貼り付けて追加</span> です。</p>
    <ol>
      <li>Excel で <span class="term">名前・コート・性別・新人・技1・技2・技3</span> の 7 列を、この順に並べて選び、コピーします。</li>
      <li><span class="ui">📋 貼り付けて追加</span> を押し、開いた欄に貼り付けます。</li>
      <li>読み取った内容が一覧で出ます。1行目が「名前」で始まっていれば見出しとして飛ばします。</li>
      <li>技リストに無い技名は<span class="term">赤く</span>示されます。その行は送られないので、技名を直してから貼り直してください。</li>
      <li>件数を確かめて <span class="ui">登録</span> を押します。</li>
    </ol>
    <ul>
      <li>タブ区切り（Excel からのコピー）とカンマ区切りのどちらでも読めます。</li>
      <li>性別は <span class="ui">女子</span> <span class="ui">女</span> <span class="ui">F</span> で女子、ほかは男子です。新人は <span class="ui">新人</span> <span class="ui">○</span> <span class="ui">1</span> <span class="ui">true</span> で新人です。</li>
      <li>順番はサーバーが自動で採番します。</li>
      <li>1行でも不正があると、1人も登録されません（半分だけ入った状態を作りません）。</li>
    </ul>
```

- [ ] **Step 3: 「2. 採点の進行」を PC 運営の「試合」に沿って書き直す**

「試合を開始する」から「二巡目の並び順」の直前までを差し替える。

置換前（`<h3>試合を開始する</h3>` から `<h3>二巡目に進む</h3>` の節の終わり `<p>技が入ると、各コートの採点画面の選手一覧に二巡目の選手が並びます。</p>` まで。途中の「採点画面の見方」「採点画面の状態バナー」の節は**そのまま残す**ので、差し替えるのは次の 3 か所）。

まず `<h3>試合を開始する</h3>` の節を差し替える。

置換前:
```html
    <h3>試合を開始する</h3>
    <p>選手の登録が済んだら、運営画面の <span class="ui">進行</span> タブを開きます。いちばん上に <span class="ui">現在の状態: 準備中</span> と <span class="ui">試合開始 ▶</span> のボタンが出ています。</p>
    <ol>
      <li><span class="ui">試合開始 ▶</span> を押す。<span class="msg">一巡目 n名。技が未入力の選手が m名います。試合を開始しますか？</span> の確認で <span class="ui">OK</span> を押すと <span class="ui">一巡目 進行中</span> になります。</li>
      <li>コートの端末で大会を選び直すと、採点できるようになります。</li>
      <li>一巡目が終わったら <span class="ui">一巡目を終了 ▶</span> を押します。ここで初めて <span class="ui">二巡目を生成</span> が押せるようになります。</li>
      <li>二巡目の技を入れ終えたら <span class="ui">二巡目を開始 ▶</span>。コートの端末で大会を選び直すと二巡目の選手が出ます。</li>
      <li>二巡目が終わったら <span class="ui">二巡目を終了 ▶</span>、順位を確かめてから <span class="ui">最終結果を確定 ▶</span>。</li>
    </ol>
    <div class="note">押し間違えても ⋯ メニューの <span class="ui">戻す</span> で1つ前に戻せます。<span class="ui">最終結果</span> のあとも <span class="ui">戻す</span> で編集に戻れます。</div>

    <h3>コートの端末で採点画面を開く</h3>
    <p>運営画面の <span class="ui">進行</span> タブで、そのコートのチップ（<span class="ui">A コート</span> や <span class="ui">B コート</span>）を押してから <span class="ui">採点画面へ</span> を押します。絞り込み中のコートのまま採点画面が開きます。</p>
    <p>開いた採点画面の URL には大会とコートが入っています（<code>scoring.html#event/大会ID/コート</code>）。この URL のおかげで、当日はタブを閉じたり端末を再起動したりしても、同じ大会・同じコートに戻れます。</p>
    <div class="note">URL は大会ごとに違います。次の大会では URL も変わるので、運営画面の <span class="ui">採点画面へ</span> から開き直してください。</div>
```
置換後:
```html
    <h3>当日の流れ（8つのボタン）</h3>
    <p>当日は運営画面の上に出ている <span class="ui">次へ進む</span> のボタンを、順に押していくだけです。PC 用では左の区画の <span class="ui">試合</span> を開いて進めます（スマホ用では <span class="ui">進行</span> タブです）。</p>
    <ol>
      <li><span class="ui">試合開始 ▶</span> — <span class="msg">一巡目 n名。技が未入力の選手が m名います。試合を開始しますか？</span> の確認で <span class="ui">OK</span>。<span class="ui">一巡目 進行中</span> になり、採点画面が別のウィンドウで開きます。</li>
      <li><span class="term">コート別の状況を見る</span> — <span class="ui">試合</span> の区画に、コートごとのカードが並びます（下の節）。</li>
      <li><span class="ui">一巡目を終了 ▶</span> — 全コートの採点が済んだら押します。ここで初めて <span class="ui">二巡目を生成</span> が押せます。</li>
      <li><span class="ui">二巡目を生成</span> — 全コート分の二巡目の行ができます。</li>
      <li><span class="term">技を入れる</span> — できた表で、行ごとに技①②③を選びます（下の節）。</li>
      <li><span class="ui">二巡目を開始 ▶</span> — <span class="ui">二巡目 進行中</span> になります。コートの端末で大会を選び直すと二巡目の選手が出ます。</li>
      <li><span class="ui">二巡目を終了 ▶</span> — <span class="ui">結果</span> の区画で順位を確かめます。</li>
      <li><span class="ui">最終結果を確定 ▶</span> — 得点・選手・技を編集できなくなります。そのあと <span class="ui">アーカイブ ▶</span> で片づけます。</li>
    </ol>
    <div class="note">押し間違えても <span class="ui">◀ …に戻す</span>（PC 用は上部、スマホ用は ⋯ メニュー）で1つ前に戻せます。<span class="ui">最終結果</span> のあとも戻せば編集できます。二巡目を行わない大会は <span class="ui">一巡目終了</span> のときの <span class="ui">二巡目なしで終了</span> で <span class="ui">最終結果</span> へ進めます。</div>

    <h3>コート別の状況を見る（PC 用の「試合」）</h3>
    <p>PC 用の <span class="ui">試合</span> の区画には、コートごとにカードが1枚ずつ並びます。</p>
    <ul>
      <li><span class="ui">A コート</span> — コートの名前。</li>
      <li><span class="ui">採点済み 5 / 8</span> — いま採点している巡目の進み具合。全員終わると緑になります。</li>
      <li><span class="ui">いま採点中: 山田 太郎</span> — そのコートの端末が開いている選手です。誰も開いていなければ <span class="ui">待機中</span>。</li>
      <li><span class="ui">採点画面を開く</span> — そのコートの採点画面を別のウィンドウで開きます。同じコートは同じウィンドウを使い回します。</li>
      <li><span class="ui">URL をコピー</span> — 採点画面のアドレスを写します。コートのタブレットにメッセージで送るときに使います。</li>
    </ul>
    <div class="note"><span class="term">この2つは自動では変わりません。</span><span class="ui">↻ 最新に更新</span> を押すと読み直します（自動で更新し続けるのは配信用ボードだけです）。</div>
    <p>開いた採点画面の URL には大会とコートが入っています（<code>scoring.html#event/大会ID/コート</code>）。この URL のおかげで、当日はタブを閉じたり端末を再起動したりしても、同じ大会・同じコートに戻れます。</p>
    <div class="note">URL は大会ごとに違います。次の大会では URL も変わるので、運営画面の <span class="ui">採点画面を開く</span> から開き直してください。ポップアップが塞がれて開かないときは、ブラウザに許可させるか <span class="ui">URL をコピー</span> で開いてください。</div>
```

次に `<h3>二巡目に進む</h3>` の節を差し替える。

置換前:
```html
    <h3>二巡目に進む</h3>
    <p>一巡目が終わったら、運営画面の <span class="ui">進行</span> タブで <span class="ui">一巡目を終了 ▶</span> を押してから二巡目を作ります。<span class="term">状態が <span class="ui">一巡目終了</span> でないと <span class="ui">二巡目を生成</span> は押せません</span>（ボタンが灰色のままです）。</p>
    <ol>
      <li>上に <span class="ui">採点済み 8 / 8</span> のように進み具合が出ます。全員終わっているか確かめてから <span class="ui">一巡目を終了 ▶</span> を押します。</li>
      <li><span class="ui">二巡目を生成</span> を押す。<span class="msg">一巡目 採点済み x / y。全コート分の二巡目を作ります（採点画面にも反映されます）。よろしいですか？</span> の確認で <span class="ui">OK</span> を押すと、全コート分の二巡目の行ができます。</li>
      <li>行ごとに <span class="ui">① ＋</span> <span class="ui">② ＋</span> <span class="ui">③ ＋</span> をタップして技を入れます。赤い枠はまだ空という意味です。3つ入れるのが基本です。</li>
      <li>一巡目と同じ技でよければ <span class="ui">一巡目と同じ技をコピー</span> を押すだけで済みます。</li>
    </ol>
    <p>技が入ると、各コートの採点画面の選手一覧に二巡目の選手が並びます。</p>
```
置換後:
```html
    <h3>二巡目に進む</h3>
    <p>一巡目が終わったら <span class="ui">一巡目を終了 ▶</span> を押してから二巡目を作ります。<span class="term">状態が <span class="ui">一巡目終了</span> でないと <span class="ui">二巡目を生成</span> は押せません</span>（ボタンが灰色のままです）。</p>
    <ol>
      <li>上に <span class="ui">採点済み 8 / 8</span> のように進み具合が出ます。全員終わっているか確かめてから <span class="ui">一巡目を終了 ▶</span> を押します。</li>
      <li><span class="ui">二巡目を生成</span> を押す。<span class="msg">一巡目 採点済み x / y。全コート分の二巡目を作ります（採点画面にも反映されます）。よろしいですか？</span> の確認で <span class="ui">OK</span> を押すと、全コート分の二巡目の行ができます。</li>
      <li>できた表で技を入れます。3つ入れるのが基本です。</li>
    </ol>
    <p>PC 用では、二巡目が <span class="term">巡・No.・名前・一巡目の得点・技1・技2・技3</span> の表になります。</p>
    <ul>
      <li>技は<span class="term">選ぶだけ</span>で保存されます。まだ空の枠は赤い枠で示されます。</li>
      <li>行の右の <span class="ui">一巡目と同じ技をコピー</span> で、その選手の一巡目の技がそのまま入ります。</li>
      <li>表の上の <span class="ui">全員に一巡目と同じ技をコピー（n 名）</span> で、まとめて入れられます。対象は<span class="term">技が3つとも空で、まだ採点していない行</span>だけです（途中まで入れた行と採点済みの行は上書きしません。件数がボタンに出ています）。</li>
      <li><span class="ui">二巡目 8名　技 未入力 3</span> で、技がまだの人数が分かります。0 になると緑になります。</li>
    </ul>
    <div class="note">技を直せるのは <span class="ui">一巡目終了</span> のときだけです。<span class="ui">二巡目を開始</span> のあとは表が読み取り専用になります。直したいときは <span class="ui">◀ 一巡目終了 に戻す</span> で戻してください。採点済みの選手の技を変えるときは <span class="msg">この選手は採点済みです（n点）。…</span> の確認が出ます。</div>
    <p>技が入ると、各コートの採点画面の選手一覧に二巡目の選手が並びます。</p>
    <p>スマホ用の <span class="ui">進行</span> タブでも同じことができます。こちらは1人1枚のカードで、<span class="ui">① ＋</span> <span class="ui">② ＋</span> <span class="ui">③ ＋</span> の枠をタップして技を選びます。</p>
```

- [ ] **Step 4: 「3. 得点の集計」と「4. サイト掲載」に PC の結果の区画を足す**

（a）「確認する場所」の箇条書きを差し替える。

置換前:
```html
    <ul>
      <li><span class="term">運営画面の結果タブ</span> — <span class="ui">最新に更新</span> を押すと、サーバーの最新の順位を読み直します。</li>
      <li><span class="term">順位表示ページ</span>（<code>ranking.html</code>） — 大会を選んで <span class="ui">大会データを読み込む</span>。<span class="ui">HTMLダウンロード</span> で1枚の成績表として保存できます。</li>
      <li><span class="term">運営画面の進行タブ</span> — 右上の <span class="ui">⋯</span> → <span class="ui">CSVエクスポート</span> で全選手の内訳を保存できます。</li>
      <li><span class="term">採点画面</span> — <span class="ui">CSVエクスポート</span> で全選手の内訳を、<span class="ui">HTML保存</span> で成績表を保存できます。</li>
    </ul>
```
置換後:
```html
    <ul>
      <li><span class="term">PC 用運営画面の「結果」</span> — <span class="ui">一般男子</span> <span class="ui">新人</span> <span class="ui">一般女子</span> の3部門が横に3列で並びます。<span class="ui">↻ 最新に更新</span> でサーバーの最新の順位を読み直します。</li>
      <li><span class="term">スマホ用運営画面の結果タブ</span> — 同じ内容が縦に並びます。<span class="ui">最新に更新</span> で読み直します。</li>
      <li><span class="term">順位表示ページ</span>（<code>ranking.html</code>） — 大会を選んで <span class="ui">大会データを読み込む</span>。<span class="ui">HTMLダウンロード</span> で1枚の成績表として保存できます。</li>
      <li><span class="term">運営画面の「試合」／進行タブ</span> — <span class="ui">⋯</span> → <span class="ui">CSVエクスポート</span> で全選手の内訳を保存できます。</li>
      <li><span class="term">採点画面</span> — <span class="ui">CSVエクスポート</span> で全選手の内訳を、<span class="ui">HTML保存</span> で成績表を保存できます。</li>
    </ul>
```

（b）「参加者に配る（共有リンク）」の手順の 1 行目を、どちらの運営画面でもよいと分かる書き方にする。

置換前:
```html
    <h3>参加者に配る（共有リンク）</h3>
    <ol>
      <li>結果タブで <span class="ui">共有リンクをコピー</span> を押す。</li>
```
置換後:
```html
    <h3>参加者に配る（共有リンク）</h3>
    <ol>
      <li>運営画面の <span class="ui">結果</span>（PC 用）または結果タブ（スマホ用）で <span class="ui">🔗 共有リンクをコピー</span> を押す。</li>
```

（c）「YouTube 配信（OBS）に映す」の手順 1・2 を、PC 用のボタンで済ませられるようにする。

置換前:
```html
    <ol>
      <li>結果タブで <span class="ui">共有リンクをコピー</span> を押し、URL を取ります（<code>share.html#（トークン）</code>）。</li>
      <li>その URL の <code>share.html</code> を <code>board.html</code> に書き換え、末尾に <code>/A</code> を足します。これが A コートのアドレスです（例: <code>board.html#O7KVvuj-/A</code>）。B コートは末尾を <code>/B</code> にします。コート名は運営画面で付けたものをそのまま書きます。</li>
```
置換後:
```html
    <ol>
      <li>PC 用運営画面の <span class="ui">結果</span> を開き、下の <span class="ui">配信用ボード</span> でコートのボタン（<span class="ui">📺 A コートの URL をコピー</span>）を押します。そのコートのアドレス（<code>board.html#（トークン）/A</code>）がそのまま写ります。</li>
      <li>スマホ用の運営画面しか使えないときは、<span class="ui">共有リンクをコピー</span> で取った <code>share.html#（トークン）</code> の <code>share.html</code> を <code>board.html</code> に書き換え、末尾に <code>/A</code> を足します（例: <code>board.html#O7KVvuj-/A</code>）。B コートは末尾を <code>/B</code> にします。コート名は運営画面で付けたものをそのまま書きます。</li>
```

（d）「大会をファイルに保存する」の手順を PC 用にも触れる形にする。

置換前:
```html
    <ol>
      <li>運営画面の大会タブで、その大会の行の <span class="ui">⋯</span> を押す。</li>
      <li><span class="ui">💾 ファイルに保存</span> を押す。<code>tameshigiri_日付_大会名.json</code> がダウンロードされます。</li>
    </ol>
```
置換後:
```html
    <ol>
      <li>運営画面の <span class="ui">大会一覧</span>（PC 用）または大会タブ（スマホ用）で、その大会の行の <span class="ui">⋯</span> を押す。</li>
      <li><span class="ui">💾 ファイルに保存</span> を押す。<code>tameshigiri_日付_大会名.json</code> がダウンロードされます。</li>
    </ol>
```

- [ ] **Step 5: ブラウザで確かめる**

`http://localhost:3461/help.html` を新しいタブで開く。

- [ ] 「0. 全体の流れ」の図が 7 つの状態（準備中／一巡目 進行中／一巡目終了／二巡目 進行中／二巡目終了／最終結果／アーカイブ）になっていて、箱が欠けたり文字がはみ出したりしていない。「最終結果」の箱だけ強調されている
- [ ] 「1. 大会の作成」に「去年の大会をコピーして作る」「終わった大会を片づける（アーカイブ）」「（d）PC の表に打ち込む・Excel から貼り付ける」が出ている
- [ ] 「2. 採点の進行」が「当日の流れ（8つのボタン）」「コート別の状況を見る（PC 用の「試合」）」から始まっている
- [ ] 「3. 得点の集計」の「確認する場所」と「4. サイト掲載」の配信の手順に PC 用の説明が入っている
- [ ] 目次のリンクがすべて生きている（各節の見出しへ飛ぶ）
- [ ] 画像がすべて表示される（差し替えていないので欠けは出ないはず）
- [ ] ライト／ダークどちらでも読める。スマホ幅（375px）でも崩れない

- [ ] **Step 6: commit**

```bash
git add help.html
git commit -m "$(cat <<'EOF'
docs: ヘルプを7段階の流れと PC 運営の画面に合わせる

全体の流れの図を大会の7つの状態にし、大会の作成に PC の表・貼り付け・
コピー・アーカイブを足す。採点の進行を「試合開始 → コート別の状況 →
一巡目を終了 → 二巡目を生成 → 技入力 → 二巡目を開始 → 二巡目を終了 →
最終結果を確定」の流れに書き直し、結果と配信用ボードに PC 用の説明を足す。
画面写真は差し替えず、スマホ用のものである旨を文章で断る。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 通しの手動確認

設計書「テスト > 手動確認」の一巡目〜二巡目の流れを、PC 運営だけで通す。**新しく作った大会を使う**（本物の大会には触らない）。

**Files:** なし（確認のみ。直すところが出たら該当のタスクのファイルに戻って直し、`fix:` で commit する）

- [ ] **Step 1: 自動テストを通す**

`http://localhost:3461/test.html` を新しいタブで開く。
Expected: `Result: N passed, 0 failed`

- [ ] **Step 2: 通しで確かめる**

ウィンドウ幅を 1280px にして `http://localhost:3461/desk.html` を開く。

- [ ] 大会を新規作成し、「選手」で A コート 2 名・B コート 2 名を技つきで登録する（`準備中`）
- [ ] 「試合」の区画に A・B のカードが出て「採点済み 0 / 2」「待機中」
- [ ] 上部「試合開始 ▶」→ 確認 → `一巡目 進行中`。採点画面が別ウィンドウで開き、一巡目の選手だけが並ぶ
- [ ] タブレット想定（別ウィンドウの `scoring.html`）で A コートの 1 人を採点して確定する
- [ ] 運営に戻って「↻ 最新に更新」→ A コートが「採点済み 1 / 2」、「いま採点中: （その選手）」に変わる
- [ ] 残りも採点し、上部「一巡目を終了 ▶」→ `一巡目終了`
- [ ] 「二巡目を生成」→ 4 行の表ができる。「技 未入力 4」
- [ ] 1 行を行ごとの「一巡目と同じ技をコピー」で埋め、残りを「全員に一巡目と同じ技をコピー（3 名）」で埋める → 「技 未入力 0」が緑
- [ ] 上部「二巡目を開始 ▶」→ `二巡目 進行中`。表が読み取り専用になり、カードの注記と件数が二巡目に変わる
- [ ] 採点画面で大会を選び直すと二巡目の選手だけが並ぶ。2 人採点する
- [ ] 運営で「↻ 最新に更新」→ 二巡目の件数が増える
- [ ] 残りも採点し「二巡目を終了 ▶」→ `二巡目終了`
- [ ] 「結果」の区画で 3 部門が 3 列に並ぶ。「🔗 共有リンクをコピー」「🖵 発表モードで開く」「📺 A コートの URL をコピー」がそれぞれ動く
- [ ] 上部「最終結果を確定 ▶」→ `最終結果`。「試合」の二巡目の表は読み取り専用のまま。採点画面で得点を送ると保存されない（状態バナーが出て確定が押せない）
- [ ] 上部「アーカイブ ▶」→ 大会一覧の「▸ アーカイブ（n 件）」に移り、採点画面の大会の選択肢から消える。「結果」は引き続き開ける
- [ ] 全部の画面で 1280px のとき横スクロールが出ない
- [ ] 🌙 でダークにして、「試合」と「結果」の文字・赤い枠・緑の件数がすべて読める

- [ ] **Step 3: 片づける**

確認に使った大会を、大会一覧の行の `⋯` → `🗑 削除` で消す。

- [ ] **Step 4: 直したところがあれば commit**

Step 2 で直した箇所があれば、そのファイルだけを `git add` して `fix:` の接頭辞で commit する（末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`）。直すところが無ければ commit は不要。

---

## 完了条件

- `test.html` が `Result: N passed, 0 failed`（Task 2 で 29 本増える）
- `desk.html` の「試合」と「結果」がプレースホルダーでなくなり、Task 8 の通し確認が全項目通る
- `help.html` の 0・1・2・3・4 節が 7 段階の流れと PC 運営の画面に合っている
- `desk-players.js` に 1 行も触っていない（`git log --stat` で確認する）
- 計画4 が足す予定の `Courts.parsePasteRows` / `Courts.scoreMayChange` / `Courts.scoreChangeConfirmMessage` / `Storage.pickCsvFile` を呼んでいない（`grep -n "parsePasteRows\|scoreMayChange\|scoreChangeConfirmMessage\|pickCsvFile" desk-match.js desk-results.js` が空）
