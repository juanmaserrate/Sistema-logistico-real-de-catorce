/* ============================================================================
 * EL RECORRIDO REAL DE UN VIAJE, PEGADO A LAS CALLES
 * ============================================================================
 * Los puntos del GPS, unidos con rectas, cortan manzanas: entre un punto y el
 * siguiente el camion dobla, y cuando el celular se queda sin señal la recta
 * cruza medio partido. Aca se arma el recorrido como lo dibuja un mapa:
 *
 *   1. Se limpian los puntos: solo los del viaje (entre que arranco y que
 *      termino), sin los imprecisos ni los rebotes, y uno cada 50 m.
 *   2. Se corta donde hubo un hueco (sin puntos mas de 3 min y 300 m): de un
 *      lado y del otro hay recorrido real, en el medio no se sabe.
 *   3. Cada tramo con puntos se pega a las calles (Mapbox Map Matching, de a
 *      100 puntos). Si no se puede, quedan los puntos tal cual ("crudo").
 *   4. Cada hueco se completa con el camino por calles entre los dos lados
 *      (Mapbox Directions) y se marca "estimado": se dibuja punteado.
 *
 * Las llamadas a Mapbox se pasan como funciones: asi esto se prueba sin red.
 * ========================================================================= */

import { distanciaMetros, esSalto, PRECISION_MAXIMA_M } from './gpsLotes';

export interface PuntoGps { lat: number; lng: number; t: Date; acc?: number | null }
export type Coord = [number, number];   // [lng, lat], como GeoJSON
export interface Tramo { tipo: 'real' | 'crudo' | 'estimado'; coords: Coord[] }
export interface Recorrido { tramos: Tramo[]; km: number; puntos: number; pedidos: number }

export const ESPACIO_MINIMO_M = 50;
export const HUECO_MIN = 3;
export const HUECO_M = 300;
export const PUNTOS_POR_MATCHING = 100;

/** Paso 1: los puntos que sirven, en orden y uno cada 50 m. */
export function prepararPuntos(filas: PuntoGps[], desde?: Date | null, hasta?: Date | null): PuntoGps[] {
    const ini = desde ? desde.getTime() - 5 * 60000 : -Infinity;
    const fin = hasta ? hasta.getTime() + 5 * 60000 : Infinity;
    const ordenados = filas
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0))
        .filter((p) => p.acc == null || p.acc <= PRECISION_MAXIMA_M)
        .filter((p) => p.t.getTime() >= ini && p.t.getTime() <= fin)
        .sort((a, b) => a.t.getTime() - b.t.getTime());
    const salida: PuntoGps[] = [];
    let pendiente: PuntoGps | null = null;   // un posible rebote, esperando confirmacion
    for (const p of ordenados) {
        const ult = salida[salida.length - 1];
        if (!ult) { salida.push(p); continue; }
        if (esSalto(ult, p)) {
            // Dos seguidos lejos y coherentes entre si: el raro era el anterior
            if (pendiente && !esSalto(pendiente, p)) { salida.push(pendiente, p); pendiente = null; }
            else pendiente = p;
            continue;
        }
        pendiente = null;
        if (distanciaMetros(ult, p) >= ESPACIO_MINIMO_M) salida.push(p);
    }
    // El ultimo punto siempre va (es donde termino), si no es un rebote
    const ultimo = ordenados[ordenados.length - 1];
    const ult = salida[salida.length - 1];
    if (ultimo && ult && ultimo !== ult && !esSalto(ult, ultimo) && distanciaMetros(ult, ultimo) > 5) salida.push(ultimo);
    return salida;
}

/** Paso 2: donde hubo un hueco, se corta. */
export function cortarEnTramos(puntos: PuntoGps[]): PuntoGps[][] {
    const tramos: PuntoGps[][] = [];
    let actual: PuntoGps[] = [];
    for (const p of puntos) {
        const ult = actual[actual.length - 1];
        if (ult) {
            const min = (p.t.getTime() - ult.t.getTime()) / 60000;
            const m = distanciaMetros(ult, p);
            if ((min > HUECO_MIN && m > HUECO_M) || m > 1000) {
                tramos.push(actual);
                actual = [];
            }
        }
        actual.push(p);
    }
    if (actual.length) tramos.push(actual);
    return tramos;
}

