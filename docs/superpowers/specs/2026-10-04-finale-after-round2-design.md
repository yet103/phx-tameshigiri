# 決戦は二巡目のあと（合計の上位 4 名が A コートでもう 1 回斬る）

**日付**: 2026-10-04
**対象**: phx-tameshigiri（試し斬り採点システム。master f1dbc20 起点）
**置き換える設計書**（過去の設計書は書き換えない。食い違うところは本書が優先）:
- [2026-09-28-finale-on-first-court-design.md](2026-09-28-finale-on-first-court-design.md) — **本書で置き換えた**。「一巡目終了時に暫定ベスト4 を選び、二巡目の行に `finalist` の印を付けて先頭コートの男子の末尾に置く」「`round2` は印の無い行だけ、`round2_final` は印のある行だけ採点」「集計は一巡目＋二巡目、3 本目は無い」はすべて廃止。決戦は**巡 3 の行**になる。
- [2026-10-01-finale-best4.md](2026-10-01-finale-best4.md) — 人数（4・同点は全員・0 点除外・一般男子）は引き継ぐ。**選ぶ材料を「一巡目の確定得点」から「一巡目＋二巡目の確定得点の合計」に変える**。
- [2026-09-22-round2-prep-and-finale-design.md](2026-09-22-round2-prep-and-finale-design.md) の決戦の部分、[2026-10-01-audit-fixes-design.md](2026-10-01-audit-fixes-design.md) の S12（二巡目の件数から決戦を除く）・S18（選考の差 `finalistDiff`）。

**前提として引き継ぐ設計書**: 2026-10-01-audit-fixes（rev・`baseRev`・409 の reason・順位の合算キー `sourcePlayerId ?? id`・CSV の往復）、[2026-10-03-round2-forms-prereg-design.md](2026-10-03-round2-forms-prereg-design.md)（二巡目の形の申請 `r2tech`）、[2026-10-03-invite-links-and-ai-key-design.md](2026-10-03-invite-links-and-ai-key-design.md)（採点の鍵のコートの範囲・AI 用 MCP ツール）。

---

## 0. 背景と決定

いまの決戦は、一巡目を終えた時点の一巡目の確定得点で「暫定ベスト4」を固定し、その 4 名が A コートの二巡目の末尾で斬る 1 回（＝その人の二巡目）を決戦と呼んでいる。最終順位は全員「一巡目＋二巡目」の合計。二巡目で点が入るたびに他の選手が合計で 4 名を追い越せるので、**順位表の上位 4 と決戦の 4 名がずれる**。筋が通っていない（ユーザー指摘 2026-10-04）。

ユーザーの決定（2026-10-04。推奨どおり承認）:

1. **二巡目は全員が普通に斬る。** 並びは今までどおり（コート×性別ごとに一巡目の確定得点の低い順）。二巡目の形の申請（`r2tech`）もそのまま。
2. **二巡目の途中は「暫定ベスト4」を出す。** 二巡目を斬り終えた（確定した）一般男子の合計（一巡目＋二巡目）の上位 4 名。点が入るたびに動く。残り人数も添える。
3. **一般男子が全員、二巡目を確定した時点で、合計の上位 4 名が決まる。** 4 位が同点なら全員。合計 0 点以下は含めない（9 章 D3）。
4. **その 4 名が A コート（先頭コート）で決戦として、もう 1 回斬る（三度目の試技）。** 順番は合計の低い順。形は二巡目と同じ（決戦用の申請は作らない）。
5. **最終順位**: 一般男子は、決戦に出た人は 一巡目＋二巡目＋決戦、ほかは 一巡目＋二巡目。新人枠・一般女子は従来どおり 一巡目＋二巡目。決戦の 4 名は 1〜4 位に残り、決戦の点で並びが決まる（同点は同順位）。

本書の推奨（9 章の決定待ちで最終確認する）:

| 論点 | 推奨 |
|---|---|
| データ | **案 A: 決戦は巡 3 の行**（`A-男子-3-n`）。「決戦を開始」でサーバーが作る。**判定は巡目だけ**（`roundOf(p) === 3`）。`finalist` の印は新しい行には付けない（1.2） |
| 決戦の開始（`round2 → round2_final`） | **一般男子の二巡目が全員確定していること**（409 `round2_pending`。force でも越えない）。サーバーが上位 4 を選び、巡 3 の行を作る（3.3） |
| 戻す（巡 3 の行がある状態 → `round2` 以前） | 巡 3 の行が**未採点なら消す**、採点済み（○×・補正・確定のどれか）が 1 つでもあれば **409 `finale_scored`** で止める（3.4） |
| 一巡目終了時の二巡目生成 | `finalist` の印と先頭コート末尾への配置を**無くす**（全員を元のコートに置く）（3.2） |
| 選考の差の警告 | `finalistDiff`（S18）は**廃止**し、「今の二巡目までの確定得点で選び直した結果と、巡 3 の行の差」の警告 `finaleDiff` に**置き換える**（2.6） |
| 合計のまとめ方 | `computeRanking` の「一巡目の行ごとに合算」を **`status.js` に移して共通化**し、順位・暫定ベスト4・決戦の選考・決戦の表がすべて同じまとめ方を使う（2.3。「順位表の上位 4 ＝ 決戦の 4 名」を構造で保証する） |
| 最終順位の並び | 一般男子は**決戦に出た人を先に**（その中で合計の降順）、続いてほかの人。決戦の点が負でも 5 位以下と入れ替わらない（3.6） |
| 旧データ | **移行しない**。巡 2 の行の `finalist` の印（旧方式）は保存・往復はするが**判定には使わない**（7 章） |

---

## 1. 用語とデータの形

### 1.1 用語

- **一巡目の行・二巡目の行** … 従来どおり（`order` の巡目が 1・2）。
- **決戦の行** … `order` の巡目が **3** の行（`<先頭コート>-男子-3-<n>`）。「決戦を開始」でサーバーが作る。`sourcePlayerId` で一巡目の行を指す。
- **一般男子** … `isFemale !== true` の選手（新人を含む。順位の「一般男子」と同じ）。
- **合計（二巡目まで）** … 一巡目の確定得点＋二巡目の確定得点（2.3 のまとめ方で、一巡目の行ごとに足す）。
- **暫定ベスト4** … 二巡目 進行中に、二巡目を確定した一般男子の合計の上位 4 名（同点は全員）。表示だけ。
- **決戦（ベスト4）** … 一般男子が全員二巡目を確定したあとの合計の上位 4 名（同点は全員、合計 1 点以上）。「決戦を開始」で決戦の行になる。
- **先頭コート** … `EventStatus.firstCourt(EventStatus.round1Sources(players))`（一巡目に選手のいるコートの文字列昇順の先頭。通常 A。`settings.courts` だけのコートは使わない。今の決戦の置き場所と同じ規則）。

### 1.2 決戦の行（案 A を採る理由）

```
players[]（巡 3 の行。「決戦を開始」で作る）
  id:             新しい id
  name, isNewFace, rank, rental, bib … 一巡目の行（無ければ二巡目の行）から複製
  isFemale:       false
  order:          <先頭コート>-男子-3-<n>      n は 1 から、合計の低い順（3.3）
  tech1〜3:       その選手の二巡目の行の tech1〜3 の複製
  score: 0, result: ''
  sourcePlayerId: 一巡目の行の id（二巡目の行の sourcePlayerId と同じ）
  （finalist は付けない）
```

**案 A（巡 3 の行）を推奨する理由**: 採点画面・送信キュー・rev と `baseRev`・`isRowScorable`・配信ボードの live・履歴・CSV・バンドル・選手の表は、すべて「行」を単位に動いている。巡 3 の行にすれば、採点・確定・補正・取り消し・再計算・409 `stale` がそのまま乗る。`order` の巡目は既に 1〜9 を受け付けており（`server/index.js` の `parseOrder`・PATCH の `round` 検証）、`roundOf` は 3 を返せる。合算キー（`sourcePlayerId ?? id`）もそのまま効く。

