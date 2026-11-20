/**
 * Horas estimadas para las paradas de un viaje que se cerro sin marcarlas.
 *
 * Pasa con los viajes LIBRE cargados a mano y con choferes que no marcaron:
 * el viaje figura finalizado, con salida y llegada, pero sus paradas no
 * tienen hora. Entonces el desglose del viaje no muestra horarios y las
 * horas por unidad de negocio no se pueden repartir por lo que paso.
 *
 * Que se completa:
 *  - Las paradas ENTREGADAS sin hora (siempre).
 *  - Las paradas pendientes, solo si el viaje no tiene NINGUNA parada marcada:
 *    el viaje se cerro entero sin marcar, asi que se toman como hechas. Si el
 *    chofer marco otras y esta no, puede que no haya ido: no se inventa.
 *
 * De donde sale la hora:
 *  1. Del GPS del recorrido: cuando el camion estuvo parado cerca del lugar.
 *  2. Si no hay GPS: se reparte la duracion del viaje en partes iguales, en el
 *     orden de las paradas, respetando las que si tienen hora.
 */

export interface ParadaParaEstimar {
    id: number;
    sequence: number;
    status: string | null;
    llegada: Date | null;
    salida: Date | null;
    deposito: boolean;
    lat?: number | null;
    lng?: number | null;
}

export interface PuntoGps { lat: number; lng: number; t: number }

export interface HoraEstimada {
    id: number;
    llegada: Date;
    salida: Date;
    como: 'GPS' | 'repartida';
    /** Estaba pendiente y pasa a entregada. */
    marcarEntregada: boolean;
}

export interface Estimacion {
    cambios: HoraEstimada[];
    /** Por que no se toco el viaje, si no se toco. */
    salteado?: string;
    /** Paradas pendientes que se dejaron asi (el chofer marco otras). */
    pendientesQueQuedan: number;
}

const MIN = 60000;
const MARCADA = new Set(['COMPLETED', 'UNDELIVERABLE', 'FAILED']);

const tieneHora = (p: ParadaParaEstimar) => !!(p.llegada || p.salida);
const estado = (p: ParadaParaEstimar) => String(p.status || 'PENDING').toUpperCase();

function distancia(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const r = Math.PI / 180;
    const x = (lng2 - lng1) * r * Math.cos(((lat1 + lat2) / 2) * r);
    const y = (lat2 - lat1) * r;
    return Math.sqrt(x * x + y * y) * 6371000;
}

/** La estadia mas larga del camion cerca del lugar, entre desde y hasta.
 *  Una pasada de largo (un solo punto, o menos de un minuto) no cuenta. */
export function estadiaGps(puntos: PuntoGps[], lat: number, lng: number, desde: number, hasta: number) {
    for (const radio of [120, 200]) {
        const visitas: { ini: number; fin: number }[] = [];
        let cur: { ini: number; fin: number } | null = null;
        for (const p of puntos) {
            if (p.t < desde || p.t > hasta) continue;
            if (distancia(p.lat, p.lng, lat, lng) <= radio) {
                if (!cur) cur = { ini: p.t, fin: p.t };
                cur.fin = p.t;
            } else if (cur) { visitas.push(cur); cur = null; }
        }
        if (cur) visitas.push(cur);
        const buenas = visitas.filter((v) => v.fin - v.ini >= MIN);
        if (buenas.length) {
            buenas.sort((a, b) => (b.fin - b.ini) - (a.fin - a.ini));
            return buenas[0];
        }
    }
    return null;
}

