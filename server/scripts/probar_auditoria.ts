/**
 * Prueba la auditoria de viajes de un mes con un prisma falso: un octubre
 * armado a mano, con un viaje por cada cosa que puede venir mal y los casos
 * que NO tienen que saltar (dos vueltas del mismo reparto, LIBRE repetido,
 * "paga aparte", un propio con valor normal).
 *
 *   cd server && npx ts-node scripts/probar_auditoria.ts
 *
 * Termina con exit 0 solo si pasa todo.
 */
import { auditarMes, filtrarInforme, distanciaDeEdicion, CONTROLES, InformeDeAuditoria } from '../src/auditoriaDeViajes';

// ───────────────────────── Armado del mes ─────────────────────────

/** Hora de Buenos Aires de un dia de octubre 2026. */
const ba = (dd: number, hms: string) => new Date(`2026-10-${String(dd).padStart(2, '0')}T${hms}-03:00`);
/** La fecha del viaje, como la guarda el sistema (mediodia UTC... a las 15). */
const fecha = (dd: number) => new Date(`2026-10-${String(dd).padStart(2, '0')}T15:00:00.000Z`);

const parada = (sequence: number, name: string, llegada?: Date | null, salida?: Date | null, extra: any = {}) => ({
    sequence, status: 'COMPLETED', actualArrival: llegada ?? null, actualDeparture: salida ?? null,
    isReturnToBase: false, ruta: null, client: { name }, ...extra
});
const deposito = (sequence: number, llegada?: Date | null, salida?: Date | null, extra: any = {}) =>
    parada(sequence, 'REAL DE CATORCE', llegada, salida, { isReturnToBase: true, ...extra });
const ruta = (inicio: Date | null, fin: Date | null, stops: any[]) => ({ actualStartTime: inicio, actualEndTime: fin, stops });
const viaje = (base: any) => ({
    status: 'COMPLETED', vuelta: null, isManual: false, observations: null, notes: null,
    exitTime: null, returnTime: null, assignedMobileUser: null, tramos: [], linkedRoute: null, ...base
});

/** Las cinco paradas de R1, sin hora (como quedan cuando no se marcan). */
const paradasR1SinHora = () => [
    parada(1, 'EP.73', null, null, { status: 'PENDING' }),
    parada(2, 'J.932', null, null, { status: 'PENDING' }),
    parada(3, 'J.931', null, null, { status: 'PENDING' }),
    parada(4, 'J.930', null, null, { status: 'PENDING' }),
    parada(5, 'ES.54', null, null, { status: 'PENDING' }),
    deposito(6, null, null, { status: 'PENDING' }),
];

