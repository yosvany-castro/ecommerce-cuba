# Bloque 1 — Búsqueda confiable + Checkout honesto

Fecha: 2026-07-17 · Estado: aprobado por Yosvany (diseño A–D completo)

## Contexto: problemas verificados (no supuestos)

- **URL Shein** (`us.shein.com/...-p-423099565.html`): el parser SÍ matchea y extrae bien
  el ID. Falla el detalle: OTAPI responde `ItemIsNotComplete — try again later` (indexado
  perezoso). Verificado en vivo: 6 llamadas en ~2 min, todas incompletas. Una sola llamada
  síncrona (lo de hoy, `revalidate.ts:fetchDetailJson`) nunca va a funcionar.
- **URL AliExpress** (`aliexpress.us/item/3256812204334285.html?...x_object_id=1005012390649037`):
  `parseProductUrl` (`url-resolver.ts`) solo mira el `pathname` y extrae el ID SEO (`3256…`);
  el ID real va en el query (`x_object_id=1005…`). Verificado: DataHub `item_detail_2` da
  205 "no results" con ambos IDs para este ítem; `item_detail`/`item_detail_3` dan 5040 en
  el tier gratis. El fix del parser es necesario pero NO suficiente → hace falta fallback.
- **Título literal → 0 resultados**: BM25 usa `websearch_to_tsquery('spanish', q)` con AND
  estricto — 30 palabras en inglés contra índice en español = 0 filas. El coseno tiene piso
  0.55 que un título largo no cruza. Y si el normalizador LLM da `confidence ≤ 0.5`,
  `shouldCallMock` corta con `low_confidence` y NI SIQUIERA dispara ingesta en vivo.
- **"$213 primero, los de $3 después, sin aviso"**: los baratos llegaron por ingesta de
  fondo; el chip "⋯ buscando en más tiendas…" (`SearchView.tsx:88`) es demasiado sutil y
  solo aparece si la primera respuesta marcó `called_mock`.
- **Checkout**: el envío es tarifa PLANA por método (`checkout-core.ts:23`, rapido/estandar/
  lento); el peso solo bloquea opciones. No hay taxes. No hay buffer. `products.url` está en
  DB pero no llega a la UI. Títulos sin truncar en PDP, drawer y resumen.

## Alcance

**Dentro**: secciones A–E de abajo.
**Fuera** (bloques siguientes, en este orden ya decidido): B2 mi-cuenta + órdenes con
tracking/evidencia/soporte + admin de órdenes; B3 wallet completa; B4 casillero virtual;
B5 filtros de categorías con miniaturas; auth auto-link (va con B2, decisión ya tomada:
auto-link por email verificado + "crear contraseña" + página de seguridad). Portal de
carro embebido (navegador remoto): exploración V3, no se toca.

## Decisiones de producto (cerradas con Yosvany)

| Tema | Decisión |
|---|---|
| Precio a mostrar | Regular-con-descuento del proveedor (nunca Welcome Deal a sabiendas). Política definitiva tras **medir** (sección E). Interim: precio API + revalidación de checkout existente |
| Envío a Cuba | Por libra. Aéreo **$3.50/lb**. Marítimo: knob sin valor aún → la vía se oculta hasta configurarlo |
| Buffer peso/caja | `buffer_lb = max(15% del estimado, 1 lb)`; libras cobrables = `ceil(est + buffer)`. Sobrante al pesar real → se acredita a `users.balance_cents` (columna ya existe; el flujo de pesaje llega en B2) |
| Taxes | Línea "Impuestos de compra (FL)" = **7.5%** (Hillsborough: 6% + 1.5%) sobre subtotal de productos. Knob |
| Envío gratis ≥ $50 | **Eliminado** (con cobro por libra regalaba margen). Promos volverán vía wallet |
| Cantidades/price-breaks | No previsibles por API → los cubre la revisión del agente + re-factura (estado `precio_subido` ya existe en el enum) en B2 |

## Diseño técnico

### A. Búsqueda por URL — resolve asíncrono con fallback

1. **Parser** (`src/sectors/b-catalog/url-resolver.ts`): para aliexpress, leer primero
   `x_object_id` / `object_id` del query string; fallback al ID del path. Tests con las 2
   URLs reales de este spec.
2. **Endpoint** (`/api/products/resolve-url`): deja de ser todo-o-nada.
   - Si el detalle resuelve a la primera → igual que hoy (redirect a `/products/{id}`).
   - Si responde "indexando"/vacío/cuota → `202 {status:"pending", fallback_query}` y el
     server encola reintentos de fondo (mismo patrón fire-and-forget de
     `queueExternalIngest`; ~4 reintentos con backoff ≤ 2 min; si al final resuelve,
     upsert al catálogo como hoy).
   - `fallback_query` = slug del pathname → palabras (sin IDs, sin stopwords, máx ~10).
3. **Cliente** (`useTukiSearch.ts`): en `pending` muestra "Trayendo el producto de la
   tienda… puede tardar un momento" y hace poll hasta ~60s. Si no llegó: lanza búsqueda de
   texto con `fallback_query` + ingesta forzada, con aviso honesto "no pudimos traer el
   producto exacto; esto es lo más parecido". Nunca un vacío seco.
4. Cache por `source:source_product_id` para no quemar cuota RapidAPI en re-pegadas.

### B. Búsqueda por texto — títulos largos

