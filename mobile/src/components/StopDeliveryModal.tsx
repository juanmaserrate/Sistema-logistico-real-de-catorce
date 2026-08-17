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
import { patchStop, uploadProofPhoto, enqueueOfflinePhoto, postponeStop } from '../api';
import { assertApiConfigured } from '../config';
import { compressPhoto, getLiteMode } from '../utils/photoUtils';

type Props = {
  visible: boolean;
  stop: Stop | null;
  /** Paradas que le quedan por hacer, para elegir dónde reintentar la pospuesta. */
  remainingStops?: Stop[];
  onClose: () => void;
  onSaved: () => void;
};

type Tab = 'delivered' | 'retry' | 'undeliverable';

const UNDELIVERABLE_REASONS = [
  { code: 'no_habia_nadie', label: 'No había nadie' },
  { code: 'local_cerrado', label: 'Local cerrado' },
  { code: 'direccion_incorrecta', label: 'Dirección incorrecta' },
  { code: 'rechaza_recepcion', label: 'Rechaza recepción' },
  { code: 'otro', label: 'Otro (ver observaciones)' },
];

// Motivos de "vuelvo más tarde": son situaciones transitorias, a diferencia de
// las de "No entregado" (dirección incorrecta, rechaza recepción) que no se
// arreglan pasando de nuevo.
const RETRY_REASONS = [
  { code: 'no_habia_nadie', label: 'No había nadie ahora' },
  { code: 'local_cerrado', label: 'Cerrado / fuera de horario' },
  { code: 'sin_lugar_descarga', label: 'No pude estacionar / descargar' },
  { code: 'calle_cortada', label: 'Calle cortada' },
  { code: 'pidio_mas_tarde', label: 'Me pidieron volver más tarde' },
  { code: 'otro', label: 'Otro (ver observaciones)' },
];

