
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkCongruence() {
  console.log('--- Verificando congruencia entre Rutas y Escuelas ---');

  // 1. Obtener todas las escuelas (clientes) de la base
  const clients = await prisma.client.findMany({
    select: { name: true }
  });
  const clientNames = new Set(clients.map(c => c.name.trim().toUpperCase()));

  // 2. Obtener todas las paradas de las plantillas de rutas
  const stops = await prisma.routeStopTemplate.findMany({
    select: { name: true, routeTemplate: { select: { name: true } } }
  });

  const uniqueStops = new Map<string, string[]>();
  stops.forEach(s => {
    const name = s.name.trim().toUpperCase();
    if (name === 'REAL 14') return; // Ignorar el depósito
    
    if (!uniqueStops.has(name)) {
      uniqueStops.set(name, []);
    }
    uniqueStops.get(name)!.push(s.routeTemplate.name);
  });

  console.log(`Total de escuelas en base: ${clientNames.size}`);
  console.log(`Total de destinos únicos en rutas: ${uniqueStops.size}`);

  const missing = [];
  const found = [];

  for (const [stopName, routes] of uniqueStops.entries()) {
    if (clientNames.has(stopName)) {
      found.push(stopName);
    } else {
      missing.push({ name: stopName, routes: routes.join(', ') });
    }
  }

  console.log(`\n✅ Coincidencias exitosas: ${found.length}`);
  console.log(`❌ Destinos NO encontrados en base de escuelas: ${missing.length}`);

  if (missing.length > 0) {
    console.log('\nDetalle de destinos faltantes:');
    console.table(missing);
  } else {
    console.log('\nPerfecto: Todos los destinos de las rutas existen en la base de escuelas.');
  }

  await prisma.$disconnect();
}

checkCongruence();
