import { redirect } from "next/navigation";
import { auth0, requireAdmin } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { hybridSearch } from "@/sectors/c-search/search";
import { SearchTraceView } from "@/components/SearchTraceView";

export const dynamic = "force-dynamic";

export default async function ExplainPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth0.getSession().catch(() => null);
  if (!session?.user?.sub) redirect("/auth/login?returnTo=/admin/search/explain");
  if (!(await requireAdmin())) redirect("/");

  const { q = "" } = await searchParams;
  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Debug Search</h1>
      <form action="/admin/search/explain" method="get" className="mb-6">
        <input
          name="q"
          defaultValue={q}
          placeholder='Probar query, e.g. "regalo abuelo"'
          className="border rounded px-3 py-2 w-full max-w-2xl"
        />
        <button type="submit" className="ml-2 bg-black text-white px-4 py-2 rounded">
          Explicar
        </button>
      </form>
      {q && <ExplainTrace query={q} />}
    </main>
  );
}

async function ExplainTrace({ query }: { query: string }) {
  const result = await withPg((pg) =>
    hybridSearch(query, { pg, anonymous_id: null, user_id: null }, { trace: true }),
  );
  if (!result.trace) {
    return <p>(no trace generated)</p>;
  }
  return <SearchTraceView trace={result.trace} method={result.method} />;
}
