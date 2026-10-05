import { redirect } from "next/navigation";
import { getAuthUser, requireAdmin } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { PromosAdmin, type PromoRow } from "@/components/PromosAdmin";

export const dynamic = "force-dynamic";

// /admin/promos — anuncios propios: productos elegidos a mano que aparecen
// intercalados en listados, home, página de producto o carro.
export default async function PromosAdminPage() {
  const session = await getAuthUser();
  if (!session?.sub) redirect("/login?returnTo=/admin/promos" as Parameters<typeof redirect>[0]);
  if (!(await requireAdmin())) redirect("/");

  const promos = await withPg(async (pg) => {
    const r = await pg.query(
      `SELECT id::text, surface, slot, status, params->>'title' AS title,
              jsonb_array_length(COALESCE(params->'product_ids', '[]'::jsonb)) AS n,
              rule->>'value' AS category, created_at::text
       FROM ui_placements WHERE section_type = 'promo' AND status <> 'archived'
       ORDER BY created_at DESC LIMIT 100`,
    );
    return r.rows as PromoRow[];
  });

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Anuncios propios</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        productos que tú eliges promocionar — salen intercalados entre los resultados (nunca antes de ellos). tardan hasta 1 minuto en aparecer.
      </p>
      <PromosAdmin promos={promos} />
    </main>
  );
}
