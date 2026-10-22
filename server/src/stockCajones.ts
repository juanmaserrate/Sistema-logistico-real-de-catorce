/* ============================================================================
 * STOCK DE CAJONES
 * ============================================================================
 * Cuantos cajones hay en el deposito, de cada tipo, y a donde se fueron.
 *
 * COMO SE LLEVA LA CUENTA: no hay un numero guardado en ningun lado que diga
 * "quedan 480 Peco". Hay una lista de movimientos, y el stock es la suma.
 *
 *     stock de un tipo = SUMA de `cantidad` de todos sus movimientos
 *     positivo = entra al deposito     negativo = sale
 *
 * Se hace asi y no con un contador porque un contador no sabe explicarse. Con
 * la lista, cualquier numero se puede desarmar: de donde salio, que dia, en que
 * viaje y quien lo cargo.
 *
 * EL INVENTARIO tampoco pisa el numero a lo bruto. Cuando se cuenta a mano y
 * dan 462 donde el sistema decia 480, se guarda un movimiento de -18 con el
 * conteo al lado. El stock pasa a ser 462 igual, pero queda escrito que la
 * diferencia fue de 18 y cuando aparecio.
 *
 * LO QUE SALE Y LO QUE VUELVE de cada reparto son dos movimientos atados al
 * viaje: la salida en negativo, la vuelta en positivo. La resta de los dos es
 * lo que quedo afuera.
 * ========================================================================= */

import { TIPOS_DE_ENVASE } from './reporteTorre';

type Prisma = any;

/** Por que se movieron los cajones. */
export const MOTIVOS = ['INVENTARIO', 'SALIDA', 'RETORNO', 'COMPRA', 'BAJA', 'AJUSTE'] as const;
export type Motivo = (typeof MOTIVOS)[number];

/** Los que RESTAN del deposito cuando el numero cargado es positivo. */
const SALEN: Motivo[] = ['SALIDA', 'BAJA'];

export interface TipoDeCajon {
    id: number;
    key: string;
    name: string;
    orden: number;
    activo: boolean;
}

/** Un numero entero, o null si lo que vino no es un numero. */
export function entero(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : null;
}

/** El signo que le corresponde a un movimiento segun su motivo.
 *  SALIDA y BAJA restan; RETORNO y COMPRA suman. INVENTARIO y AJUSTE vienen
 *  con su propio signo porque pueden ir para cualquier lado. */
export function signoDelMotivo(motivo: string): 1 | -1 {
    return SALEN.includes(String(motivo).toUpperCase() as Motivo) ? -1 : 1;
}

/** La correccion que deja el inventario: lo contado menos lo que decia el
 *  sistema. Positivo = aparecieron cajones; negativo = faltan. */
export function diferenciaDeInventario(stockDelSistema: number, contado: number): number {
    return (Number(contado) || 0) - (Number(stockDelSistema) || 0);
}

