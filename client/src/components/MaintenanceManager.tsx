
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
    Wrench,
    Plus,
    Calendar,
    Hash,
    Tag,
    DollarSign,
    FileText,
    Search,
    Trash2,
    X,
    Edit,
    ChevronDown,
    Download
} from 'lucide-react';

const MaintenanceManager = () => {
    const [records, setRecords] = useState<any[]>([]);
    const [vehicles, setVehicles] = useState<any[]>([]);
    const [plate, setPlate] = useState('');
    const [category, setCategory] = useState('');
    const [date, setDate] = useState('');
    const [mileage, setMileage] = useState('');
    const [workshop, setWorkshop] = useState('');
    const [workDone, setWorkDone] = useState('');
    const [cost, setCost] = useState('');
    const [notes, setNotes] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterPlate, setFilterPlate] = useState('Todas');
    const [filterMonth, setFilterMonth] = useState('Todos');
    const [filterYear, setFilterYear] = useState('Todos');
    const [apiError, setApiError] = useState<string | null>(null);

    const CATEGORIES = [
        "Reparación y mant. Preventivo",
        "Reparación y mant. Refrigeración",
        "Reparación y mant. Cubiertas",
        "Lubricantes y consumibles"
    ];

    const MONTHS = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];

    const list = Array.isArray(records) ? records : [];
    const YEARS = Array.from(new Set(list.map((r: any) => r.date?.split?.('-')?.[0]))).filter(Boolean).sort();
    const UNIQUE_PLATES = Array.from(new Set(list.map((r: any) => r.plate))).filter(Boolean).sort();

    useEffect(() => {
        fetchRecords();
        fetchVehicles();
    }, []);

    const fetchVehicles = async () => {
        try {
            const res = await fetch('/api/v1/vehicles');
            if (res.ok) {
                const data = await res.json();
                setVehicles(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            console.error("Error loading vehicles", e);
            setApiError('API no disponible. Comprueba que el servidor esté encendido.');
        }
    };

    const fetchRecords = async () => {
        setApiError(null);
        try {
            const res = await fetch('/api/v1/maintenance');
            const data = await res.json();
            if (res.ok && Array.isArray(data)) {
                setRecords(data);
            } else {
                setRecords([]);
                setApiError(data?.error || 'Error al cargar registros.');
            }
        } catch (e) {
            console.error("Error loading maintenance records", e);
            setRecords([]);
            setApiError('API no disponible. Comprueba que el servidor esté encendido.');
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!confirm('¿Desea guardar los cambios en esta reparación?')) return;
        try {
            const url = editingId ? `/api/v1/maintenance/${editingId}` : '/api/v1/maintenance';
            const method = editingId ? 'PATCH' : 'POST';
            
            type Payload = {
                plate: string;
                category?: string;
                month?: string;
                date?: string;
                mileage?: number | null;
                workshop?: string;
                workDone?: string;
                cost?: number | null;
                notes?: string;
                id?: string;
            };

            const payload: Payload = {
                plate: plate.trim().toUpperCase(),
                category: category || null,
                date: date || null,
                mileage: mileage ? parseFloat(mileage) : null,
                workshop: workshop || null,
                workDone: workDone || null,
                cost: cost ? parseFloat(cost) : null,
                notes: notes || null
            };

            if (editingId) {
                payload.id = editingId;
            }

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                setIsAdding(false);
                setEditingId(null);
                fetchRecords();
                resetForm();
            } else {
                const errData = await res.json();
                throw new Error(errData.error || "Error from server");
            }
        } catch (e: any) {
            alert(`Error al guardar registro: ${e.message}`);
        }
    };

    const resetForm = () => {
        setPlate('');
        setCategory('');
        setDate('');
        setMileage('');
        setWorkshop('');
        setWorkDone('');
        setCost('');
        setNotes('');
        setEditingId(null);
        setIsAdding(false);
    };

    const handleEdit = (record: any) => {
        setEditingId(record.id);
        setPlate(record.plate);
        setCategory(record.category || '');
        setDate(record.date ? record.date.split('T')[0] : '');
        setMileage(record.mileage?.toString() || '');
        setWorkshop(record.workshop || '');
        setWorkDone(record.workDone || '');
        setCost(record.cost?.toString() || '');
        setNotes(record.notes || '');
        setIsAdding(true);
    };

    const deleteRecord = async (id: string) => {
        if (!confirm("¿Está seguro de eliminar este registro?")) return;
        try {
            const res = await fetch(`/api/v1/maintenance/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Server error");
            }
            fetchRecords();
        } catch (e: any) {
            console.error("Delete error:", e);
            alert(`Error al eliminar: ${e.message}`);
        }
    };

    const filteredRecords = list.filter((r: any) => {
        const q = searchTerm.toLowerCase().trim();
        const plateStr = (r.plate ?? '').toString();
        const workStr = (r.workDone ?? '').toString();
        const notesStr = (r.notes ?? '').toString();
        const matchesSearch =
            !q ||
            plateStr.toLowerCase().includes(q) ||
            workStr.toLowerCase().includes(q) ||
            notesStr.toLowerCase().includes(q);
        const matchesPlate = filterPlate === 'Todas' || r.plate === filterPlate;
        const dateStr = r.date ? `${String(r.date).split('T')[0]}T12:00:00` : '';
        const recordDate = dateStr ? new Date(dateStr) : null;
        const recordMonth =
            recordDate && !isNaN(recordDate.getTime())
                ? recordDate.toLocaleString('es-AR', { month: 'long' })
                : '';
        const matchesMonth =
            filterMonth === 'Todos' ||
            (recordMonth && recordMonth.toLowerCase() === filterMonth.toLowerCase());
        const y = r.date ? String(r.date).split('T')[0].slice(0, 4) : '';
        const matchesYear = filterYear === 'Todos' || (y && y === filterYear);
        return matchesSearch && matchesPlate && matchesMonth && matchesYear;
    });

    const totalCost = filteredRecords.reduce((sum, r) => sum + (r.cost || 0), 0);

    const totalsByCategory = filteredRecords.reduce((acc: Record<string, number>, r: any) => {
        const c = (r.category && String(r.category).trim()) || 'Sin categoría';
        acc[c] = (acc[c] || 0) + (Number(r.cost) || 0);
        return acc;
    }, {});

    const categoryBreakdown = Object.entries(totalsByCategory).sort((a, b) => b[1] - a[1]);

    const exportMaintenance = () => {
        const ws = XLSX.utils.json_to_sheet(filteredRecords.map(r => ({
            'Unidad': r.plate,
            'Categoría': r.category || 'Sin categoría',
            'Fecha': r.date ? new Date(r.date + 'T00:00:00').toLocaleDateString('es-AR') : '',
            'Kilometraje': r.mileage || 0,
            'Taller': r.workshop || '',
            'Trabajo': r.workDone || '',
            'Costo ($)': r.cost || 0,
            'Notas': r.notes || '',
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Mantenimiento');
        XLSX.writeFile(wb, 'mantenimiento_r14.xlsx');
    };

    return (
        <div className="space-y-8 animate-fade-in pb-20">
            {apiError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-2xl flex items-center justify-between gap-4">
                    <span className="font-medium">{apiError}</span>
                    <button type="button" onClick={() => { setApiError(null); fetchRecords(); fetchVehicles(); }} className="text-red-800 font-bold text-sm underline hover:no-underline">
                        Reintentar
                    </button>
                </div>
            )}
            {/* Header / Brand */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-[22px] font-bold text-[#1C1C1E]">Historial de Mantenimiento</h2>
                    <p className="text-[14px] text-[#8E8E93] font-medium">Gestión financiera y operativa de flotas</p>
                </div>
                
                <div className="flex gap-3 items-center">
                    <button
                        onClick={exportMaintenance}
                        className="bg-white border border-[#E5E7EB] text-[#1C1C1E] px-5 py-3.5 rounded-2xl font-bold flex items-center gap-2 hover:bg-[#F2F2F7] transition-all"
                    >
                        <Download size={18} />
                        Exportar
                    </button>
                    <button
                        onClick={() => {
                            resetForm();
                            setEditingId(null);
                            setIsAdding(true);
                        }}
                        className="bg-[#007AFF] text-white px-8 py-3 rounded-full font-bold text-[14px] flex items-center gap-2 shadow-lg shadow-blue-100 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                        <Plus size={18} />
                        Nueva Reparación
                    </button>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="flex flex-wrap items-center gap-4 bg-white p-6 rounded-[28px] border border-[#E5E7EB] shadow-sm">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-black text-[#8E8E93] uppercase tracking-widest ml-1">Patente</span>
                    <div className="relative">
                        <select 
                            value={filterPlate}
                            onChange={(e) => setFilterPlate(e.target.value)}
                            className="bg-[#F2F2F7] border-none rounded-xl px-4 py-2.5 pr-10 text-[13px] font-bold text-[#1C1C1E] appearance-none focus:ring-2 focus:ring-[#007AFF] transition-all"
                        >
                            <option value="Todas">Todas</option>
                            {UNIQUE_PLATES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-3.5 text-[#AEAEB2] pointer-events-none" />
                    </div>
                </div>

                <div className="flex items-center gap-2 border-l border-[#F2F2F7] pl-4">
                    <span className="text-[11px] font-black text-[#8E8E93] uppercase tracking-widest ml-1">Mes</span>
                    <div className="relative">
                        <select 
                            value={filterMonth}
                            onChange={(e) => setFilterMonth(e.target.value)}
                            className="bg-[#F2F2F7] border-none rounded-xl px-4 py-2.5 pr-10 text-[13px] font-bold text-[#1C1C1E] appearance-none focus:ring-2 focus:ring-[#007AFF] transition-all"
                        >
                            <option value="Todos">Todos</option>
                            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-3.5 text-[#AEAEB2] pointer-events-none" />
                    </div>
                </div>

                <div className="flex items-center gap-2 border-l border-[#F2F2F7] pl-4">
                    <span className="text-[11px] font-black text-[#8E8E93] uppercase tracking-widest ml-1">Año</span>
                    <div className="relative">
                        <select 
                            value={filterYear}
                            onChange={(e) => setFilterYear(e.target.value)}
                            className="bg-[#F2F2F7] border-none rounded-xl px-4 py-2.5 pr-10 text-[13px] font-bold text-[#1C1C1E] appearance-none focus:ring-2 focus:ring-[#007AFF] transition-all"
                        >
                            <option value="Todos">Todos</option>
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-3.5 text-[#AEAEB2] pointer-events-none" />
                    </div>
                </div>

                <div className="flex-1 min-w-[200px] border-l border-[#F2F2F7] pl-4">
                    <div className="relative group">
                         <Search className="absolute left-3 top-2.5 text-[#AEAEB2] group-focus-within:text-[#007AFF] transition-colors" size={18} />
                         <input 
                            type="text" 
                            placeholder="Buscar trabajo o notas..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-[#F2F2F7] border-none rounded-xl py-2.5 pl-10 pr-6 text-[13px] w-full focus:ring-2 focus:ring-[#007AFF] transition-all"
                         />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-[32px] border border-[#E5E7EB] shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-[#F8F9FB] text-[#8E8E93] text-[11px] font-bold uppercase tracking-widest">
                            <tr>
                                <th className="px-6 py-4 text-[10px] font-black text-[#8E8E93] uppercase tracking-widest text-left">Unidad</th>
                                <th className="px-6 py-4 text-[10px] font-black text-[#8E8E93] uppercase tracking-widest text-left">Categoría</th>
                                <th className="px-6 py-4 text-[10px] font-black text-[#8E8E93] uppercase tracking-widest text-left">Fecha</th>
                                <th className="px-6 py-4 text-[10px] font-black text-[#8E8E93] uppercase tracking-widest text-left">Kilometraje</th>
                                <th className="px-6 py-4 text-[10px] font-black text-[#8E8E93] uppercase tracking-widest text-left">Trabajo Realizado</th>
                                <th className="px-6 py-4 text-[10px] font-black text-[#8E8E93] uppercase tracking-widest text-right">Costo ($)</th>
                                <th className="px-6 py-4 text-[10px] font-black text-[#8E8E93] uppercase tracking-widest text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F2F2F7] text-[14px]">
                            {filteredRecords.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-8 py-20 text-center text-[#8E8E93]">
                                          No se encontraron registros de mantenimiento.
                                    </td>
                                </tr>
                            ) : filteredRecords.map((r) => (
                                <tr key={r.id} className="hover:bg-[#F8F9FB] transition-colors group">
                                    <td className="px-6 py-5">
                                        <div className="flex flex-col">
                                            <span className="text-[14px] font-black text-[#1C1C1E]">{r.plate}</span>
                                            <span className="text-[10px] text-[#8E8E93] font-bold uppercase tracking-tighter">{r.workshop || 'Mecánica General'}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold">
                                            {r.category || 'Mantenimiento General'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-5">
                                        <div className="flex flex-col">
                                            <span className="text-[13px] font-bold text-[#1C1C1E]">{r.date ? new Date(r.date + 'T00:00:00').toLocaleDateString('es-AR') : '-'}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <span className="font-bold text-[#1C1C1E]">{(r.mileage ?? 0).toLocaleString('es-AR')} km</span>
                                    </td>
                                    <td className="px-6 py-5">
                                        <div className="font-bold text-[#1C1C1E] max-w-xs">{r.workDone ?? '-'}</div>
                                        <div className="text-[12px] text-[#8E8E93] truncate max-w-[200px]">{r.notes ?? ''}</div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <div className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg inline-block font-black">
                                            ${(r.cost ?? 0).toLocaleString('es-AR')}
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-right">
                                         <div className="flex items-center justify-end gap-2">
                                             <button 
                                                onClick={() => handleEdit(r)}
                                                className="p-2 text-[#AEAEB2] hover:text-[#007AFF] transition-colors bg-[#F2F2F7] rounded-lg"
                                                title="Editar"
                                             >
                                                  <Edit size={16} />
                                             </button>
                                             <button 
                                                onClick={() => deleteRecord(r.id)}
                                                className="p-2 text-[#AEAEB2] hover:text-red-500 transition-colors bg-[#F2F2F7] rounded-lg"
                                                title="Eliminar"
                                             >
                                                  <Trash2 size={16} />
                                             </button>
                                         </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer Total */}
                <div className="p-10 border-t border-[#F2F2F7] space-y-6 bg-[#F8F9FB]/50">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
                        <div>
                            <h3 className="text-[12px] font-black text-[#8E8E93] uppercase tracking-[0.2em]">Total en reparaciones (vista filtrada)</h3>
                            <p className="text-[13px] text-[#8E8E93] font-medium mt-2">
                                {filteredRecords.length} registro{filteredRecords.length !== 1 ? 's' : ''}
                                {filterMonth !== 'Todos' || filterYear !== 'Todos'
                                    ? ` · ${filterMonth !== 'Todos' ? filterMonth : 'Todos los meses'}${filterYear !== 'Todos' ? ` ${filterYear}` : ''}`
                                    : ' · todos los períodos'}
                                {filterPlate !== 'Todas' ? ` · ${filterPlate}` : ''}
                            </p>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-[12px] font-bold text-[#AEAEB2]">$</span>
                            <span className="text-[32px] font-black text-[#1C1C1E]">{totalCost.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                    {categoryBreakdown.length > 0 && (
                        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6">
                            <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-widest mb-4">Totales por categoría</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {categoryBreakdown.map(([cat, amount]) => (
                                    <div key={cat} className="flex justify-between gap-3 bg-[#F8F9FB] rounded-xl px-4 py-3 border border-[#F2F2F7]">
                                        <span className="text-[13px] font-medium text-[#1C1C1E] truncate" title={cat}>
                                            {cat}
                                        </span>
                                        <span className="text-[13px] font-black text-emerald-700 whitespace-nowrap">
                                            ${amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal */}
            {isAdding && (
                <div className="fixed inset-0 bg-[#1C1C1E]/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
                    <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden animate-slide-up">
                        <div className="p-8 border-b border-[#F2F2F7] flex justify-between items-center bg-[#F8F9FB]">
                            <div className="flex items-center gap-3">
                                <div className="bg-[#007AFF] p-2.5 rounded-2xl text-white shadow-lg shadow-blue-100">
                                    <Wrench size={22} />
                                </div>
                                <h2 className="text-xl font-bold text-[#1C1C1E]">{editingId ? 'Editar Reparación' : 'Registrar Reparación'}</h2>
                            </div>
                            <button onClick={() => { setIsAdding(false); setEditingId(null); }} className="p-2 hover:bg-[#F2F2F7] rounded-full transition-colors">
                                <X size={24} className="text-[#8E8E93]" />
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="p-10 space-y-8 max-h-[70vh] overflow-y-auto">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="col-span-2">
                                    <label className="text-[11px] font-black text-[#8E8E93] uppercase tracking-widest block mb-2 px-1">Unidad de Flota *</label>
                                    <select 
                                        required
                                        value={plate}
                                        onChange={(e) => setPlate(e.target.value)}
                                        className="w-full bg-[#F2F2F7] border-none rounded-2xl p-4 text-[14px] font-bold text-[#1C1C1E] focus:ring-2 focus:ring-[#007AFF] transition-all"
                                    >
                                        <option value="">Seleccionar Unidad</option>
                                        {(Array.isArray(vehicles) ? vehicles : []).map((v: any, i: number) => <option key={v.plate || v.id || i} value={v.plate}>{v.plate} {v.model ? `- ${v.model}` : ''}</option>)}
                                    </select>
                                </div>

                                <div className="col-span-2">
                                    <label className="text-[11px] font-black text-[#8E8E93] uppercase tracking-widest block mb-2 px-1">Categoría de Reparación</label>
                                    <select 
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        className="w-full bg-[#F2F2F7] border-none rounded-2xl p-4 text-[14px] font-bold text-[#1C1C1E] focus:ring-2 focus:ring-[#007AFF] transition-all"
                                    >
                                        <option value="">Sin Categoría</option>
                                        <option value="Reparación y mant. Preventivo">Reparación y mant. Preventivo</option>
                                        <option value="Reparación y mant. Refrigeración">Reparación y mant. Refrigeración</option>
                                        <option value="Reparación y mant. Cubiertas">Reparación y mant. Cubiertas</option>
                                        <option value="Lubricantes y consumibles">Lubricantes y consumibles</option>
                                    </select>
                                </div>


                                <div className="space-y-2">
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-widest ml-1">Fecha</label>
                                    <div className="relative">
                                        <Calendar className="absolute left-4 top-3.5 text-[#AEAEB2]" size={18} />
                                        <input 
                                            type="date"
                                            required
                                            className="apple-input pl-12 w-full"
                                            value={date}
                                            onChange={e => setDate(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-8">
                                <div className="space-y-2">
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-widest ml-1">Kilometraje</label>
                                    <div className="relative">
                                        <Hash className="absolute left-4 top-3.5 text-[#AEAEB2]" size={18} />
                                        <input 
                                            type="number"
                                            required
                                            className="apple-input pl-12 w-full"
                                            value={mileage}
                                            onChange={e => setMileage(e.target.value)}
                                            placeholder="150000"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-widest ml-1">Costo Total ($)</label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-4 top-3.5 text-[#AEAEB2]" size={18} />
                                        <input 
                                            type="number"
                                            required
                                            className="apple-input pl-12 w-full"
                                            value={cost}
                                            onChange={e => setCost(e.target.value)}
                                            placeholder="15000"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-widest ml-1">Taller / Proveedor</label>
                                <div className="relative">
                                    <FileText className="absolute left-4 top-3.5 text-[#AEAEB2]" size={18} />
                                    <input 
                                        className="apple-input pl-12 w-full"
                                        value={workshop}
                                        onChange={e => setWorkshop(e.target.value)}
                                        placeholder="Service Oficial / Taller Mecánico"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-widest ml-1">Trabajo Realizado</label>
                                <textarea 
                                    required
                                    className="apple-input w-full min-h-[100px] p-4"
                                    value={workDone}
                                    onChange={e => setWorkDone(e.target.value)}
                                    placeholder="Cambio de aceite, filtros, frenos..."
                                />
                            </div>

                             <div className="flex justify-end gap-4 pt-6">
                                <button type="button" onClick={() => { setIsAdding(false); setEditingId(null); }} className="px-8 py-3 rounded-2xl font-bold text-[#636366] hover:bg-[#F2F2F7] transition-colors">
                                    Cancelar
                                </button>
                                <button type="submit" className="bg-[#007AFF] text-white px-10 py-3 rounded-2xl font-bold shadow-lg shadow-blue-100 hover:scale-[1.02] active:scale-[0.98] transition-all">
                                    {editingId ? 'Actualizar Cambios' : 'Guardar Registro'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MaintenanceManager;
