import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './config';

export const BACKGROUND_LOCATION_TASK = 'r14-background-location';

/** Limite maximo de ubicaciones en la cola offline. */
const MAX_QUEUE_SIZE = 500;

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Payload de una ubicacion GPS lista para enviar al servidor. */
interface LocationPayload {
  deviceId: string;
  deviceLabel: string;
  driverId: string;
  routeId: number | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  /** Marca de tiempo ISO-8601 del momento de captura en el dispositivo. */
  capturedAt: string;
}

// ─── Cola offline en AsyncStorage ────────────────────────────────────────────

/**
 * Lee la cola de ubicaciones pendientes desde AsyncStorage.
 * Retorna un arreglo vacio si no hay datos o el JSON es invalido.
 */
async function readQueue(): Promise<LocationPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.offlineLocationQueue);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persiste la cola de ubicaciones en AsyncStorage.
 * Si el arreglo supera MAX_QUEUE_SIZE, descarta las mas antiguas (inicio del arreglo).
 */
async function writeQueue(queue: LocationPayload[]): Promise<void> {
  const trimmed = queue.length > MAX_QUEUE_SIZE
    ? queue.slice(queue.length - MAX_QUEUE_SIZE)
    : queue;
  await AsyncStorage.setItem(
    STORAGE_KEYS.offlineLocationQueue,
    JSON.stringify(trimmed),
  );
}

/**
 * Agrega una ubicacion a la cola offline.
 */
async function enqueue(payload: LocationPayload): Promise<void> {
  const queue = await readQueue();
  queue.push(payload);
  await writeQueue(queue);
}

// ─── Envio al servidor ───────────────────────────────────────────────────────

/**
 * Envia un unico payload de ubicacion al endpoint del servidor.
 * Lanza un error si la peticion falla (sin red, timeout, HTTP >= 400, etc.).
 */
