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
import type { RootStackParamList } from '../navigation/types';
import { assertApiConfigured } from '../config';
import { patchStop, uploadProofPhoto, fetchNavigationToNext, type NavigationToNext } from '../api';

// Import react-native-maps only on native platforms
const MapView = Platform.OS === 'web' ? null : require('react-native-maps').default;
const { Marker, Polyline, PROVIDER_GOOGLE } = Platform.OS === 'web' ? {} : require('react-native-maps');

import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';

type Props = NativeStackScreenProps<RootStackParamList, 'EmbeddedNav'>;

type Phase = 'loading' | 'navigating' | 'at_stop' | 'saving' | 'error';

/** Decodifica polyline de Google Directions API */
function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

export default function EmbeddedNavigationScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { routeId, stopId, destLat, destLng, title } = route.params;
  const mapRef = useRef<InstanceType<typeof MapView>>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [nav, setNav] = useState<NavigationToNext | null>(null);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [userLoc, setUserLoc] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);

  // Delivery state
  const [observations, setObservations] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [deliveryOk, setDeliveryOk] = useState(false);
  const arrivalSentRef = useRef(false);

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Carga instrucciones de ruta desde el servidor */
  const loadRoute = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Se necesita permiso de ubicación.');
        setPhase('error');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setUserLoc(loc);

      const data = await fetchNavigationToNext(routeId, loc.latitude, loc.longitude);
      setNav(data);

      if (data.overviewPolyline) {
        const coords = decodePolyline(data.overviewPolyline);
        setRouteCoords(coords);
      } else {
        // Fallback: línea recta
        setRouteCoords([loc, { latitude: destLat, longitude: destLng }]);
      }

      setPhase('navigating');

      // Ajustar mapa para mostrar la ruta
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(
          [loc, { latitude: destLat, longitude: destLng }],
          { edgePadding: { top: 120, right: 60, bottom: 300, left: 60 }, animated: true }
        );
      }, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando ruta');
      setPhase('error');
    }
  }, [routeId, destLat, destLng]);

  /** Carga inicial + actualización periódica cada 30s */
  useEffect(() => {
    void loadRoute();
    refreshIntervalRef.current = setInterval(() => {
      void loadRoute();
    }, 30000);
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [loadRoute]);

  /** Marcar llegada */
  const onArrived = useCallback(async () => {
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
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
  }, [stopId]);

  /** Tomar foto */
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

  /** Confirmar entrega */
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
      navigation.goBack();
    } catch (e) {
      setPhase('at_stop');
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar la entrega');
    }
  }, [deliveryOk, navigation, observations, photoUri, stopId]);

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

  const currentStep = nav?.steps?.[currentStepIdx];
  const totalSteps = nav?.steps?.length ?? 0;

  return (
    <View style={styles.screen}>
      {/* Mapa */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{
          latitude: destLat,
          longitude: destLng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation
        showsMyLocationButton
        followsUserLocation={phase === 'navigating'}
      >
        {routeCoords.length >= 2 && (
          <Polyline coordinates={routeCoords} strokeColor="#4f46e5" strokeWidth={5} />
        )}
        <Marker
          coordinate={{ latitude: destLat, longitude: destLng }}
          title={title || 'Destino'}
          pinColor="#e11d48"
        />
      </MapView>

      {/* Barra superior */}
      <View style={[styles.topBar, { top: Math.max(insets.top, 12) + 8 }]}>
        <Pressable
          style={styles.backBtn}
          onPress={() => {
            if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
            navigation.goBack();
          }}
        >
          <Text style={styles.backBtnTxt}>{'<'} Volver</Text>
        </Pressable>
        <View style={styles.destBadge}>
          <Text style={styles.destBadgeTxt} numberOfLines={1}>{title}</Text>
        </View>
      </View>

      {/* Loading */}
      {phase === 'loading' && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4f46e5" />
          <Text style={styles.loadingTxt}>Calculando ruta...</Text>
        </View>
      )}

      {/* Panel de instrucciones durante navegación */}
      {phase === 'navigating' && nav && (
        <View style={[styles.navPanel, { paddingBottom: Math.max(16, insets.bottom) }]}>
          {nav.summary ? (
            <Text style={styles.navSummary}>{nav.summary}</Text>
          ) : null}

          {currentStep ? (
            <View style={styles.stepCard}>
              <Text style={styles.stepNum}>Paso {currentStepIdx + 1} de {totalSteps}</Text>
              <Text style={styles.stepInstr}>{currentStep.instruction}</Text>
              <Text style={styles.stepMeta}>
                {[currentStep.distanceText, currentStep.durationText].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : null}

          <View style={styles.stepNavRow}>
            <Pressable
              style={[styles.stepNavBtn, currentStepIdx <= 0 && styles.stepNavBtnDisabled]}
              disabled={currentStepIdx <= 0}
              onPress={() => setCurrentStepIdx((i) => Math.max(0, i - 1))}
            >
              <Text style={styles.stepNavBtnTxt}>{'<'} Anterior</Text>
            </Pressable>
            <Pressable
              style={[styles.stepNavBtn, currentStepIdx >= totalSteps - 1 && styles.stepNavBtnDisabled]}
              disabled={currentStepIdx >= totalSteps - 1}
              onPress={() => setCurrentStepIdx((i) => Math.min(totalSteps - 1, i + 1))}
            >
              <Text style={styles.stepNavBtnTxt}>Siguiente {'>'}</Text>
            </Pressable>
          </View>

          <Pressable style={styles.arrivedBtn} onPress={() => void onArrived()}>
            <Text style={styles.arrivedBtnTxt}>Llegué al lugar</Text>
          </Pressable>
        </View>
      )}

      {/* Panel de registro de entrega */}
      {(phase === 'at_stop' || phase === 'saving') && (
        <View style={[styles.deliveryPanel, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>Entrega — {title}</Text>
            <TextInput
              style={styles.input}
              placeholder="Observaciones..."
              placeholderTextColor="#94a3b8"
              multiline
              value={observations}
              onChangeText={setObservations}
            />
            <Pressable
              style={styles.checkRow}
              onPress={() => setDeliveryOk((v) => !v)}
            >
              <View style={[styles.checkBox, deliveryOk && styles.checkBoxOn]}>
                {deliveryOk ? <Text style={styles.checkMark}>{'✓'}</Text> : null}
              </View>
              <Text style={styles.checkLabel}>Entrega sin problemas</Text>
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0f172a',
  },
  errorTitle: { fontSize: 18, fontWeight: '900', color: '#fff', marginBottom: 8 },
  errorText: { color: '#fca5a5', textAlign: 'center', marginBottom: 20 },

  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    elevation: 4,
  },
  backBtnTxt: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  destBadge: {
    flex: 1,
    backgroundColor: 'rgba(79,70,229,0.92)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    elevation: 4,
  },
  destBadgeTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  loadingTxt: { color: '#e2e8f0', marginTop: 12, fontSize: 14, fontWeight: '600' },

  navPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    elevation: 8,
  },
  navSummary: {
    fontSize: 14,
    fontWeight: '900',
    color: '#4f46e5',
    textAlign: 'center',
    marginBottom: 10,
  },
  stepCard: {
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  stepNum: { fontSize: 10, fontWeight: '800', color: '#94a3b8', marginBottom: 4 },
  stepInstr: { fontSize: 15, fontWeight: '700', color: '#0f172a', lineHeight: 22 },
  stepMeta: { fontSize: 12, color: '#64748b', marginTop: 6 },
  stepNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  stepNavBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  stepNavBtnDisabled: { opacity: 0.4 },
  stepNavBtnTxt: { fontSize: 13, fontWeight: '700', color: '#334155' },
  arrivedBtn: {
    backgroundColor: '#059669',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  arrivedBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '900' },

  deliveryPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '55%',
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    elevation: 8,
  },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a', marginBottom: 12 },
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
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
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
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginBottom: 10 },
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
});
