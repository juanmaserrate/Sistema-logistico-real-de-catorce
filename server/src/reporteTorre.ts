/**
 * Reporte semanal para la Torre de Control (REAL14 Control Tower).
 *
 * La Torre no le pide datos al TMS: lee planillas de SharePoint cada vez que
 * alguien la abre. Asi que el TMS deja ahi cinco Excel, una vez por semana,
 * y se desentiende. Si un sabado falla, la Torre abre igual con los de la
 * semana anterior.
 *
 * Cada archivo tiene UNA hoja, encabezados en la primera fila y una fila por
 * hecho: sin celdas combinadas, sin subtotales, sin la unidad dentro del
 * numero. Es lo que necesita un lector automatico.
 *
 * Cada archivo trae TODO EL ANIO EN CURSO y reemplaza al anterior, porque la
 * Torre compara periodos y necesita el historial completo.
 */
import * as XLSX from 'xlsx';

type Prisma = any;

const TZ = 'America/Argentina/Buenos_Aires';

/** Fecha sin hora, al mediodia UTC, para que Excel no la corra un dia. */
function soloFecha(f: Date | null | undefined): Date | null {
    if (!f) return null;
    const ymd = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(f));
    const [a, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, d, 12, 0, 0));
}

/** "HH:MM" en hora de Buenos Aires. Vacio si no hay dato. */
function hora(f: Date | null | undefined): string {
    if (!f) return '';
    return new Intl.DateTimeFormat('es-AR', {
        timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date(f));
}

/** Horas con dos decimales entre dos momentos. null si falta alguno. */
function duracionHoras(desde: Date | null | undefined, hasta: Date | null | undefined): number | null {
    if (!desde || !hasta) return null;
    const h = (new Date(hasta).getTime() - new Date(desde).getTime()) / 3600000;
    return h > 0 && h < 48 ? Math.round(h * 100) / 100 : null;
}

function numero(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

const siNo = (v: any): string => (v === true ? 'Si' : v === false ? 'No' : '');

/** Nombre legible del estado del viaje. */
function estadoViaje(status: string | null | undefined, cerrado: boolean): string {
    const s = String(status || '').toUpperCase();
    if (s === 'COMPLETED' || s === 'RETURNED') return 'Cerrado';
    if (s === 'CANCELLED') return 'Cancelado';
    if (cerrado) return 'Cerrado';
    if (s === 'OUT_OF_PLANT') return 'En curso';
    return 'Sin cerrar';
}

// ─────────────────────────── Las cinco hojas ───────────────────────────

export async function filasViajes(prisma: Prisma, desde: Date, hasta: Date) {
    return filasViajesDe(prisma, { date: { gte: desde, lte: hasta } });
}

/** Los mismos viajes, pero eligiendo cuales por id. Lo usa el export de la web,
 *  que manda exactamente los que el operador tiene en pantalla. */
export async function filasViajesPorIds(prisma: Prisma, ids: number[]) {
    if (!ids.length) return [];
    return filasViajesDe(prisma, { id: { in: ids } });
}

const MESES_LIBRO = ['01 Enero', '02 Febrero', '03 Marzo', '04 Abril', '05 Mayo', '06 Junio',
    '07 Julio', '08 Agosto', '09 Septiembre', '10 Octubre', '11 Noviembre', '12 Diciembre'];

/** Nombre del mes de una fecha, para que la dinamica agrupe por texto. */
export function mesDeFecha(f: Date | null): string {
    return f ? MESES_LIBRO[new Date(f).getUTCMonth()] : '';
}

async function filasViajesDe(prisma: Prisma, where: any) {
    const viajes = await prisma.trip.findMany({
        where,
        include: {
            linkedRoute: {
                select: {
                    actualStartTime: true, actualEndTime: true, totalKm: true,
                    vehicle: { select: { plate: true } },
                    stops: { select: { status: true, isReturnToBase: true } }
                }
            }
        },
        orderBy: { date: 'asc' }
    });
    return viajes.map((t: any) => {
        const r = t.linkedRoute;
        const paradas = (r?.stops || []).filter((s: any) => !s.isReturnToBase);
        const entregadas = paradas.filter((s: any) => String(s.status).toUpperCase() === 'COMPLETED').length;
        const noEntregadas = paradas.filter((s: any) => String(s.status).toUpperCase() === 'UNDELIVERABLE').length;
        return {
            'ID viaje': t.id,
            'Fecha': soloFecha(t.date),
            'Reparto': t.reparto || '',
            'Zona': t.zone || '',
            // La subzona la pone el sistema segun el reparto; no se edita a mano
            'Subzona': t.subzona || '',
            'Localidad': t.locality || '',
            'Unidad de negocio': t.businessUnit || '',
            'Contrato': t.contractType || '',
            'Proveedor': t.provider || '',
            'Chofer': t.driver || '',
            'Auxiliar 1': t.auxiliar || '',
            'Auxiliar 2': t.auxiliar2 || '',
            'Auxiliar 3': t.auxiliar3 || '',
            'Patente': r?.vehicle?.plate || t.vehicle || '',
            'Tipo de vehiculo': t.vehicleType || '',
            'Vuelta': numero(t.vuelta),
            'Refrigerado': siNo(t.isRefrigerated),
            'Temperatura': numero(t.temperature),
            'Estado': estadoViaje(t.status, !!r?.actualEndTime),
            'Salida deposito': hora(r?.actualStartTime || t.startedAt),
            'Llegada deposito': hora(r?.actualEndTime || t.completedAt),
            'Duracion horas': duracionHoras(r?.actualStartTime || t.startedAt, r?.actualEndTime || t.completedAt),
            'Paradas planificadas': paradas.length,
            'Paradas entregadas': entregadas,
            'Paradas no entregadas': noEntregadas,
            'Km recorridos': numero(r?.totalKm),
            'Costo': numero(t.value),
            'Estado de pago': t.paymentStatus || '',
            'Fecha de pago': soloFecha(t.paymentDate)
        };
    });
}

/**
 * Una fila por movimiento de envases: "Salida" = lo que el chofer dejo,
 * "Entrada" = lo que retiro. Cada fila dice en QUE ESCUELA fue, que es el
 * dato que falta en la planilla que se carga a mano.
 */
export async function filasCajones(prisma: Prisma, desde: Date, hasta: Date) {
    const paradas = await prisma.stop.findMany({
        where: {
            route: { date: { gte: desde, lte: hasta } },
            OR: [{ cratesDelivered: { not: null } }, { cratesRecovered: { not: null } }]
        },
        select: {
            cratesDelivered: true, cratesRecovered: true, cratesUpdatedAt: true,
            actualArrival: true, sequence: true,
            client: { select: { name: true, address: true, localidad: true, partido: true } },
            route: {
                select: {
                    date: true, tripId: true,
                    driver: { select: { fullName: true, username: true } },
                    trip: { select: { reparto: true, driver: true, businessUnit: true } }
                }
            }
        },
        orderBy: { id: 'asc' }
    });
    const filas: any[] = [];
    for (const p of paradas) {
        const base = {
            'Fecha': soloFecha(p.route?.date),
            'ID viaje': p.route?.tripId ?? null,
            'Reparto': p.route?.trip?.reparto || '',
            'Unidad de negocio': p.route?.trip?.businessUnit || '',
            'Chofer': p.route?.trip?.driver || p.route?.driver?.fullName || p.route?.driver?.username || '',
            'Establecimiento': p.client?.name || '',
            'Direccion': p.client?.address || '',
            'Localidad': p.client?.localidad || '',
            'Partido': p.client?.partido || '',
            'Orden de parada': p.sequence,
            'Hora de la parada': hora(p.actualArrival),
            // El chofer puede volver mas tarde a buscar los envases con la
            // entrega ya cerrada: esta columna delata ese retiro tardio.
            'Ultima carga de envases': hora(p.cratesUpdatedAt)
        };
        if (p.cratesDelivered != null) {
            filas.push({ ...base, 'Tipo de movimiento': 'Salida', 'Tipo de envase': 'Cajon', 'Cantidad': p.cratesDelivered });
        }
        if (p.cratesRecovered != null) {
            filas.push({ ...base, 'Tipo de movimiento': 'Entrada', 'Tipo de envase': 'Cajon', 'Cantidad': p.cratesRecovered });
        }
    }
    return filas;
}

export async function filasMantenimiento(prisma: Prisma, anio: number) {
    const regs = await prisma.maintenanceRecord.findMany({ orderBy: { date: 'asc' } });
    return regs
        .filter((m: any) => !m.date || String(m.date).startsWith(String(anio)))
        .map((m: any) => ({
            'Fecha': m.date ? soloFecha(new Date(m.date)) : null,
            'Patente': m.plate || '',
            'Categoria': m.category || '',
            'Mes': m.month || '',
            'Trabajo realizado': m.workDone || '',
            'Taller o proveedor': m.workshop || '',
            'Kilometros': numero(m.mileage),
            'Costo': numero(m.cost),
            'Notas': m.notes || ''
        }));
}

export async function filasFlota(prisma: Prisma) {
    const autos = await prisma.vehicle.findMany({ orderBy: { plate: 'asc' } });
    return autos.map((v: any) => ({
        'Patente': v.plate,
        'Modelo': v.model || '',
        'Tipo de unidad': v.vehicleType || '',
        'Contrato': v.contractType || '',
        'Estado': v.status || '',
        'Chofer habitual': v.driverName || '',
        'Refrigerado': siNo(v.isRefrigerated),
        'Combustible': v.fuelType || '',
        'Km actual': numero(v.currentKm),
        'Marca': v.brand || '',
        'Anio': numero(v.year),
        'Vence VTV': soloFecha(v.vtvExpiry),
        'Vence seguro': soloFecha(v.insuranceExpiry),
        'Vence SENASA': soloFecha(v.senasaExpiry),
        'Bromatologia': v.bromatologia || '',
        'Vence licencia del chofer': v.driverLicense || '',
        'Motor': v.motor || '',
        'Chasis': v.chasis || ''
    }));
}

export async function filasIncidencias(prisma: Prisma, desde: Date, hasta: Date) {
    const incs = await prisma.incident.findMany({
        where: { createdAt: { gte: desde, lte: hasta } },
        include: { driver: { select: { fullName: true, username: true } } },
        orderBy: { createdAt: 'asc' }
    });
    const ids = [...new Set(incs.map((i: any) => i.tripId).filter((x: any) => x != null))] as number[];
    const viajes = ids.length
        ? await prisma.trip.findMany({ where: { id: { in: ids } }, select: { id: true, reparto: true, businessUnit: true } })
        : [];
    const porId = new Map(viajes.map((t: any) => [t.id, t]));
    return incs.map((i: any) => {
        const t: any = i.tripId != null ? porId.get(i.tripId) : null;
        return {
            'Fecha': soloFecha(i.createdAt),
            'Hora': hora(i.createdAt),
            'ID viaje': i.tripId ?? null,
            'Reparto': t?.reparto || '',
            'Unidad de negocio': t?.businessUnit || '',
            'Tipo': i.type || '',
            'Descripcion': i.description || '',
            'Chofer': i.driver?.fullName || i.driver?.username || '',
            'Estado': String(i.status).toUpperCase() === 'CLOSED' ? 'Cerrada' : 'Abierta',
            'Resolucion': i.resolution || '',
            'Fecha de cierre': soloFecha(i.closedAt)
        };
    });
}

// ─────────────────────────── Armado de los Excel ───────────────────────────

export type ArchivoReporte = { nombre: string; hoja: string; filas: any[]; buffer: Buffer };

/** Un Excel de una sola hoja. Sin filas vacias arriba ni nada raro. */
function aExcel(hoja: string, filas: any[], columnas: string[]): Buffer {
    const ws = filas.length
        ? XLSX.utils.json_to_sheet(filas, { header: columnas, cellDates: true })
        : XLSX.utils.aoa_to_sheet([columnas]);
    ws['!cols'] = columnas.map((c) => ({ wch: Math.min(Math.max(c.length + 2, 10), 34) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, hoja);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
}

/** Encabezados en un orden fijo: si un mes no hay datos, las columnas siguen estando. */
const COLUMNAS: Record<string, string[]> = {
    viajes: ['ID viaje', 'Fecha', 'Reparto', 'Zona', 'Subzona', 'Localidad', 'Unidad de negocio', 'Contrato', 'Proveedor',
        'Chofer', 'Auxiliar 1', 'Auxiliar 2', 'Auxiliar 3', 'Patente', 'Tipo de vehiculo', 'Vuelta', 'Refrigerado',
        'Temperatura', 'Estado', 'Salida deposito', 'Llegada deposito', 'Duracion horas', 'Paradas planificadas',
        'Paradas entregadas', 'Paradas no entregadas', 'Km recorridos', 'Costo', 'Estado de pago', 'Fecha de pago'],
    cajones: ['Fecha', 'ID viaje', 'Reparto', 'Unidad de negocio', 'Chofer', 'Establecimiento', 'Direccion',
        'Localidad', 'Partido', 'Orden de parada', 'Tipo de movimiento', 'Tipo de envase', 'Cantidad', 'Hora de la parada',
        'Ultima carga de envases'],
    mantenimiento: ['Fecha', 'Patente', 'Categoria', 'Mes', 'Trabajo realizado', 'Taller o proveedor',
        'Kilometros', 'Costo', 'Notas'],
    flota: ['Patente', 'Modelo', 'Marca', 'Anio', 'Tipo de unidad', 'Contrato', 'Estado', 'Chofer habitual',
        'Refrigerado', 'Combustible', 'Km actual', 'Vence VTV', 'Vence seguro', 'Vence SENASA', 'Bromatologia',
        'Vence licencia del chofer', 'Motor', 'Chasis'],
    incidencias: ['Fecha', 'Hora', 'ID viaje', 'Reparto', 'Unidad de negocio', 'Tipo', 'Descripcion', 'Chofer',
        'Estado', 'Resolucion', 'Fecha de cierre']
};

/** Los cinco archivos del anio en curso, listos para subir. */
export async function armarReporte(prisma: Prisma, anio?: number): Promise<ArchivoReporte[]> {
    const a = anio || new Date().getFullYear();
    // Todo el anio: la Torre compara periodos y necesita el historial entero.
    const desde = new Date(Date.UTC(a, 0, 1, 0, 0, 0));
    const hasta = new Date(Date.UTC(a, 11, 31, 23, 59, 59));

    const [viajes, cajones, mantenimiento, flota, incidencias] = await Promise.all([
        filasViajes(prisma, desde, hasta),
        filasCajones(prisma, desde, hasta),
        filasMantenimiento(prisma, a),
        filasFlota(prisma),
        filasIncidencias(prisma, desde, hasta)
    ]);

    const armar = (clave: string, nombre: string, hoja: string, filas: any[]): ArchivoReporte => ({
        nombre, hoja, filas, buffer: aExcel(hoja, filas, COLUMNAS[clave])
    });

    return [
        armar('viajes', `TMS VIAJES ${a}.xlsx`, 'Viajes', viajes),
        armar('cajones', `TMS CAJONES ${a}.xlsx`, 'Cajones', cajones),
        armar('mantenimiento', `TMS MANTENIMIENTO ${a}.xlsx`, 'Mantenimiento', mantenimiento),
        armar('flota', `TMS FLOTA.xlsx`, 'Flota', flota),
        armar('incidencias', `TMS INCIDENCIAS ${a}.xlsx`, 'Incidencias', incidencias)
    ];
}
