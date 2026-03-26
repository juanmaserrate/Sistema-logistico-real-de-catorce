
import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    LogOut, 
    RefreshCw, 
    Clock, 
    ChevronRight,
    CheckCircle2,
    MessageSquare,
    Navigation,
    Camera,
    Loader2
} from 'lucide-react';
import clsx from 'clsx';

interface TripStop {
    id: number;
    name: string;
    clientId?: string;
    sequence: number;
    actualArrival?: string;
    actualDeparture?: string;
    status: string;
    observations?: string;
    failedReason?: string;
    latitude?: number;
    longitude?: number;
}

interface Trip {
    id: number;
    date: string;
    status: string;
    vehicle: string;
    driver: string;
    reparto?: string;
    stops: TripStop[];
    startedAt?: string;
    completedAt?: string;
}

const DriverPortal = () => {
    const navigate = useNavigate();
    const driverName = localStorage.getItem('driverName');
    
    const [loading, setLoading] = useState(false);
    const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
    const [selectedStop, setSelectedStop] = useState<TripStop | null>(null);
    const [observations, setObservations] = useState('');
    const [failedReason, setFailedReason] = useState('');
    const [isReporting, setIsReporting] = useState(false);
    const [photoUrl, setPhotoUrl] = useState('');
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

    // List of predefined quick comments
    const PREDEFINED_COMMENTS = [
        "Local Cerrado",
        "Cliente Ausente",
        "Demora en Descarga",
        "Mercadería Rechazada",
        "Problemas de Acceso",
        "Sin Lugar para Estacionar"
    ];

    const [showMap, setShowMap] = useState(false);
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMap = useRef<any>(null);

    const [isNavigating, setIsNavigating] = useState(false);
    const [distanceToNext, setDistanceToNext] = useState<string>('');
    const [etaToNext, setEtaToNext] = useState<string>('');
    const [followVehicle, setFollowVehicle] = useState(true);
    const [lastVoiceAlert, setLastVoiceAlert] = useState<string>('');
    const [tripFetchError, setTripFetchError] = useState<string | null>(null);

    // GPS Tracking Timer
    const trackingInterval = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!driverName) {
            navigate('/');
            return;
        }
        fetchMyTrips();
        startTracking();

        
        // Load Leaflet dynamically
        if (!document.getElementById('leaflet-css')) {
            const css = document.createElement('link');
            css.id = 'leaflet-css';
            css.rel = 'stylesheet';
            css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(css);

            const js = document.createElement('script');
            js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            js.onload = () => console.log("Leaflet loaded");
            document.head.appendChild(js);
        }

        return () => stopTracking();
    }, []);

    useEffect(() => {
        if ((showMap || isNavigating) && activeTrip && mapRef.current) {
            initMap();
        }
    }, [showMap, isNavigating, activeTrip]);

    const speak = (text: string) => {
        if (!window.speechSynthesis || text === lastVoiceAlert) return;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-AR';
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
        setLastVoiceAlert(text);
    };

    const initMap = () => {
        const L = (window as any).L;
        if (!L || !mapRef.current) return;

        if (leafletMap.current) {
            leafletMap.current.remove();
        }

        leafletMap.current = L.map(mapRef.current, { zoomControl: false }).setView([-34.6037, -58.3816], 12);
        L.tileLayer('https://{s}.tile.osm.org/{z}/{x}/{y}.png', {
            attribution: '© OSM'
        }).addTo(leafletMap.current);

        const stops = [...(activeTrip?.stops || [])].sort((a,b) => a.sequence - b.sequence);
        const coords: [number, number][] = [];

        stops.forEach(stop => {
            if (stop.latitude && stop.longitude) {
                const markerCoords: [number, number] = [stop.latitude, stop.longitude];
                coords.push(markerCoords);

                const isCurrentNext = !isNavigating && stop.status === 'PENDING';

                const icon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div class="w-8 h-8 rounded-full ${stop.status === 'COMPLETED' ? 'bg-emerald-500' : isCurrentNext ? 'bg-indigo-600 animate-bounce' : 'bg-slate-500'} border-2 border-white shadow-lg flex items-center justify-center text-white font-black text-xs">${stop.sequence}</div>`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });

                L.marker(markerCoords, { icon }).addTo(leafletMap.current)
                    .bindPopup(`<b>${stop.name}</b><br>Estado: ${stop.status}`);
            }
        });

        if (!isNavigating && coords.length > 1) {
            L.polyline(coords, { color: '#2563eb', weight: 4, opacity: 0.7, dashArray: '10, 10' }).addTo(leafletMap.current);
            leafletMap.current.fitBounds(L.polyline(coords).getBounds(), { padding: [50, 50] });
        }
    };

    const fetchMyTrips = async () => {
        setLoading(true);
        setTripFetchError(null);
        try {
            const res = await fetch(`/api/v1/trips?driver=${encodeURIComponent(driverName || '')}`);
            const data = await res.json();
            const active = data.find((t: Trip) => t.status === 'OUT_OF_PLANT' || t.status === 'PENDING');
            setActiveTrip(active || null);
        } catch (error) {
            console.error(error);
            setTripFetchError('API no disponible. Comprueba que el servidor esté encendido.');
        } finally {
            setLoading(false);
        }
    };

    const startTracking = () => {
        if (!navigator.geolocation) return;
        trackingInterval.current = setInterval(() => {
            if (!activeTrip) return;
            navigator.geolocation.getCurrentPosition(async (pos) => {
                const { latitude, longitude } = pos.coords;
                
                // Update marker if on map
                const L = (window as any).L;
                if ((showMap || isNavigating) && leafletMap.current && L) {
                    if (!(window as any).driverMarker) {
                        const icon = L.divIcon({
                            className: 'driver-icon',
                            html: '<div class="relative w-8 h-8"><div class="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-40"></div><div class="relative w-8 h-8 bg-blue-600 rounded-full border-4 border-white shadow-2xl flex items-center justify-center"><div class="w-1.5 h-1.5 bg-white rounded-full"></div></div></div>',
                            iconSize: [32, 32]
                        });
                        (window as any).driverMarker = L.marker([latitude, longitude], { icon, zIndexOffset: 1000 }).addTo(leafletMap.current);
                    } else {
                        (window as any).driverMarker.setLatLng([latitude, longitude]);
                    }

                    if (followVehicle) {
                        leafletMap.current.panTo([latitude, longitude], { animate: true });
                    }

                    // GEO-FENCING
                    const nextStop = activeTrip.stops.find(s => s.status === 'PENDING');
                    if (nextStop && nextStop.latitude && nextStop.longitude) {
                        const dist = L.latLng(latitude, longitude).distanceTo(L.latLng(nextStop.latitude, nextStop.longitude));
                        if (dist < 100 && !isReporting) {
                            speak(`Has llegado a ${nextStop.name}. Por favor marca el arribo.`);
                            setSelectedStop(nextStop);
                            setIsReporting(true);
                            setIsNavigating(false);
                        } else if (dist < 800 && dist > 700) {
                            speak(`Faltan 800 metros para ${nextStop.name}.`);
                        }
                    }
                }

                await fetch(`/api/v1/trips/${activeTrip.id}/location`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ latitude, longitude })
                });

                if (isNavigating) syncNavigationRoute(latitude, longitude);
            }, undefined, { enableHighAccuracy: true });
        }, 15000); // Faster tracking for navigation
    };

    const syncNavigationRoute = async (lat: number, lng: number) => {
        const nextPending = activeTrip?.stops.find(s => s.status === 'PENDING');
        if (!nextPending || !nextPending.latitude) return;

        try {
            const res = await fetch(`/api/v1/vrp/fixed-route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin: { lat, lng },
                    clients: [{ ...nextPending, latitude: nextPending.latitude, longitude: nextPending.longitude }]
                })
            });
            const data = await res.json();
            if (data.route) {
                setDistanceToNext(`${(data.route.distanceMeters / 1000).toFixed(1)} km`);
                const min = Math.round(data.route.durationSec / 60);
                setEtaToNext(`${min} min`);

                // Draw live leg
                const L = (window as any).L;
                if (leafletMap.current && data.route.geometry) {
                    if ((window as any).navPolyline) leafletMap.current.removeLayer((window as any).navPolyline);
                    (window as any).navPolyline = L.geoJSON(data.route.geometry, {
                        style: { color: '#4F46E5', weight: 8, opacity: 0.8, lineCap: 'round' }
                    }).addTo(leafletMap.current);
                }
            }
        } catch (e) {
            console.error("Nav sync error", e);
        }
    };


    const stopTracking = () => {
        if (trackingInterval.current) clearInterval(trackingInterval.current);
    };

    const handleStartNavigation = (stop: TripStop) => {
        if (!stop.latitude || !stop.longitude) {
            alert("Sin coordenadas GPS.");
            return;
        }
        setIsNavigating(true);
        setShowMap(true);
        speak(`Iniciando navegación hacia ${stop.name}.`);
        
        navigator.geolocation.getCurrentPosition((pos) => {
            syncNavigationRoute(pos.coords.latitude, pos.coords.longitude);
        });
    };

    const handleMarkArrival = async (stop: TripStop) => {
        try {
            const pos = await new Promise<GeolocationPosition>((res) => navigator.geolocation.getCurrentPosition(res));
            await fetch(`/api/v1/trips/${activeTrip?.id}/stops/${stop.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    actualArrival: new Date().toISOString(), 
                    status: 'ARRIVED',
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude
                })
            });
            fetchMyTrips();
        } catch (e) {
            alert("Error al marcar llegada");
        }
    };

    const handleMarkDeparture = async (status: 'COMPLETED' | 'FAILED') => {
        if (!selectedStop) return;
        try {
            const finalObservations = photoUrl ? `${observations}\n[FOTO_ADJUNTA: ${photoUrl}]` : observations;
            await fetch(`/api/v1/trips/${activeTrip?.id}/stops/${selectedStop.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    actualDeparture: new Date().toISOString(), 
                    status,
                    observations: finalObservations,
                    failedReason: status === 'FAILED' ? failedReason : ''
                })
            });
            setSelectedStop(null);
            setObservations('');
            setFailedReason('');
            setPhotoUrl('');
            setIsReporting(false);
            fetchMyTrips();
            speak(`Parada finalizada. Siguiente destino en proceso.`);
        } catch (e) {
            alert("Error al marcar salida");
        }
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        setIsUploadingPhoto(true);
        const formData = new FormData();
        formData.append('photo', e.target.files[0]);

        try {
            const res = await fetch('/api/upload-photo', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.url) {
                setPhotoUrl(data.url);
            }
        } catch (e) {
            alert("Error al subir foto");
        } finally {
            setIsUploadingPhoto(false);
        }
    };

    const logout = () => {
        localStorage.clear();
        navigate('/');
    };

    const handleOpenExternalMap = (stop: TripStop) => {
        if (!stop.latitude || !stop.longitude) {
            alert("Esta parada no tiene coordenadas GPS definidas.");
            return;
        }
        const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}&travelmode=driving`;
        window.open(url, '_blank');
    };

    if (loading) return <div className="min-h-screen bg-[#F2F2F7] flex items-center justify-center font-bold text-[#8E8E93]">Cargando Logística...</div>;

    const sortedStops = activeTrip?.stops ? [...activeTrip.stops].sort((a,b) => a.sequence - b.sequence) : [];
    const nextStop = sortedStops.find(s => s.status === 'PENDING' || s.status === 'ARRIVED');

    return (
        <div className="min-h-screen bg-[#F8F9FA] flex flex-col font-sans pb-10">
            {/* Navigation Overlay (iOS Apple Maps Style) */}
            {isNavigating && nextStop && (
                <div className="fixed inset-x-4 top-4 z-[100] animate-in slide-in-from-top-10 duration-500">
                    <div className="bg-slate-900 rounded-[32px] p-6 shadow-2xl border border-white/10 flex items-center gap-5">
                        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center animate-pulse">
                            <Navigation size={32} className="text-white rotate-45" />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-white font-black text-xl leading-none mb-1">{nextStop.name}</h2>
                            <div className="flex items-center gap-3">
                                <span className="text-blue-400 font-black text-xs uppercase tracking-widest">{distanceToNext}</span>
                                <div className="w-1 h-1 bg-white/20 rounded-full"></div>
                                <span className="text-emerald-400 font-black text-xs uppercase tracking-widest">{etaToNext}</span>
                            </div>
                        </div>
                        <button 
                            onClick={() => setIsNavigating(false)}
                            className="bg-white/10 p-4 rounded-2xl text-white font-black text-[10px] uppercase tracking-widest"
                        >SALIR</button>
                    </div>
                </div>
            )}

            {/* iOS Navigation Header */}
            {!isNavigating && (
                <header className="bg-white/80 backdrop-blur-2xl border-b border-black/5 sticky top-0 z-40 p-6 flex justify-between items-center px-4 sm:px-10">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-600 rounded-[22px] flex items-center justify-center shadow-lg shadow-blue-200">
                            <Navigation size={22} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-black text-slate-900 leading-none">Mi Operación</h1>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                <span className="text-[10px] font-black text-slate-400 tracking-widest uppercase">{driverName}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => { setShowMap(!showMap); setIsNavigating(false); }}
                            className={clsx(
                                "p-3 rounded-2xl transition-all shadow-sm flex items-center gap-2",
                                (showMap && !isNavigating) ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-600"
                            )}
                        >
                            <RefreshCw size={18} className={clsx(showMap && "animate-spin-slow")} />
                            <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">{showMap ? 'Ver Lista' : 'Ver Mapa'}</span>
                        </button>
                        <button onClick={logout} className="p-3 bg-red-50 text-red-500 rounded-2xl active:scale-90 transition-all">
                            <LogOut size={20} />
                        </button>
                    </div>
                </header>
            )}

            {!activeTrip ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center animate-in fade-in slide-in-from-bottom-5 duration-700">
                    {tripFetchError && (
                        <div className="mb-6 w-full max-w-md bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-2xl flex flex-col sm:flex-row items-center justify-center gap-3">
                            <span className="font-medium text-center sm:text-left">{tripFetchError}</span>
                            <button type="button" onClick={fetchMyTrips} className="text-red-800 font-bold text-sm underline hover:no-underline whitespace-nowrap">
                                Reintentar
                            </button>
                        </div>
                    )}
                    <div className="w-32 h-32 bg-white rounded-[40px] shadow-sm flex items-center justify-center mb-10">
                         <Clock size={56} className="text-slate-300" />
                    </div>
                    <h2 className="text-2xl font-black text-slate-900">Agenda Vacía</h2>
                    <p className="text-slate-500 font-medium max-w-[240px] mt-2">No tienes viajes asignados para este turno.</p>
                    <button onClick={fetchMyTrips} className="mt-10 bg-slate-900 text-white px-10 py-4 rounded-3xl font-black text-xs uppercase tracking-widest shadow-xl flex items-center gap-3 active:scale-95 transition-all">
                        <RefreshCw size={18} /> Actualizar Datos
                    </button>
                </div>
            ) : (
                <div className={clsx("max-w-xl mx-auto w-full transition-all duration-700", isNavigating ? "p-0 h-full" : "p-4 sm:p-6 space-y-6")}>
                    
                    {/* Map View Toggleable / Navigation Body */}
                    <div className={clsx(
                        "w-full transition-all duration-700 overflow-hidden relative", 
                        isNavigating ? "h-screen fixed inset-0 z-50" : (showMap ? "h-[500px] opacity-100 rounded-[40px] shadow-2xl border-4 border-white" : "h-0 opacity-0")
                    )}>
                        <div ref={mapRef} className="w-full h-full bg-slate-200"></div>
                        
                        {isNavigating && (
                            <div className="absolute bottom-10 inset-x-6 z-[60] flex flex-col gap-4">
                                <button 
                                    onClick={() => setFollowVehicle(!followVehicle)}
                                    className={clsx("self-end p-5 rounded-full shadow-2xl transition-all active:scale-90", followVehicle ? "bg-blue-600 text-white" : "bg-white text-slate-900")}
                                >
                                    <RefreshCw size={24} className={followVehicle ? "animate-spin-slow" : ""} />
                                </button>
                                <div className="bg-white/95 backdrop-blur-xl p-8 rounded-[40px] shadow-2xl border border-black/5">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Destino Actual</p>
                                    <h3 className="text-2xl font-black text-slate-900">{nextStop?.name}</h3>
                                    <button 
                                        onClick={() => handleMarkArrival(nextStop!)}
                                        className="w-full mt-6 bg-emerald-500 text-white py-6 rounded-[32px] font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-emerald-200 active:scale-95 transition-all"
                                    >LLEGUE AL LUGAR</button>
                                </div>
                            </div>
                        )}
                    </div>

                    {!showMap && !isNavigating && (
                        <>
                            {/* Status Summary Card */}
                            <div className="bg-white p-6 sm:p-8 rounded-[40px] border border-slate-100 shadow-xl shadow-slate-200/50">
                                <div className="flex justify-between items-start mb-6">
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Unidad Asignada</p>
                                        <h2 className="text-2xl font-black text-blue-600 uppercase tracking-tighter">{activeTrip.vehicle}</h2>
                                    </div>
                                    <div className={clsx(
                                        "px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest",
                                        activeTrip.status === 'OUT_OF_PLANT' ? "bg-emerald-50 text-emerald-600" : "bg-indigo-50 text-indigo-600"
                                    )}>
                                        {activeTrip.status === 'OUT_OF_PLANT' ? 'En Tránsito' : 'Listo p/ Salida'}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                     <div className="bg-slate-50 rounded-3xl p-4 sm:p-5 border border-slate-100">
                                         <p className="text-[10px] font-black text-slate-400 uppercase">Paradas</p>
                                         <p className="text-2xl font-black text-slate-900">{activeTrip.stops.length}</p>
                                     </div>
                                     <div className="bg-slate-50 rounded-3xl p-4 sm:p-5 border border-slate-100">
                                         <p className="text-[10px] font-black text-slate-400 uppercase">Efectividad</p>
                                         <p className="text-2xl font-black text-emerald-500">
                                             {Math.round((activeTrip.stops.filter(s => s.status === 'COMPLETED').length / activeTrip.stops.length) * 100 || 0)}%
                                         </p>
                                     </div>
                                </div>
                            </div>

                            {/* Navigation Assistant */}
                            <div className="bg-slate-900 p-6 rounded-[40px] text-white shadow-2xl space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center">
                                        <Navigation size={20} className="text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-black uppercase tracking-widest">Asistente de Navegación</h3>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase">Supera el límite de Google Maps</p>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-1 gap-2">
                                    {Array.from({ length: Math.ceil(sortedStops.length / 9) }).map((_, i) => {
                                        const start = i * 9;
                                        const end = Math.min(start + 9, sortedStops.length);
                                        const batch = sortedStops.slice(start, end);
                                        const batchCoords = batch.filter(s => s.latitude && s.longitude).map(s => `${s.latitude},${s.longitude}`).join('/');
                                        
                                        const handleOpenBatch = () => {
                                            if (!batchCoords) {
                                                alert("No hay coordenadas en este tramo.");
                                                return;
                                            }
                                            const url = `https://www.google.com/maps/dir/${batchCoords}`;
                                            window.open(url, '_blank');
                                        };

                                        return (
                                            <button 
                                                key={i}
                                                onClick={handleOpenBatch}
                                                className="w-full bg-white/10 hover:bg-white/20 p-4 rounded-3xl flex items-center justify-between transition-all active:scale-95"
                                            >
                                                <div className="text-left">
                                                    <p className="text-[10px] font-black uppercase opacity-60">Tramo {i + 1}</p>
                                                    <p className="text-xs font-bold font-mono">Paradas {start + 1} — {end}</p>
                                                </div>
                                                <div className="flex items-center gap-2 text-indigo-400">
                                                    <span className="text-[8px] font-black uppercase tracking-tighter">Abrir Maps</span>
                                                    <ChevronRight size={16} />
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Timeline stops */}
                            <div className="space-y-4">
                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Secuencia Logística</h3>
                                
                                {sortedStops.map((stop) => (
                                    <div key={stop.id} className={clsx(
                                        "bg-white p-5 rounded-[32px] border transition-all duration-300 flex items-center gap-4",
                                        stop.status === 'COMPLETED' ? "opacity-50 border-transparent bg-slate-50" : "border-slate-100 shadow-sm",
                                        stop.status === 'ARRIVED' ? "ring-4 ring-blue-50 border-blue-100" : ""
                                    )}>
                                        <div className={clsx(
                                            "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0",
                                            stop.status === 'COMPLETED' ? "bg-emerald-100 text-emerald-600" :
                                            stop.status === 'FAILED' ? "bg-red-100 text-red-600" :
                                            stop.status === 'ARRIVED' ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "bg-slate-100 text-slate-400"
                                        )}>
                                            {stop.status === 'COMPLETED' ? <CheckCircle2 size={24} /> : stop.sequence}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-extrabold text-slate-900 text-sm sm:text-base truncate">{stop.name}</h4>
                                            <div className="flex items-center gap-3 mt-1">
                                                <button 
                                                    onClick={() => handleStartNavigation(stop)}
                                                    className="flex items-center gap-1.5 text-[10px] font-black text-indigo-600 uppercase tracking-wider bg-indigo-50 px-3 py-1.5 rounded-xl transition-all hover:bg-indigo-100"
                                                >
                                                    <Navigation size={12} /> Navegador R14
                                                </button>
                                                <div className="w-1 h-1 rounded-full bg-slate-200"></div>
                                                <button 
                                                    onClick={() => handleOpenExternalMap(stop)}
                                                    className="text-[10px] font-bold text-slate-400 uppercase"
                                                >G-Maps</button>
                                            </div>
                                        </div>

                                        <button 
                                            onClick={() => {
                                                if (stop.status === 'PENDING') handleMarkArrival(stop);
                                                else if (stop.status === 'ARRIVED') {
                                                    setSelectedStop(stop);
                                                    setIsReporting(true);
                                                }
                                            }}
                                            disabled={stop.status === 'COMPLETED' || stop.status === 'FAILED'}
                                            className={clsx(
                                                "w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-all",
                                                stop.status === 'PENDING' ? "bg-slate-900 text-white" :
                                                stop.status === 'ARRIVED' ? "bg-emerald-500 text-white" : "bg-slate-50 text-slate-200"
                                            )}
                                        >
                                            <ChevronRight size={24} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Reporting Modal */}
            {isReporting && selectedStop && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xl z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6">
                    <div className="bg-white w-full max-w-lg rounded-t-[48px] sm:rounded-[48px] shadow-2xl p-6 sm:p-10 animate-in slide-in-from-bottom-20 duration-500 max-h-[90vh] overflow-y-auto">
                        <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden"></div>
                        
                        <div className="mb-8">
                            <h2 className="text-2xl font-black text-slate-900 mb-2">Finalizar Parada</h2>
                            <p className="text-slate-500 font-bold uppercase text-xs tracking-widest">{selectedStop.name}</p>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">Comentarios Rápidos</label>
                                <div className="flex flex-wrap gap-2">
                                    {PREDEFINED_COMMENTS.map(c => (
                                        <button
                                            key={c}
                                            onClick={() => {
                                                if (observations.includes(c)) {
                                                    setObservations(observations.replace(c, '').trim());
                                                } else {
                                                    setObservations(prev => prev ? `${prev}, ${c}` : c);
                                                }
                                                // If it's closed or absent, auto-set failed reason
                                                if (c === 'Local Cerrado' || c === 'Cliente Ausente') {
                                                    setFailedReason(c.toUpperCase());
                                                }
                                            }}
                                            className={clsx(
                                                "px-4 py-2 rounded-2xl border text-[11px] font-black uppercase transition-all",
                                                observations.includes(c) ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                                            )}
                                        >
                                            {c}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="relative">
                                <MessageSquare className="absolute left-5 top-5 text-slate-300 w-5 h-5" />
                                <textarea 
                                    placeholder="Observaciones adicionales..."
                                    value={observations}
                                    onChange={(e) => setObservations(e.target.value)}
                                    className="w-full bg-slate-50 border-none rounded-[32px] p-6 pl-14 text-sm font-medium focus:ring-4 focus:ring-blue-50 transition-all min-h-[100px] sm:min-h-[120px]"
                                ></textarea>
                            </div>

                            <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-3xl border border-dashed border-slate-200">
                                <label className="flex-1 flex items-center justify-center gap-2 bg-white text-slate-600 py-3 rounded-2xl font-black text-[11px] uppercase tracking-wider shadow-sm cursor-pointer active:scale-95 transition-all">
                                    {isUploadingPhoto ? <Loader2 size={16} className="animate-spin text-blue-500" /> : <Camera size={16} className="text-blue-500" />}
                                    {photoUrl ? 'Foto Subida' : 'Añadir Fotografía'}
                                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} disabled={isUploadingPhoto} />
                                </label>
                                {photoUrl && (
                                    <div className="w-12 h-12 rounded-xl bg-cover bg-center border-2 border-slate-200" style={{ backgroundImage: `url(${photoUrl})` }}></div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 gap-4 pt-4">
                                <button 
                                    onClick={() => handleMarkDeparture('COMPLETED')}
                                    className="bg-emerald-500 text-white py-5 rounded-[32px] font-black text-sm uppercase tracking-[0.2em] shadow-2xl shadow-emerald-200 active:scale-95 transition-all"
                                >Entregado Correctamente</button>
                                
                                <button 
                                    onClick={() => handleMarkDeparture('FAILED')}
                                    className="bg-red-50 text-red-600 py-5 rounded-[32px] font-black text-sm uppercase tracking-[0.2em] active:scale-95 transition-all"
                                >Informar Error de Entrega</button>

                                <button 
                                    onClick={() => { setIsReporting(false); setSelectedStop(null); }}
                                    className="text-slate-400 font-black text-[10px] uppercase tracking-widest pt-4"
                                >Volver a la Lista</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DriverPortal;
