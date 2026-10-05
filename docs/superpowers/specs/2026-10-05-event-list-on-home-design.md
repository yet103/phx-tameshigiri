# 大会一覧をトップに一本化し、運営画面は大会を開いてから入る画面にする 設計書

作成日: 2026-10-05
きっかけ: UX レビュー（`docs/superpowers/audits/2026-10-05-ux-review.md` の B）。トップ「作成済みの大会」と運営画面「大会一覧」が二重で、名前も機能も違い迷う。
ユーザー決定（2026-10-05）: 「トップに大会一覧は統合して、運営画面は特定の大会が絞られた状態のみ」。

## 1. 方針

- 大会の一覧・新規作成・取り込みはトップ（index.html）だけ。名前は「大会一覧」に統一。
- PC 運営（desk.html）・スマホ運営（admin.html）は、大会が決まってから入る画面。大会一覧の区画・タブは撤去。大会なしで開いたらトップの一覧へ転送。
- 運営画面の一覧にあった操作の行き先:

| 今まで（運営画面の一覧） | 行き先 |
|---|---|
| 開く | トップの一覧の行（今まででおり） |
| 📄 コピーして作成 | トップの一覧の行の ⋯ → 新規作成の「作成済みの大会からコピー」をその大会で開く |
| 💾 ファイルに保存 | トップの一覧の行の ⋯。PC 運営の「基本情報」の見出しにも「💾 ファイルに保存」（スマホは ⋯ メニューに既にある） |
| 📥 アーカイブ（最終結果のとき） | トップの一覧の行の ⋯（試合進行の「アーカイブ ▶」も今までどおり） |
| 🗑 削除 | トップの一覧の行の ⋯ だけ。運営画面には置かない（開いている大会を消す誤操作を避ける） |
| 📂 大会ファイルを取り込む・＋ 新規作成 | トップ（既にある） |
| AI 用キー（大会に依らない） | **PC 運営の「基本情報」の末尾の区画**に移す。トップに置く案はやめた（DeskInvites が Desk のダイアログ・トースト・desk.css に依存し、トップに desk.js と desk.css を読み込むと見た目が混ざる） |
| アーカイブの折りたたみ・テストも表示 | トップの一覧に既にある |

## 2. トップ（index.html / home.js / home.css）

- 入口「▶ 作成済みの大会」→「▶ 大会一覧」。副文「選んで開始・続きから」はそのまま。区画の見出し（`#paneList h2`）も「大会一覧」。
- 一覧の行: 今の `<a class="home-event">`（名前・日付と人数・状態・テストの印）を `div.home-event-row` で包み、右端に ⋯（`details.home-menu`。PC 運営の `.desk-menu` と同じ作り）を置く。行の本体（`<a>`）を押すと今までどおり運営画面の選手登録へ。
- ⋯ の項目（上から）: 「📄 コピーして作成」「💾 ファイルに保存」「📥 アーカイブ」（状態が final のときだけ）「🗑 削除」。テスト大会・アーカイブ済みにも同じ ⋯。
  - コピー: `location.hash = '#new'` にして `newRoute = 'copy-pick'`、`copySource = ev.id` で 2 段目のフォームを直接出す（`Home.openNewCopy(id)`）。セレクトはその大会を選んだ状態。
  - 保存: `Api.exportBundle` → `Storage.downloadText(Storage.bundleFilename(name, date), json)`。失敗は alert（desk-events.js の文言）。
  - アーカイブ: `confirm(Courts.statusConfirmMessage('final', 'archived', null))` → `Api.changeStatus(id, 'archived', { from: 'final' })`。stale は alert「他の端末で状態が変わっていました。一覧を読み直します。」。成否にかかわらず一覧を読み直す。
  - 削除: `confirm('大会「…」を削除します。\n選手データも一緒に消えます。よろしいですか？')` → `Api.deleteEvent`。成功で一覧を読み直す。
  - 完了の知らせ: トップには toast が無いので、一覧の上に 1 行（`#homeListNote`、3 秒で消える）。
- 名前が「テスト用」で始まる大会は `home-badge` に「AI 書込可」（スマホ運営の一覧にあった印。AI 用キーの対象が分かるように）。
- `index.html` の script に `bundle-import.js` は既にある。追加は無し（api.js・storage.js・courts.js・status.js は読んでいる）。
- 純粋関数 `Home.rowActions(ev)` → `['copy', 'save', 'archive'?, 'delete']`（archive は状態 final のときだけ）。test.html で見る。

