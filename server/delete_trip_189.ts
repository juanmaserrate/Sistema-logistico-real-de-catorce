import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const deleted = await prisma.trip.delete({
      where: { id: 189 }
    });
    console.log(`Trip 189 successfully deleted: ID ${deleted.id}`);
  } catch (e: any) {
    if (e.code === 'P2025') {
      console.log('Trip 189 was not found in the database.');
    } else {
      console.error('An error occurred:', e.message);
    }
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
