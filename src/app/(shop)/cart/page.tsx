import { CartView } from "@/components/CartView";

export default function CartPage() {
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Tu carrito</h1>
      <CartView />
    </main>
  );
}
