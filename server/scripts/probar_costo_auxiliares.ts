/**
 * Prueba el reparto del sueldo de los auxiliares (src/costoAuxiliares.ts).
 *
 *   cd server && npx ts-node scripts/probar_costo_auxiliares.ts
 */
import { repartirAuxiliares, auxiliaresDeTexto, clavePersona, ViajeConAuxiliares, SueldoDelAuxiliar } from '../src/costoAuxiliares';

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const cerca = (a: number, b: number) => Math.abs(a - b) < 0.01;
const V = (id: number, dia: string, horas: number, tercerizado: boolean, ...auxiliares: string[]): ViajeConAuxiliares =>
    ({ id, dia, horas, tercerizado, auxiliares });
const sueldos = (tabla: Record<string, SueldoDelAuxiliar>) =>
    (nombre: string) => tabla[clavePersona(nombre)] || null;

console.log('\n1. Nombres');
{
    esperar('mismo nombre en otro orden y con doble espacio', clavePersona('Ivan  Bonetti') === clavePersona('BONETTI IVÁN'));
    const l = auxiliaresDeTexto('ERWIN VILLAGRA/EZEQUIEL SILVA', 'erwin villagra', '--', 'SIN AUXILIAR', 'A. PEREZ, JUAN GOMEZ');
    esperar('separa por coma y barra, saca vacios y repetidos', JSON.stringify(l) === JSON.stringify(['ERWIN VILLAGRA', 'EZEQUIEL SILVA', 'A. PEREZ', 'JUAN GOMEZ']), l);
}

console.log('\n2. FIJO: el bruto entero, repartido por horas entre propios y tercerizados');
{
    const r = repartirAuxiliares([
        V(1, '2026-10-01', 1, false, 'CARLOS BERNACHEA'),
        V(2, '2026-10-01', 7, true, 'CARLOS BERNACHEA'),
        V(3, '2026-10-02', 8, true, 'BERNACHEA CARLOS'),
    ], sueldos({ [clavePersona('BERNACHEA CARLOS')]: { bruto: 1_600_000, jornal: 72_727, modo: 'FIJO' } }));
    esperar('1 h de 16 -> $100.000; 7 h -> $700.000; 8 h -> $800.000',
        cerca(r.porViaje.get(1)!, 100_000) && cerca(r.porViaje.get(2)!, 700_000) && cerca(r.porViaje.get(3)!, 800_000), [...r.porViaje]);
    const p = r.personas[0];
    esperar('la suma da el bruto, y se separa propio de tercerizado', cerca(p.costo, 1_600_000) && cerca(p.costoPropios, 100_000) && cerca(p.costoTercerizados, 1_500_000), p);
}

console.log('\n3. JORNAL: cada dia trabajado, repartido entre los viajes del dia');
{
    const r = repartirAuxiliares([
        V(1, '2026-10-01', 2, false, 'ALEXIS PEREZ'),
        V(2, '2026-10-01', 6, true, 'ALEXIS PEREZ'),
        V(3, '2026-10-02', 5, true, 'ALEXIS PEREZ'),
    ], sueldos({ [clavePersona('PEREZ ALEXIS')]: { bruto: 1_185_181, jornal: 50_000, modo: 'JORNAL' } }));
    esperar('dia 1: 12.500 + 37.500; dia 2: 50.000 (no usa el bruto)',
        cerca(r.porViaje.get(1)!, 12_500) && cerca(r.porViaje.get(2)!, 37_500) && cerca(r.porViaje.get(3)!, 50_000), [...r.porViaje]);
}

console.log('\n4. Ficha sin dato: con bruto va como FIJO, solo con jornal como JORNAL');
{
    const r = repartirAuxiliares([
        V(1, '2026-10-01', 4, false, 'UNO'), V(2, '2026-10-02', 4, true, 'UNO'),
        V(3, '2026-10-01', 4, false, 'DOS'), V(4, '2026-10-02', 4, true, 'DOS'),
    ], sueldos({
        [clavePersona('UNO')]: { bruto: 800, jornal: 30, modo: null },
        [clavePersona('DOS')]: { bruto: 0, jornal: 30, modo: null },
    }));
    esperar('UNO reparte 800, DOS cobra 30 por dia', cerca(r.porViaje.get(1)!, 400) && cerca(r.porViaje.get(3)!, 30) && cerca(r.porViaje.get(4)!, 30), [...r.porViaje]);
}

console.log('\n5. Dos auxiliares en el mismo viaje, uno sin sueldo, y meses separados');
{
    const r = repartirAuxiliares([
        V(1, '2026-10-31', 5, false, 'UNO', 'SIN SUELDO'),
        V(2, '2026-11-02', 5, false, 'UNO'),
    ], sueldos({ [clavePersona('UNO')]: { bruto: 1000, jornal: 0, modo: 'FIJO' } }));
    esperar('cada mes reparte su propio bruto', cerca(r.porViaje.get(1)!, 1000) && cerca(r.porViaje.get(2)!, 1000), [...r.porViaje]);
    esperar('avisa el que no tiene sueldo', r.sinSueldo.length === 1 && r.sinSueldo[0].nombre === 'SIN SUELDO', r.sinSueldo);
    esperar('el detalle dice quien es quien', r.detalle.get(1)!.length === 1 && r.detalle.get(1)![0].nombre === 'UNO', r.detalle.get(1));
}

console.log('\n6. Sin horas en ningun viaje: partes iguales');
{
    const r = repartirAuxiliares([V(1, '2026-10-01', 0, true, 'UNO'), V(2, '2026-10-03', 0, true, 'UNO')],
        sueldos({ [clavePersona('UNO')]: { bruto: 1000, jornal: 0, modo: 'FIJO' } }));
    esperar('500 y 500', cerca(r.porViaje.get(1)!, 500) && cerca(r.porViaje.get(2)!, 500), [...r.porViaje]);
}

console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
process.exit(todo ? 0 : 1);