export function estimarHorasDeParadas(
    paradas: ParadaParaEstimar[],
    inicio: Date | null,
    fin: Date | null,
    gps: PuntoGps[] = []
): Estimacion {
    const reales = paradas.filter((p) => !p.deposito).sort((a, b) => a.sequence - b.sequence);
    const nadaMarcado = reales.every((p) => !tieneHora(p) && !MARCADA.has(estado(p)));
    const aCompletar = (p: ParadaParaEstimar) =>
        !tieneHora(p) && (estado(p) === 'COMPLETED' || (nadaMarcado && !MARCADA.has(estado(p))));
    const pendientesQueQuedan = reales.filter((p) => !tieneHora(p) && !aCompletar(p) && !MARCADA.has(estado(p))).length;

    if (!reales.some(aCompletar)) return { cambios: [], pendientesQueQuedan };
    if (!inicio || !fin) return { cambios: [], pendientesQueQuedan, salteado: 'no tiene hora de salida o de llegada' };
    const t0 = inicio.getTime(), t1 = fin.getTime();
    if (!(t1 - t0 >= 5 * MIN)) return { cambios: [], pendientesQueQuedan, salteado: 'el viaje dura menos de 5 minutos: falta la hora real de salida o de llegada' };

    // La linea de tiempo: las que ya tienen hora y las que hay que completar
    const linea = reales.filter((p) => tieneHora(p) || aCompletar(p)).map((p) => ({
        p,
        llegada: p.llegada ? p.llegada.getTime() : (p.salida ? p.salida.getTime() : null) as number | null,
        salida: p.salida ? p.salida.getTime() : (p.llegada ? p.llegada.getTime() : null) as number | null,
        como: null as HoraEstimada['como'] | null
    }));

    const antesDe = (i: number) => { for (let j = i - 1; j >= 0; j--) if (linea[j].salida != null) return linea[j].salida!; return t0; };
    const despuesDe = (i: number) => { for (let j = i + 1; j < linea.length; j++) if (linea[j].llegada != null) return linea[j].llegada!; return t1; };

    /** El hueco libre mas largo del viaje: entre la salida de una parada con
     *  hora y la llegada a la siguiente (o el arranque / el cierre). Se usa
     *  cuando las paradas con hora no siguen el orden de la lista y entonces
     *  "entre la anterior y la siguiente" no es un intervalo. */
    const mayorHueco = (): [number, number] => {
        const ocupado = linea.filter((x) => x.llegada != null)
            .map((x) => [x.llegada!, x.salida!] as [number, number])
            .sort((a, b) => a[0] - b[0]);
        let mejor: [number, number] = [t0, t1], largo = -1, cursor = t0;
        for (const [ll, sa] of [...ocupado, [t1, t1] as [number, number]]) {
            if (ll - cursor > largo) { largo = ll - cursor; mejor = [cursor, ll]; }
            cursor = Math.max(cursor, sa);
        }
        return mejor;
    };

    // 1. GPS, en orden: cada parada encontrada pasa a ser punto fijo de las siguientes
    if (gps.length) {
        const puntos = [...gps].sort((a, b) => a.t - b.t);
        linea.forEach((x, i) => {
            if (x.llegada != null || x.p.lat == null || x.p.lng == null) return;
            let desde = antesDe(i), hasta = despuesDe(i);
            if (hasta <= desde) { desde = t0; hasta = t1; }
            const e = estadiaGps(puntos, x.p.lat, x.p.lng, desde, hasta);
            if (e) { x.llegada = e.ini; x.salida = e.fin; x.como = 'GPS'; }
        });
    }

    // 2. Lo que queda: tramos iguales entre los puntos fijos. Con k paradas
    // entre dos puntos fijos hay k+1 viajes (el ultimo, hasta el siguiente
    // punto o la vuelta al deposito).
    for (let i = 0; i < linea.length; i++) {
        if (linea[i].llegada != null) continue;
        let j = i;
        while (j < linea.length && linea[j].llegada == null) j++;
        const k = j - i;
        let desde = antesDe(i), hasta = despuesDe(j - 1);
        // Las de alrededor estan fuera de orden (o pegadas): no hay lugar
        // entre ellas, se van al hueco mas grande del viaje.
        const pisaOtra = linea.some((x) => x.llegada != null && x.salida! > desde && x.llegada! < hasta);
        if (hasta - desde < k * 4 * MIN || pisaOtra) [desde, hasta] = mayorHueco();
        const paso = Math.max(0, hasta - desde) / (k + 1);
        const espera = Math.min(10 * MIN, paso * 0.4);
        for (let n = 1; n <= k; n++) {
            const x = linea[i + n - 1];
            x.salida = Math.round(desde + paso * n);
            x.llegada = Math.round(x.salida - espera);
            x.como = 'repartida';
        }
        i = j - 1;
    }

    const cambios: HoraEstimada[] = linea.filter((x) => x.como).map((x) => ({
        id: x.p.id,
        llegada: new Date(x.llegada!),
        salida: new Date(x.salida!),
        como: x.como!,
        marcarEntregada: estado(x.p) !== 'COMPLETED'
    }));
    return { cambios, pendientesQueQuedan };
}

