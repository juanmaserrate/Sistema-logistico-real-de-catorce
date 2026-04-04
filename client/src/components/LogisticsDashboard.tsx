import { useState, useEffect, useCallback } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Title,
    Tooltip as ChartTooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { BarChart3, TrendingUp, DollarSign, Truck, RefreshCw, Calendar, Filter, Download } from 'lucide-react';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Title,
    ChartTooltip,
    Legend,
    Filler
);

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Trip = {
    id: string;
    date: string;
    driver: string;
    driverName: string;
    zone: string;
    localidad: string;
    businessUnit: string;
    contractType: 'PROPIO' | 'TERCERIZADO';
    cost: number;
    status: string;
};

type KPIData = {
    totalTrips: number;
    totalCost: number;
    avgCost: number;
    activeDrivers: number;
};

type ZoneCount = {
    zone: string;
    count: number;
};

type BusinessUnitCost = {
    unit: string;
    cost: number;
};

type DailyCost = {
    day: number;
    propio: number;
    tercerizado: number;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const MESES = [
    { value: '2026-01', label: 'Enero 2026' },
    { value: '2026-02', label: 'Febrero 2026' },
    { value: '2026-03', label: 'Marzo 2026' },
    { value: '2026-04', label: 'Abril 2026' },
    { value: '2026-05', label: 'Mayo 2026' },
    { value: '2026-06', label: 'Junio 2026' },
    { value: '2026-07', label: 'Julio 2026' },
    { value: '2026-08', label: 'Agosto 2026' },
    { value: '2026-09', label: 'Septiembre 2026' },
    { value: '2026-10', label: 'Octubre 2026' },
    { value: '2026-11', label: 'Noviembre 2026' },
    { value: '2026-12', label: 'Diciembre 2026' },
];

const formatCurrency = (value: number): string =>
    new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);

const getCurrentMonth = (): string => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
};

const getDaysInMonth = (monthStr: string): number => {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y, m, 0).getDate();
};

// ─── Procesamiento de datos ──────────────────────────────────────────────────

function computeKPIs(trips: Trip[]): KPIData {
    const totalTrips = trips.length;
    const totalCost = trips.reduce((sum, t) => sum + (t.cost || 0), 0);
    const avgCost = totalTrips > 0 ? totalCost / totalTrips : 0;
    const uniqueDrivers = new Set(trips.map((t) => t.driver)).size;
    return { totalTrips, totalCost, avgCost, activeDrivers: uniqueDrivers };
}

function computeDailyCosts(trips: Trip[], monthStr: string): DailyCost[] {
    const daysCount = getDaysInMonth(monthStr);
    const daily: DailyCost[] = Array.from({ length: daysCount }, (_, i) => ({
        day: i + 1,
        propio: 0,
        tercerizado: 0,
    }));

    for (const t of trips) {
        const dayNum = new Date(t.date).getDate();
        if (dayNum >= 1 && dayNum <= daysCount) {
            const entry = daily[dayNum - 1];
            if (t.contractType === 'PROPIO') {
                entry.propio += t.cost || 0;
            } else {
                entry.tercerizado += t.cost || 0;
            }
        }
    }

    // Cumulative
    let cumPropio = 0;
    let cumTerc = 0;
    for (const d of daily) {
        cumPropio += d.propio;
        cumTerc += d.tercerizado;
        d.propio = cumPropio;
        d.tercerizado = cumTerc;
    }

    return daily;
}

