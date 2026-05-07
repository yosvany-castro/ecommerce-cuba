import { z } from "zod";

export const PROMPT_VERSION = "v1.0.0-fase1";

export const SYSTEM_PROMPT = `Eres un normalizador de productos de e-commerce. Recibes un producto crudo (título, descripción, raw_category, marca y atributos) y devuelves JSON estructurado en español.

Campos obligatorios:
- category: una de [ropa, electronica, hogar, juguetes_bebe, belleza, otros]
- subcategory: string libre, específica (puede ser null si no se infiere)
- gender_target: 'femenino' | 'masculino' | 'unisex' | null
- age_target: { min: number|null, max: number|null }
- occasion: array de strings (ej: ['regalo','diario','formal'])
- style: array de strings (ej: ['casual','elegante'])
- keywords: array de hasta 8 keywords relevantes en español
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
  enrichment_status: z.literal("ok"),
});

export type NormalizedFromLLM = z.infer<typeof normalizedSchema>;
