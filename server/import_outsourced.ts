import { PrismaClient } from '@prisma/client';
import openpyxl from 'openpyxl';
// We don't have easy openpyxl for TS, but we can use 'xlsx' or 'exceljs'
// Since I have 'xlsx' in the frontend, maybe I can use it in the backend too?
// Let's check package.json of the server.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const prisma = new PrismaClient();
const FILE_PATH = 'C:\\Users\\juanma\\Desktop\\COSTOS CON LAS HORAS AGREGADAS.xlsx';

async function main() {
    if (!fs.existsSync(FILE_PATH)) {
        console.error("File not found:", FILE_PATH);
        return;
    }

    const workbook = XLSX.readFile(FILE_PATH);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    console.log(`Processing ${data.length} rows...`);

    let importedCount = 0;
    
    // Skip header row
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const [fecha, zona, chofer, auxiliares, reparto, propioCol, costoCol] = row;

        // Only import TERCERIZADO
        if (String(propioCol).toUpperCase() === 'TERCERIZADO') {
            
            // Parse auxiliaries
            let aux1 = null, aux2 = null, aux3 = null;
            if (auxiliares) {
                const parts = String(auxiliares).split(/[/,]/).map(s => s.trim());
                aux1 = parts[0] || null;
                aux2 = parts[1] || null;
                aux3 = parts[2] || null;
            }

            // Date handling
            let tripDate = new Date();
            if (fecha) {
                // If it's a number (Excel date), XLSX converts it or we have to
                if (typeof fecha === 'number') {
                    tripDate = new Date(Date.UTC(1899, 11, 30 + fecha));
                } else {
                    tripDate = new Date(fecha);
                }
            }

            await prisma.trip.create({
                data: {
                    date: tripDate,
                    zone: String(zona || '').trim(),
                    driver: String(chofer || '').trim(),
                    auxiliar: aux1,
                    auxiliar2: aux2,
                    auxiliar3: aux3,
                    reparto: String(reparto || '').trim(),
                    contractType: 'Tercerizado',
                    provider: 'EXTERNO', // Default for outsourced
                    value: parseFloat(costoCol) || 0,
                    status: 'PENDIENTE',
                    businessUnit: 'DMC', // Default
                    priority: '1'
                }
            });
            importedCount++;
        }
    }

    console.log(`Successfully imported ${importedCount} TERCERIZADO trips.`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
