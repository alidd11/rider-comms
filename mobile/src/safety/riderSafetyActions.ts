import { Alert } from 'react-native';
import type { RiderCommsClient } from '../api/client';

type ReportReason = 'harassment' | 'unsafe' | 'spam' | 'sexual' | 'other';

export interface RiderSafetyTarget {
  riderId: string;
  /** Shown in the prompts; falls back to "this rider". */
  name?: string;
  /** Where the report came from, stored with it for moderators. */
  source: string;
}

type SafetyClient = Pick<RiderCommsClient, 'reportRider' | 'blockRider'>;

/**
 * Report and block, offered the same way everywhere another rider appears
 * (friend profile, chat, ride roster, friend requests, Nearby Voice), as App
 * Review guideline 1.2 requires for user-generated content.
 */
export function openReportFlow(client: SafetyClient, target: RiderSafetyTarget): void {
  const send = (reason: ReportReason) => {
    void client.reportRider(target.riderId, reason, `Reported from ${target.source}`)
      .then(() => Alert.alert('Report received', 'Thank you. Our team reviews reports within 24 hours and acts on anything that breaks the Community Guidelines.'))
      .catch(() => Alert.alert('Couldn’t send report', 'Please try again when you have a connection.'));
  };
  Alert.alert('Report rider', 'Choose the reason that best describes the issue.', [
    { text: 'Harassment or threats', onPress: () => send('harassment') },
    { text: 'Sexual or explicit content', onPress: () => send('sexual') },
    { text: 'Unsafe behaviour', onPress: () => send('unsafe') },
    { text: 'Spam or scam', onPress: () => send('spam') },
    { text: 'Something else', onPress: () => send('other') },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

export function confirmBlock(client: SafetyClient, target: RiderSafetyTarget, onBlocked?: () => void): void {
  const name = target.name || 'this rider';
  Alert.alert(`Block ${name}?`, 'You won’t see or hear each other in Nearby, and they can’t message you or send friend requests. They aren’t told. You can unblock them in Settings.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Block', style: 'destructive', onPress: () => {
      void client.blockRider(target.riderId)
        .then(() => onBlocked?.())
        .catch(() => Alert.alert('Couldn’t block rider', 'Please try again when you have a connection.'));
    } },
  ]);
}

/** One menu with both actions, for compact rows. */
export function openRiderSafetyMenu(client: SafetyClient, target: RiderSafetyTarget, onBlocked?: () => void): void {
  Alert.alert(target.name || 'Rider', undefined, [
    { text: 'Report rider', onPress: () => openReportFlow(client, target) },
    { text: 'Block rider', style: 'destructive', onPress: () => confirmBlock(client, target, onBlocked) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
