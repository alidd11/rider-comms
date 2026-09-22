// Keep this compatibility entry point so existing native imports stay stable.
// The implementation and provider-neutral contracts now live in the shared
// package, ready for future route providers without coupling UI components to
// Google-specific response shapes.
export {
  formatNavigationDistance,
  formatNavigationSpeed,
  maneuverIcon,
  navigationManeuverAction,
  navigationPromptStageForDistance,
  navigationPromptText,
  navigationSpeedUnit,
} from '@rider-comms/shared';

export type {
  NavigationInstruction,
  NavigationLane,
  NavigationManeuverIcon,
  NavigationPromptStage,
  NavigationUnit,
} from '@rider-comms/shared';
