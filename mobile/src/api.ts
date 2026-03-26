import { API_BASE, assertApiConfigured } from './config';
import type { Route, RouteGeometry, SessionUser } from './types';

function apiUrl(path: string): string {
  assertApiConfigured();
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const res = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Error de login');
  const u = (data as { user?: SessionUser }).user;
  if (!u) throw new Error('Respuesta inválida');
  return u;
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
    headers: { 'Cache-Control': 'no-cache' },
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
  const res = await fetch(apiUrl(`/api/v1/stops/${stopId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'No se pudo actualizar la parada');
  }
  return data;
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
