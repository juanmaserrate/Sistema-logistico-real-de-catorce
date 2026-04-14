import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { login } from '../api';
import { persistSession } from '../sessionStorage';
import type { SessionUser } from '../types';
import { assertApiConfigured } from '../config';
import { colors, font, radius, spacing } from '../theme';

type Props = { onLoggedIn: (user: SessionUser) => void | Promise<void> };

export default function LoginScreen({ onLoggedIn }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userFocused, setUserFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);

  const submit = async () => {
    setError('');
    try {
      assertApiConfigured();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Configurá EXPO_PUBLIC_API_URL');
      return;
    }
    setLoading(true);
    try {
      const normalizedUsername = username.trim().toUpperCase();
      const user = await login(normalizedUsername, password);
      if (user.role === 'ADMIN') {
        setError('Esta app es solo para choferes.');
        return;
      }
      await persistSession(user);
      onLoggedIn(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <View style={styles.hero}>
        <View style={styles.brandRow}>
          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeTxt}>R14</Text>
          </View>
        </View>
        <Text style={styles.brand}>Real de Catorce</Text>
        <Text style={styles.sub}>Seguimiento satelital</Text>
        <Text style={styles.tag}>Recorrido en vivo  ·  Planificación</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Ingreso chofer</Text>
        <Text style={styles.subtitle}>Usá tu nombre y contraseña asignados</Text>

        <Text style={styles.label}>USUARIO</Text>
        <TextInput
          style={[styles.input, userFocused && styles.inputFocused]}
          value={username}
          onChangeText={setUsername}
          onFocus={() => setUserFocused(true)}
          onBlur={() => setUserFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Ej: MARTINEZ"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>CONTRASE\u00d1A</Text>
        <TextInput
          style={[styles.input, passFocused && styles.inputFocused]}
          value={password}
          onChangeText={setPassword}
          onFocus={() => setPassFocused(true)}
          onBlur={() => setPassFocused(false)}
          secureTextEntry
          placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
          placeholderTextColor={colors.textMuted}
        />

        {error ? (
          <View style={styles.errBox}>
            <Text style={styles.err}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.btn,
            loading && styles.btnDis,
            pressed && !loading && styles.btnPressed,
          ]}
          onPress={submit}
          disabled={loading || !username.trim() || !password}
        >
          {loading ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.btnTxt}>Ingresar</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.heroBg },
  hero: { paddingTop: 64, paddingHorizontal: spacing['2xl'], paddingBottom: spacing.xl },
  brandRow: { marginBottom: spacing.lg },
  brandBadge: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(79,70,229,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBadgeTxt: { fontSize: font.xl, fontWeight: font.black, color: '#a5b4fc', letterSpacing: 1 },
  brand: { fontSize: font['3xl'], fontWeight: font.black, color: colors.heroText, letterSpacing: -0.5 },
  sub: { fontSize: font.lg, color: colors.heroSub, marginTop: spacing.xs, fontWeight: font.semibold },
  tag: { fontSize: font.base, color: colors.heroTag, marginTop: spacing.md },
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    padding: spacing['2xl'],
  },
  title: { fontSize: font['2xl'], fontWeight: font.black, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { fontSize: font.md, color: colors.textMuted, marginBottom: spacing['2xl'] },
  label: {
    fontSize: font.xs,
    fontWeight: font.extrabold,
    color: colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    fontSize: font.lg,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  inputFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  errBox: {
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  err: { color: colors.error, fontSize: font.md, fontWeight: font.semibold },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnDis: { opacity: 0.5 },
  btnPressed: { backgroundColor: colors.primaryHover, transform: [{ scale: 0.98 }] },
  btnTxt: { color: colors.textInverse, fontSize: font.lg + 1, fontWeight: font.extrabold },
});
