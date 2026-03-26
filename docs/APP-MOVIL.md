# App móvil R14 (choferes)

La app para choferes es **una sola**: se puede usar como **PWA** (ícono en el celular) o como **APK** instalable. En ambos casos hace lo mismo.

## Qué hace la app

- **Login:** El chofer inicia sesión con su usuario y contraseña (los mismos que en el sistema de planificación).
- **Paradas del día:** Ve las rutas que le asignaron desde el sistema de planificación para hoy, con la lista de paradas en orden.
- **Cómo llegar:** En cada parada puede tocar **“Cómo llegar”** y se abre Google Maps (o la app de mapas del celular) con el destino para que le indique el camino.
- **Marcar llegada:** Al llegar al cliente, toca **“Marcar llegada”**.
- **Marcar salida:** Al irse, toca **“Marcar salida”** y completa el cuadro:
  - **Motivo / resultado:** por ejemplo “Entregado OK”, “Local cerrado”, “Cliente ausente”, etc.
  - **Observaciones:** texto libre (notas, incidencias).
- **Ubicación:** La app envía la ubicación del celular al servidor en segundo plano cada 30 segundos (para rastreo en el panel de administración).

Las paradas se asignan desde el **sistema de planificación** (rutas con chofer y fecha). El chofer no elige las paradas; solo las ejecuta y marca llegada/salida.

---

## Opción 1: PWA – “Agregar a la pantalla de inicio”

1. En el celular, abrir en Chrome (o Safari en iPhone) la URL de la app (ej. `https://tu-dominio.com` o la URL del túnel).
2. Chrome: menú (⋮) → **“Instalar app”** o **“Agregar a la pantalla de inicio”**.  
   iPhone: en Safari, compartir → **“Agregar a pantalla de inicio”**.
3. En la pantalla de inicio aparece el ícono **“R14 App”**. Al abrirlo, el chofer ve el login y luego sus paradas del día.

---

## Opción 2: APK – App Android instalable

### Requisitos

- Node.js y Android Studio en tu PC.
- Backend desplegado en una URL pública (ej. `https://api.tudominio.com`). La app no puede usar `localhost`.

### Pasos para generar el APK

1. **Build con la URL del backend** (en la carpeta `client`):

   ```bash
   # Windows CMD
   set VITE_API_URL=https://tu-backend.com
   npm run build:app
   ```

   PowerShell:

   ```powershell
   $env:VITE_API_URL="https://tu-backend.com"; npm run build:app
   ```

   (Reemplazá `https://tu-backend.com` por la URL real de tu API, **sin** barra al final.)

2. **Sincronizar con Android:**

   ```bash
   npx cap sync
   npx cap open android
   ```

3. **En Android Studio:** **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**.  
   El archivo `.apk` queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

4. **Repartir el APK:** Enviarlo por WhatsApp, mail o link de descarga. Los choferes lo instalan y abren el ícono “R14 Logística” para entrar a la app (login → paradas del día → cómo llegar, marcar llegada/salida).

---

## Resumen

| Opción | Uso |
|--------|-----|
| **PWA** | Abrir la URL una vez, instalar/agregar a pantalla de inicio; después abrir siempre por el ícono. |
| **APK** | Instalar el .apk en el celular y abrir la app como cualquier otra. |

En ambos casos la app es la misma: login, paradas asignadas desde planificación, indicación del camino (Google Maps), marcar llegada y salida con el cuadro de motivo y observaciones, y reporte de ubicación en segundo plano.
