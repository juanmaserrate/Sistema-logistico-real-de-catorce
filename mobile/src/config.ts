import { Platform } from 'react-native';

/** Copiar env.example → .env con EXPO_PUBLIC_API_URL y GOOGLE_MAPS_ANDROID_KEY (para el mapa). */
function devDefaultBase(): string {
  if (Platform.OS === 'android') return 'http://10.0.2.2:3002';
  return 'http://127.0.0.1:3002';
}

const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '') ?? '';

export const API_BASE = fromEnv || (__DEV__ ? devDefaultBase() : '');

export function assertApiConfigured(): void {
  if (!API_BASE) {
    throw new Error(
      'Falta EXPO_PUBLIC_API_URL en .env (URL del servidor, ej. http://192.168.0.10:3002)'
    );
  }
}

export const STORAGE_KEYS = {
  apiBase: 'r14_api_base',
  driverId: 'driverId',
  driverName: 'driverName',
  driverRole: 'driverRole',
  tenantId: 'tenantId',
  deviceId: 'tracking_device_id',
  activeRouteId: 'r14_active_route_id',
  offlineLocationQueue: 'r14_offline_location_queue',
  offlineStopQueue: 'r14_offline_stop_queue',     // Cola offline de paradas pendientes
  offlineIncidentQueue: 'r14_offline_incident_queue', // Cola offline de incidencias pendientes
  offlinePhotoQueue: 'r14_offline_photo_queue',   // Cola de fotos de comprobante pendientes (sin red al subir)
  offlinePunchQueue: 'r14_offline_punch_queue',   // Cola de fichajes (entrada/salida) hechos sin señal
  offlineRetryQueue: 'r14_offline_retry_queue',   // Cola de paradas pospuestas ("vuelvo más tarde") sin señal
  offlineTramoQueue: 'r14_offline_tramo_queue',   // Cola de rutas cerradas y viajes finalizados sin señal
  routesCache: 'r14_routes_today_cache',          // Cache de las rutas del día (fallback offline)
  gpsConfig: 'r14_gps_config',                    // Como mandar el GPS: { lotes, intervaloMs, distanciaM } (lo dice el servidor)
  gpsLoteQueue: 'r14_gps_lote_queue',             // Puntos GPS sin mandar (modo lotes), en formato compacto
  gpsOpcionesActivas: 'r14_gps_opciones_activas', // Intervalo con el que esta corriendo el GPS ahora
  bateriaPedida: 'r14_bateria_pedida',            // Cuando se le pidio al chofer sacar la app del ahorro de bateria
  gpsSalidaFichada: 'r14_gps_salida_fichada',     // Dia (AAAA-MM-DD) en que el chofer ficho salida: ese dia el GPS no se prende solo
  gpsAutoIniciado: 'r14_gps_auto_iniciado',       // '1' = el GPS lo prendio la app sola al abrirse (no el chofer con «Fichar entrada»)
} as const;
