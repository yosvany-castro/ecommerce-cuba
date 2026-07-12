// Skeleton instantáneo de la PDP: misma estructura (breadcrumb, galería 3:4,
// columna de info) que ProductView, visible en el primer flush mientras el
// server espera getById + secciones en 3G.
import { CATS, stripe } from "@/components/tuki/lib";

const SHIMMER = {
  background: "linear-gradient(90deg,#E9E9E4 25%,#DFDFD9 40%,#E9E9E4 55%)",
  backgroundSize: "460px 100%",
  animation: "shimmer 1.1s linear infinite",
} as const;

export default function Loading() {
  return (
    <div style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 28px 90px" }}>
      <div style={{ width: 200, height: 13, borderRadius: 6, ...SHIMMER }} />
      <div style={{ display: "grid", gridTemplateColumns: "480px 1fr", gap: 48, marginTop: 20, alignItems: "start" }}>
        <div>
          <div style={{ aspectRatio: "3 / 4", maxHeight: 620, borderRadius: 26, background: stripe(CATS.otros) }} />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            {[1, 0.7, 0.5, 0.35].map((op, i) => (
              <div key={i} style={{ width: 76, height: 76, borderRadius: 14, background: stripe(CATS.otros), opacity: op }} />
            ))}
          </div>
        </div>
        <div>
          <div style={{ width: 80, height: 24, borderRadius: 999, ...SHIMMER }} />
          <div style={{ width: "90%", height: 34, borderRadius: 9, marginTop: 12, ...SHIMMER }} />
          <div style={{ width: 220, height: 13, borderRadius: 6, marginTop: 10, ...SHIMMER }} />
          <div style={{ width: 140, height: 34, borderRadius: 9, marginTop: 16, ...SHIMMER }} />
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: "60%", height: 12, borderRadius: 6, marginTop: 14, ...SHIMMER }} />
          ))}
          <div style={{ width: 340, height: 54, borderRadius: 999, marginTop: 26, ...SHIMMER }} />
        </div>
      </div>
    </div>
  );
}
