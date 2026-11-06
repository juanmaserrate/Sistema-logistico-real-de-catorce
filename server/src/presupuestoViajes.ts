/**
 * Presupuesto: cuantos viajes COMPLETADOS tuvo cada unidad de negocio, mes a
 * mes, con los bloques de la planilla "Conteo de viajes" que usa
 * administracion (nov 2026).
 *
 * No es una foto: se calcula cada vez desde los viajes, asi que un viaje que
 * se completa hoy ya aparece en el conteo la proxima vez que se mira (la
 * pantalla se vuelve a pedir sola cuando el socket avisa que cambio un viaje).
 *
 * Reglas:
 *  - Solo viajes en estado COMPLETED, de la cuenta real (no la de prueba).
 *  - Un viaje que reparte para dos unidades ("SAE BROWN, RETIRO") cuenta en
 *    las DOS: cada unidad recibio un viaje. Por eso la suma de los bloques
 *    puede dar mas que la cantidad de viajes; el resumen dice cuantos son.
 *  - SAE BROWN se abre por localidad, SAE LANUS por zona (que sale del
 *    reparto) y LOMAS JARDINES (SAE LOMAS) por reparto. Las tablas de
 *    localidades, zonas y repartos son las de trip-categories-config.json,
 *    las mismas del Panel logistico: si se cambian ahi, cambian aca.
 *  - Las reposiciones de Brown van en la fila "Reposiciones" de SAE BROWN, las
 *    de Lomas en la de LOMAS JARDINES, y las demas en el bloque REPOSICION.
 *  - Nada desaparece: lo que no entra en una categoria va a "Otras
 *    localidades" / "Otros repartos", y las unidades que no estan en la
 *    planilla van al bloque OTRAS UNIDADES.
 */
import { sinViajesDePrueba } from './reporteTorre';
import { unidadesDeTexto } from './unidadesDelViaje';

type Prisma = any;

export type Contrato = 'Propio' | 'Tercerizado';

export interface ViajeParaPresupuesto {
    id: number;
    date: Date | string;
    status?: string | null;
    contractType?: string | null;
    businessUnit?: string | null;
    zone?: string | null;          // la Localidad del viaje
    tripType?: string | null;      // el reparto
    reparto?: string | null;
    driver?: string | null;
    assignedMobileUser?: string | null;
}

export interface FilaPresupuesto { nombre: string; meses: number[]; total: number }

export interface BloquePresupuesto {
    clave: string;
    titulo: string;
    /** "Propio" / "Tercerizado" en los bloques que se abren por categoria;
     *  null en los que tienen una fila por contrato. */
    contrato: Contrato | null;
    nota?: string;
    filas: FilaPresupuesto[];
    totalMeses: number[];
    total: number;
}

export interface InformePresupuesto {
    anio: number;
    generado: string;
    resumen: {
        viajesCompletados: number;
        /** Lo que suman todos los bloques: un viaje de dos unidades suma 2. */
        conteos: number;
        viajesEnVariasUnidades: number;
        viajesPorMes: number[];
        /** Viajes sin contrato cargado: no se pueden poner en ningun bloque. */
        sinContrato: number[];
    };
    bloques: BloquePresupuesto[];
}

const MESES = 12;
const ceros = () => new Array(MESES).fill(0);

