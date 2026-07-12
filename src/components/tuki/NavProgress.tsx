"use client";
// src/components/tuki/NavProgress.tsx — barra de progreso de navegación,
// port del NavigationProgress de orbfit-suite (apps/frontend/src/components):
// aparece AL INSTANTE cuando se toca algo que navega ("algo se tocó y está
// navegando"), hace un sweep indeterminado (keyframes progress-indeterminate
// en globals.css, calcados de orbfit), y al llegar se llena al 100% y se
// desvanece (300ms + fade 200ms — mismos tiempos de orbfit).
//
// orbfit detecta la navegación con TanStack Router (status==='pending');
// App Router no expone esa señal, así que acá el arranque es doble:
//  (a) click en cualquier <a href> interno (Links), en fase captura
//  (b) parche de history.pushState/replaceState — cubre TODOS los
//      router.push programáticos (cards, menú, breadcrumbs usan divs+push)
// y el fin es el cambio real de pathname/searchParams. Timeout de seguridad
// de 8s por si una navegación se cancela (back, error) — la barra nunca queda
// infinita. Colores del sitio: negro #1C1D20 sobre track al 12%.
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const MIN_VISIBLE_MS = 350; // que el toque siempre se VEA, aunque la nav sea instantánea
const SAFETY_MS = 8_000;

function NavProgressInner() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [show, setShow] = useState(false);
  const [complete, setComplete] = useState(false);
  const startedAt = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const navKey = `${pathname}?${search.toString()}`;
  const lastKey = useRef(navKey);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const start = () => {
    clearTimers();
    startedAt.current = Date.now();
    setComplete(false);
    setShow(true);
    timers.current.push(setTimeout(() => setShow(false), SAFETY_MS));
  };

  // Arranque (a): click en un link interno — fase captura, antes de React.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      if (a.origin !== location.origin) return;
      if (a.pathname === location.pathname && a.search === location.search) return;
      start();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arranque (b): navegación programática (router.push) — parche de history.
  useEffect(() => {
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...args) => {
      start();
      return origPush(...args);
    };
    history.replaceState = (...args) => {
      return origReplace(...args); // replace (filtros, etc.) no es "navegar"
    };
    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fin: la URL cambió de verdad → llenar al 100% y desvanecer (orbfit).
  useEffect(() => {
    if (navKey === lastKey.current) return;
    lastKey.current = navKey;
    if (!show) return;
    const elapsed = Date.now() - startedAt.current;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    clearTimers();
    timers.current.push(
      setTimeout(() => {
        setComplete(true);
        timers.current.push(setTimeout(() => setShow(false), 300));
      }, wait),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navKey]);

  return (
    <div
      role="progressbar"
      aria-valuetext={complete ? "Página cargada" : "Cargando página…"}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: show ? 1 : 0,
        transition: "opacity .2s ease",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(28,29,32,.12)" }} />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "100%",
          background: "#1C1D20",
          boxShadow: "0 0 12px rgba(28,29,32,.45), 0 0 6px rgba(28,29,32,.3)",
          ...(complete
            ? { width: "100%", transition: "width .2s ease-out" }
            : { animation: "progress-indeterminate 1.5s ease-in-out infinite" }),
        }}
      />
    </div>
  );
}

export function NavProgress() {
  // useSearchParams exige Suspense para no forzar CSR del layout entero.
  return (
    <Suspense fallback={null}>
      <NavProgressInner />
    </Suspense>
  );
}
