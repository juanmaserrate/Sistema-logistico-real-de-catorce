
import { useState } from 'react';
import { 
    Shield, 
    Save, 
    Dna, 
    Layers, 
    Database,
    Globe
} from 'lucide-react';
import clsx from 'clsx';

const SystemSettings = () => {
    const [settings, setSettings] = useState({
        solverTimeLimit: 30,
        matrixCache: true,
        strictWindows: false,
        priorityWeight: 10,
        notifications: {
            delay: true,
            completed: false
        }
    });

    const sections = [
        { id: 'general', label: 'General', icon: Layers },
        { id: 'vrp', label: 'Motor VRP', icon: Dna },
        { id: 'security', label: 'Seguridad', icon: Shield },
        { id: 'db', label: 'Base de Datos', icon: Database },
    ];
    const [activeSection, setActiveSection] = useState('vrp');

    return (
        <div className="flex gap-10 animate-fade-in">
            {/* Sidebar Interna */}
            <div className="w-64 space-y-2">
                {sections.map(s => (
                    <button 
                        key={s.id}
                        onClick={() => setActiveSection(s.id)}
                        className={clsx(
                            "w-full flex items-center gap-3 px-5 py-3 rounded-2xl font-bold text-[14px] transition-all",
                            activeSection === s.id ? "bg-white shadow-sm text-[#007AFF]" : "text-[#8E8E93] hover:text-[#1C1C1E]"
                        )}
                    >
                        <s.icon size={18} />
                        {s.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 bg-white p-10 rounded-[40px] border border-[#E5E7EB] shadow-sm">
                {activeSection === 'vrp' && (
                    <div className="space-y-10">
                        <div>
                            <h3 className="text-[20px] font-bold text-[#1C1C1E] mb-2">Configuración del Solver</h3>
                            <p className="text-[14px] text-[#8E8E93] font-medium">Ajusta los parámetros del algoritmo de optimización genética.</p>
                        </div>

                        <div className="space-y-8">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[15px] font-bold text-[#1C1C1E]">Límite de Tiempo (segundos)</p>
                                    <p className="text-[12px] text-[#8E8E93] font-medium">Tiempo máximo que el solver dedicará a buscar la mejor ruta.</p>
                                </div>
                                <input 
                                    type="number" 
                                    className="apple-input w-24 text-center" 
                                    value={settings.solverTimeLimit}
                                    onChange={e => setSettings({...settings, solverTimeLimit: parseInt(e.target.value)})}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[15px] font-bold text-[#1C1C1E]">Caché de Matrices</p>
                                    <p className="text-[12px] text-[#8E8E93] font-medium">Usar distancias guardadas para reducir carga de procesamiento.</p>
                                </div>
                                <button 
                                    onClick={() => setSettings({...settings, matrixCache: !settings.matrixCache})}
                                    className={clsx(
                                        "w-14 h-8 rounded-full p-1 transition-all duration-300",
                                        settings.matrixCache ? "bg-[#34C759]" : "bg-[#AEAeb2]"
                                    )}
                                >
                                    <div className={clsx("w-6 h-6 bg-white rounded-full shadow-sm transform transition-all", settings.matrixCache ? "translate-x-6" : "translate-x-0")} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[15px] font-bold text-[#1C1C1E]">Ventanas Horarias Estrictas</p>
                                    <p className="text-[12px] text-[#8E8E93] font-medium">Si se activa, el solver descartará planes si una parada excede su ventana.</p>
                                </div>
                                <button 
                                    onClick={() => setSettings({...settings, strictWindows: !settings.strictWindows})}
                                    className={clsx(
                                        "w-14 h-8 rounded-full p-1 transition-all duration-300",
                                        settings.strictWindows ? "bg-[#34C759]" : "bg-[#AEAeb2]"
                                    )}
                                >
                                    <div className={clsx("w-6 h-6 bg-white rounded-full shadow-sm transform transition-all", settings.strictWindows ? "translate-x-6" : "translate-x-0")} />
                                </button>
                            </div>

                            <div className="pt-8 border-t border-[#F2F2F7] flex justify-end">
                                <button className="apple-button px-8 flex items-center gap-2">
                                     <Save size={18} />
                                     Guardar Cambios
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection !== 'vrp' && (
                    <div className="flex flex-col items-center justify-center h-full py-20 text-center opacity-40">
                         <Globe size={64} strokeWidth={1} className="mb-4" />
                         <p className="font-bold text-[#1C1C1E]">Sección en Desarrollo</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SystemSettings;
