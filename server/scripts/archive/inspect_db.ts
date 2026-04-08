
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function inspect() {
    console.log("Inspecting Trips DB...");
    
    // 1. Check Date Range
    const earliest = await prisma.trip.findFirst({ orderBy: { date: 'asc' } });
    const latest = await prisma.trip.findFirst({ orderBy: { date: 'desc' } });
    console.log("Earliest Trip:", earliest?.date);
    console.log("Latest Trip:", latest?.date);

    // 2. Check counts by status
    const statusCounts = await prisma.trip.groupBy({
        by: ['status'],
        _count: true
    });
    console.log("Status Counts:", statusCounts);

    // 3. Check sample driver data
    const sample = await prisma.trip.findFirst({
        where: { driver: { not: null } }
    });
    console.log("Sample Driver Name:", sample?.driver);
    


    const activeDriver = await prisma.trip.findFirst({
        where: { date: { gte: new Date('2026-01-01') } },
        select: { driver: true }
    });
    console.log(`Driver with 2026 trips: ${activeDriver?.driver}`);
}

inspect()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
