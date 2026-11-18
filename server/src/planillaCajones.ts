/* ============================================================================
 * PLANILLA DE CAJONES DE TRAFICO vs LO QUE CARGA LA APP
 * ============================================================================
 * El equipo de trafico carga a mano, en "CONTROL CAJONES Y PALLET_ TRAFICO.xlsx"
 * (SharePoint), los envases de cada reparto: UNA HOJA POR REPARTO ("R1 - ELIAS
 * ZURITA", ..., "LIBRE - AA755TA"), y en cada hoja un bloque por tipo de envase
 * con tres filas -- SALIDA, ENTRADA, DIFERENCIA -- y una columna por dia (la
 * fila "DIAS" tiene las fechas).
 *
 * Se compara con lo que cargan los choferes en la app al cerrar cada parada:
 *   SALIDA de la planilla  <->  DEJADOS en la app
 *   ENTRADA de la planilla <->  RECUPERADOS en la app
 * por reparto (el usuario de la app del camion), dia y tipo de envase.
 * Pallet y Canasto no los carga la app: se muestran solo de la planilla.
 *
 * Solo calcula: no lee la base ni SharePoint.
 * ========================================================================= */
import * as XLSX from 'xlsx';

export const TIPOS_PLANILLA = [
    { clave: 'peco', nombre: 'Peco', app: true },
    { clave: 'burzaco', nombre: 'Burzaco', app: true },
    { clave: 'plasticos', nombre: 'Plásticos', app: true },
    { clave: 'deposito', nombre: 'Depo', app: true },
    { clave: 'jaula', nombre: 'Jaula', app: true },
    { clave: 'pallet', nombre: 'Pallet', app: false },
    { clave: 'canasto', nombre: 'Canasto', app: false },
] as const;
export type TipoPlanilla = typeof TIPOS_PLANILLA[number]['clave'];

const N = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** "CAJONES PECO", "CAJONES BURZACO", "DEPO"... -> clave del tipo */
export function tipoDeEtiqueta(s: any): TipoPlanilla | null {
    const n = N(s);
    if (!n) return null;
    if (/PALLET/.test(n)) return 'pallet';
    if (/PECO/.test(n)) return 'peco';
    if (/BURZ/.test(n)) return 'burzaco';
    if (/PLAS/.test(n)) return 'plasticos';
    if (/CANAST/.test(n)) return 'canasto';
    if (/JAULA/.test(n)) return 'jaula';
    if (/^DEPO|DEPOSITO/.test(n)) return 'deposito';
    return null;
}

/** "R16 - MAXI SUAREZ" -> R16 ; "LIBRE - AA755TA" -> LIBRE (patente AA755TA).
 *  Las hojas que no son de un reparto (Repartos, Resumen, --) devuelven null. */
export function repartoDeHoja(nombre: string): { codigo: string; patente: string | null } | null {
    const n = N(nombre);
    let m = n.match(/^R\s*(\d+)\b/);
    if (m) return { codigo: 'R' + Number(m[1]), patente: null };
    m = n.match(/^LIBRE\b(?:\s*-\s*([A-Z0-9 ]+))?/);
    if (m) return { codigo: 'LIBRE', patente: m[1] ? m[1].replace(/\s/g, '') : null };
    return null;
}

/** El reparto de un viaje del lado de la app: el usuario del camion (R1..R22);
 *  si no tiene, el numero del reparto; si es un LIBRE sin usuario, la patente
 *  contra las hojas LIBRE. */
export function repartoDeViaje(t: { assignedMobileUser?: any; reparto?: any; vehicle?: any }, patentesLibre: string[]): string {
    const u = N(t.assignedMobileUser).replace(/\s/g, '');
    if (/^R\d+$/.test(u)) return 'R' + Number(u.slice(1));
    const m = N(t.reparto).match(/^R\s*(\d+)\b/);
    if (m) return 'R' + Number(m[1]);
    const pat = N(t.vehicle).replace(/[\s-]/g, '');
    if (pat && patentesLibre.includes(pat)) return 'LIBRE';
    return 'SIN REPARTO';
}

function serialAFecha(v: number): string | null {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d || !d.y) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
}

function numero(v: any): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'));
    return null;
}

export interface FilaPlanilla {
    hoja: string; codigo: string; patente: string | null;
    fecha: string; tipo: TipoPlanilla; salida: number | null; entrada: number | null;
}

