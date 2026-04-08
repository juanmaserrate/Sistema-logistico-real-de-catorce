
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('--- INICIANDO LIMPIEZA MASIVA DE TODAS LAS RUTAS PREDEFINIDAS ---');
        const clients = await prisma.client.findMany();
        const clientNames = clients.map(c => c.name);

        function findBestMatch(stopName) {
            if (!stopName) return null;

            const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const sNorm = norm(stopName);
            
            // Mapping rules
            let target = stopName.toUpperCase().trim();
            if (target.startsWith('EP.')) target = target.replace('EP.', 'E.P.B ');
            if (target.startsWith('EP ')) target = target.replace('EP ', 'E.P.B ');
            if (target.startsWith('SEC.')) target = target.replace('SEC.', 'E.E.S ');
            if (target.startsWith('SEC ')) target = target.replace('SEC ', 'E.E.S ');
            if (target.startsWith('EES.')) target = target.replace('EES.', 'E.E.S ');
            if (target.startsWith('J.')) target = target.replace('J.', 'JARDÍN ');
            if (target.startsWith('J ')) target = target.replace('J ', 'JARDÍN ');
            if (target.includes('REAL 14') || target.includes('DEPOSITO') || target.includes('DEPÓSITO')) return 'REAL 14';

            const targetNorm = norm(target);

            // 1. Exact or standardized match
            for (const cName of clientNames) {
                if (norm(cName) === targetNorm) return cName;
            }
            
            // 2. Number-based search for prefixes
            const numMatch = stopName.match(/\d+/);
            if (numMatch) {
                const num = numMatch[0];
                const cleanUpper = target.toUpperCase();
                
                let prefix = null;
                if (cleanUpper.includes('JARD') || cleanUpper.startsWith('J')) prefix = 'JARDÍN';
                else if (cleanUpper.includes('EES') || cleanUpper.includes('E.E.S') || cleanUpper.includes('SEC')) prefix = 'E.E.S';
                else if (cleanUpper.includes('EPB') || cleanUpper.includes('E.P.B') || cleanUpper.startsWith('EP')) prefix = 'E.P.B';

                if (prefix) {
                    for (const cName of clientNames) {
                        const cUpper = cName.toUpperCase();
                        // Allow "JARDIN" instead of "JARDÍN" on DB
                        const matchPrefix = (prefix === 'JARDÍN' && (cUpper.includes('JARDIN') || cUpper.includes('JARDÍN'))) || 
                                            (cUpper.replace(/\./g, '').includes(prefix.replace(/\./g, '')));
                        
                        // Solo coincidencia estricta en numero para evitar 6 confundiendose con 60
                        if (matchPrefix) {
                           const cWords = cUpper.split(/[\s-]+/);
                           if (cWords.includes(num)) return cName;
                        }
                    }
                }
            }

            return null; // No match found
        }

        const templates = await prisma.routeTemplate.findMany({
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });

        const clientMap = new Map();
        clients.forEach(c => clientMap.set(c.name.trim().toUpperCase(), c));
        let totalMissing = 0;
        let totalFixed = 0;

        for (const rn of templates) {
            console.log(`\n\n--- ANALIZANDO RUTA: ${rn.name} ---`);
            
            let missingInRoute = 0;

            for (const stop of rn.stops) {
                const nameNorm = stop.name ? stop.name.trim().toUpperCase() : '';
                const foundClient = clientMap.get(nameNorm);
                const hasLocation = !!foundClient && (foundClient.latitude !== null && foundClient.latitude !== 0);

                if (hasLocation) {
                    console.log(`[✓] ${stop.name}`);
                } else {
                    // Try to fix it
                    const match = findBestMatch(stop.name);
                    
                    if (match && match !== stop.name) {
                        const matchClient = clientMap.get(match.toUpperCase());
                        const matchHasLoc = !!matchClient && (matchClient.latitude !== null && matchClient.latitude !== 0);
                        
                        if (matchHasLoc) {
                            console.log(`[✨ CORREGIDO] "${stop.name}" -> "${match}"`);
                            await prisma.routeStopTemplate.update({
                                where: { id: stop.id },
                                data: { name: match }
                            });
                            totalFixed++;
                        } else {
                            console.log(`[!] Match encontrado pero SIN UBICACIÓN: "${stop.name}" -> "${match}"`);
                            missingInRoute++;
                            totalMissing++;
                        }
                    } else {
                        console.log(`[✗] NO ENCONTRADO: ${stop.name}`);
                        missingInRoute++;
                        totalMissing++;
                    }
                }
            }
            
            if (missingInRoute === 0) {
                console.log(`-> Ruta ${rn.name} 100% Sincronizada y con Ubicación.`);
            } else {
                console.log(`-> Ruta ${rn.name} tiene ${missingInRoute} paradas pendientes.`);
            }
        }

        console.log(`\n======================================`);
        console.log(`RESUMEN GLOBAL DE LIMPIEZA MASIVA`);
        console.log(`======================================`);
        console.log(`Total de paradas corregidas: ${totalFixed}`);
        console.log(`Total de paradas que aún requieren atención manual: ${totalMissing}`);
        console.log(`======================================\n`);

    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
