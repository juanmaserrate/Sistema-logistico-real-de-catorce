import React, { Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { SessionUser } from './src/types';
import { loadSession, clearSession } from './src/sessionStorage';
import LoginScreen from './src/screens/LoginScreen';
import TrackScreen from './src/screens/TrackScreen';
import {
  NavProviderGate,
  isGoogleNavigationNativeAvailable,
} from './src/navigation/NavProviderGate';
import type { RootStackParamList } from './src/navigation/types';

const EmbeddedNavigationScreenLazy = React.lazy(
  () => import('./src/screens/EmbeddedNavigationScreen')
);

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [boot, setBoot] = useState(true);
  const [session, setSession] = useState<SessionUser | null>(null);

  useEffect(() => {
    loadSession().then((s) => {
      setSession(s);
      setBoot(false);
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

  return (
    <NavProviderGate>
      <SafeAreaProvider>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName={session ? 'Track' : 'Login'}
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Login">
              {({ navigation }) => (
                <LoginScreen
                  onLoggedIn={(user) => {
                    setSession(user);
                    navigation.reset({ index: 0, routes: [{ name: 'Track' }] });
                  }}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Track">
              {({ navigation }) =>
                session ? (
                  <TrackScreen
                    session={session}
                    navigation={navigation}
                    onLogout={async () => {
                      await clearSession();
                      setSession(null);
                      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
                    }}
                  />
                ) : null
              }
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
          </Stack.Navigator>
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
