import type { MockProduct } from "@/sectors/b-catalog/mock/types";

export interface CanonicalMetadataShape {
  category: string;
  subcategory: string | null;
  keywords: string[];
}

export function buildCanonicalText(
  raw: MockProduct,
  metadata: CanonicalMetadataShape,
): string {
  const categoryLine = metadata.subcategory
    ? `${metadata.category} ${metadata.subcategory}`
    : metadata.category;
  const parts = [
    raw.title,
    raw.description,
    categoryLine,
    metadata.keywords.join(" "),
  ].filter((s) => s && s.trim().length > 0);
  return parts.join("\n");
}
