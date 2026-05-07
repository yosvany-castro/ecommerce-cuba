import { NextRequest, NextResponse } from "next/server";
import { searchLike } from "@/sectors/b-catalog/repository/products";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ products: [], count: 0 }, { status: 200 });
  const products = await searchLike({ query: q });
  return NextResponse.json({ products, count: products.length }, { status: 200 });
}
