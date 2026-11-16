/* ============================================================================
 * COSTO DE LOS AUXILIARES POR VIAJE (propios Y tercerizados)
 * ============================================================================
 * Pedido de juanma (16-nov-2026): el sueldo del auxiliar tiene que entrar
 * entero al costo, como el de los choferes, y en los viajes donde trabajo --
 * tambien los tercerizados, porque la mitad de sus horas las pasa arriba de
 * un camion de un proveedor.
 *
 * Antes el Motor solo miraba los viajes propios y cobraba el jornal el dia
 * que el auxiliar salia en uno propio. En octubre entraban $10,9 M de una
 * nomina de $25,1 M: los dias en tercerizados ($14,2 M) no iban a ningun lado.
 *
 * Como se reparte (la ficha del auxiliar dice como cobra):
 *   - FIJO: el bruto del mes se reparte entre TODOS sus viajes del mes,
 *     propios y tercerizados, segun las horas de cada uno.
 *   - JORNAL: cada dia que trabajo cobra su jornal, repartido entre los viajes
 *     de ese dia segun las horas.
 *   - Sin dato en la ficha: si tiene bruto, como FIJO; si solo jornal, JORNAL.
 *
 * La suma de lo repartido da exacto lo que se le paga: no se agrega ni se
 * pierde nada. Solo calcula: no lee la base ni escribe.
 * ========================================================================= */

export type ModoDePago = 'FIJO' | 'JORNAL';

export interface ViajeConAuxiliares {
    id: number;
    /** Dia del viaje, AAAA-MM-DD (hora argentina) */
    dia: string;
    /** Horas del viaje (con el horario por defecto si no tiene) */
    horas: number;
    tercerizado: boolean;
    /** Los nombres como estan cargados en el viaje */
    auxiliares: string[];
}

export interface SueldoDelAuxiliar {
    bruto: number;
    jornal: number;
    /** Lo que dice la ficha; null si no dice */
    modo: ModoDePago | null;
}

/** Busca el sueldo de una persona en un mes ('AAAA-MM'). */
export type BuscarSueldo = (nombre: string, mes: string) => SueldoDelAuxiliar | null;

export interface PersonaDelMes {
    nombre: string;
    mes: string;
    modo: ModoDePago | null;
    viajes: number;
    dias: number;
    horasPropios: number;
    horasTercerizados: number;
    /** Lo repartido (si no tiene sueldo, 0) */
    costo: number;
    costoPropios: number;
    costoTercerizados: number;
    sinSueldo: boolean;
}

export interface RepartoDeAuxiliares {
    /** viaje -> costo de sus auxiliares */
    porViaje: Map<number, number>;
    /** viaje -> cada auxiliar y lo que le toca */
    detalle: Map<number, Array<{ nombre: string; monto: number }>>;
    personas: PersonaDelMes[];
    sinSueldo: Array<{ nombre: string; mes: string; viajes: number; dias: number }>;
}

const VACIOS = new Set(['', '--', '-', 'N/A', 'NA', 'SIN AUXILIAR', 'SIN AUX', 'NO']);

/** Palabras del nombre, sin tildes ni signos, ordenadas: "Ivan  Bonetti" y
 *  "BONETTI IVAN" son la misma persona. */
