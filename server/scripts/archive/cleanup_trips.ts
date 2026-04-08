import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Delete trip 192
  try {
    const deleted = await prisma.trip.delete({ where: { id: 192 } });
    console.log(`Trip 192 deleted: ${deleted.id}`);
  } catch (e) {
    console.log(`Trip 192 could not be deleted or doesn't exist`);
  }

  // 2. Move trips 193 and 194 to Jan 12th
  const idsToUpdate = [193, 194];
  for (const id of idsToUpdate) {
    const trip = await prisma.trip.findUnique({ where: { id } });
    if (trip) {
      const newDate = new Date(trip.date);
      newDate.setUTCDate(12);
      newDate.setUTCMonth(0); // January
      newDate.setUTCFullYear(2026);

      const updateData: any = { date: newDate };

      if (trip.exitTime) {
        const newExit = new Date(trip.exitTime);
        newExit.setUTCDate(12);
        newExit.setUTCMonth(0);
        newExit.setUTCFullYear(2026);
        updateData.exitTime = newExit;
      }

      if (trip.returnTime) {
        const newReturn = new Date(trip.returnTime);
        newReturn.setUTCDate(12);
        newReturn.setUTCMonth(0);
        newReturn.setUTCFullYear(2026);
        updateData.returnTime = newReturn;
      }

      await prisma.trip.update({
        where: { id },
        data: updateData
      });
      console.log(`Trip ${id} moved to Jan 12th`);
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
