/**
 * Prueba src/gpsDeViaje.ts: cada punto va al viaje que el chofer tenia en
 * curso a esa hora. Contra una base LOCAL.
 *   DATABASE_URL=postgresql://...localhost... npx ts-node --transpile-only scripts/probar_gps_de_viaje.ts
 */
import { PrismaClient } from '@prisma/client';
import { rutaEnHora, rutasDeLosPuntos, reasignarGpsDeRutas } from '../src/gpsDeViaje';

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

(async () => {
    console.log('\n1. La regla');
    const H = (hhmm: string) => new Date(`2031-02-03T${hhmm}:00.000Z`);
    const rutas = [{ id: 1, ini: H('08:00'), fin: H('11:00') }, { id: 2, ini: H('10:30'), fin: H('13:00') }, { id: 3, ini: H('14:00'), fin: null }];
    esperar('09:00 -> viaje 1', rutaEnHora(rutas, H('09:00')) === 1);
    esperar('10:45 (se pisan) -> el que arranco ultimo, 2', rutaEnHora(rutas, H('10:45')) === 2);
    esperar('13:30 (entre viajes) -> ninguno', rutaEnHora(rutas, H('13:30')) === null);
    esperar('15:00 con el 3 abierto -> 3', rutaEnHora(rutas, H('15:00'), H('16:00')) === 3);

    console.log('\n2. Contra la base: un chofer con dos viajes, el celular mandaba todo al primero');
    const user = await prisma.user.create({ data: { username: 'prueba-gps-viaje-' + Date.now(), password: 'x', fullName: 'PRUEBA GPS', role: 'DRIVER', tenantId: 'default-tenant' } as any });
    const base = Date.now() - 5 * 3600 * 1000;   // hace 5 horas
    const T = (min: number) => new Date(base + min * 60000);
    const r1 = await prisma.route.create({ data: { tenantId: 'default-tenant', date: T(0), driverId: user.id, status: 'COMPLETED', actualStartTime: T(0), actualEndTime: T(60) } as any });
    const r2 = await prisma.route.create({ data: { tenantId: 'default-tenant', date: T(0), driverId: user.id, status: 'COMPLETED', actualStartTime: T(90), actualEndTime: T(150) } as any });
    const dev = 'cel-prueba-' + Date.now();
    // Un punto por minuto durante 160 minutos, todos con el viaje 1 (como pasaba)
    await prisma.deviceLocation.createMany({ data: Array.from({ length: 161 }, (_, m) => ({
        deviceId: dev, driverId: user.id, routeId: r1.id, latitude: -34.8, longitude: -58.4, timestamp: T(m)
    })) as any });
    await (prisma as any).recorridoReal.create({ data: { routeId: r1.id, tramos: [], km: 0, puntos: 0 } }).catch(() => {});

    const prueba = await reasignarGpsDeRutas(prisma, T(-60), T(200), { dryRun: true });
    esperar('simulacion: 61 puntos van al viaje 2, sin tocar nada', prueba.puntosMovidos === 61
        && (await prisma.deviceLocation.count({ where: { routeId: r2.id } })) === 0, prueba);
    const r = await reasignarGpsDeRutas(prisma, T(-60), T(200));
    const en = async (rid: number) => prisma.deviceLocation.count({ where: { deviceId: dev, routeId: rid } });
    esperar('el viaje 2 tiene sus 61 puntos (min 90 a 150)', (await en(r2.id)) === 61, await en(r2.id));
    esperar('el viaje 1 conserva los suyos y los de entre viajes (100)', (await en(r1.id)) === 100, await en(r1.id));
    esperar('el recorrido dibujado del viaje 1 se borra para rehacerlo', !(await (prisma as any).recorridoReal.findUnique({ where: { routeId: r1.id } })));
    const r2da = await reasignarGpsDeRutas(prisma, T(-60), T(200));
    esperar('una segunda pasada no mueve nada', r2da.puntosMovidos === 0, r2da);

    console.log('\n3. Al guardar puntos nuevos');
    const tiempos = [T(30), T(75), T(120)];
    const asignadas = await rutasDeLosPuntos(prisma, user.id, tiempos, r1.id);
    esperar('cada punto a su viaje: 1, el del celular (entre viajes), 2', JSON.stringify(asignadas) === JSON.stringify([r1.id, r1.id, r2.id]), asignadas);
    const sinChofer = await rutasDeLosPuntos(prisma, null, tiempos, 777);
    esperar('sin chofer: queda lo que mando el celular', sinChofer.every((x) => x === 777), sinChofer);

    await prisma.deviceLocation.deleteMany({ where: { deviceId: dev } });
    await prisma.route.deleteMany({ where: { id: { in: [r1.id, r2.id] } } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    await prisma.$disconnect();
    process.exit(todo ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
