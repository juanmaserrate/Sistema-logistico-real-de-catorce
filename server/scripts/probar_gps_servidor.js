/**
 * Prueba de punta a punta del GPS contra un servidor LOCAL con una base de
 * prueba. NUNCA correr contra produccion: crea y borra datos.
 *
 *   DATABASE_URL=postgresql://...prueba... node scripts/probar_gps_servidor.js http://localhost:3099
 */
const { PrismaClient } = require('@prisma/client');

const BASE = process.argv[2] || 'http://localhost:3099';
if (/r14trafico\.com/.test(BASE) || !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')) {
    console.error('Esta prueba es solo para un servidor y una base locales.');
    process.exit(1);
}
const prisma = new PrismaClient();
let todo = true;
const esperar = (que, ok, detalle) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const post = (u, b) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const patch = (u, b) => fetch(BASE + u, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Actor-Name': 'prueba' }, body: JSON.stringify(b) });

(async () => {
    // ── Datos de prueba ──
    await prisma.appSettings.deleteMany({ where: { key: 'gps_config' } });
    const tenant =await prisma.tenant.upsert({ where: { id: 'default-tenant' }, create: { id: 'default-tenant', name: 'R14' }, update: {} });
    const escuela = await prisma.client.create({ data: { tenantId: tenant.id, name: 'EP PRUEBA GPS', latitude: -34.8000, longitude: -58.4000 } });
    const trip = await prisma.trip.create({ data: { date: new Date(), reparto: 'R99', driver: 'CHOFER PRUEBA', status: 'OUT_OF_PLANT' } });
    const route = await prisma.route.create({ data: { tenantId: tenant.id, date: new Date(), tripId: trip.id, status: 'IN_PROGRESS', actualStartTime: new Date(Date.now() - 3600_000) } });
    const parada = await prisma.stop.create({ data: { routeId: route.id, clientId: escuela.id, sequence: 1 } });
    const parada2 = await prisma.stop.create({ data: { routeId: route.id, clientId: escuela.id, sequence: 2 } });
    const dev = 'celu-prueba-' + Date.now();

    console.log('\n1. Configuracion: apagado por defecto; se prende para un chofer');
    {
        const c0 = await (await fetch(`${BASE}/api/v1/tracking/config?driverId=ch1&deviceId=${dev}`)).json();
        esperar('sin configurar: camino viejo cada 5 s', c0.lotes === false && c0.intervaloMs === 5000, c0);
        const r = await post('/api/admin/gps-config', { key: 'r14-basestop-2026', lotes: ['ch1'], intervaloMs: 2000, distanciaM: 10 });
        esperar('se guarda', r.ok, r.status);
        const c1 = await (await fetch(`${BASE}/api/v1/tracking/config?driverId=ch1&deviceId=${dev}`)).json();
        const c2 = await (await fetch(`${BASE}/api/v1/tracking/config?driverId=otro&deviceId=x`)).json();
        esperar('el chofer elegido: lotes cada 2 s', c1.lotes === true && c1.intervaloMs === 2000 && c1.distanciaM === 10, c1);
        esperar('los demas siguen igual', c2.lotes === false && c2.intervaloMs === 5000, c2);
    }

    console.log('\n2. Lote desordenado, con un rebote y un impreciso');
    const ahora = Date.now();
    const pt = (segAtras, norte, extra = {}) => ({ lat: -34.8 + norte * 0.0001, lng: -58.4, acc: 8, t: new Date(ahora - segAtras * 1000).toISOString(), ...extra });
    {
        const lote = [pt(10, 2), pt(20, 0), pt(15, 1), { lat: -34.77, lng: -58.4, acc: 8, t: new Date(ahora - 12000).toISOString() }, pt(5, 3, { acc: 400 }), pt(0, 4)];
        const r = await (await post('/api/v1/tracking/lote', { deviceId: dev, deviceLabel: 'Reparto 99', driverId: 'ch1', routeId: route.id, points: lote })).json();
        esperar('guarda 4 (descarta el rebote y el impreciso)', r.guardados === 4 && r.descartados.saltos === 1 && r.descartados.imprecisos === 1, r);
        const filas = await prisma.deviceLocation.findMany({ where: { deviceId: dev }, orderBy: { timestamp: 'asc' } });
        esperar('quedan en orden por la hora del GPS', filas.length === 4 && filas.every((f, i) => i === 0 || f.latitude > filas[i - 1].latitude), filas.map(f => f.latitude));
        esperar('la hora guardada es la del GPS', Math.abs(filas[3].timestamp.getTime() - ahora) < 1500, filas[3].timestamp);
    }

    console.log('\n3. La Torre ve el ultimo punto de cada celular');
    {
        const flota = await (await fetch(`${BASE}/api/v1/fleet/locations`)).json();
        const mio = (Array.isArray(flota) ? flota : []).find(x => x.tripId === `gps-${dev}`);
        esperar('aparece una sola vez, con el punto mas nuevo', !!mio && Math.abs(mio.lastLocation.latitude - (-34.8 + 4 * 0.0001)) < 1e-9, mio);
        esperar('con el reparto del viaje', mio && mio.reparto === 'R99', mio && mio.reparto);
    }

    console.log('\n4. Puntos viejos de la cola (llegan despues) se guardan pero no son "el ultimo"');
    {
        const r = await (await post('/api/v1/tracking/lote', { deviceId: dev, driverId: 'ch1', routeId: route.id, points: [pt(40, -2), pt(35, -1)] })).json();
        esperar('se guardan los 2', r.guardados === 2, r);
        const flota = await (await fetch(`${BASE}/api/v1/fleet/locations`)).json();
        const mio = flota.find(x => x.tripId === `gps-${dev}`);
        esperar('la Torre sigue mostrando el mas nuevo', mio && Math.abs(mio.lastLocation.latitude - (-34.8 + 4 * 0.0001)) < 1e-9, mio && mio.lastLocation);
        const hist = await (await fetch(`${BASE}/api/v1/tracking/history?routeId=${route.id}&hours=2`)).json();
        esperar('el historial sale en orden (6 puntos)', hist.count === 6 && hist.points.every((p, i) => i === 0 || new Date(p.timestamp) >= new Date(hist.points[i - 1].timestamp)), hist.points.map(p => p.latitude));
    }

    console.log('\n5. El camino viejo (de a un punto) sigue funcionando');
    {
        const r = await post('/api/v1/tracking/location', { deviceId: dev + '-viejo', deviceLabel: 'Viejo', latitude: -34.81, longitude: -58.41, accuracy: 10 });
        esperar('responde bien', r.ok, r.status);
    }

    console.log('\n6. Parada marcada CON ubicacion del celular (a ~330 m de la escuela)');
    {
        const llegada = new Date(ahora - 8000).toISOString();
        const r = await patch(`/api/v1/stops/${parada.id}`, { actualArrival: llegada, status: 'ARRIVED', llegadaUbicacion: { lat: -34.8030, lng: -58.4000, acc: 6 } });
        esperar('la marca se guarda', r.ok, r.status);
        const s = await prisma.stop.findUnique({ where: { id: parada.id } });
        esperar('con la ubicacion del celular', s.llegadaLat === -34.803 && s.ubicacionOrigen === 'celular', s);
    }

    console.log('\n7. Parada marcada SIN ubicacion: se completa con el recorrido');
    {
        const llegada = new Date(ahora - 10000).toISOString();   // el punto pt(10,2) es a esa hora
        const r = await patch(`/api/v1/stops/${parada2.id}`, { actualArrival: llegada, status: 'ARRIVED' });
        esperar('la marca se guarda', r.ok, r.status);
        await new Promise(ok => setTimeout(ok, 1500));
        const s = await prisma.stop.findUnique({ where: { id: parada2.id } });
        esperar('toma el punto del recorrido de esa hora', s.llegadaLat != null && Math.abs(s.llegadaLat - (-34.8 + 2 * 0.0001)) < 1e-9 && s.ubicacionOrigen === 'recorrido', s);
    }

    console.log('\n8. Solo cajones: no toca la ubicacion');
    {
        const r = await patch(`/api/v1/stops/${parada.id}`, { cratesDelivered: 3 });
        const s = await prisma.stop.findUnique({ where: { id: parada.id } });
        esperar('la ubicacion queda', r.ok && s.llegadaLat === -34.803, s);
    }

    console.log('\n9. La hoja de ruta devuelve la distancia a la escuela');
    {
        const h = await (await fetch(`${BASE}/api/v1/history/routes/${route.id}`)).json();
        const s1 = (h.stops || []).find(x => x.stopId === parada.id);
        esperar('~334 m', s1 && s1.llegadaDistanciaM >= 320 && s1.llegadaDistanciaM <= 345, s1);
    }

    console.log('\n10. Contador de Mapbox (sin token no se pide nada)');
    {
        const u = await (await fetch(`${BASE}/api/admin/mapbox-uso?key=r14-basestop-2026`)).json();
        esperar('responde con el mes y los topes', !!u.mes && u.topes && u.topes.matching === 90000, u);
    }

    console.log('\n11. Celular con el reloj 3 h atrasado: el servidor corrige la hora');
    {
        const tres = 3 * 3600_000;
        const r = await (await post('/api/v1/tracking/lote', {
            deviceId: dev + '-reloj', driverId: 'ch1', routeId: route.id,
            enviadoEn: new Date(Date.now() - tres).toISOString(),
            points: [{ lat: -34.79, lng: -58.4, acc: 5, t: new Date(Date.now() - tres - 2000).toISOString() }]
        })).json();
        const f = await prisma.deviceLocation.findFirst({ where: { deviceId: dev + '-reloj' } });
        esperar('se guarda con la hora corregida (hace ~2 s, no hace 3 h)', r.guardados === 1 && f && Math.abs(f.timestamp.getTime() - (Date.now() - 2000)) < 5000, f && f.timestamp);
    }

    // Un viaje con un hueco: 3 min andando, 10 min sin señal (4 km), 3 min andando
    const chofer = await prisma.user.create({ data: { tenantId: tenant.id, username: 'chofer-gps-' + Date.now(), password: 'x', fullName: 'CHOFER GPS', role: 'DRIVER' } });
    const trip2 = await prisma.trip.create({ data: { date: new Date(), reparto: 'R98', driver: 'CHOFER GPS', status: 'OUT_OF_PLANT' } });
    const inicio2 = Date.now() - 20 * 60000;
    const route2 = await prisma.route.create({ data: { tenantId: tenant.id, date: new Date(), tripId: trip2.id, driverId: chofer.id, status: 'IN_PROGRESS', actualStartTime: new Date(inicio2) } });
    const lote2 = [];
    for (let i = 0; i < 30; i++) lote2.push({ lat: -34.8 + (i * 60) / 111000, lng: -58.4, acc: 5, t: new Date(inicio2 + 60000 + i * 6000).toISOString() });
    for (let i = 0; i < 30; i++) lote2.push({ lat: -34.8 + (5800 + i * 60) / 111000, lng: -58.4, acc: 5, t: new Date(inicio2 + 60000 + 180000 + 600000 + i * 6000).toISOString() });
    await post('/api/v1/tracking/lote', { deviceId: dev + '-hueco', driverId: chofer.id, routeId: route2.id, points: lote2 });

    console.log('\n12. Recorrido en vivo (sin Mapbox en esta prueba): lo visto + el hueco aparte');
    {
        const v = await (await fetch(`${BASE}/api/v1/tracking/recorrido-vivo/${route2.id}`)).json();
        const tipos = (v.tramos || []).map(t => t.tipo).join(',');
        esperar('crudo, estimado, crudo (el hueco no se une como si fuera visto)', tipos === 'crudo,estimado,crudo', v);
        esperar('~3,4 km sin contar el hueco', v.km > 2.5 && v.km < 4.5, v.km);
    }

    console.log('\n13. Estado de choferes: cuenta el corte de GPS andando');
    {
        const ds = await (await fetch(`${BASE}/api/v1/control/driver-status`)).json();
        const fila = (ds.drivers || []).find(d => d.routeId === route2.id);
        esperar('1 corte, ~10 min sin datos', fila && fila.gpsCortes === 1 && fila.gpsMinSinDatos >= 9 && fila.gpsMinSinDatos <= 11, fila && { c: fila.gpsCortes, m: fila.gpsMinSinDatos, p: fila.gpsPuntos });
    }

    console.log('\n14. Viaje cerrado: el recorrido se arma, se guarda y lo trae la hoja de ruta');
    {
        await prisma.route.update({ where: { id: route2.id }, data: { actualEndTime: new Date(), status: 'COMPLETED' } });
        const r = await (await fetch(`${BASE}/api/v1/history/routes/${route2.id}/recorrido`, { method: 'POST' })).json();
        esperar('se arma cerrado', r.cerrado === true && (r.tramos || []).length === 3, r);
        const g = await prisma.recorridoReal.findUnique({ where: { routeId: route2.id } });
        esperar('queda guardado con su ventana', g && g.ventanaFin && g.puntos > 0, g);
        const h = await (await fetch(`${BASE}/api/v1/history/routes/${route2.id}`)).json();
        esperar('la hoja de ruta lo trae', h.recorrido && h.recorrido.tramos.length === 3, h.recorrido);
    }

    // ── Limpieza ──
    await prisma.recorridoReal.deleteMany({ where: { routeId: route2.id } });
    await prisma.route.delete({ where: { id: route2.id } });
    await prisma.trip.delete({ where: { id: trip2.id } });
    await prisma.user.delete({ where: { id: chofer.id } });
    await prisma.deviceLocation.deleteMany({ where: { deviceId: { startsWith: dev } } });
    await prisma.stop.deleteMany({ where: { routeId: route.id } });
    await prisma.route.delete({ where: { id: route.id } });
    await prisma.trip.delete({ where: { id: trip.id } });
    await prisma.client.delete({ where: { id: escuela.id } });
    await prisma.appSettings.deleteMany({ where: { key: 'gps_config' } });
    await prisma.$disconnect();
    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    process.exit(todo ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
