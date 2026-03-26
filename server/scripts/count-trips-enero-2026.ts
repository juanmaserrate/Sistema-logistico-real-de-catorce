import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const start = new Date(2026, 0, 1, 0, 0, 0, 0);
  const end = new Date(2026, 1, 0, 23, 59, 59, 999);
  const total = await p.trip.count({ where: { date: { gte: start, lte: end } } });
  const completed = await p.trip.count({
    where: { date: { gte: start, lte: end }, status: 'COMPLETED' },
  });
  const byDay = await p.trip.groupBy({
    by: ['date'],
    where: { date: { gte: start, lte: end } },
    _count: { id: true },
  });
  const days = byDay.length;
  const maxDay = byDay.reduce((m, x) => Math.max(m, x._count.id), 0);
  const avgDay = days ? total / days : 0;

  const trips = await p.trip.findMany({
    where: { date: { gte: start, lte: end } },
    select: { id: true },
  });
  const ids = trips.map((t) => t.id);
  let avgStopsPerTrip = 0;
  if (ids.length) {
    const perTrip = await p.tripStop.groupBy({
      by: ['tripId'],
      where: { tripId: { in: ids } },
      _count: { id: true },
    });
    const sum = perTrip.reduce((s, r) => s + r._count.id, 0);
    avgStopsPerTrip = perTrip.length ? sum / perTrip.length : 0;
  }

  const diasCalendarioEnero = 31;
  const viajesPorDiaCalendario = Math.round((total / diasCalendarioEnero) * 10) / 10;

  const rStart = start;
  const rEnd = end;
  const routesJan = await p.route.findMany({
    where: { date: { gte: rStart, lte: rEnd } },
    select: { id: true, stops: { select: { id: true } } },
  });
  const routeCount = routesJan.length;
  const avgStopsRoute =
    routesJan.length > 0
      ? routesJan.reduce((s, r) => s + r.stops.length, 0) / routesJan.length
      : 0;

  console.log(
    JSON.stringify(
      {
        enero2026_total_viajes: total,
        enero2026_completados_COMPLETED: completed,
        grupos_fecha_distintos_en_db: days,
        max_viajes_mismo_timestamp_grupo: maxDay,
        promedio_viajes_por_grupo_fecha: Math.round(avgDay * 10) / 10,
        viajes_por_dia_promedio_31_dias: viajesPorDiaCalendario,
        paradas_promedio_por_viaje_con_paradas: Math.round(avgStopsPerTrip * 10) / 10,
        rutas_ejecucion_enero_Route: routeCount,
        paradas_promedio_por_Route_enero: Math.round(avgStopsRoute * 10) / 10,
      },
      null,
      2
    )
  );
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
