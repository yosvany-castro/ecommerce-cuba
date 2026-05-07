import Link from "next/link";

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const { order_id } = await searchParams;
  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">¡Compra simulada confirmada!</h1>
      {order_id && <p className="mb-4">Order ID: <code className="bg-gray-100 px-2 py-1 rounded">{order_id}</code></p>}
      <Link href={"/" as any} className="underline">Volver al catálogo</Link>
    </main>
  );
}