/** Mayusculas, sin acentos ni espacios de mas. */
export function normTexto(v: any): string {
    return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** El mes en Buenos Aires (0 = enero). Los viajes se guardan a las 15:00 UTC. */
function mesDe(fecha: Date | string): number {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    return new Date(d.getTime() - 3 * 3600 * 1000).getUTCMonth();
}

function contratoDe(v: any): Contrato | null {
    const c = normTexto(v);
    if (c === 'PROPIO') return 'Propio';
    if (c === 'TERCERIZADO' || c === 'EXTERNO') return 'Tercerizado';
    return null;
}

/** "R12 + R13" / "R12, SAM 2" -> ["R12", "R13"] / ["R12", "SAM 2"] */
function repartosDe(t: ViajeParaPresupuesto): string[] {
    const crudo = [t.tripType, t.reparto].filter(Boolean).join('+');
    return [...new Set(crudo.split(/[+,/]/).map(normTexto).filter(Boolean))];
}

/** El orden de los bloques y de sus filas es el de la planilla de administracion. */
const ORDEN_LANUS = ['Zona 8', 'Zona 14', 'Zona 4', 'Zona 17'];
const BLOQUES_POR_CONTRATO = [
    { clave: 'SAE_BROWN', titulo: 'SAE BROWN', otros: 'Otras localidades' },
    { clave: 'SAE_LANUS', titulo: 'SAE LANÚS', otros: 'Otros repartos' },
    { clave: 'LOMAS_JARDINES', titulo: 'LOMAS JARDINES', otros: 'Otros repartos' },
] as const;
const BLOQUES_SIMPLES = [
    { clave: 'SAM', titulo: 'SAM LANÚS' },
    { clave: 'SISTEMAS_ALTERNATIVOS', titulo: 'SISTEMAS ALTERNATIVOS' },
    { clave: 'CDI', titulo: 'CDI' },
    { clave: 'RETIRO', titulo: 'RETIRO' },
    { clave: 'EVENTOS', titulo: 'EVENTOS' },
    { clave: 'REPOSICION', titulo: 'REPOSICIÓN', nota: 'Las que no son de Brown ni de Lomas' },
] as const;

/** Lo que se necesita de trip-categories-config.json, ya normalizado. */
function leerReglas(cfg: any) {
    const reg = cfg?.regiones || {};
    const localidadesBrown: [string, string[]][] = Object.entries(reg.SAE_BROWN?.localidades || {})
        .map(([cat, alias]: any) => [cat, (alias as string[]).map(normTexto)]);
    const zonasLanus = Object.entries(reg.SAE_LANUS?.subzonas_por_reparto || {})
        .map(([cat, rs]: any) => [cat, (rs as string[]).map(normTexto)] as [string, string[]])
        .sort((a, b) => {
            const ia = ORDEN_LANUS.indexOf(a[0]), ib = ORDEN_LANUS.indexOf(b[0]);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
    const repartosLJ = Object.entries(reg.LOMAS_JARDINES?.subzonas_por_reparto || {})
        .map(([cat, rs]: any) => [cat, (rs as string[]).map(normTexto)] as [string, string[]]);
    const loc = cfg?.mesa_localidades_por_region || {};
    return {
        localidadesBrown,
        zonasLanus,
        repartosLJ,
        // Para saber de donde es una reposicion: Brown con sus alias, Lomas con los suyos
        repoBrown: new Set<string>([...(loc.Brown || []), ...localidadesBrown.flatMap(([, a]) => a)].map(normTexto)),
        repoLomas: new Set<string>([...(loc.Lomas || []), ...(reg.SAE_LOMAS?.localidades_fallback || [])].map(normTexto)),
        unidadesRepo: new Set<string>((cfg?.businessUnits_REPOSICION || ['REPO', 'REPOSICION']).map(normTexto)),
        unidadesSistAlt: new Set<string>([
            'SISTEMAS ALTERNATIVOS',
            ...Object.values(reg.LOMAS_JARDINES?.subzonas_por_bu || {}).flat() as string[]
        ].map(normTexto)),
    };
}

/** La parte pura: viajes + reglas -> informe. Sin base, para poder probarla. */
export function contarPresupuesto(viajesCrudos: ViajeParaPresupuesto[], cfg: any, anio: number): InformePresupuesto {
    const R = leerReglas(cfg);
    const viajes = sinViajesDePrueba(viajesCrudos as any[]) as ViajeParaPresupuesto[];

    // bloque -> contrato|'' -> fila -> meses
    const conteo = new Map<string, Map<string, Map<string, number[]>>>();
    const sumar = (bloque: string, contrato: string, fila: string, mes: number) => {
        if (!conteo.has(bloque)) conteo.set(bloque, new Map());
        const porContrato = conteo.get(bloque)!;
        if (!porContrato.has(contrato)) porContrato.set(contrato, new Map());
        const filas = porContrato.get(contrato)!;
        if (!filas.has(fila)) filas.set(fila, ceros());
        filas.get(fila)![mes] += 1;
    };

    const resumen = {
        viajesCompletados: 0, conteos: 0, viajesEnVariasUnidades: 0,
        viajesPorMes: ceros(), sinContrato: ceros()
    };

    for (const t of viajes) {
        if (normTexto(t.status) !== 'COMPLETED') continue;
        const mes = mesDe(t.date);
        if (mes < 0 || mes >= MESES) continue;
        const contrato = contratoDe(t.contractType);
        if (!contrato) { resumen.sinContrato[mes] += 1; continue; }

        const unidades = unidadesDeTexto(t.businessUnit).map(normTexto);
        if (!unidades.length) unidades.push('SIN UNIDAD');
        resumen.viajesCompletados += 1;
        resumen.viajesPorMes[mes] += 1;
        if (unidades.length > 1) resumen.viajesEnVariasUnidades += 1;

        const localidad = normTexto(t.zone);
        const repartos = repartosDe(t);
        const porReparto = (tabla: [string, string[]][]) =>
            tabla.find(([, rs]) => rs.some((r) => repartos.includes(r)))?.[0];

        for (const u of unidades) {
            if (u === 'SAE BROWN') {
                const cat = R.localidadesBrown.find(([, alias]) => alias.includes(localidad))?.[0];
                sumar('SAE_BROWN', contrato, cat || 'Otras localidades', mes);
            } else if (u === 'SAE LANUS') {
                sumar('SAE_LANUS', contrato, porReparto(R.zonasLanus) || 'Otros repartos', mes);
            } else if (u === 'SAE LOMAS') {
                sumar('LOMAS_JARDINES', contrato, porReparto(R.repartosLJ) || 'Otros repartos', mes);
            } else if (R.unidadesRepo.has(u)) {
                if (R.repoBrown.has(localidad)) sumar('SAE_BROWN', contrato, 'Reposiciones', mes);
                else if (R.repoLomas.has(localidad)) sumar('LOMAS_JARDINES', contrato, 'Reposiciones', mes);
                else sumar('REPOSICION', '', contrato, mes);
            } else if (u === 'SAM' || u.startsWith('SAM ')) {
                sumar('SAM', '', contrato, mes);
            } else if (R.unidadesSistAlt.has(u)) {
                sumar('SISTEMAS_ALTERNATIVOS', '', contrato, mes);
            } else if (u === 'CDI') {
                sumar('CDI', '', contrato, mes);
            } else if (u === 'RETIRO') {
                sumar('RETIRO', '', contrato, mes);
            } else if (u === 'EVENTO' || u === 'EVENTOS') {
                sumar('EVENTOS', '', contrato, mes);
            } else {
                sumar('OTRAS', '', `${u} · ${contrato}`, mes);
            }
        }
    }

    // ── Armado, con las filas fijas de la planilla aunque den cero ──
    const fila = (nombre: string, meses?: number[]): FilaPresupuesto => {
        const m = meses ? [...meses] : ceros();
        return { nombre, meses: m, total: m.reduce((a, b) => a + b, 0) };
    };
    const cerrar = (b: Omit<BloquePresupuesto, 'totalMeses' | 'total'>): BloquePresupuesto => {
        const totalMeses = ceros();
        for (const f of b.filas) f.meses.forEach((v, i) => { totalMeses[i] += v; });
        const total = totalMeses.reduce((a, x) => a + x, 0);
        resumen.conteos += total;
        return { ...b, totalMeses, total };
    };
    const fijas: Record<string, string[]> = {
        SAE_BROWN: [...R.localidadesBrown.map(([c]) => c), 'Reposiciones'],
        SAE_LANUS: R.zonasLanus.map(([c]) => c),
        LOMAS_JARDINES: [...R.repartosLJ.map(([c]) => c), 'Reposiciones'],
    };

    const bloques: BloquePresupuesto[] = [];
    for (const def of BLOQUES_POR_CONTRATO) {
        for (const contrato of ['Propio', 'Tercerizado'] as Contrato[]) {
            const datos = conteo.get(def.clave)?.get(contrato) || new Map<string, number[]>();
            const filas = fijas[def.clave].map((n) => fila(n, datos.get(n)));
            // Lo que no entro en ninguna categoria, solo si hay algo
            const otros = datos.get(def.otros);
            if (otros && otros.some(Boolean)) filas.push(fila(def.otros, otros));
            bloques.push(cerrar({ clave: def.clave, titulo: def.titulo, contrato, filas }));
        }
    }
    for (const def of BLOQUES_SIMPLES) {
        const datos = conteo.get(def.clave)?.get('') || new Map<string, number[]>();
        bloques.push(cerrar({
            clave: def.clave, titulo: def.titulo, contrato: null,
            ...('nota' in def ? { nota: def.nota } : {}),
            filas: (['Propio', 'Tercerizado'] as Contrato[]).map((c) => fila(c, datos.get(c)))
        }));
    }
    const otras = conteo.get('OTRAS')?.get('');
    if (otras && otras.size) {
        bloques.push(cerrar({
            clave: 'OTRAS', titulo: 'OTRAS UNIDADES', contrato: null,
            nota: 'Unidades que no están en la planilla del presupuesto',
            filas: [...otras.entries()].map(([n, m]) => fila(n, m)).sort((a, b) => b.total - a.total)
        }));
    }

    return { anio, generado: new Date().toISOString(), resumen, bloques };
}

/** Los viajes completados del anio y el informe. */
export async function presupuestoDelAnio(prisma: Prisma, anio: number, cfg: any): Promise<InformePresupuesto> {
    // Un dia de margen a cada lado: las fechas van en UTC y el mes se calcula
    // en hora de Buenos Aires. Lo que cae fuera del anio se descarta despues.
    const desde = new Date(Date.UTC(anio, 0, 1, 3, 0, 0));
    const hasta = new Date(Date.UTC(anio + 1, 0, 1, 3, 0, 0));
    const viajes = await prisma.trip.findMany({
        where: { status: 'COMPLETED', date: { gte: desde, lt: hasta } },
        select: {
            id: true, date: true, status: true, contractType: true, businessUnit: true,
            zone: true, tripType: true, reparto: true, driver: true, assignedMobileUser: true
        }
    });
    return contarPresupuesto(viajes, cfg, anio);
}
