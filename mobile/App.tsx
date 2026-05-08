import React, { Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import { registerPushToken } from './src/api';

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
    loadSession().then(async (s) => {
      setSession(s);
      setBoot(false);
      if (s) await tryRegisterPushToken(s.id);
    });
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
