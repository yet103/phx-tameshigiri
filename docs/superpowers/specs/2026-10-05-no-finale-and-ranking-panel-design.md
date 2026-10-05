# 最終組の廃止と、採点画面の一覧の縦並び・順位表

**日付**: 2026-10-05
**対象**: phx-tameshigiri（試し斬り採点システム。master 916aefe 起点。採点画面の一覧のドラッグ並べ替えを別の担当が実装中＝本書の実装はその着地の後）

**本書は [2026-10-04-finale-after-round2-design.md](2026-10-04-finale-after-round2-design.md)（最終組とベスト4）を置き換える。** 同書のうち「最終組」（`finalist` の印・先頭コートの末尾への配置・状態 `round2_final`・最終組のカードと表）に関する決定はすべて取り消す。**ベスト4（合計の一般男子上位 4 名。暫定ベスト4・残り人数・発表モードのカウントダウン）は残す**（同書 2.2・2.3・2.5 の `best4LineText`・2.6 の `best4`・4 章）。

**前提として引き継ぐ設計書**（過去の設計書は書き換えない。食い違うところは本書が優先）:
- [2026-09-28-finale-on-first-court-design.md](2026-09-28-finale-on-first-court-design.md) — 先頭コートの末尾に最終組を置く仕組み。**本書で廃止**。
- [2026-10-01-audit-fixes-design.md](2026-10-01-audit-fixes-design.md) — 順位の合算キー（M1）は残す。S12（二巡目の件数から最終組を除く）・S18（選考の差 `finalistDiff`）は**廃止**（対象が無くなる）。
- [2026-10-03-invite-links-and-ai-key-design.md](2026-10-03-invite-links-and-ai-key-design.md) — 採点の鍵の範囲（`GET /api/events/:id` は採点の鍵にも全コートの選手を返す・順位 API は呼べない）は**変えない**。CSV 23 列（20 列も読む）も変えない。
- [2026-10-03-round2-forms-prereg-design.md](2026-10-03-round2-forms-prereg-design.md) — 二巡目の行の作り方（申請の形・一巡目の確定得点の低い順）は変えない。最終組の行の扱いだけ消える。

行番号は作業ツリー（master 916aefe ＋ 実装中のドラッグ並べ替え）の時点。ドラッグ並べ替えの着地で `app.js`・`courts.js`・`test.html`・`help.html`・`style.css`・`scoring.html` の行はずれるので、**関数名と 9 章の grep で探す**こと。

---

## 0. 背景と決定（ユーザー決定 2026-10-05）

### A. 決戦（最終組）の仕組みを無くす

一巡目終了時に一般男子上位 4 名を A コートの二巡目の末尾に回す処理（`finalist` の印・`firstCourt` の末尾への配置・`reorderRound2` での印の付け直し）、状態 `round2_final`（最終組を開始／終了）、最終組のカード・表・印・バナー・採点画面の段のラベル、`finalistDiff` の警告（S18）、配信ボードの最終組の表を**全部やめる**。

- **二巡目は各コートで、一巡目の確定得点の低い順に全員が斬るだけ**（コート×性別ごと。今の `compareForRound2` の並び）。
- 終盤に「ベスト4 になりそうな人」を最後に回したければ、運営が**ドラッグ並べ替え**（採点画面の一覧＝実装中、PC 運営の選手登録＝既存）で手動で整える。システムは選ばない。
- **残すもの**:
  - 「暫定ベスト4（合計）」の表示 — 試合進行の 1 行（PC・スマホ）と PC の表、共有ページの表、発表モードのベスト4 カウントダウン、二巡目終了・表彰の要約の 1 行。
  - CSV の「決戦」列 — 互換のため**列名は残す**。書き出しは**常に空**、読み込みは**無視**。
  - 旧データが壊れない扱い — `round2_final` の大会は `round2` として読む、`finalist` の印は無視する（3 章）。
- **工程表（PC）**: ① 一巡目 → ② 二巡目の形登録 → ③ 二巡目 → ④ 結果・表彰 の **4 段**。上部の状態バー（準備中・一巡目・形登録・二巡目・最終結果）は**そのまま**。
- **遷移**: round2 → round2_done は「**二巡目を終了**」（確認文は二巡目の未確定の人数）。409 `no_finale` / `finale_pending` は廃止。
- **採点画面**: 一覧で最終組を末尾に寄せる処理・`round2_final` で最終組だけにする処理を外す。`isRowScorable` も最終組の制限を外す。**採点の鍵の範囲は変わらない**。
- AI 用 MCP ツールの `change_status` の説明・`auto_score` の対象から最終組を外す。
- ヘルプ・入口（`index.html` / `home.js`）の説明を直す。

### B. 採点画面の選手一覧の配置と列を変え、順位表を足す

- **横並び（採点｜A｜B…）をやめる。** `body.scoring-wide`・`fitListTables` の `.compact`・`Courts.listLayout` を外し、**PC もスマホも採点の下にコートごとの一覧を縦に並べる**。ページ幅は `--page-max-width`（660px）のまま。
  - PC（1100px 以上）では**全コートを開いた状態**。スマホ（1100px 未満）では**採点中のコートだけ開き、他は見出しで開閉**（今のスマホの動き）。
- **一覧の列**: 順番・ゼッケン・選手名・級位段位・一巡目・二巡目・備考（**合計・順位・新人枠の列は外す**。技は出さない）。得点は確定した巡目だけ、二巡目の行には同じ選手の一巡目も出す（今のまま）。
- **一覧の下に順位表**を別の区画として出す: **一般男子・新人枠・一般女子**の 3 つ（結果確認と同じ並びと見出し。列は順位・名前・合計。同点同順位）。採点の鍵の端末は順位 API を呼べないので、**画面側で計算**する。確定のたびに更新。PC では 3 列横並び、スマホでは縦。
- ドラッグ並べ替え（掴み手 ⋮⋮・同じ帯の中だけ・運営だけ）は**そのまま残す**。
- `rankCache` / `EventStatus.rankMap` の用途は順位表に移る（`rankMap` は廃止して `EventStatus.rankings` に置き換える。2.3）。

---

## 1. 用語

| 語 | 意味 |
|---|---|
| **ベスト4** | 一般男子（新人を含む）の合計（一巡目＋確定済みの二巡目）の上位 4 名。同点は全員・0 点以下は除く。`EventStatus.best4Standings`（変えない） |
| **暫定ベスト4** | ベスト4 が確定する前の同じ表。`best4Standings(...).final === false` |
| **順位表**（採点画面） | 採点画面の一覧の下に出す 3 部門（一般男子・新人枠・一般女子）の順位。`EventStatus.rankings` で計算し、確定した得点のある選手だけを出す（D4） |
| **旧データ** | 本書より前に作られ、状態が `round2_final` の大会、または二巡目の行に `finalist: true` が付いた大会 |

「最終組」「決戦」の語は**画面から無くす**（CSV の列名「決戦」と、大会名「名古屋城決戦」などの固有名詞だけ残る）。

---

## 2. データと共通部品（`status.js`・`courts.js`。分担 A）

### 2.1 状態と遷移

`STATES` から `round2_final` を外して **7 状態**にする。

```
STATES = ['draft', 'round1', 'round1_done', 'round2', 'round2_done', 'final', 'archived']

TRANSITIONS = {
  draft:       ['round1'],
  round1:      ['draft', 'round1_done'],
  round1_done: ['round1', 'round2', 'final'],
  round2:      ['round1_done', 'round2_done'],
  round2_done: ['round2', 'final'],
  final:       ['round2_done', 'round1_done', 'archived'],
  archived:    ['final']
}
```

