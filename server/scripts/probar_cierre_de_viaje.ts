/**
 * Prueba el protocolo de cierre de un viaje sin base de datos: un prisma falso
 * que devuelve la ruta armada a mano y anota lo que se le pide escribir.
 *
 *   cd server && npx ts-node scripts/probar_cierre_de_viaje.ts
 *
 * Termina con exit 0 solo si pasa todo.
 */
import { normalizarViajeAlCerrar, InformeDeCierre } from '../src/cierreDeViaje';

// ── Herramientas ─────────────────────────────────────────────────────────────
let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};

/** Hora local de Buenos Aires del dia del viaje, como Date. */
const T = (hhmm: string, dia = '2026-10-15') => new Date(`${dia}T${hhmm}:00-03:00`);
const ISO = (hhmm: string) => T(hhmm).toISOString();

function parada(id: number, sequence: number, nombre: string, status: string,
                llegada?: Date | null, salida?: Date | null, extra: any = {}) {
    return {
        id, sequence, plannedSequence: null, status,
        actualArrival: llegada ?? null, actualDeparture: salida ?? null,
        isReturnToBase: false, clientId: 'c' + id, client: { name: nombre },
        ...extra
    };
}

function ruta(stops: any[], extra: any = {}) {
    return {
        id: 100, tripId: 500, date: new Date('2026-10-15T00:00:00.000Z'), status: 'COMPLETED',
        actualStartTime: T('09:00'), actualEndTime: T('10:20'),
        trip: { id: 500, status: 'OUT_OF_PLANT', exitTime: null, returnTime: null, completedAt: null },
        stops,
        ...extra
    };
}

type Escrituras = { stop: any[]; route: any[]; trip: any[] };

/** El prisma falso: findUnique devuelve una copia de la ruta; cada update se
 *  anota; $transaction ejecuta lo que le pasen con el mismo falso como tx. */
function prismaFalso(r: any) {
    const escrituras: Escrituras = { stop: [], route: [], trip: [] };
    const falso: any = {
        route: {
            findUnique: async ({ where }: any) => (where.id === r.id ? structuredClone(r) : null),
            update: async (a: any) => { escrituras.route.push(a); return a.data; }
        },
        stop: {
            update: async (a: any) => { escrituras.stop.push(a); return a.data; },
            updateMany: async (a: any) => { escrituras.stop.push(a); return { count: 0 }; }
        },
        trip: {
            update: async (a: any) => { escrituras.trip.push(a); return a.data; }
        },
        $transaction: async (fn: any) => (typeof fn === 'function' ? fn(falso) : Promise.all(fn))
    };
    return { prisma: falso, escrituras };
}

const secuenciaEscrita = (e: Escrituras) =>
    e.stop.filter((w) => w.data.sequence !== undefined)
        .sort((a, b) => a.data.sequence - b.data.sequence)
        .map((w) => w.where.id);
const estadoEscrito = (e: Escrituras, id: number) =>
    e.stop.find((w) => w.where.id === id && w.data.status !== undefined)?.data.status ?? null;
const tipos = (inf: InformeDeCierre) => inf.avisos.map((a) => a.tipo);