const VIAJES = [
    // 101: R1 bien cargado, con los problemas de marcado del chofer
    viaje({
        id: 101, date: fecha(7), reparto: 'R1', driver: 'DANIEL DAROSA', provider: 'DANIEL DAROSA',
        contractType: 'Tercerizado', value: 290000, vuelta: 1, businessUnit: 'SAE LANUS', zone: 'Zona 1',
        linkedRoute: ruta(ba(7, '05:00:00'), ba(7, '09:30:00'), [
            parada(1, 'EP.73', ba(7, '05:30:00'), ba(7, '05:40:00')),
            parada(2, 'J.932', ba(7, '05:50:00'), ba(7, '05:50:30')),   // muy corta (0,5 min) y a la vez que la #3
            parada(3, 'J.931', ba(7, '05:45:00'), ba(7, '05:55:00')),   // antes que la #2: secuencia fuera de orden
            parada(4, 'J.930', ba(7, '06:10:00'), ba(7, '06:05:00')),   // sale antes de llegar
            parada(5, 'ES.54'),                                          // COMPLETED sin hora
            deposito(6, ba(7, '09:20:00'), ba(7, '09:30:00')),
        ])
    }),
    // 102: el mismo R1, mismo dia, chofer y vuelta: DUPLICADO. Ademas cobra de nuevo y se pisa con el 101.
    viaje({
        id: 102, date: fecha(7), reparto: 'R1', driver: 'DANIEL DAROSA', provider: 'DANIEL DAROSA',
        contractType: 'Tercerizado', value: 290000, vuelta: 1, businessUnit: 'SAE LANUS', zone: 'Zona 1',
        linkedRoute: ruta(ba(7, '09:00:00'), ba(7, '10:00:00'), paradasR1SinHora())
    }),
    // 103: el mismo R1 ese dia con OTRO chofer
    viaje({
        id: 103, date: fecha(7), reparto: 'R1', driver: 'ALEX AVALOS', provider: 'ALEX AVALOS',
        contractType: 'Tercerizado', value: 290000, vuelta: 1, businessUnit: 'SAE LANUS', zone: 'Zona 1',
        linkedRoute: ruta(ba(7, '05:10:00'), ba(7, '08:40:00'), paradasR1SinHora())
    }),
    // 104: segunda VUELTA del R1 con Daniel: NO es duplicado, y va en $0 porque la tarifa ya la cobro el 101
    viaje({
        id: 104, date: fecha(7), reparto: 'R1', driver: 'DANIEL DAROSA', provider: 'DANIEL DAROSA',
        contractType: 'Tercerizado', value: 0, vuelta: 2, businessUnit: 'SAE LANUS', zone: 'Zona 1',
        linkedRoute: ruta(ba(7, '10:30:00'), ba(7, '12:00:00'), paradasR1SinHora())
    }),
    // 105: propio LIBRE con valor normal ($29.157): limpio. El deposito marca la
    //      SALIDA del viaje como llegada y la VUELTA como salida (asi quedaron 69
    //      viajes de octubre normalizados): no es una parada que pisa a las demas
    //      ni una fuera de orden.
    viaje({
        id: 105, date: fecha(9), reparto: 'LIBRE', driver: 'DAMIAN GALARZA', provider: null,
        contractType: 'Propio', value: 29157, businessUnit: 'SAE BROWN', zone: 'Zona 2',
        linkedRoute: ruta(ba(9, '09:16:11'), ba(9, '13:42:37'), [
            parada(1, 'X ESCUELA', ba(9, '09:30:00'), ba(9, '09:45:00')),
            parada(2, 'Y ESCUELA', ba(9, '10:00:00'), ba(9, '10:10:00')),
            deposito(3, ba(9, '09:16:11'), ba(9, '13:42:37')),
        ])
    }),
    // 106: otro LIBRE del mismo chofer con las mismas paradas (NO es duplicado: LIBRE se repite),
    //      pero con $290.000 escrito a mano: la tarifa de un tercerizado
    viaje({
        id: 106, date: fecha(9), reparto: 'LIBRE', driver: 'DAMIAN GALARZA', provider: null,
        contractType: 'Propio', value: 290000, businessUnit: 'SAE BROWN', zone: 'Zona 2',
        linkedRoute: ruta(ba(9, '14:00:00'), ba(9, '15:00:00'), [
            parada(1, 'X ESCUELA', ba(9, '14:10:00'), ba(9, '14:20:00')),
            parada(2, 'Y ESCUELA', ba(9, '14:30:00'), ba(9, '14:40:00')),
            deposito(3, ba(9, '14:50:00'), ba(9, '15:00:00')),
        ])
    }),
    // 107: R16 de 9,6 h, con una parada antes del arranque, otra despues del cierre, y una ruta SAM
    //      que la unidad no menciona
    viaje({
        id: 107, date: fecha(14), reparto: 'R16', driver: 'MAXIMILIANO SUAREZ', provider: null,
        contractType: 'Propio', value: 95030, vuelta: 1, businessUnit: 'SAE LANUS', zone: 'Zona 3',
        linkedRoute: ruta(ba(14, '05:16:22'), ba(14, '14:52:04'), [
            parada(1, 'P ESCUELA', ba(14, '05:00:00'), ba(14, '05:20:00')),                              // llega antes del arranque
            parada(2, 'Q ESCUELA', ba(14, '14:30:00'), ba(14, '14:40:00'), { ruta: 'SAM 1 LUNES R16' }),
            deposito(3, ba(14, '14:45:00'), ba(14, '14:52:04')),
            parada(4, 'R ESCUELA', ba(14, '14:55:00'), ba(14, '14:58:00')),                              // sale despues del cierre
        ])
    }),
    // 108: LIBRE del mismo chofer a la tarde: la jornada pasa de 12 h. Sin zona y en PENDING con trabajo hecho.
    viaje({
        id: 108, date: fecha(14), reparto: 'LIBRE', driver: 'MAXIMILIANO SUAREZ', provider: null,
        contractType: 'Propio', value: 20000, businessUnit: 'SAE LANUS', zone: null, status: 'PENDING',
        linkedRoute: ruta(ba(14, '15:30:00'), ba(14, '17:30:00'), [
            parada(1, 'Z ESCUELA', ba(14, '16:00:00'), ba(14, '16:10:00')),
            deposito(2, ba(14, '17:20:00'), ba(14, '17:30:00')),
        ])
    }),
    // 109: tercerizado con proveedor mal escrito (ALAM.AMO), que cierra a la misma hora que arranca,
    //      sin paradas y sin unidad
    viaje({
        id: 109, date: fecha(16), reparto: 'LIBRE', driver: 'JOSE PEREZ', provider: 'ALAM.AMO',
        contractType: 'Tercerizado', value: 390000, businessUnit: null, zone: 'Zona 1',
        linkedRoute: ruta(ba(16, '10:00:00'), ba(16, '10:00:00'), [])
    }),
    // 110: el mismo proveedor bien escrito (ALAN AMO); paradas con hora pero sin arranque ni cierre
    viaje({
        id: 110, date: fecha(20), reparto: 'LIBRE', driver: 'JOSE PEREZ', provider: 'ALAN AMO',
        contractType: 'Tercerizado', value: 390000, businessUnit: 'SAE BROWN', zone: 'Zona 1',
        linkedRoute: ruta(null, null, [
            parada(1, 'W ESCUELA', ba(20, '10:00:00'), ba(20, '10:15:00')),
            deposito(2, ba(20, '11:00:00'), ba(20, '11:05:00')),
        ])
    }),
    // 111: viaje manual sin chofer y sin ninguna parada
    viaje({
        id: 111, date: fecha(22), reparto: 'FACUNDO FERNANDEZ', driver: null, provider: 'FACUNDO FERNANDEZ',
        contractType: 'Tercerizado', value: 290000, isManual: true, businessUnit: 'SAE LANUS', zone: 'Zona 1',
        exitTime: ba(22, '06:00:00'), returnTime: ba(22, '08:00:00'), linkedRoute: null
    }),
    // 112: tercerizado sin proveedor y en $0 (es el primero del dia: tendria que cobrar)
    viaje({
        id: 112, date: fecha(22), reparto: 'LIBRE', driver: 'JOSUE RAFAEL', provider: null,
        contractType: 'Tercerizado', value: 0, businessUnit: 'SAE BROWN', zone: 'Zona 2',
        linkedRoute: ruta(ba(22, '05:00:00'), ba(22, '08:00:00'), [
            parada(1, 'K ESCUELA', ba(22, '06:00:00'), ba(22, '06:10:00')),
            deposito(2, ba(22, '07:50:00'), ba(22, '08:00:00')),
        ])
    }),
    // 113: segundo viaje del dia del mismo tercerizado, que cobra porque el operador lo aclaro: limpio
    viaje({
        id: 113, date: fecha(22), reparto: 'LIBRE', driver: 'JOSUE RAFAEL', provider: 'JOSUE RAFAEL',
        contractType: 'Tercerizado', value: 250000, businessUnit: 'SAE BROWN', zone: 'Zona 2',
        observations: 'Se paga aparte: pedido extra de Brown',
        linkedRoute: ruta(ba(22, '09:00:00'), ba(22, '12:00:00'), [
            parada(1, 'L ESCUELA', ba(22, '10:00:00'), ba(22, '10:10:00')),
            deposito(2, ba(22, '11:50:00'), ba(22, '12:00:00')),
        ])
    }),
    // 114: viaje de la cuenta de prueba: no tiene que entrar
    viaje({
        id: 114, date: fecha(23), reparto: 'LIBRE', driver: 'juan', provider: null,
        contractType: 'Propio', value: 0, businessUnit: null, zone: null, linkedRoute: null
    }),
];

