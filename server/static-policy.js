// 静的配信の許可リスト。
// リポジトリルートを配信しているので、表にあるファイルだけを返し、それ以外は 404 にする
// （deploy.sh / package.json / docs / server を外に出さない）。
// 新しい HTML / JS / CSS を足したらここに追加する。忘れると 404 になるのですぐ気付く。
const path = require('path');

// 無認証で配信する（観客が共有リンクで開くページとその依存）。
// 公開ページ（share/present/board/help）の <script>/<link> に足したファイルは必ずここにも足す。
// protected のままだと本番（認証あり）で 401 になり、開発サーバー（認証なし）では気付けない。
// join.html / join.js / join.css は招待の鍵を読み取った端末が開く（まだ認証されていない。
// 設計書 2026-10-03-invite-links-and-ai-key-design.md 6.1）。
const PUBLIC_FILES = new Set([
  'share.html', 'present.html', 'board.html', 'help.html', 'join.html',
  'theme.css', 'share.css', 'present.css', 'board.css', 'help.css', 'join.css',
  'api.js', 'share.js', 'present.js', 'board.js', 'scoring.js', 'courts.js', 'join.js'
]);
// 配下のファイルを無認証で配信するディレクトリ（末尾スラッシュなし）
const PUBLIC_DIRS = ['help/img', 'fonts'];

// 認証してから配信する（運営用ページとその依存）
const PROTECTED_FILES = new Set([
  'index.html', 'scoring.html', 'admin.html', 'desk.html', 'ranking.html', 'techniques.html',
  'style.css', 'admin.css', 'desk.css', 'home.css',
  'app.js', 'home.js',
  'admin.js', 'admin-events.js', 'admin-players.js', 'admin-round.js', 'admin-results.js',
  'desk.js', 'desk-events.js', 'desk-setup.js', 'desk-techniques.js',
  'desk-players.js', 'desk-match.js', 'desk-round2.js', 'desk-results.js', 'techedit.js',
  'data.js', 'outbox.js', 'route.js', 'status.js', 'storage.js', 'techpicker.js',
  'bundle-import.js',
  'ranking.js', 'dashboard.html', 'dashboard.js', 'dashboard.css',
  // 招待（設計書 2026-10-03 6.2〜6.4）。まだ無いファイルも先に分類しておく（無ければ 404）
  'desk-invites.js', 'scope.js', 'vendor/qrcode.js'
]);
// 採点の鍵で登録した端末（採点の主体）が読んでよい保護ファイル（設計書 2026-10-03 6.5）。
// scoring.html が読む保護ファイルだけ。公開ファイル（api.js・scoring.js・courts.js・theme.css）は別。
// scoring.html の <script>/<link> に保護ファイルを足したら、ここにも足す（忘れると採点端末で 403）。
const SCORER_FILES = new Set([
  'scoring.html', 'style.css', 'app.js', 'data.js', 'status.js', 'route.js', 'outbox.js', 'storage.js',
  'scope.js'
]);
// 開発時だけ配信する（認証必須）。本番から破壊的テストページを消す
const DEV_ONLY_PROTECTED_FILES = new Set(['test.html']);

// URL パス → ルート相対の正規化済みパス。解釈できなければ null。
// express.static と同じくデコードしてから正規化するので、%2F や .. で迂回できない。
function normalize(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (e) {
    return null;
  }
  const norm = path.posix.normalize('/' + decoded.replace(/\\/g, '/'));
  const rel = norm.replace(/^\/+/, '');
  if (rel === '' || rel === '.') return 'index.html';   // "/" は index.html
  if (rel === 'join') return 'join.html';               // 招待のリンクを短くする（/join#k=…）
  return rel;
}

// 戻り値: 'public' | 'protected' | null（配信しない）
function classify(urlPath, opts) {
  const production = !!(opts && opts.production);
  const rel = normalize(urlPath);
  if (rel === null || rel.endsWith('/')) return null;
  if (PUBLIC_FILES.has(rel)) return 'public';
  for (const dir of PUBLIC_DIRS) {
    if (rel.startsWith(dir + '/') && rel.length > dir.length + 1) return 'public';
  }
  if (PROTECTED_FILES.has(rel)) return 'protected';
  if (!production && DEV_ONLY_PROTECTED_FILES.has(rel)) return 'protected';
  return null;
}

// 採点の主体が読んでよいか（classify が 'protected' を返したパスについて使う）
function scorerAllowed(urlPath) {
  const rel = normalize(urlPath);
  return rel !== null && SCORER_FILES.has(rel);
}

module.exports = { classify, normalize, scorerAllowed, SCORER_FILES };
