
import { useState, useEffect } from 'react';
import { 
    Plus, 
    Search, 
    School, 
    MapPin, 
    Clock, 
    MoreVertical,
    CheckCircle2
} from 'lucide-react';

const defaultNewClient = {
    name: '',
    address: '',
    latitude: -23.59,
    longitude: -67.85,
    timeWindowStart: '08:00',
    timeWindowEnd: '12:00',
    serviceTime: 15,
    zone: ''
};

const ClientManager = () => {
    const [clients, setClients] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedLocalidad, setSelectedLocalidad] = useState<string>('');
    const [selectedZona, setSelectedZona] = useState<string>('');
    const [showAdd, setShowAdd] = useState(false);
    const [editingClient, setEditingClient] = useState<any | null>(null);
    const [editForm, setEditForm] = useState(defaultNewClient);
    const [newClient, setNewClient] = useState(defaultNewClient);
    const [saveError, setSaveError] = useState('');

    useEffect(() => {
        fetchClients();
    }, []);

    const fetchClients = async () => {
        try {
            const res = await fetch('/api/v1/clients');
            setClients(await res.json());
        } catch (e) {
            console.error("Error loading clients", e);
            setClients([]);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaveError('');
        const st = typeof newClient.serviceTime === 'number' && Number.isFinite(newClient.serviceTime)
            ? newClient.serviceTime
            : parseInt(String(newClient.serviceTime), 10);
        const payload = {
            name: newClient.name.trim(),
            address: newClient.address?.trim() || null,
            latitude:
                typeof newClient.latitude === 'number' && Number.isFinite(newClient.latitude)
                    ? newClient.latitude
                    : null,
            longitude:
                typeof newClient.longitude === 'number' && Number.isFinite(newClient.longitude)
                    ? newClient.longitude
                    : null,
            timeWindowStart: newClient.timeWindowStart || null,
            timeWindowEnd: newClient.timeWindowEnd || null,
            serviceTime: Number.isFinite(st) && st > 0 ? st : 15,
            zone: newClient.zone?.trim() || null
        };
        if (!payload.name) {
            setSaveError('El nombre es obligatorio.');
            return;
        }
        try {
            const res = await fetch('/api/v1/clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setShowAdd(false);
                fetchClients();
                setNewClient(defaultNewClient);
            } else {
                setSaveError((data as { error?: string }).error || `Error ${res.status}: no se pudo guardar.`);
            }
        } catch {
            setSaveError('No hay conexión con el servidor. ¿Está encendido el backend?');
        }
    };

    const openEdit = (client: any) => {
        setEditingClient(client);
        setEditForm({
            name: client.name ?? '',
            address: client.address ?? '',
            latitude: client.latitude ?? -23.59,
            longitude: client.longitude ?? -67.85,
            timeWindowStart: client.timeWindowStart ?? '08:00',
            timeWindowEnd: client.timeWindowEnd ?? '12:00',
            serviceTime: client.serviceTime ?? 15,
            zone: client.zone ?? ''
        });
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingClient) return;
        try {
            const res = await fetch(`/api/v1/clients/${editingClient.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editForm)
            });
            if (res.ok) {
                setEditingClient(null);
                fetchClients();
            }
        } catch (e) {
            console.error("Error updating client", e);
        }
    };

    const localidades = [...new Set(clients.map((c) => (c.barrio ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const zonas = [...new Set(clients.map((c) => (c.zone ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

    const searchLower = searchTerm.trim().toLowerCase();
    let filteredClients = clients;
    if (selectedZona === '__SIN_ZONA__') {
        filteredClients = filteredClients.filter((c) => !(c.zone ?? '').trim());
    } else if (selectedZona) {
        filteredClients = filteredClients.filter((c) => (c.zone ?? '').trim() === selectedZona);
    }
    if (selectedLocalidad) {
        filteredClients = filteredClients.filter((c) => (c.barrio ?? '').trim() === selectedLocalidad);
    }
    if (searchLower) {
        filteredClients = filteredClients.filter((c) => {
            const name = (c.name ?? '').toLowerCase();
            const address = (c.address ?? '').toLowerCase();
            const zone = (c.zone ?? '').toLowerCase();
            const barrio = (c.barrio ?? '').toLowerCase();
            const id = (c.id ?? '').toLowerCase();
            return name.includes(searchLower) || address.includes(searchLower) || zone.includes(searchLower) || barrio.includes(searchLower) || id.includes(searchLower);
        });
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div className="relative group flex-1 max-w-md">
                     <Search className="absolute left-4 top-3.5 text-[#AEAEB2] group-focus-within:text-[#007AFF] transition-colors" size={18} />
                     <input 
                        type="text" 
                        placeholder="Buscar escuela, zona, barrio o código..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-white border-none rounded-2xl py-3.5 pl-12 pr-6 text-[15px] w-full shadow-sm focus:ring-2 focus:ring-[#007AFF] transition-all"
                     />
                </div>
                <div className="flex gap-3 items-center flex-wrap">
                    <select
                        value={selectedZona}
                        onChange={(e) => setSelectedZona(e.target.value)}
                        className="bg-white border border-[#E5E7EB] rounded-2xl py-3.5 px-4 text-[15px] text-[#1C1C1E] shadow-sm focus:ring-2 focus:ring-[#007AFF] focus:border-[#007AFF] transition-all min-w-[160px]"
                        aria-label="Filtrar por zona"
                    >
                        <option value="">Todas las zonas</option>
                        {zonas.map((z) => (
                            <option key={z} value={z}>{z}</option>
                        ))}
                        <option value="__SIN_ZONA__">Sin zona</option>
                    </select>
                    <select
                        value={selectedLocalidad}
                        onChange={(e) => setSelectedLocalidad(e.target.value)}
                        className="bg-white border border-[#E5E7EB] rounded-2xl py-3.5 px-4 text-[15px] text-[#1C1C1E] shadow-sm focus:ring-2 focus:ring-[#007AFF] focus:border-[#007AFF] transition-all min-w-[180px]"
                        aria-label="Filtrar por localidad / barrio"
                    >
                        <option value="">Todas las localidades</option>
                        {localidades.map((loc) => (
                            <option key={loc} value={loc}>{loc}</option>
                        ))}
                    </select>
                    <button 
                        onClick={() => setShowAdd(true)}
                        className="bg-black text-white px-6 py-3.5 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-black/5 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                        <Plus size={20} />
                        Nueva Escuela
                    </button>
                </div>
            </div>

            {filteredClients.length === 0 ? (
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-12 text-center">
                    <School className="mx-auto text-[#AEAEB2]" size={48} />
                    <p className="text-[#8E8E93] font-medium mt-4">
                        {searchTerm.trim()
                            ? `No hay escuelas o clientes que coincidan con "${searchTerm.trim()}".`
                            : selectedZona === '__SIN_ZONA__'
                                ? 'No hay clientes sin zona asignada.'
                                : selectedZona
                                    ? `No hay clientes en la zona "${selectedZona}".`
                                    : selectedLocalidad
                                        ? `No hay clientes en ${selectedLocalidad}.`
                                        : 'No hay clientes cargados.'}
                    </p>
                </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredClients.map(client => (
                    <div
                        key={client.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openEdit(client)}
                        onKeyDown={(e) => e.key === 'Enter' && openEdit(client)}
                        className="bg-white p-6 rounded-[32px] border border-[#E5E7EB] shadow-sm hover:shadow-md transition-all group cursor-pointer"
                    >
                        <div className="flex justify-between items-start mb-6">
                            <div className="bg-[#F2F2F7] p-3 rounded-2xl text-[#1C1C1E]">
                                <School size={24} />
                            </div>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openEdit(client); }}
                                className="p-2 text-[#AEAEB2] hover:bg-[#F2F2F7] rounded-full transition-colors opacity-0 group-hover:opacity-100"
                            >
                                <MoreVertical size={18} />
                            </button>
                        </div>

                        <h3 className="text-[18px] font-bold text-[#1C1C1E] mb-1">{client.name}</h3>
                        <p className="text-[13px] text-[#8E8E93] font-medium flex items-center gap-1.5 mb-2">
                            <MapPin size={14} className="shrink-0" />
                            <span className="truncate">{client.address || 'Capital Federal'}</span>
                        </p>
                        <p className="text-[12px] text-[#AEAEB2] font-medium mb-4">
                            {client.latitude != null && client.longitude != null
                                ? `Lat: ${Number(client.latitude).toFixed(5)}, Long: ${Number(client.longitude).toFixed(5)}`
                                : 'Sin coordenadas'}
                        </p>

                        <div className="grid grid-cols-2 gap-3 mb-6">
                            <div className="bg-[#F8F9FB] p-3 rounded-2xl">
                                <p className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <Clock size={10} /> Ventana
                                </p>
                                <p className="text-[13px] font-bold text-[#1C1C1E]">{client.timeWindowStart} - {client.timeWindowEnd}</p>
                            </div>
                            <div className="bg-[#F8F9FB] p-3 rounded-2xl">
                                <p className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <CheckCircle2 size={10} /> Servicio
                                </p>
                                <p className="text-[13px] font-bold text-[#1C1C1E]">{client.serviceTime} min</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                             <div className="px-3 py-1 bg-blue-50 text-[#007AFF] text-[11px] font-bold rounded-lg uppercase tracking-tight">
                                 {client.zone || 'GENERAL'}
                             </div>
                             <div className="text-[11px] text-[#AEAEB2] font-semibold ml-auto flex items-center gap-1">
                                 ID: {client.id.slice(0, 4)}
                             </div>
                        </div>
                    </div>
                ))}
            </div>
            )}

            {/* Edit Modal */}
            {editingClient && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setEditingClient(null)}>
                    <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-xl p-10 animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <h2 className="text-[24px] font-bold text-[#1C1C1E] mb-8">Editar Escuela / Cliente</h2>
                        <form onSubmit={handleUpdate} className="space-y-6">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="col-span-2">
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Nombre de la Institución</label>
                                    <input
                                        type="text"
                                        required
                                        className="apple-input w-full"
                                        placeholder="Escuela Nro 14"
                                        value={editForm.name}
                                        onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Dirección</label>
                                    <input
                                        type="text"
                                        required
                                        className="apple-input w-full"
                                        placeholder="Calle 123, CABA (se completa desde coordenadas si está vacío)"
                                        value={editForm.address}
                                        onChange={e => setEditForm({ ...editForm, address: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Latitud</label>
                                    <input
                                        type="number"
                                        step="any"
                                        className="apple-input w-full"
                                        placeholder="-34.6037"
                                        value={editForm.latitude == null ? '' : editForm.latitude}
                                        onChange={e => setEditForm({ ...editForm, latitude: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Longitud</label>
                                    <input
                                        type="number"
                                        step="any"
                                        className="apple-input w-full"
                                        placeholder="-58.3816"
                                        value={editForm.longitude == null ? '' : editForm.longitude}
                                        onChange={e => setEditForm({ ...editForm, longitude: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Inicio Recepción</label>
                                    <input
                                        type="time"
                                        className="apple-input w-full"
                                        value={editForm.timeWindowStart}
                                        onChange={e => setEditForm({ ...editForm, timeWindowStart: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Fin Recepción</label>
                                    <input
                                        type="time"
                                        className="apple-input w-full"
                                        value={editForm.timeWindowEnd}
                                        onChange={e => setEditForm({ ...editForm, timeWindowEnd: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Tipo de Zona</label>
                                    <input
                                        type="text"
                                        className="apple-input w-full"
                                        placeholder="Norte, Sur..."
                                        value={editForm.zone}
                                        onChange={e => setEditForm({ ...editForm, zone: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">T. Descarga (min)</label>
                                    <input
                                        type="number"
                                        className="apple-input w-full"
                                        value={editForm.serviceTime}
                                        onChange={e => setEditForm({ ...editForm, serviceTime: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-4 pt-6">
                                <button type="button" onClick={() => setEditingClient(null)} className="apple-button-secondary flex-1 py-4">Cancelar</button>
                                <button type="submit" className="apple-button flex-1 py-4">Guardar cambios</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Modal */}
            {showAdd && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
                    <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-xl p-10 animate-fade-in-up">
                        <h2 className="text-[24px] font-bold text-[#1C1C1E] mb-8">Registrar Nueva Escuela</h2>
                        
                        <form onSubmit={handleSave} className="space-y-6">
                            {saveError && (
                                <div className="rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium px-4 py-3">
                                    {saveError}
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-6">
                                <div className="col-span-2">
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Nombre de la Institución</label>
                                    <input 
                                        type="text" 
                                        required
                                        className="apple-input w-full"
                                        placeholder="Escuela Nro 14"
                                        value={newClient.name}
                                        onChange={e => setNewClient({...newClient, name: e.target.value})}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Dirección (opcional si hay GPS)</label>
                                    <input 
                                        type="text" 
                                        className="apple-input w-full"
                                        placeholder="Calle 123, CABA"
                                        value={newClient.address}
                                        onChange={e => setNewClient({...newClient, address: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Latitud</label>
                                    <input 
                                        type="number" 
                                        step="any"
                                        className="apple-input w-full"
                                        placeholder="-34.6037"
                                        value={newClient.latitude == null ? '' : newClient.latitude}
                                        onChange={e => setNewClient({...newClient, latitude: e.target.value === '' ? null : parseFloat(e.target.value)})}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Longitud</label>
                                    <input 
                                        type="number" 
                                        step="any"
                                        className="apple-input w-full"
                                        placeholder="-58.3816"
                                        value={newClient.longitude == null ? '' : newClient.longitude}
                                        onChange={e => setNewClient({...newClient, longitude: e.target.value === '' ? null : parseFloat(e.target.value)})}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Inicio Recepción</label>
                                    <input 
                                        type="time" 
                                        className="apple-input w-full"
                                        value={newClient.timeWindowStart}
                                        onChange={e => setNewClient({...newClient, timeWindowStart: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Fin Recepción</label>
                                    <input 
                                        type="time" 
                                        className="apple-input w-full"
                                        value={newClient.timeWindowEnd}
                                        onChange={e => setNewClient({...newClient, timeWindowEnd: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">Tipo de Zona</label>
                                    <input 
                                        type="text" 
                                        className="apple-input w-full"
                                        placeholder="Norte, Sur..."
                                        value={newClient.zone}
                                        onChange={e => setNewClient({...newClient, zone: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block">T. Descarga (min)</label>
                                    <input 
                                        type="number" 
                                        className="apple-input w-full"
                                        value={newClient.serviceTime}
                                        onChange={e =>
                                            setNewClient({
                                                ...newClient,
                                                serviceTime: parseInt(e.target.value, 10) || 15
                                            })
                                        }
                                    />
                                </div>
                            </div>

                            <div className="flex gap-4 pt-6">
                                <button type="button" onClick={() => setShowAdd(false)} className="apple-button-secondary flex-1 py-4">Cancelar</button>
                                <button type="submit" className="apple-button flex-1 py-4">Guardar Escuela</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ClientManager;
