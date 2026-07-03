"use client";
// src/components/tuki/Shell.tsx — shell compartido del port Tuki (dc.html 33–123):
// barra de avisos + navbar (buscador, menú perfil, botón carro). Omite el link "móvil ↗".
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { track } from "@/lib/client/track";
import { CATS } from "./lib";
import { useTukiCart } from "./cart";
import { useToast } from "./Toast";

// FREE = $50 (dc.html:1174 envioGratisDesde=50; freeS = "$50").
const AVISO_MSGS = [
  "🚚 envío estándar gratis desde $50 — siempre",
  "⚡ ¿prisa? el envío rápido llega en 1–2 días",
  "✦ estrenamos secciones promocionales — baja por el feed",
  "la factura llega sola a tu correo al comprar",
];
const TRENDING = ["freidora de aire", "audífonos", "yoga", "monstera", "sérum", "mochila"];
const NAV_IDS = ["electronica", "ropa", "hogar", "belleza"] as const;
// Lista estática del diseño (dc.html 961–972). Wiring real de perfiles en T11.
const PROFILES = [
  { id: "explorador", name: "Explorador", letter: "✦", desc: "El feed parte general y aprende de cada toque", bg: "#F1F1EE", fg: "#55565B" },
  { id: "ana", name: "Ana · deportista", letter: "A", desc: "Corre 5k tres veces por semana", bg: "#E4F2F1", fg: "#3E7F78" },
  { id: "leo", name: "Leo · cocinero", letter: "L", desc: "Cocina en casa a diario", bg: "#FBEBEA", fg: "#A25B52" },
  { id: "dani", name: "Dani · tecnófila", letter: "D", desc: "Setup, gadgets y estilo urbano", bg: "#F0ECFA", fg: "#6B5BA8" },
];
const ACTIVE_PROFILE = PROFILES[0]; // Explorador (perfil por defecto del diseño)

interface Suggestion {
  id: string;
  title: string;
  category: string | null;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { count, setOpen } = useTukiCart();
  const showToast = useToast();

  const [avisoIdx, setAvisoIdx] = useState(0);
  const [avisoOff, setAvisoOff] = useState(false);
  const [q, setQ] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rotación de avisos cada 4s (dc.html:1317).
  useEffect(() => {
    const t = setInterval(() => setAvisoIdx((i) => (i + 1) % AVISO_MSGS.length), 4000);
    return () => clearInterval(t);
  }, []);

  // Recientes de localStorage (solo lectura aquí; se escriben en T6). Se leen al
  // enfocar el buscador — así reflejan búsquedas hechas en esta misma sesión.
  const readRecents = () => {
    try {
      const raw = localStorage.getItem("tuki_recents");
      const arr: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setRecents(arr.slice(0, 5).map(String));
    } catch {
      /* localStorage corrupto: sin recientes */
    }
  };

