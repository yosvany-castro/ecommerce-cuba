import { redirect } from "next/navigation";
import type { Route } from "next";
import { getAuthUser } from "@/lib/auth";

export default async function ProfilePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login?returnTo=/profile" as Route);

  const display = user.name ?? user.email ?? "tu cuenta";
  const initial = (display[0] ?? "T").toUpperCase();

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ width: 74, height: 74, borderRadius: "50%", background: "#1C1D20", color: "#fff", fontSize: 30, fontWeight: 700, fontFamily: "var(--font-brico)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
        {initial}
      </div>
      <div style={{ fontFamily: "var(--font-brico)", fontSize: 24, fontWeight: 700, marginTop: 16 }}>{user.name ?? "Tu perfil"}</div>
      {user.email && <div style={{ fontSize: 13.5, color: "#8E8F94", marginTop: 4 }}>{user.email}</div>}
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14, color: "#8E8F94", marginTop: 14 }}>
        ✦ tu historial y tu carrito te siguen a donde entres
      </div>
      <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
        <button
          type="submit"
          className="tk-hov-bd-dark"
          style={{ width: "100%", height: 52, borderRadius: 999, background: "#fff", border: "1px solid #ECECE7", fontSize: 14.5, fontWeight: 600, color: "#B4533F", cursor: "pointer", fontFamily: "var(--font-sans)" }}
        >
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}
