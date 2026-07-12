// Layout del grupo (auth): versión mínima del shell Tuki — solo el logo como
// vuelta a casa y la card centrada sobre el fondo de marca. Sin nav ni carrito:
// en el login la única tarea es entrar.
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF8", color: "#1C1D20", fontFamily: "var(--font-sans)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 28px" }}>
        <Link
          href="/"
          className="tk-hov-dark"
          style={{ fontFamily: "var(--font-brico)", fontSize: 25, fontWeight: 700, letterSpacing: "-0.6px", color: "#1C1D20", textDecoration: "none" }}
        >
          tuki
        </Link>
      </div>
      <main style={{ display: "flex", justifyContent: "center", padding: "30px 20px 90px" }}>
        <div
          style={{
            width: "100%",
            maxWidth: 430,
            background: "#fff",
            border: "1px solid #EFEFEA",
            borderRadius: 24,
            boxShadow: "0 14px 30px rgba(28,29,32,0.09)",
            padding: "34px 30px 30px",
            animation: "screenIn .3s ease both",
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
