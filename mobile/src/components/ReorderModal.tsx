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
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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

  const hasChanged = useCallback(() => {
    return orderedStops.some((s, i) => orderedStops[i]?.id !== pendingStops[i]?.id);
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

  const renderItem = useCallback(({ item, drag, isActive, getIndex }: RenderItemParams<Stop>) => {
    const idx = getIndex() ?? 0;
    return (
      <ScaleDecorator>
        <Pressable
          onLongPress={drag}
          disabled={isActive}
          style={[styles.stopRow, isActive && styles.stopRowActive]}
        >
          <View style={styles.dragHandle}>
            <Text style={styles.dragIcon}>☰</Text>
          </View>
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
        </Pressable>
      </ScaleDecorator>
    );
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
                Mantené presionado ☰ y arrastrá para cambiar el orden.
              </Text>
              <GestureHandlerRootView style={styles.list}>
                <DraggableFlatList
                  data={orderedStops}
                  onDragEnd={({ data }) => setOrderedStops(data)}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={renderItem}
                  showsVerticalScrollIndicator={false}
                />
              </GestureHandlerRootView>
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheet: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    maxHeight: '88%',
  },
  title: { fontSize: 20, fontWeight: '900', color: '#0f172a', marginBottom: 4 },
  hint: { fontSize: 13, color: '#64748b', lineHeight: 18, marginBottom: 16 },
  list: { maxHeight: 400 },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 8,
  },
  stopRowActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#4f46e5',
    elevation: 8,
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  dragHandle: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  dragIcon: { fontSize: 18, color: '#94a3b8' },
  seqBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  seqTxt: { color: '#fff', fontWeight: '900', fontSize: 14 },
  stopInfo: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  stopAddr: { fontSize: 12, color: '#64748b', marginTop: 2 },
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  optRowOn: { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: '#4f46e5' },
  radioFill: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4f46e5' },
  optTxt: { fontSize: 15, color: '#334155', fontWeight: '600' },
  optTxtOn: { color: '#3730a3', fontWeight: '800' },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    padding: 14,
    textAlignVertical: 'top',
    color: '#0f172a',
    fontSize: 14,
    minHeight: 80,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  cancelTxt: { fontWeight: '800', fontSize: 15, color: '#475569' },
  nextBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#0f172a',
    alignItems: 'center',
  },
  nextTxt: { fontWeight: '900', fontSize: 15, color: '#fff' },
  confirmBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
  },
  confirmTxt: { fontWeight: '900', fontSize: 15, color: '#fff' },
  disabledBtn: { opacity: 0.7 },
});
