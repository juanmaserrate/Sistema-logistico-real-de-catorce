import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Truck, MapPin, Users, RefreshCw, CheckCircle, Clock } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type TodayStats = {
    routesToday: number;
    routesCompleted: number;
    stopsTotal: number;
    stopsCompleted: number;
    stopsPending: number;
    activeTrackers: number;
    tripsToday: number;
    driversTotal: number;
};

type WeekDay = {
    date: string;
    routes: number;
    stops: number;
    completed: number;
};

type WeekStats = {
    days: WeekDay[];
};

const STATS_VACIAS: TodayStats = {
    routesToday: 0,
    routesCompleted: 0,
    stopsTotal: 0,
    stopsCompleted: 0,
    stopsPending: 0,
    activeTrackers: 0,
    tripsToday: 0,
    driversTotal: 0,
};

const INTERVALO_REFRESH_MS = 30_000;

// ─── Subcomponentes ───────────────────────────────────────────────────────────

type TarjetaGrandeProps = {
    titulo: string;
    valor: string | number;
    subtitulo?: string;
    icono: React.ReactNode;
    gradiente: string;
    pulsing?: boolean;
};

const TarjetaGrande = ({ titulo, valor, subtitulo, icono, gradiente, pulsing }: TarjetaGrandeProps) => (
    <div className={`rounded-2xl p-6 text-white shadow-sm ${gradiente} flex flex-col justify-between min-h-[140px]`}>
        <div className="flex items-start justify-between">
            <p className="text-sm font-medium opacity-90">{titulo}</p>
            <div className="opacity-80">{icono}</div>
        </div>
        <div>
            <div className="flex items-center gap-2">
                <p className="text-4xl font-bold tracking-tight">{valor}</p>
                {pulsing && (
                    <span className="relative flex h-3 w-3 mb-1">
                        <span
                            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                            style={{ backgroundColor: '#34C759' }}
                        />
                        <span
                            className="relative inline-flex rounded-full h-3 w-3"
                            style={{ backgroundColor: '#34C759' }}
                        />
                    </span>
                )}
            </div>
            {subtitulo && (
                <p className="text-xs mt-1 opacity-75">{subtitulo}</p>
            )}
        </div>
    </div>
);

type BarraProgresoProps = {
    completadas: number;
    total: number;
};

