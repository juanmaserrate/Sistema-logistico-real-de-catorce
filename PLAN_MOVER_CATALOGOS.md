# Plan: Reubicar Catálogos a Personal y Usuarios (para Haiku)

Este plan es una secuencia de pasos mecánicos que Haiku puede ejecutar sin decisiones de arquitectura. Cada paso tiene: archivo, línea aproximada, qué buscar, qué poner, verificación.

**Reglas para Haiku:**
- Siempre usar `Read` antes de `Edit`.
- No cambiar indentación existente.
- Al terminar cada bloque, verificar con `Grep` que el código se ve como esperás.
- Si una `Edit` falla porque el `old_string` no es único, agregar más contexto (2-3 líneas más) y reintentar.
- NO tocar partes del archivo que no están listadas en este plan.

---

## Contexto rápido

Archivo principal: `server/public/planificacion.html`

Estado actual (lo que YA existe y NO hay que tocar):
- Rol `CHOFER` y `AUXILIAR` ya funcionan en el backend (`POST /api/v1/users`).
- Función JS `openCatalogModal(role)` ya existe para CHOFER / AUXILIAR / DRIVER (línea ~9489 aprox.).
- Modal `#catalog-modal` ya existe y soporta los 3 roles.
- Tres botones CHOFERES / AUXILIARES / REPARTOS existen en la barra de acciones de Logística Semanal (líneas ~765 a 773).

Objetivo:
1. **Borrar** esos 3 botones de la barra de Logística Semanal.
2. Convertir la sección **Personal** (`#view-employees`) en un módulo con 4 cards:
   - Parámetros x Auxiliar (ya existe)
   - Salarios Empleados (ya existe)
   - **Choferes** (nuevo → abre `openCatalogModal('CHOFER')`)
   - **Auxiliares** (nuevo → abre `openCatalogModal('AUXILIAR')`)
3. Agregar en la sección **Usuarios** (`#view-users`) un módulo **"Usuarios app móvil"** que abra `openCatalogModal('DRIVER')`.
4. **Precargar** los nombres del Excel de enero como entries CHOFER y AUXILIAR (bulk upsert).
5. **Crear 22 usuarios R1..R22** (rol `DRIVER`) con la misma contraseña por defecto, editable.

---

## PASO 1 — Quitar los 3 botones de Logística Semanal

**Archivo:** `server/public/planificacion.html`
**Línea aprox:** 765-773

Usar `Read` para confirmar que las líneas 763-774 muestran los 3 botones `openCatalogModal('CHOFER')`, `('AUXILIAR')`, `('DRIVER')`.

Luego `Edit`:

**old_string:**
```html
                        <button onclick="openCatalogModal('CHOFER')" class="px-4 py-4 rounded-2xl bg-white border border-[#E0E5F2] text-[#1B2559] text-[11px] font-bold hover:bg-[#F4F7FE] transition-all flex items-center gap-2" title="Gestionar catálogo de choferes">
                            <i data-lucide="user" class="w-4 h-4"></i> CHOFERES
                        </button>
                        <button onclick="openCatalogModal('AUXILIAR')" class="px-4 py-4 rounded-2xl bg-white border border-[#E0E5F2] text-[#1B2559] text-[11px] font-bold hover:bg-[#F4F7FE] transition-all flex items-center gap-2" title="Gestionar catálogo de auxiliares">
                            <i data-lucide="users" class="w-4 h-4"></i> AUXILIARES
                        </button>
                        <button onclick="openCatalogModal('DRIVER')" class="px-4 py-4 rounded-2xl bg-white border border-[#E0E5F2] text-[#1B2559] text-[11px] font-bold hover:bg-[#F4F7FE] transition-all flex items-center gap-2" title="Gestionar repartos y sus usuarios móviles">
                            <i data-lucide="truck" class="w-4 h-4"></i> REPARTOS
                        </button>
                        <button onclick="exportWeeklyExcel()"
```

**new_string:**
```html
                        <button onclick="exportWeeklyExcel()"
```

**Verificación:**
```
Grep pattern="openCatalogModal\('CHOFER'\)" path=planificacion.html
```
Debe devolver **solo 1 match** (el de la sección Personal que vas a agregar en el siguiente paso). Si hay 0 matches porque aún no agregaste Personal, también OK. Si hay 2+ matches, revertir.

---

## PASO 2 — Agregar 2 cards en la sección Personal

**Archivo:** `server/public/planificacion.html`
**Buscar:** `<div id="view-employees"` (línea ~1277)

Usar `Read` para ver las líneas 1277-1310.