| 名前 | 旧 | 新 |
|---|---|---|
| `LABELS.round2_final` | 最終組 進行中 | **削除** |
| `NEXT_LABELS.round2` | 最終組を開始 | **二巡目を終了** |
| `NEXT_LABELS.round2_final` | 最終組を終了 | **削除** |
| `ROUND2_END_LABEL` | 二巡目を終了 | 二巡目を終了（`NEXT_LABELS.round2` と同じ値。互換のため export は残す） |
| `next(status)` | 添字の右隣 | 同じ（round2 の次が round2_done になる） |
| `prev(status, players)` | round2_done → 最終組の行があれば round2_final | **round2_done → round2**（final の分岐＝二巡目に採点済みがあれば round2_done、無ければ round1_done は変えない） |
| `nextStep(status, players)` | round2 → 最終組の行があれば round2_final | **`next(status)` と同じ**（players は受けるが使わない。呼び出し側を変えずに済ませる） |
| `nextLabel(status, players)` | round2 → 最終組の有無で文言が変わる | **`NEXT_LABELS[status]`**（players は使わない） |
| `isScoringOpen` | round1 / round2 / round2_final | **round1 / round2** |
| `scoringRound` | round2・round2_final → 2 | **round2 → 2** |
| `isPlayerScorable(status, player)` | round2 は印の無い行・round2_final は印のある行 | **削除** |
| `isRowScorable(status, player)` | 開いている・巡目が合う・`isPlayerScorable` | **開いている・player がある・巡目が合う**の 3 つだけ |
| `derive(event)` | round2_final は返さない | 変えない |

### 2.2 旧データの状態（`round2_final`）の読み替え — D1

**推奨: 読み込みのときに `round2` として扱う**（ファイルは書き換えない）。

- `status.js` に読み替えの表と関数を足す:
  ```
  var LEGACY_STATUS = { round2_final: 'round2' };
  // ファイルの status を今の状態名に直す。知らない値はそのまま返す（of が STATES で弾く）
  function normalizeStatus(s) { return Object.prototype.hasOwnProperty.call(LEGACY_STATUS, s) ? LEGACY_STATUS[s] : s; }
  ```
- `of(event)` は `normalizeStatus(event.status)` が `STATES` にあればそれを返す（無ければ従来どおり `derive`）。画面・API・MCP はすべて `of` を通した値（`GET /api/events` の一覧と `GET /api/events/:id` の `status`）を見るので、旧データの大会は **「二巡目 進行中」として開き、そのまま「二巡目を終了 ▶」で round2_done へ進める**。
- サーバーで `event.status` を生で読む所も `normalizeStatus` を通す（4.1 の表）。
- ファイルの `status: 'round2_final'` は、次に状態を変えたとき（`POST …/status` が `event.status = to` を書く）か、大会を保存し直したとき（`POST /api/events` が前の値を引き継ぐときに `normalizeStatus` を通す）に `round2` か次の状態に置き換わる。起動時の一括書き換えはしない（ファイルを黙って書かない、という今までの方針どおり）。
- `POST /api/events/:id/status` に `to: 'round2_final'` が来たら、`STATES` に無いので **400「不正な状態です」**（古い画面・古い MCP からの要求）。

**採らない案: `round2_final` を状態として残し、次を round2_done にする。** 遷移表・ラベル・採点の判定・状態バー・工程表のすべてに「旧データだけの状態」が残り、画面の分岐が減らない。旧データは本番に 1 件あるかどうか（2026-10-04 に入れた状態で、大会は 10-25）なので、読み替えで足りる。

### 2.3 共通の順位（`EventStatus.rankings`）と `playerTotals` の `counted` — 推奨

順位の集計（サーバーの `computeRanking`）と採点画面の順位表が**同じ関数**を使い、一致を構造で保証する。

**`playerTotals(players, opts)` に 1 項目足す**:

```
counted: boolean   // その組に「数えた行」が 1 つ以上ある
                   //   = 確定済みの行（p.confirmed === true）、または opts.countAll のときは採点済みの行（isScored）
```

**`EventStatus.rankings(players, opts)`（新規）**:

```
opts: { countAll?: boolean }    // playerTotals と同じ（status を持たない旧データ）
戻り値: {
  male:    [{ key, rank, name, score, counted }],   // isFemale !== true（新人を含む）
  female:  [{ key, rank, name, score, counted }],   // isFemale === true
  newFace: [{ key, rank, name, score, counted }]    // isNewFace === true（男女混合）
}
```

- 中身は `playerTotals` の各組。`score` は `total`。並びと順位は `rankByTotal`（合計の降順・同点は氏名の `localeCompare(…, 'ja')`・同点同順位 1, 1, 3）。今の `computeRanking` の `rank` と同じ規則。
- `key` は `playerTotals` の `key`（`'id:<一巡目の行の id>'` など）。画面が「今の選手」を引くのに使う（D7）。

**`computeRanking`（`server/index.js`）は `EventStatus.rankings` を使う**:

```
const r = EventStatus.rankings(players, { countAll: lockedEvent });
const strip = e => ({ rank: e.rank, name: e.name, score: e.score });
rankings: { male: r.male.map(strip), female: r.female.map(strip), newFace: r.newFace.map(strip) }
```

- 応答の `rankings` の形と値は**変えない**（`key`・`counted` は共有リンクに出さない）。サーバー内の自前の `rank` 関数は消す。
- **`EventStatus.rankMap` は削除**（使っているのは `app.js` の一覧の順位の列だけで、その列が無くなる）。

**`Courts.rankPanel(players, opts)`（新規。純粋関数。採点画面の順位表の材料）**:

```
opts: { countAll?: boolean }
戻り値: [
  { key: 'male',    title: '一般男子', rows: [{ key, rank, name, score }] },
  { key: 'newFace', title: '新人枠',   rows: [...] },
  { key: 'female',  title: '一般女子', rows: [...] }
]
```

- 部門の並びと見出しは結果確認（`DeskResults.CATEGORIES` / `AdminResults` / `ranking.html`）と同じ。`Courts.RANK_CATEGORIES` として courts.js に持つ（既存の 3 か所はそのままでよい。揃えるのは任意）。
- rows は `EventStatus.rankings` のその部門のうち **`counted` が真の行だけ**（D4）。**順位は全員で付けたもの**をそのまま使う（間を詰めない）。確定した得点の無い人は合計 0 で末尾に並ぶだけなので、外しても上の人の順位は結果確認と同じになる（確定 0 点の人と同点のときも、同点同順位なので変わらない）。

### 2.4 削除する部品

| 部品 | ファイル | 備考 |
|---|---|---|
| `finalists` / `hasFinalists` / `finaleCourt` / `firstCourt` | status.js | `firstCourt` は最終組の置き場所の判定にしか使っていない（desk-match の `appendGroupsWithFinale` と generateRound2）。両方消えるので削除 |
| `isPlayerScorable` | status.js | 2.1 |
| `FINALIST_COUNT` / `FINALIST_LABEL` / `FINALIST_DESC` | status.js | |
| `pickFinalists` / `round1Sources` / `finalistDiff` | status.js | S18 の廃止 |
| `rankMap` | status.js | 2.3 |
| `Courts.finalists` / `Courts.finaleCourt` / `Courts.finalGroupLineText` / `Courts.finalistDiffMessage` | courts.js | |
| `Courts.listLayout` | courts.js | B（横並びの廃止） |

**残す**: `confirmedScoreOf`（サーバーの二巡目の並びが使う）、`playerTotals`、`rankByTotal`（内部）、`best4Standings`、`BEST4_COUNT` / `BEST4_LABEL` / `BEST4_PROVISIONAL_LABEL`、`Courts.best4LineText`、`nextStep` / `nextLabel`（2.1 のとおり単純化）。

### 2.5 `courts.js` の変更

