import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const JSON_PATH = 'C:\\Users\\juanma\\Desktop\\Ai\\temp_trips.json';

async function main() {
    if (!fs.existsSync(JSON_PATH)) {
        console.error("JSON file not found:", JSON_PATH);
        return;
    }

    const rawData = fs.readFileSync(JSON_PATH, 'utf-8');
    const trips = JSON.parse(rawData);

    console.log(`Importing ${trips.length} trips...`);

    for (const t of trips) {
        // Parse auxiliaries
        const auxParts = t.auxiliaries ? String(t.auxiliaries).split(/[/,]/).map(s => s.trim()) : [];
        
        await prisma.trip.create({
            data: {
                date: new Date(t.date + 'T12:00:00Z'), // Noon UTC to avoid TZ issues
                zone: t.zone,
                driver: t.driver,
                auxiliar: auxParts[0] || null,
                auxiliar2: auxParts[1] || null,
                auxiliar3: auxParts[2] || null,
                reparto: t.reparto,
                contractType: 'Tercerizado',
                provider: 'EXTERNO',
                value: t.value || 0,
                status: 'PENDIENTE',
                businessUnit: 'DMC',
                priority: '1'
            }
        });
    }

    console.log("Import finished successfully.");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
