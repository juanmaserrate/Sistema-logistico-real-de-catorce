/**
 * Prueba el calculo del OTIF (src/otif.ts).
 *
 *   cd server && npx ts-node scripts/probar_otif.ts
 */
import { calcularOtif, claveEscuela, EntregaOtif } from '../src/otif';

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
// Hora argentina -> Date (UTC = AR + 3)
const H = (fecha: string, hhmm: string) => new Date(`${fecha}T${hhmm}:00-03:00`);
const E = (escuela: string, unidad: string, estado: string, hhmm: string | null, fecha = '2026-10-06'): EntregaOtif => ({
    viajeId: 1, fecha, reparto: 'R1', chofer: 'X', contrato: 'Propio', unidad, escuela, estado,
    llegada: hhmm ? H(fecha, hhmm) : null, salida: null,
});

console.log('\n1. Nombres de escuela');
{
    const pares: Array<[string, string]> = [
        ['E.P.B N° 49', 'EP 49'], ['EP 49', 'EP 49'], ['ESS N °56', 'ES 56'], ['J967', 'J 967'], ['JI 941', 'J 941'],
        ['J.915', 'J 915'], ['TEC. 3', 'TEC 3'], ['TECNICA 4', 'TEC 4'], ['CPII 6', 'CPII 6'], ['ES.924', 'ES 924'],
    ];
    for (const [a, b] of pares) esperar(`"${a}" -> ${b}`, claveEscuela(a) === b, claveEscuela(a));
    esperar('NTRA = NUESTRA', claveEscuela('NTRA AMERICA') === claveEscuela('NUESTRA AMERICA'), claveEscuela('NTRA AMERICA'));
}

console.log('\n2. A tiempo segun la unidad');
{
    const r = calcularOtif([
        E('EP 1', 'SAE BROWN', 'COMPLETED', '08:59'),
        E('EP 2', 'SAE BROWN', 'COMPLETED', '09:01'),
        E('EP 3', 'SAM', 'COMPLETED', '15:30'),          // sin limite
        E('CDI 1', 'CDI', 'COMPLETED', '13:59'),
        E('CDI 2', 'CDI', 'COMPLETED', '14:05'),
        E('EP 4', 'SAE LANUS', 'COMPLETED', null),       // sin hora: no se puede decir que llego a tiempo
    ], []);
    const ok = r.entregas.map((x) => x.aTiempo);
    esperar('8:59 si, 9:01 no, SAM 15:30 si, CDI 13:59 si, CDI 14:05 no, sin hora no', JSON.stringify(ok) === JSON.stringify([true, false, true, true, false, false]), ok);
}

console.log('\n3. Completa = entregada y sin incidencia (por fecha y escuela; el dia siguiente tambien)');
{
    const r = calcularOtif([
        E('E.P.B N° 10', 'SAE BROWN', 'COMPLETED', '08:00'),
        E('JI 5', 'SAE LOMAS', 'COMPLETED', '08:00'),
        E('EP 7', 'SAE BROWN', 'UNDELIVERABLE', '08:00'),
        E('EP 8', 'SAE BROWN', 'PENDING', null),
    ], [
        { fecha: '2026-10-06', unidad: 'SAE BROWN', establecimiento: 'EP 10', tipo: 'FALTANTE DE PRODUCTO' },
        { fecha: '2026-10-07', unidad: 'JARDINES LOMAS', establecimiento: '5', tipo: 'PRODUCTO EN MAL ESTADO' },   // un dia despues, solo numero
    ]);
    esperar('EP 10 con incidencia', r.entregas[0].completa === false && r.entregas[0].motivo === 'Con incidencia', r.entregas[0]);
    esperar('JI 5 con incidencia (cargada al dia siguiente, "5" de jardines)', r.entregas[1].completa === false, r.entregas[1]);
    esperar('No entregada y sin marcar', r.entregas[2].motivo === 'No entregada' && r.entregas[3].motivo === 'Sin marcar', [r.entregas[2].motivo, r.entregas[3].motivo]);
    esperar('2 incidencias asignadas', r.incidencias.asignadas === 2, r.incidencias);
}

console.log('\n4. La formula, y retiros y reposiciones afuera');
{
    const r = calcularOtif([
        E('EP 1', 'SAE BROWN', 'COMPLETED', '08:00'),
        E('EP 2', 'SAE BROWN', 'COMPLETED', '10:00'),
        E('EP 3', 'SAM', 'COMPLETED', '12:00'),
        E('PROVEEDOR X', 'RETIRO', 'COMPLETED', '07:00'),
        E('EP 9', 'REPOSICION', 'COMPLETED', '11:00'),
    ], []);
    esperar('(2 / 3) x 100 = 66,7', r.formula.aTiempoYCompletos === 2 && r.formula.evaluados === 3 && r.formula.otif === 66.7, r.formula);
    esperar('2 fuera', r.fuera === 2, r.fuera);
}

console.log('\n5. Escuela con dos entregas el mismo dia: la incidencia va a la de su unidad');
{
    const r = calcularOtif([
        E('EP 20', 'SAE LANUS', 'COMPLETED', '08:00'),
        E('EP 20', 'SAM', 'COMPLETED', '12:00'),
    ], [{ fecha: '2026-10-06', unidad: 'SAM', establecimiento: 'EP 20', tipo: 'MAL ROTULADO' }]);
    esperar('solo la de SAM', r.entregas[0].completa === true && r.entregas[1].completa === false, r.entregas.map((x) => x.completa));
}

console.log('\n6. Incidencias que no dicen la escuela, o de una escuela que no se entrego');
{
    const r = calcularOtif([E('EP 1', 'SAE BROWN', 'COMPLETED', '08:00')], [
        { fecha: '2026-10-06', unidad: 'SAE BROWN', establecimiento: '26 ESTABLECIMIENTOS', tipo: 'FALTANTE' },
        { fecha: '2026-10-06', unidad: 'SAE BROWN', establecimiento: 'EP 99', tipo: 'FALTANTE' },
    ]);
    esperar('1 general y 1 sin asignar, la entrega queda completa', r.incidencias.generales.length === 1 && r.incidencias.sinAsignar.length === 1 && r.entregas[0].completa, r.incidencias);
}

console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
process.exit(todo ? 0 : 1);
