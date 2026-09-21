# 二巡目準備（形の登録）と決戦（暫定ベスト8）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一巡目を終了した時点でサーバーが二巡目の行（形は一巡目の複製）と暫定ベスト8の決戦コートを自動で作り、`round2_final`（決戦 進行中）という状態を1つ足して、採点画面・配信ボード・発表モード・共有ページに決戦の暫定順位を出す。

**Architecture:** 状態の定義は `status.js`（サーバーとブラウザが同じファイルを読む UMD 風モジュール）に一本化する。二巡目の生成ロジックを `server/index.js` の中で純粋な関数 `generateRound2(event, force)` に切り出し、`POST …/rounds/2/generate` と `POST …/status`（`round1 → round1_done`）の両方から呼ぶ。決戦の暫定順位は `computeRanking` の応答に `finale` を足して、運営・共有リンクの両方から同じ形で読めるようにする。画面はすべて `EventStatus` / `Courts` の関数を経由して判定し、文言を二重定義しない。

**Tech Stack:** バニラ JavaScript（IIFE・`var`・`function`）、Express 5（同期 fs）、`test.html`（ブラウザ単体テスト、`node scripts/run-test-html.mjs`）、CSS は `theme.css` の変数のみ（黒金のトーン）。

---

## ⚠ この計画の読み方（最初に必ず読む）

- **計画のコード断片より、いまのファイルを正とする。** 本計画のコードは 2026-09-22 時点のブランチ `feature/audit-fixes-a`（コミット `b89f3dd`）を読んで書いた。同じツリーで別の担当者が作業しているため、行番号も周辺のコードもずれている可能性がある。**各タスクの最初に対象ファイルを開いて現状を確認し、食い違ったら実ファイルに合わせる**こと。断片は「何をどう変えるか」の指示であって、貼り付け用の完成品ではない。
- 各タスクは必ず **テストを書く → 落ちるのを確認 → 実装 → 通す → commit** の順で進める。
- commit は必ず **pathspec 付き**で行う: `git commit -m "…" -- <ファイル1> <ファイル2>`。`git add` は新規ファイルにだけ使う（この計画では新規ファイルは作らない）。**`git reset` は使わない。** `.git/index.lock` があれば数秒待って再試行する。
- ブラウザテストの動かし方:
  ```bash
  # 別ターミナルでサーバーを起動（.claude/launch.json の dev-3461 と同じ）
  PORT=3461 node server/index.js
  # 別ターミナルでテスト
  node scripts/run-test-html.mjs http://localhost:3461/test.html
  ```
  「`Result: N passed, 0 failed`」なら成功。失敗があれば終了コード 1。

## 先に読むもの

| 資料 | 見るところ |
|---|---|
| `docs/superpowers/specs/2026-09-22-round2-prep-and-finale-design.md` | この計画の元。決定事項・状態モデル・データ・画面・テストの節すべて |
| `docs/superpowers/specs/2026-09-18-pc-mode-and-event-status-design.md` | 状態モデルの元（遷移の確認と拒否、状態の無い既存データ） |
| `docs/superpowers/specs/2026-09-08-mobile-admin-flow-design.md` | 二巡目生成の番号規則 |
| `docs/superpowers/specs/2026-09-13-live-board-design.md` | 配信ボードの方針（無認証・2秒ポーリング・操作 UI を持たない） |
| `docs/superpowers/audits/2026-09-22-system-audit.md` | 直前に直した A 項目（スマホの基本情報シートが `admin.js` に入った／`POST /api/events` が allowlist 化／バンドルに `status`）。この計画はその後の状態を前提にする |

## ファイル構成

| ファイル | この計画での役割 | 触るタスク |
|---|---|---|
| `status.js` | 状態・遷移・ラベル・`finalists` / `finalCourtOf` / `scoringCourtFilter` の唯一の定義。サーバーとブラウザが共有 | A1 |
| `courts.js` | 選手データからの導出と画面の文言。`finalists` の並び替え・`statusConfirmMessage` / `stageCountText` の新分岐 | A2 |
| `server/index.js` | `settings.finalCourt` の受け口（6 箇所）・`generateRound2` の抽出と暫定ベスト8・遷移からの生成・`computeRanking` の `finale` | A3 / A4 / A5 / A6 |
| `api.js` | `changeStatus` の応答に `round2`、新しい `reason` の記述。`generateNextRound` の `finalistCount` | A5 |
| `test.html` | 上記すべてのテスト。既存の `toRound1Done` を使うテスト群の付け替え | A1〜A6 / C2 / C3 |
| `desk.js` | 上部の段階表示（`STAGE_STEPS`）と遷移ボタン（`nextStep` / `nextLabel`） | B1 |
| `desk-match.js` / `desk.css` | PC の試合進行。見出し・注記・決戦の区画・生成ボタン撤去・`round2` / `round2_final` の見せ方 | B2 |
| `admin-round.js` / `admin.css` | スマホの試合進行。同上 | B3 |
| `desk-players.js` / `admin-players.js` | 選手登録の案内と巡目の絞り込みの既定 | B4 |
| `desk-setup.js` / `admin.js` | 基本情報の「決戦コートの名前」 | B5 |
| `home.js` | トップの流れの帯（8 段階） | B6 |
| `app.js` / `scoring.html` / `style.css` | 採点画面のバナー・コート制限・決戦の進み | C1 |
| `board.js` / `board.html` / `board.css` | 配信ボードの決戦表 | C2 |
| `present.js` / `present.html` / `present.css` | 発表モードの「決戦」 | C3 |
| `share.js` / `share.css` | 共有ページの「決戦（暫定）」 | C4 |
| `help.html` | 0. 全体の流れ（8 段階）・2. 採点の進行・4. サイト掲載 | C5 |

**新しいファイルは作らない。** したがって `server/static-policy.js` の許可リストは触らない。

## 状態が1つ増えることの影響（`EventStatus` を読む全箇所）

`grep -n "round2_done\|scoringRound\|isScoringOpen\|STAGE_STEPS\|LABELS\|EventStatus\." *.js server/*.js *.html` の結果を、直すか／直さないかで仕分けたもの。**実装者は着手前に同じ grep を自分で流し、この表に無い箇所が出ていないか確かめること。**

| 箇所 | 読んでいるもの | 対応 | タスク |
|---|---|---|---|
| `status.js` | 定義そのもの | `round2_final` を足す。`prev` / `nextStep` / `isScoringOpen` / `scoringRound` を直す | A1 |
| `courts.js:219` `progressRound` | `scoringRound` | `scoringRound('round2_final')` が 2 を返すので**自動で正しくなる**。テストだけ足す | A2 |
| `courts.js:354` `stageCountText` | `scoringRound` | `round2_final` を先に分岐して「決戦 採点済み n / m」にする | A2 |
| `courts.js:398` `statusConfirmMessage` | `from`/`to` | `round2 → round2_final` と `round2_final → round2_done` の分岐を足す | A2 |
| `courts.js:411` 既定の戻し文言 | `LABELS[to]` | 自動（`round2_final` のラベルが入る）。テストで固定 | A2 |
| `server/index.js:955-993` 状態 API | `STATES` / `canTransition` / `LABELS` | 新しい拒否条件（`empty` / `no_finale` / `finale_pending` / `generate_failed`）と遷移からの生成 | A5 |
| `server/index.js:320` `rejectIfLocked` | `isLocked` | 変えない（`round2_final` はロックされない） | — |
| `server/index.js:2304` 生成 API の状態判定 | `of` | `generateRound2` の抽出に伴い書き換え | A4 |
| `server/index.js:334` `computeRanking` | — | `finale` を足す | A6 |
| `server/index.js` の `settings` 構築 6 箇所（`POST /api/events` / `PATCH` / `copy` / テンプレート / バンドル書き出し / バンドル取り込み） | — | `finalCourt` を通す | A3 |
| `desk.js:24` `STAGE_STEPS` | 配列リテラル | `'round2_final'` を足して 7 段（archived は並べない） | B1 |
| `desk.js:316-333` 戻す／次へ進む | `prev` / `next` / `NEXT_LABELS` | `nextStep` / `nextLabel` に置き換え | B1 |
| `desk.js:394` toast | `LABELS[to]` | 自動 | — |
| `desk-events.js:133-152` バッジ | `LABELS` / `isScoringOpen` | 自動 | — |
| `desk-match.js:34,252` | `of` / `LABELS` | 見出し・注記・決戦区画・状態ごとの見せ方 | B2 |
| `desk-players.js:99` / `desk-setup.js:49` / `desk-techniques.js:25` / `techniques.html:139` | `isLocked` | 変えない | — |
| `admin-round.js:75-158,494` | `LABELS` / `NEXT_LABELS` / `next` / `prev` / `of` | `nextStep` / `nextLabel`、生成ボタン撤去、決戦の区画 | B3 |
| `admin-events.js:75-100` バッジ | `LABELS` / `of` | 自動 | — |
| `admin-players.js:23-26` / `admin.js:507` | `isLocked` | 変えない | — |
| `app.js:287-370` | `of` / `isScoringOpen` / `next` / `NEXT_LABELS` / `scoringRound` | バナーの新文言とコート制限 | C1 |
| `home.js:37` `statusRank` | `isScoringOpen` | 自動（`round2_final` は 0 群に入る）。テストで固定 | B6 |
| `home.js:95-128` 流れの帯 | `STATES` / `LABELS` / `FLOW_CAPTIONS` | `round2_final` の一言を足し、aria-label を「8段階」に | B6 |
| `board.js` / `present.js` / `share.js` | `EventStatus` を読まない（無認証ページは `status.js` を配信していない） | 状態は `finale.status` から読む | C2/C3/C4 |
| `test.html:3126-3244` | `OK_TRANSITIONS` / `STATES` / ラベル | 表を更新 | A1 |

### 既存データの移行（壊さないための決まり）

1. **`derive` は `round2_final` を返さない。** `status` を持たない古い大会は、選手データからは今までどおり `draft` / `round1` / `round2` / `round2_done` のどれかに推定される。決戦は運営者がボタンで入る状態なので、推定では入らない。A1 でこれをテストとして固定する。
2. **決戦の行が無い大会は `round2 → round2_done` を許す。** 既に `round2` で保存されている大会（この機能より前に作られたもの）には `finalist: true` の行が無いので、サーバーは `round2 → round2_done` をそのまま通す。決戦の行があるときだけ 409 `finale_pending` で止める。
3. **`prev('round2_done')` は決戦の行があれば `round2_final`、無ければ `round2`。** 添字（`STATES[i-1]`）に任せると、決戦の無い大会でも `round2_final` に戻ってしまうので明示的に分岐する。
4. **`settings.finalCourt` が無い大会は `'決戦'` を既定にする。** `EventStatus.finalCourtOf(event)` が唯一の読み出し口。`settings` に書き足すのは基本情報の保存のときだけで、読み出しのたびには書かない。
5. **`finalist` は二巡目の行にだけ付く印。** コートを手で変えても印は残る（設計書の決定）。`EventStatus.finalists` は `finalist === true` かつ巡目 2 の行だけを返す。

## コードの作法（全タスク共通）

- ブラウザ側は IIFE、`var` と `function`（アロー関数・`let` / `const` は使わない）。`server/index.js` は既存どおり `const` / アロー可。
- `await` の後は必ず `ctx.isStale()`（PC 運営）／`currentEventId() !== eventId`（スマホ運営）／`seq !== renderSeq`（`desk.js`）を見てから DOM に触る。
- **サーバーの書き込み系ハンドラは同期のまま維持する**（`server/index.js` 冒頭の【不変条件】）。`generateRound2` も同期関数にする。
- 文字列キーの辞書は `Object.create(null)` を使う（コート名や選手名が `constructor` / `__proto__` でも壊れないように）。
- CSS は `theme.css` の変数だけを使う（`var(--accent)` `var(--bg-secondary)` など）。生の色番号を書かない。黒金のトーンを崩さない。
- 文言は日本語。同じ文言を 2 箇所に書かない（`courts.js` / `status.js` に置いて両画面から呼ぶ）。

---

# トラック A（先に、この順で直列に）

> A1〜A6 はすべて `server/index.js` か `test.html` を触るので、**1 人が順番に**進める。並行にすると同じファイルで衝突する。

## Task A1: `status.js` に `round2_final` と決戦の判定を足す

**Files:**
- Modify: `status.js`
- Test: `test.html`（`status.js` の節。現状 3122〜3244 行あたり）

- [ ] **Step 1: 落ちるテストを書く**

`test.html` の `status.js` の節を次のように直す・足す。既存の `OK_TRANSITIONS` と「STATES は7段階」「isScoringOpen: round1 / round2 だけ true」「scoringRound: それ以外は null」は**書き換える**（残すと二重定義になる）。

```js
    // ---- 1. canTransition（設計書「状態と遷移」の表 + 2026-09-22 の決戦） ----
    var OK_TRANSITIONS = [
      ['draft', 'round1'],
      ['round1', 'draft'], ['round1', 'round1_done'],
      ['round1_done', 'round1'], ['round1_done', 'round2'], ['round1_done', 'final'],
      ['round2', 'round1_done'], ['round2', 'round2_final'], ['round2', 'round2_done'],
      ['round2_final', 'round2'], ['round2_final', 'round2_done'],
      ['round2_done', 'round2'], ['round2_done', 'round2_final'], ['round2_done', 'final'],
      ['final', 'round2_done'], ['final', 'round1_done'], ['final', 'archived'],
      ['archived', 'final']
    ];
    assert('canTransition: 表にある組み合わせは全部 true',
      OK_TRANSITIONS.filter(function(t) { return !EventStatus.canTransition(t[0], t[1]); }), []);
    assert('canTransition: round2_final → final は false',
      EventStatus.canTransition('round2_final', 'final'), false);
    assert('canTransition: round1_done → round2_final は false',
      EventStatus.canTransition('round1_done', 'round2_final'), false);

    // ---- 2. next / nextStep / prev ----
    var FIN_ROWS = [
      { order: 'A-男子-1-1', score: 30 },
      { order: '決戦-男子-2-1', finalist: true },
      { order: 'A-男子-2-1' }
    ];
    var NOFIN_ROWS = [{ order: 'A-男子-1-1', score: 30 }, { order: 'A-男子-2-1' }];

    assert('next: round2 → round2_final（添字どおり）', EventStatus.next('round2'), 'round2_final');
    assert('next: round2_final → round2_done', EventStatus.next('round2_final'), 'round2_done');
    assert('nextStep: round2 は決戦があれば round2_final',
      EventStatus.nextStep('round2', FIN_ROWS), 'round2_final');
    assert('nextStep: round2 は決戦が無ければ round2_done',
      EventStatus.nextStep('round2', NOFIN_ROWS), 'round2_done');
    assert('nextStep: round2 で players が無くても落ちない',
      EventStatus.nextStep('round2', null), 'round2_done');
    assert('nextStep: round2 以外は next と同じ',
      EventStatus.nextStep('round1_done', FIN_ROWS), 'round2');
    assert('nextLabel: round2 は決戦があれば「決戦を開始」',
      EventStatus.nextLabel('round2', FIN_ROWS), '決戦を開始');
    assert('nextLabel: round2 は決戦が無ければ「二巡目を終了」',
      EventStatus.nextLabel('round2', NOFIN_ROWS), '二巡目を終了');
    assert('nextLabel: round2_final は「二巡目を終了」',
      EventStatus.nextLabel('round2_final', FIN_ROWS), '二巡目を終了');
    assert('nextLabel: archived は null', EventStatus.nextLabel('archived', FIN_ROWS), null);

    assert('prev: round2_final → round2', EventStatus.prev('round2_final', FIN_ROWS), 'round2');
    assert('prev: round2_done は決戦があれば round2_final',
      EventStatus.prev('round2_done', FIN_ROWS), 'round2_final');
    assert('prev: round2_done は決戦が無ければ round2',
      EventStatus.prev('round2_done', NOFIN_ROWS), 'round2');
    assert('prev: round2_done で players が無くても落ちない',
      EventStatus.prev('round2_done', null), 'round2');

    // ---- 決戦の選手と決戦コート ----
    assert('finalists: 二巡目の finalist の行だけを返す',
      EventStatus.finalists(FIN_ROWS).map(function(p) { return p.order; }), ['決戦-男子-2-1']);
    assert('finalists: 一巡目に finalist が付いていても拾わない',
      EventStatus.finalists([{ order: 'A-男子-1-1', finalist: true }]), []);
    assert('finalists: players が無くても空配列', EventStatus.finalists(null), []);
    assert('hasFinalists: 決戦の行があれば true', EventStatus.hasFinalists(FIN_ROWS), true);
    assert('hasFinalists: 決戦の行が無ければ false', EventStatus.hasFinalists(NOFIN_ROWS), false);

    assert('finalCourtOf: 既定は「決戦」', EventStatus.finalCourtOf({}), '決戦');
    assert('finalCourtOf: settings が無くても既定', EventStatus.finalCourtOf(null), '決戦');
    assert('finalCourtOf: settings.finalCourt があればそれ',
      EventStatus.finalCourtOf({ settings: { finalCourt: '決勝' } }), '決勝');
    assert('finalCourtOf: 空白だけの指定は既定に戻す',
      EventStatus.finalCourtOf({ settings: { finalCourt: '  ' } }), '決戦');
    assert('finalCourtOf: 文字列でない指定は既定に戻す',
      EventStatus.finalCourtOf({ settings: { finalCourt: 3 } }), '決戦');

    // ---- 採点できるコートの絞り込み ----
    var FIN_EVENT = { settings: { finalCourt: '決戦' } };
    assert('scoringCourtFilter: round2 は決戦コート以外',
      EventStatus.scoringCourtFilter('round2', FIN_EVENT), { mode: 'exclude', court: '決戦' });
    assert('scoringCourtFilter: round2_final は決戦コートだけ',
      EventStatus.scoringCourtFilter('round2_final', FIN_EVENT), { mode: 'only', court: '決戦' });
    assert('scoringCourtFilter: round1 は制限なし',
      EventStatus.scoringCourtFilter('round1', FIN_EVENT), { mode: 'all', court: '' });
    assert('isCourtScorable: round2 は決戦コートだけ false', [
      EventStatus.isCourtScorable('round2', FIN_EVENT, 'A'),
      EventStatus.isCourtScorable('round2', FIN_EVENT, '決戦')
    ], [true, false]);
    assert('isCourtScorable: round2_final は決戦コートだけ true', [
      EventStatus.isCourtScorable('round2_final', FIN_EVENT, 'A'),
      EventStatus.isCourtScorable('round2_final', FIN_EVENT, '決戦')
    ], [false, true]);
    assert('isCourtScorable: round1 はどのコートも true',
      EventStatus.isCourtScorable('round1', FIN_EVENT, '決戦'), true);

    // ---- derive は決戦を推定しない（既存データを壊さない） ----
    assert('derive: 決戦の行があっても round2_final にはしない',
      EventStatus.derive({ players: [
        { order: 'A-男子-1-1', score: 30, result: '1    ' },
        { order: '決戦-男子-2-1', finalist: true, score: 0, result: '' }
      ] }), 'round2');
    assert('derive: STATES のどれかで round2_final ではない',
      EventStatus.STATES.indexOf(EventStatus.derive({ players: [
        { order: 'A-男子-1-1', score: 30, result: '1    ' },
        { order: '決戦-男子-2-1', finalist: true, score: 10, result: '1    ' }
      ] })) !== -1 && EventStatus.derive({ players: [
        { order: 'A-男子-1-1', score: 30, result: '1    ' },
        { order: '決戦-男子-2-1', finalist: true, score: 10, result: '1    ' }
      ] }) !== 'round2_final', true);
```

