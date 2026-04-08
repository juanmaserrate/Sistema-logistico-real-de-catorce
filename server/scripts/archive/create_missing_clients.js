const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const missingNames = [
        "ES.74", "J. LUCECITAS", "J. OLA VERDE", "ES.79", "CET.1", "ES.80", "ES.76", 
        "EP.941", "ANEXO10", "ES.924", "J.45", "EP 31", "ES 43", "JI 936", "JI 944", 
        "ES 21", "Ce 18", "EET 4", "EP 49", "ES 38", "CEP.801", "P2 SAM", "CE.7", 
        "TEC.8", "CPI3", "J.16", "J.7", "CPI5", "J.14", "CPI 1", "J.2", "POLO ED", 
        "J.5", "J.3", "J.13", "JM", "J.10", "J.18", "J.8", "J.17", "J.15", "CPI2", 
        "J.6", "CPI4", "J.11", "J.19", "J.12", "CPI6"
    ];

    console.log(`Creando ${missingNames.length} clientes faltantes...`);

    let createdCount = 0;
    
    for (const name of missingNames) {
        const exists = await prisma.client.findFirst({
            where: { name: name }
        });

        if (!exists) {
            await prisma.client.create({
                data: {
                    name: name,
                    tenantId: 'default-tenant',
                    address: 'Por definir', // placeholder so it's visible in UI
                    latitude: 0,
                    longitude: 0,
                    timeWindowStart: '08:00',
                    timeWindowEnd: '17:00',
                    serviceTime: 10
                }
            });
            console.log(`[+] Creado: ${name}`);
            createdCount++;
        } else {
            console.log(`[=] Ya existe: ${name}`);
        }
    }

    console.log(`\nProceso completado. Se crearon ${createdCount} clientes nuevos en el sistema.`);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