**案 B（二巡目の行に決戦の得点を別項目で持つ）を採らない理由**: 1 行に 2 回分の ○×・補正・確定・rev を持たせることになり、採点画面・送信キュー・PATCH の検査・CSV の列・バンドルをすべて二重に作る必要がある。

**`finalist` の印を巡 3 の行に付けない理由**: 判定を巡目 1 つにする（印と巡目の 2 つを持つと「巡 3 なのに印が無い」「巡 2 なのに印がある」の食い違いの扱いが要る）。CSV の「決戦」列・MCP の `finalist`・画面の「決戦」の印は巡目から導く。旧方式の巡 2 の印は 7 章のとおり無視する。

### 1.3 状態と巡目の対応

| 状態 | 採点できる巡目（`scoringRound`） | 巡 3 の行 |
|---|---|---|
| `round1` | 1 | 無い |
| `round1_done` | なし | 無い |
| `round2` | **2（全員。決戦の除外は無くなる）** | 無い（入るときに消すので） |
| `round2_final` | **3** | ある（0 名の大会はこの状態に入れない） |
| `round2_done` / `final` / `archived` | なし | 決戦をした大会だけある |

不変条件: **巡 3 の行は `round2_final`・`round2_done`・`final`・`archived` のときだけ存在する**（3.4 で守る。CSV・バンドルの取り込みで外から入ってきた場合は 7.3）。

---

## 2. 共通部品（`status.js`）

### 2.1 定数

- `FINALIST_COUNT = 4`（変えない）。
- `FINALE_ROUND = 3`（新設）。
- `FINALIST_LABEL = '暫定ベスト4'`（変えない。二巡目 進行中の表示に使う）。
- `FINALE_LABEL = '決戦（ベスト' + FINALIST_COUNT + '）'`（新設。決まった 4 名の呼び名。工程表の ④ と同じ語）。

### 2.2 判定の差し替え

| 関数 | 今 | これから |
|---|---|---|
| `finalists(players)` | 巡 2 で `finalist === true` の行 | **巡 3 の行**（`roundOf(p) === FINALE_ROUND`）。並べない |
| `hasFinalists(players)` | 上の有無 | 同じ（意味だけ変わる） |
| `finaleCourt(players)` | 印のある巡 2 の行の先頭のコート | **巡 3 の行**の（コート → 性別 → 番号）の先頭のコート。無ければ `''` |
| `scoringRound(status)` | `round2_final` → 2 | **`round2_final` → 3** |
| `isPlayerScorable(status, player)` | `round2` は印なし、`round2_final` は印ありだけ | `player` が無い・`scoringRound(status)` が null なら true、それ以外は `roundOf(player) === scoringRound(status)` |
| `isRowScorable(status, player)` | 変えない（中で `scoringRound` と `isPlayerScorable` を使うので、`round2` は巡 2 の全員、`round2_final` は巡 3 だけになる） | |
| `nextStep('round2', players)` | 印があれば `round2_final` | **`finalePlan(players).state === 'none'` なら `round2_done`、それ以外は `round2_final`**（2.5） |
| `nextLabel('round2', players)` | 印が無ければ「二巡目を終了」 | `state === 'none'` なら `ROUND2_END_LABEL`（二巡目を終了）、それ以外は「決戦を開始」 |
| `prev(status, players)` | 変えない（`round2_done` は巡 3 の行があれば `round2_final`、無ければ `round2`） | |
| `derive(event)` | 変えない（status の無い旧データだけが通る。巡 3 の行は通常の流れでは存在しない） | |
| `pickFinalists(rows)` | 一巡目の行から選ぶ | **廃止**し `finalePlan(players).best` に置き換える（引数が「一巡目の行」から「全行」に変わるので名前ごと変える。残すと旧い意味で呼ばれる） |
| `finalistDiff(players)` | 一巡目の得点と巡 2 の印の差 | **廃止**。`finaleDiff(players)`（2.6）に置き換える |

`round1Sources`・`firstCourt`・`confirmedScoreOf`・`revOf`・申請の関数は変えない。

### 2.3 合計のまとめ方を共通化する（`playerTotals`）

今は `server/index.js` の `computeRanking`（459 行）だけが「一巡目の行ごとに合算」を持っている。暫定ベスト4・決戦の選考・決戦の表・順位が別々に足し算をすると、同姓同名・`sourcePlayerId` の無い旧行・CSV 由来の行の扱いがずれて、また「順位表の上位 4 と決戦の 4 名が違う」が起こりうる。**まとめ方を `status.js` に移し、全部がこれを使う。**

```
EventStatus.playerTotals(players, opts) → groups[]
  opts.countAll … true なら確定の印を見ずに得点を数える（status を持たない旧データ。server の countsAllScores）
  group = {
    key,          'id:<一巡目の行の id>' | 'row:<添字>' | 'name:<女|男>|<氏名>'（今の computeRanking と同じ）
    rep,          代表の行（一巡目の行。無ければ最初に入った行）
    r1Id,         一巡目の行の id（key が 'id:' のとき。無ければ null）
    name,         代表の氏名（trim）。空なら組の中の最初の空でない氏名（今の namesByKey と同じ）
    isFemale, isNewFace,   代表から
    r1, r2, r3,   巡ごとの得点の和（確定済みだけ。countAll なら全部）。
                  巡 1・3 以外（2 と 4〜9）は r2 に入れる（今の computeRanking が巡 2 以降を全部足しているのを変えない）
    r2Rows, r3Rows,   その組の巡 2（と 4〜9）・巡 3 の行
    r2Done,       r2Rows が 1 つ以上あり、全部確定済み（countAll なら全部 isScored）
  }
```

- 組の作り方は今の `computeRanking` と**一字一句同じ規則**にする（1 周目で一巡目の行が組を作る、2 周目で巡 2 以降の行が `sourcePlayerId` で入る、無ければ同じ氏名・性別の一巡目の組、それも無ければ `name:` の組）。辞書は `Object.create(null)`。
- 並びは組ができた順（`keys` の順）。
- `server/index.js` の `computeRanking` はこれを呼ぶだけにする（3.6）。既存の M1 のテスト（同姓同名・氏名の直し・旧データ）がそのまま通ることで移植を確かめる。

### 2.4 暫定ベスト4（`finaleStandings`）

```
EventStatus.finaleStandings(players, opts) → {
  males,      二巡目の行がある一般男子の組の数（group.isFemale !== true && r2Rows.length > 0）
  done,       そのうち r2Done の数
  remaining,  males - done
  ranked: [{ group, total, rank }]   r2Done の組を total = r1 + r2 の降順（同点は氏名の 'ja' 順で安定）。
                                      rank は同点同順位（1, 1, 3）
  best:   [{ group, total, rank }]   ranked のうち total > 0 で、rank <= FINALIST_COUNT のもの
                                      （＝ FINALIST_COUNT 位の合計以上の全員。4 位が同点なら 5 名以上）
}
```

- 母集団は**二巡目の行がある一般男子**。コートが未分類で二巡目の行が作られなかった選手は入らない（二巡目を斬っていないので）。
- 女子・巡 3 の行は見ない（`r3` は足さない）。
- `opts.countAll` は `playerTotals` にそのまま渡す。

### 2.5 決戦の段取り（`finalePlan`）

```
EventStatus.finalePlan(players, opts) → {
  state:  'none'    … 決戦は無い（males === 0、または remaining === 0 で best が 0 名）
          'pending' … 一般男子の二巡目に未確定がいる（remaining > 0）。決戦はまだ始められない
          'ready'   … remaining === 0 で best が 1 名以上
  standings: finaleStandings の戻り値
  best:   ready のときの決戦の顔ぶれ（試技順＝合計の低い順。同点は一巡目の行の試技順＝コート→男子→番号の数値）。
          それ以外は []
}
```

