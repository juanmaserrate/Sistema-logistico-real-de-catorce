
import { useState, useEffect } from 'react';
import {
    UserPlus,
    Trash2,
    Lock,
    Unlock,
    RefreshCw,
    User
} from 'lucide-react';

interface Driver {
    id: string;
    username: string;
    fullName: string;
    role: 'DRIVER' | 'ADMIN';
    createdAt: string;
    blocked?: boolean;
}

const defaultForm = {
    fullName: '',
    username: '',
    password: '',
    role: 'DRIVER' as 'DRIVER' | 'ADMIN'
};

const DriversManager = () => {
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(defaultForm);
    const [formError, setFormError] = useState('');
    const [creating, setCreating] = useState(false);

    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [actionError, setActionError] = useState('');

    useEffect(() => {
        fetchDrivers();
    }, []);

    const fetchDrivers = async () => {
        setLoading(true);
        setLoadError('');
        try {
            const res = await fetch('/api/v1/users');
            if (!res.ok) throw new Error(`Error ${res.status}`);
            const data = await res.json();
            setDrivers(Array.isArray(data) ? data : []);
        } catch {
            setLoadError('No se pudo cargar la lista de choferes. ¿Está encendido el servidor?');
            setDrivers([]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        if (!form.fullName.trim()) {
            setFormError('El nombre completo es obligatorio.');
            return;
        }
        if (!form.username.trim()) {
            setFormError('El nombre de usuario es obligatorio.');
            return;
        }
        if (form.password.length < 4) {
            setFormError('La contraseña debe tener al menos 4 caracteres.');
            return;
        }

        setCreating(true);
        try {
            const res = await fetch('/api/v1/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fullName: form.fullName.trim(),
                    username: form.username.trim(),
                    password: form.password,
                    role: form.role,
                    tenantId: 'default-tenant'
                })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setShowForm(false);
                setForm(defaultForm);
                fetchDrivers();
            } else {
                const msg = (data as { error?: string; message?: string }).error
                    || (data as { error?: string; message?: string }).message
                    || `Error ${res.status}: no se pudo crear el chofer.`;
                setFormError(msg);
            }
        } catch {
            setFormError('No hay conexión con el servidor. ¿Está encendido el backend?');
        } finally {
            setCreating(false);
        }
    };

    const handleToggleBlock = async (driver: Driver) => {
        setActionLoadingId(driver.id);
        setActionError('');
        const newBlocked = !driver.blocked;
        try {
            const res = await fetch(`/api/v1/users/${driver.id}/block`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blocked: newBlocked })
            });
            if (res.ok) {
                setDrivers(prev =>
                    prev.map(d => d.id === driver.id ? { ...d, blocked: newBlocked } : d)
                );
            } else {
                const data = await res.json().catch(() => ({}));
                const msg = (data as { error?: string; message?: string }).error
                    || (data as { error?: string; message?: string }).message
                    || `Error ${res.status} al ${newBlocked ? 'bloquear' : 'desbloquear'}.`;
                setActionError(msg);
            }
        } catch {
            setActionError('No se pudo conectar con el servidor para cambiar el estado.');
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleDelete = async (driver: Driver) => {
        if (!window.confirm(`¿Seguro que querés eliminar a "${driver.fullName}"? Esta acción no se puede deshacer.`)) return;
        setActionLoadingId(driver.id);
        setActionError('');
        try {
            const res = await fetch(`/api/v1/users/${driver.id}`, { method: 'DELETE' });
            if (res.ok) {
                setDrivers(prev => prev.filter(d => d.id !== driver.id));
            } else {
                const data = await res.json().catch(() => ({}));
                const msg = (data as { error?: string; message?: string }).error
                    || (data as { error?: string; message?: string }).message
                    || `Error ${res.status}: no se pudo eliminar.`;
                setActionError(msg);
            }
        } catch {
            setActionError('No se pudo conectar con el servidor para eliminar el chofer.');
        } finally {
            setActionLoadingId(null);
        }
    };

    const cancelForm = () => {
        setShowForm(false);
        setForm(defaultForm);
        setFormError('');
    };

    return (
        <div className="space-y-6 animate-fade-in">

            {/* Cabecera */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-[22px] font-bold text-[#1C1C1E]">Choferes</h2>
                    <p className="text-[14px] text-[#8E8E93] mt-0.5">
                        {loading ? 'Cargando...' : `${drivers.length} ${drivers.length === 1 ? 'chofer registrado' : 'choferes registrados'}`}
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={fetchDrivers}
                        disabled={loading}
                        className="p-3 bg-white border border-[#E5E7EB] rounded-2xl text-[#8E8E93] hover:text-[#1C1C1E] hover:shadow-sm transition-all disabled:opacity-50"
                        title="Actualizar lista"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => { setShowForm(true); setFormError(''); }}
                        className="bg-[#007AFF] text-white px-5 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-md shadow-[#007AFF]/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                        <UserPlus size={18} />
                        Nuevo Chofer
                    </button>
                </div>
            </div>

            {/* Formulario de creación inline */}
            {showForm && (
                <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-6 animate-fade-in">
                    <h3 className="text-[17px] font-bold text-[#1C1C1E] mb-5">Registrar nuevo chofer</h3>
                    <form onSubmit={handleCreate} className="space-y-4">
                        {formError && (
                            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-medium px-4 py-3">
                                {formError}
                            </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider mb-1.5 block">
                                    Nombre completo
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Juan Pérez"
                                    value={form.fullName}
                                    onChange={e => setForm({ ...form, fullName: e.target.value })}
                                    className="apple-input w-full"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider mb-1.5 block">
                                    Usuario
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="jperez"
                                    value={form.username}
                                    onChange={e => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
                                    className="apple-input w-full"
                                />
                            </div>
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider mb-1.5 block">
                                    Contraseña
                                </label>
                                <input
                                    type="password"
                                    required
                                    placeholder="Mínimo 4 caracteres"
                                    value={form.password}
                                    onChange={e => setForm({ ...form, password: e.target.value })}
                                    className="apple-input w-full"
                                />
                            </div>
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider mb-1.5 block">
                                    Rol
                                </label>
                                <select
                                    value={form.role}
                                    onChange={e => setForm({ ...form, role: e.target.value as 'DRIVER' | 'ADMIN' })}
                                    className="apple-input w-full"
                                >
                                    <option value="DRIVER">Chofer</option>
                                    <option value="ADMIN">Administrador</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={cancelForm}
                                className="apple-button-secondary flex-1 py-3"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={creating}
                                className="apple-button flex-1 py-3 flex items-center justify-center gap-2 disabled:opacity-60"
                            >
                                {creating ? (
                                    <>
                                        <RefreshCw size={16} className="animate-spin" />
                                        Creando...
                                    </>
                                ) : (
                                    <>
                                        <UserPlus size={16} />
                                        Crear chofer
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Error de acción global */}
            {actionError && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-medium px-4 py-3 flex justify-between items-center">
                    <span>{actionError}</span>
                    <button onClick={() => setActionError('')} className="ml-4 text-red-400 hover:text-red-600 font-bold text-lg leading-none">×</button>
                </div>
            )}

            {/* Estado de carga */}
            {loading && (
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-12 text-center">
                    <RefreshCw className="mx-auto text-[#007AFF] animate-spin mb-4" size={32} />
                    <p className="text-[#8E8E93] font-medium">Cargando choferes...</p>
                </div>
            )}

            {/* Error de carga */}
            {!loading && loadError && (
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-12 text-center">
                    <p className="text-red-500 font-semibold mb-2">{loadError}</p>
                    <button
                        onClick={fetchDrivers}
                        className="text-[#007AFF] font-semibold text-[14px] underline underline-offset-2"
                    >
                        Reintentar
                    </button>
                </div>
            )}

            {/* Lista vacía */}
            {!loading && !loadError && drivers.length === 0 && (
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-12 text-center">
                    <User className="mx-auto text-[#AEAEB2] mb-4" size={48} />
                    <p className="text-[#8E8E93] font-medium">No hay choferes registrados.</p>
                    <p className="text-[#AEAEB2] text-[13px] mt-1">Hacé click en "Nuevo Chofer" para agregar uno.</p>
                </div>
            )}

            {/* Tabla de choferes */}
            {!loading && !loadError && drivers.length > 0 && (
                <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-[#E5E7EB] bg-[#F8F9FB]">
                                <th className="px-6 py-4 text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider">
                                    Nombre
                                </th>
                                <th className="px-6 py-4 text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider">
                                    Usuario
                                </th>
                                <th className="px-6 py-4 text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider">
                                    Rol
                                </th>
                                <th className="px-6 py-4 text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider">
                                    Estado
                                </th>
                                <th className="px-6 py-4 text-[11px] font-bold text-[#8E8E93] uppercase tracking-wider text-right">
                                    Acciones
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {drivers.map((driver, idx) => {
                                const isLast = idx === drivers.length - 1;
                                const isLoading = actionLoadingId === driver.id;
                                const blocked = driver.blocked === true;

                                return (
                                    <tr
                                        key={driver.id}
                                        className={`${!isLast ? 'border-b border-[#F2F2F7]' : ''} hover:bg-[#F8F9FB] transition-colors`}
                                    >
                                        {/* Nombre */}
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-[#F2F2F7] flex items-center justify-center shrink-0">
                                                    <User size={16} className="text-[#8E8E93]" />
                                                </div>
                                                <div>
                                                    <p className="text-[14px] font-semibold text-[#1C1C1E] leading-tight">
                                                        {driver.fullName}
                                                    </p>
                                                    <p className="text-[11px] text-[#AEAEB2] mt-0.5">
                                                        ID: {driver.id.slice(0, 8)}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Username */}
                                        <td className="px-6 py-4">
                                            <span className="text-[13px] font-mono text-[#1C1C1E] bg-[#F2F2F7] px-2.5 py-1 rounded-lg">
                                                {driver.username}
                                            </span>
                                        </td>

                                        {/* Rol */}
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-tight
                                                ${driver.role === 'ADMIN'
                                                    ? 'bg-purple-50 text-purple-600'
                                                    : 'bg-blue-50 text-[#007AFF]'
                                                }`}>
                                                {driver.role === 'ADMIN' ? 'Admin' : 'Chofer'}
                                            </span>
                                        </td>

                                        {/* Estado */}
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-tight
                                                ${blocked
                                                    ? 'bg-red-50 text-red-500'
                                                    : 'bg-green-50 text-green-600'
                                                }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${blocked ? 'bg-red-400' : 'bg-green-500'}`} />
                                                {blocked ? 'Bloqueado' : 'Activo'}
                                            </span>
                                        </td>

                                        {/* Acciones */}
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-end gap-2">
                                                {/* Bloquear / Desbloquear */}
                                                <button
                                                    onClick={() => handleToggleBlock(driver)}
                                                    disabled={isLoading}
                                                    title={blocked ? 'Desbloquear chofer' : 'Bloquear chofer'}
                                                    className={`p-2 rounded-xl transition-all disabled:opacity-40
                                                        ${blocked
                                                            ? 'bg-green-50 text-green-600 hover:bg-green-100'
                                                            : 'bg-orange-50 text-orange-500 hover:bg-orange-100'
                                                        }`}
                                                >
                                                    {isLoading
                                                        ? <RefreshCw size={16} className="animate-spin" />
                                                        : blocked
                                                            ? <Unlock size={16} />
                                                            : <Lock size={16} />
                                                    }
                                                </button>

                                                {/* Eliminar */}
                                                <button
                                                    onClick={() => handleDelete(driver)}
                                                    disabled={isLoading}
                                                    title="Eliminar chofer"
                                                    className="p-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-all disabled:opacity-40"
                                                >
                                                    {isLoading
                                                        ? <RefreshCw size={16} className="animate-spin" />
                                                        : <Trash2 size={16} />
                                                    }
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default DriversManager;
