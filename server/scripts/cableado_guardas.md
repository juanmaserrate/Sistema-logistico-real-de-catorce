# Cableado de `src/guardasDeViaje.ts` en `index.ts`

**No está aplicado.** Líneas y fragmentos tomados de `server/src/index.ts`
en el commit `81dabff` (4 nov 2026). Primero el import, después los cuatro
puntos. Para probar antes de tocar nada:
`cd server && npx ts-node scripts/probar_guardas.ts`.

## 0. Import

Junto a los otros imports de módulos propios (cerca de la línea 6,
`import { armarReporte, ... } from './reporteTorre';`):

```ts
import { cerrarViajeAnteriorDelChofer, completarViajeCreadoParaFechaPasada, proveedoresParecidos } from './guardasDeViaje';
```

Las tres funciones reciben `prisma` por parámetro: se les pasa el `prisma`
global de `index.ts` tal cual.

## 1. Arranque desde la app del chofer — `PATCH /api/v1/routes/:id/recorrido`

Hoy (4228-4241):

```ts
            // Un chofer no puede estar en dos viajes a la vez. Desde la app se
            // frena igual que desde la web: si arranca el segundo, las horas de
            // los dos se cuentan por separado y el mes queda con horas que nadie
            // trabajo. Solo cuenta el MISMO DIA: un viaje que quedo abierto de
            // ayer no puede dejarlo parado en la calle.
            if (route.tripId) {
                const ocupado = await choferYaEnOtroViaje(route.tripId);
                if (ocupado) {
                    return res.status(409).json({
                        code: 'CHOFER_EN_OTRO_VIAJE',
                        error: avisoChoferOcupado(ocupado),
                        otroViaje: ocupado
                    });
                }
            }
```

La investigación mostró que el 409 **no llega al chofer** (la app lo
descarta) y que el solape queda igual. Reemplazar por el cierre del anterior:

```ts
            // Un chofer no puede estar en dos viajes a la vez. Cuando arranca
            // el segundo, el primero termina ahi: "el deposito es el cierre
            // del viaje, no una parada". Solo el MISMO DIA: un viaje abierto
            // de ayer es un error de carga viejo y lo arregla el operador.
            if (route.tripId) {
                try {
                    const cierre = await cerrarViajeAnteriorDelChofer(prisma, route.tripId, now);
                    for (const c of [cierre.cerrado, ...cierre.otrosCerrados]) {
                        if (!c) continue;
                        io.emit('trip:updated', { tripId: c.tripId, hint: 'cerrado_por_arranque_siguiente' });
                        logAction(req, 'UPDATE', 'trip', c.tripId,
                            `Cerrado ${now.toISOString()} porque el chofer arranco el viaje #${route.tripId}`,
                            { abiertoDesde: c.abiertoDesde }, { actualEndTime: now, status: 'COMPLETED' })
                            .catch(() => {});
                    }
                } catch (e) { console.warn('[routes/recorrido start] cierre del anterior:', e); }
            }
```

`now` ya existe en ese handler (4166: es la hora real del fichaje, con `at`
de la cola offline), así el cierre del anterior queda a la hora en que el
chofer arrancó de verdad, no a la hora en que sincronizó.

Si el coordinador prefiere **seguir frenando** con 409 y solo cerrar cuando el
operador lo pide, dejar el bloque de hoy y agregar el cierre únicamente con
`req.body?.cerrarAnterior === true`:

```ts
            if (route.tripId) {
                if (req.body?.cerrarAnterior === true) {
                    await cerrarViajeAnteriorDelChofer(prisma, route.tripId, now);
                } else {
                    const ocupado = await choferYaEnOtroViaje(route.tripId);
                    if (ocupado) { return res.status(409).json({ code: 'CHOFER_EN_OTRO_VIAJE', error: avisoChoferOcupado(ocupado), otroViaje: ocupado }); }
                }
            }
