/* ============================================================================
 * GUARDAS DE VIAJE
 * ============================================================================
 * Tres controles permanentes que salieron de lo que paso en octubre de 2026:
 *
 *  1. proveedoresParecidos: dos nombres de proveedor que son la misma persona
 *     escrita distinto ("ALAM AMO" / "ALAN AMO"). La herramienta
 *     proveedores-en-viajes solo compara tildes y espacios, y eso no lo ve.
 *     Aca se compara por distancia de edicion (Levenshtein), a mano.
 *
 *  2. cerrarViajeAnteriorDelChofer: cuando un chofer arranca su segundo viaje
 *     del dia, el primero termina ahi. Regla del usuario: "el deposito es el
 *     cierre del viaje, no una parada". Es la alternativa a frenar con 409: la
 *     guarda choferYaEnOtroViaje avisa, pero la app del chofer se traga ese
 *     aviso y el solape queda igual (ver scripts/investigacion_guardas.md).
 *
 *  3. completarViajeCreadoParaFechaPasada: un viaje creado para un dia que ya
 *     paso (completar un mes viejo) nace PENDING, sin proveedor y sin cerrar.
 *     Aca se le pone el proveedor de la ficha del chofer y, si tiene ventana,
 *     se cierra con sus paradas.
 *
 * No importa index.ts. Recibe el cliente de Prisma por parametro, asi se
 * prueba con uno falso (scripts/probar_guardas.ts).
 * ========================================================================= */
import type { PrismaClient } from '@prisma/client';

export const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

/** Lo minimo que estas funciones le piden al cliente de Prisma. El de verdad
 *  cumple con esto (se verifica abajo en tiempo de compilacion) y el falso de
 *  la prueba tambien. */
export interface ClientePrisma {
    trip: { findUnique(args: any): PromiseLike<any>; update(args: any): PromiseLike<any> };
    route: { findMany(args: any): PromiseLike<any>; update(args: any): PromiseLike<any> };
    stop: { update(args: any): PromiseLike<any>; updateMany(args: any): PromiseLike<any> };
    user: { findMany(args: any): PromiseLike<any> };
    provider: { findMany(args: any): PromiseLike<any> };
    $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}
// Si PrismaClient dejara de cumplir la interfaz, esto deja de compilar.
type _PrismaCumple = PrismaClient extends ClientePrisma ? true : never;
const _prismaCumple: _PrismaCumple = true;
void _prismaCumple;

// ───────────────────────────── Nombres ─────────────────────────────

/** Mayusculas, sin tildes, espacios colapsados. */
export function normalizarNombre(v: any): string {
    return String(v ?? '').trim().toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ');
}

/** Distancia de edicion clasica: cuantas letras hay que insertar, borrar o
 *  cambiar para pasar de `a` a `b`. Sin dependencias. */
export function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let previa = new Array<number>(b.length + 1);
    let actual = new Array<number>(b.length + 1);
    for (let j = 0; j <= b.length; j++) previa[j] = j;
    for (let i = 1; i <= a.length; i++) {
        actual[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const costo = a[i - 1] === b[j - 1] ? 0 : 1;
            actual[j] = Math.min(
                previa[j] + 1,          // borrar
                actual[j - 1] + 1,      // insertar
                previa[j - 1] + costo   // cambiar
            );
        }
        [previa, actual] = [actual, previa];
    }
    return previa[b.length];
}

export const DISTANCIA_MAXIMA_PARECIDOS = 2;

/** Pares de nombres DISTINTOS (tras normalizar) que estan a 2 letras o menos
 *  uno del otro. Dos nombres que normalizan igual ("JOSE PEREZ" / "JOSÉ PÉREZ")
 *  no son un par: son el mismo nombre, y de eso ya se ocupa la agrupacion por
 *  nombre normalizado. Se devuelve cada par una sola vez, con las escrituras
 *  originales con que aparecieron primero. */