La sección actual tiene un `grid grid-cols-1 md:grid-cols-2 gap-8` con 2 cards. Cambialo a `md:grid-cols-2 xl:grid-cols-4` y agregá 2 cards nuevas después de "Salarios Empleados".

**old_string:**
```html
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">

                    <button onclick="showSection('cost-aux')" class="card-dark p-8 text-left hover:border-indigo-200 transition-all group">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                                <i data-lucide="users-2" class="w-6 h-6 text-indigo-600"></i>
                            </div>
                            <h4 class="font-black text-[#1B2559]">Parámetros x Auxiliar</h4>
                        </div>
                        <p class="text-sm text-[#A3AED0] font-medium">Jornales, plus y productividad del personal auxiliar.</p>
                    </button>

                    <button onclick="showSection('salaries')" class="card-dark p-8 text-left hover:border-emerald-200 transition-all group">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                                <i data-lucide="wallet" class="w-6 h-6 text-emerald-600"></i>
                            </div>
                            <h4 class="font-black text-[#1B2559]">Salarios Empleados</h4>
                        </div>
                        <p class="text-sm text-[#A3AED0] font-medium">Nómina completa de choferes y auxiliares.</p>
                    </button>
                </div>
            </div>
```

**new_string:**
```html
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">

                    <button onclick="openCatalogModal('CHOFER')" class="card-dark p-8 text-left hover:border-sky-200 transition-all group">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center group-hover:bg-sky-100 transition-colors">
                                <i data-lucide="user" class="w-6 h-6 text-sky-600"></i>
                            </div>
                            <h4 class="font-black text-[#1B2559]">Choferes</h4>
                        </div>
                        <p class="text-sm text-[#A3AED0] font-medium">Catálogo de personas que manejan, para la planilla semanal.</p>
                    </button>

                    <button onclick="openCatalogModal('AUXILIAR')" class="card-dark p-8 text-left hover:border-amber-200 transition-all group">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                                <i data-lucide="users" class="w-6 h-6 text-amber-600"></i>
                            </div>
                            <h4 class="font-black text-[#1B2559]">Auxiliares</h4>
                        </div>
                        <p class="text-sm text-[#A3AED0] font-medium">Catálogo de personas que acompañan en los viajes.</p>
                    </button>

                    <button onclick="showSection('cost-aux')" class="card-dark p-8 text-left hover:border-indigo-200 transition-all group">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                                <i data-lucide="users-2" class="w-6 h-6 text-indigo-600"></i>
                            </div>
                            <h4 class="font-black text-[#1B2559]">Parámetros x Auxiliar</h4>
                        </div>
                        <p class="text-sm text-[#A3AED0] font-medium">Jornales, plus y productividad del personal auxiliar.</p>
                    </button>

                    <button onclick="showSection('salaries')" class="card-dark p-8 text-left hover:border-emerald-200 transition-all group">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                                <i data-lucide="wallet" class="w-6 h-6 text-emerald-600"></i>
                            </div>
                            <h4 class="font-black text-[#1B2559]">Salarios Empleados</h4>
                        </div>
                        <p class="text-sm text-[#A3AED0] font-medium">Nómina completa de choferes y auxiliares.</p>
                    </button>
                </div>
            </div>
```

**Verificación:**
```
Grep pattern="openCatalogModal\('CHOFER'\)" path=planificacion.html
```
Ahora debe devolver **1 match** (el de Personal). El de Logística Semanal ya fue borrado en el Paso 1.

---

## PASO 3 — Agregar card "Usuarios app móvil" en la sección Usuarios

**Archivo:** `server/public/planificacion.html`
**Buscar:** `<div id="view-users"` (línea ~1308)

La sección Usuarios arranca con un header que dice "Gestión de Usuarios". Agregá una card ancha **arriba** de la tabla, justo después del `<div>` del header.

Usar `Read` para ver líneas 1308-1330. Vas a encontrar un bloque como:

```html
<div id="view-users" class="hidden view-animate space-y-8">
    <div class="card-dark p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
            <h3 class="text-2xl font-bold text-[#1B2559]">Gestión de Usuarios</h3>
            <p class="text-sm text-[#A3AED0] font-medium">Alta y administración de credenciales para choferes y administradores</p>
        </div>
```

**Edit — old_string:**
```html
            <!-- VIEW: USUARIOS / CREDENCIALES -->
            <div id="view-users" class="hidden view-animate space-y-8">
                <div class="card-dark p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <h3 class="text-2xl font-bold text-[#1B2559]">Gestión de Usuarios</h3>
                        <p class="text-sm text-[#A3AED0] font-medium">Alta y administración de credenciales para choferes y administradores</p>
                    </div>
```

