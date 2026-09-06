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

  // 全行の合計得点を計算
  // rows: [{ techName, values: [v0,v1,v2,v3], techPoint: '○'|'×'|'' }, ...]
  function calcTotalScore(rows, isFemale) {
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      for (var s = 0; s < 4; s++) {
        total += calcStrikeScore(row.techName, s, row.values[s], isFemale);
      }
      // 技術点: ○=3点固定、それ以外=0点
      if (row.techPoint === '○') total += 3;
    }
    return total;
  }

  // resultエンコード文字列から行データに変換
  // result例: "1 10 " = 技1行(初○,二空,三×,四空,技術点空) 計5文字×技数
  // 注意: 技術名(techName)はエンコード文字列に含まれない。
  // 呼び出し元が player.tech1〜tech3 から別途供給すること。
  function decodeResult(result, techCount) {
    var rows = [];
    for (var i = 0; i < techCount; i++) {
      var offset = i * 5;
      var values = [];
      for (var s = 0; s < 4; s++) {
        var ch = result.charAt(offset + s);
        values.push(ch === '1' ? '○' : ch === '0' ? '×' : '');
      }
      var tpCh = result.charAt(offset + 4);
      rows.push({ values: values, techPoint: tpCh === '1' ? '○' : tpCh === '0' ? '×' : '' });
    }
    return rows;
  }

  // 行データからresultエンコード文字列を生成
  function encodeResult(rows) {
    var str = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      for (var s = 0; s < 4; s++) {
        str += row.values[s] === '○' ? '1' : row.values[s] === '×' ? '0' : ' ';
      }
      str += row.techPoint === '○' ? '1' : row.techPoint === '×' ? '0' : ' ';
    }
    return str;
  }

  return {
    setTechniques: setTechniques,
    findTechnique: findTechnique,
    calcStrikeScore: calcStrikeScore,
    calcTotalScore: calcTotalScore,
    decodeResult: decodeResult,
    encodeResult: encodeResult
  };
})();
