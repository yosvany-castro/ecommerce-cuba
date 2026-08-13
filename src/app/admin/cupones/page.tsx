import { redirect } from "next/navigation";
import { getAuthUser, requireAdmin } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { CuponesAdmin, type CouponRow } from "@/components/CuponesAdmin";

export const dynamic = "force-dynamic";

// /admin/cupones — cupones de campaña: crear, ver usos, activar/desactivar.
export default async function CuponesAdminPage() {
  const session = await getAuthUser();
  if (!session?.sub) redirect("/login?returnTo=/admin/cupones" as Parameters<typeof redirect>[0]);
  if (!(await requireAdmin())) redirect("/");

  const coupons = await withPg(async (pg) => {
    const r = await pg.query(
      `SELECT code, pct, starts_at::text, ends_at::text, max_uses, uses, active FROM coupons ORDER BY created_at DESC LIMIT 100`,
    );
    return r.rows as CouponRow[];
  });

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Cupones de campaña</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        % de descuento sobre el subtotal de productos — el envío (tu margen) y el tax no se descuentan
      </p>
      <CuponesAdmin coupons={coupons} />
    </main>
  );
}
