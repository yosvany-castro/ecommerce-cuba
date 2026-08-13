import { redirect } from "next/navigation";
import { getAuthUser, requireAdmin } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { PedidosAdmin, type PedidoAdmin } from "@/components/PedidosAdmin";

export const dynamic = "force-dynamic";

// /admin/pedidos — la mesa de preparación (VITAL para operar): por cada pedido
// pendiente, QUÉ comprar (link REAL a la tienda origen), la variante elegida,
// los datos de entrega del cliente, y el pesaje en báscula al preparar (que
// fija weight_source='measured' y calibra vecinos vía el endpoint existente).
export default async function PedidosAdminPage() {
  const session = await getAuthUser();
  if (!session?.sub) redirect("/login?returnTo=/admin/pedidos" as Parameters<typeof redirect>[0]);
  if (!(await requireAdmin())) redirect("/");

  const pedidos = await withPg(async (pg) => {
    const res = await pg.query(
      `SELECT o.id, o.created_at, o.status, o.total_charged_cents, o.shipping,
              u.email AS user_email,
              COALESCE(jsonb_agg(jsonb_build_object(
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'unit_price_cents', oi.unit_price_cents,
                'color', oi.product_snapshot->>'color',
                'size', oi.product_snapshot->>'size',
                'title', p.title,
                'image_url', p.image_url,
                'url', p.url,
                'source', p.source,
                'weight_grams', p.weight_grams,
                'weight_source', p.weight_source
              ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.status = 'pendiente'
       GROUP BY o.id, u.email
       ORDER BY o.created_at DESC
       LIMIT 50`,
    );
    return res.rows as PedidoAdmin[];
  });

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold">Pedidos pendientes — preparación</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        compra cada item en su tienda (link ↗), pésalo al llegar y guarda el peso real — el estimado
        de vecinos se recalibra solo
      </p>
      <PedidosAdmin pedidos={pedidos} />
    </main>
  );
}
