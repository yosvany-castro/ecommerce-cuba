# Guía de correcciones — tracker de trabajo vivo

> Consolidado de las DOS auditorías (estática de 61 hallazgos + prueba en vivo, ver
> `auditoria-comercializacion-2026-08-12.md`) convertido en lista de trabajo.
>
> **REGLA DE ACEPTACIÓN (Yosvany, 2026-08-12): ningún cambio se da por terminado hasta
> verificarlo EN VIVO con Claude in Chrome contra `next start`.** Los tests automáticos son
> higiene, no aceptación. Estados: ⬜ pendiente · 🔨 hecho, falta verificar en vivo · ✅ verificado en vivo.

## Decisiones de negocio vigentes

- **Ventaja competitiva = velocidad de entrega.** Dos vías: **Express $6/lb (PROVISIONAL — falta
  precio real) y Aéreo $3.50/lb**. Marítimo eliminado de la oferta (sin tarifa → oculto).
- Días depósito→Cuba: express 3–7 (PROVISIONAL), aéreo 7–15 — **pendiente confirmar con la
  cadena real de Yosvany** (ver "Preguntas abiertas").
- Todo cambio de precio/total en el checkout se INFORMA en pantalla (nunca silencioso).
- Zonas personalizables: home al hacer scroll (slots 20-90), carrito, y pre-pago (cross/upsell).
  El hero (slot 10) es intocable para el agente.

## Cambios de hoy (2026-08-12, tarde)

| # | Cambio | Archivos | Estado |
|---|--------|----------|--------|
| H1 | Vía **Express** ($6/lb prov., env `NEXT_PUBLIC_SHIP_EXPRESS_CENTS_PER_LB`) + Aéreo; marítimo oculto en PDP | `lib/shipping.ts`, `lib/delivery.ts`, `checkout-core.ts`, `route.ts`, `ProductView.tsx` | ✅ Entrega muestra Express $6/lb y Aéreo $3.50/lb con fechas distintas |
| H2 | **409 con aviso persistente** junto al total | `CheckoutFlow.tsx` | ✅ visto en vivo: "el envío cambió de $31.50 a $14.00 … confirma de nuevo" |
| H3 | **Peso server con description** | `checkout-anonymous.ts` | ✅ server cotizó 4 lb (realista) vs 9 lb del snapshot viejo; snapshots nuevos ya coinciden |
| H4 | **Tax en el CartDrawer** — el total del drawer = total del checkout (el precio ya no salta) | `CartDrawer.tsx` | ✅ drawer $55.14 = checkout $55.14 |
| H5 | **Home pinta slots 20-90** (rieles del agente al hacer scroll) y **carrito pinta secciones extra** — el agente por fin es visible | `page.tsx`, `HomeFeed.tsx`, `CartDrawer.tsx` | ✅ home: 2 rieles del agente visibles al scroll (carrito: sin placement de agente aún que verificar) |
| H6 | **Copy honesto**: banners (fuera "gratis desde $50", "1–2 días", "factura al correo"), PDP (fuera devolución gratis/garantía 12m/saldo/marítimo) | `Shell.tsx`, `ProductView.tsx` | ✅ banners verificados en vivo · PDP pendiente de vista |
| H7 | `via` inválida → 400 `bad_via` (antes 500) | `route.ts` | 🔨 |
| H8 | **AGENTS_ENABLED=true** — agente encendido y CORRIDO EN REAL: 2 placements aplicados (`home:20` popular-hogar por 62.5% de vistas, `home:30` popular-global como test A/B propio) y VISIBLES en la tienda | `.env.local`, `.env.example` | ✅ run agent-run-2026-08-12-364438d2 |

**Verificación en vivo pendiente (Chrome):** home → scroll → ver riel del agente en slot 20 · carrito
→ total con impuestos · checkout → dos vías con precios/fechas distintas · confirmar → si hay 409,
ver el aviso de→a · PDP → copy nuevo de envío · banners nuevos rotando.

## P0 — bloquea vender (semana 1)

