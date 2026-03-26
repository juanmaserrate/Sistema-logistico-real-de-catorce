# Cómo descargar la app (APK) para los choferes

La app **no está en la Play Store**. Vos la generás en tu PC y después la pasás a los celulares (por WhatsApp, mail o un link).

---

## Requisitos en tu PC

1. **Node.js** instalado (si ya corre el proyecto, lo tenés).
2. **Android Studio** instalado ([descargar acá](https://developer.android.com/studio)).
3. **Backend en internet:** La app tiene que poder hablar con tu servidor. Si hoy probás con la PC en tu casa, podés usar un túnel (ngrok o Cloudflare) y usar esa URL. Para uso real conviene tener el backend en un servidor (Railway, Render, etc.) con una URL fija.

---

## Pasos (en orden)

### 1. Abrir terminal en la carpeta del proyecto

Abrí PowerShell o CMD y andá a la carpeta **client**:

```powershell
cd C:\Users\juanma\Desktop\Ai\real-de-catorce-app\client
```

### 2. Definir la URL del backend y compilar la app

Reemplazá `https://TU-URL.com` por la dirección real de tu API (sin barra al final). Ejemplo: si usás ngrok, algo como `https://abc123.ngrok.io`.

**PowerShell:**

```powershell
$env:VITE_API_URL="https://TU-URL.com"
npm run build:app
```

**CMD:**

```cmd
set VITE_API_URL=https://TU-URL.com
npm run build:app
```

Si no tenés todavía una URL pública, podés usar una de prueba (la app no va a conectar hasta que el backend sea accesible):

```powershell
$env:VITE_API_URL="https://ejemplo.com"
npm run build:app
```

### 3. Sincronizar con Android

En la misma carpeta `client`:

```powershell
npx cap sync
npx cap open android
```

Se abre **Android Studio** con el proyecto.

### 4. Generar el APK en Android Studio

1. En el menú: **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**.
2. Esperá a que termine (abajo dice "APK(s) generated successfully").
3. Hacé clic en **locate** (o "Find in Explorer") en la notificación, o andá a la carpeta:
   - `client\android\app\build\outputs\apk\debug\`
   - Ahí está el archivo **app-debug.apk**.

### 5. Descargar / pasar la app al celular

- **En tu PC:** Ese archivo **app-debug.apk** es la app. Copialo a Google Drive, Dropbox, o enviarlo por WhatsApp a vos mismo (o a cada chofer).
- **En el celular:** Descargar el APK (desde el link o desde WhatsApp), abrirlo e instalar. Si Android pide "Permitir instalación de fuentes desconocidas", aceptar para esa app o para Chrome/archivos.

Listo: en el celular queda instalada la app "R14" (o el nombre que tenga el proyecto). Al abrirla, el chofer inicia sesión y ve sus paradas del día.

---

## Resumen rápido

| Paso | Comando / acción |
|------|------------------|
| 1 | `cd client` |
| 2 | `$env:VITE_API_URL="https://tu-backend.com"; npm run build:app` |
| 3 | `npx cap sync` y `npx cap open android` |
| 4 | En Android Studio: Build → Build APK(s) |
| 5 | Tomar el APK de `android\app\build\outputs\apk\debug\app-debug.apk` y pasarlo al celular |

Si no tenés Android Studio todavía, el único paso extra es instalarlo desde el link de arriba; el resto es igual.
