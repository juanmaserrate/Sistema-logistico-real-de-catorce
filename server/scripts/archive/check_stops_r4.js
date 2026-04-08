
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const rn = await prisma.routeTemplate.findFirst({
        where: { name: 'R4' },
        include: { stops: { orderBy: { sequence: 'asc' } } }
    });

    if (!rn) {
        console.log('No se encontró la ruta R4.');
        return;
    }

    const clients = await prisma.client.findMany();
    const clientMap = new Map();
    clients.forEach(c => {
        if (c.name) {
            clientMap.set(c.name.trim().toUpperCase(), c);
        }
    });

    console.log(`--- REPORTE DE UBICACIONES RUTA: ${rn.name} ---`);
    console.log(`Paradas totales: ${rn.stops.length}\n`);

    rn.stops.forEach((stop, i) => {
        const nameNorm = stop.name ? stop.name.trim().toUpperCase() : '';
        const client = clientMap.get(nameNorm);
        const hasLocation = !!client && (client.latitude !== null && client.latitude !== 0 && client.latitude !== undefined);
        console.log(`${String(i + 1).padStart(2, ' ')}. [${hasLocation ? '✓' : '✗'}] ${stop.name}`);
    });

  } catch (err) {
    console.error('Error durante la ejecución:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
