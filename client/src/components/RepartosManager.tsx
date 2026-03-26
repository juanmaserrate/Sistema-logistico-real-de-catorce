import { useState, useEffect } from 'react';
import { Package, AlertCircle } from 'lucide-react';

type Establishment = {
    excelName: string;
    sequence: number;
    displayName: string;
    clientId: string | null;
    address: string | null;
};

type Reparto = {
    id: string;
    name: string;
    establishments: Establishment[];
};

const RepartosManager = () => {
    const [repartos, setRepartos] = useState<Reparto[]>([]);
    const [unmatchedEstablishments, setUnmatchedEstablishments] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [apiError, setApiError] = useState<string | null>(null);

    const fetchRepartos = async () => {
        setApiError(null);
        try {
            const res = await fetch('/api/v1/repartos');
            const data = await res.json();
            if (Array.isArray(data)) {
                setRepartos(data);
                setUnmatchedEstablishments([]);
            } else {
                setRepartos(data.repartos ?? []);
                setUnmatchedEstablishments(data.unmatchedEstablishments ?? []);
            }
        } catch (e) {
            setApiError('API no disponible. Comprueba que el servidor esté encendido.');
            setRepartos([]);
            setUnmatchedEstablishments([]);
        }
    };

    useEffect(() => {
        setLoading(true);
        fetchRepartos().finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-10 h-10 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in">
            {apiError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-2xl flex items-center justify-between gap-4">
                    <span className="font-medium">{apiError}</span>
                    <button type="button" onClick={() => setApiError(null)} className="text-red-800 font-bold text-sm underline">
                        Cerrar
                    </button>
                </div>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-[22px] font-bold text-[#1C1C1E]">Repartos</h2>
                    <p className="text-[14px] text-[#8E8E93] font-medium">
                        Cargados desde el Excel del Escritorio. Los establecimientos se vinculan solos con Escuelas/Clientes; el nombre del reparto reemplaza al del colegio. Depósito: Real 14 — Ombu 1269, Burzaco.
                    </p>
                </div>
            </div>

            {unmatchedEstablishments.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4">
                    <p className="font-bold text-amber-800 text-[14px] flex items-center gap-2">
                        <AlertCircle size={18} />
                        Establecimientos que no hicieron match
                    </p>
                    <p className="text-[13px] text-amber-700 mt-1">Estos nombres del Excel no se vincularon a ningún cliente en Escuelas/Clientes:</p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                        {unmatchedEstablishments.map((name) => (
                            <li key={name} className="bg-white/80 text-amber-900 px-3 py-1.5 rounded-lg text-[13px] font-medium">
                                {name}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {repartos.length === 0 ? (
                <div className="bg-white rounded-[24px] border border-[#E5E7EB] p-16 text-center">
                    <Package className="mx-auto text-[#AEAEB2]" size={56} />
                    <p className="text-[#8E8E93] font-medium mt-4">No hay repartos.</p>
                    <p className="text-[13px] text-[#AEAEB2] mt-2">
                        Dejá &quot;Repartos y colegios.xlsx&quot; en el Escritorio (columna A = reparto, columna B = establecimiento) y volvé a abrir esta pestaña.
                    </p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
                    <ul className="divide-y divide-[#E5E7EB]">
                        {repartos.map((reparto) => (
                            <li key={reparto.id}>
                                <div className="px-6 py-3 bg-[#F8F9FB] border-b border-[#E5E7EB]">
                                    <h3 className="text-[15px] font-bold text-[#1C1C1E] uppercase tracking-tight">{reparto.name}</h3>
                                    <p className="text-[12px] text-[#8E8E93] font-medium mt-0.5">{reparto.establishments.length} establecimiento(s)</p>
                                </div>
                                <ol className="list-decimal list-inside divide-y divide-[#F2F2F7]">
                                    {reparto.establishments.map((est, idx) => (
                                        <li key={`${reparto.id}-${idx}-${est.excelName}`} className="px-6 py-2.5 text-[14px] text-[#1C1C1E]">
                                            <span className="font-medium">{est.displayName}</span>
                                            {est.address && (
                                                <span className="text-[12px] text-[#8E8E93] ml-2">— {est.address}</span>
                                            )}
                                        </li>
                                    ))}
                                </ol>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default RepartosManager;
