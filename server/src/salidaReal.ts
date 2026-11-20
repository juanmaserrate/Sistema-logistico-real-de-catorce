/* ============================================================================
 * LA SALIDA REAL DE UN VIAJE QUE NADIE INICIO
 * ============================================================================
 * Si el viaje no se inicio (ni «Fichar entrada» ni Iniciar desde la web), al
 * cerrarse toma como salida la hora de la PRIMERA PARADA: se pierde el viaje
 * del deposito a la primera escuela (37 min de mediana en noviembre de 2026).
 * Pasaba en 59 de 347 viajes de noviembre: casi siempre el segundo o tercer
 * viaje del dia (el chofer ya ficho en el primero y la app no le pide nada
 * para el siguiente) y el R2, que no ficha nunca.
 *
 * La salida real sale del GPS del chofer: el ULTIMO momento en que el camion
 * estuvo en el deposito antes de la primera parada (y despues de terminar su
 * viaje anterior). Sin GPS del deposito no se inventa nada: queda como esta.
 * ========================================================================= */

/** Real de Catorce, Ombu 1269, Burzaco (el cliente «REAL DE CATORCE»). */
export const DEPOSITO = { lat: -34.8353338, lng: -58.4233261 };
export const RADIO_DEPOSITO_M = 300;
/** Si el camion estuvo en el deposito hasta menos que esto antes de la primera
 *  parada, no es una salida: es el mismo lugar (o un dato raro). */
const MINIMO_ANTES_MS = 3 * 60 * 1000;
/** Hasta cuanto se corrige solo. */
export const MAXIMO_MIN_SOLO = 90;
/** Hasta cuanto antes de la primera parada se busca, si no hubo viaje anterior. */
const VENTANA_MS = 4 * 3600 * 1000;

export function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const r = Math.PI / 180;
    const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
    const y = (b.lat - a.lat) * r;
    return Math.sqrt(x * x + y * y) * 6371000;
}

/** El ultimo punto en el deposito, o null. Los puntos van en orden de hora. */
export function ultimaVezEnElDeposito(puntos: { lat: number; lng: number; t: number }[], hasta: number): number | null {
    let ultima: number | null = null;
    for (const p of puntos) {
        if (p.t > hasta) break;
        if (distanciaM(p, DEPOSITO) <= RADIO_DEPOSITO_M) ultima = p.t;
    }
    return ultima != null && hasta - ultima >= MINIMO_ANTES_MS ? ultima : null;
}

export interface ResultadoSalida {
    tripId: number | null;
    routeId: number;
    salidaAntes: string | null;
    primeraParada: string | null;
    salidaNueva: string | null;
    minutosSumados: number;
    puntosGps: number;
    motivo: string;
    guardado: boolean;
}

