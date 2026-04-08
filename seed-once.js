#!/usr/bin/env node
/**
 * seed-once.js — Carga inicial one-off de datos operativos en producción.
 *
 * Uso:
 *   node seed-once.js <password_de_juanma>
 *
 * Qué hace:
 *   1. Login como juanma → obtiene token JWT
 *   2. Crea 30 empleados (6 CHOFERES + 24 AUXILIARES) en /api/v1/users
 *   3. Carga 30 salarios de enero 2026 en /api/v1/salaries
 *   4. Carga costos fijos/variables de enero 2026 en /api/v1/settings (key: costs_data)
 *   5. Carga 18 unidades de negocio en /api/v1/settings (key: business_units)
 *
 * Todos los endpoints usan upsert → si el dato ya existe, lo actualiza.
 * Si el dato ya está en la DB desde una carga anterior, no pasa nada.
 *
 * Después de ejecutar exitosamente este script, podés borrarlo.
 */

const BASE_URL = 'https://sistema-logistico-real-de-catorce-production.up.railway.app';
const USERNAME = 'juanma';
const PASSWORD = process.argv[2];

if (!PASSWORD) {
    console.error('❌  Falta la contraseña. Uso: node seed-once.js <password>');
    process.exit(1);
}

// ─── DATOS ────────────────────────────────────────────────────────────────────

const EMPLEADOS = [
    { apellido: 'AVILA',      nombre: 'EMANUEL GUSTAVO',  role: 'CHOFER'   },
    { apellido: 'BASTIDA',    nombre: 'MARCELO ANGEL',    role: 'CHOFER'   },
    { apellido: 'BUNGS',      nombre: 'JAVIER',           role: 'CHOFER'   },
    { apellido: "D'AMICO",    nombre: 'GERMAN',           role: 'CHOFER'   },
    { apellido: 'GALARZA',    nombre: 'DAMIAN',           role: 'CHOFER'   },
    { apellido: 'VERBES',     nombre: 'RUBEN ESTEBAN',    role: 'CHOFER'   },
    { apellido: 'SILVA',      nombre: 'EZEQUIEL',         role: 'AUXILIAR' },
    { apellido: 'SUAREZ',     nombre: 'MAXIMILIANO',      role: 'AUXILIAR' },
    { apellido: 'ALVIÑA',     nombre: 'NAHUEL',           role: 'AUXILIAR' },
    { apellido: 'ARISMENDI',  nombre: 'GERMAN EZEQUIEL',  role: 'AUXILIAR' },
    { apellido: 'BERNACHEA',  nombre: 'CARLOS ALBERTO',   role: 'AUXILIAR' },
    { apellido: 'BRITOS',     nombre: 'EZEQUIEL ALEXIS',  role: 'AUXILIAR' },
    { apellido: 'BRITOS',     nombre: 'FEDERICO NAHUEL',  role: 'AUXILIAR' },
    { apellido: 'CARVAJAL',   nombre: 'JONATHAN',         role: 'AUXILIAR' },
    { apellido: 'CUEVA',      nombre: 'ARIEL HERNAN',     role: 'AUXILIAR' },
    { apellido: "D'AMICO",    nombre: 'AXEL',             role: 'AUXILIAR' },
    { apellido: 'DONATI',     nombre: 'SANTIAGO',         role: 'AUXILIAR' },
    { apellido: 'FERNANDEZ',  nombre: 'BENJAMIN',         role: 'AUXILIAR' },
    { apellido: 'GOMEZ',      nombre: 'LAUTARO LEONEL',   role: 'AUXILIAR' },
    { apellido: 'LENCINA',    nombre: 'ARIEL',            role: 'AUXILIAR' },
    { apellido: 'MARINGOLO',  nombre: 'MILTON',           role: 'AUXILIAR' },
    { apellido: 'MARTINEZ',   nombre: 'LAUTARO',          role: 'AUXILIAR' },
    { apellido: 'MONTIEL',    nombre: 'JOAQUIN',          role: 'AUXILIAR' },
    { apellido: 'RIVAROLA',   nombre: 'MARIO ANDRES',     role: 'AUXILIAR' },
    { apellido: 'RODRIGUEZ',  nombre: 'TOBIAS JESUS',     role: 'AUXILIAR' },
    { apellido: 'RODRIGUEZ',  nombre: 'DENIS',            role: 'AUXILIAR' },
    { apellido: 'ROMERO',     nombre: 'WALTER',           role: 'AUXILIAR' },
    { apellido: 'SALAZAR',    nombre: 'EZEQUIEL',         role: 'AUXILIAR' },
    { apellido: 'TABOADA',    nombre: 'MAURICIO',         role: 'AUXILIAR' },
    { apellido: 'ZURITA',     nombre: 'ELIAS',            role: 'AUXILIAR' },
];

