# 二巡目準備（形の登録）と決戦（暫定ベスト8）

**日付**: 2026-09-22
**対象**: phx-tameshigiri（試し斬り採点システム）
**前提となる設計書**: [2026-09-18-pc-mode-and-event-status-design.md](2026-09-18-pc-mode-and-event-status-design.md)（状態モデル）、[2026-09-08-mobile-admin-flow-design.md](2026-09-08-mobile-admin-flow-design.md)（二巡目生成）

「一巡目終了の直後に何をする画面か分からない」「二巡目の形は自己申告で直せるように」「暫定ベスト8 が出そろったら一区切りを入れ、一人ずつ最終得点を決めていく」への対応。ユーザーと確定した内容:

## 決定事項

| 論点 | 決定 |
|---|---|
| 一巡目終了 | 「一巡目を終了」を押した時点で**二巡目の行を自動生成**する。手動の「二巡目を生成」ボタンは無くす（API は遷移の中で使う） |
| 二巡目の形 | **一巡目の形を初期値として複製**。自己申告があった選手だけ直す |
| 状態の名前 | `round1_done` の表示を **「二巡目準備（形の登録）」** に。遷移直後、PC は `#match`、スマホは `#round` へ自動で移る。画面の見出しは「二巡目の形登録」 |
| 試技順 | 二巡目はコート×性別ごとに一巡目の得点が低い順（今の規則のまま） |
| 暫定ベスト8 | **一般男子のみ**（新人も一般男子として集計。新人戦 1〜3 位は別枠のまま、男女混合）。一巡目の得点の上位 8 名。**8 位が同点なら全員**（同点同順位） |
| 決戦のコート | 二巡目生成時に暫定ベスト8 を**専用の 1 コート**（既定名「決戦」。基本情報で変更可）に移し、一巡目の得点が低い順に 1〜n 番。他の選手は元のコートで先に斬る |
| 一区切り | 状態を足す: 二巡目 進行中 →（決戦を開始）→ **決戦 進行中** → 二巡目終了。「決戦を開始」は暫定ベスト8 以外が全員採点済みのときに押す（未採点がいれば人数を出して確認）。決戦中はコート端末で採点できるのは決戦コートだけ |
| 暫定順位の表示 | 発表モードと配信ボードに「決戦」表示（8 名を試技順に並べ、斬った人から合計と暫定順位が埋まる）。共有ページにも同じ表 |
| 決勝の 3 本目 | **無し**（二巡目の 1 本で最終得点が決まる） |

## 状態モデル（変更）

```
draft → round1 → round1_done → round2 → round2_final → round2_done → final → archived
                                  └──（暫定ベスト8 が 0 名のとき）──┘
```

| 値 | 表示 | できること | 次へ進む |
|---|---|---|---|
| `round1_done` | **二巡目準備（形の登録）** | 二巡目の形を直す（自己申告）。コートの入れ替えも可 | 二巡目を開始（二巡目なしで終了） |
| `round2` | 二巡目 進行中 | 暫定ベスト8 **以外**をコート端末で採点 | **決戦を開始**（暫定ベスト8 が 0 名なら「二巡目を終了」） |
| `round2_final` | **決戦 進行中** | 決戦コートだけ採点 | 二巡目を終了 |

遷移表の追加: `round2 → round2_final`、`round2_final → round2`（戻す）、`round2_final → round2_done`、`round2_done → round2_final`（戻す。決戦の行があるとき）。`round2 → round2_done` は暫定ベスト8 が 0 名のときだけ（サーバーが判定）。`prev('round2_done')` は決戦の行があれば `round2_final`、無ければ `round2`。

`EventStatus.isScoringOpen` は `round2_final` でも true。`scoringRound('round2_final')` は 2。新しい `EventStatus.scoringCourtFilter(status, event)`: `round2` なら「決戦コート以外」、`round2_final` なら「決戦コートだけ」、他は制限なし（採点画面・配信ボードが使う）。

### 遷移の確認と拒否

