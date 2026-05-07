import { z } from "zod";

export const PROMPT_VERSION = "v1.0.0-fase2";

export const SYSTEM_PROMPT = `Eres un normalizador de queries de búsqueda en e-commerce. Recibes la consulta cruda del usuario y devuelves JSON estructurado en español.

Campos:
- intent: 'compra'|'regalo'|'exploracion'|'comparacion'
- recipient_gender: 'femenino'|'masculino'|'unisex'|null
- recipient_age_min: integer|null
- recipient_age_max: integer|null
- categories: array de strings (preferencia: una de [ropa, electronica, hogar, juguetes_bebe, belleza, otros], pero subcategorías como "ropa_niña" están permitidas)
- style: array de strings (descriptores subjetivos: bonito, elegante, deportivo, etc.)
- price_range: 'bajo'|'medio'|'alto'|null
- search_terms: string — keywords core para BM25 (sin stop-words, en orden lógico, sin acentos)
- confidence: number entre 0 y 1

Reglas:
- Query ambigua o basura ('asdfgh', strings sin sentido, caracteres aleatorios sin significado) → confidence debe ser 0.1 o menor
- search_terms debe ser concreto y útil para búsqueda full-text
- Sin invención: si no puedes inferir un campo, usa null o array vacío

Devuelve SOLO el JSON, sin markdown ni texto adicional.`;

export const normalizedQuerySchema = z.object({
  intent: z.enum(["compra", "regalo", "exploracion", "comparacion"]),
  recipient_gender: z.enum(["femenino", "masculino", "unisex"]).nullable(),
  recipient_age_min: z.number().int().min(0).max(130).nullable(),
  recipient_age_max: z.number().int().min(0).max(130).nullable(),
  categories: z.array(z.string()),
  style: z.array(z.string()),
  price_range: z.enum(["bajo", "medio", "alto"]).nullable(),
  search_terms: z.string(),
  confidence: z.number().min(0).max(1),
});

export type NormalizedQuery = z.infer<typeof normalizedQuerySchema>;
