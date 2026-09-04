const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3457;

// ミドルウェア
app.use(cors());
app.use(express.json());

// 静的ファイル配信
const PUBLIC_DIR = path.resolve(__dirname, '..');
app.use(express.static(PUBLIC_DIR, {
    etag: false,
    setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
}));

// ────────────────────────────────────────
// API ルート（将来の拡張用）
// ────────────────────────────────────────
// 例: app.use('/api', apiRouter);

// SPA フォールバック
app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    } else {
        next();
    }
});

app.listen(PORT, () => {
    console.log(`🎯 PHX Tameshigiri running at http://localhost:${PORT}`);
});
