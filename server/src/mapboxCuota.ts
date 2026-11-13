/* ============================================================================
 * TOPE MENSUAL DE MAPBOX
 * ============================================================================
 * Mapbox regala 100.000 pedidos por mes de cada servicio y despues cobra. El
 * servidor cuenta cada pedido que hace y, si el mes llega al tope, deja de
 * pedir: el recorrido se dibuja con los puntos tal cual (sin pegar a la calle)
 * hasta que empieza el mes siguiente. Asi nunca llega una factura.
 *
 * Lo que pide el navegador directo (cargar el mapa, buscar una direccion en la
 * ficha del cliente) no pasa por aca: eso se ve en el panel de Mapbox.
 * ========================================================================= */

export type ServicioMapbox = 'matching' | 'geocoding' | 'directions';

/** Debajo de los 100.000 gratis, con margen para lo que pida el navegador. */
export const TOPE_MENSUAL: Record<ServicioMapbox, number> = {
    matching: Number(process.env.MAPBOX_TOPE_MATCHING) || 90_000,
    geocoding: Number(process.env.MAPBOX_TOPE_GEOCODING) || 90_000,
    directions: Number(process.env.MAPBOX_TOPE_DIRECTIONS) || 90_000,
};

/** "2026-11" en hora de Buenos Aires */
export function mesActual(ahora = new Date()): string {
    const ba = new Date(ahora.getTime() - 3 * 3600 * 1000);
    return `${ba.getUTCFullYear()}-${String(ba.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Pide permiso para hacer UN pedido a Mapbox. Devuelve false si el mes ya
 * esta en el tope (y lo anota como frenado). Si la base falla, deja pasar:
 * un hipo de la base no tiene que apagar los mapas.
 */
export async function usarCuotaMapbox(prisma: any, api: ServicioMapbox): Promise<boolean> {
    const mes = mesActual();
    try {
        const fila = await prisma.mapboxUso.findUnique({ where: { mes_api: { mes, api } } });
        if (fila && fila.pedidos >= TOPE_MENSUAL[api]) {
            await prisma.mapboxUso.update({ where: { mes_api: { mes, api } }, data: { frenados: { increment: 1 } } }).catch(() => {});
            return false;
        }
        await prisma.mapboxUso.upsert({
            where: { mes_api: { mes, api } },
            create: { mes, api, pedidos: 1 },
            update: { pedidos: { increment: 1 } }
        });
        return true;
    } catch (e: any) {
        console.warn('[mapbox] no se pudo contar el pedido:', e?.message || e);
        return true;
    }
}
