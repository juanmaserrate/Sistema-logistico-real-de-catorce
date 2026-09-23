/**
 * Envío de mails desde una casilla de Microsoft 365 (Microsoft Graph).
 *
 * Usa el método de "aplicación": el servidor pide un token con sus credenciales
 * y envía sin que haya una persona logueada. Las credenciales salen de Railway:
 *   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET  → la aplicación de Entra ID
 *   MAIL_FROM                                     → la casilla que envía
 *   MAIL_TO                                       → destinatarios por defecto (separados por coma)
 *
 * Si falta alguna, el sistema sigue funcionando igual: no manda mails y lo
 * registra en el log. Nunca rompe la operación por un mail.
 */

type TokenCache = { token: string; vence: number };
let _token: TokenCache | null = null;

export function mailConfigurado(): boolean {
    return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MAIL_FROM);
}

export function faltanVariablesMail(): string[] {
    return ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MAIL_FROM'].filter((v) => !process.env[v]);
}

/** Token de aplicación contra Entra ID. Se cachea hasta 5 min antes de vencer. */
async function obtenerToken(): Promise<string> {
    if (_token && Date.now() < _token.vence) return _token.token;
    // Un espacio o salto de linea pegado al secreto rompe la autenticacion
    // sin decir por que: se limpian los tres valores antes de usarlos.
    const tenant = String(process.env.MS_TENANT_ID).trim();
    const body = new URLSearchParams({
        client_id: String(process.env.MS_CLIENT_ID).trim(),
        client_secret: String(process.env.MS_CLIENT_SECRET).trim(),
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        throw new Error(`No se pudo autenticar contra Microsoft: ${data.error_description || data.error || res.status}`);
    }
    _token = { token: data.access_token, vence: Date.now() + Math.max(60, (Number(data.expires_in) || 3600) - 300) * 1000 };
    return _token.token;
}

export type ResultadoMail = { ok: boolean; error?: string; codigo?: string; detalle?: any; destinatarios?: string[] };

/** Envía un mail HTML. `to` vacío = los de MAIL_TO. */
export async function enviarMail(asunto: string, html: string, to?: string[] | string): Promise<ResultadoMail> {
    if (!mailConfigurado()) {
        const faltan = faltanVariablesMail().join(', ');
        console.warn(`[mail] sin configurar (faltan: ${faltan}) — no se envió: ${asunto}`);
        return { ok: false, error: `Faltan variables: ${faltan}` };
    }
    const lista = (Array.isArray(to) ? to : String(to || process.env.MAIL_TO || '').split(','))
        .map((x) => String(x).trim())
        .filter(Boolean);
    if (!lista.length) return { ok: false, error: 'No hay destinatarios (MAIL_TO vacío)' };

    try {
        const token = await obtenerToken();
        const from = String(process.env.MAIL_FROM).trim();
        const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: {
                    subject: asunto,
                    body: { contentType: 'HTML', content: html },
                    toRecipients: lista.map((address) => ({ emailAddress: { address } })),
                },
                // Por pedido del administrador: no se guarda copia en Elementos
                // enviados de la casilla (MAIL_SAVE_SENT=true lo vuelve a activar).
                saveToSentItems: String(process.env.MAIL_SAVE_SENT || '').toLowerCase() === 'true',
            }),
        });
        if (res.status === 202 || res.ok) {
            console.log(`[mail] enviado a ${lista.join(', ')}: ${asunto}`);
            return { ok: true, destinatarios: lista };
        }
        const data: any = await res.json().catch(() => ({}));
        const detalle = data?.error?.message || `HTTP ${res.status}`;
        console.error(`[mail] falló el envío (${res.status} ${data?.error?.code || ''}): ${detalle}`);
        return {
            ok: false,
            error: detalle,
            codigo: data?.error?.code || String(res.status),
            detalle: { status: res.status, innerError: data?.error?.innerError || null, from },
            destinatarios: lista,
        };
    } catch (e: any) {
        console.error('[mail] error:', e?.message || e);
        return { ok: false, error: e?.message || String(e) };
    }
}

/** Plantilla simple con el estilo del sistema, para que todos los avisos se vean igual. */
export function plantillaMail(titulo: string, intro: string, cuerpoHtml: string, pie?: string): string {
    return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px">
  <div style="background:#141F46;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
    <div style="font-size:18px;font-weight:bold;letter-spacing:1px">R14 · ${titulo}</div>
  </div>
  <div style="border:1px solid #e0e5f2;border-top:none;padding:18px;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px;font-size:14px">${intro}</p>
    ${cuerpoHtml}
    <p style="margin:18px 0 0;font-size:11px;color:#777">
      ${pie || 'Aviso automático del sistema de logística R14 · r14trafico.com'}
    </p>
  </div>
</div>`;
}
