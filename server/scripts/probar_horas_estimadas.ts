/**
 * Prueba src/horasEstimadas.ts
 *   cd server && npx ts-node --transpile-only scripts/probar_horas_estimadas.ts
 */
import { estimarHorasDeParadas, ParadaParaEstimar } from '../src/horasEstimadas';

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const H = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00.000Z`);
const hm = (d: Date) => d.toISOString().slice(11, 16);
const p = (id: number, extra: Partial<ParadaParaEstimar> = {}): ParadaParaEstimar =>
    ({ id, sequence: id, status: 'PENDING', llegada: null, salida: null, deposito: false, ...extra });

console.log('\n1. Viaje cerrado sin marcar nada: se reparte en partes iguales');
{
    // 08:00 a 12:00, 3 paradas -> 4 tramos de 1 h: salen 09, 10 y 11
    const r = estimarHorasDeParadas([p(1), p(2), p(3), p(99, { deposito: true })], H('08:00'), H('12:00'));
    esperar('3 paradas con hora, la del deposito no', r.cambios.length === 3 && !r.cambios.some((c) => c.id === 99), r);
    esperar('salidas 09:00, 10:00, 11:00', r.cambios.map((c) => hm(c.salida)).join(',') === '09:00,10:00,11:00', r.cambios.map((c) => hm(c.salida)));
    esperar('llegada 10 min antes', hm(r.cambios[0].llegada) === '08:50', hm(r.cambios[0].llegada));
    esperar('pasan a entregadas', r.cambios.every((c) => c.marcarEntregada && c.como === 'repartida'));
}

console.log('\n2. Entregadas sin hora entre otras con hora (restaurados)');
{
    const r = estimarHorasDeParadas([
        p(1, { status: 'COMPLETED', llegada: H('09:00'), salida: H('09:10') }),
        p(2, { status: 'COMPLETED' }),
        p(3, { status: 'COMPLETED' }),
        p(4, { status: 'COMPLETED', llegada: H('10:10'), salida: H('10:20') }),
        p(5, { status: 'PENDING' })            // el chofer marco otras: esta no se toca
    ], H('08:00'), H('12:00'));
    esperar('solo la 2 y la 3', r.cambios.map((c) => c.id).join(',') === '2,3', r);
    esperar('entre 09:10 y 10:10: salidas 09:30 y 09:50', r.cambios.map((c) => hm(c.salida)).join(',') === '09:30,09:50', r.cambios.map((c) => hm(c.salida)));
    esperar('siguen entregadas, no cambian de estado', r.cambios.every((c) => !c.marcarEntregada));
    esperar('la pendiente queda', r.pendientesQueQuedan === 1, r);
}

console.log('\n3. Con GPS');
{
    const lat = -34.8, lng = -58.4;
    const gps = [];
    for (let m = 0; m <= 240; m++) {
        const t = H('08:00').getTime() + m * 60000;
        // 09:20 a 09:35 parado en la escuela; el resto lejos
        const cerca = m >= 80 && m <= 95;
        gps.push({ lat: cerca ? lat : lat + 0.05, lng, t });
    }
    const r = estimarHorasDeParadas([p(1, { lat, lng }), p(2, { lat: -34.9, lng: -58.5 })], H('08:00'), H('12:00'), gps);
    const c1 = r.cambios.find((c) => c.id === 1)!, c2 = r.cambios.find((c) => c.id === 2)!;
    esperar('la 1 sale del GPS: 09:20 a 09:35', c1.como === 'GPS' && hm(c1.llegada) === '09:20' && hm(c1.salida) === '09:35', c1);
    esperar('la 2 (sin GPS cerca) se reparte despues de la 1: 09:35 a 12:00 -> 10:47', c2.como === 'repartida' && hm(c2.salida) === '10:47', c2 && hm(c2.salida));
}

console.log('\n4. Viajes que no se pueden estimar');
{
    const r = estimarHorasDeParadas([p(1)], H('12:14'), new Date(H('12:14').getTime() + 3500));
    esperar('dura segundos: se saltea', r.cambios.length === 0 && /menos de 5 minutos/.test(r.salteado || ''), r);
    const r2 = estimarHorasDeParadas([p(1, { status: 'COMPLETED', llegada: H('09:00'), salida: H('09:05') })], H('08:00'), H('12:00'));
    esperar('ya tiene todo: no cambia nada', r2.cambios.length === 0 && !r2.salteado, r2);
    const r3 = estimarHorasDeParadas([p(1, { status: 'UNDELIVERABLE' }), p(2)], H('08:00'), H('12:00'));
    esperar('una no entregada cuenta como marcada: la pendiente no se toca', r3.cambios.length === 0 && r3.pendientesQueQuedan === 1, r3);
}

console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
process.exit(todo ? 0 : 1);
