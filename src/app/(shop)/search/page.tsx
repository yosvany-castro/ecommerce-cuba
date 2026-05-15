import { Suspense } from "react";
import { SearchSkeleton } from "@/components/SearchSkeleton";
import { SearchResults } from "@/components/SearchResults";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-2">Buscar</h1>
      <form action="/search" method="get" className="mb-4">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar productos..."
          className="border rounded px-3 py-2 w-full max-w-md"
        />
      </form>
      {q && (
        <Suspense key={q} fallback={<SearchSkeleton query={q} />}>
          <SearchResults query={q} />
        </Suspense>
      )}
    </main>
  );
}
