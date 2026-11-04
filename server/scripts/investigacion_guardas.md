# Investigación: por qué no alcanzaron las guardas que ya existen

Fecha: 4 nov 2026. Fuente: `server/src/index.ts` (16.700 líneas, rama `main`,
último commit `81dabff`), `server/public/planificacion.html`, `mobile/src`,
historia de git y datos de producción leídos con los endpoints `/api/admin/*`
(clave de servicio). **No se aplicó ningún cambio en `index.ts`.**

---

## (a) Los nueve viajes duplicados del 27/10

### Qué se encontró en producción

- La auditoría tiene el borrado: `DELETE trip · "9 viaje(s) borrados a mano"`,
  3 nov 17:50:53Z, IP 190.104.219.130, sin usuario (endpoint con clave),
  `before.ids = [9446, 9510, 9553, 9596, 9618, 9640, 9662, 9684, 9727]`,
  respaldo en `AppSettings` clave `viajes_backup_2026-11-03T17-50-53-347Z`.
- Esos nueve ids **no son consecutivos: van de a 22 o de a 43 (= 21 + 22)**.
  Los vecinos todavía existen y cuentan la historia completa
  (`GET /api/admin/paradas-de-viajes?ids=...`):

  | ids | qué son |
  |---|---|
  | 9425 … 9445 | R12, 21 días hábiles de noviembre (11/11 … 27/11) |
  | **9446** | R12 **27/10** (borrado) |
  | 9489 … 9509 | R1, 2/11 … 30/11 (21 viajes) |
  | **9510** | R1 **27/10** (borrado) |
  | 9511 … 9531 | R2, 2/11 … 30/11 (21, sin duplicado) |
  | 9532 … 9552 | R3, 2/11 … 30/11 |
  | **9553** | R3 27/10 (borrado) |
  | 9575 … 9595 | R5, 2/11 … 30/11 (9575 = R5 2/11, creado 27/10 **18:46:14Z**, lo borró Prscila Lopez el 2/11) |
  | **9596** | R5 27/10 (borrado) |
  | 9597…9617 + **9618** | R6 noviembre + R6 27/10 |
  | 9619…9639 + **9640** | R7 noviembre + R7 27/10 |
  | 9641…9661 + **9662** | R9 noviembre + R9 27/10 |
  | 9663…9683 + **9684** | R10 noviembre + R10 27/10 |
  | 9685 … 9705 | R8 noviembre (21, sin duplicado) |
  | 9706…9726 + **9727** | R11 noviembre + R11 27/10 |
  | 9728 | LIBRE 28/10 de Galarza: ya es otra cosa |

  Noviembre 2026 tiene exactamente **21 días hábiles**. Cada reparto es un
  bloque de 21 viajes de noviembre y, **detrás** de ese bloque, el viaje del
  27/10. Un bloque por reparto, uno cada 1-3 minutos.

### Qué camino los creó

**`POST /api/v1/trips/bulk` (línea 16036), desde la pantalla de planificación
("crear varios días"), con el reintento `permitirDuplicado: true`.** Las
pruebas:

1. Un bloque de 21 viajes con ids consecutivos solo lo produce
   `createManyAndReturn` (un INSERT con todas las filas, línea 16117).
   `POST /api/v1/trips` crea de a uno (ids salteados por otros usuarios),
   `create-trip-from-template` crea uno por llamada, y
   `crear-viajes-faltantes` crea todos los repartos en una sola corrida de
   segundos (no uno por reparto cada 1-3 minutos). `routes-direct` (3803) ni
   siquiera crea `Trip`: solo `Route` con `tripId: null`.
2. La web arma los payloads **ordenados por fecha ascendente**
   (`planificacion.html` 4583 `ntFechasSeleccionadas() = [..._ntFechas].sort()`
   y 28263 `targetDates.map(...)`). Si el 27/10 hubiera entrado en la misma
   tanda, sería el **primer** id del bloque. Es el **último**: lo creó una
   **segunda llamada**, posterior a los 21 de noviembre. Esa segunda llamada
   es exactamente `_crearEnTanda` (28430-28470): el servidor contesta
   `indicesRepetidos: [i]`, la web pregunta
   `"1 de los 22 ya están cargados. ¿Los cargo igual? (solo si es una salida
   extra del mismo reparto y chofer)"` y, con OK, **reenvía solo esos con
   `permitirDuplicado: true`** → el servidor saltea el control (16055
   `if (!permitirDuplicado)`) y los inserta.