```

(En ese caso, además, la app tiene que mostrar el 409: ver
`investigacion_guardas.md`, opción B.)

## 2. Arranque desde el operador — `PATCH /api/v1/trips/:tripId/recorrido-operador`

Hoy (14550-14558):

```ts
            // Un chofer no puede estar en dos viajes a la vez.
            const ocupado = await choferYaEnOtroViaje(tripId);
            if (ocupado) {
                return res.status(409).json({
                    code: 'CHOFER_EN_OTRO_VIAJE',
                    error: avisoChoferOcupado(ocupado),
                    otroViaje: ocupado
                });
            }
```

Reemplazar por (el operador sí ve el 409 en la web, así que acá vale la pena
dejarle la elección: frena, y con `cerrarAnterior: true` cierra el anterior y
arranca):

```ts
            // Un chofer no puede estar en dos viajes a la vez. Por defecto se
            // frena y se avisa; si el operador confirma, el anterior se cierra
            // con esta hora y este arranca.
            if (req.body?.cerrarAnterior === true) {
                const cierre = await cerrarViajeAnteriorDelChofer(prisma, tripId, now);
                for (const c of [cierre.cerrado, ...cierre.otrosCerrados]) {
                    if (!c) continue;
                    io.emit('trip:updated', { tripId: c.tripId, hint: 'cerrado_por_arranque_siguiente' });
                    await logAction(req, 'UPDATE', 'trip', c.tripId,
                        `Cerrado ${now.toISOString()} por el operador al arrancar el viaje #${tripId}`,
                        { abiertoDesde: c.abiertoDesde }, { actualEndTime: now, status: 'COMPLETED' });
                }
            } else {
                const ocupado = await choferYaEnOtroViaje(tripId);
                if (ocupado) {
                    return res.status(409).json({
                        code: 'CHOFER_EN_OTRO_VIAJE',
                        error: avisoChoferOcupado(ocupado),
                        otroViaje: ocupado,
                        // La web puede reintentar con { action: 'start', cerrarAnterior: true }
                        sePuedeCerrarElAnterior: true
                    });
                }
            }
```

En `planificacion.html`, donde se maneja el 409 del botón Iniciar, ofrecer
"Cerrar el #X y arrancar" que reenvía `{ action: 'start', cerrarAnterior: true }`.

Nota: `cerrarViajeAnteriorDelChofer` no cierra los tramos (`TripLeg`) del
viaje anterior. Si ese viaje tenía tramos abiertos, en el mismo bloque se
puede llamar a `cerrarTramo({ tripId: c.tripId, ruta, at: now, ... })` para
cada ruta de `tramosDelViaje(c.tripId)` que no esté cerrada, igual que hace el
cierre desde la app (13497-13504).

## 3. `POST /api/admin/create-trip-from-template` — al final (6516-6524)

Hoy:

```ts
        io.emit('trip:created', { trip });
        // Solo se avisa por un viaje que todavia no paso. ...
        if (ymd >= buenosAiresYmd()) {
            notifyDriver(chofer.username, 'Nuevo viaje asignado', `Tenés un viaje asignado para ${ymd}`, { tripId: trip.id });
        }
        res.json({
            ok: true, tripId: trip.id, routeId: route.id, fecha: ymd, reparto: template.name,
            chofer: chofer.username, paradas: clientIds.length, sinCliente
        });
```

Agregar, entre el `io.emit` y el `res.json`:

```ts
        // Contrato y proveedor segun la ficha del chofer. El 'Propio' de arriba
        // es un valor por defecto, no una eleccion: por eso se pisa con la
        // ficha salvo que el que llamo haya mandado contractType a proposito.
        // Y si el dia ya paso y la ruta tiene ventana, queda cerrado.
        let completado: any = null;
        try {
            completado = await completarViajeCreadoParaFechaPasada(prisma, trip.id, {
                ficha: (chofer) => loQueEsElChofer(chofer, ymd),
                pisarContratoConFicha: !contractType
            });
        } catch (e) { console.warn('create-trip-from-template: completar:', e); }
