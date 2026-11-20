/* ============================================================================
 * A QUE VIAJE VA CADA PUNTO DE GPS
 * ============================================================================
 * El celular manda cada punto con el viaje que tiene elegido. Un chofer que
 * hace dos o tres viajes en el dia (el R22: su reparto, los CDI, un LIBRE)
 * empieza el segundo y el celular sigue mandando con el primero: el segundo
 * viaje quedaba sin un solo punto. Del 16 al 19-nov-2026 pasaba en 18 de 118
 * viajes.
 *
 * Regla: un punto es del viaje que ESE chofer tenia en curso a ESA hora (entre
 * el inicio y el fin real del recorrido). Si en ese momento habia dos abiertos,
 * del que arranco ultimo. Si no habia ninguno, queda con el que mando el
 * celular.
 *
 * Se aplica al guardar cada punto y, para lo ya guardado (o un viaje que se
 * inicio despues de que llegaron sus puntos), con reasignarGpsDeRutas.
 * ========================================================================= */

export interface VentanaDeRuta { id: number; ini: Date; fin: Date | null }

/** El viaje que el chofer tenia en curso a la hora `t`, o null. */
export function rutaEnHora(rutas: VentanaDeRuta[], t: Date, ahora: Date = new Date()): number | null {
    let mejor: VentanaDeRuta | null = null;
    for (const r of rutas) {
        const fin = r.fin ?? ahora;
        if (t < r.ini || t > fin) continue;
        if (!mejor || r.ini > mejor.ini || (r.ini.getTime() === mejor.ini.getTime() && r.id > mejor.id)) mejor = r;
    }
    return mejor ? mejor.id : null;
}

const HORA = 3600 * 1000;

/** Los recorridos de un chofer que pueden estar en curso entre desde y hasta. */
export async function ventanasDelChofer(prisma: any, driverId: string, desde: Date, hasta: Date): Promise<VentanaDeRuta[]> {
    const rutas = await prisma.route.findMany({
        where: {
            driverId,
            actualStartTime: { not: null, lte: hasta },
            OR: [{ actualEndTime: null }, { actualEndTime: { gte: desde } }]
        },
        select: { id: true, actualStartTime: true, actualEndTime: true },
        orderBy: { actualStartTime: 'asc' },
        take: 50
    });
    return rutas.map((r: any) => ({ id: r.id, ini: new Date(r.actualStartTime), fin: r.actualEndTime ? new Date(r.actualEndTime) : null }));
}

// Al guardar puntos se consulta una vez por minuto por chofer, no en cada lote
const _cache = new Map<string, { hecho: number; rutas: VentanaDeRuta[] }>();

/** Para el guardado: el viaje de cada punto. Los que no caen en ningun viaje
 *  quedan con el que mando el celular. */
export async function rutasDeLosPuntos(prisma: any, driverId: string | null, tiempos: Date[], delCelular: number | null): Promise<(number | null)[]> {
    if (!driverId || !tiempos.length) return tiempos.map(() => delCelular);
    let c = _cache.get(driverId);
    if (!c || Date.now() - c.hecho > 60000) {
        const ahora = new Date();
        c = { hecho: Date.now(), rutas: await ventanasDelChofer(prisma, driverId, new Date(ahora.getTime() - 36 * HORA), ahora) };
        _cache.set(driverId, c);
        if (_cache.size > 500) for (const [k, v] of _cache) if (Date.now() - v.hecho > 600000) _cache.delete(k);
    }
    // Un punto viejo (de la cola sin señal) puede ser de antes de lo cacheado:
    // ahi queda con lo que dijo el celular, y el repaso periodico lo acomoda.
    return tiempos.map((t) => rutaEnHora(c!.rutas, t) ?? delCelular);
}

/** Olvida lo cacheado de un chofer (al iniciar o cerrar uno de sus viajes). */
export function olvidarVentanasDelChofer(driverId: string | null | undefined) {
    if (driverId) _cache.delete(driverId);
}

export interface ResultadoReasignacion {
    rutasRevisadas: number;
    puntosMovidos: number;
    porRuta: { routeId: number; driverId: string; puntos: number; desde: (number | null)[] }[];
}

/** Pasa a cada viaje los puntos de su chofer que cayeron dentro de su horario
 *  y estaban guardados con otro viaje (o con ninguno). Los recorridos dibujados
 *  de los viajes tocados se borran para que se vuelvan a armar. */
export async function reasignarGpsDeRutas(prisma: any, desde: Date, hasta: Date, opciones: { dryRun?: boolean } = {}): Promise<ResultadoReasignacion> {
    const rutas = await prisma.route.findMany({
        where: {
            driverId: { not: null },
            actualStartTime: { not: null, lte: hasta },
            OR: [{ actualEndTime: null }, { actualEndTime: { gte: desde } }]
        },
        select: { id: true, driverId: true, actualStartTime: true, actualEndTime: true },
        orderBy: { actualStartTime: 'asc' }
    });
    const res: ResultadoReasignacion = { rutasRevisadas: rutas.length, puntosMovidos: 0, porRuta: [] };
    const tocadas = new Set<number>();
    const ahora = new Date();
    for (const r of rutas) {
        // Si otro viaje del mismo chofer arranca antes de que este termine, el
        // tramo en comun es del que arranco despues (la misma regla que al
        // guardar): este viaje llega hasta ahi, sin incluirlo. Asi una segunda
        // pasada no mueve nada.
        const ini = new Date(r.actualStartTime);
        let fin = r.actualEndTime ? new Date(r.actualEndTime) : ahora;
        let finAbierto = false;
        for (const o of rutas) {
            if (o.id === r.id || o.driverId !== r.driverId) continue;
            const oIni = new Date(o.actualStartTime);
            if ((oIni > ini || (oIni.getTime() === ini.getTime() && o.id > r.id)) && oIni <= fin) {
                fin = oIni; finAbierto = true;
            }
        }
        if (fin <= ini) continue;
        const where = {
            driverId: r.driverId,
            timestamp: { gte: ini, ...(finAbierto ? { lt: fin } : { lte: fin }) },
            OR: [{ routeId: null }, { routeId: { not: r.id } }]
        };
        const grupos = await prisma.deviceLocation.groupBy({ by: ['routeId'], where, _count: { _all: true } });
        const n = grupos.reduce((a: number, g: any) => a + (g._count?._all || 0), 0);
        if (!n) continue;
        if (!opciones.dryRun) await prisma.deviceLocation.updateMany({ where, data: { routeId: r.id } });
        res.puntosMovidos += n;
        res.porRuta.push({ routeId: r.id, driverId: r.driverId, puntos: n, desde: grupos.map((g: any) => g.routeId ?? null) });
        tocadas.add(r.id);
        for (const g of grupos) if (g.routeId != null) tocadas.add(Number(g.routeId));
    }
    if (!opciones.dryRun && tocadas.size) {
        await prisma.recorridoReal.deleteMany({ where: { routeId: { in: [...tocadas] } } }).catch(() => {});
    }
    return res;
}
