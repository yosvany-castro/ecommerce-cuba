"use client";
// /signup — crear cuenta con email+contraseña (o Google). Si el proyecto tiene
// confirmación de email activada, signUp no devuelve sesión: se muestra el
// estado "revisa tu correo" (el link del email pasa por /auth/callback o
// /auth/confirm y deja la sesión en cookies).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthLink, Cta, Divider, Field, GoogleButton, errorEs } from "@/components/auth/AuthKit";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim()) return setError("Escribe tu correo.");
    if (password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    setPending(true);
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: name.trim() ? { full_name: name.trim() } : undefined,
        emailRedirectTo: `${location.origin}/auth/callback?next=/`,
      },
    });
    setPending(false);
    if (err) return setError(errorEs(err.message));
    if (data.session) {
      // confirmación de email desactivada: sesión inmediata
      router.push("/");
      router.refresh();
      return;
    }
    setSent(true);
  };

  const google = async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=/` },
    });
    if (err) return setError(errorEs(err.message));
    if (data?.url) location.assign(data.url);
  };

  if (sent) {
    return (
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <div style={{ width: 74, height: 74, borderRadius: "50%", background: "#EAF2EA", color: "#557A55", fontSize: 30, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", animation: "checkPop .5s cubic-bezier(.2,.8,.2,1) both" }}>✉</div>
        <div style={{ fontFamily: "var(--font-brico)", fontSize: 22, fontWeight: 700, marginTop: 18 }}>Revisa tu correo</div>
        <div style={{ fontSize: 14, color: "#55565B", marginTop: 8, lineHeight: 1.6 }}>
          Te mandamos un enlace a <b>{email.trim()}</b> para confirmar tu cuenta. Ábrelo y quedas dentro.
        </div>
        <div style={{ fontSize: 12.5, color: "#8E8F94", marginTop: 16 }}>
          ¿No llegó? Mira en spam, o <AuthLink onClick={() => setSent(false)}>intenta de nuevo</AuthLink>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ fontFamily: "var(--font-brico)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px" }}>Crear cuenta</div>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15.5, color: "#8E8F94", margin: "6px 0 22px" }}>
        dos campos y ya estás dentro
      </div>

      <Field label="Nombre (opcional)" value={name} onChange={setName} placeholder="¿Cómo te llamamos?" autoComplete="name" />
      <Field label="Correo" type="email" value={email} onChange={setEmail} placeholder="tu@correo.com" autoComplete="email" testId="auth-email" />
      <Field label="Contraseña" type="password" value={password} onChange={setPassword} placeholder="mínimo 6 caracteres" autoComplete="new-password" testId="auth-password" />
      {error && <div style={{ fontSize: 12.5, color: "#B4533F", fontWeight: 600, marginBottom: 10 }}>✕ {error}</div>}
      <Cta label={pending ? "Creando…" : "Crear cuenta →"} onClick={submit} pending={pending} testId="auth-submit" />

      <Divider />
      <GoogleButton onClick={google} />

      <div style={{ textAlign: "center", fontSize: 13, color: "#8E8F94", marginTop: 22 }}>
        ¿Ya tienes cuenta? <AuthLink onClick={() => router.push("/login")}>Entra aquí</AuthLink>
      </div>
    </>
  );
}
