import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();
const JSON_PATH = 'C:\\Users\\juanma\\Desktop\\Ai\\temp_routes.json';

async function main() {
    if (!fs.existsSync(JSON_PATH)) {
        console.error("JSON file not found:", JSON_PATH);
        return;
    }

    const rawData = fs.readFileSync(JSON_PATH, 'utf-8');
    const routes = JSON.parse(rawData);

    console.log(`Importing ${routes.length} route templates...`);

    for (const r of routes) {
        // Upsert the route template
        const template = await (prisma as any).routeTemplate.upsert({
            where: { name: r.name },
            update: {},
            create: { name: r.name }
        });

        // Delete old stops
        await (prisma as any).routeStopTemplate.deleteMany({
            where: { routeTemplateId: template.id }
        });

        // Create new stops with sequence
        for (let i = 0; i < r.stops.length; i++) {
            await (prisma as any).routeStopTemplate.create({
                data: {
                    routeTemplateId: template.id,
                    name: r.stops[i],
                    sequence: i + 1
                }
            });
        }
    }

    console.log("Route templates import finished successfully.");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
