"use client";
// src/components/tuki/FiltersDrawer.tsx — drawer de filtros avanzados (dc.html 821–866).
import { track } from "@/lib/client/track";
import { FILTER_COLORS } from "./lib";
import type { AdvState } from "./filters";
import { EMPTY_ADV } from "./filters";

const SORTS: [AdvState["sort"], string][] = [["rel", "Relevancia"], ["asc", "Precio ↑"], ["desc", "Precio ↓"], ["top", "Mejor valorados"]];
const PRICES: [NonNullable<AdvState["price"]>, string][] = [["p1", "Hasta $15"], ["p2", "$15–30"], ["p3", "$30–50"], ["p4", "$50+"]];
const SOLOS: [keyof Pick<AdvState, "oferta" | "envio" | "r4">, string][] = [["oferta", "Solo en oferta"], ["envio", "Con envío gratis"], ["r4", "Valoración ★ 4.6+"]];

const radioSty = (on: boolean) => ({ background: on ? "#1C1D20" : "#fff", color: on ? "#fff" : "#55565B", border: `1px solid ${on ? "#1C1D20" : "#ECECE7"}` });
const label11 = { fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, color: "#8E8F94" } as const;
const chip = { whiteSpace: "nowrap", padding: "9px 15px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer" } as const;

export function FiltersDrawer({
  adv,
  setAdv,
  count,
  onClose,
}: {
  adv: AdvState;
  setAdv: React.Dispatch<React.SetStateAction<AdvState>>;
  count: number; // advCount = resultados tras filtros
  onClose: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(28,29,32,.4)", zIndex: 80, animation: "fadeIn .25s ease both" }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 380,
          maxWidth: "90vw",
          background: "#FAFAF8",
          zIndex: 81,
          boxShadow: "-20px 0 60px rgba(28,29,32,.2)",
          animation: "drawerIn .35s cubic-bezier(.2,.8,.2,1) both",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 22px", borderBottom: "1px solid #EFEFEA" }}>
          <div style={{ fontFamily: "var(--font-brico)", fontSize: 22, fontWeight: 700 }}>Filtros</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              onClick={() => setAdv(EMPTY_ADV)}
              style={{ fontSize: 13, color: "#8E8F94", cursor: "pointer", textDecoration: "underline" }}
            >
              limpiar
            </div>
            <div
              onClick={onClose}
              style={{ width: 38, height: 38, borderRadius: "50%", background: "#fff", border: "1px solid #ECECE7", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, color: "#55565B" }}
            >
              ✕
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 22px 20px" }}>
          <div style={{ ...label11, margin: "16px 0 9px" }}>ORDENAR</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {SORTS.map(([id, lbl]) => (
              <div
                key={id}
                onClick={() => {
                  track("filter_applied", { filter_type: "sort", filter_value: id });
                  setAdv((a) => ({ ...a, sort: id }));
                }}
                style={{ ...chip, ...radioSty(adv.sort === id) }}
              >
                {lbl}
              </div>
            ))}
          </div>

          <div style={{ ...label11, margin: "18px 0 9px" }}>PRECIO</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {PRICES.map(([id, lbl]) => (
              <div
                key={id}
                onClick={() => {
                  const next = adv.price === id ? null : id;
                  track("filter_applied", { filter_type: "price", filter_value: next ?? "none" });
                  setAdv((a) => ({ ...a, price: next }));
                }}
                style={{ ...chip, ...radioSty(adv.price === id) }}
              >
                {lbl}
              </div>
            ))}
          </div>

          <div style={{ ...label11, margin: "18px 0 9px" }}>COLOR</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {FILTER_COLORS.map(({ name, hex }) => (
              <div
                key={name}
                onClick={() => {
                  track("filter_applied", { filter_type: "color", filter_value: name });
                  setAdv((a) => ({ ...a, colors: a.colors.includes(name) ? a.colors.filter((c) => c !== name) : [...a.colors, name] }));
                }}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, cursor: "pointer" }}
              >
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: hex, border: `2px solid ${adv.colors.includes(name) ? "#1C1D20" : "rgba(0,0,0,.1)"}`, boxShadow: "inset 0 0 0 3px #FAFAF8" }} />
                <span style={{ fontSize: 10.5, color: "#8E8F94" }}>{name}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, display: "flex", flexDirection: "column" }}>
            {SOLOS.map(([key, lbl]) => {
              const on = adv[key];
              return (
                <div
                  key={key}
                  onClick={() => {
                    track("filter_applied", { filter_type: key, filter_value: !on });
                    setAdv((a) => ({ ...a, [key]: !a[key] }));
                  }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderBottom: "1px solid #EFEFEA", cursor: "pointer" }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{lbl}</span>
                  <div style={{ width: 42, height: 23, borderRadius: 999, background: on ? "#1C1D20" : "#E3E3DE", position: "relative", transition: "background .25s" }}>
                    <div style={{ position: "absolute", top: 2.5, left: 2.5, width: 18, height: 18, borderRadius: "50%", background: "#fff", transform: on ? "translateX(19px)" : "translateX(0)", transition: "transform .25s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ flex: "none", padding: "16px 22px 20px", borderTop: "1px solid #EFEFEA", background: "#fff" }}>
          <div
            onClick={onClose}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 52, borderRadius: 999, background: "#1C1D20", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
          >
            Ver {count} resultados
          </div>
        </div>
      </div>
    </>
  );
}
