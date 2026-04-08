
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const r2 = await prisma.routeTemplate.findFirst({
            where: { name: 'R2' },
            include: { stops: true }
        });

        if (!r2) {
            console.log('No se encontró la ruta R2.');
            return;
        }

        const fixes = {
            'J.942': 'JARDÍN 942',
            'J.911': 'JARDÍN 911',
            'REAL 14': 'REAL 14' // ensure consistency
        };

        for (const stop of r2.stops) {
            if (fixes[stop.name]) {
                console.log(`Corrigiendo: ${stop.name} -> ${fixes[stop.name]}`);
                await prisma.routeStopTemplate.update({
                    where: { id: stop.id },
                    data: { name: fixes[stop.name] }
                });
            }
        }

        // Output Updated Report
        const updatedR2 = await prisma.routeTemplate.findFirst({
            where: { id: r2.id },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });

        const clients = await prisma.client.findMany();
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
