import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import type { Stop } from '../types';
import { reorderRouteStops } from '../api';

type Props = {
  visible: boolean;
  routeId: number;
  stops: Stop[];
  driverName: string;
  onClose: () => void;
  onSaved: () => void;
};

const JUSTIFY_OPTIONS = [
  { code: 'obras_calle', label: '🚧 Obras / calle cortada' },
  { code: 'menor_trafico', label: '🚦 Menor tráfico en otra ruta' },
  { code: 'optimizacion_propia', label: '🗺️ Conozco mejor la zona' },
  { code: 'cliente_horario', label: '🕐 Cliente pidió cambio de horario' },
];

export default function ReorderModal({ visible, routeId, stops, driverName, onClose, onSaved }: Props) {
  const [orderedStops, setOrderedStops] = useState<Stop[]>([]);
  const [step, setStep] = useState<'reorder' | 'justify'>('reorder');
  const [justification, setJustification] = useState<string>('');
  const [customReason, setCustomReason] = useState('');
  const [saving, setSaving] = useState(false);

  // M3 fix: useMemo para que `pendingStops` mantenga su referencia entre renders.
  // Antes se recreaba en CADA render -> el useEffect que depende de `stops` y la
  // comparación `hasChanged` daban resultados inconsistentes y el orden que el
  // chofer arrastraba se perdía cuando llegaba un refresh externo de routes.
  const pendingStops = React.useMemo(
    // Pendientes y pospuestas (RETRY). La vuelta al depósito queda afuera: si
    // se moviera antes de una escuela, el viaje se cerraría antes de tiempo.
    () => stops.filter((s) => (s.status === 'PENDING' || s.status === 'RETRY') && !s.isReturnToBase),
    [stops]
  );
  // Snapshot inicial — se usa como "orden original" para la comparación y NO se
  // reescribe cuando llega un refresh de stops mientras el chofer está reordenando.
  const initialOrderRef = React.useRef<Stop[]>([]);

  useEffect(() => {
    // Solo reseteamos al ABRIR (transición !visible -> visible). Si visible ya está
    // true y solo cambia `stops` por un refresh de fondo, conservamos el orden actual.
    if (visible) {
      const sorted = [...pendingStops].sort((a, b) => a.sequence - b.sequence);
      initialOrderRef.current = sorted;
      setOrderedStops(sorted);
      setStep('reorder');
      setJustification('');
      setCustomReason('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const hasChanged = useCallback(() => {
    const base = initialOrderRef.current;
    if (orderedStops.length !== base.length) return true;
    return orderedStops.some((s, i) => s?.id !== base[i]?.id);
  }, [orderedStops]);

  const goToJustify = () => {
    if (!hasChanged()) {
      Alert.alert('Sin cambios', 'No modificaste el orden de las paradas.');
      return;
    }
    setStep('justify');
  };

  const confirm = useCallback(async () => {
    const finalJustification = justification === 'otro'
      ? customReason.trim() || 'Otro'
      : JUSTIFY_OPTIONS.find((o) => o.code === justification)?.label || justification;

    if (!finalJustification) {
      Alert.alert('Motivo requerido', 'Seleccioná un motivo para el cambio de orden.');
      return;
    }

    setSaving(true);
    try {
      const minSeq = Math.min(...pendingStops.map((s) => s.sequence));
      const newOrder = orderedStops.map((s, i) => ({
        stopId: s.id,
        sequence: minSeq + i,
      }));

      await reorderRouteStops(routeId, newOrder, finalJustification, driverName);
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar el nuevo orden');
    } finally {
      setSaving(false);
    }
  }, [customReason, driverName, justification, onClose, onSaved, orderedStops, pendingStops, routeId]);

  /** Mover una parada una posición arriba (-1) o abajo (+1).
   *  Reemplaza el arrastre: react-native-draggable-flatlist 4.0.3 no es
   *  compatible con Reanimated 4 — numeraba mal (2,3,4,4,5…) y se trababa. */
  const move = useCallback((index: number, delta: -1 | 1) => {
    setOrderedStops((prev) => {
      const to = index + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }, []);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          {step === 'reorder' ? (
            <>
              <Text style={styles.title}>Reordenar paradas</Text>
              <Text style={styles.hint}>
                Usá ▲ ▼ para subir o bajar cada parada.
              </Text>
              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                {orderedStops.map((item, idx) => {
                  const movida = initialOrderRef.current[idx]?.id !== item.id;
                  return (
                    <View key={item.id} style={[styles.stopRow, movida && styles.stopRowActive]}>
                      <View style={styles.seqBadge}>
                        <Text style={styles.seqTxt}>{idx + 1}</Text>
                      </View>
                      <View style={styles.stopInfo}>
                        <Text style={styles.stopName} numberOfLines={1}>
                          {item.client?.name || `Parada ${item.sequence}`}
                        </Text>
                        {item.client?.address ? (
                          <Text style={styles.stopAddr} numberOfLines={1}>
                            {item.client.address}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        style={[styles.arrowBtn, idx === 0 && styles.arrowBtnOff]}
                        onPress={() => move(idx, -1)}
                        disabled={idx === 0}
                        hitSlop={4}
                        accessibilityLabel={`Subir ${item.client?.name || 'parada'}`}
                      >
                        <Text style={styles.arrowTxt}>▲</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.arrowBtn, idx === orderedStops.length - 1 && styles.arrowBtnOff]}
                        onPress={() => move(idx, 1)}
                        disabled={idx === orderedStops.length - 1}
                        hitSlop={4}
                        accessibilityLabel={`Bajar ${item.client?.name || 'parada'}`}
                      >
                        <Text style={styles.arrowTxt}>▼</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
              <View style={styles.actions}>
                <Pressable style={styles.cancelBtn} onPress={onClose}>
                  <Text style={styles.cancelTxt}>Cancelar</Text>
                </Pressable>
                <Pressable style={styles.nextBtn} onPress={goToJustify}>
                  <Text style={styles.nextTxt}>Siguiente</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>¿Por qué cambiás el orden?</Text>
              <Text style={styles.hint}>
                Esta información ayuda al operador a entender tus decisiones de ruta.
              </Text>
              <View>
                {JUSTIFY_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.code}
                    style={[styles.optRow, justification === opt.code && styles.optRowOn]}
                    onPress={() => setJustification(opt.code)}
                  >
                    <View style={[styles.radio, justification === opt.code && styles.radioOn]}>
                      {justification === opt.code ? <View style={styles.radioFill} /> : null}
                    </View>
                    <Text style={[styles.optTxt, justification === opt.code && styles.optTxtOn]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  style={[styles.optRow, justification === 'otro' && styles.optRowOn]}
                  onPress={() => setJustification('otro')}
                >
                  <View style={[styles.radio, justification === 'otro' && styles.radioOn]}>
                    {justification === 'otro' ? <View style={styles.radioFill} /> : null}
                  </View>
                  <Text style={[styles.optTxt, justification === 'otro' && styles.optTxtOn]}>
                    ✏️ Otro motivo
                  </Text>
                </Pressable>
                {justification === 'otro' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Describí el motivo..."
                    placeholderTextColor="#94a3b8"
                    value={customReason}
                    onChangeText={setCustomReason}
                    multiline
                    autoFocus
                  />
                ) : null}
              </View>
              <View style={styles.actions}>
                <Pressable style={styles.cancelBtn} onPress={() => setStep('reorder')}>
                  <Text style={styles.cancelTxt}>Volver</Text>
                </Pressable>
                <Pressable
                  style={[styles.confirmBtn, saving && styles.disabledBtn]}
                  onPress={() => void confirm()}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.confirmTxt}>Confirmar cambio</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,10,62,0.6)' },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    maxHeight: '88%',
    borderWidth: 0,
  },
  title: { fontSize: 20, fontWeight: '900', color: '#191c1e', marginBottom: 4 },
  hint: { fontSize: 13, color: '#74777b', lineHeight: 18, marginBottom: 16 },
  list: { maxHeight: 420 },
  arrowBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#451ebb', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  arrowBtnOff: { backgroundColor: '#dfe1e4' },
  arrowTxt: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 0,
    padding: 12,
    marginBottom: 8,
  },
  stopRowActive: {
    backgroundColor: '#ede9fe',
    elevation: 8,
    shadowColor: '#451ebb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  seqBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#451ebb',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  seqTxt: { color: '#fff', fontWeight: '900', fontSize: 14 },
  stopInfo: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: '800', color: '#191c1e' },
  stopAddr: { fontSize: 12, color: '#74777b', marginTop: 2 },
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 0,
    backgroundColor: '#f2f3f6',
    marginBottom: 8,
  },
  optRowOn: { backgroundColor: '#ede9fe' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#dfe1e4',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: '#451ebb' },
  radioFill: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#451ebb' },
  optTxt: { fontSize: 15, color: '#44474a', fontWeight: '600' },
  optTxtOn: { color: '#451ebb', fontWeight: '800' },
  input: {
    borderWidth: 0,
    borderRadius: 16,
    padding: 14,
    textAlignVertical: 'top',
    color: '#191c1e',
    fontSize: 14,
    minHeight: 80,
    marginBottom: 10,
    backgroundColor: '#f2f3f6',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 9999,
    backgroundColor: '#f2f3f6',
    alignItems: 'center',
    borderWidth: 0,
  },
  cancelTxt: { fontWeight: '800', fontSize: 15, color: '#44474a' },
  nextBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 9999,
    backgroundColor: '#191c1e',
    alignItems: 'center',
    borderWidth: 0,
  },
  nextTxt: { fontWeight: '900', fontSize: 15, color: '#fff' },
  confirmBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 9999,
    backgroundColor: '#451ebb',
    alignItems: 'center',
    borderWidth: 0,
  },
  confirmTxt: { fontWeight: '900', fontSize: 15, color: '#fff' },
  disabledBtn: { opacity: 0.7 },
});
