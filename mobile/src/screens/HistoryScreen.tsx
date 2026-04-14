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
import { colors, font, radius, spacing, shadow } from '../theme';

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
              <Text style={styles.emptyTxt}>Todavía no tenés rutas completadas</Text>
              <Text style={[styles.emptyTxt, { marginTop: 4, fontSize: font.sm }]}>Acá vas a ver tu historial de los últimos 30 días</Text>
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
  screen: { flex: 1, backgroundColor: colors.surfaceContainerLow },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    gap: spacing.md,
  },
  backBtn: { padding: spacing.sm },
  backTxt: { fontSize: font.md, fontWeight: font.extrabold, color: colors.primary },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: font.xl, fontWeight: font.black, color: colors.textPrimary },
  headerSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing['2xl'] },
  errTxt: { color: colors.error, fontSize: font.md, fontWeight: font.bold, textAlign: 'center', marginBottom: spacing.md },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.full },
  retryTxt: { color: colors.textInverse, fontWeight: font.extrabold },
  list: { padding: spacing.lg, gap: spacing.md },
  empty: { paddingTop: 60, alignItems: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyTxt: { fontSize: font.md, color: colors.textSecondary, fontWeight: font.semibold },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    borderWidth: 0,
    padding: spacing.md + 2,
    ...shadow.sm,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  cardLeft: { flex: 1 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardDate: { fontSize: font.md, fontWeight: font.black, color: colors.textPrimary, textTransform: 'capitalize' },
  cardVehicle: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2, fontWeight: font.bold },
  cardPct: { fontSize: font.lg, fontWeight: font.black, color: colors.primary },
  cardExpand: { fontSize: font.sm + 1, color: colors.textMuted },
  progressBar: { height: 6, backgroundColor: colors.surfaceContainerLow, borderRadius: 3, marginBottom: spacing.md, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  statsRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.sm },
  statItem: { backgroundColor: colors.surfaceContainerLow, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center', minWidth: 60 },
  statItemGreen: { backgroundColor: colors.successBg },
  statItemRed: { backgroundColor: colors.errorBg },
  statItemAmber: { backgroundColor: colors.warningBg },
  statVal: { fontSize: font.lg, fontWeight: font.black, color: colors.textPrimary },
  statValGreen: { color: colors.success },
  statValRed: { color: colors.error },
  statValAmber: { color: colors.warning },
  statLbl: { fontSize: 9, color: colors.textMuted, fontWeight: font.bold, marginTop: 1 },
  timesRow: { marginTop: spacing.xs },
  timesTxt: { fontSize: font.sm, color: colors.textSecondary, fontWeight: font.semibold },
  reorderNote: { fontSize: font.xs, color: colors.info, marginTop: 3, fontWeight: font.bold },
  stopsList: { marginTop: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stopDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.surfaceContainerHighest, marginTop: 4, flexShrink: 0 },
  stopDotGreen: { backgroundColor: colors.success },
  stopDotRed: { backgroundColor: colors.error },
  stopRowInfo: { flex: 1 },
  stopRowName: { fontSize: font.base, fontWeight: font.bold, color: colors.textPrimary },
  stopRowAddr: { fontSize: font.sm, color: colors.textSecondary, marginTop: 1 },
  stopRowTime: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
});
