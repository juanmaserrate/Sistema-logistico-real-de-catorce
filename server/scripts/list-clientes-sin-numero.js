const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const clients = await prisma.client.findMany({
    where: { tenantId: 'default-tenant' },
    select: { id: true, name: true, address: true }
  });
  const sinNumero = clients.filter((c) => {
    const a = (c.address || '').trim();
    if (!a) return true;
    return !/\d/.test(a);
  });
  console.log(JSON.stringify(sinNumero.map((c) => ({ name: c.name, address: c.address || '(sin dirección)' })), null, 2));
  console.log('\nTotal sin número:', sinNumero.length);
  await prisma.$disconnect();
}
run();
