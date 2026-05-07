import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  return auth0.middleware(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/cron).*)"],
};
