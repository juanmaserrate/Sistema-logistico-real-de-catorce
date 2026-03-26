import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTrips() {
    try {
        const count = await prisma.trip.count();
        console.log('Total trips:', count);
        
        const statuses = await prisma.trip.groupBy({
            by: ['status'],
            _count: true
        });
        console.log('Statuses:', JSON.stringify(statuses, null, 2));

        if (count > 0) {
            const sample = await prisma.trip.findFirst();
            console.log('Sample trip driver:', sample?.driver);
        }
    } catch (e: any) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

checkTrips();
