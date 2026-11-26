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

// La dinamica lee sus columnas por NUMERO de posicion, asi que la hoja de la
// plantilla (sheet2) queda con el formato de siempre, renombrada y oculta. La
// «Viajes» que ve el operador es una hoja nueva con el orden de columnas que
// pidio (nov 2026). Va justo despues de la oculta: asi la pestania queda en el
// mismo lugar de siempre y el filtro guardado (localSheetId="1") sigue
// apuntando a la hoja 1, que es la oculta.
const HOJA_BASE_NOMBRE = 'Base dinámica';
const HOJA_VIAJES_VISIBLE = { archivo: 'xl/worksheets/sheet6.xml', nombre: 'Viajes', sheetId: 6, rel: 'rId9' };
// Horas promedio por unidad de negocio, propios y tercerizados (nov 2026).
const HOJA_HORAS = { archivo: 'xl/worksheets/sheet7.xml', nombre: 'Horas promedio', sheetId: 7, rel: 'rId10' };
// Horas trabajadas de cada chofer propio y cada auxiliar (nov 2026).
const HOJA_PERSONAS = { archivo: 'xl/worksheets/sheet8.xml', nombre: 'Horas por persona', sheetId: 8, rel: 'rId11' };

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

/** Las columnas de las hojas por contrato, en el orden que pidio el operador
 *  (nov 2026): Partido antes que Localidad, la unidad de negocio pegada a
 *  ellas, sin Region UN ni Categoria UN (son del conteo, no del viaje) y
 *  Refrigerado al final. Es solo el orden de ESTAS hojas: «Viajes» sigue con
 *  COLUMNAS_LIBRO porque la dinamica la lee por numero de columna. */
export const COLUMNAS_CONTRATO = [
    'ID viaje', 'Fecha', 'Mes', 'Reparto', 'Partido', 'Localidad', 'Unidad de negocio', 'Subzona',
    'Contrato', 'Proveedor', 'Chofer', 'Auxiliar 1', 'Auxiliar 2', 'Auxiliar 3',
    'Patente', 'Tipo de vehiculo', 'Vuelta', 'Temperatura', 'Estado',
    'Salida deposito', 'Llegada deposito', 'Duracion horas', 'Paradas planificadas',
    'Paradas entregadas', 'Paradas no entregadas', 'Km recorridos', 'Costo',
    'Estado de pago', 'Fecha de pago', 'Horas por ruta',
    'Refrigerado'
];

/**
 * Una hoja con los viajes de un tipo de contrato: UNA fila por viaje, el viaje
 * entero como se ve en planificacion. Antes colgaban debajo sus partes por
 * unidad de negocio con el +/- de Excel; se saco a pedido (nov 2026). Las
 * partes siguen en «Viajes», que es donde las suma la dinamica.
 *
 * El formato de cada columna sale de la fila de ejemplo de «Viajes» buscando
 * la columna por NOMBRE: aca el orden es otro.
 */
function armarHojaDeContrato(filas: any[], estilos: Record<number, number>, estiloComun: number, estiloTitulo: number): string {
    return armarHojaPlana(filas.filter((f: any) => f._tipo !== 'hijo'), estilos, estiloComun, estiloTitulo);
}

