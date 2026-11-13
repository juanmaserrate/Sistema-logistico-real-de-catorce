/**
 * Prueba la reasignacion a mano de la unidad de las paradas de un viaje.
 *
 *   cd server && npx ts-node scripts/probar_reasignar_unidades.ts
 */
import { reasignarUnidades, repartirHoras, ParadaConId } from '../src/unidadesDelViaje';

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const mapa = new Map<string, string>([['R13 LANUS', 'SAE LANUS'], ['SAM 1 R13', 'SAM']]);
const p = (id: number, nombre: string, ruta: string | null, extra: Partial<ParadaConId> = {}): ParadaConId =>
    ({ id, sequence: id, client: { name: nombre }, ruta, ...extra });
const rutas = (r: Map<number, string | null>) => Object.fromEntries([...r.entries()]);

console.log('\n1. El viaje #10063: CDI SOLANO pasa a REPOSICION (que ya estaba en el viaje sin paradas)');
{
    const paradas = [p(1, 'JARDIN MATERNAL 1', 'SAE LOMAS'), p(2, 'RINCON FELIZ 16', 'SAE LOMAS'),
        p(3, 'CDI SOLANO', 'CDI'), p(4, 'CDI A. CASTILLO', 'CDI'), p(5, 'REAL DE CATORCE', null, { isReturnToBase: true })];
    const r = reasignarUnidades('SAE LOMAS, CDI, REPOSICION, RETIRO', paradas, [{ stopId: 3, unidad: 'REPOSICION' }], mapa);
    esperar('solo cambia la parada 3', JSON.stringify(rutas(r.rutas)) === JSON.stringify({ 3: 'REPOSICION' }), rutas(r.rutas));
    esperar('el viaje queda igual (CDI sigue teniendo una parada)', r.unidadesDelViaje.join(', ') === 'SAE LOMAS, CDI, REPOSICION, RETIRO', r.unidadesDelViaje);
}

console.log('\n2. Las dos de CDI pasan a SAE LOMAS: CDI sale del viaje; RETIRO y REPOSICION (sin paradas antes) quedan');
{
    const paradas = [p(1, 'A', 'SAE LOMAS'), p(3, 'CDI SOLANO', 'CDI'), p(4, 'CDI A. CASTILLO', 'CDI'), p(5, 'REAL DE CATORCE', null)];
    const r = reasignarUnidades('SAE LOMAS, CDI, REPOSICION, RETIRO', paradas,
        [{ stopId: 3, unidad: 'SAE LOMAS' }, { stopId: 4, unidad: 'sae lomas' }], mapa);
    esperar('el viaje queda SAE LOMAS, REPOSICION, RETIRO', r.unidadesDelViaje.join(', ') === 'SAE LOMAS, REPOSICION, RETIRO', r.unidadesDelViaje);
    esperar('las dos paradas dicen SAE LOMAS', r.rutas.get(3) === 'SAE LOMAS' && r.rutas.get(4) === 'SAE LOMAS', rutas(r.rutas));
}

console.log('\n3. Viaje de una sola unidad sin rutas: una parada pasa a SAM');
{
    const paradas = [p(1, 'A', null), p(2, 'B', null), p(3, 'C', null), p(4, 'REAL DE CATORCE', null)];
    const r = reasignarUnidades('SAE LANUS', paradas, [{ stopId: 2, unidad: 'SAM' }], mapa);
    esperar('el viaje suma SAM', r.unidadesDelViaje.join(', ') === 'SAE LANUS, SAM', r.unidadesDelViaje);
    esperar('las otras pasan a decir SAE LANUS (no quedan SIN UNIDAD)',
        r.rutas.get(1) === 'SAE LANUS' && r.rutas.get(3) === 'SAE LANUS' && r.rutas.get(2) === 'SAM', rutas(r.rutas));
    esperar('la vuelta al deposito no se toca', !r.rutas.has(4), rutas(r.rutas));
}

console.log('\n4. Parada de una ruta predefinida (R13 LANUS -> SAE LANUS) pasa a SAM, que ya estaba por otra ruta');
{
    const paradas = [p(1, 'A', 'R13 LANUS'), p(2, 'B', 'R13 LANUS'), p(3, 'C', 'SAM 1 R13')];
    const r = reasignarUnidades('SAE LANUS, SAM', paradas, [{ stopId: 2, unidad: 'SAM' }], mapa);
    esperar('el viaje sigue SAE LANUS, SAM', r.unidadesDelViaje.join(', ') === 'SAE LANUS, SAM', r.unidadesDelViaje);
    esperar('solo cambia la 2; la 1 conserva su ruta predefinida', JSON.stringify(rutas(r.rutas)) === JSON.stringify({ 2: 'SAM' }), rutas(r.rutas));
}

console.log('\n5. Pedir la misma unidad que ya tenia no cambia nada');
{
    const paradas = [p(1, 'A', 'SAE LOMAS'), p(2, 'B', 'CDI')];
    const r = reasignarUnidades('SAE LOMAS, CDI', paradas, [{ stopId: 2, unidad: 'CDI' }], mapa);
    esperar('sin cambios de ruta', r.rutas.size === 0, rutas(r.rutas));
    esperar('el viaje igual', r.unidadesDelViaje.join(', ') === 'SAE LOMAS, CDI', r.unidadesDelViaje);
}

