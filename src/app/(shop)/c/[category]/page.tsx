import Link from "next/link";
import { notFound } from "next/navigation";
import { withPg } from "@/lib/db/helpers";
import {
  fetchCategoryPage,
  CATEGORY_PAGE_SIZE,
} from "@/sectors/b-catalog/repository/category-page";
import { ProductCard } from "@/components/ProductCard";

export const dynamic = "force-dynamic";

const CATEGORY_RE = /^[\p{L}\p{N} _-]{2,60}$/u;

/**
 * Landing de categoría (D6): SSR determinista SIN cookies — lo que ve un bot
 * es lo que ve un humano frío (anti-cloaking por construcción); paginación
 * con ENLACES reales (?page=N) rastreables sin JS. Lo personalizado (slate,
 * cursor) es deliberadamente efímero y NO indexable; ESTO es lo indexable.
 */
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { category: raw } = await params;
  const category = decodeURIComponent(raw);
  if (!CATEGORY_RE.test(category)) return notFound();
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, Math.min(200, Number.parseInt(pageRaw ?? "1", 10) || 1));

  const { items, hasNext } = await withPg((pg) => fetchCategoryPage(category, page, pg));
  if (items.length === 0 && page === 1) return notFound();

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6 capitalize">{category}</h1>
      {items.length === 0 ? (
        <p className="text-gray-600">No hay más productos en esta página.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((it) => (
            <ProductCard key={it.id} product={it} />
          ))}
        </div>
      )}
      <nav className="mt-8 flex justify-between text-sm" aria-label="Paginación">
        {page > 1 ? (
          <Link prefetch={false} className="underline" href={`/c/${raw}?page=${page - 1}` as never}>
            ← Anterior
          </Link>
        ) : (
          <span />
        )}
        {hasNext && (
          <Link prefetch={false} className="underline" href={`/c/${raw}?page=${page + 1}` as never}>
            Siguiente ({CATEGORY_PAGE_SIZE} más) →
          </Link>
        )}
      </nav>
    </main>
  );
}
