# Validación holística, auditoría destructiva y re-evaluación limpia (F6)

> **Nota de versión.** Este capítulo sustituye íntegramente a la versión anterior de
> F6. Una auditoría destructiva (2026-06-09, `docs/auditoria-destructiva-f6-2026-06-09.md`)
> demostró que los resultados originales del head-to-head estaban inflados por fugas de
> información y que el capítulo citaba cifras que no existían en los artefactos
> committeados. Las cifras vigentes son las de los reportes *clean*
> (`...n5000-seed123-full-clean.json` y `...v2-full-clean.json`); todo número de la
> versión anterior queda retirado.

## 1. La comparación original — y por qué sus números eran fuga

F6 nació para responder la pregunta que las fases F0–F4 nunca contestaron de forma
justa: **¿el pipeline ensamblado le gana a un e-commerce normal sobre exactamente los
mismos casos?** El arnés unificado (`unified-cases.ts`) sigue siendo válido como
infraestructura: un solo conjunto de casos, candidatos idénticos para todos los
rankers, marcos *full* (catálogo completo) y *pool* (diagnóstico). El problema no fue
el arnés sino los **datos que se le dieron** y la **métrica con que se juzgó**.

La versión publicada reportaba una ventaja de `f3-rrf` sobre `popular-cohort` que
crecía con la escala del catálogo, con titulares de +13 % (n=2000) a +71 % (n=10000).
La auditoría falsó esa cadena completa con cinco hallazgos:

1. **Fuga transductiva en los tres modelos globales (S1).** El split por sesión
   protegía el historial del usuario, pero prod2vec, el grafo NPMI y la popularidad se
   construían sobre `thesis.events` **completo, sesiones de test incluidas**. El grafo
   vio la cesta exacta que contiene la compra a predecir, y el anchor del source NPMI
   era un ítem de la propia sesión de test (en el 12.7 % de los casos, *el propio ítem
   de test*). Cuantificado: el hit-rate del source NPMI cae de 64.3 % (shipped) a
   16.2 % con serving honesto — **~75 % del poder aparente de NPMI era fuga**. Peor: la
   cuota de fuga **crece con la escala** (63.7 % → 80.4 % → 87.9 % a n=2000/5000/10000),
   de modo que la curva insignia "la ventaja crece con el catálogo" era la curva de la
   fuga, no del sistema.

2. **Métrica de negocio circular (S1).** `revenue@10` no era revenue realizado sino
   `Σ P̂(buy)·precio·margen`, donde la affinity de P̂ es el coseno del candidato a los
   mode-medoids del usuario — exactamente la señal que el pipeline maximiza. Falsación:
   un ranker cínico `precio×margen desc`, con nDCG@10 = 0.002 (cero personalización),
   obtiene revenue@10 = 77,782 — un 30 % más que el "campeón de revenue" f4-revenue
   (59,955). Todos los titulares de revenue de la versión anterior quedan invalidados.

3. **Mundo sintético de popularidad plana, construido a favor (S1).** Las compras por
   ítem tenían Gini 0.41 con el top-10 % de ítems concentrando solo el 26 % de las
   ventas (el retail real es ~80/20): la "popularidad" era ruido casi uniforme y el
   baseline estaba condenado por diseño — su decay con la escala era aritmética de
   cobertura de ventana, fabricada por el generador. Además los complementos se
   sembraban explícitamente para que NPMI los recuperara (el comentario del propio
   `behavior-model.ts` lo admitía), y aun así solo ~3 % de las compras de test eran
   complementos sembrados; el segmento regalo estaba inflado 3-6× (p_gift ~30 % vs
   5-10 % real); y no existía elasticidad-precio.

4. **Oráculo en el baseline (S2).** `popular-cohort` recibía como cohorte la
   subcategoría **del ítem de test** — información que ninguna home page tiene. Con
   cohorte realista, el baseline cae de 0.088 a 0.032 (n=5000/seed123). Es decir, la
   comparación publicada era *fuga contra fuga*: la fuga de NPMI inflaba al pipeline y
   la del oráculo+popularidad inflaba al baseline. Ninguno de los dos números existía
   en un sistema desplegable.

