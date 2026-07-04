"use client";

/**
 * Route-group error boundary (F4, heredado de (shop) en T12): antes de esto,
 * ANY uncaught error en una página Tuki (un SELECT fallido bastaba) salía como
 * un Next 500 crudo — todo el sitio "se caía" con la DB. Los paths de
 * slate/feed degradan internamente; esta frontera es la última red para lo
 * verdaderamente inesperado.
 */
export default function TukiError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[tuki] render error:", error.digest ?? error.message);
  return (
    <main
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        maxWidth: 420,
        margin: "0 auto",
        padding: "2rem",
        textAlign: "center",
        background: "#FAFAF8",
        fontFamily: "var(--font-sans)",
      }}
    >
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
        La tienda está tardando más de lo normal
      </h1>
      <p style={{ fontSize: "0.875rem", color: "#6B6B6B" }}>
        Puede ser tu conexión o un problema momentáneo nuestro. Tus productos y tu
        carrito siguen ahí.
      </p>
      <button
        onClick={reset}
        style={{
          borderRadius: 9999,
          background: "#1C1D20",
          color: "#FAFAF8",
          padding: "0.5rem 1.25rem",
          fontSize: "0.875rem",
          fontWeight: 500,
          border: "none",
          cursor: "pointer",
        }}
      >
        Reintentar
      </button>
    </main>
  );
}
