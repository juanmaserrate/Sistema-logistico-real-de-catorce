/**
 * Script de una sola ejecución: lee el Excel de repartos y la base de clientes,
 * y lista en consola los establecimientos del Excel que NO hicieron match.
 */
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

require('dotenv').config();

const REPARTOS_EXCEL_PATHS = [
    'C:\\Users\\juanma\\Desktop\\Repartos y colegios .xlsx',
    'C:\\Users\\juanma\\Desktop\\Repartos y colegios.xlsx',
];

function getRepartosExcelPath(): string | null {
    for (const p of REPARTOS_EXCEL_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function normalizeForMatch(s: string): string {
    return s
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ');
}

function findBestMatchingClient(
    excelName: string,
    clients: { id: string; name: string }[]
): { id: string; name: string } | null {
    if (!excelName || clients.length === 0) return null;
    const normExcel = normalizeForMatch(excelName);
    const exact = clients.find((c) => normalizeForMatch(c.name) === normExcel);
    if (exact) return exact;
    const contains = clients.find(
        (c) =>
            normalizeForMatch(c.name).includes(normExcel) ||
            normExcel.includes(normalizeForMatch(c.name))
    );
    if (contains) return contains;
    const byLength = clients
        .map((c) => ({
            c,
            norm: normalizeForMatch(c.name),
            len: Math.abs(normalizeForMatch(c.name).length - normExcel.length),
        }))
        .filter((x) => x.norm.length > 0 && normExcel.length > 0);
    byLength.sort((a, b) => a.len - b.len);
    if (byLength[0] && byLength[0].len <= 10) return byLength[0].c;
    return null;
}

async function main() {
    const prisma = new PrismaClient();
    const excelPath = getRepartosExcelPath();
    if (!excelPath) {
        console.error('No se encontró el archivo Repartos y colegios.xlsx en el Escritorio.');
        process.exit(1);
    }

    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    const firstCell =
        rows[0]?.[0] != null ? String(rows[0][0]).trim().toLowerCase() : '';
    const looksLikeHeader =
        /reparto|nombre|establecimiento|colegio|escuela|columna/.test(firstCell) &&
        rows.length > 1;
    const startRow = looksLikeHeader ? 1 : 0;
    const byReparto: Record<string, string[]> = {};
    for (let i = startRow; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;
        const repartoName = row[0] != null ? String(row[0]).trim() : '';
        const establecimiento = row[1] != null ? String(row[1]).trim() : '';
        if (!repartoName) continue;
        if (!byReparto[repartoName]) byReparto[repartoName] = [];
        if (establecimiento) byReparto[repartoName].push(establecimiento);
    }

    const uniqueExcelNames = [...new Set(Object.values(byReparto).flat())].filter(
        (n) => n.trim()
    );
    const clients = await prisma.client.findMany({
        where: { tenantId: 'default-tenant' },
        select: { id: true, name: true },
    });

    const usedClientIds = new Set<string>();
    const unmatched: string[] = [];
    for (const excelName of uniqueExcelNames) {
        const availableClients = clients.filter((c) => !usedClientIds.has(c.id));
        const client = findBestMatchingClient(excelName, availableClients);
        if (client) {
            usedClientIds.add(client.id);
        } else {
            unmatched.push(excelName);
        }
    }

    unmatched.sort();
    console.log('--- ESTABLECIMIENTOS QUE NO HICIERON MATCH ---');
    if (unmatched.length === 0) {
        console.log('Ninguno. Todos los establecimientos del Excel se vincularon a un cliente.');
    } else {
        unmatched.forEach((name) => console.log(name));
        console.log('');
        console.log('Total:', unmatched.length);
    }
    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
