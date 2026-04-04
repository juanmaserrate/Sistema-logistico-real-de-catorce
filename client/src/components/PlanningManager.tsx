import { useState, useEffect } from 'react';
import { Calendar, User, Truck, MapPin, Plus, Trash2, Loader2, ChevronDown, Copy, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

interface Client {
    id: string;
    name: string;
    address?: string | null;
    zone?: string | null;
}

interface Stop {
    id: number;
    sequence: number;
    status: string;
    client: Client;
}

interface Route {
    id: number;
    date: string;
    status: string;
    driverId: string | null;
    driver?: { fullName: string; username: string } | null;
    vehicle?: { plate: string } | null;
    stops: Stop[];
}

interface Driver {
    id: string;
    fullName: string;
    username: string;
}

const STATUS_LABEL: Record<string, string> = {
    PENDING: 'Pendiente',
    IN_PROGRESS: 'En curso',
    COMPLETED: 'Completada',
};

const STATUS_CLASS: Record<string, string> = {
    PENDING: 'bg-[#E5E7EB] text-[#636366]',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
};

const PlanningManager = () => {
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [routes, setRoutes] = useState<Route[]>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [driverName, setDriverName] = useState('');
    const [vehicleId, setVehicleId] = useState('');
    const [stops, setStops] = useState<{ clientId: string; clientName: string }[]>([]);
    const [clientSearch, setClientSearch] = useState('');
    const [searchResults, setSearchResults] = useState<Client[]>([]);
    const [auxiliar, setAuxiliar] = useState('');
    const [expandedRouteId, setExpandedRouteId] = useState<number | null>(null);

    const fetchRoutes = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/v1/routes?date=${date}`);
            if (!res.ok) throw new Error('Error al cargar rutas');
            const data = await res.json();
            setRoutes(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRoutes();
    }, [date]);

    useEffect(() => {
        fetch('/api/v1/drivers')
            .then((r) => r.json())
            .then(setDrivers)
            .catch(() => setDrivers([]));
        fetch('/api/v1/clients')
            .then((r) => r.json())
            .then(setClients)
            .catch(() => setClients([]));
    }, []);

    useEffect(() => {
        if (!clientSearch.trim()) {
            setSearchResults([]);
            return;
        }
        const q = clientSearch.toLowerCase();
        const filtered = clients.filter(
            (c) =>
                c.name.toLowerCase().includes(q) ||
                (c.address && c.address.toLowerCase().includes(q)) ||
                (c.zone && c.zone.toLowerCase().includes(q))
        );
        setSearchResults(filtered.slice(0, 8));
    }, [clientSearch, clients]);

    const addStop = (c: Client) => {
        if (stops.some((s) => s.clientId === c.id)) return;
        setStops((prev) => [...prev, { clientId: c.id, clientName: c.name }]);
        setClientSearch('');
        setSearchResults([]);
    };

    const removeStop = (index: number) => {
        setStops((prev) => prev.filter((_, i) => i !== index));
    };

    const moveStop = (index: number, dir: 'up' | 'down') => {
        setStops((prev) => {
            const next = [...prev];
            const j = dir === 'up' ? index - 1 : index + 1;
            if (j < 0 || j >= next.length) return prev;
            [next[index], next[j]] = [next[j], next[index]];
            return next;
        });
    };

    const handleDeleteRoute = async (r: Route) => {
        const driverLabel = r.driver?.fullName || r.driver?.username || 'esta ruta';
        if (!confirm(`¿Eliminar ruta de ${driverLabel}? Esta acción no se puede deshacer.`)) return;
        try {
            const res = await fetch(`/api/v1/routes/${r.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('No se pudo eliminar la ruta');
            fetchRoutes();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error al eliminar');
        }
    };

    const handleDuplicateRoute = async (r: Route) => {
        const newDate = prompt('Fecha para la copia (YYYY-MM-DD):', date);
        if (!newDate) return;
        try {
            const res = await fetch('/api/v1/routes-direct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: newDate,
                    driverName: r.driver?.fullName || r.driver?.username || '',
                    vehicleId: r.vehicle?.plate || undefined,
                    stops: r.stops.map((s, i) => ({ clientId: s.client.id, sequence: i + 1 })),
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data?.error || 'Error al duplicar la ruta');
            }
            fetchRoutes();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error al duplicar');
        }
    };

    const handleExportExcel = () => {
        if (routes.length === 0) {
            setError('No hay rutas para exportar.');
            return;
        }
        const rows = routes.map((r) => ({
            Chofer: r.driver?.fullName || r.driver?.username || 'Sin chofer',
            Vehículo: r.vehicle?.plate || '-',
            Paradas: r.stops.map((s) => s.client.name).join(', '),
            Estado: STATUS_LABEL[r.status] ?? r.status,
            Fecha: r.date,
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Rutas');
        XLSX.writeFile(wb, `rutas_${date}.xlsx`);
    };

    const handleCreateRoute = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!driverName.trim()) {
            setError('Seleccioná un chofer.');
            return;
        }
        if (stops.length === 0) {
            setError('Agregá al menos una parada.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const res = await fetch('/api/v1/routes-direct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: new Date(date).toISOString().slice(0, 10),
                    driverName: driverName.trim(),
                    vehicleId: vehicleId.trim() || undefined,
                    notes: auxiliar.trim() ? `Auxiliar: ${auxiliar.trim()}` : undefined,
                    stops: stops.map((s, i) => ({ clientId: s.clientId, sequence: i + 1 })),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || data?.details || 'Error al crear la ruta');
            setShowForm(false);
            setDriverName('');
            setVehicleId('');
            setAuxiliar('');
            setStops([]);
            fetchRoutes();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between">
                    <span className="text-sm font-medium">{error}</span>
                    <button type="button" onClick={() => setError('')} className="text-red-800 font-bold text-sm underline">
                        Cerrar
                    </button>
                </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <label className="text-sm font-semibold text-[#1C1C1E]">Fecha</label>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="rounded-xl border border-[#E5E7EB] px-3 py-2 text-[#1C1C1E] bg-white"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleExportExcel}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E5E7EB] text-[#1C1C1E] font-semibold text-sm hover:bg-[#F2F2F7]"
                    >
                        <Download className="w-4 h-4" />
                        Exportar
                    </button>
                    <button
                        type="button"
                        onClick={() => { setShowForm(true); setError(''); }}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#007AFF] text-white font-semibold text-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Nueva ruta
                    </button>
                </div>
            </div>

            {showForm && (
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-[#1C1C1E] mb-4">Asignar ruta</h3>
                    <form onSubmit={handleCreateRoute} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-[#636366] mb-1">Chofer</label>
                                <select
                                    value={driverName}
                                    onChange={(e) => setDriverName(e.target.value)}
                                    className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2 text-[#1C1C1E] bg-[#F2F2F7]"
                                >
                                    <option value="">Seleccionar chofer</option>
                                    {drivers.map((d) => (
                                        <option key={d.id} value={d.fullName || d.username}>
                                            {d.fullName || d.username}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[#636366] mb-1">Patente / vehículo (opcional)</label>
                                <input
                                    type="text"
                                    placeholder="Ej. AB 123 CD"
                                    value={vehicleId}
                                    onChange={(e) => setVehicleId(e.target.value)}
                                    className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2 text-[#1C1C1E]"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-[#636366] mb-1">Auxiliar (opcional)</label>
                            <input
                                type="text"
                                placeholder="Nombre del auxiliar"
                                value={auxiliar}
                                onChange={(e) => setAuxiliar(e.target.value)}
                                className="w-full rounded-xl border border-[#E5E7EB] px-3 py-2 text-[#1C1C1E]"
                            />
                        </div>

                        <div className="relative">
                            <label className="block text-sm font-medium text-[#636366] mb-1">Paradas (orden de visita)</label>
                            <div className="relative mb-2">
                                <input
                                    type="text"
                                    placeholder="Buscar cliente por nombre, dirección o zona..."
                                    value={clientSearch}
                                    onChange={(e) => setClientSearch(e.target.value)}
                                    className="w-full rounded-xl border border-[#E5E7EB] pl-10 pr-3 py-2 text-[#1C1C1E]"
                                />
                                <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-[#8E8E93]" />
                            </div>
                            {searchResults.length > 0 && (
                                <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E5E7EB] rounded-xl shadow-lg max-h-60 overflow-auto">
                                    {searchResults.map((c) => (
                                        <li key={c.id}>
                                            <button
                                                type="button"
                                                onClick={() => addStop(c)}
                                                className="w-full text-left px-4 py-2.5 hover:bg-[#F2F2F7] border-b border-[#F2F2F7] last:border-0"
                                            >
                                                <span className="font-medium text-[#1C1C1E]">{c.name}</span>
                                                {c.address && <span className="block text-xs text-[#8E8E93]">{c.address}</span>}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <ul className="mt-2 space-y-1.5">
                                {stops.map((s, i) => (
                                    <li
                                        key={`${s.clientId}-${i}`}
                                        className="flex items-center gap-2 rounded-xl bg-[#F2F2F7] px-3 py-2"
                                    >
                                        <span className="text-[#8E8E93] font-mono text-sm w-6">{i + 1}.</span>
                                        <span className="flex-1 font-medium text-[#1C1C1E] truncate">{s.clientName}</span>
                                        <div className="flex items-center gap-1">
                                            <button type="button" onClick={() => moveStop(i, 'up')} disabled={i === 0} className="p-1 rounded hover:bg-[#E5E7EB] disabled:opacity-40" aria-label="Subir">
                                                <ChevronDown className="w-4 h-4 rotate-180" />
                                            </button>
                                            <button type="button" onClick={() => moveStop(i, 'down')} disabled={i === stops.length - 1} className="p-1 rounded hover:bg-[#E5E7EB] disabled:opacity-40" aria-label="Bajar">
                                                <ChevronDown className="w-4 h-4" />
                                            </button>
                                            <button type="button" onClick={() => removeStop(i)} className="p-1 rounded hover:bg-red-100 text-red-600" aria-label="Quitar">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="flex gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => { setShowForm(false); setError(''); }}
                                className="px-4 py-2.5 rounded-xl border border-[#E5E7EB] text-[#1C1C1E] font-medium"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-4 py-2.5 rounded-xl bg-[#007AFF] text-white font-medium disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                Crear ruta
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
                <div className="px-6 py-4 border-b border-[#E5E7EB]">
                    <h2 className="text-lg font-bold text-[#1C1C1E]">Rutas del día</h2>
                    <p className="text-sm text-[#8E8E93]">Estas rutas aparecen en la app de los choferes para la fecha seleccionada.</p>
                </div>
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-8 h-8 text-[#007AFF] animate-spin" />
                    </div>
                ) : routes.length === 0 ? (
                    <div className="px-6 py-12 text-center text-[#8E8E93]">
                        <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="font-medium text-[#1C1C1E]">No hay rutas para el {date}</p>
                        <p className="text-sm mt-1">Podés crear una nueva ruta con el botón de arriba, o probar con otra fecha.</p>
                        <div className="flex justify-center gap-3 mt-4">
                            <button
                                type="button"
                                onClick={() => { setShowForm(true); setError(''); }}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#007AFF] text-white font-medium text-sm"
                            >
                                <Plus className="w-4 h-4" />
                                Crear ruta
                            </button>
                            <button
                                type="button"
                                onClick={() => setDate(new Date().toISOString().slice(0, 10))}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#E5E7EB] text-[#1C1C1E] font-medium text-sm hover:bg-[#F2F2F7]"
                            >
                                <Calendar className="w-4 h-4" />
                                Ir a hoy
                            </button>
                        </div>
                    </div>
                ) : (
                    <ul className="divide-y divide-[#E5E7EB]">
                        {routes.map((r) => {
                            const isExpanded = expandedRouteId === r.id;
                            const statusLabel = STATUS_LABEL[r.status] ?? r.status;
                            const statusClass = STATUS_CLASS[r.status] ?? 'bg-[#E5E7EB] text-[#636366]';
                            return (
                                <li key={r.id} className="px-6 py-4 hover:bg-[#F8F9FB]">
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setExpandedRouteId(isExpanded ? null : r.id)}
                                            className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                            aria-label={isExpanded ? 'Contraer' : 'Expandir'}
                                        >
                                            <ChevronDown
                                                className={`w-4 h-4 text-[#8E8E93] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                            />
                                            <div className="flex items-center gap-2 min-w-0">
                                                <User className="w-4 h-4 text-[#007AFF] flex-shrink-0" />
                                                <span className="font-semibold text-[#1C1C1E] truncate">
                                                    {r.driver?.fullName || r.driver?.username || 'Sin chofer'}
                                                </span>
                                            </div>
                                            {r.vehicle?.plate && (
                                                <div className="flex items-center gap-1.5 text-[#8E8E93] text-sm flex-shrink-0">
                                                    <Truck className="w-4 h-4" />
                                                    {r.vehicle.plate}
                                                </div>
                                            )}
                                            <span className="text-sm text-[#8E8E93] flex-shrink-0">
                                                {r.stops.length} parada{r.stops.length !== 1 ? 's' : ''}
                                            </span>
                                            <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${statusClass}`}>
                                                {statusLabel}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDuplicateRoute(r)}
                                            className="p-1.5 rounded-lg hover:bg-blue-50 text-[#8E8E93] hover:text-blue-600 transition-colors flex-shrink-0"
                                            aria-label="Duplicar ruta"
                                            title="Duplicar ruta"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteRoute(r)}
                                            className="p-1.5 rounded-lg hover:bg-red-50 text-[#8E8E93] hover:text-red-600 transition-colors flex-shrink-0"
                                            aria-label="Eliminar ruta"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    {isExpanded && (
                                        <ul className="mt-3 pl-7 text-sm text-[#8E8E93] space-y-1">
                                            {r.stops.map((s) => (
                                                <li key={s.id} className="flex items-start gap-2">
                                                    <span className="font-mono text-xs w-5 flex-shrink-0 pt-0.5">{s.sequence}.</span>
                                                    <span className="text-[#1C1C1E] font-medium">{s.client.name}</span>
                                                    {s.client.address && (
                                                        <span className="text-[#8E8E93] text-xs truncate">{s.client.address}</span>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default PlanningManager;
