"use client";

interface NormalizedShape {
  intent?: string;
  recipient_gender?: string | null;
  recipient_age_min?: number | null;
  recipient_age_max?: number | null;
  categories?: string[];
  style?: string[];
  price_range?: string | null;
  search_terms?: string;
  confidence?: number;
}

export function SearchUnderstood({
  normalized,
  method,
  hitCache,
  calledMock,
}: {
  normalized: NormalizedShape | null;
  method: string;
  hitCache: boolean;
  calledMock: boolean;
}) {
  if (!normalized) return null;
  const chips: string[] = [];
  if (normalized.intent) chips.push(`Intención: ${normalized.intent}`);
  if (normalized.recipient_gender) chips.push(`Para: ${normalized.recipient_gender}`);
  if (
    normalized.recipient_age_min !== null &&
    normalized.recipient_age_max !== null &&
    normalized.recipient_age_min !== undefined
  ) {
    chips.push(`Edad: ${normalized.recipient_age_min}-${normalized.recipient_age_max}`);
  }
  if (normalized.categories?.length) chips.push(`Categorías: ${normalized.categories.join(", ")}`);
  if (normalized.style?.length) chips.push(`Estilo: ${normalized.style.join(", ")}`);
  if (normalized.price_range) chips.push(`Precio: ${normalized.price_range}`);

  return (
    <div className="mb-4 flex flex-wrap gap-2 items-center text-xs">
      {chips.map((c) => (
        <span key={c} className="bg-gray-100 px-2 py-1 rounded">
          {c}
        </span>
      ))}
      <span className="text-gray-500 ml-auto">
        {method} {hitCache && "· cache"} {calledMock && "· externo"}
      </span>
    </div>
  );
}