**Edit — new_string:**
```html
            <!-- VIEW: USUARIOS / CREDENCIALES -->
            <div id="view-users" class="hidden view-animate space-y-8">
                <button onclick="openCatalogModal('DRIVER')" class="card-dark p-8 text-left hover:border-indigo-200 transition-all group w-full">
                    <div class="flex items-center gap-5">
                        <div class="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                            <i data-lucide="smartphone" class="w-7 h-7 text-indigo-600"></i>
                        </div>
                        <div class="flex-1">
                            <h4 class="font-black text-[#1B2559] text-lg">Usuarios app móvil</h4>
                            <p class="text-sm text-[#A3AED0] font-medium mt-1">Repartos (R1 a R22) que se loguean desde el celular del vehículo. Cada reparto tiene su propia contraseña.</p>
                        </div>
                        <i data-lucide="arrow-right" class="w-5 h-5 text-[#A3AED0] group-hover:text-indigo-600 group-hover:translate-x-1 transition-all"></i>
                    </div>
                </button>

                <div class="card-dark p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <h3 class="text-2xl font-bold text-[#1B2559]">Gestión de Usuarios</h3>
                        <p class="text-sm text-[#A3AED0] font-medium">Alta y administración de credenciales para choferes y administradores</p>
                    </div>
```

**Verificación:**
```
Grep pattern="openCatalogModal\('DRIVER'\)" path=planificacion.html
```
Debe devolver **1 match** (el de Usuarios).

---

## PASO 4 — Precargar nombres de enero como CHOFER y AUXILIAR

La data de enero está hardcoded en `salariesDatabase.enero` (línea ~8358). Necesitamos una función que al abrir el modal de CHOFERES o AUXILIARES con la base vacía, sugiera importar los nombres de enero.

**Mejor:** agregar un botón "Importar de Enero" dentro del modal de catálogo que solo aparece para CHOFER/AUXILIAR.

### 4.1 — Agregar botón "Importar de Enero" en el HTML del modal

**Archivo:** `server/public/planificacion.html`
**Buscar:** `id="catalog-modal"` (usar `Grep pattern="catalog-modal-title"` para encontrar la línea exacta)

Dentro del header del modal, antes del botón de cerrar (x), agregar un botón. Usá `Read` para ver el header del modal y luego `Edit`.

Primero ejecutá:
```
Grep pattern="catalog-modal-title" path=planificacion.html -n
```
Leé 20 líneas alrededor del match para ver el contexto exacto del header del modal.

Luego buscá el botón de cerrar del catálogo (probablemente `onclick="closeCatalogModal()"` cerca del título) y agregá **antes** de ese botón de cerrar:

```html
                    <button id="catalog-import-january" onclick="importCatalogFromJanuary()" class="hidden px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-[11px] font-bold hover:bg-emerald-100 transition-all">
                        <i data-lucide="download" class="w-3.5 h-3.5 inline-block mr-1"></i>Importar de Enero
                    </button>
```

### 4.2 — Mostrar el botón solo para CHOFER/AUXILIAR

En la función `openCatalogModal(role)` (línea ~9489), buscá el bloque que setea `loginCol`, `pwdInputWrap`, etc. Justo después de esas líneas agregá:

```javascript
            const importBtn = document.getElementById('catalog-import-january');
            if (importBtn) importBtn.classList.toggle('hidden', meta.needsLogin);
```

Esto muestra el botón solo cuando `needsLogin` es `false` (CHOFER o AUXILIAR), no para DRIVER.

### 4.3 — Agregar la función `importCatalogFromJanuary`

Justo después de la función `addCatalogEntry` (podés buscarla con `Grep pattern="async function addCatalogEntry"`), agregá esta función completa:

