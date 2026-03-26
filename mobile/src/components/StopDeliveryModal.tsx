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

type Props = {
  visible: boolean;
  stop: Stop | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function StopDeliveryModal({ visible, stop, onClose, onSaved }: Props) {
  const [observations, setObservations] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [deliveryOk, setDeliveryOk] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && stop) {
      setObservations(stop.observations?.trim() ? stop.observations : '');
      setPhotoUri(null);
      setDeliveryOk(stop.deliveryWithoutIssues === true);
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

  const submit = useCallback(async () => {
    if (!stop) return;
    setSaving(true);
    try {
      assertApiConfigured();
      let proofUrl: string | null | undefined;
      if (photoUri) {
        proofUrl = await uploadProofPhoto(photoUri);
      }
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
          <Text style={styles.sheetTitle}>Finalizar entrega</Text>
          <Text style={styles.sheetSub}>{title}</Text>
          <Text style={styles.hint}>
            Registramos la salida del lugar y enviamos observaciones y foto a planificación.
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
                onPress={() => void submit()}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnTxt}>Confirmar salida</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.5)' },
  sheet: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '88%',
  },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  sheetSub: { fontSize: 14, fontWeight: '700', color: '#475569', marginTop: 4 },
  hint: { fontSize: 11, color: '#64748b', marginTop: 8, marginBottom: 12, lineHeight: 15 },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
    color: '#0f172a',
    marginBottom: 12,
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
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { borderColor: '#059669', backgroundColor: '#ecfdf5' },
  checkMark: { color: '#059669', fontWeight: '900', fontSize: 14 },
  checkLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#334155' },
  photoBtn: { paddingVertical: 10, marginBottom: 8 },
  photoBtnTxt: { color: '#4f46e5', fontWeight: '800', fontSize: 14 },
  preview: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#e2e8f0',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
  },
  cancelBtnTxt: { fontWeight: '800', color: '#475569' },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnTxt: { fontWeight: '900', color: '#fff' },
});
