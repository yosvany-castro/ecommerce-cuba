"use client";
// src/components/tuki/CheckoutFlow.tsx — checkout Tuki de 4 pasos (dc.html 543–714).
// Envío por peso real (useTukiCart().weightLb), validación por paso (ckTried),
// pago + factura, revisar → POST /api/checkout/anonymous → success. Defaults
// del formulario precargados (demo, dc.html script 990–991).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmt } from "./lib";
import { useTukiCart } from "./cart";
import { useToast } from "./Toast";
import { etaLine, shipOptions, validateBilling, validateShipping } from "./checkout-core";

// Nota de re-validación por product_id (ver POST /api/checkout/revalidate).
// El precio vivo YA quedó escrito en products al llegar la respuesta — esto
// es solo para que la UI no muestre un total desactualizado.
type RevalidateNote = { status: "ok" | "price_changed" | "unavailable" | "unverifiable"; live_price_cents?: number };

const STEP_LABELS = ["Envío", "Entrega", "Pago", "Revisar"];
const PAY_DEFS = [
  { id: "tarjeta", label: "Tarjeta", sub: "crédito o débito", mark: "💳" },
  { id: "efectivo", label: "Efectivo al recibir", sub: "pagas en la puerta", mark: "💵" },
  { id: "transfer", label: "Transferencia", sub: "confirmación inmediata", mark: "🏦" },
] as const;
type PayId = (typeof PAY_DEFS)[number]["id"];
type ShipId = "rapido" | "estandar" | "lento";

const inputBase: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 52,
  borderRadius: 14,
  background: "#fff",
  padding: "0 16px",
  fontSize: 15,
  fontFamily: "var(--font-sans)",
  color: "#1C1D20",
  outline: "none",
};

