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
  // extraCourts（省略可）は大会の settings.courts。選手のコートとの和集合にする
  // （設計書「コート一覧」。既存の1引数呼び出しは挙動を変えない）。
  function listFrom(players, extraCourts) {
    var seen = Object.create(null);   // コート名が 'constructor' などでも壊れないように（parsePasteRow と同じ）
    var list = [];
    var hasUnassigned = false;
    function add(c) {
      if (c === UNASSIGNED) { hasUnassigned = true; return; }
      if (!seen[c]) { seen[c] = true; list.push(c); }
    }
    (players || []).forEach(function(p) { add(courtOf(p)); });
    // extraCourts は大会の settings.courts をそのまま渡されることが多く、壊れたデータ
    // （配列でない値）が来ても落ちないよう配列以外は無視する。
    (Array.isArray(extraCourts) ? extraCourts : []).forEach(function(c) {
      if (typeof c === 'string' && c) add(c);
    });
    list.sort();
    if (hasUnassigned) list.push(UNASSIGNED);
    return list;
  }

  // コート一覧（大会の settings.courts）の検証。選手のコート名と同じ規則
  // （空・'-' を含む・'未分類' は不可、32文字まで）に加えて、重複なし・最大20件。
  // 妥当なら空文字、そうでなければ日本語のエラー文言を返す（PATCH /api/events/:id が
  // そのままクライアントに返す）。
  function validateCourtList(list) {
    if (!Array.isArray(list)) return 'コート一覧の形式が不正です';
    if (list.length > 20) return 'コートは20件までです';
    var seen = Object.create(null);   // コート名が 'constructor' などでも壊れないように
    for (var i = 0; i < list.length; i++) {
      var name = list[i];
      if (typeof name !== 'string' || !name || name.length > 32 ||
          name.indexOf('-') !== -1 || name === UNASSIGNED) {
        return 'コート名「' + name + '」は使えません';
      }
      if (seen[name]) return 'コート名「' + name + '」が重複しています';
      seen[name] = true;
    }
    return '';
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
  // 太刀の ○×△ のほか、補正点（技ごと・全体）が 0 以外なら採点済みとみなす
  // （負の補正で score が 0 以下になっても拾えるように、score > 0 だけに頼らない）。
  // '2' は △（減点成功。設計書 2026-09-20-rules-alignment-design.md）。成功の一種なので採点済みに含める。
  function isScored(player) {
    if (!player) return false;
    if (typeof player.score === 'number' && player.score > 0) return true;
    if (/[012]/.test(player.result || '')) return true;
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

  // コートの一致。filter.court は文字列（1 コート）でも配列（複数コート）でも受ける。
  // '' と空配列は「すべて」。配列は PC の見出しフィルタのために後から足した形で、
  // スマホの選手登録タブ（admin-players.js）は文字列のまま使い続ける（後方互換）。
  function courtMatches(want, p) {
    if (Array.isArray(want)) {
      if (want.length === 0) return true;
      return want.indexOf(courtOf(p)) !== -1;
    }
    if (!want) return true;
    return courtOf(p) === want;
  }

  // 絞り込み。すべての条件を AND で適用し、新しい配列を返す。
  function applyFilter(players, f) {
    f = f || defaultFilter();
    var q = normalizeName(f.query);
    return (players || []).filter(function(p) {
      if (!courtMatches(f.court, p)) return false;
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

  // ゼッケンの並べ替え用の値。未設定（キーが無い・null・数値でない）は 10000 に寄せる。
  // bib は 1〜9999 なので、どの実在の値よりも大きい＝昇順で末尾に来る。
  // Infinity にすると Infinity - Infinity が NaN になり、比較関数が壊れる。
  function bibValue(p) {
    var v = p && p.bib;
    return (typeof v === 'number' && isFinite(v)) ? v : 10000;
  }

  // 並べ替え。key は 'order' | 'name' | 'score' | 'bib'、dir は 'asc' | 'desc'。
  // 同値のときは compareOrder（昇順）で並べて安定させる。元配列は変えない。
  function sortBy(players, s) {
    s = s || defaultSort();
    var sign = s.dir === 'desc' ? -1 : 1;
    function primary(a, b) {
      if (s.key === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      if (s.key === 'score') return (Number(a.score) || 0) - (Number(b.score) || 0);
      if (s.key === 'bib') return bibValue(a) - bibValue(b);
      return compareOrder(a, b);
    }
    return (players || []).slice().sort(function(a, b) {
      var c = primary(a, b) * sign;
      return c !== 0 ? c : compareOrder(a, b);
    });
  }

  // ---- 試合の区画（PC 運営 #match）の集計 ----
  // 画面を持たない判定はここに置き、test.html で固定する
  // （test.html は desk-match.js を読み込まないため）。
  // EventStatus（status.js）は呼び出し時に参照する。この節を使うページは
  // courts.js と status.js の両方を読むこと。

  // コート別のカードで数える巡目。
  //   一巡目 / 二巡目 進行中 → その巡目（EventStatus.scoringRound）
  //   準備中                 → これから採点する一巡目
  //   一巡目終了             → これから採点する二巡目
  //   二巡目終了以降         → 二巡目の行があれば二巡目、無ければ一巡目
  //                            （二巡目なしで終わった大会は一巡目の結果を見せる）
  function progressRound(status, players) {
    var r = EventStatus.scoringRound(status);
    if (r) return r;
    if (status === 'draft') return 1;
    if (status === 'round1_done') return 2;
    var hasRound2 = (players || []).some(function(p) { return roundOf(p) === 2; });
    return hasRound2 ? 2 : 1;
  }

  // コートごとの「採点済み n / N」。round の行だけを数える。
  // 並びは listFrom と同じ（昇順、未分類は末尾）。
  // その巡目の行が 1 つも無いコートも { total: 0, scored: 0 } で残す
  // （二巡目を生成する前にコートのカードが消えてしまわないように）。
  // 戻り値: [{ court, total, scored }]
  function courtProgress(players, round) {
    var list = players || [];
    return listFrom(list).map(function(c) {
      var rows = list.filter(function(p) {
        return courtOf(p) === c && roundOf(p) === round;
      });
      return { court: c, total: rows.length, scored: rows.filter(isScored).length };
    });
  }

  // そのコートでいま採点している選手の名前。live は大会 JSON の event.live
  // （コート名をそのままキーに持つ）。サーバーが defineProperty で書き
  // hasOwnProperty で読んでいるのと同じ理由で、ここでも hasOwnProperty で読む
  // （'__proto__' や 'toString' というコート名でプロトタイプを拾わない）。
  // ライブ状態が無い・選手が外れている・その選手がもう居ないときは空文字。
  function livePlayerName(live, court, players) {
    if (!live || typeof live !== 'object' || !court) return '';
    if (!Object.prototype.hasOwnProperty.call(live, court)) return '';
    var entry = live[court];
    if (!entry || typeof entry !== 'object' || !entry.playerId) return '';
    var found = (players || []).filter(function(p) { return p && p.id === entry.playerId; })[0];
    if (!found) return '';
    return found.name || '(名称未設定)';
  }

  // 「全員に一巡目と同じ技をコピー」の対象。次の4つを満たす二巡目の行だけ。
  //   ・技が3枠とも空（hasNoTech）… 途中まで入れた行を一括で上書きしない
  //   ・未採点              … 得点が変わる警告は行ごとのボタンで出す
  //   ・sourcePlayerId が指す一巡目の行がまだある（CSV 由来の行は対象外）
  //   ・その一巡目の行に技が入っている（空をコピーしても意味が無い）
  // 並びは compareOrder（表と同じ）。戻り値: [{ player, source }]
  function techCopyTargets(players) {
    var list = players || [];
    function sourceOf(p) {
      if (!p || !p.sourcePlayerId) return null;
      return list.filter(function(q) { return q && q.id === p.sourcePlayerId; })[0] || null;
    }
    return list
      .filter(function(p) { return roundOf(p) === 2 && hasNoTech(p) && !isScored(p); })
      .map(function(p) { return { player: p, source: sourceOf(p) }; })
      .filter(function(x) { return x.source && !hasNoTech(x.source); })
      .sort(function(a, b) { return compareOrder(a.player, b.player); });
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

  // ---- 試合開始を止める条件（設計書「選手の追加項目」。ゼッケン・級位段位の必須と真剣レンタルの縛り） ----

  // 試合開始（draft → round1）を止める理由の一覧。空配列なら進めてよい。
  //   bib    : event.settings.requireBib かつ一巡目で bib が未設定（null/undefined）の選手
  //   rank   : event.settings.requireRank かつ一巡目で rank が未入力（空白のみを含む）の選手
  //   rental : rental の選手で、tech1〜3 に drawn でない技が入っている選手（巡目を問わない。
  //            この判定を使う画面は一巡目しかない状態で呼ぶが、関数自体は巡目を絞らない）
  // event が無くても settings なしとして扱う。技リストは event.techniques（無ければ空）。
  function startBlockers(event, players) {
    var list = players || [];
    var settings = (event && event.settings) || {};
    var techniques = (event && event.techniques) || [];
    var blockers = [];
    if (settings.requireBib) {
      var bibMissing = list.filter(function(p) {
        return roundOf(p) === 1 && (p.bib === null || p.bib === undefined);
      });
      if (bibMissing.length > 0) blockers.push({ kind: 'bib', players: bibMissing });
    }
    if (settings.requireRank) {
      var rankMissing = list.filter(function(p) {
        return roundOf(p) === 1 && !String((p && p.rank) || '').trim();
      });
      if (rankMissing.length > 0) blockers.push({ kind: 'rank', players: rankMissing });
    }
    var rentalBad = list.filter(function(p) {
      if (!p || !p.rental) return false;
      var isFemale = sexOf(p) === '女子';
      return [p.tech1, p.tech2, p.tech3].some(function(name) {
        var n = String(name || '').trim();
        return n && !isDrawnTechnique(techniques, n, isFemale);
      });
    });
    if (rentalBad.length > 0) blockers.push({ kind: 'rental', players: rentalBad });
    // 同じ形の回数制限（一巡目だけ見る。bib/rank と同じ理由。設計書 2026-09-20-rules-alignment-design.md）。
    var repeatBad = list.filter(function(p) {
      if (!p || roundOf(p) !== 1) return false;
      var isFemale = sexOf(p) === '女子';
      return duplicateForms([p.tech1, p.tech2, p.tech3], techniques, isFemale).length > 0;
    });
    if (repeatBad.length > 0) blockers.push({ kind: 'repeat', players: repeatBad });
    return blockers;
  }

  // startBlockers の結果を alert の文言にする（改行で連ねる）。空配列なら空文字。
  var BLOCKER_LABELS = {
    bib: 'ゼッケン番号が未入力',
    rank: '級位・段位が未入力',
    rental: 'レンタルなのに抜刀してからの形以外の技を選んでいる',
    repeat: '同じ形を 2 回以上選んでいる'
  };
  // alert に全員の名前を並べると長くなりすぎるので、先頭 BLOCKER_NAME_LIMIT 名までにして
  // 残りは件数だけ添える（レビュー修正）。
  var BLOCKER_NAME_LIMIT = 10;
  function blockerMessage(blockers) {
    return (blockers || []).map(function(b) {
      var all = b.players || [];
      var shown = all.slice(0, BLOCKER_NAME_LIMIT);
      var names = shown.map(function(p) { return (p && p.name) || ''; }).join('、');
      if (all.length > BLOCKER_NAME_LIMIT) {
        names += '…ほか ' + (all.length - BLOCKER_NAME_LIMIT) + ' 名';
      }
      return (BLOCKER_LABELS[b.kind] || b.kind) + ': ' + all.length + ' 名（' + names + '）';
    }).join('\n');
  }

  // CSV 取り込み・バンドル取り込みの応答 bibDropped: { duplicate, outOfRange } から
  // 画面に足す文言を作る（設計書「選手の追加項目」レビュー修正）。両方 0 なら空文字
  // （呼び出し側は空文字なら何も足さない）。admin-players.js / desk-players.js の
  // CSV 取り込みと desk-events.js / admin-events.js のバンドル取り込みで共用する。
  function bibDroppedMessage(bibDropped) {
    var d = (bibDropped && bibDropped.duplicate) || 0;
    var o = (bibDropped && bibDropped.outOfRange) || 0;
    if (d <= 0 && o <= 0) return '';
    // レビュー修正: 0件の側は文言に出さない（重複だけ・範囲外だけのときに「範囲外0件」
    // のような無意味な数字を見せない）。
    var parts = [];
    if (d > 0) parts.push('重複していた ' + d + ' 件');
    if (o > 0) parts.push('範囲外 ' + o + ' 件');
    return 'ゼッケンが' + parts.join('・') + 'は未設定にしました';
  }

  // ---- 技の性別による絞り込み・解決（設計書「技の選択肢を性別で絞る」） ----
  // 選手に保存する技名は接尾辞なし。技リストには 胸尽くし(男)/胸尽くし(女) のように
  // 末尾 (男)/(女) で配点が分かれる組がある。採点画面の Scoring.findTechnique と
  // 同じ規則をここに持つ（courts.js は scoring.js に依存しないため）。

  // '破図味(男)' → '破図味'。末尾が (男)/(女) でなければそのまま。
  function stripGenderSuffix(name) {
    var s = String(name == null ? '' : name);
    if (s.slice(-3) === '(男)' || s.slice(-3) === '(女)') return s.slice(0, -3);
    return s;
  }

  // 技名の解決。Scoring.findTechnique と同じ規則（完全一致 → name + 性別の接尾辞で再検索）。
  function resolveTechnique(techniques, name, isFemale) {
    var list = techniques || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].name === name) return list[i];
    }
    var nameWithGender = name + (isFemale ? '(女)' : '(男)');
    for (var j = 0; j < list.length; j++) {
      if (list[j] && list[j].name === nameWithGender) return list[j];
    }
    return null;
  }

  // 選手の性別で絞った選択肢。元の並び順を保つ。
  //   末尾が (男)/(女) でない技      … そのまま
  //   末尾が性別と一致する技         … 接尾辞を外した名前で（同じ名前が既にあれば足さない）
  //   末尾が性別と一致しない技       … 出さない
  // rental が true なら、さらに drawn（抜刀後の形）の技だけに絞る（性別の絞り込みと AND）。
  // 省略時は false 扱い（既存の2引数呼び出しは変えない）。
  function techniqueOptions(techniques, isFemale, rental) {
    var suffix = isFemale ? '(女)' : '(男)';
    var otherSuffix = isFemale ? '(男)' : '(女)';
    var out = [];
    (techniques || []).forEach(function(t) {
      var name = (t && typeof t.name === 'string') ? t.name : '';
      if (!name) return;
      if (name.slice(-3) === otherSuffix) return;
      var shown = name.slice(-3) === suffix ? stripGenderSuffix(name) : name;
      if (!shown) return;   // 技名がちょうど '(男)'/'(女)' だけだと接尾辞を外すと空になる。出さない。
      if (out.some(function(o) { return o.name === shown; })) return;
      // strikes は t.strikes ではなく、表示名を実際に採点で使うときの解決規則
      // （resolveTechnique）に通した先から取る。技リストに 破図味(女) と 破図味 が
      // 両方ある場合など、末尾の技を先に見つけても resolveTechnique が完全一致の
      // 別の項目を返すことがあるため、ここで t.strikes をそのまま使うと表示と
      // 採点の配点がずれる。drawn の判定も同じ理由でここから取る。
      var resolved = resolveTechnique(techniques, shown, isFemale) || t;
      if (rental && !resolved.drawn) return;
      out.push({ name: shown, strikes: resolved.strikes });
    });
    return out;
  }

  // 技名の drawn（抜刀後の形。既定 false）。resolveTechnique で解決できなければ false。
  function isDrawnTechnique(techniques, name, isFemale) {
    var t = resolveTechnique(techniques, name, isFemale);
    return !!(t && t.drawn);
  }

  // 3枠の技（['tech1','tech2','tech3']）のうち、repeatable でない技が2回以上ある名前の配列
  // （表示名。接尾辞は同じ形として数える。resolveTechnique で解決できない技は数えない）。
  // 重複が無ければ []（設計書 2026-09-20-rules-alignment-design.md「同じ形の回数制限」）。
  function duplicateForms(techs, techniques, isFemale) {
    var counts = Object.create(null);   // 表示名が '__proto__' などでも壊れないように
    var order = [];
    (techs || []).forEach(function(name) {
      var n = String(name == null ? '' : name).trim();
      if (!n) return;
      var resolved = resolveTechnique(techniques, n, isFemale);
      if (!resolved || resolved.repeatable === true) return;
      var display = stripGenderSuffix(resolved.name);
      if (!Object.prototype.hasOwnProperty.call(counts, display)) { counts[display] = 0; order.push(display); }
      counts[display]++;
    });
    return order.filter(function(name) { return counts[name] >= 2; });
  }

  // ---- 貼り付けによる一括登録の解析（PC 運営 desk-players.js の「📋 貼り付けて追加」） ----

  // 性別・新人の表記ゆれ。設計書「画面設計 > PC 運営 > 選手」の貼り付けの節のとおり。
  var FEMALE_WORDS = ['女子', '女', 'f'];
  var NEWFACE_WORDS = ['新人', '○', '〇', '1', 'true'];
  // レンタル（真剣レンタル）は新人と同じ語に「レンタル」「あり」を足す（設計書「選手の追加項目」）。
  var RENTAL_WORDS = NEWFACE_WORDS.concat(['レンタル', 'あり']);

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
  // 列は 名前 / コート / 性別 / 新人 / 技1 / 技2 / 技3 / ゼッケン / 級位段位 / レンタル の固定順
  // （後ろの3列は無くてもよい。7列だけの行は従来どおり）。
  // タブが1つでもある行はタブ区切り（Excel からの貼り付け。区切り文字そのままで、
  // 引用符は特別扱いしない＝名前の一部）、無ければ splitDelimited でカンマ区切りとして切る。
  // techniques はその大会の有効な技リスト（[{ name, strikes, drawn }]）。
  // 戻り値: { headerSkipped, rows: [ {
  //   line,      貼り付けた文字列の行番号（1 始まり。空行と見出しも数える）
  //   name, court, isFemale, isNewFace,
  //   techs,     ['技1', '技2', '技3']（空の枠は ''）
  //   badTechs,  技リストに無い技名（画面で赤く示す）
  //   courtFilled, コートの列が空で defaults.court から補った行か（画面が色を分ける）
  //   bib,       ゼッケン番号（整数）。列が空か無ければ null。数字以外なら ok:false
  //   rank,      級位・段位（列が無ければ ''）
  //   rental,    真剣レンタル（列が無ければ false。新人と同じ語＋「レンタル」「あり」で真）
  //   ok,        サーバーに送ってよい行か
  //   error      送れない理由（ok が true なら ''）
  // } ] }
  // defaults = { court } は「列が足りない行に使う既定値」。いまはコートだけ。
  // 貼り付けダイアログの「コートが空の行に使うコート」を渡す。省略すると従来どおり
  // （コートの列が空の行は「コートがありません」で断る）。
  function parsePasteRows(text, techniques, defaults) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var rows = [];
    var headerSkipped = false;
    var seenFirst = false;
    lines.forEach(function(line, i) {
      if (!line.trim()) return;   // 空行は飛ばす（行番号は元のまま）
      var quoteError = '';
      var rawCols;
      // Excel はセルにタブ・改行・" が含まれると TSV でも引用符で括るので、
      // タブ区切りでもカンマ区切りと同じ規則で切る（列がずれて黙って登録されるより、
      // 閉じていない引用符で断るほうが安全）。
      var split = splitDelimited(line, line.indexOf('\t') >= 0 ? '\t' : ',');
      rawCols = split.fields;
      quoteError = split.error;
      var cols = rawCols.map(function(s) { return String(s).trim(); });
      if (!seenFirst) {
        seenFirst = true;
        // Excel の1行目をそのまま貼れるように、「名前…」で始まる最初の行は見出しとみなす
        if (cols[0].indexOf('名前') === 0) { headerSkipped = true; return; }
      }
      var row = parsePasteRow(cols, i + 1, techniques, defaults || {});
      if (quoteError) badRow(row, quoteError);   // 引用符の異常は他の理由より優先して断る
      rows.push(row);
    });
    // 2周目: 行同士のゼッケン重複を見る（1周目は1行ずつしか見えないので、範囲外・既存との
    // 重複はそこで断り、行同士の重複だけ全行が揃うここで断る）。先に出た行はそのまま、
    // 2件目以降だけ ok:false にする（既に他の理由で ok:false の行はそのまま。二重に理由を
    // 付けない）。
    var seenBib = Object.create(null);
    rows.forEach(function(row) {
      if (!row.ok || row.bib === null) return;
      if (Object.prototype.hasOwnProperty.call(seenBib, row.bib)) {
        badRow(row, 'ゼッケン番号 ' + row.bib + ' は ' + seenBib[row.bib] + ' 行目と重複しています');
      } else {
        seenBib[row.bib] = row.line;
      }
    });
    return { headerSkipped: headerSkipped, rows: rows };
  }

  // 1 行分。不正でも例外は投げず、ok: false と理由を付けて返す（画面が行ごとに赤く示す）。
  // 列が足りない行（名前だけ、名前とコートだけ、…）はエラーにしない。
  // 無い列は 性別＝男子・新人＝なし・技＝空 として読み、コートだけ defaults.court で補う。
  // 補った値にも下の検証（'-' を含まない・未分類でない・32文字以内）を掛ける
  // （既定コートが不正なら、その行は貼った行と同じ理由で断る）。
  function parsePasteRow(cols, line, techniques, defaults) {
    var techs = [cols[4] || '', cols[5] || '', cols[6] || ''];
    var isFemale = FEMALE_WORDS.indexOf(String(cols[2] || '').toLowerCase()) !== -1;
    // 技名の照合は resolveTechnique（完全一致 → 性別の接尾辞付き）。配列を舐めて === で
    // 比べるだけなので、技名が 'toString' などでもプロトタイプのプロパティを拾わない
    // （旧 known = Object.create(null) の意図はここに引き継ぐ）。
    var badTechs = techs.filter(function(t) { return t && !resolveTechnique(techniques, t, isFemale); });
    var pasted = cols[1] || '';
    var fallback = (defaults && typeof defaults.court === 'string') ? defaults.court.trim() : '';
    // ゼッケン（8列目）は 1〜9999 の整数だけを読む。空なら null（未設定）。
    // 数字以外（小数点や文字が混ざる）・範囲外は不正として、下でこの行を断る理由に使う。
    var bibRaw = String(cols[7] || '').trim();
    var bib = null;
    var bibError = '';
    if (bibRaw) {
      var bibNum = /^\d+$/.test(bibRaw) ? parseInt(bibRaw, 10) : NaN;
      if (Number.isInteger(bibNum) && bibNum >= 1 && bibNum <= 9999) {
        bib = bibNum;
        // 既存の選手（一巡目）の bib との重複。defaults.existingBibs は
        // desk-players.js の貼り付けダイアログが渡す（設計書「選手の追加項目」レビュー修正）。
        var existingBibs = (defaults && Array.isArray(defaults.existingBibs)) ? defaults.existingBibs : [];
        if (existingBibs.indexOf(bib) !== -1) {
          bibError = 'ゼッケン番号 ' + bib + ' は登録済みです';
        }
      } else {
        bibError = 'ゼッケン番号は 1〜9999 の整数で';
      }
    }
    var rental = RENTAL_WORDS.indexOf(String(cols[9] || '').toLowerCase()) !== -1;
    var row = {
      line: line,
      name: cols[0] || '',
      court: pasted || fallback,
      courtFilled: !pasted && !!fallback,
      isFemale: isFemale,
      isNewFace: NEWFACE_WORDS.indexOf(String(cols[3] || '').toLowerCase()) !== -1,
      techs: techs,
      badTechs: badTechs,
      bib: bib,
      rank: cols[8] || '',
      rental: rental,
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
    // 同じ形の回数制限（repeatable でない技が2回以上あれば断る。設計書 2026-09-20-rules-alignment-design.md）。
    var dupForms = duplicateForms(techs, techniques, isFemale);
    if (dupForms.length > 0) {
      return badRow(row, '同じ形は 1 回までです（' + dupForms[0] + '）');
    }
    if (bibError) return badRow(row, bibError);
    if (row.rank.length > 20) return badRow(row, '級位・段位は 20 文字までです。');
    if (rental) {
      // レンタルの選手には抜刀後の形（drawn）しか選べない。空の技枠は対象外。
      var nonDrawn = techs.some(function(t) { return t && !isDrawnTechnique(techniques, t, isFemale); });
      if (nonDrawn) return badRow(row, 'レンタルの選手は抜刀してからの形だけ選べます');
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
    validateCourtList: validateCourtList,
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
    progressRound: progressRound,
    courtProgress: courtProgress,
    livePlayerName: livePlayerName,
    techCopyTargets: techCopyTargets,
    nextRoundConflictMessage: nextRoundConflictMessage,
    nextRoundResultMessage: nextRoundResultMessage,
    scoreMayChange: scoreMayChange,
    scoreChangeConfirmMessage: scoreChangeConfirmMessage,
    isTechIncomplete: isTechIncomplete,
    stageCountText: stageCountText,
    statusConfirmMessage: statusConfirmMessage,
    startBlockers: startBlockers,
    blockerMessage: blockerMessage,
    bibDroppedMessage: bibDroppedMessage,
    parsePasteRows: parsePasteRows,
    splitDelimited: splitDelimited,
    stripGenderSuffix: stripGenderSuffix,
    resolveTechnique: resolveTechnique,
    techniqueOptions: techniqueOptions,
    isDrawnTechnique: isDrawnTechnique,
    duplicateForms: duplicateForms
  };
})();