/** De a 100 puntos, y cada ventana empieza donde termino la anterior (asi
 *  las partes pegadas quedan unidas). */
export function ventanas<T>(lista: T[], tam = PUNTOS_POR_MATCHING): T[][] {
    if (lista.length <= tam) return [lista];
    const salida: T[][] = [];
    for (let i = 0; i < lista.length - 1; i += tam - 1) salida.push(lista.slice(i, i + tam));
    return salida;
}

/** Devuelve el tramo pegado a las calles, en uno o mas pedazos (Mapbox lo
 *  parte cuando pierde la calle un momento), o null si no pudo. */
export type FnPegar = (puntos: PuntoGps[]) => Promise<Coord[][] | null>;
export type FnCamino = (a: PuntoGps, b: PuntoGps) => Promise<Coord[] | null>;

function largoKm(coords: Coord[]): number {
    let m = 0;
    for (let i = 1; i < coords.length; i++) {
        m += distanciaMetros({ lat: coords[i - 1][1], lng: coords[i - 1][0] }, { lat: coords[i][1], lng: coords[i][0] });
    }
    return m / 1000;
}

function unir(destino: Coord[], mas: Coord[]) {
    for (const c of mas) {
        const u = destino[destino.length - 1];
        if (u && u[0] === c[0] && u[1] === c[1]) continue;
        destino.push(c);
    }
}

/** Pasos 3 y 4. */
export async function armarRecorrido(puntos: PuntoGps[], pegar: FnPegar, camino: FnCamino): Promise<Recorrido> {
    const partes = cortarEnTramos(puntos);
    const tramos: Tramo[] = [];
    let pedidos = 0;
    const agregar = (tipo: Tramo['tipo'], coords: Coord[]) => {
        if (coords.length < 2) return;
        const ult = tramos[tramos.length - 1];
        if (ult && ult.tipo === tipo) unir(ult.coords, coords);
        else tramos.push({ tipo, coords: [...coords] });
    };

    for (let i = 0; i < partes.length; i++) {
        const parte = partes[i];
        // El hueco antes de esta parte
        if (i > 0) {
            const a = partes[i - 1][partes[i - 1].length - 1], b = parte[0];
            let c: Coord[] | null = null;
            if (distanciaMetros(a, b) > 150) { pedidos++; c = await camino(a, b); }
            agregar('estimado', c && c.length >= 2 ? c : [[a.lng, a.lat], [b.lng, b.lat]]);
        }
        if (parte.length < 2) continue;
        for (const v of ventanas(parte)) {
            pedidos++;
            const pedazos = (await pegar(v) || []).filter((x) => x.length >= 2);
            if (!pedazos.length) { agregar('crudo', v.map((p) => [p.lng, p.lat] as Coord)); continue; }
            for (let k = 0; k < pedazos.length; k++) {
                // Entre dos pedazos no va una recta (seria la diagonal que se
                // quiere evitar): el camino por calles, como estimado
                if (k > 0) {
                    const fin = pedazos[k - 1][pedazos[k - 1].length - 1], ini = pedazos[k][0];
                    const a: PuntoGps = { lng: fin[0], lat: fin[1], t: v[0].t }, b: PuntoGps = { lng: ini[0], lat: ini[1], t: v[0].t };
                    if (distanciaMetros(a, b) > 150) {
                        pedidos++;
                        const c = await camino(a, b);
                        agregar('estimado', c && c.length >= 2 ? c : [fin, ini]);
                    }
                }
                agregar('real', pedazos[k]);
            }
        }
    }
    const km = tramos.filter((t) => t.tipo !== 'estimado').reduce((a, t) => a + largoKm(t.coords), 0);
    return { tramos, km: Math.round(km * 10) / 10, puntos: puntos.length, pedidos };
}
