/**
 * Horas estimadas para las paradas de un viaje que se cerro sin marcarlas.
 *
 * Pasa con los viajes LIBRE cargados a mano y con choferes que no marcaron:
 * el viaje figura finalizado, con salida y llegada, pero sus paradas no
 * tienen hora. Entonces el desglose del viaje no muestra horarios y las
 * horas por unidad de negocio no se pueden repartir por lo que paso.
 *
 * Que se completa:
 *  - Las paradas ENTREGADAS sin hora (siempre).
 *  - Las paradas pendientes, solo si el viaje no tiene NINGUNA parada marcada:
 *    el viaje se cerro entero sin marcar, asi que se toman como hechas. Si el
 *    chofer marco otras y esta no, puede que no haya ido: no se inventa.
 *
 * De donde sale la hora:
 *  1. Del GPS del recorrido: cuando el camion estuvo parado cerca del lugar.
 *  2. Si no hay GPS: se reparte la duracion del viaje en partes iguales, en el
 *     orden de las paradas, respetando las que si tienen hora.
 */

export interface ParadaParaEstimar {
    id: number;
    sequence: number;
    status: string | null;
    llegada: Date | null;
    salida: Date | null;
    deposito: boolean;
    lat?: number | null;
    lng?: number | null;
}

export interface PuntoGps { lat: number; lng: number; t: number }

export interface HoraEstimada {
    id: number;
    llegada: Date;
    salida: Date;
    como: 'GPS' | 'repartida';
    /** Estaba pendiente y pasa a entregada. */
    marcarEntregada: boolean;
}

export interface Estimacion {
    cambios: HoraEstimada[];
    /** Por que no se toco el viaje, si no se toco. */
    salteado?: string;
    /** Paradas pendientes que se dejaron asi (el chofer marco otras). */
    pendientesQueQuedan: number;
}

const MIN = 60000;
const MARCADA = new Set(['COMPLETED', 'UNDELIVERABLE', 'FAILED']);

const tieneHora = (p: ParadaParaEstimar) => !!(p.llegada || p.salida);
const estado = (p: ParadaParaEstimar) => String(p.status || 'PENDING').toUpperCase();

function distancia(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const r = Math.PI / 180;
    const x = (lng2 - lng1) * r * Math.cos(((lat1 + lat2) / 2) * r);
    const y = (lat2 - lat1) * r;
    return Math.sqrt(x * x + y * y) * 6371000;
}

/** La estadia mas larga del camion cerca del lugar, entre desde y hasta.
 *  Una pasada de largo (un solo punto, o menos de un minuto) no cuenta. */
export function estadiaGps(puntos: PuntoGps[], lat: number, lng: number, desde: number, hasta: number) {
    for (const radio of [120, 200]) {
        const visitas: { ini: number; fin: number }[] = [];
        let cur: { ini: number; fin: number } | null = null;
        for (const p of puntos) {
            if (p.t < desde || p.t > hasta) continue;
            if (distancia(p.lat, p.lng, lat, lng) <= radio) {
                if (!cur) cur = { ini: p.t, fin: p.t };
                cur.fin = p.t;
            } else if (cur) { visitas.push(cur); cur = null; }
        }
        if (cur) visitas.push(cur);
        const buenas = visitas.filter((v) => v.fin - v.ini >= MIN);
        if (buenas.length) {
            buenas.sort((a, b) => (b.fin - b.ini) - (a.fin - a.ini));
            return buenas[0];
        }
    }
    return null;
}

