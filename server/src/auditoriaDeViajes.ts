/* ============================================================================
 * AUDITORIA DE LOS VIAJES DE UN MES
 * ============================================================================
 * En octubre 2026 se auditaron los viajes con un script de afuera y aparecieron
 * 1.390 hallazgos en 455 viajes. Esto es ese mismo control, pero adentro del
 * sistema: se corre sobre cualquier mes con un boton o un endpoint y no hay que
 * depender de nada externo.
 *
 * No modifica nada. Devuelve un informe con un resumen por control (cuantos
 * hallazgos, en cuantos viajes y que significa, en castellano llano, que es lo
 * que lee el operador) y la lista completa de hallazgos, uno por fila.
 *
 * COMO SE ELIGEN LOS VIAJES: por rango de `trip.date`, todo el mes en UTC. NO
 * por quien pasa por el deposito: en octubre eso dejo afuera 25 viajes que no
 * tenian parada de deposito.
 *
 * Los controles estructurales (dos paradas a la vez, secuencia fuera de orden,
 * parada muy corta) salen de como marca el chofer en el celular, no de un
 * error de carga. Se informan igual, porque pisan las horas.
 * ========================================================================= */

import type { PrismaClient } from '@prisma/client';
import { esVueltaAlDeposito } from './unidadesDelViaje';
import { sinViajesDePrueba } from './reporteTorre';

// ─────────────────────────────── Tipos ───────────────────────────────

export interface HallazgoDeAuditoria {
    control: string;
    viaje: number;
    /** YYYY-MM-DD */
    fecha: string;
    reparto: string | null;
    chofer: string | null;
    contrato: string | null;
    valor: number;
    /** Horas del viaje (arranque a cierre). null = no tiene ventana. */
    horas: number | null;
    detalle: string;
    dato: string | null;
}

export interface ResumenDeControl {
    control: string;
    hallazgos: number;
    viajes: number;
    queSignifica: string;
}

export interface InformeDeAuditoria {
    mes: number;
    anio: number;
    /** Viajes del mes que se revisaron. */
    viajes: number;
    /** Paradas cargadas en esos viajes (incluida la vuelta al deposito). */
    paradas: number;
    resumen: ResumenDeControl[];
    hallazgos: HallazgoDeAuditoria[];
}

/** Lo que se lee de cada viaje. Coincide con el `select` de abajo y con lo
 *  que arma el test con un prisma falso. */
export interface ViajeParaAuditar {
    id: number;
    date: Date | string;
    reparto?: string | null;
    driver?: string | null;
    provider?: string | null;
    contractType?: string | null;
    value?: any;
    businessUnit?: string | null;
    zone?: string | null;
    status?: string | null;
    vuelta?: number | null;
    isManual?: boolean | null;
    observations?: string | null;
    notes?: string | null;
    exitTime?: Date | string | null;
    returnTime?: Date | string | null;
    assignedMobileUser?: string | null;
    linkedRoute?: {
        actualStartTime?: Date | string | null;
        actualEndTime?: Date | string | null;
        stops?: ParadaParaAuditar[] | null;
    } | null;
    tramos?: { orden?: number | null; ruta?: string | null; inicio?: Date | string | null; fin?: Date | string | null }[] | null;
}

export interface ParadaParaAuditar {
    sequence: number;
    status?: string | null;
    actualArrival?: Date | string | null;
    actualDeparture?: Date | string | null;
    isReturnToBase?: boolean | null;
    ruta?: string | null;
    client?: { name?: string | null } | null;
}

// ──────────────────────────── Los controles ───────────────────────────