const TABLA = {
    '2026-10': { 'DANIEL DAROSA': 290000, 'ALEX AVALOS': 290000, 'ALAN AMO': 390000, 'FACUNDO FERNANDEZ': 290000, 'JOSUE RAFAEL': 250000 },
    '2026-09': { 'ALAM.AMO': 380000 },   // tarifa vieja: no vale para octubre
};

const llamadas: any[] = [];
const prismaFalso: any = {
    trip: { findMany: async (args: any) => { llamadas.push(args); return VIAJES; } },
    appSettings: { findUnique: async ({ where }: any) => where?.key === 'tarifas_proveedor' ? { value: JSON.stringify(TABLA) } : null },
};

// ───────────────────────── Comprobaciones ─────────────────────────

let todo = true;
const esperar = (que: string, ok: boolean, detalle?: any) => {
    console.log('  %s %s%s', ok ? 'OK  ' : 'MAL ', que, ok ? '' : '   <- ' + JSON.stringify(detalle));
    if (!ok) todo = false;
};

async function main() {
    const inf: InformeDeAuditoria = await auditarMes(prismaFalso, 2026, 10);
    const de = (control: string) => inf.hallazgos.filter((h) => h.control === control);
    const viajesDe = (control: string) => [...new Set(de(control).map((h) => h.viaje))].sort();
    const res = (control: string) => inf.resumen.find((r) => r.control === control)!;

    console.log('AUDITORIA DE VIAJES DEL MES\n');
    console.log('Resumen (%d viajes, %d paradas):', inf.viajes, inf.paradas);
    for (const r of inf.resumen) console.log('   %s %s  (%d viajes)', String(r.hallazgos).padStart(3), r.control.padEnd(46), r.viajes);
    console.log('\nHallazgos:');
    for (const h of inf.hallazgos) console.log('   [%s] %d %s | %s%s', h.control, h.viaje, h.chofer || '-', h.detalle, h.dato ? ' | ' + h.dato : '');

    console.log('\n1. Como se leen los viajes');
    esperar('lee la base una sola vez', llamadas.length === 1, llamadas.length);
    const where = llamadas[0]?.where || {};
    esperar('filtra por rango de fecha y nada mas (no por deposito)', Object.keys(where).join() === 'date', Object.keys(where));
    esperar('desde el 1 a las 00:00 UTC', where.date?.gte?.toISOString() === '2026-10-01T00:00:00.000Z', where.date?.gte);
    esperar('hasta el 31 a las 23:59:59 UTC', String(where.date?.lte?.toISOString()).startsWith('2026-10-31T23:59:59'), where.date?.lte);
    esperar('pide las paradas ordenadas por secuencia con el nombre del cliente',
        llamadas[0]?.select?.linkedRoute?.select?.stops?.orderBy?.sequence === 'asc'
        && !!llamadas[0]?.select?.linkedRoute?.select?.stops?.select?.client, llamadas[0]?.select?.linkedRoute);
    esperar('pide los tramos', !!llamadas[0]?.select?.tramos, Object.keys(llamadas[0]?.select || {}));
    esperar('deja afuera la cuenta de prueba: 13 viajes', inf.viajes === 13, inf.viajes);
    esperar('cuenta las paradas: 42', inf.paradas === 42, inf.paradas);
    esperar('mes y anio en el informe', inf.mes === 10 && inf.anio === 2026, [inf.anio, inf.mes]);
    let rechazo = false;
    try { await auditarMes(prismaFalso, 2026, 13); } catch (_) { rechazo = true; }
    esperar('rechaza un mes 13', rechazo);

    console.log('\n2. Duplicados y repeticiones');
    esperar('101 y 102 son duplicados (mismo dia, reparto, chofer y vuelta)', JSON.stringify(viajesDe('Duplicados')) === '[101,102]', viajesDe('Duplicados'));
    esperar('la segunda vuelta (104) NO es duplicado', !viajesDe('Duplicados').includes(104));
    esperar('LIBRE repetido (105/106) NO es duplicado', !viajesDe('Duplicados').some((v) => v === 105 || v === 106));
    esperar('el otro chofer (103) NO es duplicado', !viajesDe('Duplicados').includes(103));
    const rep = 'El reparto se repite ese dia con otro chofer';
    esperar('R1 con otro chofer: salen 101, 102, 103 y 104', JSON.stringify(viajesDe(rep)) === '[101,102,103,104]', viajesDe(rep));
    esperar('el 103 nombra a los de Daniel', /101 \(DANIEL DAROSA\)/.test(de(rep).find((h) => h.viaje === 103)?.detalle || ''),
        de(rep).find((h) => h.viaje === 103)?.detalle);

    console.log('\n3. Ventana del viaje');
    esperar('Pasa de 8,5 h: solo el 107', JSON.stringify(viajesDe('Pasa de 8,5 h')) === '[107]', viajesDe('Pasa de 8,5 h'));
    esperar('  con 9.6 h', de('Pasa de 8,5 h')[0]?.horas === 9.6, de('Pasa de 8,5 h')[0]?.horas);
    esperar('Duracion imposible: solo el 109', JSON.stringify(viajesDe('Duracion imposible')) === '[109]', viajesDe('Duracion imposible'));
    esperar('Sin arranque ni cierre: solo el 110', JSON.stringify(viajesDe('Sin arranque ni cierre')) === '[110]', viajesDe('Sin arranque ni cierre'));
    esperar('  y dice cuantas paradas tienen hora', /2 parada\(s\)/.test(de('Sin arranque ni cierre')[0]?.detalle || ''), de('Sin arranque ni cierre')[0]);

    console.log('\n4. Paradas');
    const fuera = de('Parada fuera de la ventana');
    esperar('Fuera de la ventana: 2 hallazgos, los dos del 107', fuera.length === 2 && viajesDe('Parada fuera de la ventana').join() === '107', fuera);
    esperar('  una llega antes y otra sale despues', fuera.some((h) => /llega antes/.test(h.detalle)) && fuera.some((h) => /sale despues/.test(h.detalle)), fuera.map((h) => h.detalle));
    esperar('Parada invertida: #4 J.930 del 101', de('Parada invertida').length === 1 && /#4 J\.930/.test(de('Parada invertida')[0].detalle), de('Parada invertida'));
    esperar('Parada muy corta: #2 J.932 del 101, 0.5 min', de('Parada muy corta').length === 1 && /#2 J\.932 dura 0\.5 min/.test(de('Parada muy corta')[0].detalle), de('Parada muy corta'));
    esperar('  la invertida NO cuenta como corta', !de('Parada muy corta').some((h) => /J\.930/.test(h.detalle)));
    esperar('Dos paradas a la vez: #2 arranca antes de que termine #3 (101)',
        de('Dos paradas a la vez').length === 1 && /#2 J\.932 arranca antes de que termine #3 J\.931/.test(de('Dos paradas a la vez')[0].detalle), de('Dos paradas a la vez'));
    esperar('Secuencia fuera de orden: 1 parada en el 101',
        de('Secuencia fuera de orden').length === 1 && de('Secuencia fuera de orden')[0].viaje === 101 && /^1 parada/.test(de('Secuencia fuera de orden')[0].detalle), de('Secuencia fuera de orden'));
    esperar('Parada sin horario: #5 ES.54 COMPLETED sin hora', de('Parada sin horario').length === 1 && /#5 ES\.54 figura COMPLETED y no tiene hora/.test(de('Parada sin horario')[0].detalle), de('Parada sin horario'));

    console.log('\n5. El chofer en el dia');
    const dos = de('Chofer en dos viajes a la vez');
    esperar('Chofer en dos viajes: el 102 se pisa con el 101', dos.length === 1 && dos[0].viaje === 102 && /viaje 101/.test(dos[0].detalle), dos);
    esperar('  con las horas pisadas en el dato (0.5 h)', /0\.5 h pisadas/.test(dos[0]?.dato || ''), dos[0]?.dato);
    const jor = de('Jornada de mas de 12 h');
    esperar('Jornada de mas de 12 h: Maximiliano el 14, en 2 viajes', jor.length === 1 && jor[0].viaje === 107 && /en 2 viaje/.test(jor[0].detalle), jor);
    esperar('  Daniel el 7 (05:00 a 12:00) NO pasa de 12 h', !jor.some((h) => h.chofer === 'DANIEL DAROSA'));

    console.log('\n6. Tarifa');
    const tar = de('Tarifa');
    esperar('el 102 cobra de nuevo el mismo dia (regla del dia)', tar.some((h) => h.viaje === 102 && /no es el primer viaje del dia/.test(h.detalle)), tar);
    esperar('el 113 con "paga aparte" NO salta', !tar.some((h) => h.viaje === 113));
    esperar('el 104 en $0 por ser segundo viaje NO salta', !tar.some((h) => h.viaje === 104));
    esperar('el 112: sin proveedor y en $0', tar.filter((h) => h.viaje === 112).length === 2
        && tar.some((h) => h.viaje === 112 && /sin proveedor/.test(h.detalle)) && tar.some((h) => h.viaje === 112 && /en \$0/.test(h.detalle)), tar.filter((h) => h.viaje === 112));
    esperar('propio con $290.000 (106) se marca', tar.some((h) => h.viaje === 106 && /propio con valor de tercerizado/.test(h.detalle)), tar);
    esperar('propio con $29.157 (105) NO se marca', !tar.some((h) => h.viaje === 105));
    esperar('en total 4 hallazgos en 3 viajes', res('Tarifa').hallazgos === 4 && res('Tarifa').viajes === 3, res('Tarifa'));

    console.log('\n7. Proveedores');
    const st = de('Proveedor sin tarifa');
    esperar('ALAM.AMO (109) no tiene tarifa de octubre', st.length === 1 && st[0].viaje === 109 && /ALAM\.AMO no tiene tarifa de octubre/.test(st[0].detalle), st);
    esperar('ALAN AMO (110) si la tiene', !st.some((h) => h.viaje === 110));
    const par = de('Nombres de proveedor parecidos');
    esperar('ALAM.AMO / ALAN AMO se detectan como parecidos (y nadie mas)', par.length === 1 && /ALAM\.AMO/.test(par[0].detalle) && /ALAN AMO/.test(par[0].detalle), par);
    esperar('distancia de edicion: ALAM AMO vs ALAN AMO = 1', distanciaDeEdicion('ALAM AMO', 'ALAN AMO') === 1);
    esperar('distancia de edicion: DANIEL DAROSA vs ALEX AVALOS > 2', distanciaDeEdicion('DANIEL DAROSA', 'ALEX AVALOS') > 2);

    console.log('\n8. Unidad, paradas y datos');
    const uni = de('Unidad de negocio');
    esperar('Unidad de negocio: el 107 lleva SAM y la unidad no lo dice', uni.length === 1 && uni[0].viaje === 107 && /ruta SAM/.test(uni[0].detalle) && uni[0].dato === 'SAE LANUS', uni);
    esperar('Viaje sin paradas: 109 y 111', JSON.stringify(viajesDe('Viaje sin paradas')) === '[109,111]', viajesDe('Viaje sin paradas'));
    esperar('  el manual lo dice', /viaje manual/.test(de('Viaje sin paradas').find((h) => h.viaje === 111)?.detalle || ''));
    const fd = de('Faltan datos');
    esperar('Faltan datos: 108 (zona y estado), 109 (unidad), 111 (chofer)', JSON.stringify(viajesDe('Faltan datos')) === '[108,109,111]' && fd.length === 4, fd);
    esperar('  108 en PENDING con trabajo hecho', fd.some((h) => h.viaje === 108 && /estado es PENDING/.test(h.detalle)), fd.filter((h) => h.viaje === 108));
    esperar('  108 sin zona', fd.some((h) => h.viaje === 108 && h.detalle === 'falta: zona'));
    esperar('  109 sin unidad', fd.some((h) => h.viaje === 109 && h.detalle === 'falta: unidad de negocio'));
    esperar('  111 sin chofer', fd.some((h) => h.viaje === 111 && h.detalle === 'falta: chofer'));
    esperar('el 113 esta limpio', !inf.hallazgos.some((h) => h.viaje === 113), inf.hallazgos.filter((h) => h.viaje === 113));
    esperar('el 105 esta limpio', !inf.hallazgos.some((h) => h.viaje === 105), inf.hallazgos.filter((h) => h.viaje === 105));

    console.log('\n9. Resumen y filtro');
    esperar('el resumen tiene los 19 controles', inf.resumen.length === 19 && inf.resumen.length === CONTROLES.length, inf.resumen.length);
    esperar('ordenado de mayor a menor', inf.resumen.every((r, i) => i === 0 || inf.resumen[i - 1].hallazgos >= r.hallazgos));
    esperar('todos con su "que significa"', inf.resumen.every((r) => r.queSignifica.length > 20));
    esperar('los estructurales aclaran que es como marca el chofer',
        ['Dos paradas a la vez', 'Secuencia fuera de orden', 'Parada muy corta'].every((c) => /como marca/.test(res(c).queSignifica)));
    esperar('cada hallazgo tiene todos los campos', inf.hallazgos.every((h) =>
        typeof h.viaje === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(h.fecha) && typeof h.detalle === 'string' && 'dato' in h && 'horas' in h && 'valor' in h));
    const totalResumen = inf.resumen.reduce((s, r) => s + r.hallazgos, 0);
    esperar('el resumen suma lo mismo que la lista', totalResumen === inf.hallazgos.length, [totalResumen, inf.hallazgos.length]);
    const filtrado = filtrarInforme(inf, ['Tarifa', 'duplicados']);
    esperar('solo=Tarifa,duplicados deja esos dos controles', filtrado.resumen.length === 2 && filtrado.hallazgos.every((h) => h.control === 'Tarifa' || h.control === 'Duplicados'), filtrado.resumen.map((r) => r.control));
    esperar('solo=parada trae los controles de paradas', filtrarInforme(inf, ['parada']).resumen.length === 4, filtrarInforme(inf, ['parada']).resumen.map((r) => r.control));
    esperar('sin filtro devuelve todo', filtrarInforme(inf, []).hallazgos.length === inf.hallazgos.length);

    console.log('\n%s\n', todo ? 'TODO OK' : 'HAY FALLAS');
    process.exit(todo ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