- 🔨 **P0-1 Pesos + mesa de preparación**: `ADMIN_EMAILS` activo (chinok0307@gmail.com) y
  **`/admin/pedidos` CONSTRUIDA** — por pedido pendiente: datos de entrega, **link REAL de compra
  a la tienda origen por item (VITAL 911: 361/361 productos con URL)**, variante, y pesaje en
  báscula que fija `measured` + recalibra vecinos. *Falta verificar en vivo CON TU LOGIN*
  (anónimo redirige a login — fail-closed OK). El costo real de compra se anotará aquí (extensión).
- ✅ **P0-2 Contabilidad honesta** (migración 0038): pedido 6f3e1e5e → charged=3764 (=UI $37.64),
  cost=NULL, margin=NULL. Fuera el 60% inventado.
- 🔨 **P0-3 Pedido del usuario logueado** — código listo (getAuthUser → usuario real).
  *Falta verificar en vivo con TU sesión Supabase* (yo no puedo loguearme por ti).
- ✅ **P0-4 revalidate protegido**: sin cookie → 400 (verificado curl); rate-limit 12/hora por identidad.
- 🔨 **P0-5 `is_active` filtrado + 409 `unavailable`** con aviso y "quítalo" en la UI — código listo.
  *Verificar en vivo:* desactivar un producto en DB y confirmar un carrito viejo.
- ✅ **P0-6 Checkout cubano**: campos vacíos con placeholders, selector de 16 provincias +
  Municipio. Verificado en vivo: pedido a "Calle 23, Vedado, Plaza de la Revolución, La Habana".
- 🔨 **P0-7 Voyage resiliente**: timeout 10s + degradación a bm25_only — código listo, tests verdes.
  *Prueba viva opcional:* romper VOYAGE_API_KEY en local y buscar.
- ✅ **P0-8 Pago honesto**: tarjeta eliminada; efectivo (default) + transferencia. Verificado en vivo.

## P1 — que el cliente encuentre y confíe (semana 2)

- ⬜ **P1-1 Typos**: embeber la query NORMALIZADA (hoy se embebe la cruda y la corrección del LLM
  se tira) — reordenar normalize→embed en `search.ts`; pg_trgm en suggest.
  *Verificar:* "olla arocera" encuentra las ollas.
- ⬜ **P1-2 Freshness de ingesta por query corregida** (hoy: typo = doble pago por la misma búsqueda).
- 🔨 **P1-3 `CATEGORY_PROVIDER_MAP` arreglado** (name del registry conservado) + guard: mock jamás
  entra por accidente en producción. *Verificar:* log de la PRÓXIMA ingesta real por categoría.
- ⬜ **P1-4 Rieles complementarios con piso** (fuera cámaras espía con ollas) + copy sin afirmar
  compras reales inexistentes + imágenes rotas de addons/galería.
- ⬜ **P1-5 Crons con scheduler** (crontab versionado en `ops/` o GitHub Actions): fatiga,
  popularidad, NPMI, profile-recompute.
- ⬜ **P1-6 seen_at en rieles** (propagar composition_id/position) — sin esto la fatiga y el funnel
  del agente están ciegos fuera del hero. Prerrequisito para MEDIR al agente.
- ⬜ **P1-7 Identidad**: feed páginas 2+ con user real; merge carrito al login (clave+shape);
  exclusión purchased al anon correcto; purchase alimenta el vector online.
- ⬜ **P1-8 ETA consistente** PDP=checkout (provider days en el snapshot del carrito) y una sola
  fecha en success. *Verificar:* mismo producto, misma fecha en las 3 pantallas.
- ⬜ **P1-9 mock_calls al INICIO del job** (hoy una ingesta que muere no se contabiliza) + costo de
  error real (no 4¢ hardcode).

## P2 — operación y crecimiento (semana 3+)

- ⬜ Dashboard admin mínimo: pedidos del día (totales VERDADEROS), pesar paquetes, placements del
  agente (aprobar pending / pausar), gasto de ingesta.
- ⬜ Agente: gate v2.1 completo (4 seeds faltan) antes de subir de tier; `request_pause` runbook;
  margin_pct honesto en read_catalog; `/api/admin/placements`.
- ⬜ Recompute multi-modo (hoy colapsa los k-means), carrera getOrInitProfileMode, columnas muertas
  (session_vectors ceros, prior_vector, TAU_SESSION_MINUTES, budget_queries…).
- ⬜ DAL completo: /api/search devuelve StorefrontCard (hoy filas crudas), getProduct/getCategoryPage,
  tipos de respuestas HTTP exportados, hydrate con imgSrc.