- `nextStep` / `nextLabel` / サーバーの遷移の検査 / 確認文 / 工程表の 1 行は、すべてこれで判定する（画面とサーバーで判定を 1 つにする）。
- `pending` のときにボタンは「決戦を開始 ▶」のまま（最後に全員 0 点だと `none` になり「二巡目を終了 ▶」に変わるが、全員が確定するまでは分からないので、決戦がある前提で出す）。

### 2.6 選考の差（`finaleDiff`。S18 の置き換え）

決戦を始めたあと、二巡目の行の得点を直す（運営の force の訂正）・確定を外すと、今の合計で選び直した顔ぶれと巡 3 の行がずれる。

```
EventStatus.finaleDiff(players, opts) → {
  changed,                       missing か extra があれば true
  missing: [{ name, total }],    今の best に入るのに巡 3 の行が無い組
  extra:   [{ name, total }],    巡 3 の行があるのに今の best に入らない組
  pending,                       standings.remaining（一般男子の二巡目の未確定の数。0 でなければ文言に添える）
  finaleScored                   巡 3 の行に採点済み（isScored か confirmed）があるか
}
```

- 巡 3 の行が 1 つも無いときは `changed: false`（まだ選んでいない）。
- 比べる単位は組の key（巡 3 の行の組＝その行の `sourcePlayerId` / 氏名で決まる組）。
- 文言（`Courts.finaleDiffMessage`）:
  - 1 行目 `⚠ 決戦（ベスト4）が、今の二巡目までの確定得点で選び直した結果と違います。`
  - `入るべき選手: 名前（合計 n 点）、…` / `外れるべき選手: …`（先頭 `BLOCKER_NAME_LIMIT` 名まで。今の `finalistDiffMessage` と同じ作り）
  - `pending > 0` なら `一般男子の二巡目に未確定が m 名います。`
  - `finaleScored` が false なら `「◀ 二巡目 進行中 に戻す」で決戦の行を消し、もう一度「決戦を開始」を押すと選び直せます。`、true なら `決戦に採点済みの選手がいるため、自動では選び直しません。決戦の選手を確認してください。`
- 出す場所: 試合進行（PC・スマホ）で `round2_final`・`round2_done` のとき。形登録の区画（`round1_done` だけ）には出さない（決戦がまだ無いので）。

### 2.7 例（男子 6 名・女子は省略）

| 選手 | 一巡目 | 二巡目 | 合計 | 決戦の試技順 | 決戦 | 最終 |
|---|---|---|---|---|---|---|
| M1 | 60 | 10 | 70 | 1（同点は一巡目の試技順が先） | 30 | 100（4 位） |
| M6 | 35 | 35 | 70 | 2 | 10 | 80（5 位） |
| M2 | 55 | 30 | 85 | 3 | 40 | 125（1 位） |
| M3 | 50 | 40 | 90 | 4 | 20 | 110（3 位） |
| M4 | 45 | 50 | 95 | 5 | 25 | 120（2 位） |
| M5 | 40 | 20 | 60 | — | — | 60（6 位） |

4 位の合計 70 が同点なので決戦は 5 名。最終順位は決戦に出た 5 名が先（決戦の点を足した合計の降順）、M5 が 6 位。今の仕組みでは一巡目だけで M1・M2・M3・M4 が固定され、二巡目の M6（合計 70）が順位表で M1 と並ぶのに決戦に出られなかった。

---

## 3. サーバー（`server/index.js`）

### 3.1 共通

- `parseOrder` / `buildOrder` / `nextOrderNumber` は巡 3 をそのまま扱える（変えない）。
- 新しい 409 の reason: `round2_pending`、`finale_scored`。既存の `no_finale`・`finale_pending` は意味を 3.3 のとおりに変える。

### 3.2 二巡目の生成（`buildRound2Row` 3965 行・`generateRound2` 4012 行・`reorderRound2` 4099 行）

- `pickFinalists` / `finalistIds` / `finals` / `compareByScoreAsc` / `finaleCourt` の変数を消す。`src`（差分追加では `targets`）を全部 `compareForRound2` で並べ、**それぞれの元のコート**に置く。
- `buildRound2Row(players, newRows, p, court, isFemale)`（引数 `finalist` を消す）。`reorderRound2` の `place` からも `finalist` を消す。作り直し（`reorderRound2`）で旧方式の印は自然に消える（新しい行の入れ物に印を写さない）。
- 戻り値と応答から `finalistCount` と `finalistDiff` を消す（`POST …/status` の `round2` と `POST …/rounds/2/generate` の両方）。履歴の文言から「決戦 n 名」を消す（`二巡目 n 名を生成`）。
- `compareByScoreAsc` は 3.3 の試技順で使うので名前を変えて残してよい（`compareFinaleOrder`）。

### 3.3 決戦を開始する（`POST /api/events/:id/status` の `round2 → round2_final`。2019 行）

検査（この順。断るときは何も書かない）:

1. `plan = EventStatus.finalePlan(players, { countAll: countsAllScores(event) })`。
2. `plan.state === 'none'` → **409 `no_finale`**（`決戦に進む選手がいません（一般男子の合計が 1 点以上の人がいない）。「二巡目を終了」で進めてください`）。
3. `plan.state === 'pending'` → **409 `round2_pending`**（`一般男子の二巡目が全員確定していません（未確定 m 名）`。本文に `pendingCount` と `pending: [{ name, order }]`（先頭 10 名））。**force でも越えない**（越えると、未確定の人を除いて選ぶことになり、選考がずれる）。
4. 巡 3 の行が既にある（7.3 の外から入った場合だけ）→ 未採点なら消してから作る。採点済みがあれば **409 `finale_scored`**。

作る（純粋関数 `buildFinaleRows(players, plan)` → `{ rows, court }`。`generateRound2` と同じく同期のまま）:

- コート: 先頭コート（1.1）。
- 並び: `plan.best`（合計の低い順、同点は一巡目の行の試技順 `compareRound1Order`）。番号は 1 から（`nextOrderNumber(players.concat(rows), court, '男子', 3)`）。
- 項目: 1.2 のとおり。`tech1〜3` はその組の二巡目の行（`group.r2Rows` を `compareRound1Order` 相当の order 順で並べた先頭）の技を複製。`sourcePlayerId` は `group.r1Id`、無ければ二巡目の行の `sourcePlayerId`、それも無ければ付けない（順位は氏名の組で合算される）。
- `event.players = players.concat(rows)`、`event.status = 'round2_final'`、`event.live = {}`、書き出し。
- 応答: `{ success, status, round2: null, finale: { created, court, names: [試技順の氏名] } }`。
- 履歴: `二巡目 進行中 → 決戦 進行中（決戦 n 名を作成。A コート）`。

`round2 → round2_done`（2025 行）:

- `plan.state === 'none'` → 通す（決戦の無い大会。今と同じ）。
- それ以外 → **409 `finale_pending`**（`決戦があります。一般男子の二巡目が全員確定したら「決戦を開始」を押してください`）。

`round2_final → round2_done`: 硬い条件は無い（今と同じ。未確定の件数は確認文で出す）。

### 3.4 戻す（巡 3 の行を消す）

**行き先が `draft`・`round1`・`round1_done`・`round2` のどれかで、巡 3 の行があるとき**（通常は `round2_final → round2`。遷移表は `round2_done → round2`・`final → round1_done` も許すので、それらも同じに扱う）:

- 巡 3 の行に採点済み（`isScored` か `confirmed === true`）が 1 つでもあれば **409 `finale_scored`**（`決戦に採点済みの選手が n 名います。戻す前に、選手の区画で決戦の行の採点を消すか行を削除してください`。本文に `scoredCount`）。force は受けない（9 章 D5）。
- 無ければ巡 3 の行を全部消してから状態を変える。応答に `finale: { removed: n }`、履歴に `（決戦の行 n 件を削除）`。

### 3.5 決戦の表（`computeFinale` 396 行）

`finale` を 2 つの形にする（`phase` で区別）。○×の生データは今どおり返さない。

