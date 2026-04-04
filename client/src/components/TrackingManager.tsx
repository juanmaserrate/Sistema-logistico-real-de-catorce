import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io, type Socket } from 'socket.io-client';
import {
    MapPin, Smartphone, RefreshCw, Clock, Wifi, WifiOff,
    Route, X, Layers, Map, Filter
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const defaultCenter: [number, number] = [-34.6037, -58.3816];
const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:3002' : '';

const TILES = {
    street: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
    satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
    },
} as const;

type TileMode = keyof typeof TILES;

// ─── Types ────────────────────────────────────────────────────────────────────

type DeviceLocation = {
    deviceId: string;
    deviceLabel: string | null;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    timestamp: string;
};

type HistoryPoint = { latitude: number; longitude: number; timestamp: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getStatusColor = (timestamp: string): string => {
    const diffMin = (Date.now() - new Date(timestamp).getTime()) / 60000;
    if (diffMin < 5) return '#34C759';
    if (diffMin < 30) return '#FF9500';
    if (diffMin < 1440) return '#FF3B30';
    return '#8E8E93';
};

const getStatusLabel = (timestamp: string): string => {
    const diffMin = (Date.now() - new Date(timestamp).getTime()) / 60000;
    if (diffMin < 5) return 'Activo';
    if (diffMin < 30) return 'Reciente';
    if (diffMin < 1440) return 'Inactivo';
    return 'Sin señal';
};

const createIcon = (color: string) =>
    L.divIcon({
        className: '',
        html: `<div style="background:${color};width:28px;height:28px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;">
            <div style="width:8px;height:8px;background:white;border-radius:50%;"></div>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
    });

const formatTime = (iso: string): string => {
    const diffM = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (diffM < 1) return 'Ahora';
    if (diffM < 60) return `Hace ${diffM} min`;
    const diffH = Math.floor(diffM / 60);
    if (diffH < 24) return `Hace ${diffH} h`;
    return new Date(iso).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
};

// ─── MapController ─────────────────────────────────────────────────────────────
// Fits bounds once when devices first load; centers on a device when requested.

type MapControllerProps = {
    locations: DeviceLocation[];
    flyToTarget: [number, number] | null;
    onFlyDone: () => void;
    didFitRef: React.MutableRefObject<boolean>;
};

const MapController = ({ locations, flyToTarget, onFlyDone, didFitRef }: MapControllerProps) => {
    const map = useMap();

    // Auto-fit on initial load
    useEffect(() => {
        if (didFitRef.current || locations.length === 0) return;
        if (locations.length === 1) {
            map.setView([locations[0].latitude, locations[0].longitude], 14);
        } else {
            const bounds = L.latLngBounds(locations.map(l => [l.latitude, l.longitude]));
            map.fitBounds(bounds, { padding: [48, 48] });
        }
        didFitRef.current = true;
    }, [locations, map, didFitRef]);

    // Fly-to on device click
    useEffect(() => {
        if (!flyToTarget) return;
        map.flyTo(flyToTarget, 16, { duration: 1.2 });
        onFlyDone();
    }, [flyToTarget, map, onFlyDone]);

    return null;
};

// ─── Main component ────────────────────────────────────────────────────────────

const TrackingManager = () => {
    const [locations, setLocations] = useState<DeviceLocation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [connected, setConnected] = useState(false);

    // Map UI state
    const [tileMode, setTileMode] = useState<TileMode>('street');
    const [showOnlyActive, setShowOnlyActive] = useState(false);
    const [flyToTarget, setFlyToTarget] = useState<[number, number] | null>(null);
    const didFitRef = useRef(false);

    // Path history state
    const [historyDeviceId, setHistoryDeviceId] = useState<string | null>(null);
    const [historyPoints, setHistoryPoints] = useState<HistoryPoint[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);

    const socketRef = useRef<Socket | null>(null);
    // Refs for marker map so we can open popups programmatically
    const markerRefs = useRef<Record<string, L.Marker | null>>({});

    // ── Data fetching ───────────────────────────────────────────────────────────

    const fetchLocations = async () => {
        setError(null);
        try {
            const res = await fetch('/api/v1/tracking/locations');
            if (res.ok) {
                const data = await res.json();
                setLocations(Array.isArray(data) ? data : []);
            } else {
                const err = await res.json();
                setError(err?.error || 'Error al cargar ubicaciones');
            }
        } catch {
            setError('API no disponible. Comprueba que el servidor esté encendido.');
        } finally {
            setLoading(false);
        }
    };

    const fetchHistory = async (deviceId: string) => {
        setHistoryLoading(true);
        setHistoryError(null);
        setHistoryPoints([]);
        setHistoryDeviceId(deviceId);
        try {
            const res = await fetch(`/api/v1/tracking/device-history?deviceId=${encodeURIComponent(deviceId)}&hours=8`);
            if (res.status === 404) {
                setHistoryError('No hay historial disponible para este dispositivo');
                setHistoryPoints([]);
                return;
            }
            if (!res.ok) {
                setHistoryError('No hay historial disponible para este dispositivo');
                return;
            }
            const data: HistoryPoint[] = await res.json();
            setHistoryPoints(Array.isArray(data) ? data : []);
        } catch {
            setHistoryError('No hay historial disponible para este dispositivo');
        } finally {
            setHistoryLoading(false);
        }
    };

    const closeHistory = () => {
        setHistoryDeviceId(null);
        setHistoryPoints([]);
        setHistoryError(null);
    };

    // ── Socket setup ────────────────────────────────────────────────────────────

    useEffect(() => {
        setMapReady(true);
        fetchLocations();

        const socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnectionDelay: 2000,
            reconnectionAttempts: Infinity,
        });
        socketRef.current = socket;

        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));
        socket.on('location:update', (loc: DeviceLocation) => {
            setLocations(prev => [...prev.filter(l => l.deviceId !== loc.deviceId), loc]);
        });

        return () => { socket.disconnect(); };
    }, []);

    // ── Derived data ────────────────────────────────────────────────────────────

    const visibleLocations = showOnlyActive
        ? locations.filter(l => (Date.now() - new Date(l.timestamp).getTime()) / 60000 < 30)
        : locations;

    const activeCount = locations.filter(
        l => (Date.now() - new Date(l.timestamp).getTime()) / 60000 < 30
    ).length;
    const inactiveCount = locations.length - activeCount;

    const historyDevice = locations.find(l => l.deviceId === historyDeviceId);
    const historyColor = historyDevice ? getStatusColor(historyDevice.timestamp) : '#007AFF';
    const historyPolyline = historyPoints.map(p => [p.latitude, p.longitude] as [number, number]);

    // ── Handlers ────────────────────────────────────────────────────────────────

    const handleFlyDone = useCallback(() => setFlyToTarget(null), []);

    const centerOnDevice = (loc: DeviceLocation) => {
        setFlyToTarget([loc.latitude, loc.longitude]);
        // Open popup after fly animation (~1.4s)
        setTimeout(() => {
            markerRefs.current[loc.deviceId]?.openPopup();
        }, 1400);
    };

    // ── Render ──────────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6 animate-fade-in pb-20">

            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-[22px] font-bold text-[#1C1C1E]">Rastreo satelital</h2>
                    <p className="text-[14px] text-[#8E8E93] font-medium">
                        Ubicación en tiempo real de los dispositivos
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                        connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                        {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
                        {connected ? 'En vivo' : 'Reconectando…'}
                    </div>
                    <button
                        type="button"
                        onClick={() => { setLoading(true); fetchLocations(); }}
                        disabled={loading}
                        className="flex items-center gap-2 bg-[#007AFF] text-white px-6 py-3 rounded-2xl font-bold text-sm hover:opacity-90 disabled:opacity-70 transition-all"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                </div>
            </div>

            {/* ── Error banner ── */}
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-2xl flex items-center justify-between gap-4">
                    <span className="font-medium">{error}</span>
                    <button type="button" onClick={fetchLocations} className="text-red-800 font-bold text-sm underline">
                        Reintentar
                    </button>
                </div>
            )}

            {/* ── Stats summary bar ── */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded-2xl border border-[#E5E7EB] px-5 py-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#F2F2F7] flex items-center justify-center">
                        <Smartphone size={18} className="text-[#8E8E93]" />
                    </div>
                    <div>
                        <p className="text-[22px] font-bold text-[#1C1C1E] leading-none">{locations.length}</p>
                        <p className="text-[11px] text-[#8E8E93] font-medium mt-0.5">Total</p>
                    </div>
                </div>
                <div className="bg-white rounded-2xl border border-[#E5E7EB] px-5 py-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#34C75920' }}>
                        <Wifi size={18} style={{ color: '#34C759' }} />
                    </div>
                    <div>
                        <p className="text-[22px] font-bold leading-none" style={{ color: '#34C759' }}>{activeCount}</p>
                        <p className="text-[11px] text-[#8E8E93] font-medium mt-0.5">Activos</p>
                    </div>
                </div>
                <div className="bg-white rounded-2xl border border-[#E5E7EB] px-5 py-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#FF3B3020' }}>
                        <WifiOff size={18} style={{ color: '#FF3B30' }} />
                    </div>
                    <div>
                        <p className="text-[22px] font-bold leading-none" style={{ color: '#FF3B30' }}>{inactiveCount}</p>
                        <p className="text-[11px] text-[#8E8E93] font-medium mt-0.5">Inactivos</p>
                    </div>
                </div>
            </div>

            {/* ── Map card ── */}
            <div className="bg-white rounded-[32px] border border-[#E5E7EB] shadow-sm overflow-hidden">

                {/* Map toolbar */}
                <div className="p-4 border-b border-[#F2F2F7] flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-[13px] font-bold text-[#8E8E93] uppercase tracking-wider">Mapa en vivo</p>

                    <div className="flex items-center gap-2">
                        {/* Active-only filter */}
                        <button
                            type="button"
                            onClick={() => setShowOnlyActive(v => !v)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                                showOnlyActive
                                    ? 'bg-[#007AFF] text-white border-[#007AFF]'
                                    : 'bg-[#F2F2F7] text-[#8E8E93] border-transparent hover:border-[#D1D1D6]'
                            }`}
                        >
                            <Filter size={12} />
                            Solo activos
                        </button>

                        {/* Tile toggle */}
                        <div className="flex items-center bg-[#F2F2F7] rounded-xl p-1 gap-1">
                            <button
                                type="button"
                                onClick={() => setTileMode('street')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    tileMode === 'street'
                                        ? 'bg-white text-[#1C1C1E] shadow-sm'
                                        : 'text-[#8E8E93] hover:text-[#1C1C1E]'
                                }`}
                            >
                                <Map size={12} />
                                Calles
                            </button>
                            <button
                                type="button"
                                onClick={() => setTileMode('satellite')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    tileMode === 'satellite'
                                        ? 'bg-white text-[#1C1C1E] shadow-sm'
                                        : 'text-[#8E8E93] hover:text-[#1C1C1E]'
                                }`}
                            >
                                <Layers size={12} />
                                Satélite
                            </button>
                        </div>
                    </div>
                </div>

                {/* Map container */}
                <div className="w-full" style={{ height: 560 }}>
                    {mapReady ? (
                        <MapContainer
                            key="tracking-map"
                            center={defaultCenter}
                            zoom={11}
                            minZoom={3}
                            className="h-full w-full"
                            style={{ height: '100%', width: '100%' }}
                            scrollWheelZoom={true}
                        >
                            <TileLayer
                                key={tileMode}
                                attribution={TILES[tileMode].attribution}
                                url={TILES[tileMode].url}
                            />

                            <MapController
                                locations={locations}
                                flyToTarget={flyToTarget}
                                onFlyDone={handleFlyDone}
                                didFitRef={didFitRef}
                            />

                            {/* Device markers */}
                            {visibleLocations.map(loc => {
                                const color = getStatusColor(loc.timestamp);
                                return (
                                    <Marker
                                        key={loc.deviceId}
                                        position={[loc.latitude, loc.longitude]}
                                        icon={createIcon(color)}
                                        ref={el => { markerRefs.current[loc.deviceId] = el; }}
                                    >
                                        <Tooltip permanent={false} direction="top" offset={[0, -16]}>
                                            <span className="font-semibold text-[13px]">
                                                {loc.deviceLabel || loc.deviceId}
                                            </span>
                                        </Tooltip>
                                        <Popup>
                                            <div style={{ minWidth: 180 }}>
                                                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                                                    {loc.deviceLabel || loc.deviceId}
                                                </p>
                                                <p style={{ fontSize: 12, color: '#8E8E93', marginBottom: 2 }}>
                                                    {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                                                </p>
                                                {loc.accuracy != null && (
                                                    <p style={{ fontSize: 11, color: '#AEAEB2', marginBottom: 2 }}>
                                                        Precisión: ±{Math.round(loc.accuracy)} m
                                                    </p>
                                                )}
                                                <p style={{ fontSize: 11, color: color, fontWeight: 600, marginBottom: 8 }}>
                                                    {formatTime(loc.timestamp)}
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => fetchHistory(loc.deviceId)}
                                                    style={{
                                                        background: '#007AFF', color: 'white',
                                                        border: 'none', borderRadius: 8,
                                                        padding: '6px 12px', fontSize: 12,
                                                        fontWeight: 700, cursor: 'pointer', width: '100%',
                                                    }}
                                                >
                                                    Ver recorrido
                                                </button>
                                            </div>
                                        </Popup>
                                    </Marker>
                                );
                            })}

                            {/* Path history polyline */}
                            {historyPolyline.length > 1 && (
                                <Polyline
                                    positions={historyPolyline}
                                    pathOptions={{ color: historyColor, weight: 4, opacity: 0.85 }}
                                />
                            )}
                        </MapContainer>
                    ) : (
                        <div className="h-full w-full flex items-center justify-center bg-[#F8F9FB] text-[#8E8E93] font-medium">
                            Cargando mapa...
                        </div>
                    )}
                </div>

                {/* History status strip */}
                {historyDeviceId && (
                    <div className={`px-5 py-3 border-t border-[#F2F2F7] flex items-center justify-between gap-3 ${
                        historyError ? 'bg-orange-50' : 'bg-[#F8F9FB]'
                    }`}>
                        <div className="flex items-center gap-2 text-sm font-medium text-[#1C1C1E]">
                            {historyLoading ? (
                                <RefreshCw size={14} className="animate-spin text-[#8E8E93]" />
                            ) : (
                                <Route size={14} style={{ color: historyError ? '#FF9500' : historyColor }} />
                            )}
                            {historyLoading
                                ? `Cargando recorrido de ${historyDevice?.deviceLabel || historyDeviceId}…`
                                : historyError
                                    ? historyError
                                    : `Recorrido de ${historyDevice?.deviceLabel || historyDeviceId} — últimas 8 h (${historyPoints.length} puntos)`
                            }
                        </div>
                        <button
                            type="button"
                            onClick={closeHistory}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E5E7EB] text-[#3A3A3C] text-xs font-bold hover:bg-[#D1D1D6] transition-all"
                        >
                            <X size={12} />
                            Cerrar recorrido
                        </button>
                    </div>
                )}
            </div>

            {/* ── Device list ── */}
            <div className="bg-white rounded-[32px] border border-[#E5E7EB] shadow-sm overflow-hidden">
                <div className="p-4 border-b border-[#F2F2F7] flex items-center justify-between">
                    <p className="text-[13px] font-bold text-[#8E8E93] uppercase tracking-wider">
                        Dispositivos ({visibleLocations.length})
                    </p>
                    {showOnlyActive && (
                        <span className="text-[11px] font-bold text-[#007AFF] bg-blue-50 px-2.5 py-1 rounded-full">
                            Filtro activo
                        </span>
                    )}
                </div>

                {loading && locations.length === 0 ? (
                    <div className="p-20 text-center text-[#8E8E93] font-medium">Cargando ubicaciones…</div>
                ) : visibleLocations.length === 0 ? (
                    <div className="p-20 text-center">
                        <Smartphone className="mx-auto text-[#AEAEB2]" size={48} />
                        <p className="text-[#8E8E93] font-medium mt-4">
                            {showOnlyActive
                                ? 'Ningún dispositivo activo en los últimos 30 minutos.'
                                : 'Aún no hay dispositivos reportando ubicación.'}
                        </p>
                        <p className="text-[13px] text-[#AEAEB2] mt-2">
                            {showOnlyActive
                                ? 'Desactivá el filtro para ver todos los dispositivos.'
                                : 'Los choferes deben fichar entrada en la app para aparecer aquí.'}
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-[#F2F2F7]">
                        {visibleLocations
                            .slice()
                            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                            .map(loc => {
                                const color = getStatusColor(loc.timestamp);
                                const label = getStatusLabel(loc.timestamp);
                                const isShowingHistory = historyDeviceId === loc.deviceId;

                                return (
                                    <li
                                        key={loc.deviceId}
                                        className={`p-5 flex flex-wrap items-center gap-4 transition-colors cursor-pointer ${
                                            isShowingHistory ? 'bg-blue-50' : 'hover:bg-[#F8F9FB]'
                                        }`}
                                        onClick={() => centerOnDevice(loc)}
                                    >
                                        {/* Color dot + icon */}
                                        <div
                                            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                                            style={{ background: `${color}18` }}
                                        >
                                            <Smartphone size={22} style={{ color }} />
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-[160px]">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-bold text-[#1C1C1E] text-[15px]">
                                                    {loc.deviceLabel || loc.deviceId}
                                                </p>
                                                <span
                                                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                                    style={{ background: `${color}20`, color }}
                                                >
                                                    {label}
                                                </span>
                                            </div>
                                            <p className="text-[12px] text-[#8E8E93] font-medium flex items-center gap-1 mt-0.5">
                                                <MapPin size={11} />
                                                {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                                                {loc.accuracy != null && (
                                                    <span className="text-[#AEAEB2]"> (±{Math.round(loc.accuracy)} m)</span>
                                                )}
                                            </p>
                                            <p className="text-[11px] font-medium flex items-center gap-1 mt-1" style={{ color }}>
                                                <Clock size={10} />
                                                {formatTime(loc.timestamp)}
                                            </p>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                            {isShowingHistory ? (
                                                <button
                                                    type="button"
                                                    onClick={closeHistory}
                                                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#E5E7EB] text-[#3A3A3C] text-sm font-bold hover:bg-[#D1D1D6] transition-all"
                                                >
                                                    <X size={14} />
                                                    Cerrar recorrido
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => fetchHistory(loc.deviceId)}
                                                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                                                    style={{
                                                        background: `${color}15`,
                                                        color,
                                                    }}
                                                >
                                                    <Route size={14} />
                                                    Ver recorrido
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default TrackingManager;
