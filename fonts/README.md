# 見出し用フォント

- `ShipporiMinchoB1-Bold.woff2`: しっぽり明朝 B1 Bold（SIL Open Font License 1.1、`OFL.txt`）。
  https://github.com/google/fonts/tree/main/ofl/shipporiminchob1 の TTF から、
  JIS X 0208（第一・第二水準の漢字、かな、記号）＋ ASCII ＋ 丸数字（①〜⑳）だけを残して woff2 にしたもの（約 2.1MB）。
  それ以外の文字（JIS 第三水準以降の人名漢字など）は端末の明朝にフォールバックする。
- 使い方は `theme.css` の `@font-face` と `--mincho`。見出し（選手名・技名・表の見出し・運営画面のタイトル・発表の部門名）にだけ使い、本文はゴシックのまま。
- 再生成: `pip install fonttools brotli` のうえで、`fontTools.subset` に上記の unicode 集合を渡す（大会ポスターに合わせた配色の設計書を参照）。
