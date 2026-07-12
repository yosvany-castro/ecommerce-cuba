import Link from "next/link";
import { notFound } from "next/navigation";
import { withPg } from "@/lib/db/helpers";
import {
  fetchCategoryPage,
  CATEGORY_PAGE_SIZE,
} from "@/sectors/b-catalog/repository/category-page";
import { CategoryView } from "@/components/tuki/CategoryView";
import { CATS } from "@/components/tuki/lib";
import type { StorefrontCard } from "@/storefront/contract";

export const dynamic = "force-dynamic";

const CATEGORY_RE = /^[\p{L}\p{N} _-]{2,60}$/u;

const pillStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "10px 18px",
  borderRadius: 999,
  border: "1px solid #ECECE7",
  background: "#fff",
  fontSize: 13.5,
  fontWeight: 600,
} as const;

/**
 * Landing de categoría (D6, estilo Tuki): SSR determinista SIN cookies — lo
 * que ve un bot es lo que ve un humano frío (anti-cloaking por
 * construcción); paginación con ENLACES reales (?page=N) rastreables sin
 * JS. Lo personalizado (slate, cursor) es deliberadamente efímero y NO
 * indexable; ESTO es lo indexable.
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

  const cards: StorefrontCard[] = items.map((it) => ({
    id: it.id,
    title: it.title,
    price_cents: it.price_cents,
    currency: it.currency,
    image_url: it.image_url,
    category,
    source: it.source,
  }));

  // Slug conocido → label/tint reales del CatDef. Slug libre desconocido (el
  // page viejo aceptaba texto libre) → NO mentir con "Otros": título = el
  // slug crudo capitalizado, tint/deep = los de "otros" como fallback visual.
  const known = CATS[category];
  const title = known ? known.label : category.charAt(0).toUpperCase() + category.slice(1);
  const cat = known ?? CATS.otros;
  const header = {
    crumb: "Categoría",
    title,
    why: `todo el pasillo de ${title.toLowerCase()}`,
    deep: cat.deep,
    tint: cat.tint,
  };

  return (
    <>
      <CategoryView cards={cards} header={header} />
      <nav
        aria-label="Paginación"
        style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px 60px", display: "flex", justifyContent: "space-between" }}
      >
        {page > 1 ? (
          <Link prefetch={false} className="tk-hov-bd-dark" style={pillStyle} href={`/c/${raw}?page=${page - 1}` as never}>
            ← Anterior
          </Link>
        ) : (
          <span />
        )}
        {hasNext && (
          <Link prefetch={false} className="tk-hov-bd-dark" style={pillStyle} href={`/c/${raw}?page=${page + 1}` as never}>
            Siguiente ({CATEGORY_PAGE_SIZE} más) →
          </Link>
        )}
      </nav>
    </>
  );
}
