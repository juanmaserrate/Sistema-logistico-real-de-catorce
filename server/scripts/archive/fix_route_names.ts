
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalize(name: string): string {
  if (!name) return "";
  let n = name.toUpperCase();
  
  // Quitar todo lo que este entre parentesis o despues de "EX"
  n = n.split("(")[0].split("EX")[0];

  // Quitar puntos y guiones
  n = n.replace(/\./g, " ").replace(/-/g, " ");

  // Normalizar prefijos
  n = n.replace(/\bESCUELA PRIMARIA\b/g, "EP");
  n = n.replace(/\bESCUELA SECUNDARIA\b/g, "ES");
  n = n.replace(/\bESCUELA ESPECIAL\b/g, "EEE");
  n = n.replace(/\bPRIMARIA\b/g, "EP");
  n = n.replace(/\bSECUNDARIA\b/g, "ES");
  n = n.replace(/\bJARDIN\b/g, "J");
  n = n.replace(/\bJI\b/g, "J");
  n = n.replace(/\bE E S\b/g, "ES");
  n = n.replace(/\bE E P\b/g, "EP");
  n = n.replace(/\bE E E\b/g, "EEE");
  n = n.replace(/\bE E T\b/g, "TEC");
  n = n.replace(/\bTEC\b/g, "TEC");

  // Quitar espacios y dejar solo letras/numeros
  n = n.replace(/[^A-Z0-9]/g, "");

  return n.trim();
}

async function fixStops() {
  console.log('--- Corrigiendo Nombres de Rutas (Refinado) ---');

  const clients = await prisma.client.findMany();
  const stops = await prisma.routeStopTemplate.findMany();

  const clientMap = new Map();
  clients.forEach(c => {
    const normName = normalize(c.name);
    if (normName) clientMap.set(normName, c.name);
  });

  let corrected = 0;
  let matchesFound = 0;

  for (const stop of stops) {
    if (stop.name === 'REAL 14') continue;

    const normStop = normalize(stop.name);
    if (clientMap.has(normStop)) {
      matchesFound++;
      const officialName = clientMap.get(normStop);
      if (stop.name !== officialName) {
        await prisma.routeStopTemplate.update({
          where: { id: stop.id },
          data: { name: officialName }
        });
        corrected++;
      }
    } else {
        // console.log(`No match for: ${stop.name} (${normStop})`);
    }
  }

  console.log(`Total de paradas: ${stops.length}`);
  console.log(`Matches encontrados: ${matchesFound}`);
  console.log(`Nombres actualizados: ${corrected}`);
  await prisma.$disconnect();
}

fixStops();
