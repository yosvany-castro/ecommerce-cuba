"use client";
import { useState } from "react";
import { useCart } from "./CartProvider";

export function AddToCartButton({ productId }: { productId: string }) {
  const [pending, setPending] = useState(false);
  const { add } = useCart();
  return (
    <button
      disabled={pending}
      className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
      onClick={async () => {
        setPending(true);
        try {
          await add(productId, 1);
          // E4: el gesto de máxima intención dispara las sugerencias in situ.
          window.dispatchEvent(new CustomEvent("cart:item-added", { detail: { productId } }));
        } finally { setPending(false); }
      }}
    >
      {pending ? "Agregando..." : "Agregar al carrito"}
    </button>
  );
}