export async function corregirSalidaDelViaje(
    prisma: any,
    ref: { routeId?: number; tripId?: number },
    opciones: { dryRun?: boolean; quien?: string; maximoMin?: number } = {}
): Promise<ResultadoSalida | null> {
    const route = await prisma.route.findFirst({
        where: ref.routeId ? { id: ref.routeId } : { tripId: ref.tripId },
        select: {
            id: true, tripId: true, driverId: true, actualStartTime: true, actualEndTime: true,
            trip: { select: { id: true, startedAt: true, exitTime: true } },
            stops: { select: { actualArrival: true, isReturnToBase: true } }
        }
    });
    if (!route) return null;
    const ini = route.actualStartTime ? new Date(route.actualStartTime) : null;
    const llegadas = (route.stops || []).filter((s: any) => !s.isReturnToBase && s.actualArrival).map((s: any) => new Date(s.actualArrival).getTime());
    const primera = llegadas.length ? Math.min(...llegadas) : null;
    const res: ResultadoSalida = {
        tripId: route.tripId ?? null, routeId: route.id,
        salidaAntes: ini?.toISOString() ?? null,
        primeraParada: primera != null ? new Date(primera).toISOString() : null,
        salidaNueva: null, minutosSumados: 0, puntosGps: 0, motivo: '', guardado: false
    };
    if (!ini || primera == null || !route.driverId) { res.motivo = 'sin salida, sin paradas marcadas o sin chofer'; return res; }
    if (Math.abs(primera - ini.getTime()) > 60000) { res.motivo = 'la salida ya es distinta de la primera parada'; return res; }

    // Desde el fin de su viaje anterior (si lo hubo), o 4 h antes
    const anterior = await prisma.route.findFirst({
        where: {
            driverId: route.driverId, id: { not: route.id },
            actualEndTime: { lte: new Date(primera), gte: new Date(primera - 12 * 3600 * 1000) }
        },
        orderBy: { actualEndTime: 'desc' },
        select: { actualEndTime: true }
    });
    const desde = anterior?.actualEndTime ? new Date(anterior.actualEndTime).getTime() : primera - VENTANA_MS;
    const puntos = (await prisma.deviceLocation.findMany({
        where: { driverId: route.driverId, timestamp: { gte: new Date(desde), lte: new Date(primera) } },
        select: { latitude: true, longitude: true, timestamp: true },
        orderBy: { timestamp: 'asc' }, take: 50000
    })).map((p: any) => ({ lat: p.latitude, lng: p.longitude, t: new Date(p.timestamp).getTime() }));
    res.puntosGps = puntos.length;
    const salida = ultimaVezEnElDeposito(puntos, primera);
    if (salida == null) { res.motivo = puntos.length ? 'el GPS no muestra el camion en el deposito antes de la primera parada' : 'sin GPS antes de la primera parada'; return res; }

    res.salidaNueva = new Date(salida).toISOString();
    res.minutosSumados = Math.round((ini.getTime() - salida) / 60000);
    res.motivo = 'salida del deposito segun el GPS';
    // Mas de hora y media entre el deposito y la primera parada puede ser real
    // o que el camion hizo otra cosa en el medio: eso lo mira una persona.
    const maximo = opciones.maximoMin ?? MAXIMO_MIN_SOLO;
    if (res.minutosSumados > maximo) {
        res.motivo = `mas de ${maximo} min entre el deposito y la primera parada: revisar a mano`;
        res.salidaNueva = null;
        return res;
    }
    if (opciones.dryRun) return res;

    const nueva = new Date(salida);
    const mismo = (d: any) => !d || Math.abs(new Date(d).getTime() - ini.getTime()) <= 60000;
    await prisma.$transaction([
        prisma.route.update({ where: { id: route.id }, data: { actualStartTime: nueva } }),
        ...(route.trip ? [prisma.trip.update({
            where: { id: route.trip.id },
            data: {
                ...(mismo(route.trip.startedAt) ? { startedAt: nueva } : {}),
                ...(mismo(route.trip.exitTime) ? { exitTime: nueva } : {})
            }
        })] : [])
    ]);
    await prisma.auditLog.create({
        data: {
            userName: opciones.quien || 'Sistema (salida real por GPS)', action: 'UPDATE', entity: 'Trip',
            entityId: String(route.tripId ?? route.id), entityName: `Salida del deposito por GPS (+${res.minutosSumados} min)`,
            before: JSON.stringify({ actualStartTime: res.salidaAntes, startedAt: route.trip?.startedAt ?? null, exitTime: route.trip?.exitTime ?? null }),
            after: JSON.stringify({ actualStartTime: res.salidaNueva })
        }
    }).catch(() => {});
    res.guardado = true;
    return res;
}

/** Para el cierre del viaje: nunca tira ni frena. */
export async function corregirSalidaAlCerrar(prisma: any, ref: { routeId?: number; tripId?: number }): Promise<void> {
    try {
        const r = await corregirSalidaDelViaje(prisma, ref);
        if (r?.guardado) console.log(`[salida real] viaje ${r.tripId}: +${r.minutosSumados} min (GPS del deposito)`);
    } catch (e: any) {
        console.warn('[salida real] ' + JSON.stringify(ref) + ':', e?.message || e);
    }
}
