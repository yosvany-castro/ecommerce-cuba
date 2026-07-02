"use client";

/**
 * Route-group error boundary (F4): before this, ANY uncaught error in a shop
 * page (one failed SELECT was enough) surfaced as a raw Next 500 — the whole
 * site "fell over" with the DB. The slate/feed paths degrade internally;
 * this boundary is the last net for the truly unexpected.
 */
export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[shop] render error:", error.digest ?? error.message);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">La tienda está tardando más de lo normal</h1>
      <p className="text-sm text-gray-600">
        Puede ser tu conexión o un problema momentáneo nuestro. Tus productos y tu
        carrito siguen ahí.
      </p>
      <button
        onClick={reset}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white"
      >
        Reintentar
      </button>
    </main>
  );
}