export function estimarHorasDeParadas(
    paradas: ParadaParaEstimar[],
    inicio: Date | null,
    fin: Date | null,
    gps: PuntoGps[] = []
): Estimacion {
    const reales = paradas.filter((p) => !p.deposito).sort((a, b) => a.sequence - b.sequence);
    const nadaMarcado = reales.every((p) => !tieneHora(p) && !MARCADA.has(estado(p)));
    const aCompletar = (p: ParadaParaEstimar) =>
        !tieneHora(p) && (estado(p) === 'COMPLETED' || (nadaMarcado && !MARCADA.has(estado(p))));
    const pendientesQueQuedan = reales.filter((p) => !tieneHora(p) && !aCompletar(p) && !MARCADA.has(estado(p))).length;

    if (!reales.some(aCompletar)) return { cambios: [], pendientesQueQuedan };
    if (!inicio || !fin) return { cambios: [], pendientesQueQuedan, salteado: 'no tiene hora de salida o de llegada' };
    const t0 = inicio.getTime(), t1 = fin.getTime();
    if (!(t1 - t0 >= 5 * MIN)) return { cambios: [], pendientesQueQuedan, salteado: 'el viaje dura menos de 5 minutos: falta la hora real de salida o de llegada' };

    // La linea de tiempo: las que ya tienen hora y las que hay que completar
    const linea = reales.filter((p) => tieneHora(p) || aCompletar(p)).map((p) => ({
        p,
        llegada: p.llegada ? p.llegada.getTime() : (p.salida ? p.salida.getTime() : null) as number | null,
        salida: p.salida ? p.salida.getTime() : (p.llegada ? p.llegada.getTime() : null) as number | null,
        como: null as HoraEstimada['como'] | null
    }));

    const antesDe = (i: number) => { for (let j = i - 1; j >= 0; j--) if (linea[j].salida != null) return linea[j].salida!; return t0; };
    const despuesDe = (i: number) => { for (let j = i + 1; j < linea.length; j++) if (linea[j].llegada != null) return linea[j].llegada!; return t1; };

    /** El hueco libre mas largo del viaje: entre la salida de una parada con
     *  hora y la llegada a la siguiente (o el arranque / el cierre). Se usa
     *  cuando las paradas con hora no siguen el orden de la lista y entonces
     *  "entre la anterior y la siguiente" no es un intervalo. */
    const mayorHueco = (): [number, number] => {
        const ocupado = linea.filter((x) => x.llegada != null)
            .map((x) => [x.llegada!, x.salida!] as [number, number])
            .sort((a, b) => a[0] - b[0]);
        let mejor: [number, number] = [t0, t1], largo = -1, cursor = t0;
        for (const [ll, sa] of [...ocupado, [t1, t1] as [number, number]]) {
            if (ll - cursor > largo) { largo = ll - cursor; mejor = [cursor, ll]; }
            cursor = Math.max(cursor, sa);
        }
        return mejor;
    };

    // 1. GPS, en orden: cada parada encontrada pasa a ser punto fijo de las siguientes
    if (gps.length) {
        const puntos = [...gps].sort((a, b) => a.t - b.t);
        linea.forEach((x, i) => {
            if (x.llegada != null || x.p.lat == null || x.p.lng == null) return;
            let desde = antesDe(i), hasta = despuesDe(i);
            if (hasta <= desde) { desde = t0; hasta = t1; }
            const e = estadiaGps(puntos, x.p.lat, x.p.lng, desde, hasta);
            if (e) { x.llegada = e.ini; x.salida = e.fin; x.como = 'GPS'; }
        });
    }

    // 2. Lo que queda: tramos iguales entre los puntos fijos. Con k paradas
    // entre dos puntos fijos hay k+1 viajes (el ultimo, hasta el siguiente
    // punto o la vuelta al deposito).
    for (let i = 0; i < linea.length; i++) {
        if (linea[i].llegada != null) continue;
        let j = i;
        while (j < linea.length && linea[j].llegada == null) j++;
        const k = j - i;
        let desde = antesDe(i), hasta = despuesDe(j - 1);
        // Las de alrededor estan fuera de orden (o pegadas): no hay lugar
        // entre ellas, se van al hueco mas grande del viaje.
        if (hasta - desde < k * 4 * MIN) [desde, hasta] = mayorHueco();
        const paso = Math.max(0, hasta - desde) / (k + 1);
        const espera = Math.min(10 * MIN, paso * 0.4);
        for (let n = 1; n <= k; n++) {
            const x = linea[i + n - 1];
            x.salida = Math.round(desde + paso * n);
            x.llegada = Math.round(x.salida - espera);
            x.como = 'repartida';
        }
        i = j - 1;
    }

    const cambios: HoraEstimada[] = linea.filter((x) => x.como).map((x) => ({
        id: x.p.id,
        llegada: new Date(x.llegada!),
        salida: new Date(x.salida!),
        como: x.como!,
        marcarEntregada: estado(x.p) !== 'COMPLETED'
    }));
    return { cambios, pendientesQueQuedan };
}
