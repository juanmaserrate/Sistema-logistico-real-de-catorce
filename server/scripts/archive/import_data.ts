
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();
const FILE_PATH = 'c:\\Users\\juanma\\Desktop\\temp_history_data.json'; 

async function main() {
  try {
    if (!fs.existsSync(FILE_PATH)) {
        console.error("No source data found at " + FILE_PATH);
        return;
    }
    const rawData = fs.readFileSync(FILE_PATH, 'utf8');
    const trips = JSON.parse(rawData);

    // Clear existing trips for the periods to be imported
    await prisma.trip.deleteMany({}); 

    console.log(`Found ${trips.length} trips to import into R14 DB.`);

    let count = 0;
    
    for (const t of trips) {
        let dateVal = new Date();
        if(t.FECHA) dateVal = new Date(t.FECHA);

        let val = 0;
        let originalVal = t.VALOR;
        if(typeof originalVal === 'number') val = originalVal;
        else if (typeof originalVal === 'string') {
            const clean = originalVal.replace(/[$,]/g, '').trim();
            if(!clean.toUpperCase().includes('PROPIO')) {
               const parsed = parseFloat(clean);
               if(!isNaN(parsed)) val = parsed;
            }
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const status = dateVal >= today ? 'PENDING' : 'COMPLETED';

        await prisma.trip.create({
            data: {
                date: dateVal,
                priority: t.PRIORIDAD ? String(t.PRIORIDAD) : null,
                zone: t.ZONA ? String(t.ZONA) : null,
                vehicle: t.VEHICULO ? String(t.VEHICULO) : null,
                driver: t.CHOFER ? String(t.CHOFER) : null,
                provider: t.PROVEEDOR ? String(t.PROVEEDOR) : null,
                auxiliar: t.AUXILIAR ? String(t.AUXILIAR) : null,
                auxiliar2: t.AUXILIAR2 ? String(t.AUXILIAR2) : null,
                auxiliar3: t.AUXILIAR3 ? String(t.AUXILIAR3) : null,
                businessUnit: (t['UNID NEGOCIO'] || t['U. NEGOCIO']) ? String(t['UNID NEGOCIO'] || t['U. NEGOCIO']) : null,
                distributionType: t.REPARTO ? String(t.REPARTO) : null,
                contractType: t.CONTRATACION ? String(t.CONTRATACION) : null,
                vehicleType: (t['TIPO_DE_VEHICULO'] || t['TIPO DE VEHICULO']) ? String(t['TIPO_DE_VEHICULO'] || t['TIPO DE VEHICULO']) : null,
                tripType: t.TIPO_DE_VIAJE ? String(t.TIPO_DE_VIAJE) : null,
                entryTime: t['HORARIO DE INGRESO'] ? String(t['HORARIO DE INGRESO']) : null,
                exitTime: t.EXIT_TIME ? new Date(t.EXIT_TIME) : null,
                returnTime: t.RETURN_TIME ? new Date(t.RETURN_TIME) : null,
                value: val,
                paymentStatus: t.PAGO ? String(t.PAGO) : 'PENDIENTE',
                observations: t.OBSERVACIONES ? String(t.OBSERVACIONES) : null,
                notes: t['NOTA IMPORTANTE'] ? String(t['NOTA IMPORTANTE']) : null,
                status: status
            }
        });
        count++;
    }

    console.log(`R14 Import finished. Total: ${count}`);

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
