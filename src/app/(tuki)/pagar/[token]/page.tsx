// /pagar/[token] — página que abre el familiar desde el link del checkout Cuba.
// Muestra el total (y los productos, salvo que el comprador los ocultara).
// ponytail: sin procesador de pago todavía (decisión 2026-10-05: solo UI) —
// cuando exista, el botón de abajo es donde se engancha.
import { notFound } from "next/navigation";
import { withPg } from "@/lib/db/helpers";
import { fmt } from "@/components/tuki/lib";

interface OrderRow {
  status: string;
  total_charged_cents: number;
  pay_hide_items: boolean;
  shipping: { nombre?: string; ciudad?: string; provincia?: string; ship_cents?: number; tax_cents?: number; discount_cents?: number } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PagarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UUID.test(token)) notFound();
  const data = await withPg(async (pg) => {
    const o = await pg.query<OrderRow & { id: string }>(
      `SELECT id, status, total_charged_cents, pay_hide_items, shipping FROM orders WHERE pay_token = $1`,
      [token],
    );
    if (!o.rows[0]) return null;
    const items = o.rows[0].pay_hide_items
      ? []
      : (
          await pg.query<{ title: string; quantity: number; unit_price_cents: number; image_url: string | null }>(
            `SELECT product_snapshot->>'title' AS title, quantity, unit_price_cents, product_snapshot->>'image_url' AS image_url
             FROM order_items WHERE order_id = $1`,
            [o.rows[0].id],
          )
        ).rows;
    return { order: o.rows[0], items };
  });

  // Link copiado antes de completar la orden: el token aún no existe en BD.
  if (!data) {
    return (
      <Box>
        <h1 style={{ fontFamily: "var(--font-brico)", fontSize: 28, fontWeight: 700, margin: 0 }}>Este pedido aún no está listo</h1>
        <p style={{ color: "#55565B", fontSize: 15 }}>Tu familiar todavía no completó la orden. Vuelve a abrir este enlace en un rato.</p>
      </Box>
    );
  }
  const { order, items } = data;
  const s = order.shipping ?? {};
  const pagado = order.status !== "esperando_pago";

  return (
    <Box>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#8E8F94", letterSpacing: ".6px" }}>PEDIDO EN TUKI</div>
      <h1 style={{ fontFamily: "var(--font-brico)", fontSize: 30, fontWeight: 700, margin: "6px 0 0" }}>
        {s.nombre ?? "Tu familiar"} te pidió ayuda con su pedido
      </h1>
      <p style={{ color: "#55565B", fontSize: 14.5, marginTop: 6 }}>
        se entrega en {s.ciudad}, {s.provincia}
      </p>

      {items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {it.image_url && <img src={it.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.quantity}× {it.title}
              </span>
              <b>{fmt(it.unit_price_cents * it.quantity)}</b>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13.5, color: "#8E8F94", marginTop: 18 }}>los productos son una sorpresa 🎁</p>
      )}

      <div style={{ height: 1, background: "#F1F1EE", margin: "18px 0" }} />
      {s.ship_cents !== undefined && <Row k="Envío" v={fmt(s.ship_cents)} />}
      {s.tax_cents !== undefined && <Row k="Impuestos" v={fmt(s.tax_cents)} />}
      {!!s.discount_cents && <Row k="Descuento" v={`−${fmt(s.discount_cents)}`} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Total a pagar</span>
        <span style={{ fontSize: 28, fontWeight: 700 }}>{fmt(order.total_charged_cents)}</span>
      </div>

      {pagado ? (
        <div style={{ marginTop: 20, background: "#EAF2EA", color: "#557A55", borderRadius: 14, padding: "14px 18px", fontWeight: 600 }}>✓ este pedido ya está pagado</div>
      ) : (
        <>
          <div style={{ marginTop: 20, height: 54, borderRadius: 999, background: "#E3E3DE", color: "#8E8F94", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700 }}>
            Pagar con tarjeta · muy pronto
          </div>
          <p style={{ fontSize: 12.5, color: "#8E8F94", marginTop: 10, textAlign: "center" }}>
            guarda este enlace — el pago en línea se habilita muy pronto
          </p>
        </>
      )}
    </Box>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "50px 20px 90px" }}>
      <div style={{ background: "#fff", border: "1px solid #EFEFEA", borderRadius: 22, padding: "26px 24px" }}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#55565B", marginTop: 6 }}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