| 関数 | 変更 |
|---|---|
| `listForStatus(players, court, status)` | 進行中ならその巡目だけ（**試技順のまま**）。round2 で最終組を末尾に寄せる処理・round2_final で最終組だけにする処理を外す |
| `canDropInList(a, b, status)`（実装中のドラッグで足した） | **`sameReorderGroup(a, b)` と同じ**にする（round2 で最終組と他の行の間をまたがせない条件を外す）。関数は残してよい（app.js の呼び出しを変えない） |
| `reorderIds` のコメント | 「最終組 進行中は最終組だけ等」の例を外す（巡目の絞り込みだけが残る） |
| `stageCountText(status, players)` | round2_final の分岐を外す。進行中は**その巡目の全行**の「確定 n / N」（S12 の除外をやめる） |
| `statusConfirmMessage(from, to, players)` | round2 → round2_final・round2_final → round2_done の分岐を外す。round2 → round2_done は今の分岐のまま「二巡目の未確定が n名います。\n二巡目を終了しますか？」 |
| `progressRound` / `startBlockers` | 変えない（round2_final を受けた分岐があれば外す） |
| `best4LineText` | 変えない |

---

## 3. 旧データの扱い

| 旧データ | 扱い |
|---|---|
| 状態 `round2_final` の大会 | 2.2。読み込みで `round2`。採点画面は全員を採点できる（最終組の行も通常の二巡目の行）。次は「二巡目を終了 ▶」 |
| 二巡目の行の `finalist: true` | **どこでも見ない**。A コートの男子の二巡目の末尾（続き番号）に並んでいるので、そのまま「A コートの最後のほうに斬る通常の行」になる。並べ替えたければドラッグで |
| 2026-09-22 の設計で専用コート「決戦」に置かれた行 | 通常のコート「決戦」として出る（コート名の移行はしない。今も同じ） |
| 印の保存 — **D2** | **推奨: 新しく保存する経路では落とす**。`sanitizePlayerForSave`（大会の保存・バンドル取り込み・CSV 取り込み）と `pickBundlePlayer`（バンドル書き出し）は `finalist` を写さない。CSV の書き出しは「決戦」列を常に空。PATCH は行をその場で直すので既にある印は残るが、誰も読まないので害は無い |
| バンドルの `status: 'round2_final'` | 取り込みで `normalizeStatus` を通して `round2` として保存する |
| CSV の 23 列・20 列で「決戦」列に ○ がある | 読み込みで無視（`raw.finalist` を作らない）。列の位置は変えない（19 列目のまま） |
| ranking API の `finale` — **D3** | **推奨: 項目ごと外す**。共有ページが状態を知るために `finale.status` を読んでいたので、代わりに `event.status` を足す（4.2） |

旧データの移行（ファイルの書き換え）はしない。

---

## 4. サーバーの変更一覧（`server/index.js`。分担 A）

### 4.1 状態

| 箇所（関数・経路） | 変更 |
|---|---|
| `POST /api/events/:id/status`（1868〜） | 409 `no_finale`（1981〜1984）と `finale_pending`（1985〜1992）を削除。履歴の文言 `（二巡目 n 名を生成。最終組 m 名）` → **`（二巡目 n 名を生成）`**。応答の `round2` から `finalistCount`・`finalistDiff` を外す（`created / skipped / existingCount / untrackedCount / unassignedCount / reordered / fromRequest` は残す） |
| 同 `to` の検査（1876） | `STATES` に無いので `round2_final` は 400。変更なし（STATES が変わるだけ） |
| `POST /api/events`（1480〜1485。前の status を引き継ぐ） | `EventStatus.normalizeStatus(prev.status)` が STATES にあればそれを書く |
| PATCH の `not_scorable`（2740） | `EventStatus.isRowScorable(EventStatus.normalizeStatus(event.status), player)`。応答の `status` も同じ値 |
| バンドル書き出し（3701） | `normalizeStatus(event.status)` が STATES にあれば書く |
| バンドル取り込み（3835） | `normalizeStatus(src.status)` が STATES にあれば採用 |

### 4.2 順位

| 箇所 | 変更 |
|---|---|
| `computeFinale`（391〜447） | **削除** |
| `computeRanking`（449〜508） | 2.3 のとおり `EventStatus.rankings` を使う。`finale` を外す（D3）。`event` に **`status: EventStatus.of(event)`** を足す（共有ページ用。共有リンクから無認証で読まれるが、状態名は秘密ではない）。`best4` は変えない |

応答の形（新）:

```
{ event: { name, date, venue, updatedAt, status },
  rankings: { male: [{ rank, name, score }], female: [...], newFace: [...] },
  best4: { final, remaining, rows: [{ name, total, r1, r2, rank }] } }
```

### 4.3 二巡目の生成

| 箇所 | 変更 |
|---|---|
| `pickFinalists`（3890） | 削除 |
| `compareByScoreAsc`（3918〜） | 削除（最終組の並びだけに使っていた） |
| `compareForRound2`（3908〜） | 変えない（女子が先 → 一巡目の確定得点の昇順 → 同点は一巡目の試技順。番号はコート×性別ごとなので、効くのは組の中の昇順）。コメントの「決戦以外の並び」を「二巡目の並び」に |
| `buildRound2Row(players, newRows, p, court, isFemale, finalist)`（3928〜） | 引数 `finalist` と `row.finalist = true` を削除 |
| `generateRound2`（3975〜） | `finalistIds`・`finals`・`finaleCourt` を削除。`targets.sort(compareForRound2)` を全員それぞれのコート（`courtOf(p)`）に置く。戻り値から `finalistCount` を外す |
| `reorderRound2`（4062〜。誰も二巡目を採点していないときの付け直し） | **残す**（D9）。`finalistIds`・`finals`・`finaleCourt`・`place` の `finalist` 引数・`row.finalist = true` を削除。全員を `plain` として自分のコートに置き直す。戻り値から `finalistCount` を外す |
| `POST /api/events/:id/rounds/2/generate`（4127〜） | 応答から `finalistCount`・`finalistDiff` を外す |
| PATCH の性別の写し（2878〜2915） | `parsed && p.finalist !== true` → **`parsed`**（印のある行も order の性別を組み直す）。コメントの決戦の 2 行を消す |

### 4.4 保存・CSV・バンドル

| 箇所 | 変更 |
|---|---|
| `sanitizePlayerForSave`（1331〜1333） | `finalist` を写す行を削除（D2） |
| `pickBundlePlayer`（3640〜3641） | 同上 |
| CSV 取り込み（3243） | `raw.finalist = mark(row[18])` を削除（列は読み飛ばす） |
| CSV 書き出し（3350） | 19 列目を常に `''`。見出し `CSV_ROUNDTRIP = ['決戦', '一巡目の行']` は**変えない** |
| CSV のコメント（3004・3012・3136〜3137・3217・3308〜3309） | 「決戦の印」→「決戦の列（互換のため列名だけ残す。書き出しは空、読み込みは無視）」 |
| `round2_format` の 409（3136〜） | 条件は変えない（二巡目の行がある大会は 23 / 20 列だけ。理由は「一巡目とのつながり」だけになる）。コメントを直す |
| 並べ替え `POST …/players/reorder` のコメント（2522） | 「finalist の印は区別しない」を消す |

### 4.5 その他