```
null                                   … 下のどれにも当たらない
{ phase: 'provisional', status: 'round2', court: '',
  males, done, remaining,
  rows: [{ name, r1, r2, total, rank }] }      … status が round2 で males > 0。rows は standings.best（合計の降順）
{ phase: 'finale', status, court,
  rows: [{ name, order, r1, r2, base, r3, total, scored, rank }] }
                                       … 巡 3 の行があるとき（状態を問わない）
```

- `finale` の形: `order` は巡 3 の番号（試技順）、`r1`・`r2` はその組の確定得点、`base = r1 + r2`、`r3` は巡 3 の行が確定済みならその得点・未確定なら `null`、`total = base + (r3 ?? 0)`、`scored = r3 !== null`、`rank` は `scored` の行だけで `total` の降順（同点同順位。今と同じ）。`court` は `EventStatus.finaleCourt(players)`。
- `round1_done` は `null`（候補名を公開しない。今の share の考え方を引き継ぐ）。
- 呼び出し側の互換: `board.js` の `finaleFor` は `status === 'round2_final'` のときだけ出すので、`provisional` は配信ボードに出ない（9 章 D7）。`present.js` の最初のモードの判定（`status === 'round2_final'`）も変わらない。

### 3.6 順位（`computeRanking` 459 行）

- `EventStatus.playerTotals(players, { countAll: countsAllScores(event) })` を呼び、組ごとに:
  - 一般男子（`isFemale !== true`）: `score = r1 + r2 + r3`、`finalist = r3Rows.length > 0`。
  - 新人枠（`isNewFace === true` の男子・女子）: `score = r1 + r2`（決戦の点は足さない。ユーザー決定 5）。
  - 一般女子: `score = r1 + r2`（`r3` は持たないはず。持っていても足さない）。
  - 今は male と newFace に同じ entry オブジェクトを入れているので、**部門ごとに別の entry を作る**。
- 一般男子の並び: **`finalist` の組を先に**、その中で `score` の降順、続いて他の組を `score` の降順（どちらも同点は氏名の 'ja' 順）。順位は同点同順位だが、**`finalist` と非 `finalist` の境では順位を分ける**（9 章 D4）。
- entry: `{ rank, name, score }` に、一般男子で `finalist` の組だけ `finale: r3`（決戦の確定得点。未確定なら 0）を足す。ほかの部門には足さない。
- `finale: computeFinale(event)` は 3.5。

### 3.7 選手の更新（PATCH 2653 行）

- 採点の可否は `isRowScorable` のまま（`round2_final` は巡 3 だけ、`round2` は巡 2 の全員。force で越えられるのも今どおり。運営が決戦中に二巡目の得点を直す経路）。
- **申請の書き写し（2806 行の `linkedRows` で技を写すところ）は巡 2 の行だけに絞る**。`linkedRows` 自体（氏名・新人・性別・ゼッケン・級位段位・レンタルの伝播）は巡 3 の行にも及ぶ（同じ選手なので）。`r2tech` を直しても決戦の行の技は変わらない（9 章 D6）。`round2LinkedScored`（courts.js）と `syncRound2 && r2Sent` の 409 `scored` の判定も、巡 2 の行だけを見る。
- 性別を写すときの order の組み直し（2945 行の `p.finalist !== true`）は **`roundOf(p) !== 3`** に変える（決戦の行は先頭コートの男子に置く約束。旧方式の印は見ない）。
- 二巡目の行の技を直したときの申請への書き戻し（2962 行）は今どおり巡 2 だけ。巡 3 の行の技を直しても書き戻さない。

### 3.8 CSV（取り込み 3178 行・書き出し 3387 行）

- 取り込みの「二巡目がある大会は往復の形式だけ」の判定を `roundOf(p) === 2` から **`roundOf(p) >= 2`** にする（巡 3 の行がある大会も同じに守る）。
- 書き出しの 19 列目「決戦」: **`roundOf(p) === 3`、または `roundOf(p) === 2 && p.finalist === true`（旧方式）なら `○`**。
- 取り込みの「決戦」列: 巡 2 の行は今どおり `finalist` に読む（旧方式の往復。判定には使わない）。巡 3 の行は列を見ない（巡目で決まる）。
- 20 列目「一巡目の行」: 巡 3 の行も今の処理（`roundOfRow[i] !== 1`）でつなぎ直される。変えない。
- 列の数（23）・見出しは変えない。

### 3.9 バンドル・大会のコピー

- `pickBundlePlayer`・`sanitizePlayerForSave`: 変えない（`finalist` は巡 2 の行にだけ残す＝旧方式の往復。巡 3 の行は `order` で往復する）。
- 大会のコピー（`withPlayers`）は一巡目の行だけなので影響なし。

### 3.10 採点の鍵・配信の live

- 採点の鍵の PATCH（`authz.checkScorerPatch`）は行のコートで判定する。決戦の行は先頭コートなので**先頭コートの鍵で採点できる**（設計書 2026-10-03 の 443 行の記述どおり。変更なし）。他コートの鍵では 403 `scope`。
- `PUT /api/events/:id/live/:court` も同じ（変更なし）。

---

## 4. 共通部品（`courts.js`）

| 関数 | 変更 |
|---|---|
| `finalists(players)` | 変えない（`EventStatus.finalists` を `compareOrder` で並べる。巡 3 の行が試技順に並ぶ） |
| `finaleCourt` | 変えない（呼び直すだけ） |
| `progressRound(status, players)` | **`round2_final` は 2 を返す**明示の分岐を足す（`scoringRound` が 3 になるため。コートのカードは二巡目の行で数え、決戦は別のカード）。テスト「progressRound: round2_final は二巡目」はそのまま通る |
| `stageCountText` | `round2_final`: `'決戦 確定 a / b'`（巡 3 の行）。`round2`: **巡 2 の全員**で `'確定 n / N'`（S12 の決戦の除外を消す）。コメントの「scoringRound('round2_final') は 2」を直す |
| `unconfirmedWarning(list, rounds)` | 巡の名前を `1 → 一巡目`、`2 → 二巡目`、`3 → 決戦` に。`to === 'final'` の確認は `[1, 2, 3]` を数える |
| `statusConfirmMessage` | 5 章 |
| `finaleStartBlockers(players)`（新設） | `finalePlan(players).state === 'pending'` なら `[{ kind: 'round2Pending', players: 未確定の一般男子の二巡目の行（compareOrder 順） }]`、それ以外は `[]`。`BLOCKER_LABELS.round2Pending = '一般男子の二巡目の未確定'` |
| `best4LineText(players)`（新設） | 6.1 の 1 行（PC とスマホで共用。純粋関数） |
| `finalistDiffMessage` | **廃止**。`finaleDiffMessage(diff)`（2.6）に置き換える |
| `round2LinkedScored` | 巡 2 の行だけを見る（3.7） |

`isTechMissing`・`round2Differs`・`techCopyTargets`・`round2StartBlockers` は巡 2 の行だけを見ているので変えない。

---

## 5. 確認文・止める条件

### 5.1 決戦を開始（`round2 → round2_final`）

- `Desk.applyStatus`（`desk.js`）とスマホの遷移（`admin-round.js`）は、押した直後に大会を読み直している。その読み直した選手で `Courts.finaleStartBlockers` を見て、引っかかれば **`alert(Courts.blockerMessage(blockers, '決戦を開始できません。一般男子の二巡目が全員確定していません。'))` で止める**（確認して進むにはしない。二巡目の開始の検査と同じ作法）。
- ボタンは押せるままにする（二巡目の途中は確定が刻々と増え、試合進行はポーリングしないので、押せなくすると「↻ 最新に更新」を押すまで押せない。押したときに最新で判定するほうが当日の手間が少ない）。
- 通れば確認文:

