# Plan de unificación: Excel de clientes → Base Escuelas/Clientes

## Objetivo
Unificar los datos del Excel **clientes_exportado_completo.xlsx** con la base de datos de Escuelas/Clientes, **respetando los nombres de establecimientos que usa el Reparto** (para no romper el matching ni la visualización en repartos).

## Origen de datos
- **Archivo:** `C:\Users\juanma\Desktop\clientes_exportado_completo.xlsx`
- **Filas:** 321 filas de datos (primera fila = encabezado).
- **Columnas:**
  - **A – Cliente:** nombre del establecimiento.
  - **B – Localidad:** texto tipo `LOCALIDAD - ZONA` (ej: `QUILMES - QUILMES`, `QUILMES - LA ESPERANZA`). Se parsea para obtener zona (y opcionalmente localidad/barrio).
  - **C – Dirección (calle):** dirección ya escrita. Se usa cuando viene informada.
  - **D – Número (calle):** se puede concatenar a la dirección si hace falta.
  - **E – Latitud**
  - **F – Longitud**
- **Dirección:** se toma de la columna C (y D si aplica). Si C está vacía, se puede obtener por **geocodificación inversa** (lat/long → dirección) usando un servicio tipo Nominatim (OpenStreetMap).

## Reglas de unificación

1. **Respetar nombres del reparto**  
   Los nombres que aparecen en el Excel de **Repartos** son la referencia. No se debe **sobrescribir** el nombre del cliente cuando ese cliente ya está vinculado a un establecimiento de reparto (vía `EstablishmentMapping` o porque `Client.name` coincide con el nombre usado en repartos).  
   - Al **actualizar** un cliente existente: solo se actualizan `address`, `latitude`, `longitude`, `zone`, `barrio` (y ventanas horarias si se desea). No se cambia `name`.  
   - Al **crear** un cliente nuevo: `name` = valor de la columna A del Excel de clientes.

2. **Matching**  
   Para cada fila del Excel de clientes (col A = nombre establecimiento):
   - Se busca un cliente existente tal que:
     - el nombre del cliente (normalizado) coincida con el nombre del Excel (normalizado), **o**
     - algún `EstablishmentMapping.excelName` (nombre usado en repartos) coincida con ese nombre (normalizado).
   - Misma lógica de normalización que en repartos: minúsculas, sin acentos, espacios normalizados.

3. **Zona y localidad**  
   De la columna B (`LOCALIDAD - ZONA`):
   - Parte después del ` - ` → **Zona** (campo `Client.zone`).
   - Parte antes del ` - ` → se puede guardar como **barrio** o parte de la dirección si no hay dirección en C.

4. **Coordenadas**  
   Siempre se actualizan/crean con los valores de las columnas E y F (latitud y longitud).

5. **Depósito**  
   No modificar el cliente que representa el depósito (ej. "Real 14" / Ombu 1269). Se puede excluir por nombre o dirección en el script.

## Flujo del script de importación

1. Leer Excel `clientes_exportado_completo.xlsx` (detectar encabezado y usar 321 filas de datos).
2. Cargar de la base de datos:
   - Todos los clientes (`tenantId = default-tenant`).
   - Todos los `EstablishmentMapping` (para saber qué nombres de reparto apuntan a qué cliente).
3. Por cada fila del Excel (salvo depósito si se detecta):
   - Parsear: nombre (A), localidad-zona (B), dirección (C, D), lat (E), lng (F).
   - Parsear B en zona (y opcionalmente barrio/localidad).
   - Si no hay dirección en C, opcional: geocodificación inversa con lat/long.
   - Buscar cliente existente por nombre normalizado (nombre del cliente o `excelName` de algún mapping).
   - **Si hay match:**  
     `update` del cliente con: `address`, `latitude`, `longitude`, `zone`, `barrio`. No tocar `name`.
   - **Si no hay match:**  
     `create` nuevo cliente con `name` = A, más dirección, lat, lng, zona, barrio y `tenantId = default-tenant`.
4. Opcional: después de la importación, volver a ejecutar la sincronización de repartos desde el Excel de repartos para refrescar repartos y mappings (los nombres de reparto se siguen respetando porque no hemos cambiado los nombres de los clientes vinculados).

## Resultado esperado
- Base de clientes/escuelas actualizada con direcciones, coordenadas y zonas del Excel completo.
- Nombres que muestra el módulo Repartos sin cambios (no se rompe el vínculo establecimiento ↔ cliente).
- Establecimientos del Excel de clientes que no existían en la base, creados como nuevos clientes.

## Archivos
- **Script de importación:** `server/scripts/import-clientes-from-excel.ts` (ejecutable con `npx ts-node scripts/import-clientes-from-excel.ts`).
- **Plan:** este documento.
