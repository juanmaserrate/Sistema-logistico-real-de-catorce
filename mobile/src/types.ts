export interface SessionUser {
  id: string;
  fullName: string;
  role: string;
  tenantId: string;
}

export interface Client {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
  barrio?: string | null;
  zone?: string | null;
  requiresProofPhoto?: boolean;
}

export interface Stop {
  id: number;
  sequence: number;
  /** Secuencia original del planificador antes de que el chofer reordene */
  plannedSequence?: number | null;
  status: string;
  actualArrival: string | null;
  actualDeparture: string | null;
  observations?: string | null;
  proofPhotoUrl?: string | null;
  deliveryWithoutIssues?: boolean | null;
  /** Cajones dejados / recuperados en la parada: el TOTAL de los tres
   *  proveedores. Lo calcula el servidor (null = no se cargó). */
  cratesDelivered?: number | null;
  cratesRecovered?: number | null;
  /** Cajones separados por tipo de envase. Es lo que carga el chofer. */
  cratesDeliveredPeco?: number | null;
  cratesRecoveredPeco?: number | null;
  cratesDeliveredPlasticos?: number | null;
  cratesRecoveredPlasticos?: number | null;
  cratesDeliveredBurzaco?: number | null;
  cratesRecoveredBurzaco?: number | null;
  cratesDeliveredJaula?: number | null;
  cratesRecoveredJaula?: number | null;
  cratesDeliveredDeposito?: number | null;
  cratesRecoveredDeposito?: number | null;
  reasonCode?: string | null;
  /** true = vuelta al depósito (Real de Catorce). Al marcarla se cierra el viaje. */
  isReturnToBase?: boolean;
  /** Veces que pasó y no pudo entregar, eligiendo volver más tarde (status RETRY). */
  retryCount?: number;
  /** Motivo del último intento fallido (derivado de retryLog en el server). */
  retryReason?: string | null;
  /** De qué ruta del viaje es esta parada ("R8", "R12"). Un viaje puede hacer
   *  varias rutas y después volver al depósito. null = viaje de una sola ruta. */
  ruta?: string | null;
  client: Client;
}

/** Las horas de un tramo del viaje: una ruta, o la vuelta al depósito. */
export interface TripLeg {
  id: string;
  orden: number;
  ruta: string;
  inicio?: string | null;
  fin?: string | null;
  motivo?: string | null;
}

export interface Route {
  id: number;
  date: string;
  status: string;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  stops: Stop[];
  vehicle?: { plate?: string } | null;
  driver?: { id: string; username: string; fullName: string } | null;
  trip?: {
    id?: number;
    businessUnit?: string | null;
    reparto?: string | null;
    zone?: string | null;
    status?: string | null;
    completedAt?: string | null;
    /** Las rutas del viaje, en orden: ["R8","R12"]. */
    rutas?: string[] | null;
    /** Las que ya se cerraron, con sus horas. */
    tramos?: TripLeg[] | null;
  } | null;
  /** Justificación del chofer al reordenar paradas */
  reorderReason?: string | null;
  reorderedAt?: string | null;
  reorderedByDriver?: string | null;
}

export interface GeometryPoint {
  lat: number;
  lng: number;
}

export interface GeometryStop {
  sequence: number;
  stopId?: number;
  name: string;
  lat: number;
  lng: number;
}

export interface RouteGeometry {
  routeId: number;
  points: GeometryPoint[];
  stops: GeometryStop[];
}

export interface Incident {
  id: string;
  driverId: string;
  tripId?: number | null;
  type: 'MECANICO' | 'TRANSITO' | 'ESCUELA' | 'OTRO';
  description: string;
  photoUrl?: string | null;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
}
