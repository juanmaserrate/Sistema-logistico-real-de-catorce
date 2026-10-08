# Plan: cerrar viajes sin depósito y rutas de a una en la app del celular

> **Para ejecutarlo, juanma dice: «activar plan modificacion».**
> Hasta entonces no se toca nada. Acordado el 8 de octubre de 2026.

---

## Qué pidió juanma

1. Poder finalizar el viaje desde el celular **sin que la última parada sea Real de Catorce**.
2. Si el viaje tiene dos o más rutas, **cerrar las primeras sin que termine el viaje**.
3. Al final de todo, que aparezca **VIAJE FINALIZADO**.
4. Ver **cuántas horas se hicieron en cada ruta y en total**.

## Decisiones que ya tomó

| Tema | Decisión |
|---|---|
| Quién puede cerrar el viaje en cualquier lado | **El chofer, en el momento.** Botón siempre disponible, no hace falta que lo habilite el operador. |
| El reloj entre rutas | El total del viaje corre de corrido; **cada ruta se consolida al cerrarla** y no se mueve más. |
| Cerrar una ruta con paradas sin marcar | **Sí, pero con motivo.** |
| Dónde ver las horas | **Planilla semanal + Historial de Rutas + export a Excel.** |
| La vuelta al depósito en la tabla de horas | **Línea aparte**, no dentro de la última ruta. |
| Parada pospuesta («vuelvo después») | La ruta **se cierra igual con motivo**; la parada sigue siendo de su ruta y se marca «fuera de ruta» cuando se entrega. |

---

## Cómo funciona hoy (verificado, con archivo:línea)

Esto está confirmado leyendo el código. No hace falta volver a investigarlo.

### La app móvil trabaja con `Route`/`Stop`, no con `Trip`/`TripStop`

`TripStop` es un modelo paralelo legacy que el chofer nunca toca. Todo lo que marca
el chofer vive en `Stop`, que cuelga del `Route` vinculado al `Trip`.

### Un viaje tiene UN solo recorrido

`Route.tripId Int? @unique` (`server/prisma/schema.prisma:142`). Un `Trip` tiene como
máximo un `Route`, con **un solo par** `actualStartTime` / `actualEndTime`
(`schema.prisma:145-146`). Hoy no hay dónde guardar horarios por ruta.

### No hay ningún botón de finalizar: lo cierra la parada del depósito

- `tryCloseRouteIfComplete()` — `server/src/index.ts:4668-4752`. Es **el** camino de cierre.
  - No cierra si queda alguna parada en `PENDING`/`ARRIVED`/`RETRY` (4675-4692).
  - Busca la base por `isReturnToBase`, con fallback al último stop cuyo nombre matchee
    `isBaseStopName` (4696-4698). **Si no hay base, devuelve `false` y el viaje queda abierto.**
  - `closeAt = base.actualDeparture || base.actualArrival || now` (4701) ← la hora del cierre
    es la hora de la vuelta al depósito.
  - Escribe `Route.actualEndTime` + `status='COMPLETED'`, y en `Trip`:
    `status='COMPLETED'`, `completedAt`, **`returnTime`** (4728-4746).
- Se dispara después de CUALQUIER parada marcada: `PATCH /api/v1/stops/:id`
  → `server/src/index.ts:8289-8295`.

### El servidor AGREGA el depósito al final, siempre

`guardarParadasDelViaje` empuja el cliente base al final de `clientIds` si no estaba
(`server/src/index.ts:9703-9717`), y **solo la última ocurrencia lleva `isReturnToBase: true`**
(9771). Misma regla en bulk (9975) y en plantilla (5481).

Por eso hoy es imposible armar un viaje que no termine en Real de Catorce.

### En el celular no hay validación bloqueante

`isBaseStop()` (`mobile/src/screens/TrackScreen.tsx:71-79`) e `isBase`
(`mobile/src/components/StopDeliveryModal.tsx:277`) **solo cambian textos, iconos y la
visibilidad de la solapa «Vuelvo»**. El chofer puede marcar cualquier parada en cualquier
orden. Quien decide el cierre es el servidor.

Botones de hoy:
- «Registrar llegada» → `patchStop(status:'ARRIVED', actualArrival)` — TrackScreen:1092-1098, 306-330.
- «Finalizar entrega» / «Finalizar viaje» (el de la parada base) → abre `StopDeliveryModal`
  → `patchStop(status:'COMPLETED', actualDeparture, ...)` — TrackScreen:1099-1111,
  StopDeliveryModal:159-190, 522.
