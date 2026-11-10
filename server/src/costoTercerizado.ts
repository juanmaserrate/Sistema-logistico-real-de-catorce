/* ============================================================================
 * COSTO DEL TERCERIZADO QUE HACE MAS DE UN VIAJE EN EL DIA
 * ============================================================================
 * Al tercerizado se le paga por DIA trabajado, no por viaje: la tarifa queda
 * cargada en su primer viaje del dia y los demas van en $0 (ver
 * aplicarTarifasAViajes en index.ts). Para pagar esta bien, pero para saber
 * cuanto le cuesta cada unidad de negocio no: toda la plata del dia caia en la
 * unidad del primer viaje, aunque el chofer haya pasado mas horas en otra.
 *
 * Pedido de noviembre de 2026: cuando el mismo tercerizado hace dos o mas
 * viajes en el dia, el costo del dia se reparte entre esos viajes segun las
 * horas de cada uno. Despues, dentro de cada viaje, sus horas ya se reparten
 * entre sus unidades (repartirHoras), asi que el costo llega a cada unidad en
 * funcion de las horas que trabajo para ella.
 *
 * No toca lo que se le paga a nadie: Trip.value queda igual y la Planilla de
 * Pagos sigue mostrando la tarifa en el primer viaje. Esto es solo para los
 * numeros por unidad (el Excel y el cuadro de costo por unidad). La suma del
 * dia no cambia: se reparte, no se agrega ni se pierde nada.
 *
 * Un viaje que el operador marco como "paga aparte" se cobra por separado, asi
 * que queda afuera del reparto con su propio valor.
 * ========================================================================= */

export interface ViajeParaCostoDelDia {
    id: number;
    fecha: Date | string | null | undefined;
    chofer: string | null | undefined;
    tercerizado: boolean;
    /** Lo que tiene cargado hoy (la tarifa del dia, o 0). */
    valor: number;
    /** Duracion del viaje en horas; 0 si no tiene horario. */
    horas: number;
    /** Observaciones y notas, para ver si dice "paga aparte". */
    texto?: string | null;
}

const ZONA = 'America/Argentina/Buenos_Aires';

/** Mismo criterio que aplicarTarifasAViajes para la excepcion. */
export function pagaAparte(texto: string | null | undefined): boolean {
    return /PAGA\s+(APARTE|TAMBIEN)|SE\s+PAGA\s+APARTE/i.test(String(texto || ''));
}

function diaDe(fecha: Date | string | null | undefined): string | null {
    if (!fecha) return null;
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-CA', { timeZone: ZONA });
}

function choferDe(nombre: string | null | undefined): string {
    return String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * El costo repartido por horas de los viajes tercerizados que comparten dia y
 * chofer. Devuelve solo los viajes que cambian (los de un grupo de dos o mas);
 * para el resto vale su valor cargado.
 *
 * Si ninguno de los viajes del grupo tiene horas todavia, el costo se divide en
 * partes iguales: es lo unico honesto que se puede decir sin horario.
 */
export function costoTercerizadoPorHoras(viajes: ViajeParaCostoDelDia[]): Map<number, number> {
    const grupos = new Map<string, ViajeParaCostoDelDia[]>();
    const vistos = new Set<number>();
    for (const v of viajes) {
        if (!v || !v.tercerizado || vistos.has(v.id)) continue;
        vistos.add(v.id);
        if (pagaAparte(v.texto)) continue;
        const chofer = choferDe(v.chofer);
        const dia = diaDe(v.fecha);
        if (!chofer || !dia) continue;
        const k = dia + '|' + chofer;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k)!.push(v);
    }

    const salida = new Map<number, number>();
    for (const grupo of grupos.values()) {
        if (grupo.length < 2) continue;
        const total = grupo.reduce((a, v) => a + (Number(v.valor) > 0 ? Number(v.valor) : 0), 0);
        if (!(total > 0)) continue;
        const horas = grupo.map((v) => (Number.isFinite(v.horas) && v.horas > 0 ? v.horas : 0));
        const totalHoras = horas.reduce((a, b) => a + b, 0);
        // Redondeado a centavos, y el ultimo se lleva lo que sobra: asi la
        // suma da exacto el costo del dia.
        let repartido = 0;
        grupo.forEach((v, i) => {
            const parte = totalHoras > 0 ? horas[i] / totalHoras : 1 / grupo.length;
            const monto = i === grupo.length - 1
                ? Math.round((total - repartido) * 100) / 100
                : Math.round(total * parte * 100) / 100;
            repartido += monto;
            salida.set(v.id, monto);
        });
    }
    return salida;
}