3. Por qué el 27/10 estaba elegido: al abrir el modal de viaje nuevo la web
   preselecciona **hoy** (27775 `ntCalInit([today])`), y el botón "Lun a Vie"
   (4716 `ntCalLunAVie`) **agrega** los hábiles del mes que se mira **sin
   limpiar** lo que ya estaba. Resultado: 27/10 + 21 de noviembre = 22 días.
   El aviso ámbar del calendario (`_ntViajeIgual`, 4619) solo mira
   `planningData`, o sea la semana que la pantalla tiene cargada: mirando
   noviembre, el R1 del 27/10 no está en memoria y no avisa.
4. `isManual: false` es lo que manda el formulario web (casilla sin tildar).
   El `create-trip-from-template` tampoco lo manda (queda el default), así que
   ese dato no distingue; lo distingue la estructura de ids.

**Quién**: la tanda escribe en la auditoría
`CREATE trip 0 · "21 viajes en una tanda"` y luego `"1 viajes en una tanda"`,
con `userName` = cabecera `x-actor-name` (el operador logueado). Esas filas
son del 27/10 18:29-18:55Z y **no se alcanzan con los endpoints que hay**:
`GET /api/admin/auditoria` (9886) devuelve como máximo 200 filas ordenadas
desde ahora hacia atrás (llega hasta el 2/11 08:06Z) y
`GET /api/admin/recent-trip-changes` (9936) tope 72 h. `GET /api/v1/audit`
(390) sí filtra por `from/to`, pero pide sesión (`PROTECTED_PREFIXES`, 205).
Para cerrar el nombre: SQL
`SELECT "createdAt","userName","entityName","after" FROM "AuditLog" WHERE entity='trip' AND "createdAt" BETWEEN '2026-10-27 18:00' AND '2026-10-27 19:30' ORDER BY "createdAt"`,
o agregarle `desde/hasta` a `/api/admin/auditoria` (texto abajo). Lo único
que se sabe del actor por los datos: el R5 2/11 de esa misma tanda (9575) lo
borró después Prscila Lopez.

### Qué compara `viajeYaCargado` (12982) y si los nueve habrían pasado

Compara **día UTC + reparto + chofer + vuelta** (vuelta `null` cuenta como 1),
todo normalizado (mayúsculas, sin tildes, espacios). **No** mira hora, estado,
`assignedMobileUser` ni si el viaje de ese día ya terminó. La tanda usa la
misma clave en memoria (`claveDe`, 16043).

Los nueve eran mismo día, mismo reparto, mismo chofer, vuelta 1: **la guarda
los detectó** (por eso hubo reintento). Falló lo que viene después: la
pregunta genérica de la web y un `permitirDuplicado` que **no exige motivo, no
queda en la auditoría como tal y no mira que el viaje "repetido" ya se hizo a
la mañana** (los R del 27/10 estaban COMPLETED cuando se crearon los dobles,
18:29-18:55Z = 15:29-15:55 de Buenos Aires).

### Qué caminos NO pasan por `viajeYaCargado`

| camino | control de repetido |
|---|---|
| `POST /api/v1/trips` (13003) | `viajeYaCargado`, salvo `permitirDuplicado: true` (13026) |
| `POST /api/v1/trips/bulk` (16036) | copia propia en memoria con la misma clave (16043-16065), salvo `permitirDuplicado: true` |
| `POST /api/admin/create-trip-from-template` (6435) | **ninguno**: crea aunque ya exista el reparto ese día |
| `POST /api/admin/crear-viajes-faltantes` (6583) | propio, por `reparto|día` (6628 `yaEsta`), sin chofer ni vuelta: más estricto, no deja huecos |
| `POST /api/v1/routes-direct` (3803) | no crea viajes |

### Qué habría que cambiar en `index.ts` (texto, sin aplicar)

**1. `permitirDuplicado` con motivo, con auditoría y sin pisar un viaje ya
hecho.** En `POST /api/v1/trips`, reemplazar 13026-13038 por:

```ts
        const repetido = await viajeYaCargado(datos);
        if (repetido) {
            const cuando = new Date(repetido.date).toISOString().slice(0, 10).split('-').reverse().join('/');
            const motivo = String(req.body?.motivoDuplicado || '').trim();
            // Un viaje que ya se hizo (cerrado) no se vuelve a cargar: eso es
            // un doble, no una salida extra. Una salida extra lleva vuelta 2.
            const yaHecho = String(repetido.status || '').toUpperCase() === 'COMPLETED';
            if (req.body?.permitirDuplicado !== true || !motivo || yaHecho) {
                return res.status(409).json({
                    error: yaHecho
                        ? `El ${repetido.reparto || 'reparto'} con ${repetido.driver || 'ese chofer'} del ${cuando} ya se hizo y está cerrado (#${repetido.id}). Si fue una salida extra, cargala con vuelta 2.`
                        : `Ya hay un viaje cargado del ${repetido.reparto || 'reparto'} con ${repetido.driver || 'ese chofer'} el ${cuando}`
                          + (repetido.vuelta && repetido.vuelta > 1 ? ` (vuelta ${repetido.vuelta})` : '') + '.',
                    duplicado: true,
                    yaHecho,
                    viajeExistente: repetido
                });
            }
            datos._duplicadoDe = { tripId: repetido.id, motivo };
        }
        delete datos.permitirDuplicado;
        delete datos.motivoDuplicado;
