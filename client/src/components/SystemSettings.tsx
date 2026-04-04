
import { useState, useEffect } from 'react';
import {
    Shield,
    Save,
    Dna,
    Layers,
    Database,
    CheckCircle,
    Eye,
    EyeOff,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Types ────────────────────────────────────────────────────────────────────

type VrpSettings = {
    solverTimeLimit: number;
    matrixCache: boolean;
    strictWindows: boolean;
};

const DEFAULT_VRP: VrpSettings = {
    solverTimeLimit: 30,
    matrixCache: true,
    strictWindows: false,
};

// ─── Toggle subcomponent ──────────────────────────────────────────────────────

const Toggle = ({ value, onChange }: { value: boolean; onChange: () => void }) => (
    <button
        onClick={onChange}
        className={clsx(
            'w-14 h-8 rounded-full p-1 transition-all duration-300',
            value ? 'bg-[#34C759]' : 'bg-[#AEAEB2]'
        )}
    >
        <div
            className={clsx(
                'w-6 h-6 bg-white rounded-full shadow-sm transform transition-all',
                value ? 'translate-x-6' : 'translate-x-0'
            )}
        />
    </button>
);

// ─── SaveButton subcomponent ──────────────────────────────────────────────────

const SaveButton = ({
    saving,
    saved,
    onClick,
}: {
    saving: boolean;
    saved: boolean;
    onClick: () => void;
}) => (
    <div className="pt-8 border-t border-[#F2F2F7] flex items-center justify-end gap-4">
        {saved && (
            <span className="flex items-center gap-2 text-[#34C759] font-bold text-[13px]">
                <CheckCircle size={16} /> Guardado
            </span>
        )}
        <button
            onClick={onClick}
            disabled={saving}
            className="apple-button px-8 flex items-center gap-2 disabled:opacity-60"
        >
            <Save size={18} />
            {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
    </div>
);

// ─── Section: General ─────────────────────────────────────────────────────────

const GeneralSection = () => {
    const [systemName, setSystemName] = useState('R14 Logística');
    const [timezone, setTimezone] = useState('America/Argentina/Buenos_Aires');
    const [mapRefresh, setMapRefresh] = useState(30);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const fetchSetting = async (key: string) => {
            try {
                const r = await fetch(`/api/v1/settings/${key}`);
                if (r.ok) {
                    const data = await r.json();
                    return data?.value ?? null;
                }
            } catch { /* usar default */ }
            return null;
        };

        Promise.all([
            fetchSetting('system_name'),
            fetchSetting('timezone'),
            fetchSetting('map_refresh_interval'),
        ]).then(([name, tz, refresh]) => {
            if (name) setSystemName(name);
            if (tz) setTimezone(tz);
            if (refresh) setMapRefresh(parseInt(refresh) || 30);
        }).finally(() => setLoading(false));
    }, []);

    const postSetting = (key: string, value: string) =>
        fetch('/api/v1/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value }),
        });

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        try {
            await Promise.all([
                postSetting('system_name', systemName),
                postSetting('timezone', timezone),
                postSetting('map_refresh_interval', String(mapRefresh)),
            ]);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch { /* silencioso */ }
        finally { setSaving(false); }
    };

    if (loading) {
        return <p className="text-[#8E8E93] font-medium">Cargando configuración...</p>;
    }

    return (
        <div className="space-y-10">
            <div>
                <h3 className="text-[20px] font-bold text-[#1C1C1E] mb-2">General</h3>
                <p className="text-[14px] text-[#8E8E93] font-medium">
                    Configuración general del sistema.
                </p>
            </div>

            <div className="space-y-8">
                {/* Nombre del sistema */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">Nombre del sistema</p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Nombre que aparece en el encabezado de la aplicación.
                        </p>
                    </div>
                    <input
                        type="text"
                        className="apple-input w-56 text-right"
                        value={systemName}
                        onChange={e => setSystemName(e.target.value)}
                    />
                </div>

                {/* Zona horaria */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">Zona horaria</p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Zona horaria utilizada para mostrar fechas y horas.
                        </p>
                    </div>
                    <select
                        className="apple-input w-64"
                        value={timezone}
                        onChange={e => setTimezone(e.target.value)}
                    >
                        <option value="America/Argentina/Buenos_Aires">
                            América/Buenos Aires
                        </option>
                        <option value="America/Sao_Paulo">América/São Paulo</option>
                        <option value="UTC">UTC</option>
                    </select>
                </div>

                {/* Intervalo de actualización del mapa */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">
                            Intervalo de actualización del mapa (segundos)
                        </p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Cada cuántos segundos se refresca la posición de los vehículos.
                        </p>
                    </div>
                    <input
                        type="number"
                        min={5}
                        max={300}
                        className="apple-input w-24 text-center"
                        value={mapRefresh}
                        onChange={e => setMapRefresh(parseInt(e.target.value) || 30)}
                    />
                </div>

                <SaveButton saving={saving} saved={saved} onClick={handleSave} />
            </div>
        </div>
    );
};

// ─── Section: Motor VRP ───────────────────────────────────────────────────────

const VrpSection = () => {
    const [settings, setSettings] = useState<VrpSettings>(DEFAULT_VRP);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetch('/api/v1/settings/vrp_config')
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (data?.value) {
                    try {
                        setSettings({ ...DEFAULT_VRP, ...JSON.parse(data.value) });
                    } catch { /* usar default */ }
                }
            })
            .catch(() => { /* usar default */ })
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        try {
            await fetch('/api/v1/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'vrp_config', value: JSON.stringify(settings) }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch { /* silencioso */ }
        finally { setSaving(false); }
    };

    if (loading) {
        return <p className="text-[#8E8E93] font-medium">Cargando configuración...</p>;
    }

    return (
        <div className="space-y-10">
            <div>
                <h3 className="text-[20px] font-bold text-[#1C1C1E] mb-2">Motor VRP</h3>
                <p className="text-[14px] text-[#8E8E93] font-medium">
                    Parámetros del algoritmo de optimización de rutas.
                </p>
            </div>

            <div className="space-y-8">
                {/* Límite de tiempo */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">
                            Límite de Tiempo (segundos)
                        </p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Tiempo máximo que el solver dedicará a buscar la mejor ruta.
                        </p>
                    </div>
                    <input
                        type="number"
                        className="apple-input w-24 text-center"
                        value={settings.solverTimeLimit}
                        onChange={e =>
                            setSettings({ ...settings, solverTimeLimit: parseInt(e.target.value) || 30 })
                        }
                    />
                </div>

                {/* Caché de matrices */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">Caché de Matrices</p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Usar distancias guardadas para reducir carga de procesamiento.
                        </p>
                    </div>
                    <Toggle
                        value={settings.matrixCache}
                        onChange={() =>
                            setSettings({ ...settings, matrixCache: !settings.matrixCache })
                        }
                    />
                </div>

                {/* Ventanas horarias estrictas */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">
                            Ventanas Horarias Estrictas
                        </p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Si se activa, el solver descartará planes si una parada excede su ventana.
                        </p>
                    </div>
                    <Toggle
                        value={settings.strictWindows}
                        onChange={() =>
                            setSettings({ ...settings, strictWindows: !settings.strictWindows })
                        }
                    />
                </div>

                <SaveButton saving={saving} saved={saved} onClick={handleSave} />
            </div>
        </div>
    );
};

// ─── Section: Seguridad ───────────────────────────────────────────────────────

const SecuritySection = () => {
    const username = localStorage.getItem('username') || 'Admin';
    const userId = localStorage.getItem('userId') || '';

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

    const handleChangePassword = async () => {
        if (!newPassword || !confirmPassword) {
            setMessage({ text: 'Completá ambos campos.', ok: false });
            return;
        }
        if (newPassword !== confirmPassword) {
            setMessage({ text: 'Las contraseñas no coinciden.', ok: false });
            return;
        }
        if (newPassword.length < 6) {
            setMessage({ text: 'La contraseña debe tener al menos 6 caracteres.', ok: false });
            return;
        }

        setSaving(true);
        setMessage(null);
        try {
            const r = await fetch(`/api/v1/users/${userId}/password`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword }),
            });
            if (r.ok) {
                setMessage({ text: 'Contraseña actualizada correctamente.', ok: true });
                setNewPassword('');
                setConfirmPassword('');
                setTimeout(() => setMessage(null), 4000);
            } else {
                const err = await r.json().catch(() => ({}));
                setMessage({ text: err?.message || 'Error al cambiar la contraseña.', ok: false });
            }
        } catch {
            setMessage({ text: 'Error de conexión. Intentá de nuevo.', ok: false });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-10">
            <div>
                <h3 className="text-[20px] font-bold text-[#1C1C1E] mb-2">Seguridad</h3>
                <p className="text-[14px] text-[#8E8E93] font-medium">
                    Información de sesión y gestión de contraseña.
                </p>
            </div>

            <div className="space-y-8">
                {/* Sesión activa */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">Sesión activa</p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Usuario con sesión iniciada actualmente.
                        </p>
                    </div>
                    <span className="text-[15px] font-semibold text-[#1C1C1E] bg-[#F2F2F7] px-4 py-2 rounded-xl">
                        {username}
                    </span>
                </div>

                {/* Tiempo de sesión */}
                <div className="flex items-start justify-between gap-8">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">Tiempo de sesión</p>
                        <p className="text-[12px] text-[#8E8E93] font-medium mt-1 max-w-sm">
                            Las sesiones no expiran automáticamente. Cerrá sesión manualmente.
                        </p>
                    </div>
                </div>

                {/* Separador */}
                <div className="border-t border-[#F2F2F7]" />

                {/* Cambiar contraseña */}
                <div className="space-y-5">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">Cambiar contraseña</p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Ingresá y confirmá la nueva contraseña.
                        </p>
                    </div>

                    <div className="space-y-3 max-w-sm">
                        {/* Nueva contraseña */}
                        <div className="relative">
                            <input
                                type={showNew ? 'text' : 'password'}
                                placeholder="Nueva contraseña"
                                className="apple-input w-full pr-10"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNew(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93] hover:text-[#1C1C1E] transition-colors"
                            >
                                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>

                        {/* Confirmar contraseña */}
                        <div className="relative">
                            <input
                                type={showConfirm ? 'text' : 'password'}
                                placeholder="Confirmar contraseña"
                                className="apple-input w-full pr-10"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirm(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8E93] hover:text-[#1C1C1E] transition-colors"
                            >
                                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>

                        {message && (
                            <p
                                className={clsx(
                                    'text-[13px] font-medium',
                                    message.ok ? 'text-[#34C759]' : 'text-[#FF3B30]'
                                )}
                            >
                                {message.ok && <CheckCircle size={13} className="inline mr-1" />}
                                {message.text}
                            </p>
                        )}

                        <button
                            onClick={handleChangePassword}
                            disabled={saving}
                            className="apple-button px-6 flex items-center gap-2 disabled:opacity-60"
                        >
                            <Save size={16} />
                            {saving ? 'Guardando...' : 'Cambiar contraseña'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Section: Base de Datos ───────────────────────────────────────────────────

const DatabaseSection = () => {
    const [checking, setChecking] = useState(false);
    const [dbStatus, setDbStatus] = useState<'idle' | 'ok' | 'error'>('idle');

    const handleCheck = async () => {
        setChecking(true);
        setDbStatus('idle');
        try {
            const r = await fetch('/api/health');
            setDbStatus(r.ok ? 'ok' : 'error');
        } catch {
            setDbStatus('error');
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="space-y-10">
            <div>
                <h3 className="text-[20px] font-bold text-[#1C1C1E] mb-2">Base de Datos</h3>
                <p className="text-[14px] text-[#8E8E93] font-medium">
                    Estado, respaldo e información técnica de la base de datos.
                </p>
            </div>

            <div className="space-y-8">
                {/* Estado de la base de datos */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[15px] font-bold text-[#1C1C1E]">
                            Estado de la base de datos
                        </p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Verificá que la conexión con la base de datos esté activa.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {dbStatus === 'ok' && (
                            <span className="flex items-center gap-1.5 text-[#34C759] font-bold text-[13px]">
                                <CheckCircle size={15} /> Conexión OK
                            </span>
                        )}
                        {dbStatus === 'error' && (
                            <span className="text-[#FF3B30] font-bold text-[13px]">
                                Error de conexión
                            </span>
                        )}
                        <button
                            onClick={handleCheck}
                            disabled={checking}
                            className="apple-button px-5 flex items-center gap-2 disabled:opacity-60"
                        >
                            <Database size={16} />
                            {checking ? 'Verificando...' : 'Verificar conexión'}
                        </button>
                    </div>
                </div>

                {/* Separador */}
                <div className="border-t border-[#F2F2F7]" />

                {/* Respaldo */}
                <div>
                    <p className="text-[15px] font-bold text-[#1C1C1E]">Respaldo</p>
                    <p className="text-[12px] text-[#8E8E93] font-medium mt-1 max-w-lg">
                        Los respaldos se manejan automáticamente por Railway. Para exportar datos,
                        contactar al administrador del sistema.
                    </p>
                </div>

                {/* Separador */}
                <div className="border-t border-[#F2F2F7]" />

                {/* Información técnica */}
                <div>
                    <p className="text-[15px] font-bold text-[#1C1C1E] mb-4">
                        Información técnica
                    </p>
                    <div className="space-y-3">
                        {[
                            { label: 'Base de datos', value: 'PostgreSQL' },
                            { label: 'Servidor', value: 'Railway' },
                            { label: 'Versión del sistema', value: '3.0' },
                        ].map(row => (
                            <div key={row.label} className="flex items-center justify-between">
                                <p className="text-[13px] text-[#8E8E93] font-medium">{row.label}</p>
                                <span className="text-[13px] font-semibold text-[#1C1C1E] bg-[#F2F2F7] px-3 py-1 rounded-lg">
                                    {row.value}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Main component ───────────────────────────────────────────────────────────

const SystemSettings = () => {
    const sections = [
        { id: 'general', label: 'General', icon: Layers },
        { id: 'vrp', label: 'Motor VRP', icon: Dna },
        { id: 'security', label: 'Seguridad', icon: Shield },
        { id: 'db', label: 'Base de Datos', icon: Database },
    ];
    const [activeSection, setActiveSection] = useState('general');

    const renderSection = () => {
        switch (activeSection) {
            case 'general':   return <GeneralSection />;
            case 'vrp':       return <VrpSection />;
            case 'security':  return <SecuritySection />;
            case 'db':        return <DatabaseSection />;
            default:          return null;
        }
    };

    return (
        <div className="flex gap-10 animate-fade-in">
            {/* Sidebar */}
            <div className="w-64 space-y-2">
                {sections.map(s => (
                    <button
                        key={s.id}
                        onClick={() => setActiveSection(s.id)}
                        className={clsx(
                            'w-full flex items-center gap-3 px-5 py-3 rounded-2xl font-bold text-[14px] transition-all',
                            activeSection === s.id
                                ? 'bg-white shadow-sm text-[#007AFF]'
                                : 'text-[#8E8E93] hover:text-[#1C1C1E]'
                        )}
                    >
                        <s.icon size={18} />
                        {s.label}
                    </button>
                ))}
            </div>

            {/* Content card */}
            <div className="flex-1 bg-white p-10 rounded-[40px] border border-[#E5E7EB] shadow-sm">
                {renderSection()}
            </div>
        </div>
    );
};

export default SystemSettings;
