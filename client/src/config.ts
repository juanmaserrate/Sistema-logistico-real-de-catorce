/**
 * Base URL de la API. En desarrollo queda '' (mismo origen).
 * Para la app móvil (Capacitor): buildear con VITE_API_URL=https://tu-servidor.com
 */
export const API_BASE = import.meta.env.VITE_API_URL || '';