さらに、既存の 3 つの assert を次の内容に**置き換える**:

```js
    assert('isScoringOpen: round1 / round2 / round2_final が true',
      EventStatus.STATES.filter(EventStatus.isScoringOpen), ['round1', 'round2', 'round2_final']);
    assert('scoringRound: round2_final は 2', EventStatus.scoringRound('round2_final'), 2);
    assert('STATES は8段階',
      EventStatus.STATES,
      ['draft', 'round1', 'round1_done', 'round2', 'round2_final', 'round2_done', 'final', 'archived']);
    assert('LABELS: round1_done は「二巡目準備（形の登録）」',
      EventStatus.LABELS.round1_done, '二巡目準備（形の登録）');
    assert('LABELS: round2_final は「決戦 進行中」', EventStatus.LABELS.round2_final, '決戦 進行中');
    assert('NEXT_LABELS: round2 は「決戦を開始」', EventStatus.NEXT_LABELS.round2, '決戦を開始');
    assert('NEXT_LABELS: round2_final は「二巡目を終了」',
      EventStatus.NEXT_LABELS.round2_final, '二巡目を終了');
```

- [ ] **Step 2: 落ちるのを確認**

```bash
node scripts/run-test-html.mjs http://localhost:3461/test.html
```
`nextStep is not a function` / `STATES は8段階` などで失敗が出ること（`0 failed` でないこと）。

- [ ] **Step 3: `status.js` を実装する**

定義部を次のように直す。

```js
  var STATES = ['draft', 'round1', 'round1_done', 'round2', 'round2_final', 'round2_done', 'final', 'archived'];

  var LABELS = {
    draft: '準備中',
    round1: '一巡目 進行中',
    // 一巡目を終了した直後の段階。二巡目の行はサーバーが作り終えているので、
    // 運営者がここでやるのは「自己申告があった選手の形を直す」こと（設計書 2026-09-22）。
    round1_done: '二巡目準備（形の登録）',
    round2: '二巡目 進行中',
    round2_final: '決戦 進行中',
    round2_done: '二巡目終了',
    final: '最終結果',
    archived: 'アーカイブ'
  };

  var NEXT_LABELS = {
    draft: '試合開始',
    round1: '一巡目を終了',
    round1_done: '二巡目を開始',
    round2: '決戦を開始',
    round2_final: '二巡目を終了',
    round2_done: '最終結果を確定',
    final: 'アーカイブ',
    archived: null
  };

  var TRANSITIONS = {
    draft: ['round1'],
    round1: ['draft', 'round1_done'],
    round1_done: ['round1', 'round2', 'final'],
    // round2 → round2_done は「決戦の行が 0 件のとき」だけ。判定はサーバー
    // （遷移表は硬い形だけを表し、件数の条件は POST /api/events/:id/status が見る）。
    round2: ['round1_done', 'round2_final', 'round2_done'],
    round2_final: ['round2', 'round2_done'],
    round2_done: ['round2', 'round2_final', 'final'],
    final: ['round2_done', 'round1_done', 'archived'],
    archived: ['final']
  };

  // 決戦コートの既定名。event.settings.finalCourt で変えられる（設計書「データ」）。
  var DEFAULT_FINAL_COURT = '決戦';
```

判定関数を足す・直す。

```js
  // 決戦コートの名前。settings に無ければ既定の「決戦」。
  // 読み出しはここだけを通す（保存のときに書くのは基本情報の PATCH だけ）。
  function finalCourtOf(event) {
    var s = (event && event.settings) || {};
    var name = (typeof s.finalCourt === 'string') ? s.finalCourt.trim() : '';
    return name || DEFAULT_FINAL_COURT;
  }

  // 暫定ベスト8（決戦に出る選手）の行。二巡目の行に付いた finalist の印で判定する。
  // コートを手で変えても印は残るので、コート名では判定しない（設計書「データ」）。
  // 並びはここでは整えない（試技順に並べるのは Courts.finalists）。
  function finalists(players) {
    return (players || []).filter(function(p) {
      return p && p.finalist === true && roundOf(p) === 2;
    });
  }

  function hasFinalists(players) {
    return finalists(players).length > 0;
  }

  // 「次へ進む」の行き先。二巡目 進行中からは、決戦の行があれば決戦へ、
  // 無ければ二巡目終了へ（暫定ベスト8 が 0 名の大会）。
  function nextStep(status, players) {
    if (status === 'round2') return hasFinalists(players) ? 'round2_final' : 'round2_done';
    return next(status);
  }

  // 「次へ進む」ボタンの文言。nextStep と対になる。
  function nextLabel(status, players) {
    // 決戦が無い大会の二巡目は、そのまま「二巡目を終了」（round2_final の文言を借りる。
    // 同じ文言を2箇所に書かないため）。
    if (status === 'round2' && !hasFinalists(players)) return NEXT_LABELS.round2_final;
    var label = NEXT_LABELS[status];
    return label === undefined ? null : label;
  }
```

`prev` を直す。

```js
  // 「戻す」の行き先。draft と未知の状態は null。
  // final からは二巡目の行があれば round2_done、無ければ round1_done。
  // round2_done からは決戦の行があれば round2_final、無ければ round2
  // （決戦の無い大会を添字だけで round2_final に戻さない。既存データの移行）。
  function prev(status, players) {
    if (status === 'final') {
      return rowsOfRound(players, 2).length > 0 ? 'round2_done' : 'round1_done';
    }
    if (status === 'round2_done') {
      return hasFinalists(players) ? 'round2_final' : 'round2';
    }
    var i = STATES.indexOf(status);
    if (i <= 0) return null;
    return STATES[i - 1];
  }
```

`isScoringOpen` / `scoringRound` を直し、コートの絞り込みを足す。

```js
  // コート端末で得点を送れる状態か。決戦 進行中も採点できる（決戦コートだけ）。
  function isScoringOpen(status) {
    return status === 'round1' || status === 'round2' || status === 'round2_final';
  }

  // 採点の対象になる巡目。進行中でなければ null。決戦は二巡目の一部。
  function scoringRound(status) {
    if (status === 'round1') return 1;
    if (status === 'round2' || status === 'round2_final') return 2;
    return null;
  }

  // その状態で採点してよいコートの絞り込み（設計書「状態モデル」）。
  //   round2       … 決戦コート以外（決戦は「決戦を開始」の後）
  //   round2_final … 決戦コートだけ
  //   それ以外     … 制限なし
  // 採点画面（app.js）と配信ボードが同じ判定を使えるよう、素の値だけを返す。
  function scoringCourtFilter(status, event) {
    if (status === 'round2') return { mode: 'exclude', court: finalCourtOf(event) };
    if (status === 'round2_final') return { mode: 'only', court: finalCourtOf(event) };
    return { mode: 'all', court: '' };
  }

  // そのコートで採点してよいか。scoringCourtFilter の判定を1つの真偽値にしたもの。
  function isCourtScorable(status, event, court) {
    var f = scoringCourtFilter(status, event);
    if (f.mode === 'exclude') return court !== f.court;
    if (f.mode === 'only') return court === f.court;
    return true;
  }
```

`derive` は**変えない**。コメントだけ足す。

```js
  // status を持たない大会の状態を選手から推定する（設計書「状態の無い既存データ」）。
  // round2_final は返さない。決戦は運営者が「決戦を開始」を押して入る状態で、
  // 選手データからは区別できないため（既存データの移行。test.html で固定）。
```

エクスポートに足す。

```js
    nextStep: nextStep,
    nextLabel: nextLabel,
    finalists: finalists,
    hasFinalists: hasFinalists,
    finalCourtOf: finalCourtOf,
    scoringCourtFilter: scoringCourtFilter,
    isCourtScorable: isCourtScorable,
```

- [ ] **Step 4: テストが通るのを確認**

```bash
node scripts/run-test-html.mjs http://localhost:3461/test.html
```
期待: `status.js` の節が全部 pass。**この時点では `api.js` の節（サーバー API）はまだ落ちてよい**（A5 で直す）。落ちた件名を控えておき、A5 で消えることを確かめる。

- [ ] **Step 5: commit**

```bash
git commit -m "feat: 決戦（round2_final）の状態と決戦コートの判定を status.js に足す" -- status.js test.html
```

**完了条件:** `status.js` の節に新しい assert が入り、`EventStatus.STATES` が 8 段階になっている。`derive` は `round2_final` を返さない。

---

## Task A2: `courts.js` に決戦の並びと文言を足す

**Files:**
- Modify: `courts.js`
- Test: `test.html`（`courts.js` の節。`statusConfirmMessage` / `stageCountText` のあたり、現状 2600〜2660 行）

- [ ] **Step 1: 落ちるテストを書く**

```js
    // ---- 決戦（暫定ベスト8）の並び ----
    var finP = [
      { id: 'a', order: 'A-男子-1-1', score: 30 },
      { id: 'b', order: '決戦-男子-2-2', finalist: true, name: '二郎' },
      { id: 'c', order: '決戦-男子-2-1', finalist: true, name: '一郎' },
      { id: 'd', order: 'A-男子-2-1', name: '三郎' }
    ];
    assert('Courts.finalists: 決戦の行を番号順に返す',
      Courts.finalists(finP).map(function(p) { return p.name; }), ['一郎', '二郎']);
    assert('Courts.finalists: 決戦が無ければ空配列', Courts.finalists([{ order: 'A-男子-2-1' }]), []);
    assert('Courts.finalCourtOf: 既定は「決戦」', Courts.finalCourtOf({}), '決戦');
    assert('Courts.finalCourtOf: settings.finalCourt があればそれ',
      Courts.finalCourtOf({ settings: { finalCourt: '決勝' } }), '決勝');

    // ---- 決戦を挟む遷移の確認文言 ----
    var cfP = [
      { order: 'A-男子-1-1', score: 30, result: '1    ' },
      { order: 'A-男子-2-1', score: 0, result: '' },
      { order: 'A-男子-2-2', score: 12, result: '1    ' },
      { order: '決戦-男子-2-1', finalist: true, score: 0, result: '' },
      { order: '決戦-男子-2-2', finalist: true, score: 20, result: '1    ' }
    ];
    assert('statusConfirmMessage: round2 → round2_final は決戦以外の未採点を数える',
      Courts.statusConfirmMessage('round2', 'round2_final', cfP),
      '決戦以外の未採点が 1名います。\n決戦を開始しますか？');
    assert('statusConfirmMessage: round2 → round2_final で未採点0なら「いません」',
      Courts.statusConfirmMessage('round2', 'round2_final', [
        { order: 'A-男子-2-1', score: 12, result: '1    ' },
        { order: '決戦-男子-2-1', finalist: true, score: 0, result: '' }
      ]),
      '決戦以外の未採点がいません。\n決戦を開始しますか？');
    assert('statusConfirmMessage: round2_final → round2_done は決戦の未採点を数える',
      Courts.statusConfirmMessage('round2_final', 'round2_done', cfP),
      '決戦の未採点が 1名います。\n二巡目を終了しますか？');
    assert('statusConfirmMessage: round2_final → round2 は戻す文言',
      Courts.statusConfirmMessage('round2_final', 'round2', cfP),
      '二巡目 進行中に戻します。よろしいですか？');
    assert('statusConfirmMessage: round2_done → round2_final は戻す文言',
      Courts.statusConfirmMessage('round2_done', 'round2_final', cfP),
      '決戦 進行中に戻します。よろしいですか？');
    assert('statusConfirmMessage: 決戦の無い大会の round2 → round2_done は従来どおり',
      Courts.statusConfirmMessage('round2', 'round2_done',
        [{ order: 'A-男子-2-1', score: 0, result: '' }]),
      '二巡目の未採点が 1名います。\n二巡目を終了しますか？');

    // ---- 段階表示の件数 ----
    assert('stageCountText: round2_final は決戦だけを数える',
      Courts.stageCountText('round2_final', cfP), '決戦 採点済み 1 / 2');
    assert('stageCountText: round2 は二巡目全体を数える（従来どおり）',
      Courts.stageCountText('round2', cfP), '採点済み 2 / 4');
    assert('progressRound: round2_final は二巡目', Courts.progressRound('round2_final', cfP), 2);

    // ---- 試合開始を止める条件は決戦で変わらない ----
    assert('startBlockers: round2_final の状態でも判定は選手データだけで決まる',
      Courts.startBlockers({ settings: {} }, cfP), []);
```

- [ ] **Step 2: 落ちるのを確認** — `Courts.finalists is not a function` など。

- [ ] **Step 3: `courts.js` を実装する**

`techCopyTargets` の下あたりに足す。

```js
  // 決戦（暫定ベスト8）の行を試技順（番号順）に並べて返す。
  // 誰が決戦かの判定は status.js（サーバーと共有）にあり、ここは並べるだけ。
  function finalists(players) {
    return EventStatus.finalists(players).slice().sort(compareOrder);
  }

  // 決戦コートの名前。判定は status.js に一本化してあるので、ここは呼び直すだけ
  // （courts.js しか読まない画面から使えるようにするための入口）。
  function finalCourtOf(event) {
    return EventStatus.finalCourtOf(event);
  }
```

`stageCountText` の先頭（`var r = EventStatus.scoringRound(status);` の**前**）に分岐を足す。

```js
    // 決戦 進行中は決戦の行だけを数える（他のコートはもう斬り終わっている）。
    // scoringRound('round2_final') は 2 を返すので、必ずこの分岐を先に置くこと。
    if (status === 'round2_final') {
      var fin = EventStatus.finalists(list);
      return '決戦 採点済み ' + fin.filter(isScored).length + ' / ' + fin.length;
    }
```

`statusConfirmMessage` の `if (from === 'round2' && to === 'round2_done')` の**前**に足す。

```js
    if (from === 'round2' && to === 'round2_final') {
      // 決戦に出ない選手（暫定ベスト8 以外）が全員斬り終わっているかを数える
      var others = round(2).filter(function(p) { return p.finalist !== true; });
      return countPhrase('決戦以外の未採点', others.filter(function(p) { return !isScored(p); }).length) +
        '\n決戦を開始しますか？';
    }
    if (from === 'round2_final' && to === 'round2_done') {
      return countPhrase('決戦の未採点',
        EventStatus.finalists(list).filter(function(p) { return !isScored(p); }).length) +
        '\n二巡目を終了しますか？';
    }
```

エクスポートに `finalists` と `finalCourtOf` を足す。

- [ ] **Step 4: テストが通るのを確認** — `courts.js` の節が全部 pass。

- [ ] **Step 5: commit**

