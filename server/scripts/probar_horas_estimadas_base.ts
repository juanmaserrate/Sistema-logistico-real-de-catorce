/**
 * Prueba de punta a punta de las horas estimadas contra una base de prueba
 * (NUNCA produccion): arma viajes, los cierra con el protocolo de cierre y
 * con el barrido, y mira que quedo.
 *   DATABASE_URL=postgresql://...prueba... npx ts-node --transpile-only scripts/probar_horas_estimadas_base.ts
 */
import { PrismaClient } from '@prisma/client';
import { normalizarViajeAlCerrar } from '../src/cierreDeViaje';
import { barrerViajesSinHoras, completarHorasDelViaje } from '../src/horasEstimadas';

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')) {
    console.error('Solo contra una base local de prueba');
    process.exit(1);
}
const prisma = new PrismaClient();
let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const H = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00.000Z`);

async function viaje(dia: string, opc: { salida: string; llegada: string; rutaIni?: string | null; rutaFin?: string | null; marcada?: boolean; status?: string }) {
    const clientes = [];
    for (let i = 0; i < 3; i++) {
        clientes.push(await prisma.client.create({ data: { name: `PRUEBA HORAS ${dia} ${i}`, address: 'x', tenantId: 'default-tenant' } as any }));
    }
    const deposito = await prisma.client.create({ data: { name: 'REAL DE 14 DEPOSITO PRUEBA', address: 'x', tenantId: 'default-tenant' } as any });
    const trip = await prisma.trip.create({
        data: {
            date: H(dia, '15:00'), reparto: 'LIBRE', driver: 'PRUEBA', businessUnit: 'RETIRO', status: opc.status || 'PENDING',
            exitTime: H(dia, opc.salida), returnTime: H(dia, opc.llegada), isManual: true
        } as any
    });
    const route = await prisma.route.create({
        data: {
            tenantId: 'default-tenant', date: trip.date, tripId: trip.id, status: 'PENDING',
            actualStartTime: opc.rutaIni ? H(dia, opc.rutaIni) : null, actualEndTime: opc.rutaFin ? H(dia, opc.rutaFin) : null
        } as any
    });
    for (let i = 0; i < 3; i++) {
        await prisma.stop.create({
            data: {
                routeId: route.id, clientId: clientes[i].id, sequence: i + 1, status: opc.marcada && i === 0 ? 'COMPLETED' : 'PENDING',
                ...(opc.marcada && i === 0 ? { actualArrival: H(dia, '10:00'), actualDeparture: H(dia, '10:10') } : {})
            } as any
        });
    }
    await prisma.stop.create({ data: { routeId: route.id, clientId: deposito.id, sequence: 4, status: 'PENDING', isReturnToBase: true } as any });
    return { trip, route };
}
const paradasDe = (routeId: number) => prisma.stop.findMany({ where: { routeId }, orderBy: { sequence: 'asc' } });

(async () => {
    console.log('\n1. Cierre por el protocolo (Finalizar, cierre del operador, chofer)');
    {
        const { trip, route } = await viaje('2031-01-10', { salida: '08:00', llegada: '12:00', rutaIni: '08:20', rutaFin: '12:30', status: 'COMPLETED' });
        await prisma.route.update({ where: { id: route.id }, data: { status: 'COMPLETED' } });
        await normalizarViajeAlCerrar(prisma, route.id);
        const ps = await paradasDe(route.id);
        const escuelas = ps.filter((p) => !p.isReturnToBase);
        esperar('las 3 escuelas quedaron entregadas con hora', escuelas.every((p) => p.status === 'COMPLETED' && p.actualArrival && p.actualDeparture), escuelas);
        esperar('adentro de 08:20-12:00 (la parte en comun)', escuelas.every((p) => p.actualArrival! >= H('2031-01-10', '08:20') && p.actualDeparture! <= H('2031-01-10', '12:00')),
            escuelas.map((p) => [p.actualArrival, p.actualDeparture]));
        esperar('el deposito no se toca', ps.find((p) => p.isReturnToBase)!.actualArrival === null);
        esperar('dice que es estimada', escuelas.every((p) => /Hora estimada/.test(p.observations || '')));
        const t = await prisma.trip.findUnique({ where: { id: trip.id } });
        esperar('la salida y la llegada del viaje no cambian', +t!.exitTime! === +H('2031-01-10', '08:00') && +t!.returnTime! === +H('2031-01-10', '12:00'), t);
        const log = await prisma.auditLog.findFirst({ where: { entity: 'Trip', entityId: String(trip.id) }, orderBy: { createdAt: 'desc' } });
        esperar('queda en auditoria con el antes', !!log && /PENDING/.test(log.before || ''), log);
    }

    console.log('\n2. Si el chofer marco alguna, las otras no se inventan');
    {
        const { route } = await viaje('2031-01-11', { salida: '08:00', llegada: '12:00', rutaIni: '08:00', rutaFin: '12:00', marcada: true, status: 'COMPLETED' });
        await prisma.route.update({ where: { id: route.id }, data: { status: 'COMPLETED' } });
        await normalizarViajeAlCerrar(prisma, route.id);
        const ps = (await paradasDe(route.id)).filter((p) => !p.isReturnToBase);
        esperar('quedan 2 pendientes sin hora', ps.filter((p) => p.status === 'PENDING' && !p.actualArrival).length === 2, ps);
    }

    console.log('\n3. Viaje abierto: no se toca');
    {
        const { trip } = await viaje('2031-01-12', { salida: '08:00', llegada: '12:00', rutaIni: '08:00', rutaFin: null, status: 'OUT_OF_PLANT' });
        const r = await completarHorasDelViaje(prisma, { tripId: trip.id });
        esperar('salteado: no esta finalizado', r?.salteado === 'el viaje no esta finalizado' && !r.guardado, r);
    }

    console.log('\n4. Pasado a Finalizado desde el formulario (sin protocolo): lo agarra el barrido');
    {
        const { trip, route } = await viaje(new Date().toISOString().slice(0, 10), { salida: '09:00', llegada: '11:00', rutaIni: null, rutaFin: null, status: 'COMPLETED' });
        const hechos = await barrerViajesSinHoras(prisma, 10);
        esperar('el barrido lo completo', hechos.some((h) => h.tripId === trip.id), hechos.map((h) => h.tripId));
        const ps = (await paradasDe(route.id)).filter((p) => !p.isReturnToBase);
        const d = trip.date.toISOString().slice(0, 10);
        esperar('con la salida y llegada del formulario (09:00-11:00)', ps.every((p) => p.actualArrival! >= H(d, '09:00') && p.actualDeparture! <= H(d, '11:00')), ps.map((p) => [p.actualArrival, p.actualDeparture]));
        const otra = await barrerViajesSinHoras(prisma, 10);
        esperar('una segunda pasada no hace nada', !otra.some((h) => h.tripId === trip.id));
    }

    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    await prisma.$disconnect();
    process.exit(todo ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
