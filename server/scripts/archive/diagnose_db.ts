
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('--- Database Diagnosis ---');
    const tenants = await prisma.tenant.count();
    const users = await prisma.user.count();
    const vehicles = await prisma.vehicle.count();
    const clients = await prisma.client.count();
    const routes = await prisma.route.count();
    const routeTemplates = await prisma.routeTemplate.count();
    const routeStops = await prisma.routeStopTemplate.count();
    const trips = await prisma.trip.count();
    const tripStops = await prisma.tripStop.count();
    const salaries = await prisma.employeeSalary.count();
    const maintenance = await prisma.maintenanceRecord.count();

    console.log({
        tenants,
        users,
        vehicles,
        clients,
        routes,
        routeTemplates,
        trips,
        salaries,
        maintenance
    });

    if (users > 0) {
        const sampleUsers = await prisma.user.findMany({ take: 5 });
        console.log('Sample Users:', sampleUsers.map(u => u.username));
    }

    if (clients > 0) {
        const sampleClients = await prisma.client.findMany({ take: 5 });
        console.log('Sample Clients:', sampleClients.map(c => c.name));
    }

    if (routeTemplates > 0) {
        const sampleTemplates = await prisma.routeTemplate.findMany({ take: 5 });
        console.log('Sample Templates:', sampleTemplates.map(t => t.name));
    }
    
    if (trips > 0) {
        const sampleTrips = await prisma.trip.findMany({ take: 3 });
        console.log('Sample Trips:', JSON.stringify(sampleTrips, null, 2));
    }

    const uniqueTripVehiclePlates = await prisma.trip.findMany({
        select: { vehicle: true },
        where: { vehicle: { not: null } },
        distinct: ['vehicle']
    });
    console.log('Unique Vehicle Plates in Trips:', uniqueTripVehiclePlates.map(v => v.vehicle));

    const janTrips = await prisma.trip.count({
        where: {
            date: {
                gte: new Date('2026-01-01'),
                lt: new Date('2026-02-01')
            }
        }
    });
    console.log('Trips in Jan 2026:', janTrips);

    const costs = await prisma.appSettings.findUnique({ where: { key: 'costs_data' } });
    console.log('Costs Data found:', !!costs);
}

main().finally(() => prisma.$disconnect());
