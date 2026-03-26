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
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Seeding drivers from existing trips...');
        // 1. Get all unique drivers from Trips
        // We use distinct to avoid duplicates
        const distinctDrivers = yield prisma.trip.findMany({
            select: {
                driver: true
            },
            where: {
                driver: { not: null }
            },
            distinct: ['driver']
        });
        let count = 0;
        for (const item of distinctDrivers) {
            if (!item.driver)
                continue;
            const driverName = item.driver.toUpperCase().trim();
            // Skip if invalid or empty
            if (driverName.length < 2)
                continue;
            // Create or ignore if exists
            // Username = First name or full name? Let's use Full Name as username for easy lookup in this MVP
            // Password = "123" (requested simple)
            try {
                const exists = yield prisma.driver.findUnique({
                    where: { username: driverName }
                });
                if (!exists) {
                    yield prisma.driver.create({
                        data: {
                            username: driverName,
                            password: "123", // Default password
                            fullName: driverName,
                            role: "DRIVER"
                        }
                    });
                    console.log(`Created user for: ${driverName}`);
                    count++;
                }
            }
            catch (e) {
                console.error(`Error creating ${driverName}:`, e);
            }
        }
        // Create ADMIN
        const adminExists = yield prisma.driver.findUnique({ where: { username: 'ADMIN' } });
        if (!adminExists) {
            yield prisma.driver.create({
                data: {
                    username: 'ADMIN',
                    password: 'admin123',
                    fullName: 'ADMINISTRADOR',
                    role: 'ADMIN'
                }
            });
            console.log('Created ADMIN user.');
        }
        console.log(`Seeding complete. Created ${count} driver accounts.`);
    });
}
main()
    .catch((e) => console.error(e))
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
