
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function count() {
  const c = await prisma.client.count();
  console.log('Total clients:', c);
  const sample = await prisma.client.findMany({ take: 5 });
  console.log('Sample:', sample);
  await prisma.$disconnect();
}
count();
