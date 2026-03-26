
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const drivers = await prisma.user.findMany({ where: { role: 'DRIVER' } });
  console.log('Drivers in DB:', JSON.stringify(drivers, null, 2));

  const uniqueDriversInTrips = await prisma.trip.findMany({
    select: { driver: true },
    distinct: ['driver'],
  });
  console.log('Unique driver names in Trips:', JSON.stringify(uniqueDriversInTrips, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
