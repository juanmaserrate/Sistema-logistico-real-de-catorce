import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function injectHdrData() {
    try {
        // Find any trip
        const trip = await prisma.trip.findFirst();

        if (!trip) {
            console.log('No trips found at all.');
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
                driverComments: 'PRUEBA HDR: Todo en orden, cliente recibió conforme.',
                proofPhotoUrl: '/uploads/mock-photo.jpg'
            }
        });

        console.log(`\n✅ DATOS INYECTADOS CORRECAMENTE`);
        console.log(`--------------------------------`);
        console.log(`Chofer: ${updated.driver}`);
        console.log(`ID Viaje: ${updated.id}`);
        console.log(`Zona/Destino: ${updated.zone}`);
        console.log(`--------------------------------`);
        console.log(`Ahora entra como ADMIN, selecciona a "${updated.driver}" y ve a "Historial".`);
    } catch (e: any) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

injectHdrData();
