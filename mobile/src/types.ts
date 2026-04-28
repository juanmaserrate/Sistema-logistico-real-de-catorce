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
  reasonCode?: string | null;
  client: Client;
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
