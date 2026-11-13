/**
 * Prueba el armado del recorrido real (sin red: Mapbox es de mentira).
 *
 *   cd server && npx ts-node scripts/probar_recorrido_real.ts
 */
import { prepararPuntos, cortarEnTramos, ventanas, armarRecorrido, PuntoGps, Coord } from '../src/recorridoReal';

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};
const t0 = new Date('2026-11-13T12:00:00Z').getTime();
// Un camion que va hacia el norte a ~36 km/h: 20 m cada 2 s
const P = (seg: number, metrosNorte: number, extra: Partial<PuntoGps> = {}): PuntoGps =>
    ({ lat: -34.8 + metrosNorte / 111_000, lng: -58.4, t: new Date(t0 + seg * 1000), acc: 6, ...extra });

console.log('\n1. Limpieza: fuera del viaje, imprecisos, rebote y uno cada 50 m');
{
    const filas: PuntoGps[] = [];
    for (let i = 0; i <= 100; i++) filas.push(P(i * 2, i * 20));           // 200 s, 2 km
    filas.push(P(-3600, 0));                                                // una hora antes del viaje
    filas.push(P(51, 510, { acc: 300 }));                                   // impreciso
    filas.push(P(61, 5000));                                                // rebote: 5 km en 1 s
    const r = prepararPuntos(filas, new Date(t0), new Date(t0 + 200_000));
    esperar('no queda el de antes del viaje', r[0].t.getTime() === t0, r[0].t);
    esperar('sin el impreciso ni el rebote', r.every((p) => (p.acc ?? 0) <= 100 && Math.abs(p.lat - (-34.8)) < 0.03), r.length);
    esperar('uno cada ~60 m (2 km / 60 m ~ 34)', r.length >= 30 && r.length <= 42, r.length);
    esperar('en orden', r.every((p, i) => i === 0 || p.t > r[i - 1].t));
    esperar('el ultimo punto esta (donde termino)', r[r.length - 1].t.getTime() === t0 + 200_000, r[r.length - 1].t);
}

console.log('\n2. Corte en los huecos');
{
    const pts = [P(0, 0), P(60, 600), P(120, 1200), /* sin señal 10 min y 4 km */ P(720, 5200), P(780, 5800)];
    const tr = cortarEnTramos(pts);
    esperar('dos tramos', tr.length === 2 && tr[0].length === 3 && tr[1].length === 2, tr.map((t) => t.length));
    const parado = [P(0, 0), P(600, 30), P(660, 600)];   // 10 min parado en la escuela: NO es hueco
    esperar('parado en una escuela no corta', cortarEnTramos(parado).length === 1);
}

console.log('\n3. Ventanas de 100 con un punto en comun');
{
    const v = ventanas(Array.from({ length: 250 }, (_, i) => i));
    esperar('3 ventanas', v.length === 3, v.map((x) => x.length));
    esperar('cada una empieza donde termino la otra', v[1][0] === v[0][99] && v[2][0] === v[1][99]);
    esperar('cubren todo', v[2][v[2].length - 1] === 249);
}

console.log('\n4. Armado: real, hueco estimado por calles, y crudo si Mapbox no puede');
(async () => {
    const pts: PuntoGps[] = [];
    for (let i = 0; i < 150; i++) pts.push(P(i * 6, i * 60));                // 9 km, 150 puntos
    for (let i = 0; i < 20; i++) pts.push(P(1500 + i * 6, 15000 + i * 60));  // despues de un hueco de 6 km
    let llamadas = 0;
    const pegar = async (v: PuntoGps[]): Promise<Coord[][] | null> => {
        llamadas++;
        if (llamadas === 2) return null;                                     // una ventana falla
        return [v.map((p) => [p.lng + 0.0001, p.lat] as Coord)];            // "pegado": corrido 9 m
    };
    const camino = async (a: PuntoGps, b: PuntoGps): Promise<Coord[] | null> =>
        [[a.lng, a.lat], [a.lng + 0.01, (a.lat + b.lat) / 2], [b.lng, b.lat]];
    const r = await armarRecorrido(pts, pegar, camino);
    esperar('tramos: real, crudo, estimado, real', r.tramos.map((t) => t.tipo).join(',') === 'real,crudo,estimado,real', r.tramos.map((t) => t.tipo));
    esperar('pedidos: 3 de pegar + 1 de camino', r.pedidos === 4, r.pedidos);
    esperar('km sin contar lo estimado (~10)', r.km > 9 && r.km < 11.5, r.km);
    esperar('el estimado sigue el camino (3 puntos)', r.tramos[2].coords.length === 3, r.tramos[2].coords.length);

    const sinRed = await armarRecorrido(pts, async () => null, async () => null);
    esperar('sin Mapbox: crudo + estimado en recta', sinRed.tramos.map((t) => t.tipo).join(',') === 'crudo,estimado,crudo', sinRed.tramos.map((t) => t.tipo));
    const vacio = await armarRecorrido([], pegar, camino);
    // Mapbox parte una ventana en dos pedazos separados 1 km: el medio va por calles
    const pedazos = async (v: PuntoGps[]): Promise<Coord[][] | null> => {
        const c = v.map((p) => [p.lng, p.lat] as Coord);
        const m = Math.floor(c.length / 2);
        return [c.slice(0, m - 10), c.slice(m + 10)];
    };
    const corto: PuntoGps[] = [];
    for (let i = 0; i < 60; i++) corto.push(P(i * 6, i * 60));
    const r2 = await armarRecorrido(corto, pedazos, camino);
    esperar('pedazos: real, estimado por calles, real', r2.tramos.map((t) => t.tipo).join(',') === 'real,estimado,real', r2.tramos.map((t) => t.tipo));
    esperar('el medio no es una recta', r2.tramos[1].coords.length === 3, r2.tramos[1].coords.length);
    esperar('sin puntos: vacio', vacio.tramos.length === 0 && vacio.km === 0);

    console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
    process.exit(todo ? 0 : 1);
})();
