import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import { IdentityAvatar } from './IdentityAvatar';
import { handleWithAt } from './identityDisplay';
import { AccountApiError, accountErrorMessage } from './authClient';
import type { DirectMessage, RiderAccountClient, RiderProfile, SharedConversation, SharedFriend } from './authClient';

type Props = {
  ownRiderId: string;
  emailVerified: boolean;
  client: RiderAccountClient;
  conversations: readonly SharedConversation[];
  friends: readonly SharedFriend[];
  profiles: Readonly<Record<string, RiderProfile>>;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
};
const messageText = (error: unknown, verified: boolean): string => {
  if (error instanceof AccountApiError) {
    if ((error.code === 'not_verified' || (error.status === 403 && !verified)))
      return 'Verify your email to message riders.';
    if (error.code === 'blocked') return 'You can’t message this rider.';
    if (error.code === 'not_friends') return 'You can only message your Rider Comms friends.';
    if (error.code === 'objectionable_content') return 'That message can’t be sent.';
    if (error.status === 429) return 'Too many attempts. Try again in a few minutes.';
  }
  return accountErrorMessage(error);
};
/** Uses the existing direct-message API and Rider Comms friendships. Not a Social inbox. */
export function SharedMessagesScreen({
  ownRiderId, emailVerified, client, conversations, friends, profiles,
  loading, error, onRefresh,
}: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [thread, setThread] = useState<DirectMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [threadError, setThreadError] = useState<string | null>(null);
  const requestId = useRef(0);

  const friend = (riderId: string): SharedFriend | undefined =>
    friends.find(item => item.riderId === riderId) ||
    conversations.find(item => item.friend.riderId === riderId)?.friend;
  const display = (riderId: string): { displayName: string; handle: string } => {
    const profile = profiles[riderId], known = friend(riderId);
    return {
      displayName: profile?.displayName || known?.displayName || 'Rider',
      handle: profile?.handle || known?.handle || '',
    };
  };

  useEffect(() => {
    // Prevent a slow response from an older thread from appearing under a
    // newly selected rider. No credentials, message bodies or request URLs logged.
    const id = ++requestId.current;
    if (!active) {
      setThread([]);
      setThreadError(null);
      setThreadLoading(false);
      setSending(false);
      return;
    }
    // Clear the previous rider's messages before loading the next thread.
    // A delayed response must never appear beneath another rider's name.
    setThread([]);
    setThreadLoading(true);
    setSending(false);
    setThreadError(null);
    setDraft('');
    void client.messageThread(active).then(page => {
      if (requestId.current !== id) return;
      setThread(page.messages);
    }).catch(cause => {
      if (requestId.current !== id) return;
      setThreadError(messageText(cause, emailVerified));
    }).finally(() => { if (requestId.current === id) setThreadLoading(false); });
    return () => { requestId.current += 1; };
  }, [active, client, emailVerified]);

  async function send(): Promise<void> {
    if (!active || sending || !emailVerified) return;
    const message = draft.trim();
    if (message.length < 1 || message.length > 1000) {
      setThreadError('Enter a message between 1 and 1,000 characters.');
      return;
    }
    // If the rider navigates to a different conversation while a send is
    // in flight, never insert the old rider's message/error into that thread.
    const threadRequestId = requestId.current;
    const recipientId = active;
    setSending(true); setThreadError(null);
    try {
      const sent = await client.sendMessage(recipientId, message);
      if (requestId.current !== threadRequestId) return;
      setThread(previous => previous.some(item => item.id === sent.id) ? previous : [...previous, sent]);
      setDraft('');
      void onRefresh();
    } catch (cause) {
      if (requestId.current === threadRequestId)
        setThreadError(messageText(cause, emailVerified));
    } finally {
      if (requestId.current === threadRequestId) setSending(false);
    }
  }

  if (active) {
    const rider = display(active);
    return <View testID="shared-message-thread" style={{ flex: 1, minHeight: 0, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8,
        borderBottomWidth: 1, borderColor: C.border }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to conversations"
          onPress={() => setActive(null)} style={{ width: 42, height: 44,
            justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="chevron-back" color={C.ink} size={25}/>
        </Pressable>
        <IdentityAvatar name={rider.displayName} size={38}/>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 15 }}>{rider.displayName}</Text>
          {rider.handle ? <Text style={s.small}>{handleWithAt(rider.handle)}</Text> : null}
        </View>
      </View>
      <ScrollView testID="shared-message-bubbles" style={{ flex: 1, minHeight: 0 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: 12, gap: 10 }}
        showsVerticalScrollIndicator={false}>
        {threadLoading ? <ActivityIndicator color={C.accent}/> : null}
        {!threadLoading && !threadError && !thread.length ? <Text style={s.muted}>
          No messages yet.
        </Text> : null}
        {thread.map(item => {
          const mine = item.fromRiderId === ownRiderId;
          return <View key={item.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start',
            maxWidth: '84%', borderRadius: 16, paddingHorizontal: 13,
            paddingVertical: 10, backgroundColor: mine ? C.accentDark : C.panel }}>
            <Text style={{ color: C.ink, fontSize: 14, lineHeight: 20 }}>{item.text}</Text>
          </View>;
        })}
      </ScrollView>
      {threadError ? <Text accessibilityRole="alert" style={{ color: '#F2B0BA',
        fontSize: 12, lineHeight: 18, paddingHorizontal: 6 }}>{threadError}</Text> : null}
      {!emailVerified ? <Text style={{ color: C.muted, fontSize: 12 }}>
        Verify your email to message riders.
      </Text> : null}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end', paddingBottom: 5 }}>
        <TextInput accessibilityLabel="Write a message"
          value={draft} onChangeText={setDraft} editable={emailVerified && !sending}
          placeholder="Message" placeholderTextColor={C.muted} multiline maxLength={1000}
          style={[s.input, { flex: 1, minHeight: 46, maxHeight: 118,
            fontSize: 16, textAlignVertical: 'top' }]}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Send message"
          disabled={!emailVerified || sending || !draft.trim() || draft.trim().length > 1000}
          onPress={() => void send()}
          style={{ width: 46, height: 46, borderRadius: 23,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: C.accentDark, opacity: !emailVerified || sending || !draft.trim() ? 0.5 : 1 }}>
          <Ionicons name="arrow-up" color={C.accent} size={22}/>
        </Pressable>
      </View>
    </View>;
  }
  return <View testID="shared-message-inbox" style={{ flex: 1, minHeight: 0, gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={s.title}>Messages</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh shared messages"
        disabled={loading} onPress={() => void onRefresh()}
        style={{ paddingVertical: 9, paddingHorizontal: 12 }}>
        <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>
          {loading ? 'Loading…' : 'Refresh'}
        </Text>
      </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={{ color: '#F2B0BA', fontSize: 12 }}>{error}</Text> : null}
    {!emailVerified ? <Text style={{ color: C.muted, fontSize: 12 }}>
      Verify your email to message riders.
    </Text> : null}
    <ScrollView style={{ flex: 1, minHeight: 0 }} showsVerticalScrollIndicator={false}
      contentContainerStyle={{ gap: 2, paddingBottom: 20 }}>
      {!loading && !error && !conversations.length ? <View style={{
        alignItems: 'center', paddingVertical: 48, gap: 10 }}>
        <Ionicons name="chatbubble-ellipses-outline" color={C.muted} size={33}/>
        <Text style={s.cardHeading}>No conversations yet</Text>
        <Text style={[s.small, { textAlign: 'center' }]}>
          Your Rider Comms conversations will appear here.
        </Text>
      </View> : null}
      {conversations.map(entry => {
        const riderId = entry.friend.riderId;
        const rider = display(riderId);
        return <Pressable key={riderId} accessibilityRole="button"
          accessibilityLabel={'Open conversation with ' + rider.displayName}
          onPress={() => setActive(riderId)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border }}>
          <IdentityAvatar name={rider.displayName} size={44}/>
          <View style={{ flex: 1, gap: 5 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800' }}>{rider.displayName}</Text>
              {entry.unreadCount > 0 ? <Text style={{ color: C.accent, fontSize: 12 }}>
                {entry.unreadCount} new
              </Text> : null}
            </View>
            <Text numberOfLines={1} style={s.muted}>{entry.lastMessage.text}</Text>
          </View>
          <Ionicons name="chevron-forward" color={C.muted} size={17}/>
        </Pressable>;
      })}
    </ScrollView>
  </View>;
}
