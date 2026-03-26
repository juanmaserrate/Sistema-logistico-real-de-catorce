
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const r4 = await prisma.routeTemplate.findFirst({
            where: { name: 'R4' },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });

        if (!r4) {
            console.log('No se encontró la ruta R4.');
            return;
        }

        const fixes = {
            'EES.6': 'E.E.S 6'
        };

        for (const stop of r4.stops) {
            if (fixes[stop.name]) {
                console.log(`Corrigiendo: ${stop.name} -> ${fixes[stop.name]}`);
                await prisma.routeStopTemplate.update({
                    where: { id: stop.id },
                    data: { name: fixes[stop.name] }
                });
            }
        }

        // Output Updated Report
        const updatedR4 = await prisma.routeTemplate.findFirst({
            where: { id: r4.id },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });

        const clients = await prisma.client.findMany();
        const clientMap = new Map();
        clients.forEach(c => clientMap.set(c.name.trim().toUpperCase(), c));

        console.log('\n--- REPORTE FINAL DE COINCIDENCIAS R4 ---');
        updatedR4.stops.forEach((stop, i) => {
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
