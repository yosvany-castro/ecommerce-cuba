import { createHash } from "node:crypto";

export function canonicalize(rawQuery: string): string {
  return rawQuery
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function hashQuery(rawQuery: string): string {
  return createHash("sha256").update(canonicalize(rawQuery)).digest("hex");
}
