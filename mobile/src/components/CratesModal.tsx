import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Stop } from '../types';
import { patchStop } from '../api';
import CajonesPorProveedor, {
  CAJONES_VACIO,
  cajonesDeLaParada,
  cajonesParaGuardar,
  totalCajones,
  type CajonesProveedor,
} from './CajonesPorProveedor';

type Props = {
  visible: boolean;
  stop: Stop | null;
  onClose: () => void;
  /** Los campos que cambiaron, listos para mezclar en la parada de la
   *  pantalla: los seis del desglose mas los dos totales. */
  onSaved: (stopId: number, cambios: Partial<Stop>) => void;
};

/** Cajones de una parada YA cerrada, separados por proveedor del envase.
 *  Nace de como trabajan los choferes: dejan los cajones, siguen el recorrido y
 *  vuelven mas tarde a buscarlos — a veces con el viaje ya finalizado. Esta
 *  ventana toca SOLO los cajones: no cambia el estado de la entrega, ni las
 *  horas, ni reabre el viaje. Si no hay senial, queda en la cola offline. */
export default function CratesModal({ visible, stop, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const [cajones, setCajones] = useState<CajonesProveedor>(CAJONES_VACIO);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !stop) return;
    setCajones(cajonesDeLaParada(stop));
    setSaving(false);
  }, [visible, stop]);

  const totalDej = totalCajones(cajones, 'dej');
  const totalRec = totalCajones(cajones, 'rec');

  const guardar = async () => {
    if (!stop || saving) return;
    setSaving(true);
    try {
      const guardado = cajonesParaGuardar(cajones);
      const res: any = await patchStop(stop.id, guardado);
      onSaved(stop.id, { ...guardado, cratesDelivered: totalDej, cratesRecovered: totalRec });
      onClose();
      if (res?.queued) {
        Alert.alert('Guardado sin señal', 'Los cajones se envían solos cuando vuelva la conexión.');
      }
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Probá de nuevo en un momento.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible || !stop) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <Text style={styles.title}>📦 Cajones</Text>
          <Text style={styles.sub} numberOfLines={2}>{stop.client?.name || 'Parada'}</Text>
          <Text style={styles.hint}>
            Cargalos por proveedor. Podés hacerlo aunque la entrega o el viaje ya
            estén cerrados: no cambia nada más.
          </Text>
          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <CajonesPorProveedor valor={cajones} onChange={setCajones} />
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.cancel} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelTxt}>Cancelar</Text>
            </Pressable>
            <Pressable style={[styles.save, saving && styles.saveOff]} onPress={guardar} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.saveTxt}>Guardar · dejé {totalDej} · recuperé {totalRec}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 18, maxHeight: '85%' },
  title: { fontSize: 20, fontWeight: '900', color: '#191c1e' },
  sub: { fontSize: 15, fontWeight: '700', color: '#44474a', marginTop: 2 },
  hint: { fontSize: 12, color: '#74777b', marginTop: 6 },
  body: { marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancel: { flex: 1, height: 52, borderRadius: 16, backgroundColor: '#eceef1', alignItems: 'center', justifyContent: 'center' },
  cancelTxt: { fontSize: 15, fontWeight: '800', color: '#44474a' },
  save: { flex: 2, height: 52, borderRadius: 16, backgroundColor: '#451ebb', alignItems: 'center', justifyContent: 'center' },
  saveOff: { opacity: 0.6 },
  saveTxt: { fontSize: 15, fontWeight: '900', color: '#fff' },
});