- `api.js` のコメント（108・192〜209・232・590〜602・841〜848）: `finalistDiff`・`finalistCount`・`no_finale`・`finale_pending`・`finale` の記述を消し、ranking の `event.status` を足す。232 行の `finalistDiff` の取り出しは削除。
- `npm test`（server/*.test.js）は最終組に触れていないので追従なし（通ることを確かめる）。

---

## 5. 採点画面（`app.js`・`scoring.html`・`style.css`。分担 B）

### 5.1 最終組の撤去（`app.js`）

| 箇所 | 変更 |
|---|---|
| `scoringOpenHere`（598〜601） | `scoringOpen()` と同じにする（`isPlayerScorable` が無くなる。関数名は残してよい） |
| `finalGroupName` / `finalOnlyMessage`（603〜611） | 削除 |
| `renderStatusBanner`（614〜） | `!scoringOpenHere()` の分岐（最終組の案内）と round2_final の空のコートの分岐（630〜638）を削除。進行中は緑の `LABELS[st]` だけ |
| `applyScoringLock`（666〜） | `empty`（round2_final で最終組のいないコート）を削除。`locked = !!currentEvent && !scoringOpen()` |
| `updatePlayerLabels`（1027〜） | round2_final の段の差し替え（1038〜1040）と「最終組 n/N」（1053〜1063）を削除 |
| `buildPlayerListRow`（2275〜） | `isFinale`・`tr.finale`・`finale-mark` を削除 |
| ドラッグのコメント（2338〜2339） | 「二巡目 進行中は最終組と他の行の間はまたがせない」を削除（`Courts.canDropInList` は 2.5 で同じ組の判定だけになる） |
| 693 行のコメント | 「最終組の扱い」を消す |

### 5.2 一覧の配置（横並びの廃止）

- **`body.scoring-wide` をやめる**。`initListLayout` の `resize` の監視・`applyListLayout`・`fitListTables` を削除。`WIDE_QUERY`（`(min-width: 1100px)`）の `matchMedia` は**開閉の既定を決めるためだけに残す**（`isWideLayout()`）。窓が 1100px をまたいだら `renderPlayerList()` で描き直す。
- 配置: `.scoring-main`（採点）→ `#playerListSection`（コートごとの一覧を縦に）→ **`#rankPanelSection`（順位表。5.4）**。どれもページ幅（660px）の中。
- 開閉（`buildCourtList`）:
  - **PC（1100px 以上）**: 全コートを開く。見出しを押しても畳まない（D6 推奨。▾/▸ の矢印は出さない。今の広い窓と同じ）。区画に `pinned` を付ける。
  - **スマホ（1100px 未満）**: 今のまま（採点中のコートだけ開く・他は見出しで開閉・`listOpen` は採点中のコートが変わったら忘れる）。
  - CSS は `body:not(.scoring-wide) .court-list.collapsed …` → **`.court-list.collapsed .player-list-body { display: none; }`**、`body.scoring-wide .court-list-arrow` → **`.court-list.pinned .court-list-arrow { display: none; }`** と `.court-list.pinned .court-list-head { cursor: default; }`。
- 各コートの表は今の `.player-list-body { overflow: auto; max-height: 50vh; }` のまま（PC で全コートを開くとコートごとに最大 50vh。採点中の行への自動スクロール `scrollPlayerListTo` は採点中のコートの枠の中だけ。変えない）。
- `scoring.html` の `<style>`（26〜69 行）から `body.scoring-wide …` と `.player-list-table.compact …`・`.order-no` の規則をすべて削除。26 行のコメント「9 列を 620px に収める」は「7 列（運営は掴み手を足して 8 列）を 620px に収める」に。`.scoring-main` の div は残してよい（規則が無いので何もしない）。
- `style.css`: 537〜538 のコメントを縦並びの説明に、552〜553 を上の規則に。616〜626 の `tr.finale`・`.finale-mark` を削除。405 行のコメント（「決戦の注意文が 2 行に…」）は「状態の案内が 2 行に…」に。

### 5.3 一覧の列

```
（掴み手）| 順番 | ゼッケン | 選手名 | 級位・段位 | 一巡目 | 二巡目 | 備考
```

- `PLAYER_LIST_HEAD` から `合計`・`順位`・`新人枠` を外す。`playerListColumns()` は運営 8・それ以外 7。帯（男子の部・女子の部）の `colSpan` もこれ。
- 行（`buildPlayerListRow`）: `td.score.total`・`td.rank.division`・`td.rank.newface` を削除。順番は `esc(p.order)` だけ（`.order-text` / `.order-no` の 2 つの span は `.compact` 用だったので 1 つに戻す）。ゼッケンの「—」も span で包まなくてよい。級位・段位と備考の `.clip` は残してよい（title に全文。備考は折り返し可のまま）。
- `fillScoreCells(tr, p)`: 一巡目・二巡目の 2 つだけ（`scorePair` の `r1`・`r2`。確定した巡目だけ、二巡目の行には同じ選手の一巡目。今のまま）。順位の書き込み（`rankOf`）を削除。
- `rankCache`・`rankOf` を削除（順位は 5.4 の順位表へ）。

### 5.4 順位表（`#rankPanelSection`）

**HTML（`scoring.html`）**: `#playerListSection` の直後に

```html
<section class="rank-panel-section" id="rankPanelSection" hidden>
  <h2 class="rank-panel-title">順位<span class="rank-panel-note">確定した得点の合計（同点は同順位）</span></h2>
  <div class="rank-panel-cols" id="rankPanelCols"></div>
</section>
```

**描画（`app.js` の `renderRankPanel()`。新規）**:

- 材料は `Courts.rankPanel(players, { countAll: false })`（2.3。採点の鍵の端末でも `players` は全コートの選手なので、全員の順位になる）。`countAll` は D10 のとおり今回は常に false。
- 部門ごとに `<section class="rank-panel-col"><h3>一般男子</h3><table class="rank-panel-table">…</table></section>`。表の列は **順位・名前・合計**（見出し行あり。数値は右寄せ）。rows が 0 件の部門は「まだいません」。3 部門とも 0 件なら区画の中を「まだ確定した得点がありません」1 行にする。
- **今の選手の行を強調**（D7 推奨）: 今開いている選手の組の鍵（一巡目の行なら `'id:' + p.id`、二巡目の行なら `'id:' + p.sourcePlayerId`）と行の `key` が一致したら `tr.current`（一覧の `current-player` と同じ色）。
- 出す条件: 大会を開いていれば出す（`hidden = !currentEvent`）。どの状態でも出す（準備中は空の 1 行、最終結果でも出す）。
- **呼ぶ時機**: `renderPlayerList()` の末尾で毎回（確定・取り消し・保存・大会の読み直し・コートの切り替えのたびに今も一覧ごと描き直しているので、同じ時機で足りる）。ドラッグ中に一覧の描き直しを保留する（`listDrag` の間）のは一覧だけの都合なので、順位表は保留の前に描いてよい（並べ替えでは得点が変わらないので、保留した後に描いても同じ）。選手の切り替え（`updatePlayerList`）では強調だけ付け替える（`renderRankPanel` を呼び直してもよい。表は小さい）。
- 部門の区画は `.rank-panel-cols` の **CSS grid**:
  ```
  .rank-panel-cols { display: grid; grid-template-columns: 1fr; gap: 12px; }
  @media (min-width: 600px) { .rank-panel-cols { grid-template-columns: repeat(3, 1fr); } }
  ```
  切り替えの幅は D5（推奨 600px。ページ幅 660px の中で 3 列になる幅。iPad の縦でも 3 列）。名前が長ければ折り返す（省略しない）。
- 長さ: 部門ごとに全員を出す（内側のスクロールは付けない。ページのスクロール）。D8 の補足を参照。
- 色・字体は一覧（`.player-list-table`）に合わせる（大会トーンの見出し帯・明朝体。`style.css` の 727〜740 の並びに足す）。順位の数字は今の `td.rank` と同じ `--gold-light`。

**順位表に出さない選手（D4 推奨）**: 確定した得点の無い選手（`counted` が偽）は出さない。結果確認（PC・スマホ）と順位表ページは全員（0 点も）を出すので、**ここだけ違う**。見出しの注記「確定した得点の合計」で示す。ヘルプにも書く（8.5）。

### 5.5 変えないこと（採点画面）

- 他のコートの行を押すと採点中のコートが切り替わる（`changeCourt`）、採点の鍵の 1 コートの端末では他のコートは見るだけ（`Scope.listSections`）。
- ドラッグ並べ替え（掴み手・同じ帯の中だけ・運営だけ・Pointer Events・保存の作法）。
- 一覧の得点の出し方（確定した巡目だけ）、確定済みの行のグレー、今の選手の強調と自動スクロール。

---

## 6. PC 運営（`desk*.js`・`desk.css`。分担 C）

### 6.1 試合進行（`desk-match.js`）

| 箇所 | 変更 |
|---|---|
| `MATCH_STEPS`（127〜133） | **4 段**: `① 一巡目`（round1）・`② 二巡目の形登録`（round1_done）・`③ 二巡目`（round2）・`④ 結果・表彰`（round2_done / final / archived）。115〜126 行のコメントも 4 段に |
| `stepTodo`（145〜） | round2: **「各コートで二巡目を採点しています。全コートの確定がそろったら「二巡目を終了 ▶」を押します。」**（最終組ありの分岐を削除）。round2_final の case を削除 |
| `render`（52〜） | `live2 = (st === 'round2')`。`buildMatchLines` は **暫定ベスト4 の 1 行だけ**（`#matchBest4Line`。最終組の 1 行 `#matchFinaleLine` を削除）。`buildFinalistDiff` の呼び出しを削除 |
| `buildMatchLines`（182〜196） | 最終組の `<p>` を削除（関数名は `buildBest4Line` などに変えてよい） |
| ベスト4 の表（`buildBest4Box`・`placeBest4Table`・`renderBest4`） | **残す**（D8）。`placeBest4Table` は `#matchFinaleGrid` の分岐を削除し、コートのカードの下（「一巡目の結果」の畳みの上）に置く |
| `buildFinalistDiff`（441〜451） | 削除 |
| `courtCards`（26〜） | `if (p.finalist === true) return false;` を削除。21〜23 行のコメントを消す |
| `buildCourts`（588〜） | 最終組のカード（`finale`・`caption`）、round2_final の分岐（626〜638）、`appendGroupsWithFinale` を削除。部のカード（男子の部・女子の部）を順に並べるだけ |
| `appendGroupsWithFinale`（661〜690） | 削除（`EventStatus.firstCourt` の唯一の画面の利用） |
| `buildCard`（招待の条件 814） | `row.finale !== true` を削除（常に招待ボタン） |
| `buildCardTable`（835〜） | `(p.finalist === true) === (row.finale === true)` を削除 |
| `livePlayerFor`（896〜） | 最終組の印の比較（903）を削除。891〜895 のコメントを直す |
| `DeskMatch` の export | 変えない（`MATCH_STEPS`・`matchStepIndex`・`stepTodo`・`best4Caption`・`best4TableRows`・`topRanked`） |

### 6.2 その他の PC

| ファイル | 変更 |
|---|---|
| `desk.js` | `STAGE_GROUPS` の二巡目を `['round2', 'round2_done']`。`STAGE_NOTES.round2_final` を削除。27〜30・308 のコメントを 4 段に。`statusToastText` の最終組の人数（384）を削除。409 の再読み込みの条件から `finale_pending` / `no_finale`（488〜492）を削除。`res.round2.finalistDiff` の警告（502〜506）を削除 |
| `desk-round2.js` | 二巡目の表を 1 つに（`finalRows`・`plainRows` の分け、最終組の見出し・注記 `#round2FinaleNote`・金の枠を削除。204〜230）。選考の差の警告（93〜100 `#round2FinalistDiff`）を削除。3・26〜27・145 のコメント |
| `desk-players.js` 2384 | `（最終組の印と一巡目とのつながりを保ち、…）` → **`（一巡目とのつながりを保ち、…）`** |
| `desk.css` | `.desk-match-finale`（516〜534）を削除（最終組のカードと形登録の枠だけが使う）。`.desk-match-finale-rank`・`.desk-match-finale-line` はベスト4 の表・1 行が使うので**残す**（名前を `best4` に寄せるのは任意）。55・485・514・536〜537 のコメント |
| `desk-setup.js` 142 | コメントだけ（任意） |

`desk-results.js`（結果確認）は変えない。

---

## 7. スマホ運営・共有・配信・発表・入口・MCP（分担 C）

### 7.1 スマホ運営

| ファイル | 変更 |
|---|---|
| `admin-round.js` | `stageTodo` の round2 を PC と同じ 1 行に、round2_final の case を削除（205〜213）。`buildFinaleLine`（174〜180）を削除し、round2 では**暫定ベスト4 の 1 行だけ**（435〜438）。選考の差（439〜450）を削除。トーストの `／最終組 m 名`（350）を削除。409 の再読み込み条件（340〜344）から `finale_pending` / `no_finale` を削除。`renderList` の最終組のカード（567〜583）と `buildFinaleBlock`（588〜603）を削除し、全行を試技順に `buildRow` で並べる。383〜384・425〜426 のコメント |
| `admin-players.js` 1223 | desk-players と同じ言い換え |
| `admin.css` | `.round-finale`・`.round-finale-caption`・`.round-finale-line` を削除（386〜395）。`.round-best4-line` は残す。コメント |
| `admin.js` 713 | コメントだけ（任意） |

### 7.2 共有ページ（`share.js`）

- `BEST4_STATES` を `['round2', 'round2_done', 'final', 'archived']`。
- `best4Visible(best4, status)`: 第 2 引数を**状態の文字列**に変える（ranking の `event.status`。4.2）。`status` が文字列なら `BEST4_STATES` にあるか、無ければ（古いサーバーの応答）`best4.final === true`。
- `renderBody(rankings, best4, status)`・呼び出し（266）は `result.data.event && result.data.event.status` を渡す。118〜120 行のコメント。

### 7.3 配信ボード（`board.js`・`board.html`・`board.css`）

- 最終組の表を**まるごと削除**: `board.html` の `#boardFinale`（56〜65）、`board.css` の `.board-finale*`（183〜204）、`board.js` の `finaleSeq`・`finaleTimer`・`finaleFor`・`renderFinale`・`pollFinale`・`FINALE_REFRESH_MS`・`el.finale*`・export の `finaleFor`（20〜21・82〜95・289〜317・323・329・333・336〜344・385・388・410〜411・431・449）。配信ボードは順位 API を読まなくなる（2 秒ごとの採点表のポーリングだけ）。

### 7.4 発表モード（`present.js`・`present.html`）

- 変えない（すでにベスト4 のカウントダウンだけで、最終組を見ていない）。`best4` は ranking API のまま。

### 7.5 入口（`home.js`・`index.html`）

- `home.js` の `FLOW_CAPTIONS.round2_final`（102）を削除（帯は `EventStatus.STATES` から 7 段で描かれる）。`round2: 'コート端末で採点'` はそのまま。
- `index.html`: 55 行のコメント「7 段階の流れ」はそのまま正しくなる。64 行 **「大会は 8 つの状態」→「7 つの状態」**。66 行の注記から「最終組がいない大会（…）は「最終組 進行中」を通らずに二巡目を終了できます。」を削除（「二巡目を行わない大会は…」「どの状態からも 1 つ前に戻せます」は残す）。

### 7.6 AI 用 MCP（`tools/mcp/phx-tameshigiri`）

| ファイル | 変更 |
|---|---|
| `tools.mjs` | `STATES` から `round2_final`。選手の要約の `finalist`（74）を削除。`rowSort`（78〜88）の round2_final の分岐を削除。`auto_score` の説明（222）から「最終組（round2_final）は試技順に採点する」を削除。`change_status` の説明（240）から `round2_final 最終組` を削除。`get_ranking` の説明（256）を「一般男子・一般女子・新人の順位とベスト4 の best4、event.status」に。451 行のエラー文「一巡目・二巡目・最終組に進めて」→「一巡目・二巡目に進めて」 |
| `server.mjs` 28 | 流れから `change_status(round2_final) → auto_score →` を削除 |
| `README.md` 117 | 同上 |
| `test.mjs` | 7 行の流れ・523（`finalistCount >= 1`）・527〜545（二巡目は最終組を飛ばす → **18 名全員を採点**、round2_final の段を削除し round2 → round2_done）・547〜576（`finale` の検査を削除、`best4` と `rankings` は残す。`event.status` が `round2_done`） |

---

## 8. ヘルプ（`help.html`。分担 C）

スクリーンショット（help/img）は撮り直さない（最終組が写っている画像は無い。採点画面の画像は旧レイアウトのまま、という今の注記のまま）。

### 8.1 状態（§1）

- 66 行: 二巡目 進行中から「最終組（一巡目上位 4 名）はまだ斬りません（…）」を削除。
- 67 行（`最終組 進行中` の項目）: 削除。
- 72 行の注記（最終組がいない大会は…）: 削除。代わりに「二巡目の試技順は、コートごと・部ごとに一巡目の得点が低い順です。最後のほうに斬らせたい選手がいれば、採点画面の一覧か選手登録でドラッグして入れ替えます」を足してよい。
- 74・78・81 行: 「8つの状態」→「7つの状態」、状態バーの二巡目は「二巡目 進行中・二巡目終了」、補足文の例から「二巡目 最終組 進行中」を外す、工程表は **4 段**（① 一巡目 → ② 二巡目の形登録 → ③ 二巡目 → ④ 結果・表彰）で「状態バーの二巡目の段が ③ と ④ に分かれる」の説明を「③ が二巡目 進行中、④ が二巡目終了・最終結果・アーカイブ」に。
- 84〜165 の図（SVG）: 「最終組 進行中」の段（302 の `<g>` と矢印）を削除し、下の段を 74px ずつ上へ、`viewBox` の高さを 772 → 698。`aria-label` の「8段階」→「7段階」と並びから「最終組 進行中」を削除。165 行「8 つの状態」→「7 つの状態」。

### 8.2 当日の流れ（§2。480〜）

- 480 行の見出し「当日の流れ（8つのボタン）」→ ボタンの数に合わせて「7つのボタン」。
- 501〜502 行（`最終組を開始 ▶`・`最終組を終了 ▶`）を削除し、**`二巡目を終了 ▶` — 全コートの二巡目の確定がそろったら押します。二巡目終了になります。** を足す。
- 510〜520 行（試合進行）: 工程表は 4 段、状態との対応「③ 二巡目 進行中、④ 二巡目終了・最終結果・アーカイブ」。二巡目 進行中は **`暫定ベスト4（合計）: …　残り n 名` の 1 行と暫定ベスト4 の表**（最終組の 1 行と最終組のカードの説明を削除）。520 行（最終組 進行中）を削除。
- 607・622〜625 行（形登録・スマホの試合進行）: 最終組の枠・1 行の説明を削除。
- 646〜654 行（「最終組とベスト4」の節）: 節を **「ベスト4」** に書き直す。最終組の段落（647〜654）を削除し、656〜660 のベスト4 の説明は残す。必要なら「以前の『最終組』（一巡目上位 4 名を A コートの最後に回す仕組み）は 2026-10-05 にやめました。最後に斬らせたい選手は手で並べ替えます」の 1 行。
- 853 行（配信ボードの最終組の表）: 削除。

### 8.3 CSV（319・328・930）

- 319 行: 列名「決戦」の説明を **「決戦（今は使いません。列は互換のため残し、書き出しは空、取り込みでは読み飛ばします）」**。
- 328・930 行: 「決戦の印や一巡目とのつながり」→「一巡目とのつながり」。

### 8.4 採点画面 ⑦選手一覧（572）

書き直す要点（ドラッグ並べ替えの着地後の文に対して）:
- 列は **順番・ゼッケン・選手名・級位・段位・一巡目・二巡目・備考**（合計・順位・新人枠の説明を削除）。
- 「（二巡目の進行中は、最終組の行は最終組の中だけで入れ替えます）」を削除。
- 「PC など広い画面では採点画面の右に横に並びます…文字が小さくなり…」を削除し、**「どの端末でも、採点画面の下にコートの一覧が縦に並びます。PC など広い画面（横幅 1100px 以上）では全コートが開いています。スマホなど狭い画面では採点中のコートだけが開いていて、他のコートは見出しをタップすると開きます」**。

### 8.5 採点画面 ⑧順位表（新規）

- 一覧の下に **一般男子・新人枠・一般女子** の順位（順位・名前・合計）。結果確認と同じ数え方（一巡目＋二巡目の確定した得点の合計・同点は同順位）。
- **確定した得点のある選手だけ**が出ます（まだ斬っていない選手は出ません。結果確認は全員が出ます）。確定・取り消しのたびに動きます。
- 今開いている選手の行は色が変わります。
- 採点専用の端末（QR で登録）でも全コートの選手の順位が出ます。
- PC・タブレットでは 3 つが横に、スマホでは縦に並びます。

---

## 9. 「最終組」「決戦」が残る行（作業ツリーの時点）

確かめ方: `grep -n "最終組\|決戦\|finalist\|finale\|Finale\|FINALIST\|round2_final" <ファイル>`。終わったら**各担当のファイルで 0 件**（例外は下の「残してよい」だけ）。

| ファイル | 該当行 | 担当 | 扱い |
|---|---|---|---|
| `status.js` | 10, 19–21, 28–30, 35–36, 41, 49–53, 96, 131–141, 148–168, 181, 198–206, 212, 227–249, 256, 273–304, 306, 433–434, 464–489, 501, 603–622 | A | 2.1〜2.4 で削除・書き換え |
| `courts.js` | 120–136, 143, 158–162, 175–176, 373–400, 517–528, 721–730, 834–846, 1204–1226（export） | A | 2.5。`best4LineText`（396〜）は残す |
| `server/index.js` | 391–447, 500–502, 1331–1333, 1966–1970, 1981–1992, 2003–2004, 2522, 2878–2908, 3004, 3012–3013, 3136–3137, 3217, 3243, 3308–3309, 3350, 3618, 3640–3641, 3889–3956, 3973–4118, 4158–4162 | A | 4 章。1515・1596（finalCourt の廃止のコメント）と 3013 の列名 `'決戦'` は**残してよい** |
| `api.js` | 108, 192–209, 232, 590–602, 841–848 | A | 4.5。108（finalCourt の廃止）は残してよい |
| `app.js` | 595–610, 622–633, 667–669, 693, 966, 1038, 1053–1061, 2286–2298, 2338–2339 | B | 5.1 |
| `scoring.html` | 51, 61 | B | 5.2（`.compact` ごと削除） |
| `style.css` | 405, 616–619 | B | 5.2 |
| `desk-match.js` | 21–28, 63–74, 115–131, 161–164, 177–191, 226–235, 359, 437–443, 520–521, 609–689, 783, 812–814, 838, 891–903 | C | 6.1。359 の `desk-match-finale-line` はクラス名なので残してよい |
| `desk.js` | 27–28, 35, 41, 308, 378, 384, 488–491, 502–504 | C | 6.2 |
| `desk-round2.js` | 3, 26–27, 93, 145, 204–228 | C | 6.2 |
| `desk-players.js` | 2384 | C | 6.2 |
| `desk-setup.js` | 142 | C | 残してよい（finalCourt の廃止の経緯） |
| `desk.css` | 55, 485, 514–548 | C | 6.2。`.desk-match-finale-rank`・`.desk-match-finale-line` のクラス名は残してよい |
| `admin-round.js` | 169–212, 340–350, 362–364, 383–384, 425–443, 567–600 | C | 7.1 |
| `admin-players.js` | 1223 | C | 7.1 |
| `admin.js` | 713 | C | 残してよい（経緯） |
| `admin.css` | 386–396 | C | 7.1 |
| `share.js` | 116–130, 182–184, 266 | C | 7.2 |
| `board.js` / `board.html` / `board.css` | 20–21, 82–94, 289–343, 385–388, 410–411, 431, 449 / 56–63 / 183–204 | C | 7.3 |
| `home.js` | 102 | C | 7.5 |
| `index.html` | 64（8 つ）, 66 | C | 7.5 |
| `help.html` | 66, 67, 72, 74, 78, 81, 84, 121, 165, 319, 328, 480, 498–502, 510–520, 572, 607, 622–625, 637–638, 646–654, 853, 930 | C | 8 章。319 の列名「決戦」は残る |
| `tools/mcp/phx-tameshigiri/*` | tools.mjs 11, 74, 78, 83, 222, 240, 256, 451 / server.mjs 28 / test.mjs 7, 523–576 / README.md 117 | C | 7.6 |
| `README.md` 111・`storage.js` 240 | 大会名「名古屋城決戦」 | — | 残す（固有名詞） |
| `test.html` | 10 章 | A・C | 10 章 |

---

## 10. テスト計画

### 10.1 期待値が変わる・消える既存テスト（`test.html`。行は作業ツリーの時点）

| 範囲 | 中身 | 扱い |
|---|---|---|
| 54 | 生成の応答のコメント（finalistCount） | コメントを直す |
| 1049–1051 | ロックガードの前に round2_final を挟む | `round2_final` の段を削除（round2 → round2_done を直接） |
| 1435–1573 | 「暫定ベスト4（決戦）の抽出」（選考・先頭コートの続き番号・同点・0 点除外） | **書き直す**: 「二巡目の並び」— 全員が自分のコートに、コート×性別ごとに一巡目の確定得点の低い順・同点は試技順、`finalist` の印はどの行にも付かない、男子 1 名だけの大会も A コートの男子に 1 番 |
| 1599–1600, 1681–1700 | 決戦以外が先・候補の採番 | 同上に寄せる |
| 1734 | 遷移の応答の `finalistCount` | `round2` に `finalistCount` が無いこと（`created` と `unassignedCount` だけ見る） |
| 1784–1912 | レビュー指摘 J（付け直しで暫定ベスト4 が入れ替わる・候補は先頭コートの末尾） | **付け直しは残す**（D9）ので、「一巡目の得点を戻して直すと**二巡目の番号**が新しい得点の低い順に付け直される・id と技は保たれる」に書き直す。候補の置き場所の検査は削除 |
| 1955–1997 | ranking の `finale` | **削除**。代わりに「ranking に `finale` が無い・`event.status` が今の状態」 |
| 2037–2051 | ranking の `best4` | round2_final を通る段があれば外す。値の検査は残す |
| 2555–2584 | バンドル取り込みで二巡目の `finalist` を取り込む | **反転**: 二巡目・一巡目とも `finalist` は取り込まない |
| 2690–2698 | バンドルの往復で `finalist` が残る | **反転**: 書き出しに `finalist` が無い・取り込み後も無い（`EventStatus.finalists` の呼び出しは削除） |
| 2716–2717 | round2_final を挟む | 削除 |
| 2812–2828 | M2: 二巡目 進行中の決戦の行は 409 not_scorable | 決戦の行の検査を削除（「一巡目終了の後に一巡目の行の得点は not_scorable」は残す） |
| 3006–3041 | M5: 20 列の往復で決戦の印が往復・finale_pending | 「決戦」列は**書き出しが空**・○ を入れた CSV を置換で読んでも `finalist` は付かない・round2 → round2_done は止まらない |
| 3082 | M6: 移行した得点で暫定ベスト4 が選ばれる | 削除（M6 の確定の移行の検査は残す） |
| 3109–3129 | S18（`finalistDiff`） | **削除** |
| 3224–3230, 3322 | 申請の形（決戦の行も申請の形）・CSV 23 列の往復の `finalist` | 決戦の行の検査と列の値を外す |
| 3499–3528 | `listForStatus`（最終組を末尾に・最終組だけ）・`listLayout`・`canDropInList` | `listForStatus` は「round2 は試技順のまま（`finalist` の印があっても寄せない）」に。`listLayout` の検査は削除。`canDropInList` は「同じ組なら印に依らず落とせる」に |
| 4933–4990 | `Courts.finalists`・`statusConfirmMessage`（round2 ↔ round2_final）・`stageCountText`（S12・round2_final）・`progressRound('round2_final')`・`startBlockers` | `Courts.finalists` を削除。確認文は round2 → round2_done だけ。`stageCountText('round2')` は印のある行も数える |
| 5628–5762 | `canTransition` の表（2026-09-22 の決戦を含む）・`finalistDiff` / `finalistDiffMessage` | 2.1 の新しい表に。S18 の検査は削除 |
| 5762–5879 | `playerTotals`・`best4Standings`・`rankMap`・`finalGroupLineText`・`best4LineText` | `playerTotals` の期待値に `counted` を足す。`rankMap` の 6 件は `rankings` に書き換え。`finalGroupLineText` は削除。`best4Standings`・`best4LineText` は残す |
| 5916–6003 | `prev` / `nextStep` / `nextLabel`（決戦あり）・`finalists` / `hasFinalists`・`isPlayerScorable`・`finaleCourt` | `prev('round2_done')` は常に round2、`nextStep('round2')` は round2_done、`nextLabel('round2')` は「二巡目を終了」。他は削除（「その関数が無い」ことを 1 件で確かめてよい） |
| 6086–6134 | `derive` は round2_final を推定しない・`isScoringOpen`・`scoringRound`・`STATES`・`LABELS`・`NEXT_LABELS`・`ROUND2_END_LABEL` | 新しい値に。`derive` の検査は `finalist` の行があっても round2 / round2_done（STATES のどれか）になることだけ |
| 6439–6512 | `Desk.stageOf`（最終組の補足文）・`statusToastText`（最終組の人数）・`MATCH_STEPS`（5 段）・`matchStepIndex`・`stepTodo`・「決戦の語が無い」・最終組の 1 行 | C が追従: 4 段・round2 の 1 行・補足文と人数の検査を削除。「工程表と全状態の 1 行に『最終組』『決戦』の語が無い」に広げる |
| 6847–6866 | Present のベスト4 | 変わらない見込み（round2_final を使っていれば外す） |
| 6922–6951 | 配信ボードの `finaleFor` | **削除**（`Board.finaleFor` が無いことを 1 件） |

### 10.2 足すテスト

**A（共通・サーバー）**
- `EventStatus`: `STATES` が 7 つ・`LABELS` / `NEXT_LABELS` に round2_final が無い・遷移表（2.1）・`normalizeStatus`（round2_final → round2、他はそのまま）・`of({ status: 'round2_final', players: [...] })` が round2・`isRowScorable('round2', { finalist: true, order: 'A-男子-2-5' })` が true・削除した関数が `undefined`（`finalists`・`hasFinalists`・`finaleCourt`・`firstCourt`・`isPlayerScorable`・`pickFinalists`・`finalistDiff`・`rankMap`・`FINALIST_LABEL`）。
- `playerTotals` の `counted`（確定が 1 つでもあれば真・未確定だけなら偽・`countAll` なら採点済みで真）。
- `EventStatus.rankings`: 3 部門の振り分け（新人は男女混合）・同点同順位（1, 1, 3）・氏名順・`key` が `playerTotals` と同じ・**`Api.loadRanking` の `rankings` と（key・counted を除いて）一致**（同じ大会の選手で比べる。二巡目の途中・最終結果の 2 つの時点）。
- `Courts.rankPanel`: 部門の並び（一般男子・新人枠・一般女子）と見出し・`counted` が偽の人を外す・順位は詰めない（確定 0 点の人と未確定の人がいても上の順位が `rankings` と同じ）・空・null で落ちない。
- API: 一巡目の終了で二巡目のどの行にも `finalist` が無い・応答の `round2` に `finalistCount` / `finalistDiff` が無い・履歴の文言に「最終組」が無い。round2 → round2_done が男子のいる大会でも通る。`POST …/status` の `to: 'round2_final'` は 400。
- 旧データ: `status: 'round2_final'` のバンドルを取り込むと `GET` の `status` が round2・二巡目の行（`finalist: true` 付きで送っても）に印が付かない・その大会で round2 → round2_done に進める・二巡目の全行が PATCH で採点できる（`not_scorable` にならない）。
- ranking の `event.status`（運営の API と共有リンクの両方）・`finale` が無い。
- CSV: 書き出しの 19 列目が全行空・見出しは 23 列のまま・「決戦」列に ○ のある CSV の置換で `finalist` が付かない。
- PATCH の性別の写し: 二巡目の行に `finalist: true` が付いていても（PATCH は行をその場で直すので、バンドルでなく大会ファイルを直接置く手段が無ければこの検査は省いてよい）order の性別が組み直る。

**B（採点画面）**
- test.html は app.js を読まないので、画面の確認は手で行う（10.3）。純粋な部分（`Courts.rankPanel`・`listForStatus`・`canDropInList`）は A のテストで固定する。

**C（PC・スマホ・共有・配信・MCP）**
- `DeskMatch.MATCH_STEPS` が 4 段・`matchStepIndex`（round2_done / final / archived が ④）・`stepTodo('round2')`。
- `Desk.stageOf` の二巡目の段が round2・round2_done・`statusToastText` に最終組の人数が出ない（`finalistCount` が来ても）。
- `Share.best4Visible(best4, status)`（round2 / round2_done / final / archived で真、round1_done で偽、status が無ければ `best4.final`）。
- MCP `test.mjs`（7.6）。

### 10.3 手での確認（各担当）

- **B**: 採点画面を 1280px・1920px・768px・375px で開き、(1) 一覧がコートごとに縦に並ぶ（PC は全部開いて畳めない、スマホは採点中だけ開く）、(2) 列が 7 列（運営は掴み手で 8 列）で 660px に収まる、(3) 順位表が一覧の下に 3 列（600px 以上）／縦（未満）、(4) 確定・取り消しで順位表が動き、今の選手が強調される、(5) 採点の鍵（1 コート）の端末でも順位表に全コートの選手が出る、(6) ドラッグ並べ替えが今までどおり動く、(7) 二巡目 進行中に A コートの末尾の行（旧データの印付き）も採点できる。ページが横にスクロールしないこと。
- **C**: PC で draft → round1 → round1_done → round2 → round2_done → final を通し、工程表が 4 段・二巡目は暫定ベスト4 の 1 行と表・二巡目終了の要約にベスト4 の 1 行。スマホの試合進行も同じ。共有ページが round2 で暫定ベスト4 を出す。配信ボードに最終組の表が出ない。発表モードのベスト4 が動く。入口の流れが 7 段。
- 全員: `grep -n "最終組\|round2_final\|finalist" <担当ファイル>` が 9 章の「残してよい」以外で 0 件。`npm test` と `npm run test:browser`（test.html）がすべて通る。

---

## 11. 分担案

| 分担 | 範囲 | ファイル |
|---|---|---|
| **A** サーバー・共通・テスト | 2〜4 章。状態の 7 化と読み替え、最終組の部品の削除、`rankings`・`counted`・`rankPanel`、生成・CSV・バンドル・ranking API、test.html の共通とサーバーの部分 | `status.js`、`courts.js`、`server/index.js`、`api.js`（コメント）、`test.html`（10.1 のうち C の行以外と 10.2 の A） |
| **B** 採点画面 | 5 章。最終組の撤去、縦並び、列の整理、順位表 | `app.js`、`scoring.html`、`style.css` |
| **C** PC・スマホ・共有・配信・入口・ヘルプ・MCP | 6〜8 章 | `desk-match.js`、`desk.js`、`desk-round2.js`、`desk-players.js`、`desk.css`、`admin-round.js`、`admin-players.js`、`admin.css`、`share.js`、`board.js`・`board.html`・`board.css`、`home.js`、`index.html`、`help.html`（⑦⑧ を含む全部）、`tools/mcp/phx-tameshigiri/*`、`test.html`（10.1 の 6439–6512・6847–6866・6922–6951 と 10.2 の C） |

**順番**:
1. **ドラッグ並べ替え（実装中）が master に着地してから**始める（`app.js`・`courts.js`・`test.html`・`help.html`・`style.css`・`scoring.html` が重なる）。
2. **A が先**（B・C が `normalizeStatus`・`rankings`・`rankPanel`・ranking の `event.status` と、削除された部品を前提に直す）。
3. **B と C は並行**でよい（ファイルが重ならない。`help.html` は C だけが触る。`test.html` は C の節だけ）。
4. **1 つのブランチで 3 つがそろうまで反映しない**。A だけ入れると、B・C の画面が削除された `EventStatus.finalists` などを呼んで壊れる。そろったら `npm test`・test.html を全部通してから master → production。

---

## 12. 決定待ち（推奨つき）

| # | 論点 | 推奨 | 他の案 |
|---|---|---|---|
| D1 | 旧データの `round2_final` | **読み込みで `round2` として扱う**（`EventStatus.normalizeStatus`。ファイルは次の遷移・保存で置き換わる。`to: 'round2_final'` は 400） | 状態を残して次を round2_done にする（全画面に旧状態の分岐が残る） |
| D2 | 旧データの `finalist` の印 | **どこでも見ない。保存の経路（大会の保存・バンドル・CSV）では落とす**（CSV 書き出しの「決戦」列は空） | 見ないが運ぶ（`sanitizePlayerForSave`・バンドルで写し続ける。死んだ項目がサーバーに残る） |
| D3 | ranking API の `finale` | **項目ごと外し、`event.status` を足す**（共有ページの表示条件に使う） | `finale: null` を残す（古いページの互換。どちらでも古いページは壊れない） |
| D4 | 順位表に確定した得点の無い選手 | **出さない**（見出しに「確定した得点の合計」。結果確認と違うことをヘルプに書く。順位は全員で付けたものを使い、間を詰めない） | 結果確認と同じく全員（0 点で末尾に並ぶ。準備中・一巡目の序盤は 0 点の名前ばかりになる） |
| D5 | 順位表を 3 列にする幅 | **600px 以上**（ページ幅 660px の中。iPad の縦でも 3 列） | 1100px 以上（一覧の開閉と同じ境目。iPad は縦並び） |
| D6 | PC（1100px 以上）でのコートの見出し | **押しても畳まない**（全コート常に開く。今の広い窓と同じ） | 既定で全部開き、見出しで畳める |
| D7 | 順位表で今の選手を強調 | **する**（一覧の今の選手と同じ色） | しない |
| D8 | PC 試合進行のベスト4 の表（暫定ベスト4（合計）の表） | **残す**（コートのカードの下へ。1 行と同じ値） | 1 行だけにする |
| D9 | `reorderRound2`（誰も二巡目を採点していないときの番号の付け直し） | **残す**（一巡目を直して終了し直したとき、二巡目の順が新しい得点の低い順になる）。手で並べ替えた二巡目の順も、一巡目に戻して終了し直すと付け直される（ヘルプに 1 行） | やめる（差分追加だけにする。戻して直した得点が二巡目の順に反映されない） |
| D10 | status を持たない旧データの大会（全行を数える `countAll`）の順位表 | **今回は直さない**（`GET /api/events/:id` が `status` を推定値で埋めるので画面からは見分けられない。「確定」の機能より前の大会だけの差。結果確認の順位とずれることがある、と注記） | 応答に `countAll` の 1 項目を足して画面で使う（`admin-round.js` の `best4Of` も同じ問題を持つので一緒に直る） |
| D11 | 順位表の名前が長いとき | **折り返す**（省略しない） | 省略記号と title |
| D12 | 順位表が長いとき（一般男子が多い大会） | **全員を出し、ページのスクロールに任せる**（区画の中にスクロールを作らない） | 部門ごとに高さを 50vh にして中でスクロール |

---

## 13. 変えないこと

- 試技は一巡目・二巡目の 1 回ずつ。順位は合計（一巡目＋二巡目）。順位の集計の規則（合算キー・確定済みだけ・同点同順位・氏名順）。
- 二巡目の行の作り方（申請の形・コート×性別ごとに一巡目の確定得点の低い順・同点は試技順）。
- ベスト4（`best4Standings`・`best4LineText`・ranking の `best4`・発表モードのカウントダウン・共有ページの表・二巡目終了と表彰の要約の 1 行）。
- 採点の鍵の範囲（`GET /api/events/:id` は全コートの選手・順位 API は呼べない・1 コートの鍵は他のコートを見るだけ）。
- CSV の 23 列・20 列の見出し（列名「決戦」も）と `round2_format` の条件。
- 上部の状態バーの 5 段の見た目（中の状態の振り分けだけ変わる）。
- 結果確認（PC・スマホ）・順位表ページ（`ranking.html`）・発表モード。
- ドラッグ並べ替え（採点画面・選手登録）。
