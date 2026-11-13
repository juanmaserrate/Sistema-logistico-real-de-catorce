/* ============================================================================
 * PUNTOS GPS QUE LLEGAN EN LOTE DESDE EL CELULAR
 * ============================================================================
 * La app junta los puntos (cada 2-5 s) y los manda de a varios; sin señal los
 * guarda y los manda todos juntos cuando vuelve. Antes mandaba uno solo por
 * lote y perdia el resto, y el servidor los ordenaba por la hora en que
 * llegaban: el recorrido salia con huecos y con zigzags.
 *
 * Aca se limpia el lote antes de guardarlo:
 *   - se ordena por la hora en que el GPS tomo el punto (no la de llegada)
 *   - se descartan los imprecisos (> 100 m) y los imposibles: un punto que
 *     implica ir a mas de 150 km/h desde el anterior es un rebote del GPS.
 *
 * Si el que estaba mal era el ANTERIOR (el ultimo guardado), los puntos nuevos
 * parecerian todos imposibles. Por eso, si llegan 3 seguidos coherentes entre
 * si, se aceptan: el raro era el de antes.
 * ========================================================================= */

export interface PuntoCrudo {
    lat?: any; lng?: any; acc?: any; spd?: any; hdg?: any; t?: any;
}

export interface PuntoLimpio {
    lat: number; lng: number;
    acc: number | null; spd: number | null; hdg: number | null;
    t: Date;
    /** true = la hora del celular no servia y se uso la del servidor */
    horaDelServidor?: boolean;
}

export interface ResultadoLote {
    buenos: PuntoLimpio[];
    descartados: { imprecisos: number; invalidos: number; saltos: number; repetidos: number };
}

export const PRECISION_MAXIMA_M = 100;
export const VELOCIDAD_MAXIMA_KMH = 150;
/** Por debajo de esta distancia nunca es un salto: el GPS tiembla unos metros. */
const DISTANCIA_MINIMA_SALTO_M = 300;

export function distanciaMetros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function numeroONull(v: any): number | null {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Ir de `a` a `b` es imposible para un camion. */
export function esSalto(a: { lat: number; lng: number; t: Date }, b: { lat: number; lng: number; t: Date }): boolean {
    const d = distanciaMetros(a, b);
    if (d <= DISTANCIA_MINIMA_SALTO_M) return false;
    const seg = (b.t.getTime() - a.t.getTime()) / 1000;
    if (seg <= 0) return true;
    return (d / seg) * 3.6 > VELOCIDAD_MAXIMA_KMH;
}

/**
 * @param puntos   lo que mando el celular, en cualquier orden
 * @param anterior el ultimo punto guardado de ese celular (o null)
 * @param ahora    la hora del servidor
 */
export function limpiarLote(puntos: PuntoCrudo[], anterior: { lat: number; lng: number; t: Date } | null, ahora: Date): ResultadoLote {
    const descartados = { imprecisos: 0, invalidos: 0, saltos: 0, repetidos: 0 };
    const desde = ahora.getTime() - 48 * 3600 * 1000;
    const hasta = ahora.getTime() + 5 * 60 * 1000;

    const validos: PuntoLimpio[] = [];
    for (const p of Array.isArray(puntos) ? puntos : []) {
        const lat = numeroONull(p?.lat), lng = numeroONull(p?.lng);
        if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
            descartados.invalidos++;
            continue;
        }
        const acc = numeroONull(p?.acc);
        if (acc != null && acc > PRECISION_MAXIMA_M) { descartados.imprecisos++; continue; }
        // La hora del GPS. Un reloj de celular roto (año 1970, o del futuro)
        // no puede ordenar nada: ahi va la del servidor.
        let t = p?.t != null ? new Date(typeof p.t === 'number' ? p.t : String(p.t)) : null;
        let horaDelServidor = false;
        if (!t || isNaN(t.getTime()) || t.getTime() < desde || t.getTime() > hasta) {
            t = new Date(ahora);
            horaDelServidor = true;
        }
        validos.push({ lat, lng, acc, spd: numeroONull(p?.spd), hdg: numeroONull(p?.hdg), t, ...(horaDelServidor ? { horaDelServidor } : {}) });
    }

    validos.sort((a, b) => a.t.getTime() - b.t.getTime());

    const buenos: PuntoLimpio[] = [];
    let ancla: { lat: number; lng: number; t: Date } | null = anterior;
    let pendientes: PuntoLimpio[] = [];
    for (const p of validos) {
        const ult = buenos[buenos.length - 1];
        if (ult && ult.t.getTime() === p.t.getTime()) { descartados.repetidos++; continue; }
        if (anterior && !buenos.length && p.t.getTime() === anterior.t.getTime()) { descartados.repetidos++; continue; }
        if (!ancla) { buenos.push(p); ancla = p; continue; }
        if (esSalto(ancla, p)) {
            // Puede ser un rebote... o que el raro sea el ancla. Se espera a ver
            // si los que siguen son coherentes con este.
            const ultPend = pendientes[pendientes.length - 1];
            if (ultPend && !esSalto(ultPend, p)) pendientes.push(p);
            else { descartados.saltos += pendientes.length; pendientes = [p]; }
            if (pendientes.length >= 3) {
                buenos.push(...pendientes);
                ancla = pendientes[pendientes.length - 1];
                pendientes = [];
            }
            continue;
        }
        // Coherente con el ancla: los que quedaron esperando eran rebotes
        descartados.saltos += pendientes.length;
        pendientes = [];
        buenos.push(p);
        ancla = p;
    }
    descartados.saltos += pendientes.length;
    return { buenos, descartados };
}
