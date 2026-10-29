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
// Las dos hojas por tipo de contrato se crean de cero: la plantilla no las
// trae. Van al FINAL de la lista de hojas para no correr los indices, que es
// por donde la dinamica y el filtro guardado referencian a «Viajes».
const HOJAS_POR_CONTRATO = [
    { archivo: 'xl/worksheets/sheet4.xml', nombre: 'Propios', contrato: 'propio', sheetId: 4, rel: 'rId7' },
    { archivo: 'xl/worksheets/sheet5.xml', nombre: 'Tercerizados', contrato: 'tercerizado', sheetId: 5, rel: 'rId8' },
];
const CACHE_DINAMICA = 'xl/pivotCache/pivotCacheDefinition1.xml';

// AG y no AF: entro "Horas por ruta" al final. Va al final y nunca en el medio
// porque la tabla dinamica de la plantilla referencia los campos por numero de
// posicion, y correrlos desalinea el informe entero.
// La hoja llega hasta AG porque se agrego "Horas por ruta" al final. La tabla
// dinamica, en cambio, sigue mirando hasta AF: su cache tiene definidos
// exactamente esos 32 campos, y meterle una columna que no conoce hace que
// Excel se queje al abrir el archivo. La columna nueva existe para leerla, no
// para cruzarla en la dinamica.
const ULTIMA_COLUMNA = 'AG';
const ULTIMA_COLUMNA_DINAMICA = 'AF';
const ULTIMA_COLUMNA_CONTEO = 'N';

