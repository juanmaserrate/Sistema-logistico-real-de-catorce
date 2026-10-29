/**
 * Prueba el reparto de horas por tramos contra el caso real del viaje 8192 y
 * contra lo que puede venir mal: un tramo sin unidad, una unidad sin tramo,
 * tramos a medio cerrar.
 *
 *   npx ts-node scripts/probar_reparto_tramos.ts
 */
import { repartirHoras } from '../src/unidadesDelViaje';

const mapaU = new Map<string, string>([['R6', 'SAE BROWN']]);

// El 8192 tal como esta en la base
const INICIO = '2026-10-29T08:31:31.239Z';
const FIN = '2026-10-29T11:46:51.757Z';
const TOTAL = 3.2557;

const paradas8192 = [
    { sequence: 1, ruta: 'R6', actualDeparture: '2026-10-29T09:50:55.985Z' },
    { sequence: 2, ruta: 'R6', actualDeparture: '2026-10-29T09:56:01.681Z' },
    { sequence: 3, ruta: 'R6', actualDeparture: '2026-10-29T10:23:35.305Z' },
    { sequence: 4, ruta: 'R6', actualDeparture: '2026-10-29T09:56:15.292Z' },
    { sequence: 5, ruta: 'R6', actualDeparture: '2026-10-29T09:56:32.499Z' },
    { sequence: 6, ruta: 'R6', actualDeparture: '2026-10-29T09:56:48.644Z' },
    { sequence: 7, ruta: 'R6', actualDeparture: '2026-10-29T10:42:28.418Z' },
    { sequence: 8, ruta: 'R6', actualDeparture: '2026-10-29T09:57:05.360Z' },
    { sequence: 9, ruta: 'R6', actualDeparture: '2026-10-29T10:34:23.174Z' },
    { sequence: 10, ruta: 'RETIRO', actualArrival: '2026-10-29T11:26:51.575Z', actualDeparture: '2026-10-29T11:46:43.779Z' },
    { sequence: 11, ruta: 'VUELTA AL DEPOSITO', isReturnToBase: true, actualDeparture: FIN },
] as any[];

