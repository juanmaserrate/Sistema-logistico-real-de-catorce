import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionUser } from './types';
import { API_BASE, STORAGE_KEYS } from './config';

export async function persistSession(user: SessionUser): Promise<void> {
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.apiBase, API_BASE],
    [STORAGE_KEYS.driverId, user.id],
    [STORAGE_KEYS.driverName, user.fullName],
    [STORAGE_KEYS.driverRole, user.role],
    [STORAGE_KEYS.tenantId, user.tenantId],
  ]);
}

export async function loadSession(): Promise<SessionUser | null> {
  const [[, id], [, name], [, role], [, tenantId]] = await AsyncStorage.multiGet([
    STORAGE_KEYS.driverId,
    STORAGE_KEYS.driverName,
    STORAGE_KEYS.driverRole,
    STORAGE_KEYS.tenantId,
  ]);
  if (!id || !name || !role || !tenantId) return null;
  return { id, fullName: name, role, tenantId };
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.multiRemove([
    STORAGE_KEYS.apiBase,
    STORAGE_KEYS.driverId,
    STORAGE_KEYS.driverName,
    STORAGE_KEYS.driverRole,
    STORAGE_KEYS.tenantId,
    STORAGE_KEYS.activeRouteId,
  ]);
}

export async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(STORAGE_KEYS.deviceId);
  if (!id) {
    id = `r14_${Math.random().toString(36).slice(2, 12)}`;
    await AsyncStorage.setItem(STORAGE_KEYS.deviceId, id);
  }
  return id;
}

export async function setActiveRouteId(routeId: number | null): Promise<void> {
  if (routeId == null) await AsyncStorage.removeItem(STORAGE_KEYS.activeRouteId);
  else await AsyncStorage.setItem(STORAGE_KEYS.activeRouteId, String(routeId));
}

export async function getActiveRouteId(): Promise<number | null> {
  const v = await AsyncStorage.getItem(STORAGE_KEYS.activeRouteId);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
