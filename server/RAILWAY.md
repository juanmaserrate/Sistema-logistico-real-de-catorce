# Desplegar en Railway

## Checklist rápida

- [ ] Repo en GitHub/GitLab y conectado a Railway.
- [ ] **Root Directory** del servicio = `server`.
- [ ] Volumen montado en **`/data`**.
- [ ] Variables: `DATABASE_URL=file:/data/r14.db`, `UPLOADS_DIR=/data/uploads`.
- [ ] **Generate domain** y en la app: `EXPO_PUBLIC_API_URL=https://tu-dominio...` (sin `/` final).

Este repo ya incluye `server/railway.toml` (Nixpacks + `releaseCommand` + healthcheck `/health`). Si el build con Nixpacks falla, en **Settings → Build** podés cambiar a **Dockerfile** (usa `server/Dockerfile`); el `releaseCommand` del `railway.toml` sigue aplicando el schema antes de arrancar.

## 1. Repositorio

Subí el proyecto a **GitHub** (o GitLab). Railway se conecta al repo.

## 2. Nuevo proyecto en Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → elegí el repo.
2. En el servicio generado → **Settings** → **Root Directory** → `server`  
   (así Railway solo construye la carpeta del backend).

## 3. Volumen (obligatorio: base SQLite y fotos)

Sin volumen, **cada deploy borra** la base y las fotos subidas.

1. En el mismo servicio → pestaña **Volumes** → **Add volume**.
2. **Mount path:** `/data`
3. Variables (pestaña **Variables**):

| Variable | Valor |
|----------|--------|
| `DATABASE_URL` | `file:/data/r14.db` |
| `UPLOADS_DIR` | `/data/uploads` |

Railway inyecta `PORT` solo; no hace falta definirlo.

## 4. Dominio público

**Settings** → **Networking** → **Generate domain** (o conectá un dominio propio).  
La URL será algo como `https://tu-proyecto.up.railway.app`.

- Planificación web: `https://TU-DOMINIO/planificacion.html`
- Salud del servicio: `https://TU-DOMINIO/health`

## 5. App móvil

En `mobile/.env` (y en el build EAS):

```env
EXPO_PUBLIC_API_URL=https://TU-DOMINIO
```

(sin barra final; debe ser **HTTPS** para datos móviles sin bloqueos raros).

## 6. Variables opcionales

Copiá desde tu `.env` local lo que ya uses, por ejemplo:

- `GOOGLE_MAPS_API_KEY` / `GOOGLE_DIRECTIONS_API_KEY` (geometría e indicaciones).

## 7. Primer deploy

- **Release** ejecuta `prisma db push` y crea tablas en `r14.db` dentro del volumen.
- Si tenés datos en un `r14.db` local, podés subirlos con la CLI de Railway o un backup manual al volumen (avanzado); lo habitual es **empezar vacío** o importar después desde planificación.

## 8. Cambios desde Cursor

1. Commit + push a la rama conectada a Railway.  
2. Railway redeploya solo.  
3. Si cambiás **schema Prisma**, al deploy el `releaseCommand` actualiza la base (`db push`).

---

**Nota:** Más adelante podés migrar a **PostgreSQL** (plugin de Railway) para backups más simples; hoy el proyecto usa SQLite pensado para un volumen persistente.
