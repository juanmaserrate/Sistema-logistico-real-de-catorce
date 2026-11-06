/**
 * Prueba del conteo del modulo Presupuesto, sin base.
 *   npx ts-node scripts/probar_presupuesto.ts
 * Si existe ../respaldos/viajes_oct_para_presupuesto.json (bajado de
 * paradas-de-viajes), ademas lo corre con los viajes reales de octubre.
 */
import fs from 'fs';
import path from 'path';
import { contarPresupuesto, ViajeParaPresupuesto } from '../src/presupuestoViajes';

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'trip-categories-config.json'), 'utf8'));

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};

let id = 1;
const v = (dia: string, contrato: string, unidad: string, extra: Partial<ViajeParaPresupuesto> = {}): ViajeParaPresupuesto => ({
    id: id++, date: `2026-${dia}T15:00:00.000Z`, status: 'COMPLETED', contractType: contrato, businessUnit: unidad,
    zone: '', tripType: '', driver: 'DIEGO GUIDA', ...extra
});

const viajes: ViajeParaPresupuesto[] = [
    v('10-05', 'Propio', 'SAE BROWN', { zone: 'LONGCHAMPS' }),
    v('10-06', 'Propio', 'SAE BROWN', { zone: 'RAFAEL CALZADA' }),          // alias de Calzada
    v('10-07', 'Tercerizado', 'SAE BROWN', { zone: 'MALVINAS ARGENTINAS' }),
    v('10-08', 'Propio', 'SAE BROWN', { zone: 'BROWN' }),                   // no es ninguna -> Otras localidades
    v('10-09', 'Propio', 'SAE BROWN, RETIRO', { zone: 'DON ORIONE' }),      // cuenta en las dos
    v('10-10', 'Propio', 'SAE LANUS', { tripType: 'R12' }),                 // Zona 4
    v('10-10', 'Tercerizado', 'SAE LANUS, SAM', { tripType: 'R16' }),       // Zona 8 + SAM
    v('10-11', 'Propio', 'SAE LOMAS', { tripType: 'R19' }),
    v('10-11', 'Tercerizado', 'SAE LOMAS', { tripType: 'FACUNDO FERNANDEZ' }), // Otros repartos
    v('10-12', 'Propio', 'REPOSICION', { zone: 'LONGCHAMPS', tripType: 'LIBRE' }),    // Brown
    v('10-12', 'Propio', 'REPOSICION', { zone: 'LOMAS DE ZAMORA', tripType: 'LIBRE' }), // Lomas Jardines
    v('10-12', 'Tercerizado', 'REPOSICION', { zone: 'LANUS', tripType: 'LIBRE' }),    // bloque REPOSICION
    v('10-13', 'Propio', 'EVENTO'),
    v('10-13', 'Tercerizado', 'CDI'),
    v('10-14', 'Propio', 'SISTEMAS ALTERNATIVOS'),
    v('10-14', 'Propio', 'DONACION'),                                       // OTRAS UNIDADES
    v('11-02', 'Propio', 'SAE BROWN', { zone: 'CLAYPOLE' }),                // noviembre
    // No cuentan
    v('10-15', 'Propio', 'SAE BROWN', { zone: 'LONGCHAMPS', status: 'PENDING' }),
    v('10-15', 'Propio', 'SAE BROWN', { zone: 'LONGCHAMPS', driver: 'juan' }),        // cuenta de prueba
    v('10-15', '', 'SAE BROWN', { zone: 'LONGCHAMPS' }),                             // sin contrato
    // 31/10 a las 23:30 de Buenos Aires = 1/11 02:30 UTC: es de octubre
    { ...v('10-31', 'Propio', 'CDI'), date: '2026-11-01T02:30:00.000Z' },
];

const inf = contarPresupuesto(viajes, cfg, 2026);
const OCT = 9, NOV = 10;
const bloque = (clave: string, contrato: string | null) => inf.bloques.find((b) => b.clave === clave && b.contrato === contrato)!;
const celda = (clave: string, contrato: string | null, filaNombre: string, mes = OCT) =>
    bloque(clave, contrato)?.filas.find((f) => f.nombre === filaNombre)?.meses[mes] ?? null;

console.log('PRESUPUESTO: conteo de viajes por unidad\n');
for (const b of inf.bloques) {
    console.log(`  ${b.titulo}${b.contrato ? ' · ' + b.contrato : ''}  (${b.total})`);
    for (const f of b.filas) console.log(`      ${f.nombre.padEnd(28)} oct ${f.meses[OCT]}  nov ${f.meses[NOV]}`);
}
console.log('');

console.log('1. Que cuenta');
esperar('solo completados, sin la cuenta de prueba ni los sin contrato',
    inf.resumen.viajesCompletados === 18, inf.resumen.viajesCompletados);
esperar('el sin contrato queda avisado', inf.resumen.sinContrato[OCT] === 1, inf.resumen.sinContrato);
esperar('el de las 23:30 del 31/10 es de octubre', celda('CDI', null, 'Propio') === 1);

console.log('\n2. SAE BROWN por localidad');
esperar('Longchamps propio 1', celda('SAE_BROWN', 'Propio', 'Longchamps') === 1);
esperar('Rafael Calzada cuenta como Calzada', celda('SAE_BROWN', 'Propio', 'Calzada') === 1);
esperar('Malvinas tercerizado 1', celda('SAE_BROWN', 'Tercerizado', 'Malvinas') === 1);
esperar('una localidad que no esta va a Otras localidades', celda('SAE_BROWN', 'Propio', 'Otras localidades') === 1);
esperar('la reposicion de Longchamps va a Reposiciones de Brown', celda('SAE_BROWN', 'Propio', 'Reposiciones') === 1);
esperar('las filas de la planilla estan aunque den cero',
    ['Longchamps', 'Calzada', 'Claypole', 'Don Orione', 'Malvinas', 'Reposiciones'].every((n) =>
        bloque('SAE_BROWN', 'Tercerizado').filas.some((f) => f.nombre === n)));
