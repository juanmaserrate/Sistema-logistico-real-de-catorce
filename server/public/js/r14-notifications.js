/**
 * R14 — Sistema de notificaciones y toasts
 * Incluye el parche global de fetch para inyectar Bearer token
 * y mostrar toasts en cada mutación HTTP.
 *
 * Depende de: lucide (externo), API_URL (global)
 */

let notifications = [];

function cleanupOldNotifications() {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    notifications = notifications.filter(n => n.id >= twentyFourHoursAgo);
}

function toggleNotifications() {
    const panel = document.getElementById('notif-panel');
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    renderNotifications();
}

function renderNotifications() {
    cleanupOldNotifications();
    const list = document.getElementById('notif-list');
    const total = document.getElementById('notif-total');
    const badge = document.getElementById('notif-count');

    list.innerHTML = notifications.map(n => `
        <div class="notification-item p-4 notif-${n.type} group relative">
            <div class="flex justify-between items-start">
                <h5 class="text-xs font-black text-[#1B2559] uppercase tracking-tight">${n.title}</h5>
                <div class="flex items-center gap-2">
                    <span class="text-[9px] font-bold text-[#A3AED0]">${n.time}</span>
                    <button onclick="removeNotification(${n.id})" class="p-1 text-[#A3AED0] hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                        <i data-lucide="x" class="w-3 h-3"></i>
                    </button>
                </div>
            </div>
            <p class="text-[11px] text-[#A3AED0] mt-1 leading-relaxed pr-6">${n.text}</p>
        </div>
    `).join('');

    total.innerText = `${notifications.length} Nuevas`;
    if (badge) {
        if (notifications.length > 0) {
            badge.innerText = notifications.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    lucide.createIcons();
}

function addNotification(type, title, text) {
    const normalizedType = ['info', 'warning', 'critical', 'success'].includes(type) ? type : 'info';
    notifications.unshift({ id: Date.now(), type: normalizedType, title, text, time: 'Ahora' });
    renderNotifications();
    showToastNotification(normalizedType, title, text);
}

function getToastContainer() {
    let el = document.getElementById('toast-container');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast-container';
        el.className = 'fixed top-6 right-6 z-[140] space-y-2 pointer-events-none';
        document.body.appendChild(el);
    }
    return el;
}

function showToastNotification(type, title, text) {
    const container = getToastContainer();
    const toast = document.createElement('div');
    const palette = {
        info: 'bg-indigo-600 text-white',
        success: 'bg-emerald-600 text-white',
        warning: 'bg-amber-500 text-[#1B2559]',
        critical: 'bg-rose-600 text-white'
    };
    const color = palette[type] || palette.info;
    toast.className = `pointer-events-auto max-w-sm rounded-2xl shadow-xl px-4 py-3 text-sm font-medium transition-all duration-300 opacity-0 translate-y-2 ${color}`;
    toast.innerHTML = `
        <div class="font-black text-xs uppercase tracking-wide">${title || 'Notificación'}</div>
        <div class="mt-1 text-xs leading-relaxed">${text || ''}</div>
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', 'translate-y-2');
    });
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// Modo estricto: toast automático para TODA mutación HTTP + inyección de token.
(function enableGlobalMutationToasts() {
    if (!window.fetch || window.__r14MutationToastsPatched) return;
    window.__r14MutationToastsPatched = true;
    const baseFetch = window.fetch.bind(window);
    const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    const skipPatterns = [
        /\/api\/v1\/alerts\/cleanup$/i
    ];

    function shouldSkipToast(url) {
        return skipPatterns.some((rx) => rx.test(url));
    }

    function extractUrl(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return '';
    }

    window.fetch = async function patchedFetch(input, init) {
        const method = String(init?.method || input?.method || 'GET').toUpperCase();
        const url = extractUrl(input);
        const isMutation = mutationMethods.has(method);
        const skipToast = shouldSkipToast(url);

        // Inyectar token en todas las llamadas a /api/
        const token = localStorage.getItem('r14.authToken');
        if (token && url.includes('/api/')) {
            const existingHeaders = (init && init.headers) ? init.headers : {};
            const hasAuth = typeof existingHeaders === 'object'
                ? (existingHeaders['Authorization'] || existingHeaders['authorization'])
                : false;
            if (!hasAuth) {
                init = Object.assign({}, init, {
                    headers: Object.assign({}, existingHeaders, { 'Authorization': `Bearer ${token}` })
                });
            }
        }

        try {
            const res = await baseFetch(input, init);
            if (isMutation && !skipToast) {
                if (res.ok) {
                    showToastNotification('success', 'Operación guardada', `${method} completado correctamente.`);
                } else {
                    showToastNotification('warning', 'Operación con error', `${method} respondió ${res.status}.`);
                }
            }
            return res;
        } catch (e) {
            if (isMutation && !skipToast) {
                showToastNotification('critical', 'Error de red', `${method} no pudo completarse.`);
            }
            throw e;
        }
    };
})();

function removeNotification(id) {
    notifications = notifications.filter(n => n.id !== id);
    renderNotifications();
}

function clearNotifications() {
    if (notifications.length === 0) return;
    if (confirm('¿Desea eliminar todas las notificaciones?')) {
        notifications = [];
        renderNotifications();
    }
}

/** Wrapper: alerta al usuario por nombre de módulo */
function notifyUsers(message, type = 'info') {
    if (typeof addNotification === 'function') {
        addNotification(type, 'Usuarios', message);
        return;
    }
    alert(message);
}

// Auto-cleanup every minute
setInterval(cleanupOldNotifications, 60000);
