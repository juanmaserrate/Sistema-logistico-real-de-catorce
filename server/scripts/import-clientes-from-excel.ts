/**
 * Importa / unifica clientes desde clientes_exportado_completo.xlsx.
 * Respeta los nombres de establecimientos del Reparto (no sobrescribe client.name al actualizar).
 *
 * Uso: npx ts-node scripts/import-clientes-from-excel.ts
 * (ejecutar desde la carpeta server)
 */
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

require('dotenv').config();

const EXCEL_PATH = 'C:\\Users\\juanma\\Desktop\\clientes_exportado_completo.xlsx';
const TENANT_ID = 'default-tenant';
const DEPOT_NAMES = ['real 14', 'real 14 ', 'depot', 'depósito'];

function normalizeForMatch(s: string): string {
    return (s ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ');
}

/** Parsea "LOCALIDAD - ZONA" → { locality, zone } */
function parseLocalidadZona(cell: string): { locality: string; zone: string } {
    const raw = String(cell ?? '').trim();
    const idx = raw.indexOf(' - ');
    if (idx >= 0) {
        return {
            locality: raw.slice(0, idx).trim(),
            zone: raw.slice(idx + 3).trim()
        };
    }
    return { locality: raw, zone: raw || '' };
}

function isDepot(name: string): boolean {
    const n = normalizeForMatch(name);
    return DEPOT_NAMES.some(d => n.includes(d) || d.includes(n));
}

async function main() {
    if (!fs.existsSync(EXCEL_PATH)) {
        console.error('No se encontró el archivo:', EXCEL_PATH);
        process.exit(1);
    }

    const prisma = new PrismaClient();
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const firstCell = rows[0]?.[0] != null ? String(rows[0][0]).trim().toLowerCase() : '';
    const hasHeader = /cliente|nombre|establecimiento/.test(firstCell) && rows.length > 1;
    const startRow = hasHeader ? 1 : 0;
    const dataRows = rows.slice(startRow).filter(r => Array.isArray(r) && String(r[0] ?? '').trim());

    console.log('Filas de datos a procesar:', dataRows.length);

    const clients = await prisma.client.findMany({
        where: { tenantId: TENANT_ID },
        select: { id: true, name: true }
    });
    const mappings = await prisma.establishmentMapping.findMany({
        include: { client: true }
    });

    const byNormClientName: Record<string, { id: string; name: string }> = {};
    for (const c of clients) {
        const norm = normalizeForMatch(c.name);
        if (norm) byNormClientName[norm] = c;
    }
    const byNormExcelName: Record<string, { id: string; name: string }> = {};
    for (const m of mappings) {
        const norm = normalizeForMatch(m.excelName);
        if (norm) byNormExcelName[norm] = { id: m.client.id, name: m.client.name };
    }

    function findClient(excelName: string): { id: string; name: string } | null {
        const norm = normalizeForMatch(excelName);
        if (!norm) return null;
        return byNormClientName[norm] ?? byNormExcelName[norm] ?? null;
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const nameRaw = String(row[0] ?? '').trim();
        if (!nameRaw) continue;
        if (isDepot(nameRaw)) {
            skipped++;
            continue;
        }

        const localityZona = String(row[1] ?? '').trim();
        const { locality, zone } = parseLocalidadZona(localityZona);
        let address = String(row[2] ?? '').trim();
        const numero = String(row[3] ?? '').trim();
        if (numero && address) address = `${address} ${numero}`.trim();
        const lat = row[4] != null && row[4] !== '' ? Number(row[4]) : null;
        const lng = row[5] != null && row[5] !== '' ? Number(row[5]) : null;

        if (!address && lat != null && lng != null) {
            address = `${locality}${zone ? ', ' + zone : ''}`;
        }

        const existing = findClient(nameRaw);

        if (existing) {
            await prisma.client.update({
                where: { id: existing.id },
                data: {
                    address: address || undefined,
                    latitude: lat ?? undefined,
                    longitude: lng ?? undefined,
                    zone: zone || undefined,
                    barrio: locality || undefined
                }
            });
            updated++;
        } else {
            await prisma.client.create({
                data: {
                    tenantId: TENANT_ID,
                    name: nameRaw,
                    address: address || undefined,
                    latitude: lat ?? undefined,
                    longitude: lng ?? undefined,
                    zone: zone || undefined,
                    barrio: locality || undefined
                }
            });
            created++;
        }
    }

    console.log('Resumen: creados', created, '| actualizados', updated, '| omitidos (depósito)', skipped);
    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
