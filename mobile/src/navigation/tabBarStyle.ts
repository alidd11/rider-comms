import { StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import { colors } from '../theme';

// Kept apart from navigation/index.tsx so MapScreen can hide the bar during
// turn-by-turn navigation without importing the navigator (a cycle).

// backgroundColor is the app background, not the surface color: the tab
// bar's background fills the bottom safe-area inset, so it must match the
// screens above it for one continuous edge-to-edge surface.
export const TAB_BAR_STYLE: ViewStyle = {
  backgroundColor: colors.background,
  borderTopColor: colors.border,
  borderTopWidth: StyleSheet.hairlineWidth,
};

export const HIDDEN_TAB_BAR_STYLE: ViewStyle = { display: 'none' };
