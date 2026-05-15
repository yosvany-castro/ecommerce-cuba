import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth";
import { CheckoutForm } from "@/components/CheckoutForm";

export default async function CheckoutPage() {
  const session = await auth0.getSession().catch(() => null);
  if (!session?.user?.sub) redirect("/auth/login?returnTo=/checkout" as any);
  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Checkout simulado</h1>
      <CheckoutForm />
    </main>
  );
}
