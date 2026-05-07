import { auth0 } from "@/lib/auth";
import { CartProvider } from "@/components/CartProvider";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const session = await auth0.getSession().catch(() => null);
  const isLoggedIn = !!session?.user?.sub;
  return (
    <div className="min-h-screen">
      <CartProvider isLoggedIn={isLoggedIn}>{children}</CartProvider>
    </div>
  );
}
