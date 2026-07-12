"use client";
// /reset-password — el usuario llega YA autenticado desde el enlace del email
// (via /auth/callback o /auth/confirm con type=recovery); solo fija la nueva
// contraseña con updateUser. Sin sesión: mensaje honesto con la salida.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthLink, Cta, Field, errorEs } from "@/components/auth/AuthKit";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setHasSession(!!data.user));
  }, []);

  const submit = async () => {
    setError(null);
    if (password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setPending(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    setPending(false);
    if (err) return setError(errorEs(err.message));
    router.push("/");
    router.refresh();
  };

  if (hasSession === false) {
    return (
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <div style={{ fontFamily: "var(--font-brico)", fontSize: 22, fontWeight: 700 }}>El enlace venció</div>
        <div style={{ fontSize: 14, color: "#55565B", marginTop: 8, lineHeight: 1.6 }}>
          Pide uno nuevo y vuelve a intentarlo.
        </div>
        <div style={{ fontSize: 13, marginTop: 16 }}>
          <AuthLink onClick={() => router.push("/forgot-password")}>pedir enlace nuevo →</AuthLink>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ fontFamily: "var(--font-brico)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px" }}>Nueva contraseña</div>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15.5, color: "#8E8F94", margin: "6px 0 22px" }}>
        elige una y quedas dentro
      </div>
      <Field label="Nueva contraseña" type="password" value={password} onChange={setPassword} placeholder="mínimo 6 caracteres" autoComplete="new-password" testId="auth-password" />
      <Field label="Repítela" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      {error && <div style={{ fontSize: 12.5, color: "#B4533F", fontWeight: 600, marginBottom: 10 }}>✕ {error}</div>}
      <Cta label={pending ? "Guardando…" : "Guardar y entrar →"} onClick={submit} pending={pending} testId="auth-submit" />
    </>
  );
}
