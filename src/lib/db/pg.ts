import { Client } from "pg";
import type { Scope } from "./supabase";

export async function getPgClient(opts: { scope?: Scope } = {}): Promise<Client> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  const schema = opts.scope === "test" ? "test_schema, public" : "public";
  await client.query(`SET search_path TO ${schema}`);
  return client;
}
