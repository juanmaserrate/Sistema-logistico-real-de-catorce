import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const trip = await prisma.trip.create({
    data: {
      date: new Date('2026-01-08T12:00:00Z'),
      zone: 'QUILMES',
      driver: 'MARCELO BASTIDA',
      auxiliar: 'A/WALT',
      reparto: 'UDI5',
      contractType: 'Propio',
      provider: 'R14 LOG',
      exitTime: new Date('2026-01-08T09:15:00'),
      returnTime: new Date('2026-01-08T12:30:00'),
      businessUnit: 'DMC',
      status: 'COMPLETED'
    }
  });
  console.log('Trip created with ID:', trip.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
