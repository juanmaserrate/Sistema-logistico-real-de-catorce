
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const clients = await prisma.client.findMany();
    const clientNames = clients.map(c => c.name);

    function findBestMatch(stopName) {
        const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const sNorm = norm(stopName);
        
        // Reglas específicas comunes
        let target = stopName.toUpperCase();
        if (target.startsWith('EP.')) target = target.replace('EP.', 'E.P.B ');
        if (target.startsWith('EP ')) target = target.replace('EP ', 'E.P.B ');
        if (target.startsWith('J.')) target = target.replace('J.', 'JARDIN ');
        if (target.startsWith('J ')) target = target.replace('J ', 'JARDIN ');
        
        const targetNorm = norm(target);

        // Buscar coincidencia exacta tras normalizar
        for (const cName of clientNames) {
            if (norm(cName) === targetNorm) return cName;
        }
        
        // Buscar si el nombre del cliente contiene el número del EP/J
        const numMatch = stopName.match(/\d+/);
        if (numMatch) {
            const num = numMatch[0];
            const prefix = stopName.toUpperCase().includes('J') ? 'JARDIN' : 'EP';
            for (const cName of clientNames) {
                const cUpper = cName.toUpperCase();
                if (cUpper.includes(prefix) && cUpper.includes(num)) return cName;
            }
        }

        return null;
    }

    const r1 = await prisma.routeTemplate.findFirst({
        where: { name: 'R1' },
        include: { stops: { orderBy: { sequence: 'asc' } } }
    });

    if (!r1) {
        console.log('No se encontró la ruta R1.');
        return;
    }

    console.log(`--- ACTUALIZANDO RUTA: ${r1.name} ---`);
    
    for (const stop of r1.stops) {
        const match = findBestMatch(stop.name);
        if (match && match !== stop.name) {
            console.log(`Renombrando: "${stop.name}" -> "${match}"`);
            await prisma.routeStopTemplate.update({
                where: { id: stop.id },
                data: { name: match }
            });
        }
    }

    // Reporte final
    const updatedR1 = await prisma.routeTemplate.findFirst({
        where: { id: r1.id },
        include: { stops: { orderBy: { sequence: 'asc' } } }
    });

    const clientMap = new Map();
    clients.forEach(c => clientMap.set(c.name.trim().toUpperCase(), c));

    console.log('\n--- REPORTE FINAL DE COINCIDENCIAS R1 ---');
    updatedR1.stops.forEach((stop, i) => {
        const found = clientMap.get(stop.name.trim().toUpperCase());
        const hasLoc = !!found && found.latitude !== null && found.latitude !== 0;
        console.log(`${String(i+1).padStart(2, ' ')}. [${hasLoc ? '✓' : '✗'}] ${stop.name}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
