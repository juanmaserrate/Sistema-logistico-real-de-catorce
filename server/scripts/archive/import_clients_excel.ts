
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import * as path from 'path';

const prisma = new PrismaClient();
const EXCEL_PATH = 'C:\\Users\\juanma\\Desktop\\clientes_exportado_completo.xlsx';

async function main() {
  console.log('Iniciando importación de escuelas desde Excel...');

  const pyScript = `
import pandas as pd
import json
import sys

try:
    df = pd.read_excel(r'${EXCEL_PATH}')
    # Rellenar nulos para evitar errores en JSON
    df = df.where(pd.notnull(df), None)
    print(df.to_json(orient='records'))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  const py = spawn('python', ['-c', pyScript]);
  let output = '';
  
  py.stdout.on('data', (data) => output += data.toString());
  py.stderr.on('data', (data) => console.error(`Py Error: ${data}`));

  py.on('close', async () => {
    try {
      const clients = JSON.parse(output);
      if (clients.error) throw new Error(clients.error);

      console.log(`Procesando ${clients.length} registros...`);

      let count = 0;
      for (const c of clients) {
        const id = String(c['ID Cliente'] || `C-${Math.random().toString(36).substr(2, 9)}`);
        const name = String(c['Cliente'] || 'SIN NOMBRE');
        const address = `${c['Dirección (calle)'] || ''} ${c['Número (calle)'] || ''}, ${c['Localidad'] || ''}`.trim();
        const lat = parseFloat(c['Latitud']) || null;
        const lng = parseFloat(c['Longitud']) || null;
        const zone = String(c['Zonas (separadas por ;)'] || '');
        const barrio = String(c['Barrio'] || '');
        const serviceTime = parseInt(c['Tiempo de Servicio [min]']) || 15;
        const start = String(c['Inicio de Jornada [HH:mm]'] || '08:00');
        const end = String(c['Fin de Jornada [HH:mm]'] || '17:00');

        await prisma.client.upsert({
          where: { id },
          update: {
            name,
            address,
            latitude: lat,
            longitude: lng,
            zone,
            barrio,
            serviceTime,
            timeWindowStart: start,
            timeWindowEnd: end
          },
          create: {
            id,
            tenantId: 'default-tenant',
            name,
            address,
            latitude: lat,
            longitude: lng,
            zone,
            barrio,
            serviceTime,
            timeWindowStart: start,
            timeWindowEnd: end
          }
        });
        count++;
        if (count % 50 === 0) console.log(`Importados ${count}...`);
      }

      console.log(`✅ Importación finalizada: ${count} escuelas cargadas/actualizadas.`);
    } catch (e) {
      console.error("Fallo la importación:", e);
    } finally {
      await prisma.$disconnect();
    }
  });
}

main();
