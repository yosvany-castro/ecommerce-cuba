"use client";
import { useState } from "react";

export function AddToCartButton({ productId }: { productId: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      disabled={pending}
      className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
      onClick={async () => {
        setPending(true);
        // Wired in Task 25 — for now just log so the UI is testable.
        console.log("add_to_cart placeholder", productId);
        setPending(false);
      }}
    >
      {pending ? "Agregando..." : "Agregar al carrito"}
    </button>
  );
}
