const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const clients = await prisma.client.findMany({
    where: { tenantId: 'default-tenant' },
    select: { name: true, address: true }
  });
  const sinDireccion = clients.filter((c) => !(c.address && c.address.trim()));
  console.log(JSON.stringify(sinDireccion.map((c) => ({ name: c.name })), null, 2));
  console.log('\nTotal sin dirección:', sinDireccion.length);
  await prisma.$disconnect();
}
run();
