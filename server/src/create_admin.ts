import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createAdmin() {
    try {
        // Check if default tenant exists
        let tenant = await prisma.tenant.findFirst({ where: { name: 'R14 Logistics' } });
        if (!tenant) {
            tenant = await prisma.tenant.create({ data: { name: 'R14 Logistics' } });
        }

        await prisma.user.create({
            data: {
                username: 'ADMIN',
                password: 'admin123',
                fullName: 'ADMINISTRADOR',
                role: 'ADMIN',
                tenantId: tenant.id
            }
        });
        console.log('✓ Admin user created successfully');
    } catch (e: any) {
        if (e.code === 'P2002') {
            console.log('Admin already exists');
        } else {
            console.error('Error:', e.message);
        }
    } finally {
        await prisma.$disconnect();
    }
}

createAdmin();
