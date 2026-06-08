# Un vendedor experto dentro del e-commerce
## Resumen ejecutivo — en lenguaje claro, sin tecnicismos

> **En una frase:** construimos un "cerebro de recomendación" para una tienda online
> y lo pusimos a competir, en igualdad de condiciones, contra la forma en que una
> tienda online **normal** ordena sus productos. Ganó — y, lo más importante, **gana
> por MÁS margen mientras más grande es el catálogo**, que es justo el caso de una
> tienda que revende el catálogo de Amazon/AliExpress.

---

## 1. El problema, en simple

Esta tienda es un **revendedor para Cuba**: no tiene almacén ni stock físico; toma el
catálogo gigante de Amazon/AliExpress y se lo ofrece al cliente. Como cada venta se
gestiona contra un proveedor externo, **cada recomendación que el cliente ignora es
dinero y confianza que se pierden**. Acertar con lo que le muestras a cada persona no
es un lujo: es el negocio.

Una tienda online **normal** resuelve esto de la forma más sencilla: muestra **lo más
popular de cada categoría**. Funciona… hasta cierto punto. Es como una tienda física
que pone en la vitrina "lo que más se vende" y espera que a ti te sirva.

## 2. La idea, con una analogía

| | Tienda **normal** | Lo que **construimos** |
|---|---|---|
| Cómo decide qué mostrarte | "Esto es lo más popular en esta categoría" | "Entiendo **a ti**: tus gustos, si compras para otra persona, qué cosas combinan, y qué te conviene" |
| Es como… | Un **estante ordenado por ventas** | Un **vendedor experto** que te conoce y te asesora |
| Cuándo se equivoca | Cuando tú no eres "el cliente promedio" | Menos seguido — y aún cuando duda, tiene varias formas de acertar |

La tienda normal trata a todos igual. Nuestro sistema trata a cada cliente como una
persona distinta.

## 3. Qué hace distinto (sus 4 "sentidos")

1. **Entiende la intención, no solo la moda.** En vez de "lo más vendido", arma el
   surtido a partir de **tu** comportamiento y el de gente parecida.
2. **Detecta cuando compras un regalo.** Si tu sesión "se siente" como una compra para
   otra persona (p. ej., un hombre mirando ropa de niña), cambia el chip y recomienda
   **para el destinatario**, no para ti.
3. **Descubre productos que combinan.** Hay relaciones que las palabras no capturan: un
   *celular* y su *funda* no se "parecen" en su descripción, pero van juntos. El sistema
   aprende esas combinaciones a partir de lo que la gente compra junto. **Esta pieza
   sola rescata ~1 de cada 3 compras** que el método por "parecido de texto" jamás
   encontraría.
4. **Equilibra "lo más relevante" con "lo que más conviene vender".** Tiene una
   **palanca** de negocio: puede priorizar puro acierto, o inclinar la balanza hacia
   mayor margen/ingreso — de forma medida y transparente, no a ciegas.

## 4. Cómo lo probamos (para que el resultado sea creíble)

No nos creímos el cuento solo. Construimos un **mercado simulado con verdad conocida**
(catálogo, clientes, sesiones de compra) y un **juez imparcial** que mide, sobre
**exactamente los mismos clientes y los mismos productos**, qué tan bien ordena cada
sistema. Es una carrera en el mismo carril para ambos: la tienda normal y la nuestra.

> La métrica clave, en cristiano: **"¿qué tan arriba, en los primeros 10 resultados,
> aparece lo que el cliente realmente terminó comprando?"** Más alto = mejor.

## 5. El resultado principal

Sobre el surtido completo (lo que el cliente ve de verdad), **nuestro sistema acierta
más Y vende más** que la tienda normal. Pero lo más valioso es **cómo cambia con el
tamaño del catálogo**:

| Tamaño del catálogo | Tienda normal (aciertos) | Nuestro sistema (aciertos) | **Cuánto mejor** | Venta potencial |
|---|---|---|---|---|
| 2.000 productos | 0,177 | 0,200 | **+13 %** | +162 % |
| 5.000 productos | 0,092 | 0,149 | **+63 %** | +185 % |
| 10.000 productos | 0,065 | 0,111 | **+71 %** | +226 % |

**Lee la columna del medio de arriba abajo:** mientras más crece el catálogo, **peor le
va a la tienda normal** (su truco de "lo popular de la categoría" se diluye cuando hay
miles de productos por categoría), y **mejor se sostiene el nuestro**. Por eso la
ventaja salta de **+13 % a +71 %**. 

> **Por qué importa tanto para esta tienda:** un revendedor del catálogo de
> Amazon/AliExpress vive precisamente en el extremo derecho de esa tabla — **catálogo
> enorme**. Ahí es donde el sistema inteligente más se despega.

Y si se activa la **palanca de negocio**, la venta potencial del top-10 puede subir
varias veces (hasta **+5×** frente a la tienda normal) a cambio de algo de precisión —
una decisión consciente, no un accidente.

**¿Es suerte de una corrida?** No. Repetimos todo el experimento con **tres semillas
aleatorias distintas** y el resultado se mantiene (la ventaja queda en el rango
**+55 % a +75 %**). Es un patrón, no una casualidad.

## 6. Honestidad: lo que NO funcionó (igual de importante)

Un estudio serio reporta también sus límites:

- **El detector de regalos es flojo** (acierta poco más de la mitad de las veces).
  Cuando se equivoca, el sistema "degrada con gracia" (vuelve al modo normal), pero hay
  margen claro de mejora. Probamos una mejora y **no ayudó** — lo decimos tal cual.
- **El "reordenador inteligente" no le gana al método simple de mezcla** en puro
  acierto. El mérito está en **cómo se arma el surtido** (la búsqueda), no en el
  reordenado final. *(Curiosamente, el reordenador enfocado en ingreso sí empieza a
  ganar cuando el catálogo es muy grande.)*
- **Son datos simulados.** Reproducen patrones realistas y el experimento es riguroso,
  pero la validación definitiva sería un **piloto A/B con clientes reales** (ya está
  diseñado, falta ejecutarlo).

Decimos esto con la misma fuerza que los resultados positivos: la credibilidad del
trabajo depende de no esconder lo que falta.

## 7. Qué significa para el negocio

- **Más aciertos = más conversión y mejor experiencia.** El cliente encuentra antes lo
  que quiere; menos llamadas costosas al proveedor por recomendaciones que nadie compra.
- **La ventaja crece con el catálogo**, justo donde esta tienda opera. Escalar el
  surtido **no diluye** al sistema; lo potencia.
- **Una palanca de ingreso medible.** El negocio puede decidir, con números, cuánto
  inclinar la balanza hacia margen sin volar a ciegas.
- **Rápido.** Todo el proceso de recomendación corre en milisegundos (muy por debajo de
  cualquier umbral de experiencia de usuario), así que es viable en producción.

---

### En una línea para la gerencia
> Frente a un e-commerce normal y en igualdad de condiciones, este sistema **acierta y
> vende más, y su ventaja se agranda con catálogos grandes** — el escenario real del
> negocio. Con límites honestos (detector de regalos por pulir y un piloto real
> pendiente), es una mejora defendible, medida y lista para pilotar.

<sub>Documento ejecutivo del programa de validación F6. Cada cifra es trazable a
reportes técnicos verificados (`docs/superpowers/reports/2026-06-08-thesis-f6-*`).
Comparación "cara a cara" sobre idénticos clientes, productos y división de datos.</sub>
