
import { useState, useEffect, useMemo } from 'react';
import {
    Plus,
    Users,
    DollarSign,
    TrendingUp,
    Edit,
    Trash2,
    X,
    Download,
    ChevronDown,
    Filter,
    Briefcase,
} from 'lucide-react';
import * as XLSX from 'xlsx';

// ─── Types ───────────────────────────────────────────────────────────────────

type Salary = {
    apellido: string;
    nombre: string;
    rol: string;
    antiguedad: number;
    bruto: number;
    jornal: number;
};

type SalaryDatabase = Record<string, Salary[]>;

const MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const ROLES = ['Chofer', 'Auxiliar', 'Admin'];

const EMPTY_SALARY: Salary = {
    apellido: '',
    nombre: '',
    rol: 'Chofer',
    antiguedad: 0,
    bruto: 0,
    jornal: 0,
};

const formatCurrency = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const monthKey = (monthIdx: number, year: number) =>
    `${year}-${String(monthIdx + 1).padStart(2, '0')}`;

// ─── Component ───────────────────────────────────────────────────────────────

const SalaryManager = () => {
    const [database, setDatabase] = useState<SalaryDatabase>({});
    const [selectedMonthIdx, setSelectedMonthIdx] = useState(new Date().getMonth());
    const [selectedYear] = useState(2026);
    const [roleFilter, setRoleFilter] = useState('Todos');
    const [showModal, setShowModal] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [form, setForm] = useState<Salary>({ ...EMPTY_SALARY });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);

    const selectedMonth = monthKey(selectedMonthIdx, selectedYear);
    const salaries: Salary[] = useMemo(() => database[selectedMonth] ?? [], [database, selectedMonth]);

    // ── Fetch ────────────────────────────────────────────────────────────────

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        setApiError(null);
        try {
            // Try settings endpoint first
            const res = await fetch('/api/v1/settings/salaries_data');
            if (res.ok) {
                const data = await res.json();
                if (data?.value) {
                    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
                    setDatabase(parsed ?? {});
                    setLoading(false);
                    return;
                }
            }
        } catch { /* fallback */ }

        try {
            // Fallback: sync-salaries-excel
            const res2 = await fetch('/api/v1/sync-salaries-excel');
            if (res2.ok) {
                const data2 = await res2.json();
                if (data2 && typeof data2 === 'object') {
                    setDatabase(data2);
                    setLoading(false);
                    return;
                }
            }
        } catch { /* empty state */ }

        setDatabase({});
        setLoading(false);
    };

    // ── Save ─────────────────────────────────────────────────────────────────

    const persist = async (db: SalaryDatabase) => {
        setSaving(true);
        setApiError(null);
        try {
            const res = await fetch('/api/v1/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'salaries_data', value: JSON.stringify(db) }),
            });
            if (!res.ok) throw new Error('Error al guardar');
        } catch (e: any) {
            setApiError(e.message || 'Error al guardar datos.');
        } finally {
            setSaving(false);
        }
    };

    // ── Filtered ─────────────────────────────────────────────────────────────

    const filtered = useMemo(() => {
        if (roleFilter === 'Todos') return salaries;
        return salaries.filter(s => s.rol.toLowerCase() === roleFilter.toLowerCase());
    }, [salaries, roleFilter]);

    // ── Summary ──────────────────────────────────────────────────────────────

    const totalEmpleados = filtered.length;
    const masaSalarial = filtered.reduce((acc, s) => acc + (s.bruto || 0), 0);
    const promedio = totalEmpleados > 0 ? masaSalarial / totalEmpleados : 0;

    // ── CRUD ─────────────────────────────────────────────────────────────────

    const openAdd = () => {
        setEditingIndex(null);
        setForm({ ...EMPTY_SALARY });
        setShowModal(true);
    };

    const openEdit = (idx: number) => {
        const real = salaries.indexOf(filtered[idx]);
        setEditingIndex(real);
        setForm({ ...salaries[real] });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.apellido.trim() || !form.nombre.trim()) return;
        const updated = { ...database };
        const list = [...(updated[selectedMonth] ?? [])];

        const entry: Salary = {
            apellido: form.apellido.trim(),
            nombre: form.nombre.trim(),
            rol: form.rol,
            antiguedad: Number(form.antiguedad) || 0,
            bruto: Number(form.bruto) || 0,
            jornal: Number(form.jornal) || 0,
        };

        if (editingIndex !== null) {
            list[editingIndex] = entry;
        } else {
            list.push(entry);
        }

        updated[selectedMonth] = list;
        setDatabase(updated);
        setShowModal(false);
        await persist(updated);
    };

    const handleDelete = async (filteredIdx: number) => {
        if (!confirm('¿Eliminar este empleado del listado?')) return;
        const realIdx = salaries.indexOf(filtered[filteredIdx]);
        const updated = { ...database };
        const list = [...(updated[selectedMonth] ?? [])];
        list.splice(realIdx, 1);
        updated[selectedMonth] = list;
        setDatabase(updated);
        await persist(updated);
    };

    // ── Excel Export ─────────────────────────────────────────────────────────

    const exportToExcel = () => {
        const ws = XLSX.utils.json_to_sheet(salaries.map(s => ({
            'Apellido': s.apellido,
            'Nombre': s.nombre,
            'Rol': s.rol,
            'Antigüedad (meses)': s.antiguedad,
            'Bruto ($)': s.bruto,
            'Jornal': s.jornal || 0,
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Salarios');
        XLSX.writeFile(wb, `salarios_${selectedMonth}.xlsx`);
    };

    // ── Antigüedad formatter ─────────────────────────────────────────────────

    const formatAntiguedad = (meses: number) => {
        if (meses < 12) return `${meses} mes${meses !== 1 ? 'es' : ''}`;
        const years = Math.floor(meses / 12);
        const rem = meses % 12;
        return rem > 0
            ? `${years} año${years !== 1 ? 's' : ''} ${rem} m`
            : `${years} año${years !== 1 ? 's' : ''}`;
    };

    // ── Rol badge ────────────────────────────────────────────────────────────

    const rolBadge = (rol: string) => {
        const r = rol.toUpperCase();
        if (r === 'CHOFER') return 'bg-blue-50 text-[#007AFF]';
        if (r === 'AUXILIAR') return 'bg-purple-50 text-[#AF52DE]';
        return 'bg-gray-100 text-[#8E8E93]';
    };

    // ── Loading / Error ──────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <div className="w-10 h-10 border-4 border-[#007AFF] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-[#8E8E93] font-medium">Cargando salarios...</p>
                </div>
            </div>
        );
    }

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-8 animate-fade-in pb-20">
            {apiError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-2xl flex items-center justify-between gap-4">
                    <span className="font-medium">{apiError}</span>
                    <button
                        type="button"
                        onClick={() => { setApiError(null); loadData(); }}
                        className="text-red-800 font-bold text-sm underline hover:no-underline"
                    >
                        Reintentar
                    </button>
                </div>
            )}

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-[22px] font-bold text-[#1C1C1E]">Gestión de Sueldos</h2>
                    <p className="text-[14px] text-[#8E8E93] font-medium">Nómina y liquidación de haberes del personal</p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    {/* Month selector */}
                    <div className="relative">
                        <select
                            value={selectedMonthIdx}
                            onChange={e => setSelectedMonthIdx(Number(e.target.value))}
                            className="bg-[#F2F2F7] border-none rounded-xl px-4 py-2.5 pr-10 text-[13px] font-bold text-[#1C1C1E] appearance-none focus:ring-2 focus:ring-[#007AFF] transition-all"
                        >
                            {MONTHS.map((m, i) => (
                                <option key={i} value={i}>{m} {selectedYear}</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-3 text-[#AEAEB2] pointer-events-none" />
                    </div>

                    {/* Role filter */}
                    <div className="relative">
                        <Filter size={14} className="absolute left-3 top-3 text-[#AEAEB2] pointer-events-none" />
                        <select
                            value={roleFilter}
                            onChange={e => setRoleFilter(e.target.value)}
                            className="bg-[#F2F2F7] border-none rounded-xl pl-9 pr-10 py-2.5 text-[13px] font-bold text-[#1C1C1E] appearance-none focus:ring-2 focus:ring-[#007AFF] transition-all"
                        >
                            <option value="Todos">Todos</option>
                            <option value="Chofer">Choferes</option>
                            <option value="Auxiliar">Auxiliares</option>
                            <option value="Admin">Admin</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-3 text-[#AEAEB2] pointer-events-none" />
                    </div>

                    {/* Export */}
                    <button
                        onClick={exportToExcel}
                        disabled={salaries.length === 0}
                        className="bg-[#34C759] text-white px-5 py-2.5 rounded-xl font-bold text-[13px] flex items-center gap-2 shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none"
                    >
                        <Download size={16} />
                        Excel
                    </button>

                    {/* Add */}
                    <button
                        onClick={openAdd}
                        className="bg-[#007AFF] text-white px-6 py-2.5 rounded-xl font-bold text-[13px] flex items-center gap-2 shadow-lg shadow-blue-100 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                        <Plus size={16} />
                        Agregar empleado
                    </button>
                </div>
            </div>

            {/* ── Summary Cards ────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Total empleados */}
                <div className="bg-gradient-to-br from-[#007AFF] to-[#0055D4] rounded-2xl p-6 text-white shadow-sm flex flex-col justify-between min-h-[130px]">
                    <div className="flex items-start justify-between">
                        <p className="text-sm font-medium opacity-90">Total empleados</p>
                        <Users size={22} className="opacity-80" />
                    </div>
                    <p className="text-4xl font-bold tracking-tight">{totalEmpleados}</p>
                </div>

                {/* Masa salarial bruta */}
                <div className="bg-gradient-to-br from-[#34C759] to-[#248A3D] rounded-2xl p-6 text-white shadow-sm flex flex-col justify-between min-h-[130px]">
                    <div className="flex items-start justify-between">
                        <p className="text-sm font-medium opacity-90">Masa salarial bruta</p>
                        <DollarSign size={22} className="opacity-80" />
                    </div>
                    <p className="text-3xl font-bold tracking-tight">{formatCurrency(masaSalarial)}</p>
                </div>

                {/* Promedio */}
                <div className="bg-gradient-to-br from-[#AF52DE] to-[#8944AB] rounded-2xl p-6 text-white shadow-sm flex flex-col justify-between min-h-[130px]">
                    <div className="flex items-start justify-between">
                        <p className="text-sm font-medium opacity-90">Promedio por empleado</p>
                        <TrendingUp size={22} className="opacity-80" />
                    </div>
                    <p className="text-3xl font-bold tracking-tight">{formatCurrency(promedio)}</p>
                </div>
            </div>

            {/* ── Table ────────────────────────────────────────────────────── */}
            <div className="bg-white rounded-[32px] border border-[#E5E7EB] shadow-sm overflow-hidden">
                {filtered.length === 0 ? (
                    <div className="p-16 text-center">
                        <Briefcase className="mx-auto text-[#AEAEB2] mb-4" size={48} />
                        <p className="text-[#8E8E93] font-medium text-[15px]">
                            {salaries.length === 0
                                ? 'No hay empleados cargados para este mes.'
                                : `No hay empleados con rol "${roleFilter}" este mes.`}
                        </p>
                        <button
                            onClick={openAdd}
                            className="mt-6 apple-button px-6 py-3 text-[14px] inline-flex items-center gap-2"
                        >
                            <Plus size={16} />
                            Agregar empleado
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-[#F2F2F7]">
                                    <th className="text-left text-[11px] font-black text-[#8E8E93] uppercase tracking-widest px-8 py-5">Empleado</th>
                                    <th className="text-left text-[11px] font-black text-[#8E8E93] uppercase tracking-widest px-4 py-5">Rol</th>
                                    <th className="text-left text-[11px] font-black text-[#8E8E93] uppercase tracking-widest px-4 py-5">Antigüedad</th>
                                    <th className="text-right text-[11px] font-black text-[#8E8E93] uppercase tracking-widest px-4 py-5">Bruto ($)</th>
                                    <th className="text-right text-[11px] font-black text-[#8E8E93] uppercase tracking-widest px-8 py-5">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((s, idx) => (
                                    <tr
                                        key={`${s.apellido}-${s.nombre}-${idx}`}
                                        className="border-b border-[#F2F2F7] last:border-b-0 hover:bg-[#F8F9FB] transition-colors"
                                    >
                                        <td className="px-8 py-5">
                                            <p className="text-[15px] font-bold text-[#1C1C1E]">
                                                {s.apellido}, {s.nombre}
                                            </p>
                                        </td>
                                        <td className="px-4 py-5">
                                            <span className={`inline-block px-3 py-1 text-[11px] font-bold rounded-lg uppercase tracking-tight ${rolBadge(s.rol)}`}>
                                                {s.rol.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-5">
                                            <p className="text-[14px] text-[#3C3C43] font-medium">{formatAntiguedad(s.antiguedad)}</p>
                                        </td>
                                        <td className="px-4 py-5 text-right">
                                            <p className="text-[15px] font-bold text-[#34C759]">{formatCurrency(s.bruto)}</p>
                                        </td>
                                        <td className="px-8 py-5 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => openEdit(idx)}
                                                    className="p-2 text-[#007AFF] hover:bg-blue-50 rounded-xl transition-colors"
                                                    title="Editar"
                                                >
                                                    <Edit size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(idx)}
                                                    className="p-2 text-[#FF3B30] hover:bg-red-50 rounded-xl transition-colors"
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
                )}
            </div>

            {saving && (
                <div className="fixed bottom-8 right-8 bg-[#1C1C1E] text-white px-6 py-3 rounded-2xl shadow-lg text-[13px] font-bold flex items-center gap-3 z-40 animate-fade-in-up">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Guardando...
                </div>
            )}

            {/* ── Modal ────────────────────────────────────────────────────── */}
            {showModal && (
                <div
                    className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6"
                    onClick={() => setShowModal(false)}
                >
                    <div
                        className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg p-10 animate-fade-in-up"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-8">
                            <h2 className="text-[24px] font-bold text-[#1C1C1E]">
                                {editingIndex !== null ? 'Editar empleado' : 'Nuevo empleado'}
                            </h2>
                            <button
                                onClick={() => setShowModal(false)}
                                className="p-2 hover:bg-[#F2F2F7] rounded-full transition-colors"
                            >
                                <X size={20} className="text-[#8E8E93]" />
                            </button>
                        </div>

                        <div className="space-y-5">
                            {/* Apellido */}
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block tracking-wider">
                                    Apellido <span className="text-[#FF3B30]">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    className="apple-input w-full"
                                    placeholder="Gonzalez"
                                    value={form.apellido}
                                    onChange={e => setForm({ ...form, apellido: e.target.value })}
                                />
                            </div>

                            {/* Nombre */}
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block tracking-wider">
                                    Nombre <span className="text-[#FF3B30]">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    className="apple-input w-full"
                                    placeholder="Juan"
                                    value={form.nombre}
                                    onChange={e => setForm({ ...form, nombre: e.target.value })}
                                />
                            </div>

                            {/* Rol */}
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block tracking-wider">
                                    Rol
                                </label>
                                <div className="relative">
                                    <select
                                        className="apple-input w-full appearance-none pr-10"
                                        value={form.rol}
                                        onChange={e => setForm({ ...form, rol: e.target.value })}
                                    >
                                        {ROLES.map(r => (
                                            <option key={r} value={r}>{r}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="absolute right-4 top-4 text-[#AEAEB2] pointer-events-none" />
                                </div>
                            </div>

                            {/* Antigüedad */}
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block tracking-wider">
                                    Antigüedad en meses
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    className="apple-input w-full"
                                    placeholder="12"
                                    value={form.antiguedad || ''}
                                    onChange={e => setForm({ ...form, antiguedad: Number(e.target.value) || 0 })}
                                />
                            </div>

                            {/* Sueldo bruto */}
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block tracking-wider">
                                    Sueldo bruto
                                </label>
                                <div className="relative">
                                    <span className="absolute left-4 top-3.5 text-[17px] text-[#8E8E93] font-bold">$</span>
                                    <input
                                        type="number"
                                        min={0}
                                        className="apple-input w-full pl-10"
                                        placeholder="450000"
                                        value={form.bruto || ''}
                                        onChange={e => setForm({ ...form, bruto: Number(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>

                            {/* Jornal diario */}
                            <div>
                                <label className="text-[11px] font-bold text-[#8E8E93] uppercase mb-2 block tracking-wider">
                                    Jornal diario <span className="text-[#AEAEB2] font-medium normal-case">(opcional)</span>
                                </label>
                                <div className="relative">
                                    <span className="absolute left-4 top-3.5 text-[17px] text-[#8E8E93] font-bold">$</span>
                                    <input
                                        type="number"
                                        min={0}
                                        className="apple-input w-full pl-10"
                                        placeholder="0"
                                        value={form.jornal || ''}
                                        onChange={e => setForm({ ...form, jornal: Number(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-end gap-3 mt-10 pt-6 border-t border-[#F2F2F7]">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-6 py-3 rounded-2xl font-bold text-[14px] text-[#8E8E93] hover:bg-[#F2F2F7] transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={!form.apellido.trim() || !form.nombre.trim()}
                                className="apple-button px-8 py-3 text-[14px] flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
                            >
                                {editingIndex !== null ? 'Guardar cambios' : 'Agregar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SalaryManager;
