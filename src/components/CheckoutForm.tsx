"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./CartProvider";

export function CheckoutForm() {
  const router = useRouter();
  const { items, refresh } = useCart();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce(
    (s, i) => s + (typeof (i as unknown as { price_cents?: number }).price_cents === "number"
      ? ((i as unknown as { price_cents: number }).price_cents) * i.quantity
      : 0),
    0,
  );

  return (
    <div>
      <p className="mb-4">Items: {items.length} | Total estimado: ${(total / 100).toFixed(2)}</p>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <button
        disabled={pending || items.length === 0}
        className="bg-black text-white px-6 py-3 rounded disabled:opacity-50"
        onClick={async () => {
          setPending(true); setError(null);
          const r = await fetch("/api/checkout", { method: "POST" });
          if (!r.ok) {
            setPending(false);
            const body = await r.json().catch(() => ({}));
            setError(body.error ?? "checkout_failed");
            return;
          }
          const { order_id } = await r.json();
          if (typeof window !== "undefined") {
            const m = document.cookie.match(/(^|;\s*)anonymous_id=([^;]+)/);
            const anonId = m ? decodeURIComponent(m[2]) : null;
            if (anonId) localStorage.removeItem(`cart:${anonId}`);
          }
          await refresh();
          router.push((`/checkout/success?order_id=${order_id}`) as any);
        }}
      >
        {pending ? "Procesando..." : "Confirmar compra simulada"}
      </button>
    </div>
  );
}
