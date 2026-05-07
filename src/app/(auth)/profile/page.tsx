import { auth0 } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Route } from "next";

export default async function ProfilePage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login" as Route);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Perfil</h1>
      <p className="mt-2">Hola, {session.user.name ?? session.user.email}</p>
      <a href="/auth/logout" className="mt-4 underline">Cerrar sesión</a>
    </main>
  );
}
