import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { accountErrorMessage, SOCIAL_REPORT_REASONS } from './authClient';
import type { RiderAccountClient, SocialReportReason } from './authClient';
import { C, s } from './styles';

export type PostAction = 'deleted' | 'reported' | 'blocked';
export type PostActionClient = Pick<RiderAccountClient, 'deleteSocialPost' | 'reportSocialPost' | 'blockRider'>;

const REASON_LABELS: Record<SocialReportReason, string> = {
  harassment: 'Bullying or harassment',
  unsafe: 'Dangerous riding or a safety risk',
  spam: 'Spam or scam',
  sexual: 'Nudity or sexual content',
  other: 'Something else',
};

export function PostActions({ postId, authorId, handle, mine, client, item = 'post', onRemoved, onNotice, onClose }: {
  postId: string; authorId: string; handle: string; mine: boolean; client: PostActionClient;
  item?: 'post' | 'Reel';
  onRemoved: (why: PostAction) => void;
  onNotice: (message: string) => void;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<'menu' | 'report' | 'confirm-delete' | 'confirm-block'>('menu');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>, why: PostAction, done: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      onNotice(done);
      onRemoved(why);
      onClose();
    } catch (failure) {
      setError(accountErrorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <View>
    {error ? <Text accessibilityRole="alert" style={[s.body, { padding: 10 }]}>{error}</Text> : null}
    {busy ? <ActivityIndicator color={C.accent} style={{ margin: 14 }}/> : null}
    {!busy && panel === 'menu' && mine ? <PanelButton icon="trash-outline" label={'Delete ' + item} danger onPress={() => setPanel('confirm-delete')}/> : null}
    {!busy && panel === 'menu' && !mine ? <>
      <PanelButton icon="flag-outline" label={'Report ' + item} onPress={() => setPanel('report')}/>
      <PanelButton icon="ban-outline" label={'Block ' + (handle || 'this rider')} danger onPress={() => setPanel('confirm-block')}/>
    </> : null}
    {!busy && panel === 'report' ? <>
      <Text style={[s.small, { padding: 10 }]}>Why are you reporting this {item}? It’s hidden from you straight away.</Text>
      {SOCIAL_REPORT_REASONS.map(reason => <PanelButton key={reason} icon="chevron-forward" label={REASON_LABELS[reason]}
        onPress={() => void run(() => client.reportSocialPost(postId, reason), 'reported', 'Thanks. We’ll review this ' + item + '.')}/>)}
    </> : null}
    {!busy && panel === 'confirm-delete' ? <>
      <Text style={[s.small, { padding: 10 }]}>Delete this {item}? Its photos or video are removed too. This can’t be undone.</Text>
      <PanelButton icon="trash" label="Delete" danger onPress={() => void run(() => client.deleteSocialPost(postId), 'deleted', item === 'Reel' ? 'Reel deleted.' : 'Post deleted.')}/>
    </> : null}
    {!busy && panel === 'confirm-block' ? <>
      <Text style={[s.small, { padding: 10 }]}>Block {handle || 'this rider'}? You won’t see each other’s posts, and they can’t message you, in Social or Rider Comms.</Text>
      <PanelButton icon="ban" label="Block" danger onPress={() => void run(() => client.blockRider(authorId), 'blocked', 'Blocked.')}/>
    </> : null}
    {!busy ? <PanelButton icon="close" label="Cancel" onPress={() => onClose()}/> : null}
  </View>;
}

function PanelButton({ icon, label, danger = false, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; danger?: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={[s.row, { minHeight: 46, paddingHorizontal: 10 }]}>
    <Ionicons name={icon} size={20} color={danger ? C.danger : C.ink}/>
    <Text style={[s.body, danger ? { color: C.danger } : null]}>{label}</Text>
  </Pressable>;
}
