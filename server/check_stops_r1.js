
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const r1 = await prisma.routeTemplate.findFirst({
        where: { name: 'R1' },
        include: { stops: { orderBy: { sequence: 'asc' } } }
    });

    if (!r1) {
        console.log('No se encontró la ruta R1.');
        return;
    }

    const clients = await prisma.client.findMany();
    const clientMap = new Map();
    clients.forEach(c => {
        if (c.name) {
            clientMap.set(c.name.trim().toUpperCase(), c);
        }
    });

    console.log(`--- REPORTE DE UBICACIONES RUTA: ${r1.name} ---`);
    console.log(`Paradas totales: ${r1.stops.length}\n`);

    const results = r1.stops.map((stop, i) => {
        const nameNorm = stop.name ? stop.name.trim().toUpperCase() : '';
        const client = clientMap.get(nameNorm);
        const hasLocation = !!client && (client.latitude !== null && client.latitude !== 0 && client.latitude !== undefined);
        return {
            index: i + 1,
            name: stop.name,
            hasLocation,
            address: client ? client.address : 'SIN DIRECCIÓN EN ESCUELAS'
        };
    });

    const available = results.filter(r => r.hasLocation);
    const missing = results.filter(r => !r.hasLocation);

    console.log('--- CON UBICACIÓN (LISTOS PARA RUTEAR) ---');
    available.forEach(r => {
        console.log(`${String(r.index).padStart(2, ' ')}. [✓] ${r.name}`);
    });

    if (missing.length > 0) {
        console.log('\n--- SIN UBICACIÓN (NOMBRES NO COINCIDEN O SIN COORDENADAS) ---');
        missing.forEach(r => {
            console.log(`${String(r.index).padStart(2, ' ')}. [✗] ${r.name}`);
        });
    }

  } catch (err) {
    console.error('Error durante la ejecución:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
