/**
 * Arma el Excel con filas de mentira y lo vuelve a leer, para comprobar que
 * las hojas nuevas quedan bien y que la hoja «Viajes» no empezo a contar doble.
 *
 *   npx ts-node scripts/probar_hojas_contrato.ts
 */
import fs from 'fs';
import path from 'path';
import { unzipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { armarLibroViajes } from '../src/libroViajes';

const SALIDA = path.join(__dirname, '..', '..', 'tmp_prueba_libro.xlsx');

const base = (id: number, contrato: string, unidad: string, extra: any = {}) => ({
    'ID viaje': id, 'Fecha': new Date(Date.UTC(2026, 9, 29)), 'Mes': '10 Octubre',
    'Reparto': 'R6', 'Localidad': 'RAFAEL CALZADA', 'Unidad de negocio': unidad,
    'Contrato': contrato, 'Proveedor': contrato === 'Propio' ? 'PROPIO' : 'JAVIER GAREIS',
    'Chofer': 'DIEGO GUIDA', 'Estado': 'Cerrado',
    'Salida deposito': '05:31', 'Llegada deposito': '08:46',
    'Horas por ruta': 'R6 2:55 · RETIRO 0:20',
    ...extra,
});

// 8192: propio, reparte para dos -> padre + 2 partes
// 8200: propio, una sola unidad  -> una fila sola
// 9001: tercerizado, dos unidades -> padre + 2 partes
const filas: any[] = [
    { ...base(8192, 'Propio', 'SAE BROWN, RETIRO', { 'Duracion horas': 3.26, 'Costo': 250000, 'Paradas planificadas': 10 }), _tipo: 'padre' },
    { ...base(8192, 'Propio', 'SAE BROWN', { 'Duracion horas': 2.92, 'Costo': 224000, 'Paradas planificadas': 9 }), _tipo: 'hijo' },
    { ...base(8192, 'Propio', 'RETIRO', { 'Duracion horas': 0.34, 'Costo': 26000, 'Paradas planificadas': 1 }), _tipo: 'hijo' },
    { ...base(8200, 'Propio', 'SAE LOMAS', { 'Duracion horas': 4.5, 'Costo': 180000, 'Paradas planificadas': 12 }), _tipo: 'unico' },
    { ...base(9001, 'Tercerizado', 'SAM, Patios', { 'Duracion horas': 6, 'Costo': 290000, 'Paradas planificadas': 8 }), _tipo: 'padre' },
    { ...base(9001, 'Tercerizado', 'SAM', { 'Duracion horas': 4, 'Costo': 193333, 'Paradas planificadas': 5 }), _tipo: 'hijo' },
    { ...base(9001, 'Tercerizado', 'Patios', { 'Duracion horas': 2, 'Costo': 96667, 'Paradas planificadas': 3 }), _tipo: 'hijo' },
];

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};

console.log('HOJAS «PROPIOS» Y «TERCERIZADOS»\n');

const buffer = armarLibroViajes(filas, 'PRUEBA', []);
fs.writeFileSync(SALIDA, buffer);
console.log('  archivo:', SALIDA, '·', Math.round(buffer.length / 1024), 'KB\n');

// ── Lo que ve Excel ──
const wb = XLSX.read(buffer, { type: 'buffer' });
console.log('1. Las hojas');
console.log('   ', wb.SheetNames.join(' | '));
esperar('estan las cinco', wb.SheetNames.join('|') === 'Resumen|Viajes|Conteo por UN|Propios|Tercerizados', wb.SheetNames);

const leer = (nombre: string) => XLSX.utils.sheet_to_json<any>(wb.Sheets[nombre], { defval: '' });

console.log('\n2. La hoja «Viajes» (la que suma la dinamica)');
const viajes = leer('Viajes');
viajes.forEach((f) => console.log('     ', f['ID viaje'], String(f['Unidad de negocio']).padEnd(20), f['Duracion horas'], '·', f['Costo']));
esperar('no entraron las filas padre', viajes.length === 5, viajes.length);
esperar('no esta el viaje entero de 8192', !viajes.some((f) => f['Unidad de negocio'] === 'SAE BROWN, RETIRO'));
esperar('el costo no se duplico',
    viajes.reduce((a, f) => a + (Number(f['Costo']) || 0), 0) === 224000 + 26000 + 180000 + 193333 + 96667,
    viajes.reduce((a, f) => a + (Number(f['Costo']) || 0), 0));

