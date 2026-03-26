/**
 * Lista repartos (plantillas RouteTemplate) con paradas sin escuela en directorio
 * o sin lat/lng válidos. Misma normalización de nombre que la API resolve-for-trip.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normClientNameForMatch(s: string | null | undefined): string {
    return String(s ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function hasValidCoords(lat: unknown, lng: unknown): boolean {
    const la = Number(lat);
    const lo = Number(lng);
    return Number.isFinite(la) && Number.isFinite(lo) && la !== 0 && lo !== 0;
}

async function main() {
    const templates = await prisma.routeTemplate.findMany({
        include: { stops: { orderBy: { sequence: 'asc' } } },
        orderBy: { name: 'asc' }
    });
    const clients = await prisma.client.findMany({
        select: { id: true, name: true, latitude: true, longitude: true }
    });
    const byNorm = new Map<string, (typeof clients)[0]>();
    for (const c of clients) {
        const n = normClientNameForMatch(c.name);
        if (n && !byNorm.has(n)) byNorm.set(n, c);
    }

    const repartosConProblema: string[] = [];
    let totalSinMatch = 0;
    let totalSinGps = 0;

    for (const rt of templates) {
        const sinMatch: string[] = [];
        const sinGps: string[] = [];
        for (const st of rt.stops) {
            const n = normClientNameForMatch(st.name);
            const c = byNorm.get(n);
            if (!c) {
                sinMatch.push(st.name);
                continue;
            }
            if (!hasValidCoords(c.latitude, c.longitude)) {
                sinGps.push(`${st.name} → cliente sin GPS`);
            }
        }
        if (sinMatch.length || sinGps.length) {
            repartosConProblema.push(rt.name);
            totalSinMatch += sinMatch.length;
            totalSinGps += sinGps.length;
            console.log('\n---', rt.name, `(${rt.stops.length} paradas en plantilla) ---`);
            if (sinMatch.length) {
                console.log('  Sin escuela en directorio (nombre no coincide):');
                sinMatch.forEach((x) => console.log('   -', x));
            }
            if (sinGps.length) {
                console.log('  Escuela hallada pero sin coordenadas válidas:');
                sinGps.forEach((x) => console.log('   -', x));
            }
        }
    }

    const ok = templates.filter((t) => !repartosConProblema.includes(t.name));
    console.log('\n========== RESUMEN ==========');
    console.log('Plantillas totales:', templates.length);
    console.log('Plantillas con al menos un problema (sin match o sin GPS):', repartosConProblema.length);
    console.log('Plantillas OK (todas las paradas con match + GPS):', ok.length);
    if (ok.length && repartosConProblema.length) {
        console.log('\nOK:', ok.map((t) => t.name).join(', '));
    }
    console.log('Paradas sin match acumuladas:', totalSinMatch);
    console.log('Paradas con match pero sin GPS:', totalSinGps);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
