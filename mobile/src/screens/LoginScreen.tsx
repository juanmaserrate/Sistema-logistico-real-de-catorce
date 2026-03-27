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

type Props = { onLoggedIn: (user: SessionUser) => void | Promise<void> };

export default function LoginScreen({ onLoggedIn }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        <Text style={styles.brand}>R14</Text>
        <Text style={styles.sub}>Seguimiento satelital</Text>
        <Text style={styles.tag}>Recorrido en vivo · Planificación</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Acceso chofer</Text>
        <Text style={styles.label}>Usuario</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>Contraseña</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Pressable
          style={[styles.btn, loading && styles.btnDis]}
          onPress={submit}
          disabled={loading || !username.trim() || !password}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnTxt}>Ingresar</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  hero: { paddingTop: 72, paddingHorizontal: 28, paddingBottom: 24 },
  brand: { fontSize: 42, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  sub: { fontSize: 18, color: '#94a3b8', marginTop: 4, fontWeight: '600' },
  tag: { fontSize: 13, color: '#64748b', marginTop: 12 },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#64748b', marginBottom: 6 },
  input: {
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 14,
  },
  err: { color: '#b91c1c', marginBottom: 12, fontSize: 14 },
  btn: {
    backgroundColor: '#4f46e5',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDis: { opacity: 0.6 },
  btnTxt: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
