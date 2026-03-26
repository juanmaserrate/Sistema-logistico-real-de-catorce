# 🚚 Real de Catorce - Sistema de Logística

El sistema está operativo y separado de Ingenium ERP.

## 🔗 Links de Acceso

- **App Choferes:** [http://localhost:5175](http://localhost:5175)
- **Servidor Backend:** [http://localhost:3002](http://localhost:3002)

## 🔑 Credenciales de Prueba

Para ver viajes asignados, ingrese con el nombre exacto de un chofer (datos extraídos del Excel de planificación):

- **Nombre:** GUSTAVO PEREZ
- **Nombre:** DANIEL GOMEZ
- **Nombre:** CARLOS LOPEZ

## ℹ️ Notas Técnicas

- El sistema muestra solo viajes programados desde el **1 de Febrero de 2026**.
- La base de datos es independiente (`r14.db`).
- Si necesita reiniciar el servidor, use `node dist/index.js` en la carpeta `server`.
