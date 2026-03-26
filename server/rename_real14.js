
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('--- ACTUALIZANDO NOMBRES DE REAL 14 NEUMATICOS A REAL 14 ---');
        
        // 1. Update the client in the database
        const client = await prisma.client.findFirst({
            where: { name: 'REAL 14 NEUMATICOS' }
        });
        
        if (client) {
            await prisma.client.update({
                where: { id: client.id },
                data: { name: 'REAL 14' }
            });
            console.log(`Cliente actualizado: ID ${client.id} -> "REAL 14"`);
        } else {
            console.log('No se encontró el cliente "REAL 14 NEUMATICOS".');
        }

        // 2. Update all route stop templates (for R1 and any other route)
        const stops = await prisma.routeStopTemplate.findMany({
            where: { name: 'REAL 14 NEUMATICOS' }
        });

        for (const stop of stops) {
            await prisma.routeStopTemplate.update({
                where: { id: stop.id },
                data: { name: 'REAL 14' }
            });
            console.log(`Parada de ruta actualizada: ID ${stop.id} -> "REAL 14"`);
        }

        console.log('--- ACTUALIZACIÓN COMPLETADA ---');

    } catch (err) {
        console.error('Error durante la ejecución:', err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