export const CONTROLES: { control: string; queSignifica: string }[] = [
    { control: 'Duplicados',
      queSignifica: 'Dos viajes del mismo dia, reparto, chofer y vuelta con las mismas paradas. Uno sobra, y si tiene valor se paga dos veces. LIBRE y CDI no entran porque se repiten de verdad. Dos vueltas del mismo reparto no son duplicado.' },
    { control: 'El reparto se repite ese dia con otro chofer',
      queSignifica: 'Dos viajes del mismo reparto y las mismas paradas, con choferes distintos. Uno de los dos esta de mas o tiene mal el chofer.' },
    { control: 'Pasa de 8,5 h',
      queSignifica: 'El viaje dura mas de 8,5 h entre el arranque y el cierre. Suele ser un viaje que quedo abierto y se cerro tarde.' },
    { control: 'Duracion imposible',
      queSignifica: 'El cierre no es posterior al arranque, o el viaje dura menos de un minuto. Con eso las horas dan cero.' },
    { control: 'Sin arranque ni cierre',
      queSignifica: 'Tiene paradas con hora pero no tiene hora de arranque o de cierre, asi que no se le pueden calcular las horas.' },
    { control: 'Parada fuera de la ventana',
      queSignifica: 'Una parada llega antes del arranque del viaje o sale despues del cierre. O la ventana esta mal, o la parada.' },
    { control: 'Parada invertida',
      queSignifica: 'La parada sale antes de llegar. Las dos horas estan cruzadas.' },
    { control: 'Parada muy corta',
      queSignifica: 'Una parada real (no el deposito) dura menos de 2 minutos. Sale de como marca el chofer, que cierra varias juntas; no es un error de carga.' },
    { control: 'Dos paradas a la vez',
      queSignifica: 'Una parada arranca antes de que termine la anterior. El chofer cierra varias de golpe; es como marca, no un error de carga.' },
    { control: 'Secuencia fuera de orden',
      queSignifica: 'El numero de parada no sigue el orden de las horas: el chofer no recorre en el orden numerado. Es como marca, no un error de carga; renumerar romperia el orden planificado de la ruta.' },
    { control: 'Parada sin horario',
      queSignifica: 'Figura entregada o con llegada, pero no tiene hora de llegada o de salida. Falto el toque en el celular.' },
    { control: 'Chofer en dos viajes a la vez',
      queSignifica: 'Las ventanas de dos viajes del mismo chofer se pisan. Pasa cuando tiene los dos abiertos en el celular y los cierra juntos: esas horas se cuentan dos veces en el costo.' },
    { control: 'Jornada de mas de 12 h',
      queSignifica: 'Entre su primer arranque y su ultimo cierre del dia, el chofer pasa de 12 h en la calle.' },
    { control: 'Tarifa',
      queSignifica: 'Tercerizados sin proveedor o en $0; propios con un valor escrito a mano igual a una tarifa de tercerizado; y segundos viajes del dia de un tercerizado que cobran de nuevo (la tarifa es por dia, salvo que el viaje diga "paga aparte").' },
    { control: 'Proveedor sin tarifa',
      queSignifica: 'Tercerizado con un proveedor que no esta en la tabla de tarifas del mes. Hasta que se cargue, el viaje queda sin tarifa.' },
    { control: 'Nombres de proveedor parecidos',
      queSignifica: 'Dos proveedores con el nombre escrito casi igual (una o dos letras de diferencia). Suele ser la misma persona cargada dos veces, y la tabla de tarifas no la encuentra.' },
    { control: 'Unidad de negocio',
      queSignifica: 'El viaje lleva paradas de una ruta SAM o RETIRO y su unidad de negocio no la menciona, asi que esas horas no se le asignan a esa unidad.' },
    { control: 'Viaje sin paradas',
      queSignifica: 'El viaje no tiene ninguna parada real cargada. Si tiene valor, se paga un viaje del que no hay registro.' },
    { control: 'Faltan datos',
      queSignifica: 'Le falta el chofer, la unidad de negocio o la zona; o tiene trabajo hecho (horas o paradas marcadas) y el estado no es COMPLETED.' },
];

const C = {
    duplicados: 'Duplicados',
    repartoRepetido: 'El reparto se repite ese dia con otro chofer',
    pasaDe8h30: 'Pasa de 8,5 h',
    duracionImposible: 'Duracion imposible',
    sinVentana: 'Sin arranque ni cierre',
    fueraDeVentana: 'Parada fuera de la ventana',
    invertida: 'Parada invertida',
    muyCorta: 'Parada muy corta',
    dosALaVez: 'Dos paradas a la vez',
    secuencia: 'Secuencia fuera de orden',
    sinHorario: 'Parada sin horario',
    choferEnDos: 'Chofer en dos viajes a la vez',
    jornada: 'Jornada de mas de 12 h',
    tarifa: 'Tarifa',
    sinTarifa: 'Proveedor sin tarifa',
    parecidos: 'Nombres de proveedor parecidos',
    unidad: 'Unidad de negocio',
    sinParadas: 'Viaje sin paradas',
    faltanDatos: 'Faltan datos',
};

