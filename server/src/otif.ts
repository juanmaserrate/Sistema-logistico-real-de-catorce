/* ============================================================================
 * OTIF: ENTREGAS A TIEMPO Y COMPLETAS
 * ============================================================================
 *   OTIF (%) = (pedidos entregados a tiempo y completos / pedidos evaluados) x 100
 *
 * Un pedido es una entrega a una escuela en un viaje (una parada; la vuelta al
 * deposito no cuenta).
 *   - A tiempo: la hora de llegada que marco el chofer no pasa la hora limite
 *     de su unidad. Las unidades sin limite estan a tiempo si se entrego.
 *   - Completa: quedo "Entregada" y no tiene incidencia (las incidencias son
 *     las de Atencion al Cliente: se cruzan por fecha y escuela).
 *   - Fuera del calculo: retiros y reposiciones (no son entregas a una escuela).
 *
 * Reglas acordadas con juanma (nov 2026). Solo calcula: no lee la base.
 * ========================================================================= */

export interface EntregaOtif {
    viajeId: number;
    /** Dia del reparto, AAAA-MM-DD */
    fecha: string;
    reparto: string;
    chofer: string;
    contrato: string;
    unidad: string;
    escuela: string;
    /** COMPLETED | UNDELIVERABLE | PENDING | ... */
    estado: string;
    llegada: Date | null;
    salida: Date | null;
}

export interface IncidenciaOtif {
    fecha: string;          // AAAA-MM-DD
    unidad: string;
    establecimiento: string;
    tipo: string;
}

export interface ReglasOtif {
    /** Unidad -> hora limite "HH:MM" (hora argentina). Las que no estan: sin limite. */
    limites: Record<string, string>;
    /** Unidades que no entran en el calculo */
    fuera: string[];
    /** Como llama la planilla de incidencias a algunas unidades del sistema */
    unidadIncidencia: Record<string, string>;
}

export const REGLAS_OTIF: ReglasOtif = {
    limites: { 'SAE BROWN': '09:00', 'SAE LANUS': '09:00', 'SAE LOMAS': '09:00', 'SECOS LANUS': '09:00', 'CDI': '14:00' },
    fuera: ['RETIRO', 'REPOSICION'],
    unidadIncidencia: { 'JARDINES LOMAS': 'SAE LOMAS', 'CPII LOMAS': 'SAE LOMAS' },
};

