// 技術定義データ
// strikes: [初太刀点, 二ノ太刀点, 三ノ太刀点, 四ノ太刀点]
// null = その太刀は存在しない（グレーアウト）
// 補正点（旧・技術点）は全技術で任意の整数を入力できる（app.js）
// drawn: 抜刀後の形（既定 false）。真剣レンタルの選手が選べる技を絞り込む（courts.js の isDrawnTechnique）。
// repeatable: 同じ巡で同じ形を何度でも選べるか（既定 false）。false の技は1人の3枠に1回まで
//   （courts.js の duplicateForms・startBlockers の 'repeat'。設計書 2026-09-20-rules-alignment-design.md）。
// reducedFirst: 減点時（△）の初太刀の配点。整数か null（既定 null）。胸尽くしのみ 4
//   （scoring.js の calcStrikeScore / canReduce）。
var TECHNIQUES = [
  { name: "立位袈裟",    strikes: [1,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "立位逆袈裟",  strikes: [2,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "立位横一",    strikes: [8,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "座位袈裟",    strikes: [3,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "座位逆袈裟",  strikes: [4,  null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "座位横一",    strikes: [10, null, null, null], drawn: true,  repeatable: true,  reducedFirst: null },
  { name: "基本一",      strikes: [15, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "基本二",      strikes: [9,  1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "真",          strikes: [11, 3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "連",          strikes: [8,  3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "左",          strikes: [18, 3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "右",          strikes: [13, 3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "捨",          strikes: [17, 3,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "胸尽くし(男)", strikes: [11, 1,    null, null], drawn: false, repeatable: false, reducedFirst: 4 },
  { name: "胸尽くし(女)", strikes: [13, 1,    null, null], drawn: false, repeatable: false, reducedFirst: 4 },
  { name: "円要",        strikes: [16, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "両車",        strikes: [17, 5,    1,    null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "野送り",      strikes: [6,  null, null, null], drawn: false, repeatable: false, reducedFirst: null }, // 元CSV確認済み: 玉光と同値
  { name: "玉光",        strikes: [6,  null, null, null], drawn: false, repeatable: false, reducedFirst: null }, // 元CSV確認済み: 野送りと同値
  { name: "水月(男)",    strikes: [17, 11,   null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "水月(女)",    strikes: [17, 13,   null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "置藁水月",    strikes: [35, null, null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "陰中陽",      strikes: [8,  null, null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "陽中陰",      strikes: [17, 2,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "響き返し",    strikes: [14, 4,    2,    null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "破図味(男)",  strikes: [20, 4,    4,    2   ], drawn: false, repeatable: false, reducedFirst: null },
  { name: "破図味(女)",  strikes: [20, 6,    6,    2   ], drawn: false, repeatable: false, reducedFirst: null },
  { name: "前腰",        strikes: [13, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "夢想返し",    strikes: [13, 5,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "廻り懸り",    strikes: [17, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "右の敵",      strikes: [15, 1,    null, null], drawn: false, repeatable: false, reducedFirst: null },
  { name: "四方",        strikes: [17, 5,    7,    3   ], drawn: false, repeatable: false, reducedFirst: null }
];

// 備考欄の文例（採点画面「文例」ボタンの選択肢。順序どおりに並べる）。
// 公式ルールの失敗・無効の理由から抜粋した固定リスト（大会ごとの編集はしない）。
// 選ぶと Scoring.appendNote で備考の末尾に追記する
// （設計書 2026-09-20-rules-alignment-design.md 追補）。
var NOTE_PRESETS = [
  "間合い確認・素振りをしたため無効",
  "刀を床に打ち付けたため失敗",
  "切っ先が落ちていたため失敗",
  "斬った方の肩が入りすぎていたため失敗",
  "抜刀の際に右こぶしを大きく左に回したため失敗",
  "申請した形の刃筋と異なるため失敗",
  "抜刀して止まった（戻した）ため抜き打ちと認めず失敗",
  "突きの構えで切先が鞘から抜けていたため減点",
  "畳表のさし直し",
  "刀の曲がりを修正"
];
