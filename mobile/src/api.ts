import { API_BASE, assertApiConfigured, STORAGE_KEYS } from './config';
import type { Route, RouteGeometry, SessionUser, Incident } from './types';
import AsyncStorage from '@react-native-async-storage/async-storage';

function apiUrl(path: string): string {
  assertApiConfigured();
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

const ROUTES_CACHE_KEY = 'r14_routes_today_cache';

// ── Manejo global de sesión vencida (token 401) ───────────────────────────────
// La app guarda la sesión del chofer pero el token JWT dura 30 días. Cuando
// vence, todas las llamadas autenticadas devuelven 401. Sin este manejo, el
// chofer quedaba "logueado" pero sin poder hacer nada y sin aviso. Ahora una
// sola respuesta 401 dispara el handler que App.tsx usa para cerrar sesión y
// mandarlo a Login con un mensaje claro. La cola offline NO se borra.
let _authExpiredHandler: (() => void) | null = null;
let _authExpiredCoolingDown = false;
export function setAuthExpiredHandler(fn: (() => void) | null): void {
  _authExpiredHandler = fn;
}
function notifyAuthExpired(): void {
  if (_authExpiredCoolingDown) return; // evitar múltiples disparos en ráfaga
  _authExpiredCoolingDown = true;
  try { _authExpiredHandler?.(); } catch { /* */ }
  setTimeout(() => { _authExpiredCoolingDown = false; }, 8000);
}

/** Fetch with automatic retry (exponential backoff) and configurable timeout.
 *  noAuthGuard: true en el login (un 401 ahí = credenciales malas, no sesión vencida). */
async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeout?: number; noAuthGuard?: boolean } = {},
  retries = 3
): Promise<Response> {
  const { timeout = 10000, noAuthGuard = false, ...fetchOpts } = options;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
      clearTimeout(tid);
      // Token vencido/inválido → avisar a la app (salvo en el propio login).
      // SOLO si la request llevaba Authorization: un 401 en una llamada que
      // salió SIN token es un bug de headers nuestro, no una sesión vencida.
      // (Esto deslogueaba a los choferes en loop cuando geometry iba sin token.)
      if (res.status === 401 && !noAuthGuard) {
        const h = (fetchOpts.headers || {}) as Record<string, string>;
        const hadAuth = Object.keys(h).some((k) => k.toLowerCase() === 'authorization');
        if (hadAuth) notifyAuthExpired();
      }
      return res;
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

/** Fetch de UN intento con timeout (sin retry/backoff). Para colas offline y
 *  llamadas best-effort: si falla, el caller decide rapido (encolar/descartar)
 *  en vez de colgarse esperando una red que no responde. */
function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  return fetchWithRetry(url, options, 0);
}

const AUTH_TOKEN_KEY = 'r14_auth_token';

