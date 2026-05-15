export function SearchSkeleton({ query }: { query: string }) {
  return (
    <div className="mt-4">
      <p className="text-sm text-gray-600">Buscando &quot;{query}&quot;…</p>
      <p className="text-xs text-gray-400 mt-1">
        Si tu búsqueda es muy específica, podemos consultar nuestro proveedor externo (puede tomar 2-4 segundos).
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-4 animate-pulse" data-testid="search-skeleton-card">
            <div className="w-full h-40 bg-gray-200 rounded mb-2" />
            <div className="h-4 bg-gray-200 rounded mb-1" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
