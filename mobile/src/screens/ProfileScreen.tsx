import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { SessionUser } from '../types';
import { getLiteMode, setLiteMode } from '../utils/photoUtils';

type Props = {
  session: SessionUser;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Profile'>;
  onLogout: () => void;
};

const ROLE_LABELS: Record<string, string> = {
  DRIVER: 'Chofer',
  ADMIN: 'Administrador',
  OPERATOR: 'Operador',
};

export default function ProfileScreen({ session, navigation, onLogout }: Props) {
  const insets = useSafeAreaInsets();
  const [liteMode, setLiteModeState] = useState(false);

  useEffect(() => { getLiteMode().then(setLiteModeState); }, []);

  const toggleLiteMode = async () => {
    const next = !liteMode;
    setLiteModeState(next);
    await setLiteMode(next);
  };

  const confirmLogout = () => {
    Alert.alert(
      'Cerrar sesión',
      '¿Seguro que querés salir?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sí, salir', style: 'destructive', onPress: onLogout },
      ]
    );
  };

  const roleLabel = ROLE_LABELS[session.role] ?? session.role;
  const initials = session.fullName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View style={[styles.screen, { paddingTop: Math.max(16, insets.top) }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backTxt}>← Volver</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Mi perfil</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Avatar + nombre */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initials}</Text>
          </View>
          <Text style={styles.fullName}>{session.fullName}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleTxt}>{roleLabel}</Text>
          </View>
        </View>

        {/* Info cards */}
        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>ID de usuario</Text>
            <Text style={styles.infoValue} selectable>{session.id}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Rol</Text>
            <Text style={styles.infoValue}>{roleLabel}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Organización</Text>
            <Text style={styles.infoValue} selectable>{session.tenantId}</Text>
          </View>
        </View>

        {/* Modo LITE */}
        <Pressable style={styles.liteCard} onPress={toggleLiteMode}>
          <View style={styles.liteLeft}>
            <Text style={styles.liteTitle}>⚡ Modo LITE</Text>
            <Text style={styles.liteSub}>
              {liteMode
                ? 'Activo · fotos comprimidas, menor uso de datos'
                : 'Activá para ahorrar datos en zonas con señal baja'}
            </Text>
          </View>
          <View style={[styles.toggleTrack, liteMode && styles.toggleTrackOn]}>
            <View style={[styles.toggleThumb, liteMode && styles.toggleThumbOn]} />
          </View>
        </Pressable>

        {/* Links rápidos */}
        <View style={styles.linksSection}>
          <Pressable style={styles.linkRow} onPress={() => navigation.navigate('History')}>
            <Text style={styles.linkIcon}>📋</Text>
            <View style={styles.linkBody}>
              <Text style={styles.linkTitle}>Historial de rutas</Text>
              <Text style={styles.linkSub}>Ver tus entregas de los últimos 30 días</Text>
            </View>
            <Text style={styles.linkArrow}>→</Text>
          </Pressable>
        </View>

        {/* Logout */}
        <Pressable style={styles.logoutBtn} onPress={confirmLogout}>
          <Text style={styles.logoutTxt}>Cerrar sesión</Text>
        </Pressable>

        <Text style={styles.version}>R14 · App Móvil</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
    gap: 12,
  },
  backBtn: { padding: 6 },
  backTxt: { fontSize: 14, fontWeight: '800', color: '#4f46e5' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  content: { padding: 20, gap: 20 },
  avatarSection: { alignItems: 'center', paddingVertical: 10 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarTxt: { color: '#fff', fontSize: 28, fontWeight: '900' },
  fullName: { fontSize: 20, fontWeight: '900', color: '#0f172a', textAlign: 'center' },
  roleBadge: {
    marginTop: 6,
    backgroundColor: '#eef2ff',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  roleTxt: { fontSize: 12, fontWeight: '800', color: '#3730a3' },
  infoSection: { gap: 8 },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  infoLabel: { fontSize: 10, fontWeight: '800', color: '#94a3b8', letterSpacing: 0.5, marginBottom: 4 },
  infoValue: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  liteCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  liteLeft: { flex: 1 },
  liteTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  liteSub: { fontSize: 11, color: '#64748b', marginTop: 3 },
  toggleTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#cbd5e1',
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackOn: { backgroundColor: '#4f46e5' },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
    alignSelf: 'flex-start',
  },
  toggleThumbOn: { alignSelf: 'flex-end' },
  linksSection: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  linkIcon: { fontSize: 20 },
  linkBody: { flex: 1 },
  linkTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  linkSub: { fontSize: 11, color: '#64748b', marginTop: 2 },
  linkArrow: { fontSize: 16, color: '#94a3b8', fontWeight: '700' },
  logoutBtn: {
    backgroundColor: '#fff1f2',
    borderWidth: 1.5,
    borderColor: '#fecdd3',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoutTxt: { color: '#e11d48', fontSize: 15, fontWeight: '900' },
  version: { textAlign: 'center', fontSize: 11, color: '#cbd5e1', fontWeight: '600' },
});
