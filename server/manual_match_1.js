
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const clients = await prisma.client.findMany({
            select: { id: true, name: true }
        });

        const searchTerms = [
            { query: '74', text: 'ES.74 (R6)' },
            { query: 'LUCECITAS', text: 'J. LUCECITAS (R7)' },
            { query: 'OLA VERDE', text: 'J. OLA VERDE (R7)' },
            { query: '79', text: 'ES.79 (R8)' },
            { query: 'CET', text: 'CET.1 (R8)' },
            { query: '80', text: 'ES.80 (R9)' },
            { query: '76', text: 'ES.76 (R10)' }
        ];

        for (const term of searchTerms) {
            console.log(`\nBuscando opciones para: ${term.text}`);
            const matches = clients.filter(c => c.name.toUpperCase().includes(term.query));
            if (matches.length > 0) {
                matches.forEach(m => console.log(`  - ${m.name}`));
            } else {
                console.log(`  (Sin coincidencias obvias encontradas)`);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
