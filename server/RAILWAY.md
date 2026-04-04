# Desplegar en Railway

## Checklist rápida

- [ ] Repo en GitHub/GitLab conectado a Railway.
- [ ] **Root Directory** del servicio = `server`.
- [ ] Servicio **PostgreSQL** agregado al proyecto Railway.
- [ ] Volumen montado en **`/data`** (solo para fotos de comprobante).
- [ ] Variables: `UPLOADS_DIR=/data/uploads`. Railway inyecta `DATABASE_URL` y `PORT` automáticamente.
- [ ] **Generate domain** y en la app móvil: `EXPO_PUBLIC_API_URL=https://tu-dominio...` (sin `/` final).

## 1. Repositorio

Subí el proyecto a **GitHub**. Railway se conecta al repo.

## 2. Nuevo proyecto en Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → elegí el repo.
2. En el servicio generado → **Settings** → **Root Directory** → `server`.

## 3. Base de datos PostgreSQL (obligatorio)

1. En el proyecto Railway → **New** → **Database** → **PostgreSQL**.
2. Railway crea el servicio de Postgres y **automáticamente inyecta `DATABASE_URL`** en el servicio del servidor.
   No necesitás copiar nada a mano.

> **Para desarrollo local:** copiá la `DATABASE_URL` de Railway (pestaña **Connect** del servicio Postgres) y pegála en `server/.env`.

## 4. Volumen (para fotos de comprobante)

1. En el servicio del servidor → pestaña **Volumes** → **Add volume**.
2. **Mount path:** `/data`
3. Variables (pestaña **Variables**):

| Variable | Valor |
|----------|--------|
| `UPLOADS_DIR` | `/data/uploads` |

Railway inyecta `PORT` y `DATABASE_URL` solo; no hace falta definirlos.

## 5. Dominio público

**Settings** → **Networking** → **Generate domain**.
La URL será algo como `https://tu-proyecto.up.railway.app`.

- Planificación web: `https://TU-DOMINIO/planificacion.html`
- Salud del servicio: `https://TU-DOMINIO/health`

## 6. App móvil

En `mobile/.env`:

```env
EXPO_PUBLIC_API_URL=https://TU-DOMINIO
```

## 7. Variables opcionales

- `GOOGLE_MAPS_API_KEY` / `GOOGLE_DIRECTIONS_API_KEY` (geometría e indicaciones).

## 8. Primer deploy

- **Release** ejecuta `prisma db push` y crea todas las tablas en PostgreSQL.
- El servidor arranca con WebSockets habilitados (socket.io).

## 9. Cambios desde la PC

1. Commit + push a la rama conectada a Railway.
2. Railway redeploya solo.
3. Si cambiás el **schema Prisma**, al deploy el `releaseCommand` actualiza la base (`db push`).
