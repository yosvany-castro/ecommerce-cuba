import { getPgClient } from "@/lib/db/pg";

export const TEST_SCHEMA = "test_schema";

export async function withTestDb<T>(
  fn: (client: Awaited<ReturnType<typeof getPgClient>>) => Promise<T>,
): Promise<T> {
  const client = await getPgClient({ scope: "test" });
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function truncateTestTables(tables: string[]) {
  await withTestDb(async (client) => {
    for (const t of tables) {
      await client.query(`TRUNCATE test_schema.${t} CASCADE`);
    }
  });
}
