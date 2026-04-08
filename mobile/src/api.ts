import { API_BASE, assertApiConfigured, STORAGE_KEYS } from './config';
import type { Route, RouteGeometry, SessionUser, Incident } from './types';
import AsyncStorage from '@react-native-async-storage/async-storage';

function apiUrl(path: string): string {
  assertApiConfigured();
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
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
  const res = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
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
  const q = new URLSearchParams({
    driverId,
    date: localYmd(new Date()),
    _ts: String(Date.now()),
  });
  const res = await fetch(apiUrl(`/api/v1/routes?${q}`), {
    headers: { 'Cache-Control': 'no-cache', ...(await authHeaders()) },
  });
  if (!res.ok) throw new Error('No se pudieron cargar las rutas');
  return (await res.json()) as Route[];
}

export async function fetchRouteGeometry(routeId: number): Promise<RouteGeometry | null> {
  const q = new URLSearchParams({ _ts: String(Date.now()) });
  const res = await fetch(apiUrl(`/api/v1/routes/${routeId}/geometry?${q}`), {
    headers: { 'Cache-Control': 'no-cache' },
  });
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
  const res = await fetch(apiUrl(`/api/v1/routes/${routeId}/navigation-to-next?${q}`), {
    headers: { 'Cache-Control': 'no-cache' },
  });
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

export async function flushStopQueue(): Promise<number> {
  const queue = await readStopQueue();
  if (!queue.length) return 0;
  let sent = 0;
  for (const action of queue) {
    try {
      const res = await fetch(apiUrl(`/api/v1/stops/${action.stopId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.body),
      });
      if (!res.ok) break;
      sent++;
    } catch { break; }
  }
  if (sent === queue.length) await AsyncStorage.removeItem(STORAGE_KEYS.offlineStopQueue);
  else if (sent > 0) await writeStopQueue(queue.slice(sent));
  return sent;
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
  }
): Promise<unknown> {
  try {
    const res = await fetch(apiUrl(`/api/v1/stops/${stopId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || 'No se pudo actualizar la parada');
    }
    // Flush any pending offline actions on success
    flushStopQueue().catch(() => {});
    return data;
  } catch (e: any) {
    // Network error → queue for later
    const isNetworkError = e?.message?.includes('Network') || e?.message?.includes('fetch') || e?.message?.includes('network');
    if (isNetworkError || !navigator.onLine) {
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

  const res = await fetch(apiUrl('/api/upload-photo'), {
    method: 'POST',
    headers: { ...(await authHeaders()) },
    body: form,
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
  await fetch(apiUrl('/api/v1/tracking/location'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function patchRouteRecorrido(
  routeId: number,
  driverId: string,
  action: 'start' | 'end'
): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/routes/${routeId}/recorrido`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ driverId, action }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = (data as { error?: string }).error || '';
    if (!msg.includes('ya fue') && !msg.includes('ya fue')) {
      throw new Error(msg || 'Error al actualizar recorrido');
    }
  }
}

// ── Push Token ────────────────────────────────────────────────────────────────
export async function registerPushToken(userId: string, token: string): Promise<void> {
  try {
    await fetch(apiUrl(`/api/v1/users/${userId}/push-token`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ token }),
    });
  } catch (e) {
    console.warn('[push] Error registering token:', e);
  }
}

// ── Vehicle KM ────────────────────────────────────────────────────────────────
export async function updateVehicleKm(plate: string, km: number): Promise<void> {
  try {
    await fetch(apiUrl(`/api/v1/vehicles/${encodeURIComponent(plate)}/km`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ km }),
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

export async function flushIncidentQueue(): Promise<void> {
  const queue = await readIncidentQueue();
  if (!queue.length) return;
  let sent = 0;
  for (const action of queue) {
    try {
      const res = await fetch(apiUrl('/api/v1/incidents'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(action),
      });
      if (!res.ok) break;
      sent++;
    } catch { break; }
  }
  if (sent === queue.length) await AsyncStorage.removeItem(STORAGE_KEYS.offlineIncidentQueue);
  else if (sent > 0) {
    await AsyncStorage.setItem(STORAGE_KEYS.offlineIncidentQueue, JSON.stringify(queue.slice(sent)));
  }
}

export async function reportIncident(payload: {
  driverId: string;
  tripId?: number | null;
  type: string;
  description: string;
  photoUrl?: string | null;
}): Promise<Incident | { queued: true }> {
  try {
    const res = await fetch(apiUrl('/api/v1/incidents'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(payload),
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
