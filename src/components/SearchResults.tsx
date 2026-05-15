import { cookies } from "next/headers";
import { auth0, getOrCreateUserByAuth0Sub } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { hybridSearch } from "@/sectors/c-search/search";
import { ProductCard } from "@/components/ProductCard";
import { SearchUnderstood } from "@/components/SearchUnderstood";
import { SearchTracker } from "@/components/SearchTracker";

export async function SearchResults({ query }: { query: string }) {
  const cookieStore = await cookies();
  const anonymous_id = cookieStore.get("anonymous_id")?.value ?? null;
  const session = await auth0.getSession().catch(() => null);
  let user_id: string | null = null;
  if (session?.user?.sub) {
    const sub = session.user.sub as string;
    const email = (session.user.email as string) ?? `${sub}@noemail.local`;
    user_id = await withPg(async (pg) => (await getOrCreateUserByAuth0Sub(pg, sub, email)).id);
  }

  const result = await withPg((pg) => hybridSearch(query, { pg, anonymous_id, user_id }));

  return (
    <div className="mt-4">
      <SearchTracker query={query} resultsCount={result.products.length} />
      <SearchUnderstood
        normalized={result.normalized}
        method={result.method}
        hitCache={result.hitCache}
        calledMock={result.calledMock}
      />
      {result.products.length === 0 ? (
        <p className="text-gray-500">Sin resultados para &quot;{query}&quot;.</p>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-3">
            {result.products.length} resultados — {result.method}
            {result.hitCache && " (desde caché)"}
            {result.calledMock && " (incluye proveedor externo)"}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {result.products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
