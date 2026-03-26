import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixStatuses() {
    try {
        // Today is 2026-02-03 based on metadata
        const today = new Date('2026-02-03T00:00:00.000Z');
        
        // 1. Mark all trips from today onwards as PENDING
        const pendingResult = await prisma.trip.updateMany({
            where: {
                date: {
                    gte: today
                }
            },
            data: {
                status: 'PENDING'
            }
        });
        
        // 2. Mark all trips before today as COMPLETED
        const completedResult = await prisma.trip.updateMany({
            where: {
                date: {
                    lt: today
                }
            },
            data: {
                status: 'COMPLETED'
            }
        });

        console.log(`✅ Ajuste de estados finalizado:`);
        console.log(`- ${pendingResult.count} viajes marcados como PENDIENTES (Hoy o Futuro)`);
        console.log(`- ${completedResult.count} viajes marcados como COMPLETADOS (Pasado)`);

    } catch (e: any) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

fixStatuses();
