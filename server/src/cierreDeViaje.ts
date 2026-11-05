/* ============================================================================
 * PROTOCOLO DE CIERRE DE UN VIAJE
 * ============================================================================
 * Cuando el chofer termina el recorrido, lo que queda en la base no se puede
 * leer: cierra varias paradas juntas y de a saltos, asi que el numero de parada
 * no sigue el orden de las horas (en octubre de 2026 pasaba en 413 de 589
 * viajes), la ventana del viaje no contiene a todas sus paradas o se cierra
 * tarde por un toque posterior, quedan paradas con las dos horas cargadas pero
 * en PENDING o ARRIVED, y hay paradas de un minuto. Todo eso se corrigio a
 * mano una vez. Esto existe para que el sistema lo haga solo cada vez que un
 * viaje termina, y para poder pasarselo a los meses viejos.
 *
 * Lo que hace, en este orden:
 *   1. Ordena las paradas por hora. Regla pedida textualmente: "cuando termina
 *      el viaje, que las paradas se ordenen por orden de horario de parada".
 *      Las que no tienen hora van despues, en el orden que tenian; el deposito
 *      va siempre ultimo, tenga hora o no.
 *   2. Cierra las paradas que tienen llegada Y salida. Una sin hora no se
 *      toca: PENDING sin hora es una que no se visito, y marcarla entregada
 *      seria mentir.
 *   3. Ajusta la ventana del viaje a sus paradas. El fin se mueve hasta el
 *      deposito o la ultima entregada, NUNCA hasta una UNDELIVERABLE (en
 *      octubre eso le sumo tres horas fantasma a un viaje).
 *   4. Avisa, sin corregir, lo que necesita un ojo humano: paradas de menos
 *      de dos minutos, salidas antes de la llegada, paradas solapadas, "en la
 *      parada" sin salida.
 *
 * No escribe nada en un viaje abierto: el chofer todavia esta en la calle, y
 * ponerle fin a la ventana desde aca seria terminarle el viaje. Con dryRun
 * calcula todo y no escribe. Las escrituras van en una sola transaccion: o
 * queda todo prolijo o no queda nada a medias.
 * ========================================================================= */
import type { PrismaClient } from '@prisma/client';
import { esVueltaAlDeposito } from './unidadesDelViaje';

/** Menos que esto en una escuela no es una entrega: el chofer toco "llegue"
 *  y "sali" de corrido. Se avisa, no se corrige. */
export const PERMANENCIA_MINIMA_MS = 2 * 60 * 1000;

/** Una hora de parada mas lejos que esto de la fecha del viaje no se cree
 *  (relojes de celular desfasados, el 1970 de un dato roto). Es la misma
 *  tolerancia que usa el cierre por operador. */
const TOLERANCIA_FECHA_MS = 36 * 3600 * 1000;
/** Y tampoco se cree una hora que este en el futuro mas alla de esto. */
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

const ESTADOS_FINALES = new Set(['COMPLETED', 'UNDELIVERABLE']);

/** Margen para comparar horas: diferencias de menos de un segundo son ruido. */
const TOLERANCIA_MS = 1000;

export type TipoDeAviso =
    | 'permanencia-corta'         // escuela con menos de 2 minutos entre llegada y salida
    | 'salida-antes-de-llegada'   // la salida es anterior a la llegada
    | 'solapadas'                 // dos paradas que se pisan en el tiempo
    | 'en-parada-sin-salida'      // quedo "En la parada" (ARRIVED) sin hora de salida
    | 'hora-fuera-de-rango'       // una hora que no se puede creer; se trata como si no estuviera
    | 'ventana-no-achicada'       // el fin deberia ser anterior, pero dejaria una parada afuera
    | 'deposito-antes-de-entrega' // la vuelta al deposito marcada antes de la ultima entrega: se toma como sin hora
    | 'ventana-invertida'         // la ventana calculada termina antes de empezar; no se escribe
    | 'viaje-returnTime-distinto' // el trip tiene una vuelta cargada a mano, distinta a la ventana
    | 'viaje-abierto'             // la ruta no esta cerrada: no se toca nada
    | 'sin-paradas';              // la ruta no tiene paradas

