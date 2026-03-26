@echo off
REM Túnel Cloudflare (suele funcionar mejor que ngrok desde el celular con datos)
REM Necesitas tener cloudflared instalado: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
REM O con winget: winget install Cloudflare.cloudflared

set PORT=5175
if not "%VITE_PORT%"=="" set PORT=%VITE_PORT%

echo.
echo Conectando al puerto %PORT%...
echo Si Vite esta en otro puerto, ejecuta: set VITE_PORT=5177 ^&^& start_tunnel_cloudflare.bat
echo.

cloudflared tunnel --url http://127.0.0.1:%PORT%

pause
