/**
 * Prueba de punta a punta de los sueldos por anio y por persona contra un
 * servidor LOCAL con una base de prueba. NUNCA correr contra produccion.
 *
 *   DATABASE_URL=postgresql://...prueba... node scripts/probar_sueldos_servidor.js http://localhost:3099
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const BASE = process.argv[2] || 'http://localhost:3099';
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

(async () => {
    const tenant = await prisma.tenant.upsert({ where: { id: 'default-tenant' }, create: { id: 'default-tenant', name: 'R14' }, update: {} });
    const clave = crypto.randomBytes(12).toString('hex');
    await prisma.user.deleteMany({ where: { username: 'prueba-sueldos' } });
    await prisma.user.create({ data: { tenantId: tenant.id, username: 'prueba-sueldos', password: await bcrypt.hash(clave, 8), fullName: 'Prueba Sueldos', role: 'ADMIN' } });
    const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'prueba-sueldos', password: clave }) })).json();
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };
    const pedir = async (metodo, u, b) => {
        const r = await fetch(BASE + u, { method: metodo, headers: H, body: b ? JSON.stringify(b) : undefined });
        return { status: r.status, d: await r.json().catch(() => ({})) };
    };
    const contar = (where) => prisma.employeeSalary.count({ where });

    await prisma.employeeSalary.deleteMany({ where: { lastName: { in: ['RODRIGUEZ', 'RODRIGUES', 'PRUEBA'] } } });

    console.log('\n1. Dos personas con el mismo apellido el mismo mes');
    const denis = await pedir('POST', '/api/v1/salaries', { year: 2026, month: 'octubre', Apellido: 'Rodriguez', Nombre: 'DENIS', 'Tipo Puesto': 'Auxiliar', Bruto: 800000, Jornal: 0 });
    const ariel = await pedir('POST', '/api/v1/salaries', { year: 2026, month: 'octubre', Apellido: 'RODRIGUEZ', Nombre: 'ARIEL', 'Tipo Puesto': 'Auxiliar', Bruto: 0, Jornal: 40000 });
    esperar('se guardan los dos', denis.status === 200 && ariel.status === 200 && (await contar({ year: 2026, month: 'octubre', lastName: 'RODRIGUEZ' })) === 2, [denis, ariel]);
    const otraVez = await pedir('POST', '/api/v1/salaries', { year: 2026, month: 'Octubre', Apellido: 'RODRIGUEZ', Nombre: 'denis', 'Tipo Puesto': 'Auxiliar', Bruto: 810000 });
    esperar('cargar de nuevo a DENIS lo actualiza, no lo duplica', otraVez.status === 200 && otraVez.d.id === denis.d.id && otraVez.d.grossSalary === 810000 && (await contar({ year: 2026, month: 'octubre', lastName: 'RODRIGUEZ' })) === 2, otraVez);

    console.log('\n2. Octubre de otro anio no pisa al de 2026');
    const d27 = await pedir('POST', '/api/v1/salaries', { year: 2027, month: 'octubre', Apellido: 'RODRIGUEZ', Nombre: 'DENIS', 'Tipo Puesto': 'Auxiliar', Bruto: 999000 });
    const d26 = await prisma.employeeSalary.findUnique({ where: { id: denis.d.id } });
    esperar('quedan los dos octubres', d27.status === 200 && d27.d.id !== denis.d.id && d26.grossSalary === 810000 && d27.d.year === 2027, { d27: d27.d, d26 });
    const lista = await pedir('GET', '/api/v1/salaries?year=2027');
    esperar('la lista dice el anio y filtra', lista.d.length === 1 && lista.d[0].year === 2027 && lista.d[0].Bruto === 999000, lista.d);

    console.log('\n3. Editar por id');
    const choca = await pedir('POST', '/api/v1/salaries', { id: ariel.d.id, year: 2026, month: 'octubre', Apellido: 'RODRIGUEZ', Nombre: 'DENIS', Jornal: 40000 });
    esperar('no deja convertir a ARIEL en otro DENIS', choca.status === 409, choca);
    const renom = await pedir('POST', '/api/v1/salaries', { id: ariel.d.id, year: 2026, month: 'octubre', Apellido: 'RODRIGUES', Nombre: 'ARIEL', Jornal: 40000 });
    esperar('corregir el apellido cambia la misma fila', renom.status === 200 && renom.d.id === ariel.d.id && renom.d.lastName === 'RODRIGUES', renom);
    await pedir('POST', '/api/v1/salaries', { id: ariel.d.id, year: 2026, month: 'octubre', Apellido: 'RODRIGUEZ', Nombre: 'ARIEL', Jornal: 40000 });

    console.log('\n4. El Motor de Costos usa los sueldos del anio que calcula');
    const viejos = await prisma.trip.findMany({ where: { reparto: 'SUELDOS-1' }, select: { id: true } });
    for (const t of viejos) {
        const r = await prisma.route.findFirst({ where: { tripId: t.id } });
        if (r) { await prisma.stop.deleteMany({ where: { routeId: r.id } }); await prisma.route.delete({ where: { id: r.id } }); }
        await prisma.trip.delete({ where: { id: t.id } });
    }
    const trip = await prisma.trip.create({ data: { date: new Date('2026-10-15T12:00:00Z'), reparto: 'SUELDOS-1', driver: 'CHOFER X', contractType: 'Propio', businessUnit: 'SAE BROWN', auxiliar: 'DENIS RODRIGUEZ', auxiliar2: 'ARIEL RODRIGUEZ', status: 'COMPLETED' } });
    await prisma.route.create({ data: { tenantId: tenant.id, date: trip.date, tripId: trip.id, status: 'COMPLETED', actualStartTime: new Date('2026-10-15T10:00:00Z'), actualEndTime: new Date('2026-10-15T14:00:00Z') } });
    // Camion en cero: el costo del viaje es solo lo de los auxiliares
    const params = { fijo: { x: 0 }, variable: { y: 0 }, horas_reales: 100, fallback_hours: 8 };
    const motor = await pedir('POST', '/api/v1/costs/calculate-month', { month: 'octubre', year: 2026, costsParams: params, dryRun: true });
    const valor = motor.d.costoPorViaje?.[trip.id];
    // DENIS: 810.000 repartido en sus 4 h del mes -> 810.000. ARIEL: jornal 40.000
    esperar('octubre 2026: 810.000 de DENIS + 40.000 de ARIEL (no los 999.000 de 2027)', valor === 850000, { valor, sinSueldo: motor.d.auxiliaresSinSueldo });
    esperar('ningun auxiliar sin sueldo', (motor.d.auxiliaresSinSueldo || []).filter((x) => /RODRIGUEZ/.test(x.nombre)).length === 0, motor.d.auxiliaresSinSueldo);

    console.log('\n5. El control de carga busca el sueldo del anio del viaje');
    {
        const cc = await pedir('GET', '/api/v1/control-carga?desde=2026-10-15&hasta=2026-10-15');
        esperar('responde', cc.status === 200, cc.status);
        const bloque = (cc.d.bloques || []).find((b) => b.clave === 'aux_sin_sueldo');
        esperar('DENIS y ARIEL no figuran sin sueldo', bloque && !(bloque.items || []).some((x) => /RODRIGUEZ/.test(x.nombre)), bloque);
    }

    console.log('\n6. Borrar');
    const sinSesion = await fetch(`${BASE}/api/v1/salaries/${d27.d.id}`, { method: 'DELETE' });
    esperar('sin sesion no borra', sinSesion.status === 401, sinSesion.status);
    const borra = await pedir('DELETE', `/api/v1/salaries/${d27.d.id}`);
    esperar('borra solo ese (octubre 2027)', borra.status === 200 && (await contar({ id: d27.d.id })) === 0 && (await contar({ id: denis.d.id })) === 1, borra);

    await prisma.employeeSalary.deleteMany({ where: { lastName: { in: ['RODRIGUEZ', 'RODRIGUES'] } } });
    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    await prisma.$disconnect();
    process.exit(todo ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
