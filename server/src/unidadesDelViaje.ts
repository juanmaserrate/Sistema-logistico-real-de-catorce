/* ============================================================================
 * LAS UNIDADES DE NEGOCIO DE UN VIAJE
 * ============================================================================
 * Un viaje puede repartir para varias unidades en el mismo recorrido: hace R16
 * (SAE LANUS) y despues SAM 1 LUNES R16 (SAM). Hasta ahora el viaje guardaba
 * las dos unidades juntas en un campo de texto y nadie sabia cuanto le tocaba
 * a cada una.
 *
 * Aca se contesta eso:
 *   - de que unidad es cada parada  (sale de la ruta de la parada)
 *   - cuantas horas le corresponden a cada unidad
 *
 * REGLA DE LAS HORAS: las horas de las unidades SUMAN la duracion del viaje,
 * no la repiten. Un viaje de 8 h que hace 5 h de SAE LANUS y 3 h de SAM da
 * 5 + 3, no 8 + 8. Es la unica forma de que el Motor de Costos siga cerrando:
 * el valor hora se calcula dividiendo el costo por las horas REALES, asi que
 * contar 16 h donde hubo 8 lo partiria al medio.
 *
 * COMO SE REPARTEN: parada por parada, no por bloque. En general el chofer
 * hace toda una ruta y despues la otra, pero puede intercalar una parada si le
 * queda de paso. Si se repartiera por bloques, esa parada intercalada le
 * sumaria sus horas a la unidad equivocada.
 * ========================================================================= */

/** Una parada, con lo minimo que hace falta para repartir las horas. */
export interface ParadaParaReparto {
    sequence: number;
    /** true = es la vuelta al deposito. Ver `esVueltaAlDeposito`. */
    isReturnToBase?: boolean | null;
    client?: { name?: string | null } | null;
    /** De que ruta del viaje es ("R16"). null = viaje de una sola ruta. */
    ruta?: string | null;
    actualArrival?: Date | string | null;
    actualDeparture?: Date | string | null;
}

/** Un tramo del viaje: una ruta con su hora de inicio y de cierre. Es lo que
 *  cierra el chofer desde el telefono y lo que muestra el TMS. */
export interface TramoParaReparto {
    /** "R6", o "VUELTA AL DEPOSITO" para el ultimo. */
    ruta?: string | null;
    inicio?: Date | string | null;
    fin?: Date | string | null;
}

export interface ViajeParaReparto {
    businessUnit?: string | null;
    stops: ParadaParaReparto[];
    /** Los tramos cerrados, si los hay. Cuando estan completos mandan ellos. */
    tramos?: TramoParaReparto[] | null;
    /** Momento en que arranco (fichaje, GPS o salida del deposito). */
    inicio?: Date | string | null;
    /** Momento en que termino. */
    fin?: Date | string | null;
}

export const SIN_UNIDAD = 'SIN UNIDAD';

/** La vuelta al deposito no es de ninguna unidad: el chofer vuelve una sola
 *  vez, haya repartido para una o para tres. Su tiempo se prorratea entre
 *  todas, no se le carga a la ultima que toco. */