- `offerCloseAtBase()` — TrackScreen:662-705. Atajo al fichar salida. **Si no hay parada base,
  devuelve `false` y no ofrece nada** (666-667).
- «Fichar salida» (`action:'end'`) **no persiste nada**: `server/src/index.ts:3953-3975`.

### Las colas offline ya existen

- Paradas: `mobile/src/api.ts:387-446` (`flushStopQueue`).
- Fichadas: `mobile/src/api.ts:624-686` (`flushPunchQueue`), con el `at` calculado en el
  celular (780-783) para conservar la hora real.

### Dónde se calcula la duración hoy

- `GET /api/v1/history/completed-routes` — `server/src/index.ts:2995-3063`.
  `durationMin` sale 100% de `Route.actualStartTime` / `actualEndTime` (3030-3034).
- `parseTripDurationHrs()` — `server/src/index.ts:9226-9251`. Cascada:
  route start/end → `exitTime`/`returnTime` como fecha → los mismos como texto `HH:mm` → fallback.
  Lo usa el Motor de Costos (`9455`, `9486`).

### El campo `rutas` (agregado el 7-oct-2026)

`Trip.rutas Json?` — `server/prisma/schema.prisma:259-262`. Lista ordenada
`["R8","R12","CIC 1"]`. **Solo lo usa el front web**; la app móvil no lo recibe (el `select`
de `trip` en `GET /api/v1/routes` no lo incluye — `server/src/index.ts:3814`).
Único punto de escritura: `server/public/planificacion.html:23333`.

---

## El plan

### Pieza 1 — Botón FINALIZAR VIAJE en el celular

Botón propio, siempre a la vista, que no depende de ninguna parada. Cierra el viaje con
la hora del momento, esté donde esté el chofer.

- Si quedan paradas sin marcar (el depósito incluido), **pide el motivo** antes de dejar cerrar.
  El motivo se guarda y se ve desde la oficina.
- El depósito sigue apareciendo como última parada. Lo que cambia es que ya no es obligatorio.
- **Tiene que escribir los mismos campos que `tryCloseRouteIfComplete`**, incluido
  `Trip.returnTime`, o el Motor de Costos pierde el viaje.

### Pieza 2 — Cerrar las rutas de a una

Hace falta que cada parada sepa de qué ruta es: **campo nuevo en `Stop`** (ej. `ruta String?`).
La web ya tiene el dato (`tripDeliveryRows[i].ruta` en `planificacion.html`), lo pierde al
guardar. Hay que persistirlo en `guardarParadasDelViaje`
(`server/src/index.ts:9670-9795`), en el bulk (9955-9975) y en la plantilla (5471-5481).

En el celular las paradas se ven agrupadas, con un botón de cierre por ruta:

```
━━ RUTA 1 · R8 ━━━━━━━━━━━━━━━━━
  ES.28   ✓ entregada
  EP.25   ✓ entregada
        [ TERMINÉ R8 ]
━━ RUTA 2 · R12 ━━━━━━━━━━━━━━━━
  ...
━━ VUELTA AL DEPÓSITO ━━━━━━━━━━
  Real de Catorce
```

- **Si el viaje tiene UNA sola ruta, no aparece ningún botón de cerrar ruta.** Funciona igual
  que hoy, con FINALIZAR VIAJE agregado. Es la enorme mayoría de los viajes: no hay que
  agregarles un paso.
- Solo se puede cerrar la ruta abierta (la primera sin cerrar), no saltear.
- **Cerrar la última ruta NO cierra el viaje**: todavía falta la vuelta al depósito.

### Pieza 3 — Guardar las horas por ruta

Tabla nueva chica: por cada viaje, cada ruta con su hora de inicio y de fin.

Regla de tiempo:

| | |
|---|---|
| Ruta 1 | arranca cuando arranca el viaje (`Route.actualStartTime`) |
| Ruta N+1 | arranca justo cuando se cerró la ruta N — sin huecos |
| Vuelta al depósito | arranca cuando se cierra la última ruta |
| Fin del viaje | cuando se marca el depósito, o se aprieta FINALIZAR VIAJE |

**rutas + vuelta = total del viaje.** Una ruta cerrada no se mueve más.

> Ojo: si el chofer nunca fichó entrada, `Route.actualStartTime` se infiere recién al cerrar
> (`server/src/index.ts:4704-4712`). Hasta entonces la ruta 1 no tiene hora de inicio.

### Pieza 4 — Mostrar las horas

