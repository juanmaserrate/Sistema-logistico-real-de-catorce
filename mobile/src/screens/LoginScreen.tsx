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
  Image,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { login } from '../api';
import { persistSession } from '../sessionStorage';
import type { SessionUser } from '../types';
import { assertApiConfigured } from '../config';
import { colors, font, radius, spacing, shadow } from '../theme';

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
        {/* Logo oficial (versión blanca, el fondo de esta pantalla es oscuro) */}
        <Image
          source={require('../../assets/r14-logo-blanco.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="R14 · Real de Catorce"
        />
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

        <Text style={styles.label}>CONTRASEÑA</Text>
        <TextInput
          style={[styles.input, passFocused && styles.inputFocused]}
          value={password}
          onChangeText={setPassword}
          onFocus={() => setPassFocused(true)}
          onBlur={() => setPassFocused(false)}
          secureTextEntry
          placeholder="••••••••"
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
  logo: { width: 190, height: 134, marginBottom: spacing.lg },
  sub: { fontSize: font.lg, color: colors.heroSub, marginTop: spacing.xs, fontWeight: font.semibold },
  tag: { fontSize: font.base, color: colors.heroTag, marginTop: spacing.md },
  card: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 0,
    padding: spacing['2xl'],
    ...shadow.md,
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
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    borderWidth: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    fontSize: font.lg,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  inputFocused: {
    borderWidth: 2,
    borderColor: colors.borderFocus,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.md,
  },
  errBox: {
    backgroundColor: colors.errorBg,
    borderWidth: 0,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  err: { color: colors.error, fontSize: font.md, fontWeight: font.semibold },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadow.sm,
  },
  btnDis: { opacity: 0.5 },
  btnPressed: { backgroundColor: colors.primaryContainer, transform: [{ scale: 0.98 }] },
  btnTxt: { color: colors.textInverse, fontSize: font.lg + 1, fontWeight: font.extrabold },
});
