/**
 * Prueba el lector de la planilla de cajones de trafico (src/planillaCajones.ts).
 *   cd server && npx ts-node scripts/probar_planilla_cajones.ts [ruta del Excel]
 * Sin ruta, arma una planilla chica de prueba con el mismo formato.
 */
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { leerPlanillaCajones, compararCajones, repartoDeHoja, repartoDeViaje, MovimientoApp } from '../src/planillaCajones';

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};

console.log('\n1. Nombres de hoja y de reparto');
esperar('R16 - MAXI SUAREZ', JSON.stringify(repartoDeHoja('R16 - MAXI SUAREZ')) === '{"codigo":"R16","patente":null}');
esperar('LIBRE - AA755TA', JSON.stringify(repartoDeHoja('LIBRE - AA755TA')) === '{"codigo":"LIBRE","patente":"AA755TA"}');
esperar('R19 -EZEQUIEL (sin espacio)', repartoDeHoja('R19 -EZEQUIEL SALAZAR')?.codigo === 'R19');
esperar('Resumen no es reparto', repartoDeHoja('Resumen 21-28 Sep') === null && repartoDeHoja('Repartos') === null && repartoDeHoja('--') === null);
esperar('viaje R16 LANUS con usuario R16 -> R16', repartoDeViaje({ assignedMobileUser: 'R16', reparto: 'R16 LANUS' }, []) === 'R16');
esperar('LIBRE del camion R6 -> R6', repartoDeViaje({ assignedMobileUser: 'R6', reparto: 'LIBRE' }, []) === 'R6');
esperar('LIBRE sin usuario con la patente -> LIBRE', repartoDeViaje({ assignedMobileUser: null, reparto: 'LIBRE', vehicle: 'AA 755 TA' }, ['AA755TA']) === 'LIBRE');

console.log('\n2. Formato de la planilla (bloques SALIDA / ENTRADA / DIFERENCIA)');
{
    const d1 = 46342, d2 = 46343;  // 16/11 y 17/11
    const filas = [
        [], ['', '', 'DIAS', d1, d2],
        ['', 'SALIDA', '', 5, 4], ['PALLET', 'ENTRADA', '', 5, 4], ['', 'DIFERENCIA', '', 0, 0], [],
        ['', '', 'DIAS', d1, d2],
        ['CAJONES PECO', 'SALIDA', '', 10, ''], ['', 'ENTRADA', '', 8, ''], ['', 'DIFERENCIA', '', 2, 0], [], [],
        ['DEPO', 'SALIDA', '', 13, 2], ['', 'ENTRADA', '', 15, 0], ['', 'DIFERENCIA', '', -2, 2],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'R1 - ELIAS ZURITA');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Resumen']]), 'Resumen 21-28 Sep');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const r = leerPlanillaCajones(buf);
    const k = (t: string, f: string) => r.filas.find((x) => x.tipo === t && x.fecha === f);
    esperar('pallet (nombre en la fila de ENTRADA)', k('pallet', '2026-11-16')?.salida === 5 && k('pallet', '2026-11-17')?.entrada === 4, r.filas);
    esperar('peco 16/11 = 10 / 8; el 17/11 vacio no aparece', k('peco', '2026-11-16')?.salida === 10 && !k('peco', '2026-11-17'), r.filas);
    esperar('depo sin fila DIAS propia usa las fechas de arriba', k('deposito', '2026-11-17')?.salida === 2 && k('deposito', '2026-11-16')?.entrada === 15, r.filas);
    esperar('el resumen se ignora', r.ignoradas.includes('Resumen 21-28 Sep') && r.hojas.length === 1, r);

    console.log('\n3. Comparacion con la app');
    const app: MovimientoApp[] = [
        { codigo: 'R1', fecha: '2026-11-16', tipo: 'peco', dejados: 10, recuperados: 8, viajeId: 1 },
        { codigo: 'R1', fecha: '2026-11-16', tipo: 'deposito', dejados: 13, recuperados: 14, viajeId: 1 },
        { codigo: 'R1', fecha: '2026-11-18', tipo: 'peco', dejados: 3, recuperados: 0, viajeId: 2 },
    ];
    const c = compararCajones(r.filas, app, r.hojas);
    const r1 = c.repartos.find((x) => x.codigo === 'R1')!;
    const dia = (f: string) => r1.dias.find((d) => d.fecha === f)!;
    esperar('16/11: diferencia solo en DEPO (entrada 15 vs 14)', dia('2026-11-16').estado === 'diferencia' && JSON.stringify(dia('2026-11-16').diferencias) === '["deposito"]', dia('2026-11-16'));
    esperar('17/11: solo en la planilla', dia('2026-11-17').estado === 'solo planilla', dia('2026-11-17'));
    esperar('18/11: solo en la app', dia('2026-11-18').estado === 'solo app', dia('2026-11-18'));
    esperar('pallet no cuenta como diferencia (la app no lo carga)', !dia('2026-11-16').diferencias.includes('pallet'));
    esperar('totales', r1.totales.peco.ps === 10 && r1.totales.peco.ad === 13 && r1.totales.deposito.pe === 15, r1.totales);

    // Un dia con la planilla en cero y la app sin nada: sin movimiento, esta bien
    const ceros = compararCajones([{ hoja: 'R2', codigo: 'R2', patente: null, fecha: '2026-11-11', tipo: 'peco', salida: 0, entrada: 0 },
        { hoja: 'R2', codigo: 'R2', patente: null, fecha: '2026-11-11', tipo: 'pallet', salida: 4, entrada: 4 }], [], [{ nombre: 'R2', codigo: 'R2', patente: null }]);
    esperar('planilla en cero (con pallet) y app vacia = ok', ceros.repartos[0].dias[0].estado === 'ok', ceros.repartos[0].dias[0]);
}

const ruta = process.argv[2];
if (ruta && fs.existsSync(ruta)) {
    console.log('\n4. La planilla real');
    const r = leerPlanillaCajones(fs.readFileSync(ruta), '2026-11-01', '2026-11-30');
    console.log('   hojas:', r.hojas.map((h) => `${h.codigo}${h.patente ? '(' + h.patente + ')' : ''}:${h.dias}d`).join(' '));
    console.log('   ignoradas:', r.ignoradas.join(' | '));
    const d = r.filas.filter((f) => f.codigo === 'R1' && f.fecha === '2026-11-17');
    esperar('R1 17/11 igual a las celdas (pallet 5/5, burzaco 3/4, depo 13/15, jaula 1/1)',
        d.find((x) => x.tipo === 'pallet')?.salida === 5 && d.find((x) => x.tipo === 'burzaco')?.entrada === 4 &&
        d.find((x) => x.tipo === 'deposito')?.salida === 13 && d.find((x) => x.tipo === 'deposito')?.entrada === 15 &&
        d.find((x) => x.tipo === 'jaula')?.salida === 1, d);
}

console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
process.exit(todo ? 0 : 1);
