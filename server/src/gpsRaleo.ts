/* ============================================================================
 * EL GPS SE GUARDA, NO SE BORRA
 * ============================================================================
 * Desde el 20-nov-2026 el celular manda un punto por segundo (pedido de juanma:
 * "saber la ubicacion exacta de la flota en cualquier momento y que quede
 * guardado por segundo"). Antes, la limpieza diaria BORRABA todo el GPS de
 * mas de 30 dias.
 *
 * Ahora:
 *   - los ultimos 60 dias quedan completos, segundo a segundo;
 *   - lo mas viejo se ralea a un punto cada 10 segundos por celular, y queda
 *     para siempre. Alcanza para ver cualquier recorrido viejo y la base no
 *     crece de mas (con 25 camiones, ~3 GB por mes a 1 por segundo).
 *
 * Se ralea de a un dia por vez, para que cada borrado sea chico. Se repasan
 * siempre los 7 dias que acaban de cumplir 60: si el servidor estuvo apagado
 * unos dias, se pone al dia solo. Volver a pasar por un dia ya raleado no
 * borra nada (ya queda uno solo por cada 10 segundos).
 * ========================================================================= */

export const GPS_DIAS_COMPLETOS = 60;
export const GPS_SEGUNDOS_RALEO = 10;
const DIAS_A_REPASAR = 7;
const DIA_MS = 24 * 3600 * 1000;

/** Ralea el GPS que ya cumplio 60 dias. Devuelve cuantos puntos saco. */
export async function ralearGpsViejo(prisma: any, ahora: Date = new Date()): Promise<number> {
    // Los cortes van a la medianoche (UTC): asi un tramo de 10 s nunca queda
    // partido entre dos dias, que dejaria un punto de mas.
    const hace60 = ahora.getTime() - GPS_DIAS_COMPLETOS * DIA_MS;
    const limite = hace60 - (hace60 % DIA_MS);
    let sacados = 0;
    for (let i = DIAS_A_REPASAR; i >= 1; i--) {
        const desde = new Date(limite - i * DIA_MS).toISOString();
        const hasta = new Date(limite - (i - 1) * DIA_MS).toISOString();
        // Las columnas guardan UTC sin zona: la fecha va como timestamptz y se
        // pasa a UTC (en una base que no este en UTC, sin esto se corre 3 h).
        // De cada celular y cada tramo de 10 segundos queda el primer punto.
        const n = await prisma.$executeRaw`
            DELETE FROM "DeviceLocation" d
            USING (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY "deviceId", floor(extract(epoch from COALESCE("capturedAt", "timestamp")) / ${GPS_SEGUNDOS_RALEO})
                    ORDER BY COALESCE("capturedAt", "timestamp"), id
                ) AS rn
                FROM "DeviceLocation"
                WHERE "timestamp" >= (${desde}::timestamptz AT TIME ZONE 'UTC')
                  AND "timestamp" <  (${hasta}::timestamptz AT TIME ZONE 'UTC')
            ) x
            WHERE d.id = x.id AND x.rn > 1`;
        sacados += Number(n) || 0;
    }
    return sacados;
}
