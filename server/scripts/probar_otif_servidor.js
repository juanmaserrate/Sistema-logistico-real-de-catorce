/**
 * Prueba de punta a punta del OTIF contra un servidor LOCAL con una base de
 * prueba. NUNCA correr contra produccion: crea y borra datos.
 *
 *   DATABASE_URL=postgresql://...prueba... node scripts/probar_otif_servidor.js http://localhost:3099 [Incidencias.xlsx]
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const BASE = process.argv[2] || 'http://localhost:3099';
const PLANILLA = process.argv[3];
if (/r14trafico\.com/.test(BASE) || !/localhost|127\.0\.0\.1/.test(BASE) || !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')) {
    console.error('Esta prueba es solo para un servidor y una base locales.');
    process.exit(1);
}
const prisma = new PrismaClient();
let todo = true;
const esperar = (que, ok, detalle) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
// Hora argentina -> Date
const H = (fecha, hhmm) => new Date(`${fecha}T${hhmm}:00-03:00`);

// El mismo lector que usa la pagina
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'planificacion.html'), 'utf8');
const leerPlanilla = new Function('XLSX', html.slice(html.indexOf('function otifLeerIncidencias(wb)'), html.indexOf('async function otifSubirIncidencias')) + '; return otifLeerIncidencias;')(XLSX);

(async () => {
    // ── Usuario de prueba (clave al azar, solo para esta base local) ──
    const tenant = await prisma.tenant.upsert({ where: { id: 'default-tenant' }, create: { id: 'default-tenant', name: 'R14' }, update: {} });
    const clave = crypto.randomBytes(12).toString('hex');
    await prisma.user.deleteMany({ where: { username: 'prueba-otif' } });
    await prisma.user.create({ data: { tenantId: tenant.id, username: 'prueba-otif', password: await bcrypt.hash(clave, 8), fullName: 'Prueba OTIF', role: 'ADMIN' } });
    const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'prueba-otif', password: clave }) })).json();
    const H_AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token, 'X-Actor-Name': 'Prueba OTIF' };
    const get = async (u) => { const r = await fetch(BASE + u, { headers: H_AUTH }); return { status: r.status, d: await r.json() }; };
    const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: H_AUTH, body: JSON.stringify(b) }); return { status: r.status, d: await r.json() }; };

    // ── Viajes de prueba: octubre 2026 ──
    await prisma.incidenciaCliente.deleteMany({});
    const viejos = await prisma.trip.findMany({ where: { reparto: { startsWith: 'OTIF-' } }, select: { id: true } });
    for (const t of viejos) {
        const r = await prisma.route.findFirst({ where: { tripId: t.id } });
        if (r) { await prisma.stop.deleteMany({ where: { routeId: r.id } }); await prisma.route.delete({ where: { id: r.id } }); }
        await prisma.trip.delete({ where: { id: t.id } });
    }
    const escuela = {};
    for (const n of ['EP 1', 'EP 2', 'EP 3', 'PROVEEDOR X', 'REAL DE CATORCE']) {
        escuela[n] = (await prisma.client.findFirst({ where: { name: n } })) || await prisma.client.create({ data: { tenantId: tenant.id, name: n } });
    }
    const viaje = async (fecha, reparto, unidad, paradas, chofer = 'CHOFER OTIF') => {
        const trip = await prisma.trip.create({ data: { date: new Date(fecha + 'T12:00:00Z'), reparto, driver: chofer, businessUnit: unidad, contractType: 'Propio', status: 'COMPLETED' } });
        const route = await prisma.route.create({ data: { tenantId: tenant.id, date: new Date(fecha + 'T12:00:00Z'), tripId: trip.id, status: 'COMPLETED' } });
        let seq = 1;
        for (const p of paradas) {
            await prisma.stop.create({ data: { routeId: route.id, clientId: escuela[p.esc].id, sequence: seq++, status: p.estado || 'COMPLETED', actualArrival: p.hora ? H(fecha, p.hora) : null, isReturnToBase: !!p.base } });
        }
    };
    await viaje('2026-10-06', 'OTIF-1', 'SAE BROWN', [{ esc: 'EP 1', hora: '08:30' }, { esc: 'EP 2', hora: '09:30' }, { esc: 'REAL DE CATORCE', hora: '10:30', base: true }]);
    await viaje('2026-10-06', 'OTIF-2', 'SAM', [{ esc: 'EP 3', hora: '15:00' }]);
    await viaje('2026-10-07', 'OTIF-3', 'RETIRO', [{ esc: 'PROVEEDOR X', hora: '07:00' }]);
    await viaje('2026-10-08', 'OTIF-4', 'SAE BROWN', [{ esc: 'EP 1', hora: '08:00' }], 'juan');        // viaje de prueba: no cuenta
    await viaje('2026-09-30', 'OTIF-5', 'SAE BROWN', [{ esc: 'EP 1', hora: '11:00' }]);               // septiembre

    console.log('\n1. Sin iniciar sesion no se ve');
    {
        const r = await fetch(BASE + '/api/v1/kpi/otif?month=octubre&year=2026');
        esperar('401', r.status === 401, r.status);
    }

    console.log('\n2. Sin incidencias: todo lo entregado es completo');
    {
        const { status, d } = await get('/api/v1/kpi/otif?month=octubre&year=2026');
        esperar('responde', status === 200, d);
        esperar('3 evaluados (sin la vuelta al deposito, el viaje de prueba, septiembre ni el retiro)', d.formula?.evaluados === 3 && d.fuera === 1, d.formula);
        esperar('2 a tiempo y completos (EP 2 llego 9:30)', d.formula?.aTiempoYCompletos === 2 && d.formula?.otif === 66.7, d.formula);
        esperar('avisa que no hay incidencias', d.incidencias?.delPeriodo === 0, d.incidencias);
    }

    if (PLANILLA) {
        console.log('\n3. Se sube la planilla real de incidencias');
        const filas = leerPlanilla(XLSX.read(fs.readFileSync(PLANILLA), { type: 'buffer' }));
        const r1 = await post('/api/v1/kpi/incidencias', { archivo: path.basename(PLANILLA), filas });
        const n1 = await prisma.incidenciaCliente.count();
        esperar(`guarda las ${filas.length} filas`, r1.status === 200 && r1.d.filas === filas.length && n1 === filas.length, { r: r1.d, n1 });
        const r2 = await post('/api/v1/kpi/incidencias', { archivo: path.basename(PLANILLA), filas });
        esperar('subirla de nuevo no duplica', r2.status === 200 && (await prisma.incidenciaCliente.count()) === filas.length, r2.d);
        const oct = filas.filter((f) => f.fecha.startsWith('2026-10')).length;
        // Solo octubre, con una incidencia de EP 1: pisa octubre y deja el resto
        const r3 = await post('/api/v1/kpi/incidencias', { archivo: 'solo_octubre.xlsx', filas: [{ fecha: '2026-10-06', unidad: 'SAE BROWN', establecimiento: 'EPB N° 1', tipo: 'FALTANTE DE PRODUCTO' }] });
        esperar('una planilla de un solo mes reemplaza solo ese mes', r3.status === 200 && (await prisma.incidenciaCliente.count()) === filas.length - oct + 1, r3.d);
    } else {
        await post('/api/v1/kpi/incidencias', { archivo: 'solo_octubre.xlsx', filas: [{ fecha: '2026-10-06', unidad: 'SAE BROWN', establecimiento: 'EPB N° 1', tipo: 'FALTANTE DE PRODUCTO' }] });
    }

    console.log('\n4. Con la incidencia de EP 1');
    {
        const { d } = await get('/api/v1/kpi/otif?month=octubre&year=2026&detalle=1');
        esperar('(1 / 3) x 100 = 33,3', d.formula?.aTiempoYCompletos === 1 && d.formula?.otif === 33.3, d.formula);
        esperar('1 incidencia cruzada', d.incidencias?.delPeriodo === 1 && d.incidencias?.asignadas === 1, d.incidencias);
        const ep1 = (d.detalle || []).find((e) => e.escuela === 'EP 1');
        esperar('el detalle dice por que', ep1?.motivo === 'Con incidencia' && ep1?.incidencias === 'FALTANTE DE PRODUCTO' && ep1?.hora === '08:30', ep1);
        esperar('queda registrada la carga', d.ultimaCarga?.archivo === 'solo_octubre.xlsx' && d.ultimaCarga?.subidoPor === 'Prueba OTIF', d.ultimaCarga);
        const u = (d.porUnidad || []).find((x) => x.unidad === 'SAE BROWN');
        esperar('por unidad: SAE BROWN 0 de 2, limite 09:00', u?.pedidos === 2 && u?.otif === 0 && u?.limite === '09:00', u);
    }

    console.log('\n5. El ano entero y un mes invalido');
    {
        // La base de prueba puede tener otros viajes: se miran solo los de esta prueba
        const { d } = await get('/api/v1/kpi/otif?year=2026&detalle=1');
        const mios = (d.detalle || []).filter((e) => String(e.reparto).startsWith('OTIF-') && e.otif !== 'Fuera');
        const sept = mios.find((e) => e.fecha === '2026-09-30');
        esperar('el ano suma septiembre (llego 11:00: tarde)', mios.length === 4 && mios.filter((e) => e.otif === 'Si').length === 1 && sept?.motivo === 'Llegó tarde', mios);
        const r = await get('/api/v1/kpi/otif?month=cualquiera&year=2026');
        esperar('mes invalido -> 400', r.status === 400, r);
        const v = await post('/api/v1/kpi/incidencias', { filas: [] });
        esperar('archivo vacio -> 400', v.status === 400, v);
    }

    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    await prisma.$disconnect();
    process.exit(todo ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