/** Normaliza el nombre de un tipo nuevo a una clave usable. */
export function claveDeNombre(nombre: string): string {
    return String(nombre ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        .slice(0, 40);
}

/**
 * Los tipos de cajon. La primera vez siembra los cinco que ya usa la app del
 * chofer, para que el modulo arranque hablando el mismo idioma que el resto
 * del sistema y no haya que cargarlos a mano.
 */
export async function asegurarTipos(prisma: Prisma): Promise<TipoDeCajon[]> {
    const hay = await prisma.crateType.count();
    if (hay === 0) {
        let orden = 0;
        for (const t of TIPOS_DE_ENVASE) {
            await prisma.crateType.create({
                data: { key: t.clave, name: t.nombre, orden: orden++ }
            });
        }
    }
    return prisma.crateType.findMany({ orderBy: [{ orden: 'asc' }, { name: 'asc' }] });
}

/** typeId -> suma de sus movimientos (filtrando por motivo si se pide). */
async function sumarPorTipo(prisma: Prisma, where: any = {}): Promise<Map<number, number>> {
    const filas = await prisma.crateMovement.groupBy({
        by: ['typeId'],
        where,
        _sum: { cantidad: true }
    });
    return new Map(filas.map((f: any) => [f.typeId, Number(f._sum?.cantidad) || 0]));
}

export interface StockDeUnTipo extends TipoDeCajon {
    /** Lo que hay en el deposito segun los movimientos. */
    stock: number;
    /** Lo que salio en viajes y todavia no volvio. */
    enLaCalle: number;
    /** stock + enLaCalle: el total de cajones de ese tipo que existen. */
    total: number;
    /** Cuando se conto por ultima vez y que diferencia dio. */
    ultimoInventario: { fecha: string; contado: number; diferencia: number } | null;
}

/** La foto completa: cada tipo con su stock, lo que tiene afuera y el ultimo
 *  conteo. Es lo que mira el operador. */
export async function fotoDelStock(prisma: Prisma): Promise<StockDeUnTipo[]> {
    const tipos = await asegurarTipos(prisma);

    const deposito = await sumarPorTipo(prisma);
    // Lo que esta afuera: las salidas (negativas) y los retornos (positivos) de
    // los viajes. Se da vuelta el signo porque "afuera" es lo que falta.
    const viajes = await sumarPorTipo(prisma, { motivo: { in: ['SALIDA', 'RETORNO'] } });

    // El ultimo inventario de cada tipo, uno por uno: son pocos tipos.
    const ultimos = new Map<number, any>();
    for (const t of tipos) {
        const m = await prisma.crateMovement.findFirst({
            where: { typeId: t.id, motivo: 'INVENTARIO' },
            orderBy: [{ fecha: 'desc' }, { id: 'desc' }]
        });
        if (m) ultimos.set(t.id, m);
    }

    return tipos.map((t: TipoDeCajon) => {
        const stock = deposito.get(t.id) || 0;
        const enLaCalle = -(viajes.get(t.id) || 0);
        const inv = ultimos.get(t.id);
        return {
            id: t.id, key: t.key, name: t.name, orden: t.orden, activo: t.activo,
            stock,
            enLaCalle,
            total: stock + enLaCalle,
            ultimoInventario: inv
                ? {
                    fecha: new Date(inv.fecha).toISOString(),
                    contado: Number(inv.contado) || 0,
                    diferencia: Number(inv.cantidad) || 0
                }
                : null
        };
    });
}

/** key -> stock actual. Lo usa el inventario para calcular la diferencia. */
export async function stockPorClave(prisma: Prisma): Promise<Map<string, number>> {
    const foto = await fotoDelStock(prisma);
    return new Map(foto.map((t) => [t.key, t.stock]));
}

export interface ItemContado { key: string; contado: any }

/**
 * Guarda un inventario fisico. Por cada tipo contado deja un movimiento con la
 * diferencia contra lo que decia el sistema; el conteo queda al lado.
 *
 * Se guarda tambien cuando la diferencia da cero: que el conteo haya cerrado es
 * un dato, y sin el registro no hay forma de saber que ese dia se conto.
 */
export async function aplicarInventario(
    prisma: Prisma,
    items: ItemContado[],
    usuario: string | null,
    nota: string | null,
    fecha?: Date
): Promise<Array<{ key: string; nombre: string; antes: number; contado: number; diferencia: number }>> {
    const tipos = await asegurarTipos(prisma);
    const porClave = new Map(tipos.map((t: TipoDeCajon) => [t.key, t]));
    const stock = await stockPorClave(prisma);
    const cuando = fecha || new Date();

    const hechos: any[] = [];
    for (const it of items || []) {
        const tipo: any = porClave.get(String(it?.key || '').trim());
        const contado = entero(it?.contado);
        if (!tipo || contado === null || contado < 0) continue;
        const antes = stock.get(tipo.key) || 0;
        const diferencia = diferenciaDeInventario(antes, contado);
        await prisma.crateMovement.create({
            data: {
                typeId: tipo.id, motivo: 'INVENTARIO', cantidad: diferencia,
                contado, usuario, nota, fecha: cuando
            }
        });
        hechos.push({ key: tipo.key, nombre: tipo.name, antes, contado, diferencia });
    }
    return hechos;
}

export interface ItemCantidad { key: string; cantidad: any }

/**
 * Lo que SALIO o lo que VOLVIO en un viaje.
 *
 * Reemplaza lo que hubiera cargado antes para ese viaje y esa clase: si el
 * operador se equivoco y lo vuelve a cargar, se corrige, no se suma dos veces.
 * Cargar todo en cero borra la carga.
 */
export async function guardarCajonesDelViaje(
    prisma: Prisma,
    tripId: number,
    clase: 'SALIDA' | 'RETORNO',
    items: ItemCantidad[],
    usuario: string | null,
    nota: string | null,
    fecha?: Date
): Promise<{ lineas: number; total: number }> {
    const tipos = await asegurarTipos(prisma);
    const porClave = new Map(tipos.map((t: TipoDeCajon) => [t.key, t]));
    const signo = signoDelMotivo(clase);
    const cuando = fecha || new Date();

    await prisma.crateMovement.deleteMany({ where: { tripId, motivo: clase } });

    const data: any[] = [];
    let total = 0;
    for (const it of items || []) {
        const tipo: any = porClave.get(String(it?.key || '').trim());
        const n = entero(it?.cantidad);
        if (!tipo || n === null || n <= 0) continue;
        data.push({
            typeId: tipo.id, motivo: clase, cantidad: signo * n,
            tripId, usuario, nota, fecha: cuando
        });
        total += n;
    }
    if (data.length) await prisma.crateMovement.createMany({ data });
    return { lineas: data.length, total };
}

export interface CajonesDeUnViaje {
    salida: Record<string, number>;
    retorno: Record<string, number>;
    totalSalida: number;
    totalRetorno: number;
    /** Lo que se llevo y no volvio. */
    sinVolver: number;
    cargadoSalida: boolean;
    cargadoRetorno: boolean;
}

export function vacioDeUnViaje(): CajonesDeUnViaje {
    return {
        salida: {}, retorno: {}, totalSalida: 0, totalRetorno: 0,
        sinVolver: 0, cargadoSalida: false, cargadoRetorno: false
    };
}

/** Arma lo cargado de cada viaje a partir de sus movimientos. */
export function agruparPorViaje(
    movimientos: Array<{ tripId: number | null; motivo: string; cantidad: number; type?: { key?: string } | null }>,
    claveDeTipo?: Map<number, string>
): Map<number, CajonesDeUnViaje> {
    const salida = new Map<number, CajonesDeUnViaje>();
    for (const m of movimientos) {
        if (m.tripId == null) continue;
        const motivo = String(m.motivo).toUpperCase();
        if (motivo !== 'SALIDA' && motivo !== 'RETORNO') continue;
        const key = m.type?.key || claveDeTipo?.get((m as any).typeId) || '';
        if (!key) continue;
        const v = salida.get(m.tripId) || vacioDeUnViaje();
        const n = Math.abs(Number(m.cantidad) || 0);
        if (motivo === 'SALIDA') {
            v.salida[key] = (v.salida[key] || 0) + n;
            v.totalSalida += n;
            v.cargadoSalida = true;
        } else {
            v.retorno[key] = (v.retorno[key] || 0) + n;
            v.totalRetorno += n;
            v.cargadoRetorno = true;
        }
        v.sinVolver = v.totalSalida - v.totalRetorno;
        salida.set(m.tripId, v);
    }
    return salida;
}