esperar('noviembre aparte (Claypole)', celda('SAE_BROWN', 'Propio', 'Claypole', NOV) === 1 && celda('SAE_BROWN', 'Propio', 'Claypole') === 0);

console.log('\n3. Viajes de dos unidades cuentan en las dos');
esperar('SAE BROWN, RETIRO: Don Orione y RETIRO', celda('SAE_BROWN', 'Propio', 'Don Orione') === 1 && celda('RETIRO', null, 'Propio') === 1);
esperar('SAE LANUS, SAM: Zona 8 tercerizado y SAM', celda('SAE_LANUS', 'Tercerizado', 'Zona 8') === 1 && celda('SAM', null, 'Tercerizado') === 1);
esperar('el resumen lo dice', inf.resumen.viajesEnVariasUnidades === 2 && inf.resumen.conteos === inf.resumen.viajesCompletados + 2,
    inf.resumen);

console.log('\n4. SAE LANUS por zona y LOMAS JARDINES por reparto');
esperar('R12 es Zona 4', celda('SAE_LANUS', 'Propio', 'Zona 4') === 1);
esperar('las zonas en el orden de la planilla',
    bloque('SAE_LANUS', 'Propio').filas.map((f) => f.nombre).join(',') === 'Zona 8,Zona 14,Zona 4,Zona 17',
    bloque('SAE_LANUS', 'Propio').filas.map((f) => f.nombre));
esperar('R19 propio', celda('LOMAS_JARDINES', 'Propio', 'R19') === 1);
esperar('un reparto que no es R18-R20 va a Otros repartos', celda('LOMAS_JARDINES', 'Tercerizado', 'Otros repartos') === 1);
esperar('la reposicion de Lomas va a Reposiciones de Lomas Jardines', celda('LOMAS_JARDINES', 'Propio', 'Reposiciones') === 1);

console.log('\n5. Los bloques simples y las otras unidades');
esperar('REPOSICION tiene solo la de Lanus', celda('REPOSICION', null, 'Tercerizado') === 1 && celda('REPOSICION', null, 'Propio') === 0);
esperar('EVENTO -> EVENTOS', celda('EVENTOS', null, 'Propio') === 1);
esperar('CDI tercerizado', celda('CDI', null, 'Tercerizado') === 1);
esperar('Sistemas alternativos', celda('SISTEMAS_ALTERNATIVOS', null, 'Propio') === 1);
esperar('DONACION va a OTRAS UNIDADES', celda('OTRAS', null, 'DONACION · Propio') === 1);
esperar('el orden de bloques es el de la planilla',
    inf.bloques.map((b) => b.clave).filter((c, i, a) => a.indexOf(c) === i).join(',')
    === 'SAE_BROWN,SAE_LANUS,LOMAS_JARDINES,SAM,SISTEMAS_ALTERNATIVOS,CDI,RETIRO,EVENTOS,REPOSICION,OTRAS',
    inf.bloques.map((b) => b.clave));
esperar('cada bloque suma sus filas',
    inf.bloques.every((b) => b.total === b.filas.reduce((a, f) => a + f.total, 0)));

// ── Con los viajes reales de octubre, si estan ──
const real = path.join(__dirname, '..', '..', 'respaldos', 'viajes_oct_para_presupuesto.json');
if (fs.existsSync(real)) {
    console.log('\n6. Octubre real');
    const filas = JSON.parse(fs.readFileSync(real, 'utf8')).map((x: any) => ({
        id: x.id, date: `${x.fecha}T15:00:00.000Z`, status: x.estado, contractType: x.contrato,
        businessUnit: x.unidad, zone: x.zona, tripType: x.tipo, reparto: x.reparto,
        driver: x.chofer, assignedMobileUser: x.usuarioApp
    }));
    const r = contarPresupuesto(filas, cfg, 2026);
    console.log(`     ${r.resumen.viajesCompletados} completados, ${r.resumen.viajesEnVariasUnidades} de varias unidades, ${r.resumen.conteos} conteos, sin contrato ${r.resumen.sinContrato[OCT]}`);
    for (const b of r.bloques) {
        console.log(`     ${(b.titulo + (b.contrato ? ' · ' + b.contrato : '')).padEnd(30)} ${String(b.totalMeses[OCT]).padStart(4)}   `
            + b.filas.filter((f) => f.meses[OCT]).map((f) => `${f.nombre} ${f.meses[OCT]}`).join(' · '));
    }
    const completados = filas.filter((f: any) => f.status === 'COMPLETED' && !/^juan$/i.test(String(f.driver || '')) && !/^juan$/i.test(String(f.assignedMobileUser || ''))).length;
    esperar('cuenta todos los completados de octubre', r.resumen.viajesCompletados === completados, [r.resumen.viajesCompletados, completados]);
    esperar('ningun viaje se pierde: conteos = viajes + los de varias unidades extra',
        r.resumen.conteos >= r.resumen.viajesCompletados);
}

console.log('\n' + (todo ? 'TODO BIEN' : '*** HAY FALLAS ***'));
process.exit(todo ? 0 : 1);
