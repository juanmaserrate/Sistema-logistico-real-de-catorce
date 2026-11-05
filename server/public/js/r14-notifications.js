/**
 * R14 — Sistema de notificaciones y toasts
 * Incluye el parche global de fetch para inyectar Bearer token
 * y mostrar toasts en cada mutación HTTP.
 *
 * Depende de: lucide (externo), API_URL (global)
 */

let notifications = [];
let _notifSiguienteId = 1;

function cleanupOldNotifications() {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    notifications = notifications.filter(n => (n.ts || n.id) >= twentyFourHoursAgo);
}

/** Nombres de choferes y errores del servidor van adentro del HTML: un "<"
 *  en un nombre rompia el panel. */
function _notifEsc(v) {
    return (typeof escapeHtml === 'function') ? escapeHtml(v == null ? '' : String(v)) : String(v == null ? '' : v);
}

/** "Ahora", "hace 5 min", "hace 2 h". Antes decia "Ahora" para siempre. */
function _notifHace(ts) {
    const min = Math.floor((Date.now() - ts) / 60000);
    if (!ts || min < 1) return 'Ahora';
    if (min < 60) return `hace ${min} min`;
    return `hace ${Math.floor(min / 60)} h`;
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

    // Sin notificaciones: el cartel vuelve. Antes, despues de "Limpiar" la
    // lista quedaba en blanco.
    list.innerHTML = notifications.length ? notifications.map(n => `
        <div class="notification-item p-4 notif-${n.type} group relative">
            <div class="flex justify-between items-start gap-2">
                <h5 class="text-xs font-black text-[#1B2559] uppercase tracking-tight min-w-0">${_notifEsc(n.title)}</h5>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="text-[9px] font-bold text-[#A3AED0] whitespace-nowrap">${_notifHace(n.ts)}</span>
                    <button onclick="removeNotification(${n.id})" aria-label="Quitar" class="p-1 text-[#A3AED0] hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-colors">
                        <i data-lucide="x" class="w-3 h-3"></i>
                    </button>
                </div>
            </div>
            <p class="text-[11px] text-[#A3AED0] mt-1 leading-relaxed pr-6">${_notifEsc(n.text)}</p>
        </div>
    `).join('') : '<div class="p-8 text-center text-[#A3AED0] text-xs italic">No hay notificaciones nuevas</div>';

    const cant = notifications.length;
    total.innerText = cant === 1 ? '1 nueva' : `${cant} nuevas`;
    if (badge) {
        if (cant > 0) {
            badge.innerText = cant > 99 ? '99+' : cant;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    lucide.createIcons();
}

function addNotification(type, title, text) {
    // 'error' faltaba en la lista: los 25 avisos de error salian como info
    // (violeta), iguales a un aviso comun.
    const normalizedType = ['info', 'warning', 'critical', 'success', 'error'].includes(type) ? type : 'info';
    // Id propio: con Date.now() dos avisos del mismo milisegundo tenian el
    // mismo id y la X borraba los dos.
    notifications.unshift({ id: _notifSiguienteId++, ts: Date.now(), type: normalizedType, title, text });
    renderNotifications();
    // La campana solo se mueve para lo que hay que mirar. Un "guardado" que
    // confirma lo que el operador acaba de hacer ya lo confirma el boton:
    // ahi solo sube el numero.
    if (normalizedType !== 'success' && normalizedType !== 'info') avisarEnLaCampana();
    showToastNotification(normalizedType, title, text);
}

/** El toast flotante esta apagado a pedido, asi que una notificacion nueva
 *  pasaba sin que nadie la viera. La campana late un momento: avisa sin tapar
 *  la pantalla ni pedir que se la cierre. */
function avisarEnLaCampana() {
    const badge = document.getElementById('notif-count');
    const campana = badge && badge.closest('button');
    if (!campana) return;
    if (!document.getElementById('r14-campana-css')) {
        const css = document.createElement('style');
        css.id = 'r14-campana-css';
        // Una sacudida corta (antes eran dos de 0.7s, casi un segundo y medio)
        css.textContent = '@keyframes r14Campana{0%,100%{transform:none}'
            + '25%{transform:scale(1.12) rotate(-8deg)}50%{transform:scale(1.12) rotate(8deg)}'
            + '75%{transform:scale(1.05) rotate(-4deg)}}'
            + '.r14-campana-late{animation:r14Campana .45s cubic-bezier(0.4,0,0.2,1)}'
            + '@media (prefers-reduced-motion:reduce){.r14-campana-late{animation:none}}';
        document.head.appendChild(css);
    }
    campana.classList.remove('r14-campana-late');
    void campana.offsetWidth;          // reinicia la animacion si ya estaba corriendo
    campana.classList.add('r14-campana-late');
    setTimeout(() => campana.classList.remove('r14-campana-late'), 600);
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

function showToastNotification(/* type, title, text */) {
    // Desactivado a pedido: solo la campana de notificaciones, sin toast flotante.
    return;
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
    // 409 Conflict es esperado en sync de empleados (usuario ya existe) — no mostrar toast
    const silentStatusCodes = new Set([409]);

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
            if (isMutation && !skipToast && !window.__r14Initializing) {
                if (res.ok) {
                    showToastNotification('success', 'Operación guardada', `${method} completado correctamente.`);
                } else if (!silentStatusCodes.has(res.status)) {
                    showToastNotification('warning', 'Operación con error', `${method} respondió ${res.status}.`);
                }
            }
            return res;
        } catch (e) {
            if (isMutation && !skipToast && !window.__r14Initializing) {
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
