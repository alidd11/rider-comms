import * as React from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { colors } from '../theme';
import { styles } from './SettingsScreen.styles';
import { useSettings } from '../settings/SettingsContext';

/**
 * The last section of Help & Support: the app's real version (from app.json,
 * the same number the web app shows) and the details support needs, ready to
 * paste into a message.
 */
export function AboutPage({ title }: { title?: string } = {}): React.JSX.Element {
  const { displayName, handle } = useSettings();
  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const platform = Platform.OS === 'ios' ? 'iOS' : 'Android';
  const [copied, setCopied] = React.useState(false);
  const copyDetails = async () => {
    const details = `Rider Comms ${appVersion} · ${platform} ${String(Platform.Version)}\nRider: ${handle}`;
    try { await Clipboard.setStringAsync(details); setCopied(true); } catch { Alert.alert('Couldn’t copy the app details'); }
  };
  return (
    <View style={styles.pageSection}>
      {title ? <Text style={styles.pageSectionTitle} accessibilityRole="header">{title}</Text> : null}
      <View style={styles.settingsSheetSection}>
        <View style={styles.aboutSummary}>
          <Text style={styles.aboutTitle}>Rider Comms</Text>
          <Text style={styles.aboutSummaryValue}>Version {appVersion} · {platform}</Text>
          <Text style={styles.aboutSummaryValue}>Signed in as {displayName} ({handle})</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={copied ? 'App details copied' : 'Copy app details'} testID="copy-app-details" style={({ pressed }) => [styles.myProfileEdit, styles.aboutCopy, pressed && styles.sheetActionDisabled]} onPress={() => void copyDetails()}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={17} color={colors.accentText} />
            <Text style={styles.myProfileEditText}>{copied ? 'Copied' : 'Copy app details'}</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.pageSectionNote}>Paste these into your message to support so we can help faster.</Text>
    </View>
  );
}
