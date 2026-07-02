import { describe, it, expect } from "vitest";
import { isAdminEmail } from "@/lib/auth";

describe("isAdminEmail (F3 admin gate)", () => {
  it("fail-closed: empty or unset allowlist means NOBODY is admin", () => {
    expect(isAdminEmail("a@b.com", undefined)).toBe(false);
    expect(isAdminEmail("a@b.com", "")).toBe(false);
    expect(isAdminEmail("a@b.com", " , ,")).toBe(false);
  });

  it("matches case-insensitively and trims entries", () => {
    const list = " Admin@Tienda.cu , otro@x.com ";
    expect(isAdminEmail("admin@tienda.cu", list)).toBe(true);
    expect(isAdminEmail("ADMIN@TIENDA.CU ", list)).toBe(true);
    expect(isAdminEmail("otro@x.com", list)).toBe(true);
  });

  it("rejects non-listed and missing emails", () => {
    expect(isAdminEmail("intruso@x.com", "admin@tienda.cu")).toBe(false);
    expect(isAdminEmail(null, "admin@tienda.cu")).toBe(false);
    expect(isAdminEmail(undefined, "admin@tienda.cu")).toBe(false);
  });
});