## 3. PC 運営（desk.js・desk-events.js・desk-setup.js・desk.html）

- `NAV` の先頭 `{ tab: 'events', label: '大会一覧' }` を外し、左メニューの先頭に**リンク**「← 大会一覧」（`<a class="desk-nav-link" href="index.html#list">`）を置く。区切り線はその下。
- `TABS` から 'events' を外す。`parseHash('#events')` は null。`buildHash` は eventId 必須。
- `applyRoute`:
  - ハッシュ無し → 控え（`loadLast`。tab が events の控えは null 扱い）があればそこへ `redirect`。無ければ `goHome()`。
  - 大会 ID の無いハッシュ（`#events` を含む）→ `Storage.setPendingToast('先に大会を選んでください')` → `goHome()`。
  - 404 → alert「この大会は削除されています」→ `clearLast()` → `goHome()`（`reloadEvent`・試合進行の確認前の読み直しも同じ）。
  - `goHome()` = `location.replace('index.html#list')`（履歴に積まない）。
- `renderNav` の「大会を開くまでは大会一覧しか使えない」の分岐は不要になる（大会が無ければこの画面に居ない）。
- `desk-events.js` を削除。`desk.html` の script タグと `server/static-policy.js` の項目も外す。コピーのダイアログ（`openCopyDialog`）はトップの経路に任せる。
- `desk-setup.js`（基本情報）: 見出しの右に「💾 ファイルに保存」（desk-events.js の `onSaveFile` を移す。`ctx.isStale` で古い画面の toast を抑止）。末尾に `DeskInvites.mountAiKeys(host, ctx)` の区画（見出し「AI 用キー」はそのまま。説明に「大会に依らず、このサーバー全体の設定です」を 1 行）。
- トップへ戻る「🏠」はヘッダーに無い（左メニューの「← 大会一覧」が担う）。

## 4. スマホ運営（admin.js・admin-events.js・admin.html）

- `TABS` から 'events' を外し、`admin.html` のタブバーの「大会」ボタンを外す（残り 3 つ）。
- `applyRoute` は PC と同じ規則（控え → `goHome()`、ID 無し → pendingToast ＋ `goHome()`、404 → alert ＋ `goHome()`）。
- `admin-events.js` を削除（script タグ・static-policy も）。⋯ メニューには「🏠 トップ」「💾 大会をファイルに保存」が既にある。

## 5. 共通（storage.js）

- `mapHash`: 'events'・空・知らない区画・ID 無しは `''`（ハッシュ無し）を返す（今は `'#events'`）。`modeHref('', mode)` は `desk.html` / `admin.html`（ハッシュ無し → applyRoute が控えかトップへ）。トップの 🖥/📱 ボタンと運営画面の切り替えボタンは同じ関数を通るので、挙動は「今の大会のまま相手のモードへ」で変わらない。

## 6. ヘルプ（help.html）

- 「作成済みの大会」→「大会一覧」（トップ）。「運営画面の大会一覧（PC 用）または大会タブ（スマホ用）」の記述を「トップの大会一覧」に。
- 行の ⋯ の説明（コピー・保存・アーカイブ・削除）をトップの一覧の項へ。AI 用キーは「PC 運営の基本情報の末尾」。
- 図 `help/img/admin_events.png` の説明文は「以前の画面」と断る（画像は撮り直さない）。

## 7. テスト（test.html）

- `Home.rowActions`: draft → copy/save/delete、final → copy/save/archive/delete、archived → copy/save/delete。
- `Storage.mapHash`: '#events' → ''、'' → ''、'#players/x' は今までどおり。
- `Desk.parseHash('#events')` / `Admin.parseHash('#events')` → null（公開されていれば）。
- 既存の「大会一覧」文言の assert があれば直す。

## 8. 進め方

ブランチ `feature/event-list-on-home`。順に: storage.mapHash とテスト → トップの ⋯ と改名 → PC 運営（NAV・route・desk-events 撤去・基本情報に保存と AI 用キー）→ スマホ運営 → ヘルプ → ブラウザ確認（トップの ⋯ 4 操作、desk.html を ID 無しで開いて転送、基本情報の保存と AI 用キー、スマホのタブ 3 つ）→ master・production へ push。
