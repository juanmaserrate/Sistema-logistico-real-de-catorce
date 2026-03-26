# Poner el sistema y la app online — paso a paso (sencillo)

Esta guía es el camino **más corto**: servidor + planificación web en **Railway**, y la app móvil hablando con ese servidor por **HTTPS**.

---

## Qué ya está listo en el proyecto (no tenés que configurarlo)

| Listo | Qué es |
|--------|--------|
| Código en GitHub | Para que Railway pueda clonar y desplegar. |
| Carpeta `server` | API + archivos estáticos + `planificacion.html`. |
| `server/railway.toml` | Indica cómo construir, arrancar y chequear salud (`/health`). |
| `server/Dockerfile` | Plan B si el build automático falla (lo ves más abajo). |
| `server/.env.example` | Referencia de variables (local vs Railway). |

**Vos solo tenés que:** crear el servicio en Railway, pegar variables, generar el dominio, y después apuntar la app con la misma URL.

---

## Parte 1 — Railway (servidor + planificación en internet)

Hacelo en este orden; son **clics**, sin código.

### 1. Entrá a Railway

Abrí [railway.app](https://railway.app), iniciá sesión (GitHub suele ser lo más fácil).

### 2. Nuevo proyecto desde tu repo

- **New project** → **Deploy from GitHub**.
- Autorizá a Railway si te lo pide.
- Elegí el repositorio del sistema (por ejemplo `Sistema-logistico-real-de-catorce`).

### 3. Decirle que el código del backend está en `server`

- Abrí el **servicio** que creó el deploy.
- **Settings** (engranaje) → buscá **Root Directory** → escribí exactamente: `server` → guardá.

Railway va a **reconstruir** solo; esperá a que termine (1–3 minutos). Si falla el build, en **Settings → Build** podés probar **Dockerfile** en lugar del builder por defecto.

### 4. Volumen (muy importante)

Sin esto, **cada vez que despliegás perdés la base y las fotos**.

- En el mismo servicio: pestaña **Volumes** → **Add Volume**.
- **Mount path:** `/data` (tal cual, con la barra inicial).

### 5. Variables de entorno (copiar y pegar)

Andá a **Variables** del servicio y agregá estas **dos** (nombre exacto, valor exacto):

| Nombre | Valor |
|--------|--------|
| `DATABASE_URL` | `file:/data/r14.db` |
| `UPLOADS_DIR` | `/data/uploads` |

No hace falta definir `PORT`: Railway lo asigna solo.

**Opcional:** si en tu PC usás Google para mapas/rutas en el servidor, copiá también desde tu `server/.env` local:

- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_DIRECTIONS_API_KEY`

Guardá. Railway suele redeployar solo.

### 6. Dominio público (HTTPS)

- **Settings** → **Networking** → **Generate Domain**.
- Copiá la URL que te da, algo como `https://algo-production.up.railway.app`.  
  **Sin barra al final** cuando la uses en la app.

### 7. Comprobar que el sistema “está vivo”

En el navegador (reemplazá `TU-URL` por la tuya):

- `https://TU-URL/health` → debería verse **`ok`**.
- `https://TU-URL/planificacion.html` → debería cargar la planificación.

Si algo no abre: en Railway mirá **Deployments → logs** del servicio.

### 8. Datos al inicio

La primera vez la base en el volumen está **vacía**: usuarios y datos los cargás como ya hacés en local (planificación, scripts, etc.), o importás si más adelante tenés un proceso definido.

---

## Parte 2 — App móvil (que el celular use el servidor de internet)

La app lee la URL del API en build: `EXPO_PUBLIC_API_URL`. Tiene que ser **HTTPS** (la de Railway).

### 9. En tu PC: archivo `.env` en `mobile`

En la carpeta `mobile`:

1. Si no existe, copiá `env.example` a `.env`.
2. Ponelínea (con tu URL real):

```env
EXPO_PUBLIC_API_URL=https://tu-proyecto.up.railway.app
```

Sin `/` al final. Las claves de Google Maps las dejás como ya tenés para Android/iOS.

### 10. En EAS (build en la nube): el mismo valor

Si compilás con **EAS Build**, las variables `EXPO_PUBLIC_*` tienen que estar definidas **en el build**. Lo más simple:

- En [expo.dev](https://expo.dev) → tu proyecto → **Secrets**, o
- En consola, desde `mobile`:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_API_URL --value https://tu-proyecto.up.railway.app
```

(Reemplazá por tu URL.)

### 11. Generar e instalar la app

Desde la carpeta `mobile` (con cuenta `eas login` hecha):

- Para probar con equipo interno: **`npm run build:apk`** (perfil preview) o el perfil que uses.
- Descargás el APK del link que da EAS y lo instalás en el celular.

**Importante:** esta app usa módulos nativos; **no esperes que todo funcione en Expo Go**. Usá el APK del build.

---

## Parte 3 — Resumen de “qué es cada cosa”

| Pieza | Dónde vive online |
|--------|-------------------|
| API + fotos + planificación web | **Un solo servicio Railway** (`server`), con volumen en `/data`. |
| App chofer | **APK/IPA** compilado con EAS y `EXPO_PUBLIC_API_URL` = tu URL Railway. |
| Panel Vite (`client/`) | No se despliega solo con este flujo; si lo necesitás en internet, se puede sumar otro deploy o servir el build estático aparte. |

---

## Si algo falla (rápido)

| Síntoma | Qué mirar |
|---------|-----------|
| Build Railway falla | **Logs** del deploy; probá builder **Dockerfile** en Settings. |
| `/health` no responde | Variables y que el servicio esté “Running”; revisá logs. |
| App no conecta | Misma URL en `.env` y en `eas secret`, **HTTPS**, sin `/` final; volvé a **compilar** después de cambiar la variable. |
| Perdés datos al redeploy | Falta volumen en **`/data`** o `DATABASE_URL` no es `file:/data/r14.db`. |

---

## Documentación técnica extra

- Detalle de Railway (misma info, otro formato): [server/RAILWAY.md](../server/RAILWAY.md).
- App móvil (Expo / EAS): [mobile/README.md](../mobile/README.md).
