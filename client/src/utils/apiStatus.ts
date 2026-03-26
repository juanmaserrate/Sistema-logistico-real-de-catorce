/** Mensaje unificado cuando el backend no responde */
export const API_OFFLINE_MESSAGE = 'API no disponible. Comprueba que el servidor esté encendido.';

/** Comprueba si un error de fetch es por red/servidor caído */
export function isNetworkError(err: unknown): boolean {
    if (err instanceof TypeError && err.message?.includes('fetch')) return true;
    if (err instanceof Error && /Failed to fetch|NetworkError|Load failed/i.test(err.message)) return true;
    return false;
}

const HEALTH_URL = '/api/health';

export type HealthState = { ok: boolean; lastCheck: number };

/** Pings el health check del backend */
export async function checkApiHealth(): Promise<boolean> {
    try {
        const res = await fetch(HEALTH_URL, { method: 'GET', cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        return res.ok && data?.ok === true;
    } catch {
        return false;
    }
}
