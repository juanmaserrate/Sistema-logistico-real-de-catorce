
import { useState, useEffect, useCallback, useRef } from 'react';
import {
    DollarSign,
    Save,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Clock,
    TrendingUp,
    Wallet,
    Fuel,
    Wrench,
    ShieldCheck,
    FileText,
    Users,
    Car,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type CostsMonth = {
    fijo: { seguros: number; patentes: number; nomina: number };
    variable: { combustible: number; mantenimiento: number; neumaticos: number };
    horasReales: number;
};

type CostsDatabase = Record<string, CostsMonth>;

const EMPTY_MONTH: CostsMonth = {
    fijo: { seguros: 0, patentes: 0, nomina: 0 },
    variable: { combustible: 0, mantenimiento: 0, neumaticos: 0 },
    horasReales: 0,
};

const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const YEAR = 2026;

const buildKey = (monthIndex: number): string =>
    `${YEAR}-${String(monthIndex + 1).padStart(2, '0')}`;

const fmt = (n: number): string =>
    `$${n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// ─── Currency input ───────────────────────────────────────────────────────────

const CurrencyInput = ({
    label,
    value,
    onChange,
    icon: Icon,
}: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    icon: React.ElementType;
}) => (
    <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#F2F2F7] flex items-center justify-center text-[#8E8E93]">
                <Icon size={16} />
            </div>
            <p className="text-[15px] font-semibold text-[#1C1C1E]">{label}</p>
        </div>
        <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93] text-[14px] font-semibold">
                <DollarSign size={14} />
            </span>
            <input
                type="number"
                min={0}
                step={100}
                className="apple-input w-44 pl-9 text-right font-semibold"
                value={value || ''}
                placeholder="0"
                onChange={e => onChange(parseFloat(e.target.value) || 0)}
            />
        </div>
    </div>
);

// ─── Summary card ─────────────────────────────────────────────────────────────

const SummaryCard = ({
    title,
    amount,
    gradient,
}: {
    title: string;
    amount: number;
    gradient: string;
}) => (
    <div
        className="flex-1 rounded-2xl p-5 text-white"
        style={{ background: gradient }}
    >
        <p className="text-[12px] font-semibold opacity-80 mb-1">{title}</p>
        <p className="text-[22px] font-bold tracking-tight">{fmt(amount)}</p>
    </div>
);

// ─── Main component ──────────────────────────────────────────────────────────

const CostEngineManager = () => {
    const [db, setDb] = useState<CostsDatabase>({});
    const [monthIdx, setMonthIdx] = useState(() => new Date().getMonth());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const dbRef = useRef<CostsDatabase>({});

    const currentKey = buildKey(monthIdx);
    const current: CostsMonth = db[currentKey] ?? { ...EMPTY_MONTH, fijo: { ...EMPTY_MONTH.fijo }, variable: { ...EMPTY_MONTH.variable } };

    const totalFijo = current.fijo.seguros + current.fijo.patentes + current.fijo.nomina;
    const totalVariable = current.fijo ? current.variable.combustible + current.variable.mantenimiento + current.variable.neumaticos : 0;
    const totalPresupuesto = totalFijo + totalVariable;
    const costoPorHora = current.horasReales > 0 ? totalPresupuesto / current.horasReales : 0;

    // ── Keep ref in sync ─────────────────────────────────────────────────────
    useEffect(() => {
        dbRef.current = db;
    }, [db]);

    // ── Load from API ────────────────────────────────────────────────────────
    useEffect(() => {
        fetch('/api/v1/settings/costs_data')
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (data?.value) {
                    try {
                        const parsed: CostsDatabase = JSON.parse(data.value);
                        setDb(parsed);
                        dbRef.current = parsed;
                    } catch { /* use empty */ }
                }
            })
            .catch(() => { /* use empty */ })
            .finally(() => setLoading(false));
    }, []);

    // ── Save to API ──────────────────────────────────────────────────────────
    const saveToApi = useCallback(async (database: CostsDatabase) => {
        setSaving(true);
        setSaved(false);
        try {
            await fetch('/api/v1/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'costs_data', value: JSON.stringify(database) }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch { /* silent */ }
        finally { setSaving(false); }
    }, []);

    // ── Update current month in state ────────────────────────────────────────
    const updateCurrent = useCallback((updated: CostsMonth) => {
        setDb(prev => {
            const next = { ...prev, [currentKey]: updated };
            dbRef.current = next;
            return next;
        });
    }, [currentKey]);

    const setFijo = (field: keyof CostsMonth['fijo'], val: number) => {
        updateCurrent({
            ...current,
            fijo: { ...current.fijo, [field]: val },
        });
    };

    const setVariable = (field: keyof CostsMonth['variable'], val: number) => {
        updateCurrent({
            ...current,
            variable: { ...current.variable, [field]: val },
        });
    };

    const setHoras = (val: number) => {
        updateCurrent({ ...current, horasReales: val });
    };

    // ── Month navigation (auto-save before switching) ────────────────────────
    const switchMonth = async (newIdx: number) => {
        // Auto-save current state before switching
        const latestDb = { ...dbRef.current, [currentKey]: current };
        dbRef.current = latestDb;
        setDb(latestDb);
        await saveToApi(latestDb);
        setMonthIdx(newIdx);
    };

    // ── Manual save ──────────────────────────────────────────────────────────
    const handleSave = () => {
        const latestDb = { ...dbRef.current, [currentKey]: current };
        setDb(latestDb);
        dbRef.current = latestDb;
        saveToApi(latestDb);
    };

    // ── Loading state ────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-[#8E8E93] font-medium">Cargando motor de costos...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in">
            {/* ── Month selector ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between bg-white rounded-2xl p-4 border border-[#E5E7EB] shadow-sm">
                <button
                    onClick={() => monthIdx > 0 && switchMonth(monthIdx - 1)}
                    disabled={monthIdx === 0}
                    className="w-10 h-10 rounded-xl bg-[#F2F2F7] flex items-center justify-center
                               text-[#8E8E93] hover:text-[#007AFF] hover:bg-[#E8F0FE]
                               transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={20} />
                </button>

                <div className="text-center">
                    <p className="text-[20px] font-bold text-[#1C1C1E]">
                        {MONTH_NAMES[monthIdx]} {YEAR}
                    </p>
                    <p className="text-[12px] text-[#8E8E93] font-medium">
                        Periodo: {currentKey}
                    </p>
                </div>

                <button
                    onClick={() => monthIdx < 11 && switchMonth(monthIdx + 1)}
                    disabled={monthIdx === 11}
                    className="w-10 h-10 rounded-xl bg-[#F2F2F7] flex items-center justify-center
                               text-[#8E8E93] hover:text-[#007AFF] hover:bg-[#E8F0FE]
                               transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronRight size={20} />
                </button>
            </div>

            {/* ── Summary cards ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-4">
                <SummaryCard
                    title="Total Costos Fijos"
                    amount={totalFijo}
                    gradient="linear-gradient(135deg, #007AFF 0%, #5856D6 100%)"
                />
                <SummaryCard
                    title="Total Costos Variables"
                    amount={totalVariable}
                    gradient="linear-gradient(135deg, #34C759 0%, #30D158 100%)"
                />
                <SummaryCard
                    title="Presupuesto Total"
                    amount={totalPresupuesto}
                    gradient="linear-gradient(135deg, #AF52DE 0%, #5856D6 100%)"
                />
            </div>

            {/* ── Cost per hour ────────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl p-4 border border-[#E5E7EB] shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#FFF3E0] flex items-center justify-center">
                        <Clock size={18} className="text-[#FF9500]" />
                    </div>
                    <div>
                        <p className="text-[14px] font-bold text-[#1C1C1E]">Costo por hora real</p>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Presupuesto total / horas reales del mes
                        </p>
                    </div>
                </div>
                <p className="text-[24px] font-bold text-[#FF9500]">
                    {current.horasReales > 0 ? fmt(Math.round(costoPorHora)) : '---'}
                </p>
            </div>

            {/* ── Fixed costs ─────────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl p-8 border border-[#E5E7EB] shadow-sm space-y-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-[#E8F0FE] flex items-center justify-center">
                        <Wallet size={18} className="text-[#007AFF]" />
                    </div>
                    <div>
                        <h3 className="text-[18px] font-bold text-[#1C1C1E]">
                            Estructura de costos fijos
                        </h3>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Costos mensuales que no dependen del kilometraje.
                        </p>
                    </div>
                </div>

                <div className="space-y-5">
                    <CurrencyInput
                        label="Seguros y licencias"
                        value={current.fijo.seguros}
                        onChange={v => setFijo('seguros', v)}
                        icon={ShieldCheck}
                    />
                    <CurrencyInput
                        label="Patentes y VTV"
                        value={current.fijo.patentes}
                        onChange={v => setFijo('patentes', v)}
                        icon={FileText}
                    />
                    <CurrencyInput
                        label="Costo chofer / Nomina"
                        value={current.fijo.nomina}
                        onChange={v => setFijo('nomina', v)}
                        icon={Users}
                    />
                </div>

                <div className="pt-4 border-t border-[#F2F2F7] flex items-center justify-between">
                    <p className="text-[14px] font-bold text-[#8E8E93]">Subtotal fijos</p>
                    <p className="text-[18px] font-bold text-[#007AFF]">{fmt(totalFijo)}</p>
                </div>
            </div>

            {/* ── Variable costs ───────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl p-8 border border-[#E5E7EB] shadow-sm space-y-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-[#E8F8EE] flex items-center justify-center">
                        <TrendingUp size={18} className="text-[#34C759]" />
                    </div>
                    <div>
                        <h3 className="text-[18px] font-bold text-[#1C1C1E]">
                            Estructura de costos variables
                        </h3>
                        <p className="text-[12px] text-[#8E8E93] font-medium">
                            Costos que varian segun el uso del vehiculo.
                        </p>
                    </div>
                </div>

                <div className="space-y-5">
                    <CurrencyInput
                        label="Combustible"
                        value={current.variable.combustible}
                        onChange={v => setVariable('combustible', v)}
                        icon={Fuel}
                    />
                    <CurrencyInput
                        label="Mantenimiento / Repuestos"
                        value={current.variable.mantenimiento}
                        onChange={v => setVariable('mantenimiento', v)}
                        icon={Wrench}
                    />
                    <CurrencyInput
                        label="Neumaticos y lavado"
                        value={current.variable.neumaticos}
                        onChange={v => setVariable('neumaticos', v)}
                        icon={Car}
                    />
                </div>

                <div className="pt-4 border-t border-[#F2F2F7] flex items-center justify-between">
                    <p className="text-[14px] font-bold text-[#8E8E93]">Subtotal variables</p>
                    <p className="text-[18px] font-bold text-[#34C759]">{fmt(totalVariable)}</p>
                </div>
            </div>

            {/* ── Hours input ──────────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl p-8 border border-[#E5E7EB] shadow-sm">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#FFF3E0] flex items-center justify-center">
                            <Clock size={18} className="text-[#FF9500]" />
                        </div>
                        <div>
                            <p className="text-[15px] font-bold text-[#1C1C1E]">
                                Horas reales del mes
                            </p>
                            <p className="text-[12px] text-[#8E8E93] font-medium">
                                Total de horas operativas efectivas en el periodo.
                            </p>
                        </div>
                    </div>
                    <input
                        type="number"
                        min={0}
                        step={1}
                        className="apple-input w-32 text-center font-semibold text-[18px]"
                        value={current.horasReales || ''}
                        placeholder="0"
                        onChange={e => setHoras(parseFloat(e.target.value) || 0)}
                    />
                </div>
            </div>

            {/* ── Save button ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-end gap-4">
                {saved && (
                    <span className="flex items-center gap-2 text-[#34C759] font-bold text-[13px]">
                        <CheckCircle size={16} /> Guardado
                    </span>
                )}
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="apple-button px-8 flex items-center gap-2 disabled:opacity-60"
                >
                    <Save size={18} />
                    {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
            </div>
        </div>
    );
};

export default CostEngineManager;
