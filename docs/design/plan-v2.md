# Plan de implementación — Diseño Tuki Desktop v2 (2026-08-12)

> Archivos importados verbatim del proyecto claude.ai/design (export del 2026-08-12):
> `tuki-desktop-v2.dc.html` (163KB), `tuki-desktop-v1.dc.html` (114KB), `support.js` (60KB,
> byte-idéntico al viejo — cero cambios de runtime). La base realmente portada a React es
> `tuki-desktop.dc.html` (140KB, ya estaba en docs/design). Diff accionable: base → v2.

## Cambios v2, por impacto visual

| # | Cambio | Tocar | Esfuerzo | ¿Decisión de Yosvany antes? |
|---|--------|-------|----------|------------------------------|
| 1 | **Home: primer fold en bento de 4 columnas** (saludo compacto · slot inteligente "lo eligió tu agente" · ofertas del día con countdown · comprar de nuevo) y el riel "offer" sale del feed | `HomeFeed.tsx`, `page.tsx` (datos server: último visto, deals con precio anterior, historial de compra) | **L** | Countdown solo honesto si las ofertas rotan de verdad (cron diario existe); "ver las N ofertas" exige ruta real de ofertas |
| 2 | **Búsqueda/categoría: muere el sidebar** → barra horizontal de filtros + dropdown "Ordenar: Para ti ✦" + pills removibles + grilla de 4 columnas | `Listing.tsx` (reescritura), `SearchView.tsx`, `filters.ts`, `CategoryView.tsx` | **M** | No |
| 3 | **PDP: franja de confianza + bundle "llévalos juntos" (−15% el 2º) + rating clicable** | `ProductView.tsx` (+ recálculo server si hay bundle) | franja **M** / bundle **L** | **SÍ**: ¿bundle −15% real? (cambia totales → server-side obligatorio) |
| 4 | **Navbar: botón del carro como pill con subtotal visible** | `Shell.tsx` + exponer subtotal en `cart.tsx` | **S** | No |
| 5 | **Cards: la meta gana la ETA** ("★ 4.8 · llega el jue") — honesta con estimateDelivery real | `ProductCard.tsx`, `lib.ts` | **S** | No |
| 6 | **Suggest: de productos a CONSULTAS** ("búsquedas similares", "q en pasillo", sugerencias-filtro) | `Shell.tsx`, `api/suggest`, query param de filtros en Listing | **M** | "con envío gratis" se adapta o se cae (no existe envío gratis) |
| 7 | **Cupón HOLA10 (−10%) en checkout + línea combo** | `CheckoutFlow.tsx`, `CartDrawer.tsx`, server validation | **M-L** | **SÍ**: ¿cupones reales? |
| 8 | Knob `moduloHero` (auto/retoma/ofertas) | config admin/agente | S | Opcional |

## CONSERVAR aunque v2 diga otra cosa (blindado)

- Envío por libra + buffer (v2 aún trae "gratis desde $50" y flat $4.99 — NO revertir).
- Checkout cubano completo (provincias, Express/Aéreo, tax, 409 server-side).
- Sin tarjeta ni wallets (el "Pago exprés  Pay/G Pay" de v2 es teatro sin procesador).
- Sin reviews inventadas ("Marta G. ★★★★★"), sin stock fake ("quedan N" = hash del id), sin
  "devolución 30 d" mientras no exista de verdad.
- Secciones del agente en home/carrito y upsell real del drawer (conviven con el bento).
- Spinner sagrado + copy honesto del PDP + precio inmutable (todo combo/cupón server-side).
