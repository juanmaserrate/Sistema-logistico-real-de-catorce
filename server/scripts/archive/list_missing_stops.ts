
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listMissing() {
  const clients = await prisma.client.findMany({ select: { name: true } });
  const clientNames = new Set(clients.map(c => c.name));

  const stops = await prisma.routeStopTemplate.findMany({
    where: { NOT: { name: 'REAL 14' } },
    include: { routeTemplate: true }
  });

  const missingMap = new Map<string, string[]>();
  stops.forEach(s => {
    if (!clientNames.has(s.name)) {
      if (!missingMap.has(s.name)) missingMap.set(s.name, []);
      missingMap.get(s.name)!.push(s.routeTemplate.name);
    }
  });

  const sortedMissing = Array.from(missingMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  console.log('| Nombre en Ruta | Repartos donde aparece |');
  console.log('| :--- | :--- |');
  sortedMissing.forEach(([name, routes]) => {
    console.log(`| ${name} | ${routes.join(', ')} |`);
  });

  await prisma.$disconnect();
}

listMissing();