/** Una fila por cada elemento de `viajes`, con las columnas de COLUMNAS_CONTRATO. */
function armarHojaPlana(viajes: any[], estilos: Record<number, number>, estiloComun: number, estiloTitulo: number): string {
    const ultima = letra(COLUMNAS_CONTRATO.length);
    const rango = `A1:${ultima}${Math.max(viajes.length + 1, 2)}`;
    const estiloDe = (nombre: string) => estilos[COLUMNAS_LIBRO.indexOf(nombre) + 1] ?? estiloComun;

    const encabezado = filaXml(1, COLUMNAS_CONTRATO.map((n) => ({ valor: n, estilo: estiloTitulo })));
    const cuerpo = viajes.map((f, i) =>
        filaXml(i + 2, COLUMNAS_CONTRATO.map((nombre) => ({ valor: f[nombre], estilo: estiloDe(nombre) }))));

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<dimension ref="${rango}"/>`
        + '<sheetViews><sheetView workbookViewId="0">'
        + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="15"/>'
        + `<sheetData>${encabezado}${cuerpo.join('')}</sheetData>`
        + `<autoFilter ref="${rango}"/>`
        + '</worksheet>';
}

const COLUMNAS_HORAS = [
    'Mes', 'Unidad de negocio',
    'Viajes propios', 'Horas propios', 'Promedio propios (h)',
    'Viajes tercerizados', 'Horas tercerizados', 'Promedio tercerizados (h)',
    'Viajes total', 'Horas total', 'Promedio total (h)'
];

/** La hoja "Horas promedio": cuanto dura en promedio un viaje de cada unidad
 *  de negocio, con los propios y los tercerizados por separado.
 *
 *  Es la cuenta de la tabla de horas por negocio que se armaba a mano (la de
 *  septiembre de 2026 da igual): cada fila de la hoja Viajes es un viaje de
 *  esa unidad, y un viaje que reparte para dos cuenta en las dos con SUS
 *  horas. Solo entran las filas con horario: un viaje sin cerrar no tiene
 *  duracion y bajaria el promedio. La REPOSICION a secas va por partido
 *  (REPOSICION · ALMIRANTE BROWN, · LANUS...), igual que en esa tabla; las
 *  que tienen unidad propia (REPOSICION SAE BROWN...) van con su nombre. */
function armarHojaHoras(filas: any[], estiloEntero: number, estiloDecimal: number, estiloComun: number, estiloTitulo: number): string {
    type Acum = { viajes: number; horas: number };
    type Linea = { propio: Acum; terc: Acum; total: Acum };
    const nueva = (): Linea => ({ propio: { viajes: 0, horas: 0 }, terc: { viajes: 0, horas: 0 }, total: { viajes: 0, horas: 0 } });
    const meses = new Map<string, { orden: number; unidades: Map<string, Linea>; total: Linea }>();

    for (const f of filas) {
        const horas = Number(f['Duracion horas']);
        if (!(horas > 0)) continue;
        const mes = String(f['Mes'] || '') || 'SIN FECHA';
        const fecha = f['Fecha'] ? new Date(f['Fecha']).getTime() : 0;
        if (!meses.has(mes)) meses.set(mes, { orden: fecha, unidades: new Map(), total: nueva() });
        const m = meses.get(mes)!;
        if (fecha && fecha < m.orden) m.orden = fecha;

        let unidad = String(f['Unidad de negocio'] || '').trim().toUpperCase() || 'SIN UNIDAD';
        const partido = String(f['Partido'] || '').trim().toUpperCase();
        // Las nuevas ("REPOSICION SAE BROWN"...) ya dicen de quien son: van con su nombre
        if (unidad === 'REPOSICION' && partido) unidad = `REPOSICION · ${partido}`;
        if (!m.unidades.has(unidad)) m.unidades.set(unidad, nueva());
        const linea = m.unidades.get(unidad)!;

        const contrato = String(f['Contrato'] || '').trim().toLowerCase();
        const lado = contrato === 'propio' ? 'propio' : contrato === 'tercerizado' ? 'terc' : null;
        for (const l of [linea, m.total]) {
            if (lado) { l[lado].viajes++; l[lado].horas += horas; }
            l.total.viajes++; l.total.horas += horas;
        }
    }

    const dos = (n: number) => Math.round(n * 100) / 100;
    const celdas = (mes: string, unidad: string, l: Linea, estiloTexto: number) => {
        const c: { valor: any; estilo: number }[] = [{ valor: mes, estilo: estiloTexto }, { valor: unidad, estilo: estiloTexto }];
        for (const a of [l.propio, l.terc, l.total]) {
            c.push({ valor: a.viajes || '', estilo: estiloEntero });
            c.push({ valor: a.viajes ? dos(a.horas) : '', estilo: estiloDecimal });
            c.push({ valor: a.viajes ? dos(a.horas / a.viajes) : '', estilo: estiloDecimal });
        }
        return c;
    };

    const filasXml: string[] = [filaXml(1, COLUMNAS_HORAS.map((n) => ({ valor: n, estilo: estiloTitulo })))];
    let nro = 2;
    const ordenados = [...meses.entries()].sort((a, b) => a[1].orden - b[1].orden);
    for (const [mes, m] of ordenados) {
        const unidades = [...m.unidades.entries()].sort((a, b) => b[1].total.viajes - a[1].total.viajes || a[0].localeCompare(b[0]));
        for (const [u, l] of unidades) filasXml.push(filaXml(nro++, celdas(mes, u, l, estiloComun)));
        filasXml.push(filaXml(nro++, celdas(mes, 'TOTAL', m.total, estiloTitulo)));
    }

    const ultima = letra(COLUMNAS_HORAS.length);
    const rango = `A1:${ultima}${Math.max(nro - 1, 2)}`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<dimension ref="${rango}"/>`
        + '<sheetViews><sheetView workbookViewId="0">'
        + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="15"/>'
        + '<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="34" customWidth="1"/>'
        + `<col min="3" max="${COLUMNAS_HORAS.length}" width="15" customWidth="1"/></cols>`
        + `<sheetData>${filasXml.join('')}</sheetData>`
        + `<autoFilter ref="${rango}"/>`
        + '</worksheet>';
}

