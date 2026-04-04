import { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import {
    Search,
    ChevronRight,
    GripVertical,
    X,
    Save,
    Plus,
    Route
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TemplateStop = {
    id?: number;
    clientId: string;
    clientName: string;
    sequence: number;
};

type RouteTemplate = {
    id: number;
    name: string;
    stops: TemplateStop[];
};

type Client = {
    id: string;
    name: string;
    address?: string;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const RouteTemplatesManager = () => {
    // Left panel state
    const [templates, setTemplates] = useState<RouteTemplate[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<RouteTemplate | null>(null);
    const [templateSearch, setTemplateSearch] = useState('');
    const [loadingTemplates, setLoadingTemplates] = useState(true);

    // Right panel state
    const [stops, setStops] = useState<TemplateStop[]>([]);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Add-stop state
    const [clientSearch, setClientSearch] = useState('');
    const [clients, setClients] = useState<Client[]>([]);
    const [showClientDropdown, setShowClientDropdown] = useState(false);
    const [loadingClients, setLoadingClients] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    /* ---- Fetch templates on mount ---- */
    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        setLoadingTemplates(true);
        try {
            const res = await fetch('/api/v1/route-templates');
            const data = await res.json();
            setTemplates(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error('Error loading route templates', e);
            setTemplates([]);
        } finally {
            setLoadingTemplates(false);
        }
    };

    /* ---- Select a template ---- */
    const selectTemplate = (tpl: RouteTemplate) => {
        setSelectedTemplate(tpl);
        setStops(
            [...(tpl.stops ?? [])].sort((a, b) => a.sequence - b.sequence)
        );
        setSaveSuccess(false);
    };

    /* ---- Search clients for add-stop ---- */
    useEffect(() => {
        if (!clientSearch.trim()) {
            setClients([]);
            setShowClientDropdown(false);
            return;
        }

        const timeout = setTimeout(async () => {
            setLoadingClients(true);
            try {
                const res = await fetch('/api/v1/clients');
                const all: Client[] = await res.json();
                const q = clientSearch.toLowerCase();
                setClients(
                    all.filter(
                        (c) =>
                            c.name.toLowerCase().includes(q) ||
                            (c.address ?? '').toLowerCase().includes(q)
                    ).slice(0, 20)
                );
                setShowClientDropdown(true);
            } catch {
                setClients([]);
            } finally {
                setLoadingClients(false);
            }
        }, 300);

        return () => clearTimeout(timeout);
    }, [clientSearch]);

    /* ---- Close dropdown on outside click ---- */
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowClientDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    /* ---- Drag-and-drop handler ---- */
    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const items = Array.from(stops);
        const [reordered] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reordered);
        setStops(items.map((s, i) => ({ ...s, sequence: i + 1 })));
    };

    /* ---- Add a stop ---- */
    const addStop = (client: Client) => {
        const newStop: TemplateStop = {
            clientId: client.id,
            clientName: client.name,
            sequence: stops.length + 1
        };
        setStops([...stops, newStop]);
        setClientSearch('');
        setShowClientDropdown(false);
    };

    /* ---- Remove a stop ---- */
    const removeStop = (index: number) => {
        const updated = stops.filter((_, i) => i !== index).map((s, i) => ({ ...s, sequence: i + 1 }));
        setStops(updated);
    };

    /* ---- Save stops ---- */
    const handleSave = async () => {
        if (!selectedTemplate) return;
        setSaving(true);
        setSaveSuccess(false);
        try {
            const res = await fetch(`/api/v1/route-templates/${selectedTemplate.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stops: stops.map((s) => ({
                        clientId: s.clientId,
                        clientName: s.clientName,
                        sequence: s.sequence
                    }))
                })
            });
            if (res.ok) {
                setSaveSuccess(true);
                // Refresh templates list to reflect updated stop counts
                const fresh = await fetch('/api/v1/route-templates');
                const data = await fresh.json();
                setTemplates(Array.isArray(data) ? data : []);
                // Update selected template reference
                const updated = (Array.isArray(data) ? data : []).find(
                    (t: RouteTemplate) => t.id === selectedTemplate.id
                );
                if (updated) setSelectedTemplate(updated);
                setTimeout(() => setSaveSuccess(false), 2500);
            }
        } catch (e) {
            console.error('Error saving template', e);
        } finally {
            setSaving(false);
        }
    };

    /* ---- Stop badge ---- */
    const getStopBadge = (stop: TemplateStop, index: number, total: number) => {
        const nameUpper = stop.clientName.toUpperCase();
        if (index === 0 && nameUpper.includes('REAL 14')) {
            return (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#007AFF]/10 text-[#007AFF]">
                    Punto de partida
                </span>
            );
        }
        if (index === total - 1 && nameUpper.includes('REAL 14')) {
            return (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-600">
                    Punto de llegada
                </span>
            );
        }
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F2F2F7] text-[#8E8E93]">
                Entrega
            </span>
        );
    };

    /* ---- Filtered templates ---- */
    const filteredTemplates = templates.filter((t) =>
        t.name.toLowerCase().includes(templateSearch.toLowerCase())
    );

    /* ================================================================ */
    /*  RENDER                                                          */
    /* ================================================================ */

    return (
        <div className="flex gap-6 animate-fade-in h-[calc(100vh-180px)] min-h-[500px]">
            {/* ============ LEFT PANEL ============ */}
            <div className="w-1/3 flex flex-col bg-white rounded-[32px] shadow-sm overflow-hidden">
                {/* Header */}
                <div className="px-6 pt-6 pb-4">
                    <h2 className="text-[17px] font-bold text-[#1C1C1E] tracking-tight mb-4">
                        Rutas predefinidas
                    </h2>
                    <div className="relative group">
                        <Search className="absolute left-3.5 top-3 text-[#AEAEB2] group-focus-within:text-[#007AFF] transition-colors" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar ruta..."
                            value={templateSearch}
                            onChange={(e) => setTemplateSearch(e.target.value)}
                            className="w-full bg-[#F2F2F7] border-none rounded-2xl py-2.5 pl-10 pr-4 text-[14px] text-[#1C1C1E] placeholder-[#AEAEB2] focus:ring-2 focus:ring-[#007AFF] focus:bg-white transition-all"
                        />
                    </div>
                </div>

                {/* Template list */}
                <div className="flex-1 overflow-y-auto px-3 pb-4">
                    {loadingTemplates ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="w-6 h-6 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : filteredTemplates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                            <div className="w-14 h-14 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-4">
                                <Route size={24} className="text-[#AEAEB2]" />
                            </div>
                            <p className="text-[15px] font-semibold text-[#1C1C1E] mb-1">Sin rutas predefinidas</p>
                            <p className="text-[13px] text-[#8E8E93]">
                                {templateSearch ? 'No hay resultados para esta busqueda' : 'Aun no se crearon plantillas de ruta'}
                            </p>
                        </div>
                    ) : (
                        filteredTemplates.map((tpl) => (
                            <button
                                key={tpl.id}
                                onClick={() => selectTemplate(tpl)}
                                className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl mb-1.5 text-left transition-all ${
                                    selectedTemplate?.id === tpl.id
                                        ? 'bg-[#007AFF] text-white shadow-md'
                                        : 'hover:bg-[#F8F9FB] text-[#1C1C1E]'
                                }`}
                            >
                                <div className="min-w-0 flex-1">
                                    <p className={`text-[14px] font-semibold truncate ${
                                        selectedTemplate?.id === tpl.id ? 'text-white' : 'text-[#1C1C1E]'
                                    }`}>
                                        {tpl.name}
                                    </p>
                                    <p className={`text-[12px] mt-0.5 ${
                                        selectedTemplate?.id === tpl.id ? 'text-white/70' : 'text-[#8E8E93]'
                                    }`}>
                                        {(tpl.stops ?? []).length} parada{(tpl.stops ?? []).length !== 1 ? 's' : ''}
                                    </p>
                                </div>
                                <ChevronRight size={16} className={`flex-shrink-0 ml-2 ${
                                    selectedTemplate?.id === tpl.id ? 'text-white/70' : 'text-[#C7C7CC]'
                                }`} />
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* ============ RIGHT PANEL ============ */}
            <div className="w-2/3 flex flex-col bg-white rounded-[32px] shadow-sm overflow-hidden">
                {!selectedTemplate ? (
                    /* Empty state */
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                        <div className="w-16 h-16 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-5">
                            <Route size={28} className="text-[#AEAEB2]" />
                        </div>
                        <p className="text-[17px] font-semibold text-[#1C1C1E] mb-1">Seleccionar una ruta</p>
                        <p className="text-[13px] text-[#8E8E93] max-w-[260px]">
                            Elegir una ruta predefinida del panel izquierdo para editar sus paradas
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Header with save */}
                        <div className="px-6 pt-6 pb-4 flex items-center justify-between border-b border-[#F2F2F7]">
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-semibold text-[#007AFF] uppercase tracking-wider mb-0.5">
                                    Editando
                                </p>
                                <h2 className="text-[17px] font-bold text-[#1C1C1E] truncate">
                                    {selectedTemplate.name}
                                </h2>
                            </div>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-[14px] font-semibold transition-all ${
                                    saveSuccess
                                        ? 'bg-green-500 text-white'
                                        : 'bg-[#007AFF] text-white hover:bg-[#0066D6] active:scale-[0.97]'
                                } disabled:opacity-50`}
                            >
                                <Save size={15} />
                                {saving ? 'Guardando...' : saveSuccess ? 'Guardado' : 'Guardar'}
                            </button>
                        </div>

                        {/* Stops list */}
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                            {stops.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <p className="text-[14px] text-[#8E8E93]">
                                        Esta ruta no tiene paradas. Usar el buscador de abajo para agregar.
                                    </p>
                                </div>
                            ) : (
                                <DragDropContext onDragEnd={onDragEnd}>
                                    <Droppable droppableId="stops-list">
                                        {(provided, snapshot) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.droppableProps}
                                                className={`space-y-2 transition-colors rounded-2xl ${
                                                    snapshot.isDraggingOver ? 'bg-[#007AFF]/[0.03]' : ''
                                                }`}
                                            >
                                                {stops.map((stop, index) => (
                                                    <Draggable
                                                        key={`${stop.clientId}-${index}`}
                                                        draggableId={`${stop.clientId}-${index}`}
                                                        index={index}
                                                    >
                                                        {(provided, snapshot) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${
                                                                    snapshot.isDragging
                                                                        ? 'bg-white shadow-lg border-[#007AFF] ring-2 ring-[#007AFF]/20'
                                                                        : 'bg-white border-[#F2F2F7] hover:bg-[#F8F9FB]'
                                                                }`}
                                                                style={provided.draggableProps.style}
                                                            >
                                                                {/* Drag handle */}
                                                                <div
                                                                    {...provided.dragHandleProps}
                                                                    className="flex-shrink-0 cursor-grab active:cursor-grabbing text-[#C7C7CC] hover:text-[#8E8E93] transition-colors"
                                                                >
                                                                    <GripVertical size={18} />
                                                                </div>

                                                                {/* Sequence number */}
                                                                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#F2F2F7] flex items-center justify-center">
                                                                    <span className="text-[12px] font-bold text-[#8E8E93]">
                                                                        {stop.sequence}
                                                                    </span>
                                                                </div>

                                                                {/* Name + badge */}
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-[14px] font-semibold text-[#1C1C1E] truncate">
                                                                        {stop.clientName}
                                                                    </p>
                                                                </div>

                                                                {getStopBadge(stop, index, stops.length)}

                                                                {/* Delete button */}
                                                                <button
                                                                    onClick={() => removeStop(index)}
                                                                    className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#C7C7CC] hover:bg-red-50 hover:text-red-500 transition-all"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </DragDropContext>
                            )}
                        </div>

                        {/* Add stop section */}
                        <div className="px-6 py-4 border-t border-[#F2F2F7]" ref={dropdownRef}>
                            <p className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wider mb-2.5">
                                Agregar parada
                            </p>
                            <div className="relative">
                                <div className="relative group">
                                    <Plus className="absolute left-3.5 top-3 text-[#AEAEB2] group-focus-within:text-[#007AFF] transition-colors" size={16} />
                                    <input
                                        type="text"
                                        placeholder="Buscar cliente para agregar..."
                                        value={clientSearch}
                                        onChange={(e) => setClientSearch(e.target.value)}
                                        onFocus={() => { if (clients.length > 0) setShowClientDropdown(true); }}
                                        className="w-full bg-[#F2F2F7] border-none rounded-2xl py-2.5 pl-10 pr-4 text-[14px] text-[#1C1C1E] placeholder-[#AEAEB2] focus:ring-2 focus:ring-[#007AFF] focus:bg-white transition-all"
                                    />
                                </div>

                                {/* Client dropdown */}
                                {showClientDropdown && (
                                    <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-2xl shadow-lg border border-[#E5E7EB] max-h-[220px] overflow-y-auto z-20">
                                        {loadingClients ? (
                                            <div className="flex items-center justify-center py-4">
                                                <div className="w-5 h-5 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                                            </div>
                                        ) : clients.length === 0 ? (
                                            <p className="text-[13px] text-[#8E8E93] text-center py-4">
                                                Sin resultados
                                            </p>
                                        ) : (
                                            clients.map((client) => (
                                                <button
                                                    key={client.id}
                                                    onClick={() => addStop(client)}
                                                    className="w-full text-left px-4 py-2.5 hover:bg-[#F8F9FB] transition-colors first:rounded-t-2xl last:rounded-b-2xl"
                                                >
                                                    <p className="text-[14px] font-medium text-[#1C1C1E]">{client.name}</p>
                                                    {client.address && (
                                                        <p className="text-[12px] text-[#8E8E93] truncate">{client.address}</p>
                                                    )}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default RouteTemplatesManager;