export function esVueltaAlDeposito(p: ParadaParaReparto): boolean {
    if (p?.isReturnToBase) return true;
    const n = String(p?.client?.name ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    return /^(REAL\s*(DE\s*)?(14|CATORCE)|DEPOSITO|R\s*14)\b/.test(n);
}

function aFecha(v: Date | string | null | undefined): Date | null {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function norm(s: any): string {
    return String(s ?? '').trim().toUpperCase();
}

/** "SAE LANUS, SAM" -> ["SAE LANUS", "SAM"], sin repetidas y sin vacias. */
export function unidadesDeTexto(valor: any): string[] {
    const vistas = new Set<string>();
    const salida: string[] = [];
    for (const parte of String(valor ?? '').split(',')) {
        const u = norm(parte);
        if (u && !vistas.has(u)) { vistas.add(u); salida.push(u); }
    }
    return salida;
}

/**
 * De que unidad es cada parada.
 *
 * La parada sabe de que ruta vino (Stop.ruta) y la ruta sabe su unidad
 * (RouteTemplate.businessUnit). Cuando no se puede saber -- un viaje de una
 * sola ruta no le pone `ruta` a sus paradas, que es el caso de siempre -- la
 * parada es de la unica unidad del viaje. Si el viaje tiene varias y la parada
 * no dice de cual es, queda en SIN UNIDAD: inventarle una seria peor, porque
 * esas horas terminan en el costo de alguien.
 */
export function unidadDeParada(
    parada: ParadaParaReparto,
    unidadPorRuta: Map<string, string>,
    unidadesDelViaje: string[]
): string {
    return unidadDeRuta(parada?.ruta, unidadPorRuta, unidadesDelViaje);
}

/** De que unidad es una ruta. Lo usan las paradas y los tramos, que dicen la
 *  ruta de la misma forma. */
export function unidadDeRuta(
    rutaCruda: any,
    unidadPorRuta: Map<string, string>,
    unidadesDelViaje: string[]
): string {
    const ruta = norm(rutaCruda);
    if (ruta) {
        const u = unidadPorRuta.get(ruta);
        if (u) return u;
        // La ruta puede traer directamente el nombre de la unidad en vez del de
        // una ruta. Pasa con los trabajos que NO son una ruta: un retiro, un
        // evento. No tienen plantilla, asi que no hay ruta que ponerles, pero
        // igual hay que poder decir de quien son.
        const comoUnidad = unidadesDelViaje.find((x) => x === ruta);
        if (comoUnidad) return comoUnidad;
    }
    if (unidadesDelViaje.length === 1) return unidadesDelViaje[0];
    return SIN_UNIDAD;
}

export interface RepartoDeHoras {
    /** Unidad -> horas que le tocan. Suman `total`. */
    horas: Record<string, number>;
    /** Unidad -> cuantas paradas tuvo. */
    paradas: Record<string, number>;
    /** La duracion del viaje entero, en horas. */
    total: number;
    /** Como se repartio, para poder explicarlo. */
    metodo: 'por los tramos del chofer' | 'por horario de cada parada' | 'por cantidad de paradas' | 'una sola unidad' | 'sin datos';
}

/**
 * Reparte la duracion del viaje entre sus unidades.
 *
 * Con horarios de parada: se recorre la linea de tiempo del viaje y cada tramo
 * (desde donde quedo el anterior hasta que se cerro esta parada) va a la unidad
 * de esa parada. La vuelta al deposito no es de nadie en particular, asi que se
 * reparte entre todas en la misma proporcion; de esa forma las horas siguen
 * sumando exactamente la duracion del viaje.
 *
 * Sin horarios: se reparte por cantidad de paradas, que es lo mas honesto que
 * se puede decir con lo que hay.
 */
export function repartirHoras(
    viaje: ViajeParaReparto,
    unidadPorRuta: Map<string, string>,
    duracionHoras: number
): RepartoDeHoras {
    const unidades = unidadesDeTexto(viaje.businessUnit);
    const total = Number.isFinite(duracionHoras) && duracionHoras > 0 ? duracionHoras : 0;
    const horas: Record<string, number> = {};
    const paradas: Record<string, number> = {};

    const stops = [...(viaje.stops || [])];
    for (const p of stops) {
        if (esVueltaAlDeposito(p)) continue;        // no es de nadie
        const u = unidadDeParada(p, unidadPorRuta, unidades);
        paradas[u] = (paradas[u] || 0) + 1;
    }

    // Una sola unidad: se lleva todo. Es la enorme mayoria de los viajes y
    // tiene que dar exactamente lo mismo que antes de todo esto.
    if (unidades.length <= 1) {
        const u = unidades[0] || SIN_UNIDAD;
        return { horas: total ? { [u]: total } : {}, paradas, total, metodo: 'una sola unidad' };
    }
    if (!total) {
        return { horas: {}, paradas, total: 0, metodo: 'sin datos' };
    }

    const inicio = aFecha(viaje.inicio);
    const fin = aFecha(viaje.fin);

    // ── Camino bueno: el chofer cerro los tramos ──
    // Es lo que muestra el TMS, y es el unico dato en que alguien dijo
    // explicitamente "hasta aca fue esta ruta". Cortar por la hora de la ultima
    // parada le regala a la unidad siguiente todo el rato en que el chofer
    // venia manejando sin cerrar nada.
    const porTramos = horasDeLosTramos(viaje.tramos, unidadPorRuta, unidades, paradas);
    if (porTramos) {
        const repartido = Object.values(porTramos).reduce((a, b) => a + b, 0);
        if (repartido > 0) {
            // Lo que sobra (la vuelta al deposito, y cualquier hueco entre
            // tramos) se reparte en la misma proporcion, para que la suma de
            // exacta la duracion del viaje.
            const factor = total / repartido;
            for (const u of Object.keys(porTramos)) horas[u] = porTramos[u] * factor;
            return { horas, paradas, total, metodo: 'por los tramos del chofer' };
        }
    }

    // ── Camino de respaldo: hay horarios de parada ──
    // La vuelta al deposito se saca del recorrido a proposito: su tramo pasa a
    // ser parte de lo que sobra, y lo que sobra se reparte en proporcion. Si se
    // dejara, ese tiempo se le cargaria entero a nadie (la parada del deposito
    // no es de ninguna unidad) y terminaba en SIN UNIDAD.
    const conHorario = stops
        .filter((p) => !esVueltaAlDeposito(p))
        .map((p) => ({ p, cierre: aFecha(p.actualDeparture) || aFecha(p.actualArrival) }))
        .filter((x) => x.cierre !== null) as Array<{ p: ParadaParaReparto; cierre: Date }>;

    if (inicio && fin && conHorario.length >= 2 && fin.getTime() > inicio.getTime()) {
        conHorario.sort((a, b) => a.cierre.getTime() - b.cierre.getTime());
        const crudas: Record<string, number> = {};
        let cursor = inicio.getTime();
        let repartido = 0;
        for (const { p, cierre } of conHorario) {
            const t = cierre.getTime();
            // Una parada cerrada antes del arranque, o despues del cierre del
            // viaje, es un horario mal cargado: no mueve el cursor hacia atras.
            if (t <= cursor || t > fin.getTime()) continue;
            const u = unidadDeParada(p, unidadPorRuta, unidades);
            const trozo = (t - cursor) / 3600000;
            crudas[u] = (crudas[u] || 0) + trozo;
            repartido += trozo;
            cursor = t;
        }
        if (repartido > 0) {
            // Lo que sobra (la vuelta al deposito y lo que no se pudo ubicar)
            // se reparte en la misma proporcion, para que la suma de exacta.
            const factor = total / repartido;
            for (const u of Object.keys(crudas)) horas[u] = crudas[u] * factor;
            return { horas, paradas, total, metodo: 'por horario de cada parada' };
        }
    }

    // ── Camino de respaldo: por cantidad de paradas ──
    const totalParadas = Object.values(paradas).reduce((a, b) => a + b, 0);
    if (totalParadas > 0) {
        for (const u of Object.keys(paradas)) horas[u] = total * (paradas[u] / totalParadas);
        return { horas, paradas, total, metodo: 'por cantidad de paradas' };
    }

    // Sin paradas: se divide en partes iguales entre las unidades del viaje.
    for (const u of unidades) horas[u] = total / unidades.length;
    return { horas, paradas, total, metodo: 'por cantidad de paradas' };
}

/** Las horas de cada unidad segun los tramos, o null si los tramos no
 *  alcanzan para repartir.
 *
 *  Se exige que CADA unidad del viaje tenga su tramo y que ese tramo sea
 *  creible: al menos un minuto por parada suya. Pasa seguido que el chofer
 *  cierre dos tramos en el mismo segundo; entonces el tramo dice 0:00 y usarlo
 *  dejaria a esa unidad sin horas, con sus paradas adentro, y sus horas (y su
 *  costo) se las llevaria otra. En ese caso manda el horario de las paradas,
 *  que es lo que de verdad paso. */
function horasDeLosTramos(
    tramos: TramoParaReparto[] | null | undefined,
    unidadPorRuta: Map<string, string>,
    unidades: string[],
    paradasPorUnidad: Record<string, number>
): Record<string, number> | null {
    const utiles = (tramos || []).filter((t) => aFecha(t?.inicio) && aFecha(t?.fin));
    if (utiles.length < 2) return null;

    const crudas: Record<string, number> = {};
    for (const t of utiles) {
        const ruta = norm(t?.ruta);
        // La vuelta al deposito no es de ninguna unidad, igual que su parada.
        if (!ruta || ruta === 'VUELTA AL DEPOSITO' || ruta === 'VUELTA_AL_DEPOSITO') continue;
        const u = unidadDeRuta(ruta, unidadPorRuta, unidades);
        if (u === SIN_UNIDAD) return null;   // un tramo que no se sabe de quien es
        const horas = (aFecha(t.fin)!.getTime() - aFecha(t.inicio)!.getTime()) / 3600000;
        if (horas <= 0) continue;
        crudas[u] = (crudas[u] || 0) + horas;
    }
    // Todas las unidades del viaje tienen que estar, y con un tiempo creible.
    const MINIMO_POR_PARADA = 1 / 60;   // un minuto
    for (const u of unidades) {
        const minimo = Math.max(MINIMO_POR_PARADA, (paradasPorUnidad[u] || 0) * MINIMO_POR_PARADA);
        if (!(crudas[u] >= minimo)) return null;
    }
    return crudas;
}

/** El mapa ruta -> unidad, leido una sola vez por reporte. */
export async function mapaUnidadPorRuta(prisma: any): Promise<Map<string, string>> {
    const plantillas = await prisma.routeTemplate.findMany({
        select: { name: true, businessUnit: true }
    });
    const m = new Map<string, string>();
    for (const t of plantillas) {
        const u = norm(t?.businessUnit);
        if (u) m.set(norm(t.name), u);
    }
    return m;
}