export function proveedoresParecidos(nombres: string[]): Array<{ a: string; b: string; distancia: number }> {
    const vistos = new Map<string, string>(); // normalizado -> como se escribio
    for (const n of nombres || []) {
        const k = normalizarNombre(n);
        if (!k || vistos.has(k)) continue;
        vistos.set(k, String(n).trim());
    }
    const claves = [...vistos.keys()];
    const pares: Array<{ a: string; b: string; distancia: number }> = [];
    for (let i = 0; i < claves.length; i++) {
        for (let j = i + 1; j < claves.length; j++) {
            // Si el largo difiere en mas que la tolerancia, no hace falta calcular
            if (Math.abs(claves[i].length - claves[j].length) > DISTANCIA_MAXIMA_PARECIDOS) continue;
            const d = levenshtein(claves[i], claves[j]);
            if (d > 0 && d <= DISTANCIA_MAXIMA_PARECIDOS) {
                pares.push({ a: vistos.get(claves[i])!, b: vistos.get(claves[j])!, distancia: d });
            }
        }
    }
    return pares.sort((x, y) => x.distancia - y.distancia || x.a.localeCompare(y.a, 'es'));
}

// ───────────────────────────── Fechas ─────────────────────────────

/** YYYY-MM-DD de un instante, en hora de Buenos Aires. */
export function diaBuenosAires(d: Date | string | number = new Date()): string {
    return new Date(d).toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA });
}

/** El dia calendario de un viaje.
 *
 *  La fecha del viaje se guarda al mediodia de Buenos Aires (15:00Z), asi que
 *  el dia es el de Buenos Aires. Pero hay cargas viejas guardadas como
 *  'YYYY-MM-DD' pelado, que cae a la medianoche UTC: en Buenos Aires eso es
 *  las 21:00 del dia ANTERIOR, y ese no es el dia que se quiso cargar. Un
 *  instante exactamente a la medianoche UTC se toma por su dia UTC. */
export function diaDelViaje(date: Date | string | number | null | undefined): string {
    if (date === null || date === undefined) return '';
    const f = new Date(date);
    if (isNaN(f.getTime())) return '';
    const medianocheUtc = f.getUTCHours() === 0 && f.getUTCMinutes() === 0
        && f.getUTCSeconds() === 0 && f.getUTCMilliseconds() === 0;
    return medianocheUtc ? f.toISOString().slice(0, 10) : diaBuenosAires(f);
}

// ─────────────── 2. El viaje anterior del chofer se cierra ───────────────

export interface ViajeCerrado {
    tripId: number;
    reparto: string | null;
    abiertoDesde: Date | null;
}

export interface ResultadoCierreAnterior {
    cerrado: ViajeCerrado | null;
    /** Si por error habia mas de uno abierto, se cierran todos; los demas van aca. */
    otrosCerrados: ViajeCerrado[];
    dryRun: boolean;
}

/** Para el viaje que esta por arrancar, busca otro viaje del MISMO CHOFER y
 *  del MISMO DIA cuya ruta este abierta (tiene actualStartTime y no tiene
 *  actualEndTime) y lo cierra en `ahora`: ruta, viaje y, si estaba abierta, la
 *  parada de deposito.
 *
 *  El mismo chofer es: la ruta apunta a la misma cuenta de la app
 *  (Route.driverId) o el viaje tiene el mismo nombre de chofer (normalizado).
 *  Es la misma comparacion que hace choferYaEnOtroViaje en index.ts.
 *
 *  Solo el mismo dia, a proposito: un viaje abierto de ayer es un error de
 *  carga viejo, y cerrarlo con la hora de hoy le pondria una jornada de 24 h.
 *  Ese lo arregla el operador. */