const BarraProgreso = ({ completadas, total }: BarraProgresoProps) => {
    const porcentaje = total > 0 ? Math.round((completadas / total) * 100) : 0;
    return (
        <div className="space-y-2">
            <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-[#1C1C1E]">
                    Paradas completadas
                </span>
                <span className="text-sm font-semibold text-[#007AFF]">
                    {porcentaje}%
                </span>
            </div>
            <div className="w-full bg-[#E5E7EB] rounded-full h-3 overflow-hidden">
                <div
                    className="h-3 rounded-full bg-[#34C759] transition-all duration-700 ease-out"
                    style={{ width: `${porcentaje}%` }}
                />
            </div>
            <div className="flex justify-between text-xs text-[#8E8E93]">
                <span>{completadas} completadas</span>
                <span>{total} totales</span>
            </div>
        </div>
    );
};

type EstadoRutasProps = {
    completadas: number;
    total: number;
};

const EstadoRutas = ({ completadas, total }: EstadoRutasProps) => {
    const pendientes = total - completadas;
    return (
        <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#1C1C1E]">Estado de rutas</h3>
            <div className="flex gap-4">
                <div className="flex items-center gap-2 flex-1 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                    <CheckCircle className="text-[#34C759] shrink-0" size={18} />
                    <div>
                        <p className="text-lg font-bold text-[#1C1C1E]">{completadas}</p>
                        <p className="text-xs text-[#8E8E93]">Completadas</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-1 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
                    <Clock className="text-orange-400 shrink-0" size={18} />
                    <div>
                        <p className="text-lg font-bold text-[#1C1C1E]">{pendientes}</p>
                        <p className="text-xs text-[#8E8E93]">Pendientes</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-1 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                    <BarChart3 className="text-[#007AFF] shrink-0" size={18} />
                    <div>
                        <p className="text-lg font-bold text-[#1C1C1E]">{total}</p>
                        <p className="text-xs text-[#8E8E93]">Total del día</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

type GraficoSemanalProps = {
    days: WeekDay[];
};

const GraficoSemanal = ({ days }: GraficoSemanalProps) => {
    const maxRoutes = Math.max(...days.map(d => d.routes), 1);

    const formatDia = (dateStr: string) => {
        const d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('es-AR', { weekday: 'short' });
    };

    return (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-[#1C1C1E] mb-4">Actividad de la semana</h3>
            <div className="flex items-end gap-2 h-24">
                {days.map((day, i) => {
                    const alturaRutas = Math.round((day.routes / maxRoutes) * 100);
                    const alturaCompletadas = day.routes > 0
                        ? Math.round((day.completed / day.routes) * alturaRutas)
                        : 0;

                    return (
                        <div key={i} className="flex flex-col items-center gap-1 flex-1">
                            <div
                                className="w-full relative rounded-t-md overflow-hidden"
                                style={{ height: `${Math.max(alturaRutas, 4)}%`, minHeight: '4px' }}
                                title={`${day.routes} rutas, ${day.completed} completadas`}
                            >
                                {/* Fondo: total de rutas */}
                                <div
                                    className="absolute inset-0 rounded-t-md"
                                    style={{ backgroundColor: '#BFDBFE' }}
                                />
                                {/* Superpuesto: completadas */}
                                <div
                                    className="absolute bottom-0 left-0 right-0 rounded-t-md transition-all duration-500"
                                    style={{
                                        height: `${alturaCompletadas > 0 ? Math.round((alturaCompletadas / alturaRutas) * 100) : 0}%`,
                                        backgroundColor: '#007AFF',
                                    }}
                                />
                            </div>
                            <span className="text-[10px] text-[#8E8E93] capitalize">
                                {formatDia(day.date)}
                            </span>
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center gap-4 mt-3">
                <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: '#BFDBFE' }} />
                    <span className="text-[11px] text-[#8E8E93]">Rutas totales</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: '#007AFF' }} />
                    <span className="text-[11px] text-[#8E8E93]">Completadas</span>
                </div>
            </div>
        </div>
    );
};

// ─── Componente principal ─────────────────────────────────────────────────────

const StatsManager = () => {
    const [stats, setStats] = useState<TodayStats>(STATS_VACIAS);
    const [cargando, setCargando] = useState(true);
    const [actualizando, setActualizando] = useState(false);
    const [sinDatos, setSinDatos] = useState(false);
    const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(null);
    const [weekStats, setWeekStats] = useState<WeekDay[] | null>(null);

    const cargarStats = useCallback(async (esManual = false) => {
        if (esManual) setActualizando(true);
        try {
            const res = await fetch('/api/v1/stats/today');
            if (!res.ok) {
                setStats(STATS_VACIAS);
                setSinDatos(true);
                return;
            }
            const data: TodayStats = await res.json();
            setStats(data);
            setSinDatos(false);
            setUltimaActualizacion(new Date());
        } catch {
            setStats(STATS_VACIAS);
            setSinDatos(true);
        } finally {
            setCargando(false);
            if (esManual) setActualizando(false);
        }
    }, []);

    const cargarWeek = useCallback(async () => {
        try {
            const res = await fetch('/api/v1/stats/week');
            if (!res.ok) return; // silently hide
            const data: WeekStats = await res.json();
            if (data?.days?.length) {
                setWeekStats(data.days);
            }
        } catch {
            // silently hide
        }
    }, []);

    // Carga inicial
    useEffect(() => {
        cargarStats();
        cargarWeek();
    }, [cargarStats, cargarWeek]);

    // Auto-refresh cada 30 segundos
    useEffect(() => {
        const intervalo = setInterval(() => {
            cargarStats();
            cargarWeek();
        }, INTERVALO_REFRESH_MS);
        return () => clearInterval(intervalo);
    }, [cargarStats, cargarWeek]);

    const formatearHora = (fecha: Date) =>
        fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Determina si estamos en la mañana temprano (antes de las 9am)
    const esTempranoSinActividad = () => {
        const hora = new Date().getHours();
        return hora < 9;
    };

    if (cargando) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-10 h-10 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in">

            {/* Encabezado ---------------------------------------------------- */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-[#1C1C1E]">Estadísticas del día</h2>
                    {ultimaActualizacion && !sinDatos && (
                        <div className="flex items-center gap-1.5 mt-1">
                            <Clock size={12} className="text-[#8E8E93]" />
                            <p className="text-xs text-[#8E8E93]">
                                Actualizado a las {formatearHora(ultimaActualizacion)}
                            </p>
                        </div>
                    )}
                </div>
                <button
                    onClick={() => cargarStats(true)}
                    disabled={actualizando}
                    className="flex items-center gap-2 px-4 py-2 bg-[#007AFF] text-white text-sm font-medium rounded-xl hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <RefreshCw size={15} className={actualizando ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>

            {/* Banner de sin datos ------------------------------------------- */}
            {sinDatos && (
                <div className="bg-amber-50 border border-amber-200 text-amber-700 px-5 py-3 rounded-2xl flex items-center gap-3 text-sm">
                    <Clock size={16} className="shrink-0" />
                    {esTempranoSinActividad() ? (
                        <span>
                            Aún no hay actividad registrada para hoy. Las estadísticas aparecerán cuando los choferes comiencen sus rutas.
                        </span>
                    ) : (
                        <>
                            <span className="font-medium">Actualizando estadísticas...</span>
                            <span className="text-amber-600 opacity-80">
                                El servidor aún no reportó datos para hoy.
                            </span>
                        </>
                    )}
                </div>
            )}

            {/* 4 tarjetas grandes -------------------------------------------- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <TarjetaGrande
                    titulo="Rutas hoy"
                    valor={stats.routesToday}
                    subtitulo={`${stats.routesCompleted} completadas`}
                    icono={<BarChart3 size={22} />}
                    gradiente="bg-gradient-to-br from-[#007AFF] to-[#0056CC]"
                />
                <TarjetaGrande
                    titulo="Paradas completadas"
                    valor={`${stats.stopsCompleted} / ${stats.stopsTotal}`}
                    subtitulo={`${stats.stopsPending} pendientes`}
                    icono={<MapPin size={22} />}
                    gradiente="bg-gradient-to-br from-[#34C759] to-[#248A3D]"
                />
                <TarjetaGrande
                    titulo="Choferes activos"
                    valor={stats.activeTrackers}
                    subtitulo="Con ping en últimos 30 min"
                    icono={<Users size={22} />}
                    gradiente="bg-gradient-to-br from-[#AF52DE] to-[#7B3F9E]"
                    pulsing={stats.activeTrackers > 0}
                />
                <TarjetaGrande
                    titulo="Viajes del día"
                    valor={stats.tripsToday}
                    subtitulo={`${stats.driversTotal} choferes en total`}
                    icono={<Truck size={22} />}
                    gradiente="bg-gradient-to-br from-[#FF9500] to-[#CC7700]"
                />
            </div>

            {/* Panel inferior: barra de progreso + estado de rutas ----------- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Barra de progreso de paradas */}
                <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                    <BarraProgreso
                        completadas={stats.stopsCompleted}
                        total={stats.stopsTotal}
                    />
                </div>

                {/* Estado de rutas */}
                <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                    <EstadoRutas
                        completadas={stats.routesCompleted}
                        total={stats.routesToday}
                    />
                </div>

            </div>

            {/* Gráfico semanal (solo si hay datos) --------------------------- */}
            {weekStats && weekStats.length > 0 && (
                <GraficoSemanal days={weekStats} />
            )}

            {/* Mini-card de choferes registrados ----------------------------- */}
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#FF9500] to-[#CC7700]">
                            <Users size={20} className="text-white" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-[#1C1C1E]">Choferes registrados</p>
                            <p className="text-xs text-[#8E8E93]">Total en el sistema</p>
                        </div>
                    </div>
                    <p className="text-3xl font-bold text-[#1C1C1E]">{stats.driversTotal}</p>
                </div>
            </div>

        </div>
    );
};

export default StatsManager;
