import React, { useCallback, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { reportIncident, uploadProofPhoto } from '../api';
import type { SessionUser } from '../types';
import { compressPhoto, getLiteMode } from '../utils/photoUtils';

type IncidentType = 'MECANICO' | 'TRANSITO' | 'ESCUELA' | 'OTRO';

interface Props {
  visible: boolean;
  session: SessionUser;
  tripId?: number | null;
  onClose: () => void;
  onSent: () => void;
}

const TYPES: { value: IncidentType; label: string; emoji: string }[] = [
  { value: 'MECANICO',  label: 'Problema mecánico',  emoji: '🔧' },
  { value: 'TRANSITO',  label: 'Problema de tránsito', emoji: '🚧' },
  { value: 'ESCUELA',   label: 'Problema en escuela',  emoji: '🏫' },
  { value: 'OTRO',      label: 'Otro',                 emoji: '⚠️' },
];

export default function IncidentModal({ visible, session, tripId, onClose, onSent }: Props) {
  const [type, setType]           = useState<IncidentType>('OTRO');
  const [description, setDesc]    = useState('');
  const [photoUri, setPhotoUri]   = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [liteMode, setLiteModeState] = useState(false);

  React.useEffect(() => { getLiteMode().then(setLiteModeState); }, []);

  const reset = () => {
    setType('OTRO');
    setDesc('');
    setPhotoUri(null);
    setSaving(false);
  };

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Cámara', 'Sin permiso no se puede tomar foto.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true, aspect: [4, 3] });
    if (!r.canceled && r.assets[0]?.uri) setPhotoUri(r.assets[0].uri);
  }, []);

  const submit = useCallback(async () => {
    if (!description.trim()) {
      Alert.alert('Descripción requerida', 'Describí brevemente el problema.');
      return;
    }
    setSaving(true);
    try {
      let photoUrl: string | null = null;
      if (photoUri) {
        try { photoUrl = await uploadProofPhoto(await compressPhoto(photoUri, liteMode)); } catch { /* foto no crítica */ }
      }
      const result = await reportIncident({
        driverId: session.id,
        tripId: tripId ?? null,
        type,
        description: description.trim(),
        photoUrl,
      });
      const queued = 'queued' in result && result.queued;
      Alert.alert(
        queued ? 'Guardado offline' : 'Incidencia reportada',
        queued
          ? 'No hay conexión. Se enviará automáticamente cuando vuelva la señal.'
          : 'La oficina fue notificada.',
        [{ text: 'OK', onPress: () => { reset(); onSent(); onClose(); } }]
      );
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo reportar');
    } finally {
      setSaving(false);
    }
  }, [description, onClose, onSent, photoUri, session.id, tripId, type]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { reset(); onClose(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={() => { reset(); onClose(); }} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Reportar Incidencia</Text>
          <Text style={styles.sub}>La oficina recibirá una notificación inmediata.</Text>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Tipo */}
            <Text style={styles.label}>Tipo de problema</Text>
            <View style={styles.typeRow}>
              {TYPES.map((t) => (
                <Pressable
                  key={t.value}
                  style={[styles.typeBtn, type === t.value && styles.typeBtnActive]}
                  onPress={() => setType(t.value)}
                >
                  <Text style={styles.typeEmoji}>{t.emoji}</Text>
                  <Text style={[styles.typeTxt, type === t.value && styles.typeTxtActive]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Descripción */}
            <Text style={styles.label}>Descripción</Text>
            <TextInput
              style={styles.input}
              placeholder="Describí brevemente qué pasó..."
              placeholderTextColor="#94a3b8"
              multiline
              numberOfLines={4}
              value={description}
              onChangeText={setDesc}
            />

            {/* Foto opcional */}
            <Pressable style={styles.photoBtn} onPress={() => void pickPhoto()}>
              <Text style={styles.photoBtnTxt}>
                {photoUri ? '📷 Cambiar foto' : '📷 Adjuntar foto (opcional)'}
              </Text>
            </Pressable>

            {/* Acciones */}
            <View style={styles.actions}>
              <Pressable style={styles.cancelBtn} onPress={() => { reset(); onClose(); }} disabled={saving}>
                <Text style={styles.cancelTxt}>Cancelar</Text>
              </Pressable>
              <Pressable style={[styles.submitBtn, saving && styles.submitDisabled]} onPress={() => void submit()} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitTxt}>Enviar reporte</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:      { flex: 1, justifyContent: 'flex-end' },
  backdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,10,62,0.6)' },
  sheet:        { backgroundColor: '#ffffff', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 20, paddingBottom: 30, maxHeight: '88%', borderWidth: 0 },
  title:        { fontSize: 18, fontWeight: '900', color: '#191c1e' },
  sub:          { fontSize: 12, color: '#74777b', marginTop: 4, marginBottom: 16 },
  label:        { fontSize: 12, fontWeight: '800', color: '#44474a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  typeRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeBtn:      { flex: 1, minWidth: '45%', padding: 10, borderRadius: 12, borderWidth: 0, backgroundColor: '#f2f3f6', alignItems: 'center' },
  typeBtnActive:{ backgroundColor: '#fef2f2' },
  typeEmoji:    { fontSize: 20, marginBottom: 4 },
  typeTxt:      { fontSize: 11, fontWeight: '700', color: '#74777b', textAlign: 'center' },
  typeTxtActive:{ color: '#dc2626' },
  input:        { borderWidth: 0, borderRadius: 12, padding: 12, minHeight: 90, textAlignVertical: 'top', color: '#191c1e', marginBottom: 12, backgroundColor: '#f2f3f6' },
  photoBtn:     { paddingVertical: 10, marginBottom: 8 },
  photoBtnTxt:  { color: '#451ebb', fontWeight: '800', fontSize: 14 },
  actions:      { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn:    { flex: 1, paddingVertical: 14, borderRadius: 9999, backgroundColor: '#f2f3f6', alignItems: 'center', borderWidth: 0 },
  cancelTxt:    { fontWeight: '800', color: '#44474a' },
  submitBtn:    { flex: 1, paddingVertical: 14, borderRadius: 9999, backgroundColor: '#dc2626', alignItems: 'center', borderWidth: 0 },
  submitDisabled:{ opacity: 0.7 },
  submitTxt:    { fontWeight: '900', color: '#fff' },
});
