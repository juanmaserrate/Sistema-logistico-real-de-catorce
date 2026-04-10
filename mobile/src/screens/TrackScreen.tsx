import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
  AppState,
  type AppStateStatus,
  RefreshControl,
  TextInput,
  Animated,
  Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { StatusBar } from 'expo-status-bar';

// NavProviderGate ya no usa Navigation SDK
// Import react-native-maps only on native platforms
const MapView = Platform.OS === 'web' ? null : require('react-native-maps').default;
const { Marker, Polyline, PROVIDER_GOOGLE } = Platform.OS === 'web' ? {} : require('react-native-maps');
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SessionUser, Route, RouteGeometry, Stop } from '../types';
import {
  fetchRoutesToday,
  fetchRouteGeometry,
  fetchNavigationToNext,
  postTrackingLocation,
  patchStop,
  patchRouteRecorrido,
  deactivateDevice,
  flushStopQueue,
  flushIncidentQueue,
  getPendingStopCount,
  updateVehicleKm,
  type NavigationToNext,
} from '../api';
import StopDeliveryModal from '../components/StopDeliveryModal';
import IncidentModal from '../components/IncidentModal';
import ReorderModal from '../components/ReorderModal';
import {
  getOrCreateDeviceId,
  setActiveRouteId,
  clearSession,
} from '../sessionStorage';
import { BACKGROUND_LOCATION_TASK } from '../locationTask';
import { API_BASE } from '../config';

type Props = {
  session: SessionUser;
  onLogout: () => void;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Track'>;
};

const BA = { latitude: -34.65, longitude: -58.45, latitudeDelta: 0.35, longitudeDelta: 0.35 };

const { width: SCREEN_W } = Dimensions.get('window');

type ActiveTab = 'recorrido' | 'mapa';

