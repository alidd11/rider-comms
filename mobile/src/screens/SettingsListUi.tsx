import * as React from 'react';
import { View, Text, Pressable, Switch, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, pressedFeedback } from '../theme';

/**
 * Settings: grouped full-width rows on a darker page, coloured
 * round icons on the category list, a centred title between back and
 * close, values in grey before the chevron. The PWA mirrors this in
 * docs/app.css ("Settings (Nov 2026)").
 */
const PALETTE = {
  dark: { page: '#000000', group: '#202124', separator: 'rgba(255,255,255,0.1)', segmentTrack: '#3A3B3F', segmentOn: '#000000' },
  light: { page: '#F2F2F7', group: '#FFFFFF', separator: 'rgba(0,0,0,0.1)', segmentTrack: '#E3E3E8', segmentOn: '#FFFFFF' },
} as const;

export function useSettingsPalette(): (typeof PALETTE)['dark'] | (typeof PALETTE)['light'] {
  return useColorScheme() === 'light' ? PALETTE.light : PALETTE.dark;
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Back on the left, centred title, optional close (X) on the right. */
export function SettingsHeader({ title, topInset, onBack, onClose }: {
  title: string;
  topInset: number;
  onBack: () => void;
  onClose?: () => void;
}): React.JSX.Element {
  const palette = useSettingsPalette();
  return (
    <View style={[ui.header, { paddingTop: topInset + 6, backgroundColor: palette.group, borderBottomColor: palette.separator }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} hitSlop={8} style={({ pressed }) => [ui.headerButton, pressed && pressedFeedback]}>
        <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
      </Pressable>
      <Text numberOfLines={1} style={ui.headerTitle} accessibilityRole="header">{title}</Text>
      {onClose ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Close settings" onPress={onClose} hitSlop={8} style={({ pressed }) => [ui.headerButton, pressed && pressedFeedback]}>
          <Ionicons name="close" size={26} color={colors.textPrimary} />
        </Pressable>
      ) : <View style={ui.headerButton} />}
    </View>
  );
}

/** A full-width group of rows, with an optional heading above and note below. */
export function SettingsGroup({ title, note, compact = false, children }: {
  title?: string;
  note?: string;
  /** Tighter spacing, for the Settings home list so it fits without scrolling. */
  compact?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const palette = useSettingsPalette();
  return (
    <View style={[ui.groupWrap, compact && ui.groupWrapCompact]}>
      {title ? <Text style={ui.groupTitle} accessibilityRole="header">{title}</Text> : null}
      <View style={[ui.group, { backgroundColor: palette.group, borderColor: palette.separator }]}>{children}</View>
      {note ? <Text style={ui.groupNote}>{note}</Text> : null}
    </View>
  );
}

function Separator({ inset }: { inset: number }): React.JSX.Element {
  const palette = useSettingsPalette();
  return <View style={[ui.separator, { left: inset, backgroundColor: palette.separator }]} />;
}

/** A Settings-root row: coloured round icon, title, the current choice in
 * grey when there is one, chevron. */
export function CategoryRow({ icon, customIcon, tint, title, value, first = false, onPress }: {
  icon?: IconName;
  /** For glyphs Ionicons lacks (the motorbike), drawn white at 22pt. */
  customIcon?: React.ReactNode;
  tint: string;
  title: string;
  value?: string;
  first?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={[title, value].filter(Boolean).join(', ')} onPress={onPress} style={({ pressed }) => [ui.row, ui.categoryRow, pressed && ui.pressed]}>
      {first ? null : <Separator inset={60} />}
      <View style={[ui.categoryIcon, { backgroundColor: tint }]}>
        {customIcon ?? (icon ? <Ionicons name={icon} size={17} color="#FFFFFF" /> : null)}
      </View>
      <Text style={ui.rowTitle}>{title}</Text>
      {value ? <Text numberOfLines={1} style={ui.rowValue}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

/** A plain row: title, optional grey value, chevron when it opens a page. */
export function PlainRow({ title, value, danger = false, chevron = true, first = false, onPress }: {
  title: string;
  value?: string;
  danger?: boolean;
  chevron?: boolean;
  first?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={[title, value].filter(Boolean).join(', ')} onPress={onPress} style={({ pressed }) => [ui.row, pressed && ui.pressed]}>
      {first ? null : <Separator inset={16} />}
      <Text style={[ui.rowTitle, danger && ui.danger]}>{title}</Text>
      {value ? <Text numberOfLines={1} style={ui.rowValue}>{value}</Text> : null}
      {chevron ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

/** A line of information: no action, so not a button. */
export function InfoRow({ title, first = false }: { title: string; first?: boolean }): React.JSX.Element {
  return (
    <View accessible accessibilityLabel={title} style={ui.row}>
      {first ? null : <Separator inset={16} />}
      <Text style={ui.rowTitle}>{title}</Text>
    </View>
  );
}

/** One choice of several: a tick on the selected row. */
export function CheckRow({ title, selected, first = false, onPress }: {
  title: string;
  selected: boolean;
  first?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [ui.row, pressed && ui.pressed]}>
      {first ? null : <Separator inset={16} />}
      <Text style={ui.rowTitle}>{title}</Text>
      {selected ? <Ionicons name="checkmark" size={22} color={colors.accent} /> : null}
    </Pressable>
  );
}

/** A row with a switch that acts in place. */
export function SwitchRow({ title, value, first = false, onValueChange }: {
  title: string;
  value: boolean;
  first?: boolean;
  onValueChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={ui.row}>
      {first ? null : <Separator inset={16} />}
      <Text style={ui.rowTitle}>{title}</Text>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.switchTrackOff, true: colors.accent }}
        ios_backgroundColor={colors.switchTrackOff}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

/** A label with a segmented control underneath. */
export function SegmentedRow<T extends string>({ title, options, value, first = false, onChange }: {
  title: string;
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  first?: boolean;
  onChange: (next: T) => void;
}): React.JSX.Element {
  const palette = useSettingsPalette();
  return (
    <View style={[ui.row, ui.stackRow]}>
      {first ? null : <Separator inset={16} />}
      <Text style={ui.rowTitle}>{title}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={[ui.segmented, { backgroundColor: palette.segmentTrack }]}>
        {options.map(([option, label]) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              onPress={() => { if (!selected) onChange(option); }}
              style={[ui.segment, selected && { backgroundColor: palette.segmentOn, borderColor: palette.separator, borderWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[ui.segmentText, selected && ui.segmentTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const ui = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { width: 48, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 19, fontWeight: '700', color: colors.textPrimary },
  groupWrap: { marginTop: 28 },
  groupWrapCompact: { marginTop: 16 },
  groupTitle: { paddingHorizontal: 16, paddingBottom: 8, fontSize: 15, color: colors.textSecondary },
  group: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  groupNote: { paddingHorizontal: 16, paddingTop: 10, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 8 },
  // 44pt rows (Apple's minimum touch height) keep the Settings root on one screen.
  categoryRow: { minHeight: 44, paddingVertical: 4 },
  pressed: { opacity: 0.7 },
  separator: { position: 'absolute', top: 0, right: 16, height: StyleSheet.hairlineWidth },
  categoryIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { flex: 1, fontSize: 17, fontWeight: '500', color: colors.textPrimary },
  rowValue: { maxWidth: '45%', fontSize: 15, color: colors.textSecondary },
  danger: { color: '#F07474' },
  stackRow: { flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingVertical: 14 },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: 999 },
  segment: { flex: 1, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  segmentTextOn: { color: colors.textPrimary },
});
