-- AlterTable: DeviceLocation — enlace a ruta/chofer y métricas de seguimiento
ALTER TABLE "DeviceLocation" ADD COLUMN "driverId" TEXT;
ALTER TABLE "DeviceLocation" ADD COLUMN "routeId" INTEGER;
ALTER TABLE "DeviceLocation" ADD COLUMN "speed" REAL;
ALTER TABLE "DeviceLocation" ADD COLUMN "heading" REAL;
ALTER TABLE "DeviceLocation" ADD COLUMN "offRouteMeters" REAL;

CREATE INDEX IF NOT EXISTS "DeviceLocation_routeId_timestamp_idx" ON "DeviceLocation"("routeId", "timestamp");
CREATE INDEX IF NOT EXISTS "DeviceLocation_driverId_idx" ON "DeviceLocation"("driverId");