- ⬜ Página /admin con índice + listado de usuarios (hoy hay que saberse el UUID).
- ⬜ Login Supabase: completar dashboard (Google creds, plantilla OTP, redirects) y probar en vivo.
- ⬜ Móvil real: pasada completa 390px (pendiente desde la prueba en vivo).

## Preguntas abiertas para Yosvany

1. Días REALES de su cadena por vía (compra→Miami→Cuba→puerta) — hoy provisional: express 3-7,
   aéreo 7-15 depósito→Cuba.
2. Precio final de Express (hoy $6/lb provisional).
3. ¿La paquetería exige provincia/municipio? ¿Cobertura territorial?
4. ¿Desglose por libra explícito o precio con envío incluido? (hoy: desglose explícito)

## P0-9 · PRECIOS REALES (hallazgo de Yosvany en /admin/pedidos, 2026-08-12)

**Caso Shein (guantes 10oz Black: cobrado $23, Shein hoy $18)** — causa raíz: las variantes se
hidratan UNA sola vez (`hydrated_at IS NULL`) y sus precios se pudren; la revalidación del checkout
solo refresca el precio BASE, jamás las variantes. **FIX HECHO 🔨**: el hydrate acepta
`{refresh:true}` (re-hidrata si el dato tiene >12h, respetando cuotas) y el checkout lo dispara
para todo item con color/talla ANTES de revalidar → el precio de variante se corrige visiblemente
(aviso "el precio cambió de $X a $Y"). *Verificar en vivo:* carrito con los guantes → checkout →
la línea debe corregirse a ~$18.

**Caso AliExpress (arrocera: cobrado $8.13, cuenta real paga $15.13)** — causa raíz VERIFICADA con
datos: `promotionPrice`=precio welcome/anónimo (8.13), `def.price`=LISTA INFLADA del tachado
(30.25) — **el precio real de cuenta logueada NO existe en la API** (escrapea anónimo). Preferir
`def.price` cobraría $30.25: peor. NO hay fix de una línea honesto. Camino con datos:
1. Correr la campaña `pnpm measure:price-gap` (fase 1 gasta ~16 llamadas de cuota) y que Yosvany
   llene la columna `browser_logged` navegando con SU cuenta (~15 min).
2. Con esa muestra decidir el modelo de costo aliexpress: `costo_estimado = promo × factor`
   (el punto de hoy da factor ≈1.86) y cobrar `costo_estimado × (1+margen)`.
3. **DECISIÓN DE NEGOCIO PENDIENTE (bloqueante): la política de margen de producto.** Hoy la
   tienda cobra EXACTAMENTE el precio del proveedor → margen de producto = 0 SIEMPRE (solo se
   gana en el envío). Con welcome-gap además se vende a pérdida. Yosvany debe fijar el markup
   (p.ej. costo×1.25) — con eso el welcome-gap queda absorbido y el margen honesto de P0-2 cobra
   sentido.

## Temu — opciones investigadas (2026-08-12, verificado contra el store de Apify)

- **Candidato principal search**: `amit123/temu-products-scraper` — $6/1k, 1,029 usuarios, **0 runs fallidos en 30d** (6,610 runs). Alternativa del dev ya conocido (el de otapi-shein): `axlymxp/temu-product-scraper` ($0.006/item) y su `temu-mcp-server` ($0.02/tool-call).
- **Detalle por id**: `goat255/temu-products-scraper` $7/1k (variantes+reviews) o `lentic_clockss/temu-scraper` ($3/1k, search+detalle multi-región, pero solo 14 usuarios).
- **RapidAPI**: existe "Temu.com Shopping API" (ShoppingAPI) con tier gratis de prueba — precios de tiers pagados solo visibles logueado. Alternativa: Piloterr (trial 500 créditos sin tarjeta).
- **OJO #1**: Temu es de lo MÁS duro de scrapear (WAF, captchas); los actores baratos puntúan 2-3. Probar con runs chicos + fallback antes de cablear a la ingesta.
- **OJO #2**: verificar el "new user deal" de Temu ANTES de confiar en los precios — misma trampa que el welcome de AliExpress.
- **OJO #3 (afecta lo YA instalado)**: Apify retira el modelo rental el **1-oct-2026** y auto-migra actores a pay-per-event — los actores actuales de Amazon/AliExpress/Shein pueden cambiar de modelo de cobro este otoño; vigilar notificaciones de precio.
- Sin vía oficial: el Open Platform de Temu es para sellers aprobados y el programa de afiliados no encaja con el modelo de reventa.

