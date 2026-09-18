var Scoring = (function() {
  var currentTechniques = null;

  function setTechniques(techList) {
    currentTechniques = techList;
  }

  // 外部定義のTECHNIQUESを使用
  function getTechniques() {
    return currentTechniques || TECHNIQUES;
  }

  // 技術名で検索（男女サフィックスにも対応）
  // isFemale が未指定（undefined）の場合は false（男子）として扱う
  function findTechnique(name, isFemale) {
    var list = getTechniques();
    // まず正確一致
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) return list[i];
    }
    // 男女サフィックス付きで再検索
    var suffix = isFemale ? '(女)' : '(男)';
    var nameWithGender = name + suffix;
    for (var j = 0; j < list.length; j++) {
      if (list[j].name === nameWithGender) return list[j];
    }
    return null;
  }

  // 1太刀の得点を計算
  // strikeIndex: 0=初太刀, 1=二, 2=三, 3=四
  // value: '○' | '×' | ''
  // 戻り値: number（nullセルは0、空白は0、×は0、○は定義点）
  function calcStrikeScore(techName, strikeIndex, value, isFemale) {
    var tech = findTechnique(techName, isFemale);
    if (!tech) return 0;
    if (tech.strikes[strikeIndex] === null) return 0;
    if (value === '○') return tech.strikes[strikeIndex];
    return 0;
  }

  // 最初の '×' の添字。無ければ -1
  function failedAt(values) {
    var vals = values || [];
    for (var i = 0; i < vals.length; i++) {
      if (vals[i] === '×') return i;
    }
    return -1;
  }

  // 最初の '×' より後ろを '' にした複製（一つの形で途中失敗したら以降の太刀は無効）
  function effectiveValues(values) {
    var vals = (values || []).slice();
    var idx = failedAt(vals);
    if (idx === -1) return vals;
    var out = vals.slice();
    for (var i = idx + 1; i < out.length; i++) out[i] = '';
    return out;
  }

  // 補正点の配列を [n, n, n]（整数）に正規化する。配列でなければ [0, 0, 0]。
  function normalizeAdjust(adjust) {
    var out = [0, 0, 0];
    if (!Array.isArray(adjust)) return out;
    for (var i = 0; i < 3; i++) {
      var n = Number(adjust[i]);
      out[i] = Number.isFinite(n) ? Math.trunc(n) : 0;
    }
    return out;
  }

  function toInt(n) {
    var v = Number(n);
    return Number.isFinite(v) ? Math.trunc(v) : 0;
  }

  // 1行（1技）の得点 = 太刀の配点合計 + その技の補正点
  // 一つの形で途中失敗したらそれ以降の太刀は無効（配点を入れない）。
  // 配点が null の太刀（その技に無い太刀）は最初の×の判定にも含めない。
  function calcRowScore(techName, values, adjust, isFemale) {
    var tech = findTechnique(techName, isFemale);
    var raw = values || [];
    var masked = [];
    for (var i = 0; i < 4; i++) {
      masked.push(tech && tech.strikes[i] === null ? '' : raw[i]);
    }
    var effective = effectiveValues(masked);
    var s = 0;
    for (var i = 0; i < 4; i++) {
      s += calcStrikeScore(techName, i, effective[i], isFemale);
    }
    return s + toInt(adjust);
  }

  // 全行の合計得点 = Σ 行の得点 + 全体補正点
  // rows: [{ techName, values: [v0,v1,v2,v3], adjust: 整数 }, ...]
  function calcTotalScore(rows, isFemale, totalAdjust) {
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      total += calcRowScore(rows[i].techName, rows[i].values, rows[i].adjust, isFemale);
    }
    return total + toInt(totalAdjust);
  }

  // resultエンコード文字列から行データに変換
  // result は技ごとに5文字: 初〜四ノ太刀（1=○, 0=×, 空白=未）＋5文字目。
  // 5文字目は旧「技術点」（1=○ → 補正点3）で、adjust 配列を持たない旧データの読み替えにだけ使う。
  // adjust が配列なら、その値を各行の補正点にし、5文字目は見ない。
  // 注意: 技名(techName)はエンコード文字列に含まれない。呼び出し元が player.tech1〜tech3 から別途供給すること。
  // 注意: adjust の添字は「技の枠(tech1..3)」ではなく「空の枠を詰めた表示行」の順
  // （result と同じ並び）。技が2つの選手にあとから tech3 を足すと添字がずれるため、
  // 枠を埋めたら補正点は付け直すこと。
  function decodeResult(result, techCount, adjust) {
    var hasAdjust = Array.isArray(adjust);
    var adj = normalizeAdjust(adjust);
    var rows = [];
    for (var i = 0; i < techCount; i++) {
      var offset = i * 5;
      var values = [];
      for (var s = 0; s < 4; s++) {
        var ch = result.charAt(offset + s);
        values.push(ch === '1' ? '○' : ch === '0' ? '×' : '');
      }
      var tpCh = result.charAt(offset + 4);
      rows.push({ values: values, adjust: hasAdjust ? adj[i] : (tpCh === '1' ? 3 : 0) });
    }
    return rows;
  }

  // result が現在の技数に対して復元可能かどうか
  // result は技ごとに5文字。技の数が変わると復元できない。
  // 手で編集された結果列が混ざっても復元しない
  function canDecode(result, techCount) {
    return !!result && result.length === techCount * 5 && /^[01 ]*$/.test(result);
  }

  // 行データからresultエンコード文字列を生成。5文字目は常に空白（補正点は adjust に持つ）。
  // 最初の×より後ろ（無効化された太刀）は空白で書く。
  function encodeResult(rows) {
    var str = '';
    for (var i = 0; i < rows.length; i++) {
      var values = effectiveValues(rows[i].values);
      for (var s = 0; s < 4; s++) {
        str += values[s] === '○' ? '1' : values[s] === '×' ? '0' : ' ';
      }
      str += ' ';
    }
    return str;
  }

  return {
    setTechniques: setTechniques,
    findTechnique: findTechnique,
    calcStrikeScore: calcStrikeScore,
    calcRowScore: calcRowScore,
    calcTotalScore: calcTotalScore,
    failedAt: failedAt,
    effectiveValues: effectiveValues,
    normalizeAdjust: normalizeAdjust,
    decodeResult: decodeResult,
    encodeResult: encodeResult,
    canDecode: canDecode
  };
})();
