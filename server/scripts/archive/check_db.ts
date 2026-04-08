
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const trips = await prisma.trip.count();
    const users = await prisma.user.count();
    const admins = await prisma.user.count({ where: { role: 'ADMIN' } });
    
    console.log(`Trips in DB: ${trips}`);
    console.log(`Users in DB: ${users}`);
    console.log(`Admins in DB: ${admins}`);
    
    if (admins === 0) {
        console.log("No admins! Attempting to create ADMIN...");
        let tenant = await prisma.tenant.findFirst();
        if (!tenant) tenant = await prisma.tenant.create({ data: { name: 'Default Tenant' } });
        
        await prisma.user.create({
            data: { 
                username: 'ADMIN', 
                password: 'admin123', 
                fullName: 'ADMINISTRADOR', 
                role: 'ADMIN',
                tenantId: tenant.id
            }
        });
    }
}
check();
