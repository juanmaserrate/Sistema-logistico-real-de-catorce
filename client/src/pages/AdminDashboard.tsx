
import { useState, Component, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    LogOut, 
    Truck, 
    Settings, 
    School,
    AlertCircle,
    ChevronRight,
    Search,
    Wrench,
    Package,
    Navigation,
    CalendarCheck
} from 'lucide-react';
import clsx from 'clsx';

// Components
import ClientManager from '../components/ClientManager';
import SystemSettings from '../components/SystemSettings';
import MaintenanceManager from '../components/MaintenanceManager';
import RepartosManager from '../components/RepartosManager';
import TrackingManager from '../components/TrackingManager';
import PlanningManager from '../components/PlanningManager';

class TabErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }> {
    state = { hasError: false };
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    render() {
        if (this.state.hasError) return this.props.fallback;
        return this.props.children;
    }
}

const AdminDashboard = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('planificacion');
    const userFullName = localStorage.getItem('driverName') || 'Administrador';

    const menuItems = [
        { id: 'planificacion', label: 'Planificación', icon: CalendarCheck },
        { id: 'repartos', label: 'Repartos', icon: Package },
        { id: 'schools', label: 'Escuelas / Clientes', icon: School },
        { id: 'tracking', label: 'Rastreo satelital', icon: Navigation },
        { id: 'maintenance', label: 'Mantenimiento', icon: Wrench },
        { id: 'settings', label: 'Configuración', icon: Settings },
    ];

    const logout = () => {
        localStorage.clear();
        navigate('/');
    };

    return (
        <div className="flex h-screen bg-[#F8F9FB] font-sans">
            {/* Sidebar */}
            <aside className="w-72 bg-white border-r border-[#E5E7EB] flex flex-col">
                <div className="p-8">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="bg-[#007AFF] p-2 rounded-xl shadow-lg shadow-blue-200">
                             <Truck className="text-white" size={24} />
                        </div>
                        <div>
                             <h2 className="font-bold text-[#1C1C1E] text-lg leading-tight uppercase tracking-tight">Real R14</h2>
                             <p className="text-[10px] text-[#8E8E93] font-bold uppercase tracking-widest mt-0.5">Control Tower v3</p>
                        </div>
                    </div>

                    <nav className="space-y-1.5">
                        {menuItems.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                className={clsx(
                                    "w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all duration-200 text-[14px] font-semibold",
                                    activeTab === item.id 
                                        ? "bg-[#007AFF] text-white shadow-md shadow-blue-100" 
                                        : "text-[#636366] hover:bg-[#F2F2F7] hover:text-[#1C1C1E]"
                                )}
                            >
                                <item.icon size={20} />
                                {item.label}
                                {activeTab === item.id && <ChevronRight size={14} className="ml-auto opacity-60" />}
                            </button>
                        ))}
                    </nav>
                </div>

                <div className="mt-auto p-8 border-t border-[#F2F2F7]">
                    <div className="flex items-center gap-3 mb-6 p-1">
                        <div className="w-10 h-10 rounded-full bg-[#E5E7EB] flex items-center justify-center text-[#1C1C1E] font-bold">
                            {userFullName.charAt(0)}
                        </div>
                        <div className="overflow-hidden">
                            <p className="text-[14px] font-bold text-[#1C1C1E] truncate">{userFullName}</p>
                            <p className="text-[11px] text-[#8E8E93] font-medium uppercase tracking-wide">Root Admin</p>
                        </div>
                    </div>
                    <button 
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-red-500 hover:bg-red-50 transition-colors text-[14px] font-bold"
                    >
                        <LogOut size={18} />
                        Cerrar Sesión
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden flex flex-col">
                {/* Header */}
                <header className="h-20 bg-white/80 backdrop-blur-md border-b border-[#E5E7EB] px-10 flex items-center justify-between sticky top-0 z-10">
                    <div>
                        <h1 className="text-[20px] font-bold text-[#1C1C1E]">
                            {menuItems.find(i => i.id === activeTab)?.label}
                        </h1>
                        <p className="text-[13px] text-[#8E8E93] font-medium">Dashboard • {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative group">
                             <Search className="absolute left-3 top-2.5 text-[#AEAEB2] group-focus-within:text-[#007AFF] transition-colors" size={18} />
                             <input 
                                type="text" 
                                placeholder="Buscar ruta, escuela o chofer..."
                                className="bg-[#F2F2F7] border-none rounded-full py-2.5 pl-10 pr-6 text-[13px] w-72 focus:ring-2 focus:ring-[#007AFF] transition-all"
                             />
                        </div>
                        <button className="bg-white border border-[#E5E7EB] p-2.5 rounded-full text-[#636366] hover:bg-[#F2F2F7] transition-all relative">
                            <AlertCircle size={20} />
                            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 border-2 border-white rounded-full"></span>
                        </button>
                    </div>
                </header>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-10 bg-[#F8F9FB]">
                    {activeTab === 'planificacion' && <PlanningManager />}
                    {activeTab === 'repartos' && <RepartosManager />}
                    {activeTab === 'schools' && <ClientManager />}
                    {activeTab === 'tracking' && <TrackingManager />}
                    {activeTab === 'maintenance' && (
                    <TabErrorBoundary fallback={
                        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-12 text-center">
                            <p className="text-[#8E8E93] font-medium mb-4">Error al cargar Mantenimiento.</p>
                            <button type="button" onClick={() => window.location.reload()} className="text-[#007AFF] font-bold underline">Recargar página</button>
                        </div>
                    }>
                        <MaintenanceManager />
                    </TabErrorBoundary>
                    )}
                    {activeTab === 'settings' && <SystemSettings />}
                </div>
            </main>
        </div>
    );
};

export default AdminDashboard;
