import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { getCoOccurrenceTopAdmin } from "@/sectors/d-personalization/admin/co-occurrence-top";

export const dynamic = "force-dynamic";

export default async function CoOccurrenceTopPage() {
  const session = await auth0.getSession().catch(() => null);
  if (!session?.user?.sub) {
    redirect("/auth/login?returnTo=/admin/co-occurrence/top");
  }

  const rows = await withPg((pg) => getCoOccurrenceTopAdmin({ limit: 50 }, pg));

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Co-occurrence top 50 (NPMI)</h1>
      {rows.length === 0 ? (
        <p className="text-gray-600">
          Grafo vacío. Ejecutar{" "}
          <code className="bg-gray-100 px-1">pnpm cron:npmi-recompute</code>{" "}
          después de que haya actividad en sesiones reales.
        </p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">#</th>
              <th className="py-2 pr-4">Producto</th>
              <th className="py-2 pr-4">↔ Relacionado</th>
              <th className="py-2 pr-4">NPMI</th>
              <th className="py-2 pr-4">Rank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.product_id}-${r.related_product_id}`} className="border-b">
                <td className="py-1 pr-4">{i + 1}</td>
                <td className="py-1 pr-4">{r.product_title}</td>
                <td className="py-1 pr-4">{r.related_product_title}</td>
                <td className="py-1 pr-4">{r.npmi_score.toFixed(4)}</td>
                <td className="py-1 pr-4">{r.rank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