const SALARIOS_ENERO = [
    { Apellido: 'AVILA',      Nombre: 'EMANUEL GUSTAVO',  'Tipo Puesto': 'Chofer',   Bruto: 1414494.32, Jornal: 0          },
    { Apellido: 'BASTIDA',    Nombre: 'MARCELO ANGEL',    'Tipo Puesto': 'Chofer',   Bruto: 1362468.11, Jornal: 0          },
    { Apellido: 'BUNGS',      Nombre: 'JAVIER',           'Tipo Puesto': 'Chofer',   Bruto: 1260427.68, Jornal: 0          },
    { Apellido: "D'AMICO",    Nombre: 'GERMAN',           'Tipo Puesto': 'Chofer',   Bruto: 1302535.92, Jornal: 0          },
    { Apellido: 'GALARZA',    Nombre: 'DAMIAN',           'Tipo Puesto': 'Chofer',   Bruto: 1250703.16, Jornal: 0          },
    { Apellido: 'SILVA',      Nombre: 'EZEQUIEL',         'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'SUAREZ',     Nombre: 'MAXIMILIANO',      'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'VERBES',     Nombre: 'RUBEN ESTEBAN',    'Tipo Puesto': 'Chofer',   Bruto: 1289601.26, Jornal: 0          },
    { Apellido: 'ALVIÑA',     Nombre: 'NAHUEL',           'Tipo Puesto': 'Auxiliar', Bruto: 1031351.3,  Jornal: 46879.6    },
    { Apellido: 'ARISMENDI',  Nombre: 'GERMAN EZEQUIEL',  'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'BERNACHEA',  Nombre: 'CARLOS ALBERTO',   'Tipo Puesto': 'Auxiliar', Bruto: 1150460.06, Jornal: 52293.64   },
    { Apellido: 'BRITOS',     Nombre: 'EZEQUIEL ALEXIS',  'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'BRITOS',     Nombre: 'FEDERICO NAHUEL',  'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'CARVAJAL',   Nombre: 'JONATHAN',         'Tipo Puesto': 'Auxiliar', Bruto: 1054963.69, Jornal: 47952.89   },
    { Apellido: 'CUEVA',      Nombre: 'ARIEL HERNAN',     'Tipo Puesto': 'Auxiliar', Bruto: 1070705.28, Jornal: 48668.42   },
    { Apellido: "D'AMICO",    Nombre: 'AXEL',             'Tipo Puesto': 'Auxiliar', Bruto: 1073573.53, Jornal: 48798.8    },
    { Apellido: 'DONATI',     Nombre: 'SANTIAGO',         'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'FERNANDEZ',  Nombre: 'BENJAMIN',         'Tipo Puesto': 'Auxiliar', Bruto: 1031351.3,  Jornal: 46879.6    },
    { Apellido: 'GOMEZ',      Nombre: 'LAUTARO LEONEL',   'Tipo Puesto': 'Auxiliar', Bruto: 1047092.89, Jornal: 47595.13   },
    { Apellido: 'LENCINA',    Nombre: 'ARIEL',            'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'MARINGOLO',  Nombre: 'MILTON',           'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'MARTINEZ',   Nombre: 'LAUTARO',          'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'MONTIEL',    Nombre: 'JOAQUIN',          'Tipo Puesto': 'Auxiliar', Bruto: 1039222.1,  Jornal: 47237.37   },
    { Apellido: 'RIVAROLA',   Nombre: 'MARIO ANDRES',     'Tipo Puesto': 'Auxiliar', Bruto: 1185091.56, Jornal: 53867.8    },
    { Apellido: 'RODRIGUEZ',  Nombre: 'TOBIAS JESUS',     'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'RODRIGUEZ',  Nombre: 'DENIS',            'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'ROMERO',     Nombre: 'WALTER',           'Tipo Puesto': 'Auxiliar', Bruto: 1047092.89, Jornal: 47595.13   },
    { Apellido: 'SALAZAR',    Nombre: 'EZEQUIEL',         'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'TABOADA',    Nombre: 'MAURICIO',         'Tipo Puesto': 'Auxiliar', Bruto:  835767.53, Jornal: 37989.43   },
    { Apellido: 'ZURITA',     Nombre: 'ELIAS',            'Tipo Puesto': 'Auxiliar', Bruto: 1054963.69, Jornal: 47952.89   },
];

const COSTOS_ENERO = {
    enero: {
        fijo:     { seguros: 1879000, patentes: 771862, vtv: 57050, chofer: 8127547 },
        variable: { combustible: 2197000, prev: 380625, refrig: 0, cubiertas: 0, lubricantes: 0, lavado: 0 },
        horas_reales: 465
    }
};

const BUSINESS_UNITS = [
    'SAM', 'SAE', 'VIANDA', 'COMEDOR', 'DMC', 'MAE', 'EVENTOS', 'UDI',
    'RETIRO', 'LIBRE', 'COLOINA', 'DESARROLLO', 'CIC', 'ESC VERANO',
    'SUMA', 'DONACION', 'ESPECIAL', 'SUMINISTRO'
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function api(path, method, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}/api/v1${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    return res;
}

function ok(label, n, total) {
    process.stdout.write(`\r  ${label}: ${n}/${total}`);
    if (n === total) console.log(' ✓');
}

// ─── PASOS ────────────────────────────────────────────────────────────────────

async function login() {
    console.log('\n[1/5] Login como juanma...');
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD })
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Login falló (HTTP ${res.status}): ${body}`);
    }
    const data = await res.json();
    const token = data.token || data.accessToken || data.jwt;
    if (!token) throw new Error(`Login OK pero no hay token en la respuesta: ${JSON.stringify(data)}`);
    console.log('   ✓ Token obtenido');
    return token;
}

async function cargarEmpleados(token) {
    console.log('\n[2/5] Creando empleados (30)...');
    let creados = 0, existentes = 0, errores = 0;
    for (let i = 0; i < EMPLEADOS.length; i++) {
        const e = EMPLEADOS[i];
        const fullName = `${e.apellido} ${e.nombre}`;
        const res = await api('/users', 'POST', {
            username: fullName.toUpperCase(),
            fullName,
            role: e.role,
            password: 'no-login'
        }, token);
        if (res.ok) creados++;
        else if (res.status === 409) existentes++;
        else { errores++; console.error(`\n   ERROR ${fullName}: HTTP ${res.status}`); }
        ok('Empleados', i + 1, EMPLEADOS.length);
    }
    console.log(`   Resultado: ${creados} creados, ${existentes} ya existían, ${errores} errores`);
}

async function cargarSalarios(token) {
    console.log('\n[3/5] Cargando salarios enero (30)...');
    let ok2 = 0, errores = 0;
    for (let i = 0; i < SALARIOS_ENERO.length; i++) {
        const s = SALARIOS_ENERO[i];
        const res = await api('/salaries', 'POST', { month: 'enero', ...s }, token);
        if (res.ok) ok2++;
        else { errores++; console.error(`\n   ERROR ${s.Apellido}: HTTP ${res.status}`); }
        ok('Salarios', i + 1, SALARIOS_ENERO.length);
    }
    console.log(`   Resultado: ${ok2} guardados, ${errores} errores`);
}

async function cargarCostos(token) {
    console.log('\n[4/5] Cargando costos de enero...');
    const res = await api('/settings', 'POST', { key: 'costs_data', value: COSTOS_ENERO }, token);
    if (res.ok) console.log('   ✓ Costos guardados');
    else {
        const body = await res.text();
        console.error(`   ✗ Error HTTP ${res.status}: ${body}`);
    }
}

async function cargarBusinessUnits(token) {
    console.log('\n[5/5] Cargando unidades de negocio (18)...');
    const res = await api('/settings', 'POST', { key: 'business_units', value: BUSINESS_UNITS }, token);
    if (res.ok) console.log('   ✓ Unidades de negocio guardadas');
    else {
        const body = await res.text();
        console.error(`   ✗ Error HTTP ${res.status}: ${body}`);
    }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
    console.log('════════════════════════════════════════');
    console.log(' R14 — Carga inicial one-off producción');
    console.log(`  URL: ${BASE_URL}`);
    console.log('════════════════════════════════════════');
    try {
        const token = await login();
        await cargarEmpleados(token);
        await cargarSalarios(token);
        await cargarCostos(token);
        await cargarBusinessUnits(token);
        console.log('\n✅  Carga completa. Ya podés borrar este archivo.');
    } catch (err) {
        console.error('\n❌  Error fatal:', err.message);
        process.exit(1);
    }
})();