```bash
git commit -m "feat: 決戦の並びと遷移の確認文言を courts.js に足す" -- courts.js test.html
```

**完了条件:** `Courts.finalists` / `Courts.finalCourtOf` が使え、決戦を挟む 2 つの遷移の文言と `stageCountText` の決戦分岐がテストで固定されている。

---

## Task A3: `settings.finalCourt`（決戦コートの名前）をサーバーが預かる

**Files:**
- Modify: `server/index.js`（`settings` を組み立てている 6 箇所）
- Modify: `test.html`（`api.js` の節）

- [ ] **Step 1: 落ちるテストを書く**

`test.html` の `api.js` の節、`updateEventInfo` / `copyEvent` のテストの近くに足す。

```js
    // ---- 決戦コートの名前（settings.finalCourt。設計書 2026-09-22） ----
    var fcEvent = await Api.saveEvent({ name: '決戦コート設定', date: '2026-09-22', venue: '', players: [] });
    var fcSet = await Api.updateEventInfo(fcEvent.id, {
      name: '決戦コート設定', settings: { requireBib: false, requireRank: false, courts: ['A'], finalCourt: '決勝' }
    });
    assert('PATCH: finalCourt を保存する', fcSet.ok && fcSet.event.settings.finalCourt, '決勝');
    assert('PATCH: 保存後に読み直しても残る',
      (await Api.loadEvent(fcEvent.id)).settings.finalCourt, '決勝');
    var fcKeep = await Api.updateEventInfo(fcEvent.id, { name: '決戦コート設定2' });
    assert('PATCH: settings を送らなければ finalCourt は据え置き',
      fcKeep.ok && (await Api.loadEvent(fcEvent.id)).settings.finalCourt, '決勝');
    var fcPartial = await Api.updateEventInfo(fcEvent.id, {
      name: '決戦コート設定2', settings: { requireBib: true }
    });
    assert('PATCH: settings に finalCourt を含めなければ据え置き',
      fcPartial.ok && (await Api.loadEvent(fcEvent.id)).settings.finalCourt, '決勝');
    var fcBad = await Api.updateEventInfo(fcEvent.id, {
      name: '決戦コート設定2', settings: { finalCourt: 'A-B' }
    });
    assert('PATCH: 「-」を含む決戦コート名は 400', [fcBad.ok, fcBad.status], [false, 400]);
    assert('PATCH: 断られた後も前の値が残る',
      (await Api.loadEvent(fcEvent.id)).settings.finalCourt, '決勝');
    var fcClear = await Api.updateEventInfo(fcEvent.id, {
      name: '決戦コート設定2', settings: { finalCourt: '' }
    });
    assert('PATCH: 空文字は既定（決戦）に戻す＝キーを持たない',
      fcClear.ok && (await Api.loadEvent(fcEvent.id)).settings.finalCourt, undefined);

    await Api.updateEventInfo(fcEvent.id, { name: '決戦コート設定2', settings: { finalCourt: '決勝' } });
    var fcCopy = await Api.copyEvent(fcEvent.id, { name: '決戦コピー', date: '2026-09-22', venue: '' });
    assert('copyEvent: finalCourt を複製する',
      (await Api.loadEvent(fcCopy.id)).settings.finalCourt, '決勝');
    var fcBundle = JSON.parse(await Api.exportBundle(fcEvent.id));
    assert('bundle: finalCourt を書き出す', fcBundle.event.settings.finalCourt, '決勝');
    var fcImported = await Api.importBundle(fcBundle);
    assert('bundle: finalCourt を取り込む',
      (await Api.loadEvent(fcImported.id)).settings.finalCourt, '決勝');
    await Api.deleteEvent(fcEvent.id);
    await Api.deleteEvent(fcCopy.id);
    await Api.deleteEvent(fcImported.id);
```

- [ ] **Step 2: 落ちるのを確認** — `finalCourt` が `undefined` で落ちること。

- [ ] **Step 3: `server/index.js` を実装する**

`sanitizeCourtList` の下に足す。

```js
// settings.finalCourt（決戦コートの名前）の寛容な取り込み。
// コート名の規則（isValidCourt）を通らない値は落として既定（EventStatus.finalCourtOf の
// '決戦'）に任せる。取り込み系 API が他の項目を黙って落とすのと同じ流儀。
function sanitizeFinalCourt(name) {
  return isValidCourt(name) ? name : '';
}
```

`PATCH /api/events/:id` の `settings` の分岐を次のように直す。

```js
    if (body.settings !== undefined) {
      const s = (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings))
        ? body.settings : {};
      let courts = (event.settings && Array.isArray(event.settings.courts)) ? event.settings.courts.slice() : [];
      if (s.courts !== undefined) {
        const courtsErr = validateCourtList(s.courts);
        if (courtsErr) return res.status(400).json({ error: courtsErr });
        courts = s.courts.slice();
      }
      // 決戦コートの名前。courts と同じく、指定が無ければ既存の値を残す
      // （name だけの部分更新で決戦コートが消えないように）。
      // 空文字は「既定（決戦）に戻す」意味なのでキーごと落とす。
      let finalCourt = (event.settings && typeof event.settings.finalCourt === 'string')
        ? event.settings.finalCourt : '';
      if (s.finalCourt !== undefined) {
        const name = typeof s.finalCourt === 'string' ? s.finalCourt.trim() : '';
        if (name && !isValidCourt(name)) {
          return res.status(400).json({ error: 'コート名「' + s.finalCourt + '」は使えません' });
        }
        finalCourt = name;
      }
      event.settings = { requireBib: s.requireBib === true, requireRank: s.requireRank === true, courts: courts };
      if (finalCourt) event.settings.finalCourt = finalCourt;
    }
```

残り 5 箇所は、`event.settings = { … }` の直後に同じ 2 行を足す。

```js
    // 例: POST /api/events（現状 615-623 行あたり）
    event.settings = { requireBib: s.requireBib === true, requireRank: s.requireRank === true, courts: courtsInput.slice() };
    const fc = sanitizeFinalCourt(s.finalCourt);
    if (fc) event.settings.finalCourt = fc;
```

対象（現状の行番号。必ず自分で確認すること）:

| 箇所 | 読み元 |
|---|---|
| `POST /api/events`（615-623） | `s.finalCourt` |
| `POST /api/events/:id/copy`（806-813） | `src.settings.finalCourt` |
| テンプレート作成（929） | 足さない（テンプレートは決戦コートを指定しない。既定に任せる） |
| バンドル書き出し（2064-2070） | `event.settings.finalCourt` |
| バンドル取り込み（2227-2234） | `src.settings.finalCourt` |

- [ ] **Step 4: テストが通るのを確認**

- [ ] **Step 5: commit**

```bash
git commit -m "feat: 決戦コートの名前（settings.finalCourt）をサーバーが預かる" -- server/index.js test.html
```

**完了条件:** PATCH・コピー・バンドル往復で `finalCourt` が保たれ、不正な名前は 400 で断られる。

---

## Task A4: 二巡目の生成を関数に切り出し、暫定ベスト8と形の複製を足す

**Files:**
- Modify: `server/index.js`（`POST /api/events/:id/rounds/2/generate` のあたり）
- Modify: `test.html`（`api.js` の節の「二巡目の生成」）

> **この計画でいちばん大きい変更。** 既存の生成テストは「二巡目の技は空」を前提にしているので、まとめて書き換える。

- [ ] **Step 1: 落ちるテストを書く**

既存の「二巡目の生成」の節（現状 1241〜1360 行）の前に、暫定ベスト8 のテストを足す。**まだ `toRound1Done` は変えない**（A5 で変える）。ここでは `toRound1Done` のあとに `Api.generateNextRound(id, true)` を呼ぶ形のままにしておき、A5 でその呼び出しを消す。

```js
    // ---- 暫定ベスト8（決戦）の抽出。設計書 2026-09-22「データ」 ----
    // 一般男子（女子でない＝新人も含む）の一巡目の得点上位 8 名。0 点は含めない。
    // 8 位が同点なら全員。決戦コートに移し、一巡目の得点が低い順に 1〜n 番。
    async function makeGenEvent(name, csv) {
      var ev = await Api.saveEvent({ name: name, date: '2026-09-22', venue: '', players: [] });
      await Api.importCsv(ev.id, '選手名,順番,技 1,技 2,技 3,得点,新人,女子,結果\n' + csv, 'replace');
      return ev;
    }
    function round2Of(players) {
      return players.filter(function(p) { return Courts.roundOf(p) === 2; });
    }

    // 男子 10 名（60,55,50,45,40,35,30,25,20,15）＋女子 2 名。上位 8 名が決戦。
    var b8Csv = '';
    [60, 55, 50, 45, 40, 35, 30, 25, 20, 15].forEach(function(s, i) {
      b8Csv += 'M' + (i + 1) + ',A-男子-1-' + (i + 1) + ',真,水月,四方,' + s + ',,,1    \n';
    });
    b8Csv += 'F1,A-女子-1-1,真,水月,四方,99,,○,1    \n';
    b8Csv += 'F2,A-女子-1-2,真,水月,四方,90,,○,1    \n';
    var b8 = await makeGenEvent('決戦8名', b8Csv);
    await toRound1Done(b8.id);
    await Api.generateNextRound(b8.id, true);
    var b8Rows = round2Of((await Api.loadEvent(b8.id)).players);
    var b8Fin = b8Rows.filter(function(p) { return p.finalist === true; });
    assert('決戦は一般男子の上位8名', b8Fin.map(function(p) { return p.name; }).sort(),
      ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']);
    assert('決戦の order は決戦コート・男子・二巡目・得点の低い順に1から',
      b8Fin.slice().sort(Courts.compareOrder).map(function(p) { return p.order + ':' + p.name; }),
      ['決戦-男子-2-1:M8', '決戦-男子-2-2:M7', '決戦-男子-2-3:M6', '決戦-男子-2-4:M5',
       '決戦-男子-2-5:M4', '決戦-男子-2-6:M3', '決戦-男子-2-7:M2', '決戦-男子-2-8:M1']);
    assert('決戦に入らない男子は元のコートに残る',
      b8Rows.filter(function(p) { return p.name === 'M9' || p.name === 'M10'; })
        .map(function(p) { return p.order; }).sort(), ['A-男子-2-1', 'A-男子-2-2']);
    assert('女子は決戦に入らない',
      b8Rows.filter(function(p) { return p.isFemale; }).map(function(p) { return p.finalist; }),
      [undefined, undefined]);
    assert('決戦の行は男子として作られる',
      b8Fin.every(function(p) { return p.isFemale === false; }), true);
    assert('二巡目の技は一巡目の複製',
      [b8Rows[0].tech1, b8Rows[0].tech2, b8Rows[0].tech3], ['真', '水月', '四方']);
    assert('生成の応答に決戦の人数を返す',
      (await Api.generateNextRound(b8.id, false)).existingCount, 12);
    await Api.deleteEvent(b8.id);

    // 8 位が同点なら 9 名になる
    var tieCsv = '';
    [60, 55, 50, 45, 40, 35, 30, 25, 25, 20].forEach(function(s, i) {
      tieCsv += 'T' + (i + 1) + ',A-男子-1-' + (i + 1) + ',真,水月,四方,' + s + ',,,1    \n';
    });
    var tie = await makeGenEvent('決戦同点', tieCsv);
    await toRound1Done(tie.id);
    await Api.generateNextRound(tie.id, true);
    var tieFin = round2Of((await Api.loadEvent(tie.id)).players)
      .filter(function(p) { return p.finalist === true; });
    assert('8位が同点なら9名が決戦に入る', tieFin.length, 9);
    assert('同点は一巡目の order 順で番号が付く',
      tieFin.slice().sort(Courts.compareOrder).map(function(p) { return p.name; }),
      ['T10', 'T8', 'T9', 'T7', 'T6', 'T5', 'T4', 'T3', 'T2']);
    await Api.deleteEvent(tie.id);

    // 男子 5 名なら 5 名全員
    var few = await makeGenEvent('決戦5名',
      'P1,A-男子-1-1,真,,,50,,,1    \nP2,A-男子-1-2,真,,,40,,,1    \n' +
      'P3,A-男子-1-3,真,,,30,,,1    \nP4,A-男子-1-4,真,,,20,,,1    \n' +
      'P5,A-男子-1-5,真,,,10,,,1    \n');
    await toRound1Done(few.id);
    await Api.generateNextRound(few.id, true);
    assert('男子が8名未満なら全員が決戦',
      round2Of((await Api.loadEvent(few.id)).players)
        .filter(function(p) { return p.finalist === true; }).length, 5);
    await Api.deleteEvent(few.id);

    // 0 点は決戦に含めない
    var zero = await makeGenEvent('決戦0点',
      'Z1,A-男子-1-1,真,,,30,,,1    \nZ2,A-男子-1-2,真,,,0,,,\nZ3,A-男子-1-3,真,,,0,,,\n');
    await toRound1Done(zero.id);
    await Api.generateNextRound(zero.id, true);
    assert('0点の選手は決戦に入らない',
      round2Of((await Api.loadEvent(zero.id)).players)
        .filter(function(p) { return p.finalist === true; }).map(function(p) { return p.name; }), ['Z1']);
    await Api.deleteEvent(zero.id);

    // 男子 0 名なら決戦は作らない
    var noMale = await makeGenEvent('決戦なし',
      'W1,A-女子-1-1,真,,,50,,○,1    \nW2,A-女子-1-2,真,,,40,,○,1    \n');
    await toRound1Done(noMale.id);
    await Api.generateNextRound(noMale.id, true);
    assert('男子が0名なら決戦の行を作らない',
      round2Of((await Api.loadEvent(noMale.id)).players)
        .filter(function(p) { return p.finalist === true; }).length, 0);
    await Api.deleteEvent(noMale.id);

    // 新人も一般男子として決戦に入る
    var nf = await makeGenEvent('決戦新人',
      'N1,A-男子-1-1,真,,,50,○,,1    \nN2,A-男子-1-2,真,,,40,,,1    \n');
    await toRound1Done(nf.id);
    await Api.generateNextRound(nf.id, true);
    assert('新人も一般男子として決戦に入る',
      round2Of((await Api.loadEvent(nf.id)).players)
        .filter(function(p) { return p.finalist === true; }).map(function(p) { return p.name; }).sort(),
      ['N1', 'N2']);
    await Api.deleteEvent(nf.id);

    // 決戦コートの名前は settings.finalCourt に従う
    var fcGen = await makeGenEvent('決戦コート名',
      'C1,A-男子-1-1,真,,,50,,,1    \n');
    await Api.updateEventInfo(fcGen.id, { name: '決戦コート名', settings: { finalCourt: '決勝' } });
    await toRound1Done(fcGen.id);
    await Api.generateNextRound(fcGen.id, true);
    assert('決戦コートの名前は settings.finalCourt に従う',
      round2Of((await Api.loadEvent(fcGen.id)).players)
        .filter(function(p) { return p.finalist === true; })[0].order, '決勝-男子-2-1');
    await Api.deleteEvent(fcGen.id);
```

既存の assert のうち、次の 1 件は**内容が変わる**ので書き換える。

```js
    // 旧: assert('二巡目の技は空', [round2[0].tech1, round2[0].tech2, round2[0].tech3], ['', '', '']);
    assert('二巡目の技は一巡目の複製',
      [round2[0].tech1, round2[0].tech2, round2[0].tech3],
      [genLoaded.players[4].tech1, genLoaded.players[4].tech2, genLoaded.players[4].tech3]);
```

既存の `genEvent`（M1=30 / M2=10 / M3=20 / F1=50 / F2=5 / M4=40）は全員男子が得点を持つので、**M1〜M4 の 4 名が決戦に入る**。そのため次の 2 件も書き換える。

```js
    assert('二巡目は決戦以外が先・女子が先頭・得点の低い順',
      round2.filter(function(p) { return p.finalist !== true; }).map(function(p) { return p.name; }),
      ['F2', 'F1']);
    assert('二巡目の順番はコート×性別ごとに1から（決戦は決戦コートで1から）',
      round2.slice().sort(Courts.compareOrder).map(function(p) { return p.order; }),
      ['A-女子-2-1', 'A-女子-2-2', '決戦-男子-2-1', '決戦-男子-2-2', '決戦-男子-2-3', '決戦-男子-2-4']);
```

- [ ] **Step 2: 落ちるのを確認**

- [ ] **Step 3: `server/index.js` を実装する**

`POST /api/events/:id/rounds/2/generate` の**前**に、純粋な関数群を置く。

