"use client";
// /login — email+contraseña, Google (OAuth PKCE) y enlace al login por código.
// Client-side con el browser client de Supabase (escribe la sesión en cookies);
// el refresh server-side lo garantiza el proxy (updateSession/getClaims).
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthLink, Cta, Divider, Field, GoogleButton, errorEs } from "@/components/auth/AuthKit";

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = safeNext(params.get("returnTo"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) return setError("Escribe tu correo y contraseña.");
    setPending(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPending(false);
    if (err) return setError(errorEs(err.message));
    router.push(returnTo as never);
    router.refresh(); // que el server re-lea la sesión nueva
  };

  const google = async () => {
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}` },
    });
    if (err) return setError(errorEs(err.message));
    if (data?.url) location.assign(data.url);
  };

  return (
    <>
      <div style={{ fontFamily: "var(--font-brico)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px" }}>Entrar</div>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15.5, color: "#8E8F94", margin: "6px 0 22px" }}>
        qué bueno verte de vuelta
      </div>

      <Field label="Correo" type="email" value={email} onChange={setEmail} placeholder="tu@correo.com" autoComplete="email" testId="auth-email" />
      <Field label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="current-password" testId="auth-password" />
      <div style={{ textAlign: "right", fontSize: 12.5, marginTop: -6, marginBottom: 10 }}>
        <AuthLink onClick={() => router.push("/forgot-password")}>¿olvidaste tu contraseña?</AuthLink>
      </div>
      {error && <div style={{ fontSize: 12.5, color: "#B4533F", fontWeight: 600, marginBottom: 10 }}>✕ {error}</div>}
      <Cta label={pending ? "Entrando…" : "Entrar →"} onClick={submit} pending={pending} testId="auth-submit" />

      <Divider />
      <GoogleButton onClick={google} />
      <div
        onClick={() => router.push(`/otp?returnTo=${encodeURIComponent(returnTo)}` as never)}
        className="tk-hov-bd-dark"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 999, background: "#fff", border: "1px solid #ECECE7", fontSize: 14.5, fontWeight: 600, marginTop: 10, cursor: "pointer" }}
      >
        ✉ Entrar con un código (sin contraseña)
      </div>

      <div style={{ textAlign: "center", fontSize: 13, color: "#8E8F94", marginTop: 22 }}>
        ¿No tienes cuenta? <AuthLink onClick={() => router.push("/signup")}>Créala aquí</AuthLink>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
