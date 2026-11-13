/**
 * Prueba el envio de puntos GPS en lotes (src/gpsLote.ts) sin celular:
 * el almacenamiento y la red son de mentira.
 *
 *   cd mobile && node scripts/probar_gps_lote.js
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// ── Almacenamiento de mentira ──
const almacen = new Map();
let escrituras = 0;
const AsyncStorage = {
    getItem: async (k) => (almacen.has(k) ? almacen.get(k) : null),
    setItem: async (k, v) => { escrituras++; almacen.set(k, v); },
    removeItem: async (k) => { escrituras++; almacen.delete(k); },
};
// ── Red de mentira ──
let red = 'ok';           // 'ok' | 'caida' | '400'
const pedidos = [];
global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (red === 'caida') throw new TypeError('Network request failed');
    pedidos.push(body);
    return { ok: red === 'ok', status: red === 'ok' ? 200 : 400 };
};

// Compila el .ts al vuelo y le da los modulos de mentira
function cargar(rel) {
    const archivo = path.join(__dirname, '..', 'src', rel);
    const fuente = fs.readFileSync(archivo, 'utf8');
    const js = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
    const m = new Module(archivo);
    m.filename = archivo;
    m.paths = Module._nodeModulePaths(path.dirname(archivo));
    m.require = (id) => {
        if (id === '@react-native-async-storage/async-storage') return { __esModule: true, default: AsyncStorage };
        if (id === './config') return { STORAGE_KEYS: { gpsLoteQueue: 'cola' } };
        return require(id);
    };
    m._compile(js, archivo);
    return m.exports;
}
const g = cargar('gpsLote.ts');

let todo = true;
const esperar = (que, ok, detalle) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const quien = { deviceId: 'cel-1', deviceLabel: 'Reparto 9', driverId: 'ch-9' };
let reloj = Date.now() - 3600_000;
const punto = (r = 1) => { reloj += 2000; return { lat: -34.8, lng: -58.4, acc: 5, spd: 8, hdg: 90, t: new Date(reloj).toISOString(), r }; };
const cola = () => JSON.parse(almacen.get('cola') || '[]');
const reset = () => { almacen.clear(); pedidos.length = 0; escrituras = 0; red = 'ok'; g._reiniciarParaPruebas(); };

(async () => {
    console.log('\n1. Con señal: los puntos nuevos salen en un pedido y no se escribe nada');
    {
        reset();
        const ok = await g.enviarEnLotes('https://x', quien, [punto(), punto(), punto()]);
        esperar('hubo red', ok === true);
        esperar('un pedido con los 3 puntos', pedidos.length === 1 && pedidos[0].points.length === 3, pedidos.map(p => p.points.length));
        esperar('con el celular, el chofer y la ruta', pedidos[0].deviceId === 'cel-1' && pedidos[0].driverId === 'ch-9' && pedidos[0].routeId === 1, pedidos[0]);
        esperar('sin escribir en el celular', escrituras === 0, escrituras);
    }

    console.log('\n2. Sin señal: se guardan; por 15 s no se vuelve a intentar (no se traba)');
    {
        reset();
        red = 'caida';
        const ok = await g.enviarEnLotes('https://x', quien, [punto(), punto()]);
        esperar('sin red', ok === false);
        esperar('quedan 2 guardados', cola().length === 2, cola().length);
        red = 'ok';
        await g.enviarEnLotes('https://x', quien, [punto()]);
        esperar('dentro de los 15 s no pide (aunque haya vuelto la red)', pedidos.length === 0, pedidos.length);
        esperar('quedan 3 guardados', cola().length === 3, cola().length);
    }

    console.log('\n3. Vuelve la señal con 450 atrasados de dos rutas: primero lo nuevo, de a 200, una ruta por pedido');
    {
        reset();
        const atrasados = [];
        for (let i = 0; i < 300; i++) atrasados.push(punto(1));
        for (let i = 0; i < 150; i++) atrasados.push(punto(2));
        almacen.set('cola', JSON.stringify(atrasados));
        const nuevo = punto(2);
        await g.enviarEnLotes('https://x', quien, [nuevo]);
        esperar('se manda todo', pedidos.reduce((a, p) => a + p.points.length, 0) === 451, pedidos.map(p => p.points.length));
        esperar('ninguno pasa de 200', pedidos.every(p => p.points.length <= 200), pedidos.map(p => p.points.length));
        esperar('el primer pedido trae el punto mas nuevo', pedidos[0].points[pedidos[0].points.length - 1].t === nuevo.t);
        esperar('cada pedido es de una sola ruta', pedidos.map(p => p.routeId).join(',') === '2,1,1', pedidos.map(p => p.routeId));
        esperar('la cola queda vacia', !almacen.has('cola'), cola().length);
    }

    console.log('\n4. Un pedido rechazado (400) se descarta y sigue con el resto');
    {
        reset();
        almacen.set('cola', JSON.stringify([punto(), punto()]));
        red = '400';
        const ok = await g.enviarEnLotes('https://x', quien, [punto()]);
        esperar('no se traba: la cola se vacia', ok === true && !almacen.has('cola'), cola());
    }

    console.log('\n5. Lo de mas de un dia se descarta');
    {
        reset();
        const viejo = { lat: -34.8, lng: -58.4, acc: 5, spd: 0, hdg: 0, t: new Date(Date.now() - 30 * 3600_000).toISOString(), r: 1 };
        almacen.set('cola', JSON.stringify([viejo]));
        await g.enviarEnLotes('https://x', quien, [punto()]);
        esperar('solo sale el nuevo', pedidos.length === 1 && pedidos[0].points.length === 1 && pedidos[0].points[0].t !== viejo.t, pedidos);
    }

    console.log('\n6. Dos avisos del GPS a la vez: no se mandan puntos repetidos');
    {
        reset();
        red = 'caida';
        await g.enviarEnLotes('https://x', quien, [punto()]);          // queda 1 guardado
        g._reiniciarParaPruebas();                                       // pasaron los 15 s
        red = 'ok';
        await Promise.all([g.enviarEnLotes('https://x', quien, [punto()]), g.enviarEnLotes('https://x', quien, [punto()])]);
        const ts_ = pedidos.flatMap(p => p.points.map(x => x.t));
        esperar('3 puntos, sin repetidos', ts_.length === 3 && new Set(ts_).size === 3, ts_);
        esperar('la cola queda vacia', !almacen.has('cola'), cola().length);
    }

    console.log('\n7. Tope de la cola: 6000 puntos (los mas viejos se van)');
    {
        reset();
        red = 'caida';
        const muchos = [];
        for (let i = 0; i < 6100; i++) muchos.push(punto());
        await g.enviarEnLotes('https://x', quien, muchos);
        const c = cola();
        esperar('quedan 6000', c.length === 6000, c.length);
        esperar('los que quedan son los mas nuevos', c[c.length - 1].t === muchos[muchos.length - 1].t && c[0].t === muchos[100].t);
        const kb = Math.round(almacen.get('cola').length / 1024);
        esperar(`entra en el almacenamiento del celular (${kb} KB, tope 2048)`, kb < 1500, kb);
    }

    console.log('\n8. El punto del GPS se convierte bien (y un reloj roto no rompe nada)');
    {
        const p = g.aPuntoLote({ timestamp: 1794600000000, coords: { latitude: -34.8, longitude: -58.4, accuracy: 4, speed: 10, heading: 180 } }, 7);
        esperar('con su hora y su ruta', p.t === new Date(1794600000000).toISOString() && p.r === 7 && p.acc === 4, p);
        const q = g.aPuntoLote({ timestamp: NaN, coords: { latitude: -34.8, longitude: -58.4 } }, null);
        esperar('reloj roto: hora de ahora', Math.abs(Date.parse(q.t) - Date.now()) < 5000 && q.acc === null, q);
    }

    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    process.exit(todo ? 0 : 1);
})();
