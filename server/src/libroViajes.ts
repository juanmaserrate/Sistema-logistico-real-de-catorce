/**
 * Arma el Excel de viajes CON la tabla dinamica adentro.
 *
 * El servidor no tiene Excel, y ninguna libreria de Node sabe crear una tabla
 * dinamica desde cero. Lo que si se puede es partir de una plantilla que ya la
 * tiene hecha (templates/plantilla_viajes.xlsx, creada una vez con Excel) y
 * reemplazarle las hojas de datos. La dinamica apunta a la hoja "Viajes" y se
 * actualiza sola al abrir el archivo, porque la cache quedo marcada como
 * "refrescar al abrir".
 *
 * Por eso se toca el zip a mano en vez de usar SheetJS: SheetJS reescribe el
 * archivo entero y se lleva puesta la dinamica.
 *
 * Los formatos (fecha, plata, titulo de bloque, fila de total...) no se crean
 * aca: ya existen en la plantilla, en sus filas de ejemplo. De ahi se leen los
 * numeros de estilo, asi que se puede rehacer la plantilla sin tener que venir
 * a corregir numeros a mano.
 */
import fs from 'fs';
import path from 'path';
import { unzipSync, zipSync } from 'fflate';

const HOJA_RESUMEN = 'xl/worksheets/sheet1.xml';
const HOJA_DATOS = 'xl/worksheets/sheet2.xml';
const HOJA_CONTEO = 'xl/worksheets/sheet3.xml';
const CACHE_DINAMICA = 'xl/pivotCache/pivotCacheDefinition1.xml';

const ULTIMA_COLUMNA = 'AF';
const ULTIMA_COLUMNA_CONTEO = 'N';

/** Las columnas de la hoja "Viajes", en orden. Coinciden con la plantilla. */
export const COLUMNAS_LIBRO = [
    'ID viaje', 'Fecha', 'Mes', 'Reparto', 'Localidad', 'Partido', 'Subzona', 'Region UN', 'Categoria UN',
    'Unidad de negocio',
    'Contrato', 'Proveedor', 'Chofer', 'Auxiliar 1', 'Auxiliar 2', 'Auxiliar 3',
    'Patente', 'Tipo de vehiculo', 'Vuelta', 'Refrigerado', 'Temperatura', 'Estado',
    'Salida deposito', 'Llegada deposito', 'Duracion horas', 'Paradas planificadas',
    'Paradas entregadas', 'Paradas no entregadas', 'Km recorridos', 'Costo',
    'Estado de pago', 'Fecha de pago'
];

const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

/** Fila del conteo, tal como la manda la web con lo que tiene en pantalla. */
export type FilaConteo = { contrato: string; region: string; categoria: string; meses: number[]; total: number };

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

function columnaDeRef(ref: string): number {
    let n = 0;
    for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
    return n;
}

