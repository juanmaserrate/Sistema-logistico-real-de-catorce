/**
 * Prueba la decision de prender o apagar el GPS al abrir la app (src/gpsAuto.ts).
 *
 *   cd mobile && node scripts/probar_gps_auto.js
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const archivo = path.join(__dirname, '..', 'src', 'gpsAuto.ts');
const js = ts.transpileModule(fs.readFileSync(archivo, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', js)(m, m.exports);
const { decidirGpsAlAbrir } = m.exports;

let todo = true;
const caso = (que, s, esperado) => {
    const r = decidirGpsAlAbrir({ autoInicio: true, hayViajeAbierto: true, corriendo: false, prendidoSolo: false, salidaFichadaHoy: false, ...s });
    const ok = r === esperado;
    console.log('  %s %s -> %s%s', ok ? 'OK  ' : 'MAL ', que, r, ok ? '' : ` (esperaba ${esperado})`);
    if (!ok) todo = false;
};

console.log('\nCuando se prende solo');
caso('abre la app con un viaje de hoy sin terminar', {}, 'prender');
caso('el servidor no lo tiene prendido para este chofer', { autoInicio: false }, 'nada');
caso('ya esta andando (fichó entrada o ya se prendió)', { corriendo: true }, 'nada');
caso('hoy ya fichó salida', { salidaFichadaHoy: true }, 'nada');

console.log('\nCuando se apaga solo');
caso('no quedan viajes abiertos y lo había prendido la app', { hayViajeAbierto: false, corriendo: true, prendidoSolo: true }, 'apagar');
caso('no quedan viajes abiertos pero lo prendió el chofer: no se toca', { hayViajeAbierto: false, corriendo: true, prendidoSolo: false }, 'nada');
caso('no quedan viajes y no está andando', { hayViajeAbierto: false }, 'nada');
caso('apagar no depende del interruptor del servidor', { autoInicio: false, hayViajeAbierto: false, corriendo: true, prendidoSolo: true }, 'apagar');

console.log(todo ? '\nTODO OK\n' : '\nHAY ERRORES\n');
process.exit(todo ? 0 : 1);
