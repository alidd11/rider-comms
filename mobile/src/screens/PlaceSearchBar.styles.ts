import { StyleSheet } from 'react-native';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';

export const styles = StyleSheet.create({
  collapsed: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46,
    paddingHorizontal: 14, borderRadius: 23, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  collapsedText: { ...type.body, color: colors.textMuted, flex: 1, fontSize: 13 },
  pressed: { opacity: 0.76 },
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10 },
  backButton: {
    width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radii.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  inputShell: {
    flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: 14, borderRadius: radii.lg, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, ...elevation.raised,
  },
  input: { flex: 1, ...type.body, color: colors.textPrimary, paddingVertical: 0 },
  categories: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: 3, paddingBottom: 12 },
  category: {
    minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  categoryActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  categoryText: { ...type.caption, fontSize: 14, color: colors.textSecondary },
  categoryTextActive: { color: colors.accentText },
  resultsContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  resultsHeader: {
    minHeight: 58, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 5, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  resultsEyebrow: { ...type.label, fontSize: 10 },
  resultsTitle: { ...type.subheading, fontSize: 16, marginTop: 2 },
  resultsCount: { ...type.caption, fontSize: 11 },
  clearRecent: { ...type.caption, color: colors.accent, fontWeight: '800', paddingVertical: spacing.sm },
  resultRow: {
    minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 5,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  resultRowPressed: { backgroundColor: colors.surfaceRaised },
  resultIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.accentSoft },
  resultInfo: { flex: 1, minWidth: 0 },
  resultName: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  resultAddress: { ...type.caption, marginTop: 3 },
  resultTrailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resultDistance: { ...type.caption, fontSize: 11 },
  state: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  stateCompact: { flex: 0, minHeight: 210 },
  stateIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radii.lg, backgroundColor: colors.surfaceRaised, marginBottom: spacing.md },
  stateTitle: { ...type.subheading, textAlign: 'center' },
  stateCopy: { ...type.caption, maxWidth: 310, marginTop: spacing.sm, textAlign: 'center', lineHeight: 20 },
  stateAction: {
    minHeight: 42, justifyContent: 'center', marginTop: spacing.md, paddingHorizontal: spacing.lg,
    borderRadius: radii.md, backgroundColor: colors.accent,
  },
  stateActionText: { ...type.caption, color: colors.accentText, fontWeight: '800' },
  attribution: { ...type.caption, paddingHorizontal: 20, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.border, textAlign: 'right', fontSize: 11 },
});