```

y en el `res.json` agregar `completado`. (`loQueEsElChofer` está definido en
12959 y devuelve `{ tipo, proveedor, segun }`: encaja con lo que espera
`opciones.ficha`.)

Alternativa más simple en la misma línea: cambiar en 6485
`contractType: contractType ? String(contractType) : 'Propio'` por
`contractType: contractType ? String(contractType) : null` y llamar sin
`pisarContratoConFicha`: la función completa contrato y proveedor cuando
vienen vacíos.

## 4. `POST /api/admin/crear-viajes-faltantes` — al final (6730-6738)

Hoy:

```ts
                creados.push({ tripId: trip.id, reparto: p.reparto, fecha: p.fecha, paradas: lista.length, rutas: p.rutas });
            } catch (e: any) {
                fallados.push({ reparto: p.reparto, fecha: p.fecha, motivo: e?.message || 'error' });
            }
        }
        await logAction(req, 'CREATE', 'trip', 0, `${creados.length} viajes de ${mes} creados desde ${referencia}`, null,
            { mes, referencia, creados: creados.length, fallados: fallados.length });
        res.json({ ok: true, mes, referencia, creados: creados.length, fallados, detalle: creados });
```

Agregar antes del `await logAction(...)`:

```ts
        // Los viajes del mes copian contrato y proveedor del mes anterior; si
        // quedo alguno tercerizado sin proveedor, lo pone la ficha del chofer.
        // Los dias que ya pasaron (completar un mes viejo) se cierran si la
        // ruta tiene ventana; recien creados no la tienen, asi que esto los
        // deja listos para cuando el operador cargue las horas.
        const completados: any[] = [];
        for (const c of creados) {
            try {
                const r = await completarViajeCreadoParaFechaPasada(prisma, c.tripId, {
                    ficha: (chofer) => loQueEsElChofer(chofer, c.fecha)
                });
                if (r.cambios.contractType || r.cambios.provider || r.cambios.viajeCerrado) completados.push(r);
            } catch (e: any) {
                fallados.push({ reparto: c.reparto, fecha: c.fecha, motivo: 'completar: ' + (e?.message || 'error') });
            }
        }
```

y en el `res.json` agregar `completados`.

Para los viajes de fecha pasada la ventana llega después, cuando el operador
carga inicio y fin (`PUT` de ventana, 12250-12300, escribe
`actualStartTime`/`actualEndTime` en 12277). Ahí, después del
`prisma.route.update`, también conviene llamar
`completarViajeCreadoParaFechaPasada(prisma, route.tripId, { ficha: ... })`
si `route.tripId` existe: es el momento en que el viaje viejo puede cerrarse
solo, sin repasarlo a mano (los 91 de octubre).

## 5. `GET /api/admin/proveedores-en-viajes` — campo `parecidos` (11369-11427)

Hoy la salida se arma en 11398-11423; `salida` tiene un elemento por nombre
normalizado y `fichas` los proveedores con ficha. Agregar antes del
`res.json({` (11415):

```ts
        // Nombres que son la misma persona escrita con una letra distinta
        // ("ALAM AMO" / "ALAN AMO"): la agrupacion de arriba no los ve porque
        // normalizan a dos claves distintas. Se comparan los nombres reales
        // de los viajes y los de las fichas, a 2 letras de distancia o menos.
        const parecidos = proveedoresParecidos([
            ...salida.map((g) => g.sugerido),
            ...fichas.map((f) => f.name)
        ]).map((p) => ({
            ...p,
            viajesA: salida.find((g) => g.normalizado === norm(p.a))?.viajes || 0,
            viajesB: salida.find((g) => g.normalizado === norm(p.b))?.viajes || 0,
            // Cual quedarse: el que tiene ficha; si los dos o ninguno, el de mas viajes
            sugerido: nombresFicha.has(norm(p.a)) && !nombresFicha.has(norm(p.b)) ? p.a
                    : nombresFicha.has(norm(p.b)) && !nombresFicha.has(norm(p.a)) ? p.b
                    : null
        }));
```

y en el `res.json` (11415-11423) agregar las dos líneas:

```ts
            parecidos,
            parecidosPorEscritura: parecidos.length,
```

El operador después unifica con el endpoint que ya existe
(`unificar-proveedor`, 11430 en adelante), pasándole `de: p.a, a: p.sugerido`.