5. **Documentos desincronizados de los artefactos (S2).** Este capítulo citaba
   +13.0 % (0.200 vs 0.177) a n=2000, pero el reporte committeado vigente decía
   +33.2 % (0.236); la tabla insignia "+13→+63→+71 %" mezclaba filas del harness
   pre-fix y post-fix, no comparables entre sí. El presente capítulo se regeneró desde
   los JSON committeados y no cita ninguna cifra que no exista en ellos.

La cadena central de la auditoría (experimento D, mismo dataset n=5000/seed123, misma
lógica de ranking) resume el colapso: la ventaja publicada **+73.8 %**
(CI95 [+56 %, +94 %]) se convierte, al retirar todas las fugas, en **−23.9 %**
(CI95 [−36 %, −9 %], p=0.0005) — significativa *en contra*. Y un item-kNN por
co-ocurrencia (el "customers who bought X also bought Y" de 2003) empata exactamente
con `f3-rrf` en el mundo limpio: la maquinaria aprendida no superaba a lo trivial una
vez retirada la fuga.

**Lo que la auditoría destruyó es la evidencia, no necesariamente el sistema**: la
réplica reprodujo nuestros números al tercer decimal y el grafo NPMI con overlap
1.000 — el determinismo del harness es precisamente lo que hizo posible auditarlo.

## 2. La re-evaluación limpia (mundo v1): el número defendible

Tras la auditoría se implementó la evaluación sin fugas: artefactos `--train-only`
(co-ocurrencia, prod2vec y popularidad construidos solo con eventos de train), modo
`--clean` en el harness (contexto pre-compra) y el baseline obligatorio
`popular-cohort-real` (cohorte inferida del train del usuario, sin oráculo). El
reporte oficial (`2026-06-08-thesis-f6-headtohead-n5000-seed123-full-clean.json`,
n=5000/seed=123, 2800 casos, marco *full*):

| Ranker | nDCG@10 | Lectura |
|---|---|---|
| `popular-cohort` (oráculo) | **0.053** | techo navegacional: conoce la subcategoría del ítem comprado |
| `f3-rrf` (campeón del pipeline) | **0.041** | **−21.2 %** vs el oráculo |
| `e2_hybrid` | 0.041 | empata como campeón limpio |
| `assembled-ltr-f4` (pipeline integrado) | 0.034 | −35.6 % vs el oráculo |
| `popular-cohort-real` (tienda normal honesta) | **0.016** | el baseline desplegable |

De aquí salen las dos afirmaciones vigentes, y solo estas:

- **Contra el oráculo de categoría, el pipeline pierde** (−21.2 %); el propio harness
  lo imprime: *"even the relevance-optimal pipeline config does NOT beat
  popular-cohort"*. La navegación es un rival serio: si el usuario ya está en la
  categoría correcta, ordenar por popularidad ahí es muy difícil de batir.
- **Contra lo que una tienda normal puede hacer de verdad** (sin bola de cristal),
  `f3-rrf` 0.041 vs `popular-cohort-real` 0.016 → **+156 % (×2.6)** (delta exacto
  sobre el JSON sin redondear: 0.0414/0.0160 = +159.6 %). Esta es la única
  afirmación defendible del head-to-head, y es mejor argumento que el "+74 %"
  retirado, porque sobrevive a la auditoría.

Hallazgos secundarios del mundo limpio: el retrieval por texto E0 fracasa
(0.011–0.013, ≈ `popular-cohort-real`; la señal robusta es conductual, no textual);
el segmento regalo colapsa a ~0.005 para todos los métodos personalizados (la
maquinaria de regalo no aporta valor medible); y la personalización conductual
multi-modo limpia (0.046) empata estadísticamente con el oráculo de categoría
(0.052, CI95 [−34 %, +15 %]) en el estudio exp-F.

## 3. El mundo v2: la ceguera a la popularidad

El mundo v1, aun limpio de fugas, seguía siendo irreal (popularidad plana). El
simulador v2 corrige el generador con mecanismos de la literatura: atractivo
intrínseco **Zipf** calibrado (s=1.0, η=0.7 → top-20 % de ítems = 70 % de las ventas,
Gini 0.71, vs 44 %/0.41 en v1), **elasticidad-precio** en P(cart/buy), prevalencia de
regalo realista (~8 %) y **elección estocástica** Plackett–Luce en lugar del argmax
oráculo. El reporte oficial sobre el dataset v2
(`2026-06-09-thesis-f6-headtohead-n5000-seed123-v2-full-clean.json`, 2252 casos):

