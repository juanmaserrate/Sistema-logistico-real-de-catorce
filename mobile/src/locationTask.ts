import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './config';

export const BACKGROUND_LOCATION_TASK = 'r14-background-location';

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  try {
    const bundle = data as { locations?: Location.LocationObject[] };
    const locations = bundle?.locations;
    if (!locations?.length) return;
    const loc = locations[locations.length - 1];
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
    if (!apiBase?.trim() || !driverId || !deviceId) return;

    const routeRaw = map[STORAGE_KEYS.activeRouteId];
    const routeId =
      routeRaw != null && routeRaw !== '' && Number.isFinite(Number(routeRaw)) ? Number(routeRaw) : null;

    await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/tracking/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        deviceLabel: map[STORAGE_KEYS.driverName] || 'Chofer',
        driverId,
        routeId,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? null,
        speed: loc.coords.speed ?? null,
        heading: loc.coords.heading ?? null,
      }),
    });
  } catch {
    /* sin red en túnel, etc. */
  }
});
