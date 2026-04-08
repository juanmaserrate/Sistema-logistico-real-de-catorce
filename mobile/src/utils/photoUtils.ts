import AsyncStorage from '@react-native-async-storage/async-storage';

const LITE_KEY = 'r14_lite_mode';

export async function getLiteMode(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(LITE_KEY);
    return val === 'true';
  } catch { return false; }
}

export async function setLiteMode(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(LITE_KEY, enabled ? 'true' : 'false');
  } catch {}
}

/**
 * Compresses a photo before upload using expo-image-manipulator.
 * LITE mode: max 800px, quality 0.4
 * Normal mode: max 1200px, quality 0.7
 * Falls back to original URI if compression fails.
 */
export async function compressPhoto(uri: string, liteMode = false): Promise<string> {
  try {
    const mod = await import('expo-image-manipulator').catch(() => null) as any;
    if (!mod?.manipulateAsync) return uri;
    const maxSize = liteMode ? 800 : 1200;
    const quality = liteMode ? 0.4 : 0.7;
    const result = await mod.manipulateAsync(
      uri,
      [{ resize: { width: maxSize } }],
      { compress: quality, format: mod.SaveFormat?.JPEG ?? 'jpeg' }
    );
    return result.uri;
  } catch {
    return uri;
  }
}
