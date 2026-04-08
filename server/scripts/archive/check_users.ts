
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const users = await prisma.user.findMany();
    console.log('--- Usuarios en DB ---');
    users.forEach(u => {
        console.log(`ID: ${u.id} | User: ${u.username} | Pass: ${u.password} | Role: ${u.role}`);
    });
    
    const tenants = await prisma.tenant.findMany();
    console.log('--- Tenants en DB ---');
    tenants.forEach(t => {
        console.log(`ID: ${t.id} | Name: ${t.name}`);
    });
}

check()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
