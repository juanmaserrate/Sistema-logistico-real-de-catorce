import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { Stop } from '../types';
import { patchStop, uploadProofPhoto } from '../api';
import { assertApiConfigured } from '../config';
import { compressPhoto, getLiteMode } from '../utils/photoUtils';

type Props = {
  visible: boolean;
  stop: Stop | null;
  onClose: () => void;
  onSaved: () => void;
};

type Tab = 'delivered' | 'undeliverable';

const UNDELIVERABLE_REASONS = [
  { code: 'no_habia_nadie', label: 'No había nadie' },
  { code: 'local_cerrado', label: 'Local cerrado' },
  { code: 'direccion_incorrecta', label: 'Dirección incorrecta' },
  { code: 'rechaza_recepcion', label: 'Rechaza recepción' },
  { code: 'otro', label: 'Otro (ver observaciones)' },
];

export default function StopDeliveryModal({ visible, stop, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('delivered');
  const [observations, setObservations] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [deliveryOk, setDeliveryOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liteMode, setLiteModeState] = useState(false);
  // UNDELIVERABLE
  const [undeliverableReason, setUndeliverableReason] = useState<string>('');

  useEffect(() => { getLiteMode().then(setLiteModeState); }, []);

  useEffect(() => {
    if (visible && stop) {
      setTab('delivered');
      setObservations(stop.observations?.trim() ? stop.observations : '');
      setPhotoUri(null);
      setDeliveryOk(stop.deliveryWithoutIssues === true);
      setUndeliverableReason('');
    }
  }, [visible, stop]);

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Cámara', 'Sin permiso no se puede tomar foto.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!r.canceled && r.assets[0]?.uri) setPhotoUri(r.assets[0].uri);
  }, []);

  const submitDelivered = useCallback(async () => {
    if (!stop) return;
    setSaving(true);
    try {
      assertApiConfigured();
      let proofUrl: string | null | undefined;
      if (photoUri) proofUrl = await uploadProofPhoto(await compressPhoto(photoUri, liteMode));
      await patchStop(stop.id, {
        status: 'COMPLETED',
        actualDeparture: new Date().toISOString(),
        observations: observations.trim() || undefined,
        proofPhotoUrl: proofUrl ?? undefined,
        deliveryWithoutIssues: deliveryOk ? true : null,
      });
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }, [deliveryOk, observations, onClose, onSaved, photoUri, stop]);

  const submitUndeliverable = useCallback(async () => {
    if (!stop) return;
    if (!undeliverableReason) {
      Alert.alert('Razón requerida', 'Seleccioná el motivo por el que no se pudo entregar.');
      return;
    }
    setSaving(true);
    try {
      assertApiConfigured();
      let proofUrl: string | null | undefined;
      if (photoUri) proofUrl = await uploadProofPhoto(await compressPhoto(photoUri, liteMode));
      await patchStop(stop.id, {
        status: 'UNDELIVERABLE',
        actualDeparture: new Date().toISOString(),
        reasonCode: undeliverableReason,
        observations: observations.trim() || undefined,
        proofPhotoUrl: proofUrl ?? undefined,
        deliveryWithoutIssues: null,
      });
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }, [observations, onClose, onSaved, photoUri, stop, undeliverableReason]);

  if (!stop) return null;
  const title = stop.client?.name || `Parada ${stop.sequence}`;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Parada {stop.sequence}</Text>
          <Text style={styles.sheetSub}>{title}</Text>

          {/* Tabs */}
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, tab === 'delivered' && styles.tabActive]}
              onPress={() => setTab('delivered')}
            >
              <Text style={[styles.tabTxt, tab === 'delivered' && styles.tabTxtActive]}>
                ✓ Entregado
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === 'undeliverable' && styles.tabActiveRed]}
              onPress={() => setTab('undeliverable')}
            >
              <Text style={[styles.tabTxt, tab === 'undeliverable' && styles.tabTxtRed]}>
                ✗ No entregado
              </Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {tab === 'delivered' ? (
              <>
                <Text style={styles.hint}>
                  Registramos la salida y enviamos observaciones y foto a planificación.
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Observaciones (opcional)"
                  placeholderTextColor="#94a3b8"
                  multiline
                  value={observations}
                  onChangeText={setObservations}
                />
                <Pressable
                  style={styles.checkRow}
                  onPress={() => setDeliveryOk((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: deliveryOk }}
                >
                  <View style={[styles.checkBox, deliveryOk && styles.checkBoxOn]}>
                    {deliveryOk ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                  <Text style={styles.checkLabel}>Entrega sin problemas (opcional)</Text>
                </Pressable>
                <Pressable style={styles.photoBtn} onPress={() => void pickPhoto()}>
                  <Text style={styles.photoBtnTxt}>
                    {photoUri ? 'Cambiar foto de comprobante' : 'Tomar foto (opcional)'}
                  </Text>
                </Pressable>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
                ) : null}
                <View style={styles.actions}>
                  <Pressable style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                    <Text style={styles.cancelBtnTxt}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                    onPress={() => void submitDelivered()}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.saveBtnTxt}>Confirmar salida</Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  Indicá el motivo. Se notifica a planificación para reasignación.
                </Text>
                <Text style={styles.reasonLabel}>Motivo:</Text>
                {UNDELIVERABLE_REASONS.map((r) => (
                  <Pressable
                    key={r.code}
                    style={[styles.reasonRow, undeliverableReason === r.code && styles.reasonRowOn]}
                    onPress={() => setUndeliverableReason(r.code)}
                  >
                    <View style={[styles.radioCircle, undeliverableReason === r.code && styles.radioCircleOn]}>
                      {undeliverableReason === r.code ? <View style={styles.radioFill} /> : null}
                    </View>
                    <Text style={[styles.reasonTxt, undeliverableReason === r.code && styles.reasonTxtOn]}>
                      {r.label}
                    </Text>
                  </Pressable>
                ))}
                <TextInput
                  style={[styles.input, { marginTop: 10 }]}
                  placeholder="Observaciones adicionales (opcional)"
                  placeholderTextColor="#94a3b8"
                  multiline
                  value={observations}
                  onChangeText={setObservations}
                />
                <Pressable style={styles.photoBtn} onPress={() => void pickPhoto()}>
                  <Text style={styles.photoBtnTxt}>
                    {photoUri ? 'Cambiar foto de evidencia' : 'Tomar foto de evidencia (recomendada)'}
                  </Text>
                </Pressable>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
                ) : null}
                <View style={styles.actions}>
                  <Pressable style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                    <Text style={styles.cancelBtnTxt}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtnRed, saving && styles.saveBtnDisabled]}
                    onPress={() => void submitUndeliverable()}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.saveBtnTxt}>Confirmar no entregado</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
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
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '90%',
    borderWidth: 0,
  },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#191c1e' },
  sheetSub: { fontSize: 14, fontWeight: '700', color: '#44474a', marginTop: 4 },
  tabs: { flexDirection: 'row', marginTop: 14, marginBottom: 4, gap: 8 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#f2f3f6',
    alignItems: 'center',
    borderWidth: 0,
  },
  tabActive: { backgroundColor: '#ecfdf5' },
  tabActiveRed: { backgroundColor: '#fef2f2' },
  tabTxt: { fontWeight: '800', fontSize: 13, color: '#74777b' },
  tabTxtActive: { color: '#006d43' },
  tabTxtRed: { color: '#dc2626' },
  hint: { fontSize: 11, color: '#74777b', marginTop: 8, marginBottom: 12, lineHeight: 15 },
  reasonLabel: { fontSize: 12, fontWeight: '800', color: '#44474a', marginBottom: 6 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: '#ffffff',
    borderWidth: 0,
  },
  reasonRowOn: { backgroundColor: '#fef2f2' },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#dfe1e4',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleOn: { borderColor: '#dc2626' },
  radioFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#dc2626' },
  reasonTxt: { fontSize: 14, color: '#44474a', fontWeight: '600' },
  reasonTxtOn: { color: '#dc2626', fontWeight: '800' },
  input: {
    minHeight: 72,
    borderWidth: 0,
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
    color: '#191c1e',
    marginBottom: 12,
    backgroundColor: '#f2f3f6',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    paddingVertical: 4,
  },
  checkBox: {
    width: 24,
    height: 24,
    marginRight: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#dfe1e4',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { borderColor: '#006d43', backgroundColor: '#ecfdf5' },
  checkMark: { color: '#006d43', fontWeight: '900', fontSize: 14 },
  checkLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#44474a' },
  photoBtn: { paddingVertical: 10, marginBottom: 8 },
  photoBtnTxt: { color: '#451ebb', fontWeight: '800', fontSize: 14 },
  preview: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#f2f3f6',
    borderWidth: 0,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 9999,
    backgroundColor: '#f2f3f6',
    alignItems: 'center',
    borderWidth: 0,
  },
  cancelBtnTxt: { fontWeight: '800', color: '#44474a' },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 9999,
    backgroundColor: '#451ebb',
    alignItems: 'center',
    borderWidth: 0,
  },
  saveBtnRed: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 9999,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    borderWidth: 0,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnTxt: { fontWeight: '900', color: '#fff' },
});
