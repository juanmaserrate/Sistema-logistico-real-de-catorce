
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRouteHealth() {
  try {
    const clients = await prisma.client.findMany({ select: { name: true } });
    const clientNames = new Set(clients.map(c => c.name));

    const templates = await prisma.routeTemplate.findMany({
      include: { stops: { orderBy: { sequence: 'asc' } } }
    });

    console.log('--- REPORTE DE SALUD DE REPARTOS ---');
    console.log('| Reparto | Total Paradas* | Sincronizadas | Pendientes | % Salud |');
    console.log('| :--- | :---: | :---: | :---: | :---: |');

    templates.forEach(rt => {
      // Excluimos Real 14 del conteo de paradas a sincronizar ya que es el deposito
      const deliveryStops = rt.stops.filter(s => s.name !== 'REAL 14');
      const synced = deliveryStops.filter(s => clientNames.has(s.name)).length;
      const pending = deliveryStops.length - synced;
      const health = deliveryStops.length > 0 ? Math.round((synced / deliveryStops.length) * 100) : 100;

      console.log(`| ${rt.name} | ${deliveryStops.length} | ${synced} | ${pending} | ${health}% |`);
    });

    console.log('\n* Excluyendo REAL 14');
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkRouteHealth();
