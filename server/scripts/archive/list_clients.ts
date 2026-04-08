
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function list() {
  const clients = await prisma.client.findMany({ take: 20 });
  console.log(clients.map(c => c.name));
  await prisma.$disconnect();
}
list();