export default function StopDeliveryModal({ visible, stop, remainingStops = [], onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('delivered');
  const [observations, setObservations] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [deliveryOk, setDeliveryOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liteMode, setLiteModeState] = useState(false);
  const [undeliverableReason, setUndeliverableReason] = useState<string>('');
  const [retryReason, setRetryReason] = useState<string>('');
  // null = al final del recorrido (antes del depósito)
  const [retryAfterStopId, setRetryAfterStopId] = useState<number | null>(null);

  useEffect(() => { getLiteMode().then(setLiteModeState); }, []);

  useEffect(() => {
    if (visible && stop) {
      setTab('delivered');
      setObservations(stop.observations?.trim() ? stop.observations : '');
      setPhotoUri(null);
      setDeliveryOk(stop.deliveryWithoutIssues === true);
      setUndeliverableReason('');
      setRetryReason('');
      setRetryAfterStopId(null);
    }
  }, [visible, stop]);

  /** Las que puede elegir como referencia: las que le quedan por hacer, sin
   *  contar la que está posponiendo ni la vuelta al depósito. */
  const retryTargets = React.useMemo(
    () => remainingStops.filter((s) => s.id !== stop?.id && !s.isReturnToBase),
    [remainingStops, stop]
  );

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

  /** La foto viaja DESPUÉS de la marca, en segundo plano: sube, y patchea el
   *  stop con la URL. Si la subida falla (sin red / timeout), la foto local va
   *  a la cola y flushPhotoQueue la sube sola al volver la señal. Si el patch
   *  de la URL falla por red, patchStop ya lo encola solo. */
  const uploadPhotoInBackground = useCallback((stopId: number, uri: string, lite: boolean) => {
    void (async () => {
      try {
        const compressed = await compressPhoto(uri, lite);
        const url = await uploadProofPhoto(compressed);
        await patchStop(stopId, { proofPhotoUrl: url });
      } catch {
        try { await enqueueOfflinePhoto(stopId, uri); } catch { /* */ }
      }
    })();
  }, []);

  const submitDelivered = useCallback(async () => {
    if (!stop) return;
    setSaving(true);
    try {
      assertApiConfigured();
      // 1) PRIMERO la marca de entrega: rápida (≤6s) y, sin señal, va a la
      //    cola offline. Antes se subía la foto ANTES de marcar (hasta 25s de
      //    spinner con señal débil) y la entrega quedaba trabada detrás.
      const result = await patchStop(stop.id, {
        status: 'COMPLETED',
        actualDeparture: new Date().toISOString(),
        observations: observations.trim() || undefined,
        // M7 fix: enviar false explícito en lugar de null para "entrega con problemas"
        deliveryWithoutIssues: deliveryOk,
      });
      // 2) La foto sigue sola en segundo plano; no bloquea al chofer.
      if (photoUri) uploadPhotoInBackground(stop.id, photoUri, liteMode);
      if ((result as { queued?: boolean })?.queued) {
        Alert.alert(
          'Sin señal',
          'La entrega quedó guardada en el celular y se enviará sola al recuperar señal.'
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }, [deliveryOk, observations, onClose, onSaved, stop, photoUri, liteMode, uploadPhotoInBackground]);

  /** "No pude ahora, vuelvo más tarde": la parada NO se cierra, se reubica en
   *  el recorrido y sigue contando como pendiente. El viaje no se puede
   *  finalizar hasta que la resuelva. */
  const submitRetry = useCallback(async () => {
    if (!stop) return;
    if (!retryReason) {
      Alert.alert('Motivo requerido', 'Contá por qué no pudiste entregar ahora.');
      return;
    }
    setSaving(true);
    try {
      assertApiConfigured();
      const result = await postponeStop({
        stopId: stop.id,
        reason: retryReason,
        note: observations.trim() || null,
        afterStopId: retryAfterStopId,
      });
      // La foto del intento fallido también sirve como evidencia.
      if (photoUri) uploadPhotoInBackground(stop.id, photoUri, liteMode);
      const destino = retryAfterStopId
        ? retryTargets.find((s) => s.id === retryAfterStopId)?.client?.name || 'la parada elegida'
        : null;
      Alert.alert(
        result?.queued ? 'Guardado sin señal' : 'Parada pospuesta',
        (destino
          ? `La vas a reintentar después de ${destino}.`
          : 'Te queda al final del recorrido, antes de volver al depósito.') +
          (result?.queued ? '\n\nSe envía sola al recuperar señal.' : '')
      );
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo posponer la parada');
    } finally {
      setSaving(false);
    }
  }, [observations, onClose, onSaved, stop, retryReason, retryAfterStopId, retryTargets, photoUri, liteMode, uploadPhotoInBackground]);

  const submitUndeliverable = useCallback(async () => {
    if (!stop) return;
    if (!undeliverableReason) {
      Alert.alert('Razón requerida', 'Seleccioná el motivo por el que no se pudo entregar.');
      return;
    }
    setSaving(true);
    try {
      assertApiConfigured();
      const result = await patchStop(stop.id, {
        status: 'UNDELIVERABLE',
        actualDeparture: new Date().toISOString(),
        reasonCode: undeliverableReason,
        observations: observations.trim() || undefined,
        deliveryWithoutIssues: null,
      });
      if (photoUri) uploadPhotoInBackground(stop.id, photoUri, liteMode);
      if ((result as { queued?: boolean })?.queued) {
        Alert.alert(
          'Sin señal',
          'El estado quedó guardado en el celular y se enviará solo al recuperar señal.'
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }, [observations, onClose, onSaved, stop, undeliverableReason, photoUri, liteMode, uploadPhotoInBackground]);

  if (!stop) return null;
  const title = stop.client?.name || `Parada ${stop.sequence}`;
  const address = stop.client?.address || '';
  // Retorno al depósito: no es una entrega, es el cierre del viaje.
  const isBase = stop.isReturnToBase === true;

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
            <Text style={styles.headerKicker}>
              {isBase ? 'Cierre del viaje' : `Parada ${stop.sequence}`}
            </Text>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          </View>
        </View>

        {address ? (
          <Text style={styles.addr} numberOfLines={2}>{address}</Text>
        ) : null}

        {/* Tabs. La del medio ("vuelvo") no aparece en la vuelta al depósito:
            esa parada no se pospone, cierra el viaje. */}
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, tab === 'delivered' && styles.tabActive]}
            onPress={() => setTab('delivered')}
          >
            <Text style={[styles.tabTxt, tab === 'delivered' && styles.tabTxtActive]}>
              ✓ Entregado
            </Text>
          </Pressable>
          {!isBase ? (
            <Pressable
              style={[styles.tab, tab === 'retry' && styles.tabActiveAmber]}
              onPress={() => setTab('retry')}
            >
              <Text style={[styles.tabTxt, tab === 'retry' && styles.tabTxtAmber]}>
                ↻ Vuelvo
              </Text>
            </Pressable>
          ) : null}
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
                  {isBase
                    ? 'Volviste al depósito. Al confirmar, el viaje se cierra con la hora de ahora — aunque no tengas señal, se guarda esta hora.'
                    : 'Registramos la salida y enviamos observaciones y foto a planificación.'}
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
            ) : tab === 'retry' ? (
              <>
                <Text style={styles.hint}>
                  La parada NO se cierra: queda pendiente y la vas a reintentar más adelante.
                  El viaje no se puede finalizar hasta que la resuelvas.
                </Text>
                <Text style={styles.reasonLabel}>¿Por qué no pudiste ahora?</Text>
                {RETRY_REASONS.map((r) => (
                  <Pressable
                    key={r.code}
                    style={[styles.reasonRow, retryReason === r.code && styles.reasonRowOnAmber]}
                    onPress={() => setRetryReason(r.code)}
                  >
                    <View style={[styles.radioCircle, retryReason === r.code && styles.radioCircleOnAmber]}>
                      {retryReason === r.code ? <View style={styles.radioFillAmber} /> : null}
                    </View>
                    <Text style={[styles.reasonTxt, retryReason === r.code && styles.reasonTxtOnAmber]}>
                      {r.label}
                    </Text>
                  </Pressable>
                ))}

                <Text style={[styles.reasonLabel, { marginTop: 16 }]}>¿Cuándo la reintentás?</Text>
                <Pressable
                  style={[styles.reasonRow, retryAfterStopId === null && styles.reasonRowOnAmber]}
                  onPress={() => setRetryAfterStopId(null)}
                >
                  <View style={[styles.radioCircle, retryAfterStopId === null && styles.radioCircleOnAmber]}>
                    {retryAfterStopId === null ? <View style={styles.radioFillAmber} /> : null}
                  </View>
                  <Text style={[styles.reasonTxt, retryAfterStopId === null && styles.reasonTxtOnAmber]}>
                    Al final, antes de volver al depósito
                  </Text>
                </Pressable>
                {retryTargets.length > 0 ? (
                  <Text style={styles.retryHint}>…o después de una parada en particular:</Text>
                ) : null}
                {retryTargets.map((s) => (
                  <Pressable
                    key={s.id}
                    style={[styles.reasonRow, retryAfterStopId === s.id && styles.reasonRowOnAmber]}
                    onPress={() => setRetryAfterStopId(s.id)}
                  >
                    <View style={[styles.radioCircle, retryAfterStopId === s.id && styles.radioCircleOnAmber]}>
                      {retryAfterStopId === s.id ? <View style={styles.radioFillAmber} /> : null}
                    </View>
                    <Text
                      style={[styles.reasonTxt, retryAfterStopId === s.id && styles.reasonTxtOnAmber]}
                      numberOfLines={1}
                    >
                      Después de {s.client?.name || `parada ${s.sequence}`}
                    </Text>
                  </Pressable>
                ))}

                <TextInput
                  style={[styles.input, { marginTop: 10 }]}
                  placeholder="Observaciones (opcional)"
                  placeholderTextColor="#94a3b8"
                  multiline
                  value={observations}
                  onChangeText={setObservations}
                />
                <Pressable style={styles.photoBtn} onPress={() => void pickPhoto()}>
                  <Text style={styles.photoBtnTxt}>
                    {photoUri ? 'Cambiar foto' : 'Tomar foto del intento (opcional)'}
                  </Text>
                </Pressable>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  Esta parada queda cerrada como NO entregada. Si pensás pasar de nuevo,
                  usá «↻ Vuelvo» en vez de esta opción.
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
                <Text style={styles.saveBtnTxt}>
                  {isBase ? 'Finalizar viaje' : 'Confirmar entrega'}
                </Text>
              )}
            </Pressable>
          ) : tab === 'retry' ? (
            <Pressable
              style={[styles.saveBtnAmber, saving && styles.saveBtnDisabled]}
              onPress={() => void submitRetry()}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnTxt}>Vuelvo más tarde</Text>
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
  tabActiveAmber: { backgroundColor: '#fffbeb' },
  tabTxt: { fontWeight: '800', fontSize: 14, color: '#74777b' },
  tabTxtActive: { color: '#006d43' },
  tabTxtRed: { color: '#dc2626' },
  tabTxtAmber: { color: '#b45309' },
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
  /* Variante ámbar para "vuelvo más tarde": es transitorio, no un fallo */
  reasonRowOnAmber: { backgroundColor: '#fffbeb' },
  radioCircleOnAmber: { borderColor: '#b45309' },
  radioFillAmber: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#b45309' },
  reasonTxtOnAmber: { color: '#b45309', fontWeight: '800' },
  retryHint: { fontSize: 12, color: '#74777b', marginTop: 10, marginBottom: 4 },
  saveBtnAmber: {
    paddingVertical: 16,
    borderRadius: 9999,
    backgroundColor: '#b45309',
    alignItems: 'center',
  },
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
