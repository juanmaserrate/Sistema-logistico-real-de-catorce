
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const templates = await prisma.routeTemplate.findMany({ 
      where: { name: 'R1' },
      include: { stops: { orderBy: { order: 'asc' } } } 
    });
    
    // Fallback if not found by name
    let r1 = templates[0];
    if (!r1) {
       console.log('No se encontro la ruta R1 por nombre.');
       process.exit(1);
    }
    
    const clients = await prisma.client.findMany();
    const clientMap = new Map();
    clients.forEach(c => {
      clientMap.set(c.name.trim().toUpperCase(), c);
    });

    console.log(`--- REPORTE DE UBICACIONES RUTA: ${r1.name} ---`);
    console.log(`Paradas totales: ${r1.stops.length}\n`);

    const results = r1.stops.map((stop, i) => {
      const nameNorm = stop.name.trim().toUpperCase();
      const client = clientMap.get(nameNorm);
      const hasLocation = !!client && (client.latitude !== null && client.latitude !== 0 && client.latitude !== undefined);
      return { 
        index: i + 1, 
        name: stop.name, 
        hasLocation,
        address: client?.address || 'SIN DIRECCION EN ESCUELAS'
      };
    });

    // Separar los que tienen ubicación de los que no
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
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