| 遷移 | クライアントの確認 | サーバーが拒む条件 |
|---|---|---|
| `round1 → round1_done` | 未採点の人数（従来）。承諾で遷移し、**サーバーが二巡目を生成**（既に生成済みなら差分追加。失敗したら遷移も取り消す） | 一巡目 0 名 |
| `round1_done → round2` | 技未入力の人数（従来） | 二巡目 0 件 |
| `round2 → round2_final` | 暫定ベスト8 以外の未採点の人数「決戦以外の未採点が n 名います。決戦を開始しますか？」 | 決戦の行が 0 件（`reason: 'no_finale'`） |
| `round2 → round2_done` | 従来 | 決戦の行があるとき（`reason: 'finale_pending'`。「決戦を開始」を案内） |
| `round2_final → round2_done` | 決戦の未採点の人数 | なし |

## データ

```
event.settings.finalCourt: string     決戦コートの名前（既定 '決戦'。コート名の規則に従う。`settings.courts` とは別に持つ）
players[]（二巡目の行）に finalist: true   暫定ベスト8（生成時に付ける。コートを手で変えても印は残る）
```

- 二巡目生成（`POST …/rounds/2/generate`、および `round1 → round1_done` の遷移から呼ぶ内部関数）:
  1. 一巡目の行から `src`（従来どおり。`未分類` は除く）
  2. **暫定ベスト8**: `src` のうち `isFemale === false` を一巡目の `score` 降順に並べ、8 位の得点以上の全員（0 点は含めない。8 名未満なら全員）。`finalist: true`
  3. 暫定ベスト8 の行: コート `settings.finalCourt`、性別 男子、巡 2、番号は一巡目の得点が**低い順**に 1〜n（同点は一巡目の `order` 順）
  4. それ以外: 従来どおりコート×性別ごとに得点昇順で 1 から
  5. `tech1〜3` は一巡目の行から**複製**（従来の空欄をやめる）。`bib` `rank` `rental` も複製（既存）
  6. 生成後、`unassignedCount` などの応答は従来どおり。`finalistCount` を足す
- `Courts.finalists(players)`: 二巡目の行のうち `finalist === true` を番号順に。`Courts.finalCourtOf(event)`: `settings.finalCourt || '決戦'`
- 順位の集計（`computeRanking`）は変えない（氏名で合算、一般男子／新人／一般女子）
- `GET /api/events/:id/ranking` と `GET /api/links/:token/ranking` に `finale` を足す:
  ```
  finale: { court: '決戦', status: 'round2_final', rows: [
    { name, order, r1: 42, r2: 30 | null, total: 72, scored: true, rank: 1 | null }, … ] }
  ```
  `rows` は試技順（番号順）。`rank` は斬った人（`scored`）だけの中で合計降順・同点同順位。決戦の行が無ければ `finale: null`

## 画面

**PC 試合進行（`desk-match.js`）**
- `round1_done`: 見出し「二巡目の形登録」。注記「一巡目の形を初期値にしています。自己申告があれば直してください。試技順は一巡目の得点が低い順です。」表は試技順（コートごと、番号順）で、一巡目の得点の列を残す。**決戦コートの区画**を別に出し「暫定ベスト8（一般男子・一巡目の得点上位）決戦コート「決戦」で最後に斬ります」。「二巡目を生成」ボタンは撤去。「全員に一巡目と同じ技をコピー」は初期値が複製済みなので撤去（行ごとの「一巡目と同じ技に戻す」は残す）
- `round2`: コート別カードは決戦コートを「決戦（開始前）」として別枠に。上部の「次へ進む」は「決戦を開始」（決戦の行が無ければ「二巡目を終了」）
- `round2_final`: 決戦コートのカードだけを前面に、暫定順位の表（`finale.rows`）。他コートは畳む
- 基本情報（`desk-setup.js`）: 「決戦コートの名前」の入力（既定「決戦」）

**スマホ試合進行（`admin-round.js`）**: 同じ見出し・注記・決戦の区画・遷移ボタン。「二巡目を生成」撤去

**選手登録（PC・スマホ）**: `round1_done` のとき上に「いまは二巡目の形登録の段階です → 試合進行へ」の案内、表の巡目の絞り込みを既定で 2 に

