// Skeleton instantáneo del listing de categoría (tint neutro: loading.tsx no
// recibe params, no inventamos el color de una categoría concreta).
const SHIMMER = {
  background: "linear-gradient(90deg,#E9E9E4 25%,#DFDFD9 40%,#E9E9E4 55%)",
  backgroundSize: "460px 100%",
  animation: "shimmer 1.1s linear infinite",
} as const;

export default function Loading() {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "26px 28px 90px" }}>
      <div style={{ width: 200, height: 13, borderRadius: 6, ...SHIMMER }} />
      <div style={{ borderRadius: 24, background: "#F1F1EE", padding: "26px 30px", marginTop: 16 }}>
        <div style={{ width: 260, height: 30, borderRadius: 9, ...SHIMMER }} />
        <div style={{ width: 200, height: 14, borderRadius: 7, marginTop: 10, ...SHIMMER }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 26, marginTop: 22 }}>
        <div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ width: 120, height: 13, borderRadius: 6, marginTop: i === 0 ? 0 : 16, ...SHIMMER }} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} style={{ height: 220, borderRadius: 20, opacity: i < 6 ? 1 : 0.6, ...SHIMMER }} />
          ))}
        </div>
      </div>
    </div>
  );
}
