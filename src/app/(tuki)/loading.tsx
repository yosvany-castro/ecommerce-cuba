// src/app/(tuki)/loading.tsx — skeleton INSTANTÁNEO de la home (y fallback del
// grupo): en 3G el usuario veía pantalla blanca todo el TTFB (queries del feed
// + RTT); esto streamea la estructura en el primer flush. Server component sin
// data, calcado del layout real de HomeFeed (greeting + chips + bandas de
// sección). Los chips de categoría son Links REALES: se puede navegar ANTES de
// que llegue el feed.
import Link from "next/link";
import { CATS } from "@/components/tuki/lib";

const SHIMMER = {
  background: "linear-gradient(90deg,#E9E9E4 25%,#DFDFD9 40%,#E9E9E4 55%)",
  backgroundSize: "460px 100%",
  animation: "shimmer 1.1s linear infinite",
} as const;

function Band({ tint }: { tint: string }) {
  return (
    <div style={{ borderRadius: "34px 34px 0 0", marginTop: "-14px", background: tint, padding: "30px 0 40px", position: "relative" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px" }}>
        <div style={{ width: 180, height: 16, borderRadius: 7, ...SHIMMER }} />
        <div style={{ width: 280, height: 26, borderRadius: 9, marginTop: 10, ...SHIMMER }} />
        <div style={{ display: "flex", gap: 16, marginTop: 18, overflow: "hidden" }}>
          {[1, 0.99, 0.99, 0.8, 0.6, 0.4].map((op, i) => (
            <div key={i} style={{ flex: "none", width: 198, height: 220, borderRadius: 20, opacity: op, ...SHIMMER }} />
          ))}
        </div>
        <div style={{ position: "absolute", top: 30, right: 28, fontSize: 12.5, color: "#8E8F94" }}>✦ preparando algo para ti…</div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "36px 28px 8px" }}>
        <div style={{ width: 280, height: 34, borderRadius: 9, ...SHIMMER }} />
        <div style={{ width: 180, height: 14, borderRadius: 7, marginTop: 10, ...SHIMMER }} />
        <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
          {Object.values(CATS).map((c) => (
            <Link
              key={c.id}
              href={`/c/${c.id}`}
              prefetch={false}
              className="tk-hov-chip"
              style={{ padding: "9px 18px", borderRadius: 999, background: "#fff", border: "1px solid #ECECE7", fontSize: 13.5, color: "#55565B", textDecoration: "none" }}
            >
              {c.label}
            </Link>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 26 }}>
        <Band tint={CATS.electronica.tint} />
        <Band tint={CATS.hogar.tint} />
      </div>
    </div>
  );
}
