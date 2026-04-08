
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function dump() {
  const stops = await prisma.routeStopTemplate.findMany({ 
    where: { NOT: { name: 'REAL 14' } },
    take: 20 
  });
  console.log('Stops:', stops.map(s => s.name));
  const clients = await prisma.client.findMany({ take: 20 });
  console.log('Clients:', clients.map(c => c.name));
  await prisma.$disconnect();
}
dump();
