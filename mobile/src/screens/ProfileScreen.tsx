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
import { colors, font, radius, spacing, shadow } from '../theme';

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
                ? 'Activo · fotos se comprimen para gastar menos datos'
                : 'Comprime fotos para zonas con poca señal'}
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
  screen: { flex: 1, backgroundColor: colors.surfaceContainerLow },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    gap: spacing.md,
  },
  backBtn: { padding: spacing.sm },
  backTxt: { fontSize: font.md, fontWeight: font.extrabold, color: colors.primary },
  headerTitle: { fontSize: font.xl, fontWeight: font.black, color: colors.textPrimary },
  content: { padding: spacing.xl, gap: spacing.xl },
  avatarSection: { alignItems: 'center', paddingVertical: spacing.md },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadow.lg,
  },
  avatarTxt: { color: colors.textInverse, fontSize: 30, fontWeight: font.black },
  fullName: { fontSize: font['2xl'], fontWeight: font.black, color: colors.textPrimary, textAlign: 'center' },
  roleBadge: {
    marginTop: spacing.sm,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  roleTxt: { fontSize: font.sm + 1, fontWeight: font.extrabold, color: colors.primary },
  infoSection: { gap: spacing.sm },
  infoCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    borderWidth: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  infoLabel: { fontSize: font.xs, fontWeight: font.extrabold, color: colors.textMuted, letterSpacing: 0.5, marginBottom: spacing.xs },
  infoValue: { fontSize: font.md, fontWeight: font.bold, color: colors.textPrimary },
  liteCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    borderWidth: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  liteLeft: { flex: 1 },
  liteTitle: { fontSize: font.md, fontWeight: font.extrabold, color: colors.textPrimary },
  liteSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 3 },
  toggleTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerHighest,
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackOn: { backgroundColor: colors.primary },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.card,
    ...shadow.sm,
    alignSelf: 'flex-start',
  },
  toggleThumbOn: { alignSelf: 'flex-end' },
  linksSection: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    borderWidth: 0,
    overflow: 'hidden',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    gap: spacing.md,
  },
  linkIcon: { fontSize: 22 },
  linkBody: { flex: 1 },
  linkTitle: { fontSize: font.md, fontWeight: font.extrabold, color: colors.textPrimary },
  linkSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  linkArrow: { fontSize: font.lg, color: colors.textMuted, fontWeight: font.bold },
  logoutBtn: {
    backgroundColor: colors.errorBg,
    borderWidth: 0,
    borderRadius: radius.full,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  logoutTxt: { color: colors.error, fontSize: font.lg - 1, fontWeight: font.black },
  version: { textAlign: 'center', fontSize: font.sm, color: colors.textMuted, fontWeight: font.semibold },
});
