import { ApifyClient } from "apify-client";

let _client: ApifyClient | null = null;
function client(): ApifyClient {
  if (!_client) {
    if (!process.env.APIFY_TOKEN) throw new Error("APIFY_TOKEN is required");
    _client = new ApifyClient({ token: process.env.APIFY_TOKEN });
  }
  return _client;
}

export interface ApifyRunResult {
  items: unknown[];
  costCents: number;
  latencyMs: number;
}

export interface RunActorOpts {
  limitItems: number;
  timeoutSecs?: number;
  estimatePerItemUsd: number;
}

/** Pura — sin red, testeable directo. */
export function costCentsFromRun(
  usageTotalUsd: number | null | undefined,
  itemCount: number,
  perItemUsd: number,
): number {
  const usd = usageTotalUsd ?? itemCount * perItemUsd;
  return Math.max(1, Math.ceil(usd * 100));
}

interface DatasetItemsClient {
  listItems(opts: { limit: number; offset: number }): Promise<{ items: unknown[]; total: number }>;
}

/** Paginación sin red — acepta cualquier objeto con listItems (real o fake de test). */
export async function collectItems(datasetClient: DatasetItemsClient, limitItems: number): Promise<unknown[]> {
  const items: unknown[] = [];
  let offset = 0;
  while (items.length < limitItems) {
    const page = await datasetClient.listItems({ limit: 1000, offset });
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return items.slice(0, limitItems);
}

export async function runActorGetItems(
  actorSlug: string,
  input: Record<string, unknown>,
  opts: RunActorOpts,
): Promise<ApifyRunResult> {
  const start = Date.now();
  const run = await client()
    .actor(actorSlug)
    .call(input, { waitSecs: opts.timeoutSecs ?? 180, memory: 1024 });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify actor ${actorSlug} run ${run.id} ended with status ${run.status}`);
  }

  const items = await collectItems(client().dataset(run.defaultDatasetId), opts.limitItems);
  const costCents = costCentsFromRun(run.usageTotalUsd, items.length, opts.estimatePerItemUsd);

  return { items, costCents, latencyMs: Date.now() - start };
}
