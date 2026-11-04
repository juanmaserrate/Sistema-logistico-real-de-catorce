# Cableado de la auditoría de viajes en `index.ts`

El módulo `server/src/auditoriaDeViajes.ts` ya corre solo (ver `scripts/probar_auditoria.ts`).
Para que se pueda llamar desde afuera faltan **dos pegados** en `server/src/index.ts`. Ninguno
toca lógica existente.

## 1. Import

Junto a los otros imports de módulos propios (líneas 24-26, al lado de `./libroViajes`,
`./metricasDashboard`, `./sharepoint`):

```ts
import { auditarMes, filtrarInforme } from './auditoriaDeViajes';
```

## 2. Endpoint

En el bloque de endpoints `/api/admin` de solo lectura. Lugar sugerido: **justo después del
handler de `GET /api/admin/clients-dump`** (empieza en la línea ~6945 con el comentario
`/** Lista los clientes con su direccion (solo lectura, ...` y termina ~6958 con `});`), y
**antes** del comentario `/** Corrige direcciones de clientes en lote, con copia de respaldo previa.`.

Texto completo a pegar:

```ts
/** Auditoria de los viajes de un mes: los 19 controles que en octubre 2026 se
 *  corrieron con un script de afuera, adentro del sistema. Solo lee.
 *
 *  GET /api/admin/auditoria-mes?key=...&mes=2026-10
 *      &solo=Tarifa,Duplicados   (opcional: deja solo esos controles; vale el
 *                                 principio del nombre, "parada" trae los 4 de paradas)
 *
 *  Devuelve { mes, anio, viajes, paradas,
 *             resumen: [{ control, hallazgos, viajes, queSignifica }],   // de mayor a menor
 *             hallazgos: [{ control, viaje, fecha, reparto, chofer, contrato, valor, horas, detalle, dato }] } */
app.get('/api/admin/auditoria-mes', async (req: any, res: any) => {
    if (req.query.key !== 'r14-basestop-2026') return res.status(403).json({ error: 'Forbidden' });
    try {
        const m = /^(\d{4})-(\d{1,2})$/.exec(String(req.query.mes || '').trim());
        if (!m) return res.status(400).json({ error: 'Falta mes=AAAA-MM (ej. 2026-10)' });
        const anio = Number(m[1]), mes = Number(m[2]);
        if (mes < 1 || mes > 12) return res.status(400).json({ error: 'Mes invalido: ' + req.query.mes });

        const informe = await auditarMes(prisma, anio, mes);
        const solo = String(req.query.solo || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        res.json(solo.length ? filtrarInforme(informe, solo) : informe);
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error' });
    }
});
```

## Cómo probarlo una vez pegado

```
curl "http://localhost:3000/api/admin/auditoria-mes?key=r14-basestop-2026&mes=2026-10"
curl "http://localhost:3000/api/admin/auditoria-mes?key=r14-basestop-2026&mes=2026-10&solo=Tarifa,Duplicados"
```

(Con otra clave o sin `mes` devuelve 403 / 400.) Sobre octubre 2026 tiene que dar un total del
orden de los 1.390 hallazgos en ~455 viajes que dio el script externo; las diferencias que
aparezcan son de los controles nuevos (16 nombres parecidos, 1 duplicados, regla del día en
Tarifa) y de que acá los viajes se enumeran por `trip.date` y no por quién pasa por el depósito.

## Qué hace el módulo (para quien lo lea después)

- `auditarMes(prisma, anio, mes)` lee los viajes del mes **por rango de `trip.date` en UTC**
  (1 a las 00:00 → último día 23:59:59), con `linkedRoute.stops` ordenadas por `sequence` y
  con `client.name`, y los `tramos`. Deja afuera la cuenta de prueba (`sinViajesDePrueba`).
  Lee la tabla de tarifas de `appSettings` (`tarifas_proveedor`) una sola vez.
- `auditarViajes(viajes, tabla, anio, mes)` es la parte pura (sin base): corre los 19 controles
  y arma el informe. Es lo que prueba el test con el prisma falso.
- `filtrarInforme(informe, ['Tarifa', 'Duplicados'])` deja solo esos controles.
- Un hallazgo por fila. El resumen lista los 19 controles siempre (los que dan 0 van al final),
  cada uno con su `queSignifica` en castellano llano.

Decisiones que conviene saber:

- **Duplicados**: mismo día + reparto + chofer + vuelta y ≥ 60 % de paradas reales en común.
  LIBRE y CDI no entran. Dos viajes sin paradas con esa misma clave también cuentan (se avisa
  "los dos sin paradas"). Se anota en los dos viajes del par.
- **Tarifa "tercerizado en $0"** salta solo si ese viaje es el que tiene que cobrar ese día (el
  primero del chofer por hora de arranque, o uno que diga "paga aparte"): el segundo del día va
  en $0 a propósito y no es hallazgo.
- **Propio con tarifa de tercerizado**: el valor del propio coincide con alguna tarifa de la
  tabla del mes o con el valor de algún tercerizado del mes.
- **Chofer en dos viajes a la vez** se anota en el viaje que arranca después, con las horas
  pisadas en `dato`. **Jornada > 12 h** se anota en el primer viaje del día del chofer.
- **Nombres parecidos**: distancia de edición ≤ 2 sobre el nombre sin puntos ni acentos
  ("ALAM.AMO" / "ALAN AMO"). Un hallazgo por par, colgado del primer viaje del primer nombre.
- Las comparaciones de horas usan 1 segundo de tolerancia para no marcar ruido de milisegundos.
