# ダッシュボード（採点 2 面・運営・順位を 1 画面に）設計書

作成日: 2026-10-05
きっかけ: ユーザー要望「一画面のなかに iframe などで A コート・B コートの採点画面と、順位画面と、運営画面（現在の状態）」。本部の Surface Laptop 3（13.5 型・150% 表示で 1504 × 1003 CSS px）に収まること。
ユーザー決定（2026-10-05）: 上段 A・B の採点、下段 **左 運営・右 順位**。**閲覧専用モードと操作可能モードの 2 つ**を用意する。

## 1. 変える範囲

| ファイル | 変更 |
|---|---|
| `dashboard.html` / `dashboard.js` / `dashboard.css`（新規） | ダッシュボード本体。運営用の保護ページ |
| `ranking.html` | URL のハッシュ `#event/<id>` で大会を自動で読み込み、10 秒ごとに読み直す（ハッシュで開いたときだけ） |
| `desk-match.js` | 試合進行の見出しに「📊 ダッシュボード」ボタン（新しいタブで `dashboard.html#event/<id>`） |
| `index.html` | 入口の下の「コート端末の方は 採点画面／順位表示／…」の行に「ダッシュボード」のリンクを足す（大会は開いてから選ぶ） |
| `server/static-policy.js` | PROTECTED_FILES に `dashboard.html`・`dashboard.js`・`dashboard.css` |
| `help.html` | 「ダッシュボード」の節（短く） |
| `test.html` | dashboard.js の純粋関数と ranking のハッシュ解釈 |

変えないもの: 採点画面・PC 運営・順位の中身とサーバー API。ダッシュボードは既存ページを iframe で並べるだけ。

## 2. 画面

### 2.1 全体

- ページは窓いっぱい（`height: 100vh`、本体はスクロールしない）。上に高さ 36px の帯、下は面のグリッド。
- 帯（左から）: 「ダッシュボード」の見出し、大会の選択（select。`Api.listEvents` の進行中・準備中の大会。テスト大会は除く）、**モードの切り替え**（2 択のセグメント「👁 閲覧専用」「✎ 操作可能」）、**縮小率**（range 50〜100%、刻み 5、初期 75%、右に数字）、右端に 🌙 テーマと「トップへ」のリンク。
- URL は `dashboard.html#event/<id>`。大会を選ぶとハッシュを書き換える（`history.replaceState`）。ハッシュ無しで開いたら帯の select だけ出し、面は「大会を選んでください」の 1 枚。
- モードと縮小率は端末に覚える（localStorage `tmg_dashboard_mode`＝`view`|`edit`、`tmg_dashboard_zoom`＝50〜100）。**既定は閲覧専用**。URL ではモードを持たない。

### 2.2 面のグリッド

- 上段: コートごとの採点画面。コートは大会の選手の `order` から `Courts.listFrom(players)`（未分類は除く）。列数＝コート数（2 なら 2 列、3 なら 3 列）。コートが 0 なら上段は「コートがありません」の 1 枚。
- 下段: 左 運営（`desk.html#match/<id>` ＝ PC 運営の試合進行。工程表・状態・「一巡目を終了 ▶」などのボタン）、右 順位（`ranking.html#event/<id>`）。
- 行の高さは上段 3 : 下段 2（`grid-template-rows: 3fr 2fr`）。面の間は 8px。
- 各面は見出し 1 行（コート名／「運営」／「順位」。閲覧専用のときは右に「閲覧専用」の印）＋ iframe。
- iframe は等倍で読み込み、CSS の `transform: scale(z)`（`transform-origin: 0 0`、`width: calc(100% / z)`、`height: calc(100% / z)`）で縮める。面の中は iframe 自身がスクロールする（採点画面の下の一覧や順位表も面の中で見られる）。
- 1504 × 1003 のとき: 帯 36px を引いた 967px を 3:2 に割ると上段 約 575px・下段 約 380px。75% なら上段の面に 1000 × 760 相当、下段に 1000 × 500 相当が入る。採点画面（幅 660px）は名前・タイマー・技の表・確定ボタンまで入る。

### 2.3 閲覧専用モード

- 各面の iframe の上に透明な盾（`.pane-shield`、`position: absolute; inset: 0`）を置き、クリック・タップ・キー入力を iframe に届けない。
- 盾の `wheel` で `iframe.contentWindow.scrollBy(0, e.deltaY)`（同じオリジンなので触れる）。ホイールで面の中は見られる。横スクロールは `e.deltaX` も渡す。
- 中のページは通常どおり動く（採点画面の 3 秒ポーリング、順位の 10 秒更新、試合進行の読み直し）。タイマーの「開始」は押せない（盾がある）。
- 見出しに「閲覧専用」の印、盾のカーソルは `default`。

