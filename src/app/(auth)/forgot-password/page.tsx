"use client";
// /forgot-password — pide el enlace de recuperación. El link del email pasa
// por /auth/callback (code exchange) o /auth/confirm (token_hash, si la
// plantilla se editó) y aterriza YA autenticado en /reset-password.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthLink, Cta, Field, errorEs } from "@/components/auth/AuthKit";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim()) return setError("Escribe tu correo.");
    setPending(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${location.origin}/auth/callback?next=/reset-password`,
    });
    setPending(false);
    if (err) return setError(errorEs(err.message));
    setSent(true);
  };

  if (sent) {
    return (
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <div style={{ width: 74, height: 74, borderRadius: "50%", background: "#EAF2EA", color: "#557A55", fontSize: 30, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", animation: "checkPop .5s cubic-bezier(.2,.8,.2,1) both" }}>✉</div>
        <div style={{ fontFamily: "var(--font-brico)", fontSize: 22, fontWeight: 700, marginTop: 18 }}>Revisa tu correo</div>
        <div style={{ fontSize: 14, color: "#55565B", marginTop: 8, lineHeight: 1.6 }}>
          Si existe una cuenta con <b>{email.trim()}</b>, te llegó un enlace para cambiar la contraseña.
        </div>
        <div style={{ fontSize: 12.5, color: "#8E8F94", marginTop: 16 }}>
          <AuthLink onClick={() => router.push("/login")}>← volver al login</AuthLink>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ fontFamily: "var(--font-brico)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px" }}>Recuperar contraseña</div>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15.5, color: "#8E8F94", margin: "6px 0 22px" }}>
        te mandamos un enlace y eliges una nueva
      </div>
      <Field label="Correo" type="email" value={email} onChange={setEmail} placeholder="tu@correo.com" autoComplete="email" testId="auth-email" />
      {error && <div style={{ fontSize: 12.5, color: "#B4533F", fontWeight: 600, marginBottom: 10 }}>✕ {error}</div>}
      <Cta label={pending ? "Enviando…" : "Enviar enlace →"} onClick={submit} pending={pending} testId="auth-submit" />
      <div style={{ textAlign: "center", fontSize: 13, color: "#8E8F94", marginTop: 22 }}>
        <AuthLink onClick={() => router.push("/login")}>← volver al login</AuthLink>
      </div>
    </>
  );
}