```js
// ── 二巡目の生成（設計書 2026-09-08 と 2026-09-22） ──
// POST …/rounds/2/generate と POST …/status（round1 → round1_done）の両方から呼ぶ
// 唯一の実装。event は書き換えず、新しい players 配列を返す。
// 呼び出し側は ok のときだけ event.players を差し替えて書き出す
// （生成できなければ状態も進めない＝「失敗したら遷移も取り消す」）。
// この関数は同期のまま維持すること（server/index.js 冒頭の【不変条件】）。

function scoreOf(p) {
  return (p && typeof p.score === 'number') ? p.score : 0;
}

// 暫定ベスト8。一般男子（isFemale が true でない＝新人も含む。computeRanking と同じ規則）の
// 一巡目の得点上位 8 名。0 点は含めない。8 位が同点なら全員（同点同順位）。8 名未満なら全員。
// 戻り値: { <playerId>: true }（選手 id が '__proto__' でも壊れない辞書）
function pickFinalists(src) {
  const out = Object.create(null);
  const males = src
    .filter(p => p.isFemale !== true && scoreOf(p) > 0)
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a) || (a.order || '').localeCompare(b.order || ''));
  if (males.length === 0) return out;
  const cut = scoreOf(males.length >= 8 ? males[7] : males[males.length - 1]);
  males.forEach(p => { if (scoreOf(p) >= cut) out[p.id] = true; });
  return out;
}

// 決戦以外の並び（従来どおり）: 女子が先、その中で一巡目の得点が低い順、同点は order 順。
function compareForRound2(a, b) {
  const fa = a.isFemale === true ? 0 : 1;
  const fb = b.isFemale === true ? 0 : 1;
  if (fa !== fb) return fa - fb;
  if (scoreOf(a) !== scoreOf(b)) return scoreOf(a) - scoreOf(b);
  return (a.order || '').localeCompare(b.order || '');
}

// 決戦の並び: 一巡目の得点が低い順、同点は一巡目の order 順（設計書の決定）。
function compareByScoreAsc(a, b) {
  if (scoreOf(a) !== scoreOf(b)) return scoreOf(a) - scoreOf(b);
  return (a.order || '').localeCompare(b.order || '');
}

// 一巡目の行から二巡目の行を1つ作る。
// ゼッケン・級位段位・真剣レンタルは同じ選手を指すので複製する（設計書「選手の追加項目」）。
// 技も複製する（自己申告があった選手だけ運営画面で直す。設計書 2026-09-22 の決定）。
// 得点・結果は複製しない。
function buildRound2Row(players, newRows, p, court, isFemale, finalist) {
  const gender = isFemale ? '女子' : '男子';
  const n = nextOrderNumber(players.concat(newRows), court, gender, 2);
  const row = {
    id: generateId(),
    name: p.name || '',
    order: buildOrder(court, isFemale, 2, n),
    tech1: typeof p.tech1 === 'string' ? p.tech1 : '',
    tech2: typeof p.tech2 === 'string' ? p.tech2 : '',
    tech3: typeof p.tech3 === 'string' ? p.tech3 : '',
    score: 0,
    isNewFace: p.isNewFace === true,
    isFemale: isFemale,
    result: '',
    sourcePlayerId: p.id,
    rank: typeof p.rank === 'string' ? p.rank : '',
    rental: p.rental === true
  };
  if (Number.isInteger(p.bib)) row.bib = p.bib;
  // コートを手で変えても決戦の印は残す（設計書「データ」）。
  if (finalist) row.finalist = true;
  return row;
}

// 戻り値:
//   { ok: true, players, created, skipped, existingCount, untrackedCount, unassignedCount, finalistCount }
//   { ok: false, code: 400 | 409, body: { error, reason?, … } }
function generateRound2(event, force) {
  const players = Array.isArray(event.players) ? event.players : [];
  const round1Candidates = players.filter(p => p && EventStatus.roundOf(p) === 1);
  // '未分類' コートの行（order が解析できても isValidCourt を通らない）からは作らない。
  const src = round1Candidates.filter(p => {
    const parsed = parseOrder(p && p.order);
    return parsed !== null && isValidCourt(parsed.court);
  });
  const unassignedCount = round1Candidates.length - src.length;
  if (src.length === 0) {
    return { ok: false, code: 400, body: { error: '一巡目の選手がいません' } };
  }

  const existing = players.filter(p => p && EventStatus.roundOf(p) === 2);
  const untrackedCount = existing.filter(p => !p.sourcePlayerId).length;
  const unscored = src.filter(p => !EventStatus.isScored(p));
  if (unscored.length > 0 && !force) {
    return { ok: false, code: 409, body: {
      error: '一巡目に未採点の選手がいます', reason: 'unscored',
      unscoredCount: unscored.length, existingCount: existing.length,
      untrackedCount: untrackedCount, unassignedCount: unassignedCount } };
  }
  if (existing.length > 0 && !force) {
    return { ok: false, code: 409, body: {
      error: '二巡目は既に生成されています', reason: 'exists',
      unscoredCount: unscored.length, existingCount: existing.length,
      untrackedCount: untrackedCount, unassignedCount: unassignedCount } };
  }

  // force のときは未生成の一巡目行だけを差分追加する。既存の二巡目行には触れない。
  const generated = Object.create(null);
  existing.forEach(p => { if (p && p.sourcePlayerId) generated[p.sourcePlayerId] = true; });
  const targets = src.filter(p => p && !generated[p.id]);

  // 暫定ベスト8 は src 全体（一巡目の全員）から選ぶ。差分追加でも母集団を変えない。
  const finalistIds = pickFinalists(src);
  const plain = targets.filter(p => !finalistIds[p.id]).sort(compareForRound2);
  const finals = targets.filter(p => !!finalistIds[p.id]).sort(compareByScoreAsc);

  const finalCourt = EventStatus.finalCourtOf(event);
  const newRows = [];
  plain.forEach(p => {
    newRows.push(buildRound2Row(players, newRows, p, courtOf(p), p.isFemale === true, false));
  });
  finals.forEach(p => {
    newRows.push(buildRound2Row(players, newRows, p, finalCourt, false, true));
  });

  return {
    ok: true,
    players: players.concat(newRows),
    created: newRows.length,
    skipped: src.length - targets.length,
    existingCount: existing.length,
    untrackedCount: untrackedCount,
    unassignedCount: unassignedCount,
    finalistCount: finals.length
  };
}
```

ハンドラ本体を薄くする。

```js
app.post('/api/events/:id/rounds/2/generate', (req, res) => {
  try {
    if (!requireValidId(req, res)) return;
    const eventPath = path.join(EVENTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(eventPath)) {
      return res.status(404).json({ error: '大会が見つかりません' });
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    if (rejectIfLocked(res, event)) return;
    // 二巡目を作るのは「二巡目準備（形の登録）」のときだけ。
    // 通常の運用では POST …/status（round1 → round1_done）が自動で呼ぶので、
    // この経路は差分追加とテストのためだけに残す。
    const genStatus = EventStatus.of(event);
    if (genStatus !== 'round1_done') {
      return res.status(409).json({
        error: '一巡目を終了してから生成してください', reason: 'status', status: genStatus
      });
    }
    const result = generateRound2(event, !!(req.body && req.body.force === true));
    if (!result.ok) return res.status(result.code).json(result.body);

    event.players = result.players;
    event.updatedAt = new Date().toISOString();
    writeJsonAtomic(eventPath, event);
    res.json({
      success: true,
      created: result.created,
      skipped: result.skipped,
      existingCount: result.existingCount,
      untrackedCount: result.untrackedCount,
      unassignedCount: result.unassignedCount,
      finalistCount: result.finalistCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: テストが通るのを確認**

- [ ] **Step 5: commit**

```bash
git commit -m "feat: 二巡目生成を関数に切り出し、暫定ベスト8と形の複製を足す" -- server/index.js test.html
```

**完了条件:** 暫定ベスト8 の 6 ケース（8名・同点9名・5名・0点除外・男子0名・新人）がテストで固定され、二巡目の技が一巡目の複製になっている。

---

## Task A5: 一巡目の終了で二巡目を生成し、決戦の遷移を拒否条件で守る

**Files:**
- Modify: `server/index.js`（`POST /api/events/:id/status`）
- Modify: `api.js`（`changeStatus` / `generateNextRound` のコメントと戻り値）
- Modify: `test.html`（`toRound1Done` と、それを使う全テスト）

> **既存テストへの影響がいちばん大きいタスク。** `toRound1Done`（`test.html:51`）は「`draft → round1 → round1_done`」の補助で、**この変更のあとは二巡目まで生成される**。生成 API を単体で呼んでいた箇所は結果が変わる。下の表のとおりに直す。

### `toRound1Done` を使っている箇所の付け替え

| 行（現状） | 何をしていたか | どう変えるか |
|---|---|---|
| 51 | 補助の定義 | 戻り値（`changeStatus` の結果）を返すようにし、コメントに「遷移の中で二巡目が生成される」と書く |
| 423-424 `pcSrc` | `toRound1Done` → `generateNextRound(id, true)` | `generateNextRound` の行を**消す**（遷移で生成済み）。直後の `pcRound2Row` の検索はそのまま通る |
| 632-633 `csvR2Event` | 同上 | `generateNextRound` の行を**消す** |
| 870-873 `lockEvent` | `round1_done` → `generateNextRound` → `round2` → `round2_done` | `generateNextRound` の行を消し、`round2` のあとに `await Api.changeStatus(lockEvent.id, 'round2_final');` を挟む（L1=30・L2=10 は決戦に入るので `round2 → round2_done` は 409 になる） |
| 934-937 | 確定後の `generateNextRound` が `locked` | そのまま（変更不要） |
| 1251-1287 `genEvent` | `toRound1Done` → `generateNextRound(false)` で `created` を見る | `toRound1Done` の戻り値 `res.round2.created` を見るように書き換える（下のコード） |
| 1293-1300 `unsEvent` | 未採点で 409 `unscored` → force で生成 | 遷移が force で生成するので、`generateNextRound(false)` は**生成済みの状態で**呼ばれる。`unscored` の判定は `existing` より先なので **reason は `unscored` のまま**。`existingCount` の期待値を 0 → 3 に直し、`forcedGen.created` の期待値を 3 → 0 に直す |
| 1305-1309 `emptyEvent` | 準備中の生成は `status` 409 | そのまま |
| 1313-1319 `goneEvent` | `round1_done` 後に一巡目を全消し → 生成は null | そのまま（一巡目 0 名で 400 → `Api` は null を返す） |
| 1323-1337 `diffEvent` | `toRound1Done` → `generateNextRound(false)` → 選手追加 → force | 最初の `generateNextRound(false)` を**消す**（遷移で生成済み）。以降の期待値は変わらない |
| 1341-1357 `unaEvent` | `toRound1Done` → 生成 → 件数 | `unaGen` は遷移後の生成なので `created: 0` / `skipped: 1`。`unassignedCount` の期待値 2 は変わらない。代わりに `toRound1Done` の戻り値で `created: 1` / `unassignedCount: 2` を見る |
| 1362-1377 `stGenEvent` | draft / round1 で 409、round1_done で生成できる | 最後の「一巡目終了なら二巡目を生成できる」を「一巡目の終了で二巡目ができる」に変え、`toRound1Done` 相当の戻り値を見る |
| 1795 `cpSrc` | `generateNextRound(true)` | 行を**消す**（遷移で生成済み。`cpRes.playerCount` の期待値 2 は一巡目だけの数なので確認すること。二巡目ができると 4 になるなら期待値も直す） |
| 2004-2006 `rtEvent` | `toRound1Done` → `generateNextRound()` → `created === 2` | `generateNextRound` の行を消し、`toRound1Done` の戻り値で `round2.created === 2` を見る |
| 2050-2059 `bsEvent` | `round1_done` → 生成 → `round2` → `round2_done` → `final` | `generateNextRound` の行を消し、`round2` のあとに `round2_final` を挟む（S1=30 は決戦に入る） |

- [ ] **Step 1: 落ちるテストを書く**

`toRound1Done` を直す。

```js
    // 一巡目を終了すると、サーバーが遷移の中で二巡目を生成する（設計書 2026-09-22）。
    // 生成の結果は応答の round2（created / skipped / finalistCount …）に入る。
    // この補助を通したあとで Api.generateNextRound を呼ぶと、
    // 一巡目が全員採点済みなら reason:'exists'、未採点がいれば reason:'unscored' が返る。
    async function toRound1Done(eventId) {
      await Api.changeStatus(eventId, 'round1');
      return await Api.changeStatus(eventId, 'round1_done');
    }
```

新しいテストを「二巡目の生成」の節の末尾に足す。

```js
    // ---- 一巡目の終了で二巡目が生成される（設計書 2026-09-22） ----
    var trEvent = await makeGenEvent('遷移生成',
      'R1,A-男子-1-1,真,水月,四方,30,,,1    \nR2,A-男子-1-2,真,水月,四方,10,,,1    \n' +
      'R3,A-女子-1-1,真,水月,四方,20,,○,1    \n');
    var trRes = await toRound1Done(trEvent.id);
    assert('一巡目の終了で二巡目が生成される', [trRes.ok, trRes.status], [true, 'round1_done']);
    assert('応答に生成の件数が入る',
      [trRes.round2.created, trRes.round2.finalistCount, trRes.round2.unassignedCount], [3, 2, 0]);
    assert('遷移で作った二巡目は技を複製している',
      round2Of((await Api.loadEvent(trEvent.id)).players)
        .map(function(p) { return p.tech1 + p.tech2 + p.tech3; }),
      ['真水月四方', '真水月四方', '真水月四方']);
    assert('遷移の直後に生成 API を呼ぶと exists',
      (await Api.generateNextRound(trEvent.id, false)).reason, 'exists');

    // 一巡目に戻して選手を足し、もう一度終了すると差分だけ追加される
    await Api.changeStatus(trEvent.id, 'round1');
    var trAdd = await Api.createPlayer(trEvent.id, { name: 'R4', court: 'A', isFemale: false });
    await Api.updatePlayer(trEvent.id, trAdd.id, { score: 5, result: '1    ' });
    var trAgain = await Api.changeStatus(trEvent.id, 'round1_done');
    assert('二度目の一巡目終了は差分だけ追加する',
      [trAgain.round2.created, trAgain.round2.skipped], [1, 3]);
    await Api.deleteEvent(trEvent.id);

    // 一巡目が0名なら一巡目を終了できない
    var trEmpty = await Api.saveEvent({ name: '遷移生成0名', date: '2026-09-22', venue: '', players: [] });
    await Api.createPlayer(trEmpty.id, { name: 'X1', court: 'A', isFemale: false });
    await Api.changeStatus(trEmpty.id, 'round1');
    var trGoneP = (await Api.loadEvent(trEmpty.id)).players[0];
    await Api.deletePlayer(trEmpty.id, trGoneP.id, true);
    var trEmptyRes = await Api.changeStatus(trEmpty.id, 'round1_done');
    assert('一巡目が0名なら一巡目を終了できない',
      [trEmptyRes.ok, trEmptyRes.status, trEmptyRes.reason], [false, 409, 'empty']);
    await Api.deleteEvent(trEmpty.id);

    // ---- 決戦の遷移（設計書「遷移の確認と拒否」） ----
    var fnEvent = await makeGenEvent('決戦遷移',
      'K1,A-男子-1-1,真,,,30,,,1    \nK2,A-男子-1-2,真,,,10,,,1    \n' +
      'K3,A-女子-1-1,真,,,20,,○,1    \n');
    await toRound1Done(fnEvent.id);
    await Api.changeStatus(fnEvent.id, 'round2');
    var fnBlocked = await Api.changeStatus(fnEvent.id, 'round2_done');
    assert('決戦があるのに round2 → round2_done は 409 finale_pending',
      [fnBlocked.ok, fnBlocked.status, fnBlocked.reason], [false, 409, 'finale_pending']);
    assert('round2 → round2_final に進める',
      (await Api.changeStatus(fnEvent.id, 'round2_final')).status, 'round2_final');
    assert('round2_final → round2_done に進める',
      (await Api.changeStatus(fnEvent.id, 'round2_done')).status, 'round2_done');
    assert('round2_done → round2_final に戻せる',
      (await Api.changeStatus(fnEvent.id, 'round2_final')).status, 'round2_final');
    assert('round2_final → round2 に戻せる',
      (await Api.changeStatus(fnEvent.id, 'round2')).status, 'round2');
    await Api.deleteEvent(fnEvent.id);

    // 決戦が無い大会（女子だけ）は round2 → round2_done がそのまま通る
    var fnNone = await makeGenEvent('決戦なし遷移',
      'V1,A-女子-1-1,真,,,30,,○,1    \nV2,A-女子-1-2,真,,,10,,○,1    \n');
    await toRound1Done(fnNone.id);
    await Api.changeStatus(fnNone.id, 'round2');
    var fnNoFinale = await Api.changeStatus(fnNone.id, 'round2_final');
    assert('決戦の行が無ければ round2 → round2_final は 409 no_finale',
      [fnNoFinale.ok, fnNoFinale.status, fnNoFinale.reason], [false, 409, 'no_finale']);
    assert('決戦の行が無ければ round2 → round2_done がそのまま通る',
      (await Api.changeStatus(fnNone.id, 'round2_done')).status, 'round2_done');
    await Api.deleteEvent(fnNone.id);