async function correr() {
    console.log('PROTOCOLO DE CIERRE DE VIAJE\n');

    // ── 1. El viaje tipico: paradas a saltos, una sin cerrar, una sin visitar ──
    // Orden que dejo el chofer: A, B, DEPOSITO, C, D, E, F
    // Por hora:  B 08:30, A 09:10, C 09:30, F 09:50, DEP 10:30, E 12:00 (UNDELIVERABLE), D sin hora
    const viaje1 = ruta([
        parada(11, 1, 'ESCUELA A', 'COMPLETED', T('09:10'), T('09:20')),
        parada(12, 2, 'ESCUELA B', 'COMPLETED', T('08:30'), T('08:45')),
        parada(13, 3, 'REAL DE CATORCE', 'COMPLETED', T('10:30'), T('10:40'), { isReturnToBase: true }),
        parada(14, 4, 'ESCUELA C', 'PENDING', T('09:30'), T('09:31')),
        parada(15, 5, 'ESCUELA D', 'PENDING'),
        parada(16, 6, 'ESCUELA E', 'UNDELIVERABLE', T('12:00'), T('12:05')),
        parada(17, 7, 'ESCUELA F', 'ARRIVED', T('09:50'), T('10:05'))
    ]);
    {
        console.log('1. Viaje con paradas a saltos (ruta 09:00-10:20, deposito 10:30-10:40, UNDELIVERABLE a las 12:00)');
        const { prisma, escrituras } = prismaFalso(viaje1);
        const inf = await normalizarViajeAlCerrar(prisma, 100);
        esperar('no se omitio', inf.omitido === null, inf.omitido);
        esperar('quedan ordenadas por hora: B, A, C, F, E, D(sin hora), DEPOSITO',
            JSON.stringify(secuenciaEscrita(escrituras)) === JSON.stringify([12, 11, 14, 17, 16, 15, 13]), secuenciaEscrita(escrituras));
        esperar('el deposito queda ultimo aunque la UNDELIVERABLE tenga hora posterior',
            escrituras.stop.find((w) => w.where.id === 13)?.data.sequence === 7);
        esperar('la parada sin hora queda al final (antes del deposito) y en PENDING',
            escrituras.stop.find((w) => w.where.id === 15)?.data.sequence === 6 && estadoEscrito(escrituras, 15) === null);
        esperar('reordenadas = 7', inf.reordenadas === 7, inf.reordenadas);
        esperar('plannedSequence guarda el numero viejo la primera vez',
            escrituras.stop.find((w) => w.where.id === 12)?.data.plannedSequence === 2);
        esperar('C (PENDING con las dos horas) pasa a COMPLETED', estadoEscrito(escrituras, 14) === 'COMPLETED');
        esperar('F (ARRIVED con las dos horas) pasa a COMPLETED', estadoEscrito(escrituras, 17) === 'COMPLETED');
        esperar('cerradas = 2', inf.cerradas === 2, inf.cerradas);
        esperar('la UNDELIVERABLE no cambia de estado', estadoEscrito(escrituras, 16) === null);
        esperar('el inicio se adelanta a la primera llegada (08:30)', inf.ventana?.despues.inicio === ISO('08:30'), inf.ventana);
        esperar('el fin se extiende hasta el deposito (10:40)...', inf.ventana?.despues.fin === ISO('10:40'), inf.ventana);
        esperar('...y NO hasta la UNDELIVERABLE de las 12:05', inf.ventana?.despues.fin !== ISO('12:05'));
        esperar('la ruta se escribe con las dos horas',
            escrituras.route.length === 1 && escrituras.route[0].data.actualStartTime?.toISOString() === ISO('08:30')
            && escrituras.route[0].data.actualEndTime?.toISOString() === ISO('10:40'), escrituras.route);
        const t = escrituras.trip[0]?.data;
        esperar('el trip completa exitTime/returnTime con la ventana y pasa a COMPLETED',
            t && t.exitTime?.toISOString() === ISO('08:30') && t.returnTime?.toISOString() === ISO('10:40')
            && t.status === 'COMPLETED' && t.completedAt?.toISOString() === ISO('10:40'), t);
        esperar('un solo aviso: C estuvo 1 minuto', inf.avisos.length === 1 && inf.avisos[0].tipo === 'permanencia-corta'
            && inf.avisos[0].sec === 3 && inf.avisos[0].nombre === 'ESCUELA C', inf.avisos);
        esperar('todo paso por la transaccion (7 paradas + ruta + viaje)',
            escrituras.stop.length === 7 && escrituras.route.length === 1 && escrituras.trip.length === 1,
            { stop: escrituras.stop.length, route: escrituras.route.length, trip: escrituras.trip.length });
    }

    // ── 2. dryRun: mismo informe, cero escrituras ──
    {
        console.log('\n2. El mismo viaje con dryRun');
        const { prisma, escrituras } = prismaFalso(viaje1);
        const inf = await normalizarViajeAlCerrar(prisma, 100, { dryRun: true });
        esperar('dryRun queda marcado en el informe', inf.dryRun === true);
        esperar('calcula lo mismo (7 reordenadas, 2 cerradas, ventana)', inf.reordenadas === 7 && inf.cerradas === 2 && !!inf.ventana);
        esperar('no escribe nada', escrituras.stop.length === 0 && escrituras.route.length === 0 && escrituras.trip.length === 0, escrituras);
    }

    // ── 3. Viaje abierto: no se toca ──
    {
        console.log('\n3. Viaje todavia abierto (sin fin, IN_PROGRESS)');
        const { prisma, escrituras } = prismaFalso(ruta(viaje1.stops, { status: 'IN_PROGRESS', actualEndTime: null }));
        const inf = await normalizarViajeAlCerrar(prisma, 100);
        esperar('se omite con motivo', inf.omitido === 'viaje abierto', inf.omitido);
        esperar('avisa viaje-abierto', tipos(inf).includes('viaje-abierto'));
        esperar('no escribe nada', escrituras.stop.length === 0 && escrituras.route.length === 0 && escrituras.trip.length === 0);
    }

    // ── 4. Cierre tardio: se achica solo si no deja ninguna parada afuera ──
    {
        console.log('\n4. Ruta cerrada tarde (13:00) con una UNDELIVERABLE a las 12:05 afuera del nuevo fin');
        const { prisma } = prismaFalso(ruta(viaje1.stops, { actualEndTime: T('13:00') }));
        const inf = await normalizarViajeAlCerrar(prisma, 100);
        esperar('el fin NO se achica (quedaria afuera la UNDELIVERABLE)', inf.ventana?.despues.fin === ISO('13:00'), inf.ventana);
        esperar('avisa ventana-no-achicada con la parada', inf.avisos.some((a) => a.tipo === 'ventana-no-achicada' && a.nombre === 'ESCUELA E'), inf.avisos);
    }
    {
        console.log('\n5. Ruta cerrada tarde (13:00) sin nada despues del deposito: se achica, y returnTime la sigue');
        const sinE = viaje1.stops.filter((s: any) => s.id !== 16);
        const { prisma, escrituras } = prismaFalso(ruta(sinE, {
            actualEndTime: T('13:00'),
            trip: { id: 500, status: 'COMPLETED', exitTime: T('09:00'), returnTime: T('13:00'), completedAt: T('13:00') }
        }));
        const inf = await normalizarViajeAlCerrar(prisma, 100);
        esperar('el fin se achica hasta el deposito (10:40)', inf.ventana?.despues.fin === ISO('10:40'), inf.ventana);
        esperar('returnTime venia pegado al fin viejo: sigue al nuevo', escrituras.trip[0]?.data.returnTime?.toISOString() === ISO('10:40'), escrituras.trip);
        esperar('exitTime venia pegado al inicio viejo: sigue al nuevo', escrituras.trip[0]?.data.exitTime?.toISOString() === ISO('08:30'), escrituras.trip);
        esperar('sin avisos de ventana', !tipos(inf).includes('ventana-no-achicada'));
    }
    {
        console.log('\n6. Igual, pero el trip tiene una vuelta cargada a mano (12:30): no se toca y se avisa');
        const sinE = viaje1.stops.filter((s: any) => s.id !== 16);
        const { prisma, escrituras } = prismaFalso(ruta(sinE, {
            actualEndTime: T('13:00'),
            trip: { id: 500, status: 'COMPLETED', exitTime: T('09:00'), returnTime: T('12:30'), completedAt: T('13:00') }
        }));
        const inf = await normalizarViajeAlCerrar(prisma, 100);
        esperar('returnTime no se toca', escrituras.trip[0]?.data.returnTime === undefined, escrituras.trip);
        esperar('avisa viaje-returnTime-distinto', tipos(inf).includes('viaje-returnTime-distinto'), tipos(inf));
    }

    // ── 7. Los avisos que no se corrigen ──
    {
        console.log('\n7. Avisos: en la parada sin salida, salida antes de llegada, solapadas; deposito por nombre y de 1 minuto');
        // El deposito viene PRIMERO y sin la marca isReturnToBase: tiene que
        // reconocerse por el nombre y terminar ultimo igual.
        const r = ruta([
            parada(25, 1, 'REAL DE CATORCE', 'COMPLETED', T('10:00'), T('10:01')),
            parada(21, 2, 'ESCUELA G', 'ARRIVED', T('09:00')),
            parada(22, 3, 'ESCUELA H', 'COMPLETED', T('09:40'), T('09:35')),
            parada(23, 4, 'ESCUELA I', 'COMPLETED', T('09:10'), T('09:30')),
            parada(24, 5, 'ESCUELA J', 'COMPLETED', T('09:20'), T('09:40'))
        ], { actualStartTime: T('09:00'), actualEndTime: T('10:01') });
        const { prisma, escrituras } = prismaFalso(r);
        const inf = await normalizarViajeAlCerrar(prisma, 100);
        const t = tipos(inf);
        esperar('G queda ARRIVED (no tiene salida)', estadoEscrito(escrituras, 21) === null);
        esperar('avisa en-parada-sin-salida para G', inf.avisos.some((a) => a.tipo === 'en-parada-sin-salida' && a.nombre === 'ESCUELA G'), t);
        esperar('avisa salida-antes-de-llegada para H', inf.avisos.some((a) => a.tipo === 'salida-antes-de-llegada' && a.nombre === 'ESCUELA H'), t);
        esperar('avisa solapadas I/J', inf.avisos.some((a) => a.tipo === 'solapadas' && a.nombre === 'ESCUELA I' && a.otroNombre === 'ESCUELA J'), t);
        esperar('el deposito de 1 minuto NO da permanencia-corta', !inf.avisos.some((a) => a.tipo === 'permanencia-corta'), t);
        esperar('el deposito sin flag (por nombre) pasa de 1 a ultimo', secuenciaEscrita(escrituras).slice(-1)[0] === 25
            && escrituras.stop.find((w) => w.where.id === 25)?.data.sequence === 5, secuenciaEscrita(escrituras));
        esperar('la ventana no cambia (ya contenia todo)', inf.ventana === null, inf.ventana);
    }

    // ── 8. Una hora rota (1970) no ordena, no cierra ni mueve el inicio ──
    {
        console.log('\n8. Hora fuera de rango (1970) en una parada');
        const r = ruta([
            parada(31, 1, 'ESCUELA K', 'COMPLETED', new Date('1970-01-01T00:00:00Z'), T('09:30')),
            parada(32, 2, 'ESCUELA L', 'PENDING', new Date('1970-01-01T00:00:00Z'), T('09:00')),
            parada(33, 3, 'REAL DE CATORCE', 'COMPLETED', T('10:00'), T('10:10'), { isReturnToBase: true })
        ], { actualStartTime: T('08:50'), actualEndTime: T('10:10') });
        const { prisma, escrituras } = prismaFalso(r);
        const inf = await normalizarViajeAlCerrar(prisma, 100);
        esperar('avisa hora-fuera-de-rango (dos veces)', inf.avisos.filter((a) => a.tipo === 'hora-fuera-de-rango').length === 2, tipos(inf));
        esperar('L no se cierra: su llegada no vale', estadoEscrito(escrituras, 32) === null);
        esperar('el inicio no se va a 1970', !inf.ventana || inf.ventana.despues.inicio === ISO('08:50'), inf.ventana);
        esperar('se ordenan por la salida que si vale: L (09:00) antes que K (09:30)',
            JSON.stringify(secuenciaEscrita(escrituras)) === JSON.stringify([32, 31]), secuenciaEscrita(escrituras));
    }

    // ── 9. Nunca una ventana que termina antes de empezar ──
    {
        console.log('\n9. Ventana invertida: inicio 14:00 cargado mal, paradas solo con salida a las 10:00');
        const r = ruta([
            parada(41, 1, 'ESCUELA M', 'COMPLETED', null, T('10:00'))
        ], { actualStartTime: T('14:00'), actualEndTime: null, status: 'COMPLETED' });
        const { prisma, escrituras } = prismaFalso(r);
        const inf = await normalizarViajeAlCerrar(prisma, 100);
        esperar('avisa ventana-invertida', tipos(inf).includes('ventana-invertida'), tipos(inf));
        esperar('no escribe la ruta', escrituras.route.length === 0 && inf.ventana === null, escrituras.route);
    }

    // ── 10. Ruta inexistente ──
    {
        console.log('\n10. Ruta que no existe');
        const { prisma } = prismaFalso(viaje1);
        let fallo = false;
        try { await normalizarViajeAlCerrar(prisma, 999); } catch { fallo = true; }
        esperar('tira error', fallo);
    }

    console.log('\n' + (todo ? 'TODO OK' : 'HAY FALLAS'));
    process.exit(todo ? 0 : 1);
}

correr().catch((e) => { console.error(e); process.exit(1); });
