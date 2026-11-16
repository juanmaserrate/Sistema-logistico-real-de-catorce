/**
 * Prueba de punta a punta del sueldo de los auxiliares en el Motor de Costos,
 * contra un servidor LOCAL con una base de prueba. NUNCA contra produccion:
 * crea y borra datos (usa junio de 2026, que en la base de prueba esta vacio).
 *
 *   DATABASE_URL=postgresql://...prueba... node scripts/probar_auxiliares_servidor.js http://localhost:3099
 */
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
const cerca = (a, b, tol = 2) => Math.abs(Number(a) - Number(b)) <= tol;
const KEY = 'r14-basestop-2026';
const H = (dia, hhmm) => new Date(`${dia}T${hhmm}:00-03:00`);

(async () => {
    const tenant = await prisma.tenant.upsert({ where: { id: 'default-tenant' }, create: { id: 'default-tenant', name: 'R14' }, update: {} });

    // ── Limpiar lo de una corrida anterior ──
    const viejos = await prisma.trip.findMany({ where: { reparto: { startsWith: 'AUXP-' } }, select: { id: true } });
    for (const t of viejos) {
        const r = await prisma.route.findFirst({ where: { tripId: t.id } });
        if (r) { await prisma.stop.deleteMany({ where: { routeId: r.id } }); await prisma.route.delete({ where: { id: r.id } }); }
        await prisma.trip.delete({ where: { id: t.id } });
    }
    await prisma.user.deleteMany({ where: { username: { in: ['aux-fijo-prueba', 'aux-jornal-prueba'] } } });
    await prisma.employeeSalary.deleteMany({ where: { year: 2026, month: 'junio', lastName: { in: ['FIJOPRUEBA', 'JORNALPRUEBA'] } } });

    // ── Fichas y sueldos de junio 2026 ──
    await prisma.user.create({ data: { tenantId: tenant.id, username: 'aux-fijo-prueba', password: '-', fullName: 'CARLOS FIJOPRUEBA', role: 'AUXILIAR', payType: 'FIJO' } });
    await prisma.user.create({ data: { tenantId: tenant.id, username: 'aux-jornal-prueba', password: '-', fullName: 'ALEXIS JORNALPRUEBA', role: 'AUXILIAR', payType: 'JORNAL' } });
    await prisma.employeeSalary.create({ data: { year: 2026, month: 'junio', lastName: 'FIJOPRUEBA', firstName: 'CARLOS', role: 'Auxiliar', grossSalary: 1_000_000, dailyWage: 45_454 } });
    await prisma.employeeSalary.create({ data: { year: 2026, month: 'junio', lastName: 'JORNALPRUEBA', firstName: 'ALEXIS', role: 'Auxiliar', grossSalary: 1_100_000, dailyWage: 50_000 } });

    // ── Viajes: 2 propios y 3 tercerizados ──
    const viaje = async (reparto, dia, contrato, desde, hasta, aux, valor = 0, aux2 = null) => {
        const t = await prisma.trip.create({ data: {
            date: new Date(dia + 'T12:00:00Z'), reparto, driver: 'CHOFER AUXP', contractType: contrato, status: 'COMPLETED',
            exitTime: H(dia, desde), returnTime: H(dia, hasta), auxiliar: aux, auxiliar2: aux2, value: valor, provider: contrato === 'Tercerizado' ? 'PROVEEDOR AUXP' : null
        } });
        return t.id;
    };
    const p1 = await viaje('AUXP-1', '2026-06-01', 'Propio', '08:00', '10:00', 'CARLOS FIJOPRUEBA', 0, 'ALEXIS JORNALPRUEBA'); // 2 h
    const t1 = await viaje('AUXP-2', '2026-06-01', 'Tercerizado', '11:00', '17:00', 'CARLOS FIJOPRUEBA', 90_000);                 // 6 h
    const t2 = await viaje('AUXP-3', '2026-06-02', 'Tercerizado', '08:00', '16:00', 'FIJOPRUEBA CARLOS', 90_000);                 // 8 h
    const p2 = await viaje('AUXP-4', '2026-06-02', 'Propio', '08:00', '12:00', 'ALEXIS JORNALPRUEBA');                             // 4 h
    const t3 = await viaje('AUXP-5', '2026-06-02', 'Tercerizado', '13:00', '17:00', 'ALEXIS JORNALPRUEBA', 80_000);               // 4 h

    // Parametros del Motor de junio: $600.000 sobre 6 h -> $100.000 la hora
    const fila = await prisma.appSettings.findUnique({ where: { key: 'costs_data' } });
    const todos = fila ? JSON.parse(fila.value || '{}') : {};
    const params = { fijo: { seguros: 600_000 }, variable: {}, horas_reales: 6, fallback_hours: 8 };
    todos['2026-junio'] = params;
    await prisma.appSettings.upsert({ where: { key: 'costs_data' }, create: { key: 'costs_data', value: JSON.stringify(todos) }, update: { value: JSON.stringify(todos) } });

    const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, d: await r.json() }; };
    const get = async (u) => { const r = await fetch(BASE + u); return { status: r.status, d: await r.json() }; };

    // Lo esperado:
    //   FIJO (Carlos): $1.000.000 en 16 h -> p1 2 h = 125.000, t1 6 h = 375.000, t2 8 h = 500.000
    //   JORNAL (Alexis): dia 1 solo p1 -> 50.000; dia 2: p2 4 h y t3 4 h -> 25.000 cada uno
    console.log('\n1. El Motor (simulacion)');
    const { status, d } = await post('/api/v1/costs/calculate-month', { month: 'junio', year: 2026, costsParams: params, dryRun: true });
    esperar('responde', status === 200, d);
    const costo = d.costoPorViaje || {};
    esperar('propio 1: 2 h x 100.000 + 125.000 (fijo) + 50.000 (jornal) = 375.000', cerca(costo[p1], 375_000), costo[p1]);
    esperar('propio 2: 4 h x 100.000 + 25.000 = 425.000', cerca(costo[p2], 425_000), costo[p2]);
    esperar('tercerizados aparte: 375.000, 500.000 y 25.000', cerca(d.auxTercerizados?.[t1], 375_000) && cerca(d.auxTercerizados?.[t2], 500_000) && cerca(d.auxTercerizados?.[t3], 25_000), d.auxTercerizados);
    esperar('el fijo entra entero: 125.000 + 375.000 + 500.000', cerca(d.auxiliares?.propios + d.auxiliares?.tercerizados, 1_000_000 + 100_000), d.auxiliares);
    esperar('nadie sin sueldo', (d.auxiliaresSinSueldo || []).length === 0, d.auxiliaresSinSueldo);

    console.log('\n2. Lo que lee el Panel');
    {
        const r = await get('/api/v1/costs/auxiliares?month=junio&year=2026');
        esperar('el mismo reparto', cerca(r.d.porViaje?.[t1], 375_000) && cerca(r.d.porViaje?.[p1], 175_000) && cerca(r.d.tercerizados, 900_000), r.d);
    }

    console.log('\n3. El costo por unidad y la coherencia del panel');
    {
        const r = await get('/api/v1/costs/unidades?month=junio&year=2026');
        const tot = (r.d.unidades || []).reduce((a, u) => ({ p: a.p + u.propio, t: a.t + u.tercerizado }), { p: 0, t: 0 });
        esperar('tercerizados = tarifas 260.000 + auxiliares 900.000', cerca(tot.t, 1_160_000), tot);
        esperar('propios = 375.000 + 425.000', cerca(tot.p, 800_000), tot);
        const c = await get(`/api/admin/panel-coherencia?key=${KEY}&month=junio&year=2026`);
        esperar('tarjetas y cuadro dan lo mismo', c.d.controles?.laPlataCierra === true && cerca(c.d.tarjetas?.costoTercerizado, 1_160_000), c.d.controles || c.d);
    }

    console.log('\n4. Calcular de verdad: el tercerizado sigue con su tarifa');
    {
        const r = await post('/api/v1/costs/calculate-month', { month: 'junio', year: 2026, costsParams: params, dryRun: false });
        esperar('responde', r.status === 200, r.d);
        const v = await prisma.trip.findMany({ where: { id: { in: [p1, t1, t3] } }, select: { id: true, value: true } });
        const val = Object.fromEntries(v.map((x) => [x.id, Number(x.value)]));
        esperar('propio guardado con su costo', cerca(val[p1], 375_000), val);
        esperar('tercerizados sin tocar (planilla de viajes)', val[t1] === 90_000 && val[t3] === 80_000, val);
    }

    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    await prisma.$disconnect();
    process.exit(todo ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