| Ranker (v2, sin fugas) | nDCG@10 |
|---|---|
| `popular-cohort` (oráculo / navegación) | **0.262** |
| `popular-global` | 0.044 |
| `popular-cohort-real` | 0.016 |
| `f3-rrf` | **0.006** |
| `assembled-ltr-f4` | **0.000** |

En un mundo con best-sellers reales, **el pipeline actual colapsa**. No son bugs sino
mecanismos conocidos: (i) el coseno-a-modos es **ciego a la popularidad** — en
skip-gram los ítems ultra-frecuentes derivan hacia el centroide del espacio y el
retrieval personal los rankea bajo, justo cuando son lo que la gente compra; (ii) el
NPMI **descuenta la popularidad por construcción** (es la definición de PMI) —
excelente para complementos de nicho, fatal como fuente principal en mundo Zipf;
(iii) los modos se construían con ~2.8 *compras* de train cuando el historial correcto
es el de *vistas* (~25-30 ítems, lo que producción ya usa). El v2 introdujo además la
métrica de negocio correcta — **revenue realizado** (precio×margen de la compra
simulada capturada en el top-k) — y con ella el antiguo campeón `f4-revenue` obtiene
**0.0 centavos** de revenue realizado: optimizaba el espejismo de la métrica circular.

Los fixes están identificados y validados experimentalmente (exp-I): un prior
multiplicativo de popularidad en el retrieval (`coseno × log(2+pop)`) revive el camino
vectorial **×11** (0.001→0.011), y la mejor forma realista del feed frío — predecir
subcategorías desde las *vistas* y aplicar popularidad con cuotas dentro de ellas
(`pc-views-multi`) — rinde **×2.3** sobre `popular-cohort-real`. La lección de
producto: el home feed compite contra la navegación (el oráculo de categoría es
inalcanzable sin intención declarada); el lugar natural de la personalización fina es
la **página de categoría** (donde la cohorte-oráculo es legítima: la eligió el
usuario) y el **cross-sell en PDP/carrito** (el rol real del grafo NPMI).

## 4. Veredicto, limitaciones y camino

**Veredicto honesto.** No existe hoy evidencia de que el pipeline ensamblado venda más
que una tienda normal en un mundo realista; existe evidencia de que la personalización
conductual limpia rinde ×2.6 el baseline honesto en el mundo v1, y un diagnóstico
preciso —con fixes validados a escala de experimento— de por qué el diseño actual
falla en el mundo v2. Lo que sobrevive de la arquitectura: pool multi-fuente + RRF
(ningún reranker aprendido lo bate), multi-modo conductual, grafo NPMI para cross-sell,
filtros y prior por cohorte. Lo que cambia: prior de popularidad en el retrieval,
modos sobre vistas, revenue realizado como métrica, y el detector de regalo degradado
a *modo sugerido* (a prevalencia real su precisión es ~13 %).

**Limitaciones vigentes.** (i) Los datos siguen siendo sintéticos; el simulador v2
tiene una tensión de calibración documentada (concentración 72/28 vs proporción
in-taste) cuya salida de fondo es popularidad endógena en un loop cerrado. (ii) La
exposición aún no está mediada por el recomendador (sin position bias ni feedback
loop): cerrar el loop en simulación —slate + cascada— es el siguiente paso del
simulador. (iii) El LLM reranker sigue sin evidencia: o entra al head-to-head limpio
con su coste y latencia medidos, o sale del feed. (iv) Ninguna cifra de este programa
sustituye al experimento real.

**Camino.** Producción ya cuenta con exploración ε-greedy por slot y log de
impresiones con propensities exactas (`epsilon.ts`, migración `0023_feed_impressions`),
lo que desbloquea la evaluación off-policy (`ope.ts`: IPS/SNIPS/DR) sobre logs reales
y da la materia prima del **piloto A/B con clientes reales** — diseñado, no ejecutado,
y única validación que cuenta para el negocio. Criterio de éxito comprometido para
cualquier resultado futuro: **batir a `popular-cohort-real` Y a item-kNN con CI95 que
excluya 0** — nunca más a un baseline dopado. El resumen no técnico de este capítulo
está en `RESUMEN-EJECUTIVO.md`.
