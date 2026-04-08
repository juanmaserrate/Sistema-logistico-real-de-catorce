
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
            if (target.startsWith('SEC.')) target = target.replace('SEC.', 'E.E.S ');
            if (target.startsWith('SEC ')) target = target.replace('SEC ', 'E.E.S ');
            
            const targetNorm = norm(target);

            // 1. Coincidencia exacta tras normalizar
            for (const cName of clientNames) {
                if (norm(cName) === targetNorm) return cName;
            }
            
            // 2. Buscar si el nombre del cliente contiene el número
            const numMatch = stopName.match(/\d+/);
            if (numMatch) {
                const num = numMatch[0];
                const prefixMatch = target.match(/E\.E\.S|E\.P\.B/);
                const prefix = prefixMatch ? prefixMatch[0].replace(/\./g, '') : null;
                
                if (prefix) {
                    for (const cName of clientNames) {
                        const cUpper = cName.toUpperCase();
                        if (cUpper.replace(/\./g, '').includes(prefix) && cUpper.includes(num)) return cName;
                    }
                }
            }

            return null;
        }

        const rn = await prisma.routeTemplate.findFirst({
            where: { name: 'R5' },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });

        if (!rn) {
            console.log('No se encontró la ruta R5.');
            return;
        }

        console.log(`--- ACTUALIZANDO RUTA: ${rn.name} ---`);
        
        for (const stop of rn.stops) {
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
        const updatedRn = await prisma.routeTemplate.findFirst({
            where: { id: rn.id },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });

        const clientMap = new Map();
        clients.forEach(c => clientMap.set(c.name.trim().toUpperCase(), c));

        console.log('\n--- REPORTE FINAL DE COINCIDENCIAS R5 ---');
        updatedRn.stops.forEach((stop, i) => {
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
