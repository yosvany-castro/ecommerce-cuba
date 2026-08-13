"use client";
// Mesa de preparación de pedidos (admin). Server component padre trae los
// datos; aquí solo la interacción: link de compra + pesaje por producto.
import { useState } from "react";

export interface PedidoAdminItem {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  color: string | null;
  size: string | null;
  title: string;
  image_url: string | null;
  url: string | null;
  source: string;
  weight_grams: number | null;
  weight_source: string | null;
}

export interface PedidoAdmin {
  id: string;
  created_at: string;
  status: string;
  total_charged_cents: number;
  shipping: Record<string, unknown> | null;
  user_email: string | null;
  items: PedidoAdminItem[];
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

function PesoInput({ productId, initialGrams, source }: { productId: string; initialGrams: number | null; source: string | null }) {
  const [grams, setGrams] = useState(initialGrams != null ? String(initialGrams) : "");
  const [state, setState] = useState<"idle" | "saving" | "ok" | "error">(source === "measured" ? "ok" : "idle");

  const save = async () => {
    const g = parseInt(grams, 10);
    if (!Number.isFinite(g) || g < 1) return;
    setState("saving");
    try {
      const res = await fetch(`/api/admin/products/${productId}/weight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grams: g }),
      });
      setState(res.ok ? "ok" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <input
        value={grams}
        onChange={(e) => {
          setGrams(e.target.value.replace(/\D/g, ""));
          if (state === "ok" || state === "error") setState("idle");
        }}
        placeholder="gramos"
        className="w-24 border rounded px-2 py-1 text-sm font-mono"
      />
      <button
        onClick={save}
        disabled={state === "saving"}
        className="text-sm border rounded px-3 py-1 bg-black text-white disabled:opacity-50"
      >
        {state === "saving" ? "…" : "pesar ⚖"}
      </button>
      {state === "ok" && <span className="text-green-700 text-sm">✓ medido</span>}
      {state === "error" && <span className="text-red-600 text-sm">falló — reintenta</span>}
    </span>
  );
}

export function PedidosAdmin({ pedidos }: { pedidos: PedidoAdmin[] }) {
  if (pedidos.length === 0) return <p className="text-gray-500">sin pedidos pendientes 🎉</p>;
  return (
    <div className="flex flex-col gap-6">
      {pedidos.map((o) => {
        const s = (o.shipping ?? {}) as Record<string, string | number | undefined>;
        return (
          <div key={o.id} className="border rounded-xl p-5 bg-white">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-mono text-xs text-gray-400">{o.id.slice(0, 8)}</span>
              <span className="text-sm">{new Date(o.created_at).toLocaleString("es-MX")}</span>
              <span className="text-sm font-bold">{fmt(o.total_charged_cents)}</span>
              <span className="text-sm text-gray-600">
                {String(s.via ?? "aereo")} · {String(s.pago ?? "?")}
              </span>
            </div>
            <div className="text-sm text-gray-700 mt-1">
              📦 {String(s.nombre ?? "?")} · CI {String(s.ci ?? "?")} · tel {String(s.tel ?? "?")}
              <br />
              {String(s.dir ?? "")}, {String(s.ciudad ?? "")}{s.provincia ? `, ${String(s.provincia)}` : ""}
              {o.user_email && !o.user_email.startsWith("demo+") && (
                <span className="text-gray-400"> · cuenta: {o.user_email}</span>
              )}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {o.items.map((it, i) => (
                <div key={i} className="flex items-center gap-3 border-t pt-3">
                  {it.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image_url} alt="" className="w-12 h-12 rounded object-cover flex-none" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-gray-100 flex-none" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {it.quantity}× {it.title}
                    </div>
                    <div className="text-xs text-gray-500">
                      {[it.color, it.size].filter(Boolean).join(" · ") || "sin variante"} · {fmt(it.unit_price_cents)} c/u ·{" "}
                      peso actual: {it.weight_grams != null ? `${it.weight_grams} g (${it.weight_source})` : "sin dato"}
                    </div>
                  </div>
                  {it.url ? (
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold border rounded px-3 py-1 whitespace-nowrap hover:bg-gray-50"
                    >
                      comprar en {it.source} ↗
                    </a>
                  ) : (
                    <span className="text-xs text-red-600">SIN URL — no se puede comprar</span>
                  )}
                  <PesoInput productId={it.product_id} initialGrams={it.weight_grams} source={it.weight_source} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