function computeZoneCounts(trips: Trip[]): ZoneCount[] {
    const map = new Map<string, number>();
    for (const t of trips) {
        const zone = t.zone || 'Sin zona';
        map.set(zone, (map.get(zone) || 0) + 1);
    }
    return Array.from(map.entries())
        .map(([zone, count]) => ({ zone, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
}

function computeContractDistribution(trips: Trip[]): { propio: number; tercerizado: number } {
    let propio = 0;
    let tercerizado = 0;
    for (const t of trips) {
        if (t.contractType === 'PROPIO') propio++;
        else tercerizado++;
    }
    return { propio, tercerizado };
}

function computeBusinessUnitCosts(trips: Trip[]): BusinessUnitCost[] {
    const map = new Map<string, number>();
    for (const t of trips) {
        const unit = t.businessUnit || 'Sin asignar';
        map.set(unit, (map.get(unit) || 0) + (t.cost || 0));
    }
    return Array.from(map.entries())
        .map(([unit, cost]) => ({ unit, cost }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 8);
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────

type KPICardProps = {
    titulo: string;
    valor: string | number;
    subtitulo?: string;
    icono: React.ReactNode;
    gradiente: string;
};

const KPICard = ({ titulo, valor, subtitulo, icono, gradiente }: KPICardProps) => (
    <div
        className={`rounded-2xl p-6 text-white shadow-sm ${gradiente} flex flex-col justify-between min-h-[140px]`}
    >
        <div className="flex items-start justify-between">
            <p className="text-sm font-medium opacity-90">{titulo}</p>
            <div className="opacity-80">{icono}</div>
        </div>
        <div>
            <p className="text-4xl font-bold tracking-tight">{valor}</p>
            {subtitulo && <p className="text-xs mt-1 opacity-75">{subtitulo}</p>}
        </div>
    </div>
);

const ChartCard = ({
    titulo,
    children,
    height,
}: {
    titulo: string;
    children: React.ReactNode;
    height?: string;
}) => (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
        <h3 className="text-[13px] font-bold text-[#8E8E93] uppercase tracking-wider mb-4">
            {titulo}
        </h3>
        <div style={{ height: height || 'auto', position: 'relative' }}>{children}</div>
    </div>
);

const EmptyChart = ({ mensaje }: { mensaje: string }) => (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
        <BarChart3 className="text-[#C7C7CC] mb-3" size={40} />
        <p className="text-sm text-[#8E8E93]">{mensaje}</p>
    </div>
);

// ─── Chart.js plugin: texto central para Doughnut ────────────────────────────

const centerTextPlugin = {
    id: 'centerText',
    afterDraw(chart: ChartJS) {
        const { ctx, width, height } = chart;
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || meta.data.length === 0) return;

        const dataset = chart.data.datasets[0];
        if (!dataset || !dataset.data) return;

        const rawData = dataset.data as number[];
        const total = rawData.reduce((a, b) => a + b, 0);
        if (total === 0) return;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const centerX = width / 2;
        const centerY = height / 2;

        ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#1C1C1E';
        ctx.fillText(String(total), centerX, centerY - 10);

        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#8E8E93';
        ctx.fillText('viajes', centerX, centerY + 14);

        ctx.restore();
    },
};

// ─── Componente principal ────────────────────────────────────────────────────

type LogisticsDashboardProps = {
    onExportExcel?: (month: string) => void;
};

const LogisticsDashboard = ({ onExportExcel }: LogisticsDashboardProps) => {
    const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
    const [trips, setTrips] = useState<Trip[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── Fetch ────────────────────────────────────────────────────────────────

    const fetchTrips = useCallback(async (month: string, isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/v1/trips?month=${encodeURIComponent(month)}`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            const data: Trip[] = await res.json();
            setTrips(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error al obtener viajes:', err);
            setError('No se pudieron cargar los datos');
            setTrips([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchTrips(selectedMonth);
    }, [selectedMonth, fetchTrips]);

    // ── Computed ─────────────────────────────────────────────────────────────

    const kpis = computeKPIs(trips);
    const dailyCosts = computeDailyCosts(trips, selectedMonth);
    const zoneCounts = computeZoneCounts(trips);
    const contractDist = computeContractDistribution(trips);
    const buCosts = computeBusinessUnitCosts(trips);
    const hasData = trips.length > 0;

    // ── Chart configs ────────────────────────────────────────────────────────

    const lineChartData = {
        labels: dailyCosts.map((d) => String(d.day)),
        datasets: [
            {
                label: 'Propio',
                data: dailyCosts.map((d) => d.propio),
                borderColor: '#007AFF',
                backgroundColor: 'rgba(0, 122, 255, 0.08)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: '#007AFF',
            },
            {
                label: 'Tercerizado',
                data: dailyCosts.map((d) => d.tercerizado),
                borderColor: '#FF9500',
                backgroundColor: 'rgba(255, 149, 0, 0.08)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: '#FF9500',
            },
        ],
    };

    const lineChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index' as const, intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#1C1C1E',
                titleFont: { size: 12 },
                bodyFont: { size: 12 },
                padding: 12,
                cornerRadius: 10,
                callbacks: {
                    title: (items: { label?: string }[]) =>
                        items[0]?.label ? `Dia ${items[0].label}` : '',
                    label: (ctx: { dataset?: { label?: string }; parsed?: { y?: number } }) =>
                        `${ctx.dataset?.label || ''}: ${formatCurrency(ctx.parsed?.y || 0)}`,
                },
            },
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: {
                    color: '#8E8E93',
                    font: { size: 10 },
                    maxTicksLimit: 15,
                },
                border: { display: false },
            },
            y: {
                grid: { display: false },
                ticks: {
                    color: '#8E8E93',
                    font: { size: 10 },
                    callback: (value: string | number) => formatCurrency(Number(value)),
                },
                border: { display: false },
            },
        },
    };

    const zoneChartData = {
        labels: zoneCounts.map((z) => z.zone),
        datasets: [
            {
                data: zoneCounts.map((z) => z.count),
                backgroundColor: '#007AFF',
                borderRadius: 6,
                borderSkipped: false as const,
                barThickness: 24,
            },
        ],
    };

    const zoneChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y' as const,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#1C1C1E',
                titleFont: { size: 12 },
                bodyFont: { size: 12 },
                padding: 12,
                cornerRadius: 10,
                callbacks: {
                    label: (ctx: { parsed?: { x?: number } }) =>
                        `${ctx.parsed?.x || 0} viajes`,
                },
            },
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: { color: '#8E8E93', font: { size: 10 } },
                border: { display: false },
            },
            y: {
                grid: { display: false },
                ticks: {
                    color: '#1C1C1E',
                    font: { size: 11 },
                },
                border: { display: false },
            },
        },
    };

    const doughnutData = {
        labels: ['Propio', 'Tercerizado'],
        datasets: [
            {
                data: [contractDist.propio, contractDist.tercerizado],
                backgroundColor: ['#007AFF', '#FF9500'],
                borderWidth: 0,
                cutout: '68%',
                hoverOffset: 6,
            },
        ],
    };

    const doughnutOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#1C1C1E',
                titleFont: { size: 12 },
                bodyFont: { size: 12 },
                padding: 12,
                cornerRadius: 10,
                callbacks: {
                    label: (ctx: { label?: string; parsed?: number; dataset?: { data?: number[] } }) => {
                        const total = (ctx.dataset?.data || []).reduce((a: number, b: number) => a + b, 0);
                        const pct = total > 0 ? ((ctx.parsed || 0) / total * 100).toFixed(1) : '0';
                        return `${ctx.label}: ${ctx.parsed || 0} (${pct}%)`;
                    },
                },
            },
        },
    };

    const buChartData = {
        labels: buCosts.map((b) => b.unit),
        datasets: [
            {
                data: buCosts.map((b) => b.cost),
                backgroundColor: (ctx: { dataIndex: number }) => {
                    const colors = [
                        '#007AFF', '#34C759', '#FF9500', '#AF52DE',
                        '#FF3B30', '#5AC8FA', '#FFD60A', '#FF2D55',
                    ];
                    return colors[ctx.dataIndex % colors.length];
                },
                borderRadius: 8,
                borderSkipped: false as const,
                barThickness: 36,
            },
        ],
    };

    const buChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#1C1C1E',
                titleFont: { size: 12 },
                bodyFont: { size: 12 },
                padding: 12,
                cornerRadius: 10,
                callbacks: {
                    label: (ctx: { parsed?: { y?: number } }) =>
                        formatCurrency(ctx.parsed?.y || 0),
                },
            },
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: {
                    color: '#1C1C1E',
                    font: { size: 10 },
                    maxRotation: 45,
                },
                border: { display: false },
            },
            y: {
                grid: { display: false },
                ticks: {
                    color: '#8E8E93',
                    font: { size: 10 },
                    callback: (value: string | number) => formatCurrency(Number(value)),
                },
                border: { display: false },
            },
        },
    };

    // ── Render ────────────────────────────────────────────────────────────────

    const mesLabel =
        MESES.find((m) => m.value === selectedMonth)?.label || selectedMonth;

    return (
        <div className="space-y-6">
            {/* ── Header ─────────────────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-[#1C1C1E] tracking-tight">
                        Dashboard logistico
                    </h2>
                    <p className="text-sm text-[#8E8E93] mt-0.5">
                        Metricas y costos operativos
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Selector de mes */}
                    <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" size={16} />
                        <select
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            className="pl-9 pr-4 py-2.5 bg-white border border-[#E5E7EB] rounded-xl text-sm text-[#1C1C1E] font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF] transition-all"
                        >
                            {MESES.map((m) => (
                                <option key={m.value} value={m.value}>
                                    {m.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Refresh */}
                    <button
                        onClick={() => fetchTrips(selectedMonth, true)}
                        disabled={refreshing}
                        className="p-2.5 bg-white border border-[#E5E7EB] rounded-xl text-[#8E8E93] hover:text-[#007AFF] hover:border-[#007AFF]/30 transition-all disabled:opacity-50"
                        title="Actualizar datos"
                    >
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    </button>

                    {/* Exportar */}
                    <button
                        onClick={() => onExportExcel?.(selectedMonth)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-[#007AFF] text-white text-sm font-medium rounded-xl hover:bg-[#0066D6] transition-all shadow-sm"
                    >
                        <Download size={15} />
                        Exportar a Excel
                    </button>
                </div>
            </div>

            {/* ── Error banner ────────────────────────────────────────────────── */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {/* ── Skeleton / loading ──────────────────────────────────────────── */}
            {loading ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[...Array(4)].map((_, i) => (
                            <div
                                key={i}
                                className="rounded-2xl p-6 min-h-[140px] bg-gray-100 animate-pulse"
                            />
                        ))}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {[...Array(4)].map((_, i) => (
                            <div
                                key={i}
                                className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm min-h-[300px] animate-pulse"
                            >
                                <div className="h-4 w-40 bg-gray-100 rounded mb-4" />
                                <div className="h-full bg-gray-50 rounded-xl" />
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <>
                    {/* ── KPI Cards ─────────────────────────────────────────── */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <KPICard
                            titulo="Viajes del mes"
                            valor={kpis.totalTrips}
                            subtitulo={mesLabel}
                            icono={<Truck size={22} />}
                            gradiente="bg-gradient-to-br from-[#007AFF] to-[#0055D4]"
                        />
                        <KPICard
                            titulo="Costo total"
                            valor={formatCurrency(kpis.totalCost)}
                            subtitulo="Acumulado del mes"
                            icono={<DollarSign size={22} />}
                            gradiente="bg-gradient-to-br from-[#34C759] to-[#248A3D]"
                        />
                        <KPICard
                            titulo="Costo promedio"
                            valor={formatCurrency(kpis.avgCost)}
                            subtitulo="Por viaje"
                            icono={<TrendingUp size={22} />}
                            gradiente="bg-gradient-to-br from-[#AF52DE] to-[#8944AB]"
                        />
                        <KPICard
                            titulo="Choferes activos"
                            valor={kpis.activeDrivers}
                            subtitulo="Con viajes este mes"
                            icono={<Filter size={22} />}
                            gradiente="bg-gradient-to-br from-[#FF9500] to-[#CC7700]"
                        />
                    </div>

                    {/* ── Charts grid ────────────────────────────────────────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Chart 1: Evolucion de costos */}
                        <ChartCard titulo="Evolucion de costos" height="300px">
                            {hasData ? (
                                <>
                                    <Line data={lineChartData} options={lineChartOptions} />
                                    <div className="flex items-center gap-5 mt-4">
                                        <div className="flex items-center gap-1.5">
                                            <span
                                                className="w-3 h-3 rounded-full inline-block"
                                                style={{ backgroundColor: '#007AFF' }}
                                            />
                                            <span className="text-[11px] text-[#8E8E93]">Propio</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span
                                                className="w-3 h-3 rounded-full inline-block"
                                                style={{ backgroundColor: '#FF9500' }}
                                            />
                                            <span className="text-[11px] text-[#8E8E93]">
                                                Tercerizado
                                            </span>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <EmptyChart mensaje="Sin datos de costos para este mes" />
                            )}
                        </ChartCard>

                        {/* Chart 2: Viajes por zona */}
                        <ChartCard
                            titulo="Viajes por zona"
                            height={`${Math.max(zoneCounts.length * 36, 200)}px`}
                        >
                            {hasData && zoneCounts.length > 0 ? (
                                <Bar data={zoneChartData} options={zoneChartOptions} />
                            ) : (
                                <EmptyChart mensaje="Sin datos de zonas para este mes" />
                            )}
                        </ChartCard>

                        {/* Chart 3: Distribucion por tipo de contrato */}
                        <ChartCard titulo="Distribucion por tipo de contrato" height="250px">
                            {hasData ? (
                                <>
                                    <Doughnut
                                        data={doughnutData}
                                        options={doughnutOptions}
                                        plugins={[centerTextPlugin]}
                                    />
                                    <div className="flex items-center justify-center gap-6 mt-4">
                                        <div className="flex items-center gap-1.5">
                                            <span
                                                className="w-3 h-3 rounded-full inline-block"
                                                style={{ backgroundColor: '#007AFF' }}
                                            />
                                            <span className="text-[11px] text-[#8E8E93]">
                                                Propio ({contractDist.propio})
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span
                                                className="w-3 h-3 rounded-full inline-block"
                                                style={{ backgroundColor: '#FF9500' }}
                                            />
                                            <span className="text-[11px] text-[#8E8E93]">
                                                Tercerizado ({contractDist.tercerizado})
                                            </span>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <EmptyChart mensaje="Sin datos de contratos para este mes" />
                            )}
                        </ChartCard>

                        {/* Chart 4: Costo por unidad de negocio */}
                        <ChartCard titulo="Costo por unidad de negocio" height="300px">
                            {hasData && buCosts.length > 0 ? (
                                <Bar data={buChartData} options={buChartOptions} />
                            ) : (
                                <EmptyChart mensaje="Sin datos de unidades de negocio para este mes" />
                            )}
                        </ChartCard>
                    </div>
                </>
            )}
        </div>
    );
};

export default LogisticsDashboard;
