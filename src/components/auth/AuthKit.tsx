"use client";
// src/components/auth/AuthKit.tsx — piezas compartidas de las páginas de auth
// (login/signup/forgot/otp), con la receta visual EXACTA del checkout Tuki:
// inputs 52px radius 14 con borde por estado (#C96A55 error), labels 12.5/600
// gris, CTA pill negro tk-hov-cta, título brico + subtítulo serif itálica.
import { useState } from "react";

export const inputBase: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 52,
  borderRadius: 14,
  background: "#fff",
  padding: "0 16px",
  fontSize: 15,
  fontFamily: "var(--font-sans)",
  color: "#1C1D20",
  outline: "none",
};

export function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  autoComplete,
  testId,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  autoComplete?: string;
  testId?: string;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        data-testid={testId}
        style={{
          ...inputBase,
          border: `1px solid ${error ? "#C96A55" : focus ? "#1C1D20" : "#ECECE7"}`,
          boxShadow: focus ? "0 0 0 3px rgba(28,29,32,.08)" : "none",
          transition: "border-color .18s ease, box-shadow .18s ease",
        }}
      />
      {error && <div style={{ fontSize: 12, color: "#B4533F", fontWeight: 600, marginTop: 5 }}>{error}</div>}
    </div>
  );
}

export function Cta({ label, onClick, pending, testId }: { label: string; onClick: () => void; pending?: boolean; testId?: string }) {
  return (
    <div
      onClick={() => {
        if (!pending) onClick();
      }}
      className={pending ? "" : "tk-hov-cta"}
      data-testid={testId}
      style={{
        marginTop: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 54,
        borderRadius: 999,
        background: "#1C1D20",
        color: "#fff",
        fontSize: 15,
        fontWeight: 700,
        cursor: pending ? "default" : "pointer",
        opacity: pending ? 0.6 : 1,
      }}
    >
      {label}
    </div>
  );
}

export function GoogleButton({ onClick, pending }: { onClick: () => void; pending?: boolean }) {
  return (
    <div
      onClick={() => {
        if (!pending) onClick();
      }}
      className="tk-hov-bd-dark"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        height: 52,
        borderRadius: 999,
        background: "#fff",
        border: "1px solid #ECECE7",
        fontSize: 14.5,
        fontWeight: 600,
        color: "#1C1D20",
        cursor: "pointer",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
      </svg>
      Continuar con Google
    </div>
  );
}

export function Divider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
      <div style={{ flex: 1, height: 1, background: "#ECECE7" }} />
      <span style={{ fontSize: 12, color: "#B0B1AE" }}>o</span>
      <div style={{ flex: 1, height: 1, background: "#ECECE7" }} />
    </div>
  );
}

export function AuthLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <span onClick={onClick} className="tk-hov-dark tk-hov-underline" style={{ color: "#55565B", fontWeight: 600, cursor: "pointer" }}>
      {children}
    </span>
  );
}

/** Errores de Supabase → español honesto (sin filtrar detalles internos). */
export function errorEs(message: string | undefined | null): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "Confirma tu correo primero — revisa tu bandeja de entrada.";
  if (m.includes("user already registered")) return "Ya existe una cuenta con ese correo. Inicia sesión.";
  if (m.includes("password should be at least")) return "La contraseña debe tener al menos 6 caracteres.";
  if (m.includes("rate limit") || m.includes("for security purposes")) return "Demasiados intentos — espera un minuto y prueba de nuevo.";
  if (m.includes("token has expired") || m.includes("otp_expired") || m.includes("invalid otp")) return "Código inválido o vencido. Pide uno nuevo.";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) return "Google aún no está configurado en el servidor.";
  if (m.includes("signups not allowed for otp")) return "No hay cuenta con ese correo. Crea una primero.";
  return "No se pudo completar. Intenta de nuevo.";
}
