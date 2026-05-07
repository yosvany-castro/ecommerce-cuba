import { notFound } from "next/navigation";
import { getById } from "@/sectors/b-catalog/repository/products";
import { ProductTracker } from "@/components/ProductTracker";
import { AddToCartButton } from "@/components/AddToCartButton";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getById(id);
  if (!product) return notFound();

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <ProductTracker productId={product.id} />
      <div className="grid md:grid-cols-2 gap-6">
        {product.image_url ? (
          <img src={product.image_url} alt={product.title} className="w-full rounded" />
        ) : (
          <div className="w-full h-80 bg-gray-100 rounded" />
        )}
        <div>
          <h1 className="text-2xl font-bold mb-2">{product.title}</h1>
          <p className="text-xl text-gray-700 mb-4">${(product.price_cents / 100).toFixed(2)}</p>
          <p className="text-gray-600 mb-6">{product.description}</p>
          <AddToCartButton productId={product.id} />
        </div>
      </div>
    </main>
  );
}
