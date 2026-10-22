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
 * EL CIRCUITO DE UN REPARTO, de principio a fin:
 *
 *   1. ENTRAN cajones al deposito            (COMPRA)
 *   2. SALEN con el reparto                  (SALIDA, en negativo)
 *   3. En la calle se entregan y se recuperan -- eso lo carga el chofer en la
 *      app, parada por parada, y vive aparte en el modulo Cajones
 *   4. VUELVEN al deposito                   (RETORNO, en positivo)
 *   5. Alguien los CUENTA y los confirma     -> recien ahi suman al stock
 *
 * EL PASO 5 NO ES UN TRAMITE. La vuelta se carga con lo que el reparto DICE
 * que trae (`declarado`) y queda pendiente. Cuando recepcion los cuenta, lo
 * contado pasa a ser `cantidad` y la vuelta se confirma. Los dos numeros
 * quedan guardados: si siempre vuelve menos de lo declarado, eso se ve.
 *
 * Mientras una vuelta esta sin confirmar, NO suma al stock. Esta en el muelle,
 * no en el deposito, y nadie todavia sabe cuantos son de verdad.
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

/** typeId -> suma de sus movimientos (filtrando por lo que se pida). */
async function sumarPorTipo(prisma: Prisma, where: any = {}): Promise<Map<number, number>> {
    const filas = await prisma.crateMovement.groupBy({
        by: ['typeId'],
        where,
        _sum: { cantidad: true }
    });
    return new Map(filas.map((f: any) => [f.typeId, Number(f._sum?.cantidad) || 0]));
}

export interface StockDeUnTipo extends TipoDeCajon {
    /** Lo que hay en el deposito: solo movimientos confirmados. */
    stock: number;
    /** Volvio pero nadie lo conto todavia. Esta en el muelle, no en el stock. */
    porConfirmar: number;
    /** Lo que salio en viajes y todavia no volvio. */
    enLaCalle: number;
    /** Todos los cajones de ese tipo que existen, esten donde esten. */
    total: number;
    /** Cuando se conto por ultima vez y que diferencia dio. */
    ultimoInventario: { fecha: string; contado: number; diferencia: number } | null;
}

/** La foto completa: cada tipo con su stock, lo que tiene afuera y el ultimo
 *  conteo. Es lo que mira el operador. */
export async function fotoDelStock(prisma: Prisma): Promise<StockDeUnTipo[]> {
    const tipos = await asegurarTipos(prisma);

    // El stock son los movimientos CONFIRMADOS. Una vuelta sin contar no entra:
    // esta en el muelle y todavia no se sabe cuantos son.
    const deposito = await sumarPorTipo(prisma, { confirmado: true });
    const enMuelle = await sumarPorTipo(prisma, { confirmado: false });
    // Lo que esta afuera: las salidas (negativas) y los retornos (positivos) de
    // los viajes. Se da vuelta el signo porque "afuera" es lo que falta.
    // La vuelta sin confirmar ya descuenta de "en la calle": fisicamente los
    // cajones volvieron, aunque todavia no esten contados.
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
        const porConfirmar = enMuelle.get(t.id) || 0;
        const enLaCalle = -(viajes.get(t.id) || 0);
        const inv = ultimos.get(t.id);
        return {
            id: t.id, key: t.key, name: t.name, orden: t.orden, activo: t.activo,
            stock,
            porConfirmar,
            enLaCalle,
            total: stock + porConfirmar + enLaCalle,
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
        // La vuelta nace PENDIENTE: lo que se carga es lo que el reparto dice
        // que trae. Suma al stock cuando alguien la cuenta y la confirma.
        const esVuelta = clase === 'RETORNO';
        data.push({
            typeId: tipo.id, motivo: clase, cantidad: signo * n,
            declarado: esVuelta ? n : null,
            confirmado: !esVuelta,
            tripId, usuario, nota, fecha: cuando
        });
        total += n;
    }
    if (data.length) await prisma.crateMovement.createMany({ data });
    return { lineas: data.length, total };
}

export interface CajonesDeUnViaje {
    /** Lo que salio, por tipo. */
    salida: Record<string, number>;
    /** Lo que volvio y YA se conto, por tipo. */
    retorno: Record<string, number>;
    /** Lo que el reparto DIJO que traia, por tipo. Igual a `retorno` una vez
     *  confirmado, distinto mientras la cuenta no cierre. */
    declarado: Record<string, number>;
    totalSalida: number;
    totalRetorno: number;
    totalDeclarado: number;
    /** Lo que se llevo y no volvio. */
    sinVolver: number;
    cargadoSalida: boolean;
    cargadoRetorno: boolean;
    /** La vuelta esta cargada pero nadie la conto todavia. */
    vueltaPendiente: boolean;
    /** Contado menos declarado. Negativo = volvieron menos de los que dijeron. */
    diferenciaVuelta: number;
    confirmadoPor: string | null;
    confirmadoAt: string | null;
}

