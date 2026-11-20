/**
 * Prueba el raleo del GPS viejo (src/gpsRaleo.ts) contra una base LOCAL.
 *   DATABASE_URL=postgresql://...localhost... npx ts-node --transpile-only scripts/probar_gps_raleo.ts
 */
import { PrismaClient } from '@prisma/client';
import { ralearGpsViejo } from '../src/gpsRaleo';

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
const DIA = 24 * 3600 * 1000;

(async () => {
    const dev = 'prueba-raleo-' + Date.now();
    const otro = dev + '-b';
    const ahora = new Date();
    // Al mediodia (UTC) de cada dia: lejos de los cortes de medianoche
    const base = (diasAtras: number) => { const t = ahora.getTime() - diasAtras * DIA; return t - (t % DIA) + 12 * 3600 * 1000; };
    const puntos = (deviceId: string, desde: number, segundos: number) =>
        Array.from({ length: segundos }, (_, i) => ({
            deviceId, latitude: -34.8, longitude: -58.4,
            timestamp: new Date(desde + i * 1000), capturedAt: new Date(desde + i * 1000)
        }));
    await prisma.deviceLocation.createMany({ data: [
        ...puntos(dev, base(62), 120),      // viejo: 2 minutos segundo a segundo
        ...puntos(otro, base(62), 30),      // otro celular, mismo rato
        ...puntos(dev, base(10), 60),       // reciente: no se toca
        ...puntos(dev, base(80), 20)        // mas viejo que la ventana: no se repasa
    ] as any });

    const n = await ralearGpsViejo(prisma, ahora);
    const contar = (deviceId: string, diasAtras: number, seg: number) => prisma.deviceLocation.count({
        where: { deviceId, timestamp: { gte: new Date(base(diasAtras)), lt: new Date(base(diasAtras) + seg * 1000) } }
    });
    esperar('62 dias: de 120 puntos quedan 12 (uno cada 10 s)', (await contar(dev, 62, 120)) === 12, await contar(dev, 62, 120));
    esperar('otro celular se ralea aparte: de 30 quedan 3', (await contar(otro, 62, 30)) === 3, await contar(otro, 62, 30));
    esperar('10 dias: quedan los 60, segundo a segundo', (await contar(dev, 10, 60)) === 60, await contar(dev, 10, 60));
    esperar('80 dias (fuera de la ventana de 7): no se toca', (await contar(dev, 80, 20)) === 20, await contar(dev, 80, 20));
    esperar('saco 108 + 27 = 135', n === 135, n);
    const n2 = await ralearGpsViejo(prisma, ahora);
    esperar('una segunda pasada no saca nada', n2 === 0, n2);

    await prisma.deviceLocation.deleteMany({ where: { deviceId: { in: [dev, otro] } } });
    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    await prisma.$disconnect();
    process.exit(todo ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
