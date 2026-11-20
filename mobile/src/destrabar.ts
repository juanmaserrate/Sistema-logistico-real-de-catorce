import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKGROUND_LOCATION_TASK } from './locationTask';
import { soltarEnvios } from './gpsLote';
import { STORAGE_KEYS } from './config';

/* ============================================================================
 * DESTRABAR LA APP
 * ============================================================================
 * 20-nov-2026: la app del R19 dejo de responder y el chofer no pudo marcar.
 * Esto suelta lo que puede quedar colgado SIN perder nada que el chofer marco:
 *   - apaga el GPS de fondo (la pantalla lo vuelve a prender enseguida, con la
 *     configuracion de ahora);
 *   - corta la espera de envios del GPS y achica su cola a lo ultimo;
 *   - NO toca las entregas, fichajes, fotos ni incidencias sin mandar: esas se
 *     reintentan en el momento.
 * Lo pide el chofer (boton 🔧) o la oficina (Usuarios > «Destrabar app»).
 * ========================================================================= */

/** La ultima orden de la oficina ya aplicada en este celular. */
export const CLAVE_DESTRABAR_APLICADO = 'r14_destrabar_aplicado';

/** Una orden de la oficina mas vieja que esto ya no se aplica (por ejemplo, un
 *  celular que se prende al dia siguiente). */
export const VIGENCIA_ORDEN_MS = 30 * 60 * 1000;

export interface Soltado {
  /** El GPS de fondo estaba prendido (hay que volver a prenderlo). */
  gpsEstabaPrendido: boolean;
  /** Puntos de GPS esperando antes y despues de achicar la cola. */
  antes: number;
  despues: number;
}

export async function soltarTodo(): Promise<Soltado> {
  let gpsEstabaPrendido = false;
  try {
    gpsEstabaPrendido = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch { /* sin permiso o sin tarea: no estaba prendido */ }
  if (gpsEstabaPrendido) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
  }
  // Asi el GPS arranca de nuevo con la configuracion del servidor de ahora
  await AsyncStorage.removeItem(STORAGE_KEYS.gpsOpcionesActivas).catch(() => {});
  const r = await soltarEnvios(1500);
  return { gpsEstabaPrendido, ...r };
}

/** ¿Hay una orden de la oficina sin aplicar? Devuelve la marca a guardar, o
 *  null. `orden` es la hora (ISO) en que la oficina la mando. */
export async function ordenPendiente(orden: string | null | undefined): Promise<string | null> {
  if (!orden) return null;
  const ms = Date.parse(orden);
  if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > VIGENCIA_ORDEN_MS) return null;
  const ya = await AsyncStorage.getItem(CLAVE_DESTRABAR_APLICADO).catch(() => null);
  return ya === orden ? null : orden;
}

export async function marcarOrdenAplicada(orden: string): Promise<void> {
  await AsyncStorage.setItem(CLAVE_DESTRABAR_APLICADO, orden).catch(() => {});
}
