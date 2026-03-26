import React, { type ReactNode } from 'react';
import { NativeModules } from 'react-native';

/**
 * El SDK de Google Navigation registra TurboModule `NavModule`. Si no existe (Expo Go / build sin prebuild),
 * no debemos importar el paquete: getEnforcing fallaría al montar NavigationProvider.
 */
export function isGoogleNavigationNativeAvailable(): boolean {
  return NativeModules.NavModule != null;
}

type Props = { children: ReactNode };

/**
 * Envuelve la app con NavigationProvider solo en builds que incluyen el SDK nativo.
 */
export function NavProviderGate({ children }: Props): React.JSX.Element {
  if (!isGoogleNavigationNativeAvailable()) {
    return <>{children}</>;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    NavigationProvider,
    TaskRemovedBehavior,
  } = require('@googlemaps/react-native-navigation-sdk') as typeof import('@googlemaps/react-native-navigation-sdk');

  return (
    <NavigationProvider
      termsAndConditionsDialogOptions={{
        title: 'Navegación asistida',
        companyName: 'R14 / Real de Catorce',
        showOnlyDisclaimer: false,
        uiParams: {
          backgroundColor: '#ffffff',
          titleColor: '#0f172a',
        },
      }}
      taskRemovedBehavior={TaskRemovedBehavior.QUIT_SERVICE}
    >
      {children}
    </NavigationProvider>
  );
}
