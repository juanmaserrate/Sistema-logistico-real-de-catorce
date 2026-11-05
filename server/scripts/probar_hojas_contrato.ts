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
import { armarLibroViajes, COLUMNAS_CONTRATO, COLUMNAS_LIBRO } from '../src/libroViajes';

const SALIDA = path.join(__dirname, '..', '..', 'tmp_prueba_libro.xlsx');

const base = (id: number, contrato: string, unidad: string, extra: any = {}) => ({
    'ID viaje': id, 'Fecha': new Date(Date.UTC(2026, 9, 29)), 'Mes': '10 Octubre',
    'Reparto': 'R6', 'Localidad': 'RAFAEL CALZADA', 'Partido': 'ALMIRANTE BROWN', 'Unidad de negocio': unidad,
    'Region UN': 'SUR', 'Categoria UN': 'SAE', 'Refrigerado': 'No',
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
esperar('estan las seis, con la base de la dinamica despues del Resumen',
    wb.SheetNames.join('|') === 'Resumen|Base dinámica|Viajes|Conteo por UN|Propios|Tercerizados', wb.SheetNames);
const visibilidad = (wb.Workbook?.Sheets || []).map((x: any) => `${x.name}:${x.Hidden ? 'oculta' : 'visible'}`);
console.log('   ', visibilidad.join(' | '));
esperar('la base de la dinamica esta oculta y las demas se ven',
    visibilidad.join('|') === 'Resumen:visible|Base dinámica:oculta|Viajes:visible|Conteo por UN:visible|Propios:visible|Tercerizados:visible', visibilidad);

const leer = (nombre: string) => XLSX.utils.sheet_to_json<any>(wb.Sheets[nombre], { defval: '' });

console.log('\n2a. La base oculta: el formato de siempre, que es el que lee la dinamica');
const encBase = (XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Base dinámica'], { header: 1 })[0] || []) as string[];
esperar('mismas columnas y en el mismo orden que la plantilla', JSON.stringify(encBase) === JSON.stringify(COLUMNAS_LIBRO), encBase);
esperar('trae las mismas filas que la Viajes visible',
    XLSX.utils.sheet_to_json<any>(wb.Sheets['Base dinámica']).length === 5);

console.log('\n2. La hoja «Viajes» visible (las filas que suma la dinamica)');
const viajes = leer('Viajes');
viajes.forEach((f) => console.log('     ', f['ID viaje'], String(f['Unidad de negocio']).padEnd(20), f['Duracion horas'], '·', f['Costo']));
esperar('no entraron las filas padre', viajes.length === 5, viajes.length);
esperar('no esta el viaje entero de 8192', !viajes.some((f) => f['Unidad de negocio'] === 'SAE BROWN, RETIRO'));
const encViajes = (XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Viajes'], { header: 1 })[0] || []) as string[];
esperar('con el orden nuevo de columnas', JSON.stringify(encViajes) === JSON.stringify(COLUMNAS_CONTRATO), encViajes);
esperar('Partido antes que Localidad y Refrigerado al final',
    encViajes.indexOf('Partido') < encViajes.indexOf('Localidad') && encViajes[encViajes.length - 1] === 'Refrigerado');
esperar('el costo no se duplico',
    viajes.reduce((a, f) => a + (Number(f['Costo']) || 0), 0) === 224000 + 26000 + 180000 + 193333 + 96667,
    viajes.reduce((a, f) => a + (Number(f['Costo']) || 0), 0));

console.log('\n3. La hoja «Propios»: una fila por viaje, sin partes');
const propios = leer('Propios');
propios.forEach((f) => console.log('     ', f['ID viaje'], String(f['Unidad de negocio']).padEnd(20), f['Duracion horas']));
esperar('solo viajes propios', propios.every((f) => f['Contrato'] === 'Propio'));
esperar('dos viajes: el de dos unidades entero y el de una sola', propios.length === 2, propios.length);
esperar('el de dos unidades va entero, con sus horas totales',
    propios[0]['ID viaje'] === 8192 && propios[0]['Unidad de negocio'] === 'SAE BROWN, RETIRO' && propios[0]['Duracion horas'] === 3.26, propios[0]);
esperar('no hay filas de partes', !propios.some((f) => f['Unidad de negocio'] === 'SAE BROWN' || f['Unidad de negocio'] === 'RETIRO'));
esperar('la fecha quedo como fecha, no como numero', propios[0]['Fecha'] instanceof Date || typeof propios[0]['Fecha'] === 'number');

console.log('\n4. Las columnas');
const enc = (XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Propios'], { header: 1 })[0] || []) as string[];
console.log('    ', enc.join(' | '));
esperar('son exactamente las de COLUMNAS_CONTRATO', JSON.stringify(enc) === JSON.stringify(COLUMNAS_CONTRATO), enc);
esperar('Partido va antes que Localidad', enc.indexOf('Partido') < enc.indexOf('Localidad'));
esperar('Unidad de negocio va justo despues de Localidad', enc.indexOf('Unidad de negocio') === enc.indexOf('Localidad') + 1);
esperar('sin Region UN ni Categoria UN', !enc.includes('Region UN') && !enc.includes('Categoria UN'));
esperar('sin Fila ni Corte de horas', !enc.includes('Fila') && !enc.includes('Corte de horas'));
esperar('Refrigerado es la ultima', enc[enc.length - 1] === 'Refrigerado');
esperar('los datos van en su columna',
    propios[0]['Partido'] === 'ALMIRANTE BROWN' && propios[0]['Localidad'] === 'RAFAEL CALZADA' && propios[0]['Refrigerado'] === 'No', propios[0]);

console.log('\n5. La hoja «Tercerizados»');
const terc = leer('Tercerizados');
terc.forEach((f) => console.log('     ', f['ID viaje'], String(f['Unidad de negocio']).padEnd(20), f['Duracion horas']));
esperar('un solo viaje tercerizado, entero', terc.length === 1 && terc[0]['ID viaje'] === 9001 && terc[0]['Contrato'] === 'Tercerizado', terc);

console.log('\n5b. Sin el +/- de Excel');
const zip = unzipSync(new Uint8Array(buffer));
const dec = new TextDecoder();
const sheet4 = dec.decode(zip['xl/worksheets/sheet4.xml']);
esperar('ninguna fila agrupada', !/outlineLevel/.test(sheet4));
esperar('sin configuracion de esquema', !sheet4.includes('outlinePr'));
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
const cacheXml = dec.decode(zip['xl/pivotCache/pivotCacheDefinition1.xml']);
esperar('la dinamica lee de la base oculta', cacheXml.includes('sheet="Base dinámica"') && !cacheXml.includes('sheet="Viajes"'),
    (cacheXml.match(/<worksheetSource [^>]*>/) || [])[0]);
esperar('el filtro guardado apunta a la base oculta (hoja 1)',
    wbXml.includes(`localSheetId="1" hidden="1">'Base dinámica'!`) && !wbXml.includes(`'Viajes'!`));
esperar('la «Viajes» visible tiene su relacion y su tipo',
    wbXml.includes('r:id="rId9"') && relsXml.includes('worksheets/sheet6.xml') && tiposXml.includes('/xl/worksheets/sheet6.xml'));
esperar('el texto del Resumen explica de donde sale', dec.decode(zip['xl/worksheets/sheet1.xml']).includes('Base din&#225;mica')
    || dec.decode(zip['xl/worksheets/sheet1.xml']).includes('Base dinámica'));
esperar('la dinamica apunta a las filas que hay', cacheXml.includes('ref="A1:AF6"'),
    (dec.decode(zip['xl/pivotCache/pivotCacheDefinition1.xml']).match(/worksheetSource ref="[^"]*"/) || [])[0]);

// Que no haya quedado una hoja repetida si se arma dos veces
const otra = armarLibroViajes(filas, 'PRUEBA', []);
const wb2 = XLSX.read(otra, { type: 'buffer' });
esperar('armarlo dos veces no duplica las hojas', wb2.SheetNames.length === 6, wb2.SheetNames);

fs.unlinkSync(SALIDA);
console.log('\n' + (todo ? 'TODO BIEN' : '*** HAY FALLAS ***'));
process.exit(todo ? 0 : 1);