console.log('\n3. La hoja «Propios»');
const propios = leer('Propios');
propios.forEach((f) => console.log('     ', String(f['Fila']).padEnd(6), f['ID viaje'], String(f['Unidad de negocio']).padEnd(20), f['Duracion horas']));
esperar('solo viajes propios', propios.every((f) => f['Contrato'] === 'Propio'));
esperar('el viaje entero y sus dos partes, mas el de una sola unidad', propios.length === 4, propios.length);
esperar('la primera fila es el viaje entero',
    propios[0]['Fila'] === 'VIAJE' && propios[0]['Unidad de negocio'] === 'SAE BROWN, RETIRO' && propios[0]['Duracion horas'] === 3.26);
esperar('debajo van sus partes', propios[1]['Fila'] === 'parte' && propios[2]['Fila'] === 'parte');
esperar('las partes suman el viaje entero',
    Math.abs(Number(propios[1]['Duracion horas']) + Number(propios[2]['Duracion horas']) - 3.26) < 0.001);
esperar('el de una sola unidad va como VIAJE, sin partes', propios[3]['Fila'] === 'VIAJE' && propios[3]['ID viaje'] === 8200);
esperar('la fecha quedo como fecha, no como numero', propios[0]['Fecha'] instanceof Date || typeof propios[0]['Fecha'] === 'number');

console.log('\n4. La hoja «Tercerizados»');
const terc = leer('Tercerizados');
terc.forEach((f) => console.log('     ', String(f['Fila']).padEnd(6), f['ID viaje'], String(f['Unidad de negocio']).padEnd(20), f['Duracion horas']));
esperar('solo tercerizados', terc.length === 3 && terc.every((f) => f['Contrato'] === 'Tercerizado'), terc.length);
esperar('ningun propio se colo aca', !terc.some((f) => f['ID viaje'] === 8192 || f['ID viaje'] === 8200));

// ── El XML, que es lo que SheetJS no cuenta ──
console.log('\n5. El +/- de Excel');
const zip = unzipSync(new Uint8Array(buffer));
const dec = new TextDecoder();
const sheet4 = dec.decode(zip['xl/worksheets/sheet4.xml']);
esperar('las partes van con outlineLevel', (sheet4.match(/outlineLevel="1"/g) || []).length === 2,
    (sheet4.match(/outlineLevel="1"/g) || []).length);
esperar('el boton queda en la fila de arriba (summaryBelow=0)', sheet4.includes('summaryBelow="0"'));
esperar('la hoja declara que tiene un nivel', sheet4.includes('outlineLevelRow="1"'));
esperar('el encabezado quedo congelado', sheet4.includes('state="frozen"'));

console.log('\n6. El zip queda consistente');
const wbXml = dec.decode(zip['xl/workbook.xml']);
const relsXml = dec.decode(zip['xl/_rels/workbook.xml.rels']);
const tiposXml = dec.decode(zip['[Content_Types].xml']);
for (const [archivo, nombre, rel] of [['sheet4.xml', 'Propios', 'rId7'], ['sheet5.xml', 'Tercerizados', 'rId8']]) {
    esperar(`«${nombre}» esta en la lista de hojas`, wbXml.includes(`name="${nombre}"`) && wbXml.includes(`r:id="${rel}"`));
    esperar(`  y tiene su relacion y su tipo`,
        relsXml.includes(`Id="${rel}"`) && relsXml.includes(`worksheets/${archivo}`) && tiposXml.includes(`/xl/worksheets/${archivo}`));
}
esperar('«Viajes» sigue siendo la hoja 2 (la dinamica la busca por indice)',
    wbXml.indexOf('name="Viajes"') < wbXml.indexOf('name="Conteo por UN"')
    && wbXml.indexOf('name="Conteo por UN"') < wbXml.indexOf('name="Propios"'));
esperar('la dinamica apunta a las filas que hay', dec.decode(zip['xl/pivotCache/pivotCacheDefinition1.xml']).includes('ref="A1:AF6"'),
    (dec.decode(zip['xl/pivotCache/pivotCacheDefinition1.xml']).match(/worksheetSource ref="[^"]*"/) || [])[0]);

// Que no haya quedado una hoja repetida si se arma dos veces
const otra = armarLibroViajes(filas, 'PRUEBA', []);
const wb2 = XLSX.read(otra, { type: 'buffer' });
esperar('armarlo dos veces no duplica las hojas', wb2.SheetNames.length === 5, wb2.SheetNames);

fs.unlinkSync(SALIDA);
console.log('\n' + (todo ? 'TODO BIEN' : '*** HAY FALLAS ***'));
process.exit(todo ? 0 : 1);
