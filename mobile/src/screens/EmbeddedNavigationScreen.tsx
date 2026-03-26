import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TextInput,
  Alert,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import {
  NavigationView,
  useNavigation as useGoogleNavigation,
  TravelMode,
  RouteStatus,
  NavigationSessionStatus,
} from '@googlemaps/react-native-navigation-sdk';
import type { RootStackParamList } from '../navigation/types';
import { assertApiConfigured } from '../config';
import { patchStop, uploadProofPhoto } from '../api';

type Props = NativeStackScreenProps<RootStackParamList, 'EmbeddedNav'>;

type Phase = 'boot' | 'navigating' | 'at_stop' | 'saving' | 'error';

export default function EmbeddedNavigationScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { stopId, destLat, destLng, title } = route.params;
  const { navigationController, removeAllListeners, setOnArrival } = useGoogleNavigation();

  const [phase, setPhase] = useState<Phase>('boot');
  const [error, setError] = useState('');
  const [observations, setObservations] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [deliveryOk, setDeliveryOk] = useState(false);
  const arrivalSentRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const teardownNav = useCallback(async () => {
    removeAllListeners();
    try {
      await navigationController.stopGuidance();
    } catch {
      /* */
    }
    try {
      await navigationController.cleanup();
    } catch {
      /* */
    }
  }, [navigationController, removeAllListeners]);

  /** Inicializar sesión, ruta y guía (una vez por destino). */
  useEffect(() => {
    let cancelled = false;

    const cleanupSession = async () => {
      removeAllListeners();
      try {
        await navigationController.stopGuidance();
      } catch {
        /* */
      }
      try {
        await navigationController.cleanup();
      } catch {
        /* */
      }
    };

    const run = async () => {
      setError('');
      setPhase('boot');

      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        setError('Se requiere ubicación para la navegación embebida.');
        setPhase('error');
        return;
      }

      try {
        await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      } catch {
        /* el SDK también espera fix */
      }

      const accepted = await navigationController.showTermsAndConditionsDialog();
      if (cancelled || !accepted) {
        if (!accepted) navigation.goBack();
        return;
      }

      const initStatus = await navigationController.init();
      if (cancelled) return;

      if (initStatus !== NavigationSessionStatus.OK) {
        const msg =
          initStatus === NavigationSessionStatus.NOT_AUTHORIZED
            ? 'API key no autorizada para Navigation SDK. Revisá Google Cloud Console.'
            : initStatus === NavigationSessionStatus.LOCATION_PERMISSION_MISSING
              ? 'Falta permiso de ubicación.'
              : `No se pudo iniciar navegación (${initStatus}).`;
        setError(msg);
        setPhase('error');
        return;
      }

      await new Promise((r) => setTimeout(r, 400));

      const routeStatus = await navigationController.setDestinations(
        [
          {
            title: title || 'Destino',
            position: { lat: destLat, lng: destLng },
          },
        ],
        {
          routingOptions: {
            travelMode: TravelMode.DRIVING,
            avoidTolls: false,
            avoidFerries: false,
          },
          displayOptions: {
            showDestinationMarkers: true,
          },
        }
      );

      if (cancelled) return;

      if (routeStatus !== RouteStatus.OK) {
        setError(
          routeStatus === RouteStatus.LOCATION_DISABLED
            ? 'Esperando señal GPS. Probá de nuevo en unos segundos o movete al exterior.'
            : `No se pudo calcular la ruta (${routeStatus}).`
        );
        setPhase('error');
        await cleanupSession();
        return;
      }

      await navigationController.startGuidance();
      if (!cancelled && mounted.current) setPhase('navigating');
    };

    run().catch((e) => {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : 'Error al iniciar navegación');
      setPhase('error');
    });

    return () => {
      cancelled = true;
      void cleanupSession();
    };
  }, [destLat, destLng, title, navigation, navigationController, removeAllListeners]);

  /** Llegada detectada por el SDK: detener guía y pasar a registro. */
  useEffect(() => {
    setOnArrival(() => {
      void (async () => {
        try {
          await navigationController.stopGuidance();
        } catch {
          /* */
        }
        if (!mounted.current) return;
        setPhase('at_stop');
        if (arrivalSentRef.current) return;
        arrivalSentRef.current = true;
        try {
          await patchStop(stopId, {
            status: 'ARRIVED',
            actualArrival: new Date().toISOString(),
          });
        } catch {
          arrivalSentRef.current = false;
        }
      })();
    });
    return () => setOnArrival(null);
  }, [navigationController, setOnArrival, stopId]);

  const onArrivedManual = useCallback(async () => {
    try {
      await navigationController.stopGuidance();
    } catch {
      /* */
    }
    setPhase('at_stop');
    if (arrivalSentRef.current) return;
    arrivalSentRef.current = true;
    try {
      await patchStop(stopId, {
        status: 'ARRIVED',
        actualArrival: new Date().toISOString(),
      });
    } catch (e) {
      arrivalSentRef.current = false;
      Alert.alert('Servidor', e instanceof Error ? e.message : 'No se pudo registrar la llegada');
    }
  }, [navigationController, stopId]);

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Cámara', 'Sin permiso no se puede adjuntar foto.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!r.canceled && r.assets[0]?.uri) setPhotoUri(r.assets[0].uri);
  }, []);

  const confirmDelivery = useCallback(async () => {
    setPhase('saving');
    try {
      assertApiConfigured();
      let proofUrl: string | null = null;
      if (photoUri) {
        proofUrl = await uploadProofPhoto(photoUri);
      }
      await patchStop(stopId, {
        status: 'COMPLETED',
        actualDeparture: new Date().toISOString(),
        observations: observations.trim() || undefined,
        proofPhotoUrl: proofUrl ?? undefined,
        deliveryWithoutIssues: deliveryOk ? true : null,
      });
      await teardownNav();
      navigation.goBack();
    } catch (e) {
      setPhase('at_stop');
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar la entrega');
    }
  }, [deliveryOk, navigation, observations, photoUri, stopId, teardownNav]);

  if (phase === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Navegación</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.primaryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.primaryBtnTxt}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.mapWrap}>
        {phase === 'boot' ? (
          <View style={styles.bootOverlay}>
            <ActivityIndicator size="large" color="#4f46e5" />
            <Text style={styles.bootTxt}>Preparando navegación…</Text>
          </View>
        ) : null}
        <NavigationView
          onMapReady={() => {}}
          androidStylingOptions={{
            primaryDayModeThemeColor: '#4f46e5',
            headerDistanceValueTextColor: '#1e293b',
          }}
          iOSStylingOptions={{
            navigationHeaderPrimaryBackgroundColor: '#4f46e5',
            navigationHeaderDistanceValueTextColor: '#1e293b',
          }}
        />
      </View>

      <View style={[styles.topBar, { top: Math.max(insets.top, 12) + 8 }]}>
        <Pressable
          style={styles.backBtn}
          onPress={() => {
            Alert.alert('Salir', '¿Detener la navegación?', [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Salir',
                style: 'destructive',
                onPress: () => {
                  void teardownNav().finally(() => navigation.goBack());
                },
              },
            ]);
          }}
        >
          <Text style={styles.backBtnTxt}>‹ Volver</Text>
        </Pressable>
      </View>

      {phase === 'navigating' ? (
        <View style={styles.actionBar}>
          <Pressable style={styles.arrivedBtn} onPress={() => void onArrivedManual()}>
            <Text style={styles.arrivedBtnTxt}>Llegué al lugar</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'at_stop' || phase === 'saving' ? (
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>Entrega</Text>
            <Text style={styles.sheetSub}>Observaciones y comprobante (opcional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Observaciones…"
              placeholderTextColor="#94a3b8"
              multiline
              value={observations}
              onChangeText={setObservations}
            />
            <Pressable
              style={styles.checkRow}
              onPress={() => setDeliveryOk((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: deliveryOk }}
            >
              <View style={[styles.checkBox, deliveryOk && styles.checkBoxOn]}>
                {deliveryOk ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
              <Text style={styles.checkLabel}>Entrega sin problemas (opcional)</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={() => void pickPhoto()}>
              <Text style={styles.secondaryBtnTxt}>
                {photoUri ? 'Cambiar foto' : 'Tomar foto de comprobante'}
              </Text>
            </Pressable>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
            ) : null}
            <Pressable
              style={[styles.primaryBtn, phase === 'saving' && styles.btnDisabled]}
              disabled={phase === 'saving'}
              onPress={() => void confirmDelivery()}
            >
              {phase === 'saving' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnTxt}>Confirmar entrega y salir</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      ) : null}

      <Text style={styles.attribution}>
        Google Maps · Navigation SDK · {Platform.OS === 'android' ? 'Android' : 'iOS'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  mapWrap: { flex: 1, position: 'relative' },
  bootOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  bootTxt: { marginTop: 12, color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  topBar: {
    position: 'absolute',
    left: 12,
    zIndex: 10,
  },
  backBtn: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  backBtnTxt: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  actionBar: {
    position: 'absolute',
    bottom: 28,
    left: 16,
    right: 16,
    zIndex: 8,
  },
  arrivedBtn: {
    backgroundColor: '#059669',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  arrivedBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '900' },
  sheet: {
    maxHeight: '46%',
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  sheetSub: { fontSize: 12, color: '#64748b', marginTop: 4, marginBottom: 12 },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
    color: '#0f172a',
    marginBottom: 10,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { borderColor: '#059669', backgroundColor: '#ecfdf5' },
  checkMark: { color: '#059669', fontWeight: '900', fontSize: 12 },
  checkLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: '#334155' },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryBtnTxt: { color: '#4f46e5', fontWeight: '800', fontSize: 14 },
  primaryBtn: {
    backgroundColor: '#4f46e5',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },
  btnDisabled: { opacity: 0.7 },
  preview: {
    width: '100%',
    height: 140,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#e2e8f0',
  },
  attribution: {
    position: 'absolute',
    bottom: 4,
    right: 8,
    left: 8,
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0f172a',
  },
  errorTitle: { fontSize: 18, fontWeight: '900', color: '#fff', marginBottom: 8 },
  errorText: { color: '#fca5a5', textAlign: 'center', marginBottom: 20 },
});
