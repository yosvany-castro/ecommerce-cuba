import { listByDate } from "@/sectors/b-catalog/repository/products";

export const dynamic = "force-dynamic";

function ProductCard({ id, image_url, title, price_cents }: { id: string; image_url: string | null; title: string; price_cents: number }) {
  return (
    <a href={`/products/${id}`} className="block border rounded-lg p-4 hover:shadow">
      {image_url ? (
        <img src={image_url} alt={title} className="w-full h-40 object-cover mb-2 rounded" />
      ) : (
        <div className="w-full h-40 bg-gray-100 rounded mb-2" />
      )}
      <h2 className="font-semibold text-sm line-clamp-2">{title}</h2>
      <p className="text-sm text-gray-500 mt-1">${(price_cents / 100).toFixed(2)}</p>
    </a>
  );
}

export default async function HomePage() {
  const products = await listByDate({ limit: 20 });

  if (products.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold mb-4">Catálogo</h1>
        <p className="text-gray-600">
          No hay productos todavía. En desarrollo, ejecuta:
          <code className="bg-gray-100 ml-2 px-2 py-1 rounded">pnpm cron:catalog-fill --pages 1</code>
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Catálogo</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} id={p.id} image_url={p.image_url} title={p.title} price_cents={p.price_cents} />
        ))}
      </div>
    </main>
  );
}