| Dónde | Cómo |
|---|---|
| **Semanal** | En el detalle que se despliega con la flechita (`toggleWeeklyTripStopsRow`, `planificacion.html:13840`), una tablita con cada ruta, la vuelta al depósito y el total. |
| **Historial de Rutas** | Lo mismo en HDR (`loadHdrList`, `planificacion.html`). |
| **Excel** | **Una columna nueva AL FINAL** con el detalle (`R8 2:10 · R12 1:45 · CIC 1 0:50 · vuelta 0:35`). La columna «Duracion horas» que ya existe sigue siendo el total. |

**La columna del Excel va al final, nunca en el medio.** La plantilla
`server/templates/plantilla_viajes.xlsx` tiene una tabla dinámica que referencia los campos
**por número de posición** (rowFields 4, colFields 10, dataFields 0 y 29, pageFields 9 y 2).
Insertar en el medio desalinea todo el informe. Hay que actualizar `ULTIMA_COLUMNA` en
`server/src/libroViajes.ts:28` (hoy `'AF'`, 32 columnas) y `COLUMNAS_LIBRO` (32-40).

Ejemplo de cómo queda el informe:

```
R8   2:10   9 paradas · 8 entregadas · 1 fuera de ruta
R12  1:45   10 paradas · 10 entregadas
             ES.28 (de R8) entregada 14:20, dentro de R12
Vuelta al depósito  0:35
─────────────────────────────
Total viaje         5:20
```

---

## Los bordes que hay que cuidar

1. **Sin señal.** Cerrar ruta y finalizar viaje tienen que entrar en las colas offline que ya
   existen (`flushStopQueue`, `flushPunchQueue`), con el `at` calculado en el celular. Si no,
   un cierre en un sótano se pierde o queda con la hora equivocada.

2. **Reordenar paradas.** Hoy el chofer puede arrastrar cualquier parada a cualquier lado
   (`mobile/src/components/ReorderModal.tsx`, la base queda afuera — línea 46). Hay que
   limitarlo a mover **dentro de su propia ruta**, o el agrupado deja de tener sentido.

3. **Paradas pospuestas.** `POST /api/v1/stops/:id/retry-later`
   (`server/src/index.ts:8593-8673`) manda la parada para atrás. La ruta se cierra igual con
   motivo; la parada sigue siendo de su ruta y, al entregarse, se marca **«fuera de ruta»**
   en el informe, con la hora real y la ruta en la que cayó.

4. **El Motor de Costos.** El cierre por depósito escribe `Trip.returnTime`
   (`index.ts:4739`); el cierre del operador desde la web **no lo escribe**
   (`index.ts:10148-10151`). Es una inconsistencia que **ya existe hoy**. El botón nuevo lo va
   a escribir, y de paso hay que arreglar el camino del operador.

5. **Editar un viaje ya empezado.** `guardarParadasDelViaje` reutiliza los stops existentes
   para no perder el progreso del chofer (9719-9795), con el guard `X-Force-Replace`. Agregar
   una ruta a un viaje en curso tiene que **agregar al final**, no rearmar.

6. **Viajes viejos.** Los que ya están cerrados no tienen horas por ruta: muestran solo el
   total, como ahora. No se toca nada de lo que ya está.

7. **Bug chico que apareció de paso.** El celular no reconoce la parada escrita como `R14`
   (`TrackScreen.tsx:78` cubre solo «REAL DE CATORCE» y «DEPOSITO»), pero el servidor sí
   (`index.ts:4630`). Emparejarlos.

---

## Lo que juanma tiene que saber antes de arrancar

**Esto toca la app del celular.** No alcanza con subir el cambio al servidor: hay que publicar
una versión nueva a los teléfonos de los choferes (canal `preview`, rama `production` —
ver `project_r14_eas_canales`). Los choferes tienen que actualizar.

**Orden sugerido de ejecución**, para que nada quede a medias en producción:

1. Base de datos: campo `ruta` en `Stop` + tabla de horas por ruta.
2. Servidor: persistir la ruta de cada parada, endpoint de cerrar ruta, endpoint de finalizar
   viaje, arreglo del `returnTime` del operador.
3. Web: mostrar las horas en semanal, HDR y Excel. **Hasta acá no se rompe nada de lo que
   funciona hoy** y se puede verificar sin tocar los celulares.
4. App móvil: agrupado por ruta, botón de cerrar ruta, botón FINALIZAR VIAJE, colas offline,
   límite del reordenar.
5. Publicar la versión nueva a los teléfonos.
