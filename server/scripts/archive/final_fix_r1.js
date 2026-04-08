
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const r1 = await prisma.routeTemplate.findFirst({
            where: { name: 'R1' },
            include: { stops: true }
        });

        if (!r1) {
            console.log('No se encontró la ruta R1.');
            return;
        }

        const updates = [
            { old: 'J.932', new: 'JARDÍN 932' },
            { old: 'J.915', new: 'JARDÍN 915' },
            { old: 'REAL 14', new: 'REAL 14 NEUMATICOS' }
        ];

        console.log('--- REPARANDO MISMATCHES RESTANTES R1 ---');
        for (const stop of r1.stops) {
            const fix = updates.find(u => u.old === stop.name);
            if (fix) {
                console.log(`Corrigiendo: "${stop.name}" -> "${fix.new}"`);
                await prisma.routeStopTemplate.update({
                    where: { id: stop.id },
                    data: { name: fix.new }
                });
            }
        }
        console.log('--- REPARACIÓN COMPLETADA ---\n');

        // Generar lista final de verificación
        const updatedR1 = await prisma.routeTemplate.findFirst({
            where: { id: r1.id },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });

        const clients = await prisma.client.findMany();
        const clientMap = new Map();
        clients.forEach(c => clientMap.set(c.name.trim().toUpperCase(), c));

        console.log('--- ESTADO FINAL DE PARADAS R1 ---');
        updatedR1.stops.forEach((stop, i) => {
            const found = clientMap.get(stop.name.trim().toUpperCase());
            const hasLoc = !!found && found.latitude !== null && found.latitude !== 0 && found.latitude !== undefined;
            console.log(`${String(i + 1).padStart(2, ' ')}. [${hasLoc ? '✓' : '✗'}] ${stop.name}`);
        });

    } catch (err) {
        console.error('Error durante la ejecución:', err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