export function vacioDeUnViaje(): CajonesDeUnViaje {
    return {
        salida: {}, retorno: {}, declarado: {},
        totalSalida: 0, totalRetorno: 0, totalDeclarado: 0,
        sinVolver: 0, cargadoSalida: false, cargadoRetorno: false,
        vueltaPendiente: false, diferenciaVuelta: 0,
        confirmadoPor: null, confirmadoAt: null
    };
}

interface MovimientoDeViaje {
    tripId: number | null;
    typeId?: number;
    motivo: string;
    cantidad: number;
    declarado?: number | null;
    confirmado?: boolean;
    confirmadoPor?: string | null;
    confirmadoAt?: Date | string | null;
    type?: { key?: string } | null;
}

/**
 * Arma lo cargado de cada viaje a partir de sus movimientos.
 *
 * `sinVolver` se calcula contra lo CONTADO, no contra lo declarado: lo que no
 * se conto no volvio, por mas que alguien lo haya anotado.
 */
export function agruparPorViaje(
    movimientos: MovimientoDeViaje[],
    claveDeTipo?: Map<number, string>
): Map<number, CajonesDeUnViaje> {
    const salida = new Map<number, CajonesDeUnViaje>();
    for (const m of movimientos) {
        if (m.tripId == null) continue;
        const motivo = String(m.motivo).toUpperCase();
        if (motivo !== 'SALIDA' && motivo !== 'RETORNO') continue;
        const key = m.type?.key || (m.typeId != null ? claveDeTipo?.get(m.typeId) : '') || '';
        if (!key) continue;

        const v = salida.get(m.tripId) || vacioDeUnViaje();
        const n = Math.abs(Number(m.cantidad) || 0);

        if (motivo === 'SALIDA') {
            v.salida[key] = (v.salida[key] || 0) + n;
            v.totalSalida += n;
            v.cargadoSalida = true;
        } else {
            const dicho = m.declarado == null ? n : Math.abs(Number(m.declarado) || 0);
            v.declarado[key] = (v.declarado[key] || 0) + dicho;
            v.totalDeclarado += dicho;
            v.cargadoRetorno = true;
            if (m.confirmado === false) {
                v.vueltaPendiente = true;
            } else {
                v.retorno[key] = (v.retorno[key] || 0) + n;
                v.totalRetorno += n;
                if (m.confirmadoPor) v.confirmadoPor = m.confirmadoPor;
                if (m.confirmadoAt) v.confirmadoAt = new Date(m.confirmadoAt).toISOString();
            }
        }
        v.sinVolver = v.totalSalida - v.totalRetorno;
        v.diferenciaVuelta = v.vueltaPendiente ? 0 : v.totalRetorno - v.totalDeclarado;
        salida.set(m.tripId, v);
    }
    return salida;
}

/**
 * Cuenta la vuelta de un viaje y la confirma: recien ahi suma al stock.
 *
 * `items` trae lo CONTADO de cada tipo. Lo que el reparto habia declarado no
 * se toca: queda guardado al lado para poder comparar.
 *
 * Un tipo que estaba declarado y no viene en el conteo se confirma en cero:
 * contaron y no habia ninguno. Uno que no estaba declarado y aparece en el
 * conteo se agrega, porque volvio igual.
 */
export async function confirmarVuelta(
    prisma: Prisma,
    tripId: number,
    items: ItemCantidad[],
    usuario: string | null,
    nota: string | null
): Promise<{ confirmados: number; total: number; declarado: number; diferencia: number }> {
    const tipos = await asegurarTipos(prisma);
    const porClave = new Map(tipos.map((t: TipoDeCajon) => [t.key, t]));
    const ahora = new Date();

    const pendientes = await prisma.crateMovement.findMany({
        where: { tripId, motivo: 'RETORNO' }
    });
    const porTipo = new Map<number, any>(pendientes.map((m: any) => [m.typeId, m]));

    const contado = new Map<number, number>();
    for (const it of items || []) {
        const tipo: any = porClave.get(String(it?.key || '').trim());
        const n = entero(it?.cantidad);
        if (!tipo || n === null || n < 0) continue;
        contado.set(tipo.id, n);
    }

    let total = 0;
    let declarado = 0;
    let confirmados = 0;
    const fecha = pendientes[0]?.fecha || ahora;

    // Los que ya estaban anotados: se les pone lo contado.
    for (const [typeId, mov] of porTipo) {
        const n = contado.has(typeId) ? (contado.get(typeId) as number) : 0;
        const dicho = mov.declarado == null ? Math.abs(Number(mov.cantidad) || 0) : Number(mov.declarado);
        await prisma.crateMovement.update({
            where: { id: mov.id },
            data: {
                cantidad: n, declarado: dicho, confirmado: true,
                confirmadoPor: usuario, confirmadoAt: ahora,
                nota: nota || mov.nota
            }
        });
        total += n;
        declarado += dicho;
        confirmados++;
    }

    // Los que aparecieron en el conteo sin estar anotados: volvieron igual.
    for (const [typeId, n] of contado) {
        if (porTipo.has(typeId) || n <= 0) continue;
        await prisma.crateMovement.create({
            data: {
                typeId, motivo: 'RETORNO', cantidad: n, declarado: 0,
                confirmado: true, confirmadoPor: usuario, confirmadoAt: ahora,
                tripId, usuario, nota, fecha
            }
        });
        total += n;
        confirmados++;
    }

    return { confirmados, total, declarado, diferencia: total - declarado };
}

