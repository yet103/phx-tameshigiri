# 技マスタ編集画面のスマホ向け狭表示 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `techniques.html` の技マスタ表を、スマホ幅（375px 前後）で横スクロールなしに「四ノ太刀」まで見せ、1 画面に並ぶ技を増やす。

**Architecture:** `style.css` の技術リストテーブル節（`.tech-table`）の直後に `@media (max-width: 767px)` を 1 ブロック追加し、セル余白・入力幅・見出し文字だけを詰める。HTML・JS・PC 幅の見た目は変えない。

**Tech Stack:** 素の HTML/CSS（ビルドなし）。サーバーは `node server/index.js`（ポート 3457）。見た目の自動テストは無いので、ブラウザのモバイル表示で実測する。

設計書: `docs/superpowers/specs/2026-09-17-techniques-mobile-compact-design.md`

---

## ファイル構成

- Modify: `style.css` — 「技術リストテーブル（techniques.html）」節（`.tech-table` の定義、現状 282〜301 行付近）の直後にメディアクエリを追加
- 変更なし: `techniques.html`（`.tech-table` を使う唯一の画面）

---

### Task 1: スマホ幅のメディアクエリを追加

**Files:**
- Modify: `style.css:282-301`（`.tech-table` 節の末尾、`.tech-table td:first-child input[type="text"] { width: 120px; }` の直後）

- [ ] **Step 1: 現状の幅を実測して「壊れている」ことを確認する（失敗するテストに相当）**

サーバーを起動する（既に起動していればそのまま）:

```bash
node server/index.js
```

ブラウザで `http://localhost:3457/techniques.html` を開き、表示幅を 375px にする
（内蔵ブラウザなら `resize_window` の `mobile` プリセット。Chrome なら DevTools のデバイスモード）。

確認: 表の親 `div[style*="overflow-x"]` に横スクロールが出て、「四ノ太刀」列が画面右に隠れている。
コンソールで実測する場合:

```js
var t = document.getElementById('techTable'); t.scrollWidth + ' / ' + t.parentElement.clientWidth
```

Expected: `scrollWidth` が `clientWidth`（≒351）より大きい（≒460 前後）。

- [ ] **Step 2: メディアクエリを追加する**

`style.css` の `.tech-table td:first-child input[type="text"] { width: 120px; }` の直後に次を追加:

```css
/* スマホ幅: 余白と入力幅を詰めて、横スクロールなしに四ノ太刀まで見せる。
   375px（有効幅 351px）で 配点列 ≒53px × 4 ＋ 技名列 ≒139px。
   見出しは 12px にして「四ノ太刀」が 1 行に収まるようにする。 */
@media (max-width: 767px) {
  .tech-table th, .tech-table td { padding: 3px 2px; }
  .tech-table th { font-size: 12px; white-space: nowrap; }
  .tech-table input[type="number"] { width: 44px; }
  .tech-table td:first-child { width: 100%; }   /* 残り幅を技名列に寄せる */
  .tech-table td:first-child input[type="text"] { width: 100%; min-width: 0; }
}
```

- [ ] **Step 3: 375px 幅で横スクロールが消えたことを確認する**

ブラウザを再読み込み（Ctrl+Shift+R。bfcache 対策）し、Step 1 と同じ式を実行する。

Expected: `scrollWidth <= clientWidth`（例: `351 / 351`）。「四ノ太刀」の入力欄まで画面内に見え、見出し「四ノ太刀」が 1 行。

- [ ] **Step 4: 360px 幅でも成り立つことを確認する**

表示幅を 360px にして再読み込みし、Step 1 の式を実行する。

Expected: `scrollWidth <= clientWidth`（≒336）。見出しが折り返さない。

- [ ] **Step 5: PC 幅とダークテーマが変わっていないことを確認する**

表示幅をデスクトップ（768px 以上）に戻して再読み込みする。
Expected: 技名入力 120px、配点入力 60px、セル余白 6px 10px のまま（DevTools の計算済みスタイルで確認）。

「🌙 ダーク」ボタンでダークテーマに切り替え、375px 幅でも崩れないことを目視で確認する。

- [ ] **Step 6: 行の高さを確認する**

375px 幅でコンソールに次を入力する:

```js
document.querySelector('#techTableBody tr').getBoundingClientRect().height
```

Expected: 変更前（≒36）より小さい値（≒30）。

- [ ] **Step 7: コミット**

```bash
git add style.css
git commit -m "feat: 技マスタ編集画面をスマホ幅で詰め、横スクロールなしに四ノ太刀まで見せる

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 設計書に実測結果を記録

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-techniques-mobile-compact-design.md`（「テスト」節の末尾）

- [ ] **Step 1: 実測値を追記する**

「テスト」節の末尾に次の形で追記する（数値は Task 1 で実測したものに置き換える）:

```markdown
### 実測（2026-09-17）

| 幅 | table.scrollWidth / 親 clientWidth | 見出し折返し | 1 行の高さ |
|---|---|---|---|
| 375px | 351 / 351 | なし | 30px |
| 360px | 336 / 336 | なし | 30px |
| 1200px | 変更前と同じ | — | 36px |
```

- [ ] **Step 2: コミット**

```bash
git add docs/superpowers/specs/2026-09-17-techniques-mobile-compact-design.md
git commit -m "docs: 技マスタ編集画面の狭表示の実測結果を設計書に記録

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
