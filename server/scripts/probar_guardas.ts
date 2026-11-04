/**
 * Prueba de las guardas de viaje con un Prisma falso en memoria.
 *
 *   cd server && npx ts-node scripts/probar_guardas.ts
 *
 * Termina con exit 0 solo si pasa todo.
 */
import {
    levenshtein, proveedoresParecidos, normalizarNombre, diaDelViaje,
    cerrarViajeAnteriorDelChofer, completarViajeCreadoParaFechaPasada,
    loQueEsElChoferDesdePrisma, ClientePrisma
} from '../src/guardasDeViaje';

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const igualFecha = (a: any, b: any) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

// ───────────────────────── Prisma falso ─────────────────────────
type Fila = Record<string, any>;
function prismaFalso(datos: { trips: Fila[]; routes: Fila[]; stops: Fila[]; users?: Fila[]; providers?: Fila[] }) {
    const { trips, routes, stops } = datos;
    const users = datos.users || [];
    const providers = datos.providers || [];
    const escrituras: string[] = [];

    const rutaDe = (tripId: number) => routes.find((r) => r.tripId === tripId) || null;
    const paradasDe = (routeId: number) => stops.filter((s) => s.routeId === routeId);
    const tripCompleto = (t: Fila) => {
        const r = rutaDe(t.id);
        return { ...t, linkedRoute: r ? { ...r, stops: paradasDe(r.id) } : null };
    };
    const pasaFiltro = (valor: any, cond: any): boolean => {
        if (cond === null) return valor === null || valor === undefined;
        if (typeof cond !== 'object' || cond instanceof Date) return valor === cond;
        if ('not' in cond) {
            if (cond.not === null) return valor !== null && valor !== undefined;
            return valor !== cond.not;
        }
        if ('in' in cond) return cond.in.includes(valor);
        if ('gte' in cond || 'lte' in cond) {
            const v = new Date(valor).getTime();
            if ('gte' in cond && v < new Date(cond.gte).getTime()) return false;
            if ('lte' in cond && v > new Date(cond.lte).getTime()) return false;
            return true;
        }
        return true;
    };
    const cumple = (fila: Fila, where: Fila) => Object.entries(where || {}).every(([k, cond]) => pasaFiltro(fila[k], cond));

    const cliente: any = {
        _escrituras: escrituras,
        trip: {
            findUnique: async ({ where }: any) => {
                const t = trips.find((x) => x.id === where.id);
                return t ? tripCompleto(t) : null;
            },
            update: async ({ where, data }: any) => {
                const t = trips.find((x) => x.id === where.id);
                if (!t) throw new Error('trip ' + where.id + ' no existe');
                Object.assign(t, data);
                escrituras.push('trip ' + t.id);
                return { ...t };
            }
        },
        route: {
            findMany: async ({ where }: any) => routes
                .filter((r) => cumple(r, where))
                .map((r) => ({ ...r, trip: trips.find((t) => t.id === r.tripId) || null, stops: paradasDe(r.id) })),
            update: async ({ where, data }: any) => {
                const r = routes.find((x) => x.id === where.id);
                if (!r) throw new Error('route ' + where.id + ' no existe');
                Object.assign(r, data);
                escrituras.push('route ' + r.id);
                return { ...r };
            }
        },
        stop: {
            update: async ({ where, data }: any) => {
                const s = stops.find((x) => x.id === where.id);
                if (!s) throw new Error('stop ' + where.id + ' no existe');
                Object.assign(s, data);
                escrituras.push('stop ' + s.id);
                return { ...s };
            },
            updateMany: async ({ where, data }: any) => {
                let n = 0;
                for (const s of stops) if (cumple(s, where)) { Object.assign(s, data); escrituras.push('stop ' + s.id); n++; }
                return { count: n };
            }
        },
        user: { findMany: async () => users.map((u) => ({ ...u })) },
        provider: { findMany: async () => providers.map((p) => ({ ...p })) },
        $transaction: async (fn: (tx: any) => Promise<any>) => fn(cliente)
    };
    return cliente as ClientePrisma & { _escrituras: string[] };
}