/** Umbrales. Estan juntos para que se vean. */
const TOPE_VIAJE_H = 8.5;
const TOPE_JORNADA_H = 12;
const MINIMO_PARADA_MIN = 2;
const MINIMO_VIAJE_MS = 60 * 1000;
/** Dos marcas a menos de un segundo son la misma marca (ruido de milisegundos). */
const TOLERANCIA_MS = 1000;
/** Que parte de las paradas tienen que compartir dos viajes para ser "las mismas". */
const PARADAS_EN_COMUN = 0.6;
/** Distancia de edicion maxima para que dos proveedores sean "parecidos". */
const DISTANCIA_NOMBRES = 2;

const CLAVE_TARIFAS = 'tarifas_proveedor';

// ───────────────────────────── Utilidades ─────────────────────────────

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

function aMs(v: Date | string | null | undefined): number | null {
    if (!v) return null;
    const n = (v instanceof Date ? v : new Date(v)).getTime();
    return Number.isFinite(n) ? n : null;
}

/** HH:mm:ss en hora de Buenos Aires. */
function hora(ms: number | null): string {
    if (ms == null) return '-';
    return new Date(ms).toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const texto = (v: any) => String(v ?? '').trim();
const mayus = (v: any) => texto(v).toUpperCase();
const sinAcentos = (v: any) => mayus(v).normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Nombre de persona comparable: mayusculas, sin acentos, sin puntos ni dobles espacios. */
const nombreLimpio = (v: any) => sinAcentos(v).replace(/[^A-Z0-9]+/g, ' ').trim();

const esTercerizado = (v: { t: ViajeParaAuditar }) => /TERCERIZADO/.test(mayus(v.t.contractType));
const esPropio = (v: { t: ViajeParaAuditar }) => mayus(v.t.contractType) === 'PROPIO';
/** LIBRE y CDI se repiten de verdad en el dia: no cuentan como duplicados. */
const repartoQueSeRepite = (reparto: any) => /^(LIBRE|CDI)\b/.test(mayus(reparto));
/** El operador deja por escrito que ese viaje cobra aunque no sea el primero del dia. */
const loAclaroElOperador = (v: { t: ViajeParaAuditar }) =>
    /PAGA\s+(APARTE|TAMBIEN)|SE\s+PAGA\s+APARTE/i.test(texto(v.t.observations) + ' ' + texto(v.t.notes));

/** Distancia de edicion clasica (Levenshtein). */
export function distanciaDeEdicion(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let fila = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const nueva = [i];
        for (let j = 1; j <= b.length; j++) {
            nueva[j] = Math.min(
                fila[j] + 1,
                nueva[j - 1] + 1,
                fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        fila = nueva;
    }
    return fila[b.length];
}

/** Misma logica que `mismoNombrePersona` de index.ts (copiada, no importada):
 *  iguales aunque cambie el orden o los acentos, o comparten nombre y apellido. */
function mismoNombrePersona(a: any, b: any): boolean {
    const partes = (v: any) => sinAcentos(v).split(/[^A-Z0-9]+/).filter((x) => x.length > 2);
    const pa = partes(a), pb = partes(b);
    if (!pa.length || !pb.length) return false;
    if (pa.length === pb.length && [...pa].sort().join(' ') === [...pb].sort().join(' ')) return true;
    const comunes = pa.filter((x) => pb.includes(x)).length;
    if (pa.length === 1 || pb.length === 1) return comunes >= 1;
    return comunes >= 2;
}

/** La tarifa cargada a mano para ese proveedor en ese mes ("2026-10"). Misma
 *  busqueda que `buscarEnLaTablaDeTarifas` de index.ts. */
export function tarifaDelMes(
    tabla: Record<string, Record<string, number>>,
    proveedor: any,
    mes: string
): { nombre: string; valor: number } | null {
    const buscado = texto(proveedor);
    if (!buscado) return null;
    for (const [nombre, valor] of Object.entries(tabla[mes] || {})) {
        if (Number(valor) > 0 && mismoNombrePersona(nombre, buscado)) return { nombre, valor: Number(valor) };
    }
    return null;
}

// ─────────────────────── El viaje, ya digerido ───────────────────────

interface Parada {
    seq: number;
    nombre: string;
    status: string;
    llegada: number | null;
    salida: number | null;
    deposito: boolean;
    ruta: string;
}

interface Viaje {
    t: ViajeParaAuditar;
    id: number;
    dia: string;
    reparto: string;
    chofer: string;
    proveedor: string;
    valor: number;
    inicio: number | null;
    fin: number | null;
    /** Horas de la ventana. null si no hay ventana valida. */
    horas: number | null;
    paradas: Parada[];
    reales: Parada[];
    /** Rutas que recorre (de las paradas y de los tramos), sin la vuelta al deposito. */
    rutas: string[];
}

function digerir(t: ViajeParaAuditar): Viaje {
    const paradas: Parada[] = [...(t.linkedRoute?.stops || [])]
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .map((p) => ({
            seq: p.sequence,
            nombre: texto(p.client?.name) || '(sin nombre)',
            status: mayus(p.status),
            llegada: aMs(p.actualArrival),
            salida: aMs(p.actualDeparture),
            deposito: esVueltaAlDeposito(p),
            ruta: mayus(p.ruta),
        }));
    const inicio = aMs(t.linkedRoute?.actualStartTime) ?? aMs(t.exitTime);
    const fin = aMs(t.linkedRoute?.actualEndTime) ?? aMs(t.returnTime);
    const horas = inicio != null && fin != null && fin > inicio ? r2((fin - inicio) / 3600000) : null;
    const rutas = new Set<string>();
    for (const p of paradas) if (p.ruta && !p.deposito) rutas.add(p.ruta);
    for (const tr of t.tramos || []) {
        const r = mayus(tr.ruta);
        if (r && !/VUELTA/.test(r)) rutas.add(r);
    }
    return {
        t,
        id: Number(t.id),
        dia: new Date(t.date).toISOString().slice(0, 10),
        reparto: mayus(t.reparto),
        chofer: nombreLimpio(t.driver),
        proveedor: nombreLimpio(t.provider),
        valor: Number(t.value) || 0,
        inicio, fin, horas,
        paradas,
        reales: paradas.filter((p) => !p.deposito),
        rutas: [...rutas],
    };
}

/** Que parte de las paradas reales comparten dos viajes (sobre el mas chico).
 *  Dos viajes sin paradas son "iguales"; uno con y otro sin, no. */
function paradasEnComun(a: Viaje, b: Viaje): number {
    const A = new Set(a.reales.map((p) => nombreLimpio(p.nombre)));
    const B = new Set(b.reales.map((p) => nombreLimpio(p.nombre)));
    if (!A.size && !B.size) return 1;
    if (!A.size || !B.size) return 0;
    let comunes = 0;
    for (const n of A) if (B.has(n)) comunes++;
    return comunes / Math.min(A.size, B.size);
}

const etiqueta = (p: Parada) => `#${p.seq} ${p.nombre}`;
const pct = (f: number) => `${Math.round(f * 100)}% de paradas en comun`;

function agrupar<T>(lista: T[], clave: (x: T) => string | null): Map<string, T[]> {
    const m = new Map<string, T[]>();
    for (const x of lista) {
        const k = clave(x);
        if (k == null) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(x);
    }
    return m;
}

// ─────────────────────────── La auditoria ───────────────────────────

/** Corre todos los controles sobre viajes ya leidos. Es la parte pura: no toca
 *  la base. `tabla` es la de tarifas, { "2026-10": { "NOMBRE": valor } }. */
export function auditarViajes(
    viajesCrudos: ViajeParaAuditar[],
    tabla: Record<string, Record<string, number>>,
    anio: number,
    mes: number
): InformeDeAuditoria {
    const claveMes = `${anio}-${String(mes).padStart(2, '0')}`;
    const nombreMes = MESES[mes - 1] || claveMes;
    const viajes = viajesCrudos.map(digerir).sort((a, b) => a.id - b.id);
    const hallazgos: HallazgoDeAuditoria[] = [];

    const anotar = (control: string, v: Viaje, detalle: string, dato: string | null = null) => {
        hallazgos.push({
            control,
            viaje: v.id,
            fecha: v.dia,
            reparto: v.t.reparto ?? null,
            chofer: v.t.driver ?? null,
            contrato: v.t.contractType ?? null,
            valor: v.valor,
            horas: v.horas,
            detalle,
            dato,
        });
    };

    // ── 1. Duplicados: mismo dia + reparto + chofer + vuelta, mismas paradas ──
    const porDiaRepartoChoferVuelta = agrupar(viajes, (v) =>
        v.reparto && v.chofer && !repartoQueSeRepite(v.reparto)
            ? [v.dia, v.reparto, v.chofer, String(v.t.vuelta ?? '')].join('|')
            : null);
    for (const grupo of porDiaRepartoChoferVuelta.values()) {
        if (grupo.length < 2) continue;
        for (const v of grupo) {
            const iguales = grupo.filter((o) => o !== v && paradasEnComun(v, o) >= PARADAS_EN_COMUN);
            if (!iguales.length) continue;
            const mejor = Math.max(...iguales.map((o) => paradasEnComun(v, o)));
            anotar(C.duplicados, v,
                `parece duplicado de ${iguales.map((o) => `${o.id}`).join(', ')}: mismo dia, reparto, chofer y vuelta` +
                (v.reales.length ? '' : ' (los dos sin paradas)'),
                pct(mejor));
        }
    }

    // ── 2. El reparto se repite ese dia con otro chofer ──
    const porDiaReparto = agrupar(viajes, (v) =>
        v.reparto && v.chofer && !repartoQueSeRepite(v.reparto) ? [v.dia, v.reparto].join('|') : null);
    for (const grupo of porDiaReparto.values()) {
        if (grupo.length < 2) continue;
        for (const v of grupo) {
            if (!v.reales.length) continue;
            const otros = grupo.filter((o) => o !== v && o.chofer !== v.chofer && o.reales.length
                && paradasEnComun(v, o) >= PARADAS_EN_COMUN);
            if (!otros.length) continue;
            anotar(C.repartoRepetido, v,
                `las mismas paradas las tiene ${otros.map((o) => `${o.id} (${o.t.driver})`).join(', ')}`,
                `${grupo.length} viajes del reparto ese dia`);
        }
    }

    // ── 3, 4, 5: la ventana del viaje ──
    for (const v of viajes) {
        const { inicio, fin } = v;
        if (inicio != null && fin != null) {
            if (fin <= inicio) {
                anotar(C.duracionImposible, v, 'el cierre no es posterior al arranque', `${hora(inicio)} a ${hora(fin)}`);
            } else if (fin - inicio < MINIMO_VIAJE_MS) {
                anotar(C.duracionImposible, v, 'el viaje dura menos de 1 minuto', `${hora(inicio)} a ${hora(fin)}`);
            } else if (v.horas != null && v.horas > TOPE_VIAJE_H) {
                anotar(C.pasaDe8h30, v, `el viaje dura ${v.horas} h`, `${hora(inicio)} a ${hora(fin)}`);
            }
        } else {
            const conHora = v.paradas.filter((p) => p.llegada != null || p.salida != null);
            if (conHora.length) {
                const marcas = conHora.flatMap((p) => [p.llegada, p.salida]).filter((x): x is number => x != null);
                const falta = inicio == null && fin == null ? 'ni arranque ni cierre' : inicio == null ? 'arranque' : 'cierre';
                anotar(C.sinVentana, v,
                    `tiene ${conHora.length} parada(s) con hora pero no tiene ${falta}`,
                    `marcas de ${hora(Math.min(...marcas))} a ${hora(Math.max(...marcas))}`);
            }
        }
    }

    // ── 6, 7, 8, 9, 10, 11: las paradas ──
    for (const v of viajes) {
        const { inicio, fin } = v;

        for (const p of v.paradas) {
            // 6. Fuera de la ventana
            if (inicio != null && p.llegada != null && p.llegada < inicio - TOLERANCIA_MS) {
                anotar(C.fueraDeVentana, v, `${etiqueta(p)} llega antes del arranque`, `${hora(p.llegada)} vs ${hora(inicio)}`);
            }
            if (fin != null && p.salida != null && p.salida > fin + TOLERANCIA_MS) {
                anotar(C.fueraDeVentana, v, `${etiqueta(p)} sale despues del cierre`, `${hora(p.salida)} vs ${hora(fin)}`);
            }
            // 7. Invertida
            if (p.llegada != null && p.salida != null && p.salida < p.llegada) {
                anotar(C.invertida, v, `${etiqueta(p)} sale antes de llegar`, `salida ${hora(p.salida)}, llegada ${hora(p.llegada)}`);
            }
            // 8. Muy corta (solo paradas reales, y no las invertidas: esas ya salieron arriba)
            if (!p.deposito && p.llegada != null && p.salida != null && p.salida >= p.llegada
                && p.salida - p.llegada < MINIMO_PARADA_MIN * 60000) {
                const min = Math.round((p.salida - p.llegada) / 6000) / 10;
                anotar(C.muyCorta, v, `${etiqueta(p)} dura ${min} min`, `${hora(p.llegada)} a ${hora(p.salida)}`);
            }
            // 11. Sin horario
            if ((p.status === 'COMPLETED' || p.status === 'ARRIVED') && (p.llegada == null || p.salida == null)) {
                const falta = p.llegada == null && p.salida == null ? 'hora' : p.llegada == null ? 'llegada' : 'salida';
                anotar(C.sinHorario, v, `${etiqueta(p)} figura ${p.status} y no tiene ${falta}`, null);
            }
        }

        // 9. Dos paradas a la vez: por orden de llegada, una arranca antes de que termine la anterior
        const porLlegada = v.paradas.filter((p) => p.llegada != null).sort((a, b) => a.llegada! - b.llegada! || a.seq - b.seq);
        for (let i = 1; i < porLlegada.length; i++) {
            const previa = porLlegada[i - 1], p = porLlegada[i];
            if (previa.salida != null && p.llegada! < previa.salida - TOLERANCIA_MS) {
                anotar(C.dosALaVez, v, `${etiqueta(p)} arranca antes de que termine ${etiqueta(previa)}`,
                    `${hora(p.llegada)} contra ${hora(previa.salida)}`);
            }
        }

        // 10. Secuencia fuera de orden: el numero de parada no sigue las horas
        const conHora = v.paradas.filter((p) => p.llegada != null || p.salida != null);
        let fueraDeOrden = 0;
        for (let i = 1; i < conHora.length; i++) {
            const h = (p: Parada) => (p.llegada ?? p.salida)!;
            if (h(conHora[i]) < h(conHora[i - 1]) - TOLERANCIA_MS) fueraDeOrden++;
        }
        if (fueraDeOrden) {
            anotar(C.secuencia, v, `${fueraDeOrden} parada(s) con hora anterior a la de la parada previa`, null);
        }
    }

    // ── 12. Chofer en dos viajes a la vez ──
    const porChofer = agrupar(viajes, (v) => v.chofer || null);
    for (const lista of porChofer.values()) {
        const conVentana = lista.filter((v) => v.inicio != null && v.fin != null && v.fin > v.inicio);
        for (let i = 0; i < conVentana.length; i++) {
            for (let j = i + 1; j < conVentana.length; j++) {
                const a = conVentana[i], b = conVentana[j];
                const desde = Math.max(a.inicio!, b.inicio!), hasta = Math.min(a.fin!, b.fin!);
                if (hasta - desde <= TOLERANCIA_MS) continue;
                // Se anota en el que arranca despues: es el que se mete en el otro.
                const [primero, segundo] = a.inicio! <= b.inicio! ? [a, b] : [b, a];
                anotar(C.choferEnDos, segundo,
                    `se pisa con el viaje ${primero.id} (${primero.t.reparto ?? '-'})`,
                    `${hora(segundo.inicio)}-${hora(segundo.fin)} contra ${hora(primero.inicio)}-${hora(primero.fin)}, ` +
                    `${r2((hasta - desde) / 3600000)} h pisadas`);
            }
        }
    }

    // ── 13. Jornada de mas de 12 h ──
    const porDiaChofer = agrupar(viajes, (v) => v.chofer ? `${v.dia}|${v.chofer}` : null);
    for (const lista of porDiaChofer.values()) {
        const conVentana = lista.filter((v) => v.inicio != null && v.fin != null && v.fin > v.inicio)
            .sort((a, b) => a.inicio! - b.inicio! || a.id - b.id);
        if (!conVentana.length) continue;
        const desde = conVentana[0].inicio!;
        const hasta = Math.max(...conVentana.map((v) => v.fin!));
        const h = r2((hasta - desde) / 3600000);
        if (h > TOPE_JORNADA_H) {
            anotar(C.jornada, conVentana[0],
                `el chofer esta en la calle ${h} h, en ${conVentana.length} viaje(s)`,
                `${hora(desde)} a ${hora(hasta)}`);
        }
    }

    // ── 14 y 15. Tarifa y proveedor sin tarifa ──
    const tercerizados = viajes.filter(esTercerizado);

    // El primer viaje del dia de cada chofer tercerizado: es el que cobra la tarifa.
    const primeroDelDia = new Set<number>();
    for (const lista of agrupar(tercerizados, (v) => v.chofer ? `${v.dia}|${v.chofer}` : null).values()) {
        const orden = [...lista].sort((a, b) => (a.inicio ?? Infinity) - (b.inicio ?? Infinity) || a.id - b.id);
        primeroDelDia.add(orden[0].id);
    }
    for (const v of tercerizados) if (!v.chofer) primeroDelDia.add(v.id);   // sin chofer no se puede agrupar

    for (const v of tercerizados) {
        const cobraEsteDia = primeroDelDia.has(v.id) || loAclaroElOperador(v);
        if (!v.proveedor) anotar(C.tarifa, v, 'tercerizado sin proveedor', v.valor ? `$${v.valor}` : null);
        // En $0 solo es problema si es el viaje que tiene que cobrar: el segundo del dia va en $0 a proposito.
        if (v.valor <= 0 && cobraEsteDia) anotar(C.tarifa, v, 'tercerizado en $0', null);
        if (!cobraEsteDia && v.valor > 0) {
            const primero = [...primeroDelDia].map((id) => viajes.find((o) => o.id === id)!)
                .find((o) => o && o.dia === v.dia && o.chofer === v.chofer);
            anotar(C.tarifa, v,
                `no es el primer viaje del dia de ese chofer y cobra $${v.valor} (la tarifa es por dia)`,
                primero ? `el primero es el ${primero.id} (${hora(primero.inicio)})` : null);
        }
        if (v.proveedor && !tarifaDelMes(tabla, v.t.provider, claveMes)) {
            anotar(C.sinTarifa, v, `el proveedor ${texto(v.t.provider)} no tiene tarifa de ${nombreMes}`, `$${v.valor}`);
        }
    }

    // Propio con un valor igual a alguna tarifa de tercerizado del mes: alguien
    // lo escribio a mano. Las tarifas salen de la tabla del mes y de los
    // tercerizados que ya tienen valor.
    const tarifasDeTercerizado = new Map<number, string>();
    for (const [nombre, valor] of Object.entries(tabla[claveMes] || {})) {
        if (Number(valor) > 0 && !tarifasDeTercerizado.has(Number(valor))) tarifasDeTercerizado.set(Number(valor), `tarifa de ${nombre}`);
    }
    for (const v of tercerizados) {
        if (v.valor > 0 && !tarifasDeTercerizado.has(v.valor)) tarifasDeTercerizado.set(v.valor, `valor del tercerizado ${v.id}`);
    }
    for (const v of viajes) {
        if (!esPropio(v) || v.valor <= 0) continue;
        const origen = tarifasDeTercerizado.get(v.valor);
        if (origen) anotar(C.tarifa, v, `propio con valor de tercerizado ($${v.valor}), escrito a mano`, origen);
    }

    // ── 16. Nombres de proveedor parecidos ──
    const porProveedor = agrupar(viajes, (v) => v.proveedor && v.proveedor !== 'PROPIO' ? texto(v.t.provider) : null);
    const nombres = [...porProveedor.keys()].sort();
    for (let i = 0; i < nombres.length; i++) {
        for (let j = i + 1; j < nombres.length; j++) {
            const a = nombres[i], b = nombres[j];
            const d = distanciaDeEdicion(nombreLimpio(a), nombreLimpio(b));
            if (d > DISTANCIA_NOMBRES) continue;
            const va = porProveedor.get(a)!, vb = porProveedor.get(b)!;
            anotar(C.parecidos, va[0],
                `"${a}" y "${b}" parecen la misma persona: el nombre cambia en ${d} letra(s)`,
                `${a}: ${va.length} viaje(s) | ${b}: ${vb.length} viaje(s)`);
        }
    }

    // ── 17. Unidad de negocio ──
    for (const v of viajes) {
        const unidad = sinAcentos(v.t.businessUnit);
        if (!unidad) continue;   // sin unidad es "Faltan datos"
        const faltan = new Set<string>();
        for (const r of v.rutas) {
            const m = /^(SAM|RETIRO)\b/.exec(r);
            if (m && !unidad.includes(m[1])) faltan.add(m[1]);
        }
        for (const u of faltan) {
            anotar(C.unidad, v, `lleva paradas de una ruta ${u} pero la unidad no la menciona`, texto(v.t.businessUnit));
        }
    }

    // ── 18. Viaje sin paradas ──
    for (const v of viajes) {
        if (v.reales.length) continue;
        anotar(C.sinParadas, v, 'no tiene ninguna parada real' + (v.t.isManual ? ' (viaje manual)' : ''), `$${v.valor}`);
    }

    // ── 19. Faltan datos ──
    for (const v of viajes) {
        const faltan: string[] = [];
        if (!v.chofer) faltan.push('chofer');
        if (!texto(v.t.businessUnit)) faltan.push('unidad de negocio');
        if (!texto(v.t.zone)) faltan.push('zona');
        if (faltan.length) anotar(C.faltanDatos, v, `falta: ${faltan.join(', ')}`, null);

        const estado = mayus(v.t.status);
        const trabajoHecho = (v.inicio != null && v.fin != null)
            || v.paradas.some((p) => p.llegada != null || p.salida != null || p.status === 'COMPLETED');
        if (trabajoHecho && estado !== 'COMPLETED') {
            anotar(C.faltanDatos, v, `tiene trabajo hecho (horas o paradas marcadas) y el estado es ${estado || '(vacio)'}`, estado || null);
        }
    }

    // Los hallazgos van agrupados por control (en el orden de la lista) y, adentro, por viaje.
    const ordenDe = new Map(CONTROLES.map((c, i) => [c.control, i]));
    hallazgos.sort((a, b) => (ordenDe.get(a.control) ?? 99) - (ordenDe.get(b.control) ?? 99) || a.viaje - b.viaje);

    // ── Resumen: de mayor a menor ──
    const resumen: ResumenDeControl[] = CONTROLES.map(({ control, queSignifica }, i) => {
        const propios = hallazgos.filter((h) => h.control === control);
        return { control, hallazgos: propios.length, viajes: new Set(propios.map((h) => h.viaje)).size, queSignifica, _orden: i };
    }).sort((a, b) => b.hallazgos - a.hallazgos || a._orden - b._orden)
      .map(({ _orden, ...r }) => r);

    return {
        mes, anio,
        viajes: viajes.length,
        paradas: viajes.reduce((s, v) => s + v.paradas.length, 0),
        resumen,
        hallazgos,
    };
}

/** Deja en el informe solo esos controles (para `&solo=Tarifa,Duplicados`).
 *  Se compara sin mayusculas ni acentos, y vale el principio del nombre:
 *  "parada" trae los cuatro controles de paradas. Sin nombres validos, devuelve
 *  el informe entero. */
export function filtrarInforme(informe: InformeDeAuditoria, solo: string[]): InformeDeAuditoria {
    const pedidos = solo.map((s) => nombreLimpio(s)).filter(Boolean);
    if (!pedidos.length) return informe;
    const entra = (control: string) => {
        const c = nombreLimpio(control);
        return pedidos.some((p) => c === p || c.startsWith(p));
    };
    return {
        ...informe,
        resumen: informe.resumen.filter((r) => entra(r.control)),
        hallazgos: informe.hallazgos.filter((h) => entra(h.control)),
    };
}

/** Lee los viajes del mes y la tabla de tarifas y corre la auditoria.
 *  `mes` es 1..12. */
export async function auditarMes(prisma: PrismaClient, anio: number, mes: number): Promise<InformeDeAuditoria> {
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
        throw new Error(`Mes invalido: ${anio}-${mes}`);
    }
    const desde = new Date(Date.UTC(anio, mes - 1, 1, 0, 0, 0));
    const hasta = new Date(Date.UTC(anio, mes, 0, 23, 59, 59, 999));

    const viajes = await prisma.trip.findMany({
        where: { date: { gte: desde, lte: hasta } },
        select: {
            id: true, date: true, reparto: true, driver: true, provider: true, contractType: true,
            value: true, businessUnit: true, zone: true, status: true, vuelta: true, isManual: true,
            observations: true, notes: true, exitTime: true, returnTime: true, assignedMobileUser: true,
            linkedRoute: {
                select: {
                    actualStartTime: true, actualEndTime: true,
                    stops: {
                        orderBy: { sequence: 'asc' },
                        select: {
                            sequence: true, status: true, actualArrival: true, actualDeparture: true,
                            isReturnToBase: true, ruta: true, client: { select: { name: true } }
                        }
                    }
                }
            },
            tramos: { orderBy: { orden: 'asc' }, select: { orden: true, ruta: true, inicio: true, fin: true } }
        },
        orderBy: { id: 'asc' }
    });

    let tabla: Record<string, Record<string, number>> = {};
    try {
        const fila = await prisma.appSettings.findUnique({ where: { key: CLAVE_TARIFAS } });
        tabla = fila ? (JSON.parse(fila.value) || {}) : {};
    } catch (_) {
        tabla = {};
    }

    return auditarViajes(sinViajesDePrueba(viajes as any[]) as ViajeParaAuditar[], tabla, anio, mes);
}
