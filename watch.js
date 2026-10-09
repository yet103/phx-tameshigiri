// watch.html 専用のスクリプト（観戦ダッシュボード。公開・閲覧専用。設計書 2026-10-09-watch-dashboard-design.md）。
// - URL は watch.html#<共有トークン>（順位の共有リンク・配信用ボードと同じトークン）。認証なし。
// - 5 秒ごとに GET /api/links/:token/watch を If-None-Match 付きで読む。304 なら描き直さない。
//   画面が裏に回ったら止め、戻ったら即 1 回読む。
// - 読むスクリプトは公開のものだけ（scoring.js・courts.js・api.js・board.js）。status.js（運営用）と
//   ranking.js は公開されていないので読まない。そのため順位表の描画規則（合計の色・内訳・ベスト4 の 1 行）は
//   ここに同じ規則で持ち、test.html で Ranking / Courts.best4LineText と同じ結果になることを固定している。
// - 採点表の行の組み立て（Board.rowsFor / hasNoDetail / rowScoresMatch）は配信用ボードと共有する
//   （board.js は boardRoot の無いページでは何もしない）。
// - storage.js は読まない（公開ページなので theme は watch 専用の localStorage キーで持つ）。
var Watch = (function() {
  var REFRESH_MS = 5000;
  var TICK_MS = 500;
  var CIRCLED = ['①', '②', '③'];
  var ROUND_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  // 大会の状態の表示（運営側の EventStatus.LABELS を観客向けに言い換えたもの。
  // round1_done は「二巡目準備」、archived は「最終結果」。status.js は公開されていないのでここに持つ）
  var STATUS_LABELS = {
    draft: '準備中',
    round1: '一巡目 進行中',
    round1_done: '二巡目準備',
    round2: '二巡目 進行中',
    round2_done: '二巡目終了',
    final: '最終結果',
    archived: '最終結果'
  };
  // ベスト4 の 1 行を出す状態（share.js の BEST4_STATES と同じ。一巡目だけの合計はベスト4 ではない）
  var BEST4_STATES = ['round2', 'round2_done', 'final', 'archived'];
  // 順位表の部門の並び（共有ページ share.js と同じ）
  var CATEGORIES = [
    { key: 'male', title: '一般男子' },
    { key: 'newFace', title: '新人枠' },
    { key: 'female', title: '一般女子' }
  ];

  var FONT_KEY = 'watchFontPct';
  var THEME_KEY = 'watchTheme';
  var FONT_MIN = 80, FONT_MAX = 160, FONT_STEP = 10;

  var token = '';
  var etag = null;
  var seq = 0;            // 古い応答を捨てる（hashchange で進める）
  var busy = false;
  var pending = false;
  var invalid = false;
  var pollTimer = null;
  var tickTimer = null;
  var lastCourtNames = null;   // 札を作り直すかの判定
  var lastRankingJson = '';    // 順位が変わっていなければ表を描き直さない
  var cards = {};              // コート名 → { root, el, timer, updatedAt }
  var el = {};

  // --- 純粋関数（test.html から検証する。DOM には触らない） ---

  function statusLabel(status) {
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? STATUS_LABELS[status] : '';
  }

  // URL のハッシュ（#<トークン>）→ トークン
  function parseToken(hash) {
    var h = String(hash || '');
    if (h.charAt(0) === '#') h = h.slice(1);
    try { h = decodeURIComponent(h); } catch (e) { /* 壊れた％表記はそのまま扱う */ }
    return h;
  }

  function roundLabel(round) {
    return (ROUND_KANJI[round - 1] || String(round)) + '巡目';
  }

  // order（A-男子-1-3）→ { gender, round }。読めなければ null
  function orderParts(order) {
    var m = String(order || '').match(/^([^-]+)-(男子|女子|混合)-(\d+)-(\d+)$/);
    return m ? { gender: m[2], round: parseInt(m[3], 10) } : null;
  }

  // 太刀のセル 1 つ分（board.js の strikeCell と同じ規則）。
  //   na      … 打てない太刀（配点 null）。文字なし
  //   voided  … 一つの形で途中失敗した後ろの太刀（無効）
  //   success / reduced / fail / none … 成功／減点（△。初太刀だけ）／失敗／未
  // points は成功・減点のときだけ（その太刀の配点）
  function strikeCellModel(techName, index, value, isFemale, failedAt) {
    var tech = Scoring.findTechnique(techName, isFemale);
    if (tech && tech.strikes[index] === null) return { kind: 'na', label: '', points: null };
    if (typeof failedAt === 'number' && failedAt !== -1 && index > failedAt) {
      return { kind: 'voided', label: '無効', points: null };
    }
    if (value === '○') return { kind: 'success', label: '成功', points: Scoring.calcStrikeScore(techName, index, '○', isFemale) };
    if (value === '△') return { kind: 'reduced', label: '減点', points: Scoring.calcStrikeScore(techName, index, '△', isFemale) };
    if (value === '×') return { kind: 'fail', label: '失敗', points: null };
    return { kind: 'none', label: '未', points: null };
  }

  // コートの札 1 枚分の材料。c は watch API の courts[i]。
  // 戻り値: { court, title, progressText, idle, stage, who, rows, noDetail, totalAdjust, score, confirmed, timer, updatedAt }
  //   rows … [{ techName, cells: [strikeCellModel ×4], adjust, score（行の得点。合計と食い違うときは null） }]
  //   noDetail … 技を差し替えた後などで内訳を復元できない（合計だけ見せる）
  //   idle … 待機中（配信の状態が無い・選手が未設定）
  function courtCardModel(c) {
    var prog = (c && c.progress) || {};
    var m = {
      court: (c && c.court) || '',
      title: ((c && c.court) || '') + ' コート',
      progressText: '確定 ' + (Number(prog.done) || 0) + ' / ' + (Number(prog.total) || 0),
      idle: true, stage: '', who: '待機中', rows: [], noDetail: false,
      totalAdjust: 0, score: 0, confirmed: false, timer: null, updatedAt: ''
    };
    var live = c && c.live;
    var p = live && live.player;
    if (!p) return m;

    var parts = orderParts(p.order);
    m.stage = [
      parts && parts.gender !== '混合' ? parts.gender + 'の部' : '',
      parts ? roundLabel(parts.round) : '',
      m.title
    ].filter(Boolean).join('　');

    var who = [];
    who.push((Number.isInteger(p.bib) ? 'No.' + p.bib + '　' : '') + (String(p.name || '').trim() || '(名称未設定)'));
    if (p.rank) who.push(String(p.rank));
    m.who = who.join('　');

    m.idle = false;
    m.confirmed = p.confirmed === true;
    m.score = Number(p.score) || 0;
    m.totalAdjust = Math.trunc(Number(p.totalAdjust)) || 0;
    m.timer = live.timer || null;
    m.updatedAt = live.updatedAt || '';

    if (Board.hasNoDetail(p)) {
      m.noDetail = true;
      return m;
    }
    var showScores = Board.rowScoresMatch(p);   // 行の得点の和が合計と食い違うときは行の得点を出さない
    m.rows = Board.rowsFor(p).map(function(row) {
      return {
        techName: row.techName,
        cells: [0, 1, 2, 3].map(function(s) {
          return strikeCellModel(row.techName, s, row.values[s], p.isFemale === true, row.failedAt);
        }),
        adjust: row.adjust,
        score: showScores ? Scoring.calcRowScore(row.techName, row.values, row.adjust, p.isFemale === true) : null
      };
    });
    return m;
  }

  // 合計のセルの色分け（ranking.js の Ranking.totalClass と同じ）:
  //   確定した得点が無い → 'pending'（グレー）、二巡目まで終えた（または大会が終わった）→ 'done'（青）、
  //   それ以外（一巡目まで）→ 'r1'（金茶）
  function totalClass(counted, detail, finished) {
    if (counted === false) return 'pending';
    if (finished || (detail && detail.r2Done === true)) return 'done';
    return 'r1';
  }

  // 内訳の文字（ranking.js の Ranking.detailText と同じ）。二巡目まで終えていれば「41+44」、そうでなければ ''
  function detailText(detail) {
    if (!detail || detail.r2Done !== true) return '';
    return (Number(detail.r1) || 0) + '+' + (Number(detail.r2) || 0);
  }

  // ベスト4 の 1 行を出す状態か（share.js の best4Visible と同じ）
  function best4Visible(best4, status) {
    if (!best4 || !Array.isArray(best4.rows)) return false;
    if (typeof status === 'string') return BEST4_STATES.indexOf(status) !== -1;
    return best4.final === true;
  }

  // ベスト4 の 1 行（courts.js の Courts.best4LineText と同じ文言。EventStatus を読まずに作る）
  function best4LineText(best4) {
    if (!best4 || typeof best4 !== 'object') return '';
    var rows = Array.isArray(best4.rows) ? best4.rows : [];
    var head = (best4.final ? 'ベスト4' : '暫定ベスト4') + '（合計）: ';
    var body;
    if (rows.length > 0) {
      body = rows.map(function(r) {
        return (String((r && r.name) || '').trim() || '(名称未設定)') + '（' + ((r && r.total) || 0) + '点）';
      }).join('・');
    } else {
      body = best4.final ? 'いません（一般男子に合計 1 点以上の人がいない）' : 'まだいません';
    }
    var rest = best4.final ? '' : '　残り ' + (Number(best4.remaining) || 0) + ' 名';
    return head + body + rest;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function mmss(sec) { return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60); }
  function hhmmss(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

  function clampFont(v) {
    var n = (v === null || v === undefined || v === '') ? NaN : Number(v);
    if (!isFinite(n)) return 100;
    n = Math.round(n / FONT_STEP) * FONT_STEP;
    return Math.min(FONT_MAX, Math.max(FONT_MIN, n));
  }

  // --- 描画 ---

  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buildCard(court) {
    var root = make('article', 'watch-card is-idle');
    root.setAttribute('data-court', court);

    var head = make('header', 'watch-card-head');
    var name = make('span', 'watch-court');
    var progress = make('span', 'watch-progress');
    head.appendChild(name);
    head.appendChild(progress);
    root.appendChild(head);

    var stage = make('div', 'watch-stage');
    var who = make('div', 'watch-who');
    root.appendChild(stage);
    root.appendChild(who);

    var wrap = make('div', 'watch-table-wrap');
    var table = make('table', 'watch-table');
    var thead = make('thead');
    var trh = make('tr');
    [['技', 'c-tech'], ['初太刀', ''], ['二ノ太刀', ''], ['三ノ太刀', ''], ['四ノ太刀', ''], ['補正', 'c-adjust'], ['得点', 'c-score']]
      .forEach(function(h) { trh.appendChild(make('th', h[1], h[0])); });
    thead.appendChild(trh);
    var tbody = make('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    root.appendChild(wrap);

    var foot = make('div', 'watch-foot');
    var badge = make('span', 'watch-badge', '確定');
    var total = make('span', 'watch-total');
    var timer = make('span', 'watch-timer', '--:--');
    foot.appendChild(timer);
    foot.appendChild(badge);
    foot.appendChild(total);
    root.appendChild(foot);

    return {
      root: root, name: name, progress: progress, stage: stage, who: who,
      table: table, tbody: tbody, badge: badge, total: total, timerEl: timer,
      sig: '', timer: null, updatedAt: ''
    };
  }

  function cellEl(cell) {
    var td = make('td', cell.kind);
    if (cell.label) td.appendChild(make('span', 'watch-cell-label', cell.label));
    if (cell.points !== null && cell.points !== undefined) td.appendChild(make('span', 'watch-cell-points', String(cell.points)));
    return td;
  }

  function fillCard(card, m) {
    card.name.textContent = m.title;
    card.progress.textContent = m.progressText;
    card.stage.textContent = m.stage;
    card.who.textContent = m.who;
    card.root.classList.toggle('is-idle', m.idle);

    // 同じ内容なら表を触らない（5 秒ごとの読み直しでちらつかせない）
    var sig = JSON.stringify([m.rows, m.noDetail, m.totalAdjust, m.score, m.confirmed]);
    if (sig !== card.sig) {
      card.sig = sig;
      card.tbody.textContent = '';
      if (m.noDetail) {
        var tr0 = make('tr');
        var td0 = make('td', 'no-detail', '内訳なし');
        td0.colSpan = 7;
        tr0.appendChild(td0);
        card.tbody.appendChild(tr0);
      }
      m.rows.forEach(function(row, i) {
        var tr = make('tr');
        var tech = make('td', 'tech');
        tech.appendChild(make('span', 'no', CIRCLED[i] || ''));
        tech.appendChild(document.createTextNode(row.techName));
        tr.appendChild(tech);
        row.cells.forEach(function(c) { tr.appendChild(cellEl(c)); });
        tr.appendChild(make('td', 'num', row.adjust === 0 ? '' : String(row.adjust)));
        tr.appendChild(make('td', 'num score', row.score === null ? '' : String(row.score)));
        card.tbody.appendChild(tr);
      });
      if (m.totalAdjust !== 0) {
        var trf = make('tr', 'total-adjust');
        var tdl = make('td', 'label', '全体補正');
        tdl.colSpan = 6;
        trf.appendChild(tdl);
        trf.appendChild(make('td', 'num score', m.totalAdjust > 0 ? '+' + m.totalAdjust : String(m.totalAdjust)));
        card.tbody.appendChild(trf);
      }
    }
    card.table.classList.toggle('confirmed', m.confirmed);
    card.total.classList.toggle('confirmed', m.confirmed);
    card.total.textContent = '合計 ' + m.score + ' 点';
    card.badge.classList.toggle('is-hidden', !m.confirmed);

    card.timer = m.timer;
    card.updatedAt = m.updatedAt;
    renderCardTimer(card);
  }

  function renderCardTimer(card) {
    if (!card.timer) {
      card.timerEl.textContent = '--:--';
      card.timerEl.classList.remove('is-zero');
      return;
    }
    var sec = Courts.liveRemaining(card.timer, card.updatedAt, Api.serverNowMs());
    var text = mmss(sec);
    if (card.timerEl.textContent !== text) card.timerEl.textContent = text;
    card.timerEl.classList.toggle('is-zero', sec === 0);
  }

  function tick() {
    Object.keys(cards).forEach(function(k) { renderCardTimer(cards[k]); });
  }

  function renderCourts(courts) {
    var names = courts.map(function(c) { return c.court; });
    var key = JSON.stringify(names);
    if (key !== lastCourtNames) {
      lastCourtNames = key;
      cards = Object.create(null);
      el.courts.textContent = '';
      names.forEach(function(n) {
        var card = buildCard(n);
        cards[n] = card;
        el.courts.appendChild(card.root);
      });
    }
    courts.forEach(function(c) { fillCard(cards[c.court], courtCardModel(c)); });
    el.courts.classList.toggle('is-hidden', courts.length === 0);
  }

  function renderBest4(ranking) {
    var status = ranking && ranking.event ? ranking.event.status : undefined;
    var best4 = ranking && ranking.best4;
    if (!best4Visible(best4, status)) {
      el.best4.hidden = true;
      el.best4.textContent = '';
      return;
    }
    el.best4.hidden = false;
    el.best4.textContent = best4LineText(best4);
  }

  function sub(text, cls) {
    return make('span', cls || 'watch-rank-sub', text);
  }

  // 部門 1 つ分の順位表。chance は { remaining, rows: [{flag,label,max,pending} | null, …] }（rows と同じ並び）、
  // detail は rows と同じ並びの { r1, r2, r2Done } | null
  function buildRankSection(title, rows, progress, chance, detail, finished) {
    var sec = make('section', 'watch-rank-col');
    var h3 = make('h3');
    h3.appendChild(document.createTextNode(title));
    if (progress && progress.label) h3.appendChild(sub(progress.label, 'watch-rank-progress'));
    if (chance && typeof chance.remaining === 'number') h3.appendChild(sub('残り ' + chance.remaining + ' 名', 'watch-rank-progress'));
    sec.appendChild(h3);
    if (rows.length === 0) {
      sec.appendChild(make('p', 'watch-rank-none', 'まだいません'));
      return sec;
    }
    var withChance = !!(chance && Array.isArray(chance.rows));
    var table = make('table', 'watch-rank-table');
    var thead = make('thead');
    var trh = make('tr');
    trh.appendChild(make('th', 'rank', '順位'));
    trh.appendChild(make('th', 'name', '名前'));
    trh.appendChild(make('th', 'total', '合計'));
    if (withChance) trh.appendChild(make('th', 'chance', 'ベスト4'));
    thead.appendChild(trh);
    table.appendChild(thead);
    var tbody = make('tbody');
    rows.forEach(function(r, i) {
      var c = withChance ? chance.rows[i] : null;
      var d = (detail && detail[i]) || null;
      var tr = make('tr');
      tr.appendChild(make('td', 'rank', String(r.rank)));
      tr.appendChild(make('td', 'name', r.name));
      var td = make('td', 'total ' + totalClass(r.counted, d, finished), String(r.score));
      var dt = detailText(d);
      if (dt) td.appendChild(sub(dt));
      if (c && c.pending) td.appendChild(sub('→' + c.max + '?', 'watch-rank-max'));
      tr.appendChild(td);
      if (withChance) {
        var tc = make('td', 'chance ' + ((c && c.flag) || ''), (c && c.label) || '');
        if (c && typeof c.max === 'number') tc.title = '最大 ' + c.max + ' 点';
        tr.appendChild(tc);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    return sec;
  }

  function renderRanking(ranking) {
    var json = JSON.stringify(ranking || null);
    if (json === lastRankingJson) return;   // 順位に変わりが無ければ描き直さない
    lastRankingJson = json;
    el.ranking.textContent = '';
    if (!ranking) return;
    var status = ranking.event ? ranking.event.status : '';
    var finished = status === 'final' || status === 'archived';
    var chance = ranking.best4Chance || null;
    var grid = make('div', 'watch-rank-grid');
    CATEGORIES.forEach(function(cat) {
      grid.appendChild(buildRankSection(
        cat.title,
        (ranking.rankings && ranking.rankings[cat.key]) || [],
        ranking.progress && ranking.progress[cat.key],
        chance ? { remaining: chance.remaining && chance.remaining[cat.key], rows: chance[cat.key] } : null,
        (ranking.detail && ranking.detail[cat.key]) || [],
        finished));
    });
    el.ranking.appendChild(grid);
    if (chance && Array.isArray(chance.legend)) {
      el.ranking.appendChild(make('p', 'watch-legend',
        'ベスト4: ' + chance.legend.join('　') + '　→n? はまだ斬っていない人の最大（二巡目が全部成功したときの合計）'));
    }
    if (!finished) el.ranking.appendChild(make('p', 'watch-legend', '合計の色: 青 二巡目まで確定　金茶 一巡目まで　グレー 未確定'));
  }

  function render(data) {
    if (Array.isArray(data.techniques)) Scoring.setTechniques(data.techniques);   // 行の得点と「打てない太刀」の判定に要る
    var ev = data.event || {};
    el.eventName.textContent = ev.name || '';
    el.eventStatus.textContent = statusLabel(ev.status);
    document.title = (ev.name ? ev.name + ' ' : '') + '観戦 - PHX試し斬り';
    renderCourts(Array.isArray(data.courts) ? data.courts : []);
    renderBest4(data.ranking);
    renderRanking(data.ranking);
  }

  function setNotice(text) {
    el.notice.textContent = text || '';
    el.notice.hidden = !text;
  }

  function showInvalid() {
    // 400/404 はリンクが使えないと確定しているので、叩き続けない
    invalid = true;
    stopPolling();
    stopTick();
    el.eventName.textContent = '';
    el.eventStatus.textContent = '';
    el.updated.textContent = '';
    el.courts.textContent = '';
    el.ranking.textContent = '';
    el.best4.hidden = true;
    document.title = 'PHX試し斬り 観戦';
    lastCourtNames = null;
    lastRankingJson = '';
    cards = {};
    setNotice('このリンクは使えません');
    el.notice.classList.add('is-fatal');
  }

  // --- 取得 ---

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function() { load(false); }, REFRESH_MS);
  }
  function stopTick() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }
  function startTick() {
    stopTick();
    tickTimer = setInterval(tick, TICK_MS);
  }

  // 読み直し 1 回分。どの経路でも（時間切れ・例外・描画の失敗を含めて）busy を必ず false に戻す。
  // 戻らないと以後の周が全部「実行中」と見なされて読み直しが止まる。
  // hashchange で切り替わった後の古い応答は捨てる（その場合 busy は切替側の start() がすでに戻している）。
  async function load(force) {
    if (busy) { pending = true; return; }
    busy = true;
    var mySeq = seq;
    var r;
    try {
      // loadWatch は 15 秒で打ち切って status 0 を返す（投げない）。念のため例外も通信失敗と同じに扱う
      r = await Api.loadWatch(token, force ? null : etag);
    } catch (e) {
      r = { ok: false, status: 0, data: null, etag: null };
    }
    if (mySeq !== seq) return;
    busy = false;
    try {
      apply(r);
    } catch (e) {
      console.error(e);
      setNotice('表示できませんでした。5 秒後にもう一度読みます');
    }
    if (pending) {
      pending = false;
      load(false);
    }
  }

  function apply(r) {
    if (r.status === 400 || r.status === 404) {
      showInvalid();
    } else if (r.ok) {
      var ok = true;
      if (r.status === 200) {
        try {
          render(r.data);
          etag = r.etag;   // 描けたときだけ覚える（描けなければ次の周で全部読み直す）
        } catch (e) {
          ok = false;
          console.error(e);
          setNotice('表示できませんでした。5 秒後にもう一度読みます');
        }
      }
      if (ok) {
        setNotice('');
        el.updated.textContent = '更新 ' + hhmmss(new Date());
      }
    } else {
      setNotice('読み込めませんでした。5 秒後にもう一度読みます');
    }
  }

  // --- 文字の大きさ・テーマ ---

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても動く */ }
  }

  function applyFont(pct) {
    pct = clampFont(pct);
    document.documentElement.style.setProperty('--watch-scale', String(pct / 100));
    el.fontDown.disabled = pct <= FONT_MIN;
    el.fontUp.disabled = pct >= FONT_MAX;
    return pct;
  }

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    el.theme.textContent = theme === 'dark' ? '☀ ライト' : '🌙 ダーク';
  }

  function start() {
    seq++;
    busy = false;
    pending = false;
    invalid = false;
    etag = null;
    lastCourtNames = null;
    lastRankingJson = '';
    stopPolling();
    stopTick();
    el.notice.classList.remove('is-fatal');
    setNotice('');
    if (!token) {
      showInvalid();
      return;
    }
    load(true);
    // 裏で開かれたときは 1 回だけ読む。定期の読み直しと秒の刻みは visible になってから始める
    if (!document.hidden) {
      startPolling();
      startTick();
    }
  }

  function init() {
    el = {
      eventName: document.getElementById('eventName'),
      eventStatus: document.getElementById('eventStatus'),
      updated: document.getElementById('updatedAt'),
      notice: document.getElementById('notice'),
      courts: document.getElementById('courts'),
      best4: document.getElementById('best4Line'),
      ranking: document.getElementById('ranking'),
      fontDown: document.getElementById('btnFontDown'),
      fontUp: document.getElementById('btnFontUp'),
      theme: document.getElementById('btnTheme')
    };

    // 応答が届く前に findTechnique が呼ばれても落ちないように空で初期化する
    // （watch.html は data.js を読まないので、既定の TECHNIQUES を持たない）。
    Scoring.setTechniques([]);

    var font = applyFont(readStore(FONT_KEY));
    el.fontDown.addEventListener('click', function() { font = applyFont(font - FONT_STEP); writeStore(FONT_KEY, String(font)); });
    el.fontUp.addEventListener('click', function() { font = applyFont(font + FONT_STEP); writeStore(FONT_KEY, String(font)); });

    var theme = readStore(THEME_KEY) === 'light' ? 'light' : 'dark';   // 既定は黒金（共有・配信と同じ）
    applyTheme(theme);
    el.theme.addEventListener('click', function() {
      theme = theme === 'dark' ? 'light' : 'dark';
      writeStore(THEME_KEY, theme);
      applyTheme(theme);
    });

    token = parseToken(location.hash);
    start();

    // 裏に回ったら止める（見ていない端末がサーバーを叩かない）。戻ったら即 1 回読む
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        stopPolling();
        stopTick();
        return;
      }
      if (invalid || !token) return;
      load(false);
      startPolling();
      startTick();
      tick();
    });

    window.addEventListener('hashchange', function() {
      token = parseToken(location.hash);
      start();
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('watchRoot')) init();
  });

  return {
    statusLabel: statusLabel,
    parseToken: parseToken,
    courtCardModel: courtCardModel,
    strikeCellModel: strikeCellModel,
    totalClass: totalClass,
    detailText: detailText,
    best4Visible: best4Visible,
    best4LineText: best4LineText,
    clampFont: clampFont
  };
})();