```javascript
        async function importCatalogFromJanuary() {
            const role = currentCatalogRole;
            if (role !== 'CHOFER' && role !== 'AUXILIAR') return;
            const enero = (typeof salariesDatabase !== 'undefined' && salariesDatabase.enero) || [];
            if (enero.length === 0) {
                if (typeof addNotification === 'function') addNotification('warning', 'Sin datos', 'No hay datos de enero cargados todavía.');
                return;
            }
            const tipo = role === 'CHOFER' ? 'Chofer' : 'Auxiliar';
            const candidatos = enero.filter(e => String(e['Tipo Puesto'] || '').trim() === tipo);
            if (candidatos.length === 0) {
                if (typeof addNotification === 'function') addNotification('info', 'Sin coincidencias', `No hay ${tipo.toLowerCase()}es en la nómina de enero.`);
                return;
            }
            if (!confirm(`¿Importar ${candidatos.length} ${tipo.toLowerCase()}es desde la nómina de enero? Los que ya existan no se duplican.`)) return;

            let creados = 0, saltados = 0, errores = 0;
            for (const e of candidatos) {
                const fullName = `${e.Apellido || ''} ${e.Nombre || ''}`.trim();
                if (!fullName) { saltados++; continue; }
                const username = fullName
                    .toUpperCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^A-Z0-9]+/g, '.')
                    .replace(/^\.+|\.+$/g, '');
                try {
                    const res = await fetch(`${API_URL}/users`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username, fullName, role })
                    });
                    if (res.ok) creados++;
                    else if (res.status === 409) saltados++;
                    else errores++;
                } catch (_) { errores++; }
            }
            if (typeof addNotification === 'function') {
                addNotification('success', 'Importación terminada', `${creados} creados, ${saltados} ya existían, ${errores} errores.`);
            }
            await loadCatalogRows();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
```

**Nota sobre duplicados:** El backend devuelve error si el `username` ya existe (unique constraint). La función cuenta como "saltado" cualquier error 409 (Conflict) o similar. Asegurate de que el backend devuelva 409 cuando hay duplicate — si devuelve 500, ajustá el check en el try/catch.

**Verificación del paso 4:**
```
Grep pattern="importCatalogFromJanuary" path=planificacion.html
```
Debe devolver **al menos 3 matches**: 1 en el botón del modal, 1 en la definición de la función, 1 (opcional) en el toggle.

---

## PASO 5 — Crear 22 usuarios R1..R22 con contraseña default

### Opción A (recomendada): Botón "Crear R1..R22" dentro del modal REPARTOS

En la función `openCatalogModal`, cuando `role === 'DRIVER'`, mostrá un botón extra "Crear R1..R22 en lote".

**Ubicación:** Justo debajo del botón "Importar de Enero" en el header del modal, agregá **otro** botón:

```html
                    <button id="catalog-create-repartos" onclick="createR1toR22()" class="hidden px-4 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-[11px] font-bold hover:bg-indigo-100 transition-all">
                        <i data-lucide="zap" class="w-3.5 h-3.5 inline-block mr-1"></i>Crear R1..R22
                    </button>
```

Y en `openCatalogModal`, después del toggle de `catalog-import-january`:

```javascript
            const createBtn = document.getElementById('catalog-create-repartos');
            if (createBtn) createBtn.classList.toggle('hidden', !meta.needsLogin);
```

**Lógica de la función** (agregarla al lado de `importCatalogFromJanuary`):

```javascript
        async function createR1toR22() {
            const defaultPwd = prompt('Contraseña por defecto para R1..R22 (podés cambiarla luego por cada reparto):', 'reparto2026');
            if (!defaultPwd || defaultPwd.length < 4) {
                if (typeof addNotification === 'function') addNotification('warning', 'Contraseña inválida', 'Debe tener al menos 4 caracteres.');
                return;
            }
            if (!confirm(`¿Crear 22 repartos (R1..R22) con la contraseña "${defaultPwd}"? Los que ya existan se omiten.`)) return;

            let creados = 0, saltados = 0, errores = 0;
            for (let i = 1; i <= 22; i++) {
                const username = `R${i}`;
                try {
                    const res = await fetch(`${API_URL}/users`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username,
                            fullName: `Reparto ${i}`,
                            role: 'DRIVER',
                            password: defaultPwd
                        })
                    });
                    if (res.ok) creados++;
                    else if (res.status === 409) saltados++;
                    else errores++;
                } catch (_) { errores++; }
            }
            if (typeof addNotification === 'function') {
                addNotification('success', 'Repartos creados', `${creados} creados, ${saltados} ya existían, ${errores} errores.`);
            }
            await loadCatalogRows();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
```

### Cambiar la contraseña de un reparto puntual

Esa funcionalidad **ya existe** en el modal de catálogo: en cada fila hay un botón "Cambiar pass" que llama a `promptCatalogResetPassword(userId, name)`. Verificá con:
```
Grep pattern="promptCatalogResetPassword" path=planificacion.html
```
Debe devolver al menos 2 matches (definición + uso en render).

Esa función ya pega al endpoint `PATCH /api/v1/users/:id/password` que ya existe en el backend, así que **no hay que tocar nada más** — al cambiar la contraseña de un reparto, el usuario móvil del celular tiene que re-loguearse con la nueva.

---

## PASO 6 — Verificación en preview

### 6.1 Arrancar preview si no está corriendo

