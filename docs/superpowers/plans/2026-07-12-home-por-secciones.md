# Propuesta: la home de Tuki por secciones

Hoy la home es **una sola vitrina** (el catálogo personalizado) cortada visualmente en pedazos en la pantalla — por eso a veces se ve con solo 2-3 productos aunque haya 146 en el catálogo: si esa única lista viene corta, no hay nada más que mostrar debajo. La propuesta reemplaza eso por **5 vitrinas reales, cada una con su propia fuente y su propia regla de cuándo cambia** — así si una viene corta, las otras la sostienen.

## 1. La home propuesta, vitrina por vitrina

| # | Vitrina | Qué muestra | Cuándo cambia y cuánto |
|---|---|---|---|
| 1 | **Catálogo para ti** | Tu selección personalizada de hoy (lo que ya ves ahora) | Se recalcula cada 5 minutos o al recargar la página. Dentro de tu visita casi no se mueve (~70% se mantiene igual) para que no sientas que "salta" mientras navegas. |
| 2 | **Elegidos por Tuki** | Productos que TÚ eliges a mano — tu vitrina de curaduría | Solo cambia cuando tú la editas. Nunca se mueve sola. |
| 3 | **Lo último que viste** | Los productos que viste en esta sesión, más recientes primero | Se actualiza en cada visita según tu propio historial reciente. Si no has visto nada, no aparece (no se ve vacía ni rota). |
| 4 | **Lo más buscado** | Lo que más se ve y se compra en toda la tienda (barato primero entre empates) | Se recalcula solo cada 10-15 minutos con datos reales de ventas y clics. Nadie la edita a mano. |
| 5 | **Para ti** | Versión más simple de personalización: lo popular dentro de tu perfil de comprador (ej. "compradores como tú") | Se recalcula junto con la vitrina 4, cada 10-15 min. |
| 6 (fase 2) | **Recomendado por el asistente** | Productos que el agente automático propone (cross-sell, combos) | El agente solo puede proponer — no publica nada sin que tú apruebes. Cada propuesta caduca sola a los 7 días máximo. **No se activa en el lanzamiento**, se deja preparado para después. |

Ninguna vitrina se reordena mientras estás navegando: cada una se arma una sola vez al entrar a la home y no se vuelve a tocar hasta que recargas o vuelves a entrar (la única que se re-pide es la vitrina 1, al hacer scroll, y ahí sigue aplicando la misma regla de "no saltar").

## 2. Qué control tienes sobre cada una

| Vitrina | Tu control |
|---|---|
| Catálogo para ti | Ninguno manual — es automática. Tú la ves, no la editas. |
| Elegidos por Tuki | **Total.** Metes o sacas productos cuando quieras. Al lanzamiento, el cambio se hace por un comando directo a la base de datos (rápido, sin pantalla); más adelante se puede construir un botón para que lo hagas tú solo, sin depender de nadie. |
| Lo último que viste | Ninguno — es el historial propio de cada comprador, automático por diseño. |
| Lo más buscado | Indirecto: puedes apagar la vitrina completa si no te gusta, pero no eliges producto por producto — sale de ventas y vistas reales. |
| Para ti | Igual que la anterior: apagar sí, curar producto por producto no. |
| Recomendado por el asistente (fase 2) | Control total por producto: **aprobar, pausar o quitar** cada propuesta con un botón. Nada se publica sin tu aprobación al principio. Caduca sola. |

## 3. Qué se construye vs. qué ya existe (esfuerzo S/M/L)

La buena noticia: la mayor parte del motor **ya está hecho y corriendo**, solo no se está usando.

| Vitrina | Ya existe | Falta construir | Esfuerzo |
|---|---|---|---|
| Catálogo para ti | Todo (motor de personalización actual) | Nada | — (cero cambios) |
| **Cable principal**: que la home muestre más de una vitrina | El motor que arma varias vitrinas con prioridad y límites ya corre en cada visita — hoy se calcula y se **descarta** | Cambiar 2 archivos para que la pantalla pinte todas las vitrinas que el motor ya calcula, no solo la primera | **S** |
| Lo más buscado | Resuelto al 100% (cron de popularidad, ranking, todo) | Solo agregar 1 fila de configuración diciendo "esta vitrina va en la home" | **S** |
| Para ti (cohortes) | Mismo motor que "Lo más buscado", solo cambia el modo | 1 fila de configuración | **S** |
| Elegidos por Tuki | El sistema para guardar vitrinas fijas ya existe | Una pieza chica de código para leer tu lista + 1 comando para cargar tus productos elegidos | **S** |
| Lo último que viste | Ya se registra cada vista de producto | Una consulta chica (variación de una que ya existe) + la pieza para mostrarla como vitrina | **S/M** |
| Recomendado por el asistente | Todo el motor y las reglas de seguridad (tope de propuestas, caducidad, no toca vitrinas protegidas) ya están construidos, solo apagado | Falta la pantalla de aprobar/pausar/quitar (hoy no existe ninguna pantalla de administración) | **M** — se deja para después, no bloquea el lanzamiento |

**Nada de esto requiere reescribir el catálogo, el buscador ni el carrito.** Todo el trabajo es aditivo: se agregan vitrinas nuevas debajo de la que ya existe.

## 4. Orden recomendado para construirlo

1. **Abrir el cable principal** — que la home pinte todas las vitrinas que el motor ya calcula (hoy calcula y tira). Sin esto nada de lo siguiente se ve, aunque esté listo.
2. **Lo más buscado** — 1 línea de configuración, cero código nuevo. Gana diversidad visual inmediata con el trabajo más barato de todos.
3. **Elegidos por Tuki** — para que puedas empezar a curar tu vitrina de marca cuanto antes.
4. **Lo último que viste** — cierra la sensación de "la tienda me conoce".
5. **Para ti (cohortes)** — mismo motor del paso 2, otro modo.
6. **Recomendado por el asistente** — se deja para una segunda etapa, cuando exista la pantalla de aprobación. No se activa antes.

Cada vitrina se prende con **una sola fila de configuración**: si algo sale mal o viene vacía, esa vitrina simplemente no aparece — nunca rompe la página ni deja un hueco vacío. Se puede lanzar una por una y mirar cómo se ve antes de seguir con la próxima.

## 5. Qué pasa con la regla del 70%

Hoy el 70% es una regla **global** aplicada a la única vitrina que existe — por eso "no te cuadra": se siente como si toda la tienda se congelara, cuando en realidad solo hace falta para evitar que la vitrina personalizada salte mientras haces scroll.

**Recomendación: se conserva, pero SOLO dentro de la vitrina 1 (Catálogo para ti)** — ahí sigue siendo necesaria porque esa es la única que se vuelve a pedir mientras navegas (scroll infinito). Las otras 4 vitrinas nuevas se arman una sola vez por visita y no se vuelven a pedir — **no necesitan ninguna regla de estabilidad propia**, quedan quietas por cómo están construidas, sin código extra. Así la regla del 70% deja de sentirse como "la política de toda la tienda" y pasa a ser lo que realmente es: el comportamiento de una sola vitrina entre cinco.