## Decisiones nuevas (2026-08-12, noche)

- **Política de precio DEFINITIVA**: sin markup fijo — ganancia = mejores precios/cupones + envío.
  Welcome-gap ACEPTADO como riesgo operativo: si el costo real supera al comprar, se avisa al
  cliente ("era una oferta"), se ajusta o cancela. El admin de pedidos debe facilitar ese flujo.
- **Temu integrado vía Apify** (`amit123/temu-products-scraper`, $6/1k): código completo (fuente
  `temu`, registry `temu-prod` sin fallback RapidAPI, mapa por categoría, días de entrega).
  **⚠️ EN PAUSA: el actor devuelve 403 de Temu ahora mismo (2 smokes, 0 productos, 2¢)** — Temu
  bloqueó su infra. `temu-prod` FUERA de MULTI_PROVIDER_SOURCES hasta que un smoke pase
  (`pnpm apify:smoke --source temu --query "..."`). Alternativa si urge: probar
  `crw/temu-products-scraper` ($10/1k, 5★, 99.6% runs OK) con OK de Yosvany (~20¢ smoke).
  El mapper es defensivo y se calibrará con el primer fixture real. Actor exige mín. 20 items/run.
- **CUOTA SAGRADA**: RapidAPI Temu = 5 búsquedas/MES. Solo verificación manual, jamás ingesta.
- **Diseño v2**: import desde claude.ai/design en curso (agente diffeando v1→v2 vs UI actual).

### Welcome-gap: veredicto de la investigación (2026-08-12)

- **NO existe factor fijo** (casos medidos: ×1.86 nuestro, ×2.0, ×3.0+, y a veces price-points
  fijos tipo $0.99 — no es porcentaje). La lista tachada es ancla falsa del seller (típicamente 2×,
  multa de $1.5M a AliExpress en Corea por eso): jamás usarla.
- **HALLAZGO CLAVE**: la **API oficial de AliExpress (dropshipping/affiliate) EXCLUYE el welcome
  deal por diseño** — devuelve el precio base real (confirmado por DSers/Importify/VillaTheme;
  campos `original_price`/`target_sale_price`). Camino estructural: registrarse en el open
  platform de AliExpress y usar SU api como fuente de precio-verdad para aliexpress (trabajo
  futuro, gratis o barato). Alternativa comunitaria: consultar con cuenta que ya compró ≥1 vez
  (el welcome desaparece para siempre tras el primer pedido).
- **Temu es peor**: sin API oficial, precios volátiles intradía y dependientes de sesión.
- **Mientras tanto rige la política decidida**: cobrar el precio mostrado + flujo de aviso/ajuste/
  cancelación en preparación cuando el costo real supere. Copy preventivo sugerido en PDP de
  productos aliexpress: "precio de oferta — se confirma al preparar tu pedido".

## Ejecución por bloques (diseño v2 × auditorías, por sinergia) — 2026-08-12 noche

Decisiones grabadas: bundles = agente + ahorro proveedor-side (jamás financiado por Tuki);
cupones = admin por campañas; ofertas rotan de noche multi-fuente (countdown honesto).

- ✅ **BLOQUE A (verificado en vivo 2026-08-12 noche)**: pill del carro con subtotal (v2-4) ·
  ETA honesta por tienda en cards (v2-5: "llega el 22 ago" amazon / "29 ago" aliexpress) ·
  días del proveedor al snapshot del carrito + success con la MISMA fecha del checkout (P1-8) ·
  barra de filtros v2 sin sidebar, dropdown de orden, pills removibles, grilla de 4 (v2-2) ·
  BONUS: murió el filtro falso "Envío gratis" y las 2 frases con "reseñas"/"devolución" del loader.
