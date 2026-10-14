import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, spacing, radius, font, shadow } from '../theme';

/**
 * Pide el motivo cuando se cierra una ruta o el viaje con paradas sin marcar.
 *
 * Existe porque `Alert.prompt` es SOLO de iOS y los choferes usan Android: ahi
 * no habria forma de escribir nada y el motivo terminaria siendo un texto fijo
 * puesto por el sistema, que no le sirve a nadie en la oficina.
 */
interface Props {
  visible: boolean;
  titulo: string;
  detalle: string;
  textoBoton: string;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}

/** Los de siempre, para no tener que escribir con el celular en la mano. */
const SUGERENCIAS = [
  'El local estaba cerrado',
  'No me recibieron la mercaderia',
  'Se me hizo tarde, lo paso a manana',
  'Problema mecanico',
];

export default function MotivoModal({
  visible, titulo, detalle, textoBoton, onCancelar, onConfirmar,
}: Props) {
  const [motivo, setMotivo] = useState('');

  useEffect(() => { if (visible) setMotivo(''); }, [visible]);

  const limpio = motivo.trim();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancelar}>
      <KeyboardAvoidingView
        style={styles.fondo}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.caja}>
          <Text style={styles.titulo}>{titulo}</Text>
          <Text style={styles.detalle}>{detalle}</Text>

          <TextInput
            style={styles.input}
            value={motivo}
            onChangeText={setMotivo}
            placeholder="Escribí por qué…"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
            maxLength={300}
            autoFocus
          />

          <View style={styles.sugerencias}>
            {SUGERENCIAS.map((t) => (
              <Pressable key={t} style={styles.chip} onPress={() => setMotivo(t)}>
                <Text style={styles.chipTxt}>{t}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.botones}>
            <Pressable style={styles.btnVolver} onPress={onCancelar}>
              <Text style={styles.btnVolverTxt}>Volver</Text>
            </Pressable>
            <Pressable
              style={[styles.btnOk, !limpio && styles.btnOkOff]}
              disabled={!limpio}
              onPress={() => onConfirmar(limpio)}
            >
              <Text style={styles.btnOkTxt}>{textoBoton}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(15,23,42,0.72)', justifyContent: 'flex-end' },
  caja: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    ...shadow.lg,
  },
  titulo: { fontWeight: font.black, fontSize: font['2xl'], color: colors.textPrimary },
  detalle: { color: colors.textMuted, fontSize: font.md, marginTop: spacing.xs, marginBottom: spacing.lg },
  input: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: font.lg,
    color: colors.textPrimary,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  sugerencias: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: {
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  chipTxt: { color: colors.primary, fontWeight: font.bold, fontSize: font.sm },
  botones: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  btnVolver: {
    flex: 1,
    paddingVertical: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
  },
  btnVolverTxt: { fontWeight: font.black, color: colors.textPrimary, fontSize: font.lg },
  btnOk: {
    flex: 2,
    paddingVertical: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  btnOkOff: { backgroundColor: colors.border },
  btnOkTxt: { fontWeight: font.black, color: colors.textInverse, fontSize: font.lg },
});
