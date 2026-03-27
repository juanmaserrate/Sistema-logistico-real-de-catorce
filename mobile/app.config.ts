import type { ExpoConfig } from 'expo/config';

const mapsKeyAndroid = process.env.GOOGLE_MAPS_ANDROID_KEY || '';
const mapsKeyIos = process.env.GOOGLE_MAPS_IOS_KEY || mapsKeyAndroid;

const config: ExpoConfig = {
  name: 'R14 Seguimiento',
  slug: 'r14-seguimiento',
  version: '1.0.0',
  runtimeVersion: {
    policy: 'appVersion',
  },
  updates: {
    url: 'https://u.expo.dev/383c6e56-502c-42f8-a683-067c79908cec',
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  newArchEnabled: false,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0f172a',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.r14.seguimiento',
    config: {
      googleMapsApiKey: mapsKeyIos || 'YOUR_IOS_MAPS_KEY',
    },
    infoPlist: {
      LSApplicationQueriesSchemes: ['comgooglemaps', 'googlemaps'],
      UIBackgroundModes: ['location'],
      NSLocationWhenInUseUsageDescription:
        'Mostramos tu recorrido y enviamos posición a la torre de control durante el reparto.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'El seguimiento en segundo plano permite ver el recorrido en vivo en planificación.',
    },
  },
  android: {
    package: 'com.r14.seguimiento',
    adaptiveIcon: {
      backgroundColor: '#0f172a',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
    ],
    config: {
      googleMaps: {
        apiKey: mapsKeyAndroid || 'YOUR_ANDROID_MAPS_KEY',
      },
    },
  },
  plugins: [
    [
      'expo-build-properties',
      {
        android: { minSdkVersion: 24 },
        ios: { deploymentTarget: '16.0' },
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'R14 puede usar fotos del carrete como comprobante de entrega.',
        cameraPermission: 'R14 usa la cámara para comprobante de entrega en el lugar.',
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'R14 necesita tu ubicación para el mapa y el envío al sistema de planificación.',
        locationWhenInUsePermission:
          'R14 usa tu posición para mostrar el recorrido y reportar a torre de control.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],
  extra: {
    eas: {
      projectId: '383c6e56-502c-42f8-a683-067c79908cec',
    },
  },
};

export default config;
