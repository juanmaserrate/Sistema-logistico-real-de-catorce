# Cableado del protocolo de cierre de viaje

Módulo: `server/src/cierreDeViaje.ts` → `normalizarViajeAlCerrar(prisma, routeId, { dryRun? })`.
Test: `cd server && npx ts-node scripts/probar_cierre_de_viaje.ts`.

Los números de línea son de `server/src/index.ts` **tal como está hoy, antes de
insertar nada**. Si se insertan de arriba hacia abajo los números se corren;
conviene insertar **de abajo hacia arriba** (14631 → 14616 → 13522 → 12187 →
5283 → 5073 → 4) o buscar por el fragmento, que es único en cada caso.

La llamada es siempre la misma y nunca rompe el cierre que ya se hizo: si
falla, va al log y el viaje queda cerrado igual (como venía).

```ts
await normalizarViajeAlCerrar(prisma, route.id).catch((e: any) =>
    console.warn('[cierre] no se pudo normalizar la ruta ' + route.id + ':', e?.message || e));
```

---

## 0. Import (línea 4)

Después de:

```ts
import { mapaUnidadPorRuta, unidadDeParada, unidadesDeTexto, repartirHoras, esVueltaAlDeposito, SIN_UNIDAD } from './unidadesDelViaje';
```

agregar:

```ts
import { normalizarViajeAlCerrar } from './cierreDeViaje';
```

---

## (a) Cierre por operador — `PATCH /api/v1/trips/:tripId/recorrido-operador` (línea 14524), dos ramas

### Rama 1: la ruta nunca arrancó y todas las paradas están COMPLETED (líneas 14604-14618)

Hoy:

```ts
            const startAt = inferStart();
            const updated = await prisma.route.update({
                where: { id: route.id },
                data: { actualStartTime: startAt, actualEndTime: now, status: 'COMPLETED' }
            });
            await prisma.trip.update({
                where: { id: tripId },
                // returnTime tambien: los otros dos caminos de cierre lo escriben y el Motor de Costos lo usa cuando el viaje no tiene GPS.
                data: { status: 'COMPLETED', completedAt: now, returnTime: now }
            });
            io.emit('route:updated', { routeId: route.id, tripId, type: 'operator_finished' });   // <- línea 14616
            io.emit('trip:updated', { tripId });
            return res.json({ route: updated });
```

Insertar **antes de la línea 14616** (`io.emit('route:updated', { routeId: route.id, tripId, type: 'operator_finished' });`, primera aparición):

```ts
            // Protocolo de cierre: paradas en orden de horario, cerradas las que
            // tienen las dos horas, ventana ajustada a las paradas.
            await normalizarViajeAlCerrar(prisma, route.id).catch((e: any) =>
                console.warn('[cierre] no se pudo normalizar la ruta ' + route.id + ':', e?.message || e));
```

### Rama 2: la ruta estaba en curso y el operador la cierra (líneas 14620-14634)

Hoy:

```ts
        const updated = await prisma.route.update({
            where: { id: route.id },
            data: { actualEndTime: now, status: 'COMPLETED' }
        });
        await prisma.trip.update({
            where: { id: tripId },
            // returnTime tambien: los otros dos caminos de cierre lo escriben y el Motor de Costos lo usa cuando el viaje no tiene GPS.
            data: { status: 'COMPLETED', completedAt: now, returnTime: now }
        });
        // El chofer marco la llegada al deposito y el operador cerro el viaje antes
        // de que tocara "Finalizar": la parada quedaba "En la parada" para siempre.
        await cerrarParadaDepositoEnLlegada(route.id, now);                                      // <- línea 14631
        io.emit('route:updated', { routeId: route.id, tripId, type: 'operator_finished' });   // <- línea 14632
        io.emit('trip:updated', { tripId });
        return res.json({ route: updated });
```

Insertar **entre la 14631 y la 14632** (después de `cerrarParadaDepositoEnLlegada`, que le pone la salida al depósito; así el protocolo ya la ve):

```ts
        // Protocolo de cierre. Va DESPUES de cerrar el deposito, para que la
        // ventana se calcule con su hora de salida ya cargada.
        await normalizarViajeAlCerrar(prisma, route.id).catch((e: any) =>
            console.warn('[cierre] no se pudo normalizar la ruta ' + route.id + ':', e?.message || e));
```