1. **BM25 sobre términos normalizados**: `bm25()` recibe los `search_terms` del
   normalizador (español, cortos) en lugar del query crudo. El índice es
   `tsvector_es`; dejar de pelear inglés-largo contra español-AND.
2. **Regla de query-título** (> 8 palabras): se ignora el corte `low_confidence` y, si el
   resultado local fusionado queda vacío, SIEMPRE se dispara ingesta en vivo con los
   `search_terms`. (`shouldCallMock.ts` + `search.ts`.)
3. El piso 0.55 de coseno no se toca (protege del bug "fan → mochilas").

### C. Ingesta en vivo visible

1. Sustituir el chip sutil por una fila skeleton con texto claro: "⏳ Buscando en Amazon,
   AliExpress y Shein…" mientras `polling` esté activo (`SearchView.tsx`).
2. Al llegar resultados nuevos por poll: badge "N resultados nuevos" y inserción suave
   (sin robarle la lista al usuario bajo el dedo).
3. Los casos de ingesta forzada (A.3, B.2) también activan `polling` aunque la primera
   respuesta no traiga `called_mock`.
4. El spinner sagrado del agente y sus velocidades (1s/2s/4s) NO se tocan.

### D. Checkout honesto

1. **Por libra** (`checkout-core.ts` + espejo server en `checkout-anonymous.ts`):
   - `est_lb` = peso del carrito (cascada existente, sin cambios).
   - `buffer_lb = max(0.15 × est_lb, 1)`; `chargeable_lb = ceil(est_lb + buffer_lb)`.
   - `ship_cents = chargeable_lb × rate` con `rate` por vía: aéreo 350¢/lb (knob
     `SHIP_AEREO_CENTS_PER_LB`), marítimo knob `SHIP_MARITIMO_CENTS_PER_LB` (sin valor →
     la vía no se ofrece). Los métodos rapido/estandar/lento se reemplazan por las vías
     reales; los tiempos siguen saliendo de `delivery.ts` (sin cambios).
   - Se elimina envío gratis ≥ $50 y el flat `SHIP=499` del `CartDrawer`; el drawer pasa
     a mostrar "Envío estimado (aéreo): $X" con la misma fórmula por libra.
2. **Taxes**: `tax_cents = round(subtotal_productos × 7.5%)` (knob `SALES_TAX_PCT`).
   Línea visible "Impuestos de compra (FL)".
3. **UI del total**: total grande visible; fold "ver desglose" → productos, impuestos,
   envío (`X lb estimadas + buffer → Y lb × $3.50`), nota "si al pesar tu paquete sobra,
   se te acredita a tu saldo".
4. **Server recalcula todo** (regla sagrada cobro = mostrado): el POST de checkout
   recomputa por libra + tax y rechaza con 409 si difiere de lo que vio el cliente.
   `orders.shipping` jsonb guarda: `via, est_lb, buffer_lb, chargeable_lb,
   rate_cents_per_lb, ship_cents, tax_cents`. (Sin migración: jsonb ya existe;
   `total_charged_cents` sigue siendo solo productos, como hoy.)
5. **Títulos**: PDP clamp 2 líneas + "ver título completo" (expand inline); drawer y
   resumen de checkout: miniatura (el drawer ya la tiene; el resumen la gana) + título
   clamp 1–2 líneas. Patrón de clamp único compartido.
6. **URL de tienda en PDP**: añadir `url` a `StorefrontCard` (`contract.ts`) → copiar en
   `toCard` (`map.ts`) → link "Ver en {tienda} ↗" en `ProductView.tsx` (rel noopener,
   target _blank).

### E. Medición Welcome Deal (decisión "medir primero")

Script `scripts/measure-price-gap.ts`: toma 15–20 productos del catálogo (mezcla de
fuentes), pega al detalle API y escribe CSV con `source, id, titulo, price_api`.
Yosvany completa 2 columnas a mano navegando (precio anónimo y precio logueado) y el
script imprime el reporte de gaps. Con esos datos se fija la política definitiva
(¿colchón?, ¿por fuente?, ¿nada?). Hasta entonces rige el interim de arriba.

## Testing

- Unit: parser con las 2 URLs reales (x_object_id, path fallback); matemática
  por-libra/buffer/redondeo/tax con casos borde (0.4 lb, 10 lb, carrito vacío);
  slug→fallback_query; bm25 recibe search_terms; regla >8 palabras fuerza ingesta.
- Integración (patrón existente contra test_schema): checkout recomputa y guarda el
  desglose en `orders.shipping`; 409 si el cliente manda totales viejos.
- Verificación manual final (skill verify): las 2 URLs reales del spec + el título
  literal de Shein + "mini camera 1080p" en `next start`.

## Riesgos y techos conocidos

- Cuotas RapidAPI tier gratis (DataHub 100 req/mes): el resolve por URL consume detalle.
  Mitigación: cache + reintentos acotados + fallback a slug-search (que usa Apify, no
  RapidAPI). Si el volumen crece: subir de tier o actor Apify de detalle (ponytail: no
  ahora).
- OTAPI puede no indexar nunca un ítem de Shein US → el fallback slug-search es, en la
  práctica, el camino principal para Shein. Se acepta y se comunica honesto en UI.
- Tarifa marítima pendiente de Yosvany → vía oculta hasta tener número.
- El acredite del sobrante a wallet queda especificado aquí pero se ejecuta cuando exista
  el pesaje en admin (B2). En B1 el buffer se cobra y el estimado queda registrado.
