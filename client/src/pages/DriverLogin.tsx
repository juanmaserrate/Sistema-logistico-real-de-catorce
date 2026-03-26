import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Lock, User, UserPlus, ArrowRight } from 'lucide-react';
import { API_BASE } from '../config';

const DriverLogin = () => {
    const navigate = useNavigate();
    const [isRegistering, setIsRegistering] = useState(false);
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        fullName: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const endpoint = isRegistering ? `${API_BASE}/api/auth/register` : `${API_BASE}/api/auth/login`;

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();

            if (res.ok && data.success) {
                const user = data.user;
                localStorage.setItem('driverName', user.fullName);
                localStorage.setItem('driverId', user.id);
                localStorage.setItem('driverRole', user.role);
                localStorage.setItem('tenantId', user.tenantId);
                
                if (user.role === 'ADMIN') {
                    navigate('/admin');
                } else {
                    navigate('/portal');
                }
            } else {
                setError(data.error || 'API no disponible. Comprueba que el servidor esté encendido.');
            }
        } catch (err) {
            setError('API no disponible. Comprueba que el servidor esté encendido.');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <div className="min-h-screen bg-[#F2F2F7] flex flex-col items-center justify-center p-6">
            
            {/* Logo Area */}
            <div className="mb-10 text-center animate-fade-in-up">
                <div className="inline-flex items-center justify-center w-[88px] h-[88px] bg-white rounded-[22px] shadow-[0_8px_30px_rgba(0,0,0,0.06)] mb-6">
                    <Truck size={42} className="text-[#007AFF]" />
                </div>
                <h1 className="text-[28px] font-bold text-[#1C1C1E] tracking-tight -mb-1">Real de Catorce</h1>
                <p className="text-[#8E8E93] font-medium text-[15px]">Logística Móvil</p>
            </div>

            {/* iOS Card */}
            <div className="w-full max-w-[360px] animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
                <div className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] p-8">
                    
                    <h2 className="text-[22px] font-bold text-center mb-6 text-[#1C1C1E]">
                        {isRegistering ? 'Crear Cuenta' : 'Iniciar Sesión'}
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        
                        {isRegistering && (
                             <div className="relative">
                                <User className="absolute left-4 top-3.5 text-[#AEAEB2] w-[20px] h-[20px]" />
                                <input
                                    type="text"
                                    name="fullName"
                                    required={isRegistering}
                                    placeholder="Nombre Completo"
                                    value={formData.fullName}
                                    onChange={handleChange}
                                    className="apple-input w-full pl-12 uppercase"
                                />
                            </div>
                        )}

                        <div className="relative">
                            <UserPlus className="absolute left-4 top-3.5 text-[#AEAEB2] w-[20px] h-[20px]" />
                            <input
                                type="text"
                                name="username"
                                required
                                placeholder="Usuario"
                                value={formData.username}
                                onChange={handleChange}
                                className="apple-input w-full pl-12"
                            />
                        </div>

                        <div className="relative">
                            <Lock className="absolute left-4 top-3.5 text-[#AEAEB2] w-[20px] h-[20px]" />
                            <input
                                type="password"
                                name="password"
                                required
                                placeholder="Contraseña"
                                value={formData.password}
                                onChange={handleChange}
                                className="apple-input w-full pl-12"
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-red-50 rounded-xl border border-red-100 text-red-600 text-[13px] font-medium text-center">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="apple-button w-full py-4 mt-2 flex justify-center items-center gap-2"
                        >
                            {loading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    {isRegistering ? 'Registrarse' : 'Ingresar'}
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>
                </div>

                <div className="mt-8 text-center">
                    <button
                        onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
                        className="text-[#007AFF] text-[15px] font-medium hover:underline"
                    >
                        {isRegistering 
                            ? '¿Ya tienes cuenta? Inicia Sesión' 
                            : '¿Eres nuevo? Regístrate aquí'}
                    </button>
                    
                    <p className="mt-8 text-[11px] text-[#AEAEB2] font-medium">
                        R14 v2.1 • Designed in California style
                    </p>
                </div>
            </div>
        </div>
    );
};

export default DriverLogin;