async function getAuthToken(): Promise<string | null> {
  try { return await AsyncStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const url = apiUrl('/api/auth/login');
  let res: Response;
  try {
    res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      timeout: 15000,
      noAuthGuard: true, // un 401 aquí = credenciales inválidas, no sesión vencida
    }, 2);
  } catch (e) {
    throw new Error(`No se pudo conectar al servidor (${API_BASE}). Verificá tu conexión a internet.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Error de login');
  const token = (data as { token?: string }).token;
  if (token) await AsyncStorage.setItem(AUTH_TOKEN_KEY, token).catch(() => {});
  const u = (data as { user?: SessionUser }).user;
  if (!u) throw new Error('Respuesta inválida');
  return u;
}

export async function logout(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY).catch(() => {});
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function fetchRoutesToday(driverId: string): Promise<Route[]> {
  const today = localYmd(new Date());
  const q = new URLSearchParams({
    driverId,
    date: today,
    _ts: String(Date.now()),
  });
  try {
    // Más paciencia para el arranque con red lenta (7am, hora pico): timeout
    // 15s y hasta 3 reintentos con backoff. Si igual falla, el catch usa el
    // cache de hoy y la pantalla muestra el auto-retry de TrackScreen.
    const res = await fetchWithRetry(
      apiUrl(`/api/v1/routes?${q}`),
      { headers: { 'Cache-Control': 'no-cache', ...(await authHeaders()) }, timeout: 15000 },
      3
    );
    if (!res.ok) throw new Error('No se pudieron cargar las rutas');
    const routes = (await res.json()) as Route[];

    // BUG FIX: antes este bloque preferia el cache si el server respondia [] (creyendo
    // que era transitorio). Pero con el filtro nuevo del backend (excluye viajes
    // finalizados), [] es la respuesta CORRECTA cuando el chofer no tiene viajes activos.
    // Ahora SIEMPRE confiamos en la respuesta exitosa del server: la app refleja el
    // estado real y limpia el cache si quedó stale.

    // Filtrar tambien aca por si el server (version vieja) no filtra: redundancia segura.
    // Triple filtro:
    //  1. Solo del DIA ACTUAL del celular (anti-zona-horaria: si el server manda
    //     viajes de mañana por desfase de TZ, los filtramos).
    //  2. Sin actualEndTime (viaje no cerrado).
    //  3. Trip no esta en estado final.
    const filtered = routes.filter((r: any) => {
      if (r?.actualEndTime) return false;
      const ts = String(r?.trip?.status || '').toUpperCase();
      if (ts === 'COMPLETED' || ts === 'RETURNED') return false;
      // Verificar que la fecha del viaje sea HOY en la zona local del celu
      if (r?.date) {
        try {
          const routeYmd = localYmd(new Date(r.date));
          if (routeYmd !== today) return false;
        } catch { /* si el parseo falla, dejamos pasar */ }
      }
      return true;
    });

    // Cachear el resultado FILTRADO para futuros offline fallbacks
    AsyncStorage.setItem(
      ROUTES_CACHE_KEY,
      JSON.stringify({ driverId, date: today, routes: filtered, ts: Date.now() })
    ).catch(() => {});
    return filtered;
  } catch (e) {
    // Offline fallback: return cached routes if they belong to the same driver.
    // El cache YA esta filtrado (lo escribimos asi arriba), pero re-filtramos por seguridad.
    // FIX: validar tambien que el cache sea de HOY. Antes, si el chofer abria la app
    // al dia siguiente SIN senial, veia el viaje de AYER como si estuviera activo
    // (el operador ya lo habia cerrado y cargado el viaje nuevo). Ahora sin senial
    // muestra vacio hasta reconectar, que es el estado real.
    try {
      const raw = await AsyncStorage.getItem(ROUTES_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.driverId === driverId && cached?.date === today && Array.isArray(cached.routes)) {
          const cachedRoutes = cached.routes as Route[];
          return cachedRoutes.filter((r: any) => {
            if (r?.actualEndTime) return false;
            const ts = String(r?.trip?.status || '').toUpperCase();
            if (ts === 'COMPLETED' || ts === 'RETURNED') return false;
            return true;
          });
        }
      }
    } catch {}
    throw e;
  }
}

/** Cantidad de ubicaciones GPS pendientes en la cola offline. */
export async function getPendingLocationCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.offlineLocationQueue);
    if (!raw) return 0;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

export async function fetchRouteGeometry(routeId: number): Promise<RouteGeometry | null> {
  const q = new URLSearchParams({ _ts: String(Date.now()) });
  // /api/v1/routes/* requiere token desde abr-2026: esta llamada iba SIN
  // Authorization y devolvía 401 siempre ("Ruta no disponible en el mapa").
  const res = await fetchWithRetry(apiUrl(`/api/v1/routes/${routeId}/geometry?${q}`), {
    headers: { 'Cache-Control': 'no-cache', ...(await authHeaders()) },
    timeout: 8000,
  }, 1);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.points?.length) return null;
  return data as RouteGeometry;
}

export type NavStep = {
  instruction: string;
  distanceText: string;
  distanceMeters: number | null;
  durationText: string;
  maneuver: string | null;
};

export type NavigationToNext = {
  done: boolean;
  message?: string;
  targetStop: { sequence: number; name: string; lat: number; lng: number } | null;
  summary?: string | null;
  steps: NavStep[];
  overviewPolyline?: string | null;
  error?: string;
};

export async function fetchNavigationToNext(
  routeId: number,
  lat: number,
  lng: number
): Promise<NavigationToNext> {
  const q = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    _ts: String(Date.now()),
  });
  const res = await fetchWithRetry(apiUrl(`/api/v1/routes/${routeId}/navigation-to-next?${q}`), {
    headers: { 'Cache-Control': 'no-cache', ...(await authHeaders()) },
    timeout: 8000,
  }, 1);
  const data = (await res.json().catch(() => ({}))) as NavigationToNext & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Indicaciones no disponibles');
  }
  return {
    done: !!data.done,
    message: data.message,
    targetStop: data.targetStop ?? null,
    summary: data.summary ?? null,
    steps: Array.isArray(data.steps) ? data.steps : [],
    overviewPolyline: (data as any).overviewPolyline ?? null,
    error: data.error,
  };
}

// ── Offline Stop Queue ────────────────────────────────────────────────────────

interface OfflineStopAction {
  stopId: number;
  body: {
    status?: string;
    actualArrival?: string;
    actualDeparture?: string;
    observations?: string;
    proofPhotoUrl?: string | null;
    deliveryWithoutIssues?: boolean | null;
    reasonCode?: string | null;
  };
  timestamp: string;
}

async function readStopQueue(): Promise<OfflineStopAction[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.offlineStopQueue);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function writeStopQueue(queue: OfflineStopAction[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.offlineStopQueue, JSON.stringify(queue.slice(-100)));
}

// Mutex: si flushStopQueue ya está corriendo (ej. polling + AppState dispararon a la vez),
// reusamos la misma promise. Evita que dos llamadas en paralelo lean la misma cola y manden
// las mismas entregas DOS VECES al servidor (lo que crearía duplicados de paradas COMPLETED).
let _stopQueueFlushing: Promise<number> | null = null;
export function flushStopQueue(): Promise<number> {
  if (_stopQueueFlushing) return _stopQueueFlushing;
  _stopQueueFlushing = (async (): Promise<number> => {
    try {
      const queue = await readStopQueue();
      if (!queue.length) return 0;
      // BUG FIX: antes el for usaba `break` ante cualquier error y dejaba
      // los demas stops colgados eternamente. Ahora:
      //  - Error de red (TypeError/timeout): break (no hay senial, esperar)
      //  - Error 4xx (404/409/etc): la parada ya esta procesada o no existe,
      //    la descartamos de la cola y seguimos con la siguiente.
      //  - Error 5xx: break (server caido, reintentar despues)
      //  - 200/2xx OK: sent++ y seguir.
      const stillPending: OfflineStopAction[] = [];
      let sent = 0;
      let networkBroke = false;
      for (let i = 0; i < queue.length; i++) {
        const action = queue[i];
        if (networkBroke) {
          // Una vez que detectamos red caida, ya no intentamos los demas en este pase
          stillPending.push(action);
          continue;
        }
        try {
          const res = await fetchWithTimeout(apiUrl(`/api/v1/stops/${action.stopId}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify(action.body),
            timeout: 6000,
          });
          if (res.ok) {
            sent++;
          } else if (res.status >= 400 && res.status < 500) {
            // El stop no existe o ya fue procesado: descartar de la cola
            console.warn(`[flushStopQueue] Descartando stop ${action.stopId} HTTP ${res.status}`);
            sent++; // contar como procesado para no quedarnos atascados
          } else {
            // 5xx: server caido, reintentar luego
            stillPending.push(action);
            networkBroke = true;
          }
        } catch {
          // Error de red real: detener y conservar
          stillPending.push(action);
          networkBroke = true;
        }
      }
      if (stillPending.length === 0) {
        await AsyncStorage.removeItem(STORAGE_KEYS.offlineStopQueue);
      } else {
        await writeStopQueue(stillPending);
      }
      return sent;
    } finally {
      _stopQueueFlushing = null;
    }
  })();
  return _stopQueueFlushing;
}

