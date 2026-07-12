"use client";
// src/components/tuki/SearchView.tsx — vista de búsqueda: loader por etapas (dc.html 342–374,
// fórmulas del script 1256–1268) durante loading + Listing con resultados al terminar.
import { Listing } from "./Listing";
import type { TukiSearch } from "./useTukiSearch";

// Constantes decorativas del diseño (dc.html 957–958).
const SCAN_STORES = ["mercado-central.mx", "tecno-outlet.io", "bazar-hogar.com", "depo-deportes.mx", "casa-bonita.co", "la-esquina.shop", "ofertas-reales.lat", "punto-moda.mx"];
const SEARCH_TIPS = [
  "mientras esperas: todo tiene devolución gratis de 30 días",
  "dato: la IA ordena resultados según lo que has mirado",
  "casi listo — también comparamos reseñas, no solo precios",
];

function Loader({ q, progress }: { q: string; progress: number }) {
  const spr = progress;
  const stageIdx = spr < 0.3 ? 0 : spr < 0.58 ? 1 : spr < 0.85 ? 2 : 3;
  const searchPhrases = [
    `buscando «${q}» por todo internet…`,
    "leyendo precios y reseñas…",
    "comparando tienda por tienda…",
    "ordenando lo mejor para ti…",
  ];
  const steps = ["rastrear tiendas", "leer precios", "comparar", "ordenar"].map((label, i) => ({
    label,
    mark: i < stageIdx ? "✓" : i === stageIdx ? "✦" : "·",
    bd: i <= stageIdx ? "#1C1D20" : "#ECECE7",
    bg: i < stageIdx ? "#1C1D20" : "#fff",
    fg: i < stageIdx ? "#fff" : i === stageIdx ? "#1C1D20" : "#B0B1AE",
  }));
  const searchFound = Math.floor((1 - Math.pow(1 - spr, 2)) * 286);
  const searchScanLine = `⌕ ${SCAN_STORES[Math.floor(spr * 13) % SCAN_STORES.length]} · ${Math.min(34, Math.ceil(spr * 34))} de 34 tiendas`;
  const searchPctW = `${Math.round(spr * 100)}%`;
  const searchTip = SEARCH_TIPS[stageIdx % SEARCH_TIPS.length];

  return (
    <>
      <div style={{ background: "#fff", border: "1px solid #EFEFEA", borderRadius: 24, padding: "28px 32px", maxWidth: 660, margin: "0 auto", boxShadow: "0 12px 32px rgba(28,29,32,.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ position: "relative", flex: "none", width: 64, height: 64 }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px dashed #1C1D20", animation: "spinSlow 5s linear infinite" }} />
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, animation: "sparkPulse 1.3s ease-in-out infinite" }}>✦</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div key={stageIdx} style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 21, animation: "dropIn .3s ease both" }}>
              {searchPhrases[stageIdx]}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8E8F94", marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {searchScanLine}
            </div>
          </div>
          <div style={{ flex: "none", textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-brico)", fontSize: 27, fontWeight: 800, letterSpacing: "-0.5px" }}>{searchFound}</div>
            <div style={{ fontSize: 10.5, color: "#8E8F94", letterSpacing: 0.4 }}>productos revisados</div>
          </div>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: "#F1F1EE", overflow: "hidden", marginTop: 18 }}>
          <div style={{ height: "100%", borderRadius: 999, background: "repeating-linear-gradient(-45deg,#1C1D20,#1C1D20 10px,#3A3B40 10px,#3A3B40 20px)", animation: "barStripes .5s linear infinite", width: searchPctW, transition: "width .25s linear" }} />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 16, flexWrap: "wrap" }}>
          {steps.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 999, fontSize: 12, fontWeight: 600, border: `1px solid ${s.bd}`, background: s.bg, color: s.fg, transition: "all .3s" }}>
              <span>{s.mark}</span>
              {s.label}
            </div>
          ))}
        </div>
        <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "#9A9B9F", marginTop: 14, textAlign: "center" }}>{searchTip}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 22 }}>
        {[0.7, 0.5, 0.35].map((opacity) => (
          <div key={opacity} style={{ height: 220, borderRadius: 20, background: "linear-gradient(90deg,#F0F0EC 25%,#E6E6E1 40%,#F0F0EC 55%)", backgroundSize: "460px 100%", animation: "shimmer 1.1s linear infinite", opacity }} />
        ))}
      </div>
    </>
  );
}

const cacheBadge = (
  <div style={{ display: "inline-flex", alignItems: "center", marginBottom: 14, padding: "5px 13px", borderRadius: 999, border: "1px solid #ECECE7", background: "#fff", fontSize: 11.5, color: "#55565B" }}>
    ⚡ resultados al instante — ya conocíamos esta búsqueda
  </div>
);

// Chip discreto para el poll de fondo (item 1.1): visible mientras sigue buscando en
// más tiendas tras pintar los resultados locales, desaparece solo cuando termina.
const pollingChip = (
  <div style={{ display: "inline-flex", alignItems: "center", marginBottom: 14, marginLeft: 8, padding: "5px 13px", borderRadius: 999, border: "1px solid #ECECE7", background: "#fff", fontSize: 11.5, color: "#55565B" }}>
    ⋯ buscando en más tiendas…
  </div>
);

export function SearchView({ q, search }: { q: string; search: TukiSearch }) {
  const { phase, progress, cards, meta, polling } = search;

  if (!q) {
    return (
      <div style={{ textAlign: "center", padding: "90px 20px", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 22, color: "#8E8F94" }}>
        ¿qué estás buscando hoy?
      </div>
    );
  }

  const loading = phase !== "results"; // idle→loading: muestra el loader desde el primer frame
  const header = {
    crumb: "Búsqueda",
    title: `«${q}»`,
    why: loading ? "buscando…" : `${cards.length} resultados ordenados para ti`,
    deep: "#77787D",
    tint: "#F4F4F1",
  };

  return (
    <Listing
      cards={loading ? [] : cards}
      source="search"
      header={header}
      sidebar
      overlay={loading ? <Loader q={q} progress={progress} /> : undefined}
      notice={
        !loading && (meta?.hit_cache || polling) ? (
          <>
            {meta?.hit_cache && cacheBadge}
            {polling && pollingChip}
          </>
        ) : undefined
      }
    />
  );
}