export interface AvisoDeCierre {
    tipo: TipoDeAviso;
    /** Numero de parada DESPUES de ordenar (el que ve el operador). */
    sec?: number;
    nombre?: string;
    llegada?: string | null;
    salida?: string | null;
    /** Para 'solapadas': la otra parada del par. */
    otroSec?: number;
    otroNombre?: string;
    /** Siempre: el aviso en castellano, con las horas. */
    texto: string;
}

export interface CambioDeCierre {
    tipo: 'secuencia' | 'estado' | 'ventana' | 'viaje';
    stopId?: number;
    nombre?: string;
    antes: unknown;
    despues: unknown;
}

export interface VentanaDeCierre {
    inicio: string | null;
    fin: string | null;
}

export interface InformeDeCierre {
    routeId: number;
    tripId: number | null;
    dryRun: boolean;
    /** Si no se toco nada, por que ('viaje abierto', 'sin paradas'). null = se proceso. */
    omitido: string | null;
    /** Paradas a las que les cambio el numero. */
    reordenadas: number;
    /** Paradas que pasaron a COMPLETED. */
    cerradas: number;
    /** null = la ventana quedo como estaba. */
    ventana: { antes: VentanaDeCierre; despues: VentanaDeCierre } | null;
    avisos: AvisoDeCierre[];
    cambios: CambioDeCierre[];
}

/** Una parada mientras se la trabaja: lo que vino de la base mas lo que se decidio. */
interface ParadaDeTrabajo {
    id: number;
    sequence: number;
    plannedSequence: number | null;
    status: string;
    nombre: string;
    deposito: boolean;
    /** Horas ya filtradas: null si no estaba o no se puede creer. */
    llegada: Date | null;
    salida: Date | null;
    /** La hora que decide el orden: la llegada, o la salida si es lo unico que hay. */
    horaDeOrden: Date | null;
    nuevaSec: number;
    estadoNuevo: string;
}

function aFecha(v: Date | string | null | undefined): Date | null {
    if (v === null || v === undefined || v === '') return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function iso(d: Date | null | undefined): string | null {
    return d ? d.toISOString() : null;
}

/** Hora corta en horario de Buenos Aires, para los textos que lee el operador. */
function hhmm(d: Date | null | undefined): string {
    if (!d) return '--:--';
    return d.toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false
    });
}

function mismaHora(a: Date | null | undefined, b: Date | null | undefined): boolean {
    if (!a || !b) return !a && !b;
    // Un segundo de tolerancia: el cierre automatico y la vuelta del viaje se
    // escriben con milisegundos distintos y son la misma hora.
    return Math.abs(a.getTime() - b.getTime()) < 1000;
}