export async function getPendingStopCount(): Promise<number> {
  const q = await readStopQueue();
  return q.length;
}

export async function patchStop(
  stopId: number,
  body: {
    status?: string;
    actualArrival?: string;
    actualDeparture?: string;
    observations?: string;
    proofPhotoUrl?: string | null;
    deliveryWithoutIssues?: boolean | null;
    reasonCode?: string | null;
  }
): Promise<unknown> {
  try {
    // Timeout 6s: con senial debil el fetch sin timeout colgaba la UI del
    // chofer; al abortar, cae al catch de abajo y la accion va a la cola offline.
    const res = await fetchWithTimeout(apiUrl(`/api/v1/stops/${stopId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
      timeout: 6000,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || 'No se pudo actualizar la parada');
    }
    // Flush any pending offline actions on success
    flushStopQueue().catch(() => {});
    return data;
  } catch (e: any) {
    // Network error → queue for later.
    // navigator.onLine NO existe en React Native: la única señal confiable de estar offline
    // es que fetch lance (TypeError o AbortError). Cualquier error de red lo encolamos.
    const msg = String(e?.message || '');
    const isNetworkError =
      e?.name === 'TypeError' ||
      e?.name === 'AbortError' ||
      /network|fetch|abort|timeout|failed to fetch/i.test(msg);
    if (isNetworkError) {
      const queue = await readStopQueue();
      queue.push({ stopId, body, timestamp: new Date().toISOString() });
      await writeStopQueue(queue);
      return { queued: true };
    }
    throw e;
  }
}

/**
 * Sube foto al servidor y devuelve URL absoluta lista para guardar en proofPhotoUrl.
 */
export async function uploadProofPhoto(localUri: string): Promise<string> {
  assertApiConfigured();
  const form = new FormData();
  form.append('photo', {
    uri: localUri,
    name: 'proof.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);

  const res = await fetchWithTimeout(apiUrl('/api/upload-photo'), {
    method: 'POST',
    headers: { ...(await authHeaders()) },
    body: form,
    timeout: 25000, // fotos son grandes; 25s antes de abortar y dejar en cola
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'No se pudo subir la foto');
  }
  const path = data.url.startsWith('/') ? data.url : `/${data.url}`;
  const base = API_BASE.replace(/\/$/, '');
  return `${base}${path}`;
}

export async function postTrackingLocation(payload: {
  deviceId: string;
  deviceLabel: string;
  driverId: string;
  routeId: number | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
}): Promise<void> {
  // Reintentos exponenciales (0.5s, 2s, 5s) antes de considerar fallido.
  const delays = [0, 500, 2000, 5000];
  let lastErr: unknown = null;
  for (const d of delays) {
    if (d > 0) await new Promise((r) => setTimeout(r, d));
    try {
      const res = await fetchWithTimeout(apiUrl('/api/v1/tracking/location'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 7000,
      });
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('postTrackingLocation failed');
}

/** Healthcheck al servidor: devuelve latencia (ms) o null si falla. */
export async function pingServer(timeout = 4000): Promise<number | null> {
  const started = Date.now();
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(apiUrl('/api/v1/ping'), { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    return Date.now() - started;
  } catch {
    clearTimeout(tid);
    return null;
  }
}

export async function patchRouteRecorrido(
  routeId: number,
  driverId: string,
  action: 'start' | 'end'
): Promise<void> {
  // Fichar entrada/salida es accion critica del chofer: 1 retry + timeout 8s
  // para que con senial debil falle rapido y muestre error en vez de colgarse.
  const res = await fetchWithRetry(apiUrl(`/api/v1/routes/${routeId}/recorrido`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ driverId, action }),
    timeout: 8000,
  }, 1);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = (data as { error?: string }).error || '';
    // Filtramos los avisos benignos del backend ("ya fue iniciado" / "ya fue terminado").
    // Cualquier otro mensaje SI es un error real y se eleva al chofer.
    const benign = /ya fue (iniciado|terminado|finalizado|comenzado)/i.test(msg);
    if (!benign) {
      throw new Error(msg || 'Error al actualizar recorrido');
    }
  }
}

/** Notifica al servidor que el dispositivo ya no está en ruta: marca sus DeviceLocations como inactivas */
export async function deactivateDevice(deviceId: string): Promise<void> {
  try {
    await fetchWithTimeout(apiUrl('/api/v1/tracking/deactivate-device'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
      timeout: 5000,
    });
  } catch {
    // Si falla (sin red), no bloquear el flujo del chofer
  }
}

// ── Historial de rutas ────────────────────────────────────────────────────────

export async function fetchRouteHistory(driverId: string, days = 30): Promise<Route[]> {
  const q = new URLSearchParams({ driverId, days: String(days), _ts: String(Date.now()) });
  const res = await fetchWithRetry(
    apiUrl(`/api/v1/routes?${q}`),
    { headers: { 'Cache-Control': 'no-cache', ...(await authHeaders()) } }
  );
  if (!res.ok) throw new Error('No se pudo cargar el historial');
  return (await res.json()) as Route[];
}

// ── Reordenamiento de paradas ─────────────────────────────────────────────────

export async function reorderRouteStops(
  routeId: number,
  newOrder: { stopId: number; sequence: number }[],
  justification: string,
  driverName: string
): Promise<void> {
  const res = await fetchWithRetry(apiUrl(`/api/v1/routes/${routeId}/stops/reorder`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ newOrder, justification, driverName }),
    timeout: 8000,
  }, 1);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'No se pudo reordenar las paradas');
  }
}

// ── Push Token ────────────────────────────────────────────────────────────────
export async function registerPushToken(userId: string, token: string): Promise<void> {
  try {
    await fetchWithTimeout(apiUrl(`/api/v1/users/${userId}/push-token`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ token }),
      timeout: 5000,
    });
  } catch (e) {
    console.warn('[push] Error registering token:', e);
  }
}

// ── Vehicle KM ────────────────────────────────────────────────────────────────
export async function updateVehicleKm(plate: string, km: number): Promise<void> {
  try {
    await fetchWithTimeout(apiUrl(`/api/v1/vehicles/${encodeURIComponent(plate)}/km`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ km }),
      timeout: 5000,
    });
  } catch (e) {
    console.warn('[km] Error updating km:', e);
  }
}

// ── Incidents ─────────────────────────────────────────────────────────────────

interface OfflineIncidentAction {
  driverId: string;
  tripId?: number | null;
  type: string;
  description: string;
  photoUrl?: string | null;
  timestamp: string;
}

async function readIncidentQueue(): Promise<OfflineIncidentAction[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.offlineIncidentQueue);
    if (!raw) return [];
    return JSON.parse(raw) || [];
  } catch { return []; }
}

// ─── Cola offline de FOTOS de comprobante ────────────────────────────────────
// Cuando un chofer entrega con foto pero no tiene señal, la foto se guarda acá
// con el stopId. Cuando vuelve la red, flushPhotoQueue() la sube y patchea el
// stop con la URL para que figure en planificación.
type OfflinePhoto = { stopId: number; localUri: string; queuedAt: string };

async function readPhotoQueue(): Promise<OfflinePhoto[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.offlinePhotoQueue);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function writePhotoQueue(q: OfflinePhoto[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.offlinePhotoQueue, JSON.stringify(q.slice(-50)));
}

export async function enqueueOfflinePhoto(stopId: number, localUri: string): Promise<void> {
  const q = await readPhotoQueue();
  q.push({ stopId, localUri, queuedAt: new Date().toISOString() });
  await writePhotoQueue(q);
}

export async function getPendingPhotoCount(): Promise<number> {
  const q = await readPhotoQueue();
  return q.length;
}

let _photoQueueFlushing: Promise<void> | null = null;
export function flushPhotoQueue(): Promise<void> {
  if (_photoQueueFlushing) return _photoQueueFlushing;
  _photoQueueFlushing = (async (): Promise<void> => {
    try {
      const queue = await readPhotoQueue();
      if (!queue.length) return;
      const remaining: OfflinePhoto[] = [];
      for (const p of queue) {
        try {
          const url = await uploadProofPhoto(p.localUri);
          // Patcheamos el stop con la URL (idempotente: si el stop ya estaba COMPLETED,
          // solo le agregamos la foto). Si el patch falla, mantenemos en cola.
          const res = await fetchWithTimeout(apiUrl(`/api/v1/stops/${p.stopId}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify({ proofPhotoUrl: url }),
            timeout: 6000,
          });
          if (!res.ok) remaining.push(p);
        } catch {
          remaining.push(p);
        }
      }
      if (remaining.length === 0) await AsyncStorage.removeItem(STORAGE_KEYS.offlinePhotoQueue);
      else await writePhotoQueue(remaining);
    } finally {
      _photoQueueFlushing = null;
    }
  })();
  return _photoQueueFlushing;
}