/** Lee todas las hojas de reparto. desde/hasta (AAAA-MM-DD) recortan los dias. */
export function leerPlanillaCajones(buf: Buffer, desde?: string, hasta?: string) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const filas: FilaPlanilla[] = [];
    const hojas: Array<{ nombre: string; codigo: string; patente: string | null; dias: number }> = [];
    const ignoradas: string[] = [];
    for (const nombre of wb.SheetNames) {
        const id = repartoDeHoja(nombre);
        if (!id) { ignoradas.push(nombre); continue; }
        const a: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: null, raw: true }) as any[][];
        let fechas: Array<string | null> = [];
        let grupo: { tipo: TipoPlanilla | null; salida: any[] | null; entrada: any[] | null } | null = null;
        const dias = new Set<string>();
        const cerrar = () => {
            if (!grupo || !grupo.tipo) { grupo = null; return; }
            const largo = Math.max(grupo.salida?.length || 0, grupo.entrada?.length || 0);
            for (let j = 3; j < largo; j++) {
                const fecha = fechas[j];
                if (!fecha) continue;
                if ((desde && fecha < desde) || (hasta && fecha > hasta)) continue;
                const s = numero(grupo.salida?.[j]), e = numero(grupo.entrada?.[j]);
                if (s === null && e === null) continue;
                filas.push({ hoja: nombre, codigo: id.codigo, patente: id.patente, fecha, tipo: grupo.tipo, salida: s, entrada: e });
                dias.add(fecha);
            }
            grupo = null;
        };
        for (const r0 of a) {
            const r = r0 || [];
            if (N(r[2]) === 'DIAS') {
                cerrar();
                fechas = r.map((v: any, j: number) => (j >= 3 && typeof v === 'number' ? serialAFecha(v) : null));
                continue;
            }
            const rotulo = N(r[1]);
            if (rotulo === 'SALIDA' || rotulo === 'ENTRADA' || rotulo === 'DIFERENCIA') {
                if (!grupo) grupo = { tipo: null, salida: null, entrada: null };
                // El nombre del envase puede estar en la fila de SALIDA o en la de ENTRADA
                const t = tipoDeEtiqueta(r[0]);
                if (t) grupo.tipo = t;
                if (rotulo === 'SALIDA') grupo.salida = r;
                if (rotulo === 'ENTRADA') grupo.entrada = r;
            } else {
                cerrar();
            }
        }
        cerrar();
        hojas.push({ nombre, codigo: id.codigo, patente: id.patente, dias: dias.size });
    }
    return { hojas, filas, ignoradas };
}

export interface MovimientoApp {
    codigo: string; fecha: string; tipo: TipoPlanilla; dejados: number; recuperados: number; viajeId: number;
}

type Celda = { ps: number; pe: number; ad: number; ar: number; enPlanilla: boolean; enApp: boolean };

/** Cruza planilla y app por reparto, dia y tipo. */
export function compararCajones(filas: FilaPlanilla[], app: MovimientoApp[], hojas: Array<{ nombre: string; codigo: string; patente: string | null }>) {
    const vacia = (): Celda => ({ ps: 0, pe: 0, ad: 0, ar: 0, enPlanilla: false, enApp: false });
    // codigo -> fecha -> tipo -> celda
    const m = new Map<string, Map<string, Map<string, Celda>>>();
    const viajes = new Map<string, Set<number>>();   // codigo|fecha -> viajes
    const celda = (codigo: string, fecha: string, tipo: string) => {
        if (!m.has(codigo)) m.set(codigo, new Map());
        const f = m.get(codigo)!;
        if (!f.has(fecha)) f.set(fecha, new Map());
        const t = f.get(fecha)!;
        if (!t.has(tipo)) t.set(tipo, vacia());
        return t.get(tipo)!;
    };
    for (const p of filas) {
        const c = celda(p.codigo, p.fecha, p.tipo);
        c.ps += p.salida || 0; c.pe += p.entrada || 0; c.enPlanilla = true;
    }
    for (const x of app) {
        const c = celda(x.codigo, x.fecha, x.tipo);
        c.ad += x.dejados; c.ar += x.recuperados; c.enApp = true;
        const k = `${x.codigo}|${x.fecha}`;
        if (!viajes.has(k)) viajes.set(k, new Set());
        viajes.get(k)!.add(x.viajeId);
    }
    const comparables = TIPOS_PLANILLA.filter((t) => t.app).map((t) => t.clave as string);
    const hojaDe = new Map(hojas.map((h) => [h.codigo, h]));
    const repartos = [...m.entries()].map(([codigo, fechas]) => {
        const totales: Record<string, Celda> = {};
        const dias = [...fechas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, tipos]) => {
            const t: Record<string, Celda> = {};
            for (const [k, c] of tipos.entries()) {
                t[k] = c;
                if (!totales[k]) totales[k] = vacia();
                const T = totales[k];
                T.ps += c.ps; T.pe += c.pe; T.ad += c.ad; T.ar += c.ar;
                T.enPlanilla = T.enPlanilla || c.enPlanilla; T.enApp = T.enApp || c.enApp;
            }
            const enPlanilla = [...tipos.values()].some((c) => c.enPlanilla);
            const enApp = [...tipos.values()].some((c) => c.enApp);
            // Hay diferencia si algun envase no da igual (lo que no esta cargado cuenta 0)
            const diferencias = comparables.filter((k) => {
                const c = tipos.get(k);
                return c && (c.ps !== c.ad || c.pe !== c.ar);
            });
            // La planilla en cero y la app sin nada es un dia sin movimiento: esta bien
            const estado = !diferencias.length ? 'ok'
                : enPlanilla && enApp ? 'diferencia'
                : enPlanilla ? 'solo planilla' : 'solo app';
            return { fecha, tipos: t, estado, diferencias, viajes: [...(viajes.get(`${codigo}|${fecha}`) || [])].sort((a, b) => a - b) };
        });
        const h = hojaDe.get(codigo);
        return {
            codigo, hoja: h?.nombre || null, totales, dias,
            resumen: {
                dias: dias.length,
                ok: dias.filter((d) => d.estado === 'ok').length,
                conDiferencia: dias.filter((d) => d.estado === 'diferencia').length,
                soloPlanilla: dias.filter((d) => d.estado === 'solo planilla').length,
                soloApp: dias.filter((d) => d.estado === 'solo app').length,
            }
        };
    });
    // R1, R2 ... R22, LIBRE y lo que no tiene hoja al final
    repartos.sort((a, b) => ordenReparto(a.codigo) - ordenReparto(b.codigo) || a.codigo.localeCompare(b.codigo));
    return { tipos: TIPOS_PLANILLA, repartos };
}

