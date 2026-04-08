import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { SessionUser, Route, Stop } from '../types';
import { fetchRouteHistory } from '../api';

type Props = {
  session: SessionUser;
  navigation: NativeStackNavigationProp<RootStackParamList, 'History'>;
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function avgMinutes(stops: Stop[]): number | null {
  const times = stops
    .filter((s) => s.actualArrival && s.actualDeparture)
    .map((s) => (new Date(s.actualDeparture!).getTime() - new Date(s.actualArrival!).getTime()) / 60000);
  if (!times.length) return null;
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
}

export default function HistoryScreen({ session, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setErr(''); }
    try {
      const today = new Date().toISOString().slice(0, 10);
      const all = await fetchRouteHistory(session.id, 30);
      // Exclude today (TrackScreen muestra el día actual)
      const past = all.filter((r) => r.date.slice(0, 10) < today);
      setRoutes(past);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al cargar historial');
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  return (
    <View style={[styles.screen, { paddingTop: Math.max(16, insets.top) }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backTxt}>← Volver</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Historial</Text>
          <Text style={styles.headerSub}>Últimos 30 días</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : err ? (
        <View style={styles.center}>
          <Text style={styles.errTxt}>{err}</Text>
          <Pressable style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryTxt}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4f46e5']} tintColor="#4f46e5" />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {routes.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTxt}>Sin rutas en los últimos 30 días</Text>
            </View>
          ) : (
            routes.map((route) => {
              const completed = route.stops.filter((s) => s.status === 'COMPLETED').length;
              const undeliverable = route.stops.filter((s) => s.status === 'UNDELIVERABLE').length;
              const pending = route.stops.filter((s) => s.status === 'PENDING' || s.status === 'ARRIVED').length;
              const total = route.stops.length;
              const avg = avgMinutes(route.stops);
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
              const expanded = expandedId === route.id;

              return (
                <Pressable
                  key={route.id}
                  style={styles.card}
                  onPress={() => setExpandedId(expanded ? null : route.id)}
                >
                  {/* Card header */}
                  <View style={styles.cardTop}>
                    <View style={styles.cardLeft}>
                      <Text style={styles.cardDate}>{fmtDate(route.date)}</Text>
                      {route.vehicle?.plate ? (
                        <Text style={styles.cardVehicle}>🚛 {route.vehicle.plate}</Text>
                      ) : null}
                    </View>
                    <View style={styles.cardRight}>
                      <Text style={styles.cardPct}>{pct}%</Text>
                      <Text style={styles.cardExpand}>{expanded ? '▲' : '▼'}</Text>
                    </View>
                  </View>

                  {/* Progress bar */}
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
                  </View>

                  {/* Stats row */}
                  <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                      <Text style={styles.statVal}>{total}</Text>
                      <Text style={styles.statLbl}>Total</Text>
                    </View>
                    <View style={[styles.statItem, styles.statItemGreen]}>
                      <Text style={[styles.statVal, styles.statValGreen]}>{completed}</Text>
                      <Text style={styles.statLbl}>Entregadas</Text>
                    </View>
                    {undeliverable > 0 ? (
                      <View style={[styles.statItem, styles.statItemRed]}>
                        <Text style={[styles.statVal, styles.statValRed]}>{undeliverable}</Text>
                        <Text style={styles.statLbl}>No entregadas</Text>
                      </View>
                    ) : null}
                    {pending > 0 ? (
                      <View style={[styles.statItem, styles.statItemAmber]}>
                        <Text style={[styles.statVal, styles.statValAmber]}>{pending}</Text>
                        <Text style={styles.statLbl}>Pendientes</Text>
                      </View>
                    ) : null}
                    {avg !== null ? (
                      <View style={styles.statItem}>
                        <Text style={styles.statVal}>{avg}m</Text>
                        <Text style={styles.statLbl}>Prom/parada</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Horarios inicio/fin */}
                  <View style={styles.timesRow}>
                    <Text style={styles.timesTxt}>
                      Inicio: {fmtTime(route.actualStartTime)} · Fin: {fmtTime(route.actualEndTime)}
                    </Text>
                    {route.reorderReason ? (
                      <Text style={styles.reorderNote}>🔀 {route.reorderReason}</Text>
                    ) : null}
                  </View>

                  {/* Detalle de paradas (expandido) */}
                  {expanded ? (
                    <View style={styles.stopsList}>
                      {[...route.stops]
                        .sort((a, b) => a.sequence - b.sequence)
                        .map((st) => (
                          <View key={st.id} style={styles.stopRow}>
                            <View style={[
                              styles.stopDot,
                              st.status === 'COMPLETED' && styles.stopDotGreen,
                              st.status === 'UNDELIVERABLE' && styles.stopDotRed,
                            ]} />
                            <View style={styles.stopRowInfo}>
                              <Text style={styles.stopRowName} numberOfLines={1}>
                                {st.sequence}. {st.client?.name || 'Cliente'}
                              </Text>
                              {st.client?.address ? (
                                <Text style={styles.stopRowAddr} numberOfLines={1}>{st.client.address}</Text>
                              ) : null}
                              <Text style={styles.stopRowTime}>
                                {fmtTime(st.actualArrival)} → {fmtTime(st.actualDeparture)}
                                {st.observations ? ` · ${st.observations}` : ''}
                              </Text>
                            </View>
                          </View>
                        ))}
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
    gap: 10,
  },
  backBtn: { padding: 6 },
  backTxt: { fontSize: 14, fontWeight: '800', color: '#4f46e5' },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  headerSub: { fontSize: 11, color: '#64748b', marginTop: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errTxt: { color: '#b91c1c', fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  retryBtn: { backgroundColor: '#4f46e5', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryTxt: { color: '#fff', fontWeight: '800' },
  list: { padding: 16, gap: 12 },
  empty: { paddingTop: 60, alignItems: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardLeft: { flex: 1 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardDate: { fontSize: 14, fontWeight: '900', color: '#0f172a', textTransform: 'capitalize' },
  cardVehicle: { fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: '700' },
  cardPct: { fontSize: 16, fontWeight: '900', color: '#4f46e5' },
  cardExpand: { fontSize: 12, color: '#94a3b8' },
  progressBar: { height: 6, backgroundColor: '#e2e8f0', borderRadius: 3, marginBottom: 10, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: '#4f46e5', borderRadius: 3 },
  statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  statItem: { backgroundColor: '#f8fafc', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, alignItems: 'center', minWidth: 60 },
  statItemGreen: { backgroundColor: '#f0fdf4' },
  statItemRed: { backgroundColor: '#fff1f2' },
  statItemAmber: { backgroundColor: '#fffbeb' },
  statVal: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
  statValGreen: { color: '#16a34a' },
  statValRed: { color: '#e11d48' },
  statValAmber: { color: '#d97706' },
  statLbl: { fontSize: 9, color: '#94a3b8', fontWeight: '700', marginTop: 1 },
  timesRow: { marginTop: 4 },
  timesTxt: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  reorderNote: { fontSize: 10, color: '#1d4ed8', marginTop: 3, fontWeight: '700' },
  stopsList: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10, gap: 8 },
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stopDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#cbd5e1', marginTop: 4, flexShrink: 0 },
  stopDotGreen: { backgroundColor: '#16a34a' },
  stopDotRed: { backgroundColor: '#e11d48' },
  stopRowInfo: { flex: 1 },
  stopRowName: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  stopRowAddr: { fontSize: 11, color: '#64748b', marginTop: 1 },
  stopRowTime: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
});
