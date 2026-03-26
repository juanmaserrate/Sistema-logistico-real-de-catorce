import { useState, useEffect, useRef } from 'react';
import { MapPin, Send, AlertCircle } from 'lucide-react';
import { API_BASE } from '../config';

export default function ShareLocationPage() {
    const [label, setLabel] = useState('');
    const [status, setStatus] = useState<'idle' | 'requesting' | 'sending' | 'ok' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [lastSent, setLastSent] = useState<Date | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const deviceId = (() => {
        let id = localStorage.getItem('tracking_device_id');
        if (!id) {
            id = 'device_' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem('tracking_device_id', id);
        }
        return id;
    })();

    const sendPosition = (position: GeolocationPosition) => {
        setStatus('sending');
        const body = {
            deviceId,
            deviceLabel: label.trim() || null,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? null
        };
        fetch(`${API_BASE}/api/v1/tracking/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then((res) => {
                if (res.ok) {
                    setStatus('ok');
                    setLastSent(new Date());
                    setMessage('');
                } else {
                    return res.json().then((err) => {
                        throw new Error(err?.error || 'Error del servidor');
                    });
                }
            })
            .catch((e) => {
                setStatus('error');
                setMessage(e?.message || 'No se pudo enviar la ubicación');
            });
    };

    const startTracking = () => {
        if (!navigator.geolocation) {
            setStatus('error');
            setMessage('Tu navegador no soporta geolocalización.');
            return;
        }
        setStatus('requesting');
        setMessage('Solicitando acceso a la ubicación...');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                sendPosition(position);
                setMessage('Ubicación enviada. Se actualizará cada 30 segundos.');
                intervalRef.current = setInterval(() => {
                    navigator.geolocation.getCurrentPosition(sendPosition, () => {
                        setStatus('error');
                        setMessage('No se pudo obtener la ubicación.');
                    });
                }, 30000);
            },
            (err) => {
                setStatus('error');
                setMessage(err.message === 'User denied Geolocation' ? 'Debés permitir la ubicación para que funcione el rastreo.' : err.message);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    };

    useEffect(() => {
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    return (
        <div className="min-h-screen bg-[#F8F9FB] flex flex-col items-center justify-center p-6 font-sans">
            <div className="bg-white rounded-[32px] border border-[#E5E7EB] shadow-lg w-full max-w-md p-8 text-center">
                <div className="bg-[#007AFF]/10 p-4 rounded-2xl inline-block mb-6">
                    <MapPin className="text-[#007AFF]" size={48} />
                </div>
                <h1 className="text-[22px] font-bold text-[#1C1C1E] mb-2">Compartir mi ubicación</h1>
                <p className="text-[14px] text-[#8E8E93] font-medium mb-6">
                    Esta página envía tu posición al sistema de rastreo cada 30 segundos. Dejala abierta en el teléfono.
                </p>

                <div className="mb-6 text-left">
                    <label className="block text-[12px] font-bold text-[#8E8E93] uppercase tracking-wider mb-2">Tu nombre o identificación (opcional)</label>
                    <input
                        type="text"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Ej. Chofer Juan, Repartidor 1"
                        className="w-full bg-[#F2F2F7] border-none rounded-2xl px-4 py-3 text-[15px] font-medium text-[#1C1C1E] focus:ring-2 focus:ring-[#007AFF]"
                    />
                </div>

                {message && (
                    <div className={`mb-6 p-4 rounded-2xl flex items-center gap-3 ${status === 'error' ? 'bg-red-50 text-red-700' : 'bg-[#E8F5E9] text-green-800'}`}>
                        {status === 'error' && <AlertCircle size={20} />}
                        <span className="text-sm font-medium">{message}</span>
                    </div>
                )}

                {lastSent && status === 'ok' && (
                    <p className="text-[12px] text-[#8E8E93] font-medium mb-4">
                        Última actualización: {lastSent.toLocaleTimeString('es-AR')}
                    </p>
                )}

                <button
                    type="button"
                    onClick={startTracking}
                    disabled={status === 'requesting' || status === 'sending'}
                    className="w-full flex items-center justify-center gap-2 bg-[#007AFF] text-white py-4 rounded-2xl font-bold text-[16px] hover:opacity-90 disabled:opacity-70 transition-all"
                >
                    {(status === 'requesting' || status === 'sending') ? (
                        <>Enviando...</>
                    ) : (
                        <>
                            <Send size={20} />
                            {intervalRef.current ? 'Enviando cada 30 s' : 'Comenzar a enviar ubicación'}
                        </>
                    )}
                </button>

                <p className="text-[11px] text-[#AEAEB2] font-medium mt-6">
                    ID de dispositivo: {deviceId}
                </p>

                <div className="mt-6 p-4 bg-[#E8F5E9] border border-green-200 rounded-2xl text-left">
                    <p className="text-[12px] font-bold text-green-800 uppercase tracking-wider mb-1">Para choferes con datos móviles</p>
                    <p className="text-[13px] text-green-900 mb-2">
                        Los choferes deben abrir esta página en el celular con <strong>datos móviles o WiFi</strong>. No uses <code className="bg-green-100 px-1 rounded">localhost</code> en el teléfono.
                    </p>
                    <p className="text-[13px] text-green-900">
                        <strong>URL para compartir con choferes:</strong>
                    </p>
                    <a
                        href="https://uropygial-conservational-joy.ngrok-free.dev/ubicacion"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block break-all text-[14px] font-bold text-[#007AFF] underline"
                    >
                        https://uropygial-conservational-joy.ngrok-free.dev/ubicacion
                    </a>
                    <p className="text-[12px] text-green-700 mt-2">
                        Para que funcione, en la oficina deben estar corriendo: (1) servidor backend, (2) frontend (Vite), (3) túnel ngrok apuntando al frontend.
                    </p>
                </div>
            </div>
        </div>
    );
}