```
決戦（ベスト4）: 一般男子の合計（一巡目＋二巡目）の上位 n 名です。
A コートで、合計の低い順に斬ります。
  1. M1（70 点）
  2. M6（70 点）
  3. M2（85 点）
  …
[⚠ 二巡目の未確定（一般女子など）が m 名います。決戦 進行中は二巡目を採点できません。]   ← m > 0 のときだけ
A コートの端末は、大会を選び直すと決戦の選手が出ます。
決戦を開始しますか？
```

- 女子など一般男子以外の二巡目の未確定は**止めない**（決戦の選考に関係しない）。ただし `round2_final` では巡 2 を採点できないので、確認文で知らせる（9 章 D2）。

### 5.2 そのほか

| 遷移 | 確認文 |
|---|---|
| `round2 → round2_done`（決戦なし） | 今どおり（`二巡目の未確定が n名います。／いません。` ＋ `二巡目を終了しますか？`） |
| `round2_final → round2_done` | `決戦の未確定が n名います。／いません。` ＋ `決戦を終了しますか？`（数えるのは巡 3 の行） |
| `round2_final → round2`（戻す） | 巡 3 に採点済みがあれば、確認の前に `alert('決戦に採点済みの選手が n 名います。戻す前に、選手の区画で決戦の行の採点を消すか行を削除してください。')` で止める。無ければ `決戦の行（n 名）を消して、二巡目 進行中に戻します。よろしいですか？` |
| `round2_done → round2_final`（戻す） | 今どおり（`決戦 進行中に戻します。よろしいですか？`） |
| `→ final` | `unconfirmedWarning(list, [1, 2, 3])` ＋ 今の文言 |

---

## 6. 画面

### 6.1 暫定ベスト4 の 1 行（`Courts.best4LineText(players)`）

`finalePlan(players)` から作る。PC の試合進行（工程表の下）とスマホの試合進行（状態の 1 行の下）で、**`round2` のときだけ**出す。

| 場合 | 文言 |
|---|---|
| `males === 0` | `決戦はありません（二巡目に一般男子がいません）` |
| `done === 0` | `暫定ベスト4: まだ二巡目を終えた一般男子はいません（残り m 名）` |
| `remaining > 0` | `暫定ベスト4（二巡目を終えた n 名のうち）: M4（95）・M3（90）・M2（85）・M1（70）・M6（70）（残り m 名）` … 合計の降順。括弧は合計 |
| `state === 'ready'` | `決戦（ベスト4）が決まりました: M1（70）・M6（70）・M2（85）・M3（90）・M4（95）。「決戦を開始 ▶」で A コートで斬ります（合計の低い順）` … 試技順 |
| `state === 'none'`（全員確定・全員 0 点以下） | `決戦の候補はいません（一般男子の合計が 1 点以上の人がいない）` |

名前は trim、空なら `(名称未設定)`。コート名は先頭コート（1.1）。

### 6.2 PC 試合進行（`desk-match.js`）

- **工程表**（`MATCH_STEPS`）: 5 段の名前は変えない（④ は `'④ ' + EventStatus.FINALE_LABEL`。文字列は今と同じ「④ 決戦（ベスト4）」）。
- **`stepTodo`**:
  - `round2`（`state !== 'none'`）: `各コートで二巡目を採点しています。一般男子が全員確定すると合計の上位 4 名（決戦）が決まります。そろったら「決戦を開始 ▶」を押します。`
  - `round2`（`state === 'none'`）: 今どおり（`…全コートの確定がそろったら「二巡目を終了 ▶」を押します。`）。
  - `round2_final`: `決戦 進行中です（A コートで合計の上位 4 名がもう 1 回斬ります）。斬り終わったら「決戦を終了 ▶」を押します。`
- **`finaleLineText` / `buildFinaleLine`** を `Courts.best4LineText` に置き換える（`round2` のときだけ。id は `matchFinaleLine` のまま）。`DeskMatch.finaleLineText` は消す（test.html も 9 章のとおり）。
- **`buildFinalistDiff`** → `buildFinaleDiff`（`round2_final`・`round2_done` のときだけ、`Courts.finaleDiffMessage(EventStatus.finaleDiff(players))`。id は `matchFinaleDiff`）。
- **コートのカード**:
  - `courtCards`: `p.finalist === true` の除外を消し、`Courts.roundOf(p) === round` だけで数える（旧方式の印も見ない）。
  - `round2`: 決戦のカードは**出さない**（決戦の行がまだ無い）。カードは二巡目の全員。
  - `round2_final`: 先頭に決戦のカード（巡 3 の行。見出し `決戦（ベスト4・A コート）　進行中`）、直後に決戦の表（6.2 末）、「他のコート」（巡 2 のカード）は畳む、「一巡目の結果」も今どおり。
  - `round2_done`・`final`・`archived`: 「二巡目の明細」の中で、決戦のカードを先頭コートの男子のカードの直後に金の枠で（`appendGroupsWithFinale` を流用。見出し `決戦（ベスト4・A コート）`）。決戦が無い大会は今どおり。
  - 決戦のカードの判定はすべて巡目（`row.finale === true` のカードは巡 3 の行を数える）。`buildCardTable`・`livePlayerFor` の `(p.finalist === true) === (row.finale === true)` は `(Courts.roundOf(p) === 3) === (row.finale === true)` に、巡目の一致は「決戦のカードは 3、それ以外は `round`」にする。
  - 決戦のカードの選手の表の列: `順番・ゼッケン・選手名・級位・段位・二巡目まで・得点・備考`（「二巡目まで」は組の `r1 + r2`。`EventStatus.playerTotals` で引く）。
  - 決戦のカードには今どおり招待（QR）を出さない。「採点画面を開く」「配信用ボードの URL」は先頭コートのもの。
- **決戦の表**（`renderFinaleTable`。`round2_final` のとき）: 列を `試技順・名前・一巡目・二巡目・決戦・合計・暫定順位` に。`r3 === null` は `—`、`合計` は `scored` なら `total`、未なら `base` を薄く（`is-pending`）、`暫定順位` は `rank`（null は `—`）。見出し `決戦の暫定順位`。
- **二巡目終了の順位の要約・表彰**: 変えない（順位はサーバーが 3.6 で計算する）。一般男子の列で `finale` を持つ行に小さく `決戦` の札（9 章 D8）。

### 6.3 PC 二巡目の形登録（`desk-round2.js`）

- 決戦の区画（204〜230 行。`round2FinaleNote` など）を**消す**。表は二巡目の全員 1 つ。
- 選考の差の警告（93 行の `round2FinalistDiff`）を消す。
- 区画の注記に 1 文足す: `決戦（ベスト4）は二巡目のあと、合計の上位 4 名が A コートでもう 1 回斬ります（形は二巡目と同じ）。`

### 6.4 PC 選手登録（`desk-players.js`）・状態（`desk.js`）・結果確認（`desk-results.js`）

- `desk-players.js` の `roundLabel(3)` を `'決戦'` に（帯 `男子　A コート　決戦`、巡の絞り込みの候補）。巡 3 の行は一巡目に元があるので、氏名・性別・新人は今どおり `LINKED_NOTE`（一巡目の行で直す）。技は直せる（採点済みなら `scoreChangeConfirmMessage`）。削除も今どおり。
- `desk.js`:
  - `statusToastText(to, round2, finale)`: 生成の文言から `決戦 n 名` を消す。`finale.created > 0` なら `決戦 進行中 にしました（決戦 n 名・A コート）`、`finale.removed > 0` なら `…（決戦の行 n 件を削除）`。
  - `applyStatus`: `round2 → round2_final` の前に 5.1 の検査。`round2_final → round2` の前に巡 3 の採点済みの検査（5.2）。409 `round2_pending`・`finale_scored`・`no_finale`・`finale_pending` は `alert(res.error)` の後に読み直す（他の端末で採点が進んだ・戻された可能性）。
  - `res.round2.finalistDiff` の警告を消す。
  - CSV の確認文（2384 行）`（決戦の印と一巡目とのつながりを保ち…）` は `（決戦の行と一巡目とのつながりを保ち…）` に。