export async function cerrarViajeAnteriorDelChofer(
    prisma: ClientePrisma,
    tripId: number,
    ahora: Date,
    opciones: { dryRun?: boolean } = {}
): Promise<ResultadoCierreAnterior> {
    const dryRun = !!opciones.dryRun;
    const vacio: ResultadoCierreAnterior = { cerrado: null, otrosCerrados: [], dryRun };

    const t = await prisma.trip.findUnique({
        where: { id: tripId },
        select: { id: true, date: true, driver: true, linkedRoute: { select: { id: true, driverId: true } } }
    });
    if (!t?.date) return vacio;

    const nombre = normalizarNombre(t.driver);
    const driverId: string | null = t.linkedRoute?.driverId || null;
    if (!nombre && !driverId) return vacio;

    const dia = diaDelViaje(t.date);
    if (!dia) return vacio;

    // La consulta trae una ventana ancha en UTC (36 h a cada lado del mediodia
    // del dia): el filtro fino por dia calendario se hace abajo, con la misma
    // regla que se usa para el viaje que arranca.
    const centro = new Date(`${dia}T12:00:00.000Z`).getTime();
    const abiertas: any[] = await prisma.route.findMany({
        where: {
            tripId: { not: tripId },
            actualStartTime: { not: null },
            actualEndTime: null,
            date: { gte: new Date(centro - 36 * 3600000), lte: new Date(centro + 36 * 3600000) }
        },
        select: {
            id: true, tripId: true, driverId: true, date: true, actualStartTime: true,
            trip: { select: { id: true, date: true, driver: true, reparto: true } },
            stops: {
                select: {
                    id: true, status: true, isReturnToBase: true,
                    actualArrival: true, actualDeparture: true
                }
            }
        }
    });

    const delChofer = abiertas
        .filter((r) => r.tripId != null)
        .filter((r) => {
            const mismoPorId = !!driverId && !!r.driverId && r.driverId === driverId;
            const mismoPorNombre = !!nombre && normalizarNombre(r.trip?.driver) === nombre;
            return mismoPorId || mismoPorNombre;
        })
        .filter((r) => diaDelViaje(r.trip?.date ?? r.date) === dia)
        .sort((a, b) => new Date(a.actualStartTime).getTime() - new Date(b.actualStartTime).getTime());

    const cerrados: ViajeCerrado[] = [];
    for (const r of delChofer) {
        const deposito = (r.stops || []).find((s: any) => s.isReturnToBase === true);
        const depositoAbierto = !!deposito
            && (String(deposito.status || '').toUpperCase() !== 'COMPLETED' || !deposito.actualDeparture);

        if (!dryRun) {
            await prisma.$transaction(async (tx: any) => {
                await tx.route.update({
                    where: { id: r.id },
                    data: { actualEndTime: ahora, status: 'COMPLETED' }
                });
                await tx.trip.update({
                    where: { id: r.tripId },
                    // returnTime tambien: es lo que lee el Motor de Costos
                    data: { status: 'COMPLETED', completedAt: ahora, returnTime: ahora }
                });
                if (depositoAbierto) {
                    await tx.stop.update({
                        where: { id: deposito.id },
                        data: {
                            status: 'COMPLETED',
                            actualArrival: deposito.actualArrival || ahora,
                            actualDeparture: ahora
                        }
                    });
                }
            });
        }
        cerrados.push({
            tripId: Number(r.tripId),
            reparto: r.trip?.reparto ?? null,
            abiertoDesde: r.actualStartTime ? new Date(r.actualStartTime) : null
        });
    }

    return { cerrado: cerrados[0] ?? null, otrosCerrados: cerrados.slice(1), dryRun };
}

// ─────────────── 3. Viaje creado para una fecha que ya paso ───────────────

export type FichaDelChofer = { tipo: string; proveedor: string | null };

/** Nombres iguales aunque esten escritos distinto: sin acentos, sin mayusculas
 *  y sin importar el orden. Copia de mismoNombrePersona de index.ts. */
export function mismoNombrePersona(a: any, b: any): boolean {
    const partes = (v: any) => String(v || '').toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/[^A-Z0-9]+/).filter((x) => x.length > 2);
    const pa = partes(a), pb = partes(b);
    if (!pa.length || !pb.length) return false;
    if (pa.length === pb.length && [...pa].sort().join(' ') === [...pb].sort().join(' ')) return true;
    const comunes = pa.filter((x) => pb.includes(x)).length;
    if (pa.length === 1 || pb.length === 1) return comunes >= 1;
    return comunes >= 2;
}

/** Cuentas que existen solo para probar la app (igual que reporteTorre). */
const CUENTAS_DE_PRUEBA = ['juan'];
function esCuentaDePrueba(usuario: any): boolean {
    const u = String(usuario || '').trim().toLowerCase();
    return !!u && CUENTAS_DE_PRUEBA.includes(u);
}

/** Lo que es el chofer segun su ficha de personal: Propio o Tercerizado, y con
 *  que proveedor. Es la misma logica que loQueEsElChofer en index.ts
 *  (fichasDeChoferes + fichaDelChofer), sin el cache de 15 segundos: esto se
 *  llama una vez por viaje creado, no 31 veces seguidas.
 *
 *  Casi todos los choferes tienen DOS fichas (la del catalogo, con contrato, y
 *  la de la cuenta del celular, vacia). Gana la mas completa.
 *
 *  Si en index.ts se prefiere usar loQueEsElChofer tal cual, se pasa por
 *  opciones.ficha: (chofer) => loQueEsElChofer(chofer, fecha). */
