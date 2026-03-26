-- CreateTable
CREATE TABLE "Trip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "priority" TEXT,
    "zone" TEXT,
    "vehicle" TEXT,
    "driver" TEXT,
    "provider" TEXT,
    "auxiliar" TEXT,
    "businessUnit" TEXT,
    "distributionType" TEXT,
    "contractType" TEXT,
    "vehicleType" TEXT,
    "tripType" TEXT,
    "entryTime" TEXT,
    "exitTime" DATETIME,
    "returnTime" DATETIME,
    "value" DECIMAL DEFAULT 0,
    "paymentStatus" TEXT,
    "paymentDate" DATETIME,
    "observations" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "driverComments" TEXT,
    "proofPhotoUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'DRIVER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Trip_date_idx" ON "Trip"("date");

-- CreateIndex
CREATE INDEX "Trip_driver_idx" ON "Trip"("driver");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_username_key" ON "Driver"("username");