---

## (b) Auto-cierre cuando todas las paradas quedan finales

**Ojo:** el bloque `[auto-finish]` de la línea ~12170 está **desactivado** (corre
sólo con `AUTO_FINISH_ROUTE_ON_LAST_STOP=true`, y el comentario de la 12137
dice que se apagó). El auto-cierre que **sí corre hoy** después de cada parada
es `tryCloseRouteIfComplete` (línea 4989), llamado desde `PATCH /api/v1/stops/:id`
en la 12131. Hay que cablear los dos: el activo para que funcione, el dormido
para que no quede atrás si alguien lo prende.

### (b1) El activo: `tryCloseRouteIfComplete` (líneas 5053-5079)

Hoy, el final de la función:

```ts
    await prisma.deviceLocation.updateMany({
        where: { routeId: route.id, isActive: true },
        data: { isActive: false }
    }).catch(() => {});                                                                        // <- línea 5073

    console.log('[base-stop] Ruta ' + route.id + ' cerrada (' + closeAt.toISOString() + ')');  // <- línea 5075
    io.emit('route:updated', { routeId: route.id, type: 'closed_at_base' });
    if (route.tripId) io.emit('trip:updated', { tripId: route.tripId });
    return true;
}
```

Insertar **entre la 5073 y la 5075** (después del `.catch(() => {});` del `deviceLocation`, antes del `console.log('[base-stop] Ruta ...`):

```ts
    // Protocolo de cierre: la ruta ya quedo COMPLETED en la transaccion de
    // arriba; esto ordena las paradas por hora, cierra las que tienen las dos
    // horas y ajusta la ventana. Si falla, el viaje queda cerrado igual.
    await normalizarViajeAlCerrar(prisma, route.id).catch((e: any) =>
        console.warn('[cierre] no se pudo normalizar la ruta ' + route.id + ':', e?.message || e));
```

### (b2) El dormido: bloque `[auto-finish]` (líneas 12150-12197)

Hoy:

```ts
                    await prisma.deviceLocation.updateMany({
                        where: { routeId: stop.route.id, isActive: true },
                        data: { isActive: false }
                    });                                                                                                       // <- línea 12187
                    console.log(`[auto-finish] Ruta ${stop.route.id} cerrada automaticamente (${allStops.length} paradas finalizadas)`);  // <- línea 12188
                    io.emit('route:updated', { routeId: stop.route.id, type: 'auto_finished' });
```

Insertar **entre la 12187 y la 12188** (acá la ruta se llama `stop.route.id`):

```ts
                    await normalizarViajeAlCerrar(prisma, stop.route.id).catch((e: any) =>
                        console.warn('[cierre] no se pudo normalizar la ruta ' + stop.route.id + ':', e?.message || e));
```

---

## (c) Finalizar desde la app sin pasar por el depósito — `POST /api/v1/trips/:id/finalizar` (línea 13455)

Hoy (líneas 13507-13524):

```ts
        await prisma.route.update({
            where: { id: route.id },
            data: { actualStartTime: arranque, actualEndTime: cuando, status: 'COMPLETED' }   // <- línea 13509
        });
        await prisma.trip.update({
            where: { id: tripId },
            // returnTime es lo que levanta el Motor de Costos: los tres caminos
            // de cierre tienen que escribirlo.
            data: {
                status: 'COMPLETED', completedAt: cuando, returnTime: cuando,
                ...(String(motivo || '').trim() ? { driverComments: String(motivo).slice(0, 500) } : {})
            }
        });
        await prisma.deviceLocation.updateMany({
            where: { routeId: route.id, isActive: true }, data: { isActive: false }
        });                                                                                     // <- línea 13522

        await logAction(req, 'UPDATE', 'Trip', tripId,                                        // <- línea 13524
            `Viaje finalizado${sinMarcar.length ? ` con ${sinMarcar.length} parada(s) sin marcar` : ''}`,
```

Insertar **después de la 13522** (el `});` del `deviceLocation.updateMany`), antes del `await logAction(`:

```ts
        // Protocolo de cierre. Las paradas que quedaron sin marcar siguen
        // PENDING (no tienen hora): solo se ordenan y se cierran las que si.
        await normalizarViajeAlCerrar(prisma, route.id).catch((e: any) =>
            console.warn('[cierre] no se pudo normalizar la ruta ' + route.id + ':', e?.message || e));
```

---

## Endpoint para meses viejos — `POST /api/admin/normalizar-viajes`

Ponerlo **antes de la línea 5282** (`app.post('/api/admin/close-stuck-routes', ...`), al lado de
`cerrar-viajes-colgados`, que es su pariente. Texto completo:

```ts
/** Aplica el protocolo de cierre (paradas en orden de horario, cerradas las que
 *  tienen las dos horas, ventana ajustada) a viajes que YA estan cerrados.
 *  Sirve para los meses anteriores a que existiera el protocolo: el chofer
 *  cerraba las paradas de a saltos y en octubre de 2026 la secuencia estaba
 *  dada vuelta en 413 de 589 viajes. Nunca toca un viaje abierto (lo omite y
 *  lo dice en los avisos).
 *
 *  POST /api/admin/normalizar-viajes { key, ids?: number[], mes?: "2026-10", dryRun? }
 *    ids = ids de VIAJE (Trip). mes = todos los viajes del mes con recorrido.
 *    Devuelve totales, el detalle de lo que cambio por viaje y los avisos que
 *    necesitan un ojo humano (paradas de menos de 2 minutos, solapadas, etc). */
app.post('/api/admin/normalizar-viajes', async (req: any, res: any) => {
    const { key, ids, mes, dryRun } = req.body || {};
    if (key !== 'r14-basestop-2026') return res.status(403).json({ error: 'Forbidden' });
    try {
        // Solo rutas cerradas: con fin o en COMPLETED. La funcion vuelve a
        // chequearlo, pero no vale la pena leer las abiertas.
        const where: any = { OR: [{ actualEndTime: { not: null } }, { status: 'COMPLETED' }] };
        if (Array.isArray(ids) && ids.length) {
            const tripIds = ids.map(Number).filter(Number.isFinite);
            if (!tripIds.length) return res.status(400).json({ error: '"ids" tiene que ser una lista de ids de viaje' });
            where.tripId = { in: tripIds };
        } else if (/^\d{4}-\d{2}$/.test(String(mes || ''))) {
            const [y, m] = String(mes).split('-').map(Number);
            where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
        } else {
            return res.status(400).json({ error: 'Falta "ids" (ids de viaje) o "mes" (YYYY-MM)' });
        }

        const rutas = await prisma.route.findMany({
            where,
            select: { id: true, tripId: true, date: true },
            orderBy: { id: 'asc' }
        });

        const totales = { viajes: rutas.length, tocados: 0, omitidos: 0, reordenadas: 0, cerradas: 0, ventanas: 0, conAvisos: 0, errores: 0 };
        const cambios: any[] = [];
        const avisos: any[] = [];
        for (const r of rutas) {
            try {
                const inf = await normalizarViajeAlCerrar(prisma, r.id, { dryRun: !!dryRun });
                if (inf.omitido) totales.omitidos++;
                totales.reordenadas += inf.reordenadas;
                totales.cerradas += inf.cerradas;
                if (inf.ventana) totales.ventanas++;
                const toco = inf.reordenadas > 0 || inf.cerradas > 0 || !!inf.ventana || inf.cambios.some((c) => c.tipo === 'viaje');
                if (toco) {
                    totales.tocados++;
                    cambios.push({
                        tripId: inf.tripId, routeId: inf.routeId,
                        fecha: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
                        reordenadas: inf.reordenadas, cerradas: inf.cerradas, ventana: inf.ventana,
                        viaje: inf.cambios.find((c) => c.tipo === 'viaje') || null
                    });
                    if (!dryRun && inf.tripId) io.emit('trip:updated', { tripId: inf.tripId, hint: 'normalizado' });
                }
                if (inf.avisos.length) {
                    totales.conAvisos++;
                    avisos.push({
                        tripId: inf.tripId, routeId: inf.routeId,
                        fecha: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
                        avisos: inf.avisos
                    });
                }
            } catch (e: any) {
                totales.errores++;
                avisos.push({ tripId: r.tripId, routeId: r.id, error: e?.message || String(e) });
            }
        }

        if (!dryRun && totales.tocados) {
            await logAction(req, 'UPDATE', 'Trip',
                Array.isArray(ids) && ids.length ? ids.join(',') : String(mes),
                `protocolo de cierre aplicado a ${totales.tocados} de ${rutas.length} viaje(s)`, null,
                { totales, cambios });
        }
        res.json({ dryRun: !!dryRun, totales, cambios, avisos });
    } catch (e: any) {
        console.error('normalizar-viajes:', e);
        res.status(500).json({ error: e?.message || 'Error' });
    }
});
```

