// scripts/perf-3g.ts — medición de carga con red 3G simulada (CDP throttling).
// El sitio es para usuarios con internet MUY mala: cada KB cuenta. Corre contra
// el build de PRODUCCIÓN (next build && next start), nunca contra dev:
//   pnpm build && pnpm start &   → luego:  pnpm perf:3g
// Simula "Slow 3G" de DevTools: 400 ms RTT, ~400 kbps bajada, ~100 kbps subida.
// Reporta por página: requests, KB por tipo (img/js/css/font/doc) y tiempo a load.
import { chromium } from "@playwright/test";

const BASE = process.env.PERF_BASE_URL ?? "http://localhost:3000";
const PAGES: [string, string][] = [
  ["home", `${BASE}/`],
  ["pdp", `${BASE}/products/8c14a5ac-76fb-4353-b2e8-9d73ac64687b?src=home`],
  ["categoria", `${BASE}/c/electronica`],
];

const SLOW_3G = {
  offline: false,
  latency: 400,
  downloadThroughput: (400 * 1024) / 8,
  uploadThroughput: (100 * 1024) / 8,
};

type Bucket = "document" | "script" | "stylesheet" | "image" | "font" | "other";
function bucketOf(type: string): Bucket {
  const t = type.toLowerCase();
  if (t === "document") return "document";
  if (t === "script") return "script";
  if (t === "stylesheet") return "stylesheet";
  if (t === "image") return "image";
  if (t === "font") return "font";
  return "other";
}
const kb = (n: number) => (n / 1024).toFixed(0).padStart(6);

async function measure(label: string, url: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW_3G);

  const typeByRequest = new Map<string, Bucket>();
  const bytes: Record<Bucket, number> = { document: 0, script: 0, stylesheet: 0, image: 0, font: 0, other: 0 };
  let requests = 0;
  cdp.on("Network.responseReceived", (e: { requestId: string; type?: string }) => {
    requests++;
    typeByRequest.set(e.requestId, bucketOf(e.type ?? "other"));
  });
  cdp.on("Network.loadingFinished", (e: { requestId: string; encodedDataLength: number }) => {
    const b = typeByRequest.get(e.requestId) ?? "other";
    bytes[b] += e.encodedDataLength; // bytes REALES por el cable (comprimidos)
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 300_000 });
  const loadMs = Date.now() - t0;
  // FCP = cuándo el usuario VE algo (la métrica que debe estar bajo ~5s en 3G;
  // el load completo a 50KB/s es física, no UX).
  const fcpMs = await page.evaluate(() => {
    const e = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
    return e ? Math.round(e.startTime) : null;
  });
  // deja terminar lo lazy visible del primer viewport
  await page.waitForTimeout(3_000);
  await browser.close();

  const total = Object.values(bytes).reduce((a, b) => a + b, 0);
  console.log(
    `${label.padEnd(10)} FCP=${fcpMs != null ? (fcpMs / 1000).toFixed(1) : "?"}s load=${(loadMs / 1000).toFixed(1).padStart(5)}s req=${String(requests).padStart(3)}` +
      ` | KB total=${kb(total)} img=${kb(bytes.image)} js=${kb(bytes.script)} css=${kb(bytes.stylesheet)}` +
      ` font=${kb(bytes.font)} doc=${kb(bytes.document)} otro=${kb(bytes.other)}`,
  );
  return { label, loadMs, fcpMs, requests, total, bytes };
}

async function main() {
  console.log(`[perf-3g] Slow 3G (400ms RTT, 400kbps↓) contra ${BASE}\n`);
  for (const [label, url] of PAGES) {
    try {
      await measure(label, url);
    } catch (e) {
      console.log(`${label.padEnd(10)} ERROR: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