/** Las columnas de la hoja "Viajes", en orden. Coinciden con la plantilla. */
export const COLUMNAS_LIBRO = [
    'ID viaje', 'Fecha', 'Mes', 'Reparto', 'Localidad', 'Partido', 'Subzona', 'Region UN', 'Categoria UN',
    'Unidad de negocio',
    'Contrato', 'Proveedor', 'Chofer', 'Auxiliar 1', 'Auxiliar 2', 'Auxiliar 3',
    'Patente', 'Tipo de vehiculo', 'Vuelta', 'Refrigerado', 'Temperatura', 'Estado',
    'Salida deposito', 'Llegada deposito', 'Duracion horas', 'Paradas planificadas',
    'Paradas entregadas', 'Paradas no entregadas', 'Km recorridos', 'Costo',
    'Estado de pago', 'Fecha de pago',
    'Horas por ruta'
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

function filaXml(nro: number, celdas: Celda[], nivel = 0): string {
    // `outlineLevel` es lo que le pone a la fila el +/- de Excel.
    const sangria = nivel > 0 ? ` outlineLevel="${nivel}"` : '';
    return `<row r="${nro}"${sangria}>${celdas.map((c, i) => celdaXml(nro, i + 1, c)).join('')}</row>`;
}

/** Las columnas de las hojas por contrato: las mismas de «Viajes» con una
 *  adelante que dice si la fila es el viaje o una de sus partes. Sin eso, al
 *  copiar las filas a otro lado no hay forma de distinguirlas. */
const COLUMNAS_CONTRATO = ['Fila', ...COLUMNAS_LIBRO];

/**
 * Una hoja con los viajes de un tipo de contrato: la fila del viaje entero y,
 * colgando de ella, sus partes por unidad de negocio.
 *
 * `summaryBelow="0"` es lo que hace que el +/- quede en la fila de ARRIBA (el
 * viaje). Con el valor por omision Excel lo pone en la de abajo, que seria el
 * viaje siguiente.
 */
function armarHojaDeContrato(filas: any[], estilos: Record<number, number>, estiloComun: number, estiloTitulo: number): string {
    const ultima = letra(COLUMNAS_CONTRATO.length);
    const rango = `A1:${ultima}${Math.max(filas.length + 1, 2)}`;

    const encabezado = filaXml(1, COLUMNAS_CONTRATO.map((n) => ({ valor: n, estilo: estiloTitulo })));
    const cuerpo = filas.map((f, i) => {
        const esHijo = f._tipo === 'hijo';
        const celdas: Celda[] = [{ valor: esHijo ? 'parte' : 'VIAJE', estilo: estiloComun }];
        COLUMNAS_LIBRO.forEach((nombre, c) => celdas.push({ valor: f[nombre], estilo: estilos[c + 1] ?? estiloComun }));
        return filaXml(i + 2, celdas, esHijo ? 1 : 0);
    });

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>'
        + `<dimension ref="${rango}"/>`
        + '<sheetViews><sheetView workbookViewId="0">'
        + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="15" outlineLevelRow="1"/>'
        + `<sheetData>${encabezado}${cuerpo.join('')}</sheetData>`
        + `<autoFilter ref="${rango}"/>`
        + '</worksheet>';
}

/** Deja las hojas nuevas anotadas donde Excel las busca: la lista de hojas del
 *  libro, sus relaciones y los tipos de contenido del zip. */
function registrarHojas(zip: Record<string, Uint8Array>, dec: TextDecoder, enc: TextEncoder): void {
    let wb = dec.decode(zip['xl/workbook.xml']);
    let rels = dec.decode(zip['xl/_rels/workbook.xml.rels']);
    let tipos = dec.decode(zip['[Content_Types].xml']);
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    for (const h of HOJAS_POR_CONTRATO) {
        if (!wb.includes(`name="${h.nombre}"`)) {
            wb = wb.replace('</sheets>',
                `<sheet xmlns:r="${R}" name="${h.nombre}" sheetId="${h.sheetId}" state="visible" r:id="${h.rel}"/></sheets>`);
        }
        if (!rels.includes(`Id="${h.rel}"`)) {
            rels = rels.replace('</Relationships>',
                `<Relationship Type="${R}/worksheet" Target="/${h.archivo}" Id="${h.rel}"/></Relationships>`);
        }
        if (!tipos.includes(`/${h.archivo}`)) {
            tipos = tipos.replace('</Types>',
                `<Override PartName="/${h.archivo}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
        }
    }
    zip['xl/workbook.xml'] = enc.encode(wb);
    zip['xl/_rels/workbook.xml.rels'] = enc.encode(rels);
    zip['[Content_Types].xml'] = enc.encode(tipos);
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

    // La dinamica suma esta hoja: las filas padre harian contar todo dos veces.
    const soloPartes = filas.filter((f: any) => f._tipo !== 'padre');
    const cuerpo = soloPartes.map((f, i) => filaXml(i + 2, COLUMNAS_LIBRO.map((nombre, c) => ({
        valor: f[nombre], estilo: estilos[c + 1] ?? estiloComun
    }))));

    const ultimaFila = Math.max(soloPartes.length + 1, 2);
    const rango = `A1:${ULTIMA_COLUMNA}${ultimaFila}`;
    const rangoDinamica = `A1:${ULTIMA_COLUMNA_DINAMICA}${ultimaFila}`;

    // El encabezado sale tal cual de la plantilla, asi que las columnas nuevas
    // hay que escribirlas: agregar el nombre a COLUMNAS_LIBRO llena los datos
    // pero deja la fila 1 sin titulo.
    let filaEncabezado = encabezado[0];
    COLUMNAS_LIBRO.forEach((nombre, i) => {
        const ref = `${letra(i + 1)}1`;
        if (filaEncabezado.includes(`r="${ref}"`)) return;
        const celda = `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapar(nombre)}</t></is></c>`;
        filaEncabezado = filaEncabezado.replace('</row>', `${celda}</row>`);
    });

    hoja = hoja.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${filaEncabezado}${cuerpo.join('')}</sheetData>`);
    hoja = hoja.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${rango}"/>`);
    hoja = hoja.replace(/<autoFilter ref="[^"]*"\/>/, `<autoFilter ref="${rango}"/>`);
    zip[HOJA_DATOS] = enc.encode(hoja);

    // ── La dinamica mira exactamente las filas que hay ──────────────────────
    let cache = dec.decode(zip[CACHE_DINAMICA]);
    cache = cache.replace(/<worksheetSource ref="[^"]*"/, `<worksheetSource ref="${rangoDinamica}"`);
    if (!/refreshOnLoad="1"/.test(cache)) {
        cache = cache.replace('<pivotCacheDefinition ', '<pivotCacheDefinition refreshOnLoad="1" ');
    }
    zip[CACHE_DINAMICA] = enc.encode(cache);

    // ── Hoja "Conteo por UN" ───────────────────────────────────────────────
    if (zip[HOJA_CONTEO]) {
        zip[HOJA_CONTEO] = enc.encode(armarHojaConteo(dec.decode(zip[HOJA_CONTEO]), analisis || []));
    }

    // ── Hojas "Propios" y "Tercerizados" ───────────────────────────────────
    // El viaje entero, como se ve en planificacion, con sus partes colgando.
    const estiloTitulo = estilosDeLaFila(hoja, 1)[1] ?? estiloComun;
    for (const h of HOJAS_POR_CONTRATO) {
        const suyas = filas.filter((f: any) =>
            String(f['Contrato'] || '').trim().toLowerCase() === h.contrato);
        zip[h.archivo] = enc.encode(armarHojaDeContrato(suyas, estilos, estiloComun, estiloTitulo));
    }
    registrarHojas(zip as any, dec, enc);

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
