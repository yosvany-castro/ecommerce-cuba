import { cookies } from "next/headers";
import { after } from "next/server";
import { withPg } from "@/lib/db/helpers";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { composePage, logSlateDecision } from "@/sectors/f-slate/compose";
import { resolveSections } from "@/sectors/f-slate/sections/resolve";
import { SlateRenderer } from "@/components/slate/SlateRenderer";
import { RequestTiming } from "@/lib/timing";

export const dynamic = "force-dynamic";

/** F5: sampled structured-log persistence (Server Components can't set headers). */
const TIMING_SAMPLE_RATE = 0.2;

function logTimingSampled(timing: RequestTiming): void {
  if (Math.random() < TIMING_SAMPLE_RATE) console.log(timing.toLogLine("home"));
}

export default async function HomePage() {
  const timing = new RequestTiming();
  const ck = await cookies();
  const anonymous_id = ck.get("anonymous_id")?.value ?? null;
  const session_id = ck.get("session_id")?.value ?? null;

  const session = await timing.time("auth", () => auth0.getSession().catch(() => null));
  let user_id: string | null = null;
  if (session?.user?.sub) {
    const sub = session.user.sub as string;
    const email = (session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await timing.time("auth_upsert", () =>
      withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id),
    );
  }

  // D4: la home es una composición — composePage decide QUÉ secciones (con el
  // seed actual = solo hero_grid, HTML equivalente al pre-slate) y el runner
  // las llena (el hero ES el slate feed con su cursor de scroll infinito).
  const identity = { user_id, anonymous_id, session_id };
  const sections = await timing.time("feed_page", () =>
    withPg(async (pg) => {
      const page = await composePage({ surface: "home", identity }, pg);
      const resolved = await resolveSections(page, identity, undefined, pg);
      const hero = resolved.find((s) => s.section_type === "hero_grid");
      await logSlateDecision(
        page,
        { user_profile_id: null, session_id, slate_id: hero?.slate_id ?? null },
        pg,
      );
      return resolved;
    }),
  );

  after(() => logTimingSampled(timing));

  const hasContent = sections.some((s) => s.outcome === "served" && s.items.length > 0);
  if (!hasContent) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold mb-4">Catálogo</h1>
        <p className="text-gray-600">
          No hay productos todavía. En desarrollo, ejecuta:
          <code className="bg-gray-100 ml-2 px-2 py-1 rounded">
            pnpm cron:catalog-fill --pages 1
          </code>{" "}
          y luego{" "}
          <code className="bg-gray-100 ml-2 px-2 py-1 rounded">
            pnpm cron:cohort-centroids
          </code>
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Catálogo</h1>
      <SlateRenderer sections={sections} />
    </main>
  );
}
