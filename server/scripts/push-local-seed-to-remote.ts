import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalizeBaseUrl(raw: string): string {
    let v = String(raw || '').trim();
    if (!v) throw new Error('Falta URL remota. Uso: npm run sync:push-remote -- https://tu-dominio');
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    return v.replace(/\/+$/, '');
}

function toPlain<T>(obj: T): any {
    return JSON.parse(JSON.stringify(obj));
}

async function postJson(baseUrl: string, path: string, body: any): Promise<void> {
    let attempts = 0;
    while (attempts < 5) {
        attempts++;
        const res = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) return;
        const txt = await res.text().catch(() => '');
        if ((res.status === 503 || res.status === 502 || res.status === 429) && attempts < 5) {
            await new Promise((r) => setTimeout(r, attempts * 800));
            continue;
        }
        throw new Error(`${path} -> HTTP ${res.status} ${txt}`.slice(0, 400));
    }
}

async function syncCollection<T>(
    name: string,
    rows: T[],
    fn: (row: T) => Promise<void>
): Promise<void> {
    console.log(`\n[push] ${name}: ${rows.length}`);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < rows.length; i++) {
        try {
            await fn(rows[i]);
            ok++;
        } catch (e: any) {
            fail++;
            console.warn(`[push] ${name} fallo #${i + 1}: ${e?.message || e}`);
        }
        if ((i + 1) % 100 === 0) {
            console.log(`[push] ${name}: ${i + 1}/${rows.length}`);
        }
    }
    console.log(`[push] ${name} OK=${ok} FAIL=${fail}`);
}

async function main() {
    const argUrl = process.argv[2] || process.env.REMOTE_API_URL || '';
    const only = (process.argv[3] || process.env.SYNC_ONLY || '').trim().toLowerCase();
    const baseUrl = normalizeBaseUrl(argUrl);
    console.log(`[push] Destino: ${baseUrl}`);
    if (only) console.log(`[push] Solo: ${only}`);

    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json()).catch(() => null);
    if (!health?.ok) throw new Error('El destino no responde /api/health correctamente.');
    console.log(`[push] Health OK (ready=${health?.ready})`);

    const [vehicles, clients, settings, salaries, maintenance, trips, routeTemplates] = await Promise.all([
        prisma.vehicle.findMany({ orderBy: { plate: 'asc' } }),
        prisma.client.findMany({ orderBy: { name: 'asc' } }),
        prisma.appSettings.findMany({ orderBy: { key: 'asc' } }),
        prisma.employeeSalary.findMany({ orderBy: [{ month: 'asc' }, { lastName: 'asc' }] }),
        prisma.maintenanceRecord.findMany({ orderBy: { createdAt: 'asc' } }),
        prisma.trip.findMany({ orderBy: { date: 'asc' } }),
        (prisma as any).routeTemplate.findMany({
            include: { stops: { orderBy: { sequence: 'asc' } } },
            orderBy: { name: 'asc' }
        })
    ]);

    if (!only || only === 'vehicles') await syncCollection('vehicles', vehicles, async (v: any) => {
        await postJson(baseUrl, '/api/v1/vehicles', {
            plate: v.plate,
            model: v.model ?? '',
            contractType: v.contractType ?? 'Externo',
            driverName: v.driverName ?? '',
            fuelType: v.fuelType ?? '',
            insurance: v.insurance ?? '',
            usefulLife: v.usefulLife ?? '',
            vehicleType: v.vehicleType ?? ''
        });
    });

    if (!only || only === 'clients') await syncCollection('clients', clients, async (c: any) => {
        await postJson(baseUrl, '/api/v1/clients', {
            name: c.name,
            address: c.address,
            latitude: c.latitude,
            longitude: c.longitude,
            timeWindowStart: c.timeWindowStart,
            timeWindowEnd: c.timeWindowEnd,
            serviceTime: c.serviceTime,
            zone: c.zone,
            barrio: c.barrio,
            priority: c.priority
        });
    });

    if (!only || only === 'settings') await syncCollection('settings', settings, async (s: any) => {
        await postJson(baseUrl, '/api/v1/settings', { key: s.key, value: s.value });
    });

    if (!only || only === 'salaries') await syncCollection('salaries', salaries, async (s: any) => {
        await postJson(baseUrl, '/api/v1/salaries', {
            month: s.month,
            Nombre: s.firstName ?? '',
            Apellido: s.lastName ?? '',
            'Tipo Puesto': s.role ?? '',
            Bruto: s.grossSalary ?? 0,
            Jornal: s.dailyWage ?? 0,
            Antigüedad: s.seniority ?? 0,
            'Escala Base': s.baseScale ?? 0
        });
    });

    if (!only || only === 'maintenance') await syncCollection('maintenance', maintenance, async (m: any) => {
        const row = toPlain(m);
        delete row.createdAt;
        delete row.updatedAt;
        await postJson(baseUrl, '/api/v1/maintenance', row);
    });

    if (!only || only === 'trips') await syncCollection('trips', trips, async (t: any) => {
        const row = toPlain(t);
        delete row.id;
        delete row.createdAt;
        delete row.updatedAt;
        await postJson(baseUrl, '/api/v1/trips', row);
    });

    if (!only || only === 'route-templates') await syncCollection('route-templates', routeTemplates as any[], async (rt: any) => {
        await postJson(baseUrl, '/api/v1/admin/route-templates', {
            name: rt.name,
            stops: (rt.stops || []).map((s: any) => s.name)
        });
    });

    console.log('\n[push] Finalizado. Refrescá /planificacion.html en Railway.');
}

main()
    .catch((e) => {
        console.error('[push] ERROR:', e?.message || e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

