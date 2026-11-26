// The oldest phone-app version staff allow (Staff Hub, App settings). Checked
// once, at launch: an older app shows "Update Rider Comms" instead of the
// app, with a button to its store page. If the check fails or is slow, the
// app opens as normal, so a server problem never locks riders out, and a
// rider who is already riding is never stopped by a late answer.
import * as React from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../config';
import { colors, MIN_TOUCH_TARGET, spacing } from '../theme';

/** A slower answer is ignored: the rider is already using the app. */
export const UPDATE_CHECK_TIMEOUT_MS = 6000;

type Platforms = { ios?: string | null; android?: string | null };
interface UpdateConfig { minAppVersion?: Platforms; updateUrl?: Platforms }

/** -1, 0 or 1, comparing x.y.z versions number by number. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** The store page to open when this app is too old, or null when it may run. */
export function requiredUpdate(config: UpdateConfig, platform: string, version: string): { url: string | null } | null {
  if (platform !== 'ios' && platform !== 'android') return null;
  const minimum = config.minAppVersion?.[platform];
  if (typeof minimum !== 'string' || !/^\d+\.\d+\.\d+$/.test(minimum)) return null;
  if (compareVersions(version, minimum) >= 0) return null;
  const url = config.updateUrl?.[platform];
  return { url: typeof url === 'string' && url.startsWith('https://') ? url : null };
}

export function UpdateGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [update, setUpdate] = React.useState<{ url: string | null } | null>(null);

  React.useEffect(() => {
    let settled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => { settled = true; controller.abort(); }, UPDATE_CHECK_TIMEOUT_MS);
    fetch(`${API_BASE_URL}/config`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<UpdateConfig> : null))
      .then((config) => {
        if (settled || !config) return;
        setUpdate(requiredUpdate(config, Platform.OS, Constants.expoConfig?.version ?? '0.0.0'));
      })
      .catch(() => undefined)
      .finally(() => { settled = true; clearTimeout(timer); });
    return () => { settled = true; clearTimeout(timer); controller.abort(); };
  }, []);

  return update ? <UpdateRequiredScreen url={update.url} /> : <>{children}</>;
}

export function UpdateRequiredScreen({ url }: { url: string | null }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const store = Platform.OS === 'ios' ? 'the App Store' : 'Google Play';
  return (
    <View testID="update-required" style={[styles.screen, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.body}>
        <Ionicons name="arrow-up-circle" size={56} color={colors.accent} />
        <Text style={styles.title} accessibilityRole="header">Update Rider Comms</Text>
        <Text style={styles.text}>
          This version is no longer supported. Update from {store} to keep riding with your group.
        </Text>
      </View>
      {url ? (
        <Pressable
          testID="update-open-store"
          accessibilityRole="button"
          onPress={() => { void Linking.openURL(url).catch(() => undefined); }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>Open {store}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg, justifyContent: 'space-between' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  text: { fontSize: 16, lineHeight: 23, color: colors.textSecondary, textAlign: 'center', maxWidth: 360 },
  button: { minHeight: MIN_TOUCH_TARGET + 8, borderRadius: 999, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },
  buttonText: { fontSize: 17, fontWeight: '800', color: colors.accentText },
});
