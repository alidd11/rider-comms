// Navigation's cards follow the map, as on the web (html.map-day): dark at
// night even when the phone is in light mode, so the banner and trip
// summary never sit as white slabs over the night map. In dark mode the
// adaptive theme colours are already dark, so nothing changes.
import * as React from 'react';
import { colors, darkColors } from './theme';
import type { ThemeColors } from './theme';

export const NavigationNightContext = React.createContext(false);

/** Whether navigation is in its night look, and the colours to draw it with. */
export function useNavigationPalette(): { night: boolean; palette: ThemeColors } {
  const night = React.useContext(NavigationNightContext);
  return { night, palette: night ? darkColors : colors };
}