- ✅ **BLOQUE B (verificado en vivo)**: typos RESUELTOS — el hallazgo real fue que el normalizador
  jamás tuvo instrucción de corregir ortografía; prompt v1.1.0-typos la añade, y el pipeline ahora
  normaliza ANTES de embeber (la corrección llega al vector). «olla arocera» → 14 resultados,
  hybrid_rrf, SIN ingesta duplicada (freshness por query corregida, P1-2). Suggest v2: consultas
  reales pasadas tolerantes a typo (pg_trgm, migración 0039) + sugerencias-filtro «q en oferta»/
  «q mejor valorados» que aterrizan con el filtro puesto (P1-1 + v2-6).
- ✅ **BLOQUE C (verificado en vivo)**: bento de 4 columnas en la home (saludo compacto · slot
  "retoma donde ibas"/"elegido para empezar" vía localStorage · OFERTAS DEL DÍA con countdown real
  a medianoche + tabla daily_offers + cron:ofertas + ruta /ofertas · comprar de nuevo con compras
  reales / fallback tendencia) · ops/crontab VERSIONADO con los 10 crons (P1-5) · focus card ya
  muestra la foto real.
- ✅ **BLOQUE D (código listo, tests verdes)**: feed p2+ con usuario real · merge de carrito roto
  ELIMINADO (localStorage sobrevive el login solo; nadie leía cart_items) · exclusión purchased
  también por anonymous_id · la compra alimenta el vector EN VIVO · rieles cross_sell/cart_addons
  SIN fallback absurdo (sin NPMI → se ocultan; adiós cámaras espía) · hydrate devuelve attrs
  curados con imgSrc (DAL-7). ⚠️ P1-6 (seen_at en rieles) DIFERIDO: requiere diseñar el logging de
  impresiones para secciones no-hero — prerrequisito para MEDIR al agente, próxima sesión.
- ✅ **BLOQUE E (verificado en vivo)**: CUPONES por campaña completos — tabla coupons (0041),
  /admin/cupones (crear/usos/toggle), /api/coupons/validate, validación+consumo server-side en la
  tx del pedido, UI con línea verde y 409 si el cupón expira a mitad (HOLA10 −10% verificado:
  $26.24→$25.43) · BUNDLE "llévalos juntos" en PDP: sugerido por NPMI real, ahorro solo si el
  compañero trae old_price del proveedor, sin NPMI → no aparece (Tuki jamás financia) · mock_calls
  nace al INICIO de la ingesta y se actualiza al final (P1-9). ⚠️ moduloHero (v2-8) diferido.

## EL VENDEDOR QUE INTUYE — implementado y verificado en vivo (2026-08-13)

Ciclo completo funcionando sin recargar: ver "mochila escolar" → track product_view dispara
inferencia fire-and-forget (flash ~$0.0002, freshness por sesión) → `session_intents` guarda
label "la vuelta al cole" + términos ["estuches y lapiceros", "libretas y cuadernos", "botella de
agua escolar"] → resolver `intent_complements` (slot 40 home, migración 0042) → la siguiente
navegación SPA pinta **"Completa tu idea"** con complementos reales (verificado: set de lapiceros
Sanrio). Si un término no tiene matches en catálogo (coseno<0.45), se INGESTA ese término — el
vendedor surte el estante (presupuesto/freshness de búsqueda gobiernan).

También en esta sesión: **hero fail-open a RECIENTES** (jamás home vacía — el budget de 1500ms
reventaba en frío tras cada restart) · FiltersDrawer por PORTAL a body con blur (se abría al ancho
de la sección) · input de búsqueda selecciona al enfocar (se concatenaba texto viejo) · fallback
del carrito restaurado pero de MISMA categoría (relevante, sin cámaras espía) + copy honesto.

### Pendiente del feedback de Yosvany (próximo bloque)
- **Destacados en listados** (categorías/búsqueda): secciones resaltadas arriba del grid,
  colocables por el agente (extender superficie del slate a 'category'/'search').
- **Taxonomía de categorías**: 6 categorías brutas ("mochila escolar" cae en Otros). Propuesta:
  2 niveles (categoria → subcategoria en metadata, enum ampliado ~25 subcategorías), prompt de
  enriquecimiento actualizado + job de re-categorización del catálogo con LLM + chips de pasillo
  por subcategoría. DECISIÓN de Yosvany: la lista de subcategorías.
- Pill del carro mostraba dos montos en un render (glitch a re-verificar).
