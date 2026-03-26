
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalize(name: string): string {
  if (!name) return "";
  let n = name.toUpperCase();
  n = n.split("(")[0].split("EX")[0];
  n = n.replace(/\./g, " ").replace(/-/g, " ");
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
  // Capturar solo la parte esencial:Letras y Numero
  // Ej: "J 932" -> "J932"
  const match = n.match(/([A-Z]+)\s*(\d+)/);
  if (match) return match[1] + match[2];
  
  return n.replace(/[^A-Z0-9]/g, "").trim();
}

async function aggressiveFix() {
  console.log('--- Corrigiendo Nombres (Sincronización Agresiva) ---');

  const clients = await prisma.client.findMany();
  const stops = await prisma.routeStopTemplate.findMany();

  const clientMap = new Map();
  // Mapear por nombre normalizado
  clients.forEach(c => {
    const norm = normalize(c.name);
    if (norm) {
        if (!clientMap.has(norm)) clientMap.set(norm, c.name);
    }
  });

  let corrected = 0;
  let totalStops = 0;

  for (const stop of stops) {
    if (stop.name === 'REAL 14') continue;
    totalStops++;

    const normStop = normalize(stop.name);
    if (clientMap.has(normStop)) {
      const officialName = clientMap.get(normStop);
      if (stop.name !== officialName) {
        await prisma.routeStopTemplate.update({
          where: { id: stop.id },
          data: { name: officialName }
        });
        corrected++;
      }
    }
  }

  // Recalcular sincronizacion final
  const finalStops = await prisma.routeStopTemplate.findMany({ where: { NOT: { name: 'REAL 14' } } });
  const finalClientNames = new Set(clients.map(c => c.name));
  let finalSync = 0;
  finalStops.forEach(s => { if (finalClientNames.has(s.name)) finalSync++; });

  console.log(`✅ Proceso finalizado.`);
  console.log(`Paradas actualizadas en este paso: ${corrected}`);
  console.log(`Total de paradas en rutas: ${finalStops.length}`);
  console.log(`Sincronización total lograda: ${finalSync} de ${finalStops.length} (${Math.round(finalSync/finalStops.length*100)}%)`);
  
  await prisma.$disconnect();
}

aggressiveFix();
