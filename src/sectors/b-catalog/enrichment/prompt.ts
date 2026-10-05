import { z } from "zod";

export const PROMPT_VERSION = "v1.1.0-es";

export const SYSTEM_PROMPT = `Eres un normalizador de productos de e-commerce. Recibes un producto crudo (título, descripción, raw_category, marca y atributos) y devuelves JSON estructurado en español.

Campos obligatorios:
- category: una de [ropa, electronica, hogar, juguetes_bebe, belleza, otros]
- subcategory: string libre, específica (puede ser null si no se infiere)
- gender_target: 'femenino' | 'masculino' | 'unisex' | null
- age_target: { min: number|null, max: number|null }
- occasion: array de strings (ej: ['regalo','diario','formal'])
- style: array de strings (ej: ['casual','elegante'])
- keywords: array de hasta 8 keywords relevantes en español
- title_es: el título traducido a español natural (como lo escribiría una tienda en español), máximo 90 caracteres; conserva marca, modelo y medidas; sin relleno SEO ni años repetidos
- description_es: la descripción traducida a español, resumida a lo esencial, máximo 500 caracteres; null si no hay descripción
- enrichment_status: siempre 'ok'

Si no puedes inferir un campo, usa null o array vacío. Devuelve SOLO el JSON, sin markdown ni texto adicional.`;

export const normalizedSchema = z.object({
  category: z.enum(["ropa", "electronica", "hogar", "juguetes_bebe", "belleza", "otros"]),
  subcategory: z.string().nullable(),
  gender_target: z.enum(["femenino", "masculino", "unisex"]).nullable(),
  age_target: z.object({
    min: z.number().int().nullable(),
    max: z.number().int().nullable(),
  }),
  occasion: z.array(z.string()),
  style: z.array(z.string()),
  keywords: z.array(z.string()).max(8),
  // opcionales: un modelo que no los devuelva no tumba la normalización
  // (el producto queda con el texto original — mejor que en "otros").
  title_es: z.string().min(2).max(160).optional(),
  description_es: z.string().max(1500).nullable().optional(),
  enrichment_status: z.literal("ok"),
});

export type NormalizedFromLLM = z.infer<typeof normalizedSchema>;