export function N(s: any): string {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

const TIPOS: Array<[string, string]> = [
    ['^(JARDIN( DE INFANTES)?|JI|J|JIN|JIRIMM|J\\.I)\\b', 'J'],
    ['^(EP|EPB|E\\.P\\.B|E\\.P|PRIMARIA)\\b', 'EP'],
    ['^(ESS|ES|ESB|E\\.S\\.B|E\\.S|EES|SECUNDARIA|SEC)\\b', 'ES'],
    ['^(TEC|EEST|TECNICA)\\b', 'TEC'],
    ['^(CEC|CE)\\b', 'CE'],
    ['^(CPII|C\\.P\\.I\\.I)\\b', 'CPII'],
    ['^(EEE|EE|ESPECIAL)\\b', 'EE'],
    ['^(CENS)\\b', 'CENS'],
];

/** "E.P.B N° 49", "EP 49" y "Escuela Primaria 49" dan lo mismo: "EP 49".
 *  Si no tiene tipo y numero, el nombre limpio: "NOM ...". */
export function claveEscuela(nombre: string): string {
    let n = N(nombre).replace(/N°|Nº|NRO/g, ' ');
    n = n.replace(/\bN\W*(?=\d)/g, ' ');             // "N°56", "N 56"
    n = n.replace(/\bNTRA\b/g, 'NUESTRA');
    n = n.replace(/^([A-Z]{1,4})(\d+)$/, '$1 $2');      // "J967" -> "J 967"
    n = n.replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
    const n2 = n.replace(/^(\w)\s(\w)\s(\w)\b/, '$1$2$3');   // "E P B" -> "EPB"
    for (const cand of [n2, n]) {
        for (const [pat, t] of TIPOS) {
            const m = cand.replace(/\./g, ' ').match(new RegExp(pat + '\\s*(\\d+)')) || cand.match(new RegExp(pat + '(\\d+)'));
            if (m) return `${t} ${parseInt(m[m.length - 1], 10)}`;
        }
    }
    return 'NOM ' + n.replace(/[^A-Z0-9 ]/g, '');
}

/** Hora argentina "HH:MM" */
function horaAR(d: Date | null): string | null {
    if (!d || isNaN(d.getTime())) return null;
    const x = new Date(d.getTime() - 3 * 3600_000);
    return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
}

function diaMas(f: string, k: number): string {
    const d = new Date(f + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
}

export interface ResultadoEntrega extends EntregaOtif {
    hora: string | null;
    limite: string | null;
    fuera: boolean;
    aTiempo: boolean;
    completa: boolean;
    otif: boolean;
    incidencias: string[];
    motivo: string | null;
}

export interface ResultadoOtif {
    formula: { aTiempoYCompletos: number; evaluados: number; otif: number };
    aTiempo: number;            // % sobre evaluados
    completas: number;          // % sobre evaluados
    fuera: number;              // pedidos que no entran
    porUnidad: Array<{ unidad: string; limite: string | null; pedidos: number; aTiempo: number; completas: number; otif: number; porcentaje: number }>;
    motivos: Record<string, number>;
    incidencias: { total: number; asignadas: number; generales: IncidenciaOtif[]; sinAsignar: IncidenciaOtif[] };
    entregas: ResultadoEntrega[];
}

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);

export function calcularOtif(entregas: EntregaOtif[], incidencias: IncidenciaOtif[], reglas: ReglasOtif = REGLAS_OTIF): ResultadoOtif {
    // Nombre limpio y clave una sola vez por entrega: con el ano entero son
    // decenas de miles y se comparan contra cada incidencia.
    const conClave = entregas.map((e) => ({ e, clave: claveEscuela(e.escuela), nom: N(e.escuela) }));
    const porFechaClave = new Map<string, typeof conClave>();
    const porFecha = new Map<string, typeof conClave>();
    for (const x of conClave) {
        const k = `${x.e.fecha}|${x.clave}`;
        if (!porFechaClave.has(k)) porFechaClave.set(k, []);
        porFechaClave.get(k)!.push(x);
        if (!porFecha.has(x.e.fecha)) porFecha.set(x.e.fecha, []);
        porFecha.get(x.e.fecha)!.push(x);
    }
    const TIPO_POR_UNIDAD: Record<string, string[]> = { 'JARDINES LOMAS': ['J'], 'CPII LOMAS': ['CPII'] };

    // ── Cruce de incidencias con entregas ──
    const incPorEntrega = new Map<EntregaOtif, string[]>();
    const generales: IncidenciaOtif[] = [], sinAsignar: IncidenciaOtif[] = [];
    let asignadas = 0;
    for (const inc of incidencias) {
        const esc = N(inc.establecimiento);
        if (!esc) { sinAsignar.push(inc); continue; }
        // "26 establecimientos", "todo Brown": no dice cuales
        if (/\d+\s+(ESTABLECIMIENTOS|ESCUELAS)|\bTODOS?\b|\bTODAS\b/.test(esc)) { generales.push(inc); continue; }
        const partes = esc.split(/,| Y /).map((p) => p.trim()).filter(Boolean);
        let hits: typeof conClave = [];
        // El mismo dia; si no, el anterior o el siguiente (se carga al otro dia)
        for (const fecha of [inc.fecha, diaMas(inc.fecha, -1), diaMas(inc.fecha, 1)]) {
            for (const parte of partes) {
                const k = claveEscuela(parte);
                if (k.startsWith('NOM ') && /^\d+$/.test(parte)) {
                    // Solo el numero: la unidad dice que tipo es; si no, el unico que coincida
                    const tipos = TIPO_POR_UNIDAD[N(inc.unidad)] || ['J', 'EP', 'ES', 'TEC', 'CPII'];
                    const cands = tipos.flatMap((t) => porFechaClave.get(`${fecha}|${t} ${parseInt(parte, 10)}`) || []);
                    if (new Set(cands.map((c) => c.clave)).size === 1) hits.push(...cands);
                    continue;
                }
                if (k.startsWith('NOM ')) {
                    // Por nombre: todas las palabras del reclamo en el nombre de la parada
                    const pals = k.slice(4).split(' ').filter((w) => w.length > 2);
                    if (pals.length) hits.push(...(porFecha.get(fecha) || []).filter((x) => pals.every((w) => x.nom.includes(w))));
                    continue;
                }
                hits.push(...(porFechaClave.get(`${fecha}|${k}`) || []));
            }
            if (hits.length) break;
        }
        if (!hits.length) { sinAsignar.push(inc); continue; }
        asignadas++;
        // La escuela tuvo dos entregas ese dia (ej.: SAE y SAM): la de la unidad de la incidencia
        const unInc = reglas.unidadIncidencia[N(inc.unidad)] || N(inc.unidad);
        const misma = hits.filter((h) => N(h.e.unidad) === unInc);
        for (const h of (misma.length ? misma : hits)) {
            if (!incPorEntrega.has(h.e)) incPorEntrega.set(h.e, []);
            const l = incPorEntrega.get(h.e)!;
            if (inc.tipo && !l.includes(inc.tipo)) l.push(inc.tipo);
            else if (!inc.tipo && !l.length) l.push('INCIDENCIA');
        }
    }

    // ── Cada entrega ──
    const fuera = new Set(reglas.fuera.map(N));
    const resultado: ResultadoEntrega[] = entregas.map((e) => {
        const un = N(e.unidad);
        const lim = reglas.limites[un] || null;
        const hora = horaAR(e.llegada) || horaAR(e.salida);
        const entregada = String(e.estado).toUpperCase() === 'COMPLETED';
        const incs = incPorEntrega.get(e) || [];
        const aTiempo = lim ? entregada && !!hora && hora <= lim : entregada;
        const completa = entregada && !incs.length;
        // "REPOSICION SAE BROWN" y las demas reposiciones quedan fuera como REPOSICION
        const esFuera = fuera.has(un) || [...fuera].some((f) => un.startsWith(f + ' '));
        let motivo: string | null = null;
        if (!esFuera && !(aTiempo && completa)) {
            if (!entregada) motivo = String(e.estado).toUpperCase() === 'UNDELIVERABLE' ? 'No entregada' : 'Sin marcar';
            else if (!aTiempo && incs.length) motivo = 'Tarde y con incidencia';
            else if (!aTiempo) motivo = 'Llegó tarde';
            else motivo = 'Con incidencia';
        }
        return { ...e, hora, limite: lim, fuera: esFuera, aTiempo, completa, otif: !esFuera && aTiempo && completa, incidencias: incs, motivo };
    });

    const med = resultado.filter((r) => !r.fuera);
    const si = med.filter((r) => r.otif).length;
    const unidades = new Map<string, ResultadoEntrega[]>();
    for (const r of med) {
        const u = N(r.unidad) || 'SIN UNIDAD';
        if (!unidades.has(u)) unidades.set(u, []);
        unidades.get(u)!.push(r);
    }
    const motivos: Record<string, number> = {};
    for (const r of med) if (r.motivo) motivos[r.motivo] = (motivos[r.motivo] || 0) + 1;

    return {
        formula: { aTiempoYCompletos: si, evaluados: med.length, otif: pct(si, med.length) },
        aTiempo: pct(med.filter((r) => r.aTiempo).length, med.length),
        completas: pct(med.filter((r) => r.completa).length, med.length),
        fuera: resultado.length - med.length,
        porUnidad: [...unidades.entries()]
            .map(([unidad, l]) => ({
                unidad, limite: reglas.limites[unidad] || null, pedidos: l.length,
                aTiempo: l.filter((r) => r.aTiempo).length, completas: l.filter((r) => r.completa).length,
                otif: l.filter((r) => r.otif).length, porcentaje: pct(l.filter((r) => r.otif).length, l.length)
            }))
            .sort((a, b) => b.pedidos - a.pedidos),
        motivos,
        incidencias: { total: incidencias.length, asignadas, generales, sinAsignar },
        entregas: resultado,
    };
}
