import Link from "next/link";

export interface ProductCardData {
  id: string;
  title: string;
  price_cents: number;
  image_url: string | null;
}

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link
      href={`/products/${product.id}` as any}
      className="block border rounded-lg p-4 hover:shadow"
      data-testid="product-card"
    >
      {product.image_url ? (
        <img src={product.image_url} alt={product.title} className="w-full h-40 object-cover mb-2 rounded" />
      ) : (
        <div className="w-full h-40 bg-gray-100 rounded mb-2" />
      )}
      <h2 className="font-semibold text-sm line-clamp-2">{product.title}</h2>
      <p className="text-sm text-gray-500 mt-1">${(product.price_cents / 100).toFixed(2)}</p>
    </Link>
  );
}
