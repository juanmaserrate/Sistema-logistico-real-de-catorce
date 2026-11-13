import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as Location from 'expo-location';
import { STORAGE_KEYS } from './config';

// ─── Modo lotes: TODOS los puntos, con la hora del GPS ──────────────────────
// Antes, de cada lote que entrega el sistema se mandaba solo el ultimo punto y
// el resto se perdia; sin señal se guardaban hasta 500 (unos 40 minutos) y se
// mandaban de a uno. El recorrido salia con huecos y zigzags.
// Ahora se mandan todos, de a 200 por pedido, con la hora en que los tomo el
// GPS. Primero lo mas nuevo (asi la Torre ve al camion enseguida) y despues lo
// atrasado. Se prende desde el servidor (gps_config), sin publicar la app.

/** Un punto en formato corto: la cola puede tener miles. */
export interface PuntoLote {
  lat: number;
  lng: number;
  acc: number | null;
  spd: number | null;
  hdg: number | null;
  /** Hora del GPS, ISO */
  t: string;
  /** Ruta activa cuando se tomo */
  r: number | null;
}

/** ~8 h de puntos cada 5 s, ~600 KB: entra holgado en el almacenamiento del celular. */
export const MAX_LOTE_QUEUE = 6000;
export const PUNTOS_POR_PEDIDO = 200;

export async function readLoteQueue(): Promise<PuntoLote[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.gpsLoteQueue);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLoteQueue(queue: PuntoLote[]): Promise<void> {
  if (!queue.length) {
    await AsyncStorage.removeItem(STORAGE_KEYS.gpsLoteQueue);
    return;
  }
  const trimmed = queue.length > MAX_LOTE_QUEUE ? queue.slice(queue.length - MAX_LOTE_QUEUE) : queue;
  await AsyncStorage.setItem(STORAGE_KEYS.gpsLoteQueue, JSON.stringify(trimmed));
}

/** Manda un pedaso de puntos (todos de la misma ruta). 'ok' | 'descartar' | 'reintentar' */
async function sendLote(
  apiBase: string,
  quien: { deviceId: string; deviceLabel: string; driverId: string },
  routeId: number | null,
  puntos: PuntoLote[],
): Promise<'ok' | 'descartar' | 'reintentar'> {
  const url = `${apiBase.replace(/\/$/, '')}/api/v1/tracking/lote`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...quien,
        routeId,
        points: puntos.map((p) => ({ lat: p.lat, lng: p.lng, acc: p.acc, spd: p.spd, hdg: p.hdg, t: p.t })),
      }),
      signal: controller.signal,
    });
    if (res.ok) return 'ok';
    // Un 400 no se arregla reintentando: se descarta ese pedaso y se sigue.
    if (res.status === 400 || res.status === 413) return 'descartar';
    return 'reintentar';
  } catch {
    return 'reintentar';
  } finally {
    clearTimeout(tid);
  }
}

// Sin señal, cada envio espera 10 s antes de rendirse; con un punto cada 2 s se
// apilarian. Despues de un fallo, por 15 s los puntos solo se guardan.
let _ultimoFallo = 0;
// Nunca dos envios a la vez: los dos leerian la misma cola y el segundo pisaria
// lo que guardo el primero.
let _cadena: Promise<unknown> = Promise.resolve();

export function enviarEnLotes(
  apiBase: string,
  quien: { deviceId: string; deviceLabel: string; driverId: string },
  nuevos: PuntoLote[],
): Promise<boolean> {
  const p = _cadena.then(() => enviarEnLotesAhora(apiBase, quien, nuevos));
  _cadena = p.catch(() => {});
  return p;
}

/** Manda la cola + los puntos nuevos. Devuelve true si hubo red. */
async function enviarEnLotesAhora(
  apiBase: string,
  quien: { deviceId: string; deviceLabel: string; driverId: string },
  nuevos: PuntoLote[],
): Promise<boolean> {
  const pendientes = await readLoteQueue();
  // Lo de mas de un dia ya no sirve (el servidor no lo podria ubicar en hora)
  const limite = Date.now() - 24 * 3600 * 1000;
  let restantes = pendientes.concat(nuevos).filter((x) => Date.parse(x.t) > limite);
  if (Date.now() - _ultimoFallo < 15000) {
    await writeLoteQueue(restantes);
    return false;
  }
  let huboRed = false;
  while (restantes.length) {
    // Del final (lo mas nuevo) hacia atras; un pedido por ruta
    const ultimo = restantes[restantes.length - 1];
    let desde = restantes.length - 1;
    while (desde > 0 && restantes.length - desde < PUNTOS_POR_PEDIDO && restantes[desde - 1].r === ultimo.r) desde--;
    const pedaso = restantes.slice(desde);
    const r = await sendLote(apiBase, quien, ultimo.r, pedaso);
    if (r === 'reintentar') { _ultimoFallo = Date.now(); break; }
    huboRed = true;
    restantes = restantes.slice(0, desde);
  }
  // Solo se escribe si algo cambio respecto de lo que habia guardado
  if (restantes.length !== pendientes.length || nuevos.length) {
    if (!(restantes.length === 0 && pendientes.length === 0)) await writeLoteQueue(restantes);
  }
  return huboRed;
}

export function aPuntoLote(loc: Location.LocationObject, routeId: number | null): PuntoLote {
  let t: string;
  try {
    const ts = Number(loc.timestamp);
    const valid = Number.isFinite(ts) && ts > 0 && ts < 7258118400000;
    t = new Date(valid ? ts : Date.now()).toISOString();
  } catch {
    t = new Date().toISOString();
  }
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    acc: loc.coords.accuracy ?? null,
    spd: loc.coords.speed ?? null,
    hdg: loc.coords.heading ?? null,
    t,
    r: routeId,
  };
}

/** Solo para las pruebas: vuelve a empezar como recien abierta la app. */
export function _reiniciarParaPruebas(): void {
  _ultimoFallo = 0;
  _cadena = Promise.resolve();
}
