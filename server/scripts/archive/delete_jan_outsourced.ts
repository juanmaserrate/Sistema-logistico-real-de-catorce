import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const startOfMonth = new Date('2026-01-01T00:00:00Z');
  const endOfMonth = new Date('2026-01-31T23:59:59Z');

  const deleted = await prisma.trip.deleteMany({
    where: {
      contractType: 'Tercerizado',
      date: {
        gte: startOfMonth,
        lte: endOfMonth
      }
    }
  });

  console.log(`Successfully deleted ${deleted.count} outsourced (tercerizados) trips from January 2026.`);
}

main()
  .catch((e) => {
    console.error('Error deleting trips:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
