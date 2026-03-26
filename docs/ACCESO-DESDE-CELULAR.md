# Acceso a la app desde el celular

## Si dice "No se puede acceder a este sitio"

El celular no está llegando a la URL. Revisá estos pasos **en la PC**:

### 1. ¿La URL abre en la PC?

En el navegador **de la PC** (Chrome, Edge, etc.) abrí:

**https://uropygial-conservational-joy.ngrok-free.dev/ubicacion.html**

- **Si en la PC tampoco abre:** el túnel ngrok no está activo o está mal configurado. Seguí el paso 2.
- **Si en la PC sí abre:** entonces ngrok funciona; el problema puede ser la red del celular (datos o WiFi) que no llega a ngrok. Probá con el celular en **la misma WiFi que la PC** usando la IP local (paso 3).

### 2. Tener todo corriendo y el puerto correcto

En la PC tené **tres terminales** abiertas:

| Terminal | Comando | Debe decir algo como |
|----------|---------|----------------------|
| 1. Backend | `cd server` y luego `npm run dev` | `R14 Logistics VRP Server running on port 3002` |
| 2. Frontend | `cd client` y luego `npm run dev` | `Local: http://localhost:5175/` (o 5176, 5177) |
| 3. Túnel ngrok | `node server/start_tunnel.js` | `>>> TU APP ESTÁ ONLINE AQUÍ: https://uropygial-conservational-joy.ngrok-free.dev <<<` |

**Importante:** ngrok debe apuntar al **mismo puerto** que el frontend. Si Vite arrancó en el puerto **5177**, ejecutá el túnel así:

- **Windows (PowerShell):**  
  `$env:PORT="5177"; node server/start_tunnel.js`

- **Windows (CMD):**  
  `set PORT=5177 && node server/start_tunnel.js`

(Reemplazá 5177 por el puerto que te mostró Vite.)

Luego probá de nuevo en la PC: **https://uropygial-conservational-joy.ngrok-free.dev/ubicacion.html**

### 3. Probar con el celular en la misma WiFi (sin ngrok)

Si el celular está en **la misma red WiFi que la PC**, podés usar la IP de la PC y no depender de ngrok:

1. En la PC, en una terminal ejecutá `ipconfig` y buscá **Dirección IPv4** (ej: 192.168.1.44).
2. En el celular (conectado al mismo WiFi) abrí en el navegador:
   - **http://192.168.1.44:5175/ubicacion.html**
   - (Usá el puerto que esté usando Vite: 5175, 5176 o 5177.)

Si **esto sí abre en el celular**, entonces el problema es solo cuando el celular usa **datos móviles** o otra red: ngrok no está llegando (túnel caído, o el operador/red bloquea ngrok).

### 4. Si en la PC abre pero en el celular no (datos u otra WiFi)

**Probá con Cloudflare Tunnel en lugar de ngrok.** Suele funcionar mejor desde el celular:

1. Instalá **cloudflared**: [Descargas Cloudflare](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) o `winget install Cloudflare.cloudflared`
2. Con el backend y Vite corriendo, en otra terminal:  
   `cloudflared tunnel --url http://127.0.0.1:5175`  
   (usá el puerto donde esté Vite: 5175, 5176, 5177)
3. En la terminal te va a dar una URL tipo **https://xxx.trycloudflare.com**
4. En el celular abrí: **https://esa-url/ubicacion.html**

Instrucciones completas: **docs/TUNEL-CLOUDFLARE-CELULAR.md**

### 5. Uso estable con choferes

Para uso en la calle sin depender de la PC, lo más confiable es **subir la app a un servidor** (hosting) y usar una URL fija (ej: `https://tuapp.com/ubicacion.html`).

---

## URLs para el celular

| URL | Cuándo |
|-----|--------|
| https://uropygial-conservational-joy.ngrok-free.dev/ubicacion.html | Cuando ngrok está corriendo y el celular puede llegar. |
| http://192.168.1.XX:5175/ubicacion.html | Celular en la **misma WiFi** que la PC (reemplazá XX por la IP de tu PC y 5175 por el puerto de Vite). |
