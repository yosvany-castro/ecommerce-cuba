# Un vendedor experto dentro del e-commerce
## Resumen ejecutivo — en lenguaje claro, sin tecnicismos

> **En una frase:** construimos un "cerebro de recomendación" para la tienda, lo
> pusimos a prueba, celebramos los resultados… y luego una auditoría interna descubrió
> que **el examen estaba filtrado**. Este documento cuenta la historia completa — los
> números retirados, los números reales, y por qué el proyecto sale **más fuerte**,
> no más débil, de haberse auditado a sí mismo.

---

## 1. Qué construimos y qué creíamos

Esta tienda es un **revendedor para Cuba**: no tiene almacén; ofrece el catálogo
gigante de Amazon/AliExpress. Cada recomendación fallida cuesta dinero y confianza,
así que construimos un sistema que intenta entender a cada cliente — sus gustos, si
compra un regalo, qué productos combinan — en lugar de mostrar a todos "lo más
popular".

Para probarlo montamos un mercado simulado y una competencia "en el mismo carril"
contra la forma en que ordena una tienda normal. La primera versión de este documento
reportaba que nuestro sistema ganaba, y que su ventaja **crecía con el tamaño del
catálogo** (de +13 % hasta +71 % de aciertos, y cifras de venta potencial varias veces
mayores). Esas cifras **quedan retiradas**. No eran reales.

## 2. La auditoría: el examen estaba filtrado

Antes de dar el trabajo por bueno, lo sometimos a una **auditoría destructiva**: un
revisor con la misión explícita de romper los resultados. Y los rompió. En esencia,
encontró cuatro problemas:

1. **El sistema había visto las respuestas.** Una analogía: es como evaluar a un
   estudiante con un examen cuyas preguntas estaban en el material con el que estudió.
   Parte de los datos con los que el sistema "aprendía" incluía, sin que nadie lo
   notara, las mismas compras que después debía adivinar. Cuando se le quita ese
   acceso, la ventaja que creíamos ver desaparece — y la famosa "ventaja que crece con
   el catálogo" resultó ser el error creciendo, no el sistema mejorando.

2. **El medidor de ventas se medía a sí mismo.** La cifra de "venta potencial" usaba
   la propia opinión del sistema sobre qué le gusta al cliente. Un truco burdo —
   mostrar siempre lo más caro, sin personalizar nada — sacaba mejor nota en ese
   medidor que nuestro sistema. Un medidor que premia eso no mide ventas.

3. **El mundo simulado estaba hecho a la medida.** En el mercado de prueba no había
   "productos estrella" (en la realidad, una fracción pequeña del catálogo concentra
   la mayoría de las ventas). Eso debilitaba artificialmente al rival y favorecía al
   nuestro.

4. **Al rival también lo habíamos dopado.** La "tienda normal" de la comparación
   recibía una pista que ninguna tienda real tiene (la categoría exacta de lo que el
   cliente iba a comprar). O sea: la carrera publicada era trampa contra trampa.

Importante: la auditoría también verificó que **no hubo mala fe** — pudo reproducir
todos nuestros números al detalle precisamente porque el trabajo estaba bien
documentado. Los errores son de los clásicos en este campo; lo poco común es
encontrarlos uno mismo y publicarlos.

## 3. Los números reales (con el examen limpio)

Corregido el método de medición — el sistema ya no ve las respuestas, el rival ya no
tiene pistas — la foto honesta es esta:

- **Contra una tienda normal realista** (la que muestra lo popular según lo que de
  verdad sabe del cliente), nuestro sistema acierta **2,6 veces más** (+156 %). Esta
  es la afirmación defendible del proyecto, y sobrevivió a la auditoría.
- **Contra la navegación, pierde.** Si el cliente simplemente hace clic en la
  categoría correcta y mira lo popular ahí, eso le gana a nuestro feed (−21 %).
  Lección de producto: la personalización no debe competir contra el clic en la
  categoría, sino trabajar **dentro** de la página de categoría y en el
  "combina con tu compra".

## 4. El segundo descubrimiento: le faltaba un ingrediente

Después arreglamos también el mundo simulado para que se parezca a la realidad (con
productos estrella, sensibilidad al precio, regalos en proporción real). Y ahí
apareció el hallazgo más valioso: **nuestro sistema era ciego a la popularidad**.
Estaba tan enfocado en "lo que se parece a tus gustos" que rankeaba bajo los
best-sellers — justo lo que la gente más compra. En ese mundo realista, el sistema
actual colapsa frente a la navegación.

La buena noticia: el diagnóstico es preciso y los arreglos ya están probados en
experimento. Añadir el ingrediente de popularidad a la receta multiplica el
rendimiento del camino personalizado **por 11**, y la mejor versión realista de la
página de inicio (predecir qué categorías te interesan por lo que miraste, y mostrar
lo popular dentro de ellas) rinde **2,3 veces** la tienda normal. El sistema no estaba
mal concebido; estaba cocinado para un mundo que no era el real, y ya sabemos
exactamente qué cambiarle.

## 5. Qué vale de todo esto

- **El método de medición ya está corregido y blindado.** Cualquier cifra futura
  saldrá de un examen limpio, con la regla comprometida de que solo se declara
  victoria si se le gana al rival honesto con significancia estadística.
- **La arquitectura sobrevive.** Las piezas centrales (entender varios gustos por
  cliente, combinar varias fuentes de candidatos, los productos que combinan para el
  "compra esto también") siguen siendo las correctas; lo que cambia es la receta.
- **La honestidad es el activo.** Un trabajo que solo reporta éxitos no es creíble.
  Este encontró sus propios errores, los cuantificó, los publicó y corrigió el método.
  Eso es exactamente lo que un inversionista, un tribunal o un gerente deberían
  exigir.

## 6. Qué sigue

1. **Cerrar el circuito en el simulador**: que el cliente simulado vea lo que el
   recomendador le sirve (como en la vida real), para medir el efecto de verdad.
2. **Medir en producción sin riesgo**: la tienda ya registra qué se mostró y por qué,
   con una pequeña dosis de variedad controlada — la materia prima para evaluar con
   datos reales.
3. **El veredicto final: un piloto A/B con clientes reales.** Mitad de los clientes
   con el sistema nuevo (ya corregido), mitad con la tienda normal, y que decidan las
   ventas reales. Está diseñado; ejecutarlo es el siguiente hito.

---

### En una línea para la gerencia
> Creímos tener un sistema ganador; una auditoría propia demostró que la medición
> estaba viciada. Con la medición limpia, el sistema **gana 2,6 veces a una tienda
> normal realista** pero **pierde contra la navegación**, y descubrimos —y ya sabemos
> corregir— que le faltaba el ingrediente de popularidad. El método de prueba quedó
> blindado y el plan es validarlo donde único cuenta: **un piloto con clientes
> reales**.

<sub>Documento ejecutivo del programa de validación F6 + auditoría. Cifras trazables a
`docs/auditoria-destructiva-f6-2026-06-09.md` y a los reportes limpios
`docs/superpowers/reports/2026-06-08-thesis-f6-headtohead-n5000-seed123-full-clean.json`
y `2026-06-09-thesis-f6-headtohead-n5000-seed123-v2-full-clean.json`. Las cifras de la
versión anterior de este documento están retiradas y no deben citarse.</sub>
