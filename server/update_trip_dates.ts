import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const ids = [195, 196, 197];
  
  for (const id of ids) {
    const trip = await prisma.trip.findUnique({ where: { id } });
    if (trip) {
      // Update date to Jan 9th
      const newDate = new Date(trip.date);
      newDate.setUTCDate(9);
      newDate.setUTCMonth(0); // January
      newDate.setUTCFullYear(2026);

      const updateData: any = { date: newDate };

      if (trip.exitTime) {
        const newExit = new Date(trip.exitTime);
        newExit.setUTCDate(9);
        newExit.setUTCMonth(0);
        newExit.setUTCFullYear(2026);
        updateData.exitTime = newExit;
      }

      if (trip.returnTime) {
        const newReturn = new Date(trip.returnTime);
        newReturn.setUTCDate(9);
        newReturn.setUTCMonth(0);
        newReturn.setUTCFullYear(2026);
        updateData.returnTime = newReturn;
      }

      await prisma.trip.update({
        where: { id },
        data: updateData
      });
      console.log(`Trip ${id} updated to Jan 9th`);
    } else {
      console.log(`Trip ${id} not found`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