```

続けて、上の表のとおりに既存テストを直す。主なもの:

```js
    // genEvent（1251 あたり）
    var genRes = await toRound1Done(genEvent.id);
    assert('一巡目の終了で作られる二巡目は一巡目の人数', genRes.round2.created, 6);
    assert('生成時の skipped は0', genRes.round2.skipped, 0);
    // （この下の var gen = await Api.generateNextRound(genEvent.id, false); は消す）

    // unsEvent（1293 あたり）
    await toRound1Done(unsEvent.id);
    var unscored = await Api.generateNextRound(unsEvent.id, false);
    assert('未採点があれば拒否される', unscored.reason, 'unscored');
    assert('未採点の人数を返す', unscored.unscoredCount, 2);
    assert('遷移で作られた二巡目の人数を返す', unscored.existingCount, 3);
    var forcedGen = await Api.generateNextRound(unsEvent.id, true);
    assert('force でも追加する選手はいない', forcedGen.created, 0);
    assert('未採点は得点0として先頭に並ぶ',
      (await Api.loadEvent(unsEvent.id)).players.slice(3).map(function(p) { return p.name; }),
      ['S2', 'S3', 'S1']);

    // rtEvent（2004 あたり）
    var rtDone = await toRound1Done(rtEvent.id);
    assert('往復テスト用に二巡目が生成される', rtDone.round2 && rtDone.round2.created, 2);

    // lockEvent（870 あたり）・bsEvent（2050 あたり）
    await Api.changeStatus(id, 'round2');
    await Api.changeStatus(id, 'round2_final');   // ← 足す
    await Api.changeStatus(id, 'round2_done');
```

- [ ] **Step 2: 落ちるのを確認**

- [ ] **Step 3: `server/index.js` の状態 API を実装する**

```js
    const players = Array.isArray(event.players) ? event.players : [];
    // 一巡目の選手が1人もいなければ試合は始められない
    if (from === 'draft' && to === 'round1' &&
        players.filter(p => EventStatus.roundOf(p) === 1).length === 0) {
      return res.status(409).json({ error: '一巡目の選手がいません', reason: 'empty' });
    }

    // 一巡目の終了で二巡目を作る（設計書 2026-09-22 の決定。手動の「二巡目を生成」は無い）。
    // 生成できなければ状態も進めない（ファイルを書かずに返す＝遷移の取り消し）。
    let round2Info = null;
    if (from === 'round1' && to === 'round1_done') {
      if (players.filter(p => EventStatus.roundOf(p) === 1).length === 0) {
        return res.status(409).json({ error: '一巡目の選手がいません', reason: 'empty' });
      }
      // 未採点の確認はクライアントが済ませているので force 扱いで呼ぶ
      // （既に二巡目があれば差分だけ追加される）。
      const gen = generateRound2(event, true);
      if (!gen.ok) {
        return res.status(409).json({
          error: gen.body.error || '二巡目を生成できませんでした', reason: 'generate_failed'
        });
      }
      event.players = gen.players;
      round2Info = {
        created: gen.created, skipped: gen.skipped, existingCount: gen.existingCount,
        untrackedCount: gen.untrackedCount, unassignedCount: gen.unassignedCount,
        finalistCount: gen.finalistCount
      };
    }

    // 二巡目の行が無ければ二巡目は始められない
    if (from === 'round1_done' && to === 'round2' &&
        players.filter(p => EventStatus.roundOf(p) === 2).length === 0) {
      return res.status(409).json({ error: '二巡目が生成されていません', reason: 'no_round2' });
    }
    // 決戦の行が無ければ決戦は始められない（暫定ベスト8 が 0 名の大会）
    if (from === 'round2' && to === 'round2_final' && !EventStatus.hasFinalists(players)) {
      return res.status(409).json({ error: '決戦の選手がいません', reason: 'no_finale' });
    }
    // 決戦の行があるのに二巡目を終了しようとしたら止める（先に「決戦を開始」を押す）
    if (from === 'round2' && to === 'round2_done' && EventStatus.hasFinalists(players)) {
      return res.status(409).json({
        error: '決戦がまだです。先に「決戦を開始」を押してください', reason: 'finale_pending'
      });
    }

    event.status = to;
    event.updatedAt = new Date().toISOString();
    event.live = {};
    writeJsonAtomic(eventPath, event);
    appendHistory(req.params.id, {
      action: 'status_change',
      detail: EventStatus.LABELS[from] + ' → ' + EventStatus.LABELS[to] +
        (round2Info ? '（二巡目 ' + round2Info.created + ' 名を生成。決戦 ' +
                      round2Info.finalistCount + ' 名）' : '')
    });
    res.json({ success: true, status: to, round2: round2Info });
