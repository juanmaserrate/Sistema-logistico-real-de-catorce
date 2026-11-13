/**
 * Prueba la limpieza de los lotes de puntos GPS que manda el celular.
 *
 *   cd server && npx ts-node scripts/probar_gps_lotes.ts
 */
import { limpiarLote, distanciaMetros } from '../src/gpsLotes';
import { mesActual } from '../src/mapboxCuota';

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const ahora = new Date('2026-11-13T15:00:00.000Z');
const T = (seg: number) => new Date(ahora.getTime() - 3600_000 + seg * 1000).toISOString();
// Avanza hacia el norte ~11 m por cada 0.0001 grados
const P = (seg: number, norte: number, extra: any = {}) => ({ lat: -34.8 + norte * 0.0001, lng: -58.4, t: T(seg), acc: 8, ...extra });

console.log('\n1. Llegan desordenados: se ordenan por la hora del GPS');
{
    const r = limpiarLote([P(10, 2), P(0, 0), P(5, 1), P(15, 3)], null, ahora);
    esperar('quedan los 4', r.buenos.length === 4, r);
    esperar('en orden', r.buenos.every((p, i) => i === 0 || p.t > r.buenos[i - 1].t));
}

console.log('\n2. Un rebote del GPS en el medio (3 km en 5 s) se descarta');
{
    const r = limpiarLote([P(0, 0), P(5, 1), { lat: -34.77, lng: -58.4, t: T(10), acc: 8 }, P(15, 3), P(20, 4)], null, ahora);
    esperar('quedan 4', r.buenos.length === 4, r.buenos.length);
    esperar('1 salto descartado', r.descartados.saltos === 1, r.descartados);
}

console.log('\n3. Si el raro era el ultimo guardado, 3 puntos coherentes lo corrigen');
{
    const anteriorMalo = { lat: -34.70, lng: -58.4, t: new Date(T(-5)) };   // 11 km al norte, 5 s antes
    const r = limpiarLote([P(0, 0), P(5, 1), P(10, 2), P(15, 3)], anteriorMalo, ahora);
    esperar('se aceptan los 4', r.buenos.length === 4, r);
}

console.log('\n4. Imprecisos, invalidos y repetidos');
{
    const r = limpiarLote([P(0, 0), P(5, 1, { acc: 250 }), { lat: 0, lng: 0, t: T(6) }, { lat: 'x', lng: 3 }, P(10, 2), P(10, 2)], null, ahora);
    esperar('quedan 2', r.buenos.length === 2, r.buenos.length);
    esperar('1 impreciso, 2 invalidos, 1 repetido',
        r.descartados.imprecisos === 1 && r.descartados.invalidos === 2 && r.descartados.repetidos === 1, r.descartados);
}

console.log('\n5. Reloj del celular roto: va la hora del servidor');
{
    const r = limpiarLote([{ lat: -34.8, lng: -58.4, t: '1970-01-01T00:00:00Z', acc: 5 }], null, ahora);
    esperar('se guarda con la hora del servidor', r.buenos.length === 1 && r.buenos[0].t.getTime() === ahora.getTime() && !!r.buenos[0].horaDelServidor, r);
}

console.log('\n6. Un viaje real sin señal 20 min: el salto largo NO es un rebote (va a 40 km/h)');
{
    const r = limpiarLote([P(0, 0), { lat: -34.8 + 0.12, lng: -58.4, t: T(1200), acc: 10 }], null, ahora);
    esperar('se aceptan los 2', r.buenos.length === 2, r);
}

console.log('\n7. El punto repetido con el ultimo guardado no se vuelve a guardar');
{
    const ant = { lat: -34.8, lng: -58.4, t: new Date(T(0)) };
    const r = limpiarLote([P(0, 0), P(5, 1)], ant, ahora);
    esperar('solo el nuevo', r.buenos.length === 1 && r.descartados.repetidos === 1, r);
}

console.log('\n8. Distancia y mes');
{
    const d = distanciaMetros({ lat: -34.8, lng: -58.4 }, { lat: -34.8001, lng: -58.4 });
    esperar('0.0001 grados ~ 11 m', d > 10.5 && d < 11.5, d);
    esperar('mes de Buenos Aires (2:00 UTC del 1 de dic = 30 de nov)', mesActual(new Date('2026-12-01T02:00:00Z')) === '2026-11', mesActual(new Date('2026-12-01T02:00:00Z')));
}

console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
process.exit(todo ? 0 : 1);
