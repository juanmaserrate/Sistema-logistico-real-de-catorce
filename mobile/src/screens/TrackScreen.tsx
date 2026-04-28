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
  getPendingLocationCount,
  pingServer,
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
import { colors, font, radius, spacing, shadow } from '../theme';

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
  const mapRef = useRef<InstanceType<typeof MapView>>(null);
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
  // Estado de la señal: 'ok' verde, 'queued' amarillo (hay cola pendiente), 'error' rojo.
  const [signalState, setSignalState] = useState<'ok' | 'queued' | 'error'>('ok');
  const [pendingLoc, setPendingLoc] = useState(0);
  const deviceIdRef = useRef<string>('');
  const socketRef = useRef<any>(null);
  // Incidencias
  const [incidentModalOpen, setIncidentModalOpen] = useState(false);
  // Modo offline
  const [isOnline, setIsOnline] = useState(true);
  const [pendingOffline, setPendingOffline] = useState(0);
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
    if (!selected?.stops?.length) return null;
    if (selected.trip?.status === 'COMPLETED') return null;
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
      // Si cambia el viaje (status, horarios, chofer asignado, etc.), refrescar la ruta
      socket.on('trip:updated', () => {
        loadRoutes({ silent: true });
      });
      // Si el operador crea un viaje nuevo, refrescar por si me lo asignaron
      socket.on('trip:created', () => {
        loadRoutes({ silent: true });
      });
      // Si una parada cambió (otro dispositivo marca entrega), refrescar
      socket.on('stop:updated', () => {
        loadRoutes({ silent: true });
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

  /** Encuadrar el mapa: usa geometría por calles si está, si no usa los stops directamente. */
  const fitMapToRoute = useCallback(() => {
    if (!mapRef.current) return;
    const coords: Array<{ latitude: number; longitude: number }> = [];
    if (geom?.points?.length) {
      for (const p of geom.points) coords.push({ latitude: p.lat, longitude: p.lng });
      for (const s of geom.stops || []) coords.push({ latitude: s.lat, longitude: s.lng });
    } else if (selected?.stops?.length) {
      for (const s of selected.stops) {
        if (s.client?.latitude != null && s.client?.longitude != null) {
          coords.push({ latitude: s.client.latitude, longitude: s.client.longitude });
        }
      }
    }
    if (coords.length < 2) return;
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 100, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
    }, 400);
  }, [geom, selected]);

  /** Re-encuadrar cuando llega geom, cambia ruta, o el usuario va a la tab mapa. */
  useEffect(() => {
    fitMapToRoute();
  }, [fitMapToRoute, activeTab]);

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

  /** Heartbeat de señal: cada 10s mide latencia al servidor y chequea la cola offline.
   *  Verde = OK, Amarillo = hay cola pendiente, Rojo = sin respuesta del servidor. */
  useEffect(() => {
    if (!tracking) return;
    let cancelled = false;
    const tick = async () => {
      const [latency, pending] = await Promise.all([
        pingServer(4000),
        getPendingLocationCount(),
      ]);
      if (cancelled) return;
      setPendingLoc(pending);
      if (latency == null) {
        setSignalState('error');
      } else if (pending > 0) {
        setSignalState('queued');
      } else {
        setSignalState('ok');
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tracking]);

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
      setSignalState('ok');
    } catch {
      setSignalState('error');
    }
  };

  const startTracking = () => {
    if (routes.length > 0 && selId == null) {
      Alert.alert('Ruta', 'Seleccioná una ruta en la lista de arriba antes de fichar entrada.');
      return;
    }
    void doStartTracking();
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
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 15,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'R14 · Seguimiento activo',
          notificationBody: 'Tu posición se envía a planificación en tiempo real',
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
                colors={[colors.primary]}
                tintColor={colors.primary}
              />
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces
            contentContainerStyle={[styles.recorridoContent, { paddingBottom: Math.max(20, insets.bottom) }]}
          >
        <View style={styles.panelHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.panelTitle}>
              {selected?.trip?.businessUnit || selected?.trip?.reparto || 'Mi recorrido'}
            </Text>
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
                  <Text style={[styles.statsPanelVal, { color: colors.success }]}>{todayStats.completed}</Text>
                  <Text style={styles.statsPanelLbl}>✓ Entregadas</Text>
                </View>
                {todayStats.undeliverable > 0 ? (
                  <View style={[styles.statsPanelItem, styles.statsPanelItemRed]}>
                    <Text style={[styles.statsPanelVal, { color: colors.error }]}>{todayStats.undeliverable}</Text>
                    <Text style={styles.statsPanelLbl}>✗ No entregadas</Text>
                  </View>
                ) : null}
                <View style={styles.statsPanelItem}>
                  <Text style={[styles.statsPanelVal, { color: colors.accent }]}>{todayStats.pending}</Text>
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
            </Pressable>
          ) : (
            <Pressable style={styles.ficharSalida} onPress={stopTracking}>
              <Text style={styles.ficharSalidaTxt}>Fichar salida</Text>
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
            </View>
          ) : null}
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
          ) : routes.length === 0 ? (
            <Text style={styles.hint}>No tenés rutas asignadas para hoy.</Text>
          ) : (
            <View style={styles.routeCards}>
              {routes.map((r) => {
                const bu = r.trip?.businessUnit || r.trip?.reparto || `Ruta #${r.id}`;
                const isOn = selId === r.id;
                const concluded = r.trip?.status === 'COMPLETED';
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => onChangeRoute(r.id)}
                    style={[styles.routeCard, isOn && styles.routeCardOn]}
                  >
                    <Text style={[styles.routeCardTitle, isOn && styles.routeCardTitleOn]} numberOfLines={2}>
                      {bu}
                    </Text>
                    {concluded ? (
                      <Text style={[styles.routeCardBadge, isOn && { color: 'rgba(255,255,255,0.9)' }]}>
                        Viaje concluido
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          {geomLoading ? (
            <Text style={styles.mini}>Cargando trazado por calles…</Text>
          ) : geom == null && selected && selected.stops.length >= 2 ? (
            <Text style={styles.mini}>
              Ruta no disponible en el mapa.
            </Text>
          ) : null}
          {selected && selected.trip?.status !== 'COMPLETED' && routeStopsSorted.length > 0 ? (
            <View style={styles.stopsSection}>
              <View style={styles.stopsSectionHeader}>
                <Text style={styles.stopsSectionTitle}>Paradas del recorrido</Text>
              </View>
              {hasPendingStops ? (
                <Pressable style={styles.reorderBtn} onPress={() => setReorderModalOpen(true)}>
                  <Text style={styles.reorderBtnTxt}>↕ Reordenar paradas</Text>
                </Pressable>
              ) : null}
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
              {filteredStops.map((st, idx) => {
                const isLast = idx === filteredStops.length - 1;
                const isActive = st.status === 'ARRIVED';
                const isDone = st.status === 'COMPLETED';
                const isFailed = st.status === 'UNDELIVERABLE';
                return (
                <View key={st.id} style={styles.tlRow}>
                  {/* Timeline left: dot + line */}
                  <View style={styles.tlLeft}>
                    <View style={[
                      styles.tlDot,
                      isDone && styles.tlDotDone,
                      isActive && styles.tlDotActive,
                      isFailed && styles.tlDotFailed,
                    ]}>
                      {isDone ? <Text style={styles.tlDotIcon}>✓</Text>
                        : isFailed ? <Text style={styles.tlDotIcon}>✗</Text>
                        : <Text style={styles.tlDotNum}>{st.sequence}</Text>}
                    </View>
                    {!isLast && <View style={[
                      styles.tlLine,
                      isDone && styles.tlLineDone,
                    ]} />}
                  </View>
                  {/* Timeline right: content */}
                  <View style={[styles.tlContent, isActive && styles.tlContentActive]}>
                    <View style={styles.tlHeader}>
                      <Text style={styles.tlName} numberOfLines={1}>
                        {st.client?.name || 'Cliente'}
                      </Text>
                      <View style={[
                        styles.tlBadge,
                        st.status === 'PENDING' && styles.tlBadgePending,
                        isActive && styles.tlBadgeActive,
                        isDone && styles.tlBadgeDone,
                        isFailed && styles.tlBadgeFailed,
                      ]}>
                        <Text style={[
                          styles.tlBadgeTxt,
                          st.status === 'PENDING' && styles.tlBadgePendingTxt,
                          isActive && styles.tlBadgeActiveTxt,
                          isDone && styles.tlBadgeDoneTxt,
                          isFailed && styles.tlBadgeFailedTxt,
                        ]}>
                          {st.status === 'PENDING' ? 'Pendiente'
                            : isActive ? 'En destino'
                            : isDone ? 'Entregado'
                            : isFailed ? 'No entregado'
                            : st.status}
                        </Text>
                      </View>
                    </View>
                    {st.client?.address ? (
                      <Text style={styles.tlAddr} numberOfLines={2}>{st.client.address}</Text>
                    ) : null}
                    {(st.client?.barrio || st.client?.zone) ? (
                      <Text style={styles.tlZone}>
                        {[st.client.barrio, st.client.zone].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                    {(st.client?.timeWindowStart || st.client?.timeWindowEnd) ? (
                      <Text style={styles.tlHorario}>
                        🕐 {st.client.timeWindowStart ?? '--'} – {st.client.timeWindowEnd ?? '--'}
                      </Text>
                    ) : null}
                    <Text style={styles.tlMeta}>
                      {fmtStopTime(st.actualArrival)} → {fmtStopTime(st.actualDeparture)}
                    </Text>
                    {isDone ? (
                      <View style={styles.tlDoneInfo}>
                        {st.deliveryWithoutIssues ? (
                          <Text style={styles.tlDoneOk}>✓ Sin problemas</Text>
                        ) : null}
                        {st.observations ? (
                          <Text style={styles.tlObs} numberOfLines={2}>{st.observations}</Text>
                        ) : null}
                        {st.proofPhotoUrl ? (
                          <Text style={styles.tlPhotoHint}>📷 Foto cargada</Text>
                        ) : null}
                      </View>
                    ) : null}
                    {isFailed ? (
                      <View style={styles.tlDoneInfo}>
                        {st.reasonCode ? (
                          <Text style={styles.tlFailReason}>✗ {st.reasonCode.replace(/_/g, ' ')}</Text>
                        ) : null}
                        {st.observations ? (
                          <Text style={styles.tlObs} numberOfLines={2}>{st.observations}</Text>
                        ) : null}
                      </View>
                    ) : null}
                    {st.status === 'PENDING' ? (
                      <Pressable style={styles.tlBtnArr} onPress={() => onMarkArrival(st)}>
                        <Text style={styles.tlBtnArrTxt}>Registrar llegada</Text>
                      </Pressable>
                    ) : null}
                    {isActive ? (
                      <Pressable style={styles.tlBtnOut} onPress={() => setDeliveryModalStop(st)}>
                        <Text style={styles.tlBtnOutTxt}>Finalizar entrega</Text>
                        <Text style={styles.tlBtnOutSub}>Entregado · No entregado · Obs · Foto</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                );
              })}
            </View>
          ) : null}
          <Pressable style={styles.refreshFull} onPress={() => loadRoutes({ silent: false })}>
            <Text style={styles.refreshTxt}>Actualizar rutas</Text>
          </Pressable>
          {tracking ? (
            <View style={styles.liveRow}>
              <View
                style={[
                  styles.connectionDot,
                  signalState === 'ok' && styles.connectionDotOk,
                  signalState === 'queued' && styles.connectionDotWarn,
                  signalState === 'error' && styles.connectionDotErr,
                ]}
              />
              <Text
                style={[
                  styles.live,
                  signalState === 'queued' && { color: colors.warning },
                  signalState === 'error' && { color: colors.error },
                ]}
              >
                {signalState === 'ok'
                  ? 'Enviando ubicación en tiempo real (cada 5 s).'
                  : signalState === 'queued'
                  ? `Sin señal — ${pendingLoc} ubicación${pendingLoc === 1 ? '' : 'es'} en cola. Se enviarán al recuperarla.`
                  : 'Sin conexión al servidor. Reintentando…'}
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
            {/* Polyline Google Directions (si hay geometría por calles) */}
            {lineCoords.length >= 2 && (
              <Polyline coordinates={lineCoords} strokeColor={colors.primary} strokeWidth={6} />
            )}
            {/* Polyline directa entre paradas — fallback siempre visible si hay >= 2 stops con coordenadas */}
            {!lineCoords.length && selected?.stops && (() => {
              const sorted = [...selected.stops]
                .sort((a, b) => a.sequence - b.sequence)
                .filter(s => s.client?.latitude != null && s.client?.longitude != null);
              return sorted.length >= 2 ? (
                <Polyline
                  coordinates={sorted.map(s => ({ latitude: s.client.latitude!, longitude: s.client.longitude! }))}
                  strokeColor={colors.primary}
                  strokeWidth={5}
                  lineDashPattern={[10, 6]}
                />
              ) : null;
            })()}
            {/* Marcadores numerados desde geometría */}
            {(geom?.stops || []).map((s) => (
              <Marker
                key={`g-${s.stopId ?? s.sequence}`}
                coordinate={{ latitude: s.lat, longitude: s.lng }}
                title={`${s.sequence}. ${s.name}`}
              >
                <View style={{ backgroundColor: s.sequence === 1 ? colors.success : colors.primary, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{s.sequence}</Text>
                </View>
              </Marker>
            ))}
            {/* Marcadores numerados fallback (sin geometría) */}
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
                  >
                    <View style={{ backgroundColor: st.sequence === 1 ? colors.success : colors.primary, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{st.sequence}</Text>
                    </View>
                  </Marker>
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

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  /* ── Tab bar (dark header) ─────────────────────── */
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1a0a3e',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm + 2,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  tabActive: { backgroundColor: colors.primary },
  tabTxt: { fontSize: font.md, fontWeight: font.bold, color: 'rgba(255,255,255,0.45)' },
  tabTxtActive: { color: colors.textInverse, fontWeight: font.black },
  tabContent: { flex: 1, overflow: 'hidden' },
  tabPage: { flex: 1, backgroundColor: colors.bg },
  tabPageAbsolute: { ...StyleSheet.absoluteFillObject },

  /* ── Recorrido content ─────────────────────────── */
  recorridoContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md + 2 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm + 2 },
  panelTitle: { fontSize: font['2xl'], fontWeight: font.black, color: colors.textPrimary },
  panelSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  outBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  outBtnTxt: { color: colors.textSecondary, fontWeight: font.bold, fontSize: font.md },
  err: { color: colors.error, fontSize: font.sm, marginTop: 6 },

  /* ── Next delivery card ────────────────────────── */
  nextBox: {
    marginTop: spacing.sm + 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.secondaryLight,
    borderWidth: 0,
  },
  nextLabel: { fontSize: font.xs, fontWeight: font.black, color: colors.success, letterSpacing: 0.5 },
  nextAddr: { fontSize: font.base, fontWeight: font.bold, color: colors.secondary, marginTop: spacing.xs },
  nextTap: { fontSize: font.sm, fontWeight: font.extrabold, color: colors.success, marginTop: spacing.sm },
  nextTapHint: { fontSize: font.xs, color: colors.secondary, marginTop: spacing.xs, lineHeight: 14, opacity: 0.9 },

  /* ── Embed nav ─────────────────────────────────── */
  embedNavBtn: {
    marginTop: spacing.sm + 2,
    padding: spacing.md + 2,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    borderWidth: 0,
  },
  embedNavBtnTxt: { fontSize: font.md, fontWeight: font.black, color: colors.primary },
  embedNavBtnSub: { fontSize: font.xs, color: colors.primary, marginTop: spacing.sm, lineHeight: 14 },

  /* ── Stops section ─────────────────────────────── */
  stopsSection: { marginTop: spacing.md + 2 },
  stopsSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stopsSectionTitle: { fontSize: font.sm, fontWeight: font.black, color: colors.textPrimary, letterSpacing: 0.3 },
  stopsSectionHint: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 14, marginBottom: spacing.sm },
  reorderBtn: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.full,
    alignItems: 'center' as const,
    marginBottom: spacing.md,
  },
  reorderBtnTxt: { fontSize: font.lg - 1, fontWeight: font.black, color: colors.textInverse, letterSpacing: 0.3 },
  reorderBanner: { backgroundColor: colors.infoBg, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm, borderWidth: 0 },
  reorderBannerTxt: { fontSize: font.xs, color: colors.primary, fontWeight: font.bold, lineHeight: 14 },

  /* ── Timeline ──────────────────────────────────── */
  tlRow: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  tlLeft: {
    width: 32,
    alignItems: 'center',
  },
  tlDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.timelineDotPending,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    borderWidth: 3,
    borderColor: colors.card,
    ...shadow.sm,
  },
  tlDotDone: { backgroundColor: colors.timelineDotDone },
  tlDotActive: { backgroundColor: colors.timelineDotActive },
  tlDotFailed: { backgroundColor: colors.error },
  tlDotNum: { color: colors.textInverse, fontSize: font.xs, fontWeight: font.black },
  tlDotIcon: { color: colors.textInverse, fontSize: font.sm, fontWeight: font.black },
  tlLine: {
    width: 2.5,
    flex: 1,
    backgroundColor: colors.timelineLine,
    marginVertical: -2,
  },
  tlLineDone: { backgroundColor: colors.timelineDotDone },
  tlContent: {
    flex: 1,
    marginLeft: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    borderWidth: 0,
    padding: spacing.md,
  },
  tlContentActive: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primaryLight,
  },
  tlHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  tlName: { flex: 1, fontSize: font.xl, fontWeight: font.black, color: colors.textPrimary, letterSpacing: 0.2 },
  tlBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 2,
    borderRadius: radius.full,
    marginLeft: spacing.sm,
  },
  tlBadgePending: { backgroundColor: colors.warningBg },
  tlBadgeActive: { backgroundColor: colors.infoBg },
  tlBadgeDone: { backgroundColor: colors.successBg },
  tlBadgeFailed: { backgroundColor: colors.errorBg },
  tlBadgeTxt: { fontSize: font.xs, fontWeight: font.extrabold },
  tlBadgePendingTxt: { color: colors.warning },
  tlBadgeActiveTxt: { color: colors.primary },
  tlBadgeDoneTxt: { color: colors.success },
  tlBadgeFailedTxt: { color: colors.error },
  tlAddr: { fontSize: font.md, color: colors.textSecondary, lineHeight: 20, marginTop: 4 },
  tlZone: { fontSize: font.sm, color: colors.textMuted, marginTop: 3 },
  tlHorario: { fontSize: font.sm, color: colors.primaryContainer, fontWeight: font.bold, marginTop: 4 },
  tlMeta: { fontSize: font.sm, color: colors.textMuted, marginTop: spacing.xs },
  tlDoneInfo: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  tlDoneOk: { fontSize: font.sm, fontWeight: font.extrabold, color: colors.success },
  tlObs: { fontSize: font.sm, color: colors.textSecondary, marginTop: 3 },
  tlPhotoHint: { fontSize: font.xs, color: colors.primary, marginTop: 3, fontWeight: font.bold },
  tlFailReason: { fontSize: font.sm, fontWeight: font.extrabold, color: colors.error },
  tlBtnArr: {
    marginTop: spacing.sm + 2,
    backgroundColor: colors.success,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  tlBtnArrTxt: { color: colors.textInverse, fontWeight: font.black, fontSize: font.md },
  tlBtnOut: {
    marginTop: spacing.sm + 2,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  tlBtnOutTxt: { color: colors.textInverse, fontWeight: font.black, fontSize: font.md },
  tlBtnOutSub: { color: 'rgba(255,255,255,0.8)', fontSize: 9, marginTop: 3, textAlign: 'center' },

  /* ── Toast / offline / misc ────────────────────── */
  toastBanner: { backgroundColor: colors.infoBg, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm, borderWidth: 0 },
  toastTxt: { fontSize: font.sm, color: colors.primary, fontWeight: font.extrabold, textAlign: 'center' },
  iconBtn: { padding: spacing.sm, marginLeft: 2 },
  iconBtnTxt: { fontSize: 20 },

  /* ── Stats panel ───────────────────────────────── */
  statsPanel: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    borderWidth: 0,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm + 2,
    ...shadow.sm,
  },
  statsPanelRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.sm },
  statsPanelItem: { backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5, alignItems: 'center', minWidth: 50 },
  statsPanelItemGreen: { backgroundColor: colors.successBg },
  statsPanelItemRed: { backgroundColor: colors.errorBg },
  statsPanelVal: { fontSize: font.lg - 1, fontWeight: font.black, color: colors.textPrimary },
  statsPanelLbl: { fontSize: 8, color: colors.textMuted, fontWeight: font.bold, marginTop: 1 },
  statsPanelBar: { height: 5, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  statsPanelBarFill: { height: 5, backgroundColor: colors.primary, borderRadius: 3 },
  stopSearchInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.sm,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    borderWidth: 0,
  },

  /* ── Misc controls ─────────────────────────────── */
  hint: { color: colors.textSecondary, fontSize: font.base, marginVertical: 6 },
  routeCards: { marginTop: spacing.sm + 2, gap: spacing.sm },
  routeCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
    ...shadow.sm,
  },
  routeCardOn: {
    backgroundColor: colors.primary,
  },
  routeCardTitle: {
    fontWeight: font.black,
    color: colors.textPrimary,
    fontSize: font.xl,
    letterSpacing: 0.2,
  },
  routeCardTitleOn: { color: colors.textInverse },
  routeCardBadge: {
    marginTop: 6,
    fontSize: font.xs,
    fontWeight: font.extrabold,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  mini: { fontSize: font.sm, color: colors.textMuted, marginTop: 6 },

  /* ── Fichar entrada/salida ─────────────────────── */
  ficharEntrada: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.xl + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    ...shadow.md,
  },
  ficharEntradaTxt: { fontWeight: font.black, color: colors.textInverse, fontSize: font['2xl'] + 2, letterSpacing: 0.5 },
  ficharSalida: {
    marginTop: spacing.md,
    backgroundColor: '#991b1b',
    paddingVertical: spacing.xl + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    ...shadow.md,
  },
  ficharSalidaTxt: { fontWeight: font.black, color: colors.textInverse, fontSize: font['2xl'] + 2, letterSpacing: 0.5 },

  /* ── Offline / incident ────────────────────────── */
  offlineBanner: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.sm + 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm + 2,
    borderWidth: 0,
  },
  offlineTxt: { fontSize: font.sm, fontWeight: font.bold, color: colors.warning, textAlign: 'center' },
  incidentBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.accentLight,
    borderWidth: 0,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  incidentBtnTxt: { fontSize: font.md, fontWeight: font.extrabold, color: colors.accentHover },

  /* ── Refresh / live ────────────────────────────── */
  refreshFull: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  refreshTxt: { fontWeight: font.extrabold, color: colors.textSecondary },
  live: {
    fontSize: font.sm,
    fontWeight: font.bold,
    color: colors.success,
    flex: 1,
  },

  /* ── Navigation box ────────────────────────────── */
  navBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 0,
  },
  navTitle: { fontSize: font.sm, fontWeight: font.black, color: colors.textSecondary, letterSpacing: 0.4 },
  navBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  navBtnDisabled: { opacity: 0.75 },
  navBtnTxt: { fontWeight: font.extrabold, color: colors.textInverse, fontSize: font.base, textAlign: 'center' },
  navErr: { color: colors.error, fontSize: font.sm, marginTop: spacing.sm },
  navMini: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.sm },
  navSummary: { fontSize: font.base, fontWeight: font.extrabold, color: colors.textPrimary, marginTop: spacing.sm },
  navSteps: { marginTop: spacing.sm },
  navStep: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm + 2, gap: spacing.sm + 2 },
  navStepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: colors.primaryLight,
    color: colors.primary,
    fontSize: font.sm,
    fontWeight: font.black,
    textAlign: 'center',
    lineHeight: 22,
  },
  navStepBody: { flex: 1 },
  navStepInstr: { fontSize: font.base, fontWeight: font.semibold, color: colors.textPrimary, lineHeight: 18 },
  navStepMeta: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  navHint: { fontSize: font.xs, color: colors.textMuted, marginTop: spacing.sm + 2, lineHeight: 14 },

  /* ── Live row ──────────────────────────────────── */
  liveRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm + 2, gap: 6 },
  connectionDot: { width: 10, height: 10, borderRadius: 5 },
  connectionDotOk: { backgroundColor: colors.success },
  connectionDotWarn: { backgroundColor: colors.warning },
  connectionDotErr: { backgroundColor: colors.error },
});
