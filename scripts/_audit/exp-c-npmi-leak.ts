#!/usr/bin/env tsx
/**
 * AUDIT EXP C — How much of the NPMI source's power is transductive leakage?
 *
 * The shipped co-occurrence graph is built from ALL events (test sessions
 * included, purchases at weight 5), and the serve-time anchor (lastViewed) is an
 * item of the test session itself. We measure the NPMI source's hit rate
 * (held-out purchase ∈ NPMI-top-50 of the anchor) under:
 *   1. shipped artifact (co_occurrence_top from the DB) + shipped anchor
 *   2. rebuilt FULL graph + shipped anchor              (gate: ≈ #1)
 *   3. TRAIN-ONLY graph + shipped anchor                (graph leak isolated)
 *   4. TRAIN-ONLY graph + PREFIX anchor                 (honest serving)
 * Plus edge forensics: among #1 hits, how many (anchor→test) edges exist ONLY
 * because of test-session co-occurrence?
 */
import { loadData, buildPairCounts, buildNpmiTop } from "./lib";

const d = loadData();
console.log(`[c] events=${d.events.length} testRows=${d.testRows.length} testSessions=${d.testSessionIds.size}`);

// ── Gate: rebuilt FULL graph vs shipped artifact ──────────────────────────────
const pairsFull = buildPairCounts(d.events);
const npmiFull = buildNpmiTop(pairsFull);
const pairsTrain = buildPairCounts(d.events, d.testSessionIds);
const npmiTrain = buildNpmiTop(pairsTrain);

{
  let inter = 0,
    union = 0,
    checked = 0;
  for (const [pid, shipped] of d.npmiShipped) {
    if (checked >= 500) break;
    checked++;
    const mine = new Set((npmiFull.get(pid) ?? []).map((x) => x.id));
    const theirs = new Set(shipped.map((x) => x.id));
    for (const id of theirs) if (mine.has(id)) inter++;
    union += new Set([...mine, ...theirs]).size;
  }
  console.log(`[c] GATE rebuild-vs-shipped (500 productos): overlap=${(inter / Math.max(1, union - inter + inter)).toFixed(3)} (inter=${inter}, union=${union})`);
}

// ── Anchor provenance ─────────────────────────────────────────────────────────
let lvInTestSession = 0,
  lvIsTestItemSession = 0,
  casesWithLv = 0;
for (const t of d.testRows) {
  const k = `${t.uid}|${t.pid}`;
  const lv = d.lastViewedAll.get(t.uid);
  if (!lv) continue;
  casesWithLv++;
  const sid = d.testSession.get(k);
  if (sid && d.sessionItems.get(sid)?.has(lv)) lvInTestSession++;
  if (lv === t.pid) lvIsTestItemSession++;
}
console.log(
  `[c] anchor (lastViewed shipped): en la sesión de TEST en ${(100 * lvInTestSession / casesWithLv).toFixed(1)}% de los casos; es EL PROPIO ítem de test en ${(100 * lvIsTestItemSession / casesWithLv).toFixed(1)}%`,
);

// ── Hit rates ─────────────────────────────────────────────────────────────────
function hit(npmiMap: Map<string, { id: string; score: number }[]>, anchor: string | null, pid: string, trainSet: Set<string>): boolean {
  if (!anchor) return false;
  const top = (npmiMap.get(anchor) ?? [])
    .map((n) => n.id)
    .filter((id) => !trainSet.has(id))
    .slice(0, 50);
  return top.includes(pid);
}

let h1 = 0, h2 = 0, h3 = 0, h4 = 0, nCases = 0;
let edgeOnlyTest = 0, edgeBelowMin = 0, h1Hits = 0;
for (const t of d.testRows) {
  const k = `${t.uid}|${t.pid}`;
  const trainSet = new Set(d.trainByUser.get(t.uid) ?? []);
  const lvShipped = d.lastViewedAll.get(t.uid) ?? null;
  const lvPrefix = d.lastViewedPrefix.get(k) ?? null;
  nCases++;
  const isH1 = hit(d.npmiShipped, lvShipped, t.pid, trainSet);
  if (isH1) h1++;
  if (hit(npmiFull, lvShipped, t.pid, trainSet)) h2++;
  if (hit(npmiTrain, lvShipped, t.pid, trainSet)) h3++;
  if (hit(npmiTrain, lvPrefix, t.pid, trainSet)) h4++;

  // edge forensics for shipped hits
  if (isH1 && lvShipped) {
    h1Hits++;
    const key = lvShipped < t.pid ? `${lvShipped}|${t.pid}` : `${t.pid}|${lvShipped}`;
    const cFull = pairsFull.get(key) ?? 0;
    const cTrain = pairsTrain.get(key) ?? 0;
    if (cFull > 0 && cTrain === 0) edgeOnlyTest++;
    else if (cFull >= 3 && cTrain > 0 && cTrain < 3) edgeBelowMin++;
  }
}
const pc = (x: number) => ((100 * x) / nCases).toFixed(1) + "%";
console.log(`[c] NPMI-source hit-rate (test ∈ top-50 del anchor), n=${nCases}:`);
console.log(`    1. shipped artifact + anchor shipped : ${pc(h1)}`);
console.log(`    2. rebuilt FULL     + anchor shipped : ${pc(h2)}   (gate ≈ 1)`);
console.log(`    3. TRAIN-ONLY graph + anchor shipped : ${pc(h3)}   (aisla fuga del grafo)`);
console.log(`    4. TRAIN-ONLY graph + anchor PREFIX  : ${pc(h4)}   (serving honesto)`);
console.log(
  `[c] forense de aristas (sobre ${h1Hits} hits shipped): la arista (anchor→test) ` +
    `existe SOLO por sesiones de test en ${((100 * edgeOnlyTest) / Math.max(1, h1Hits)).toFixed(1)}%; ` +
    `cae bajo el umbral count≥3 sin test en ${((100 * edgeBelowMin) / Math.max(1, h1Hits)).toFixed(1)}%`,
);