/** Las vueltas cargadas que nadie conto todavia. Es la cola de recepcion. */
export async function vueltasPendientes(prisma: Prisma): Promise<any[]> {
    const movs = await prisma.crateMovement.findMany({
        where: { motivo: 'RETORNO', confirmado: false },
        orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
        include: {
            type: { select: { key: true, name: true } },
            trip: { select: { id: true, reparto: true, driver: true, date: true } }
        }
    });
    const porViaje = new Map<number, any>();
    for (const m of movs as any[]) {
        if (m.tripId == null) continue;
        const v = porViaje.get(m.tripId) || {
            tripId: m.tripId, reparto: m.trip?.reparto || null, driver: m.trip?.driver || null,
            fecha: m.fecha, declarado: 0, porTipo: [] as any[]
        };
        const dicho = m.declarado == null ? Math.abs(Number(m.cantidad) || 0) : Number(m.declarado);
        v.declarado += dicho;
        v.porTipo.push({ key: m.type?.key, nombre: m.type?.name, declarado: dicho });
        porViaje.set(m.tripId, v);
    }
    return [...porViaje.values()];
}

/* ---------------------------------------------------------------------------
 * EL CONTROL: los mismos movimientos mirados por donde haga falta
 * ------------------------------------------------------------------------ */

export type Agrupador = 'dia' | 'mes' | 'anio' | 'reparto' | 'tipo' | 'motivo';

export const AGRUPADORES: Agrupador[] = ['dia', 'mes', 'anio', 'reparto', 'tipo', 'motivo'];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** La fecha en Buenos Aires, no en UTC: un movimiento de las 22 h no tiene que
 *  contarse al dia siguiente. */
function partesDeFecha(f: Date | string): { dia: string; mes: string; anio: string } {
    const d = new Date(f);
    const ymd = d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const [a, m] = ymd.split('-');
    return { dia: ymd, mes: `${a}-${m}`, anio: a };
}

export function etiquetaDeGrupo(agrupar: Agrupador, clave: string): string {
    if (agrupar === 'mes') {
        const [a, m] = clave.split('-');
        return `${MESES[Number(m) - 1] || m} ${a}`;
    }
    if (agrupar === 'dia') {
        const [a, m, d] = clave.split('-');
        return `${d}/${m}/${a}`;
    }
    return clave;
}

export interface FilaDelControl {
    clave: string;
    etiqueta: string;
    /** Todo lo que sumo al deposito. */
    entraron: number;
    /** Todo lo que resto, en positivo. */
    salieron: number;
    /** entraron - salieron */
    neto: number;
    /** Cuantos movimientos hay detras del numero. */
    movimientos: number;
    /** Lo que esta cargado pero sin contar. */
    porConfirmar: number;
}

/**
 * Agrupa los movimientos por donde se pida y devuelve las filas del control.
 *
 * Se separa en `entraron` y `salieron` en vez de dar solo el neto porque el
 * neto solo no dice nada: un mes con 0 de neto puede no haber movido un cajon
 * o haber movido tres mil.
 */
