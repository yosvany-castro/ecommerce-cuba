"use client";

import { useState } from "react";
import Link from "next/link";

export interface ProductCardData {
  id: string;
  title: string;
  price_cents: number;
  image_url: string | null;
}

export function ProductCard({
  product,
  reason,
}: {
  product: ProductCardData;
  reason?: string;
}) {
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  async function onDismiss(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setHidden(true);
    try {
      await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "dismiss",
          occurred_at: new Date().toISOString(),
          payload: { product_id: product.id, reason: "not_interested" },
        }),
      });
    } catch {
      setHidden(false);
    }
  }

  return (
    <div className="relative" data-testid="product-card">
      <Link
        href={`/products/${product.id}` as never}
        className="block border rounded-lg p-4 hover:shadow"
      >
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.title}
            className="w-full h-40 object-cover mb-2 rounded"
          />
        ) : (
          <div className="w-full h-40 bg-gray-100 rounded mb-2" />
        )}
        <h2 className="font-semibold text-sm line-clamp-2">{product.title}</h2>
        <p className="text-sm text-gray-500 mt-1">
          ${(product.price_cents / 100).toFixed(2)}
        </p>
        {reason && (
          <p
            className="text-xs text-blue-600 mt-1 italic line-clamp-2"
            title={reason}
            data-testid="product-card-reason"
          >
            {reason}
          </p>
        )}
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="No me interesa"
        title="No me interesa"
        className="absolute top-2 right-2 text-xs text-gray-400 hover:text-red-600 bg-white/80 rounded px-1.5 py-0.5 leading-none"
      >
        ✕
      </button>
    </div>
  );
}
