/**
 * Que hacer con el GPS al abrir la app (o volver a ella), sin que el chofer
 * toque nada. Solo decide; prender, apagar y pedir permisos lo hace la
 * pantalla. Aparte para poder probarlo sin celular.
 */
export interface SituacionAlAbrir {
  /** El servidor lo tiene prendido para este chofer (gps_config.autoInicio) */
  autoInicio: boolean;
  /** Hay algun viaje de hoy sin terminar */
  hayViajeAbierto: boolean;
  /** El GPS de fondo ya esta andando */
  corriendo: boolean;
  /** Lo que esta andando lo prendio la app sola (no «Fichar entrada») */
  prendidoSolo: boolean;
  /** Hoy ya ficho salida */
  salidaFichadaHoy: boolean;
}

export type QueHacer = 'prender' | 'apagar' | 'nada';

export function decidirGpsAlAbrir(s: SituacionAlAbrir): QueHacer {
  // Sin viajes abiertos: lo que prendio la app sola se apaga. Lo que prendio
  // el chofer no se toca (lo apaga el con «Fichar salida», como siempre).
  if (!s.hayViajeAbierto) return s.corriendo && s.prendidoSolo ? 'apagar' : 'nada';
  if (!s.autoInicio || s.corriendo) return 'nada';
  if (s.salidaFichadaHoy) return 'nada';
  return 'prender';
}
