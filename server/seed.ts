
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    // 1. Create Tenant
    const tenant = await prisma.tenant.upsert({
        where: { id: 'default-tenant' },
        update: {},
        create: {
            id: 'default-tenant',
            name: 'Real de Catorce Logística',
            settings: JSON.stringify({
                weights: { delay: 10, distance: 1, vehicles: 100 },
                service_time_default: 15
            })
        }
    });

    // 2. Create Admin
    await prisma.user.upsert({
        where: { username: 'admin' },
        update: { tenantId: tenant.id, password: '123' },
        create: {
            username: 'admin',
            password: '123', // Usando la misma que los choferes para prueba
            fullName: 'Admin R14',
            role: 'ADMIN',
            tenantId: tenant.id
        }
    });

    // 3. Create Vehicles
    const vehiclesData = [
        { plate: 'ABC-123', capacityWeight: 1000, isRefrigerated: true },
        { plate: 'XYZ-456', capacityWeight: 1500, isRefrigerated: false },
        { plate: 'R14-001', capacityWeight: 2000, isRefrigerated: true },
    ];

    for (const v of vehiclesData) {
        await prisma.vehicle.upsert({
            where: { plate: v.plate },
            update: { tenantId: tenant.id },
            create: { ...v, tenantId: tenant.id }
        });
    }

    // 4. Create Sample Clients (Schools)
    const clientsData = [
        { name: 'Escuela Primaria N1', address: 'Calle Falsa 123', latitude: -23.591, longitude: -67.851, timeWindowStart: '08:00', timeWindowEnd: '12:00', zone: 'NORTE' },
        { name: 'Colegio Secundario N5', address: 'Av Siempre Viva 742', latitude: -23.595, longitude: -67.855, timeWindowStart: '09:00', timeWindowEnd: '13:00', zone: 'CENTRO' },
        { name: 'Escuela Técnica N3', address: 'Mitre 500', latitude: -23.585, longitude: -67.845, timeWindowStart: '08:00', timeWindowEnd: '14:00', zone: 'NORTE' },
        { name: 'Jardin de Infantes 901', address: 'Belgrano 10', latitude: -23.600, longitude: -67.860, timeWindowStart: '08:30', timeWindowEnd: '11:00', zone: 'SUR' },
    ];

    for (const c of clientsData) {
        await prisma.client.create({
            data: { ...c, tenantId: tenant.id }
        });
    }

    console.log('Seeding completed.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
