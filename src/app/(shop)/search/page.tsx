import { searchLike } from "@/sectors/b-catalog/repository/products";
import { ProductCard } from "@/components/ProductCard";
import { SearchTracker } from "@/components/SearchTracker";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const products = q ? await searchLike({ query: q }) : [];

  return (
    <main className="p-8">
      <SearchTracker query={q} resultsCount={products.length} />
      <h1 className="text-2xl font-bold mb-2">Buscar</h1>
      <form action="/search" method="get" className="mb-6">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar productos..."
          className="border rounded px-3 py-2 w-full max-w-md"
        />
      </form>
      {q && (
        <p className="text-sm text-gray-600 mb-4">
          Buscaste: <span className="font-mono">{q}</span> — {products.length} resultados.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </main>
  );
}