- `desk-results.js`: 一般男子の行で `finale` を持つ entry に `決戦` の札と決戦の点（例 `決戦 +30`）を添える（9 章 D8）。

### 6.5 スマホ運営（`admin-round.js`・`admin-players.js`・`admin-results.js`）

- `admin-round.js`:
  - `buildFinaleLine` を `Courts.best4LineText` に（`round2` のとき）。
  - 状態の 1 行（191〜195 行）を 6.2 の `stepTodo` と同じ文言に。
  - 選考の差（421 行）を `finaleDiff` に（`round2_final`・`round2_done`）。
  - 一覧: `round2_final` のときは**巡 3 の行**を先頭の決戦のカード（見出し `決戦（ベスト4・A コート）　進行中`）に、巡 2 の行はその下。`round2` では決戦のカードを出さない。`round2_done` 以降は決戦のカードを先頭コートの男子の直後に（今の置き方）。決戦のカードの行は `Courts.finalists(players)`（巡 3）から作り、`r.finalist === true` の判定は消す。
  - 遷移の応答の処理（323〜350 行）: `finalistCount`・`finalistDiff` を消し、`finale.created` / `finale.removed` をトーストに。409 の読み直しに `round2_pending`・`finale_scored` を足す。押す前の検査（5.1・5.2）は PC と同じ関数。
- `admin-players.js`: 巡の列で 3 を `決戦` と出す。CSV の確認文（1223 行）を PC と同じに。
- `admin-results.js`: PC と同じく `決戦` の札。

### 6.6 採点画面（`app.js`）

- `filterForStatus`（662 行）: `round = scoringRound(st)` の行だけを返す。`round2` の「候補を末尾に寄せる」と `round2_final` の「印で絞る」を消す（`round2_final` は巡 3 の行だけになる）。
- `scoringOpenHere` は `isPlayerScorable` のまま（2.2 で意味が変わる）。
- 状態バナー（576 行〜）: `round2` の「この選手は決戦（暫定ベスト4）です…」を消す（`round2` で採点できない行は出ない）。`round2_final` で一覧が空（先頭コート以外の端末）は `決戦 進行中。採点できるのは決戦（ベスト4）の選手だけです（A コート）`。
- 選手の帯（1010 行〜）: 巡 3 の行は `決戦（ベスト4）　A コート`、順番の右に `決戦 at/n`（状態を問わず巡 3 なら）。巡の名前の対応 `1 一巡目 / 2 二巡目 / 3 決戦`。
- 選手一覧の行（2167 行）: `isFinale = Courts.roundOf(p) === 3`。`tr.finale`（薄く）は使わなくなる（`round2` に決戦の行が出ないので）。`決戦` の印は残す。CSS の `tr.finale` は消してよい。
- 採点専用モード（鍵のコート）: 先頭コートの鍵の端末では、`round2_final` で巡 3 の行が出て採点できる。他コートの鍵では一覧が空で上のバナー（`scope.js` は変えない）。

### 6.7 配信ボード・発表・共有

- **配信ボード**（`board.js`・`board.html`）: `finaleFor` は変えない（`round2_final` に先頭コートを映しているときだけ）。決戦の表の列に `決戦` を足す（`順位・名前・一巡目・二巡目・決戦・合計`。`board.html` の見出しも）。`orderLabel`（246 行）は巡 3 を `男子 決戦 n番` に。暫定ベスト4 は出さない（9 章 D7）。
- **発表**（`present.js`）: 決戦モードを `phase` で出し分ける。
  - `provisional`: 見出し `暫定ベスト4`、行は `順位・名前・合計`、注記 `二巡目を終えた n 名のうち（残り m 名）`。
  - `finale`: 見出し `決戦（暫定）`、行は今どおり（未斬りは試技順 `n番`、斬った人から合計と順位）。注記 `斬った人から、決戦の点を足した合計と暫定順位が埋まります`。
  - `null`: `決戦はまだありません`。最初のモードの判定（`round2_final` で決戦モード）は変えない。
- **共有**（`share.js`）: `FINALE_STATES` は変えない。`provisional` は見出し `暫定ベスト4（残り m 名）`、`finale` は `決戦（暫定）`。行の形（順位・名前・合計）は同じ。
- **入口**（`home.js` 102 行）: `round2_final` の一言を `決戦（ベスト4）が A コートでもう 1 回斬る` に。

### 6.8 ヘルプ（`help.html`）

直す箇所（行番号は f1dbc20）:

- 66〜72 行（8 つの状態）: `二巡目 進行中` は「全員が二巡目を斬る。一般男子が全員確定すると、合計の上位 4 名（決戦）が決まる」。`決戦 進行中` は「合計の上位 4 名が A コートでもう 1 回斬る。採点できるのは決戦の選手だけ」。72 行の注記は「決戦が無い（一般男子がいない・合計が全員 0 点以下）大会は `二巡目を終了 ▶`」。
- 84〜121 行の流れ図（SVG）: 決戦の箱の説明を「二巡目のあと、合計の上位 4 名が A コートで三度目を斬る」に。
- 500〜502 行（ボタンの説明）: `二巡目を開始 ▶` から「A コートの最後に並ぶ暫定ベスト4 は…まだ採点できません」を消す。`決戦を開始 ▶` は「一般男子の二巡目が全員確定したら押す。未確定がいると押しても止まる。巡 3 の決戦の行ができ、A コートの端末で大会を選び直すと出る」。暫定ベスト4 の 1 行（6.1）の例文を差し替え。
- 519〜520・624 行（試合進行の表示）: 二巡目 進行中は決戦のカードが無く暫定ベスト4 の 1 行、決戦 進行中は先頭に決戦のカードと暫定順位。
- 607・637〜638 行（形登録）: 「下に決戦（暫定ベスト4）の表が続きます」を消す。画像 `help/img/admin_round.png` は決戦の区画が写っているので、撮り直すまで figcaption に「画像は旧版（決戦の区画は今はありません）」と添える。
- 646〜653 行（決戦の節）を書き直す: 選び方（一般男子・合計の上位 4・同点は全員・合計 0 点以下は除く・二巡目を全員確定してから）、試技順（合計の低い順。同点は一巡目の試技順）、形（二巡目と同じ。直すなら選手の区画で決戦の行を直す）、最終順位（決戦の人は三度の合計、決戦の人が 1〜4 位、新人枠・女子は二巡目まで）、選び直し（`finaleDiff` の警告と戻し方）、戻すときの決まり（採点済みなら止まる）。
- 780・790・818〜842 行（共有・発表・配信ボード）: 二巡目 進行中は共有と発表の決戦モードに暫定ベスト4、決戦 進行中は決戦（暫定）。配信ボードは今どおり。
- 319・328・919 行（CSV）: 「決戦の印」を「決戦の行（巡 3）」に。

---

## 7. 旧データ（2026-10-04 より前に二巡目を作った大会）

### 7.1 方針: 移行しない・旧方式の印は無視する

旧方式の大会は、巡 2 の行の一部に `finalist: true` が付き、先頭コートの男子の二巡目の末尾（続き番号）に並んでいる。巡 3 の行は無い。

- 新しいコードは**巡 2 の `finalist` を判定に使わない**（`finalists` は巡 3 だけを見る）。印はファイルに残り、バンドル・CSV で往復するが、画面には出ない。
- **終わった大会（`round2_done`・`final`・`archived`）の順位は変わらない**: 旧方式の決戦は巡 2 の 1 回だったので、全員 一巡目＋二巡目 の合計という集計は新旧で同じ（巡 3 が無いので一般男子も `r3 = 0`、`finalist` の組も無い）。名古屋城決戦など決戦済みの大会もこれに当たる。
- 変わる表示: 決戦の表（`finale`）は巡 3 が無いので `null` になる。共有ページの `round2_done` の大会で「決戦（暫定）」の表が消え、発表の決戦モードは「決戦はまだありません」になる。順位は変わらない。
- 「戻す」: `round2_done` から戻すと `prev` は `round2`（巡 3 が無いので）。そこで「決戦を開始」を押すと新しい規則で決戦の行ができる（運営が意図して戻したときだけ）。

