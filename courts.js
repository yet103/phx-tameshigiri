// 選手データからコートを導出する純粋関数群
// order は "A-男子-1-1"（コート-性別-巡目-番号）形式で、先頭セグメントがコート。
var Courts = (function() {
  var UNASSIGNED = '未分類';

  // 選手のコート名を返す。判定できない場合は UNASSIGNED。
  function courtOf(player) {
    var order = (player && player.order) || '';
    var m = order.match(/^([^-]+)/);
    return m ? m[1] : UNASSIGNED;
  }

  // 選手一覧から一意なコート名を昇順で返す。UNASSIGNED は末尾に置く。
  function listFrom(players) {
    var seen = {};
    var list = [];
    var hasUnassigned = false;
    (players || []).forEach(function(p) {
      var c = courtOf(p);
      if (c === UNASSIGNED) { hasUnassigned = true; return; }
      if (!seen[c]) { seen[c] = true; list.push(c); }
    });
    list.sort();
    if (hasUnassigned) list.push(UNASSIGNED);
    return list;
  }

  // 指定コートの選手だけを返す。court が空文字なら全件。
  function filter(players, court) {
    if (!court) return (players || []).slice();
    return (players || []).filter(function(p) { return courtOf(p) === court; });
  }

  // 巡目（order の第3セグメント）。解析できなければ 1（一巡目）とみなす。
  // 巡目は order からいつでも導出できるので、選手データには持たせない。
  // サーバー側の同じ実装は server/index.js の roundOf。
  // クライアント側は test.html の roundOf テスト、サーバー側は createPlayer / generateNextRound の API テストで固定する。
  function roundOf(player) {
    var order = (player && typeof player.order === 'string') ? player.order : '';
    var m = order.match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    return m ? parseInt(m[3], 10) : 1;
  }

  // 採点済みの判定。server/index.js の isScored と同じ規則。
  // サーバー側は API テスト、クライアント側は下の test.html で固定する。
  // 太刀の ○× のほか、補正点（技ごと・全体）が 0 以外なら採点済みとみなす
  // （負の補正で score が 0 以下になっても拾えるように、score > 0 だけに頼らない）。
  function isScored(player) {
    if (!player) return false;
    if (typeof player.score === 'number' && player.score > 0) return true;
    if (/[01]/.test(player.result || '')) return true;
    if (Array.isArray(player.adjust)) {
      for (var i = 0; i < player.adjust.length; i++) {
        if (Number(player.adjust[i])) return true;
      }
    }
    return !!Number(player.totalAdjust);
  }

  // 行の並び順。order 文字列をそのまま比較すると 1-10 が 1-2 より前に来るので、
  // 巡目 → コート → 性別（男子が先）→ 番号 に分解して比べる。
  // admin-players.js（選手タブ）と admin-round.js（進行タブ）で共有する。
  function orderKey(p) {
    var m = String((p && p.order) || '').match(/^([^-]+)-(男子|女子)-(\d+)-(\d+)$/);
    if (!m) return { court: courtOf(p), sex: 2, round: roundOf(p), no: 0 };
    return {
      court: m[1],
      sex: m[2] === '男子' ? 0 : 1,
      round: parseInt(m[3], 10),
      no: parseInt(m[4], 10)
    };
  }

  function compareOrder(a, b) {
    var x = orderKey(a), y = orderKey(b);
    if (x.round !== y.round) return x.round - y.round;
    if (x.court !== y.court) return x.court < y.court ? -1 : 1;
    if (x.sex !== y.sex) return x.sex - y.sex;
    return x.no - y.no;
  }

  // ---- 選手タブの絞り込み・並べ替え（admin-players.js から使う純粋関数） ----

  // 名前検索の正規化。前後の空白と全角・半角スペースを取り除き、大文字小文字を同一視する
  // （「箕輪 憲人」を「箕輪憲人」でも当てる）。
  function normalizeName(s) {
    return String(s == null ? '' : s).replace(/[\s　]+/g, '').toLowerCase();
  }

  // 技が 3 枠とも空か（空白だけも空とみなす）。受付で技の入力漏れを探すのに使う。
  function hasNoTech(p) {
    if (!p) return true;
    return !(String(p.tech1 || '').trim() || String(p.tech2 || '').trim() || String(p.tech3 || '').trim());
  }

  // 性別（'男子' | '女子'）。order の第 2 セグメントを優先し、解析できなければ isFemale で補う
  // （選手データは両方を持っているが、採番の元になる order を正とする）。
  // 巡目・番号が欠けた order でも第 2 セグメントがあれば性別として使う（orderKey より緩い。絞り込み用なので拾える方を優先）。
  function sexOf(p) {
    var m = String((p && p.order) || '').match(/^[^-]+-(男子|女子)-/);
    if (m) return m[1];
    return (p && p.isFemale) ? '女子' : '男子';
  }

  // 選手にある巡目の一意な値を昇順で（巡目の絞り込みチップの候補）。
  function roundsOf(players) {
    var seen = {};
    var list = [];
    (players || []).forEach(function(p) {
      var r = roundOf(p);
      if (!seen[r]) { seen[r] = true; list.push(r); }
    });
    return list.sort(function(a, b) { return a - b; });
  }

  // 絞り込み条件の既定値。court '' は全コート、sex '' は男女、round 0 は全巡。
  function defaultFilter() {
    return { court: '', sex: '', round: 0, newFace: false, noTech: false, query: '' };
  }

  // 絞り込み。すべての条件を AND で適用し、新しい配列を返す。
  function applyFilter(players, f) {
    f = f || defaultFilter();
    var q = normalizeName(f.query);
    return (players || []).filter(function(p) {
      if (f.court && courtOf(p) !== f.court) return false;
      if (f.sex && sexOf(p) !== f.sex) return false;
      if (f.round && roundOf(p) !== f.round) return false;
      if (f.newFace && !p.isNewFace) return false;
      if (f.noTech && !hasNoTech(p)) return false;
      if (q && normalizeName(p.name).indexOf(q) === -1) return false;
      return true;
    });
  }

  // 並べ替えの既定値（= 従来の compareOrder 順）。
  function defaultSort() {
    return { key: 'order', dir: 'asc' };
  }

  // 並べ替え。key は 'order' | 'name' | 'score'、dir は 'asc' | 'desc'。
  // 同値のときは compareOrder（昇順）で並べて安定させる。元配列は変えない。
  function sortBy(players, s) {
    s = s || defaultSort();
    var sign = s.dir === 'desc' ? -1 : 1;
    function primary(a, b) {
      if (s.key === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      if (s.key === 'score') return (Number(a.score) || 0) - (Number(b.score) || 0);
      return compareOrder(a, b);
    }
    return (players || []).slice().sort(function(a, b) {
      var c = primary(a, b) * sign;
      return c !== 0 ? c : compareOrder(a, b);
    });
  }

  // 二巡目生成 API の 409 応答（reason: 'unscored' | 'exists'）を確認文言にする。
  // 採点画面（app.js）と運営画面（admin-round.js）で同じ文言を使う。
  // fixHint: コート未設定の選手をどこで直すかの案内（画面ごとに違う）
  function nextRoundConflictMessage(result, fixHint) {
    var extra = '';
    // exists 分岐は本文で既に既存件数を述べているので、ここで足すのは unscored のときだけ
    if (result.reason === 'unscored' && result.existingCount > 0) {
      extra += '\n※二巡目は既に ' + result.existingCount + ' 名分あります。未生成の選手がいれば差分だけ追加します。';
    }
    if (result.untrackedCount > 0) {
      extra += '\n※CSV で作った二巡目の行が ' + result.untrackedCount + ' 件あります。続けると重複します。';
    }
    if (result.unassignedCount > 0) {
      extra += '\n※コートが決まっていない選手が ' + result.unassignedCount + ' 名います（二巡目を作れません。' + fixHint + '）。';
    }
    if (result.reason === 'unscored') {
      return '未採点が' + result.unscoredCount + '名います。\n' +
             'このまま生成すると、あとから入る一巡目の得点は二巡目の並び順に反映されません。\n' +
             '生成しますか？' + extra;
    }
    return '二巡目は生成済みです（' + result.existingCount + '名）。\n' +
           '未生成の選手がいれば差分だけ追加しますか？' + extra;
  }

  // 二巡目生成 API の成功応答を結果文言にする（採点画面と運営画面で共有）。
  function nextRoundResultMessage(result) {
    var created = result.created || 0;
    var note = result.unassignedCount > 0
      ? '（コート未設定の ' + result.unassignedCount + ' 名は作っていません）' : '';
    if (created === 0) {
      return '追加する選手はいませんでした（二巡目は ' + result.existingCount + ' 名分のまま）' + note;
    }
    return '二巡目を生成しました（' + created + '名）' + note;
  }

  // ---- 採点済みの選手の訂正（スマホ運営の編集シートと PC 運営の表で共用） ----

  // 採点済みの選手について、性別か技を変えると得点が変わりうるかどうか。
  // 性別は配点が男女で違うので分かりやすいが、技の差し替えは result 文字列の
  // 長さを変えないため、採点画面（Scoring.canDecode）はこの変更を検知できず、
  // 黙って古い ○× を新しい技の配点で再解釈してしまう。だから必ず断る。
  // data は「これから送る項目」だけでよい（PC の表はセル1つずつ保存する）。
  // 含まれていないキーは「変えない」とみなす。
  function scoreMayChange(player, data) {
    if (!isScored(player)) return false;
    var d = data || {};
    if (typeof d.isFemale === 'boolean' && d.isFemale !== !!player.isFemale) return true;
    var keys = ['tech1', 'tech2', 'tech3'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (typeof d[k] === 'string' && d[k] !== (player[k] || '')) return true;
    }
    return false;
  }

  // scoreMayChange が true のときに出す確認文言。
  function scoreChangeConfirmMessage(player) {
    return 'この選手は採点済みです（' + ((player && player.score) || 0) + '点）。\n' +
      '得点が変わる可能性があります。採点画面でこの選手を開き直してください。\n\n' +
      'このまま保存しますか？';
  }

  // ---- 大会の状態の段階表示（PC 運営の上部と スマホ運営の進行タブで共用） ----
  // EventStatus（status.js）は呼び出し時に参照する。この 3 つを使うページは
  // courts.js と status.js の両方を読むこと。

  // 技が3つ揃っていない行を「未入力」と数える（一巡目のデータは常に3つ入っている）。
  function isTechIncomplete(p) {
    return !p || !p.tech1 || !p.tech2 || !p.tech3;
  }

  // 段階表示に添える件数。
  //   進行中（round1 / round2）→ その巡目の「採点済み n / N」
  //   draft                    → これから採点する一巡目の人数と技未入力の件数
  //   round1_done              → これから採点する二巡目の人数と技未入力の件数
  //   round2_done 以降         → 出さない（数えるものが無い）
  function stageCountText(status, players) {
    var list = players || [];
    var r = EventStatus.scoringRound(status);
    if (r) {
      var rows = list.filter(function(p) { return roundOf(p) === r; });
      return '採点済み ' + rows.filter(isScored).length + ' / ' + rows.length;
    }
    if (status === 'draft') {
      var r1 = list.filter(function(p) { return roundOf(p) === 1; });
      return '一巡目 ' + r1.length + '名　技 未入力 ' + r1.filter(isTechIncomplete).length;
    }
    if (status === 'round1_done') {
      var r2 = list.filter(function(p) { return roundOf(p) === 2; });
      return '二巡目 ' + r2.length + '名　技 未入力 ' + r2.filter(isTechIncomplete).length;
    }
    return '';
  }

  // 状態を変える前の確認文言（設計書「確認と拒否」の表）。承諾したときだけ遷移する。
  // サーバーは硬い条件（選手0名・二巡目0件・遷移表にない組み合わせ）だけを 409 で拒むので、
  // 件数の警告はここで出す。
  function statusConfirmMessage(from, to, players) {
    var list = players || [];
    function round(n) { return list.filter(function(p) { return roundOf(p) === n; }); }
    if (from === 'draft' && to === 'round1') {
      var r1 = round(1);
      return '一巡目 ' + r1.length + '名。技が未入力の選手が ' +
        r1.filter(isTechIncomplete).length + '名います。\n試合を開始しますか？';
    }
    if (from === 'round1' && to === 'round1_done') {
      return '一巡目の未採点が ' + round(1).filter(function(p) { return !isScored(p); }).length +
        '名います。\n一巡目を終了しますか？';
    }
    if (from === 'round1_done' && to === 'round2') {
      var r2 = round(2);
      return '二巡目 ' + r2.length + '名。技が未入力の選手が ' +
        r2.filter(isTechIncomplete).length + '名います。\n二巡目を開始しますか？';
    }
    if (from === 'round1_done' && to === 'final') {
      return '二巡目を行わずに最終結果にします。\nよろしいですか？';
    }
    if (from === 'round2' && to === 'round2_done') {
      return '二巡目の未採点が ' + round(2).filter(function(p) { return !isScored(p); }).length +
        '名います。\n二巡目を終了しますか？';
    }
    if (from === 'archived' && to === 'final') {
      return '最終結果に戻します。よろしいですか？';
    }
    if (to === 'final') {
      return '得点・選手・技を編集できなくなります。\n最終結果を確定しますか？';
    }
    if (to === 'archived') {
      return '一覧のアーカイブ欄に移り、採点画面の選択肢から消えます。\nアーカイブしますか？';
    }
    return EventStatus.LABELS[to] + 'に戻します。よろしいですか？';
  }

  // ---- 貼り付けによる一括登録の解析（PC 運営 desk-players.js の「📋 貼り付けて追加」） ----

  // 性別・新人の表記ゆれ。設計書「画面設計 > PC 運営 > 選手」の貼り付けの節のとおり。
  var FEMALE_WORDS = ['女子', '女', 'f'];
  var NEWFACE_WORDS = ['新人', '○', '〇', '1', 'true'];

  // 1 行を区切り文字で分割する（RFC4180 の引用符の規則）。'"' で囲まれた区間の区切り文字は
  // フィールドを割らず、'""' は '"' 1 文字になる。server/index.js の parseCSV と同じ文字単位の
  // 規則を「1 行分」に絞って持つ（モジュールを共有できないので、同じ規則を test.html で固定する）。
  // parseCSV と同じく、'"' は フィールドの先頭でなくても現れた時点でトグルする（緩い実装）。
  // 閉じていない引用符は error にその旨を入れて返す（呼び出し側は行ごと ok:false にする）。
  function splitDelimited(line, delimiter) {
    var s = String(line == null ? '' : line);
    var fields = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }   // "" は " 1 文字（エスケープ）
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        fields.push(field);
        field = '';
      } else {
        field += c;
      }
    }
    fields.push(field);
    return { fields: fields, error: inQuotes ? '引用符が閉じていません' : '' };
  }

  // 貼り付けたテキストを 1 行 1 人に解析する。DOM には触らない（test.html で固定する）。
  // 列は 名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 の固定順。
  // タブが1つでもある行はタブ区切り（Excel からの貼り付け。区切り文字そのままで、
  // 引用符は特別扱いしない＝名前の一部）、無ければ splitDelimited でカンマ区切りとして切る。
  // techniques はその大会の有効な技リスト（[{ name, strikes }]）。
  // 戻り値: { headerSkipped, rows: [ {
  //   line,      貼り付けた文字列の行番号（1 始まり。空行と見出しも数える）
  //   name, court, isFemale, isNewFace,
  //   techs,     ['技1', '技2', '技3']（空の枠は ''）
  //   badTechs,  技リストに無い技名（画面で赤く示す）
  //   ok,        サーバーに送ってよい行か
  //   error      送れない理由（ok が true なら ''）
  // } ] }
  function parsePasteRows(text, techniques) {
    var known = Object.create(null);   // 技名が 'toString' などでも壊れないように（computeRanking と同じ）
    (techniques || []).forEach(function(t) {
      var n = (t && typeof t.name === 'string') ? t.name.trim() : '';
      if (n) known[n] = true;
    });
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var rows = [];
    var headerSkipped = false;
    var seenFirst = false;
    lines.forEach(function(line, i) {
      if (!line.trim()) return;   // 空行は飛ばす（行番号は元のまま）
      var quoteError = '';
      var rawCols;
      if (line.indexOf('\t') >= 0) {
        rawCols = line.split('\t');
      } else {
        var split = splitDelimited(line, ',');
        rawCols = split.fields;
        quoteError = split.error;
      }
      var cols = rawCols.map(function(s) { return String(s).trim(); });
      if (!seenFirst) {
        seenFirst = true;
        // Excel の1行目をそのまま貼れるように、「名前…」で始まる最初の行は見出しとみなす
        if (cols[0].indexOf('名前') === 0) { headerSkipped = true; return; }
      }
      var row = parsePasteRow(cols, i + 1, known);
      if (quoteError) badRow(row, quoteError);   // 引用符の異常は他の理由より優先して断る
      rows.push(row);
    });
    return { headerSkipped: headerSkipped, rows: rows };
  }

  // 1 行分。不正でも例外は投げず、ok: false と理由を付けて返す（画面が行ごとに赤く示す）。
  function parsePasteRow(cols, line, known) {
    var techs = [cols[4] || '', cols[5] || '', cols[6] || ''];
    var badTechs = techs.filter(function(t) { return t && !known[t]; });
    var row = {
      line: line,
      name: cols[0] || '',
      court: cols[1] || '',
      isFemale: FEMALE_WORDS.indexOf(String(cols[2] || '').toLowerCase()) !== -1,
      isNewFace: NEWFACE_WORDS.indexOf(String(cols[3] || '').toLowerCase()) !== -1,
      techs: techs,
      badTechs: badTechs,
      ok: true,
      error: ''
    };
    if (!row.name) return badRow(row, '名前がありません');
    if (!row.court) return badRow(row, 'コートがありません');
    // order は「コート-性別-巡目-番号」。サーバーの isValidCourt と同じ条件で先に弾く。
    if (row.court.indexOf('-') >= 0 || row.court === UNASSIGNED || row.court.length > 32) {
      return badRow(row, 'コート名「' + row.court + '」は使えません');
    }
    if (badTechs.length > 0) {
      return badRow(row, '技「' + badTechs.join('」「') + '」は技リストにありません');
    }
    return row;
  }

  function badRow(row, message) {
    row.ok = false;
    row.error = message;
    return row;
  }

  return {
    UNASSIGNED: UNASSIGNED,
    courtOf: courtOf,
    listFrom: listFrom,
    filter: filter,
    roundOf: roundOf,
    isScored: isScored,
    compareOrder: compareOrder,
    orderKey: orderKey,
    normalizeName: normalizeName,
    hasNoTech: hasNoTech,
    sexOf: sexOf,
    roundsOf: roundsOf,
    defaultFilter: defaultFilter,
    applyFilter: applyFilter,
    defaultSort: defaultSort,
    sortBy: sortBy,
    nextRoundConflictMessage: nextRoundConflictMessage,
    nextRoundResultMessage: nextRoundResultMessage,
    scoreMayChange: scoreMayChange,
    scoreChangeConfirmMessage: scoreChangeConfirmMessage,
    isTechIncomplete: isTechIncomplete,
    stageCountText: stageCountText,
    statusConfirmMessage: statusConfirmMessage,
    parsePasteRows: parsePasteRows,
    splitDelimited: splitDelimited
  };
})();
