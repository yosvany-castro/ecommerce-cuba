import { z } from "zod";
import { randomUUID } from "node:crypto";
import { defaultProvider } from "@/lib/llm/providers";
import { stripMarkdownWrapper } from "@/sectors/b-catalog/enrichment/normalizer";
import type { MockProduct, MockCategory } from "./types";

export const SYSTEM_PROMPT = `Eres un simulador de la API de Amazon/AliExpress/Shein para una tienda reseller en Cuba. Recibes una query de búsqueda + categoría y generas N productos sintéticos que un agregador real devolvería para esa búsqueda.

Reglas:
- Si la query menciona MARCA (Nike, Apple, Sony, Samsung, Adidas, etc.), al menos 60% de productos son de esa marca con variantes razonables.
- Si menciona MODELO ESPECÍFICO (Air Max 270, iPhone 15 Pro), incluye variantes (colores, tallas, capacidades).
- Si menciona ATRIBUTOS (color, talla, edad, género), respétalos en mayoría de productos.
- Mezcla productos exactos + variantes + accesorios complementarios (ej: query "iPhone 15" → algunos iPhones + fundas + cargadores).
- raw_category: una de [ropa, electronica, hogar, juguetes_bebe, belleza, otros].
- source: ~40% amazon, ~30% aliexpress, ~30% shein.
- price_cents: realista para la categoría (electrónica $5000-$200000, ropa $500-$20000, etc.).
- title: corto y descriptivo (max 80 chars).
- description: 2-3 frases (max 200 chars).
- image_url: "https://placehold.co/400x400.png".
- attributes: objeto con propiedades específicas (color, size, material, capacity, age_target, etc.).

Devuelve SOLO un objeto JSON con shape: { "products": [...] } donde "products" es un array de N productos. Sin markdown wrap, sin texto adicional.`;

const productSchema = z.object({
  source: z.enum(["amazon", "aliexpress", "shein"]),
  source_product_id: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(600).optional().default(""),
  image_url: z.string().optional().default("https://placehold.co/400x400.png"),
  price_cents: z.number().int().min(0).max(9999999),
  brand: z.string().max(120).optional().default(""),
  raw_category: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});

const responseSchema = z.object({
  products: z.array(productSchema).min(1).max(50),
});

function makeSourceProductId(title: string, source: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${source}-${slug}-${rand}`;
}

export interface GenerateOpts {
  query: string;
  category?: MockCategory;
  limit: number;
}

export async function generateProductsWithLLM(opts: GenerateOpts): Promise<MockProduct[]> {
  const userMsg = JSON.stringify({
    query: opts.query,
    category: opts.category ?? "any",
    limit: opts.limit,
  });
  const res = await defaultProvider.chat({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: Math.min(4000, 200 * opts.limit),
    temperature: 0.7,
    jsonMode: true,
    cacheSystem: false,
  });
  const text = stripMarkdownWrapper(res.text);
  const parsed = JSON.parse(text);
  const valid = responseSchema.parse(parsed);
  return valid.products.slice(0, opts.limit).map((p) => ({
    id: randomUUID(),
    source: p.source,
    source_product_id: p.source_product_id ?? makeSourceProductId(p.title, p.source),
    title: p.title,
    description: p.description,
    image_url: p.image_url || "https://placehold.co/400x400.png",
    price_cents: p.price_cents,
    brand: p.brand,
    raw_category: p.raw_category,
    attributes: p.attributes,
  }));
}
