
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const clients = await prisma.client.findMany();
        const clientNames = clients.map(c => c.name);

        function findBestMatch(stopName) {
            const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const sNorm = norm(stopName);
            
            // Mapping rules
            let target = stopName.toUpperCase();
            if (target.startsWith('EP.')) target = target.replace('EP.', 'E.P.B ');
            if (target.startsWith('EP ')) target = target.replace('EP ', 'E.P.B ');
            if (target.startsWith('J.')) target = target.replace('J.', 'JARDIN ');
            if (target.startsWith('J ')) target = target.replace('J ', 'JARDIN ');
            if (target.startsWith('REAL 14')) target = 'REAL 14';

            const targetNorm = norm(target);

            // 1. Exact or rule-based match
            for (const cName of clientNames) {
                if (norm(cName) === targetNorm) return cName;
            }
            
            // 2. Number-based search for EP/J
            const numMatch = stopName.match(/\d+/);
            if (numMatch) {
                const num = numMatch[0];
                const prefix = stopName.toUpperCase().includes('J') ? 'JARDIN' : 'EP';
                for (const cName of clientNames) {
                    const cUpper = cName.toUpperCase();
                    if (cUpper.includes(prefix) && cUpper.includes(num)) return cName;
                }
            }
            return null;
        }

        const r2 = await prisma.routeTemplate.findFirst({
            where: { name: 'R2' },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });

        if (!r2) {
            console.log('No se encontró la ruta R2.');
            return;
        }

        console.log(`--- PROCESANDO LIMPIEZA RUTA: ${r2.name} ---`);
        for (const stop of r2.stops) {
            const match = findBestMatch(stop.name);
            if (match && match !== stop.name) {
                console.log(`Renombrando: "${stop.name}" -> "${match}"`);
                await prisma.routeStopTemplate.update({
                    where: { id: stop.id },
                    data: { name: match }
                });
            }
        }

        // Final Report
        const updatedR2 = await prisma.routeTemplate.findFirst({
            where: { id: r2.id },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });

        const clientMap = new Map();
        clients.forEach(c => clientMap.set(c.name.trim().toUpperCase(), c));

        console.log('\n--- REPORTE FINAL DE COINCIDENCIAS R2 ---');
        updatedR2.stops.forEach((stop, i) => {
            const found = clientMap.get(stop.name.trim().toUpperCase());
            const hasLoc = !!found && found.latitude !== null && found.latitude !== 0;
            console.log(`${String(i+1).padStart(2, ' ')}. [${hasLoc ? '✓' : '✗'}] ${stop.name}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