```

y en `viajeYaCargado` (12998) agregar `status: true` al `select`. Después del
`prisma.trip.create` (13049), si hay `_duplicadoDe` (sacarlo de `datos` antes
del create), loguear aparte:
`logAction(req, 'CREATE', 'trip', trip.id, 'DUPLICADO A PROPOSITO de #' + dup.tripId + ': ' + dup.motivo, null, trip)`.
Lo mismo en la tanda: en 16055 dejar siempre la consulta de existentes y, en
el reintento con `permitirDuplicado`, exigir `motivoDuplicado` y saltear
(`duplicados.push({..., motivo: 'ya se hizo'})`) los que tengan
`status === 'COMPLETED'` (agregar `status: true` al `select` de 16064).

**2. `create-trip-from-template` sin control.** Antes del `if (dryRun)`
(6471):

```ts
        const repetido = await viajeYaCargado({ date: `${ymd}T15:00:00.000Z`, reparto: template.name, driver: chofer.fullName || chofer.username, vuelta: 1 });
        if (repetido && req.body?.permitirDuplicado !== true) {
            return res.status(409).json({ error: `Ya existe el viaje #${repetido.id} de ${template.name} el ${ymd}`, duplicado: true, viajeExistente: repetido });
        }
```

**3. Que la auditoría se pueda leer por fecha.** En `GET /api/admin/auditoria`
(9891), reemplazar el `createdAt` del `where` por:

```ts
                createdAt: /^\d{4}-\d{2}-\d{2}/.test(String(req.query.desde || ''))
                    ? { gte: new Date(String(req.query.desde)), ...(req.query.hasta ? { lte: new Date(String(req.query.hasta)) } : {}) }
                    : { gte: new Date(Date.now() - horas * 3600000) },
```

**4. En la web** (`planificacion.html`, no es `index.ts` pero es donde nace):
`ntCalLunAVie` debería limpiar antes (`_ntFechas.clear()` al principio, 4716)
o el modal no preseleccionar hoy cuando se va a elegir un rango; y el
`confirm` de 28455 tiene que decir **qué días** están repetidos y si ya se
hicieron, no "1 de los 22".

---

## (b) Los solapes de Gustavo Martelli (R17 + SAM 4)

### Qué compara `choferYaEnOtroViaje` (4096)

Para el viaje que arranca lee `trip.date`, `trip.driver` y
`linkedRoute.driverId`. Busca rutas del **mismo día UTC** con
`actualStartTime != null` y `actualEndTime == null`, de otro `tripId`, y
dice que es el mismo chofer si coincide `Route.driverId` (la cuenta del
celular) **o** el nombre normalizado de `Trip.driver`. No mira
`trip.status`, ni hora, ni `assignedMobileUser`. Devuelve 409
`CHOFER_EN_OTRO_VIAJE` en las dos puertas: app (4233) y operador (14551).

### Los seis casos, con fechas

`GET /api/admin/buscar-chofer?nombre=GUSTAVO MARTELLI` lista sus 57 viajes;
los de octubre que no son R17 son los SAM: **8852 (1/10)**, **8857 (2/10)**,
**9281 (5/10)**, **9329 (14/10)**, **9354 (19/10)**, **9369 (21/10)**. Las
parejas (ya corregidas hoy por "horarios corregidos" / "actualizados en
lote", por eso ahora el SAM arranca cuando cierra el R17):

| día | R17 | SAM 4 | cuenta de la app de las dos rutas |
|---|---|---|---|
| 2/10 | 8499 | 8857 | R17 / R17 |
| 5/10 | 8517 | 9281 | R17 / R17 |
| 14/10 | 8503 | 9329 | R17 / R17 |
| 19/10 | 8502 | 9354 | R17 / R17 |
| 21/10 | 8520 | 9369 | R17 / R17 |
| 1/10 | 8852 (depósito quedó PENDING) | – | R17 |

### Por qué no frenó: la guarda no existía

`git log -S choferYaEnOtroViaje`: la guarda entró en el commit **`174b428`,
sábado 24/10/2026 09:26 -0300** ("Un chofer no puede estar en dos viajes a
la vez"; el propio mensaje dice *"Hasta ahora no habia nada que lo
impidiera... En octubre son 11 pares solapados"*). **Los seis solapes de
Martelli son del 1 al 21 de octubre: anteriores a la guarda.** No hubo nada
que verificar sobre `status`, cuentas o caminos para esos seis: el código no
existía.

Las tres hipótesis, igual verificadas:

- **Otra cuenta (`assignedMobileUser`)**: no. Las dos rutas de cada par
  apuntan a la cuenta `R17` (`rutasEnOtraCuenta` lo muestra: ninguna ruta de
  Martelli está en la cuenta `GUSTAVO_MARTELLI`, todas en `R17`), y
  `trip.driver` es `GUSTAVO MARTELLI` en las dos. La guarda habría
  emparejado por id y por nombre.
- **`trip.status` que no cuenta**: no aplica, la guarda no mira `status`.
- **Camino que no llama a la guarda**: en el servidor no hay otro. Todos los
  arranques escriben `actualStartTime` en 4244 (app) o 14561 (operador), y
  los dos pasan por la guarda desde el 24/10.

### Lo que sí sigue fallando (y la guarda del 24/10 no arregla)

Estas tres cosas hacen que el 409, aunque exista, **no evite el solape**:

1. **La app se traga el 409.** `mobile/src/api.ts` 905-941
   (`patchRouteRecorrido`): un 409 es `httpDisposition = 'discard'` (25), se
   lee el mensaje y solo se considera benigno `"ya fue iniciado|terminado"`;
   el aviso `"... ya está en el viaje #8499 ... Cerralo antes de arrancar
   este."` lanza un `Error`… que los dos llamadores descartan:
   `TrackScreen.tsx` 691 (`startTracking`:
   `void patchRouteRecorrido(...).catch(() => {})`) y 866 (`onChangeRoute`,
   idem). En la cola offline (636-642) el 409 se **descarta** como enviado.
   El chofer no ve nada: el GPS arranca, marca las paradas del SAM, y la
   ruta del SAM queda **sin `actualStartTime`**.
