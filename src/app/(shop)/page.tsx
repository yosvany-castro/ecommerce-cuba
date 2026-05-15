import { cookies } from "next/headers";
import { withPg } from "@/lib/db/helpers";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { generateFeed } from "@/sectors/d-personalization/feed";
import { ProductCard } from "@/components/ProductCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const ck = await cookies();
  const anonymous_id = ck.get("anonymous_id")?.value ?? null;
  const session_id = ck.get("session_id")?.value ?? null;

  const session = await auth0.getSession().catch(() => null);
  let user_id: string | null = null;
  if (session?.user?.sub) {
    const sub = session.user.sub as string;
    const email = (session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) =>
      (await getOrCreateUserByAuth0Sub(pg, sub, email)).id,
    );
  }

  const feed = await withPg((pg) =>
    generateFeed({ user_id, anonymous_id, session_id, limit: 20 }, pg),
  );

  if (feed.length === 0) {
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {feed.map((it) => (
          <ProductCard key={it.product.id} product={it.product} />
        ))}
      </div>
    </main>
  );
}
