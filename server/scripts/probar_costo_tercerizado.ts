/**
 * Prueba el reparto del costo de un tercerizado con varios viajes en el dia.
 *
 *   cd server && npx ts-node scripts/probar_costo_tercerizado.ts
 */
import { costoTercerizadoPorHoras, ViajeParaCostoDelDia } from '../src/costoTercerizado';

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const v = (id: number, extra: Partial<ViajeParaCostoDelDia>): ViajeParaCostoDelDia => ({
    id, fecha: '2026-11-03T12:00:00.000Z', chofer: 'JUAN PEREZ', tercerizado: true, valor: 0, horas: 0, ...extra
});

console.log('\n1. Dos viajes en el dia: la tarifa del primero se reparte 3 h / 1 h');
{
    const m = costoTercerizadoPorHoras([v(1, { valor: 290000, horas: 3 }), v(2, { valor: 0, horas: 1 })]);
    esperar('primero 217.500', m.get(1) === 217500, m.get(1));
    esperar('segundo 72.500', m.get(2) === 72500, m.get(2));
    esperar('la suma da la tarifa', (m.get(1)! + m.get(2)!) === 290000);
}

console.log('\n2. Un solo viaje en el dia: no se toca');
{
    const m = costoTercerizadoPorHoras([v(1, { valor: 290000, horas: 5 })]);
    esperar('no aparece en el reparto', !m.has(1));
}

console.log('\n3. Mismo chofer, dias distintos: no se mezclan');
{
    const m = costoTercerizadoPorHoras([
        v(1, { valor: 290000, horas: 3 }),
        v(2, { valor: 290000, horas: 1, fecha: '2026-11-04T12:00:00.000Z' })
    ]);
    esperar('nadie cambia', m.size === 0, [...m]);
}

console.log('\n4. "Paga aparte": queda afuera con su valor');
{
    const m = costoTercerizadoPorHoras([
        v(1, { valor: 290000, horas: 3 }),
        v(2, { valor: 0, horas: 1 }),
        v(3, { valor: 150000, horas: 2, texto: 'SE PAGA APARTE' })
    ]);
    esperar('el que paga aparte no se reparte', !m.has(3));
    esperar('los otros dos se reparten entre ellos', m.get(1) === 217500 && m.get(2) === 72500, [...m]);
}

console.log('\n5. Sin horas todavia: partes iguales');
{
    const m = costoTercerizadoPorHoras([v(1, { valor: 300000 }), v(2, { valor: 0 }), v(3, { valor: 0 })]);
    esperar('100.000 cada uno', m.get(1) === 100000 && m.get(2) === 100000 && m.get(3) === 100000, [...m]);
}

console.log('\n6. Propios y otro chofer no entran; el nombre se compara sin acentos');
{
    const m = costoTercerizadoPorHoras([
        v(1, { valor: 290000, horas: 2, chofer: 'JOSÉ  GÓMEZ' }),
        v(2, { valor: 0, horas: 2, chofer: 'jose gomez' }),
        v(3, { valor: 500000, horas: 4, chofer: 'JOSE GOMEZ', tercerizado: false }),
        v(4, { valor: 290000, horas: 4, chofer: 'OTRO' })
    ]);
    esperar('mitad y mitad', m.get(1) === 145000 && m.get(2) === 145000, [...m]);
    esperar('el propio y el otro chofer no cambian', !m.has(3) && !m.has(4));
}

console.log('\n7. Centavos: la suma da exacto');
{
    const m = costoTercerizadoPorHoras([v(1, { valor: 100000, horas: 1 }), v(2, { horas: 1 }), v(3, { horas: 1 })]);
    const suma = [...m.values()].reduce((a, b) => a + b, 0);
    esperar('suma 100.000', Math.abs(suma - 100000) < 0.001, [...m]);
}

console.log('\n' + (todo ? 'TODO OK' : 'HAY FALLAS'));
process.exit(todo ? 0 : 1);
