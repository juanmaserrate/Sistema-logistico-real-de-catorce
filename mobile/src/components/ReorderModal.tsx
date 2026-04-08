import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
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

  // Solo paradas PENDING
  const pendingStops = stops.filter((s) => s.status === 'PENDING');

  useEffect(() => {
    if (visible) {
      setOrderedStops([...pendingStops].sort((a, b) => a.sequence - b.sequence));
      setStep('reorder');
      setJustification('');
      setCustomReason('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const moveUp = useCallback((index: number) => {
    if (index === 0) return;
    setOrderedStops((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((index: number) => {
    setOrderedStops((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const hasChanged = useCallback(() => {
    return orderedStops.some((s, i) => {
      const original = pendingStops.find((p) => p.id === s.id);
      return original && original.sequence !== orderedStops[i]?.id
        ? true
        : orderedStops[i]?.id !== pendingStops[i]?.id;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedStops, pendingStops]);

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
      // Reasignar secuencias según el nuevo orden (comenzando en el primer sequence existente)
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
                Usá las flechas ↑↓ para cambiar el orden. Solo se pueden mover paradas pendientes.
              </Text>
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={styles.list}
                keyboardShouldPersistTaps="handled"
              >
                {orderedStops.map((s, i) => (
                  <View key={s.id} style={styles.stopRow}>
                    <View style={styles.seqBadge}>
                      <Text style={styles.seqTxt}>{i + 1}</Text>
                    </View>
                    <View style={styles.stopInfo}>
                      <Text style={styles.stopName} numberOfLines={1}>
                        {s.client?.name || `Parada ${s.sequence}`}
                      </Text>
                      {s.client?.address ? (
                        <Text style={styles.stopAddr} numberOfLines={1}>
                          {s.client.address}
                        </Text>
                      ) : null}
                      {s.plannedSequence != null && s.plannedSequence !== s.sequence ? (
                        <Text style={styles.stopPlanned}>Original: #{s.plannedSequence}</Text>
                      ) : null}
                    </View>
                    <View style={styles.arrows}>
                      <Pressable
                        style={[styles.arrowBtn, i === 0 && styles.arrowDisabled]}
                        onPress={() => moveUp(i)}
                        disabled={i === 0}
                      >
                        <Text style={styles.arrowTxt}>↑</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.arrowBtn, i === orderedStops.length - 1 && styles.arrowDisabled]}
                        onPress={() => moveDown(i)}
                        disabled={i === orderedStops.length - 1}
                      >
                        <Text style={styles.arrowTxt}>↓</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.actions}>
                <Pressable style={styles.cancelBtn} onPress={onClose}>
                  <Text style={styles.cancelTxt}>Cancelar</Text>
                </Pressable>
                <Pressable style={styles.nextBtn} onPress={goToJustify}>
                  <Text style={styles.nextTxt}>Siguiente →</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>¿Por qué cambiás el orden?</Text>
              <Text style={styles.hint}>
                Esta información ayuda al operador a entender tus decisiones de ruta.
              </Text>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
              </ScrollView>
              <View style={styles.actions}>
                <Pressable style={styles.cancelBtn} onPress={() => setStep('reorder')}>
                  <Text style={styles.cancelTxt}>← Volver</Text>
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 30,
    maxHeight: '88%',
  },
  title: { fontSize: 18, fontWeight: '900', color: '#0f172a', marginBottom: 4 },
  hint: { fontSize: 11, color: '#64748b', lineHeight: 15, marginBottom: 14 },
  list: { maxHeight: 380 },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    marginBottom: 8,
  },
  seqBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  seqTxt: { color: '#fff', fontWeight: '900', fontSize: 13 },
  stopInfo: { flex: 1 },
  stopName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  stopAddr: { fontSize: 11, color: '#64748b', marginTop: 2 },
  stopPlanned: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  arrows: { flexDirection: 'row', gap: 4 },
  arrowBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowDisabled: { opacity: 0.3 },
  arrowTxt: { fontSize: 18, color: '#334155', fontWeight: '900' },
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  optRowOn: { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: '#4f46e5' },
  radioFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4f46e5' },
  optTxt: { fontSize: 14, color: '#334155', fontWeight: '600' },
  optTxtOn: { color: '#3730a3', fontWeight: '800' },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
    color: '#0f172a',
    minHeight: 72,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  cancelTxt: { fontWeight: '800', color: '#475569' },
  nextBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    alignItems: 'center',
  },
  nextTxt: { fontWeight: '900', color: '#fff' },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
  },
  confirmTxt: { fontWeight: '900', color: '#fff' },
  disabledBtn: { opacity: 0.7 },
});