/** Paradas PENDIENTES de un viaje en el que el chofer marco otras: solo se
 *  dan por entregadas si el GPS muestra al camion parado ahi (al menos un
 *  minuto) dentro del horario del viaje. Sin esa prueba no se tocan. Es para
 *  usar a mano (los CDI del R22 que nunca se marcan), no al cerrar. */
export function pendientesConGps(paradas: ParadaParaEstimar[], inicio: Date | null, fin: Date | null, gps: PuntoGps[]): HoraEstimada[] {
    if (!inicio || !fin || !gps.length) return [];
    const puntos = [...gps].sort((a, b) => a.t - b.t);
    const salida: HoraEstimada[] = [];
    for (const p of paradas) {
        if (p.deposito || tieneHora(p) || MARCADA.has(estado(p)) || p.lat == null || p.lng == null) continue;
        const e = estadiaGps(puntos, p.lat, p.lng, inicio.getTime(), fin.getTime());
        if (e) salida.push({ id: p.id, llegada: new Date(e.ini), salida: new Date(e.fin), como: 'GPS', marcarEntregada: true });
    }
    return salida;
}

// ════════════════════════════════════════════════════════════════════════════
// Con la base: se usa al cerrar un viaje (cualquier camino), al corregir sus
// horarios, en un barrido periodico y desde /api/admin/estimar-horas-paradas.
// ════════════════════════════════════════════════════════════════════════════

/** El deposito de Real de 14 (la vuelta). "DEPOSITO TOLOSA" no: es el
 *  deposito de un cliente, una entrega como cualquier otra. */
function esNuestroDeposito(s: { isReturnToBase?: boolean | null; client?: { name?: string | null } | null }): boolean {
    if (s?.isReturnToBase) return true;
    const n = String(s?.client?.name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    return /^(REAL\s*(DE\s*)?(14|CATORCE)|R\s*14)\b/.test(n);
}

const aFecha = (v: any): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
};

/** Entre que horas tienen que caer las paradas. Lo que muestra la
 *  planificacion como salida y llegada (exitTime / returnTime) y la ventana
 *  del recorrido pueden diferir: se toma la parte en comun, asi las horas
 *  estimadas quedan adentro de las dos. Si no se pisan, manda la que tenga
 *  sentido (al menos 5 minutos). */
export function ventanaParaEstimar(
    ruta: { actualStartTime?: any; actualEndTime?: any },
    viaje: { exitTime?: any; returnTime?: any; startedAt?: any; completedAt?: any } | null
): { inicio: Date | null; fin: Date | null; de: 'comun' | 'recorrido' | 'viaje' | 'incompleta' } {
    const rI = aFecha(ruta.actualStartTime) || aFecha(viaje?.startedAt);
    const rF = aFecha(ruta.actualEndTime) || aFecha(viaje?.completedAt);
    const tI = aFecha(viaje?.exitTime), tF = aFecha(viaje?.returnTime);
    const sirve = (a: Date | null, b: Date | null) => !!(a && b && b.getTime() - a.getTime() >= 5 * MIN);
    const masTarde = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : a || b);
    const masTemprano = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : a || b);
    const cI = masTarde(rI, tI), cF = masTemprano(rF, tF);
    if (sirve(cI, cF)) return { inicio: cI, fin: cF, de: 'comun' };
    if (sirve(rI, rF)) return { inicio: rI, fin: rF, de: 'recorrido' };
    if (sirve(tI, tF)) return { inicio: tI, fin: tF, de: 'viaje' };
    return { inicio: rI || tI, fin: rF || tF, de: 'incompleta' };
}