const ordenReparto = (c: string) => (/^R\d+$/.test(c) ? Number(c.slice(1)) : c === 'LIBRE' ? 1000 : 2000);

type ResumenDias = { dias: number; ok: number; conDiferencia: number; soloPlanilla: number; soloApp: number };
const resumenVacio = (): ResumenDias => ({ dias: 0, ok: 0, conDiferencia: 0, soloPlanilla: 0, soloApp: 0 });
const contarEstado = (r: ResumenDias, estado: string) => {
    r.dias++;
    if (estado === 'ok') r.ok++;
    else if (estado === 'diferencia') r.conDiferencia++;
    else if (estado === 'solo planilla') r.soloPlanilla++;
    else if (estado === 'solo app') r.soloApp++;
};

/** Lo mismo, pero por dia, mes o año: cada periodo con el total de todos los
 *  repartos y, adentro, cada reparto. Los dias que coinciden / con diferencia
 *  se cuentan por reparto y dia (un mes con 20 repartos y 20 dias son 400). */
export function agruparPorPeriodo(repartos: ReturnType<typeof compararCajones>['repartos'], agrupar: 'dia' | 'mes' | 'anio') {
    const clave = (f: string) => (agrupar === 'dia' ? f : agrupar === 'mes' ? f.slice(0, 7) : f.slice(0, 4));
    const sumar = (acc: Record<string, any>, tipos: Record<string, any>) => {
        for (const [k, c] of Object.entries(tipos)) {
            if (!acc[k]) acc[k] = { ps: 0, pe: 0, ad: 0, ar: 0 };
            acc[k].ps += c.ps; acc[k].pe += c.pe; acc[k].ad += c.ad; acc[k].ar += c.ar;
        }
    };
    const periodos = new Map<string, { periodo: string; tipos: Record<string, any>; resumen: ResumenDias; repartos: Map<string, any> }>();
    for (const r of repartos) {
        for (const d of r.dias) {
            const k = clave(d.fecha);
            if (!periodos.has(k)) periodos.set(k, { periodo: k, tipos: {}, resumen: resumenVacio(), repartos: new Map() });
            const P = periodos.get(k)!;
            sumar(P.tipos, d.tipos);
            contarEstado(P.resumen, d.estado);
            if (!P.repartos.has(r.codigo)) P.repartos.set(r.codigo, { codigo: r.codigo, hoja: r.hoja, tipos: {}, resumen: resumenVacio(), estado: null, viajes: [] as number[] });
            const R = P.repartos.get(r.codigo);
            sumar(R.tipos, d.tipos);
            contarEstado(R.resumen, d.estado);
            // Por dia, el reparto ES ese dia: su estado y sus viajes
            if (agrupar === 'dia') { R.estado = d.estado; R.viajes = d.viajes; }
        }
    }
    return [...periodos.values()]
        .sort((a, b) => a.periodo.localeCompare(b.periodo))
        .map((p) => ({
            ...p,
            repartos: [...p.repartos.values()].sort((a, b) => ordenReparto(a.codigo) - ordenReparto(b.codigo) || a.codigo.localeCompare(b.codigo))
        }));
}
