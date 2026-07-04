"use client";
// /checkout/success — port de la pantalla ÉXITO (dc.html 715–728). Lee ?order= y
// ?m= (método) y calcula la eta client-side. useSearchParams exige <Suspense> en Next 16.
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SHIP, etaLine } from "@/components/tuki/checkout-core";

function SuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get("order") ?? "";
  const metodo = params.get("m") ?? "estandar";
  const m = SHIP.find((s) => s.id === metodo) ?? SHIP[1];
  const okLine = orderId
    ? `${etaLine(m.d1, m.d2)} en envío ${m.name.toLowerCase()} · pedido ${orderId}`
    : `pedido ${orderId}`;

  return (
    <div style={{ animation: "screenIn .3s ease both", textAlign: "center", padding: "110px 30px" }}>
      <div style={{ width: 100, height: 100, borderRadius: "50%", background: "#1C1D20", color: "#fff", fontSize: 42, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", animation: "checkPop .5s cubic-bezier(.2,.8,.2,1) both" }}>✓</div>
      <div style={{ fontFamily: "var(--font-brico)", fontSize: 34, fontWeight: 800, letterSpacing: "-0.7px", marginTop: 26 }}>¡Pedido en camino!</div>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 19, color: "#55565B", marginTop: 10 }}>{okLine}</div>
      <div style={{ display: "inline-block", background: "#EAF2EA", color: "#557A55", borderRadius: 16, padding: "14px 22px", fontSize: 14, marginTop: 24 }}>✦ tu feed ya aprendió de esta compra — verás mejores sugerencias</div>
      <div style={{ marginTop: 26 }}>
        <div
          onClick={() => router.push("/")}
          className="tk-hov-cta"
          style={{ display: "inline-flex", background: "#1C1D20", color: "#fff", borderRadius: 999, padding: "16px 30px", fontSize: 15.5, fontWeight: 700, cursor: "pointer" }}
        >
          Seguir explorando →
        </div>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense>
      <SuccessInner />
    </Suspense>
  );
}
