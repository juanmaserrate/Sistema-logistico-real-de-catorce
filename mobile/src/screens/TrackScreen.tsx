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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { StatusBar } from 'expo-status-bar';

// La pestaña "Mapa" fue dada de baja (jul-2026, pedido del usuario): los
// choferes usan solo el listado de paradas; el mapa con trazado no se usaba
// y consumía geometría del servidor. react-native-maps ya no se importa acá.
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SessionUser, Route, Stop } from '../types';
import {
  fetchRoutesToday,
  postTrackingLocation,
  patchStop,
  patchRouteRecorrido,
  deactivateDevice,
  flushStopQueue,
  flushIncidentQueue,
  flushPhotoQueue,
  getPendingStopCount,
  getPendingLocationCount,
  pingServer,
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

/** Un viaje esta concluido si la ruta tiene fin real o el trip esta en estado
 *  final. Los concluidos DE HOY se siguen mostrando (solo consulta): antes se
 *  le "desaparecia la ruta" al chofer apenas el viaje se finalizaba. */
function isConcluded(r: Route): boolean {
  if (r.actualEndTime) return true;
  const ts = (r.trip?.status || '').toUpperCase();
  return ts === 'COMPLETED' || ts === 'RETURNED';
}

export default function TrackScreen({ session, onLogout, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tracking, setTracking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
  /** Viaje seleccionado ya concluido: se ve todo, pero sin botones de acción. */
  const selConcluded = selected ? isConcluded(selected) : false;

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

  const loadRoutes = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setErr('');
      setLoading(true);
    }
    try {
      const fullList = await fetchRoutesToday(session.id);
      // Los viajes concluidos de HOY se muestran al final como "Viaje concluido"
      // (solo consulta). Los dias anteriores no llegan aca (filtro de fecha).
      const list = [...fullList].sort((a, b) => Number(isConcluded(a)) - Number(isConcluded(b)));
      setRoutes(list);
      setSelId((prev) => {
        if (list.length === 0) return null;
        if (prev != null && list.some((r) => r.id === prev)) return prev;
        const firstActive = list.find((r) => !isConcluded(r));
        return (firstActive ?? list[0]).id;
      });
      // Exito: limpiar cualquier error previo (corta el auto-retry y saca el
      // cartel rojo). Incluso en modo silent, porque el auto-recovery llama
      // silent y necesita que el error desaparezca cuando la red vuelve.
      setErr('');
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

  /** Auto-recuperación: si la carga de rutas falló (red lenta a la mañana,
   *  hora pico), reintentar SOLO en background cada 8s hasta que funcione.
   *  Antes el chofer quedaba con "Sin conexión... Reintentando" sin que la
   *  app reintentara de verdad — tenía que recargar a mano. Ahora se
   *  recupera sola en cuanto la red se estabiliza. */
  useEffect(() => {
    if (!err) return; // solo cuando hay error de carga
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      loadRoutes({ silent: true }); // silent: no parpadea el spinner grande
    }, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [err, loadRoutes]);

  /** Monitor de conectividad: flush de colas offline. */
  useEffect(() => {
    // Detectamos conectividad haciendo ping al servidor cada 5s.
    // FIX (jun-2026): el timeout era 5s y declarabamos "sin senial" tras UN
    // solo ping fallido. El server responde ~1.8s en buenas condiciones, pero
    // con 4G normal puede demorar mas — el ping abortaba y el chofer veia
    // "Sin senial" con LTE pleno. Ahora:
    //  - Timeout 10s (no 5s) -> margen para conexiones reales lentas.
    //  - Hacen falta 2 pings fallidos CONSECUTIVOS para declarar offline.
    //  - 1 ping OK basta para volver a "online".
    // La cola offline sigue tirando flush si hay items y estamos online —
    // eso no cambia.
    let cancelled = false;
    let consecutiveFails = 0;
    let inFlight = false; // evita ticks solapados (ping 10s > intervalo 5s)
    const FAILS_FOR_OFFLINE = 2;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await tickBody();
      } finally {
        inFlight = false;
      }
    };
    const tickBody = async () => {
      const pending = await getPendingStopCount();
      if (cancelled) return;
      setPendingOffline(pending);
      const latency = await pingServer(10000); // antes 5000
      if (cancelled) return;
      if (latency != null) {
        consecutiveFails = 0;
        setIsOnline(true);
      } else {
        consecutiveFails++;
        if (consecutiveFails >= FAILS_FOR_OFFLINE) setIsOnline(false);
      }
      // Flushear: si tuvimos UN ping OK (latency!=null), hay senial real.
      if (latency != null && pending > 0) {
        try {
          const sent = await flushStopQueue();
          await flushIncidentQueue();
          await flushPhotoQueue();
          const after = await getPendingStopCount();
          if (!cancelled) setPendingOffline(after);
          if (sent > 0) console.log(`[Sync] Flush OK: ${sent} stops enviados, ${after} restantes`);
        } catch (e) {
          console.warn('[Sync] flush error:', e);
        }
      }
    };
    void tick();
    const poll = setInterval(() => { void tick(); }, 5000);
    return () => { cancelled = true; clearInterval(poll); };
  }, []);

  /** Al volver del escritorio / otra app: misma ruta que editó logística en la web. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        loadRoutes({ silent: true });
        flushStopQueue().then((n) => { if (n > 0) getPendingStopCount().then(setPendingOffline); });
        flushIncidentQueue().catch(() => {});
        flushPhotoQueue().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [loadRoutes]);

  /** Socket.IO: escuchar cambios de ruta en tiempo real desde planificación. */
  useEffect(() => {
    if (!API_BASE) return;
    let socket: any;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { io } = require('socket.io-client');
      const base = API_BASE.replace(/\/api\/v1\/?$/, '');
      // Reconexion INFINITA con backoff (antes: 5 intentos y el socket moria
      // para siempre — tras un corte de ~10s el chofer dejaba de recibir
      // cambios de ruta hasta reabrir la app).
      socket = io(base, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
      });
      socketRef.current = socket;
      socket.on('connect', () => {
        socket.emit('join:driver', session.id);
      });
      socket.on('route:updated', () => {
        loadRoutes({ silent: true });
        setRouteChangedToast(true);
        // Cancelar el timer anterior si todavía estaba pendiente — evita memory leak y warnings
        // de "setState en componente desmontado" cuando el chofer cambia de pantalla.
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => setRouteChangedToast(false), 3500);
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
      // FORCE REFRESH desde la web admin: limpia el cache local y vuelve a pedir
      // todo fresco al server. Solo actua si el driverId del evento coincide con el
      // de esta sesion (o si el evento no trae driverId = es broadcast general).
      socket.on('cache:invalidate', (payload: any) => {
        const targetDriverId = payload?.driverId;
        if (targetDriverId && targetDriverId !== session.id) return;
        (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const AsyncStorage = require('@react-native-async-storage/async-storage').default;
            await AsyncStorage.removeItem('r14_routes_today_cache');
          } catch { /* */ }
          loadRoutes({ silent: true });
        })();
      });
    } catch {
      /* socket.io-client no disponible en este build */
    }
    return () => {
      if (toastTimer) clearTimeout(toastTimer);
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

  useEffect(() => {
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

  // Fichar entrada: solo activa el seguimiento GPS. Ya NO requiere tener una ruta
  // seleccionada — el chofer puede arrancar el tracking aunque todavía no haya
  // mirado los viajes. Si tiene una ruta seleccionada, los pings GPS se asocian
  // a esa ruta para el mapa de Torre de Control. Si no, los pings se mandan sin
  // routeId (siguen sirviendo para ver al chofer en el mapa por su deviceLabel).
  const startTracking = () => {
    void doStartTracking();
  };

  const doStartTracking = async () => {
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
    const routeForPing = selId; // puede ser null — está permitido
    await setActiveRouteId(routeForPing);
    await sendOnePing(routeForPing);
    // El start sobre /routes/:id/recorrido sigue mandándose si hay ruta seleccionada,
    // pero ya NO afecta el cierre/finalización del viaje (eso es solo del operador).
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

  // Fichar salida: solo apaga el seguimiento GPS. NO cierra el viaje. El chofer
  // sigue viendo la lista de paradas y puede continuar registrando entregas si
  // hay otra ruta para hoy. El viaje solo se finaliza cuando el operador aprieta
  // "Finalizar" desde la web.
  const stopTracking = async () => {
    if (selId != null) {
      // Notificación al backend (no cierra el viaje, solo registra el evento)
      await patchRouteRecorrido(selId, session.id, 'end').catch(() => {});
    }
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch {
      /* */
    }
    if (deviceIdRef.current) {
      await deactivateDevice(deviceIdRef.current);
    }
    await setActiveRouteId(null);
    setTracking(false);
  };

  // Cambiar de viaje: si el chofer está trackeando, el GPS sigue activo y los
  // próximos pings se asocian a la nueva ruta seleccionada — no hay que detener
  // ni re-fichar. También intentamos disparar 'start' silencioso por si la ruta
  // nueva todavía no estaba registrada como iniciada en el backend.
  const onChangeRoute = async (id: number) => {
    setSelId(id);
    if (tracking) {
      await setActiveRouteId(id);
      // Best-effort: marcar la nueva ruta como iniciada (silencioso si ya estaba)
      void patchRouteRecorrido(id, session.id, 'start').catch(() => {});
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {/* Barra superior (la pestaña "Mapa" fue dada de baja) */}
      <View style={[styles.tabBar, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
        <View style={[styles.tab, styles.tabActive]}>
          <Text style={[styles.tabTxt, styles.tabTxtActive]}>Mi Recorrido</Text>
        </View>
      </View>

      <View style={styles.tabContent}>
        {/* Vista: Mi Recorrido (pantalla completa) */}
        <View style={styles.tabPage}>
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
                const concluded = isConcluded(r);
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
          {selected && routeStopsSorted.length > 0 ? (
            <View style={styles.stopsSection}>
              <View style={styles.stopsSectionHeader}>
                <Text style={styles.stopsSectionTitle}>Paradas del recorrido</Text>
              </View>
              {selConcluded ? (
                <View style={styles.concludedBanner}>
                  <Text style={styles.concludedBannerTxt}>
                    ✓ Viaje concluido — solo consulta. Tus entregas del día quedan a la vista hasta mañana.
                  </Text>
                </View>
              ) : null}
              {hasPendingStops && !selConcluded ? (
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
                    {st.status === 'PENDING' && !selConcluded ? (
                      <Pressable style={styles.tlBtnArr} onPress={() => onMarkArrival(st)}>
                        <Text style={styles.tlBtnArrTxt}>Registrar llegada</Text>
                      </Pressable>
                    ) : null}
                    {isActive && !selConcluded ? (
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
        </View>
      </View>

      <StopDeliveryModal
        visible={deliveryModalStop != null}
        stop={deliveryModalStop}
        onClose={() => setDeliveryModalStop(null)}
        onSaved={() => {
          const completedStop = deliveryModalStop;
          // OPTIMISTIC UPDATE: actualizar el state local del stop ANTES del refresh.
          // Antes el chofer veia "Finalizar entrega" persistir hasta que llegara el
          // refresh del server (que a veces no actualizaba bien por el cache).
          // Ahora marcamos el stop como COMPLETED al instante y despues confirmamos
          // con el server.
          if (completedStop && selId != null) {
            setRoutes((prev) => prev.map((r) => {
              if (r.id !== selId) return r;
              return {
                ...r,
                stops: r.stops.map((s) =>
                  s.id === completedStop.id
                    ? { ...s, status: 'COMPLETED', actualDeparture: new Date().toISOString() }
                    : s
                )
              };
            }));
          }
          setDeliveryModalStop(null);
          // Refrescar del server. El cartel "Siguiente parada" fue removido a pedido del usuario.
          (async () => {
            try {
              const fullFresh = await fetchRoutesToday(session.id);
              const freshList = [...fullFresh].sort((a, b) => Number(isConcluded(a)) - Number(isConcluded(b)));
              setRoutes(freshList);
            } catch {
              // Si la red falla, mantenemos el optimistic update
              loadRoutes({ silent: true }).catch(() => {});
            }
          })();
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
  concludedBanner: { backgroundColor: '#ecfdf5', borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm },
  concludedBannerTxt: { fontSize: font.xs, color: '#006d43', fontWeight: font.bold, lineHeight: 15 },

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