### 2.4 操作可能モード

- 盾を外すだけ。採点・確定・工程表のボタンがそのまま使える。
- 注意（ヘルプに書く）: 未確定のまま別の面を触っても警告は出ない。採点画面を 2 面同時に動かすので、同じコートを 2 面で開かないこと（コート名で 1 面ずつ）。

### 2.5 モードの切り替え

- 帯のセグメントを押すとその場で盾を付け外しする（iframe は読み直さない）。localStorage に保存。
- 閲覧専用 → 操作可能 に切り替えるときは `confirm('操作可能にします。採点や工程表のボタンが押せるようになります。')`。逆は確認なし。

## 3. ranking.html の変更

- 起動時に `location.hash` が `#event/<id>` なら、一覧の読み込み後に select をその大会にし、`loadAndRender(id)` を呼ぶ。以後 10 秒ごとに同じ大会を読み直す（`setInterval`）。`hashchange` でも同じ（大会が変われば止めて読み直す）。
- ハッシュ無しで開いたときは今のまま（ボタンで 1 回読む。自動更新なし）。ボタンで別の大会を読んだら自動更新は止める（ハッシュの大会と違うため）。
- 大会が無い・読めないときは `alert` ではなく画面内の 1 行（「順位を読み込めませんでした。10 秒後に再試行します」）。ハッシュ経由では alert を出さない（ダッシュボードの中で alert が重なるのを避ける）。
- `Ranking.parseHash(hash)` を純粋関数にして test.html から呼べるようにする（`#event/<id>` → id、それ以外 → ''）。

## 4. dashboard.js の構成

```
Dashboard（IIFE）
  parseHash(hash)                → eventId | ''
  panes(eventId, courts)         → [{ kind:'court', court, title, url }, ..., { kind:'desk', title:'運営', url }, { kind:'rank', title:'順位', url }]
                                   url: scoring.html#event/<id>/<court> ／ desk.html#match/<id> ／ ranking.html#event/<id>
  columnsFor(courtCount)         → max(1, courtCount)
  loadMode() / saveMode(mode)    → 'view' | 'edit'（既定 'view'）
  loadZoom() / saveZoom(z)       → 50〜100 の整数（既定 75。範囲外・NaN は 75）
  render()                       → 帯と面を描く。大会が変わったら iframe を作り直す。モード・縮小率の変更は作り直さず属性だけ変える
```

- 大会の選手は `Api.getEvent(id)` で 1 回読む（コートの一覧を知るため）。コートが後から増えた場合は帯の「↻」で読み直す（自動では追わない。コートは大会前に決まる）。
- 依存: api.js・storage.js（テーマ）・courts.js（listFrom）・status.js（テスト大会の除外に `test` を見るだけなので不要なら読まない）。

## 5. 認証と配信

- `dashboard.html`・`dashboard.js`・`dashboard.css` は PROTECTED_FILES（運営だけ）。採点の鍵の端末は開けない（SCORER_FILES に入れない）。
- iframe の中のページは運営の Basic 認証 Cookie をそのまま使う。
- `join.html` 以外に `frame-ancestors` の制限は無いので、同じオリジンの iframe で開ける。

## 6. テスト

test.html に:
- `Dashboard.parseHash`: `#event/abc` → 'abc'、`#event/a%20b` → 'a b'、`''`・`#foo` → ''。
- `Dashboard.panes('e1', ['A','B'])`: 4 面、URL が `scoring.html#event/e1/A`、`scoring.html#event/e1/B`、`desk.html#match/e1`、`ranking.html#event/e1` の順。ID はエンコードする（`'a b'` → `a%20b`）。コート 0 なら court の面が無く、desk と rank だけ。
- `Dashboard.columnsFor`: 0 → 1、2 → 2、3 → 3。
- `loadZoom`: 控えが無い → 75、'120' → 75、'60' → 60。`loadMode`: 無い → 'view'、'edit' → 'edit'、'x' → 'view'。
- `Ranking.parseHash`: `#event/abc` → 'abc'、`''` → ''。

ブラウザで: 1504 × 1003 で 4 面が収まり本体がスクロールしないこと。閲覧専用で面を押しても何も起きず、ホイールで中が動くこと。操作可能で確定が押せること。

## 7. 作業の分け方

1 本の計画。順に: ranking.html のハッシュ対応とテスト → dashboard（純粋関数とテスト → 画面と CSS）→ 導線（desk-match・index）→ static-policy → ヘルプ → ブラウザ確認。ブランチ `feature/dashboard`。終わったら master へ ff マージ、production へ push。
