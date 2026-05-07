"use client";
import Link from "next/link";
import { useCart, type CartItem } from "./CartProvider";

export function CartView() {
  const { items, loading, remove } = useCart();

  if (loading) return <p>Cargando...</p>;
  if (items.length === 0) {
    return (
      <p>
        Tu carrito está vacío.{" "}
        <Link className="underline" href={"/" as any}>
          Volver al catálogo
        </Link>
        .
      </p>
    );
  }

  // For logged-in users, /api/cart returned hydrated rows (with title/price/image).
  // For anon users, items come from localStorage (just product_id + quantity) — show placeholder text.
  return (
    <div>
      <ul className="divide-y" data-testid="cart-list">
        {items.map((item) => {
          const hydrated = (item as CartItem & Partial<{ title: string; price_cents: number; image_url: string | null }>);
          return (
            <li key={item.product_id} className="py-4 flex gap-4 items-center">
              {hydrated.image_url ? (
                <img src={hydrated.image_url} alt={hydrated.title ?? "Producto"} className="w-16 h-16 object-cover rounded" />
              ) : (
                <div className="w-16 h-16 bg-gray-100 rounded" />
              )}
              <div className="flex-1">
                <p className="font-medium">{hydrated.title ?? "Producto"}</p>
                <p className="text-sm text-gray-500">Cantidad: {item.quantity}</p>
                {typeof hydrated.price_cents === "number" && (
                  <p className="text-sm text-gray-500">${(hydrated.price_cents / 100).toFixed(2)}</p>
                )}
              </div>
              <button
                className="text-red-600 text-sm"
                onClick={() => void remove(item.product_id, 1)}
              >
                Quitar 1
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-6">
        <Link href={"/checkout" as any} className="bg-black text-white px-6 py-3 rounded inline-block">
          Continuar al checkout
        </Link>
      </div>
    </div>
  );
}
