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
        // La hora del reloj del celular al mandar: el servidor la compara con
        // la suya y corrige los puntos si el reloj esta desfasado
        enviadoEn: new Date().toISOString(),
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

// ── La cola vive en memoria y se guarda cada 10 s ───────────────────────────
// 20-nov-2026: la app del R19 dejo de responder 3 horas. Antes, CADA punto del
// GPS (uno por segundo ese dia) leia la cola entera del celular (hasta 6.000
// puntos), la volvia a escribir y encadenaba otro envio atras del anterior.
// Con mala señal cada envio tarda hasta 10 s, asi que se apilaban cientos de
// envios esperando y el celular no daba abasto. Ahora:
//   - la cola se lee del celular UNA vez y se mantiene en memoria;
//   - se guarda como mucho cada 10 s (y siempre al terminar un envio);
//   - hay UN solo envio a la vez: si llega un punto mientras se manda, se suma
//     a la cola y el envio en curso lo lleva al terminar. Nada se apila.

/** Despues de un fallo, por 15 s los puntos solo se guardan (sin señal cada
 *  intento espera 10 s; reintentar con cada punto apilaria esperas). */
const PAUSA_TRAS_FALLO_MS = 15000;
/** Cada cuanto se escribe la cola en el celular, como mucho. */
const GUARDAR_CADA_MS = 10000;

let _cola: PuntoLote[] | null = null;      // espejo en memoria de lo guardado
let _guardadaVacia = true;                  // lo que hay en el celular ahora
let _cambios = false;                       // la memoria difiere de lo guardado
let _ultimaEscritura = 0;
let _ultimoFallo = 0;
let _enviando = false;

let _cargando: Promise<PuntoLote[]> | null = null;

/** La cola en memoria. Se lee del celular una sola vez: si llegan dos puntos
 *  juntos al abrir la app, los dos esperan la MISMA lectura (si no, cada uno
 *  tendria su copia y se perderian puntos). */
async function colaEnMemoria(): Promise<PuntoLote[]> {
  if (_cola) return _cola;
  if (!_cargando) {
    _cargando = readLoteQueue().then((c) => {
      _cola = c;
      _guardadaVacia = c.length === 0;
      _cambios = false;
      _cargando = null;
      return c;
    });
  }
  return _cargando;
}

/** Lo de mas de un dia no sirve (el servidor no lo podria ubicar en hora) y
 *  la cola no pasa del tope: se van los mas viejos. */
function podar(c: PuntoLote[]): void {
  const limite = Date.now() - 24 * 3600 * 1000;
  let i = 0;
  while (i < c.length && !(Date.parse(c[i].t) > limite)) i++;
  if (c.length - i > MAX_LOTE_QUEUE) i = c.length - MAX_LOTE_QUEUE;
  if (i > 0) { c.splice(0, i); _cambios = true; }
}

async function guardar(ya = false): Promise<void> {
  const c = _cola;
  if (!c || !_cambios) return;
  if (!ya && Date.now() - _ultimaEscritura < GUARDAR_CADA_MS) return;
  _ultimaEscritura = Date.now();
  _cambios = false;
  if (!c.length) {
    if (!_guardadaVacia) { await writeLoteQueue([]); _guardadaVacia = true; }
    return;
  }
  await writeLoteQueue(c);
  _guardadaVacia = false;
}

/** Suma los puntos nuevos y, si no hay otro envio en curso, manda la cola.
 *  Devuelve true si hubo red. */
export async function enviarEnLotes(
  apiBase: string,
  quien: { deviceId: string; deviceLabel: string; driverId: string },
  nuevos: PuntoLote[],
): Promise<boolean> {
  const c = await colaEnMemoria();
  if (nuevos.length) { c.push(...nuevos); _cambios = true; }
  // Con un envio en curso no se poda: correria las posiciones que esta mandando
  if (_enviando) { await guardar(); return false; }
  podar(c);
  if (Date.now() - _ultimoFallo < PAUSA_TRAS_FALLO_MS) { await guardar(); return false; }

  _enviando = true;
  let huboRed = false;
  try {
    while (c.length) {
      // Del final (lo mas nuevo) hacia atras; un pedido por ruta. Lo que llega
      // mientras se manda queda al final y sale en la vuelta siguiente.
      const ultimo = c[c.length - 1];
      let desde = c.length - 1;
      while (desde > 0 && c.length - desde < PUNTOS_POR_PEDIDO && c[desde - 1].r === ultimo.r) desde--;
      const largo = c.length - desde;
      const r = await sendLote(apiBase, quien, ultimo.r, c.slice(desde));
      if (r === 'reintentar') { _ultimoFallo = Date.now(); break; }
      huboRed = true;
      c.splice(desde, largo);
      _cambios = true;
    }
  } finally {
    _enviando = false;
    podar(c);
    await guardar(true);
  }
  return huboRed;
}

/** Cuantos puntos esperan para salir (memoria incluida). */
export async function puntosEnCola(): Promise<number> {
  return (await colaEnMemoria()).length;
}

/** Para «Destrabar»: corta la espera tras un fallo, olvida un envio colgado y
 *  achica la cola a lo ultimo (`maximo` puntos, lo mas nuevo). Lo que queda se
 *  guarda en el celular en el momento. */
export async function soltarEnvios(maximo = 1500): Promise<{ antes: number; despues: number }> {
  const c = await colaEnMemoria();
  const antes = c.length;
  if (c.length > maximo) { c.splice(0, c.length - maximo); _cambios = true; }
  _ultimoFallo = 0;
  _enviando = false;
  await guardar(true);
  return { antes, despues: c.length };
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
  _enviando = false;
  _cola = null;
  _cargando = null;
  _cambios = false;
  _ultimaEscritura = 0;
}