/** Numero de serie de Excel. El dia 0 es el 30/12/1899. */
function serieExcel(f: Date): number {
    return Math.floor((Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Estilos de una fila de ejemplo de la plantilla: columna -> numero de estilo. */
function estilosDeLaFila(hoja: string, fila: number): Record<number, number> {
    const bloque = hoja.match(new RegExp(`<row r="${fila}"[^>]*>([\\s\\S]*?)</row>`));
    const out: Record<number, number> = {};
    if (!bloque) return out;
    for (const m of bloque[1].matchAll(/<c r="([A-Z]+\d+)"[^>]*?s="(\d+)"/g)) {
        out[columnaDeRef(m[1])] = Number(m[2]);
    }
    return out;
}

type Celda = { valor: any; estilo: number };

function celdaXml(fila: number, columna: number, c: Celda): string {
    const ref = `${letra(columna)}${fila}`;
    const { valor, estilo } = c;
    // Celda vacia pero con formato: hace falta para que el bloque se vea parejo
    if (valor === null || valor === undefined || valor === '') return `<c r="${ref}" s="${estilo}"/>`;
    if (valor instanceof Date) return `<c r="${ref}" s="${estilo}"><v>${serieExcel(valor)}</v></c>`;
    if (typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`;
    return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escapar(String(valor))}</t></is></c>`;
}

function filaXml(nro: number, celdas: Celda[]): string {
    return `<row r="${nro}">${celdas.map((c, i) => celdaXml(nro, i + 1, c)).join('')}</row>`;
}

/**
 * La hoja "Conteo por UN", con el mismo formato de bloques que la pantalla:
 * un recuadro por region con su titulo, el encabezado de meses, las categorias
 * y la fila de total.
 */
function armarHojaConteo(hoja: string, analisis: FilaConteo[]): string {
    const e1 = estilosDeLaFila(hoja, 1);   // titulo del bloque
    const e2 = estilosDeLaFila(hoja, 2);   // encabezado de columnas
    const e3 = estilosDeLaFila(hoja, 3);   // una categoria
    const e4 = estilosDeLaFila(hoja, 4);   // fila TOTAL

    const S = {
        titulo: e1[1] ?? 0, relleno: e1[2] ?? 0, cuenta: e1[14] ?? 0,
        encA: e2[1] ?? 0, encMes: e2[2] ?? 0,
        categoria: e3[1] ?? 0, mes: e3[2] ?? 0, totalFila: e3[14] ?? 0,
        totalEtiqueta: e4[1] ?? 0, totalNumero: e4[2] ?? 0
    };

    // Un bloque por combinacion region + contrato, en el orden en que vinieron
    const bloques: { clave: string; filas: FilaConteo[] }[] = [];
    for (const f of analisis) {
        const clave = `${f.region} ${f.contrato}`.toUpperCase();
        let b = bloques.find((x) => x.clave === clave);
        if (!b) { b = { clave, filas: [] }; bloques.push(b); }
        b.filas.push(f);
    }

    const filasXml: string[] = [];
    let nro = 1;

    // Sin analisis la hoja quedaba en blanco y no se entendia por que. Mejor
    // decirlo: casi siempre es una pestania abierta con la version vieja.
    if (!bloques.length) {
        filasXml.push(filaXml(1, [{ valor: 'Sin datos del conteo', estilo: S.titulo }]));
        filasXml.push(filaXml(2, [{
            valor: 'El navegador no mandó el análisis. Recargá la página con Ctrl+F5 y volvé a exportar.',
            estilo: S.categoria
        }]));
    }

    for (const bloque of bloques) {
        const porMes = Array.from({ length: 12 }, (_, m) =>
            bloque.filas.reduce((a, f) => a + (Number(f.meses?.[m]) || 0), 0));
        const total = bloque.filas.reduce((a, f) => a + (Number(f.total) || 0), 0);

        filasXml.push(filaXml(nro++, [
            { valor: bloque.clave, estilo: S.titulo },
            ...Array.from({ length: 12 }, () => ({ valor: '', estilo: S.relleno })),
            { valor: `${total} viajes`, estilo: S.cuenta }
        ]));
        filasXml.push(filaXml(nro++, [
            { valor: 'CATEGORIA', estilo: S.encA },
            ...MESES_CORTOS.map((m) => ({ valor: m, estilo: S.encMes })),
            { valor: 'TOTAL', estilo: S.encMes }
        ]));
        for (const f of bloque.filas) {
            filasXml.push(filaXml(nro++, [
                { valor: f.categoria, estilo: S.categoria },
                ...Array.from({ length: 12 }, (_, m) => ({ valor: Number(f.meses?.[m]) || '', estilo: S.mes })),
                { valor: Number(f.total) || 0, estilo: S.totalFila }
            ]));
        }
        filasXml.push(filaXml(nro++, [
            { valor: 'TOTAL', estilo: S.totalEtiqueta },
            ...porMes.map((v) => ({ valor: v || '', estilo: S.totalNumero })),
            { valor: total, estilo: S.totalNumero }
        ]));
        nro++;   // renglon en blanco entre bloques
    }

    const ultima = Math.max(nro - 1, 1);
    let out = hoja.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${filasXml.join('')}</sheetData>`);
    out = out.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${ULTIMA_COLUMNA_CONTEO}${ultima}"/>`);
    // Sin filtro: cada bloque trae su propio encabezado
    out = out.replace(/<autoFilter ref="[^"]*"\/>/, '');
    return out;
}

/** Devuelve el .xlsx listo. `filas` usa las claves de COLUMNAS_LIBRO. */
export function armarLibroViajes(filas: any[], titulo?: string, analisis?: FilaConteo[]): Buffer {
    const rutaPlantilla = path.join(__dirname, '..', 'templates', 'plantilla_viajes.xlsx');
    const zip = unzipSync(new Uint8Array(fs.readFileSync(rutaPlantilla)));
    const dec = new TextDecoder();
    const enc = new TextEncoder();

    // ── Hoja "Viajes" ──────────────────────────────────────────────────────
    let hoja = dec.decode(zip[HOJA_DATOS]);
    const encabezado = hoja.match(/<row r="1"[\s\S]*?<\/row>/);
    if (!encabezado) throw new Error('La plantilla no tiene la fila de encabezados');

    // Los formatos salen de la fila de ejemplo: fecha, plata, decimales...
    const estilos = estilosDeLaFila(hoja, 2);
    const estiloComun = estilos[3] ?? 0;

    const cuerpo = filas.map((f, i) => filaXml(i + 2, COLUMNAS_LIBRO.map((nombre, c) => ({
        valor: f[nombre], estilo: estilos[c + 1] ?? estiloComun
    }))));

    const ultimaFila = Math.max(filas.length + 1, 2);
    const rango = `A1:${ULTIMA_COLUMNA}${ultimaFila}`;
    hoja = hoja.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${encabezado[0]}${cuerpo.join('')}</sheetData>`);
    hoja = hoja.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${rango}"/>`);
    hoja = hoja.replace(/<autoFilter ref="[^"]*"\/>/, `<autoFilter ref="${rango}"/>`);
    zip[HOJA_DATOS] = enc.encode(hoja);

    // ── La dinamica mira exactamente las filas que hay ──────────────────────
    let cache = dec.decode(zip[CACHE_DINAMICA]);
    cache = cache.replace(/<worksheetSource ref="[^"]*"/, `<worksheetSource ref="${rango}"`);
    if (!/refreshOnLoad="1"/.test(cache)) {
        cache = cache.replace('<pivotCacheDefinition ', '<pivotCacheDefinition refreshOnLoad="1" ');
    }
    zip[CACHE_DINAMICA] = enc.encode(cache);

    // ── Hoja "Conteo por UN" ───────────────────────────────────────────────
    if (zip[HOJA_CONTEO]) {
        zip[HOJA_CONTEO] = enc.encode(armarHojaConteo(dec.decode(zip[HOJA_CONTEO]), analisis || []));
    }

    // ── Titulo del resumen ─────────────────────────────────────────────────
    if (titulo && zip[HOJA_RESUMEN]) {
        let resumen = dec.decode(zip[HOJA_RESUMEN]);
        resumen = resumen.replace(
            /<c r="A1"([^>]*)t="s"([^>]*)><v>\d+<\/v><\/c>/,
            `<c r="A1"$1t="inlineStr"$2><is><t>${escapar(titulo)}</t></is></c>`
        );
        zip[HOJA_RESUMEN] = enc.encode(resumen);
    }

    return Buffer.from(zipSync(zip, { level: 6 }));
}