async function sendLocation(apiBase: string, payload: LocationPayload): Promise<void> {
  const url = `${apiBase.replace(/\/$/, '')}/api/v1/tracking/location`;
  // FIX CRITICO: este fetch corria SIN timeout. Con 4G debil (senial con signo
  // de exclamacion) el socket queda half-open y el fetch cuelga PARA SIEMPRE,
  // bloqueando la tarea de background y matando el tracking del chofer.
  // AbortController con 7s: si no respondio, abortamos, el payload va a la
  // cola offline y el proximo ping reintenta.
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Intenta enviar todas las ubicaciones acumuladas en la cola offline.
 * Envia una por una en orden cronologico; al primer fallo se detiene y
 * guarda las restantes de vuelta en la cola (la red sigue sin funcionar).
 */
async function flushQueue(apiBase: string): Promise<void> {
  const queue = await readQueue();
  if (queue.length === 0) return;

  let sent = 0;
  for (const payload of queue) {
    try {
      await sendLocation(apiBase, payload);
      sent++;
    } catch {
      // La red volvio a fallar; dejamos el resto en la cola.
      break;
    }
  }

  if (sent === queue.length) {
    // Se enviaron todas; limpiamos la cola por completo.
    await AsyncStorage.removeItem(STORAGE_KEYS.offlineLocationQueue);
  } else if (sent > 0) {
    // Guardamos solo las que no se pudieron enviar.
    await writeQueue(queue.slice(sent));
  }
  // Si sent === 0 no tocamos la cola (nada cambio).
}

// ─── Sincronizacion de entregas en segundo plano ─────────────────────────────
// Las colas de paradas/fichajes/incidencias solo se vaciaban desde TrackScreen,
// o sea con la app abierta. Un chofer que marca todo sin señal, cierra la app
// al llegar y no la vuelve a abrir dejaba TODO trabado — el operador no veia
// las entregas ni el viaje se cerraba.
// Ahora aprovechamos esta tarea, que ya corre en segundo plano mientras el
// chofer tiene el seguimiento activo: si hay red (lo sabemos porque el ping de
// GPS salio bien), vaciamos tambien las colas de datos.
// Las FOTOS quedan afuera a proposito: pesan y tardan hasta 25s cada una, y el
// SO puede matar la tarea a la mitad. Se siguen subiendo con la app abierta.
const DATA_FLUSH_EVERY_MS = 60_000; // no en cada ping de 5s
let _lastDataFlush = 0;

async function flushPendingDataQueues(): Promise<void> {
  if (Date.now() - _lastDataFlush < DATA_FLUSH_EVERY_MS) return;
  _lastDataFlush = Date.now();
  try {
    // Import diferido: evita cargar api.ts (y sus dependencias) en cada
    // arranque headless de la tarea si no hay nada pendiente que mandar.
    const api = await import('./api');
    const pendientes =
      await api.getPendingStopCount() +
      await api.getPendingPunchCount() +
      await api.getPendingRetryCount();
    if (pendientes === 0) return;
    // Fichaje primero: el operador tiene que ver el viaje en curso antes que
    // las entregas sueltas. Despues los pospuestos (reordenan el recorrido) y
    // recien ahi las marcas de entrega.
    await api.flushPunchQueue();
    await api.flushRetryQueue();
    await api.flushStopQueue();
    await api.flushIncidentQueue();
    console.log('[bg-sync] colas de datos vaciadas en segundo plano');
  } catch {
    // Sin red o error: se reintenta en el proximo ciclo.
  }
}

// ─── Tarea en segundo plano ──────────────────────────────────────────────────

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;

  try {
    const bundle = data as { locations?: Location.LocationObject[] };
    const locations = bundle?.locations;
    if (!locations?.length) return;

    // Tomamos la ubicacion mas reciente del lote.
    const loc = locations[locations.length - 1];

    // Leemos configuracion y datos del chofer desde AsyncStorage.
    const entries = await AsyncStorage.multiGet([
      STORAGE_KEYS.apiBase,
      STORAGE_KEYS.driverId,
      STORAGE_KEYS.driverName,
      STORAGE_KEYS.deviceId,
      STORAGE_KEYS.activeRouteId,
    ]);
    const map = Object.fromEntries(entries) as Record<string, string | null>;

    const apiBase = map[STORAGE_KEYS.apiBase];
    const driverId = map[STORAGE_KEYS.driverId];
    const deviceId = map[STORAGE_KEYS.deviceId];

    // Sin configuracion basica no podemos hacer nada.
    if (!apiBase?.trim() || !driverId || !deviceId) return;

    const routeRaw = map[STORAGE_KEYS.activeRouteId];
    const routeId =
      routeRaw != null && routeRaw !== '' && Number.isFinite(Number(routeRaw))
        ? Number(routeRaw)
        : null;

    // Marca de tiempo del dispositivo. Algunos Android viejos / ROMs raras devuelven
    // valores fuera de rango (NaN, 0, o futuros lejanos) que rompen Date.toISOString().
    // Validamos: si no es un timestamp razonable (1970-2200), usamos Date.now() del celu.
    let capturedAt: string;
    try {
      const ts = Number(loc.timestamp);
      const valid = Number.isFinite(ts) && ts > 0 && ts < 7258118400000; // < año 2200
      capturedAt = new Date(valid ? ts : Date.now()).toISOString();
    } catch {
      capturedAt = new Date().toISOString();
    }

    const payload: LocationPayload = {
      deviceId,
      deviceLabel: map[STORAGE_KEYS.driverName] || 'Chofer',
      driverId,
      routeId,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? null,
      speed: loc.coords.speed ?? null,
      heading: loc.coords.heading ?? null,
      capturedAt,
    };

    // 1. Intentamos vaciar la cola offline primero (ubicaciones previas pendientes).
    await flushQueue(apiBase);

    // 2. Enviamos la ubicacion actual.
    let hayRed = false;
    try {
      await sendLocation(apiBase, payload);
      hayRed = true;
    } catch {
      // Sin red: guardamos en la cola offline para reintento posterior.
      await enqueue(payload);
    }

    // 3. Si el ping salio bien, hay red de verdad: aprovechamos para mandar
    //    las entregas/fichajes pendientes aunque la app este cerrada.
    if (hayRed) await flushPendingDataQueues();
  } catch {
    // Error inesperado general; no hacemos nada para no bloquear la tarea.
  }
});