export function armarControl(
    movimientos: Array<{
        fecha: Date | string; cantidad: number; motivo: string; confirmado?: boolean;
        type?: { key?: string; name?: string } | null;
        trip?: { reparto?: string | null } | null;
    }>,
    agrupar: Agrupador
): FilaDelControl[] {
    const grupos = new Map<string, FilaDelControl>();

    for (const m of movimientos) {
        let clave: string;
        if (agrupar === 'reparto') clave = String(m.trip?.reparto || 'SIN REPARTO').trim().toUpperCase();
        else if (agrupar === 'tipo') clave = String(m.type?.name || '—');
        else if (agrupar === 'motivo') clave = String(m.motivo).toUpperCase();
        else clave = partesDeFecha(m.fecha)[agrupar];

        const g = grupos.get(clave) || {
            clave, etiqueta: etiquetaDeGrupo(agrupar, clave),
            entraron: 0, salieron: 0, neto: 0, movimientos: 0, porConfirmar: 0
        };
        const n = Number(m.cantidad) || 0;
        if (m.confirmado === false) {
            g.porConfirmar += Math.abs(n);
        } else if (n >= 0) {
            g.entraron += n;
        } else {
            g.salieron += -n;
        }
        g.neto = g.entraron - g.salieron;
        g.movimientos++;
        grupos.set(clave, g);
    }

    const filas = [...grupos.values()];
    // Las fechas en orden; el resto, alfabetico.
    if (agrupar === 'dia' || agrupar === 'mes' || agrupar === 'anio') {
        filas.sort((a, b) => b.clave.localeCompare(a.clave));
    } else {
        filas.sort((a, b) => a.clave.localeCompare(b.clave, 'es', { numeric: true }));
    }
    return filas;
}

/* ---------------------------------------------------------------------------
 * EL HISTORIAL: como fue cambiando el stock
 * ------------------------------------------------------------------------ */

/**
 * Una fila del historial. A diferencia del control, que solo suma lo que paso
 * en cada periodo, el historial arrastra el SALDO: con cuanto se arranco, que
 * se movio, con cuanto se termino.
 *
 * El saldo final de un periodo es el inicial del siguiente. Esa es toda la
 * gracia: permite mirar una fecha y saber cuantos cajones habia ese dia, que
 * es la pregunta que no contesta una lista de movimientos.
 */
export interface FilaDelHistorial {
    clave: string;
    etiqueta: string;
    saldoInicial: number;
    entraron: number;
    salieron: number;
    saldoFinal: number;
    movimientos: number;
    /** Lo que en ese periodo quedo cargado sin contar. */
    sinContar: number;
}

/**
 * Arma el historial a partir de los movimientos CONFIRMADOS, arrastrando el
 * saldo desde `saldoAntes` (lo que habia antes del primer periodo).
 *
 * `movimientos` tiene que venir ordenado de mas viejo a mas nuevo; las filas
 * salen al reves, de mas nuevo a mas viejo, que es como se mira.
 */
export function armarHistorial(
    movimientos: Array<{ fecha: Date | string; cantidad: number; confirmado?: boolean }>,
    agrupar: 'dia' | 'mes' | 'anio',
    saldoAntes: number
): FilaDelHistorial[] {
    const orden: string[] = [];
    const grupos = new Map<string, FilaDelHistorial>();

    for (const m of movimientos) {
        const clave = partesDeFecha(m.fecha)[agrupar];
        let g = grupos.get(clave);
        if (!g) {
            g = {
                clave, etiqueta: etiquetaDeGrupo(agrupar, clave),
                saldoInicial: 0, entraron: 0, salieron: 0, saldoFinal: 0,
                movimientos: 0, sinContar: 0
            };
            grupos.set(clave, g);
            orden.push(clave);
        }
        const n = Number(m.cantidad) || 0;
        if (m.confirmado === false) {
            g.sinContar += Math.abs(n);
        } else if (n >= 0) {
            g.entraron += n;
        } else {
            g.salieron += -n;
        }
        g.movimientos++;
    }

    // El arrastre del saldo. Se hace en orden cronologico y recien despues se
    // da vuelta la lista: al reves no se puede arrastrar nada.
    orden.sort();
    let saldo = saldoAntes;
    for (const clave of orden) {
        const g = grupos.get(clave) as FilaDelHistorial;
        g.saldoInicial = saldo;
        saldo = saldo + g.entraron - g.salieron;
        g.saldoFinal = saldo;
    }

    return orden.reverse().map((c) => grupos.get(c) as FilaDelHistorial);
}

/**
 * Cuantos cajones habia antes de una fecha. Es la suma de todo lo confirmado
 * hasta ese momento; sin esto el historial arrancaria siempre en cero y los
 * saldos serian mentira.
 *
 * `hasta` es exclusivo: lo del propio dia no entra, porque ese dia es el
 * primero del historial que se va a mostrar.
 */
export async function saldoAntesDe(prisma: Prisma, hasta: Date | null, typeId?: number | null): Promise<number> {
    const where: any = { confirmado: true };
    if (hasta) where.fecha = { lt: hasta };
    if (typeId) where.typeId = typeId;
    const r = await prisma.crateMovement.aggregate({ where, _sum: { cantidad: true } });
    return Number(r?._sum?.cantidad) || 0;
}