export async function loQueEsElChoferDesdePrisma(prisma: ClientePrisma, chofer: any): Promise<FichaDelChofer | null> {
    const n = String(chofer || '').trim();
    if (!n) return null;
    const [gente, proveedores]: [any[], any[]] = await Promise.all([
        prisma.user.findMany({
            where: { active: { not: false } },
            select: { username: true, fullName: true, contractType: true, providerId: true }
        }),
        prisma.provider.findMany({ select: { id: true, name: true } })
    ]);
    const nombreProv = new Map<string, string>(proveedores.map((p) => [p.id, p.name]));
    let mejor: { contrato: string | null; proveedor: string | null } | null = null;
    const puntaje = (f: { contrato: string | null; proveedor: string | null }) =>
        (f.contrato ? 2 : 0) + (f.proveedor ? 1 : 0);
    for (const u of gente) {
        if (esCuentaDePrueba(u.username) || esCuentaDePrueba(u.fullName)) continue;
        const nombre = String(u.fullName || u.username || '').trim();
        if (!nombre || !mismoNombrePersona(nombre, n)) continue;
        const f = {
            contrato: u.contractType ? String(u.contractType).trim().toUpperCase() : null,
            proveedor: u.providerId ? (nombreProv.get(u.providerId) || null) : null
        };
        if (!mejor || puntaje(f) > puntaje(mejor)) mejor = f;
    }
    if (!mejor || (mejor.contrato !== 'PROPIO' && mejor.contrato !== 'TERCERIZADO')) return null;
    return {
        tipo: mejor.contrato === 'PROPIO' ? 'Propio' : 'Tercerizado',
        proveedor: mejor.contrato === 'PROPIO' ? null : mejor.proveedor
    };
}

export interface ResultadoCompletar {
    tripId: number;
    dryRun: boolean;
    fechaViaje: string;
    hoy: string;
    esFechaPasada: boolean;
    ficha: FichaDelChofer | null;
    cambios: {
        contractType: { antes: string | null; despues: string } | null;
        provider: { antes: string | null; despues: string } | null;
        viajeCerrado: boolean;
        rutaCerrada: boolean;
        paradasCerradas: number;
    };
    /** Por que no se cerro, cuando no se cerro. */
    motivoSinCerrar: string | null;
}

/** Deja bien un viaje recien creado para una fecha anterior a hoy.
 *
 *  - Contrato y proveedor: salen de la ficha del chofer. Si el viaje no tiene
 *    contrato se le pone el de la ficha; si es Tercerizado y no tiene
 *    proveedor, se le pone el de la ficha. Con `pisarContratoConFicha` se
 *    toma la ficha aunque el viaje ya traiga algo: sirve para
 *    create-trip-from-template, que pone 'Propio' por defecto sin mirar al
 *    chofer.
 *  - Cierre: si la fecha del viaje es anterior a hoy (Buenos Aires) y la ruta
 *    tiene ventana (actualStartTime y actualEndTime), viaje y ruta pasan a
 *    COMPLETED, con completedAt y returnTime = fin de la ventana, y las
 *    paradas que tienen las dos horas pasan a COMPLETED. Una parada sin
 *    horario no se toca: es una que no se visito.
 *  - Un viaje de hoy no se cierra, aunque tenga ventana: puede seguir en la
 *    calle. */
