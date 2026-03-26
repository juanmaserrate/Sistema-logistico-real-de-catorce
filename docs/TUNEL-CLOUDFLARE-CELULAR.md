# Abrir la app en el celular con Cloudflare Tunnel

Si **ngrok abre en la PC pero no en el celular** (ni con datos ni con otra WiFi), probá con **Cloudflare Tunnel**. Suele funcionar mejor desde redes móviles y no muestra pantalla de "Visit Site".

## 1. Instalar cloudflared (solo una vez)

**Opción A – Descarga directa**

1. Entrá a: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Descargá **cloudflared** para Windows (64-bit).
3. Descomprimí el ZIP y dejá `cloudflared.exe` en una carpeta (ej: `C:\cloudflared`).
4. Opcional: agregá esa carpeta al PATH de Windows para usarlo desde cualquier terminal.

**Opción B – Con winget (si tenés Windows 11 o Windows 10 actualizado)**

```bash
winget install Cloudflare.cloudflared
```

Cerrá y volvé a abrir la terminal después de instalar.

## 2. Arrancar backend y frontend

En dos terminales:

- **Terminal 1:** `cd server` → `npm run dev`
- **Terminal 2:** `cd client` → `npm run dev`

Anotá en qué puerto arranca Vite (ej: **5175**, 5176 o 5177).

## 3. Arrancar el túnel Cloudflare

En una **tercera terminal**, desde la carpeta del proyecto:

Si Vite está en el **5175**:

```bash
cloudflared tunnel --url http://127.0.0.1:5175
```

Si Vite está en **5177** (u otro), cambiá el número:

```bash
cloudflared tunnel --url http://127.0.0.1:5177
```

En la terminal va a aparecer una línea parecida a:

```text
Your quick Tunnel has been created! Visit it at:
https://algo-random.trycloudflare.com
```

Esa es la URL que tenés que usar.

## 4. Abrir en el celular

En el navegador del celular (con datos o con cualquier WiFi) abrí:

**https://la-url-que-te-dio-cloudflare/ubicacion.html**

Ejemplo, si salió `https://abc-xyz-123.trycloudflare.com`:

**https://abc-xyz-123.trycloudflare.com/ubicacion.html**

No hace falta tocar "Visit Site"; debería cargar directo.

---

## Nota

Cada vez que reiniciás `cloudflared`, la URL **cambia** (ej: otra cosa `.trycloudflare.com`). Tenés que usar la nueva URL en el celular. Para una URL fija necesitarías una cuenta de Cloudflare y un dominio.
