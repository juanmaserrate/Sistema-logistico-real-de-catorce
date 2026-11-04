// Reproduce la logica nueva de aplicarTarifasAViajes con casos de prueba.
const diaDe = t => new Date(t.date).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const arranqueDe = t => {
    const v = t.linkedRoute?.actualStartTime || t.exitTime;
    const n = v ? new Date(v).getTime() : NaN;
    return Number.isFinite(n) ? n : Infinity;
};
const loAclaroElOperador = t =>
    /PAGA\s+(APARTE|TAMBIEN)|SE\s+PAGA\s+APARTE/i.test(String(t.observations || '') + ' ' + String(t.notes || ''));

function primeros(viajes) {
    const set = new Set(), g = new Map();
    for (const t of viajes) {
        const ch = String(t.driver || '').trim().toUpperCase();
        if (!ch) { set.add(t.id); continue; }
        const k = diaDe(t) + '|' + ch;
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(t);
    }
    for (const l of g.values()) { l.sort((a, b) => arranqueDe(a) - arranqueDe(b) || a.id - b.id); set.add(l[0].id); }
    return set;
}

const V = [
    // dos viajes del mismo chofer el mismo dia: cobra el de la mañana
    { id: 1, date: '2026-10-02T15:00:00Z', driver: 'MARTELLI', exitTime: '2026-10-02T08:48:00Z' },
    { id: 2, date: '2026-10-02T15:00:00Z', driver: 'MARTELLI', exitTime: '2026-10-02T11:46:00Z' },
    // el segundo tiene aclaracion del operador
    { id: 3, date: '2026-10-03T15:00:00Z', driver: 'GALARZA', exitTime: '2026-10-03T08:00:00Z' },
    { id: 4, date: '2026-10-03T15:00:00Z', driver: 'GALARZA', exitTime: '2026-10-03T14:00:00Z', observations: 'evento, se paga aparte' },
    // el de la mañana no tiene hora: va al final, cobra el que si la tiene
    { id: 5, date: '2026-10-04T15:00:00Z', driver: 'AVALOS', exitTime: null },
    { id: 6, date: '2026-10-04T15:00:00Z', driver: 'AVALOS', exitTime: '2026-10-04T08:04:00Z' },
    // uno solo en el dia: cobra
    { id: 7, date: '2026-10-05T15:00:00Z', driver: 'VERBES', exitTime: '2026-10-05T09:00:00Z' },
    // sin chofer: no se puede agrupar, cobra
    { id: 8, date: '2026-10-06T15:00:00Z', driver: '', exitTime: '2026-10-06T09:00:00Z' },
    // tres del mismo chofer: solo el primero
    { id: 9,  date: '2026-10-07T15:00:00Z', driver: 'INSAURRALDE', exitTime: '2026-10-07T08:00:00Z' },
    { id: 10, date: '2026-10-07T15:00:00Z', driver: 'INSAURRALDE', exitTime: '2026-10-07T12:00:00Z' },
    { id: 11, date: '2026-10-07T15:00:00Z', driver: 'INSAURRALDE', exitTime: '2026-10-07T18:00:00Z' },
    // la ruta manda sobre exitTime
    { id: 12, date: '2026-10-08T15:00:00Z', driver: 'GUIDA', exitTime: '2026-10-08T06:00:00Z', linkedRoute: { actualStartTime: '2026-10-08T14:00:00Z' } },
    { id: 13, date: '2026-10-08T15:00:00Z', driver: 'GUIDA', exitTime: '2026-10-08T20:00:00Z', linkedRoute: { actualStartTime: '2026-10-08T09:00:00Z' } },
];

const P = primeros(V);
const cobra = t => P.has(t.id) || loAclaroElOperador(t);
const esperado = { 1: true, 2: false, 3: true, 4: true, 5: false, 6: true, 7: true, 8: true,
                   9: true, 10: false, 11: false, 12: false, 13: true };
let fallas = 0;
for (const t of V) {
    const got = cobra(t), exp = esperado[t.id];
    if (got !== exp) { fallas++; console.log('FALLA viaje ' + t.id + ': esperaba ' + exp + ', dio ' + got); }
}
console.log(V.length + ' casos, ' + fallas + ' fallas');
// la aclaracion, en sus variantes
const frases = ['se paga aparte', 'PAGA APARTE', 'paga tambien', 'Paga   aparte', 'no se paga', 'pagado', ''];
console.log('');
console.log('deteccion de la aclaracion del operador:');
frases.forEach(f => console.log('   ' + JSON.stringify(f).padEnd(22) + ' -> ' + (loAclaroElOperador({ observations: f }) ? 'COBRA' : 'no cobra')));
process.exit(fallas ? 1 : 0);
