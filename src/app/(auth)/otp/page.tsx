"use client";
// /otp — login SIN contraseña con código de un solo uso por email, en 2 pasos:
// (1) correo → signInWithOtp manda el código; (2) código de 6 dígitos →
// verifyOtp deja la sesión en cookies. Nota de dashboard: la plantilla "Magic
// Link" debe incluir {{ .Token }} para que el email traiga el CÓDIGO (si no,
// llega un enlace mágico — que también funciona, vía /auth/callback).
// Rate limit de Supabase: 1 envío por minuto — el botón de reenviar lo respeta.
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthLink, Cta, Field, errorEs, inputBase } from "@/components/auth/AuthKit";

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

function OtpInner() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = safeNext(params.get("returnTo"));
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    setError(null);
    if (!email.trim()) return setError("Escribe tu correo.");
    setPending(true);
    const supabase = createClient();
    // shouldCreateUser: true — el código también sirve para crear la cuenta
    // (login sin contraseña estilo "SSO con un OTP").
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setPending(false);
    if (err) return setError(errorEs(err.message));
    setStep(2);
    setCooldown(60);
    setTimeout(() => codeRef.current?.focus(), 50);
  };

  const verify = async () => {
    setError(null);
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) return setError("El código tiene 6 dígitos.");
    setPending(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    setPending(false);
    if (err) return setError(errorEs(err.message));
    router.push(returnTo as never);
    router.refresh();
  };

  // Barra de pasos (misma receta del checkout: hecha #1C1D20, pendiente #E7E7E2)
  const steps = (
    <div style={{ display: "flex", gap: 8, margin: "18px 0 22px" }}>
      {[1, 2].map((s) => (
        <div key={s} style={{ flex: 1 }}>
          <div style={{ height: 5, borderRadius: 999, background: step >= s ? "#1C1D20" : "#E7E7E2", transition: "background .3s" }} />
          <div style={{ fontSize: 12, fontWeight: step === s ? 700 : 500, color: step === s ? "#1C1D20" : "#B0B1AE", marginTop: 6 }}>
            {s === 1 ? "tu correo" : "el código"}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div style={{ fontFamily: "var(--font-brico)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px" }}>Entrar con código</div>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15.5, color: "#8E8F94", marginTop: 6 }}>
        sin contraseña — te mandamos un código al correo
      </div>
      {steps}

      {step === 1 ? (
        <>
          <Field label="Correo" type="email" value={email} onChange={setEmail} placeholder="tu@correo.com" autoComplete="email" testId="auth-email" />
          {error && <div style={{ fontSize: 12.5, color: "#B4533F", fontWeight: 600, marginBottom: 10 }}>✕ {error}</div>}
          <Cta label={pending ? "Enviando…" : "Enviarme el código →"} onClick={send} pending={pending} testId="auth-submit" />
        </>
      ) : (
        <>
          <div style={{ fontSize: 13.5, color: "#55565B", marginBottom: 14 }}>
            Enviado a <b>{email.trim()}</b> · <AuthLink onClick={() => { setStep(1); setCode(""); setError(null); }}>cambiar</AuthLink>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>Código de 6 dígitos</div>
          <input
            ref={codeRef}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            data-testid="auth-otp-code"
            style={{
              ...inputBase,
              height: 62,
              fontFamily: "var(--font-mono)",
              fontSize: 26,
              letterSpacing: 12,
              textAlign: "center",
              border: `1px solid ${error ? "#C96A55" : "#ECECE7"}`,
            }}
          />
          {error && <div style={{ fontSize: 12.5, color: "#B4533F", fontWeight: 600, marginTop: 10 }}>✕ {error}</div>}
          <div style={{ marginTop: 14 }}>
            <Cta label={pending ? "Verificando…" : "Entrar →"} onClick={verify} pending={pending} testId="auth-submit" />
          </div>
          <div style={{ textAlign: "center", fontSize: 12.5, color: "#8E8F94", marginTop: 14 }}>
            {cooldown > 0 ? (
              <>puedes reenviar en {cooldown}s</>
            ) : (
              <AuthLink onClick={send}>reenviar código</AuthLink>
            )}
          </div>
        </>
      )}

      <div style={{ textAlign: "center", fontSize: 13, color: "#8E8F94", marginTop: 22 }}>
        <AuthLink onClick={() => router.push("/login")}>← volver al login</AuthLink>
      </div>
    </>
  );
}

export default function OtpPage() {
  return (
    <Suspense fallback={null}>
      <OtpInner />
    </Suspense>
  );
}
