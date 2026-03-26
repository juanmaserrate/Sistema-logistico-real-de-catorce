"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const fs_1 = __importDefault(require("fs"));
const prisma = new client_1.PrismaClient();
const FILE_PATH = 'c:\\Users\\juanma\\Desktop\\temp_history_data.json';
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!fs_1.default.existsSync(FILE_PATH)) {
                console.error("No source data found at " + FILE_PATH);
                return;
            }
            const rawData = fs_1.default.readFileSync(FILE_PATH, 'utf8');
            const trips = JSON.parse(rawData);
            console.log(`Found ${trips.length} trips to import into R14 DB.`);
            let count = 0;
            for (const t of trips) {
                let dateVal = new Date();
                if (t.FECHA)
                    dateVal = new Date(t.FECHA);
                let val = 0;
                let originalVal = t.VALOR;
                if (typeof originalVal === 'number')
                    val = originalVal;
                else if (typeof originalVal === 'string') {
                    const clean = originalVal.replace(/[$,]/g, '').trim();
                    if (!clean.toUpperCase().includes('PROPIO')) {
                        const parsed = parseFloat(clean);
                        if (!isNaN(parsed))
                            val = parsed;
                    }
                }
                yield prisma.trip.create({
                    data: {
                        date: dateVal,
                        priority: t.PRIORIDAD ? String(t.PRIORIDAD) : null,
                        zone: t.ZONA ? String(t.ZONA) : null,
                        vehicle: t.VEHICULO ? String(t.VEHICULO) : null,
                        driver: t.CHOFER ? String(t.CHOFER) : null,
                        provider: t.PROVEEDOR ? String(t.PROVEEDOR) : null,
                        auxiliar: t.AUXILIAR ? String(t.AUXILIAR) : null,
                        businessUnit: t['UNID NEGOCIO'] ? String(t['UNID NEGOCIO']) : null,
                        distributionType: t.REPARTO ? String(t.REPARTO) : null,
                        contractType: t.CONTRATACION ? String(t.CONTRATACION) : null,
                        vehicleType: (t['TIPO_DE_VEHICULO'] || t['TIPO DE VEHICULO']) ? String(t['TIPO_DE_VEHICULO'] || t['TIPO DE VEHICULO']) : null,
                        tripType: t.TIPO_DE_VIAJE ? String(t.TIPO_DE_VIAJE) : null,
                        entryTime: t['HORARIO DE INGRESO'] ? String(t['HORARIO DE INGRESO']) : null,
                        value: val,
                        paymentStatus: t.PAGO ? String(t.PAGO) : 'PENDIENTE',
                        observations: t.OBSERVACIONES ? String(t.OBSERVACIONES) : null,
                        notes: t['NOTA IMPORTANTE'] ? String(t['NOTA IMPORTANTE']) : null,
                        status: 'COMPLETED'
                    }
                });
                count++;
            }
            console.log(`R14 Import finished. Total: ${count}`);
        }
        catch (error) {
            console.error(error);
        }
        finally {
            yield prisma.$disconnect();
        }
    });
}
main();
