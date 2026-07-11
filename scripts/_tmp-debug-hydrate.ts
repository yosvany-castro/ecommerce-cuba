#!/usr/bin/env tsx
// Debug temporal: qué devuelve RTD en vivo para el ASIN del Levi's. NO commitear.
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFile } from "node:fs/promises";
import { fetchDetailJson } from "@/sectors/b-catalog/revalidate";
import { parseAmazonVariants } from "@/sectors/b-catalog/hydrate";

async function main() {
  const fetched = await fetchDetailJson({ source: "amazon", source_product_id: "B0018QS5HU", url: null });
  if (!fetched) { console.log("null fetch"); return; }
  const data = (fetched.json as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  console.log("data keys:", data ? Object.keys(data).filter((k) => k.includes("variation") || k === "asin").join(", ") : "SIN data");
  const apv = data?.all_product_variations;
  console.log("all_product_variations:", apv ? `${typeof apv} con ${Object.keys(apv as object).length} entradas` : "AUSENTE");
  console.log("parseAmazonVariants:", parseAmazonVariants(fetched.json).length, "variantes");
  await writeFile("/tmp/rtd-live-debug.json", JSON.stringify(fetched.json).slice(0, 3000));
}
main().catch((e) => console.error("FALLO:", (e as Error).message));
