// 採点画面と同じ計算（設計書 2026-10-03 7.1・7.3）。
// - scoring.js（得点の計算・result の符号化）は接続先のサーバーから取って vm で読む（公開ファイル。予行スクリプトと同じ）。
//   取れなければ、このリポジトリの scoring.js を読む。
// - status.js（EventStatus.isRowScorable など）はサーバーでは保護ファイル（AI 用キーでは 401）なので、
//   このリポジトリの status.js を読む。採点できるかの最終判定はサーバー（409 not_scorable）がするので、
//   ここでの判定は「どの行を採点しに行くか」の選び方にだけ使う。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

function runScript(code, globals, exportName, filename) {
  const ctx = vm.createContext(Object.assign({}, globals));
  vm.runInContext(code, ctx, { filename, timeout: 2000 });
  const v = ctx[exportName];
  if (!v) throw new Error(exportName + ' が見つかりません');
  return v;
}

let scoringPromise = null;
// api.fetchPublicText を使ってサーバーの /scoring.js を読む（1 プロセスで 1 回）
export function loadScoring(api) {
  if (!scoringPromise) {
    scoringPromise = (async () => {
      try {
        const code = await api.fetchPublicText('/scoring.js');
        return { Scoring: runScript(code, { TECHNIQUES: [] }, 'Scoring', 'scoring.js'), source: 'server' };
      } catch (e) {
        const code = readFileSync(path.join(REPO_ROOT, 'scoring.js'), 'utf8');
        return { Scoring: runScript(code, { TECHNIQUES: [] }, 'Scoring', 'scoring.js'), source: 'local' };
      }
    })();
    scoringPromise.catch(() => { scoringPromise = null; });
  }
  return scoringPromise;
}

let statusModule = null;
export function loadStatus() {
  if (!statusModule) {
    const code = readFileSync(path.join(REPO_ROOT, 'status.js'), 'utf8');
    statusModule = runScript(code, {}, 'EventStatus', 'status.js');
  }
  return statusModule;
}

// ───────── 予行スクリプト（rehearse.mjs）と同じ乱数と割合 ─────────
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 採点の計画（rehearse.mjs の planScoring と同じ。rnd の消費の順も同じ）
export function planScoring(Scoring, rnd, techs, isFemale) {
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const rows = techs.filter(Boolean).map(name => {
    const tech = Scoring.findTechnique(name, isFemale);
    const values = [];
    let failed = false;
    for (let s = 0; s < 4; s++) {
      if (!tech || tech.strikes[s] === null) { values.push(''); continue; }
      if (failed) { values.push(''); continue; }
      const x = rnd();
      let v = '○';
      if (s === 0 && typeof tech.reducedFirst === 'number' && x < 0.25) v = '△';
      else if (x < (s === 0 ? 0.12 : 0.22)) v = '×';
      if (v === '×') failed = true;
      values.push(v);
    }
    const adjust = rnd() < 0.25 ? pick([-2, -1, 1, 2, 3]) : 0;
    return { techName: name, values, adjust };
  });
  const totalAdjust = rnd() < 0.15 ? pick([-1, 1, 2]) : 0;
  return { rows, totalAdjust };
}

// 採点画面と同じ形の PATCH の本文（rehearse.mjs の bodyOf と同じ）
export function scoreBody(Scoring, plan, isFemale, confirmed, baseRev, note) {
  const result = Scoring.encodeResult(plan.rows.map(r => ({ values: r.values })));
  const adjust = [0, 0, 0];
  plan.rows.forEach((r, i) => { if (i < 3) adjust[i] = r.adjust; });
  const score = Scoring.calcTotalScore(plan.rows, isFemale, plan.totalAdjust);
  const body = { score, result, adjust, totalAdjust: plan.totalAdjust, confirmed, baseRev };
  if (note !== undefined) body.note = note;
  return body;
}