export default function TrackScreen({ session, onLogout, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('recorrido');
  const slideAnim = useRef(new Animated.Value(0)).current;

  const switchTab = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    Animated.spring(slideAnim, {
      toValue: tab === 'recorrido' ? 0 : 1,
      useNativeDriver: true,
      tension: 68,
      friction: 12,
    }).start();
  }, [slideAnim]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [geom, setGeom] = useState<RouteGeometry | null>(null);
  const [loading, setLoading] = useState(true);
  const [geomLoading, setGeomLoading] = useState(false);
  const [err, setErr] = useState('');
  const [tracking, setTracking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nav, setNav] = useState<NavigationToNext | null>(null);
  const [navLoading, setNavLoading] = useState(false);
  const [navErr, setNavErr] = useState('');
  const [deliveryModalStop, setDeliveryModalStop] = useState<Stop | null>(null);
  const [trackingOk, setTrackingOk] = useState(true);
  const deviceIdRef = useRef<string>('');
  const socketRef = useRef<any>(null);
  // Incidencias
  const [incidentModalOpen, setIncidentModalOpen] = useState(false);
  // Modo offline
  const [isOnline, setIsOnline] = useState(true);
  const [pendingOffline, setPendingOffline] = useState(0);
  // Odómetro modal al iniciar recorrido
  const [kmModalOpen, setKmModalOpen] = useState(false);
  const [kmInput, setKmInput] = useState('');
  const pendingStartRef = useRef<{ routeId: number; plate: string | null } | null>(null);
  // Reordenamiento de paradas
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  // Toast de ruta actualizada
  const [routeChangedToast, setRouteChangedToast] = useState(false);
  // Búsqueda de paradas
  const [stopSearch, setStopSearch] = useState('');

  const selected = useMemo(
    () => (selId != null ? routes.find((r) => r.id === selId) ?? null : null),
    [routes, selId]
  );

  /** Primera parada PENDING con cliente (Maps, navegación embebida, registro). */
  const firstPendingStop = useMemo(() => {
    if (!selected?.stops?.length || selected?.actualEndTime) return null;
    const pending = [...selected.stops]
      .filter((s) => s.status === 'PENDING')
      .sort((a, b) => a.sequence - b.sequence);
    const st = pending[0];
    if (!st?.client) return null;
    return st;
  }, [selected]);

  const firstPendingClient = firstPendingStop?.client ?? null;

  const openFirstDeliveryInMaps = useCallback(async () => {
    const c = firstPendingClient;
    if (!c) return;

    const destLat = c.latitude;
    const destLng = c.longitude;
    const hasCoords = destLat != null && destLng != null;
    const destLabel = hasCoords
      ? `${destLat},${destLng}`
      : (c.address || c.name || '').trim();
    if (!destLabel) return;

    let origin: { lat: number; lng: number } | null = null;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
    } catch {
      /* seguimos sin origen */
    }

    const openGoogleMapsHttps = () => {
      const p = new URLSearchParams({
        api: '1',
        travelmode: 'driving',
      });
      if (origin) p.set('origin', `${origin.lat},${origin.lng}`);
      p.set('destination', destLabel);
      return Linking.openURL(`https://www.google.com/maps/dir/?${p.toString()}`);
    };

    /** Android: navegación turn-by-turn nativa si está Google Maps. */
    if (Platform.OS === 'android' && hasCoords) {
      const navUri = `google.navigation:q=${destLat},${destLng}`;
      try {
        await Linking.openURL(navUri);
        return;
      } catch {
        /* fallback */
      }
    }

    /** iOS: app Google Maps si está instalada (saddr opcional). */
    if (Platform.OS === 'ios' && hasCoords) {
      const gmaps =
        origin != null
          ? `comgooglemaps://?saddr=${origin.lat},${origin.lng}&daddr=${destLat},${destLng}&directionsmode=driving`
          : `comgooglemaps://?daddr=${destLat},${destLng}&directionsmode=driving`;
      try {
        const can = await Linking.canOpenURL('comgooglemaps://');
        if (can) {
          await Linking.openURL(gmaps);
          return;
        }
      } catch {
        /* fallback */
      }
    }

    try {
      await openGoogleMapsHttps();
    } catch (e) {
      Alert.alert('Maps', e instanceof Error ? e.message : 'No se pudo abrir el mapa.');
    }
  }, [firstPendingClient]);

  const hasPendingStops = useMemo(() => {
    if (!selected?.stops) return false;
    return selected.stops.some((s) => s.status === 'PENDING');
  }, [selected]);

  const routeStopsSorted = useMemo(() => {
    if (!selected?.stops?.length) return [];
    return [...selected.stops].sort((a, b) => a.sequence - b.sequence);
  }, [selected]);

  /** Paradas filtradas por búsqueda */
  const filteredStops = useMemo(() => {
    const q = stopSearch.trim().toLowerCase();
    if (!q) return routeStopsSorted;
    return routeStopsSorted.filter((s) => {
      const name = (s.client?.name ?? '').toLowerCase();
      const addr = (s.client?.address ?? '').toLowerCase();
      const barrio = (s.client?.barrio ?? '').toLowerCase();
      return name.includes(q) || addr.includes(q) || barrio.includes(q);
    });
  }, [routeStopsSorted, stopSearch]);

  /** Stats del recorrido de hoy */
  const todayStats = useMemo(() => {
    if (!selected) return null;
    const stops = selected.stops;
    const total = stops.length;
    const completed = stops.filter((s) => s.status === 'COMPLETED').length;
    const undeliverable = stops.filter((s) => s.status === 'UNDELIVERABLE').length;
    const pending = stops.filter((s) => s.status === 'PENDING' || s.status === 'ARRIVED').length;
    const times = stops
      .filter((s) => s.actualArrival && s.actualDeparture)
      .map((s) => (new Date(s.actualDeparture!).getTime() - new Date(s.actualArrival!).getTime()) / 60000);
    const avgMin = times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : null;
    return { total, completed, undeliverable, pending, avgMin };
  }, [selected]);

  const fmtStopTime = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  };

  const loadNavInstructions = useCallback(async () => {
    if (selId == null) return;
    setNavLoading(true);
    setNavErr('');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setNavErr('Activá la ubicación para ver los pasos hasta la próxima parada.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const data = await fetchNavigationToNext(selId, pos.coords.latitude, pos.coords.longitude);
      setNav(data);
    } catch (e) {
      setNav(null);
      setNavErr(e instanceof Error ? e.message : 'Error al cargar indicaciones');
    } finally {
      setNavLoading(false);
    }
  }, [selId]);

  const loadRoutes = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setErr('');
      setLoading(true);
    }
    try {
      const list = await fetchRoutesToday(session.id);
      setRoutes(list);
      setSelId((prev) => {
        if (list.length === 0) return null;
        if (prev != null && list.some((r) => r.id === prev)) return prev;
        return list[0].id;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al cargar rutas');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [session.id]);

  const onMarkArrival = useCallback(
    (st: Stop) => {
      const name = st.client?.name || `Parada ${st.sequence}`;
      Alert.alert('Registrar llegada', `¿Confirmás llegada a ${name}? Se envía el horario a planificación.`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, llegué',
          onPress: () => {
            void (async () => {
              try {
                await patchStop(st.id, {
                  status: 'ARRIVED',
                  actualArrival: new Date().toISOString(),
                });
                await loadRoutes({ silent: true });
              } catch (e) {
                Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo registrar la llegada');
              }
            })();
          },
        },
      ]);
    },
    [loadRoutes]
  );

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRoutes({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadRoutes]);

  useEffect(() => {
    (async () => {
      deviceIdRef.current = await getOrCreateDeviceId();
    })();
    loadRoutes();
  }, [loadRoutes]);

  /** Monitor de conectividad: flush de colas offline al reconectarse. */
  useEffect(() => {
    const update = (state: any) => {
      const online = state?.isConnected ?? true;
      setIsOnline(online);
      if (online) {
        // Flush ambas colas al volver a tener señal
        flushStopQueue().then((n) => { if (n > 0) getPendingStopCount().then(setPendingOffline); });
        flushIncidentQueue().catch(() => {});
      }
    };
    // Expo SDK 54 usa @react-native-community/netinfo importado como NetInfo
    // Como no está instalado explícitamente, lo dejamos como polling de AppState
    const poll = setInterval(async () => {
      const n = await getPendingStopCount();
      setPendingOffline(n);
    }, 5000);
    return () => clearInterval(poll);
  }, []);

  /** Al volver del escritorio / otra app: misma ruta que editó logística en la web. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        loadRoutes({ silent: true });
        flushStopQueue().then((n) => { if (n > 0) getPendingStopCount().then(setPendingOffline); });
        flushIncidentQueue().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [loadRoutes]);

  /** Socket.IO: escuchar cambios de ruta en tiempo real desde planificación. */
  useEffect(() => {
    if (!API_BASE) return;
    let socket: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { io } = require('socket.io-client');
      const base = API_BASE.replace(/\/api\/v1\/?$/, '');
      socket = io(base, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });
      socketRef.current = socket;
      socket.on('connect', () => {
        socket.emit('join:driver', session.id);
      });
      socket.on('route:updated', () => {
        loadRoutes({ silent: true });
        setRouteChangedToast(true);
        setTimeout(() => setRouteChangedToast(false), 3500);
      });
    } catch {
      /* socket.io-client no disponible en este build */
    }
    return () => {
      try {
        if (socket) {
          socket.emit('leave:driver', session.id);
          socket.disconnect();
        }
        socketRef.current = null;
      } catch { /* */ }
    };
  }, [session.id, loadRoutes]);

  const firstFocusSkip = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusSkip.current) {
        firstFocusSkip.current = false;
        return;
      }
      loadRoutes({ silent: true });
    }, [loadRoutes])
  );

  /** Si cambian paradas u orden (mismo routeId), volver a pedir geometría al mapa. */
  const geometryStopsKey = useMemo(() => {
    const r = routes.find((x) => x.id === selId);
    if (!r?.stops?.length) return `none-${selId ?? ''}`;
    return r.stops.map((s) => `${s.id}:${s.sequence}:${s.client?.id ?? ''}`).join('|');
  }, [routes, selId]);

  useEffect(() => {
    if (selId == null) {
      setGeom(null);
      return;
    }
    let cancel = false;
    setGeomLoading(true);
    (async () => {
      try {
        const g = await fetchRouteGeometry(selId);
        if (!cancel) setGeom(g);
      } catch {
        if (!cancel) setGeom(null);
      } finally {
        if (!cancel) setGeomLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [selId, geometryStopsKey]);

  useEffect(() => {
    if (!geom?.points?.length || !mapRef.current) return;
    const coords = geom.points.map((p) => ({ latitude: p.lat, longitude: p.lng }));
    for (const s of geom.stops || []) {
      coords.push({ latitude: s.lat, longitude: s.lng });
    }
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 100, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
    }, 400);
  }, [geom]);

  useEffect(() => {
    setNav(null);
    setNavErr('');
    setStopSearch('');
  }, [selId]);

  useEffect(() => {
    (async () => {
      const on = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      setTracking(on);
    })();
  }, []);

  const sendOnePing = async (routeId: number | null) => {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }).catch(() => null);
    if (!pos || !deviceIdRef.current) return;
    try {
      await postTrackingLocation({
        deviceId: deviceIdRef.current,
        deviceLabel: session.fullName,
        driverId: session.id,
        routeId,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        speed: pos.coords.speed ?? null,
        heading: pos.coords.heading ?? null,
      });
      setTrackingOk(true);
    } catch {
      setTrackingOk(false);
    }
  };

  /** Abre el modal de odómetro antes de iniciar el recorrido. */
  const promptKmAndStart = () => {
    const plate = selected?.vehicle?.plate ?? null;
    pendingStartRef.current = { routeId: selId!, plate };
    setKmInput('');
    setKmModalOpen(true);
  };

  const confirmKmAndStart = async () => {
    const km = parseFloat(kmInput);
    const { routeId, plate } = pendingStartRef.current ?? {};
    setKmModalOpen(false);
    if (plate && !isNaN(km) && km > 0) {
      updateVehicleKm(plate, km).catch(() => {});
    }
    await doStartTracking();
  };

  const skipKmAndStart = async () => {
    setKmModalOpen(false);
    await doStartTracking();
  };

  const startTracking = () => {
    if (routes.length > 0 && selId == null) {
      Alert.alert('Ruta', 'Seleccioná una ruta en la lista de arriba antes de fichar entrada.');
      return;
    }
    if (selected?.vehicle?.plate) {
      promptKmAndStart();
    } else {
      void doStartTracking();
    }
  };

  const doStartTracking = async () => {
    if (routes.length > 0 && selId == null) {
      Alert.alert('Ruta', 'Seleccioná una ruta en la lista de arriba antes de fichar entrada.');
      return;
    }
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      Alert.alert('Ubicación', 'Se necesita permiso de ubicación para el seguimiento.');
      return;
    }
    const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
    if (bg.status !== 'granted' && Platform.OS === 'android') {
      Alert.alert(
        'Ubicación en segundo plano',
        'Sin permiso «siempre», el envío puede pausarse al minimizar. Podés activarlo en Ajustes del sistema.'
      );
    }
    const routeForPing = selId;
    await setActiveRouteId(routeForPing);
    await sendOnePing(routeForPing);
    if (routeForPing != null) {
      await patchRouteRecorrido(routeForPing, session.id, 'start').catch(() => {});
    }
    const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (!started) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 20000,
        distanceInterval: 35,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'R14 · Seguimiento activo',
          notificationBody: 'Tu posición se envía a planificación',
        },
      });
    }
    setTracking(true);
  };

  const stopTracking = async () => {
    if (selId != null) {
      await patchRouteRecorrido(selId, session.id, 'end').catch(() => {});
    }
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch {
      /* */
    }
    // Notificar al servidor que el dispositivo ya no está en ruta
    if (deviceIdRef.current) {
      await deactivateDevice(deviceIdRef.current);
    }
    await setActiveRouteId(null);
    setTracking(false);
  };

  const onChangeRoute = async (id: number) => {
    setSelId(id);
    if (tracking) await setActiveRouteId(id);
  };

  const lineCoords = useMemo(
    () =>
      (geom?.points || []).map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
    [geom]
  );

  const recorridoTranslateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -SCREEN_W],
  });
  const mapaTranslateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_W, 0],
  });

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {/* Tab bar */}
      <View style={[styles.tabBar, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
        <Pressable
          style={[styles.tab, activeTab === 'recorrido' && styles.tabActive]}
          onPress={() => switchTab('recorrido')}
        >
          <Text style={[styles.tabTxt, activeTab === 'recorrido' && styles.tabTxtActive]}>Mi Recorrido</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'mapa' && styles.tabActive]}
          onPress={() => switchTab('mapa')}
        >
          <Text style={[styles.tabTxt, activeTab === 'mapa' && styles.tabTxtActive]}>Mapa</Text>
        </Pressable>
      </View>

      {/* Contenedor animado de ambas vistas */}
      <View style={styles.tabContent}>
        {/* Vista: Mi Recorrido (pantalla completa) */}
        <Animated.View style={[styles.tabPage, { transform: [{ translateX: recorridoTranslateX }] }]}>
          <ScrollView
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onPullRefresh}
                colors={['#4f46e5']}
                tintColor="#4f46e5"
              />
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces
            contentContainerStyle={[styles.recorridoContent, { paddingBottom: Math.max(20, insets.bottom) }]}
          >
        <View style={styles.panelHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.panelTitle}>Mi recorrido</Text>
            <Text style={styles.panelSub}>{session.fullName}</Text>
          </View>
          <Pressable style={styles.iconBtn} onPress={() => navigation.navigate('History')}>
            <Text style={styles.iconBtnTxt}>📋</Text>
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={() => navigation.navigate('Profile')}>
            <Text style={styles.iconBtnTxt}>👤</Text>
          </Pressable>
        </View>
          {/* Toast: ruta actualizada por planificación */}
          {routeChangedToast ? (
            <View style={styles.toastBanner}>
              <Text style={styles.toastTxt}>🔄 Tu ruta fue actualizada por planificación</Text>
            </View>
          ) : null}

          {/* Banner offline */}
          {pendingOffline > 0 && (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineTxt}>⚡ {pendingOffline} acción(es) pendiente(s) de sincronizar</Text>
            </View>
          )}

          {/* Panel de estadísticas del día */}
          {todayStats && todayStats.total > 0 ? (
            <View style={styles.statsPanel}>
              <View style={styles.statsPanelRow}>
                <View style={styles.statsPanelItem}>
                  <Text style={styles.statsPanelVal}>{todayStats.total}</Text>
                  <Text style={styles.statsPanelLbl}>Total</Text>
                </View>
                <View style={[styles.statsPanelItem, styles.statsPanelItemGreen]}>
                  <Text style={[styles.statsPanelVal, { color: '#16a34a' }]}>{todayStats.completed}</Text>
                  <Text style={styles.statsPanelLbl}>✓ Entregadas</Text>
                </View>
                {todayStats.undeliverable > 0 ? (
                  <View style={[styles.statsPanelItem, styles.statsPanelItemRed]}>
                    <Text style={[styles.statsPanelVal, { color: '#e11d48' }]}>{todayStats.undeliverable}</Text>
                    <Text style={styles.statsPanelLbl}>✗ No entregadas</Text>
                  </View>
                ) : null}
                <View style={styles.statsPanelItem}>
                  <Text style={[styles.statsPanelVal, { color: '#d97706' }]}>{todayStats.pending}</Text>
                  <Text style={styles.statsPanelLbl}>Pendientes</Text>
                </View>
                {todayStats.avgMin !== null ? (
                  <View style={styles.statsPanelItem}>
                    <Text style={styles.statsPanelVal}>{todayStats.avgMin}m</Text>
                    <Text style={styles.statsPanelLbl}>Prom</Text>
                  </View>
                ) : null}
              </View>
              {/* Barra de progreso */}
              <View style={styles.statsPanelBar}>
                <View style={[
                  styles.statsPanelBarFill,
                  { width: `${Math.round((todayStats.completed / todayStats.total) * 100)}%` as any }
                ]} />
              </View>
            </View>
          ) : null}

          {!tracking ? (
            <Pressable style={styles.ficharEntrada} onPress={startTracking}>
              <Text style={styles.ficharEntradaTxt}>Fichar entrada</Text>
              <Text style={styles.ficharEntradaSub}>
                Empezás a enviar tu ubicación a planificación (torre de control).
              </Text>
            </Pressable>
          ) : (
            <Pressable style={styles.ficharSalida} onPress={stopTracking}>
              <Text style={styles.ficharSalidaTxt}>Fichar salida</Text>
              <Text style={styles.ficharSalidaSub}>Se detiene el reporte de posición.</Text>
            </Pressable>
          )}

          {/* Botón incidencia */}
          <Pressable style={styles.incidentBtn} onPress={() => setIncidentModalOpen(true)}>
            <Text style={styles.incidentBtnTxt}>⚠️  Reportar incidencia</Text>
          </Pressable>

          {err ? <Text style={styles.err}>{err}</Text> : null}
          {firstPendingClient ? (
            <View>
              <Pressable style={styles.nextBox} onPress={openFirstDeliveryInMaps}>
                <Text style={styles.nextLabel}>Próxima entrega</Text>
                <Text style={styles.nextAddr} numberOfLines={2}>
                  {firstPendingClient.name}
                  {firstPendingClient.address ? `\n${firstPendingClient.address}` : ''}
                </Text>
                <Text style={styles.nextTap}>Abrir en Maps</Text>
                <Text style={styles.nextTapHint}>
                  Te lleva desde donde estás al destino.
                </Text>
              </Pressable>
              {firstPendingStop &&
              selId != null &&
              firstPendingClient.latitude != null &&
              firstPendingClient.longitude != null ? (
                <Pressable
                  style={styles.embedNavBtn}
                  onPress={() =>
                    navigation.navigate('EmbeddedNav', {
                      routeId: selId,
                      stopId: firstPendingStop.id,
                      destLat: firstPendingClient.latitude as number,
                      destLng: firstPendingClient.longitude as number,
                      title: firstPendingClient.name,
                    })
                  }
                >
                  <Text style={styles.embedNavBtnTxt}>Navegar en la app</Text>
                  <Text style={styles.embedNavBtnSub}>
                    Mapa con ruta e instrucciones paso a paso hasta la parada.
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {selected && !selected.actualEndTime && hasPendingStops && selId != null ? (
            <View style={styles.navBox}>
              <Text style={styles.navTitle}>Indicaciones por calle</Text>
              <Pressable
                style={[styles.navBtn, navLoading && styles.navBtnDisabled]}
                onPress={loadNavInstructions}
                disabled={navLoading}
              >
                {navLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.navBtnTxt}>Actualizar indicaciones (desde mi ubicación)</Text>
                )}
              </Pressable>
              {navErr ? <Text style={styles.navErr}>{navErr}</Text> : null}
              {nav?.done ? (
                <Text style={styles.navMini}>{nav.message || 'No hay paradas pendientes con coordenadas.'}</Text>
              ) : null}
              {nav && !nav.done && nav.summary ? (
                <Text style={styles.navSummary}>{nav.summary}</Text>
              ) : null}
              {nav?.steps?.length ? (
                <View style={styles.navSteps}>
                  {nav.steps.map((s, i) => (
                    <View key={`${i}-${s.instruction.slice(0, 24)}`} style={styles.navStep}>
                      <Text style={styles.navStepNum}>{i + 1}</Text>
                      <View style={styles.navStepBody}>
                        <Text style={styles.navStepInstr}>{s.instruction}</Text>
                        {s.distanceText || s.durationText ? (
                          <Text style={styles.navStepMeta}>
                            {[s.distanceText, s.durationText].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text style={styles.navHint}>
                Para voz y re-ruteo al volante, usá «Abrir en Maps» arriba.
              </Text>
            </View>
          ) : null}
          {loading ? (
            <ActivityIndicator color="#4f46e5" style={{ marginVertical: 8 }} />
          ) : routes.length === 0 ? (
            <Text style={styles.hint}>No tenés rutas asignadas para hoy.</Text>
          ) : (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.chips}
            >
              {routes.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => onChangeRoute(r.id)}
                  style={[styles.chip, selId === r.id && styles.chipOn]}
                >
                  <Text style={[styles.chipTxt, selId === r.id && styles.chipTxtOn]}>
                    {r.driver?.username || `Ruta #${r.id}`}
                    {r.vehicle?.plate ? ` · ${r.vehicle.plate}` : ''}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {geomLoading ? (
            <Text style={styles.mini}>Cargando trazado por calles…</Text>
          ) : geom == null && selected && selected.stops.length >= 2 ? (
            <Text style={styles.mini}>
              Ruta no disponible en el mapa.
            </Text>
          ) : null}
          {selected && !selected.actualEndTime && routeStopsSorted.length > 0 ? (
            <View style={styles.stopsSection}>
              <View style={styles.stopsSectionHeader}>
                <Text style={styles.stopsSectionTitle}>Paradas del recorrido</Text>
                {hasPendingStops ? (
                  <Pressable style={styles.reorderBtn} onPress={() => setReorderModalOpen(true)}>
                    <Text style={styles.reorderBtnTxt}>↕ Reordenar</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                style={styles.stopSearchInput}
                placeholder="Buscar parada por nombre o dirección..."
                placeholderTextColor="#94a3b8"
                value={stopSearch}
                onChangeText={setStopSearch}
              />
              <Text style={styles.stopsSectionHint}>
                Llegada y salida con horario; al finalizar entrega podés cargar observaciones, foto y marcar si fue
                sin inconvenientes.
              </Text>
              {selected.reorderReason ? (
                <View style={styles.reorderBanner}>
                  <Text style={styles.reorderBannerTxt}>
                    🔀 Orden modificado: {selected.reorderReason}
                  </Text>
                </View>
              ) : null}
              {filteredStops.map((st) => (
                <View key={st.id} style={styles.stopCard}>
                  <Text style={styles.stopCardTitle}>
                    {st.sequence}. {st.client?.name || 'Cliente'}
                  </Text>
                  {st.client?.address ? (
                    <Text style={styles.stopClientAddr}>{st.client.address}</Text>
                  ) : null}
                  {(st.client?.barrio || st.client?.zone) ? (
                    <Text style={styles.stopClientZone}>
                      {[st.client.barrio, st.client.zone].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {(st.client?.timeWindowStart || st.client?.timeWindowEnd) ? (
                    <Text style={styles.stopClientHorario}>
                      🕐 {st.client.timeWindowStart ?? '--'} – {st.client.timeWindowEnd ?? '--'}
                    </Text>
                  ) : null}
                  <View style={[
                    styles.stopStatusBadge,
                    st.status === 'PENDING' && styles.stopStatusPending,
                    st.status === 'ARRIVED' && styles.stopStatusArrived,
                    st.status === 'COMPLETED' && styles.stopStatusCompleted,
                    st.status === 'UNDELIVERABLE' && styles.stopStatusUndeliverable,
                  ]}>
                    <Text style={[
                      styles.stopStatusBadgeTxt,
                      st.status === 'PENDING' && styles.stopStatusPendingTxt,
                      st.status === 'ARRIVED' && styles.stopStatusArrivedTxt,
                      st.status === 'COMPLETED' && styles.stopStatusCompletedTxt,
                      st.status === 'UNDELIVERABLE' && styles.stopStatusUndeliverableTxt,
                    ]}>
                      {st.status === 'PENDING' ? 'Pendiente'
                        : st.status === 'ARRIVED' ? 'En destino'
                        : st.status === 'COMPLETED' ? 'Entregado'
                        : st.status === 'UNDELIVERABLE' ? 'No entregado'
                        : st.status}
                    </Text>
                  </View>
                  <Text style={styles.stopCardMeta}>
                    Llegada: {fmtStopTime(st.actualArrival)} · Salida: {fmtStopTime(st.actualDeparture)}
                  </Text>
                  {st.status === 'COMPLETED' ? (
                    <View style={styles.stopDoneBox}>
                      {st.deliveryWithoutIssues ? (
                        <Text style={styles.stopDoneOk}>✓ Entrega sin problemas</Text>
                      ) : null}
                      {st.observations ? (
                        <Text style={styles.stopObs} numberOfLines={3}>
                          Obs.: {st.observations}
                        </Text>
                      ) : null}
                      {st.proofPhotoUrl ? (
                        <Text style={styles.stopPhotoHint}>Foto de comprobante cargada</Text>
                      ) : null}
                    </View>
                  ) : null}
                  {st.status === 'UNDELIVERABLE' ? (
                    <View style={styles.stopDoneBox}>
                      {st.reasonCode ? (
                        <Text style={styles.stopUndeliverableReason}>✗ {st.reasonCode.replace(/_/g, ' ')}</Text>
                      ) : null}
                      {st.observations ? (
                        <Text style={styles.stopObs} numberOfLines={3}>Obs.: {st.observations}</Text>
                      ) : null}
                    </View>
                  ) : null}
                  {st.status === 'PENDING' ? (
                    <Pressable style={styles.stopBtnArr} onPress={() => onMarkArrival(st)}>
                      <Text style={styles.stopBtnArrTxt}>Registrar llegada</Text>
                    </Pressable>
                  ) : null}
                  {st.status === 'ARRIVED' ? (
                    <Pressable style={styles.stopBtnOut} onPress={() => setDeliveryModalStop(st)}>
                      <Text style={styles.stopBtnOutTxt}>Finalizar entrega</Text>
                      <Text style={styles.stopBtnOutSub}>Entregado · No entregado · Observaciones · Foto</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          <Pressable style={styles.refreshFull} onPress={() => loadRoutes({ silent: false })}>
            <Text style={styles.refreshTxt}>Actualizar rutas</Text>
          </Pressable>
          {tracking ? (
            <View style={styles.liveRow}>
              <View style={[styles.connectionDot, trackingOk ? styles.connectionDotOk : styles.connectionDotErr]} />
              <Text style={styles.live}>
                Entrada fichada: ubicación cada ~20 s a planificación. Tocá «Fichar salida» al terminar.
              </Text>
            </View>
          ) : null}
        </ScrollView>
        </Animated.View>

        {/* Vista: Mapa (pantalla completa) */}
        <Animated.View style={[styles.tabPage, styles.tabPageAbsolute, { transform: [{ translateX: mapaTranslateX }] }]}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={BA}
            showsUserLocation
            showsMyLocationButton
          >
            {lineCoords.length >= 2 && (
              <Polyline coordinates={lineCoords} strokeColor="#6366f1" strokeWidth={5} />
            )}
            {(geom?.stops || []).map((s) => (
              <Marker
                key={`${s.stopId ?? s.sequence}`}
                coordinate={{ latitude: s.lat, longitude: s.lng }}
                title={`${s.sequence}. ${s.name}`}
                pinColor={s.sequence === 1 ? '#059669' : '#d97706'}
              />
            ))}
            {!geom &&
              selected?.stops?.map((st) => {
                const la = st.client?.latitude;
                const lo = st.client?.longitude;
                if (la == null || lo == null) return null;
                return (
                  <Marker
                    key={st.id}
                    coordinate={{ latitude: la, longitude: lo }}
                    title={`${st.sequence}. ${st.client.name}`}
                  />
                );
              })}
          </MapView>
        </Animated.View>
      </View>

      <StopDeliveryModal
        visible={deliveryModalStop != null}
        stop={deliveryModalStop}
        onClose={() => setDeliveryModalStop(null)}
        onSaved={() => {
          const completedStop = deliveryModalStop;
          setDeliveryModalStop(null);
          loadRoutes({ silent: true }).then(() => {
            // Buscar siguiente parada pendiente
            if (!completedStop || !selected?.stops) return;
            const nextPending = [...selected.stops]
              .sort((a, b) => a.sequence - b.sequence)
              .find((s) => s.status === 'PENDING' && s.id !== completedStop.id);
            if (nextPending?.client) {
              const name = nextPending.client.name || `Parada ${nextPending.sequence}`;
              Alert.alert(
                'Siguiente parada',
                `${name}\n${nextPending.client.address || ''}`,
                [
                  { text: 'Ver lista', style: 'cancel' },
                  {
                    text: 'Navegar',
                    onPress: () => {
                      if (nextPending.client?.latitude != null && nextPending.client?.longitude != null && selId != null) {
                        navigation.navigate('EmbeddedNav', {
                          routeId: selId,
                          stopId: nextPending.id,
                          destLat: nextPending.client.latitude,
                          destLng: nextPending.client.longitude,
                          title: nextPending.client.name,
                        });
                      }
                    },
                  },
                ]
              );
            }
          });
        }}
      />

      {/* Modal incidencias */}
      <IncidentModal
        visible={incidentModalOpen}
        session={session}
        tripId={null}
        onClose={() => setIncidentModalOpen(false)}
        onSent={() => { /* notificado */ }}
      />

      {/* Modal reordenamiento de paradas */}
      {selected && selId !== null ? (
        <ReorderModal
          visible={reorderModalOpen}
          routeId={selId}
          stops={selected.stops}
          driverName={session.fullName}
          onClose={() => setReorderModalOpen(false)}
          onSaved={() => {
            setReorderModalOpen(false);
            loadRoutes({ silent: true });
          }}
        />
      ) : null}

      {/* Modal odómetro */}
      {kmModalOpen && (
        <View style={StyleSheet.absoluteFill}>
          <Pressable style={styles.kmBackdrop} onPress={() => setKmModalOpen(false)} />
          <View style={styles.kmSheet}>
            <Text style={styles.kmTitle}>¿Cuál es el odómetro actual?</Text>
            <Text style={styles.kmSub}>Ingresá los kilómetros del vehículo antes de salir. Podés saltar este paso.</Text>
            <TextInput
              style={styles.kmInput}
              keyboardType="numeric"
              placeholder="Ej: 125000"
              placeholderTextColor="#94a3b8"
              value={kmInput}
              onChangeText={setKmInput}
              autoFocus
            />
            <View style={styles.kmActions}>
              <Pressable style={styles.kmSkipBtn} onPress={() => void skipKmAndStart()}>
                <Text style={styles.kmSkipTxt}>Saltar</Text>
              </Pressable>
              <Pressable style={styles.kmConfirmBtn} onPress={() => void confirmKmAndStart()}>
                <Text style={styles.kmConfirmTxt}>Confirmar y fichar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#4f46e5',
  },
  tabTxt: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  tabTxtActive: { color: '#fff', fontWeight: '900' },
  tabContent: { flex: 1, overflow: 'hidden' },
  tabPage: { flex: 1, backgroundColor: '#f8fafc' },
  tabPageAbsolute: { ...StyleSheet.absoluteFillObject },
  recorridoContent: { paddingHorizontal: 16, paddingTop: 14 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  panelTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a' },
  panelSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  outBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  outBtnTxt: { color: '#64748b', fontWeight: '700', fontSize: 14 },
  err: { color: '#b91c1c', fontSize: 12, marginTop: 6 },
  nextBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  nextLabel: { fontSize: 10, fontWeight: '900', color: '#047857', letterSpacing: 0.5 },
  nextAddr: { fontSize: 13, fontWeight: '700', color: '#064e3b', marginTop: 4 },
  nextTap: { fontSize: 11, fontWeight: '800', color: '#059669', marginTop: 6 },
  nextTapHint: { fontSize: 10, color: '#047857', marginTop: 4, lineHeight: 14, opacity: 0.9 },
  embedNavBtn: {
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  embedNavBtnTxt: { fontSize: 14, fontWeight: '900', color: '#3730a3' },
  embedNavBtnSub: { fontSize: 10, color: '#6366f1', marginTop: 6, lineHeight: 14 },
  stopsSection: { marginTop: 14 },
  stopsSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stopsSectionTitle: { fontSize: 12, fontWeight: '900', color: '#0f172a', letterSpacing: 0.3 },
  stopsSectionHint: { fontSize: 10, color: '#64748b', marginTop: 4, lineHeight: 14, marginBottom: 8 },
  reorderBtn: { backgroundColor: '#eef2ff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: '#c7d2fe' },
  reorderBtnTxt: { fontSize: 11, fontWeight: '800', color: '#3730a3' },
  reorderBanner: { backgroundColor: '#eff6ff', borderRadius: 10, padding: 8, marginBottom: 8, borderWidth: 1, borderColor: '#bfdbfe' },
  reorderBannerTxt: { fontSize: 10, color: '#1d4ed8', fontWeight: '700', lineHeight: 14 },
  stopClientAddr: { fontSize: 11, color: '#475569', marginTop: 3, lineHeight: 15 },
  stopClientZone: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  stopClientHorario: { fontSize: 10, color: '#7c3aed', fontWeight: '700', marginTop: 3 },
  stopUndeliverableReason: { fontSize: 11, fontWeight: '800', color: '#e11d48' },
  toastBanner: { backgroundColor: '#dbeafe', borderRadius: 10, padding: 8, marginBottom: 8, borderWidth: 1, borderColor: '#93c5fd' },
  toastTxt: { fontSize: 12, color: '#1e40af', fontWeight: '800', textAlign: 'center' },
  iconBtn: { padding: 8, marginLeft: 2 },
  iconBtnTxt: { fontSize: 20 },
  statsPanel: { backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 10, marginBottom: 10 },
  statsPanelRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  statsPanelItem: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, alignItems: 'center', minWidth: 50 },
  statsPanelItemGreen: { backgroundColor: '#f0fdf4' },
  statsPanelItemRed: { backgroundColor: '#fff1f2' },
  statsPanelVal: { fontSize: 15, fontWeight: '900', color: '#0f172a' },
  statsPanelLbl: { fontSize: 8, color: '#94a3b8', fontWeight: '700', marginTop: 1 },
  statsPanelBar: { height: 5, backgroundColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden' },
  statsPanelBarFill: { height: 5, backgroundColor: '#4f46e5', borderRadius: 3 },
  stopSearchInput: { backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: '#0f172a', marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  stopCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 10,
  },
  stopCardTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  stopCardMeta: { fontSize: 11, color: '#64748b', marginTop: 4 },
  stopDoneBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  stopDoneOk: { fontSize: 11, fontWeight: '800', color: '#059669' },
  stopObs: { fontSize: 11, color: '#475569', marginTop: 4 },
  stopPhotoHint: { fontSize: 10, color: '#6366f1', marginTop: 4, fontWeight: '700' },
  stopBtnArr: {
    marginTop: 10,
    backgroundColor: '#059669',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 52,
  },
  stopBtnArrTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },
  stopBtnOut: {
    marginTop: 10,
    backgroundColor: '#4f46e5',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 52,
  },
  stopBtnOutTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },
  stopBtnOutSub: { color: 'rgba(255,255,255,0.85)', fontSize: 9, marginTop: 4, textAlign: 'center' },
  hint: { color: '#64748b', fontSize: 13, marginVertical: 6 },
  chips: { marginTop: 10, maxHeight: 44 },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    marginRight: 8,
    alignSelf: 'flex-start',
  },
  chipOn: { backgroundColor: '#4f46e5' },
  chipTxt: { fontWeight: '700', color: '#334155', fontSize: 13 },
  chipTxtOn: { color: '#fff' },
  mini: { fontSize: 11, color: '#94a3b8', marginTop: 6 },
  ficharEntrada: {
    marginTop: 12,
    backgroundColor: '#059669',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  ficharEntradaTxt: { fontWeight: '900', color: '#fff', fontSize: 17, letterSpacing: 0.3 },
  ficharEntradaSub: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    lineHeight: 15,
  },
  ficharSalida: {
    marginTop: 12,
    backgroundColor: '#7f1d1d',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  ficharSalidaTxt: { fontWeight: '900', color: '#fff', fontSize: 17, letterSpacing: 0.3 },
  ficharSalidaSub: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  offlineBanner: {
    backgroundColor: '#fef9c3',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#fde047',
  },
  offlineTxt: { fontSize: 12, fontWeight: '700', color: '#854d0e', textAlign: 'center' },
  incidentBtn: {
    marginTop: 8,
    backgroundColor: '#fff7ed',
    borderWidth: 1.5,
    borderColor: '#fed7aa',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  incidentBtnTxt: { fontSize: 14, fontWeight: '800', color: '#c2410c' },
  kmBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  kmSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 24,
    paddingBottom: 36,
  },
  kmTitle:   { fontSize: 17, fontWeight: '900', color: '#0f172a', marginBottom: 6 },
  kmSub:     { fontSize: 12, color: '#64748b', marginBottom: 16 },
  kmInput:   { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, fontSize: 20, fontWeight: '700', color: '#0f172a', marginBottom: 16, textAlign: 'center' },
  kmActions: { flexDirection: 'row', gap: 10 },
  kmSkipBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#e2e8f0', alignItems: 'center' },
  kmSkipTxt: { fontWeight: '800', color: '#475569' },
  kmConfirmBtn: { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: '#4f46e5', alignItems: 'center' },
  kmConfirmTxt: { fontWeight: '900', color: '#fff' },
  refreshFull: {
    marginTop: 12,
    backgroundColor: '#f1f5f9',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  refreshTxt: { fontWeight: '800', color: '#475569' },
  live: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
    flex: 1,
  },
  navBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  navTitle: { fontSize: 11, fontWeight: '900', color: '#475569', letterSpacing: 0.4 },
  navBtn: {
    marginTop: 8,
    backgroundColor: '#4f46e5',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  navBtnDisabled: { opacity: 0.75 },
  navBtnTxt: { fontWeight: '800', color: '#fff', fontSize: 13, textAlign: 'center' },
  navErr: { color: '#b91c1c', fontSize: 12, marginTop: 8 },
  navMini: { fontSize: 12, color: '#64748b', marginTop: 8 },
  navSummary: { fontSize: 13, fontWeight: '800', color: '#0f172a', marginTop: 8 },
  navSteps: { marginTop: 8 },
  navStep: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10, gap: 10 },
  navStepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: '#e0e7ff',
    color: '#3730a3',
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 22,
  },
  navStepBody: { flex: 1 },
  navStepInstr: { fontSize: 13, fontWeight: '600', color: '#1e293b', lineHeight: 18 },
  navStepMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  navHint: { fontSize: 10, color: '#94a3b8', marginTop: 10, lineHeight: 14 },
  stopStatusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: 4,
  },
  stopStatusPending: { backgroundColor: '#fef3c7' },
  stopStatusArrived: { backgroundColor: '#dbeafe' },
  stopStatusCompleted: { backgroundColor: '#d1fae5' },
  stopStatusUndeliverable: { backgroundColor: '#ffe4e6' },
  stopStatusBadgeTxt: { fontSize: 11, fontWeight: '800' },
  stopStatusPendingTxt: { color: '#92400e' },
  stopStatusArrivedTxt: { color: '#1e40af' },
  stopStatusCompletedTxt: { color: '#065f46' },
  stopStatusUndeliverableTxt: { color: '#9f1239' },
  liveRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  connectionDot: { width: 10, height: 10, borderRadius: 5 },
  connectionDotOk: { backgroundColor: '#22c55e' },
  connectionDotErr: { backgroundColor: '#ef4444' },
});
