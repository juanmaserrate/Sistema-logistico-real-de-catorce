
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSync() {
  // 1. Obtener todos los clientes (escuelas) oficiales
  const clients = await prisma.client.findMany({
    select: { name: true }
  });
  const clientNames = new Set(clients.map(c => c.name));

  // 2. Obtener todas las paradas en las plantillas de rutas (excluyendo el depósito)
  const stops = await prisma.routeStopTemplate.findMany({
    where: { NOT: { name: 'REAL 14' } },
    select: { name: true, routeTemplate: { select: { name: true } } }
  });

  const uniqueStopsInRoutes = new Set(stops.map(s => s.name));
  
  let synchronized = 0;
  const missing = [];

  for (const stopName of uniqueStopsInRoutes) {
    if (clientNames.has(stopName)) {
      synchronized++;
    } else {
      missing.push(stopName);
    }
  }

  console.log('--- Resumen de Sincronización ---');
  console.log(`Total de escuelas en base oficial: ${clientNames.size}`);
  console.log(`Total de destinos únicos en las rutas: ${uniqueStopsInRoutes.size}`);
  console.log(`✅ Destinos perfectamente sincronizados: ${synchronized}`);
  console.log(`❌ Destinos pendientes de vinculación: ${missing.length}`);

  if (missing.length > 0) {
    console.log('\nPrimeros 10 pendientes de sincronizar (no encontrados en base de escuelas):');
    console.log(missing.slice(0, 10));
  }

  await prisma.$disconnect();
}

checkSync();
