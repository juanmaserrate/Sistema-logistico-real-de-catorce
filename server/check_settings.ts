
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const settings = await prisma.appSettings.findMany();
    console.log('--- SETTINGS IN DB ---');
    console.log(JSON.stringify(settings, null, 2));
}

main().finally(() => prisma.$disconnect());
