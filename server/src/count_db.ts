
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function total() {
  try {
    const clients = await prisma.client.count();
    const rt = await (prisma as any).routeTemplate.count();
    const stops = await (prisma as any).routeStopTemplate.count();
    console.log(`JSON_DATA: ${JSON.stringify({ clients, rt, stops })}`);
  } catch (e) {
    console.error("Query Error:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}
total();
