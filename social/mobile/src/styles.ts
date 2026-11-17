import { Appearance, Platform, StyleSheet } from 'react-native';

import palette from '../../../shared/src/brandPalette.json';
import { BRAND_RADII } from '../../../shared/src/brand.ts';

/**
 * Rider Social's colours are Rider Comms' palette, so both apps look like one
 * product, light or dark with the phone. Change them in
 * shared/src/brandPalette.json, never here.
 */
type Brand = typeof palette.dark;
const colours = (brand: Brand) => ({
  bg: brand.background,
  panel: brand.surface,
  card: brand.surfaceRaised,
  border: brand.border,
  ink: brand.textPrimary,
  muted: brand.textSecondary,
  faint: brand.textMuted,
  accent: brand.accent,
  accentDark: brand.accentSoft,
  accentText: brand.accentText,
  danger: brand.danger,
  dangerSurface: brand.dangerSurface,
  success: brand.success,
  warning: brand.warning,
});

/** The phone's light or dark setting, read once when Social opens. */
export const colorScheme: 'light' | 'dark' = Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
export const C = colours(palette[colorScheme]);
/** Photo and video screens (Reels, Stories, the camera) stay dark in light mode. */
export const CDark = colours(palette.dark);

// The colours are fixed when Social opens, so the web app reloads when the
// phone switches between light and dark.
if (Platform.OS === 'web') {
  Appearance.addChangeListener(({ colorScheme: next }) => {
    if ((next === 'light' ? 'light' : 'dark') !== colorScheme) globalThis.location?.reload();
  });
}
export const R = BRAND_RADII;

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  root: { flex: 1, backgroundColor: C.bg, width: '100%', overflow: 'hidden' },
  header: { paddingHorizontal: 17, paddingTop: 4, paddingBottom: 4, minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.bg },
  wordmark: { color: C.accent, fontSize: 11, fontWeight: '900', letterSpacing: 3 },
  brandTitle: { color: C.ink, fontSize: 27, fontWeight: '900', letterSpacing: -1.2 },
  small: { color: C.muted, fontSize: 13, lineHeight: 19 },
  headerTools: { flexDirection: 'row', gap: 5 },
  iconButton: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: C.card },
  scroll: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32, gap: 16 },
  eyebrow: { color: C.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: C.ink, fontSize: 25, fontWeight: '800', letterSpacing: -0.6 },
  sectionTitle: { color: C.ink, fontWeight: '900', fontSize: 20, letterSpacing: -0.55 },
  body: { color: C.ink, fontSize: 15, lineHeight: 22 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: C.panel, borderRadius: R.card, overflow: 'hidden' },
  pad: { padding: 16, gap: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  divider: { height: 1, backgroundColor: C.border },
  pill: { paddingHorizontal: 14, paddingVertical: 9, minHeight: 42, justifyContent: 'center', borderRadius: R.pill, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel },
  pillActive: { borderColor: C.accent, backgroundColor: C.accentDark },
  pillText: { color: C.muted, fontWeight: '700', fontSize: 13 },
  pillTextActive: { color: C.accent },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDark },
  avatarText: { fontSize: 12, fontWeight: '900', color: C.ink },
  storyCircle: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  media: { height: 220, alignItems: 'center', justifyContent: 'center', gap: 12 },
  mediaCategory: { color: '#D6EDF0', fontWeight: '900', fontSize: 11, letterSpacing: 3 },
  mediaTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 24, textAlign: 'center', paddingHorizontal: 22, letterSpacing: -0.5 },
  cardHeading: { color: C.ink, fontWeight: '800', fontSize: 16 },
  actionText: { color: C.muted, fontWeight: '700', fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  cta: { paddingHorizontal: 17, paddingVertical: 12, minHeight: 48, backgroundColor: C.accent, borderRadius: R.control, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 14, fontWeight: '800', color: C.accentText },
  ghost: { backgroundColor: C.card, paddingHorizontal: 15, paddingVertical: 11, minHeight: 44, borderRadius: R.control, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: C.ink, fontSize: 13, fontWeight: '800' },
  // All form inputs use a transparent field with one quiet baseline, never a filled blue box.
  input: { color: C.ink, backgroundColor: 'transparent', borderWidth: 0, borderBottomWidth: 1, borderBottomColor: C.border, borderRadius: 0, paddingHorizontal: 0, paddingVertical: 12, minHeight: 48, fontSize: 16 },
  notice: { marginHorizontal: 18, marginTop: 10, padding: 12, backgroundColor: C.accentDark, borderWidth: 1, borderColor: C.accent, borderRadius: R.control },
  tabBar: { flexDirection: 'row', borderTopColor: C.border, borderTopWidth: 1, backgroundColor: C.bg, paddingTop: 7, paddingBottom: 10 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2, minHeight: 50, gap: 3 },
  tabLabel: { fontSize: 10, color: C.muted, fontWeight: '700' },
  darkBadge: { backgroundColor: C.accentDark, borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { color: C.accent, fontWeight: '800', fontSize: 10 },
  reel: { height: 455, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', padding: 22, gap: 16 },

  feedCard: { backgroundColor: C.bg, borderBottomWidth: 1, borderColor: C.border, overflow: 'hidden' },
  feedAuthorRow: { paddingHorizontal: 17, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feedOptions: { paddingHorizontal: 19, paddingVertical: 14, gap: 17, backgroundColor: C.panel, borderTopColor: C.border, borderTopWidth: 1 },
  feedMedia: { width: '100%', justifyContent: 'flex-start', alignItems: 'flex-start' },
  feedMediaTag: { margin: 12, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(5,12,18,0.76)' },
  feedMediaTagText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: C.ink },
  feedActions: { paddingHorizontal: 17, paddingTop: 12, paddingBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feedCaption: { paddingHorizontal: 17, paddingBottom: 17, paddingTop: 8, gap: 3 },
  // Keep the two Home feeds in fixed app chrome, immediately beneath the
  // wordmark, rather than showing them as transient filter chips after Stories.
  feedSwitchBar: { width: '100%', minHeight: 46, paddingHorizontal: 13,
    backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feedModeTab: { minWidth: 88, minHeight: 46, paddingHorizontal: 3,
    justifyContent: 'center', alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent' },
  feedModeTabActive: { borderBottomColor: C.accent },
  feedModeText: { color: C.muted, fontSize: 15, fontWeight: '700', letterSpacing: -0.25 },
  feedModeTextActive: { color: C.ink, fontWeight: '800' },
  compactIcon: { width: 44, height: 44, alignItems: 'center',
    justifyContent: 'center', borderRadius: 12 },
  storyRail: { gap: 13, paddingTop: 10, paddingBottom: 11, paddingHorizontal: 16 },
  storyItem: { alignItems: 'center', gap: 5, width: 69 },
  storyLabel: { fontSize: 11, color: C.muted, fontWeight: '600' },
  reelTop: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.5)' },
  reelPlay: { borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', width: 66, height: 66, justifyContent: 'center', alignItems: 'center' },
  reelCaption: { alignSelf: 'stretch', gap: 6, backgroundColor: 'rgba(0,0,0,0.46)', padding: 12, borderRadius: 13 },
  twoCol: { flexDirection: 'row', gap: 10 },
  split: { flex: 1 },
  empty: { backgroundColor: C.panel, borderRadius: R.card,
    paddingHorizontal: 22, paddingVertical: 31,
    alignItems: 'center', justifyContent: 'center', gap: 11 }
});