2. **Al cerrar, el inicio se infiere de la primera parada.** Los tres cierres
   (depósito 5025-5056 `tryCloseRouteIfComplete`, operador 14591-14609, app
   "Finalizar" 13483-13509) hacen `startAt = route.actualStartTime || min(hora
   de parada)`. O sea: el 409 solo impidió escribir la hora de fichaje; la
   ventana del SAM igual queda desde las 09:20 (primera parada), pisando al
   R17 que cerró 10:58 (caso 2/10 original: los dos cerraron a las
   13:58:42Z, el mismo segundo, porque el depósito del R17 se marcó con el
   SAM ya andando y el cierre del SAM tomó la misma marca).
3. **Un viaje en curso sin fichaje es invisible para la guarda.** El filtro
   `actualStartTime: { not: null }` (4116) deja afuera una ruta donde el
   chofer está marcando paradas pero no fichó (o le rechazaron el fichaje
   por el punto 1). Ningún camino pone `actualStartTime` al marcar la primera
   parada (las únicas escrituras son 4244, 14561 y los cierres).

### Qué habría que cambiar en `index.ts` (texto, sin aplicar)

**Opción A (la que pidió el usuario: "el depósito es el cierre del viaje, no
una parada"): cerrar el anterior en vez de frenar.** Está construida en
`src/guardasDeViaje.ts` → `cerrarViajeAnteriorDelChofer`; el reemplazo exacto
de 4233-4241 y 14551-14558 está en `scripts/cableado_guardas.md`.

**Opción B (si el coordinador prefiere seguir frenando): que el 409 sea
real.** Hace falta (i) en la app, `TrackScreen.tsx` 691 y 866: no descartar
el error, mostrarlo (`Alert.alert('No se puede arrancar', e.message)`) y no
arrancar el tracking; (ii) en `api.ts` 636-642, un 409 con
`code: CHOFER_EN_OTRO_VIAJE` no se descarta en silencio: se avisa; (iii) en
el servidor, que la parada marcada cuente como "en curso": en el PATCH de
parada, cuando llega `actualArrival` y `stop.route.actualStartTime` es null,
agregar

```ts
            if (stop.route && !stop.route.actualStartTime && !stop.route.actualEndTime && body.actualArrival) {
                await prisma.route.update({ where: { id: stop.route.id }, data: { actualStartTime: new Date(body.actualArrival), status: 'IN_PROGRESS' } });
            }
```

y en `choferYaEnOtroViaje` (4113-4119) ampliar el `where` para que una ruta
con paradas marcadas y sin `actualEndTime` también cuente como abierta:

```ts
        where: {
            tripId: { not: tripId },
            actualEndTime: null,
            date: { gte: desde, lte: hasta },
            OR: [
                { actualStartTime: { not: null } },
                { stops: { some: { actualArrival: { not: null } } } }
            ]
        },
```

Las dos opciones se pueden combinar: cerrar el anterior (A) y, además, que la
app muestre lo que el servidor contestó.
