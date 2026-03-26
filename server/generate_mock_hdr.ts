import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createMockHdrTrip() {
    try {
        // Find a trip that is currently PENDING or IN_PROGRESS
        const trip = await prisma.trip.findFirst({
            where: {
                status: { not: 'COMPLETED' }
            }
        });

        if (!trip) {
            console.log('No trips found to update.');
            return;
        }

        const updated = await prisma.trip.update({
            where: { id: trip.id },
            data: {
                status: 'COMPLETED',
                startedAt: new Date(Date.now() - 3600000), // 1 hour ago
                completedAt: new Date(),
                temperature: '4.5°C',
                isRefrigerated: true,
                kmDeparture: '124500',
                kmArrival: '124620',
                arrivalTime: '10:15',
                departureTime: '10:45',
                reason: 'DMC - Entrega Normal',
                driverComments: 'Todo en orden, cliente recibió conforme.',
                proofPhotoUrl: '/uploads/mock-photo.jpg'
            }
        });

        console.log(`✓ Viaje de prueba generado para: ${updated.driver}`);
        console.log(`✓ ID de viaje: ${updated.id}`);
        console.log(`✓ Estado: COMPLETADO con datos HDR`);
    } catch (e: any) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

createMockHdrTrip();
