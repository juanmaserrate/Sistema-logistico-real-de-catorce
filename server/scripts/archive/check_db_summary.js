
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const clients = await prisma.client.count();
    const templates = await prisma.routeTemplate.count();
    const stops = await prisma.routeStopTemplate.count();
    console.log('--- DB SUMMARY ---');
    console.log('Clients:', clients);
    console.log('RouteTemplates:', templates);
    console.log('RouteStopTemplates:', stops);
    
    if (templates > 0) {
        const first = await prisma.routeTemplate.findFirst({ include: { stops: true } });
        console.log('First template:', first.name, 'with', first.stops.length, 'stops');
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