export async function completarViajeCreadoParaFechaPasada(
    prisma: ClientePrisma,
    tripId: number,
    opciones: {
        dryRun?: boolean;
        /** "Hoy", para las pruebas. Por defecto, ahora. */
        hoy?: Date;
        /** Como averiguar la ficha del chofer. Por defecto se lee de Prisma. */
        ficha?: (chofer: string) => Promise<FichaDelChofer | null>;
        pisarContratoConFicha?: boolean;
    } = {}
): Promise<ResultadoCompletar> {
    const dryRun = !!opciones.dryRun;
    const hoy = diaBuenosAires(opciones.hoy ?? new Date());

    const t = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
            id: true, date: true, driver: true, provider: true, contractType: true,
            status: true, completedAt: true, returnTime: true,
            linkedRoute: {
                select: {
                    id: true, status: true, actualStartTime: true, actualEndTime: true,
                    stops: { select: { id: true, status: true, actualArrival: true, actualDeparture: true } }
                }
            }
        }
    });
    if (!t) throw new Error(`El viaje ${tripId} no existe`);

    const resultado: ResultadoCompletar = {
        tripId, dryRun, fechaViaje: diaDelViaje(t.date), hoy,
        esFechaPasada: false, ficha: null,
        cambios: { contractType: null, provider: null, viajeCerrado: false, rutaCerrada: false, paradasCerradas: 0 },
        motivoSinCerrar: null
    };
    resultado.esFechaPasada = !!resultado.fechaViaje && resultado.fechaViaje < hoy;

    // ── Contrato y proveedor, segun la ficha del chofer ──
    const buscarFicha = opciones.ficha ?? ((chofer: string) => loQueEsElChoferDesdePrisma(prisma, chofer));
    const ficha = String(t.driver || '').trim() ? await buscarFicha(String(t.driver).trim()) : null;
    resultado.ficha = ficha;

    const dataViaje: any = {};
    const contratoActual = String(t.contractType || '').trim();
    let contrato = contratoActual;
    if (ficha?.tipo && (!contratoActual || (opciones.pisarContratoConFicha && contratoActual !== ficha.tipo))) {
        contrato = ficha.tipo;
        dataViaje.contractType = contrato;
        resultado.cambios.contractType = { antes: contratoActual || null, despues: contrato };
    }
    const proveedorActual = String(t.provider || '').trim();
    if (contrato.toLowerCase() === 'tercerizado' && ficha?.proveedor
        && (!proveedorActual || (opciones.pisarContratoConFicha && dataViaje.contractType && proveedorActual !== ficha.proveedor))) {
        dataViaje.provider = ficha.proveedor;
        resultado.cambios.provider = { antes: proveedorActual || null, despues: ficha.proveedor };
    }

    // ── Cierre, solo si el dia ya paso y hay ventana ──
    const ruta = t.linkedRoute;
    const dataRuta: any = {};
    const paradasACerrar: number[] = [];
    if (!resultado.esFechaPasada) {
        resultado.motivoSinCerrar = resultado.fechaViaje >= hoy ? 'el viaje es de hoy o de un dia que no llego' : 'el viaje no tiene fecha valida';
    } else if (!ruta) {
        resultado.motivoSinCerrar = 'el viaje no tiene ruta';
    } else if (!ruta.actualStartTime || !ruta.actualEndTime) {
        resultado.motivoSinCerrar = 'la ruta no tiene ventana (falta la hora de inicio o la de fin)';
    } else {
        const fin = new Date(ruta.actualEndTime);
        if (String(t.status || '').toUpperCase() !== 'COMPLETED') dataViaje.status = 'COMPLETED';
        if (!t.completedAt) dataViaje.completedAt = fin;
        if (!t.returnTime) dataViaje.returnTime = fin;
        resultado.cambios.viajeCerrado = 'status' in dataViaje || 'completedAt' in dataViaje || 'returnTime' in dataViaje;
        if (String(ruta.status || '').toUpperCase() !== 'COMPLETED') {
            dataRuta.status = 'COMPLETED';
            resultado.cambios.rutaCerrada = true;
        }
        for (const s of (ruta.stops || []) as any[]) {
            const conHoras = !!s.actualArrival && !!s.actualDeparture;
            if (conHoras && String(s.status || '').toUpperCase() !== 'COMPLETED') paradasACerrar.push(s.id);
        }
        resultado.cambios.paradasCerradas = paradasACerrar.length;
    }

    const hayQueEscribir = Object.keys(dataViaje).length > 0 || Object.keys(dataRuta).length > 0 || paradasACerrar.length > 0;
    if (!dryRun && hayQueEscribir) {
        await prisma.$transaction(async (tx: any) => {
            if (Object.keys(dataViaje).length) await tx.trip.update({ where: { id: tripId }, data: dataViaje });
            if (ruta && Object.keys(dataRuta).length) await tx.route.update({ where: { id: ruta.id }, data: dataRuta });
            if (paradasACerrar.length) {
                await tx.stop.updateMany({ where: { id: { in: paradasACerrar } }, data: { status: 'COMPLETED' } });
            }
        });
    }
    return resultado;
}
