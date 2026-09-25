/**
 * Arma el Excel de viajes CON la tabla dinamica adentro.
 *
 * El servidor no tiene Excel, y ninguna libreria de Node sabe crear una tabla
 * dinamica desde cero. Lo que si se puede es partir de una plantilla que ya la
 * tiene hecha (templates/plantilla_viajes.xlsx, creada una vez con Excel) y
 * reemplazarle SOLO la hoja de datos. La dinamica apunta a esa hoja y se
 * actualiza sola al abrir el archivo, porque la cache quedo marcada como
 * "refrescar al abrir".
 *
 * Por eso se toca el zip a mano en vez de usar SheetJS: SheetJS reescribe el
 * archivo entero y se lleva puesta la dinamica.
 */
import fs from 'fs';
import path from 'path';
import { unzipSync, zipSync } from 'fflate';

/** La hoja de datos dentro del zip de la plantilla. */
const HOJA_DATOS = 'xl/worksheets/sheet2.xml';
const CACHE_DINAMICA = 'xl/pivotCache/pivotCacheDefinition1.xml';
const ULTIMA_COLUMNA = 'AD';

/** Estilos que ya existen en la plantilla (salen de su fila de ejemplo). */
const ESTILO_NORMAL = 2;
const ESTILO_FECHA = 3;
const ESTILO_DOS_DECIMALES = 4;
const ESTILO_UN_DECIMAL = 5;
const ESTILO_PLATA = 6;

/** Columna (1-based) -> estilo, para las que no van con el normal.
 *  Ojo: si se agrega o saca una columna, estos numeros se corren. */
const ESTILO_POR_COLUMNA: Record<number, number> = {
    2: ESTILO_FECHA,            // Fecha
    23: ESTILO_DOS_DECIMALES,   // Duracion horas
    27: ESTILO_UN_DECIMAL,      // Km recorridos
    28: ESTILO_PLATA,           // Costo
    30: ESTILO_FECHA            // Fecha de pago
};

/** Las columnas de la hoja, en orden. Tienen que coincidir con la plantilla. */
export const COLUMNAS_LIBRO = [
    'ID viaje', 'Fecha', 'Mes', 'Reparto', 'Zona', 'Subzona', 'Localidad', 'Unidad de negocio',
    'Contrato', 'Proveedor', 'Chofer', 'Auxiliar 1', 'Auxiliar 2', 'Auxiliar 3',
    'Patente', 'Tipo de vehiculo', 'Vuelta', 'Refrigerado', 'Temperatura', 'Estado',
    'Salida deposito', 'Llegada deposito', 'Duracion horas', 'Paradas planificadas',
    'Paradas entregadas', 'Paradas no entregadas', 'Km recorridos', 'Costo',
    'Estado de pago', 'Fecha de pago'
];

function escapar(v: string): string {
    return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Letra de columna: 1 -> A, 27 -> AA. */
function letra(n: number): string {
    let s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

/** Numero de serie de Excel. El dia 0 es el 30/12/1899. */
function serieExcel(f: Date): number {
    const dias = Math.floor((Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000);
    return dias;
}

function celda(fila: number, columna: number, valor: any): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const ref = `${letra(columna)}${fila}`;
    const estilo = ESTILO_POR_COLUMNA[columna] ?? ESTILO_NORMAL;
    if (valor instanceof Date) {
        return `<c r="${ref}" s="${estilo}"><v>${serieExcel(valor)}</v></c>`;
    }
    if (typeof valor === 'number' && Number.isFinite(valor)) {
        return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`;
    }
    return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escapar(String(valor))}</t></is></c>`;
}

/**
 * Devuelve el .xlsx listo. `filas` son objetos con las claves de COLUMNAS_LIBRO.
 */
export function armarLibroViajes(filas: any[], titulo?: string): Buffer {
    const rutaPlantilla = path.join(__dirname, '..', 'templates', 'plantilla_viajes.xlsx');
    const zip = unzipSync(new Uint8Array(fs.readFileSync(rutaPlantilla)));

    const dec = new TextDecoder();
    const enc = new TextEncoder();
    let hoja = dec.decode(zip[HOJA_DATOS]);

    // La fila 1 (encabezados) se conserva tal cual: usa los textos compartidos
    // de la plantilla y ya viene con el formato puesto.
    const encabezado = hoja.match(/<row r="1"[\s\S]*?<\/row>/);
    if (!encabezado) throw new Error('La plantilla no tiene la fila de encabezados');

    const cuerpo: string[] = [];
    filas.forEach((f, i) => {
        const nro = i + 2;
        const celdas = COLUMNAS_LIBRO.map((nombre, c) => celda(nro, c + 1, f[nombre])).join('');
        cuerpo.push(`<row r="${nro}">${celdas}</row>`);
    });

    const ultimaFila = Math.max(filas.length + 1, 2);
    const rango = `A1:${ULTIMA_COLUMNA}${ultimaFila}`;

    hoja = hoja.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${encabezado[0]}${cuerpo.join('')}</sheetData>`);
    hoja = hoja.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${rango}"/>`);
    hoja = hoja.replace(/<autoFilter ref="[^"]*"\/>/, `<autoFilter ref="${rango}"/>`);
    zip[HOJA_DATOS] = enc.encode(hoja);

    // La dinamica tiene que mirar exactamente las filas que hay: si sobra rango,
    // Excel muestra una fila "(en blanco)".
    let cache = dec.decode(zip[CACHE_DINAMICA]);
    cache = cache.replace(/<worksheetSource ref="[^"]*"/, `<worksheetSource ref="${rango}"`);
    if (!/refreshOnLoad="1"/.test(cache)) {
        cache = cache.replace('<pivotCacheDefinition ', '<pivotCacheDefinition refreshOnLoad="1" ');
    }
    zip[CACHE_DINAMICA] = enc.encode(cache);

    if (titulo) {
        const HOJA_RESUMEN = 'xl/worksheets/sheet1.xml';
        let resumen = dec.decode(zip[HOJA_RESUMEN]);
        // El titulo esta en A1 como texto compartido; se reemplaza por uno propio
        resumen = resumen.replace(
            /<c r="A1"([^>]*)t="s"([^>]*)><v>\d+<\/v><\/c>/,
            `<c r="A1"$1t="inlineStr"$2><is><t>${escapar(titulo)}</t></is></c>`
        );
        zip[HOJA_RESUMEN] = enc.encode(resumen);
    }

    return Buffer.from(zipSync(zip, { level: 6 }));
}