### 7.2 配備の前提

- **`round2`・`round2_final` の大会が無いときに配備する**（当日の進行中に配備しない）。
- やむを得ず配備する場合:
  - 旧方式の `round2` の大会: 印の付いた行は普通の二巡目の行になり、そのまま採点できる（A コートの最後に並んでいる）。全員が二巡目を確定したら新しい規則で決戦。
  - 旧方式の `round2_final` の大会: 巡 3 の行が無いので採点できる行が無い。**配備の前に「決戦を終了」まで進めておく**。配備後に気付いたら「◀ 二巡目 進行中 に戻す」（巡 3 が無いので何も消さない）で新しい規則に乗せる。
- 本番の大会一覧で `round2`・`round2_final` の大会が無いことを、配備の前に運営画面で確かめる（手順を申し送りに書く）。

### 7.3 取り込みで巡 3 の行が入ってくる場合

- CSV（23 列・往復）とバンドルは巡 3 の行をそのまま取り込む（`order` の巡目で決戦の行になる）。状態は取り込み側で変えない。
- 1.3 の不変条件を外れた大会（例: `round2` なのに巡 3 の行がある）は、`round2 → round2_final` で 3.3 の 4（未採点なら作り直し、採点済みなら 409）、戻す方向は 3.4 で整う。画面は巡目で判定するので壊れない（`round2` の採点画面には巡 3 は出ない）。

---

## 8. AI 用 MCP ツール（`tools/mcp/phx-tameshigiri`）

- `auto_score`: 対象は `roundOf(p) === EventStatus.scoringRound(status)` かつ `isRowScorable`（`status.js` を読むので、`round2` は巡 2 の全員、`round2_final` は巡 3 になる）。変更は説明文だけ（`決戦（round2_final）は巡 3 の決戦の行を試技順に採点する`）。`rowSort` の `round2_final`（番号順）はそのまま。
- `change_status`: 説明文の `round2_final 決戦` を `round2_final 決戦（一般男子の二巡目が全員確定していること。合計の上位 4 名の決戦の行を作る）` に。戻り値に `finale: r.finale || null` を足す。409 `round2_pending`・`finale_scored` は既存の `ToolError` の写し方で返る（変更なし）。
- `get_event`: `round` の検査と JSON Schema の `enum` を `[1, 2, 3]` に（`round は 1・2・3（3 は決戦）で指定してください`）。`playerView` の `finalist` は `roundOf(p) === 3` にする（キー名は互換のため残し、意味は「決戦の行」）。
- `server.mjs` の予行の流れの文言は変えない（手順は同じ）。README の流れも同じ。
- `test.mjs`（519〜560 行）: 「auto_score（二巡目）: 決戦以外を採点。決戦の行は飛ばす」を「二巡目は全員（18 名）を採点、飛ばすのは 0」に、`r.round2.finalistCount >= 1` を消し、`change_status(round2_final)` の応答の `finale.created >= 1`、`auto_score` の `scored === finale.created`、決戦の行が巡 3・先頭コート・合計の低い順、`get_ranking` の一般男子の合計が 一巡目＋二巡目＋決戦（決戦の人）であることを確かめる。

---

## 9. 決定待ち（推奨値つき）

| # | 論点 | 推奨 | 根拠 |
|---|---|---|---|
| D1 | 決戦の行の判定 | **巡目だけ（巡 3）。`finalist` は付けない** | 判定を 1 つにする。旧方式の印との取り違えが起きない |
| D2 | 決戦を開始する条件 | **一般男子の二巡目が全員確定（越えられない）**。女子などの未確定は確認文で知らせるだけ | 未確定を残して選ぶと選考がずれる（本件の発端）。女子は選考に関係しない |
| D3 | 合計 0 点の扱い | **合計 1 点以上だけ**（0 点以下は 4 位以内でも入れない） | 従来の「0 点除外」を合計に読み替える。補正で負になる場合も除く |
| D4 | 一般男子の最終順位の並び | **決戦に出た人を先に**（決戦の点が負でも 5 位以下と入れ替わらない） | ユーザー決定 5「決戦の 4 名は 1〜4 位に残る」を規則として保証する |
| D5 | 決戦に採点がある状態で戻す | **409 で止める（force なし）**。直すなら選手の区画で決戦の行の採点を消すか削除してから | 採点を黙って消さない |
| D6 | 決戦の形 | **決戦を開始した時点の二巡目の行の技を複製**。その後の `r2tech`・二巡目の行の直しは決戦の行に写さない。決戦の形を変えるなら選手の区画で決戦の行を直す | 決戦用の申請は作らない（ユーザー決定 4）。写す規則を巡 3 へ広げると採点済みの扱いが複雑になる |
| D7 | 暫定ベスト4 を出す場所 | **試合進行（PC・スマホ）、共有ページ、発表の決戦モード**。配信ボード（コートごとの画面）と採点画面には出さない | 会場と参加者に見せたいもの。配信ボードと採点画面は 1 コートの進行に集中させる |
| D8 | 結果に決戦の点を見せるか | **一般男子の順位で、決戦の人に `決戦` の札と決戦の点を添える**（結果確認・試合進行の要約）。共有・発表の順位表は札だけ。CSV・成績表は行の一覧なので巡 3 の行がそのまま出る | 1〜4 位が決戦の結果であることが分かる |
| D9 | 旧データ | **移行しない。巡 2 の印は無視**。配備は `round2`・`round2_final` の大会が無いときに | 終わった大会の順位は新旧で同じ。移行処理は過去の記録を書き換える |
| D10 | 新人枠の決戦の点 | **足さない**（ユーザー決定 5 の確認）。新人で決戦に出た人は、一般男子と新人枠で点が違って見える | 決戦は一般男子の枠 |
| D11 | 決戦の試技順の同点 | **一巡目の試技順**（コート → 男子 → 番号の数値。今の決戦と同じ） | 既存の比較関数をそのまま使える |
| D12 | 合計のまとめ方の共通化 | **`computeRanking` のまとめ方を `status.js` の `playerTotals` に移す** | 順位と選考で同じ足し算を使うことを構造で保証する |

---

## 10. テスト計画

### 10.1 `test.html`（共通部品・純粋関数）

**足す**:
- `playerTotals`: 一巡目の行ごとの組、`sourcePlayerId` の無い巡 2 の行は氏名・性別の組、`r1/r2/r3` の分け方、巡 4 以降は `r2`、`countAll`、`r2Done`。
- `finaleStandings` / `finalePlan`: 2.7 の例（5 名・試技順）、4 位同点、男子 3 名、合計 0 点の除外、女子は母集団に入らない、新人は入る、未確定がいれば `pending`（`best` は空）、全員確定で 0 名なら `none`、二巡目の行の無い男子は母集団外。
- `finaleDiff` / `finaleDiffMessage`: 巡 3 が無ければ `changed: false`、入るべき・外れるべき、`pending` の添え、採点済みの有無で案内が変わる、差が無ければ ''。
- `isPlayerScorable` / `isRowScorable` / `scoringRound`: `round2` は巡 2 の全員（旧方式の印のある行も採点できる）、`round2_final` は巡 3 だけ、`scoringRound('round2_final') === 3`。
- `nextStep` / `nextLabel`: `round2` で `none`（男子 0 名・全員 0 点）→ `round2_done`・「二巡目を終了」、`pending`・`ready` → `round2_final`・「決戦を開始」。
- `finalists` / `finaleCourt`: 巡 3 の行だけ、巡 2 の印は拾わない。
- `Courts.best4LineText`: 6.1 の 5 通り。
- `Courts.finaleStartBlockers` と `blockerMessage` の文言。
- `stageCountText`: `round2` は巡 2 の全員、`round2_final` は巡 3。
- `statusConfirmMessage`: 5.1 の決戦の顔ぶれと女子の未確定の注記、`round2_final → round2_done` は巡 3、戻す文言、`→ final` の `決戦 n名`。
- `DeskMatch.stepTodo` の `round2`（決戦あり・なし）・`round2_final` の文言。
- `Present` / `Share` の `phase` の出し分け（`provisional` と `finale`）。

