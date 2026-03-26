@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  [1/3] Levantando servidor API (puerto 3002) en otra ventana...
start "R14 API 3002" cmd /k "cd /d \"%~dp0server\" && npm run dev"

echo  [2/3] Esperando 5 segundos a que arranque el servidor...
timeout /t 5 /nobreak >nul

echo  [3/3] Iniciando Expo (escaneá el QR con Expo Go)...
echo.
cd /d "%~dp0mobile"
call npm run go
pause