// Mismo mutex que flushStopQueue: evita que dos llamadas en paralelo dupliquen incidencias.
let _incidentQueueFlushing: Promise<void> | null = null;
export function flushIncidentQueue(): Promise<void> {
  if (_incidentQueueFlushing) return _incidentQueueFlushing;
  _incidentQueueFlushing = (async (): Promise<void> => {
    try {
      const queue = await readIncidentQueue();
      if (!queue.length) return;
      let sent = 0;
      for (const action of queue) {
        try {
          const res = await fetchWithTimeout(apiUrl('/api/v1/incidents'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify(action),
            timeout: 8000,
          });
          if (!res.ok) break;
          sent++;
        } catch { break; }
      }
      if (sent === queue.length) await AsyncStorage.removeItem(STORAGE_KEYS.offlineIncidentQueue);
      else if (sent > 0) {
        await AsyncStorage.setItem(STORAGE_KEYS.offlineIncidentQueue, JSON.stringify(queue.slice(sent)));
      }
    } finally {
      _incidentQueueFlushing = null;
    }
  })();
  return _incidentQueueFlushing;
}

export async function reportIncident(payload: {
  driverId: string;
  tripId?: number | null;
  type: string;
  description: string;
  photoUrl?: string | null;
}): Promise<Incident | { queued: true }> {
  try {
    const res = await fetchWithTimeout(apiUrl('/api/v1/incidents'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(payload),
      timeout: 8000,
    });
    if (!res.ok) throw new Error('Server error');
    flushIncidentQueue().catch(() => {});
    return (await res.json()) as Incident;
  } catch {
    // Queue offline
    const queue = await readIncidentQueue();
    queue.push({ ...payload, timestamp: new Date().toISOString() });
    await AsyncStorage.setItem(STORAGE_KEYS.offlineIncidentQueue, JSON.stringify(queue));
    return { queued: true };
  }
}