export async function normalizarViajeAlCerrar(
    prisma: PrismaClient,
    routeId: number,
    opciones: { dryRun?: boolean } = {}
): Promise<InformeDeCierre> {
    const dryRun = !!opciones.dryRun;

    const route = await prisma.route.findUnique({
        where: { id: routeId },
        select: {
            id: true, tripId: true, date: true, status: true,
            actualStartTime: true, actualEndTime: true,
            trip: { select: { id: true, status: true, exitTime: true, returnTime: true, completedAt: true } },
            stops: {
                orderBy: { sequence: 'asc' },
                select: {
                    id: true, sequence: true, plannedSequence: true, status: true,
                    actualArrival: true, actualDeparture: true, isReturnToBase: true,
                    clientId: true, client: { select: { name: true } }
                }
            }
        }
    });
    if (!route) throw new Error(`La ruta ${routeId} no existe`);

    const informe: InformeDeCierre = {
        routeId: route.id,
        tripId: route.tripId ?? null,
        dryRun,
        omitido: null,
        reordenadas: 0,
        cerradas: 0,
        ventana: null,
        avisos: [],
        cambios: []
    };
    const avisar = (a: AvisoDeCierre) => { informe.avisos.push(a); };

    // Un viaje abierto no se toca: calcularle el fin desde las paradas seria
    // cerrarselo al chofer mientras todavia esta repartiendo.
    const rutaCerrada = !!route.actualEndTime || String(route.status || '').toUpperCase() === 'COMPLETED';
    if (!rutaCerrada) {
        informe.omitido = 'viaje abierto';
        avisar({ tipo: 'viaje-abierto', texto: `La ruta ${route.id} sigue abierta (${route.status}): no se toca nada` });
        return informe;
    }
    if (!route.stops.length) {
        informe.omitido = 'sin paradas';
        avisar({ tipo: 'sin-paradas', texto: `La ruta ${route.id} no tiene paradas` });
        return informe;
    }

    // ── Que horas se creen ─────────────────────────────────────────────────
    // Una hora a dias de distancia de la fecha del viaje, o en el futuro, no es
    // un horario: es un reloj roto. Para todo lo que sigue cuenta como si no
    // estuviera, y se avisa para que alguien la corrija.
    const fechaViaje = aFecha(route.date);
    const ahora = Date.now();
    const creible = (d: Date | null): boolean => {
        if (!d) return false;
        const t = d.getTime();
        if (t > ahora + TOLERANCIA_FUTURO_MS) return false;
        if (fechaViaje && Math.abs(t - fechaViaje.getTime()) > TOLERANCIA_FECHA_MS) return false;
        return true;
    };

    const paradas: ParadaDeTrabajo[] = route.stops.map((s) => {
        const nombre = s.client?.name || '';
        const llegadaCruda = aFecha(s.actualArrival);
        const salidaCruda = aFecha(s.actualDeparture);
        const llegada = creible(llegadaCruda) ? llegadaCruda : null;
        const salida = creible(salidaCruda) ? salidaCruda : null;
        if (llegadaCruda && !llegada) {
            avisar({ tipo: 'hora-fuera-de-rango', sec: s.sequence, nombre, llegada: iso(llegadaCruda), salida: iso(salidaCruda),
                texto: `#${s.sequence} ${nombre}: la llegada ${llegadaCruda.toISOString()} no es de este viaje; se ignora` });
        }
        if (salidaCruda && !salida) {
            avisar({ tipo: 'hora-fuera-de-rango', sec: s.sequence, nombre, llegada: iso(llegadaCruda), salida: iso(salidaCruda),
                texto: `#${s.sequence} ${nombre}: la salida ${salidaCruda.toISOString()} no es de este viaje; se ignora` });
        }
        return {
            id: s.id,
            sequence: s.sequence,
            plannedSequence: s.plannedSequence ?? null,
            status: String(s.status || 'PENDING'),
            nombre,
            // Flag o nombre, como en el resto del sistema: las rutas viejas
            // tienen el deposito sin la marca.
            deposito: esVueltaAlDeposito({ sequence: s.sequence, isReturnToBase: s.isReturnToBase, client: s.client }),
            llegada,
            salida,
            horaDeOrden: llegada ?? salida,
            nuevaSec: s.sequence,
            estadoNuevo: String(s.status || 'PENDING')
        };
    });

    // ── 1. Ordenar por horario ─────────────────────────────────────────────
    // Con hora, por hora (y a igual hora, el numero que tenian, para que dos
    // marcadas en el mismo segundo no se den vuelta entre si). Sin hora,
    // despues, en el orden que tenian. El deposito, ultimo siempre.
    const porHora = (a: ParadaDeTrabajo, b: ParadaDeTrabajo) =>
        (a.horaDeOrden!.getTime() - b.horaDeOrden!.getTime()) || (a.sequence - b.sequence);
    const escuelasConHora = paradas.filter((p) => !p.deposito && p.horaDeOrden).sort(porHora);
    const escuelasSinHora = paradas.filter((p) => !p.deposito && !p.horaDeOrden);
    const depositos = paradas.filter((p) => p.deposito)
        .sort((a, b) => (a.horaDeOrden && b.horaDeOrden) ? porHora(a, b) : (a.sequence - b.sequence));
    const orden = [...escuelasConHora, ...escuelasSinHora, ...depositos];
    orden.forEach((p, i) => {
        p.nuevaSec = i + 1;
        if (p.nuevaSec !== p.sequence) {
            informe.reordenadas++;
            informe.cambios.push({ tipo: 'secuencia', stopId: p.id, nombre: p.nombre, antes: p.sequence, despues: p.nuevaSec });
        }
    });

    // ── 2. Cerrar las que terminaron ───────────────────────────────────────
    // Las dos horas cargadas y un estado que no es final: el chofer estuvo y
    // se fue, le falto tocar "entregado". RETRY borra la llegada al posponer,
    // asi que una pospuesta de verdad no entra aca.
    for (const p of paradas) {
        if (p.llegada && p.salida && !ESTADOS_FINALES.has(p.status.toUpperCase())) {
            p.estadoNuevo = 'COMPLETED';
            informe.cerradas++;
            informe.cambios.push({ tipo: 'estado', stopId: p.id, nombre: p.nombre, antes: p.status, despues: 'COMPLETED' });
        }
    }

    // ── 3. La ventana del viaje ────────────────────────────────────────────
    const inicioAntes = aFecha(route.actualStartTime);
    const finAntes = aFecha(route.actualEndTime);
    let inicioNuevo = inicioAntes;
    let finNuevo = finAntes;

    // El inicio solo se adelanta: si una parada tiene llegada antes del
    // arranque, el viaje ya habia empezado. Nunca se atrasa.
    const llegadas = paradas.map((p) => p.llegada).filter((d): d is Date => !!d);
    if (llegadas.length) {
        const primera = new Date(Math.min(...llegadas.map((d) => d.getTime())));
        if (!inicioAntes || primera.getTime() < inicioAntes.getTime()) inicioNuevo = primera;
    }

    // La vuelta al deposito tiene que ser DESPUES de la ultima entrega. Si
    // esta marcada antes, fue un toque mal hecho (8256, 1/10/2026: deposito
    // 11:04 con una entrega a las 11:43) y se trata como si no tuviera hora:
    // no marca el fin ni deja achicar. Si no, el viaje se cortaba en la
    // ultima entrega y se perdia la vuelta (56 minutos en ese caso).
    const entregadas = paradas
        .filter((p) => !p.deposito && p.estadoNuevo.toUpperCase() === 'COMPLETED')
        .map((p) => p.salida ?? p.llegada)
        .filter((d): d is Date => !!d);
    const ultimaEntrega = entregadas.length ? Math.max(...entregadas.map((d) => d.getTime())) : null;
    const depositoValido = (p: (typeof paradas)[number]) => {
        const h = p.salida ?? p.llegada;
        return !!h && (ultimaEntrega == null || h.getTime() >= ultimaEntrega - TOLERANCIA_MS);
    };
    const depositoMalMarcado = paradas.filter((p) => p.deposito && (p.salida || p.llegada) && !depositoValido(p));
    for (const p of depositoMalMarcado) {
        avisar({ tipo: 'deposito-antes-de-entrega', sec: p.nuevaSec, nombre: p.nombre, llegada: iso(p.llegada), salida: iso(p.salida),
            texto: `La vuelta al deposito esta marcada ${hhmm(p.salida ?? p.llegada)}, antes de la ultima entrega (${hhmm(new Date(ultimaEntrega!))}): se toma como sin hora` });
    }

    // El fin lo marcan las paradas que cuentan: las entregadas (con el estado
    // que les queda despues del paso 2) y el deposito bien marcado. Una
    // UNDELIVERABLE no extiende nunca: el chofer puede marcarla horas despues
    // desde su casa.
    const finesQueCuentan = paradas
        .filter((p) => (p.deposito && depositoValido(p)) || (!p.deposito && p.estadoNuevo.toUpperCase() === 'COMPLETED'))
        .map((p) => p.salida ?? p.llegada)
        .filter((d): d is Date => !!d);
    if (finesQueCuentan.length) {
        const ultima = new Date(Math.max(...finesQueCuentan.map((d) => d.getTime())));
        if (!finAntes || ultima.getTime() > finAntes.getTime()) {
            finNuevo = ultima;
        } else if (ultima.getTime() < finAntes.getTime()) {
            // Achicar es mas delicado que extender. Si el chofer nunca marco
            // la vuelta al deposito, la ultima entrega NO es el fin del viaje:
            // todavia tuvo que volver, y el cierre de la ruta es la unica
            // prueba de cuando llego. En octubre de 2026 esto le habria sacado
            // mas de una hora a cinco viajes con el deposito en PENDING.
            const depositoConHora = paradas.some((p) => p.deposito && depositoValido(p));
            if (!depositoConHora) {
                const porQue = depositoMalMarcado.length ? 'el deposito esta marcado antes de esa entrega' : 'el deposito no tiene hora';
                avisar({ tipo: 'ventana-no-achicada', llegada: iso(inicioAntes), salida: iso(finAntes),
                    texto: `La ultima entrega es ${hhmm(ultima)} pero ${porQue}: se deja el fin ${hhmm(finAntes)} (la vuelta no esta marcada)` });
            }
            // Y si al achicar quedara afuera CUALQUIER parada con hora (aunque
            // sea UNDELIVERABLE), se deja el fin como esta y se avisa. Que lo
            // mire una persona.
            const afuera = !depositoConHora ? [] : paradas.filter((p) => {
                const h = p.salida ?? p.llegada;
                return h && h.getTime() > ultima.getTime();
            });
            if (afuera.length) {
                for (const p of afuera) {
                    avisar({ tipo: 'ventana-no-achicada', sec: p.nuevaSec, nombre: p.nombre, llegada: iso(p.llegada), salida: iso(p.salida),
                        texto: `El fin deberia ser ${hhmm(ultima)} pero #${p.nuevaSec} ${p.nombre} (${p.estadoNuevo}) sale ${hhmm(p.salida ?? p.llegada)}: se deja ${hhmm(finAntes)}` });
                }
            } else if (depositoConHora) {
                finNuevo = ultima;
            }
        }
    }

    // Nunca una ventana que termina antes de empezar.
    if (inicioNuevo && finNuevo && finNuevo.getTime() < inicioNuevo.getTime()) {
        avisar({ tipo: 'ventana-invertida', llegada: iso(inicioNuevo), salida: iso(finNuevo),
            texto: `La ventana calculada termina (${hhmm(finNuevo)}) antes de empezar (${hhmm(inicioNuevo)}): no se escribe` });
        inicioNuevo = inicioAntes;
        finNuevo = finAntes;
    }

    const ventanaCambia = !mismaHora(inicioNuevo, inicioAntes) || !mismaHora(finNuevo, finAntes);
    if (ventanaCambia) {
        informe.ventana = {
            antes: { inicio: iso(inicioAntes), fin: iso(finAntes) },
            despues: { inicio: iso(inicioNuevo), fin: iso(finNuevo) }
        };
        informe.cambios.push({ tipo: 'ventana', antes: informe.ventana.antes, despues: informe.ventana.despues });
    }

    // El viaje (Trip) va atras de la ruta. exitTime/returnTime vacios se
    // completan con la ventana. Si returnTime venia PEGADO al fin viejo de la
    // ruta es que lo escribio el cierre automatico, y sigue al fin nuevo: es
    // lo que levanta el Motor de Costos, y dejarle la hora vieja seria seguir
    // cobrando las horas fantasma que esto arregla. Si alguien lo cargo a mano
    // con otra hora, no se toca y se avisa. Lo mismo con exitTime.
    const trip = route.trip;
    const datosViaje: { exitTime?: Date; returnTime?: Date; status?: string; completedAt?: Date } = {};
    if (trip) {
        const exitAntes = aFecha(trip.exitTime);
        const returnAntes = aFecha(trip.returnTime);
        if (inicioNuevo && !mismaHora(exitAntes, inicioNuevo)) {
            if (!exitAntes || mismaHora(exitAntes, inicioAntes)) datosViaje.exitTime = inicioNuevo;
        }
        if (finNuevo && !mismaHora(returnAntes, finNuevo)) {
            if (!returnAntes || mismaHora(returnAntes, finAntes)) {
                datosViaje.returnTime = finNuevo;
            } else {
                avisar({ tipo: 'viaje-returnTime-distinto', llegada: iso(returnAntes), salida: iso(finNuevo),
                    texto: `El viaje tiene vuelta ${hhmm(returnAntes)} cargada aparte y la ruta termina ${hhmm(finNuevo)}: no se toca` });
            }
        }
        if (inicioNuevo && finNuevo) {
            const completadoAntes = aFecha(trip.completedAt);
            if (String(trip.status || '').toUpperCase() !== 'COMPLETED' || !completadoAntes) {
                datosViaje.status = 'COMPLETED';
                datosViaje.completedAt = completadoAntes ?? finNuevo;
            }
        }
        if (Object.keys(datosViaje).length) {
            informe.cambios.push({
                tipo: 'viaje',
                antes: { status: trip.status, exitTime: iso(exitAntes), returnTime: iso(returnAntes), completedAt: iso(aFecha(trip.completedAt)) },
                despues: {
                    ...(datosViaje.status ? { status: datosViaje.status } : {}),
                    ...(datosViaje.exitTime ? { exitTime: iso(datosViaje.exitTime) } : {}),
                    ...(datosViaje.returnTime ? { returnTime: iso(datosViaje.returnTime) } : {}),
                    ...(datosViaje.completedAt ? { completedAt: iso(datosViaje.completedAt) } : {})
                }
            });
        }
    }

    // ── 4. Lo que se avisa y no se corrige ─────────────────────────────────
    for (const p of orden) {
        const base = { sec: p.nuevaSec, nombre: p.nombre, llegada: iso(p.llegada), salida: iso(p.salida) };
        if (p.llegada && p.salida) {
            const dur = p.salida.getTime() - p.llegada.getTime();
            if (dur < 0) {
                avisar({ tipo: 'salida-antes-de-llegada', ...base,
                    texto: `#${p.nuevaSec} ${p.nombre}: sale ${hhmm(p.salida)} antes de llegar ${hhmm(p.llegada)}` });
            } else if (!p.deposito && dur < PERMANENCIA_MINIMA_MS) {
                avisar({ tipo: 'permanencia-corta', ...base,
                    texto: `#${p.nuevaSec} ${p.nombre}: ${hhmm(p.llegada)} a ${hhmm(p.salida)}, ${Math.round(dur / 1000)} segundos en la parada` });
            }
        }
        if (p.estadoNuevo.toUpperCase() === 'ARRIVED' && !p.salida) {
            avisar({ tipo: 'en-parada-sin-salida', ...base,
                texto: `#${p.nuevaSec} ${p.nombre}: quedo "En la parada" (llego ${hhmm(p.llegada)}) sin hora de salida` });
        }
    }
    // Dos paradas que se pisan: el chofer no puede estar en dos escuelas a la
    // vez. Son pocas paradas, se comparan todas contra todas.
    const conIntervalo = orden.filter((p) => p.llegada && p.salida && p.salida.getTime() >= p.llegada.getTime());
    for (let i = 0; i < conIntervalo.length; i++) {
        for (let j = i + 1; j < conIntervalo.length; j++) {
            const a = conIntervalo[i], b = conIntervalo[j];
            if (a.llegada!.getTime() < b.salida!.getTime() && b.llegada!.getTime() < a.salida!.getTime()) {
                avisar({ tipo: 'solapadas', sec: a.nuevaSec, nombre: a.nombre, llegada: iso(a.llegada), salida: iso(a.salida),
                    otroSec: b.nuevaSec, otroNombre: b.nombre,
                    texto: `#${a.nuevaSec} ${a.nombre} (${hhmm(a.llegada)}-${hhmm(a.salida)}) y #${b.nuevaSec} ${b.nombre} (${hhmm(b.llegada)}-${hhmm(b.salida)}) se superponen` });
            }
        }
    }

    // ── Escribir ───────────────────────────────────────────────────────────
    const hayQueEscribir = informe.reordenadas > 0 || informe.cerradas > 0 || ventanaCambia || Object.keys(datosViaje).length > 0;
    if (dryRun || !hayQueEscribir) return informe;

    await prisma.$transaction(async (tx) => {
        for (const p of paradas) {
            const data: { sequence?: number; plannedSequence?: number; status?: string } = {};
            if (p.nuevaSec !== p.sequence) {
                data.sequence = p.nuevaSec;
                // Como el reordenamiento del chofer: el orden del planificador
                // se guarda la primera vez que se lo pisa, para no perderlo.
                data.plannedSequence = p.plannedSequence ?? p.sequence;
            }
            if (p.estadoNuevo !== p.status) data.status = p.estadoNuevo;
            if (!Object.keys(data).length) continue;
            // routeId en el where: si la parada cambio de ruta entre la lectura
            // y la escritura, Prisma falla en vez de pisar otra ruta.
            await tx.stop.update({ where: { id: p.id, routeId: route.id }, data });
        }
        if (ventanaCambia) {
            await tx.route.update({
                where: { id: route.id },
                data: {
                    ...(mismaHora(inicioNuevo, inicioAntes) ? {} : { actualStartTime: inicioNuevo }),
                    ...(mismaHora(finNuevo, finAntes) ? {} : { actualEndTime: finNuevo })
                }
            });
        }
        if (trip && Object.keys(datosViaje).length) {
            await tx.trip.update({ where: { id: trip.id }, data: datosViaje });
        }
    });

    return informe;
}
