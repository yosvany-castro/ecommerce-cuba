"use client";
// Admin de cupones: form de creación + lista con toggle activo/inactivo.
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CouponRow {
  code: string;
  pct: number;
  starts_at: string;
  ends_at: string | null;
  max_uses: number | null;
  uses: number;
  active: boolean;
}

export function CuponesAdmin({ coupons }: { coupons: CouponRow[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pct, setPct] = useState("10");
  const [maxUses, setMaxUses] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setMsg(null);
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: code.trim().toUpperCase(),
        pct: parseInt(pct, 10),
        ...(maxUses.trim() ? { max_uses: parseInt(maxUses, 10) } : {}),
      }),
    });
    if (res.ok) {
      setCode("");
      setMaxUses("");
      router.refresh();
    } else {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(b.error === "duplicate_or_invalid" ? "ese código ya existe o es inválido" : "no se pudo crear");
    }
  };

  const toggle = async (c: CouponRow) => {
    await fetch("/api/admin/coupons", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: c.code, active: !c.active }),
    });
    router.refresh();
  };

  return (
    <div>
      <div className="flex gap-2 items-end flex-wrap border rounded-xl p-4 bg-white">
        <div>
          <div className="text-xs text-gray-500 mb-1">Código</div>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="HOLA10" className="border rounded px-2 py-1 font-mono w-36" />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">% desc.</div>
          <input value={pct} onChange={(e) => setPct(e.target.value.replace(/\D/g, ""))} className="border rounded px-2 py-1 w-16 font-mono" />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Usos máx. (vacío = ∞)</div>
          <input value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} className="border rounded px-2 py-1 w-24 font-mono" />
        </div>
        <button onClick={create} className="bg-black text-white rounded px-4 py-1.5 text-sm font-semibold">
          crear cupón
        </button>
        {msg && <span className="text-sm text-red-600">{msg}</span>}
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {coupons.length === 0 && <p className="text-gray-500 text-sm">sin cupones todavía — crea el primero arriba</p>}
        {coupons.map((c) => (
          <div key={c.code} className="flex items-center gap-4 border rounded-lg px-4 py-2 bg-white text-sm">
            <span className="font-mono font-bold w-28">{c.code}</span>
            <span>−{c.pct}%</span>
            <span className="text-gray-500">
              usos: {c.uses}
              {c.max_uses != null ? `/${c.max_uses}` : ""}
            </span>
            <span className={`ml-auto text-xs font-semibold ${c.active ? "text-green-700" : "text-gray-400"}`}>
              {c.active ? "ACTIVO" : "inactivo"}
            </span>
            <button onClick={() => toggle(c)} className="border rounded px-3 py-1 text-xs">
              {c.active ? "desactivar" : "activar"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
