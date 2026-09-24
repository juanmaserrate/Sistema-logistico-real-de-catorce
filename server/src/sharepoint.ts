/**
 * Deja archivos en SharePoint (Microsoft Graph).
 *
 * Usa la misma aplicacion de Entra ID que manda los mails: MS_TENANT_ID,
 * MS_CLIENT_ID y MS_CLIENT_SECRET. Lo unico que hay que sumar es el permiso
 * de escritura sobre UNA carpeta, y estas dos variables:
 *
 *   SP_DRIVE_ID  → la biblioteca "Documentos compartidos" del sitio
 *   SP_CARPETA   → carpeta destino, ej. "Operaciones/LOGISTICA/TMS"
 *
 * Si falta alguna, no sube nada y lo dice: nunca rompe la operacion.
 *
 * El permiso correcto es Sites.Selected, no Files.ReadWrite.All: con el
 * primero el administrador habilita el sistema solo en el sitio elegido.
 */

type TokenCache = { token: string; vence: number };
let _token: TokenCache | null = null;

export function sharepointConfigurado(): boolean {
    return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.SP_DRIVE_ID);
}

export function faltanVariablesSharepoint(): string[] {
    return ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'SP_DRIVE_ID'].filter((v) => !process.env[v]);
}

export function limpiarTokenSharepoint(): void {
    _token = null;
}

/** Token de aplicacion. Se guarda hasta 5 min antes de vencer. */
async function obtenerToken(): Promise<string> {
    if (_token && Date.now() < _token.vence) return _token.token;
    const tenant = String(process.env.MS_TENANT_ID).trim();
    const body = new URLSearchParams({
        client_id: String(process.env.MS_CLIENT_ID).trim(),
        client_secret: String(process.env.MS_CLIENT_SECRET).trim(),
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
    });
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        throw new Error(`No se pudo autenticar contra Microsoft: ${data.error_description || data.error || res.status}`);
    }
    _token = { token: data.access_token, vence: Date.now() + Math.max(60, (Number(data.expires_in) || 3600) - 300) * 1000 };
    return _token.token;
}

/** Carpeta destino sin barras sueltas. */
function carpetaDestino(): string {
    return String(process.env.SP_CARPETA || 'Operaciones/LOGISTICA/TMS').replace(/^\/+|\/+$/g, '');
}

export type ResultadoSubida = { ok: boolean; nombre: string; bytes?: number; url?: string; error?: string; codigo?: string };

/**
 * Crea la carpeta destino si no existe, un nivel por vez. Sin esto, la primera
 * subida falla con "itemNotFound" y hay que ir a crearla a mano en SharePoint.
 */
async function asegurarCarpeta(drive: string, token: string): Promise<void> {
    const partes = carpetaDestino().split('/').filter(Boolean);
    let recorrido = '';
    for (const parte of partes) {
        const padre = recorrido;
        recorrido = recorrido ? `${recorrido}/${parte}` : parte;
        const ver = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive)}/root:/${encodeURI(recorrido)}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (ver.ok) continue;
        const destino = padre
            ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive)}/root:/${encodeURI(padre)}:/children`
            : `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive)}/root/children`;
        const crear = await fetch(destino, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: parte, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
        });
        // 409 = ya existe (dos subidas a la vez): no es un error.
        if (!crear.ok && crear.status !== 409) {
            const err: any = await crear.json().catch(() => ({}));
            throw new Error(`No se pudo crear la carpeta ${recorrido}: ${err?.error?.message || crear.status}`);
        }
    }
}

/**
 * Sube (o reemplaza) un archivo. Hasta 4 MB va en un solo envio; mas grande,
 * por sesion de carga en pedazos de 5 MB, que es lo que pide Graph.
 */
export async function subirArchivo(nombre: string, contenido: Buffer): Promise<ResultadoSubida> {
    if (!sharepointConfigurado()) {
        return { ok: false, nombre, error: `Faltan variables: ${faltanVariablesSharepoint().join(', ')}` };
    }
    const drive = String(process.env.SP_DRIVE_ID).trim();
    const ruta = `${carpetaDestino()}/${nombre}`;
    try {
        const token = await obtenerToken();
        await asegurarCarpeta(drive, token);
        if (contenido.length <= 4 * 1024 * 1024) {
            const res = await fetch(
                `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive)}/root:/${encodeURI(ruta)}:/content`,
                {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    },
                    body: new Uint8Array(contenido)
                }
            );
            const data: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                return { ok: false, nombre, error: data?.error?.message || `HTTP ${res.status}`, codigo: data?.error?.code || String(res.status) };
            }
            return { ok: true, nombre, bytes: contenido.length, url: data?.webUrl };
        }
        return await subirEnPedazos(drive, ruta, nombre, contenido);
    } catch (e: any) {
        return { ok: false, nombre, error: e?.message || String(e) };
    }
}

/** Archivos grandes: sesion de carga, pedazos de 5 MB. */
async function subirEnPedazos(drive: string, ruta: string, nombre: string, contenido: Buffer): Promise<ResultadoSubida> {
    const token = await obtenerToken();
    const inicio = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive)}/root:/${encodeURI(ruta)}:/createUploadSession`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
        }
    );
    const sesion: any = await inicio.json().catch(() => ({}));
    if (!inicio.ok || !sesion.uploadUrl) {
        return { ok: false, nombre, error: sesion?.error?.message || `HTTP ${inicio.status}`, codigo: sesion?.error?.code };
    }
    const PEDAZO = 5 * 1024 * 1024;
    for (let desde = 0; desde < contenido.length; desde += PEDAZO) {
        const hasta = Math.min(desde + PEDAZO, contenido.length) - 1;
        const parte = contenido.subarray(desde, hasta + 1);
        const res = await fetch(sesion.uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': String(parte.length),
                'Content-Range': `bytes ${desde}-${hasta}/${contenido.length}`
            },
            body: new Uint8Array(parte)
        });
        if (!res.ok && res.status !== 202 && res.status !== 201 && res.status !== 200) {
            const err: any = await res.json().catch(() => ({}));
            return { ok: false, nombre, error: err?.error?.message || `HTTP ${res.status} al subir un pedazo` };
        }
    }
    return { ok: true, nombre, bytes: contenido.length };
}

/** Que permisos trae el token y si la carpeta se puede leer. No expone el secreto. */
export async function diagnosticoSharepoint(): Promise<any> {
    if (!sharepointConfigurado()) return { ok: false, faltan: faltanVariablesSharepoint() };
    try {
        const token = await obtenerToken();
        const payload = JSON.parse(
            Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
        );
        const roles: string[] = payload.roles || [];
        const drive = String(process.env.SP_DRIVE_ID).trim();
        const res = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive)}/root:/${encodeURI(carpetaDestino())}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const data: any = await res.json().catch(() => ({}));
        return {
            ok: true,
            permisosEnElToken: roles,
            puedeEscribir: roles.some((r) => /Sites\.Selected|Files\.ReadWrite|Sites\.ReadWrite/i.test(r)),
            carpeta: carpetaDestino(),
            carpetaEncontrada: res.ok,
            detalleCarpeta: res.ok ? { nombre: data?.name, url: data?.webUrl } : (data?.error?.message || `HTTP ${res.status}`),
            vence: payload.exp ? new Date(payload.exp * 1000).toISOString() : null
        };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}
