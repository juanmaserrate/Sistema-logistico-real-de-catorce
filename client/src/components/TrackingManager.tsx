import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io, type Socket } from 'socket.io-client';
import { MapPin, Smartphone, RefreshCw, ExternalLink, Clock, Wifi, WifiOff } from 'lucide-react';

const defaultCenter: [number, number] = [-34.6037, -58.3816];

const argentinaBounds = L.latLngBounds(
    [-55.2, -73.6],
    [-21.8, -53.6]
);

const createIcon = () =>
    L.divIcon({
        className: 'custom-marker',
        html: '<div style="background:#007AFF;width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.3);"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

type DeviceLocation = {
    deviceId: string;
    deviceLabel: string | null;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    timestamp: string;
};

// En desarrollo apunta al servidor Express directo; en producción usa el mismo origen.
const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:3002' : '';

const TrackingManager = () => {
    const [locations, setLocations] = useState<DeviceLocation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [connected, setConnected] = useState(false);
    const socketRef = useRef<Socket | null>(null);

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

    useEffect(() => {
        setMapReady(true);
        // Carga inicial de ubicaciones históricas
        fetchLocations();

        // Conexión WebSocket
        const socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnectionDelay: 2000,
            reconnectionAttempts: Infinity,
        });
        socketRef.current = socket;

        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));

        // Cada vez que llega un ping GPS de cualquier chofer, actualiza su posición en el mapa
        socket.on('location:update', (loc: DeviceLocation) => {
            setLocations(prev => {
                const filtered = prev.filter(l => l.deviceId !== loc.deviceId);
                return [...filtered, loc];
            });
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    const openInMap = (lat: number, lng: number) => {
        window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=17`, '_blank');
    };

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffM = Math.floor(diffMs / 60000);
        if (diffM < 1) return 'Ahora';
        if (diffM < 60) return `Hace ${diffM} min`;
        const diffH = Math.floor(diffM / 60);
        if (diffH < 24) return `Hace ${diffH} h`;
        return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    const mapCenter: [number, number] = useMemo(() => {
        if (locations.length === 0) return defaultCenter;
        const lat = locations.reduce((s, l) => s + l.latitude, 0) / locations.length;
        const lng = locations.reduce((s, l) => s + l.longitude, 0) / locations.length;
        return [lat, lng];
    }, [locations]);

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-[22px] font-bold text-[#1C1C1E]">Rastreo satelital</h2>
                    <p className="text-[14px] text-[#8E8E93] font-medium">Ubicación en tiempo real de los dispositivos que usan la app</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
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

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-2xl flex items-center justify-between gap-4">
                    <span className="font-medium">{error}</span>
                    <button type="button" onClick={fetchLocations} className="text-red-800 font-bold text-sm underline">
                        Reintentar
                    </button>
                </div>
            )}

            <div className="bg-white rounded-[32px] border border-[#E5E7EB] shadow-sm overflow-hidden">
                <div className="p-4 border-b border-[#F2F2F7]">
                    <p className="text-[13px] font-bold text-[#8E8E93] uppercase tracking-wider">Mapa en vivo</p>
                </div>
                <div className="tracking-map-wrap w-full" style={{ minHeight: 400, height: 400 }}>
                    {mapReady && (
                        <MapContainer
                            key="tracking-map"
                            center={mapCenter}
                            zoom={locations.length > 0 ? 13 : 11}
                            minZoom={4}
                            maxBounds={argentinaBounds}
                            maxBoundsViscosity={1}
                            className="h-full w-full"
                            style={{ height: '100%', width: '100%', minHeight: 400 }}
                            scrollWheelZoom={true}
                        >
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            {locations.map((loc) => (
                                <Marker key={loc.deviceId} position={[loc.latitude, loc.longitude]} icon={createIcon()}>
                                    <Popup>
                                        <strong>{loc.deviceLabel || loc.deviceId}</strong>
                                        <br />
                                        {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                                        <br />
                                        <span className="text-gray-500 text-xs">{formatTime(loc.timestamp)}</span>
                                    </Popup>
                                </Marker>
                            ))}
                        </MapContainer>
                    )}
                    {!mapReady && (
                        <div className="h-full w-full flex items-center justify-center bg-[#F8F9FB] text-[#8E8E93] font-medium">
                            Cargando mapa...
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-[32px] border border-[#E5E7EB] shadow-sm overflow-hidden">
                {loading && locations.length === 0 ? (
                    <div className="p-20 text-center text-[#8E8E93] font-medium">Cargando ubicaciones...</div>
                ) : locations.length === 0 ? (
                    <div className="p-20 text-center">
                        <Smartphone className="mx-auto text-[#AEAEB2]" size={48} />
                        <p className="text-[#8E8E93] font-medium mt-4">Aún no hay dispositivos reportando ubicación.</p>
                        <p className="text-[13px] text-[#AEAEB2] mt-2">Los choferes deben fichar entrada en la app para aparecer aquí.</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-[#F2F2F7]">
                        {locations.map((loc) => (
                            <li key={loc.deviceId} className="p-6 flex flex-wrap items-center gap-4 hover:bg-[#F8F9FB] transition-colors">
                                <div className="bg-[#F2F2F7] p-3 rounded-2xl text-[#007AFF]">
                                    <Smartphone size={24} />
                                </div>
                                <div className="flex-1 min-w-[180px]">
                                    <p className="font-bold text-[#1C1C1E]">{loc.deviceLabel || loc.deviceId}</p>
                                    <p className="text-[12px] text-[#8E8E93] font-medium flex items-center gap-1 mt-0.5">
                                        <MapPin size={12} />
                                        {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                                        {loc.accuracy != null && <span className="text-[#AEAEB2]"> (±{Math.round(loc.accuracy)} m)</span>}
                                    </p>
                                    <p className="text-[11px] text-[#AEAEB2] font-medium flex items-center gap-1 mt-1">
                                        <Clock size={10} />
                                        {formatTime(loc.timestamp)}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => openInMap(loc.latitude, loc.longitude)}
                                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#007AFF] text-white text-sm font-bold hover:opacity-90 transition-all"
                                >
                                    <ExternalLink size={16} />
                                    Ver en mapa
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default TrackingManager;
