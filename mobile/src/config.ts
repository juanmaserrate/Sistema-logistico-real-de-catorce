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
} as const;