const hora = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00.000Z`);

async function main() {
    // ═════════════════ 1. Proveedores parecidos ═════════════════
    console.log('\n1. proveedoresParecidos (Levenshtein)');
    esperar('levenshtein ALAM AMO / ALAN AMO = 1', levenshtein('ALAM AMO', 'ALAN AMO') === 1, levenshtein('ALAM AMO', 'ALAN AMO'));
    esperar('levenshtein vacio / ABC = 3', levenshtein('', 'ABC') === 3);
    esperar('levenshtein GUSTAVO PEREZ / JOSE PEREZ > 2', levenshtein('GUSTAVO PEREZ', 'JOSE PEREZ') > 2, levenshtein('GUSTAVO PEREZ', 'JOSE PEREZ'));
    esperar('normalizar quita tildes y colapsa espacios', normalizarNombre('  josé   pérez ') === 'JOSE PEREZ', normalizarNombre('  josé   pérez '));

    const pares = proveedoresParecidos([
        'ALAM AMO', 'ALAN AMO', 'JOSE PEREZ', 'JOSÉ PÉREZ', 'GUSTAVO PEREZ',
        'JAVIER GAREIS', 'JAVIER  GAREIS', 'MARIANO ANTICH', 'ALAM AMO'
    ]);
    const tiene = (a: string, b: string) => pares.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
    esperar('detecta ALAM AMO / ALAN AMO', tiene('ALAM AMO', 'ALAN AMO'), pares);
    esperar('con distancia 1', pares.find((p) => tiene(p.a, p.b) && p.a.includes('AMO'))?.distancia === 1, pares);
    esperar('JOSE PEREZ / JOSÉ PÉREZ NO es par (son iguales tras normalizar)', !tiene('JOSE PEREZ', 'JOSÉ PÉREZ'), pares);
    esperar('GUSTAVO PEREZ / JOSE PEREZ NO es par', !tiene('GUSTAVO PEREZ', 'JOSE PEREZ'), pares);
    esperar('JAVIER GAREIS con doble espacio NO es par', !pares.some((p) => p.a.includes('GAREIS')), pares);
    esperar('un solo par en total', pares.length === 1, pares);
    esperar('lista vacia -> sin pares', proveedoresParecidos([]).length === 0);

    // ═════════════════ 2. Cerrar el viaje anterior del chofer ═════════════════
    console.log('\n2. cerrarViajeAnteriorDelChofer');
    const dia = '2026-10-02', ayer = '2026-10-01';
    const fecha = (ymd: string) => new Date(`${ymd}T15:00:00.000Z`);
    const datos = () => ({
        trips: [
            { id: 1, date: fecha(dia), driver: 'GUSTAVO MARTELLI', reparto: 'R17', status: 'OUT_OF_PLANT', completedAt: null, returnTime: null },
            { id: 2, date: fecha(dia), driver: 'Gustavo Martelli', reparto: 'SAM 4 VIERNES R17', status: 'PENDING', completedAt: null, returnTime: null },
            { id: 3, date: fecha(ayer), driver: 'GUSTAVO MARTELLI', reparto: 'R17', status: 'OUT_OF_PLANT', completedAt: null, returnTime: null },
            { id: 4, date: fecha(dia), driver: 'GUSTAVO MARTELLI', reparto: 'LIBRE', status: 'COMPLETED', completedAt: hora(dia, '07:00'), returnTime: hora(dia, '07:00') },
            { id: 5, date: fecha(dia), driver: 'DANIEL DAROSA', reparto: 'R1', status: 'OUT_OF_PLANT', completedAt: null, returnTime: null },
        ],
        routes: [
            { id: 101, tripId: 1, driverId: 'u-r17', date: fecha(dia), status: 'IN_PROGRESS', actualStartTime: hora(dia, '08:48'), actualEndTime: null },
            { id: 102, tripId: 2, driverId: 'u-r17', date: fecha(dia), status: 'PLANNED', actualStartTime: null, actualEndTime: null },
            { id: 103, tripId: 3, driverId: 'u-r17', date: fecha(ayer), status: 'IN_PROGRESS', actualStartTime: hora(ayer, '08:15'), actualEndTime: null },
            { id: 104, tripId: 4, driverId: 'u-r17', date: fecha(dia), status: 'COMPLETED', actualStartTime: hora(dia, '06:00'), actualEndTime: hora(dia, '07:00') },
            { id: 105, tripId: 5, driverId: 'u-r1', date: fecha(dia), status: 'IN_PROGRESS', actualStartTime: hora(dia, '08:30'), actualEndTime: null },
        ],
        stops: [
            { id: 1001, routeId: 101, status: 'COMPLETED', isReturnToBase: false, actualArrival: hora(dia, '09:51'), actualDeparture: hora(dia, '10:02') },
            { id: 1002, routeId: 101, status: 'PENDING', isReturnToBase: true, actualArrival: null, actualDeparture: null },
            { id: 1003, routeId: 103, status: 'PENDING', isReturnToBase: true, actualArrival: null, actualDeparture: null },
            { id: 1004, routeId: 104, status: 'COMPLETED', isReturnToBase: true, actualArrival: hora(dia, '07:00'), actualDeparture: hora(dia, '07:00') },
            { id: 1005, routeId: 105, status: 'PENDING', isReturnToBase: true, actualArrival: null, actualDeparture: null },
        ]
    });

    {
        const d = datos();
        const p = prismaFalso(d);
        const ahora = hora(dia, '11:46');
        const r = await cerrarViajeAnteriorDelChofer(p, 2, ahora);
        esperar('cierra el R17 abierto del mismo dia', r.cerrado?.tripId === 1, r);
        esperar('informa reparto y desde cuando estaba abierto', r.cerrado?.reparto === 'R17' && igualFecha(r.cerrado?.abiertoDesde, hora(dia, '08:48')), r.cerrado);
        esperar('no habia otros abiertos', r.otrosCerrados.length === 0, r.otrosCerrados);
        const ruta1 = d.routes.find((x) => x.id === 101)!;
        const viaje1 = d.trips.find((x) => x.id === 1)!;
        esperar('ruta: actualEndTime = ahora y COMPLETED', igualFecha(ruta1.actualEndTime, ahora) && ruta1.status === 'COMPLETED', ruta1);
        esperar('viaje: COMPLETED, completedAt y returnTime = ahora',
            viaje1.status === 'COMPLETED' && igualFecha(viaje1.completedAt, ahora) && igualFecha(viaje1.returnTime, ahora), viaje1);
        const deposito1 = d.stops.find((x) => x.id === 1002)!;
        esperar('parada de deposito movida a ahora y COMPLETED',
            deposito1.status === 'COMPLETED' && igualFecha(deposito1.actualArrival, ahora) && igualFecha(deposito1.actualDeparture, ahora), deposito1);
        const escuela = d.stops.find((x) => x.id === 1001)!;
        esperar('la parada de escuela no se toca', escuela.status === 'COMPLETED' && igualFecha(escuela.actualDeparture, hora(dia, '10:02')), escuela);
        const ruta3 = d.routes.find((x) => x.id === 103)!;
        const viaje3 = d.trips.find((x) => x.id === 3)!;
        esperar('el viaje abierto de AYER no se toca', ruta3.actualEndTime === null && viaje3.status === 'OUT_OF_PLANT' && d.stops.find((x) => x.id === 1003)!.status === 'PENDING', { ruta3, viaje3 });
        const ruta4 = d.routes.find((x) => x.id === 104)!;
        esperar('el viaje ya cerrado no se toca', igualFecha(ruta4.actualEndTime, hora(dia, '07:00')) && igualFecha(d.trips.find((x) => x.id === 4)!.completedAt, hora(dia, '07:00')), ruta4);
        const ruta5 = d.routes.find((x) => x.id === 105)!;
        esperar('el viaje abierto de OTRO chofer no se toca', ruta5.actualEndTime === null && d.trips.find((x) => x.id === 5)!.status === 'OUT_OF_PLANT', ruta5);
        esperar('el viaje que arranca no se toca', d.routes.find((x) => x.id === 102)!.actualStartTime === null && d.trips.find((x) => x.id === 2)!.status === 'PENDING');
        esperar('escribio ruta, viaje y deposito del 1, nada mas',
            p._escrituras.slice().sort().join(',') === ['route 101', 'stop 1002', 'trip 1'].join(','), p._escrituras);
    }
    {
        const d = datos();
        const p = prismaFalso(d);
        const r = await cerrarViajeAnteriorDelChofer(p, 2, hora(dia, '11:46'), { dryRun: true });
        esperar('dryRun: informa el que cerraria', r.cerrado?.tripId === 1 && r.dryRun === true, r);
        esperar('dryRun: no escribe nada', p._escrituras.length === 0 && d.routes.find((x) => x.id === 101)!.actualEndTime === null, p._escrituras);
    }
    {
        const d = datos();
        d.routes.find((x) => x.id === 101)!.actualEndTime = hora(dia, '11:00'); // el R17 ya cerro
        const p = prismaFalso(d);
        const r = await cerrarViajeAnteriorDelChofer(p, 2, hora(dia, '11:46'));
        esperar('sin viaje abierto del dia -> cerrado null', r.cerrado === null && p._escrituras.length === 0, r);
    }
    {
        // Por nombre aunque la ruta apunte a otra cuenta, y con el nombre al reves y con tilde
        const d = datos();
        d.routes.find((x) => x.id === 102)!.driverId = 'u-otro';
        d.trips.find((x) => x.id === 2)!.driver = 'Martelli Gustávo';
        const p = prismaFalso(d);
        const r = await cerrarViajeAnteriorDelChofer(p, 2, hora(dia, '11:46'));
        esperar('con cuenta distinta pero MISMO orden de nombre (normalizado) no empareja: Martelli Gustavo != GUSTAVO MARTELLI', r.cerrado === null, r);
        d.trips.find((x) => x.id === 2)!.driver = 'gustavo martélli';
        const r2 = await cerrarViajeAnteriorDelChofer(prismaFalso(d), 2, hora(dia, '11:46'));
        esperar('con cuenta distinta y nombre igual (minusculas, tilde) empareja', r2.cerrado?.tripId === 1, r2);
    }
    {
        // Viaje guardado con fecha a medianoche UTC (carga vieja): sigue siendo ese dia
        esperar('diaDelViaje de 15:00Z es el dia de Buenos Aires', diaDelViaje(new Date('2026-10-02T15:00:00.000Z')) === '2026-10-02');
        esperar('diaDelViaje de 00:00Z (fecha pelada) es ese mismo dia, no el anterior', diaDelViaje(new Date('2026-10-02T00:00:00.000Z')) === '2026-10-02');
        esperar('diaDelViaje de 03:00Z (medianoche local) es ese dia', diaDelViaje(new Date('2026-10-02T03:00:00.000Z')) === '2026-10-02');
        esperar('diaDelViaje de 02:30Z es el dia anterior en Buenos Aires', diaDelViaje(new Date('2026-10-03T02:30:00.000Z')) === '2026-10-02');
    }

    // ═════════════════ 3. Completar viaje creado para fecha pasada ═════════════════
    console.log('\n3. completarViajeCreadoParaFechaPasada');
    const hoy = new Date('2026-11-04T14:00:00.000Z'); // 11:00 de Buenos Aires
    const pasado = '2026-10-20', hoyYmd = '2026-11-04';
    const usuarios = [
        { username: 'ALEX_AVALOS', fullName: 'ALEX AVALOS', contractType: 'TERCERIZADO', providerId: 'p1', active: true },
        { username: 'R1', fullName: 'ALEX AVALOS', contractType: null, providerId: null, active: true },      // la cuenta del celular, vacia
        { username: 'DIEGO_GUIDA', fullName: 'DIEGO GUIDA', contractType: 'PROPIO', providerId: null, active: true },
        { username: 'juan', fullName: 'ALEX AVALOS', contractType: 'PROPIO', providerId: null, active: true }, // cuenta de prueba: no cuenta
    ];
    const proveedores = [{ id: 'p1', name: 'MARIANO ANTICH' }];
    const datos3 = () => ({
        users: usuarios, providers: proveedores,
        trips: [
            { id: 10, date: fecha(pasado), driver: 'ALEX AVALOS', contractType: 'Tercerizado', provider: null, status: 'PENDING', completedAt: null, returnTime: null },
            { id: 11, date: fecha(hoyYmd), driver: 'ALEX AVALOS', contractType: 'Tercerizado', provider: null, status: 'PENDING', completedAt: null, returnTime: null },
            { id: 12, date: fecha(pasado), driver: 'ALEX AVALOS', contractType: 'Tercerizado', provider: null, status: 'PENDING', completedAt: null, returnTime: null },
            { id: 13, date: fecha(pasado), driver: 'Alex Avalos', contractType: null, provider: null, status: 'PENDING', completedAt: null, returnTime: null },
            { id: 14, date: fecha(pasado), driver: 'ALEX AVALOS', contractType: 'Propio', provider: null, status: 'PENDING', completedAt: null, returnTime: null },
            { id: 15, date: fecha(pasado), driver: 'DIEGO GUIDA', contractType: 'Propio', provider: null, status: 'PENDING', completedAt: null, returnTime: null },
        ],
        routes: [
            { id: 110, tripId: 10, driverId: 'u', date: fecha(pasado), status: 'PLANNED', actualStartTime: hora(pasado, '08:30'), actualEndTime: hora(pasado, '12:10') },
            { id: 111, tripId: 11, driverId: 'u', date: fecha(hoyYmd), status: 'IN_PROGRESS', actualStartTime: hora(hoyYmd, '08:30'), actualEndTime: hora(hoyYmd, '12:10') },
            { id: 112, tripId: 12, driverId: 'u', date: fecha(pasado), status: 'PLANNED', actualStartTime: null, actualEndTime: null },
            { id: 113, tripId: 13, driverId: 'u', date: fecha(pasado), status: 'PLANNED', actualStartTime: null, actualEndTime: null },
            { id: 114, tripId: 14, driverId: 'u', date: fecha(pasado), status: 'PLANNED', actualStartTime: null, actualEndTime: null },
            { id: 115, tripId: 15, driverId: 'u', date: fecha(pasado), status: 'PLANNED', actualStartTime: null, actualEndTime: null },
        ],
        stops: [
            { id: 2001, routeId: 110, status: 'PENDING', isReturnToBase: false, actualArrival: hora(pasado, '09:00'), actualDeparture: hora(pasado, '09:10') },
            { id: 2002, routeId: 110, status: 'ARRIVED', isReturnToBase: false, actualArrival: hora(pasado, '09:30'), actualDeparture: hora(pasado, '09:40') },
            { id: 2003, routeId: 110, status: 'PENDING', isReturnToBase: false, actualArrival: null, actualDeparture: null },
            { id: 2004, routeId: 110, status: 'COMPLETED', isReturnToBase: false, actualArrival: hora(pasado, '10:00'), actualDeparture: hora(pasado, '10:05') },
            { id: 2005, routeId: 110, status: 'PENDING', isReturnToBase: true, actualArrival: hora(pasado, '12:10'), actualDeparture: hora(pasado, '12:10') },
            { id: 2011, routeId: 111, status: 'PENDING', isReturnToBase: false, actualArrival: hora(hoyYmd, '09:00'), actualDeparture: hora(hoyYmd, '09:10') },
        ]
    });

    {
        const p = prismaFalso(datos3());
        const f = await loQueEsElChoferDesdePrisma(p, 'ALEX AVALOS');
        esperar('ficha: gana la cuenta mas completa (TERCERIZADO + MARIANO ANTICH), no la del celular ni la de prueba',
            f?.tipo === 'Tercerizado' && f?.proveedor === 'MARIANO ANTICH', f);
        const g = await loQueEsElChoferDesdePrisma(p, 'Guida Diego');
        esperar('ficha: propio sin proveedor, con el nombre al reves', g?.tipo === 'Propio' && g?.proveedor === null, g);
        esperar('ficha: desconocido -> null', (await loQueEsElChoferDesdePrisma(p, 'NADIE')) === null);
    }
    {
        const d = datos3();
        const p = prismaFalso(d);
        const r = await completarViajeCreadoParaFechaPasada(p, 10, { hoy });
        esperar('fecha pasada detectada', r.esFechaPasada === true && r.fechaViaje === pasado && r.hoy === hoyYmd, r);
        esperar('proveedor completado desde la ficha', r.cambios.provider?.despues === 'MARIANO ANTICH', r.cambios);
        const v = d.trips.find((x) => x.id === 10)!;
        esperar('viaje: provider escrito', v.provider === 'MARIANO ANTICH', v);
        esperar('viaje: COMPLETED con completedAt y returnTime = fin de la ventana',
            v.status === 'COMPLETED' && igualFecha(v.completedAt, hora(pasado, '12:10')) && igualFecha(v.returnTime, hora(pasado, '12:10')), v);
        esperar('ruta: COMPLETED', d.routes.find((x) => x.id === 110)!.status === 'COMPLETED');
        const est = (id: number) => d.stops.find((x) => x.id === id)!.status;
        esperar('paradas con las dos horas -> COMPLETED (incluida la ARRIVED y el deposito)',
            est(2001) === 'COMPLETED' && est(2002) === 'COMPLETED' && est(2005) === 'COMPLETED', d.stops);
        esperar('parada sin horario sigue PENDING', est(2003) === 'PENDING');
        esperar('informa 3 paradas cerradas (la que ya estaba COMPLETED no cuenta)', r.cambios.paradasCerradas === 3, r.cambios);
        esperar('el contrato no se toco (ya era Tercerizado)', r.cambios.contractType === null && v.contractType === 'Tercerizado', r.cambios);
    }
    {
        const d = datos3();
        const p = prismaFalso(d);
        const r = await completarViajeCreadoParaFechaPasada(p, 11, { hoy });
        const v = d.trips.find((x) => x.id === 11)!;
        esperar('viaje de HOY: proveedor completado', v.provider === 'MARIANO ANTICH', v);
        esperar('viaje de HOY: NO se cierra aunque tenga ventana', v.status === 'PENDING' && !r.cambios.viajeCerrado && !r.cambios.rutaCerrada && r.cambios.paradasCerradas === 0, r);
        esperar('viaje de HOY: la parada queda como estaba', d.stops.find((x) => x.id === 2011)!.status === 'PENDING');
        esperar('explica por que no cerro', !!r.motivoSinCerrar, r);
    }
    {
        const d = datos3();
        const p = prismaFalso(d);
        const r = await completarViajeCreadoParaFechaPasada(p, 12, { hoy });
        esperar('fecha pasada SIN ventana: proveedor si, cierre no', d.trips.find((x) => x.id === 12)!.provider === 'MARIANO ANTICH' && d.trips.find((x) => x.id === 12)!.status === 'PENDING' && /ventana/.test(r.motivoSinCerrar || ''), r);
    }
    {
        const d = datos3();
        const p = prismaFalso(d);
        const r = await completarViajeCreadoParaFechaPasada(p, 13, { hoy });
        const v = d.trips.find((x) => x.id === 13)!;
        esperar('sin contrato: se pone el de la ficha y el proveedor', v.contractType === 'Tercerizado' && v.provider === 'MARIANO ANTICH' && r.cambios.contractType?.antes === null, { v, r });
    }
    {
        const d = datos3();
        const p = prismaFalso(d);
        await completarViajeCreadoParaFechaPasada(p, 14, { hoy });
        const v = d.trips.find((x) => x.id === 14)!;
        esperar('"Propio" cargado se respeta por defecto (no se pisa ni se pone proveedor)', v.contractType === 'Propio' && v.provider === null, v);
        const d2 = datos3();
        const p2 = prismaFalso(d2);
        const r2 = await completarViajeCreadoParaFechaPasada(p2, 14, { hoy, pisarContratoConFicha: true });
        const v2 = d2.trips.find((x) => x.id === 14)!;
        esperar('con pisarContratoConFicha el "Propio" por defecto pasa a Tercerizado + proveedor',
            v2.contractType === 'Tercerizado' && v2.provider === 'MARIANO ANTICH' && r2.cambios.contractType?.antes === 'Propio', { v2, r2 });
    }
    {
        const d = datos3();
        const p = prismaFalso(d);
        const r = await completarViajeCreadoParaFechaPasada(p, 15, { hoy });
        esperar('chofer propio: no se escribe nada', p._escrituras.length === 0 && r.cambios.provider === null, { r, e: p._escrituras });
    }
    {
        const d = datos3();
        const p = prismaFalso(d);
        const r = await completarViajeCreadoParaFechaPasada(p, 10, { hoy, dryRun: true });
        esperar('dryRun: informa los cambios', r.cambios.provider?.despues === 'MARIANO ANTICH' && r.cambios.viajeCerrado && r.cambios.paradasCerradas === 3, r);
        esperar('dryRun: no escribe', p._escrituras.length === 0 && d.trips.find((x) => x.id === 10)!.status === 'PENDING', p._escrituras);
    }
    {
        const p = prismaFalso(datos3());
        const r = await completarViajeCreadoParaFechaPasada(p, 10, {
            hoy, ficha: async () => ({ tipo: 'Tercerizado', proveedor: 'OTRO PROVEEDOR' })
        });
        esperar('la ficha se puede inyectar (loQueEsElChofer de index.ts)', r.cambios.provider?.despues === 'OTRO PROVEEDOR', r.cambios);
    }
    {
        let fallo = false;
        try { await completarViajeCreadoParaFechaPasada(prismaFalso(datos3()), 999, { hoy }); } catch { fallo = true; }
        esperar('viaje inexistente -> error', fallo);
    }

    console.log('\n' + (todo ? 'TODO OK' : 'HAY FALLAS'));
    process.exit(todo ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