**上部の段階表示（PC・スマホ・トップの流れの帯）**: 「二巡目準備」「決戦 進行中」を足した 8 段階（archived を除く）。ラベルは `EventStatus.LABELS` から

**採点画面（`app.js`）**
- `round2`: 決戦コートの選手は一覧に出るが採点できず、バナー「決戦コートは「決戦を開始」の後に採点します」。コートの選択肢に決戦コートを出す
- `round2_final`: 決戦コート以外は採点できず、バナー「決戦 進行中。採点できるのは決戦コートだけです」。決戦コートを選ぶと選手名バーに「決戦 3/8」のような進みを出す
- 配信ボード（`board.js`）: 決戦コートを映しているときは、いま斬っている選手の下に暫定順位の表（`finale.rows`。斬った人だけ合計と順位、未の人は一巡目の得点だけ）

**発表モード（`present.js`）**: モードに「決戦」を足す。`finale.rows` を試技順に並べ、斬った人から合計と暫定順位が埋まる。2 秒〜60 秒で更新（既存の掲示モードの更新規則に合わせる）。`round2_final` のときはこのモードを既定で開く

**共有ページ（`share.js`）**: `finale` があれば「決戦（暫定）」の表を順位の上に出す

**ヘルプ**: 「0. 全体の流れ」を 8 段階に、「2. 採点の進行」に二巡目準備と決戦、「4. サイト掲載」に決戦表示

## テスト（`test.html`）

1. 遷移表と `prev` の追加、`scoringCourtFilter`、`isScoringOpen('round2_final')`
2. 二巡目生成: 暫定ベスト8 の抽出（8 名・同点で 9 名・男子 5 名なら 5 名・0 点は含めない・女子と新人の扱い）、決戦コートの `order`（`決戦-男子-2-1..n`、低い順）、技の複製、`finalist`、他の選手が従来どおり
3. 遷移: `round1 → round1_done` で二巡目が生成される（既に生成済みなら差分）、`round2 → round2_final` が決戦 0 件で 409、`round2 → round2_done` が決戦ありで 409、`round2_final → round2_done`
4. `ranking` の `finale`（試技順・`scored`・暫定順位・同点同順位・決戦なしで null）
5. `Courts.statusConfirmMessage` / `startBlockers` の新しい遷移の文言
6. 既存テストがすべて通る

## 手動確認

- 一巡目を終了 → 試合進行に移り「二巡目の形登録」と決戦の区画、技が複製済み → 1 名の技を直す → 二巡目を開始 → コート A・B の端末で採点（決戦コートは採点不可のバナー）→ 決戦を開始（未採点の確認）→ 決戦コートの端末だけ採点でき、発表モードと配信ボードで暫定順位が埋まる → 二巡目を終了 → 結果確認 → 最終結果
- 男子 8 名未満・8 位同点・男子 0 名の大会（決戦なしで二巡目を終了できる）
- 375px / 768px / 1280px、ライト／ダーク

## 実装の分割（1 計画）

| トラック | 内容 | ファイル |
|---|---|---|
| A | `status.js`（状態・遷移・`scoringCourtFilter`）、サーバー（生成の変更・遷移からの生成・`finale`・`settings.finalCourt`）、`courts.js`（`finalists` `finalCourtOf` 文言）、テスト | `status.js` `server/index.js` `courts.js` `api.js` `test.html` |
| B | PC・スマホの試合進行・選手登録・基本情報・段階表示・トップの帯 | `desk-match.js` `desk-players.js` `desk-setup.js` `desk.js` `admin-round.js` `admin-players.js` `home.js` `desk.css` `admin.css` |
| C | 採点画面・配信ボード・発表モード・共有ページ・ヘルプ | `app.js` `scoring.html` `style.css` `board.js` `board.css` `present.js` `present.html` `share.js` `help.html` |

A が先。B と C は A の後で並行。commit は `git commit -- <ファイル>`（pathspec）で行い、`git add`（新規ファイル以外）と `git reset` は使わない。
