import React, { Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, StyleSheet, View } from 'react-native';
import * as Updates from 'expo-updates';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionUser } from './src/types';
import { loadSession, clearSession } from './src/sessionStorage';
import LoginScreen from './src/screens/LoginScreen';
import TrackScreen from './src/screens/TrackScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import {
  NavProviderGate,
  isGoogleNavigationNativeAvailable,
} from './src/navigation/NavProviderGate';
import type { RootStackParamList } from './src/navigation/types';
import { registerPushToken, setAuthExpiredHandler } from './src/api';

/** Migración one-time: cuando un chofer recibe este OTA update, limpiamos el
 *  cache de rutas que pueda tener stale (ej. con viajes finalizados que se
 *  quedaron atascados antes del fix de cache). Solo corre una vez por instalación
 *  gracias al flag MIGRATION_KEY en AsyncStorage. */
const MIGRATION_KEY = 'r14_cache_migration_v2';
async function runOneTimeMigration() {
  try {
    const done = await AsyncStorage.getItem(MIGRATION_KEY);
    if (done === '1') return;
    // Limpiar cache de rutas (se regenera desde el server al primer fetch)
    await AsyncStorage.removeItem('r14_routes_today_cache');
    await AsyncStorage.setItem(MIGRATION_KEY, '1');
    console.log('[migration] cache stale de rutas limpiado');
  } catch { /* */ }
}

const EmbeddedNavigationScreenLazy = React.lazy(
  () => import('./src/screens/EmbeddedNavigationScreen')
);

const Stack = createNativeStackNavigator<RootStackParamList>();

/** M5 fix: registra el push token. Se llama en boot (si hay sesión guardada) y
 *  también después de un login exitoso (antes solo se llamaba en boot). */
async function tryRegisterPushToken(userId: string) {
  try {
    const Notifications = await import('expo-notifications').catch(() => null);
    if (!Notifications) return;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const token = await Notifications.getExpoPushTokenAsync().catch(() => null);
    if (token?.data) registerPushToken(userId, token.data).catch(() => {});
  } catch { /* push no disponible */ }
}

export default function App() {
  const [boot, setBoot] = useState(true);
  const [session, setSession] = useState<SessionUser | null>(null);

  useEffect(() => {
    (async () => {
      // Limpiar cache stale de rutas en chofers que vienen de versiones anteriores
      await runOneTimeMigration();
      const s = await loadSession();
      setSession(s);
      setBoot(false);
      if (s) await tryRegisterPushToken(s.id);
    })();
  }, []);

  /** Adopción de updates OTA. Antes un fix publicado tardaba DOS reinicios de
   *  la app en llegar al celular (expo-updates baja el update en un arranque y
   *  lo aplica recién en el SIGUIENTE). Los choferes no cierran la app por
   *  días y quedaban semanas corriendo versiones viejas con bugs ya
   *  arreglados. Ahora:
   *  - Al abrir en frío: chequea, baja y APLICA el update al instante (reload,
   *    tarda segundos). Un solo arranque alcanza.
   *  - Al volver a primer plano (máx. cada 10 min): chequea y baja; como el
   *    chofer puede estar en medio de una entrega, no lo interrumpimos — le
   *    ofrecemos "Actualizar ahora" o queda listo para el próximo arranque.
   *  Nada se pierde con el reload: sesión y colas offline viven en AsyncStorage. */
  useEffect(() => {
    let coldStart = true;
    let lastCheck = 0;
    const checkAndApply = async () => {
      try {
        if (__DEV__ || !Updates.isEnabled) return;
        if (Date.now() - lastCheck < 10 * 60 * 1000) return;
        lastCheck = Date.now();
        const wasColdStart = coldStart;
        coldStart = false;
        const chk = await Updates.checkForUpdateAsync();
        if (!chk.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (wasColdStart) {
          await Updates.reloadAsync();
        } else {
          Alert.alert(
            'Actualización lista',
            'Hay una versión nueva de la app. Tarda 2 segundos y no se pierde nada.',
            [
              { text: 'Después', style: 'cancel' },
              { text: 'Actualizar ahora', onPress: () => { Updates.reloadAsync().catch(() => {}); } },
            ]
          );
        }
      } catch {
        // Sin red o updates no disponibles: la app sigue normal.
      }
    };
    void checkAndApply();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void checkAndApply();
    });
    return () => sub.remove();
  }, []);

  // Sesión vencida (token 401): cerrar sesión y avisar al chofer con un mensaje
  // claro. Antes la app quedaba "logueada" pero sin poder hacer nada. La cola
  // offline NO se borra: las entregas pendientes se sincronizan al re-loguearse.
  useEffect(() => {
    setAuthExpiredHandler(() => {
      setSession((prev) => {
        if (!prev) return prev; // ya estaba en login, no molestar
        clearSession();
        Alert.alert(
          'Sesión vencida',
          'Tu sesión expiró por seguridad. Iniciá sesión de nuevo. Las entregas que tengas pendientes se enviarán solas al reconectar.'
        );
        return null;
      });
    });
    return () => setAuthExpiredHandler(null);
  }, []);

  if (boot) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  const navEmbedded = isGoogleNavigationNativeAvailable();

  /** M2 fix: en lugar de un solo Stack con `initialRouteName` (que solo se evalúa
   *  una vez y queda atado al primer render), renderizamos UN Stack u OTRO según
   *  haya sesión. Cuando `setSession(null)` ocurre tras logout, React desmonta
   *  el Stack autenticado y monta el de Login automáticamente — sin race con el
   *  initialRouteName. Mismo razonamiento al revés: tras login exitoso. */
  return (
    <NavProviderGate>
      <SafeAreaProvider>
        <NavigationContainer>
          {session ? (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Track">
                {({ navigation }) => (
                  <TrackScreen
                    session={session}
                    navigation={navigation}
                    onLogout={async () => {
                      await clearSession();
                      setSession(null);
                    }}
                  />
                )}
              </Stack.Screen>
              {navEmbedded ? (
                <Stack.Screen name="EmbeddedNav" options={{ headerShown: false, animation: 'slide_from_bottom' }}>
                  {(props) => (
                    <Suspense
                      fallback={
                        <View style={styles.splash}>
                          <ActivityIndicator size="large" color="#4f46e5" />
                        </View>
                      }
                    >
                      <EmbeddedNavigationScreenLazy {...props} />
                    </Suspense>
                  )}
                </Stack.Screen>
              ) : null}
              <Stack.Screen name="History" options={{ headerShown: false, animation: 'slide_from_right' }}>
                {({ navigation }) => (
                  <HistoryScreen session={session} navigation={navigation} />
                )}
              </Stack.Screen>
              <Stack.Screen name="Profile" options={{ headerShown: false, animation: 'slide_from_right' }}>
                {({ navigation }) => (
                  <ProfileScreen
                    session={session}
                    navigation={navigation}
                    onLogout={async () => {
                      await clearSession();
                      setSession(null);
                    }}
                  />
                )}
              </Stack.Screen>
            </Stack.Navigator>
          ) : (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Login">
                {() => (
                  <LoginScreen
                    onLoggedIn={(user) => {
                      setSession(user);
                      // M5 fix: registrar push token recién después del login exitoso
                      // (antes solo corría en boot, así que el primer login no recibía push)
                      void tryRegisterPushToken(user.id);
                    }}
                  />
                )}
              </Stack.Screen>
            </Stack.Navigator>
          )}
        </NavigationContainer>
      </SafeAreaProvider>
    </NavProviderGate>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
});
