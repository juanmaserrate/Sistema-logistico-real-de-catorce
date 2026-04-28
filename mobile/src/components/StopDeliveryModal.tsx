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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('delivered');
  const [observations, setObservations] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [deliveryOk, setDeliveryOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liteMode, setLiteModeState] = useState(false);
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

  const hasChanges = useCallback((): boolean => {
    if (observations.trim().length > 0) return true;
    if (photoUri) return true;
    if (deliveryOk) return true;
    if (undeliverableReason) return true;
    return false;
  }, [observations, photoUri, deliveryOk, undeliverableReason]);

  const confirmClose = useCallback(() => {
    if (saving) return;
    if (!hasChanges()) {
      onClose();
      return;
    }
    Alert.alert(
      '¿Descartar cambios?',
      'Cargaste información que no se guardó. Si cerrás ahora se va a perder.',
      [
        { text: 'Seguir editando', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: onClose },
      ]
    );
  }, [hasChanges, onClose, saving]);

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
  }, [deliveryOk, observations, onClose, onSaved, photoUri, stop, liteMode]);

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
  }, [observations, onClose, onSaved, photoUri, stop, undeliverableReason, liteMode]);

  if (!stop) return null;
  const title = stop.client?.name || `Parada ${stop.sequence}`;
  const address = stop.client?.address || '';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={confirmClose}
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {/* Header con cruz a la izquierda */}
        <View style={styles.header}>
          <Pressable
            onPress={confirmClose}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Cerrar"
          >
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerKicker}>Parada {stop.sequence}</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          </View>
        </View>

        {address ? (
          <Text style={styles.addr} numberOfLines={2}>{address}</Text>
        ) : null}

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

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 50 : 0}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(24, insets.bottom) + 120 }]}
          >
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
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Footer fijo con botón de guardar, respetando safe area */}
        <View style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
          {tab === 'delivered' ? (
            <Pressable
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={() => void submitDelivered()}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnTxt}>Confirmar entrega</Text>
              )}
            </Pressable>
          ) : (
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
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f3f6',
  },
  closeTxt: { fontSize: 22, fontWeight: '900', color: '#191c1e' },
  headerTitleWrap: { flex: 1, marginLeft: 6 },
  headerKicker: { fontSize: 11, fontWeight: '800', color: '#74777b', letterSpacing: 0.4, textTransform: 'uppercase' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#191c1e', marginTop: 2 },
  addr: { fontSize: 14, color: '#44474a', paddingHorizontal: 18, paddingBottom: 8, lineHeight: 18 },
  tabs: { flexDirection: 'row', paddingHorizontal: 18, marginTop: 8, marginBottom: 4, gap: 8 },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f2f3f6',
    alignItems: 'center',
  },
  tabActive: { backgroundColor: '#ecfdf5' },
  tabActiveRed: { backgroundColor: '#fef2f2' },
  tabTxt: { fontWeight: '800', fontSize: 14, color: '#74777b' },
  tabTxtActive: { color: '#006d43' },
  tabTxtRed: { color: '#dc2626' },
  scrollContent: { paddingHorizontal: 18, paddingTop: 10 },
  hint: { fontSize: 12, color: '#74777b', marginTop: 8, marginBottom: 12, lineHeight: 16 },
  reasonLabel: { fontSize: 13, fontWeight: '800', color: '#44474a', marginBottom: 6 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: '#ffffff',
  },
  reasonRowOn: { backgroundColor: '#fef2f2' },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#dfe1e4',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleOn: { borderColor: '#dc2626' },
  radioFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#dc2626' },
  reasonTxt: { fontSize: 15, color: '#44474a', fontWeight: '600' },
  reasonTxtOn: { color: '#dc2626', fontWeight: '800' },
  input: {
    minHeight: 84,
    borderRadius: 12,
    padding: 14,
    textAlignVertical: 'top',
    color: '#191c1e',
    marginBottom: 12,
    backgroundColor: '#f2f3f6',
    fontSize: 15,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    paddingVertical: 4,
  },
  checkBox: {
    width: 26,
    height: 26,
    marginRight: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#dfe1e4',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { borderColor: '#006d43', backgroundColor: '#ecfdf5' },
  checkMark: { color: '#006d43', fontWeight: '900', fontSize: 16 },
  checkLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: '#44474a' },
  photoBtn: { paddingVertical: 12, marginBottom: 8 },
  photoBtnTxt: { color: '#451ebb', fontWeight: '800', fontSize: 15 },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#f2f3f6',
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e8eaed',
    backgroundColor: '#ffffff',
  },
  saveBtn: {
    paddingVertical: 16,
    borderRadius: 9999,
    backgroundColor: '#451ebb',
    alignItems: 'center',
  },
  saveBtnRed: {
    paddingVertical: 16,
    borderRadius: 9999,
    backgroundColor: '#dc2626',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnTxt: { fontWeight: '900', color: '#fff', fontSize: 16, letterSpacing: 0.3 },
});
