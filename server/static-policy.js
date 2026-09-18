// 静的配信の許可リスト。
// リポジトリルートを配信しているので、表にあるファイルだけを返し、それ以外は 404 にする
// （deploy.sh / package.json / docs / server を外に出さない）。
// 新しい HTML / JS / CSS を足したらここに追加する。忘れると 404 になるのですぐ気付く。
const path = require('path');

// 無認証で配信する（観客が共有リンクで開くページとその依存）
const PUBLIC_FILES = new Set([
  'share.html', 'present.html', 'board.html', 'help.html',
  'theme.css', 'share.css', 'present.css', 'board.css', 'help.css',
  'api.js', 'share.js', 'present.js', 'board.js', 'scoring.js'
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
  'desk-players.js', 'desk-match.js', 'desk-results.js', 'techedit.js',
  'courts.js', 'data.js', 'outbox.js', 'route.js', 'status.js', 'storage.js', 'techpicker.js'
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

module.exports = { classify };
