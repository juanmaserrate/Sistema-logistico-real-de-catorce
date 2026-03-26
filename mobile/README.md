# R14 Seguimiento (app móvil)

**Deploy online (Railway + EAS en orden):** [docs/DEPLOY-ONLINE.md](../docs/DEPLOY-ONLINE.md).

## Expo Go vs build propia

**Expo Go** sirve para prototipos con APIs que ya trae el cliente genérico. Esta app usa **código nativo** (Navigation SDK de Google, tareas de ubicación en segundo plano, etc.), así que **no corre completa en Expo Go**.

Flujo correcto:

1. **Development build** (desarrollo con hot reload): APK con menú de desarrollo de Expo.
2. **Preview / production** (EAS): APK o AAB para choferes, sin Metro.

## Requisitos

- Node 20+
- Cuenta [expo.dev](https://expo.dev) y `npm i -g eas-cli`
- En la raíz de `mobile`: `eas login` y una vez `eas init` (vincula el proyecto si aún no existe `extra.eas` en `app.config`).

## Variables

Copiá `env.example` → `.env`:

- `EXPO_PUBLIC_API_URL` — URL **HTTPS** del servidor (ej. Railway).
- `GOOGLE_MAPS_ANDROID_KEY` / `GOOGLE_MAPS_IOS_KEY` — para mapas y navegación.

Para **EAS Build**, definí las mismas variables en el dashboard del proyecto (Secrets) o con `eas secret:create`.

## Comandos

| Comando | Uso |
|--------|-----|
| `npm run build:dev` | Genera APK **development client** (instalás una vez en el teléfono). |
| `npm start` | Metro para **dev client** (`expo start --dev-client`). Abrís la app compilada, no Expo Go. |
| `npm run start:go` | Solo si querés probar algo sin nativos (limitado). |
| `npm run prebuild` + `npm run android` | Compilación local Android (Android Studio / SDK). |
| `npm run build:apk` | APK interno (preview, sin menú dev). |
| `npm run build:play` | AAB para Play Store. |

## Primera vez (recomendado)

1. `eas build --profile development -p android`
2. Instalá el APK en el dispositivo.
3. `npm start` en la PC (misma red o túnel).
4. Abrís **R14 Seguimiento (dev)** en el teléfono y conectás al bundler.

## Producción (choferes)

`npm run build:apk` o `build:play`, con `EXPO_PUBLIC_API_URL` apuntando al servidor público.
