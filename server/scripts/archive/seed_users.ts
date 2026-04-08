
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding drivers from existing trips...');

  // 1. Get all unique drivers from Trips
  // We use distinct to avoid duplicates
  const distinctDrivers = await prisma.trip.findMany({
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
    if (!item.driver) continue;
    
    const driverName = item.driver.toUpperCase().trim();
    
    // Skip if invalid or empty
    if (driverName.length < 2) continue;

    // Create or ignore if exists
    // Username = First name or full name? Let's use Full Name as username for easy lookup in this MVP
    // Password = "123" (requested simple)
    
    try {
        const exists = await prisma.driver.findUnique({
            where: { username: driverName }
        });

        if (!exists) {
            await prisma.driver.create({
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
    } catch (e) {
        console.error(`Error creating ${driverName}:`, e);
    }
  }

  // Create ADMIN
  const adminExists = await prisma.driver.findUnique({ where: { username: 'ADMIN' } });
  if (!adminExists) {
      await prisma.driver.create({
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
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
