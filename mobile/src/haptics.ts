// One place for touch feedback, so every action feels the same: a light tap
// for buttons, a tick for selections and switches, success and warning for
// outcomes. Failures are ignored: haptics are a nicety, never a dependency.
import * as Haptics from 'expo-haptics';

const ignore = () => {};

export const haptics = {
  /** A button that does something: Go live, Send, Report, End. */
  tap(): void {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore);
  },
  /** A choice or a switch changing state. */
  select(): void {
    void Haptics.selectionAsync().catch(ignore);
  },
  /** Something worked: copied, sent, reported. */
  success(): void {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
  },
  /** Something didn't: a send failed. */
  warning(): void {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(ignore);
  },
};