export function clavePersona(nombre: string): string {
    return String(nombre ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
        .split(/\s+/).filter((w) => w.length > 1)
        .sort().join(' ');
}

/** Los auxiliares de un viaje: los tres campos, separados por coma o barra
 *  ("ERWIN VILLAGRA/EZEQUIEL SILVA" son dos), sin vacios ni repetidos. */
export function auxiliaresDeTexto(...campos: any[]): string[] {
    const vistos = new Set<string>();
    const salida: string[] = [];
    for (const campo of campos) {
        for (const parte of String(campo ?? '').split(/[,/]/)) {
            const n = parte.replace(/\s+/g, ' ').trim();
            if (VACIOS.has(n.toUpperCase())) continue;
            const k = clavePersona(n);
            if (!k || vistos.has(k)) continue;
            vistos.add(k);
            salida.push(n);
        }
    }
    return salida;
}

/** Reparte `monto` entre los viajes segun sus horas. Sin horas en ninguno,
 *  en partes iguales. */
function repartir(monto: number, viajes: ViajeConAuxiliares[]): number[] {
    const horas = viajes.map((v) => (Number.isFinite(v.horas) && v.horas > 0 ? v.horas : 0));
    const total = horas.reduce((a, b) => a + b, 0);
    return total > 0 ? horas.map((h) => (monto * h) / total) : viajes.map(() => monto / viajes.length);
}

export function repartirAuxiliares(viajes: ViajeConAuxiliares[], buscar: BuscarSueldo): RepartoDeAuxiliares {
    // Cada persona, en cada mes, con sus viajes
    const grupos = new Map<string, { nombre: string; mes: string; viajes: ViajeConAuxiliares[] }>();
    for (const v of viajes) {
        if (!v || !v.dia) continue;
        const mes = v.dia.slice(0, 7);
        for (const nombre of auxiliaresDeTexto(...(v.auxiliares || []))) {
            const k = `${mes}|${clavePersona(nombre)}`;
            if (!grupos.has(k)) grupos.set(k, { nombre, mes, viajes: [] });
            const g = grupos.get(k)!;
            if (!g.viajes.includes(v)) g.viajes.push(v);
        }
    }

    const porViaje = new Map<number, number>();
    const detalle = new Map<number, Array<{ nombre: string; monto: number }>>();
    const personas: PersonaDelMes[] = [];
    const sinSueldo: RepartoDeAuxiliares['sinSueldo'] = [];
    const anotar = (v: ViajeConAuxiliares, nombre: string, monto: number) => {
        porViaje.set(v.id, (porViaje.get(v.id) || 0) + monto);
        if (!detalle.has(v.id)) detalle.set(v.id, []);
        detalle.get(v.id)!.push({ nombre, monto });
    };

    for (const g of grupos.values()) {
        const dias = new Map<string, ViajeConAuxiliares[]>();
        for (const v of g.viajes) {
            if (!dias.has(v.dia)) dias.set(v.dia, []);
            dias.get(v.dia)!.push(v);
        }
        const p: PersonaDelMes = {
            nombre: g.nombre, mes: g.mes, modo: null, viajes: g.viajes.length, dias: dias.size,
            horasPropios: g.viajes.filter((v) => !v.tercerizado).reduce((a, v) => a + (v.horas > 0 ? v.horas : 0), 0),
            horasTercerizados: g.viajes.filter((v) => v.tercerizado).reduce((a, v) => a + (v.horas > 0 ? v.horas : 0), 0),
            costo: 0, costoPropios: 0, costoTercerizados: 0, sinSueldo: false,
        };
        personas.push(p);

        const s = buscar(g.nombre, g.mes);
        const bruto = Number(s?.bruto) || 0;
        const jornal = Number(s?.jornal) || 0;
        let modo: ModoDePago | null = null;
        if (s?.modo === 'JORNAL' && jornal > 0) modo = 'JORNAL';
        else if (bruto > 0) modo = 'FIJO';
        else if (jornal > 0) modo = 'JORNAL';
        p.modo = modo;
        if (!modo) {
            p.sinSueldo = true;
            sinSueldo.push({ nombre: g.nombre, mes: g.mes, viajes: p.viajes, dias: p.dias });
            continue;
        }

        const pagar = (v: ViajeConAuxiliares, monto: number) => {
            anotar(v, g.nombre, monto);
            p.costo += monto;
            if (v.tercerizado) p.costoTercerizados += monto; else p.costoPropios += monto;
        };
        if (modo === 'FIJO') {
            repartir(bruto, g.viajes).forEach((m, i) => pagar(g.viajes[i], m));
        } else {
            for (const delDia of dias.values()) repartir(jornal, delDia).forEach((m, i) => pagar(delDia[i], m));
        }
    }

    sinSueldo.sort((a, b) => b.dias - a.dias || b.viajes - a.viajes);
    return { porViaje, detalle, personas, sinSueldo };
}
