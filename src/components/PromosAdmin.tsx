"use client";
// Admin de anuncios propios: form de creación + lista con pausar/activar/borrar.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATS } from "@/components/tuki/lib";

export interface PromoRow {
  id: string;
  surface: string;
  slot: number;
  status: string;
  title: string | null;
  n: number;
  category: string | null;
  created_at: string;
}

const SURFACE_LABELS: Record<string, string> = {
  search: "Listados (búsqueda y categorías)",
  home: "Inicio",
  pdp: "Página de producto",
  cart: "Carro",
};

export function PromosAdmin({ promos }: { promos: PromoRow[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [surfaces, setSurfaces] = useState<string[]>(["search"]);
  const [category, setCategory] = useState("");
  const [products, setProducts] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setMsg(null);
    const res = await fetch("/api/admin/promos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, surfaces, category: category || null, products }),
    });
    const b = (await res.json().catch(() => ({}))) as { error?: string; products?: number; skipped?: number };
    if (res.ok) {
      setTitle("");
      setProducts("");
      setMsg(`✓ anuncio creado con ${b.products} productos${b.skipped ? ` (${b.skipped} no existen o están inactivos)` : ""}`);
      router.refresh();
    } else {
      setMsg(
        b.error === "no_products"
          ? "no encontré productos válidos — pega links /products/… o IDs"
          : b.error === "no_free_slot"
            ? "esa superficie ya tiene 9 anuncios — pausa o borra alguno"
            : "revisa el título (2–60 letras) y elige al menos un lugar",
      );
    }
  };

  const setStatus = async (p: PromoRow, status: "approved" | "paused" | "archived") => {
    await fetch("/api/admin/promos", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: p.id, status }),
    });
    router.refresh();
  };

  const toggleSurface = (s: string) =>
    setSurfaces((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div>
      <div className="flex flex-col gap-3 border rounded-xl p-4 bg-white">
        <div>
          <div className="text-xs text-gray-500 mb-1">Título del anuncio</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ofertas de la semana" className="border rounded px-2 py-1 w-full" />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Dónde aparece</div>
          <div className="flex gap-3 flex-wrap text-sm">
            {Object.entries(SURFACE_LABELS).map(([id, label]) => (
              <label key={id} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={surfaces.includes(id)} onChange={() => toggleSurface(id)} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Solo en esta categoría (listados y producto)</div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded px-2 py-1">
            <option value="">todas</option>
            {Object.values(CATS).map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Productos — pega los links de la tienda (uno por línea), en el orden que quieres</div>
          <textarea
            value={products}
            onChange={(e) => setProducts(e.target.value)}
            rows={4}
            placeholder={"https://…/products/0b4aea27-31b2-4bf3-bbeb-242c512f84ab\nhttps://…/products/…"}
            className="border rounded px-2 py-1 w-full font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={create} className="bg-black text-white rounded px-4 py-1.5 text-sm font-semibold">
            crear anuncio
          </button>
          {msg && <span className={`text-sm ${msg.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>{msg}</span>}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {promos.length === 0 && <p className="text-gray-500 text-sm">sin anuncios todavía — crea el primero arriba</p>}
        {promos.map((p) => (
          <div key={p.id} className="flex items-center gap-4 border rounded-lg px-4 py-2 bg-white text-sm">
            <span className="font-bold flex-1 min-w-0 truncate">{p.title ?? "Destacado"}</span>
            <span className="text-gray-500">{SURFACE_LABELS[p.surface] ?? p.surface}</span>
            {p.category && <span className="text-gray-500">· {CATS[p.category]?.label ?? p.category}</span>}
            <span className="text-gray-500">{p.n} prod.</span>
            <span className={`text-xs font-semibold ${p.status === "approved" ? "text-green-700" : "text-gray-400"}`}>
              {p.status === "approved" ? "ACTIVO" : "pausado"}
            </span>
            <button onClick={() => setStatus(p, p.status === "approved" ? "paused" : "approved")} className="border rounded px-3 py-1 text-xs">
              {p.status === "approved" ? "pausar" : "activar"}
            </button>
            <button onClick={() => setStatus(p, "archived")} className="border rounded px-3 py-1 text-xs text-red-600">
              quitar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