const COLUMNAS_PERSONAS = [
    'Mes', 'Puesto', 'Persona', 'Viajes', 'Horas en viajes propios', 'Horas en viajes tercerizados', 'Total horas'
];
const NO_ES_PERSONA = new Set(['', '-', '--', 'N/A', 'NA', 'S/A', 'S/D', 'SIN AUXILIAR', 'SIN CHOFER', 'SIN ASIGNAR', 'NINGUNO']);

/** La hoja "Horas por persona": las horas que trabajo cada chofer propio y
 *  cada auxiliar en el mes.
 *
 *  Cada persona suma la duracion ENTERA de cada viaje en que fue: un viaje de
 *  7 h con 3 auxiliares son 7 h para cada uno (21 h de auxiliares). Los
 *  choferes suman solo sus viajes propios; los auxiliares, los propios y los
 *  tercerizados por separado (son de la empresa y tambien van en camiones de
 *  terceros). Sale de una fila por viaje, no de las partes por unidad: si no,
 *  un viaje de dos unidades contaria dos veces. Los viajes sin salida o
 *  llegada no tienen duracion y no suman; se dice cuantos son. */
function armarHojaPersonas(viajes: any[], estiloEntero: number, estiloDecimal: number, estiloComun: number, estiloTitulo: number): string {
    const limpio = (s: any) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
    const clave = (s: any) => limpio(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
    const esPersona = (k: string) => !NO_ES_PERSONA.has(k) && /[A-Z]{2}/.test(k);
    type Acum = { viajes: number; propio: number; terc: number };
    type Mes = { orden: number; choferes: Map<string, Acum>; auxiliares: Map<string, Acum>; sinHoras: number };
    const meses = new Map<string, Mes>();
    // Un solo nombre por persona: la forma mas usada ("IVAN  BONETTI" = "IVAN BONETTI")
    const grafias = new Map<string, Map<string, number>>();
    const anotar = (n: string) => {
        const k = clave(n);
        if (!grafias.has(k)) grafias.set(k, new Map());
        const g = grafias.get(k)!;
        g.set(limpio(n), (g.get(limpio(n)) || 0) + 1);
        return k;
    };
    const sumar = (m: Map<string, Acum>, k: string, horas: number, propio: boolean) => {
        if (!m.has(k)) m.set(k, { viajes: 0, propio: 0, terc: 0 });
        const a = m.get(k)!;
        a.viajes++;
        if (propio) a.propio += horas; else a.terc += horas;
    };

    for (const f of viajes) {
        const mes = String(f['Mes'] || '') || 'SIN FECHA';
        const fecha = f['Fecha'] ? new Date(f['Fecha']).getTime() : 0;
        if (!meses.has(mes)) meses.set(mes, { orden: fecha, choferes: new Map(), auxiliares: new Map(), sinHoras: 0 });
        const m = meses.get(mes)!;
        if (fecha && fecha < m.orden) m.orden = fecha;
        const horas = Number(f['Duracion horas']);
        if (!(horas > 0)) { m.sinHoras++; continue; }
        const contrato = String(f['Contrato'] || '').trim().toLowerCase();
        const propio = contrato === 'propio';
        const chofer = clave(f['Chofer']);
        if (propio && esPersona(chofer)) sumar(m.choferes, anotar(f['Chofer']), horas, true);
        const enEsteViaje = new Set<string>();
        for (const col of ['Auxiliar 1', 'Auxiliar 2', 'Auxiliar 3']) {
            for (const parte of String(f[col] ?? '').split(/[\/,]/)) {
                const k = clave(parte);
                if (!esPersona(k) || enEsteViaje.has(k)) continue;
                enEsteViaje.add(k);
                sumar(m.auxiliares, anotar(parte), horas, propio);
            }
        }
    }
    const nombreDe = (k: string) => [...(grafias.get(k) || new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || k;

    const dos = (n: number) => Math.round(n * 100) / 100;
    const linea = (mes: string, puesto: string, persona: string, a: Acum, estiloTexto: number) => [
        { valor: mes, estilo: estiloTexto }, { valor: puesto, estilo: estiloTexto }, { valor: persona, estilo: estiloTexto },
        { valor: a.viajes, estilo: estiloEntero },
        { valor: dos(a.propio), estilo: estiloDecimal },
        { valor: puesto.startsWith('Chofer') ? '' : dos(a.terc), estilo: estiloDecimal },
        { valor: dos(a.propio + a.terc), estilo: estiloDecimal }
    ];
    const filasXml: string[] = [filaXml(1, COLUMNAS_PERSONAS.map((n) => ({ valor: n, estilo: estiloTitulo })))];
    let nro = 2;
    for (const [mes, m] of [...meses.entries()].sort((a, b) => a[1].orden - b[1].orden)) {
        for (const [puesto, mapa] of [['Chofer propio', m.choferes], ['Auxiliar', m.auxiliares]] as [string, Map<string, Acum>][]) {
            const total: Acum = { viajes: 0, propio: 0, terc: 0 };
            const orden = [...mapa.entries()].sort((a, b) => (b[1].propio + b[1].terc) - (a[1].propio + a[1].terc));
            for (const [k, a] of orden) {
                filasXml.push(filaXml(nro++, linea(mes, puesto, nombreDe(k), a, estiloComun)));
                total.viajes += a.viajes; total.propio += a.propio; total.terc += a.terc;
            }
            if (orden.length) filasXml.push(filaXml(nro++, linea(mes, puesto, puesto === 'Auxiliar' ? 'TOTAL AUXILIARES' : 'TOTAL CHOFERES PROPIOS', total, estiloTitulo)));
        }
        if (m.sinHoras) {
            filasXml.push(filaXml(nro++, [{ valor: mes, estilo: estiloComun }, { valor: 'Aviso', estilo: estiloComun },
                { valor: `${m.sinHoras} viaje(s) sin salida o llegada cargada: no suman horas`, estilo: estiloComun }]));
        }
    }
    nro++;
    filasXml.push(filaXml(nro++, [{ valor: 'Cada persona suma la duracion completa de cada viaje en que fue (de la salida a la llegada al deposito). '
        + 'Un viaje de 7 h con 3 auxiliares son 7 h para cada uno y 21 h de auxiliares. Horas en decimales: 7,50 = 7 h 30 min.', estilo: estiloComun }]));

    const ultima = letra(COLUMNAS_PERSONAS.length);
    const rango = `A1:${ultima}${Math.max(nro - 3, 2)}`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<dimension ref="A1:${ultima}${nro - 1}"/>`
        + '<sheetViews><sheetView workbookViewId="0">'
        + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="15"/>'
        + '<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="15" customWidth="1"/>'
        + '<col min="3" max="3" width="30" customWidth="1"/>'
        + `<col min="4" max="${COLUMNAS_PERSONAS.length}" width="16" customWidth="1"/></cols>`
        + `<sheetData>${filasXml.join('')}</sheetData>`
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

    // La hoja de la plantilla pasa a ser la base oculta de la dinamica, y la
    // «Viajes» visible entra justo despues de ella.
    if (!wb.includes(`name="${HOJA_BASE_NOMBRE}"`)) {
        const v = HOJA_VIAJES_VISIBLE;
        wb = wb.replace(/<sheet ([^>]*?)name="Viajes"([^>]*?)state="visible"([^>]*?)\/>/, (m0, a, b, c) =>
            `<sheet ${a}name="${HOJA_BASE_NOMBRE}"${b}state="hidden"${c}/>`
            + `<sheet xmlns:r="${R}" name="${v.nombre}" sheetId="${v.sheetId}" state="visible" r:id="${v.rel}"/>`);
        wb = wb.replace(/'Viajes'!/g, `'${HOJA_BASE_NOMBRE}'!`);
        rels = rels.replace('</Relationships>',
            `<Relationship Type="${R}/worksheet" Target="/${v.archivo}" Id="${v.rel}"/></Relationships>`);
        tipos = tipos.replace('</Types>',
            `<Override PartName="/${v.archivo}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    }

    for (const h of [...HOJAS_POR_CONTRATO, HOJA_HORAS, HOJA_PERSONAS]) {
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
    cache = cache.replace(/(<worksheetSource [^>]*?)sheet="Viajes"/, `$1sheet="${HOJA_BASE_NOMBRE}"`);
    if (!/refreshOnLoad="1"/.test(cache)) {
        cache = cache.replace('<pivotCacheDefinition ', '<pivotCacheDefinition refreshOnLoad="1" ');
    }
    zip[CACHE_DINAMICA] = enc.encode(cache);

    // ── Hoja "Conteo por UN" ───────────────────────────────────────────────
    if (zip[HOJA_CONTEO]) {
        zip[HOJA_CONTEO] = enc.encode(armarHojaConteo(dec.decode(zip[HOJA_CONTEO]), analisis || []));
    }

    // ── Hojas "Propios" y "Tercerizados" ───────────────────────────────────
    // Una fila por viaje: el viaje entero, como se ve en planificacion.
    const estiloTitulo = estilosDeLaFila(hoja, 1)[1] ?? estiloComun;
    // La «Viajes» visible: las mismas filas que suma la dinamica (un viaje de
    // dos unidades va en dos filas, cada una con su parte), con el orden nuevo.
    zip[HOJA_VIAJES_VISIBLE.archivo] = enc.encode(armarHojaPlana(soloPartes, estilos, estiloComun, estiloTitulo));
    for (const h of HOJAS_POR_CONTRATO) {
        const suyas = filas.filter((f: any) =>
            String(f['Contrato'] || '').trim().toLowerCase() === h.contrato);
        zip[h.archivo] = enc.encode(armarHojaDeContrato(suyas, estilos, estiloComun, estiloTitulo));
    }
    // ── Hoja "Horas promedio" ──────────────────────────────────────────────
    // Sale de las mismas filas que la «Viajes» visible (las partes de cada viaje).
    const estiloDeColumna = (nombre: string) => estilos[COLUMNAS_LIBRO.indexOf(nombre) + 1] ?? estiloComun;
    zip[HOJA_HORAS.archivo] = enc.encode(armarHojaHoras(
        soloPartes, estiloDeColumna('Paradas planificadas'), estiloDeColumna('Duracion horas'), estiloComun, estiloTitulo));
    // ── Hoja "Horas por persona" ───────────────────────────────────────────
    // Una fila por viaje (como «Propios» y «Tercerizados»): con las partes, un
    // viaje de dos unidades le sumaria sus horas dos veces a cada persona.
    zip[HOJA_PERSONAS.archivo] = enc.encode(armarHojaPersonas(
        filas.filter((f: any) => f._tipo !== 'hijo'),
        estiloDeColumna('Paradas planificadas'), estiloDeColumna('Duracion horas'), estiloComun, estiloTitulo));
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
    if (zip[HOJA_RESUMEN]) {
        const resumen = dec.decode(zip[HOJA_RESUMEN]).replace(
            'Este cuadro sale de la hoja &#171;Viajes&#187;.',
            'Este cuadro sale de los viajes de la hoja &#171;Viajes&#187; (los lee de una copia oculta, &#171;Base din&#225;mica&#187;, que no hay que tocar).');
        zip[HOJA_RESUMEN] = enc.encode(resumen);
    }

    return Buffer.from(zipSync(zip, { level: 6 }));
}
