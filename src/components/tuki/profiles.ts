// src/components/tuki/profiles.ts — perfiles demo (T11): identidades reales
// sembradas, no un cambio de tema cosmético. Los `anonId` son uuids FIJOS
// compartidos con scripts/seed-demo-profiles.ts — elegir un perfil en el Shell
// simplemente adopta esa cookie anonymous_id, y el feed que llega es el que
// ese historial de eventos ya ganó. Client-safe: solo constantes, sin
// imports de servidor (el seed script y el Shell importan de aquí por igual).
export interface DemoProfile {
  id: string;
  anonId: string | null;
  name: string;
  letter: string;
  desc: string;
  greet: string;
  gsub: string;
  favs: string[];
}

export const DEMO_PROFILES: DemoProfile[] = [
  {
    id: "explorador",
    anonId: null,
    name: "Explorador",
    letter: "✦",
    desc: "El feed parte general y aprende de cada toque",
    greet: "Hola — armamos esto para ti",
    gsub: "el feed aprende de lo que miras, sin formularios",
    favs: [],
  },
  {
    id: "ana",
    anonId: "aaaaaaaa-1111-4111-8111-000000000001",
    name: "Ana · a la moda",
    letter: "A",
    desc: "Ropa y belleza, renueva el clóset",
    greet: "Hola, Ana — tu clóset te llama",
    gsub: "tu feed prioriza ropa y belleza que ya miraste",
    favs: ["ropa", "belleza"],
  },
  {
    id: "leo",
    anonId: "aaaaaaaa-1111-4111-8111-000000000002",
    name: "Leo · casa y cocina",
    letter: "L",
    desc: "Su casa es su proyecto",
    greet: "Hola, Leo — hoy se estrena algo",
    gsub: "tu feed prioriza hogar y cosas para tu casa",
    favs: ["hogar"],
  },
  {
    id: "dani",
    // NOTA: "...000000000003" caía en el holdout determinista del 10%
    // (src/sectors/d-personalization/holdout.ts, hash salado por anonymous_id)
    // — esa identidad SIEMPRE recibe el baseline sin personalizar, por diseño.
    // "...000000000005" cae fuera del holdout (verificado con el mismo hash).
    anonId: "aaaaaaaa-1111-4111-8111-000000000005",
    name: "Dani · tecnófila",
    letter: "D",
    desc: "Setup, gadgets y accesorios",
    greet: "Hola, Dani — tu setup te llama",
    gsub: "tu feed prioriza electrónica y tu setup",
    favs: ["electronica"],
  },
];

/** Colores del avatar por perfil (diseño dc.html:961–972). Presentacional; no viaja al script. */
export const AVATAR_COLORS: Record<string, { bg: string; fg: string }> = {
  explorador: { bg: "#F1F1EE", fg: "#55565B" },
  ana: { bg: "#E4F2F1", fg: "#3E7F78" },
  leo: { bg: "#FBEBEA", fg: "#A25B52" },
  dani: { bg: "#F0ECFA", fg: "#6B5BA8" },
};

/** Perfil activo según la cookie anonymous_id. Explorador (id por defecto) si no matchea nada. */
export function profileForAnonId(anonId: string | null | undefined): DemoProfile {
  return DEMO_PROFILES.find((p) => p.anonId !== null && p.anonId === anonId) ?? DEMO_PROFILES[0];
}
