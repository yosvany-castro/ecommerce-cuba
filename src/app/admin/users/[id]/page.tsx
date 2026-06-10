import { redirect } from "next/navigation";
import { auth0, requireAdmin } from "@/lib/auth";
import { withPg } from "@/lib/db/helpers";
import { getUserDebugInfo } from "@/sectors/d-personalization/admin/user-debug";
import { UserDebugView } from "@/components/UserDebugView";

export const dynamic = "force-dynamic";

export default async function UserDebugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth0.getSession().catch(() => null);
  if (!session?.user?.sub) redirect("/auth/login?returnTo=/admin/users");
  if (!(await requireAdmin())) redirect("/");

  const { id } = await params;
  const info = await withPg((pg) => getUserDebugInfo(id, pg));
  if (!info) {
    return (
      <main className="p-8">
        <p>Usuario no encontrado</p>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Debug usuario</h1>
      <UserDebugView info={info} />
    </main>
  );
}