```

> **注意:** `round2Info` を作るときに `event.players` を差し替えるので、そのあとの `players` 変数は**古い配列のまま**。`round1_done → round2` などの判定は `from` が違うので影響しないが、判定を足すときは `event.players` を見ているか `players` を見ているかを確かめること。

- [ ] **Step 4: `api.js` を直す**

```js
  async function changeStatus(eventId, to) {
    // POST /api/events/:eventId/status
    // Body: { to: 'round1' }
    // 戻り値: { ok: true, status: 新しい状態, round2: 生成の結果 | null }
    //       | { ok: false, status: HTTPステータス, reason, error }（400 / 404 / 409）
    //       | null（通信そのものの失敗）
    // 409 の reason は 'transition' | 'empty' | 'no_round2' | 'no_finale' |
    //   'finale_pending' | 'generate_failed'。画面はこれで「読み直す」「先に決戦を開始する」
    //   などの次の行動を出し分けるので、error だけでなく reason も返す。
    // round2 は round1 → round1_done のときだけ入る
    //   { created, skipped, existingCount, untrackedCount, unassignedCount, finalistCount }。
    //   サーバーが遷移の中で二巡目を生成する（設計書 2026-09-22）。
    …
      var json = await res.json();
      return { ok: true, status: json.status, round2: json.round2 || null };
```

`generateNextRound` のコメントに `finalistCount`（決戦に入った人数）を足す。

- [ ] **Step 5: テストが通るのを確認** — ここで A1 で控えた `api.js` の節の失敗も消えること。

- [ ] **Step 6: commit**

```bash
git commit -m "feat: 一巡目の終了で二巡目を生成し、決戦の遷移を拒否条件で守る" -- server/index.js api.js test.html
```

**完了条件:** `round1 → round1_done` が二巡目を作り、`round2 → round2_done` は決戦があれば 409、`round2 → round2_final` は決戦が無ければ 409。既存テストが全部通る。

---

## Task A6: 順位の応答に `finale`（決戦の暫定順位）を足す

**Files:**
- Modify: `server/index.js`（`computeRanking` のあたり）
- Modify: `test.html`（`api.js` の節）

- [ ] **Step 1: 落ちるテストを書く**

```js
    // ---- 決戦の暫定順位（ranking の finale。設計書 2026-09-22） ----
    var flEvent = await makeGenEvent('決戦順位',
      'G1,A-男子-1-1,真,,,42,,,1    \nG2,A-男子-1-2,真,,,30,,,1    \n' +
      'G3,A-男子-1-3,真,,,20,,,1    \nG4,A-女子-1-1,真,,,50,,○,1    \n');
    await toRound1Done(flEvent.id);
    await Api.changeStatus(flEvent.id, 'round2');
    await Api.changeStatus(flEvent.id, 'round2_final');
    var flRank = await Api.loadRanking(flEvent.id);
    assert('finale.court は決戦コートの名前', flRank.finale.court, '決戦');
    assert('finale.status は今の状態', flRank.finale.status, 'round2_final');
    assert('finale.rows は試技順（番号順）で得点の低い選手が先',
      flRank.finale.rows.map(function(r) { return [r.name, r.order, r.r1, r.r2, r.total, r.scored, r.rank]; }),
      [['G3', 1, 20, null, 20, false, null],
       ['G2', 2, 30, null, 30, false, null],
       ['G1', 3, 42, null, 42, false, null]]);

    // 1人だけ斬る → その人だけ暫定1位
    var flRows = (await Api.loadEvent(flEvent.id)).players
      .filter(function(p) { return p.finalist === true; }).sort(Courts.compareOrder);
    await Api.updatePlayer(flEvent.id, flRows[0].id, { score: 30, result: '1    ' });
    var flRank2 = await Api.loadRanking(flEvent.id);
    assert('斬った人だけ合計と暫定順位が埋まる',
      flRank2.finale.rows.map(function(r) { return [r.name, r.r2, r.total, r.scored, r.rank]; }),
      [['G3', 30, 50, true, 1], ['G2', null, 30, false, null], ['G1', null, 42, false, null]]);

    // 同点は同順位（1, 1, 3）
    await Api.updatePlayer(flEvent.id, flRows[1].id, { score: 20, result: '1    ' });
    await Api.updatePlayer(flEvent.id, flRows[2].id, { score: 8, result: '1    ' });
    var flRank3 = await Api.loadRanking(flEvent.id);
    assert('同点は同順位（50, 50, 50 なら全員1位）',
      flRank3.finale.rows.map(function(r) { return [r.name, r.total, r.rank]; }),
      [['G3', 50, 1], ['G2', 50, 1], ['G1', 50, 1]]);

    // 共有リンク越しでも同じ形で読める
    var flLink = await Api.createShareLink(flEvent.id);
    var flShared = await Api.loadSharedRanking(flLink.token);
    assert('共有リンクの ranking にも finale が入る',
      flShared.finale.rows.map(function(r) { return r.name; }), ['G3', 'G2', 'G1']);
    await Api.deleteEvent(flEvent.id);

    // 決戦の行が無い大会は null
    var flNone = await makeGenEvent('決戦なし順位', 'H1,A-女子-1-1,真,,,30,,○,1    \n');
    assert('決戦の行が無ければ finale は null', (await Api.loadRanking(flNone.id)).finale, null);
    await Api.deleteEvent(flNone.id);
```

- [ ] **Step 2: 落ちるのを確認**

- [ ] **Step 3: `server/index.js` を実装する**

`computeRanking` の**前**に足す。

```js
// 決戦（暫定ベスト8）の表。決戦の行が無ければ null（設計書 2026-09-22）。
// rows は試技順（決戦コートの番号順）。r1 は一巡目の得点（sourcePlayerId で引く）、
// r2 は斬った人だけ（未採点は null）、rank も斬った人だけの中での暫定順位
// （合計降順・同点同順位。1, 1, 3）。
// ○×の生データ（result）は返さない（共有リンクから無認証で読まれるため）。
function computeFinale(event) {
  const players = ((event && event.players) || []);
  const finalRows = EventStatus.finalists(players);
  if (finalRows.length === 0) return null;

  const byId = Object.create(null);
  players.forEach(p => { if (p && typeof p.id === 'string') byId[p.id] = p; });
  const numberOf = p => {
    const parsed = parseOrder(p && p.order);
    return parsed ? parsed.number : 0;
  };

  const rows = finalRows.slice()
    .sort((a, b) => numberOf(a) - numberOf(b))
    .map(p => {
      const srcRow = (p.sourcePlayerId && Object.prototype.hasOwnProperty.call(byId, p.sourcePlayerId))
        ? byId[p.sourcePlayerId] : null;
      const r1 = (srcRow && typeof srcRow.score === 'number') ? srcRow.score : 0;
      const scored = EventStatus.isScored(p);
      const r2 = scored ? ((typeof p.score === 'number') ? p.score : 0) : null;
      return {
        name: String(p.name || '').trim(),
        order: numberOf(p),
        r1: r1,
        r2: r2,
        total: r1 + (r2 === null ? 0 : r2),
        scored: scored,
        rank: null
      };
    });

  // 暫定順位は斬った人だけで付ける。rows の要素をそのまま並べ替えて書き込む。
  const done = rows.filter(r => r.scored).sort((a, b) => b.total - a.total || a.order - b.order);
  let current = 1;
  let prevTotal = null;
  done.forEach((r, i) => {
    if (prevTotal !== null && r.total !== prevTotal) current = i + 1;
    prevTotal = r.total;
    r.rank = current;
  });

  return {
    court: EventStatus.finalCourtOf(event),
    status: EventStatus.of(event),
    rows: rows
  };
}
```

`computeRanking` の戻り値に足す。

```js
  return {
    event: { … },
    rankings: { male: rank(male), female: rank(female), newFace: rank(newFace) },
    // 決戦（暫定ベスト8）の表。決戦の行が無ければ null。
    // 順位の集計（rankings）は変えない（氏名で合算、一般男子／新人／一般女子）。
    finale: computeFinale(event)
  };
```

- [ ] **Step 4: テストが通るのを確認**

- [ ] **Step 5: commit**

```bash
git commit -m "feat: 順位の応答に決戦の暫定順位（finale）を足す" -- server/index.js test.html
```

**完了条件:** `GET /api/events/:id/ranking` と `GET /api/links/:token/ranking` の両方に `finale` が入り、試技順・`scored`・同点同順位・決戦なしで null がテストで固定されている。

---

# トラック B（A の完了後。C と並行）

> B は PC・スマホの運営画面。C（採点画面・配信・発表・共有・ヘルプ）とは触るファイルが重ならないので**並行してよい**。B の中では B2（`desk-match.js` / `desk.css`）と B3（`admin-round.js` / `admin.css`）も互いに別ファイルなので並行できる。

## Task B1: PC 運営の段階表示に「決戦 進行中」を足す

**Files:**
- Modify: `desk.js:24`（`STAGE_STEPS`）、`desk.js:316-340`（`buildStage` の戻す／次へ進む）

- [ ] **Step 1: `STAGE_STEPS` に足す**

```js
  // 上部に並べる段階。archived は並べない（アーカイブは final の「次へ進む」で、
  // 戻すときは prev が final を返す）。決戦（round2_final）も1段として並べる。
  var STAGE_STEPS = ['draft', 'round1', 'round1_done', 'round2', 'round2_final', 'round2_done', 'final'];
```

- [ ] **Step 2: 「次へ進む」を `nextStep` / `nextLabel` に置き換える**

`buildStage` の中の `var nx = EventStatus.next(st);` を次のように直す。

```js
    // 「次へ進む」の行き先は選手データで変わる（二巡目 進行中は、決戦の行があれば
    // 決戦へ、無ければ二巡目終了へ）。ラベルも同じ判定で決める。
    var nx = EventStatus.nextStep(st, players);
    if (nx) {
      var btnNext = document.createElement('button');
      btnNext.type = 'button';
      btnNext.className = 'desk-btn primary';
      btnNext.id = 'btnDeskNext';
      btnNext.textContent = EventStatus.nextLabel(st, players) + ' ▶';
      btnNext.addEventListener('click', function() { applyStatus(st, nx); });
      actions.appendChild(btnNext);
    }
```

- [ ] **Step 3: `applyStatus` の失敗の読み直し条件に新しい reason を足す**

```js
    if (!res.ok) {
      alert(res.error);
      // 他の端末が先に進めていたときだけ読み直す。
      // finale_pending / no_finale はこちらの画面が古い（決戦の行の有無を取り違えている）
      // 可能性があるので、これも読み直す。empty / no_round2 は入力不足なので読み直さない。
      if (res.reason === 'transition' || res.reason === 'finale_pending' ||
          res.reason === 'no_finale') {
        await reloadEvent();
      }
      return;
    }
```

- [ ] **Step 4: 一巡目の終了のトーストに生成の件数を出す**

```js
    toast(EventStatus.LABELS[to] + ' にしました');
    if (res.round2) {
      toast('二巡目を ' + res.round2.created + ' 名分作りました' +
        (res.round2.finalistCount > 0 ? '（決戦 ' + res.round2.finalistCount + ' 名）' : ''));
    }
    if (from === 'draft' && to === 'round1') openScoring(eventId, '');
    // 一巡目を終了したら、形を直す画面（試合進行）へ自動で移る（設計書の決定）
    if (from === 'round1' && to === 'round1_done') navigate('match', eventId);
    await reloadEvent();
```

> `toast` を 2 回続けて呼ぶと後のほうしか見えない実装かもしれない。`desk.js` の `toast` を読んで、1 回の呼び出しにまとめるか、文言を連結すること。

- [ ] **Step 5: ブラウザで確認**

`PORT=3461 node server/index.js` → `http://localhost:3461/desk.html` を開く。
- 上部の帯が **7 段**（準備中・一巡目 進行中・二巡目準備（形の登録）・二巡目 進行中・決戦 進行中・二巡目終了・最終結果）になっている。
- 1280px で帯が横にはみ出さない（はみ出すなら B2 で `desk.css` を直す）。
- 二巡目 進行中の大会で「決戦を開始 ▶」が出る。決戦のいない大会（女子だけ）では「二巡目を終了 ▶」が出る。

- [ ] **Step 6: commit**

```bash
git commit -m "feat: PC 運営の段階表示に決戦を足し、次へ進むを nextStep に寄せる" -- desk.js
```

**完了条件:** 帯が 7 段になり、二巡目 進行中の「次へ進む」が決戦の有無で切り替わる。

---

## Task B2: PC の試合進行を「二巡目の形登録」と決戦の区画に作り替える

**Files:**
- Modify: `desk-match.js`
- Modify: `desk.css`

- [ ] **Step 1: 「二巡目を生成」と「全員に一巡目と同じ技をコピー」を撤去する**

`buildRound2` の `if (editable) { … }` の中にある `btnGen`（`btnMatchGenRound2`）と `btnAll`（`btnMatchCopyAll`）の生成をまとめて消す。あわせて次も消す:
- `onGenerate` 関数まるごと（現状 596-636 行）
- `setCopyAllButton` 関数と `onCopyAll` 関数
- `updateCount` の中の `btnMatchCopyAll` を触る部分
- 空メッセージの「「二巡目を生成」を押してください」を「二巡目の選手はいません。上部の「◀ 一巡目 進行中 に戻す」で一巡目に戻ると作り直せます。」に変える

> **行ごとの「一巡目と同じ技をコピー」は残す**（`onCopyRow` / `sourceOf`）。ただしボタンの文言を「一巡目と同じ形に戻す」に変える（初期値が複製済みなので「コピー」ではなく「戻す」）。

- [ ] **Step 2: 見出しと注記を状態ごとに変える**

`buildRound2` の見出しを直す。

```js
    var head = document.createElement('div');
    head.className = 'desk-section-head';
    var h2 = document.createElement('h2');
    // 形を直す段階（round1_done）だけ「二巡目の形登録」。それ以外は「二巡目」。
    h2.textContent = editable ? '二巡目の形登録' : '二巡目';
    head.appendChild(h2);
    wrap.appendChild(head);

    if (editable) {
      var guide = document.createElement('p');
      guide.className = 'desk-note';
      guide.id = 'matchRound2Guide';
      guide.textContent = '一巡目の形を初期値にしています。自己申告があれば直してください。' +
        '試技順は一巡目の得点が低い順です。';
      wrap.appendChild(guide);
    } else {
      var note = document.createElement('p');
      note.className = 'desk-note';
      note.textContent = '形を直せるのは「' + EventStatus.LABELS.round1_done + '」のときだけです（いまは「' +
        EventStatus.LABELS[st] + '」）。直すときは上部の「戻す」で戻してください。';
      wrap.appendChild(note);
    }
```

- [ ] **Step 3: 決戦コートの区画を別に出す**

`buildRound2` の表を作るところを、決戦とそれ以外の 2 つの表に分ける。

```js
  // 二巡目の表を1つ作る（決戦とそれ以外で同じ作り）。
  function buildRound2Table(rows, ctx, editable, techniques) {
    var table = document.createElement('table');
    table.className = 'desk-table desk-match-table';
    table.innerHTML =
      '<thead><tr><th>巡</th><th>No.</th><th>名前</th><th>一巡目</th>' +
      '<th>技1</th><th>技2</th><th>技3</th>' + (editable ? '<th></th>' : '') + '</tr></thead>';
    var tbody = document.createElement('tbody');
    rows.forEach(function(p) { tbody.appendChild(buildRow(p, ctx, editable, techniques)); });
    table.appendChild(tbody);
    return table;
  }
```

`buildRound2` の中で:

```js
    var finalRows = Courts.finalists(ctx.players);
    var plainRows = rows.filter(function(p) { return p.finalist !== true; });

    // 決戦以外（元のコートで先に斬る）
    wrap.appendChild(buildRound2Table(plainRows, ctx, editable, techniques));

    // 決戦の区画（暫定ベスト8）。0 名なら節ごと出さない。
    if (finalRows.length > 0) {
      var finHead = document.createElement('div');
      finHead.className = 'desk-section-head';
      var finH2 = document.createElement('h2');
      finH2.textContent = '決戦（暫定ベスト8）';
      finHead.appendChild(finH2);
      wrap.appendChild(finHead);

      var finNote = document.createElement('p');
      finNote.className = 'desk-note';
      finNote.id = 'matchFinaleNote';
      finNote.textContent = '暫定ベスト8（一般男子・一巡目の得点上位）。決戦コート「' +
        Courts.finalCourtOf(ctx.event) + '」で最後に斬ります。';
      wrap.appendChild(finNote);

      var finWrap = document.createElement('div');
      finWrap.className = 'desk-match-finale';
      finWrap.appendChild(buildRound2Table(finalRows, ctx, editable, techniques));
      wrap.appendChild(finWrap);
    }
```

- [ ] **Step 4: コート別カードで決戦コートを別枠にする**

`buildCourts` で、決戦コートのカードだけを分ける。

```js
  function buildCourts(st, ctx) {
    var wrap = document.createElement('div');
    var round = Courts.progressRound(st, ctx.players);
    var finalCourt = Courts.finalCourtOf(ctx.event);
    var hasFinale = Courts.finalists(ctx.players).length > 0;
    …（注記はそのまま）…
    var rows = courtCards(ctx, round);
    var plain = rows.filter(function(r) { return !hasFinale || r.court !== finalCourt; });
    var finale = rows.filter(function(r) { return hasFinale && r.court === finalCourt; });

    // 決戦 進行中は決戦のカードを先に、他コートは畳む（設計書「画面」）。
    if (st === 'round2_final' && finale.length > 0) {
      wrap.appendChild(buildCourtGrid(finale, ctx, round, '決戦'));
      var others = document.createElement('details');
      others.className = 'desk-match-others';
      var sum = document.createElement('summary');
      sum.textContent = '他のコート（' + plain.length + '）';
      others.appendChild(sum);
      others.appendChild(buildCourtGrid(plain, ctx, round, ''));
      wrap.appendChild(others);
      return wrap;
    }
    wrap.appendChild(buildCourtGrid(plain, ctx, round, ''));
    if (finale.length > 0) {
      // 二巡目 進行中は「決戦（開始前）」として別枠に置く。
      wrap.appendChild(buildCourtGrid(finale, ctx, round,
        st === 'round2' ? '決戦（開始前）' : '決戦'));
    }
    return wrap;
  }
```

`buildCourtGrid(rows, ctx, round, caption)` は、既存の「空メッセージ＋`desk-match-courts` のグリッド」を切り出した関数にする。`caption` が空でなければ `<h3 class="desk-match-caption">` を先頭に置く。

- [ ] **Step 5: 決戦 進行中は暫定順位の表を出す**

`render` の末尾に足す。`Api.loadRanking` は非同期なので、`await` の後に `ctx.isStale()` を見ること。

```js
  // 決戦 進行中のときだけ、コートのカードの下に暫定順位を出す。
  // 順位はサーバーが計算する（computeRanking の finale）。ポーリングはしない
  // （「↻ 最新に更新」で読み直す、というこの区画の方針を変えない）。
  async function renderFinaleTable(container, ctx) {
    var box = document.createElement('div');
    box.className = 'desk-match-finale-rank';
    box.textContent = '読み込み中…';
    container.appendChild(box);
    var data = await Api.loadRanking(ctx.eventId);
    if (ctx.isStale()) return;   // 通信中に区画や大会を切り替えられた
    if (!data || !data.finale) { box.textContent = '暫定順位を取得できませんでした。'; return; }
    box.textContent = '';
    var h3 = document.createElement('h3');
    h3.className = 'desk-match-caption';
    h3.textContent = '決戦の暫定順位';
    box.appendChild(h3);
    var table = document.createElement('table');
    table.className = 'desk-table';
    table.innerHTML = '<thead><tr><th>試技順</th><th>名前</th><th>一巡目</th><th>二巡目</th>' +
      '<th>合計</th><th>暫定順位</th></tr></thead>';
    var tbody = document.createElement('tbody');
    data.finale.rows.forEach(function(r) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(String(r.order), 'num'));
      tr.appendChild(cell(r.name, 'desk-cell-main'));
      tr.appendChild(cell(String(r.r1), 'num'));
      tr.appendChild(cell(r.r2 === null ? '—' : String(r.r2), 'num'));
      tr.appendChild(cell(r.scored ? String(r.total) : '—', 'num'));
      tr.appendChild(cell(r.rank === null ? '—' : String(r.rank), 'num'));
      if (!r.scored) tr.className = 'is-pending';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    box.appendChild(table);
  }
```

`render` から `if (st === 'round2_final') renderFinaleTable(container, ctx);` で呼ぶ（`render` 自体は同期のままにし、結果は後から差し込む）。

- [ ] **Step 6: `desk.css` を足す**

`theme.css` の変数だけを使う。

```css
/* 決戦（暫定ベスト8）の区画。金の細い枠で他のコートと区別する */
.desk-match-finale,
.desk-match-finale-rank {
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 8px;
  margin-top: 8px;
}
.desk-match-caption {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--accent);
}
.desk-match-others > summary { cursor: pointer; color: var(--text-muted); margin-top: 8px; }
.desk-match-finale-rank tr.is-pending { color: var(--text-muted); }
/* 段階が7段になったので、狭い幅では折り返す */
.desk-stage-steps { flex-wrap: wrap; }
```

> `theme.css` を開いて、`--accent` `--text-muted` `--bg-secondary` の実際の変数名を確かめてから書くこと。

- [ ] **Step 7: ブラウザで確認**

- 「一巡目を終了」を押すと試合進行に移り、見出しが「二巡目の形登録」、注記が出て、**技が複製済み**になっている。
- 「決戦（暫定ベスト8）」の区画に 8 名（決戦コート名つきの注記）が試技順で並ぶ。
- 「二巡目を生成」「全員に一巡目と同じ技をコピー」のボタンが**無い**。
- 二巡目 進行中で決戦コートのカードが「決戦（開始前）」の枠に入る。
- 決戦 進行中で決戦のカードが先頭に出て、他コートが畳まれ、暫定順位の表が出る。
- 375px / 768px / 1280px、ライト／ダークで崩れない。

- [ ] **Step 8: commit**

```bash
git commit -m "feat: PC の試合進行を二巡目の形登録と決戦の区画に作り替える" -- desk-match.js desk.css
```

**完了条件:** 生成ボタンと全員コピーが消え、形登録の見出し・注記・決戦の区画・決戦 進行中の暫定順位が出る。

---

## Task B3: スマホの試合進行を同じ形に合わせる

**Files:**
- Modify: `admin-round.js`
- Modify: `admin.css`

- [ ] **Step 1: 「二巡目を生成」を撤去する**

`render` の中の `genBtn`（`btnGenRound2`）の生成と `onGenerate` 関数（現状 432-468 行）をまるごと消す。`renderList` の空メッセージも「二巡目の選手はまだいません。「二巡目を生成」を押してください。」から「二巡目の選手はいません。上部の ⋯ から一巡目に戻ると作り直せます。」に変える。

- [ ] **Step 2: 見出し・注記を PC と揃える**

```js
    editable = (st === 'round1_done');
    var guide = document.createElement('p');
    guide.className = 'round-note';
    if (editable) {
      guide.textContent = '二巡目の形登録。一巡目の形を初期値にしています。' +
        '自己申告があれば直してください。試技順は一巡目の得点が低い順です。';
    } else {
      guide.textContent = '形を直せるのは「' + EventStatus.LABELS.round1_done + '」のときだけです（いまは「' +
        EventStatus.LABELS[st] + '」）。直すときは ⋯ の「戻す」で戻してください。';
    }
    container.appendChild(guide);
```

- [ ] **Step 3: 「次へ進む」を `nextStep` / `nextLabel` にする**

`buildStage(st)` が `players` を受け取れるよう `buildStage(st, players)` に変え、呼び出しも直す。

```js
    var next = EventStatus.nextStep(st, players);
    if (next) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'round-next';
      btn.id = 'btnRoundNext';
      btn.textContent = EventStatus.nextLabel(st, players) + ' ▶';
      btn.addEventListener('click', function() { applyStatus(st, next); });
      wrap.appendChild(btn);
    }
```

`applyStatus` の失敗時の読み直し条件と、一巡目終了のトースト・自動遷移を B1 と同じ規則で足す。

```js
    if (!res.ok) {
      alert(res.error);
      if (res.reason === 'transition' || res.reason === 'finale_pending' ||
          res.reason === 'no_finale') {
        await Admin.reloadEvent();
      }
      return;
    }
    Admin.toast(EventStatus.LABELS[to] + ' にしました' +
      (res.round2 ? '（二巡目 ' + res.round2.created + ' 名／決戦 ' + res.round2.finalistCount + ' 名）' : ''));
    // 一巡目を終了したら形を直す画面（進行タブ）へ。スマホは既にこのタブなので
    // 大会を読み直すだけでよい（PC は #match へ移る）。
    await Admin.reloadEvent();
```

- [ ] **Step 4: 決戦の区画を出す**

`renderList` を、決戦以外 → 決戦の 2 段に分ける。

```js
  function renderList() {
    listEl.innerHTML = '';
    var rows = visibleRows();
    if (rows.length === 0) {
      var p = document.createElement('p');
      p.className = 'round-empty';
      p.textContent = '二巡目の選手はいません。上部の ⋯ から一巡目に戻ると作り直せます。';
      listEl.appendChild(p);
    } else {
      var plain = rows.filter(function(r) { return r.finalist !== true; });
      var fin = rows.filter(function(r) { return r.finalist === true; });
      plain.forEach(function(r) { listEl.appendChild(buildRow(r)); });
      if (fin.length > 0) {
        var cap = document.createElement('div');
        cap.className = 'round-finale-caption';
        cap.textContent = '決戦（暫定ベスト8）　決戦コート「' +
          Courts.finalCourtOf(CTX && CTX.event) + '」で最後に斬ります';
        listEl.appendChild(cap);
        var box = document.createElement('div');
        box.className = 'round-finale';
        fin.forEach(function(r) { box.appendChild(buildRow(r)); });
        listEl.appendChild(box);
      }
    }
    updateCounter();
  }
```

行ごとのボタンの文言を「一巡目と同じ技をコピー」から「一巡目と同じ形に戻す」に変える（PC と揃える）。

- [ ] **Step 5: `admin.css` を足す**

```css
.round-finale { border: 1px solid var(--accent); border-radius: 8px; padding: 6px; }
.round-finale-caption { margin: 12px 0 6px; font-size: 13px; color: var(--accent); }
```

- [ ] **Step 6: ブラウザで確認（375px）**

`http://localhost:3461/admin.html#round/<大会ID>` を開く。
- 「二巡目を生成」が無い。
- 「二巡目の形登録」の注記が出て、行の形が複製済み。
- 決戦の区画が下に出る。
- 二巡目 進行中で「決戦を開始 ▶」が出る。決戦のいない大会では「二巡目を終了 ▶」。
- ダークでも枠の金が沈まない。

- [ ] **Step 7: commit**

```bash
git commit -m "feat: スマホの試合進行を二巡目の形登録と決戦の区画に合わせる" -- admin-round.js admin.css
```

**完了条件:** スマホでも生成ボタンが無く、形登録の注記と決戦の区画が出る。

---

## Task B4: 選手登録に「いまは形登録の段階です」の案内と巡目の既定を足す

**Files:**
- Modify: `desk-players.js`（`render` の先頭。現状 97-120 行）
- Modify: `admin-players.js`（`render` の先頭。現状 54-65 行）

- [ ] **Step 1: `desk-players.js` に足す**

状態が `round1_done` で二巡目の行があるとき、絞り込みの初期値を巡目 2 にする。

```js
    if (stateOwner !== ctx.eventId) {
      filter = newFilter();
      // 二巡目準備（形の登録）の段階で開いたら、見たいのは二巡目の行。
      // 大会を切り替えたときの初期値だけで、運営者が自分で変えた絞り込みは上書きしない。
      if (EventStatus.of(ctx.event) === 'round1_done' &&
          Courts.roundsOf(ctx.players).indexOf(2) !== -1) {
        filter.round = 2;
      }
      sort = Courts.defaultSort();
      draft = null;
      stateOwner = ctx.eventId;
    }
```

見出しの下に案内を足す。

```js
    // 二巡目準備の段階は、やることが「形を直す」なので試合進行へ誘導する。
    if (EventStatus.of(ctx.event) === 'round1_done') {
      var guide = document.createElement('p');
      guide.className = 'desk-note';
      guide.id = 'playersRound1DoneGuide';
      guide.appendChild(document.createTextNode('いまは二巡目の形登録の段階です。'));
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'desk-btn-sub';
      go.textContent = '試合進行へ →';
      go.addEventListener('click', function() { Desk.navigate('match', ctx.eventId); });
      guide.appendChild(go);
      container.appendChild(guide);
    }
```

- [ ] **Step 2: `admin-players.js` に同じものを足す**

初期値は同じ規則。案内は `Admin.navigate('round', ctx.eventId)` に飛ばす。クラスは `field-note`（スマホ側の注記のクラス）を使う。

- [ ] **Step 3: ブラウザで確認**

- 「一巡目を終了」の直後に選手登録を開くと、巡目の絞り込みが二巡目になっていて、上に案内と「試合進行へ →」が出る。
- 絞り込みを一巡目に変えてタブを行き来しても、勝手に二巡目へ戻らない（同じ大会の間は保つ）。
- 二巡目 進行中・準備中では案内が出ない。

- [ ] **Step 4: commit**

```bash
git commit -m "feat: 選手登録に二巡目の形登録の案内と巡目の既定を足す" -- desk-players.js admin-players.js
```

**完了条件:** `round1_done` のときだけ案内が出て、巡目の絞り込みが 2 で開く。

---

## Task B5: 基本情報に「決戦コートの名前」を足す

**Files:**
- Modify: `desk-setup.js`
- Modify: `admin.js`（`openEventInfoSheet`）

- [ ] **Step 1: `desk-setup.js` に入力を足す**

コートの節（`courtNote` の下、チップの上）に入れる。

```js
    // 決戦コートの名前（settings.finalCourt）。空欄なら既定の「決戦」。
    // 一覧のコート（settings.courts）とは別に持つ（設計書「データ」）。
    var finalWrap = document.createElement('div');
    finalWrap.className = 'desk-form';
    var inFinal = addField(finalWrap, '決戦コートの名前', 'text');
    inFinal.id = 'setupFinalCourt';
    inFinal.placeholder = EventStatus.finalCourtOf({});   // '決戦'
    inFinal.value = (typeof settings.finalCourt === 'string') ? settings.finalCourt : '';
    inFinal.disabled = locked;
    container.appendChild(finalWrap);

    var finalNote = document.createElement('p');
    finalNote.className = 'desk-note';
    finalNote.textContent = '一巡目を終了したときに、暫定ベスト8（一般男子・一巡目の得点上位）を' +
      'このコートへ移します。空欄なら「' + EventStatus.finalCourtOf({}) + '」になります。' +
      '名前の規則は他のコートと同じです（「-」と「未分類」は使えません）。';
    container.appendChild(finalNote);
```

`saveInfo` の `settings` に足す。

```js
        settings: {
          requireBib: chkBib.checked,
          requireRank: chkRank.checked,
          courts: extra.slice(),
          // 空欄は「既定（決戦）に戻す」意味。サーバーがキーごと落とす。
          finalCourt: inFinal.value.trim()
        }
```

保存の前に、他のコートと衝突しないかだけ見る（サーバーも名前の規則は見るが、文言をここで出す）。

```js
      var finalName = inFinal.value.trim();
      if (finalName) {
        var finalErr = Courts.validateCourtList([finalName]);
        if (finalErr) { alert(finalErr); return; }
      }
```

- [ ] **Step 2: `admin.js` の基本情報シートに同じものを足す**

`chkRank` の下（コート一覧の節の前）に `addField('決戦コートの名前', 'text')` で 1 行足し、注記は `field-note` クラスで同じ文言。保存の `settings` にも `finalCourt` を足す。

- [ ] **Step 3: ブラウザで確認**

- PC の基本情報で「決戦コートの名前」に「決勝」と入れて保存 → 読み直しても残る。
- 空欄にして保存 → プレースホルダが「決戦」に戻る。
- 「A-B」を入れて保存 → 「コート名「A-B」は使えません」が出て保存されない。
- スマホの ⋯ →「📝 基本情報」でも同じ。

- [ ] **Step 4: commit**

```bash
git commit -m "feat: 基本情報に決戦コートの名前を足す" -- desk-setup.js admin.js
```

**完了条件:** PC・スマホの両方から決戦コート名を変えられ、生成がその名前を使う。

---

## Task B6: トップの流れの帯を 8 段階にする

**Files:**
- Modify: `home.js`（`FLOW_CAPTIONS` / `renderFlow`）
- Test: `test.html`（`home.js` の節）

- [ ] **Step 1: 落ちるテストを書く**

```js
    assert('statusRank: 決戦 進行中は採点できる群（0）', Home.statusRank('round2_final'), 0);
```

> `Home.statusRank` が公開されていなければ、代わりに `EventStatus.isScoringOpen('round2_final')` が true であることを A1 で固定済みなので、このテストは省いてよい。`home.js` の `return { … }` を読んで判断すること。

- [ ] **Step 2: `home.js` を直す**

```js
  var FLOW_CAPTIONS = {
    draft: '大会を作る・選手登録',
    round1: 'コート端末で採点',
    round1_done: '二巡目の形を確かめる',
    round2: 'コート端末で採点',
    round2_final: '暫定ベスト8 が最後に斬る',
    round2_done: '順位を確認',
    final: '発表・共有',
    archived: '保管'
  };
```

`renderFlow` の aria-label を直す（`EventStatus.STATES.length` から出せば二重定義にならない）。

```js
    band.setAttribute('aria-label', '大会の状態（' + EventStatus.STATES.length + '段階）');
```

- [ ] **Step 3: ブラウザで確認**

`http://localhost:3461/index.html` を開き、「▸ このアプリについて」を展開。
- 帯が 8 段（準備中／一巡目 進行中／二巡目準備（形の登録）／二巡目 進行中／決戦 進行中／二巡目終了／最終結果／アーカイブ）。
- 375px で折り返して読める（崩れるなら `home.css` を直す）。
- 決戦 進行中の大会が一覧の先頭群（採点中）に並ぶ。

- [ ] **Step 4: commit**

```bash
git commit -m "feat: トップの流れの帯を8段階にする" -- home.js test.html
```

**完了条件:** 帯に「二巡目準備（形の登録）」と「決戦 進行中」が並ぶ。

---

# トラック C（A の完了後。B と並行）

> C1 / C4 / C5 は互いに別ファイルなので並行してよい。**C2 と C3 は両方 `test.html` を触るので直列に**進める（同時に触ると衝突する）。

## Task C1: 採点画面のバナーとコート制限

**Files:**
- Modify: `app.js`
- Modify: `style.css`

- [ ] **Step 1: 「このコートで採点してよいか」の判定を足す**

`currentStatus` / `scoringOpen` の近くに足す。

```js
  // いま開いている選手のコート。選手がいなければコート選択の値。
  function currentCourtName() {
    var p = visiblePlayers[currentIndex];
    return p ? Courts.courtOf(p) : currentCourt;
  }

  // いま開いている選手を採点してよいか。状態が採点できることに加えて、
  // 決戦のコート制限（EventStatus.scoringCourtFilter）も見る。
  //   二巡目 進行中 … 決戦コートは「決戦を開始」の後
  //   決戦 進行中   … 決戦コート以外は斬り終わっている
  function scoringOpenHere() {
    if (!scoringOpen()) return false;
    return EventStatus.isCourtScorable(currentStatus(), currentEvent, currentCourtName());
  }
```

- [ ] **Step 2: バナーに決戦の文言を足す**

`renderStatusBanner` の「採点できる状態」の分岐を直す。

```js
    if (EventStatus.isScoringOpen(st)) {
      if (!scoringOpenHere()) {
        // 状態は採点できるが、このコートは今は採点できない（決戦のコート制限）
        el.className = 'status-banner closed';
        el.textContent = (st === 'round2')
          ? '決戦コートは「決戦を開始」の後に採点します'
          : '決戦 進行中。採点できるのは決戦コートだけです';
        return;
      }
      el.className = 'status-banner open';
      el.textContent = EventStatus.LABELS[st];
      return;
    }
```

`selectPlayer` の末尾に `renderStatusBanner();` を足す（選手を切り替えるたびにバナーを見直す）。

- [ ] **Step 3: 入力のロックを `scoringOpenHere` に寄せる**

`applyScoringLock` の `var locked = !!currentEvent && !scoringOpen();` を `!scoringOpenHere()` に変える。あわせて、得点を書く経路の `if (!scoringOpen()) return;`（現状 1080 行・1182 行）と `confirmLeave` の `!scoringOpen()`（現状 549 行）も `scoringOpenHere()` に変える。

> `publishLive`（現状 878 行）の `scoringOpen()` は**変えない**。配信ボードへ「いまこの選手を開いている」と伝えるのは採点できるかどうかと別（決戦の前でも選手を眺められる）。

- [ ] **Step 4: 選手名バーに決戦の進みを出す**

`updatePlayerLabels(p)` の末尾に足す。

```js
    // 決戦 進行中は、決戦の何人目かを順番の右に添える（設計書「採点画面」）。
    if (currentStatus() === 'round2_final' && p.finalist === true) {
      var fin = Courts.finalists(players);
      var at = 0;
      for (var fi = 0; fi < fin.length; fi++) {
        if (fin[fi].id === p.id) { at = fi + 1; break; }
      }
      if (at > 0) {
        playerOrderLabel.textContent += '　決戦 ' + at + '/' + fin.length;
      }
    }
```

- [ ] **Step 5: `style.css` を確認**

`.status-banner.closed` は既に `--warn` 背景。決戦の注意文が 2 行になっても崩れないか見る。必要なら `line-height` だけ足す。**新しい色は作らない。**

- [ ] **Step 6: ブラウザで確認**

`http://localhost:3461/scoring.html#event/<大会ID>/`
- **二巡目 進行中**: コート選択に決戦コートが出る。決戦コートの選手を開くと一覧には出るが、バナーが「決戦コートは「決戦を開始」の後に採点します」になり、○×のボタンと補正点が押せない。A コートの選手に戻すとバナーが「二巡目 進行中」に戻り採点できる。
- **決戦 進行中**: A コートの選手でバナーが「決戦 進行中。採点できるのは決戦コートだけです」。決戦コートの選手でバナーが「決戦 進行中」になり、選手名バーの右に「決戦 3/8」が出る。
- 375px / 768px / 1280px、ライト／ダーク。

- [ ] **Step 7: commit**

```bash
git commit -m "feat: 採点画面に決戦のバナーとコート制限を足す" -- app.js style.css
```

**完了条件:** 二巡目と決戦でそれぞれ採点できるコートが切り替わり、バナーが理由を出す。

---

## Task C2: 配信ボードに決戦の暫定順位を出す

**Files:**
- Modify: `board.js`
- Modify: `board.html`
- Modify: `board.css`
- Test: `test.html`（`board.js` の節）

- [ ] **Step 1: 落ちるテストを書く**

`Board` の純粋関数として `finaleFor(data, court)` を足し、これをテストする。

```js
    // ---- 決戦の暫定順位（配信ボード） ----
    var bfData = { court: '決戦', status: 'round2_final', rows: [
      { name: 'A', order: 1, r1: 10, r2: 20, total: 30, scored: true, rank: 2 },
      { name: 'B', order: 2, r1: 40, r2: null, total: 40, scored: false, rank: null }
    ] };
    assert('Board.finaleFor: 決戦コートを映していれば行を返す',
      Board.finaleFor(bfData, '決戦').map(function(r) { return r.name; }), ['A', 'B']);
    assert('Board.finaleFor: 別のコートを映していれば空',
      Board.finaleFor(bfData, 'A'), []);
    assert('Board.finaleFor: finale が無ければ空', Board.finaleFor(null, '決戦'), []);
    assert('Board.finaleFor: コート未指定なら空', Board.finaleFor(bfData, ''), []);
```

- [ ] **Step 2: 落ちるのを確認**

- [ ] **Step 3: `board.html` に置き場所を足す**

`board-table-wrap` の後、`board-foot` の前に入れる。

```html
    <!-- 決戦（暫定ベスト8）の順位。決戦コートを映しているときだけ出す（board.js） -->
    <div class="board-finale is-hidden" id="boardFinale">
      <div class="board-finale-caption">決戦（暫定）</div>
      <table class="board-finale-table">
        <thead>
          <tr><th>順</th><th>名前</th><th class="c-num">一巡目</th><th class="c-num">二巡目</th><th class="c-num">合計</th></tr>
        </thead>
        <tbody id="boardFinaleBody"></tbody>
      </table>
    </div>
```

- [ ] **Step 4: `board.js` を実装する**

純粋関数（`parseHash` の近く）:

```js
  // 決戦の表に出す行。決戦コートを映しているときだけ返す。
  // finale は GET /api/links/:token/ranking の応答（サーバーが計算した暫定順位）。
  // board.html は status.js を読まない（無認証で配信するページ）ので、
  // 状態の判定はサーバーが入れた finale.status / finale.court に任せる。
  function finaleFor(finale, court) {
    if (!finale || !court) return [];
    if (finale.court !== court) return [];
    return Array.isArray(finale.rows) ? finale.rows : [];
  }
```

取得と描画:

```js
  var FINALE_REFRESH_MS = 10000;   // 順位は2秒ごとに要らない。10秒でじゅうぶん
  var finaleTimer = null;
  var finaleSeq = 0;

  async function pollFinale() {
    var mySeq = ++finaleSeq;
    var result = await Api.fetchSharedRanking(token);
    if (mySeq !== finaleSeq) return;          // 追い越された
    if (!result.ok) return;                   // 失敗は前の表をそのまま残す
    renderFinale(finaleFor(result.data.finale, court));
  }

  function renderFinale(rows) {
    if (rows.length === 0) {
      el.finale.classList.add('is-hidden');
      el.finaleBody.textContent = '';
      return;
    }
    el.finale.classList.remove('is-hidden');
    el.finaleBody.textContent = '';
    rows.forEach(function(r) {
      var tr = document.createElement('tr');
      if (!r.scored) tr.className = 'pending';
      var rank = document.createElement('td');
      rank.className = 'rank';
      rank.textContent = r.rank === null ? '—' : String(r.rank);
      tr.appendChild(rank);
      var name = document.createElement('td');
      name.textContent = r.name;
      tr.appendChild(name);
      [String(r.r1), r.r2 === null ? '—' : String(r.r2), r.scored ? String(r.total) : '—']
        .forEach(function(v) {
          var td = document.createElement('td');
          td.className = 'num';
          td.textContent = v;
          tr.appendChild(td);
        });
      el.finaleBody.appendChild(tr);
    });
  }
```

`start()` で `pollFinale()` を 1 回呼び、`finaleTimer = setInterval(pollFinale, FINALE_REFRESH_MS);` を張る。`stopPolling()` と `showInvalid()` と `hashchange` で `clearInterval(finaleTimer)` と `finaleSeq++` を忘れないこと（`pollTimer` と同じ扱い）。`el` に `finale` / `finaleBody` を足す。エクスポートに `finaleFor` を足す。

- [ ] **Step 5: `board.css` を足す**

```css
.board-finale { margin-top: 12px; }
.board-finale.is-hidden { display: none; }
.board-finale-caption { color: var(--accent); font-size: 20px; margin-bottom: 4px; }
.board-finale-table { width: 100%; border-collapse: collapse; }
.board-finale-table th,
.board-finale-table td { padding: 2px 6px; }
.board-finale-table td.num,
.board-finale-table th.c-num { text-align: right; }
.board-finale-table td.rank { color: var(--accent); font-weight: bold; }
.board-finale-table tr.pending { color: var(--text-muted); }
```

> `board.css` の既存の変数名（`--accent` が使われているか）を必ず確かめる。無ければ `board.css` が使っている変数に合わせる。

- [ ] **Step 6: テストが通るのを確認**

- [ ] **Step 7: ブラウザで確認**

`http://localhost:3461/board.html#<トークン>/決戦` を開く。
- 決戦 進行中の大会で、いま斬っている選手の採点表の下に「決戦（暫定）」の表が出る。
- 斬った人は合計と順位、未の人は一巡目だけで「—」。
- `#<トークン>/A` に切り替えると表が消える。
- `?bg=transparent` でも読める。

- [ ] **Step 8: commit**

```bash
git commit -m "feat: 配信ボードに決戦の暫定順位を出す" -- board.js board.html board.css test.html
```

**完了条件:** 決戦コートを映しているときだけ暫定順位の表が出て、10 秒ごとに埋まっていく。

---

## Task C3: 発表モードに「決戦」を足す

**Files:**
- Modify: `present.js`
- Modify: `present.html`
- Modify: `present.css`
- Test: `test.html`（`present.js` の節）

> **C2 の commit が済んでから着手する**（両方 `test.html` を触る）。

- [ ] **Step 1: 落ちるテストを書く**

```js
    // ---- 発表モードの決戦 ----
    assert('Present.finaleRows: finale があれば試技順のまま返す',
      Present.finaleRows({ finale: { rows: [{ name: 'A', order: 1 }, { name: 'B', order: 2 }] } })
        .map(function(r) { return r.name; }), ['A', 'B']);
    assert('Present.finaleRows: finale が無ければ空', Present.finaleRows({ rankings: {} }), []);
    assert('Present.finaleRows: data が null でも空', Present.finaleRows(null), []);
    assert('Present.defaultMode: 決戦 進行中なら finale',
      Present.defaultMode({ finale: { status: 'round2_final', rows: [{ name: 'A' }] } }), 'finale');
    assert('Present.defaultMode: 決戦 進行中でなければ board',
      Present.defaultMode({ finale: { status: 'round2', rows: [{ name: 'A' }] } }), 'board');
    assert('Present.defaultMode: finale が無ければ board', Present.defaultMode({}), 'board');
```

- [ ] **Step 2: `present.html` にボタンを足す**

```html
      <div class="present-modes">
        <button id="btnModeBoard" class="on">掲示</button>
        <button id="btnModeReveal">発表</button>
        <button id="btnModeFinale">決戦</button>
      </div>
```

- [ ] **Step 3: `present.js` を実装する**

純粋関数（`revealOrder` の近く）:

```js
  // 決戦の行（サーバーが計算した暫定順位）。試技順のまま返す。
  function finaleRows(d) {
    if (!d || !d.finale || !Array.isArray(d.finale.rows)) return [];
    return d.finale.rows;
  }

  // 最初に開くモード。決戦 進行中なら決戦を出す（設計書「発表モード」）。
  function defaultMode(d) {
    if (d && d.finale && d.finale.status === 'round2_final' &&
        Array.isArray(d.finale.rows) && d.finale.rows.length > 0) return 'finale';
    return 'board';
  }
```

描画:

```js
  function renderFinale() {
    var rows = finaleRows(data);
    var h1 = document.createElement('h1');
    h1.className = 'present-title';
    h1.textContent = '決戦（暫定）';
    elScreen.appendChild(h1);

    if (rows.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'present-error';
      empty.textContent = '決戦はまだありません';
      elScreen.appendChild(empty);
      if (elHint) elHint.textContent = '';
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'present-list present-finale';
    rows.forEach(function(r) {
      var li = document.createElement('li');
      var cls = '';
      if (r.rank !== null && r.rank <= 3) cls = 'top';
      if (!r.scored) cls = (cls ? cls + ' ' : '') + 'pending';
      if (cls) li.className = cls;

      var rankEl = document.createElement('span');
      rankEl.className = 'present-rank';
      rankEl.textContent = r.rank === null ? String(r.order) + '番' : String(r.rank);
      li.appendChild(rankEl);

      var nameEl = document.createElement('span');
      nameEl.className = 'present-name';
      nameEl.textContent = r.name;
      li.appendChild(nameEl);

      var scoreEl = document.createElement('span');
      scoreEl.className = 'present-score';
      scoreEl.textContent = r.scored ? String(r.total) : '—';
      li.appendChild(scoreEl);

      ul.appendChild(li);
    });
    elScreen.appendChild(ul);
    if (elHint) elHint.textContent = '斬った人から合計と暫定順位が埋まります';
  }
```

`render()` の分岐に `if (mode === 'finale') { renderFinale(); return; }` を足す。
`setMode` に `finale` を足し、`elModeFinale` の `on` クラスを他と同じ規則で切り替える。
`startTimer` の `if (mode === 'board') load();` を `if (mode === 'board' || mode === 'finale') load();` に変える（決戦も 60 秒ごとに読み直す）。`visibilitychange` の `if (mode !== 'board') return;` も同じく決戦を通す。
`load()` の最初の成功時に `defaultMode` を使う。

```js
      // 最初の取得で決戦 進行中なら決戦モードで開く（設計書「発表モード」）。
      // 運営者が自分でモードを選んだ後は勝手に切り替えない。
      if (!modeChosen) {
        var want = defaultMode(data);
        if (want !== mode) setMode(want);
      }
```

`modeChosen` は各モードボタンの click ハンドラで `true` にし、`hashchange` で `false` に戻す。

エクスポートに `finaleRows` / `defaultMode` を足す。

- [ ] **Step 4: `present.css` を足す**

```css
.present-finale li.pending { color: var(--text-muted); }
.present-finale li.pending .present-rank { color: var(--text-muted); }
```

- [ ] **Step 5: テストが通るのを確認**

- [ ] **Step 6: ブラウザで確認**

`http://localhost:3461/present.html#<トークン>`
- 決戦 進行中の大会を開くと「決戦」モードで開く。
- 8 名が試技順に並び、斬った人から合計と暫定順位が埋まる（未は「n番」と「—」）。
- 「掲示」「発表」に切り替えて戻ってこられる。自分で選んだ後は 60 秒後の更新で勝手に決戦へ戻らない。
- 全画面表示で会場の大画面から読める大きさ。

- [ ] **Step 7: commit**

```bash
git commit -m "feat: 発表モードに決戦を足す" -- present.js present.html present.css test.html
```

**完了条件:** 決戦モードが 3 つ目のボタンとして出て、`round2_final` では既定で開く。

---

## Task C4: 共有ページに「決戦（暫定）」を足す

**Files:**
- Modify: `share.js`
- Modify: `share.css`

- [ ] **Step 1: `share.js` を実装する**

`renderBody` を直し、順位の上に決戦の節を置く。

```js
  // 決戦（暫定ベスト8）の表。finale が無ければ何も足さない。
  // 順位の上に出す（いま会場で進んでいるのは決戦なので、参加者が最初に見たいもの）。
  function renderFinale(finale) {
    if (!finale || !Array.isArray(finale.rows) || finale.rows.length === 0) return null;
    var section = document.createElement('section');
    section.className = 'share-section share-finale';

    var h2 = document.createElement('h2');
    h2.textContent = '決戦（暫定）';
    section.appendChild(h2);

    var ul = document.createElement('ul');
    ul.className = 'share-list';
    finale.rows.forEach(function(r) {
      var li = document.createElement('li');
      if (!r.scored) li.className = 'pending';

      var rankEl = document.createElement('span');
      rankEl.className = 'share-rank';
      rankEl.textContent = r.rank === null ? String(r.order) + '番' : String(r.rank);
      li.appendChild(rankEl);

      var nameEl = document.createElement('span');
      nameEl.className = 'share-name';
      nameEl.textContent = r.name;
      li.appendChild(nameEl);

      var scoreEl = document.createElement('span');
      scoreEl.className = 'share-score';
      scoreEl.textContent = r.scored ? String(r.total) : '—';
      li.appendChild(scoreEl);

      ul.appendChild(li);
    });
    section.appendChild(ul);
    return section;
  }
```

`renderBody(rankings)` を `renderBody(rankings, finale)` に変え、先頭で `var fin = renderFinale(finale); if (fin) elBody.appendChild(fin);` を呼ぶ。`refresh()` の呼び出しを `renderBody(result.data.rankings || {}, result.data.finale)` に直す。

- [ ] **Step 2: `share.css` を足す**

```css
.share-finale li.pending { color: var(--text-muted); }
.share-finale .share-rank { color: var(--accent); }
```

- [ ] **Step 3: ブラウザで確認（375px）**

`http://localhost:3461/share.html#<トークン>`
- 決戦の表が順位の上に出る。
- 決戦の無い大会では表ごと出ない。
- 60 秒ごとの更新で埋まっていく（`updatedAt` が変わったときだけ描き直す既存の規則のまま）。
- ダーク固定の黒金で読める。

- [ ] **Step 4: commit**

```bash
git commit -m "feat: 共有ページに決戦（暫定）の表を足す" -- share.js share.css
```

**完了条件:** `finale` があるときだけ順位の上に決戦の表が出る。

---

## Task C5: ヘルプを 8 段階と決戦に合わせる

**Files:**
- Modify: `help.html`

- [ ] **Step 1: 「0. 全体の流れ」の箇条書きを直す**

`<ol class="status-steps">` を 8 項目にする。

```html
    <ol class="status-steps">
      <li><span class="ui">準備中</span> — 技と配点・選手を自由に入れられます。採点はまだできません。</li>
      <li><span class="ui">一巡目 進行中</span> — コートの端末で一巡目を採点します。</li>
      <li><span class="ui">二巡目準備（形の登録）</span> — 一巡目を終了すると、二巡目の行が自動でできます（形は一巡目と同じ）。自己申告があった選手の形だけ直します。</li>
      <li><span class="ui">二巡目 進行中</span> — コートの端末で二巡目を採点します。暫定ベスト8（決戦）はまだ斬りません。</li>
      <li><span class="ui">決戦 進行中</span> — 暫定ベスト8 が決戦コートで1人ずつ斬ります。採点できるのは決戦コートだけです。</li>
      <li><span class="ui">二巡目終了</span> — 順位を確かめます。直したいことがあれば1つ前に戻せます。</li>
      <li><span class="ui">最終結果</span> — 得点・選手・技を編集できなくなります。発表・共有・ファイル保存はできます。</li>
      <li><span class="ui">アーカイブ</span> — 見るだけ。大会一覧の「アーカイブ」欄に移り、採点画面の選択肢から消えます。</li>
    </ol>
```

直下の `<div class="note">` に 1 文足す。

```html
    暫定ベスト8（一般男子・一巡目の得点の上位8名。8位が同点なら全員）がいない大会は、<span class="ui">二巡目 進行中</span> から直接 <span class="ui">二巡目を終了 ▶</span> に進めます。
```

「7 段階」と書いてある 2 箇所（現状 51 行のトップの説明、145 行の「図の各段が、上に並べた 7 つの状態です」）を「8 段階」「8 つの状態」に直す。

- [ ] **Step 2: 流れ図（SVG）に 1 段足す**

現状の箱の上端 Y は 6 / 80 / 154 / 228 / 302 / 376 / 450、矢印は「箱の Y に対して `y1=Y+55` `y2=Y+71`」という規則。1 段（74px）足して次のようにする。

| Y | 箱 | 副題 |
|---|---|---|
| 6 | 準備中 | 大会を作る・技と配点・選手（運営画面） |
| 80 | 一巡目 進行中 | 採点画面（コートの端末） |
| 154 | 二巡目準備（形の登録） | 形を確かめる・直す（運営画面） |
| 228 | 二巡目 進行中 | 採点画面（コートの端末） |
| 302 | **決戦 進行中**（新規） | 暫定ベスト8 が決戦コートで斬る |
| 376 | 二巡目終了 | 順位を確かめる（運営画面） |
| 450 | 最終結果（`d-box-key`） | 編集できなくなる。発表・共有 |
| 524 | アーカイブ | 見るだけ。一覧のアーカイブ欄へ |

- 矢印は Y = 6 / 80 / 154 / 228 / 302 / 376 / 450 の 7 本（`y1=Y+55` `y2=Y+71`）。**450 の後の 1 本は新規**。
- 区切り線 `y=524` → `y=598`、「端末の役割」の見出し `y=546` → `y=620`。
- 下の凡例の y をすべて +74（576→650、595→669、624→698、643→717、672→746、691→765）。
- `viewBox="0 0 360 698"` → `viewBox="0 0 360 772"`。
- `aria-label` を 8 段階の並びに書き換える。

- [ ] **Step 3: 「2. 採点の進行」を直す**

手順の `<ol start="2">`（現状 457-465 行）から「二巡目を生成」の項目を消し、次のように直す。

```html
      <li><span class="ui">一巡目を終了 ▶</span> — 全コートの採点が済んだら押します。<span class="term">押した時点で二巡目の行が自動でできます</span>（形は一巡目と同じ。暫定ベスト8 は決戦コートに移ります）。</li>
      <li><span class="term">形を直す</span> — <span class="ui">二巡目の形登録</span> の表で、自己申告があった選手の形だけ直します（下の節）。</li>
      <li><span class="ui">二巡目を開始 ▶</span> — <span class="ui">二巡目 進行中</span> になります。コートの端末で大会を選び直すと二巡目の選手が出ます。決戦コートはまだ採点できません。</li>
      <li><span class="ui">決戦を開始 ▶</span> — 決戦以外が全員斬り終わったら押します。<span class="ui">決戦 進行中</span> になり、採点できるのは決戦コートだけになります。</li>
      <li><span class="ui">二巡目を終了 ▶</span> — <span class="ui">結果確認</span> の区画で順位を確かめます。</li>
      <li><span class="ui">最終結果を確定 ▶</span> — 得点・選手・技を編集できなくなります。そのあと <span class="ui">アーカイブ ▶</span> で片づけます。</li>
```

「二巡目を作る」の節（現状 520-546 行）を「二巡目の形を直す」に書き換える。消すもの:
- 「状態が 一巡目終了 でないと 二巡目を生成 は押せません」の段落
- 「二巡目を生成 を押す。…確認で OK を押すと…」の手順
- 「未採点が残ったまま 二巡目を生成 を押すと…」の注記
- 「二巡目を生成できない」の見出し（現状 781 行、「5. 困ったとき」）→「二巡目ができていない」に変え、「一巡目を終了 ▶ を押すと自動でできます。できていなければ一巡目に戻してもう一度押してください」に書き換える

足すもの: 「決戦（暫定ベスト8）」の節。

```html
    <h3>決戦（暫定ベスト8）</h3>
    <p>一巡目を終了したとき、<span class="term">一般男子（新人を含む）の一巡目の得点の上位8名</span>を <span class="term">決戦</span> として専用のコートに移します。8位が同点のときは同点の全員が入ります。得点が0点の選手は入りません。一般女子は決戦には入りません。</p>
    <ul>
      <li>決戦コートの名前は <span class="ui">基本情報</span> の <span class="ui">決戦コートの名前</span> で変えられます（既定は <span class="ui">決戦</span>）。</li>
      <li>決戦の試技順は <span class="term">一巡目の得点が低い順</span>です（最後に斬るのが一巡目の1位）。</li>
      <li>決戦の1本で最終得点が決まります（3本目はありません）。</li>
      <li>決戦の暫定順位は <span class="ui">発表モード</span> の <span class="ui">決戦</span>、<span class="ui">配信用ボード</span>（決戦コートを映しているとき）、<span class="ui">共有リンク</span> に出ます。斬った人から順に埋まります。</li>
    </ul>
```

- [ ] **Step 4: 「4. サイト掲載」に決戦の表示を足す**

発表モードの説明に「決戦」モードの 1 行、共有リンクの説明に「決戦 進行中は順位の上に決戦（暫定）の表が出ます」の 1 行を足す。

- [ ] **Step 5: ブラウザで確認**

`http://localhost:3461/help.html`
- 目次から「0. 全体の流れ」へ飛び、箇条書きが 8 項目。
- 流れ図が 8 段で、矢印が全部つながっていて、下の「端末の役割」が切れていない。
- 「2. 採点の進行」に「二巡目を生成」の記述が残っていない（ページ内検索で確認）。
- 375px / 1280px、ライト／ダーク。
- 画像（`help/img/admin_round.png`）は「二巡目を生成」が写っているので**撮り直しが要る**。`docs/superpowers/audits/2026-09-22-system-audit.md` の「撮り直しが要る画像」に 1 行追記して、この計画では撮り直さない。

- [ ] **Step 6: commit**

```bash
git commit -m "docs: ヘルプを8段階と決戦（暫定ベスト8）に合わせる" -- help.html docs/superpowers/audits/2026-09-22-system-audit.md
```

**完了条件:** ヘルプの 0・2・4 章が新しい流れを説明していて、「二巡目を生成」の記述が残っていない。

---

# 並行できる組み合わせ

```
A1 → A2 → A3 → A4 → A5 → A6      （1 人で直列。すべて server/index.js か test.html を触る）
                        ↓
        ┌───────────────┴───────────────┐
        │                               │
  トラック B（担当者 1）           トラック C（担当者 2）
  B1 → B2 ─┐                     C1 ─┐
        B3 ─┼→ B4 → B5 → B6            ├ C4  ← C1 / C4 / C5 は互いに並行してよい
                                 C5 ─┘
                                 C2 → C3   ← この 2 つだけは直列（両方 test.html）
```

| 組み合わせ | 並行してよいか | 理由 |
|---|---|---|
| A の中（A1〜A6） | **不可** | `server/index.js` と `test.html` を全員が触る |
| B と C | **可** | 触るファイルが 1 つも重ならない |
| B2 と B3 | **可** | `desk-match.js`+`desk.css` と `admin-round.js`+`admin.css` |
| B1 と B2 | 可（B1 を先に） | 別ファイルだが、B1 の `nextStep` 化を前提に B2 の見た目を確かめたい |
| B4 の 2 ファイル | 1 タスク内で連続 | 同じ変更を PC とスマホに入れるだけ |
| C1 / C4 / C5 | **可** | `app.js`+`style.css` / `share.js`+`share.css` / `help.html` |
| C2 と C3 | **不可** | 両方 `test.html` を触る。C2 の commit 後に C3 |
| C2・C3 と C1・C4・C5 | 可 | ファイルが重ならない（`test.html` を触るのは C2・C3 だけ） |

---

# 手動確認（全部が入ってから、通しで 1 回）

- [ ] **通しの流れ**: 大会を作る → 選手 12 名（男子 10・女子 2、得点がばらける）→ 試合開始 → 一巡目を全員採点 → **一巡目を終了**（未採点の確認が出る）→ 試合進行に移り「二巡目の形登録」と決戦の区画が出て、**技が複製済み** → 1 名の形を直す → **二巡目を開始** → コート A の端末で採点でき、決戦コートの選手はバナーで止まる → **決戦を開始**（「決戦以外の未採点が n 名います」の確認）→ 決戦コートの端末だけ採点でき、発表モードと配信ボードで暫定順位が埋まる → **二巡目を終了** → 結果確認 → 最終結果
- [ ] **男子 8 名未満**（男子 5 名）: 5 名全員が決戦に入る
- [ ] **8 位同点**（8 位と 9 位が同点）: 9 名が決戦に入る
- [ ] **男子 0 名**（女子だけ）: 決戦の区画が出ず、二巡目 進行中の「次へ進む」が「二巡目を終了 ▶」になり、そのまま終了できる
- [ ] **既存データ**: `round2` のまま保存された古い大会（`finalist` の行が無い）を開いて、`round2 → round2_done` がそのまま通る／`round2_done` から「戻す」が `round2` に行く
- [ ] **幅とテーマ**: 375px / 768px / 1280px × ライト／ダークで、運営画面・採点画面・共有ページ・発表モード・配信ボード・ヘルプが崩れない
- [ ] **テスト**: `node scripts/run-test-html.mjs http://localhost:3461/test.html` が `0 failed`、`npm test`（`server/auth.test.js`）も通る