```
mcp__Claude_Preview__preview_start name="static-r14"
```

### 6.2 Navegar a la página

```
mcp__Claude_Preview__preview_eval serverId=<id> expression="window.location.href = 'http://localhost:3003/planificacion.html'; 'nav'"
```

### 6.3 Chequear que los botones se quitaron de Logística Semanal

```
mcp__Claude_Preview__preview_eval expression="
  const botones = Array.from(document.querySelectorAll('button'))
    .filter(b => /CHOFERES|AUXILIARES|REPARTOS/i.test(b.textContent.trim()));
  return botones.map(b => ({ text: b.textContent.trim().slice(0,20), parentId: b.closest('[id]')?.id }));
"
```
Los botones no deben aparecer en `view-weekly`. Pueden aparecer en `view-employees` y `view-users` (son los nuevos cards).

### 6.4 Chequear que el módulo de Personal tiene las 4 cards

```
mcp__Claude_Preview__preview_eval expression="
  showSection('employees');
  const cards = document.querySelectorAll('#view-employees button');
  return Array.from(cards).map(b => b.querySelector('h4')?.textContent.trim());
"
```
Debe devolver algo como `["Choferes","Auxiliares","Parámetros x Auxiliar","Salarios Empleados"]`.

### 6.5 Chequear que el módulo de Usuarios tiene la card "Usuarios app móvil"

```
mcp__Claude_Preview__preview_eval expression="
  showSection('users');
  const btn = document.querySelector('#view-users button[onclick*=\"openCatalogModal(\\'DRIVER\\')\"]');
  return btn ? btn.querySelector('h4')?.textContent.trim() : 'NOT FOUND';
"
```
Debe devolver `"Usuarios app móvil"`.

### 6.6 Chequear que `importCatalogFromJanuary` y `createR1toR22` existen

```
mcp__Claude_Preview__preview_eval expression="
  return {
    importJanuary: typeof importCatalogFromJanuary,
    createR1R22: typeof createR1toR22
  };
"
```
Debe devolver `{ importJanuary: "function", createR1R22: "function" }`.

---

## PASO 7 — Commit y push

Solo después de que TODOS los checks del Paso 6 pasen:

```
cd Sistema-logistico-real-de-catorce
git add server/public/planificacion.html
git commit -m "feat: mover catalogos a secciones Personal y Usuarios + importar nomina enero + lote R1..R22

- Borra los 3 botones CHOFERES/AUXILIARES/REPARTOS de Logistica Semanal.
- Agrega 2 cards (Choferes, Auxiliares) en la seccion Personal.
- Agrega card 'Usuarios app movil' en la seccion Usuarios.
- Nuevo boton 'Importar de Enero' en el modal de CHOFERES/AUXILIARES
  que crea un User por cada persona de la nomina de enero.
- Nuevo boton 'Crear R1..R22' en el modal de REPARTOS que crea 22
  usuarios DRIVER en lote con una contrasena por defecto editable.
"
git push origin main
```

---

## Errores comunes y cómo resolverlos

1. **`Edit` falla con "old_string no es único"** → agregá más contexto (2-3 líneas antes/después) al `old_string` y reintentá.
2. **Botón "Crear R1..R22" no aparece en REPARTOS** → revisá que el toggle usa `!meta.needsLogin` (con `!`). El de "Importar de Enero" usa `meta.needsLogin` (sin `!`).
3. **Importar de Enero no crea nada** → la función busca `salariesDatabase.enero` que solo existe después de que se cargue `loadSalariesData()`. Si el usuario abre el modal de CHOFERES antes de ir a Salarios alguna vez, la data hardcoded del fallback (línea ~8358) igual se carga al iniciar la app, así que debería funcionar. Si no, agregar `await loadSalariesData()` al inicio de `importCatalogFromJanuary`.
4. **Crear R1..R22 devuelve error 400 "password es obligatorio"** → ya está arreglado en el backend (`index.ts` línea ~50 aprox, ver `resolveRepartoUserForTrip` y la lógica de `requiresPassword`). Si igual falla, chequear que el body del POST incluye `password: defaultPwd`.

---

## Qué NO tiene que hacer Haiku

- No tocar `server/src/index.ts` (el backend ya soporta todo lo necesario).
- No tocar el esquema de Prisma.
- No tocar la app móvil (`mobile/`).
- No crear archivos nuevos. Todo se edita en `server/public/planificacion.html`.
- No inventar estilos nuevos — usar las clases Tailwind que ya están en el archivo.
- No cambiar lógica de `openNewTripModal` o `saveNewTrip` (ya están hechas).
