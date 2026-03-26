
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const records = [
        {
            plate: 'AA233TQ',
            category: 'Reparación y mant. Preventivo',
            month: 'Febrero 2026',
            date: '2026-02-16',
            workshop: 'MECÁNICA PININO',
            workDone: 'Service completo, Amortiguadores del. (Sachs), Par de cazoletas, Amortiguadores tras. (Sachs), Mano de obra, Service y cambio automático burro arranque',
            cost: 2223000,
            notes: 'Subtotal 16/02/2026'
        },
        {
            plate: 'AA233TQ',
            category: 'Reparación y mant. Preventivo',
            month: 'Febrero 2026',
            date: '2026-02-16',
            workshop: 'Service Oficial',
            workDone: 'Kit de filtros, Aceite, Filtro de habitáculo, Mano de obra, Alternador, Correa Poly V, Mano de obra, Cambio de termostato, Mano de obra termostato',
            cost: 2134040,
            notes: 'Service 218.352 km'
        },
        {
            plate: 'AA233TQ',
            category: 'Reparación y mant. Refrigeración',
            month: 'Febrero 2026',
            date: '2026-02-10',
            workshop: 'MAURO REFRIGERA',
            workDone: 'Reparación sistema de refrigeración completo',
            cost: 450000,
            notes: 'Revisión y carga de gas'
        },
        {
            plate: 'AA755TA',
            category: 'Reparación y mant. Cubiertas',
            month: 'Enero 2026',
            date: '2026-01-29',
            workshop: 'NEUMATICOS GOMERIA',
            workDone: 'CAMBIO DE DOS CUBIERTAS DELANTERAS',
            cost: 238000,
            notes: 'PRECIO X 2'
        },
         {
            plate: 'AC265LF',
            category: 'Lubricantes y consumibles',
            month: 'Enero 2026',
            date: '2026-01-13',
            workshop: 'LAS CAMBIO GERMAN CHOFER',
            workDone: 'cambio de lamparas de posicion x 2',
            cost: 9800,
            notes: ''
        }
    ];

    // Delete existing to avoid duplicates if re-running
    await prisma.maintenanceRecord.deleteMany({
        where: {
            OR: [
                { workshop: 'MECÁNICA PININO' },
                { workshop: 'MAURO REFRIGERA' },
                { workshop: 'Service Oficial' }
            ]
        }
    });

    for (const r of records) {
        await prisma.maintenanceRecord.create({ data: r });
    }
    console.log("Database seeded with maintenance records.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
