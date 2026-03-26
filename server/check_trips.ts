
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const trips = await prisma.trip.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Last 5 trips:', JSON.stringify(trips, null, 2));
}

main();
