export type MockProductSource = "amazon" | "aliexpress" | "shein" | "walmart";

export type MockCategory =
  | "ropa"
  | "electronica"
  | "hogar"
  | "juguetes_bebe"
  | "belleza"
  | "otros";

export interface MockProduct {
  id: string; // mock-internal stable ID
  source: MockProductSource;
  source_product_id: string;
  title: string;
  description: string;
  image_url: string;
  price_cents: number;
  brand: string;
  raw_category: string;
  attributes: Record<string, unknown>;
  url?: string | null; // URL original del producto en el marketplace (mock/LLM no la generan)
}

export const TARGET_DISTRIBUTION: Record<MockCategory, number> = {
  ropa: 0.40,
  electronica: 0.20,
  hogar: 0.15,
  juguetes_bebe: 0.10,
  belleza: 0.10,
  otros: 0.05,
};

export const FIXTURE_SIZE = 500;
