// Type stub for optional expo-notifications package.
// The package is not required to be installed — the app imports it dynamically
// and falls back silently when it is not present (no-op push notifications).
declare module 'expo-notifications' {
  export function requestPermissionsAsync(): Promise<{ status: string }>;
  export function getExpoPushTokenAsync(options?: Record<string, unknown>): Promise<{ data: string }>;
  export function setNotificationHandler(handler: {
    handleNotification: () => Promise<{
      shouldShowAlert: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }): void;
}
