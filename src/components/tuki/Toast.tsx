"use client";
// src/components/tuki/Toast.tsx — toast global del port Tuki (dc.html:731, keyframe toastIn en globals.css).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

interface ToastState {
  id: number;
  text: string;
}

const ToastContext = createContext<((text: string) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string) => {
    nextId.current += 1;
    setToast({ id: nextId.current, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2000);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        // key=toast.id fuerza remount en cada show para re-disparar la animación toastIn.
        <div
          key={toast.id}
          style={{
            position: "fixed",
            top: 82,
            right: 26,
            background: "#1C1D20",
            color: "#fff",
            borderRadius: 999,
            padding: "12px 20px",
            fontSize: 13.5,
            fontWeight: 600,
            whiteSpace: "nowrap",
            zIndex: 90,
            boxShadow: "0 12px 30px rgba(28,29,32,.25)",
            animation: "toastIn .3s ease both",
          }}
        >
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): (text: string) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
