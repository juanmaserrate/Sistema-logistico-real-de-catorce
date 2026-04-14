/**
 * R14 — Funciones utilitarias puras
 * No dependen del DOM ni de estado global.
 * Cargado ANTES del script principal de planificacion.html.
 */

/** Fecha actual en zona horaria Argentina (Buenos Aires) */
function nowBuenosAires() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(new Date());
    const get = type => parseInt(parts.find(p => p.type === type).value, 10);
    return { month: get('month') - 1, year: get('year'), day: get('day') };
}

/** Debounce genérico */
function debounce(fn, ms) {
    let t;
    return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

/** Normaliza string para comparación: minúsculas, sin acentos, solo alfanumérico */
function norm(s) {
    if (!s) return '';
    return s.toString().toLowerCase()
           .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
           .replace(/[^a-z0-9]/g, "");
}

/** Normaliza unidad de negocio: trim + uppercase */
function normalizeBusinessUnit(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Metadatos de un mes por nombre (español) */
function getMonthMeta(monthName) {
    const names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const monthIndex = Math.max(0, names.indexOf(monthName));
    const year = 2026;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    return { year, monthIndex, daysInMonth };
}

/** Date → "YYYY-MM-DD" */
function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Formatea unidad de negocio para display */
function formatBusinessUnit(value) {
    const raw = (value || 'REPARTOS').toString().trim();
    return /esc\s*verano/i.test(raw) ? 'SAE' : raw;
}

/** Milisegundos → "Xh Y min" legible */
function formatDurationFromMs(diffMs) {
    if (isNaN(diffMs) || diffMs <= 0) return null;
    const totalMinutes = Math.round(diffMs / (1000 * 60));
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    if (hh === 0) return `${mm} min`;
    if (mm === 0) return `${hh} hs`;
    return `${hh} h ${mm} min`;
}

/** Escapa HTML para inserción segura en innerHTML */
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Aliases para compatibilidad con código existente
const escapeHtmlWeekly = escapeHtml;
const escapeHtmlTrip = escapeHtml;