  // Sugerencias con debounce 200ms, solo q.length>=2 (/api/suggest). Todo el
  // setState ocurre dentro del timeout (async) para no re-renderizar en cascada.
  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(async () => {
      if (term.length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(term)}`);
        const data = (await res.json()) as { suggestions?: Suggestion[] };
        setSuggestions(data.suggestions ?? []);
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const runSearch = (term: string) => {
    const t = term.trim();
    if (!t) return;
    setSearchFocus(false);
    router.push(`/search?q=${encodeURIComponent(t)}`);
  };

  const goCategory = (id: string) => {
    track("category_click", { category: id });
    router.push(`/c/${id}`);
  };

  const typing = q.trim().length > 0;

  return (
    <>
      <div style={{ position: "sticky", top: 0, zIndex: 60 }}>
        {/* ═══ BARRA DE AVISOS ═══ */}
        {!avisoOff && (
          <div style={{ position: "relative", zIndex: 61, background: "#1C1D20", color: "#F6DFC3" }}>
            <div
              style={{
                maxWidth: 1280,
                margin: "0 auto",
                padding: "0 56px",
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                key={avisoIdx}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  letterSpacing: 1.5,
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  animation: "dropIn .35s ease both",
                }}
              >
                {AVISO_MSGS[avisoIdx]}
              </div>
            </div>
            <div
              onClick={() => setAvisoOff(true)}
              className="tk-hov-white"
              style={{
                position: "absolute",
                right: 18,
                top: "50%",
                transform: "translateY(-50%)",
                width: 24,
                height: 24,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#77787D",
                fontSize: 11,
              }}
            >
              ✕
            </div>
          </div>
        )}

        {/* ═══ NAVBAR ═══ */}
        <div
          style={{
            position: "relative",
            zIndex: 60,
            background: "rgba(250,250,248,.94)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid #EFEFEA",
          }}
        >
          <div
            style={{
              maxWidth: 1280,
              margin: "0 auto",
              padding: "0 28px",
              height: 66,
              display: "flex",
              alignItems: "center",
              gap: 26,
            }}
          >
            <div
              onClick={() => router.push("/")}
              style={{ fontFamily: "var(--font-brico)", fontSize: 25, fontWeight: 700, letterSpacing: "-0.6px", cursor: "pointer" }}
            >
              tuki
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              {NAV_IDS.map((id) => {
                const active = pathname === `/c/${id}`;
                return (
                  <div
                    key={id}
                    onClick={() => goCategory(id)}
                    className="tk-hov-dark"
                    style={{
                      fontSize: 14,
                      fontWeight: active ? 700 : 500,
                      color: active ? "#1C1D20" : "#6B6C70",
                      cursor: "pointer",
                      padding: "4px 0",
                      borderBottom: `2px solid ${active ? "#1C1D20" : "transparent"}`,
                    }}
                  >
                    {CATS[id].label}
                  </div>
                );
              })}
            </div>

            {/* buscador */}
            <div style={{ flex: 1, maxWidth: 480, position: "relative", marginLeft: "auto" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  height: 44,
                  borderRadius: 999,
                  background: "#fff",
                  border: `1px solid ${searchFocus ? "#1C1D20" : "#ECECE7"}`,
                  padding: "0 7px 0 16px",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 18 18">
                  <circle cx="8" cy="8" r="5.5" fill="none" stroke="#8E8F94" strokeWidth="1.8" />
                  <line x1="12.6" y1="12.6" x2="16.2" y2="16.2" stroke="#8E8F94" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch(q);
                  }}
                  onFocus={() => {
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    readRecents();
                    setSearchFocus(true);
                  }}
                  onBlur={() => {
                    blurTimer.current = setTimeout(() => setSearchFocus(false), 140);
                  }}
                  placeholder="Busca lo que sea…"
                  style={{
                    flex: 1,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    fontSize: 14.5,
                    fontFamily: "var(--font-sans)",
                    color: "#1C1D20",
                    minWidth: 0,
                  }}
                />
                <div
                  onClick={() => runSearch(q)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "#1C1D20",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  ✦
                </div>
              </div>
              {searchFocus && (
                <div
                  style={{
                    position: "absolute",
                    top: 52,
                    left: 0,
                    right: 0,
                    background: "#fff",
                    border: "1px solid #EFEFEA",
                    borderRadius: 18,
                    boxShadow: "0 18px 44px rgba(28,29,32,.13)",
                    overflow: "hidden",
                    animation: "dropIn .2s ease both",
                  }}
                >
                  {typing ? (
                    <>
                      {suggestions.map((sg) => {
                        const c = CATS[sg.category ?? ""] ?? CATS.otros;
                        return (
                          <div
                            key={sg.id}
                            onMouseDown={() => runSearch(sg.title)}
                            className="tk-hov-bg"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "12px 16px",
                              borderBottom: "1px solid #F6F6F3",
                              cursor: "pointer",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 18 18">
                              <circle cx="8" cy="8" r="5.5" fill="none" stroke="#B0B1AE" strokeWidth="1.8" />
                              <line x1="12.6" y1="12.6" x2="16.2" y2="16.2" stroke="#B0B1AE" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                            <span style={{ flex: 1, fontSize: 14 }}>{sg.title}</span>
                            <span style={{ fontSize: 11, color: "#8E8F94", background: c.tint, borderRadius: 999, padding: "3px 9px" }}>
                              {c.label}
                            </span>
                          </div>
                        );
                      })}
                      <div
                        onMouseDown={() => runSearch(q)}
                        className="tk-hov-bg"
                        style={{ padding: "12px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", color: "#1C1D20" }}
                      >
                        Buscar «{q}» →
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ padding: "14px 16px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: "#8E8F94" }}>
                        TENDENCIA HOY
                      </div>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", padding: "8px 16px 14px" }}>
                        {TRENDING.map((tr) => (
                          <div
                            key={tr}
                            onMouseDown={() => runSearch(tr)}
                            className="tk-hov-bd-dark"
                            style={{
                              padding: "7px 13px",
                              borderRadius: 999,
                              background: "#FAFAF8",
                              border: "1px solid #ECECE7",
                              fontSize: 12.5,
                              cursor: "pointer",
                            }}
                          >
                            ✦ {tr}
                          </div>
                        ))}
                      </div>
                      {recents.length > 0 && (
                        <>
                          <div style={{ padding: "2px 16px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: "#8E8F94" }}>
                            RECIENTES
                          </div>
                          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", padding: "8px 16px 16px" }}>
                            {recents.map((rc) => (
                              <div
                                key={rc}
                                onMouseDown={() => runSearch(rc)}
                                style={{
                                  padding: "7px 13px",
                                  borderRadius: 999,
                                  background: "#fff",
                                  border: "1px solid #ECECE7",
                                  fontSize: 12.5,
                                  color: "#55565B",
                                  cursor: "pointer",
                                }}
                              >
                                ↺ {rc}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* perfil */}
            <div style={{ position: "relative" }}>
              <div
                onClick={() => {
                  setMenuOpen((v) => !v);
                }}
                className="tk-hov-bd-dark"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  cursor: "pointer",
                  border: "1px solid #ECECE7",
                  borderRadius: 999,
                  padding: "5px 12px 5px 5px",
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: ACTIVE_PROFILE.bg,
                    color: ACTIVE_PROFILE.fg,
                    fontSize: 12.5,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {ACTIVE_PROFILE.letter}
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{ACTIVE_PROFILE.name.split(" ")[0]}</span>
                <span style={{ fontSize: 10, color: "#8E8F94" }}>▾</span>
              </div>
              {menuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: 48,
                    right: 0,
                    width: 300,
                    background: "#fff",
                    border: "1px solid #EFEFEA",
                    borderRadius: 18,
                    boxShadow: "0 18px 44px rgba(28,29,32,.13)",
                    padding: 10,
                    animation: "dropIn .2s ease both",
                    zIndex: 70,
                  }}
                >
                  <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, color: "#55565B", padding: "6px 8px 10px" }}>
                    ¿quién está comprando hoy?
                  </div>
                  {PROFILES.map((pr) => {
                    const active = pr.id === ACTIVE_PROFILE.id;
                    return (
                      <div
                        key={pr.id}
                        onClick={() => {
                          setMenuOpen(false);
                          showToast("disponible pronto");
                        }}
                        className="tk-hov-bg"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 11,
                          padding: "9px 10px",
                          borderRadius: 12,
                          cursor: "pointer",
                          border: `1.5px solid ${active ? "#1C1D20" : "transparent"}`,
                          marginBottom: 6,
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            background: pr.bg,
                            color: pr.fg,
                            fontSize: 14,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {pr.letter}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{pr.name}</div>
                          <div style={{ fontSize: 11.5, color: "#8E8F94", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {pr.desc}
                          </div>
                        </div>
                        {active && <span style={{ fontSize: 11, fontWeight: 700, color: "#557A55" }}>●</span>}
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 11, color: "#9A9B9F", padding: "6px 8px", lineHeight: 1.5 }}>
                    ✦ el feed se rearma al instante — la IA es invisible, solo se nota aquí
                  </div>
                </div>
              )}
            </div>

            {/* carro */}
            <div
              data-testid="tuki-cart-btn"
              onClick={() => {
                setMenuOpen(false);
                setOpen(true);
              }}
              className="tk-hov-bd-dark"
              style={{
                position: "relative",
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "#fff",
                border: "1px solid #ECECE7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <svg width="19" height="19" viewBox="0 0 20 20">
                <rect x="3" y="6.5" width="14" height="10.5" rx="3" fill="none" stroke="#1C1D20" strokeWidth="1.8" />
                <path d="M7 6.5 a3 3 0 0 1 6 0" fill="none" stroke="#1C1D20" strokeWidth="1.8" />
              </svg>
              {count > 0 && (
                <div
                  key={count}
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    minWidth: 19,
                    height: 19,
                    borderRadius: 999,
                    background: "#E0664B",
                    color: "#fff",
                    fontSize: 10.5,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "2px solid #FAFAF8",
                    boxSizing: "content-box",
                    animation: "popIn .4s ease both",
                  }}
                >
                  {count}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <main>{children}</main>
    </>
  );
}
