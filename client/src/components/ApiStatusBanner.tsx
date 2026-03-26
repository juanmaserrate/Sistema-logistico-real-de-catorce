import { useState, useEffect, useCallback } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { checkApiHealth } from '../utils/apiStatus';

const CHECK_INTERVAL_MS = 15000;
const RETRY_AFTER_OFFLINE_MS = 5000;

export default function ApiStatusBanner() {
    const [isOnline, setIsOnline] = useState<boolean | null>(null);

    const check = useCallback(async () => {
        const ok = await checkApiHealth();
        setIsOnline(ok);
        return ok;
    }, []);

    useEffect(() => {
        check();
        const interval = setInterval(check, CHECK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [check]);

    // Cuando detectamos offline, reintentar antes del siguiente intervalo
    useEffect(() => {
        if (isOnline === false) {
            const t = setTimeout(check, RETRY_AFTER_OFFLINE_MS);
            return () => clearTimeout(t);
        }
    }, [isOnline, check]);

    if (isOnline !== false) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white px-4 py-2.5 flex items-center justify-center gap-3 shadow-lg">
            <WifiOff size={20} />
            <span className="font-semibold text-sm">
                API no disponible. Comprueba que el servidor esté encendido (puerto 3002).
            </span>
            <button
                type="button"
                onClick={() => check()}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            >
                <RefreshCw size={16} />
                Reintentar
            </button>
        </div>
    );
}
