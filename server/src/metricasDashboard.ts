/**
 * Numeros operativos del mes para el dashboard logistico.
 *
 * El dashboard que habia miraba solo plata. Estos numeros salen de lo que
 * cargan los choferes: paradas entregadas, horas reales, envases y problemas.
 * Se calculan en el servidor porque necesitan las paradas de cada viaje, que
 * no viajan en el listado de viajes.
 */
type Prisma = any;

const TZ = 'America/Argentina/Buenos_Aires';

function ymdBA(f: Date | null | undefined): string {
    if (!f) return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(f));
}

const redondear = (n: number, dec = 1) => Math.round(n * 10 ** dec) / 10 ** dec;
const porcentaje = (parte: number, total: number) => (total > 0 ? redondear((parte / total) * 100) : null);

export async function metricasDelMes(prisma: Prisma, desde: Date, hasta: Date) {
    const viajes = await prisma.trip.findMany({
        where: { date: { gte: desde, lte: hasta } },
        select: {
            id: true, date: true, reparto: true, subzona: true, zone: true, businessUnit: true,
            contractType: true, driver: true, status: true, isManual: true, startedAt: true, completedAt: true,
            linkedRoute: {
                select: {
                    actualStartTime: true, actualEndTime: true,
                    stops: {
                        select: {
                            status: true, isReturnToBase: true, actualArrival: true,
                            cratesDelivered: true, cratesRecovered: true,
                            client: { select: { name: true, localidad: true } }
                        }
                    }
                }
            }
        }
    });

    const cerrado = (t: any) => !!(t.linkedRoute?.actualEndTime || ['COMPLETED', 'RETURNED'].includes(String(t.status || '').toUpperCase()));

    let planificadas = 0, entregadas = 0, noEntregadas = 0;
    let horasTotales = 0, viajesConHoras = 0;
    let dejados = 0, retirados = 0;

    const porReparto = new Map<string, { viajes: number; planificadas: number; entregadas: number; noEntregadas: number }>();
    const porDia = new Map<string, { viajes: number; entregadas: number; noEntregadas: number; dejados: number; retirados: number }>();
    const porEscuela = new Map<string, { dejados: number; retirados: number; localidad: string }>();

    for (const t of viajes) {
        const paradas = (t.linkedRoute?.stops || []).filter((s: any) => !s.isReturnToBase);
        const hechas = paradas.filter((s: any) => String(s.status).toUpperCase() === 'COMPLETED').length;
        const fallidas = paradas.filter((s: any) => String(s.status).toUpperCase() === 'UNDELIVERABLE').length;

        planificadas += paradas.length;
        entregadas += hechas;
        noEntregadas += fallidas;

        // Duracion real: solo viajes cerrados y con las dos horas puestas
        const ini = t.linkedRoute?.actualStartTime || t.startedAt;
        const fin = t.linkedRoute?.actualEndTime || t.completedAt;
        if (ini && fin) {
            const h = (new Date(fin).getTime() - new Date(ini).getTime()) / 3600000;
            if (h > 0 && h < 24) { horasTotales += h; viajesConHoras++; }
        }

        const rep = String(t.reparto || 'Sin reparto').toUpperCase();
        if (!porReparto.has(rep)) porReparto.set(rep, { viajes: 0, planificadas: 0, entregadas: 0, noEntregadas: 0 });
        const r = porReparto.get(rep)!;
        r.viajes++; r.planificadas += paradas.length; r.entregadas += hechas; r.noEntregadas += fallidas;

        const dia = ymdBA(t.date);
        if (!porDia.has(dia)) porDia.set(dia, { viajes: 0, entregadas: 0, noEntregadas: 0, dejados: 0, retirados: 0 });
        const d = porDia.get(dia)!;
        d.viajes++; d.entregadas += hechas; d.noEntregadas += fallidas;

        for (const s of t.linkedRoute?.stops || []) {
            const sale = Number(s.cratesDelivered) || 0;
            const vuelve = Number(s.cratesRecovered) || 0;
            if (!sale && !vuelve) continue;
            dejados += sale; retirados += vuelve;
            d.dejados += sale; d.retirados += vuelve;
            const nombre = s.client?.name || '(sin escuela)';
            if (!porEscuela.has(nombre)) porEscuela.set(nombre, { dejados: 0, retirados: 0, localidad: s.client?.localidad || '' });
            const e = porEscuela.get(nombre)!;
            e.dejados += sale; e.retirados += vuelve;
        }
    }

    const incidencias = await prisma.incident.findMany({
        where: { createdAt: { gte: desde, lte: hasta } },
        select: { type: true, status: true }
    });
    const porTipoIncidencia: Record<string, number> = {};
    for (const i of incidencias) {
        const k = String(i.type || 'OTRO').toUpperCase();
        porTipoIncidencia[k] = (porTipoIncidencia[k] || 0) + 1;
    }

    const cerrados = viajes.filter(cerrado).length;

    return {
        viajes: {
            total: viajes.length,
            cerrados,
            sinCerrar: viajes.length - cerrados,
            manuales: viajes.filter((t: any) => t.isManual).length,
            propios: viajes.filter((t: any) => String(t.contractType || '').toUpperCase() === 'PROPIO').length,
            tercerizados: viajes.filter((t: any) => String(t.contractType || '').toUpperCase() !== 'PROPIO').length
        },
        paradas: {
            planificadas,
            entregadas,
            noEntregadas,
            pendientes: planificadas - entregadas - noEntregadas,
            cumplimiento: porcentaje(entregadas, planificadas)
        },
        duracion: {
            promedioHoras: viajesConHoras ? redondear(horasTotales / viajesConHoras, 2) : null,
            viajesMedidos: viajesConHoras,
            sinMedir: viajes.length - viajesConHoras
        },
        cajones: {
            dejados,
            retirados,
            saldo: dejados - retirados,
            recupero: porcentaje(retirados, dejados),
            escuelas: [...porEscuela.entries()]
                .map(([escuela, v]) => ({ escuela, localidad: v.localidad, dejados: v.dejados, retirados: v.retirados, saldo: v.dejados - v.retirados }))
                .filter((x) => x.saldo > 0)
                .sort((a, b) => b.saldo - a.saldo)
                .slice(0, 12)
        },
        incidencias: {
            total: incidencias.length,
            abiertas: incidencias.filter((i: any) => String(i.status).toUpperCase() !== 'CLOSED').length,
            porTipo: porTipoIncidencia
        },
        porReparto: [...porReparto.entries()]
            .map(([reparto, v]) => ({ reparto, ...v, cumplimiento: porcentaje(v.entregadas, v.planificadas) }))
            .filter((x) => x.planificadas > 0)
            .sort((a, b) => (a.cumplimiento ?? 100) - (b.cumplimiento ?? 100)),
        porDia: [...porDia.entries()]
            .filter(([dia]) => dia)
            .map(([dia, v]) => ({ dia, ...v }))
            .sort((a, b) => a.dia.localeCompare(b.dia))
    };
}