console.log('\n6. Pedirle unidad a la vuelta al deposito se ignora');
{
    const paradas = [p(1, 'A', 'SAE LOMAS'), p(9, 'REAL DE CATORCE', null, { isReturnToBase: true })];
    const r = reasignarUnidades('SAE LOMAS', paradas, [{ stopId: 9, unidad: 'CDI' }], mapa);
    esperar('no cambia nada', r.rutas.size === 0 && r.unidadesDelViaje.join(', ') === 'SAE LOMAS', { r: rutas(r.rutas), u: r.unidadesDelViaje });
}

console.log('\n7. Las horas siguen a la parada: el viaje #10063 con horarios reales');
{
    const T = (hh: string) => `2026-10-05T${hh}:00.000Z`;
    const paradas = [
        p(1, 'JARDIN MATERNAL 1', 'SAE LOMAS', { actualArrival: T('09:59'), actualDeparture: T('10:15') }),
        p(2, 'RINCON FELIZ 16', 'SAE LOMAS', { actualArrival: T('10:33'), actualDeparture: T('10:50') }),
        p(3, 'CDI SOLANO', 'CDI', { actualArrival: T('15:33'), actualDeparture: T('15:40') }),
        p(4, 'CDI A. CASTILLO', 'CDI', { actualArrival: T('15:51'), actualDeparture: T('16:05') }),
        p(5, 'REAL DE CATORCE', null, { isReturnToBase: true, actualArrival: T('16:35'), actualDeparture: T('17:01') })
    ];
    const viaje = (bu: string, ps: ParadaConId[]) => repartirHoras(
        { businessUnit: bu, stops: ps, inicio: T('09:30'), fin: T('17:01') }, mapa, 7.5);
    const antes = viaje('SAE LOMAS, CDI, REPOSICION, RETIRO', paradas);
    const r = reasignarUnidades('SAE LOMAS, CDI, REPOSICION, RETIRO', paradas, [{ stopId: 3, unidad: 'REPOSICION' }], mapa);
    const nuevas = paradas.map((x) => (r.rutas.has(x.id) ? { ...x, ruta: r.rutas.get(x.id)! } : x));
    const despues = viaje(r.unidadesDelViaje.join(', '), nuevas);
    const red = (h: Record<string, number>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Math.round(v * 100) / 100]));
    console.log('     antes  ', JSON.stringify(red(antes.horas)));
    console.log('     despues', JSON.stringify(red(despues.horas)));
    esperar('REPOSICION pasa a tener horas', (despues.horas['REPOSICION'] || 0) > 0 && !(antes.horas['REPOSICION'] > 0), red(despues.horas));
    esperar('CDI pierde horas', (despues.horas['CDI'] || 0) < (antes.horas['CDI'] || 0), red(despues.horas));
    const suma = Object.values(despues.horas).reduce((a, b) => a + b, 0);
    esperar('las horas siguen sumando 7,5', Math.abs(suma - 7.5) < 0.001, suma);
}

console.log('\n8. Viaje con tramos del chofer: la correccion a mano manda sobre los tramos');
{
    const T = (hh: string) => `2026-10-05T${hh}:00.000Z`;
    const paradas = [
        p(1, 'A', 'R13 LANUS', { actualDeparture: T('10:00') }),
        p(2, 'B', 'R13 LANUS', { actualDeparture: T('11:00') }),
        p(3, 'C', 'SAM 1 R13', { actualDeparture: T('12:00') }),
        p(4, 'D', 'SAM 1 R13', { actualDeparture: T('13:00') })
    ];
    const tramos = [
        { ruta: 'R13 LANUS', inicio: T('09:00'), fin: T('11:00') },
        { ruta: 'SAM 1 R13', inicio: T('11:00'), fin: T('13:00') }
    ];
    const base = { businessUnit: 'SAE LANUS, SAM', inicio: T('09:00'), fin: T('13:00'), tramos };
    const r = reasignarUnidades('SAE LANUS, SAM', paradas, [{ stopId: 3, unidad: 'SAE LANUS' }], mapa);
    const nuevas = paradas.map((x) => (r.rutas.has(x.id) ? { ...x, ruta: r.rutas.get(x.id)! } : x));
    const sinMarca = repartirHoras({ ...base, stops: nuevas }, mapa, 4);
    const conMarca = repartirHoras({ ...base, stops: nuevas, unidadesAMano: true }, mapa, 4);
    esperar('sin la marca siguen mandando los tramos (2 y 2)', sinMarca.metodo === 'por los tramos del chofer' && sinMarca.horas['SAE LANUS'] === 2, sinMarca);
    esperar('con la marca, por horario de cada parada (3 y 1)',
        conMarca.metodo === 'por horario de cada parada' && Math.abs(conMarca.horas['SAE LANUS'] - 3) < 0.001 && Math.abs(conMarca.horas['SAM'] - 1) < 0.001, conMarca);
}

console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
process.exit(todo ? 0 : 1);