export interface ResultadoHorasDelViaje {
    tripId: number | null;
    routeId: number;
    fecha: string | null;
    reparto: string | null;
    ventana: { inicio: string | null; fin: string | null; de: string };
    puntosGps: number;
    cambios: { stopId: number; nombre: string; llegada: string; salida: string; como: 'GPS' | 'repartida'; pasaAEntregada: boolean }[];
    salteado: string | null;
    pendientesQueQuedan: number;
    guardado: boolean;
}

export const NOTA_GPS = 'Hora estimada por GPS: el viaje se cerró sin marcar esta parada.';
export const NOTA_REPARTIDA = 'Hora estimada (repartida entre la salida y la llegada del viaje): el viaje se cerró sin marcar esta parada.';

/** Completa las horas de un viaje cerrado. No hace nada si el viaje esta
 *  abierto o si todas sus paradas ya tienen hora. Devuelve null si no hay
 *  ruta. */
export async function completarHorasDelViaje(
    prisma: any,
    ref: { tripId?: number; routeId?: number },
    opciones: { dryRun?: boolean; quien?: string; pendientesConGps?: boolean } = {}
): Promise<ResultadoHorasDelViaje | null> {
    const route = await prisma.route.findFirst({
        where: ref.routeId ? { id: ref.routeId } : { tripId: ref.tripId },
        select: {
            id: true, tripId: true, status: true, actualStartTime: true, actualEndTime: true,
            trip: { select: { id: true, date: true, reparto: true, status: true, startedAt: true, completedAt: true, exitTime: true, returnTime: true } },
            stops: {
                orderBy: { sequence: 'asc' },
                select: {
                    id: true, sequence: true, status: true, isReturnToBase: true, observations: true,
                    actualArrival: true, actualDeparture: true,
                    client: { select: { name: true, latitude: true, longitude: true } }
                }
            }
        }
    });
    if (!route) return null;
    const trip = route.trip || null;
    const ventana = ventanaParaEstimar(route, trip);
    const res: ResultadoHorasDelViaje = {
        tripId: route.tripId ?? null, routeId: route.id,
        fecha: trip?.date ? new Date(trip.date).toISOString().slice(0, 10) : null,
        reparto: trip?.reparto ?? null,
        ventana: { inicio: ventana.inicio?.toISOString() ?? null, fin: ventana.fin?.toISOString() ?? null, de: ventana.de },
        puntosGps: 0, cambios: [], salteado: null, pendientesQueQuedan: 0, guardado: false
    };
    const cerrado = !!route.actualEndTime || String(route.status || '').toUpperCase() === 'COMPLETED'
        || String(trip?.status || '').toUpperCase() === 'COMPLETED';
    if (!cerrado) { res.salteado = 'el viaje no esta finalizado'; return res; }

    const paradas: ParadaParaEstimar[] = route.stops.map((s: any) => ({
        id: s.id, sequence: s.sequence, status: s.status, deposito: esNuestroDeposito(s),
        llegada: s.actualArrival, salida: s.actualDeparture,
        lat: s.client?.latitude ?? null, lng: s.client?.longitude ?? null
    }));
    // Nada que completar: ni se busca el GPS
    if (!paradas.some((p) => !p.deposito && !p.llegada && !p.salida)) return res;

    const gps = (await prisma.deviceLocation.findMany({
        where: { routeId: route.id },
        select: { latitude: true, longitude: true, capturedAt: true, timestamp: true },
        orderBy: { timestamp: 'asc' }, take: 50000
    })).map((g: any) => ({ lat: g.latitude, lng: g.longitude, t: new Date(g.capturedAt || g.timestamp).getTime() }));
    res.puntosGps = gps.length;

    const est = estimarHorasDeParadas(paradas, ventana.inicio, ventana.fin, gps);
    if (opciones.pendientesConGps) {
        const ya = new Set(est.cambios.map((c) => c.id));
        const conGps = pendientesConGps(paradas, ventana.inicio, ventana.fin, gps).filter((c) => !ya.has(c.id));
        est.cambios.push(...conGps);
        est.pendientesQueQuedan = Math.max(0, est.pendientesQueQuedan - conGps.length);
    }
    res.salteado = est.salteado || null;
    res.pendientesQueQuedan = est.pendientesQueQuedan;
    const porId = new Map<number, any>(route.stops.map((s: any) => [s.id, s]));
    res.cambios = est.cambios.map((c) => ({
        stopId: c.id, nombre: porId.get(c.id)?.client?.name || '',
        llegada: c.llegada.toISOString(), salida: c.salida.toISOString(), como: c.como, pasaAEntregada: c.marcarEntregada
    }));
    if (opciones.dryRun || !est.cambios.length) return res;

    const antes = est.cambios.map((c) => {
        const s = porId.get(c.id);
        return {
            stopId: c.id, status: s.status,
            actualArrival: aFecha(s.actualArrival)?.toISOString() ?? null,
            actualDeparture: aFecha(s.actualDeparture)?.toISOString() ?? null,
            observations: s.observations ?? null
        };
    });
    await prisma.$transaction(est.cambios.map((c) => {
        const s = porId.get(c.id);
        const nota = c.como === 'GPS' ? NOTA_GPS : NOTA_REPARTIDA;
        return prisma.stop.update({
            // routeId en el where: si la parada cambio de ruta en el medio, falla en vez de pisar otra
            where: { id: c.id, routeId: route.id },
            data: {
                actualArrival: c.llegada, actualDeparture: c.salida,
                ...(c.marcarEntregada ? { status: 'COMPLETED' } : {}),
                observations: s.observations ? `${s.observations} · ${nota}` : nota
            }
        });
    }));
    await prisma.auditLog.create({
        data: {
            userName: opciones.quien || 'Sistema (horas estimadas)', action: 'UPDATE', entity: 'Trip',
            entityId: String(route.tripId ?? route.id), entityName: `Horas de parada estimadas (${est.cambios.length})`,
            before: JSON.stringify({ paradas: antes }), after: JSON.stringify({ ventana: res.ventana, paradas: res.cambios })
        }
    }).catch(() => { /* la auditoria nunca frena */ });
    res.guardado = true;
    return res;
}

