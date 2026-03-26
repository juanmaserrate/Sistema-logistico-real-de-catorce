
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const tenantId = 'default-tenant';
    
    // 1. Get unique drivers from Trips
    const distinctTripDrivers = await prisma.trip.findMany({
        select: { driver: true },
        where: { driver: { not: null } },
        distinct: ['driver']
    });

    console.log(`Found ${distinctTripDrivers.length} unique drivers in Trips.`);

    for (const item of distinctTripDrivers) {
        if (!item.driver) continue;
        const driverName = item.driver.toUpperCase().trim();
        if (driverName.length < 2) continue;

        await prisma.user.upsert({
            where: { username: driverName },
            update: { fullName: driverName },
            create: {
                username: driverName,
                password: '123',
                fullName: driverName,
                role: 'DRIVER',
                tenantId
            }
        });
        console.log(`Synced user: ${driverName}`);
    }

    // 2. Sync Admin
    await prisma.user.upsert({
        where: { username: 'ADMIN' },
        update: {},
        create: {
            username: 'ADMIN',
            password: '123',
            fullName: 'ADMINISTRADOR',
            role: 'ADMIN',
            tenantId
        }
    });

    // 3. Sync Vehicles from trips (as a backup)
    const distinctVehicles = await prisma.trip.findMany({
        select: { vehicle: true },
        where: { vehicle: { not: null } },
        distinct: ['vehicle']
    });

    for (const item of distinctVehicles) {
        if (!item.vehicle) continue;
        const plate = item.vehicle.toUpperCase().trim();
        if (plate.length < 2) continue;

        await prisma.vehicle.upsert({
            where: { plate },
            update: {},
            create: {
                plate,
                tenantId,
                status: 'ACTIVE'
            }
        });
        console.log(`Synced vehicle: ${plate}`);
    }

    console.log('Seeding completed.');
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
