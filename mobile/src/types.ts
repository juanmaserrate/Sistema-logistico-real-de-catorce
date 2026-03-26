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
}

export interface Stop {
  id: number;
  sequence: number;
  status: string;
  actualArrival: string | null;
  actualDeparture: string | null;
  observations?: string | null;
  proofPhotoUrl?: string | null;
  deliveryWithoutIssues?: boolean | null;
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