/** Lo mismo, para llamar al final de un cierre: nunca tira ni frena. */
export async function completarHorasAlCerrar(prisma: any, ref: { tripId?: number; routeId?: number }): Promise<void> {
    try {
        const r = await completarHorasDelViaje(prisma, ref);
        if (r?.guardado) console.log(`[horas estimadas] viaje ${r.tripId}: ${r.cambios.length} parada(s)`);
    } catch (e: any) {
        console.warn('[horas estimadas] ' + JSON.stringify(ref) + ':', e?.message || e);
    }
}

/** Repasa los viajes finalizados de los ultimos dias que tienen paradas sin
 *  hora. Atrapa cualquier camino de cierre que no llame a lo de arriba. */
export async function barrerViajesSinHoras(prisma: any, dias = 10): Promise<ResultadoHorasDelViaje[]> {
    const desde = new Date(Date.now() - dias * 86400000);
    const viajes = await prisma.trip.findMany({
        where: {
            status: 'COMPLETED', date: { gte: desde },
            linkedRoute: { stops: { some: { isReturnToBase: false, actualArrival: null, actualDeparture: null, status: { notIn: ['UNDELIVERABLE', 'FAILED'] } } } }
        },
        select: { id: true }, take: 300
    });
    const hechos: ResultadoHorasDelViaje[] = [];
    for (const v of viajes) {
        try {
            const r = await completarHorasDelViaje(prisma, { tripId: v.id });
            if (r?.guardado) hechos.push(r);
        } catch (e: any) {
            console.warn('[horas estimadas] viaje ' + v.id + ':', e?.message || e);
        }
    }
    return hechos;
}