**期待値が変わる・消す**（f1dbc20 の test.html の行番号）:
- 1461〜1555（二巡目生成と決戦 4 名）: 生成で決戦の行を作らないことに書き換え（全員が元のコート、`finalistCount` が無い）。選考の各ケース（4 位同点・3 名・5 名・0 点・男子 0 名・新人）は `finalePlan` と「決戦を開始」の API テストへ移す。
- 1599（並び）、1754・1789・1869（付け直し）: 決戦の印・候補のコートの期待を消す。
- 1890〜1910（遷移）: `finale_pending`・`no_finale`・`round2_final` の往復を新しい条件で（未確定で 409 `round2_pending`、全員確定で巡 3 ができる、戻すと消える、採点済みで 409 `finale_scored`、男子 0 名で `round2 → round2_done`）。
- 1961〜1995（`computeRanking` の `finale`）: `phase`・列（`r3`・`base`）・`court`・`provisional`。
- 2524・2632〜2638（バンドル・往復の印）: 巡 2 の印は旧方式として往復することは残し、巡 3 の行の往復を足す。
- 2765〜2769（M2）: 「二巡目 進行中の決戦の行は 409」→「二巡目 進行中は巡 2 の全員を採点できる」「決戦 進行中は巡 2 が 409 `not_scorable`、巡 3 が通る」。
- 2956〜2981（M5 CSV）: 決戦の列が巡 3 で ○、往復後も巡 3 の行と `sourcePlayerId` が残る、往復のあとの `finale_pending` の期待を新しい条件に。
- 3023（M6）: 移行した得点で決戦が選ばれることを「決戦を開始」で確かめる形に。
- 3050〜3069（S18）: `finalistDiff` の応答のテストを消し、`finaleDiff` のテスト（決戦 進行中に二巡目の得点を force で直すと差が出る）に置き換える。
- 3171（申請の形の決戦の行）: 「決戦の行も申請の形」→「決戦を開始すると、決戦の行は二巡目の行（申請の形）の複製」。
- 4809〜4859（`Courts.finalists`・確認文・`stageCountText`・`progressRound`）: 巡 3 で作り直す。`progressRound: round2_final は二巡目` はそのまま通るはず。
- 5562〜5626（`isRowScorable`・`pickFinalists`・`finalistDiff`・`FINALIST_LABEL`）: `pickFinalists`・`finalistDiff` のテストは消し、`finalePlan`・`finaleDiff` に置き換え。
- 5656〜5736（`prev`・`nextStep`・`nextLabel`・`finalists`・`isPlayerScorable`・`finaleCourt`）: 巡 3 の前提で作り直す（旧方式のコート「決戦」の行のテストは「巡 2 の印は見ない」に）。
- 5847（`scoringRound: round2_final は 2`）→ 3。
- 6182〜6185（`statusToastText` の決戦の人数）・6213〜6238（`stepTodo`・`finaleLineText`）: 新しい文言に。`finaleLineText` のテストは `Courts.best4LineText` へ。
- 6551（`Present.finaleRows`）: `phase` を含めて。

### 10.2 `test.html`（API の通し）

1 つの大会で: 男子 6 名（2.7 の点）＋女子 2 名、A・B コート。一巡目 → 一巡目を終了（決戦の行・印が無い）→ 二巡目を開始 → 男子 5 名だけ確定して「決戦を開始」→ 409 `round2_pending`（`pendingCount: 1`）→ 残りを確定 → 「決戦を開始」→ 巡 3 が A コートに 5 行（M1・M6・M2・M3・M4 の順、技は二巡目の複製、`sourcePlayerId` は一巡目）→ 巡 2 の PATCH は 409 `not_scorable`、巡 3 は通る → 採点の鍵（B コート）で巡 3 は 403 `scope`、A コートの鍵は通る → 戻す（未採点）で巡 3 が消える → もう一度開始 → 巡 3 を 1 つ採点して戻す → 409 `finale_scored` → 決戦を全員確定 → 決戦を終了 → `ranking` の一般男子が 2.7 の最終（決戦の人が先・`finale` の値）、新人枠・女子は二巡目まで → CSV の往復で巡 3 の行と順位が保たれる → バンドルの往復も同じ。

旧方式の大会（巡 2 に `finalist` の付いた JSON を保存）: `round2_done` の `ranking` が今と同じ値、`finale` は `null`、`prev` は `round2`、`round2` で印の付いた行を採点できる。

### 10.3 `npm test`（`server/*.test.js`）・MCP

- `server/ai-key.test.js`・`invite.test.js`: 決戦の前提は無いので据え置き（実行して通ることだけ確かめる）。
- `tools/mcp/phx-tameshigiri/test.mjs`: 8 章のとおり。

### 10.4 手動確認

- PC: 二巡目 進行中の暫定ベスト4 の 1 行が「↻ 最新に更新」で動く、決戦を開始の確認文、決戦のカードと表、二巡目終了の要約の `決戦` の札。
- スマホ: 同じ流れ。
- 採点画面: A コートの端末で大会を選び直すと決戦の選手、B コートは空のバナー。
- 配信ボード（A コート）: 決戦 進行中に決戦の表（`決戦` の列）、`男子 決戦 n番`。
- 発表・共有: 二巡目 進行中は暫定ベスト4、決戦 進行中は決戦（暫定）。

---

## 11. 実装の分担案

前回までの教訓（並行実装の git 競合、test.html の同時編集）から、**共通部品とサーバーを先に 1 名で入れ、画面はその後に並行**にする。各担当は別ブランチ（worktree）で、test.html は自分の節だけを足す。

| 担当 | 範囲 | 順 |
|---|---|---|
| A: サーバー・共通部品 | `status.js`（2 章）、`courts.js`（4 章・5 章の確認文と検査の関数）、`server/index.js`（3 章）、`api.js` の注記（409 の reason・`finale` の形）、test.html の 10.1 の共通部品と 10.2 の API | 最初 |
| B: PC 画面 | `desk-match.js`・`desk-round2.js`・`desk-players.js`・`desk.js`・`desk-results.js`、test.html の `DeskMatch`・`statusToastText` | A の後 |
| C: スマホ・採点・配信・共有・発表・ヘルプ | `admin-round.js`・`admin-players.js`・`admin-results.js`・`app.js`・`board.js`/`board.html`・`present.js`・`share.js`・`home.js`・`help.html`（6.8）、CSS（`tr.finale` の片付け）、test.html の `Present`・`Share` | A の後（B と並行） |
| D: MCP | `tools.mjs`・`test.mjs`・README（8 章） | A の後（B・C と並行） |

レビューは A の後に 1 回（共通部品とサーバーの規則が 2 章・3 章どおりか）、B・C・D の後に通しで 1 回（10.2 の流れを実際の画面で）。

---

## 12. 変えないこと

- 状態の 8 段・名前・遷移表（`TRANSITIONS`）・ボタンの文言（「決戦を開始」「決戦を終了」「結果を確定して表彰へ」「二巡目を終了」）。
- 二巡目の並び（コート×性別ごとに一巡目の確定得点の低い順）と、二巡目の形の申請の仕組み。
- 人数 4・同点は全員・一般男子（新人を含む）だけ。
- 順位の合算キー（`sourcePlayerId ?? id`、旧データは氏名と性別）、確定だけを数える基準、`countsAllScores` の旧データの扱い。
- CSV の列の数（23）と見出し、バンドルの版（`BUNDLE_VERSION` 1）。
- 採点の鍵のスコープ（コートで判定）。
