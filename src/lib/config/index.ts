import { z } from "zod";

const ConfigSchema = z.object({
  SUPABASE_DB_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1),
  VOYAGE_API_KEY: z.string().min(1),
  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_CLIENT_SECRET: z.string().min(1),
  AUTH0_SECRET: z.string().min(1),
  APP_BASE_URL: z.string().url(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid config: ${missing}`);
  }
  return parsed.data;
}

let _cached: Config | null = null;
export function config(): Config {
  if (_cached) return _cached;
  _cached = loadConfig();
  return _cached;
}
