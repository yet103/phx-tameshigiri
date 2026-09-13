// 技術定義データ
// strikes: [初太刀点, 二ノ太刀点, 三ノ太刀点, 四ノ太刀点]
// null = その太刀は存在しない（グレーアウト）
// 補正点（旧・技術点）は全技術で任意の整数を入力できる（app.js）
var TECHNIQUES = [
  { name: "立位袈裟",    strikes: [1,  null, null, null] },
  { name: "立位逆袈裟",  strikes: [2,  null, null, null] },
  { name: "立位横一",    strikes: [8,  null, null, null] },
  { name: "座位袈裟",    strikes: [3,  null, null, null] },
  { name: "座位逆袈裟",  strikes: [4,  null, null, null] },
  { name: "座位横一",    strikes: [10, null, null, null] },
  { name: "基本一",      strikes: [15, 1,    null, null] },
  { name: "基本二",      strikes: [9,  1,    null, null] },
  { name: "真",          strikes: [11, 3,    null, null] },
  { name: "連",          strikes: [8,  3,    null, null] },
  { name: "左",          strikes: [18, 3,    null, null] },
  { name: "右",          strikes: [13, 3,    null, null] },
  { name: "捨",          strikes: [17, 3,    null, null] },
  { name: "胸尽くし(男)", strikes: [11, 1,    null, null] },
  { name: "胸尽くし(女)", strikes: [13, 1,    null, null] },
  { name: "円要",        strikes: [16, 1,    null, null] },
  { name: "両車",        strikes: [17, 5,    1,    null] },
  { name: "野送り",      strikes: [6,  null, null, null] }, // 元CSV確認済み: 玉光と同値
  { name: "玉光",        strikes: [6,  null, null, null] }, // 元CSV確認済み: 野送りと同値
  { name: "水月(男)",    strikes: [17, 11,   null, null] },
  { name: "水月(女)",    strikes: [17, 13,   null, null] },
  { name: "置藁水月",    strikes: [35, null, null, null] },
  { name: "陰中陽",      strikes: [8,  null, null, null] },
  { name: "陽中陰",      strikes: [17, 2,    null, null] },
  { name: "響き返し",    strikes: [14, 4,    2,    null] },
  { name: "破図味(男)",  strikes: [20, 4,    4,    2   ] },
  { name: "破図味(女)",  strikes: [20, 6,    6,    2   ] },
  { name: "前腰",        strikes: [13, 1,    null, null] },
  { name: "夢想返し",    strikes: [13, 5,    null, null] },
  { name: "廻り懸り",    strikes: [17, 1,    null, null] },
  { name: "右の敵",      strikes: [15, 1,    null, null] },
  { name: "四方",        strikes: [17, 5,    7,    3   ] }
];