// Los tramos que cerro el chofer: R6 2:55 y RETIRO 0:20
const tramos8192 = [
    { ruta: 'R6', inicio: INICIO, fin: '2026-10-29T11:26:31.000Z' },
    { ruta: 'RETIRO', inicio: '2026-10-29T11:26:31.000Z', fin: FIN },
] as any[];

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const hm = (h: number) => `${Math.floor(Math.round(h * 60) / 60)}:${String(Math.round(h * 60) % 60).padStart(2, '0')}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const suma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

console.log('REPARTO DE HORAS POR TRAMOS\n');

// ── 1. El caso real ──
console.log('1. Viaje 8192 (SAE BROWN + RETIRO, 3:15 en total)');
const conTramos = repartirHoras(
    { businessUnit: 'SAE BROWN, RETIRO', stops: paradas8192, tramos: tramos8192, inicio: INICIO, fin: FIN },
    mapaU, TOTAL);
console.log('   metodo:', conTramos.metodo);
Object.entries(conTramos.horas).forEach(([u, h]) => console.log('     ', u.padEnd(11), r2(h), '=', hm(h)));
esperar('usa los tramos', conTramos.metodo === 'por los tramos del chofer', conTramos.metodo);
esperar('SAE BROWN da 2:55 (lo que dice el TMS)', hm(conTramos.horas['SAE BROWN']) === '2:55', hm(conTramos.horas['SAE BROWN']));
esperar('RETIRO da 0:20 (lo que dice el TMS)', hm(conTramos.horas['RETIRO']) === '0:20', hm(conTramos.horas['RETIRO']));
esperar('las partes suman el viaje entero', Math.abs(suma(conTramos.horas) - TOTAL) < 0.0001, suma(conTramos.horas));

// ── 2. El mismo viaje sin tramos: el camino viejo ──
console.log('\n2. El mismo viaje, si el chofer no hubiera cerrado los tramos');
const sinTramos = repartirHoras(
    { businessUnit: 'SAE BROWN, RETIRO', stops: paradas8192, inicio: INICIO, fin: FIN },
    mapaU, TOTAL);
console.log('   metodo:', sinTramos.metodo);
Object.entries(sinTramos.horas).forEach(([u, h]) => console.log('     ', u.padEnd(11), r2(h), '=', hm(h)));
esperar('cae en el camino viejo', sinTramos.metodo === 'por horario de cada parada', sinTramos.metodo);
esperar('da lo de antes (2,18 / 1,07)', r2(sinTramos.horas['SAE BROWN']) === 2.18 && r2(sinTramos.horas['RETIRO']) === 1.07,
    [r2(sinTramos.horas['SAE BROWN']), r2(sinTramos.horas['RETIRO'])]);
esperar('y tambien suma el viaje entero', Math.abs(suma(sinTramos.horas) - TOTAL) < 0.0001, suma(sinTramos.horas));

// ── 3. Lo que puede venir mal ──
console.log('\n3. Cuando los tramos no alcanzan');

const faltaUna = repartirHoras(
    { businessUnit: 'SAE BROWN, RETIRO', stops: paradas8192,
      tramos: [{ ruta: 'R6', inicio: INICIO, fin: '2026-10-29T10:00:00Z' },
               { ruta: 'VUELTA AL DEPOSITO', inicio: '2026-10-29T10:00:00Z', fin: FIN }],
      inicio: INICIO, fin: FIN }, mapaU, TOTAL);
esperar('si una unidad no tiene tramo, no la deja en cero', faltaUna.metodo !== 'por los tramos del chofer', faltaUna.metodo);
esperar('  y le da horas igual', (faltaUna.horas['RETIRO'] || 0) > 0, faltaUna.horas);

const rutaDesconocida = repartirHoras(
    { businessUnit: 'SAE BROWN, RETIRO', stops: paradas8192,
      tramos: [{ ruta: 'R6', inicio: INICIO, fin: '2026-10-29T10:00:00Z' },
               { ruta: 'R99', inicio: '2026-10-29T10:00:00Z', fin: FIN }],
      inicio: INICIO, fin: FIN }, mapaU, TOTAL);
esperar('un tramo de ruta desconocida descarta el metodo', rutaDesconocida.metodo !== 'por los tramos del chofer', rutaDesconocida.metodo);

const unSoloTramo = repartirHoras(
    { businessUnit: 'SAE BROWN, RETIRO', stops: paradas8192,
      tramos: [{ ruta: 'R6', inicio: INICIO, fin: FIN }], inicio: INICIO, fin: FIN }, mapaU, TOTAL);
esperar('con un solo tramo tampoco', unSoloTramo.metodo !== 'por los tramos del chofer', unSoloTramo.metodo);

const sinCerrar = repartirHoras(
    { businessUnit: 'SAE BROWN, RETIRO', stops: paradas8192,
      tramos: [{ ruta: 'R6', inicio: INICIO, fin: null },
               { ruta: 'RETIRO', inicio: '2026-10-29T11:26:31Z', fin: FIN }],
      inicio: INICIO, fin: FIN }, mapaU, TOTAL);
esperar('un tramo sin cerrar tampoco', sinCerrar.metodo !== 'por los tramos del chofer', sinCerrar.metodo);

// ── 4. Un viaje de una sola unidad no cambia ──
console.log('\n4. Lo de siempre: un viaje de una sola unidad');
const unaSola = repartirHoras(
    { businessUnit: 'SAE BROWN', stops: paradas8192, tramos: tramos8192, inicio: INICIO, fin: FIN },
    mapaU, TOTAL);
esperar('se lleva todo, sin repartir nada', unaSola.metodo === 'una sola unidad' && unaSola.horas['SAE BROWN'] === TOTAL, unaSola);

// ── 5. Tres unidades ──
console.log('\n5. Tres unidades');
const tres = repartirHoras(
    { businessUnit: 'SAE BROWN, RETIRO, SAM',
      stops: [{ sequence: 1, ruta: 'R6' }, { sequence: 2, ruta: 'RETIRO' }, { sequence: 3, ruta: 'SAM' }] as any,
      tramos: [{ ruta: 'R6', inicio: '2026-10-29T08:00:00Z', fin: '2026-10-29T10:00:00Z' },
               { ruta: 'RETIRO', inicio: '2026-10-29T10:00:00Z', fin: '2026-10-29T11:00:00Z' },
               { ruta: 'SAM', inicio: '2026-10-29T11:00:00Z', fin: '2026-10-29T12:00:00Z' },
               { ruta: 'VUELTA AL DEPOSITO', inicio: '2026-10-29T12:00:00Z', fin: '2026-10-29T12:30:00Z' }],
      inicio: '2026-10-29T08:00:00Z', fin: '2026-10-29T12:30:00Z' }, mapaU, 4.5);
console.log('   metodo:', tres.metodo);
Object.entries(tres.horas).forEach(([u, h]) => console.log('     ', u.padEnd(11), r2(h), '=', hm(h)));
esperar('reparte las tres', Object.keys(tres.horas).length === 3);
esperar('la vuelta al deposito se prorratea', Math.abs(suma(tres.horas) - 4.5) < 0.0001, suma(tres.horas));
esperar('  y le toca mas al que mas hizo', tres.horas['SAE BROWN'] > tres.horas['RETIRO'], tres.horas);

console.log('\n' + (todo ? 'TODO BIEN' : '*** HAY FALLAS ***'));
process.exit(todo ? 0 : 1);