export function CheckoutFlow() {
  const router = useRouter();
  const toast = useToast();
  const { items, weightLb, clear, hydrated, remove } = useTukiCart();

  const [step, setStep] = useState(1);
  const [ckTried, setCkTried] = useState(false);
  const [pending, setPending] = useState(false);
  const doneRef = useRef(false);
  const [revalidateMap, setRevalidateMap] = useState<Record<string, RevalidateNote>>({});
  const revalidatedIdsRef = useRef<string | null>(null);

  // Carrito vacío en /checkout → volver al feed. Espera a `hydrated` (el primer
  // paint siempre es vacío) y salta si acabamos de confirmar (doneRef): ahí el
  // carrito queda vacío a propósito y ya navegamos a /checkout/success.
  useEffect(() => {
    if (hydrated && items.length === 0 && !doneRef.current) router.push("/");
  }, [hydrated, items.length, router]);

  // Al ENTRAR al paso 4 (Revisar): re-valida precio/stock del carrito contra el
  // marketplace origen — el dueño revende, un precio viejo es venderle a
  // pérdida (ver src/sectors/b-catalog/revalidate.ts). El precio vivo ya queda
  // escrito en products al responder; acá solo reflejamos el aviso + el total.
  // sig evita re-disparar para el mismo set de ids (p.ej. un simple re-render).
  // Fail-open: cualquier error/abort deja el checkout seguir sin aviso.
  useEffect(() => {
    if (step !== 4 || items.length === 0) return;
    const ids = Array.from(new Set(items.map((i) => i.product_id)));
    const sig = ids.join(",");
    if (revalidatedIdsRef.current === sig) return;
    revalidatedIdsRef.current = sig;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/checkout/revalidate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_ids: ids }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          items: { product_id: string; status: RevalidateNote["status"]; live_price_cents?: number }[];
        };
        const map: Record<string, RevalidateNote> = {};
        for (const it of body.items) map[it.product_id] = { status: it.status, live_price_cents: it.live_price_cents };
        setRevalidateMap(map);
      } catch {
        // red caída / abort: sin aviso, el checkout sigue andando (fail-open)
      }
    })();
    return () => ctrl.abort();
  }, [step, items]);

  const [f, setF] = useState({
    nombre: "Dani Torres",
    ci: "",
    tel: "55 1234 5678",
    dir: "Av. Siempre Viva 742, depto 3",
    ciudad: "Ciudad de México",
    cp: "06100",
    card: "4242 4242 4242 4242",
    exp: "08/27",
    cvv: "123",
  });
  const [fb, setFb] = useState({ razon: "", rfc: "", correo: "dani@correo.mx", dirf: "" });
  const [pago, setPago] = useState<PayId>("tarjeta");
  const [shipSel, setShipSel] = useState<ShipId>("estandar");
  const [billSame, setBillSame] = useState(true);

  const setFK = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const setFbK = (k: keyof typeof fb) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFb((s) => ({ ...s, [k]: e.target.value }));

  // Precio efectivo: usa el live_price_cents de la re-validación cuando lo hay
  // (el dato en products ya se actualizó server-side; esto solo refleja el
  // total en pantalla — ver el useEffect de arriba).
  const priceOf = (ri: { product_id: string; price_cents: number }) =>
    revalidateMap[ri.product_id]?.live_price_cents ?? ri.price_cents;
  const effectiveSubtotal = items.reduce((s, ri) => s + priceOf(ri) * ri.qty, 0);

  const opts = shipOptions(weightLb, effectiveSubtotal);
  const selBlocked = opts.find((o) => o.id === shipSel)?.blocked ?? false;
  const sel: ShipId = selBlocked ? "estandar" : shipSel;
  const cur = opts.find((o) => o.id === sel)!;
  const shipCostCents = items.length ? cur.effectivePriceCents : 0;
  const totalCents = effectiveSubtotal + shipCostCents;
  const wS = weightLb.toFixed(1).replace(".0", "");

  const shipErrs = validateShipping(f);
  const billErrs = validateBilling(billSame, fb);
  const errs = ckTried ? shipErrs : {};
  const berrs = ckTried ? billErrs : {};
  const idOk = /^\d{6,}$/.test(f.ci);
  const bd = (k: string) => (errs[k] ? "#C96A55" : "#ECECE7");
  const bbd = (k: string) => (berrs[k] ? "#C96A55" : "#ECECE7");

  const ckBack = () => {
    if (step > 1) setStep((s) => s - 1);
    else router.push("/");
  };

  const ckNext = () => {
    if (step === 1 && Object.values(shipErrs).some(Boolean)) {
      setCkTried(true);
      toast("revisa los campos marcados");
      return;
    }
    if (step === 3 && Object.values(billErrs).some(Boolean)) {
      setCkTried(true);
      toast("completa los datos de factura");
      return;
    }
    setStep((s) => Math.min(4, s + 1));
    setCkTried(false);
  };

  const ckConfirm = async () => {
    if (pending) return; // guard doble-submit
    if (items.length === 0) {
      toast("tu carro está vacío");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/checkout/anonymous", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ product_id: i.product_id, quantity: i.qty })),
          shipping: {
            nombre: f.nombre,
            ci: f.ci,
            tel: f.tel,
            dir: f.dir,
            ciudad: f.ciudad,
            ...(f.cp.trim() ? { cp: f.cp } : {}),
            metodo: sel,
            pago,
            ...(billSame ? {} : { factura: { razon: fb.razon, rfc: fb.rfc, correo: fb.correo, dirf: fb.dirf } }),
          },
        }),
      });
      if (!res.ok) {
        toast("no pudimos confirmar el pedido — intenta de nuevo");
        setPending(false);
        return;
      }
      const body = (await res.json()) as { order_id: string };
      doneRef.current = true;
      clear();
      router.push(`/checkout/success?order=${encodeURIComponent(body.order_id)}&m=${sel}`);
    } catch {
      toast("no pudimos confirmar el pedido — intenta de nuevo");
      setPending(false);
    }
  };

  const ckSteps = STEP_LABELS.map((label, i) => ({
    label,
    bar: step > i ? "#1C1D20" : "#E7E7E2",
    fg: step === i + 1 ? "#1C1D20" : "#8E8F94",
    w: step === i + 1 ? 700 : 500,
  }));

  const field = (
    label: string,
    k: keyof typeof f,
    flex: number,
    opts2: { mono?: boolean; ph?: string; hint?: string } = {},
  ) => (
    <div style={{ flex }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>{label}</div>
      <input
        value={f[k]}
        onChange={setFK(k)}
        placeholder={opts2.ph}
        style={{ ...inputBase, border: `1px solid ${bd(k)}`, fontFamily: opts2.mono ? "var(--font-mono)" : "var(--font-sans)" }}
      />
    </div>
  );

  const cta = (label: string, onClick: () => void) => (
    <div
      onClick={onClick}
      className="tk-hov-cta"
      style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", height: 54, borderRadius: 999, background: "#1C1D20", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
    >
      {label}
    </div>
  );

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "30px 28px 90px", animation: "screenIn .3s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          onClick={ckBack}
          style={{ flex: "none", width: 42, height: 42, borderRadius: "50%", background: "#fff", border: "1px solid #EFEFEA", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <svg width="9" height="15" viewBox="0 0 8 14"><path d="M7 1L1 7l6 6" stroke="#1C1D20" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div style={{ fontFamily: "var(--font-brico)", fontSize: 28, fontWeight: 700 }}>Pago fácil</div>
        <div style={{ marginLeft: "auto", fontSize: 12.5, color: "#8E8F94" }}>🔒 conexión segura</div>
      </div>

      {/* progreso */}
      <div style={{ display: "flex", gap: 8, marginTop: 22, maxWidth: 560 }}>
        {ckSteps.map((s) => (
          <div key={s.label} style={{ flex: 1 }}>
            <div style={{ height: 5, borderRadius: 999, background: s.bar, transition: "background .3s" }} />
            <div style={{ fontSize: 12, fontWeight: s.w, color: s.fg, marginTop: 7 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 40, marginTop: 26, alignItems: "start" }}>
        <div>
          {/* paso 1 · envío */}
          {step === 1 && (
            <>
              <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 26 }}>¿a dónde lo llevamos?</div>
              <div style={{ fontSize: 13, color: "#8E8F94", margin: "6px 0 18px" }}>
                estos datos viajan con el paquete — los de factura van aparte, en el paso de pago
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 13, maxWidth: 520 }}>
                <div style={{ display: "flex", gap: 13 }}>
                  {field("Nombre completo", "nombre", 1.5)}
                  {field("Teléfono", "tel", 1)}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94" }}>Nº de identificación</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#B0B1AE" }}>solo números · 6–12 dígitos</span>
                  </div>
                  <div style={{ position: "relative" }}>
                    <input
                      value={f.ci}
                      onChange={(e) => setF((s) => ({ ...s, ci: e.target.value.replace(/\D/g, "").slice(0, 12) }))}
                      placeholder="p. ej. 0034125987"
                      style={{ ...inputBase, padding: "0 44px 0 16px", fontFamily: "var(--font-mono)", border: `1px solid ${errs.ci ? "#C96A55" : idOk ? "#8FB08F" : "#ECECE7"}` }}
                    />
                    {idOk && (
                      <div style={{ position: "absolute", right: 14, top: 14, width: 24, height: 24, borderRadius: "50%", background: "#EAF2EA", color: "#557A55", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</div>
                    )}
                  </div>
                  {errs.ci && (
                    <div style={{ fontSize: 12, color: "#B4533F", fontWeight: 600, marginTop: 5 }}>
                      {f.ci ? "muy corto — mínimo 6 dígitos" : "lo necesitamos para la guía de envío"}
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: "#9A9B9F", marginTop: 5 }}>✦ lo pide la paquetería para entregarte — no lo usamos para nada más</div>
                </div>
                {field("Dirección de entrega", "dir", 1)}
                <div style={{ display: "flex", gap: 13 }}>
                  {field("Ciudad", "ciudad", 1.5)}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>C.P. <span style={{ fontWeight: 500, color: "#B0B1AE" }}>(opcional)</span></div>
                    <input value={f.cp} onChange={setFK("cp")} style={{ ...inputBase, border: "1px solid #ECECE7" }} />
                  </div>
                </div>
                {cta("Continuar →", ckNext)}
              </div>
            </>
          )}

          {/* paso 2 · método de envío */}
          {step === 2 && (
            <>
              <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 26 }}>¿con qué prisa lo quieres?</div>
              <div style={{ fontSize: 13, color: "#8E8F94", margin: "6px 0 16px" }}>
                tu caja pesa <span style={{ fontWeight: 700, color: "#1C1D20" }}>{wS} lb</span> — el peso decide qué envíos aplican
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
                {opts.map((s) => {
                  const on = sel === s.id && !s.blocked;
                  const priceF = s.effectivePriceCents === 0 ? "Gratis" : fmt(s.effectivePriceCents);
                  const req = s.id === "estandar" ? "gratis desde $50" : s.maxLb ? `máx ${s.maxLb} lb` : s.minLb ? `mín ${s.minLb} lb` : "";
                  return (
                    <div
                      key={s.id}
                      onClick={() => { if (!s.blocked) setShipSel(s.id); }}
                      style={{ position: "relative", background: s.blocked ? "#F4F4F1" : "#fff", borderRadius: 18, border: `1.5px solid ${on ? "#1C1D20" : "#EFEFEA"}`, padding: "16px 18px", cursor: s.blocked ? "default" : "pointer", opacity: s.blocked ? 0.8 : 1, transition: "border-color .2s" }}
                    >
                      {s.reco && !s.blocked && (
                        <div style={{ position: "absolute", top: -10, right: 16, background: "#1C1D20", color: "#fff", borderRadius: 999, padding: "3px 11px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".4px" }}>la que más eligen</div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                        <div style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? "#1C1D20" : "#D8D8D3"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {on && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#1C1D20" }} />}
                        </div>
                        <span style={{ fontSize: 21 }}>{s.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 15, fontWeight: 700 }}>{s.name}</span>
                            <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 12.5, color: "#8E8F94" }}>{s.sub}</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: "#55565B", marginTop: 3 }}>{etaLine(s.d1, s.d2)} · {s.d1}–{s.d2} días</div>
                        </div>
                        <div style={{ flex: "none", textAlign: "right" }}>
                          <div style={{ fontSize: 15.5, fontWeight: 700, color: s.effectivePriceCents === 0 ? "#557A55" : "#1C1D20" }}>{priceF}</div>
                          <div style={{ fontSize: 10.5, color: "#8E8F94", marginTop: 2 }}>{req}</div>
                        </div>
                      </div>
                      {s.blocked && (
                        <div style={{ marginTop: 11, background: "#FBEBEA", borderRadius: 10, padding: "8px 12px", fontSize: 12, color: "#B4533F", fontWeight: 600 }}>✕ {s.reason}</div>
                      )}
                    </div>
                  );
                })}
                {cta("Continuar →", ckNext)}
              </div>
            </>
          )}

          {/* paso 3 · pago + factura */}
          {step === 3 && (
            <>
              <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 26, marginBottom: 18 }}>¿cómo quieres pagar?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11, maxWidth: 520 }}>
                {PAY_DEFS.map((po) => {
                  const on = pago === po.id;
                  return (
                    <div key={po.id} onClick={() => setPago(po.id)} style={{ display: "flex", alignItems: "center", gap: 14, background: "#fff", borderRadius: 16, border: `1.5px solid ${on ? "#1C1D20" : "#EFEFEA"}`, padding: "16px 18px", cursor: "pointer" }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? "#1C1D20" : "#D8D8D3"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {on && <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#1C1D20" }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{po.label}</div>
                        <div style={{ fontSize: 12.5, color: "#8E8F94", marginTop: 1 }}>{po.sub}</div>
                      </div>
                      <span style={{ fontSize: 17 }}>{po.mark}</span>
                    </div>
                  );
                })}
                {pago === "tarjeta" && (
                  <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #ECECE7", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>Número de tarjeta</div>
                      <input value={f.card} onChange={setFK("card")} style={{ ...inputBase, height: 48, borderRadius: 12, background: "#FAFAF8", border: "1px solid #ECECE7", fontFamily: "var(--font-mono)", fontSize: 14.5 }} />
                    </div>
                    <div style={{ display: "flex", gap: 11 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>Vence</div>
                        <input value={f.exp} onChange={setFK("exp")} style={{ ...inputBase, height: 48, borderRadius: 12, background: "#FAFAF8", border: "1px solid #ECECE7", fontFamily: "var(--font-mono)", fontSize: 14.5 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>CVV</div>
                        <input value={f.cvv} onChange={setFK("cvv")} style={{ ...inputBase, height: 48, borderRadius: 12, background: "#FAFAF8", border: "1px solid #ECECE7", fontFamily: "var(--font-mono)", fontSize: 14.5 }} />
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #ECECE7", padding: "16px 18px" }}>
                  <div onClick={() => setBillSame((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>Facturar con los datos de envío</div>
                      <div style={{ fontSize: 12, color: "#8E8F94", marginTop: 2 }}>
                        {billSame ? `la factura sale a nombre de ${f.nombre}` : "factura a otro nombre, empresa o RFC"}
                      </div>
                    </div>
                    <div style={{ flex: "none", width: 42, height: 23, borderRadius: 999, background: billSame ? "#1C1D20" : "#E3E3DE", position: "relative", transition: "background .25s" }}>
                      <div style={{ position: "absolute", top: 2.5, left: 2.5, width: 18, height: 18, borderRadius: "50%", background: "#fff", transform: billSame ? "translateX(19px)" : "translateX(0)", transition: "transform .25s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
                    </div>
                  </div>
                  {!billSame && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 14, paddingTop: 14, borderTop: "1px dashed #ECECE7" }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>Razón social o nombre fiscal</div>
                        <input value={fb.razon} onChange={setFbK("razon")} placeholder="p. ej. Estudio Camaleón S.A." style={{ ...inputBase, height: 48, borderRadius: 12, background: "#FAFAF8", border: `1px solid ${bbd("razon")}`, fontSize: 14.5 }} />
                      </div>
                      <div style={{ display: "flex", gap: 11 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>ID fiscal (RFC / NIT)</div>
                          <input value={fb.rfc} onChange={(e) => setFb((s) => ({ ...s, rfc: e.target.value.toUpperCase().slice(0, 13) }))} placeholder="ECA930215XX1" style={{ ...inputBase, height: 48, borderRadius: 12, background: "#FAFAF8", border: `1px solid ${bbd("rfc")}`, fontFamily: "var(--font-mono)", fontSize: 14.5 }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>Correo para la factura</div>
                          <input value={fb.correo} onChange={setFbK("correo")} style={{ ...inputBase, height: 48, borderRadius: 12, background: "#FAFAF8", border: "1px solid #ECECE7", fontSize: 14.5 }} />
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8E8F94", marginBottom: 6 }}>Dirección fiscal</div>
                        <input value={fb.dirf} onChange={setFbK("dirf")} style={{ ...inputBase, height: 48, borderRadius: 12, background: "#FAFAF8", border: `1px solid ${bbd("dirf")}`, fontSize: 14.5 }} />
                      </div>
                      <div style={{ fontSize: 11.5, color: "#9A9B9F" }}>✦ la factura llega sola a tu correo al confirmar — sin trámites</div>
                    </div>
                  )}
                </div>
                {cta("Continuar →", ckNext)}
              </div>
            </>
          )}

          {/* paso 4 · revisar */}
          {step === 4 && (
            <>
              <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 26, marginBottom: 18 }}>revisa y listo</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11, maxWidth: 520 }}>
                {items.some((ri) => revalidateMap[ri.product_id]) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {items.map((ri) => {
                      const rv = revalidateMap[ri.product_id];
                      if (!rv) return null;
                      if (rv.status === "price_changed" && rv.live_price_cents != null) {
                        return (
                          <div key={ri.key} style={{ fontSize: 12, color: "#B4533F" }}>
                            el precio de «{ri.title}» cambió: {fmt(ri.price_cents)} → {fmt(rv.live_price_cents)}
                          </div>
                        );
                      }
                      if (rv.status === "unavailable") {
                        return (
                          <div key={ri.key} style={{ fontSize: 12, color: "#B4533F" }}>
                            «{ri.title}» ya no está disponible —{" "}
                            <span onClick={() => remove(ri.key)} style={{ textDecoration: "underline", cursor: "pointer" }}>quítalo</span>
                          </div>
                        );
                      }
                      if (rv.status === "unverifiable") {
                        return (
                          <div key={ri.key} style={{ fontSize: 11.5, color: "#9A9B9F" }}>
                            «{ri.title}»: precio sujeto a confirmación
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
                <ReviewCard title="ENVÍO" onEdit={() => setStep(1)}>
                  <div style={{ fontSize: 14.5, marginTop: 6, lineHeight: 1.5 }}>{f.nombre} · {f.dir}, {f.ciudad}</div>
                  <div style={{ fontSize: 12.5, color: "#8E8F94", marginTop: 2 }}>ID {f.ci} · tel. {f.tel}</div>
                </ReviewCard>
                <ReviewCard title="ENTREGA" onEdit={() => setStep(2)}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 14.5 }}>{cur.icon} {cur.name} · {cur.d1}–{cur.d2} días</span>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: shipCostCents === 0 ? "#557A55" : "#55565B" }}>{shipCostCents === 0 ? "Gratis" : fmt(shipCostCents)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "#557A55", marginTop: 2 }}>{etaLine(cur.d1, cur.d2)}</div>
                </ReviewCard>
                <ReviewCard title="PAGO" onEdit={() => setStep(3)}>
                  <div style={{ fontSize: 14.5, marginTop: 6 }}>
                    {PAY_DEFS.find((p) => p.id === pago)!.label}
                    {pago === "tarjeta" ? ` terminada en ${f.card.slice(-4)}` : ""}
                  </div>
                </ReviewCard>
                <ReviewCard title="FACTURA" onEdit={() => setStep(3)}>
                  <div style={{ fontSize: 14.5, marginTop: 6 }}>{billSame ? `con los datos de envío — ${f.nombre}` : `${fb.razon} · ${fb.rfc}`}</div>
                </ReviewCard>
                <div
                  onClick={ckConfirm}
                  className="tk-hov-cta"
                  data-testid="tuki-checkout-confirm"
                  style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", height: 56, borderRadius: 999, background: "#1C1D20", color: "#fff", fontSize: 16, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
                >
                  {pending ? "Confirmando…" : `Confirmar pedido · ${fmt(totalCents)}`}
                </div>
              </div>
            </>
          )}
        </div>

        {/* resumen */}
        <div style={{ background: "#fff", border: "1px solid #EFEFEA", borderRadius: 22, padding: "20px 22px", position: "sticky", top: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Tu pedido</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {items.map((ri) => {
              const varLine = [ri.color, ri.size].filter(Boolean).join(" · ");
              return (
                <div key={ri.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, color: "#55565B" }}>
                  <span style={{ minWidth: 0 }}>
                    {ri.qty}× {ri.title}{varLine ? ` (${varLine})` : ""}
                    {ri.source && <span style={{ fontSize: 11, color: "#B0B1AE" }}> · {ri.source}</span>}
                  </span>
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{fmt(priceOf(ri) * ri.qty)}</span>
                </div>
              );
            })}
          </div>
          <div style={{ height: 1, background: "#F1F1EE", margin: "14px 0" }} />
          <Row label="Subtotal" value={fmt(effectiveSubtotal)} />
          <Row label="Peso de la caja" value={`${wS} lb`} />
          <Row label={`Envío · ${cur.name.toLowerCase()}`} value={shipCostCents === 0 ? "Gratis" : fmt(shipCostCents)} valueColor={shipCostCents === 0 ? "#557A55" : "#55565B"} />
          <div style={{ height: 1, background: "#F1F1EE", margin: "14px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Total</span>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px" }}>{fmt(totalCents)}</span>
          </div>
          {items.length > 0 && (
            <div style={{ fontSize: 12, color: "#557A55", marginTop: 8, textAlign: "right" }}>{etaLine(cur.d1, cur.d2)}</div>
          )}
        </div>
      </div>
    </div>
  );

  // helpers de render (mismo componente, evita props drilling)
  function ReviewCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
    return (
      <div style={{ background: "#fff", borderRadius: 18, border: "1px solid #EFEFEA", padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#8E8F94", letterSpacing: ".6px" }}>{title}</span>
          <span onClick={onEdit} style={{ fontSize: 12, color: "#8E8F94", cursor: "pointer", textDecoration: "underline" }}>cambiar</span>
        </div>
        {children}
      </div>
    );
  }
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#55565B", marginTop: 8 }}>
      <span>{label}</span>
      <span style={{ fontWeight: valueColor ? 600 : undefined, color: valueColor }}>{value}</span>
    </div>
  );
}
