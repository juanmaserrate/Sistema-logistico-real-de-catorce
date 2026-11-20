/**
 * Prueba la salida real por GPS (src/salidaReal.ts) al cerrar un viaje, contra
 * una base LOCAL.
 *   DATABASE_URL=postgresql://...localhost... npx ts-node --transpile-only scripts/probar_salida_real_base.ts
 */
import { PrismaClient } from '@prisma/client';
import { normalizarViajeAlCerrar } from '../src/cierreDeViaje';
import { DEPOSITO, corregirSalidaDelViaje } from '../src/salidaReal';

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

async function armar(dia: string, gpsHastaMin: number | null, primeraMin: number) {
    const T = (min: number) => new Date(Date.parse(`${dia}T09:00:00.000Z`) + min * 60000);
    await prisma.tenant.upsert({ where: { id: 'default-tenant' }, create: { id: 'default-tenant', name: 'Prueba' } as any, update: {} });
    const user = await prisma.user.create({ data: { username: 'prueba-salida-' + Date.now() + Math.random(), password: 'x', fullName: 'PRUEBA', role: 'DRIVER', tenantId: 'default-tenant' } as any });
    const cli = await prisma.client.create({ data: { name: 'ESCUELA PRUEBA SALIDA', address: 'x', tenantId: 'default-tenant' } as any });
    const trip = await prisma.trip.create({ data: { date: T(0), reparto: 'R2', driver: 'PRUEBA', businessUnit: 'SAE BROWN', status: 'COMPLETED', startedAt: T(primeraMin), exitTime: T(primeraMin) } as any });
    // Como queda un viaje que nadie inicio: salida = primera parada
    const route = await prisma.route.create({ data: { tenantId: 'default-tenant', date: T(0), tripId: trip.id, driverId: user.id, status: 'COMPLETED', actualStartTime: T(primeraMin), actualEndTime: T(primeraMin + 120) } as any });
    await prisma.stop.create({ data: { routeId: route.id, clientId: cli.id, sequence: 1, status: 'COMPLETED', actualArrival: T(primeraMin), actualDeparture: T(primeraMin + 10) } as any });
    if (gpsHastaMin != null) {
        // En el deposito hasta gpsHastaMin, despues lejos
        await prisma.deviceLocation.createMany({ data: Array.from({ length: primeraMin + 1 }, (_, m) => ({
            deviceId: 'cel-' + user.id, driverId: user.id, latitude: m <= gpsHastaMin ? DEPOSITO.lat + 0.0005 : DEPOSITO.lat + 0.05,
            longitude: DEPOSITO.lng, timestamp: T(m)
        })) as any });
    }
    return { trip, route, T };
}

(async () => {
    console.log('\n1. Al cerrar: la salida pasa a la hora en que el camion dejo el deposito');
    {
        const { trip, route, T } = await armar('2031-03-03', 20, 60);   // deposito hasta 09:20, 1ra parada 10:00
        await normalizarViajeAlCerrar(prisma, route.id);
        const r = await prisma.route.findUnique({ where: { id: route.id } });
        const t = await prisma.trip.findUnique({ where: { id: trip.id } });
        esperar('la ruta sale 09:20 (antes 10:00)', +r!.actualStartTime! === +T(20), r!.actualStartTime);
        esperar('el viaje tambien (salida y startedAt)', +t!.exitTime! === +T(20) && +t!.startedAt! === +T(20), [t!.exitTime, t!.startedAt]);
        const log = await prisma.auditLog.findFirst({ where: { entity: 'Trip', entityId: String(trip.id) }, orderBy: { createdAt: 'desc' } });
        esperar('queda en auditoria', !!log && /Salida del deposito por GPS \(\+40 min\)/.test(log.entityName || ''), log?.entityName);
    }

    console.log('\n2. Sin GPS: no se inventa nada');
    {
        const { route, T } = await armar('2031-03-04', null, 60);
        await normalizarViajeAlCerrar(prisma, route.id);
        const r = await prisma.route.findUnique({ where: { id: route.id } });
        esperar('la salida sigue en la primera parada', +r!.actualStartTime! === +T(60), r!.actualStartTime);
    }

    console.log('\n3. Mas de 90 min entre el deposito y la primera parada: no se toca solo');
    {
        const { trip, route, T } = await armar('2031-03-05', 10, 120);
        await normalizarViajeAlCerrar(prisma, route.id);
        const r = await prisma.route.findUnique({ where: { id: route.id } });
        esperar('la salida sigue igual', +r!.actualStartTime! === +T(120), r!.actualStartTime);
        const s = await corregirSalidaDelViaje(prisma, { tripId: trip.id }, { dryRun: true });
        esperar('y avisa que hay que revisarlo', /revisar a mano/.test(s?.motivo || ''), s);
    }

    console.log('\n4. Un viaje que SI se inicio no se toca');
    {
        const { route, T } = await armar('2031-03-06', 20, 60);
        await prisma.route.update({ where: { id: route.id }, data: { actualStartTime: T(30) } });
        await normalizarViajeAlCerrar(prisma, route.id);
        const r = await prisma.route.findUnique({ where: { id: route.id } });
        esperar('la salida sigue en 09:30', +r!.actualStartTime! === +T(30), r!.actualStartTime);
    }

    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    await prisma.$disconnect();
    process.exit(todo ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