Uso:

```bash
# Ver qué haría con octubre, sin tocar nada
curl -s -X POST https://.../api/admin/normalizar-viajes -H 'Content-Type: application/json' \
  -d '{"key":"r14-basestop-2026","mes":"2026-10","dryRun":true}'

# Aplicarlo a dos viajes puntuales
curl -s -X POST https://.../api/admin/normalizar-viajes -H 'Content-Type: application/json' \
  -d '{"key":"r14-basestop-2026","ids":[8192,8193]}'
```

---

## Qué devuelve `normalizarViajeAlCerrar` (`InformeDeCierre`)

```ts
{
  routeId, tripId, dryRun,
  omitido: null | 'viaje abierto' | 'sin paradas',
  reordenadas: n,      // paradas a las que les cambió el número
  cerradas: n,         // paradas que pasaron a COMPLETED
  ventana: null | { antes: { inicio, fin }, despues: { inicio, fin } },   // ISO
  avisos: [ { tipo, sec, nombre, llegada, salida, otroSec?, otroNombre?, texto } ],
  cambios: [ { tipo: 'secuencia'|'estado'|'ventana'|'viaje', stopId?, nombre?, antes, despues } ]
}
```

Tipos de aviso: `permanencia-corta` (< 2 min en una escuela), `salida-antes-de-llegada`,
`solapadas`, `en-parada-sin-salida` (ARRIVED sin salida), `hora-fuera-de-rango`
(hora a más de 36 h de la fecha del viaje o en el futuro: se ignora),
`ventana-no-achicada` (el fin debería ser anterior pero dejaría una parada con
hora afuera), `ventana-invertida`, `viaje-returnTime-distinto` (el trip tiene
una vuelta cargada a mano distinta al fin de la ruta: no se toca), `viaje-abierto`,
`sin-paradas`.

## Decisiones de criterio que conviene saber

- **Depósito**: se reconoce con `esVueltaAlDeposito` (flag `isReturnToBase` **o** nombre
  "REAL DE CATORCE / DEPOSITO / R14"), igual que `tryCloseRouteIfComplete` y el reporte.
  Las rutas viejas tienen el depósito sin la marca.
- **Orden**: por llegada; si una parada sólo tiene salida, por la salida. A igual hora,
  el número que tenían (dos marcadas en el mismo segundo no se dan vuelta entre sí).
- **`plannedSequence`**: al renumerar se guarda el número viejo la primera vez
  (`plannedSequence ?? sequence`), como hace el reordenamiento del chofer.
- **Horas no creíbles** (1970, reloj adelantado): cuentan como "sin hora" para todo y se avisan.
- **Fin de la ventana**: `max(salida)` entre COMPLETED (con el estado que queda tras cerrar) y
  depósito. Se **extiende** siempre; se **achica** sólo si ninguna parada con hora (de
  cualquier estado, UNDELIVERABLE incluida) queda afuera; si no, se deja y se avisa.
- **Inicio**: sólo se adelanta (a la primera llegada); nunca se atrasa.
- **Trip**: `exitTime`/`returnTime` vacíos se completan. Si venían **pegados** al inicio/fin
  viejo de la ruta (los escribió el cierre automático), siguen al nuevo valor: `returnTime`
  es lo que lee el Motor de Costos y dejarle la hora vieja sería seguir cobrando las horas
  fantasma que esto corrige. Si alguien cargó otra hora a mano, no se toca y se avisa.
  Con ventana completa el trip pasa a `COMPLETED` (con `completedAt` = fin si estaba vacío).
- **Viaje abierto** (sin fin y no COMPLETED): no se escribe nada, ni en dryRun se calcula.
